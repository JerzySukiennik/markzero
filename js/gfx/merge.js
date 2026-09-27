// Draw-call merge for rigid armour. A NEXT suit is hundreds of separate plate meshes (Mk 85: 244
// primitives, Mk 42: 430), each parented to a pivot — so ONE suit costs hundreds of draw calls per pass,
// times the 3 shadow cascades. In Chrome every draw call is expensive CPU work (ANGLE → D3D11), and the
// HP bench showed the frame is CPU-bound (≈10 of 12 ms in JS/driver).
//
// mergeRigid(root) turns all plates that share a material into ONE SkinnedMesh whose "bones" are the
// plate nodes themselves (each vertex 100 % bound to its own plate). Animation keeps working unchanged:
// clips move the pivots/plates, the skeleton reads their matrixWorld every frame. Draw calls per pass
// drop to the number of materials (5–14).
//
// Contract / caveats:
//  - Call it AFTER material patching (nano shader etc.): meshes are grouped by their FINAL material
//    object, so per-driver nano materials stay separate. customDepthMaterial/customDistanceMaterial of the
//    first mesh of a group are reused.
//  - Hiding a single plate with `visible = false` no longer works after merging — scale its node to 0
//    (`plate.scale.setScalar(0)`), or exclude it: mergeRigid(root, { exclude: mesh => /blade/.test(mesh.name) }).
//  - The original meshes stay in the graph (invisible) so names, pivots and drivers are untouched.
//  - Returns { meshes, merged, kept, restore() }.
import * as THREE from 'three';

export function mergeRigid(root, { exclude = null, minGroup = 2 } = {}) {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const kept = [];
  root.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.visible || Array.isArray(o.material)) { if (o.isMesh) kept.push(o); return; }
    if (exclude?.(o)) { kept.push(o); return; }
    const g = o.geometry, attrs = Object.keys(g.attributes).filter(k => k !== 'skinIndex' && k !== 'skinWeight').sort();
    if (!g.attributes.position || g.morphAttributes?.position) { kept.push(o); return; }
    const key = o.material.uuid + '|' + attrs.join(',') + '|' + (g.index ? 'i' : 'n') + '|' + (o.customDepthMaterial?.uuid || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  const out = [], merged = [];
  const m4 = new THREE.Matrix4(), n3 = new THREE.Matrix3();
  for (const list of groups.values()) {
    if (list.length < minGroup) { kept.push(...list); continue; }
    const first = list[0], names = Object.keys(first.geometry.attributes).filter(k => k !== 'skinIndex' && k !== 'skinWeight');
    let vcount = 0, icount = 0;
    for (const o of list) { vcount += o.geometry.attributes.position.count; icount += o.geometry.index ? o.geometry.index.count : 0; }
    const geo = new THREE.BufferGeometry();
    const arrays = {};
    for (const n of names) { const a = first.geometry.attributes[n]; arrays[n] = new Float32Array(vcount * a.itemSize); }
    const skinIndex = new Uint16Array(vcount * 4), skinWeight = new Float32Array(vcount * 4);
    const index = first.geometry.index ? (vcount > 65535 ? new Uint32Array(icount) : new Uint16Array(icount)) : null;
    const bones = [];
    let vo = 0, io = 0;
    const v = new THREE.Vector3();
    for (let bi = 0; bi < list.length; bi++) {
      const o = list[bi], g = o.geometry, n = g.attributes.position.count;
      bones.push(o);
      m4.multiplyMatrices(rootInv, o.matrixWorld);          // plate → root space (bind pose)
      n3.getNormalMatrix(m4);
      for (const name of names) {
        const a = g.attributes[name], dst = arrays[name], s = a.itemSize;
        for (let i = 0; i < n; i++) {
          if (name === 'position') { v.fromBufferAttribute(a, i).applyMatrix4(m4); dst[(vo + i) * 3] = v.x; dst[(vo + i) * 3 + 1] = v.y; dst[(vo + i) * 3 + 2] = v.z; }
          else if (name === 'normal') { v.fromBufferAttribute(a, i).applyMatrix3(n3).normalize(); dst[(vo + i) * 3] = v.x; dst[(vo + i) * 3 + 1] = v.y; dst[(vo + i) * 3 + 2] = v.z; }
          else if (name === 'tangent') { v.fromBufferAttribute(a, i).transformDirection(m4); dst[(vo + i) * 4] = v.x; dst[(vo + i) * 4 + 1] = v.y; dst[(vo + i) * 4 + 2] = v.z; dst[(vo + i) * 4 + 3] = a.getW(i); }
          else for (let c = 0; c < s; c++) dst[(vo + i) * s + c] = a.getComponent(i, c);
        }
      }
      for (let i = 0; i < n; i++) { skinIndex[(vo + i) * 4] = bi; skinWeight[(vo + i) * 4] = 1; }
      if (index) { const src = g.index.array; for (let i = 0; i < src.length; i++) index[io + i] = src[i] + vo; io += src.length; }
      vo += n;
    }
    for (const n of names) { const a = first.geometry.attributes[n]; geo.setAttribute(n, new THREE.BufferAttribute(arrays[n], a.itemSize, a.normalized)); }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    if (index) geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingSphere(); geo.boundingSphere.radius *= 2.5;   // plates fly apart in some clips (Mk 42 summon)
    const sm = new THREE.SkinnedMesh(geo, first.material);
    sm.name = '__merged_' + (first.material.name || 'mat');
    sm.castShadow = list.some(o => o.castShadow); sm.receiveShadow = list.some(o => o.receiveShadow);
    sm.customDepthMaterial = first.customDepthMaterial; sm.customDistanceMaterial = first.customDistanceMaterial;
    sm.frustumCulled = false;                                       // bounds change with the pose
    // attached bind mode: world = boneWorld(now) · inv(boneWorld(bind)) · bindMatrix · v, v in root space, bindMatrix = root world at bind
    const inv = bones.map(b => b.matrixWorld.clone().invert());
    const sk = new THREE.Skeleton(bones, inv);
    root.add(sm);
    sm.bind(sk, root.matrixWorld.clone());
    for (const o of list) o.visible = false;
    out.push(sm); merged.push(...list);
  }
  return {
    meshes: out, merged, kept,
    restore() { for (const sm of out) { root.remove(sm); sm.geometry.dispose(); sm.skeleton.dispose(); } for (const o of merged) o.visible = true; },
  };
}
