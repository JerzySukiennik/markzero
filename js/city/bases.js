// Helpers shared by the apartment and villa exhibits: place a base GLB in the city, turn its
// marker Empties into real things (kit props, lights), patch its materials into the city
// lighting (fog, CSM, night emissive).
import * as THREE from 'three';
import { patchGeneric, U } from './materials.js';

/** Put `root` at a layout base entry {origin:[x,y,z], rot_y}. */
export function placeBase(root, base) {
  root.position.set(...base.origin);
  root.rotation.y = base.rot_y || 0;
  root.updateMatrixWorld(true);
  return root;
}

/** Patch every material of a base for the city renderer. Glow materials follow the night. */
export function patchBase(root, cr, { shadows = true } = {}) {
  const seen = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = shadows; o.receiveShadow = true;
    for (const m of [].concat(o.material)) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      const glow = /glow|screen|lampshade|led/i.test(m.name);
      if (/^mat_glass$|glass_clear/i.test(m.name)) {
        // Blender's exporter writes our window glass as opaque; it is thin clear glass
        m.transparent = true; m.opacity = 0.14; m.roughness = 0.04; m.metalness = 0.0;
        m.color?.setRGB(0.75, 0.82, 0.85); m.envMapIntensity = 1.0; m.side = THREE.DoubleSide;
      }
      if (/pool_water/i.test(m.name)) poolWater(m);
      if (/pool_tile/i.test(m.name)) { m.color?.setRGB(0.55, 0.82, 0.86); m.roughness = 0.25; }
      if (/^mat_aluminium$/i.test(m.name)) { m.metalness = 0.9; m.roughness = 0.32; }
      if (m.transparent) { m.depthWrite = false; o.castShadow = false; }
      patchGeneric(m, { nightEmissive: glow });
      cr.addMaterial(m);
    }
  });
}

/** Pool water: clear turquoise with analytic world-space ripples (three crossing wave trains),
 *  so the sky/skyline reflection wobbles and the white tiles read through it. */
function poolWater(m) {
  m.transparent = true; m.opacity = 0.84; m.roughness = 0.02; m.metalness = 0.0;
  m.color?.setRGB(0.06, 0.5, 0.58);
  m.emissive?.setRGB(0.012, 0.11, 0.13);   // in-scattered light from the lit tiles below
  m.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec2 pw = vCityW.xz; float tt = uTime;
        vec2 g = vec2(0.8, 0.6) * cos(dot(pw, vec2(0.8, 0.6)) * 3.1 + tt * 1.7) * 0.05
               + vec2(-0.5, 0.86) * cos(dot(pw, vec2(-0.5, 0.86)) * 5.3 + tt * 2.3) * 0.035
               + vec2(0.2, -0.98) * cos(dot(pw, vec2(0.2, -0.98)) * 9.7 + tt * 3.1) * 0.02;
        normal = normalize((viewMatrix * vec4(normalize(vec3(-g.x, 1.0, -g.y)), 0.0)).xyz);
      }`);
  };
  m.customProgramCacheKey = () => 'poolwater';
}

/** Instances of kit props at Empties named prop_* (extras: kit, variant, scale, scale_y). */
export async function kitAtMarkers(ctx, root, cr) {
  const out = [];
  const marks = [];
  root.traverse(o => { if (/^prop_/.test(o.name) && o.userData?.kit) marks.push(o); });
  for (const m of marks) {
    const g = await ctx.load(`assets/city/kit/${m.userData.kit}.glb`).catch(() => null);
    if (!g) continue;
    const v = g.scene.getObjectByName('var' + (m.userData.variant ?? 0)) || g.scene;
    const inst = v.clone(true);
    inst.position.set(0, 0, 0); inst.rotation.set(0, 0, 0);
    const s = m.userData.scale || 1;
    inst.scale.set(s, (m.userData.scale_y || 1) * s, s);
    patchBase(inst, cr);
    m.add(inst);
    out.push(inst);
  }
  return out;
}

/** PointLights / SpotLights at Empties named light_* (extras: light, energy_w, color, range).
 *  Returns a function (night 0..1) that dims them. */
export function lightsAtMarkers(root, { scale = 0.6 } = {}) {
  const lights = [];
  root.traverse(o => {
    if (!/^light_/.test(o.name) || !o.userData?.light) return;
    const u = o.userData;
    const col = new THREE.Color(...(u.color || [1, 0.85, 0.6]));
    const L = u.light === 'spot'
      ? new THREE.SpotLight(col, 1, u.range || 5, Math.PI / 4, 0.6, 2)
      : new THREE.PointLight(col, 1, u.range || 8, 2);
    if (L.isSpotLight) { L.target.position.set(0, -1, 0); o.add(L.target); }
    L.userData.base = (u.energy_w || 60) * scale;
    L.castShadow = false;
    o.add(L);
    lights.push(L);
  });
  return (on) => { for (const L of lights) { L.intensity = L.userData.base * on; L.visible = on > 0.01; } };
}
