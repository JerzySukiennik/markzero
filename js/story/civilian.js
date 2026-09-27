// The hero OUT of the suit — Peter in the apartment, Tony in the villa workshop. Walk / run on the
// left stick, close third-person camera on the right stick. Collision is against the base's own
// meshes (floor by a down ray, walls by horizontal rays at knee and chest height), which is exactly
// what the room looks like — the city collider treats the whole building as one solid prism.
// Also used by the sequences as a puppet: walkTo(point) auto-steers, play(clip) runs one-shots.
import * as THREE from 'three';
import { ClipPlayer } from '../gfx/player.js';

const WHO = {
  peter: { glb: 'assets/characters/peter/peter.glb', libs: ['assets/anims/human_core_174.glb', 'assets/anims/spider_core.glb'], eye: 1.55 },
  tony: { glb: 'assets/characters/tony/tony.glb', libs: ['assets/anims/human_core.glb'], eye: 1.68 },
};
const WALK = 1.45, RUN = 3.6, ACCEL = 9, TURN = 10, R = 0.3, STEP_UP = 0.45, LOOK = 2.4;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
const curve = v => Math.sign(v) * v * v;
const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
function angDamp(a, b, rate, dt) { const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * (1 - Math.exp(-rate * dt)); }

export class Civilian {
  constructor(MZ, world, who, { colliders = [] } = {}) {
    Object.assign(this, { MZ, world, who, colliders });
    this.cfg = WHO[who];
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0;
    this.camYaw = 0; this.camPitch = -0.12; this.camDist = 2.3;
    this.control = true; this.target = null; this.speed = 0;
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    this.camPos = new THREE.Vector3(); this.camInit = false;
  }
  async load() {
    const MZ = this.MZ, A = MZ.assets;
    const [g, ...libs] = await Promise.all([A.load(this.cfg.glb), ...this.cfg.libs.map(l => A.load(l).catch(() => null))]);
    const root = this.root = g.scene; root.name = 'civilian_' + this.who;
    this.world.litModel ? this.world.litModel(root) : null;
    const names = new Set(); root.traverse(o => names.add(o.name));
    // only the tracks this body has (no drv_*/legs on Peter, no leg nodes on Tony)
    const clips = libs.filter(Boolean).flatMap(l => l.animations).map(c => { const k = c.clone(); k.tracks = k.tracks.filter(t => names.has(t.name.split('.')[0])); return k; });
    const cues = { sfx: { play: (id, o = {}) => MZ.audio.play(id, { ...o, gain: (o.gain ?? 1) * 0.8 }) }, vfx: this.world.vfx };
    this.anim = new ClipPlayer(root, clips, libs.filter(Boolean).map(l => l.clips), cues);
    this.anim.play(this.cfg.libs[0].includes('human') ? 'human_idle' : 'idle', { fade: 0 });
    this.loco = 'human_idle';
    this.world.scene.add(root);
    return this;
  }
  place(p, yaw) { this.pos.copy(p); this.yaw = yaw; this.camYaw = yaw; this.vel.set(0, 0, 0); this.camInit = false; this._sync(); }
  _sync() { this.root.position.copy(this.pos); this.root.rotation.set(0, this.yaw, 0); }

  _hit(from, dir, far) {
    this.ray.set(from, dir); this.ray.far = far;
    const h = this.ray.intersectObjects(this.colliders, true);
    for (const x of h) if (x.object.visible !== false && !x.object.userData.noCollide) return x;
    return null;
  }
  groundAt(p) {
    const h = this._hit(_v2.set(p.x, p.y + 1.2, p.z), DOWN, 3);
    return h ? h.point.y : null;
  }

  /** one-shot clip (window_open, human_catch…); resolves when it ends */
  play(name, { fade = 0.25, rate = 1 } = {}) {
    this.oneShot = name;
    const a = this.anim.play(name, { fade, loop: false }); if (!a) return Promise.resolve();
    a.timeScale = rate;
    const dur = this.anim.clips[name].duration / rate;
    return new Promise(res => { this._osEnd = res; this._osT = dur; });
  }
  stopOneShot(fade = 0.3) { this.oneShot = null; this.loco = null; this._osEnd = null; this._locoAnim(0, fade); }

  walkTo(p, { run = false, stopDist = 0.25, faceYaw = null } = {}) {
    this.target = { p: p.clone(), run, stopDist, faceYaw };
    return new Promise(res => { this.target.res = res; });
  }

  update(dt, act) {
    const ax = act && this.control ? act.axes : { lx: 0, ly: 0, rx: 0, ry: 0 };
    this.camYaw -= curve(ax.rx) * LOOK * dt;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - curve(ax.ry) * LOOK * 0.6 * dt, -0.9, 0.5);
    // wish velocity: stick in camera frame, or the auto-steer target
    let wx = 0, wz = 0, mag = 0, run = false;
    if (this.target) {
      _d.subVectors(this.target.p, this.pos); _d.y = 0; const dist = _d.length();
      if (dist <= this.target.stopDist) {
        const t = this.target; this.target = null;
        if (t.faceYaw != null) this._faceT = t.faceYaw;
        t.res?.();
      } else { _d.divideScalar(dist); wx = _d.x; wz = _d.z; mag = Math.min(1, dist / 0.6); run = this.target.run; }
    } else if (!this.oneShot) {
      const f = [-Math.sin(this.camYaw), -Math.cos(this.camYaw)], r = [Math.cos(this.camYaw), -Math.sin(this.camYaw)];
      wx = f[0] * -ax.ly + r[0] * ax.lx; wz = f[1] * -ax.ly + r[1] * ax.lx;
      const l = Math.hypot(wx, wz); mag = Math.min(1, l); if (l > 1e-3) { wx /= l; wz /= l; }
      run = mag > 0.85;
      if (mag < 0.15) mag = 0;
    }
    const want = mag * (run ? RUN : mag > 0.6 ? WALK * 1.15 : WALK);
    const tvx = wx * want, tvz = wz * want;
    this.vel.x = damp(this.vel.x, tvx, ACCEL, dt); this.vel.z = damp(this.vel.z, tvz, ACCEL, dt);
    if (this.oneShot && !this._rootMotion) this.vel.set(0, 0, 0);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.2 && !this.oneShot) this.yaw = angDamp(this.yaw, Math.atan2(-this.vel.x, -this.vel.z), TURN, dt);
    else if (this._faceT != null) { this.yaw = angDamp(this.yaw, this._faceT, 7, dt); if (Math.abs(this.yaw - this._faceT) < 0.02) this._faceT = null; }
    // move with wall collision (knee + chest rays along the move), slide along walls
    const step = _v.set(this.vel.x * dt, 0, this.vel.z * dt);
    if (step.lengthSq() > 1e-10) {
      for (const hgt of [0.45, 1.25]) {
        const len = step.length(), dir = _d.copy(step).divideScalar(len);
        const h = this._hit(_v2.set(this.pos.x, this.pos.y + hgt, this.pos.z), dir, len + R);
        if (h && h.face) {
          const n = h.face.normal.clone().transformDirection(h.object.matrixWorld); n.y = 0; n.normalize();
          const into = step.dot(n); if (into < 0) step.addScaledVector(n, -into);
          const gap = h.distance - R; if (gap < 0) step.addScaledVector(n, -gap);
        }
      }
      this.pos.add(step);
    }
    const g = this.groundAt(this.pos);
    if (g != null && g - this.pos.y < STEP_UP) this.pos.y = damp(this.pos.y, g, 20, dt);
    this._sync();
    // animation: locomotion unless a one-shot runs
    if (this.oneShot) {
      this._osT -= dt;
      if (this._osT <= 0) { const r = this._osEnd; this._osEnd = null; this.oneShot = null; this.loco = null; r?.(); }
    }
    if (!this.oneShot) this._locoAnim(dt);
    this.anim.update(dt);
  }
  _locoAnim(dt, fade = 0.25) {
    const s = this.speed, name = s > 2.4 ? 'human_run' : s > 0.25 ? 'human_walk' : 'human_idle';
    if (name !== this.loco) { this.loco = name; this.anim.play(name, { fade }); }
    const a = this.anim.base; if (!a) return;
    a.timeScale = name === 'human_run' ? THREE.MathUtils.clamp(s / 3.6, 0.7, 1.4) : name === 'human_walk' ? THREE.MathUtils.clamp(s / 1.4, 0.6, 1.5) : 1;
  }

  /** close over-the-shoulder camera, pulled in by the room's walls */
  updateCamera(dt, cam) {
    const eye = _v.copy(this.pos); eye.y += this.cfg.eye - 0.1;
    const cp = Math.cos(this.camPitch);
    const back = _d.set(Math.sin(this.camYaw) * cp, -Math.sin(this.camPitch), Math.cos(this.camYaw) * cp);
    const side = _v2.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw)).multiplyScalar(0.45);
    const pivot = eye.clone().add(side);
    let dist = this.camDist;
    const h = this._hit(pivot, back, dist + 0.25); if (h) dist = Math.max(0.5, h.distance - 0.25);
    const want = pivot.addScaledVector(back, dist);
    if (!this.camInit) { this.camPos.copy(want); this.camInit = true; } else this.camPos.lerp(want, 1 - Math.exp(-dt * 14));
    cam.position.copy(this.camPos);
    cam.lookAt(_v.x + side.x * 0.8, _v.y - 0.05, _v.z + side.z * 0.8);
    cam.fov = damp(cam.fov, 58, 6, dt); cam.updateProjectionMatrix();
  }
  dispose() { this.root?.removeFromParent(); this.anim?.stopAll(); }
}
