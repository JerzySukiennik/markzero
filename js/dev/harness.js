// DEV HARNESS — the platform's own bare-bones front end, mounted only when the product UI
// (web/js/ui/index.js, owned by the UI agent) is absent or broken. It exercises every platform
// feature from the pad: heroes/suits, rooms (host / LAN list / join by code / ready / start), solo,
// the haptics library, bindings, the audio mixer, and an in-game overlay (HUD numbers, pause).
// Deliberately plain; it is a test bench, not the game's UI.
export async function mountHarness(MZ, root) {
  const css = document.createElement('style');
  css.textContent = `
  .hx{position:absolute;left:3vw;top:4vh;width:34vw;font:500 15px/1.35 var(--ui-mono,monospace);color:var(--mz-text);pointer-events:none}
  .hx h1{font:600 42px/1 var(--ui-font,sans-serif);letter-spacing:.06em;margin:0 0 4px;color:var(--mz-text)} .hx h2{font:500 11px/1 var(--ui-mono);letter-spacing:.3em;color:var(--mz-accent);margin:0 0 18px}
  .hx .row{padding:7px 12px;border-left:3px solid transparent;color:var(--mz-dim);display:flex;justify-content:space-between;gap:12px}
  .hx .row.f{border-left-color:var(--mz-accent);color:var(--mz-text);background:color-mix(in srgb,var(--mz-accent) 14%,transparent)}
  .hx .row.off{opacity:.35} .hx .sec{margin:16px 0 6px;font-size:10px;letter-spacing:.3em;color:var(--mz-accent)}
  .hx .info{position:fixed;right:3vw;top:4vh;width:30vw;white-space:pre;font:12px/1.5 var(--ui-mono);color:var(--mz-dim);text-align:right}
  .hx .hud{position:fixed;left:50%;bottom:6vh;transform:translateX(-50%);font:600 22px/1 var(--ui-font);letter-spacing:.12em;color:var(--mz-text);text-shadow:0 0 12px var(--mz-glow);white-space:pre;text-align:center}
  .hx .glyph{width:18px;height:18px}`;
  document.head.appendChild(css);
  const el = document.createElement('div'); el.className = 'hx'; root.appendChild(el);
  let menu = 'main', focus = 0, rows = [], codeEntry = 'AAAA', codePos = 0, heroSel = MZ.game.hero;
  const suitsOf = h => MZ.SUITS.filter(s => s.hero === h);

  function build() {
    const R = [], g = MZ.game, n = MZ.net;
    const row = (label, value, fn, off = false) => R.push({ label, value, fn, off });
    if (g.phase === 'playing' || g.phase === 'loading') { rows = []; return; }
    if (g.phase === 'paused') { row('Resume', '', () => g.pause(false)); row('Quit to menu', '', () => g.quit()); rows = R; return; }
    if (menu === 'main') {
      row('Hero', MZ.HEROES[heroSel].name, () => { heroSel = heroSel === 'ironman' ? 'spiderman' : 'ironman'; g.choose(heroSel, MZ.HEROES[heroSel].defaultSuit); });
      const ss = suitsOf(heroSel), cur = ss.findIndex(s => s.id === g.suit);
      row('Suit', `${ss[cur]?.name || '?'}${ss[cur]?.ready ? '' : ' (not built yet)'}`, () => { const nx = ss[(cur + 1) % ss.length]; g.choose(heroSel, nx.id); MZ.haptics.play('suit_select'); MZ.audio.ui(heroSel === 'ironman' ? 'ui_stinger_ironman' : 'ui_stinger_spider'); });
      row('Solo', '', () => g.solo(heroSel, g.suit));
      row('Host room', '', () => n.host({ hero: heroSel, suit: g.suit }), n.status !== 'online');
      row('Rooms on this network', `${n.rooms.length}`, () => { n.list(); menu = 'rooms'; focus = 0; }, n.status !== 'online');
      row('Join by code', '', () => { menu = 'code'; }, n.status !== 'online');
      row('Haptics test', '', () => { menu = 'haptics'; focus = 0; });
      row('Controls', '', () => { menu = 'controls'; focus = 0; });
      row('Audio mixer', '', () => { menu = 'mixer'; focus = 0; });
    } else if (menu === 'rooms') {
      if (!n.rooms.length) row('(no open rooms)', '', null, true);
      for (const r of n.rooms) row(`${r.code} · ${r.name}`, r.players.map(p => p.hero === 'ironman' ? 'IM' : 'SM').join(' '), () => n.join(r.code, { hero: heroSel, suit: g.suit }));
    } else if (menu === 'code') {
      row('Code', codeEntry.split('').map((c, i) => i === codePos ? `[${c}]` : c).join(' '), null);
      row('Join', '', () => n.join(codeEntry, { hero: heroSel, suit: g.suit }));
    } else if (menu === 'room') {
      const r = n.room; if (!r) { menu = 'main'; return build(); }
      for (const p of r.players) row(`${p.name}${p.id === n.id ? ' (you)' : ''}${p.host ? ' ★' : ''}`, `${MZ.HEROES[p.hero].name} · ${p.suit || '-'} · ${p.ready ? 'READY' : '…'}`, null);
      row(n.me?.ready ? 'Not ready' : 'Ready', '', () => n.set({ ready: !n.me?.ready }));
      row('Swap hero', '', () => n.set({ hero: n.me.hero === 'ironman' ? 'spiderman' : 'ironman' }));
      if (n.isHost) row('Start', '', () => n.start(), !r.players.every(p => p.ready || p.host));
      row('Leave', '', () => n.leave());
    } else if (menu === 'haptics') {
      row('Master', `${Math.round(MZ.haptics.master * 100)}%`, () => { MZ.haptics.master = MZ.haptics.master >= 1 ? 0.25 : MZ.haptics.master + 0.25; MZ.haptics.save(); });
      for (const [id, p] of Object.entries(MZ.haptics.lib)) row(id, p.desc || '', () => MZ.haptics.play(id));
    } else if (menu === 'controls') {
      for (const h of ['ironman', 'spiderman']) { R.push({ sec: MZ.HEROES[h].name }); for (const b of MZ.bindings.list(h)) row(`${MZ.glyph(b.btn)} ${b.name}`, b.how, b.locked ? null : () => { toast(`Press a button for: ${b.name}`); MZ.input.capture(btn => { const sw = MZ.bindings.set(h, b.id, btn); toast(sw === false ? 'That button is locked' : sw ? `Swapped with ${sw.name}` : 'Rebound'); }); }); }
    } else if (menu === 'mixer') {
      for (const bus of ['master', 'ui', 'sfx', 'amb', 'music']) row(bus, `${Math.round(MZ.audio.levels[bus] * 100)}%`, () => { MZ.audio.setLevel(bus, MZ.audio.levels[bus] >= 1 ? 0 : MZ.audio.levels[bus] + 0.2); MZ.audio.ui('ui_tick'); });
    }
    rows = R;
  }
  function toast(t) { const d = document.getElementById('toast'); if (!d) return; d.textContent = t; d.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => d.classList.remove('on'), 1800); }
  function render() {
    build();
    const sel = rows.filter(r => !r.sec);
    focus = Math.max(0, Math.min(focus, sel.length - 1));
    const inGame = MZ.game.phase === 'playing' || MZ.game.phase === 'loading';
    el.innerHTML = inGame ? '' : `<h1>MARK ZERO</h1><h2>V3 · DEV HARNESS · ${menu.toUpperCase()}</h2>` +
      rows.map(r => r.sec ? `<div class="sec">${r.sec}</div>` : `<div class="row${sel.indexOf(r) === focus ? ' f' : ''}${r.off ? ' off' : ''}"><span>${r.label}</span><span>${r.value || ''}</span></div>`).join('');
    const n = MZ.net;
    el.insertAdjacentHTML('beforeend', `<div class="info">net ${n.status}${n.rtt ? ' · ' + n.rtt.toFixed(0) + ' ms' : ''}${n.room ? ' · room ' + n.room.code : ''}\npad ${MZ.input.lastDevice} · ${MZ.input.family}${MZ.input.padId ? '\n' + MZ.input.padId.slice(0, 40) : ''}\nhaptics ${MZ.haptics.source} · ${MZ.haptics.supported().join(',') || 'no actuator'}\n${MZ.perf.fps.toFixed(0)} fps · ${MZ.perf.ms.toFixed(1)} ms · ${MZ.game.phase}${MZ.mounted === 'harness' ? '' : ''}</div>`);
    if (inGame) {
      const h = MZ.game.hud();
      el.insertAdjacentHTML('beforeend', `<div class="hud">${MZ.game.phase === 'loading' ? 'LOADING ' + Math.round((load.p || 0) * 100) + '%  ' + (load.label || '') : `${(h.speed * 3.6).toFixed(0)} KM/H   ALT ${h.alt.toFixed(0)} M   HDG ${h.heading.toFixed(0)}°${h.hover ? '   HOVER' : ''}${h.boost ? '   BOOST' : ''}`}</div>`);
    }
  }
  const load = {};
  MZ.on('game:loading', e => { load.p = e.progress; load.label = e.label; });
  MZ.on('input:nav', ({ dir }) => {
    if (MZ.input.context !== 'ui') return;
    if (menu === 'code' && focus === 0 && (dir === 'left' || dir === 'right' || dir === 'up' || dir === 'down')) {
      if (dir === 'left') codePos = (codePos + 3) % 4; else if (dir === 'right') codePos = (codePos + 1) % 4;
      else { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', i = A.indexOf(codeEntry[codePos]); const c = A[(i + (dir === 'up' ? 1 : A.length - 1)) % A.length]; codeEntry = codeEntry.slice(0, codePos) + c + codeEntry.slice(codePos + 1); }
      if (dir === 'left' || dir === 'right') { MZ.audio.ui('ui_focus'); MZ.haptics.play('ui_tick'); return; }
      if (dir === 'up' || dir === 'down') { MZ.audio.ui('ui_tick'); return; }
    }
    if (dir === 'up' || dir === 'down') { focus += dir === 'down' ? 1 : -1; MZ.audio.ui('ui_focus'); MZ.haptics.play('ui_tick'); }
  });
  MZ.on('input:press', ({ id }) => {
    const g = MZ.game;
    if (id === 'start' && (g.phase === 'playing' || g.phase === 'paused')) { g.pause(g.phase === 'playing'); return; }
    if (MZ.input.context !== 'ui') return;
    const sel = rows.filter(r => !r.sec), r = sel[focus];
    if (id === 'south' && r) { if (r.off || !r.fn) { MZ.audio.ui('ui_error'); MZ.haptics.play('ui_error'); return; } MZ.audio.ui('ui_confirm'); MZ.haptics.play('ui_confirm'); r.fn(); }
    if (id === 'east') { if (g.phase === 'paused') g.pause(false); else if (menu === 'room') MZ.net.leave(); else if (menu !== 'main') { menu = 'main'; focus = 0; MZ.audio.ui('ui_back'); MZ.haptics.play('ui_back'); } }
  });
  MZ.on('room:update', e => { if (MZ.game.phase === 'menu') menu = 'room'; if (e.created) { MZ.audio.ui('ui_room_created'); toast('Room ' + e.room.code); } if (e.joined && e.joined !== MZ.net.id) { MZ.audio.ui('ui_join'); MZ.haptics.play('ui_ready'); } if (e.reassigned === MZ.net.id) toast('Your hero was taken — you are ' + MZ.HEROES[MZ.net.me.hero].name); });
  MZ.on('room:left', () => { menu = 'main'; });
  MZ.on('room:error', e => { toast(e.msg); MZ.audio.ui('ui_error'); MZ.haptics.play('ui_error'); });
  MZ.on('frame', () => { if ((render.n = (render.n || 0) + 1) % 6 === 0) render(); });
  render();
}
