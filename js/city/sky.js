// Sky dome + time-of-day model. Preetham scattering (after three's Sky.js), clouds, and a
// proper night: stars, moon, and a city light-dome glow on the horizon.
import * as THREE from 'three';

const D2R = Math.PI / 180;

// ------------------------------------------------------------------------------------------
// time of day. The world: +X east, north = -Z. Sun rises ENE, sets WNW, south at noon.
// ------------------------------------------------------------------------------------------
const KEYS = [
  // hour, night, litFrac, interiorDay, streetGlow, exposure, turbidity, rayleigh, mie, fogDensity, bloom, cloud
  [0.0, 1.00, 0.30, 0.00, 1.0, 1.25, 2.0, 0.6, 0.004, 0.00016, 0.9, 0.35],
  [4.5, 1.00, 0.16, 0.00, 1.0, 1.25, 2.0, 0.6, 0.004, 0.00018, 0.9, 0.35],
  [5.6, 0.75, 0.22, 0.02, 0.8, 1.35, 3.0, 1.2, 0.006, 0.00022, 0.8, 0.40],
  [6.3, 0.35, 0.25, 0.05, 0.35, 1.30, 4.5, 2.6, 0.010, 0.00024, 0.7, 0.42],
  [7.5, 0.05, 0.20, 0.07, 0.0, 0.82, 3.5, 1.6, 0.006, 0.00015, 0.5, 0.40],
  [12.5, 0.0, 0.15, 0.08, 0.0, 0.58, 2.6, 1.0, 0.004, 0.00011, 0.45, 0.35],
  [17.0, 0.0, 0.18, 0.075, 0.0, 0.72, 3.2, 1.3, 0.005, 0.00012, 0.5, 0.40],
  [18.9, 0.12, 0.32, 0.06, 0.1, 1.1, 4.0, 2.4, 0.007, 0.00013, 0.7, 0.45],
  [19.9, 0.70, 0.55, 0.02, 0.8, 1.30, 3.5, 2.0, 0.008, 0.00020, 0.9, 0.40],
  [21.5, 1.00, 0.52, 0.00, 1.0, 1.25, 2.2, 0.8, 0.005, 0.00017, 0.9, 0.35],
  [24.0, 1.00, 0.30, 0.00, 1.0, 1.25, 2.0, 0.6, 0.004, 0.00016, 0.9, 0.35],
];

// ?cityLook=0 (HP fallback): the pre-2026-09-26 interior brightness, exposure and sun ramp. render.js sets LOOK.v3.
export const LOOK = { v3: true };
const OLD_KEYS = { 0: [0, 1.25], 4.5: [0, 1.25], 5.6: [0.05, 1.35], 6.3: [0.14, 1.3], 7.5: [0.28, 1.05], 12.5: [0.34, 0.75],
  17: [0.32, 0.95], 18.9: [0.22, 1.35], 19.9: [0.08, 1.3], 21.5: [0, 1.25], 24: [0, 1.25] };

export function sunDirection(hour, out = new THREE.Vector3()) {
  const rise = 6.0, set = 19.6, peak = 58;
  let el, az;
  if (hour >= rise && hour <= set) {
    const t = (hour - rise) / (set - rise);
    el = peak * Math.sin(Math.PI * t);
    az = 70 + 220 * t;
  } else {
    const nl = 24 - (set - rise);
    const t = ((hour - set + 24) % 24) / nl;
    el = -38 * Math.sin(Math.PI * t);
    az = 290 + 140 * t;
  }
  const e = el * D2R, a = az * D2R;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}

export function timeOfDay(hour) {
  hour = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= hour) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = THREE.MathUtils.smoothstep(hour, a[0], b[0]);
  const L = k => a[k] + (b[k] - a[k]) * t;
  const OL = k => OLD_KEYS[a[0]][k] + (OLD_KEYS[b[0]][k] - OLD_KEYS[a[0]][k]) * t;
  const sun = sunDirection(hour);
  const el = Math.asin(sun.y) / D2R;
  // sun colour: white high, orange/red near the horizon (Kelvin-ish ramp)
  // warmth starts earlier (NYC late afternoon light is already amber at 25-30 deg) and is gentler at the top
  const warm = Math.pow(THREE.MathUtils.clamp((32 - el) / 28, 0, 1), 1.3);
  const sunColor = new THREE.Color().setRGB(1.0, 0.97 - 0.5 * warm, 0.92 - 0.8 * warm);
  if (!LOOK.v3) { const w0 = THREE.MathUtils.clamp((22 - el) / 18, 0, 1); sunColor.setRGB(1.0, 1.0 - 0.55 * w0, 1.0 - 0.85 * w0); }
  const sunUp = THREE.MathUtils.smoothstep(el, -2.5, 6);
  // low sun loses most of its power to the atmosphere (golden hour ~half of noon)
  const sunI = 5.0 * sunUp * (0.55 + 0.45 * THREE.MathUtils.smoothstep(el, 0, 35));
  // moon: opposite-ish of the sun, high in the south at midnight
  const moon = sunDirection((hour + 12) % 24).clone();
  moon.y = Math.abs(moon.y) * 0.85 + 0.25; moon.normalize();
  const night = L(1);
  return {
    hour, sun, el, sunColor, sunI, moon, night,
    litFrac: L(2), interiorDay: LOOK.v3 ? L(3) : OL(0), streetGlow: L(4), exposure: LOOK.v3 ? L(5) : OL(1),
    turbidity: L(6), rayleigh: L(7), mie: L(8), fogDensity: L(9), bloom: L(10), cloud: L(11),
    moonI: 0.07 * night,
  };
}

// ------------------------------------------------------------------------------------------
// sky dome
// ------------------------------------------------------------------------------------------
const VERT = /* glsl */`
uniform vec3 sunPosition;
uniform float rayleigh, turbidity, mieCoefficient;
varying vec3 vWorldPosition;
varying vec3 vSunDirection;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
const float e = 2.718281828459045;
const float pi = 3.141592653589793;
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;
float sunIntensity(float c) { c = clamp(c, -1.0, 1.0); return EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(c)) / steepness))); }
vec3 totalMie(float T) { float c = (0.2 * T) * 10E-18; return 0.434 * c * MieConst; }
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPosition = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
  vSunDirection = normalize(sunPosition);
  vSunE = sunIntensity(vSunDirection.y);
  vSunfade = 1.0 - clamp(1.0 - exp((sunPosition.y / 450000.0)), 0.0, 1.0);
  float rc = rayleigh - (1.0 * (1.0 - vSunfade));
  vBetaR = totalRayleigh * rc;
  vBetaM = totalMie(turbidity) * mieCoefficient;
}`;

const FRAG = /* glsl */`
varying vec3 vWorldPosition;
varying vec3 vSunDirection;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
uniform float mieDirectionalG, uGain, uNight, uCloud, uTime;
uniform vec3 uMoonDir, uHorizonGlow, uFogA, uFogB, uGround;
uniform float uHaze, uProbe;
const float pi = 3.141592653589793;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.9999566769;
float rayleighPhase(float c) { return 0.05968310365946075 * (1.0 + c * c); }
float hgPhase(float c, float g) { float g2 = g * g; return 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * g * c + g2, 1.5)); }
vec2 grad(vec2 i) { vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0; }
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(dot(grad(i), f), dot(grad(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
             mix(dot(grad(i + vec2(0, 1)), f - vec2(0, 1)), dot(grad(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y) * 1.6;
}
float fbm(vec2 p, float drift) { float r = 0.0, a = 1.0; for (int i = 0; i < 5; i++) { r += a * gnoise(p); a *= 0.5; p = p * 2.0 + drift; } return r; }
float h3(vec3 p) { p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }

void main() {
  vec3 direction = normalize(vWorldPosition - cameraPosition);
  vec3 dirUp = vec3(direction.x, max(direction.y, 0.0), direction.z);
  float zenithAngle = acos(max(0.0, direction.y));
  float inv = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
  float sR = rayleighZenithLength * inv;
  float sM = mieZenithLength * inv;
  vec3 Fex = exp(-(vBetaR * sR + vBetaM * sM));
  float cosTheta = dot(direction, vSunDirection);
  vec3 betaRTheta = vBetaR * rayleighPhase(cosTheta * 0.5 + 0.5);
  vec3 betaMTheta = vBetaM * hgPhase(cosTheta, mieDirectionalG);
  vec3 Lin = pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - vSunDirection.y, 5.0), 0.0, 1.0));
  vec3 L0 = vec3(0.1) * Fex;
  float sundisc = smoothstep(sunAngularDiameterCos - 0.00004, sunAngularDiameterCos + 0.00002, cosTheta);
  vec3 col = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  col += sundisc * min(vSunE * Fex * 0.02, vec3(9.0)) * step(0.0, direction.y + 0.01);

  // ---- night: deep blue gradient, stars, moon, orange light-dome over the city
  float up = max(direction.y, 0.0);
  vec3 nightSky = mix(vec3(0.010, 0.016, 0.034), vec3(0.0025, 0.0045, 0.012), pow(up, 0.5));
  nightSky += uHorizonGlow * exp(-up * 9.0);
  vec3 sd = floor(direction * 420.0);
  float star = step(0.9975, h3(sd)) * h3(sd + 3.1) * smoothstep(0.02, 0.2, up);
  nightSky += vec3(0.9, 0.95, 1.0) * star * 0.9;
  float md = dot(direction, uMoonDir);
  nightSky += vec3(0.8, 0.85, 0.9) * smoothstep(0.99955, 0.9997, md) * 2.5;
  nightSky += vec3(0.05, 0.07, 0.1) * pow(max(md, 0.0), 60.0) * 0.6;
  col = mix(col, nightSky, uNight);

  // ---- clouds (a single layer projected on a plane)
  if (direction.y > 0.0 && uCloud > 0.0) {
    vec2 cuv = direction.xz / (direction.y * 0.55 + 0.02) * 0.35;
    cuv += uTime * 0.0035;
    float n = clamp(fbm(cuv * 1.3, uTime * 0.01) * 0.65 + 0.5, 0.0, 1.0);
    float region = gnoise(cuv * 0.25) * 0.35 + 0.5;
    float cov = clamp(uCloud + (region - 0.5) * 0.6, 0.0, 1.0);
    float th = 1.0 - cov;
    float mask = smoothstep(th, th + 0.3, n) * smoothstep(0.0, 0.08, direction.y);
    float depth = max(0.0, n - th);
    float beer = exp(-depth * 4.0);
    float shade = mix(0.45, 1.0, clamp(beer * (1.0 - beer * beer) * 2.6, 0.0, 1.0));
    float dayF = smoothstep(-0.12, 0.25, vSunDirection.y);
    vec3 sunCol = vSunE * Fex * 0.22 * 0.04;
    vec3 amb = Lin * 0.04 + vec3(0.0, 0.0003, 0.00075);
    float silver = clamp(0.51 / pow(1.49 - cosTheta * 1.4, 1.5), 0.0, 3.0);
    vec3 cc = amb + sunCol * shade + sunCol * silver * mask * (1.0 - mask) * 2.4;
    cc = mix(cc * max(dayF, 0.05), uHorizonGlow * 2.2 + vec3(0.012, 0.014, 0.02), uNight);
    float alpha = (1.0 - exp(-depth * 5.0)) * smoothstep(0.0, 0.08, direction.y);
    col = mix(col, mix(col, cc, Fex.g * 0.6 + 0.4), alpha);
  }
  col *= uGain;   // dome normalisation (render.js updateEnv); fog colours arrive pre-scaled
  // aerial haze: the sky sinks into exactly the colour the geometry fog uses (cityFog), and
  // below the horizon IS that fog colour, so terrain/water/fog/sky meet without a band.
  // (uHaze = 0 while render.js samples the raw horizon colour for the fog.)
  vec3 fogc = mix(uFogA, uFogB, pow(max(dot(direction, vSunDirection), 0.0), 8.0) * 0.85);
  col = mix(col, fogc, uHaze * exp(-max(direction.y, 0.0) * 22.0) * 0.85);
  if (direction.y < 0.0) {
    // visible dome: fog colour; reflection probe: a dim ground bounce (the lower hemisphere of the
    // environment is the ground, not more sky — otherwise shadows are lit from below)
    // lower hemisphere of the environment = light bounced off the city (sunlit asphalt, stone, brick):
    // warm and fairly bright by day. It was a dim copy of the blue fog — shadowed streets were lit by blue sky only.
    vec3 ground = uGround + fogc * 0.06;
    col = mix(uHaze > 0.5 ? fogc : col, ground, uProbe * smoothstep(0.0, -0.12, direction.y));
  }
  gl_FragColor = vec4(min(col, vec3(6.0)), 1.0);   // clamp the sun's Mie halo (bloom input)
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SkyDome extends THREE.Mesh {
  constructor() {
    const mat = new THREE.ShaderMaterial({
      name: 'city_sky', vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        sunPosition: { value: new THREE.Vector3(0, 1, 0) }, rayleigh: { value: 1 }, turbidity: { value: 2 },
        mieCoefficient: { value: 0.005 }, mieDirectionalG: { value: 0.8 }, uGain: { value: 1.0 },
        uNight: { value: 0 }, uCloud: { value: 0.4 }, uTime: { value: 0 },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uHorizonGlow: { value: new THREE.Color(0.05, 0.03, 0.02) },
        uFogA: { value: new THREE.Color(0.5, 0.55, 0.6) }, uFogB: { value: new THREE.Color(0.8, 0.7, 0.6) }, uHaze: { value: 1 }, uProbe: { value: 0 }, uGround: { value: new THREE.Color(0.1, 0.09, 0.08) },
      },
    });
    super(new THREE.SphereGeometry(1, 48, 24), mat);
    this.name = 'city_sky';
    this.frustumCulled = false;
    this.renderOrder = -1000;
    this.scale.setScalar(12000);
    this.onBeforeRender = (r, s, cam) => { this.position.copy(cam.position); this.updateMatrixWorld(); };
  }
  set(tod) {
    const u = this.material.uniforms;
    u.sunPosition.value.copy(tod.sun).multiplyScalar(450000);
    u.turbidity.value = tod.turbidity; u.rayleigh.value = tod.rayleigh; u.mieCoefficient.value = tod.mie;
    u.uNight.value = tod.night; u.uCloud.value = tod.cloud;
    u.uMoonDir.value.copy(tod.moon);
    u.uHorizonGlow.value.setRGB(0.045, 0.028, 0.018).multiplyScalar(0.4 + 0.6 * tod.night);
  }
}
