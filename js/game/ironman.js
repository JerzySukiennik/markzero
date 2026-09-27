// IRON MAN — the controller. Flight model (flight.js, V2's numbers) + the audit §4 mapping (via
// MZ.actions, so remaps apply) + the ironman_core clip library through a state machine + procedural
// layers on the fresh animated pose each frame: FL-1 flaps, hand/foot trims from the thrust vector,
// LookAt and ArmAim (the repulsor fix: the shot waits for the arm, recoil kicks the arm UP).
// Plumes and contrails are driven by thrust; the chase camera sells speed.
//
// Control law (V2, the one decision the flight rests on): the right stick turns the WHOLE BODY,
// the left stick is thrust along the body's own axes, ✕ climbs, ○ descends, R2 = supersonic.
// Let go of the stick and the suit brakes itself and holds station (auto-brake + hover servo).
import * as THREE from 'three';
import { FlightModel, pilotCmd, BRAKE_K } from './flight.js';
import { Hero, colliderFor, clamp, lerp, damp } from './hero.js';
import { blend1D } from './anim.js';
import { ChaseCam, IRON_CAM, IRON_CAM_45 } from './camera.js';
import { ArmAim, LookAt } from '../gfx/aim.js';
import { runSuitUp, say } from './suitup/suitup.js';
import { Plume, Grit } from './fx/plume.js';
import { SuitWheel } from './fx/wheel.js';
import { setHelmetHair } from './fx/helmethair.js';
import { IronJuice } from './fx/ironjuice.js';

const SPAWN = { pos: new THREE.Vector3(-560, 46, 640), yaw: Math.PI * 0.75 };
const STEP = 1 / 120;
const BODY_R = 0.62;                 // collision sphere round the chest
const FIRE_BUFFER = 0.22, FIRE_COOL = 0.13, ARM_READY = 0.82, ARM_HOLD = 1.3, CHARGE_AFTER = 0.3, CHARGE_TIME = 0.9;
const BOLT_SPEED = 210;
const TURN_ASSIST = 3.0;                 // rad/s the course follows the nose under thrust (flight.js)
const SKID_A = 38, SKID_B = 3.2;          // ground skid decel = A + B·speed (m/s²)
const FLAP = { back: [-0.96, 'x'], calf: [-0.70, 'x'], hip: [0.61, 'y'] };   // FL-1 open angles (rad)
const DEG = Math.PI / 180;
const UPV = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export class IronMan extends Hero {
  async init() {
    this.col = await colliderFor(this.world);
    const m = this.m = new FlightModel(this.suit);
    // on foot the armour walks at the library's stride (walk 0.97 m/s, run 3.11 m/s authored):
    // V2's 2.1 / 7.4 m/s played the clips at 2.4× — a blur, not a run
    m.walkSpeed = 1.5; m.runSpeed = 4.8;
    m.turnAssist = TURN_ASSIST;
    // ?v2feel=1: V2's ground and turning (no skid, descend thrust on the ground, no turn assist) — A/B only
    this.v2feel = this.MZ.params?.get?.('v2feel') === '1'; if (this.v2feel) m.turnAssist = 0;
    const sp = this.spawnOpt || SPAWN;
    m.position.copy(sp.pos || SPAWN.pos); m.yaw = sp.yaw ?? SPAWN.yaw; m._setBasis();
    this.act = this.MZ.actions ? this.MZ.actions('ironman') : null;
    this.cam = new ChaseCam(this.MZ.params?.get?.('lens') === '64' ? IRON_CAM : IRON_CAM_45); this.cam.speedShake = 1;
    this.camPitchFoot = -0.12;
    // gameplay state
    this.shot = { L: { buf: 0, cool: 0, hold: 0, charge: 0, charging: false, big: false }, R: { buf: 0, cool: 0, hold: 0, charge: 0, charging: false, big: false } };
    this.bolts = [];
    this.aimPoint = new THREE.Vector3(); this.aimScreen = { x: 0.5, y: 0.5, locked: false };
    this.flapOpen = { L: 0, R: 0 }; this.trim = new THREE.Vector3(); this.brakeCool = 0; this.landLock = 0;
    this.wasGrounded = true; this.lastCmd = null; this.bank = 0; this.footYaw = 0; this.boostT = 0;
    this.speedNow = 0; this.heading = m.yaw; this._prev = new THREE.Vector3(); this.skidT = 0;
    await this.buildBody(this.suit);
    this.juice = new IronJuice(this);
    this.onEvent(e => this.remoteEvent(e));
    return this;
  }

  /** (Re)build the armour: model, clips, nano shader, IK/flap/trim nodes, plumes, trails. Used at
   * spawn and by every suit-up (the suit changes, the pilot and his flight state stay). */
  async buildBody(suit, preloaded = null) {
    const { root, clips, metas } = await (preloaded || this.loadBody(suit));
    this.disposeBody();
    this.suit = suit; this.heavy = suit === 'hulkbuster';
    this.m.setArmor(suit); this.m.turnAssist = this.v2feel ? 0 : this.heavy ? 1.4 : TURN_ASSIST;
    this.root = root; this.world.scene.add(root);
    this.bodyClips = clips; this.bodyMetas = metas;
    this.anim = this.makeAnimator(root, clips, metas);
    if (this.heavy) this.anim.alias = { fly_slow: 'fly', fly_cruise: 'fly', fly_fast: 'fly', takeoff: 'fly_takeoff', land_hero: 'land_heavy', land_soft: 'land', fly_to_hover: null, hover_to_fly: null, boost: null, fly_bank_L: 'fly_strafe_L', fly_bank_R: 'fly_strafe_R', fly_ascend: 'hover', fly_descend: 'hover', aim_R: null, aim_L: null, aim_both: null };
    this.installNano(root);
    // draw-call merge (lead's gfx/merge.js via the world): AFTER the nano patch, BEFORE plumes are hung
    this.merged = this.MZ.params?.get?.('merge') === '0' ? null : (this.world.optimizeModel?.(root) || null);   // ?merge=0 = A/B
    const node = n => root.getObjectByName(n);
    this.palm = { L: node('piv_palmL'), R: node('piv_palmR') };
    this.flaps = {};
    for (const k of Object.keys(FLAP)) for (const s of ['L', 'R']) { const n = node(`piv_flap_${k}${s}`); if (n) this.flaps[k + s] = n; }
    this.trimNodes = ['piv_hipL', 'piv_hipR', 'piv_shoulderL', 'piv_shoulderR', 'piv_spine', 'piv_head'].map(node);
    this.legNodes = ['piv_hipL', 'piv_hipR', 'piv_kneeL', 'piv_kneeR', 'piv_ankleL', 'piv_ankleR', 'piv_toeL', 'piv_toeR'].map(node).filter(Boolean);
    this.legQ = this.legNodes.map(n => n.quaternion.clone());
    this.arms = { L: new ArmAim(root, 'L'), R: new ArmAim(root, 'R') };
    this.look = new LookAt(root);
    this.anim.protect([...Object.values(this.flaps), ...this.trimNodes, ...this.legNodes, ...this.arms.L.nodes(), ...this.arms.R.nodes(), ...this.look.nodes()]);
    // plumes: boots + palms (flame for the Mk I and the Hulkbuster)
    const vfx = this.world.vfx, style = suit === 'mk1' || this.heavy ? 'flame' : 'repulsor';
    this.thr = {}; this.trails = [];
    if (vfx) {
      // V2-look plumes (fx/plume.js): visible end-on from the chase camera, grow with throttle
      this.grit ||= new Grit(this.world.scene, 480);
      for (const n of ['piv_thrusterL', 'piv_thrusterR', 'piv_palmL', 'piv_palmR']) {
        const o = node(n); if (!o) continue;
        this.thr[n] = new Plume(o, { style, scale: (n.includes('palm') ? 0.62 : 1) * (this.heavy ? 1.8 : 1) });
      }
      for (const n of ['piv_thrusterL', 'piv_thrusterR']) if (node(n)) this.trails.push(vfx.trail(node(n), { width: 0.12, grow: 2.6, life: 1.9, max: 120, color: 0xf2f6ff, hot: 0xd6ecff, minSpeed: 16 }));
      for (const n of ['piv_palmL', 'piv_palmR']) if (node(n)) this.trails.push(vfx.trail(node(n), { width: 0.035, grow: 3.5, life: 0.45, max: 50, color: 0xf4f8ff, hot: 0xffffff, minSpeed: 90, turb: 1.4 }));
    }
    this.root.position.copy(this.m.position).y -= 1;
    this.root.quaternion.setFromEuler(_e.set(0, this.m.yaw, 0, 'YXZ'));
    this.anim.setBase(this.m.grounded ? { idle: 1 } : { hover: 1 }, 100); this.anim.update(0);
    return root;
  }
  disposeBody() {
    const vfx = this.world.vfx;
    for (const t of Object.values(this.thr || {})) t.dispose();
    for (const tr of this.trails || []) { tr.dispose(); const i = vfx?.trails.indexOf(tr); if (i >= 0) vfx.trails.splice(i, 1); }
    this.thr = {}; this.trails = [];
    this.anim?.dispose(); this.nano?.dispose(); this.nano = null; this.merged = null;
    this.root?.removeFromParent();
  }

  /** clip cues: the fly clips carry thruster puffs/bursts that played as random one-off hisses
   * ("psik", playtest 1) — the engine is a continuous bed in effects(); only real events pass */
  onCue(e, clip) {
    if (e.sfx && /^im_thruster_(puff|burst|ignite)/.test(e.sfx)) e = { ...e, sfx: null };
    super.onCue(e, clip);
  }

  // ------------------------------------------------------------------ per frame (local)
  update(dt, t) {
    if (!this.local) return this.updateRemote(dt, t);
    if (dt <= 0) { this.anim.update(0); return; }
    if (this.parked) { this.anim.update(dt); return; }
    const m = this.m; let a = this.act;
    const axes = a && !this.locked ? { ...a.axes } : { lx: 0, ly: 0, rx: 0, ry: 0 };
    if (this.locked) a = null;
    const pad = { axes, ascend: a?.down('ascend'), descend: a?.down('descend') && (!m.grounded || this.v2feel), ascendPressed: a?.pressed('ascend'), boost: a?.down('boost') && this.suit !== 'mk1' };
    const aiming = !!a?.down('aim');
    const wasG = m.grounded, vy0 = m.velocity.y, sp0 = m.speed;
    // SKID AND LANDING LOCK EXIST ONLY ON THE GROUND. skid() ran only while grounded, so a fast ground
    // hit that bounced him back into the air left `skidding` true, which re-armed landLock every frame
    // and zeroed the stick: "after hitting the ground I can only fly up and down" (playtest, 9e56869)
    if (!m.grounded) { this.skidding = false; this.airT = (this.airT || 0) + dt; this.landLock = Math.min(this.landLock, 0.25); } else this.airT = 0;
    if (this.landLock > 0) { this.landLock -= dt; pad.axes = { ...axes, lx: 0, ly: 0 }; }
    this.suitInput(dt, axes);
    if (this.wheel?.open) axes.rx = axes.ry = 0, pad.axes = { ...pad.axes, rx: 0, ry: 0 };
    const clear0 = m.position.y - 1 - this.col.groundAt(m.position.x, m.position.z, m.position.y - 1);
    // ✕ near the ground is a take-off even if a prop/mesh contact held him a few cm up (playtest 3:
    // "sometimes I can't fly" — the kick needed `grounded`, so he only crept up out of a low hover)
    if (pad.ascendPressed && !m.grounded && clear0 < 3.0) { m.velocity.y = Math.max(m.velocity.y, 7.5); this.takeoff(); }
    const cmd = pilotCmd(m, pad, dt);
    if (aiming) { cmd.look.x *= 0.5; cmd.look.y *= 0.5; }
    if (wasG && pad.ascendPressed) this.takeoff();
    // on-foot camera pitch is free (the model levels itself on the ground)
    if (m.grounded) this.camPitchFoot = clamp(this.camPitchFoot - Math.sign(axes.ry) * axes.ry * axes.ry * 1.8 * dt, -0.7, 0.6);
    // ---- physics, 120 Hz sub-steps, city collision each step
    const n = Math.max(1, Math.ceil(dt / STEP)), h = dt / n;
    let bonk = null;
    for (let i = 0; i < n; i++) {
      const c = i === 0 ? cmd : { ...cmd, look: { x: 0, y: 0 } };
      const g0 = m.grounded;
      // a walkable slope the chest sphere rests on (terrain, ramps) counts as ground, not as a hover
      m.groundY = Math.max(this.col.groundAt(m.position.x, m.position.z, m.position.y - 1), this.slopeT > 0 ? this.slopeY : -1e9);
      this._prev.copy(m.position);
      m.step(h, c);
      const sweep = this.sweep();                 // CCD first: a 3 m sub-step must never pass a wall
      const hit = this.collide() || sweep;
      if (hit && (!bonk || hit.speed > bonk.speed)) bonk = hit;
      if (m.grounded && !this.v2feel) this.skid(h, !g0);
    }
    if (bonk) this.onBonk(bonk);
    this.slopeT = Math.max(0, (this.slopeT || 0) - dt);
    // STANDING IS STANDING: within 0.35 m of the ground, not climbing and not asking to fly = on the
    // ground (a sphere contact must never leave him hovering 5 cm over a floor in the hover servo)
    const clear = m.position.y - 1 - m.groundY, asking = (cmd.thrust || 0) + Math.abs(cmd.lateral || 0) + Math.max(0, cmd.vertical || 0) > 0.1;
    if (!m.grounded && clear < 0.35 && m.velocity.y <= 0.5 && !asking && !pad.ascend) {
      m.position.y = m.groundY + 1; if (m.velocity.y < 0) m.velocity.y = 0; m.grounded = true; m.hoverActive = false;
    } else if (this.takeoffT > 0) { if (m.hoverActive) m.hoverAnchor.y = Math.max(m.hoverAnchor.y, m.groundY + 1 + 3.2); }
    else if (m.hoverActive && clear < 0.9 && !asking) m.hoverAnchor.y -= 1.6 * dt;   // low hover settles onto the ground
    this.takeoffT = Math.max(0, (this.takeoffT || 0) - dt);
    // boost / brake moments
    if (pad.boost && !this._boosting && cmd.thrust > 0.05) this.onBoost();
    this._boosting = !!(pad.boost && cmd.thrust > 0.05);
    this.brakeCool -= dt;
    const hardBrake = !m.grounded && sp0 > 45 && cmd.retro > (cmd.brake_only ? 0.5 : 0.6);
    if (hardBrake && this.brakeCool <= 0) this.onBrake(sp0);
    this.lastCmd = cmd;
    // landing
    if (!wasG && m.grounded) this.onLand(-vy0, sp0);
    if (!m.grounded && this.airT > 0.12 && this.anim.shots.some(s => /^land/.test(s.name) && !s.cancel)) this.anim.cancelShot('land_hero', 0.15), this.anim.cancelShot('land_soft', 0.15);
    if (this.skidding) {
      this.skidT += dt;
      const hs = Math.hypot(m.velocity.x, m.velocity.z), feet = _v.copy(m.position); feet.y -= 0.95;
      if (hs > 6 && Math.random() < dt * 40) this.world.vfx?.sparks.burst(feet, _v2.set(-m.velocity.x, 3, -m.velocity.z).normalize(), 6, 5 + hs * 0.1, 0.8, new THREE.Color(1, 0.75, 0.4), 0.35);
      if (this.skidT <= dt && hs > 8) this.sfx('cl_sparks', { at: this.root, gain: clamp(hs / 25, 0.4, 1) });
      this.landLock = Math.max(this.landLock, 0.15);
    } else this.skidT = 0;
    this.wasGrounded = m.grounded;
    // ---- body transform: physics yaw/pitch/roll + the cosmetic bank (the clips lie the body down)
    this.bank = m.bank;
    this.root.position.copy(m.position); this.root.position.y -= 1;
    this.footYaw = m.grounded ? damp(this.footYaw, this.walkYaw(cmd, axes), 10, dt) : damp(this.footYaw, 0, 8, dt);
    // bank INTO a yaw turn (a look, like V2's slide bank): lean ∝ turn rate × speed, short smoothing
    const yawRate = (m.yaw - (this._lastYaw ?? m.yaw)) / dt; this._lastYaw = m.yaw;
    const want = m.grounded || this.v2feel ? 0 : clamp(yawRate * clamp(m.speed / 90, 0, 1) * 0.35, -1.0, 1.0);
    this.turnBank = damp(this.turnBank || 0, want, 7, dt);
    this.root.quaternion.setFromEuler(_e.set(m.grounded ? 0 : m.pitch, m.yaw + this.footYaw, m.roll + m.bank + this.turnBank, 'YXZ'));
    // ---- aim point from the camera
    this.updateAim();
    this.shoot(dt, a);
    // ---- animation
    this.stateMachine(dt, cmd);
    this.anim.update(dt);
    this.nano?.update(dt);
    this.procedural(dt, cmd);
    this.fireReady();
    this.effects(dt, cmd, aiming);
    this.suitup?.update(dt);
    this.speedNow = m.speed; this.heading = m.yaw;
    if (aiming && this.MZ.game?.players?.size <= 1) this.world.kick?.({ slow: 0.55, slowTime: 0.06 });
    this.aiming = aiming;
  }

  walkYaw(cmd, axes) {
    // legs face where the stick walks (relative to the body); a back-pedal walks backwards
    const w = cmd.walk; if (!w || Math.hypot(w.x, w.y) < 0.2) return 0;
    let ang = Math.atan2(-w.x, -w.y);
    this.walkBack = Math.abs(ang) > 1.9;
    if (this.walkBack) ang = ang > 0 ? ang - Math.PI : ang + Math.PI;
    return clamp(ang, -1.6, 1.6);
  }

  // ---- continuous collision: ray along this sub-step's travel (plus the body radius); stop at the
  // first surface and drop the velocity into it. The sphere push-out alone let fast flights end a
  // sub-step deep inside a block and get pushed out of its FAR side (3/22 test flights went through).
  sweep() {
    const m = this.m, R = this.heavy ? 1.4 : BODY_R;
    const a = _v.copy(this._prev); a.y += 0.25;
    const d = _v2.copy(m.position).sub(this._prev), L = d.length();
    if (L < R * 0.5) return null;
    d.divideScalar(L);
    const hit = this.col.raycast(a, d, L + R, this._sw || (this._sw = {}));
    if (!hit) return null;
    if (hit.ny > 0.7 && d.y > -0.5) return null;                    // floors/roofs: the flight model's ground
    const nrm = _v3.set(hit.nx, hit.ny, hit.nz);
    const back = Math.max(0, hit.t - R * 1.02);
    m.position.copy(this._prev).addScaledVector(d, back);
    if (hit.ny > 0.7) m.position.y = Math.max(m.position.y, hit.y + 1);   // onto a roof
    const into = m.velocity.dot(nrm);
    if (into < 0) m.velocity.addScaledVector(nrm, -into);
    if (m.hoverActive) m.hoverAnchor.copy(m.position);
    return hit.ny > 0.7 ? null : { speed: -into, n: nrm.clone(), p: new THREE.Vector3(hit.x, hit.y, hit.z) };
  }
  // ---- on the ground: a touchdown absorbs most of the horizontal speed, then a hard skid (sparks)
  // stops the rest within a few metres. Before: 16 m/s² walk friction only, and none at all while
  // descend was held — landings slid 140–860 m "across half the city" in the landing pose.
  skid(h, touchdown) {
    const m = this.m, v = m.velocity, hs = Math.hypot(v.x, v.z);
    if (touchdown && hs > 20) { const k = hs > 60 ? 0.3 : 0.5; v.x *= k; v.z *= k; }
    const hs2 = Math.hypot(v.x, v.z), top = m.runSpeed + 0.3;
    if (hs2 <= top) { this.skidding = false; return; }
    const nv = Math.max(top * 0.9, hs2 - (SKID_A + SKID_B * hs2) * h);
    v.x *= nv / hs2; v.z *= nv / hs2;
    this.skidding = true;
  }

  // ---- collision: chest sphere vs the city; slide along walls, bonk hard hits
  collide() {
    const m = this.m;
    const c = _v.copy(m.position); c.y += 0.25;
    const before = _v3.copy(c);
    const r = this.col.sphere(c, this.heavy ? 1.4 : BODY_R, this._hit || (this._hit = {}));
    if (!r) return null;
    const push = _v2.subVectors(c, before);
    // DOWN ONLY UNDER A REAL CEILING. The mesh soup's closest-point push off a parapet/cornice edge
    // can point downwards; applied every sub-step it pinned him to a roof edge and ✕ did nothing
    // (playtest 3: "sometimes I can't fly"). Without solid geometry right above the head, drop it.
    if (push.y < 0 || r.ny < 0) {
      const head = this._hd || (this._hd = new THREE.Vector3()); head.set(m.position.x, m.position.y + 0.9, m.position.z);
      if (!this.col.raycast(head, UPV, 1.2)) { push.y = Math.max(0, push.y); r.ny = Math.max(0, r.ny); const l = Math.hypot(r.nx, r.ny, r.nz) || 1; r.nx /= l; r.ny /= l; r.nz /= l; }
    }
    m.position.add(push);
    const nrm = _v2.set(r.nx, r.ny, r.nz), into = m.velocity.dot(nrm);
    if (into < 0) { m.velocity.addScaledVector(nrm, -into); m.velocity.multiplyScalar(r.ny > 0.7 ? 1 : 0.985); }
    if (m.hoverActive) m.hoverAnchor.copy(m.position);
    if (r.ny > 0.5 && m.velocity.y < 1) { this.slopeY = m.position.y - 1.01; this.slopeT = 0.12; }
    if (r.ny > 0.7) return null;    // roof contact: the flight model's ground handles it
    return { speed: -into, n: nrm.clone(), p: m.position.clone().addScaledVector(nrm, -BODY_R) };
  }
  onBonk(b) {
    if (b.speed < 14 || this._bonkT > performance.now()) return;
    this._bonkT = performance.now() + 350;
    const f = clamp(b.speed / 60, 0, 1);
    this.world.vfx?.sparks.burst(b.p, b.n, Math.round(20 + 40 * f), 8 + 8 * f, 0.9, new THREE.Color(1, 0.8, 0.5), 0.6);
    this.sfx('im_land_hero', { at: b.p, gain: 0.5 + 0.5 * f }); this.sfx('mk42_plate_hit', { at: b.p, gain: 0.8 });
    this.haptic(f > 0.5 ? 'hit_heavy' : 'hit_light');
    this.kick({ shake: 0.25 + 0.5 * f, hitstop: 40 + 60 * f, fov: -2 * f });
    this.cam.punch(0, 0, -0.4 * f);
    this.event({ kind: 'hit', what: 'wall', speed: b.speed });
  }
  takeoff() {
    this.takeoffT = 0.9;                  // take-off is a commitment (V2): the hover it ends in is ≥ 3 m up
    this.anim.oneShot('takeoff', { from: 0.3, fadeIn: 0.05, fadeOut: 0.35 });
    this.sfx('im_thruster_ignite', { at: this.root, gain: 0.9 }); this.sfx('im_takeoff', { at: this.root });
    this.world.vfx?.cue('dust', this.root, {}, this.root);
    this.haptic('boost', 0.6); this.kick({ shake: 0.18, fov: 2 });
    this.event({ kind: 'takeoff' });
  }
  onLand(vFall, speed) {
    const hard = vFall > 13 || speed > 24;
    if (vFall < 1.5 && speed < 4) return;
    const impactSp = Math.hypot(vFall, 0.4 * speed), feet = this.m.position.clone(); feet.y -= 1;
    this.juice?.land(feet, impactSp, this.heavy);
    if (this.heavy) this.juice?.quake(feet, Math.min(1.5, impactSp / 15));
    this.anim.cancelShot(null, 0.1);
    if (hard) { this.anim.oneShot('land_hero', { fadeIn: 0.04, fadeOut: 0.45 }); this.landLock = 0.85; }
    else this.anim.oneShot('land_soft', { fadeIn: 0.05, fadeOut: 0.3 });
    const f = clamp(vFall / 30, 0, 1);
    this.MZ.haptics && this.local && this.MZ.haptics.land(Math.max(vFall, speed * 0.4));
    this.kick({ shake: hard ? 0.35 + 0.35 * f : 0.12, hitstop: hard ? 70 : 0, fov: hard ? -4 : -1 });
    this.cam.punch(0, -0.25 * (hard ? 1 : 0.4), 0);
    this.event({ kind: 'land', speed: Math.hypot(vFall, 0.4 * speed) });   // impact speed: the crowd + shockwave scale by it
  }
  onBoost() {
    this.anim.oneShot('boost', { fadeIn: 0.06, fadeOut: 0.4 });
    this.sfx('im_boost', { at: this.root });
    this.haptic('boost'); this.kick({ fov: 10, shake: 0.22 }); this.cam.fovKick += 6;
    const v = this.world.vfx;
    if (v) { const back = _v.set(0, 0, 1).applyQuaternion(this.m.quat), at = this.m.position.clone().addScaledVector(back, 1.2);
      v.bb.spawn({ at, map: 'ring', color: 0xdfefff, size: 0.8, grow: 7, life: 0.45, normal: back, opacity: 0.7 });
      v.bb.spawn({ at, map: 'glow', color: 0xcfe6ff, size: 2.5, grow: 1, life: 0.12 }); }
    this.boostT = 0.5;
    this.event({ kind: 'boost' });
  }
  onBrake(speed) {
    this.brakeCool = 1.4;
    this.anim.oneShot('fly_brake', { fadeIn: 0.1, fadeOut: 0.4, speed: 1.15 });
    this.sfx('im_brake', { at: this.root, gain: clamp(speed / 150, 0.4, 1) });
    this.haptic('brake', clamp(speed / 120, 0.4, 1)); this.kick({ shake: 0.12, fov: -3 });
    this.cam.punch(0, 0, 0.35);
    if (speed > 80) this.juice?.brakeSparks([this.flaps.backL, this.flaps.backR, this.flaps.calfL, this.flaps.calfR]);
  }

  // ---- aim + repulsors
  updateAim() {
    const cam = this.world.camera;
    const o = cam.getWorldPosition(_v), d = cam.getWorldDirection(_v2);
    const hit = this.col.raycast(o, d, 900, this._aimHit || (this._aimHit = {}));
    if (hit && hit.t > 6) this.aimPoint.set(hit.x, hit.y, hit.z); else this.aimPoint.copy(o).addScaledVector(d, hit ? 60 : 900);
    this.aimHit = hit && hit.t > 6 ? { n: new THREE.Vector3(hit.nx, hit.ny, hit.nz), dist: hit.t } : null;
    const p = _v3.copy(this.aimPoint).project(cam);
    this.aimScreen.x = (p.x + 1) / 2; this.aimScreen.y = (1 - p.y) / 2;
  }
  shoot(dt, a) {
    if (!a) return;
    for (const hand of ['R', 'L']) {
      const S = this.shot[hand], arm = this.arms[hand], id = hand === 'R' ? 'rep_r' : 'rep_l';
      S.cool -= dt; S.buf = Math.max(0, S.buf - dt); S.hold -= dt;
      if (a.pressed(id)) { S.buf = FIRE_BUFFER; S.hold = ARM_HOLD; S.pressT = 0; S.big = false; }
      if (a.down(id)) {
        S.pressT = (S.pressT || 0) + dt; S.hold = ARM_HOLD;
        if (S.pressT > CHARGE_AFTER) {
          if (!S.charging) { S.charging = true; S.chargeSnd = this.sfx('repulsor_charge', { at: this.palm[hand] }); this.haptic('repulsor_charge'); }
          S.charge = Math.min(1, S.charge + dt / CHARGE_TIME);
          this.world.vfx?.repulsors.charge(this.palm[hand], S.charge);
          if (this.local) this.MZ.haptics?.hum?.('charge', S.charge, dt);
        }
      } else if (S.charging) {
        S.charging = false; S.chargeSnd?.stop(0.05);
        if (S.charge > 0.45) { S.buf = FIRE_BUFFER; S.big = true; }
        else this.world.vfx?.repulsors.charge(this.palm[hand], 0);
        S.charge = 0;
      }
      arm.want = S.hold > 0 || S.buf > 0 || S.charging ? 1 : 0;
      arm.target.copy(this.aimPoint);
    }
    const any = this.arms.L.want || this.arms.R.want;
    this.look.want = any ? 1 : 0.35; this.look.target.copy(this.aimPoint);
  }
  /** after the IK has run this frame: shots whose arm is up leave the palm now */
  fireReady() {
    for (const hand of ['R', 'L']) {
      const S = this.shot[hand], arm = this.arms[hand];
      if (S.buf <= 0 || S.cool > 0 || !this.palm[hand]) continue;
      if (arm.ok && arm.weight < ARM_READY) continue;          // hold the shot until the arm is up
      S.buf = 0; S.cool = FIRE_COOL;
      this.fire(hand, S.big); S.big = false;
    }
  }
  fire(hand, big, target = this.aimPoint, remote = false) {
    const palm = this.palm[hand], vfx = this.world.vfx; if (!palm || !vfx) return;
    const from = palm.getWorldPosition(new THREE.Vector3());
    const dir = target.clone().sub(from); const dist = dir.length(); dir.divideScalar(dist || 1);
    vfx.repulsors.speed = BOLT_SPEED;
    const hit = this.col.raycast(from, dir, 900);
    const bolt = vfx.repulsors.fire(palm, from.clone().addScaledVector(dir, 50), { big });
    const d = hit ? hit.t : 900;
    bolt.life = d / BOLT_SPEED;
    this.bolts.push({ bolt, big, d, p: hit ? new THREE.Vector3(hit.x, hit.y, hit.z) : null, n: hit ? new THREE.Vector3(hit.nx, hit.ny, hit.nz) : null });
    this.arms[hand].recoil = big ? 1 : 0.65;
    this.sfx(big ? 'repulsor_fire_big' : 'repulsor_fire', { at: palm, gain: big ? 1 : 0.85 });
    if (remote) return;
    // RECOIL MOVES THE SUIT (V2): a repulsor is a thruster pointed at something else
    this.m.velocity.addScaledVector(dir, big ? -5 : -0.8);
    this.haptic(big ? 'charged_blast' : 'repulsor_shot');
    this.kick({ shake: big ? 0.3 : 0.06, fov: big ? 3 : 0.8, hitstop: big ? 45 : 0 });
    this.cam.punch(hand === 'R' ? 0.03 : -0.03, 0.03, big ? 0.35 : 0.08);
    this.event({ kind: 'shot', hand, big, to: target.toArray().map(v => +v.toFixed(1)) });
  }
  updateBolts() {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      if (this.world.vfx.repulsors.bolts.includes(b.bolt)) continue;
      this.bolts.splice(i, 1);
      if (!b.p || b.bolt.t < b.bolt.life - 0.05) continue;     // the floor test already hit it
      this.world.vfx.repulsors._impact(b.p, b.n, b.big);
      this.juice?.impact(b.p, b.n, b.big, b.d);
      if (!this.local) continue;
      const near = clamp(1 - b.d / 140, 0, 1);
      if (near > 0) { this.kick({ shake: (b.big ? 0.35 : 0.1) * near, hitstop: (b.big ? 55 : 16) * (near > 0.3 ? 1 : 0) }); this.haptic(b.big ? 'explosion_near' : 'hit_light', 0.3 + 0.7 * near); }
      else if (b.big) this.haptic('explosion_far');
      this.event({ kind: 'hit', what: 'repulsor', big: b.big, at: b.p.toArray().map(v => +v.toFixed(1)) }, false);
    }
  }

  // ------------------------------------------------------------------ animation state machine
  stateMachine(dt, cmd) {
    const m = this.m, A = this.anim;
    if (m.grounded) {
      const gs = m.groundSpeed;
      const w = blend1D([[0.08, 'idle'], [0.9, 'walk'], [2.6, 'walk'], [4.2, 'run']], gs);
      A.setBase(w, 10);
      // distance-synced cycles (the clip's own stride, so the feet never skate)
      this.phaseW = (this.phaseW || 0) + gs * dt / 1.065 * (this.walkBack ? -1 : 1);
      this.phaseR = (this.phaseR || 0) + gs * dt / 2.176 * (this.walkBack ? -1 : 1);
      A.setPhase('walk', this.phaseW); A.setPhase('run', this.phaseR);
      return;
    }
    // airborne: speed blend space + direction overlays
    const bv = m.toBody(m.velocity, _v), fwd = -bv.z, lat = bv.x, vy = m.velocity.y, sp = m.speed;
    const fw = Math.max(0, fwd);
    const loco = m.hoverActive && sp < 6 ? { hover: 1 } : blend1D([[3, 'hover'], [14, 'fly_slow'], [42, 'fly_cruise'], [170, 'fly_cruise'], [250, 'fly_fast']], fw);
    const lowF = 1 - clamp(fw / 45, 0, 1);
    const over = {};
    const strafe = clamp((Math.abs(lat) - 2) / 12, 0, 1) * lowF;
    if (strafe > 0) over[lat > 0 ? 'fly_strafe_R' : 'fly_strafe_L'] = strafe * 0.9;
    const bankW = clamp(Math.abs(m.bank) / 0.62, 0, 1) * clamp(fw / 40, 0, 1) * 0.65;
    if (bankW > 0.02) over[m.bank < 0 ? 'fly_bank_R' : 'fly_bank_L'] = bankW;
    const vert = lowF * clamp((Math.abs(vy) - 2.5) / 8, 0, 1);
    if (vert > 0) over[vy > 0 ? 'fly_ascend' : 'fly_descend'] = vert * 0.85;
    let os = 0; for (const k in over) os += over[k];
    const k = os > 1 ? 1 / os : 1, rest = Math.max(0, 1 - os * k);
    const w = {}; for (const n in loco) w[n] = loco[n] * rest; for (const n in over) w[n] = over[n] * k;
    A.setBase(w, 6);
    // hover <-> fly transitions as one-shots, so the change of attitude has anticipation
    if (this._flying && fw < 10 && sp < 12) { this._flying = false; if (!A.shotPlaying('fly_brake')) A.oneShot('fly_to_hover', { fadeIn: 0.12, fadeOut: 0.3, weight: 0.8 }); }
    else if (!this._flying && fw > 22) { this._flying = true; A.oneShot('hover_to_fly', { fadeIn: 0.1, fadeOut: 0.3, weight: 0.7 }); }
    // aim layers: the torso turns into the shot, the IK then puts the palm exactly on the target
    const aL = this.arms.L.want, aR = this.arms.R.want;
    A.layer('aim_both', aL && aR ? 0.8 : 0, { rate: 10 });
    A.layer('aim_R', aR && !aL ? 0.75 : 0, { rate: 10 });
    A.layer('aim_L', aL && !aR ? 0.75 : 0, { rate: 10 });
  }

  // ------------------------------------------------------------------ procedural layers
  procedural(dt, cmd) {
    const m = this.m, air = m.grounded ? 0 : 1;
    // FL-1 flaps: the inside of a slide/bank opens, a brake opens everything, speed trims them
    const bv = m.toBody(m.velocity, _v), fwd = Math.max(0, -bv.z), sp = m.speed;
    const brake = (cmd.retro || 0) * clamp((fwd - 8) / 40, 0, 1);
    const slide = clamp(cmd.lateral || 0, -1, 1) * clamp(sp / 30, 0.3, 1);
    const flutter = 0;   // (was a 3 Hz flap flutter on the calves: part of the 'legs wave' in playtest 1)
    const want = s => air * clamp(Math.max(brake * 1.0, Math.max(0, s === 'R' ? slide : -slide) * 0.9, 0.12 * clamp(sp / 120, 0, 1)) + flutter, 0, 1);
    this.flapOpen.L = damp(this.flapOpen.L, want('L'), 9, dt); this.flapOpen.R = damp(this.flapOpen.R, want('R'), 9, dt);
    for (const [key, node] of Object.entries(this.flaps)) {
      const kind = key.slice(0, -1), side = key.slice(-1), [ang, ax] = FLAP[kind];
      const o = this.flapOpen[side] * (kind === 'hip' ? 0.8 : 1);
      if (o < 1e-3) continue;
      const a = ax === 'y' ? ang * (side === 'L' ? -1 : 1) : ang;
      node.quaternion.slerp(_q.setFromAxisAngle(ax === 'x' ? X : Y, a), o);
    }
    // hands/feet trims from the thrust vector: boots swing AGAINST the thrust they make
    // (slide right → feet out left), hover corrections swing the arms (V2: poses answer the servo)
    const hc = m.hoverCorrection;
    // gentle and slow: a thumb resting on the stick must not swing the boots (playtest 1: legs wave)
    const lowSp = 1 - clamp(fwd / 60, 0, 1), latIn = Math.abs(cmd.lateral || 0) > 0.2 ? cmd.lateral : 0;
    const tx = clamp(latIn * 0.22 * lowSp + hc.x * 0.35 * lowSp, -0.3, 0.3) * air;
    const tz = clamp((cmd.retro || 0) * 0.25 - (cmd.vertical || 0) * 0.08 + hc.z * 0.3 * lowSp, -0.3, 0.3) * air;
    this.trim.x = damp(this.trim.x, tx, 2.5, dt); this.trim.z = damp(this.trim.z, tz, 2.5, dt);
    // LEGS HOLD STILL IN FLIGHT: the fly clips kick the knees (fly_cruise 15° over its loop) and a
    // crossfade of two loops of different lengths turned that into an irregular wave. In the air
    // the legs follow the animated pose only through a slow low-pass (≈0.4 s), on the ground 1:1.
    const legRate = air ? 2.5 : 40, kL = 1 - Math.exp(-dt * legRate);
    this.legNodes.forEach((n, i) => { this.legQ[i].slerp(n.quaternion, kL); n.quaternion.copy(this.legQ[i]); });
    const [hipL, hipR, shL, shR] = this.trimNodes;
    const qFeet = _q.setFromEuler(_e.set(this.trim.z, 0, -this.trim.x, 'XYZ'));
    hipL?.quaternion.premultiply(qFeet); hipR?.quaternion.premultiply(qFeet);
    const qArms = _q2.setFromEuler(_e.set(-this.trim.z * 0.5, 0, this.trim.x * 0.6 + hc.y * 0.3 * air, 'XYZ'));
    if (this.arms.L.want < 0.5) shL?.quaternion.premultiply(qArms);
    if (this.arms.R.want < 0.5) shR?.quaternion.premultiply(qArms);
    this.root.updateMatrixWorld(true);
    this.look.update(dt);
    this.arms.L.update(dt); this.arms.R.update(dt);
  }

  // ------------------------------------------------------------------ plumes, trails, sound, rumble
  effects(dt, cmd, aiming) {
    const m = this.m, air = !m.grounded;
    this.boostT = Math.max(0, this.boostT - dt);
    // V2 thrusters.gd split: boots carry lift and the forward push, palms stabilise (brake, slide,
    // climb, and hold the hover with the boots — "it is the palms you see from behind")
    const hov = m.hoverActive ? m.thrustMag : 0, fwdT = cmd.thrust || 0, vUp = Math.max(0, cmd.vertical || 0);
    const boots = air ? clamp(fwdT * 0.85 + vUp * 0.6 + (cmd.retro || 0) * 0.35 + hov * 0.95 + this.boostT + 0.12, 0, 1.4) : 0;
    const palmBase = air ? clamp((cmd.retro || 0) * 0.9 + Math.abs(cmd.lateral || 0) * 0.55 + vUp * 0.35 + fwdT * 0.12 + hov * 0.75 + 0.08, 0, 1.3) : 0;
    const set = (n, v) => this.thr[n]?.set(v);
    set('piv_thrusterL', boots); set('piv_thrusterR', boots);
    set('piv_palmL', this.arms.L.weight > 0.3 ? 0 : palmBase); set('piv_palmR', this.arms.R.weight > 0.3 ? 0 : palmBase);
    this.updateBolts();
    if (this.juice) {
      const spNow = m.speed, MACH = 330;
      if (air && this._spPrev < MACH && spNow >= MACH) this.juice.boom(m.position.clone(), m.velocity);
      this._spPrev = spNow;
      if (air) this.juice.gVapor(this.root, m.gForce, spNow, dt);
      if (this.heavy && m.grounded && m.groundSpeed > 0.6) { const half = Math.floor(m.stridePhase * 2); if (half !== this._hbStep) { this._hbStep = half; const f = m.position.clone(); f.y -= 1; this.juice.quake(f, Math.min(1, m.groundSpeed / 4)); this.sfx('hb_step_heavy', { at: this.root }); } }
      this.juice.update(dt);
    }
    { const t = performance.now() / 1000; for (const p of Object.values(this.thr)) p.update(dt, t, this.grit); this.grit?.update(dt, this.world.camera, this.world.renderer || this.MZ.stage?.renderer); }
    // sound: thruster bed follows thrust, a hot layer for boost, wind follows speed
    const sp = m.speed;
    // THE ENGINE IS A BED, NOT A SERIES OF HISSES: sub rumble + idle→mid→hot roar crossfaded by thrust
    // + compressor whine pitched with thrust + air rush by speed; boost/brake add transients on top
    const th = air ? clamp(this.thrSmooth = damp(this.thrSmooth || 0, m.thrustMag, 8, dt), 0, 1.4) : (this.thrSmooth = damp(this.thrSmooth || 0, 0, 5, dt));
    const t1 = Math.min(1, th), boostK = this.boostT * 2 + (this._boosting ? 0.35 : 0);
    const xf = (a, b) => clamp((t1 - a) / (b - a), 0, 1);
    if (this.heavy) this.loop('rocket', 'hb_rocket_loop', th > 0.02 ? 0.3 + 0.6 * t1 : 0, 0.85 + 0.25 * t1);
    this.loop('sub', 'thruster_sub', th > 0.02 ? 0.35 + 0.55 * t1 + 0.3 * boostK : 0);
    this.loop('idle', 'thruster_idle', th > 0.02 ? 0.45 * (1 - xf(0.35, 0.7)) : 0, 0.9 + 0.2 * t1);
    this.loop('mid', 'thruster_mid', 0.7 * xf(0.25, 0.6) * (1 - 0.5 * xf(0.95, 1.3)), 0.9 + 0.2 * t1);
    this.loop('hot', 'thruster_hot', 0.75 * Math.min(1, xf(0.8, 1.2) + boostK), 0.95 + 0.1 * t1);
    this.loop('whine', 'thruster_whine', th > 0.02 ? 0.12 + 0.22 * t1 : 0, 0.85 + 0.3 * t1 + 0.1 * boostK);
    this.loop('windL', 'wind_low', air ? clamp((sp - 12) / 60, 0, 1) * (1 - clamp((sp - 120) / 100, 0, 1)) * 0.6 : 0);
    this.loop('windH', 'wind_high', air ? clamp((sp - 80) / 180, 0, 1) * 0.85 : 0, 0.9 + clamp(sp / 500, 0, 0.3));
    if (this.local) this.thrusterHum(dt, air ? t1 : 0, boostK);
  }

  /** docs/design/HAPTICS.md `thruster_hum` (level L = 0.06 + 0.22·throttle, activity chases 2·dThrottle,
   * decays when steady) — with a higher floor and gain: on the HP the core hum() at ≤ 0.1 could not be
   * felt at all (playtest 1: "no rumble"). Sent as 100 ms dual-rumble steps every 90 ms. */
  thrusterHum(dt, thr, boostK) {
    const H = this.MZ.haptics; if (!H?._fire) return;
    const hs = this._hum || (this._hum = { thr: 0, act: 0, next: 0, t: 0 });
    const d = Math.abs(thr - hs.thr) / Math.max(dt, 1e-3); hs.thr = thr; hs.t += dt;
    hs.act = d > 0.05 ? Math.min(1, hs.act + (Math.min(1, 2 * d) - hs.act) * (1 - Math.exp(-dt / 0.08))) : Math.max(0.6, hs.act - dt / 0.8);
    const L = thr < 0.02 ? 0 : 0.1 + 0.3 * thr + 0.25 * boostK;
    const now = performance.now(); if (now < hs.next || !H.enabled) return;
    hs.next = now + 90;
    const k = H.master * (H.scale?.thruster_hum ?? 1);
    if (L > 0) H._fire({ dur: 100, strong: Math.min(0.55, 1.0 * L * hs.act), weak: Math.min(0.5, L * hs.act * (0.85 + 0.15 * Math.sin(hs.t * 69))) }, k);
  }

  // ------------------------------------------------------------------ camera
  /** Suit wheel (hold D-pad ↓, right stick, release) and Veronica (D-pad ←; again = eject back).
   * Actions `suit_wheel` / `veronica` from core bindings when they exist, raw buttons until then. */
  suitInput(dt, axes) {
    const MZ = this.MZ, I = MZ.input; if (!I) return;
    const wb = MZ.bindings?.btn?.('ironman', 'suit_wheel') || 'down', vb = MZ.bindings?.btn?.('ironman', 'veronica') || 'left';
    // the UI agent's wheel owns the pad while open (context 'ui'): we only watch ↓ for the release
    if (this.uiWheel) {
      this.world.kick?.({ slow: 0.35, slowTime: 0.08 });
      if (!I.down(wb)) { this.uiWheel = false; MZ.ui.suitWheel(false); }
      return;
    }
    if (I.context !== 'game' || this.suitup) { if (this.wheel?.open) this.wheel.close(); return; }
    const verPressed = MZ.bindings?.btn?.('ironman', 'veronica') ? this.act?.pressed('veronica') : I.pressed(vb);
    if (verPressed && !this.locked) {
      if (this.suit === 'hulkbuster') this.eject(); else this.suitUp('hulkbuster');
      return;
    }
    const wheelPressed = MZ.bindings?.btn?.('ironman', 'suit_wheel') ? this.act?.pressed('suit_wheel') : I.pressed(wb);
    if (wheelPressed && !this.locked) {
      const roster = (MZ.ROSTER || MZ.SUITS || []).filter(s => s.hero === 'ironman' && s.id !== 'hulkbuster');
      const how = { mk85: 'Nanotech', mk42: 'Prehensile summon', mk1: 'Swap', mk2: 'Swap', mk3: 'Swap' };
      const items = [...roster.map(s => ({ id: s.id, name: s.name, sub: how[s.id] || 'Swap', how: how[s.id] })), { id: 'hulkbuster', name: 'Hulkbuster', sub: 'Veronica', how: 'Veronica' }];
      if (MZ.ui?.suitWheel) {
        this.uiWheel = true;
        MZ.ui.suitWheel(true, items, pick => { this.uiWheel = false; if (pick && pick.id !== this.suit && !pick.locked) this.suitUp(pick.id); });
        return;
      }
      (this.wheel ||= new SuitWheel(MZ)).show(items, this.suit);        // fallback (lab, harness)
    }
    if (this.wheel?.open) {
      const raw = this.act?.axes || { rx: 0, ry: 0 };
      this.wheel.point(raw.rx, raw.ry);
      this.world.kick?.({ slow: 0.35, slowTime: 0.08 });
      if (!I.down(wb)) { const pick = this.wheel.close(); if (pick && pick.id !== this.suit) this.suitUp(pick.id); }
    }
  }
  /** Hulkbuster → back to the armour it was deployed over: cockpit opens, the inner suit is out */
  async eject() {
    if (this.suit !== 'hulkbuster' || this.suitup) return;
    const to = this.prevSuit && this.prevSuit !== '__civilian' ? this.prevSuit : 'mk85';
    this.locked = true;
    this.anim.oneShot('cockpit_open', { fadeIn: 0.1, fadeOut: 0.2 });
    this.sfx('hb_part_blowoff', { at: this.root }); this.haptic('suit_clamp_big');
    await new Promise(r => setTimeout(r, 700));
    this.world.vfx?.cue('flash', this.root, { size: 2.2, color: 0xffd9a0 });
    await this.buildBody(to);
    this.m.velocity.y = Math.max(this.m.velocity.y, 9); this.m.grounded = false; this.takeoffT = 0.9;
    this.locked = false;
    this.MZ.theme?.set?.(to); this.MZ.emit?.('suit:change', { suit: to, hero: 'ironman', from: 'hulkbuster' });
    this.event({ kind: 'suitup_done', suit: to });
  }
  /** Helmet-safe hair on the Tony this controller shows (suit-up) — or on `tonyRoot` (the story's Tony in
   * the gantry): on when the helmet starts closing, off only while the face is visible (mask_open). */
  setHelmetHair(on, tonyRoot = this.tony) { return setHelmetHair(tonyRoot, on, this.MZ); }
  /** Story hook (story/control.js): parked = hidden, frozen where it is, silent, no plumes. */
  park(on) {
    this.parked = !!on;
    if (this.root) this.root.visible = !on;
    if (on) { for (const t of Object.values(this.thr || {})) { t.set(0); t.update(1, 0, null); } for (const h of Object.values(this.loops)) h?.gain?.(0), h && (h._g = 0); this.m.velocity.set(0, 0, 0); }
  }
  /** Place the suit (spawn, respawn, story cut) and clear every transient contact/landing state. */
  teleport(pos, yaw = this.m.yaw, { grounded = false, velocity = null } = {}) {
    const m = this.m;
    m.position.copy(pos); m.velocity.copy(velocity || _v.set(0, 0, 0)); m.yaw = yaw; m.pitch = 0; m.roll = 0; m._setBasis();
    m.grounded = grounded; m.hoverActive = false; m.hoverAnchor.copy(pos);
    this.slopeT = 0; this.takeoffT = 0; this.skidding = false; this.skidT = 0; this.landLock = 0; this.wasGrounded = grounded;
    this.anim?.cancelShot(null, 0); this.cam.snap(); this._prev.copy(pos);
  }
  /** In-game suit change with its sequence (Mk 85 nano, Mk 42 summon, Hulkbuster via Veronica). */
  async suitUp(id) {
    if (this.suitup || id === this.suit || (this.locked && !this.parked)) return false;
    this.parked = false;                  // the story parks the hero and then asks for a suit-up
    if (id === 'hulkbuster' && this.suit !== 'hulkbuster') this.prevSuit = this.suit;
    this.locked = true;
    try { await runSuitUp(this, id); } catch (e) { console.error('[suitup]', e); this.suitup?.abort?.(); this.locked = false; this.cine = null; this.root && (this.root.visible = true); say(this, 'Suit-up failed'); }
    return true;
  }
  updateCamera(dt, cam) {
    const m = this.m;
    if (this.suitup?.cam) { this.fov = this.suitup.cam(cam); cam.updateProjectionMatrix(); this.cam.snap(); return; }
    if (this.cine?.off) {                               // suit-up close-up, in the pilot's yaw frame
      const c = this.cine; this.cineSpin = (this.cineSpin || 0) + dt * (m.grounded ? 0.12 : 0.35);
      const q = _q.setFromAxisAngle(Y, m.yaw + this.cineSpin);
      const want = _v.set(...c.off).applyQuaternion(q).add(this.root.position);
      this._cinePos = this._cinePos ? this._cinePos.lerp(want, 1 - Math.exp(-dt * 3)) : want.clone();
      cam.position.copy(this._cinePos); cam.lookAt(_v2.copy(this.root.position).setY(this.root.position.y + c.look));
      this.fov = damp(this.fov, c.fov, 3, dt); cam.fov = this.fov; cam.updateProjectionMatrix(); this.cam.snap(); return;
    }
    this._cinePos = null; this.cineSpin = 0;
    const focus = _v.copy(m.position); focus.y += 0.35;
    const pitch = m.grounded ? this.camPitchFoot : clamp(m.pitch * 0.9 - 0.1, -1.3, 1.2);
    this.fov = this.cam.follow(dt, cam, { focus, yaw: m.yaw, pitch, speed: m.speed, top: m.spec.top_speed, aiming: this.aiming, collider: this.col, roll: -m.bank * 0.12 });
    // always: the world only copies player.fov after its first kick (cam.userData.baseFov), so until
    // then the camera sat at its default 60° — the speed FOV (and any lens) never showed
    cam.fov = this.fov; cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ network + remote
  state() {
    const m = this.m, f = (m.grounded ? 1 : 0) | (m.hoverActive ? 2 : 0) | (this._boosting ? 4 : 0) | (this.arms.L.want ? 8 : 0) | (this.arms.R.want ? 16 : 0);
    const r3 = v => +v.toFixed(2);
    return { p: m.position.toArray().map(r3), q: this.root.quaternion.toArray().map(v => +v.toFixed(4)), v: m.velocity.toArray().map(r3),
      th: r3(m.thrustMag), f, gs: r3(m.groundSpeed), bk: r3(m.bank), ap: this.aimPoint.toArray().map(v => +v.toFixed(1)),
      c: [r3(this.lastCmd?.lateral || 0), r3(this.lastCmd?.retro || 0), r3(this.lastCmd?.vertical || 0)] };
  }
  updateRemote(dt, t) {
    const n = this.net, m = this.m;
    if (n.has) {
      const k = 1 - Math.exp(-dt / 0.12);
      m.position.lerp(_v.copy(n.p).addScaledVector(n.v, 0.05), k); m.velocity.lerp(n.v, k);
      this.root.quaternion.slerp(n.q, k);
      const s = n.s; m.grounded = !!(s.f & 1); m.hoverActive = !!(s.f & 2); m.thrustMag = lerp(m.thrustMag, s.th || 0, k);
      m.groundSpeed = s.gs || 0; m.bank = s.bk || 0; this._boosting = !!(s.f & 4);
      this.arms.L.want = s.f & 8 ? 1 : 0; this.arms.R.want = s.f & 16 ? 1 : 0;
      if (s.ap) { this.aimPoint.fromArray(s.ap); this.arms.L.target.copy(this.aimPoint); this.arms.R.target.copy(this.aimPoint); this.look.target.copy(this.aimPoint); }
      _q.copy(this.root.quaternion); _e.setFromQuaternion(_q, 'YXZ'); m.yaw = _e.y; m.pitch = _e.x; m._setBasis();
    }
    this.root.position.copy(m.position); this.root.position.y -= 1;
    const c = this.net.s?.c || [0, 0, 0], cmd = { lateral: c[0], retro: c[1], vertical: c[2], thrust: 0 };
    this.stateMachine(dt, cmd); this.anim.update(dt); this.nano?.update(dt); this.procedural(dt, cmd); this.effects(dt, cmd, false);
  }
  remoteEvent(e) {
    if (e.kind === 'shot' && e.to) { const hand = e.hand === 'L' ? 'L' : 'R'; this.arms[hand].want = 1; this.fire(hand, !!e.big, new THREE.Vector3().fromArray(e.to), true); }
    if (e.kind === 'boost') this.sfx('im_boost', { at: this.root });
    if (e.kind === 'takeoff') this.anim.oneShot('takeoff', { from: 0.3, fadeIn: 0.05, fadeOut: 0.35 });
    if (e.kind === 'land') this.anim.oneShot(e.speed > 13 ? 'land_hero' : 'land_soft', { fadeIn: 0.05, fadeOut: 0.35 });
  }

  hud() {
    const m = this.m;
    return { speed: m.speed, vspeed: m.velocity.y, alt: m.position.y - 1, heading: ((-m.yaw * 180 / Math.PI) % 360 + 360) % 360,
      throttle: Math.min(1, m.thrustMag), boost: !!this._boosting, hover: m.hoverActive, grounded: m.grounded, g: m.gForce, health: this.health,
      aim: { ...this.aimScreen }, charge: { L: this.shot.L.charge, R: this.shot.R.charge }, armor: m.spec.name,
      prompts: m.grounded ? [{ action: 'ascend', text: 'Take off' }] : [] };
  }
  dispose() { this.suitup?.abort?.(); this.wheel?.dispose(); this.juice?.dispose(); this.disposeBody(); this.grit?.dispose(); super.dispose(); }
}
