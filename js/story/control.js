// Story's grip on a gameplay hero (IronMan / SpiderMan from web/js/game/**), kept to a few calls:
//   gate(hero)        swaps the hero's input for an InputGate (live pad | none | scripted pad, with
//                     a crossfade between script and pad for the slow-motion hand-off)
//   teleport(hero, p, yaw, vel)   place it (both controllers' own state fields)
//   park(hero, p, yaw)            hidden, frozen in place, no input (while the civilian walks)
//   unpark(hero)
// The controllers read input only through `this.act` (MZ.actions shape) — the gate has that shape.
// Asked of the gameplay agents as real methods (docs/game/GAMEPLAY-REQUESTS.md); until they exist
// these adapters poke the documented fields.
import * as THREE from 'three';

const ZERO = { lx: 0, ly: 0, rx: 0, ry: 0 };

export class InputGate {
  constructor(real) {
    this.real = real;            // MZ.actions(hero)
    this.mode = 'live';          // 'live' | 'none' | 'script'
    this.mix = 0;                // 0 = script, 1 = pad (only in 'script' mode)
    this.s = { down: new Set(), pressed: new Set(), axes: { ...ZERO } };
    this._axes = { ...ZERO };
  }
  script(o = {}) { this.mode = 'script'; this.mix = 0; this.set(o); }
  set({ down = null, axes = null } = {}) {
    if (down) { for (const a of down) if (!this.s.down.has(a)) this.s.pressed.add(a); for (const a of [...this.s.down]) if (!down.includes(a)) this.s.down.delete(a); for (const a of down) this.s.down.add(a); }
    if (axes) Object.assign(this.s.axes, axes);
  }
  press(a) { this.s.pressed.add(a); }
  endFrame() { this.s.pressed.clear(); }
  _pad() { return this.mode === 'live' || (this.mode === 'script' && this.mix >= 0.5); }
  down(a) { if (this.mode === 'none') return false; if (this.mode === 'live') return this.real.down(a); return this.s.down.has(a) || (this.mix >= 0.5 && this.real.down(a)); }
  pressed(a) { if (this.mode === 'none') return false; if (this.mode === 'live') return this.real.pressed(a); return this.s.pressed.has(a) || (this.mix >= 0.5 && this.real.pressed(a)); }
  released(a) { return this._pad() ? this.real.released(a) : false; }
  value(a) { if (this.mode === 'none') return 0; if (this.mode === 'live') return this.real.value(a); return Math.max(this.s.down.has(a) ? 1 : 0, this.mix >= 0.5 ? this.real.value(a) : 0); }
  heldMs(a) { return this._pad() ? this.real.heldMs(a) : 0; }
  get axes() {
    if (this.mode === 'none') return ZERO;
    if (this.mode === 'live') return this.real.axes;
    const r = this.real.axes, s = this.s.axes, k = this.mix, o = this._axes;
    // the pad takes over any axis the player actually moves; otherwise a crossfade
    for (const key of ['lx', 'ly', 'rx', 'ry']) o[key] = Math.abs(r[key]) > 0.25 ? r[key] : s[key] * (1 - k) + r[key] * k;
    return o;
  }
}

export function gate(hero, MZ) {
  if (hero.act instanceof InputGate) return hero.act;
  const g = new InputGate(hero.act || MZ.actions(hero.hero));
  hero.act = g;
  return g;
}

export function teleport(h, p, yaw = 0, vel = null) {
  if (h.m) {                                   // Iron Man
    if (h.teleport) return h.teleport(p, yaw, { velocity: vel || undefined });
    h.m.position.copy(p); h.m.velocity.set(0, 0, 0); if (vel) h.m.velocity.copy(vel);
    h.m.yaw = yaw; h.m.pitch = 0; h.m.bank = 0; h.m._setBasis?.(); h.heading = yaw; h.cam?.snap?.();
  } else if (h.pos) {                          // Spider-Man
    if (h.teleport) return h.teleport(p, yaw, vel);
    h.pos.copy(p); h.vel.set(0, 0, 0); if (vel) h.vel.copy(vel);
    h.yaw = yaw; h.camYaw = yaw; h.heading = yaw;
    h.rope?.line?.release?.(); h.rope = null; h.stuck = false; h.zip = null; h.cam?.snap?.();
  }
}

export function park(h, MZ, p, yaw = 0) {
  const g = gate(h, MZ); g.mode = 'none';
  h._storyPark = { p: p.clone(), yaw };
  teleport(h, p, yaw);
  h.park?.(true);
  if (h.root) h.root.visible = false;
}
/** call every frame after the players updated: keep a parked hero where it was put, hidden
 * (only needed for controllers without a real park()) */
export function holdParked(h) {
  const k = h._storyPark; if (!k) return;
  if (h.park && h.parked) return;
  if (h.m) { h.m.position.copy(k.p); h.m.velocity.set(0, 0, 0); }
  else if (h.pos) { h.pos.copy(k.p); h.vel.set(0, 0, 0); }
  if (h.root) h.root.visible = false;
}
export function unpark(h) { delete h._storyPark; h.park?.(false); if (h.root) h.root.visible = true; }
export const heroPos = h => (h.m ? h.m.position : h.pos) || h.root?.position || new THREE.Vector3();
