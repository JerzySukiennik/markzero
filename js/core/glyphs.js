// Button glyphs for PlayStation and Xbox pads, as inline SVG (crisp at any size, tinted by
// currentColor). Canonical button ids follow the W3C "standard" gamepad layout by POSITION:
//   south east west north  l1 r1 l2 r2  select start  l3 r3  up down left right  home touchpad
// plus pseudo-inputs for sticks: ls rs (and ls_x, ls_y, rs_x, rs_y for directions).
const PS_FACE = {
  south: '<path d="M7 7 L17 17 M17 7 L7 17" stroke="#9fb6ff" stroke-width="2.2" stroke-linecap="round"/>',
  east: '<circle cx="12" cy="12" r="5.2" fill="none" stroke="#ff7a8a" stroke-width="2.2"/>',
  west: '<rect x="7" y="7" width="10" height="10" fill="none" stroke="#f3a6ff" stroke-width="2.2"/>',
  north: '<path d="M12 6.5 L18 16.5 H6 Z" fill="none" stroke="#6fe3c1" stroke-width="2.2" stroke-linejoin="round"/>',
};
const XB_FACE = { south: ['A', '#6cc24a'], east: ['B', '#e5484d'], west: ['X', '#3e8ed0'], north: ['Y', '#f5c518'] };
const LABELS = {
  ps: { l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', l3: 'L3', r3: 'R3', select: 'SHARE', start: 'OPTIONS', home: 'PS', touchpad: 'PAD', ls: 'L', rs: 'R' },
  xbox: { l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', l3: 'LS', r3: 'RS', select: 'VIEW', start: 'MENU', home: 'XBOX', touchpad: 'VIEW', ls: 'L', rs: 'R' },
};
export const NAMES = {
  ps: { south: 'Cross', east: 'Circle', west: 'Square', north: 'Triangle', up: 'D-pad up', down: 'D-pad down', left: 'D-pad left', right: 'D-pad right' },
  xbox: { south: 'A', east: 'B', west: 'X', north: 'Y', up: 'D-pad up', down: 'D-pad down', left: 'D-pad left', right: 'D-pad right' },
};

const ring = inner => `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.35)" stroke="currentColor" stroke-opacity=".55" stroke-width="1.2"/>${inner}</svg>`;
const pill = (txt, w = 30) => `<svg viewBox="0 0 ${w} 24"><rect x="0.6" y="2.6" width="${w - 1.2}" height="18.8" rx="${txt.length > 2 ? 4 : 9.4}" fill="rgba(0,0,0,.35)" stroke="currentColor" stroke-opacity=".55" stroke-width="1.2"/><text x="${w / 2}" y="16.2" text-anchor="middle" font-family="JB Mono, monospace" font-size="${txt.length > 3 ? 7.4 : 9.5}" font-weight="700" fill="currentColor">${txt}</text></svg>`;
const dpad = dir => {
  const arm = { up: 'M9.5 3h5v6.5h-5z', down: 'M9.5 14.5h5V21h-5z', left: 'M3 9.5h6.5v5H3z', right: 'M14.5 9.5H21v5h-6.5z' };
  return `<svg viewBox="0 0 24 24">${Object.entries(arm).map(([k, d]) => `<path d="${d}" fill="${k === dir ? 'currentColor' : 'rgba(255,255,255,.18)'}"/>`).join('')}<rect x="9.5" y="9.5" width="5" height="5" fill="rgba(255,255,255,.18)"/></svg>`;
};
const stick = (txt, dir) => {
  const arrows = { x: '<path d="M3.5 12l2.5-2v4zM20.5 12l-2.5-2v4z" fill="currentColor"/>', y: '<path d="M12 3.5l-2 2.5h4zM12 20.5l-2-2.5h4z" fill="currentColor"/>' }[dir] || '';
  return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.35)" stroke="currentColor" stroke-opacity=".55" stroke-width="1.2"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-opacity=".8" stroke-width="1.2"/><text x="12" y="15" text-anchor="middle" font-family="JB Mono, monospace" font-size="8" font-weight="700" fill="currentColor">${txt}</text>${arrows}</svg>`;
};

/** SVG markup for a button id on a pad family ('ps' | 'xbox'). */
export function glyphSVG(id, family = 'ps') {
  if (PS_FACE[id]) {
    if (family === 'xbox') { const [t, c] = XB_FACE[id]; return ring(`<text x="12" y="16.3" text-anchor="middle" font-family="Barlow C, sans-serif" font-size="12.5" font-weight="600" fill="${c}">${t}</text>`); }
    return ring(PS_FACE[id]);
  }
  if (['up', 'down', 'left', 'right'].includes(id)) return dpad(id);
  if (/^[lr]s(_[xy])?$/.test(id)) return stick(LABELS[family][id.slice(0, 2)], id.split('_')[1]);
  if (id === 'dpad') return dpad('');
  const L = LABELS[family][id] || id.toUpperCase();
  return pill(L, L.length > 3 ? 38 : 30);
}
export function glyphHTML(id, family) { return `<span class="glyph" data-g="${id}" style="${/^(l1|r1|l2|r2|select|start|home|touchpad|l3|r3)$/.test(id) ? 'width:calc(var(--u)*' + ((LABELS[family]?.[id] || id).length > 3 ? 2.1 : 1.7) + ')' : ''}">${glyphSVG(id, family)}</span>`; }
export function buttonName(id, family = 'ps') { return NAMES[family][id] || LABELS[family][id] || id; }
