// Triangle-soup collider over rendered geometry (roofs + roof props from the tile detail meshes, the
// world.glb shores/bridge/headland terrain, the villa and the apartment). Same query API as the gameplay
// agent's CityCollider (game/collide.js) so both can sit behind one CompositeCollider:
//   groundAt(x, z, y, step) · raycast(o, d, max, out) · sphere(c, r, out) · wallNear(p, r, out) · inside()
// A uniform XZ grid (CELL m) holds triangle indices (counting-sort packed, no per-cell arrays); queries
// stamp triangles to test each once and allocate nothing.
const CELL = 8;
const EPS = 1e-7;

export class MeshCollider {
  constructor() { this.chunks = []; this.tags = []; this.count = 0; this.built = false; }

  /** Add every mesh under `root` (world transforms; call root.updateMatrixWorld first). filter(mesh) → bool. */
  addObject(root, tag, filter = null, THREE) {
    const v = new THREE.Vector3();
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
      if (filter && !filter(o)) return;
      const g = o.geometry, pos = g.attributes.position; if (!pos) return;
      const idx = g.index, n = idx ? idx.count : pos.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; }
      this.chunks.push(arr); this.tags.push({ tag, name: o.name, tris: n / 3, mesh: o });
      o.userData.collider = tag;
      this.count += n / 3;
    });
    this.built = false;
  }

  build() {
    const T = this.T = new Float32Array(this.count * 9);
    let o = 0; for (const c of this.chunks) { T.set(c, o); o += c.length; }
    this.chunks = [];
    const n = this.count;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n * 9; i += 3) { const x = T[i], z = T[i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    this.x0 = Math.floor(x0 / CELL) * CELL; this.z0 = Math.floor(z0 / CELL) * CELL;
    this.cols = Math.ceil((x1 - this.x0) / CELL) + 1; this.rows = Math.ceil((z1 - this.z0) / CELL) + 1;
    const cells = this.cols * this.rows, start = new Uint32Array(cells + 1);
    const each = (fn) => {
      for (let t = 0; t < n; t++) {
        const b = t * 9;
        const minx = Math.min(T[b], T[b + 3], T[b + 6]), maxx = Math.max(T[b], T[b + 3], T[b + 6]);
        const minz = Math.min(T[b + 2], T[b + 5], T[b + 8]), maxz = Math.max(T[b + 2], T[b + 5], T[b + 8]);
        for (let cz = this._cz(minz); cz <= this._cz(maxz); cz++) for (let cx = this._cx(minx); cx <= this._cx(maxx); cx++) fn(cz * this.cols + cx, t);
      }
    };
    each(k => start[k + 1]++);
    for (let k = 0; k < cells; k++) start[k + 1] += start[k];
    const fill = start.slice(0, cells), list = new Uint32Array(start[cells]);
    each((k, t) => { list[fill[k]++] = t; });
    this.start = start; this.list = list;
    // per-triangle Y range (fast vertical rejection)
    this.ymin = new Float32Array(n); this.ymax = new Float32Array(n);
    this.bx = new Float32Array(n * 4);    // minx, maxx, minz, maxz per triangle (cheap rejection before closest-point math)
    for (let t = 0; t < n; t++) {
      const b = t * 9; this.ymin[t] = Math.min(T[b + 1], T[b + 4], T[b + 7]); this.ymax[t] = Math.max(T[b + 1], T[b + 4], T[b + 7]);
      this.bx[t * 4] = Math.min(T[b], T[b + 3], T[b + 6]); this.bx[t * 4 + 1] = Math.max(T[b], T[b + 3], T[b + 6]);
      this.bx[t * 4 + 2] = Math.min(T[b + 2], T[b + 5], T[b + 8]); this.bx[t * 4 + 3] = Math.max(T[b + 2], T[b + 5], T[b + 8]);
    }
    this._stamp = new Uint32Array(n); this._gen = 1;
    this.built = true;
    return this;
  }
  _cx(x) { return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.x0) / CELL))); }
  _cz(z) { return Math.max(0, Math.min(this.rows - 1, Math.floor((z - this.z0) / CELL))); }
  _cellOk(x, z) { const cx = Math.floor((x - this.x0) / CELL), cz = Math.floor((z - this.z0) / CELL); return cx >= 0 && cz >= 0 && cx < this.cols && cz < this.rows ? cz * this.cols + cx : -1; }

  /** Möller–Trumbore; returns t or -1, writes the geometric normal (facing the ray origin) to _n. */
  _rayTri(t, ox, oy, oz, dx, dy, dz, tmax) {
    const T = this.T, b = t * 9;
    const ax = T[b], ay = T[b + 1], az = T[b + 2];
    const e1x = T[b + 3] - ax, e1y = T[b + 4] - ay, e1z = T[b + 5] - az, e2x = T[b + 6] - ax, e2y = T[b + 7] - ay, e2z = T[b + 8] - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -EPS && det < EPS) return -1;
    const inv = 1 / det, sx = ox - ax, sy = oy - ay, sz = oz - az;
    const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) return -1;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const w = (dx * qx + dy * qy + dz * qz) * inv; if (w < 0 || u + w > 1) return -1;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv; if (tt <= 1e-4 || tt > tmax) return -1;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const m = Math.hypot(nx, ny, nz) || 1; nx /= m; ny /= m; nz /= m;
    if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
    _n.x = nx; _n.y = ny; _n.z = nz;
    return tt;
  }

  raycast(o, d, max = 500, out = {}) {
    if (!this.built) return null;
    const gen = ++this._gen; let best = max, hit = null;
    const len2 = Math.hypot(d.x, d.z);
    const stepT = len2 > 1e-6 ? (CELL * 0.5) / len2 : best + 1;
    const steps = Math.ceil(best / stepT) + 1;
    let lastK = -2;
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(best, s * stepT); if (s * stepT > best + stepT) break;
      const k = this._cellOk(o.x + d.x * t, o.z + d.z * t); if (k < 0 || k === lastK) continue; lastK = k;
      for (let j = this.start[k], e = this.start[k + 1]; j < e; j++) {
        const tri = this.list[j]; if (this._stamp[tri] === gen) continue; this._stamp[tri] = gen;
        const th = this._rayTri(tri, o.x, o.y, o.z, d.x, d.y, d.z, best);
        if (th > 0 && th < best) { best = th; hit = out; out.t = th; out.x = o.x + d.x * th; out.y = o.y + d.y * th; out.z = o.z + d.z * th; out.nx = _n.x; out.ny = _n.y; out.nz = _n.z; out.tri = tri; out.prism = null; }
      }
    }
    return hit;
  }

  /** Highest surface at (x,z) at or below y + step (upward-facing), or -Infinity. */
  groundAt(x, z, y = Infinity, step = 0.6) {
    if (!this.built) return -Infinity;
    const k = this._cellOk(x, z); if (k < 0) return -Infinity;
    const top = y === Infinity ? 1e5 : y + step;
    let g = -Infinity;
    for (let j = this.start[k], e = this.start[k + 1]; j < e; j++) {
      const tri = this.list[j]; if (this.ymin[tri] > top || this.ymax[tri] <= g) continue;
      const q = tri * 4, B = this.bx; if (B[q] > x || B[q + 1] < x || B[q + 2] > z || B[q + 3] < z) continue;
      const th = this._rayTri(tri, x, top, z, 0, -1, 0, top + 1e4);
      if (th > 0 && _n.y > 0.2) { const hy = top - th; if (hy > g) g = hy; }
    }
    return g;
  }
  inside() { return null; }

  /** Closest point on triangle to p → writes _cp, returns squared distance. */
  _closest(tri, px, py, pz) {
    const T = this.T, b = tri * 9;
    const ax = T[b], ay = T[b + 1], az = T[b + 2], bx = T[b + 3], by = T[b + 4], bz = T[b + 5], cx = T[b + 6], cy = T[b + 7], cz = T[b + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let rx, ry, rz;
    if (d1 <= 0 && d2 <= 0) { rx = ax; ry = ay; rz = az; }
    else {
      const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) { rx = bx; ry = by; rz = bz; }
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); rx = ax + abx * v; ry = ay + aby * v; rz = az + abz * v; }
        else {
          const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) { rx = cx; ry = cy; rz = cz; }
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); rx = ax + acx * w; ry = ay + acy * w; rz = az + acz * w; }
            else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); rx = bx + (cx - bx) * w; ry = by + (cy - by) * w; rz = bz + (cz - bz) * w; }
              else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; rx = ax + abx * v + acx * w; ry = ay + aby * v + acy * w; rz = az + abz * v + acz * w; }
            }
          }
        }
      }
    }
    _cp.x = rx; _cp.y = ry; _cp.z = rz;
    const dx = px - rx, dy = py - ry, dz = pz - rz; return dx * dx + dy * dy + dz * dz;
  }
  _forNear(c, r, fn) {
    const gen = ++this._gen;
    for (let cz = this._cz(c.z - r); cz <= this._cz(c.z + r); cz++) for (let cx = this._cx(c.x - r); cx <= this._cx(c.x + r); cx++) {
      const k = cz * this.cols + cx;
      for (let j = this.start[k], e = this.start[k + 1]; j < e; j++) {
        const tri = this.list[j]; if (this._stamp[tri] === gen) continue; this._stamp[tri] = gen;
        if (this.ymin[tri] > c.y + r || this.ymax[tri] < c.y - r) continue;
        const q = tri * 4, B = this.bx;
        if (B[q] > c.x + r || B[q + 1] < c.x - r || B[q + 2] > c.z + r || B[q + 3] < c.z - r) continue;
        fn(tri);
      }
    }
  }
  /** Push a sphere out of the triangles (3 iterations). Mutates c; returns {nx, ny, nz, n, depth} or null. */
  sphere(c, r, out = {}) {
    if (!this.built) return null;
    let n = 0, nx = 0, ny = 0, nz = 0, depth = 0;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      this._forNear(c, r, tri => {
        const d2 = this._closest(tri, c.x, c.y, c.z); if (d2 >= r * r) return;
        const d = Math.sqrt(d2);
        let px, py, pz;
        if (d > 1e-5) { px = (c.x - _cp.x) / d; py = (c.y - _cp.y) / d; pz = (c.z - _cp.z) / d; }
        else { const T = this.T, b = tri * 9; px = (T[b + 4] - T[b + 1]) * (T[b + 8] - T[b + 2]) - (T[b + 5] - T[b + 2]) * (T[b + 7] - T[b + 1]); py = 1; pz = 0; const m = Math.hypot(px, py, pz); px /= m; py /= m; pz /= m; }
        const k = r - d; c.x += px * k; c.y += py * k; c.z += pz * k;
        nx += px; ny += py; nz += pz; n++; if (k > depth) depth = k; moved = true;
      });
      if (!moved) break;
    }
    if (!n) return null;
    const m = Math.hypot(nx, ny, nz) || 1; out.nx = nx / m; out.ny = ny / m; out.nz = nz / m; out.n = n; out.depth = depth; return out;
  }
  /** Closest steep (wall-like) triangle within r of p → {x, y, z, nx, nz, d, top} or null. */
  wallNear(p, r, out = {}) {
    if (!this.built) return null;
    let best = r * r, got = false;
    this._forNear(p, r, tri => {
      const T = this.T, b = tri * 9;
      const e1x = T[b + 3] - T[b], e1y = T[b + 4] - T[b + 1], e1z = T[b + 5] - T[b + 2], e2x = T[b + 6] - T[b], e2y = T[b + 7] - T[b + 1], e2z = T[b + 8] - T[b + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; const m = Math.hypot(nx, ny, nz) || 1; nx /= m; ny /= m; nz /= m;
      if (Math.abs(ny) > 0.5) return;
      const d2 = this._closest(tri, p.x, p.y, p.z); if (d2 >= best) return;
      best = d2; got = true;
      const s = (p.x - _cp.x) * nx + (p.z - _cp.z) * nz >= 0 ? 1 : -1, hm = Math.hypot(nx, nz) || 1;
      out.x = _cp.x; out.y = _cp.y; out.z = _cp.z; out.nx = nx / hm * s; out.nz = nz / hm * s; out.d = Math.sqrt(d2); out.top = this.ymax[tri]; out.prism = null;
    });
    return got ? out : null;
  }
}
const _n = { x: 0, y: 0, z: 0 }, _cp = { x: 0, y: 0, z: 0 };

/** Several colliders behind one CityCollider-shaped API. The first one is the "city" (owns base()). */
export class CompositeCollider {
  constructor(parts) { this.parts = parts.filter(Boolean); this.city = this.parts[0]; this._h = {}; this._w = {}; this._s = {}; }
  base(x, z) { return this.city.base ? this.city.base(x, z) : 0; }
  /** Official add/remove of a collider part (story containers, crates…): any object with the CityCollider API. */
  add(part, { src = 'story', climbable = true } = {}) { if (!this.parts.includes(part)) { part.src ??= src; part.climbable ??= climbable; this.parts.push(part); } return part; }
  remove(part) { const i = this.parts.indexOf(part); if (i > 0) this.parts.splice(i, 1); }
  groundAt(x, z, y = Infinity, step = 0.6) { let g = -Infinity; for (const p of this.parts) { const v = p.groundAt(x, z, y, step); if (v > g) g = v; } return g; }
  inside(x, y, z) { for (const p of this.parts) { const r = p.inside?.(x, y, z); if (r) return r; } return null; }
  /** Hits carry `src`: 'building' | 'props' | 'mesh' | 'traffic' (and `solidSurface` false for props/traffic),
   * so swing anchors / wall crawl can ask for buildings only. opts.only = ['building','mesh'] limits the parts. */
  raycast(o, d, max = 500, out = {}, opts = null) {
    let best = max, hit = null;
    for (const p of this.parts) {
      if (opts?.only && !opts.only.includes(p.src)) continue;
      const h = p.raycast(o, d, best, this._h); if (h && h.t < best) { best = h.t; hit = Object.assign(out, h); out.src = p.src; out.climbable = p.climbable !== false; }
    }
    return hit;
  }
  sphere(c, r, out = {}) {
    let n = 0, nx = 0, ny = 0, nz = 0, depth = 0;
    for (const p of this.parts) { const h = p.sphere(c, r, this._s); if (h) { nx += h.nx * h.n; ny += h.ny * h.n; nz += h.nz * h.n; n += h.n; depth = Math.max(depth, h.depth); } }
    if (!n) return null;
    const m = Math.hypot(nx, ny, nz) || 1; out.nx = nx / m; out.ny = ny / m; out.nz = nz / m; out.n = n; out.depth = depth; return out;
  }
  /** Climbable walls only (buildings, rendered roofs/bases — never props, trees, cars or traffic). */
  wallNear(p, r, out = {}) {
    let best = r, got = null;
    for (const q of this.parts) { if (q.climbable === false) continue; const h = q.wallNear(p, best, this._w); if (h && h.d < best) { best = h.d; got = Object.assign(out, h); out.src = q.src; } }
    return got;
  }
}
