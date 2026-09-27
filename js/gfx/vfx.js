// V3 VFX — copied from next/showroom/js/vfx.js (2026-09-25) and changed for the game:
// NO light is ever created or removed at runtime (three.js recompiles every material when the light
// count changes — with the city's facade shader that froze the game for seconds per shot). All light
// comes from a fixed LightPool made once with the world.
// Showroom VFX: repulsors, thrusters, trails, sparks, smoke, flashes.
// These are also the REFERENCE for the Godot port (see assets/vfx/repulsor/NOTES.md).
import * as THREE from 'three';

const TMP = new THREE.Vector3(), TMP2 = new THREE.Vector3(), TMP3 = new THREE.Vector3();
const Q = new THREE.Quaternion();

// ---------------------------------------------------------------- shared textures
function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function ringTexture(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, size * 0.30, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,1)'); g.addColorStop(0.7, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function smokeTexture(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const r = size * (0.12 + Math.random() * 0.22), px = size / 2 + (Math.random() - 0.5) * size * 0.35, py = size / 2 + (Math.random() - 0.5) * size * 0.35;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let TEX = null;
function tex() {
  if (!TEX) TEX = {
    glow: radialTexture([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.85)'], [0.45, 'rgba(255,255,255,0.22)'], [1, 'rgba(255,255,255,0)']]),
    soft: radialTexture([[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]),
    ring: ringTexture(), smoke: smokeTexture(),
  };
  return TEX;
}

const NOISE_GLSL = /* glsl */`
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=.5; } return s; }
`;

// ---------------------------------------------------------------- thruster plume
// A layered plume along the emitter's local -Y: white-hot core, coloured sheath with scrolling
// turbulence, Mach diamonds, a nozzle disc and a flickering light. `style`:
//   'repulsor'  white core -> ice blue (Mk II..85)      'flame'  white -> amber -> smoke (Mk I, Hulkbuster rockets)
const PLUME_VS = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vec4 wp = modelMatrix*vec4(position,1.);
  vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-wp.xyz);
  gl_Position = projectionMatrix*viewMatrix*wp; }`;
const PLUME_FS = /* glsl */`
uniform float uTime, uThrust, uSeed, uLayer; uniform vec3 uHot, uMid, uCool;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
${NOISE_GLSL}
void main(){
  float v = 1. - vUv.y;                 // 0 at nozzle, 1 at tip
  float rim = abs(dot(normalize(vN), normalize(vV)));
  float soft = pow(rim, uLayer < .5 ? 1.2 : 2.2);
  float n = fbm(vec2(vUv.x*6. + uSeed, v*4. - uTime*9.));
  float n2 = fbm(vec2(vUv.x*11. - uSeed, v*9. - uTime*15.));
  float len = smoothstep(1., .15 + .35*n, v);            // ragged tip
  float diamonds = pow(.5+.5*cos(v*38. - uTime*2.), 10.) * smoothstep(.65,.05,v) * step(uLayer,.5);
  float a = soft * len * (0.55 + 0.6*n2) * uThrust;
  vec3 col = mix(uHot, uMid, smoothstep(.0,.35,v));
  col = mix(col, uCool, smoothstep(.3,.95,v));
  col += uHot * diamonds * 1.8;
  a *= uLayer < .5 ? 1.25 : .55;
  gl_FragColor = vec4(col * a * 2.2, a);
}`;

export class Thruster {
  constructor(node, { style = 'repulsor', scale = 1, light = false } = {}) {
    this.node = node; this.style = style; this.scale = scale; this.level = 0; this.target = 0;
    const pal = style === 'flame'
      ? { hot: new THREE.Color(1, 0.95, 0.85), mid: new THREE.Color(1.0, 0.55, 0.12), cool: new THREE.Color(0.5, 0.12, 0.02) }
      : { hot: new THREE.Color(1, 1, 1), mid: new THREE.Color(0.55, 0.82, 1.0), cool: new THREE.Color(0.12, 0.32, 1.0) };
    this.group = new THREE.Group(); this.group.name = '__thruster';
    this.mats = [];
    const mk = (r0, r1, len, layer) => {
      const g = new THREE.CylinderGeometry(r1, r0, len, 24, 12, true);
      g.translate(0, -len / 2, 0);
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uThrust: { value: 0 }, uSeed: { value: Math.random() * 10 }, uLayer: { value: layer },
          uHot: { value: pal.hot }, uMid: { value: pal.mid }, uCool: { value: pal.cool } },
        vertexShader: PLUME_VS, fragmentShader: PLUME_FS, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      });
      this.mats.push(m);
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 10;
      this.group.add(mesh); return mesh;
    };
    this.core = mk(0.028, 0.006, 0.34, 0);
    this.sheath = mk(0.05, 0.012, 0.75, 1);
    this.outer = mk(0.075, 0.03, 1.1, 1);
    const disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex().glow, color: style === 'flame' ? 0xffc27a : 0xcfe8ff,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    disc.scale.setScalar(0.22); this.disc = disc; this.group.add(disc);
    if (light) { this.light = new THREE.PointLight(style === 'flame' ? 0xffa050 : 0x9fd0ff, 0, 5, 1.6); this.light.position.y = -0.12; this.group.add(this.light); }
    this.group.scale.setScalar(scale);
    node.add(this.group);
  }
  set(v) { this.target = v; }
  update(dt, t) {
    this.level += (this.target - this.level) * Math.min(1, dt * 14);
    const flick = 0.9 + 0.1 * Math.sin(t * 60 + this.mats[0].uniforms.uSeed.value) + 0.06 * (Math.random() - 0.5);
    const L = Math.max(0, this.level) * flick;
    for (const m of this.mats) { m.uniforms.uTime.value = t; m.uniforms.uThrust.value = Math.min(1.4, L); }
    const s = 0.4 + 0.75 * L;
    this.core.scale.set(1, s, 1); this.sheath.scale.set(1, 0.3 + 0.9 * L, 1); this.outer.scale.set(1 + 0.3 * L, 0.2 + 1.0 * L, 1 + 0.3 * L);
    this.disc.material.opacity = Math.min(1, L * 1.4); this.disc.scale.setScalar((0.16 + 0.12 * L) * flick);
    this.group.visible = L > 0.01;
    if (this.light) this.light.intensity = 6 * L * this.scale;
  }
  dispose() { this.node.remove(this.group); this.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
}

// ---------------------------------------------------------------- ribbon trail
const TRAIL_FS = /* glsl */`
uniform float uTime; uniform vec3 uColor, uHot; varying vec2 vUv; varying float vAge;
${NOISE_GLSL}
void main(){
  float edge = 1. - abs(vUv.y*2.-1.); edge = smoothstep(0., .9, edge);
  float n = fbm(vec2(vUv.x*3. - uTime*.3, vUv.y*2.5 + vUv.x));
  float fade = (1.-vAge); fade *= fade;
  float a = edge * fade * (.45 + .75*n) * smoothstep(0., .04, vAge);
  vec3 col = mix(uHot, uColor, smoothstep(0., .12, vAge));
  gl_FragColor = vec4(col, a);
}`;
const TRAIL_VS = /* glsl */`
attribute float age; varying vec2 vUv; varying float vAge;
void main(){ vUv = uv; vAge = age; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;

export class Trail {
  constructor(scene, node, { max = 90, life = 1.4, width = 0.18, grow = 1.6, color = 0xeef4ff, hot = 0xcfe6ff, minSpeed = 6, blending = THREE.NormalBlending, turb = 0.9 } = {}) {
    this.node = node; this.max = max; this.life = life; this.width = width; this.grow = grow; this.minSpeed = minSpeed; this.turb = turb; this.seed = Math.random() * 100;
    this.pts = []; // {p, t}
    const n = max * 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('age', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uHot: { value: new THREE.Color(hot) } },
      vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    scene.add(this.mesh); this.scene = scene; this.last = null;
  }
  update(dt, t, camera) {
    const p = this.node.getWorldPosition(new THREE.Vector3());
    const speed = this.last ? p.distanceTo(this.last) / Math.max(dt, 1e-4) : 0;
    this.last = p.clone();
    if (speed > this.minSpeed) {
      // each puff of condensation drifts: a little turbulence across the flight path and a slow
      // rise, so the ribbon billows and breaks up with age instead of hanging as a ruler line
      // smooth in birth time, so neighbouring points drift together (billows, not jitter)
      const k = this.seed + t;
      const v = new THREE.Vector3(Math.sin(k * 1.7) + 0.5 * Math.sin(k * 4.3), Math.sin(k * 2.3 + 1.1) + 0.5 * Math.sin(k * 5.1), Math.sin(k * 1.3 + 2.2) + 0.5 * Math.sin(k * 3.7)).multiplyScalar(this.turb * 0.5);
      v.y += this.turb * 0.35;
      this.pts.unshift({ p, t, v });
    }
    for (const q of this.pts) q.p.addScaledVector(q.v, dt);
    while (this.pts.length > this.max || (this.pts.length && t - this.pts[this.pts.length - 1].t > this.life)) this.pts.pop();
    const g = this.mesh.geometry, pos = g.attributes.position.array, uv = g.attributes.uv.array, age = g.attributes.age.array;
    const cam = camera.position, n = this.pts.length;
    for (let i = 0; i < this.max; i++) {
      const k = Math.min(i, Math.max(n - 1, 0));
      const cur = n ? this.pts[k].p : p;
      const prev = n ? this.pts[Math.max(k - 1, 0)].p : p, next = n ? this.pts[Math.min(k + 1, n - 1)].p : p;
      TMP.subVectors(prev, next); if (TMP.lengthSq() < 1e-8) TMP.set(0, 0, 1);
      TMP2.subVectors(cam, cur); TMP3.crossVectors(TMP, TMP2).normalize();
      const a = n ? Math.min(1, (t - this.pts[k].t) / this.life) : 1;
      const w = this.width * (0.35 + this.grow * a) * (i >= n ? 0 : 1);
      pos.set([cur.x + TMP3.x * w, cur.y + TMP3.y * w, cur.z + TMP3.z * w, cur.x - TMP3.x * w, cur.y - TMP3.y * w, cur.z - TMP3.z * w], i * 6);
      uv.set([i / this.max, 0, i / this.max, 1], i * 4);
      age[i * 2] = age[i * 2 + 1] = i >= n ? 1 : a;
    }
    g.attributes.position.needsUpdate = g.attributes.uv.needsUpdate = g.attributes.age.needsUpdate = true;
    this.mat.uniforms.uTime.value = t;
  }
  clear() { this.pts.length = 0; this.last = null; }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// ---------------------------------------------------------------- particles: sparks (streaks), smoke, flashes
class Sparks {
  constructor(scene, max = 600) {
    this.max = max; this.p = []; this.scene = scene;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    this.lines.frustumCulled = false; scene.add(this.lines);
  }
  burst(at, dir, n = 30, speed = 9, spread = 0.9, color = new THREE.Color(1, 0.8, 0.45), life = 0.6, gravity = 9.8) {
    for (let i = 0; i < n; i++) {
      if (this.p.length >= this.max) this.p.shift();
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(spread);
      v.add(dir ? dir.clone().normalize() : new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(speed * (0.35 + Math.random()));
      this.p.push({ x: at.clone(), v, t: 0, life: life * (0.5 + Math.random()), c: color, g: gravity });
    }
  }
  update(dt) {
    const pos = this.lines.geometry.attributes.position.array, col = this.lines.geometry.attributes.color.array;
    let j = 0;
    for (let i = this.p.length - 1; i >= 0; i--) { const s = this.p[i]; s.t += dt; if (s.t > s.life) this.p.splice(i, 1); }
    for (const s of this.p) {
      s.v.y -= s.g * dt; s.v.multiplyScalar(1 - dt * 1.5); s.x.addScaledVector(s.v, dt);
      const k = 1 - s.t / s.life, tail = 0.035 + 0.02 * s.v.length() * 0.1;
      pos.set([s.x.x, s.x.y, s.x.z, s.x.x - s.v.x * tail, s.x.y - s.v.y * tail, s.x.z - s.v.z * tail], j * 6);
      col.set([s.c.r * k * 3, s.c.g * k * 3, s.c.b * k * 3, s.c.r * k * 0.6, s.c.g * k * 0.4, s.c.b * k * 0.3], j * 6);
      j++;
    }
    for (let i = j; i < this.max; i++) pos.fill(0, i * 6, i * 6 + 6);
    this.lines.geometry.setDrawRange(0, j * 2);
    this.lines.geometry.attributes.position.needsUpdate = this.lines.geometry.attributes.color.needsUpdate = true;
  }
}

class Billboards {
  // pooled sprites for flashes, rings (oriented), smoke puffs
  constructor(scene) { this.scene = scene; this.live = []; }
  spawn({ at, map = 'glow', color = 0xffffff, size = 1, grow = 0, life = 0.2, blending = THREE.AdditiveBlending, opacity = 1, normal = null, rise = 0, fadeIn = 0 }) {
    let obj;
    const mat = (normal ? THREE.MeshBasicMaterial : THREE.SpriteMaterial);
    const m = new mat({ map: tex()[map], color, transparent: true, depthWrite: false, blending, opacity, toneMapped: blending !== THREE.AdditiveBlending ? true : false, side: THREE.DoubleSide });
    if (normal) { obj = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize()); }
    else obj = new THREE.Sprite(m);
    if (!normal) m.rotation = Math.random() * Math.PI * 2;
    obj.position.copy(at); obj.scale.setScalar(size); obj.renderOrder = 12;
    this.scene.add(obj);
    this.live.push({ obj, m, t: 0, life, size, grow, opacity, rise, fadeIn });
    return obj;
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i]; b.t += dt; const k = b.t / b.life;
      if (k >= 1) { this.scene.remove(b.obj); b.obj.geometry?.dispose?.(); b.m.dispose(); this.live.splice(i, 1); continue; }
      const s = b.size * (1 + b.grow * (1 - Math.pow(1 - k, 3)));
      b.obj.scale.setScalar(s); b.obj.position.y += b.rise * dt;
      const fin = b.fadeIn > 0 ? Math.min(1, b.t / b.fadeIn) : 1;
      b.m.opacity = b.opacity * fin * (1 - k) * (1 - k);
    }
  }
}

// ---------------------------------------------------------------- repulsor bolts
const BOLT_FS = /* glsl */`
uniform vec3 uCore, uHalo; uniform float uTime; varying vec2 vUv;
void main(){
  float y = (vUv.y - .5) * 2.;
  float hx = .86, dx = vUv.x - hx;
  float head = exp(-(dx*dx*260. + y*y*7.));                         // white-hot slug
  float halo = exp(-(dx*dx*30. + y*y*2.4));                          // blue bloom round it
  float along = smoothstep(0., hx, vUv.x) * step(vUv.x, hx + .04);
  float tail = exp(-y*y*10.) * along * along;                        // streak behind
  float thread = exp(-y*y*60.) * along;                              // bright core thread
  float flick = .85 + .15*sin(uTime*90. + vUv.x*20.);
  vec3 c = uCore*(head*3.4 + thread*1.2) + uHalo*(halo*1.4 + tail*1.1)*flick;
  float a = clamp(head + halo*.8 + tail*.7 + thread*.6, 0., 1.);
  gl_FragColor = vec4(c, a);
}`;

export class Repulsors {
  constructor(vfx) {
    this.vfx = vfx; this.scene = vfx.scene; this.bolts = []; this.speed = 140; this.targets = [];
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.boltMat = new THREE.ShaderMaterial({ uniforms: { uCore: { value: new THREE.Color(1, 1, 1) }, uHalo: { value: new THREE.Color(0.35, 0.7, 1.0) }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: BOLT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this.charges = new Map();
    this.blasts = [];
    this.blastGeo = new THREE.CylinderGeometry(0.02, 0.11, 0.6, 16, 1, true).translate(0, 0.3, 0);
    this.blastMat = new THREE.MeshBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  }
  /** Palm glow while charging (level 0..1). */
  charge(palm, level) {
    let c = this.charges.get(palm);
    if (!c) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex().glow, color: 0xbfe2ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex().ring, color: 0x9fd4ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      const light = { intensity: 0 };   // no real light (pool only)
      const g = new THREE.Group(); g.add(s, ring); g.position.set(0, -0.02, 0);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
      palm.add(g); c = { g, s, ring, light, level: 0 }; this.charges.set(palm, c);
    }
    c.level = level;
  }
  fire(palm, target, { big = false, color = null } = {}) {
    const from = palm.getWorldPosition(new THREE.Vector3());
    const dir = target ? target.clone().sub(from).normalize() : new THREE.Vector3(0, -1, 0).applyQuaternion(palm.getWorldQuaternion(Q)).normalize();
    const mesh = new THREE.Mesh(this.geo, this.boltMat); mesh.frustumCulled = false; mesh.renderOrder = 15;
    const len = THREE.MathUtils.clamp(this.speed * 0.024, 1.4, 5) * (big ? 1.5 : 1), wid = big ? 0.7 : 0.34;
    mesh.scale.set(len, wid, 1);
    this.scene.add(mesh);
    const light = { intensity: 0 };   // bolts carry no real light (pool flashes at muzzle/impact)
    this.bolts.push({ mesh, light, pos: from.clone().addScaledVector(dir, 0.12), dir, t: 0, life: 2.5, big, len0: len });
    // the blast leaving the palm: a short hot cone for two frames
    const cone = new THREE.Mesh(this.blastGeo, this.blastMat.clone());
    cone.position.copy(from); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cone.scale.setScalar(big ? 1.6 : 1); this.scene.add(cone); this.blasts.push({ m: cone, t: 0 });
    // muzzle: flash + shock ring oriented to the palm normal + light pop
    const v = this.vfx;
    v.bb.spawn({ at: from, map: 'glow', color: 0xd9efff, size: big ? 1.1 : 0.55, grow: 0.5, life: 0.09 });
    v.bb.spawn({ at: from.clone().addScaledVector(dir, 0.10), map: 'ring', color: 0x9fd4ff, size: big ? 0.28 : 0.16, grow: big ? 3.2 : 1.8, life: 0.16, normal: dir, opacity: 0.75 });
    v.bb.spawn({ at: from, map: 'smoke', color: 0x9fb4c8, size: 0.25, grow: 2.5, life: 0.7, blending: THREE.NormalBlending, opacity: 0.18, rise: 0.3, fadeIn: 0.05 });
    v.sparks.burst(from, dir, big ? 14 : 6, 6, 0.5, new THREE.Color(0.7, 0.85, 1.0), 0.25, 2);
    v.flashLight(from, big ? 26 : 12, 0.08, 0xbfe0ff);
    const c = this.charges.get(palm); if (c) c.level = 0;
    return this.bolts[this.bolts.length - 1];
  }
  _impact(p, n, big) {
    const v = this.vfx;
    v.onImpact?.(p, n, big);
    v.bb.spawn({ at: p, map: 'glow', color: 0xe6f4ff, size: big ? 3 : 1.6, grow: 0.8, life: 0.16 });
    v.bb.spawn({ at: p.clone().addScaledVector(n, 0.02), map: 'ring', color: 0x9fd4ff, size: 0.2, grow: big ? 6 : 3, life: 0.24, normal: n, opacity: 0.8 });
    v.sparks.burst(p, n, big ? 60 : 32, big ? 13 : 9, 0.95, new THREE.Color(1, 0.85, 0.55), 0.7);
    v.sparks.burst(p, n, big ? 20 : 10, 5, 0.6, new THREE.Color(0.6, 0.85, 1.0), 0.3, 1);
    for (let i = 0; i < (big ? 5 : 3); i++) v.bb.spawn({ at: p.clone().addScaledVector(n, 0.15 + Math.random() * 0.2), map: 'smoke', color: 0x55585c, size: 0.4 + Math.random() * 0.4, grow: 3, life: 1.6 + Math.random(), blending: THREE.NormalBlending, opacity: 0.35, rise: 0.4, fadeIn: 0.08 });
    v.flashLight(p, big ? 40 : 18, 0.12, 0xbfe0ff);
    v.scorch(p, n, big ? 0.9 : 0.5);
    this.vfx.ctx?.sfx?.play(big ? 'repulsor_impact_big' : 'repulsor_impact', { at: p.clone() });
  }
  update(dt, t, camera) {
    this.boltMat.uniforms.uTime.value = t;
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i]; b.t += dt; const k = b.t / 0.07;
      if (k >= 1) { this.scene.remove(b.m); b.m.material.dispose(); this.blasts.splice(i, 1); continue; }
      b.m.material.opacity = 0.9 * (1 - k); b.m.scale.y = (1 + 1.5 * k) * b.m.scale.x;
    }
    for (const [palm, c] of this.charges) {
      const L = c.level, fl = 0.85 + 0.15 * Math.sin(t * 43);
      c.s.material.opacity = Math.min(1, L * 1.2); c.s.scale.setScalar((0.12 + 0.3 * L) * fl);
      c.ring.material.opacity = L * 0.8; c.ring.scale.setScalar(0.1 + 0.12 * L); c.ring.rotation.z += dt * 6;
      c.light.intensity = 5 * L * fl; c.g.visible = L > 0.01;
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]; b.t += dt;
      const step = this.speed * dt;
      // hit test against registered targets and the floor (y=0)
      let hit = null;
      const next = b.pos.clone().addScaledVector(b.dir, step);
      if (b.dir.y < 0 && next.y <= 0 && b.pos.y > 0) { const k = b.pos.y / (b.pos.y - next.y); hit = { p: b.pos.clone().lerp(next, k), n: new THREE.Vector3(0, 1, 0) }; }
      if (!hit && this.targets.length) {
        const ray = new THREE.Raycaster(b.pos, b.dir, 0, step + 0.1);
        const hs = ray.intersectObjects(this.targets, true);
        if (hs.length) hit = { p: hs[0].point, n: hs[0].face ? hs[0].face.normal.clone().transformDirection(hs[0].object.matrixWorld) : b.dir.clone().negate(), obj: hs[0].object };
      }
      if (hit || b.t > b.life) {
        if (hit) { this._impact(hit.p, hit.n, b.big); this.onHit?.(hit); }
        this.scene.remove(b.mesh); this.bolts.splice(i, 1); continue;
      }
      b.pos.copy(next);
      // billboard stretched along the direction of travel, facing the camera
      // the streak grows out of the palm over its first metres instead of starting full length
      const grown = Math.min(1, b.t * this.speed / b.len0);
      b.mesh.scale.x = b.len0 * Math.max(0.15, grown);
      b.mesh.position.copy(b.pos).addScaledVector(b.dir, -b.mesh.scale.x * 0.36);
      const toCam = TMP.subVectors(camera.position, b.mesh.position).normalize();
      const side = TMP2.crossVectors(b.dir, toCam).normalize();
      const nrm = TMP3.crossVectors(b.dir, side).normalize();       // right-handed basis
      const m = new THREE.Matrix4().makeBasis(b.dir, side, nrm);
      b.mesh.quaternion.setFromRotationMatrix(m);
      b.light.intensity = (b.big ? 14 : 7) * (0.8 + 0.2 * Math.sin(t * 70));
    }
  }
}

// ---------------------------------------------------------------- fixed light pool
export class LightPool {
  constructor(scene, n = 8) {
    this.lights = []; this.group = new THREE.Group(); this.group.name = '__lightpool'; scene.add(this.group);
    for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xffffff, 0, 10, 1.6); l.userData = { t: 1, life: 1, i0: 0 }; this.group.add(l); this.lights.push(l); }
  }
  flash(at, intensity, life, color = 0xffffff, range = 10) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.userData.t / l.userData.life > best.userData.t / best.userData.life) best = l;
    best.position.copy(at); best.color.set(color); best.distance = range;
    best.userData = { t: 0, life, i0: intensity }; best.intensity = intensity;
  }
  update(dt) {
    for (const l of this.lights) { const u = l.userData; if (u.t >= u.life) { l.intensity = 0; continue; } u.t += dt; const k = Math.min(1, u.t / u.life); l.intensity = u.i0 * (1 - k) * (1 - k); }
  }
}

// ---------------------------------------------------------------- the VFX hub handed to exhibits as ctx.vfx
export class VFX {
  constructor(scene, ctx) {
    this.scene = scene; this.ctx = ctx;
    this.sparks = new Sparks(scene);
    this.bb = new Billboards(scene);
    this.repulsors = new Repulsors(this);
    this.thrusters = new Map(); // node -> Thruster
    this.trails = [];
    this.lights = [];
    this.scorches = [];
    this.handlers = {};         // custom cue handlers: name -> fn(node, event, root)
    this.driverHandlers = {};   // name -> fn(value, node, root)
  }
  on(name, fn) { this.handlers[name] = fn; }
  onDriver(name, fn) { this.driverHandlers[name] = fn; }

  thruster(node, opt) { let t = this.thrusters.get(node); if (!t) { t = new Thruster(node, opt); this.thrusters.set(node, t); } return t; }
  /** Attach plumes to a suit's standard emitters (boots + palms). */
  rigThrusters(root, { style = 'repulsor', palms = true, scale = 1 } = {}) {
    const out = [];
    for (const n of ['piv_thrusterL', 'piv_thrusterR', ...(palms ? ['piv_palmL', 'piv_palmR'] : [])]) {
      const node = root.getObjectByName(n); if (node) out.push(this.thruster(node, { style, scale: n.startsWith('piv_palm') ? scale * 0.7 : scale }));
    }
    return out;
  }
  trail(node, opt) { const t = new Trail(this.scene, node, opt); this.trails.push(t); return t; }
  flashLight(at, intensity, life, color = 0xffffff) { this.pool?.flash(at, intensity, life, color, 8); }
  scorch(p, n, size) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex().soft, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.copy(p).addScaledVector(n, 0.004); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); m.scale.setScalar(size);
    this.scene.add(m); this.scorches.push({ m, t: 0 });
    if (this.scorches.length > 40) { const s = this.scorches.shift(); this.scene.remove(s.m); }
  }

  /** clips.json cue */
  cue(name, node, e, root) {
    if (this.handlers[name]) return this.handlers[name](node, e, root);
    const at = node ? node.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    switch (name) {
      case 'repulsor_charge': if (node) this.repulsors.charge(node, e.level ?? 1); break;
      case 'repulsor_fire': if (node) this.repulsors.fire(node, e.target ? new THREE.Vector3(...e.target) : null, { big: !!e.big }); break;
      case 'thruster_on': if (node) this.thruster(node, { style: e.style }).set(e.level ?? 1); break;
      case 'thruster_off': if (node) this.thruster(node).set(0); break;
      case 'sparks': case 'weld': this.sparks.burst(at, null, e.n ?? 24, e.speed ?? 5, 1, new THREE.Color(1, 0.8, 0.45), 0.5); this.flashLight(at, 6, 0.06, 0xffd9a0); break;
      case 'smoke_puff': this.bb.spawn({ at, map: 'smoke', color: 0x8a8d90, size: e.size ?? 0.5, grow: 2.5, life: 1.2, blending: THREE.NormalBlending, opacity: 0.4, rise: 0.4, fadeIn: 0.05 }); break;
      case 'dust': for (let i = 0; i < 6; i++) this.bb.spawn({ at: at.clone().add(new THREE.Vector3((Math.random() - .5) * .6, 0.05, (Math.random() - .5) * .6)), map: 'smoke', color: 0x8b7f70, size: 0.6, grow: 3, life: 1.8, blending: THREE.NormalBlending, opacity: 0.35, rise: 0.25, fadeIn: 0.1 }); break;
      case 'flash': this.bb.spawn({ at, map: 'glow', color: e.color ?? 0xffffff, size: e.size ?? 1, grow: 0.5, life: 0.15 }); break;
      default: if (!this._warned?.has(name)) { (this._warned ??= new Set()).add(name); console.info('[vfx] unhandled cue', name); }
    }
  }
  /** drv_* driver values from clips */
  driver(name, v, node, root) {
    if (this.driverHandlers[name]) return this.driverHandlers[name](v, node, root);
    if (name === 'drv_thrust' && root.__autoThrusters) for (const t of root.__autoThrusters) t.set(v);
  }

  update(dt, t, camera) {
    for (const th of this.thrusters.values()) th.update(dt, t);
    this.pool?.update(dt);
    for (const tr of this.trails) tr.update(dt, t, camera);
    this.sparks.update(dt); this.bb.update(dt); this.repulsors.update(dt, t, camera);
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const L = this.lights[i]; L.t += dt; const k = L.t / L.life;
      if (k >= 1) { this.scene.remove(L.l); this.lights.splice(i, 1); } else L.l.intensity = L.i0 * (1 - k) * (1 - k);
    }
  }
  clear() {
    for (const th of this.thrusters.values()) th.dispose(); this.thrusters.clear();
    for (const tr of this.trails) tr.dispose(); this.trails.length = 0;
    for (const s of this.scorches) this.scene.remove(s.m); this.scorches.length = 0;
    for (const L of this.lights) this.scene.remove(L.l); this.lights.length = 0;
    this.repulsors.bolts.forEach(b => this.scene.remove(b.mesh)); this.repulsors.bolts.length = 0;
    this.repulsors.blasts.forEach(b => this.scene.remove(b.m)); this.repulsors.blasts.length = 0;
    this.repulsors.charges.forEach(c => c.g.parent?.remove(c.g)); this.repulsors.charges.clear();
    this.repulsors.targets = [];
    this.handlers = {}; this.driverHandlers = {};
  }
}
