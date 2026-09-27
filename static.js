// Static-hosting shim for the browser build (tools/build-web.sh injects it into play/index.html before the
// game's modules). The dev server (server/dev.mjs) has a few dynamic endpoints; on GitHub Pages there is no
// server, so:
//   /api/audio            → /audio-index.json (generated at build time, same merge as the dev server)
//   /api/stats, /api/cmd, /api/clients, /api/shot  → answered locally, nothing is sent anywhere
//   WebSocket /net        → closes quietly (no room service here); the UI then offers solo, and online
//                           co-op arrives with the Firebase transport
// Nothing else is touched; the game code is byte-identical to the committed tree.
(function () {
  window.MZ_STATIC = true;
  var origFetch = window.fetch.bind(window);
  var local = function (body) { return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })); };
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var path = url.replace(/^https?:\/\/[^/]+/, '');
    if (path.indexOf('/api/audio') === 0) return origFetch('/audio-index.json', init);
    if (/^\/api\/(stats|cmd|clients|shot|rooms)/.test(path)) return local(path.indexOf('/api/cmd') === 0 ? '[]' : '{"ok":true,"static":true}');
    return origFetch(input, init);
  };
  var RealWS = window.WebSocket;
  function QuietSocket(url) {
    var self = this;
    this.url = url; this.readyState = 0; this.protocol = ''; this.extensions = ''; this.bufferedAmount = 0;
    setTimeout(function () {
      self.readyState = 3;
      var ev = { type: 'close', code: 1000, reason: 'static build: no room service', wasClean: true, target: self };
      if (typeof self.onclose === 'function') self.onclose(ev);
    }, 50);
  }
  QuietSocket.prototype.send = function () { };
  QuietSocket.prototype.close = function () { this.readyState = 3; };
  QuietSocket.prototype.addEventListener = function (t, fn) { this['on' + t] = fn; };
  QuietSocket.prototype.removeEventListener = function () { };
  QuietSocket.CONNECTING = 0; QuietSocket.OPEN = 1; QuietSocket.CLOSING = 2; QuietSocket.CLOSED = 3;
  window.WebSocket = function (url, protocols) {
    if (/\/net(\?|$)/.test(String(url))) return new QuietSocket(url);
    return protocols === undefined ? new RealWS(url) : new RealWS(url, protocols);
  };
  window.WebSocket.prototype = RealWS.prototype;
  window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1; window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;
})();
