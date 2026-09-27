// Co-op: host a room, join one from the list of open rooms, enter a code, or fly solo.
// Code entry is pad-native: 4 letters, D-pad ↕ changes the letter (the room alphabet has no I/O), ↔ moves.
import { Screen } from '../lib/app.js';
import { h, esc } from '../lib/dom.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const heroName = h => h === 'spiderman' ? 'Spider-Man' : 'Iron Man';
const msgFor = e => ({ no_room: 'No room with that code', full: 'That room is full', started: 'That room already started', taken: 'That hero is taken', not_ready: 'Not everyone is ready' })[e.code] || e.msg || 'Refused';

export class RoomsScreen extends Screen {
  static id = 'rooms';
  build() {
    const MZ = this.MZ, ui = this.ui;
    this.el.classList.add('rooms');
    this.el.append(
      h('div.rm-head', h('div.rm-title', 'Co-op'), this.youEl = h('div.rm-you')),
      h('div.rm-actions', { 'data-wrap': '' },
        this.hostBtn = this.act('Host a room', 'A friend joins with its code', () => this.host(), this.params.mode !== 'join' ? 'default' : ''),
        this.codeBtn = this.act('Enter a code', 'The four letters on your friend’s screen', () => ui.go('code'), this.params.mode === 'join' ? 'default' : ''),
        this.act('Fly solo', 'Straight into the city', () => MZ.game.solo(MZ.game.hero, MZ.game.suit)),
      ),
      h('div.rm-open',
        h('div.rm-open-t', 'Open rooms'),
        this.list = h('div.rm-list', { 'data-wrap': '' }),
        this.empty = h('div.rm-empty'),
      ),
    );
    this.listen('net:rooms', () => this.renderList());
    this.listen('net:status', () => { this.renderNet(); if (MZ.net.status === 'online') MZ.net.list(); });
    this.listen('suit:change', () => this.renderYou());
    this.listen('room:update', e => { if (this.pendingHost || this.pendingJoin) { this.pendingHost = this.pendingJoin = false; ui.sfx(e.created ? 'ui_room_created' : 'ui_join'); ui.buzz(e.created ? 'ui_room_created' : 'ui_player_joined'); ui.go('room'); } });
    this.listen('room:error', e => { this.pendingJoin = false; ui.refuse(ui.top?.focused, msgFor(e)); });
    this.renderYou(); this.renderNet(); this.renderList();
    MZ.net.list?.();
  }
  act(k, s, fn, cls = '') { const el = h(`div.item.rm-act${cls ? '.' + cls : ''}`, { 'data-f': '' }, h('span.k', k), h('span.s', s)); el._act = fn; return el; }
  renderYou() { const MZ = this.MZ; this.youEl.textContent = `${heroName(MZ.game.hero)} · ${MZ.SUITS.find(x => x.id === MZ.game.suit)?.name || ''}`; }
  renderNet() {
    const on = this.MZ.net.status === 'online';
    for (const b of [this.hostBtn, this.codeBtn]) b.classList.toggle('disabled', !on);
    this.renderList();
  }
  renderList() {
    const MZ = this.MZ, on = MZ.net.status === 'online', rooms = on ? (MZ.net.rooms || []).filter(r => !r.started && r.name !== 'solo') : [];
    const keep = this.ui.top === this && this.focused?.dataset.code;
    this.list.innerHTML = '';
    for (const r of rooms) {
      const host = r.players.find(p => p.host) || r.players[0];
      const taken = new Set(r.players.map(p => p.hero)), free = ['ironman', 'spiderman'].find(x => !taken.has(x));
      const el = h('div.rm-room.tile', { 'data-f': '', 'data-code': r.code }, h('div.ring'),
        h('b.rm-code', r.code), h('div.rm-host', esc(host?.name || '?')), h('div.rm-free', free ? `${heroName(free)} free` : 'Full'));
      el._act = () => this.join(r.code);
      this.list.appendChild(el);
    }
    this.empty.textContent = !on ? (window.MZ_STATIC ? 'Online co-op is coming soon. Fly solo for now.' : 'Can’t reach the room service — you can still fly solo.') : rooms.length ? '' : 'Nobody is hosting right now.';
    if (keep) { const f = this.list.querySelector(`[data-code="${keep}"]`); this.ui.focus(f || this.defaultFocus(), { sound: false }); }
  }
  host() { const MZ = this.MZ; this.pendingHost = true; MZ.net.host({ hero: MZ.game.hero, suit: MZ.game.suit }); }
  join(code) { const MZ = this.MZ; this.pendingJoin = true; MZ.net.join(code, { hero: MZ.game.hero, suit: MZ.game.suit }); }
  onPress(id) { if (id === 'north') { this.ui.sfx('ui_confirm'); this.ui.go('hero', { next: 'back' }); return true; } return false; }
  enter(ret) { this.renderYou(); if (ret) this.MZ.net.list?.(); }
  hints() { return [{ btn: 'south', label: 'Select' }, { btn: 'north', label: 'Change hero' }, { btn: 'east', label: 'Back' }]; }
}

export class CodeScreen extends Screen {
  static id = 'code';
  build() {
    this.el.classList.add('codes');
    this.code = [0, 0, 0, 0]; this.slot = 0;
    this.el.append(
      h('div.cd-box',
        h('div.cd-title', 'Room code'),
        this.slotsEl = h('div.cd-slots', ...[0, 1, 2, 3].map(i => h('div.cd-slot', { 'data-i': i }, h('b')))),
        this.msg = h('div.cd-msg'),
      ),
    );
    this.listen('room:update', () => { if (this.pending) { this.pending = false; this.ui.sfx('ui_join'); this.ui.buzz('ui_player_joined'); this.ui.go('room', {}, { replace: true }); } });
    this.listen('room:error', e => { if (!this.pending) return; this.pending = false; this.msg.textContent = msgFor(e); this.msg.classList.add('err'); this.ui.refuse(this.slotsEl); });
    this._key = e => { const k = e.key?.toUpperCase(); if (k?.length === 1 && ALPHA.includes(k)) { this.code[this.slot] = ALPHA.indexOf(k); if (this.slot < 3) this.slot++; this.render(true); } };
    addEventListener('keydown', this._key);
    this.render();
  }
  destroy() { super.destroy(); removeEventListener('keydown', this._key); }
  get str() { return this.code.map(i => ALPHA[i]).join(''); }
  render(bump = false) {
    [...this.slotsEl.children].forEach((el, i) => {
      el.classList.toggle('on', i === this.slot);
      el.querySelector('b').textContent = ALPHA[this.code[i]];
      if (bump && i === this.slot) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    });
    if (this.ui.top === this) this.ui.renderHints();
  }
  defaultFocus() { return null; }
  onNav(dir) {
    if (dir === 'up' || dir === 'down') { this.code[this.slot] = (this.code[this.slot] + (dir === 'up' ? -1 : 1) + ALPHA.length) % ALPHA.length; this.ui.sfx('ui_tick'); this.ui.buzz('ui_tick'); this.render(true); return true; }
    const n = this.slot + (dir === 'left' ? -1 : 1);
    if (n >= 0 && n <= 3) { this.slot = n; this.ui.sfx('ui_focus'); this.ui.buzz('ui_tick'); this.render(); }
    return true;
  }
  onPress(id) {
    if (id === 'south') { if (this.slot < 3) { this.slot++; this.ui.sfx('ui_focus'); this.render(); } else this.submit(); return true; }
    if (id === 'north' || id === 'start') { this.submit(); return true; }
    return false;
  }
  submit() {
    const MZ = this.MZ;
    if (MZ.net.status !== 'online') return this.ui.refuse(this.slotsEl, 'Can’t reach the room service');
    this.pending = true; this.msg.classList.remove('err'); this.msg.textContent = `Joining ${this.str}…`;
    this.ui.sfx('ui_confirm'); this.ui.buzz('ui_confirm');
    MZ.net.join(this.str, { hero: MZ.game.hero, suit: MZ.game.suit });
  }
  hints() { return [{ btn: 'dpad', label: 'Letters' }, { btn: 'south', label: this.slot < 3 ? 'Next' : 'Join' }, { btn: 'east', label: 'Back' }]; }
}
