// Suit theme = the whole UI's palette. DOM: <html data-suit="…"> + design/themes.css (@property vars
// cross-fade by themselves). 3D (dot map, HUD arcs, bloom tint): `theme.c.<token>` THREE.Colors that
// cross-fade over the same duration/curve every frame. Palettes: design/themes.json (design agent).
import * as THREE from 'three';

export const SUITS = [
  { id: 'mk1', hero: 'ironman', name: 'Mark I', glb: 'assets/suits/mk1/mk1.glb', era: 'Cave-built. Barely flies.' },
  { id: 'mk2', hero: 'ironman', name: 'Mark II', glb: 'assets/suits/mk2/mk2.glb', era: 'Prototype. Ices up high.' },
  { id: 'mk3', hero: 'ironman', name: 'Mark III', glb: 'assets/suits/mk3/mk3.glb', era: 'The classic. Hot-rod red.' },
  { id: 'mk42', hero: 'ironman', name: 'Mark 42', glb: 'assets/suits/mk42/mk42.glb', era: 'Prehensile. Flies to you in pieces.' },
  { id: 'mk85', hero: 'ironman', name: 'Mark 85', glb: 'assets/suits/mk85/mk85.glb', era: 'Nanotech. Flows from the reactor.' },
  { id: 'hulkbuster', hero: 'ironman', name: 'Hulkbuster', glb: 'assets/suits/hulkbuster/hulkbuster.glb', era: 'Veronica drops it from orbit.', selectable: false, note: 'summoned in game over any Iron Man suit (Veronica)' },
  { id: 'ironspider', hero: 'spiderman', name: 'Iron Spider', glb: 'assets/suits/ironspider/ironspider.glb', era: 'Stark nanotech, four legs.' },
  { id: 'peter', hero: 'spiderman', name: 'Peter Parker', glb: 'assets/characters/peter/peter.glb', era: 'Out of the suit.', selectable: false, note: 'Spider-Man without the suit (story intro)' },
];
/** What the hero-select screen offers (Jurek, playtest 2: no Hulkbuster, no Peter). SUITS stays complete for names/models. */
export const ROSTER = SUITS.filter(s => s.selectable !== false);
export const HEROES = { ironman: { name: 'Iron Man', defaultSuit: 'mk85' }, spiderman: { name: 'Spider-Man', defaultSuit: 'ironspider' } };
const TOKENS = ['accent', 'accent2', 'accent3', 'glow', 'bg', 'panel', 'text', 'dim', 'danger', 'dotLow', 'dotMid', 'dotHigh'];
const ease = t => 1 - Math.pow(1 - t, 4);   // ≈ cubic-bezier(0.22, 1, 0.36, 1)

export class Theme {
  constructor() {
    this.themes = {}; this.id = null; this.ms = 650;
    this.c = Object.fromEntries(TOKENS.map(k => [k, new THREE.Color()]));
    this._from = null; this._to = null; this._t = 1;
    this.listeners = new Set();
  }
  async init(id = 'mk85') {
    try {
      const j = await (await fetch('/design/themes.json')).json();
      this.themes = j.themes; this.ms = j.transition?.crossfadeMs || 650; this.meta = j;
    } catch (e) { console.error('themes.json missing', e); }
    // availability: which suit GLBs exist right now (other agents are still producing them)
    await Promise.all(SUITS.map(async s => { try { s.ready = (await fetch('/' + s.glb, { method: 'HEAD' })).ok; } catch { s.ready = false; } }));
    this.set(id, true);
    return this;
  }
  palette(id) {
    const t = this.themes[id] || this.themes.mk85 || {};
    return Object.fromEntries(TOKENS.map(k => [k, new THREE.Color(t[k] || t.accent2 || '#888')]));
  }
  get(id = this.id) { return this.themes[id]; }
  set(id, instant = false) {
    if (id === this.id && !instant) return;
    this.id = id;
    document.documentElement.dataset.suit = id;
    this._from = Object.fromEntries(TOKENS.map(k => [k, this.c[k].clone()]));
    this._to = this.palette(id);
    this._t = instant ? 1 : 0;
    if (instant) for (const k of TOKENS) this.c[k].copy(this._to[k]);
    for (const fn of this.listeners) fn(id);
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  update(dt) {
    if (this._t >= 1) return;
    this._t = Math.min(1, this._t + dt * 1000 / this.ms);
    const k = ease(this._t);
    for (const n of TOKENS) this.c[n].copy(this._from[n]).lerp(this._to[n], k);
  }
  /** 0..1 progress of the current cross-fade (map ripple uses it). */
  get progress() { return this._t; }
}
