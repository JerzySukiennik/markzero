// Missions — arc "Zero Hour" v2 (playtest 4: "far too easy"). docs/story/DESIGN.md §4.
// One main mission at a time: beacon + distance badge + map marker → start ring → waves of enemies on a
// nav-grid (no water, no walls, no roof edges) with real-scale container stacks as cover and high ground →
// fail state (hero health 0, or the clock in Rooftop Relay) → "Mission failed" → retry from the last wave's
// checkpoint. Hero variants: Spider-Man starts unseen (stealth takedowns, web yanks, rocket catches — moves.js),
// Iron Man arrives loud (everyone alert, extra RPGs that lead a flying target).
// Co-op: each client runs the mission; `story` messages start/finish it everywhere; kills come from both
// players' shot events.
import * as THREE from 'three';
import { Enemies } from './enemies.js';
import { NavGrid } from './nav.js';
import { PropSet } from './props.js';
import { SpiderMoves } from './moves.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const ARC = [
  {
    id: 'm1_dockside', title: 'Dockside', kicker: 'Zero Hour · 1 / 3', start: V(-873, 0.6, 330), radius: 50,
    brief: { spiderman: "A crew is stripping a Stark container at Pier 5. They haven't seen you yet.", ironman: 'A crew is stripping a Stark container at Pier 5. They heard you coming.' },
    objective: 'Take down the crew', done: 'Empty. They already moved the cores.',
    area: { cx: -860, cz: 330, half: 86 },
    props: [
      { kind: 'stack', x: -905, z: 322, levels: 2 }, { kind: 'stack', x: -889, z: 339, levels: 3, label: 'STARK INDUSTRIES', colors: ['stark', 'grey', 'blue'] },
      { kind: 'stack', x: -866, z: 327, levels: 1, rot: 0.08 }, { kind: 'stack', x: -846, z: 318, levels: 2, rot: Math.PI / 2 },
      { kind: 'stack', x: -830, z: 341, levels: 2 }, { kind: 'stack', x: -922, z: 341, levels: 1 }, { kind: 'stack', x: -812, z: 326, levels: 3 },
      { kind: 'crate', x: -874, z: 319 }, { kind: 'crate', x: -857, z: 337 }, { kind: 'crate', x: -898, z: 330 }, { kind: 'crate', x: -836, z: 331 },
    ],
    waves: [
      { crew: [['brawler', -880, 322], ['brawler', -872, 334], ['brawler', -858, 324], ['pistol', -900, 331], ['pistol', -846, 330], ['knifer', -878, 329], ['rifle', -889, 339, { top: true }]],
        ironman: [['rpg', -812, 326, { top: true }], ['rifle', -905, 322, { top: true }]] },
      { at: 2, msg: 'Reinforcements from the street end.', aware: true,
        crew: [['rifle', -830, 341, { top: true }], ['rpg', -846, 318, { top: true }], ['brawler', -790, 322], ['brawler', -792, 338], ['knifer', -796, 330], ['pistol', -800, 316]],
        ironman: [['rpg', -922, 341, { top: true }]] },
    ],
  },
  {
    id: 'm2_relay', title: 'Rooftop Relay', kicker: 'Zero Hour · 2 / 3', start: V(-690, 0, 300), radius: 55, roofStart: true, timer: 210,
    brief: { spiderman: 'The cores hop roof to roof. Clear three nests before the van leaves.', ironman: 'Three rooftop nests, one van. Clear them before it leaves.' },
    objective: 'Clear the nests', done: 'Last case went to the old warehouse on the pier.', timeoutMsg: 'The van got away.',
    props: [{ kind: 'crate', x: -655, z: 304, probe: 60 }, { kind: 'crate', x: -671, z: 225, probe: 70 }, { kind: 'crate', x: -640, z: 117, probe: 70 }],
    waves: [
      { area: { cx: -660, cz: 300, half: 24, probe: 60 }, nest: [-660, 300], msg: 'Nest 1.',
        crew: [['rifle', -662, 302], ['rpg', -656, 297], ['pistol', -665, 296], ['brawler', -658, 305]], ironman: [['rpg', -664, 305]] },
      { area: { cx: -675, cz: 220, half: 24, probe: 70 }, nest: [-675, 220], msg: 'Nest 2.',
        crew: [['rifle', -677, 222], ['rpg', -672, 217], ['pistol', -679, 216], ['knifer', -670, 224], ['brawler', -674, 226]], ironman: [['rpg', -680, 224]] },
      { area: { cx: -645, cz: 120, half: 26, probe: 70 }, nest: [-645, 120], msg: 'Last nest.',
        crew: [['rifle', -648, 122], ['rifle', -640, 116], ['rpg', -644, 126], ['pistol', -652, 116], ['brawler', -638, 124], ['knifer', -646, 112]], ironman: [['rpg', -636, 118]] },
    ],
  },
  {
    id: 'm3_heavy', title: 'Heavy Lift', kicker: 'Zero Hour · 3 / 3', start: V(-890, 0, 139), radius: 55, roofStart: true,
    brief: { spiderman: 'The last case is on the warehouse roof. And somebody brought a brute.', ironman: 'Warehouse roof, last case, one brute and his RPG crew.' },
    objective: 'Stop the crew', done: 'Cores back with Stark. Nice work.', coopTip: 'Spider-Man: web onto Iron Man and ride him in.',
    area: { cx: -890, cz: 139, half: 60, probe: 40 },
    props: [
      { kind: 'stack', x: -905, z: 128, levels: 2, probe: 40 }, { kind: 'stack', x: -878, z: 151, levels: 1, probe: 40 }, { kind: 'stack', x: -935, z: 149, levels: 2, probe: 40 },
      { kind: 'stack', x: -852, z: 129, levels: 2, rot: Math.PI / 2, probe: 40 }, { kind: 'stack', x: -960, z: 131, levels: 1, probe: 40 },
      { kind: 'heavy', x: -893, z: 141, probe: 40 }, { kind: 'heavy', x: -866, z: 139, probe: 40 },
      { kind: 'crate', x: -915, z: 139, probe: 40 }, { kind: 'crate', x: -884, z: 132, probe: 40 }, { kind: 'crate', x: -872, z: 146, probe: 40 },
    ],
    waves: [
      { crew: [['brawler', -896, 134], ['brawler', -880, 145], ['knifer', -899, 146], ['knifer', -870, 131], ['pistol', -920, 133], ['pistol', -862, 150], ['rifle', -905, 128, { top: true }]],
        ironman: [['rpg', -935, 149, { top: true }]] },
      { at: 1, msg: 'Here comes the brute.', aware: true, finale: true,
        crew: [['brute', -890, 139], ['rpg', -935, 149, { top: true }], ['rpg', -852, 129, { top: true }], ['rpg', -960, 131, { top: true }], ['rifle', -878, 151, { top: true }], ['rifle', -905, 128, { top: true }]] },
    ],
  },
];

/** where a crew entry should stand: on a container stack top (perched, never walks), on its nest's roof,
 * on the mission roof, or on the mission's ground level — shared with tests/story/test_nav.mjs */
export function spawnHint(m, w, x, z, o, tops, col) {
  const top = o.top ? tops.get(x + ',' + z) : null;
  if (top != null) return { hint: top, perch: true };
  if (w.nest) return { hint: col?.groundAt(w.nest[0], w.nest[1], w.area?.probe ?? 300) ?? 0, perch: false };
  return { hint: m.roofStart ? m.start.y : (m.start.y ?? 0), perch: false };
}

// ---------------------------------------------------------------- beacon (3D)
function beaconMesh(color = 0xffc85a) {
  const g = new THREE.Group(); g.name = 'story_beacon';
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(color) }, uA: { value: 1 } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vU; uniform float uT; uniform vec3 uC; uniform float uA;
      void main(){ float fade = pow(1.0 - vU.y, 1.6) * smoothstep(0.0, 0.02, vU.y);
        float bands = 0.75 + 0.25 * sin(vU.y * 90.0 - uT * 3.0);
        gl_FragColor = vec4(uC * 1.6, fade * bands * 0.55 * uA); }`,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 420, 20, 1, true).translate(0, 210, 0), mat);
  beam.frustumCulled = false; g.add(beam);
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2), ringMat); g.add(ring);
  return { g, update(dt, t, r, near) { mat.uniforms.uT.value = t; mat.uniforms.uA.value = near; const k = (t * 0.5) % 1; ring.scale.setScalar(r * (0.6 + 0.4 * k)); ringMat.opacity = 0.6 * (1 - k) * near; }, dispose() { g.removeFromParent(); } };
}
const fmt = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

export class Missions {
  constructor(S) {
    this.S = S; this.MZ = S.MZ; this.activeId = null; this.cur = null; this.beacon = null; this.objs = [];
    this.invuln = 0;
    this.MZ.net.onMsg?.('story', m => this.onNet(m));
    this._offDown = this.MZ.on('story:down', () => this.onDown());
  }
  get save() { return this.S.save.missions; }
  get hero() { return this.S.session?.heroId; }
  next() { return ARC.find(m => this.save[m.id] !== 'done') || null; }
  begin() {
    const want = this.MZ.params.get('mission');
    if (want) { for (const m of ARC) { if (m.id === want || m.id.startsWith(want)) break; this.save[m.id] = 'done'; } }
    this.offer(this.next());
  }
  col() { return this.S.world.collide || this.S.hero.col; }
  // ---------------------------------------------------------------- available
  offer(m) {
    this.clear();
    if (!m) return;
    this.cur = m; this.state = 'available';
    if (m.roofStart) m.start.y = this.col()?.groundAt(m.start.x, m.start.z, 1000) ?? m.start.y;
    this.beacon = beaconMesh(); this.beacon.g.position.copy(m.start); this.S.world.scene.add(this.beacon.g);
    this.mk = this.S.ui.marker({ at: m.start.clone().setY(m.start.y + 6), name: m.title, icon: '!', fadeNear: 30 });
    this.MZ.emit('story:mission', { id: m.id, state: 'available', title: m.title });
  }
  clear() {
    this.beacon?.dispose(); this.beacon = null; this.mk?.remove(); this.mk = null;
    this.nestMk?.remove(); this.nestMk = null;
    for (const o of this.objs) o.remove(); this.objs = [];
    this.S.ui?.objectives([]);
  }
  // ---------------------------------------------------------------- active
  async start(fromNet = false) {
    const m = this.cur, S = this.S; if (!m || this.state !== 'available') return;
    this.state = 'loading'; this.activeId = m.id;
    if (!fromNet) this.MZ.net.send?.('story', { op: 'start', id: m.id });
    this.beacon?.dispose(); this.beacon = null; this.mk?.remove(); this.mk = null;
    const brief = typeof m.brief === 'string' ? m.brief : m.brief[this.hero] || m.brief.ironman;
    S.ui.card(m.title, brief, m.kicker, 4.5);
    this.MZ.audio.ui?.('ui_stinger_' + (this.hero === 'spiderman' ? 'spider' : 'ironman'));
    this.MZ.emit('story:mission', { id: m.id, state: 'active', title: m.title });
    try {
      this.props = new PropSet(S.world);
      for (const p of m.props || []) this.props.add(p);
      this.props.register();
      this.navs = new Map();
      this.enemies = new Enemies(S);
      if (this.hero === 'spiderman') { this.moves = new SpiderMoves(S, this); await this.moves.init(); }
      this.wave = 0; this.downs = 0;
      this.total = m.waves.reduce((a, w) => a + w.crew.length + ((this.hero === 'ironman' && w.ironman) ? w.ironman.length : 0), 0);
      this.clock = m.timer || 0;
      await this.spawnWave(0);
      this.state = 'active';
      this.refreshObjs();
      if (m.coopTip && (this.MZ.net.room?.players.length || 1) > 1) S.beat(m.coopTip, 4);
    } catch (e) {
      console.error('[story] mission start failed', m.id, e);
      this.state = 'active'; this.refreshObjs();
    }
  }
  nav(area) {
    const key = `${area.cx},${area.cz},${area.half}`;
    if (!this.navs.has(key)) this.navs.set(key, new NavGrid(this.col(), { cx: area.cx, cz: area.cz, half: area.half, probe: area.probe ?? 300 }).build());
    return this.navs.get(key);
  }
  async spawnWave(i) {
    const m = this.cur, w = m.waves[i]; if (!w) return;
    this.wave = i; this.checkpoint = i;
    const nav = this.nav(w.area || m.area);
    const crew = [...w.crew, ...((this.hero === 'ironman' && w.ironman) ? w.ironman : [])];
    const aware = w.aware || this.hero === 'ironman';
    const tops = new Map((this.props?.items || []).filter(p => p.kind === 'stack').map(p => [p.x + ',' + p.z, p.top]));
    await Promise.all(crew.map(([kind, x, z, o = {}], j) => {
      const { hint, perch } = spawnHint(m, w, x, z, o, tops, this.col());
      return this.enemies.spawn(kind, V(x, hint, z), (j * 1.7) % 6.28, { nav, variant: j % 2 ? 'B' : 'A', aware, nearY: hint, perch, leash: 30 })
        .catch(e => console.error('[story] spawn failed', kind, e));
    }));
    if (w.nest) { this.nestMk?.remove(); const [x, z] = w.nest; const y = this.col()?.groundAt(x, z, w.area?.probe ?? 300) ?? 30; this.nestMk = this.S.ui.marker({ at: V(x, y + 5, z), name: w.msg || 'Nest', icon: String(i + 1), fadeNear: 20 }); }
    if (i > 0 && w.msg) this.S.beat(w.msg, 2.6);
    if (w.finale) this.MZ.game.kick?.({ shake: 0.4 });
  }
  refreshObjs() {
    const m = this.cur; if (!m || !this.enemies) return;
    const alive = this.enemies.alive;
    let txt = m.waves.length > 1 && !m.waves[0].nest ? `${m.objective} · wave ${this.wave + 1}/${m.waves.length}` : m.waves[0].nest ? `${m.objective} ${this.wave}/${m.waves.length}` : m.objective;
    // the objective text + distance in the corner belong ONLY to the UI's mission HUD (Jurek: "two Docksides"):
    // story hands it the line through markers() / story:mission; here only the in-world diamonds remain
    this.objLine = txt + (alive ? ` · ${alive} left` : '') + (m.timer ? ` · ${fmt(this.clock)}` : '');
    const info = { id: m.id, state: 'progress', title: m.title, objective: this.objLine, wave: this.wave + 1, waves: m.waves.length, left: alive, time: m.timer ? Math.max(0, Math.ceil(this.clock)) : null };
    const key = JSON.stringify(info); if (key !== this._lastInfo) { this._lastInfo = key; this.MZ.emit('story:mission', info); }
    for (const o of this.objs) o.remove(); this.objs = [];
    for (const e of this.enemies.list) if (!e.down) { const mk = this.S.ui.marker({ at: () => e.holder.position.clone().setY(e.holder.position.y + (e.k.big ? 2.8 : 2.3)), kind: 'obj', name: e.kind === 'rpg' ? 'RPG' : e.kind === 'brute' ? 'Brute' : '', fadeNear: 4 }); mk.dist.style.display = 'none'; this.objs.push(mk); }
  }
  async onDown() {
    if (this.state !== 'active') return;
    const m = this.cur, alive = this.enemies.alive, nextW = m.waves[this.wave + 1];
    if (nextW && alive <= (nextW.at ?? 0)) { this.state = 'spawning'; await this.spawnWave(this.wave + 1); this.state = 'active'; }
    this.refreshObjs();
    if (this.enemies.alive === 0 && this.wave >= m.waves.length - 1) this.complete();
  }
  /** hero health hit 0, or the clock ran out → Mission failed → retry from the wave checkpoint */
  async fail(reason) {
    if (this.state !== 'active') return;
    const S = this.S, m = this.cur;
    this.state = 'failed';
    S.ui.card('Mission failed', reason, m.title, 3);
    this.MZ.haptics.play('ui_error'); this.MZ.audio.ui?.('ui_error');
    S.time.to(0.3, 0.3);
    await S.wait(1.6);
    S.time.to(1, 0.5);
    // back to the checkpoint: the checkpoint wave and everything after it spawn again
    this.enemies.clearWave();
    this.moves?.reset();
    const hero = S.hero, cp = this.checkpointPos(), look = m.start;
    import('./control.js').then(c => c.teleport(hero, cp, Math.atan2(-(look.x - cp.x), -(look.z - cp.z))));
    hero.health = 1; this.invuln = 3;
    if (m.timer) this.clock = Math.max(90, m.timer - this.checkpoint * 50);
    this.state = 'spawning';
    await this.spawnWave(this.checkpoint);
    // on a retry the earlier waves stay done: count them as downs
    this.state = 'active'; this.refreshObjs();
    S.beat(this.hero === 'ironman' ? 'Rebooting. Again.' : 'Okay. Again. Smarter.', 2.5);
  }
  checkpointPos() {
    const m = this.cur, w = m.waves[this.checkpoint], c = w.nest ? V(w.nest[0], 0, w.nest[1]) : m.start.clone();
    const g = this.col()?.groundAt(c.x, c.z + 40, 1000) ?? 0;
    return V(c.x, Math.max(g, c.y ?? 0) + (this.hero === 'ironman' ? 35 : 22), c.z + 40);
  }
  playerDown() { this.fail(this.hero === 'ironman' ? 'Suit integrity critical.' : 'Spider-Man is down.'); }
  async complete(fromNet = false) {
    const m = this.cur, S = this.S; if (this.state !== 'active' && !fromNet) return;
    if (this.state === 'done') return;
    this.state = 'done'; this.activeId = null;
    if (!fromNet) this.MZ.net.send?.('story', { op: 'done', id: m.id });
    this.save[m.id] = 'done'; S.persist();
    this.nestMk?.remove(); this.nestMk = null;
    for (const o of this.objs) o.remove(); this.objs = [];
    S.ui.card(m.title, m.done, 'Mission complete', 4.5);
    this.MZ.audio.ui?.('ui_ready'); this.MZ.haptics.play('ui_ready');
    this.MZ.emit('story:mission', { id: m.id, state: 'done', title: m.title });
    await S.wait(6);
    this.teardown();
    S.ui.objectives([]);
    const nx = this.next();
    if (nx) { this.offer(nx); S.beat(`New lead: ${nx.title}.`, 3); }
    else S.ui.card('Zero Hour', 'Arc complete — more soon.', 'The end (for now)', 5);
  }
  teardown() { this.moves?.dispose(); this.moves = null; this.enemies?.dispose(); this.enemies = null; this.props?.dispose(); this.props = null; this.navs?.clear(); }
  onNet(m) {
    if (!this.cur || m.id !== this.cur.id) return;
    if (m.op === 'start') this.start(true);
    if (m.op === 'done') this.complete(true);
  }
  // ---------------------------------------------------------------- frame
  update(dt, t) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.enemies?.update(dt, t);
    this.moves?.update(dt, t);
    const m = this.cur; if (!m) return;
    const hp = this.S.hero && (this.S.hero.m ? this.S.hero.m.position : this.S.hero.pos);
    if (this.beacon && hp) {
      const d = Math.hypot(hp.x - m.start.x, hp.z - m.start.z);
      this.beacon.update(dt, t, m.radius, THREE.MathUtils.clamp((d - 20) / 60, 0.15, 1));
      if (this.state === 'available' && !this.S.phaseName && d < m.radius && Math.abs(hp.y - m.start.y) < 90) this.start();
    }
    if (this.state === 'active' && m.timer) {
      const before = Math.ceil(this.clock);
      this.clock -= dt;
      if (Math.ceil(this.clock) !== before) this.refreshObjs();
      if (this.clock <= 10 && Math.ceil(this.clock) !== before) this.MZ.audio.ui?.('ui_tick');
      if (this.clock <= 0) this.fail(m.timeoutMsg || 'Out of time.');
    }
  }
  mapMarkers() {
    const out = (this.S.world?.pois || []).filter(p => p.kind === 'base').map(p => ({ id: p.id, kind: 'base', title: p.name, x: p.x, y: p.y, z: p.z, hero: p.hero }));
    const m = this.cur;
    if (m && this.state === 'available') out.push({ id: m.id, kind: 'main', title: m.title, x: m.start.x, y: m.start.y, z: m.start.z });
    if (m && this.state !== 'available' && this.state !== 'done') {
      const w = m.waves[this.wave];
      // every objective marker carries the objective line (the UI HUD shows `title · distance` of the nearest)
      const extra = { missionTitle: m.title, objective: this.objLine, wave: this.wave + 1, waves: m.waves.length, left: this.enemies?.alive ?? 0, time: m.timer ? Math.max(0, Math.ceil(this.clock)) : null };
      if (w?.nest) out.push({ id: m.id + '_nest', kind: 'objective', title: this.objLine || w.msg || 'Nest', x: w.nest[0], y: 0, z: w.nest[1], ...extra });
      else for (const e of this.enemies?.list || []) if (!e.down) out.push({ id: 'enemy' + e.id, kind: 'objective', title: this.objLine || m.objective, enemy: e.kind, x: e.holder.position.x, y: e.holder.position.y, z: e.holder.position.z, ...extra });
    }
    return out;
  }
  dispose() { this.clear(); this.teardown(); this._offDown?.(); }
}
