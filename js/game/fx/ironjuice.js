// Iron Man JUICE (Jurek: "top tier — shadows, juice, reflections"). In-world 3D effects; the platform's post
// stack (gfx/juice.js) already does the screen side from our game:events and hud(): shockwave rings, radial
// blur / speed lines, heat haze behind the boots, hit flash. Every effect here is gated by the quality tier
// (MZ.gfx.tier when the lead's switch lands, else world.tier): ultra 3 · high 2 · balanced 1 · low 0.
//   impact(p, n, big, dist)   repulsor hit: debris chunks + dust on top of vfx.js flash/ring/sparks/scorch
//   land(p, speed, heavy)     ground crack decal, dust ring, debris, (shockwave + crowd via game:event)
//   boom(p, vel)              sonic boom: condensation cone, flash, boom sound, camera kick (≥ 330 m/s)
//   gVapor(root, g, sp)       condensation puffs off the shoulders in high-G turns
//   brakeSparks(nodes)        sparks off the flaps on a hard brake
//   update(dt, camera)
// No lights are created (fixed light pool); particles are pooled (one InstancedMesh for debris).
import * as THREE from 'three';

const LV = { ultra: 3, high: 2, balanced: 1, low: 0 };
let CRACK = null;
function crackTex() {
  if (CRACK) return CRACK;
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.25, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(0,0,0,0.9)'; x.lineCap = 'round';
  for (let i = 0; i < 14; i++) {                                    // radial cracks that fork
    let a = (i / 14) * Math.PI * 2 + Math.random() * 0.3, r = 10, px = 128, py = 128, w = 3.2;
    while (r < 120) { const step = 8 + Math.random() * 12; a += (Math.random() - 0.5) * 0.6; const nx = 128 + Math.cos(a) * (r + step), ny = 128 + Math.sin(a) * (r + step);
      x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke(); px = nx; py = ny; r += step; w *= 0.86;
      if (Math.random() < 0.2) { const b = a + (Math.random() < 0.5 ? 0.7 : -0.7); x.lineWidth = w * 0.7; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(b) * 20, py + Math.sin(b) * 20); x.stroke(); } }
  }
  CRACK = new THREE.CanvasTexture(c); CRACK.colorSpace = THREE.SRGBColorSpace; return CRACK;
}

const CONE_FS = `uniform float uA; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float h(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
void main(){ float rim = 1. - abs(dot(normalize(vN), normalize(vV))); float band = smoothstep(0., .35, vUv.y) * smoothstep(1., .55, vUv.y);
  float n = .7 + .3*h(floor(vUv*vec2(40.,12.))); float a = pow(rim, 1.6) * band * n * uA; gl_FragColor = vec4(vec3(.95,.97,1.), a); }`;
const CONE_VS = `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 wp = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`;

export class IronJuice {
  constructor(hero) {
    this.h = hero; this.W = hero.world; this.MZ = hero.MZ;
    this.debris = []; this.decals = []; this.cones = []; this.stats = { debris: 0, decals: 0, cones: 0, puffs: 0 };
    const DMAX = 96;
    this.dMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x5f5a54, roughness: 0.95 }), DMAX);
    this.dMesh.count = 0; this.dMesh.frustumCulled = false; this.dMesh.castShadow = true; this.dMesh.name = '__debris';
    this.W.scene.add(this.dMesh); this.W.litModel?.(this.dMesh);
    this.dMax = DMAX; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._e = new THREE.Euler();
    this.boomCool = 0; this.vapT = 0;
  }
  get level() { const t = this.MZ.gfx?.tier || this.W.tier || 'high'; return LV[t] ?? 2; }

  // ---- building blocks
  _debris(p, n, count, speed, size) {
    for (let i = 0; i < count; i++) {
      if (this.debris.length >= this.dMax) this.debris.shift();
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(0.9).add(n).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.debris.push({ p: p.clone().addScaledVector(n, 0.1), v, r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), a: new THREE.Vector3(), s: size * (0.4 + Math.random()), t: 0, life: 1.6 + Math.random() * 1.4 });
    }
  }
  _dust(p, n, count, size, color = 0x8b8378) {
    const bb = this.W.vfx?.bb; if (!bb) return;
    for (let i = 0; i < count; i++) {
      const o = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(size * 1.2).addScaledVector(n, 0.1 + Math.random() * 0.2);
      bb.spawn({ at: p.clone().add(o), map: 'smoke', color, size: size * (0.5 + Math.random() * 0.6), grow: 3, life: 1.4 + Math.random() * 1.2, blending: THREE.NormalBlending, opacity: 0.42, rise: 0.5 + Math.random() * 0.6, fadeIn: 0.06 });
    }
    this.stats.puffs += count;
  }
  _decal(p, n, size, life = 24) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: crackTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, opacity: 0.9 }));
    m.position.copy(p).addScaledVector(n, 0.02); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); m.rotateZ(Math.random() * 6.28); m.scale.setScalar(size);
    m.renderOrder = 2; m.name = '__crack'; this.W.scene.add(m);
    this.decals.push({ m, t: 0, life }); if (this.decals.length > (this.level >= 2 ? 16 : 6)) { const d = this.decals.shift(); d.m.removeFromParent(); d.m.geometry.dispose(); d.m.material.dispose(); }
  }

  // ---- effects
  impact(p, n, big, dist = 30) {
    const L = this.level; if (L === 0) return;
    this._debris(p, n, Math.round((big ? 10 : 4) * (L / 2)), big ? 9 : 6, big ? 0.18 : 0.1);
    this._dust(p, n, big ? 4 : (L >= 2 ? 2 : 1), big ? 1.4 : 0.8);
    if (big && L >= 1) this._decal(p, n, 2.6, 18);
  }
  land(p, speed, heavy = false) {
    const L = this.level, k = Math.min(1.6, speed / 25) * (heavy ? 1.6 : 1);
    if (k < 0.15) return;
    const n = new THREE.Vector3(0, 1, 0);
    if (L >= 1) this._decal(p, n, 1.6 + 3.2 * k, 30);
    this._dust(p, n, Math.round((L >= 2 ? 10 : 5) * Math.min(1, k)), 0.9 + k, 0x8e877c);
    if (L >= 1) this._debris(p, n, Math.round((L >= 2 ? 14 : 6) * Math.min(1.4, k)), 5 + 6 * k, 0.12 + 0.08 * k);
    this.W.vfx?.sparks.burst(p.clone().setY(p.y + 0.1), n, Math.round(20 * k), 6 + 5 * k, 1.0, new THREE.Color(1, 0.8, 0.5), 0.5);
    this.W.vfx?.flashLight?.(p.clone().setY(p.y + 0.6), 10 * k, 0.15, 0xffd9a8);
  }
  boom(p, vel) {
    if (this.boomCool > 0) return; this.boomCool = 4;
    const L = this.level, d = vel.clone().normalize();
    if (L >= 1) {
      const geo = new THREE.CylinderGeometry(2.6, 0.5, 4.2, 40, 6, true); geo.rotateX(Math.PI / 2); geo.translate(0, 0, 1.4);   // opens backwards (+Z)
      const mat = new THREE.ShaderMaterial({ uniforms: { uA: { value: 0 } }, vertexShader: CONE_VS, fragmentShader: CONE_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending });
      const c = new THREE.Mesh(geo, mat); c.frustumCulled = false; c.renderOrder = 13; c.name = '__boom';
      c.position.copy(p); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), d);
      this.W.scene.add(c); this.cones.push({ c, t: 0, life: 0.55, vel: vel.clone() });
    }
    this.W.vfx?.bb.spawn({ at: p.clone(), map: 'ring', color: 0xeef6ff, size: 1.2, grow: 12, life: 0.5, normal: d, opacity: 0.7 });
    this.W.vfx?.bb.spawn({ at: p.clone(), map: 'glow', color: 0xffffff, size: 5, grow: 0.5, life: 0.12 });
    this.W.vfx?.flashLight?.(p.clone(), 30, 0.12, 0xdfefff);
    this.h.sfx('hb_mega_blast', { at: this.h.root, gain: 0.8 }); this.h.sfx('im_boost', { at: this.h.root });
    this.h.kick({ shake: 0.35, fov: 7, hitstop: 30 }); this.h.haptic('explosion_near', 0.8); this.h.cam?.punch(0, 0.05, 0.5);
    this.h.event({ kind: 'boom' });
  }
  gVapor(root, g, sp, dt) {
    const L = this.level; if (L < 2 || g < 3.2 || sp < 70) return;
    this.vapT -= dt * (g - 2.5) * 12; if (this.vapT > 0) return; this.vapT = 1;
    const bb = this.W.vfx?.bb; if (!bb) return;
    for (const n of ['piv_shoulderL', 'piv_shoulderR', 'piv_flap_backL', 'piv_flap_backR']) {
      const o = root.getObjectByName(n); if (!o) continue;
      bb.spawn({ at: o.getWorldPosition(new THREE.Vector3()), map: 'smoke', color: 0xf4f7ff, size: 0.5, grow: 2.2, life: 0.45, blending: THREE.NormalBlending, opacity: Math.min(0.5, (g - 3) * 0.12), fadeIn: 0.03 });
      this.stats.puffs++;
    }
  }
  brakeSparks(nodes) {
    if (this.level === 0) return;
    for (const o of nodes) { if (!o) continue; const p = o.getWorldPosition(new THREE.Vector3()); this.W.vfx?.sparks.burst(p, new THREE.Vector3(0, 0.3, 0), 8, 5, 1.2, new THREE.Color(1, 0.85, 0.55), 0.35, 4); }
  }
  quake(p, k) {                                                    // Hulkbuster footstep / landing
    this.h.kick({ shake: 0.12 + 0.3 * k }); this.h.haptic('hb_step', 0.6 + 0.6 * k); this.h.cam?.punch(0, -0.08 * k, 0);
    if (this.level >= 1) this._dust(p, new THREE.Vector3(0, 1, 0), this.level >= 2 ? 3 : 1, 0.7 + k * 0.6);
  }

  update(dt) {
    this.boomCool -= dt;
    // debris: ballistic, bounce once on the ground, settle, fade by shrinking
    const C = this.h.col, m = this._m;
    let i = 0;
    for (let k = this.debris.length - 1; k >= 0; k--) { const d = this.debris[k]; d.t += dt; if (d.t > d.life) this.debris.splice(k, 1); }
    for (const d of this.debris) {
      d.v.y -= 9.81 * dt; d.p.addScaledVector(d.v, dt); d.a.addScaledVector(d.r, dt);
      const g = C.groundAt(d.p.x, d.p.z, d.p.y + 0.5);
      if (d.p.y < g + d.s * 0.5) { d.p.y = g + d.s * 0.5; d.v.y = Math.abs(d.v.y) * 0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.r.multiplyScalar(0.6); }
      const sh = Math.min(1, (d.life - d.t) / 0.4);
      m.compose(d.p, this._q.setFromEuler(this._e.set(d.a.x, d.a.y, d.a.z)), this._s.setScalar(d.s * sh));
      this.dMesh.setMatrixAt(i++, m);
    }
    this.dMesh.count = i; this.dMesh.instanceMatrix.needsUpdate = true;
    for (let k = this.decals.length - 1; k >= 0; k--) { const d = this.decals[k]; d.t += dt; d.m.material.opacity = 0.9 * Math.min(1, (d.life - d.t) / 4); if (d.t > d.life) { d.m.removeFromParent(); d.m.geometry.dispose(); d.m.material.dispose(); this.decals.splice(k, 1); } }
    for (let k = this.cones.length - 1; k >= 0; k--) {
      const c = this.cones[k]; c.t += dt; const u = c.t / c.life;
      c.c.position.addScaledVector(c.vel, dt * 0.85);                 // rides with him, falls behind a little
      c.c.material.uniforms.uA.value = Math.sin(Math.min(1, u) * Math.PI) * 0.85;
      c.c.scale.setScalar(1 + u * 0.6);
      if (u >= 1) { c.c.removeFromParent(); c.c.geometry.dispose(); c.c.material.dispose(); this.cones.splice(k, 1); }
    }
    this.stats.debris = this.debris.length; this.stats.decals = this.decals.length; this.stats.cones = this.cones.length;
  }
  dispose() { this.dMesh.removeFromParent(); for (const d of this.decals) d.m.removeFromParent(); for (const c of this.cones) c.c.removeFromParent(); }
}
