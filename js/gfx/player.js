// ClipPlayer: plays glTF clips on a rig, fires clips.json cues (sound / vfx), reads drv_* drivers.
import * as THREE from 'three';

export class ClipPlayer {
  /**
   * @param root   Object3D the clips bind to (by node name)
   * @param clips  THREE.AnimationClip[]  (from any GLB — node names must match)
   * @param meta   clips.json object {clips:[{name,loop,events,layer,duration,...}]} or array of them
   * @param ctx    showroom ctx (sfx, vfx, onCue)
   */
  constructor(root, clips, meta, ctx) {
    this.root = root; this.ctx = ctx;
    this.mixer = new THREE.AnimationMixer(root);
    this.meta = {};
    for (const m of [].concat(meta || [])) for (const c of (m?.clips || [])) this.meta[c.name] = c;
    this.clips = {};
    for (const c of clips || []) this.clips[c.name] = c;
    this.base = null;          // current full-body action
    this.layers = new Map();   // name -> action (upper-body layers)
    this.overrides = new Map(); // override-layer name -> Set(joint names it owns)
    this._filt = new Map();
    this._prot = new Map();
    this.speed = 1; this.loopOverride = null;
    this.onDriver = null;      // (name, value, node) => void
    this.onCue = null;         // (event, clipName) => boolean (true = handled)
    this.onFinished = null;
    this._prevT = new Map();
    this.drivers = [];
    root.traverse(o => { if (/^drv_/.test(o.name)) this.drivers.push(o); });
    this._rest = new Map();
    root.traverse(o => this._rest.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
    this.mixer.addEventListener('finished', e => this.onFinished?.(e.action.getClip().name));
    this.glowMats = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) if (m && /glow/i.test(m.name) && !this.glowMats.find(g => g.m === m)) this.glowMats.push({ m, base: m.emissiveIntensity });
    });
  }

  addClips(clips, meta) {
    for (const c of clips || []) this.clips[c.name] = c;
    for (const m of [].concat(meta || [])) for (const c of (m?.clips || [])) this.meta[c.name] = c;
  }

  list() {
    return Object.keys(this.clips).map(name => {
      const m = this.meta[name] || {};
      return { name, label: m.label || name, loop: m.loop ?? /loop|idle|hover|walk|run|cruise|fly_|swing|crawl/.test(name),
               duration: this.clips[name].duration, layer: m.layer || null };
    });
  }

  resetPose() {
    for (const [o, r] of this._rest) { o.position.copy(r.p); o.quaternion.copy(r.q); o.scale.copy(r.s); }
    for (const [n, q] of this._prot || []) q.copy(n.quaternion);
  }

  isLoop(name) {
    if (this.loopOverride !== null) return this.loopOverride;
    const m = this.meta[name];
    if (m && 'loop' in m) return !!m.loop;
    return /loop|idle|hover|walk|run|cruise|fly_|swing|crawl/.test(name);
  }

  /** A new layer replaces any other active layer that animates the same channels: mask_open
   * followed by mask_close used to run BOTH, and the two summed and cancelled half way. */
  _retireConflicting(name, fade) {
    const mine = new Set(this.clips[name].tracks.map(t => t.name));
    for (const [other, a] of [...this.layers]) {
      if (other === name) continue;
      if (!this.clips[other]?.tracks.some(t => mine.has(t.name))) continue;
      a.fadeOut(fade); this.layers.delete(other);
      const wasOverride = this.overrides.delete(other);
      setTimeout(() => { a.stop(); if (wasOverride) this._rebuildBase(); }, fade * 1000);
    }
  }

  play(name, { fade = 0.25, loop, restart = true } = {}) {
    const clip = this.clips[name];
    if (!clip) { console.warn('[player] no clip', name); return null; }
    const m = this.meta[name] || {};
    const lp = loop ?? this.isLoop(name);
    if (m.layer) this._retireConflicting(name, fade);
    if (m.layer && m.blend === 'override') {
      // absolute pose for the joints it owns; the base clip is played through a copy with
      // those joints' tracks removed (Godot: AnimationNodeBlend2 with a filter)
      // own EVERY node the layer animates (declared joints + its drivers, e.g. drv_nano_helmet):
      // excluding only `joints` left the base clip writing the same driver, three.js averaged
      // the two actions 50/50, and the Mk 85 mask stopped half open
      const joints = new Set([...(m.joints || []), ...clip.tracks.map(t => t.name.split('.')[0])]);
      this.overrides.set(name, joints);
      const a = this.mixer.clipAction(clip);
      a.setLoop(lp ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = true;
      a.reset().fadeIn(fade).play();
      this.layers.set(name, a); this._prevT.set(a, -1);
      this._rebuildBase();
      return a;
    }
    if (m.layer) {
      let a = this.layers.get(name);
      if (!a) {
        const add = THREE.AnimationUtils.makeClipAdditive(clip.clone(), 0);
        a = this.mixer.clipAction(add); a.blendMode = THREE.AdditiveAnimationBlendMode;
        this.layers.set(name, a);
      }
      a.setLoop(lp ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = true;
      a.reset().fadeIn(fade).play();
      this._prevT.set(a, -1);
      return a;
    }
    const a = this.mixer.clipAction(clip);
    a.setLoop(lp ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    if (this.base && this.base !== a) {
      if (fade > 0) { a.reset().play(); this.base.crossFadeTo(a, fade, false); }
      else { this.base.stop(); a.reset().play(); }
    } else {
      if (!this.base) this.resetPose();
      if (restart) a.reset();
      a.play();
    }
    this.base = a; this.current = name;
    this._prevT.set(a, -1);
    if (this.overrides.size) this._rebuildBase();
    return this.base;
  }

  _filtered(name, excl) {
    const key = name + '|' + [...excl].sort().join(',');
    if (!this._filt.has(key)) {
      const c = this.clips[name];
      const f = new THREE.AnimationClip(c.name, c.duration, c.tracks.filter(t => !excl.has(t.name.split('.')[0])));
      this._filt.set(key, f);
    }
    return this._filt.get(key);
  }

  _rebuildBase() {
    if (!this.base || !this.current) return;
    const excl = new Set(); for (const s of this.overrides.values()) s.forEach(j => excl.add(j));
    const want = excl.size ? this._filtered(this.current, excl) : this.clips[this.current];
    if (this.base.getClip() === want) return;
    const old = this.base, t = old.time, loop = old.loop;
    const nb = this.mixer.clipAction(want);
    nb.setLoop(loop, Infinity); nb.clampWhenFinished = true; nb.reset(); nb.time = t; nb.play();
    old.stop();
    this.base = nb; this._prevT.set(nb, t);
  }

  stopLayer(name, fade = 0.2) {
    const a = this.layers.get(name); if (!a) return;
    a.fadeOut(fade);
    if (this.overrides.delete(name)) { this.layers.delete(name); setTimeout(() => { a.stop(); this._rebuildBase(); }, fade * 1000); }
  }
  stopAll() { this.mixer.stopAllAction(); this.base = null; this.layers.forEach(a => a.stop()); this.layers.clear(); this.overrides.clear(); this.resetPose(); }

  /** Deterministic pose for screenshots: clip at time t (seconds). */
  seek(name, t) {
    this.mixer.stopAllAction();
    this.resetPose();
    const a = this.mixer.clipAction(this.clips[name]);
    a.reset().play(); a.paused = false; a.time = Math.min(t, this.clips[name].duration);
    this.base = a; this.current = name;
    this.mixer.update(0);
    a.paused = true;
    for (const [n, q] of this._prot) q.copy(n.quaternion);
    this._readDrivers();
  }

  get time() { return this.base ? this.base.time : 0; }
  set time(t) { if (this.base) { this.base.time = t; this.mixer.update(0); } }
  get duration() { return this.base ? this.base.getClip().duration : 0; }
  set paused(v) { if (this.base) this.base.paused = v; this.layers.forEach(a => a.paused = v); }
  get paused() { return this.base?.paused; }

  /** Procedural layers (aim IK, look-at) write on top of the animated pose AFTER the mixer.
   * three.js only writes a channel when its sampled value CHANGES from the last frame, so on a
   * joint whose clip value is constant (a held pose, a chest the walk never turns) anything
   * written after the mixer is never overwritten and ACCUMULATES frame after frame — that is
   * how a look-at spun the torso round and round. protect(nodes) makes update() put those
   * nodes back to the last animated pose before the mixer runs and snapshot the new animated
   * pose after it, so a procedural layer always starts from the clip. */
  protect(nodes) { for (const n of nodes) if (n && !this._prot.has(n)) this._prot.set(n, n.quaternion.clone()); }

  update(dt) {
    for (const [n, q] of this._prot) n.quaternion.copy(q);
    this.mixer.update(dt * this.speed);
    for (const [n, q] of this._prot) q.copy(n.quaternion);
    for (const a of [this.base, ...this.layers.values()]) {
      if (!a || !a.isRunning()) continue;
      const name = a.getClip().name;
      const m = this.meta[name] || this.meta[name.replace(/^additive_?/, '')];
      if (!m?.events?.length) { this._prevT.set(a, a.time); continue; }
      const prev = this._prevT.get(a) ?? -1, now = a.time;
      const fire = (lo, hi) => { for (const e of m.events) if (e.t > lo && e.t <= hi) this._cue(e, name); };
      if (now >= prev) fire(prev, now); else { fire(prev, a.getClip().duration + 1e-3); fire(-1, now); }
      this._prevT.set(a, now);
    }
    this._readDrivers();
  }

  _readDrivers() {
    for (const d of this.drivers) {
      const v = d.position.x;
      if (d.name.startsWith('drv_glow')) for (const g of this.glowMats) g.m.emissiveIntensity = g.base * Math.max(0, v);
      this.onDriver?.(d.name, v, d);
      this.ctx?.vfx?.driver?.(d.name, v, d, this.root);
    }
  }

  _cue(e, clipName) {
    if (this.onCue?.(e, clipName)) return;
    const at = e.at ? this.root.getObjectByName(e.at) : this.root;
    if (e.sfx) this.ctx?.sfx?.play(e.sfx, { at, gain: e.gain ?? 1, rate: e.rate ?? 1 });
    if (e.vfx) this.ctx?.vfx?.cue?.(e.vfx, at, e, this.root);
  }
}

/** Load a GLB's clips.json sibling if it exists. */
export async function loadClipsJson(url) {
  try { const r = await fetch(url + '.clips.json'); if (r.ok) return await r.json(); } catch { }
  return null;
}
