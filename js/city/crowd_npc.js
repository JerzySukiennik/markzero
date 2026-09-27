// Near pedestrians as CPU agents (Jurek: "people have no collision, walk the wrong way, don't react to a hard
// landing — they should be NPCs like in GTA V"). Hybrid: the far crowd stays the GPU loop in crowd.js; within ~70 m of
// the camera or a hero the nearest far instances are PROMOTED to agents here (same body, same baked clips, position /
// heading / walk phase handed over exactly, the far instance collapsed to a point), and demoted back past ~95 m when
// calm (the far instance's loop parameters are rewritten so it continues from where the agent is — no pop).
//
// Agents keep to their block's sidewalk band (0.8-4.4 m inside the curb: never a wall, the road or the water), walk
// FORWARD (heading = velocity direction, walk phase from distance travelled: no moonwalk, no slide), pause at corners
// ("waiting at the crossing"), steer around each other (predictive + separation), street furniture (lamp posts, trees,
// hydrants, bins, benches, subway entrances) and heroes, and react:
//   hard landing (Iron Man / Hulkbuster)   knocked down or staggered near the impact, startled + flee further out
//   gunfire / explosions / repulsor hits    panic: cower (cover) or run, screams (enemy voice pack, pitched up, no words)
//   Spider-Man walking by                   stop, face him, raise an arm (photo / point stand-in)
//   a hero running into them                shove: stumble or knockdown
// Budget: <= 1.5 ms CPU per frame for <= 200 agents (stats.cpuMs).
import * as THREE from 'three';

const CAP = 200, R_IN = 70, R_OUT = 95, SCAN = 0.2;
const LANE_MIN = 0.8, LANE_MAX = 4.4, STRIDE_WALK = 1.42, STRIDE_RUN = 3.2;
const PROP_R = { tree_street: 0.5, tree_park: 0.7, street_lamp: 0.3, park_lamp: 0.25, traffic_signal: 0.3, hydrant: 0.3, trash_bin: 0.45, bench: 1.0, subway_entrance: 2.7 };
const TAU = Math.PI * 2;
const rnd = Math.random;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mod = (a, b) => a - b * Math.floor(a / b);

// ---------------------------------------------------------------------------------------------- sidewalk paths
// rect: {mode:1, cx, cz, hx0, hz0} (block curb rectangle; loop order N(+x) E(+z) S(-x) W(-z) = the GPU loop's)
// seg:  {mode:0, ax, az, dx, dz, nx, nz, L} (one edge of a non-rectangular block, nIn towards the block)
function pathOf(it) {
  const s = it.seg;
  if (it.mode) return { mode: 1, cx: s[0], cz: s[1], hx0: s[2], hz0: s[3] };
  const L = Math.max(Math.hypot(s[2] - s[0], s[3] - s[1]), 1e-3), dx = (s[2] - s[0]) / L, dz = (s[3] - s[1]) / L;
  let nx = -dz, nz = dx; if ((s[4] - s[0]) * nx + (s[5] - s[1]) * nz < 0) { nx = -nx; nz = -nz; }
  return { mode: 0, ax: s[0], az: s[1], dx, dz, nx, nz, L };
}
const EDGE_T = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function rectEdge(P, lx, lz) {           // nearest curb edge + distance to it
  const d = [lz + P.hz0, P.hx0 - lx, P.hz0 - lz, lx + P.hx0];
  let e = 0; for (let k = 1; k < 4; k++) if (d[k] < d[e]) e = k;
  return [e, d[e]];
}
function rectS(P, lx, lz, lane) {        // perimeter parameter of a point, measured on the loop `lane` m inside the curb
  const hx = P.hx0 - lane, hz = P.hz0 - lane, [e] = rectEdge(P, lx, lz);
  if (e === 0) return clamp(lx, -hx, hx) + hx;
  if (e === 1) return 2 * hx + clamp(lz, -hz, hz) + hz;
  if (e === 2) return 2 * hx + 2 * hz + hx - clamp(lx, -hx, hx);
  return 4 * hx + 2 * hz + hz - clamp(lz, -hz, hz);
}
function rectPoint(P, s, lane, out) {
  const hx = P.hx0 - lane, hz = P.hz0 - lane, Pm = 4 * (hx + hz); let q = mod(s, Pm);
  if (q < 2 * hx) { out[0] = -hx + q; out[1] = -hz; }
  else if (q < 2 * (hx + hz)) { q -= 2 * hx; out[0] = hx; out[1] = -hz + q; }
  else if (q < 4 * hx + 2 * hz) { q -= 2 * (hx + hz); out[0] = hx - q; out[1] = hz; }
  else { q -= 4 * hx + 2 * hz; out[0] = -hx; out[1] = hz - q; }
  out[0] += P.cx; out[1] += P.cz; return out;
}
/** keep a point on the sidewalk band of its path; returns the lane (distance from the curb) */
function clampToWalk(P, a) {
  if (P.mode) {
    let lx = a.x - P.cx, lz = a.z - P.cz;
    const ox = P.hx0 - LANE_MIN, oz = P.hz0 - LANE_MIN, ix = P.hx0 - LANE_MAX, iz = P.hz0 - LANE_MAX;
    lx = clamp(lx, -ox, ox); lz = clamp(lz, -oz, oz);
    if (Math.abs(lx) < ix && Math.abs(lz) < iz) {          // inside the lot (buildings): out to the nearest band edge
      if (ix - Math.abs(lx) < iz - Math.abs(lz)) lx = Math.sign(lx || 1) * ix; else lz = Math.sign(lz || 1) * iz;
    }
    a.x = P.cx + lx; a.z = P.cz + lz;
    return rectEdge(P, lx, lz)[1];
  }
  const rx = a.x - P.ax, rz = a.z - P.az;
  const al = clamp(rx * P.dx + rz * P.dz, 0, P.L), la = clamp(rx * P.nx + rz * P.nz, LANE_MIN, LANE_MAX);
  a.x = P.ax + P.dx * al + P.nx * la; a.z = P.az + P.dz * al + P.nz * la;
  return la;
}

// ---------------------------------------------------------------------------------------------- the agents
export class NearCrowd {
  constructor(crowd) {
    this.crowd = crowd;
    this.agents = []; this.byKey = new Map(); this.free = [];
    for (let i = 0; i < CAP; i++) this.free.push(this.newAgent());
    this.scanT = 0; this.t = 0;
    this.grid = new Map(); this.props = null;
    this.events = []; this.screamT = 0;
    this.stats = { cpuMs: 0, cpuMax: 0, agents: 0, promoted: 0, demoted: 0, reacted: 0 };
    this.meshes = crowd.bodies.map((L, bi) => this.makeMesh(L[0], bi));
    for (const m of this.meshes) crowd.group.add(m);
    this.lastReaction = null;
    this.hookEvents();
  }

  newAgent() {
    return { active: false, x: 0, z: 0, vx: 0, vz: 0, hd: 0, path: null, dir: 1, lane: 2, laneWant: 2, speedWant: 1.3, cruise: 1.3,
      state: 'walk', stT: 0, stDur: 0, idleKind: false, phaseW: 0, phaseR: 0, a: { id: 'walk', t: 0 }, b: { id: 'walk', t: 0 }, w: 0,
      kx: 0, kz: 0, threatX: 0, threatZ: 0, react: null, reactT: 0, cool: 0, edge: -1, body: 0, scale: 1, c0: [0, 0, 0, 0], c1: [0, 0, 0, 0],
      chunk: null, idx: -1, key: '', watchX: 0, watchZ: 0, flags: 0 };
  }

  makeMesh(B, bi) {
    const g = B.geo.clone();
    const A = n => new THREE.InstancedBufferAttribute(new Float32Array(CAP * n), n).setUsage(THREE.DynamicDrawUsage);
    this['attrs' + bi] = { aPos: A(4), aAnA: A(4), aAnB: A(4), aC0: A(4), aC1: A(4) };
    for (const [k, v] of Object.entries(this['attrs' + bi])) g.setAttribute(k, v);
    const M = this.crowd.material(B, true);
    const im = new THREE.InstancedMesh(g, M.mat, CAP);
    im.customDepthMaterial = M.depth;
    im.name = 'crowd_near_' + B.name; im.count = 0; im.frustumCulled = false; im.layers.set(1);
    im.receiveShadow = true; im.castShadow = false;
    im.userData.collider = 'crowd (people are not solid)'; im.userData.noCollide = true;
    im.userData.rows = B.rows;
    return im;
  }

  // -------------------------------------------------------------------------------------------- events
  hookEvents() {
    const MZ = globalThis.MZ; if (!MZ) return;
    this.MZ = MZ;
    this._off = MZ.on?.('game:event', e => this.onGameEvent(e));
    // enemy gunfire / explosions have no game events: listen to their sounds (positional)
    const au = MZ.audio;
    if (au && !au.__crowdHooked) {
      const play = au.play.bind(au);
      au.play = (id, o = {}) => {
        try {
          if (o.at && /^en_(pistol_shot|rifle_shot|explosion|rpg_launch|ground_pound)/.test(id)) {
            const p = o.at.isObject3D ? o.at.getWorldPosition(new THREE.Vector3()) : o.at;
            globalThis.MZ?.crowdAlarm?.(p, /explosion|ground_pound/.test(id) ? 'explosion' : 'shots');
          }
        } catch { }
        return play(id, o);
      };
      au.__crowdHooked = true;
    }
    MZ.crowdAlarm = (p, kind = 'shots') => this.alarm(p.x, p.z, kind);
  }
  playerOf(e) { const G = this.MZ?.game; return e.from != null ? G?.players?.get(e.from) : G?.local; }
  onGameEvent(e) {
    const pl = this.playerOf(e), at = pl?.root?.position;
    if (e.kind === 'land' && at) {
      const heavy = pl.suit === 'hulkbuster' ? 1.7 : pl.hero === 'ironman' ? 1.0 : 0.55;
      const s = clamp(((e.speed || 0) - 6) / 24, 0, 1.6) * heavy;
      if (s > 0.08) this.impact(at.x, at.z, s);
    } else if (e.kind === 'shot') {
      if (e.web) return;
      const to = e.to; if (at) this.alarm(at.x, at.z, 'shots');
      if (to) this.alarm(to[0], to[2], 'shots');
    } else if (e.kind === 'hit' && e.at) this.alarm(e.at[0], e.at[2], e.big ? 'explosion' : 'shots');
  }
  /** a hard landing: knockdown close in, stagger around, startle + flee further out */
  impact(x, z, s) {
    const Rk = 2.5 + 4 * s, Rs = 5 + 7 * s, Rf = 12 + 26 * s, now = this.t;
    this.lastImpact = { x, z, s, t: now };
    for (const a of this.agents) {
      const d = Math.hypot(a.x - x, a.z - z); if (d > Rf) continue;
      const delay = Math.min(0.42, 0.05 + d / 70 + rnd() * 0.07);
      const kind = d < Rk ? 'knock' : d < Rs ? 'stagger' : (s > 1.1 && rnd() < 0.3 ? 'cower' : 'alert');
      this.schedule(a, kind, x, z, now + delay, Math.max(0, 1 - d / Rs) * (3 + 3 * s));
    }
  }
  alarm(x, z, kind) {
    const R = kind === 'explosion' ? 60 : 38, now = this.t;
    for (const a of this.agents) {
      const d = Math.hypot(a.x - x, a.z - z); if (d > R) continue;
      if (a.state === 'flee' || a.state === 'knock' || a.state === 'getup' || a.state === 'cower') { a.threatX = x; a.threatZ = z; a.stDur = Math.max(a.stDur, a.stT + 6); continue; }
      const kindA = kind === 'explosion' && d < 7 ? 'knock' : rnd() < (kind === 'explosion' ? 0.35 : 0.45) ? 'cower' : 'alert';
      this.schedule(a, kindA, x, z, now + Math.min(0.45, 0.08 + d / 90 + rnd() * 0.12), kind === 'explosion' ? Math.max(0, 1 - d / 12) * 5 : 0);
    }
  }
  schedule(a, kind, x, z, at, push) {
    const pri = { alert: 1, cower: 2, stagger: 3, knock: 4 };
    if (a.react && pri[a.react.kind] >= pri[kind]) return;
    a.react = { kind, x, z, at, push };
  }
  scream(a, kind) {
    const MZ = this.MZ; if (!MZ?.audio || this.t < this.screamT) return;
    this.screamT = this.t + 0.12 + rnd() * 0.1;
    const id = kind === 'pain' ? 'en_pain' : kind === 'grunt' ? 'en_grunt' : 'en_alert';
    try { MZ.audio.play(id, { at: new THREE.Vector3(a.x, 1.6, a.z), rate: 1.22 + rnd() * 0.3, gain: 0.55 }); } catch { }
  }

  // -------------------------------------------------------------------------------------------- promotion
  focus(camera) {
    const f = [camera.position];
    for (const pl of this.MZ?.game?.players?.values?.() || []) if (pl.root) f.push(pl.root.position);
    return f;
  }
  scan(camera, t) {
    const C = this.crowd, F = this.focus(camera), cand = [];
    for (let ci = 0; ci < C.chunks.length; ci++) {
      const c = C.chunks[ci];
      let near = false; for (const p of F) if (Math.hypot(c.center.x - p.x, p.y, c.center.z - p.z) - c.radius < R_IN) { near = true; break; }
      if (!near) continue;
      for (let i = 0; i < c.n; i++) {
        const key = ci * 100000 + i; if (this.byKey.has(key)) continue;
        let dmin = 1e9; const po = C.poseOf(c, i, t);
        for (const p of F) dmin = Math.min(dmin, Math.hypot(po.x - p.x, p.y, po.z - p.z));
        if (dmin < R_IN) cand.push([dmin, ci, i, po]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [d, ci, i, po] of cand) {
      if (!this.free.length) {                                   // full: give up the farthest calm agent if this one is closer
        let far = null, fd = 0;
        for (const a of this.agents) { if (!this.calm(a)) continue; const ad = this.minDist(a, F); if (ad > fd) { fd = ad; far = a; } }
        if (!far || fd < d + 10) break;
        this.demote(far, t);
      }
      this.promote(ci, i, po, t);
    }
    for (const a of [...this.agents]) if (this.calm(a) && this.minDist(a, F) > R_OUT) this.demote(a, t);
  }
  minDist(a, F) { let d = 1e9; for (const p of F) d = Math.min(d, Math.hypot(a.x - p.x, p.y, a.z - p.z)); return d; }
  calm(a) { return (a.state === 'walk' || a.state === 'idle' || a.state === 'pause') && !a.react; }
  promote(ci, i, po, t) {
    const C = this.crowd, c = C.chunks[ci], a = this.free.pop(), it = c.items[i];
    a.active = true; a.chunk = c; a.idx = i; a.key = ci * 100000 + i; a.body = c.bi;
    a.path = pathOf(it); a.x = po.x; a.z = po.z; a.hd = po.hd; a.scale = po.scale; a.lane = a.laneWant = po.lane;
    const sp = Math.abs(po.sp);
    a.idleKind = sp < 0.01; a.cruise = a.speedWant = a.idleKind ? 0 : sp;
    a.vx = po.tx * a.cruise; a.vz = po.tz * a.cruise;
    a.dir = it.mode ? (po.sp < 0 ? -1 : 1) : 1;
    if (!it.mode && !a.idleKind) {                              // ping-pong: dir from the tangent vs the edge direction
      a.dir = po.tx * a.path.dx + po.tz * a.path.dz >= 0 ? 1 : -1;
    }
    a.state = a.idleKind ? 'idle' : 'walk'; a.stT = 0; a.stDur = 0; a.react = null; a.cool = 1 + rnd() * 2; a.edge = -1;
    a.phaseW = a.idleKind ? 0 : po.phase; a.phaseR = 0;
    a.a.id = a.idleKind ? 'idle' : 'walk'; a.a.t = a.idleKind ? po.phase : po.phase; a.w = 0; a.b.id = a.a.id; a.b.t = a.a.t;
    for (let k = 0; k < 4; k++) { a.c0[k] = c.c0[i * 4 + k]; a.c1[k] = c.c1[i * 4 + k]; }
    C.setInstance(c, i, [null, null, 0, null]);                   // collapse the far instance
    this.byKey.set(a.key, a); this.agents.push(a); this.stats.promoted++;
  }
  demote(a, t) {
    const C = this.crowd, c = a.chunk, i = a.idx, P = a.path;
    const walking = a.state === 'walk' && a.cruise > 0.2;
    const lane = clamp(a.lane, LANE_MIN, LANE_MAX);
    let u0, sp;
    if (P.mode) {
      const s = rectS(P, a.x - P.cx, a.z - P.cz, lane);
      sp = walking ? a.dir * a.cruise : 0; u0 = s - sp * t;
    } else {
      const al = clamp((a.x - P.ax) * P.dx + (a.z - P.az) * P.dz, 0, P.L);
      const s = a.dir > 0 ? al : 2 * P.L - al;
      sp = walking ? a.cruise : 0; u0 = s - sp * t;
    }
    const ph = walking ? mod(a.phaseW - Math.abs(sp) * t / STRIDE_WALK, 1) : 0.75;
    const W = Math.min(0.999, ph) + (P.mode ? 10 : 0) + Math.round(lane * 10) * 100;
    C.setInstance(c, i, [u0, sp, a.scale, W]);
    a.active = false; this.byKey.delete(a.key);
    this.agents.splice(this.agents.indexOf(a), 1); this.free.push(a); this.stats.demoted++;
  }

  // -------------------------------------------------------------------------------------------- static obstacles
  buildProps() {
    const W = this.MZ?.game?.world; const list = W?.propInstances; if (!list) return;
    const g = new Map(), v = new THREE.Vector3();
    for (const e of list) {
      const r = PROP_R[e.kind]; if (!r) continue;
      v.setFromMatrixPosition(e.m);
      const k = Math.floor(v.x / 4) + ',' + Math.floor(v.z / 4);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push([v.x, v.z, r]);
    }
    this.props = g;
  }
  propsNear(x, z, fn) {
    if (!this.props) return;
    const gx = Math.floor(x / 4), gz = Math.floor(z / 4);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const L = this.props.get((gx + i) + ',' + (gz + j)); if (L) for (const p of L) fn(p); }
  }

  // -------------------------------------------------------------------------------------------- per frame
  update(dt, camera) {
    const t0 = performance.now();
    dt = Math.min(dt, 0.05); this.t += dt;
    if (!this.props && this.MZ?.game?.world?.propInstances) this.buildProps();
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = SCAN; this.scan(camera, this.crowd.timeNow()); }
    const heroes = [];
    for (const pl of this.MZ?.game?.players?.values?.() || []) {
      if (!pl.root) continue; const p = pl.root.position;
      const prev = pl.__crowdPrev || (pl.__crowdPrev = p.clone());
      const vx = (p.x - prev.x) / Math.max(dt, 1e-3), vz = (p.z - prev.z) / Math.max(dt, 1e-3), vy = (p.y - prev.y) / Math.max(dt, 1e-3);
      prev.copy(p);
      heroes.push({ x: p.x, y: p.y, z: p.z, vx, vz, vy, sp: Math.hypot(vx, vz), spider: pl.hero === 'spiderman', pl });
    }
    // neighbour grid (3 m)
    const G = this.grid; G.clear();
    for (const a of this.agents) { const k = Math.floor(a.x / 3) * 4096 + Math.floor(a.z / 3); let L = G.get(k); if (!L) G.set(k, L = []); L.push(a); }
    for (const a of this.agents) this.step(a, dt, heroes);
    this.writeInstances();
    const ms = performance.now() - t0, S = this.stats;
    S.cpuMs = S.cpuMs ? S.cpuMs * 0.95 + ms * 0.05 : ms; S.cpuMax = Math.max(S.cpuMax * 0.999, ms); S.agents = this.agents.length;
  }

  setState(a, st, dur = 0) { a.state = st; a.stT = 0; a.stDur = dur; }
  play(a, id, t0 = 0) { if (a.a.id === id) return; a.b.id = a.a.id; a.b.t = a.a.t; a.a.id = id; a.a.t = t0; a.w = 1; }

  step(a, dt, heroes) {
    a.stT += dt; a.cool -= dt;
    // ---- pending reaction
    if (a.react && this.t >= a.react.at) {
      const r = a.react; a.react = null; a.threatX = r.x; a.threatZ = r.z;
      const dx = a.x - r.x, dz = a.z - r.z, d = Math.hypot(dx, dz) || 1;
      a.reactedAt = this.t; this.stats.reacted++; this.lastReaction = this.t;
      if (r.kind === 'knock') { this.setState(a, 'knock', 1.25); this.play(a, 'knock'); a.kx = dx / d * (2 + r.push); a.kz = dz / d * (2 + r.push); a.hd = Math.atan2(-dx, -dz); this.scream(a, 'pain'); }
      else if (r.kind === 'stagger') { this.setState(a, 'stagger', 1.3); this.play(a, 'stagger'); a.kx = dx / d * (1 + r.push * 0.4); a.kz = dz / d * (1 + r.push * 0.4); a.hd = Math.atan2(-dx, -dz); this.scream(a, 'grunt'); }
      else if (r.kind === 'cower') { this.setState(a, 'cower', 2 + rnd() * 2.5); this.play(a, 'coverIn'); a.hd = Math.atan2(-dx, -dz); this.scream(a, 'alert'); }
      else { this.setState(a, 'alert', 0.35 + rnd() * 0.3); this.play(a, 'alert'); a.hd = Math.atan2(-dx, -dz); if (rnd() < 0.5) this.scream(a, 'alert'); }
      a.vx = a.vz = 0;
    }
    // ---- heroes: bump / Spider-Man sighting
    for (const h of heroes) {
      const dx = a.x - h.x, dz = a.z - h.z, d = Math.hypot(dx, dz), dy = h.y - 0.15;
      if (d < 0.9 && dy < 2.2 && h.sp > 4.5 && a.state !== 'knock' && a.state !== 'getup') {
        const k = h.sp > 9 ? 'knock' : 'stagger';
        a.react = { kind: k, x: h.x, z: h.z, at: this.t, push: Math.min(6, h.sp * 0.4) };
      } else if (h.spider && d < 7 && d > 1.2 && h.sp < 3 && dy < 3 && a.cool <= 0 && this.calm(a) && rnd() < 0.5 * dt * 4) {
        this.setState(a, 'watch', 3 + rnd() * 2); a.watchX = h.x; a.watchZ = h.z; a.cool = 12 + rnd() * 10;
      }
    }
    // ---- behaviour
    const P = a.path;
    let want = 0, tx = 0, tz = 0, face = null;
    switch (a.state) {
      case 'walk': {
        want = a.cruise;
        [tx, tz] = this.target(a, 3.0);
        // corners: sometimes wait "at the crossing"
        if (P.mode) {
          const [e] = rectEdge(P, a.x - P.cx, a.z - P.cz);
          // waiting to cross the street straight ahead (the direction of the edge just walked)
          if (a.edge >= 0 && e !== a.edge && rnd() < 0.3) { this.setState(a, 'pause', 1.5 + rnd() * 3); a.pauseHd = Math.atan2(EDGE_T[a.edge][0] * a.dir, EDGE_T[a.edge][1] * a.dir); }
          a.edge = e;
        } else {
          const al = (a.x - P.ax) * P.dx + (a.z - P.az) * P.dz;
          if ((a.dir > 0 && al > P.L - 1.2) || (a.dir < 0 && al < 1.2)) { a.dir = -a.dir; this.setState(a, 'pause', 0.8 + rnd() * 1.5); }
        }
        break;
      }
      case 'pause': case 'idle': {
        want = 0;
        if (a.state === 'pause') face = a.pauseHd;
        if (a.state === 'idle' && a.stT > 6 && rnd() < dt * 0.1) this.play(a, a.a.id === 'look' ? 'idle' : 'look');
        if (a.state === 'pause' && a.stT > a.stDur) this.setState(a, 'walk');
        break;
      }
      case 'watch': {
        want = 0; face = Math.atan2(a.watchX - a.x, a.watchZ - a.z);
        if (a.stT > 0.4 && a.a.id !== 'photo') this.play(a, 'photo');
        if (a.stT > a.stDur) this.setState(a, a.idleKind ? 'idle' : 'walk');
        break;
      }
      case 'alert': case 'stagger': {
        want = 0;
        if (a.stT > a.stDur) this.startFlee(a);
        break;
      }
      case 'knock': {
        want = 0;
        if (a.stT > a.stDur) { this.setState(a, 'getup', 2.2); this.play(a, 'getup'); }
        break;
      }
      case 'getup': { want = 0; if (a.stT > a.stDur) this.startFlee(a); break; }
      case 'cower': {
        want = 0;
        if (a.a.id === 'coverIn' && a.a.t > 0.75) this.play(a, 'cover');
        if (a.stT > a.stDur) this.startFlee(a);
        break;
      }
      case 'flee': {
        want = a.speedWant;
        [tx, tz] = this.target(a, 4.0);
        const d = Math.hypot(a.x - a.threatX, a.z - a.threatZ);
        if (a.stT > a.stDur && d > 40) { a.speedWant = a.cruise || 1.3; if (!a.cruise) a.cruise = 1.3; a.idleKind = false; this.setState(a, 'walk'); }
        break;
      }
    }
    // ---- steering
    let dvx = 0, dvz = 0;
    if (want > 0) {
      let ex = tx - a.x, ez = tz - a.z; const el = Math.hypot(ex, ez) || 1; dvx = ex / el * want; dvz = ez / el * want;
      // predictive avoidance + separation (agents)
      const gx = Math.floor(a.x / 3), gz = Math.floor(a.z / 3);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const L = this.grid.get((gx + i) * 4096 + gz + j); if (!L) continue;
        for (const b of L) {
          if (b === a) continue;
          const rx = b.x - a.x, rz = b.z - a.z, d = Math.hypot(rx, rz); if (d > 5 || d < 1e-4) continue;
          if (d < 0.75) { const k = (0.75 - d) / 0.75 * 2.5; dvx -= rx / d * k; dvz -= rz / d * k; }
          const ux = b.vx - a.vx, uz = b.vz - a.vz, uu = ux * ux + uz * uz;
          if (uu > 1e-3) {
            const tc = -(rx * ux + rz * uz) / uu;
            if (tc > 0 && tc < 2.5) {
              const cx = rx + ux * tc, cz = rz + uz * tc, cd = Math.hypot(cx, cz);
              if (cd < 0.85) { const k = (0.85 - cd) / 0.85 * want * 0.9 / (1 + tc); const sx = cd > 1e-3 ? -cx / cd : -dvz / want, sz = cd > 1e-3 ? -cz / cd : dvx / want; dvx += sx * k; dvz += sz * k; }
            }
          }
        }
      }
      // street furniture
      this.propsNear(a.x, a.z, p => {
        const rx = p[0] - a.x, rz = p[1] - a.z, d = Math.hypot(rx, rz), R = p[2] + 0.45;
        if (d < R + 1.8 && d > 1e-4) {
          const ahead = (rx * dvx + rz * dvz) / want;
          if (d < R) { const k = (R - d) / R * 3; dvx -= rx / d * k; dvz -= rz / d * k; }
          else if (ahead > 0) {                       // lookahead: slide sideways past it
            const px = dvz / want, pz = -dvx / want, lat = rx * px + rz * pz;
            if (Math.abs(lat) < R) { const k = (R - Math.abs(lat)) / R * want * (1 - ahead / (R + 1.8)), sg = lat >= 0 ? -1 : 1; dvx += px * k * sg; dvz += pz * k * sg; }
          }
        }
      });
      // heroes (standing or slow): walk around them
      for (const h of heroes) {
        const rx = h.x - a.x, rz = h.z - a.z, d = Math.hypot(rx, rz); if (d > 2.5 || h.y - 0.15 > 2.5 || d < 1e-4) continue;
        const k = (2.5 - d) / 2.5 * want * 1.5; dvx -= rx / d * k; dvz -= rz / d * k;
      }
      const dl = Math.hypot(dvx, dvz), mx = want * 1.25; if (dl > mx) { dvx *= mx / dl; dvz *= mx / dl; }
    }
    // knockback (decays), else accelerate towards the desired velocity (smooth: velocity turns, heading follows it)
    const acc = a.state === 'flee' ? 6 : 3.2;
    a.vx += (dvx - a.vx) * Math.min(1, acc * dt); a.vz += (dvz - a.vz) * Math.min(1, acc * dt);
    let mx = a.vx * dt + a.kx * dt, mz = a.vz * dt + a.kz * dt;
    a.kx *= Math.exp(-dt * 3.5); a.kz *= Math.exp(-dt * 3.5);
    a.x += mx; a.z += mz;
    a.lane = clampToWalk(P, a);
    const sp = Math.hypot(a.vx, a.vz);
    if (face != null) a.hd = lerpAngle(a.hd, face, Math.min(1, dt * 5));
    else if (sp > 0.25 && (a.state === 'walk' || a.state === 'flee')) a.hd = Math.atan2(a.vx, a.vz);
    // ---- gait
    if (a.state === 'walk' || a.state === 'flee' || a.state === 'pause' || a.state === 'idle') {
      if (sp > 2.6) { a.phaseR = mod(a.phaseR + sp * dt / STRIDE_RUN, 1); this.play(a, 'run', a.phaseR); a.a.t = a.phaseR; }
      else if (sp > 0.2) { a.phaseW = mod(a.phaseW + sp * dt / STRIDE_WALK, 1); if (a.a.id !== 'walk') this.play(a, 'walk', a.phaseW); a.a.t = a.phaseW; }
      else if (a.a.id === 'walk' || a.a.id === 'run') this.play(a, 'idle', rnd());
    }
    // one-shot / looping clip clocks
    const rows = this.meshes[a.body].userData.rows;
    for (const s of [a.a, a.b]) {
      if (s.id === 'walk' || s.id === 'run') continue;
      const r = rows[s.id]; if (!r) continue;
      s.t += dt / r.dur; if (r.loop) s.t = mod(s.t, 1); else s.t = Math.min(s.t, 1);
    }
    a.w = Math.max(0, a.w - dt / 0.22);
  }

  startFlee(a) {
    a.cruise = a.cruise || 1.3; a.speedWant = 4.4 + rnd() * 1.6;
    // run along the sidewalk AWAY from the threat
    const [ax, az] = this.target(a, 3, 1), [bx, bz] = this.target(a, 3, -1);
    const da = Math.hypot(ax - a.threatX, az - a.threatZ), db = Math.hypot(bx - a.threatX, bz - a.threatZ);
    a.dir = da >= db ? a.dir : -a.dir;
    a.laneWant = LANE_MIN + 1 + rnd() * 2;
    this.setState(a, 'flee', 6 + rnd() * 6);
  }

  /** a point `look` metres ahead along the agent's sidewalk (optionally in direction `dirOverride`) */
  target(a, look, dirOverride = 0) {
    const P = a.path, dir = dirOverride || a.dir, o = this._o || (this._o = [0, 0]);
    if (P.mode) {
      const lane = clamp(a.laneWant, LANE_MIN + 0.2, LANE_MAX - 0.2);
      const s = rectS(P, a.x - P.cx, a.z - P.cz, lane);
      rectPoint(P, s + dir * look, lane, o);
      return [o[0], o[1]];
    }
    const al = clamp((a.x - P.ax) * P.dx + (a.z - P.az) * P.dz + dir * look, 0, P.L), la = clamp(a.laneWant, LANE_MIN + 0.2, LANE_MAX - 0.2);
    return [P.ax + P.dx * al + P.nx * la, P.az + P.dz * al + P.nz * la];
  }

  writeInstances() {
    for (let bi = 0; bi < this.meshes.length; bi++) {
      const im = this.meshes[bi], A = this['attrs' + bi], rows = im.userData.rows;
      let n = 0;
      const pos = A.aPos.array, an = A.aAnA.array, bn = A.aAnB.array, c0 = A.aC0.array, c1 = A.aC1.array;
      for (const a of this.agents) {
        if (a.body !== bi) continue;
        const o = n * 4;
        pos[o] = a.x; pos[o + 1] = 0.15; pos[o + 2] = a.z; pos[o + 3] = a.hd;
        sample(rows[a.a.id] || rows.idle, a.a.t, an, o);
        sample(rows[a.b.id] || rows.idle, a.b.t, bn, o);
        an[o + 3] = a.w; bn[o + 3] = a.scale;
        for (let k = 0; k < 4; k++) { c0[o + k] = a.c0[k]; c1[o + k] = a.c1[k]; }
        n++;
      }
      im.count = n;
      for (const k in A) A[k].needsUpdate = true;
    }
  }

  dispose() { this._off?.(); }
}

function sample(r, t, arr, o) {
  const f = r.loop ? mod(t, 1) * r.count : clamp(t, 0, 1) * (r.count - 1);
  const f0 = Math.floor(f), k = f - f0;
  const f1 = r.loop ? (f0 + 1) % r.count : Math.min(f0 + 1, r.count - 1);
  arr[o] = r.row0 + f0; arr[o + 1] = r.row0 + f1; arr[o + 2] = k;
}
function lerpAngle(a, b, k) { let d = mod(b - a + Math.PI, TAU) - Math.PI; return a + d * k; }
