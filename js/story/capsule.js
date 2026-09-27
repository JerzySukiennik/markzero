// The nanotech charging capsule on Peter's desk (MCU Iron Spider pod + Homecoming glass case):
// a hexagonal dark-metal dock with gold trim, a glass cylinder, the nano housing (a red/gold
// spider-emblem puck) floating inside, cyan charge rings climbing the glass, and a six-petal iris
// lid that opens when Peter reaches in. Procedural (no asset), ~2k triangles, 8 materials.
//   const c = makeCapsule(THREE);  scene.add(c.root);  c.update(dt, t);
//   c.open()  c.take() (puck leaves with the hand: c.puck is re-parentable)  c.drain()
import * as THREE from 'three';

function emblemTexture() {
  const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 10, s / 2, s / 2, s / 2);
  grd.addColorStop(0, '#c4202c'); grd.addColorStop(0.72, '#8e1019'); grd.addColorStop(0.74, '#d9a441'); grd.addColorStop(0.86, '#8a6420'); grd.addColorStop(1, '#2a2020');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  // spider emblem (Iron Spider: long legs, gold)
  g.translate(s / 2, s / 2); g.strokeStyle = '#ffcf6a'; g.fillStyle = '#ffcf6a'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.ellipse(0, -14, 13, 17, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(0, 22, 17, 26, 0, 0, Math.PI * 2); g.fill();
  const leg = (sx, pts) => { g.beginPath(); g.moveTo(sx * pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(sx * p[0], p[1]); g.stroke(); };
  for (const sx of [-1, 1]) {
    leg(sx, [[10, -20], [40, -55], [50, -92]]); leg(sx, [[12, -10], [55, -30], [72, -58]]);
    leg(sx, [[12, 10], [55, 30], [70, 62]]); leg(sx, [[10, 24], [38, 62], [44, 100]]);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function makeCapsule() {
  const root = new THREE.Group(); root.name = 'nano_capsule';
  const metal = new THREE.MeshStandardMaterial({ name: 'cap_metal', color: 0x1b1d22, metalness: 0.85, roughness: 0.32 });
  const gold = new THREE.MeshStandardMaterial({ name: 'cap_gold', color: 0xc99a3c, metalness: 1, roughness: 0.28 });
  const glow = new THREE.MeshStandardMaterial({ name: 'cap_glow', color: 0x061418, emissive: 0x66e6ff, emissiveIntensity: 3.2, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ name: 'cap_glass', color: 0xbfe8ff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 });
  const puckMat = new THREE.MeshStandardMaterial({ name: 'cap_puck', map: emblemTexture(), metalness: 0.75, roughness: 0.3, emissive: 0xff5a2a, emissiveIntensity: 0.0 });
  const ringMat = new THREE.MeshBasicMaterial({ name: 'cap_ring', color: 0x7feaff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const add = (geo, mat, y = 0, name = '') => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.name = name; root.add(m); return m; };
  // dock: hexagon base, gold band, glowing seam, top collar
  add(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 6), metal, 0.025, 'cap_base').rotation.y = Math.PI / 6;
  add(new THREE.CylinderGeometry(0.205, 0.205, 0.012, 6), gold, 0.056, 'cap_band').rotation.y = Math.PI / 6;
  add(new THREE.CylinderGeometry(0.18, 0.19, 0.035, 6), metal, 0.08, 'cap_collar').rotation.y = Math.PI / 6;
  const seam = add(new THREE.TorusGeometry(0.155, 0.006, 6, 48), glow, 0.1, 'cap_seam'); seam.rotation.x = Math.PI / 2;
  // charge bars on the hexagon faces
  const bars = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2, b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.004), glow);
    b.position.set(Math.sin(a) * 0.2, 0.03, Math.cos(a) * 0.2); b.rotation.y = a; root.add(b); bars.push(b);
  }
  // glass tube + a thin gold top ring
  add(new THREE.CylinderGeometry(0.13, 0.13, 0.26, 40, 1, true), glass, 0.23, 'cap_glass');
  const top = add(new THREE.CylinderGeometry(0.145, 0.145, 0.02, 40), metal, 0.37, 'cap_top');
  add(new THREE.TorusGeometry(0.142, 0.005, 6, 48), gold, 0.36, 'cap_topring').rotation.x = Math.PI / 2;
  // iris lid: six petals on the top ring that rotate/slide out
  const petals = [];
  for (let i = 0; i < 6; i++) {
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0.14, -0.04); shape.lineTo(0.14, 0.04); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
    const pv = new THREE.Group(); pv.position.y = 0.382; pv.rotation.y = i / 6 * Math.PI * 2;
    const p = new THREE.Mesh(geo, i % 2 ? metal : gold); pv.add(p); root.add(pv); petals.push({ pv, p, a0: pv.rotation.y });
  }
  top.visible = false;                       // the petals are the lid
  // the puck (nano housing) floating inside
  const puck = new THREE.Group(); puck.name = 'nano_puck';
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.018, 32), [gold, puckMat, metal]);
  disc.rotation.x = Math.PI / 2; puck.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.005, 8, 32), gold); puck.add(rim);
  puck.position.y = 0.22; root.add(puck);
  // climbing charge rings
  const rings = [];
  for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.132, 0.003, 4, 48), ringMat); r.rotation.x = Math.PI / 2; root.add(r); rings.push(r); }
  // soft glow sprite inside (fake light: no runtime lights allowed)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: 0x7feaff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(0.7); halo.position.y = 0.22; root.add(halo);

  let open = 0, openT = 0, charge = 1, drain = 0, taken = false, T = 0;
  const api = {
    root, puck, materials: [metal, gold, glow, glass, puckMat],
    open() { openT = 1; },
    close() { openT = 0; },
    take() { taken = true; },
    drain() { drain = 1; },
    get isOpen() { return open > 0.95; },
    update(dt) {
      T += dt;
      open += (openT - open) * (1 - Math.exp(-dt * 5));
      for (const pt of petals) { pt.pv.rotation.y = pt.a0 + open * 0.9; pt.p.position.x = open * 0.12; pt.p.scale.setScalar(1 - open * 0.5); }
      charge = drain ? Math.max(0.08, charge - dt * 0.8) : 1;
      if (!taken) { puck.position.y = 0.22 + Math.sin(T * 1.6) * 0.008 + open * 0.05; puck.rotation.y += dt * 0.6; }
      puckMat.emissiveIntensity = 0.35 + 0.25 * Math.sin(T * 3) * charge;
      rings.forEach((r, i) => { const u = (T * 0.45 + i / 3) % 1; r.position.y = 0.11 + u * 0.24; r.material.opacity = Math.sin(u * Math.PI) * 0.8 * charge; r.scale.setScalar(1 - u * 0.04); });
      glow.emissiveIntensity = (2.2 + Math.sin(T * 2.4) * 0.8) * charge;
      bars.forEach((b, i) => { b.visible = charge > 0.2 && (i / 6 < (T * 0.6) % 1.2); });
      halo.material.opacity = (0.4 + 0.15 * Math.sin(T * 2.4)) * charge * (taken ? 0.3 : 1);
    },
    dispose() { root.removeFromParent(); root.traverse(o => { o.geometry?.dispose?.(); }); },
  };
  return api;
}

let _halo;
function haloTex() {
  if (_halo) return _halo;
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s; const g = cv.getContext('2d');
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
  return (_halo = new THREE.CanvasTexture(cv));
}
