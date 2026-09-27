// City soundscape: looping beds cross-faded by camera height and distance to the water, plus
// distant one-shot events (sirens, foghorn) at random intervals. Same logic the game should use
// (see assets/city/GODOT.md, "Audio").
import * as THREE from 'three';

const ss = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

export class CityAmbience {
  /** mode: 'city' (outdoors), 'interior' (apartment: street muffled through windows), 'villa' */
  constructor(ctx, { mode = 'city' } = {}) {
    this.ctx = ctx; this.mode = mode; this.h = {}; this.t = 0; this.next = 8 + Math.random() * 10;
    this.interior = 0; this.windowsOpen = 0;
  }
  start() {
    const S = this.ctx.sfx, loop = (id, g = 0) => { this.h[id] = S.play(id, { loop: true, gain: g }); };
    for (const id of ['city_traffic', 'city_rumble_far', 'city_wind_high', 'city_harbour']) loop(id);
    if (this.mode === 'villa') { loop('villa_hum'); loop('villa_workshop'); }
  }
  /** interior 0..1 (camera inside a base), windowsOpen 0..1, workshop 0..1 (villa lower level) */
  update(dt, cam, { interior = 0, windowsOpen = 0, workshop = 0 } = {}) {
    const p = cam.position, y = Math.max(0, p.y);
    const shore = Math.max(Math.abs(p.x) - 700, Math.abs(p.z) - 1650);   // island ~1520 x 3440 m
    const muff = interior * (1 - 0.75 * windowsOpen);
    const street = (1 - ss(y, 25, 160)) * (1 - ss(shore, 0, 400)) * (1 - 0.8 * muff);
    const far = ss(y, 20, 120) * (1 - ss(y, 900, 2500)) * (1 - 0.7 * muff) + 0.15 * muff;
    const wind = ss(y, 40, 300) * (1 - interior);
    const harb = (1 - ss(y, 15, 90)) * ss(shore, -120, 60) * (1 - 0.7 * interior);
    const set = (id, v) => this.h[id]?.gain(v);
    set('city_traffic', 0.8 * street); set('city_rumble_far', 0.9 * far); set('city_wind_high', 0.7 * wind); set('city_harbour', 0.8 * harb);
    if (this.mode === 'villa') { set('villa_hum', 0.5 * interior * (1 - workshop)); set('villa_workshop', 0.7 * workshop); }
    // distant events
    this.t += dt;
    if (this.t > this.next) {
      this.t = 0; this.next = 20 + Math.random() * 40;
      const nearWater = shore > -100;
      const pool = nearWater ? ['city_foghorn', 'city_siren_police', 'city_siren_fire'] : ['city_siren_police', 'city_siren_fire', 'city_siren_us'];
      const id = pool[Math.floor(Math.random() * pool.length)];
      this.ctx.sfx.play(id, { gain: 0.35 * (1 - 0.6 * muff) * (this.mode === 'villa' && id !== 'city_foghorn' ? 0.4 : 1) });
    }
  }
  dispose() { for (const h of Object.values(this.h)) h?.stop(0.3); this.h = {}; }
}
