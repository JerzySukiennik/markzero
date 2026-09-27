// Animator — the hero animation state machine's engine, on the NEXT clip libraries.
//
//   base      a BLEND of looping clips with target weights (a blend space: hover ↔ fly_slow ↔
//             fly_cruise ↔ fly_fast by speed, idle ↔ walk ↔ run by ground speed…). Weights ease to
//             their targets and are normalised to 1, so a transition is never a pop and never
//             drifts to the rest pose (three.js mixes a weight < 1 with the BIND pose).
//   oneShot   a full-body clip played OVER the base (takeoff, land_hero, fly_brake, boost…): its
//             weight ramps in, holds, ramps out at the end; the base keeps running underneath.
//   layers    upper-body OVERRIDE clips (aim_R, web_shoot_R…, `layer: upper` in clips.json). They
//             are evaluated by interpolant and slerped over the animated pose with their own
//             weight — exact on the joints the layer owns, untouched elsewhere.
//   protect   nodes a procedural layer writes after the clips (aim IK, flaps, trims, look-at).
//             three.js only writes a channel when its sampled value CHANGES, so on a held pose a
//             procedural offset would accumulate frame after frame; protected nodes are put back to
//             the last animated pose before the mixer runs and re-snapshotted after.
//
// Cues (`events` in clips.json) fire from the dominant base clip, one-shots and layers;
// drivers (`drv_*` Empties, position.x) are reported every frame.
import * as THREE from 'three';

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();

export class Animator {
  constructor(root, clips, metas, { onCue = null, onDriver = null, stripRoot = [] } = {}) {
    this.root = root; this.onCue = onCue; this.onDriver = onDriver;
    this.mixer = new THREE.AnimationMixer(root);
    this.meta = {};
    for (const m of [].concat(metas || [])) for (const c of (m?.clips || [])) this.meta[c.name] = c;
    this.clips = {};
    const have = new Set(); root.traverse(o => { if (o.name) have.add(o.name); });
    for (const c of clips || []) {
      let clip = c;
      // tracks for nodes this rig lacks (a library clip's drivers on Tony, flaps on a suit without
      // them) are dropped here, instead of three.js warning about each one on every bind
      if (c.tracks.some(t => !have.has(t.name.split('.')[0]))) clip = new THREE.AnimationClip(c.name, c.duration, c.tracks.filter(t => have.has(t.name.split('.')[0])));
      // root-motion clips: the game moves the body, so the travel on piv_root is dropped
      // (rotation kept) — otherwise a takeoff lifts the suit twice (clip + physics)
      if (stripRoot.includes(c.name) || (this.meta[c.name]?.root_motion && !this.meta[c.name]?.keep_root)) {
        clip = new THREE.AnimationClip(c.name, c.duration, clip.tracks.filter(t => t.name !== 'piv_root.position'));
      }
      this.clips[clip.name] = clip;
    }
    this.nodes = new Map(); root.traverse(o => { if (o.name) this.nodes.set(o.name, o); });
    this.base = new Map();      // name -> {a, w, target}
    this.shots = [];            // one-shots {name, a, w, t, dur, fadeIn, fadeOut, onEnd, prev}
    this.layers = new Map();    // name -> layer
    this._prot = new Map();     // node -> animated quaternion snapshot
    this._protP = new Map();
    this.drivers = []; root.traverse(o => { if (/^drv_/.test(o.name)) this.drivers.push(o); });
    this.rate = 8;              // base weight easing (1/s)
    this.dominant = null;
    this.alias = null;          // name -> other clip name (or null = none) for rigs with their own library
  }
  _n(name) { if (this.clips[name] || !this.alias || !(name in this.alias)) return name; return this.alias[name]; }
  has(name) { return !!this.clips[this._n(name)]; }
  duration(name) { return this.clips[name]?.duration || 0; }
  node(name) { return this.nodes.get(name); }

  _action(name) {
    const a = this.mixer.clipAction(this.clips[name]);
    a._prevT ??= -1;
    return a;
  }

  /** Target weights for the base blend, e.g. {hover: 0.3, fly_slow: 0.7}. Unlisted clips fade to 0. */
  setBase(targets, rate = this.rate) {
    this.rate = rate;
    targets = Object.entries(targets).reduce((o, [k, w]) => { const n = this._n(k); if (n) o[n] = (o[n] || 0) + w; return o; }, {});
    for (const [name, b] of this.base) if (!(name in targets)) b.target = 0;
    for (const [name, w] of Object.entries(targets)) {
      if (!this.clips[name] || w <= 0 && !this.base.has(name)) continue;
      let b = this.base.get(name);
      if (!b) {
        const a = this._action(name); a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.play(); a.setEffectiveWeight(0);
        b = { a, w: 0, target: 0 }; this.base.set(name, b);
      }
      b.target = w;
    }
  }
  /** Drive a base clip's time directly (distance-synced walk cycles): time = phase * duration. */
  setPhase(name, phase) {
    name = this._n(name);
    const b = this.base.get(name); if (!b) return;
    const d = b.a.getClip().duration; b.a.timeScale = 0; b.a.time = ((phase % 1) + 1) % 1 * d;
  }
  setSpeed(name, s) { const b = this.base.get(name); if (b) b.a.timeScale = s; }

  /** Full-body one-shot over the base. Returns the record (its .t runs 0..dur). */
  oneShot(name, o = {}) { const n = this._n(name); return n ? this._oneShot(n, o) : null; }
  _oneShot(name, { fadeIn = 0.12, fadeOut = 0.25, speed = 1, from = 0, onEnd = null, weight = 1 } = {}) {
    if (!this.clips[name]) return null;
    this.cancelShot(name, 0.05);
    const a = this._action(name);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = speed; a.time = from; a.play(); a.setEffectiveWeight(0);
    a._prevT = from - 1e-4;
    const s = { name, a, w: 0, t: from, dur: this.clips[name].duration, fadeIn, fadeOut, speed, onEnd, weight, out: 0 };
    this.shots.push(s); return s;
  }
  cancelShot(name, fade = 0.15) { for (const s of this.shots) if (!name || s.name === name) s.out = Math.max(s.out, 1e-4), s.fadeOut = fade, s.cancel = true; }
  shotPlaying(name) { name = this._n(name); return this.shots.some(s => s.name === name && !s.cancel); }

  /** Upper-body override layer at weight target (0..1). Loop clips keep running; one-shot clips
   * restart when `restart` and fade out by themselves at the end. */
  layer(name, target = 1, { restart = false, speed = 1, rate = 12, loop } = {}) {
    name = this._n(name); if (!name) return null;
    const clip = this.clips[name]; if (!clip) return null;
    let L = this.layers.get(name);
    if (!L) {
      const tracks = [];
      for (const tr of clip.tracks) {
        const [nodeName, prop] = tr.name.split('.');
        const node = this.nodes.get(nodeName); if (!node || (prop !== 'quaternion' && prop !== 'position')) continue;
        tracks.push({ node, prop, interp: tr.createInterpolant(new Float32Array(tr.getValueSize())) });
      }
      L = { name, clip, tracks, t: 0, w: 0, target: 0, speed, rate, loop: loop ?? !!this.meta[name]?.loop, prevT: -1 };
      this.layers.set(name, L);
      this.protect(tracks.map(t => t.node));
    }
    L.target = target; L.speed = speed; L.rate = rate;
    if (restart) { L.t = 0; L.prevT = -1e-4; L.done = false; }
    return L;
  }

  protect(nodes) {
    for (const n of nodes) if (n && !this._prot.has(n)) { this._prot.set(n, n.quaternion.clone()); if (n.name === 'piv_root' || n.name === 'piv_hips' || /^drv_/.test(n.name)) this._protP.set(n, n.position.clone()); }
  }

  update(dt) {
    // --- base weights: ease, normalise
    let sum = 0;
    for (const b of this.base.values()) { b.w += (b.target - b.w) * (1 - Math.exp(-dt * this.rate)); if (b.w < 1e-3 && b.target === 0) b.w = 0; sum += b.w; }
    // --- one-shots
    let shotW = 0;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]; s.t += dt * s.speed;
      let w;
      if (s.cancel) { s.out += dt / Math.max(0.02, s.fadeOut); w = s.w * Math.max(0, 1 - s.out * 3); }
      else {
        const inW = s.fadeIn > 0 ? Math.min(1, s.t / s.fadeIn) : 1;
        const outW = s.fadeOut > 0 ? Math.min(1, Math.max(0, (s.dur - s.t) / s.fadeOut)) : (s.t < s.dur ? 1 : 0);
        w = Math.min(inW, outW) * s.weight;
      }
      s.w = w;
      if ((s.cancel && w <= 1e-3) || (!s.cancel && s.t >= s.dur)) {
        s.a.stop(); this.shots.splice(i, 1); if (!s.cancel) s.onEnd?.(s); continue;
      }
      shotW = Math.max(shotW, w);
    }
    const baseScale = 1 - shotW;
    let dom = null, domW = 0;
    for (const [name, b] of this.base) {
      const w = sum > 0 ? b.w / sum : 0;
      b.a.setEffectiveWeight(w * baseScale);
      if (w > domW) { domW = w; dom = name; }
      if (b.w === 0 && b.target === 0) { b.a.stop(); this.base.delete(name); }
    }
    this.dominant = dom;
    // several one-shots at once share the shot weight
    const tot = this.shots.reduce((s, x) => s + x.w, 0) || 1;
    for (const s of this.shots) s.a.setEffectiveWeight(s.w * (shotW / tot));

    // --- mixer with protected nodes
    for (const [n, q] of this._prot) n.quaternion.copy(q);
    for (const [n, p] of this._protP) n.position.copy(p);
    this.mixer.update(dt);

    // --- override layers on top of the fresh animated pose
    for (const [name, L] of this.layers) {
      L.w += (L.target - L.w) * (1 - Math.exp(-dt * L.rate));
      const dur = L.clip.duration;
      if (L.w < 1e-3 && L.target === 0) { L.w = 0; continue; }
      L.t += dt * L.speed;
      if (L.loop) L.t %= dur;
      else if (L.t >= dur) { L.t = dur; if (!L.done) { L.done = true; L.target = 0; } }
      for (const tr of L.tracks) {
        const v = tr.interp.evaluate(L.t);
        if (tr.prop === 'quaternion') tr.node.quaternion.slerp(_q.fromArray(v), L.w);
        else tr.node.position.lerp(_v.fromArray(v), L.w);
      }
    }
    for (const [n, q] of this._prot) q.copy(n.quaternion);
    for (const [n, p] of this._protP) p.copy(n.position);

    // --- cues: dominant base clip (weight > 0.35), one-shots, layers
    if (this.onCue) {
      for (const [name, b] of this.base) this._cues(name, b.a.time, b.a, sum > 0 && b.w / sum > 0.35 && baseScale > 0.4);
      for (const s of this.shots) this._cues(s.name, s.a.time, s.a, s.w > 0.3);
      for (const [name, L] of this.layers) { if (L.w > 0.3) this._fire(name, L.prevT, L.t, L.clip.duration); L.prevT = L.t; }
    }
    for (const d of this.drivers) this.onDriver?.(d.name, d.position.x, d);
  }
  _cues(name, now, a, live) {
    const prev = a._prevT; a._prevT = now;
    if (!live || prev < -0.5) return;
    this._fire(name, prev, now, a.getClip().duration);
  }
  _fire(name, prev, now, dur) {
    const ev = this.meta[name]?.events; if (!ev?.length) return;
    const fire = (lo, hi) => { for (const e of ev) if (e.t > lo && e.t <= hi) this.onCue(e, name); };
    if (now >= prev) fire(prev, now); else { fire(prev, dur + 1e-3); fire(-1, now); }
  }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}

/** Piecewise-linear blend space along one axis: points [[x, name], …] sorted by x → {name: w}. */
export function blend1D(points, x) {
  const out = {};
  if (x <= points[0][0]) { out[points[0][1]] = 1; return out; }
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, a] = points[i], [x1, b] = points[i + 1];
    if (x <= x1) { const k = (x - x0) / (x1 - x0); out[a] = (out[a] || 0) + 1 - k; out[b] = (out[b] || 0) + k; return out; }
  }
  out[points[points.length - 1][1]] = 1; return out;
}
