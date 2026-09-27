// Web test range — a brick target wall, a floor, three training dummies, a steel gantry to swing
// from, and a stand-in Spider-Man whose web-shooter emitters (`piv_webL/R`, local −Y = shot
// direction along the forearm) drive WebFX. Shared by the showroom exhibit (exhibits/webs) and
// test.html. Every demo is a timeline run with a fixed timestep, so `seek(name, t)` is exact.
import * as THREE from 'three';
import { WebFX, JUICE } from './web.three.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const H = 1 / 120;

// ------------------------------------------------------------------------------------ textures
function brickTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#6f6a63'; x.fillRect(0, 0, 1024, 512);
  const bw = 64, bh = 24, m = 3;
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < 512 / bh; row++) {
    const off = (row % 2) * bw / 2;
    for (let col = -1; col < 1024 / bw + 1; col++) {
      const r = 120 + rnd() * 50, g = 52 + rnd() * 22, b = 40 + rnd() * 16, k = 0.8 + rnd() * 0.35;
      x.fillStyle = `rgb(${r * k | 0},${g * k | 0},${b * k | 0})`;
      x.fillRect(col * bw + off + m / 2, row * bh + m / 2, bw - m, bh - m);
      for (let i = 0; i < 18; i++) { x.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`; x.fillRect(col * bw + off + rnd() * bw, row * bh + rnd() * bh, 2 + rnd() * 5, 1 + rnd() * 3); }
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
function concreteTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#57595c'; x.fillRect(0, 0, 512, 512);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) { const v = 70 + rnd() * 40 | 0; x.fillStyle = `rgba(${v},${v},${v + 3},${0.05 + rnd() * 0.12})`; const s = 1 + rnd() * 10; x.fillRect(rnd() * 512, rnd() * 512, s, s); }
  x.strokeStyle = 'rgba(20,20,22,0.55)'; x.lineWidth = 2;
  for (let i = 0; i <= 512; i += 256) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(512, i); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(16, 16); t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------------------------ stand-in
/** A red/blue mannequin with aimable arms. Faces −Z; R = +X (CONTRACT §1). */
class StandIn {
  constructor() {
    const root = this.root = new THREE.Group(); root.name = 'spider_standin';
    const red = new THREE.MeshStandardMaterial({ color: 0xa3141c, roughness: 0.45, metalness: 0.15 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1b2c72, roughness: 0.5, metalness: 0.1 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.2, emissive: 0x404448 });
    const add = (geo, mat, x, y, z, parent = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    add(new THREE.CapsuleGeometry(0.155, 0.36, 6, 14), red, 0, 1.30, 0);
    add(new THREE.CapsuleGeometry(0.13, 0.12, 6, 14), blue, 0, 0.96, 0);
    const head = add(new THREE.SphereGeometry(0.115, 20, 16), red, 0, 1.71, 0);
    head.scale.set(1, 1.12, 1);
    for (const s of [-1, 1]) {
      const eye = add(new THREE.SphereGeometry(0.035, 12, 8), white, s * 0.045, 1.725, -0.098); eye.scale.set(1.2, 0.8, 0.35);
      add(new THREE.CapsuleGeometry(0.072, 0.72, 6, 12), blue, s * 0.1, 0.48, 0);
    }
    this.shoulder = {}; this.web = {}; this.aimW = { L: 0, R: 0 }; this.aimOn = { L: false, R: false };
    this.aimTarget = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this.restQ = {};
    for (const [hand, s] of [['L', -1], ['R', 1]]) {
      const sh = new THREE.Group(); sh.name = 'piv_shoulder' + hand; sh.position.set(s * 0.225, 1.49, 0); root.add(sh);
      add(new THREE.CapsuleGeometry(0.055, 0.46, 6, 12), red, 0, -0.29, 0, sh);
      add(new THREE.SphereGeometry(0.05, 12, 10), red, 0, -0.6, 0, sh);
      add(new THREE.CylinderGeometry(0.03, 0.034, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.3 }), 0, -0.51, 0.035, sh);
      const web = new THREE.Object3D(); web.name = 'piv_web' + hand; web.position.set(0, -0.56, 0.035); sh.add(web);
      this.shoulder[hand] = sh; this.web[hand] = web;
      this.restQ[hand] = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), V(s * 0.28, -1, 0.06).normalize());
      sh.quaternion.copy(this.restQ[hand]);
    }
    this.vel = new THREE.Vector3(); this.yaw = 0;
    this._q = new THREE.Quaternion(); this._qi = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
  }
  aimAt(hand, p, on = true) { this.aimOn[hand] = on; if (p) this.aimTarget[hand].copy(p); }
  reset(pos, yaw = 0) {
    this.root.position.copy(pos); this.vel.set(0, 0, 0); this.yaw = yaw; this.root.rotation.set(0, yaw, 0);
    for (const h of ['L', 'R']) { this.aimW[h] = 0; this.aimOn[h] = false; this.shoulder[h].quaternion.copy(this.restQ[h]); }
    this.root.updateMatrixWorld(true);
  }
  /** arms: 70 ms up (the web leaves at full extension), 250 ms down */
  pose(dt) {
    this.root.rotation.set(0, this.yaw, 0);
    this.root.updateMatrixWorld(true);
    this._qi.copy(this.root.quaternion).invert();
    for (const h of ['L', 'R']) {
      this.aimW[h] = clamp(this.aimW[h] + (this.aimOn[h] ? dt / 0.07 : -dt / 0.25), 0, 1);
      const w = 1 - Math.pow(1 - this.aimW[h], 3);
      const sh = this.shoulder[h];
      sh.getWorldPosition(this._v);
      this._w.copy(this.aimTarget[h]).sub(this._v).applyQuaternion(this._qi).normalize();
      this._q.setFromUnitVectors(V(0, -1, 0), this._w);
      sh.quaternion.slerpQuaternions(this.restQ[h], this._q, w);
    }
    this.root.updateMatrixWorld(true);
  }
}

// ------------------------------------------------------------------------------------ juice
/** FOV kicks (attack/decay envelopes), trauma shake via view offset, hitstop, pad rumble. */
export class CameraJuice {
  constructor(camera) { this.cam = camera; this.baseFov = camera.fov; this.kicks = []; this.trauma = 0; this.t = 0; this.hitstop = 0; this.enabled = true; this.rumble = true; }
  kick(deg) {
    // small kicks are quick (thwip: 60 ms up, 180 ms back); big ones linger (zip: 90 / 380 ms)
    const big = Math.abs(deg) > 3;
    this.kicks.push({ a: deg, t: 0, up: big ? 0.09 : 0.06, down: big ? 0.38 : 0.18 });
  }
  on(kind, v) {
    if (!this.enabled) return;
    if (kind === 'fov_kick') this.kick(v);
    else if (kind === 'shake') this.trauma = Math.min(1, this.trauma + v);
    else if (kind === 'hitstop') this.hitstop = Math.max(this.hitstop, v);
    else if (kind === 'rumble' && this.rumble && typeof navigator !== 'undefined' && navigator.getGamepads) {
      for (const g of navigator.getGamepads()) g?.vibrationActuator?.playEffect?.('dual-rumble', { duration: v.duration * 1000, strongMagnitude: v.low, weakMagnitude: v.high }).catch?.(() => { });
    }
  }
  update(dt) {
    this.t += dt;
    let f = 0;
    for (let i = this.kicks.length - 1; i >= 0; i--) {
      const k = this.kicks[i]; k.t += dt;
      if (k.t >= k.up + k.down) { this.kicks.splice(i, 1); continue; }
      const e = k.t < k.up ? 1 - Math.pow(1 - k.t / k.up, 2) : 1 - (k.t - k.up) / k.down;
      f += k.a * (k.t < k.up ? e : e * e * (3 - 2 * e));
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const c = this.cam;
    c.fov = this.baseFov + f;
    const s = this.trauma * this.trauma;
    if (s > 1e-4) {
      const W = 1000, Hh = 1000 / c.aspect, n = this.t * 27;
      const dx = (Math.sin(n * 1.7) + Math.sin(n * 3.1 + 1.3) * 0.5) * 12 * s, dy = (Math.sin(n * 2.3 + 0.7) + Math.sin(n * 4.3) * 0.5) * 12 * s;
      c.setViewOffset(W, Hh, dx, dy, W, Hh);
    } else if (c.view && c.view.enabled) c.clearViewOffset();
    c.updateProjectionMatrix();
  }
  reset() { this.kicks.length = 0; this.trauma = 0; this.hitstop = 0; const c = this.cam; c.fov = this.baseFov; if (c.view && c.view.enabled) c.clearViewOffset(); c.updateProjectionMatrix(); }
}

// ------------------------------------------------------------------------------------ demos
const WALL_Z = -15.75, ANCHOR_Y = 14.72;
export const DEMOS = {
  demo_shot_R:     { label: 'Shot R (glob)', dur: 1.5, cam: [[0.3, 2.0, -8.5], [1.9, 2.5, 3.4]] },
  demo_shot_L:     { label: 'Shot L (glob)', dur: 1.5, cam: [[-0.3, 2.0, -8.5], [-1.9, 2.5, 3.4]] },
  demo_rapid:      { label: 'Mash R1/L1', dur: 3.0, cam: [[0.0, 2.6, -12], [1.6, 2.6, 3.8]] },
  demo_swing:      { label: 'Swing + release', dur: 4.2, cam: [[0.0, 8.5, -3.0], [19, 6.0, 15]] },
  demo_slack:      { label: 'Slack / taut / creak', dur: 4.8, cam: [[-0.8, 2.4, -9.0], [9.5, 3.6, 0.5]] },
  demo_zip:        { label: 'Web-zip', dur: 1.6, cam: [[0.0, 3.6, -7.5], [10.5, 4.2, 4.5]] },
  demo_pull:       { label: 'Pull (yank)', dur: 1.7, cam: [[0.3, 1.2, -5.8], [7.8, 2.8, -1.5]] },
  demo_snap:       { label: 'Snap', dur: 2.2, cam: [[0.0, 9.5, -2.0], [17, 7.0, 13]] },
  demo_splat_wall: { label: 'Splats (wall)', dur: 3.0, cam: [[0.0, 2.8, -15.5], [3.2, 3.2, -6.0]] },
  demo_splat_close:{ label: 'Splat close-up', dur: 1.2, cam: [[0.5, 2.25, WALL_Z], [0.95, 2.45, -14.35]] },
};

// ------------------------------------------------------------------------------------ range
export class WebRange {
  /**
   * @param o.scene, o.camera
   * @param o.onSound (id, {position, gain})   @param o.juice CameraJuice | null
   */
  constructor({ scene, camera, onSound = null, juice = null, seed = 7 }) {
    this.scene = scene; this.camera = camera; this.seed = seed; this.juice = juice;
    this.root = new THREE.Group(); this.root.name = 'web_range'; scene.add(this.root);
    this.targets = [];
    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.92, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.003; floor.receiveShadow = true; floor.name = 'range_floor';
    this.root.add(floor); this.targets.push(floor);
    // brick wall
    const bt = brickTexture(); bt.repeat.set(4.2, 4.0);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 0.5), new THREE.MeshStandardMaterial({ map: bt, roughness: 0.88, metalness: 0 }));
    wall.position.set(0, 3.5, WALL_Z - 0.25); wall.castShadow = wall.receiveShadow = true; wall.name = 'range_wall';
    this.root.add(wall); this.targets.push(wall);
    // gantry
    const steel = new THREE.MeshStandardMaterial({ color: 0x3b4450, roughness: 0.55, metalness: 0.7 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 0.55, 0.45), steel); beam.position.set(0, ANCHOR_Y + 0.275, -3.5); beam.castShadow = true; beam.name = 'range_beam';
    this.root.add(beam); this.targets.push(beam);
    for (const x of [-12.8, 12.8]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, ANCHOR_Y + 0.55, 0.6), steel); p.position.set(x, (ANCHOR_Y + 0.55) / 2, -3.5); p.castShadow = true; this.root.add(p); this.targets.push(p); }
    // dummies
    const tan = new THREE.MeshStandardMaterial({ color: 0xa08a68, roughness: 0.85 });
    const stand = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.5 });
    this.dummies = [];
    for (const [x, z] of [[-3.2, -8.0], [0.6, -9.5], [3.6, -7.2]]) {
      const g = new THREE.Group(); g.name = 'dummy'; g.userData.isBody = true;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.95, 6, 16), tan); body.position.y = 1.02; body.castShadow = true; body.userData.isBody = true; body.name = 'dummy_body';
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), tan); head.position.y = 1.86; head.castShadow = true; head.userData.isBody = true; head.name = 'dummy_head';
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.22, 0.5, 12), stand); post.position.y = 0.25; post.userData.noWeb = false;
      g.add(body, head, post);
      g.userData.home = V(x, 0, z); g.userData.vel = new THREE.Vector3(); g.userData.fly = false;
      g.position.set(x, 0, z);
      this.root.add(g); this.dummies.push(g); this.targets.push(g);
    }
    // stand-in
    this.fig = new StandIn(); this.root.add(this.fig.root);
    this.fig.root.traverse(o => { if (o.isMesh) o.userData.noWeb = true; });
    // web fx
    this.fx = new WebFX({
      scene, camera, raycastTargets: this.targets, seed,
      onSound: onSound,
      onJuice: (k, v) => { this.juiceLog.push([this.t, k, v]); this.juice?.on(k, v); },
    });
    this.fx.groundY = 0.015;
    // a key light from the shooter's side: the showroom's studio key sits behind the wall
    this.key = new THREE.DirectionalLight(0xfff2e4, 1.5); this.key.position.set(6, 10, 8);
    this.root.add(this.key); this.root.add(this.key.target);
    this.fx.setLight(this.key.position);
    this.juiceLog = [];
    this.soundLog = [];
    this.anchor = V(0.8, ANCHOR_Y, -3.5);
    this.zipPoint = V(0.4, 7.02, WALL_Z + 0.03);
    this.name = null; this.t = 0; this.events = []; this.ei = 0; this.rope = null; this.ropeHand = 'R';
    this.state = {};
  }

  setLightFrom(dirLight) { if (dirLight) this.fx.setLight(dirLight.position.clone().sub(dirLight.target?.position || V(0, 0, 0))); }

  /** Aim compensation for the glob's gravity drop. */
  aimDir(from, to, speed = 70, g = 3.0) {
    const d = to.clone().sub(from), t = d.length() / speed;
    d.y += 0.5 * g * t * t;
    return d.normalize();
  }
  shootAt(hand, target, opts = {}) {
    const w = this.fig.web[hand], from = w.getWorldPosition(V(0, 0, 0));
    return this.fx.shoot({ from: w, dir: this.aimDir(from, target), hand, ...opts });
  }

  reset(name) {
    const fx = this.fx;
    fx.clear(); fx.reseed(this.seed); fx.time = 0;
    this.juice?.reset();
    this.juiceLog.length = 0;
    this.name = name; this.t = 0; this.ei = 0; this.rope = null; this.state = {};
    for (const d of this.dummies) { d.position.copy(d.userData.home); d.rotation.set(0, 0, 0); d.userData.vel.set(0, 0, 0); d.userData.fly = false; }
    const fig = this.fig;
    fig.reset(V(0, 0, 0), 0);
    this.physics = 'stand';
    const ev = this.events = [];
    const at = (t, fn) => ev.push([t, fn]);
    const A = this.anchor, W = WALL_Z;
    switch (name) {
      case 'demo_shot_R': case 'demo_shot_L': {
        const h = name.endsWith('R') ? 'R' : 'L', s = h === 'R' ? 1 : -1;
        const tg = [V(-1.5 * s, 2.6, W), this.dummies[1].position.clone().add(V(0, 1.3, 0)), V(1.9 * s, 0, -6.2)];
        if (h === 'L') tg[1] = this.dummies[0].position.clone().add(V(0, 1.45, 0));
        tg.forEach((p, i) => { at(i * 0.4, () => fig.aimAt(h, p)); at(i * 0.4 + 0.07, () => this.shootAt(h, p)); });
        at(1.12, () => fig.aimAt(h, null, false));
        break;
      }
      case 'demo_rapid': {
        let k = 0;
        for (let i = 0; i < 20; i++) {
          const h = i % 2 ? 'L' : 'R', t = i * 0.11;
          const p = i === 7 ? this.dummies[1].position.clone().add(V(0, 1.2, 0)) : i === 13 ? this.dummies[2].position.clone().add(V(0, 1.1, 0))
            : V(Math.sin(i * 2.39) * 5.5, 1.2 + ((i * 0.618) % 1) * 4.8, W);
          at(t, () => fig.aimAt(h, p)); at(t + 0.07, () => this.shootAt(h, p));
          k++;
        }
        at(2.4, () => { fig.aimAt('L', null, false); fig.aimAt('R', null, false); });
        break;
      }
      case 'demo_swing': case 'demo_snap': {
        fig.reset(V(0, 8.6, 4.2), 0); fig.vel.set(0, -3, -2.2);
        this.physics = 'free';
        at(0, () => fig.aimAt('R', A));
        at(0.07, () => { this.rope = this.fx.line({ from: fig.web.R, to: A.clone(), kind: 'swing' }); this.ropeHand = 'R'; });
        if (name === 'demo_swing') at(2.15, () => { this.rope?.release(); this.rope = null; fig.aimAt('R', null, false); });
        else at(0.95, () => { this.rope?.snap(); this.rope = null; fig.aimAt('R', null, false); });
        break;
      }
      case 'demo_slack': {
        fig.reset(V(1.2, 0, -4.0), 0.35);
        const P = V(-3.4, 4.6, W + 0.02);
        at(0, () => fig.aimAt('R', P));
        at(0.07, () => { this.rope = this.fx.line({ from: fig.web.R, to: P, kind: 'swing' }); this.ropeHand = 'R'; });
        at(0.3, () => { if (this.rope) this.rope.restLength = this.rope.restLength * 1.08; this.state.walk = 1; });
        at(4.1, () => { this.rope?.release(); this.rope = null; fig.aimAt('R', null, false); });
        this.physics = 'walk';
        break;
      }
      case 'demo_zip': {
        fig.reset(V(0, 0, -1), 0);
        const Z = this.zipPoint;
        at(0, () => { fig.aimAt('L', Z); fig.aimAt('R', Z); });
        at(0.07, () => { this.state.zip = this.fx.zip({ fromL: fig.web.L, fromR: fig.web.R, to: Z.clone() }); });
        this.physics = 'zip';
        break;
      }
      case 'demo_pull': {
        fig.reset(V(0, 0, -2), 0);
        const d = this.dummies[1];
        at(0, () => fig.aimAt('R', d.position.clone().add(V(0, 1.2, 0))));
        at(0.07, () => {
          this.fx.pull({ from: fig.web.R, target: d, onYank: ({ dir }) => {
            const to = fig.root.position.clone().add(V(0, 0, -1.4)).sub(d.position);
            const flat = Math.hypot(to.x, to.z), T = 0.55;
            d.userData.vel.set(to.x / T, 4.9 * T + 0.2, to.z / T); d.userData.fly = true; d.userData.flat = flat;
          } });
        });
        at(0.9, () => fig.aimAt('R', null, false));
        break;
      }
      case 'demo_splat_wall': {
        for (let i = 0; i < 16; i++) {
          const h = i % 2 ? 'L' : 'R', t = i * 0.12;
          const p = V(-5.5 + (i % 8) * 1.55 + Math.sin(i * 7.1) * 0.35, 1.3 + Math.floor(i / 8) * 2.2 + Math.cos(i * 3.3) * 0.5, W);
          at(t, () => fig.aimAt(h, p)); at(t + 0.07, () => this.shootAt(h, p));
        }
        at(2.2, () => { fig.aimAt('L', null, false); fig.aimAt('R', null, false); });
        break;
      }
      case 'demo_splat_close': {
        const p = V(0.5, 2.2, W);
        at(0, () => fig.aimAt('R', p)); at(0.07, () => this.shootAt('R', p));
        at(0.5, () => fig.aimAt('R', null, false));
        break;
      }
    }
    ev.sort((a, b) => a[0] - b[0]);
    fig.pose(0);
    this.fx.update(0);
  }

  /** One fixed step (or any dt in real-time play). */
  step(dt) {
    const hs = this.juice?.hitstop || 0;
    if (hs > 0 && this.juice) { this.juice.hitstop = Math.max(0, hs - dt); dt = 0; }
    const t1 = this.t + dt;
    while (this.ei < this.events.length && this.events[this.ei][0] <= t1 + 1e-9) { this.events[this.ei][1](); this.ei++; }
    this.t = t1;
    if (dt > 0) this._physics(dt);
    this.fig.pose(dt);
    this.fx.update(dt);
  }

  _physics(dt) {
    const fig = this.fig, P = fig.root.position, v = fig.vel;
    if (this.physics === 'free') {
      v.y -= 9.8 * dt; P.addScaledVector(v, dt);
      const r = this.rope;
      if (r && r.state === 'attached') {
        // inextensible rope on the wrist: project back onto the sphere, drop outward speed
        fig.root.updateMatrixWorld(true);
        const w = fig.web[this.ropeHand].getWorldPosition(V(0, 0, 0));
        const d = w.clone().sub(r.anchor), dist = d.length(), rest = r.restLength;
        if (dist > rest) { d.multiplyScalar(1 / dist); P.addScaledVector(d, -(dist - rest)); const vr = v.dot(d); if (vr > 0) v.addScaledVector(d, -vr); }
      }
      if (P.y < 0) { P.y = 0; v.y = 0; v.x *= 0.8; v.z *= 0.8; }
      const sp = Math.hypot(v.x, v.z);
      if (sp > 1) fig.yaw += (Math.atan2(-v.x, -v.z) - fig.yaw) * clamp(dt * 3, 0, 1);
    } else if (this.physics === 'walk') {
      // walk back until the line is taut (creak), then forward again (slack)
      const t = this.t;
      // hold (slack, sagging) → walk back until it goes taut (creak) → hold → walk in (slack)
      const w = t < 1.3 ? 0 : t < 2.6 ? 1 : t < 3.0 ? 0 : t < 3.9 ? -1 : 0;
      const dir = V(0.35, 0, 1).normalize();
      P.addScaledVector(dir, w * 1.0 * dt);
      const r = this.rope;
      if (r && r.state === 'attached' && w > 0) {
        fig.root.updateMatrixWorld(true);
        const wp = fig.web.R.getWorldPosition(V(0, 0, 0)), d = wp.distanceTo(r.anchor);
        if (d > r.restLength) P.addScaledVector(dir, -(d - r.restLength));
      }
    } else if (this.physics === 'zip') {
      const z = this.state.zip;
      if (z && z.started && z.state === 'attached') {
        const to = this.zipPoint.clone().sub(P).sub(V(0, 1.5, 0));
        const d = to.length();
        if (d > 1.2) v.copy(to.multiplyScalar(1 / d)).multiplyScalar(Math.min(32, 4 + z.t * 120));
        else v.multiplyScalar(0.8);
        fig.yaw += (Math.atan2(-to.x, -to.z) - fig.yaw) * clamp(dt * 8, 0, 1);
      } else if (z && z.state !== 'flying') v.y -= 9.8 * dt;
      P.addScaledVector(v, dt);
      if (P.y < 0) { P.y = 0; v.set(0, 0, 0); }
    }
    for (const d of this.dummies) {
      const u = d.userData;
      if (!u.fly) continue;
      u.vel.y -= 9.8 * dt; d.position.addScaledVector(u.vel, dt);
      d.rotation.x += dt * 5;
      if (d.position.y <= 0 && u.vel.y < 0) { d.position.y = 0; u.vel.set(0, 0, 0); u.fly = false; d.rotation.x = -Math.PI / 2; d.position.y = 0.27; }
    }
  }

  /** Deterministic: reset and run the demo at 120 Hz up to t. */
  seek(name, t) {
    this.reset(name);
    const n = Math.round(t / H);
    for (let i = 0; i < n; i++) this.step(H);
  }

  dispose() { this.fx.dispose(); this.root.parent?.remove(this.root); }
}
