// Copied into V3 on 2026-09-25 from next/ (ADR-001: copy, never import from next/).
// Veronica deploy sequencer — shared by the `hulkbuster` and `veronica` exhibits.
// Everything plays in DEPLOY SPACE (origin = the drop-zone point where the Hulkbuster lands,
// +Y up, the Hulkbuster ends facing -Z; see blender/hulkbuster/hbdeploy.py):
//   veronica.glb   descend -> bay_open -> deploy_all -> bay_close -> ascend
//   hulkbuster.glb (held packed) -> assemble -> idle
//   inner Iron Man hb_assemble (hulkbuster_core_pilot.glb) -> attached to piv_pilot + hb_pilot
// The three rigs are sought deterministically from one master time, so the sequence is exact
// frame by frame (and screenshot-able); cues are fired from the clips.json events as time passes.
const PILOT_CLIPS = 'assets/anims/hulkbuster_core_pilot.glb';
export const INNER_SUITS = {
  mannequin: 'assets/suits/_mannequin/mannequin.glb',
  mk3: 'assets/suits/mk3/mk3.glb',
  mk42: 'assets/suits/mk42/mk42.glb',
  mk85: 'assets/suits/mk85/mk85.glb',
};

// master timelines: per segment, what each rig plays. [clip, t] = hold clip at time t.
export const SEQUENCES = {
  deploy: [
    { dur: 7.0, vr: 'descend', hb: null, pilot: null },
    { dur: 1.9, vr: 'bay_open', hb: ['assemble', 0], pilot: null },
    { dur: 10.0, vr: 'deploy_all', hb: 'assemble', pilot: 'hb_assemble' },
    { dur: 1.9, vr: 'bay_close', hb: 'idle', pilot: 'hb_pilot' },
    { dur: 5.0, vr: 'ascend', hb: 'idle', pilot: 'hb_pilot' },
  ],
  replace: [
    { dur: 1.2, vr: 'hover', hb: 'idle', pilot: 'hb_pilot' },
    { dur: 2.0, vr: 'hover', hb: 'part_damaged', pilot: 'hb_pilot' },
    { dur: 3.2, vr: 'deploy_part', hb: 'part_replace', pilot: 'hb_pilot' },
    { dur: 1.5, vr: 'hover', hb: 'idle', pilot: 'hb_pilot' },
  ],
};
for (const s of Object.values(SEQUENCES)) { let t = 0; for (const g of s) { g.t0 = t; t += g.dur; } s.duration = t; }

const smooth = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

export class Deploy {
  constructor(ctx, parent) { this.ctx = ctx; this.parent = parent; this.state = new Map(); this.inner = 'mk42'; this.cinematic = true; }

  /** hb: optional {root, player} already in the scene (the hulkbuster exhibit's own). */
  async init(hb) {
    const { ctx, THREE } = { ctx: this.ctx, THREE: this.ctx.THREE };
    this.THREE = THREE;
    const [vr, pc] = await Promise.all([ctx.load('assets/vehicles/veronica/veronica.glb'), ctx.load(PILOT_CLIPS)]);
    this.pilotClips = pc;
    this.vr = { root: vr.scene, player: ctx.player(vr.scene, vr.animations, vr.clipsJson) };
    this.vr.player.external = true;
    ctx.shadows(vr.scene);
    this.parent.add(vr.scene);
    if (!hb) {
      const g = await ctx.load('assets/suits/hulkbuster/hulkbuster.glb');
      ctx.shadows(g.scene); this.parent.add(g.scene);
      hb = { root: g.scene, player: ctx.player(g.scene, g.animations, g.clipsJson) };
      hb.thr = ctx.vfx.rigThrusters(g.scene, { style: 'flame', palms: false, scale: 1.7 });
      g.scene.__autoThrusters = hb.thr;
    }
    this.hb = hb;
    this.socket = hb.root.getObjectByName('piv_pilot');
    this._ground();
    this._veronicaFx();
    await this.setInner(this.inner);
    return this;
  }

  async setInner(key) {
    const ctx = this.ctx;
    this.inner = key;
    if (this.pilot) { this.pilot.root.parent?.remove(this.pilot.root); this.pilot.player.stopAll(); }
    const g = await ctx.load(INNER_SUITS[key]);
    const root = g.scene;
    if (!root.getObjectByName('drv_thrust')) { const d = new this.THREE.Object3D(); d.name = 'drv_thrust'; root.add(d); }
    // the suit's own clips are dropped: only the pilot clips (canonical skeleton) drive it
    const player = ctx.player(root, this.pilotClips.animations, this.pilotClips.clipsJson);
    player.external = true;
    ctx.shadows(root);
    const thr = ctx.vfx.rigThrusters(root, { style: 'repulsor', palms: false, scale: 0.9 });
    root.__autoThrusters = thr;
    this.pilot = { root, player };
    this.parent.add(root);
    root.visible = false;
    this.state.delete('pilot');
    if (this.seq) this.seek(this.seq, this.T ?? 0);
  }

  // a big field for the drop zone (the sky env has no floor)
  _ground() {
    const { THREE } = this;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.fillStyle = '#6f6b5c'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const v = 80 + Math.random() * 70 | 0; g.fillStyle = `rgba(${v},${v - 4},${v - 18},0.35)`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(60, 60);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }));
    m.rotation.x = -Math.PI / 2; m.receiveShadow = true; m.visible = false; m.name = 'deploy_ground';
    this.groundMesh = m;   // V3: never added — the city is the ground
    if (!this.ctx.vfx.handlers?.ground_crack) this.ctx.vfx.on('ground_crack', (node) => {
      const p = node.getWorldPosition(new THREE.Vector3()); p.y = this.parent.position.y + 0.01;
      this.ctx.vfx.scorch(p, new THREE.Vector3(0, 1, 0), 3.2);
      this.ctx.vfx.cue('dust', node, {}); this.ctx.vfx.flashLight(p.clone().setY(0.5), 8, 0.2, 0xffd0a0);
    });
  }

  _veronicaFx() {
    const { ctx, THREE } = this;
    const root = this.vr.root;
    // engine flames on every engine node (drv_thrust)
    this.vrThr = [];
    root.traverse(o => { if (/^vr_engine/.test(o.name)) this.vrThr.push(ctx.vfx.thruster(o, { style: 'flame', scale: /core/.test(o.name) ? 3.2 : 2.2 })); });
    // re-entry heat: tint the hull emissive (drv_heat)
    this.heatMats = [];
    root.traverse(o => {
      if (!o.isMesh || /glow/.test(o.name)) return;
      o.material = o.material.clone(); o.material.emissive = new THREE.Color(1.0, 0.35, 0.08); o.material.emissiveIntensity = 0;
      this.heatMats.push(o.material);
    });
    // V3: no PointLight here — adding a light recompiles every city material (ADR-001); pool flashes only
    const heatNode = root.getObjectByName('vr_body') || root;
    this.vr.player.onDriver = (name, v) => {
      if (name === 'drv_thrust') for (const t of this.vrThr) t.set(v);
      if (name === 'drv_heat') { for (const m of this.heatMats) m.emissiveIntensity = 2.5 * v * v; if (v > 0.3 && Math.random() < 0.2) ctx.vfx.flashLight?.(heatNode.getWorldPosition(new THREE.Vector3()), 60 * v, 0.2, 0xff7a30); }
    };
    ctx.vfx.on('reentry_trail', (node) => {
      if (!this._trail) this._trail = ctx.vfx.trail(node, { width: 3.2, life: 1.6, grow: 2.2, color: 0xffb070, hot: 0xffe0b0, minSpeed: 3, blending: THREE.AdditiveBlending });
    });
    ctx.vfx.on('retro_burn', (node) => { ctx.vfx.cue('flash', node, { size: 6, color: 0xffc080 }); ctx.vfx.flashLight(node.getWorldPosition(new THREE.Vector3()), 120, 0.5, 0xffa060); });
  }

  begin(seq) {
    this.seq = seq; this.T = 0; this.state.clear();
    this.hb.player.external = true;
    this.vr.root.visible = true;

  }

  end() {
    this.seq = null;
    this.hb.player.external = false;
    this.vr.root.visible = false;
    this.pilot.root.visible = false;
    this.hb.root.visible = true;
    if (this._trail) { this._trail.clear(); }
  }

  _drive(key, rig, spec, lt, visible = true) {
    if (!rig) return;
    const st = this.state.get(key) || {};
    if (!spec) { rig.root.visible = false; this.state.set(key, {}); return; }
    rig.root.visible = visible;
    let name = spec, t = lt, hold = false;
    if (Array.isArray(spec)) { name = spec[0]; t = spec[1]; hold = true; }
    const clip = rig.player.clips[name];
    if (!clip) return;
    const loop = rig.player.meta[name]?.loop;
    const d = clip.duration;
    const tt = loop ? (t % d) : Math.min(t, d);
    rig.player.seek(name, tt);
    // cues
    if (!hold && this.playing) {
      const ev = rig.player.meta[name]?.events || [];
      const prev = st.name === name ? st.t : -1;
      const fire = (lo, hi) => { for (const e of ev) if (e.t > lo && e.t <= hi) rig.player._cue(e, name); };
      if (tt >= prev) fire(prev, tt); else { fire(prev, d + 1e-3); fire(-1, tt); }
    }
    this.state.set(key, { name, t: tt });
  }

  seek(seqName, T) {
    const seq = SEQUENCES[seqName];
    this.T = T;
    let seg = seq[seq.length - 1];
    for (const g of seq) if (T < g.t0 + g.dur) { seg = g; break; }
    const lt = Math.min(T - seg.t0, seg.dur);
    // pilot attachment: inside the suit (hb_pilot) = parented to piv_pilot
    const attached = seg.pilot === 'hb_pilot';
    const want = attached ? this.socket : this.parent;
    if (this.pilot.root.parent !== want) { want.add(this.pilot.root); this.pilot.root.position.set(0, 0, 0); this.pilot.root.quaternion.identity(); }
    const vrDone = seqName === 'deploy' && seg === seq[seq.length - 1] && lt >= seg.dur;
    this._drive('vr', this.vr, vrDone ? null : seg.vr, lt);
    this._drive('hb', this.hb, seg.hb, lt);
    this._drive('pilot', this.pilot, seg.pilot, lt, !this.hidePilot);
    if (this.cinematic) this._camera(seqName, T);
  }

  update(dt) {
    if (!this.seq) return false;
    this.playing = true;
    const seq = SEQUENCES[this.seq];
    let T = this.T + dt;
    if (T > seq.duration + 1.0) { T = 0; this.state.clear(); if (this._trail) this._trail.clear(); }
    this.seek(this.seq, Math.min(T, seq.duration));
    this.T = T;
    this.playing = false;
    return true;
  }

  // ---- a simple cinematic camera (off: free orbit)
  _camera(seqName, T) {
    const { THREE } = this; const cam = this.ctx.camera, ctl = this.ctx.controls;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const vrPos = this.vr.root.getObjectByName('vr_root')?.getWorldPosition(V()) || V(0, 25, 7);
    let pos, tgt;
    {
      const keys = seqName === 'replace' ? [
        [0.0, V(6, 3.2, -8.5), V(0, 2.1, 0)],
        [3.05, V(6, 3.2, -8.5), V(0, 2.1, 0)],
        [3.75, V(15, 6, -25), V(-1.5, 15.5, 4)],
        [4.25, V(9.5, 4, -13.5), V(-1, 5.5, 1)],
        [4.9, V(4.2, 3.0, -5.6), V(-0.8, 2.2, 0)],
        [7.9, V(5.2, 3.0, -7.2), V(0, 2.1, 0)],
      ] : [
        [0.0, V(40, 8, -70), vrPos.clone()],
        [6.5, V(24, 10, -34), vrPos.clone()],
        [8.9, V(27, 18, -40), V(0, 19.5, 4)],
        [10.4, V(21, 15, -31), V(0, 15.5, 3)],
        [12.0, V(10.5, 10.8, -14.5), V(0, 9.8, 0.5)],
        [13.8, V(8, 10, -10.5), V(0, 9.3, 0)],
        [15.8, V(8.6, 9.4, -11.5), V(0, 9.2, 0)],
        [17.1, V(9.5, 3.6, -13), V(0, 2.4, 0)],
        [18.9, V(8, 3.2, -10), V(0, 2.2, 0)],
        [21.0, V(9, 3.0, -12), V(0, 3.5, 0)],
        [25.8, V(10, 2.5, -14), V(0, 9, 2)],
      ];
      let i = 0; while (i < keys.length - 2 && T > keys[i + 1][0]) i++;
      const [ta, pa, qa] = keys[i], [tb, pb, qb] = keys[i + 1];
      const u = smooth((T - ta) / (tb - ta));
      pos = pa.clone().lerp(pb, u); tgt = qa.clone().lerp(qb, u);
    }
    cam.position.copy(pos); ctl.target.copy(tgt); ctl.update?.();   // V3: deploy space; the host maps it to world
  }
}
