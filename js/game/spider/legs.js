// Iron Spider legs ("waldoes"). D-pad → toggles them OUT (they stay out) / IN again. Out, they are driven
// procedurally on top of the body clips (after the mixer; the joints are protected, like the web arm):
//   · ready pose (uppers arched over the shoulders, claws forward) with an idle sway, swept back with the speed in
//     the air and on a swing
//   · the lower pair PLANTED on the ground when he stands or walks (a stepping gait), all four on the WALL when he
//     crawls (a diagonal gait; crawling is faster with them)
//   · a LANDING BRAKE: a hard or fast landing slams them into the ground ahead, they skid with sparks, the speed dies
//   · leg STABS in the strike combo (and the four-leg flurry on the combo's big hit), BLOCKING bullets
// Rig (spider-tools/blender/spider/spider_legs.py): piv_leg{1,2}{L,R}_{a,b,c,tip}; _a is a child of piv_chest; the
// identity rest pose IS the deployed ready pose; drv_legs 0/1 = nano-hidden / shown (the deploy / stow clips key it).
import * as THREE from 'three';

const IDS = ['1L', '1R', '2L', '2R'];
const DEPLOY = 0.86, STOW = 0.58;                // clip lengths used (legs_deploy 0.9 s, legs_stow 0.6 s)
const STEP_G = 0.55, STEP_W = 0.42, STEP_T = 0.15, LIFT = 0.22;
export const LEGS_CRAWL = 1.35;                  // crawl speed factor with the legs out
const V3 = () => new THREE.Vector3();
// scratch, one per role (update / ideal / solve never share one)
const V = Object.fromEntries(['P', 'A0', 'd1', 'd2', 'T', 'K', 'kn', 'tmp', 'tmp2', 'vdir', 'cx', 'cy', 'ir', 'iu', 'if', 'sp', 'sp2'].map(k => [k, V3()]));
const S = Object.fromEntries(['B', 'dn', 'pv', 'bW', 'C', 'cW', 'dA'].map(k => [k, V3()]));
const Q = Object.fromEntries(['pq', 'iq', 't', 'cq'].map(k => [k, new THREE.Quaternion()]));
const UP = new THREE.Vector3(0, 1, 0);
const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

export class SpiderLegs {
  constructor(hero) {
    this.h = hero; this.ok = false; this.tried = false;
    this.state = 'in'; this.t = 0; this.w = 0;        // w: the procedural weight (0 while a legs clip plays)
    this.brake = null; this.clipT = 0; this.blocks = 0; this.clock = 0;
    this.stats = { deploys: 0, brakes: 0, steps: 0, stabs: 0, blocks: 0, deflects: 0, vaults: 0, pins: 0 };
  }
  get out() { return this.state === 'out' || this.state === 'deploying'; }
  init() {
    this.tried = true;
    const R = this.h.root, legs = [];
    for (const id of IDS) {
      const n = s => R.getObjectByName(`piv_leg${id}_${s}`);
      const j = [n('a'), n('b'), n('c')], tip = n('tip');
      if (!j.every(Boolean) || !tip) return false;
      const seg = [j[1].position, j[2].position, tip.position];
      legs.push({ id, upper: id[0] === '1', side: Math.sign(seg[0].x) || (id[1] === 'R' ? 1 : -1), j, tip,
        len: seg.map(s => s.length()), rest: seg.map(s => s.clone().normalize()), ph: IDS.indexOf(id) * 1.7,
        plant: null, step: null, k: 0, stab: null, q: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()] });
    }
    this.chest = R.getObjectByName('piv_chest'); this.drv = R.getObjectByName('drv_legs');
    this.legs = legs;
    this.h.anim.protect([...legs.flatMap(l => l.j), ...(this.drv ? [this.drv] : [])]);
    this.ok = !!this.chest; return this.ok;
  }

  // ---------------------------------------------------------------- toggle
  toggle() {
    if (!this.ok && !(this.tried ? false : this.init())) return false;
    const h = this.h, A = h.anim;
    if (!A.has('legs_deploy')) return false;
    if (this.out) {
      this.state = 'stowing'; this.t = 0; this.brake = null;
      A.layer('legs_stow', 1, { restart: true, rate: 30 });
      h.haptic('web_release', 0.5);
      h.event({ kind: 'legs', on: false }, false);
    } else {
      this.state = 'deploying'; this.t = 0; this.stats.deploys++;
      A.layer('legs_deploy', 1, { restart: true, rate: 40 });
      h.haptic('web_zip', 0.45);
      h.event({ kind: 'legs', on: true }, false);
    }
    for (const L of this.legs) { L.plant = null; L.step = null; L.k = 0; L.stab = null; }
    return true;
  }
  /** a legs clip (legs_strike) owns the legs for `secs`: the procedural pose fades out and back in */
  playClip(name, secs) { if (!this.h.anim.has(name)) return false; this.h.anim.layer(name, 1, { restart: true, rate: 40 }); this.clipT = secs; return true; }

  // ---------------------------------------------------------------- hooks from the controller / combat
  /** a landing with the legs out: hard or fast = the brake. Returns true when it took the landing. */
  onLand(vFall, hs) {
    if (this.state !== 'out' || !this.ok || (vFall < 13 && hs < 9)) return false;
    const h = this.h;
    this.brake = { t: 0, dur: 0.55 + Math.min(0.35, hs / 60), v0: hs }; this.stats.brakes++;
    for (const L of this.legs) { L.step = null; L.plant = this.brakePoint(L, new THREE.Vector3()); L.k = Math.max(L.k, 0.6); }
    h.sfx('sp_leg_step_1', { at: h.root, gain: 1.2 }); h.sfx('sp_leg_servo_2', { at: h.root, gain: 0.9 }); h.sfx('sp_land_hard', { at: h.root, gain: 0.8 });
    h.haptic('land_hero', 0.8);
    h.kick({ shake: Math.min(0.45, 0.12 + vFall / 60), fov: -2 });
    this.sparks(12 + Math.min(24, hs));
    return true;
  }
  /** the horizontal speed factor per frame while braking (the controller multiplies its ground velocity) */
  brakeDrag(dt) { return this.brake ? Math.exp(-dt * 5.5) : 1; }
  /** incoming damage (dmg > 0): the legs guard — every 3rd hit is deflected outright, the others × 0.55 */
  block(dmg, src = null) {
    if (this.state !== 'out' || !this.ok || this.clipT > 0) return 1;
    this.blocks++;
    // the upper leg on the attacker's side flicks out towards him (else in front)
    const h = this.h, dir = new THREE.Vector3(-Math.sin(h.yaw), 0, -Math.cos(h.yaw));
    if (src) { const d = new THREE.Vector3(src.x - h.pos.x, 0, src.z - h.pos.z); if (d.lengthSq() > 0.01) dir.copy(d.normalize()); }
    const side = Math.sign(dir.x * Math.cos(h.yaw) - dir.z * Math.sin(h.yaw)) || (this.blocks & 1 ? 1 : -1);
    // (a leg busy gripping keeps its grip: then only the damage is guarded)
    const L = [...this.legs].sort((a, b) => (b.upper - a.upper) || ((b.side === side) - (a.side === side))).find(l => !l.stab?.hold);
    const at = h.pos.clone().addScaledVector(dir, 1.25); at.y += 0.5;
    if (L) L.stab = { t: 0, dur: 0.22, at };
    this.stats.blocks++;
    const deflect = this.blocks % 3 === 0;
    if (deflect) this.stats.deflects++;
    h.sfx('sp_leg_strike', { at: h.root, gain: 0.7 });
    h.haptic('hit_light', 0.6);
    this.sparks(deflect ? 22 : 12, at);
    return deflect ? 0 : 0.55;
  }
  /** a leg stab at a foe (combat): the upper leg on its side lunges its claw at the chest */
  stab(point, dur = 0.26) {
    if (this.state !== 'out' || !this.ok) return false;
    const h = this.h, rx = Math.cos(h.yaw), rz = -Math.sin(h.yaw);
    const side = Math.sign((point.x - h.pos.x) * rx + (point.z - h.pos.z) * rz) || 1;
    const L = this.legs.find(l => l.upper && l.side === side && !l.stab) || this.legs.find(l => !l.stab);
    if (!L) return false;
    L.stab = { t: 0, dur, at: point.clone() }; this.stats.stabs++;
    h.sfx('sp_leg_strike', { at: h.root, gain: 0.8 });
    return true;
  }

  /** both upper claws GRIP a moving point (track() → world point) for dur s: the pin */
  grip(track, dur) {
    if (this.state !== 'out' || !this.ok) return false;
    // each claw a little to its own side (both read on his shoulders, not one on top of the other)
    const h = this.h;
    for (const L of this.legs) if (L.upper) {
      const tr = () => { const p = track(); return (L._gp ||= new THREE.Vector3()).set(p.x + Math.cos(h.yaw) * L.side * 0.24, p.y, p.z - Math.sin(h.yaw) * L.side * 0.24); };
      L.stab = { t: 0, dur, at: tr().clone(), track: tr, hold: true };
    }
    this.h.sfx('sp_leg_servo_3', { at: this.h.root, gain: 0.9 });
    return true;
  }
  /** a LEG VAULT over a low obstacle: the upper claws plant on its top (world point) as he goes over */
  vault(top) {
    if (this.state !== 'out' || !this.ok) return false;
    this.vaultT = 0.42; this.vaultAt = top.clone(); this.stats.vaults = (this.stats.vaults || 0) + 1;
    for (const L of this.legs) if (L.upper) { L.plant = null; L.step = null; }
    this.h.sfx('sp_leg_step_2', { at: this.h.root, gain: 0.8 }); this.h.sfx('sp_leg_servo_1', { at: this.h.root, gain: 0.7 });
    return true;
  }

  // ---------------------------------------------------------------- per frame (after the mixer)
  update(dt) {
    if (!this.ok) { if (!this.tried && this.h.root) this.init(); if (!this.ok) return; }
    const h = this.h; this.clock += dt;
    this.t += dt; this.clipT = Math.max(0, this.clipT - dt);
    if (this.state === 'deploying' && this.t >= DEPLOY) this.state = 'out';
    if (this.state === 'stowing' && this.t >= STOW) this.state = 'in';
    if (this.brake && (this.brake.t += dt) >= this.brake.dur) this.brake = null;
    this.vaultT = Math.max(0, (this.vaultT || 0) - dt);
    const want = this.state === 'out' && this.clipT <= 0 ? 1 : 0;
    this.w += (want - this.w) * (1 - Math.exp(-dt * (want ? 9 : 22)));
    if (this.w < 0.01) { this.w = 0; return; }

    h.root.updateMatrixWorld(true);
    this.axes();
    const sp = h.vel.length(), hs = Math.hypot(h.vel.x, h.vel.z);
    const mode = this.brake ? 'brake' : this.vaultT > 0 ? 'vault' : h.stuck ? 'wall' : (h.grounded && hs < 6 && !h.zip) ? 'ground' : 'air';
    this.mode = mode;
    // the sweep: in the air the legs trail the flight a little (swept back), more with speed
    const sweep = mode === 'air' ? Math.min(0.55, sp / 55) : 0;
    const vdir = sp > 0.5 ? V.vdir.copy(h.vel).divideScalar(-sp) : V.vdir.set(0, 0, 0);
    const t = this.clock, sw = mode === 'ground' ? 0.1 : 0.05;
    for (const L of this.legs) {
      const a = L.j[0]; a.parent.getWorldQuaternion(Q.pq);
      const P = a.getWorldPosition(V.P);
      // --- the ready pose (+ sway + sweep): tip / knee / first-segment direction, world
      const A0 = V.A0.copy(L.rest[0]).applyQuaternion(Q.pq);
      const d1 = V.d1.copy(L.rest[1]).applyQuaternion(Q.pq), d2 = V.d2.copy(L.rest[2]).applyQuaternion(Q.pq);
      d1.x += Math.sin(t * 1.3 + L.ph) * sw; d1.y += Math.sin(t * 0.9 + L.ph * 2) * sw; d1.z += Math.sin(t * 1.1 + L.ph * 3) * sw;
      d2.x += Math.sin(t * 1.7 + L.ph * 1.3) * sw * 1.4; d2.y += Math.sin(t * 1.2 + L.ph) * sw * 1.4;
      if (sweep > 0) { d1.addScaledVector(vdir, sweep * 0.8); d2.addScaledVector(vdir, sweep * 1.6); }
      d1.normalize(); d2.normalize();
      const T = V.T.copy(P).addScaledVector(A0, L.len[0]).addScaledVector(d1, L.len[1]).addScaledVector(d2, L.len[2]);
      const K = V.K.copy(d1);
      // --- planted (ground: the lower pair; wall and brake: all four)
      const plant = mode === 'brake' || mode === 'wall' || (mode === 'ground' && !L.upper) || (mode === 'vault' && L.upper);
      if (plant) this.servicePlant(L, mode, dt); else { L.plant = null; L.step = null; }
      L.k += ((plant && L.plant ? 1 : 0) - L.k) * (1 - Math.exp(-dt * (mode === 'brake' || mode === 'vault' ? 30 : 10)));
      if (L.k > 0.001 && L.plant) {
        const pt = this.plantNow(L, mode === 'wall' ? h.wallN : UP);
        T.lerp(pt, L.k);
        // knee: up and out on the ground, off the wall on a wall; the first segment turns a little towards the tip
        const kn = V.kn.copy(V.cx).multiplyScalar(L.side);
        if (mode === 'wall') kn.multiplyScalar(0.5).addScaledVector(h.wallN, 1).addScaledVector(V.cy, L.upper ? 0.4 : -0.2);
        else kn.multiplyScalar(0.7).add(UP);
        K.lerp(kn.normalize(), L.k).normalize();
        A0.lerp(V.tmp.copy(pt).sub(P).normalize(), 0.35 * L.k).normalize();
      }
      // --- a stab / block flick: the claw lunges at the point and springs back
      if (L.stab) {
        const s = L.stab; s.t += dt; const u = s.t / s.dur;
        if (u >= 1) L.stab = null;
        else {
          if (s.track) s.at.copy(s.track());
          const e = s.hold ? Math.min(smooth(s.t / 0.12), 1 - smooth((s.t - s.dur + 0.2) / 0.2)) : u < 0.35 ? smooth(u / 0.35) : 1 - smooth((u - 0.35) / 0.65);
          const reach = L.len[0] + L.len[1] + L.len[2] - 0.05, to = V.tmp.copy(s.at).sub(P), dl = to.length();
          A0.lerp(V.tmp2.copy(to).normalize(), 0.5 * e).normalize();
          if (dl > reach) to.multiplyScalar(reach / dl);
          T.lerp(to.add(P), e);
        }
      }
      this.solve(L, P, A0, T, K);
      for (let i = 0; i < 3; i++) L.j[i].quaternion.slerp(L.q[i], this.w);
    }
    if (mode === 'brake' && hs > 2) this.sparks(Math.min(5, 1 + hs * 0.2) * dt * 30);
  }
  axes() {
    this.chest.getWorldQuaternion(Q.cq);
    V.cx.set(1, 0, 0).applyQuaternion(Q.cq); V.cy.set(0, 1, 0).applyQuaternion(Q.cq);
  }

  /** the tip's ideal point in this mode (world) */
  ideal(L, mode, out) {
    const h = this.h;
    if (mode === 'wall') {
      const n = h.wallN;
      const r = V.ir.copy(V.cx).addScaledVector(n, -V.cx.dot(n)); if (r.lengthSq() < 1e-4) r.crossVectors(UP, n); r.normalize();
      const u = V.iu.crossVectors(n, r).normalize();          // "up" along the wall for his body
      return out.copy(h.pos).addScaledVector(n, -0.3).addScaledVector(r, L.side * (L.upper ? 0.95 : 1.1))
        .addScaledVector(u, L.upper ? 0.75 : -0.55).addScaledVector(h.vel, 0.18);
    }
    if (mode === 'vault') {                                 // the uppers on the obstacle's top, either side
      return out.set(Math.cos(h.yaw), 0, -Math.sin(h.yaw)).multiplyScalar(L.side * 0.45).add(this.vaultAt);
    }
    // ground: beside and a little behind him (lower pair); braking: the uppers ahead, the lowers wide
    const f = V.if.set(-Math.sin(h.yaw), 0, -Math.cos(h.yaw)), r = V.ir.set(Math.cos(h.yaw), 0, -Math.sin(h.yaw));
    const lat = L.upper ? 0.8 : 1.15, fw = mode === 'brake' ? (L.upper ? 1.35 : 0.25) : -0.35;
    out.copy(h.pos).addScaledVector(r, L.side * lat).addScaledVector(f, fw);
    if (mode !== 'brake') { out.x += h.vel.x * 0.22; out.z += h.vel.z * 0.22; }
    out.y = h.col.groundAt(out.x, out.z, h.pos.y + 0.6);
    if (!(out.y > h.pos.y - 3)) out.y = h.pos.y - 1.05;
    return out;
  }
  brakePoint(L, out) { this.axes(); return this.ideal(L, 'brake', out); }
  /** keep a planted tip; step it (a lifted arc) when it falls too far behind — at most two stepping, not one side */
  servicePlant(L, mode, dt) {
    const h = this.h, id = this.ideal(L, mode, L.idl ||= new THREE.Vector3());
    if (mode === 'vault') { if (!L.plant) { L.plant = id.clone(); this.clack(L, mode); } return; }
    if (mode === 'brake') {                                 // the tips skid with him (dragged a little behind)
      if (!L.plant) L.plant = id.clone();
      const v = h.vel; L.plant.x += v.x * dt * 0.92; L.plant.z += v.z * dt * 0.92;
      L.plant.y = h.col.groundAt(L.plant.x, L.plant.z, h.pos.y + 0.6); if (!(L.plant.y > h.pos.y - 3)) L.plant.y = h.pos.y - 1.05;
      return;
    }
    if (!L.plant) { L.plant = id.clone(); L.step = null; return; }
    if (L.step) {
      L.step.t += dt; L.step.to.copy(id);
      if (L.step.t >= STEP_T) { L.plant.copy(L.step.to); L.step = null; this.stats.steps++; this.clack(L, mode); }
      return;
    }
    const far = L.plant.distanceTo(id), lim = mode === 'wall' ? STEP_W : STEP_G;
    const busy = this.legs.filter(l => l.step).length, sideBusy = this.legs.some(l => l !== L && l.step && l.side === L.side);
    if (far > lim && busy < 2 && !sideBusy) L.step = { t: 0, from: L.plant.clone(), to: id.clone() };
  }
  /** the planted tip right now (mid-step: an arc off the surface) */
  plantNow(L, n) {
    if (!L.step) return L.plant;
    const u = smooth(L.step.t / STEP_T);
    return (L._pn ||= new THREE.Vector3()).lerpVectors(L.step.from, L.step.to, u).addScaledVector(n, Math.sin(Math.PI * u) * LIFT);
  }
  clack(L, mode) {
    const h = this.h, k = this.stats.steps % 3;
    h.sfx(['sp_leg_step_1', 'sp_leg_step_2', 'sp_leg_step_3'][k], { at: L.tip, gain: mode === 'wall' ? 0.45 : 0.35 });
  }
  sparks(n, at = null) {
    const vfx = this.h.world?.vfx; if (!vfx?.sparks || n < 1) return;
    const col = this._sc ||= new THREE.Color(1, 0.78, 0.42);
    if (at) { vfx.sparks.burst(at, null, Math.round(n), 6, 1, col, 0.35); return; }
    const v = this.h.vel, back = V.sp.set(-v.x, 0.6, -v.z).normalize();
    // at the ground contacts (the plants), not the claw nodes: at the slam those are still up in the ready pose
    for (const L of this.legs) if (L.plant && L.k > 0.5) vfx.sparks.burst(V.sp2.copy(L.plant).setY(L.plant.y + 0.04), back, Math.max(1, Math.round(n / 4)), 3 + Math.hypot(v.x, v.z) * 0.2, 0.8, col, 0.25);
  }

  /** 3 segments: a along A0 (world), then b/c a two-bone IK onto T with the knee towards K → local quaternions
   * (the parent's world rotation is in Q.pq) */
  solve(L, P, A0, T, K) {
    const [la, lb, lc] = L.len;
    const B = S.B.copy(P).addScaledVector(A0, la);
    const dn = S.dn.copy(T).sub(B); let dist = dn.length();
    if (dist > 1e-5) dn.divideScalar(dist); else dn.set(0, -1, 0);
    dist = Math.min(Math.max(dist, Math.abs(lb - lc) + 0.02), (lb + lc) * 0.999);
    const cosA = (lb * lb + dist * dist - lc * lc) / (2 * lb * dist), ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const pv = S.pv.copy(K).addScaledVector(dn, -K.dot(dn));
    if (pv.lengthSq() < 1e-6) pv.set(0, 1, 0).addScaledVector(dn, -dn.y);
    pv.normalize();
    const bW = S.bW.copy(dn).multiplyScalar(Math.cos(ang)).addScaledVector(pv, Math.sin(ang)).normalize();
    const Cp = S.C.copy(B).addScaledVector(bW, lb);
    const cW = S.cW.copy(B).addScaledVector(dn, dist).sub(Cp).normalize();
    // world → the parent (chest) frame → local quaternions (identity rests)
    Q.iq.copy(Q.pq).invert();
    L.q[0].setFromUnitVectors(L.rest[0], S.dA.copy(A0).applyQuaternion(Q.iq).normalize());
    Q.t.copy(L.q[0]).invert();
    L.q[1].setFromUnitVectors(L.rest[1], bW.applyQuaternion(Q.iq).applyQuaternion(Q.t).normalize());
    Q.t.copy(L.q[0]).multiply(L.q[1]).invert();
    L.q[2].setFromUnitVectors(L.rest[2], cW.applyQuaternion(Q.iq).applyQuaternion(Q.t).normalize());
  }
}
