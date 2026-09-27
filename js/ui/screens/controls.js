// Controls: generated from the LIVE bindings (never hand-written — V2's controls screen lied). Per hero
// (L1/R1). ✕ on a row → press the new button; if another action used it, the two swap (core/bindings.js).
// Locked rows (sticks, pause) can't be remapped. △ restores the defaults for this hero.
import { Screen } from '../lib/app.js';
import { h, esc } from '../lib/dom.js';

export class ControlsScreen extends Screen {
  static id = 'controls';
  static opts = { context: 'ui', bg: true, overlay: false };
  build() {
    const ui = this.ui;
    this.hero = this.MZ.game?.hero || 'ironman';
    this.el.classList.add('controls');
    this.el.append(
      h('div.hs-tabs.pg-tabs', h('span.hs-bump', { html: ui.g('l1') }), this.tIM = h('div.hs-tab', h('span', 'Iron Man')), this.tSM = h('div.hs-tab', h('span', 'Spider-Man')), h('span.hs-bump', { html: ui.g('r1') })),
      this.list = h('div.pg-list.ctl-list', { 'data-wrap': '' }),
      this.noteEl = h('div.ctl-note'),
      this.capEl = h('div.ctl-capture', h('b'), h('span')),
    );
    this.fill();
  }
  fill(keepId) {
    const MZ = this.MZ, B = MZ.bindings;
    this.tIM.classList.toggle('on', this.hero === 'ironman'); this.tSM.classList.toggle('on', this.hero === 'spiderman');
    this.list.innerHTML = '';
    for (const a of B.list(this.hero)) {
      const el = h('div.row.item.ctl-row', { 'data-f': '', 'data-act': a.id, 'data-silent': '1' },
        h('span.ctl-g', { html: a.btn === 'ls' || a.btn === 'rs' ? this.ui.g(a.btn) : this.ui.p(a.id, this.hero) }),
        h('span.row-k', esc(a.name)), h('span.row-v', esc(a.how || '')), a.locked ? h('span.ctl-lock', 'Fixed') : null);
      el._act = () => this.remap(a);
      el._onFocus = () => { this.noteEl.textContent = a.note || ''; };
      this.list.appendChild(el);
    }
    const f = keepId && this.list.querySelector(`[data-act="${keepId}"]`);
    if (f) this.ui.focus(f, { sound: false });
  }
  defaultFocus() { return this.list.querySelector('.ctl-row'); }
  remap(a) {
    const ui = this.ui, MZ = this.MZ;
    if (a.locked) return ui.refuse(this.focused, `${a.name} can’t be changed`);
    ui.sfx('ui_confirm'); ui.buzz('ui_confirm');
    this.capEl.querySelector('b').textContent = a.name;
    this.capEl.querySelector('span').textContent = 'Press the new button';
    this.capEl.classList.add('on');
    this.release = MZ.input.capture(btn => {
      this.capEl.classList.remove('on');
      if (btn === 'start' || btn === 'home') { ui.sfx('ui_back'); return; }        // cancel
      if (!(MZ.bindings.REMAPPABLE || []).includes(btn)) { ui.refuse(null, 'That button can’t be used'); return; }
      const swapped = MZ.bindings.set(this.hero, a.id, btn);
      if (swapped === false) { ui.refuse(null, 'That button is fixed'); return; }
      ui.sfx('ui_confirm'); ui.buzz('ui_confirm');
      if (swapped) ui.toast(`Swapped with ${swapped.name}`);
      this.fill(a.id); ui.refreshGlyphs();
    });
  }
  setHero(hero) { if (hero === this.hero) return; this.hero = hero; this.ui.sfx('ui_tab'); this.ui.buzz('ui_tab'); this.fill(); this.ui.focus(this.defaultFocus(), { sound: false }); }
  onPress(id) {
    if (id === 'l1' || id === 'r1') { this.setHero(id === 'l1' ? 'ironman' : 'spiderman'); return true; }
    if (id === 'north') { this.MZ.bindings.reset(this.hero); this.fill(this.focused?.dataset.act); this.ui.refreshGlyphs(); this.ui.toast('Defaults restored'); this.ui.sfx('ui_confirm'); return true; }
    return false;
  }
  destroy() { super.destroy(); this.release?.(); }
  hints() { return [{ btn: 'south', label: 'Change' }, { btns: ['l1', 'r1'], label: 'Hero' }, { btn: 'north', label: 'Defaults' }, { btn: 'east', label: 'Back' }]; }
}
