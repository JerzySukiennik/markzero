// Suit wheel — fallback UI until the UI agent's MZ.ui.suitWheel(open, items, onPick) exists
// (requested in docs/ui/CONTRACT-REQUESTS.md). Items round a circle; the controller feeds the
// stick angle and reads the pick. Deliberately plain: the real look is the UI agent's job.
export class SuitWheel {
  constructor(MZ) { this.MZ = MZ; this.items = []; this.sel = -1; this.open = false; this.el = null; }
  show(items, current) {
    this.items = items; this.sel = -1; this.open = true; this.current = current;
    const ui = this.MZ.ui?.suitWheel;
    if (ui) { this.ext = true; ui(true, items, null); return; }
    if (!this.el) {
      const el = this.el = document.createElement('div'); el.id = 'mz-suitwheel';
      el.style.cssText = 'position:fixed;left:50%;top:50%;width:360px;height:360px;margin:-180px 0 0 -180px;pointer-events:none;z-index:50;font:600 13px/1.2 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase';
      document.body.appendChild(el);
    }
    this.el.innerHTML = '';
    items.forEach((it, i) => {
      const a = this.angle(i), x = 180 + Math.sin(a) * 130, y = 180 - Math.cos(a) * 130;
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:${x - 60}px;top:${y - 22}px;width:120px;height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:10px;background:rgba(10,12,16,.62);color:#e8e8e8;transition:transform .08s,background .08s`;
      d.innerHTML = `<b style="font-size:15px">${it.name}</b><span style="opacity:.6;font-size:10px">${it.how || ''}</span>`;
      if (it.id === current) d.style.opacity = '0.45';
      this.el.appendChild(d); it._el = d;
    });
    this.el.style.display = 'block';
  }
  angle(i) { return (i / this.items.length) * Math.PI * 2; }
  /** stick (x right, y down) → selected index, or -1 in the dead zone */
  point(x, y) {
    if (!this.open) return this.sel;
    if (Math.hypot(x, y) < 0.5) return this.sel;
    let a = Math.atan2(x, -y); if (a < 0) a += Math.PI * 2;
    const n = this.items.length, i = Math.round(a / (Math.PI * 2 / n)) % n;
    if (i !== this.sel) {
      this.sel = i; this.MZ.haptics?.play?.('ui_tick'); this.MZ.audio?.ui?.('ui_tick');
      if (this.ext) this.MZ.ui.suitWheel(true, this.items, null, i);
      else this.items.forEach((it, k) => { it._el.style.background = k === i ? 'rgba(255,255,255,.9)' : 'rgba(10,12,16,.62)'; it._el.style.color = k === i ? '#111' : '#e8e8e8'; it._el.style.transform = k === i ? 'scale(1.12)' : 'none'; });
    }
    return this.sel;
  }
  close() {
    const pick = this.sel >= 0 ? this.items[this.sel] : null;
    this.open = false;
    if (this.ext) this.MZ.ui.suitWheel(false, this.items, null);
    else if (this.el) this.el.style.display = 'none';
    return pick;
  }
  dispose() { this.el?.remove(); }
}
