// Room: the code big at the top (friends join with it), two player slots with their real suits standing
// on holo pads, ready toggle, change suit, host starts → 3-2-1 countdown → net.start(); the platform then
// loads the world (room:start → loading screen).
import { Screen } from '../lib/app.js';
import { h, esc, scramble, wait } from '../lib/dom.js';
import { HeroPreview } from '../lib/preview.js';

const heroName = h => h === 'spiderman' ? 'Spider-Man' : 'Iron Man';

export class RoomScreen extends Screen {
  static id = 'room';
  build() {
    const MZ = this.MZ, ui = this.ui;
    this.el.classList.add('room');
    this.el.append(
      h('div.ro-top', h('div.ro-code-s', 'Room code'), h('div.ro-code')),
      h('div.ro-slots', this.slotA = h('div.ro-slot'), this.slotB = h('div.ro-slot')),
      this.acts = h('div.ro-acts', { 'data-wrap': '' },
        this.readyBtn = this.btn('Ready', () => this.toggleReady(), 'default'),
        this.suitBtn = this.btn('Change suit', () => ui.go('hero', { next: 'room' })),
        this.startBtn = this.btn('Start mission', () => this.startCountdown()),
        this.btn('Leave room', () => this.leaveRoom(), '', 'ui_leave'),
      ),
      this.cd = h('div.ro-countdown', h('b')),
    );
    this.previews = [0, 1].map(i => new HeroPreview(MZ, { viewport: () => this.vp(i), order: 30 + i, pool: 'room' + i }));
    for (const p of this.previews) p.pad.scale.setScalar(0.8);
    this.listen('room:update', e => this.onUpdate(e));
    this.listen('room:left', () => { if (ui.top === this) { ui.toast('You left the room'); ui.back(); } });
    this.listen('room:error', e => ui.refuse(this.focused, e.code === 'not_ready' ? 'Not everyone is ready' : e.msg || e.code));
    this.listen('room:start', () => { this.cancelCountdown(); ui.sfx('ui_start'); ui.buzz('ui_start'); });
    this.render();
  }
  btn(k, fn, cls = '', sfx = null) { const el = h(`div.item.ro-btn${cls ? '.' + cls : ''}`, { 'data-f': '' }, h('span.k', k)); el._act = fn; if (sfx) el.dataset.sfx = sfx; return el; }
  vp(i) {
    const r = (i === 0 ? this.slotA : this.slotB).querySelector('.ro-stage')?.getBoundingClientRect();
    return r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null;
  }
  players() {
    const room = this.MZ.net.room; if (!room) return [];
    // Iron Man always on the left, Spider-Man on the right — the two roles, not join order
    const im = room.players.find(p => p.hero === 'ironman'), sm = room.players.find(p => p.hero === 'spiderman');
    return [im || null, sm || null];
  }
  onUpdate(e) {
    const ui = this.ui, n = this.MZ.net;
    if (e.joined && e.joined !== n.id) { const p = e.room.players.find(x => x.id === e.joined); ui.toast(`${p?.name || 'Someone'} joined`); ui.sfx('ui_join'); ui.buzz('ui_ready'); }
    if (e.left) { ui.toast('A player left'); ui.sfx('ui_leave'); this.cancelCountdown(); }
    if (e.reassigned && e.you === n.id) ui.toast(`That hero was taken — you fly as ${heroName(n.me?.hero)}`, { ms: 3500 });
    if (n.me && (n.me.hero !== this.MZ.game.hero || n.me.suit !== this.MZ.game.suit)) this.MZ.game.choose(n.me.hero, n.me.suit);
    this.render();
  }
  render() {
    const MZ = this.MZ, n = MZ.net, room = n.room;
    const codeEl = this.el.querySelector('.ro-code');
    if (room && codeEl.dataset.code !== room.code) { codeEl.dataset.code = room.code; codeEl.innerHTML = [...room.code].map((c, i) => `<span style="--i:${i}">${c}</span>`).join(''); }
    const ps = this.players();
    [this.slotA, this.slotB].forEach((el, i) => this.renderSlot(el, ps[i], i === 0 ? 'ironman' : 'spiderman', i));
    const me = n.me, all = room && room.players.length >= 1 && room.players.every(p => p.ready);
    this.readyBtn.querySelector('.k').textContent = me?.ready ? 'Not ready' : 'Ready';
    this.readyBtn.classList.toggle('on', !!me?.ready);
    this.startBtn.style.display = n.isHost ? '' : 'none';
    this.startBtn.classList.toggle('disabled', !all);
    this.startBtn.querySelector('.k').textContent = 'Start';
    this.ui.renderHints();
  }
  renderSlot(el, p, role, i) {
    const MZ = this.MZ, n = MZ.net;
    const key = p ? `${p.id}|${p.suit}|${p.ready}|${p.name}|${p.host}` : 'empty|' + role;
    if (el.dataset.key === key) return;
    const wasReady = el.dataset.ready === '1';
    el.dataset.key = key; el.dataset.ready = p?.ready ? '1' : '0';
    const th = MZ.theme.get(p?.suit) || {};
    el.className = 'ro-slot' + (p ? '' : ' empty') + (p?.ready ? ' ready' : '') + (p && p.id === n.id ? ' me' : '');
    el.style.setProperty('--sa', th.accent || 'var(--mz-dim)'); el.style.setProperty('--sa2', th.accent2 || 'transparent'); el.style.setProperty('--sg', th.glow || 'var(--mz-dim)');
    const suit = MZ.SUITS.find(s => s.id === p?.suit);
    el.innerHTML = '';
    el.append(
      h('div.ro-stage'),
      p ? h('div.ro-info',
        h('div.ro-pname', esc(p.name)),
        h('div.ro-suit', esc(suit?.name || p.suit || '')),
        h('div.ro-ready', p.ready ? 'Ready' : ''),
      ) : h('div.ro-info.wait',
        h('div.ro-pname', heroName(role)),
        h('div.ro-suit', 'Waiting for a friend to join with the code'),
      ),
    );
    if (p?.ready && !wasReady) { el.classList.add('pop'); this.ui.sfx('ui_ready'); this.ui.buzz('ui_ready'); setTimeout(() => el.classList.remove('pop'), 600); }
    const pv = this.previews[i];
    if (p?.suit) { pv.hide(false); pv.show(p.suit); } else { pv.hide(true); pv.curId = null; }
  }
  toggleReady() { const me = this.MZ.net.me; if (me?.ready) this.ui.sfx('ui_unready'); this.MZ.net.set({ ready: !me?.ready }); }
  async startCountdown() {
    const n = this.MZ.net;
    if (!n.isHost) return;
    if (!n.room.players.every(p => p.ready)) return this.ui.refuse(this.startBtn, 'Not everyone is ready');
    this.counting = true; this.cd.classList.add('on');
    const b = this.cd.querySelector('b');
    for (const k of [3, 2, 1]) {
      if (!this.counting) return;
      b.textContent = k; b.classList.remove('tick'); void b.offsetWidth; b.classList.add('tick');
      this.ui.sfx('ui_countdown_' + k); this.ui.buzz('ui_countdown'); this.ui.backdrop.pulse(1);
      await wait(800);
    }
    if (!this.counting) return;
    this.counting = false; n.start();
  }
  cancelCountdown() { if (!this.counting) return; this.counting = false; this.cd.classList.remove('on'); }
  leaveRoom() { this.cancelCountdown(); this.MZ.net.leave(); }
  onBack() { if (this.counting) { this.cancelCountdown(); this.ui.toast('Launch cancelled'); return; } this.leaveRoom(); }
  onPress(id) {
    if (id === 'north') { this.ui.activate(this.suitBtn); return true; }
    if (id === 'west') { this.ui.activate(this.readyBtn); return true; }
    return false;
  }
  enter() { for (const p of this.previews) p.layer.visible = !!p.curId; this.render(); }
  leave() { for (const p of this.previews) p.layer.visible = false; }
  destroy() { super.destroy(); for (const p of this.previews) p.destroy(); }
  update(dt, t) { for (const p of this.previews) p.update(dt, t, 0); }
  hints() {
    const n = this.MZ.net;
    return [{ btn: 'south', label: 'Select' }, { btn: 'west', label: n.me?.ready ? 'Not ready' : 'Ready' }, { btn: 'north', label: 'Suit' }, { btn: 'east', label: this.counting ? 'Cancel' : 'Leave' }];
  }
}
