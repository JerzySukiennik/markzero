// Helmet-safe hair for Tony (shared by the gameplay suit-ups and the story's gantry — agreed in
// docs/game/GAMEPLAY-REQUESTS.md). tony.glb's full quiff (sculpted shell up to ~4 cm + 1100 hair cards)
// pokes through every helmet while it closes. tony_head.glb is ONE rigid mesh in piv_head space with a
// flattened helmet hair (≤ 7 mm), brows, goatee, eyes (NOTES: "Helmet safety").
//   setHelmetHair(tonyRoot, true)  → quiff + fuzz shells hidden, tony_head on piv_head (drawn over the
//                                    coincident skin with a small polygon offset)
//   setHelmetHair(tonyRoot, false) → full hair back (only while the face is visible: mask open / out of suit)
const QUIFF = /^(hair|hair_cards|brow_fur0|beard_fur0|beard_fur1)$/;
let headP = null;

export async function setHelmetHair(root, on, MZ) {
  if (!root || MZ?.params?.get?.('helmethair') === '0') return;   // ?helmethair=0: A/B only
  const st = root.userData.helmetHair ||= { on: false, head: null };
  if (st.on === on && (!on || st.head)) return;
  st.on = on;
  root.traverse(o => { if (o.isMesh && QUIFF.test(o.name)) o.visible = !on; });
  if (on && !st.head) {
    headP ||= MZ.assets.load('assets/characters/tony/tony_head.glb').catch(() => null);
    const g = await headP; if (!g || !st.on) return;
    const head = g.scene.clone(true); head.name = '__helmet_head';
    head.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); o.material.polygonOffset = true; o.material.polygonOffsetFactor = -1; o.material.polygonOffsetUnits = -1; } });
    root.getObjectByName('piv_head')?.add(head);
    st.head = head;
  }
  if (st.head) st.head.visible = on;
}
