// Room service over Firebase Realtime Database — the internet transport (the static browser build has no
// server, so no /net WebSocket). Same public API and bus events as the WS client (net/client.js), so the UI
// and the game never know which one they hold:
//   status rtt id rooms room isHost me name setName() connect() list() host() join() set() start() leave()
//   send(k, payload) onMsg(k, fn)  →  net:status net:rooms room:update room:error room:left room:start
//
// Data (shared gzowos-games RTDB, everything under /markzero; rules: docs/net/markzero.rules.json, deployed
// ONLY via Projects/tools/rtdb-rules.sh):
//   lobby/<CODE>                 {name, host, hostName, created, beat, started, n, who}   the room list (small)
//   rooms/<CODE>/meta            {name, host, max, created, beat, started, seed, v}
//   rooms/<CODE>/slots/<hero>    uid          one Iron Man + one Spider-Man; holding a slot = being in the room
//   rooms/<CODE>/players/<uid>   {name, hero, suit, ready, joined, client}
//   rooms/<CODE>/state/<uid>/<k> JSON string  latest-wins relay kinds (player state 'p'), flushed at STATE_HZ
//   rooms/<CODE>/ev/<pushId>     {k, d (JSON string), from, t}   ordered, reliable relay (events, story, pings)
// Identity = Firebase anonymous auth, persisted per TAB (sessionStorage), so two tabs are two players and a
// reload keeps its uid. Presence: onDisconnect removes our player / slot / state the moment the server
// notices the socket is gone; on reconnect we write them back (rejoin) if the slot is still ours.
// Cleanup: the host beats every 30 s; anyone listing rooms deletes rooms that are empty or stale.
import { firebaseConfig, SDK, ROOT } from './firebase-config.js';

const HEROES = ['ironman', 'spiderman'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I/O, same as server/rooms.mjs
const LATEST = new Set(['p']);                        // relay kinds where only the newest value matters
const STATE_HZ = 15, BEAT_MS = 30000, STALE_MS = 90000, EV_TTL_MS = 40000, DEAD_MS = 600000;
const code4 = () => { let c = ''; for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; return c; };
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms))]);

export class FirebaseNet {
  constructor(bus) {
    this.bus = bus; this.transport = 'firebase';
    this.status = 'offline'; this.rtt = null; this.id = null;
    this.rooms = []; this.room = null; this.browsing = false;
    this.name = (() => { try { return localStorage.getItem('mz3.name') || ''; } catch { return ''; } })() || 'Player ' + Math.floor(100 + Math.random() * 900);
    this.handlers = new Map();
    this.fb = null; this._retry = 0; this._off = 0;
    this._code = null; this._hero = null; this._unsub = []; this._latest = new Map(); this._seen = new Map();
    this._swept = new Set(); this._meta = null; this._players = null; this._started = false;
  }
  get isHost() { return !!this.room && this.room.host === this.id; }
  get me() { return this.room?.players.find(p => p.id === this.id) || null; }
  get _now() { return Date.now() + this._off; }
  setName(n) {
    this.name = String(n).slice(0, 20); try { localStorage.setItem('mz3.name', this.name); } catch { }
    if (this._code && this.fb) this._upd(`rooms/${this._code}/players/${this.id}`, { name: this.name }).catch(() => { });
  }
  _status(s) { if (s === this.status) return; this.status = s; this.bus.emit('net:status', { state: s, rtt: this.rtt }); }
  _ref(p) { return this.fb.D.ref(this.fb.db, p ? `${ROOT}/${p}` : ROOT); }
  _upd(p, v) { return this.fb.D.update(this._ref(p), v); }
  get _TS() { return this.fb.D.serverTimestamp(); }

  // ---------------------------------------------------------------- connection
  async connect() {
    if (this.fb || this._connecting) return;
    this._connecting = true; this._status('connecting');
    try {
      const [A, U, D] = await withTimeout(Promise.all(['app', 'auth', 'database'].map(m => import(`${SDK}/firebase-${m}.js`))), 20000, 'Firebase SDK');
      const app = A.getApps().find(a => a.name === 'markzero') || A.initializeApp(firebaseConfig, 'markzero');
      let auth; try { auth = U.initializeAuth(app, { persistence: U.browserSessionPersistence }); } catch { auth = U.getAuth(app); }
      await auth.authStateReady?.();
      const user = auth.currentUser || (await withTimeout(U.signInAnonymously(auth), 20000, 'sign-in')).user;
      const db = D.getDatabase(app);
      this.fb = { A, U, D, app, auth, db }; this.id = user.uid; this._retry = 0;
      D.onValue(D.ref(db, '.info/serverTimeOffset'), s => { this._off = s.val() || 0; });
      D.onValue(D.ref(db, '.info/connected'), s => this._conn(!!s.val()));
      clearInterval(this._ping); this._ping = setInterval(() => this._measure(), 5000);
    } catch (e) {
      console.warn('[net] Firebase unavailable:', e?.message || e);
      this._status('offline');
      setTimeout(() => { this._connecting = false; this.connect(); }, Math.min(30000, 2000 * 2 ** this._retry++));
      return;
    }
    this._connecting = false;
  }
  _conn(on) {
    this.connected = on;
    if (!on) { this._status('offline'); return; }
    this._status('online');
    if (this.browsing) this.list();
    if (this._code) this._rejoin();
  }
  /** Round trip to the server (a read nobody listens to, so it cannot come from the local cache). */
  async _measure() {
    if (!this.connected || document.hidden) return;
    const t = performance.now();
    try { await this.fb.D.get(this._ref('rooms/_ping')); this._rtt(performance.now() - t); } catch { }
  }
  _rtt(ms) { this.rtt = this.rtt == null ? ms : this.rtt * 0.7 + ms * 0.3; }

  // ---------------------------------------------------------------- room list
  list() {
    this.browsing = true;
    if (!this.fb || !this.connected || this._listOff) return;
    const { D } = this.fb;
    this._listOff = D.onValue(this._ref('lobby'), s => {
      const v = s.val() || {}, now = this._now, rooms = [];
      for (const [code, e] of Object.entries(v)) {
        if (!e || now - (e.beat || 0) > STALE_MS) { this._sweep(code, e); continue; }
        rooms.push({ code, name: e.name, host: e.host, max: 2, started: !!e.started, created: e.created,
          players: String(e.who || '').split(',').filter(Boolean).map((w, i) => { const [hero, ...n] = w.split(':'); return { id: i ? '?' + i : e.host, name: n.join(':'), hero, ready: false, host: !i }; }) });
      }
      this.rooms = rooms.filter(r => !r.started && r.players.length < r.max).sort((a, b) => (b.created || 0) - (a.created || 0));
      this.bus.emit('net:rooms', { rooms: this.rooms });
    }, e => console.warn('[net] lobby', e?.message));
  }
  /** A lobby entry whose host stopped beating: delete the room if nobody is in it (or it died long ago). */
  async _sweep(code, e) {
    if (this._swept.has(code)) return; this._swept.add(code);
    const { D } = this.fb;
    try {
      const ps = await D.get(this._ref(`rooms/${code}/players`));
      if (ps.exists() && this._now - (e?.beat || 0) < DEAD_MS) return;
      await D.remove(this._ref(`rooms/${code}`)).catch(() => { });
      await D.remove(this._ref(`lobby/${code}`));
    } catch { }
  }

  // ---------------------------------------------------------------- host / join / leave
  async host({ hero, suit, room } = {}) {
    if (!this._ready()) return false;
    await this._leaveRoom(true);
    hero = HEROES.includes(hero) ? hero : 'ironman';
    const name = String(room || `${this.name}'s room`).slice(0, 32), uid = this.id, TS = this._TS;
    for (let i = 0; i < 6; i++) {
      const code = code4();
      try {
        await this._upd('', {
          [`rooms/${code}/meta`]: { name, host: uid, max: 2, created: TS, beat: TS, started: false, v: 1 },
          [`rooms/${code}/slots/${hero}`]: uid,
          [`rooms/${code}/players/${uid}`]: this._player(hero, suit),
          [`lobby/${code}`]: { name, host: uid, hostName: this.name, created: TS, beat: TS, started: false, n: 1, who: `${hero}:${this.name.replace(/,/g, ' ')}` },
        });
      } catch (e) { if (/permission/i.test(e?.message)) continue; return this._err('net', e); }   // code taken → another one
      await this._enter(code, hero, { created: true });
      return true;
    }
    return this._err('net', new Error('no free room code'));
  }
  async join(code, { hero, suit } = {}) {
    if (!this._ready()) return false;
    code = String(code || '').toUpperCase().trim();
    if (!/^[A-Z]{4}$/.test(code)) return this._err('no_room', null, 'No room with that code.');
    const { D } = this.fb, want = hero;
    for (let attempt = 0; attempt < 2; attempt++) {
      let meta, players;
      try { [meta, players] = (await Promise.all(['meta', 'players'].map(k => D.get(this._ref(`rooms/${code}/${k}`))))).map(s => s.val()); }
      catch (e) { return this._err('net', e); }
      if (!meta) return this._err('no_room', null, 'No room with that code.');
      if (meta.started) return this._err('started', null, 'That game has already started.');
      players = players || {};
      if (players[this.id]) { await this._enter(code, players[this.id].hero, {}); return true; }   // already in (reload)
      const taken = new Set(Object.values(players).map(p => p.hero));
      const h = want && HEROES.includes(want) && !taken.has(want) ? want : HEROES.find(x => !taken.has(x));
      if (!h || Object.keys(players).length >= 2) return this._err('full', null, 'That room is full.');
      await this._leaveRoom(true);
      try {
        await this._upd(`rooms/${code}`, { [`slots/${h}`]: this.id, [`players/${this.id}`]: this._player(h, h === want ? suit : null) });
      } catch (e) { if (attempt === 0 && /permission/i.test(e?.message)) continue; return this._err('full', null, 'That room is full.'); }
      await this._enter(code, h, { joined: true, reassigned: h !== want });
      return true;
    }
    return this._err('full', null, 'That room is full.');
  }
  _player(hero, suit) { return { name: this.name, hero, suit: suit ? String(suit).slice(0, 24) : '', ready: false, joined: this._TS, client: String(this.client || 'web').slice(0, 16) }; }
  _ready() { if (this.fb && this.connected) return true; this._err('offline', null, 'Can’t reach the room service'); return false; }
  _err(code, e, msg) { if (e) console.warn('[net]', code, e?.message || e); this.bus.emit('room:error', { code, msg: msg || e?.message || code }); return false; }

  async _enter(code, hero, flags) {
    const { D } = this.fb, uid = this.id;
    this._code = code; this._hero = hero; this._started = false; this._first = flags;
    this._meta = null; this._players = null; this._latest.clear(); this._seen.clear(); this._sent = new Map();
    await this._presence();
    const R = p => this._ref(`rooms/${code}/${p}`);
    this._unsub.push(D.onValue(R('meta'), s => { this._meta = s.val(); this._view(); }));
    this._unsub.push(D.onValue(R('players'), s => { this._players = s.val() || {}; this._view(); }));
    const onState = s => {
      const from = s.key, v = s.val(); if (from === uid || !v) return;
      for (const [k, d] of Object.entries(v)) {
        const key = from + '/' + k; if (this._seen.get(key) === d) continue; this._seen.set(key, d);
        this._deliver(k, parse(d), from);
      }
    };
    const forget = id => { for (const k of this._seen.keys()) if (k.startsWith(id + '/')) this._seen.delete(k); };
    this._forget = forget;
    this._unsub.push(D.onChildAdded(R('state'), onState), D.onChildChanged(R('state'), onState), D.onChildRemoved(R('state'), s => forget(s.key)));
    const since = D.push(R('ev')).key;   // push ids sort by (server-corrected) time: only events from now on
    this._unsub.push(D.onChildAdded(D.query(R('ev'), D.orderByKey(), D.startAfter(since)), s => {
      const v = s.val(); if (!v || v.from === uid) return;
      this._deliver(v.k, parse(v.d), v.from);
    }));
    clearInterval(this._flushT); this._flushT = setInterval(() => this._flush(), 1000 / STATE_HZ);
    clearInterval(this._beatT); this._beatT = setInterval(() => this._beat(), BEAT_MS);
  }
  /** onDisconnect: the server removes our player / slot / state when our socket dies. */
  async _presence() {
    const { D } = this.fb, od = D.onDisconnect(this._ref(`rooms/${this._code}`));
    this._sent = new Map();
    try { await od.cancel(); await od.update({ [`players/${this.id}`]: null, [`state/${this.id}`]: null, [`slots/${this._hero}`]: null }); }
    catch (e) { console.warn('[net] presence', e?.message); }
  }
  /** After a connection drop the server has removed us (onDisconnect): put us back if our hero is still free. */
  async _rejoin() {
    const code = this._code, { D } = this.fb;
    try {
      const [meta, slot] = (await Promise.all([D.get(this._ref(`rooms/${code}/meta`)), D.get(this._ref(`rooms/${code}/slots/${this._hero}`))])).map(s => s.val());
      if (!meta || (slot && slot !== this.id)) throw new Error('room gone or hero taken');
      const me = this.me;
      await this._upd(`rooms/${code}`, { [`slots/${this._hero}`]: this.id, [`players/${this.id}`]: { ...this._player(this._hero, me?.suit), ready: !!me?.ready } });
      await this._presence();
      console.info('[net] rejoined', code);
    } catch (e) {
      console.warn('[net] rejoin failed:', e?.message);
      this._detach(); this.room = null; this.bus.emit('room:left', { reason: 'disconnected' });
    }
  }
  _view() {
    if (!this._meta || !this._players) return;
    const m = this._meta, ps = this._players, code = this._code;
    const list = Object.entries(ps).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.joined || 0) - (b.joined || 0) || (a.id < b.id ? -1 : 1));
    let host = m.host;
    if (list.length && !ps[host]) {   // host migration: the earliest remaining player takes over
      host = list[0].id;
      if (host === this.id) this._upd(`rooms/${code}`, { 'meta/host': this.id, 'meta/beat': this._TS }).then(() => this._lobby()).catch(() => { });
    }
    const room = { code, name: m.name, host, max: m.max || 2, started: !!m.started, created: m.created,
      players: list.map(p => ({ id: p.id, name: p.name, hero: p.hero, suit: p.suit || null, ready: !!p.ready, host: p.id === host })) };
    if (!ps[this.id] && this.connected && this.room) {
      // our entry vanished while connected: kicked or a stale onDisconnect fired — try to get back in once
      if (!this._fixing) { this._fixing = true; this._rejoin().finally(() => { this._fixing = false; }); }
      return;
    }
    const prev = new Set(this.room?.players.map(p => p.id) || []), now = new Set(room.players.map(p => p.id));
    const joinedIds = [...now].filter(id => !prev.has(id)), leftIds = [...prev].filter(id => !now.has(id));
    for (const id of joinedIds) this._forget?.(id);
    if (joinedIds.some(id => id !== this.id)) this._sent = new Map();   // a (re)joiner gets our current state even if we stand still
    const first = this._first; this._first = null;
    const ev = { room, you: this.id, created: !!first?.created,
      joined: first?.joined ? this.id : this.room ? joinedIds.find(id => id !== this.id) || null : null,
      left: leftIds[0] || null, reassigned: first?.reassigned ? this.id : null };
    this.room = room;
    // everyone un-readies when the roster changes before the start (the WS service does the same)
    if (!room.started && (ev.joined || ev.left) && !first && this.me?.ready) this._upd(`rooms/${code}/players/${this.id}`, { ready: false }).catch(() => { });
    if (host === this.id) this._lobby();
    this.bus.emit('room:update', ev);
    if (room.started && !this._started) {
      this._started = true;
      if (!first) this.bus.emit('room:start', { room, seed: m.seed ?? 1 });   // a rejoin into a running game is not a new start
    }
  }
  _lobby() {
    const r = this.room; if (!r || !this.fb) return;
    const who = r.players.map(p => `${p.hero}:${String(p.name).replace(/,/g, ' ')}`).join(',').slice(0, 80);
    this._upd(`lobby/${r.code}`, { name: r.name, host: r.host, hostName: String(r.players.find(p => p.host)?.name || '').slice(0, 20),
      created: r.created || this._TS, beat: this._TS, started: r.started, n: r.players.length, who }).catch(e => console.warn('[net] lobby', e?.message));
  }
  _beat() {
    if (!this.connected || !this.isHost) return;
    this._upd(`rooms/${this._code}/meta`, { beat: this._TS }).catch(() => { });
    this._lobby();
    // prune old relay events (anyone may delete events older than the rules' TTL)
    const { D } = this.fb;
    D.get(D.query(this._ref(`rooms/${this._code}/ev`), D.orderByChild('t'), D.endAt(this._now - EV_TTL_MS))).then(s => {
      const del = {}; s.forEach(c => { del[c.key] = null; }); if (Object.keys(del).length) return this._upd(`rooms/${this._code}/ev`, del);
    }).catch(e => console.warn('[net] prune', e?.message));
  }
  _detach() {
    for (const off of this._unsub) try { off(); } catch { }
    this._unsub = []; clearInterval(this._flushT); clearInterval(this._beatT);
    this._code = null; this._hero = null; this._meta = null; this._players = null;
  }
  async _leaveRoom(silent) {
    const code = this._code; if (!code || !this.fb) return;
    const { D } = this.fb, uid = this.id, hero = this._hero;
    this._detach();
    try {
      await D.onDisconnect(this._ref(`rooms/${code}`)).cancel();
      await this._upd(`rooms/${code}`, { [`players/${uid}`]: null, [`state/${uid}`]: null, [`slots/${hero}`]: null });
      const ps = await D.get(this._ref(`rooms/${code}/players`));
      if (!ps.exists()) { await D.remove(this._ref(`rooms/${code}`)); await D.remove(this._ref(`lobby/${code}`)); }
    } catch (e) { console.warn('[net] leave', e?.message); }
    this.room = null;
    if (!silent) this.bus.emit('room:left', {});
  }
  leave() { if (!this._code) return false; this._leaveRoom(false); return true; }

  // ---------------------------------------------------------------- lobby state
  set(o = {}) {
    if (!this._code || !this.room || this.room.started || !this.connected) return false;
    const code = this._code, uid = this.id, up = {};
    if (o.hero !== undefined && o.hero !== this._hero) {
      if (!HEROES.includes(o.hero) || this.room.players.some(p => p.id !== uid && p.hero === o.hero)) { this._err('taken', null, 'The other player has that hero.'); return false; }
      Object.assign(up, { [`slots/${o.hero}`]: uid, [`slots/${this._hero}`]: null, [`players/${uid}/hero`]: o.hero, [`players/${uid}/suit`]: '', [`players/${uid}/ready`]: false });
    }
    if (o.suit !== undefined) up[`players/${uid}/suit`] = o.suit ? String(o.suit).slice(0, 24) : '';
    if (o.ready !== undefined) up[`players/${uid}/ready`] = !!o.ready;
    if (!Object.keys(up).length) return true;
    const newHero = o.hero !== undefined && o.hero !== this._hero ? o.hero : null;
    this._upd(`rooms/${code}`, up).then(() => { if (newHero) { this._hero = newHero; return this._presence(); } })
      .catch(e => this._err(newHero ? 'taken' : 'net', e, newHero ? 'The other player has that hero.' : null));
    return true;
  }
  start() {
    if (!this.isHost || this.room.started) return false;
    if (!this.room.players.every(p => p.ready || p.host)) { this._err('not_ready', null, 'Everyone must be ready.'); return false; }
    const seed = Math.floor(Math.random() * 1e9);
    this._upd('', { [`rooms/${this._code}/meta/started`]: true, [`rooms/${this._code}/meta/seed`]: seed, [`lobby/${this._code}/started`]: true })
      .catch(e => this._err('net', e));
    return true;
  }

  // ---------------------------------------------------------------- game relay
  /** Kind k + payload. Latest-wins kinds (player state) are coalesced and flushed at STATE_HZ; the rest are
   * ordered events. Handlers get `{...payload, from}` exactly like the WS relay. */
  send(k, payload) {
    if (!this._code || !this.connected) return false;
    const d = JSON.stringify(payload ?? null);
    if (d.length > 3800) { console.warn('[net] payload too big', k, d.length); return false; }
    if (LATEST.has(k)) { this._latest.set(k, d); return true; }
    const { D } = this.fb;
    D.set(D.push(this._ref(`rooms/${this._code}/ev`)), { k: String(k).slice(0, 16), d, from: this.id, t: this._TS }).catch(e => console.warn('[net] ev', e?.message));
    return true;
  }
  _flush() {
    if (!this._latest.size || !this.connected || this._inflight) return;
    if ((this.room?.players.length || 0) < 2) { this._latest.clear(); return; }   // nobody to receive it
    const up = {};
    for (const [k, d] of this._latest) if (this._sent.get(k) !== d) { up[k] = d; this._sent.set(k, d); }   // idle = no traffic
    this._latest.clear(); if (!Object.keys(up).length) return;
    const t = performance.now(); this._inflight = true;
    this._upd(`rooms/${this._code}/state/${this.id}`, up).then(() => this._rtt(performance.now() - t)).catch(() => { }).finally(() => { this._inflight = false; });
  }
  _deliver(k, d, from) {
    const fn = this.handlers.get(k); if (!fn) return;
    try { fn(d && typeof d === 'object' && !Array.isArray(d) ? { ...d, from } : { d, from }, from); } catch (e) { console.error('[net] handler', k, e); }
  }
  onMsg(k, fn) { this.handlers.set(k, fn); }

  /** Tests: drop / restore the connection (the server then fires our onDisconnect). */
  goOffline() { this.fb?.D.goOffline(this.fb.db); }
  goOnline() { this.fb?.D.goOnline(this.fb.db); }
}
