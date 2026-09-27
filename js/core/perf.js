// Frame-time measurement from day one: every client reports to the dev server (/api/stats) every
// 10 s, so the HP's real numbers land in docs/progress/perf/ without anyone watching the screen.
// The static browser build has no server: measuring still runs (the frame guard and HUD use it), reporting is off.
import { STATIC, devPost } from './env.js';
export class Perf {
  constructor(MZ) {
    this.MZ = MZ; this.times = []; this.last = 0; this.window = [];
    this.cpuWin = []; this.fps = 0; this.ms = 0; this.label = null; this.tier = 'high';
    this.enabled = !STATIC && MZ.params.get('perf') !== '0';
    const gl = MZ.stage.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    this.client = MZ.params.get('client') || (/Windows/.test(navigator.userAgent) ? 'hp' : /Headless/.test(navigator.userAgent) ? 'mac-headless' : 'mac');
    this.nextReport = performance.now() + 12000;
  }
  /** CPU time of one tick (input + game + JS side of rendering). If it is close to the frame time, we are CPU-bound. */
  cpu(ms) { this.cpuWin.push(ms); if (this.cpuWin.length > 1200) this.cpuWin.shift(); }
  frame(now) {
    if (this.last) { const d = now - this.last; this.window.push(d); if (this.window.length > 1200) this.window.shift(); }
    this.last = now;
    const n = Math.min(60, this.window.length);
    if (n) { let s = 0; for (let i = this.window.length - n; i < this.window.length; i++) s += this.window[i]; this.ms = s / n; this.fps = 1000 / this.ms; }
    if (this.enabled && now > this.nextReport && this.window.length > 120 && !document.hidden) { this.nextReport = now + 10000; this.report(); }
  }
  stats() {
    const a = [...this.window].sort((x, y) => x - y), q = p => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    const avg = this.window.reduce((s, v) => s + v, 0) / Math.max(1, this.window.length);
    const info = this.MZ.stage.renderer.info.render;
    const cs = [...this.cpuWin].sort((x, y) => x - y), cq = p => cs[Math.min(cs.length - 1, Math.floor(p * cs.length))] || 0;
    return { cpuAvg: cs.reduce((s, v) => s + v, 0) / Math.max(1, cs.length), cpuP95: cq(0.95), avg, fps: 1000 / avg, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: a.at(-1), n: a.length, draws: info.calls, tris: info.triangles };
  }
  async report() {
    const s = this.stats(), st = this.MZ.stage.size;
    const body = { client: this.client, label: this.label || 'phase:' + this.MZ.game.phase, gpu: this.gpu, w: Math.round(st.w * st.dpr), h: Math.round(st.h * st.dpr),
      scale: this.MZ.stage.renderScale, tier: this.tier, reversedZ: !!this.MZ.stage.renderer.state?.buffers?.depth?.getReversed?.(), ...s, ua: navigator.userAgent };
    this.window = []; this.cpuWin = [];
    devPost('/api/stats', body);
    return body;
  }
}
