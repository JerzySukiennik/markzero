// JUICE — the world's screen-space post pass (one full-screen shader, inserted before the tone-mapping
// OutputPass of the city composer): chromatic aberration, radial speed blur + speed lines, up to 4
// shockwave rings, up to 4 heat-haze spots (thrusters), sun flare + lens dirt, colour grade per time of
// day with a touch of the suit's glow, vignette, film grain, impact flash. Driven every frame by
// JuiceDriver from the local player's speed, the camera kicks and gameplay events.
// Cost on the HP at 1080p: measured with tools/hp_bench.sh (juice=0 vs 1).
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const JuiceShader = {
  name: 'MZJuice',
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 16 / 9 },
    uCA: { value: 0.0012 }, uRadial: { value: 0 }, uLines: { value: 0 },
    uShock: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 1, 0)) },
    uHaze: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
    uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, uFlare: { value: 0.35 }, uSunCol: { value: new THREE.Color(1, 0.9, 0.75) },
    uLift: { value: new THREE.Color(0, 0, 0) }, uGain: { value: new THREE.Color(1, 1, 1) }, uSat: { value: 1.06 }, uContrast: { value: 1.04 },
    uTint: { value: new THREE.Color(1, 1, 1) }, uVig: { value: 0.32 }, uGrain: { value: 0.028 }, uFlash: { value: new THREE.Vector4(1, 1, 1, 0) }, uFade: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uAspect, uCA, uRadial, uLines, uFlare, uSat, uContrast, uVig, uGrain;
    uniform float uFade; uniform vec4 uShock[4]; uniform vec4 uHaze[4]; uniform vec3 uSun, uSunCol, uLift, uGain, uTint; uniform vec4 uFlash;
    varying vec2 vUv;
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
    void main(){
      vec2 uv = vUv, c = vec2(0.5);
      // --- shockwave rings: refract the image outward across a thin expanding ring
      for (int i = 0; i < 4; i++) {
        vec4 s = uShock[i]; if (s.w <= 0.0 || s.z >= 1.0) continue;
        vec2 d = uv - s.xy; d.x *= uAspect; float r = length(d);
        float R = s.z * 0.55 * s.w + 0.02, w = 0.06 * (1.0 - s.z) + 0.01;
        float k = smoothstep(w, 0.0, abs(r - R)) * (1.0 - s.z) * s.w;
        vec2 n = r > 1e-4 ? d / r : vec2(0.0); n.x /= uAspect;
        uv -= n * k * 0.035;
      }
      // --- heat haze over thruster exhaust
      for (int i = 0; i < 4; i++) {
        vec4 h = uHaze[i]; if (h.w <= 0.0) continue;
        vec2 d = uv - h.xy; d.x *= uAspect; float m = smoothstep(h.z, 0.0, length(d)) * h.w;
        uv += (vec2(vn(uv * 60.0 + vec2(0.0, uTime * 7.0)), vn(uv * 60.0 - vec2(uTime * 5.0, 0.0))) - 0.5) * m * 0.012;
      }
      vec2 dc = uv - c; float dist = length(dc * vec2(uAspect, 1.0));
      vec3 col;
      // --- radial speed blur (only when moving fast) + chromatic aberration
      if (uRadial > 0.001) {
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 8; i++) { float t = float(i) / 7.0; vec2 o = dc * (1.0 - t * uRadial * dist);
          acc.r += texture2D(tDiffuse, c + o * (1.0 + uCA * 2.0 * dist)).r; acc.g += texture2D(tDiffuse, c + o).g; acc.b += texture2D(tDiffuse, c + o * (1.0 - uCA * 2.0 * dist)).b; }
        col = acc / 8.0;
      } else {
        vec2 o = dc * uCA * 2.0 * dist;
        col = vec3(texture2D(tDiffuse, uv + o).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - o).b);
      }
      // --- speed lines: thin bright streaks at the edges, streaming outward
      if (uLines > 0.001) {
        float a = atan(dc.y, dc.x);
        float streak = pow(vn(vec2(a * 40.0, dist * 3.0 - uTime * 9.0)), 12.0) * smoothstep(0.25, 0.75, dist);
        col += vec3(streak) * uLines * 0.7;
      }
      // --- sun flare: glare + ghosts along the axis + lens dirt lit by the sun
      if (uSun.z > 0.0) {
        vec2 ds = (vUv - uSun.xy) * vec2(uAspect, 1.0); float gs = exp(-length(ds) * 6.0);
        vec2 axis = c - uSun.xy; float ghosts = 0.0;
        for (int i = 1; i <= 3; i++) { vec2 gp = uSun.xy + axis * (float(i) * 0.55); vec2 gd = (vUv - gp) * vec2(uAspect, 1.0); ghosts += smoothstep(0.06 + 0.03 * float(i), 0.0, length(gd)) * 0.18 / float(i); }
        float dirt = smoothstep(0.55, 0.9, vn(vUv * vec2(uAspect, 1.0) * 7.0)) * 0.6 + smoothstep(0.7, 0.95, vn(vUv * 23.0)) * 0.4;
        col += uSunCol * uSun.z * uFlare * (gs * 0.6 + ghosts + dirt * exp(-length(ds) * 1.6) * 0.25);
      }
      // --- grade (lift / gain / saturation / contrast) with the suit tint in the highlights
      col = col * uGain + uLift;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = mix(col, col * uTint, smoothstep(0.6, 2.5, l) * 0.35);
      col = (col - 0.18) * uContrast + 0.18;
      col = max(col, 0.0);
      // --- impact flash, vignette, grain
      col = mix(col, uFlash.rgb * 2.0, uFlash.a);
      col *= 1.0 - uVig * smoothstep(0.35, 1.05, dist);
      col += (h21(vUv * 1024.0 + fract(uTime * 13.7)) - 0.5) * uGrain * (0.4 + l);
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createJuicePass() { return new ShaderPass(JuiceShader); }

/** Drives the juice pass from the game state. */
export class JuiceDriver {
  constructor(world, pass) {
    this.world = world; this.pass = pass; this.u = pass.uniforms;
    this.shocks = []; this.flash = 0; this.flashCol = new THREE.Color(1, 1, 1); this.enabled = true;
    this._v = new THREE.Vector3(); this._n = new THREE.Vector3();
  }
  /** Shockwave ring at a world position (strength 0.3 small … 1.5 huge). */
  shock(pos, strength = 1, life = 0.55) {
    this.shocks.push({ pos: pos.clone(), s: strength, t: 0, life });
    if (this.shocks.length > 4) this.shocks.shift();
  }
  flashScreen(amount = 0.25, color = 0xffffff) { this.flash = Math.max(this.flash, amount); this.flashCol.set(color); }

  update(dt, t, cam, local) {
    const u = this.u, W = this.world;
    this.pass.enabled = this.enabled || this.u.uFade.value > 0;
    if (!this.enabled) return;
    u.uTime.value = t % 1000;
    const sz = W.MZ.stage.size; u.uAspect.value = sz.w / sz.h;
    if (W.nanGuard) W.nanGuard.uniforms.uTexel.value.set(1 / (sz.w * sz.dpr), 1 / (sz.h * sz.dpr));
    // speed → radial blur, speed lines, aberration
    const hud = local?.hud?.() || {}, top = hud.hero === 'spiderman' ? 45 : 320;
    // Spider-Man reports how fast it should FEEL (hud.juice 0..1: wall run, swing speed) — take the larger
    const sp = Math.min(1.4, Math.max((hud.speed || 0) / top, hud.juice ?? 0)), boost = hud.boost ? (typeof hud.boost === 'number' ? Math.min(1, hud.boost) : 1) : 0;
    const kick = W.kickState?.trauma || 0;
    const tgt = Math.min(0.09, Math.max(0, sp - 0.3) * 0.07 + boost * 0.03);   // fraction of the distance to the centre
    u.uRadial.value += ((this.reduce ? tgt * 0.3 : tgt) - u.uRadial.value) * Math.min(1, dt * 6);
    u.uLines.value += ((Math.max(0, sp - 0.5) * 0.5 + boost * 0.25) - u.uLines.value) * Math.min(1, dt * 5);
    u.uCA.value = 0.0015 + sp * 0.002 + kick * 0.006 + boost * 0.002;
    // shockwaves (screen space)
    for (let i = 0; i < 4; i++) {
      const s = this.shocks[i], v = u.uShock.value[i];
      if (!s) { v.w = 0; continue; }
      s.t += dt;
      const p = this._v.copy(s.pos).project(cam);
      const behind = p.z > 1;
      v.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, Math.min(1, s.t / s.life), behind ? 0 : s.s);
    }
    this.shocks = this.shocks.filter(s => s.t < s.life);
    // heat haze behind the nearest thrusters (local + others)
    let hi = 0;
    for (const pl of W.MZ.game.players.values()) {
      if (hi >= 4 || pl.hero !== 'ironman' || !pl.root) continue;
      const th = pl.hud?.()?.throttle ?? 0.6;
      for (const n of ['piv_thrusterL', 'piv_thrusterR']) {
        if (hi >= 4) break;
        const node = pl.root.getObjectByName(n); if (!node) continue;
        const wp = node.getWorldPosition(this._v); this._n.set(0, -0.6, 0).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion())); wp.add(this._n);
        const d = wp.distanceTo(cam.position), p = wp.project(cam);
        if (p.z > 1 || d > 60) continue;
        u.uHaze.value[hi++].set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, Math.min(0.12, 1.6 / d), Math.min(1, th) * 0.9);
      }
    }
    for (; hi < 4; hi++) u.uHaze.value[hi].w = 0;
    // sun flare: the city's sun direction
    const sd = W.cr?.sunDir || W.cr?.csm?.lightDirection;
    if (sd) {
      const sp3 = this._v.copy(sd).multiplyScalar(-5000).add(cam.position).project(cam);
      const onScreen = sp3.z < 1 && Math.abs(sp3.x) < 1.3 && Math.abs(sp3.y) < 1.3;
      const vis = onScreen ? Math.max(0, 1 - Math.max(Math.abs(sp3.x), Math.abs(sp3.y)) / 1.3) : 0;
      u.uSun.value.set(sp3.x * 0.5 + 0.5, sp3.y * 0.5 + 0.5, vis * (W.cr?.tod?.night > 0.5 ? 0 : 1));
    }
    // grade by hour (golden warm, night cool) + suit glow tint
    const hour = W.cr?.hour ?? 15, gold = Math.max(0, 1 - Math.abs(hour - 19) / 2.5), night = hour > 20.5 || hour < 5.5 ? 1 : 0;
    u.uLift.value.setRGB(0.004 * gold, 0.002 * gold, 0.006 * night);
    u.uGain.value.setRGB(1 + 0.06 * gold - 0.04 * night, 1 + 0.01 * gold - 0.01 * night, 1 - 0.05 * gold + 0.06 * night);
    u.uTint.value.copy(W.MZ.theme.c.glow).lerp(new THREE.Color(1, 1, 1), 0.55);
    // flash
    this.flash = Math.max(0, this.flash - dt * 3.5);
    u.uFlash.value.set(this.flashCol.r, this.flashCol.g, this.flashCol.b, this.flash);
  }
}

/** NaN/Inf guard right after the scene render: a NaN pixel would be spread by the bloom mip chain into the
 * black squares Jurek saw on the HP (ANGLE D3D11). Bad pixels take the mean of their finite neighbours;
 * HDR is clamped to 64 so single fireflies cannot flood the bloom either. Bit-exact test (isnan may be optimised away). */
export function createNanGuardPass() {
  return new ShaderPass({
    name: 'MZNanGuard',
    uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
      bool badF(float v) { return (floatBitsToUint(v) & 0x7f800000u) == 0x7f800000u; }
      bool bad4(vec4 c) { return badF(c.r) || badF(c.g) || badF(c.b) || badF(c.a); }
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        if (bad4(c)) {
          vec4 s = vec4(0.0); float n = 0.0;
          for (int i = 0; i < 4; i++) {
            vec2 o = i == 0 ? vec2(uTexel.x, 0.0) : i == 1 ? vec2(-uTexel.x, 0.0) : i == 2 ? vec2(0.0, uTexel.y) : vec2(0.0, -uTexel.y);
            vec4 q = texture2D(tDiffuse, vUv + o * 2.0); if (!bad4(q)) { s += q; n += 1.0; }
          }
          c = n > 0.0 ? s / n : vec4(0.0, 0.0, 0.0, 1.0);
        }
        gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), clamp(c.a, 0.0, 1.0));
      }`,
  });
}
