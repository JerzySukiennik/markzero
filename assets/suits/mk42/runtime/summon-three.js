// summon-three.js — three.js adapter for the Mark 42 summon runtime (summon.js).
//
//   const rig = new SummonRig({ THREE, suit: gltfScene, table: piecesJson, wearer, scene });
//   rig.lockAll();          // suit on
//   rig.eject();            // blow it off   |  rig.shed('pauldronL')
//   rig.scatter();          // lay pieces around (debug)
//   rig.summon();           // fly back from wherever they are
//   in the frame loop, AFTER the wearer's AnimationMixer.update():  rig.update(dt)
//
// The wearer is any Object3D hierarchy with canonical piv_* nodes (Tony's skinned bones,
// Peter, or the suit's own pivots). Nodes the wearer lacks (piv_faceplateL/R, piv_flap_*)
// are created as children of their canonical parent at the suit's rest offset, so the
// suit's mask / flap clips drive them by name. Joint positions that differ between the
// suit and the wearer (piv_reactor sits on Tony's skin but on the armour's surface) are
// corrected per mesh.  Events come out of rig.onEvent(e) (sound / vfx hooks).
import { SummonCore, V3, Q, TUNE } from './summon.js';

export class SummonRig {
  constructor({ THREE, suit, table, wearer, scene, seed = 42, lift = 0.015, jets = true, ground = null }) {
    this.THREE = THREE; this.suit = suit; this.table = table; this.wearer = wearer; this.scene = scene;
    this.lift = lift; this.liftNow = 0; this.onEvent = null;
    const T = THREE;
    this._v = new T.Vector3(); this._q = new T.Quaternion(); this._s = new T.Vector3();
    // ---- joints on the wearer (create missing ones under their canonical parent) ----
    this.joints = {};
    const J = table.joints, PAR = table.parents;
    wearer.updateMatrixWorld(true);
    const rootW = wearer.getObjectByName('piv_root');
    this.wearerRest = {};
    const order = Object.keys(J).sort((a, b) => depth(a) - depth(b));
    function depth(n) { let d = 0; let p = PAR[n]; while (p) { d++; p = PAR[p]; } return d; }
    for (const n of order) {
      let o = wearer.getObjectByName(n);
      if (!o) {
        const p = this.joints[PAR[n]] || wearer.getObjectByName(PAR[n]);
        o = new T.Object3D(); o.name = n;
        const pr = J[PAR[n]], r = J[n];
        o.position.set(r[0] - pr[0], r[1] - pr[1], r[2] - pr[2]);
        o.userData.virtual = true;
        p.add(o);
        o.updateMatrixWorld(true);
      }
      this.joints[n] = o;
    }
    wearer.updateMatrixWorld(true);
    // rest world positions of the wearer (at its bind / rest pose) relative to its root
    for (const n of order) {
      const o = this.joints[n];
      const w = o.getWorldPosition(new T.Vector3());
      const r = rootW ? rootW.getWorldPosition(new T.Vector3()) : new T.Vector3();
      this.wearerRest[n] = w.sub(r);
    }
    // ---- meshes ----
    this.meshes = {};                      // name -> {obj, joint, restPos, restQuat, restScale, piece}
    this.pieceMeshes = {};
    for (const p of table.pieces) {
      this.pieceMeshes[p.name] = [];
      for (const m of p.meshes) {
        const obj = suit.getObjectByName(m.name);
        if (!obj) continue;
        const rec = { obj, joint: m.joint, piece: p.name, lead: p.joint,
          restPos: obj.position.clone(), restQuat: obj.quaternion.clone(), restScale: obj.scale.clone(),
          homeParent: obj.parent, off: null };
        // correction when the wearer's joint rest differs from the suit's (reactor)
        const sr = J[m.joint], wr = this.wearerRest[m.joint];
        rec.fix = wr ? new T.Vector3(sr[0] - wr.x, sr[1] - this.lift - wr.y, sr[2] - wr.z) : new T.Vector3();
        if (rec.fix.length() < 0.002) rec.fix.set(0, 0, 0);
        this.meshes[m.name] = rec;
        this.pieceMeshes[p.name].push(rec);
      }
    }
    // ---- core ----
    this.core = new SummonCore(table, {
      seed,
      ground: ground || (() => 0),
      joint: (name) => this._jointWorld(name),
    });
    // ---- thruster jets (inner side of each shell) ----
    this.jets = {};
    if (jets) {
      const geo = new T.ConeGeometry(0.018, 0.12, 10, 1, true); geo.translate(0, -0.06, 0);
      for (const p of table.pieces) {
        const mat = new T.MeshBasicMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0,
          blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
        const g = new T.Group();
        const n = new T.Vector3(...p.normal);
        const k = Math.min(3, Math.max(1, Math.round(p.radius / 0.08)));
        for (let i = 0; i < k; i++) {
          const c = new T.Mesh(geo, mat);
          const lateral = new T.Vector3(1, 0, 0).cross(n); if (lateral.length() < 0.1) lateral.set(0, 0, 1);
          lateral.normalize().multiplyScalar((i - (k - 1) / 2) * p.radius * 0.6);
          c.position.set(...p.center).add(lateral).addScaledVector(n, -0.01);
          // cone points along local -Y; aim the exhaust INTO the shell side (-n), i.e. push outward... jets fire toward the body side
          c.quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), n.clone().negate());
          g.add(c);
        }
        g.visible = false;
        scene.add(g);
        this.jets[p.name] = { g, mat };
      }
    }
  }

  // ------------------------------------------------------------------------------------
  _jointWorld(name) {
    const o = this.joints[name];
    o.getWorldPosition(this._v); o.getWorldQuaternion(this._q);
    return { p: { x: this._v.x, y: this._v.y, z: this._v.z }, q: { x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w } };
  }

  _toWearer(rec) {
    const j = this.joints[rec.joint];
    j.add(rec.obj);
    rec.obj.position.copy(rec.restPos).add(rec.fix);
    rec.obj.quaternion.copy(rec.restQuat);
    rec.obj.scale.copy(rec.restScale);
  }

  _toScene(rec) {
    rec.obj.updateMatrixWorld(true);
    const m = rec.obj.matrixWorld.clone();
    this.scene.add(rec.obj);
    m.decompose(rec.obj.position, rec.obj.quaternion, rec.obj.scale);
  }

  /** put every mesh back on the SUIT's own pivots (for baked clips) */
  home() {
    for (const rec of Object.values(this.meshes)) {
      rec.homeParent.add(rec.obj);
      rec.obj.position.copy(rec.restPos); rec.obj.quaternion.copy(rec.restQuat); rec.obj.scale.copy(rec.restScale);
      rec.obj.visible = true;
    }
    for (const j of Object.values(this.jets)) j.g.visible = false;
  }

  lockAll() {
    this.core.lockAll();
    for (const rec of Object.values(this.meshes)) this._toWearer(rec);
    this.liftNow = this.lift; this._applyLift();
  }

  _capture(pieceName) {
    // freeze each mesh's offset relative to the piece frame (at release time)
    const T = this.THREE;
    const fr = this.core.frame(pieceName);
    const F = new T.Matrix4().compose(new T.Vector3(fr.p.x, fr.p.y, fr.p.z), new T.Quaternion(fr.q.x, fr.q.y, fr.q.z, fr.q.w), new T.Vector3(1, 1, 1));
    const Fi = F.clone().invert();
    for (const rec of this.pieceMeshes[pieceName]) {
      rec.obj.updateMatrixWorld(true);
      rec.off = Fi.clone().multiply(rec.obj.matrixWorld);
      this._toScene(rec);
    }
  }

  _restOffset(rec) {
    // offset of a mesh relative to its piece's lead frame at REST (flying glove: straight)
    const T = this.THREE, J = this.table.joints;
    const a = J[rec.joint], b = J[rec.lead];
    return new T.Matrix4().compose(new T.Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2]).add(rec.restPos),
      rec.restQuat, rec.restScale);
  }

  eject(opts) {
    for (const p of this.table.pieces) if (this.core.isLocked(p.name)) { this.core.byName[p.name].mode = 'locked'; }
    this.wearer.updateMatrixWorld(true);
    // capture BEFORE the core moves them
    const locked = this.table.pieces.filter((p) => this.core.isLocked(p.name)).map((p) => p.name);
    this.core.eject(opts);
    for (const n of locked) this._capture(n);
    this._drain();
  }

  shed(name, push) {
    if (!this.core.isLocked(name)) return;
    this.wearer.updateMatrixWorld(true);
    this.core.shed(name, push);
    this._capture(name);
    this._drain();
  }

  scatter(opts) {
    for (const p of this.table.pieces) {
      for (const rec of this.pieceMeshes[p.name]) { rec.off = this._restOffset(rec); this._toScene(rec); }
    }
    this.core.scatter(opts);
    this.liftNow = 0; this._applyLift();
    this._place();
  }

  summon(opts) { const n = this.core.summon(opts); this._drain(); return n; }

  hidePieces(names) { this.core.hide(names); for (const n of names) for (const r of this.pieceMeshes[n]) r.obj.visible = false; }

  // ------------------------------------------------------------------------------------
  update(dt) {
    const T = this.THREE;
    // body reactions from the previous step (additive on top of the animation)
    for (const j of this.core.reactionJoints()) {
      const o = this.joints[j]; if (!o) continue;
      const v = this.core.reaction(j);
      const ang = v.length(); if (ang < 1e-5) continue;
      const R = new T.Quaternion().setFromAxisAngle(new T.Vector3(v.x / ang, v.y / ang, v.z / ang), ang);
      const P = o.parent.getWorldQuaternion(new T.Quaternion());
      const Pi = P.clone().invert();
      o.quaternion.premultiply(Pi.multiply(R).multiply(P));
    }
    // boots on -> the wearer stands in the armour's 3 cm soles
    const bootsOn = ['bootL', 'bootR'].every((n) => !this.core.byName[n] || this.core.isLocked(n));
    const want = bootsOn ? this.lift : 0;
    this.liftNow += (want - this.liftNow) * Math.min(1, dt * 18);
    this._applyLift();
    this.wearer.updateMatrixWorld(true);
    this.core.update(dt);
    this._place();
    this._drain();
  }

  _applyLift() {
    const r = this.wearer.getObjectByName('piv_root');
    if (r) { r.userData.baseY ??= r.position.y; r.position.y = r.userData.baseY + this.liftNow; }
  }

  _place() {
    const T = this.THREE;
    const F = new T.Matrix4(), M = new T.Matrix4(), L = new T.Matrix4();
    const p1 = new T.Vector3(), q1 = new T.Quaternion(), s1 = new T.Vector3();
    const p2 = new T.Vector3(), q2 = new T.Quaternion(), s2 = new T.Vector3();
    for (const p of this.table.pieces) {
      const st = this.core.state(p.name);
      const jet = this.jets[p.name];
      if (st === 'locked' || st === 'hidden') {
        for (const rec of this.pieceMeshes[p.name]) {
          if (st === 'locked' && rec.obj.parent !== this.joints[rec.joint]) this._toWearer(rec);
        }
        if (jet) jet.g.visible = false;
        continue;
      }
      const fr = this.core.frame(p.name);
      F.compose(new T.Vector3(fr.p.x, fr.p.y, fr.p.z), new T.Quaternion(fr.q.x, fr.q.y, fr.q.z, fr.q.w), new T.Vector3(1, 1, 1));
      const sub = this.core.sub(p.name);
      for (const rec of this.pieceMeshes[p.name]) {
        if (!rec.off) rec.off = this._restOffset(rec);
        M.multiplyMatrices(F, rec.off);
        if (sub > 0) {
          const j = this.joints[rec.joint];
          L.compose(rec.restPos.clone().add(rec.fix), rec.restQuat, rec.restScale);
          const live = j.matrixWorld.clone().multiply(L);
          M.decompose(p1, q1, s1); live.decompose(p2, q2, s2);
          p1.lerp(p2, sub); q1.slerp(q2, sub);
          rec.obj.position.copy(p1); rec.obj.quaternion.copy(q1); rec.obj.scale.copy(s1);
        } else {
          M.decompose(rec.obj.position, rec.obj.quaternion, rec.obj.scale);
        }
      }
      if (jet) {
        const th = this.core.thrust(p.name);
        jet.g.visible = th > 0.02;
        jet.g.position.set(fr.p.x, fr.p.y, fr.p.z);
        jet.g.quaternion.set(fr.q.x, fr.q.y, fr.q.z, fr.q.w);
        jet.mat.opacity = Math.min(1, th) * (0.55 + 0.25 * Math.random());
        jet.g.scale.setScalar(0.6 + 0.6 * th);
      }
    }
  }

  _drain() {
    for (const e of this.core.drainEvents()) {
      if (e.type === 'lock') {
        for (const rec of this.pieceMeshes[e.piece]) { this._toWearer(rec); rec.off = null; }
      }
      if (this.onEvent) this.onEvent(e);
    }
  }
}

export { SummonCore, V3, Q, TUNE };
