// Title: the city as an isometric dot map is the hero — full-bleed, camera low enough that the towers
// have silhouette, turning slowly. A wordmark and five words of menu. Nothing else.
// First visit shows "Press ✕" (browsers need one input before audio can play); the city rises once.
import { Screen } from '../lib/app.js';
import { h } from '../lib/dom.js';
import { DotMap } from '../lib/dotmap.js';

export class TitleScreen extends Screen {
  static id = 'title';
  static opts = { context: 'ui', bg: true, overlay: false };
  build() {
    const ui = this.ui, MZ = this.MZ;
    this.attract = !this.params.skipAttract && !TitleScreen.seen;
    this.el.classList.add('title');
    this.el.append(
      h('h1.t-word', h('span.w1', 'Mark'), h('span.w2', 'Zero')),
      // the static web build (window.MZ_STATIC, markzero.gzowo.fun) has no room service yet: Play = solo
      this.menu = h('nav.t-menu', { 'data-wrap': '' },
        window.MZ_STATIC
          ? this.item('Play', 'Choose a hero and fly — online co-op is coming soon', () => ui.go('hero', { next: 'solo' }), 'default')
          : [this.item('Play', 'Choose a hero, open a room for a friend', () => ui.go('hero', { next: 'rooms' }), 'default'),
            this.item('Join', 'Enter a friend’s room code', () => ui.go('rooms', { mode: 'join' })),
            this.item('Solo', 'Straight into the city', () => ui.go('hero', { next: 'solo' }))],
        this.item('Map', 'The city, dot by dot', () => ui.go('map', { preview: true })),
        this.item('Settings', 'Controls, haptics, audio, camera', () => ui.go('settings')),
      ),
      this.press = h('div.t-press', { html: `Press ${ui.g('south')}` }),
    );
    this.el.classList.toggle('attract', this.attract);
    this.map = new DotMap(MZ, { res: 16, auto: 0.018, vexag: 1.5, pitch: 24, beaconWidth: 3 });
    this.map.viewH = 2500; this.map.centerX = 0.64;
    this.map.init().then(m => {
      if (this.dead) return;
      m.lookAt(80, 80, true); m.yaw = m.yawGoal = 0.72; m.U.uFocusR.value = 2300; m.scanEvery = 1e9;
      if (!TitleScreen.revealed) { m.reveal(80, 80); m.revealSpeed = 1500; TitleScreen.revealed = true; } else m.reveal(0, 0, true);
      m.layer = MZ.stage.addLayer({ scene: m.scene, camera: m.camera, order: 20 });
      m.layer.visible = this.ui.top === this;
      this.syncBeacons();
    });
    this.listen('suit:change', () => this.syncBeacons());
  }
  item(k, s, act, cls = '') {
    const el = h(`div.item.t-item${cls ? '.' + cls : ''}`, { 'data-f': '' }, h('span.k', k), h('span.s', s));
    el._act = act; return el;
  }
  syncBeacons() {
    const m = this.map; if (!m?.ready) return;
    const pal = id => this.MZ.theme.palette(id);
    // just the two homes: where Iron Man and Spider-Man start
    m.setBeacons([{ x: 1444, z: 1723, h: 420, kind: 0, color: pal('mk85').accent }, { x: -573, z: 662, h: 360, kind: 0, color: pal('ironspider').glow }]);
  }
  enter() { if (this.map?.layer) this.map.layer.visible = true; }
  leave() { if (this.map?.layer) this.map.layer.visible = false; }
  destroy() { super.destroy(); this.dead = true; this.map?.destroy(); }
  update(dt, t) { this.map?.resize(innerWidth, innerHeight); this.map?.update(dt, t); }
  start() {
    TitleScreen.seen = true; this.attract = false;
    this.el.classList.remove('attract');
    this.ui.sfx('ui_confirm'); this.ui.buzz('ui_confirm');
    this.ui.focus(this.menu.querySelector('.default'), { sound: false });
    this.ui.renderHints(true);
  }
  onPress(id) {
    if (this.attract) { if (id === 'south' || id === 'start') this.start(); return true; }
    return false;
  }
  onNav() { return this.attract; }
  onBack() { }                                   // nothing behind the title
  hints() { return this.attract ? [] : [{ btn: 'south', label: 'Select' }]; }
  defaultFocus() { return this.menu?.querySelector('.default'); }
}
