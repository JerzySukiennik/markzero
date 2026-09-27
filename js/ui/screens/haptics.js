// Haptics: every pattern in the live library (assets/haptics/haptics.json via core/haptics.js), grouped.
// ✕ plays it on the pad; the timeline on the right draws what you should feel (strong motor above the
// line, weak below, trigger rumble as ticks) so it can be checked without a pad too.
import { Screen } from '../lib/app.js';
import { h, esc } from '../lib/dom.js';

const GROUPS = { ui: 'Menus', ironman: 'Iron Man', spider: 'Spider-Man', spiderman: 'Spider-Man', both: 'Both heroes', suit: 'Suits', suitup: 'Suit-up', combat: 'Combat', damage: 'Taking hits', movement: 'Movement', world: 'World', lib: 'Other' };

export class HapticsScreen extends Screen {
  static id = 'haptics';
  static opts = { context: 'ui', bg: true, overlay: false };
  build() {
    const Hp = this.MZ.haptics;
    this.el.classList.add('haptics');
    const sup = Hp.supported?.() || [];
    this.el.append(
      h('div.pg-title', 'Haptics'),
      h('div.hp-sub', sup.length ? (sup.includes('trigger-rumble') ? 'Rumble and trigger rumble' : 'Rumble') : 'No rumble on this controller (or none connected)'),
      this.list = h('div.pg-list.hp-list', { 'data-wrap': '' }),
      h('div.hp-view', this.nameEl = h('b'), this.descEl = h('span'), this.svg = h('div.hp-tl')),
    );
    // the design library's categories (core/haptics.js keeps only the steps); list exactly that library
    fetch('/v3assets/haptics/haptics.json').then(r => r.ok ? r.json() : null).catch(() => null).then(j => this.fill(j?.patterns || null));
  }
  fill(src) {
    const Hp = this.MZ.haptics, by = {};
    const ids = src ? Object.keys(src).filter(id => Hp.lib[id]) : Object.keys(Hp.lib || {});
    for (const id of ids) { const p = Hp.lib[id]; (by[src?.[id]?.cat || p.group || 'lib'] ||= []).push([id, { ...p, desc: src?.[id]?.desc || p.desc }]); }
    for (const [g, items] of Object.entries(by)) {
      this.list.appendChild(h('div.row-h', GROUPS[g] || g));
      for (const [id, p] of items) {
        const el = h('div.row.item', { 'data-f': '', 'data-silent': '1' }, h('span.row-k', label(id)), h('span.row-v', `${dur(p.steps)} ms`));
        el._act = () => { Hp.play(id); el.classList.add('playing'); setTimeout(() => el.classList.remove('playing'), dur(p.steps) + 80); this.flash(); };
        el._onFocus = () => this.show(id, p);
        this.list.appendChild(el);
      }
    }
    if (this.ui.top === this) this.ui.focus(this.list.querySelector('.row'), { sound: false });
  }
  show(id, p) {
    this.nameEl.textContent = label(id); this.descEl.textContent = p.desc || '';
    const T = Math.max(200, dur(p.steps)), W = 520, H = 160, m = H / 2;
    const bars = p.steps.map(s => {
      const x = (s.t || 0) / T * W, w = Math.max(2, s.dur / T * W);
      const tr = (s.left || s.right) ? `<rect x="${x}" y="${H - 6}" width="${w}" height="4" class="tr"/>` : '';
      return `<rect x="${x}" y="${m - (s.strong || 0) * (m - 10)}" width="${w}" height="${(s.strong || 0) * (m - 10)}" class="st"/><rect x="${x}" y="${m}" width="${w}" height="${(s.weak || 0) * (m - 10)}" class="wk"/>${tr}`;
    }).join('');
    this.svg.innerHTML = `<svg viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${m}" y2="${m}" class="ax"/>${bars}</svg><div class="hp-leg"><span>Strong motor</span><span>Weak motor</span><span>${T} ms</span></div>`;
  }
  flash() { this.svg.classList.remove('go'); void this.svg.offsetWidth; this.svg.classList.add('go'); }
  hints() { return [{ btn: 'south', label: 'Play' }, { btn: 'east', label: 'Back' }]; }
}
const dur = steps => Math.round(Math.max(...steps.map(s => (s.t || 0) + (s.dur || 0))));
const label = id => id.replace(/^ui_/, 'menu ').replace(/_/g, ' ').replace(/\b\w/, c => c.toUpperCase());
