// The world: the NEXT city (renderer + tiles + props + water + sky, copied from the showroom into
// web/js/city/), the collision heightfield, POIs, a fixed light pool, the VFX hubs, city ambience,
// camera juice (shake / FOV kick / hitstop) and the player factory. Budget: docs/ADR-001-engine.md.
import * as THREE from 'three';
import { devPost } from '../core/env.js';
import { TIERS as Q_TIERS } from '../gfx/quality.js';
import { CityRenderer } from '../city/render.js';
import { CityWorld } from '../city/world.js';
import { CityAmbience } from '../city/ambience.js';
import { U as CITY_U } from '../city/materials.js';
import { VFX, LightPool } from '../gfx/vfx.js';
import { WebFX } from '../gfx/webfx.js';
import { Heightfield } from './heightfield.js';
import { placeBase, patchBase, kitAtMarkers } from '../city/bases.js';
import { createJuicePass, JuiceDriver, createNanGuardPass } from '../gfx/juice.js';
import { mergeRigid } from '../gfx/merge.js';
import { buildWorldCollider, colliderDebug, uncoveredMeshes } from './colliders.js';
import { installWater } from './water.js';

// Quality tiers live in gfx/quality.js (MZ.gfx: auto = GPU class + measured bench, Settings override, ?tier= forces one)
export const TIERS = Object.fromEntries(Object.entries(Q_TIERS).map(([k, v]) => [k, v.world]));
let gameModule;   // web/js/game/index.js (gameplay agent) or null

export class World {
  constructor(MZ) {
    this.MZ = MZ;
    const tierName = MZ.gfx?.tier || MZ.params.get('tier') || 'high';
    this.tier = TIERS[tierName] ? tierName : 'high'; this.T = { ...TIERS[this.tier] };
    // per-feature overrides for budget experiments: ?refl=0.25&cascades=2&props=0&water=0&shadowrate=0|1&scale=0.85
    const P = MZ.params, num = k => P.has(k) ? +P.get(k) : undefined;
    if (P.has('refl')) this.T.reflScale = num('refl'); if (P.has('cascades')) this.T.cascades = num('cascades');
    if (P.has('props')) this.T.props = P.get('props') !== '0'; if (P.has('water')) this.T.water = P.get('water') !== '0';
    if (P.has('scale')) this.T.renderScale = num('scale');
    this.T.shadowStagger = P.get('shadowrate') !== '1';   // far cascades re-render every 2nd / 4th frame
    this.bench = P.get('bench');
    MZ.perf.tier = this.tier;
    this.view = MZ.stage.createWorld();
    this.scene = this.view.scene; this.camera = this.view.camera;
    const audio = MZ.audio;
    this.ctx = {
      THREE, viewer: this.view, scene: this.scene, camera: this.camera, renderer: MZ.stage.renderer, controls: this.view.controls,
      url: rel => '/' + rel.replace(/^\/+/, ''),
      load: rel => MZ.assets.load(rel), env: { set: n => this.view.setEnv(n) },
      sfx: { play: (id, o = {}) => audio.play(id, { bus: 'amb', ...o }) },
    };
    this.kickState = { trauma: 0, fov: 0, hitstop: 0, slow: 1, slowT: 0 };
    this.pois = [];
  }

  async load(progress) {
    const MZ = this.MZ, T = this.T;
    progress(0.02, 'city renderer');
    const cr = this.cr = new CityRenderer(this.ctx, { reflScale: T.reflScale, cascades: T.cascades, shadowSize: T.shadowSize });
    // juice pass: before the tone-mapping OutputPass of the city composer
    this.nanGuard = createNanGuardPass(); cr.composer.insertPass(this.nanGuard, 1);   // right after the scene render
    this.juicePass = createJuicePass();
    { const ps = cr.composer.passes, oi = ps.findIndex(p => p.constructor?.name === 'OutputPass'); cr.composer.insertPass(this.juicePass, oi < 0 ? ps.length : oi); }
    this.juice = new JuiceDriver(this, this.juicePass); this.juice.enabled = MZ.params.get('juice') !== '0';
    this.pool = new LightPool(this.scene, 8);            // BEFORE any material compiles: the light count never changes again
    const city = this.city = new CityWorld(this.ctx, cr);
    this.scene.add(city.group);
    const [hf, collide] = await Promise.all([
      new Heightfield().load(),
      // ONE collider for everything (gameplay agent's prism collider from layout.json: real wall normals)
      import('../game/collide.js').then(m => m.CityCollider.load()).catch(e => { console.warn('[world] no CityCollider', e); return null; }),
      city.load({ props: T.props, traffic: T.props, onProgress: p => progress(0.05 + p * 0.8, 'city') }),
      fetch('/design/map/poi.json').then(r => r.json()).then(j => { this.pois = j.items || []; }).catch(() => { }),
    ]);
    this.hf = hf; this.collide = collide;
    progress(0.86, 'bases');
    await this.loadBases();
    progress(0.88, 'colliders');
    try { this.collide = await buildWorldCollider(this); } catch (e) { console.error('[world] collider build failed, city prisms only', e); }
    if (this.collide?.parts3) installWater(this);        // water is not a floor; waterAt/isWater; splash/respawn
    if (MZ.params.get('colliders') === '1') colliderDebug(this, this.collide);
    // ?facadeDebug=1 uv · 2 style · 3 albedo · 4 shadow/ao/rough · 5 NaN pixels in magenta (D3D11 hunt)
    // ?cam=x,y,z,tx,ty,tz — fixed debug camera (comparable shots on any machine)
    if (MZ.params.get('cam')) { const c = MZ.params.get('cam').split(',').map(Number); if (c.length === 6) this.debugCam = [c.slice(0, 3), c.slice(3)]; }
    if (MZ.params.has('facadeDebug')) CITY_U.uDebug.value = +MZ.params.get('facadeDebug');
    this.uncovered = () => uncoveredMeshes(this);
    // Props (layer 1) cast into the two NEAR cascades only. With props in the far cascade too, Spider-Man at his
    // apartment reliably hung the HP's GPU (Windows TDR, nvlddmkm 153 → context lost → the WHITE frame); bisected
    // on the HP 2026-09-26: props=0 or cascades=2 each removed it. Far props are sub-texel in that cascade anyway.
    cr.csm.lights.forEach((l, i) => { if (i < 2) l.shadow.camera.layers.enable(1); else l.shadow.camera.layers.disable(1); });
    // start hour: ?hour=H or ?tod=<preset> (morning noon afternoon golden sunset dusk night); default 17.6 (city-art: 16.2 was the flattest light)
    { const tod = MZ.params.get('tod'); cr.setHour(MZ.params.has('hour') ? +MZ.params.get('hour') : (CityRenderer.PRESETS?.[tod] ?? CityRenderer.DEFAULT_HOUR ?? 17.6), { envNow: true }); }
    if (!T.water) { cr.water.enabled = false; }
    MZ.stage.setRenderScale(T.renderScale);
    progress(0.9, 'effects');
    this.vfx = new VFX(this.scene, { sfx: { play: (id, o = {}) => MZ.audio.play(id, o) } });
    this.vfx.pool = this.pool;
    this.vfx.onImpact = (p, n, big) => this.juice.shock(p, big ? 1.2 : 0.45, big ? 0.7 : 0.45);
    this._offEv = MZ.on('game:event', e => {
      const pl = e.from ? MZ.game.players.get(e.from) : MZ.game.local;
      const at = pl?.root?.position; if (!at) return;
      if (e.kind === 'land') this.juice.shock(at, Math.min(1.5, (e.speed || 10) / 20), 0.6);
      else if (e.kind === 'hit') { this.juice.shock(at, 0.8, 0.5); if (!e.from) this.juice.flashScreen(0.18, 0xff3040); }
      else if (e.kind === 'boost') this.juice.shock(at, 0.9, 0.5);
    });
    this.webfx = new WebFX({ scene: this.scene, camera: this.camera, onSound: (id, o = {}) => MZ.audio.play(id, { at: o.position, gain: o.gain }) });
    this.amb = new CityAmbience(this.ctx); this.amb.start();
    if (gameModule === undefined) gameModule = await import('../game/index.js').catch(() => null);
    this.fallback = gameModule?.createPlayer ? null : await import('./fallback.js');
    this.view.visible = false; this.MZ.stage.world.visible = false;                 // nothing on screen until the players are in (the UI shows loading)
    progress(0.97, 'players');
  }
  async loadBases() {
    const layout = this.city.layout;
    this.bases = []; this.baseByName = {};
    for (const [name, base] of Object.entries(layout.bases || {})) {
      try {
        const g = await this.MZ.assets.load(base.glb);
        placeBase(g.scene, base); patchBase(g.scene, this.cr); g.scene.name = 'base_' + name;
        this.scene.add(g.scene); this.bases.push(g.scene); this.baseByName[name] = g.scene;
        await kitAtMarkers(this.ctx, g.scene, this.cr).catch(() => { });
        await this.placeWindows(g.scene).catch(e => console.warn('[world] windows', name, e));
        // marker lights are NOT created (every real light costs every material a light loop) — emissives only
      } catch (e) { console.warn('[world] base failed', name, e); }
    }
  }
  /** WIN-A (assets/bases/apartment/window_a.glb) at every win_* marker of a base, named 'window_a' with its own
   * ClipPlayer (window_open / window_close). base.userData.windows = {win_01: {root, player}} — the story reuses them. */
  async placeWindows(base) {
    const marks = []; base.traverse(o => { if (/^win_\d+$/.test(o.name)) marks.push(o); });
    if (!marks.length) return;
    const out = base.userData.windows || {};
    const cues = { sfx: { play: (id, o = {}) => this.MZ.audio.play(id, o) } };
    for (const m of marks) {
      if (m.getObjectByName('window_a')) continue;
      const g = await this.MZ.assets.load('assets/bases/apartment/window_a.glb');
      g.scene.name = 'window_a';
      this.litModel(g.scene);
      g.scene.traverse(o => { if (o.isMesh) for (const mt of [].concat(o.material)) if (/glass/i.test(mt.name)) { mt.transparent = true; mt.opacity = 0.16; mt.depthWrite = false; o.castShadow = false; } });
      m.add(g.scene);
      out[m.name] = { root: g.scene, player: await this.MZ.assets.player(g.scene, g, [], cues) };
    }
    base.userData.windows = out;
  }
  /** Compile every material now (behind the loading screen) instead of hitching on first sight. */
  /** Compile every material now. Compiles against the composer's scene target: renderer.compile() with no target
   * builds the canvas variant (sRGB output + ACES in the shader) that the game never draws with — story's
   * intro-spider called this 4 s after 'playing' and compiled 60 useless programs (the 5 s start hitch). */
  prewarm() {
    const r = this.MZ.stage.renderer, prev = r.getRenderTarget();
    // compileAsync: with KHR_parallel_shader_compile the driver builds them side by side instead of one after another
    try { r.setRenderTarget(this.cr?.rt || null); (r.compileAsync ? r.compileAsync(this.scene, this.camera) : r.compile(this.scene, this.camera))?.catch?.(() => { }); } catch (e) { console.warn(e); } finally { r.setRenderTarget(prev); }
    // shadow-depth variants + buffers of whatever was added since the warm-up: render those alone over the next frames
    if (this._warmed) {
      const fresh = this.scene.children.filter(k => !this._warmed.has(k) && !/^city_env|__lightpool/.test(k.name));
      fresh.forEach(k => this._warmed.add(k));
      if (fresh.length) return import('./warmup.js').then(m => m.warmGroups(this, fresh.map(k => [k]))).catch(e => console.warn('[world] warm', e));
    }
  }

  /** Register a loaded model's materials with the city lighting (cascaded sun shadows). */
  litModel(root) {
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial) this.cr.addMaterial(m); } });
    return root;
  }
  /** Merge a rigid suit's plates into one skinned mesh per material (draw calls 247 → 18 for Mk 85,
   * 430 → 6 for Mk 42, per pass and per shadow cascade). Call after material patching (nano). See gfx/merge.js. */
  optimizeModel(root, opts) { return mergeRigid(root, opts); }
  async createPlayer(opts) {
    const make = gameModule?.createPlayer || this.fallback.createPlayer;
    return make(this.MZ, this, opts);
  }

  kick({ shake = 0, fov = 0, hitstop = 0, slow = 0, slowTime = 0 } = {}) {
    const k = this.kickState, ui = window.UI?.settings || {};
    shake *= ui.camShake ?? 1; if (ui.reduceMotion) { shake *= 0.3; fov *= 0.3; }
    k.trauma = Math.min(1, k.trauma + shake); k.fov += fov; k.hitstop = Math.max(k.hitstop, hitstop);
    if (slow) { k.slow = slow; k.slowT = slowTime; }
  }
  timeScale(dt) {
    const k = this.kickState;
    if (k.hitstop > 0) { k.hitstop -= dt * 1000; return 0; }
    if (k.slowT > 0) { k.slowT -= dt; return dt * k.slow; }
    return dt;
  }

  /** Frame-time guard (HP): frames > 200 ms three times within 10 s → drop one quality step on the fly. Armed after
   * the warm-up so loading hitches don't count. Steps: render scale 0.85 → no water reflection + prop shadows
   * off → render scale 0.7 + shorter prop draw distances. */
  armGuard() { this._guard = { armedAt: performance.now(), hits: [], step: 0, last: performance.now() }; }
  _guardTick() {
    const G = this._guard; if (!G) return;
    const now = performance.now(), dt = now - G.last; G.last = now;
    // armed 15 s after 'playing': the story intro / first sight of the Manhattan towers hitch once at the start (HP log
    // 2026-09-26: one 5 s window right after 'playing' dropped quality for the whole session)
    if (now - G.armedAt < 15000 || document.hidden) return;
    if (dt > 200) { G.hits = G.hits.filter(h => now - h < 10000); G.hits.push(now); console.warn('[guard] frame', dt.toFixed(0), 'ms'); }
    // soft rule: a sustained average over 14 ms (10 s window) also costs one step, at most one every 20 s
    (G.win ||= []).push(dt); if (G.win.length > 600) G.win.shift();
    const avg = G.win.reduce((a, b) => a + b, 0) / G.win.length;
    const slow = G.win.length >= 300 && avg > 14 && now - (G.lastStep || G.armedAt) > 20000;
    if ((G.hits.length >= 3 || slow) && G.step < 3) {
      G.lastStep = now; G.win = [];
      G.step++; G.hits = [];
      const MZ = this.MZ;
      if (G.step === 1) MZ.stage.setRenderScale(Math.min(MZ.stage.renderScale, 0.85));
      if (G.step === 2) { this.cr.water.enabled = false; this.city.noPropShadows = true; }
      if (G.step === 3) { MZ.stage.setRenderScale(0.7); this.city.distMul = 0.6; }
      MZ.perf.tier = this.tier + '-guard' + G.step;
      devPost('/api/stats', { client: MZ.perf.client, label: 'guard-step-' + G.step, gpu: MZ.perf.gpu });
      console.warn('[guard] quality step', G.step);
    }
  }

  update(simDt, dt, t, local) {
    const cam = this.camera;
    this._guardTick();
    this._frame = (this._frame || 0) + 1;
    if (this.T.shadowStagger) this.cr.csm.lights.forEach((l, i) => { l.shadow.autoUpdate = false; if (i === 0 || (this._frame + i) % (i === 1 ? 2 : 8) === 0) l.shadow.needsUpdate = true; });   // far cascade every 8th frame (Manhattan heights: CPU-bound on the HP)
    if (this.debugCam) { cam.position.set(...this.debugCam[0]); cam.lookAt(...this.debugCam[1]); }
    else if (this.bench) this.benchCamera(t, cam, local);
    else if (local?.updateCamera) local.updateCamera(dt, cam);
    // juice on top of whatever the controller did with the camera
    const k = this.kickState;
    k.trauma = Math.max(0, k.trauma - dt * 1.6); k.fov *= Math.exp(-dt * 7);
    const s = k.trauma * k.trauma;
    if (s > 1e-4) {
      const n = t * 38;
      cam.rotateX((Math.sin(n * 1.3) + Math.sin(n * 2.9)) * 0.012 * s);
      cam.rotateY((Math.sin(n * 1.7 + 1) + Math.sin(n * 3.3)) * 0.012 * s);
      cam.rotateZ(Math.sin(n * 2.1 + 2) * 0.02 * s);
    }
    if (Math.abs(k.fov) > 0.01 || cam.userData.baseFov) {
      cam.userData.baseFov ??= cam.fov;
      cam.fov = (local?.fov ?? cam.userData.baseFov) + k.fov; cam.updateProjectionMatrix();
    }
    { const ui = window.UI?.settings || {}; this.juice.enabled = this.MZ.params.get('juice') !== '0' && ui.screenFx !== false; this.juice.reduce = !!ui.reduceMotion; }
    this.juice.update(dt, t, cam, local);
    this.waterMon?.update(simDt, t);
    this.city.update(dt, cam);
    this.collide?.parts3?.traffic?.update();
    this.vfx.update(simDt, t, cam);
    this.webfx.update(simDt);
    this.amb.update(dt, cam);
  }

  /** ?bench=1 — a fixed camera flight for comparable frame times: down 6th Av at 35 m (the street canyon, worst
   * case for the facade shader), 28 m/s, ping-pong, with the local hero carried 14 m ahead of the camera. */
  benchCamera(t, cam, local) {
    const span = 1200, u = (t * 28) % (2 * span), z = u < span ? 600 - u : -600 + (u - span), d = u < span ? -1 : 1;
    cam.position.set(120, 39, z); cam.lookAt(120, 35, z + d * 30);
    if (local?.m) { local.m.position.set(120, 35, z + d * 14); local.m.velocity.set(0, 0, d * 28); local.m.yaw = d < 0 ? 0 : Math.PI; }
    else if (local?.pos) local.pos.set(122, 35, z + d * 12);
    this.MZ.perf.label = 'bench:' + this.bench;
  }

  dispose() {
    const MZ = this.MZ;
    this._offEv?.(); this.amb?.dispose(); this.vfx?.clear(); this.city?.dispose(); this.cr?.dispose();
    this.scene.clear();
    MZ.stage.destroyWorld(); MZ.stage.setRenderScale(1);
  }
}
