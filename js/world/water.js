// Water is NOT a floor (Jurek: "why is the water a surface?"). The collider's "ground" over the river is
// now the seabed (SEABED m); the water level stays available for effects:
//   world.collide.waterAt(x, z) → water surface y or null · world.collide.isWater(x, z)
// WaterMonitor (per frame, every player) does the water gameplay the controllers don't know about:
//   Iron Man  — low over water: spray/wake + a light rumble; touching it: splash + drag; under it: the
//               thrusters haul him up; stuck under for 4 s → respawn on the nearest shore.
//   Spider-Man (and anyone else without swimming) — falls in: splash, sinks, quick fade, respawn on the
//               nearest pier/shore with a short message (until swimming exists).
// Hook for other layers: world.onWater(fn(player, info)) — fn returns true to take over the respawn itself.
import * as THREE from 'three';
import { teleport as storyTeleport } from '../story/control.js';

export const SEABED = -30;
const _v = new THREE.Vector3();

export function installWater(world) {
  const C = world.collide, layout = world.city.layout, WY = layout.water_y ?? -2.2;
  const city = C.parts3?.cityPrisms || C.city;
  if (city) city.waterY = SEABED;                  // outside the island outline the "street" is the riverbed
  C.waterLevel = WY;
  /** The ground under (x,z) is below the water level → it is water. */
  C.isWater = (x, z) => C.groundAt(x, z, WY + 0.5) < WY - 0.05;
  C.waterAt = (x, z) => (C.isWater(x, z) ? WY : null);
  world.waterMon = new WaterMonitor(world, WY);
  world.onWater = fn => world.waterMon.hooks.push(fn);
}

class WaterMonitor {
  constructor(world, WY) {
    this.world = world; this.WY = WY; this.hooks = []; this.state = new Map(); this.fade = 0; this.fadeDir = 0;
  }
  info(pl) {
    let s = this.state.get(pl); if (!s) this.state.set(pl, s = { inT: 0, under: 0, splashed: false, respawning: false, sprayT: 0 });
    return s;
  }
  update(dt, t) {
    const W = this.world, C = W.collide;
    for (const pl of W.MZ.game.players.values()) {
      if (!pl.root || pl.parked || pl._storyPark) continue;
      const p = pl.root.position, s = this.info(pl);
      if (!C.isWater(p.x, p.z)) { s.inT = 0; s.under = 0; s.splashed = false; continue; }
      const h = p.y - this.WY;                               // soles above the water surface
      const vel = pl.m?.velocity || pl.vel, speed = vel ? vel.length() : 0;
      if (pl.hero === 'ironman') this.ironman(pl, s, h, speed, vel, dt, t);
      else this.sinker(pl, s, h, speed, vel, dt);
    }
    // screen fade for respawns (juice pass)
    if (this.fadeDir) { this.fade = Math.max(0, Math.min(1, this.fade + this.fadeDir * dt / 0.35)); if (this.fade === 0) this.fadeDir = 0; }
    if (W.juice?.u?.uFade) W.juice.u.uFade.value = this.fade;
  }
  splash(p, size = 1) {
    const W = this.world, at = _v.set(p.x, this.WY + 0.05, p.z).clone();
    for (let i = 0; i < 8 * size; i++) W.vfx?.bb.spawn({ at: at.clone().add(new THREE.Vector3((Math.random() - .5) * 2 * size, 0.2, (Math.random() - .5) * 2 * size)), map: 'smoke', color: 0xe8f4ff, size: 0.9 * size, grow: 2.5, life: 1.2 + Math.random() * 0.6, blending: THREE.NormalBlending, opacity: 0.55, rise: 1.6 * size, fadeIn: 0.03 });
    W.vfx?.sparks.burst(at, new THREE.Vector3(0, 1, 0), Math.round(40 * size), 7 * size, 0.7, new THREE.Color(0.8, 0.9, 1.0), 0.9, 12);
    W.vfx?.bb.spawn({ at, map: 'ring', color: 0xdff2ff, size: 0.6 * size, grow: 6, life: 0.7, normal: new THREE.Vector3(0, 1, 0), opacity: 0.6 });
    W.juice?.shock(at, 0.5 * size, 0.5);
    W.MZ.audio.play(size > 0.8 ? 'sp_web_splat_2' : 'sp_web_splat_1', { at, gain: 0.9, rate: 0.55 });
  }
  ironman(pl, s, h, speed, vel, dt, t) {
    const W = this.world, MZ = W.MZ, p = pl.root.position;
    // skim: spray + wake below him while low and fast (visual only)
    if (h < 6 && h > -0.2 && speed > 8 && (s.sprayT -= dt) < 0) {
      s.sprayT = 0.05;
      const k = 1 - h / 6, at = new THREE.Vector3(p.x, this.WY + 0.05, p.z);
      W.vfx?.bb.spawn({ at, map: 'smoke', color: 0xf0f8ff, size: 0.8 + 1.4 * k, grow: 2, life: 0.9, blending: THREE.NormalBlending, opacity: 0.35 * k, rise: 0.8 + speed * 0.01, fadeIn: 0.02 });
      if (Math.random() < 0.5) W.vfx?.sparks.burst(at, new THREE.Vector3(0, 1, 0), 6, 3 + speed * 0.04, 0.8, new THREE.Color(0.85, 0.93, 1), 0.6, 10);
      if (pl.local) MZ.haptics.hum('water', 0.35 * k, dt);
    }
    if (h < 0.3) {
      if (!s.splashed) { s.splashed = true; this.splash(p, Math.min(1.6, 0.6 + speed / 60)); if (pl.local) { MZ.haptics.play('land_med', 0.8); MZ.game.kick({ shake: 0.35 }); } MZ.game.event({ kind: 'water', what: 'splash', speed }); }
      if (vel) {
        vel.multiplyScalar(Math.exp(-dt * (h < -0.5 ? 4 : 1.5)));              // water drag
        if (h < -0.4) vel.y = Math.max(vel.y, 7 + Math.min(6, -h * 2));       // the thrusters haul him out
      }
      s.under = h < -0.4 ? s.under + dt : 0;
      if (s.under > 4 && pl.local) this.respawn(pl, s, 'Back on dry land');
    } else if (h > 1.5) s.splashed = false;
  }
  sinker(pl, s, h, speed, vel, dt) {
    const W = this.world, MZ = W.MZ, p = pl.root.position;
    if (h > -0.1 || s.respawning) return;
    if (!s.splashed) { s.splashed = true; this.splash(p, Math.min(1.4, 0.6 + speed / 25)); if (pl.local) MZ.haptics.play('land_med', 0.7); MZ.game.event({ kind: 'water', what: 'splash', speed }); }
    if (vel) { vel.x *= Math.exp(-dt * 3); vel.z *= Math.exp(-dt * 3); vel.y = Math.max(vel.y, -2.2); }   // sinks slowly
    s.inT += dt;
    if (s.inT > 0.6 && pl.local) this.respawn(pl, s, 'No swimming yet — back to the pier');
  }
  /** fade out, move to the nearest shore/pier, fade in, tell the UI */
  respawn(pl, s, text) {
    if (s.respawning) return; s.respawning = true;
    const W = this.world, MZ = W.MZ, p = pl.root.position;
    for (const fn of this.hooks) if (fn(pl, { x: p.x, z: p.z, text })) { s.respawning = false; return; }
    this.fadeDir = 1;
    setTimeout(() => {
      const spot = this.shore(p.x, p.z);
      const yaw = Math.atan2(spot.fx, spot.fz);               // face inland, away from the water
      storyTeleport(pl, new THREE.Vector3(spot.x, spot.y + (pl.hero === 'ironman' ? 1 : 1), spot.z), yaw);
      MZ.game.event({ kind: 'toast', text }, false); MZ.game.event({ kind: 'water', what: 'respawn', x: spot.x, z: spot.z }, false);
      s.inT = 0; s.under = 0; s.splashed = false;
      this.fadeDir = -1;
      setTimeout(() => { s.respawning = false; }, 400);
    }, 380);
  }
  /** nearest dry spot (pier / quay / street) on the 4 m map raster, not inside a building; faces back to the water */
  shore(x, z) {
    const W = this.world, hf = W.hf, C = W.collide, res = hf?.res || 4;
    for (let r = res; r < 1200; r += res) {
      const n = Math.max(8, Math.round(2 * Math.PI * r / res));
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const k = hf ? hf.classAt(px, pz) : 'ground';
        if (!['pier', 'ground', 'street', 'park'].includes(k)) continue;
        if (C.isWater(px, pz)) continue;
        const gy = C.groundAt(px, pz, 50);
        if (C.inside?.(px, gy + 1, pz)) continue;
        return { x: px, y: gy, z: pz, fx: x - px, fz: z - pz };
      }
    }
    return { x: -573, y: 25.4, z: 662, fx: 0, fz: 1 };      // Peter's roof, as a last resort
  }
}
