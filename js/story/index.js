// STORY — spawn in the base, intros, missions, world prompts and markers, camera direction and
// time scale. Mounted once by the platform: `import('./story/index.js').then(m => m.mountStory(MZ))`
// (docs/story/STORY-API.md). It hooks only public platform events:
//   game:phase playing  → a session: spawn logic + intro or base start + missions
//   frame               → after the gameplay update and camera, before render: civilian, sequences,
//                         director (camera override / blend), time scale, overlay
// URL: ?intro=1 force the intro, ?intro=0 skip it, ?story=0 disable story entirely, ?mission=<id>.
import * as THREE from 'three';
import { Director, TimeCtl } from './director.js';
import { Overlay } from './prompts.js';
import { gate, holdParked, heroPos } from './control.js';
import { Missions } from './missions.js';

// No persistence (Jurek: every launch starts from zero — intro, tutorial, arc). State lives in memory for
// the page's lifetime only (back to the menu keeps it); the old localStorage save is deleted on mount.
const OLD_SAVE_KEY = 'mz3.story';
export const SKIP = Symbol('skip');
export const INTERACT = { spiderman: 'grab', ironman: 'gadget_off' };     // △ by default, follows remaps

function dropOldSave() { try { localStorage.removeItem(OLD_SAVE_KEY); } catch { } }

export class Story {
  constructor(MZ) {
    this.MZ = MZ; this.save = { tutorial: {}, missions: {} };   // in memory only
    this.session = null; this.T = 0;
    this._waits = [];
  }
  persist() { }   // deliberately nothing: no progress survives a reload

  // ------------------------------------------------------------------ session
  async start() {
    const MZ = this.MZ, g = MZ.game;
    if (this.session || !g.world || !g.local) return;
    const world = g.world, hero = g.local;
    const s = this.session = { world, hero, heroId: hero.hero, abort: false };
    this.world = world; this.hero = hero;
    this.dir = new Director(world.camera);
    this.time = new TimeCtl(MZ);
    this.ui = new Overlay(MZ);
    this.gate = gate(hero, MZ);
    this.act = MZ.actions(hero.hero);          // the real pad (story prompts read it directly)
    this.civilian = null; this.puppets = new Set(); this.anims = new Set();
    this.missions = new Missions(this);
    MZ.emit('story:session', { hero: s.heroId });
    const p = MZ.params.get('intro');
    // Jurek: EVERY game starts in the base, out of the suit (Tony → gantry / summon / nano, Peter → capsule).
    // The save only remembers the tutorial prompts. ?intro=0 = developer bypass (suited base start).
    const wantIntro = p !== '0';
    try {
      if (wantIntro) {
        const mod = s.heroId === 'spiderman' ? await import('./intro-spider.js') : await import('./intro-ironman.js');
        await mod.run(this);
        if (s.abort) return;
      } else {
        const mod = await import('./spawn.js');
        await mod.baseStart(this);
      }
      if (!s.abort) this.missions.begin();
    } catch (e) {
      console.error('[story] session failed', e);
      this.recover();
    }
  }
  /** something threw: give the player a working hero no matter what */
  recover() {
    this.ui?.bars(false); this.ui?.cover?.(false); this.hud(true);
    if (this.hero) { delete this.hero._storyPark; this.hero.park?.(false); if (this.hero.root) this.hero.root.visible = true; }
    if (this.gate) this.gate.mode = 'live';
    this.civilian?.dispose(); this.civilian = null;
    this.dir?.release(0.6); this.time?.to(1, 0.3);
  }
  end() {
    const s = this.session; if (!s) return;
    s.abort = true;
    for (const w of this._waits) w.res(false); this._waits = [];
    this.missions?.dispose(); this.civilian?.dispose();
    for (const p of this.puppets) p.dispose?.();
    this.ui?.dispose(); this.time?.reset();
    this.session = null; this.civilian = null;
    this.MZ.emit('story:end', {});
  }

  // ------------------------------------------------------------------ sequence helpers (real time)
  wait(sec) { return new Promise((res, rej) => { if (this._skipNow()) return rej(SKIP); this._waits.push({ t: this.T + sec, res, rej }); }); }
  until(fn, timeout = Infinity) { return new Promise((res, rej) => { if (this._skipNow()) return rej(SKIP); this._waits.push({ fn, t: this.T + timeout, res, rej }); }); }
  /** any promise, but it rejects with SKIP when the player skips the current cinematic */
  guard(p) {
    if (this._skipNow()) return Promise.reject(SKIP);
    let w; const g = new Promise((res, rej) => { w = { fn: () => false, t: Infinity, res, rej }; this._waits.push(w); });
    return Promise.race([p.finally(() => { const i = this._waits.indexOf(w); if (i >= 0) this._waits.splice(i, 1); }), g]);
  }
  /** a cinematic stretch the player can skip by holding ○ (east, fixed UI "back") for 0.6 s */
  skippable(on) { this._skippable = on; this._skipReq = false; this._skipHeld = 0; this.ui.skipHint(on); }
  _skipNow() { return this._skippable && this._skipReq; }
  tutorialSeen(hero) { return !!this.save.tutorial?.[hero]; }
  tutorialDone(hero) { (this.save.tutorial ||= {})[hero] = true; this.persist(); }
  /** show / hide the gameplay HUD (the UI listens to story:hud) */
  hud(visible) { this.hudVisible = visible; this.MZ.emit('story:hud', { visible }); }
  beat(text, secs, who) { this.ui.beat(text, secs, who); this.MZ.emit('story:beat', { text, who }); }

  // ------------------------------------------------------------------ frame
  frame(dt, t) {
    if (!this.session) return;
    if (this.MZ.game.phase === 'paused' && (this.MZ.net.room?.players.length || 1) < 2) return;   // solo pause freezes the story
    this.T += dt;
    const cam = this.world.camera;
    this.gate.endFrame();
    if (this._skippable && !this._skipReq) {
      this._skipHeld = this.MZ.input.down('east') ? this._skipHeld + dt : 0;
      if (this._skipHeld > 0.6) { this._skipReq = true; const ws = this._waits; this._waits = []; for (const w of ws) w.rej ? w.rej(SKIP) : w.res(false); }
    }
    for (const w of [...this._waits]) {
      if ((w.fn && w.fn()) || this.T >= w.t) { this._waits.splice(this._waits.indexOf(w), 1); w.res(!w.fn || this.T < w.t); }
    }
    if (this.civilian) { this.civilian.update(dt, this.civilian.control ? this.act : null); this.civilian.updateCamera(dt, cam); }
    for (const p of this.puppets) p.update?.(dt, t);
    for (const a of this.anims) a.update(dt);
    holdParked(this.hero);
    this.missions.update(dt, t);
    this.onFrame?.(dt, t);
    this.dir.apply(dt, t);
    this.time.update(dt);
    this.ui.update(cam, this.civilian ? this.civilian.pos : heroPos(this.hero));
  }

  // ------------------------------------------------------------------ API for UI / others
  markers() { return this.missions ? this.missions.mapMarkers() : []; }
  get state() { return { hero: this.session?.heroId, tutorial: this.save.tutorial, missions: this.save.missions, active: this.missions?.activeId || null, phase: this.phaseName || null }; }
}

export async function mountStory(MZ) {
  if (MZ.story || MZ.params.get('story') === '0') return MZ.story;
  dropOldSave();
  const S = new Story(MZ);
  MZ.story = S;
  MZ.on('game:phase', ({ phase }) => {
    if (phase === 'loading') import('./preload.js').then(m => m.preload(MZ)).catch(() => { });
    if (phase === 'playing' && !S.session) S.start();
    if (phase === 'menu') S.end();
  });
  MZ.on('frame', ({ dt, t }) => S.frame(dt, t));
  if (MZ.game?.phase === 'playing') S.start();
  return S;
}
