// Camera director + time control for story sequences.
//
// The gameplay controller places world.camera every frame (updateCamera). The director runs AFTER
// that (MZ 'frame' event, before render) and, while it owns the shot, overwrites the camera with a
// blend between its last output and the current shot. Releasing blends back into whatever the
// controller does, so a cinematic always ends inside live gameplay — never on a cut to black.
//
//   dir.shot({ pos, look, fov, blend, ease, roll })   pos/look: Vector3 or () => Vector3 (tracks)
//   dir.cut({ ... })                                  same, blend 0
//   dir.release(blend)                                back to the gameplay camera
//   dir.shake(amount)                                 small handheld shake on top of shots
//   time.to(scale, seconds)                           smooth global time scale (slow motion)
import * as THREE from 'three';

const ease = {
  linear: t => t,
  inOut: t => t * t * (3 - 2 * t),
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  expo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};
const val = (v, t) => (typeof v === 'function' ? v(t) : v);
const _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(0, 0, 1);

export class Director {
  constructor(camera) {
    this.camera = camera;
    this.active = false;            // does the director own the camera this frame?
    this.cur = null;                // current shot
    this.t = 0;                     // time in the current shot
    this.from = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 60 };
    this.out = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 60 };
    this.game = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 60 };
    this.releasing = null;
    this.trauma = 0; this.handheld = 0;
  }
  _snapFrom() {
    // blend from what is on screen right now: our last output if we own the camera, else the game's
    if (this.active) { this.from.p.copy(this.out.p); this.from.q.copy(this.out.q); this.from.fov = this.out.fov; }
    else { this.from.p.copy(this.camera.position); this.from.q.copy(this.camera.quaternion); this.from.fov = this.camera.fov; }
  }
  shot(s) {
    this._snapFrom();
    this.cur = { blend: 0.8, ease: 'inOut', fov: 50, roll: 0, ...s }; this.t = 0;
    this.releasing = null; this.active = true;
    return this;
  }
  cut(s) { return this.shot({ ...s, blend: 0 }); }
  release(blend = 0.9, easeName = 'inOut') {
    if (!this.active) return;
    this._snapFrom(); this.cur = null; this.t = 0;
    this.releasing = { blend, ease: easeName };
  }
  get owns() { return this.active; }
  shake(a) { this.trauma = Math.min(1, this.trauma + a); }

  /** called every frame after the gameplay camera was placed (dt = real seconds) */
  apply(dt, T) {
    const cam = this.camera;
    this.game.p.copy(cam.position); this.game.q.copy(cam.quaternion); this.game.fov = cam.fov;
    if (!this.active) return;
    this.t += dt;
    let tp, tq = new THREE.Quaternion(), tfov, w;
    if (this.releasing) {
      const r = this.releasing;
      w = r.blend > 0 ? ease[r.ease](Math.min(1, this.t / r.blend)) : 1;
      tp = this.game.p; tq.copy(this.game.q); tfov = this.game.fov;
      if (w >= 1) { this.active = false; this.releasing = null; return; }   // the game camera is untouched
    } else {
      const s = this.cur, st = this.t;
      tp = val(s.pos, st).clone();
      const look = val(s.look, st);
      _m.lookAt(tp, look, _up); tq.setFromRotationMatrix(_m);
      const roll = val(s.roll, st) || 0; if (roll) tq.multiply(new THREE.Quaternion().setFromAxisAngle(_z, roll));
      tfov = val(s.fov, st);
      w = s.blend > 0 ? ease[s.ease](Math.min(1, st / s.blend)) : 1;
    }
    this.out.p.lerpVectors(this.from.p, tp, w);
    this.out.q.slerpQuaternions(this.from.q, tq, w);
    this.out.fov = this.from.fov + (tfov - this.from.fov) * w;
    cam.position.copy(this.out.p); cam.quaternion.copy(this.out.q);
    // handheld: a slow breathing drift + trauma shake
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const hh = (this.cur?.handheld ?? 0.25) + this.trauma * this.trauma * 3;
    if (hh > 0) {
      const n = T * 1.1;
      cam.rotateX((Math.sin(n * 1.3) + Math.sin(n * 2.1 + 1)) * 0.0015 * hh + (this.trauma ? Math.sin(T * 41) * 0.01 * this.trauma : 0));
      cam.rotateY((Math.sin(n * 0.9 + 2) + Math.sin(n * 1.7)) * 0.0015 * hh);
    }
    cam.fov = this.out.fov; cam.updateProjectionMatrix();
  }
}

/** Global time scale, smoothly ramped. Uses MZ.game.timeScale (core) when present, else the world's
 * slow-motion kick every frame. Story code keeps real time for its own cinematics. */
export class TimeCtl {
  constructor(MZ) { this.MZ = MZ; this.value = 1; this.target = 1; this.rate = 0; }
  to(scale, seconds = 0.5) {
    this.target = Math.max(0.02, scale);
    this.rate = seconds > 0 ? Math.abs(this.target - this.value) / seconds : Infinity;
  }
  update(dt) {
    const d = this.target - this.value;
    if (d) this.value = Math.abs(d) <= this.rate * dt ? this.target : this.value + Math.sign(d) * this.rate * dt;
    const g = this.MZ.game;
    if (typeof g.timeScale === 'number') g.timeScale = this.value;
    else if (this.value < 0.999) g.world?.kick?.({ slow: this.value, slowTime: 0.05 });
  }
  reset() { this.value = this.target = 1; this.update(0); }
}
export { ease };
