// Hero preview stage: the real suit GLBs playing their idle clip on a holographic pad, lit by a PMREM
// room environment + a fixed light rig tinted by the suit theme (fixed pool: lights are created once).
// Switching suits = a "materialise" transition: the old model is cut away top-down, the new one builds
// bottom-up with a glowing edge at the cut (onBeforeCompile on cloned materials — the platform's cached
// materials are never touched).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const LIBS_FOR = s => s === 'hulkbuster' ? ['hulkbuster'] : s === 'ironspider' ? ['spiderman'] : s === 'peter' ? ['spiderman', 'human174'] : ['ironman'];
const IDLE_FOR = s => s === 'peter' ? ['human_idle', 'idle'] : ['idle', 'hover'];
const models = new Map();   // suit id -> Promise<{root, player, height}>
let envTex = null;

const PAD_FS = `
varying vec2 vUv; uniform float uT; uniform vec3 uAcc; uniform vec3 uGlow; uniform float uBuild;
void main(){
  // a calm lit floor: a soft pool of the suit accent and one thin ring — no ticks, sweeps or dot grids
  vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
  float pool = exp(-r * r * 3.2) * 0.22;
  float ring = exp(-pow((r - 0.86) * 70.0, 2.0)) * 0.32;
  vec3 c = uAcc * (pool + ring);
  c += uGlow * uBuild * 0.5 * exp(-pow((r - (1.0 - uBuild)) * 9.0, 2.0));   // one ring expands as a suit builds
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
const BEAM_FS = `
varying vec2 vUv; uniform float uT; uniform vec3 uAcc;
void main(){ float x = abs(vUv.x - 0.5) * 2.0; float a = exp(-x * x * 6.0) * pow(1.0 - vUv.y, 2.0) * 0.16;
  a *= 0.85 + 0.15 * sin(vUv.y * 40.0 - uT * 3.0);
  gl_FragColor = vec4(uAcc * a, 1.0);
  #include <colorspace_fragment>
}`;
const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function addCut(root, U) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map(m => {
      const c = m.clone();
      c.onBeforeCompile = sh => {
        sh.uniforms.uCutY = U.uCutY; sh.uniforms.uCutDir = U.uCutDir; sh.uniforms.uEdge = U.uEdge;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n{ vec4 wp = modelMatrix * vec4(transformed, 1.0); vWY = wp.y; }');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY; uniform float uCutY; uniform float uCutDir; uniform vec3 uEdge;')
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif ((vWY - uCutY) * uCutDir > 0.0) discard;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ float e = exp(-pow((vWY - uCutY) * 26.0, 2.0)); totalEmissiveRadiance += uEdge * e * 6.0; }');
      };
      c.customProgramCacheKey = () => 'mzcut';
      return c;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
    o.frustumCulled = false;
  });
}

export class HeroPreview {
  constructor(MZ, { viewport, order = 30, pool = 'main' } = {}) {
    this.MZ = MZ; this.pool = pool;
    const r = MZ.stage.renderer;
    this.scene = new THREE.Scene();
    if (!envTex) { const pm = new THREE.PMREMGenerator(r); envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
    this.scene.environment = envTex; this.scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    // fixed light rig (never added/removed later)
    this.key = new THREE.DirectionalLight(0xfff1e0, 2.2); this.key.position.set(3, 5, 4);
    this.rimA = new THREE.DirectionalLight(0xffffff, 3.0); this.rimA.position.set(-4, 3, -3);
    this.rimB = new THREE.DirectionalLight(0xffffff, 2.0); this.rimB.position.set(4, 1.5, -4);
    this.fill = new THREE.HemisphereLight(0x8899aa, 0x110808, 0.35);
    this.scene.add(this.key, this.rimA, this.rimB, this.fill);
    const T = MZ.theme.c;
    this.U = { uT: { value: 0 }, uAcc: { value: T.accent }, uGlow: { value: T.glow }, uBuild: { value: 0 } };
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: PAD_FS, uniforms: this.U, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.005; this.pad = pad;
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 6), new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: BEAM_FS, uniforms: this.U, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    beam.position.set(0, 3, -0.9); this.beam = beam; beam.visible = false;   // the light column read as decoration
    this.scene.add(pad, beam);
    this.holder = new THREE.Group(); this.scene.add(this.holder);
    this.cur = null; this.curId = null; this.user = 0; this.frameH = 2; this.frameGoal = 2;
    this.layer = MZ.stage.addLayer({ scene: this.scene, camera: this.camera, order, viewport });
    this.loading = false;
  }
  static preload(MZ, id, pool = 'main') { return HeroPreview._load(MZ, id, pool); }
  // one clone per (suit, pool): a model can only live in one scene at a time
  static _load(MZ, id, pool = 'main') {
    const key = id + '#' + pool;
    if (!models.has(key)) {
      const s = MZ.SUITS.find(x => x.id === id);
      models.set(key, (async () => {
        const g = await MZ.assets.load(s.glb);
        const root = g.scene;
        const U = { uCutY: { value: 10 }, uCutDir: { value: 1 }, uEdge: { value: new THREE.Color(0xffffff) } };
        addCut(root, U);
        let player = null;
        try { player = await MZ.assets.player(root, g, LIBS_FOR(id)); const names = player.list?.() || Object.keys(player.clips || {}); const idle = IDLE_FOR(id).find(n => names.includes(n)); if (idle) player.play(idle, { fade: 0 }); } catch (e) { console.warn('[preview] clips', id, e); }
        player?.update?.(0.016);
        // nanotech suits (Mk 85, Iron Spider): the reference nano shader from the asset package. Idle nano
        // weapons (blades, cannons) stay hidden because their drv_nano_* nodes rest at 0.
        let nano = null;
        let hasNano = false; root.traverse(o => { if (o.isMesh && o.geometry?.attributes?.uv1) hasNano = true; });
        if (hasNano) try { const { NanoController } = await import('/assets/vfx/nano/nano.three.js'); nano = new NanoController(root, { shadows: false }); nano.update(0); } catch (e) { console.warn('[preview] nano', e); }
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root, true);
        const height = id === 'hulkbuster' ? Math.max(1.2, box.max.y - box.min.y) : THREE.MathUtils.clamp(box.max.y - box.min.y, 1.2, 1.95);
        return { root, player, height, U, minY: box.min.y, nano };
      })());
      models.get(key).catch(() => models.delete(key));
    }
    return models.get(key);
  }
  async show(id) {
    if (id === this.curId) return;
    this.curId = id; this.loading = true;
    const old = this.cur;
    if (this.old && this.old !== old) { this.holder.remove(this.old.root); this.old.leaving = false; this.old = null; }
    if (old && !old.entering) { old.leaving = true; old.cutT = 0; this.old = old; }
    let m;
    try { m = await HeroPreview._load(this.MZ, id, this.pool); } catch (e) { console.warn('[preview] load failed', id, e); if (this.curId === id) this.loading = false; this.onState?.('error'); return; }
    if (this.curId !== id) return;
    this.loading = false;
    if (this.old === m) { this.old.leaving = false; this.old = null; }       // came back to the same suit
    else if (old && old !== m && !this.old) this.holder.remove(old.root);  // it was still building: drop it
    m.root.position.y = -m.minY; m.U.uCutDir.value = 1; m.U.uCutY.value = -0.2; m.cutT = 0; m.entering = true;
    if (m.nano) { m.nano.set('drv_nano', 0); this.MZ.audio?.ui?.('ui_suit_change'); }
    this.holder.add(m.root); this.cur = m; this.frameGoal = m.height;
    this.U.uBuild.value = 1;
    this.onState?.('ready');
  }
  hide(on = true) { this.layer.visible = !on; }
  destroy() { this.layer.remove(); for (const m of this.holder.children.slice()) this.holder.remove(m); }
  update(dt, t, rsX = 0) {
    const T = this.MZ.theme.c;
    this.U.uT.value = t; this.U.uBuild.value *= Math.exp(-2.5 * dt);
    this.rimA.color.copy(T.accent); this.rimB.color.copy(T.glow); this.key.intensity = 2.0;
    // spin: right stick drives it, otherwise a slow turntable
    // showcase sway around a 3/4 front view; the right stick spins it freely, then it eases back
    if (Math.abs(rsX) > 0.05) { this.user += rsX * dt * 3.2; this.idleT = 0; } else { this.idleT = (this.idleT || 0) + dt; if (this.idleT > 2.5) this.user *= Math.exp(-1.2 * dt); }
    this.sway = Math.PI + Math.sin(t * 0.32) * 0.42 - 0.3;   // the rigs face -Z
    this.holder.rotation.y = this.sway + (this.user || 0);
    const m = this.cur;
    if (m) {
      m.player?.update?.(dt); m.nano?.update(dt);
      // build-up, ≤ 1.1 s, bottom to top for EVERY mesh (so helmet + reactor arrive last, never floating);
      // nanotech suits additionally pour on with the nano shader over the same window
      if (m.entering) {
        m.cutT = Math.min(1, m.cutT + Math.min(dt, 1 / 30) / 1.1);
        const k = 1 - Math.pow(1 - m.cutT, 3);
        m.U.uCutY.value = -0.1 + k * (m.height + 0.4); m.U.uEdge.value.copy(T.glow);
        m.nano?.set('drv_nano', Math.min(1, m.cutT * 1.25));
        if (m.cutT >= 1) { m.entering = false; m.U.uCutY.value = 50; m.nano?.set('drv_nano', 1); }
      }
    }
    const o = this.old;
    if (o?.leaving) { o.player?.update?.(dt); o.cutT = Math.min(1, o.cutT + dt / 0.4); o.U.uCutY.value = (1 - o.cutT) * (o.height + 0.2); o.U.uEdge.value.copy(T.accent); if (o.cutT >= 1) { this.holder.remove(o.root); o.leaving = false; this.old = null; } }
    this.frameH += (this.frameGoal - this.frameH) * (1 - Math.exp(-4 * dt));
    const H = this.frameH, dist = H * 2.95 + 1.4;
    this.camera.position.set(0, H * 0.62, dist); this.camera.lookAt(0, H * 0.5, 0);
    this.pad.scale.setScalar(Math.max(1, H / 1.9));
  }
}
