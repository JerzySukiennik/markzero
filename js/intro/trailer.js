// The intro trailer: a cinematic in the real engine (the city at golden hour, the NEXT suits and clips),
// cut to the music clock from timeline.json. Shots are small functions: setup(ctx) → {update(dt, t, k)}.
// The world is a private World instance (loaded behind the title cards) and is disposed before the menu.
import * as THREE from 'three';
import { World } from '../world/world.js';
import { ClipPlayer } from '../gfx/player.js';
import { NanoController } from '../game/fx/nano.js';
import { Director } from '../story/director.js';
import { SummonRig } from '../game/suitup/summon-three.js';
import { HelmetWatch, setHelmetHair } from '../story/helmet.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerpV = (a, b, t) => new THREE.Vector3().lerpVectors(a, b, THREE.MathUtils.clamp(t, 0, 1));
const ease = t => t * t * (3 - 2 * t);
const clamp = THREE.MathUtils.clamp, _m4 = new THREE.Matrix4(), _q2 = new THREE.Quaternion();
/** Spider-Man hanging on a web: body up along the rope, facing the direction of travel (the game's rule,
 * spider.js), slerped — never snapped — and the swing clip's phase set from the pendulum angle. */
function hang(sp, center, anchor, vel, dt, th, fallbackYaw = 0) {
  const up = _v.subVectors(anchor, center).normalize();
  const f = vel.clone().addScaledVector(up, -vel.dot(up));
  if (f.lengthSq() < 0.25) f.set(-Math.sin(fallbackYaw), 0, -Math.cos(fallbackYaw));
  f.addScaledVector(up, -f.dot(up)).normalize();
  const back = f.clone().negate(), x = new THREE.Vector3().crossVectors(up, back).normalize();
  _m4.makeBasis(x, up, back); _q2.setFromRotationMatrix(_m4);
  if (sp._hung) sp.holder.quaternion.slerp(_q2, 1 - Math.exp(-10 * dt)); else { sp.holder.quaternion.copy(_q2); sp._hung = true; }
  sp.holder.position.copy(center).addScaledVector(up, -1.0);
  const k = clamp(th / 1.2, -1, 1), want = k < 0 ? 0.48 * (k + 1) : 0.48 + 0.82 * k;   // 0 back-top · 0.48 bottom · 1.3 front-top
  const a = sp.player.base; if (a && a.getClip().name === 'swing') { a.paused = true; a.time = want; }
}
/** a follow-camera position kept out of the buildings (pulled towards the subject along the collider ray) */
function safeCam(T, subject, want) {
  const d = _v.subVectors(want, subject), L = d.length(); if (L < 0.1) return want; d.divideScalar(L);
  const h = T.world.collide?.raycast(subject, d, L + 0.8, {});
  return h ? subject.clone().addScaledVector(d, Math.max(1.5, h.t - 0.8)) : want;
}
/** Iron Man's body the way the game draws it: attitude from the velocity (pitch/yaw, bank from the turn) —
 * the flight clips carry the prone lean themselves, so the rig is NEVER tilted by hand. */
function flyAttitude(im, vel, dt, bank = 0) {
  const hs = Math.hypot(vel.x, vel.z), yaw = Math.atan2(-vel.x, -vel.z), pitch = clamp(Math.atan2(vel.y, Math.max(hs, 1e-3)), -1.2, 1.2);
  _q2.setFromEuler(new THREE.Euler(pitch, yaw, bank, 'YXZ'));
  if (im._flown) im.holder.quaternion.slerp(_q2, 1 - Math.exp(-8 * dt)); else { im.holder.quaternion.copy(_q2); im._flown = true; }
  im.root.quaternion.identity();
}

export class Trailer {
  constructor(MZ, tl) { this.MZ = MZ; this.tl = tl; this.p = {}; this.ready = false; this.loading = null; this.cur = null; this.slow = 1; }
  async loadWorld(progress = () => { }) {
    const MZ = this.MZ;
    const W = this.world = new World(MZ);
    await W.load((p, l) => progress(p * 0.7, l));
    W.cr.setHour(this.tl.hour ?? 18.75, { envNow: true });
    this.dir = new Director(W.camera);
    if (!this.cancelled) { W.view.visible = true; MZ.stage.world.visible = true; }
    // every actor BEFORE the music starts (loading or compiling mid-trailer = a visible hitch)
    progress(0.72, 'heroes');
    await Promise.all([this.load('mk85'), this.load('spider')]);
    progress(0.82, 'actors');
    await Promise.all(['tony', 'mk42', 'hulk', 'veronica'].map(k => this.load(k).catch(e => console.warn('[intro] asset', k, e))));
    try { const [g, table] = await Promise.all([MZ.assets.load('assets/suits/mk42/mk42.glb'), fetch('/assets/suits/mk42/mk42.pieces.json').then(r => r.json())]); W.litModel(g.scene); this.summonKit = { g, table }; } catch (e) { console.warn('[intro] summon kit', e); }
    progress(0.95, 'actors');
    // compile every material now: show all actors for one compile pass, then hide them again
    for (const p of Object.values(this.p)) p.holder.visible = true;
    try { const r = MZ.stage.renderer; if (r.compileAsync) await r.compileAsync(W.scene, W.camera); else r.compile(W.scene, W.camera); } catch (e) { console.warn('[intro] compile', e); }
    // and upload every texture (compile does not; a first-time upload mid-shot stalls the frame)
    try { const r = MZ.stage.renderer, seen = new Set(); W.scene.traverse(o => { if (!o.isMesh) return; for (const m of [].concat(o.material)) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) { const t = m?.[k]; if (t && !seen.has(t)) { seen.add(t); r.initTexture(t); } } }); } catch (e) { console.warn('[intro] textures', e); }
    for (const p of Object.values(this.p)) p.holder.visible = false;
    this.ready = true;
    return this;
  }
  // ------------------------------------------------------------------ puppets
  async puppet(glb, libs = [], { nano = false } = {}) {
    const MZ = this.MZ, W = this.world, A = MZ.assets;
    const [g, ...L] = await Promise.all([A.load(glb), ...libs.map(l => A.load(l))]);
    const root = g.scene; W.litModel(root);
    const holder = new THREE.Group(); holder.add(root); holder.visible = false; W.scene.add(holder);
    const cues = { sfx: { play: (id, o = {}) => MZ.audio.play(id, { ...o, gain: (o.gain ?? 1) * 0.8 }) }, vfx: W.vfx };
    const player = new ClipPlayer(root, [...g.animations, ...L.flatMap(l => l.animations)], [g.clips, ...L.map(l => l.clips)], cues);
    const nanoC = nano && root.getObjectByProperty('isMesh', true) ? new NanoController(root) : null;
    if (nanoC) root.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial) W.cr?.addMaterial(m); });
    const P = { holder, root, player, nano: nanoC, g,
      play: (n, o = {}) => player.play(n, { fade: 0.2, ...o }),
      show: (on = true) => { holder.visible = on; },
      update: dt => { if (holder.visible) { player.update(dt); nanoC?.update(dt); } },
      node: n => root.getObjectByName(n) };
    return P;
  }
  async load(key) {
    if (this.p[key]) return this.p[key];
    const IM = 'assets/anims/ironman_core.glb';
    const def = {
      mk85: ['assets/suits/mk85/mk85.glb', [IM], { nano: true }], mk42: ['assets/suits/mk42/mk42.glb', [IM]],
      spider: ['assets/suits/ironspider/ironspider.glb', ['assets/anims/spider_core.glb'], { nano: true }],
      tony: ['assets/characters/tony/tony.glb', ['assets/anims/human_core.glb']],
      hulk: ['assets/suits/hulkbuster/hulkbuster.glb', ['assets/anims/hulkbuster_core.glb']],
      veronica: ['assets/vehicles/veronica/veronica.glb', []],
    }[key];
    const p = this.p[key] = await this.puppet(...def);
    if (key === 'mk85' || key === 'mk42' || key === 'hulk') p.thr = this.world.vfx.rigThrusters(p.root, { style: key === 'hulk' ? 'flame' : 'repulsor' });
    if (key === 'tony' && this.p.mk85) { const names = new Set(); p.root.traverse(o => names.add(o.name)); p.player.addClips(this.p.mk85.g.animations.filter(c => c.name === 'nano_suitup').map(c => { const k = c.clone(); k.tracks = k.tracks.filter(t => names.has(t.name.split('.')[0])); return k; }), this.p.mk85.g.clips); }
    return p;
  }
  hideAll() {
    for (const p of Object.values(this.p)) { p.show(false); p.thr?.forEach(t => t.set(0)); p._hung = p._flown = false; p.holder.quaternion.identity(); const a = p.player.base; if (a) a.paused = false; }
    this.rope = null; try { this.world.webfx?.clear(); } catch { }   // every web line / splat / fibre gone AT the cut (no slack web drifting into the next shot)
    const R = this.summon; if (R) { R.suit.removeFromParent(); for (const m of Object.values(R.meshes)) m.obj.removeFromParent(); for (const j of Object.values(R.jets || {})) j.g?.removeFromParent(); this.summon = null; }
    if (this.p.tony) setHelmetHair(this.p.tony.root, false);
  }
  ground(x, z, y = 1000) { return this.world.collide?.groundAt(x, z, y) ?? 0; }

  // ------------------------------------------------------------------ shots
  shot(id, slow) {
    const f = SHOTS[id]; if (!f) return false;
    const need = NEEDS[id] || [];
    if (!need.every(k => this.p[k])) return false;              // assets not there yet: keep the previous shot
    this.hideAll();
    this.slow = slow ?? 1; this.shotT = 0;
    try { this.cur = f(this) || null; } catch (e) { console.warn('[intro] shot', id, e); this.cur = null; }
    this.curId = id;
    return true;
  }
  update(dt, t) {
    if (!this.world) return;
    const sdt = dt * this.slow;
    this.shotT += sdt;
    this.cur?.update?.(sdt, this.shotT, dt);
    for (const p of Object.values(this.p)) p.update(sdt);
    if (this.summon) { this.p.tony.root.updateMatrixWorld(true); this.summon.update(sdt); }
    this.world.update(sdt, dt, t, null);
    this.dir.apply(dt, t);
  }
  dispose() {
    this.hideAll();
    for (const p of Object.values(this.p)) p.holder.removeFromParent();
    const W = this.world; this.world = null; if (!W) return;
    const stage = this.MZ.stage, other = stage.world && stage.world !== W.view ? stage.world : null;   // a game world took over the stage
    W.dispose();
    if (other) stage.world = other;
  }
}

// ---------------------------------------------------------------- shot library
const NEEDS = { tether_wide: ['mk85', 'spider'], tether_close: ['mk85', 'spider'], swing_towers: ['spider'], nano_mk85: ['mk85', 'tony'], summon_mk42: ['mk42', 'tony'],
  repulsor: ['mk85'], veronica_drop: ['hulk', 'veronica'], cut_boost: ['mk85'], cut_zip: ['spider'], cut_repulsor: ['mk42'], cut_tether: ['mk85', 'spider'], cut_land: ['hulk'], finale: ['mk85', 'spider'] };

/** Iron Man flying a straight line with Spider-Man on a web below him, swinging on it (the signature co-op move) */
function tether(T, { from, to, dur, spd = 1 }) {
  const im = T.p.mk85, sp = T.p.spider, W = T.world;
  // above the skyline whatever the city's height profile is (the city-art pass may raise the towers):
  // Iron Man clears the tallest roof under the whole path (+ the web + a margin)
  from = from.clone(); to = to.clone();
  let sky = -Infinity; for (let i = 0; i <= 24; i++) { const p = lerpV(from, to, i / 24); for (const [dx, dz] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]]) sky = Math.max(sky, T.ground(p.x + dx, p.z + dz, 5000)); }
  const lift = Math.max(0, sky + 32 - Math.min(from.y, to.y)); from.y += lift; to.y += lift;
  im.show(); sp.show(); im.play('fly_cruise', { fade: 0 }); sp.play('swing', { fade: 0 });
  im.thr.forEach(t => t.set(0.85));
  const dir = _v2.subVectors(to, from).normalize().clone(), yaw = Math.atan2(-dir.x, -dir.z), vel = dir.clone().multiplyScalar(from.distanceTo(to) * spd / dur);
  // the web ends ON the armour, under him (prone cruise: the chest faces down) — never at a joint inside the suit
  const chest = im.node('piv_reactor') || im.node('piv_chest') || im.root, tip = chest.name === 'piv_reactor' ? V(0, 0, -0.04) : V(0, 0, -0.2);
  const A = new THREE.Vector3(), L = 8.5, prev = new THREE.Vector3(), c = new THREE.Vector3();
  T.rope = W.webfx.line({ from: sp.node('piv_webR') || sp.node('piv_wristR'), to: { object: chest, local: tip }, kind: 'swing', silent: true });
  let first = true;
  return { dir, yaw, update(dt, t) {
    im.holder.position.copy(lerpV(from, to, t / dur * spd));
    flyAttitude(im, vel, dt);
    im.holder.updateMatrixWorld(true); A.copy(tip).applyMatrix4(chest.matrixWorld);
    // a slow pendulum along the flight line (he trails a little behind, the web taut)
    const th = -0.25 + Math.sin(t * 1.3) * 0.4;
    c.copy(A).addScaledVector(dir, Math.sin(th) * L).add(V(0, -Math.cos(th) * L, 0));
    const v = first ? vel.clone() : c.clone().sub(prev).divideScalar(Math.max(dt, 1e-4));
    prev.copy(c); first = false;
    hang(sp, c, A, v, dt, th, yaw);
  }, im, sp, p: () => im.holder.position };
}

const SHOTS = {
  tether_wide(T) {
    const from = V(320, 195, 40), to = V(-160, 188, 20), s = tether(T, { from, to, dur: 18 });
    // they pass the camera left to right against the setting sun (west), close enough to read both
    T.dir.cut({ pos: t => safeCam(T, s.p(), s.p().clone().add(V(-24 + t * 2.6, -7, 17 - t * 0.4))), look: () => s.p().clone().add(V(0, -4, 0)), fov: 40, handheld: 0.3 });
    return s;
  },
  tether_close(T) {
    const from = V(240, 170, 45), to = V(-200, 158, 10), s = tether(T, { from, to, dur: 16 });
    T.dir.cut({ pos: () => safeCam(T, s.p(), s.p().clone().add(V(-9, -4.5, 7))), look: () => s.p().clone().add(V(0, -5, 0)), fov: 38, handheld: 0.5 });
    return s;
  },
  swing_towers(T) {
    // Billionaires' Row: a chain of arcs, each new web starting exactly where the last one let go
    const sp = T.p.spider, W = T.world; sp.show();
    const z = -735, dir = V(1, 0, 0), L = 36, TH0 = -0.9;
    let A = null, th = TH0, line = null, n = 0;
    const c = new THREE.Vector3(), prev = new THREE.Vector3();
    const attach = pos => {
      A = pos.clone().addScaledVector(dir, Math.sin(-TH0) * L).add(V(0, Math.cos(TH0) * L, 0));
      line?.release(); line = W.webfx.line({ from: sp.node('piv_webR') || sp.root, to: A.clone(), kind: 'swing' }); T.rope = line;
      sp.play('swing', { fade: 0.15, restart: true }); th = TH0; n++;
    };
    const start = V(-200, 125, z); attach(start); prev.copy(start);
    T.dir.cut({ pos: () => safeCam(T, sp.holder.position.clone().add(V(0, 1, 0)), sp.holder.position.clone().add(V(-6.5, 1.5, 5.5))), look: () => sp.holder.position.clone().add(V(1.5, 0.3, 0)), fov: 52, handheld: 0.4 });
    return { update(dt) {
      th += dt * 1.35;
      c.set(A.x + Math.sin(th) * L * dir.x, A.y - Math.cos(th) * L, A.z + Math.sin(th) * L * dir.z);
      const v = c.clone().sub(prev).divideScalar(Math.max(dt, 1e-4)); prev.copy(c);
      hang(sp, c, A, v, dt, th, -Math.PI / 2);
      if (th > -TH0 && n < 6) attach(c.clone());
    } };
  },
  nano_mk85(T) {
    const im = T.p.mk85, tony = T.p.tony, W = T.world;
    const pad = V(1454.4, T.ground(1454.4, 1697.8, 60), 1697.8), yaw = W.scene.getObjectByName('base_villa')?.rotation.y || 1.33;
    for (const p of [im, tony]) { p.show(); p.holder.position.copy(pad); p.holder.rotation.set(0, yaw, 0); p.root.quaternion.identity(); }
    im.play('nano_suitup', { fade: 0, loop: false }); tony.play('nano_suitup', { fade: 0, loop: false });
    const f = V(-Math.sin(yaw), 0, -Math.cos(yaw)), r = V(Math.cos(yaw), 0, -Math.sin(yaw));
    T.dir.cut({ pos: t => pad.clone().addScaledVector(f, 2.6 - t * 0.12).addScaledVector(r, 1.1).add(V(0, 1.45, 0)), look: pad.clone().add(V(0, 1.25, 0)), fov: 34, handheld: 0.4 });
    let helm = null;
    return { update(dt, t) { const n = im.node('drv_nano')?.position.x ?? 1; tony.show(n < 0.99); if (t > 0.15) (helm ||= new HelmetWatch(tony.root, im.root, { nanoDriver: 'drv_nano_helmet' })).update(); } };
  },
  summon_mk42(T) {
    // exactly the game's Mk 42 summon (game/suitup/summon-three.js): Tony is the wearer, the pieces fly to HIS
    // joints and clamp on in order; he gestures, then braces (human_summon_gesture → human_catch)
    const tony = T.p.tony, W = T.world, kit = T.summonKit; if (!kit) return null;
    const pad = V(1454.4, T.ground(1454.4, 1697.8, 60), 1697.8), yaw = (W.scene.getObjectByName('base_villa')?.rotation.y || 1.33) + 0.6;
    tony.show(); tony.holder.position.copy(pad); tony.holder.rotation.set(0, yaw, 0); tony.play('human_idle', { fade: 0 });
    tony.holder.updateMatrixWorld(true);
    const suit = kit.g.scene; W.scene.add(suit);
    const rig = T.summon = new SummonRig({ THREE, suit, table: kit.table, wearer: tony.root, scene: W.scene, seed: 11, ground: (x, z) => T.ground(x, z, pad.y + 2) });
    rig.suit = suit;
    tony.player.protect(Object.values(rig.joints));
    rig.scatter({ center: [pad.x, pad.y, pad.z], rMin: 5, rMax: 11, farChance: 0.15, farMin: 11, farMax: 16 });
    rig.onEvent = e => { if (e.type === 'lock') { const big = (e.size || 0.15) > 0.22; T.MZ.audio.play(big ? 'mk42_lock_big' : 'mk42_lock', { gain: 0.6 }); if (e.pos) W.vfx.sparks?.burst(new THREE.Vector3(...e.pos), null, big ? 8 : 4, 3, 1, new THREE.Color(1, 0.8, 0.45), 0.35); } };
    const helm = new HelmetWatch(tony.root, null); helm.pieces = Object.values(rig.meshes).map(m => m.obj).filter(o => /^helmet/.test(o.name));
    const f = V(-Math.sin(yaw), 0, -Math.cos(yaw)), r = V(Math.cos(yaw), 0, -Math.sin(yaw));
    T.dir.cut({ pos: t => pad.clone().addScaledVector(f, 3.9 - t * 0.25).addScaledVector(r, 1.6).add(V(0, 1.35 + t * 0.06, 0)), look: pad.clone().add(V(0, 1.15, 0)), fov: 44, handheld: 0.5 });
    let go = false, gest = false;
    return { update(dt, t) {
      if (!gest) { gest = true; tony.play('human_summon_gesture', { fade: 0.15, loop: false }); }
      if (t > 0.15 && !go) { go = true; rig.summon(); }
      if (t > 0.9 && gest !== 2) { gest = 2; tony.play('human_catch', { fade: 0.3 }); }
      helm.update();
    } };
  },
  repulsor(T) {
    const im = T.p.mk85, W = T.world, at = V(-860, 5.5, 336);
    im.show(); im.holder.position.copy(at); im.holder.rotation.set(0, 0.2, 0); im.root.quaternion.identity(); im.play('hover', { fade: 0 });
    im.thr.forEach(t => t.set(0.55));
    const cam = at.clone().add(V(-1.4, 0.3, -5.2));
    T.dir.cut({ pos: t => cam.clone().add(V(0, 0, t * 0.6)), look: at.clone().add(V(0, 0.6, 0)), fov: 40, handheld: 0.4 });
    let fired = false;
    return { update(dt, t) {
      if (t > 0.35 && !fired) { fired = true; im.play('shoot_R', { fade: 0.05, loop: false }); setTimeout(() => { const palm = im.node('piv_palmR'); if (palm) W.vfx.repulsors.fire(palm, W.camera.position.clone().add(V(0.6, 0, 0)), { big: true }); T.dir.shake(0.6); W.juice?.flashScreen?.(0.35, 0xbfe3ff); T.MZ.audio.play('repulsor_fire_big', { gain: 0.9 }); }, 180); }
    } };
  },
  veronica_drop(T) {
    const vr = T.p.veronica, hb = T.p.hulk, W = T.world;
    const x = -905, z = 330, g = T.ground(x, z, 5), top = g + 64;          // Pier 5: open deck, the river behind
    vr.show(); vr.holder.position.set(x, top, z); vr.play('hover', { fade: 0 }); setTimeout(() => vr.play('bay_open', { fade: 0.1, loop: false }), 400);
    hb.show(); hb.holder.position.set(x, top - 6, z); hb.root.quaternion.identity(); hb.play('jump', { fade: 0 });
    let vy = 0, landed = false;
    // low on the deck looking up: Veronica overhead, the Hulkbuster drops into the frame and lands in front
    T.dir.cut({ pos: t => V(x + 11, g + 1.5, z + 6), look: t => { const h = hb.holder.position; return V(h.x, Math.max(g + 2, h.y + 1.5), h.z); }, fov: 58, handheld: 0.5 });
    return { update(dt, t) {
      if (t < 0.9) return;
      if (!landed) {
        vy -= 22 * dt; hb.holder.position.y += vy * dt;
        if (hb.holder.position.y <= g) {
          landed = true; hb.holder.position.y = g; hb.play('land_heavy', { fade: 0.05, loop: false });
          W.juice?.shock?.(hb.holder.position, 1.6, 0.8); T.dir.shake(0.9); W.vfx.cue?.('dust', hb.root, { size: 3 }, hb.root);
          T.MZ.audio.play('hb_land_heavy', { gain: 1 }) || T.MZ.audio.play('en_explosion', { gain: 0.7 });
          T.MZ.haptics.play('explosion_near');
        }
      }
    } };
  },
  cut_boost(T) {
    const im = T.p.mk85, from = V(-1180, 34, 250), to = V(-820, 34, 250);            // low over the river, fast
    im.show(); im.play('fly_fast', { fade: 0 }); im.thr.forEach(t => t.set(1));
    const vel = to.clone().sub(from).divideScalar(2.2);
    T.dir.cut({ pos: t => im.holder.position.clone().add(V(-8 + t * 3, 1.2, 6.5)), look: () => im.holder.position.clone().add(V(3, 0.3, 0)), fov: 62, handheld: 0.35 });
    return { update(dt, t) { im.holder.position.copy(lerpV(from, to, t / 2.2)); flyAttitude(im, vel, dt, -0.15); } };
  },
  cut_zip(T) {
    const sp = T.p.spider, W = T.world, p0 = V(120, T.ground(120, 60) + 2, 60);
    sp.show(); sp.holder.position.copy(p0); sp.holder.rotation.set(0, 0, 0); sp.play('web_zip', { fade: 0, loop: false });
    const to = p0.clone().add(V(0, 26, -30));
    T.rope = W.webfx.line({ from: sp.node('piv_webR') || sp.root, to: to.clone(), kind: 'zip' });
    T.dir.cut({ pos: p0.clone().add(V(4, 1.2, 6)), look: () => sp.holder.position.clone().add(V(0, 1, 0)), fov: 52, handheld: 0.5 });
    return { update(dt, t) { if (t > 0.26) sp.holder.position.lerp(to, 1 - Math.exp(-dt * 3)); } };
  },
  cut_repulsor(T) {
    const im = T.p.mk42, W = T.world, at = V(-850, T.ground(-850, 322, 5) + 0.02, 322);
    im.show(); im.holder.position.copy(at); im.root.quaternion.identity(); im.holder.rotation.set(0, 1.2, 0); im.play('aim_both', { fade: 0 });
    im.thr.forEach(t => t.set(0.3));
    T.dir.cut({ pos: at.clone().add(V(2.6, 1.7, 3.2)), look: at.clone().add(V(-5, 1.2, -5)), fov: 46, handheld: 0.3 });
    return { update(dt, t) { if (t > 0.2 && !this.f) { this.f = true; const pl = im.node('piv_palmL'), pr = im.node('piv_palmR'); const tg = at.clone().add(V(-30, 1, -14)); if (pl) W.vfx.repulsors.fire(pl, tg, { big: true }); if (pr) W.vfx.repulsors.fire(pr, tg, { big: true }); T.dir.shake(0.4); } } };
  },
  cut_tether(T) {
    const s = tether(T, { from: V(-120, 140, -420), to: V(-120, 150, -780), dur: 6 });
    T.dir.cut({ pos: () => safeCam(T, s.p(), s.p().clone().add(V(14, -12, -12))), look: () => s.p().clone().add(V(0, -4, 0)), fov: 50, handheld: 0.4 });
    return s;
  },
  cut_land(T) {
    const hb = T.p.hulk, W = T.world, p = V(-905, T.ground(-905, 330, 5), 330);
    hb.show(); hb.holder.position.copy(p); hb.play('land_heavy', { fade: 0, loop: false }); hb.player.base && (hb.player.base.time = 0.25);
    T.dir.cut({ pos: p.clone().add(V(3.5, 0.6, 5)), look: p.clone().add(V(0, 2, 0)), fov: 36, handheld: 0.6 });
    return null;
  },
  finale(T) {
    const from = V(360, 180, -40), to = V(-260, 190, -60), s = tether(T, { from, to, dur: 40 });
    T.dir.cut({ pos: t => safeCam(T, s.p(), s.p().clone().add(V(22 - t * 0.9, 2 + t * 0.2, 16 - t * 0.5))), look: () => s.p().clone().add(V(-4, -4, 0)), fov: 40, handheld: 0.25 });
    return s;
  },
};
