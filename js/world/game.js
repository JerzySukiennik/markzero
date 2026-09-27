// MZ.game — the session: phases, local hero/suit choice, entering/leaving the world, players
// (local + remote over the room relay), the camera kick bus, and the HUD/map snapshots the UI reads.
// Player controllers come from web/js/game/index.js (the gameplay agent's) via createPlayer(); until
// that exists, world/fallback.js keeps the world playable. Interface: docs/CORE-API.md.
import * as THREE from 'three';
import { HEROES, SUITS, ROSTER } from '../core/theme.js';
import { World } from './world.js';

const SEND_HZ = 20;

export class Game {
  constructor(MZ) {
    this.MZ = MZ; this.phase = 'menu';
    this.hero = MZ.params.get('hero') || 'ironman';
    this.suit = MZ.params.get('suit') || HEROES[this.hero].defaultSuit;
    this.world = null; this.players = new Map(); this.local = null;
    this.camera = null; this.pings = [];
    this._send = 0; this._pendingSolo = null;
    /** Global time scale for story slow-motion (1 = normal). Multiplies the sim dt players get. */
    this.timeScale = 1;
    this._readyWait = [];
    const on = (t, f) => MZ.on(t, f);
    on('room:start', ({ room, seed }) => this.enter(room, seed));
    on('room:update', ({ room, created }) => { if (created && this._pendingSolo) { this._pendingSolo = null; MZ.net.start(); } this._syncRoster(room); });
    on('room:left', () => { if (this.phase === 'playing' || this.phase === 'paused') this._syncRoster({ players: [] }); });
    MZ.net.onMsg('p', (m, from) => this.players.get(from)?.applyState?.(m.s));
    MZ.net.onMsg('ping', m => this._addPing(m.x, m.z, m.from, false));
    MZ.net.onMsg('ev', (m, from) => MZ.emit('game:event', { ...m.e, from }));
  }
  _phase(p) { const from = this.phase; if (p === from) return; this.phase = p; this.MZ.emit('game:phase', { phase: p, from }); }

  /** Menu choice: only ROSTER suits (no Hulkbuster, no Peter). In-game suit changes may use any SUITS entry: choose(h, s, {inGame: true}). */
  choose(hero, suit, { inGame = false } = {}) {
    const pool = inGame ? SUITS : ROSTER;
    const s = pool.find(x => x.id === suit && x.hero === hero) ? suit : HEROES[hero].defaultSuit;
    const from = this.suit;
    this.hero = hero; this.suit = s;
    this.MZ.theme.set(s);
    if (this.MZ.net.room) this.MZ.net.set({ hero, suit: s });
    this.MZ.emit('suit:change', { suit: s, hero, from });
  }
  /** Solo = a room of one, started at once (offline: straight into the world). */
  solo(hero = this.hero, suit) {
    this.choose(hero, suit || (hero === this.hero ? this.suit : HEROES[hero].defaultSuit));
    // over the WS room service solo is a room of one (dev tools see it); over Firebase it stays local — no DB traffic
    if (this.MZ.net.status === 'online' && this.MZ.net.transport === 'ws') { this._pendingSolo = true; this.MZ.net.host({ hero: this.hero, suit: this.suit, room: 'solo' }); }
    else this.enter({ code: 'SOLO', players: [{ id: 'local', name: this.MZ.net.name, hero: this.hero, suit: this.suit }] }, 1);
  }

  async enter(room, seed) {
    if (this.phase === 'loading' || this.world) return;
    this._room = room; this._seed = seed;
    const MZ = this.MZ;
    this._phase('loading');
    MZ.input.context = 'game';
    const me = room.players.find(p => p.id === MZ.net.id) || room.players.find(p => p.id === 'local') || room.players[0];
    if (me) { this.hero = me.hero; this.suit = me.suit || HEROES[me.hero].defaultSuit; MZ.theme.set(this.suit); }
    const progress = (p, label) => MZ.emit('game:loading', { progress: p, label });
    try {
      this.world = new World(MZ);
      await this.world.load(progress);
      this.camera = this.world.camera;
      await this._syncRoster(room, true);
      // other layers (story) may hold 'playing' until their actors are ready: MZ.game.ready(promise)
      if (this._readyWait.length) await Promise.race([Promise.allSettled(this._readyWait), new Promise(r => setTimeout(r, 8000))]);
      this._readyWait = [];
      // compile every program (lit + shadow depth) and upload every texture/buffer now, one group per frame
      try { const { warmWorld } = await import('./warmup.js'); const wr = await warmWorld(this.world, { onProgress: p => progress(0.97 + 0.03 * p, 'warming up') }); console.info('[game] warm-up', wr); } catch (e) { console.warn('[game] warm-up failed', e); this.world.prewarm(); }
      this.world.armGuard?.();
      this.MZ.stage.world.visible = true;
      progress(1, 'ready');
      this._phase('playing');
      MZ.haptics.play('ui_start'); MZ.audio.ui('ui_start');
    } catch (e) {
      console.error('[game] world failed', e);
      this.quit(); MZ.emit('room:error', { code: 'world', msg: 'World failed to load: ' + e.message });
    }
  }
  async _syncRoster(room, force = false) {
    if (!this.world || (!force && this.phase !== 'playing' && this.phase !== 'paused')) return;
    const want = new Map((room.players || []).map(p => [p.id, p]));
    const myId = this.MZ.net.room ? this.MZ.net.id : 'local';
    if (!want.has(myId)) want.set(myId, { id: myId, name: this.MZ.net.name, hero: this.hero, suit: this.suit });
    for (const [id, pl] of this.players) if (!want.has(id)) { pl.dispose?.(); this.players.delete(id); this.MZ.emit('game:event', { kind: 'player_left', id }); }
    for (const [id, p] of want) {
      if (this.players.has(id)) continue;
      const local = id === myId;
      const pl = await this.world.createPlayer({ id, name: p.name, hero: p.hero, suit: p.suit || HEROES[p.hero].defaultSuit, local });
      this.players.set(id, pl);
      if (local) this.local = pl; else this.MZ.emit('game:event', { kind: 'player_joined', id, name: p.name, hero: p.hero });
    }
  }

  /** Hold the switch to 'playing' until `promise` settles (max 8 s). Call during 'loading' (e.g. on game:loading). */
  ready(promise) { if (promise?.then) this._readyWait.push(promise); }

  pause(on = true) {
    if (this.phase !== 'playing' && this.phase !== 'paused') return;
    this._phase(on ? 'paused' : 'playing');
    this.MZ.input.context = on ? 'ui' : 'game';
  }
  /** After a GPU driver reset (context lost → restored) the render targets, env map and shadow maps are gone and a
   * patched restore leaves the façades dark ("95% black buildings"). Rebuild the world in place — same room, same
   * heroes, the local hero put back where he was — instead of reloading the page (which dropped Jurek to the menu). */
  async recoverWorld() {
    if (!this.world || this._recovering) return;
    this._recovering = true;
    const L = this.local, pos = L?.root?.position.clone(), yaw = L?.heading ?? 0;
    for (const pl of this.players.values()) pl.dispose?.();
    this.players.clear(); this.local = null;
    this.world.dispose(); this.world = null; this.camera = null;
    this.phase = 'menu';                       // silent: enter() emits loading → playing again
    try {
      await this.enter(this._room || { code: 'SOLO', players: [{ id: 'local', name: this.MZ.net.name, hero: this.hero, suit: this.suit }] }, this._seed);
      if (pos && this.local) { const { teleport } = await import('../story/control.js'); teleport(this.local, pos.add(new THREE.Vector3(0, 1, 0)), yaw); }
    } finally { this._recovering = false; }
  }
  quit() {
    for (const pl of this.players.values()) pl.dispose?.();
    this.players.clear(); this.local = null;
    this.world?.dispose(); this.world = null; this.camera = null;
    if (this.MZ.net.room) this.MZ.net.leave();
    this.MZ.input.context = 'ui';
    this._phase('menu');
  }
  /** Camera juice on the world camera; the UI hears it as fx:kick. */
  kick(k) { this.world?.kick(k); this.MZ.emit('fx:kick', k); }
  event(e, replicate = true) { this.MZ.emit('game:event', e); if (replicate) this.MZ.net.send('ev', { e }); }

  update(dt, t) {
    if (!this.world || (this.phase !== 'playing' && this.phase !== 'paused')) return;
    // co-op: pause only takes the pad, the shared world keeps running (UI request 6)
    const coop = (this.MZ.net.room?.players.length || 1) > 1;
    const simDt = this.phase === 'paused' && !coop ? 0 : this.world.timeScale(dt) * this.timeScale;
    for (const pl of this.players.values()) pl.update(simDt, t);
    this.world.update(simDt, dt, t, this.local);
    if (this.local && this.MZ.net.room && (this._send += dt) > 1 / SEND_HZ) { this._send = 0; this.MZ.net.send('p', { s: this.local.state() }); }
    this.pings = this.pings.filter(p => t - (p.t ?? (p.t = t)) < 12);
  }

  hud() {
    const L = this.local;
    const base = { hero: this.hero, suit: this.suit, speed: 0, vspeed: 0, alt: 0, heading: 0, throttle: 0, boost: false, hover: false, grounded: true, health: 1, aim: null, prompts: [], web: null };
    return L?.hud ? { ...base, ...L.hud() } : base;
  }
  mapState() {
    const players = [...this.players.entries()].map(([id, pl]) => { const s = pl.snapshot(); return { id, name: pl.name, hero: pl.hero, suit: pl.suit, you: pl === this.local, ...s }; });
    return { players, pois: this.world?.pois || [], pings: this.pings };
  }
  ping(x, z) { this._addPing(x, z, this.MZ.net.id, true); }
  _addPing(x, z, from, send) {
    this.pings.push({ x, z, from, t: undefined });
    this.MZ.emit('game:event', { kind: 'ping', x, z, from });
    if (send) this.MZ.net.send('ping', { x, z, from });
  }
}
