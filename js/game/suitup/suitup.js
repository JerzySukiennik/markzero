// In-game suit-up moments (V2 had none: wear(id) swapped the model). Each runs where the player
// is, takes the controls for its duration, drives a cinematic camera, then hands back the new
// armour through IronMan.buildBody() — the flight state and position carry over.
//
//   mk85        nanotech: the suit's own nano_suitup clip (drv_nano / drv_paint / helmet drivers)
//               pours over Tony, who plays the same clip inside and is hidden once it is formed.
//   mk42        prehensile summon: the current armour is shed, Tony gestures, the Mk 42's pieces
//               fly in from 25–45 m (mk42 runtime, summon.js) and clamp on in order.
//   hulkbuster  Veronica: descends, opens the bay, the Hulkbuster assembles around the current
//               armour (deploy.js, from the showroom), bay closes, she climbs away.
import * as THREE from 'three';
import { Animator } from '../anim.js';
import { ClipPlayer } from '../../gfx/player.js';
import { SummonRig } from './summon-three.js';
import { Deploy, INNER_SUITS, SEQUENCES } from './deploy.js';
import { setHelmetHair } from '../fx/helmethair.js';

const TONY = 'assets/characters/tony/tony.glb', HUMAN = 'assets/anims/human_core.glb';
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

/** A line for the player (UI shows game:event 'message'; until it does, a minimal fallback line). */
export function say(im, text, ms = 2600) {
  im.MZ.emit?.('game:event', { kind: 'message', text });
  if (im.MZ.ui?.message) { im.MZ.ui.message(text, ms); return; }
  let el = document.getElementById('mz-say');
  if (!el) { el = document.createElement('div'); el.id = 'mz-say'; el.style.cssText = 'position:fixed;left:50%;top:22%;transform:translateX(-50%);padding:8px 16px;border-radius:8px;background:rgba(8,10,14,.7);color:#f2f2f2;font:600 15px/1.2 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;z-index:60;pointer-events:none;transition:opacity .3s'; document.body.appendChild(el); }
  el.textContent = text; el.style.opacity = '1'; clearTimeout(el._t); el._t = setTimeout(() => el.style.opacity = '0', ms);
}

export async function runSuitUp(im, id) {
  const fn = { mk85: nano, mk42: summon, hulkbuster: veronica }[id] || instant;
  return fn(im, id);
}

/** common frame: lock the pilot, stop weapons, announce */
function begin(im, id, cine) {
  im.locked = true; im.cine = cine;
  for (const s of Object.values(im.shot)) { s.buf = 0; s.charging = false; s.charge = 0; }
  im.event({ kind: 'suitup_start', suit: id });
}
function end(im, id, from) {
  im.locked = false; im.cine = null;
  im.MZ.theme?.set?.(id);
  im.MZ.emit?.('suit:change', { suit: id, hero: 'ironman', from });
  im.event({ kind: 'suitup_done', suit: id });
  im.haptic('suit_select'); im.kick({ shake: 0.2, fov: -3 });
}
async function tony(im) {
  const [t, h] = await Promise.all([im.MZ.assets.load(TONY), im.MZ.assets.load(HUMAN)]);
  const root = t.scene; im.world.litModel?.(root) ?? root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  root.position.copy(im.root.position); root.quaternion.setFromAxisAngle(_v.set(0, 1, 0), im.m.yaw);
  im.world.scene.add(root);
  im.tony = root;
  return { root, gltf: t, human: h };
}

// ---------------------------------------------------------------- Mk 85: nanotech
async function nano(im, id) {
  const from = im.suit;
  const T = await tony(im);
  begin(im, id, { off: [1.6, 1.3, -3.2], look: 1.2, fov: 42 });
  await im.buildBody(id);
  const A = im.anim;
  // Tony plays the SAME clip (it drives piv_* by name), so the shell forms exactly over him
  const tA = new Animator(T.root, [...T.human.animations, ...im.bodyClips], [T.human.clips, im.bodyMetas]);
  const dur = A.duration('nano_suitup') || 3.6;
  A.oneShot('nano_suitup', { fadeIn: 0, fadeOut: 0.2 }); tA.oneShot('nano_suitup', { fadeIn: 0, fadeOut: 0 });
  im.sfx('mk85_nano_flow', { at: im.root }); im.haptic('nano_flow');
  let t = 0, helmetDone = false;
  return new Promise(res => {
    im.suitup = {
      update(dt) {
        t += dt; tA.update(dt);
        T.root.position.copy(im.root.position); T.root.quaternion.copy(im.root.quaternion);
        const n = im.nano?.value('drv_nano', 1) ?? 1, hh = im.nano?.value('drv_nano_helmet', 1) ?? 1;
        if (hh > 0.02) setHelmetHair(T.root, true, im.MZ);          // the helmet starts forming: quiff off
        if (hh > 0.9 && !helmetDone) { helmetDone = true; im.sfx('mk85_nano_helmet', { at: im.root }); im.haptic('suit_clamp');
          const head = im.root.getObjectByName('piv_head')?.getWorldPosition(new THREE.Vector3());     // the helmet seals: a cyan flash
          if (head) { im.world.vfx?.bb.spawn({ at: head, map: 'glow', color: 0x9fe6ff, size: 1.4, grow: 0.8, life: 0.18 }); im.world.vfx?.sparks.burst(head, null, 14, 2.5, 1, new THREE.Color(0.6, 0.9, 1), 0.4, 1); im.world.vfx?.flashLight?.(head, 8, 0.15, 0x9fe6ff); } }
        T.root.visible = !(n >= 0.995 && hh >= 0.995);
        if (t >= dur) { this.abort(); end(im, id, from); res(); }
      },
      abort() { T.root.removeFromParent(); tA.dispose(); im.suitup = null; im.locked = false; im.cine = null; im.tony = null; },
    };
  });
}

// ---------------------------------------------------------------- Mk 42: prehensile summon
async function summon(im, id) {
  const from = im.suit, MZ = im.MZ;
  const table = await fetch('/assets/suits/mk42/mk42.pieces.json').then(r => r.ok ? r.json() : null).catch(() => null);
  if (!table) { console.warn('[suitup] mk42.pieces.json missing, instant suit-up'); say(im, 'Mark 42 — pieces offline'); return instant(im, id); }
  const [T, suit] = await Promise.all([tony(im), MZ.assets.load('assets/suits/mk42/mk42.glb')]);
  begin(im, id, { off: [2.4, 1.6, -4.6], look: 1.1, fov: 50 });
  const next = im.loadBody(id);                // the armour Tony ends up in, ready before the last clamp
  // the old armour comes off: a flash where it was (the pieces of THAT suit are not a rig)
  im.world.vfx?.cue('flash', im.root, { size: 1.6, color: 0xbfe3ff });
  im.sfx('mk42_eject', { at: im.root.position.clone() });
  im.root.visible = false;
  im.world.litModel?.(suit.scene); im.world.scene.add(suit.scene);
  const tA = new Animator(T.root, T.human.animations, [T.human.clips]);
  tA.setBase({ human_idle: 1 }, 100);
  const rig = new SummonRig({ THREE, suit: suit.scene, table, wearer: T.root, scene: im.world.scene, seed: 11, ground: (x, z) => im.col.groundAt(x, z, im.root.position.y + 2) });
  tA.protect(Object.values(rig.joints));
  // pieces start 25–45 m away ("flies to you in pieces") — scattered round the pilot, lifted
  const c = im.root.position;
  rig.scatter({ center: [c.x, c.y, c.z], rMin: 25, rMax: 45, farChance: 0.3, farMin: 45, farMax: 70 });
  let t = 0, locked = false, doneT = -1, summoned = false;
  rig.onEvent = e => {
    const big = (e.size || 0.15) > 0.22, at = e.pos ? new THREE.Vector3(...e.pos) : im.root.position;
    if (e.type === 'fly') im.sfx(big ? 'mk42_whoosh_big' : 'mk42_whoosh', { at: at.clone(), gain: 0.7 });
    if (e.type === 'lock') { im.sfx(big ? 'mk42_lock_big' : 'mk42_lock', { at: at.clone() }); im.haptic('suit_clamp', big ? 1 : 0.6); im.world.vfx?.sparks.burst(at, null, big ? 10 : 5, 3, 1, new THREE.Color(1, 0.8, 0.45), 0.4); }
    if (e.type === 'allLocked') { locked = true; im.sfx('mk42_suit_ready', { gain: 0.7 });
      const c = im.root.position.clone(); c.y += 1.2; im.world.vfx?.bb.spawn({ at: c, map: 'glow', color: 0xffe2b0, size: 2.4, grow: 0.8, life: 0.2 }); im.world.vfx?.flashLight?.(c, 14, 0.2, 0xffd9a0); im.kick({ shake: 0.2, fov: -2 }); }
  };
  return new Promise(res => {
    im.suitup = {
      update(dt) {
        t += dt;
        if (t > 0.3 && !summoned) { summoned = true; tA.oneShot('human_summon_gesture', { fadeIn: 0.2, fadeOut: 0.4 }); }
        if (t > 1.0 && !this._go) { this._go = true; rig.summon(); tA.setBase({ human_catch: 1 }, 3); }
        T.root.position.copy(im.root.position); T.root.quaternion.setFromAxisAngle(_v.set(0, 1, 0), im.m.yaw);
        tA.update(dt); T.root.updateMatrixWorld(true); rig.update(dt);
        if (!this._hair) {                                           // the helmet piece closes on the head: quiff off
          const hp = T.root.getObjectByName('piv_head')?.getWorldPosition(_v);
          for (const [name, recs] of Object.entries(rig.pieceMeshes)) if (/helmet|face/i.test(name)) for (const r of recs) if (hp && r.obj.getWorldPosition(new THREE.Vector3()).distanceTo(hp) < 0.3) this._hair = true;
          if (this._hair) setHelmetHair(T.root, true, im.MZ);
        }
        if (locked && doneT < 0) doneT = t;
        if ((doneT >= 0 && t > doneT + 0.5) || t > 14) {
          this.abort();
          im.buildBody(id, next).then(() => { end(im, id, from); res(); });
        }
      },
      abort() { suit.scene.removeFromParent(); for (const r of Object.values(rig.meshes)) r.obj.removeFromParent(); for (const j of Object.values(rig.jets)) j.g.removeFromParent(); T.root.removeFromParent(); tA.dispose(); im.suitup = null; },
    };
  });
}

// ---------------------------------------------------------------- Hulkbuster: Veronica
async function veronica(im, id) {
  const from = im.suit, MZ = im.MZ, world = im.world;
  const group = new THREE.Group(); group.name = 'veronica_drop';
  // THE DROP ZONE (CONTRACT §10: Veronica needs ≥ 12 m of open space): the nearest clear patch of
  // ground below his altitude — the street under him, a big roof, a park. In the air he is set down there.
  const zone = dropZone(im), air = !im.m.grounded && im.m.position.y - zone.y > 6;
  if (!zone.ok) say(im, air ? 'Veronica: no drop zone — catching you in the air' : 'Veronica: no drop zone — nearest open ground');
  if (!zone.ok && air) return hbDrop(im, id, null);                 // no patch below: the suit is caught mid-air
  const gy = zone.y;
  group.position.set(zone.x, gy, zone.z); group.rotation.y = im.m.yaw;
  world.scene.add(group);
  const cues = { sfx: { play: (sid, o = {}) => MZ.audio?.play(sid, o) }, vfx: world.vfx };
  const camProxy = new THREE.Object3D(), ctl = { target: new THREE.Vector3() };
  const ctx = {
    THREE, vfx: world.vfx, camera: camProxy, controls: ctl, env: { name: 'city', set() { } },
    load: async rel => { const g = await MZ.assets.load(rel); return { scene: g.scene, animations: g.animations, clipsJson: g.clips }; },
    player: (root, anims, meta) => new ClipPlayer(root, anims, meta, cues),
    shadows: root => world.litModel ? world.litModel(root) : root,
  };
  const dep = new Deploy(ctx, group);
  dep.inner = INNER_SUITS[from] ? from : 'mk42';
  try { await dep.init(); }
  catch (e) {                                                        // e.g. veronica.glb missing (next-slim)
    console.warn('[suitup] Veronica unavailable, fallback drop', e);
    group.removeFromParent(); say(im, 'Veronica offline — Hulkbuster drop');
    return hbDrop(im, id, zone);
  }
  begin(im, id, { deploy: true });
  const next = im.loadBody(id);
  im.root.visible = false;
  dep.begin('deploy'); dep.T = 4.0;                      // join the descent late: 22 s, not 26
  const total = SEQUENCES.deploy.duration;
  im.haptic('explosion_far');
  return new Promise(res => {
    im.suitup = {
      cam(cam) {                                          // deploy space → world, pulled out of walls
        const want = group.localToWorld(_v.copy(camProxy.position)), tgt = group.localToWorld(new THREE.Vector3().copy(ctl.target));
        // the showroom keys assume an open field (40–70 m out); in a street they sit inside blocks
        const d = want.clone().sub(tgt), L = d.length(); d.divideScalar(L || 1);
        const hit = im.col.raycast(tgt, d, L);
        if (hit) want.copy(tgt).addScaledVector(d, Math.max(3, hit.t - 1.5));
        const g = im.col.groundAt(want.x, want.z, want.y) + 1.2; if (want.y < g) want.y = g;
        this._cp = this._cp ? this._cp.lerp(want, 0.25) : want.clone();
        cam.position.copy(this._cp); cam.lookAt(tgt); cam.fov = hit ? 62 : 50; return cam.fov;
      },
      update(dt) {
        dep.update(dt);
        if (dep.T >= total - 1.2) {
          this.abort();
          im.teleport(new THREE.Vector3(group.position.x, gy + 1, group.position.z), im.m.yaw, { grounded: true });
          im.buildBody(id, next).then(() => { end(im, id, from); res(); });
        }
      },
      abort() { dep.end(); group.removeFromParent(); for (const t of dep.vrThr || []) t.set(0); im.suitup = null; },
    };
  });
}

async function instant(im, id) {
  const from = im.suit;
  im.world.vfx?.cue('flash', im.root, { size: 1.4, color: 0xdfefff });
  await im.buildBody(id);
  end(im, id, from);
}

function dropZone(im) {
  const p = im.m.position, C = im.col;
  const test = (x, z, clear, flatTol) => {
    const y = C.groundAt(x, z, p.y);
    if (y < -1 || p.y - y > 400) return null;                               // water / nothing below
    if (C.wallNear?.({ x, y: y + 2, z }, clear) || C.inside(x, y + 2, z) || C.inside(x, y + 8, z)) return null;
    for (let j = 0; j < 6; j++) { const b = j / 6 * Math.PI * 2; if (Math.abs(C.groundAt(x + Math.cos(b) * clear * 0.8, z + Math.sin(b) * clear * 0.8, y + 1) - y) > flatTol) return null; }
    return { x, y, z };
  };
  for (const [clear, tol, R] of [[6, 0.8, [0, 8, 16, 26, 40, 60]], [4, 1.5, [0, 10, 25, 45, 70, 100, 130]]]) {
    for (const r of R) for (let k = 0; k < (r ? 16 : 1); k++) {
      const a = k / 16 * Math.PI * 2 + im.m.yaw, hit = test(p.x + Math.sin(a) * r, p.z - Math.cos(a) * r, clear, tol);
      if (hit) return { ...hit, ok: clear === 6 };
    }
  }
  return { x: p.x, y: C.groundAt(p.x, p.z, p.y), z: p.z, ok: false };
}

/** Fallback Hulkbuster arrival (no Veronica asset, or no drop zone under him in the air): the suit
 * comes down on its own rockets from high up behind, and he is caught — mid-air, or at the zone. */
async function hbDrop(im, id, zone) {
  const from = im.suit, MZ = im.MZ, W = im.world, T = THREE;
  const next = im.loadBody(id);
  const g = await MZ.assets.load('assets/suits/hulkbuster/hulkbuster.glb').catch(() => null);
  begin(im, id, { off: [4.5, 2.2, -10], look: 1.6, fov: 55 });
  const air = !zone;
  const end_ = air ? im.m.position.clone().setY(im.m.position.y - 1) : new T.Vector3(zone.x, zone.y, zone.z);
  const back = new T.Vector3(Math.sin(im.m.yaw), 0, Math.cos(im.m.yaw));
  const start = end_.clone().addScaledVector(back, 70).setY(end_.y + 120);
  let hb = null, plumes = [];
  if (g) {
    hb = g.scene; W.litModel?.(hb); W.scene.add(hb); hb.position.copy(start);
    for (const n of ['piv_thrusterL', 'piv_thrusterR']) { const o = hb.getObjectByName(n); if (o && W.vfx) plumes.push(W.vfx.thruster(o, { style: 'flame', scale: 3 })); }
  }
  im.sfx('hb_rocket_ignite', { at: hb || im.root }); im.haptic('explosion_far');
  const dur = 3.2; let t = 0, done = false;
  return new Promise(res => {
    im.suitup = {
      update(dt) {
        t += dt; const k = Math.min(1, t / dur), e = 1 - Math.pow(1 - k, 3);
        if (hb) { hb.position.lerpVectors(start, end_, e); hb.lookAt(end_.x + back.x * -50, hb.position.y, end_.z + back.z * -50); for (const p of plumes) p.set(1.3 - k * 0.6); }
        if (k >= 1 && !done) {
          done = true;
          W.vfx?.cue('flash', im.root, { size: 3, color: 0xffd9a0 }); im.sfx('hb_land_heavy', { at: im.root }); im.sfx('hb_clamp_heavy', { at: im.root });
          im.kick({ shake: 0.6, hitstop: 80, fov: -4 }); im.haptic('land_hero');
          this.abort();
          if (!air) im.teleport(new T.Vector3(zone.x, zone.y + 1, zone.z), im.m.yaw, { grounded: true });
          im.buildBody(id, next).then(() => { if (!air) im.anim.oneShot('land_heavy', { fadeIn: 0.05, fadeOut: 0.4 }); end(im, id, from); res(); });
        }
      },
      abort() { for (const p of plumes) p.set(0); if (hb) hb.removeFromParent(); im.suitup = null; },
    };
  });
}
