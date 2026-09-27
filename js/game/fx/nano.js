// Copied from next/assets/vfx/nano/nano.three.js (2026-09-25, mk85 agent's reference shader) — ADR-001: copy, never import from next/.
// Mark Zero NEXT — nanotech reveal shader for three.js (r160+; tested on r186).
//
// A MeshStandardMaterial / MeshPhysicalMaterial patch (onBeforeCompile). Nano surfaces carry
// TEXCOORD_1 (Blender UV map "NanoUV", three.js attribute `uv1`):
//     u = arrival time 0..1 (geodesic distance from the source, normalised, plus noise)
//     v = per-plate random seed 0..1
// Two scalar drivers animate it (glTF Empties `drv_*`, value in position.x):
//     nano  (drv_nano)   0..1  where the surface EXISTS: a fragment is shown when u < nano
//     paint (drv_paint)  0..1  where the surface has RESOLVED into the painted suit
//                              (u < paint). Between the two fronts it is bare liquid metal.
// At the nano front: a hot cyan->gold emissive band with a hex-like cell lattice, the front
// arrives tile by tile (per-cell jitter), and the shell grows OUT of the skin (vertices near
// the front are pulled in along -normal by `thickness`), so the armour pours over the body
// instead of popping in. With nano = paint = 1 the material is exactly the original one.
//
// Usage (simplest — one call per loaded model):
//     import { NanoController } from '<next>/assets/vfx/nano/nano.three.js';
//     const nano = new NanoController(gltf.scene);          // finds every mesh with uv1
//     ... each frame: nano.update(dt);                       // reads drv_* nodes itself
//     nano.set('drv_nano', 0.4)  // manual override (e.g. a slider); nano.release('drv_nano')
//
// Per-mesh driver routing: a mesh whose glTF extras (three: mesh.userData, or its parents')
// hold `nano_driver: "drv_nano_blade"` (and optionally `nano_paint: "drv_paint_blade"`) is
// driven by those nodes instead of drv_nano / drv_paint. Missing paint driver -> the paint
// front follows the nano front with `paintLag` delay. Missing driver node -> value 1 (shown).
//
// Lower level:  const u = makeNanoUniforms(opts);  patchNanoMaterial(material, u);
//               mesh.customDepthMaterial = makeNanoDepthMaterial(u)  (shadows follow the reveal)
import * as THREE from 'three';

export const NANO_DEFAULTS = {
  edge: 0.045,          // width of the glowing band, in u units
  paintEdge: 0.06,      // softness of the paint resolve front, in u units
  paintLag: 0.16,       // when there is no paint driver: paint = nano - paintLag (rescaled)
  cellScale: 55.0,      // cells per metre (object space) -> ~1.8 cm tiles
  thickness: 0.018,     // metres the shell is pulled in towards the skin at the front
  grow: 0.07,           // u-distance over which the shell reaches full thickness
  edgeColor: 0x7fe6ff,  // hot cyan at the very front
  edgeColor2: 0xffb347, // warm gold behind it / at the paint front
  liquidColor: 0x8d949c,// bare nanite liquid metal (pre-paint)
  emissive: 6.0,        // emissive strength of the band (bloom-friendly, >= 3)
  ripple: 0.0025,       // metres of liquid ripple near the front
};

export function makeNanoUniforms(opts = {}) {
  const o = { ...NANO_DEFAULTS, ...opts };
  return {
    uNano: { value: opts.nano ?? 1 },
    uPaint: { value: opts.paint ?? 1 },
    uTime: { value: 0 },
    uNanoEdge: { value: o.edge },
    uPaintEdge: { value: o.paintEdge },
    uCellScale: { value: o.cellScale },
    uThickness: { value: o.thickness },
    uGrow: { value: o.grow },
    uEdgeColor: { value: new THREE.Color(o.edgeColor) },
    uEdgeColor2: { value: new THREE.Color(o.edgeColor2) },
    uLiquidColor: { value: new THREE.Color(o.liquidColor) },
    uNanoEmissive: { value: o.emissive },
    uRipple: { value: o.ripple },
  };
}

// ---------------------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------------------
const COMMON = /* glsl */`
uniform float uNano, uPaint, uTime, uNanoEdge, uPaintEdge, uCellScale, uThickness, uGrow;
uniform vec3 uEdgeColor, uEdgeColor2, uLiquidColor;
uniform float uNanoEmissive, uRipple;
`;

const VERT_HEAD = /* glsl */`
${COMMON}
attribute vec2 nanoUV;
varying vec2 vNanoUV;
varying vec3 vNanoPos;
`;

const VERT_BODY = /* glsl */`
  vNanoUV = nanoUV;
  vNanoPos = position;
  {
    float lead = uNano - nanoUV.x;
    float grow = 1.0 - smoothstep(0.0, uGrow, lead);          // 1 at the front, 0 behind
    grow *= step(uNano, 0.9999);
    float rip = sin(uTime * 17.0 + nanoUV.y * 43.0 + position.y * 60.0) * uRipple;
    transformed += objectNormal * (-uThickness * grow + rip * grow);
  }
`;

const FRAG_HEAD = /* glsl */`
${COMMON}
varying vec2 vNanoUV;
varying vec3 vNanoPos;
vec3 nanoHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// Worley F1/F2 on a lightly jittered lattice (reads as a hex-ish tile pattern)
vec2 nanoCells(vec3 p, out float cid) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0; cid = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 h = nanoHash3(i + g);
    vec3 r = g + 0.18 + h * 0.64 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; cid = h.x + h.y * 7.13 + h.z * 3.71; }
    else if (d < d2) { d2 = d; }
  }
  return vec2(sqrt(d1), sqrt(d2));
}
struct NanoState { float paint; float band; float line; float pband; };
NanoState nanoEval() {
  NanoState s;
  float cid;
  vec2 F = nanoCells(vNanoPos * uCellScale + vNanoUV.y * 17.0, cid);
  float cr = fract(cid * 13.37);
  float lead = uNano - vNanoUV.x + (cr - 0.5) * uNanoEdge * 0.9;
  if (uNano < 0.9999 && lead < 0.0) discard;
  if (uNano <= 0.0001) discard;
  s.band = (1.0 - smoothstep(0.0, uNanoEdge, lead)) * step(uNano, 0.9999);
  s.line = 1.0 - smoothstep(0.02, 0.10, F.y - F.x);
  float pl = uPaint - vNanoUV.x + (cr - 0.5) * uPaintEdge * 0.7;
  s.paint = uPaint >= 0.9999 ? 1.0 : smoothstep(0.0, uPaintEdge, pl);
  s.pband = (1.0 - smoothstep(0.0, uPaintEdge, abs(pl))) * step(uPaint, 0.9999) * step(0.0001, uPaint);
  return s;
}
`;

function patchVertex(src, needNormal = false) {
  return src
    .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
    .replace('#include <begin_vertex>', (needNormal ? 'vec3 objectNormal = vec3( normal );\n' : '') +
      '#include <begin_vertex>\n' + VERT_BODY);
}

export function patchNanoMaterial(material, uniforms) {
  if (material.userData.__nano) return material;
  material.userData.__nano = uniforms;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patchVertex(shader.vertexShader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n  NanoState nano = nanoEval();')
      .replace('#include <map_fragment>', `#include <map_fragment>
  diffuseColor.rgb = mix(uLiquidColor * (1.0 - 0.35 * nano.line), diffuseColor.rgb, nano.paint);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(0.14 + 0.18 * nano.line, roughnessFactor, nano.paint);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  metalnessFactor = mix(1.0, metalnessFactor, nano.paint);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    vec3 hot = mix(uEdgeColor, uEdgeColor2, smoothstep(0.35, 1.0, 1.0 - nano.band));
    totalEmissiveRadiance *= mix(0.25, 1.0, nano.paint);
    totalEmissiveRadiance += hot * nano.band * (0.25 + 0.95 * nano.line) * uNanoEmissive;
    totalEmissiveRadiance += uEdgeColor2 * nano.pband * (0.15 + 0.6 * nano.line) * uNanoEmissive * 0.35;
  }`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (key ? key() : '') + '|nano1';
  material.needsUpdate = true;
  return material;
}

/** Depth material with the same discard, so shadows follow the reveal. */
export function makeNanoDepthMaterial(uniforms, distance = false) {
  const m = distance ? new THREE.MeshDistanceMaterial() : new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patchVertex(shader.vertexShader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  NanoState nano = nanoEval();');
  };
  m.customProgramCacheKey = () => 'nano-depth' + (distance ? '-d' : '');
  return m;
}

function findExtra(o, key) {
  for (let p = o; p; p = p.parent) if (p.userData && p.userData[key] !== undefined) return p.userData[key];
  return undefined;
}

/**
 * Finds every mesh under `root` that has a `uv1` (NanoUV) attribute, patches its material(s),
 * groups them by driver and feeds the drivers each frame.
 * opts: NANO_DEFAULTS overrides, plus
 *   filter(mesh) -> bool        restrict which meshes get the effect
 *   driverRoot: Object3D        where drv_* nodes are searched (default: root)
 *   shadows: true               install depth materials for shadow casting
 */
export class NanoController {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = { ...NANO_DEFAULTS, ...opts };
    this.driverRoot = opts.driverRoot || root;
    this.groups = new Map();      // driverName -> {uniforms, paintName, meshes:[]}
    this.overrides = new Map();   // driver name -> forced value
    this.time = 0;
    const matCache = new Map();
    root.traverse(o => {
      if (!o.isMesh || !o.geometry?.attributes?.uv1) return;
      if (opts.filter && !opts.filter(o)) return;
      const dn = findExtra(o, 'nano_driver') || 'drv_nano';
      const pn = findExtra(o, 'nano_paint') || (dn === 'drv_nano' ? 'drv_paint' : dn.replace('drv_nano', 'drv_paint'));
      let g = this.groups.get(dn);
      if (!g) { g = { uniforms: makeNanoUniforms(this.opts), paintName: pn, meshes: [] }; this.groups.set(dn, g); }
      g.meshes.push(o);
      o.geometry.setAttribute('nanoUV', o.geometry.attributes.uv1);
      const mats = [].concat(o.material).map(m => {
        const k = m.uuid + '|' + dn;
        if (!matCache.has(k)) {
          const c = m.userData.__nano ? m.clone() : m;
          if (c !== m) delete c.userData.__nano;
          matCache.set(k, patchNanoMaterial(c, g.uniforms));
        }
        return matCache.get(k);
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
      if (opts.shadows !== false) {
        o.customDepthMaterial = makeNanoDepthMaterial(g.uniforms);
        o.customDistanceMaterial = makeNanoDepthMaterial(g.uniforms, true);
      }
    });
    this._nodes = new Map();
  }

  _node(name) {
    if (!this._nodes.has(name)) this._nodes.set(name, this.driverRoot.getObjectByName(name) || null);
    return this._nodes.get(name);
  }
  value(name, fallback = 1) {
    if (this.overrides.has(name)) return this.overrides.get(name);
    const n = this._node(name);
    return n ? n.position.x : fallback;
  }
  set(name, v) { this.overrides.set(name, v); }
  release(name) { name ? this.overrides.delete(name) : this.overrides.clear(); }

  update(dt = 0) {
    this.time += dt;
    for (const [dn, g] of this.groups) {
      const nano = THREE.MathUtils.clamp(this.value(dn, 1), 0, 1);
      const pnode = this.overrides.has(g.paintName) || this._node(g.paintName);
      let paint = pnode ? this.value(g.paintName, 1)
                        : THREE.MathUtils.clamp((nano - this.opts.paintLag) / (1 - this.opts.paintLag), 0, 1);
      if (nano >= 0.9999 && !pnode) paint = 1;
      g.uniforms.uNano.value = nano;
      g.uniforms.uPaint.value = Math.min(THREE.MathUtils.clamp(paint, 0, 1), nano);
      g.uniforms.uTime.value = this.time;
    }
  }

  dispose() {
    for (const g of this.groups.values()) for (const m of g.meshes) { m.customDepthMaterial?.dispose(); m.customDistanceMaterial?.dispose(); }
  }
}
