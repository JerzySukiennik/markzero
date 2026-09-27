// Controller bindings per hero — defaults = docs/controls-audit.md §4 (the proposed mapping).
// Ordering principle shared by both heroes: R1/L1 = ranged · □ = big/held attack · ○ = get off the
// line of fire · ✕ = up · △ = signature special · D-pad = occasional things · L3/R3 free · OPTIONS = pause ONLY.
// Remappable in-game (swap on conflict), saved in localStorage; every prompt and the CONTROLS screen
// is generated from these live bindings, never from strings.
export const DEFAULTS = {
  ironman: [
    { id: 'move', btn: 'ls', locked: true, name: 'Thrust / walk', how: 'stick', note: 'In the air: forward/back thrust and side slide in body axes. Let go = the suit brakes and hovers on its own.' },
    { id: 'look', btn: 'rs', locked: true, name: 'Turn / aim', how: 'stick', note: 'Turns the whole suit. Turn 180° and thrust = hard brake (physics, not a button).' },
    { id: 'ascend', btn: 'south', name: 'Take off / climb', how: 'tap / hold', note: 'Tap on the ground = launch kick; hold = climb.' },
    { id: 'descend', btn: 'east', name: 'Descend', how: 'hold', note: 'Drop while still steering speed with the left stick (Avengers-style).' },
    { id: 'rep_l', btn: 'l1', name: 'Left repulsor', how: 'tap', note: 'Hold to charge a bigger shot.' },
    { id: 'rep_r', btn: 'r1', name: 'Right repulsor', how: 'tap', note: 'Hold to charge a bigger shot.' },
    { id: 'turret', btn: 'west', name: 'Shoulder turret', how: 'hold', note: 'Deploys and fires while held.' },
    { id: 'gadget_off', btn: 'north', name: 'Offensive gadget', how: 'tap', note: 'Per suit: scrap burst, sonic pulse, micro-salvo, shatter, nano blade.' },
    { id: 'aim', btn: 'l2', name: 'Precision aim', how: 'hold', note: 'Slows time slightly, tightens aim assist.' },
    { id: 'boost', btn: 'r2', name: 'Supersonic boost', how: 'hold', note: 'Not on Mark I.' },
    { id: 'suit_wheel', btn: 'down', name: 'Suit wheel', how: 'hold', note: 'Hold, pick a suit with the stick, release.' },
    { id: 'veronica', btn: 'left', name: 'Veronica / eject Hulkbuster', how: 'press', note: 'Calls the Hulkbuster over the current suit; press again to eject.' },
    { id: 'laser', btn: 'right', name: 'Wrist laser', how: 'tap', note: 'When charged. Movement keeps steering itself.' },
    { id: 'recenter', btn: 'r3', name: 'Re-centre camera', how: 'click', note: '' },
    { id: 'suit_menu', btn: 'touchpad', name: 'Suit menu', how: 'press', note: 'Change armour (suit-up sequence).' },
    { id: 'map', btn: 'select', name: 'Map', how: 'press', note: '' },
    { id: 'pause', btn: 'start', locked: true, name: 'Pause', how: 'press', note: 'Only pause — never also a suit menu.' },
  ],
  spiderman: [
    { id: 'move', btn: 'ls', locked: true, name: 'Run / steer the swing', how: 'stick', note: '' },
    { id: 'look', btn: 'rs', locked: true, name: 'Look', how: 'stick', note: '' },
    { id: 'jump', btn: 'south', name: 'Jump / air hop / wall jump', how: 'tap', note: 'Only ✕ jumps — it never reels the line.' },
    { id: 'dodge', btn: 'east', name: 'Dodge', how: 'tap', note: 'Direction from the left stick; back = backflip.' },
    { id: 'swing', btn: 'r2', name: 'Web swing / wall-run', how: 'hold', note: 'All traversal on R2, like Marvel’s Spider-Man.' },
    { id: 'aim', btn: 'l2', name: 'Aim', how: 'hold', note: 'Only aims — no more slow-motion at every wall.' },
    { id: 'web_l', btn: 'l1', name: 'Left web shot', how: 'tap', note: '' },
    { id: 'web_r', btn: 'r1', name: 'Right web shot', how: 'tap', note: 'Aim at Iron Man and hold to tether and ride the suit.' },
    { id: 'strike', btn: 'west', name: 'Strike / launcher', how: 'press / hold', note: 'Punch fires on PRESS; keep holding = launcher.' },
    { id: 'grab', btn: 'north', name: 'Web strike · grab & throw', how: 'tap / hold', note: 'Hold near an object = grab and spin, release = throw.' },
    { id: 'reel_in', btn: 'up', name: 'Reel in line', how: 'hold', note: '' },
    { id: 'reel_out', btn: 'down', name: 'Let out line', how: 'hold', note: '' },
    { id: 'legs', btn: 'right', name: 'Spider-leg lunge', how: 'tap', note: 'Area attack, also behind you.' },
    { id: 'recenter', btn: 'r3', name: 'Re-centre camera', how: 'click', note: '' },
    { id: 'suit_menu', btn: 'touchpad', name: 'Suit menu', how: 'press', note: '' },
    { id: 'map', btn: 'select', name: 'Map', how: 'press', note: '' },
    { id: 'pause', btn: 'start', locked: true, name: 'Pause', how: 'press', note: '' },
  ],
};
export const REMAPPABLE_BUTTONS = ['south', 'east', 'west', 'north', 'l1', 'r1', 'l2', 'r2', 'l3', 'r3', 'up', 'down', 'left', 'right', 'touchpad', 'select'];

export class Bindings {
  constructor() {
    this.map = {};
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('mz3.bindings') || '{}'); } catch { }
    for (const [hero, list] of Object.entries(DEFAULTS)) {
      this.map[hero] = list.map(a => ({ ...a, btn: (!a.locked && saved[hero]?.[a.id]) || a.btn }));
    }
  }
  list(hero) { return this.map[hero] || []; }
  btn(hero, action) { return this.map[hero]?.find(a => a.id === action)?.btn; }
  /** Rebind; if another action of the same hero uses that button, the two swap. Returns the swapped action or null. */
  set(hero, action, btn) {
    const L = this.map[hero], a = L.find(x => x.id === action); if (!a || a.locked) return null;
    const other = L.find(x => x.btn === btn && x !== a);
    if (other?.locked) return false;
    if (other) other.btn = a.btn;
    a.btn = btn; this.save();
    return other || null;
  }
  reset(hero) { this.map[hero] = DEFAULTS[hero].map(a => ({ ...a })); this.save(); }
  save() {
    const out = {}; for (const [h, L] of Object.entries(this.map)) out[h] = Object.fromEntries(L.filter(a => !a.locked).map(a => [a.id, a.btn]));
    try { localStorage.setItem('mz3.bindings', JSON.stringify(out)); } catch { }
  }
  /** Conflicts (two actions on one button) — should always be empty thanks to swapping. */
  conflicts(hero) { const seen = {}, c = []; for (const a of this.list(hero)) { if (seen[a.btn]) c.push([seen[a.btn], a.id]); seen[a.btn] = a.id; } return c; }
}
