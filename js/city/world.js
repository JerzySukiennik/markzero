// [V3] copied from next/showroom/exhibits/city/lib (2026-09-25). V3 changes: props are instanced per 400 m
// CHUNK (not per 800 m tile) so distance/frustum culling bites, draw distances cut, prop shadows only near
// the camera — props were 16 M of the 18 M triangles per frame on the HP (bench 2026-09-25).
// CityWorld: loads layout.json + tiles + world.glb + props.json, applies the city materials,
// instances props per tile (InstancedMesh), distance-culls props (HLOD), animates traffic.
import * as THREE from 'three';
import { arrayTexture, tex2d, stylesTexture, skyFieldTexture } from './textures.js';
import { facadeMaterial, detailMaterial, groundMaterial, patchGeneric, U } from './materials.js';
import { Crowd } from './crowd.js';

export const KIT = {
  // kind -> kit GLB (assets/city/kit/<file>.glb), prop max draw distance (m), shadows, layer
  // [V3] distances cut for the HP budget (showroom values in brackets)
  street_lamp: { file: 'street_lamp', dist: 380, cast: true },        // 650
  park_lamp: { file: 'park_lamp', dist: 300, cast: false },           // 450
  traffic_signal: { file: 'traffic_signal', dist: 380, cast: true },  // 600
  tree_street: { file: 'tree', dist: 500, cast: true },               // 900
  tree_park: { file: 'tree_big', dist: 900, cast: true },             // 1500
  car: { file: 'car', dist: 300, cast: true },                        // 520
  taxi: { file: 'taxi', dist: 300, cast: true },                      // 520
  hydrant: { file: 'hydrant', dist: 150, cast: false },
  bench: { file: 'bench', dist: 180, cast: false },
  trash_bin: { file: 'trash_bin', dist: 160, cast: false },
  subway_entrance: { file: 'subway_entrance', dist: 300, cast: true },
  water_tower: { file: 'water_tower', dist: 1600, cast: true },       // 2600
  fire_escape: { file: 'fire_escape', dist: 420, cast: true },        // 700
  antenna: { file: 'antenna', dist: 2500, cast: true },               // 4000
};
export const PROP_CHUNK = 400, PROP_SHADOW_DIST = 260;
export const LOD_DETAIL = 700, LOD_FAR = 1200;   // tile LOD distances (m, to the tile rectangle)
export const TREE_SCALE = { tree_street: [1.3, 1.75], tree_park: [1.2, 1.35] };   // [crown, height]

export class CityWorld {
  constructor(ctx, cityRenderer) {
    this.ctx = ctx; this.cr = cityRenderer;
    this.group = new THREE.Group(); this.group.name = 'city_world';
    this.tiles = [];
    this.propGroups = [];           // {mesh, center, dist}
    this.traffic = null;
    this.stats = { tris: 0, instances: 0, drawn: 0 };
  }

  async load({ onProgress, tilesFilter = null, props = true, traffic = true, world = true, crowd = true } = {}) {
    const ctx = this.ctx;
    const [layout, styles, propsJson] = await Promise.all([
      fetch(ctx.url('assets/city/layout.json')).then(r => r.json()),
      fetch(ctx.url('assets/city/styles.json')).then(r => r.json()),
      props ? fetch(ctx.url('assets/city/props.json')).then(r => r.json()) : null,
    ]);
    this.layout = layout; this.styles = styles;
    const T = p => ctx.url('assets/city/tex/' + p);
    const [facAlb, facNrm, detAlb, detNrm, grAlb, grNrm, roomsDay, roomsNight, wA, wB, shore] = await Promise.all([
      arrayTexture(T('facade_albedo.jpg'), { srgb: true }), arrayTexture(T('facade_nrm.png')),
      arrayTexture(T('detail_albedo.jpg'), { srgb: true }), arrayTexture(T('detail_nrm.png')),
      arrayTexture(T('ground_albedo.jpg'), { srgb: true }), arrayTexture(T('ground_nrm.png')),
      tex2d(T('rooms_day.jpg'), { srgb: true, repeat: false }), tex2d(T('rooms_night.jpg'), { srgb: true, repeat: false }),
      tex2d(T('water_normal_a.jpg')), tex2d(T('water_normal_b.jpg')),
      tex2d(T('water_shore.png'), { repeat: false }),
    ]);
    U.uNoise.value = await tex2d(T('noise.png'));
    try {
      const [sf, sj] = await Promise.all([skyFieldTexture(T('skyfield.png')), fetch(T('skyfield.json')).then(r => r.json())]);
      U.uSkyField.value = sf; U.uSkyRect.value.set(...sj.rect); this.cr.skyField = { tex: sf, rect: sj.rect };
    } catch (e) { console.warn('[city] no sky field', e); }
    const rj = await fetch(T('rooms.json')).then(r => r.json()).catch(() => null);
    this.roomAvg = rj?.avg_linear;
    const tex = { facAlb, facNrm, detAlb, detNrm, grAlb, grNrm, roomsDay, roomsNight, styles: stylesTexture(styles) };
    this.tex = tex;
    this.mats = {
      facade: this.cr.addMaterial(facadeMaterial(tex, { roomAvg: this.roomAvg })),
      detail: this.cr.addMaterial(detailMaterial(tex)),
      ground: this.cr.addMaterial(groundMaterial(tex)),
    };
    // water textures
    const wu = this.cr.water.material.uniforms;
    wu.uNormA.value = wA; wu.uNormB.value = wB; wu.uShore.value = shore;
    const sf = layout.world?.shore_field;
    if (sf) wu.uShoreRect.value.set(...sf.rect);
    this.cr.water.level = layout.water_y; this.cr.water.mesh.position.y = layout.water_y;

    // ---- tiles
    const list = layout.tiles.filter(t => !tilesFilter || tilesFilter(t));
    let done = 0;
    const loadOne = async t => {
      const g = await ctx.load('assets/city/' + t.file).catch(() => null);
      done++; onProgress?.(done / (list.length + 1));
      if (!g) return;
      this.applyCityMaterials(g.scene);
      g.scene.name = 'tile_' + t.id;
      this.group.add(g.scene);
      const [x0, z0, x1, z1] = t.rect;
      const tile = { id: t.id, root: g.scene, center: new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2), rect: [x0, z0, x1, z1], meshes: {} };
      // by node suffix: facade / detail (near LOD) / roof (roofs + crowns: always) / ground
      g.scene.traverse(o => { if (o.isMesh) { const m = /_(facade|detail|roof|ground)$/.exec(o.name); tile.meshes[m ? m[1] : o.material.name] = o; } });
      this.tiles.push(tile);
    };
    // load in parallel batches of 6
    for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(loadOne));
    if (world) {
      const w = await ctx.load(layout.world.glb).catch(() => null);
      if (w) { this.applyCityMaterials(w.scene); w.scene.name = 'world'; this.group.add(w.scene); }
    }
    onProgress?.(1);
    // water reflection pass: cheap facades (far path only), no ground (never visible in it)
    this.mats.facadeCheap = this.cr.addMaterial(facadeMaterial(tex, { cheap: true, roomAvg: this.roomAvg }));
    this.group.traverse(o => {
      if (!o.isMesh) return;
      if (o.material === this.mats.facade && /^world_far/.test(o.name)) { o.material = this.mats.facadeCheap; return; }   // 1.5-7 km out: always the cheap path
      if (o.material === this.mats.facade) this.cr.reflectionSwap.push([o, this.mats.facadeCheap]);
      if (o.material === this.mats.ground) this.cr.reflectionHide.push(o);
    });
    if (props && propsJson) await this.loadProps(propsJson);
    if (traffic) this.initTraffic();
    if (props && crowd && new URLSearchParams(location.search).get('crowd') !== '0' && U.uLook.value > 0.5) {   // ?crowd=0 for A/B; off with ?cityLook=0
      try { this.crowd = await new Crowd(ctx, this.cr).load(layout); this.group.add(this.crowd.group); }
      catch (e) { console.warn('[city] crowd failed', e); }
    }
    this.group.traverse(o => { if (o.isMesh) this.stats.tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.count || 1); });
    return this;
  }

  applyCityMaterials(root) {
    root.traverse(o => {
      if (!o.isMesh) return;
      const n = o.material?.name || '';
      if (n === 'mat_facade') o.material = this.mats.facade;
      else if (n === 'mat_detail') o.material = this.mats.detail;
      else if (n === 'mat_ground') o.material = this.mats.ground;
      else if (n === 'mat_water') { o.material = this.lakeMaterial(); o.receiveShadow = false; o.castShadow = false; return; }
      o.castShadow = n !== 'mat_ground' && !/^world_far/.test(o.name) && !/^world_far/.test(o.parent?.name || '');   // far skyline: 1.5-7 km out, never in a cascade
      o.receiveShadow = true;
      o.frustumCulled = true;
    });
  }

  /** The park lake: same water shader, but no planar reflection (it sits above the river
   *  level, and sampling the reflection target while it is being drawn is a feedback loop). */
  lakeMaterial() {
    if (this._lake) return this._lake;
    const w = this.cr.water.material;
    this._lake = new THREE.ShaderMaterial({ name: 'city_lake', vertexShader: w.vertexShader, fragmentShader: w.fragmentShader,
      uniforms: { ...w.uniforms, uRefl: { value: null }, uHasRefl: { value: 0 },
        uShoreRect: { value: new THREE.Vector4(1e6, 1e6, 1e6 + 1, 1e6 + 1) },        // no shore foam
        uDeep: { value: new THREE.Color(0.02, 0.04, 0.035) }, uShallow: { value: new THREE.Color(0.03, 0.05, 0.04) } } });
    return this._lake;
  }

  // ------------------------------------------------------------------ props
  async loadProps(pj) {
    const ctx = this.ctx;
    const kinds = Object.keys(pj.props).filter(k => KIT[k]);
    const kits = {};
    await Promise.all(kinds.map(async k => {
      const g = await ctx.load('assets/city/kit/' + KIT[k].file + '.glb').catch(() => null);
      kits[k] = g;
    }));
    const dummy = new THREE.Object3D();
    for (const kind of kinds) {
      const kit = kits[kind];
      const parts = kit ? this.kitParts(kit.scene) : [this.fallbackPart(kind)];
      const byTile = pj.props[kind];
      for (const [tile, rows] of Object.entries(byTile)) {
        // variants: a kit may contain var0..varN children; rows[5] picks one
        const groups = new Map();
        for (const r of rows) {
          const nv = parts.variants || 1;
          const v = kind === 'fire_escape' ? (r[5] ? 1 % nv : 0) : (typeof r[5] === 'number' ? r[5] % nv : 0);
          const key = v + '|' + Math.floor(r[0] / PROP_CHUNK) + ',' + Math.floor(r[2] / PROP_CHUNK);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(r);
        }
        for (const [key, rs] of groups) {
          const v = +key.split('|')[0];
          const center = new THREE.Vector3();
          for (const r of rs) { center.x += r[0]; center.z += r[2]; }
          center.multiplyScalar(1 / rs.length);
          for (const part of parts.filter(p => (p.variant ?? 0) === v || p.variant === -1)) {
            const im = new THREE.InstancedMesh(part.geometry, part.material, rs.length);
            im.name = `${kind}_${tile}_${v}`;
            rs.forEach((r, i) => {
              dummy.position.set(r[0], r[1], r[2]);
              dummy.rotation.set(0, r[3], 0);
              const s = kind === 'antenna' ? 1 : (r[4] || 1);
              dummy.scale.set(s, kind === 'antenna' ? (r[4] || 15) / 15 : s, s);
              // LOOK-AUDIT S1: the kit trees were 7 m / 12.8 m lollipops (NYC street trees 12-20 m, crowns up to
              // floor 3-5) — the strongest "model railway" cue. Colliders are built from these matrices.
              const TS = TREE_SCALE[kind]; if (TS) dummy.scale.set(s * TS[0], s * TS[1], s * TS[0]);
              if (kind === 'fire_escape') dummy.scale.set(1, (r[4] || 3.05) / 3.05, 1);
              dummy.updateMatrix();
              im.setMatrixAt(i, dummy.matrix);
              if (part.tint && im.setColorAt) im.setColorAt(i, part.tint(r));
            });
            im.instanceMatrix.needsUpdate = true;
            if (im.instanceColor) im.instanceColor.needsUpdate = true;
            im.computeBoundingSphere();
            im.castShadow = KIT[kind].cast; im.receiveShadow = true;
            im.layers.set(1);                      // not in the water reflection pass
            this.group.add(im);
            this.propGroups.push({ mesh: im, center: im.boundingSphere.center.clone(), radius: im.boundingSphere.radius, dist: KIT[kind].dist, kind });
            this.stats.instances += rs.length;
          }
        }
      }
    }
    this.lampPools(pj.props.street_lamp || {}, pj.props.park_lamp || {});
    // the camera must see layer 1 too
    this.ctx.camera.layers.enable(1);
  }

  /** Night light pools under street lamps: additive ground decals (instanced per tile). */
  lampPools(streetRows, parkRows) {
    const mat = new THREE.ShaderMaterial({
      name: 'city_lamp_pool', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      uniforms: { uNight: U.uNight, uLampColor: U.uLampColor },
      vertexShader: `varying vec2 vUv; varying float vD;
        void main() { vUv = uv; vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vD = distance(w.xyz, cameraPosition); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uNight; uniform vec3 uLampColor; varying vec2 vUv; varying float vD;
        void main() { vec2 p = vUv * 2.0 - 1.0; float r = dot(p, p);
          float f = exp(-r * 3.2) * (1.0 - smoothstep(0.7, 1.0, r));
          float fade = 1.0 - smoothstep(250.0, 650.0, vD);
          gl_FragColor = vec4(uLampColor * f * uNight * 0.55 * fade, 1.0); }`,
    });
    this._poolMat = mat;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const d = new THREE.Object3D();
    for (const [rowsByTile, size, reach] of [[streetRows, 17, 2.4], [parkRows, 11, 0]]) {
      for (const [tile, rows] of Object.entries(rowsByTile)) {
        const im = new THREE.InstancedMesh(geo, mat, rows.length);
        rows.forEach((r, i) => {
          // the head hangs `reach` m along the lamp's -Z (towards the road)
          const s = Math.sin(r[3]), c = Math.cos(r[3]);
          d.position.set(r[0] - s * reach, r[1] + 0.03, r[2] - c * reach);
          d.rotation.set(0, r[3], 0); d.scale.set(size, 1, size * 1.25); d.updateMatrix();
          im.setMatrixAt(i, d.matrix);
        });
        im.computeBoundingSphere();
        im.layers.set(1); im.renderOrder = 2; im.frustumCulled = true;
        this.group.add(im);
        this.propGroups.push({ mesh: im, center: im.boundingSphere.center.clone(), radius: im.boundingSphere.radius, dist: 650, kind: 'lamp_pool', night: true });
      }
    }
  }

  kitParts(root) {
    const parts = [];
    let maxVar = 0;
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!o.isMesh) return;
      // variant = nearest ancestor named var<N>
      let v = -1, p = o;
      while (p) { const m = /^var(\d+)$/.exec(p.name); if (m) { v = +m[1]; break; } p = p.parent; }
      maxVar = Math.max(maxVar, v);
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const mat = o.material.clone();
      const glow = /glow|lamp_emit|light/.test(mat.name);
      patchGeneric(mat, { nightEmissive: glow });
      this.cr.addMaterial(mat);
      const part = { geometry: geo, material: mat, variant: v };
      if (mat.name === 'kit_car') part.tint = r => CAR_PAINT[Math.floor(hash2(r[0], r[2]) * CAR_PAINT.length)];
      parts.push(part);
    });
    parts.variants = maxVar + 1;
    return parts;
  }

  fallbackPart(kind) {
    const sizes = { street_lamp: [0.25, 8, 0.25], park_lamp: [0.2, 4, 0.2], traffic_signal: [0.3, 6, 0.3], tree_street: [4, 8, 4], tree_park: [7, 12, 7],
      car: [1.85, 1.45, 4.6], taxi: [1.85, 1.5, 4.8], hydrant: [0.4, 0.8, 0.4], bench: [1.8, 0.8, 0.6], trash_bin: [0.6, 1, 0.6], subway_entrance: [2.2, 1.1, 5],
      water_tower: [5, 9, 5], fire_escape: [4.6, 0.2, 1.2], antenna: [0.4, 15, 0.4] };
    const s = sizes[kind] || [1, 1, 1];
    const g = new THREE.BoxGeometry(...s).translate(0, s[1] / 2, 0);
    const colors = { tree_street: 0x3a5a2a, tree_park: 0x33552a, car: 0x555566, taxi: 0xe8b818, water_tower: 0x6b4a33 };
    const m = new THREE.MeshStandardMaterial({ color: colors[kind] || 0x777777, roughness: 0.7 });
    patchGeneric(m); this.cr.addMaterial(m);
    const parts = [{ geometry: g, material: m, variant: 0 }];
    parts.variants = 1;
    return parts[0];
  }

  // ------------------------------------------------------------------ per frame
  update(dt, camera) {
    const cp = camera.position;
    let drawn = 0;
    for (const p of this.propGroups) {
      const d = p.center.distanceTo(cp) - p.radius;
      const vis = d < p.dist * (this.distMul ?? 1) && (!p.night || U.uNight.value > 0.05);
      p.mesh.visible = vis;
      if (vis) { drawn += p.mesh.count; p.mesh.castShadow = !this.noPropShadows && !!KIT[p.kind]?.cast && d < PROP_SHADOW_DIST; }
    }
    this.stats.drawn = drawn;
    // tile LOD (HP budget with the Manhattan towers):
    //   < 700 m  full: facade shader near path (itself limited to ~250 m), small detail (cornices, parapets, clutter)
    //   < 1200 m facade + roofs/crowns, no small detail
    //   beyond   the cheap facade (compile-time far path only: no interior mapping, doors, AC, weathering) and no
    //            shadow casting — an impostor-grade box city with its real silhouette (crowns stay in the roof mesh)
    // shadows: small detail only < 500 m, facades/roofs < 1200 m
    const far = this.mats?.facadeCheap, full = this.mats?.facade;
    for (const t of this.tiles) {
      const [x0, z0, x1, z1] = t.rect, dx = Math.max(x0 - cp.x, 0, cp.x - x1), dz = Math.max(z0 - cp.z, 0, cp.z - z1);
      const d = Math.hypot(dx, dz, Math.max(0, cp.y - 450) * 0.5), M = t.meshes;
      if (M.detail) { M.detail.visible = d < (this.lodDetail ?? LOD_DETAIL); M.detail.castShadow = d < 500; }
      const lod2 = d > (this.lodFar ?? LOD_FAR);
      if (M.facade) { if (far && full) M.facade.material = lod2 ? far : full; M.facade.castShadow = !lod2; }
      if (M.roof) M.roof.castShadow = !lod2;
    }
    if (this.traffic) this.updateTraffic(dt, cp);
    this.crowd?.update(camera, dt);
  }

  // ------------------------------------------------------------------ traffic (moving cars)
  initTraffic() {
    const pr = this.layout.park?.rect;
    if (pr) { const xs = pr.map(p => p[0]), zs = pr.map(p => p[1]); this._park = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; }
    const lanes = this.layout.traffic?.lanes;
    if (!lanes) return;
    const kitCar = this.propGroups.find(p => p.kind === 'car');
    const kitTaxi = this.propGroups.find(p => p.kind === 'taxi');
    const src = kitCar || kitTaxi;
    if (!src) return;
    const cars = [];
    const rng = mulberry(7);
    for (const L of lanes) {
      const ax = L.a[0], az = L.a[1], bx = L.b[0], bz = L.b[1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(len / (L.kind === 'ave' ? 55 : 90));
      for (let i = 0; i < n; i++) {
        cars.push({ lane: L, len, s: rng() * len, v: L.speed * (0.8 + 0.4 * rng()), taxi: rng() < 0.3, var: Math.floor(rng() * 6) });
      }
    }
    // one InstancedMesh per kit part (car and taxi models), updated every frame near the camera
    const mk = (pg, list) => {
      const im = new THREE.InstancedMesh(pg.mesh.geometry, pg.mesh.material, list.length);
      if (pg.mesh.material.name === 'kit_car') list.forEach((c, i) => im.setColorAt(i, CAR_PAINT[c.var % CAR_PAINT.length]));
      im.name = 'traffic_' + pg.kind; im.castShadow = true; im.receiveShadow = true; im.layers.set(1);
      im.frustumCulled = false;
      this.group.add(im);
      return im;
    };
    const carsA = cars.filter(c => !c.taxi || !kitTaxi), carsB = cars.filter(c => c.taxi && kitTaxi);
    this.traffic = { sets: [] };
    // cars' kit may have several parts (body, glass, lights): find all groups of that kind in tile 0
    const partsOf = kind => {
      const first = this.propGroups.find(p => p.kind === kind);
      if (!first) return [];
      const tag = first.mesh.name.split('_').slice(-2).join('_');
      return this.propGroups.filter(p => p.kind === kind && p.mesh.name.endsWith(tag));
    };
    for (const [kind, list] of [['car', carsA], ['taxi', carsB]]) {
      if (!list.length) continue;
      const pgs = partsOf(kind);
      this.traffic.sets.push({ list, meshes: pgs.map(pg => mk(pg, list)) });
    }
    this._dummy = new THREE.Object3D();
  }

  updateTraffic(dt, cp) {
    const d = this._dummy;
    const R2 = 750 * 750;
    for (const set of this.traffic.sets) {
      let k = 0;
      for (const c of set.list) {
        c.s = (c.s + c.v * dt) % c.len;
        const L = c.lane;
        const t = c.s / c.len;
        const x = L.a[0] + (L.b[0] - L.a[0]) * t, z = L.a[1] + (L.b[1] - L.a[1]) * t;
        if ((x - cp.x) ** 2 + (z - cp.z) ** 2 > R2) continue;
        if (this._park && x > this._park[0] && x < this._park[2] && z > this._park[1] && z < this._park[3]) continue;
        d.position.set(x, 0, z);
        d.rotation.set(0, Math.atan2(-(L.b[0] - L.a[0]), -(L.b[1] - L.a[1])), 0);
        d.updateMatrix();
        for (const m of set.meshes) m.setMatrixAt(k, d.matrix);
        k++;
      }
      for (const m of set.meshes) { m.count = k; m.instanceMatrix.needsUpdate = true; }
    }
  }

  dispose() {
    this.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
  }
}

const CAR_PAINT = [0x15171b, 0x1e2126, 0x5d6166, 0x9ea2a6, 0xc9cbcd, 0xe6e6e3, 0x6e1512, 0x152744, 0x26331f, 0x7d6a4c, 0x3a4a5c, 0x8c1f1a]
  .map(c => new THREE.Color(c));
function hash2(x, z) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }

function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
