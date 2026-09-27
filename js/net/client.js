// Room-service client (server/rooms.mjs). Reconnects by itself; emits net:* and room:* events on the
// app bus. Game state is relayed with send('s', …) → other players get {t:'s', from, …}.
export class Net {
  constructor(bus) {
    this.bus = bus; this.status = 'offline'; this.rtt = null; this.id = null;
    this.rooms = []; this.room = null; this.browsing = false;
    this.name = (() => { try { return localStorage.getItem('mz3.name') || ''; } catch { return ''; } })() || 'Player ' + Math.floor(100 + Math.random() * 900);
    this.handlers = new Map();   // 's' payload kind -> fn
    this._retry = 0;
  }
  setName(n) { this.name = String(n).slice(0, 20); try { localStorage.setItem('mz3.name', this.name); } catch { } this._send({ t: 'hello', name: this.name }); }
  get isHost() { return !!this.room && this.room.host === this.id; }
  get me() { return this.room?.players.find(p => p.id === this.id) || null; }

  connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/net`;
    this._status('connecting');
    const ws = this.ws = new WebSocket(url);
    ws.onopen = () => { this._retry = 0; };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this._on(m); };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this._status('offline');
      if (this.room) { this.room = null; this.bus.emit('room:left', { reason: 'disconnected' }); }
      setTimeout(() => this.connect(), Math.min(8000, 500 * 2 ** this._retry++));
    };
    clearInterval(this._ping);
    this._ping = setInterval(() => this._send({ t: 'ping', ts: performance.now() }), 2000);
  }
  _status(s) { if (s === this.status) return; this.status = s; this.bus.emit('net:status', { state: s, rtt: this.rtt }); }
  _send(m) { if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; } return false; }

  _on(m) {
    switch (m.t) {
      case 'welcome': this.id = m.id; this._send({ t: 'hello', name: this.name, client: this.client }); this._status('online'); if (this.browsing) this._send({ t: 'list' }); break;
      case 'pong': this.rtt = performance.now() - m.ts; break;
      case 'rooms': this.rooms = m.rooms; this.bus.emit('net:rooms', { rooms: m.rooms }); break;
      case 'room': {
        const first = !this.room;
        this.room = m.room;
        this.bus.emit('room:update', { room: m.room, you: this.id, joined: m.joined, left: m.left, reassigned: m.reassigned, created: first && m.room.host === this.id });
        break;
      }
      case 'error': this.bus.emit('room:error', { code: m.code, msg: m.msg }); break;
      case 'left': this.room = null; this.bus.emit('room:left', {}); break;
      case 'start': this.room = m.room; this.bus.emit('room:start', { room: m.room, seed: m.seed }); break;
      case 's': { const fn = this.handlers.get(m.k); if (fn) fn(m.d !== undefined ? { ...m.d, from: m.from } : m, m.from); break; }
    }
  }
  list() { this.browsing = true; this._send({ t: 'list' }); }
  host({ hero, suit, room } = {}) { return this._send({ t: 'host', name: this.name, hero, suit, room }); }
  join(code, { hero, suit } = {}) { return this._send({ t: 'join', code, name: this.name, hero, suit }); }
  set(o) { return this._send({ t: 'set', ...o }); }
  start() { return this._send({ t: 'start' }); }
  leave() { return this._send({ t: 'leave' }); }
  /** Game relay: kind k + payload. */
  /** Game relay: kind k + payload. The payload travels in `d`, so its fields can never clobber the envelope
   * (story found `{t: 'start'}` turning into a room START). Handlers get `{...payload, from}`. */
  send(k, payload) { return this._send({ t: 's', k, d: payload }); }
  onMsg(k, fn) { this.handlers.set(k, fn); }
}
