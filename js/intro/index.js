// INTRO TRAILER + title music (docs/intro/README.md). Runs at every launch before the menu (nothing is
// saved), skippable at once with ✕ / ○ / OPTIONS; ends on the MARK ZERO wordmark (on a downbeat of the
// music) and a Start prompt; Start → a smooth fade into the menu while the same track keeps playing and
// then loops seamlessly (loop points on the beat grid). In game the music fades out; back in the menu, in.
//   import('./intro/index.js').then(m => m.mountIntro(MZ))   — before the UI mounts (main.js)
// ?trailer=0 disables it, ?trailer=1 forces it; dev deep links (?solo ?room ?host ?screen …) skip it.
import { IntroOverlay } from './overlay.js';
import { TitleMusic } from './music.js';

const SKIP = new Set(['south', 'east', 'start']);
const DEV = ['solo', 'room', 'host', 'joinname', 'screen', 'autostart'];

export async function mountIntro(MZ) {
  const P = MZ.params, forced = P.get('trailer') === '1';
  const tl = await fetch('/js/intro/timeline.json').then(r => r.json()).catch(() => null);
  const music = new TitleMusic(MZ, tl?.music || {});
  const api = MZ.intro = { active: false, music, tl, done: Promise.resolve() };
  // title music follows the game phase: out in game, back in the menu
  MZ.on('game:phase', ({ phase }) => { if (phase === 'loading' || phase === 'playing') music.fade(0, 1.6); else if (phase === 'menu') { if (!music.src) music.play(tl?.music?.menuLoopFrom ?? 0); music.fade(1, 2.5); } });
  if (!tl || P.get('trailer') === '0' || (!forced && DEV.some(k => P.has(k)))) {
    if (tl && !DEV.some(k => P.has(k))) startMenuMusic(MZ, music, tl);
    return api;
  }
  api.active = true;
  api.done = run(MZ, tl, music, api).catch(e => { console.error('[intro] trailer failed', e); cleanup(MZ, api); });
  return api;
}

async function startMenuMusic(MZ, music, tl) {
  try { MZ.audio.unlock(); await music.load(); if (!MZ.audio.running) await new Promise(r => { const off = MZ.on('input:press', () => { off(); MZ.audio.unlock(); r(); }); }); music.play(tl.music.menuLoopFrom ?? 0); } catch (e) { console.warn('[intro] music', e); }
}

function cleanup(MZ, api) {
  api.release?.(); api.release = null;
  const T = api.trailer; api.trailer = null; if (T) T.cancelled = true;
  if (T) (api.worldP || Promise.resolve()).then(() => T.dispose());   // a world still loading is dropped when it lands
  api.overlay?.dispose(); api.overlay = null;
  api.offFrame?.(); api.active = false;
  api.restoreStage?.(); api.restoreStage = null;
  if (window.UI?.onScreen && window.UI.top) try { window.UI.onScreen(window.UI.top); } catch { }
  MZ.input.context = 'ui';
  MZ.emit('intro:done', {});
}

async function run(MZ, tl, music, api) {
  const ov = api.overlay = new IntroOverlay(MZ);
  // while the trailer runs, the stage draws ONLY the world (the menu's own 3D layers — backdrop, dot map —
  // stay hidden under it); restored in cleanup()
  const stage = MZ.stage, origRender = stage.render;
  stage.render = function (dt) { const L = this.layers; this.layers = []; try { origRender.call(this, dt); } finally { this.layers = L; } };
  api.restoreStage = () => { stage.render = origRender; };
  MZ.emit('intro:start', {});
  // ---- skip: ✕ / ○ / OPTIONS at ANY moment → the menu at once (no waiting for a frame, a load or a fade)
  let playing = false, gate = null, finishing = false;
  const finish = () => {
    if (finishing || !api.active) return; finishing = true;
    const wasPlaying = playing;
    ov.veil(true); ov.start(false); MZ.audio.ui?.('ui_confirm');
    setTimeout(() => { cleanup(MZ, api); if (!wasPlaying) startMenuMusic(MZ, music, tl); }, 380);
  };
  api.skip = finish;
  const arm = () => { api.release = MZ.input.capture(id => { if (!api.active) return; if (gate && id === 'south') { const g = gate; gate = null; g(); } else if (SKIP.has(id)) finish(); if (api.active) arm(); }); };
  arm();
  const alive = () => api.active && !finishing;
  // ---- audio: needs a gesture in a normal browser (the HP launcher autoplays)
  MZ.audio.unlock();
  const musicP = music.load().catch(e => { console.warn('[intro] no music', e); return null; });
  await new Promise(r => setTimeout(r, 250));
  if (!alive()) return;
  if (!MZ.audio.running) { ov.soundGate(true); await new Promise(r => { gate = r; }); MZ.audio.unlock(); ov.soundGate(false); }
  if (!alive()) return;
  // ---- the world + every actor load first; the music waits for them (then every cut lands on its beat)
  ov.loading(true); ov.skipHint(true);
  const { Trailer } = await import('./trailer.js');
  if (!alive()) return;
  const T = api.trailer = new Trailer(MZ, tl);
  const worldP = api.worldP = T.loadWorld((p) => ov.progress(p)).catch(e => { console.warn('[intro] world', e); return null; });
  await Promise.all([musicP, worldP]);
  if (!alive()) return;
  ov.loading(false);
  playing = true;
  music.play(0);
  setTimeout(() => ov.skipHint(false), 4500);
  const titles = [...(tl.titles || [])].map(c => ({ ...c })), shots = [...tl.shots];
  let titleOn = null, wordDone = false, startOn = false, lastShot = -1, shown = false;
  const frameClock = MZ.params.get('trailerclock') === 'frame';   // tests: time follows rendered frames (no jumps on stalls)
  api.clock = 0;
  api.offFrame = MZ.on('frame', ({ dt, t }) => {
    if (!api.active || finishing) return;
    api.clock += Math.min(dt, 1 / 30);
    const mt = frameClock ? api.clock : music.time;
    api.time = mt;
    for (const c of titles) {
      if (!c.shown && mt >= c.at) { c.shown = true; ov.title(c.text, c.sub); titleOn = c; }
      if (titleOn === c && mt >= c.at + c.dur) { ov.title(null); titleOn = null; }
    }
    if (T.ready) {
      let i = lastShot; while (i + 1 < shots.length && mt >= shots[i + 1].at) i++;
      if (i !== lastShot && i >= 0) { const s = shots[i]; lastShot = i; T.shot(s.id.replace(/#\d+$/, ''), s.slow); if (!shown) { shown = true; ov.black(false); } }
      T.update(dt, t);
    }
    if (!wordDone && mt >= tl.wordmark) { wordDone = true; ov.wordmark(); MZ.haptics.play('ui_start'); T.dir?.shake(0.15); }
    if (!startOn && mt >= tl.start) { startOn = true; ov.start(true); }
  });
}
