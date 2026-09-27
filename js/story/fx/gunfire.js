// Copied from next/assets/vfx/gunfire/gunfire.three.js (2026-09-25, enemies agent) — ADR-001: copy, never import.
// V3 change: _light() borrows the world's fixed light pool (opt.pool) instead of adding a PointLight
// (a runtime light recompiles every material in the city). rocketFire aims at `target` (3D, not just the
// muzzle's facing) and returns the rocket; a rocket with `held = true` is driven by the caller (Spider-Man's
// web catch) and `R.d/R.target` can be re-pointed to send it back.
// Gunfire VFX for three.js (r15x+): muzzle flashes, tracers, shell casings, impacts, RPG rocket with
// smoke trail, explosions, back-blast. No build step: `import { Gunfire } from '.../gunfire.three.js'`.
//
//   const gf = new Gunfire(THREE, scene, { base: '/assets/vfx/gunfire/textures/', rocket: rocketGltfScene });
//   gf.muzzle(muzzleNode, 'rifle');                // node's local -Z = barrel
//   gf.tracer(from, dir, { speed: 320, range: 60 });
//   gf.shell(ejectorNode, 'rifle');               // brass flies to the right, bounces on the floor
//   gf.impact(point, normal, 'concrete'|'metal'|'flesh');
//   gf.rocketFire(muzzleNode, { speed: 52, target, onExplode });   // + gf.backblast(rearNode)
//   gf.explosion(point, 7.0);
//   gf.update(dt, camera);                        // every frame
// Everything is pooled-lite (a few hundred sprites max) and cleans itself up.

const WEAPON = {
  pistol: { flash: 0.16, side: 0.26, light: 6, smoke: 0.12, shell: [0.0045, 0.019], tracer: false },
  rifle: { flash: 0.26, side: 0.46, light: 10, smoke: 0.2, shell: [0.005, 0.039], tracer: true },
  rpg: { flash: 0.5, side: 0.9, light: 30, smoke: 0.6, shell: null, tracer: false },
};

export class Gunfire {
  constructor(THREE, scene, opt = {}) {
    this.T = THREE; this.scene = scene; this.opt = opt;
    const base = opt.base || '/assets/vfx/gunfire/textures/';
    const L = new THREE.TextureLoader();
    this.tex = {};
    for (const n of ['flash_front', 'flash_side', 'smoke', 'fire', 'spark', 'glow', 'tracer', 'shockwave', 'scorch']) {
      const t = L.load(base + n + '.png'); t.colorSpace = THREE.SRGBColorSpace; this.tex[n] = t;
    }
    this.sprites = []; this.meshes = []; this.lights = []; this.rockets = []; this.decals = [];
    this.floorY = opt.floorY ?? 0;
    this.onSound = opt.onSound || null;          // (id, position) — hook for audio (flyby, impacts, explosion)
    const g = new THREE.CylinderGeometry(1, 1, 1, 8); g.rotateZ(Math.PI / 2);
    this.shellGeo = g;
    this.brass = new THREE.MeshStandardMaterial({ color: 0xc8963c, metalness: 1, roughness: 0.3 });
    this.tracerGeo = new THREE.PlaneGeometry(1, 1); this.tracerGeo.translate(-0.5, 0, 0);
  }

  // ------------------------------------------------------------------ primitives
  _sprite(tex, pos, { size = 1, grow = 0, life = 0.3, color = 0xffffff, add = true, opacity = 1, vel = null, drag = 0,
    rise = 0, rot = Math.random() * 6.28, spin = 0, fadeIn = 0, gravity = 0 } = {}) {
    const T = this.T;
    const m = new T.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, opacity,
      blending: add ? T.AdditiveBlending : T.NormalBlending, rotation: rot });
    const s = new T.Sprite(m); s.position.copy(pos); s.scale.setScalar(size); this.scene.add(s);
    this.sprites.push({ s, t: 0, life, size, grow, opacity, vel: vel ? vel.clone() : null, drag, rise, spin, fadeIn, gravity });
    return s;
  }
  _light(pos, intensity, life, color) {
    this.opt.pool?.flash(pos, intensity, life, color, 12);
  }
  _worldDir(node, local) { return local.clone().applyQuaternion(node.getWorldQuaternion(new this.T.Quaternion())).normalize(); }

  // ------------------------------------------------------------------ muzzle
  muzzle(node, kind = 'pistol') {
    const T = this.T, W = WEAPON[kind] || WEAPON.pistol;
    const p = node.getWorldPosition(new T.Vector3());
    const fwd = this._worldDir(node, new T.Vector3(0, 0, -1));
    // front star (camera-facing) + two crossed side flames along the barrel
    this._sprite(this.tex.flash_front, p.clone().addScaledVector(fwd, W.flash * 0.25), { size: W.flash * 2, life: 0.05, grow: 1 });
    for (let i = 0; i < 2; i++) {
      const m = new T.MeshBasicMaterial({ map: this.tex.flash_side, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
        side: T.DoubleSide });
      const q = new T.Mesh(new T.PlaneGeometry(W.side, W.side * 0.5).translate(W.side / 2, 0, 0), m);
      q.position.copy(p);
      q.quaternion.setFromUnitVectors(new T.Vector3(1, 0, 0), fwd);
      q.rotateX(i * Math.PI / 2 + Math.random() * 0.6);
      q.scale.setScalar(0.8 + Math.random() * 0.5);
      this.scene.add(q); this.meshes.push({ o: q, t: 0, life: 0.045, fade: true });
    }
    this._light(p, W.light, 0.06, 0xffc070);
    // lingering smoke wisps
    for (let i = 0; i < (kind === 'rpg' ? 10 : 3); i++) {
      this._sprite(this.tex.smoke, p.clone().addScaledVector(fwd, 0.05 + Math.random() * 0.1), { size: W.smoke, grow: 3.5, life: 1.1 + Math.random(),
        add: false, opacity: 0.22, color: 0xb8b8b8, vel: fwd.clone().multiplyScalar(1.2 + Math.random()), drag: 3, rise: 0.25, fadeIn: 0.05 });
    }
    if (W.tracer || this.opt.tracers) this.tracer(p, fwd, { speed: kind === 'rifle' ? 320 : 250 });
  }

  // ------------------------------------------------------------------ tracers
  tracer(from, dir, { speed = 300, range = 70, width = 0.035, length = 2.2, target = null } = {}) {
    const T = this.T;
    const m = new T.MeshBasicMaterial({ map: this.tex.tracer, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      side: T.DoubleSide, color: 0xffe0a0 });
    const q = new T.Mesh(this.tracerGeo, m); q.frustumCulled = false; this.scene.add(q);
    const d = dir.clone().normalize();
    let maxD = range;
    if (target) maxD = Math.min(range, target.clone().sub(from).dot(d));
    this.meshes.push({ o: q, t: 0, life: maxD / speed, tracer: { from: from.clone(), d, speed, width, length, maxD } });
  }

  // ------------------------------------------------------------------ shell casings
  shell(node, kind = 'pistol') {
    const T = this.T, W = WEAPON[kind]; if (!W?.shell) return;
    const p = node.getWorldPosition(new T.Vector3());
    const q = node.getWorldQuaternion(new T.Quaternion());
    const right = new T.Vector3(1, 0, 0).applyQuaternion(q), up = new T.Vector3(0, 1, 0).applyQuaternion(q),
      back = new T.Vector3(0, 0, 1).applyQuaternion(q);
    const m = new T.Mesh(this.shellGeo, this.brass); m.scale.set(W.shell[1], W.shell[0], W.shell[0]);
    m.position.copy(p); m.quaternion.copy(q); m.castShadow = true; this.scene.add(m);
    const v = right.multiplyScalar(2.2 + Math.random()).addScaledVector(up, 1.4 + Math.random() * 0.8).addScaledVector(back, 0.4 * Math.random());
    const w = new T.Vector3(Math.random() * 30 - 15, Math.random() * 30 - 15, Math.random() * 40 - 20);
    this.meshes.push({ o: m, t: 0, life: 2.5, shell: { v, w, bounces: 0 } });
  }

  // ------------------------------------------------------------------ impacts
  impact(point, normal, mat = 'concrete') {
    const T = this.T, n = normal.clone().normalize();
    if (mat === 'metal') {
      for (let i = 0; i < 12; i++) {
        const v = n.clone().multiplyScalar(2 + Math.random() * 3).add(new T.Vector3().randomDirection().multiplyScalar(3));
        this._sprite(this.tex.spark, point, { size: 0.05, life: 0.25 + Math.random() * 0.25, vel: v, gravity: 9.8, drag: 1 });
      }
      this._light(point, 3, 0.05, 0xffd29a);
    } else if (mat === 'flesh') {
      for (let i = 0; i < 5; i++) this._sprite(this.tex.smoke, point, { size: 0.08, grow: 2, life: 0.35, add: false, opacity: 0.5, color: 0x5a0a08,
        vel: n.clone().multiplyScalar(1 + Math.random()).add(new T.Vector3().randomDirection().multiplyScalar(0.6)), gravity: 4 });
    } else {
      for (let i = 0; i < 4; i++) this._sprite(this.tex.smoke, point.clone().addScaledVector(n, 0.03), { size: 0.12, grow: 4, life: 0.9 + Math.random() * 0.5,
        add: false, opacity: 0.45, color: 0x9a948a, vel: n.clone().multiplyScalar(1.2 + Math.random()).add(new T.Vector3().randomDirection().multiplyScalar(0.5)),
        drag: 3, gravity: -0.2 });
      for (let i = 0; i < 6; i++) this._sprite(this.tex.spark, point, { size: 0.03, life: 0.18, vel: n.clone().multiplyScalar(3).add(new T.Vector3().randomDirection().multiplyScalar(3)), gravity: 9.8 });
    }
    this._decal(point, n, mat === 'flesh' ? 0.05 : 0.12, 0.6);
  }
  _decal(p, n, size, opacity) {
    const T = this.T;
    const m = new T.Mesh(new T.PlaneGeometry(size, size), new T.MeshBasicMaterial({ map: this.tex.scorch, transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4 }));
    m.position.copy(p).addScaledVector(n, 0.004); m.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), n); m.rotateZ(Math.random() * 6.28);
    this.scene.add(m); this.decals.push(m);
    if (this.decals.length > 60) this.scene.remove(this.decals.shift());
  }

  // ------------------------------------------------------------------ RPG
  backblast(node) {
    const T = this.T;
    const p = node.getWorldPosition(new T.Vector3());
    const back = this._worldDir(node, new T.Vector3(0, 0, 1));
    this._sprite(this.tex.fire, p, { size: 0.5, grow: 3, life: 0.12 });
    for (let i = 0; i < 16; i++) {
      const v = back.clone().multiplyScalar(4 + Math.random() * 6).add(new T.Vector3().randomDirection().multiplyScalar(1.5));
      this._sprite(this.tex.smoke, p, { size: 0.3, grow: 5, life: 1.4 + Math.random(), add: false, opacity: 0.45, color: 0xa39d92, vel: v, drag: 2.5, rise: 0.3 });
    }
  }

  rocketFire(node, { speed = 52, target = null, range = 90, onExplode = null, model = null } = {}) {
    const T = this.T;
    const p = node.getWorldPosition(new T.Vector3());
    const d = target ? target.clone().sub(p).normalize() : this._worldDir(node, new T.Vector3(0, 0, -1));
    this.muzzle(node, 'rpg');
    const src = model || this.opt.rocket;
    const o = src ? src.clone() : new T.Mesh(new T.CylinderGeometry(0.04, 0.02, 0.6, 12).rotateX(Math.PI / 2), new T.MeshStandardMaterial({ color: 0x3a3f2a }));
    o.position.copy(p); o.quaternion.setFromUnitVectors(new T.Vector3(0, 0, -1), d); this.scene.add(o);
    const flame = this._sprite(this.tex.fire, p, { size: 0.35, life: 99 });
    const R = { o, flame, d, speed, v: 0, t: 0, dist: 0, target: target?.clone() || null, range, onExplode, trail: 0, held: false };
    this.rockets.push(R);
    if (this.onSound) this.onSound('en_rpg_flight', o);
    return R;
  }

  explosion(p, size = 7) {
    const T = this.T, s = size / 7;
    this._light(p.clone().setY(p.y + 1), 140 * s, 0.5, 0xffa050);
    this._sprite(this.tex.glow, p, { size: 6 * s, grow: 1, life: 0.12, color: 0xffe6b0 });
    for (let i = 0; i < 14; i++) {
      const v = new T.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.8 + 0.2; v.multiplyScalar((2 + Math.random() * 6) * s);
      this._sprite(this.tex.fire, p.clone().addScaledVector(v, 0.05), { size: (0.8 + Math.random()) * s, grow: 2.5, life: 0.35 + Math.random() * 0.35,
        vel: v, drag: 4, rise: 1.2 });
    }
    for (let i = 0; i < 22; i++) {
      const v = new T.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.6 + 0.1; v.multiplyScalar((1 + Math.random() * 5) * s);
      this._sprite(this.tex.smoke, p.clone(), { size: (1 + Math.random()) * s, grow: 3, life: 2.2 + Math.random() * 1.8, add: false, opacity: 0.55,
        color: 0x3f3a35, vel: v, drag: 1.6, rise: 0.9 * s, fadeIn: 0.15 });
    }
    for (let i = 0; i < 40; i++) {
      const v = new T.Vector3().randomDirection(); v.y = Math.abs(v.y) + 0.2; v.multiplyScalar((6 + Math.random() * 10) * s);
      this._sprite(this.tex.spark, p.clone(), { size: 0.08, life: 0.5 + Math.random() * 0.8, vel: v, gravity: 9.8, drag: 0.5 });
    }
    // ground shockwave ring + scorch
    const ring = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: this.tex.shockwave, transparent: true, depthWrite: false,
      blending: T.AdditiveBlending, color: 0xffd8a8 }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, this.floorY + 0.05, p.z); this.scene.add(ring);
    this.meshes.push({ o: ring, t: 0, life: 0.45, ring: size * 1.6, fade: true });
    this._decal(new T.Vector3(p.x, this.floorY, p.z), new T.Vector3(0, 1, 0), size * 0.7, 0.85);
    if (this.onSound) this.onSound('en_explosion', p);
  }

  // ------------------------------------------------------------------ frame
  update(dt, camera) {
    const T = this.T;
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const P = this.sprites[i]; P.t += dt; const k = P.t / P.life;
      if (k >= 1) { this.scene.remove(P.s); P.s.material.dispose(); this.sprites.splice(i, 1); continue; }
      if (P.vel) { P.vel.multiplyScalar(Math.exp(-P.drag * dt)); P.vel.y -= P.gravity * dt; P.s.position.addScaledVector(P.vel, dt); }
      P.s.position.y += P.rise * dt;
      P.s.scale.setScalar(P.size * (1 + P.grow * k));
      const fin = P.fadeIn > 0 ? Math.min(1, P.t / P.fadeIn) : 1;
      P.s.material.opacity = P.opacity * fin * (1 - k) * (1 - k * 0.3);
      if (P.spin) P.s.material.rotation += P.spin * dt;
    }
    for (let i = this.meshes.length - 1; i >= 0; i--) {
      const M = this.meshes[i]; M.t += dt; const k = M.t / M.life;
      if (k >= 1) { this.scene.remove(M.o); if (M.o.material !== this.brass) M.o.material.dispose?.(); if (M.tracer || M.ring || M.fade) M.o.geometry !== this.tracerGeo && M.o.geometry.dispose(); this.meshes.splice(i, 1); continue; }
      if (M.fade) M.o.material.opacity = 1 - k;
      if (M.ring) { const s = M.ring * (0.2 + k); M.o.scale.set(s, s, s); }
      if (M.tracer) {
        const tr = M.tracer, head = Math.min(tr.maxD, M.t * tr.speed);
        const hp = tr.from.clone().addScaledVector(tr.d, head);
        const len = Math.min(tr.length, head);
        M.o.position.copy(hp);
        // axis billboard: X along the flight direction, face the camera around it
        const x = tr.d, toCam = camera.position.clone().sub(hp).normalize();
        const z = toCam.sub(x.clone().multiplyScalar(toCam.dot(x))).normalize(), y = z.clone().cross(x);
        M.o.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
        M.o.scale.set(len, tr.width, 1);
        if (head >= tr.maxD) M.t = M.life;
      }
      if (M.shell) {
        const S = M.shell; S.v.y -= 9.8 * dt; M.o.position.addScaledVector(S.v, dt);
        M.o.rotation.x += S.w.x * dt; M.o.rotation.y += S.w.y * dt; M.o.rotation.z += S.w.z * dt;
        if (M.o.position.y < this.floorY + 0.005 && S.v.y < 0) {
          M.o.position.y = this.floorY + 0.005; S.v.y *= -0.35; S.v.x *= 0.5; S.v.z *= 0.5; S.w.multiplyScalar(0.5);
          if (S.bounces++ < 2 && this.onSound) this.onSound('en_shell_drop', M.o.position.clone());
        }
      }
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const L = this.lights[i]; L.t += dt; const k = L.t / L.life;
      if (k >= 1) { this.scene.remove(L.l); this.lights.splice(i, 1); } else L.l.intensity = L.i0 * (1 - k) * (1 - k);
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const R = this.rockets[i]; R.t += dt;
      if (R.held) { R.flame.position.copy(R.o.position); continue; }
      R.v = Math.min(R.speed, R.v + (R.t < 0.12 ? 60 : 180) * dt + (R.t < 0.02 ? 25 : 0));    // ejection, then the sustainer
      const step = R.v * dt; R.dist += step;
      R.o.position.addScaledVector(R.d, step);
      const tail = R.o.position.clone().addScaledVector(R.d, -0.35);
      R.flame.position.copy(tail); R.flame.material.opacity = R.t > 0.1 ? 0.9 + Math.random() * 0.1 : 0.2;
      R.trail += dt;
      while (R.trail > 0.012) {
        R.trail -= 0.012;
        this._sprite(this.tex.smoke, tail.clone().add(new T.Vector3().randomDirection().multiplyScalar(0.03)), { size: 0.18, grow: 5, life: 2.2 + Math.random(),
          add: false, opacity: 0.35, color: 0xcfcac2, rise: 0.15, fadeIn: 0.05 });
      }
      let boom = R.dist > R.range || R.o.position.y < this.floorY || (R.t > 0.08 && !!this.opt.hit?.(R.o.position, R.d, step + 0.3));
      if (R.target && R.o.position.distanceTo(R.target) < Math.max(0.6, step * 1.2)) boom = true;
      if (boom) {
        const p = R.o.position.clone(); if (p.y < this.floorY) p.y = this.floorY;
        this.scene.remove(R.o); this.scene.remove(R.flame); R.flame.material.dispose();
        const si = this.sprites.findIndex(s => s.s === R.flame); if (si >= 0) this.sprites.splice(si, 1);
        this.rockets.splice(i, 1);
        this.explosion(p, this.opt.blast ?? 7);
        R.onExplode?.(p);
      }
    }
  }

  clear() {
    for (const P of this.sprites) this.scene.remove(P.s);
    for (const M of this.meshes) this.scene.remove(M.o);
    for (const L of this.lights) this.scene.remove(L.l);
    for (const R of this.rockets) this.scene.remove(R.o);
    for (const d of this.decals) this.scene.remove(d);
    this.sprites = []; this.meshes = []; this.lights = []; this.rockets = []; this.decals = [];
  }
}
