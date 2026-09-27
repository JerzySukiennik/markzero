// Loading: the city builds itself as the world streams in — the dot map's reveal radius IS the progress,
// so the screen is visibly alive from the first frame. A big percentage, a thin bar, who you're flying as,
// one tip that follows your bindings. No hint bar (nothing to press here).
import { Screen } from '../lib/app.js';
import { h } from '../lib/dom.js';
import { DotMap } from '../lib/dotmap.js';

const TIPS = {
  ironman: [['boost', 'Hold {b} for supersonic boost'], ['descend', 'Hold {b} to drop while the left stick keeps your speed'], ['rep_r', 'Hold {b} to charge a bigger repulsor shot'], [null, 'Turn around and thrust — the brake is physics, not a button']],
  spiderman: [['swing', 'Everything that moves you is on {b}'], ['web_r', 'Aim at Iron Man and hold {b} to ride the suit'], ['reel_in', 'Hold {b} to reel in the line'], ['dodge', '{b} dodges — pull back for a backflip']],
};
const SPAWN = { ironman: [1449, 1720], spiderman: [-566, 652] };

export class LoadingScreen extends Screen {
  static id = 'loading';
  static opts = { context: 'ui', bg: true, overlay: false };
  build() {
    const MZ = this.MZ, hero = MZ.game.hero || 'ironman', suit = MZ.SUITS.find(s => s.id === MZ.game.suit);
    this.hero = hero;
    this.el.classList.add('loading');
    const [act, txt] = TIPS[hero][Math.floor(Math.random() * TIPS[hero].length)];
    this.el.append(
      h('div.ld-who', h('b', hero === 'spiderman' ? 'Spider-Man' : 'Iron Man'), h('span', suit?.name || '')),
      h('div.ld-bottom',
        this.pctEl = h('div.ld-pct', '0'),
        h('div.ld-bar', this.fill = h('i')),
        h('div.ld-tip', { html: txt.replace('{b}', act ? this.ui.p(act, hero) : '') }),
      ),
    );
    this.listen('game:loading', e => { this.p = Math.max(this.p, e.progress || 0); });
    this.p = 0; this.shown = 0; this.t0 = performance.now();
    this.map = new DotMap(MZ, { res: 16, auto: 0.03, vexag: 1.4, pitch: 30 });
    this.map.viewH = 2600;
    this.map.init().then(m => {
      if (this.dead) return;
      const [x, z] = SPAWN[hero]; m.lookAt(x * 0.55, z * 0.55, true); m.reveal(x, z); m.revealSpeed = 0; m.revealT = 180; m.scanEvery = 1e9; m.U.uFocusR.value = 2400;
      m.setBeacons([{ x, z, h: 520, kind: 0, color: MZ.theme.c.accent.clone() }]);
      m.layer = MZ.stage.addLayer({ scene: m.scene, camera: m.camera, order: 20 });
      m.layer.visible = this.ui.top === this;
    });
  }
  update(dt, t) {
    // honest progress, plus a slow creep during silent stretches so it never looks frozen (capped below the real next step)
    const age = (performance.now() - this.t0) / 1000;
    const creep = Math.min(this.p + 0.08, 0.9 * (1 - Math.exp(-age / 6)));
    const target = Math.max(this.p, Math.min(creep, 0.97));
    this.shown += (target - this.shown) * (1 - Math.exp(-5 * dt));
    this.fill.style.transform = `scaleX(${this.shown.toFixed(4)})`;
    const pct = Math.round(this.shown * 100); if (pct !== this._pct) { this._pct = pct; this.pctEl.textContent = pct; }
    const m = this.map; if (m?.ready) { m.resize(innerWidth, innerHeight); m.revealT = Math.max(m.revealT, 180 + this.shown * 3400); m.update(dt, t); }
  }
  destroy() { super.destroy(); this.dead = true; this.map?.destroy(); }
  onPress() { return true; }
  onBack() { }
  hints() { return []; }
}
