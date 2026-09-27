// Where the page runs. Two worlds:
//   dev    served by server/dev.mjs (Mac :8140, HP app :8150) — /api/* (stats, audio index, remote cmds)
//          and the WS room service /net exist.
//   static the browser build on GitHub Pages (markzero.gzowo.fun, tools/build-web.sh) — plain files only:
//          no /api/*, no /net. Audio index = /audio-index.json, multiplayer = Firebase RTDB.
// Decided once at boot:
//   ?static=1 / ?static=0                         explicit (tests)
//   <meta name="mz-build" content="static">       written by tools/build-web.sh into index.html
//   otherwise: a public hostname (not localhost / LAN / *.local / *.test) counts as static.
const params = new URLSearchParams(location.search);
function detect() {
  if (params.has('static')) return params.get('static') !== '0';
  const m = document.querySelector('meta[name="mz-build"]');
  if (m) return m.content === 'static';
  const h = location.hostname;
  if (location.protocol === 'file:') return true;
  return !(h === 'localhost' || h === '[::1]' || /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h) || /\.(local|localhost|test)$/.test(h) || !h.includes('.'));
}
export const STATIC = detect();

/** Fire-and-forget POST to the dev server; a no-op in the static build. */
export function devPost(url, body) {
  if (STATIC) return;
  fetch(url, { method: 'POST', body: JSON.stringify(body) }).catch(() => { });
}
