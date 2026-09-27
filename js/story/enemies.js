// Mission enemies (the NEXT enemies pack: brawler, knifer, pistol, rifle, rpg, brute).
//   feet on the nav-grid ONLY (nav.js: spawn snapped to a walkable surface, chase by flow field, never water,
//   never through walls, never off a roof edge) — playtest 4
//   perception: unaware patrol → sees you (26 m, 120° cone, line of sight) / hears Iron Man / hears shots →
//   alert, and raises the alarm for allies within 25 m. Spider-Man can take unaware enemies down silently.
//   fight: melee close in and strike; shooters need line of sight, else they move to a cell that has it (cover
//   play); RPGs lead their target — in 3D, so they shoot at a flying Iron Man.
// Damage IN: every `shot` game event (repulsor / web, local AND remote players) along the aim ray, repulsor
// splash, story moves (thrown crates, returned rockets, takedowns). Damage OUT: hero.health + `hit` event.
import * as THREE from 'three';
import { ClipPlayer } from '../gfx/player.js';
import { Gunfire } from './fx/gunfire.js';

export const KINDS = {
  brawler: { hp: 22, speed: 4.6, reach: 1.9, web: 2, dmg: 0.07, rate: 1.2, ranged: false, idle: 'idle_fists', attack: 'punch_combo', hitAt: [0.26, 0.62, 1.02], weapon: 'knuckles' },
  knifer: { hp: 18, speed: 5.4, reach: 1.8, web: 2, dmg: 0.11, rate: 1.1, ranged: false, idle: 'idle_knife', attack: 'knife_slash', hitAt: [0.42], weapon: 'knife' },
  pistol: { hp: 18, speed: 3.2, reach: 34, web: 2, dmg: 0.045, rate: 1.4, ranged: true, idle: 'idle_pistol', aim: 'pistol_aim', attack: 'pistol_shoot', gun: 'pistol', weapon: 'pistol' },
  rifle: { hp: 24, speed: 2.8, reach: 60, web: 3, dmg: 0.035, rate: 1.9, ranged: true, idle: 'idle_rifle', aim: 'rifle_aim', attack: 'rifle_burst', gun: 'rifle', burst: 4, weapon: 'rifle' },
  rpg: { hp: 22, speed: 2.4, reach: 95, web: 3, dmg: 0.26, rate: 4.6, ranged: true, idle: 'idle_rpg', aim: 'rpg_aim', attack: 'rpg_fire', gun: 'rpg', weapon: 'rpg' },
  brute: { hp: 260, speed: 4.4, reach: 2.9, web: 8, dmg: 0.2, rate: 1.9, ranged: false, idle: 'idle_fists', attack: 'brute_ground_pound', hitAt: [0.86], weapon: null, big: true },
};
const DMG = { repulsor: 8, repulsor_big: 38, web: 3 };
const SEE = 26, CONE = Math.cos(60 * Math.PI / 180), ALARM = 25;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3();

export class Enemies {
  constructor(S) {
    this.S = S; this.MZ = S.MZ; this.world = S.world;
    this.list = [];
    const MZ = this.MZ, col = () => this.world.collide;
    this.gf = new Gunfire(THREE, this.world.scene, { pool: this.world.pool, floorY: -2, onSound: (id, p) => MZ.audio.play(id, { at: p }),
      hit: (p, d, len) => !!col()?.raycast(p, d, len, {}) });
    this._off = MZ.on('game:event', e => this.onEvent(e));
    this.onRocket = null;          // (rocket, shooter, target) → story moves may offer a web catch
  }
  /** spawn on the nav-grid: the point is snapped to the nearest walkable cell (near `pos.y` when given) */
  async spawn(kind, pos, yaw = 0, { nav, variant = 'A', aware = false, leash = 30, nearY = null, perch = false } = {}) {
    const MZ = this.MZ, W = this.world, k = KINDS[kind];
    // perched (a container stack top, too narrow for the grid): exactly there, and he never walks
    const cell = perch ? { x: pos.x, y: pos.y, z: pos.z } : nav?.snap(pos, { r: 14, nearY: nearY ?? pos.y });
    if (nav && !cell) { console.warn('[story] no walkable cell near', kind, pos); return null; }
    const at = cell ? new THREE.Vector3(cell.x, cell.y, cell.z) : pos.clone();
    const [g, lib, wpn] = await Promise.all([
      MZ.assets.load(`assets/characters/enemies/${kind}/${kind}.glb`),
      MZ.assets.load('assets/anims/enemy_core.glb'),
      k.weapon ? MZ.assets.load(`assets/characters/enemies/weapons/${k.weapon}.glb`).catch(() => null) : null,
    ]);
    const body = g.scene; W.litModel?.(body);
    try {
      const vj = await fetch(`/assets/characters/enemies/${kind}/${kind}.variants.json`).then(r => r.json());
      const v = vj.variants?.[variant] || vj.variants?.[vj.default];
      if (v) { for (const n of v.hide || []) { const o = body.getObjectByName(n); if (o) o.visible = false; } for (const n of v.show || []) { const o = body.getObjectByName(n); if (o) o.visible = true; } }
    } catch { }
    if (wpn) { const grip = body.getObjectByName('piv_gripR'); W.litModel?.(wpn.scene); grip?.add(wpn.scene); }
    const holder = new THREE.Group(); holder.name = 'enemy_' + kind; holder.add(body);
    holder.position.copy(at); holder.rotation.y = yaw; W.scene.add(holder);
    const cues = { sfx: { play: (id, o = {}) => MZ.audio.play(id, { ...o, rate: 0.96 + Math.random() * 0.08 }) }, vfx: null };
    const anim = new ClipPlayer(body, lib.animations, lib.clips, cues);
    anim.onCue = e => !!e.vfx;
    anim.play(k.idle, { fade: 0 }); anim.mixer.update(Math.random() * 2);
    const e = { kind, k, holder, body, anim, nav, hp: k.hp, webs: 0, state: aware ? 'fight' : 'patrol', t: 0, cool: 1.2 + Math.random() * 1.5,
      home: at.clone(), leash, muzzle: wpn?.scene.getObjectByName('muzzle') || body.getObjectByName('piv_gripR'), rear: wpn?.scene.getObjectByName('rear'),
      rocket: wpn?.scene.getObjectByName('rocket'), fixed: perch, down: false, id: (this._ids = (this._ids || 0) + 1), look: Math.random() * 6 };
    this.list.push(e);
    return e;
  }
  get alive() { return this.list.filter(e => !e.down).length; }
  players() { return [...(this.MZ.game.players?.values() || [])].filter(p => p.root && !p._storyPark); }
  _pos(p) { return p.m ? p.m.position : p.pos || p.root.position; }
  eye(en) { return _v.copy(en.holder.position).setY(en.holder.position.y + (en.k.big ? 1.9 : 1.55)); }

  // ------------------------------------------------------------------ perception
  alert(en, why = 'seen') {
    if (en.down || en.state === 'fight' || en.state === 'alert') return;
    en.state = 'alert'; en.anim.play('alert', { fade: 0.2, loop: false }); en.busy = 1.0;
    // raise the alarm (a beat later, unless Spider-Man silences him first)
    setTimeout(() => { if (en.down) return; for (const o of this.list) if (o !== en && !o.down && o.holder.position.distanceTo(en.holder.position) < ALARM) this.alert(o, 'alarm'); }, 700);
  }
  canSee(en, p) {
    const pp = this._pos(p), h = en.holder, d = pp.distanceTo(h.position);
    if (d > SEE) return false;
    if (d > 2.0) {                       // closer than 2 m he notices you even behind him
      const f = _d.set(-Math.sin(h.rotation.y), 0, -Math.cos(h.rotation.y)), to = _v2.subVectors(pp, h.position).setY(0).normalize();
      if (f.dot(to) < CONE) return false;
    }
    return !en.nav || en.nav.los(this.eye(en).clone(), { x: pp.x, y: pp.y + 0.4, z: pp.z });
  }

  // ------------------------------------------------------------------ damage in
  onEvent(e) {
    if (!this.list.length) return;
    const shooter = e.from ? this.MZ.game.players.get(e.from) : this.MZ.game.local;
    if (e.kind === 'shot' && e.to) {
      if (!shooter && e.from) return;
      const to = new THREE.Vector3().fromArray(e.to);
      const o = !e.from ? this.world.camera.getWorldPosition(new THREE.Vector3()) : this._pos(shooter).clone().add({ x: 0, y: 0.4, z: 0 });
      _d.subVectors(to, o); const len = _d.length() + 3; _d.divideScalar(len - 3);
      let best = null, bt = Infinity;
      for (const en of this.list) {
        if (en.down) continue;
        const c = en.holder.position.clone(); c.y += en.k.big ? 1.3 : 1.0;
        const rel = c.sub(o), t = rel.dot(_d); if (t < 0 || t > len) continue;
        const perp = rel.addScaledVector(_d, -t).length(), tol = (e.web ? 1.4 : 1.1) + t * 0.012;
        if (perp < tol && t < bt) { bt = t; best = en; }
      }
      // noise: shots wake everyone near the impact / the line
      for (const en of this.list) if (!en.down && en.state === 'patrol' && en.holder.position.distanceTo(to) < (e.web ? 7 : 18)) this.alert(en, 'noise');
      if (best) { if (e.web) this.web(best, shooter); else this.damage(best, e.big ? DMG.repulsor_big : DMG.repulsor, shooter, e.big); }
    }
    if (e.kind === 'hit' && e.what === 'repulsor' && e.big && e.at) {
      const at = new THREE.Vector3().fromArray(e.at);
      for (const en of this.list) if (!en.down && en.holder.position.distanceTo(at) < 3.5) this.damage(en, 18, shooter, true);
    }
  }
  damage(en, amount, from, big = false, clip = null) {
    if (en.down) return;
    en.hp -= amount; if (en.state === 'patrol') this.alert(en, 'hurt');
    const MZ = this.MZ, at = en.holder.position.clone().setY(en.holder.position.y + 1.1);
    this.gf.impact(at, _v2.set(0, 1, 0), 'flesh'); MZ.audio.play('en_hit_body', { at });
    if (en.hp <= 0) return this.kill(en, clip || (big ? 'death_spin' : 'death_back'));
    if (!en.busy || big) { en.anim.play(big ? (en.k.big ? 'stagger' : 'knockdown') : 'hit_front', { fade: 0.08, loop: false }); en.busy = big ? (en.k.big ? 1.4 : 2.2) : 0.55; if (big && !en.k.big) setTimeout(() => { if (!en.down) { en.anim.play('getup', { fade: 0.1, loop: false }); en.busy = 2.2; } }, 1300); }
  }
  web(en, from, amount = 1) {
    if (en.down) return;
    en.webs += amount; en.hp -= DMG.web * amount; if (en.state === 'patrol') this.alert(en, 'hurt');
    this.MZ.audio.play('en_web_creak', { at: en.holder.position });
    if (en.webs >= en.k.web || en.hp <= 0) this.webbed(en);
    else if (!en.busy) { en.anim.play('hit_front', { fade: 0.08, loop: false }); en.busy = 0.6; }
  }
  /** silent takedown / final web: glued to the floor */
  webbed(en, silent = false) {
    if (en.down) return;
    en.down = true; en.state = 'webbed';
    en.anim.play('webbed_floor', { fade: 0.25 });
    try { this.world.webfx?.splat?.({ point: en.holder.position.clone().setY(en.holder.position.y + 0.25), normal: new THREE.Vector3(0, 1, 0), size: 1.4 }); } catch (err) { console.warn('[story] splat', err); }
    this.MZ.emit('story:down', { id: en.id, kind: en.kind, how: silent ? 'takedown' : 'webbed' });
  }
  kill(en, clip) {
    en.down = true; en.state = 'down';
    en.anim.play(clip, { fade: 0.1, loop: false });
    this.MZ.audio.play('en_body_fall', { at: en.holder.position });
    this.MZ.emit('story:down', { id: en.id, kind: en.kind, how: 'down' });
  }
  /** area damage (thrown crate, returned rocket, brute slam finisher) */
  blast(at, r, amount, from) { for (const en of this.list) if (!en.down) { const d = en.holder.position.distanceTo(at); if (d < r) this.damage(en, amount * (1 - d / (r * 1.4)), from, true); } }

  // ------------------------------------------------------------------ damage out
  hurt(p, amount, from) {
    if (!p.local || this.S.phaseName || this.S.missions?.invuln > 0) return;
    p.health = Math.max(0, (p.health ?? 1) - amount);
    this._lastHurt = this.S.T;
    const cam = this.world.camera, d = _v.subVectors(from, cam.position); const yaw = Math.atan2(-d.x, -d.z) - Math.atan2(-cam.getWorldDirection(_v2).x, -_v2.z);
    this.MZ.game.event({ kind: 'hit', dir: THREE.MathUtils.radToDeg(yaw), amount }, false);
    this.MZ.haptics.play(amount > 0.15 ? 'hit_heavy' : 'hit_light');
    this.MZ.game.kick?.({ shake: amount > 0.15 ? 0.45 : 0.12 });
    if (p.health <= 0) this.S.missions?.playerDown(p);
  }

  // ------------------------------------------------------------------ per frame
  update(dt, t) {
    const pls = this.players();
    const L = this.MZ.game.local;
    if (L && this.list.length && this.S.T - (this._lastHurt || -99) > 5) L.health = Math.min(1, (L.health ?? 1) + dt * 0.03);
    for (const en of this.list) {
      en.anim.update(dt);
      if (en.down) continue;
      en.busy = Math.max(0, (en.busy || 0) - dt); en.cool -= dt; en.t += dt;
      let tgt = null, td = Infinity;
      for (const p of pls) { const d = this._pos(p).distanceTo(en.holder.position); if (d < td) { td = d; tgt = p; } }
      if (!tgt) continue;
      const tp = this._pos(tgt), k = en.k, h = en.holder;
      if (en.state === 'patrol') {
        en.look += dt; if (Math.sin(en.look * 0.4) > 0.97 && !en.busy) { en.anim.play('look_around', { fade: 0.3, loop: false }); en.busy = 4; }
        h.rotation.y += Math.sin(en.look * 0.25) * dt * 0.25;
        const loud = tgt.m && tgt.m.speed > 6 && td < 45;          // an Iron Man in flight is not subtle
        if (loud || this.canSee(en, tgt)) this.alert(en, loud ? 'heard' : 'seen');
        continue;
      }
      if (en.busy > 0) { this._face(en, tp, dt, 3); continue; }
      if (en.state === 'alert') en.state = 'fight';
      this._face(en, tp, dt, 6);
      if (k.ranged) {
        const eye = this.eye(en).clone(), tEye = { x: tp.x, y: tp.y + 0.3, z: tp.z };
        let seeIt = false;
        if (td < k.reach) {
          if (!en.nav) seeIt = true;
          else { en._losT = (en._losT ?? 0) - dt; if (en._losT <= 0) { en._losT = 0.4; en._los = en.nav.los(eye, tEye); } seeIt = !!en._los; }
        }
        if (seeIt) {
          en.goal = null;
          if (en.loco !== 'aim') { en.loco = 'aim'; en.anim.play(k.aim, { fade: 0.2 }); }
          if (en.cool <= 0) { en.cool = k.rate * (0.8 + Math.random() * 0.5); this._shoot(en, tgt, tp, td); }
        } else {
          if (!en.goal || (en._goalT = (en._goalT ?? 0) - dt) <= 0) { en._goalT = 2.5; en.goal = en.nav?.coverWithLos(h.position, tEye, 10) || { x: tp.x, z: tp.z }; }
          this._move(en, en.goal, dt, k.speed, 'walk', 0.4);
        }
      } else {
        if (td > k.reach) this._move(en, tp, dt, td > 8 ? k.speed * 1.2 : k.speed * 0.7, td > 8 ? (k.big ? 'brute_charge' : 'run') : 'walk', k.reach * 0.8);
        else if (en.cool <= 0) {
          en.cool = k.rate; en.loco = null; en.anim.play(k.attack, { fade: 0.1, loop: false });
          const dur = en.anim.clips[k.attack]?.duration || 1; en.busy = dur * 0.9;
          for (const at of k.hitAt || [0.4]) setTimeout(() => { if (!en.down && this._pos(tgt).distanceTo(h.position) < k.reach + 0.9) { this.MZ.audio.play(k.big ? 'en_ground_pound' : 'en_punch_hit', { at: h.position }); this.hurt(tgt, k.dmg / (k.hitAt?.length || 1), h.position); if (k.big) this.MZ.game.kick?.({ shake: 0.5 }); } }, at * 1000);
        } else if (en.loco !== 'idle') { en.loco = 'idle'; en.anim.play(k.idle, { fade: 0.2 }); }
      }
    }
    this.gf.update(dt, this.world.camera);
  }
  _face(en, p, dt, rate) {
    const h = en.holder, want = Math.atan2(-(p.x - h.position.x), -(p.z - h.position.z));
    const d = ((want - h.rotation.y + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    h.rotation.y += d * (1 - Math.exp(-rate * dt));
  }
  _move(en, p, dt, speed, clip, stopAt = 0) {
    const h = en.holder;
    let moved = false;
    if (en.fixed) moved = false;
    else if (en.nav) moved = h.position.distanceTo(en.home) < en.leash || _v.set(p.x, h.position.y, p.z).distanceTo(en.home) < h.position.distanceTo(en.home) ? en.nav.step(h.position, p, speed, dt, stopAt) : false;
    if (!moved) { if (en.loco !== 'idle' && en.loco !== 'aim') { en.loco = 'idle'; en.anim.play(en.k.idle, { fade: 0.25 }); } return; }
    if (en.loco !== clip) { en.loco = clip; en.anim.play(clip, { fade: 0.2 }); }
    const a = en.anim.base; if (a) a.timeScale = clip === 'brute_charge' ? 1 : speed / (clip === 'run' ? 5.4 : 1.4);
  }
  _shoot(en, tgt, tp, td) {
    const k = en.k, MZ = this.MZ, gf = this.gf;
    en.anim.play(k.attack, { fade: 0.05, loop: false });
    en.busy = (en.anim.clips[k.attack]?.duration || 0.6) * 0.9; en.loco = null;
    const aim = new THREE.Vector3().copy(tp); aim.y += 0.2;
    if (k.gun === 'rpg') {
      setTimeout(() => {
        if (en.down) return;
        const lead = tgt.m ? tgt.m.velocity : tgt.vel || _v2.set(0, 0, 0);
        const target = aim.clone().addScaledVector(lead, td / 52 * 0.7);
        if (en.rear) gf.backblast(en.rear);
        if (en.rocket) en.rocket.visible = false;
        MZ.audio.play('en_rpg_launch', { at: en.holder.position });
        const R = gf.rocketFire(en.muzzle, { speed: 52, target, range: 130, onExplode: p => {
          if (R.returned) return this.onReturned?.(R, p);
          MZ.game.kick?.({ shake: 0.35 }); MZ.audio.play('en_explosion', { at: p });
          const d = this._pos(tgt).distanceTo(p); if (d < 5) this.hurt(tgt, k.dmg * (1 - d / 6), p);
        } });
        R.shooter = en; R.victim = tgt;
        this.onRocket?.(R, en, tgt);
        setTimeout(() => { if (en.rocket) en.rocket.visible = true; }, 2600);
      }, 120);
      return;
    }
    const n = k.burst || 1, far = td > 30;
    for (let i = 0; i < n; i++) setTimeout(() => {
      if (en.down) return;
      gf.muzzle(en.muzzle, k.gun);
      MZ.audio.play(`en_${k.gun}_shot${far ? '_far' : ''}`, { at: en.holder.position, rate: 0.96 + Math.random() * 0.08 });
      const from = en.muzzle.getWorldPosition(new THREE.Vector3());
      const speed = tgt.m ? tgt.m.speed : tgt.vel?.length() || 0;
      const p = THREE.MathUtils.clamp(0.62 - td / 150 - speed / 80, 0.1, 0.62);
      const hit = Math.random() < p;
      const miss = hit ? new THREE.Vector3() : new THREE.Vector3().randomDirection().multiplyScalar(1.2 + Math.random() * 2);
      const dir = aim.clone().add(miss).sub(from).normalize();
      gf.tracer(from, dir, { speed: 300, range: td + 20 });
      if (hit) this.hurt(tgt, k.dmg, from);
      else if (tgt.local && Math.random() < 0.4) MZ.audio.play('en_bullet_flyby', { at: aim });
    }, i * 100 + 20);
  }
  clearWave() { for (const e of this.list) { e.holder.removeFromParent(); e.anim.stopAll(); } this.list = []; }
  dispose() { this._off?.(); this.clearWave(); this.gf.clear(); }
}
