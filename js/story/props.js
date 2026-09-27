// Mission props at real scale, with colliders: ISO 40 ft shipping containers (12.19 × 2.59 × 2.44 m), stacked,
// crates (throwable by Spider-Man's web yank), heavy generators (web heavy throw). All boxes register as one
// collider part (src 'story', climbable) in world.collide, so heroes land on / collide with / web them, the
// enemies' nav-grid treats stacks as walls or high ground, and line of sight respects cover.
import * as THREE from 'three';
import { CityCollider } from '../game/collide.js';

export const CONTAINER = { L: 12.19, H: 2.59, W: 2.44 };
const COLORS = { red: '#7a2320', blue: '#1f3f6e', green: '#2d5a3a', orange: '#b8561c', grey: '#5c6166', stark: '#6e1f1c' };
const _tex = new Map();
function containerTex(color, label) {
  const key = color + label; if (_tex.has(key)) return _tex.get(key);
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = COLORS[color] || color; g.fillRect(0, 0, 1024, 256);
  for (let x = 0; x < 1024; x += 16) { g.fillStyle = (x / 16) % 2 ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.07)'; g.fillRect(x, 0, 8, 256); }
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, 1024, 10); g.fillRect(0, 246, 1024, 10);
  g.fillStyle = 'rgba(240,236,228,.85)';
  if (label) { g.font = 'bold 64px sans-serif'; g.fillText(label, 60, 150); g.font = '24px monospace'; g.fillText('SI-ARC 0937 · MAX GROSS 30480 KG', 64, 190); }
  else { g.font = 'bold 40px monospace'; g.fillText('MZCU ' + String(100000 + Math.floor(Math.random() * 899999)), 60, 70); }
  // rust streaks
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(90,45,20,${Math.random() * 0.25})`; g.fillRect(Math.random() * 1024, 0, 2 + Math.random() * 4, 40 + Math.random() * 200); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; _tex.set(key, t); return t;
}
const endMat = new Map();
function containerMesh(color, label) {
  const side = new THREE.MeshStandardMaterial({ map: containerTex(color, label), roughness: 0.62, metalness: 0.45 });
  if (!endMat.has(color)) endMat.set(color, new THREE.MeshStandardMaterial({ color: COLORS[color] || color, roughness: 0.6, metalness: 0.45 }));
  const e = endMat.get(color), { L, H, W } = CONTAINER;
  const m = new THREE.Mesh(new THREE.BoxGeometry(L, H, W).translate(0, H / 2, 0), [e, e, e, e, side, side]);
  m.castShadow = m.receiveShadow = true; m.name = 'story_container';
  return m;
}

/** collider boxes of a prop placed at height y: [{poly:[[x,z]×4], y0, y1}] (pure — also used by tests/story) */
export function propBoxes(p, y) {
  const rot = p.rot || 0, c = Math.cos(rot), s = Math.sin(rot);
  const box = (hx, hz, y0, y1) => ({ poly: [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([a, b]) => [p.x + a * c + b * s, p.z - a * s + b * c]), y0, y1 });
  if (p.kind === 'stack' || p.kind === 'container') return [box(CONTAINER.L / 2, CONTAINER.W / 2, y, y + (p.levels || 1) * CONTAINER.H)];
  return [];            // crates / generators are thrown: not part of the static collider
}

/** Everything a mission places: props:[{kind:'stack'|'container'|'crate'|'heavy', x, z, y?, rot, levels, color, label}] */
export class PropSet {
  constructor(world) { this.world = world; this.group = new THREE.Group(); this.group.name = 'story_props'; this.boxes = []; this.items = []; world.scene.add(this.group); }
  /** base height: the surface under the footprint centre (piers, roofs, streets) */
  _ground(x, z, yHint) { const c = this.world.collide; return c ? c.groundAt(x, z, (yHint ?? 300)) : 0; }
  add(p) {
    const y = p.y ?? this._ground(p.x, p.z, p.probe);
    const rot = p.rot || 0, o = new THREE.Group(); o.position.set(p.x, y, p.z); o.rotation.y = rot; this.group.add(o);
    this.boxes.push(...propBoxes(p, y));
    if (p.kind === 'stack' || p.kind === 'container') {
      const lv = p.levels || 1, { L, H, W } = CONTAINER;
      for (let k = 0; k < lv; k++) { const m = containerMesh(p.colors?.[k] || p.color || ['red', 'blue', 'green', 'orange', 'grey'][(Math.abs(Math.round(p.x + p.z)) + k) % 5], k === 0 ? p.label : null); m.position.y = k * H; m.rotation.y = (k % 2) * 0.02; o.add(m); }
      this.items.push({ kind: 'stack', o, top: y + lv * H, x: p.x, z: p.z });
    } else if (p.kind === 'crate' || p.kind === 'heavy') {
      const big = p.kind === 'heavy', s = big ? 1.7 : 1.1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * (big ? 0.9 : 1), s).translate(0, s * (big ? 0.45 : 0.5), 0),
        new THREE.MeshStandardMaterial({ color: big ? 0x3a3f44 : 0x6b4d2c, roughness: 0.55, metalness: big ? 0.7 : 0.1, emissive: big ? 0xffa030 : 0x000000, emissiveIntensity: big ? 0.25 : 0 }));
      m.castShadow = m.receiveShadow = true; m.name = big ? 'story_heavy' : 'story_crate'; o.add(m);
      this.items.push({ kind: p.kind, o, mesh: m, x: p.x, z: p.z, y, size: s, thrown: false });
    }
    return o;
  }
  /** register the boxes with the world's collider (one CityCollider part, src 'story') */
  register() {
    const col = this.world.collide; if (!col || !this.boxes.length) return;
    const parts = this.boxes.map(b => ({ ...b, y1: Math.max(b.y1, b.y0 + 2) }));
    const cc = CityCollider.fromLayout({ ground_y: -1e4, water_y: -1e4, island: null, buildings: [{ id: 'story', parts }] });
    cc.prisms.forEach((q, i) => { q.y1 = this.boxes[i].y1; });
    cc.base = () => -1e4; cc.src = 'story'; cc.climbable = true;
    this.part = cc;
    if (Array.isArray(col.parts)) col.parts.push(cc);
    this.world.litModel?.(this.group);
  }
  dispose() {
    const col = this.world.collide;
    if (this.part && Array.isArray(col?.parts)) { const i = col.parts.indexOf(this.part); if (i >= 0) col.parts.splice(i, 1); }
    this.group.removeFromParent();
    this.group.traverse(o => { o.geometry?.dispose?.(); });
  }
}
