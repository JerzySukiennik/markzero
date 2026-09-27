// Spider-Man's mission moves (story-owned, on △ = the 'grab' action the controller leaves free):
//   Takedown  an unaware enemy within 7 m, from behind or from above → web_pull, glued silently (no alarm)
//   Yank      a crate 4–14 m away → web_yank_throw: the crate follows the clip's prop_obj round his body and
//             is hurled at the nearest enemy (knockdown / KO in a 3.5 m radius)
//   Heave     a heavy generator 4–11 m away → web_heavy_throw overhead onto the brute (the finisher) or the crowd
//   Catch     an RPG fired at him → slow motion + prompt; △ → rpg_catch_return: the live rocket rides the
//             clip's prop_rocket and goes back to the shooter
// Props follow the authored prop tracks (sampled from spider_core, character space → the hero's root).
import * as THREE from 'three';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const ACT = 'grab';

export class SpiderMoves {
  constructor(S, M) { this.S = S; this.M = M; this.MZ = S.MZ; this.hero = S.hero; this.busy = null; this.prompt = null; this.rocket = null; }
  async init() {
    const lib = await this.MZ.assets.load('assets/anims/spider_core.glb');
    this.clips = Object.fromEntries(lib.animations.filter(c => /web_yank_throw|rpg_catch_return|web_heavy_throw|web_pull/.test(c.name)).map(c => [c.name, c]));
    this.M.enemies.onRocket = (R, shooter, tgt) => { if (tgt === this.hero && tgt.local) this.rocket = R; };
    this.M.enemies.onReturned = (R, p) => {
      this.M.enemies.gf.explosion(p, 6); this.MZ.game.kick?.({ shake: 0.4 });
      this.M.enemies.blast(p, 4.5, 60, this.hero);
    };
    return this;
  }
  /** sample a prop track of a clip at time t, in world space (hero root = character space) */
  prop(clip, node, t, outP, outQ) {
    const c = this.clips[clip]; if (!c) return false;
    for (const tr of c.tracks) {
      if (tr.name === node + '.position' && outP) { const v = tr.createInterpolant().evaluate(Math.min(t, c.duration)); outP.set(v[0], v[1], v[2]); this.hero.root.localToWorld(outP); }
      if (tr.name === node + '.quaternion' && outQ) { const v = tr.createInterpolant().evaluate(Math.min(t, c.duration)); outQ.set(v[0], v[1], v[2], v[3]).premultiply(this.hero.root.getWorldQuaternion(_q)); }
    }
    return true;
  }
  _pos() { return this.hero.pos; }
  _face(target) { const p = this._pos(), yaw = Math.atan2(-(target.x - p.x), -(target.z - p.z)); this.hero.teleport ? this.hero.teleport(p, yaw) : (this.hero.yaw = yaw); }
  _setPrompt(key, at, label) {
    if (this.prompt?.key === key) return;
    this.prompt?.p.remove(); this.prompt = null;
    if (key) this.prompt = { key, p: this.S.ui.worldPrompt({ at, action: ACT, hero: 'spiderman', label, near: 99, far: 99 }) };
  }
  reset() { this.busy = null; this.rocket = null; this._setPrompt(null); this.hero.setControl?.(true); }

  update(dt) {
    const S = this.S, h = this.hero, E = this.M.enemies, act = S.act;
    if (!E || !h.pos || S.phaseName || this.M.state !== 'active') { this._setPrompt(null); return; }
    if (this.busy) return this.busy.update(dt);
    const p = this._pos();
    // ---- incoming rocket: offer the catch
    const R = this.rocket;
    if (R && !R.held && E.gf.rockets.includes(R)) {
      const d = R.o.position.distanceTo(p), closing = _v.subVectors(p, R.o.position).dot(R.d) > 0;
      if (closing && d < 16 && d > 2.5) {
        S.time.to(0.3, 0.15);
        this._setPrompt('catch', () => R.o.position, 'Catch');
        if (act.pressed(ACT)) return this.catchRocket(R);
        return;
      }
      if (!closing || d <= 2.5) { this.rocket = null; S.time.to(1, 0.2); }
    } else if (R) { this.rocket = null; S.time.to(1, 0.2); }
    // ---- takedown / heave / yank candidates (closest wins)
    let best = null, bd = Infinity;
    for (const en of E.list) {
      if (en.down || en.state !== 'patrol') continue;
      const ep = en.holder.position, d = ep.distanceTo(p); if (d > 7 || d >= bd) continue;
      const fwd = _v.set(-Math.sin(en.holder.rotation.y), 0, -Math.cos(en.holder.rotation.y)), to = _v2.subVectors(p, ep).setY(0).normalize();
      if (fwd.dot(to) < 0.25 || p.y - ep.y > 2) { best = { kind: 'takedown', en }; bd = d; }
    }
    const grounded = h.grounded || h.perched;
    if (!best && grounded) for (const it of this.M.props?.items || []) {
      if (it.thrown || (it.kind !== 'crate' && it.kind !== 'heavy')) continue;
      const c = it.o.getWorldPosition(_v), d = Math.hypot(c.x - p.x, c.z - p.z), dy = Math.abs(c.y - (p.y - 1));
      const [lo, hi] = it.kind === 'heavy' ? [4, 11] : [4, 14];
      if (d < lo || d > hi || dy > 2.5 || d >= bd) continue;
      if (!E.list.some(en => !en.down && en.holder.position.distanceTo(c) < 35)) continue;
      best = { kind: it.kind === 'heavy' ? 'heave' : 'yank', it }; bd = d;
    }
    if (!best) { this._setPrompt(null); return; }
    if (best.kind === 'takedown') this._setPrompt('td' + best.en.id, () => best.en.holder.position.clone().setY(best.en.holder.position.y + 2.1), 'Takedown');
    else this._setPrompt((best.kind) + best.it.x + best.it.z, () => best.it.o.getWorldPosition(new THREE.Vector3()).setY(best.it.o.position.y + best.it.size + 0.4), best.kind === 'heave' ? 'Heave' : 'Yank');
    if (act.pressed(ACT)) { this.prompt?.p.done(); this.prompt = null; this[best.kind](best.en || best.it); }
  }

  // ---------------------------------------------------------------- moves
  _lock(name, dur, fn, end) {
    const h = this.hero; h.setControl?.(false); h.vel?.set(0, h.vel.y, 0);
    const shot = h.anim.oneShot(name, { fadeIn: 0.1, fadeOut: 0.25 });
    let t = 0;
    this.busy = { update: dt => { t = shot?.a ? shot.a.time : t + dt; fn(t, dt); if (t >= dur - 0.05 || (shot && !h.anim.shotPlaying(name) && t > 0.2)) { this.busy = null; h.setControl?.(true); end?.(); } } };
  }
  takedown(en) {
    this._face(en.holder.position);
    let done = false;
    const w = this.hero.web?.R?.getWorldPosition(new THREE.Vector3());
    if (w) try { this.S.world.webfx?.shoot({ from: w, dir: en.holder.position.clone().setY(en.holder.position.y + 1).sub(w).normalize(), hand: 'R' }); } catch { }
    this._lock('web_pull', 1.0, t => { if (!done && t > 0.42) { done = true; this.M.enemies.webbed(en, true); this.MZ.haptics.play('web_hit_body'); } });
  }
  yank(it) {
    const c0 = it.o.getWorldPosition(new THREE.Vector3()); it.thrown = true;
    this._face(c0);
    const E = this.M.enemies, tgt = E.list.filter(e => !e.down).sort((a, b) => a.holder.position.distanceTo(c0) - b.holder.position.distanceTo(c0))[0];
    const P = new THREE.Vector3(), Q = new THREE.Quaternion();
    let flying = null;
    it.o.parent.attach(it.o);
    this._lock('web_yank_throw', 2.7, (t, dt) => {
      if (t < 0.3) return;
      this.prop('web_yank_throw', 'prop_obj', t, P, Q);
      if (t < 0.66) it.o.position.lerpVectors(c0, P.setY(P.y - it.size / 2), (t - 0.3) / 0.36);
      else if (t < 1.78) { it.o.position.copy(P).setY(P.y - it.size / 2); it.o.quaternion.copy(Q); }
      else if (!flying) {
        const to = tgt ? tgt.holder.position.clone().setY(tgt.holder.position.y + 0.8) : P.clone().add(_v.set(0, 0, -12).applyQuaternion(this.hero.root.quaternion));
        flying = { from: it.o.position.clone(), to, t: 0, T: Math.max(0.35, it.o.position.distanceTo(to) / 26) };
        this.S.puppets.add({ update: dt2 => {
          if (!flying) return; flying.t += dt2; const k = Math.min(1, flying.t / flying.T);
          it.o.position.lerpVectors(flying.from, flying.to, k).y += Math.sin(k * Math.PI) * 1.5; it.o.rotation.x += dt2 * 9;
          if (k >= 1) { E.gf.impact(flying.to, _v.set(0, 1, 0), 'concrete'); E.blast(flying.to, 3.5, 30, this.hero); this.MZ.audio.play('en_impact_metal', { at: flying.to }); this.MZ.game.kick?.({ shake: 0.2 }); it.o.visible = false; flying = null; }
        } });
      }
    });
  }
  heave(it) {
    const c0 = it.o.getWorldPosition(new THREE.Vector3()); it.thrown = true;
    this._face(c0);
    const E = this.M.enemies, alive = E.list.filter(e => !e.down);
    const tgt = alive.find(e => e.k.big) || alive.sort((a, b) => a.holder.position.distanceTo(c0) - b.holder.position.distanceTo(c0))[0];
    const P = new THREE.Vector3(), Q = new THREE.Quaternion();
    let rel = null;
    this._lock('web_heavy_throw', 3.0, (t, dt) => {
      if (t < 0.26) return;
      this.prop('web_heavy_throw', 'prop_heavy', t, P, Q);
      if (t < 0.55) it.o.position.lerpVectors(c0, P.setY(P.y - it.size * 0.45), (t - 0.26) / 0.29);
      else if (t < 1.72) { it.o.position.copy(P).setY(P.y - it.size * 0.45); it.o.quaternion.copy(Q); }
      else if (!rel) {
        rel = { from: it.o.position.clone(), to: tgt ? tgt.holder.position.clone() : P.clone(), t: 0 };
        this.S.puppets.add({ update: dt2 => {
          if (!rel) return; rel.t += dt2; const k = Math.min(1, rel.t / 0.45);
          it.o.position.lerpVectors(rel.from, rel.to, k).y += Math.sin(k * Math.PI) * 2.2;
          if (k >= 1) { E.gf.explosion(rel.to, 4); E.blast(rel.to, 4.5, 130, this.hero); this.MZ.game.kick?.({ shake: 0.6, hitstop: 70 }); this.MZ.haptics.play('explosion_near'); it.o.visible = false; rel = null; }
        } });
      }
    });
  }
  catchRocket(R) {
    this._setPrompt(null); this.rocket = null;
    this.S.time.to(0.55, 0.1);
    this._face(R.o.position);
    const P = new THREE.Vector3(), Q = new THREE.Quaternion(), from = R.o.position.clone();
    let caught = false, released = false;
    this._lock('rpg_catch_return', 2.5, t => {
      if (t < 0.34) { R.o.position.lerpVectors(from, this.prop('rpg_catch_return', 'prop_rocket', 0.34, P) && P, t / 0.34); return; }
      if (!caught) { caught = true; R.held = true; this.MZ.haptics.play('web_attach'); }
      if (t < 1.42) { this.prop('rpg_catch_return', 'prop_rocket', t, P, Q); R.o.position.copy(P); R.o.quaternion.copy(Q); return; }
      if (!released) {
        released = true; R.held = false; R.returned = true;
        const sh = R.shooter?.holder.position.clone().setY(R.shooter.holder.position.y + 1) || P.clone().add(_v.set(0, 0, -30));
        R.d = sh.clone().sub(R.o.position).normalize(); R.target = sh; R.v = 30; R.speed = 60; R.dist = 0; R.range = 200;
        R.o.quaternion.setFromUnitVectors(_v.set(0, 0, -1), R.d);
        this.S.time.to(1, 0.4);
      }
    }, () => this.S.time.to(1, 0.3));
  }
  dispose() { this._setPrompt(null); this.hero.setControl?.(true); this.S.time.to(1, 0.2); }
}
