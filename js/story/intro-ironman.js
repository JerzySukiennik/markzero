// IRON MAN INTRO — "Workshop" (docs/story/DESIGN.md §2).
// Tony walks in the villa workshop. Mk I / II / III: △ on the SP-3 gantry → the classics agent's
// 25.5 s film choreography (gantry + suit + Tony clips started on the same frame at sp3_anchor,
// Tony walks onto the pad himself), hold ○ to skip. Mk 42 / Mk 85: hold △ anywhere → the gameplay
// agent's suitUp() sequences (prehensile summon / nanotech). Then the hangar bay opens, Fly / Boost
// prompts, an Exit marker at the hangar door.
import * as THREE from 'three';
import { Civilian } from './civilian.js';
import { base, marker, toWorld, holdLight } from './bases.js';
import { park, unpark, teleport } from './control.js';
import { ClipPlayer } from '../gfx/player.js';
import { INTERACT } from './index.js';
import { HelmetWatch } from './helmet.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const GANTRY = new Set(['mk1', 'mk2', 'mk3']);

/** Until the world has villa colliders: the hero also stands on the villa's own floors. */
export function baseGround(hero, world, baseName) {
  const col = hero.col, b = base(world, baseName); if (!col || !b) return () => { };
  const ray = new THREE.Raycaster(); ray.far = 60;
  const c = b.getWorldPosition(new THREE.Vector3()), down = new THREE.Vector3(0, -1, 0);
  const proxy = Object.create(col);
  proxy.groundAt = (x, z, y) => {
    const g = col.groundAt(x, z, y);
    if ((x - c.x) ** 2 + (z - c.z) ** 2 > 70 * 70) return g;
    ray.set(_v2.set(x, y + 0.6, z), down);
    const h = ray.intersectObject(b, true).find(h => h.face && h.face.normal.y > 0.3);
    return h ? Math.max(g, h.point.y) : g;
  };
  hero.col = proxy;
  return () => { if (hero.col === proxy) hero.col = col; };
}

export async function run(S) {
  const MZ = S.MZ, W = S.world, hero = S.hero, suitId = hero.suit;
  const villa = base(W, 'villa'); if (!villa) throw new Error('no villa in the world');
  const L = (x, y, z) => toWorld(W, 'villa', x, y, z);
  const vyaw = villa.rotation.y;                      // villa local −Z → world yaw
  S.phaseName = 'ironman_intro';
  S.hud(false); S.ui.bars(true);
  const useGantry = GANTRY.has(suitId);

  // ---- set dressing
  const loads = [new Civilian(MZ, W, 'tony', { colliders: [villa] }).load()];
  if (useGantry) loads.push(MZ.assets.load('assets/bases/gantry/gantry.glb'), MZ.assets.load(`assets/suits/${suitId}/${suitId}.glb`));
  const [tony, gantryG, suitG] = await Promise.all(loads);
  const anchor = marker(W, 'villa', 'sp3_anchor');
  const cues = { sfx: { play: (id, o = {}) => MZ.audio.play(id, o) }, vfx: W.vfx };
  let gp = null, sp = null, gHolder = null, sHolder = null, suit = null;
  if (useGantry) {
    gHolder = new THREE.Group(); gHolder.position.copy(anchor.p); gHolder.rotation.y = vyaw; gHolder.add(gantryG.scene);
    W.litModel?.(gantryG.scene); W.scene.add(gHolder);
    gp = new ClipPlayer(gantryG.scene, gantryG.animations, gantryG.clips, cues);
    gp.play('gantry_idle', { fade: 0 });
    sHolder = new THREE.Group(); sHolder.position.copy(anchor.p); sHolder.rotation.y = vyaw;
    suit = suitG.scene; sHolder.add(suit); W.litModel?.(suit);
    suit.traverse(o => { if (/^pilot_head|^under_/.test(o.name)) o.visible = false; });
    sp = new ClipPlayer(suit, suitG.animations, suitG.clips, cues);
    suit.visible = false; W.scene.add(sHolder);
    // Tony plays the wearer clip (joints only, the tracks he has)
    const names = new Set(); tony.root.traverse(o => names.add(o.name));
    tony.anim.addClips(suitG.animations.filter(a => a.name.endsWith('_wearer')).map(a => { const c = a.clone(); c.tracks = c.tracks.filter(t => names.has(t.name.split('.')[0])); return c; }), suitG.clips);
    S.puppets.add({ update: dt => { gp.update(dt); if (suit.visible) sp.update(dt); }, dispose: () => { gHolder.removeFromParent(); sHolder.removeFromParent(); } });
    tony.colliders = [villa, gantryG.scene];
  }
  W.vfx?.on?.('eye_flash', n => W.vfx.bb?.spawn({ at: n.getWorldPosition(new THREE.Vector3()), map: 'glow', color: 0xbfe8ff, size: 0.35, grow: 0.4, life: 0.2 }));
  // the villa's bay doors (the base root keeps its placement: drop it from the player's rest pose)
  const villaG = await MZ.assets.load('assets/bases/villa/villa.glb');
  const vp = new ClipPlayer(villa, villaG.animations, villaG.clips, cues); vp._rest.delete(villa);
  S.anims.add(vp);
  const lamps = [holdLight(W, L(0, -3.5, 6), 30, 0xdfe8ff, 16), holdLight(W, L(4, -5.2, 2), 10, 0xfff0dc, 9)];
  S.puppets.add({ dispose: () => lamps.forEach(l => l.release()) });

  // ---- spawn: Tony beside the platform, the suited controller parked on it
  const sp0 = marker(W, 'villa', 'spawn_ironman');
  tony.place(sp0.p, vyaw + Math.PI * 0.75);
  tony.camYaw = vyaw + Math.PI * 0.95; tony.camPitch = -0.18;
  S.civilian = tony;
  park(hero, MZ, anchor.p.clone().setY(anchor.p.y + 1), vyaw);
  try { W.prewarm?.(); } catch { }

  // ---- 1. establishing: a slide along the workshop to Tony, then control
  const lerpV = (a, b, t) => new THREE.Vector3().lerpVectors(a, b, Math.min(1, t));
  S.dir.cut({ pos: t => lerpV(L(-8, -4.6, 1), L(-1.5, -5.3, 1.2), t / 3.4), look: t => lerpV(L(1, -6.2, 6), L(4.2, -5.6, 4.2), t / 3.4), fov: 48, handheld: 0.35 });
  await S.wait(0.15); S.ui.cover(false);
  await S.wait(2.8);
  S.dir.release(1.3); S.ui.bars(false);
  await S.wait(0.5);
  S.beat('J.A.R.V.I.S., wake the suit.', 3.2, 'Tony');

  const act = S.act, hid = 'ironman', ui = S.ui;
  const now = MZ.params.get('suitup') === 'now';          // ?suitup=now — straight into the suit-up (testing / impatient)
  if (useGantry) {
    // ---- 2a. gantry: prompt on the platform
    const pr = ui.worldPrompt({ at: anchor.p.clone().setY(anchor.p.y + 1.2), action: INTERACT[hid], hero: hid, label: 'Suit up', sub: suitId.toUpperCase().replace('MK', 'MARK '), near: 3.2, far: 14 });
    if (now) tony.place(L(0.4, -7, 7 + 3.4), vyaw);
    await S.until(() => now || (pr.inRange && act.pressed(INTERACT[hid])));
    pr.done(); MZ.haptics.play('ui_confirm');
    tony.control = false; ui.bars(true);
    // walk to the clip's start mark (anchor space z = +2.2, facing −Z)
    const start = L(0, -7, 7 + 2.2);
    S.dir.shot({ pos: L(3.6, -5.4, 12.6), look: L(0, -6, 7.6), fov: 46, blend: 1.0 });
    await tony.walkTo(start, { stopDist: 0.1, faceYaw: vyaw });
    await S.until(() => tony._faceT == null, 1.2);
    // all three clips on the same frame; Tony's root at the anchor, the root motion walks him on
    tony.place(anchor.p, vyaw); tony.target = null;
    suit.visible = true;
    gp.play('suitup_gantry_' + suitId, { fade: 0, loop: false }); sp.play('suitup_gantry', { fade: 0, loop: false });
    tony.play('suitup_gantry_wearer', { fade: 0 });
    S.gantryTime = () => gp.base?.time ?? 0;               // tests: the clip clock
    const helm = new HelmetWatch(tony.root, suit);          // the full quiff goes when the helmet shell reaches his head
    S.puppets.add({ update: () => helm.update() });
    const D = gp.clips['suitup_gantry_' + suitId]?.duration || 25.5;
    const A = (x, y, z) => L(x, y - 7, z + 7);            // anchor space
    const shots = [
      [0, { pos: t => lerpV(A(2.6, 1.3, 3.8), A(2.2, 1.1, 2.4), t / 3), look: () => tony.root.getObjectByName('piv_hips').getWorldPosition(_v), fov: 44, blend: 0.8 }],
      [3.0, { pos: t => { const a = 0.6 + t * 0.09; return A(Math.sin(a) * 2.3, 0.6 + t * 0.03, -Math.cos(a) * 2.3); }, look: A(0, 0.55, 0), fov: 42, blend: 1.2 }],
      [11.2, { pos: t => lerpV(A(-3.4, 1.9, -3.2), A(-3.0, 2.1, -3.6), t / 8), look: A(0, 1.25, 0), fov: 50, blend: 1.4 }],
      [18.3, { pos: A(0.9, 1.45, -1.45), look: A(0, 1.3, 0), fov: 34, blend: 1.0 }],
      [21.2, { pos: t => lerpV(A(0.25, 1.75, -1.6), A(0.1, 1.72, -1.2), t / 4), look: A(0, 1.68, 0), fov: 30, blend: 1.0 }],
    ];
    let si = 0, t0 = S.T, skipHeld = 0, last = S.T;
    ui.skipHint(true);
    await S.until(() => {
      const t = S.T - t0;
      while (si < shots.length && t >= shots[si][0]) S.dir.shot(shots[si++][1]);
      skipHeld = MZ.input.down('east') ? skipHeld + (S.T - last) : 0; last = S.T;
      return t >= D || skipHeld > 0.6;
    });
    ui.skipHint(false);
    if (S.T - t0 < D - 0.1) {                             // skipped: jump to the end state
      for (const [p, n] of [[gp, 'suitup_gantry_' + suitId], [sp, 'suitup_gantry']]) { const a = p.base; if (a) { a.time = D - 0.02; p.mixer.update(0); } }
    }
    // hand-off: the armour controller takes the suit's place
    suit.visible = false; tony.root.visible = false; S.civilian = null;
    gp.play('gantry_idle', { fade: 0.2 });
  } else {
    // ---- 2b. Mk 42 / Mk 85: hold △ anywhere
    await S.wait(1.0);
    const pr = ui.worldPrompt({ at: () => _v.copy(tony.pos).setY(tony.pos.y + 2.25), action: INTERACT[hid], hero: hid, label: 'Suit up', sub: 'HOLD · ' + suitId.toUpperCase().replace('MK', 'MARK '), near: 99, far: 99 });
    let held = now ? 1 : 0, last = S.T;
    await S.until(() => {
      const dt = S.T - last; last = S.T;
      held = act.down(INTERACT[hid]) ? held + dt : Math.max(0, held - dt * 2);
      pr.setHold(Math.min(1, held / 0.6));
      return held >= 0.6;
    });
    pr.done(); MZ.haptics.play('ui_confirm');
    tony.control = false; tony.vel.set(0, 0, 0);
    // the gameplay agent's suit-up runs from Tony's spot (it brings its own Tony and camera)
    const at = tony.pos.clone(), yaw = tony.yaw;
    tony.root.visible = false; S.civilian = null;
    delete hero._storyPark;
    teleport(hero, at.clone().setY(at.y + 1), yaw);
    const unground = baseGround(hero, W, 'villa');
    S.puppets.add({ dispose: unground });
    S.dir.release(0);
    hero.suit = '__civilian';
    hero.root.visible = false;
    const ok = hero.suitUp ? await hero.suitUp(suitId) : false;
    if (!ok && hero.suit === '__civilian') hero.suit = suitId;
  }

  // ---- 3. out of the hangar
  unpark(hero); hero.root.visible = true;
  if (useGantry) {
    teleport(hero, anchor.p.clone().setY(anchor.p.y + 1), vyaw);
    const unground = baseGround(hero, W, 'villa');
    S.puppets.add({ dispose: unground });
    S.dir.release(1.2);
  }
  S.gate.mode = 'live';
  ui.bars(false); S.hud(true);
  vp.play('bay_open', { fade: 0, loop: false });
  S.beat('Bay doors open.', 2.2, 'J.A.R.V.I.S.');
  const exit = marker(W, 'villa', 'flight_exit');
  const mk = exit && ui.marker({ at: exit.p, name: 'Exit', icon: '↑', fadeNear: 6 });
  if (!S.tutorialSeen(hid)) {
    ui.move('fly', 'ascend', 'Fly', { hero: hid });
    const flew = await S.until(() => hero.m && !hero.m.grounded && hero.m.position.y > anchor.p.y + 3, 30);
    ui.moveDone('fly', flew);
    await S.wait(0.6);
    ui.move('boost', 'boost', 'Boost', { hero: hid });
    const boosted = await S.until(() => hero.act.down('boost'), 30);
    ui.moveDone('boost', boosted);
    S.tutorialDone(hid);
  }
  await S.until(() => exit && hero.m.position.distanceTo(exit.p) > 40, 60);
  mk?.remove();
  lamps.forEach(l => l.release(2));
  S.phaseName = null;
}
