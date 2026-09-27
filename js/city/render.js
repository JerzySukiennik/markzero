// City renderer: takes over the showroom viewer (ctx.viewer.customRender) with its own
// environment — sky, sun + cascaded shadows, city reflection probe, water reflection, fog,
// bloom, optional GTAO, tone mapping — and restores everything on dispose().
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { CSMShader } from 'three/addons/csm/CSMShader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** The city's look, in linear HDR before tone mapping: split toning (cool shade, warm light — the sun/sky
 *  colour contrast film and Spider-Man's Manhattan lean on), a little saturation and a gentle toe so the
 *  shadows go properly dark instead of milky. Driven by the hour in setHour(). */
const CityGradeShader = {
  name: 'CityGrade',
  uniforms: { tDiffuse: { value: null }, uShadowTint: { value: new THREE.Color(0.96, 1.0, 1.06) }, uLightTint: { value: new THREE.Color(1.04, 1.0, 0.95) },
    uSat: { value: 1.1 }, uToe: { value: 0.06 }, uPivot: { value: 0.18 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 uShadowTint, uLightTint; uniform float uSat, uToe, uPivot; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bool bad = ((floatBitsToUint(c.r) & 0x7f800000u) == 0x7f800000u) || ((floatBitsToUint(c.g) & 0x7f800000u) == 0x7f800000u) || ((floatBitsToUint(c.b) & 0x7f800000u) == 0x7f800000u);
      vec3 col = bad ? vec3(0.0) : clamp(c.rgb, 0.0, 64.0);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float k = smoothstep(uPivot * 0.25, uPivot * 4.0, l);
      col *= mix(uShadowTint, uLightTint, k);
      float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = max(mix(vec3(l2), col, uSat), 0.0);
      col *= l2 / max(l2 + uToe * uPivot, 1e-4) * (1.0 + uToe);        // toe: deepens only the darkest values
      gl_FragColor = vec4(col, c.a);
    }`,
};
import { U } from './materials.js';
import { SkyDome, timeOfDay, LOOK } from './sky.js';
import { Water } from './water.js';

const _chunks = {};

/** RenderPass with a depth pre-pass: the city's facade shader is expensive and street views
 *  have a depth complexity of 4-6, so we lay down depth first (layer 0 only: tiles, world;
 *  cheap props on layer 1 skip it) and then shade each pixel once. */
class PrepassRenderPass extends RenderPass {
  constructor(scene, camera) {
    super(scene, camera);
    this.prepass = false;   // measured: no gain, and transparent surfaces must not write depth
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1.0, polygonOffsetUnits: 2.0 });
    this.depthMat.name = 'city_prepass';
  }
  render(renderer, writeBuffer, readBuffer) {
    if (!this.prepass) return super.render(renderer, writeBuffer, readBuffer);
    const scene = this.scene, cam = this.camera;
    const oldAuto = renderer.autoClear;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.autoClear = false;
    renderer.clear(true, true, false);
    const mask = cam.layers.mask;
    cam.layers.set(0);
    scene.overrideMaterial = this.depthMat;
    renderer.render(scene, cam);
    scene.overrideMaterial = null;
    cam.layers.mask = mask;
    renderer.render(scene, cam);
    renderer.autoClear = oldAuto;
  }
}

export class CityRenderer {
  constructor(ctx, { shadowFar = 1400, cascades = 3, shadowSize = 2048, waterLevel = -2.2,
    probeAt = new THREE.Vector3(0, 140, 0), near = 0.3, far = 20000, reflScale = 0.5 } = {}) {
    this.ctx = ctx;
    // ?cityLook=0: the pre-2026-09-26 city look (HP D3D11 fallback while a render issue is hunted)
    this.look = typeof location === 'undefined' || new URLSearchParams(location.search).get('cityLook') !== '0';
    LOOK.v3 = this.look; U.uLook.value = this.look ? 1 : 0; U.uLitDay.value = this.look ? 0.07 : 0.25;
    const v = this.viewer = ctx.viewer;
    const r = this.renderer = v.renderer;
    this.scene = v.scene; this.camera = v.camera;
    // ---- save what we change
    this._saved = {
      toneMapping: r.toneMapping, exposure: r.toneMappingExposure, shadowType: r.shadowMap.type,
      near: this.camera.near, far: this.camera.far, fov: this.camera.fov,
      background: this.scene.background, environment: this.scene.environment, fog: this.scene.fog,
      envInt: this.scene.environmentIntensity, maxDist: v.controls.maxDistance,
    };
    _chunks.lights_fragment_begin ??= THREE.ShaderChunk.lights_fragment_begin;
    _chunks.lights_pars_begin ??= THREE.ShaderChunk.lights_pars_begin;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.camera.near = near; this.camera.far = far; this.camera.updateProjectionMatrix();
    v.controls.maxDistance = 9000;

    this.root = new THREE.Group(); this.root.name = 'city_env';
    this.scene.add(this.root);
    // ---- sky
    this.sky = new SkyDome();
    this.root.add(this.sky);
    this.skyScene = new THREE.Scene();
    this.skyForProbe = new SkyDome();
    this.skyForProbe.onBeforeRender = () => { };
    this.skyForProbe.position.set(0, 0, 0);
    this.skyScene.add(this.skyForProbe);
    // ---- sun (CSM) + hemisphere fill
    this.csm = new CSM({
      maxFar: shadowFar, cascades, mode: 'practical', parent: this.root, shadowMapSize: shadowSize,
      lightDirection: new THREE.Vector3(-1, -1, -1).normalize(), camera: this.camera,
      lightIntensity: 3, lightNear: 1, lightFar: 5000, lightMargin: 700, shadowBias: -0.00012,
    });
    // The vendored CSMShader.lights_fragment_begin is a copy from an older three: it lacks the
    // r18x `material.dfg = texture2D(dfgLUT, ...)` block, so every IBL specular term was ZERO —
    // metals rendered pure black and glass curtain walls lost their reflections (Jurek's
    // "weirdly black" buildings). Graft the current three prefix onto CSM's light loops.
    {
      const std = _chunks.lights_fragment_begin, csmC = THREE.ShaderChunk.lights_fragment_begin, key = 'IncidentLight directLight;';
      if (csmC !== std && csmC.includes(key) && std.includes(key)) THREE.ShaderChunk.lights_fragment_begin = std.slice(0, std.indexOf(key)) + csmC.slice(csmC.indexOf(key));
    }
    this.csm.fade = true;
    for (const l of this.csm.lights) { l.shadow.normalBias = 0.35; }
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x40362c, 0.0);
    this.root.add(this.hemi);
    // ---- environment: PMREM of (sky) and of (city seen from a probe point)
    this.pmrem = new THREE.PMREMGenerator(r);
    this.probeAt = probeAt;
    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    this.cubeCam = new THREE.CubeCamera(20, 20000, this.cubeRT);
    this.cubeCam.position.copy(probeAt);
    this.envRT = null;
    // ---- water
    this.water = new Water(r, { level: waterLevel, scale: reflScale });
    this.root.add(this.water.mesh);
    // ---- post
    const size = new THREE.Vector2(); r.getDrawingBufferSize(size);
    // [V3] 32-bit float depth (with the renderer's reversed-Z) — see gfx/stage.js; the default was a 24-bit renderbuffer
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType) });
    this.composer = new EffectComposer(r, this.rt);
    this.renderPass = new PrepassRenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.enabled = false;
    this.gtao.blendIntensity = 0.7;
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.6, 0.6, 1.2);
    // bloom at quarter resolution (it is a blur anyway; full-res mips cost ~8 ms at 1440p)
    const bloomSet = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) => bloomSet(Math.max(64, Math.round(w / 2)), Math.max(64, Math.round(h / 2)));
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(CityGradeShader);
    this.grade.enabled = this.look;
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this.materials = new Set();
    this.reflectionHide = []; this.reflectionSwap = [];
    this.renderScale = 1; this.autoScale = false;
    this.hour = 18.9;
    this.tod = timeOfDay(this.hour);
    this._envDirty = true; this._envTimer = 0;
    this.stats = { frame: 0, ms: 0, fps: 0 };
    this.onFrame = null;
    this.exposureMul = 1.0;
    v.customRender = dt => this.render(dt);
    v.usePost = false;
    ctx.env.set('none');
  }

  /** Time-of-day presets (hours). Golden hour is this city's hero light: long shadows, warm stone, sky-lit glass. */
  static PRESETS = { morning: 8.3, noon: 12.8, afternoon: 16.2, golden: 18.2, sunset: 19.1, dusk: 19.7, night: 22.3 };
  /** the hour the game should start at when nothing else asks (world.js: ?hour= / ?tod=<preset> win) */
  static DEFAULT_HOUR = 17.6;
  preset(name, opts) { const h = CityRenderer.PRESETS[name]; if (h != null) this.setHour(h, opts); return h; }

  /** Internal render resolution (1 = native). 'auto' holds ~60 fps by scaling 0.6..1. */
  setRenderScale(s) {
    this.autoScale = s === 'auto';
    this.renderScale = this.autoScale ? (this.renderScale || 1) : s;
    this.resize();
  }

  resize() {
    const r = this.renderer, c = r.domElement;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    const pr = r.getPixelRatio() * (this.renderScale || 1);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.gtao.setSize?.(w * pr, h * pr);
    this.water.setSize(w * pr, h * pr);
    this._lastSize = [w, h, pr];
    this.csm?.updateFrustums();
  }

  /** Register a material so CSM + env map reach it. */
  addMaterial(m) {
    if (this.materials.has(m)) return m;
    this.materials.add(m);
    // CSM.setupMaterial REPLACES onBeforeCompile; run its hook first, then ours
    const mine = m.onBeforeCompile;
    this.csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => { csmHook.call(m, shader, renderer); mine.call(m, shader, renderer); };
    m.needsUpdate = true;
    return m;
  }

  setHour(h, { envNow = false } = {}) {
    this.hour = h;
    const t = this.tod = timeOfDay(h);
    // sun or moon drives the directional light
    const useMoon = t.sun.y < 0.02;
    const L = useMoon ? t.moon : t.sun;
    this.csm.lightDirection.copy(L).multiplyScalar(-1);
    const col = useMoon ? new THREE.Color(0.55, 0.65, 0.9) : t.sunColor;
    const I = useMoon ? t.moonI : t.sunI;
    for (const l of this.csm.lights) { l.color.copy(col); l.intensity = I; }
    this.sky.set(t); this.skyForProbe.set(t);
    U.uNight.value = t.night; U.uLitFrac.value = t.litFrac; U.uInteriorDay.value = t.interiorDay;
    U.uStreetGlow.value = t.streetGlow * 0.55;
    U.uSunDirW.value.copy(L);
    U.uFogDensity.value = t.fogDensity;
    this.renderer.toneMappingExposure = t.exposure * this.exposureMul * (this.adapt ?? 1);
    // bloom only for real highlights: sun glints by day, windows / lamps at night
    // bloom is for lamps and lit windows after dusk; by day / at sunset it only turned the
    // sun's halo into a white-out
    this.bloom.enabled = t.night > 0.3 && this.bloomOn !== false;
    this.bloom.strength = 0.1 + 0.5 * t.night; this.bloom.threshold = THREE.MathUtils.lerp(3.0, 1.05, t.night);
    this.bloom.radius = 0.5;
    { const g = this.grade.uniforms, gold = THREE.MathUtils.clamp(1 - Math.abs(t.el - 10) / 20, 0, 1) * (1 - t.night);
      g.uShadowTint.value.setRGB(0.97 - 0.02 * gold, 1.0, 1.04 + 0.05 * gold).lerp(new THREE.Color(0.92, 0.98, 1.12), t.night * 0.6);
      g.uLightTint.value.setRGB(1.03 + 0.05 * gold, 1.0 + 0.01 * gold, 0.97 - 0.06 * gold).lerp(new THREE.Color(1.06, 0.98, 0.9), t.night * 0.5);
      g.uSat.value = 1.08 + 0.06 * gold - 0.08 * t.night; g.uToe.value = 0.05; }
    // sky fill vs sun: measured 2026-09-24 — at 0.5 the sky PMREM out-lit the sun and every
    // shadow vanished (flat, washed-out noon). The dome is now gain-normalised in updateEnv().
    this.envIntensity = THREE.MathUtils.lerp(this.look ? 0.5 : 0.32, 0.35, t.night) * (this.envMul ?? 1);   // 0.32 left shade at 1:14 of the sun (real open shade 1:4-1:8)
    this._envDirty = true;
    if (envNow) this.updateEnv();
  }

  /** Read the raw sky colour 3 degrees above the horizon, away from and towards the sun.
   *  These become the fog colours, so fog, haze and the dome below the horizon all match. */
  sampleHorizon() {
    const r = this.renderer, t = this.tod;
    if (!this._hz) {
      this._hz = { rt: new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType, depthBuffer: false }),
        cam: new THREE.PerspectiveCamera(4, 1, 1, 30000), buf: new Float32Array(64), ok: true };
    }
    const H = this._hz; if (!H.ok) return null;
    const u = this.skyForProbe.material.uniforms, prevHaze = u.uHaze.value, prevProbe = u.uProbe.value;
    const prevGain = u.uGain.value;
    u.uHaze.value = 0; u.uProbe.value = 0; u.uGain.value = 1;
    const s = t.sun, hx = Math.hypot(s.x, s.z) > 1e-3 ? s.x / Math.hypot(s.x, s.z) : 1, hz = Math.hypot(s.x, s.z) > 1e-3 ? s.z / Math.hypot(s.x, s.z) : 0;
    const out = [];
    const prevRT = r.getRenderTarget();
    try {
      for (const sg of [-1, 1]) {
        H.cam.position.set(0, 0, 0);
        H.cam.lookAt(sg * hx, Math.tan(3 * Math.PI / 180), sg * hz);
        H.cam.updateMatrixWorld();
        r.setRenderTarget(H.rt); r.clear();
        r.render(this.skyScene, H.cam);
        r.readRenderTargetPixels(H.rt, 0, 0, 4, 4, H.buf);
        const c = new THREE.Color(0, 0, 0);
        for (let i = 0; i < 16; i++) { c.r += H.buf[i * 4] / 16; c.g += H.buf[i * 4 + 1] / 16; c.b += H.buf[i * 4 + 2] / 16; }
        out.push(c);
      }
    } catch (e) { H.ok = false; console.warn('city: horizon readback unavailable', e.message); }
    r.setRenderTarget(prevRT);
    u.uHaze.value = prevHaze; u.uProbe.value = prevProbe; u.uGain.value = prevGain;
    return out.length === 2 && H.ok ? out : null;
  }

  /** Sky -> fog colours (readback), sky PMREM (with ground bounce) -> scene.environment. */
  updateEnv() {
    this._envDirty = false;
    const t = this.tod;
    const day = THREE.MathUtils.clamp(t.sun.y * 4 + 0.2, 0, 1);
    const hz = this.sampleHorizon();
    let fogA, fogB, gain = 1;
    if (hz) {
      [fogA, fogB] = hz;
      // The Preetham dome is unitless and ~5x too bright against a 5-lux-ish sun (its sky
      // out-lit the sun: no visible shadows, pale washed noon). Normalise it: the horizon away
      // from the sun gets a target luminance by sun elevation; night keeps its own levels.
      const lum = Math.max(1e-4, fogA.r * 0.2126 + fogA.g * 0.7152 + fogA.b * 0.0722);
      const target = THREE.MathUtils.lerp(0.18, 0.85, THREE.MathUtils.smoothstep(t.el, 0, 25));
      gain = THREE.MathUtils.lerp(THREE.MathUtils.clamp(target / lum, 0.02, 4), 1, t.night);
      fogA.multiplyScalar(gain); fogB.multiplyScalar(gain);
      // towards the sun the 3-degree sample sits in the Mie halo; cap it or the whole
      // sun-side fog turns into a white-out ("sun far too bright")
      const lb = fogB.r * 0.2126 + fogB.g * 0.7152 + fogB.b * 0.0722, la = lum * gain;
      if (lb > 1.6 * la) fogB.multiplyScalar(1.6 * la / lb);
    }
    else {
      fogA = new THREE.Color().setRGB(0.52, 0.60, 0.70).lerp(new THREE.Color(0.85, 0.62, 0.45), THREE.MathUtils.clamp(1 - t.el / 14, 0, 1) * day).lerp(new THREE.Color(0.035, 0.035, 0.045), t.night);
      fogB = fogA.clone().lerp(t.sunColor, 0.4 * day);
    }
    U.uFogColor.value.copy(fogA);
    U.uFogSun.value.copy(fogB);
    this.skyGain = gain;
    // city bounce light for the environment's lower hemisphere (see sky.js): ~ albedo 0.25 x sun on the ground / pi,
    // in the dome's normalised units (horizon ~0.85 at noon), warm; moonlight/streetlight floor at night
    const sunUp = Math.max(0, t.sun.y), bounce = (0.05 + 0.34 * Math.sqrt(sunUp)) * (1 - t.night);
    this.groundBounce = this.look ? new THREE.Color(0.5, 0.42, 0.33).multiply(t.sunColor).multiplyScalar(bounce * 2.0)
      .add(new THREE.Color(0.012, 0.009, 0.006).multiplyScalar(t.night)) : fogA.clone().multiplyScalar(0.16).add(new THREE.Color(0.004, 0.0035, 0.003));
    for (const sk of [this.sky, this.skyForProbe]) {
      sk.material.uniforms.uGround.value.copy(this.groundBounce);
      sk.material.uniforms.uGain.value = gain;
      sk.material.uniforms.uFogA.value.copy(fogA); sk.material.uniforms.uFogB.value.copy(fogB);
    }
    this.skyForProbe.material.uniforms.uProbe.value = 1;
    const skyRT = this.pmrem.fromScene(this.skyScene, 0, 1, 100);
    const skyUp = new THREE.Color(0.18, 0.32, 0.6).multiplyScalar(0.7).lerp(new THREE.Color(0.004, 0.007, 0.016), t.night);
    this.water.set(t, skyUp, fogA);
    this.hemi.intensity = 0.0;
    // environment = the sky itself (a city cube probe from one point gave dark, wrong
    // reflections on glass seen from street level — "weirdly black" buildings)
    this.skyRT?.dispose();
    this.skyRT = skyRT;
    this.envRT = skyRT;
    this.scene.environment = skyRT.texture;
    this.scene.environmentIntensity = this.envIntensity ?? 0.2;
  }

  render(dt) {
    const t0 = performance.now();
    // wrapped: every scroll rate in the water / foam / cloud shaders tiles exactly over 16000 s, so
    // the wrap is invisible and float32 time never loses precision (long sessions made water step)
    U.uTime.value = (U.uTime.value + dt) % 16000;
    this.sky.material.uniforms.uTime.value = U.uTime.value;
    if (this._envDirty) {
      this._envTimer += dt;
      if (this._envTimer > 0.25 || !this.envRT) { this._envTimer = 0; this.updateEnv(); }
    }
    const cam = this.camera;
    cam.updateMatrixWorld();
    // view-space sun for the facade shader (recess shadows)
    U.uSunDirV.value.copy(U.uSunDirW.value).transformDirection(cam.matrixWorldInverse);
    this.csm.update();
    this.updateAdaptation(dt, cam);
    this.onFrame?.(dt);
    this.water.update(this.scene, cam, [this.water.mesh, ...this.reflectionHide], this.reflectionSwap);
    this.composer.render(dt);
    const now = performance.now();
    const ms = now - t0;
    const s = this.stats; s.frame++; s.ms = s.ms * 0.95 + ms * 0.05;
    // dynamic resolution from the real frame-to-frame interval
    if (this._tPrev) {
      const iv = now - this._tPrev;
      s.interval = s.interval ? s.interval * 0.93 + iv * 0.07 : iv;
      // slow + hysteresis: frequent small steps re-sized every target (incl. the water
      // reflection) a few times a second near the threshold, which read as shimmer
      if (this.autoScale && s.frame % 120 === 0) {
        const cur = this.renderScale || 1;
        let nxt = cur;
        if (s.interval > 19.5) nxt = Math.max(0.6, cur - 0.1);
        else if (s.interval < 13.0) nxt = Math.min(1.0, cur + 0.1);
        if (Math.abs(nxt - cur) > 1e-3) { this.renderScale = nxt; this.resize(); }
      }
    }
    this._tPrev = now;
  }

  /** Eye adaptation without a GPU readback: the sky field tells how much sky the camera sees (canyon floor ~0.2,
   *  rooftop / air 1). Canyons get up to +150 % exposure, adapting over ~1.5 s — street level was murky at the
   *  exposure that keeps the skyline from washing out. */
  skyVisAt(p) {
    const F = this.skyField; if (!F) return 1;
    const { data, w, h } = F.tex.userData.cpu, [x0, z0, x1, z1] = F.rect;
    const u = Math.min(w - 1, Math.max(0, Math.round((p.x - x0) / (x1 - x0) * w))), v = Math.min(h - 1, Math.max(0, Math.round((p.z - z0) / (z1 - z0) * h)));
    const i = (v * w + u) * 4, V = data[i] / 255, hM = data[i + 1] / 255 * 300, hC = data[i + 2] / 255 * 450;
    if (p.y < hC - 1) return V;                                  // inside a building (interiors, bases)
    const k = THREE.MathUtils.smoothstep(p.y, hC + 0.5, hC + Math.max(10, (hM - hC) * 1.5 + 6));
    return V + (1 - V) * k;
  }
  updateAdaptation(dt, cam) {
    const vis = this.skyVisAt(cam.position);
    const day = 1 - (this.tod?.night ?? 0);
    const target = !this.look ? 1 : 1 + 1.5 * Math.pow(1 - THREE.MathUtils.smoothstep(vis, 0.12, 0.85), 1.3) * day;
    this.adapt = this.adapt ? this.adapt + (target - this.adapt) * Math.min(1, dt / 1.5) : target;
    if (this.tod) this.renderer.toneMappingExposure = this.tod.exposure * this.exposureMul * this.adapt;
  }

  dispose() {
    const v = this.viewer, r = this.renderer, S = this._saved;
    window.removeEventListener('resize', this._onResize);
    if (v.customRender) v.customRender = null;
    v.usePost = true;
    this.csm.remove(); this.csm.dispose();
    this.scene.remove(this.root);
    this.water.dispose();
    this.composer.dispose?.(); this.rt.dispose(); this.gtao.dispose?.(); this.bloom.dispose?.();
    this.cubeRT.dispose(); this.envRT?.dispose(); this.skyRT?.dispose(); this.pmrem.dispose();
    r.toneMapping = S.toneMapping; r.toneMappingExposure = S.exposure; r.shadowMap.type = S.shadowType;
    this.camera.near = S.near; this.camera.far = S.far; this.camera.fov = S.fov; this.camera.updateProjectionMatrix();
    this.scene.background = S.background; this.scene.environment = S.environment; this.scene.fog = S.fog;
    this.scene.environmentIntensity = S.envInt; v.controls.maxDistance = S.maxDist;
    THREE.ShaderChunk.lights_fragment_begin = _chunks.lights_fragment_begin;
    THREE.ShaderChunk.lights_pars_begin = _chunks.lights_pars_begin;
    for (const m of this.materials) m.dispose();
  }
}
