// Haptics: a small designed library of rumble patterns played through the Gamepad API
// (vibrationActuator 'dual-rumble'; 'trigger-rumble' on Xbox pads in Chrome/Windows).
// Library source: v3/assets/haptics/haptics.json (the design agent's) when present, else FALLBACK
// below. Pattern = steps [{t, dur, strong, weak, left?, right?}] in ms / 0..1.
// Rules: short, distinct, never constant noise. Continuous feedback (thruster, web tension) goes
// through hum(), which is faint when steady and only swells on CHANGE.
export const FALLBACK = {
  ui_tick:        { group: 'ui', desc: 'focus moved', steps: [{ t: 0, dur: 16, strong: 0, weak: 0.16 }] },
  ui_confirm:     { group: 'ui', desc: 'confirm', steps: [{ t: 0, dur: 36, strong: 0.12, weak: 0.42 }] },
  ui_back:        { group: 'ui', desc: 'back', steps: [{ t: 0, dur: 26, strong: 0, weak: 0.24 }] },
  ui_error:       { group: 'ui', desc: 'refused', steps: [{ t: 0, dur: 55, strong: 0.35, weak: 0.15 }, { t: 105, dur: 55, strong: 0.35, weak: 0.15 }] },
  ui_ready:       { group: 'ui', desc: 'ready / player joined', steps: [{ t: 0, dur: 40, strong: 0.25, weak: 0.3 }, { t: 90, dur: 60, strong: 0.45, weak: 0.3 }] },
  ui_countdown:   { group: 'ui', desc: 'countdown tick', steps: [{ t: 0, dur: 45, strong: 0.3, weak: 0.1 }] },
  ui_start:       { group: 'ui', desc: 'match start', steps: [{ t: 0, dur: 90, strong: 0.7, weak: 0.4 }, { t: 90, dur: 260, strong: 0.25, weak: 0.15 }] },
  suit_select:    { group: 'ui', desc: 'suit chosen — three clamps', steps: [{ t: 0, dur: 45, strong: 0.55, weak: 0.25 }, { t: 130, dur: 45, strong: 0.65, weak: 0.3 }, { t: 280, dur: 90, strong: 0.9, weak: 0.45 }] },
  suit_clamp:     { group: 'suit', desc: 'suit-up clamp lock', steps: [{ t: 0, dur: 38, strong: 0.7, weak: 0.5 }] },
  nano_flow:      { group: 'suit', desc: 'nanotech flowing over the body', steps: [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ t: i * 70, dur: 60, strong: 0.05 + i * 0.02, weak: 0.25 + 0.05 * Math.sin(i) })) },
  repulsor_shot:  { group: 'ironman', desc: 'repulsor shot — sharp kick', steps: [{ t: 0, dur: 50, strong: 0.35, weak: 0.9, right: 0.7 }, { t: 50, dur: 60, strong: 0.12, weak: 0.25 }] },
  repulsor_charge:{ group: 'ironman', desc: 'charging (rising)', steps: [0, 1, 2, 3, 4, 5].map(i => ({ t: i * 90, dur: 85, strong: 0.05 + i * 0.05, weak: 0.1 + i * 0.07 })) },
  charged_blast:  { group: 'ironman', desc: 'charged blast release', steps: [{ t: 0, dur: 90, strong: 1, weak: 1, right: 1, left: 0.4 }, { t: 90, dur: 220, strong: 0.45, weak: 0.2 }] },
  boost:          { group: 'ironman', desc: 'supersonic boost kick', steps: [{ t: 0, dur: 140, strong: 0.8, weak: 0.4, left: 0.6, right: 0.6 }, { t: 140, dur: 200, strong: 0.3, weak: 0.1 }] },
  brake:          { group: 'ironman', desc: 'hard brake / retro burn', steps: [{ t: 0, dur: 180, strong: 0.5, weak: 0.15, left: 0.5 }] },
  land_soft:      { group: 'both', desc: 'landing, soft', steps: [{ t: 0, dur: 45, strong: 0.3, weak: 0.2 }] },
  land_med:       { group: 'both', desc: 'landing, medium', steps: [{ t: 0, dur: 70, strong: 0.6, weak: 0.35 }, { t: 70, dur: 80, strong: 0.2, weak: 0.1 }] },
  land_hero:      { group: 'both', desc: 'superhero landing', steps: [{ t: 0, dur: 110, strong: 1, weak: 0.7 }, { t: 110, dur: 250, strong: 0.35, weak: 0.15 }] },
  hit_light:      { group: 'both', desc: 'hit taken, light', steps: [{ t: 0, dur: 50, strong: 0.25, weak: 0.55 }] },
  hit_heavy:      { group: 'both', desc: 'hit taken, heavy', steps: [{ t: 0, dur: 120, strong: 0.9, weak: 0.6 }, { t: 160, dur: 60, strong: 0.4, weak: 0.2 }] },
  explosion_near: { group: 'both', desc: 'explosion close', steps: [{ t: 0, dur: 160, strong: 1, weak: 0.8 }, { t: 160, dur: 400, strong: 0.35, weak: 0.12 }] },
  explosion_far:  { group: 'both', desc: 'explosion far', steps: [{ t: 60, dur: 260, strong: 0.28, weak: 0.05 }] },
  web_thwip:      { group: 'spider', desc: 'web shot', steps: [{ t: 0, dur: 45, strong: 0.06, weak: 0.4 }] },
  web_attach:     { group: 'spider', desc: 'web line attaches', steps: [{ t: 0, dur: 90, strong: 0.35, weak: 0.12 }] },
  web_release:    { group: 'spider', desc: 'let go of the line', steps: [{ t: 0, dur: 30, strong: 0, weak: 0.22 }] },
  web_hit_body:   { group: 'spider', desc: 'web glob hits an enemy', steps: [{ t: 0, dur: 90, strong: 0.5, weak: 0.55 }] },
  web_zip:        { group: 'spider', desc: 'web zip start', steps: [{ t: 0, dur: 200, strong: 0.55, weak: 0.35 }] },
  hb_step:        { group: 'ironman', desc: 'Hulkbuster footstep', steps: [{ t: 0, dur: 80, strong: 0.75, weak: 0.1 }] },
};

export class Haptics {
  constructor(input) {
    this.input = input; this.lib = { ...FALLBACK }; this.source = 'fallback';
    this.master = 1; this.scale = {}; this.enabled = true;
    try { const s = JSON.parse(localStorage.getItem('mz3.haptics') || '{}'); Object.assign(this, { master: s.master ?? 1, scale: s.scale || {}, enabled: s.enabled ?? true }); } catch { }
    this.log = [];           // [{at, id, steps}] — the test page draws it; headless tests read it
    this._timers = []; this._hum = new Map();
  }
  async init() {
    try {
      const r = await fetch('/v3assets/haptics/haptics.json');
      if (r.ok) {
        const j = await r.json(), pats = j.patterns || j;
        let n = 0;
        for (const [id, p] of Object.entries(pats)) {
          const steps = Array.isArray(p) ? p : (p.steps || p.pulses || p.seq);
          if (Array.isArray(steps) && steps.length) { this.lib[id] = { group: p.group || 'lib', desc: p.desc || p.description || '', steps, intensity: p.intensity }; n++; }
        }
        if (n) this.source = `assets/haptics/haptics.json (${n})`;
      }
    } catch { }
    return this;
  }
  save() { try { localStorage.setItem('mz3.haptics', JSON.stringify({ master: this.master, scale: this.scale, enabled: this.enabled })); } catch { } }
  supported() { const a = this.input.gamepad()?.vibrationActuator; return a ? (a.effects || ['dual-rumble']) : []; }

  _fire(step, k) {
    const gp = this.input.gamepad(), a = gp?.vibrationActuator; if (!a) return;
    const s = Math.min(1, (step.strong || 0) * k), w = Math.min(1, (step.weak || 0) * k);
    const trig = (step.left || step.right) && (a.effects || []).includes('trigger-rumble');
    try {
      if (trig) a.playEffect('trigger-rumble', { startDelay: 0, duration: step.dur, strongMagnitude: s, weakMagnitude: w, leftTrigger: Math.min(1, (step.left || 0) * k), rightTrigger: Math.min(1, (step.right || 0) * k) });
      else a.playEffect('dual-rumble', { startDelay: 0, duration: step.dur, strongMagnitude: s, weakMagnitude: w });
    } catch { }
  }
  /** Play a pattern. gain scales it (e.g. landing force). */
  play(id, gain = 1) {
    const p = this.lib[id]; if (!p) { console.warn('[haptics] no pattern', id); return; }
    const k = this.enabled ? this.master * (this.scale[id] ?? 1) * (p.intensity ?? 1) * gain : 0;
    this.log.push({ at: performance.now(), id, k, steps: p.steps }); if (this.log.length > 60) this.log.shift();
    if (k <= 0) return;
    for (const st of p.steps) this._timers.push(setTimeout(() => this._fire(st, k), st.t || 0));
    if (this._timers.length > 200) this._timers.splice(0, 100);
  }
  /** Landing by impact speed (m/s). */
  land(speed) { this.play(speed > 22 ? 'land_hero' : speed > 9 ? 'land_med' : 'land_soft', Math.min(1.2, 0.5 + speed / 30)); }
  /** Continuous channel (thruster level, web tension): faint when steady, swells on change.
   * Call every frame with level 0..1; returns the magnitude actually sent. */
  hum(channel, level, dt) {
    const h = this._hum.get(channel) || { level: 0, sent: 0, next: 0 };
    const d = Math.abs(level - h.level) / Math.max(dt, 1e-3);
    h.level = level;
    const mag = level < 0.04 ? 0 : Math.min(0.5, 0.03 + 0.07 * level + 0.12 * Math.min(1, d / 3));
    const now = performance.now();
    if (now >= h.next && (mag > 0 || h.sent > 0)) {
      h.next = now + 90; h.sent = mag;
      const k = this.enabled ? this.master * (this.scale[channel] ?? 1) : 0;
      if (k > 0) this._fire({ dur: 110, strong: channel === 'thruster' ? mag : mag * 0.4, weak: channel === 'thruster' ? mag * 0.3 : mag }, k);
    }
    this._hum.set(channel, h);
    return mag;
  }
  stop() { this._timers.forEach(clearTimeout); this._timers = []; try { this.input.gamepad()?.vibrationActuator?.reset?.(); } catch { } }
}
