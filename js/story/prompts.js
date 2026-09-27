// Story overlay (DOM, its own layer #story above the canvas, below the UI):
//   world prompts   pinned to a 3D point: far = a small dot, in range = ring + glyph + one-word label
//                   (pop animation), hold = the ring fills; off-screen = hidden; size follows distance.
//   world markers   mission beacons / objective badges pinned in 3D with a distance readout; clamp to
//                   the screen edge with an arrow when off-screen.
//   move prompts    bottom strip, glyph + ≤ 2 words, max 2 at once (tutorial).
//   beat line       one short line of story text (subtitle position).
//   card            mission title card; objective list top-left.
// Glyphs come from MZ.prompt(action) / MZ.glyph(btn), so remaps and PS/Xbox follow.
import * as THREE from 'three';

const CSS = `
#story { position: fixed; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; font-family: 'Barlow C', 'Barlow Condensed', sans-serif; color: var(--mz-text, #eef); --u: calc(100vh / 1080 * 22px); }
#story .wp { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); will-change: transform; }
#story .wp .dot { position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px; border-radius: 50%; background: var(--mz-text, #fff); box-shadow: 0 0 8px var(--mz-glow, #9cf), 0 0 2px #000; transition: transform 220ms cubic-bezier(.22,1,.36,1), opacity 180ms; }
#story .wp .ring { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px; border-radius: 50%;
  background: radial-gradient(circle, rgba(6,10,14,.62) 58%, transparent 60%);
  display: grid; place-items: center; transform: scale(.2); opacity: 0; transition: transform 240ms cubic-bezier(.34,1.56,.64,1), opacity 160ms; }
#story .wp .ring::before { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--mz-accent, #7cf); opacity: .95;
  box-shadow: 0 0 14px color-mix(in srgb, var(--mz-accent, #7cf) 60%, transparent), inset 0 0 8px color-mix(in srgb, var(--mz-accent, #7cf) 40%, transparent); }
#story .wp .ring .fill { position: absolute; inset: -3px; border-radius: 50%; background: conic-gradient(var(--mz-accent, #7cf) calc(var(--hold, 0) * 1turn), transparent 0);
  -webkit-mask: radial-gradient(circle, transparent 62%, #000 64%); mask: radial-gradient(circle, transparent 62%, #000 64%); }
#story .wp .ring .glyph { width: 34px; height: 34px; }
#story .wp .lab { position: absolute; left: 40px; top: 50%; transform: translate(-8px, -50%); opacity: 0; white-space: nowrap; font-weight: 600; font-size: 24px; letter-spacing: .06em; text-transform: uppercase;
  text-shadow: 0 1px 3px rgba(0,0,0,.8), 0 0 12px rgba(0,0,0,.5); transition: transform 260ms cubic-bezier(.22,1,.36,1) 60ms, opacity 200ms 60ms; }
#story .wp .lab small { display: block; font: 500 12px 'JB Mono', monospace; letter-spacing: .2em; color: var(--mz-dim, #9ab); }
#story .wp.near .dot { transform: scale(0); opacity: 0; }
#story .wp.near .ring { transform: scale(1); opacity: 1; }
#story .wp.near .lab { transform: translate(0, -50%); opacity: 1; }
#story .wp.done .ring { transform: scale(1.5); opacity: 0; transition-duration: 300ms; }
#story .wp.done .lab { opacity: 0; }
#story .wp.gone { opacity: 0; transition: opacity 200ms; }

#story .mk { position: absolute; left: 0; top: 0; will-change: transform; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; transition: opacity 250ms; }
#story .mk .badge { width: 34px; height: 34px; transform: rotate(45deg); border: 2px solid var(--mz-glow, #ffd27a); background: color-mix(in srgb, var(--mz-glow, #ffd27a) 30%, rgba(8,8,8,.55));
  box-shadow: 0 0 16px color-mix(in srgb, var(--mz-glow, #ffd27a) 70%, transparent); display: grid; place-items: center; }
#story .mk .badge i { transform: rotate(-45deg); font: 700 15px 'JB Mono', monospace; color: var(--mz-text, #fff); font-style: normal; }
#story .mk.obj .badge { width: 22px; height: 22px; border-color: var(--mz-danger, #ff4050); background: color-mix(in srgb, var(--mz-danger, #ff4050) 25%, rgba(8,8,8,.5)); box-shadow: 0 0 10px color-mix(in srgb, var(--mz-danger, #ff4050) 60%, transparent); }
#story .mk .stalk { width: 2px; height: 18px; background: linear-gradient(var(--mz-glow, #ffd27a), transparent); }
#story .mk.obj .stalk { background: linear-gradient(var(--mz-danger, #ff4050), transparent); height: 10px; }
#story .mk .dist { margin-top: 6px; font: 700 13px 'JB Mono', monospace; letter-spacing: .1em; text-shadow: 0 1px 2px #000; }
#story .mk .name { font-weight: 600; font-size: 17px; letter-spacing: .08em; text-transform: uppercase; text-shadow: 0 1px 3px #000; margin-bottom: 6px; }
#story .mk.edge .stalk, #story .mk.edge .name { display: none; }
#story .mk .arrow { display: none; width: 0; height: 0; border: 8px solid transparent; border-bottom-color: var(--mz-glow, #ffd27a); margin-bottom: 2px; }
#story .mk.edge .arrow { display: block; }

#story .moves { position: absolute; left: 50%; bottom: 12vh; transform: translateX(-50%); display: flex; gap: 28px; }
#story .mv { display: flex; align-items: center; gap: 10px; padding: 8px 16px 8px 10px; background: rgba(6,10,14,.55); border-left: 3px solid var(--mz-accent, #7cf);
  font-weight: 600; font-size: 26px; letter-spacing: .06em; text-transform: uppercase; text-shadow: 0 1px 2px #000;
  animation: mvIn 320ms cubic-bezier(.34,1.56,.64,1) both; }
#story .mv .glyph { width: 36px; height: 36px; }
#story .mv .plus { opacity: .6; font-size: 20px; }
#story .mv.out { animation: mvOut 260ms ease-in both; }
#story .mv.ok { border-left-color: #7dffb0; }
@keyframes mvIn { from { opacity: 0; transform: translateY(14px) scale(.9); } to { opacity: 1; transform: none; } }
@keyframes mvOut { to { opacity: 0; transform: translateY(-10px) scale(1.06); } }

#story .beat { position: absolute; left: 50%; bottom: 22vh; transform: translateX(-50%); max-width: 70vw; text-align: center; font-weight: 500; font-size: 30px; letter-spacing: .02em;
  text-shadow: 0 2px 6px rgba(0,0,0,.9); opacity: 0; transition: opacity 400ms; }
#story .beat.on { opacity: 1; }
#story .beat b { color: var(--mz-accent, #7cf); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; margin-right: .4em; }

#story .card { position: absolute; left: 6vw; top: 34vh; opacity: 0; transform: translateX(-20px); transition: opacity 400ms, transform 500ms cubic-bezier(.22,1,.36,1); }
#story .card.on { opacity: 1; transform: none; }
#story .card small { display: block; font: 500 13px 'JB Mono', monospace; letter-spacing: .3em; color: var(--mz-accent, #7cf); text-transform: uppercase; }
#story .card h2 { margin: 4px 0; font-weight: 600; font-size: 64px; letter-spacing: .03em; text-transform: uppercase; line-height: 1; text-shadow: 0 2px 10px rgba(0,0,0,.7); }
#story .card p { margin: 6px 0 0; font-size: 24px; max-width: 34em; text-shadow: 0 1px 4px #000; }
#story .card .rule { height: 2px; width: 0; background: var(--mz-accent, #7cf); transition: width 700ms cubic-bezier(.22,1,.36,1) 150ms; }
#story .card.on .rule { width: 260px; }

#story .objs { position: absolute; left: 40px; top: 17vh; display: flex; flex-direction: column; gap: 6px; }
#story .ob { font-weight: 600; font-size: 22px; letter-spacing: .05em; text-transform: uppercase; text-shadow: 0 1px 3px #000; padding-left: 12px; border-left: 2px solid var(--mz-glow, #ffd27a); animation: mvIn 300ms both; }
#story .ob small { display: block; font: 500 11px 'JB Mono', monospace; letter-spacing: .3em; color: var(--mz-glow, #ffd27a); }
#story .ob.done { opacity: .45; text-decoration: line-through; }

#story .bars::before, #story .bars::after { content: ''; position: absolute; left: 0; right: 0; height: 0; background: #000; transition: height 600ms cubic-bezier(.22,1,.36,1); }
#story .bars::before { top: 0; } #story .bars::after { bottom: 0; }
#story .bars.on::before, #story .bars.on::after { height: 9vh; }
#story .cover { position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity 700ms ease; }
#story .cover.on { opacity: 1; transition: none; }
#story .skip { position: absolute; right: 40px; bottom: 36px; display: flex; gap: 8px; align-items: center; font: 500 12px 'JB Mono', monospace; letter-spacing: .2em; opacity: 0; transition: opacity 300ms; }
#story .skip.on { opacity: .75; }
#story .skip .glyph { width: 24px; height: 24px; }
`;

const _v = new THREE.Vector3();

export class Overlay {
  constructor(MZ) {
    this.MZ = MZ;
    if (!document.getElementById('story-css')) { const s = document.createElement('style'); s.id = 'story-css'; s.textContent = CSS; document.head.appendChild(s); }
    this.root = document.createElement('div'); this.root.id = 'story';
    this.root.innerHTML = `<div class="bars"></div><div class="objs"></div><div class="beat"></div><div class="card"></div><div class="moves"></div><div class="skip"></div><div class="cover on"></div>`;
    document.body.appendChild(this.root);
    const q = s => this.root.querySelector(s);
    this.el = { bars: q('.bars'), objs: q('.objs'), beat: q('.beat'), card: q('.card'), moves: q('.moves'), skip: q('.skip'), cover: q('.cover') };
    this.prompts = new Set(); this.markers = new Set(); this.moveEls = new Map();
    this._beatT = null;
  }
  glyph(btnOrAction, hero) {
    const p = this.MZ.prompt?.(btnOrAction, hero);
    return p ? p.html : this.MZ.glyph(btnOrAction);
  }

  // ---------------------------------------------------------------- world prompts
  /** {at: Vector3 | Object3D | () => Vector3, action, hero, label, sub, near: 2.2, far: 8, hold: 0} */
  worldPrompt(o) {
    const el = document.createElement('div'); el.className = 'wp';
    el.innerHTML = `<div class="dot"></div><div class="ring"><div class="fill"></div>${this.glyph(o.action, o.hero)}</div><div class="lab">${o.label || ''}${o.sub ? `<small>${o.sub}</small>` : ''}</div>`;
    this.root.appendChild(el);
    const p = { near: 2.2, far: 9, ...o, el, hold: 0, inRange: false, visible: true,
      setHold: v => { p.hold = v; el.style.setProperty('--hold', v.toFixed(3)); },
      done: () => { el.classList.add('done'); setTimeout(() => p.remove(), 350); },
      remove: () => { el.remove(); this.prompts.delete(p); },
      hide: on => { p.visible = !on; el.classList.toggle('gone', on); } };
    this.prompts.add(p);
    return p;
  }
  // ---------------------------------------------------------------- world markers
  /** {at, name, kind: 'main'|'obj', icon: '!'|'1'…, fadeNear: 25} */
  marker(o) {
    const el = document.createElement('div'); el.className = 'mk' + (o.kind === 'obj' ? ' obj' : '');
    el.innerHTML = `<div class="name">${o.name || ''}</div><div class="arrow"></div><div class="badge"><i>${o.icon ?? ''}</i></div><div class="stalk"></div><div class="dist"></div>`;
    this.root.appendChild(el);
    const m = { fadeNear: 20, ...o, el, dist: el.querySelector('.dist'), remove: () => { el.remove(); this.markers.delete(m); } };
    this.markers.add(m);
    return m;
  }
  // ---------------------------------------------------------------- moves / text
  move(id, action, label, { hero, combo = null } = {}) {
    if (this.moveEls.has(id)) return this.moveEls.get(id);
    const el = document.createElement('div'); el.className = 'mv';
    el.innerHTML = (combo ? combo.map(a => this.glyph(a, hero)).join('<span class="plus">+</span>') : this.glyph(action, hero)) + `<span>${label}</span>`;
    this.el.moves.appendChild(el); this.moveEls.set(id, el);
    return el;
  }
  moveDone(id, ok = true) {
    const el = this.moveEls.get(id); if (!el) return;
    this.moveEls.delete(id);
    if (ok) el.classList.add('ok');
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 280); }, ok ? 260 : 0);
  }
  clearMoves() { for (const id of [...this.moveEls.keys()]) this.moveDone(id, false); }
  beat(text, secs = 3.2, who = '') {
    const b = this.el.beat;
    b.innerHTML = (who ? `<b>${who}</b>` : '') + text; b.classList.add('on');
    clearTimeout(this._beatT); this._beatT = setTimeout(() => b.classList.remove('on'), secs * 1000);
  }
  card(title, text = '', kicker = '', secs = 3.6) {
    const c = this.el.card;
    c.innerHTML = `<small>${kicker}</small><h2>${title}</h2><div class="rule"></div>${text ? `<p>${text}</p>` : ''}`;
    requestAnimationFrame(() => c.classList.add('on'));
    clearTimeout(this._cardT); this._cardT = setTimeout(() => c.classList.remove('on'), secs * 1000);
  }
  objectives(list) {     // [{text, sub, done}]
    this.el.objs.innerHTML = list.map(o => `<div class="ob${o.done ? ' done' : ''}">${o.sub ? `<small>${o.sub}</small>` : ''}${o.text}</div>`).join('');
  }
  cover(on) { this.el.cover.classList.toggle('on', on); }
  bars(on) { this.el.bars.classList.toggle('on', on); }
  skipHint(on, btn = 'start') { this.el.skip.innerHTML = on ? `${this.MZ.glyph('east')}<span>HOLD TO SKIP</span>` : ''; this.el.skip.classList.toggle('on', on); }

  // ---------------------------------------------------------------- per frame
  update(camera, from) {
    const W = innerWidth, H = innerHeight;
    camera.updateMatrixWorld();
    for (const p of this.prompts) {
      const at = typeof p.at === 'function' ? p.at() : p.at.isObject3D ? p.at.getWorldPosition(_v) : p.at;
      const d = from ? from.distanceTo(at) : camera.position.distanceTo(at);
      _v.copy(at).project(camera);
      const on = p.visible && _v.z < 1 && d < p.far && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      p.el.style.display = on ? '' : 'none';
      if (!on) { p.inRange = false; p.el.classList.remove('near'); continue; }
      const near = d < p.near;
      if (near !== p.inRange) { p.inRange = near; p.el.classList.toggle('near', near); }
      const camD = camera.position.distanceTo(at), s = Math.max(0.6, Math.min(1.25, 3.2 / Math.max(1, camD)));
      p.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * W}px, ${(-_v.y * 0.5 + 0.5) * H}px) translate(-50%, -50%) scale(${s.toFixed(3)})`;
    }
    for (const m of this.markers) {
      const at = typeof m.at === 'function' ? m.at() : m.at.isObject3D ? m.at.getWorldPosition(_v) : m.at;
      const d = (from || camera.position).distanceTo(at);
      _v.copy(at).project(camera);
      const behind = _v.z > 1;
      let x = _v.x, y = _v.y;
      if (behind) { x = -x; y = -y; }
      const off = behind || Math.abs(x) > 0.94 || Math.abs(y) > 0.9;
      if (off) { const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86); x /= k; y /= k; if (behind && Math.abs(y) < 0.86) y = -0.86; }
      m.el.classList.toggle('edge', off);
      m.el.style.opacity = m.hidden ? 0 : Math.min(1, Math.max(0.15, (d - m.fadeNear * 0.5) / m.fadeNear)).toFixed(2);
      m.dist.textContent = d > 1000 ? (d / 1000).toFixed(1) + ' KM' : Math.round(d) + ' M';
      const rot = off ? Math.atan2(x, y) * 180 / Math.PI : 0;
      m.el.style.transform = `translate(${(x * 0.5 + 0.5) * W}px, ${(-y * 0.5 + 0.5) * H}px) translate(-50%, -100%)`;
      if (off) m.el.querySelector('.arrow').style.transform = `rotate(${rot}deg)`;
    }
  }
  dispose() { this.root.remove(); this.prompts.clear(); this.markers.clear(); }
}
