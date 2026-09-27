// Title music: one track for the trailer AND the menu. Plays on the mixer's music bus (so the player's
// music volume applies); the trailer runs on this clock (sample-accurate, not the frame clock).
// Menu: after the trailer the same buffer keeps playing and loops loopStart..loopEnd seamlessly (Web Audio
// loop points = no click). In game it fades down (ducks to silence) and comes back in the menu.
export class TitleMusic {
  constructor(MZ, cfg = {}) { this.MZ = MZ; this.cfg = cfg; this.src = null; this.g = null; this.t0 = 0; this.buf = null; this.fallbackT0 = performance.now(); }
  get ac() { return this.MZ.audio.ac; }
  get running() { return !!this.ac && this.ac.state === 'running'; }
  async load() {
    if (!this.cfg.file) return null;
    this.MZ.audio.unlock();
    const r = await fetch(this.cfg.file); if (!r.ok) throw new Error('music ' + r.status);
    this.buf = await this.ac.decodeAudioData(await r.arrayBuffer());
    return this.buf;
  }
  /** start at `at` seconds into the track */
  play(at = 0) {
    this.fallbackT0 = performance.now() - at * 1000;
    if (!this.buf || !this.running) return;
    const ac = this.ac, bus = this.MZ.audio.bus.music;
    this.stop(0);
    const g = this.g = ac.createGain(); g.gain.value = this.cfg.gain ?? 0.9; g.connect(bus.g);
    const s = this.src = ac.createBufferSource(); s.buffer = this.buf;
    const ls = this.cfg.loopStart, le = this.cfg.loopEnd;
    if (ls != null) { s.loop = true; s.loopStart = ls; s.loopEnd = le ?? this.buf.duration; }
    s.connect(g); s.start(ac.currentTime + 0.02, at);
    this.t0 = ac.currentTime + 0.02 - at;
  }
  /** track time (s); without audio, the wall clock */
  get time() {
    if (this.src && this.running) {
      let t = this.ac.currentTime - this.t0;
      const ls = this.cfg.loopStart, le = this.cfg.loopEnd ?? this.buf?.duration;
      if (ls != null && t > le) t = ls + ((t - ls) % (le - ls));
      return t;
    }
    return (performance.now() - this.fallbackT0) / 1000;
  }
  fade(to, sec = 1) { if (!this.g) return; const p = this.g.gain; p.cancelScheduledValues(this.ac.currentTime); p.setTargetAtTime(to * (this.cfg.gain ?? 0.9), this.ac.currentTime, sec / 3); }
  stop(fade = 0.5) { const s = this.src, g = this.g; this.src = null; if (!s) return; try { g.gain.setTargetAtTime(0, this.ac.currentTime, Math.max(0.01, fade / 3)); setTimeout(() => { try { s.stop(); } catch { } }, fade * 1000 + 100); } catch { } }
}
