// Chase camera for both heroes — V2's ChaseCamera (game/scripts/core/chase_camera.gd) plus what V2
// never had: collision with the city (the camera never ends up inside a block), speed shake, and an
// impulse spring for kicks. The world adds its own trauma shake / FOV kick on top (world.kick).
//
// Over the RIGHT shoulder, never dead behind (the body would cover the aim point); the offset deepens
// while aiming. The side offset moves the LOOK TARGET, not the orbit, so the direction of travel
// stays centred. Distance and FOV open with speed — the cheapest way to make speed read as speed.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const UPV = new THREE.Vector3(0, 1, 0);

export const IRON_CAM = {
  backNear: 5.2, backFar: 8.0, upNear: 1.5, upFar: 2.1, shoulder: 1.15, shoulderAim: 1.85,
  fovBase: 64, fovSpeed: 16, fovAim: -10, lagPos: 0.10, lagAim: 0.05, lookAhead: 12, lookUp: 0.35,
};
// Spider-Man (owned by the Spider-Man agent): fully "fast" framing at swing speeds (fastAt 34 m/s, not
// Iron Man's 60+). Measured (2026-09-26, hold-R2 chains): at 6.8 m and FOV 79° he was 9 % of the screen
// height — the animation could not read. Now closer and narrower (~15–18 %), near the centre; speed reads from
// the FOV kick, the speed lines (hud.juice) and the wind.
/** Long lens (city-art agent, playtest "the city is too small next to the heroes"): 45° vertical instead
 * of 64°, camera ×1.4 further back so the hero keeps (slightly more than) his screen size while every
 * building behind him reads ~1.4× larger. Speed FOV kick unchanged on top. ?lens=64 = the old camera. */
export const IRON_CAM_45 = {
  ...IRON_CAM, backNear: 5.2 * 1.4, backFar: 8.0 * 1.4, upNear: 1.5 * 1.4, upFar: 2.1 * 1.4, shoulder: 1.15 * 1.4, shoulderAim: 1.85 * 1.4,
  fovBase: 45, fovSpeed: 16, fovAim: -8, lookAhead: 16,
};
export const SPIDER_CAM = {
  backNear: 3.6, backFar: 4.8, upNear: 1.2, upFar: 1.45, shoulder: 0.5, shoulderAim: 1.1,
  fovBase: 62, fovSpeed: 10, fovAim: -9, lagPos: 0.09, lagAim: 0.05, lookAhead: 6.5, lookUp: -0.9, fastAt: 34,
  smart: true,     // collision looks for room above / to a side before pulling in (ChaseCam._smartDir)
};

export class ChaseCam {
  constructor(cfg = IRON_CAM) {
    this.cfg = cfg; this.aim = 0; this.fov = cfg.fovBase; this.pos = new THREE.Vector3(); this.inited = false;
    this.side = 1; this.dist = cfg.backNear;
    this.kickV = new THREE.Vector3(); this.kickP = new THREE.Vector3();   // positional spring (m)
    this.fovKick = 0; this.shakeT = 0; this.speedShake = 0; this.roll = 0;
    this.look = new THREE.Vector3();
  }
  /** Positional punch in camera space (x right, y up, z back), e.g. recoil (0, 0.05, 0.15). */
  punch(x, y, z) { this.kickV.x += x; this.kickV.y += y; this.kickV.z += z; }

  /**
   * focus  point the camera orbits (the hero's centre of mass)
   * yaw, pitch  the view direction (Iron Man: the flight basis; Spider-Man: the free look)
   * speed, top  m/s and the speed at which framing is "fully fast"
   * collider    CityCollider (optional) — pulls the camera in front of walls
   */
  follow(dt, cam, { focus, yaw, pitch, speed = 0, top = 120, aiming = false, collider = null, roll = 0, extraBack = 0 }) {
    const c = this.cfg;
    this.aim += ((aiming ? 1 : 0) - this.aim) * (1 - Math.exp(-dt / 0.12));
    const fast = THREE.MathUtils.clamp(speed / (c.fastAt || Math.max(60, top * 0.55)), 0, 1);
    const back = THREE.MathUtils.lerp(c.backNear, c.backFar, fast) * (1 - 0.25 * this.aim) + extraBack;
    const up = THREE.MathUtils.lerp(c.upNear, c.upFar, fast);
    const side = THREE.MathUtils.lerp(c.shoulder, c.shoulderAim, this.aim) * this.side;
    _q.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
    // want = focus + basis * (side, up, back); look = focus + basis * (side*.45, lookUp, -lookAhead)
    const want = _v.set(side, up, back).applyQuaternion(_q).add(focus);
    const look = this.look.set(side * 0.45, c.lookUp, -c.lookAhead).applyQuaternion(_q).add(focus);
    // lag the OFFSET from the hero, never the absolute position: V2 lerped the position, so at
    // 300 m/s the camera sat v·τ = 30 m further back than framed and the suit shrank to a dot
    const k = this.inited ? 1 - Math.exp(-dt / THREE.MathUtils.lerp(c.lagPos, c.lagAim, this.aim)) : 1;
    this.off ||= new THREE.Vector3();
    this.off.lerp(_v2.subVectors(want, focus), k); this.inited = true;
    this.pos.copy(focus).add(this.off);
    const pos = this.pos;
    // city collision: from a point just above the focus out to the wanted spot
    if (collider) {
      const from = _v2.copy(focus); from.y += 0.6;
      const d = pos.clone().sub(from), L = d.length(); d.divideScalar(L);
      // SMART (Spider-Man, cfg.smart): blocked much closer than wanted (a parapet, a bulkhead, a tower behind a
      // setback roof) → look for room ABOVE or to a SIDE first, instead of only crashing into the back of his head;
      // the chosen direction is eased so the camera glides round the obstacle
      if (c.smart) this._smartDir(dt, collider, from, d, L);
      const hit = collider.raycast(from, d, L + 0.4, this._hit ||= {});
      const want2 = hit ? Math.max(0.8, hit.t - 0.4) : L;
      this.dist += (want2 - this.dist) * (want2 < this.dist ? 1 : 1 - Math.exp(-dt * 3));   // snap in, ease out
      pos.copy(from).addScaledVector(d, this.dist);
      const g = collider.groundAt(pos.x, pos.z, pos.y) + 0.5; if (pos.y < g) pos.y = g;
    }
    // kick spring (critically-ish damped)
    this.kickV.addScaledVector(this.kickP, -dt * 160); this.kickV.multiplyScalar(Math.exp(-dt * 14));
    this.kickP.addScaledVector(this.kickV, dt * 10);
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    // speed shake: fine, high frequency, only near the top end
    this.shakeT += dt;
    const sh = this.speedShake * Math.max(0, fast - 0.45) * 1.8;
    if (sh > 1e-4) { const t = this.shakeT * 31; cam.rotateX((Math.sin(t * 1.7) + Math.sin(t * 3.1)) * 0.0025 * sh); cam.rotateY((Math.sin(t * 2.3 + 1) + Math.sin(t * 2.9)) * 0.0025 * sh); }
    this.roll += (roll - this.roll) * (1 - Math.exp(-dt * 4));
    if (Math.abs(this.roll) > 1e-4) cam.rotateZ(this.roll);
    cam.translateX(this.kickP.x); cam.translateY(this.kickP.y); cam.translateZ(this.kickP.z);
    this.fovKick *= Math.exp(-dt * 6);
    const fovWant = c.fovBase + fast * c.fovSpeed + this.aim * c.fovAim;
    this.fov += (fovWant - this.fov) * (1 - Math.exp(-dt / 0.25));
    return this.fov + this.fovKick;
  }
  snap() { this.inited = false; this.sdir = null; }
  /** smart collision: pick among the wanted direction and raised / side-stepped ones the one with the most free
   * room (a small preference for the wanted one), ease towards it; d is replaced in place */
  _smartDir(dt, collider, from, d, L) {
    const free = v => { const h = collider.raycast(from, v, L + 0.4, this._hit ||= {}); return h ? h.t : L + 0.4; };
    const f0 = free(d);
    let best = d.clone(), bs = f0 >= L * 0.65 ? Infinity : f0;
    if (bs !== Infinity) {
      const right = _v3.crossVectors(d, UPV).normalize();
      for (const [pitchUp, yawS] of [[0.35, 0], [0.7, 0], [1.0, 0], [0.2, 0.45], [0.2, -0.45], [0.45, 0.8], [0.45, -0.8]]) {
        const v = d.clone().applyAxisAngle(right, pitchUp).applyAxisAngle(UPV, yawS).normalize();
        if (v.y > 0.92) continue;
        const s = Math.min(free(v), L) - (pitchUp + Math.abs(yawS)) * 0.9;
        if (s > bs) { bs = s; best = v; }
      }
    }
    this.sdir = this.sdir ? this.sdir.lerp(best, 1 - Math.exp(-dt * 5)).normalize() : best;
    d.copy(this.sdir);
  }
}
