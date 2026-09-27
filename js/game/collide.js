// City collision for the heroes: every building PART of the NEXT layout (assets/city/layout.json)
// as an extruded polygon prism (poly, y0..y1). Exact to the rendered blocks — unlike the 4 m map
// raster it has real wall normals, which Spider-Man's wall crawl, his swing anchors and Iron Man's
// wall slides all need. A 32 m uniform grid keeps queries local; no allocation per query.
//
// Queries: groundAt(x, z, y) (highest roof at or below y, else the street), raycast(o, d, max),
// sphere(c, r) → push-out + normal, wallNear(p, r) → closest wall point/normal.
// Runs in the browser and in node (tests pass the parsed layout to fromLayout()).

const CELL = 32;

export class CityCollider {
  static async load(url = '/assets/city/layout.json') {
    const L = await (await fetch(url)).json();
    return CityCollider.fromLayout(L);
  }
  static fromLayout(L) {
    const c = new CityCollider();
    c.groundY = L.ground_y ?? 0; c.waterY = L.water_y ?? -2.2;
    c.island = L.island?.outline || null;
    const P = c.prisms = [];
    for (const b of L.buildings) for (const p of b.parts || []) {
      if (!p.poly || p.poly.length < 3 || p.y1 - p.y0 < 1.5) continue;
      P.push(makePrism(p.poly, p.y0, p.y1, b.id));
    }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p.minx); z0 = Math.min(z0, p.minz); x1 = Math.max(x1, p.maxx); z1 = Math.max(z1, p.maxz); }
    c.x0 = Math.floor(x0 / CELL) * CELL; c.z0 = Math.floor(z0 / CELL) * CELL;
    c.cols = Math.ceil((x1 - c.x0) / CELL) + 1; c.rows = Math.ceil((z1 - c.z0) / CELL) + 1;
    c.cells = new Array(c.cols * c.rows);
    P.forEach((p, i) => {
      for (let cz = c._cz(p.minz); cz <= c._cz(p.maxz); cz++) for (let cx = c._cx(p.minx); cx <= c._cx(p.maxx); cx++) {
        const k = cz * c.cols + cx; (c.cells[k] ||= []).push(i);
      }
    });
    c._stamp = new Uint32Array(P.length); c._gen = 1;
    return c;
  }
  _cx(x) { return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.x0) / CELL))); }
  _cz(z) { return Math.max(0, Math.min(this.rows - 1, Math.floor((z - this.z0) / CELL))); }
  _cell(x, z) {
    const cx = Math.floor((x - this.x0) / CELL), cz = Math.floor((z - this.z0) / CELL);
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return null;
    return this.cells[cz * this.cols + cx] || null;
  }
  /** street level at x,z: land inside the island outline, water outside */
  base(x, z) { return !this.island || inPoly(this.island, x, z) ? this.groundY : this.waterY; }

  /** Highest roof under (x,z) whose top is at or below y + step; the street otherwise. */
  groundAt(x, z, y = Infinity, step = 0.6) {
    let g = this.base(x, z);
    const cell = this._cell(x, z); if (!cell) return g;
    for (const i of cell) {
      const p = this.prisms[i];
      if (p.y1 > g && p.y1 <= y + step && x >= p.minx && x <= p.maxx && z >= p.minz && z <= p.maxz && inPrism(p, x, z)) g = p.y1;
    }
    return g;
  }
  /** Is the point inside a building volume? Returns the prism or null. */
  inside(x, y, z) {
    const cell = this._cell(x, z); if (!cell) return null;
    for (const i of cell) { const p = this.prisms[i]; if (y > p.y0 && y < p.y1 && inPrism(p, x, z)) return p; }
    return null;
  }

  /** First hit of the ray o + d t (d normalised), t in (0, max]. → {t, x, y, z, nx, ny, nz, prism} or null. */
  raycast(o, d, max = 500, out = {}) {
    const gen = ++this._gen; let best = max, hit = null;
    // ground plane
    if (d.y < -1e-6) { const tg = (this.base(o.x, o.z) - o.y) / d.y; if (tg > 0 && tg < best) { best = tg; hit = setHit(out, tg, o, d, 0, 1, 0, null); } }
    // DDA over the cells the ray's xz projection crosses
    const len2 = Math.hypot(d.x, d.z);
    const steps = Math.ceil((len2 * best) / (CELL * 0.35)) + 1;
    const stepT = len2 > 1e-6 ? (CELL * 0.35) / len2 : best;
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(best, s * stepT);
      if (s * stepT > best + stepT) break;
      const cell = this._cell(o.x + d.x * t, o.z + d.z * t); if (!cell) continue;
      for (const i of cell) {
        if (this._stamp[i] === gen) continue; this._stamp[i] = gen;
        const p = this.prisms[i];
        const th = rayPrism(p, o, d, best, _h);
        if (th >= 0 && th < best) { best = th; hit = setHit(out, th, o, d, _h.nx, _h.ny, _h.nz, p); }
      }
    }
    return hit;
  }

  /** Resolve a sphere (centre c, radius r) against buildings. Mutates c; returns the summed normal
   * of the contacts {nx, ny, nz, n (count), depth} or null. */
  sphere(c, r, out = {}) {
    let n = 0, nx = 0, ny = 0, nz = 0, depth = 0;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const gen = ++this._gen;
      for (const [ox, oz] of OFFS) {
        const cell = this._cell(c.x + ox * r, c.z + oz * r); if (!cell) continue;
        for (const i of cell) {
          if (this._stamp[i] === gen) continue; this._stamp[i] = gen;
          const p = this.prisms[i];
          if (c.y < p.y0 - r || c.y > p.y1 + r) continue;
          if (c.x < p.minx - r || c.x > p.maxx + r || c.z < p.minz - r || c.z > p.maxz + r) continue;
          const e = closestEdge(p, c.x, c.z, _e), inside = inPrism(p, c.x, c.z);
          let px = 0, py = 0, pz = 0;
          if (inside) {
            const up = p.y1 - c.y + r, side = e.d + r;
            if (c.y > p.y1 - r * 0.6 && up < side) py = up;              // on / into the roof → up
            else { px = e.nx * side; pz = e.nz * side; }                  // into a wall → out sideways
          } else if (e.d < r) {
            if (c.y > p.y1) {                                              // roof edge: corner push
              const dy = c.y - p.y1, dd = Math.hypot(e.d, dy); if (dd >= r) continue;
              const k = (r - dd) / Math.max(dd, 1e-4); px = e.nx * e.d * k; pz = e.nz * e.d * k; py = dy * k;
            } else { const k = r - e.d; px = e.nx * k; pz = e.nz * k; }
          } else continue;
          c.x += px; c.y += py; c.z += pz;
          const m = Math.hypot(px, py, pz); if (m > 1e-6) { nx += px / m; ny += py / m; nz += pz / m; n++; depth = Math.max(depth, m); moved = true; }
        }
      }
      if (!moved) break;
    }
    if (!n) return null;
    const m = Math.hypot(nx, ny, nz) || 1;
    out.nx = nx / m; out.ny = ny / m; out.nz = nz / m; out.n = n; out.depth = depth;
    return out;
  }

  /** Closest vertical wall to p within r (only walls whose height span contains p.y).
   * → {x, y, z, nx, nz, d, top, prism} or null. */
  wallNear(p, r, out = {}) {
    let best = r, got = null; const gen = ++this._gen;
    for (const [ox, oz] of OFFS) {
      const cell = this._cell(p.x + ox * r, p.z + oz * r); if (!cell) continue;
      for (const i of cell) {
        if (this._stamp[i] === gen) continue; this._stamp[i] = gen;
        const q = this.prisms[i];
        if (p.y < q.y0 - 0.2 || p.y > q.y1 + 0.2) continue;
        if (p.x < q.minx - r || p.x > q.maxx + r || p.z < q.minz - r || p.z > q.maxz + r) continue;
        const e = closestEdge(q, p.x, p.z, _e);
        const d = inPrism(q, p.x, p.z) ? -e.d : e.d;
        if (d < best) { best = d; got = q; out.x = e.x; out.z = e.z; out.y = p.y; out.nx = e.nx; out.nz = e.nz; out.d = d; out.top = q.y1; out.prism = q; }
      }
    }
    return got ? out : null;
  }
}

const OFFS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const _h = { nx: 0, ny: 0, nz: 0 }, _e = { d: 0, x: 0, z: 0, nx: 0, nz: 0 };

function setHit(out, t, o, d, nx, ny, nz, prism) {
  out.t = t; out.x = o.x + d.x * t; out.y = o.y + d.y * t; out.z = o.z + d.z * t;
  out.nx = nx; out.ny = ny; out.nz = nz; out.prism = prism; return out;
}

function makePrism(poly, y0, y1, id) {
  const n = poly.length, xs = new Float64Array(n), zs = new Float64Array(n);
  let area = 0, minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for (let i = 0; i < n; i++) {
    const [x, z] = poly[i]; xs[i] = x; zs[i] = z;
    minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z);
    const [x2, z2] = poly[(i + 1) % n]; area += x * z2 - x2 * z;
  }
  // outward normal of edge a→b is (dz, -dx)·s where s depends on the winding
  return { xs, zs, n, y0, y1, minx, minz, maxx, maxz, s: area > 0 ? 1 : -1, id };
}

export function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function inPrism(p, x, z) {
  let c = false; const xs = p.xs, zs = p.zs;
  for (let i = 0, j = p.n - 1; i < p.n; j = i++) {
    if ((zs[i] > z) !== (zs[j] > z) && x < ((xs[j] - xs[i]) * (z - zs[i])) / (zs[j] - zs[i]) + xs[i]) c = !c;
  }
  return c;
}
function closestEdge(p, x, z, out) {
  let best = Infinity; const xs = p.xs, zs = p.zs;
  for (let i = 0; i < p.n; i++) {
    const j = (i + 1) % p.n, ax = xs[i], az = zs[i], dx = xs[j] - ax, dz = zs[j] - az;
    const L2 = dx * dx + dz * dz; if (L2 < 1e-8) continue;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const cx = ax + dx * u, cz = az + dz * u, d = Math.hypot(x - cx, z - cz);
    if (d < best) { best = d; const L = Math.sqrt(L2); out.d = d; out.x = cx; out.z = cz; out.nx = (dz / L) * p.s; out.nz = (-dx / L) * p.s; }
  }
  return out;
}
/** Entry t of a ray into a prism (−1 if none / starts inside). Normal in h. */
function rayPrism(p, o, d, max, h) {
  // quick reject: bounding box slab test
  let t0 = 0, t1 = max;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, p.minx, p.maxx], [o.y, d.y, p.y0, p.y1], [o.z, d.z, p.minz, p.maxz]]) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return -1; continue; }
    let a = (lo - oo) / dd, b = (hi - oo) / dd; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return -1;
  }
  if (o.y > p.y0 && o.y < p.y1 && inPrism(p, o.x, o.z)) return -1;
  let best = -1;
  // top / bottom caps
  if (d.y < -1e-9) { const t = (p.y1 - o.y) / d.y; if (t > 0 && t < max && inPrism(p, o.x + d.x * t, o.z + d.z * t)) { best = t; h.nx = 0; h.ny = 1; h.nz = 0; } }
  else if (d.y > 1e-9 && p.y0 > 0.5) { const t = (p.y0 - o.y) / d.y; if (t > 0 && t < max && inPrism(p, o.x + d.x * t, o.z + d.z * t)) { best = t; h.nx = 0; h.ny = -1; h.nz = 0; } }
  // side walls
  const xs = p.xs, zs = p.zs;
  for (let i = 0; i < p.n; i++) {
    const j = (i + 1) % p.n, ax = xs[i], az = zs[i], ex = xs[j] - ax, ez = zs[j] - az;
    const L = Math.hypot(ex, ez); if (L < 1e-6) continue;
    const nx = (ez / L) * p.s, nz = (-ex / L) * p.s;
    const dn = d.x * nx + d.z * nz; if (dn >= -1e-9) continue;          // must be entering
    const t = ((ax - o.x) * nx + (az - o.z) * nz) / dn;
    if (t <= 0 || t >= max || (best >= 0 && t >= best)) continue;
    const hx = o.x + d.x * t - ax, hz = o.z + d.z * t - az, u = (hx * ex + hz * ez) / (L * L);
    if (u < 0 || u > 1) continue;
    const hy = o.y + d.y * t; if (hy < p.y0 || hy > p.y1) continue;
    best = t; h.nx = nx; h.ny = 0; h.nz = nz;
  }
  return best;
}
