// SPIDER-MAN INTRO — "Charged" (docs/story/DESIGN.md §1).
// Peter in the apartment → △ at the charging capsule → nano suit-up (the Iron Spider's own
// nano_suitup clip on the suit AND on Peter, his clothes dissolving where the suit arrives) →
// window open, climb out, jump → the real controller swings on a scripted pad → slow motion,
// the camera and the pad blend to the player, a 3-prompt tutorial, time back to normal.
import * as THREE from 'three';
import { Civilian } from './civilian.js';
import { makeCapsule } from './capsule.js';
import { apartmentWindows, toWorld, base, holdLight } from './bases.js';
import { park, unpark, teleport } from './control.js';
import { ClipPlayer } from '../gfx/player.js';
import { NanoController } from '../game/fx/nano.js';
import { INTERACT, SKIP } from './index.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const lerpV = (a, b, t) => new THREE.Vector3().lerpVectors(a, b, t);

/** Peter's clothes/skin dissolve where the suit has arrived (inverse NanoUV field). */
function inverseDissolve(root) {
  const inv = { nano: { value: 0 }, mask: { value: 0 } };   // 0 = Peter fully shown
  root.traverse(o => {
    if (!o.isMesh || !o.geometry.attributes.uv1) return;
    const u = (o.userData?.nano_driver === 'drv_mask') ? inv.mask : inv.nano;
    o.material = [].concat(o.material).map(m0 => {
      const m = m0.clone();
      m.onBeforeCompile = sh => {
        sh.uniforms.uInvNano = u;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 uv1;\nvarying float vInvU;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInvU = uv1.x;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uInvNano;\nvarying float vInvU;')
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vInvU < uInvNano - 0.004) discard;');
      };
      m.customProgramCacheKey = () => 'invnano';
      return m;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
  return inv;
}

export async function run(S) {
  const MZ = S.MZ, W = S.world, hero = S.hero;
  const L = (x, y, z) => toWorld(W, 'apartment', x, y, z);
  const apt = base(W, 'apartment');
  if (!apt) throw new Error('no apartment in the world');
  S.phaseName = 'spider_intro';
  S.hud(false); S.ui.bars(true);

  // ---- set dressing: windows, capsule, Peter, the Iron Spider puppet
  const [wins, peter, suitG, libG] = await Promise.all([
    apartmentWindows(MZ, W),
    new Civilian(MZ, W, 'peter', { colliders: [apt] }).load(),
    MZ.assets.load('assets/suits/ironspider/ironspider.glb'),
    MZ.assets.load('assets/anims/spider_core.glb'),
  ]);
  peter.colliders = [apt];
  for (const w of Object.values(wins)) S.anims.add(w.player);
  const win = wins.win_06;

  const cap = makeCapsule();
  W.litModel?.(cap.root);
  // desk top under the capsule spot, found by a ray (no hard-coded furniture height)
  const capAt = L(16.75, 2.0, 6.45);
  const ray = new THREE.Raycaster(capAt, new THREE.Vector3(0, -1, 0), 0, 3);
  const deskHit = ray.intersectObject(apt, true).find(h => h.point.y > capAt.y - 1.9);
  cap.root.position.set(capAt.x, deskHit ? deskHit.point.y : capAt.y - 1.24, capAt.z);
  W.scene.add(cap.root);
  S.puppets.add({ update: dt => cap.update(dt), dispose: () => cap.dispose() });

  const suit = suitG.scene; suit.name = 'story_ironspider';
  W.litModel?.(suit);
  suit.traverse(o => { if (o.isMesh && o.material?.emissiveIntensity > 1.2) o.material.emissiveIntensity = /glow/.test(o.material.name) ? 0.9 : 1.1; });
  const cues = { sfx: { play: (id, o = {}) => MZ.audio.play(id, o) }, vfx: W.vfx };
  const sp = new ClipPlayer(suit, [...suitG.animations, ...libG.animations], [suitG.clips, libG.clips], cues);
  const nano = new NanoController(suit);
  suit.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial) W.cr?.addMaterial(m); });
  // a holder moves it: ClipPlayer.resetPose() puts the GLB root itself back to its rest transform
  const holder = new THREE.Group(); holder.name = 'story_ironspider_at'; holder.add(suit);
  suit.visible = false; W.scene.add(holder);
  const suitPuppet = { update: dt => { if (suit.visible) { sp.update(dt); nano.update(dt); } }, dispose: () => holder.removeFromParent() };
  S.puppets.add(suitPuppet);
  // Peter also plays the suit's nano_suitup (same skeleton; only the tracks he has)
  { const names = new Set(); peter.root.traverse(o => names.add(o.name));
    peter.anim.addClips(suitG.animations.filter(c => /nano_/.test(c.name)).map(c => { const k = c.clone(); k.tracks = k.tracks.filter(t => names.has(t.name.split('.')[0])); return k; }), suitG.clips); }
  const inv = inverseDissolve(peter.root);

  // ---- spawn: Peter in his room, the suited controller parked on the roof out of sight
  const spawn = L(18.86, 0, 2.6);
  peter.place(spawn, Math.PI * 0.92);           // turned a little towards the desk
  peter.camYaw = Math.PI * 0.8; peter.camPitch = -0.2;
  S.civilian = peter;
  park(hero, MZ, L(19, 5.5, 14), 0);
  try { W.prewarm?.(); } catch { }
  // warm lamp light in Peter's room (the base has emissive lamps only)
  const lamps = [holdLight(W, L(19.5, 2.9, 3.6), 14, 0xffd2a0, 10), holdLight(W, L(15.6, 1.9, 5.4), 5, 0xffe2b8, 5)];
  S.puppets.add({ dispose: () => lamps.forEach(l => l.release()) });

  // ---- 1. establishing push-in, then control
  S.dir.cut({ pos: t => lerpV(L(23.2, 2.9, 0.9), L(21.4, 2.1, 1.9), Math.min(1, t / 3.2)), look: t => lerpV(L(17.2, 0.9, 6.2), L(17.6, 1.1, 4.6), Math.min(1, t / 3.2)), fov: 46, handheld: 0.4 });
  await S.wait(0.15);
  S.ui.cover(false);
  MZ.audio.play('sp_cloth_1', { gain: 0.4 });
  await S.wait(2.4);
  S.dir.release(1.3);
  S.ui.bars(false);
  await S.wait(0.6);
  S.beat("Suit's charged. Time to go.", 3.4, 'Peter');

  // ---- 2. the capsule prompt (world space, anchored to the capsule)
  const act = S.act, hid = 'spiderman';
  const capTop = () => _v.copy(cap.root.position).setY(cap.root.position.y + 0.3);
  const pr = S.ui.worldPrompt({ at: capTop, action: INTERACT[hid], hero: hid, label: 'Suit', sub: 'NANOTECH · 100%', near: 1.7, far: 8 });
  await S.until(() => pr.inRange && act.pressed(INTERACT[hid]));
  pr.done();
  MZ.haptics.play('ui_confirm'); MZ.audio.ui?.('ui_confirm');

  // ---- 3–4 are one cinematic: hold ○ to skip straight to the hand-off
  const pivRoot = suit.getObjectByName('piv_root');
  const puck = cap.puck;
  let sync = null;
  S.skippable(true);
  try {
    // ---- 3. take the pod, nano suit-up
    peter.control = false;
    S.ui.bars(true);
    const standAt = L(16.75, 0, 5.72);
    S.dir.shot({ pos: L(18.4, 1.55, 4.7), look: L(16.8, 1.0, 6.1), fov: 40, blend: 0.9 });
    await S.guard(peter.walkTo(standAt, { stopDist: 0.08, faceYaw: Math.PI }));
    await S.wait(0.35);
    cap.open(); MZ.audio.play('mk85_nano_tap', { at: cap.root, gain: 0.6 });
    await S.wait(0.45);
    peter.play('human_catch', { fade: 0.3 });
    await S.wait(0.55);
    // the pod jumps to his right hand
    const hand = peter.root.getObjectByName('piv_palmR') || peter.root.getObjectByName('piv_wristR');
    cap.take(); cap.drain();
    hand.attach(puck);
    const puckTo = new THREE.Vector3(0, -0.05, -0.02);
    S.puppets.add({ update: dt => { if (puck.parent === hand) puck.position.lerp(puckTo, 1 - Math.exp(-dt * 10)); } });
    MZ.haptics.play('suit_select', 0.5);
    await S.wait(0.35);
    // turn to the room, pod to the chest: the suit pours out of it
    peter.stopOneShot(0.25); peter._faceT = 0;
    S.dir.shot({ pos: t => lerpV(L(17.95, 1.45, 3.7), L(18.35, 1.25, 4.15), Math.min(1, t / 3.6)), look: t => lerpV(L(16.75, 1.25, 5.72), L(16.75, 1.05, 5.72), Math.min(1, t / 3.6)), fov: 38, blend: 0.7 });
    await S.until(() => Math.abs(peter.yaw) < 0.05 || Math.abs(peter.yaw - Math.PI * 2) < 0.05, 0.9);
    peter.yaw = 0; peter._faceT = null; peter._sync();
    holder.position.copy(peter.root.position); holder.rotation.set(0, peter.yaw, 0);
    nano.update(0);
    suit.visible = true;
    sp.play('nano_suitup', { fade: 0, loop: false });
    const suitDur = sp.clips.nano_suitup?.duration || 3;
    peter.play('nano_suitup', { fade: 0.15 });
    MZ.haptics.play('nano_flow');
    const drv = n => suit.getObjectByName(n);
    let flashed = false;
    sync = {
      update: () => {
        const n = drv('drv_nano')?.position.x ?? 1, m = drv('drv_mask')?.position.x ?? 1;
        inv.nano.value = n; inv.mask.value = m;
        if (!flashed && n > 0.02) { flashed = true; puck.visible = false; W.vfx?.bb?.spawn({ at: puck.getWorldPosition(new THREE.Vector3()), map: 'glow', color: 0x9fefff, size: 0.5, grow: 1.5, life: 0.35 }); MZ.haptics.play('suit_clamp', 0.6); }
      },
    };
    S.puppets.add(sync);
    await S.wait(Math.max(0.4, suitDur - 0.25));
    peter.root.visible = false; S.civilian = null;
    S.puppets.delete(sync);
    sp.play('idle', { fade: 0.3 });
      S.dir.shake(0.2);
    await S.wait(0.6);

    // ---- 4. the window: cut outside, open it, climb out, jump
    const winStand = L(18.86, 0, 0.5);
    holder.position.copy(winStand); holder.rotation.set(0, 0, 0);
    sp.play('idle', { fade: 0 });
    S.dir.cut({ pos: t => lerpV(L(16.3, 1.9, -3.4), L(16.8, 1.7, -3.0), Math.min(1, t / 3)), look: L(18.86, 1.25, 0.2), fov: 44, handheld: 0.5 });
    await S.wait(0.35);
    sp.play('window_open', { fade: 0.2, loop: false }); win?.player.play('window_open', { fade: 0, loop: false });
    await S.wait((sp.clips.window_open?.duration || 1.4) + 0.05);
    sp.play('window_climb_out', { fade: 0.15, loop: false });
    S.dir.shot({ pos: t => lerpV(L(15.2, 1.2, -4.8), L(15.8, 0.6, -6.5), Math.min(1, t / 1.4)), look: () => pivRoot.getWorldPosition(_v2).setY(_v2.y + 0.6), fov: 50, blend: 0.5, handheld: 0.6 });
    await S.wait(1.05);

  } catch (e) {
    if (e !== SKIP) throw e;
    // end state of the cinematic: suited, pod used, window open, standing outside on the sill line
    if (sync) S.puppets.delete(sync);
    cap.take(); cap.drain(); puck.visible = false;
    peter.root.visible = false; S.civilian = null;
    win?.player.play('window_open', { fade: 0, loop: false }); if (win?.player.base) { win.player.base.time = 1.39; win.player.mixer.update(0); }
    holder.position.copy(L(18.86, 0, -1.4)); holder.rotation.set(0, 0, 0);
    sp.play('idle', { fade: 0 }); pivRoot.position.set(0, 0.75, 0);
  }
  S.skippable(false);

  // ---- 5. hand-off to the real controller (Jurek: beginner-friendly — no leap over a building):
  //         out of the window, a short drop along the façade, then 2 gentle scripted swings EAST along the
  //         street in front of the apartment (20 m wide, buildings both sides, 200 m long), and the player
  //         takes over at the top of an arc, facing down the street.
  const hp = pivRoot.getWorldPosition(new THREE.Vector3()); hp.y += 1.0; hp.z -= 1.2;
  suit.visible = false; S.puppets.delete(suitPuppet); holder.removeFromParent();
  unpark(hero);
  lamps.forEach(l => l.release(1.5));
  const EAST = -Math.PI / 2;                                   // yaw facing +X
  teleport(hero, hp, EAST, new THREE.Vector3(5, 0.5, -1.2));   // drifts off the wall towards the street centre
  const g = S.gate;
  g.script({ down: [], axes: { lx: 0, ly: -0.05, rx: 0, ry: 0 } });   // gentle: the pendulum, barely any pumping
  const hpos = () => hero.pos || hero.root.position;
  // a trailing camera behind and a little to the street side, kept out of the buildings
  const camP = hp.clone().add(new THREE.Vector3(-7, 2.5, -3));
  S.onFrame = dt => {
    const p = hpos(), want = _v.set(p.x - 8.5, p.y + 1.8, p.z - 2.5);
    const d = _v2.subVectors(want, p), len = d.length(); d.divideScalar(len);
    const hit = hero.col?.raycast(p, d, len + 1);
    if (hit) want.copy(p).addScaledVector(d, Math.max(2, hit.t - 1.2));
    camP.lerp(want, 1 - Math.exp(-dt * 2.6));
  };
  S.dir.shot({ pos: () => camP, look: () => _v2.copy(hpos()).add({ x: 4, y: 0.2, z: 0 }), fov: 60, blend: 0.5, handheld: 0.3 });
  await S.wait(0.4);                                           // the drop along the façade
  for (let k = 0; k < 2; k++) {
    g.set({ down: ['swing'] });
    await S.until(() => hero.rope && !(hero.rope.flying > 0), 0.8);
    await S.wait(1.35);                                        // down through the bottom and up
    await S.until(() => !hero.rope || hero.vel.y < 1.5, 0.8);
    g.set({ down: [] });                                       // let go on the way up
    if (k === 0) await S.wait(0.3);
  }
  await S.until(() => hero.vel.y <= 0.4 || hero.grounded, 1.2); // the top of the arc
  S.handoff = { y: hero.pos.y, speed: hero.vel.length(), heading: Math.atan2(hero.vel.x, -hero.vel.z), anchor: !!hero.findAnchor?.(hero.pos.clone().add({ x: 0, y: 0.9, z: 0 })) };

  // ---- 6. slow motion at the apex; the camera and the stick come to the player; Hold R2 swings
  //         (at 0.2× the fall is slow, and the street has anchors on both sides).
  //         Seen the tutorial before? No slow motion, no prompts: the pad takes over at once.
  const P = hid, ui = S.ui;
  if (S.tutorialSeen(P)) {
    S.dir.release(1.0); S.ui.bars(false); S.onFrame = null; S.hud(true);
    g.set({ down: act.down('swing') ? ['swing'] : [] }); g.mode = 'live';
    S.phaseName = null;
    return;
  }
  S.time.to(0.2, 0.35);
  S.dir.release(1.1);
  S.ui.bars(false);
  S.onFrame = dt => { g.mix = Math.min(1, g.mix + dt / 1.0); };
  S.hud(true);
  await S.wait(0.4);
  ui.move('swing', 'swing', 'Hold · Swing', { hero: P });
  await S.until(() => act.down('swing'));
  g.set({ down: [] }); g.mode = 'live'; S.onFrame = null;
  ui.moveDone('swing', true);
  S.time.to(1, 0.9);
  await S.wait(1.2);
  // release
  ui.move('jump', 'jump', 'Release', { hero: P });
  const rel = await S.until(() => act.pressed('jump') && !hero.grounded, 25);
  ui.moveDone('jump', rel);
  await S.wait(0.9);
  // zip
  ui.move('zip', null, 'Zip', { hero: P, combo: ['aim', 'swing'] });
  const zipped = await S.until(() => !!hero.zip, 25);
  ui.moveDone('zip', zipped);
  S.tutorialDone(P);
  S.phaseName = null;
}
