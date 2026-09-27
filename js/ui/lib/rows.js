// Settings rows for pad input: slider (←/→ steps), choice (←/→ cycles), toggle (✕ or ←/→), link (✕ opens).
// Each row is a focusable .row; screens forward onNav('left'|'right') to row._step(±1).
import { h, clamp } from './dom.js';

export function header(text) { return h('div.row-h', text); }

export function slider(ui, label, get, set, { min = 0, max = 1, step = 0.1, fmt = v => Math.round(v * 100) + '%' } = {}) {
  const val = h('span.row-v'), fill = h('i');
  const el = h('div.row.item', { 'data-f': '', 'data-silent': '1' }, h('span.row-k', label), h('span.row-bar', fill), val);
  const draw = () => { const v = get(); fill.style.transform = `scaleX(${((v - min) / (max - min)).toFixed(3)})`; val.textContent = fmt(v); };
  el._step = d => { const v = clamp(Math.round((get() + d * step) / step) * step, min, max); if (v === get()) { ui.buzz('ui_tick', 0.4); return; } set(+v.toFixed(4)); draw(); ui.sfx('ui_tick'); ui.buzz('ui_tick'); };
  el._act = () => el._step(1);
  draw(); el._draw = draw;
  return el;
}

export function choice(ui, label, options, get, set) {
  const val = h('span.row-v');
  const el = h('div.row.item', { 'data-f': '', 'data-silent': '1' }, h('span.row-k', label), h('span.row-c', h('b.l', '‹'), val, h('b.r', '›')));
  const draw = () => { val.textContent = (options.find(o => o[0] === get()) || options[0])[1]; };
  el._step = d => { const i = options.findIndex(o => o[0] === get()); const n = options[(Math.max(0, i) + d + options.length) % options.length][0]; set(n); draw(); ui.sfx('ui_tab'); ui.buzz('ui_tick'); };
  el._act = () => el._step(1);
  draw(); el._draw = draw;
  return el;
}

export function toggle(ui, label, get, set) {
  return choice(ui, label, [[false, 'Off'], [true, 'On']], get, set);
}

export function link(label, sub, fn) {
  const el = h('div.row.item.link', { 'data-f': '' }, h('span.row-k', label), sub ? h('span.row-v', sub) : null, h('span.row-go', '›'));
  el._act = fn; return el;
}
