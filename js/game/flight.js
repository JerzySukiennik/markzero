// Iron Man flight model — a faithful JS port of V2's game/scripts/flight/flight_model.gd + specs.gd
// (which were themselves ports of V1's browser build). The numbers are MEASURED, not chosen; the
// long "why" notes live in the GDScript original — read them before changing a constant.
// Tests: tests/game/test_flight.mjs (same assertions as V2's tools/test_flight.gd).
//
// Control law: the look turns the WHOLE BODY; throttle is thrust along the body's own axes. Turn
// 180° and open the throttle = a violent stop, because that is the physics — not a brake button.
import * as THREE from 'three';

const G = 9.81;
export const BRAKE_K = 2.8;           // retro authority vs mains: 150 m/s → 0 in 0.85 s
export const FALL_ARREST_TIME = 0.22; // s to arrest a fall with up-thrust
export const CLIMB_RATE = 15.0;       // m/s governor on held climb
const HOVER_SLACK = 0.55, HOVER_DAMPING = 0.55, HOVER_STIFFNESS = 3.2, TURBULENCE = 1.35, HOVER_BURN = 0.55;
const LIFT_ASSIST = 0.98, BANK_MAX = 0.62, PRONE_MAX = 1.32, PRONE_FROM = 0.18, PRONE_FULL = 0.62;
export const WALK_SPEED = 2.1, RUN_SPEED = 7.4, WALK_GEAR = 0.35, GROUND_ACCEL = 22.0, GROUND_FRICTION = 16.0;
export const TAKEOFF_KICK = 7.5;
export const AUTO_BRAKE = 0.55, AUTO_BRAKE_DEADZONE = 0.12, AUTO_BRAKE_FLOOR = 1.5;
export const LOOK_CURVE = 2.0, LOOK_SPEED = 2.6;

const S = (id, name, mass, main, lateral, vertical, top_speed, drag, max_rate, roll_rate, alpha_max, roll_alpha_max, rate_falloff_ref, stability, integrity, power, boost, extra = {}) =>
  ({ id, name, mass, main, lateral, vertical, top_speed, drag_lateral: drag[0], drag_vertical: drag[1], drag_back: drag[2], max_rate, roll_rate, alpha_max, roll_alpha_max, rate_falloff_ref, stability, integrity, power, boost, flaw: '', self_don: false, ...extra });
export const SPECS = {
  mk1: S('mk1', 'MARK I', 340, 9800, 6370, 7350, 150, [3.2, 4.2, 6.5], 1.9, 2.4, 8, 12, 90, 0.55, 900, 0.8, 1.15, { noBoost: true }),
  mk2: S('mk2', 'MARK II', 215, 12600, 8190, 9450, 300, [4.0, 5.6, 8.0], 3.0, 4.2, 14, 24, 200, 1.0, 1100, 1.0, 1.4, { flaw: 'icing' }),
  mk3: S('mk3', 'MARK III', 220, 13400, 8710, 10050, 320, [4.0, 5.6, 8.0], 3.1, 4.4, 14, 25, 210, 1.05, 1600, 1.0, 1.45, { self_don: true }),
  mk42: S('mk42', 'MARK XLII', 190, 13000, 5850, 9750, 330, [3.8, 5.2, 8.0], 3.4, 5.0, 16, 28, 215, 0.85, 1200, 0.9, 1.45, { flaw: 'unstable' }),
  // Mk 85 flies on V2's MARK L numbers (the nanotech suit V2 called mk50)
  mk85: S('mk85', 'MARK 85', 205, 15200, 6840, 11400, 380, [4.2, 5.8, 8.5], 3.6, 5.2, 18, 30, 240, 1.2, 2000, 1.25, 1.5, { self_don: true }),
  // Hulkbuster: NOT measured yet — first guess scaled from mass (3.2 m, heavy): slow to turn, huge thrust
  hulkbuster: S('hulkbuster', 'HULKBUSTER', 1400, 52000, 17000, 36000, 190, [3.6, 5.0, 7.0], 1.5, 1.8, 6, 9, 110, 0.9, 6000, 1.1, 1.2, { flaw: 'heavy' }),
};

const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _f = new THREE.Vector3();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;

export class FlightModel {
  constructor(id = 'mk3') {
    this.position = new THREE.Vector3(); this.velocity = new THREE.Vector3(); this.accel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();              // physics basis (Godot basis_)
    this.viewQuat = new THREE.Quaternion();          // drawn basis (bank + prone), never flown
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.bank = 0; this.prone = 0;
    this.grounded = false; this.thrustMag = 0; this.gForce = 1; this.boostActive = 0; this._boostT = 0;
    this.groundY = 0;
    this.hoverAnchor = new THREE.Vector3(); this.hoverActive = false; this.hoverCorrection = new THREE.Vector3(); this._turbT = 0;
    this.groundSpeed = 0; this.stridePhase = 0; this.agility = 1;
    // on-foot gears, per instance: the controller matches them to the clip library's stride
    this.walkSpeed = WALK_SPEED; this.runSpeed = RUN_SPEED;
    // TURN ASSIST (V3, off = V2 physics): rad/s at which the velocity is swung onto the nose while
    // the mains burn. V2 only bled SIDEWAYS speed with the lateral thrusters (≈30 m/s²), so turning
    // the body at 200 m/s left the suit sailing on in the old direction for 6+ s — Jurek (playtest
    // 2): "not manoeuvrable at all, floaty". This is the lift of a banked body, not magic steering:
    // it only acts with forward thrust, costs speed (bleed), and never adds any.
    this.turnAssist = 0; this.turnBleed = 0.12;
    this.setArmor(id);
  }
  setArmor(id) {
    const s = this.spec = SPECS[id] || SPECS.mk3;
    this._kFwd = s.main / (s.top_speed * s.top_speed);
    this._kLat = this._kFwd * s.drag_lateral; this._kVert = this._kFwd * s.drag_vertical; this._kBack = this._kFwd * s.drag_back;
    this._liftK = this._kFwd * 0.55;
  }
  get speed() { return this.velocity.length(); }
  _setBasis() { this.quat.setFromEuler(_e.set(this.pitch, this.yaw, this.roll, 'YXZ')); }
  toBody(v, out = _v) { return out.copy(v).applyQuaternion(_qi.copy(this.quat).invert()); }
  toWorld(v, out = _v) { return out.copy(v).applyQuaternion(this.quat); }

  /** cmd: {thrust 0..1, retro 0..1, brake_only, lateral -1..1, vertical -1..1, look {x,y} (rad), roll, boost, walk {x,y}} */
  step(dt, cmd) {
    const s = this.spec;
    this._rotate(dt, cmd);
    const power = 1;
    const boosting = !!cmd.boost && (cmd.thrust || 0) > 0.05 && !s.noBoost;
    this._boostT = boosting ? this._boostT + dt : 0;
    const boost = boosting ? s.boost * (1 + 0.8 * Math.exp(-this._boostT / 0.35)) : 1;
    this.boostActive = boosting ? 1 : 0;
    const fwd = cmd.thrust || 0, back = cmd.retro || 0, lat = cmd.lateral || 0, vert = cmd.vertical || 0;

    const f = _f.set(0, 0, 0);
    f.z -= fwd * s.main * boost * power;
    if (back > 0.01) {
      const bv = this.toBody(this.velocity, new THREE.Vector3());
      const fwdSpeed = -bv.z;
      const beta = cmd.brake_only ? 0 : clamp(1 - (fwdSpeed - 4) / 8, 0, 1);
      const stopV = bv.clone();
      if (Math.abs(lat) > 0.05) stopV.x = 0;
      if (Math.abs(vert) > 0.05) stopV.y = 0;
      const stopS = stopV.length();
      const d = new THREE.Vector3(0, 0, beta);
      if (stopS > 0.05) d.addScaledVector(stopV, -(1 - beta) / stopS);
      if (d.lengthSq() > 1e-6) {
        d.normalize();
        const want = back * s.main * BRAKE_K * power;
        const cap = beta < 0.999 ? (stopS / dt) * s.mass / Math.max(1e-4, 1 - beta) : Infinity;
        f.addScaledVector(d, Math.min(want, cap));
      }
    }
    f.x += lat * s.lateral * power;
    let vGov = 1;
    if (vert > 0 && this.velocity.y > 0) vGov = clamp(1 - this.velocity.y / CLIMB_RATE, 0, 1);
    f.y += vert * s.vertical * power * (vert > 0 ? vGov : 1);
    if (vert > 0.05 && this.velocity.y < -0.5) {
      const need = (-this.velocity.y / FALL_ARREST_TIME) * s.mass, capNow = (-this.velocity.y / dt) * s.mass;
      f.add(this.toBody(_v2.set(0, Math.min(need, capNow) * vert, 0), new THREE.Vector3()));
    }
    this.thrustMag = clamp((fwd * boost + Math.abs(lat) * 0.4 + Math.abs(vert) * 0.5 + back * 0.5) * power, 0, 1.6);

    // anisotropic drag in body axes
    const b = this.toBody(this.velocity, new THREE.Vector3());
    const rho = Math.max(0.14, Math.exp(-Math.max(0, this.position.y) / 8500));
    const kz = b.z > 0 ? this._kBack : this._kFwd * (boosting ? 0.75 : 1);
    f.x += -this._kLat * b.x * Math.abs(b.x) * rho; f.y += -this._kVert * b.y * Math.abs(b.y) * rho; f.z += -kz * b.z * Math.abs(b.z) * rho;
    if (Math.abs(lat) < 0.05 && Math.abs(b.x) > 0.01) f.x += clamp(-b.x * s.mass / 0.6 - b.x * 40, -s.lateral, s.lateral);
    const vmag = b.length(), fwdComp = -b.z;
    if (vmag > 8 && fwdComp > 0) {
      const alpha = Math.atan2(-b.y, fwdComp);
      const lift = this._liftK * rho * vmag * vmag * Math.sin(2 * alpha) * (fwdComp / vmag);
      f.y += clamp(lift, -3 * s.mass * G, 3 * s.mass * G);
    }
    f.add(this._hover(dt, cmd));
    if (!this.grounded && !this.hoverActive && this.thrustMag > 0.1) {
      const carry = clamp(this.thrustMag / 0.18, 0, 1) * LIFT_ASSIST;
      f.add(this.toBody(_v2.set(0, G * s.mass * carry, 0), new THREE.Vector3()));
    }
    // turn assist: rotate v toward the body forward (−Z) by ≤ turnAssist·fwd·dt, losing a little speed
    if (this.turnAssist > 0 && fwd > 0.05 && !this.grounded) {
      const sp = this.velocity.length();
      if (sp > 8) {
        const nose = _v2.set(0, 0, -1).applyQuaternion(this.quat), vdir = new THREE.Vector3().copy(this.velocity).divideScalar(sp);
        const ang = Math.acos(clamp(vdir.dot(nose), -1, 1));
        if (ang > 1e-4) {
          const step = Math.min(ang, this.turnAssist * fwd * dt * clamp(sp / 25, 0.3, 1)), k = step / ang;
          vdir.lerp(nose, k).normalize();
          this.velocity.copy(vdir).multiplyScalar(sp * (1 - this.turnBleed * step / Math.PI));
        }
      }
    }
    const wf = this.toWorld(f, new THREE.Vector3());
    wf.y -= G * s.mass;
    this.accel.copy(wf).divideScalar(s.mass);
    this.gForce = _v2.copy(this.accel).setY(this.accel.y + G).length() / G;
    this.velocity.addScaledVector(this.accel, dt);
    this.position.addScaledVector(this.velocity, dt);
    this._resolveGround();
    this._walk(dt, cmd);
  }

  _walk(dt, cmd) {
    if (!this.grounded || this.thrustMag > 0.1) { this.groundSpeed = 0; return; }
    const ask = cmd.walk || { x: 0, y: 0 }, mag = clamp(Math.hypot(ask.x, ask.y), 0, 1);
    const want = new THREE.Vector3();
    if (mag > 0.08) {
      const dir = this.toWorld(_v2.set(ask.x, 0, ask.y), new THREE.Vector3()); dir.y = 0;
      if (dir.lengthSq() > 1e-6) {
        const gear = mag < WALK_GEAR ? this.walkSpeed * mag / WALK_GEAR : lerp(this.walkSpeed, this.runSpeed, (mag - WALK_GEAR) / (1 - WALK_GEAR));
        want.copy(dir.normalize()).multiplyScalar(gear);
      }
    }
    const v = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
    const step = (mag > 0.08 ? GROUND_ACCEL : GROUND_FRICTION) * dt, dv = want.clone().sub(v), dl = dv.length();
    if (dl <= step) v.copy(want); else v.addScaledVector(dv, step / dl);
    this.velocity.x = v.x; this.velocity.z = v.z;
    this.groundSpeed = v.length();
    this.stridePhase += this.groundSpeed * dt / lerp(1.45, 3.6, clamp(this.groundSpeed / this.runSpeed, 0, 1));
    const k = 1 - Math.exp(-dt * 9);
    this.pitch = lerp(this.pitch, 0, k); this.roll = lerp(this.roll, 0, k);
    this._setBasis();
  }

  _hover(dt, cmd) {
    const s = this.spec;
    const asking = Math.abs(cmd.thrust || 0) + Math.abs(cmd.lateral || 0) + Math.abs(cmd.vertical || 0) + Math.abs(cmd.retro || 0);
    const clearance = this.position.y - (this.groundY + 1);
    const want = !this.grounded && clearance > 0.06 && asking < 0.15;
    if (!want) { this.hoverActive = false; this.hoverCorrection.lerp(_v2.set(0, 0, 0), 1 - Math.exp(-dt / 0.25)); return new THREE.Vector3(); }
    if (!this.hoverActive) { this.hoverActive = true; this.hoverAnchor.copy(this.position); }
    this._turbT += dt; const t = this._turbT;
    const turb = new THREE.Vector3(
      Math.sin(t * 0.41) * 0.6 + Math.sin(t * 1.13 + 2) * 0.4,
      Math.sin(t * 0.29 + 1.1) * 0.7 + Math.sin(t * 0.87) * 0.3,
      Math.sin(t * 0.53 + 0.4) * 0.6 + Math.sin(t * 1.31 + 3.3) * 0.4).multiplyScalar(TURBULENCE);
    const err = this.hoverAnchor.clone().sub(this.position);
    const pull = err.clone().multiplyScalar(HOVER_STIFFNESS);
    if (err.length() < HOVER_SLACK) pull.multiplyScalar(err.length() / HOVER_SLACK);
    const servo = pull.sub(this.velocity.clone().multiplyScalar(HOVER_DAMPING * 2));
    const worldExtra = new THREE.Vector3(0, G * s.mass, 0).add(turb.clone().add(servo).multiplyScalar(s.mass * 0.45));
    this.thrustMag = Math.max(this.thrustMag, HOVER_BURN + clamp(servo.length() / 12, 0, 0.35));
    const corr = this.toBody(turb.add(servo).multiplyScalar(0.45 / 9), new THREE.Vector3());
    this.hoverCorrection.lerp(corr, 1 - Math.exp(-dt / 0.08));
    return this.toBody(worldExtra, new THREE.Vector3());
  }

  _rotate(dt, cmd) {
    const s = this.spec, look = cmd.look || { x: 0, y: 0 };
    const falloff = 1 / (1 + this.speed / s.rate_falloff_ref);
    this.yaw -= look.x * s.max_rate * falloff * this.agility;
    this.pitch = clamp(this.pitch - look.y * s.max_rate * falloff * this.agility, -1.45, 1.45);
    this.roll += (cmd.roll || 0) * s.roll_rate * this.agility * dt;
    this.roll = lerp(this.roll, 0, 1 - Math.exp(-dt * s.stability * 1.6));
    this._setBasis();
    const slide = clamp(cmd.lateral || 0, -1, 1), authority = clamp(this.speed / 45, 0.25, 1);
    this.bank = lerp(this.bank, -slide * BANK_MAX * authority, 1 - Math.exp(-dt * s.stability * 1.6));
    const fast = clamp((this.speed / Math.max(1, s.top_speed) - PRONE_FROM) / (PRONE_FULL - PRONE_FROM), 0, 1);
    this.prone = lerp(this.prone, fast * PRONE_MAX, 1 - Math.exp(-dt * 2.4));
    // drawn body: Godot applied prone as extra pitch; three's pitch sign matches (rotation about +X)
    this.viewQuat.setFromEuler(_e.set(this.pitch - this.prone, this.yaw, this.roll + this.bank, 'YXZ'));
  }

  _resolveGround() {
    const floor = this.groundY + 1;
    if (this.position.y <= floor) { this.position.y = floor; if (this.velocity.y < 0) this.velocity.y = 0; this.grounded = true; }
    else this.grounded = false;
  }
}

/** The pad → cmd mapping of V2's suit_pilot.gd (auto-brake when the stick is centred, takeoff kick). */
export function pilotCmd(model, pad, dt) {
  const { ly, lx, rx, ry } = pad.axes;
  const up = pad.ascend, down = pad.descend;
  const onFoot = model.grounded && !up;
  if (model.grounded && pad.ascendPressed) { model.velocity.y = Math.max(model.velocity.y, TAKEOFF_KICK); model.grounded = false; }
  const stickFwd = onFoot ? 0 : -ly;
  let thrust = Math.max(stickFwd, 0), retro = Math.max(-stickFwd, 0), brake_only = false;
  if (!onFoot && Math.abs(stickFwd) < AUTO_BRAKE_DEADZONE && model.speed > AUTO_BRAKE_FLOOR) {
    brake_only = true; retro = clamp((model.speed - AUTO_BRAKE_FLOOR) / 12, 0, 1) * AUTO_BRAKE;
  }
  const curve = v => Math.sign(v) * Math.pow(Math.abs(v), LOOK_CURVE);
  const look = { x: curve(rx) * LOOK_SPEED * dt, y: curve(ry) * LOOK_SPEED * dt };
  return { thrust, retro, brake_only, lateral: onFoot ? 0 : lx, walk: onFoot ? { x: lx, y: ly } : { x: 0, y: 0 },
    vertical: (up ? 1 : 0) - (down ? 1 : 0), look, roll: 0, boost: !!pad.boost };
}
