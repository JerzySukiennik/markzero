// Hero select: the suit is the hero of the screen. Two words at the top (Iron Man / Spider-Man, L1/R1),
// the armour list, the suit's name and one line about it. Focusing a suit re-themes the whole UI
// (theme.set = preview, game.choose on confirm = commit) and the real model builds up in ≤ 1.1 s.
//   params.next: 'rooms' (default) | 'solo' | 'room' (back into the room, net.set) | 'back'
import { Screen } from '../lib/app.js';
import { h, esc } from '../lib/dom.js';
import { HeroPreview } from '../lib/preview.js';

// The menu lists MZ.ROSTER (UI-CONTRACT): Hulkbuster is summoned in game over any Iron Man suit and Peter
// is Spider-Man out of the suit (story intro) — both are in MZ.SUITS but not selectable.
const selectable = (MZ, hero) => MZ.ROSTER.filter(s => s.hero === hero);

export class HeroScreen extends Screen {
  static id = 'hero';
  static opts = { context: 'ui', bg: true, overlay: false };
  build() {
    const MZ = this.MZ, ui = this.ui;
    this.el.classList.add('hero-sel');
    let cur = MZ.game?.suit || MZ.theme.id || 'mk85';
    if (!MZ.ROSTER.some(s => s.id === cur)) cur = MZ.SUITS.find(s => s.id === cur)?.hero === 'spiderman' ? MZ.HEROES.spiderman.defaultSuit : MZ.HEROES.ironman.defaultSuit;
    this.hero = MZ.SUITS.find(s => s.id === cur)?.hero || 'ironman';
    this.committed = cur;
    this.el.append(
      this.tabs = h('div.hs-tabs',
        h('span.hs-bump', { html: ui.g('l1') }),
        this.tabIM = this.tab('ironman', 'Iron Man'),
        this.tabSM = this.tab('spiderman', 'Spider-Man'),
        h('span.hs-bump', { html: ui.g('r1') }),
      ),
      this.list = h('div.hs-list', { 'data-wrap': '' }),
      h('div.hs-info', this.nameEl = h('div.hs-name'), this.eraEl = h('div.hs-era')),
      this.loadEl = h('div.hs-loading', h('i')),
    );
    this.fillList();
    this.preview = new HeroPreview(MZ, { viewport: () => this.vp(), order: 30, pool: 'hero' });
    this.preview.onState = st => { this.loadEl.classList.remove('on'); if (st === 'error') this.eraEl.textContent = 'This suit failed to load.'; };
  }
  vp() { const w = innerWidth, hh = innerHeight; return { x: Math.round(w * 0.27), y: 0, w: Math.round(w * 0.5), h: hh }; }
  tab(hero, label) {
    const el = h('div.hs-tab', { 'data-f': '', 'data-hero': hero, 'data-nav-down': '.hs-suit.sel, .hs-suit' }, h('span', label));
    el._act = () => this.setHero(hero, true); el._onFocus = () => this.setHero(hero);
    return el;
  }
  fillList() {
    const MZ = this.MZ;
    this.tabIM.classList.toggle('on', this.hero === 'ironman'); this.tabSM.classList.toggle('on', this.hero === 'spiderman');
    this.list.innerHTML = '';
    selectable(MZ, this.hero).forEach((s, i) => {
      const el = h('div.hs-suit.item', { 'data-f': '', 'data-suit': s.id, '--i': i },
        h('span.k', s.name.replace('Mark ', 'Mk ')), s.id === this.committed ? h('span.eq', 'Equipped') : null);
      el._act = () => this.choose(s);
      el._onFocus = () => this.preview_(s);
      this.list.appendChild(el);
    });
  }
  setHero(hero, jump = false) {
    if (hero === this.hero) { if (jump) this.ui.focus(this.list.querySelector('[data-suit]')); return; }
    this.hero = hero; this.fillList();
    this.ui.sfx('ui_tab'); this.ui.buzz('ui_tab');
    const def = this.MZ.HEROES[hero]?.defaultSuit;
    const first = this.list.querySelector(`[data-suit="${def}"]`) || this.list.querySelector('[data-suit]');
    if (jump || this.ui.top?.focused?.classList.contains('hs-suit') === false) this.preview_(this.MZ.SUITS.find(s => s.id === first.dataset.suit));
    if (jump) this.ui.focus(first, { sound: false });
  }
  preview_(s) {
    if (!s) return;
    const MZ = this.MZ;
    if (MZ.theme.id !== s.id) { MZ.theme.set(s.id); this.ui.sfx('ui_stinger'); this.ui.buzz('ui_suit_change', 0.6); }
    for (const el of this.list.querySelectorAll('.hs-suit')) el.classList.toggle('sel', el.dataset.suit === s.id);
    this.nameEl.textContent = s.name;
    this.nameEl.classList.remove('in'); void this.nameEl.offsetWidth; this.nameEl.classList.add('in');
    this.eraEl.textContent = s.era;
    this.loadEl.classList.add('on');
    this.preview.show(s.id).then(() => { this.loadEl.classList.remove('on'); this.preloadRest(); });
    this.cur = s;
  }
  /** Warm every other suit of this hero in the background, one at a time, so stopping on any of them is instant. */
  // Only while this screen is on top and the player lingers (1.2 s): the moment they pick a suit the world
  // starts streaming (~300 MB on a first visit to the web build) and must not share the bandwidth with
  // previews nobody will look at. One GLB at a time; an in-flight one is allowed to finish.
  async preloadRest() {
    if (this._pre) return; this._pre = true;
    const idle = () => !this.dead && this.ui.top === this && this.MZ.game?.phase === 'menu';
    await new Promise(r => setTimeout(r, 1200));
    for (const s of selectable(this.MZ, this.hero).filter(x => x.id !== this.cur?.id)) { if (!idle()) break; try { await HeroPreview.preload(this.MZ, s.id, 'hero'); } catch { } }
    this._pre = false;
  }
  choose(s) {
    const MZ = this.MZ, ui = this.ui;
    ui.buzz('suit_select');
    MZ.game.choose(s.hero, s.id);
    this.committed = s.id;
    const next = this.params.next || 'rooms';
    if (next === 'solo') MZ.game.solo(s.hero, s.id);
    else if (next === 'room') { MZ.net.set({ hero: s.hero, suit: s.id }); ui.back(); }
    else if (next === 'back') ui.back();
    else ui.go('rooms', { mode: 'host' });
  }
  onPress(id) {
    if (id === 'l1' || id === 'r1') { this.setHero(id === 'l1' ? 'ironman' : 'spiderman', true); return true; }
    return false;
  }
  onBack() { if (this.MZ.theme.id !== this.committed) this.MZ.theme.set(this.committed); this.ui.back(); }
  enter() { this.preview.hide(false); }
  defaultFocus() { return this.list.querySelector(`[data-suit="${this.committed}"]`) || this.list.querySelector('[data-suit]'); }
  leave() { this.preview.hide(true); }
  destroy() { super.destroy(); this.dead = true; this.preview.destroy(); }
  update(dt, t) { this.preview.update(dt, t, this.MZ.input.axes?.rx || 0); }
  hints() { return [{ btn: 'south', label: this.params.next === 'solo' ? 'Fly' : 'Choose' }, { btn: 'east', label: 'Back' }, { btns: ['l1', 'r1'], label: 'Hero' }, { btn: 'rs_x', label: 'Turn' }]; }
}
