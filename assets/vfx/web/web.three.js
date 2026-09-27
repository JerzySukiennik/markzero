// Mark Zero NEXT — Spider-Man web VFX. three.js r186 reference implementation; the Godot 4.6
// port in this folder (web_fx.gd, web_line.gd, web_splat.gd + shaders) mirrors it.
// No build step, no dependency beyond 'three'.
//
// Jurek: "wygląd/feeling strzelania sieciami spider-mana jest słaby". The old line was a braided
// cable ("zwykla nitka"); he wants REAL webs — silk. So everything here is built from FIBRES:
//   * a line is a bright core wrapped in fine, irregular, twisted filaments that glint when you
//     look along them, dead straight when it carries weight and sagging the moment it does not;
//   * a shot is a spinning lumpy glob whipping spiral strands behind it;
//   * a hit STAMPS a radial web onto the surface: spokes, sagging scallops, a wet centre glob.
//
// Draw calls: one for every strand in flight (lines, trails, tracers, fibre bursts, rings), one
// for every sprite (flares, puffs), one per flying glob, one per live splat. Nothing in the
// per-frame path allocates; handles and splats are pooled.
import * as THREE from 'three';

// ------------------------------------------------------------------------------------ tuning
/** Every number that decides the look. Pass `look: {...}` to the constructor to override. */
export const LOOK = {
  // line: half widths in metres at the hand end and at the anchor end
  coreHW: [0.0034, 0.0017],
  fibreHW: [0.0015, 0.0009],
  braid: [0.0095, 0.005],       // radius of the fibre bundle around the core
  fibres: 7,
  coreA: 1.0, fibreA: 0.92, haloA: 0.07,
  coreGlow: 0.22, fibreGlow: 0.12, fibreBright: 0.62,
  minPxCore: 1.8, minPxFibre: 1.0, minPxHalo: 7.0,   // the halo is a fixed-pixel sheath, faded out near the camera
  // rope sim
  ropePoints: 28, ropeGravity: 9.0, ropeDamp: 0.985, ropeIter: 12,
  releaseFade: 0.6, snapFade: 0.65,
  // shots
  globRadius: 0.05,
  // splats
  splatSize: 0.68, splatLife: 20, splatFadeTail: 2.5,
};

/** The juice this module asks for, in one place (NOTES.md explains every number). */
export const JUICE = {
  shoot:      { fov: 1.5, rumble: { low: 0.08, high: 0.35, duration: 0.06 } },
  lineFire:   { fov: 2.0, rumble: { low: 0.05, high: 0.25, duration: 0.05 } },
  attach:     { shake: 0.10, rumble: { low: 0.32, high: 0.12, duration: 0.10 } },
  splatBody:  { hitstop: 0.05, shake: 0.22, rumble: { low: 0.50, high: 0.55, duration: 0.10 } },
  splatWall:  { rumble: { low: 0.0, high: 0.12, duration: 0.03 } },
  zipStart:   { fov: 7.0, shake: 0.18, rumble: { low: 0.55, high: 0.35, duration: 0.22 } },
  pull:       { hitstop: 0.06, shake: 0.30, fov: -1.5, rumble: { low: 0.80, high: 0.45, duration: 0.16 } },
  snap:       { shake: 0.28, rumble: { low: 0.30, high: 0.80, duration: 0.10 } },
  creak:      { rumble: { low: 0.0, high: 0.18, duration: 0.05 } },
  release:    { rumble: { low: 0.0, high: 0.10, duration: 0.03 } },
};

// ------------------------------------------------------------------------------------ utils
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
/** Smooth 1D value noise, -1..1. Used for fibre irregularity along a strand. */
function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash1(i), hash1(i + 1), u) * 2 - 1; }

const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4();
const _UP = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);
const _size = new THREE.Vector2();

/** Upload only the used part of a dynamic attribute. */
function upd(a, count) { a.clearUpdateRanges(); a.addUpdateRange(0, count); a.needsUpdate = true; }
/** Any unit vector perpendicular to (x,y,z) (normalised input). Writes into out. */
function perpOf(x, y, z, out) {
  // cross with world up, or with X when the direction is near vertical
  let px, py, pz;
  if (Math.abs(y) < 0.95) { px = -z; py = 0; pz = x; } else { px = 0; py = z; pz = -y; }
  const l = Math.hypot(px, py, pz) || 1;
  return out.set(px / l, py / l, pz / l);
}

// ------------------------------------------------------------------------------------ GLSL
// Silk: a fibre is a thin cylinder, so it is lit with Kajiya-Kay (tangent-based) diffuse and
// specular. On top: a pearly thin-film tint on the highlight, and discrete glints along the
// fibre that flare up when the view runs along the line (silk forward-scatters).
const GLSL_COMMON = /* glsl */`
uniform vec3 uLightDir; uniform vec3 uLightCol; uniform vec3 uAmb; uniform vec3 uSilk; uniform float uTime;
float wh11(float x){ return fract(sin(x*127.1 + 311.7)*43758.5453); }
vec3 silkShade(vec3 T, vec3 V, vec3 L, float s, float bright, float arc, float seed){
  float TL = dot(T, L);
  vec3 H = normalize(L + V);
  float TH = dot(T, H);
  float sinTL = sqrt(max(0.0, 1.0 - TL*TL));
  float sinTH = sqrt(max(0.0, 1.0 - TH*TH));
  float cyl = sqrt(max(0.0, 1.0 - s*s));
  // kept just under a typical bloom threshold (~0.9): silk is bright, not neon — only the
  // specular band and the glints are allowed to bloom
  vec3 base = uSilk * (uAmb + uLightCol * (0.20 + 0.46*sinTL));
  base *= (0.74 + 0.26*cyl) * (1.0 + bright*cyl*cyl*0.18);
  float spec = pow(sinTH, 110.0)*1.2 + pow(sinTH, 14.0)*0.10;
  vec3 irid = 0.5 + 0.5*cos(6.2831*(TH*1.4 + seed*0.37 + vec3(0.0, 0.33, 0.67)));
  vec3 hi = mix(vec3(1.0), irid, 0.5) * spec * uLightCol;
  float along = abs(dot(T, V));
  float cell = floor(arc*34.0 + seed*97.0);
  // glints live on the loose fibres, not on the core (on the core they read as beads)
  float g = step(0.955, wh11(cell)) * pow(sinTH, 30.0) * step(bright, 0.9) * step(0.0, bright);
  float tw = 0.55 + 0.45*sin(uTime*21.0 + cell*1.93);
  vec3 glint = vec3(1.0, 0.98, 0.95) * g * tw * (0.3 + 1.1*smoothstep(0.5, 0.97, along)) * cyl;
  vec3 col = base + hi + glint;
  col *= 1.0 + 0.30*smoothstep(0.75, 1.0, along);
  return col;
}
// A wet, slightly translucent glob of web fluid: wrap diffuse, cool "subsurface" in shadow,
// light bleeding through the thin rim, a tight glossy highlight and a fresnel sheen.
vec3 globShade(vec3 N, vec3 V, vec3 L, float cavity){
  float ndl = dot(N, L);
  float wrap = clamp((ndl + 0.55)/1.55, 0.0, 1.0);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  vec3 H = normalize(L + V);
  float ndh = clamp(dot(N, H), 0.0, 1.0);
  float spec = pow(ndh, 140.0)*3.0 + pow(ndh, 22.0)*0.22;
  float trans = pow(clamp(dot(V, -L), 0.0, 1.0), 4.0) * (0.35 + 0.65*fres);
  vec3 sss = mix(vec3(0.60, 0.68, 0.84), vec3(1.0), wrap);
  vec3 col = uSilk * sss * (uAmb*1.0 + uLightCol*wrap*0.68) * (0.80 + 0.20*cavity);
  col += uLightCol * (trans*0.45 + spec);
  col += vec3(0.88, 0.94, 1.0) * fres * 0.35;
  return col;
}
// Premultiplied output: glow 0 = ordinary "over", glow 1 = purely additive, in one pass.
vec4 premulOut(vec3 col, float a, float glow){
  vec3 c = col;
  #ifdef TONE_MAPPING
  c = toneMapping(c);
  #endif
  c = linearToOutputTexel(vec4(c, 1.0)).rgb;
  return vec4(c * a, a * (1.0 - glow));
}
`;

// Camera-facing expansion with a minimum screen width: a 4 mm strand is 0.04 px at 60 m, so
// below `minPx` the ribbon is held at minPx wide and its alpha drops by the coverage it lost,
// never below `floorA` — which is what keeps a far web a crisp line instead of nothing.
const GLSL_EXPAND = /* glsl */`
uniform vec2 uRes;
varying float vPxW;   // ribbon width in pixels: thin ribbons get a flat profile (no dashing)
void strandExpand(inout vec3 wpos, vec3 tw, float side, float hw, float minPx, float floorA, bool pxMode, inout float alpha){
  vec3 toC = cameraPosition - wpos;
  float dist = max(length(toC), 1e-5);
  vec3 sd = cross(tw, toC / dist);
  float sl = length(sd);
  sd = sl > 1e-4 ? sd / sl : vec3(0.0, 1.0, 0.0);
  float depth = max(-(viewMatrix * vec4(wpos, 1.0)).z, 1e-3);
  float px = 2.0 * (isOrthographic ? 1.0 : depth) / (projectionMatrix[1][1] * uRes.y);
  float minHw = 0.5 * minPx * px;
  if (pxMode) { hw = minHw; alpha *= smoothstep(1.5, 7.0, dist); }
  else if (hw < minHw) { alpha *= max(hw / minHw, floorA); hw = minHw; }
  alpha *= smoothstep(0.04, 0.18, dist);
  vPxW = 2.0 * hw / px;
  wpos += sd * side * hw;
}
`;

const STRAND_VS = /* glsl */`
attribute vec3 aTan; attribute vec4 aA; attribute vec4 aB;
varying vec4 vA; varying vec4 vB; varying vec3 vT; varying vec3 vW;
${GLSL_EXPAND}
void main(){
  vec3 w = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 t = normalize(mat3(modelMatrix) * aTan);
  float alpha = aA.z;
  strandExpand(w, t, aA.x, aA.w, aB.w, aB.x*aB.x*0.7, aB.y > 0.99, alpha);
  vA = vec4(aA.x, aA.y, alpha, 0.0); vB = aB; vT = t; vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const STRAND_FS = /* glsl */`
varying vec4 vA; varying vec4 vB; varying vec3 vT; varying vec3 vW; varying float vPxW;
${GLSL_COMMON}
void main(){
  float s = vA.x;
  float prof = clamp(1.0 - s*s, 0.0, 1.0);
  prof = vB.y > 0.99 ? prof*prof*prof : prof*prof;
  // a ribbon only 1-2 px wide cannot show a profile: sampled at pixel centres it would
  // flicker between bright and dim along its length (dashes). Flatten it instead.
  prof = mix(0.75, prof, smoothstep(1.6, 4.0, vPxW));
  float a = vA.z * prof;
  if (a < 0.002) discard;
  vec3 T = normalize(vT);
  vec3 V = normalize(cameraPosition - vW);
  vec3 col = silkShade(T, V, normalize(uLightDir), s, vB.x, vA.y, vB.z);
  gl_FragColor = premulOut(col, a, vB.y);
}`;

const SPRITE_VS = /* glsl */`
attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iPar;
varying vec2 vUv; varying vec4 vCol; varying vec2 vK;
void main(){
  vec4 vp = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iPar.y), s = sin(iPar.y);
  vec2 q = vec2(c*position.x - s*position.y, s*position.x + c*position.y);
  vp.xy += q * iPar.x;
  gl_Position = projectionMatrix * vp;
  vUv = position.xy; vCol = iCol; vK = iPar.zw;
}`;
const SPRITE_FS = /* glsl */`
varying vec2 vUv; varying vec4 vCol; varying vec2 vK;
${GLSL_COMMON}
void main(){
  float r2 = dot(vUv, vUv);
  float a;
  if (vK.x < 0.5) {            // glow
    a = exp(-r2*7.0) + 0.35*exp(-r2*45.0);
  } else if (vK.x < 1.5) {     // puff: lumpy soft disc
    float ang = atan(vUv.y, vUv.x);
    float lump = 0.75 + 0.25*sin(ang*5.0 + vCol.a*9.0) * sin(ang*3.0 - 1.7);
    a = smoothstep(1.0, 0.25, sqrt(r2) / lump) * 0.8;
  } else {                     // star flare: glow + two thin spikes
    vec2 u = abs(vUv);
    a = exp(-r2*10.0) + 0.8*exp(-u.x*28.0)*exp(-u.y*2.2) + 0.8*exp(-u.y*28.0)*exp(-u.x*2.2);
  }
  a *= clamp(vCol.a, 0.0, 1.0) * step(r2, 1.0);
  if (a < 0.002) discard;
  gl_FragColor = premulOut(vCol.rgb, a, vK.y);
}`;

const GLOB_VS = /* glsl */`
attribute float aCav;
varying vec3 vN; varying vec3 vV; varying float vCav;
void main(){
  vec4 vp = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-vp.xyz); vCav = aCav;
  gl_Position = projectionMatrix * vp;
}`;
const GLOB_FS = /* glsl */`
varying vec3 vN; varying vec3 vV; varying float vCav;
${GLSL_COMMON}
void main(){
  vec3 L = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
  vec3 col = globShade(normalize(vN), normalize(vV), L, vCav) + 0.10;
  gl_FragColor = premulOut(col, 1.0, 0.0);
}`;

// The splat: ONE mesh, ONE draw call, four kinds of primitive told apart by aB.y:
//   0 strand (camera-facing, like the line), 1 contact shadow, 2 wet glob, 3 web film.
// Vertices are authored in splat space (+Y = surface normal); the burst, the membrane bounce
// and the dissolve all happen here, driven by uAge / uFade.
const SPLAT_VS = /* glsl */`
uniform float uAge; uniform float uFade;
attribute vec3 aTan; attribute vec4 aA; attribute vec4 aB;
varying vec4 vA; varying vec4 vB; varying vec3 vT; varying vec3 vW;
${GLSL_EXPAND}
void main(){
  float kind = aB.y;
  float t = max(uAge - aB.z*0.035, 0.0);
  float g = 1.0 - exp(-t*24.0)*cos(t*30.0);             // burst: ~50 ms out, ~9 % overshoot
  float bounce = 1.0 + 0.9*exp(-uAge*7.0)*sin(uAge*38.0 + aB.w*6.0);
  vec3 p = position;
  p.xz *= g;
  p.y *= (kind > 1.5 && kind < 2.5) ? g * (1.0 + 0.35*exp(-uAge*9.0)*sin(uAge*40.0)) : bounce * min(g, 1.0);
  vec3 w = (modelMatrix * vec4(p, 1.0)).xyz;
  vec3 t3 = normalize(mat3(modelMatrix) * aTan);
  float alpha = aA.z;
  // dissolve: every strand has its own moment to vanish while the splat fades
  alpha *= smoothstep(aB.w*0.7, aB.w*0.7 + 0.3, uFade);
  // far away the strands go sub-pixel, so the floors are high and the film fills in: at 20 m a
  // splat must still read as a white web patch, not as a faint asterisk
  float camD = length(cameraPosition - w);
  vPxW = 4.0;
  if (kind < 0.5) strandExpand(w, t3, aA.x, aA.w, 1.4, aB.x > 0.0 ? 0.25 + 0.4*aB.x : 0.0, false, alpha);
  else if (kind > 2.5) alpha *= mix(1.0, 2.2, smoothstep(5.0, 25.0, camD));
  vec4 vp = viewMatrix * vec4(w, 1.0);
  vp.xyz *= 0.9985;       // depth bias toward the eye: same pixel, no z-fighting with the wall
  gl_Position = projectionMatrix * vp;
  vA = vec4(aA.x, aA.y, alpha, 0.0); vB = aB; vT = t3; vW = w;
}`;
const SPLAT_FS = /* glsl */`
uniform float uAge; uniform float uFade;
varying vec4 vA; varying vec4 vB; varying vec3 vT; varying vec3 vW; varying float vPxW;
${GLSL_COMMON}
float vn1c(float u, float K){ float x = u*K; float i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(wh11(mod(i, K)), wh11(mod(i + 1.0, K)), f); }
void main(){
  float kind = vB.y;
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = normalize(uLightDir);
  float flash = 1.0 + 1.0*exp(-uAge*25.0);
  vec3 col; float a; float glow = 0.0;
  if (kind < 0.5 && vB.x < -0.5) {          // the strand's own soft shadow on the surface
    float s = vA.x;
    a = vA.z * mix(0.7, clamp(1.0 - s*s, 0.0, 1.0), smoothstep(1.6, 4.0, vPxW)) * 0.42 * uFade;
    col = vec3(0.0);
  } else if (kind < 0.5) {
    float s = vA.x;
    float prof = clamp(1.0 - s*s, 0.0, 1.0);
    a = vA.z * mix(0.75, prof * prof, smoothstep(1.6, 4.0, vPxW));
    col = silkShade(normalize(vT), V, L, s, vB.x, vA.y, vB.w) * flash;
    glow = 0.10;
  } else if (kind < 1.5) {
    float r = length(vA.xy);
    a = 0.5 * exp(-r*r*3.4) * vA.z * uFade;
    col = vec3(0.0);
  } else if (kind < 2.5) {
    if (!gl_FrontFacing) discard;          // no depth write: cull the far side of the glob by hand
    a = vA.z * uFade;
    col = globShade(normalize(vT), V, L, vA.y) * flash + 0.08;
  } else {
    float r = length(vA.xy);
    float ang = atan(vA.y, vA.x) / 6.2831 + 0.5;
    float st = vn1c(ang, 23.0)*0.55 + vn1c(ang, 61.0)*0.45;   // purely radial streaks
    st = smoothstep(0.45, 0.95, st);
    a = vA.z * smoothstep(1.0, 0.25, r) * (0.10 + 0.90*st) * uFade;
    float ndl = clamp(dot(normalize(vT), L)*0.5 + 0.5, 0.0, 1.0);
    col = uSilk * (uAmb + uLightCol*(0.35 + 0.65*ndl)) * (0.85 + 0.5*st) * flash;
  }
  if (a < 0.002) discard;
  gl_FragColor = premulOut(col, a, glow);
}`;

function premulBlend(m) {
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  m.transparent = true; m.depthWrite = false; m.depthTest = true;
  return m;
}

// ------------------------------------------------------------------------------------ meshes
/** Indexed icosphere (subdivided icosahedron) — also generated identically in web_fx.gd. */
export function icosphere(detail) {
  const t = (1 + Math.sqrt(5)) / 2;
  const pos = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  let idx = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let i = 0; i < pos.length; i += 3) { const l = Math.hypot(pos[i], pos[i + 1], pos[i + 2]); pos[i] /= l; pos[i + 1] /= l; pos[i + 2] /= l; }
  for (let d = 0; d < detail; d++) {
    const cache = new Map(), next = [];
    const mid = (a, b) => {
      const k = a < b ? a * 100000 + b : b * 100000 + a;
      let m = cache.get(k); if (m !== undefined) return m;
      let x = pos[a * 3] + pos[b * 3], y = pos[a * 3 + 1] + pos[b * 3 + 1], z = pos[a * 3 + 2] + pos[b * 3 + 2];
      const l = Math.hypot(x, y, z); m = pos.length / 3; pos.push(x / l, y / l, z / l); cache.set(k, m); return m;
    };
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2], ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    idx = next;
  }
  return { pos, idx };
}
/** A few random-direction sine waves: smooth, deterministic, cheap, portable. */
function lumpField(seed, waves = 6) {
  const r = mulberry32(seed), w = [];
  for (let i = 0; i < waves; i++) {
    const z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - z * z);
    w.push(Math.cos(a) * s, Math.sin(a) * s, z, 1.3 + r() * 2.6, r() * TAU, (0.55 + r() * 0.45) / (1 + i * 0.35));
  }
  return (x, y, z) => { let v = 0, n = 0; for (let i = 0; i < w.length; i += 6) { v += w[i + 5] * Math.sin((w[i] * x + w[i + 1] * y + w[i + 2] * z) * w[i + 3] + w[i + 4]); n += w[i + 5]; } return v / n; };
}
/** Lumpy glob geometry. Radius 1; amplitude of lumps `amp`; attribute aCav = 0 in crevices, 1 on bumps. */
export function lumpyGlob(detail, amp, seed) {
  const { pos, idx } = icosphere(detail);
  const f = lumpField(seed), n = pos.length / 3, cav = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], l = f(x, y, z);
    const r = 1 + amp * l; pos[i * 3] = x * r; pos[i * 3 + 1] = y * r; pos[i * 3 + 2] = z * r; cav[i] = clamp(0.5 + l * 1.4, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCav', new THREE.BufferAttribute(cav, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------------------------ strand batch
/**
 * Every camera-facing strand drawn this frame, in one dynamic geometry and one draw call.
 * Protocol: begin(); { start(bright, glow, minPx, seed); pt(x,y,z, halfWidth, alpha)...; end(); }* finish().
 * Two vertices per point share the centre; the vertex shader pushes them apart toward the camera.
 *   aA = (side ±1, arc length m, alpha, half width m)   aB = (bright 0..1, glow 0..1, seed, minPx)
 */
class StrandBatch {
  constructor(fx, max) {
    this.max = max;
    this.P = new Float32Array(max * 3); this.T = new Float32Array(max * 3);
    this.A = new Float32Array(max * 4); this.B = new Float32Array(max * 4);
    this.I = new Uint32Array(max * 3);
    const g = this.geo = new THREE.BufferGeometry();
    const mk = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aP = mk(this.P, 3));
    g.setAttribute('aTan', this.aT = mk(this.T, 3));
    g.setAttribute('aA', this.aA = mk(this.A, 4));
    g.setAttribute('aB', this.aB = mk(this.B, 4));
    g.setIndex(this.aI = mk(this.I, 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.mat = premulBlend(new THREE.ShaderMaterial({ name: 'WebFX.strand', uniforms: fx.U, vertexShader: STRAND_VS, fragmentShader: STRAND_FS, side: THREE.DoubleSide }));
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'WebFX.strands'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 20;
    this.mesh.onBeforeRender = fx._resHook;
    fx.root.add(this.mesh);
    this.n = 0; this.ni = 0; this.s0 = 0; this.arc = 0; this.first = true;
    this.lx = 0; this.ly = 0; this.lz = 0; this.b0 = 1; this.b1 = 0; this.b2 = 0; this.b3 = 1; this.full = false;
  }
  begin() { this.n = 0; this.ni = 0; this.full = false; }
  start(bright, glow, minPx, seed) { this.s0 = this.n; this.arc = 0; this.first = true; this.b0 = bright; this.b1 = glow; this.b2 = seed; this.b3 = minPx; }
  pt(x, y, z, hw, alpha) {
    if (this.n + 2 > this.max) { this.full = true; return; }
    if (!this.first) { const dx = x - this.lx, dy = y - this.ly, dz = z - this.lz; this.arc += Math.sqrt(dx * dx + dy * dy + dz * dz); }
    this.first = false; this.lx = x; this.ly = y; this.lz = z;
    const P = this.P, A = this.A, B = this.B;
    for (let k = 0; k < 2; k++) {
      const v = this.n + k, i3 = v * 3, i4 = v * 4;
      P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z;
      A[i4] = k ? 1 : -1; A[i4 + 1] = this.arc; A[i4 + 2] = alpha; A[i4 + 3] = hw;
      B[i4] = this.b0; B[i4 + 1] = this.b1; B[i4 + 2] = this.b2; B[i4 + 3] = this.b3;
    }
    this.n += 2;
  }
  end() {
    const s0 = this.s0, cnt = (this.n - s0) >> 1;
    if (cnt < 2) { this.n = s0; return; }
    if (this.ni + (cnt - 1) * 6 > this.I.length) { this.n = s0; this.full = true; return; }
    const P = this.P, T = this.T, I = this.I;
    for (let j = 0; j < cnt; j++) {
      const a = (s0 + 2 * Math.max(j - 1, 0)) * 3, b = (s0 + 2 * Math.min(j + 1, cnt - 1)) * 3;
      let tx = P[b] - P[a], ty = P[b + 1] - P[a + 1], tz = P[b + 2] - P[a + 2];
      let l = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (l < 1e-9) { tx = 0; ty = 1; tz = 0; l = 1; }
      tx /= l; ty /= l; tz /= l;
      const v = (s0 + 2 * j) * 3;
      T[v] = tx; T[v + 1] = ty; T[v + 2] = tz; T[v + 3] = tx; T[v + 4] = ty; T[v + 5] = tz;
    }
    let ni = this.ni;
    for (let j = 0; j < cnt - 1; j++) {
      const v = s0 + 2 * j;
      I[ni++] = v; I[ni++] = v + 1; I[ni++] = v + 2; I[ni++] = v + 1; I[ni++] = v + 3; I[ni++] = v + 2;
    }
    this.ni = ni;
  }
  finish() {
    const n = this.n;
    if (n > 0) {
      upd(this.aP, n * 3); upd(this.aT, n * 3); upd(this.aA, n * 4); upd(this.aB, n * 4); upd(this.aI, this.ni);
    }
    this.geo.setDrawRange(0, this.ni);
    this.mesh.visible = this.ni > 0;
  }
}

// ------------------------------------------------------------------------------------ sprites
/** Instanced camera-facing quads: flares, puffs. Simulated particles + one-frame "immediate" quads. */
class SpriteBatch {
  constructor(fx, max) {
    this.max = max;
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = n => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos = mk(3)); g.setAttribute('iCol', this.iCol = mk(4)); g.setAttribute('iPar', this.iPar = mk(4));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.mat = premulBlend(new THREE.ShaderMaterial({ name: 'WebFX.sprite', uniforms: fx.U, vertexShader: SPRITE_VS, fragmentShader: SPRITE_FS }));
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'WebFX.sprites'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 21;
    fx.root.add(this.mesh);
    this.parts = Array.from({ length: max }, () => ({ live: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 1, s0: 0.1, s1: 0.2, a0: 1, kind: 0, add: 1, r: 1, g: 1, b: 1, rot: 0, rv: 0, drag: 0 }));
    this.n = 0; this._next = 0;
  }
  spawn(p, vx, vy, vz, life, s0, s1, a0, kind, add, r = 1, g = 1, b = 1, rot = 0, rv = 0, drag = 0) {
    let q = null;
    for (let i = 0; i < this.max; i++) { const c = this.parts[(this._next + i) % this.max]; if (!c.live) { q = c; this._next = (this._next + i + 1) % this.max; break; } }
    if (!q) { q = this.parts[this._next]; this._next = (this._next + 1) % this.max; }
    q.live = true; q.p.copy(p); q.v.set(vx, vy, vz); q.age = 0; q.life = life; q.s0 = s0; q.s1 = s1; q.a0 = a0;
    q.kind = kind; q.add = add; q.r = r; q.g = g; q.b = b; q.rot = rot; q.rv = rv; q.drag = drag;
  }
  update(dt) {
    this.n = 0;
    for (const q of this.parts) {
      if (!q.live) continue;
      q.age += dt;
      if (q.age >= q.life) { q.live = false; continue; }
      if (q.drag) q.v.multiplyScalar(Math.exp(-q.drag * dt));
      q.p.addScaledVector(q.v, dt); q.rot += q.rv * dt;
      const k = q.age / q.life, e = 1 - (1 - k) * (1 - k);
      this.quad(q.p.x, q.p.y, q.p.z, lerp(q.s0, q.s1, e), q.rot, q.a0 * (1 - k) * (1 - k), q.kind, q.add, q.r, q.g, q.b);
    }
  }
  quad(x, y, z, size, rot, alpha, kind, add, r = 1, g = 1, b = 1) {
    if (this.n >= this.max) return;
    const i = this.n++, P = this.iPos.array, C = this.iCol.array, R = this.iPar.array;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    C[i * 4] = r; C[i * 4 + 1] = g; C[i * 4 + 2] = b; C[i * 4 + 3] = alpha;
    R[i * 4] = size; R[i * 4 + 1] = rot; R[i * 4 + 2] = kind; R[i * 4 + 3] = add;
  }
  finish() {
    const n = this.n;
    if (n) { upd(this.iPos, n * 3); upd(this.iCol, n * 4); upd(this.iPar, n * 4); }
    this.geo.instanceCount = n; this.mesh.visible = n > 0;
  }
}

// ------------------------------------------------------------------------------------ fibres
/** Short loose strands with physics: muzzle bursts, impact spray, snap debris, speed lines. */
class FibrePool {
  constructor(max) {
    this.max = max; this._next = 0;
    this.parts = Array.from({ length: max }, () => ({ live: false, p: new THREE.Vector3(), v: new THREE.Vector3(), d: new THREE.Vector3(0, 1, 0), age: 0, life: 0.2, len: 0.2, hw: 0.001, a0: 1, curl: 0, seed: 0, drag: 0, grav: 0, bright: 0.5, glow: 0.3, grow: 0.05 }));
  }
  spawn(p, v, life, len, hw, a0, { curl = 0.02, seed = 0, drag = 4, grav = 2, bright = 0.55, glow = 0.3, grow = 0.05 } = {}) {
    let q = null;
    for (let i = 0; i < this.max; i++) { const c = this.parts[(this._next + i) % this.max]; if (!c.live) { q = c; this._next = (this._next + i + 1) % this.max; break; } }
    if (!q) { q = this.parts[this._next]; this._next = (this._next + 1) % this.max; }
    q.live = true; q.p.copy(p); q.v.copy(v); q.age = 0; q.life = life; q.len = len; q.hw = hw; q.a0 = a0;
    q.curl = curl; q.seed = seed; q.drag = drag; q.grav = grav; q.bright = bright; q.glow = glow; q.grow = grow;
    const l = v.length(); if (l > 1e-4) q.d.copy(v).multiplyScalar(1 / l);
  }
  update(dt) {
    for (const q of this.parts) {
      if (!q.live) continue;
      q.age += dt; if (q.age >= q.life) { q.live = false; continue; }
      q.v.multiplyScalar(Math.exp(-q.drag * dt)); q.v.y -= q.grav * dt;
      q.p.addScaledVector(q.v, dt);
      const l = q.v.length(); if (l > 0.3) q.d.lerp(_v0.copy(q.v).multiplyScalar(1 / l), clamp(dt * 20, 0, 1)).normalize();
    }
  }
  draw(batch) {
    for (const q of this.parts) {
      if (!q.live) continue;
      const k = q.age / q.life, a = q.a0 * (1 - k) * (1 - k * 0.5);
      const len = q.len * smooth(0, q.grow, q.age + 1e-4);
      const px = perpOf(q.d.x, q.d.y, q.d.z, _v1);
      batch.start(q.bright, q.glow, 1.0, q.seed);
      for (let j = 0; j < 5; j++) {
        const u = j / 4, c = Math.sin(u * Math.PI * 1.5 + q.seed * 7) * q.curl * u;
        batch.pt(q.p.x - q.d.x * len * u + px.x * c, q.p.y - q.d.y * len * u + px.y * c, q.p.z - q.d.z * len * u + px.z * c,
          q.hw * (1 - 0.6 * u), a * (1 - u * 0.7));
      }
      batch.end();
    }
  }
}

// ------------------------------------------------------------------------------------ line
// scratch for line rendering (lines render one at a time)
const MAXS = 128;
const SX = new Float32Array(MAXS), SY = new Float32Array(MAXS), SZ = new Float32Array(MAXS);
const TX = new Float32Array(MAXS), TY = new Float32Array(MAXS), TZ = new Float32Array(MAXS);
const NX = new Float32Array(MAXS), NY = new Float32Array(MAXS), NZ = new Float32Array(MAXS);
const BX = new Float32Array(MAXS), BY = new Float32Array(MAXS), BZ = new Float32Array(MAXS);
const ARC = new Float32Array(MAXS), SU = new Float32Array(MAXS);

/**
 * One web line (tether). A verlet rope of `ropePoints` points between the wrist and the
 * anchor; drawn as core + braided fibres + halo. States: 'flying' → 'attached' → 'released' → 'dead'.
 */
export class WebLine {
  constructor(fx, { from, to, travelSpeed = 320, kind = 'swing', normal = null, onAttach = null, silent = false }) {
    this.fx = fx; this.kind = kind; this.state = 'flying'; this.reach = 0; this.tension = 0;
    this.travelSpeed = travelSpeed; this.onAttach = onAttach; this.silent = silent;
    this.from = from; this.toObj = null; this.toLocal = new THREE.Vector3(); this.toPoint = new THREE.Vector3();
    if (to && to.isObject3D) { this.toObj = to; }
    else if (to && to.object) { this.toObj = to.object; this.toLocal.copy(to.local || _v0.set(0, 0, 0)); }
    else if (to) this.toPoint.copy(to);
    this.normal = normal ? normal.clone() : null;
    const N = this.N = fx.look.ropePoints;
    this.p = new Float32Array(N * 3); this.o = new Float32Array(N * 3);
    this.hand = new THREE.Vector3(); this.anchor = new THREE.Vector3();
    this.handPrev = new THREE.Vector3(); this.anchorPrev = new THREE.Vector3();
    this.retractFrom = new THREE.Vector3();
    this._rest = 0; this._restSet = false;
    this.age = 0; this.stateAge = 0; this.twang = 0; this.thrum = 0; this._prevT = 0; this._low = 1; this._creakCool = 0;
    this.snapped = false; this.breakAt = -1; this.segScale = 1; this.pinHand = true; this.pinAnchor = true;
    this.mode = 'normal'; this.fade = 1;
    const r = fx.rand;
    this.seed = r() * 100;
    const F = fx.look.fibres;
    this.fib = new Float32Array(F * 5);
    for (let f = 0; f < F; f++) {
      this.fib[f * 5] = (f / F) * TAU + (r() - 0.5) * 0.7;      // phase
      this.fib[f * 5 + 1] = 0.45 + 0.55 * r();                  // radius factor
      this.fib[f * 5 + 2] = r() < 0.35 ? r() : -1;              // stray loop position (0..1 of length) or none
      this.fib[f * 5 + 3] = 2.5 + r() * 3.0;                    // loop size (x braid)
      this.fib[f * 5 + 4] = r() * 0.55;                         // dissolve offset
    }
    this._resolve(); this.handPrev.copy(this.hand); this.anchorPrev.copy(this.anchor);
    for (let i = 0; i < N; i++) { this.p[i * 3] = this.o[i * 3] = this.hand.x; this.p[i * 3 + 1] = this.o[i * 3 + 1] = this.hand.y; this.p[i * 3 + 2] = this.o[i * 3 + 2] = this.hand.z; }
    this.tip = fx.globs.take('tip');
  }
  get restLength() { return this._rest; }
  set restLength(v) { this._rest = Math.max(0.05, v); this._restSet = true; }
  get alive() { return this.state !== 'dead'; }

  _resolve() {
    if (this.pinHand && this.from) {
      if (this.from.isObject3D) this.from.getWorldPosition(this.hand); else this.hand.copy(this.from);
    }
    if (this.mode === 'retract') return;
    if (this.toObj) { this.toObj.updateWorldMatrix(true, false); this.anchor.copy(this.toLocal).applyMatrix4(this.toObj.matrixWorld); }
    else this.anchor.copy(this.toPoint);
  }

  /** Detach at the hand: the line goes slack, wobbles, falls away and dissolves. */
  release() {
    if (this.state === 'dead' || this.state === 'released') return;
    const wasFlying = this.state === 'flying';
    this.state = 'released'; this.stateAge = 0; this.pinHand = false; this.fade = this.fx.look.releaseFade;
    if (wasFlying) { this.pinAnchor = false; this._rest = this._segLenTotal(); }
    // a flick at the free end so it visibly lets go instead of just drooping
    const r = this.fx.rand, j = 0;
    const kx = (r() - 0.5) * 3, ky = 1.5 + r() * 1.5, kz = (r() - 0.5) * 3;
    for (let i = 0; i < 4; i++) { const w = (4 - i) / 4 / 120; this.o[i * 3] -= kx * w; this.o[i * 3 + 1] -= ky * w; this.o[i * 3 + 2] -= kz * w; }
    this._freeTip();
    if (!this.silent) { this.fx._sound('sp_web_release', this.hand, 0.8); this.fx._juiceSet(JUICE.release); }
  }
  /** Break mid-span: both halves recoil toward their ends with a whip and dissolve. */
  snap() {
    if (this.state !== 'attached') { this.release(); return; }
    const N = this.N, r = this.fx.rand;
    this.state = 'released'; this.stateAge = 0; this.snapped = true; this.fade = this.fx.look.snapFade;
    this.breakAt = Math.floor(N * (0.4 + r() * 0.2));
    const b = this.breakAt, p = this.p, o = this.o;
    const dx = this.anchor.x - this.hand.x, dy = this.anchor.y - this.hand.y, dz = this.anchor.z - this.hand.z;
    const L = Math.hypot(dx, dy, dz) || 1, ux = dx / L, uy = dy / L, uz = dz / L;
    const px = perpOf(ux, uy, uz, _v1), qx = _v2.set(ux, uy, uz).cross(px);
    const recoil = 11 + 9 * this.tension, h = 1 / 120;
    for (let i = 0; i < N; i++) {
      const handSide = i <= b;
      const w = handSide ? i / Math.max(b, 1) : (N - 1 - i) / Math.max(N - 2 - b, 1);
      const s = handSide ? -1 : 1;
      const lat = Math.sin(w * 9 + (handSide ? 0 : 2)) * 5 * w, lat2 = Math.cos(w * 7) * 3 * w;
      const vx = ux * s * recoil * w + px.x * lat + qx.x * lat2;
      const vy = uy * s * recoil * w + px.y * lat + qx.y * lat2;
      const vz = uz * s * recoil * w + px.z * lat + qx.z * lat2;
      o[i * 3] = p[i * 3] - vx * h; o[i * 3 + 1] = p[i * 3 + 1] - vy * h; o[i * 3 + 2] = p[i * 3 + 2] - vz * h;
    }
    // frayed debris at the break
    const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
    for (let k = 0; k < 10; k++) {
      _v3.set(bx, by, bz);
      _v4.set((r() - 0.5) * 6, (r() - 0.3) * 5, (r() - 0.5) * 6);
      this.fx.fibres.spawn(_v3, _v4, 0.35 + r() * 0.25, 0.12 + r() * 0.2, 0.0008, 0.9, { curl: 0.04, seed: r() * 10, drag: 3, grav: 3 });
    }
    this.fx.sprites.spawn(_v3.set(bx, by, bz), 0, 0, 0, 0.12, 0.08, 0.35, 0.8, 2, 1);
    if (!this.silent) { this.fx._sound('sp_web_snap', _v3, 1.0); this.fx._juiceSet(JUICE.snap); }
  }
  /** Reel the line back into the wrist (used by pull() after the yank). */
  retract() {
    if (this.state === 'dead') return;
    this.state = 'released'; this.mode = 'retract'; this.stateAge = 0; this.retractFrom.copy(this.anchor); this.fade = 0.16;
  }
  dispose() { this.state = 'dead'; this._freeTip(); }

  _freeTip() { if (this.tip) { this.fx.globs.free(this.tip); this.tip = null; } }
  _segLenTotal() { let s = 0; const p = this.p; for (let i = 0; i < this.N - 1; i++) s += Math.hypot(p[i * 3 + 3] - p[i * 3], p[i * 3 + 4] - p[i * 3 + 1], p[i * 3 + 5] - p[i * 3 + 2]); return Math.max(s, 0.1); }

  update(dt) {
    if (this.state === 'dead') return;
    this.age += dt; this.stateAge += dt;
    this.handPrev.copy(this.hand); this.anchorPrev.copy(this.anchor);
    this._resolve();
    if (this.state === 'flying') {
      const d = Math.max(this.hand.distanceTo(this.anchor), 0.3);
      this.reach = Math.min(1, this.reach + this.travelSpeed * dt / d);
      this._layFlying(d);
      if (this.reach >= 1) this._attach();
      return;
    }
    if (this.state === 'attached') {
      if (this._creakCool > 0) this._creakCool -= dt;
      this._sim(dt, true, true);
      this._taut(dt);
      return;
    }
    // released
    if (this.mode === 'retract') {
      const k = clamp(this.stateAge / this.fade, 0, 1), e = k * k;
      this.anchor.lerpVectors(this.retractFrom, this.hand, e);
      this._rest = Math.max(0.05, this.hand.distanceTo(this.anchor) * 1.01);
      this._sim(dt, true, true);
      if (k >= 1) this.dispose();
      return;
    }
    if (this.snapped) this.segScale = lerp(1, 0.72, smooth(0, 0.15, this.stateAge));
    this._sim(dt, this.snapped, this.pinAnchor);
    if (this.stateAge >= this.fade) this.dispose();
  }

  _layFlying(d) {
    const N = this.N, p = this.p, o = this.o, h = this.hand, a = this.anchor, r = this.reach;
    const ux = (a.x - h.x) / d, uy = (a.y - h.y) / d, uz = (a.z - h.z) / d;
    const n = perpOf(ux, uy, uz, _v1), b = _v2.set(ux, uy, uz).cross(n);
    const len = d * r, amp = Math.min(0.07, 0.005 * len), T = len / this.travelSpeed;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), s = u * len;
      const env = Math.sin(Math.PI * u) * (1 - 0.4 * u);
      const w = Math.sin(u * 9.0 - this.age * 55.0 + this.seed) * amp * env;
      const w2 = Math.cos(u * 6.0 - this.age * 41.0 + this.seed * 2) * amp * 0.6 * env;
      const sag = 2.0 * T * T * Math.sin(Math.PI * u) * (1 - u) * 4;
      const x = h.x + ux * s + n.x * w + b.x * w2, y = h.y + uy * s + n.y * w + b.y * w2 - sag, z = h.z + uz * s + n.z * w + b.z * w2;
      p[i * 3] = o[i * 3] = x; p[i * 3 + 1] = o[i * 3 + 1] = y; p[i * 3 + 2] = o[i * 3 + 2] = z;
    }
    if (this.tip) {
      const t = this.tip, q = (N - 1) * 3;
      t.p.set(p[q], p[q + 1], p[q + 2]); t.v.set(ux, uy, uz).multiplyScalar(this.travelSpeed); t.age = this.age;
      this.fx.globs.pose(t);
    }
  }

  _attach() {
    this.state = 'attached'; this.stateAge = 0; this.reach = 1;
    if (!this._restSet) this._rest = this.hand.distanceTo(this.anchor);
    this._freeTip();
    this.fx._onLineAttach(this);
    this.onAttach?.(this);
  }

  _sim(dt, pin0, pinN) {
    if (dt <= 0) return;
    const N = this.N, p = this.p, o = this.o, look = this.fx.look;
    const steps = Math.max(1, Math.ceil(dt * 120 - 1e-6)), h = dt / steps;
    const g = -look.ropeGravity * h * h, damp = Math.pow(look.ropeDamp, h * 120);
    const seg = (this._rest / (N - 1)) * this.segScale, iters = look.ropeIter, brk = this.breakAt;
    const H = this.hand, Hp = this.handPrev, A = this.anchor, Ap = this.anchorPrev;
    for (let s = 1; s <= steps; s++) {
      const k = s / steps;
      for (let i = 0; i < N; i++) {
        const j = i * 3;
        const vx = (p[j] - o[j]) * damp, vy = (p[j + 1] - o[j + 1]) * damp, vz = (p[j + 2] - o[j + 2]) * damp;
        o[j] = p[j]; o[j + 1] = p[j + 1]; o[j + 2] = p[j + 2];
        p[j] += vx; p[j + 1] += vy + g; p[j + 2] += vz;
      }
      if (pin0) { p[0] = lerp(Hp.x, H.x, k); p[1] = lerp(Hp.y, H.y, k); p[2] = lerp(Hp.z, H.z, k); }
      const e = (N - 1) * 3;
      if (pinN) { p[e] = lerp(Ap.x, A.x, k); p[e + 1] = lerp(Ap.y, A.y, k); p[e + 2] = lerp(Ap.z, A.z, k); }
      for (let it = 0; it < iters; it++) {
        const fwd = (it & 1) === 0;
        for (let c = 0; c < N - 1; c++) {
          const i = fwd ? c : N - 2 - c;
          if (i === brk) continue;
          const a = i * 3, b = a + 3;
          const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d <= seg || d < 1e-9) continue;       // a rope pulls, it never pushes
          const wa = (i === 0 && pin0) ? 0 : 1, wb = (i + 1 === N - 1 && pinN) ? 0 : 1, w = wa + wb;
          if (!w) continue;
          const f = (d - seg) / d / w;
          p[a] += dx * f * wa; p[a + 1] += dy * f * wa; p[a + 2] += dz * f * wa;
          p[b] -= dx * f * wb; p[b + 1] -= dy * f * wb; p[b + 2] -= dz * f * wb;
        }
      }
      const gy = this.fx.groundY;
      if (gy !== null) for (let i = 0; i < N; i++) {
        const j = i * 3;
        if (p[j + 1] < gy) { p[j + 1] = gy; o[j] = lerp(o[j], p[j], 0.3); o[j + 2] = lerp(o[j + 2], p[j + 2], 0.3); o[j + 1] = gy; }
      }
    }
  }

  /** When the gap reaches the rope's length it is carrying load: dead straight, tension up. */
  _taut(dt) {
    const N = this.N, p = this.p, o = this.o, H = this.hand, A = this.anchor, Hp = this.handPrev, Ap = this.anchorPrev;
    const d = H.distanceTo(A), ratio = d / Math.max(this._rest, 1e-3);
    const k = smooth(0.975, 1.0, ratio);
    if (k > 0) {
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1), j = i * 3;
        const sx = lerp(H.x, A.x, u), sy = lerp(H.y, A.y, u), sz = lerp(H.z, A.z, u);
        const qx = lerp(Hp.x, Ap.x, u), qy = lerp(Hp.y, Ap.y, u), qz = lerp(Hp.z, Ap.z, u);
        const vx = lerp(p[j] - o[j], sx - qx, k), vy = lerp(p[j + 1] - o[j + 1], sy - qy, k), vz = lerp(p[j + 2] - o[j + 2], sz - qz, k);
        p[j] = lerp(p[j], sx, k); p[j + 1] = lerp(p[j + 1], sy, k); p[j + 2] = lerp(p[j + 2], sz, k);
        o[j] = p[j] - vx; o[j + 1] = p[j + 1] - vy; o[j + 2] = p[j + 2] - vz;
      }
    }
    const raw = clamp((ratio - 0.965) / 0.035, 0, 1);
    const prev = this.tension;
    this.tension = raw > prev ? raw : Math.max(raw, prev - dt * 5);
    if (dt > 0 && this.tension - prev > 0.3) this.twang = Math.max(this.twang, clamp((this.tension - prev) * 1.4, 0, 1));
    this.twang *= Math.exp(-dt * 5.5);
    this._low = this.tension < 0.5 ? 0 : this._low + dt;
    if (this.tension >= 0.8 && prev < 0.8 && this._low < 0.25 && this._creakCool <= 0 && this.stateAge > 0.12) {
      this._creakCool = 0.4; this.twang = Math.max(this.twang, 0.8);
      if (!this.silent) { this.fx._sound('sp_web_creak_' + (1 + Math.floor(this.fx.rand() * 2)), this.hand, 0.7); this.fx._juiceSet(JUICE.creak); }
    }
  }

  // ---------------------------------------------------------------- drawing
  draw(batch) {
    if (this.state === 'dead') return;
    const N = this.N;
    let alpha = 1, spread = 1, drift = 0;
    if (this.state === 'released' && this.mode !== 'retract') {
      const k = clamp(this.stateAge / this.fade, 0, 1);
      alpha = 1 - k; spread = 1 + 3.5 * k * k; drift = k;
    }
    if (this.snapped) {
      this._drawRange(batch, 0, this.breakAt, alpha, spread, drift, 0, 1);
      this._drawRange(batch, this.breakAt + 1, N - 1, alpha, spread, drift, 1, 0);
    } else this._drawRange(batch, 0, N - 1, alpha, spread, drift, 0, this.state === 'flying' ? 1 : 0);
  }

  /** Draws sim points i0..i1. frayA/frayB: fan the fibres out at that end (flying tip, snapped end). */
  _drawRange(batch, i0, i1, alpha, spread, drift, frayA, frayB) {
    if (i1 - i0 < 1) return;
    const look = this.fx.look, p = this.p, N = this.N, t = this.fx.time;
    // arc length of the sim polyline → sample count
    let len = 0;
    for (let i = i0; i < i1; i++) len += Math.hypot(p[i * 3 + 3] - p[i * 3], p[i * 3 + 4] - p[i * 3 + 1], p[i * 3 + 5] - p[i * 3 + 2]);
    if (len < 0.02) return;
    const M = clamp(Math.round(len / 0.22), 16, MAXS);
    // 1. Catmull-Rom samples
    const span = i1 - i0;
    for (let j = 0; j < M; j++) {
      const f = i0 + (j / (M - 1)) * span, k = Math.min(Math.floor(f), i1 - 1), u = f - k;
      const a = Math.max(k - 1, i0) * 3, b = k * 3, c = Math.min(k + 1, i1) * 3, d = Math.min(k + 2, i1) * 3;
      const u2 = u * u, u3 = u2 * u;
      const w0 = -0.5 * u3 + u2 - 0.5 * u, w1 = 1.5 * u3 - 2.5 * u2 + 1, w2 = -1.5 * u3 + 2 * u2 + 0.5 * u, w3 = 0.5 * u3 - 0.5 * u2;
      SX[j] = p[a] * w0 + p[b] * w1 + p[c] * w2 + p[d] * w3;
      SY[j] = p[a + 1] * w0 + p[b + 1] * w1 + p[c + 1] * w2 + p[d + 1] * w3;
      SZ[j] = p[a + 2] * w0 + p[b + 2] * w1 + p[c + 2] * w2 + p[d + 2] * w3;
      SU[j] = f / (N - 1);                         // position along the WHOLE rope, 0 = hand
    }
    // 2. tension ripple (render only): standing waves across the span, fast when under load
    const taut = this.state === 'attached' || (this.mode === 'retract');
    if (taut && !this.snapped) {
      const A = Math.min(0.09, len * (0.0010 * this.tension + 0.011 * this.twang) + this.thrum * (0.010 + 0.0015 * len));
      if (A > 1e-4) {
        const f1 = this.thrum > 0.05 ? 24 : clamp(60 / Math.max(len, 1), 4, 16);
        const w1 = TAU * f1 * t, w2 = TAU * f1 * 1.93 * t, w3 = TAU * f1 * 3.1 * t;
        const dx = SX[M - 1] - SX[0], dy = SY[M - 1] - SY[0], dz = SZ[M - 1] - SZ[0], L = Math.hypot(dx, dy, dz) || 1;
        const n = perpOf(dx / L, dy / L, dz / L, _v1), b = _v2.set(dx / L, dy / L, dz / L).cross(n);
        for (let j = 1; j < M - 1; j++) {
          const u = j / (M - 1);
          const m1 = Math.sin(Math.PI * u) * Math.sin(w1) + 0.45 * Math.sin(TAU * u) * Math.sin(w2 + 1.3) + 0.25 * Math.sin(3 * Math.PI * u) * Math.sin(w3 + 2.1);
          const m2 = Math.sin(Math.PI * u) * Math.cos(w1 * 1.07 + 0.4) + 0.4 * Math.sin(TAU * u) * Math.cos(w2 * 0.96);
          SX[j] += (n.x * m1 + b.x * m2 * 0.6) * A; SY[j] += (n.y * m1 + b.y * m2 * 0.6) * A; SZ[j] += (n.z * m1 + b.z * m2 * 0.6) * A;
        }
      }
    }
    // 3. tangents, arc, parallel-transport frame
    let arc = 0;
    for (let j = 0; j < M; j++) {
      const a = Math.max(j - 1, 0), c = Math.min(j + 1, M - 1);
      let tx = SX[c] - SX[a], ty = SY[c] - SY[a], tz = SZ[c] - SZ[a];
      const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      TX[j] = tx; TY[j] = ty; TZ[j] = tz;
      if (j > 0) arc += Math.hypot(SX[j] - SX[j - 1], SY[j] - SY[j - 1], SZ[j] - SZ[j - 1]);
      ARC[j] = arc;
      let nx, ny, nz;
      if (j === 0) { const q = perpOf(tx, ty, tz, _v3); nx = q.x; ny = q.y; nz = q.z; }
      else { nx = NX[j - 1]; ny = NY[j - 1]; nz = NZ[j - 1]; const dp = nx * tx + ny * ty + nz * tz; nx -= tx * dp; ny -= ty * dp; nz -= tz * dp; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl; }
      NX[j] = nx; NY[j] = ny; NZ[j] = nz;
      BX[j] = ty * nz - tz * ny; BY[j] = tz * nx - tx * nz; BZ[j] = tx * ny - ty * nx;
    }
    const flying = this.state === 'flying';
    const seed = this.seed;
    // 4a. halo — a soft additive sheath of fixed pixel width: it is what keeps a far web
    // readable against a bright sky; near the camera it fades out and the fibres take over
    batch.start(0, 1, look.minPxHalo, seed);
    for (let j = 0; j < M; j++) batch.pt(SX[j], SY[j], SZ[j], 0, look.haloA * alpha * (0.4 + 0.6 * smooth(0, 0.04, ARC[j])));
    batch.end();
    // 4b. core
    const coreA = look.coreA * (this.state === 'released' ? Math.max(0, 1 - this.stateAge / (this.fade * 0.55)) : 1);
    if (coreA > 0.002) {
      batch.start(1, look.coreGlow, look.minPxCore, seed + 0.5);
      for (let j = 0; j < M; j++) {
        const u = SU[j], jj = j / (M - 1);
        const tip = flying ? 1 + 1.6 * smooth(0.82, 1.0, jj) : 1;
        batch.pt(SX[j], SY[j], SZ[j], lerp(look.coreHW[0], look.coreHW[1], u) * tip, coreA * alpha);
      }
      batch.end();
    }
    // 4c. fibres — twisted, each with its own radius, wobble and (sometimes) a stray loop
    const F = look.fibres, fib = this.fib;
    const pitch = Math.max(0.55, 5 * len / (M - 1)), twist = TAU / pitch;
    for (let f = 0; f < F; f++) {
      const ph = fib[f * 5], rf = fib[f * 5 + 1], loopU = fib[f * 5 + 2], loopK = fib[f * 5 + 3], dis = fib[f * 5 + 4];
      let fa = look.fibreA * alpha;
      if (this.state === 'released' && this.mode !== 'retract') fa *= 1 - smooth(dis, dis + 0.45, clamp(this.stateAge / this.fade, 0, 1));
      if (fa < 0.004) continue;
      batch.start(look.fibreBright, look.fibreGlow, look.minPxFibre, seed + f * 0.37);
      const loopArc = loopU >= 0 ? loopU * len : -99;
      for (let j = 0; j < M; j++) {
        const u = SU[j], jj = j / (M - 1), a = ARC[j];
        // converge into the nozzle at the hand and onto the anchor; fan out at a frayed end
        let conv = (0.15 + 0.85 * smooth(0, 0.05, a)) * (0.35 + 0.65 * smooth(len, len - 0.08, a));
        const fray = frayB * smooth(0.72, 1, jj) + frayA * smooth(0.28, 0, jj);
        conv *= 1 + 3.2 * fray * fray;
        let br = lerp(look.braid[0], look.braid[1], u) * rf * (1 + 0.38 * noise1(a * 2.1 + f * 7.3 + seed)) * conv * spread;
        if (loopArc > -1) { const z = (a - loopArc) / 0.2; br += look.braid[0] * loopK * Math.exp(-z * z); }
        const ang = ph + a * twist + 0.55 * noise1(a * 1.3 + f * 3.1 + seed);
        const c = Math.cos(ang) * br, s = Math.sin(ang) * br;
        let x = SX[j] + NX[j] * c + BX[j] * s, y = SY[j] + NY[j] * c + BY[j] * s, z = SZ[j] + NZ[j] * c + BZ[j] * s;
        if (drift > 0) {
          const dn = drift * drift * 0.25;
          x += noise1(a * 0.9 + f * 11 + t * 0.7) * dn; y += noise1(a * 0.8 + f * 5 + 40) * dn * 0.6; z += noise1(a * 0.7 + f * 13 + t * 0.6 + 80) * dn;
        }
        const endA = (0.35 + 0.65 * smooth(0, 0.03, a));
        batch.pt(x, y, z, lerp(look.fibreHW[0], look.fibreHW[1], u), fa * endA * (1 - 0.5 * fray));
      }
      batch.end();
    }
    // 5. the flying tip: a fat bright glob with a star flare
    if (flying) {
      const j = M - 1;
      this.fx.sprites.quad(SX[j], SY[j], SZ[j], 0.10, this.age * 3, 0.35, 2, 1);
      this.fx.sprites.quad(SX[j], SY[j], SZ[j], 0.14, 0, 0.30, 0, 1);
    }
  }
}

// ------------------------------------------------------------------------------------ globs
class GlobPool {
  constructor(fx, max) {
    this.fx = fx;
    this.geos = [11, 23, 37, 51].map(s => lumpyGlob(2, 0.42, s));
    this.mat = new THREE.ShaderMaterial({ name: 'WebFX.glob', uniforms: fx.U, vertexShader: GLOB_VS, fragmentShader: GLOB_FS });
    this.items = Array.from({ length: max }, (_, i) => {
      const m = new THREE.Mesh(this.geos[i % 4], this.mat);
      m.name = 'WebFX.glob'; m.visible = false; m.frustumCulled = false;
      fx.root.add(m);
      return { mesh: m, live: false, kind: 'shot', p: new THREE.Vector3(), prev: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 2, gravity: 3, hand: 'R', onHit: null, emitter: null, origin: new THREE.Vector3(), spin: 0, spinRate: 30, seed: 0, handle: null, strands: 4, radius: 0.06, born: 0 };
    });
    this._n = 0;
  }
  take(kind) {
    let g = this.items.find(x => !x.live);
    if (!g) { g = this.items.reduce((a, b) => (a.born < b.born ? a : b)); if (g.handle) g.handle.state = 'dead'; }
    const r = this.fx.rand;
    g.live = true; g.kind = kind; g.age = 0; g.born = this._n++; g.spin = r() * TAU; g.spinRate = 25 + r() * 20; g.seed = r() * 50;
    g.strands = 3 + Math.floor(r() * 3); g.onHit = null; g.emitter = null; g.handle = null;
    g.radius = kind === 'tip' ? this.fx.look.globRadius * 0.7 : this.fx.look.globRadius * (0.9 + r() * 0.25);
    g.mesh.visible = true;
    return g;
  }
  free(g) { g.live = false; g.mesh.visible = false; }
  /** squash & stretch along travel, spin about it */
  pose(g) {
    const m = g.mesh, s = g.v.length();
    if (s > 1e-3) _v0.copy(g.v).multiplyScalar(1 / s); else _v0.set(0, 0, -1);
    _q0.setFromUnitVectors(_Z, _v0);
    _q1.setFromAxisAngle(_Z, g.spin + g.age * g.spinRate);
    m.quaternion.multiplyQuaternions(_q0, _q1);
    // squash & stretch that never settles: a glob of fluid in flight is wobbling
    const st = g.kind === 'tip' ? 1.7 : 1.25 + 0.12 * Math.sin(g.age * 60);
    m.scale.set(g.radius * (0.86 + 0.1 * Math.sin(g.age * 47)), g.radius * (0.84 + 0.08 * Math.cos(g.age * 53)), g.radius * st);
    m.position.copy(g.p);
  }
}

// ------------------------------------------------------------------------------------ splats
const SPLAT_MAXV = 5200, SPLAT_MAXI = 16000;
class SplatPool {
  constructor(fx, max) {
    this.fx = fx; this.max = max; this._n = 0;
    this.items = [];
    const icoHi = icosphere(2), icoLo = icosphere(1);
    this.ico = [icoHi, icoLo];
    for (let i = 0; i < max; i++) {
      const g = new THREE.BufferGeometry();
      const P = new Float32Array(SPLAT_MAXV * 3), T = new Float32Array(SPLAT_MAXV * 3), A = new Float32Array(SPLAT_MAXV * 4), B = new Float32Array(SPLAT_MAXV * 4);
      const I = new Uint16Array(SPLAT_MAXI);
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('aTan', new THREE.BufferAttribute(T, 3));
      g.setAttribute('aA', new THREE.BufferAttribute(A, 4));
      g.setAttribute('aB', new THREE.BufferAttribute(B, 4));
      g.setIndex(new THREE.BufferAttribute(I, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
      const uni = { ...fx.U, uAge: { value: 0 }, uFade: { value: 1 } };
      const mat = premulBlend(new THREE.ShaderMaterial({ name: 'WebFX.splat', uniforms: uni, vertexShader: SPLAT_VS, fragmentShader: SPLAT_FS, side: THREE.DoubleSide }));
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = 'WebFX.splat'; mesh.visible = false; mesh.renderOrder = 10; mesh.onBeforeRender = fx._resHook;
      fx.root.add(mesh);
      this.items.push({ mesh, geo: g, P, T, A, B, I, uni, live: false, age: 0, life: 20, born: 0, attachTo: null, nv: 0, ni: 0 });
    }
  }
  take() {
    let s = this.items.find(x => !x.live);
    if (!s) s = this.items.reduce((a, b) => (a.born < b.born ? a : b));
    s.born = this._n++;
    return s;
  }
  update(dt) {
    const tail = this.fx.look.splatFadeTail;
    for (const s of this.items) {
      if (!s.live) continue;
      s.age += dt;
      if (s.age >= s.life || (s.attachTo && !s.attachTo.parent)) { this.kill(s); continue; }
      s.uni.uAge.value = s.age;
      s.uni.uFade.value = clamp((s.life - s.age) / tail, 0, 1);
    }
  }
  kill(s) {
    s.live = false; s.mesh.visible = false;
    if (s.mesh.parent !== this.fx.root) { s.mesh.parent?.remove(s.mesh); this.fx.root.add(s.mesh); }
    s.attachTo = null;
  }
}

/**
 * Writes a procedural splat into slot `s` (splat space: +Y = normal).
 * `sh` = [x, z] offset of a strand's shadow per metre of lift (light direction in splat space), or null.
 */
function buildSplat(s, r, R, curve, ico, sh) {
  const P = s.P, T = s.T, A = s.A, B = s.B, I = s.I;
  let nv = 0, ni = 0;
  const ws = clamp(R / 0.55, 0.6, 1.35), hs = clamp(R / 0.55, 0.6, 1.5);
  const lift = rr => 0.002 + 0.013 * hs * Math.pow(Math.max(0, 1 - rr / (R * 1.05)), 2);
  // bend around a vertical cylinder of radius `curve` (for bodies); identity when curve = 0
  const bend = (x, y, z, out) => {
    if (curve > 0) { const th = x / curve; out[0] = Math.sin(th) * (curve + y); out[1] = Math.cos(th) * (curve + y) - curve; out[2] = z; }
    else { out[0] = x; out[1] = y; out[2] = z; }
    return out;
  };
  const tmp = [0, 0, 0], bp = new Float32Array(64 * 3);
  // one strand (kind 0) from src[0..n) in splat space
  const emit = (src, n, hw0, hw1, a0, a1, bright, seed, shadow) => {
    if (nv + n * 2 > SPLAT_MAXV || ni + (n - 1) * 6 > SPLAT_MAXI) return;
    for (let j = 0; j < n; j++) {
      let x = src[j * 3], y = src[j * 3 + 1], z = src[j * 3 + 2];
      if (shadow) { x += sh[0] * y; z += sh[1] * y; y = 0.0009; }
      bend(x, y, z, tmp); bp[j * 3] = tmp[0]; bp[j * 3 + 1] = tmp[1]; bp[j * 3 + 2] = tmp[2];
    }
    let arc = 0;
    for (let j = 0; j < n; j++) {
      const a = Math.max(j - 1, 0) * 3, c = Math.min(j + 1, n - 1) * 3;
      let tx = bp[c] - bp[a], ty = bp[c + 1] - bp[a + 1], tz = bp[c + 2] - bp[a + 2];
      const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      if (j > 0) arc += Math.hypot(bp[j * 3] - bp[j * 3 - 3], bp[j * 3 + 1] - bp[j * 3 - 2], bp[j * 3 + 2] - bp[j * 3 - 1]);
      const u = j / (n - 1), rr = Math.hypot(src[j * 3], src[j * 3 + 2]) / R;
      for (let k = 0; k < 2; k++) {
        const v = nv + j * 2 + k;
        P[v * 3] = bp[j * 3]; P[v * 3 + 1] = bp[j * 3 + 1]; P[v * 3 + 2] = bp[j * 3 + 2];
        T[v * 3] = tx; T[v * 3 + 1] = ty; T[v * 3 + 2] = tz;
        A[v * 4] = k ? 1 : -1; A[v * 4 + 1] = arc; A[v * 4 + 2] = lerp(a0, a1, u) * (shadow ? 0.8 : 1);
        A[v * 4 + 3] = lerp(hw0, hw1, u) * (shadow ? 2.2 : 1);
        B[v * 4] = shadow ? -1 : bright; B[v * 4 + 1] = 0; B[v * 4 + 2] = clamp(rr, 0, 1.5); B[v * 4 + 3] = seed;
      }
    }
    for (let j = 0; j < n - 1; j++) { const v = nv + 2 * j; I[ni++] = v; I[ni++] = v + 1; I[ni++] = v + 2; I[ni++] = v + 1; I[ni++] = v + 3; I[ni++] = v + 2; }
    nv += n * 2;
  };
  // strands are collected first so their shadows can be drawn underneath all of them
  const list = [];
  const add = (pts, n, hw0, hw1, a0, a1, bright, seed, shadow = true) => list.push([pts, n, hw0, hw1, a0, a1, bright, seed, shadow]);
  // a flat grid (shadow = kind 1, film = kind 3) of half size h, uv -1..1
  const grid = (h, y, kind, alpha, seed) => {
    const G = 6;
    if (nv + G * G > SPLAT_MAXV) return;
    const base = nv;
    for (let iz = 0; iz < G; iz++) for (let ix = 0; ix < G; ix++) {
      const u = (ix / (G - 1)) * 2 - 1, w = (iz / (G - 1)) * 2 - 1;
      bend(u * h, y, w * h, tmp);
      const th = curve > 0 ? (u * h) / curve : 0;
      P[nv * 3] = tmp[0]; P[nv * 3 + 1] = tmp[1]; P[nv * 3 + 2] = tmp[2];
      T[nv * 3] = Math.sin(th); T[nv * 3 + 1] = Math.cos(th); T[nv * 3 + 2] = 0;
      A[nv * 4] = u; A[nv * 4 + 1] = w; A[nv * 4 + 2] = alpha; A[nv * 4 + 3] = 0;
      B[nv * 4] = 0; B[nv * 4 + 1] = kind; B[nv * 4 + 2] = Math.min(1, Math.hypot(u, w) * h / R); B[nv * 4 + 3] = seed;
      nv++;
    }
    for (let iz = 0; iz < G - 1; iz++) for (let ix = 0; ix < G - 1; ix++) {
      const a = base + iz * G + ix; I[ni++] = a; I[ni++] = a + G; I[ni++] = a + 1; I[ni++] = a + 1; I[ni++] = a + G; I[ni++] = a + G + 1;
    }
  };
  // a lumpy glob (kind 2) centred at (cx, cy, cz), radii (rx, ry, rz)
  const glob = (geo, cx, cy, cz, rx, ry, rz, seed, amp = 0.34, fingers = 0) => {
    const nverts = geo.pos.length / 3;
    if (nv + nverts > SPLAT_MAXV || ni + geo.idx.length > SPLAT_MAXI) return;
    const f = lumpField(Math.floor(seed * 1000) + 7), base = nv;
    const nrm = new Float32Array(nverts * 3), pp = new Float32Array(nverts * 3);
    for (let i = 0; i < nverts; i++) {
      const x = geo.pos[i * 3], y = geo.pos[i * 3 + 1], z = geo.pos[i * 3 + 2], l = f(x, y, z);
      const k = 1 + amp * l;
      // splash fingers: the rim pushed out in lobes, and thinner where it is pushed out
      let fx = 1, fy = 1;
      if (fingers > 0) {
        // uneven lobes: two frequencies beating against each other, so it is a splash, not a star
        const an = Math.atan2(z, x);
        const w = 0.65 * Math.sin(an * fingers + seed * 20) + 0.45 * Math.sin(an * (fingers + 2) - seed * 13) + 0.25 * Math.sin(an * 2 + seed * 7);
        const lobe = Math.pow(Math.max(0, w), 2.2) * (1 - Math.abs(y));
        fx = 1 + 0.7 * lobe; fy = 1 - 0.4 * clamp(lobe, 0, 1);
      }
      bend(cx + x * rx * k * fx, Math.max(0.0, cy + y * ry * k * fy), cz + z * rz * k * fx, tmp);
      pp[i * 3] = tmp[0]; pp[i * 3 + 1] = tmp[1]; pp[i * 3 + 2] = tmp[2];
      A[(base + i) * 4 + 1] = clamp(0.5 + l * 1.4, 0, 1);   // cavity
    }
    for (let t = 0; t < geo.idx.length; t += 3) {
      const a = geo.idx[t], b = geo.idx[t + 1], c = geo.idx[t + 2];
      const e1x = pp[b * 3] - pp[a * 3], e1y = pp[b * 3 + 1] - pp[a * 3 + 1], e1z = pp[b * 3 + 2] - pp[a * 3 + 2];
      const e2x = pp[c * 3] - pp[a * 3], e2y = pp[c * 3 + 1] - pp[a * 3 + 1], e2z = pp[c * 3 + 2] - pp[a * 3 + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      nrm[a * 3] += nx; nrm[a * 3 + 1] += ny; nrm[a * 3 + 2] += nz;
      nrm[b * 3] += nx; nrm[b * 3 + 1] += ny; nrm[b * 3 + 2] += nz;
      nrm[c * 3] += nx; nrm[c * 3 + 1] += ny; nrm[c * 3 + 2] += nz;
      I[ni++] = base + a; I[ni++] = base + b; I[ni++] = base + c;
    }
    for (let i = 0; i < nverts; i++) {
      const v = base + i, l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
      P[v * 3] = pp[i * 3]; P[v * 3 + 1] = pp[i * 3 + 1]; P[v * 3 + 2] = pp[i * 3 + 2];
      T[v * 3] = nrm[i * 3] / l; T[v * 3 + 1] = nrm[i * 3 + 1] / l; T[v * 3 + 2] = nrm[i * 3 + 2] / l;
      A[v * 4] = 0; A[v * 4 + 2] = 1; A[v * 4 + 3] = 0;
      B[v * 4] = 1; B[v * 4 + 1] = 2; B[v * 4 + 2] = 0; B[v * 4 + 3] = seed;
    }
    nv += nverts;
  };

  // --- spokes
  const nS = 8 + Math.floor(r() * 5), rot0 = r() * TAU;
  const ang = [], L = [], bendK = [];
  for (let j = 0; j < nS; j++) {
    ang.push(rot0 + (j + (r() - 0.5) * 0.55) * TAU / nS);
    let l = R * (0.62 + 0.38 * r()); if (r() < 0.12) l *= 1.22;
    L.push(l); bendK.push((r() - 0.5) * 0.18);
  }
  const r0 = 0.02 * R;
  const spokeAt = (j, rr, out) => {
    const u = clamp((rr - r0) / (L[j] - r0), 0, 1), c = Math.cos(ang[j]), s = Math.sin(ang[j]);
    const off = bendK[j] * L[j] * 4 * u * (1 - u);
    out[0] = c * rr - s * off; out[2] = s * rr + c * off; out[1] = lift(rr);
    return out;
  };
  const sp = [0, 0, 0];
  for (let j = 0; j < nS; j++) {
    const n = 12, pts = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { const rr = lerp(r0, L[j], Math.pow(k / (n - 1), 1.15)); spokeAt(j, rr, sp); pts[k * 3] = sp[0]; pts[k * 3 + 1] = sp[1]; pts[k * 3 + 2] = sp[2]; }
    add(pts, n, 0.0042 * ws, 0.0011 * ws, 1.0, 0.8, 0.8, r());
    // companion fibres that drift across the spoke
    for (let q = 0; q < 2; q++) {
      const off = (0.004 + 0.006 * r()) * (q ? -1 : 1), ph = r() * 3, c = Math.cos(ang[j]), s = Math.sin(ang[j]), pc = new Float32Array(n * 3), end = 0.55 + 0.4 * r();
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1), rr = lerp(r0 * 2, L[j] * end, u); spokeAt(j, rr, sp);
        const o = off * Math.cos(u * 5 + ph) * ws * (0.4 + u);
        pc[k * 3] = sp[0] - s * o; pc[k * 3 + 1] = sp[1] + 0.001; pc[k * 3 + 2] = sp[2] + c * o;
      }
      add(pc, n, 0.0011 * ws, 0.0007 * ws, 0.85, 0.35, 0.45, r(), false);
    }
  }
  // --- rings of sagging arcs (the classic web scallop, drooping toward the centre)
  const nR = 3 + Math.floor(r() * 3);
  for (let k = 0; k < nR; k++) {
    const fk = lerp(0.26, 0.86, nR > 1 ? k / (nR - 1) : 0.5);
    const rad = [];
    for (let j = 0; j < nS; j++) rad.push(fk * R * (1 + (r() - 0.5) * 0.16));
    for (let j = 0; j < nS; j++) {
      const j2 = (j + 1) % nS;
      if (rad[j] > L[j] * 0.95 || rad[j2] > L[j2] * 0.95 || r() < 0.1) continue;
      const a = spokeAt(j, rad[j], [0, 0, 0]), b = spokeAt(j2, rad[j2], [0, 0, 0]);
      const sag = 0.08 + r() * 0.16;
      const cx = (a[0] + b[0]) * 0.5 * (1 - 2 * sag), cz = (a[2] + b[2]) * 0.5 * (1 - 2 * sag);
      const n = 9, pts = new Float32Array(n * 3);
      for (let q = 0; q < n; q++) {
        const u = q / (n - 1), w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
        const x = a[0] * w0 + cx * w1 + b[0] * w2, z = a[2] * w0 + cz * w1 + b[2] * w2;
        pts[q * 3] = x; pts[q * 3 + 1] = lift(Math.hypot(x, z)) + 0.0006; pts[q * 3 + 2] = z;
      }
      const al = 0.95 - 0.3 * k / nR;
      add(pts, n, 0.0015 * ws, 0.0015 * ws, al, al, 0.45, r());
    }
  }
  // --- stray strands reaching past the rim
  const nStray = 3 + Math.floor(r() * 3);
  for (let q = 0; q < nStray; q++) {
    const a = r() * TAU, len = R * (1.05 + 0.45 * r()), ph = r() * TAU, c = Math.cos(a), s = Math.sin(a), n = 14, pts = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1), rr = lerp(R * 0.1, len, u), o = Math.sin(u * Math.PI * 2.5 + ph) * 0.045 * R * u;
      pts[k * 3] = c * rr - s * o; pts[k * 3 + 1] = lift(rr); pts[k * 3 + 2] = s * rr + c * o;
    }
    add(pts, n, 0.0009 * ws, 0.0006 * ws, 0.75, 0.15, 0.4, r(), false);
  }
  // --- dense tangle around the centre
  const nT = 18 + Math.floor(r() * 8);
  for (let q = 0; q < nT; q++) {
    const a1 = r() * TAU, a2 = a1 + Math.PI * (0.5 + r()), r1 = R * 0.24 * Math.sqrt(r()), r2 = R * 0.24 * Math.sqrt(r());
    const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1, x2 = Math.cos(a2) * r2, z2 = Math.sin(a2) * r2, bo = (r() - 0.5) * 1.1, n = 8, pts = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1), x = lerp(x1, x2, u) - (z2 - z1) * bo * u * (1 - u), z = lerp(z1, z2, u) + (x2 - x1) * bo * u * (1 - u);
      pts[k * 3] = x; pts[k * 3 + 1] = lift(Math.hypot(x, z)) + 0.002 + 0.004 * Math.sin(u * Math.PI); pts[k * 3 + 2] = z;
    }
    add(pts, n, 0.0013 * ws, 0.0010 * ws, 0.9, 0.9, 0.6, r(), q % 2 === 0);
  }

  // --- painter's order inside the one draw call: contact shadow, film, strand shadows, strands, globs
  grid(R * 1.15, 0.0012, 1, 1, 0.1);
  grid(R * 0.38, 0.0035, 3, 0.5, 0.2);
  if (sh) for (const e of list) if (e[8]) emit(e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], true);
  for (const e of list) emit(e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], false);
  // the wet centre mass + satellites
  const rg = 0.10 * R * (0.9 + 0.25 * r());
  glob(ico[0], 0, 0, 0, rg, rg * 0.34, rg * (0.85 + 0.3 * r()), r(), 0.22, 5 + Math.floor(r() * 3));
  const nSat = 1 + Math.floor(r() * 2);
  for (let q = 0; q < nSat; q++) {
    const a = r() * TAU, d = rg * (1.25 + 0.4 * r()), sr = rg * (0.16 + 0.1 * r());
    glob(ico[1], Math.cos(a) * d, 0, Math.sin(a) * d, sr * 1.4, sr * 0.45, sr, r(), 0.2);
  }
  s.nv = nv; s.ni = ni;
  const g = s.geo;
  for (const name of ['position', 'aTan']) upd(g.getAttribute(name), nv * 3);
  for (const name of ['aA', 'aB']) upd(g.getAttribute(name), nv * 4);
  upd(g.index, ni);
  g.setDrawRange(0, ni);
  g.boundingSphere.radius = R * 1.6 + Math.max(0, curve);
}

// ------------------------------------------------------------------------------------ WebFX
export class WebFX {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.scene            where the effects live
   * @param {THREE.Camera}   [o.camera]
   * @param {THREE.Object3D[]} [o.raycastTargets] what thrown webs can hit (searched recursively)
   * @param {(id:string, {position, gain})=>void} [o.onSound]
   * @param {(kind:string, amount:any)=>void} [o.onJuice]  'fov_kick' deg | 'hitstop' s | 'rumble' {low,high,duration} | 'shake' 0..1
   */
  constructor({ scene, camera = null, raycastTargets = [], onSound = null, onJuice = null, seed = 1337, maxSplats = 32, maxGlobs = 24, look = {} } = {}) {
    this.scene = scene; this.camera = camera; this.raycastTargets = raycastTargets;
    this.onSound = onSound; this.onJuice = onJuice;
    this.look = { ...LOOK, ...look };
    this.seed = seed; this.rand = mulberry32(seed);
    this.time = 0;
    this.root = new THREE.Group(); this.root.name = 'WebFX';
    scene.add(this.root);
    this.U = {
      uLightDir: { value: new THREE.Vector3(-0.45, 0.8, -0.4).normalize() },
      uLightCol: { value: new THREE.Color(1.0, 0.97, 0.92) },
      uAmb: { value: new THREE.Color(0.30, 0.33, 0.40) },
      uSilk: { value: new THREE.Color(0.93, 0.95, 1.0) },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1280, 720) },
    };
    const U = this.U;
    this._resHook = function (renderer) {
      const rt = renderer.getRenderTarget();
      if (rt) U.uRes.value.set(rt.width, rt.height); else { renderer.getDrawingBufferSize(_size); U.uRes.value.copy(_size); }
    };
    this.batch = new StrandBatch(this, 40000);
    this.sprites = new SpriteBatch(this, 384);
    this.fibres = new FibrePool(512);
    this.rings = Array.from({ length: 8 }, () => ({ live: false, c: new THREE.Vector3(), n: new THREE.Vector3(), age: 0, life: 0.3, r0: 0.1, r1: 1, hw: 0.006, a0: 0.5 }));
    this.globs = new GlobPool(this, maxGlobs);
    this.splats = new SplatPool(this, maxSplats);
    this.lines = []; this.zips = []; this.pulls = [];
    /** Optional ground height ropes rest on instead of sinking through (null = none). */
    this.groundY = null;
    this._ray = new THREE.Raycaster(); this._hits = [];
    this._lastThwip = 0;
  }

  /** Match the scene's key light (direction TOWARD the light, world space). */
  setLight(dir, color = null, ambient = null) {
    this.U.uLightDir.value.copy(dir).normalize();
    if (color) this.U.uLightCol.value.copy(color);
    if (ambient) this.U.uAmb.value.copy(ambient);
  }
  reseed(seed) { this.seed = seed; this.rand = mulberry32(seed); }

  // ---------------------------------------------------------------- public API
  /** Thrown web glob. Returns a handle {state:'flying'|'hit'|'dead', position, velocity, hit}. */
  shoot({ from, dir, speed = 70, gravity = 3.0, hand = 'R', onHit = null }) {
    const g = this.globs.take('shot'), r = this.rand;
    if (from && from.isObject3D) { from.getWorldPosition(g.p); g.emitter = from; } else g.p.copy(from);
    g.origin.copy(g.p); g.prev.copy(g.p);
    g.v.copy(dir).normalize().multiplyScalar(speed);
    g.gravity = gravity; g.hand = hand; g.onHit = onHit; g.life = 2.2;
    const h = g.handle = { state: 'flying', position: g.p, velocity: g.v, hand, hit: null };
    this.globs.pose(g);
    // muzzle: a tiny radial burst of fibres, a puff and a flash
    const d = _v4.copy(g.v).normalize();
    const n = perpOf(d.x, d.y, d.z, _v5), b = _v1.copy(d).cross(n);
    for (let k = 0; k < 9; k++) {
      const a = r() * TAU, cone = 0.35 + r() * 0.55, sp = 3 + r() * 5;
      _v2.copy(d).multiplyScalar(Math.cos(cone)).addScaledVector(n, Math.sin(cone) * Math.cos(a)).addScaledVector(b, Math.sin(cone) * Math.sin(a)).multiplyScalar(sp);
      this.fibres.spawn(g.p, _v2, 0.10 + r() * 0.08, 0.06 + r() * 0.08, 0.0007, 0.9, { curl: 0.015, seed: r() * 10, drag: 9, grav: 1, grow: 0.03 });
    }
    this.sprites.spawn(g.p, d.x * 1.5, d.y * 1.5, d.z * 1.5, 0.16, 0.035, 0.13, 0.55, 1, 0.15, 1, 1, 1, r() * TAU, 0, 6);
    this.sprites.spawn(g.p, 0, 0, 0, 0.06, 0.10, 0.16, 0.9, 2, 1, 1, 1, 1, r() * TAU);
    this._thwip(g.p);
    this._juiceSet(JUICE.shoot);
    return h;
  }

  /** Stamp an impact splat. attachTo: an Object3D it sticks to (follows it). curve: bend radius for bodies. */
  splat({ point, normal, size = this.look.splatSize, attachTo = null, life = this.look.splatLife, curve = 0 }) {
    const s = this.splats.take(), r = this.rand;
    if (s.live) this.splats.kill(s);
    // basis: Y = normal, X horizontal (so a body bend wraps around a vertical axis), Z = X × Y
    const n = _v0.copy(normal).normalize();
    const x = Math.abs(n.y) < 0.95 ? _v1.crossVectors(_UP, n).normalize() : _v1.set(1, 0, 0).cross(n).normalize();
    const z = _v2.crossVectors(x, n).normalize();
    _m0.makeBasis(x, n, z);
    const m = s.mesh;
    if (m.parent !== this.root) { m.parent?.remove(m); this.root.add(m); }
    this.root.updateWorldMatrix(true, false);
    m.quaternion.setFromRotationMatrix(_m0);
    // spin it about its normal so no two splats line up
    m.quaternion.multiply(_q0.setFromAxisAngle(_UP, r() * TAU));
    // where the strands' shadows fall: the light direction expressed in splat space
    const Ld = this.U.uLightDir.value, ln = Ld.dot(n);
    let sh = null;
    if (ln > 0.08) {
      _v3.copy(Ld).addScaledVector(n, -ln).multiplyScalar(-1 / Math.max(ln, 0.3));   // away from the light, per metre of lift
      _q1.copy(m.quaternion).invert(); _v3.applyQuaternion(_q1);
      sh = [clamp(_v3.x, -3, 3) * 1.6, clamp(_v3.z, -3, 3) * 1.6];
    }
    buildSplat(s, r, size, curve, this.splats.ico, sh);
    m.position.copy(point);
    if (this.root.matrixWorld) { _m0.copy(this.root.matrixWorld).invert(); m.position.applyMatrix4(_m0); }
    m.scale.setScalar(1);
    m.visible = true;
    if (attachTo) { attachTo.updateWorldMatrix(true, false); attachTo.attach(m); }
    s.live = true; s.age = 0; s.life = life; s.attachTo = attachTo;
    s.uni.uAge.value = 0; s.uni.uFade.value = 1;
    // the impact itself: a flash, a puff of web fluid, fibres sprayed along the surface
    this.sprites.spawn(point, n.x * 0.6, n.y * 0.6, n.z * 0.6, 0.30, size * 0.25, size * 0.75, 0.45, 1, 0.1, 1, 1, 1, r() * TAU, 0.5, 5);
    this.sprites.spawn(point, 0, 0, 0, 0.07, size * 0.35, size * 0.6, 0.9, 2, 1, 1, 1, 1, r() * TAU);
    for (let k = 0; k < 8; k++) {
      const a = r() * TAU;
      _v3.copy(x).multiplyScalar(Math.cos(a)).addScaledVector(z, Math.sin(a)).multiplyScalar(4 + r() * 5).addScaledVector(n, 0.8 + r() * 1.5);
      _v4.copy(point).addScaledVector(n, 0.01);
      this.fibres.spawn(_v4, _v3, 0.14 + r() * 0.12, 0.08 + r() * 0.12, 0.0008, 0.85, { curl: 0.02, seed: r() * 10, drag: 10, grav: 2, grow: 0.03 });
    }
    return s;
  }

  /** A tether from `from` (Object3D, re-read every frame) to `to` (Vector3 | {object, local} | Object3D). */
  line({ from, to, travelSpeed = 320, kind = 'swing', normal = null, onAttach = null, silent = false }) {
    const l = new WebLine(this, { from, to, travelSpeed, kind, normal, onAttach, silent });
    this.lines.push(l);
    if (!silent) { this._sound('sp_thwip_swing', l.hand, 1.0); this._juiceSet(JUICE.lineFire); }
    return l;
  }

  /** Web-zip: both hands to one point, taut and thrumming, released after `duration`. */
  zip({ fromL, fromR, to, duration = 0.45 }) {
    const L = this.line({ from: fromL, to, travelSpeed: 420, kind: 'zip', silent: true });
    const R = this.line({ from: fromR, to, travelSpeed: 440, kind: 'zip', silent: true });
    _v0.copy(L.hand).add(R.hand).multiplyScalar(0.5);
    this._sound('sp_thwip_double', _v0, 1.0);
    this._juiceSet(JUICE.lineFire);
    const fx = this;
    const z = { lines: [L, R], state: 'flying', t: 0, duration, started: false,
      release() { if (z.state === 'dead') return; for (const l of z.lines) l.release(); z.state = 'released'; } };
    this.zips.push(z);
    return z;
  }

  /** Yank: line flies to the target, snaps taut, onYank fires on the tension spike, then it reels in. */
  pull({ from, target, onYank = null, local = null }) {
    let loc = local;
    if (!loc) {
      const box = new THREE.Box3().setFromObject(target);
      const c = box.getCenter(new THREE.Vector3());
      c.y = lerp(box.min.y, box.max.y, 0.62);
      target.updateWorldMatrix(true, false);
      loc = target.worldToLocal(c);
    }
    const line = this.line({ from, to: { object: target, local: loc }, travelSpeed: 360, kind: 'pull' });
    const h = { line, target, state: 'flying', t: 0, yanked: false, onYank,
      release() { line.release(); h.state = 'released'; } };
    this.pulls.push(h);
    return h;
  }

  /** Animation clip events. */
  cue(name, o = {}) {
    switch (name) {
      case 'web_shot': {
        const at = o.at; if (!at) return null;
        at.updateWorldMatrix(true, false);
        const dir = o.dir ? _v5.copy(o.dir) : _v5.set(0, -1, 0).transformDirection(at.matrixWorld);
        const hand = o.hand || (/L$/.test(at.name || '') ? 'L' : 'R');
        return this.shoot({ from: at, dir, hand, speed: o.speed ?? 70, gravity: o.gravity ?? 3.0, onHit: o.onHit ?? null });
      }
      case 'web_line': return o.at && o.to ? this.line({ from: o.at, to: o.to, kind: o.kind ?? 'swing' }) : null;
      case 'web_zip': return o.atL && o.atR && o.to ? this.zip({ fromL: o.atL, fromR: o.atR, to: o.to, duration: o.duration ?? 0.45 }) : null;
      case 'web_release':
        for (const l of this.lines) if (l.kind !== 'zip' && (l.state === 'attached' || l.state === 'flying')) l.release();
        return null;
      case 'web_splat': case 'web_impact':
        return o.point ? this.splat({ point: o.point, normal: o.normal || _UP, size: o.size ?? this.look.splatSize, attachTo: o.attachTo ?? null }) : null;
    }
    return null;
  }

  clear() {
    for (const l of this.lines) l.dispose();
    this.lines.length = 0; this.zips.length = 0; this.pulls.length = 0;
    for (const g of this.globs.items) { this.globs.free(g); if (g.handle) g.handle.state = 'dead'; }
    for (const s of this.splats.items) if (s.live) this.splats.kill(s);
    for (const q of this.sprites.parts) q.live = false;
    for (const q of this.fibres.parts) q.live = false;
    for (const q of this.rings) q.live = false;
    this.batch.begin(); this.batch.finish();
    this.sprites.n = 0; this.sprites.finish();
  }
  dispose() {
    this.clear();
    this.root.parent?.remove(this.root);
    for (const s of this.splats.items) { s.mesh.parent?.remove(s.mesh); s.geo.dispose(); s.mesh.material.dispose(); }
    this.batch.geo.dispose(); this.batch.mat.dispose();
    this.sprites.geo.dispose(); this.sprites.mat.dispose();
    for (const g of this.globs.geos) g.dispose(); this.globs.mat.dispose();
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.time += dt; this.U.uTime.value = this.time;
    this._stepGlobs(dt);
    for (const l of this.lines) l.update(dt);
    this._updateZips(dt);
    this._updatePulls(dt);
    for (let i = this.lines.length - 1; i >= 0; i--) if (this.lines[i].state === 'dead') this.lines.splice(i, 1);
    this.fibres.update(dt);
    this.splats.update(dt);
    for (const q of this.rings) if (q.live) { q.age += dt; if (q.age >= q.life) q.live = false; }
    // draw
    const B = this.batch;
    B.begin();
    this.sprites.update(dt);
    for (const l of this.lines) l.draw(B);
    this._drawGlobs(B);
    this.fibres.draw(B);
    this._drawRings(B);
    B.finish();
    this.sprites.finish();
  }

  _stepGlobs(dt) {
    const steps = Math.max(1, Math.ceil(dt * 120 - 1e-6)), h = dt / steps;
    for (const g of this.globs.items) {
      if (!g.live || g.kind !== 'shot') { if (g.live && g.kind === 'tip') this.globs.pose(g); continue; }
      if (dt <= 0) { this.globs.pose(g); continue; }
      for (let s = 0; s < steps && g.live; s++) {
        g.age += h;
        g.prev.copy(g.p);
        g.v.y -= g.gravity * h;
        g.p.addScaledVector(g.v, h);
        if (this._globRay(g)) break;
        if (g.age >= g.life) { this.globs.free(g); g.handle.state = 'dead'; }
      }
      if (g.live) this.globs.pose(g);
    }
  }

  _globRay(g) {
    if (!this.raycastTargets.length) return false;
    const d = _v0.subVectors(g.p, g.prev), len = d.length();
    if (len < 1e-6) return false;
    this._ray.set(g.prev, d.multiplyScalar(1 / len)); this._ray.near = 0; this._ray.far = len + g.radius * 0.5;
    this._hits.length = 0;
    this._ray.intersectObjects(this.raycastTargets, true, this._hits);
    let hit = null;
    for (const x of this._hits) { if (x.object.visible !== false && !x.object.userData.noWeb) { hit = x; break; } }
    if (!hit) return false;
    const n = new THREE.Vector3();
    if (hit.face) n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld); else n.copy(g.v).negate().normalize();
    if (n.dot(g.v) > 0) n.negate();
    let body = null;
    for (let o = hit.object; o; o = o.parent) if (o.userData && o.userData.isBody) { body = o; break; }
    const point = hit.point.clone();
    if (body) {
      // bodies: smaller splat, stuck to the thing it hit, bent round it
      const obj = hit.object;
      let curve = 0;
      if (obj.geometry) {
        if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
        const bb = obj.geometry.boundingBox, sx = obj.getWorldScale(_v1);
        curve = Math.max(0.08, 0.5 * Math.min((bb.max.x - bb.min.x) * sx.x, (bb.max.z - bb.min.z) * sx.z));
      }
      this.splat({ point, normal: n, size: 0.4, attachTo: obj, curve });
      this._sound('sp_web_hit_body', point, 1.0);
      this._juiceSet(JUICE.splatBody);
    } else {
      this.splat({ point, normal: n, size: this.look.splatSize * (0.8 + 0.3 * this.rand()) });
      this._sound('sp_web_splat_' + (1 + Math.floor(this.rand() * 3)), point, 1.0);
      this._juiceSet(JUICE.splatWall);
    }
    g.handle.state = 'hit'; g.handle.hit = { point, normal: n, object: hit.object };
    this.globs.free(g);
    g.onHit?.({ point, normal: n, object: hit.object });
    return true;
  }

  _drawGlobs(B) {
    const r = this.look.globRadius;
    for (const g of this.globs.items) {
      if (!g.live || g.kind !== 'shot') continue;
      const sp = g.v.length(); if (sp < 1e-3) continue;
      const dx = g.v.x / sp, dy = g.v.y / sp, dz = g.v.z / sp;
      const n = perpOf(dx, dy, dz, _v1), b = _v2.set(dx, dy, dz).cross(n);
      // a streak about one frame of travel long (it IS the motion blur) ...
      const streak = clamp(sp * 0.016, 0.3, 1.3), trail = streak * 0.6, grow = smooth(0, 0.05, g.age);
      B.start(1, 0.25, 1.4, g.seed + 7);
      for (let k = 0; k < 8; k++) {
        const u = k / 7, d = u * streak * grow;
        B.pt(g.p.x - dx * d, g.p.y - dy * d, g.p.z - dz * d, lerp(r * 0.35, 0.0008, u), 0.85 * Math.pow(1 - u, 1.6));
      }
      B.end();
      // ... and a few strands spiralling off the glob, whipping as they go
      for (let s = 0; s < g.strands; s++) {
        const ph = g.seed + s * TAU / g.strands;
        B.start(0.6, 0.2, 1.0, g.seed + s);
        for (let k = 0; k < 18; k++) {
          const u = k / 17, d = u * trail * grow;
          const ang = ph + g.age * 30 + d * 5.5;
          const rad = r * (0.7 + 0.3 * u) + d * 0.045 + Math.sin(d * 11 - g.age * 50 + s * 2) * 0.012 * u;
          const c = Math.cos(ang) * rad, si = Math.sin(ang) * rad;
          B.pt(g.p.x - dx * d + n.x * c + b.x * si, g.p.y - dy * d + n.y * c + b.y * si, g.p.z - dz * d + n.z * c + b.z * si,
            lerp(0.0013, 0.0005, u), 0.9 * Math.pow(1 - u, 1.4));
        }
        B.end();
      }
      // thin fading tracer back toward the wrist, first 80 ms
      if (g.age < 0.08) {
        const a = Math.pow(1 - g.age / 0.08, 2) * 0.9;
        const w = g.emitter ? g.emitter.getWorldPosition(_v3) : _v3.copy(g.origin);
        B.start(1, 0.3, 1.2, g.seed + 9);
        for (let k = 0; k < 6; k++) {
          const u = k / 5;
          B.pt(lerp(w.x, g.p.x, u), lerp(w.y, g.p.y, u) - 0.02 * Math.sin(Math.PI * u), lerp(w.z, g.p.z, u), lerp(0.0018, 0.0012, u), a * (0.5 + 0.5 * u));
        }
        B.end();
      }
      this.sprites.quad(g.p.x, g.p.y, g.p.z, r * 2.4, 0, 0.22, 0, 1);
    }
  }

  _drawRings(B) {
    for (const q of this.rings) {
      if (!q.live) continue;
      const k = q.age / q.life, e = 1 - Math.pow(1 - k, 3), rad = lerp(q.r0, q.r1, e), a = q.a0 * (1 - k) * (1 - k);
      const u = perpOf(q.n.x, q.n.y, q.n.z, _v1), w = _v2.copy(q.n).cross(u);
      B.start(0.2, 0.85, 2.0, 3.3);
      for (let j = 0; j <= 32; j++) {
        const t = j / 32 * TAU, c = Math.cos(t) * rad, s = Math.sin(t) * rad;
        B.pt(q.c.x + u.x * c + w.x * s, q.c.y + u.y * c + w.y * s, q.c.z + u.z * c + w.z * s, q.hw * (1 - 0.5 * k), a);
      }
      B.end();
    }
  }

  _ring(c, n, life, r0, r1, hw, a0) {
    const q = this.rings.find(x => !x.live) || this.rings[0];
    q.live = true; q.c.copy(c); q.n.copy(n).normalize(); q.age = 0; q.life = life; q.r0 = r0; q.r1 = r1; q.hw = hw; q.a0 = a0;
  }

  _onLineAttach(l) {
    if (l.kind === 'zip' && l.silent) { /* zip sounds are handled by the zip itself */ }
    this._sound('sp_web_attach_' + (1 + Math.floor(this.rand() * 2)), l.anchor, l.kind === 'zip' ? 0.7 : 1.0);
    if (l.kind !== 'zip') this._juiceSet(JUICE.attach);
    // stamp a small splat where it landed; find the real surface normal with one ray
    const dir = _v0.subVectors(l.anchor, l.hand), d = dir.length();
    let point = l.anchor.clone(), normal = l.normal, obj = l.toObj;
    if (!normal && d > 1e-3 && this.raycastTargets.length) {
      dir.multiplyScalar(1 / d);
      // from just short of the anchor (further for a body: its anchor is its centre), toward it
      const back = obj ? 1.2 : 0.6;
      this._ray.set(_v1.copy(l.anchor).addScaledVector(dir, -back), dir); this._ray.near = 0; this._ray.far = back + 0.6;
      this._hits.length = 0;
      this._ray.intersectObjects(this.raycastTargets, true, this._hits);
      const h = this._hits.find(x => !x.object.userData.noWeb);
      if (h && h.face) {
        normal = h.face.normal.clone().transformDirection(h.object.matrixWorld); if (normal.dot(dir) > 0) normal.negate();
        point.copy(h.point);
        // the line ends ON the surface it hit, and keeps following it
        if (obj) { l.toObj = obj = h.object; l.toLocal.copy(h.point); h.object.worldToLocal(l.toLocal); l.anchor.copy(h.point); }
        else if (!l.toObj) { l.toPoint.copy(h.point); l.anchor.copy(h.point); }
      }
    }
    if (!normal) normal = _v2.copy(l.hand).sub(l.anchor).normalize();
    const body = obj && (obj.userData?.isBody || l.kind === 'pull');
    this.splat({ point, normal, size: l.kind === 'zip' ? 0.2 : body ? 0.26 : 0.3, attachTo: body ? obj : (obj || null), curve: body ? 0.25 : 0 });
  }

  _updateZips(dt) {
    for (let i = this.zips.length - 1; i >= 0; i--) {
      const z = this.zips[i], [L, R] = z.lines;
      if (!z.started && (L.state === 'attached' || R.state === 'attached')) {
        z.started = true; z.t = 0; z.state = 'attached';
        const mid = _v3.copy(L.hand).add(R.hand).multiplyScalar(0.5);
        const dir = _v4.copy(L.anchor).sub(mid).normalize();
        this._sound('sp_zip_whoosh', mid, 1.0);
        this._juiceSet(JUICE.zipStart);
        this._ring(mid, dir, 0.30, 0.15, 1.6, 0.012, 0.75);
        this._ring(_v5.copy(mid).addScaledVector(dir, -0.5), dir, 0.40, 0.10, 1.0, 0.008, 0.45);
        const r = this.rand, n = perpOf(dir.x, dir.y, dir.z, _v1), b = _v2.copy(dir).cross(n);
        for (let k = 0; k < 16; k++) {
          const a = r() * TAU, rad = 0.25 + r() * 0.9;
          const p = _v5.copy(mid).addScaledVector(n, Math.cos(a) * rad).addScaledVector(b, Math.sin(a) * rad).addScaledVector(dir, (r() - 0.5) * 0.6);
          this.fibres.spawn(p, _v0.copy(dir).multiplyScalar(3 + r() * 5), 0.22 + r() * 0.12, 0.7 + r() * 0.9, 0.0022, 0.6, { curl: 0, seed: r() * 10, drag: 1, grav: 0, bright: 0.3, glow: 0.8, grow: 0.06 });
        }
      }
      if (z.started && z.state === 'attached') {
        z.t += dt;
        for (const l of z.lines) {
          if (l.state !== 'attached') continue;
          l.thrum = Math.max(0.35, 1 - z.t * 1.4);
          const d = l.hand.distanceTo(l.anchor);
          l._rest = Math.min(l._rest, d * 0.985);
        }
        if (z.t >= z.duration) z.release();
      }
      if (L.state === 'dead' && R.state === 'dead') { z.state = 'dead'; this.zips.splice(i, 1); }
    }
  }

  _updatePulls(dt) {
    for (let i = this.pulls.length - 1; i >= 0; i--) {
      const h = this.pulls[i], l = h.line;
      if (l.state === 'attached') {
        h.t += dt;
        if (!h.yanked && h.t >= 0.07) {
          h.yanked = true; h.t = 0; h.state = 'yanking';
          l._rest = l.hand.distanceTo(l.anchor) * 0.9;
          l.tension = 1; l.twang = 1;
          this._sound('sp_web_pull', l.anchor, 1.0);
          this._juiceSet(JUICE.pull);
          const dir = _v0.subVectors(l.hand, l.anchor).normalize().clone();
          h.onYank?.({ target: h.target, line: l, dir, point: l.anchor.clone() });
        } else if (h.yanked) {
          l._rest = Math.min(l._rest, l.hand.distanceTo(l.anchor) * 0.97);
          if (h.t >= 0.32) { l.retract(); h.state = 'retracting'; }
        }
      }
      if (l.state === 'dead') { h.state = 'dead'; this.pulls.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- hooks
  _sound(id, pos, gain = 1) { if (this.onSound) this.onSound(id, { position: pos.clone(), gain }); }
  _juice(kind, amount) { if (this.onJuice) this.onJuice(kind, amount); }
  _juiceSet(j) {
    if (!this.onJuice || !j) return;
    if (j.fov) this.onJuice('fov_kick', j.fov);
    if (j.hitstop) this.onJuice('hitstop', j.hitstop);
    if (j.shake) this.onJuice('shake', j.shake);
    if (j.rumble) this.onJuice('rumble', j.rumble);
  }
  _thwip(pos) {
    let k = 1 + Math.floor(this.rand() * 4);
    if (k === this._lastThwip) k = (k % 4) + 1;
    this._lastThwip = k;
    this._sound('sp_thwip_' + k, pos, 1.0);
  }
}
