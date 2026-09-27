// The city as a 3D isometric map of SQUARE DOTS (design/map/dots_*m.json from the design agent).
//  - ground level (water / ground / street / park / pier / bridge) = ONE plane whose shader draws a crisp
//    square dot per cell from a data texture (resolution-independent, 1 draw call)
//  - buildings = ONE InstancedMesh of columns; side faces are cut into stacked slabs so a tower reads as
//    a stack of square dots; top face = the dot itself
//  - beacons (bases, landmarks, players, waypoint, pings) = additive camera-facing quads (fake bloom)
//  - reveal: columns rise from the ground in a ripple; scan sweep; suit re-tint as a ring expanding from
//    the player (themes.json transition.mapRetint)
// Everything is theme-driven through uniforms, so one instance can serve the map screen, the minimap,
// the title backdrop and the loading screen. Budget: 3–5 draw calls per instance.
import * as THREE from 'three';

const CLS = { water: 0, ground: 1, street: 2, park: 3, low: 4, mid: 5, tower: 6, landmark: 7, pier: 8, bridge: 9, base: 10 };
const cache = new Map();

async function loadGrid(res) {
  if (!cache.has(res)) cache.set(res, (async () => {
    const j = await (await fetch(`/design/map/dots_${res}m.json`)).json();
    const dec = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const cls = dec(j.class_b64), hgt = dec(j.height_b64);
    const { cols, rows, extent } = j;
    // ground texture: R = class, G = height/2  (RG8, NEAREST)
    const tex = new Uint8Array(cols * rows * 2);
    for (let i = 0; i < cols * rows; i++) { tex[i * 2] = cls[i]; tex[i * 2 + 1] = hgt[i]; }
    const dt = new THREE.DataTexture(tex, cols, rows, THREE.RGFormat, THREE.UnsignedByteType);
    dt.magFilter = dt.minFilter = THREE.NearestFilter; dt.generateMipmaps = false; dt.flipY = false; dt.needsUpdate = true;
    // building instances
    const idx = [];
    for (let i = 0; i < cols * rows; i++) { const c = cls[i]; if (c >= 4 && c <= 7 || c === 10) idx.push(i); }
    const inst = new Float32Array(idx.length * 4);
    idx.forEach((i, k) => {
      const col = i % cols, row = (i / cols) | 0;
      inst[k * 4] = extent.xmin + (col + 0.5) * res; inst[k * 4 + 1] = extent.zmin + (row + 0.5) * res;
      inst[k * 4 + 2] = Math.max(hgt[i] * 2, 6); inst[k * 4 + 3] = cls[i];
    });
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index; g.setAttribute('position', box.attributes.position); g.setAttribute('normal', box.attributes.normal);
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(inst, 4));
    g.instanceCount = idx.length;
    return { res, cols, rows, extent, cls, hgt, tex: dt, geo: g, count: idx.length, meta: j };
  })());
  return cache.get(res);
}

// screen-space circular clip (minimap): uCircle = (cx, cy, r) in framebuffer px; r = 0 → off. Returns an edge fade.
const CIRC = `uniform vec3 uCircle;
float circ(){ if (uCircle.z <= 0.0) return 1.0; float d = length(gl_FragCoord.xy - uCircle.xy); if (d > uCircle.z) discard; return smoothstep(uCircle.z, uCircle.z * 0.82, d); }`;
const COMMON = `
uniform float uT; uniform float uReveal; uniform vec2 uOrigin; uniform float uTintR; uniform vec2 uTintO;
uniform vec3 uLowA; uniform vec3 uMidA; uniform vec3 uHighA; uniform vec3 uGlowA; uniform vec3 uAccA;
uniform vec3 uLowB; uniform vec3 uMidB; uniform vec3 uHighB; uniform vec3 uGlowB; uniform vec3 uAccB;
uniform float uScan; uniform vec2 uScanDir; uniform vec4 uClip; uniform float uFade; uniform vec2 uFocus; uniform float uFocusR;
uniform float uRT;   // 1 = rendering the low-res city target of the two-pass dot-matrix mode (alpha = glow feed)
float tintK(vec2 xz){ return 1.0 - smoothstep(uTintR - 90.0, uTintR, length(xz - uTintO)); }
float tintRing(vec2 xz){ float d = length(xz - uTintO) - uTintR; return exp(-d*d/(2.0*60.0*60.0)) * step(uTintR, 5200.0) * step(1.0, uTintR); }
`;

const COL_VS = `
attribute vec4 aCell;
varying vec3 vN; varying vec3 vW; varying float vH; varying float vCls; varying float vRise; varying vec2 vXZ; varying float vLocalY;
uniform float uRes; uniform float uGap; uniform float uVExag;
${COMMON}
void main(){
  vec2 xz = aCell.xy; float hgt = aCell.z * uVExag;
  float d = length(xz - uOrigin);
  float k = clamp((uReveal - d) / 420.0, 0.0, 1.0); k = k*k*(3.0-2.0*k);
  float rise = clamp((uReveal - d) / 160.0, 0.0, 1.0);
  vRise = (1.0 - rise) * step(0.001, k);
  vec3 p = position;
  float foot = uRes * uGap;
  vec3 w = vec3(xz.x + p.x * foot, p.y * hgt * k, xz.y + p.z * foot);
  vN = normal; vW = w; vH = aCell.z; vCls = aCell.w; vXZ = xz; vLocalY = p.y * hgt;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const COL_FS = `
varying vec3 vN; varying vec3 vW; varying float vH; varying float vCls; varying float vRise; varying vec2 vXZ; varying float vLocalY;
uniform float uSlab;
${COMMON}
${CIRC}
vec3 pal(float cls, float h, float kB){
  vec3 lo = mix(uLowA, uLowB, kB), mi = mix(uMidA, uMidB, kB), hi = mix(uHighA, uHighB, kB), gl = mix(uGlowA, uGlowB, kB), ac = mix(uAccA, uAccB, kB);
  if (cls > 9.5) return ac * 1.25;
  if (cls > 6.5) return gl * 1.1;
  float t = clamp((h - 10.0) / 150.0, 0.0, 1.0);
  vec3 c = mix(lo * 1.9, mi, smoothstep(0.0, 0.35, t));
  return mix(c, hi, smoothstep(0.3, 1.0, t));
}
void main(){
  if (vW.x < uClip.x || vW.x > uClip.z || vW.z < uClip.y || vW.z > uClip.w) discard;
  float kB = tintK(vXZ);
  vec3 base = pal(vCls, vH, kB);
  float top = step(0.5, vN.y);
  // iso shading: top = full, the two lit sides at fixed levels (stays readable in any rotation)
  float side = 0.34 + 0.22 * abs(dot(vN.xz, normalize(vec2(0.8, 0.45))));
  side *= mix(1.0, 0.62, uRT);                                 // matrix mode: walls darker so roofs/silhouettes read in the lattice
  float lum = mix(side, 1.0, top);
  // stacked slabs on the sides
  float slab = fract(vLocalY / uSlab);
  float gap = (1.0 - top) * step(slab, 0.3) * (1.0 - uRT);     // the lattice pass makes the dots in matrix mode
  lum *= 1.0 - gap * 0.8;
  // ground contact darkening + height glow on tall towers
  lum *= mix(0.55, 1.0, clamp(vLocalY / 40.0, 0.0, 1.0));
  vec3 c = base * lum;
  // scan sweep
  float s = dot(vXZ, uScanDir) - uScan;
  float scan = exp(-s*s/(2.0*55.0*55.0));
  c += mix(uAccA, uAccB, kB) * scan * (0.55 + 0.6 * top);
  // rising flash at the reveal wavefront + retint ring
  c += mix(uGlowA, uGlowB, kB) * vRise * 1.4;
  c += mix(uAccA, uAccB, kB) * tintRing(vXZ) * 0.9;
  // focus falloff (distance from the view centre) so the eye lands in the middle
  float fd = length(vXZ - uFocus) / uFocusR; c *= mix(1.0, 0.25, smoothstep(0.55, 1.15, fd));
  float glowF = vCls > 6.5 ? 0.9 : pow(clamp(vH / 426.0, 0.0, 1.0), 1.3) * 0.55 * mix(0.4, 1.0, top);
  gl_FragColor = vec4(c * uFade * circ(), uRT > 0.5 ? glowF : 1.0);
  #include <colorspace_fragment>
}`;

const GROUND_VS = `
varying vec2 vXZ;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GROUND_FS = `
varying vec2 vXZ;
uniform sampler2D uData; uniform vec2 uGrid; uniform vec4 uExt; uniform float uRes; uniform float uDotSize;
${COMMON}
${CIRC}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  if (vXZ.x < uClip.x || vXZ.x > uClip.z || vXZ.y < uClip.y || vXZ.y > uClip.w) discard;
  vec2 g = (vXZ - uExt.xy) / uRes; vec2 cell = floor(g);
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uGrid.x || cell.y >= uGrid.y) discard;
  vec2 cls2 = texture2D(uData, (cell + 0.5) / uGrid).rg * 255.0; float cls = floor(cls2.r + 0.5);
  float d = length((cell + 0.5) * uRes + uExt.xy - uOrigin);
  float rev = 1.0 - smoothstep(uReveal - 260.0, uReveal - 60.0, d);
  if (rev <= 0.001) discard;
  float kB = tintK(vXZ);
  vec3 lo = mix(uLowA, uLowB, kB), mi = mix(uMidA, uMidB, kB), ac = mix(uAccA, uAccB, kB), gl = mix(uGlowA, uGlowB, kB);
  vec3 col; float a; float size = uDotSize;
  if (cls < 0.5) { // water: sparse shimmering dots
    float sh = 0.5 + 0.5 * sin(uT * 1.3 + cell.x * 0.35 + cell.y * 0.21 + hash(cell) * 6.28);
    col = lo * 1.6; a = 0.35 * (0.35 + 0.65 * sh) * step(0.5, mod(cell.x + cell.y, 2.0)); size *= 0.55;
  } else if (cls < 1.5) { col = lo * 1.35; a = 0.9; size *= 0.8; }            // ground
  else if (cls < 2.5) { col = lo * 2.2; a = 1.0; size *= 0.9; }               // street
  else if (cls < 3.5) { col = mi * 0.6; a = 0.9; size *= 0.75; }              // park
  else if (cls > 7.5 && cls < 9.5) { col = mi * 0.9; a = 1.0; }               // pier, bridge
  else { col = lo * 1.2; a = 0.5; }                                           // under buildings
  vec2 f = abs(fract(g) - 0.5);
  float e = max(f.x, f.y); float aa = fwidth(e) * 1.2;
  float m = 1.0 - smoothstep(size * 0.5 - aa, size * 0.5 + aa, e);
  float s = dot(vXZ, uScanDir) - uScan; float scan = exp(-s*s/(2.0*55.0*55.0));
  col += ac * scan * 0.8 + ac * tintRing(vXZ) * 0.7;
  float fd = length(vXZ - uFocus) / uFocusR; col *= mix(1.0, 0.25, smoothstep(0.55, 1.15, fd));
  if (uRT > 0.5) {   // matrix mode: one flat colour per texel, streets are negative space, no glow
    float keep = (cls > 1.5 && cls < 2.5) ? 0.0 : (cls < 0.5 ? 0.7 : 0.5);   // streets empty, ground/water quiet
    gl_FragColor = vec4(col * uFade * a * rev * keep, 0.0);
  } else gl_FragColor = vec4(col * uFade, a * m * rev * circ());
  #include <colorspace_fragment>
}`;

const BEACON_VS = `
attribute vec4 aB; attribute vec4 aC; // aB: x, z, height, kind ; aC: rgb, phase
varying vec2 vUv; varying vec3 vCol; varying float vKind; varying float vPh;
uniform float uPx; uniform float uWidth;
void main(){
  vUv = uv; vCol = aC.rgb; vKind = aB.w; vPh = aC.a;
  vec3 base = vec3(aB.x, 0.0, aB.y);
  vec4 b0 = viewMatrix * vec4(base, 1.0); vec4 b1 = viewMatrix * vec4(base + vec3(0.0, aB.z, 0.0), 1.0);
  vec4 v = mix(b0, b1, uv.y);
  v.x += (uv.x - 0.5) * uWidth * uPx * (1.0 + step(2.5, aB.w) * 1.5);
  gl_Position = projectionMatrix * v;
}`;
const BEACON_FS = `
varying vec2 vUv; varying vec3 vCol; varying float vKind; varying float vPh;
uniform float uT; uniform float uFade;
${CIRC}
void main(){
  float cf = circ();
  float x = abs(vUv.x - 0.5) * 2.0;
  float core = exp(-x*x*38.0), halo = exp(-x*x*4.0) * 0.35;
  float fall = pow(1.0 - vUv.y, 1.3);
  float pulse = 0.75 + 0.25 * sin(uT * 3.0 + vPh * 6.28);
  float travel = exp(-pow((vUv.y - fract(uT * 0.45 + vPh)) * 7.0, 2.0)) * 0.9;
  float a = (core + halo) * (fall * pulse + travel * core);
  gl_FragColor = vec4(vCol * a * 1.6 * uFade * cf, 1.0);
  #include <colorspace_fragment>
}`;
const RING_VS = `
attribute vec4 aB; attribute vec4 aC;
varying vec2 vUv; varying vec3 vCol; varying float vPh; varying float vKind;
uniform float uPx; uniform float uRingPx;
void main(){ vUv = uv * 2.0 - 1.0; vCol = aC.rgb; vPh = aC.a; vKind = aB.w;
  vec3 p = vec3(aB.x + position.x * uRingPx * uPx * (1.0 + step(2.5, aB.w)), 0.5, aB.y + position.y * uRingPx * uPx * (1.0 + step(2.5, aB.w)));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`;
const RING_FS = `
varying vec2 vUv; varying vec3 vCol; varying float vPh; varying float vKind;
uniform float uT; uniform float uFade;
${CIRC}
void main(){ float r = length(vUv); if (r > 1.0) discard; float cf = circ();
  float t = fract(uT * 0.6 + vPh);
  float ring = exp(-pow((r - t) * 14.0, 2.0)) * (1.0 - t);
  float inner = exp(-pow((r - 0.34) * 22.0, 2.0)) * 0.9 + exp(-r*r*30.0) * 0.8;
  gl_FragColor = vec4(vCol * (ring + inner) * uFade * cf, 1.0);
  #include <colorspace_fragment>
}`;

const MATRIX_FS = `
uniform sampler2D uCity; uniform vec2 uOrigin; uniform float uPitch; uniform vec2 uTex; uniform vec3 uLed; uniform float uLumHigh; uniform float uBloom; uniform vec4 uVp; uniform float uFade;
void main(){
  vec2 fc = gl_FragCoord.xy - uOrigin;
  vec2 cell = floor(fc / uPitch);
  vec4 c = texelFetch(uCity, ivec2(cell), 0);
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float b = clamp(lum / uLumHigh, 0.0, 1.0);
  bool lit = max(c.r, max(c.g, c.b)) > 0.004;
  float s = lit ? max(1.0, floor(uPitch * mix(0.34, 0.8, pow(b, 0.55)) + 0.5)) : 1.0;
  vec2 f = fc - (cell + 0.5) * uPitch;
  float inside = step(max(abs(f.x), abs(f.y)), s * 0.5);
  // the unlit LED lattice, faint and only on a round "table" in the middle of the view
  vec2 q = (fc - uVp.zw * 0.5) / uVp.w; float table = smoothstep(0.95, 0.35, length(q * vec2(0.75, 1.0)));
  vec3 col = lit ? c.rgb * (1.0 + 0.35 * (1.0 - b)) : uLed * 0.5 * table;
  float a = lit ? inside : inside * table * 0.9;
  // bloom: the target's mips (glow feed = alpha)
  vec2 uv = (cell + 0.5) / uTex;
  vec4 m1 = textureLod(uCity, uv, 1.5), m2 = textureLod(uCity, uv, 3.0), m3 = textureLod(uCity, uv, 4.3);
  vec3 bloom = (m1.rgb * m1.a * 0.6 + m2.rgb * m2.a * 0.45 + m3.rgb * m3.a * 0.3) * uBloom;
  vec3 outc = col * a + bloom;
  gl_FragColor = vec4(outc * uFade, clamp(max(a, dot(bloom, vec3(0.33)) * 2.0), 0.0, 1.0));
  #include <colorspace_fragment>
}`;

function paletteUniforms(prefix, T) {
  return { [`uLow${prefix}`]: { value: T.dotLow.clone() }, [`uMid${prefix}`]: { value: T.dotMid.clone() }, [`uHigh${prefix}`]: { value: T.dotHigh.clone() }, [`uGlow${prefix}`]: { value: T.glow.clone() }, [`uAcc${prefix}`]: { value: T.accent.clone() } };
}

export class DotMap {
  /** opts: res (16 | 8), vexag, pitch (deg), clip ({x0,z0,x1,z1} world rect), beaconWidth px, auto (slow rotate) */
  constructor(MZ, opts = {}) {
    this.MZ = MZ; this.o = { res: 16, vexag: 1.25, pitch: 35.264, beaconWidth: 5, ringPx: 26, ...opts };
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -8000, 12000);
    this.target = new THREE.Vector3(0, 0, 0); this.targetGoal = this.target.clone();
    this.yaw = THREE.MathUtils.degToRad(45); this.yawGoal = this.yaw; this.zoom = 1; this.zoomGoal = 1;
    this.viewH = 3600;           // world metres visible vertically at zoom 1
    this.aspect = 16 / 9; this.ready = false;
    this.revealT = 0; this.revealSpeed = 2600; this.scanT = 0; this.scanEvery = 6.5;
    this.tintR = 0; this.tintActive = false;
    this.beaconList = []; this.fade = 1;
    const T = MZ.theme.c;
    this.U = {
      uT: { value: 0 }, uReveal: { value: 0 }, uOrigin: { value: new THREE.Vector2(0, 0) }, uTintR: { value: 0 }, uTintO: { value: new THREE.Vector2() },
      ...paletteUniforms('A', T), ...paletteUniforms('B', T),
      uScan: { value: -1e5 }, uScanDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
      uClip: { value: new THREE.Vector4(-1e5, -1e5, 1e5, 1e5) }, uFade: { value: 1 },
      uFocus: { value: new THREE.Vector2() }, uFocusR: { value: 1e5 }, uPx: { value: 1 }, uCircle: { value: new THREE.Vector3(0, 0, 0) }, uRT: { value: 0 },
    };
    this.offTheme = MZ.theme.on(() => this.retint());
  }
  async init() {
    const G = this.grid = await loadGrid(this.o.res);
    const U = this.U, ext = G.extent;
    const colMat = new THREE.ShaderMaterial({ vertexShader: COL_VS, fragmentShader: COL_FS, toneMapped: false,
      uniforms: { ...U, uRes: { value: G.res }, uGap: { value: this.o.gap ?? 0.64 }, uVExag: { value: this.o.vexag }, uSlab: { value: G.res * 0.7 } } });
    this.cols = new THREE.Mesh(G.geo, colMat); this.cols.frustumCulled = false; this.scene.add(this.cols);
    const W = ext.xmax - ext.xmin, D = ext.zmax - ext.zmin;
    const gMat = new THREE.ShaderMaterial({ vertexShader: GROUND_VS, fragmentShader: GROUND_FS, transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { ...U, uData: { value: G.tex }, uGrid: { value: new THREE.Vector2(G.cols, G.rows) }, uExt: { value: new THREE.Vector4(ext.xmin, ext.zmin, ext.xmax, ext.zmax) }, uRes: { value: G.res }, uDotSize: { value: 0.62 } } });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, D), gMat); plane.rotation.x = -Math.PI / 2; plane.position.set(ext.xmin + W / 2, 0, ext.zmin + D / 2);
    plane.renderOrder = -1; this.ground = plane; this.scene.add(plane);
    // beacons (up to 48): vertical light + ground ring, both additive
    const MAX = 48; this.MAXB = MAX;
    const q = new THREE.PlaneGeometry(1, 1); q.translate(0.5, 0.5, 0);
    const bg = new THREE.InstancedBufferGeometry(); bg.index = q.index; bg.setAttribute('position', q.attributes.position); bg.setAttribute('uv', q.attributes.uv);
    this.bA = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); this.bC = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.bA.setUsage(THREE.DynamicDrawUsage); this.bC.setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('aB', this.bA); bg.setAttribute('aC', this.bC); bg.instanceCount = 0;
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };
    this.beacons = new THREE.Mesh(bg, new THREE.ShaderMaterial({ vertexShader: BEACON_VS, fragmentShader: BEACON_FS, uniforms: { ...U, uWidth: { value: this.o.beaconWidth } }, ...add, depthTest: false }));
    this.beacons.frustumCulled = false; this.beacons.renderOrder = 5;
    const rq = new THREE.PlaneGeometry(2, 2);
    const rg = new THREE.InstancedBufferGeometry(); rg.index = rq.index; rg.setAttribute('position', rq.attributes.position); rg.setAttribute('uv', rq.attributes.uv);
    rg.setAttribute('aB', this.bA); rg.setAttribute('aC', this.bC); rg.instanceCount = 0;
    this.rings = new THREE.Mesh(rg, new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, uniforms: { ...U, uRingPx: { value: this.o.ringPx } }, ...add, depthTest: false }));
    this.rings.frustumCulled = false; this.rings.renderOrder = 4;
    this.scene.add(this.rings, this.beacons);
    if (this.o.matrix) this._initMatrix(gMat);
    this.ready = true;
    return this;
  }

  // ---------------------------------------------------------------- two-pass dot-matrix mode (JUICE.md §1.1)
  // Pass 1: the city (+ beacons) into a low-res target, one texel = one dot (rgb = shaded colour, a = glow).
  // Pass 2: a full-screen lattice — every cell draws an axis-aligned square whose size follows brightness,
  // unlit cells a faint LED; bloom from the target's mip chain. The lattice is screen-fixed, so rotating or
  // panning makes the city re-scan through it like a display.
  _initMatrix(gMat) {
    gMat.transparent = false; gMat.blending = THREE.NoBlending; gMat.depthWrite = true;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true, depthBuffer: true });
    const T = this.MZ.theme.c;
    this.MU = { uCity: { value: this.rt.texture }, uOrigin: { value: new THREE.Vector2() }, uPitch: { value: 5 }, uTex: { value: new THREE.Vector2(4, 4) },
      uLed: { value: T.dotLow }, uLumHigh: { value: 0.5 }, uBloom: { value: 1 }, uVp: { value: new THREE.Vector4(0, 0, 1, 1) }, uFade: this.U.uFade };
    const mat = new THREE.ShaderMaterial({ vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: MATRIX_FS, uniforms: this.MU, depthTest: false, depthWrite: false, toneMapped: false, transparent: true, blending: THREE.NormalBlending });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
    this.mscene = new THREE.Scene(); this.mscene.add(quad);
    this.mcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  /** Add this map to the stage (the right scene for the mode). viewport: () => {x, y, w, h} CSS px or null. */
  attach(stage, { order = 20, viewport = null } = {}) {
    this._vpFn = viewport; this._stage = stage;
    this.layer = this.o.matrix ? stage.addLayer({ scene: this.mscene, camera: this.mcam, order, viewport }) : stage.addLayer({ scene: this.scene, camera: this.camera, order, viewport });
    return this.layer;
  }
  _renderMatrix() {
    const st = this._stage, r = st?.renderer; if (!r || !this.layer?.visible) return;
    const dpr = st.size.dpr || 1, vp = this._vpFn?.() || { x: 0, y: 0, w: st.size.w, h: st.size.h };
    const W = Math.round(vp.w * dpr), H = Math.round(vp.h * dpr);
    const pitch = Math.max(3, Math.round((this.o.dot || 5) * H / 1080));   // lattice pitch in px (o.pitch is the camera elevation)
    const cols = Math.ceil(W / pitch), rows = Math.ceil(H / pitch);
    if (this.rt.width !== cols || this.rt.height !== rows) this.rt.setSize(cols, rows);
    // frustum for the target: same world-per-pixel as the view, anchored at the viewport's bottom-left
    const c = this.camera, L = c.left, R = c.right, B = c.bottom, Tp = c.top, wpp = (Tp - B) / H;
    c.right = L + cols * pitch * wpp; c.top = B + rows * pitch * wpp; c.updateProjectionMatrix();
    const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha(), prevRT = r.getRenderTarget(), prevTM = r.toneMapping;
    this.U.uRT.value = 1; r.setRenderTarget(this.rt); r.setClearColor(0x000000, 0); r.clear(); r.render(this.scene, c); r.setRenderTarget(prevRT);
    r.setClearColor(cc, ca); this.U.uRT.value = 0;
    c.right = R; c.top = Tp; c.updateProjectionMatrix();
    const M = this.MU; M.uPitch.value = pitch; M.uTex.value.set(cols, rows);
    M.uOrigin.value.set(Math.round(vp.x * dpr), Math.round((st.size.h - vp.y - vp.h) * dpr));
    M.uVp.value.set(M.uOrigin.value.x, M.uOrigin.value.y, W, H);
    M.uLumHigh.value = Math.max(0.05, 0.2126 * this.U.uHighB.value.r + 0.7152 * this.U.uHighB.value.g + 0.0722 * this.U.uHighB.value.b);
  }
  destroy() { this.offTheme?.(); this.layer?.remove(); this.rt?.dispose(); this.cols?.material.dispose(); this.ground?.material.dispose(); this.ground?.geometry.dispose(); }

  // ---- view
  /** Reveal ripple from a world point (defaults to the view target). */
  reveal(x = this.target.x, z = this.target.z, instant = false) { this.U.uOrigin.value.set(x, z); this.revealT = instant ? 1e5 : 0; }
  rotate(steps) { this.yawGoal += steps * Math.PI / 2; }
  setZoom(z) { this.zoomGoal = THREE.MathUtils.clamp(z, 0.6, 9); }
  pan(dx, dz) { this.targetGoal.x += dx; this.targetGoal.z += dz; this._clampTarget(); }
  lookAt(x, z, instant = false) { this.targetGoal.set(x, 0, z); this._clampTarget(); if (instant) this.target.copy(this.targetGoal); }
  _clampTarget() { const e = this.grid?.extent; if (!e) return; this.targetGoal.x = THREE.MathUtils.clamp(this.targetGoal.x, e.xmin + 200, e.xmax - 200); this.targetGoal.z = THREE.MathUtils.clamp(this.targetGoal.z, e.zmin + 200, e.zmax - 200); }
  /** Screen-space pan: dx, dy in -1..1 of the view → world delta along the rotated iso axes. */
  /** Screen-space pan: dx right, dy UP, in fractions of the view height → world move on the ground. */
  panScreen(dx, dy, k = 1) {
    const s = this.viewH / this.zoom * k, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const fy = dy / Math.sin(THREE.MathUtils.degToRad(this.o.pitch));      // ground is foreshortened on screen
    this.pan((dx * cy - fy * sy) * s, (-dx * sy - fy * cy) * s);
  }
  retint(ripple = true) {
    const T = this.MZ.theme.palette(this.MZ.theme.id), U = this.U;
    // current blend becomes the new A, target palette = B, ring grows from the player/target
    if (this.tintActive) for (const k of ['Low', 'Mid', 'High', 'Glow', 'Acc']) U['u' + k + 'A'].value.lerp(U['u' + k + 'B'].value, 0.5);
    else for (const k of ['Low', 'Mid', 'High', 'Glow', 'Acc']) U['u' + k + 'A'].value.copy(U['u' + k + 'B'].value);
    U.uLowB.value.copy(T.dotLow); U.uMidB.value.copy(T.dotMid); U.uHighB.value.copy(T.dotHigh); U.uGlowB.value.copy(T.glow); U.uAccB.value.copy(T.accent);
    U.uTintO.value.copy(this.tintOrigin || new THREE.Vector2(this.target.x, this.target.z));
    this.tintR = ripple ? 0 : 1e5; this.tintActive = true;
  }
  resize(w, h) { this.aspect = w / h; this.pxH = h; }
  /** World → screen px (relative to the viewport this map is drawn in). */
  project(x, y, z, w, h, out = {}) {
    const v = this._v || (this._v = new THREE.Vector3()); v.set(x, y, z).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * w; out.y = (-v.y * 0.5 + 0.5) * h; out.vis = v.z < 1 && v.z > -1; return out;
  }
  /** Screen centre → ground point. */
  groundAtCenter() { return { x: this.target.x, z: this.target.z }; }

  /** beacons: [{x, z, h, kind (0 base,1 landmark,2 waypoint,3 player,4 ping), color THREE.Color, phase}] */
  setBeacons(list) {
    if (!this.ready) return;
    const n = Math.min(list.length, this.MAXB), A = this.bA.array, C = this.bC.array;
    for (let i = 0; i < n; i++) { const b = list[i]; A.set([b.x, b.z, b.h, b.kind], i * 4); C.set([b.color.r, b.color.g, b.color.b, b.phase ?? i * 0.137], i * 4); }
    this.bA.needsUpdate = this.bC.needsUpdate = true;
    this.beacons.geometry.instanceCount = this.rings.geometry.instanceCount = n;
  }

  update(dt, t) {
    if (!this.ready) return;
    const U = this.U, k = 1 - Math.exp(-8 * dt);
    this.yaw += (this.yawGoal - this.yaw) * (1 - Math.exp(-9 * dt));
    if (this.o.auto) { this.yawGoal += dt * this.o.auto; }
    this.zoom += (this.zoomGoal - this.zoom) * (1 - Math.exp(-7 * dt));
    this.target.lerp(this.targetGoal, k);
    const pitch = THREE.MathUtils.degToRad(this.o.pitch), dist = 6000;
    const c = this.camera;
    c.position.set(this.target.x + Math.sin(this.yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, this.target.z + Math.cos(this.yaw) * Math.cos(pitch) * dist);
    c.up.set(0, 1, 0); c.lookAt(this.target);
    const hh = this.viewH / this.zoom / 2;
    // centerX: where the view target sits horizontally (0.5 = middle), so a side panel can own part of the screen
    const A = hh * this.aspect, sh = (2 * (this.centerX ?? 0.5) - 1) * A;
    c.left = -A - sh; c.right = A - sh; c.top = hh; c.bottom = -hh; c.updateProjectionMatrix();
    U.uPx.value = (hh * 2) / (this.pxH || 1000);          // world metres per screen pixel
    U.uT.value = t;
    this.revealT += dt * this.revealSpeed; U.uReveal.value = this.revealT;
    this.scanT += dt; const period = this.scanEvery;
    const ph = (this.scanT % period) / 2.2; U.uScan.value = ph < 1 ? THREE.MathUtils.lerp(-3600, 3600, ph) : -1e5;
    if (this.tintActive) { this.tintR += dt * 2600; U.uTintR.value = this.tintR; if (this.tintR > 7000) { this.tintActive = false; U.uTintR.value = 1e5; } }
    U.uFade.value = this.fade;
    U.uFocus.value.set(this.target.x, this.target.z);
    if (this.o.matrix) this._renderMatrix();
  }
}
/** Warm the grid data (fetch + decode + instance buffer) so a later DotMap.init() is instant. */
export function preloadGrid(res = 16) { return loadGrid(res).catch(() => null); }
export { CLS };
