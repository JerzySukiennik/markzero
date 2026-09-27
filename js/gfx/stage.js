// The one WebGL renderer. Draws the world (if loaded) through its own post stack, then the UI's 3D
// layers (dot map, minimap viewport, hero previews) on top. See docs/UI-CONTRACT.md §MZ.stage.
import * as THREE from 'three';
import { devPost } from '../core/env.js';

/** Minimal stand-in for the showroom Viewer, which the copied city renderer expects. */
class Controls { constructor() { this.target = new THREE.Vector3(); this.enabled = false; this.maxDistance = 1e5; } update() { } }
export class WorldView {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 20000);
    this.controls = new Controls();
    this.envRoot = new THREE.Group(); this.scene.add(this.envRoot);
    this.customRender = null; this.usePost = false; this.envName = 'none';
  }
  async setEnv(n) { this.envName = n; }
  resize() { }
  render(dt) { if (this.customRender) this.customRender(dt); else this.renderer.render(this.scene, this.camera); }
}

export class Stage {
  constructor(canvas) {
    // Reversed-Z + 32-bit float depth in the world's render targets (city/render.js, water.js): ANGLE→D3D11 on the HP
    // has a true 24-bit depth buffer, and with near 0.3 / far 20 km the depth step is ~0.2 m at 1 km and ~10 m at 7 km
    // → cornices, detail meshes and the far skyline z-fought (Jurek: "buildings flicker, you see into another
    // dimension"). Metal quietly used 32-bit float, so the Mac never showed it. ?noreverse=1 to compare.
    const reversed = !new URLSearchParams(location.search).has('noreverse');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true, reversedDepthBuffer: reversed });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(0x000000, 0);
    r.info.autoReset = false;
    this.renderScale = 1;
    this.layers = [];
    this.world = null;         // WorldView while a world is loaded
    this.size = { w: 1, h: 1, dpr: 1 };
    // Context loss. On the HP it is a real driver reset (Windows TDR, nvlddmkm event 153 — seen in Jurek's Spider-Man
    // sessions): the canvas goes WHITE until the context is back. Old behaviour reloaded the page on restore (= "white
    // world, then back to the menu"). Now: a plain overlay, three.js restores its own resources, the game continues;
    // only if nothing renders 6 s after the restore do we reload.
    this.lost = false;
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault(); this.lost = true; console.error('[stage] WebGL context lost');
      this._overlay(true);
      devPost('/api/stats', { client: 'ctx', label: 'webglcontextlost', ua: navigator.userAgent });
    });
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[stage] WebGL context restored');
      this.lost = false; this._restoredAt = performance.now(); this._framesSinceRestore = 0;
      devPost('/api/stats', { client: 'ctx', label: 'webglcontextrestored' });
      // rebuild the world (GPU-side state is gone); only reload the page if that is impossible
      if (this.onRestore) Promise.resolve(this.onRestore()).catch(() => location.reload()).finally(() => this._overlay(false));
      else setTimeout(() => { if (this._framesSinceRestore < 10) location.reload(); else this._overlay(false); }, 6000);
    });
    this._resize = () => this.resize();
    addEventListener('resize', this._resize);
    this.resize();
  }
  resize() {
    const c = this.renderer.domElement, w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2) * this.renderScale;
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.size = { w, h, dpr };
    if (this.world) { this.world.camera.aspect = w / h; this.world.camera.updateProjectionMatrix(); }
    for (const L of this.layers) L.onResize?.(w, h);
    this.onResize?.(w, h);
  }
  setRenderScale(s) { this.renderScale = s; this.resize(); }
  createWorld() { this.world = new WorldView(this.renderer); this.resize(); return this.world; }
  destroyWorld() { this.world = null; }

  /** UI 3D layer. viewport: null (full screen) or () => ({x, y, w, h}) in CSS px from the top-left. */
  addLayer({ scene, camera, order = 100, viewport = null, clear = false, visible = true, onResize = null }) {
    const L = { scene, camera, order, viewport, clear, visible, onResize };
    L.remove = () => { this.layers = this.layers.filter(x => x !== L); };
    L.set = o => Object.assign(L, o);
    this.layers.push(L); this.layers.sort((a, b) => a.order - b.order);
    return L;
  }

  _overlay(on) {
    let el = document.getElementById('gl-lost');
    if (on && !el) { el = document.createElement('div'); el.id = 'gl-lost'; el.style.cssText = 'position:fixed;inset:0;background:#07080a;color:#cfd6de;display:grid;place-items:center;font:500 20px/1.4 system-ui,sans-serif;letter-spacing:.08em;z-index:50'; el.textContent = 'GRAPHICS DRIVER RESET — RECOVERING…'; document.body.appendChild(el); }
    if (!on && el) el.remove();
  }
  render(dt) {
    const r = this.renderer;
    if (this.lost) return;
    if (this._restoredAt) this._framesSinceRestore++;
    r.info.reset();
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.w, this.size.h);
    if (this.world && this.world.visible !== false) this.world.render(dt);
    else { r.setClearColor(0x000000, 0); r.clear(); }
    const tm = r.toneMapping;
    for (const L of this.layers) {
      if (!L.visible) continue;
      r.autoClear = false;
      let vp = null;
      if (L.viewport) {
        vp = L.viewport(); if (!vp || vp.w < 2 || vp.h < 2) continue;
        const y = this.size.h - vp.y - vp.h;
        r.setViewport(vp.x, y, vp.w, vp.h); r.setScissor(vp.x, y, vp.w, vp.h); r.setScissorTest(true);
        if (L.camera.isPerspectiveCamera) { const a = vp.w / vp.h; if (Math.abs(L.camera.aspect - a) > 1e-3) { L.camera.aspect = a; L.camera.updateProjectionMatrix(); } }
      } else {
        r.setViewport(0, 0, this.size.w, this.size.h); r.setScissorTest(false);
      }
      if (L.clear) r.clear(); else r.clearDepth();
      r.render(L.scene, L.camera);
      r.setScissorTest(false);
      r.autoClear = true;
    }
    r.toneMapping = tm;
  }
}
