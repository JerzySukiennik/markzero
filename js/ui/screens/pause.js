// Pause: an overlay over the running game (co-op never stops the world). OPTIONS opens it and ONLY it;
// OPTIONS or ○ resumes.
import { Screen } from '../lib/app.js';
import { h, esc } from '../lib/dom.js';

export class PauseScreen extends Screen {
  static id = 'pause';
  static opts = { context: 'ui', bg: false, overlay: true };
  build() {
    const MZ = this.MZ, ui = this.ui, room = MZ.net.room;
    const coop = room && room.players.length > 1;
    this.el.classList.add('pause');
    const it = (k, fn, cls = '') => { const e = h(`div.item${cls ? '.' + cls : ''}`, { 'data-f': '' }, h('span.k', k)); e._act = fn; return e; };
    this.el.append(
      h('div.pz-scrim'),
      h('div.pz-left',
        h('div.pz-title.stag', { '--i': 0 }, 'Paused'),
        h('div.pz-menu.stag', { '--i': 1, 'data-wrap': '' },
          it('Resume', () => this.resume(), 'default'),
          it('Map', () => ui.go('map', { ingame: true })),
          it('Settings', () => ui.go('settings')),
          it(coop ? 'Leave room' : 'Quit to title', () => this.quit()),
        ),
      ),
      coop ? h('div.pz-right.stag', { '--i': 2 },
        h('div.pz-room', 'Room', h('b', esc(room.code))),
        ...room.players.map(p => {
          const th = MZ.theme.get(p.suit) || {};
          return h('div.pz-p', { style: { '--pa': th.accent } }, h('b', esc(p.name)), h('span', esc(MZ.SUITS.find(x => x.id === p.suit)?.name || '')));
        }),
      ) : null,
    );
  }
  resume() { this.MZ.game.pause?.(false); if (this.ui.top === this) this.ui.back(); this.ui.sfx('ui_close'); }
  quit() { this.MZ.game.quit?.(); }
  onPress(id) { if (id === 'start') { this.resume(); return true; } return false; }
  onBack() { this.resume(); }
  hints() { return [{ btn: 'south', label: 'Select' }, { btn: 'east', label: 'Resume' }]; }
}
