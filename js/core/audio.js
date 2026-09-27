// Audio mixer: buses (ui, sfx, amb, music, voice) → master → limiter; ducking; positional sfx.
// Sound ids come from /api/audio on the dev server (next/assets/audio/*/index.json + v3/assets/audio/*/index.json),
// or from the same merged index written to /audio-index.json by the static build (server/audio-index.mjs).
// UI code asks for LOGICAL ids (ui_focus, ui_confirm …). They resolve to the design agent's UI pack
// (v3/assets/audio/ui) when it exists; until then to the closest vetted NEXT recording, quieter.
import * as THREE from 'three';
import { STATIC } from './env.js';

const UI_FALLBACK = {
  ui_focus: ['cl_servo_small', 0.18, 2.2], ui_confirm: ['mk42_lock_1', 0.4, 1.15], ui_back: ['mk42_faceplate_unlatch', 0.3, 1.3],
  ui_error: ['cl_mk1_visor', 0.35, 0.8], ui_tab: ['mk42_servo_2', 0.25, 1.6], ui_tick: ['cl_servo_small', 0.12, 2.8],
  ui_open: ['mk85_nano_tap', 0.4, 1], ui_close: ['mk85_nano_recede', 0.3, 1.2], ui_room_created: ['mk42_suit_ready', 0.5, 1],
  ui_join: ['mk42_lock_big_1', 0.45, 1], ui_leave: ['mk42_faceplate_unlatch', 0.4, 0.8], ui_ready: ['mk42_lock_2', 0.5, 1],
  ui_countdown: ['cl_clamp_lock', 0.45, 1.2], ui_start: ['im_thruster_ignite', 0.6, 1],
  ui_stinger_ironman: ['mk85_nano_helmet', 0.6, 1], ui_stinger_spider: ['sp_nano_seal', 0.6, 1],
  ui_map_zoom_in: ['mk85_wing_deploy', 0.25, 1.4], ui_map_zoom_out: ['mk85_wing_retract', 0.25, 1.4], ui_map_ping: ['sp_lens_focus', 0.5, 1],
  ui_suit_change: ['mk85_nano_flow', 0.35, 1.3],
};
// Logical UI id → the design agent's pack (v3/assets/audio/ui, 36 files). Arrays = random variant.
const UI_ALIAS = {
  ui_focus: ['ui_focus_1', 'ui_focus_2', 'ui_focus_3'], ui_tick: ['ui_slider_tick_1', 'ui_slider_tick_2', 'ui_slider_tick_3'],
  ui_open: 'ui_panel_open', ui_close: 'ui_panel_close', ui_join: 'ui_player_joined', ui_leave: 'ui_player_left',
  ui_countdown: 'ui_countdown_1', ui_start: 'ui_countdown_go', ui_suit_change: 'ui_retint_wave',
  ui_stinger_ironman: 'ui_suit_mk85', ui_stinger_spider: 'ui_suit_ironspider',
};
const BUSES = { ui: 0.8, sfx: 1, amb: 0.7, music: 0.6, voice: 1 };

export class Audio {
  constructor() {
    this.index = {}; this.buffers = new Map(); this.missing = new Set(); this.live = new Set();
    this.levels = { master: 0.85, ...BUSES };
    try { Object.assign(this.levels, JSON.parse(localStorage.getItem('mz3.mix') || '{}')); } catch { }
    this.ac = null; this.bus = {}; this.duckers = [];
    this.listenerObj = null;
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._u = new THREE.Vector3();
  }
  async init() {
    const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };
    this.index = {};
    for (const u of STATIC ? ['/audio-index.json'] : ['/api/audio', '/audio-index.json']) {
      try { this.index = await get(u); break; } catch { }
    }
    this.uiIds = Object.keys(this.index).filter(k => this.index[k].area === 'ui');
    return this;
  }
  /** Needs a user gesture in a normal browser (the HP launcher allows autoplay). Safe to call often. */
  unlock() {
    if (!this.ac) {
      const ac = this.ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      const lim = ac.createDynamicsCompressor();
      lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.12;
      this.master = ac.createGain(); this.master.connect(lim).connect(ac.destination);
      for (const b of Object.keys(BUSES)) { const g = ac.createGain(); const d = ac.createGain(); g.connect(d).connect(this.master); this.bus[b] = { g, duck: d }; }
      this.applyLevels();
    }
    if (this.ac.state !== 'running') this.ac.resume().catch(() => { });
    return this.ac.state;
  }
  get running() { return this.ac?.state === 'running'; }
  applyLevels() {
    if (!this.ac) return;
    this.master.gain.value = this.levels.master;
    for (const [b, n] of Object.entries(this.bus)) n.g.gain.value = this.levels[b];
    try { localStorage.setItem('mz3.mix', JSON.stringify(this.levels)); } catch { }
  }
  setLevel(bus, v) { this.levels[bus] = Math.max(0, Math.min(1, v)); this.applyLevels(); }

  /** Duck the given buses by `db` for `hold` s (attack/release in s). Overlapping ducks take the deepest. */
  duck({ buses = ['music', 'amb'], db = -9, attack = 0.04, hold = 0.4, release = 0.6 } = {}) {
    if (!this.ac) return;
    const t = this.ac.currentTime, g = Math.pow(10, db / 20);
    for (const b of buses) {
      const p = this.bus[b]?.duck.gain; if (!p) continue;
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(Math.min(p.value, g), t + attack);
      p.setValueAtTime(Math.min(p.value, g), t + attack + hold);
      p.linearRampToValueAtTime(1, t + attack + hold + release);
    }
  }

  resolve(id) {
    if (this.index[id]) return { id, gain: 1, rate: 1 };
    if (id.startsWith('ui_')) {
      let al = UI_ALIAS[id];
      if (Array.isArray(al)) al = al[Math.floor(Math.random() * al.length)];
      if (al && this.index[al]) return { id: al, gain: 1, rate: 1 };
      const key = id.slice(3);
      const hit = this.uiIds.find(k => k === id || k === key || k.endsWith('_' + key) || k.includes(key));
      if (hit) return { id: hit, gain: 1, rate: 1 };
      const fb = UI_FALLBACK[id]; if (fb && this.index[fb[0]]) return { id: fb[0], gain: fb[1], rate: fb[2] };
    }
    return null;
  }
  async _buffer(id) {
    if (this.buffers.has(id)) return this.buffers.get(id);
    const ent = this.index[id];
    const p = (async () => {
      for (const ext of ['.ogg', '.mp3', '.wav']) {
        try { const r = await fetch(ent.url + ext); if (!r.ok) continue; return await this.ac.decodeAudioData(await r.arrayBuffer()); } catch { }
      }
      return null;
    })();
    this.buffers.set(id, p); return p;
  }
  preload(ids) { if (!this.ac) return; for (const i of ids) { const r = this.resolve(i); if (r) this._buffer(r.id); } }

  /** play(id, {bus, gain, rate, loop, at: Object3D|Vector3, delay}) -> handle {stop(fade), gain(v), rate(v)} */
  play(id, o = {}) {
    let r = this.resolve(id);
    if (!r) { if (!this.missing.has(id)) { this.missing.add(id); console.warn('[audio] missing', id); } return null; }
    const vv = this.index[r.id]?.variants;
    if (vv?.length) r = { ...r, id: vv[Math.floor(Math.random() * vv.length)], jitter: 0.06 };
    if (!this.ac || this.ac.state !== 'running') return null;
    const ent = this.index[r.id] || {}, ac = this.ac;
    const bus = this.bus[o.bus || (id.startsWith('ui_') ? 'ui' : 'sfx')] || this.bus.sfx;
    const g = ac.createGain(); g.gain.value = (o.gain ?? 1) * r.gain * (ent.gain ?? 1);
    let out = g; const h = { stopped: false };
    if (o.at) {
      const pn = ac.createPanner(); pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse'; pn.refDistance = o.ref ?? 4; pn.rolloffFactor = 1;
      g.connect(pn); out = pn; h.pn = pn; h.at = o.at;
    }
    out.connect(bus.g);
    this._buffer(r.id).then(buf => {
      if (!buf || h.stopped) return;
      const s = ac.createBufferSource(); s.buffer = buf; s.loop = o.loop ?? !!ent.loop;
      const jit = r.jitter || o.jitter || 0;
      s.playbackRate.value = (o.rate ?? 1) * r.rate * (1 + (Math.random() - 0.5) * jit);
      s.connect(g); s.start(ac.currentTime + (o.delay || 0)); h.src = s;
      s.onended = () => this.live.delete(h);
    });
    h.stop = (fade = 0.08) => { h.stopped = true; g.gain.setTargetAtTime(0, ac.currentTime, fade / 3); setTimeout(() => { try { h.src?.stop(); } catch { } this.live.delete(h); }, fade * 1000 + 80); };
    h.gain = v => g.gain.setTargetAtTime(v * r.gain * (ent.gain ?? 1), ac.currentTime, 0.04);
    h.rate = v => h.src?.playbackRate.setTargetAtTime(v * r.rate, ac.currentTime, 0.05);
    this.live.add(h);
    return h;
  }
  ui(id, o) { return this.play(id, { bus: 'ui', ...o }); }
  stopAll() { for (const h of [...this.live]) h.stop(0.05); }

  update(camera) {
    if (!this.ac || !camera) return;
    const L = this.ac.listener;
    camera.getWorldPosition(this._v); camera.getWorldDirection(this._f); this._u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (L.positionX) {
      L.positionX.value = this._v.x; L.positionY.value = this._v.y; L.positionZ.value = this._v.z;
      L.forwardX.value = this._f.x; L.forwardY.value = this._f.y; L.forwardZ.value = this._f.z;
      L.upX.value = this._u.x; L.upY.value = this._u.y; L.upZ.value = this._u.z;
    }
    for (const h of this.live) {
      if (!h.pn) continue;
      const p = h.at.isVector3 ? h.at : h.at.getWorldPosition(this._v);
      h.pn.positionX.value = p.x; h.pn.positionY.value = p.y; h.pn.positionZ.value = p.z;
    }
  }
}
