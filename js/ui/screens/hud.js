// In-game HUD — V1's JARVIS language kept minimal: a few hairline arcs around the centre, big numbers
// with a unit, words only when a STATE changes (hover, supersonic, line). No minimap (Jurek: no dot ball
// on screen — the map is a full-screen page on the touchpad / View button).
// Iron Man: speed / altitude / thrust arcs, repulsor charge, target lock, heading tape, horizon.
// Spider-Man: speed / height, web tension. Both: damage direction, suit integrity bar, co-op partner,
// context prompts from the live bindings, and the WAYPOINT placed on the map drawn in the world
// (projected with the game camera, clamped to the screen edge when it's behind or off-screen).
import { Screen } from '../lib/app.js';
import { h, esc, clamp, damp } from '../lib/dom.js';
import { preloadGrid } from '../lib/dotmap.js';

const NS = 'http://www.w3.org/2000/svg';
const CX = 960, CY = 540;
const s = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.appendChild(e); return e; };
const rad = d => d * Math.PI / 180;
const pt = (r, a) => [CX + r * Math.cos(rad(a)), CY + r * Math.sin(rad(a))];
const fmtDist = d => d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
function arc(r, a0, a1) { const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(1)} ${y1.toFixed(1)}`; }
function ticks(r, a0, a1, n, len, major = 5) { let d = ''; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, l = i % major === 0 ? len * 1.9 : len; const [x0, y0] = pt(r, a), [x1, y1] = pt(r - l, a); d += `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`; } return d; }

export class HudScreen extends Screen {
  static id = 'hud';
  static opts = { context: 'game', bg: false, overlay: false };
  build() {
    const MZ = this.MZ;
    this.el.classList.add('hud');
    this.hero = MZ.game.hero;
    this.svg = s('svg', { viewBox: '0 0 1920 1080', preserveAspectRatio: 'xMidYMid meet', class: 'hud-svg' });
    this.el.append(this.svg,
      h('div.hud-html',
        this.hpEl = h('div.hud-hp', h('div.hud-hp-bar', ...Array.from({ length: 12 }, () => h('i'))), h('div.hud-hp-t')),
        this.partnerEl = h('div.hud-partner'),
        this.promptEl = h('div.hud-prompts'),
        this.wpEl = h('div.hud-wp', h('i'), h('b')),
        this.objEl = h('div.hud-obj', h('b'), h('span')),
        this.pinsEl = h('div.hud-pins'),
      ));
    this.pins = new Map();
    this.mission = MZ.story?.state?.active ? { id: MZ.story.state.active, title: '' } : null;
    this.listen('story:mission', e => this.onMission(e));
    this.buildSvg();
    preloadGrid(16);                    // the touchpad map then opens without a loading gap
    this.v = { speed: 0, alt: 0, thr: 0, hp: 1, cl: 0, cr: 0, ten: 0, lock: 0 };
    this.el.dataset.hero = this.hero;
    this.listen('suit:change', e => { this.hero = e.hero; this.el.dataset.hero = e.hero; this.renderPrompts(true); });
    this.listen('game:event', e => this.onEvent(e));
    this.listen('fx:kick', e => this.kick(e?.shake ?? 0.5));
  }
  buildSvg() {
    const g = this.svg, defs = s('defs', {}, g);
    const lg = s('linearGradient', { id: 'hdgfade' }, defs);
    for (const [o, a] of [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]) s('stop', { offset: o, 'stop-color': '#fff', 'stop-opacity': a }, lg);
    const mask = s('mask', { id: 'hdgmask' }, defs); s('rect', { x: 700, y: 20, width: 520, height: 80, fill: 'url(#hdgfade)' }, mask);
    // heading tape
    const hd = s('g', { mask: 'url(#hdgmask)' }, g);
    this.hdgStrip = s('g', {}, hd);
    const PX = 7; this.PX = PX;
    for (let d = -360; d <= 720; d += 5) {
      const x = CX + d * PX, major = d % 15 === 0;
      s('line', { x1: x, y1: major ? 60 : 65, x2: x, y2: 71, class: major ? 'dim' : 'faint' }, this.hdgStrip);
      if (major && d % 45 === 0) { const n = ((d % 360) + 360) % 360; const t = s('text', { x, y: 51, class: 't-s', 'text-anchor': 'middle' }, this.hdgStrip); t.textContent = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][n / 45]; }
    }
    s('path', { d: `M${CX - 6} 82 L${CX} 73 L${CX + 6} 82`, class: 'acc-l' }, g);
    // horizon (Iron Man): one broken line that rolls and slides with pitch
    this.ladder = s('g', { class: 'im-only' }, g);
    s('path', { d: `M${CX - 230} ${CY} H${CX - 80} M${CX + 80} ${CY} H${CX + 230}`, class: 'faint' }, this.ladder);
    // left arc: speed · right arc: altitude · bottom: thrust (IM) / tension (SM)
    const R = 318;
    s('path', { d: ticks(R, 150, 210, 12, 6), class: 'faint' }, g);
    this.spdArc = s('path', { d: arc(R + 10, 210, 150), class: 'val', pathLength: 100, 'stroke-dasharray': '0 100' }, g);
    this.spdT = s('text', { x: CX - R - 40, y: CY + 12, class: 't-xl', 'text-anchor': 'end' }, g);
    s('text', { x: CX - R - 40, y: CY + 40, class: 't-s', 'text-anchor': 'end' }, g).textContent = 'M/S';
    s('path', { d: ticks(R, -30, 30, 12, 6), class: 'faint' }, g);
    this.altArc = s('path', { d: arc(R + 10, 30, -30), class: 'val', pathLength: 100, 'stroke-dasharray': '0 100' }, g);
    this.altT = s('text', { x: CX + R + 40, y: CY + 12, class: 't-xl' }, g);
    s('text', { x: CX + R + 40, y: CY + 40, class: 't-s' }, g).textContent = 'M';
    s('path', { d: arc(R - 40, 66, 114), class: 'faint' }, g);
    this.thrArc = s('path', { d: arc(R - 40, 114, 66), class: 'val thick', pathLength: 100, 'stroke-dasharray': '0 100' }, g);
    this.stateT = s('text', { x: CX, y: CY + R + 12, class: 't-m state-t', 'text-anchor': 'middle' }, g);
    // damage wedges
    this.wedges = [0, 1, 2, 3].map(() => s('path', { d: arc(210, -12, 12), class: 'wedge', opacity: 0 }, g));
    // reticle + charge + lock
    const ret = this.ret = s('g', {}, g);
    s('circle', { cx: CX, cy: CY, r: 10, class: 'dim' }, ret);
    s('circle', { cx: CX, cy: CY, r: 1.8, class: 'dot' }, ret);
    this.chL = s('path', { d: arc(44, 110, 250), class: 'val im-only', pathLength: 100, 'stroke-dasharray': '0 100' }, ret);
    this.chR = s('path', { d: arc(44, 70, -70), class: 'val im-only', pathLength: 100, 'stroke-dasharray': '0 100' }, ret);
    this.lock = s('g', {}, ret);
    for (const a of [45, 135, 225, 315]) { const [x, y] = pt(34, a); const sx = Math.sign(Math.cos(rad(a))), sy = Math.sign(Math.sin(rad(a))); s('path', { d: `M${x - sx * 11} ${y} H${x} V${y - sy * 11}`, class: 'acc-l' }, this.lock); }
    this.lockT = s('text', { x: CX + 44, y: CY - 38, class: 't-s acc-t' }, this.lock);
  }
  onEvent(e) {
    if (e.kind === 'hit') { this.el.classList.remove('hit'); void this.el.offsetWidth; this.el.classList.add('hit'); this.kick(0.8); }
    if (e.kind === 'ping') this.ui.sfx('ui_map_ping');
  }
  kick(k) { this.shake = Math.max(this.shake || 0, typeof k === 'number' ? k : 0.5); }
  renderPrompts(force) {
    const list = this.hud?.prompts || [];
    const key = this.MZ.input.family + this.hero + JSON.stringify(list);
    if (!force && key === this._pk) return; this._pk = key;
    this.promptEl.innerHTML = list.map(p => `<div class="hp">${this.ui.p(p.action, this.hero)}<span>${esc(p.text)}</span></div>`).join('');
  }
  onGlyphs() { this.renderPrompts(true); }
  update(dt, t) {
    const MZ = this.MZ, S = this.ui.settings, d = this.hud = MZ.game.hud?.() || {};
    const IM = (d.hero || this.hero) !== 'spiderman', v = this.v;
    this.el.style.setProperty('--hud-op', S.hudOpacity ?? 1);
    v.speed = damp(v.speed, d.speed || 0, 10, dt); v.alt = damp(v.alt, d.alt || 0, 8, dt); v.thr = damp(v.thr, d.throttle || 0, 10, dt); v.hp = damp(v.hp, d.health ?? 1, 6, dt);
    const hdg = ((d.heading || 0) % 360 + 360) % 360;
    this.hdgStrip.setAttribute('transform', `translate(${(-hdg * this.PX).toFixed(1)} 0)`);
    this.ladder.setAttribute('transform', `rotate(${(-(d.roll || 0)).toFixed(2)} ${CX} ${CY}) translate(0 ${((d.pitch || 0) * 9).toFixed(1)})`);
    this.spdArc.setAttribute('stroke-dasharray', `${(clamp(v.speed / (IM ? 340 : 60), 0, 1) * 100).toFixed(1)} 100`);
    this.spdT.textContent = Math.round(v.speed);
    this.altArc.setAttribute('stroke-dasharray', `${(clamp(v.alt / 600, 0, 1) * 100).toFixed(1)} 100`);
    this.altT.textContent = Math.round(v.alt);
    let state = '';
    if (IM) {
      this.thrArc.setAttribute('stroke-dasharray', `${(clamp(v.thr, 0, 1) * 100).toFixed(1)} 100`);
      const bo = typeof d.boost === 'number' ? d.boost : d.boost ? 1 : 0;
      state = bo > 0.5 ? 'SUPERSONIC' : d.hover ? 'HOVER' : '';
      this.el.classList.toggle('boost', bo > 0.5);
    } else {
      v.ten = damp(v.ten, d.web?.attached ? (d.web.tension || 0) : 0, 12, dt);
      this.thrArc.setAttribute('stroke-dasharray', `${(clamp(v.ten, 0, 1) * 100).toFixed(1)} 100`);
      state = d.web?.attached && v.ten > 0.85 ? 'TAUT' : '';
      this.el.classList.remove('boost');
    }
    if (state !== this._state) { this._state = state; this.stateT.textContent = state; }
    const ax = (d.aim?.x || 0) * 960, ay = (d.aim?.y || 0) * 540;
    this.ret.setAttribute('transform', `translate(${ax.toFixed(1)} ${ay.toFixed(1)})`);
    v.cl = damp(v.cl, d.charge?.l || 0, 14, dt); v.cr = damp(v.cr, d.charge?.r || 0, 14, dt);
    this.chL.setAttribute('stroke-dasharray', `${(v.cl * 100).toFixed(1)} 100`); this.chR.setAttribute('stroke-dasharray', `${(v.cr * 100).toFixed(1)} 100`);
    const locked = !!d.aim?.locked; v.lock = damp(v.lock, locked ? 1 : 0, 14, dt);
    this.lock.setAttribute('transform', `translate(${CX} ${CY}) rotate(${((1 - v.lock) * 45).toFixed(1)}) scale(${(1.6 - v.lock * 0.6).toFixed(3)}) translate(${-CX} ${-CY})`);
    this.lock.setAttribute('opacity', v.lock.toFixed(2));
    this.lockT.textContent = locked && d.aim.dist ? `${Math.round(d.aim.dist)} M` : '';
    if (locked && !this._locked) { this.ui.sfx('ui_tick'); this.ui.buzz('ui_tick'); } this._locked = locked;
    const dm = d.damage || [];
    this.wedges.forEach((w, i) => { const x = dm[i]; if (!x) { w.setAttribute('opacity', 0); return; } const a = x.dir - 90; w.setAttribute('d', arc(210, a - 14, a + 14)); w.setAttribute('opacity', Math.max(0, (x.amount ?? 1) * (1 - (x.age || 0) / 1.6)).toFixed(2)); });
    // integrity: a bar; words only when it's critical
    const segs = this.hpEl.querySelectorAll('i'), on = Math.ceil(v.hp * segs.length - 0.001);
    segs.forEach((e, i) => e.classList.toggle('on', i < on));
    this.hpEl.classList.toggle('low', v.hp < 0.25);
    const ht = v.hp < 0.25 ? '⚠ Suit critical' : ''; if (ht !== this._ht) { this._ht = ht; this.hpEl.querySelector('.hud-hp-t').textContent = ht; }
    this.renderPrompts();
    const ms = MZ.game.mapState?.() || { players: [] };
    const me = ms.players.find(p => p.you), mate = ms.players.find(p => !p.you);
    if (mate && me) {
      const dist = Math.hypot(mate.x - me.x, mate.z - me.z), th = MZ.theme.get(mate.suit) || {};
      const k = `${mate.name}|${mate.suit}|${Math.round(dist / 10)}`;
      if (k !== this._mk) { this._mk = k; this.partnerEl.style.setProperty('--pa', th.accent || 'var(--mz-accent)'); this.partnerEl.innerHTML = `<b>${esc(mate.name)}</b><em>${dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km'}</em>`; }
    } else if (this._mk) { this._mk = null; this.partnerEl.innerHTML = ''; }
    this.waypoint(me);
    this.missions(me);
    this.shake = (this.shake || 0) * Math.exp(-7 * dt);
    const sk = this.shake * 6 * (S.camShake ?? 1);
    this.svg.style.transform = sk > 0.05 ? `translate(${(Math.random() - 0.5) * sk}px, ${(Math.random() - 0.5) * sk}px)` : '';
  }
  onMission(e) {
    if (e.state === 'active') { this.mission = { id: e.id, title: e.title || '' }; this.ui.sfx('ui_panel_open'); this.ui.buzz('ui_panel_open'); }
    else if (this.mission?.id === e.id) { this.mission = null; if (e.state === 'done') { this.ui.toast(`${e.title || 'Mission'} complete`); this.ui.sfx('ui_countdown_go'); this.ui.buzz('ui_countdown_go'); } }
  }
  /** Mission HUD: the active objective top-left (title + what to do + distance) and flat pins in the world
   * for story markers of kind main / objective (projected with the game camera, edge-clamped). */
  missions(me) {
    const S = this.MZ.story, cam = this.MZ.game.camera;
    let raw = []; try { raw = S?.markers?.() || []; } catch (e) { if (!this._mkErr) { this._mkErr = 1; console.warn('[hud] story.markers() threw', e); } }
    // main markers always; objectives only the 3 nearest (a fight lists every enemy — no pin storm)
    const dOf = m => m.dist ?? (me ? Math.hypot(m.x - me.x, m.z - me.z) : 0);
    const objs = raw.filter(m => m?.kind === 'objective').sort((a, b) => dOf(a) - dOf(b)).slice(0, 3);
    const list = [...raw.filter(m => m?.kind === 'main'), ...objs];
    const seen = new Set();
    let near = null;
    for (const m of list) {
      const d = m.dist ?? (me ? Math.hypot(m.x - me.x, m.z - me.z) : null);
      if (!near || (d ?? 1e9) < (near.d ?? 1e9)) near = { ...m, d };
      // the story layer (#story) already pins its markers in the world — draw ours only if it doesn't
      if (!cam || document.getElementById('story')) continue;
      const key = m.id || `${m.x},${m.z}`; seen.add(key);
      let el = this.pins.get(key);
      if (!el) { el = h(`div.hud-pin.${m.kind}`, h('i'), h('b')); this.pinsEl.appendChild(el); this.pins.set(key, el); }
      this.place(el, m.x, (m.y ?? 0) + 25, m.z, d);
    }
    for (const [k, el] of this.pins) if (!seen.has(k)) { el.remove(); this.pins.delete(k); }
    const title = this.mission?.title || near?.missionTitle || '';
    const line = near ? `${near.title || 'Objective'}${near.d != null ? ' · ' + fmtDist(near.d) : ''}` : '';
    const k = title + '|' + line;
    if (k !== this._ok) { this._ok = k; this.objEl.querySelector('b').textContent = title; this.objEl.querySelector('span').textContent = line; this.objEl.classList.toggle('on', !!(title || line)); }
  }
  /** Screen-space pin for a world point; off-screen or behind → pinned to the nearest edge. */
  place(el, x, y, z, dist) {
    const cam = this.MZ.game.camera, V = this._wv || (this._wv = new this.MZ.THREE.Vector3());
    V.set(x, y, z).project(cam);
    const W = innerWidth, H = innerHeight, m = 60;
    let sx = (V.x * 0.5 + 0.5) * W, sy = (-V.y * 0.5 + 0.5) * H;
    const behind = V.z > 1;
    if (behind) { sx = V.x > 0 ? m : W - m; sy = H * 0.42; }      // behind you → the side it's on, mid-height (never over the bottom corners)
    const edge = behind || sx < m || sx > W - m || sy < m || sy > H - m;
    el.style.transform = `translate(${clamp(sx, m, W - m).toFixed(0)}px, ${clamp(sy, m, H - m).toFixed(0)}px)`;
    el.classList.toggle('edge', edge);
    const t = dist != null ? fmtDist(dist) : ''; if (el._t !== t) { el._t = t; el.querySelector('b').textContent = t; }
  }
  /** The map's waypoint in the world: projected with the game camera; off-screen/behind → pinned to the edge. */
  waypoint(me) {
    const wp = this.ui.state?.waypoint, cam = this.MZ.game.camera, el = this.wpEl;
    if (!wp || !cam || !me) { el.classList.remove('on'); return; }
    const V = this._wv || (this._wv = new this.MZ.THREE.Vector3());
    V.set(wp.x, (wp.y ?? 0) + 30, wp.z).project(cam);
    const W = innerWidth, H = innerHeight, m = 60;
    let x = (V.x * 0.5 + 0.5) * W, y = (-V.y * 0.5 + 0.5) * H;
    const behind = V.z > 1;
    if (behind) { x = V.x > 0 ? m : W - m; y = H * 0.42; }
    const edge = behind || x < m || x > W - m || y < m || y > H - m;
    x = clamp(x, m, W - m); y = clamp(y, m, H - m);
    el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    el.classList.add('on'); el.classList.toggle('edge', edge);
    const dist = Math.hypot(wp.x - me.x, wp.z - me.z);
    const txt = dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`;
    if (txt !== this._wt) { this._wt = txt; el.querySelector('b').textContent = txt; }
    if (dist < 25 && !this._arrived) { this._arrived = true; this.ui.sfx('ui_confirm'); this.ui.buzz('ui_confirm'); this.ui.toast('Waypoint reached'); this.ui.state.waypoint = null; this.MZ.game.waypoint?.(null, null); }
    else if (dist >= 25) this._arrived = false;
  }
  onPress(id) {
    if (id === 'start') { this.MZ.game.pause?.(true); if (!this.ui.find('pause')) this.ui.go('pause'); this.ui.sfx('ui_open'); return true; }
    if (id === 'touchpad' || id === 'select') { this.ui.go('map', { ingame: true }); return true; }
    return false;
  }
  enter() { this.renderPrompts(true); this.onStoryHud(this.ui.state.storyHud !== false); }
  /** story:hud — hide EVERYTHING (gauges, compass, waypoint, prompts, integrity) during cutscenes / suit-ups. */
  onStoryHud(visible) { this.el.classList.toggle('story-off', !visible); }
  hints() { return []; }
}
