// Mark Zero V3 — front-end UI. Mounted by the platform (docs/UI-CONTRACT.md §1):
//   export async function mountUI(MZ, root)
// Screens: title → hero select → rooms → room → (loading) → HUD ⇄ pause / map / controls / haptics / settings.
// Deep links for tests and review: ?screen=title|hero|rooms|room|map|hud|controls|haptics|settings|loading|pause
import { UI } from './lib/app.js';
import { Backdrop } from './lib/backdrop.js';
import { TitleScreen } from './screens/title.js';
import { HeroScreen } from './screens/hero.js';
import { RoomsScreen, CodeScreen } from './screens/rooms.js';
import { RoomScreen } from './screens/room.js';
import { MapScreen } from './screens/map.js';
import { HudScreen } from './screens/hud.js';
import { PauseScreen } from './screens/pause.js';
import { ControlsScreen } from './screens/controls.js';
import { HapticsScreen } from './screens/haptics.js';
import { SettingsScreen } from './screens/settings.js';
import { LoadingScreen } from './screens/loading.js';
import { SuitWheelScreen } from './screens/suitwheel.js';

export async function mountUI(MZ, root) {
  const ui = new UI(MZ, root);
  window.UI = ui;
  ui.backdrop = new Backdrop(MZ);
  for (const S of [TitleScreen, HeroScreen, RoomsScreen, CodeScreen, RoomScreen, MapScreen, HudScreen, PauseScreen, ControlsScreen, HapticsScreen, SettingsScreen, LoadingScreen, SuitWheelScreen]) ui.register(S);

  // a screen whose 3D content loads async (the map) turns the backdrop on itself when it's ready, so the
  // player never sees an empty gradient (bgReady === false until then)
  ui.onScreen = s => { ui.backdrop.show(!!s.bg && s.bgReady !== false); ui.backdrop.set({ intensity: s.bgIntensity ?? 1 }); ui.backdrop.pulse(0.8); document.getElementById('fx')?.classList.toggle('game', !s.bg); };
  ui.onFrame = (dt, t) => { if (ui.top?.focused) ui.backdrop.focusAt(ui.top.focused); ui.backdrop.update(dt, t); };

  // phase routing: the platform owns the game state machine, the UI follows it
  MZ.on('game:phase', ({ phase, from }) => {
    if (phase === 'loading') ui.reset('loading');
    else if (phase === 'playing' && from !== 'paused') ui.reset('hud');
    else if (phase === 'paused' && !ui.find('pause')) ui.go('pause');
    else if (phase === 'playing' && from === 'paused') { while (ui.top && ui.top.constructor.id !== 'hud' && ui.back()); }
    else if (phase === 'menu') ui.reset('title', { skipAttract: true });
  });
  // ---- MZ.ui: UI services for gameplay / story (docs/ui/CONTRACT-REQUESTS.md, "UI provides")
  MZ.ui = {
    /** Suit wheel: open while D-pad ↓ is held. items = suit ids or {id, name, locked?, why?, sub?}; onPick(item|null). */
    suitWheel(open, items, onPick) {
      const cur = ui.find('suitwheel');
      if (open) { if (!cur) ui.go('suitwheel', { items, onPick }); return; }
      if (cur) cur.close(true);
    },
    get open() { return ui.top?.constructor.id; },
  };
  // story layer owns HUD visibility during cutscenes / suit-ups (web/js/story: MZ.emit('story:hud', {visible}));
  // remembered here so a HUD mounted mid-cutscene starts hidden
  ui.state.storyHud = MZ.story?.hudVisible ?? true;
  MZ.on('story:hud', ({ visible }) => { ui.state.storyHud = visible !== false; ui.top?.onStoryHud?.(ui.state.storyHud); document.documentElement.classList.toggle('story-nohud', !ui.state.storyHud); });
  MZ.on('room:start', () => { if (ui.top?.constructor.id !== 'loading') ui.reset('loading'); });

  // theme cross-fade juice: stinger + haptic + a flash of the backdrop
  MZ.theme.on?.(() => ui.backdrop.pulse(1));

  const deep = MZ.params.get('screen');
  if (deep && ui.registry[deep]) {
    if (['room', 'map', 'controls', 'haptics', 'settings', 'hero', 'rooms'].includes(deep)) ui.go('title', { skipAttract: true });
    if (deep === 'pause') { ui.go('hud'); ui.go('pause'); }
    else ui.go(deep, Object.fromEntries(MZ.params));
  } else ui.go('title');
  return ui;
}
