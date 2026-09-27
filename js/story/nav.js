// Nav-grid for mission enemies, built from the world collider around a mission area (playtest 4: enemies
// spawned inside the ground and walked on water). A cell is walkable when its surface (collider groundAt
// from above) is above the water, has head room, and no neighbour drops away by more than a step (so nobody
// stands on a roof edge). Cells connect when their heights differ by ≤ STEP. Everything enemies do on foot
// goes through this: spawn snapping, chasing (BFS flow field), holding position, line of sight for cover.
//   const nav = new NavGrid(col, { cx, cz, half: 55 }).build();
//   nav.snap(p) → {x, y, z, i} | null   nav.step(pos, target, speed, dt) → moved?   nav.los(a, b)
export const WATER_Y = -1.0;                 // anything at or below is water (layout water_y = −2.2)
const STEP = 0.7, HEAD = 1.6;

export class NavGrid {
  constructor(col, { cx = 0, cz = 0, half = 55, cell = 1.25, probe = 300 } = {}) {
    Object.assign(this, { col, cx, cz, half, cell, probe });
    this.n = Math.ceil((half * 2) / cell);
    this.x0 = cx - half; this.z0 = cz - half;
    this.h = new Float32Array(this.n * this.n); this.ok = new Uint8Array(this.n * this.n);
    this.comp = new Int32Array(this.n * this.n).fill(-1);
    this._fields = new Map();
  }
  idx(x, z) { const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell); return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i; }
  cx_(i) { return this.x0 + ((i % this.n) + 0.5) * this.cell; }
  cz_(i) { return this.z0 + (Math.floor(i / this.n) + 0.5) * this.cell; }
  build() {
    const { n, col } = this, raw = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = this.x0 + (i + 0.5) * this.cell, z = this.z0 + (j + 0.5) * this.cell;
      const g = col.groundAt(x, z, this.probe);
      raw[k] = g;
      const water = !(g > WATER_Y);
      const blocked = !water && (col.inside?.(x, g + 0.9, z) || col.inside?.(x, g + HEAD, z));
      this.h[k] = g; this.ok[k] = !water && !blocked ? 1 : 0;
    }
    // no roof-edge cells: every 8-neighbour must be walkable at a step's height
    const keep = new Uint8Array(this.ok);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i; if (!this.ok[k]) continue;
      for (let dj = -1; dj <= 1 && keep[k]; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const q = b * n + a; if (!this.ok[q] || Math.abs(raw[q] - raw[k]) > STEP) { keep[k] = 0; break; }
      }
    }
    this.ok = keep;
    // connected components
    let c = 0; const st = [];
    for (let k = 0; k < n * n; k++) {
      if (!this.ok[k] || this.comp[k] >= 0) continue;
      this.comp[k] = c; st.push(k);
      while (st.length) { const q = st.pop(); for (const r of this.nb(q)) if (this.comp[r] < 0) { this.comp[r] = c; st.push(r); } }
      c++;
    }
    this.comps = c;
    return this;
  }
  /** walkable 8-neighbours of cell k connected by a step */
  *nb(k) {
    const n = this.n, i = k % n, j = Math.floor(k / n);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const q = b * n + a; if (this.ok[q] && Math.abs(this.h[q] - this.h[k]) <= STEP) yield q;
    }
  }
  walkable(x, z) { const k = this.idx(x, z); return k >= 0 && !!this.ok[k]; }
  heightAt(x, z) { const k = this.idx(x, z); return k >= 0 ? this.h[k] : null; }
  /** nearest walkable cell to p (optionally only near a height, e.g. a roof: prefer |h − y| small) */
  snap(p, { r = 14, nearY = null } = {}) {
    let best = null, bd = Infinity;
    const R = Math.ceil(r / this.cell), k0 = this.idx(p.x, p.z); if (k0 < 0) return null;
    const i0 = k0 % this.n, j0 = Math.floor(k0 / this.n);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const a = i0 + di, b = j0 + dj; if (a < 0 || b < 0 || a >= this.n || b >= this.n) continue;
      const q = b * this.n + a; if (!this.ok[q]) continue;
      const d = di * di + dj * dj + (nearY != null ? ((this.h[q] - nearY) / this.cell) ** 2 * 4 : 0);
      if (d < bd) { bd = d; best = q; }
    }
    return best == null ? null : { i: best, x: this.cx_(best), y: this.h[best], z: this.cz_(best) };
  }
  /** BFS distance field to the cells nearest `target` inside component `c` (cached per target cell) */
  field(c, tx, tz) {
    let t = this.idx(tx, tz);
    if (t < 0 || !this.ok[t] || this.comp[t] !== c) {      // unreachable (flying / other roof): nearest cell of c
      let bd = Infinity; t = -1;
      for (let k = 0; k < this.ok.length; k++) if (this.comp[k] === c) { const d = (this.cx_(k) - tx) ** 2 + (this.cz_(k) - tz) ** 2; if (d < bd) { bd = d; t = k; } }
      if (t < 0) return null;
    }
    const key = c + ':' + t; if (this._fields.has(key)) return this._fields.get(key);
    const d = new Float32Array(this.ok.length).fill(Infinity); d[t] = 0; const q = [t];
    for (let h = 0; h < q.length; h++) { const k = q[h]; for (const r of this.nb(k)) { const nd = d[k] + 1; if (nd < d[r]) { d[r] = nd; q.push(r); } } }
    if (this._fields.size > 64) this._fields.clear();
    const f = { d, t }; this._fields.set(key, f); return f;
  }
  /** move `pos` (Vector3-like, mutated) towards target along the grid; y follows the surface. */
  step(pos, target, speed, dt, stopAt = 0) {
    const k = this.idx(pos.x, pos.z); if (k < 0 || !this.ok[k]) return false;
    const f = this.field(this.comp[k], target.x, target.z); if (!f) return false;
    const dx0 = target.x - pos.x, dz0 = target.z - pos.z;
    if (Math.hypot(dx0, dz0) <= stopAt) return false;
    let goal;
    if (f.d[k] <= 1) goal = { x: target.x, z: target.z };
    else { let best = k; for (const r of this.nb(k)) if (f.d[r] < f.d[best]) best = r; if (best === k) return false; goal = { x: this.cx_(best), z: this.cz_(best) }; }
    let dx = goal.x - pos.x, dz = goal.z - pos.z; const l = Math.hypot(dx, dz); if (l < 1e-4) return false;
    const s = Math.min(l, speed * dt); dx *= s / l; dz *= s / l;
    const nk = this.idx(pos.x + dx, pos.z + dz);
    if (nk < 0 || !this.ok[nk] || Math.abs(this.h[nk] - this.h[k]) > 0.7) return false;   // never off the grid
    pos.x += dx; pos.z += dz; pos.y = this.h[nk];
    return true;
  }
  /** line of sight between two points (eye heights included by the caller) */
  los(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz); if (L < 0.5) return true;
    const h = this.col.raycast(a, { x: dx / L, y: dy / L, z: dz / L }, L - 0.6, {});
    return !h;
  }
  /** a nearby walkable cell (same component) with line of sight to `eyeT`, closest to pos */
  coverWithLos(pos, eyeT, r = 9) {
    const k0 = this.idx(pos.x, pos.z); if (k0 < 0) return null;
    const c = this.comp[k0], R = Math.ceil(r / this.cell), i0 = k0 % this.n, j0 = Math.floor(k0 / this.n);
    let best = null, bd = Infinity;
    for (let s = 0; s < 40; s++) {
      const a = i0 + Math.round((Math.random() * 2 - 1) * R), b = j0 + Math.round((Math.random() * 2 - 1) * R);
      if (a < 0 || b < 0 || a >= this.n || b >= this.n) continue;
      const q = b * this.n + a; if (!this.ok[q] || this.comp[q] !== c) continue;
      const p = { x: this.cx_(q), y: this.h[q] + 1.5, z: this.cz_(q) };
      const d = (a - i0) ** 2 + (b - j0) ** 2; if (d >= bd) continue;
      if (this.los(p, eyeT)) { bd = d; best = { x: p.x, y: this.h[q], z: p.z }; }
    }
    return best;
  }
}
