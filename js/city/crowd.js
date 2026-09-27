// Pedestrians (LOOK-AUDIT S3 — people are the #2 human-scale cue; the city read "small next to the heroes"
// because nothing on the street was person-sized). Real NEXT bodies (Peter 1.74 m, Tony 1.86 m, decimated to
// ~1100 triangles by next/blender/city/build_crowd.py, still skinned) play the canonical human walk/idle clips
// ONCE at load; the skinned vertices are baked into a vertex-animation texture (VAT). Thousands of instances
// then walk around their block's sidewalk entirely on the GPU: position along the loop, heading, walk frame
// and garment colours come from per-instance attributes + uTime. Zero CPU per frame except chunk culling.
// Not solid (like traffic): no colliders.
import * as THREE from 'three';
import { U, patchGeneric } from './materials.js';
import { NearCrowd } from './crowd_npc.js';

const WALK_FRAMES = 24, IDLE_FRAMES = 12;
// Near NPC clip set (crowd_npc.js). Rows 0..35 stay walk + idle so the far GPU crowd reads the same texture.
// [name, library ('h' = human_core(_174), 'e' = enemy_core — same canonical skeleton), source clip, frames, loop]
export const NPC_CLIPS = [
  ['walk', 'h', 'human_walk', WALK_FRAMES, true], ['idle', 'h', 'human_idle', IDLE_FRAMES, true],
  ['run', 'e', 'run', 16, true], ['look', 'e', 'look_around', 24, true], ['stagger', 'e', 'stagger', 20, false],
  ['hit', 'e', 'hit_back', 10, false], ['knock', 'e', 'knockdown', 18, false], ['getup', 'e', 'getup', 26, false],
  ['coverIn', 'e', 'cover_enter', 8, false], ['cover', 'e', 'cover_idle', 16, true], ['surrender', 'e', 'surrender', 16, true],
  ['alert', 'e', 'alert', 16, false], ['photo', 'h', 'human_summon_gesture', 18, false], ['turn', 'h', 'human_turn_L', 12, false],
];
const STRIDE = 1.42;          // metres per walk cycle (1 s clip): a 1.3-1.5 m/s stroll without foot slide
// crowd shadows: off until verified on the HP (D3D11) — ?crowdShadow=1 turns them on
const CROWD_SHADOW = typeof location !== 'undefined' && new URLSearchParams(location.search).get('crowdShadow') === '1';
const NPC = typeof location !== 'undefined' && new URLSearchParams(location.search).get('npc') === '1';   // WIP: near CPU NPCs behind ?npc=1 until tested
const CHUNK = 120, DRAW = 280, SHADOW = 40, LOD0 = 40;   // LOD0 = 1100 tris near, LOD1 = 220 tris beyond
const DENSITY = { midtown: 5.5, downtown: 6, row: 7, parkside: 11, village: 8, uptown: 12, waterfront: 14 };   // metres of lane per person

// muted NYC wardrobe (linear-ish sRGB)
const TOPS = [0x111214, 0x1c1d22, 0x2a2d33, 0x1d2a44, 0x3d4250, 0x6b6e73, 0x9a958c, 0xc9c3b6, 0xe8e6e1, 0x4a4f36, 0x5b2226, 0x7b5a3a, 0x2f4a6b, 0x8a1f1f, 0xb58d3d, 0x304030];
const BOTS = [0x15171c, 0x1f2633, 0x283552, 0x39455e, 0x2b2b2b, 0x4c4c4c, 0x6f6553, 0x8c7f66, 0x1a1a1a];

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pickC = (r, a) => new THREE.Color(a[Math.floor(r() * a.length)]);

export class Crowd {
  constructor(ctx, cr) { this.ctx = ctx; this.cr = cr; this.group = new THREE.Group(); this.group.name = 'city_crowd'; this.chunks = []; this.count = 0; }

  async load(layout) {
    const ctx = this.ctx;
    const meta = await fetch(ctx.url('assets/city/crowd/crowd.json')).then(r => r.json());
    const bodies = [];
    for (const b of meta.bodies) {
      const [g, g1, lib, elib] = await Promise.all([ctx.load('assets/city/crowd/' + b.file), ctx.load('assets/city/crowd/' + b.lod1.file),
        ctx.load('assets/' + b.clips), ctx.load('assets/anims/enemy_core.glb').catch(() => null)]);
      const find = (L, n) => (L === 'h' ? lib.animations : elib?.animations || []).find(c => c.name === n) || null;
      const full = NPC_CLIPS.map(([id, L, n, f, loop]) => ({ id, clip: find(L, n) || (id === 'run' ? find('h', 'human_run') : null), frames: f, loop }));
      bodies.push([this.bake(g, full, b.name), this.bake(g1, full.slice(0, 2), b.name + '1')]);
    }
    this.bodies = bodies;
    this.place(layout);
    if (NPC) { try { this.near = new NearCrowd(this); } catch (e) { console.warn('[crowd] near NPCs failed', e); } }
    return this;
  }

  /** Skinned body + clips -> merged geometry (aVid, aSlot) + VAT textures (positions RGBA32F, normals RGBA8). */
  bake(g, list, name) {
    const root = g.scene;
    const skinned = []; root.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
    const slotOf = m => { const k = /slot_(\d)/.exec(m?.name || ''); return k ? +k[1] : 1; };
    // merged static topology
    let nv = 0; const parts = skinned.map(s => { const p = { s, base: nv, n: s.geometry.attributes.position.count, slot: slotOf(s.material) }; nv += p.n; return p; });
    const idx = [], vid = new Float32Array(nv), slot = new Float32Array(nv);
    for (const p of parts) {
      for (let i = 0; i < p.n; i++) { vid[p.base + i] = p.base + i; slot[p.base + i] = p.slot; }
      const ia = p.s.geometry.index; for (let i = 0; i < ia.count; i++) idx.push(ia.getX(i) + p.base);
    }
    const frames = list.reduce((a, c) => a + c.frames, 0);
    const pos = new Uint16Array(nv * frames * 4), nrm = new Uint8Array(nv * frames * 4);   // half-float positions
    const H = THREE.DataUtils.toHalfFloat, rows = {};
    const mixer = new THREE.AnimationMixer(root), v = new THREE.Vector3(), rootNode = root.getObjectByName('piv_root');
    const tmp = new THREE.BufferGeometry(); tmp.setIndex(idx);
    const fp = new Float32Array(nv * 3); tmp.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    let row = 0, maxY = 0;
    for (const { id, clip, frames: n, loop } of list) {
      rows[id] = { row0: row, count: n, dur: clip ? clip.duration : 1, loop };
      mixer.stopAllAction();
      const act = clip ? mixer.clipAction(clip) : null; act?.play();
      for (let f = 0; f < n; f++, row++) {
        mixer.setTime(clip ? clip.duration * (loop ? f / n : f / Math.max(1, n - 1)) * 0.999 : 0);
        root.updateMatrixWorld(true);
        const rp = rootNode ? rootNode.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
        for (const p of parts) {
          p.s.skeleton.update();
          for (let i = 0; i < p.n; i++) {
            p.s.getVertexPosition(i, v); v.applyMatrix4(p.s.matrixWorld);
            v.x -= rp.x; v.z -= rp.z;                       // in place: the instance moves the body
            const k = p.base + i; fp[k * 3] = v.x; fp[k * 3 + 1] = v.y; fp[k * 3 + 2] = v.z;
            maxY = Math.max(maxY, v.y);
          }
        }
        tmp.computeVertexNormals();
        const na = tmp.attributes.normal.array;
        for (let k = 0; k < nv; k++) {
          const o = (row * nv + k) * 4;
          pos[o] = H(fp[k * 3]); pos[o + 1] = H(fp[k * 3 + 1]); pos[o + 2] = H(fp[k * 3 + 2]); pos[o + 3] = H(1);
          nrm[o] = (na[k * 3] * 0.5 + 0.5) * 255; nrm[o + 1] = (na[k * 3 + 1] * 0.5 + 0.5) * 255; nrm[o + 2] = (na[k * 3 + 2] * 0.5 + 0.5) * 255; nrm[o + 3] = 255;
        }
      }
    }
    const tp = new THREE.DataTexture(pos, nv, frames, THREE.RGBAFormat, THREE.HalfFloatType); tp.needsUpdate = true;
    const tn = new THREE.DataTexture(nrm, nv, frames, THREE.RGBAFormat, THREE.UnsignedByteType); tn.needsUpdate = true;
    const geo = new THREE.BufferGeometry();
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(fp.slice(), 3));    // unused by the shader (bounds only)
    geo.setAttribute('aVid', new THREE.BufferAttribute(vid, 1));
    geo.setAttribute('aSlot', new THREE.BufferAttribute(slot, 1));
    return { name, geo, tp, tn, nv, height: maxY, rows };
  }

  /** Sidewalk lanes from the blocks: axis-aligned rectangles become loops (people turn the corners), anything
   *  else (Broadway wedges, the island edge) becomes one ping-pong segment per edge. */
  place(layout) {
    const r = rng(20260926);
    const items = [];
    const park = layout.park?.rect ? (() => { const xs = layout.park.rect.map(p => p[0]), zs = layout.park.rect.map(p => p[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; })() : null;
    for (const b of layout.blocks || []) {
      const P = b.poly; if (!P || P.length < 3) continue;
      const dens = DENSITY[b.district] || 10;
      const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      if (park && (x0 + x1) / 2 > park[0] && (x0 + x1) / 2 < park[2] && (z0 + z1) / 2 > park[1] && (z0 + z1) / 2 < park[3]) continue;
      const rect = P.length === 4 && P.every(p => (Math.abs(p[0] - x0) < 0.05 || Math.abs(p[0] - x1) < 0.05) && (Math.abs(p[1] - z0) < 0.05 || Math.abs(p[1] - z1) < 0.05));
      const add = (mode, seg, len) => {
        const n = Math.max(1, Math.round(len / dens * (0.75 + 0.5 * r())));
        for (let i = 0; i < n; i++) {
          const lane = 1.5 + r() * 2.7;                               // metres in from the curb (props stand at ~0.6-1 m)
          const idle = r() < 0.12;
          const sp = idle ? 0 : (1.05 + r() * 0.55) * (r() < 0.5 ? -1 : 1);
          items.push({ mode, seg, lane, u0: r() * len, sp, body: r() < 0.5 ? 0 : 1, r: r(), cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 });
        }
      };
      if (rect) add(1, [(x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2], 2 * (x1 - x0 + z1 - z0));
      else {
        const c = [xs.reduce((a, v) => a + v, 0) / P.length, zs.reduce((a, v) => a + v, 0) / P.length];
        for (let i = 0; i < P.length; i++) {
          const a = P[i], bb = P[(i + 1) % P.length], L = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
          if (L < 12) continue;
          // shorten by the lane inset at both ends so ping-pong turns happen on the sidewalk, not in the road
          const ux = (bb[0] - a[0]) / L, uz = (bb[1] - a[1]) / L, m = 5;
          add(0, [a[0] + ux * m, a[1] + uz * m, bb[0] - ux * m, bb[1] - uz * m, c[0], c[1]], L - 2 * m);
        }
      }
    }
    // chunks -> one InstancedMesh per (chunk, body)
    const byKey = new Map();
    for (const it of items) { const k = Math.floor(it.cx / CHUNK) + ',' + Math.floor(it.cz / CHUNK) + '|' + it.body; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(it); }
    this.mats = this.bodies.map(L => L.map(B => this.material(B)));
    for (const [k, list] of byKey) {
      const bi = +k.split('|')[1], B = this.bodies[bi][0], n = list.length;
      const A = (sz) => new Float32Array(n * sz);
      const seg = A(4), seg2 = A(2), walk = A(4), c0 = A(4), c1 = A(4);
      let mx = 1e9, Mx = -1e9, mz = 1e9, Mz = -1e9;
      list.forEach((it, i) => {
        const rr = rng(Math.floor(it.r * 1e9));
        seg.set(it.seg.slice(0, 4), i * 4); seg2.set([it.seg[4] ?? 0, it.seg[5] ?? 0], i * 2);
        const sc = bi === 1 ? 0.9 + rr() * 0.1 : 0.88 + rr() * 0.14;
        walk.set([it.u0, it.sp, sc, Math.min(0.999, rr()) + (it.mode ? 10 : 0) + Math.round(it.lane * 10) * 100], i * 4);
        const top = pickC(rr, TOPS), bot = pickC(rr, BOTS), sk = Math.floor(rr() * 6), hr = Math.floor(rr() * 7);
        c0.set([top.r, top.g, top.b, sk + hr * 8], i * 4);
        c1.set([bot.r, bot.g, bot.b, rr()], i * 4);
        const px = it.mode ? [it.seg[0] - it.seg[2], it.seg[0] + it.seg[2]] : [Math.min(it.seg[0], it.seg[2]), Math.max(it.seg[0], it.seg[2])];
        const pz = it.mode ? [it.seg[1] - it.seg[3], it.seg[1] + it.seg[3]] : [Math.min(it.seg[1], it.seg[3]), Math.max(it.seg[1], it.seg[3])];
        mx = Math.min(mx, px[0]); Mx = Math.max(Mx, px[1]); mz = Math.min(mz, pz[0]); Mz = Math.max(Mz, pz[1]);
      });
      const IA = (arr, sz) => new THREE.InstancedBufferAttribute(arr, sz);
      const attrs = { aSeg: IA(seg, 4), aSeg2: IA(seg2, 2), aWalk: IA(walk, 4), aC0: IA(c0, 4), aC1: IA(c1, 4) };
      const center = new THREE.Vector3((mx + Mx) / 2, 1, (mz + Mz) / 2), radius = Math.hypot(Mx - mx, Mz - mz) / 2 + 3;
      const meshes = [0, 1].map(lod => {
        const g = this.bodies[bi][lod].geo.clone();
        for (const [a, v] of Object.entries(attrs)) g.setAttribute(a, v);
        const M = this.mats[bi][lod], im = new THREE.InstancedMesh(g, M.mat, n);
        im.customDepthMaterial = M.depth;
        im.name = 'crowd_' + k + '_lod' + lod; im.layers.set(1); im.userData.collider = 'crowd (people are not solid)'; im.userData.noCollide = true;
        im.frustumCulled = true; im.receiveShadow = true; im.castShadow = false; im.visible = false;
        im.boundingSphere = new THREE.Sphere(center, radius);
        this.group.add(im);
        return im;
      });
      this.chunks.push({ meshes, center, radius, n, items: list, walk, c0, c1, attrs, bi });
      this.count += n;
    }
  }

  material(B, direct = false) {
    const common = /* glsl */`
      uniform sampler2D uVatPos, uVatNrm; uniform float uCrowdTime;
      attribute float aVid, aSlot; attribute vec4 aC0, aC1;
      varying vec3 vPedCol; varying float vPedRough;
      bool bad3p(vec3 v) { return any(greaterThan(abs(v), vec3(1e5))) || ((floatBitsToUint(v.x) & 0x7f800000u) == 0x7f800000u) || ((floatBitsToUint(v.y) & 0x7f800000u) == 0x7f800000u) || ((floatBitsToUint(v.z) & 0x7f800000u) == 0x7f800000u); }
      vec3 rowFetch(sampler2D tx, float row) { return texelFetch(tx, ivec2(int(aVid), int(row + 0.5)), 0).xyz; }`;
    // near NPCs (crowd_npc.js): the CPU gives position, heading and two crossfaded clip samples per instance
    const vertDirect = common + /* glsl */`
      attribute vec4 aPos, aAnA, aAnB;
      vec3 skinC(float i){ return i < 0.5 ? vec3(0.87,0.58,0.40) : i < 1.5 ? vec3(0.75,0.42,0.25) : i < 2.5 ? vec3(0.56,0.26,0.13) : i < 3.5 ? vec3(0.33,0.14,0.06) : i < 4.5 ? vec3(0.16,0.06,0.03) : vec3(0.07,0.03,0.015); }
      vec3 hairC(float i){ return i < 0.5 ? vec3(0.004) : i < 1.5 ? vec3(0.013,0.007,0.004) : i < 2.5 ? vec3(0.045,0.02,0.008) : i < 3.5 ? vec3(0.14,0.07,0.024) : i < 4.5 ? vec3(0.32,0.2,0.08) : i < 5.5 ? vec3(0.25,0.24,0.22) : vec3(0.68,0.53,0.27); }`;
    const vmainDirect = /* glsl */`
      vec3 pedW = aPos.xyz; float pedH = aPos.w;
      vec3 lp = mix(mix(rowFetch(uVatPos, aAnA.x), rowFetch(uVatPos, aAnA.y), aAnA.z), mix(rowFetch(uVatPos, aAnB.x), rowFetch(uVatPos, aAnB.y), aAnB.z), aAnA.w) * aAnB.w;
      vec3 ln = mix(mix(rowFetch(uVatNrm, aAnA.x), rowFetch(uVatNrm, aAnA.y), aAnA.z), mix(rowFetch(uVatNrm, aAnB.x), rowFetch(uVatNrm, aAnB.y), aAnB.z), aAnA.w) * 2.0 - 1.0;
      float cs = cos(pedH), sn = sin(pedH);
      mat3 R = mat3(cs, 0.0, -sn, 0.0, 1.0, 0.0, sn, 0.0, cs);`;
    const vert = /* glsl */`
      uniform sampler2D uVatPos, uVatNrm; uniform float uCrowdTime;
      attribute float aVid, aSlot; attribute vec4 aSeg, aWalk, aC0, aC1; attribute vec2 aSeg2;
      varying vec3 vPedCol; varying float vPedRough;
      vec3 skinC(float i){ return i < 0.5 ? vec3(0.87,0.58,0.40) : i < 1.5 ? vec3(0.75,0.42,0.25) : i < 2.5 ? vec3(0.56,0.26,0.13) : i < 3.5 ? vec3(0.33,0.14,0.06) : i < 4.5 ? vec3(0.16,0.06,0.03) : vec3(0.07,0.03,0.015); }
      vec3 hairC(float i){ return i < 0.5 ? vec3(0.004) : i < 1.5 ? vec3(0.013,0.007,0.004) : i < 2.5 ? vec3(0.045,0.02,0.008) : i < 3.5 ? vec3(0.14,0.07,0.024) : i < 4.5 ? vec3(0.32,0.2,0.08) : i < 5.5 ? vec3(0.25,0.24,0.22) : vec3(0.68,0.53,0.27); }
      void pedPose(out vec3 wp, out float hd, out float fr) {
        float u0 = aWalk.x, sp = aWalk.y, lane = floor(aWalk.w / 100.0) / 10.0, mode = step(9.5, mod(aWalk.w, 100.0));
        float ph = fract(aWalk.w);
        float s = u0 + sp * uCrowdTime;
        vec2 p; vec2 t;
        if (mode > 0.5) {                                   // loop around the block (a rectangle, lane metres inside the curb)
          float hx = aSeg.z - lane, hz = aSeg.w - lane;
          float P = 4.0 * (hx + hz); float q = mod(s, P);
          if (q < 2.0 * hx) { p = vec2(-hx + q, -hz); t = vec2(1.0, 0.0); }
          else if (q < 2.0 * (hx + hz)) { q -= 2.0 * hx; p = vec2(hx, -hz + q); t = vec2(0.0, 1.0); }
          else if (q < 4.0 * hx + 2.0 * hz) { q -= 2.0 * (hx + hz); p = vec2(hx - q, hz); t = vec2(-1.0, 0.0); }
          else { q -= 4.0 * hx + 2.0 * hz; p = vec2(-hx, hz - q); t = vec2(0.0, -1.0); }
          p += aSeg.xy;
        } else {                                            // ping-pong along one edge, offset towards the block centre
          vec2 a = aSeg.xy, b = aSeg.zw; float L = max(length(b - a), 1e-3); vec2 d = (b - a) / L;
          vec2 nIn = vec2(-d.y, d.x); if (dot(aSeg2 - a, nIn) < 0.0) nIn = -nIn;
          float q = mod(s, 2.0 * L); float fw = step(q, L); float x = fw > 0.5 ? q : 2.0 * L - q;
          p = a + d * x + nIn * lane; t = d * (fw > 0.5 ? 1.0 : -1.0);
        }
        if (sp < 0.0) t = -t;
        if (abs(sp) < 0.01) {                               // standing: face the street (or chat along the walk)
          t = ph < 0.5 ? vec2(sin(ph * 40.0), cos(ph * 40.0)) : t;
          fr = ${WALK_FRAMES}.0 + fract(ph + uCrowdTime / 4.0) * ${IDLE_FRAMES}.0;
        } else fr = fract(ph + abs(sp) * uCrowdTime / ${STRIDE}) * ${WALK_FRAMES}.0;
        wp = vec3(p.x, 0.15, p.y); hd = atan(t.x, t.y);
      }
      bool bad3p(vec3 v) { return any(greaterThan(abs(v), vec3(1e5))) || ((floatBitsToUint(v.x) & 0x7f800000u) == 0x7f800000u) || ((floatBitsToUint(v.y) & 0x7f800000u) == 0x7f800000u) || ((floatBitsToUint(v.z) & 0x7f800000u) == 0x7f800000u); }
      vec3 vatFetch(sampler2D tx, float fr, float cnt0, float cnt) {
        float f0 = floor(fr), k = fr - f0; float f1 = f0 + 1.0; if (f1 >= cnt0 + cnt) f1 = cnt0;
        vec3 a = texelFetch(tx, ivec2(int(aVid), int(f0)), 0).xyz, b = texelFetch(tx, ivec2(int(aVid), int(f1)), 0).xyz;
        return mix(a, b, k);
      }`;
    const vmain = /* glsl */`
      vec3 pedW; float pedH, pedF; pedPose(pedW, pedH, pedF);
      float c0 = pedF < ${WALK_FRAMES}.0 ? 0.0 : ${WALK_FRAMES}.0, cn = pedF < ${WALK_FRAMES}.0 ? ${WALK_FRAMES}.0 : ${IDLE_FRAMES}.0;
      vec3 lp = vatFetch(uVatPos, pedF, c0, cn) * aWalk.z;
      vec3 ln = vatFetch(uVatNrm, pedF, c0, cn) * 2.0 - 1.0;
      float cs = cos(pedH), sn = sin(pedH);
      mat3 R = mat3(cs, 0.0, -sn, 0.0, 1.0, 0.0, sn, 0.0, cs);`;
    const mk = (depth) => {
      const m = depth ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }) : new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
      m.name = depth ? 'city_crowd_depth' : 'city_crowd';
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        prev?.call(m, sh, r);
        sh.uniforms.uVatPos = { value: B.tp }; sh.uniforms.uVatNrm = { value: B.tn }; sh.uniforms.uCrowdTime = U.uTime;
        const VM = direct ? vmainDirect : vmain;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + (direct ? vertDirect : vert));
        if (depth) sh.vertexShader = sh.vertexShader.replace('void main() {', 'void main() {\n' + VM);
        else sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', VM + '\nvec3 objectNormal = normalize(R * ln);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(1.0,0.0,0.0);\n#endif');
        sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = R * lp + pedW;
            if (bad3p(transformed)) transformed = vec3(0.0, -2000.0, 0.0);   // never a stray huge triangle (D3D11)
            { float sl = aSlot, sk = mod(aC0.w, 8.0), hr = floor(aC0.w / 8.0);
              vPedCol = sl < 0.5 ? skinC(sk) : sl < 1.5 ? aC0.rgb : sl < 2.5 ? aC1.rgb : sl < 3.5 ? (aC1.a < 0.6 ? vec3(0.02) : vec3(0.7, 0.68, 0.64)) : sl < 4.5 ? hairC(hr) : aC0.rgb * 0.45 + 0.18 * aC1.a;
              vPedRough = sl < 0.5 ? 0.55 : sl < 2.5 ? 0.9 : sl < 3.5 ? 0.5 : 0.6; }`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPedCol; varying float vPedRough;');
        if (!depth) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = vPedCol;')
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPedRough;');
      };
      m.customProgramCacheKey = () => 'crowd' + (direct ? 'N' : '') + (depth ? 'D' : '') + B.name;
      return m;
    };
    const mat = mk(false);
    patchGeneric(mat);                 // city fog + night uniforms; chained after our hook
    this.cr.addMaterial(mat);           // CSM (receives sun shadows)
    return { mat, depth: mk(true) };
  }

  /** The GPU pose of far instance i of chunk c at time t — the exact JS twin of pedPose() (promotion to a CPU NPC). */
  poseOf(c, i, t) {
    const it = c.items[i], w = c.walk, o = i * 4;
    const u0 = w[o], sp = w[o + 1], W = w[o + 3];
    const lane = Math.floor(W / 100) / 10, mode = (W % 100) >= 9.5 ? 1 : 0, ph = W - Math.floor(W);
    const s = u0 + sp * t, seg = it.seg;
    let px, pz, tx, tz;
    const mod = (a, b) => a - b * Math.floor(a / b);
    if (mode) {
      const hx = seg[2] - lane, hz = seg[3] - lane, P = 4 * (hx + hz); let q = mod(s, P);
      if (q < 2 * hx) { px = -hx + q; pz = -hz; tx = 1; tz = 0; }
      else if (q < 2 * (hx + hz)) { q -= 2 * hx; px = hx; pz = -hz + q; tx = 0; tz = 1; }
      else if (q < 4 * hx + 2 * hz) { q -= 2 * (hx + hz); px = hx - q; pz = hz; tx = -1; tz = 0; }
      else { q -= 4 * hx + 2 * hz; px = -hx; pz = hz - q; tx = 0; tz = -1; }
      px += seg[0]; pz += seg[1];
    } else {
      const ax = seg[0], az = seg[1], bx = seg[2], bz = seg[3], L = Math.max(Math.hypot(bx - ax, bz - az), 1e-3), dx = (bx - ax) / L, dz = (bz - az) / L;
      let nx = -dz, nz = dx; if ((seg[4] - ax) * nx + (seg[5] - az) * nz < 0) { nx = -nx; nz = -nz; }
      const q = mod(s, 2 * L), fw = q <= L, x = fw ? q : 2 * L - q;
      px = ax + dx * x + nx * lane; pz = az + dz * x + nz * lane; tx = fw ? dx : -dx; tz = fw ? dz : -dz;
    }
    if (sp < 0) { tx = -tx; tz = -tz; }
    let phase;
    if (Math.abs(sp) < 0.01) { if (ph < 0.5) { tx = Math.sin(ph * 40); tz = Math.cos(ph * 40); } phase = mod(ph + t / 4, 1); }
    else phase = mod(ph + Math.abs(sp) * t / STRIDE, 1);
    return { x: px, z: pz, hd: Math.atan2(tx, tz), tx, tz, sp, lane, mode, ph, phase, scale: w[o + 2] };
  }
  /** the far crowd's clock (uCrowdTime) */
  timeNow() { return U.uTime.value; }
  /** hide / show far instance i of chunk c (scale 0 collapses it to a point) and optionally rewrite its walk state */
  setInstance(c, i, vals) {
    const w = c.walk, o = i * 4;
    for (let k = 0; k < 4; k++) if (vals[k] != null) w[o + k] = vals[k];
    const a = c.attrs.aWalk; a.addUpdateRange(o, 4); a.needsUpdate = true;
  }

  update(camera, dt = 0.016) {
    if (this.near) { try { this.near.update(dt, camera); } catch (e) { console.error('[crowd] near NPCs disabled', e); this.near = null; } }
    const cp = camera.position;
    let n = 0;
    for (const c of this.chunks) {
      const d = c.center.distanceTo(cp) - c.radius, vis = d < DRAW && cp.y < 900, near = d < LOD0;
      c.meshes[0].visible = vis && near; c.meshes[1].visible = vis && !near;
      c.meshes[0].castShadow = CROWD_SHADOW && vis && near && d < SHADOW;
      if (vis) n += c.n;
    }
    this.drawn = n;
  }
}
