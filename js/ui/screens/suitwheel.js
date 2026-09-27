// Suit wheel (Iron Man, in game): opened by the gameplay code while D-pad ↓ is held —
//   MZ.ui.suitWheel(true, items, onPick)   ·   MZ.ui.suitWheel(false)   (release)
// Items sit on a ring; either stick (or D-pad ←/→, L1/R1) highlights one and the WHOLE UI re-themes to it
// live. Releasing ↓ (suitWheel(false)) or ✕ picks the highlight → onPick(item); ○ cancels → onPick(null)
// and the theme returns to the current suit. Minimal: names on a ring, the highlighted one big in the
// middle. The world keeps running behind a light scrim.
import { Screen } from '../lib/app.js';
import { h, esc } from '../lib/dom.js';

export class SuitWheelScreen extends Screen {
  static id = 'suitwheel';
  static opts = { context: 'ui', bg: false, overlay: true, hideUnder: true };   // the HUD goes away, no blurred smear
  build() {
    const MZ = this.MZ;
    this.items = (this.params.items?.length ? this.params.items : MZ.ROSTER.filter(s => s.hero === 'ironman')).map(it => typeof it === 'string' ? (MZ.SUITS.find(s => s.id === it) || { id: it, name: it }) : it);
    this.onPick = this.params.onPick || (() => { });
    this.start = MZ.game?.suit || MZ.theme.id;
    this.sel = Math.max(0, this.items.findIndex(i => i.id === this.start));
    this.el.classList.add('suitwheel');
    const N = this.items.length;
    this.el.append(
      h('div.sw-scrim'),
      this.ring = h('div.sw-ring', ...this.items.map((it, i) => {
        const a = (i / N) * Math.PI * 2 - Math.PI / 2;
        return h(`div.sw-item${it.locked ? '.locked' : ''}${it.id === this.start ? '.cur' : ''}`, { style: { '--x': Math.cos(a).toFixed(3), '--y': Math.sin(a).toFixed(3) } }, h('span', esc((it.name || it.id).replace('Mark ', 'Mk '))));
      })),
      h('div.sw-center', this.nameEl = h('b'), this.subEl = h('span')),
    );
    this.highlight(this.sel, true);
  }
  highlight(i, silent = false) {
    const N = this.items.length; i = ((i % N) + N) % N;
    if (i === this.sel && !silent) return;
    this.sel = i;
    const it = this.items[i];
    [...this.ring.children].forEach((e, k) => e.classList.toggle('on', k === i));
    this.nameEl.textContent = it.name || it.id;
    this.subEl.textContent = it.locked ? (it.why || 'Not available') : it.id === this.start ? 'Current' : (it.sub || it.era || '');
    if (!it.locked && this.MZ.theme.id !== it.id && this.MZ.theme.get(it.id)) this.MZ.theme.set(it.id);
    if (!silent) { this.ui.sfx('ui_focus'); this.ui.buzz('ui_tick'); }
  }
  update() {
    const ax = this.MZ.input.axes || {};
    for (const [x, y] of [[ax.lx || 0, ax.ly || 0], [ax.rx || 0, ax.ry || 0]]) {
      if (Math.hypot(x, y) < 0.55) continue;
      const a = Math.atan2(y, x) + Math.PI / 2, N = this.items.length;
      this.highlight(Math.round(((a / (Math.PI * 2)) * N + N) % N) % N);
      break;
    }
  }
  onNav(dir) { if (dir === 'left' || dir === 'right') this.highlight(this.sel + (dir === 'right' ? 1 : -1)); return true; }
  onPress(id) {
    if (id === 'l1' || id === 'r1') { this.highlight(this.sel + (id === 'r1' ? 1 : -1)); return true; }
    if (id === 'south') { this.close(true); return true; }
    if (id === 'down') return true;          // the button that holds it open
    return false;
  }
  onBack() { this.close(false); }
  /** pick = true → onPick(highlighted) (unless locked or unchanged → null); false → cancel. */
  close(pick) {
    if (this.closed) return; this.closed = true;
    const it = this.items[this.sel];
    const chosen = pick && it && !it.locked && it.id !== this.start ? it : null;
    if (!chosen && this.MZ.theme.id !== this.start) this.MZ.theme.set(this.start);
    if (chosen) { this.ui.sfx('ui_stinger'); this.ui.buzz('suit_select'); } else this.ui.sfx(pick && it?.locked ? 'ui_error' : 'ui_back');
    if (this.ui.top === this) this.ui.back();
    try { this.onPick(chosen); } catch (e) { console.error('[suitwheel] onPick', e); }
  }
  hints() { return [{ btn: 'ls', label: 'Choose' }, { btn: 'south', label: 'Suit up' }, { btn: 'east', label: 'Cancel' }]; }
}
