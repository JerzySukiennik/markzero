// SPIDER-MAN — the controller. A point mass, a rope and the city, tuned towards Marvel's Spider-Man:
//   swing     R2 (held): the web goes UP and AHEAD to a real building point — ray fan first, then the
//             nearest building EDGE/WALL around an ideal anchor (≥ MIN_RISE above the hand, in front);
//             no building = no swing (he dives). A PURE rope constraint (pulls, never pushes, no spring
//             reel); the catch keeps every bit of speed along the arc (with a speed floor), stick
//             forward pumps the arc at the bottom, the drawn line is dead straight while attached.
//             Let go = release boost (bigger on the upswing), ✕ on the line = swing jump.
//   web zip   ✕ in the air (2 per air time, refilled by a web, a wall or the ground): a quick pull
//             forward along the camera / travel direction.
//   zip       L2 (aim) + R2: both wrists to the aimed point (snaps to a roof edge near the top). Arrive
//             on a top = perch; ✕ as you arrive = POINT LAUNCH (a big forward-up launch).
//   tether    R2 with Iron Man inside the aim cone: the rope is anchored to the SUIT and only pulls.
//   wall      touch a wall in the air = stick (glancing contacts slide); crawl CAMERA-RELATIVE (stick up =
//             up on screen, left/right = screen left/right, consistent while the camera orbits);
//             R2 = wall run (runs up with no stick); over the top: crawl = mantle, run = vault launch;
//             ✕ = jump off (away + stick direction). Body parallel to the wall, pivoting about the hips.
//   thwip     R1 / L1: web_shoot_R/L upper-body layer, the glob leaves the wrist at fire_at (0.15 s).
//   camera    auto-follows the travel direction when the right stick is idle; FOV/distance/roll with speed.
// Story: input only via this.act (story swaps in its InputGate); setControl(on), teleport(p, yaw, vel), park(on).
import * as THREE from 'three';
import { Hero, colliderFor, clamp, lerp, damp, LIBS } from './hero.js';
import { blend1D } from './anim.js';
import { ChaseCam, SPIDER_CAM } from './camera.js';
import { SpiderCombat } from './spider/combat.js';
import { SpiderLegs, LEGS_CRAWL } from './spider/legs.js';

const G = 9.81 * 1.25;        // a touch heavier than V2: arcs read snappier on a pad
const DRAG = 0.0018, AIR_STEER = 9, WALK = 2.2, RUN = 7.6, WALK_GEAR = 0.45, GROUND_ACCEL = 34, GROUND_FRICTION = 22, JUMP = 9.4;
const CRAWL = 3.0, WALL_RUN = 12, CRAWL_ACCEL = 30, RUN_ACCEL = 70, SKIN = 0.32, FLIP_OUT = 8, FLIP_UP = 7, FLIP_STICK = 6;
const MAX_HOPS = 2, ZIP_FWD = 21, ZIP_UP = 5;
const TURN = 1.1, RANGE = 140, MIN_RISE = 5, SWING_ELEV = 52 * Math.PI / 180, CATCH_FLOOR = 14, PUMP = 6, V_MAX = 46;
const REEL = 14, MIN_LEN = 3, CLEAR = 2.2, CATCH_TAKEUP = 5, TAKEUP_RATE = 7, TETHER_CONE = Math.cos(14 * Math.PI / 180);
const LOOK = 2.6, STEP = 1 / 120, R = 0.42, BUF_SWING = 0.3, BUF_JUMP = 0.18, PIVOT = 0.55;
// release economy (Jurek: "spamming R2 makes him fly extremely fast"): a line commits to COMMIT s of swing
// after it catches (a tap is a short real swing, never a free boost); the release boost is paid only after a
// REAL swing (through the bottom, let go on the upswing), fades on rapid repeats and above V_BOOST (m/s, flat)
// A TAP (let go < TAP s after the fire) is read as "swing me": the line holds through the bottom into the
// upswing (TAP_ARC rad past the bottom, or TAP_MAX s) — mashing R2 = real swings, never a dive to the street
const V_PUMP = 33, AUTO_REL = 0.72;          // the pump stops feeding the swing above this (m/s): the chain cruises ~28–33 m/s
const COMMIT = 0.22, V_BOOST = 34, BOOST_REARM = [0.35, 1.0], TAP = 0.35, TAP_ARC = 0.5, TAP_MAX = 1.2;
const SPAWN = { pos: new THREE.Vector3(-573, 21.2, 662), yaw: Math.PI * 0.8 };   // Peter's roof
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
// the throw camera's moves (story's △ moves): prop track, when the object leaves his hands, the lens
const CINE = {
  // side / back: where the camera sits off the action axis (him → target), as fractions of the framing distance
  web_yank_throw: { prop: 'prop_obj', from: 0.3, release: 1.78, fov: 58, kind: 'yank', side: 0.72, back: 0.69 },
  // the heave: side-on and low, so the generator held overhead never hides him
  web_heavy_throw: { prop: 'prop_heavy', from: 0.26, release: 1.72, fov: 62, low: true, kind: 'heave', side: 0.96, back: 0.28 },
  rpg_catch_return: { prop: 'prop_rocket', from: 0.0, release: 1.42, fov: 60, kind: 'rocket', side: 0.85, back: 0.52 },
  web_pull: { fov: 55, kind: 'takedown', side: 0.8, back: 0.6 },
};
const curve = v => Math.sign(v) * v * v;
const NO_AXES = { lx: 0, ly: 0, rx: 0, ry: 0 }, NO_INPUT = { axes: NO_AXES, down: () => false, pressed: () => false, released: () => false, value: () => 0, heldMs: () => 0 };

/** An Object3D whose raycast() is the city collider — so WebFX globs splat on real walls. */
export function colliderProxy(col) {
  const o = new THREE.Object3D(); o.name = '__city_collider';
  const h = {};
  o.raycast = (ray, out) => {
    const r = col.raycast(ray.ray.origin, ray.ray.direction, ray.far === Infinity ? 1000 : ray.far, h);
    if (!r || r.t < ray.near) return;
    out.push({ distance: r.t, point: new THREE.Vector3(r.x, r.y, r.z), face: { normal: new THREE.Vector3(r.nx, r.ny, r.nz) }, object: o });
  };
  return o;
}

export class SpiderMan extends Hero {
  async init() {
    const { root, clips, metas } = await this.loadBody();
    this.root = root; this.world.scene.add(root);
    // a real WALK: spider_core only has run/sprint (a slowed run read as arms-out slow motion) → the
    // canonical-1.74 human library's walk drives the same rig
    const human = await this.MZ.assets.load(LIBS.human174).catch(() => null);
    const walk = human?.animations?.find(c => c.name === 'human_walk');
    this.anim = this.makeAnimator(root, walk ? [...clips, walk] : clips, walk ? [...metas, human.clips] : metas);
    // the throw clips' prop tracks (the rig has no prop nodes, so the Animator drops them): the throw camera samples
    // them exactly like story/moves.js places the object
    this.propTracks = {};
    for (const c of clips) for (const tr of c.tracks) if (/^prop_\w+\.position$/.test(tr.name)) (this.propTracks[c.name] ||= {})[tr.name.split('.')[0]] = tr.createInterpolant();
    this.hasWalk = !!walk;
    // the skinned parts (mask, lenses, bracers) keep a culling sphere frozen at their BIND position: in a
    // crawl / hang / flip the head moves ~1.5 m from it and the mask got culled ("the head disappears")
    root.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
    this.installNano(root);
    this.col = await colliderFor(this.world);
    const wf = this.world.webfx;
    if (wf && !wf.raycastTargets.some(o => o.name === '__city_collider')) wf.raycastTargets.push(colliderProxy(this.col));
    const sp = this.spawnOpt || SPAWN;
    this.pos = (sp.pos || SPAWN.pos).clone(); this.vel = new THREE.Vector3();
    this.yaw = sp.yaw ?? SPAWN.yaw; this.camYaw = this.yaw; this.camPitch = -0.15;
    this.grounded = false; this.stuck = false; this.wallN = new THREE.Vector3(); this.wallTop = 0; this.wallFwd = new THREE.Vector3(0, 1, 0);
    this.rope = null; this.hops = MAX_HOPS; this.hand = 'L'; this.zip = null; this.busy = 0; this.landT = 0;
    this.act = this.MZ.actions ? this.MZ.actions('spiderman') : null;
    this.control = true; this.parked = false;
    const node = n => root.getObjectByName(n);
    this.web = { L: node('piv_webL') || node('piv_wristL'), R: node('piv_webR') || node('piv_wristR') };
    this.cam = new ChaseCam(SPIDER_CAM); this.cam.speedShake = 0.8;
    this.aimPoint = new THREE.Vector3(); this.aimScreen = { x: 0.5, y: 0.5, locked: false }; this.aimHit = null;
    this.shots = [];                  // pending thwips {hand, t}
    this.speedNow = 0; this.heading = this.yaw; this.ropeTension = 0;
    this.buf = { swing: 0, jump: 0 }; this.lookIdle = 0; this.stats = { presses: 0, fired: 0, sky: 0, miss: 0 };
    this.root.position.copy(this.pos).y -= 1;
    this.onEvent(e => this.remoteEvent(e));
    this.anim.setBase({ idle: 1 }, 100); this.anim.update(0);
    this.qRoot = new THREE.Quaternion(); this._qp = new THREE.Quaternion();
    this.combat = new SpiderCombat(this);
    this.legs = new SpiderLegs(this);
    // the web arm reaches for the anchor while a line flies (procedural, on top of any clip)
    this.arm = { R: ['piv_shoulderR', 'piv_elbowR', 'piv_wristR'].map(node), L: ['piv_shoulderL', 'piv_elbowL', 'piv_wristL'].map(node), w: 0, side: 'R' };
    if (this.arm.R.every(Boolean) && this.arm.L.every(Boolean)) this.anim.protect([...this.arm.R.slice(0, 2), ...this.arm.L.slice(0, 2)]);
    return this;
  }
  /** health: a hit landing inside a dodge's i-frames does nothing (the story's hurt() writes health directly) */
  get health() { return this._hp ?? 1; }
  set health(v) {
    const hp = this._hp ?? 1;
    if (v < hp) {
      if (this.combat?.invulnerable()) return;
      if (hp - v < 0.5) v = hp - (hp - v) * (this.legs?.block(hp - v, this.combat?.threatPos()) ?? 1);      // the Iron Spider legs guard (legs.js)
    }
    this._hp = v;
  }
  invulnerable() { return !!this.combat?.invulnerable(); }
  onCue(e, clip) {
    if (e.sfx?.startsWith('sp_thwip')) return;          // WebFX plays the thwip with the glob
    super.onCue(e, clip);
  }
  // ---- story hooks (docs/story/STORY-API.md §3; story swaps this.act for its InputGate for scripted input)
  /** mute the pad (cutscenes) / give it back */
  setControl(on) { this.control = !!on; if (!on) this.buf.swing = this.buf.jump = 0; }
  /** place him cleanly: no line, zip, wall or buffered press survives; body and camera snap */
  teleport(p, yaw = this.yaw, vel = null) {
    // a turn on the spot (story's moves face their target this way) is not a cut: the camera keeps easing
    const jump = p.distanceTo(this.pos) > 2.5 || !this.cam?.inited;
    this.rope?.line?.release(); this.rope = null; this.zip?.fx?.release(); this.zip = null; this.zfx?.fx?.release(); this.zfx = null;
    this.stuck = false; this.grounded = false; this.perched = false; this._unstickT = 0; delete this._swingAfterJump;
    this.pos.copy(p); this.vel.set(0, 0, 0); if (vel) this.vel.copy(vel);
    this.yaw = this.heading = yaw; if (jump) { this.camYaw = this.travelHd = this._camHd = yaw; this.camPitch = -0.15; }
    this.buf.swing = this.buf.jump = 0; this.refire = 0;
    this.anim.cancelShot(null, 0.05);
    if (jump) for (const b of this.anim.base.values()) b.w = 0;      // a cut: no fading out of the old place's clip mid-air
    this.qRoot.setFromAxisAngle(UP, yaw); this.root.quaternion.copy(this.qRoot); this.root.position.copy(p).y -= 1; if (jump) this.cam.snap();
  }
  /** hidden and frozen (no input, no physics, no sound) while the civilian walks; park(false) resumes */
  park(on) {
    this.parked = !!on; this.root.visible = !on;
    if (on) { this.teleport(this.pos, this.yaw); for (const n of Object.keys(this.loops)) this.loop(n, null, 0); }
  }
  /** Iron Man players a web can anchor to */
  tetherTargets() {
    const src = this.MZ.game?.players ? [...this.MZ.game.players.values()] : (this.world.labPlayers || []);
    return src.filter(p => p !== this && p.hero === 'ironman' && p.root);
  }
  /** the input this frame: this.act (MZ.actions, or story's InputGate) — never MZ.input directly */
  input() {
    if (!this.control || !this.act) return NO_INPUT;
    return this.act;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, t) {
    if (!this.local) return this.updateRemote(dt, t);
    const a = this.input(), ax = a.axes;
    // edges are never lost: a press during hitstop (dt = 0), a zip or a landing is buffered
    if (a.pressed('swing')) { this.buf.swing = BUF_SWING; this.stats.presses++; }
    if (a.pressed('jump')) this.buf.jump = BUF_JUMP;
    if (this.parked) { this.buf.swing = this.buf.jump = 0; return; }
    this.combat?.buffer(a);
    if (dt <= 0) { this.anim.update(0); return; }
    this._clock = (this._clock || 0) + dt;
    // camera look (free, not the body); idles back behind the travel direction (below)
    this.camYaw -= curve(ax.rx) * LOOK * dt; this.camPitch = clamp(this.camPitch - curve(ax.ry) * LOOK * 0.7 * dt, -1.2, 0.9);
    this.lookIdle = Math.abs(ax.rx) + Math.abs(ax.ry) > 0.15 ? 0 : this.lookIdle + dt;
    const fwd = _v.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw)), right = _v2.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const wish = new THREE.Vector3().addScaledVector(fwd, -ax.ly).addScaledVector(right, ax.lx);
    let mag = Math.min(1, wish.length()); if (mag > 1e-3) wish.divideScalar(Math.max(1, wish.length()));
    this.wish = wish; this.mag = mag;
    this.updateAim();
    const aiming = a.down('aim');
    const swingDown = a.down('swing');
    const reel = (a.down('reel_in') ? 1 : 0) - (a.down('reel_out') ? 1 : 0);
    this.busy = Math.max(0, this.busy - dt); this.landT = Math.max(0, this.landT - dt);
    this.buf.swing = Math.max(0, this.buf.swing - dt); this.buf.jump = Math.max(0, this.buf.jump - dt);
    const wasG = this.grounded, vy0 = this.vel.y;

    // ---- actions
    // R2: a fresh press (buffered) or simply HOLDING it keeps swinging — no press is ever needed twice
    this.refire = Math.max(0, (this.refire || 0) - dt);
    this.swingHeld = swingDown ? (this.swingHeld || 0) + dt : 0;
    const wantSwing = this.buf.swing > 0 && (swingDown || this.buf.swing > BUF_SWING - 0.05);
    if (wantSwing && aiming && !this.stuck) { this.buf.swing = 0; this.startZip(); }
    else if (!this.stuck && !this.zip && !this.rope && !aiming && !this.combat?.atk) {
      if (this.grounded) {
        if (wantSwing || (swingDown && this.swingHeld > 0.2)) { this.buf.swing = 0; this.vel.y = JUMP * 0.8; this.grounded = false; this._swingAfterJump = 0.12; this.anim.oneShot('jump', { from: 0.18, fadeIn: 0.04, fadeOut: 0.2 }); }
      } else if (this._swingAfterJump === undefined && (wantSwing || (swingDown && this.refire <= 0))) {
        const fresh = wantSwing;
        if (this.startSwing(!fresh)) { this.buf.swing = 0; this.stats.fired += fresh ? 1 : 0; }
        else this.refire = 0.1;
      }
    }
    if (this._swingAfterJump !== undefined) { this._swingAfterJump -= dt; if (this._swingAfterJump <= 0) { delete this._swingAfterJump; if (swingDown) this.startSwing(true); } }
    if (this.rope && !this.rope.scripted) {
      // a line that is still flying or caught < COMMIT s ago stays on (the let-go is queued; R2 again cancels it)
      const r = this.rope;
      if (swingDown) r.letGo = false;
      else {
        if (!r.letGo && (this._clock - r.firedAt) < TAP) r.tap = true;
        r.letGo = true;
        if (!(r.flying > 0) && (r.age ?? 0) >= COMMIT && (!r.tap || r.age >= TAP_MAX || this.pendAngle(r, this.pos, this.pivotNow(_v4)) >= TAP_ARC)) this.releaseRope(false);
      }
    }
    if (this.rope) this.refire = 0.2;
    if (this.buf.jump > 0) {
      let used = true;
      if (this.stuck) this.leaveWall(true);
      else if (this.zip?.pulled) used = this.pointLaunch();
      else if (this.rope) { if (this.rope.flying > 0) used = false; else this.releaseRope(true); }   // ✕ on a flying line waits for the catch
      else if (this.grounded) this.doJump();
      else if (this.hops > 0 && !this.zip) this.webZip();
      else used = false;
      if (used) this.buf.jump = 0;
    }
    // L1 + R1 together = web bomb (gadget); otherwise each is a thwip
    const bomb = (a.pressed('web_l') && a.down('web_r')) || (a.pressed('web_r') && a.down('web_l'));
    if (!(bomb && this.combat.webBomb())) for (const [hand, id] of [['R', 'web_r'], ['L', 'web_l']]) if (a.pressed(id)) this.thwip(hand);
    this.serviceThwips(dt);
    // ---- combat (strike / dodge / legs): an attack owns the body — no walking, facing the target
    const attacking = this.combat.update(dt, a);
    if (attacking) { wish.set(0, 0, 0); mag = 0; }

    // ---- physics
    const n = Math.max(1, Math.ceil(dt / STEP)), h = dt / n;
    for (let i = 0; i < n; i++) this.step(h, wish, mag, swingDown, reel, ax);
    if (this.zip) this.serviceZip(dt);
    if (this.zfx && (this.zfx.t -= dt) <= 0) { this.zfx.fx?.release(); this.zfx = null; }
    if (this.grounded || this.stuck) this.hops = MAX_HOPS;
    if (!wasG && this.grounded) this.onLand(-vy0);

    // ---- body transform
    this.pose(dt, wish, mag);
    this.stateMachine(dt, mag);
    this.anim.update(dt);
    this.armReach(dt);
    this.legs?.update(dt);
    this.wallContact(dt);
    this.nano?.update(dt);
    this.effects(dt);
    this.autoCamera(dt);
    this.speedNow = this.vel.length();
    this.aiming = aiming;
  }

  step(h, wish, mag, swingDown, reel, ax) {
    const p = this.pos, v = this.vel;
    if (this.stuck) return this.crawl(h, ax, swingDown);
    // forces
    const acc = _v3.set(0, -G, 0);
    const sp = v.length(); if (sp > 0.01) acc.addScaledVector(v, -DRAG * sp);
    if (!this.grounded && mag > 0.08) this.airSteer(acc, wish, sp);
    if (this.rope && !(this.rope.flying > 0)) this.pump(acc, wish, mag);
    if (!this.grounded) v.addScaledVector(acc, h);
    else { this.walk(h, wish, mag); }
    if (sp > V_MAX) v.multiplyScalar(V_MAX / sp);
    p.addScaledVector(v, h);
    // rope: pulls, never pushes
    if (this.rope) this.ropeConstraint(h, reel);
    // city
    const c = _v.copy(p); c.y += 0.1;
    const before = _v2.copy(c);
    const hit = this.col.sphere(c, R, this._hit || (this._hit = {}));
    if (hit) {
      p.add(before.sub(c).negate());
      const nrm = new THREE.Vector3(hit.nx, hit.ny, hit.nz), into = v.dot(nrm);
      if (Math.abs(hit.ny) < 0.5) {
        // a wall. In the air: stick when coming at it (glancing = slide along); with a line out only
        // head-on (a swing brushing a facade must not end); on the ground only running at it holding R2
        const hn = _v4.set(nrm.x, 0, nrm.z).normalize(), approach = -v.dot(hn), spd = v.length();
        const runAt = this.grounded && swingDown && mag > 0.3 && wish.dot(hn) < -0.5;
        // coming at it (≥ ~20°) or slow = stick; a glancing hit slides along. Holding R2 (no line) turns
        // any contact into a wall RUN that keeps the momentum (Marvel's)
        const stick = this.rope ? approach > 0.55 * Math.max(4, spd) : (approach > 0.34 * spd || spd < 6 || swingDown);
        if (this.grounded && this.legs?.state === 'out' && mag > 0.4 && Math.hypot(v.x, v.z) > 3.5 && wish.dot(hn) < -0.4 && this.legVault(hn)) return;
        const building = !!this.buildings().wallNear(p, R + 0.35, this._bw || (this._bw = {}));   // trees, cars, props: slide, never climb
        if (building && !this._unstickT && ((!this.grounded && stick) || runAt)) { this.attachWall(hn, into, runAt || (swingDown && !this.rope)); return; }
        if (into < 0) v.addScaledVector(nrm, -into);
      } else if (into < 0) v.addScaledVector(nrm, -into);
    }
    // ground / roofs
    const g = this.col.groundAt(p.x, p.z, p.y - 1);
    const skim = this.rope && !(this.rope.flying > 0) && Math.hypot(v.x, v.z) > 10;   // feet brush the street/roof mid-arc: the swing carries on
    // (a jump is not re-grounded on roof-mesh bumps while it is still going up)
    if (p.y - 1 <= g && (v.y <= 0.5 || p.y - 1 < g - 0.08)) { p.y = g + 1; if (v.y < 0) v.y = 0; if (!this.grounded && !skim) { this.grounded = true; if (this.rope) this.releaseRope(false, true); } }
    else if (p.y - 1 > g + 0.25) this.grounded = false;
    if (this._unstickT) { this._unstickT -= h; if (this._unstickT <= 0) this._unstickT = 0; }
  }

  /** Air control STEERS, it does not propel: the part of the stick across the flight turns it; the part along
   * it only helps when slow (a standing jump, a stalled arc). It used to be 9 m/s² of thrust at any speed —
   * with the stick forward every chain ran into V_MAX and the surplus became altitude. */
  airSteer(acc, wish, sp) {
    const v = this.vel, hs = Math.hypot(v.x, v.z), k = AIR_STEER * (this.rope ? 1.1 : 0.8);
    if (hs < 1) { acc.addScaledVector(wish, k); return; }
    const fx = v.x / hs, fz = v.z / hs, along = wish.x * fx + wish.z * fz;
    acc.x += (wish.x - fx * along) * k; acc.z += (wish.z - fz * along) * k;
    const push = along > 0 ? along * clamp((16 - hs) / 8, 0, 1) : along * 0.5;     // pulling back brakes a little
    acc.x += fx * push * k; acc.z += fz * push * k;
  }
  walk(h, wish, mag) {
    const v = this.vel;
    if (this.legs?.brake) { const k = this.legs.brakeDrag(h); v.x *= k; v.z *= k; v.y = Math.min(v.y, 0); return; }
    const want = _v3.set(0, 0, 0);
    if (mag > 0.08) { const gear = mag < WALK_GEAR ? WALK * mag / WALK_GEAR : lerp(WALK, RUN, (mag - WALK_GEAR) / (1 - WALK_GEAR)); want.copy(wish).setY(0).normalize().multiplyScalar(gear); }
    const wl = want.length(), cur = _v4.set(v.x, 0, v.z), fast = cur.length() > wl, dv = want.sub(cur), dl = dv.length();
    // landing out of a swing keeps some run-out, then ordinary ground control
    let s = (mag > 0.08 ? GROUND_ACCEL : GROUND_FRICTION) * h;
    if (this.runOut > 0) { this.runOut -= h; if (fast) s *= 0.15; }    // a landing roll carries the speed on
    if (dl <= s) cur.add(dv); else cur.addScaledVector(dv, s / dl);
    v.x = cur.x; v.z = cur.z; v.y = Math.min(v.y, 0);
  }

  // ---- swing / tether
  /** the physics pivot of the pendulum (swing-plane assist, see ropeConstraint); the drawn web and the
   * body keep pointing at the real building point (anchorNow) */
  pivotNow(out) { return this.rope.pivot ? out.copy(this.rope.pivot) : this.anchorNow(out); }
  anchorNow(out) { const r = this.rope; if (r.node) { r.node.updateWorldMatrix(true, false); return out.copy(r.local).applyMatrix4(r.node.matrixWorld); } return out.copy(r.point); }
  /** "ahead" for anchors and zips: where the stick points (camera-relative), else the camera, bent towards the travel direction */
  ahead(out = new THREE.Vector3()) {
    if (this.mag > 0.3) out.copy(this.wish).setY(0).normalize();
    else out.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const flat = (this._ah ||= new THREE.Vector3()).set(this.vel.x, 0, this.vel.z), fl = flat.length();
    // moving: the travel direction dominates, so looking around with the camera does not bend the chain
    if (fl > 6) out.addScaledVector(flat.divideScalar(fl), this.mag > 0.3 ? 0.8 : 3).normalize();
    return out;
  }
  startSwing(auto = false, opt = {}) {
    const from = this.pos.clone().add(new THREE.Vector3(0, 0.9, 0));
    // Iron Man inside the aim cone wins: the signature co-op move
    const cam = this.world.camera, eye = cam.getWorldPosition(new THREE.Vector3()), aim = cam.getWorldDirection(new THREE.Vector3());
    let best = null, bestDot = TETHER_CONE;
    if (!opt.point) for (const im of this.tetherTargets()) {
      const d = im.root.position.clone().add(new THREE.Vector3(0, 1.1, 0)).sub(eye), L = d.length();
      if (L < 2 || L > RANGE) continue; const dot = aim.dot(d.divideScalar(L)); if (dot > bestDot) { bestDot = dot; best = im; }
    }
    let rope = null;
    if (best) rope = { node: best.root, local: new THREE.Vector3(0, 1.1, 0), target: best, point: new THREE.Vector3() };
    else {
      const hit = opt.point ? { p: opt.point.clone() } : this.findAnchor(from);
      if (hit) rope = { point: hit.p, node: null };
    }
    if (!rope) { if (!auto) { this.haptic('ui_error', 0.4); this.stats.miss++; } this.swingMiss = (this.swingMiss || 0) + 1; return false; }
    this.hand = this.hand === 'R' ? 'L' : 'R';
    const A = this.anchorNow.call({ rope }, new THREE.Vector3());
    rope.firedAt = this._clock || 0;
    rope.L = Math.max(MIN_LEN, A.distanceTo(this.pos)); rope.hand = this.hand; rope.flying = A.distanceTo(from) / 320; rope.catch = true; rope.scripted = !!opt.scripted;
    rope.line = this.world.webfx?.line({ from: this.web[this.hand], to: rope.node ? { object: rope.node, local: rope.local } : rope.point.clone(), kind: 'swing' });
    this.rope = rope;
    this.haptic('web_thwip');
    this.event({ kind: 'web_attach', tether: !!best, target: best?.id });
    if (best) best.onTethered?.(this);
    return true;
  }
  /** Best swing anchor → {p} or null — ONLY a real building point at least MIN_RISE above the hand (no
   * sky anchors, no trees/cars/lamps: Jurek, playtest 3). Candidates: a ray fan up-and-ahead against the
   * buildings, then the closest wall / roof-EDGE point of every nearby building to a few ideal anchor
   * spots; line of sight checked against everything. Scored by closeness to the ideal spot, height,
   * forwardness and whether the arc bottom clears what is under it. No anchor = no swing (he dives). */
  findAnchor(from) {
    const ahead = this.ahead(new THREE.Vector3()), B = this.buildings();
    const cands = [];
    // the ideal anchor: steep when slow, flatter and further ahead when fast, lower high above the roofs
    // (a standing start wants the anchor well AHEAD so the first arc has somewhere to fall)
    const k = clamp(this.vel.length() / 35, 0, 1), gov = this.gov(), riseI = lerp(22, 13, k) * (0.45 + 0.55 * gov) * (1 + 0.3 * this.low()), aheadI = lerp(24, 30, k);
    const ideal = from.clone().addScaledVector(ahead, aheadI).add(new THREE.Vector3(0, riseI, 0)), Lideal = Math.hypot(aheadI, riseI);
    // Scored as the pendulum it will really make: the swing-plane assist slides the pivot into his flight
    // plane, so what counts is how far AHEAD (fwd) and how high (rise) the point is; its sideways offset only
    // costs a little (the drawn web still goes there), and anything level with him or behind is useless.
    const spd = this.vel.length();
    const score = (q, d) => {
      const rise = q.y - from.y; if (rise < MIN_RISE) return -Infinity;
      const hx = q.x - from.x, hz = q.z - from.z, hl = Math.hypot(hx, hz) || 1, fwd = hx * ahead.x + hz * ahead.z, lat = Math.abs(hx * ahead.z - hz * ahead.x);
      if (fwd < 4) return -Infinity;
      const L = Math.hypot(hl, rise); if (L < 7 || L > RANGE) return -Infinity;
      const Lp = Math.hypot(fwd, rise), px = from.x + ahead.x * fwd, pz = from.z + ahead.z * fwd;
      const clear = q.y - Lp - B.groundAt(px, pz, q.y - 2);            // arc bottom (in his plane) vs what is under it
      const ang = Math.atan2(lat, fwd);
      return -Math.abs(fwd - aheadI) * 0.6 - Math.abs(rise - riseI) * 0.5 - Math.max(0, 8 - rise) * 1.5 - lat * 0.3
        - Math.max(0, ang - 0.42) * 18 - Math.max(0, 3 - clear) * 4 - d * 0.1 - Math.max(0, 0.6 * spd - Lp) * 0.8   // fast = a longer line
        - Math.max(0, L - 42) * 1.2;                                                          // but no 60 m lines (slow, floaty arcs)
    };
    // 1. ray fan against the buildings: 3 elevations × 7 yaws
    const hit = this._fanHit || (this._fanHit = {});
    for (const elev of [SWING_ELEV, SWING_ELEV - 0.25, SWING_ELEV + 0.2]) for (let i = 0; i < 7; i++) {
      const side = (i % 2 ? -1 : 1) * Math.floor((i + 1) / 2);
      const dir = ahead.clone().applyAxisAngle(UP, side * 0.36).multiplyScalar(Math.cos(elev)).addScaledVector(UP, Math.sin(elev)).normalize();
      const r = B.raycast(from, dir, RANGE, hit); if (!r || !r.prism) continue;
      const q = new THREE.Vector3(r.x, r.y, r.z).addScaledVector(dir, -0.05);
      const s = score(q, q.distanceTo(ideal) * 0.6); if (s > -Infinity) cands.push({ q, s });
    }
    // 2. building walls / roof edges near the ideal spots (a fan through a gap misses everything)
    if (B.prisms && B._cell) {
      // every building within ~75 m that is tall enough, against a few ideal spots
      const seen = new Set(), tall = [];
      for (let gx = -2; gx <= 2; gx++) for (let gz = -2; gz <= 2; gz++) {
        const cell = B._cell(from.x + gx * 32, from.z + gz * 32); if (!cell) continue;
        for (const k of cell) { if (seen.has(k)) continue; seen.add(k); const p = B.prisms[k]; if (p.y1 >= from.y + MIN_RISE) tall.push(p); }
      }
      for (const [yo, dist, rise] of [[0, aheadI, riseI], [0.55, aheadI * 0.9, riseI * 0.85], [-0.55, aheadI * 0.9, riseI * 0.85], [0, aheadI + 12, riseI * 0.65], [0, 10, riseI + 4], [1.3, 12, riseI], [-1.3, 12, riseI]]) {
        const I = from.clone().addScaledVector(ahead.clone().applyAxisAngle(UP, yo), dist).add(_v4.set(0, rise, 0));
        for (const p of tall) {
          const q = closestOnPrism(p, I, from.y + MIN_RISE); if (!q) continue;
          const d = q.distanceTo(I); if (d > 60) continue;
          const s = score(q, d); if (s > -Infinity) cands.push({ q, s });
        }
      }
    }
    cands.sort((a, b) => b.s - a.s);
    // line of sight against EVERYTHING (a tree or a signal in the way blocks the web; the point it hits
    // instead is only taken if that is a building too)
    // Checked from just above his head, and roof clutter (parapets, bulkheads, HVAC in the mesh collider)
    // within the first 4 m does not count — standing on a roof must not blind every web.
    const hitB = this._losB || (this._losB = {}), eye = (this._eye ||= new THREE.Vector3()).copy(this.pos); eye.y += 1.9;
    for (let i = 0; i < cands.length && i < 10; i++) {
      const c = cands[i], d = _v4.subVectors(c.q, eye), L = d.length(); d.divideScalar(L);
      const rb = B.raycast(eye, d, L + 0.5, hitB);
      if (rb && rb.t < L - 0.8) {                                         // a building wall is in the way: that wall, if it is high enough
        if (rb.y >= from.y + MIN_RISE && rb.t > 7) return { p: new THREE.Vector3(rb.x, rb.y, rb.z) };
        continue;
      }
      _v3.copy(eye).addScaledVector(d, 4);
      const r = L > 5 ? this.col.raycast(_v3, d, L - 4.8, hit) : null;    // trees, signals, props further out block it
      if (!r) return { p: c.q };
    }
    return null;
  }
  /** the climbable, anchorable city: building prisms only (the world collider also has props, trees, cars) */
  buildings() { return this.col.city?.prisms ? this.col.city : this.col; }
  /** highest surface under him and ahead along his travel (roofs below him count, walls above don't) */
  groundAhead() {
    const p = this.pos, v = this.vel, y = p.y - 0.5; let g = this.col.groundAt(p.x, p.z, y);
    for (const t of [0.4, 0.8, 1.3]) g = Math.max(g, this.col.groundAt(p.x + v.x * t, p.z + v.z * t, y));
    return g;
  }
  /** Typical rooftop height around him: the 75th percentile of the BUILDING tops sampled on two rings (25 m,
   * 55 m; streets don't count), eased over time — the old 9-sample median jumped 0 ↔ 140 m in a canyon and
   * made the height governor random. Refreshed every 0.25 s. */
  roofRef() {
    const now = this._rrT ?? -1, p = this.pos;
    if (this._rr !== undefined && this._clock - now < 0.25) return this._rr;
    const hs = [], B = this.buildings();
    for (const r of [25, 55]) for (let a = 0; a < 12; a++) { const h = B.groundAt(p.x + Math.cos(a * 0.524) * r, p.z + Math.sin(a * 0.524) * r, 1e4); if (h > 4) hs.push(h); }
    hs.sort((x, y) => x - y);
    const want = hs.length >= 3 ? hs[Math.floor(hs.length * 0.75)] : (this._rr ?? 20) * 0.9;
    const dt = this._rrT === undefined || this._rrT < 0 ? 1 : clamp(this._clock - now, 0, 1);
    this._rr = this._rr === undefined ? want : this._rr + (want - this._rr) * (1 - Math.exp(-dt * 1.2));
    this._rrT = this._clock; return this._rr;
  }
  /** the altitude a chain should settle at: around the typical roofs (never skimming the street) */
  cruiseAlt() { return clamp(this.roofRef() * 0.7, 18, 60); }
  /** 1 up to the cruise altitude, → 0 when 12 m above it: energy stops turning into altitude */
  gov() { return 1 - clamp((this.pos.y - this.cruiseAlt()) / 12, 0, 1); }
  /** 0 at/above the cruise altitude, → 1 when 20 m below it (and in the lowest 12 m over the ground under him) */
  low() { const g = this.col.groundAt(this.pos.x, this.pos.z, this.pos.y - 0.5); return Math.max(clamp((this.cruiseAlt() - this.pos.y) / 20, 0, 1), clamp((g + 16 - this.pos.y) / 12, 0, 1)); }
  /** Marvel's arc: stick forward feeds speed into the lower half of the pendulum, along the arc */
  pump(acc, wish, mag) {
    const A = this.pivotNow(_v4), d = _v2.subVectors(this.pos, A), L = d.length(); if (L < 1) return;
    d.divideScalar(L);
    if (-d.y < 0.35) return;                                            // only below the anchor
    const v = this.vel, t = _v.copy(v).addScaledVector(d, -v.dot(d)), tl = t.length(); if (tl < 1) return;
    t.divideScalar(tl);
    // the stick feeds the arc; at rest nothing does (it used to push at 35 % with no stick — 'flies automatically')
    const push = mag > 0.2 ? Math.max(0, wish.x * t.x + wish.z * t.z) / Math.max(0.3, Math.hypot(t.x, t.z)) : 0;
    // the pump feeds the arc up to the cruise speed band (V_PUMP), not beyond: speed past it only from height
    acc.addScaledVector(t, PUMP * (0.4 + 0.6 * this.gov()) * clamp(push, 0, 1) * clamp((-d.y - 0.35) / 0.4, 0, 1) * clamp((V_PUMP - tl) / 6, 0, 1));
  }
  ropeConstraint(h, reel) {
    const r = this.rope, p = this.pos, v = this.vel;
    if (r.node && (!r.node.parent || r.target?.disposed)) { this.releaseRope(false); return; }
    if (r.flying > 0) { r.flying -= h; return; }         // the line is still on its way
    if (r.catch && !r.node) {
      // SWING-PLANE ASSIST (Marvel's): the pendulum swings in the vertical plane of his travel direction
      // (r.head). A building point off to the side would whip him round, so the physics pivot starts partly
      // and then slides fully into that plane; the stick turns the plane (that is how you steer the swing)
      const hs = Math.hypot(v.x, v.z);
      r.head = hs > 4 ? new THREE.Vector3(v.x / hs, 0, v.z / hs) : this.ahead(new THREE.Vector3());
      r.pivot = this.anchorNow(new THREE.Vector3());
      this.assistPivot(r, p, this.mag > 0.2 ? 0.5 : 1);
    }
    if (r.pivot && !r.catch) {
      const m = this.mag || 0;
      if (m > 0.2) {
        // steer: the stick carves the swing — the horizontal velocity turns towards it (speed kept) and the
        // swing plane follows it
        const w = this.wish, wl = Math.hypot(w.x, w.z), hs = Math.hypot(v.x, v.z);
        if (wl > 1e-3 && hs > 3) {
          const want = Math.atan2(w.x / wl, w.z / wl), cur = Math.atan2(v.x, v.z), a = cur + clamp(angDiff(cur, want), -TURN * m * h, TURN * m * h);
          v.x = Math.sin(a) * hs; v.z = Math.cos(a) * hs; r.head.set(Math.sin(a), 0, Math.cos(a));
        }
      }
      this.assistPivot(r, p, 1 - Math.exp(-(m > 0.2 ? 12 : 6) * h));
    }
    const A = this.pivotNow(_v3);
    if (r.catch) {
      // the catch: shorten once, keep ALL the speed along the arc (only the outward pull goes), and give a
      // standing/falling start a floor of arc speed in the direction he wants to go — picked up, not stopped
      // A PURE ROPE: length = the distance at the catch. Only if the arc bottom would hit the roof/street under
      // it does the line take up a little (≤ CATCH_TAKEUP m, gently) — never a spring pulling him in.
      r.catch = false; r.L = Math.max(MIN_LEN, Math.min(r.L, A.distanceTo(p)));
      if (!r.node) { const floor = Math.max(this.buildings().groundAt(A.x, A.z, A.y - 2), this.groundAhead()); r.Lt = Math.max(MIN_LEN, r.L - CATCH_TAKEUP, Math.min(r.L, A.y - floor - CLEAR)); }
      const to = _v.subVectors(A, p).normalize(), vr = v.dot(to);
      if (vr < 0) v.addScaledVector(to, -vr);
      const tan = _v2.copy(v).addScaledVector(to, -v.dot(to));
      if (tan.length() < CATCH_FLOOR && (this.mag || 0) > 0.3) {
        // a slow start is picked up into the arc only where the STICK asks (at rest: the momentum he has)
        const want = _v4.copy(this.wish).setY(0).normalize(); want.addScaledVector(to, -want.dot(to));
        if (want.lengthSq() > 1e-3) { want.normalize(); v.addScaledVector(want, (CATCH_FLOOR - Math.max(0, tan.dot(want))) * clamp(this.mag, 0, 1)); }
      }
      this.anim.cancelShot(null, 0.2);                   // a release flip / jump must not play over the hang
      this.hops = MAX_HOPS; r.age = 0; r.thMin = this.pendAngle(r, p, A);   // a CAUGHT line refills the air zips
      this.haptic('web_attach'); this.kick({ shake: 0.06, fov: 2 });
    }
    else { r.age += h; r.thMin = Math.min(r.thMin, this.pendAngle(r, p, A)); }
    if (Math.abs(reel) > 0.05) { r.L = Math.max(MIN_LEN, r.L - reel * REEL * h); r.Lt = undefined; }
    if (r.Lt !== undefined && r.L > r.Lt) r.L = Math.max(r.Lt, r.L - TAKEUP_RATE * h); else r.Lt = undefined;
    const d = _v.subVectors(p, A), dist = d.length();
    // the web never goes slack under him: it takes up (≤ 9 m/s) when he swings in towards the anchor
    if (dist < r.L && !r.node && p.y < A.y - 1) r.L = Math.max(dist, MIN_LEN, r.L - TAKEUP_RATE * h);
    // over the top: past the pivot and climbing steeply, the web lets go (Marvel's) — a held line
    // would drag him round the anchor and back the way he came; holding R2 simply throws the next one
    // (lets go once the arc points him > ~50° up, or once he is above the pivot)
    // Jurek (2026-09-26): "when you HOLD R2 he flies automatically". Held R2 with the stick at rest = ONE web and the
    // momentum he has (a pendulum, slowly losing it) — no automatic let-go + re-fire chain. Only the stick pushing
    // along the swing drives the chain on: then he lets go over the top / at the sweet spot of the upswing.
    const drive = this.driving(r);
    if (drive && r.pivot && v.y > 0 && (p.x - A.x) * r.head.x + (p.z - A.z) * r.head.z > 0.5 && (p.y > A.y + 0.3 || v.y > 1.2 * Math.hypot(v.x, v.z))) { this.releaseRope(false); this.refire = 0.25; return; }
    if (drive && r.pivot && !r.scripted && r.age > 0.35 && r.thMin < -0.08 && v.y > 0 && this.pendAngle(r, p, A) > AUTO_REL) { this.releaseRope(false); this.refire = 0.12; return; }
    if (dist > r.L && dist > 1e-4) {
      d.divideScalar(dist);
      p.copy(A).addScaledVector(d, r.L);
      const va = r.target ? r.target.m?.velocity || _v2.set(0, 0, 0) : _v2.set(0, 0, 0);
      const rel = v.dot(d) - va.dot(d);
      if (rel > 0) { v.addScaledVector(d, -rel); this.ropeTension = Math.min(1, this.ropeTension + rel * 0.05); }
    }
  }
  /** slide the pivot a fraction k of the way into the vertical plane through p along r.head */
  assistPivot(r, p, k) {
    const sx = r.head.z, sz = -r.head.x, lat = (r.pivot.x - p.x) * sx + (r.pivot.z - p.z) * sz;
    r.pivot.x -= sx * lat * k; r.pivot.z -= sz * lat * k;
  }
  /** the stick pushes along the swing (forward on screen, in the swing's direction): it drives the chain on. The story
   * scripts its intro swings with the stick at ~0 and lets go itself, so they are never 'driving'. */
  driving(r) {
    const m = this.mag || 0; if (m < 0.45 || !r?.head) return false;
    return (this.wish.x * r.head.x + this.wish.z * r.head.z) / m > 0.35;
  }
  /** pendulum angle of p about the pivot A in the swing plane: < 0 behind (coming down), 0 = the bottom,
   * > 0 ahead (the upswing), radians */
  pendAngle(r, p, A) {
    const v = this.vel, hs = Math.hypot(v.x, v.z), hx = r.head ? r.head.x : hs > 1 ? v.x / hs : 0, hz = r.head ? r.head.z : hs > 1 ? v.z / hs : 0;
    return Math.atan2((p.x - A.x) * hx + (p.z - A.z) * hz, A.y - p.y);
  }
  /** How good this let-go is, 0..1: a caught line, a real swing (came through the bottom), let go on the
   * upswing (≥ ~25° past the bottom = full), not straight after the previous boost, below V_BOOST. */
  releaseQuality(r) {
    if (!r || r.flying > 0 || r.age === undefined) return 0;
    const A = this.pivotNow(_v4), th = this.pendAngle(r, this.pos, A);
    const kAge = smooth(0.25, 0.6, r.age), kArc = r.thMin < -0.08 ? 1 : 0, kTime = smooth(0.08, 0.45, th) * (this.vel.y > -1 ? 1 : 0.3);
    const kRep = smooth(BOOST_REARM[0], BOOST_REARM[1], (this._clock || 0) - (this._boostT ?? -9));
    const hs = Math.hypot(this.vel.x, this.vel.z), kCap = clamp((V_BOOST - hs) / 6, 0, 1);
    return kAge * kArc * kTime * kRep * kCap;
  }
  /** a release move by quality: the flip always in the mix, the corkscrew and the star for the good ones; never
   * the same one twice in a row */
  releaseTrick(q, sp) {
    const pool = q > 0.7 && sp > 20 ? ['swing_release', 'release_corkscrew', 'release_spread', 'swing_release', 'release_corkscrew'] : ['swing_release', 'release_spread', 'swing_release'];
    let c = pool[Math.floor(Math.random() * pool.length)];
    if (c === this._lastTrick) c = pool.find(x => x !== c) || c;
    if (!this.anim.has(c)) c = 'swing_release';
    this._lastTrick = c;
    this.anim.oneShot(c, { fadeIn: 0.05, fadeOut: 0.3 });
    this.event({ kind: 'trick', clip: c }, false);
  }
  releaseRope(jump, landed = false) {
    const r = this.rope; if (!r) return;
    const q = landed ? 0 : this.releaseQuality(r);
    r.line?.release(); this.rope = null;
    if (landed) return;
    const v = this.vel, sp = v.length(), flat = _v.set(v.x, 0, v.z), fl = flat.length();
    if (fl > 0.1) flat.divideScalar(fl); else this.ahead(flat);
    // height governor: boosts point less upwards the higher he already is above the local roofs
    const gov = Math.max(0.2, this.gov());
    this.lastRelease = { q, t: this._clock || 0, jump };
    if (q > 0.05) this._boostT = this._clock || 0;
    if (jump) {
      // swing jump: up and on, the classic "hold ✕ at the top of the arc" — the full leap only off a real swing
      const caught = smooth(0.08, 0.3, r.age ?? 0);
      v.y = Math.max(v.y, 0) + (3.5 + 5 * Math.max(q, 0.6 * caught)) * gov; v.addScaledVector(flat, 1 + 4 * q);
      this.anim.oneShot('swing_release', { fadeIn: 0.05, fadeOut: 0.3 });
      this.kick({ fov: 2 + 2 * q });
    } else if (sp > 8 && this.pos.y - 1 - this.col.groundAt(this.pos.x, this.pos.z, this.pos.y - 0.5) < 0.7) {
      // let go while the arc skims a roof / the street: a running hop off it, the flow goes on (no boost)
      v.y = Math.max(v.y, 5.5);
      this.anim.oneShot('jump', { from: 0.18, fadeIn: 0.05, fadeOut: 0.25 });
    } else if (sp > 8) {
      // release boost: only for a well-timed let-go after a real swing (quality q), most on the upswing
      const up = clamp(v.y / Math.max(sp, 1), 0, 1);
      v.addScaledVector(flat, q * (2.5 + sp * 0.08 * (0.5 + up)));
      if (v.y > 0) v.y += (2.5 * up * gov + 3.5 * this.low()) * q;   // below the cruise altitude a good release lifts more
      // no automatic trick on a plain let-go (feedback: tricks only on an explicit input — ○ in the air, ✕ swing-jump)
      if (q > 0.6) this.kick({ fov: 2 * q });
    }
    this.haptic('web_release');
    this.event({ kind: 'web_release' }, false);
  }

  // ---- web zip (✕ in the air) and point zip / launch (L2 + R2)
  webZip() {
    this.hops--;
    const dir = this.ahead(new THREE.Vector3()), from = this.pos.clone().add(_v4.set(0, 0.9, 0));
    const ray = dir.clone().multiplyScalar(Math.cos(0.2)).addScaledVector(UP, Math.sin(0.2)).normalize();
    const hit = this.col.raycast(from, ray, 45, this._zh || (this._zh = {}));
    const to = hit ? new THREE.Vector3(hit.x, hit.y, hit.z) : from.clone().addScaledVector(ray, 30);
    // +7 m/s when slow, nothing extra at cruise speed (zips refilled by every caught line must not stack speed)
    const v = this.vel, along = Math.max(0, v.x * dir.x + v.z * dir.z), sp = Math.min(40, Math.max(ZIP_FWD, along + 7 * clamp((V_BOOST - 2 - along) / 10, 0, 1)));
    v.set(dir.x * sp, Math.max(v.y * 0.3, 0) + ZIP_UP, dir.z * sp);
    this.zfx?.fx?.release(); this.zfx = { t: 0.28, fx: this.world.webfx?.zip({ fromL: this.web.L, fromR: this.web.R, to }) };
    this.anim.oneShot('web_zip', { from: 0.2, fadeIn: 0.04, fadeOut: 0.25, speed: 1.3 });
    this.sfx('sp_zip_whoosh', { at: this.root }); this.haptic('web_zip'); this.kick({ fov: 4, shake: 0.06 });
    this.event({ kind: 'web_zip' }, false);
  }
  startZip() {
    if (!this.aimHit || this.aimHit.dist > RANGE || this.aimHit.dist < 4) { this.haptic('ui_error', 0.4); return; }
    if (this.rope) this.releaseRope(false, true);
    const to = this.aimPoint.clone(), n = this.aimHit.n.clone();
    // aimed at a wall close under its top: go to the roof EDGE (a perch point) instead
    let perch = n.y > 0.7;
    const top = this.aimHit.top;
    if (!perch && top !== undefined && top - to.y < 3.5 && top > to.y) { to.y = top; perch = true; to.addScaledVector(n, -0.4); }
    this.zip = { to, n, perch, t: 0, pulled: false, fx: this.world.webfx?.zip({ fromL: this.web.L, fromR: this.web.R, to: to.clone() }) };
    this.anim.oneShot('web_zip', { fadeIn: 0.05, fadeOut: 0.25 });
    this.haptic('web_thwip');
  }
  serviceZip(dt) {
    const z = this.zip; z.t += dt;
    if (!z.pulled && z.t >= 0.26) {                     // the pull at the clip's pull_at
      z.pulled = true;
      const target = z.to.clone(); if (z.perch) target.y += 1.2; else target.addScaledVector(z.n, 0.6);
      const d = target.sub(this.pos), L = d.length();
      this.vel.copy(d.divideScalar(L)).multiplyScalar(Math.min(44, 16 + L * 0.9)); this.vel.y += 2;
      this.grounded = false; this.haptic('web_zip'); this.kick({ fov: 5, shake: 0.12 });
      this.sfx('sp_zip_whoosh', { at: this.root });
    }
    if (!z.pulled) return;
    const dist = this.pos.distanceTo(z.to);
    if (z.perch && dist < 2.2) {                        // arrived on a top: perch there (✕ now = point launch)
      this.pos.copy(z.to); this.pos.y += 1; const g = this.col.groundAt(this.pos.x, this.pos.z, this.pos.y);
      if (g > this.pos.y - 2) this.pos.y = g + 1;
      this.vel.set(0, 0, 0); this.grounded = true; this.landT = 0.25; this.perchT = 0.35; this.perched = true;
      this.anim.oneShot('land', { from: 0.05, fadeIn: 0.03, fadeOut: 0.3, speed: 1.4 });
      z.fx?.release(); this.zip = null; return;
    }
    if (this.stuck || this.grounded || z.t > 2.5 || dist < 1.5) { z.fx?.release(); this.zip = null; }
  }
  /** ✕ at the end of a point zip (or right after perching): a big launch forward and up */
  pointLaunch() {
    const z = this.zip; if (!z) return false;
    const dist = this.pos.distanceTo(z.to), sp = Math.max(this.vel.length(), 1);
    if (dist / sp > 0.4) return false;                   // too early: keep the ✕ buffered
    z.fx?.release(); this.zip = null;
    this.launch();
    return true;
  }
  launch() {
    const f = this.ahead(new THREE.Vector3());
    this.vel.set(f.x * 22, 15, f.z * 22); this.grounded = false; this.perchT = 0; this.perched = false;
    this.anim.oneShot('swing_release', { fadeIn: 0.04, fadeOut: 0.3 });
    this.sfx('sp_jump', { at: this.root }); this.haptic('web_release'); this.kick({ fov: 7, shake: 0.15 });
    this.event({ kind: 'point_launch' }, false);
  }

  // ---- wall
  attachWall(nrm, into, run = false) {
    this.stuck = true; this.grounded = false; this.wallN.copy(nrm).setY(0).normalize();
    if (this.rope) this.releaseRope(false, true);
    if (this.zip) { this.zip.fx?.release(); this.zip = null; }
    this.anim.cancelShot(null, 0.1);                     // a release flip / jump still playing would sink into the wall
    const w = this.buildings().wallNear(this.pos, 1.5); this.wallTop = w ? w.top : this.pos.y + 3;
    if (w) { this.wallN.set(w.nx, 0, w.nz).normalize(); this.pos.set(w.x + this.wallN.x * SKIN, this.pos.y, w.z + this.wallN.z * SKIN); }
    // face the way he was going along the wall (up if he came straight at it)
    const along = this.vel.clone().addScaledVector(this.wallN, -this.vel.dot(this.wallN)), al = along.length();
    this.wallFwd.copy(run || al < 3 ? UP : along.clone().divideScalar(al));
    if (run) {                                            // keep the speed along the wall, biased up, at least a run
      if (al > 3) this.vel.copy(along).addScaledVector(UP, al * 0.35).normalize().multiplyScalar(clamp(al, WALL_RUN, WALL_RUN * 1.6));
      else this.vel.copy(UP).multiplyScalar(WALL_RUN * 0.8);
      this.wallFwd.copy(this.vel).normalize();
    }
    else this.vel.copy(along).multiplyScalar(al > 0.01 ? Math.min(3, al * 0.25) / al : 0);     // a little slide along, no bounce
    this.sfx('sp_wall_grip', { at: this.root }); this.haptic('land_soft', clamp(-into / 20, 0.3, 1));
    this.event({ kind: 'wall' }, false);
  }
  /** Stick → a direction on the wall, relative to the CAMERA: stick up = up on screen (or along the
   * wall away from the camera when it looks along the wall), left/right = screen left/right. The two
   * axes are always an orthonormal pair on the wall plane, so the mapping stays continuous while the
   * camera orbits. */
  wallDir(lx, ly, out) {
    const n = this.wallN, q = this.world.camera.quaternion, m = Math.min(1, Math.hypot(lx, ly));
    if (m < 0.08) return out.set(0, 0, 0);
    const cr = _v.set(1, 0, 0).applyQuaternion(q), cu = _v2.set(0, 1, 0).applyQuaternion(q);
    const Wh = _v4.crossVectors(UP, n).normalize();                 // along the wall, screen-right when facing it
    // exact: the wall direction whose screen image is the stick direction (2×2 solve on the wall basis)
    const m00 = Wh.dot(cr), m01 = UP.dot(cr), m10 = Wh.dot(cu), m11 = UP.dot(cu), det = m00 * m11 - m01 * m10;
    const sx = lx, sy = -ly;
    const ex = det !== 0 ? (m11 * sx - m01 * sy) / det : 0, ey = det !== 0 ? (-m10 * sx + m00 * sy) / det : 0;
    const exact = _v3.copy(Wh).multiplyScalar(ex).addScaledVector(UP, ey);
    const w = clamp((Math.abs(det) - 0.12) / 0.2, 0, 1);
    if (w < 1) {
      // looking ALONG the wall there is no screen-right on it: up = up + away from the camera, right ⟂ that
      const fb = (this._wfb ||= new THREE.Vector3()).set(0, 0, -1).applyQuaternion(q).setY(0).add(cu);
      fb.addScaledVector(n, -fb.dot(n)); if (fb.lengthSq() < 1e-4) fb.copy(UP); fb.normalize();
      const fr = (this._wfr ||= new THREE.Vector3()).crossVectors(fb, n).normalize();
      const f = fr.multiplyScalar(sx).addScaledVector(fb, sy);
      if (exact.lengthSq() > 1e-6) exact.normalize().multiplyScalar(m);
      exact.multiplyScalar(w).addScaledVector(f, 1 - w);
    }
    const l = exact.length(); return l > 1e-6 ? out.copy(exact).multiplyScalar(m / l) : out.set(0, 0, 0);
  }
  crawl(h, ax, run) {
    const n = this.wallN;
    const want = this.wallDir(ax.lx, ax.ly, this._ww || (this._ww = new THREE.Vector3()));
    let m = want.length();
    if (run && m < 0.2) { if (this.vel.lengthSq() > 9) want.copy(this.vel).normalize(); else want.copy(UP); m = 1; }   // R2 alone: keep running the way he goes (up from a stand)
    want.multiplyScalar(run ? WALL_RUN : CRAWL * (this.legs?.state === 'out' ? LEGS_CRAWL : 1));
    const dv = _v3.copy(want).sub(this.vel), dl = dv.length(), s = (run ? RUN_ACCEL : CRAWL_ACCEL) * h;
    if (dl <= s) this.vel.add(dv); else this.vel.addScaledVector(dv, s / dl);
    this.pos.addScaledVector(this.vel, h);
    if (this.vel.lengthSq() > 0.2) this.wallFwd.copy(this.vel).normalize();
    // over the top: nothing to hold 0.9 m higher and a roof behind the edge → mantle / vault
    if (this.vel.y > 0.5) {
      const above = this.buildings().wallNear(_v4.set(this.pos.x, this.pos.y + 0.9, this.pos.z), 1.0, this._wa || (this._wa = {}));
      if (!above || above.nx * n.x + above.nz * n.z < 0.5) {
        const rx = this.pos.x - n.x * 0.9, rz = this.pos.z - n.z * 0.9, roof = this.col.groundAt(rx, rz, this.pos.y + 2.5);
        if (roof > this.pos.y - 2) { this.mantle(roof); return; }
      }
    }
    const w = this.buildings().wallNear(this.pos, 1.2, this._wn || (this._wn = {}));
    if (!w) { this.leaveWall(false); return; }
    // follow the face (smoothly round corners; a normal that is not a wall is ignored)
    const nn = _v4.set(w.nx, 0, w.nz); if (nn.lengthSq() < 0.25) { this.leaveWall(false); return; }
    nn.normalize(); this.wallN.lerp(nn, nn.dot(this.wallN) > 0.95 ? 1 : 0.35).normalize(); this.wallTop = w.top;
    const dPlane = (this.pos.x - w.x) * nn.x + (this.pos.z - w.z) * nn.z;
    this.pos.x += nn.x * (SKIN - dPlane); this.pos.z += nn.z * (SKIN - dPlane);
    const g = this.col.groundAt(this.pos.x, this.pos.z, this.pos.y - 1);
    if (this.pos.y - 1 < g && this.vel.y < 0) { this.stuck = false; this.pos.y = g + 1; this.grounded = true; this.vel.set(0, 0, 0); }
  }
  /** LEG VAULT (Iron Spider legs out): running into something low (a car, a crate, a low wall: its top 0.5–2.4 m
   * over his feet) — the upper claws plant on its top and fling him over it, the run carried on */
  legVault(hn) {
    const p = this.pos, nx = hn.x, nz = hn.z;                 // (hn is a shared scratch vector: copy it)
    const fx = p.x - nx * (R + 0.45), fz = p.z - nz * (R + 0.45), top = this.col.groundAt(fx, fz, p.y + 1.5, 0.05);
    const rise = top - (p.y - 1);
    if (!(rise > 0.5 && rise < 2.4)) return false;
    if (!this.legs.vault(new THREE.Vector3(fx, top, fz))) return false;
    const hs = Math.max(7, Math.hypot(this.vel.x, this.vel.z));
    this.vel.set(-nx * hs, Math.sqrt(2 * G * (rise + 0.9)), -nz * hs); this.grounded = false;
    this.anim.oneShot('jump', { from: 0.16, fadeIn: 0.04, fadeOut: 0.25, speed: 1.2 });
    this.haptic('web_release', 0.7);
    this.event({ kind: 'leg_vault', rise: +rise.toFixed(2) }, false);
    return true;
  }
  mantle(roof) {
    const fast = this.vel.length() > CRAWL + 1.5, n = this.wallN.clone();
    this.stuck = false; this.grounded = false;
    if (fast) {                                           // off the top at wall-run speed: vault into the air
      this.pos.y = Math.max(this.pos.y, roof + 0.6); this.pos.addScaledVector(n, -0.4);
      this.vel.set(-n.x * 6, 9.5, -n.z * 6); this._unstickT = 0.3;
      // a spring up off the top, no flip (feedback: rotations/tricks only on an explicit input)
      this.anim.oneShot('jump', { from: 0.16, fadeIn: 0.04, fadeOut: 0.3 }); this.kick({ fov: 4 });
    } else {
      this.pos.addScaledVector(n, -1.1); this.pos.y = roof + 1.2;
      this.vel.set(-n.x * 3, 3, -n.z * 3);
      this.anim.oneShot('jump', { from: 0.2, fadeIn: 0.05, fadeOut: 0.2 });
    }
    this.sfx('sp_jump', { at: this.root });
  }
  leaveWall(jump) {
    this.stuck = false; this._unstickT = 0.35;
    if (jump) {
      // away from the wall, plus wherever the stick points (camera-relative, flattened)
      const a = this.input().axes, fwd = _v.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw)), right = _v2.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      const st = _v3.set(0, 0, 0).addScaledVector(fwd, -a.ly).addScaledVector(right, a.lx); st.addScaledVector(this.wallN, -Math.min(0, st.dot(this.wallN)));
      this.vel.copy(this.wallN).multiplyScalar(FLIP_OUT).addScaledVector(UP, FLIP_UP).addScaledVector(st, FLIP_STICK);
      this.anim.oneShot('dodge_flip', { from: 0.12, fadeIn: 0.04, fadeOut: 0.25 }); this.sfx('sp_jump', { at: this.root }); this.haptic('web_release');
    }
    this.pos.addScaledVector(this.wallN, 0.15);
  }

  // ---- ground moves
  doJump() {
    if (this.perchT > 0 || this.perched) { this.launch(); return; }       // ✕ right as he lands on the point / from a perch
    this.vel.y = JUMP; this.grounded = false;
    this.anim.oneShot('jump', { from: 0.13, fadeIn: 0.04, fadeOut: 0.25 });
    this.sfx('sp_jump', { at: this.root });
  }
  onLand(vFall) {
    if (vFall < 3) return;
    const hard = vFall > 11, hs = Math.hypot(this.vel.x, this.vel.z);
    // the Iron Spider legs out: a hard or fast landing = they slam into the ground ahead and skid him to a stop
    if (this.legs?.onLand(vFall, hs)) {
      this.anim.oneShot('land', { fadeIn: 0.03, fadeOut: 0.3 }); this.landT = 0.35; this.runOut = 0;
      this.MZ.haptics && this.local && this.MZ.haptics.land(vFall);
      this.event({ kind: 'land', speed: vFall, legs: true });
      return;
    }
    // the three-point landing only when he actually comes down to a stop; landing on the run just runs on —
    // fast, it's a forward ROLL that keeps the momentum (run-out: ground friction eased for a moment)
    if (hard && hs < 3.5 && (this.mag || 0) < 0.3) { this.anim.oneShot('land', { fadeIn: 0.03, fadeOut: 0.3 }); this.landT = 0.45; }
    else if (hs > 9 && vFall > 4 && this.anim.has('land_roll')) { this.anim.oneShot('land_roll', { fadeIn: 0.04, fadeOut: 0.2, speed: clamp(hs / 14, 0.9, 1.4) }); this.runOut = 0.7; }
    if (hard) { this.kick({ shake: clamp(vFall / 45, 0.1, 0.5), hitstop: vFall > 20 ? 50 : 0, fov: -2 }); this.cam.punch(0, -0.2, 0); }
    else this.sfx('sp_land_light', { at: this.root });
    this.MZ.haptics && this.local && this.MZ.haptics.land(vFall);
    this.event({ kind: 'land', speed: vFall });
  }

  // ---- web shots
  updateAim() {
    const cam = this.world.camera, o = cam.getWorldPosition(_v), d = cam.getWorldDirection(_v2);
    const hit = this.col.raycast(o, d, 400, this._aimHit || (this._aimHit = {}));
    if (hit && hit.t > 3) { this.aimPoint.set(hit.x, hit.y, hit.z); this.aimHit = { n: new THREE.Vector3(hit.nx, hit.ny, hit.nz), dist: hit.t - o.distanceTo(this.pos), top: hit.prism?.y1 }; }
    else { this.aimPoint.copy(o).addScaledVector(d, 400); this.aimHit = null; }
  }
  thwip(hand) {
    this.anim.layer(hand === 'R' ? 'web_shoot_R' : 'web_shoot_L', 1, { restart: true, rate: 30 });
    this.shots.push({ hand, t: 0.15 });
  }
  serviceThwips(dt) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]; s.t -= dt; if (s.t > 0) continue;
      this.shots.splice(i, 1);
      const from = this.web[s.hand]?.getWorldPosition(new THREE.Vector3()); if (!from) continue;
      // aim assist: a foe within ~9° of the aim ray (from the camera) gets the web
      const foe = this.aimFoe(); if (foe) this.aimPoint.copy(foe);
      const dir = this.aimPoint.clone().sub(from).normalize();
      this.world.webfx?.shoot({ from, dir, speed: 80, hand: s.hand });
      this.haptic('web_thwip'); this.kick({ shake: 0.03 });
      this.event({ kind: 'shot', hand: s.hand, web: true, to: this.aimPoint.toArray().map(v => +v.toFixed(1)) });
    }
  }

  /** the chest of the foe nearest the aim ray (≤ ~9°, ≤ 45 m), or null */
  aimFoe() {
    const cam = this.world.camera, o = cam.getWorldPosition(_v3), d = cam.getWorldDirection(_v4); let best = null, bc = Math.cos(9 * Math.PI / 180);
    for (const en of this.combat?.foes() || []) {
      const c = this.combat.chest(en), to = c.clone().sub(o), L = to.length(); if (L > 45 + 8) continue;
      const cos = to.dot(d) / L; if (cos > bc) { bc = cos; best = c; }
    }
    return best;
  }

  // ------------------------------------------------------------------ body + animation
  pose(dt, wish, mag) {
    const r = this.root, v = this.vel;
    const hs = Math.hypot(v.x, v.z), rootT = _v3;
    let rate = 14;
    if (this.stuck) {
      // wall clips are authored on the floor: +Y = the wall normal, −Z = up the wall (or where he crawls).
      // Root ON the wall plane: the clips put hands/feet at ~0 and the torso parallel ~0.35–0.45 m out.
      const n = this.wallN, fw = this.wallFwd.clone().addScaledVector(n, -this.wallFwd.dot(n));
      if (fw.lengthSq() < 1e-3) fw.copy(UP); fw.normalize();
      const x = new THREE.Vector3().crossVectors(n, fw.clone().negate()).normalize();   // x = y × z, z = −fw
      _m.makeBasis(x, n, fw.clone().negate()); _q.setFromRotationMatrix(_m);
      rootT.copy(this.pos).addScaledVector(n, -SKIN);
      this.yaw = Math.atan2(n.x, n.z) + Math.PI; rate = 18;
    } else if (this.rope && !(this.rope.flying > 0)) {
      // hang along the rope, facing the direction of travel
      const A = this.anchorNow(_v4), up = _v.subVectors(A, this.pos).normalize();
      // face the swing's own direction (r.head) — swinging BACK on a held line he keeps facing forward and the
      // arc plays in reverse, instead of turning round at each end; a tether (no plane) faces the velocity
      const hd = this.rope.head, f = hd ? hd.clone() : v.clone().addScaledVector(up, -v.dot(up));
      if (!hd && f.lengthSq() < 0.5) f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      f.addScaledVector(up, -f.dot(up)).normalize();
      const x = new THREE.Vector3().crossVectors(up, f.clone().negate()).normalize();
      _m.makeBasis(x, up, f.clone().negate()); _q.setFromRotationMatrix(_m);
      rootT.copy(this.pos).addScaledVector(up, -1.0); rate = 10;
      if (hd) this.yaw = Math.atan2(-hd.x, -hd.z); else if (hs > 1) this.yaw = Math.atan2(-v.x, -v.z);
    } else {
      const fy = this.combat?.faceYaw;
      if (fy != null) this.yaw = angDamp(this.yaw, fy, 22, dt);                 // fighting: face the target / hold the dodge
      else if (this.perched && this.perchYaw != null) this.yaw = angDamp(this.yaw, this.perchYaw, 4, dt);   // perched: face the drop
      else if (this.grounded && mag > 0.1 && hs > 0.3) this.yaw = angDamp(this.yaw, Math.atan2(-v.x, -v.z), 12, dt);
      else if (!this.grounded && hs > 2) this.yaw = angDamp(this.yaw, Math.atan2(-v.x, -v.z), 5, dt);
      _q.setFromAxisAngle(UP, this.yaw);
      rootT.copy(this.pos); rootT.y -= 1;
      if (!this.grounded && fy == null) {
        // in the air the body leans along the flight: a dive goes head-first down the velocity (air_dive is
        // authored upright), a fast flat flight leans into it a little, a rise leans back a touch
        const a = this.airW || { dive: 0, rise: 0 }, down = Math.atan2(-v.y, Math.max(hs, 0.1));   // + = below the horizon
        const pitch = a.dive * (Math.PI / 2 + clamp(down, 0, 1.4)) + (1 - a.dive) * (clamp(hs / 30, 0, 1) * 0.3 - a.rise * 0.12);
        this._pitch = damp(this._pitch || 0, pitch, 6, dt);
        if (Math.abs(this._pitch) > 1e-3) {
          _q.multiply(this._qp.setFromAxisAngle(_v4.set(1, 0, 0), -this._pitch));
          rootT.copy(this.pos).sub(_v4.set(0, 1, 0).applyQuaternion(_q));      // about the body centre, not the feet
        }
      } else this._pitch = 0;
    }
    // rotate about the HIPS (PIVOT up the body), not the feet: a turn onto / off a wall never swings half
    // the body through the facade while the orientation eases in
    const pivot = _v.set(0, PIVOT, 0).applyQuaternion(_q).add(rootT);
    this.qRoot.slerp(_q, 1 - Math.exp(-dt * rate));
    r.quaternion.copy(this.qRoot);
    r.position.copy(pivot).sub(_v2.set(0, PIVOT, 0).applyQuaternion(this.qRoot));
    this.heading = this.yaw;
  }
  stateMachine(dt, mag) {
    const A = this.anim, v = this.vel, hs = Math.hypot(v.x, v.z);
    if (this.stuck) {
      const sp = v.length(), run = sp > CRAWL + 1;
      if (sp < 0.3) A.setBase({ wall_cling: 1 }, 8);
      else if (run) {
        // wall_run (4.4 m stride, 10 m/s) ↔ wall_run_fast (4.8 m, 12 m/s) by speed, one shared distance phase
        const kf = A.has('wall_run_fast') ? clamp((sp - 9.5) / 2, 0, 1) : 0;
        A.setBase(kf > 0 ? { wall_run: 1 - kf, wall_run_fast: kf } : { wall_run: 1 }, 10);
        this.phWR = (this.phWR || 0) + lerp(this.cycles('wall_run', sp, 4.4, 3.5), this.cycles('wall_run_fast', sp, 4.8, 3.5), kf) * dt;
        A.setPhase('wall_run', this.phWR); if (kf > 0) A.setPhase('wall_run_fast', this.phWR);
      }
      // wall_crawl: playback rate = speed / 0.36 (clips.json) over its 1.1 s → cycles/s = speed / 0.396
      else { A.setBase({ wall_crawl: 1 }, 10); this.phWC = (this.phWC || 0) + this.cycles('wall_crawl', sp, 1.3, 3.5) * dt; A.setPhase('wall_crawl', this.phWC); }
      return;
    }
    if (this.rope && !(this.rope.flying > 0)) {
      const clip = this.rope.hand === 'L' ? 'swing_L' : 'swing';
      A.setBase({ [clip]: 1 }, 12);
      // phase from the pendulum angle: 0 back-top, 0.48 bottom, 1.3 front-top (of 1.6 s)
      const Ap = this.pivotNow(_v3), d = _v.subVectors(this.pos, Ap), hd = this.rope.head, f = hd ? _v2.copy(hd) : _v2.set(v.x, 0, v.z);
      const fl = f.length(); if (fl > 0.5) f.divideScalar(fl); else f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const th = Math.atan2(d.dot(f), -d.y), m = 1.2, k = clamp(th / m, -1, 1);
      const want = k < 0 ? 0.48 * (k + 1) : 0.48 + 0.82 * k;
      // a NEW line starts its arc where the body is — the old one's phase must never sweep there (it rewound the whole
      // swing, catch ← tuck ← kick, in ~0.2 s at every new line: Jurek's "flips during swinging")
      if (this._swRope !== this.rope) { this._swRope = this.rope; this.swPh = want; }
      this.swPh = this.swPh === undefined ? want : damp(this.swPh, want, 10, dt);
      A.setPhase(clip, this.swPh / 1.6);
      return;
    }
    if (this.grounded) {
      this.perchT = Math.max(0, (this.perchT || 0) - dt);
      if (hs > 0.6 || mag > 0.3) { this.perched = false; this.perchYaw = null; }
      // PERCH (Marvel's): standing still at a roof edge for a moment, he settles into the gargoyle crouch facing the
      // drop; a point zip onto a top perches the same way
      if (this._hopPerch) { this._hopPerch = false; if (mag < 0.1) { this.perched = true; this.vel.set(0, 0, 0); } }   // landed on the parapet
      this.edgeT = hs < 0.3 && mag < 0.1 && !this.combat?.fighting && !A.shotPlaying('land') ? (this.edgeT || 0) + dt : 0;
      if (this.edgeT > 1.2 && !this.perched) {
        const e = this.edgeDir();
        if (e?.lip && e.lip.y > this.pos.y - 1 + 0.25) {
          // a parapet between him and the drop: hop up onto its top (then the perch comes right after the landing)
          const to = _v.set(e.lip.x - this.pos.x, 0, e.lip.z - this.pos.z), up = e.lip.y + 1 - this.pos.y;
          this.vel.set(to.x * 2.2, Math.sqrt(2 * G * (up + 0.35)), to.z * 2.2); this.grounded = false; this._hopPerch = true;
          this.anim.oneShot('jump', { from: 0.16, fadeIn: 0.05, fadeOut: 0.2 }); this.perchYaw = Math.atan2(-e.dir.x, -e.dir.z);
        } else if (e) { this.perched = true; this.perchYaw = Math.atan2(-e.dir.x, -e.dir.z); }
      }
      // stick pushed during a landing pose: blend straight into locomotion
      if (mag > 0.3 && A.shotPlaying('land') && this.landT < 0.3) { A.cancelShot('land', 0.15); this.landT = 0; }
      const loco = this.hasWalk ? [[0.15, 'idle'], [1.0, 'human_walk'], [2.2, 'human_walk'], [3.6, 'run'], [5.0, 'run'], [7.0, 'sprint']] : [[0.15, 'idle'], [1.2, 'run'], [5.0, 'run'], [7.0, 'sprint']];
      A.setBase(this.perched ? { [A.has('perch') ? 'perch' : 'idle_crouch']: 1 } : blend1D(loco, hs), this.perched ? 5 : 10);
      this.phR = (this.phR || 0) + hs * dt / 1.9; this.phS = (this.phS || 0) + hs * dt / 2.5; this.phW = (this.phW || 0) + hs * dt / 1.45;
      if (this.hasWalk) A.setPhase('human_walk', this.phW);
      A.setPhase('run', this.phR); A.setPhase('sprint', this.phS);
      return;
    }
    this.perched = false; this.perchT = 0;
    if (this._hopPerch && this.vel.y < -6) this._hopPerch = false;       // fell off instead of landing on the lip
    // AIRBORNE: rise ↔ spread (fall) ↔ dive by the vertical speed — never an upright stand in the air
    // (Jurek: "the idle randomly plays mid-swing" = the old upright fall pose between two swings)
    const sp = v.length(), vy = v.y;
    let dive = clamp((-vy - 8) / 9, 0, 1) * clamp((-vy / Math.max(sp, 1) - 0.3) / 0.3, 0, 1);
    // the flare: in the last ~0.45 s before the ground he rights himself, feet first for the landing (roll)
    if (dive > 0 && vy < -2) { const tImp = (this.pos.y - 1 - this.groundAhead()) / -vy; dive *= clamp((tImp - 0.15) / 0.3, 0, 1); }
    const rise = clamp((vy - 1) / 5, 0, 1) * (1 - dive);
    this.airW = { dive: damp(this.airW?.dive || 0, dive, 5, dt), rise };
    const w = { fall: Math.max(0, 1 - rise - dive) };
    if (A.has('air_rise')) w.air_rise = rise; else w.fall += rise;
    if (A.has('air_dive')) w.air_dive = dive; else w.fall += dive;
    A.setBase(w, 6);
  }
  /** THE THWIP REACH: while a swing line is in flight (and just after it catches) the web arm straightens and
   * points at the anchor — every line visibly leaves an outstretched hand (Marvel's), then the swing clip (arm
   * up the rope) takes over. Procedural, weight-blended, after the mixer (the joints are protected). */
  armReach(dt) {
    const r = this.rope, A = this.arm; if (!A?.R[0]) return;
    const want = r && !r.node && (r.flying > 0 || (r.age ?? 0) < 0.1) ? 1 : 0;
    if (r) A.side = r.hand;
    A.w = damp(A.w, want, want ? 28 : 9, dt);
    if (A.w < 0.02) return;
    const [sh, el, wr] = A[A.side], anchor = r ? this.anchorNow(_v3) : A.last;
    if (!anchor) return; A.last = (A.last || new THREE.Vector3()).copy(anchor);
    this.root.updateMatrixWorld(true);
    el.quaternion.slerp(_q.identity(), A.w * 0.85);                       // straighten the elbow (rest = straight)
    el.updateMatrixWorld(true);
    const S = sh.getWorldPosition(_v), W = wr.getWorldPosition(_v2), d0 = W.sub(S).normalize(), d1 = _v4.copy(A.last).sub(S).normalize();
    const qW = (this._qa ||= new THREE.Quaternion()).setFromUnitVectors(d0, d1);
    const pw = sh.parent.getWorldQuaternion(this._qb ||= new THREE.Quaternion()), sw = sh.getWorldQuaternion(this._qc ||= new THREE.Quaternion());
    const target = qW.multiply(sw); target.premultiply(pw.invert());
    sh.quaternion.slerp(target, A.w);
  }
  /** an EDGE near his feet: a drop (> 3 m) within 1.8 m, possibly behind a parapet lip (0.25–1.6 m high) — nearest
   * to where he faces → {dir, lip: {x, y, z} | null}, or null */
  edgeDir() {
    const p = this.pos, g0 = this.col.groundAt(p.x, p.z, p.y - 0.5); let best = null, bd = -2;
    const f = _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, dx = Math.sin(a), dz = Math.cos(a);
      let lip = null, drop = false;
      for (const r of [0.45, 0.7, 0.95, 1.2, 1.5, 1.8]) {
        const x = p.x + dx * r, z = p.z + dz * r, g = this.col.groundAt(x, z, g0 + 2);
        if (g < g0 - 3 && (!lip || g < lip.y - 3)) { drop = true; break; }
        if (g > g0 + 0.25 && g < g0 + 1.6) { if (!lip || g > lip.y) lip = { x, y: g, z }; }
        else if (g > g0 + 1.6) break;                                   // a wall, not an edge
      }
      if (!drop) continue;
      const d = dx * f.x + dz * f.z; if (d > bd) { bd = d; best = { dir: new THREE.Vector3(dx, 0, dz), lip }; }
    }
    return best;
  }
  /** Gait cycles per second for a distance-driven loop: speed / stride (stride_m from clips.json, metres per
   * cycle — the feet stay planted), capped at maxHz as a safety net for a clip with a wrong stride. */
  cycles(clip, speed, strideFallback, maxHz) {
    const m = this.anim.meta?.[clip], stride = m?.stride_m || (m?.speed_mps && m?.duration ? m.speed_mps * m.duration : strideFallback);
    return Math.min(speed / stride, maxHz);
  }
  /** Wall offset from the CONTACTS: after the clip is applied, slide the root along the wall normal so the
   * two lowest of hands/feet sit on the facade — never sunk in, never floating, whatever the clip's pelvis. */
  wallContact(dt) {
    const J = this._cj || (this._cj = ['piv_wristL', 'piv_wristR', 'piv_toeL', 'piv_toeR'].map(n => this.root.getObjectByName(n)).filter(Boolean));
    if (!this.stuck || J.length < 2) { this._wo = 0; return; }
    this.root.updateMatrixWorld(true);
    const n = this.wallN, o = this.root.position, ys = J.map(j => { j.getWorldPosition(_v4); return (_v4.x - o.x) * n.x + (_v4.y - o.y) * n.y + (_v4.z - o.z) * n.z; }).sort((a, b) => a - b);
    // the re-authored clips already sit right (pelvis 0.18–0.22 m): only a small trim; on a run just the one
    // planted foot counts (the other is in the air)
    const running = this.vel.length() > CRAWL + 1, c = running ? ys[0] : (ys[0] + ys[1]) / 2;
    const want = clamp(-c, -0.08, 0.08);
    this._wo = damp(this._wo || 0, want, 12, dt);
    this.root.position.addScaledVector(n, this._wo);
  }
  effects(dt) {
    const sp = this.vel.length();
    // THE DRAWN LINE IS DEAD STRAIGHT WHILE ATTACHED (Marvel's): rest = the wrist→anchor distance, a hair
    // short, so WebLine lays it straight every frame. Only a line that is really slack (he flew up past
    // the anchor, > 1.5 m of slack) is allowed to sag.
    const r = this.rope;
    if (r?.line && r.line.state === 'attached') {
      const A = this.anchorNow(_v3), hand = this.web[r.hand]?.getWorldPosition(_v) || this.pos;
      const slack = r.flying > 0 ? 0 : Math.max(0, r.L - A.distanceTo(this.pos));
      r.line.restLength = Math.max(0.3, hand.distanceTo(A) * (slack < 1.5 ? 0.985 : 1) + (slack < 1.5 ? 0 : slack));
      this.ropeTension = Math.max(this.ropeTension, slack < 0.05 ? 0.6 : 0.2);
    }
    this.ropeTension = Math.max(0, this.ropeTension - dt * 1.5);
    // sound of speed: ONE wind rush that swells and brightens with speed (the old tension loop read as a
    // "ferry horn" on the HP — gone); the web's stretch is WebLine's creak one-shots on real tension spikes
    const rush = !this.grounded && !this.stuck ? clamp((sp - 6) / 32, 0, 1) : 0;
    this.loop('wind', 'sp_wind_loop', rush * rush * 0.95, 0.8 + 0.45 * rush);
    if (this.local && this.rope) this.MZ.haptics?.hum?.('web', this.ropeTension, dt);
    // a whoosh at the bottom of each arc
    if (this.rope && sp > 16) { this._wh = (this._wh ?? 0) - dt * sp / 26; if (this._wh <= 0) { this._wh = 1; this.sfx(Math.random() < 0.5 ? 'sp_swing_whoosh_1' : 'sp_swing_whoosh_2', { at: this.root, gain: clamp(sp / 45, 0.3, 1) }); } }
  }

  // ------------------------------------------------------------------ camera
  /** Marvel's camera: with the right stick idle it swings round behind the travel direction (faster the
   * faster he goes) and eases its pitch to look slightly down the arc; on walls it stays put. */
  autoCamera(dt) {
    const v = this.vel, hs = Math.hypot(v.x, v.z);
    // FIGHT: turn towards the weighted centre of the threat (close / attacking foes count more) so the crew stays in
    // front of him — unless they are all round him (then only the pull-back of updateCamera helps); looks down a touch
    this.fightW = damp(this.fightW || 0, this.combat?.fighting && (this.grounded || this.combat.atk) ? 1 : 0, 2.5, dt);
    if (this.fightW > 0.05 && this.lookIdle > 0.5 && !this.stuck && !this.rope) {
      const c = this.combat.threat;
      if (c) {
        const dx = c.x - this.pos.x, dz = c.z - this.pos.z;
        // only as much as it takes to bring the threat within ±KEEP of the view, and gently: no swirl when a foe drops
        const KEEP = 0.55, want = Math.atan2(-dx, -dz), off = angDiff(this.camYaw, want);
        if (Math.hypot(dx, dz) > 2.5 && Math.abs(off) > KEEP) this.camYaw = angDamp(this.camYaw, want - Math.sign(off) * KEEP, 1.4 * this.fightW, dt);
      }
      this.camPitch = damp(this.camPitch, -0.3, 2 * this.fightW, dt);
      return;
    }
    // WALL RUN up a facade: from below, looking up the wall (sky + the edge ahead), squared to the wall — not a
    // flat stare at the bricks (right stick still wins)
    if (this.stuck && v.y > 4 && this.lookIdle > 0.4) {
      const n = this.wallN, k = clamp((v.y - 4) / 5, 0, 1);
      this.camYaw = angDamp(this.camYaw, Math.atan2(n.x, n.z), 3 * k, dt);
      this.camPitch = damp(this.camPitch, 0.85, 2.5 * k, dt);
      return;
    }
    if (this.stuck || this.lookIdle < 0.6) return;
    // PITCH comes home whenever the right stick rests — moving or not (after a wall run the camera used to stay
    // pitched up at the sky until the stick was touched)
    const idle = clamp((this.lookIdle - 0.6) / 0.6, 0, 1);
    const pWant = this.grounded ? -0.15 : clamp(-0.12 + v.y / 90, -0.45, 0.05);
    this.camPitch = damp(this.camPitch, pWant, (hs > 5 ? 1.2 : 1.5) * idle, dt);
    if (hs < 5 || this.grounded && hs < 6) return;
    // follow a SMOOTHED travel heading, gently: the pendulum's own wobble never shows up as the camera turning
    // on a line the swing's own direction (a held pendulum swinging BACK must not turn the camera round)
    const hd = this.rope?.head, vh = hd ? Math.atan2(-hd.x, -hd.z) : Math.atan2(-v.x, -v.z);
    this.travelHd = this.travelHd === undefined ? vh : angDamp(this.travelHd, vh, 1.5, dt);
    const k = clamp((hs - 5) / 25, 0, 1) * idle;
    this.camYaw = angDamp(this.camYaw, this.travelHd, 1.6 * k, dt);
  }
  updateCamera(dt, cam) {
    const focus = _v.copy(this.pos); focus.y += this.stuck ? 0.6 : 0.45;
    // in the air the focus HEIGHT is eased (≈ 0.09 s): the pendulum's dip and rise read as him moving in the frame and
    // the horizon stays steady, instead of the whole view bobbing with every arc; on the ground / walls it is exact
    const air = !this.grounded && !this.stuck;
    this._fy = this._fy === undefined || !air || Math.abs(this._fy - focus.y) > 6 ? focus.y : damp(this._fy, focus.y, 11, dt);
    focus.y = this._fy;
    const sp = this.vel.length();
    // lean into a turn only when the player STEERS one (stick), from the smoothed heading rate — no roll of
    // its own that would read as the swing turning
    const hd = this.travelHd ?? Math.atan2(-this.vel.x, -this.vel.z), dh = angDiff(this._camHd ?? hd, hd) / Math.max(dt, 1e-3); this._camHd = hd;
    this._roll = damp(this._roll || 0, air && sp > 10 && (this.mag || 0) > 0.3 ? clamp(-dh * 0.08, -0.07, 0.07) : 0, 3, dt);
    let roll = this._roll;
    // a wall run is framed like a fast swing (wider FOV, pulled back) with a slight lean into a sideways run
    const running = this.stuck && sp > CRAWL + 1, feel = running ? Math.max(sp, 20) : sp;
    if (running) { const q = cam.quaternion, rx = _v2.set(1, 0, 0).applyQuaternion(q); roll = clamp(-this.vel.dot(rx) / WALL_RUN * 0.06, -0.06, 0.06); }
    this.fov = this.cam.follow(dt, cam, { focus, yaw: this.camYaw, pitch: this.camPitch, speed: feel, top: 60, aiming: this.aiming, collider: this.camCollider(), roll,
      extraBack: (this.stuck && this.vel.y < 4 ? 0.5 : this.rope ? 0.3 : 0) + 1.8 * (this.fightW || 0) });
    this.fov += 6 * (this.fightW || 0);                              // a fight is framed wider
    this.cineCamera(dt, cam);
    if (!this.world.kick) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
  /** what the camera keeps out of: buildings AND the city/base meshes (parapets, bulkheads, roof clutter — the
   * camera used to sink behind them on roofs), never trees, props or cars (they would make it twitch) */
  camCollider() {
    if (this._camCol) return this._camCol;
    const col = this.col, B = this.buildings();
    return (this._camCol = col.parts3 ? { raycast: (o, d, L, out) => col.raycast(o, d, L, out || {}, { only: ['building', 'mesh'] }), groundAt: (x, z, y) => col.groundAt(x, z, y) } : B);
  }
  /** THE THROW CAMERA: while one of the story's △ moves plays (yank / heave / rocket catch / takedown) the chase
   * camera (glued behind his back — the spinning crate and the enemy it flies at were off screen) blends into a
   * 3/4 side shot that frames him, the object (sampled from the clip's prop track) and, from the release, the
   * target it flies at; it follows the throw to the impact and eases back afterwards. */
  cineCamera(dt, cam) {
    const C = this._cine ||= { w: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), side: 0, name: null, fov: 60, init: false };
    let shot = null;
    for (const s of this.anim.shots) if (!s.cancel && CINE[s.name]) { shot = s; break; }
    if (shot && shot.name !== C.name) { C.name = shot.name; C.side = 0; C.init = false; C.target = null; C.axis = null; }
    if (shot) C.hold = 0.35; else C.hold = (C.hold || 0) - dt;
    C.w = damp(C.w, shot || C.hold > 0 ? 1 : 0, shot ? 4.5 : 2.2, dt);
    if (C.w < 0.01) { C.name = null; return; }
    const M = CINE[C.name] || {}, t = shot ? shot.a.time : (C.t ?? 0); C.t = t;
    if (!C.init) this.cineBind(C, M);
    // subjects: his chest, the object (the story's real one once it is in his hands — else the clip's prop track), the
    // foe it goes to. After the release the shot follows the object and the target (he drops out of it).
    const hero = _v4.copy(this.pos); hero.y += 0.3;
    const obj = this.cineObject(C, M, t), flying = M.release !== undefined && t >= M.release;
    const subj = [], wts = [];
    const add = (q, w) => { subj.push(q.clone()); wts.push(w); };
    add(hero, flying ? clamp(1 - (t - M.release) / 0.35, 0.15, 1) : 1);
    if (obj) add(obj, 1);
    if (C.target && (flying || !M.prop)) add(this.combat.chest(C.target, new THREE.Vector3()), 0.9);
    // centre (weighted) + spread
    const c = new THREE.Vector3(); let W = 0; subj.forEach((q, i) => { c.addScaledVector(q, wts[i]); W += wts[i]; }); c.divideScalar(W);
    let rad = 1.2; subj.forEach((q, i) => { if (wts[i] > 0.3) rad = Math.max(rad, q.distanceTo(c)); });
    // the action axis: him → the target (the throw direction), set at the start and only drifting slowly — NOT
    // towards the prop (a hammer throw swings it round him: the camera would whip round with it); and a side of it
    // (the side the camera is already on — never a flip)
    const aim = C.target ? C.target.holder.position : null, ax0 = _v3.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    if (aim) { ax0.subVectors(aim, hero).setY(0); if (ax0.lengthSq() < 0.25) ax0.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
    ax0.normalize();
    if (!C.axis) C.axis = ax0.clone(); else C.axis.lerp(ax0, 1 - Math.exp(-dt * 1.0)).normalize();
    const ax = C.axis;
    const sideV = new THREE.Vector3(-ax.z, 0, ax.x);
    if (!C.side) C.side = sideV.dot(_v2.subVectors(cam.position, hero)) >= 0 ? 1 : -1;
    const fov = M.fov || 58, dist = clamp(rad * 1.15 / Math.tan(fov * Math.PI / 360) + 1.5, 5.5, 18);
    const low = M.low && t < (M.release ?? 9);                           // the heave: a low angle for the lift overhead
    const want = c.clone().addScaledVector(sideV, C.side * dist * (M.side ?? 0.72)).addScaledVector(ax, -dist * (M.back ?? 0.69));
    want.y = c.y + (low ? 0.2 : 1.4 + dist * 0.14);
    // keep it out of the buildings and above the ground
    const B = this.camCollider(), dir = _v2.subVectors(want, c), L = dir.length(); dir.divideScalar(L);
    const hit = B.raycast(c, dir, L + 0.5, {}); if (hit) want.copy(c).addScaledVector(dir, Math.max(2.5, hit.t - 0.6));
    const g = this.col.groundAt(want.x, want.z, want.y + 2) + 0.6; if (want.y < g) want.y = g;
    if (!C.init) { C.pos.copy(cam.position); C.look.copy(c); C.fov = this.fov; C.init = true; }
    const k = 1 - Math.exp(-dt * 4.5);
    C.pos.lerp(want, k); C.look.lerp(c, 1 - Math.exp(-dt * 6)); C.fov += (fov - C.fov) * k;
    // blend over the chase camera
    const q0 = _q.copy(cam.quaternion);
    cam.position.lerp(C.pos, C.w);
    const m = _m.lookAt(C.pos, C.look, UP), q1 = (this._qd ||= new THREE.Quaternion()).setFromRotationMatrix(m);
    cam.quaternion.copy(q0).slerp(q1, C.w);
    this.fov = this.fov + (C.fov - this.fov) * C.w;
  }
  /** at the start of a △ move: find the story's real object (the crate / generator it throws, the rocket it
   * catches) and pick the target exactly as story/moves.js does (nearest standing foe to the object's start; the
   * brute for a heave; the rocket's shooter) */
  cineBind(C, M) {
    C.item = null; C.rocket = null; C.target = null;
    const Mi = this.MZ.story?.missions, foes = this.combat?.foes() || [];
    if (M.kind === 'yank' || M.kind === 'heave') {
      const want = M.kind === 'heave' ? 'heavy' : 'crate';
      let best = null, bd = 20;
      for (const it of Mi?.props?.items || []) { if (it.kind !== want || !it.o) continue; const d = it.o.getWorldPosition(_v).distanceTo(this.pos); if (d < bd && (it.thrown || d < 15)) { bd = d; best = it; } }
      C.item = best;
      const c0 = best ? best.o.getWorldPosition(new THREE.Vector3()) : this.pos;
      const big = M.kind === 'heave' ? foes.find(e => e.k?.big) : null;
      C.target = big || foes.slice().sort((a, b) => a.holder.position.distanceTo(c0) - b.holder.position.distanceTo(c0))[0] || null;
    } else if (M.kind === 'rocket') {
      const R = (Mi?.enemies?.gf?.rockets || []).find(r => r.held || r.victim === this);
      C.rocket = R || null; C.target = R?.shooter || null;
    } else C.target = this.cineTarget(M);
  }
  /** where the thrown object is now (world), or null */
  cineObject(C, M, t) {
    if (C.item?.o && C.item.o.visible !== false) return C.item.o.getWorldPosition(new THREE.Vector3());
    if (C.rocket?.o) return C.rocket.o.getWorldPosition(new THREE.Vector3());
    const tr = M.prop && this.propTracks[C.name]?.[M.prop];
    if (tr && t >= (M.from ?? 0) && t < M.release) { const v = tr.evaluate(t); return this.root.localToWorld(new THREE.Vector3(v[0], v[1], v[2])); }
    return null;
  }
  /** who a △ move is aimed at: the story's own choice (the nearest standing foe to the object / the brute for a
   * heave / the rocket's shooter), re-derived here for the framing */
  cineTarget(M) {
    const foes = this.combat?.foes() || []; if (!foes.length) return null;
    if (M.kind === 'rocket') return foes.filter(e => e.kind === 'rpg').sort((a, b) => a.holder.position.distanceTo(this.pos) - b.holder.position.distanceTo(this.pos))[0] || null;
    if (M.kind === 'heave') { const big = foes.find(e => e.k?.big); if (big) return big; }
    const f = _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), ahead = this.pos.clone().addScaledVector(f, 6);
    return foes.sort((a, b) => a.holder.position.distanceTo(ahead) - b.holder.position.distanceTo(ahead))[0];
  }

  // ------------------------------------------------------------------ network
  state() {
    const r3 = v => +v.toFixed(2), f = (this.grounded ? 1 : 0) | (this.stuck ? 2 : 0) | (this.rope ? 4 : 0) | (this.rope?.hand === 'L' ? 8 : 0);
    const A = this.rope ? this.anchorNow(new THREE.Vector3()).toArray().map(r3) : null;
    return { p: this.pos.toArray().map(r3), q: this.root.quaternion.toArray().map(v => +v.toFixed(4)), v: this.vel.toArray().map(r3), f, A,
      tg: this.rope?.target?.id ?? null, n: this.stuck ? [r3(this.wallN.x), r3(this.wallN.z)] : null };
  }
  updateRemote(dt) {
    const n = this.net;
    if (n.has) {
      const k = 1 - Math.exp(-dt / 0.12), s = n.s;
      this.pos.lerp(_v.copy(n.p).addScaledVector(n.v, 0.05), k); this.vel.lerp(n.v, k);
      this.grounded = !!(s.f & 1); this.stuck = !!(s.f & 2);
      if (s.n) this.wallN.set(s.n[0], 0, s.n[1]);
      if (s.f & 4 && s.A) {
        if (!this.rope) { this.rope = { point: new THREE.Vector3().fromArray(s.A), node: null, hand: s.f & 8 ? 'L' : 'R', L: 10 }; this.rope.line = this.world.webfx?.line({ from: this.web[this.rope.hand], to: this.rope.point, kind: 'swing' }); }
        this.rope.point.fromArray(s.A); if (this.rope.line) this.rope.line.toPoint.copy(this.rope.point);
      } else if (this.rope) { this.rope.line?.release(); this.rope = null; }
    }
    this.pose(dt, _v2.set(0, 0, 0), 0); this.stateMachine(dt, 0); this.anim.update(dt); this.nano?.update(dt); this.effects(dt);
  }
  remoteEvent(e) {
    if (e.kind === 'shot' && e.web && e.to) { const from = this.web[e.hand === 'L' ? 'L' : 'R']?.getWorldPosition(new THREE.Vector3()); if (from) this.world.webfx?.shoot({ from, dir: new THREE.Vector3().fromArray(e.to).sub(from).normalize(), hand: e.hand }); this.anim.layer(e.hand === 'L' ? 'web_shoot_L' : 'web_shoot_R', 1, { restart: true, rate: 30 }); }
  }
  hud() {
    const sp = this.vel.length(), running = this.stuck && sp > CRAWL + 1;
    // hero: the juice pass scales speed lines per hero (Spider-Man top 45 m/s); juice: 0..1 "how fast it
    // should FEEL" (a 12 m/s wall run feels like a fast swing) — asked of the lead in CORE-REQUESTS
    return { hero: 'spiderman', juice: running ? 0.75 : clamp((sp - 12) / 30, 0, 1), speed: sp, vspeed: this.vel.y, alt: this.pos.y - 1, heading: ((-this.camYaw * 180 / Math.PI) % 360 + 360) % 360,
      grounded: this.grounded, wall: this.stuck, hover: false, health: this.health, aim: { ...this.aimScreen },
      web: this.rope ? { attached: !(this.rope.flying > 0), tension: this.ropeTension, tether: !!this.rope.node, length: this.rope.L } : null,
      hops: this.hops, sense: this.combat?.sense || 0, combo: this.combat?.combo || 0, focus: this.combat?.focus || 0,
      gadget: { bomb: this.combat ? 1 - this.combat.bombCD / 8 : 1, legs: 1, legsOut: !!this.legs?.out },
      prompts: this.combat?.sense > 0.6 ? [{ action: 'dodge', text: 'Dodge' }] : this.stuck ? [{ action: 'jump', text: 'Jump off' }] : this.zip?.pulled ? [{ action: 'jump', text: 'Launch' }] : [] };
  }
  dispose() { this.rope?.line?.release(); this.zip?.fx?.release(); this.zfx?.fx?.release(); this.disposed = true; super.dispose(); }
}

function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function angDiff(a, b) { return ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; }
function angDamp(a, b, rate, dt) { return a + angDiff(a, b) * (1 - Math.exp(-rate * dt)); }

/** Closest point of a building prism to I (walls, or the top edge when I is above the roof), with y ≥ minY. */
function closestOnPrism(p, I, minY) {
  let best = Infinity, ex = 0, ez = 0, nx = 0, nz = 0;
  for (let i = 0; i < p.n; i++) {
    const j = (i + 1) % p.n, ax = p.xs[i], az = p.zs[i], dx = p.xs[j] - ax, dz = p.zs[j] - az, L2 = dx * dx + dz * dz; if (L2 < 1e-6) continue;
    const u = clamp(((I.x - ax) * dx + (I.z - az) * dz) / L2, 0.02, 0.98), cx = ax + dx * u, cz = az + dz * u, d = Math.hypot(I.x - cx, I.z - cz);
    if (d < best) { best = d; ex = cx; ez = cz; const L = Math.sqrt(L2); nx = dz / L * p.s; nz = -dx / L * p.s; }
  }
  if (best === Infinity) return null;
  const y = clamp(I.y, Math.max(p.y0, minY), p.y1);
  if (y > p.y1 - 1e-3 && p.y1 < minY) return null;
  return new THREE.Vector3(ex + nx * 0.05, Math.min(y, p.y1 - 0.05), ez + nz * 0.05);
}
