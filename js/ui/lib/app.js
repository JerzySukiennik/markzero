// The UI application: screen stack + router, pad-first focus graph (spatial navigation with explicit
// overrides), hint bar generated from glyphs, sound + haptic feedback on every interaction, mouse as a
// secondary input, glyph/prompt refresh when the pad family or the bindings change.
//
// Conventions (UI-CONTRACT §3): south = confirm, east = back, start = pause ONLY, select/touchpad = map.
import { h, $$, clamp } from './dom.js';

const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
// logical id → pack id (functions so suit-specific ids resolve at play time)
const SFX = {
  ui_open: () => 'ui_panel_open', ui_close: () => 'ui_panel_close', ui_join: () => 'ui_player_joined', ui_leave: () => 'ui_player_left',
  ui_start: () => 'ui_countdown_go', ui_suit_change: () => 'ui_retint_wave', ui_stinger_ironman: () => 'ui_stinger', ui_stinger_spider: () => 'ui_stinger',
  ui_unready: () => 'ui_unready',
};
const HAPTIC = { ui_start: () => 'ui_countdown_go', suit_select: MZ => `suit_${MZ.theme.id}`, ui_join: () => 'ui_player_joined', ui_leave: () => 'ui_player_left' };

export class Screen {
  /** name, context ('ui' | 'game'), bg (draw the menu backdrop), overlay (keep the screen below visible) */
  static opts = { context: 'ui', bg: true, overlay: false };
  constructor(ui, params = {}) {
    this.ui = ui; this.MZ = ui.MZ; this.params = params;
    this.el = h('div.screen'); this.focused = null; this.offs = [];
    const o = this.constructor.opts; this.context = o.context; this.bg = o.bg; this.overlay = o.overlay;
    this.el.dataset.screen = this.constructor.id || '';
  }
  build() { }
  enter() { }
  leave() { }
  destroy() { for (const f of this.offs) f(); this.offs = []; }
  /** Subscribe to a platform event for the screen's lifetime. */
  listen(type, fn) { this.offs.push(this.MZ.on(type, fn)); }
  update() { }
  hints() { return [{ btn: 'south', label: 'Select' }, { btn: 'east', label: 'Back' }]; }
  onPress() { return false; }         // return true when handled
  onNav() { return false; }           // return true when handled (sliders etc.)
  onBack() { this.ui.back(); }
  focusables() { return $$('[data-f]', this.el).filter(e => e.offsetParent !== null || e.dataset.fAlways != null); }
  defaultFocus() { return this.el.querySelector('[data-f].default') || this.focusables()[0] || null; }
}

export class UI {
  constructor(MZ, root) {
    this.MZ = MZ; this.root = root; this.registry = {}; this.stack = [];
    this.hintsEl = document.getElementById('hints') || h('div#hints');
    this.toastEl = document.getElementById('toast') || h('div#toast');
    this.fxEl = document.getElementById('fx');
    this.wipe = h('div.wipe', h('i'), h('b')); document.body.appendChild(this.wipe);
    this.settings = loadSettings();
    this.state = { waypoint: null };        // shared between screens (map places it, the HUD draws it in the world)
    this.t = 0; this._hintKey = '';
    this.applySettings();

    MZ.on('input:nav', e => this._nav(e));
    MZ.on('input:press', e => this._press(e));
    MZ.on('input:release', e => this.top?.onRelease?.(e));
    MZ.on('input:family', () => this.refreshGlyphs());
    MZ.on('input:pad', e => { this.refreshGlyphs(); this.toast(e.connected ? `${MZ.input.family === 'xbox' ? 'Xbox controller' : 'DualShock'} connected` : 'Controller disconnected', { err: !e.connected }); });
    MZ.on('frame', e => this._frame(e));

    // mouse: secondary input — hover focuses, click confirms, the cursor only shows while the mouse moves
    let hideT = 0;
    addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      document.documentElement.classList.add('mouse'); clearTimeout(hideT);
      hideT = setTimeout(() => document.documentElement.classList.remove('mouse'), 2500);
      const f = e.target.closest?.('[data-f]');
      if (f && this.top?.el.contains(f) && f !== this.top.focused) this.focus(f, { sound: true, mouse: true });
    });
    addEventListener('click', e => {
      const f = e.target.closest?.('[data-f]');
      if (f && this.top?.el.contains(f)) { this.focus(f, { sound: false }); this.activate(f); }
    });
    addEventListener('contextmenu', e => { e.preventDefault(); this._press({ id: 'east' }); });
    addEventListener('wheel', e => this.top?.onWheel?.(e), { passive: true });
  }

  get top() { return this.stack[this.stack.length - 1] || null; }
  register(Cls) { this.registry[Cls.id] = Cls; }

  // ------------------------------------------------------------------ routing
  go(id, params = {}, { replace = false, fx = true } = {}) {
    const Cls = this.registry[id]; if (!Cls) { console.warn('[ui] no screen', id); return null; }
    const prev = this.top;
    const s = new Cls(this, params);
    s.build();
    this.root.appendChild(s.el);
    if (prev) {
      prev.leave();
      if (replace) { this.stack.pop(); this._retire(prev); }
      else if (!s.overlay || s.constructor.opts.hideUnder) prev.el.classList.add('under-hidden', ...(prev.context === 'game' ? ['instant'] : []));   // the HUD never lingers over a menu
      else prev.el.classList.add('under');
    }
    this.stack.push(s);
    this._activate(s, fx);
    return s;
  }
  back() {
    if (this.stack.length <= 1) return false;
    const s = this.stack.pop(); s.leave(); this._retire(s);
    const t = this.top; t.el.classList.remove('under', 'under-hidden', 'instant');
    this._activate(t, true, true);
    return true;
  }
  /** Replace the whole stack with one screen (phase changes: menu ⇄ game). */
  reset(id, params = {}) {
    const old = this.stack.splice(0); for (const s of old) { s.leave(); this._retire(s); }
    return this.go(id, params);
  }
  find(id) { return this.stack.find(s => s.constructor.id === id); }
  _retire(s) {
    s.el.classList.remove('in'); s.el.classList.add('out');
    s.destroy();
    setTimeout(() => s.el.remove(), 420);
  }
  _activate(s, fx, returning = false) {
    this.MZ.input.context = s.context;
    if (this.MZ.perf) this.MZ.perf.label = 'ui:' + s.constructor.id;
    document.documentElement.dataset.screen = s.constructor.id;
    requestAnimationFrame(() => requestAnimationFrame(() => s.el.classList.add('in')));
    if (fx && s.constructor.id !== 'hud') this.flash();
    s.enter(returning);
    const f = (s.focused && s.el.contains(s.focused)) ? s.focused : s.defaultFocus();
    if (f) this.focus(f, { sound: false }); else s.focused = null;
    this.renderHints(true);
    this.onScreen?.(s);
  }
  /** Transition juice: a thin light sweep + a chromatic fringe on the incoming screen. */
  flash() { }   // transitions are plain fades + a short rise now (the light sheet / chroma read as "AI slop")

  // ------------------------------------------------------------------ focus graph
  focus(el, { sound = true, mouse = false } = {}) {
    const s = this.top; if (!s || !el) return;
    if (s.focused === el && el.classList.contains('focus')) return;
    s.focused?.classList.remove('focus');
    s.focused = el; el.classList.add('focus');
    if (!mouse) el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (sound) { this.sfx('ui_focus'); this.buzz('ui_tick'); }
    s.onFocus?.(el);
    el._onFocus?.();
    this.renderHints();
  }
  /** Spatial navigation: nearest focusable in the direction, weighted against sideways drift.
   * Overrides: data-nav-<dir>="css selector" | "none"; data-wrap on a container wraps inside it. */
  move(dir) {
    const s = this.top; const cur = s?.focused;
    const all = s.focusables(); if (!all.length) return false;
    if (!cur || !all.includes(cur)) { this.focus(s.defaultFocus() || all[0]); return true; }
    const ov = cur.dataset['nav' + dir[0].toUpperCase() + dir.slice(1)];
    if (ov === 'none') return false;
    if (ov) { const t = s.el.querySelector(ov); if (t) { this.focus(t); return true; } }
    const best = pickSpatial(cur, all, dir);
    if (best) { this.focus(best); return true; }
    // wrap inside a data-wrap container (lists)
    const wrap = cur.closest('[data-wrap]');
    if (wrap) {
      const inWrap = all.filter(e => wrap.contains(e) && e !== cur);
      const far = pickSpatial(cur, inWrap, OPP[dir], true);
      if (far) { this.focus(far); return true; }
    }
    return false;
  }
  activate(el = this.top?.focused) {
    if (!el) return;
    if (el.classList.contains('disabled') || el.dataset.disabled != null) { this.refuse(el); return; }
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    if (!el.dataset.silent) { this.sfx(el.dataset.sfx || 'ui_confirm'); this.buzz(el.dataset.buzz || 'ui_confirm'); }
    el._act?.(el);
  }
  refuse(el, msg) {
    this.sfx('ui_error'); this.buzz('ui_error');
    if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
    if (msg) this.toast(msg, { err: true });
  }

  _nav(e) {
    const s = this.top; if (!s || s.context !== 'ui') return;
    if (s.onNav(e.dir, e)) return;
    if (!this.move(e.dir) && !e.repeat) { this.buzz('ui_tick', 0.5); }
  }
  _press(e) {
    const s = this.top; if (!s) return;
    if (s.onPress(e.id, e)) return;
    if (s.context !== 'ui') return;
    if (e.id === 'south') this.activate();
    else if (e.id === 'east') { this.sfx('ui_back'); this.buzz('ui_back'); s.onBack(); }
  }

  // ------------------------------------------------------------------ frame
  _frame({ dt, t }) {
    this.t = t;
    for (const s of this.stack) if (s === this.top || s.overlay || this.top?.overlay) s.update(dt, t);
    this.onFrame?.(dt, t);
  }

  // ------------------------------------------------------------------ feedback
  /** Logical UI sound → the design agent's pack (assets/audio/ui/index.json), with variant rotation so
   * repeated focus moves never machine-gun the same sample. Unknown ids fall through to the core. */
  sfx(id, o) {
    const idx = this.MZ.audio?.index || {};
    const pick = (base, n) => { this._v = ((this._v || 0) + 1 + Math.floor(Math.random() * (n - 1))) % n; return `${base}_${this._v + 1}`; };
    let real = SFX[id] ? SFX[id]() : id;
    if (real === 'ui_focus') real = pick('ui_focus', 3);
    else if (real === 'ui_tick') real = pick('ui_slider_tick', 3);
    else if (real === 'ui_stinger') real = `ui_suit_${this.MZ.theme.id}`;
    if (!idx[real]) real = id;                       // pack missing → core fallback resolution
    try { return this.MZ.audio.ui(real, o); } catch { return null; }
  }
  buzz(id, gain = 1) {
    const lib = this.MZ.haptics?.lib || {};
    const real = HAPTIC[id] ? HAPTIC[id](this.MZ) : id;
    try { this.MZ.haptics.play(lib[real] ? real : id, gain); } catch { }
  }
  toast(msg, { err = false, ms = 2200 } = {}) {
    const t = this.toastEl; t.textContent = msg; t.classList.toggle('err', err);
    t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('on'), ms);
  }

  // ------------------------------------------------------------------ glyphs, prompts, hints
  /** Glyph span that re-renders itself when the pad family changes. */
  g(btn) { return `<span class="gw" data-glyph="${btn}">${this.MZ.glyph(btn)}</span>`; }
  /** Prompt for a game ACTION (follows remaps): glyph of whatever button the action is bound to. */
  p(action, hero) { const pr = this.MZ.prompt(action, hero); return `<span class="gw" data-prompt="${action}" data-hero="${hero || ''}">${pr ? pr.html : '<span class="glyph unbound">?</span>'}</span>`; }
  refreshGlyphs() {
    for (const el of $$('[data-glyph]')) el.innerHTML = this.MZ.glyph(el.dataset.glyph);
    for (const el of $$('[data-prompt]')) { const pr = this.MZ.prompt(el.dataset.prompt, el.dataset.hero || undefined); el.innerHTML = pr ? pr.html : '<span class="glyph unbound">?</span>'; }
    this.renderHints(true);
    this.top?.onGlyphs?.();
  }
  renderHints(force = false) {
    const s = this.top; const list = s ? s.hints() : [];
    const key = this.MZ.input.family + JSON.stringify(list);
    if (!force && key === this._hintKey) return;
    this._hintKey = key;
    this.hintsEl.innerHTML = list.map(x => {
      const glyph = x.action ? this.p(x.action, x.hero) : x.btns ? x.btns.map(b => this.g(b)).join('') : this.g(x.btn);
      return `<span class="h${x.dim ? ' dim' : ''}${x.right ? ' right' : ''}" data-hint="${x.btn || x.action || ''}">${glyph}<span>${x.label}</span></span>`;
    }).join('');
    this.hintsEl.classList.toggle('hide', !list.length);
  }

  // ------------------------------------------------------------------ settings (UI-owned, persisted)
  applySettings() {
    const s = this.settings, r = document.documentElement;
    r.style.setProperty('--text-scale', s.textScale);
    r.dataset.cvd = s.cvd; r.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
    r.dataset.fx = s.screenFx ? 'on' : 'off';
    try { localStorage.setItem('mz3.ui', JSON.stringify(s)); } catch { }
  }
}

export function loadSettings() {
  const d = { textScale: 1, cvd: 'none', reduceMotion: false, screenFx: true, hudOpacity: 1, hudScale: 1, invertY: false, lookSens: 1, camShake: 1, fov: 70, minimapRotate: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem('mz3.ui') || '{}') }; } catch { return d; }
}

function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
function pickSpatial(cur, all, dir, farthest = false) {
  const a = cur.getBoundingClientRect(), ca = center(a);
  let best = null, bestS = farthest ? -Infinity : Infinity;
  for (const el of all) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect(); if (!b.width && !b.height) continue;
    const cb = center(b);
    let prim, sec;
    // primary distance measured edge-to-edge along the axis, sideways as centre offset / overlap
    if (dir === 'down') { prim = b.top - a.bottom + 1; if (cb.y <= ca.y + 1) continue; sec = overlap(a.left, a.right, b.left, b.right) ? 0 : Math.abs(cb.x - ca.x); }
    else if (dir === 'up') { prim = a.top - b.bottom + 1; if (cb.y >= ca.y - 1) continue; sec = overlap(a.left, a.right, b.left, b.right) ? 0 : Math.abs(cb.x - ca.x); }
    else if (dir === 'right') { prim = b.left - a.right + 1; if (cb.x <= ca.x + 1) continue; sec = overlap(a.top, a.bottom, b.top, b.bottom) ? 0 : Math.abs(cb.y - ca.y); }
    else { prim = a.left - b.right + 1; if (cb.x >= ca.x - 1) continue; sec = overlap(a.top, a.bottom, b.top, b.bottom) ? 0 : Math.abs(cb.y - ca.y); }
    const score = Math.max(0, prim) + sec * 2.2 + (farthest ? 0 : Math.abs(dir === 'up' || dir === 'down' ? cb.x - ca.x : cb.y - ca.y) * 0.05);
    if (farthest ? (prim > bestS) : (score < bestS)) { bestS = farthest ? prim : score; best = el; }
  }
  return best;
}
function overlap(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0) > 4; }
export { clamp };
