// City materials: MeshStandardMaterial patched with onBeforeCompile, so three's own lighting,
// cascaded shadows (CSM) and environment reflections stay intact and we only replace the
// surface description (albedo / roughness / normal / emissive) and the fog.
//
// The GLSL here is mirrored 1:1 in assets/city/godot/*.gdshader — keep them in sync.
import * as THREE from 'three';

// ------------------------------------------------------------------------------------------
// shared uniforms (one object, referenced by every city material)
// ------------------------------------------------------------------------------------------
export const U = {
  uTime: { value: 0 },
  uNight: { value: 0 },            // 0 day .. 1 full night: window lights, street glow
  uLitFrac: { value: 0.2 },        // fraction of rooms with lights on (hour dependent)
  uInteriorDay: { value: 0.07 },   // daylight brightness of rooms seen through glass (outside is 10-50x brighter: windows read DARK by day)
  uLitDay: { value: 0.07 },        // artificial light in lit rooms/shops by day (was 0.25: windows glowed white at noon)
  uStreetGlow: { value: 0 },       // warm sodium/LED spill on the lower facades at night
  uSunDirV: { value: new THREE.Vector3(0, 1, 0) },   // towards the sun, VIEW space
  uSunDirW: { value: new THREE.Vector3(0, 1, 0) },   // towards the sun, WORLD space
  uFogColor: { value: new THREE.Color(0.6, 0.7, 0.8) },
  uFogSun: { value: new THREE.Color(1.0, 0.8, 0.6) },
  uFogDensity: { value: 0.00012 },
  uFogFalloff: { value: 0.0022 },
  uFogBase: { value: 0.0 },
  uWetness: { value: 0.0 },
  uLampColor: { value: new THREE.Color(1.0, 0.72, 0.42) },
  uDebug: { value: 0 },
  uNoise: { value: null },
  uSkyField: { value: (() => { const t = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })() },
  uSkyRect: { value: new THREE.Vector4(-800, -1760, 800, 1760) },
  uLook: { value: 1 },             // 1 = V3 city look, 0 = the pre-2026-09-26 materials (?cityLook=0, HP fallback)
};

// ------------------------------------------------------------------------------------------
// GLSL
// ------------------------------------------------------------------------------------------
export const GLSL_COMMON = /* glsl */`
uniform float uTime, uNight, uLitFrac, uInteriorDay, uLitDay, uStreetGlow, uWetness, uLook;
uniform vec3 uSunDirV, uSunDirW, uFogColor, uFogSun, uLampColor;
uniform float uFogDensity, uFogFalloff, uFogBase;
uniform int uDebug;
varying vec3 vCityW;

float h11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
uniform sampler2D uNoise;   // tileable: r 4 cells, g 16 cells, b 64 cells, a fbm (8..64)
float vnoise(vec2 p) { return texture(uNoise, p * 0.0625).g; }
float fbm3(vec2 p) { return texture(uNoise, p * 0.125).a; }

// Sky visibility (build_skyfield.py): R = sky view factor of the surface at that cell (street or roof), G = mean
// building height around / 300 m, B = height map / 450 m. A wall point samples the street 3 m out along its
// normal and opens up with height towards the neighbourhood's roofline.
uniform sampler2D uSkyField; uniform vec4 uSkyRect;
// NaN/Inf guard, bit-exact (ANGLE->D3D11 may optimise isnan() away; HLSL has no NaN/Inf safety net)
bool badF(float v) { return (floatBitsToUint(v) & 0x7f800000u) == 0x7f800000u; }
bool bad3(vec3 v) { return badF(v.x) || badF(v.y) || badF(v.z); }
// final guard for every city material: finite, <= 32 per channel (half-float targets overflow at 65504; a GGX sun glint
// on ~0.05-rough glass reaches 1e5 = Inf in the RT -> the NaN guard pass turns it into black/speckles)
vec3 cityOut(vec3 c) { return bad3(c) ? uFogColor : clamp(c, 0.0, 32.0); }
float skyVis(vec3 w, vec3 nW) {
  vec2 uv = (w.xz + nW.xz * 3.0 - uSkyRect.xy) / (uSkyRect.zw - uSkyRect.xy);
  vec4 f = texture(uSkyField, clamp(uv, 0.0, 1.0));
  float hC = f.b * 450.0, hM = f.g * 300.0;
  float rise = smoothstep(hC + 0.5, hC + max(10.0, (hM - hC) * 1.5 + 6.0), w.y);
  float v = clamp(mix(f.r, 1.0, rise), 0.0, 1.0);
  return uLook > 0.5 ? v : 1.0;
}

// Exponential height fog with sun in-scattering (aerial perspective). Analytic integral of
// density a*exp(-b*(y - base)) along the view ray (Inigo Quilez).
vec3 cityFog(vec3 col, vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-3);
  float b = uFogFalloff;
  float a = uFogDensity * exp(-b * (cameraPosition.y - uFogBase));
  float dy = dir.y * b;
  float amt = abs(dy) > 1e-5 ? a * (1.0 - exp(-dist * dy)) / dy : a * dist;
  float f = 1.0 - exp(-max(amt, 0.0));
  // complete towards the far plane: the sky dome below the horizon is the fog colour, so the
  // edge of the world (water/terrain end ~15 km out) dissolves instead of drawing a band
  f = max(f, smoothstep(5000.0, 14000.0, dist));
  float s = pow(max(dot(dir, uSunDirW), 0.0), 8.0);
  vec3 fc = mix(uFogColor, uFogSun, s * 0.85);
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
`;

const VERT_WORLD = /* glsl */`
  { vec4 cw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    cw = instanceMatrix * cw;
  #endif
  #ifdef USE_BATCHING
    cw = batchingMatrix * cw;
  #endif
    vCityW = (modelMatrix * cw).xyz; }
`;

// ------------------------------------------------------------------------------------------
// FACADE
// ------------------------------------------------------------------------------------------
const FACADE_FRAG_PARS = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uFacAlb;
uniform sampler2DArray uFacNrm;
uniform sampler2D uStyles;
uniform sampler2D uRoomsDay;
uniform sampler2D uRoomsNight;
uniform vec3 uRoomAvgDay, uRoomAvgNight;
varying vec2 vFacUv;
varying vec2 vFacUv1;

struct Fac { vec3 alb; float rough; float metal; vec3 nT; vec3 emi; float shadow; float ao; };
// [V3] NaN/Inf guard, bit-exact (ANGLE→D3D11 may optimise isnan() away). Jurek's HP showed black facades at
// street level and black squares (bloomed NaN pixels) — Metal/SwiftShader never did.
// glass is a specular surface with ~no diffuse: metal = 1 and albedo = F0 (coated curtain-wall glass 0.08-0.3,
// clear 0.045). Diffusely lit tinted glass was what turned the towers into pale cyan foam-board boxes.
vec3 glassF0(vec3 gt, float refl) { return mix(vec3(0.045), gt * 0.6, 0.3 + 0.55 * refl); }

// Interior mapping: ray/box against a room behind the glass, then the hit point is projected
// into a front-view render of the room (back wall = fraction ROOM_B of the image). 4x4 atlas.
const float ROOM_B = 0.5;
vec3 room(sampler2D atlas, vec2 pRoom, vec3 rd, vec3 size, float idx, float lod) {
  vec3 p = vec3(pRoom * size.xy, 0.0);
  vec3 r = rd;
  r.x = abs(r.x) < 1e-4 ? 1e-4 : r.x;
  r.y = abs(r.y) < 1e-4 ? 1e-4 : r.y;
  r.z = max(r.z, 1e-4);
  float tx = r.x > 0.0 ? (size.x - p.x) / r.x : -p.x / r.x;
  float ty = r.y > 0.0 ? (size.y - p.y) / r.y : -p.y / r.y;
  float tz = size.z / r.z;
  float t = min(min(tx, ty), tz);
  vec3 h = p + r * t;
  vec3 hn = vec3(h.xy / size.xy * 2.0 - 1.0, h.z / size.z);
  float k = 1.0 + hn.z * (1.0 / ROOM_B - 1.0);
  vec2 img = clamp(hn.xy / k * 0.5 + 0.5, 0.01, 0.99);
  vec2 tile = vec2(mod(idx, 4.0), 3.0 - floor(idx / 4.0));
  return textureLod(atlas, (tile + img) / 4.0, lod).rgb;
}

float boxMask(vec2 p, vec2 a, vec2 b, float soft) {
  vec2 s = smoothstep(a - soft, a + soft, p) * (1.0 - smoothstep(b - soft, b + soft, p));
  return s.x * s.y;
}
// anti-aliased thin line: 1 inside |d| < w, filtered by pixel size px, faded when < 1 px
float aaLine(float d, float w, float px) {
  return (1.0 - smoothstep(w - px * 0.5, w + px * 0.5, abs(d))) * clamp(w * 2.0 / px, 0.0, 1.0);
}

void facadeFar(inout Fac o, vec2 w0, vec2 w1, vec2 pm, vec2 cell, float bayW, float cellH, float px,
               float cellPx, vec4 s3, vec4 s5, float seed, float litP, float pool2, float curtain) {
  // window coverage: local soft mask while cells are a few pixels, the area fraction when smaller
  float covAvg = (w1.x - w0.x) * (w1.y - w0.y) / max(bayW * cellH, 1e-4);
  float covLoc = boxMask(pm, w0, w1, px * 0.75);
  // (was 1.2..3 px: a 2-3 px window grid aliases into moire/speckle = Jurek's "pixelated" towers)
  float cov = mix(covAvg, covLoc, smoothstep(2.6, 5.0, cellPx));
  float covE = mix(covAvg, max(covLoc, covAvg * 0.6), smoothstep(0.35, 1.2, cellPx) * uNight);
  float frameF = 1.0 - clamp(1.0 - 2.0 * s3.w * ((w1.x - w0.x) + (w1.y - w0.y)) / max((w1.x - w0.x) * (w1.y - w0.y), 1e-4), 0.0, 1.0);
  vec3 gt = s5.xyz; float refl = s5.w;
  vec2 rid = vec2(floor(cell.x), cell.y) + seed * 311.0;
  // per-window on/off only once a window is several pixels by day (else it is noise); at night
  // the sparkle of single lit windows IS the skyline, so it starts at ~1 px
  float perWin = smoothstep(mix(3.0, 0.6, uNight), mix(6.0, 1.5, uNight), cellPx);
  float lit = mix(litP, step(h12(rid + 17.7), litP), perWin);
  float bright = mix(1.0, mix(0.6, 1.5, h12(rid + 9.1)), perWin);
  vec3 lcol = pool2 < 0.5 ? vec3(0.9, 0.95, 1.0) : vec3(1.0, 0.8, 0.58);
  vec3 interior = uRoomAvgDay * uInteriorDay + lit * uRoomAvgNight * lcol * bright * (uLitDay + 1.1 * uNight);
  if (pool2 > 2.5 && uLook > 0.5) interior *= mix(vec3(1.0), vec3(0.62, 0.5, 0.38), uNight);
  float transmit = mix(0.9, 0.45, refl);
  float g = cov * (1.0 - frameF * 0.5);
  o.alb = mix(o.alb, uLook > 0.5 ? glassF0(gt, refl) : gt, g);
  o.alb = mix(o.alb, s3.xyz, cov * frameF * 0.5);
  o.metal = mix(o.metal, uLook > 0.5 ? 1.0 : refl * 0.55, g);
  o.rough = mix(o.rough, uLook > 0.5 ? 0.12 : 0.08, g);
  o.nT = normalize(mix(o.nT, vec3(0.0, 0.0, 1.0), cov));
  o.emi += interior * transmit * covE * (1.0 - frameF * 0.5) * mix(vec3(1.0), gt * 2.2, curtain * 0.6);
  o.shadow = 1.0;
}

Fac facade(vec2 uv, vec2 uv1, vec3 rdT, vec3 sunT, float wy, float distCam) {
  Fac o = Fac(vec3(0.5), 0.8, 0.0, vec3(0.0, 0.0, 1.0), vec3(0.0), 1.0, 1.0);   // [V3] D3D11: X4000 'potentially uninitialized'
  float sid = mod(uv1.x, 64.0);
  float gtype = floor(uv1.x / 64.0 + 0.001);
  float blank = step(1.99, uv1.y);
  float seed = fract(uv1.y);
  int si = int(sid + 0.5);
  vec4 s0 = texelFetch(uStyles, ivec2(0, si), 0);
  vec4 s1 = texelFetch(uStyles, ivec2(1, si), 0);
  vec4 s2 = texelFetch(uStyles, ivec2(2, si), 0);
  vec4 s3 = texelFetch(uStyles, ivec2(3, si), 0);
  vec4 s4 = texelFetch(uStyles, ivec2(4, si), 0);
  vec4 s5 = texelFetch(uStyles, ivec2(5, si), 0);
  vec4 s6 = texelFetch(uStyles, ivec2(6, si), 0);
  vec4 s7 = texelFetch(uStyles, ivec2(7, si), 0);
  float bayW = s0.x, floorH = s0.y, groundH = s0.z, layer = s0.w;
  float curtain = s4.z, roomSpan = max(1.0, s4.w);
  float pool = s7.x;

  bool gf = uv.y < 1.0;
  float cellH = gf ? groundH : floorH;
  vec2 cell = floor(uv);
  vec2 f = fract(uv);
  vec2 pm = vec2(f.x * bayW, f.y * cellH);
  float hM = gf ? uv.y * groundH : groundH + (uv.y - 1.0) * floorH;
  // pixel footprint in metres (derivatives of continuous coordinates, before any branching)
  vec2 mm = vec2(uv.x * bayW, hM);
  float px = max(length(vec2(dFdx(mm.x), dFdy(mm.x))), length(vec2(dFdx(mm.y), dFdy(mm.y))));
  px = max(px, 1e-4);
  float cellPx = min(bayW, cellH) / px;
  float bh = h11(seed * 91.7);

  // ---- wall material (continuous texture over the whole face)
  vec2 wuv = mm / s1.w + vec2(seed * 13.0, 0.0);
  vec3 tint = s1.xyz * (0.86 + 0.28 * vec3(bh, h11(seed * 37.1), h11(seed * 53.3)) * vec3(1.0, 0.9, 0.85));
  vec3 wall = texture(uFacAlb, vec3(wuv, layer)).rgb * tint;
  vec4 wn = texture(uFacNrm, vec3(wuv, layer));
  float blot = fbm3(mm * 0.08 + seed * 40.0);
  wall *= 0.84 + 0.3 * blot;
  wall *= mix(0.72, 1.0, smoothstep(0.0, 2.2, wy));
  // weathering (LOOK-AUDIT §4): rain streaks running down the wall, a dirty street band with a ragged top,
  // soot darkening with age per building — clean flat albedo was a big part of the 'foam-board model' look
  if (uLook > 0.5) { float age = h11(seed * 71.3);
    float streak = smoothstep(0.5, 0.95, vnoise(vec2(mm.x * 1.9 + seed * 57.0, mm.y * 0.035))) * (1.0 - smoothstep(0.006, 0.02, px));
    float band = 1.0 - smoothstep(0.4, 2.6 + 1.4 * vnoise(vec2(mm.x * 0.6, 3.0)), wy);
    wall *= (1.0 - 0.22 * streak * (0.4 + age)) * (1.0 - 0.28 * band) * mix(1.0, 0.82, age * smoothstep(0.3, 0.8, blot)); }
  if (uLook > 0.5) { float lw = dot(wall, vec3(0.2126, 0.7152, 0.0722)); if (lw > 0.62) wall *= 0.62 / lw; }   // real white stone/paint ~0.6
  o.alb = wall;
  o.rough = mix(0.72, 0.97, wn.b);
  o.metal = 0.0;
  o.nT = vec3((wn.xy * 2.0 - 1.0) * mix(0.3, 0.9, 1.0 - smoothstep(0.005, 0.02, px)), 1.0);
  o.emi = vec3(0.0);
  o.shadow = 1.0;
  o.ao = mix(0.55, 1.0, wn.a);

  if (blank > 0.5) {
    float streak = vnoise(vec2(mm.x * 1.3, 0.0) + seed * 9.0);
    o.alb *= 0.9 + 0.12 * streak;
    o.emi += o.alb * uStreetGlow * exp(-wy / 7.0) * uLampColor;
    return o;
  }

  // ---- the window rectangle of this cell (metres, cell origin bottom-left)
  vec2 w0, w1;
  float frameW = s3.w;
  float recess = s2.w;
  float isShop = 0.0;
  if (curtain > 0.5) {
    w0 = vec2(frameW, s7.z);
    w1 = vec2(bayW - frameW, cellH - frameW * 0.5);
    if (gf) { w0 = vec2(frameW, 0.0); w1 = vec2(bayW - frameW, cellH - 0.9); }
  } else {
    w0 = vec2((bayW - s2.x) * 0.5, s2.z);
    w1 = w0 + s2.xy;
  }
  if (gf) {
    if (gtype > 0.5 && gtype < 1.5) {            // shopfront
      w0 = vec2(0.12, 0.45); w1 = vec2(bayW - 0.12, groundH - 1.25); isShop = 1.0; recess = 0.12;
    } else if (gtype > 1.5 && gtype < 2.5) {     // glass lobby
      w0 = vec2(frameW, 0.0); w1 = vec2(bayW - frameW, groundH - 0.7); isShop = 1.0; recess = 0.1;
    } else if (gtype > 2.5 && gtype < 3.5) {     // rusticated base: smaller windows
      w0 = vec2((bayW - s2.x * 0.8) * 0.5, 1.4); w1 = vec2(w0.x + s2.x * 0.8, groundH - 1.0);
      float g = abs(fract(hM / 0.55) - 0.5);
      o.alb *= 0.8 + 0.2 * smoothstep(0.0, max(0.06, px), g);
    } else if (gtype > 3.5) {                    // raised basement (brownstone garden level)
      w0 = vec2((bayW - s2.x) * 0.5, 0.35); w1 = vec2(w0.x + s2.x, 1.35);
    }
  }
  w1 = min(w1, vec2(bayW, cellH) - 0.02);
  // ---- doors (the #1 human-scale cue, LOOK-AUDIT S2): 2.2-3 m tall, one per shop / walk-up / lobby run
  float dkind = 0.0; vec2 d0 = vec2(0.0), d1 = vec2(0.0);
  if (gf && uLook > 0.5 && distCam < 250.0) {
    if (gtype > 0.5 && gtype < 1.5) {                            // shop: a glass door at one end of each 2-bay shop
      float shopI = floor(uv.x / 2.0);
      float side = step(0.5, h12(vec2(shopI, seed * 77.0 + 5.0)));
      if (abs(mod(cell.x, 2.0) - side) < 0.5) {
        float dw = min(1.05, bayW * 0.42);
        d0 = vec2(side > 0.5 ? bayW - 0.12 - dw : 0.12, 0.0); d1 = vec2(d0.x + dw, 2.3); dkind = 1.0;
      }
    } else if (gtype > 1.5 && gtype < 2.5) {                     // glass lobby: a pair of glass doors every ~7 bays
      if (mod(cell.x + floor(seed * 7.0), 7.0) < 0.5) { d0 = vec2(frameW, 0.0); d1 = vec2(bayW - frameW, 2.45); dkind = 2.0; }
    } else if (gtype > 2.5 && gtype < 3.5) {                     // rusticated base: a tall double door every ~6 bays
      if (mod(cell.x + floor(seed * 6.0), 6.0) < 0.5) { float dw = min(1.7, bayW - 0.5); d0 = vec2((bayW - dw) * 0.5, 0.0); d1 = vec2(d0.x + dw, 2.9); dkind = 4.0; }
    } else if (gtype < 0.5 && curtain < 0.5) {                   // walk-up: a panelled door + transom every ~5 bays
      if (mod(cell.x + floor(seed * 5.0), 5.0) < 0.5) {
        float dw = min(1.1, bayW - 0.6); d0 = vec2((bayW - dw) * 0.5, 0.0); d1 = vec2(d0.x + dw, 2.25); dkind = 3.0;
        w0 = vec2(d0.x, d1.y + 0.12); w1 = vec2(d1.x, min(d1.y + 0.62, cellH - 0.35));   // the bay's window becomes the transom
      }
    }
  }
  float pool2 = isShop > 0.5 ? 3.0 : pool;
  bool mech = pool > 8.5;
  float bldLit = mix(0.35, 1.6, h11(seed * 17.3)) * s7.w / 0.55;
  float litP = mech ? 0.0 : (isShop > 0.5 ? 0.92 : clamp(uLitFrac * bldLit, 0.0, 1.0));
  if (pool < 0.5) litP = max(litP, 0.6 * (1.0 - uNight) * clamp(bldLit, 0.3, 1.0));   // offices keep lights on by day

  // ---- trims on the wall: lintels, sills, deco spandrels, curtain-wall spandrels, sign bands
  vec3 trim = s6.xyz;
  float lintH = s7.y;
  float near_ = smoothstep(3.0, 8.0, cellPx);
  if (curtain < 0.5) {
    if (lintH > 0.01 && isShop < 0.5) {
      float lm = boxMask(pm, vec2(w0.x - 0.1, w1.y), vec2(w1.x + 0.1, w1.y + lintH), px * 0.5);
      o.alb = mix(o.alb, trim * (0.85 + 0.25 * blot), lm);
      o.rough = mix(o.rough, 0.8, lm);
      o.nT = normalize(mix(o.nT, pm.y > w1.y + lintH - 0.05 ? vec3(0.0, 0.6, 0.8) : vec3(0.0, 0.0, 1.0), lm * near_));
    }
    if (isShop < 0.5) {
      float sm = boxMask(pm, vec2(w0.x - 0.07, w0.y - 0.09), vec2(w1.x + 0.07, w0.y), px * 0.5);
      o.alb = mix(o.alb, trim * 0.9, sm);
      o.nT = normalize(mix(o.nT, vec3(0.0, 0.7, 0.7), sm * near_));
    }
    float st = smoothstep(w0.y - 0.1, w0.y - 1.4, pm.y) * step(pm.y, w0.y - 0.09) * step(w0.x, pm.x) * step(pm.x, w1.x);
    o.alb *= 1.0 - 0.18 * st * vnoise(vec2(pm.x * 6.0, cell.x + cell.y * 7.0));
    if (s6.w > 0.01 && !gf) {
      // art deco: the window column is a continuous vertical strip, spandrels dark
      float col = boxMask(vec2(pm.x, 0.5), vec2(w0.x, 0.0), vec2(w1.x, 1.0), px * 0.5);
      vec3 sp = trim * (0.9 + 0.2 * vnoise(pm * 3.0 + cell));
      float chev = step(0.5, fract((pm.y - pm.x * 0.5) * 2.0)) * near_;
      sp *= 0.85 + 0.2 * chev * step(pm.y, w0.y);
      o.alb = mix(o.alb, sp, col); o.rough = mix(o.rough, 0.45, col); o.metal = mix(o.metal, 0.35, col);
      float e = min(abs(pm.x - w0.x), abs(pm.x - w1.x));
      if (e < 0.1 && col < 0.5) o.nT = normalize(mix(o.nT, vec3(sign(pm.x - (w0.x + w1.x) * 0.5) * 0.5, 0.0, 0.85), near_));
    }
  } else if (!gf) {
    float sm = 1.0 - smoothstep(w0.y - px * 0.5, w0.y + px * 0.5, pm.y);
    o.alb = mix(o.alb, trim * (0.9 + 0.15 * vnoise(vec2(cell.x * 0.3, cell.y))), sm);
    o.rough = mix(o.rough, 0.22, sm); o.metal = mix(o.metal, 0.6, sm);
  }
  if (gf && gtype > 0.5 && gtype < 1.5 && pm.y > groundH - 1.15 && pm.y < groundH - 0.3) {
    float shop = floor(uv.x / 2.0);
    float hc = h12(vec2(shop, seed * 77.0));
    // sign board: dark/deep colour board, a thin frame, lettering as varied glyph blocks (word gaps, cap
    // heights) — lit channel letters at night on ~2/3 of shops, painted on the rest
    vec3 sc = 0.5 + 0.5 * cos(6.2831 * (hc + vec3(0.0, 0.33, 0.67)));
    sc = mix(vec3(0.05, 0.05, 0.055), sc * 0.55, step(0.3, hc));
    float by = (pm.y - (groundH - 1.15)) / 0.85;
    float shopX = uv.x * bayW - shop * 2.0 * bayW;                 // metres along this shop's board
    float lx = shopX * 3.4;                                        // ~0.3 m per glyph
    float word = h12(vec2(floor(lx / 5.0), shop + seed * 13.0));
    float gl = step(0.2, fract(lx)) * step(fract(lx), 0.86) * step(0.18, fract(lx / 5.0)) * step(word, 0.85);
    float capH = mix(0.5, 0.62, h12(vec2(shop, 9.0)));
    float inner = step(0.5 - capH * 0.5, by) * step(by, 0.5 + capH * 0.5);
    // 7-segment-ish glyphs: random strokes of a letter cell read as lettering, full blocks read as toy bricks
    float gx = (fract(lx) - 0.2) / 0.66, gy = (by - (0.5 - capH * 0.5)) / capH;
    float gh = h12(vec2(floor(lx), shop * 3.7 + seed));
    float sw = 0.24;
    float segL = step(gx, sw) * step(0.12, fract(gh * 7.0)), segR = step(1.0 - sw, gx) * step(0.3, fract(gh * 13.0));
    float segT = step(1.0 - sw * 0.8, gy) * step(0.35, fract(gh * 17.0)), segM = step(abs(gy - 0.5), sw * 0.4) * step(0.45, fract(gh * 23.0));
    float segB = step(gy, sw * 0.8) * step(0.25, fract(gh * 29.0)), segD = step(abs(gx - gy), sw * 0.6) * step(0.85, fract(gh * 31.0));
    float glyph = gl * inner * max(max(max(segL, segR), max(segT, segM)), max(segB, segD));
    float mid = step(0.2 * bayW * 2.0, shopX) * step(shopX, 1.8 * bayW);   // letters centred on the board
    float letter = glyph * mid * near_;
    float frameB = 1.0 - step(0.06, by) * step(by, 0.94);
    vec3 lc = hc < 0.55 ? vec3(0.95, 0.93, 0.88) : (hc < 0.8 ? vec3(1.0, 0.78, 0.3) : vec3(0.95, 0.3, 0.25));
    o.alb = mix(mix(sc, vec3(0.25), frameB), lc * 0.8, letter); o.rough = mix(0.45, 0.3, letter); o.metal = frameB * 0.6; o.nT = vec3(0, 0, 1);
    float litS = step(0.33, h12(vec2(shop, seed * 3.0 + 1.0)));
    o.emi += (lc * letter * 3.5 + sc * 0.25 * (1.0 - letter)) * uNight * litS;
  }
  // street-light spill at night on the lower wall
  o.emi += o.alb * uStreetGlow * exp(-wy / 7.0) * uLampColor * (0.7 + 0.6 * vnoise(vec2(uv.x * 0.37, 1.0)));

  if (dkind > 2.5) {                                              // a warm sconce beside residential doors at night
    float sc = 1.0 - smoothstep(0.05, 0.05 + max(px, 0.03), length(pm - vec2(d1.x + 0.3, d1.y - 0.2)));
    o.emi += vec3(1.0, 0.75, 0.45) * sc * (0.3 + 5.0 * uNight); o.alb = mix(o.alb, vec3(0.8, 0.75, 0.6), sc);
  }
  if (dkind > 0.5 && pm.x > d0.x - 0.12 && pm.x < d1.x + 0.12 && pm.y < d1.y + 0.14) {
    vec2 dp = pm - d0, ds = d1 - d0;
    float dnear = smoothstep(1.5, 4.0, cellPx) * (1.0 - smoothstep(200.0, 250.0, distCam));
    Fac dd = o;
    bool inD = dp.x > 0.0 && dp.x < ds.x && dp.y < ds.y;
    if (!inD) {                                                   // surround / door case (stone, painted metal)
      vec3 sur = dkind > 2.5 ? trim * 0.8 : vec3(0.1, 0.105, 0.11);
      dd.alb = sur; dd.rough = dkind > 2.5 ? 0.75 : 0.4; dd.metal = dkind > 2.5 ? 0.0 : 0.6;
      dd.nT = vec3(dp.x < 0.0 ? -0.45 : (dp.x > ds.x ? 0.45 : 0.0), dp.y > ds.y ? 0.45 : 0.0, 0.85);
    } else {
      float fr = dkind < 2.5 ? 0.06 : 0.1;
      float split = (dkind > 1.5 && dkind < 2.5) || dkind > 3.5 ? aaLine(dp.x - ds.x * 0.5, 0.035, px) : 0.0;
      float frameD = max(1.0 - smoothstep(fr - px, fr + px, min(min(dp.x, ds.x - dp.x), ds.y - dp.y)), split);
      if (dkind < 2.5) {                                           // glass door: dark glass, alu frame, push bar
        vec3 glassC = vec3(0.025, 0.028, 0.03);
        dd.alb = mix(glassC, vec3(0.5, 0.52, 0.54), frameD); dd.metal = mix(0.5, 0.85, frameD); dd.rough = mix(0.06, 0.35, frameD);
        float bar = aaLine(dp.y - 1.02, 0.025, px) * step(0.12, dp.x) * step(dp.x, ds.x - 0.12);
        float kick = step(dp.y, 0.22);
        dd.alb = mix(dd.alb, vec3(0.62, 0.63, 0.64), max(bar, kick * (1.0 - frameD) * 0.9)); dd.metal = mix(dd.metal, 0.9, max(bar, kick));
        dd.nT = vec3(0.0, 0.0, 1.0);
        dd.emi = (1.0 - frameD) * (1.0 - kick) * uLampColor * (0.02 + 0.9 * uNight) * (dkind > 1.5 ? 1.2 : 0.8);
      } else {                                                    // panelled door (painted / oak), glazed upper panel
        float hc = h12(vec2(floor(uv.x), seed * 31.0 + 2.0));
        vec3 paint = hc < 0.25 ? vec3(0.03, 0.03, 0.03) : hc < 0.45 ? vec3(0.06, 0.13, 0.08) : hc < 0.62 ? vec3(0.22, 0.05, 0.04) : hc < 0.8 ? vec3(0.05, 0.07, 0.14) : vec3(0.22, 0.13, 0.07);
        if (dkind > 3.5) paint = vec3(0.2, 0.12, 0.07);
        dd.alb = paint * (0.85 + 0.25 * vnoise(pm * 9.0)); dd.rough = 0.45; dd.metal = 0.0; dd.nT = vec3(0.0, 0.0, 1.0);
        // two raised panels per leaf
        float lw = dkind > 3.5 ? ds.x * 0.5 : ds.x;
        vec2 lp = vec2(mod(dp.x, lw), dp.y);
        float pan = boxMask(lp, vec2(0.14, 0.2), vec2(lw - 0.14, ds.y * 0.45), px) + boxMask(lp, vec2(0.14, ds.y * 0.52), vec2(lw - 0.14, ds.y - 0.16), px);
        float bevel = pan * (1.0 - boxMask(lp, vec2(0.2, 0.26), vec2(lw - 0.2, ds.y - 0.22), px));
        dd.nT = normalize(mix(dd.nT, vec3(lp.x < lw * 0.5 ? -0.5 : 0.5, 0.25, 0.8), bevel * dnear));
        float glz = dkind < 3.5 ? boxMask(dp, vec2(0.2, ds.y * 0.55), vec2(ds.x - 0.2, ds.y - 0.18), px) : 0.0;
        dd.alb = mix(dd.alb, vec3(0.02), glz); dd.metal = mix(dd.metal, 0.5, glz); dd.rough = mix(dd.rough, 0.06, glz);
        dd.emi = glz * uLampColor * (0.01 + 0.7 * uNight);
        float knob = 1.0 - smoothstep(0.03, 0.03 + px, length(dp - vec2(dkind > 3.5 ? ds.x * 0.5 + 0.12 : ds.x - 0.12, 1.0)));
        float plate = step(dp.y, 0.18) * (1.0 - step(ds.x - 0.04, dp.x)) * step(0.04, dp.x);
        dd.alb = mix(dd.alb, vec3(0.62, 0.48, 0.2), max(knob, plate * 0.8)); dd.metal = mix(dd.metal, 1.0, max(knob, plate)); dd.rough = mix(dd.rough, 0.3, max(knob, plate));
      }
      dd.alb *= mix(0.55, 1.0, smoothstep(0.0, 0.06, dp.y));     // threshold / street dirt
      dd.shadow = 1.0; dd.ao = mix(0.7, 1.0, smoothstep(0.0, 0.25, min(dp.x, ds.x - dp.x)));
    }
    o.alb = mix(o.alb, dd.alb, dnear); o.rough = mix(o.rough, dd.rough, dnear); o.metal = mix(o.metal, dd.metal, dnear);
    o.nT = normalize(mix(o.nT, dd.nT, dnear)); o.emi = mix(o.emi, dd.emi, dnear); o.ao = mix(o.ao, dd.ao, dnear);
    if (dnear > 0.5) return o;
  }

  // ---- far: averaged windows (no interior raytrace, no aliasing)
  float df = smoothstep(4.0, 8.0, cellPx) * (1.0 - smoothstep(200.0, 250.0, distCam));   // facade LOD: interior mapping <= 250 m
#ifdef CITY_CHEAP
  df = 0.0;
#endif
  if (mech) {
    // louvre grille for mechanical floors
    float inWm = boxMask(pm, w0, w1, px * 0.5);
    float l = fract(pm.y / 0.14);
    vec3 lv = vec3(0.16, 0.17, 0.18) * mix(0.9, 0.6 + 0.6 * smoothstep(0.2, 0.8, l), near_);
    o.alb = mix(o.alb, lv, inWm); o.rough = mix(o.rough, 0.55, inWm); o.metal = mix(o.metal, 0.5, inWm);
    o.nT = normalize(mix(o.nT, vec3(0.0, mix(-0.5, 0.7, l), 0.7), inWm * near_));
    return o;
  }
  Fac far_ = o;
  if (df < 0.999) {
    facadeFar(far_, w0, w1, pm, cell, bayW, cellH, px, cellPx, s3, s5, seed, litP, pool2, curtain);
    if (df < 0.001) return far_;
  }

  bool inW = pm.x > w0.x && pm.x < w1.x && pm.y > w0.y && pm.y < w1.y;
  // window AC units (residential, old walk-ups/lofts: ~1 in 6 windows) — sits in front of the glass
  if (uLook > 0.5 && distCam < 250.0 && inW && !gf && curtain < 0.5 && pool2 > 0.5 && pool2 < 2.5 && h12(vec2(floor(uv.x), cell.y) + seed * 5.1) < 0.17) {
    float aw = min(0.66, (w1.x - w0.x) * 0.8), ac0 = (w0.x + w1.x - aw) * 0.5;
    if (pm.x > ac0 && pm.x < ac0 + aw && pm.y < w0.y + 0.42) {
      vec2 ap = vec2((pm.x - ac0) / aw, (pm.y - w0.y) / 0.42);
      float grille = step(0.5, fract(ap.x * 14.0)) * step(0.15, ap.y) * step(ap.y, 0.85) * step(0.08, ap.x) * step(ap.x, 0.55) * near_;
      o.alb = vec3(0.62, 0.61, 0.57) * (0.85 + 0.2 * h11(seed + cell.y)) * (1.0 - 0.35 * grille) * (1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.4, ap.y)));
      o.rough = 0.5; o.metal = 0.3; o.emi = vec3(0.0); o.ao *= 0.9;
      o.nT = normalize(vec3(ap.x < 0.04 ? -0.6 : (ap.x > 0.96 ? 0.6 : 0.0), ap.y > 0.93 ? 0.7 : 0.0, 0.8));
      return o;
    }
  }
  if (!inW) {
    // soften the window edge by blending towards the far look within a pixel of it
    return o;
  }

  // ---- inside the opening: trace to the recessed glass plane
  vec2 g = pm;
  float gz = recess;
  if (recess > 0.005) {
    float tg = recess / max(rdT.z, 1e-3);
    g = pm + rdT.xy * tg;
    bool inside = g.x > w0.x && g.x < w1.x && g.y > w0.y && g.y < w1.y;
    if (!inside) {
      float tx = rdT.x > 0.0 ? (w1.x - pm.x) / rdT.x : (w0.x - pm.x) / min(rdT.x, -1e-4);
      float ty = rdT.y > 0.0 ? (w1.y - pm.y) / rdT.y : (w0.y - pm.y) / min(rdT.y, -1e-4);
      float tj = min(tx, ty);
      vec3 j = vec3(pm + rdT.xy * tj, rdT.z * tj);
      vec3 jn = tx < ty ? vec3(rdT.x > 0.0 ? -1.0 : 1.0, 0.0, 0.0) : vec3(0.0, rdT.y > 0.0 ? -1.0 : 1.0, 0.0);
      o.alb = (curtain > 0.5 ? s3.xyz : mix(wall, trim, 0.35)) * 0.85;
      o.rough = 0.85; o.metal = 0.0;
      o.nT = vec3(jn.x, jn.y, 0.0);
      if (sunT.z < -1e-3) {
        float ts = j.z / -sunT.z;
        vec2 e = j.xy + sunT.xy * ts;
        o.shadow = boxMask(e, w0, w1, 0.02 + ts * 0.02);
      }
      o.ao *= 0.75;
      if (df < 0.999) { o.alb = mix(far_.alb, o.alb, df); o.emi = mix(far_.emi, o.emi, df); o.metal = mix(far_.metal, o.metal, df); o.rough = mix(far_.rough, o.rough, df); o.nT = normalize(mix(far_.nT, o.nT, df)); o.shadow = mix(1.0, o.shadow, df); }
      return o;
    }
  }

  // ---- on the glass plane: frames and glazing bars (anti-aliased)
  vec2 ww = w1 - w0;
  vec2 q = (g - w0) / max(ww, vec2(1e-3));
  float fw = frameW;
  float edge = min(min(g.x - w0.x, w1.x - g.x), min(g.y - w0.y, w1.y - g.y));
  float frame = 1.0 - smoothstep(fw - px * 0.5, fw + px * 0.5, edge);
  float mx = isShop > 0.5 ? 2.0 : s4.x;
  float my = isShop > 0.5 ? 1.0 : s4.y;
  if (mx > 1.5) frame = max(frame, aaLine((fract(q.x * mx + 0.5) - 0.5) * ww.x / mx, fw * 0.35, px));
  if (my > 1.5) frame = max(frame, aaLine((fract(q.y * my + 0.5) - 0.5) * ww.y / my, fw * 0.35, px));
  float sh = 1.0;
  if (gz > 0.005 && sunT.z < -1e-3) {
    float ts = gz / -sunT.z;
    vec2 e = g + sunT.xy * ts;
    sh = boxMask(e, w0, w1, 0.015 + ts * 0.02);
  }

  // ---- glass: reflection from the environment (standard BRDF), the room is emitted
  float rx = floor(uv.x / roomSpan);
  vec2 rid = vec2(rx, cell.y) + seed * 311.0;
  float rh = h12(rid);
  float idx;
  if (pool2 < 0.5) idx = floor(rh * 4.0);                    // offices 0..3
  else if (pool2 < 1.5) idx = 4.0 + floor(rh * 8.0);         // homes 4..11
  else if (pool2 < 2.5) idx = 4.0 + floor(rh * 12.0);        // lofts / mixed 4..15
  else idx = 12.0 + floor(rh * 4.0);                         // shops/lobbies 12..15
  float span = roomSpan * bayW;
  vec2 pRoom = vec2((mod(cell.x, roomSpan) * bayW + g.x) / span, g.y / cellH);
  vec3 rs = vec3(span, cellH, max(4.0, span * 0.9));
  vec3 rd = normalize(rdT);
  float lod = clamp(log2(px * 512.0 / span) + 0.5, 0.0, 6.0);
  float lit = step(h12(rid + 17.7), litP);
  vec3 day = room(uRoomsDay, pRoom, rd, rs, idx, lod);
  vec3 night = lit > 0.5 ? room(uRoomsNight, pRoom, rd, rs, idx, lod) : vec3(0.0);
  float warm = h12(rid + 3.3);
  vec3 lcol = pool2 < 0.5 ? mix(vec3(0.85, 0.93, 1.0), vec3(1.0, 0.95, 0.85), warm) : mix(vec3(1.0, 0.78, 0.52), vec3(1.0, 0.9, 0.75), warm);
  float bright = mix(0.6, 1.5, h12(rid + 9.1));
  vec3 interior = day * uInteriorDay + lit * night * lcol * bright * (uLitDay + 1.1 * uNight);
  interior += (1.0 - lit) * day * 0.012;
  if (pool2 > 2.5 && uLook > 0.5) interior *= mix(vec3(1.0), vec3(0.62, 0.5, 0.38), uNight);   // shops/lobbies at night: warm and not a white light box
  float bl = h12(rid + 5.5);
  vec2 qp = q;
  if (pool2 < 0.5 || pool2 > 2.5) {
    bool shopW = pool2 > 2.5;
    float cover = shopW ? (bl > 0.86 ? 1.0 : 0.0) : (bl > 0.55 ? (bl - 0.55) * 2.0 : 0.0);   // shops: a few roll-down gates, mostly open displays
    if (qp.y > 1.0 - cover) {
      float slat = mix(0.9, smoothstep(0.3, 0.7, fract(g.y / (shopW ? 0.09 : 0.06))), near_);
      vec3 bc = (shopW ? vec3(0.34, 0.35, 0.36) : vec3(0.78, 0.76, 0.72)) * (0.8 + 0.2 * slat);
      interior = bc * (0.28 * (1.0 - uNight) + uInteriorDay + lit * lcol * bright * (uLitDay + 1.0 * uNight));   // blinds catch daylight
    }
  } else {
    float cw = bl > 0.35 ? 0.12 + 0.25 * h12(rid + 8.8) : 0.0;
    float side = min(qp.x, 1.0 - qp.x);
    if (side < cw) {
      vec3 cc = 0.35 + 0.5 * cos(6.2831 * (h12(rid + 2.2) + vec3(0.0, 0.3, 0.6)));
      cc = mix(vec3(0.62, 0.57, 0.5), cc, 0.3);   // real curtains are mostly muted; saturated ones read as toy blocks
      float fold = 0.75 + 0.25 * sin(qp.x * 70.0) * near_;
      interior = cc * fold * (0.2 * (1.0 - uNight) + uInteriorDay + lit * lcol * bright * (uLitDay + 0.9 * uNight));
    }
  }
  vec3 gt = s5.xyz;
  float refl = s5.w;
  Fac n = o;
  n.alb = uLook > 0.5 ? glassF0(gt, refl) : gt;
  n.metal = uLook > 0.5 ? 1.0 : refl * 0.55;
  n.rough = 0.04 + 0.05 * h12(vec2(cell.x * 0.13, cell.y * 0.71) + seed);
  n.nT = vec3((h22(cell + seed) - 0.5) * 0.07, 1.0);
  n.rough = n.rough + 0.06 * h12(cell * 1.7 + seed);
  float transmit = mix(0.9, 0.45, refl);
  n.emi = interior * transmit * mix(vec3(1.0), gt * 2.2, curtain * 0.6);
  n.ao = 1.0;
  n.shadow = sh;
  // frame
  vec3 fcol = s3.xyz;
  n.alb = mix(n.alb, fcol, frame);
  n.rough = mix(n.rough, curtain > 0.5 ? 0.35 : 0.55, frame);
  n.metal = mix(n.metal, curtain > 0.5 ? 0.7 : 0.1, frame);
  n.emi *= 1.0 - frame;
  n.nT = normalize(mix(n.nT, vec3(0.0, 0.0, 1.0), frame));
  if (df < 0.999) {
    n.alb = mix(far_.alb, n.alb, df); n.emi = mix(far_.emi, n.emi, df); n.metal = mix(far_.metal, n.metal, df);
    n.rough = mix(far_.rough, n.rough, df); n.nT = normalize(mix(far_.nT, n.nT, df)); n.shadow = mix(1.0, n.shadow, df);
  }
  return n;
}
`;

function chain(mat, fn, key) {
  // run any hook already present (never CSM's: CityRenderer.addMaterial wraps CSM around us)
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(mat, shader, renderer);
    fn(shader, renderer);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => key + (prevKey ? prevKey() : '');
}

function addUniforms(shader, extra) {
  Object.assign(shader.uniforms, U, extra);
}

function vertexCommon(shader, extraDecl = '', extraMain = '') {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      varying vec3 vCityW;
      ${extraDecl}`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      ${VERT_WORLD}
      ${extraMain}`);
}

function fogReplace(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>',
    'gl_FragColor.rgb = cityOut(cityFog(cityOut(gl_FragColor.rgb), vCityW));');
}

/** Make any standard material part of the city: our fog, CSM chain, night uniforms. */
export function patchGeneric(mat, { nightEmissive = false } = {}) {
  if (mat.userData.__cityPatched) return mat;          // clones share materials: patch once
  mat.userData.__cityPatched = true;
  chain(mat, shader => {
    addUniforms(shader, {});
    vertexCommon(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_COMMON);
    if (nightEmissive) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance *= mix(0.06, 1.0, uNight);');
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse *= mix(0.35, 1.0, skyVis(vCityW + vec3(0.0, 0.2, 0.0), (vec4(normal, 0.0) * viewMatrix).xyz));`);
    fogReplace(shader);
  }, 'citygen2' + (nightEmissive ? 'N' : ''));
  mat.needsUpdate = true;
  return mat;
}

// tangent frame helper (view space) for vertical-ish faces
const TBN = /* glsl */`
  vec3 cN = normalize(vNormal);
  #ifdef DOUBLE_SIDED
    cN *= faceDirection;
  #endif
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 cT = cross(upV, cN);
  cT = length(cT) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(cT);
  vec3 cB = normalize(cross(cN, cT));
`;

export function facadeMaterial(tex, { cheap = false, roomAvg = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  m.name = cheap ? 'city_facade_cheap' : 'city_facade';
  if (cheap) m.defines = { CITY_CHEAP: 1 };
  const extra = {
    uFacAlb: { value: tex.facAlb }, uFacNrm: { value: tex.facNrm }, uStyles: { value: tex.styles },
    uRoomsDay: { value: tex.roomsDay }, uRoomsNight: { value: tex.roomsNight },
    uRoomAvgDay: { value: new THREE.Color(...(roomAvg?.day || [0.32, 0.29, 0.25])) }, uRoomAvgNight: { value: new THREE.Color(...(roomAvg?.night || [0.3, 0.28, 0.25])).multiplyScalar(1.6) },
  };
  chain(m, shader => {
    addUniforms(shader, extra);
    vertexCommon(shader, `
      #ifndef USE_UV1
        attribute vec2 uv1;
      #endif
      varying vec2 vFacUv; varying vec2 vFacUv1;`, `vFacUv = uv; vFacUv1 = uv1;`);
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + FACADE_FRAG_PARS + '\nFac cf = Fac(vec3(0.5), 0.8, 0.0, vec3(0.0, 0.0, 1.0), vec3(0.0), 1.0, 1.0);');
    fs = fs.replace('#include <map_fragment>', `
      ${TBN}
      vec3 cRd = normalize(-vViewPosition);
      vec3 rdT = vec3(dot(cRd, cT), dot(cRd, cB), -dot(cRd, cN));
      vec3 sunT = vec3(dot(uSunDirV, cT), dot(uSunDirV, cB), -dot(uSunDirV, cN));
      cf = facade(vFacUv, vFacUv1, rdT, sunT, vCityW.y, length(vViewPosition));
      if (bad3(cf.alb) || bad3(cf.nT) || bad3(cf.emi) || badF(cf.rough) || badF(cf.metal) || badF(cf.shadow) || badF(cf.ao)) {
        if (uDebug == 5) { cf.emi = vec3(4.0, 0.0, 4.0); } else { cf.emi = vec3(0.0); }
        cf.alb = vec3(0.32, 0.31, 0.3); cf.nT = vec3(0.0, 0.0, 1.0); cf.rough = 0.8; cf.metal = 0.0; cf.shadow = 1.0; cf.ao = 1.0;
      }
      if (uDebug == 1) { cf.emi = vec3(fract(vFacUv), fract(vFacUv1.x / 7.0)); cf.alb = vec3(0.0); }
      if (uDebug == 2) { cf.emi = texelFetch(uStyles, ivec2(0, int(mod(vFacUv1.x, 64.0) + 0.5)), 0).xyz / 5.0; cf.alb = vec3(0.0); }
      if (uDebug == 3) { cf.emi = cf.alb; cf.alb = vec3(0.0); }
      if (uDebug == 4) { cf.emi = vec3(cf.shadow, cf.ao, cf.rough); cf.alb = vec3(0.0); }
      diffuseColor.rgb = cf.alb;`);
    fs = fs.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(cf.rough, 0.075, 1.0);');
    fs = fs.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = cf.metal;');
    fs = fs.replace('#include <normal_fragment_maps>', `
      { vec3 nt = normalize(cf.nT); normal = normalize(cT * nt.x + cB * nt.y + cN * nt.z); if (bad3(normal)) normal = cN; }`);
    fs = fs.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = cf.emi;');
    fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.directDiffuse *= cf.shadow; reflectedLight.directSpecular *= cf.shadow;
      reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(16.0));
      { float sv = skyVis(vCityW, (vec4(cN, 0.0) * viewMatrix).xyz); cf.ao *= mix(0.4, 1.0, sv); }
      reflectedLight.indirectDiffuse *= cf.ao; reflectedLight.indirectSpecular *= mix(1.0, cf.ao, 0.6);
      // horizon occlusion: the environment is only the sky, but a low reflected ray in a city hits the buildings across
      // the street. Glass seen along a street mirrored bright sky (white lobby slabs, pale towers); fade that part of
      // the reflection towards a dim city colour, more so low on the building.
      if (uLook > 0.5) { vec3 rW = (vec4(reflect(normalize(-vViewPosition), normal), 0.0) * viewMatrix).xyz;
        float open_ = smoothstep(mix(0.55, 0.05, smoothstep(10.0, 220.0, vCityW.y)), 0.85, clamp(rW.y, -1.0, 1.0));
        reflectedLight.indirectSpecular *= mix(0.22, 1.0, open_); }`);
    shader.fragmentShader = fs;
    fogReplace(shader);
  }, 'city_facade_v2' + (cheap ? 'c' : ''));
  return m;
}

// ------------------------------------------------------------------------------------------
// DETAIL (roofs, cornices, parapets, clutter): vertex colour albedo + roughness in alpha
// ------------------------------------------------------------------------------------------
export function detailMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, vertexColors: true });
  m.name = 'city_detail';
  const extra = { uDetAlb: { value: tex.detAlb }, uDetNrm: { value: tex.detNrm } };
  chain(m, shader => {
    addUniforms(shader, extra);
    vertexCommon(shader, `
      #ifndef USE_UV1
        attribute vec2 uv1;
      #endif
      varying vec2 vDUv; varying vec2 vDUv1; varying vec3 vDN;`, `vDUv = uv; vDUv1 = uv1; vDN = normal;`);
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>
      ${GLSL_COMMON}
      precision highp sampler2DArray;
      uniform sampler2DArray uDetAlb, uDetNrm;
      varying vec2 vDUv; varying vec2 vDUv1; varying vec3 vDN;
      float dRough; vec3 dNT; float dMetal; float dAO; vec3 dEmi; vec3 dTv; vec3 dBv;`);
    fs = fs.replace('#include <color_fragment>', `
      {
        float kind = floor(vDUv1.x + 0.5);
        float seed = vDUv1.y;
        vec3 wn = normalize(vDN);
        // planar projection with a right-handed world frame (T x B = N), metres
        vec3 dTw = abs(wn.y) > 0.6 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), wn));
        vec3 dBw = abs(wn.y) > 0.6 ? vec3(0.0, 0.0, -sign(wn.y)) : vec3(0.0, 1.0, 0.0);
        vec2 p = vec2(dot(vCityW, dTw), dot(vCityW, dBw));
        dTv = normalize((viewMatrix * vec4(dTw, 0.0)).xyz); dBv = normalize((viewMatrix * vec4(dBw, 0.0)).xyz);
        float layer = kind < 0.5 ? 2.0 : (kind < 1.5 ? 0.0 : (kind < 2.5 ? 1.0 : (kind < 4.5 ? 2.0 : 3.0)));
        float sc = kind < 0.5 ? 2.5 : (kind < 2.5 ? 4.0 : 3.0);
        vec3 ta = texture(uDetAlb, vec3(p / sc, layer)).rgb;
        vec4 tn = texture(uDetNrm, vec3(p / sc, layer));
        float lum = dot(ta, vec3(0.3333));
        vec3 base = vColor.rgb;
        if (kind > 0.5 && kind < 2.5) base = vColor.rgb * ta / max(0.08, dot(ta, vec3(0.3333))) * 0.9;
        else base = vColor.rgb * mix(1.0, lum / 0.5, 0.45);
        base *= 0.85 + 0.3 * fbm3(p * 0.15 + seed * 30.0);
        diffuseColor.rgb = base;
        dRough = clamp(vColor.a * mix(0.85, 1.1, tn.b), 0.05, 1.0);
        dMetal = (kind > 2.5 && kind < 3.5) ? 0.6 : 0.0;
        dNT = vec3((tn.xy * 2.0 - 1.0) * 0.6, 1.0);
        dAO = mix(0.6, 1.0, tn.a);
        dEmi = kind > 6.5 ? vColor.rgb * (0.4 + 3.0 * uNight) : vec3(0.0);
        if (kind > 7.5) dEmi = vColor.rgb * (2.0 + 10.0 * uNight) * step(0.62, fract(uTime * 0.5 + seed * 13.0));   // aviation beacons blink
      }`);
    fs = fs.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = dRough;');
    fs = fs.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = dMetal;');
    fs = fs.replace('#include <normal_fragment_maps>', `
      { vec3 nt = normalize(dNT); normal = normalize(dTv * nt.x + dBv * nt.y + normal * nt.z); }`);
    fs = fs.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = dEmi;');
    fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse *= dAO * mix(0.3, 1.0, skyVis(vCityW, normalize(vDN)));`);
    shader.fragmentShader = fs;
    fogReplace(shader);
  }, 'city_detail_v1');
  return m;
}

// ------------------------------------------------------------------------------------------
// GROUND (roads, sidewalks, markings, grass, pavers, seawall, piers)
// ------------------------------------------------------------------------------------------
export function groundMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0 });
  m.name = 'city_ground';
  const extra = { uGrAlb: { value: tex.grAlb }, uGrNrm: { value: tex.grNrm } };
  chain(m, shader => {
    addUniforms(shader, extra);
    vertexCommon(shader, `
      #ifndef USE_UV1
        attribute vec2 uv1;
      #endif
      varying vec2 vGUv; varying vec2 vGUv1; varying vec3 vGN;`, `vGUv = uv; vGUv1 = uv1; vGN = normal;`);
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>
      ${GLSL_COMMON}
      precision highp sampler2DArray;
      uniform sampler2DArray uGrAlb, uGrNrm;
      varying vec2 vGUv; varying vec2 vGUv1; varying vec3 vGN;
      float gRough; vec3 gNT; float gAO; vec3 gEmi; vec3 gTv; vec3 gBv;`);
    fs = fs.replace('#include <map_fragment>', `
      {
        float s = floor(vGUv1.x + 0.5);
        vec2 w = vCityW.xz;
        bool vert = abs(vGN.y) < 0.5;
        vec3 gN0 = normalize(vGN);
        // vertical faces: project on the dominant axis (a per-pixel tangent made cliffs swim)
        vec3 gTw = vert ? (abs(gN0.x) > abs(gN0.z) ? vec3(0.0, 0.0, -sign(gN0.x)) : vec3(sign(gN0.z), 0.0, 0.0)) : vec3(1.0, 0.0, 0.0);
        vec3 gBw = vert ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, -1.0);
        vec2 p = vec2(dot(vCityW, gTw), dot(vCityW, gBw));
        gTv = normalize((viewMatrix * vec4(gTw, 0.0)).xyz); gBv = normalize((viewMatrix * vec4(gBw, 0.0)).xyz);
        float layer = 0.0; float sc = 4.0; vec3 tint = vec3(1.0);
        if (s < 0.5) { layer = 0.0; sc = 5.0; }
        else if (s < 1.5) { layer = 1.0; sc = 3.0; tint = vec3(1.02, 1.0, 0.97); }
        else if (s < 2.5) { layer = 1.0; sc = 2.0; tint = vec3(1.15); }
        else if (s < 4.5) { layer = 0.0; sc = 5.0; }
        else if (s < 5.5) { layer = 2.0; sc = 3.0; }
        else if (s < 6.5) { layer = 3.0; sc = 3.5; tint = vec3(0.95); }
        else if (s < 7.5) { layer = 5.0; sc = 3.0; tint = vec3(0.7, 0.72, 0.6); }
        else if (s < 8.5) { layer = 3.0; sc = 2.5; tint = vec3(0.9, 0.86, 0.82); }
        else if (s < 9.5) { layer = 3.0; sc = 2.0; tint = vec3(0.8); }
        else if (s < 10.5) { layer = 1.0; sc = 4.0; tint = vec3(0.75); }
        else if (s < 11.5) { layer = 6.0; sc = 4.0; tint = vec3(0.8, 0.75, 0.7); }
        else if (s < 12.5) { layer = 5.0; sc = 4.0; }
        else if (s < 13.5) { layer = 7.0; sc = 12.0; }
        else if (s > 19.5) { layer = 7.0; sc = 9.0; }
        else { layer = 5.0; sc = 4.0; tint = vec3(1.2, 1.1, 0.95); }
        vec3 a = texture(uGrAlb, vec3(p / sc, layer)).rgb * tint;
        vec4 n = texture(uGrNrm, vec3(p / sc, layer));
        float big = fbm3(w * 0.012);
        float mid = vnoise(w * 0.09);
        gRough = n.b; gNT = vec3((n.xy * 2.0 - 1.0), 1.0); gAO = mix(0.6, 1.0, n.a); gEmi = vec3(0.0);
        if (s < 0.5 || (s > 2.5 && s < 4.5)) {
          // asphalt: patches, oil in the lane centres, darker tyre tracks
          a *= 0.8 + 0.35 * big;
          float patchy = step(0.72, vnoise(w * 0.05 + 3.0));
          a = mix(a, a * 0.7, patchy * 0.8);
          gRough = mix(0.72, 0.95, n.b) - uWetness * 0.6;
        }
        if (s > 2.5 && s < 4.5) {
          // road paint: worn white / yellow
          vec3 pc = s < 3.5 ? vec3(0.85, 0.85, 0.82) : vec3(0.85, 0.65, 0.12);
          float wear = smoothstep(0.25, 0.7, vnoise(w * 1.7) * 0.6 + vnoise(w * 7.0) * 0.4);
          a = mix(a, pc, 0.25 + 0.75 * wear); gRough = 0.6;
        }
        if (s > 0.5 && s < 1.5) {
          // sidewalk slabs: joints every 1.5 m, a few darker slabs, gum spots
          vec2 q = w / 1.5; vec2 fq = abs(fract(q) - 0.5);
          float joint = 1.0 - smoothstep(0.47, 0.495, max(fq.x, fq.y));
          a *= 0.9 + 0.2 * h12(floor(q)); a *= mix(0.72, 1.0, joint);
          gNT.xy *= 0.6;
          if (max(fq.x, fq.y) > 0.485) gNT = vec3(0.0, 0.0, 1.0);
        }
        if (s > 4.5 && s < 5.5) { a *= vec3(0.85, 1.0, 0.8) * (0.75 + 0.45 * big) * (0.9 + 0.2 * mid); gRough = 0.95; }
        if (s > 19.5) {
          // natural terrain: grass on the flats, rock on the slopes and cliffs (slope blend)
          // grass only on genuinely flat ground, edge broken by noise (0.62..0.86 let interpolated
          // normals at the cliff lip paint green 'drips' down the rock face)
          float flat_ = smoothstep(0.8, 0.93, normalize(vGN).y + (fbm3(w * 0.05) - 0.5) * 0.12);
          vec3 grass = texture(uGrAlb, vec3(w / 3.2, 2.0)).rgb * vec3(0.7, 0.72, 0.52) * (0.7 + 0.5 * big);
          vec3 dirt = texture(uGrAlb, vec3(w / 4.0, 5.0)).rgb * 0.8;
          grass = mix(grass, dirt, smoothstep(0.55, 0.8, fbm3(w * 0.02)) * 0.6);
          vec3 rock = a * vec3(0.85, 0.82, 0.78) * (0.75 + 0.4 * mid);
          a = mix(rock, grass, flat_);
          gRough = mix(0.85, 0.95, flat_);
          gNT = mix(gNT, vec3(0.0, 0.0, 1.0), flat_ * 0.6);
        }
        if (s > 9.5 && s < 10.5) { a *= 0.75 + 0.3 * vnoise(vec2(vGUv.x * 0.3, vCityW.y * 2.0)); float wet = smoothstep(-1.2, -2.6, vCityW.y); a *= 1.0 - 0.45 * wet; a = mix(a, a * vec3(0.8, 0.95, 0.8), wet); }
        diffuseColor.rgb = a;
      }`);
    fs = fs.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;');
    fs = fs.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;');
    fs = fs.replace('#include <normal_fragment_maps>', `
      { vec3 nt = normalize(gNT); normal = normalize(gTv * nt.x + gBv * nt.y + normal * nt.z); }`);
    fs = fs.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = gEmi;');
    fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      { float sv = skyVis(vCityW + vec3(0.0, 0.3, 0.0), normalize(vGN)); reflectedLight.indirectDiffuse *= gAO * mix(0.45, 1.0, sv); reflectedLight.indirectSpecular *= mix(0.4, 1.0, sv); }`);
    shader.fragmentShader = fs;
    fogReplace(shader);
  }, 'city_ground_v1');
  return m;
}
