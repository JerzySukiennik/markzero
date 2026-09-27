// The platform object `MZ` the UI mounts into (docs/UI-CONTRACT.md). Owns the frame loop.
import * as THREE from 'three';
import { Input } from './core/input.js';
import { glyphHTML, glyphSVG, buttonName } from './core/glyphs.js';
import { Bindings, REMAPPABLE_BUTTONS } from './core/bindings.js';
import { Theme, SUITS, ROSTER, HEROES } from './core/theme.js';
import { Haptics } from './core/haptics.js';
import { Audio } from './core/audio.js';
import { Assets } from './core/assets.js';
import { Stage } from './gfx/stage.js';
import { createNet } from './net/index.js';
import { Game } from './world/game.js';
import { Perf } from './core/perf.js';

class Bus {
  constructor() { this.m = new Map(); }
  on(t, fn) { if (!this.m.has(t)) this.m.set(t, new Set()); this.m.get(t).add(fn); return () => this.m.get(t)?.delete(fn); }
  emit(t, d = {}) { for (const fn of [...(this.m.get(t) || [])]) { try { fn(d); } catch (e) { console.error('[bus]', t, e); } } }
}

export async function createApp() {
  const params = new URLSearchParams(location.search);
  const bus = new Bus();
  const input = new Input();
  const bindings = new Bindings(); bindings.REMAPPABLE = REMAPPABLE_BUTTONS;
  const theme = new Theme();
  const haptics = new Haptics(input);
  const audio = new Audio();
  const assets = new Assets();
  const stage = new Stage(document.getElementById('gl'));
  const net = createNet(bus, params); net.client = params.get('client') || 'web';

  const MZ = {
    THREE, params, bus, input, bindings, theme, haptics, audio, assets, stage, net, SUITS, ROSTER, HEROES,
    ready: false, version: '0.1.0',
    on: (t, fn) => bus.on(t, fn), emit: (t, d) => bus.emit(t, d),
    glyph: (id, fam = input.family) => glyphHTML(id, fam),
    glyphSVG: (id, fam = input.family) => glyphSVG(id, fam),
    buttonName: (id, fam = input.family) => buttonName(id, fam),
    prompt(action, hero = MZ.game.hero) { const btn = bindings.btn(hero, action); return btn ? { btn, html: glyphHTML(btn, input.family), name: buttonName(btn, input.family) } : null; },
  };
  // input context + capture (remap screens)
  input.context = 'ui';
  let capture = null;
  input.capture = fn => { capture = fn; return () => { if (capture === fn) capture = null; }; };
  input.on(ev => {
    if (ev.type === 'press' && capture) { const fn = capture; capture = null; fn(ev.id); return; }
    if (capture) return;
    if (ev.type === 'press') { audio.unlock(); bus.emit('input:press', ev); }
    else if (ev.type === 'release') bus.emit('input:release', ev);
    else if (ev.type === 'nav') bus.emit('input:nav', ev);
    else if (ev.type === 'pad') bus.emit('input:pad', ev);
  });
  input.onFamily = family => bus.emit('input:family', { family });
  // Gameplay reads ACTIONS, never buttons: bindings-aware and silent while the UI owns the pad.
  const ZERO = { lx: 0, ly: 0, rx: 0, ry: 0 };
  MZ.actions = hero => {
    const b = a => bindings.btn(hero, a), live = () => input.context === 'game';
    return {
      down: a => live() && !!input.down(b(a)), pressed: a => live() && !!input.pressed(b(a)),
      released: a => live() && !!input.state[b(a)]?.released, value: a => live() ? input.value(b(a)) : 0,
      heldMs: a => live() && input.down(b(a)) ? performance.now() - input.state[b(a)].t : 0,
      get axes() { return live() ? input.axes : ZERO; },
    };
  };
  addEventListener('pointerdown', () => audio.unlock());

  await Promise.all([theme.init(params.get('suit') || 'mk85'), haptics.init(), audio.init()]);
  MZ.game = new Game(MZ);
  stage.onRestore = () => (MZ.game.world ? MZ.game.recoverWorld() : null);
  MZ.perf = new Perf(MZ);
  net.connect();

  // ---- frame loop
  let last = performance.now(), T = 0;
  function tick(now) {
    const c0 = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now; T += dt;
    input.poll(now);
    theme.update(dt);
    MZ.game.update(dt, T);
    bus.emit('frame', { dt, t: T });
    stage.render(dt);
    audio.update(MZ.game.camera);
    MZ.perf.cpu(performance.now() - c0);
    MZ.perf.frame(now);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return MZ;
}
