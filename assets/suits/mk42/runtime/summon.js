// summon.js — Mark 42 prehensile summon / eject / shed runtime.
//
// Engine-agnostic core: plain math, no three.js, no DOM. The showroom drives it through
// summon-three.js; the game uses the line-by-line GDScript port summon.gd. The baked
// clips (summon_demo, eject, arm_only_summon) are produced by running THIS file in node
// (next/blender/mk42/summon-bake.mjs), so what the cutscene shows is what the runtime does.
//
// Model
//   A PIECE is a sub-assembly that flies as one rigid body (the whole right glove, the
//   chest with collars and ribs...). mk42.pieces.json lists them: lead joint, centre and
//   outward normal in the lead joint's frame, hull sample points, order, reaction joint.
//   The piece's SOCKET is the live world transform of its lead joint (every canonical
//   joint has identity rest rotation, so piece frame == joint frame when locked).
//
//   State per piece: centre position p, rotation q (world). The host places meshes with
//   frame(i) = { p: p - q*center, q } and, for meshes on other joints of the same piece,
//   blends from their frozen offsets to their live joints with sub(i) (0 in flight, 1 when
//   locked).
//
// Summon behaviour (per piece): queued -> wake (jolt + thruster puff) -> fly (curved
//   Bezier, lifted, swirled, pushed around the wearer's body, repelled from other pieces,
//   end tangent along the socket's outward normal) -> approach (straight in along the
//   live normal, rotating into alignment over the final third, slight overshoot) -> hold
//   -> clamp (fast 3 cm slide + rotation click) -> locked (+ body reaction impulse).
//   All targets are LIVE: sockets on a walking / gesturing wearer are tracked every frame.
//
// Coordinates: glTF / game space, +Y up, metres, quaternions {x,y,z,w}.

// ------------------------------------------------------------------------------------
// tiny math (mirrors Godot's Vector3 / Quaternion API so summon.gd reads the same)
// ------------------------------------------------------------------------------------
export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  static of(a) { return a instanceof V3 ? a.clone() : Array.isArray(a) ? new V3(a[0], a[1], a[2]) : new V3(a.x, a.y, a.z); }
  clone() { return new V3(this.x, this.y, this.z); }
  add(b) { return new V3(this.x + b.x, this.y + b.y, this.z + b.z); }
  sub(b) { return new V3(this.x - b.x, this.y - b.y, this.z - b.z); }
  mul(s) { return new V3(this.x * s, this.y * s, this.z * s); }
  dot(b) { return this.x * b.x + this.y * b.y + this.z * b.z; }
  cross(b) { return new V3(this.y * b.z - this.z * b.y, this.z * b.x - this.x * b.z, this.x * b.y - this.y * b.x); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalized() { const l = this.length(); return l > 1e-9 ? this.mul(1 / l) : new V3(0, 0, 0); }
  lerp(b, t) { return new V3(this.x + (b.x - this.x) * t, this.y + (b.y - this.y) * t, this.z + (b.z - this.z) * t); }
}

export class Q {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  static of(a) { return a instanceof Q ? a.clone() : Array.isArray(a) ? new Q(a[0], a[1], a[2], a[3]) : new Q(a.x, a.y, a.z, a.w); }
  clone() { return new Q(this.x, this.y, this.z, this.w); }
  static axisAngle(axis, ang) {
    const a = axis.normalized(), s = Math.sin(ang / 2);
    return new Q(a.x * s, a.y * s, a.z * s, Math.cos(ang / 2));
  }
  static fromRotVec(v) { const a = v.length(); return a < 1e-9 ? new Q() : Q.axisAngle(v, a); }
  static between(a, b) {                         // shortest arc a -> b (unit vectors)
    const d = a.dot(b);
    if (d < -0.999999) {
      let ax = new V3(1, 0, 0).cross(a);
      if (ax.length() < 1e-6) ax = new V3(0, 1, 0).cross(a);
      return Q.axisAngle(ax, Math.PI);
    }
    const c = a.cross(b);
    return new Q(c.x, c.y, c.z, 1 + d).normalized();
  }
  mul(b) {
    const a = this;
    return new Q(a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
                 a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
                 a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
                 a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z);
  }
  inverse() { return new Q(-this.x, -this.y, -this.z, this.w); }
  dot(b) { return this.x * b.x + this.y * b.y + this.z * b.z + this.w * b.w; }
  normalized() { const l = Math.hypot(this.x, this.y, this.z, this.w) || 1; return new Q(this.x / l, this.y / l, this.z / l, this.w / l); }
  xform(v) {                                     // rotate a vector
    const u = new V3(this.x, this.y, this.z), s = this.w;
    return u.mul(2 * u.dot(v)).add(v.mul(s * s - u.dot(u))).add(u.cross(v).mul(2 * s));
  }
  slerp(b, t) {
    let bx = b.x, by = b.y, bz = b.z, bw = b.w;
    let c = this.dot(b);
    if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let k0, k1;
    if (c > 0.9995) { k0 = 1 - t; k1 = t; }
    else { const a = Math.acos(c), s = Math.sin(a); k0 = Math.sin((1 - t) * a) / s; k1 = Math.sin(t * a) / s; }
    return new Q(this.x * k0 + bx * k1, this.y * k0 + by * k1, this.z * k0 + bz * k1, this.w * k0 + bw * k1).normalized();
  }
  toRotVec() {                                   // axis * angle
    let q = this.w < 0 ? new Q(-this.x, -this.y, -this.z, -this.w) : this;
    const s = Math.hypot(q.x, q.y, q.z);
    if (s < 1e-9) return new V3(0, 0, 0);
    const a = 2 * Math.atan2(s, q.w);
    return new V3(q.x / s * a, q.y / s * a, q.z / s * a);
  }
}

const UP = new V3(0, 1, 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOutBack = (u, c1) => { const c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

// deterministic RNG (mulberry32) — the same seed gives the same summon in JS and GDScript
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------
// tuning (all times in seconds, distances in metres) — identical in summon.gd
// ------------------------------------------------------------------------------------
export const TUNE = {
  wake: 0.30, hop: 0.06,                 // jolt up on wake
  approachDist: 0.30, preLock: 0.03,     // straight-in segment, clamp stroke
  approach: 0.22, hold: 0.05, clamp: 0.07, overshoot: 1.1,
  orderGap: 0.24, orderJitter: 0.12, faceplateGap: 0.30,
  flyBase: 0.52, flyPerSqrtM: 0.22, flyMin: 0.62, flyMax: 2.5,
  keepOutR: 0.40, keepOutSoft: 0.12,     // capsule around the wearer's body axis
  avoidK: 9.0, avoidSpring: 14.0, avoidDamp: 7.5,
  reactK: 320, reactZeta: 0.32, reactKick: 1.3, reactKickPerM: 2.2,
  gravity: 9.81, restitution: 0.30, friction: 0.55, settleTime: 0.40,
};

export class SummonCore {
  /**
   * @param table  mk42.pieces.json content
   * @param opts   { joint(name) -> {p:{x,y,z}, q:{x,y,z,w}}   live wearer joints (world),
   *                 ground(x, z) -> y   (default 0),  seed }
   */
  constructor(table, opts = {}) {
    this.table = table;
    this.jointFn = opts.joint;
    this.ground = opts.ground || (() => 0);
    this.rand = rng(opts.seed ?? 42);
    this.time = 0;
    this.events = [];
    this.react = {};                         // joint -> {v, w} (world rot-vec spring)
    this.pieces = table.pieces.map((d, i) => ({
      i, def: d, name: d.name,
      c: V3.of(d.center), n: V3.of(d.normal).normalized(),
      hull: (d.hull || []).map(V3.of), radius: d.radius,
      mode: 'locked', t: 0, p: new V3(), q: new Q(), v: new V3(), w: new V3(),
      thrust: 0, sub: 1, avoid: new V3(), avoidV: new V3(), contact: 0, still: 0,
    }));
    this.byName = Object.fromEntries(this.pieces.map((s) => [s.name, s]));
    this._allLockedSent = true;
  }

  // ---------------- queries for the host ----------------------------------------------
  frame(name) {                               // world transform of the piece's lead frame
    const s = this.byName[name];
    return { p: s.p.sub(s.q.xform(s.c)), q: s.q.clone() };
  }
  state(name) { return this.byName[name].mode; }
  thrust(name) { return this.byName[name].thrust; }
  sub(name) { return this.byName[name].sub; }
  isLocked(name) { return this.byName[name].mode === 'locked'; }
  allLocked() { return this.pieces.every((s) => s.mode === 'locked' || s.mode === 'hidden'); }
  /** world rotation-vector offset to add to `joint` (host: local' = P^-1 * R * P * local) */
  reaction(joint) { const r = this.react[joint]; return r ? r.v.clone() : new V3(); }
  reactionJoints() { return Object.keys(this.react); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------------- sockets -----------------------------------------------------------
  _joint(name) { const j = this.jointFn(name); return { p: V3.of(j.p), q: Q.of(j.q).normalized() }; }
  _socket(s) {
    const J = this._joint(s.def.joint);
    return { c: J.p.add(J.q.xform(s.c)), q: J.q, n: J.q.xform(s.n).normalized() };
  }
  _emit(type, s, extra = {}) {
    this.events.push(Object.assign({ type, piece: s ? s.name : null, t: this.time,
                                      pos: s ? [s.p.x, s.p.y, s.p.z] : null }, extra));
  }

  // ---------------- state setters -----------------------------------------------------
  lockAll() { for (const s of this.pieces) this._lock(s, false); this._allLockedSent = true; }
  hide(names) { for (const n of names) { const s = this.byName[n]; s.mode = 'hidden'; } }
  /** put a piece at a world transform of its LEAD FRAME (e.g. scattered / dragged) */
  place(name, framePos, frameRot, mode = 'resting') {
    const s = this.byName[name];
    s.q = Q.of(frameRot).normalized();
    s.p = V3.of(framePos).add(s.q.xform(s.c));
    s.v = new V3(); s.w = new V3(); s.mode = mode; s.t = 0; s.sub = 0; s.thrust = 0;
  }
  drop(name) { const s = this.byName[name]; s.mode = 'ballistic'; s.t = 0; s.contact = 0; s.still = 0; }

  _lock(s, withEvent = true) {
    const so = this._socket(s);
    s.p = so.c; s.q = so.q.clone(); s.v = new V3(); s.w = new V3();
    s.mode = 'locked'; s.sub = 1; s.thrust = 0; s.avoid = new V3(); s.avoidV = new V3();
    if (withEvent) {
      this._emit('lock', s, { size: s.radius, order: s.def.order });
      // body reaction: the plate slams in along -n at its centre
      const rj = s.def.react;
      if (rj) {
        const R = this._joint(rj);
        const tq = so.c.sub(R.p).cross(so.n.mul(-1));
        if (tq.length() > 1e-6) {
          const kick = TUNE.reactKick + TUNE.reactKickPerM * s.radius;
          const r = this.react[rj] || (this.react[rj] = { v: new V3(), w: new V3() });
          r.w = r.w.add(tq.normalized().mul(kick * (s.def.reactScale ?? 1)));
        }
      }
    }
  }

  /** release every locked piece at its current socket and blow it off the body */
  eject({ strength = 1.0, origin = null } = {}) {
    const hub = origin ? V3.of(origin) : this._joint('piv_chest').p;
    this._emit('eject', null, { pos: [hub.x, hub.y, hub.z], strength });
    for (const s of this.pieces) {
      if (s.mode !== 'locked') continue;
      const so = this._socket(s);
      s.p = so.c; s.q = so.q.clone();
      const out = so.c.sub(hub); out.y *= 0.3;
      const lat = new V3(this.rand() - 0.5, 0, this.rand() - 0.5).mul(1.2);
      s.v = so.n.mul((2.0 + 1.6 * this.rand()) * strength)
        .add(UP.mul((1.3 + 1.5 * this.rand()) * strength))
        .add(out.normalized().mul(1.2 * strength)).add(lat);
      s.w = new V3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalized()
        .mul((3 + 6 * this.rand()) * strength);
      s.mode = 'ballistic'; s.t = -so.c.sub(hub).length() * 0.06;   // blast front delay
      s.sub = 0; s.thrust = 0; s.contact = 0; s.still = 0;
      this._emit('release', s);
    }
    this._allLockedSent = false;
  }

  /** a single damaged plate falls off */
  shed(name, push = 1.0) {
    const s = this.byName[name];
    if (s.mode !== 'locked') return;
    const so = this._socket(s);
    s.p = so.c; s.q = so.q.clone();
    s.v = so.n.mul(1.2 * push).add(UP.mul(0.6 * push));
    s.w = so.n.cross(UP).normalized().mul(2.5 * push);
    s.mode = 'ballistic'; s.t = 0; s.sub = 0; s.contact = 0; s.still = 0;
    this._emit('shed', s);
    this._allLockedSent = false;
  }

  /** lay every piece on the ground somewhere around `center` (debug / showroom) */
  scatter({ center = [0, 0, 0], rMin = 1.2, rMax = 4.5, farChance = 0.15, farMin = 7, farMax = 13, seed = null } = {}) {
    const R = seed == null ? this.rand : rng(seed);
    const C = V3.of(center);
    for (const s of this.pieces) {
      if (s.mode === 'hidden') continue;
      const far = R() < farChance;
      const a = R() * Math.PI * 2;
      const r = far ? farMin + (farMax - farMin) * R() : rMin + (rMax - rMin) * Math.sqrt(R());
      const yaw = Q.axisAngle(UP, R() * Math.PI * 2);
      const flip = R() < 0.35 ? -1 : 1;
      const q = yaw.mul(Q.between(s.n.mul(flip), UP)).normalized();
      s.q = q;
      const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      s.p = new V3(x, 0, z);
      s.p.y = this.ground(x, z) - this._lowest(s, q) + 0.002;
      s.v = new V3(); s.w = new V3(); s.mode = 'resting'; s.sub = 0; s.thrust = 0;
    }
    this._allLockedSent = false;
  }
  _lowest(s, q) {                               // min y of the hull relative to the centre
    let m = 0;
    for (const h of s.hull) m = Math.min(m, q.xform(h).y);
    return m;
  }

  /**
   * Summon every non-locked piece (or `names`). Locks happen in body order
   * (feet -> helmet -> faceplate), far pieces wake earlier so the swarm arrives in order.
   */
  summon({ names = null, delay = 0.0 } = {}) {
    const list = this.pieces.filter((s) => s.mode !== 'locked' && s.mode !== 'hidden' && (!names || names.includes(s.name)));
    if (!list.length) return 0;
    const orders = [...new Set(list.map((s) => s.def.order))].sort((a, b) => a - b);
    const plan = list.map((s) => {
      const so = this._socket(s);
      const dist = so.c.sub(s.p).length();
      const T = clamp(TUNE.flyBase + TUNE.flyPerSqrtM * Math.sqrt(dist), TUNE.flyMin, TUNE.flyMax);
      const total = TUNE.wake + T + TUNE.approach + TUNE.hold + TUNE.clamp;
      const rank = orders.indexOf(s.def.order);
      const lockAt = rank * TUNE.orderGap + (s.def.order >= 9 ? TUNE.faceplateGap : 0) + this.rand() * TUNE.orderJitter;
      return { s, T, total, lockAt, dist };
    });
    const shift = this.time + delay - Math.min(...plan.map((p) => p.lockAt - p.total));
    for (const pl of plan) {
      const s = pl.s;
      s.mode = 'queued';
      s.wakeAt = pl.lockAt - pl.total + shift;
      s.T = pl.T; s.dist = pl.dist;
      s.v = new V3(); s.w = new V3();
      // per-piece flight personality
      s.lift = 0.30 + 0.30 * Math.min(pl.dist, 5) / 5 + 0.10 * this.rand();
      const side = new V3(this.rand() - 0.5, 0.2 * (this.rand() - 0.5), this.rand() - 0.5).normalized();
      s.swirl = side.mul(0.18 + 0.22 * this.rand() + 0.05 * Math.min(pl.dist, 6));
      s.tumbleAxis = new V3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalized();
      s.tumble = (0.35 + 0.5 * this.rand()) * (pl.dist > 0.6 ? 1 : 0.3);
      s.clickAxis = new V3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalized();
      s.clickAng = (5 + 5 * this.rand()) * Math.PI / 180;
      s.shakeAxis = new V3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalized();
    }
    this._allLockedSent = false;
    return plan.length;
  }

  // ---------------- simulation ----------------------------------------------------------
  update(dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let k = 0; k < n; k++) this._step(dt / n);
  }

  _step(dt) {
    this.time += dt;
    // body reactions (damped springs on world rot-vectors)
    const c = 2 * TUNE.reactZeta * Math.sqrt(TUNE.reactK);
    for (const j in this.react) {
      const r = this.react[j];
      r.w = r.w.add(r.v.mul(-TUNE.reactK).add(r.w.mul(-c)).mul(dt));
      r.v = r.v.add(r.w.mul(dt));
    }
    const hips = this._joint('piv_hips').p;
    // pairwise avoidance forces between flying pieces
    const flying = this.pieces.filter((s) => s.mode === 'fly');
    const force = new Map(flying.map((s) => [s, new V3()]));
    for (let a = 0; a < flying.length; a++) {
      for (let b = a + 1; b < flying.length; b++) {
        const A = flying[a], B = flying[b];
        const d = A.p.sub(B.p);
        const L = d.length();
        const minD = 0.8 * (Math.min(A.radius, 0.28) + Math.min(B.radius, 0.28));
        if (L < minD) {
          const f = d.normalized().mul(TUNE.avoidK * (minD - L) / minD);
          force.set(A, force.get(A).add(f));
          force.set(B, force.get(B).sub(f));
        }
      }
    }
    for (const s of this.pieces) {
      switch (s.mode) {
        case 'locked': { const so = this._socket(s); s.p = so.c; s.q = so.q; break; }
        case 'queued':
          if (this.time >= s.wakeAt) {
            s.mode = 'wake'; s.t = 0; s.S0 = s.p.clone(); s.q0 = s.q.clone();
            this._emit('wake', s, { size: s.radius, dist: s.dist });
          }
          break;
        case 'wake': this._wake(s, dt); break;
        case 'fly': this._fly(s, dt, hips, force.get(s)); break;
        case 'approach': case 'hold': case 'clamp': this._final(s, dt); break;
        case 'ballistic': this._ballistic(s, dt); break;
        case 'settle': this._settle(s, dt); break;
        default: break;
      }
    }
    if (!this._allLockedSent && this.allLocked()) {
      this._allLockedSent = true;
      this._emit('allLocked', null);
    }
  }

  _wake(s, dt) {
    s.t += dt;
    const u = clamp(s.t / TUNE.wake, 0, 1);
    // jolt: snap up fast with an overshoot, then hang
    const hop = u < 0.22 ? smooth(0, 0.22, u) * 1.25 : 1.25 - 0.25 * smooth(0.22, 1, u);
    s.p = s.S0.add(UP.mul(TUNE.hop * hop));
    const shake = Math.sin(u * Math.PI * 5) * (1 - u) * 0.14;
    s.q = Q.axisAngle(s.shakeAxis, shake).mul(s.q0).normalized();
    s.thrust = u < 0.15 ? 1 : 1 - 0.6 * smooth(0.15, 1, u);
    s.sub = 0;
    if (u >= 1) {
      s.mode = 'fly'; s.t = 0;
      s.P0 = s.p.clone();
      s.P1 = s.P0.add(UP.mul(s.lift)).add(s.swirl);
      s.qStart = s.q.clone();
      const so = this._socket(s);
      s.qCruise = s.qStart.slerp(so.q, 0.45).mul(Q.axisAngle(s.tumbleAxis, s.tumble)).normalized();
      this._emit('fly', s, { duration: s.T, dist: s.dist, size: s.radius });
    }
  }

  _fly(s, dt, hips, f) {
    s.t += dt;
    const tau = clamp(s.t / s.T, 0, 1);
    // speed profile: start from rest, still moving (80 %) into the approach
    const m1 = 0.8;
    const sp = -2 * tau ** 3 + 3 * tau ** 2 + m1 * (tau ** 3 - tau ** 2);
    const so = this._socket(s);
    const A = so.c.add(so.n.mul(TUNE.approachDist));
    const k2 = clamp(0.25 + 0.12 * s.dist, 0.25, 0.9);
    const P2 = A.add(so.n.mul(k2));
    const u = sp, iu = 1 - u;
    let p = s.P0.mul(iu * iu * iu).add(s.P1.mul(3 * iu * iu * u)).add(P2.mul(3 * iu * u * u)).add(A.mul(u * u * u));
    // keep out of the wearer's body: soft push away from a vertical capsule
    const wKO = 1 - smooth(0.72, 1.0, u);
    if (wKO > 0) {
      const ay = clamp(p.y, hips.y - 0.95, hips.y + 0.80);
      const rad = new V3(p.x - hips.x, p.y - ay, p.z - hips.z);
      let L = rad.length();
      const dir = L > 1e-4 ? rad.mul(1 / L) : so.n;
      const R = TUNE.keepOutR, k = TUNE.keepOutSoft;
      const push = k * Math.log(1 + Math.exp((R - L) / k));
      p = p.add(dir.mul(push * wKO));
    }
    // swarm avoidance
    s.avoidV = s.avoidV.add(f.sub(s.avoid.mul(TUNE.avoidSpring)).sub(s.avoidV.mul(TUNE.avoidDamp)).mul(dt));
    s.avoid = s.avoid.add(s.avoidV.mul(dt));
    p = p.add(s.avoid.mul(1 - smooth(0.7, 1.0, u)));
    s.p = p;
    // orientation: tumble toward a cruise attitude, align during the final third of the
    // whole fly+approach time
    const g = (s.t) / (s.T + TUNE.approach);
    const qa = s.qStart.slerp(s.qCruise, smooth(0, 0.55, tau));
    const qT = so.q.mul(Q.axisAngle(s.clickAxis, s.clickAng)).normalized();
    s.q = qa.slerp(qT, smooth(2 / 3, 1, g));
    s.qFly = qa;
    s.thrust = 0.45 + 0.15 * Math.sin(this.time * 37 + s.i) + 0.25 * (1 - smooth(0, 0.3, tau));
    if (tau >= 1) { s.mode = 'approach'; s.t = 0; this._emit('approach', s, { size: s.radius }); }
  }

  _final(s, dt) {
    s.t += dt;
    const so = this._socket(s);
    const qClick = so.q.mul(Q.axisAngle(s.clickAxis, s.clickAng)).normalized();
    let d, q;
    if (s.mode === 'approach') {
      const u = clamp(s.t / TUNE.approach, 0, 1);
      const e = easeOutBack(u, TUNE.overshoot);
      d = TUNE.preLock + (TUNE.approachDist - TUNE.preLock) * (1 - e);
      const g = (s.T + s.t) / (s.T + TUNE.approach);
      q = s.qFly.slerp(qClick, smooth(2 / 3, 1, g));
      s.thrust = 0.9 * (1 - u) + 0.3;
      if (u >= 1) { s.mode = 'hold'; s.t = 0; }
    } else if (s.mode === 'hold') {
      d = TUNE.preLock; q = qClick;
      s.thrust = 0.3;
      if (s.t >= TUNE.hold) { s.mode = 'clamp'; s.t = 0; this._emit('clamp', s, { size: s.radius }); }
    } else {
      const u = clamp(s.t / TUNE.clamp, 0, 1);
      const e = u * u;
      d = TUNE.preLock * (1 - e);
      q = qClick.slerp(so.q, e);
      s.sub = e;
      s.thrust = 0;
      if (u >= 1) { this._lock(s, true); return; }
    }
    s.p = so.c.add(so.n.mul(Math.max(d, 0)));
    s.q = q;
  }

  _ballistic(s, dt) {
    s.t += dt;
    if (s.t < 0) return;                     // waiting for the blast front
    s.v.y -= TUNE.gravity * dt;
    s.v = s.v.mul(1 - 0.08 * dt);
    s.p = s.p.add(s.v.mul(dt));
    s.q = Q.fromRotVec(s.w.mul(dt)).mul(s.q).normalized();
    // ground contact against the hull samples
    let low = null, lowY = Infinity;
    for (const h of s.hull) {
      const w = s.p.add(s.q.xform(h));
      const gy = this.ground(w.x, w.z);
      if (w.y - gy < lowY) { lowY = w.y - gy; low = w; }
    }
    if (low && lowY < 0) {
      s.p.y -= lowY;
      if (s.v.y < 0) {
        const vi = -s.v.y;
        s.v.y = vi > 0.9 ? vi * TUNE.restitution : 0;
        s.v.x *= TUNE.friction; s.v.z *= TUNE.friction;
        const r = low.sub(s.p);
        s.w = s.w.mul(0.55).add(r.cross(UP).mul(-vi * 2.2));
        if (vi > 0.45) this._emit('bounce', s, { speed: vi, size: s.radius });
      }
      s.contact = 0.12;
    }
    if (s.contact > 0) {
      s.contact -= dt;
      s.v.x *= Math.max(0, 1 - 5 * dt); s.v.z *= Math.max(0, 1 - 5 * dt);
      s.w = s.w.mul(Math.max(0, 1 - 4 * dt));
      if (s.v.length() < 0.25 && s.w.length() < 1.2) s.still += dt; else s.still = 0;
      if (s.still > 0.12) {
        s.mode = 'settle'; s.t = 0; s.qFrom = s.q.clone(); s.pFrom = s.p.clone();
        const nd = s.q.xform(s.n);
        const up = nd.y >= 0 ? nd : nd.mul(-1);
        s.qRest = Q.between(up.normalized(), UP).mul(s.q).normalized();
      }
    }
  }

  _settle(s, dt) {
    s.t += dt;
    const u = smooth(0, 1, s.t / TUNE.settleTime);
    s.q = s.qFrom.slerp(s.qRest, u);
    const y = this.ground(s.pFrom.x, s.pFrom.z) - this._lowest(s, s.q) + 0.002;
    s.p = new V3(s.pFrom.x, s.pFrom.y + (y - s.pFrom.y) * u, s.pFrom.z);
    if (s.t >= TUNE.settleTime) { s.mode = 'resting'; this._emit('rest', s); }
  }
}
