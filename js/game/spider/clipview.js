// Spider-Man clip viewer — /js/game/spider/clipview.html[?suit=ironspider]
// The Iron Spider suit on the spider_core (+ human_core_174) clip library in a neutral studio, for
// contact sheets of clip frames (tests/game/spider_clips.mjs drives it headless; window.CV):
//   CV.clips            → [{name, duration}]
//   CV.pose(name, t)    → pose the rig at time t (s) of a clip (root motion kept)
//   CV.view({az, el, dist, y, fov})   camera orbit about the pelvis height (az 0 = in front of him, deg)
//   CV.shot()           → dataURL (jpeg)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { NanoController } from '../fx/nano.js';

const Q = new URLSearchParams(location.search);
const suit = Q.get('suit') || 'ironspider';
const canvas = document.getElementById('gl'), hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a313c);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3228, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(3, 6, 4); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 }); scene.add(sun);
const rim = new THREE.DirectionalLight(0x9fc3ff, 1.2); rim.position.set(-4, 3, -5); scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3b4350, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(40, 40, 0x6a7686, 0x4a5462); grid.position.y = 0.002; scene.add(grid);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 200);

const loader = new GLTFLoader();
const load = async url => { const [g, meta] = await Promise.all([loader.loadAsync(url), fetch(url + '.clips.json').then(r => r.ok ? r.json() : null).catch(() => null)]); return { g, meta }; };
const [body, lib, human] = await Promise.all([load(`/assets/suits/${suit}/${suit}.glb`), load('/assets/anims/spider_core.glb'), load('/assets/anims/human_core_174.glb').catch(() => null)]);
const root = SkeletonUtils.clone(body.g.scene); scene.add(root);
root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } if (o.isSkinnedMesh) o.frustumCulled = false; });
let nano = null; try { let has = false; root.traverse(o => { if (o.isMesh && o.geometry?.attributes?.uv1) has = true; }); if (has) { nano = new NanoController(root); nano.update(0); } } catch { }
const have = new Set(); root.traverse(o => o.name && have.add(o.name));
const all = [...lib.g.animations, ...(human?.g.animations || []).filter(c => c.name === 'human_walk')];
const clips = {}; for (const c of all) clips[c.name] = new THREE.AnimationClip(c.name, c.duration, c.tracks.filter(t => have.has(t.name.split('.')[0])));
const meta = {}; for (const m of [lib.meta, human?.meta]) for (const c of m?.clips || []) meta[c.name] = c;
const mixer = new THREE.AnimationMixer(root);
let current = null;
const hips = root.getObjectByName('piv_hips');
let view = { az: 90, el: 8, dist: 4.2, y: 0.9, fov: 35, tx: 0, tz: 0 };

window.CV = {
  THREE, root, scene, camera, renderer, meta,
  clips: Object.values(clips).map(c => ({ name: c.name, duration: c.duration })),
  pose(name, t) {
    const c = clips[name]; if (!c) return false;
    if (current) current.stop();
    current = mixer.clipAction(c); current.reset(); current.play(); current.setEffectiveWeight(1);
    current.time = Math.min(t, c.duration - 1e-4); mixer.update(0);
    root.updateMatrixWorld(true); nano?.update(0);
    return true;
  },
  /** follow the pelvis (x/z) so root-motion clips stay framed */
  view(o = {}) { view = { ...view, ...o }; return view; },
  shot() {
    const hp = hips ? hips.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const tx = view.follow === false ? view.tx : hp.x, tz = view.follow === false ? view.tz : hp.z, ty = view.y ?? hp.y;
    const az = view.az * Math.PI / 180, el = view.el * Math.PI / 180;
    camera.fov = view.fov; camera.aspect = canvas.width / canvas.height; camera.updateProjectionMatrix();
    // az 0 = in front of him (he faces -Z), 90 = his right side
    camera.position.set(tx - Math.sin(az) * Math.cos(el) * view.dist * -1, ty + Math.sin(el) * view.dist, tz - Math.cos(az) * Math.cos(el) * view.dist);
    camera.lookAt(tx, ty, tz);
    renderer.render(scene, camera);
    return canvas.toDataURL('image/jpeg', 0.88);
  },
  resize(w, h) { renderer.setSize(w, h, false); },
};
hud.textContent = `${suit} · ${CV.clips.length} clips`;
window.CV_READY = true;
