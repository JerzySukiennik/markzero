// Pad-first input. Polls the Gamepad API (standard mapping) once per frame, keeps edge state per
// canonical button id, detects the pad family (PlayStation vs Xbox) for glyphs, and turns D-pad /
// left stick into repeating UI navigation. Keyboard is a developer fallback only (Jurek plays with
// a pad); a virtual pad (`input.virtual`) lets headless tests press buttons.
export const BUTTONS = ['south', 'east', 'west', 'north', 'l1', 'r1', 'l2', 'r2', 'select', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right', 'home', 'touchpad'];
const KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'south', Space: 'south', Escape: 'east', Backspace: 'east', KeyF: 'west', KeyT: 'north',
  KeyQ: 'l1', KeyE: 'r1', KeyZ: 'l2', KeyC: 'r2', Tab: 'select', KeyP: 'start', KeyV: 'l3', KeyB: 'r3', KeyH: 'touchpad',
};
const DEAD = 0.18;

export function familyOf(id = '') {
  const s = id.toLowerCase();
  if (/054c|playstation|dualshock|dualsense|wireless controller/.test(s)) return 'ps';
  if (/045e|xbox|xinput/.test(s)) return 'xbox';
  return null;
}

export class Input {
  constructor() {
    this.state = Object.fromEntries(BUTTONS.map(b => [b, { down: false, pressed: false, released: false, value: 0, t: 0 }]));
    this.axes = { lx: 0, ly: 0, rx: 0, ry: 0 };
    this.family = new URLSearchParams(location.search).get('pad') || 'ps';
    this.forcedFamily = !!new URLSearchParams(location.search).get('pad');
    this.pad = null; this.padIndex = -1; this.padId = '';
    this.keys = new Set(); this.virtual = new Map();   // id -> frames left (virtual taps)
    this.listeners = new Set();
    this.nav = { dir: null, next: 0 };
    this.lastDevice = 'none';
    this.onFamily = null;
    addEventListener('keydown', e => { const b = KEYS[e.code]; if (b) { this.keys.add(b); e.preventDefault(); this.lastDevice = 'keyboard'; } });
    addEventListener('keyup', e => { const b = KEYS[e.code]; if (b) this.keys.delete(b); });
    addEventListener('gamepadconnected', e => { this._pick(e.gamepad); });
    addEventListener('gamepaddisconnected', e => { if (e.gamepad.index === this.padIndex) { this.pad = null; this.padIndex = -1; this.emit({ type: 'pad', connected: false }); } });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of [...this.listeners]) fn(ev); }

  _pick(gp) {
    this.padIndex = gp.index; this.padId = gp.id;
    const fam = familyOf(gp.id);
    if (fam && !this.forcedFamily && fam !== this.family) { this.family = fam; this.onFamily?.(fam); }
    this.emit({ type: 'pad', connected: true, id: gp.id, family: this.family });
  }
  /** The live Gamepad object (for haptics). */
  gamepad() { const g = navigator.getGamepads?.() || []; return g[this.padIndex] || null; }

  /** Headless tests: tap a button for a couple of frames, or hold it for `frames`. */
  tap(id, frames = 2) { this.virtual.set(id, frames); }
  setAxes(a) { this._vAxes = a; }

  poll(now = performance.now()) {
    const pads = navigator.getGamepads?.() || [];
    let gp = pads[this.padIndex];
    if (!gp) { for (const p of pads) if (p && p.connected) { this._pick(p); gp = p; break; } }
    this.pad = gp || null;
    const raw = {};
    if (gp) {
      gp.buttons.forEach((b, i) => { const id = BUTTONS[i]; if (id) raw[id] = Math.max(raw[id] || 0, b.value || (b.pressed ? 1 : 0)); });
      const dz = v => Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD);
      const r = dz(Math.hypot(gp.axes[0] || 0, gp.axes[1] || 0)), rr = dz(Math.hypot(gp.axes[2] || 0, gp.axes[3] || 0));
      const n = Math.hypot(gp.axes[0] || 0, gp.axes[1] || 0) || 1, m = Math.hypot(gp.axes[2] || 0, gp.axes[3] || 0) || 1;
      this.axes = { lx: (gp.axes[0] || 0) / n * r, ly: (gp.axes[1] || 0) / n * r, rx: (gp.axes[2] || 0) / m * rr, ry: (gp.axes[3] || 0) / m * rr };
      if (Object.values(raw).some(v => v > 0.3) || r > 0 || rr > 0) this.lastDevice = 'pad';
    } else this.axes = { lx: 0, ly: 0, rx: 0, ry: 0 };
    if (this._vAxes) Object.assign(this.axes, this._vAxes);
    for (const k of this.keys) raw[k] = 1;
    for (const [k, n] of this.virtual) { raw[k] = 1; if (n <= 1) this.virtual.delete(k); else this.virtual.set(k, n - 1); }
    for (const id of BUTTONS) {
      const s = this.state[id], v = raw[id] || 0, down = v > (id === 'l2' || id === 'r2' ? 0.25 : 0.5);
      s.pressed = down && !s.down; s.released = !down && s.down;
      if (s.pressed) s.t = now;
      s.down = down; s.value = v;
      if (s.pressed) this.emit({ type: 'press', id });
      if (s.released) this.emit({ type: 'release', id, held: now - s.t });
    }
    // UI navigation: D-pad or left stick, with key-repeat (380 ms delay, 110 ms rate)
    let dir = null;
    for (const d of ['up', 'down', 'left', 'right']) if (this.state[d].down) dir = d;
    if (!dir) { const { lx, ly } = this.axes; if (Math.hypot(lx, ly) > 0.5) dir = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 'right' : 'left') : (ly > 0 ? 'down' : 'up'); }
    if (dir !== this.nav.dir) { this.nav.dir = dir; if (dir) { this.emit({ type: 'nav', dir }); this.nav.next = now + 380; } }
    else if (dir && now >= this.nav.next) { this.emit({ type: 'nav', dir, repeat: true }); this.nav.next = now + 110; }
  }
  down(id) { return this.state[id]?.down; }
  pressed(id) { return this.state[id]?.pressed; }
  value(id) { return this.state[id]?.value || 0; }
}
