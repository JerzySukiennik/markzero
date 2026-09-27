// Remote-player interpolation for both heroes (Hero.applyState → NetSmoother; IronMan/SpiderMan read
// sample() every frame). Jurek: "will internet multiplayer be smooth?" — the relay (Firebase RTDB) delivers
// state at ~15 Hz with 50–300 ms jitter and the odd lost packet; an exponential follow turned that into
// rubber-banding and pose pops.
//
//   snapshots   {t: sender clock ms, p, q, v, s} — t is stamped by the sender (server-corrected clock when
//               the transport has one), so it has no network jitter in it
//   offset      estimate of (local clock − sender clock): the running MINIMUM of (arrival − t) (= the
//               fastest packet), creeping up slowly so clock drift / route changes are followed
//   delay       render time = now − offset − delay; delay adapts to the measured jitter (p90 of the
//               arrival lateness) within [DELAY_MIN, DELAY_MAX]
//   sample      Hermite on position with the sent velocities, slerp on rotation, lerp on every numeric
//               field of the state (animation parameters: thrust, bank, ground speed, clip phase…);
//               discrete fields (flags, clip names) from the earlier snapshot
//   late        no newer snapshot: extrapolate along the velocity ≤ EXTRAP s, then hold; when data
//               resumes, the jump is absorbed by a correction offset that decays (no pop)
//   teleport    s.tp counter changed, or an impossible jump → the buffer is reset and the body snaps
import * as THREE from 'three';

const DELAY_MIN = 100, DELAY_MAX = 300, EXTRAP = 0.25, KEEP = 40;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class NetSmoother {
  constructor() {
    this.buf = []; this.offset = null; this.delay = 150; this.late = []; this.lastTp = null;
    this.p = new THREE.Vector3(); this.v = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.s = null; this.f = {};
    this.corr = new THREE.Vector3(); this.has = false; this.snapped = false; this.stats = { recv: 0, late: 0, extrap: 0, snaps: 0, delay: 150 };
  }
  push(s, now = performance.now()) {
    if (!s?.p) return;
    const t = typeof s.t === 'number' ? s.t : now;                 // old senders without a stamp: arrival time
    const lag = now - t;
    // offset: fastest packet wins at once, otherwise creep up 2 ms/s so drift is followed
    if (this.offset === null || lag < this.offset) this.offset = lag;
    else this.offset += Math.min(lag - this.offset, 0.002 * (now - (this._lastPush || now)));
    this._lastPush = now;
    this.late.push(lag - this.offset); if (this.late.length > 60) this.late.shift();
    const sorted = [...this.late].sort((x, y) => x - y), p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
    this.delay = Math.max(DELAY_MIN, Math.min(DELAY_MAX, 50 + p90 * 1.15));
    this.stats.delay = Math.round(this.delay); this.stats.recv++;
    const snap = { t, p: new THREE.Vector3().fromArray(s.p), q: new THREE.Quaternion().fromArray(s.q || [0, 0, 0, 1]), v: new THREE.Vector3().fromArray(s.v || [0, 0, 0]), s };
    const last = this.buf[this.buf.length - 1];
    if (last && t <= last.t) { this.stats.late++; return; }         // out of order / duplicate
    const tp = s.tp ?? null, jump = last ? snap.p.distanceTo(last.p) : 0, dt = last ? (t - last.t) / 1000 : 0;
    if ((this.lastTp !== null && tp !== this.lastTp) || (last && jump > Math.max(60, (last.v.length() + snap.v.length()) * dt * 2 + 25))) {
      this.buf.length = 0; this.corr.set(0, 0, 0); this.snapped = true; this.stats.snaps++;
    }
    this.lastTp = tp;
    this.buf.push(snap); if (this.buf.length > KEEP) this.buf.shift();
  }
  /** Where to draw the remote hero now. Returns false until the first snapshot. */
  sample(now = performance.now(), dt = 1 / 60) {
    const B = this.buf; if (!B.length || this.offset === null) return false;
    // THE RENDER CLOCK NEVER JUMPS: the target (now − offset − delay) moves whenever the delay adapts or a
    // faster packet lowers the offset; stepping to it yanked the hero back in time. It is followed by
    // playing ±10 % faster/slower instead (a big mismatch > 1 s, e.g. after a stall, re-syncs at once).
    const target = now - this.offset - this.delay;
    if (this.rt === undefined || Math.abs(target - this.rt) > 1000) this.rt = target;
    else { const step = dt * 1000, err = target - (this.rt + step); this.rt += step * (1 + Math.max(-0.1, Math.min(0.1, err / 500))); }
    const rt = this.rt;
    const prevP = this.has ? _b.copy(this.p) : null;
    let a = null, b = null;
    for (let i = B.length - 1; i >= 0; i--) if (B[i].t <= rt) { a = B[i]; b = B[i + 1] || null; break; }
    if (!a) { a = B[0]; b = null; }                                 // older than the buffer: hold the oldest
    if (a && b) {
      const T = (b.t - a.t) / 1000, u = Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t)));
      hermite(this.p, a.p, a.v, b.p, b.v, T, u);
      this.v.copy(a.v).lerp(b.v, u); this.q.copy(a.q).slerp(b.q, u);
      this.f = lerpFields(a.s, b.s, u); this.s = u < 0.5 ? a.s : b.s;
    } else {
      // extrapolate along the velocity, easing to a stop at EXTRAP (never a dead stop in one frame)
      const raw = Math.max(0, (rt - a.t) / 1000), late = raw >= EXTRAP * 2 ? EXTRAP * 1.5 : raw <= EXTRAP ? raw : EXTRAP + (raw - EXTRAP) * (1 - (raw - EXTRAP) / (EXTRAP * 2));
      if (raw > 0) this.stats.extrap++;
      this.p.copy(a.p).addScaledVector(a.v, late); this.v.copy(a.v).multiplyScalar(raw <= EXTRAP ? 1 : Math.max(0, 1 - (raw - EXTRAP) / EXTRAP));
      this.q.copy(a.q); this.f = lerpFields(a.s, a.s, 0); this.s = a.s;
    }
    // leaving extrapolation (late data arrived): the difference between where he was drawn and the new
    // interpolated point becomes an offset that decays over ~0.2 s — no pop
    const extrapNow = !(a && b);
    // continuity breaks when extrapolation ends OR its source snapshot changes (a late packet older than
    // the render time arrived): carry the difference as a decaying offset
    if (prevP && !this.snapped && ((this.wasExtrap && !extrapNow) || (extrapNow && this.wasExtrap && a !== this.srcA))) {
      const err = _a.copy(prevP).addScaledVector(this.v, dt).sub(this.p).sub(this.corr);
      if (err.length() < 30) this.corr.add(err);
    }
    this.wasExtrap = extrapNow; this.srcA = a;
    if (this.snapped) this.corr.set(0, 0, 0);
    this.corr.multiplyScalar(Math.exp(-dt / 0.2));
    this.p.add(this.corr);
    this.snapped = false; this.has = true;
    return true;
  }
}

function hermite(out, p0, v0, p1, v1, T, u) {
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  // velocities in m/s over a T-second segment; clamp their influence so a bad velocity cannot loop the path
  const k = Math.min(T, 0.5);
  out.set(
    h00 * p0.x + h10 * v0.x * k + h01 * p1.x + h11 * v1.x * k,
    h00 * p0.y + h10 * v0.y * k + h01 * p1.y + h11 * v1.y * k,
    h00 * p0.z + h10 * v0.z * k + h01 * p1.z + h11 * v1.z * k);
  return out;
}
/** every numeric field (and numeric arrays other than p/q/v) interpolated; the rest from `a` */
function lerpFields(a, b, u) {
  const o = {};
  for (const k in a) {
    if (k === 'p' || k === 'q' || k === 'v' || k === 't') continue;
    const x = a[k], y = b?.[k];
    if (typeof x === 'number' && typeof y === 'number') o[k] = x + (y - x) * u;
    else if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && typeof x[0] === 'number') o[k] = x.map((xi, i) => xi + (y[i] - xi) * u);
    else o[k] = x;
  }
  return o;
}

/** Sender side: stamp a state with a jitter-free clock; an unchanged state returns the SAME payload (same
 * stamp), so a changes-only transport sends nothing while the hero stands still. */
export class NetStamper {
  constructor(MZ) { this.MZ = MZ; this.last = null; this.lastKey = ''; this.tp = 0; }
  clock() { const n = this.MZ.net; return typeof n?._now === 'number' ? n._now : Date.now(); }
  stamp(state) {
    const key = JSON.stringify(state);
    if (key === this.lastKey && this.last) return this.last;
    this.lastKey = key; this.last = { ...state, t: Math.round(this.clock()), tp: this.tp };
    return this.last;
  }
  teleported() { this.tp++; }
}
