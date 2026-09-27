// The world's ONE collider: everything that looks solid collides (Jurek, playtest 2: "lots of things have
// no collision"). Three parts behind the CityCollider API (game/collide.js, agreed with the gameplay agents):
//   1. city prisms  — every building part of layout.json (exact walls + normals; gameplay's CityCollider)
//   2. prop prisms  — every street/roof prop instance (lamps, signals, trees, cars, cabs, hydrants, benches,
//                     bins, subway entrances, water towers, antennas, fire escapes) as an oriented box, + piers
//   3. mesh soup    — the rendered triangles of: tile facades + roof details (cornices, parapets, bulkheads,
//                     HVAC), tile ground, world.glb (other shores, bridge, headland terrain), villa, apartment
// Debug: ?colliders=1 draws all three over the world (cyan city, amber props, magenta mesh, red = uncovered).
import * as THREE from 'three';
import { CityCollider } from '../game/collide.js';
import { MeshCollider, CompositeCollider } from './meshcollider.js';

// Per-kind voxel size (m) and filters. Trees: trunk only (the crown is foliage — not a wall, not a web anchor).
const PROP_SHAPE = {
  car: { cell: 0.3 }, taxi: { cell: 0.3 }, water_tower: { cell: 0.35 }, subway_entrance: { cell: 0.25 }, fire_escape: { cell: 0.25 },
  tree_street: { cell: 0.15, trunkOnly: true }, tree_park: { cell: 0.2, trunkOnly: true },
};

/** Tight box set for a kit: voxelise the surface, fill each vertical column between its lowest and highest
 * voxel (solid bodies, but empty space under an arm stays empty), merge equal columns into boxes.
 * → [[x0, y0, z0, x1, y1, z1], …] in kit-local space. */
export function kitShapes(geos, { cell = 0.12, trunkOnly = false } = {}) {
  const bb = new THREE.Box3(); for (const g of geos) { if (!g.boundingBox) g.computeBoundingBox(); bb.union(g.boundingBox); }
  const nx = Math.max(1, Math.ceil((bb.max.x - bb.min.x) / cell) + 1), ny = Math.max(1, Math.ceil((bb.max.y - bb.min.y) / cell) + 1), nz = Math.max(1, Math.ceil((bb.max.z - bb.min.z) / cell) + 1);
  const vox = new Uint8Array(nx * ny * nz), id = (x, y, z) => (y * nz + z) * nx + x;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  for (const g of geos) {
    const pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t); b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1); c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2);
      const k = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (cell * 0.5)));
      for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
        const u = i / k, w = j / k; p.copy(a).multiplyScalar(1 - u - w).addScaledVector(b, u).addScaledVector(c, w);
        vox[id(Math.floor((p.x - bb.min.x) / cell), Math.floor((p.y - bb.min.y) / cell), Math.floor((p.z - bb.min.z) / cell))] = 1;
      }
    }
  }
  // column runs (lowest..highest voxel)
  const run = new Int16Array(nx * nz * 2).fill(-1);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { let lo = -1, hi = -1; for (let y = 0; y < ny; y++) if (vox[id(x, y, z)]) { if (lo < 0) lo = y; hi = y; } run[(z * nx + x) * 2] = lo; run[(z * nx + x) * 2 + 1] = hi; }
  if (trunkOnly) {   // keep columns near the trunk axis: the columns occupied at the lowest 25 % of the height
    const low = Math.floor(ny * 0.25), keep = new Uint8Array(nx * nz);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) for (let y = 0; y <= low; y++) if (vox[id(x, y, z)]) keep[z * nx + x] = 1;
    for (let i = 0; i < nx * nz; i++) if (!keep[i]) run[i * 2] = run[i * 2 + 1] = -1; else { run[i * 2] = 0; run[i * 2 + 1] = Math.min(run[i * 2 + 1], Math.floor(ny * 0.45)); }
  }
  // greedy: strips along x with the same run, then merge strips along z
  const used = new Uint8Array(nx * nz), boxes = [];
  const same = (i, j) => run[i * 2] >= 0 && Math.abs(run[i * 2] - run[j * 2]) <= 1 && Math.abs(run[i * 2 + 1] - run[j * 2 + 1]) <= 1;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const i = z * nx + x; if (used[i] || run[i * 2] < 0) continue;
    let x1 = x; while (x1 + 1 < nx && !used[z * nx + x1 + 1] && same(z * nx + x1 + 1, i)) x1++;
    let z1 = z; for (;;) { const zz = z1 + 1; if (zz >= nz) break; let ok = true; for (let xx = x; xx <= x1; xx++) if (used[zz * nx + xx] || !same(zz * nx + xx, i)) { ok = false; break; } if (!ok) break; z1 = zz; }
    let lo = 1e9, hi = -1; for (let zz = z; zz <= z1; zz++) for (let xx = x; xx <= x1; xx++) { const k = zz * nx + xx; used[k] = 1; lo = Math.min(lo, run[k * 2]); hi = Math.max(hi, run[k * 2 + 1]); }
    boxes.push([bb.min.x + x * cell, bb.min.y + lo * cell, bb.min.z + z * cell, bb.min.x + (x1 + 1) * cell, bb.min.y + (hi + 1) * cell, bb.min.z + (z1 + 1) * cell]);
  }
  // merge pairs whose union wastes little space (a round pole = many columns → one box), fewest boxes first
  const vol = b => (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
  for (let changed = true; changed && boxes.length > 1;) {
    changed = false; let best = null, bw = 1.35;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j], U = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.min(A[2], B[2]), Math.max(A[3], B[3]), Math.max(A[4], B[4]), Math.max(A[5], B[5])];
      const w = vol(U) / Math.max(1e-6, vol(A) + vol(B)); if (w < bw) { bw = w; best = [i, j, U]; }
    }
    if (best) { boxes.splice(best[1], 1); boxes[best[0]] = best[2]; changed = true; }
  }
  return boxes;
}

const KIT_SOLID = kind => !/lamp_pool|billboard|awning/.test(kind || '');
const NOT_SOLID = /glass|water|lake|pool|glow|lamp_pool|holo|screen|curtain|cloth_(?:rug|white)|window_leaf|leaf|__/i;

export async function buildWorldCollider(world) {
  const t0 = performance.now();
  const layout = world.city.layout;
  const cityPrisms = CityCollider.fromLayout(layout);
  // ---- props: TIGHT shapes per kit (voxelised → column-filled → merged boxes), per instance; + piers
  // (playtest 3: one box per prop covered the empty space under a signal's arm → invisible walls, webs stuck in air)
  const parts = [], seen = new Map(), kitGeo = new Map();
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const pg of world.city.propGroups) {
    const im = pg.mesh; if (!im.isInstancedMesh || !KIT_SOLID(pg.kind)) continue;
    const variant = im.name.split('_').pop(), kk = pg.kind + '|' + variant;
    if (!kitGeo.has(kk)) kitGeo.set(kk, new Set());
    kitGeo.get(kk).add(im.geometry);
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m); v.setFromMatrixPosition(m);
      const key = pg.kind + '|' + v.x.toFixed(2) + '|' + v.z.toFixed(2);
      if (!seen.has(key)) seen.set(key, { m: m.clone(), kk, kind: pg.kind });
    }
    im.userData.collider = 'props';
  }
  const shapes = new Map();
  for (const [kk, geos] of kitGeo) shapes.set(kk, kitShapes([...geos], PROP_SHAPE[kk.split('|')[0]] || {}));
  world.propShapes = shapes; world.propInstances = [...seen.values()];
  for (const e of seen.values()) {
    for (const b of shapes.get(e.kk) || []) {
      const c = [[b[0], b[2]], [b[3], b[2]], [b[3], b[5]], [b[0], b[5]]];
      const poly = c.map(([x, z]) => { v.set(x, 0, z).applyMatrix4(e.m); return [v.x, v.z]; });
      const ya = v.set(0, b[1], 0).applyMatrix4(e.m).y, yb = v.set(0, b[4], 0).applyMatrix4(e.m).y;
      parts.push({ poly, y0: Math.min(ya, yb), y1: Math.max(ya, yb), kind: e.kind });
    }
  }
  for (const p of layout.piers || []) parts.push({ poly: p.poly, y0: -4, y1: p.deck_y ?? 0.6 });
  // CityCollider.fromLayout drops parts < 1.5 m tall; build with a fake height, then restore the real y range
  const propPrisms = CityCollider.fromLayout({ ground_y: -1e4, water_y: -1e4, island: null, buildings: [{ id: 'props', parts: parts.map(p => ({ ...p, y1: Math.max(p.y1, p.y0 + 2) })) }] });
  propPrisms.prisms.forEach((q, i) => { q.y1 = parts[i].y1; q.kind = parts[i].kind; });
  propPrisms.base = () => -1e4;
  // ---- rendered triangles
  const mesh = new MeshCollider();
  for (const t of world.city.tiles) mesh.addObject(t.root, 'tile', o => !NOT_SOLID.test(o.material?.name || ''), THREE);
  world.city.group.traverse(o => { if (o.name === 'world') mesh.addObject(o, 'world', x => !NOT_SOLID.test(x.material?.name || ''), THREE); });
  for (const b of world.bases || []) {
    const cols = b.getObjectByName('colliders');
    if (cols) {
      // classics agent's closed collider boxes (walls INCLUDING glass, floors, stair treads, rails, furniture) — ONLY these
      mesh.addObject(cols, 'base', o => /^col_/.test(o.name), THREE);
      cols.visible = false;
      b.traverse(o => { if (o.isMesh && !/^col_/.test(o.name)) o.userData.collider = 'base-col'; });   // covered by the boxes
    } else mesh.addObject(b, 'base', o => !NOT_SOLID.test(o.material?.name || '') && !NOT_SOLID.test(o.name), THREE);
  }
  mesh.build();
  const traffic = world.city.traffic ? new TrafficCollider(world.city) : null;
  cityPrisms.src = 'building'; propPrisms.src = 'props'; propPrisms.climbable = false; mesh.src = 'mesh';
  if (traffic) { traffic.src = 'traffic'; traffic.climbable = false; }
  const all = new CompositeCollider([cityPrisms, propPrisms, mesh, traffic]);
  all.stats = { cityPrisms: cityPrisms.prisms.length, propBoxes: parts.length, meshTris: mesh.count, trafficCars: traffic?.cars.length || 0, ms: Math.round(performance.now() - t0) };
  all.parts3 = { cityPrisms, propPrisms, mesh, traffic };
  console.info('[colliders]', all.stats);
  return all;
}

/** ?colliders=1 — draw the colliders. */
export function colliderDebug(world, col) {
  const g = new THREE.Group(); g.name = '__colliders';
  const prismLines = (P, color) => {
    const pts = [];
    for (const p of P.prisms) for (let i = 0; i < p.n; i++) {
      const j = (i + 1) % p.n, ax = p.xs[i], az = p.zs[i], bx = p.xs[j], bz = p.zs[j];
      pts.push(ax, p.y1, az, bx, p.y1, bz, ax, Math.max(p.y0, -3), az, bx, Math.max(p.y0, -3), bz, ax, Math.max(p.y0, -3), az, ax, p.y1, az);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: true, toneMapped: false }));
  };
  g.add(prismLines(col.parts3.cityPrisms, 0x33e0ff));
  g.add(prismLines(col.parts3.propPrisms, 0xffb020));
  const M = col.parts3.mesh, geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(M.T, 3));
  g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff40d0, wireframe: true, transparent: true, opacity: 0.18, toneMapped: false })));
  world.scene.add(g);
  // uncovered visible meshes → red
  for (const u of uncoveredMeshes(world)) u.material = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false });
  return g;
}

/** Visible, solid-looking meshes in the world that no collider knows about. Target: zero. */
export function uncoveredMeshes(world) {
  const out = [];
  const skip = o => { for (let p = o; p; p = p.parent) { if (p.userData?.collider || p.userData?.noCollide || /^__|^hero_|_rig$|tony|peter|civilian|enemy|actor|sky|water|thruster|trail|web/i.test(p.name || '')) return true; } return false; };
  world.scene.traverse(o => {
    if (!o.isMesh || !o.visible || o.isSkinnedMesh) return;   // characters/actors are not world solids
    if (NOT_SOLID.test(o.material?.name || '') || o.material?.transparent || o.material?.blending === THREE.AdditiveBlending) return;
    if (o.isInstancedMesh ? o.userData.collider : skip(o)) return;
    out.push(o);
  });
  return out;
}

/** Moving traffic as oriented boxes, positions computed on demand from the traffic simulation state. */
export class TrafficCollider {
  constructor(city) {
    this.city = city; this.cars = [];
    for (const set of city.traffic?.sets || []) {
      const bb = new THREE.Box3();
      for (const m of set.meshes) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox); m.userData.collider = 'traffic'; }
      for (const c of set.list) this.cars.push({ c, bb });
    }
    this._o = {};
  }
  _pose(e) {
    const c = e.c, L = c.lane, t = c.s / c.len, dx = L.b[0] - L.a[0], dz = L.b[1] - L.a[1];
    const x = L.a[0] + dx * t, z = L.a[1] + dz * t, p = this.city._park;
    if (p && x > p[0] && x < p[2] && z > p[1] && z < p[3]) return null;
    const yaw = Math.atan2(-dx, -dz); return { x, z, cs: Math.cos(yaw), sn: Math.sin(yaw) };
  }
  // local = rotate world offset by -yaw (three: rotation.y = yaw maps local (lx,lz) → world (lx cs + lz sn, -lx sn + lz cs))
  /** Once per frame: bucket the cars' poses into a 16 m grid (queries then only look at nearby cars). */
  update() {
    const G = this.grid || (this.grid = new Map()); G.clear();
    for (const e of this.cars) { const P = this._pose(e); if (!P) continue; e.P = P; const k = Math.floor(P.x / 16) * 4096 + Math.floor(P.z / 16); let a = G.get(k); if (!a) G.set(k, a = []); a.push(e); }
    this._frameOk = true;
  }
  _near(x, z, r, fn) {
    if (!this._frameOk) this.update();
    const R = r + 4;
    for (let gx = Math.floor((x - R) / 16); gx <= Math.floor((x + R) / 16); gx++) for (let gz = Math.floor((z - R) / 16); gz <= Math.floor((z + R) / 16); gz++) {
      const a = this.grid.get(gx * 4096 + gz); if (!a) continue;
      for (const e of a) { const P = e.P; if (Math.abs(P.x - x) > R || Math.abs(P.z - z) > R) continue; fn(e, P); }
    }
  }
  base() { return -1e4; }
  inside(x, y, z) { let hit = null; this._near(x, z, 0, (e, P) => { const lx = (x - P.x) * P.cs - (z - P.z) * P.sn, lz = (x - P.x) * P.sn + (z - P.z) * P.cs, b = e.bb; if (lx > b.min.x && lx < b.max.x && lz > b.min.z && lz < b.max.z && y > b.min.y && y < b.max.y) hit = e; }); return hit; }
  groundAt(x, z, y = Infinity, step = 0.6) { let g = -1e4; this._near(x, z, 0, (e, P) => { const lx = (x - P.x) * P.cs - (z - P.z) * P.sn, lz = (x - P.x) * P.sn + (z - P.z) * P.cs, b = e.bb; if (lx > b.min.x && lx < b.max.x && lz > b.min.z && lz < b.max.z && b.max.y <= y + step && b.max.y > g) g = b.max.y; }); return g; }
  sphere(c, r, out = {}) {
    let n = 0, nx = 0, ny = 0, nz = 0, depth = 0;
    this._near(c.x, c.z, r, (e, P) => {
      const b = e.bb, ox = c.x - P.x, oz = c.z - P.z, lx = ox * P.cs - oz * P.sn, lz = ox * P.sn + oz * P.cs;
      const qx = Math.max(b.min.x, Math.min(b.max.x, lx)), qy = Math.max(b.min.y, Math.min(b.max.y, c.y)), qz = Math.max(b.min.z, Math.min(b.max.z, lz));
      let dx = lx - qx, dy = c.y - qy, dz = lz - qz, d = Math.hypot(dx, dy, dz);
      if (d >= r) return;
      if (d < 1e-5) { dy = 1; dx = dz = 0; d = 0; } else { dx /= d; dy /= d; dz /= d; }
      const k = r - d, wx = dx * P.cs + dz * P.sn, wz = -dx * P.sn + dz * P.cs;
      c.x += wx * k; c.y += dy * k; c.z += wz * k; nx += wx; ny += dy; nz += wz; n++; depth = Math.max(depth, k);
    });
    if (!n) return null; const m = Math.hypot(nx, ny, nz) || 1; out.nx = nx / m; out.ny = ny / m; out.nz = nz / m; out.n = n; out.depth = depth; return out;
  }
  raycast(o, d, max = 500, out = {}) {
    let best = max, hit = null;
    const len = Math.min(max, 400), mx = o.x + d.x * len / 2, mz = o.z + d.z * len / 2;
    this._near(mx, mz, len / 2, (e, P) => {
      const b = e.bb, ox = o.x - P.x, oz = o.z - P.z;
      const lo = [ox * P.cs - oz * P.sn, o.y, ox * P.sn + oz * P.cs], ld = [d.x * P.cs - d.z * P.sn, d.y, d.x * P.sn + d.z * P.cs];
      const mn = [b.min.x, b.min.y, b.min.z], mxv = [b.max.x, b.max.y, b.max.z];
      let t0 = 0, t1 = best, ax = -1, sg = 0;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(ld[i]) < 1e-9) { if (lo[i] < mn[i] || lo[i] > mxv[i]) return; continue; }
        let ta = (mn[i] - lo[i]) / ld[i], tb = (mxv[i] - lo[i]) / ld[i], s = -1; if (ta > tb) { [ta, tb] = [tb, ta]; s = 1; }
        if (ta > t0) { t0 = ta; ax = i; sg = s; } if (tb < t1) t1 = tb; if (t0 > t1) return;
      }
      if (t0 > 1e-4 && t0 < best) {
        best = t0; hit = out; const ln = [0, 0, 0]; if (ax >= 0) ln[ax] = sg;
        out.t = t0; out.x = o.x + d.x * t0; out.y = o.y + d.y * t0; out.z = o.z + d.z * t0;
        out.nx = ln[0] * P.cs + ln[2] * P.sn; out.ny = ln[1]; out.nz = -ln[0] * P.sn + ln[2] * P.cs; out.prism = null;
      }
    });
    return hit;
  }
  wallNear() { return null; }
}
