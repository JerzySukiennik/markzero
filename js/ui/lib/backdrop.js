// Menu backdrop: ONE full-screen pass under every menu. Deliberately calm (Jurek, first pad session:
// no dot-grid wallpaper, no glow blobs, no shimmer): the suit's background colour, a barely-there
// vertical falloff and a soft vignette. The content on top (the dot city, the suit) is the hero.
// Cost: one flat quad, a handful of ALU ops per pixel.
import * as THREE from 'three';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const FS = `
precision highp float;
varying vec2 vUv;
uniform vec3 uBg; uniform float uIntensity;
void main(){
  vec3 c = uBg * (0.92 + 0.22 * (1.0 - vUv.y));            // a touch lighter at the bottom, like a floor
  vec2 q = vUv - 0.5; c *= 1.0 - 0.55 * dot(q, q) * 1.6;   // soft vignette
  gl_FragColor = vec4(c * uIntensity, 1.0);
  #include <colorspace_fragment>
}`;

export class Backdrop {
  constructor(MZ) {
    this.MZ = MZ;
    this.u = { uBg: { value: MZ.theme.c.bg }, uIntensity: { value: 1 } };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.u, depthTest: false, depthWrite: false, toneMapped: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.layer = MZ.stage.addLayer({ scene: this.scene, camera: this.camera, order: 5, clear: false });
    this.visible = true;
  }
  set() { }
  pulse() { }
  focusAt() { }
  show(on) { this.visible = on; this.layer.visible = on; }
  update() { }
}
