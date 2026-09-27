// Tiny DOM helpers. h('div.a.b#id', {attrs}, ...children) — children may be strings (HTML), nodes or arrays.
export function h(tag, attrs, ...kids) {
  if (attrs && (attrs instanceof Node || typeof attrs === 'string' || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m?.[1] || 'div');
  for (const p of (m?.[2] || '').match(/[.#][\w-]+/g) || []) { if (p[0] === '.') el.classList.add(p.slice(1)); else el.id = p.slice(1); }
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) if (sv != null) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('--')) el.style.setProperty(k, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.insertAdjacentHTML('beforeend', String(k));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
export const pad = (n, w = 2, c = '0') => String(Math.round(n)).padStart(w, c);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const wait = ms => new Promise(r => setTimeout(r, ms));
/** Split a string into per-letter spans (for staggered reveals / scramble). */
export function letters(str, cls = 'ch') { return [...str].map((c, i) => `<span class="${cls}" style="--i:${i}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join(''); }
/** Text scramble ("decode") effect — letters settle left to right. */
export function scramble(el, text, ms = 520) {
  const glyphs = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789/<>-=+';
  const t0 = performance.now(); el._scr = t0;
  const step = now => {
    if (el._scr !== t0) return;
    const k = Math.min(1, (now - t0) / ms), n = Math.floor(k * text.length);
    let s = text.slice(0, n);
    for (let i = n; i < text.length; i++) s += text[i] === ' ' ? ' ' : glyphs[(Math.random() * glyphs.length) | 0];
    el.textContent = s;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
