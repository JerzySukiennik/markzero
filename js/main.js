// Boot: platform first (MZ), then the product UI (web/js/ui/index.js, owned by the UI agent) or,
// if it is missing or fails, the platform's dev harness. Contract: docs/UI-CONTRACT.md.
import { createApp } from './app.js';

const MZ = await createApp();
// timeline for driver-reset hunting (HP): wall-clock stamps of phases and context events
window.__tl = [['boot', new Date().toISOString().slice(11, 23)]];
MZ.on('game:phase', e => window.__tl.push([e.phase, new Date().toISOString().slice(11, 23)]));
MZ.on('game:loading', e => { if (window.__tl.at(-1)?.[0] !== e.label) window.__tl.push([e.label, new Date().toISOString().slice(11, 23)]); });
MZ.stage.renderer.domElement.addEventListener('webglcontextlost', () => window.__tl.push(['LOST', new Date().toISOString().slice(11, 23)]));
window.MZ = MZ; window.__mz = MZ;
const root = document.getElementById('ui');
let mounted = 'none';
// intro trailer + title music (docs/intro/README.md): starts before the menu so the title never flashes
await import('./intro/index.js').then(m => m.mountIntro(MZ)).catch(e => console.warn('[main] intro', e));
try {
  const ui = await import('./ui/index.js');
  await ui.mountUI(MZ, root);
  mounted = 'ui';
} catch (e) {
  if (!/Failed to fetch|Cannot find|404|Importing a module script failed/.test(String(e))) console.error('[main] UI failed, falling back to the dev harness', e);
  const h = await import('./dev/harness.js');
  await h.mountHarness(MZ, root);
  mounted = 'harness';
}
MZ.mounted = mounted;
document.getElementById('boot')?.classList.add('gone');
// story layer (docs/story/STORY-API.md): spawn in the bases, intros, missions
import('./story/index.js').then(m => m.mountStory(MZ)).catch(e => console.warn('[main] story', e));
// URL shortcuts the platform owns: ?solo=1&hero=ironman&suit=mk85 · ?room=CODE
const whenOnline = fn => { if (MZ.net.status === 'online') fn(); const off = MZ.on('net:status', ({ state }) => { if (state === 'online') { fn(); } }); return off; };
const joinByName = n => { const r = MZ.net.rooms.find(r => r.name === n); if (r) MZ.net.join(r.code, { hero: MZ.game.hero, suit: MZ.game.suit }); };
if (MZ.params.get('joinname')) { whenOnline(() => MZ.net.list()); MZ.on('net:rooms', () => !MZ.net.room && joinByName(MZ.params.get('joinname'))); }
if (MZ.params.get('solo')) MZ.game.solo(MZ.params.get('hero') || 'ironman', MZ.params.get('suit') || undefined);
else if (MZ.params.get('room')) whenOnline(() => MZ.net.join(MZ.params.get('room'), { hero: MZ.game.hero, suit: MZ.game.suit }));
// test automation (platform-reserved): ?host=1 hosts a room, ?autoready=1 readies up, ?autostart=N starts when N players are ready
if (MZ.params.get('host')) whenOnline(() => !MZ.net.room && MZ.net.host({ hero: MZ.game.hero, suit: MZ.game.suit, room: MZ.params.get('roomname') || undefined }));
if (MZ.params.get('autoready')) MZ.on('room:update', ({ room }) => { const me = room.players.find(p => p.id === MZ.net.id); if (me && !me.ready && !me.host) MZ.net.set({ ready: true }); });
if (MZ.params.get('autostart')) MZ.on('room:update', ({ room }) => { if (MZ.net.isHost && room.players.length >= +MZ.params.get('autostart') && room.players.every(p => p.ready || p.host)) MZ.net.start(); });
MZ.ready = true;
