// Graphics quality: four tiers, picked automatically, overridable in Settings.
//
//   MZ.gfx.tier              'ultra' | 'high' | 'balanced' | 'low'   (what is running now)
//   MZ.gfx.choice            'auto' | a tier                          (what the player picked; persisted)
//   MZ.gfx.setTier(t)        'auto' or a tier → emits 'gfx:tier' {tier, choice, auto, restart}
//   MZ.gfx.fx                effect flags of the current tier (taa, gtao, ssr, softShadows, motionBlur, bloom,
//                            godRays, dof, autoExposure, tonemap) — ?fx.<name>=0|1 overrides one (A/B shots)
//   MZ.gfx.detected          {gpu, cls, bench: {tier, ms} | null}
//   MZ.gfx.TIERS / ORDER     the tables
//
// Auto = the GPU's class (renderer string) capped/raised by a measured bench: the first seconds of the trailer
// or of play are timed (bench()) and the result is remembered (localStorage 'mz3.gfx.bench') so the next world
// load starts on the right tier. The frame guard (world.js) still steps down live if a tier turns out too heavy.
// World parameters (cascades, shadow size, props) apply on the next world load (restart: true); effects and the
// render scale apply at once.
import { STATIC } from '../core/env.js';

export const ORDER = ['low', 'balanced', 'high', 'ultra'];
export const TIERS = {
  low:      { world: { reflScale: 0.25, water: false, props: false, cascades: 2, shadowSize: 1024, renderScale: 0.7 },
              fx: { taa: false, gtao: false, ssr: false, softShadows: false, motionBlur: false, bloom: true, godRays: false, dof: false, autoExposure: true, tonemap: 'aces' } },
  balanced: { world: { reflScale: 0.25, water: true, props: true, cascades: 2, shadowSize: 2048, renderScale: 0.85 },
              fx: { taa: false, gtao: false, ssr: false, softShadows: false, motionBlur: false, bloom: true, godRays: false, dof: false, autoExposure: true, tonemap: 'aces' } },
  high:     { world: { reflScale: 0.35, water: true, props: true, cascades: 3, shadowSize: 2048, renderScale: 1 },
              fx: { taa: true, gtao: true, ssr: false, softShadows: true, motionBlur: true, bloom: true, godRays: true, dof: true, autoExposure: true, tonemap: 'agx' } },
  ultra:    { world: { reflScale: 0.5, water: true, props: true, cascades: 3, shadowSize: 4096, renderScale: 1 },
              fx: { taa: true, gtao: true, ssr: true, softShadows: true, motionBlur: true, bloom: true, godRays: true, dof: true, autoExposure: true, tonemap: 'agx' } },
};
// frame-time budget per tier on the player's display (ms, average during the bench): stay well under 16.7
const BENCH_OK = 11.5, BENCH_UP = 7.5;

/** GPU class from the unmasked renderer string (what the tier is before any measurement). */
export function classify(gpu, ua = navigator.userAgent) {
  const g = String(gpu || '');
  if (/Headless|SwiftShader|llvmpipe|Software|Basic Render/i.test(g + ' ' + ua)) return 'low';
  if (/Mali|Adreno|PowerVR|Apple GPU/i.test(g) || /iPhone|iPad|Android/i.test(ua)) return 'low';
  if (/Intel/i.test(g) && !/Arc/i.test(g)) return 'low';
  const laptop = /Laptop|Mobile|Max-Q|\b[0-9]{3,4}M\b|5[35]00M|MX\s?\d/i.test(g);
  if (/RTX\s?(40[789]0|50[789]0)|RX\s?7[89]\d\d|RTX\s?(3080|3090)|Apple M\d (Max|Ultra)/i.test(g)) return laptop ? 'high' : 'ultra';
  if (/RTX|RX\s?[67]\d\d\d|Radeon Pro W|Arc|Apple M\d Pro|GTX\s?10[78]0|GTX\s?1660/i.test(g)) return laptop ? 'balanced' : 'high';
  if (/Apple M\d/i.test(g)) return 'balanced';
  if (/GTX|Radeon|RX/i.test(g)) return 'balanced';
  return 'balanced';
}

export class Gfx {
  constructor(MZ, gpu) {
    this.MZ = MZ; this.TIERS = TIERS; this.ORDER = ORDER;
    const saved = (() => { try { return JSON.parse(localStorage.getItem('mz3.gfx') || '{}'); } catch { return {}; } })();
    const bench = (() => { try { return JSON.parse(localStorage.getItem('mz3.gfx.bench') || 'null'); } catch { return null; } })();
    this.detected = { gpu, cls: classify(gpu), bench: bench && bench.gpu === gpu ? bench : null };
    const url = MZ.params.get('tier');
    this.choice = url && TIERS[url] ? url : saved.choice && (saved.choice === 'auto' || TIERS[saved.choice]) ? saved.choice : 'auto';
    this.fromUrl = !!(url && TIERS[url]);
    this.tier = this.choice === 'auto' ? this.autoTier() : this.choice;
    this._fx();
  }
  /** app.js: work time of one frame (CPU tick + GPU drained) while a bench runs. */
  benchFrame(ms) { if (this._benching && !document.hidden) this._benching.push(ms); }
  get benching() { return !!this._benching; }
  get auto() { return this.choice === 'auto'; }
  autoTier() {
    const b = this.detected.bench;
    return b ? b.tier : this.detected.cls;
  }
  _fx() {
    const fx = { ...TIERS[this.tier].fx }, P = this.MZ.params;
    for (const k of Object.keys(fx)) { const v = P.get('fx.' + k); if (v != null) fx[k] = k === 'tonemap' ? v : v !== '0'; }
    this.fx = fx;
  }
  get world() { return TIERS[this.tier].world; }
  setTier(t) {
    if (t !== 'auto' && !TIERS[t]) return false;
    const prev = this.tier, prevWorld = JSON.stringify(TIERS[prev].world);
    this.choice = t; this.fromUrl = false;
    try { localStorage.setItem('mz3.gfx', JSON.stringify({ choice: t })); } catch { }
    this.tier = t === 'auto' ? this.autoTier() : t;
    this._fx();
    const restart = JSON.stringify(TIERS[this.tier].world) !== prevWorld && !!this.MZ.game?.world;
    this.MZ.emit('gfx:tier', { tier: this.tier, choice: this.choice, auto: this.auto, prev, restart });
    return true;
  }
  /** Time `seconds` of real rendering (trailer or play) and remember the tier this machine can hold. Returns
   * {tier, ms}. Only moves one step per bench, never above the class + 1 or below low. */
  async bench(seconds = 4, { label = 'bench' } = {}) {
    // The rAF interval is capped by vsync (always ≥ 16.7 ms on a 60 Hz screen), so it cannot tell a fast GPU from a
    // slow one. During the bench app.js waits for the GPU after every frame (a 1-pixel readPixels) and reports the
    // real work time per frame via benchFrame(ms).
    const frames = this._benching = [];
    await new Promise(res => setTimeout(res, seconds * 1000));
    this._benching = null;
    if (frames.length < 30) return null;
    frames.sort((a, b) => a - b);
    const ms = frames.slice(0, Math.floor(frames.length * 0.9)).reduce((s, v) => s + v, 0) / Math.floor(frames.length * 0.9);   // drop the worst 10 % (loading hitches)
    const i = ORDER.indexOf(this.tier), cap = Math.min(ORDER.length - 1, ORDER.indexOf(this.detected.cls) + 1);
    let tier = this.tier;
    if (ms > BENCH_OK && i > 0) tier = ORDER[i - 1];
    else if (ms < BENCH_UP && i < cap) tier = ORDER[i + 1];
    const res = { tier, ms: +ms.toFixed(2), ran: this.tier, gpu: this.detected.gpu, label, at: Date.now() };
    this.detected.bench = res;
    try { localStorage.setItem('mz3.gfx.bench', JSON.stringify(res)); } catch { }
    if (!STATIC) console.info('[gfx] bench', res);
    return res;
  }
}
