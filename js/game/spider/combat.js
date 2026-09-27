// SPIDER-MAN COMBAT (Jurek: "Spider-Man is mega weak next to Iron Man") — on the controller's own actions:
//   strike □   a 4-hit chain (jab · cross · hook · kick) on the foe in the stick (else camera) direction; a foe up
//              to LUNGE m away is closed on first (a dash; > 4.5 m with a web line — the web-zip strike). Works in
//              the air (he hangs in the air while he hits). Every hit: hitstop, shake, haptics.
//   dodge ○    stick direction (none = away from the threat / back), backflip, i-frames; a dodge right as a hit
//              was coming (spider-sense) = PERFECT: slow motion. In the air with no foe near: an air trick.
//   hold □     LAUNCHER: kept held past LAUNCH_HOLD next to a foe = a rising uppercut (knockdown) that carries him
//              up for an air follow-up.
//   L1+R1      WEB BOMB (gadget): a glob to the aimed foe / point, bursts and webs everyone within BOMB_R (cooldown).
//   focus      hits and perfect dodges fill it; full → the next strike is a FINISHER (slow-mo spin kick, KO).
//   legs →     Iron Spider's four nano legs out / in (spider/legs.js); out, strikes add leg stabs and the big hit a
//              four-leg flurry (everything within LEG_R).
//   sense      spider-sense: a melee swing, an aimed gun or a rocket about to hit him → `sense` 0..1 (HUD prompt).
//   web shots  (spider.js) aim-assisted onto a foe near the aim ray.
// Foes: the story's mission enemies (MZ.story.missions.enemies — list / damage / web), read duck-typed; nothing
// here is needed for traversal and it all no-ops without enemies. docs/game/spider/REQUESTS.md asks the story
// for a formal hero API (melee hit event, i-frame check in hurt()).
import * as THREE from 'three';

const BUF = 0.16, PIN_HOLD = 0.3, PIN_R = 6;
const LUNGE = 12, ZIPLUNGE = 4.5, REACH = 2.3, LEG_R = 3.4, DODGE_CD = 0.3, IFRAMES = 0.45;
const LAUNCH_HOLD = 0.28, BOMB_R = 5, BOMB_CD = 8, FOCUS_HIT = 0.07, FOCUS_PERFECT = 0.15;
// the chain: segments of punch_combo (hits 0.08 / 0.34 / 0.72) and the kick (hit 0.32); played at SPEED
const SPEED = 1.3;
const SEGS = [
  { clip: 'punch_combo', from: 0.0, hit: 0.08, end: 0.24, dmg: 5 },
  { clip: 'punch_combo', from: 0.24, hit: 0.34, end: 0.56, dmg: 5 },
  { clip: 'punch_combo', from: 0.56, hit: 0.72, end: 0.92, dmg: 7 },
  { clip: 'kick', from: 0.14, hit: 0.32, end: 0.6, dmg: 11, big: true },
];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

export class SpiderCombat {
  constructor(hero) {
    this.h = hero; this.atk = null; this.combo = 0; this.comboT = 0; this.dodgeCD = 0; this.iframes = 0;
    this.flurry = null; this.sense = 0; this.senseEn = null; this.faceYaw = null; this.stats = { hits: 0, perfect: 0, legs: 0, launch: 0, bombs: 0, finishers: 0 };
    this.focus = 0; this.focusIdle = 0; this.bombCD = 0; this.bombs = []; this.holdT = 0; this.buf = { strike: 0, dodge: 0, legs: 0 };
  }
  /** every frame, even in hitstop (dt = 0): a press is never lost — it waits BUF s for the body to be free */
  buffer(a) { for (const k of ['strike', 'dodge', 'legs']) if (a.pressed(k)) this.buf[k] = BUF; }
  get E() { return this.h.MZ.story?.missions?.enemies || this.h.world.labEnemies || null; }
  foes() { const E = this.E; return E?.list ? E.list.filter(en => !en.down && en.holder) : []; }
  chest(en, out = new THREE.Vector3()) { return out.copy(en.holder.position).setY(en.holder.position.y + (en.k?.big ? 1.4 : 1.05)); }
  /** best foe for a strike: in the stick direction (camera-relative), else the camera's; close ones win */
  pick(range = LUNGE) {
    const h = this.h, p = h.pos, dir = _v3;
    if ((h.mag || 0) > 0.3) dir.copy(h.wish).setY(0).normalize(); else dir.set(-Math.sin(h.camYaw), 0, -Math.cos(h.camYaw));
    let best = null, bs = Infinity;
    for (const en of this.foes()) {
      const d = _v.subVectors(en.holder.position, p), dy = d.y; d.y = 0; const L = d.length();
      if (L > range || Math.abs(dy) > 6) continue;
      const cos = L > 0.01 ? d.dot(dir) / L : 1;
      if (L > 3 && cos < 0.35) continue;                               // far ones only where he is pointing
      const s = L * (1.6 - cos) + Math.abs(dy) * 0.5;
      if (s < bs) { bs = s; best = en; }
    }
    return best;
  }
  hit(en, dmg, big) {
    const E = this.E; if (!E || en.down) return;
    E.damage(en, dmg, this.h, big);
    const h = this.h;
    h.kick({ hitstop: big ? 75 : 45, shake: big ? 0.28 : 0.1, fov: big ? -2 : 0 });
    h.haptic(big ? 'hit_heavy' : 'hit_light', big ? 1 : 0.7);
    h.cam?.punch?.(0, 0, big ? -0.18 : -0.08);
    h.event({ kind: 'melee', to: en.id, dmg, big }, false);
    this.stats.hits++; this.gainFocus(FOCUS_HIT);
  }
  gainFocus(k) { this.focus = Math.min(1, this.focus + k); this.focusIdle = 0; }
  /** ---- per frame, before the physics. a = input actions. Returns true while an attack owns the body. */
  update(dt, a) {
    const h = this.h;
    this.dodgeCD = Math.max(0, this.dodgeCD - dt); this.iframes = Math.max(0, this.iframes - dt);
    this.comboT = Math.max(0, this.comboT - dt); this.bombCD = Math.max(0, this.bombCD - dt);
    this.focusIdle += dt; if (this.focusIdle > 6) this.focus = Math.max(0, this.focus - dt * 0.03);
    this.serviceBombs(dt);
    if (this.comboT <= 0 && !this.atk) this.combo = 0;
    this.senseUpdate(dt);
    this.fightUpdate(dt);
    if (this.hold && (this.hold.t -= dt) <= 0) this.hold = null;
    const B = this.buf; for (const k in B) B[k] = Math.max(0, B[k] - dt);
    // D-pad →: legs in = out at once; out = a TAP stows them, a HOLD (≥ PIN_HOLD) pins the nearest foe
    if (B.legs > 0) { B.legs = 0; if (h.legs?.out) this.legsPress = 1e-4; else h.legs?.toggle(); }
    if (this.legsPress) {
      if (a.down('legs')) { this.legsPress += dt; if (this.legsPress >= PIN_HOLD) { this.legsPress = 0; this.legsPin(); } }
      else { this.legsPress = 0; h.legs?.toggle(); }
    }
    if (h.stuck || h.zip || h.parked) { this.cancel(); return false; }
    if (B.strike > 0) { B.strike = 0; this.strike(); this.holdT = 0; }
    if (a.down('strike')) { this.holdT += dt; if (this.holdT >= LAUNCH_HOLD && !this._launched) { this._launched = true; this.launcher(); } }
    else { this.holdT = 0; this._launched = false; }
    if (B.dodge > 0 && this.dodge()) B.dodge = 0;
    this.serviceLegs(dt);
    return this.serviceAttack(dt);
  }
  cancel() { if (this.atk) { this.h.anim.cancelShot(this.atk.clip, 0.15); this.atk = null; } this.faceYaw = null; }

  // ---- strike chain
  strike() {
    const h = this.h;
    if (this.atk) { if (this.atk.phase === 'special') return; if (this.atk.phase === 'lunge' || this.atk.t > this.atk.from + 0.06) this.atk.queued = true; return; }
    if (h.rope) h.releaseRope(false, true);
    const en = this.pick();
    if (en && this.focus >= 1) return this.finisher(en);
    const seg = this.comboT > 0 ? this.combo % SEGS.length : 0;
    if (en) {
      const d = _v.subVectors(en.holder.position, h.pos); d.y = 0; const L = d.length();
      if (L > REACH) return this.lunge(en, seg, L);
    }
    this.swing(seg, en);
  }
  lunge(en, seg, L) {
    const h = this.h, dur = THREE.MathUtils.clamp(L / 24, 0.1, 0.45);
    this.atk = { phase: 'lunge', en, seg, t: 0, dur, queued: false };
    if (L > ZIPLUNGE) {                     // the web-zip strike: a line to the foe, pulled in
      const to = this.chest(en);
      this.zipFx?.fx?.release(); this.zipFx = { t: dur + 0.05, fx: h.world.webfx?.zip({ fromL: h.web.L, fromR: h.web.R, to }) };
      h.sfx('sp_zip_whoosh', { at: h.root }); h.haptic('web_zip');
      h.anim.layer(h.hand === 'R' ? 'web_shoot_R' : 'web_shoot_L', 1, { restart: true, rate: 30 });
    } else h.sfx('sp_whoosh_1', { at: h.root });
    h.grounded = false;
    this.faceTo(en);
  }
  swing(seg, en) {
    const h = this.h, S = SEGS[seg];
    if (!h.anim.has(S.clip)) return;
    h.anim.oneShot(S.clip, { from: S.from, fadeIn: 0.05, fadeOut: 0.22, speed: SPEED });
    this.atk = { phase: 'hit', seg, en: en || null, t: S.from, from: S.from, clip: S.clip, done: false, queued: false };
    this.combo = seg + 1; this.comboT = 1.0;
    if (en) this.faceTo(en);
    // a little step into the punch
    const f = _v.set(-Math.sin(h.yaw), 0, -Math.cos(h.yaw));
    h.vel.x = f.x * 2.2; h.vel.z = f.z * 2.2;
  }
  faceTo(en) { const p = this.h.pos, q = en.holder.position; this.faceYaw = Math.atan2(-(q.x - p.x), -(q.z - p.z)); }
  serviceAttack(dt) {
    const h = this.h, A = this.atk;
    if (this.zipFx && (this.zipFx.t -= dt) <= 0) { this.zipFx.fx?.release(); this.zipFx = null; }
    if (!A) { this.faceYaw = this.hold ? this.hold.yaw : null; return false; }
    if (A.phase === 'lunge') {
      A.t += dt;
      const en = A.en; if (en.down) { this.atk = null; return false; }
      const to = _v.subVectors(en.holder.position, h.pos); const dy = to.y + 0.1; to.y = 0; const L = to.length();
      this.faceTo(en);
      if (L <= REACH * 0.85 || A.t >= A.dur + 0.1) { h.vel.set(0, Math.min(h.vel.y, 0) * 0, 0); this.swing(A.seg, en); if (A.queued) this.atk.queued = true; return true; }
      const sp = Math.max(14, (L - REACH * 0.6) / Math.max(0.05, A.dur - A.t));
      h.vel.copy(to.divideScalar(L).multiplyScalar(Math.min(sp, 30))); h.vel.y = THREE.MathUtils.clamp(dy * 4, -12, 12);
      h.grounded = false;
      return true;
    }
    if (A.phase === 'special') {
      A.t += dt * A.speed;
      if (!h.grounded && !A.done) h.vel.y = Math.max(h.vel.y, -1.5); else if (h.grounded) { h.vel.x *= Math.exp(-dt * 6); h.vel.z *= Math.exp(-dt * 6); }
      // track the target through the wind-up (he backs off, gets knocked about): close in, keep facing him
      if (!A.done && !A.en.down) {
        const to = _v.subVectors(A.en.holder.position, h.pos); to.y = 0; const L = to.length(); this.faceTo(A.en);
        if (L > 1.5) { to.multiplyScalar(Math.min(14, (L - 1.2) / 0.12) / L); h.vel.x = to.x; h.vel.z = to.z; }
      }
      if (!A.done && A.t >= A.hitAt) { A.done = true; if (!A.en.down && A.en.holder.position.distanceTo(h.pos) < REACH + 2.2) A.fn(); }
      if (A.t >= A.end) { this.atk = null; return false; }
      return true;
    }
    const S = SEGS[A.seg];
    A.t += dt * SPEED;
    if (!h.grounded) h.vel.y = Math.max(h.vel.y, -1.5);        // an air combo hangs in the air
    else { h.vel.x *= Math.exp(-dt * 6); h.vel.z *= Math.exp(-dt * 6); }
    if (!A.done && A.t >= S.hit) {
      A.done = true;
      const en = A.en && !A.en.down && A.en.holder.position.distanceTo(h.pos) < REACH + 1.2 ? A.en : this.pick(REACH + 1);
      if (en && en.holder.position.distanceTo(h.pos) < REACH + 1.2) { this.hit(en, S.dmg, !!S.big); this.legsFollow(en, !!S.big); }
      else h.haptic('ui_tick', 0.3);
    }
    if (A.t >= S.end) {
      if (A.queued) {
        const next = (A.seg + 1) % SEGS.length, en = this.pick();
        if (en) { const d = _v.subVectors(en.holder.position, h.pos); d.y = 0; if (d.length() > REACH) { h.anim.cancelShot(A.clip, 0.1); this.lunge(en, next, d.length()); return true; } }
        if (A.clip !== SEGS[next].clip) h.anim.cancelShot(A.clip, 0.1);
        this.swing(next, en || A.en);
        return true;
      }
      h.anim.cancelShot(A.clip, 0.25);
      this.atk = null;
      if (A.seg === SEGS.length - 1) this.combo = 0;
      return false;
    }
    return true;
  }

  // ---- launcher / finisher
  launcher() {
    const h = this.h, en = this.pick(REACH + 1.5);
    if (!en || !h.anim.has('uppercut')) return;
    if (this.atk) h.anim.cancelShot(this.atk.clip, 0.08);
    this.faceTo(en);
    h.anim.oneShot('uppercut', { from: 0.08, fadeIn: 0.04, fadeOut: 0.2, speed: 1.2 });
    this.atk = { phase: 'special', t: 0.08, en, hitAt: 0.2, end: 0.62, clip: 'uppercut', speed: 1.2, done: false, fn: () => {
      this.hit(en, 9, true);
      h.vel.y = 8.5; h.grounded = false;                   // carried up with the blow: an air combo can follow
      this.stats.launch++; h.event({ kind: 'launcher' }, false);
    } };
    this.combo = 0; this.comboT = 1.2;
  }
  finisher(en) {
    const h = this.h;
    if (this.atk) h.anim.cancelShot(this.atk.clip, 0.08);
    const d = _v.subVectors(en.holder.position, h.pos); d.y = 0;
    if (d.length() > REACH) { const f = d.normalize(); h.vel.x = f.x * 16; h.vel.z = f.z * 16; }
    this.faceTo(en);
    h.anim.oneShot('kick', { from: 0.1, fadeIn: 0.04, fadeOut: 0.22, speed: 1.0 });
    h.kick({ slow: 0.3, slowTime: 0.7, fov: 4 });
    this.atk = { phase: 'special', t: 0.1, en, hitAt: 0.32, end: 0.62, clip: 'kick', speed: 1.0, done: false, fn: () => {
      this.hit(en, 80, true); h.kick({ hitstop: 110, shake: 0.4 });
      this.stats.finishers++; h.event({ kind: 'finisher' }, false);
    } };
    this.focus = 0;
  }

  // ---- web bomb (L1 + R1)
  webBomb() {
    const h = this.h;
    if (this.bombCD > 0) return false;
    const aim = h.aimFoe?.() || h.aimPoint?.clone(); if (!aim) return false;
    const from = h.web.R?.getWorldPosition(new THREE.Vector3()) || h.pos.clone();
    const L = from.distanceTo(aim);
    h.anim.layer('web_shoot_both', 1, { restart: true, rate: 30 });
    h.world.webfx?.shoot({ from, dir: aim.clone().sub(from).normalize(), speed: 45, hand: 'R' });
    h.sfx('sp_thwip_double', { at: h.root }); h.haptic('web_zip');
    this.bombs.push({ at: aim.clone(), t: Math.min(L / 45, 1.2) + 0.05 });
    this.bombCD = BOMB_CD; this.stats.bombs++;
    h.event({ kind: 'web_bomb' }, false);
    return true;
  }
  serviceBombs(dt) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i]; if ((b.t -= dt) > 0) continue;
      this.bombs.splice(i, 1);
      const h = this.h, E = this.E, fx = h.world.webfx;
      try { fx?.splat?.({ point: b.at.clone(), normal: new THREE.Vector3(0, 1, 0), size: 1.6 }); } catch { }
      h.sfx('sp_web_splat_2', { at: b.at }); h.kick({ shake: 0.15 });
      for (const en of this.foes()) {
        if (en.holder.position.distanceTo(b.at) > BOMB_R + (en.k?.big ? 1 : 0)) continue;
        E?.web?.(en, h, 2);
        try { fx?.splat?.({ point: this.chest(en), normal: new THREE.Vector3(0, 1, 0), size: 0.5 }); } catch { }
        this.gainFocus(FOCUS_HIT);
      }
    }
  }

  // ---- dodge / air trick
  dodge() {
    const h = this.h;
    if (this.dodgeCD > 0) return false;
    this.cancel();
    const foes = this.foes().filter(en => en.holder.position.distanceTo(h.pos) < 25).sort((a, b) => a.holder.position.distanceTo(h.pos) - b.holder.position.distanceTo(h.pos));
    const air = !h.grounded;
    if (air && !foes.length && !h.rope) { this.trick(); return true; }
    if (h.rope) h.releaseRope(false, true);
    const dir = _v2;
    if ((h.mag || 0) > 0.3) dir.copy(h.wish).setY(0).normalize();
    else {
      const th = this.senseEn || foes[0];
      if (th) dir.subVectors(h.pos, th.holder.position).setY(0).normalize(); else dir.set(Math.sin(h.camYaw), 0, Math.cos(h.camYaw));
    }
    const perfect = this.sense > 0.6;
    h.vel.x = dir.x * 10.5; h.vel.z = dir.z * 10.5; h.vel.y = air ? Math.max(h.vel.y, 4) : 5; h.grounded = false;
    // he keeps FACING the threat (else the camera's forward) and the move matches the direction relative to it:
    // away = backflip, sideways = aerial side roll, towards = a forward roll past
    const th = this.senseEn || foes[0];
    const fy = th ? Math.atan2(-(th.holder.position.x - h.pos.x), -(th.holder.position.z - h.pos.z)) : h.camYaw;
    const fx = -Math.sin(fy), fz = -Math.cos(fy), along = dir.x * fx + dir.z * fz, side = dir.x * -fz + dir.z * fx;   // + side = his right
    let clip = 'dodge_flip', from = 0.1, speed = 1.35;
    if (Math.abs(side) > Math.abs(along) && h.anim.has('dodge_side_R')) { clip = side > 0 ? 'dodge_side_R' : 'dodge_side_L'; from = 0.06; speed = 1.25; }
    else if (along > 0.5 && h.anim.has('land_roll')) { clip = 'land_roll'; from = 0.04; speed = 1.3; h.vel.y = air ? h.vel.y : 2.5; }
    this.hold = { yaw: fy, t: 0.55 }; h.yaw = fy;
    this.lastDodge = { clip, along: +along.toFixed(2), side: +side.toFixed(2), sense: !!this.senseEn, th: th?.id ?? null };
    h.anim.oneShot(clip, { from, fadeIn: 0.04, fadeOut: 0.2, speed });
    h.sfx('sp_whoosh_2', { at: h.root }); h.haptic('web_release', 0.6);
    this.iframes = IFRAMES; this.dodgeCD = DODGE_CD;
    if (perfect) { this.stats.perfect++; this.gainFocus(FOCUS_PERFECT); h.kick({ slow: 0.3, slowTime: 0.45, fov: 3 }); h.haptic('web_attach', 1); h.event({ kind: 'perfect_dodge' }, false); }
    return true;
  }
  trick() {
    const h = this.h;
    this.dodgeCD = 0.6;
    const clips = ['swing_release', 'dodge_flip'], c = clips[(this._trick = ((this._trick || 0) + 1) % clips.length)];
    h.anim.oneShot(c, { from: c === 'dodge_flip' ? 0.12 : 0.02, fadeIn: 0.04, fadeOut: 0.25, speed: 1.2 });
    h.sfx('sp_whoosh_3', { at: h.root }); h.haptic('web_release', 0.4);
    h.event({ kind: 'trick', clip: c }, false);
  }

  // ---- Iron Spider legs (they deploy / stow on D-pad →, see spider/legs.js): out, the combo's big hit adds the
  // four-leg flurry — staggered stabs at everything within LEG_R, also behind him
  legsFlurry() {
    const h = this.h;
    if (this.flurry || !h.legs?.playClip('legs_strike', 1.15)) return;
    this.flurry = { t: 0, hits: [0.12, 0.22, 0.32, 0.42], done: 0 };
    this.stats.legs++;
    h.event({ kind: 'legs_flurry' }, false);
  }
  serviceLegs(dt) {
    const L = this.flurry; if (!L) return;
    const h = this.h; L.t += dt;
    while (L.done < L.hits.length && L.t >= L.hits[L.done]) {
      L.done++;
      const big = L.done === L.hits.length;
      const near = this.foes().filter(en => en.holder.position.distanceTo(h.pos) < LEG_R + (en.k?.big ? 1 : 0));
      near.sort((a, b) => a.holder.position.distanceTo(h.pos) - b.holder.position.distanceTo(h.pos));
      if (near.length) this.hit(near[(L.done - 1) % near.length], big ? 12 : 7, big);
    }
    if (L.t >= 1.15) this.flurry = null;
  }
  /** the LEGS PIN (D-pad → held, legs out): both upper claws seize the nearest foe, slam him down and web him to
   * the ground (knockdown + 2 webs) */
  legsPin() {
    const h = this.h, G = h.legs;
    if (G?.state !== 'out' || this.atk?.phase === 'special') return false;
    const en = this.foes().filter(e => e.holder.position.distanceTo(h.pos) < PIN_R).sort((a, b) => a.holder.position.distanceTo(h.pos) - b.holder.position.distanceTo(h.pos))[0];
    if (!en) return false;
    this.cancel(); this.faceTo(en);
    const t0 = h._clock || 0, at = new THREE.Vector3();
    // the claws: on his chest, then following him down to the ground
    G.grip(() => { const k = Math.min(1, Math.max(0, ((h._clock || 0) - t0 - 0.28) / 0.3)); return at.copy(en.holder.position).setY(en.holder.position.y + 1.05 - 0.75 * k); }, 1.0);
    this.atk = { phase: 'special', t: 0, en, hitAt: 0.28, end: 0.9, clip: 'legs_pin', speed: 1, done: false, fn: () => {
      this.hit(en, 14, true); this.E?.web?.(en, h, 2);
      h.kick({ hitstop: 70, shake: 0.3 }); h.haptic('hit_heavy', 0.8); h.sfx('sp_leg_strike', { at: h.root });
      G.stats.pins++; h.event({ kind: 'legs_pin', to: en.id }, false);
    } };
    return true;
  }
  /** where the threat is (the spider-sense attacker, else the nearest foe within 30 m) — the legs guard faces it */
  threatPos() {
    const h = this.h, en = this.senseEn || this.foes().filter(e => e.holder.position.distanceTo(h.pos) < 30).sort((a, b) => a.holder.position.distanceTo(h.pos) - b.holder.position.distanceTo(h.pos))[0];
    return en ? this.chest(en, new THREE.Vector3()) : null;
  }
  /** a strike landed with the legs out: an upper leg stabs a second foe close by (or the same one) */
  legsFollow(en, big) {
    const h = this.h, G = h.legs; if (G?.state !== 'out') return;
    if (big) return this.legsFlurry();
    const other = this.foes().filter(o => o !== en && o.holder.position.distanceTo(h.pos) < LEG_R).sort((a, b) => a.holder.position.distanceTo(h.pos) - b.holder.position.distanceTo(h.pos))[0];
    if (G.stab(this.chest(other || en))) { if (other) this.hit(other, 4, false); }
  }


  // ---- the fight (for the camera): foes near him that are fighting, or he just attacked
  fightUpdate(dt) {
    const h = this.h;
    this.lastAct = this.atk || this.flurry || this.hold ? 0 : (this.lastAct ?? 99) + dt;
    let n = 0; const c = (this._tc ||= new THREE.Vector3()).set(0, 0, 0); let W = 0;
    for (const en of this.foes()) {
      const d = en.holder.position.distanceTo(h.pos); if (d > 16) continue;
      if (en.state === 'patrol' && this.lastAct > 3) continue;
      const w = (1 / (d + 2)) * (en.busy > 0 && !en.k?.ranged ? 2 : 1) * (en === this.atk?.en ? 2 : 1);
      c.addScaledVector(en.holder.position, w); W += w; n++;
    }
    this.fighting = n > 0 || this.lastAct < 2;
    this.threat = W > 0 ? c.divideScalar(W) : null;
  }

  // ---- spider-sense
  senseUpdate(dt) {
    const h = this.h, E = this.E; let s = 0, who = null;
    if (E && h.local) {
      for (const en of this.foes()) {
        const k = en.k || {}, d = en.holder.position.distanceTo(h.pos);
        if (!k.ranged && en.busy > 0 && d < (k.reach || 2) + 1.4 && en.loco == null) { const tt = (en.busy - (en.anim?.clips?.[k.attack]?.duration || 1) * 0.9 + (k.hitAt?.[0] || 0.4)); if (tt > -0.05 && tt < 0.55) { s = 1; who = en; } }
        else if (k.ranged && en.loco === 'aim' && en.cool < 0.3 && d < (k.reach || 30)) { if (s < 0.7) { s = 0.7; who = en; } }   // about to fire
      }
      for (const R of E.gf?.rockets || []) if (R.victim === h && !R.held && R.o) { const d = R.o.position.distanceTo(h.pos); if (d < 30) { s = 1; who = R.shooter || who; } }
    }
    if (s > 0.6 && this.sense <= 0.6) { h.haptic('ui_tick', 0.6); h.event({ kind: 'spider_sense' }, false); }
    this.sense = s; this.senseEn = who;
  }
  /** i-frames: the controller's health setter ignores damage while this is true */
  invulnerable() { return this.iframes > 0; }
}
