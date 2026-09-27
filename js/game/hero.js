// Shared hero plumbing: body + clip libraries, sound/haptic/juice helpers, the city collider, the
// network snapshot. Iron Man (ironman.js) and Spider-Man (spider.js) extend it.
import * as THREE from 'three';
import { Animator } from './anim.js';
import { CityCollider } from './collide.js';
import { NanoController } from './fx/nano.js';

export const LIBS = {
  ironman: 'assets/anims/ironman_core.glb', spiderman: 'assets/anims/spider_core.glb',
  human: 'assets/anims/human_core.glb', human174: 'assets/anims/human_core_174.glb', hulkbuster: 'assets/anims/hulkbuster_core.glb',
};
export const libsFor = suit => suit === 'hulkbuster' ? ['hulkbuster'] : suit === 'ironspider' ? ['spiderman'] : suit === 'peter' ? ['spiderman', 'human174'] : ['ironman'];
export const glbFor = (MZ, suit) => MZ.SUITS?.find(s => s.id === suit)?.glb || (suit === 'peter' ? 'assets/characters/peter/peter.glb' : `assets/suits/${suit}/${suit}.glb`);

let colliderP = null;
/** The world's collider if it has one, else ours built from the city layout (cached). */
export async function colliderFor(world) {
  if (world.collide) return world.collide;
  colliderP ||= CityCollider.load('/assets/city/layout.json');
  return (world.collide = await colliderP);
}

export class Hero {
  constructor(MZ, world, { id = 'local', name = '', hero, suit, local = true, spawn = null } = {}) {
    Object.assign(this, { MZ, world, id, name, hero, suit, local, spawnOpt: spawn });
    this.fov = 64; this.health = 1; this.loops = {}; this._offs = [];
    this.net = { has: false, p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(), t: 0 };
  }
  async loadBody(suit = this.suit) {
    const MZ = this.MZ;
    const [g, ...libs] = await Promise.all([MZ.assets.load(glbFor(MZ, suit)), ...libsFor(suit).map(k => MZ.assets.load(LIBS[k]).catch(() => null))]);
    const root = g.scene; root.name = `hero_${this.hero}_${this.id}`;
    this.world.litModel ? this.world.litModel(root) : root.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    const clips = [...(g.animations || []), ...libs.filter(Boolean).flatMap(l => l.animations)];
    const metas = [g.clips, ...libs.filter(Boolean).map(l => l.clips)];
    return { root, clips, metas, gltf: g };
  }
  /** Nanotech suits (Mk 85, Iron Spider): weapons rest hidden behind drv_nano_* = 0, the body
   * formed at drv_nano = 1 — only the nano shader makes that true, so every nano suit needs it. */
  installNano(root) {
    let has = false; root.traverse(o => { if (o.isMesh && o.geometry?.attributes?.uv1) has = true; });
    if (!has) return null;
    this.nano = new NanoController(root);
    // one depth/distance material per nano driver group (they only read the group's uniforms): with one
    // per mesh, gfx/merge.js (keyed on customDepthMaterial) could not merge a single plate
    for (const g of this.nano.groups.values()) {
      const d = g.meshes[0]?.customDepthMaterial, di = g.meshes[0]?.customDistanceMaterial;
      for (const m of g.meshes) { if (m.customDepthMaterial !== d) m.customDepthMaterial?.dispose(); if (m.customDistanceMaterial !== di) m.customDistanceMaterial?.dispose(); m.customDepthMaterial = d; m.customDistanceMaterial = di; }
    }
    if (this.world.cr) root.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial) this.world.cr.addMaterial(m); });
    return this.nano;
  }
  makeAnimator(root, clips, metas) {
    return new Animator(root, clips, metas, {
      onCue: (e, clip) => this.onCue(e, clip),
      onDriver: (n, v, node) => this.onDriver?.(n, v, node),
    });
  }
  /** clip cue → sound (+ vfx the controller does not handle itself) */
  onCue(e) {
    if (e.sfx) this.sfx(e.sfx, { at: e.at ? this.root.getObjectByName(e.at) : this.root, gain: (e.gain ?? 1) * 0.9 });
    if (e.vfx === 'dust') this.world.vfx?.cue('dust', this.root, e, this.root);
  }
  sfx(id, o = {}) { return this.MZ.audio?.play(id, { ...o, gain: (o.gain ?? 1) * (this.local ? 1 : 0.75) }); }
  /** looping sound kept alive by name; gain 0 lets it idle, started lazily once audio runs */
  loop(name, id, gain, rate = 1) {
    let h = this.loops[name];
    // the local hero's own engine is not positional (the listener is the camera, 6 m behind);
    // other players' are
    if (!h && gain > 0.01 && this.MZ.audio?.running) h = this.loops[name] = this.MZ.audio.play(id, { ...(this.local ? {} : { at: this.root }), loop: true, gain: 0 });
    if (!h) return;
    // the index's loop points (the files have a 30 ms fade at each end; wrapping over it clicked)
    if (h.src && !h._lp) { const e = this.MZ.audio.index?.[id]; if (e?.loopStart != null) { h.src.loopStart = e.loopStart; h.src.loopEnd = e.loopEnd ?? h.src.buffer.duration - 0.03; } h._lp = true; }
    const g = Math.max(0, gain); if (Math.abs(g - (h._g ?? -1)) > 0.004) { h.gain(g); h._g = g; }
    if (Math.abs(rate - (h._r ?? 0)) > 0.004) { h.rate?.(rate); h._r = rate; }
  }
  haptic(id, gain = 1) { if (this.local) this.MZ.haptics?.play(id, gain); }
  kick(k) { if (!this.local) return; this.MZ.game?.kick ? this.MZ.game.kick(k) : this.world.kick?.(k); }
  event(e, replicate = true) { if (!this.local) return; this.MZ.game?.event ? this.MZ.game.event({ ...e, id: this.id }, replicate) : this.MZ.emit?.('game:event', e); }
  onEvent(fn) { if (this.MZ.on) this._offs.push(this.MZ.on('game:event', e => { if (e.from != null && e.from !== this.MZ.net?.id && (e.id === this.id || e.from === this.id)) fn(e); })); }

  snapshot() { const p = this.root?.position || new THREE.Vector3(); return { x: p.x, y: p.y, z: p.z, heading: this.heading || 0, speed: this.speedNow || 0 }; }
  applyState(s) {
    const n = this.net; n.p.fromArray(s.p); n.q.fromArray(s.q); n.v.fromArray(s.v || [0, 0, 0]); n.s = s; n.has = true; n.t = performance.now();
  }
  dispose() {
    for (const off of this._offs) off?.();
    for (const h of Object.values(this.loops)) h?.stop?.(0.2);
    this.anim?.dispose(); this.root?.removeFromParent();
    for (const d of this.disposables || []) d?.dispose?.();
  }
}

export const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
