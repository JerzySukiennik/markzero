// Procedural repulsor aim on the canonical skeleton — a layer applied AFTER the clip pose.
// This is the reference the Godot port copies (see assets/vfx/repulsor/NOTES.md):
//   raise: the shoulder/elbow are solved with two-bone IK so the wrist sits on the line from
//          the shoulder to the target, arm ~92% extended, elbow dropping towards `pole`;
//   aim:   the wrist turns so the palm emitter's -Y points exactly at the target and the
//          fingers point up; fingers bend BACK (the repulsor hand);
//   weight 0..1 blends from the animated pose, so raising and lowering are smooth;
//   recoil kicks the shoulder back and the elbow bends for a few frames after each shot.
import * as THREE from 'three';

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), _t = V();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();

export class ArmAim {
  constructor(root, side /* 'L' | 'R' */) {
    this.root = root; this.side = side;
    const n = s => root.getObjectByName(s + side);
    this.sh = n('piv_shoulder'); this.el = n('piv_elbow'); this.wr = n('piv_wrist'); this.palm = n('piv_palm');
    this.cl = n('piv_clavicle');
    this.fingers = ['index', 'middle', 'ring', 'pinky'].map(f => [n(`piv_f_${f}1`), n(`piv_f_${f}2`)]);
    this.thumb = [n('piv_f_thumb1'), n('piv_f_thumb2')];
    this.ok = !!(this.sh && this.el && this.wr && this.palm);
    if (!this.ok) return;
    this.la = this.el.position.length(); this.lb = this.wr.position.length();
    // rest hand frame (identity rest rotations -> offsets are world directions at rest)
    this.handAxis = this.fingers[1][0] ? this.fingers[1][0].position.clone().normalize() : new THREE.Vector3(0, -1, 0);
    this.palmOut = new THREE.Vector3(0, -1, 0).applyQuaternion(this.palm.quaternion); // in wrist-local
    this.curlAxis = this.handAxis.clone().cross(this.palmOut).normalize();
    this.weight = 0; this.target = new THREE.Vector3(0, 1.5, -10); this.want = 0;
    this.recoil = 0; this.fingerBack = 0;
  }

  /** every node this layer writes — hand them to ClipPlayer.protect() */
  nodes() { return this.ok ? [this.sh, this.el, this.wr, ...this.fingers.flat(), ...this.thumb].filter(Boolean) : []; }

  /** world-space quaternion that rotates node's rest child dir onto world dir d */
  _aimNode(node, childRestOffset, dWorld) {
    node.parent.getWorldQuaternion(_q).invert();
    const dl = _a.copy(dWorld).applyQuaternion(_q).normalize();
    return _q2.setFromUnitVectors(_b.copy(childRestOffset).normalize(), dl).clone();
  }

  update(dt) {
    if (!this.ok) return;
    const k = 1 - Math.exp(-dt * (this.want > this.weight ? 16 : 7));   // fast up, slower down
    this.weight += (this.want - this.weight) * k;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (this.weight < 0.002) return;
    const w = this.weight;
    this.root.updateMatrixWorld(true);
    // --- solve in world space
    const S = this.sh.getWorldPosition(V());
    const toT = _t.copy(this.target).sub(S);
    const dist = toT.length(); const dir = toT.clone().normalize();
    const reach = (this.la + this.lb) * (0.93 - 0.10 * this.recoil);
    const W = S.clone().addScaledVector(dir, Math.min(reach, dist * 0.9));
    const D = W.clone().sub(S); const dl = D.length();
    const cosA = THREE.MathUtils.clamp((this.la * this.la + dl * dl - this.lb * this.lb) / (2 * this.la * dl), -1, 1);
    const A = Math.acos(cosA);
    // pole: elbow drops down and slightly out
    const out = this.side === 'L' ? -1 : 1;
    const pole = _c.set(out * 0.35, -1, 0.15).normalize();
    pole.addScaledVector(D.clone().normalize(), -pole.dot(D.clone().normalize())).normalize();
    const E = S.clone().addScaledVector(D.clone().normalize(), Math.cos(A) * this.la).addScaledVector(pole, Math.sin(A) * this.la);
    // --- shoulder
    const qs = this._aimNode(this.sh, this.el.position, E.clone().sub(S));
    this.sh.quaternion.slerp(qs, w);
    this.sh.updateMatrixWorld(true);
    // --- elbow
    const Ew = this.el.getWorldPosition(V());
    const qe = this._aimNode(this.el, this.wr.position, W.clone().sub(Ew));
    this.el.quaternion.slerp(qe, w);
    this.el.updateMatrixWorld(true);
    // --- wrist: palm emitter -Y -> target, fingers (emitter -Z) -> up
    const Ww = this.wr.getWorldPosition(V());
    const aim = this.target.clone().sub(Ww).normalize();
    const y = aim.clone().negate();
    const up = _e.set(0, 1, 0); const z = up.clone().addScaledVector(y, -up.dot(y)).normalize().negate();
    if (z.lengthSq() < 1e-4) z.set(0, 0, 1);
    const x = y.clone().cross(z).normalize();
    const emitWorld = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z));
    // emitWorld = parentWorld * wristLocal * palmLocal  -> wristLocal = parentWorld^-1 * emitWorld * palmLocal^-1
    this.el.getWorldQuaternion(_q).invert();
    const qw = _q.clone().multiply(emitWorld).multiply(this.palm.quaternion.clone().invert());
    this.wr.quaternion.slerp(qw, w);
    // --- fingers bent back, splayed (the repulsor hand)
    const back = -0.38 * w - 0.25 * this.recoil;
    this.fingers.forEach(([f1, f2], i) => {
      if (!f1) return;
      const spread = (1.3 - i) * 0.09 * w * (this.side === 'L' ? 1 : -1);
      f1.quaternion.slerp(_q.setFromAxisAngle(this.curlAxis, back).premultiply(_q2.setFromAxisAngle(this.palmOut, spread)), w);
      if (f2) f2.quaternion.slerp(_q.setFromAxisAngle(this.curlAxis, back * 0.4), w);
    });
    // recoil LAST: the whole solved arm kicks UP (muzzle climb) about the shoulder, axis
    // armDir x worldUp taken into the shoulder's parent frame. Doing it before the elbow/wrist
    // solve let them re-aim at the old point and cancel it (the arm dipped instead).
    if (this.recoil > 0) {
      const axisW = _d.copy(dir).cross(_e.set(0, 1, 0));
      if (axisW.lengthSq() > 1e-6) {
        this.sh.parent.getWorldQuaternion(_q).invert();
        axisW.applyQuaternion(_q).normalize();
        this.sh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axisW, 0.30 * w * this.recoil * this.recoil));
      }
    }
    this.root.updateMatrixWorld(true);
  }
}

/** Chest/head turn towards a target (small, clamped) — so the whole body reads as aiming. */
export class LookAt {
  constructor(root) {
    this.chest = root.getObjectByName('piv_chest'); this.neck = root.getObjectByName('piv_neck'); this.head = root.getObjectByName('piv_head');
    this.root = root; this.weight = 0; this.want = 0; this.target = new THREE.Vector3();
  }
  nodes() { return [this.chest, this.neck, this.head].filter(Boolean); }
  update(dt) {
    if (!this.head) return;
    this.weight += (this.want - this.weight) * (1 - Math.exp(-dt * 8));
    if (this.weight < 0.002) return;
    for (const [node, amt] of [[this.chest, 0.35], [this.neck, 0.3], [this.head, 0.55]]) {
      if (!node) continue;
      this.root.updateMatrixWorld(true);
      const p = node.getWorldPosition(V());
      const d = this.target.clone().sub(p).normalize();
      node.parent.getWorldQuaternion(_q).invert();
      const dl = d.applyQuaternion(_q);
      const yaw = Math.atan2(-dl.x, -dl.z), pitch = Math.asin(THREE.MathUtils.clamp(dl.y, -1, 1));
      const lim = 1.0;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.clamp(pitch, -0.6, 0.6) * amt, THREE.MathUtils.clamp(yaw, -lim, lim) * amt, 0, 'YXZ'));
      node.quaternion.slerp(node.quaternion.clone().multiply(q), this.weight);
    }
  }
}
