// Thruster plumes in V2's look (game/scripts/flight/thrusters.gd, the one Jurek liked): a blown-out
// white core, a temperature ramp in the glow around it, length that GROWS with throttle (not just
// fades), per-emitter flicker, and hot grit left behind in world space.
//
// Why not gfx/vfx.js Thruster: its cones take alpha from |N·V| (rim), which is ~0 on every face
// when the cone points at the camera — exactly what boots do in forward flight seen from the
// chase camera, so the plumes vanished (playtest 1). Here every layer reads from any angle:
//   core + glow   cylinders hung from the nozzle (−Y), alpha NOT rim-gated (only softened)
//   stack         camera-facing glow sprites along the jet axis — what you see end-on
//   grit          world-space additive points (one pool per hero): emitted at the nozzle along
//                 −Y at exhaust speed, NOT carrying the suit's velocity, so at 200 m/s they
//                 stretch into a visible stream behind him
// No lights (ADR-001 fixed light pool).
import * as THREE from 'three';

const PAL = {
  repulsor: { hot: new THREE.Color(1, 1, 1), mid: new THREE.Color(0.55, 0.82, 1.0), cool: new THREE.Color(0.12, 0.32, 1.0) },
  flame: { hot: new THREE.Color(1, 0.97, 0.9), mid: new THREE.Color(1.0, 0.6, 0.16), cool: new THREE.Color(0.6, 0.14, 0.03) },
};
let TEX = null;
function glowTex() {
  if (TEX) return TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.8)'); g.addColorStop(0.5, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  TEX = new THREE.CanvasTexture(c); TEX.colorSpace = THREE.SRGBColorSpace; return TEX;
}

const VS = `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vec4 wp = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`;
const FS = `uniform float uT, uL, uSeed, uLayer; uniform vec3 uHot, uMid, uCool; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float h(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
void main(){
  float v = 1. - vUv.y;                                   // 0 nozzle .. 1 tip
  float rim = abs(dot(normalize(vN), normalize(vV)));
  float soft = mix(0.55, 1.0, pow(rim, 1.5));             // NOT rim-gated: end-on stays visible
  float n = n2(vec2(vUv.x*7. + uSeed, v*5. - uT*11.));
  float len = smoothstep(1., 0.1 + 0.35*n, v);
  vec3 col = mix(uHot, uMid, smoothstep(0.04, uLayer < .5 ? 0.55 : 0.3, v));
  col = mix(col, uCool, smoothstep(0.35, 1.0, v));
  float a = soft * len * (0.6 + 0.5*n) * uL * (uLayer < .5 ? 1.3 : 0.45);
  gl_FragColor = vec4(col * a * (uLayer < .5 ? 3.0 : 1.8), a);
}`;

export class Plume {
  constructor(node, { style = 'repulsor', scale = 1 } = {}) {
    this.node = node; this.scale = scale; this.level = 0; this.target = 0; this.seed = Math.random() * 10;
    this.pal = PAL[style] || PAL.repulsor;
    this.g = new THREE.Group(); this.g.name = '__plume';
    this.mats = [];
    const cyl = (r0, r1, len, layer) => {
      const geo = new THREE.CylinderGeometry(r1, r0, len, 20, 8, true); geo.translate(0, -len / 2, 0);
      const m = new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 }, uL: { value: 0 }, uSeed: { value: this.seed }, uLayer: { value: layer },
        uHot: { value: this.pal.hot }, uMid: { value: this.pal.mid }, uCool: { value: this.pal.cool } },
        vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      this.mats.push(m); const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false; mesh.renderOrder = 10; this.g.add(mesh); return mesh;
    };
    // V2 sizes: core r 0.052→0.012 over 0.95 m, glow r 0.16→0.05 over 1.5 m
    this.core = cyl(0.052, 0.012, 0.95, 0); this.glow = cyl(0.16, 0.05, 1.5, 1);
    this.stack = [];
    for (let i = 0; i < 5; i++) {
      const u = i / 4, col = this.pal.hot.clone().lerp(this.pal.mid, Math.min(1, u * 1.6)).lerp(this.pal.cool, Math.max(0, u - 0.5) * 1.4);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
      s.renderOrder = 11; this.g.add(s); this.stack.push({ s, u });
    }
    this.g.scale.setScalar(scale);
    node.add(this.g);
    this._p = new THREE.Vector3(); this._d = new THREE.Vector3(); this._q = new THREE.Quaternion();
  }
  set(v) { this.target = v; }
  update(dt, t, grit) {
    this.level += (this.target - this.level) * (1 - Math.exp(-dt / 0.05));
    const fl = 0.9 + 0.1 * Math.sin(t * 31 + this.seed * 2.3) + 0.05 * (Math.random() - 0.5);
    const L = Math.max(0, this.level) * fl, on = L > 0.02;
    this.g.visible = on;
    if (!on) return;
    const stretch = 0.45 + L * 1.25, wide = 0.7 + L * 0.45;         // V2: the jet LENGTHENS with throttle
    this.core.scale.set(wide, stretch, wide); this.glow.scale.set(wide, stretch * 1.05, wide);
    for (const m of this.mats) { m.uniforms.uT.value = t; m.uniforms.uL.value = Math.min(1.3, L); }
    for (const { s, u } of this.stack) {
      s.position.set(0, -(0.05 + u * 1.1 * stretch), 0);
      s.scale.setScalar((0.34 - u * 0.16) * (0.6 + 0.6 * L) * (u === 0 ? 1.35 : 1));
      s.material.opacity = Math.min(1, L * (1.1 - u * 0.75));
    }
    if (grit && L > 0.08) {                                           // hot grit, left behind in world space
      this.node.getWorldPosition(this._p); this.node.getWorldQuaternion(this._q);
      const d = this._d.set(0, -1, 0).applyQuaternion(this._q);
      const n = L * 70 * dt * this.scale; let k = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      while (k-- > 0) grit.emit(this._p, d, (5 + 5 * L) * this.scale, (0.11 + 0.1 * L) * this.scale, 0.12 + 0.08 * Math.random(), this.pal);
    }
  }
  dispose() { this.g.removeFromParent(); this.g.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
}

/** World-space additive exhaust particles (one pool per hero, ~one draw call). */
export class Grit {
  constructor(scene, max = 480) {
    this.max = max; this.i = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1e9); this.life = new Float32Array(max).fill(1); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: glowTex() }, uScale: { value: 600 } },
      vertexShader: `attribute float psize; attribute float palpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = palpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = psize * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC * t.a * vA * 2.2, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 12; this.points.name = '__grit';
    scene.add(this.points); this.g = g; this.pal = [];
  }
  emit(p, d, speed, size, life, pal) {
    const i = this.i = (this.i + 1) % this.max, j = i * 3, sp = speed * (0.8 + 0.4 * Math.random()), jit = 0.12;
    this.pos[j] = p.x; this.pos[j + 1] = p.y; this.pos[j + 2] = p.z;
    this.vel[j] = (d.x + (Math.random() - 0.5) * jit) * sp; this.vel[j + 1] = (d.y + (Math.random() - 0.5) * jit) * sp; this.vel[j + 2] = (d.z + (Math.random() - 0.5) * jit) * sp;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.pal[i] = pal;
  }
  update(dt, camera, renderer) {
    if (renderer) this.points.material.uniforms.uScale.value = renderer.domElement.height * 0.5 / Math.tan((camera?.fov || 60) * Math.PI / 360);
    for (let i = 0; i < this.max; i++) {
      const j = i * 3; this.age[i] += dt; const k = this.age[i] / this.life[i];
      if (k >= 1) { this.alpha[i] = 0; continue; }
      const damp = Math.exp(-dt * 12);
      this.vel[j] *= damp; this.vel[j + 1] *= damp; this.vel[j + 2] *= damp;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const pal = this.pal[i], c = k < 0.25 ? pal.hot.clone().lerp(pal.mid, k / 0.25) : pal.mid.clone().lerp(pal.cool, (k - 0.25) / 0.75);
      this.col[j] = c.r; this.col[j + 1] = c.g; this.col[j + 2] = c.b;
      this.alpha[i] = (1 - k) * (k < 0.1 ? k / 0.1 : 1) * 0.55;
      this.size[i] *= 1 + dt * 2.2;
    }
    for (const n of ['position', 'color', 'psize', 'palpha']) this.g.attributes[n].needsUpdate = true;
  }
  dispose() { this.points.removeFromParent(); this.g.dispose(); this.points.material.dispose(); }
}
