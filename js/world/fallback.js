// FALLBACK player controllers — only used while web/js/game/index.js (the gameplay agent's real
// controllers) does not exist. Purpose: keep the world playable end to end (rooms → world → two
// heroes moving, replicated, with VFX/haptics hooks) so the platform can be verified. Not the feel
// target. Interface = docs/CORE-API.md §createPlayer.
import * as THREE from 'three';
import { FlightModel, pilotCmd } from '../game/flight.js';
import { libsFor } from '../core/assets.js';

const SPAWN = {
  ironman: new THREE.Vector3(-560, 46, 640),       // hovering next to Peter's building (the Village)
  spiderman: new THREE.Vector3(-573, 25.4, 662),   // Peter's roof (layout.landmarks.apartment)
};
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

export async function createPlayer(MZ, world, opts) {
  const P = opts.hero === 'spiderman' ? SpiderFallback : IronFallback;
  const p = new P(MZ, world, opts); await p.init(); return p;
}

class Base {
  constructor(MZ, world, { id, name, hero, suit, local }) {
    Object.assign(this, { MZ, world, id, name, hero, suit, local });
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.heading = 0;
    this.net = { p: new THREE.Vector3(), q: new THREE.Quaternion(), has: false };
    this.clip = null; this.fov = 62;
    this.camYaw = 0; this.camPitch = -0.12; this.camPos = new THREE.Vector3();
  }
  async init() {
    const g = await this.MZ.assets.load(this.MZ.SUITS.find(s => s.id === this.suit)?.glb || 'assets/suits/mk85/mk85.glb');
    this.root = this.world.litModel(g.scene);
    this.world.scene.add(this.root);
    const cues = { sfx: { play: (id, o = {}) => this.MZ.audio.play(id, { at: o.at, gain: (o.gain ?? 1) * (this.local ? 1 : 0.8), rate: o.rate }) }, vfx: this.world.vfx };
    this.anim = await this.MZ.assets.player(this.root, g, libsFor(this.suit), cues);
  }
  play(name, fade = 0.3) { if (this.clip === name || !this.anim.clips[name]) return; this.clip = name; this.anim.play(name, { fade }); }
  snapshot() { return { x: this.pos.x, y: this.pos.y, z: this.pos.z, heading: this.heading, speed: this.vel.length() }; }
  applyState(s) { this.net.p.fromArray(s.p); this.net.q.fromArray(s.q); this.vel.fromArray(s.v || [0, 0, 0]); this.net.anim = s.a; this.net.th = s.th || 0; this.net.has = true; }
  remote(dt) {
    if (!this.net.has) return;
    const k = 1 - Math.exp(-dt * 12);
    this.pos.lerp(tmp.copy(this.net.p).addScaledVector(this.vel, 0.05), k);
    this.root.quaternion.slerp(this.net.q, k);
    if (this.net.anim) this.play(this.net.anim);
  }
  chaseCamera(dt, cam, { dist, height, side, lookAhead = 6 }) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.camPitch, this.camYaw, 0, 'YXZ'));
    const want = tmp.set(side, height, dist).applyQuaternion(q).add(this.pos);
    // keep the camera out of buildings: march from the head towards the wanted spot, stop short of a wall
    const head = tmp2.copy(this.pos).add(up), hf = this.world.hf, d = want.clone().sub(head), L = d.length(); d.divideScalar(L || 1);
    for (let s = 0.5; s <= L; s += 0.5) { const x = head.x + d.x * s, y = head.y + d.y * s, z = head.z + d.z * s; if (y < hf.groundAt(x, z) + 0.8) { want.copy(head).addScaledVector(d, Math.max(0.8, s - 0.9)); break; } }
    this.camPos.lerp(want, 1 - Math.exp(-dt * 10));
    if (!this._camInit) { this.camPos.copy(want); this._camInit = true; }
    cam.position.copy(this.camPos);
    cam.lookAt(tmp2.set(0, 0, -lookAhead).applyQuaternion(q).add(this.pos).add(tmp.set(0, 1.2, 0)));
  }
  dispose() { this.world.scene.remove(this.root); this.anim?.stopAll(); }
}

class IronFallback extends Base {
  async init() {
    await super.init();
    this.m = new FlightModel(this.suit);
    this.m.position.copy(SPAWN.ironman); this.m.yaw = Math.PI * 0.75;
    this.thr = this.world.vfx.rigThrusters(this.root, { palms: true });
    this.trails = ['piv_thrusterL', 'piv_thrusterR'].map(n => this.root.getObjectByName(n)).filter(Boolean).map(n => this.world.vfx.trail(n, { life: 1.6, width: 0.22, minSpeed: 14 }));
    this.act = this.MZ.actions('ironman');
    this.anim.onCue = (e) => {
      if (e.vfx !== 'repulsor_fire') return false;
      const palm = this.root.getObjectByName(e.at || 'piv_palmR'); if (!palm) return true;
      this.world.vfx.repulsors.fire(palm, this.aimPoint(), { big: !!e.big });
      this.MZ.audio.play('repulsor_fire', { at: palm.getWorldPosition(new THREE.Vector3()) });
      if (this.local) { this.MZ.haptics.play('repulsor_shot'); this.MZ.game.kick({ shake: 0.12, fov: 1.5 }); }
      return true;
    };
    this.pos.copy(this.m.position);
  }
  aimPoint() {
    const cam = this.world.camera, d = cam.getWorldDirection(new THREE.Vector3());
    const hit = this.world.hf.raycast(cam.position, d, 900, 3);
    return hit ? new THREE.Vector3(hit.x, hit.y, hit.z) : cam.position.clone().addScaledVector(d, 900);
  }
  update(dt) {
    if (!this.local) { this.remote(dt); this.root.position.copy(this.pos).y -= 1; for (const t of this.thr) t.set(this.net.th * 0.8); this.anim.update(dt); return; }
    if (dt <= 0) { this.anim.update(0); return; }
    const a = this.act, m = this.m;
    const pad = { axes: a.axes, ascend: a.down('ascend'), descend: a.down('descend'), ascendPressed: a.pressed('ascend'), boost: a.down('boost') };
    const wasGrounded = m.grounded, vy = m.velocity.y, prev = m.position.clone();
    const cmd = pilotCmd(m, pad, dt);
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (let i = 0; i < n; i++) {
      m.groundY = this.world.hf.groundAt(m.position.x, m.position.z);
      const before = m.position.clone();
      m.step(h, i === 0 ? cmd : { ...cmd, look: { x: 0, y: 0 } });
      // walls: entering a cell whose roof is above the suit's body → slide back out, kill the push
      const roof = this.world.hf.groundAt(m.position.x, m.position.z);
      if (roof > before.y - 0.5 && roof > m.position.y - 1 + 0.6) {
        const sp = m.velocity.length();
        m.position.x = before.x; m.position.z = before.z; m.velocity.x *= -0.15; m.velocity.z *= -0.15;
        if (sp > 25 && !this._bonk) { this._bonk = true; this.MZ.haptics.play('hit_heavy'); this.MZ.game.kick({ shake: 0.5, hitstop: 60 }); this.MZ.audio.play('en_impact_metal', { at: m.position.clone() }); setTimeout(() => this._bonk = false, 400); }
      }
    }
    if (!wasGrounded && m.grounded && vy < -3) { this.MZ.haptics.land(-vy); this.MZ.game.kick({ shake: Math.min(0.6, -vy / 40), fov: -2 }); this.MZ.game.event({ kind: 'land', speed: -vy }); }
    if (a.pressed('boost') && m.spec.id !== 'mk1') { this.MZ.haptics.play('boost'); this.MZ.game.kick({ fov: 9, shake: 0.2 }); this.MZ.audio.play('im_boost', { at: this.pos }); }
    if (a.pressed('rep_r')) this.anim.play('shoot_R', { loop: false, fade: 0.06 });
    if (a.pressed('rep_l')) this.anim.play('shoot_L', { loop: false, fade: 0.06 });
    this.MZ.haptics.hum('thruster', m.grounded ? 0 : Math.min(1, m.thrustMag / 1.2), dt);
    this.pos.copy(m.position); this.vel.copy(m.velocity); this.heading = m.yaw;
    this.root.position.copy(m.position).y -= 1;
    this.root.quaternion.copy(m.viewQuat);
    for (const t of this.thr) t.set(m.grounded ? 0 : Math.min(1.2, m.thrustMag * 0.8));
    // base clip by state
    const sp = m.speed, lat = cmd.lateral, v = cmd.vertical;
    let c;
    if (m.grounded) c = m.groundSpeed < 0.3 ? 'idle' : m.groundSpeed < 3.5 ? 'walk' : 'run';
    else if (m.hoverActive || sp < 6) c = 'hover';
    else if (Math.abs(lat) > 0.55 && sp < 90) c = lat > 0 ? 'fly_strafe_R' : 'fly_strafe_L';
    else if (v > 0.5 && sp < 40) c = 'fly_ascend';
    else if (v < -0.5 && sp < 40) c = 'fly_descend';
    else c = sp < 45 ? 'fly_slow' : sp < 160 ? 'fly_cruise' : 'fly_fast';
    this.play(c, 0.35);
    this.anim.update(dt);
    this.fov = 62 + 18 * Math.min(1, sp / m.spec.top_speed);
  }
  updateCamera(dt, cam) {
    const m = this.m;
    this.camYaw = m.yaw; this.camPitch = THREE.MathUtils.clamp(m.pitch * 0.85 - 0.14, -1.2, 1.0);
    this.chaseCamera(dt, cam, { dist: 6.5 + m.speed * 0.012, height: 1.9, side: 1.1, lookAhead: 12 });
  }
  state() { return { p: this.pos.toArray().map(v => +v.toFixed(2)), q: this.root.quaternion.toArray().map(v => +v.toFixed(4)), v: this.vel.toArray().map(v => +v.toFixed(2)), a: this.clip, th: +this.m.thrustMag.toFixed(2) }; }
  applyState(s) { super.applyState(s); }
  hud() { const m = this.m; return { speed: m.speed, vspeed: m.velocity.y, alt: m.position.y - 1, heading: ((-m.yaw * 180 / Math.PI) % 360 + 360) % 360, throttle: Math.min(1, m.thrustMag), boost: !!m.boostActive, hover: m.hoverActive, grounded: m.grounded, g: m.gForce }; }
}

class SpiderFallback extends Base {
  async init() {
    await super.init();
    this.pos.copy(SPAWN.spiderman); this.grounded = true; this.line = null; this.anchor = null; this.ropeLen = 0;
    this.act = this.MZ.actions('spiderman');
    this.camYaw = Math.PI * 0.8;
  }
  update(dt) {
    if (!this.local) { this.remote(dt); this.root.position.copy(this.pos); this.anim.update(dt); return; }
    if (dt <= 0) { this.anim.update(0); return; }
    const a = this.act, ax = a.axes, hf = this.world.hf;
    this.camYaw -= ax.rx * 2.6 * dt; this.camPitch = THREE.MathUtils.clamp(this.camPitch - ax.ry * 1.8 * dt, -1.1, 0.6);
    const fwd = tmp.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw)), right = tmp2.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const wish = new THREE.Vector3().addScaledVector(fwd, -ax.ly).addScaledVector(right, ax.lx);
    const ground = hf.groundAt(this.pos.x, this.pos.z);
    const wasG = this.grounded, vy0 = this.vel.y;
    // swing on R2: rope to a point up and ahead that has a building under it
    if (a.pressed('swing') && !this.grounded) {
      const f = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
      for (const d of [26, 20, 34, 14]) {
        const p = this.pos.clone().addScaledVector(f, d); p.y += 24;
        const roof = hf.maxAround(p.x, p.z, 8);
        if (roof > this.pos.y + 6) { p.y = Math.min(p.y, roof); this.anchor = p; this.ropeLen = p.distanceTo(this.pos); break; }
      }
      if (this.anchor) {
        const hand = this.root.getObjectByName('piv_webR') || this.root.getObjectByName('piv_wristR');
        this.line = this.world.webfx.line({ from: hand, to: this.anchor.clone() });
        this.MZ.haptics.play('web_thwip'); setTimeout(() => this.MZ.haptics.play('web_attach'), 120);
      } else this.MZ.haptics.play('ui_error', 0.4);
    }
    if (this.anchor && (!a.down('swing') || this.grounded)) {
      this.line?.release?.(); this.line = null; this.anchor = null;
      this.vel.y += 4; this.vel.addScaledVector(this.vel.clone().setY(0).normalize(), 3);
      this.MZ.haptics.play('web_release'); this.play('swing_release', 0.1);
    }
    if (this.grounded) {
      const target = wish.clone().multiplyScalar(wish.length() > 0.8 ? 14 : 8);
      this.vel.x += (target.x - this.vel.x) * Math.min(1, dt * 10); this.vel.z += (target.z - this.vel.z) * Math.min(1, dt * 10);
      if (a.pressed('jump')) { this.vel.y = 11; this.grounded = false; this.MZ.audio.play('sp_jump', { at: this.pos.clone() }); }
    } else {
      this.vel.addScaledVector(wish, 12 * dt);
      this.vel.y -= 22 * dt;
    }
    this.pos.addScaledVector(this.vel, dt);
    if (this.anchor) {   // rope: pulls, never pushes
      const d = this.pos.clone().sub(this.anchor), L = d.length();
      if (L > this.ropeLen) { d.divideScalar(L); this.pos.copy(this.anchor).addScaledVector(d, this.ropeLen); const vr = this.vel.dot(d); if (vr > 0) this.vel.addScaledVector(d, -vr); }
      if (a.down('reel_in')) this.ropeLen = Math.max(4, this.ropeLen - 12 * dt);
      if (a.down('reel_out')) this.ropeLen += 12 * dt;
      this.MZ.haptics.hum('web', Math.min(1, this.vel.length() / 40), dt);
    }
    // walls: a roof above us in the new cell = cling and climb
    const roof = hf.groundAt(this.pos.x, this.pos.z);
    if (roof > this.pos.y + 0.4 && roof > ground + 0.4) {
      this.pos.x -= this.vel.x * dt; this.pos.z -= this.vel.z * dt;
      this.vel.x = 0; this.vel.z = 0; this.vel.y = Math.max(this.vel.y, -ax.ly * 8);
      this.wall = true;
      if (this.pos.y > roof - 1.0 && -ax.ly > 0.3) { this.pos.y = roof + 0.05; }
    } else this.wall = false;
    const g2 = hf.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y <= g2) { this.pos.y = g2; if (this.vel.y < 0) this.vel.y = 0; this.grounded = true; } else if (this.pos.y > g2 + 0.2) this.grounded = false;
    if (!wasG && this.grounded && vy0 < -6) { this.MZ.haptics.land(-vy0); this.MZ.game.kick({ shake: Math.min(0.5, -vy0 / 40) }); this.play('land', 0.08); this._landT = 0.35; }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.5) this.heading = Math.atan2(-this.vel.x, -this.vel.z);
    this.root.position.copy(this.pos); this.root.rotation.set(0, this.heading, 0);
    this._landT = Math.max(0, (this._landT || 0) - dt);
    let c = this.clip;
    if (this._landT > 0) c = 'land';
    else if (this.anchor) c = 'swing';
    else if (this.wall) c = 'wall_crawl';
    else if (!this.grounded) c = this.vel.y > 2 ? 'jump' : 'fall';
    else c = hs < 0.5 ? 'idle' : hs < 10 ? 'run' : 'sprint';
    this.play(c, 0.2);
    this.anim.update(dt);
    this.fov = 60 + 10 * Math.min(1, this.vel.length() / 40);
  }
  updateCamera(dt, cam) { this.chaseCamera(dt, cam, { dist: 5.2, height: 1.7, side: 0.8, lookAhead: 6 }); }
  state() { return { p: this.pos.toArray().map(v => +v.toFixed(2)), q: this.root.quaternion.toArray().map(v => +v.toFixed(4)), v: this.vel.toArray().map(v => +v.toFixed(2)), a: this.clip }; }
  hud() { return { speed: this.vel.length(), vspeed: this.vel.y, alt: this.pos.y, heading: ((-this.heading * 180 / Math.PI) % 360 + 360) % 360, grounded: this.grounded, web: this.anchor ? { attached: true, tension: Math.min(1, this.vel.length() / 40) } : null }; }
}
