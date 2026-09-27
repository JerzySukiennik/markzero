// Texture loading for the city: vertical-strip images -> DataArrayTexture (one slice per layer).
import * as THREE from 'three';

const cache = new Map();

async function imageData(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0);
  const d = x.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close?.();
  return d;
}

/** A vertical strip of square slices -> DataArrayTexture. Rows are flipped per slice so that
 *  v = 0 is the BOTTOM of each slice image (matching ordinary image textures with flipY). */
export async function arrayTexture(url, { srgb = false } = {}) {
  const key = url + srgb;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const d = await imageData(url);
    const w = d.width, n = Math.round(d.height / w);
    const src = d.data, out = new Uint8Array(w * w * 4 * n);
    const row = w * 4;
    for (let s = 0; s < n; s++) {
      for (let y = 0; y < w; y++) {
        const from = (s * w + y) * row, to = (s * w + (w - 1 - y)) * row;
        out.set(src.subarray(from, from + row), to);
      }
    }
    const t = new THREE.DataArrayTexture(out, w, w, n);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  })();
  cache.set(key, p);
  return p;
}

export async function tex2d(url, { srgb = false, repeat = true, mips = true } = {}) {
  const key = 'img:' + url + srgb;
  if (cache.has(key)) return cache.get(key);
  const p = new THREE.TextureLoader().loadAsync(url).then(t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    return t;
  });
  cache.set(key, p);
  return p;
}

/** styles.json -> float DataTexture (8 texels per style row). */
export function stylesTexture(styles) {
  const rows = styles.rows, n = rows.length;
  const data = new Float32Array(8 * 4 * n);
  rows.forEach((r, i) => data.set(r, i * 32));
  const t = new THREE.DataTexture(data, 8, n, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}

/** Sky-visibility field (next/blender/city/build_skyfield.py): DataTexture (row 0 = z0, no flip) + the CPU copy
 *  for camera-side lookups (auto exposure). */
export async function skyFieldTexture(url) {
  const d = await imageData(url);
  const t = new THREE.DataTexture(new Uint8Array(d.data.buffer.slice(0)), d.width, d.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false; t.needsUpdate = true;
  t.userData.cpu = { data: d.data, w: d.width, h: d.height };
  return t;
}
