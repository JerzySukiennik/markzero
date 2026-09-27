// Free-fly camera: WASD + mouse (drag, or click for pointer lock), Q/E or Space/C down/up,
// Shift = fast, wheel = speed. Plus scripted tours. Works on top of the showroom's
// OrbitControls by disabling them and keeping their target just ahead of the camera.
import * as THREE from 'three';

export class FlyCam {
  constructor(ctx) {
    this.ctx = ctx;
    this.cam = ctx.camera;
    this.controls = ctx.controls;
    this.enabled = false;
    this.speed = 40;
    this.keys = new Set();
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.tour = null; this.tourT = 0;
    this.walkY = null;
    this._savedCtl = { enabled: this.controls.enabled };
    const el = ctx.renderer.domElement;
    this.el = el;
    this._kd = e => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (this.enabled && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space'].includes(e.code)) { this.stopTour(); e.preventDefault(); }
    };
    this._ku = e => this.keys.delete(e.code);
    this._md = e => { if (!this.enabled) return; this.drag = { x: e.clientX, y: e.clientY }; this.stopTour(); };
    this._mu = () => { this.drag = null; };
    this._mm = e => {
      if (!this.enabled) return;
      let dx = 0, dy = 0;
      if (document.pointerLockElement === el) { dx = e.movementX; dy = e.movementY; }
      else if (this.drag) { dx = e.clientX - this.drag.x; dy = e.clientY - this.drag.y; this.drag = { x: e.clientX, y: e.clientY }; }
      else return;
      this.yaw -= dx * 0.0025; this.pitch -= dy * 0.0025;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
    };
    this._wh = e => { if (!this.enabled) return; this.speed = THREE.MathUtils.clamp(this.speed * (e.deltaY > 0 ? 0.85 : 1.18), 3, 800); e.preventDefault(); };
    this._dbl = () => { if (this.enabled) el.requestPointerLock?.(); };
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    el.addEventListener('pointerdown', this._md);
    window.addEventListener('pointerup', this._mu);
    window.addEventListener('pointermove', this._mm);
    el.addEventListener('wheel', this._wh, { passive: false });
    el.addEventListener('dblclick', this._dbl);
  }

  setEnabled(on) {
    this.enabled = on;
    this.controls.enabled = !on;
    if (on) this.syncFromCamera();
    else { document.exitPointerLock?.(); }
  }

  syncFromCamera() {
    const e = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
    this.yaw = e.y; this.pitch = e.x;
  }

  place(pos, target) {
    this.cam.position.set(...pos);
    this.cam.lookAt(new THREE.Vector3(...target));
    this.syncFromCamera();
    this.controls.target.set(...target);
  }

  startTour(fn, duration) { this.tour = { fn, duration }; this.tourT = 0; }
  stopTour() { this.tour = null; }

  update(dt) {
    const cam = this.cam;
    if (this.tour) {
      this.tourT += dt;
      const t = (this.tourT / this.tour.duration) % 1;
      const { pos, look } = this.tour.fn(t);
      cam.position.copy(pos);
      cam.lookAt(look);
      this.syncFromCamera();
      this.controls.target.copy(look);
      return;
    }
    if (!this.enabled) return;
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const want = new THREE.Vector3();
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) want.add(f);
    if (k.has('KeyS') || k.has('ArrowDown')) want.sub(f);
    if (k.has('KeyD') || k.has('ArrowRight')) want.add(r);
    if (k.has('KeyA') || k.has('ArrowLeft')) want.sub(r);
    if (k.has('KeyE') || k.has('Space')) want.y += 1;
    if (k.has('KeyQ') || k.has('KeyC')) want.y -= 1;
    const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 6 : 1;
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(this.speed * fast);
    if (this.walkY != null) {        // walk mode: stay at eye height, move on the floor plane
      want.y = 0;
      if (want.lengthSq() > 0) want.normalize().multiplyScalar(this.speed * fast);
    }
    this.vel.lerp(want, 1 - Math.exp(-dt * 6));
    cam.position.addScaledVector(this.vel, dt);
    cam.position.y = this.walkY != null ? this.walkY : Math.max(cam.position.y, 0.6);
    // keep OrbitControls consistent (it calls lookAt(target) every frame)
    this.controls.target.copy(cam.position).addScaledVector(f, 10);
  }

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    this.el.removeEventListener('pointerdown', this._md);
    window.removeEventListener('pointerup', this._mu);
    window.removeEventListener('pointermove', this._mm);
    this.el.removeEventListener('wheel', this._wh);
    this.el.removeEventListener('dblclick', this._dbl);
    this.controls.enabled = true;
    document.exitPointerLock?.();
  }
}

// ------------------------------------------------------------------------------------------
// tours: t in 0..1 -> {pos, look}
// ------------------------------------------------------------------------------------------
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const TOURS = {
  orbit: { label: 'Orbit', duration: 90, fn: t => {
    const a = t * Math.PI * 2 + 0.6;
    return { pos: V(Math.sin(a) * 1900, 520 + 120 * Math.sin(a * 2), -200 + Math.cos(a) * 2400), look: V(0, 90, -150) };
  } },
  avenue: { label: 'Street', duration: 70, fn: t => {
    const z = 700 - t * 1500;
    return { pos: V(-127.5, 1.8, z), look: V(-127.5, 4, z - 40) };
  } },
  swing: { label: 'Canyon', duration: 55, fn: t => {
    const z = 520 - t * 1250;
    const y = 55 + 25 * Math.sin(t * Math.PI * 7);
    const x = 120 + 5 * Math.sin(t * Math.PI * 4);
    return { pos: V(x, y, z), look: V(x + 3 * Math.cos(t * 12), y - 10, z - 60) };
  } },
  river: { label: 'River', duration: 80, fn: t => {
    const z = 1600 - t * 3000;
    return { pos: V(1100, 45, z), look: V(300, 120, z - 300) };
  } },
  villa: { label: 'From the villa', duration: 60, fn: t => {
    const a = -0.35 + 0.7 * t;
    return { pos: V(1640, 42, 1905), look: V(1640 - Math.cos(a) * 800, 60, 1905 + Math.sin(a) * 800) };
  } },
};
