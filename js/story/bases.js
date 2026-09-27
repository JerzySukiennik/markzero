// Base helpers for story: find the placed base GLBs, markers in world space, and the apartment's
// openable WIN-A windows (next/assets/bases/apartment/window_a.glb at every win_* marker).
import * as THREE from 'three';
import { ClipPlayer } from '../gfx/player.js';

export const base = (world, name) => world.scene.getObjectByName('base_' + name);
/** marker position in world space (Vector3) + its world yaw */
export function marker(world, baseName, name) {
  const b = base(world, baseName), n = b?.getObjectByName(name);
  if (!n) return null;
  n.updateWorldMatrix(true, false);
  const p = n.getWorldPosition(new THREE.Vector3());
  const q = n.getWorldQuaternion(new THREE.Quaternion());
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return { p, q, yaw: Math.atan2(-f.x, -f.z), node: n };
}
/** local point of a base → world */
export function toWorld(world, baseName, x, y, z) {
  const b = base(world, baseName); b.updateWorldMatrix(true, false);
  return b.localToWorld(new THREE.Vector3(x, y, z));
}
export function baseYaw(world, baseName) { return base(world, baseName)?.rotation.y || 0; }

/** WIN-A instances at the apartment's win_* markers (once; the core may place them later itself). */
export async function apartmentWindows(MZ, world) {
  const apt = base(world, 'apartment'); if (!apt) return {};
  if (apt.userData.windows) return apt.userData.windows;
  const out = {};
  const g0 = await MZ.assets.load('assets/bases/apartment/window_a.glb');
  const cues = { sfx: { play: (id, o = {}) => MZ.audio.play(id, o) } };
  const marks = []; apt.traverse(o => { if (/^win_\d+$/.test(o.name)) marks.push(o); });
  for (const m of marks) {
    if (m.getObjectByName('window_a')) continue;             // someone already placed it
    const g = m === marks[0] ? g0 : await MZ.assets.load('assets/bases/apartment/window_a.glb');
    world.litModel?.(g.scene);
    g.scene.traverse(o => { if (o.isMesh) for (const mt of [].concat(o.material)) if (/glass/i.test(mt.name)) { mt.transparent = true; mt.opacity = 0.16; mt.depthWrite = false; o.castShadow = false; } });
    m.add(g.scene);
    out[m.name] = { root: g.scene, player: new ClipPlayer(g.scene, g.animations, g.clips, cues) };
  }
  apt.userData.windows = out;
  return out;
}

/** Borrow one of the world's fixed pool lights as a steady room light (no light is ever added:
 * that would recompile every material). release() lets it fade back into the pool. */
export function holdLight(world, at, intensity, color = 0xffd8a8, range = 9) {
  const pool = world.pool; if (!pool) return { release() { } };
  pool.flash(at, intensity, 1e6, color, range);
  const l = pool.lights.find(x => x.userData.life === 1e6 && x.position.equals(at));
  return { light: l, release(fade = 0.8) { if (l) l.userData = { t: 0, life: fade, i0: l.intensity }; } };
}
