// Base start after the intro has been seen once: a short establishing shot of the base, then the
// suited hero leaves it — Spider-Man leaps out of the apartment window, Iron Man stands on the villa
// landing pad. Skippable in effect (control is given back after ~2 s).
import * as THREE from 'three';
import { apartmentWindows, marker, toWorld } from './bases.js';
import { teleport } from './control.js';

export async function baseStart(S) {
  const W = S.world, hero = S.hero, MZ = S.MZ;
  S.phaseName = 'base_start';
  const lerpV = (a, b, t) => new THREE.Vector3().lerpVectors(a, b, Math.min(1, t));
  if (S.session.heroId === 'spiderman') {
    const L = (x, y, z) => toWorld(W, 'apartment', x, y, z);
    const wins = await apartmentWindows(MZ, W).catch(() => ({}));
    const w = wins.win_06; if (w) { w.player.play('window_open', { fade: 0, loop: false }); S.anims.add(w.player); }
    teleport(hero, L(18.86, 1.6, -1.2), 0, new THREE.Vector3(0, 4, -8));
    S.gate.script({ down: [], axes: { lx: 0, ly: -1, rx: 0, ry: 0 } });
    S.dir.cut({ pos: t => lerpV(L(14.5, 0.5, -7), L(15.5, -1.5, -9), t / 1.6), look: () => (hero.pos || hero.root.position), fov: 55 });
    S.ui.cover(false);
    await S.wait(0.3); S.gate.set({ down: ['swing'] });
    await S.wait(1.3);
    S.gate.set({ down: [] }); S.gate.mode = 'live';
    S.dir.release(0.9);
  } else {
    const pad = marker(W, 'villa', 'spawn_ironman_pad');
    const p = pad ? pad.p.clone().setY(pad.p.y + 1.05) : new THREE.Vector3(1454, 32, 1698);
    const yaw = (W.scene.getObjectByName('base_villa')?.rotation.y || 0);
    teleport(hero, p, yaw);
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const c0 = p.clone().addScaledVector(f, 7).addScaledVector(r, -3).setY(p.y + 1.2), c1 = p.clone().addScaledVector(f, 5).addScaledVector(r, -2).setY(p.y + 0.7);
    S.dir.cut({ pos: t => lerpV(c0, c1, t / 2), look: p.clone().setY(p.y + 0.4), fov: 45 });
    S.ui.cover(false);
    await S.wait(1.6);
    S.dir.release(1.0);
  }
  S.hud(true);
  S.phaseName = null;
}
