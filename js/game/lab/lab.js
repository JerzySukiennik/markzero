// Gameplay lab — /js/game/lab/lab.html?hero=ironman&suit=mk85[&city=1][&x=..&y=..&z=..&yaw=..]
// A pad-driven sandbox for the hero controllers, and the harness the headless shot tool drives:
//   lab.sim(seconds, {axes, hold:[buttons], tap:[buttons], each(t)})  deterministic 60 Hz steps
//   lab.render()  lab.strip(frames, every)  lab.player  lab.world
// Keyboard (dev only): WASD = left stick, arrows = right stick, Space = ✕, Shift = R2, Q/E = L1/R1…
import * as THREE from 'three';
import { Input } from '../../core/input.js';
import { Bindings } from '../../core/bindings.js';
import { Haptics } from '../../core/haptics.js';
import { Audio } from '../../core/audio.js';
import { Assets } from '../../core/assets.js';
import { SUITS } from '../../core/theme.js';
import { LabWorld } from './labworld.js';
import { createPlayer } from '../index.js';

const Q = new URLSearchParams(location.search);
const hero = Q.get('hero') || 'ironman', suit = Q.get('suit') || (hero === 'spiderman' ? 'ironspider' : 'mk85');
const canvas = document.getElementById('gl'), hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));

// a minimal MZ: the pieces a controller touches
const listeners = new Map();
const input = new Input(); input.context = 'game';
const bindings = new Bindings();
const MZ = {
  THREE, params: Q, input, bindings, SUITS, haptics: new Haptics(input), audio: new Audio(), assets: new Assets(),
  on(t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); return () => listeners.get(t)?.delete(fn); },
  emit(t, d) { for (const fn of listeners.get(t) || []) fn(d); },
  net: { id: 'local' },
};
const ZERO = { lx: 0, ly: 0, rx: 0, ry: 0 };
MZ.actions = h => {
  const b = a => bindings.btn(h, a), live = () => input.context === 'game';
  return {
    down: a => live() && !!input.down(b(a)), pressed: a => live() && !!input.pressed(b(a)),
    released: a => live() && !!input.state[b(a)]?.released, value: a => live() ? input.value(b(a)) : 0,
    heldMs: a => live() && input.down(b(a)) ? performance.now() - input.state[b(a)].t : 0,
    get axes() { return live() ? input.axes : ZERO; },
  };
};
const events = [];
MZ.on('game:event', e => { events.push(e); if (events.length > 200) events.shift(); });
await Promise.all([MZ.haptics.init(), MZ.audio.init()]);
addEventListener('pointerdown', () => MZ.audio.unlock()); addEventListener('keydown', () => MZ.audio.unlock());

// ?glb=<url>: override the suit's GLB (A/B of asset versions, lab only)
if (Q.get('glb')) { const e = SUITS.find(x => x.id === suit); if (e) e.glb = Q.get('glb'); }
const spawnP = Q.get('x') ? new THREE.Vector3(+Q.get('x'), +Q.get('y'), +Q.get('z')) : null;
const world = await new LabWorld(MZ, renderer, { realCity: Q.get('city') === '1', center: spawnP ? spawnP.clone().setY(0) : undefined }).load();
const player = await createPlayer(MZ, world, { id: 'local', name: 'lab', hero, suit, local: true, spawn: spawnP ? { pos: spawnP, yaw: +(Q.get('yaw') || 0) } : null });

// ?buddy=1: a remote Iron Man flying a slow circle near the hero (tether / co-op tests)
world.labPlayers = [player];
let buddy = null;
if (Q.get('buddy')) {
  buddy = await createPlayer(MZ, world, { id: 'buddy', name: 'buddy', hero: 'ironman', suit: 'mk85', local: false });
  world.labPlayers.push(buddy);
  buddy.path = t => { const c = player.pos || player.m.position, a = t * 0.35; return { p: [c0.x + Math.sin(a) * 40, c0.y + 18, c0.z - 30 + Math.cos(a) * 40], v: [Math.cos(a) * 14, 0, -Math.sin(a) * 14], yaw: Math.atan2(-Math.cos(a), Math.sin(a)) }; };
}
const c0 = (player.pos || player.m.position).clone();
function driveBuddy(t) {
  if (!buddy) return;
  const s = buddy.path(t), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.yaw, 0, 'YXZ'));
  buddy.applyState({ p: s.p, q: q.toArray(), v: s.v, th: 0.9, f: 0, gs: 0, bk: 0, c: [0, 0, 0] });
}
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); world.camera.aspect = w / h; world.camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// keyboard → sticks (dev fallback)
const K = new Set();
addEventListener('keydown', e => K.add(e.code)); addEventListener('keyup', e => K.delete(e.code));
function keyAxes() {
  const ax = (a, b) => (K.has(a) ? -1 : 0) + (K.has(b) ? 1 : 0);
  if (!K.size) return null;
  return { lx: ax('KeyA', 'KeyD'), ly: ax('KeyW', 'KeyS'), rx: ax('ArrowLeft', 'ArrowRight'), ry: ax('ArrowUp', 'ArrowDown') };
}

let T = 0, scripted = null;
function step(dt) {
  if (scripted) { input.setAxes(scripted.axes || ZERO); for (const b of scripted.hold || []) input.virtual.set(b, 2); }
  else { const k = keyAxes(); input._vAxes = k && (k.lx || k.ly || k.rx || k.ry) ? k : null; }
  input.poll(performance.now());
  const sim = world.timeScale(dt);
  T += dt;
  driveBuddy(T); buddy?.update(sim, T);
  player.update(sim, T);
  world.update(sim, dt, T, player);
  MZ.audio.update(world.camera);
}
function hudText() {
  const h = player.hud();
  hud.textContent = `${hero} ${suit}  ${h.speed.toFixed(1)} m/s  vy ${h.vspeed.toFixed(1)}  alt ${h.alt.toFixed(1)}  ${h.grounded ? 'GROUND' : h.hover ? 'HOVER' : 'FLY'}  thr ${(h.throttle ?? 0).toFixed(2)}  ${player.anim?.dominant || ''}`;
}
let last = performance.now(), live = true;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (live) { step(dt); world.render(dt); hudText(); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.lab = {
  MZ, world, player, events, THREE, get buddy() { return buddy; },
  get T() { return T; },
  pause() { live = false; }, resume() { live = true; last = performance.now(); },
  /** deterministic: step `seconds` at 60 Hz with the given sticks/buttons; `each(t)` may change them */
  sim(seconds, o = {}) {
    live = false; const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      scripted = { axes: o.axes, hold: o.hold || [] };
      if (i === 0) for (const b of o.tap || []) input.virtual.set(b, 2);
      o.each?.(i / 60, scripted);
      step(1 / 60);
    }
    scripted = null; input.setAxes(null); input._vAxes = null; world.render(1 / 60); hudText();
    return player.hud();
  },
  render() { world.render(0); hudText(); },
  /** render from a camera placed relative to the hero in its yaw frame (x right, y up, z back) */
  close(x = 2.2, y = 1.2, z = 3.2, lookY = 1.0, fov = 45) {
    const cam = world.camera, save = { p: cam.position.clone(), q: cam.quaternion.clone(), f: cam.fov };
    const r = player.root, yaw = new THREE.Euler().setFromQuaternion(r.quaternion, 'YXZ').y;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    cam.position.copy(r.position).add(new THREE.Vector3(x, y, z).applyQuaternion(q));
    cam.fov = fov; cam.updateProjectionMatrix(); cam.lookAt(r.position.clone().add(new THREE.Vector3(0, lookY, 0)));
    world.render(0); const url = canvas.toDataURL('image/png');
    cam.position.copy(save.p); cam.quaternion.copy(save.q); cam.fov = save.f; cam.updateProjectionMatrix();
    return url;
  },
  /** strip of close-ups: n frames, `every` steps apart */
  closeStrip(n, every, o = {}, cp = [2.2, 1.2, 3.2, 1.0, 45], w = 400, h = 300) {
    const c = document.createElement('canvas'); c.width = w * n; c.height = h; const x = c.getContext('2d');
    const img = new Image();
    const shots = [];
    for (let i = 0; i < n; i++) { this.sim(every / 60, i ? { ...o, tap: [] } : o); shots.push([this.close(...cp), T, player.anim?.dominant]); }
    return Promise.all(shots.map(([u]) => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = u; }))).then(ims => {
      ims.forEach((im, i) => { const sh = im.height, sw = sh * w / h; x.drawImage(im, (im.width - sw) / 2, 0, sw, sh, i * w, 0, w, h); x.fillStyle = '#fff'; x.font = '13px monospace'; x.fillText(`${shots[i][1].toFixed(2)}s ${shots[i][2] || ''}`, i * w + 6, 16); });
      return c.toDataURL('image/png');
    });
  },
  /** n frames every `every` sim-steps (same script as sim) → one horizontal strip PNG dataURL */
  strip(n, every, o = {}, w = 400, h = 225) {
    const c = document.createElement('canvas'); c.width = w * n; c.height = h; const x = c.getContext('2d');
    for (let i = 0; i < n; i++) { this.sim(every / 60, i ? { ...o, tap: [] } : o); x.drawImage(canvas, i * w, 0, w, h); x.fillStyle = '#fff'; x.font = '14px monospace'; x.fillText(`${(T).toFixed(2)}s ${player.anim?.dominant || ''}`, i * w + 6, 18); }
    return c.toDataURL('image/png');
  },
  ready: true,
};
