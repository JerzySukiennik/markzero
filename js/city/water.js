// River / harbour water: planar reflection (mirrored camera, oblique clip plane, reduced
// resolution) + two scrolling normal maps + Fresnel + sun glint + shoreline foam from a
// shore-distance field. Mirrors assets/city/godot/water.gdshader.
import * as THREE from 'three';
import { U, GLSL_COMMON } from './materials.js';

const VERT = /* glsl */`
uniform mat4 uTexMat;
varying vec3 vCityW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vCityW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */`
${GLSL_COMMON}
uniform sampler2D uRefl, uNormA, uNormB, uShore;
uniform vec4 uShoreRect;           // x0, z0, x1, z1 of the shore field
uniform float uHasRefl, uLevel;
uniform vec3 uSunColor, uSkyUp, uSkyHorizon, uDeep, uShallow;
uniform mat4 uTexMat;
void main() {
  vec2 p = vCityW.xz;
  float t = uTime;
  vec3 dist = cameraPosition - vCityW;
  float d = length(dist);
  vec3 V = dist / d;
  // three layers at unrelated scales AND rotations (no shared grid), macro noise modulating
  // their strength (calm slicks vs. choppy patches), high frequencies fading with distance
  float macro = texture(uNoise, p / 2600.0).r;
  float macro2 = texture(uNoise, p / 780.0 + 0.37).g;
  const mat2 R1 = mat2(0.7986, -0.6018, 0.6018, 0.7986);
  const mat2 R2 = mat2(-0.3420, -0.9397, 0.9397, -0.3420);
  vec2 warp = (texture(uNoise, p / 300.0).rg - 0.5) * 0.35;
  vec3 a = texture(uNormA, p / 131.0 + warp + vec2(t * 0.0100, t * 0.0060)).rgb * 2.0 - 1.0;
  vec3 b = texture(uNormB, (R1 * p) / 43.0 - warp * 0.7 + vec2(-t * 0.0180, t * 0.0130)).rgb * 2.0 - 1.0;
  vec3 c = texture(uNormA, (R2 * p) / 14.3 + vec2(t * 0.031, -t * 0.022)).rgb * 2.0 - 1.0;
  float fadeC = 1.0 - smoothstep(80.0, 900.0, d);
  float fadeB = 1.0 - 0.7 * smoothstep(400.0, 3000.0, d);
  float chop = mix(0.35, 1.2, smoothstep(0.2, 0.8, macro)) * mix(0.8, 1.15, macro2);
  float flat_ = smoothstep(300.0, 4000.0, d);
  // the 131 m layer is a swirly map: kept weak so it breaks tiling without reading as marble
  vec2 nxy = (a.xy * 0.4 + b.xy * 0.7 * fadeB + c.xy * 0.55 * fadeC) * chop * mix(0.5, 0.2, flat_);
  vec3 N = normalize(vec3(nxy.x, 1.0, nxy.y));
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
  // reflection
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyUp, pow(max(R.y, 0.0), 0.5));
  vec3 refl = sky;
  if (uHasRefl > 0.5) {
    vec4 rp = uTexMat * vec4(vCityW, 1.0);   // per pixel: a per-vertex projective coord on km-sized
    // triangles lost precision and made the reflection swim/shake (Jurek on the HP: "woda się trzęsie")
    vec2 ruv = rp.xy / rp.w + nxy * mix(0.06, 0.012, flat_) * clamp(40.0 / (d * 0.1 + 4.0), 0.2, 1.0);
    refl = texture(uRefl, ruv).rgb;
  }
  // water body: deep teal-grey, shallower (greener, brighter) near the shore
  float sd = 999.0;
  vec2 sq = (p - uShoreRect.xy) / (uShoreRect.zw - uShoreRect.xy);
  if (all(greaterThan(sq, vec2(0.0))) && all(lessThan(sq, vec2(1.0)))) sd = texture(uShore, sq).r * 200.0;
  float shallow = exp(-sd / 18.0);
  vec3 body = mix(uDeep, uShallow, shallow) * (0.25 + 0.75 * dot(uSkyUp, vec3(0.333)) * 3.0);
  body *= 0.6 + 0.4 * max(dot(N, uSunDirW), 0.0);
  vec3 col = mix(body, refl, fres);
  // sun glint: sharp core + broad sheen
  vec3 H = normalize(uSunDirW + V);
  float nh = max(dot(N, H), 0.0);
  col += min(uSunColor * (pow(max(nh, 0.0), 900.0) * 14.0 + pow(max(nh, 0.0), 90.0) * 0.5), vec3(10.0)) * step(0.0, uSunDirW.y);
  // shoreline foam
  float fz = smoothstep(7.0, 0.5, sd);
  float fn = fbm3(p * 0.35 + vec2(t * 0.25, t * 0.12)) * 0.7 + fbm3(p * 1.3 - t * 0.2) * 0.3;
  float foam = fz * smoothstep(0.45 - fz * 0.35, 0.75, fn);
  col = mix(col, vec3(0.75, 0.78, 0.8) * (0.3 + 0.7 * dot(uSkyUp, vec3(0.333)) * 3.0 + uStreetGlow * 0.05), foam * 0.85);
  gl_FragColor = vec4(cityFog(col, vCityW), 1.0);
}`;

export class Water {
  constructor(renderer, { size = 30000, level = -2.2, scale = 0.5 } = {}) {
    this.renderer = renderer;
    this.level = level;
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, depthBuffer: true, depthTexture: new THREE.DepthTexture(8, 8, THREE.FloatType) });   // [V3] 32f depth, reversed-Z
    this.rt.texture.generateMipmaps = false;
    this.cam = new THREE.PerspectiveCamera();
    this._inv = new THREE.Matrix4();
    // match the renderer's depth convention up front: it would otherwise flip the flag on first use and rebuild the
    // projection, wiping the oblique near plane below
    this.cam._reversedDepth = !!renderer.state?.buffers?.depth?.getReversed?.();
    this.cam.layers.set(0);                  // layer 0 only: buildings, ground, sky (no props)
    this.texMat = new THREE.Matrix4();
    this.enabled = true;
    // a subdivided grid that follows the camera, snapped to whole cells: one 30 km quad made the
    // interpolated world position (all wave UVs derive from it) jitter by decimetres near the
    // camera, which read as shaking water
    this.cell = size / 160;
    const geo = new THREE.PlaneGeometry(size, size, 160, 160).rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      name: 'city_water', vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        ...U,
        uTexMat: { value: this.texMat }, uRefl: { value: this.rt.texture }, uHasRefl: { value: 1 },
        uNormA: { value: null }, uNormB: { value: null }, uShore: { value: null },
        uShoreRect: { value: new THREE.Vector4(-1, -1, 1, 1) }, uLevel: { value: level },
        uSunColor: { value: new THREE.Color(1, 1, 1) }, uSkyUp: { value: new THREE.Color(0.2, 0.3, 0.45) },
        uSkyHorizon: { value: new THREE.Color(0.5, 0.55, 0.6) },
        uDeep: { value: new THREE.Color(0.018, 0.035, 0.04) }, uShallow: { value: new THREE.Color(0.04, 0.07, 0.06) },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = level;
    this.mesh.name = 'city_water';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    this._plane = new THREE.Plane();
    this._v = new THREE.Vector3(); this._q = new THREE.Vector4(); this._cp = new THREE.Vector4();
  }

  setSize(w, h) { this.rt.setSize(Math.max(8, Math.round(w * this.scale)), Math.max(8, Math.round(h * this.scale))); }

  /** Render the mirrored view. `hide` = objects to hide during the pass (the water itself…). */
  update(scene, camera, hide = [], swap = []) {
    const c = this.cell;
    this.mesh.position.set(Math.round(camera.position.x / c) * c, this.level, Math.round(camera.position.z / c) * c);
    this.mesh.updateMatrixWorld();
    if (!this.enabled || camera.position.y < this.level) { this.material.uniforms.uHasRefl.value = 0; return; }
    this.material.uniforms.uHasRefl.value = 1;
    const cam = this.cam, y = this.level;
    // mirror the camera across y = level
    cam.position.copy(camera.position); cam.position.y = 2 * y - camera.position.y;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    fwd.y = -fwd.y; up.y = -up.y;
    cam.up.copy(up);
    cam.lookAt(cam.position.clone().add(fwd));
    cam.fov = camera.fov; cam.aspect = camera.aspect; cam.near = camera.near; cam.far = camera.far;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // texture matrix: world -> reflection uv
    this.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMat.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // oblique near plane = the water plane (Lengyel), so nothing under water is reflected
    this._plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, y + 0.05, 0));
    this._plane.applyMatrix4(cam.matrixWorldInverse);
    const cp = this._cp.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const pm = cam.projectionMatrix, q = this._q, e = pm.elements;
    if (cam.reversedDepth) {
      // reversed-Z [0,1] (gfx/stage.js, 147badf): near is z = w, far z = 0. New z row = w-row - a*C, with a chosen so
      // the far plane still passes through the frustum corner Q opposite the clip plane (Lengyel, re-derived).
      const Q = this._qv || (this._qv = new THREE.Vector4());
      Q.set(Math.sign(cp.x), Math.sign(cp.y), 0, 1).applyMatrix4(this._inv.copy(pm).invert());
      const m4 = e[3] * Q.x + e[7] * Q.y + e[11] * Q.z + e[15] * Q.w, cq = cp.dot(Q);
      const k = Math.abs(cq) > 1e-9 ? m4 / cq : 0;
      e[2] = e[3] - k * cp.x; e[6] = e[7] - k * cp.y; e[10] = e[11] - k * cp.z; e[14] = e[15] - k * cp.w;
    } else {
      q.x = (Math.sign(cp.x) + e[8]) / e[0];
      q.y = (Math.sign(cp.y) + e[9]) / e[5];
      q.z = -1.0;
      q.w = (1.0 + e[10]) / e[14];
      cp.multiplyScalar(2.0 / cp.dot(q));
      e[2] = cp.x; e[6] = cp.y; e[10] = cp.z + 1.0; e[14] = cp.w;
    }
    // render
    const r = this.renderer;
    const prevRT = r.getRenderTarget(), prevXR = r.xr.enabled, prevShadow = r.shadowMap.autoUpdate;
    const vis = hide.map(o => o.visible);
    hide.forEach(o => o.visible = false);
    const mats = swap.map(([o, m]) => { const old = o.material; o.material = m; return old; });
    r.xr.enabled = false; r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(prevRT);
    r.xr.enabled = prevXR; r.shadowMap.autoUpdate = prevShadow;
    hide.forEach((o, i) => o.visible = vis[i]);
    swap.forEach(([o], i) => { o.material = mats[i]; });
  }

  set(tod, skyUp, skyHorizon) {
    const u = this.material.uniforms;
    u.uSunColor.value.copy(tod.sunColor).multiplyScalar(tod.sunI * 0.8 + tod.moonI * 0.3);
    u.uSkyUp.value.copy(skyUp); u.uSkyHorizon.value.copy(skyHorizon);
  }

  dispose() { this.rt.dispose(); this.mesh.geometry.dispose(); this.material.dispose(); }
}
