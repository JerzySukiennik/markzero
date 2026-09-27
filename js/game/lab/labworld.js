// Gameplay-lab world: the same interface the platform's world session hands to createPlayer
// (scene, camera, vfx, webfx, pool, collide, kick(), timeScale(), litModel(), update()) on a light
// scene: the city as a blockout extruded from the SAME prisms the heroes collide with (so what you
// see is exactly what you hit), sky, sun + shadows, fog. ?city=1 loads the real NEXT city tiles
// around the spawn instead (the platform's renderer) — slower, for look checks.
import * as THREE from 'three';
import { VFX, LightPool } from '../../gfx/vfx.js';
import { WebFX } from '../../gfx/webfx.js';
import { CityCollider } from '../collide.js';
import { mergeRigid } from '../../gfx/merge.js';

export class LabWorld {
  constructor(MZ, renderer, { center = new THREE.Vector3(-560, 0, 640), radius = 1700, realCity = false } = {}) {
    this.MZ = MZ; this.renderer = renderer; this.center = center; this.radius = radius; this.realCity = realCity;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.2, 9000);
    this.kickState = { trauma: 0, fov: 0, hitstop: 0, slow: 1, slowT: 0 };
    this.log = [];   // kicks / events for tests
  }
  async load() {
    const s = this.scene;
    this.collide = await CityCollider.load('/assets/city/layout.json');
    s.background = new THREE.Color(0xa9c2da);
    s.fog = new THREE.Fog(0xb9cde0, 250, 2600);
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x5a5048, 1.3); s.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 600;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    s.add(sun, sun.target);
    this.pool = new LightPool(s, 8);
    if (this.realCity) await this._realCity(); else this._blockout();
    this.vfx = new VFX(s, { sfx: { play: (id, o = {}) => this.MZ.audio?.play(id, o) } });
    this.vfx.pool = this.pool;
    this.webfx = new WebFX({ scene: s, camera: this.camera, onSound: (id, o = {}) => this.MZ.audio?.play(id, { at: o.position, gain: o.gain }) });
    return this;
  }
  _blockout() {
    const C = this.collide, c = this.center, R = this.radius;
    const pos = [], col = [], nrm = [];
    const tint = new THREE.Color();
    for (const p of C.prisms) {
      const cx = (p.minx + p.maxx) / 2, cz = (p.minz + p.maxz) / 2;
      if (Math.hypot(cx - c.x, cz - c.z) > R) continue;
      const h = Math.sin(p.minx * 12.9898 + p.minz * 78.233) * 43758.5453; const r = h - Math.floor(h);
      tint.setHSL(0.07 + r * 0.06, 0.12 + r * 0.1, 0.46 + r * 0.16);
      for (let i = 0; i < p.n; i++) {
        const j = (i + 1) % p.n, ax = p.xs[i], az = p.zs[i], bx = p.xs[j], bz = p.zs[j];
        const L = Math.hypot(bx - ax, bz - az); if (L < 1e-3) continue;
        const nx = ((bz - az) / L) * p.s, nz = (-(bx - ax) / L) * p.s;
        pos.push(ax, p.y0, az, bx, p.y0, bz, bx, p.y1, bz, ax, p.y0, az, bx, p.y1, bz, ax, p.y1, az);
        for (let k = 0; k < 6; k++) { nrm.push(nx, 0, nz); col.push(tint.r, tint.g, tint.b); }
      }
      const contour = []; for (let i = 0; i < p.n; i++) contour.push(new THREE.Vector2(p.xs[i], p.zs[i]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const t of tris) for (const k of [t[0], t[2], t[1]]) { pos.push(p.xs[k], p.y1, p.zs[k]); nrm.push(0, 1, 0); col.push(tint.r * 0.8, tint.g * 0.8, tint.b * 0.8); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
    // floors + bays as darker bands in world space: reads speed and scale at a glance
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <color_fragment>', `#include <color_fragment>
        { float fy = fract(vWp.y / 3.6); float bx = fract((vWp.x + vWp.z) / 4.2);
          float win = step(0.35, fy) * step(fy, 0.8) * step(0.2, bx) * step(bx, 0.8);
          float wall = abs(vNormal.y) < 0.5 ? 1.0 : 0.0;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.2, 0.26), win * wall * 0.75); }`);
    };
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'blockout';
    this.scene.add(mesh);
    // ground: streets + water
    const gtex = gridTexture();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: 0x6f716e, roughness: 0.95, map: gtex }));
    gtex.repeat.set(9000 / 20, 9000 / 20);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
  }
  async _realCity() {
    const [{ CityRenderer }, { CityWorld }, { WorldView }] = await Promise.all([import('../../city/render.js'), import('../../city/world.js'), import('../../gfx/stage.js')]);
    const view = this.view = new WorldView(this.renderer); view.scene = this.scene; view.camera = this.camera;
    const ctx = { THREE, viewer: view, scene: this.scene, camera: this.camera, renderer: this.renderer, controls: view.controls,
      url: rel => '/' + rel.replace(/^\/+/, ''), load: rel => this.MZ.assets.load(rel), env: { set: n => view.setEnv(n) }, sfx: { play: () => null } };
    const cr = this.cr = new CityRenderer(ctx, { reflScale: 0.25, cascades: 2, shadowSize: 2048 });
    this.sun.visible = false;
    const city = this.city = new CityWorld(ctx, cr); this.scene.add(city.group);
    const c = this.center, R = this.radius;
    await city.load({ props: false, traffic: false, tilesFilter: t => { const [x0, z0, x1, z1] = t.rect; return Math.hypot(Math.max(x0 - c.x, 0, c.x - x1), Math.max(z0 - c.z, 0, c.z - z1)) < R * 0.6; } });
    for (const l of cr.csm.lights) l.shadow.camera.layers.enable(1);
    cr.setHour(16.2, { envNow: true });
    cr.water.enabled = false;
  }
  /** ?merge=1: the platform's draw-call merge (gfx/merge.js), for A/B against unmerged */
  optimizeModel(root, opts) { return this.MZ.params.get('merge') === '1' ? mergeRigid(root, opts) : null; }
  litModel(root) {
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (this.cr) for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial) this.cr.addMaterial(m); } });
    return root;
  }
  kick({ shake = 0, fov = 0, hitstop = 0, slow = 0, slowTime = 0 } = {}) {
    const k = this.kickState;
    k.trauma = Math.min(1, k.trauma + shake); k.fov += fov; k.hitstop = Math.max(k.hitstop, hitstop);
    if (slow) { k.slow = slow; k.slowT = slowTime; }
    this.log.push({ kind: 'kick', shake, fov, hitstop });
  }
  timeScale(dt) {
    const k = this.kickState;
    if (k.hitstop > 0) { k.hitstop -= dt * 1000; return 0; }
    if (k.slowT > 0) { k.slowT -= dt; return dt * k.slow; }
    return dt;
  }
  update(simDt, dt, t, local) {
    const cam = this.camera;
    if (local?.updateCamera) local.updateCamera(dt, cam);
    const k = this.kickState;
    k.trauma = Math.max(0, k.trauma - dt * 1.6); k.fov *= Math.exp(-dt * 7);
    const s = k.trauma * k.trauma;
    if (s > 1e-4) { const n = t * 38; cam.rotateX((Math.sin(n * 1.3) + Math.sin(n * 2.9)) * 0.012 * s); cam.rotateY((Math.sin(n * 1.7 + 1) + Math.sin(n * 3.3)) * 0.012 * s); cam.rotateZ(Math.sin(n * 2.1 + 2) * 0.02 * s); }
    cam.fov = (local?.fov ?? 64) + k.fov; cam.updateProjectionMatrix();
    // the sun's shadow box follows the player
    if (local?.root && this.sun.visible) { const p = local.root.position; this.sun.position.set(p.x + 120, p.y + 220, p.z + 80); this.sun.target.position.copy(p); }
    this.city?.update(dt, cam);
    this.vfx.update(simDt, t, cam);
    this.webfx.update(simDt);
  }
  render(dt) { if (this.view?.customRender) this.view.render(dt); else this.renderer.render(this.scene, this.camera); }
}

function gridTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#8a8c88'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#6c6e6b'; x.fillRect(0, 0, 128, 3); x.fillRect(0, 0, 3, 128);
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; x.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
