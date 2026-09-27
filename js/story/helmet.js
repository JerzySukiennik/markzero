// Helmet-safe hair (Jurek: "during the suit-up you can see the hair through the helmet"). Tony's full quiff
// (`hair` + `hair_cards` in tony.glb) pokes through every helmet; the moment a helmet arrives at his head the
// full hair goes away (the helmet covers the scalp; with the faceplate still open the face stays visible).
//   setHelmetHair(tonyRoot, true)   // in the helmet: full hair hidden
//   const w = new HelmetWatch(tonyRoot, suitRoot, { nanoDriver: 'drv_nano_helmet' }); w.update() each frame
// Shared with the gameplay agents' suit-ups: docs/game/GAMEPLAY-REQUESTS.md ("setHelmetHair").
import * as THREE from 'three';

const HAIR = /^(hair|hair_cards)$/;
export function setHelmetHair(root, inHelmet) {
  root?.traverse(o => { if (o.isMesh && HAIR.test(o.name)) o.visible = !inHelmet; });
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export class HelmetWatch {
  /** wearer: Tony's root; suit: the armour root; the full hair goes when a helmet piece is within `radius` of
   * his head (gantry / Mk 42 pieces) or when the nano helmet driver starts (Mk 85). Sticky until reset(). */
  constructor(wearer, suit, { radius = 0.5, nanoDriver = null, names = /^helmet/ } = {}) {
    this.wearer = wearer; this.head = wearer.getObjectByName('piv_head'); this.radius = radius; this.on = false;
    this.pieces = []; suit?.traverse(o => { if (names.test(o.name)) this.pieces.push(o); });
    this.drv = nanoDriver ? suit?.getObjectByName(nanoDriver) : null;
  }
  update() {
    if (this.on || !this.head) return this.on;
    let hit = this.drv && this.drv.position.x > 0.03;
    if (!hit) {
      // armed only once the helmet has been seen AWAY from the head (the rest pose — suit worn — has it on)
      this.head.getWorldPosition(_a); _a.y += 0.12;
      for (const p of this.pieces) { p.getWorldPosition(_b); const d = _a.distanceTo(_b); if (d > this.radius * 2.5) this.armed = true; else if (this.armed && d < this.radius) { hit = true; break; } }
    }
    if (hit) { this.on = true; setHelmetHair(this.wearer, true); }
    return this.on;
  }
  reset() { this.on = false; setHelmetHair(this.wearer, false); }
}
