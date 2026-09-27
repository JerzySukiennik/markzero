// Settings: one calm list. Controls and Haptics open their own pages; the rest changes in place with ←/→.
// Audio buses go straight to the mixer (persisted by core/audio.js), haptic strength to core/haptics.js,
// camera + accessibility to the UI settings (localStorage 'mz3.ui', broadcast as MZ.emit('ui:settings')).
import { Screen } from '../lib/app.js';
import { h } from '../lib/dom.js';
import { header, slider, choice, toggle, link } from '../lib/rows.js';

export class SettingsScreen extends Screen {
  static id = 'settings';
  static opts = { context: 'ui', bg: true, overlay: false };
  build() {
    const MZ = this.MZ, ui = this.ui, S = ui.settings, A = MZ.audio, Hp = MZ.haptics;
    this.el.classList.add('settings');
    const save = () => { ui.applySettings(); MZ.emit('ui:settings', { ...S }); };
    const bus = (k, label) => slider(ui, label, () => A.levels?.[k] ?? 1, v => A.setLevel(k, v));
    this.el.append(
      h('div.pg-title', 'Settings'),
      this.list = h('div.pg-list', { 'data-wrap': '' },
        link('Controls', 'Every button, remap', () => ui.go('controls')),
        link('Haptics', 'Feel every rumble', () => ui.go('haptics')),
        header('Audio'),
        bus('master', 'Master'), bus('music', 'Music'), bus('sfx', 'Effects'), bus('ui', 'Interface'), bus('voice', 'Voice'),
        header('Rumble'),
        toggle(ui, 'Rumble', () => Hp.enabled !== false, v => { Hp.enabled = v; Hp.save?.(); if (v) ui.buzz('ui_confirm'); }),
        slider(ui, 'Strength', () => Hp.master ?? 1, v => { Hp.master = v; Hp.save?.(); ui.buzz('ui_confirm'); }, { min: 0, max: 1.5 }),
        header('Camera'),
        toggle(ui, 'Invert look', () => S.invertY, v => { S.invertY = v; save(); }),
        slider(ui, 'Look speed', () => S.lookSens, v => { S.lookSens = v; save(); }, { min: 0.3, max: 2, step: 0.1, fmt: v => v.toFixed(1) + '×' }),
        slider(ui, 'Camera shake', () => S.camShake, v => { S.camShake = v; save(); }),
        slider(ui, 'Field of view', () => S.fov, v => { S.fov = v; save(); }, { min: 60, max: 90, step: 5, fmt: v => Math.round(v) + '°' }),
        header('Accessibility'),
        choice(ui, 'Text size', [[0.9, 'Small'], [1, 'Normal'], [1.15, 'Large'], [1.3, 'Largest']], () => S.textScale, v => { S.textScale = v; save(); }),
        choice(ui, 'Colour vision', [['none', 'Standard'], ['protan', 'Protanopia'], ['deutan', 'Deuteranopia'], ['tritan', 'Tritanopia']], () => S.cvd, v => { S.cvd = v; save(); }),
        toggle(ui, 'Reduce motion', () => S.reduceMotion, v => { S.reduceMotion = v; save(); }),
        slider(ui, 'HUD opacity', () => S.hudOpacity, v => { S.hudOpacity = v; save(); }, { min: 0.3, max: 1 }),
      ),
    );
  }
  onNav(dir) { const f = this.focused; if ((dir === 'left' || dir === 'right') && f?._step) { f._step(dir === 'right' ? 1 : -1); return true; } return false; }
  hints() { const f = this.focused; return f?._step ? [{ btn: 'dpad', label: 'Change' }, { btn: 'east', label: 'Back' }] : [{ btn: 'south', label: 'Open' }, { btn: 'east', label: 'Back' }]; }
  onFocus() { this.ui.renderHints(); }
}
