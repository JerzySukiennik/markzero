// City collision as a heightfield: the design agent's 4 m dot-map raster (design/map/dots_4m.png:
// R = class, G = height/2 m, B = district) gives the roof height of every 4 m cell. Cheap, exact
// enough for flight and rooftops, and the same data the map screen draws — so what you see on the
// map is what you collide with.
const CLASS = ['water', 'ground', 'street', 'park', 'low', 'mid', 'tower', 'landmark', 'pier', 'bridge', 'base'];
const BUILDING = new Set([4, 5, 6, 7, 10]);

export class Heightfield {
  async load(meta = '/design/map/dots_4m.json') {
    const m = await (await fetch(meta)).json();
    Object.assign(this, { res: m.res, cols: m.cols, rows: m.rows, x0: m.extent.xmin, z0: m.extent.zmin });
    const blob = await (await fetch(meta.replace(/[^/]+$/, m.data_png))).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bmp, 0, 0);
    const px = x.getImageData(0, 0, bmp.width, bmp.height).data;
    const n = this.cols * this.rows;
    this.cls = new Uint8Array(n); this.h = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = px[i * 4], hv = px[i * 4 + 1] * 2;
      this.cls[i] = k;
      this.h[i] = BUILDING.has(k) ? hv : k === 0 ? -2.2 : k === 8 ? 0.6 : k === 9 ? 36 : k === 2 ? 0 : 0.15;
    }
    return this;
  }
  idx(x, z) {
    const c = Math.floor((x - this.x0) / this.res), r = Math.floor((z - this.z0) / this.res);
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c;
  }
  /** Top surface height (roof, street, water surface) at world x,z. */
  groundAt(x, z) { const i = this.idx(x, z); return i < 0 ? -2.2 : this.h[i]; }
  classAt(x, z) { const i = this.idx(x, z); return i < 0 ? 'water' : CLASS[this.cls[i]]; }
  isBuilding(x, z) { const i = this.idx(x, z); return i >= 0 && BUILDING.has(this.cls[i]); }
  /** Max roof height in a radius (for "is there a wall next to me"). */
  maxAround(x, z, r) { let m = -2.2; for (let dz = -r; dz <= r; dz += this.res) for (let dx = -r; dx <= r; dx += this.res) m = Math.max(m, this.groundAt(x + dx, z + dz)); return m; }
  /** March a segment; first point whose height is below the surface. Returns {x,y,z,t} or null. */
  raycast(o, d, maxDist, step = 2) {
    for (let t = step; t <= maxDist; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= this.groundAt(x, z)) return { x, y, z, t };
    }
    return null;
  }
}
