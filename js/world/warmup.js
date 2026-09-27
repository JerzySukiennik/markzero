// GPU warm-up behind the loading screen, spread over many small frames.
// Why: after a teleport / water respawn / camera jump the first sight of a group compiled its shader program(s)
// (incl. shadow-depth variants) and uploaded its textures and buffers IN ONE FRAME — measured on the Mac 1.0–4.2 s
// frames (1–4 new programs + 4–5 textures). On the HP (ANGLE → D3D11) that is the likely trigger of the Windows
// driver reset (TDR, a GPU packet > 2 s) = Jurek's white frame.
// How: every group (city tile, world shores, each prop kind/variant, traffic, bases, heroes, VFX) is rendered ALONE,
// once, into a tiny half-float target from a camera that frames it, with the sun's shadow maps updated — so its
// programs (lit + shadow depth), textures and buffers are ready. One group per frame (≤ ~6 ms each on the HP).
import * as THREE from 'three';

export async function warmWorld(world, { onProgress, perFrame = 1 } = {}) {
  const MZ = world.MZ, r = MZ.stage.renderer, scene = world.scene;
  const rt = new THREE.WebGLRenderTarget(96, 96, { type: THREE.HalfFloatType, samples: 0 });
  const cam = new THREE.PerspectiveCamera(50, 1, 0.3, 20000);
  // targets
  const groups = [];
  for (const t of world.city.tiles) groups.push([t.root]);
  world.city.group.traverse(o => { if (o.name === 'world') groups.push([o]); });
  for (const c of world.city.group.children) if (!world.city.tiles.some(t => t.root === c) && c.name !== 'world' && !world.city.propGroups.some(pg => pg.mesh === c)) groups.push([c]);   // skyline extras, landmarks, lake…
  // EVERY prop chunk (not one per material): a chunk's first sight also uploads its instance buffers and builds its
  // vertex-array objects for the lit pass and each shadow cascade — measured: skipping this left 0.35–6 s stalls
  const props = world.city.propGroups.map(pg => pg.mesh);
  for (let i = 0; i < props.length; i += 240) groups.push(props.slice(i, i + 120));
  for (const s of world.city.traffic?.sets || []) groups.push(s.meshes);
  for (const b of world.bases || []) groups.push([b]);
  for (const pl of MZ.game.players.values()) if (pl.root) groups.push([pl.root]);
  groups.push([world.webfx?.group || world.webfx?.root].filter(Boolean));
  // and everything else hanging off the scene (VFX pools: sparks, billboards, scorches, story actors…)
  const covered = new Set(groups.flat());
  for (const k of scene.children) if (!covered.has(k) && k !== world.city.group && !/^city_env|__lightpool/.test(k.name)) groups.push([k]);
  // remember visibility of every top-level child + the things we touch
  const kids = scene.children.slice(), vis = kids.map(k => k.visible);
  const saved = new Map();
  const keep = new Set(); scene.traverse(o => { if (o.isLight || o.name === '__lightpool' || o.name === 'city_env') keep.add(o); });
  const sb = new THREE.Box3(), sph = new THREE.Sphere();
  const lights = world.cr.csm.lights;
  const oldTarget = r.getRenderTarget(), oldAuto = r.shadowMap.autoUpdate;
  let n = 0;
  for (const g of groups) {
    if (!g.length) continue;
    // show only this group (its ancestors must be visible too)
    for (const k of kids) k.visible = keep.has(k);
    const shown = [];
    for (const o of g) {
      for (let p = o; p && p !== scene; p = p.parent) { if (!saved.has(p)) saved.set(p, [p.visible, p.frustumCulled, p.count, p.castShadow]); p.visible = true; shown.push(p); }
      o.traverse(c => { if (!saved.has(c)) saved.set(c, [c.visible, c.frustumCulled, c.count, c.castShadow]); c.visible = true; c.frustumCulled = false; if (c.isMesh) c.castShadow = true; if (c.isInstancedMesh && !c.count) c.count = 1; });
    }
    // frame it
    sb.makeEmpty(); for (const o of g) sb.expandByObject(o);
    if (sb.isEmpty()) sb.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(10, 10, 10));
    sb.getBoundingSphere(sph);
    cam.position.copy(sph.center).add(new THREE.Vector3(0.6, 0.5, 0.8).normalize().multiplyScalar(Math.max(4, sph.radius * 1.6)));
    cam.lookAt(sph.center); cam.updateMatrixWorld();
    // one cascade is enough: the depth program and the geometry's VAO are the same for all three
    lights.forEach((l, i) => { l.shadow.needsUpdate = i === 0; l.shadow.autoUpdate = false; });
    r.shadowMap.autoUpdate = true;
    r.setRenderTarget(rt); r.render(scene, cam);
    r.setRenderTarget(oldTarget);
    // restore this group
    for (const [o, [v, f, c, cs]] of saved) { o.visible = v; o.frustumCulled = f; o.castShadow = cs; if (o.isInstancedMesh) o.count = c; }
    saved.clear();
    kids.forEach((k, i) => { k.visible = vis[i]; });
    onProgress?.(++n / groups.length);
    if (n % perFrame === 0) await new Promise(res => requestAnimationFrame(() => res()));
  }
  r.shadowMap.autoUpdate = oldAuto;
  rt.dispose();
  return { groups: groups.length, programs: r.info.programs.length };
}
