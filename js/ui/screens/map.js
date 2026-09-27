// Full-screen map (touchpad on DS4 / View on Xbox, or from the menus): the isometric dot city, every point
// of interest as a flat icon standing on a thin stem over the map (Marvel's Spider-Man style — "3D but 2D"),
// a cursor in the middle of the screen that the left stick drives, ✕ places the waypoint (the HUD then
// shows it in the world), □ pings for the co-op partner, L1/R1 turn the city 90°, L2/R2 zoom, ○ closes.
import { Screen } from '../lib/app.js';
import { h, esc } from '../lib/dom.js';
import { DotMap } from '../lib/dotmap.js';

// flat pictograms (24×24, drawn in currentColor)
const ICON = {
  ironman: '<path d="M12 3c-4 0-6.5 2.6-6.5 6.6 0 4 1.6 7.6 3.4 10.1.4.6 1 .9 1.7.9h2.8c.7 0 1.3-.3 1.7-.9 1.8-2.5 3.4-6.1 3.4-10.1C18.5 5.6 16 3 12 3Zm-4 8.2 3.2.6-.3 1.4-3.1-.3Zm8 0-.2 1.7-3.1.3-.3-1.4Z" fill="currentColor"/>',
  spider: '<g stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"><path d="M12 8v9M9 9 5 5M15 9l4-4M8.5 12H4M15.5 12H20M9 15l-4 4M15 15l4 4"/></g><ellipse cx="12" cy="12.5" rx="2.6" ry="4" fill="currentColor"/>',
  tower: '<path d="M10.5 3h3l.8 4h-4.6ZM9.5 8h5l1 13h-7Z" fill="currentColor"/>',
  pad: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 8v8M15 8v8M9 12h6" stroke="currentColor" stroke-width="2"/>',
  player: '<path d="M12 4 19 19l-7-3.5L5 19Z" fill="currentColor"/>',
  waypoint: '<path d="M12 3 20 12 12 21 4 12Z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 8 16 12 12 16 8 12Z" fill="currentColor"/>',
  ping: '<circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  main: '<path d="M12 4 14.3 9.4 20 9.9 15.6 13.6 17 19.3 12 16.2 7 19.3 8.4 13.6 4 9.9 9.7 9.4Z" fill="currentColor"/>',
  objective: '<circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
};
const heroName = h => h === 'spiderman' ? 'Spider-Man' : 'Iron Man';

export class MapScreen extends Screen {
  static id = 'map';
  static opts = { context: 'ui', bg: true, overlay: false };
  build() {
    this.el.classList.add('mapscr', 'wait');
    this.bgReady = false;               // backdrop + page appear together with the city, never before it
    this.el.append(
      this.labelsEl = h('div.mp-icons'),
      h('div.mp-cursor', h('i')),
      this.infoEl = h('div.mp-info', this.infoName = h('b'), this.infoSub = h('span')),
      this.northEl = h('div.mp-north', { html: '<svg viewBox="-12 -12 24 24"><path d="M0 -9 5 6 0 3 -5 6Z"/></svg><span>N</span>' }),
    );
    this.icons = new Map();
    // voxel look by default; the JUICE.md two-pass dot-matrix look is an A/B option (?dotmatrix=1) — in
    // side-by-side shots it lost the tower silhouettes in lattice noise (docs/ui/LOG.md 07)
    this.map = new DotMap(this.MZ, { res: 16, vexag: 1.3, matrix: this.MZ.params.get('dotmatrix') === '1', dot: 5 });
    this.map.viewH = 3000; this.map.scanEvery = 1e9;
    this.map.init().then(m => {
      if (this.dead) return;
      const me = this.me(), wp = this.ui.state.waypoint;
      m.lookAt(wp ? wp.x : me ? me.x : 0, wp ? wp.z : me ? me.z : 200, true); m.reveal(m.target.x, m.target.z); m.revealSpeed = 3200;
      m.attach(this.MZ.stage, { order: 20 });
      m.layer.visible = this.ui.top === this;
      this.bgReady = true; this.el.classList.remove('wait');
      if (this.ui.top === this) this.ui.backdrop.show(true);
    });
  }
  me() { return this.MZ.game.mapState?.()?.players?.find(p => p.you) || null; }
  update(dt, t) {
    const m = this.map; if (!m?.ready) return;
    const MZ = this.MZ, ax = MZ.input.axes || {};
    // the cursor stays in the middle; the stick moves the city under it (faster when zoomed out)
    const lx = ax.lx || 0, ly = ax.ly || 0;
    if (Math.hypot(lx, ly) > 0.05) m.panScreen(lx * dt * 0.75, -ly * dt * 0.75);
    const ry = ax.ry || 0; if (Math.abs(ry) > 0.2) m.setZoom(m.zoomGoal * Math.exp(-ry * dt * 1.1));
    const l2 = MZ.input.value?.('l2') || 0, r2 = MZ.input.value?.('r2') || 0;
    if (l2 > 0.1 || r2 > 0.1) m.setZoom(m.zoomGoal * Math.exp((r2 - l2) * dt * 1.1));
    m.resize(innerWidth, innerHeight);
    const wp = this.ui.state.waypoint;
    m.setBeacons(wp ? [{ x: wp.x, z: wp.z, h: 1, kind: 2, color: MZ.theme.c.accent }] : []);   // just the ground ring under the pin
    m.update(dt, t);
    this.iconsUpdate(m);
    this.northEl.style.transform = `rotate(${(m.yaw * 180 / Math.PI).toFixed(1)}deg)`;
  }
  pois() {
    const MZ = this.MZ, ms = MZ.game.mapState?.() || { players: [], pois: [] }, T = MZ.theme, out = [];
    for (const q of ms.pois || []) {
      if (q.kind === 'base') out.push({ key: q.id, x: q.x, z: q.z, y: 260, icon: q.hero === 'ironman' ? 'ironman' : 'spider', color: q.hero === 'ironman' ? T.get('mk85')?.accent : T.get('ironspider')?.glow, name: q.name, sub: 'Base' });
      else if (q.kind === 'landmark' && q.priority <= 1 && !/— 3|— 391/.test(q.name)) out.push({ key: q.id, x: q.x, z: q.z, y: Math.min(q.y, 420), icon: 'tower', color: null, name: q.name.replace(/ — .*/, ''), sub: `${Math.round(q.y)} m`, small: true });
      else if (q.kind === 'pad') out.push({ key: q.id, x: q.x, z: q.z, y: 120, icon: 'pad', color: null, name: q.name, sub: '', small: true });
    }
    for (const p of ms.players || []) out.push({ key: 'pl_' + p.id, x: p.x, z: p.z, y: Math.max(40, p.y || 0), icon: 'player', color: T.get(p.suit)?.accent, name: p.you ? 'You' : p.name, sub: `${heroName(p.hero)} · ${MZ.SUITS.find(s => s.id === p.suit)?.name || ''}`, rot: p.heading || 0, you: p.you });
    // story missions (MZ.story.markers()): main story = the big filled badge, objectives = outlined, bases = base icon
    let story = []; try { story = MZ.story?.markers?.() || []; } catch { }    // a story bug must never kill the map
    for (const k of story) {
      if (k.kind === 'base') continue;                 // bases already come from poi.json
      out.push({ key: 'st_' + (k.id || k.x + ',' + k.z), x: k.x, z: k.z, y: Math.max(160, (k.y || 0) + 120), icon: k.kind === 'main' ? 'main' : 'objective', color: T.get(MZ.theme.id)?.accent, name: k.title || 'Objective', sub: k.kind === 'main' ? 'Story' : 'Objective', mission: k.kind });
    }
    for (const q of (ms.pings || []).slice(-3)) out.push({ key: 'ping_' + q.x + q.z, x: q.x, z: q.z, y: 60, icon: 'ping', color: T.get(MZ.theme.id)?.glow, name: 'Ping', sub: '' });
    const wp = this.ui.state.waypoint; if (wp) out.push({ key: 'wp', x: wp.x, z: wp.z, y: 140, icon: 'waypoint', color: T.get(MZ.theme.id)?.accent, name: 'Waypoint', sub: '' });
    return out;
  }
  iconsUpdate(m) {
    const W = innerWidth, H = innerHeight, top = {}, gnd = {}, cx = W / 2, cy = H / 2;
    const list = this.pois(), seen = new Set(), me = this.me();
    let sel = null, bd = 56;
    for (const p of list) {
      m.project(p.x, p.y, p.z, W, H, top); m.project(p.x, 0, p.z, W, H, gnd);
      const d = Math.hypot(top.x - cx, top.y - cy); if (d < bd) { bd = d; sel = p; }
      p.sx = top.x; p.sy = top.y; p.gy = gnd.y;
    }
    for (const p of list) {
      seen.add(p.key);
      let e = this.icons.get(p.key);
      if (!e) {
        e = h(`div.mp-ic${p.small ? '.small' : ''}${p.you ? '.you' : ''}${p.mission ? '.m-' + p.mission : ''}`, { html: `<i class="stem"></i><span class="badge"><svg viewBox="0 0 24 24">${ICON[p.icon]}</svg></span><em></em>` });
        this.labelsEl.appendChild(e); this.icons.set(p.key, e);
      }
      if (p.color) e.style.setProperty('--ic', p.color);
      const vis = p.sx > -60 && p.sx < W + 60 && p.sy > -60 && p.sy < H + 60;
      e.style.opacity = vis ? '' : 0;
      e.style.transform = `translate(${p.sx.toFixed(1)}px, ${p.sy.toFixed(1)}px)`;
      e.querySelector('.stem').style.height = Math.max(0, p.gy - p.sy).toFixed(1) + 'px';
      if (p.icon === 'player') e.querySelector('svg').style.transform = `rotate(${(p.rot + m.yaw * 180 / Math.PI).toFixed(1)}deg)`;
      e.classList.toggle('sel', p === sel);
      const lab = p === sel ? p.name : ''; if (e._lab !== lab) { e._lab = lab; e.querySelector('em').textContent = lab; }
    }
    for (const [k, e] of this.icons) if (!seen.has(k)) { e.remove(); this.icons.delete(k); }
    // what's under the cursor: name + distance from you (or the district, when it's open city)
    const tx = sel ? sel.x : m.target.x, tz = sel ? sel.z : m.target.z;
    const name = sel ? sel.name : this.district(tx, tz);
    const dist = me ? Math.hypot(tx - me.x, tz - me.z) : null;
    const sub = [sel?.sub, dist != null && !(sel?.you) ? (dist < 1000 ? `${Math.round(dist)} m away` : `${(dist / 1000).toFixed(1)} km away`) : ''].filter(Boolean).join(' · ');
    const k = name + sub; if (k !== this._ik) { this._ik = k; this.infoName.textContent = name; this.infoSub.textContent = sub; if (sel && sel !== this._sel) this.ui.sfx('ui_tick', { gain: 0.5 }); this._sel = sel; }
  }
  district(x, z) {
    let best = null, bd = 1e9;
    for (const q of this.MZ.game.mapState?.()?.pois || []) if (q.kind === 'district') { const d = Math.hypot(q.x - x, q.z - z); if (d < bd) { bd = d; best = q.name; } }
    return best && bd < 900 ? best.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : 'The river';
  }
  onPress(id) {
    const m = this.map, MZ = this.MZ, ui = this.ui;
    if (!m?.ready) return id !== 'east';
    if (id === 'l1' || id === 'r1') { m.rotate(id === 'r1' ? 1 : -1); ui.sfx('ui_tab'); ui.buzz('ui_tab'); return true; }
    if (id === 'south') {
      const wp = ui.state.waypoint, x = m.target.x, z = m.target.z;
      const clear = wp && Math.hypot(wp.x - x, wp.z - z) < 80;
      ui.state.waypoint = clear ? null : { x, z };
      MZ.game.waypoint?.(clear ? null : x, clear ? null : z);
      ui.sfx(clear ? 'ui_back' : 'ui_confirm'); ui.buzz(clear ? 'ui_back' : 'ui_confirm');
      ui.renderHints(true);
      return true;
    }
    if (id === 'west') { MZ.game.ping?.(m.target.x, m.target.z); ui.sfx('ui_map_ping'); ui.buzz('ui_map_ping'); return true; }
    if (id === 'touchpad' || id === 'select') { ui.sfx('ui_back'); ui.back(); return true; }
    if (['up', 'down', 'left', 'right'].includes(id)) { const k = 0.06; m.panScreen(id === 'left' ? -k : id === 'right' ? k : 0, id === 'up' ? k : id === 'down' ? -k : 0); return true; }
    return false;
  }
  onNav() { return true; }
  onWheel(e) { this.map?.setZoom(this.map.zoomGoal * Math.exp(-e.deltaY * 0.0015)); }
  enter() { if (this.map?.layer) this.map.layer.visible = true; this.ui.sfx('ui_map_open'); this.ui.buzz('ui_map_open'); }
  leave() { if (this.map?.layer) this.map.layer.visible = false; this.ui.sfx('ui_map_close'); }
  destroy() { super.destroy(); this.dead = true; this.map?.destroy(); }
  hints() {
    const wp = this.ui.state.waypoint;
    return [{ btn: 'ls', label: 'Move' }, { btns: ['l1', 'r1'], label: 'Turn' }, { btns: ['l2', 'r2'], label: 'Zoom' }, { btn: 'south', label: wp ? 'Move waypoint' : 'Waypoint' }, { btn: 'west', label: 'Ping' }, { btn: 'east', label: 'Close' }];
  }
}
