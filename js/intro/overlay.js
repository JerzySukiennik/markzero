// Trailer overlay (DOM #intro, above everything): letterbox, title cards, the MARK ZERO wordmark reveal,
// the Start prompt, a skip hint, and the fade to the menu. Fonts/tokens from the design system.
const CSS = `
html.intro-on #ui, html.intro-on #hints, html.intro-on #story { visibility: hidden !important; }
#intro { position: fixed; inset: 0; z-index: 40; pointer-events: none; font-family: 'Barlow C', 'Barlow Condensed', sans-serif; color: #f4f1ea; overflow: hidden; }
#intro .black { position: absolute; inset: 0; background: #000; transition: opacity 900ms ease; }
#intro .black.off { opacity: 0; }
#intro .lb::before, #intro .lb::after { content: ''; position: absolute; left: 0; right: 0; height: 10.5vh; background: #000; z-index: 2; }
#intro .lb::before { top: 0; } #intro .lb::after { bottom: 0; }
#intro .title { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; opacity: 0; transition: opacity 700ms ease, letter-spacing 2400ms cubic-bezier(.22,1,.36,1); letter-spacing: .5em; z-index: 3; }
#intro .title.on { opacity: 1; letter-spacing: .32em; }
#intro .title b { display: block; font-weight: 600; font-size: 34px; }
#intro .title small { display: block; margin-top: 10px; font: 500 12px 'JB Mono', monospace; letter-spacing: .5em; color: #b9b2a6; text-transform: uppercase; }
#intro .word { position: absolute; left: 50%; top: 44%; transform: translate(-50%, -50%) scale(1.08); opacity: 0; z-index: 3; text-align: center; white-space: nowrap;
  transition: transform 1600ms cubic-bezier(.16,1,.3,1), opacity 260ms ease, filter 1400ms ease; filter: blur(8px); }
#intro .word.on { transform: translate(-50%, -50%) scale(1); opacity: 1; filter: blur(0); }
#intro .word h1 { margin: 0; font-weight: 600; font-size: clamp(64px, 11vw, 190px); letter-spacing: .06em; line-height: .9;
  background: linear-gradient(180deg, #fff 0%, #ffe3b0 55%, #e9a24a 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 0 40px rgba(255,170,80,.25); }
#intro .word .rule { height: 2px; margin: 18px auto 0; width: 0; background: linear-gradient(90deg, transparent, #ffcf7a, transparent); transition: width 1200ms cubic-bezier(.22,1,.36,1) 250ms; }
#intro .word.on .rule { width: 70%; }
#intro .word small { display: block; margin-top: 14px; font: 500 13px 'JB Mono', monospace; letter-spacing: .6em; color: #d9cbb4; opacity: 0; transition: opacity 900ms ease 700ms; }
#intro .word.on small { opacity: 1; }
#intro .flash { position: absolute; inset: 0; background: radial-gradient(circle at 50% 44%, rgba(255,235,200,.9), rgba(255,180,90,.25) 40%, transparent 70%); opacity: 0; z-index: 3; }
#intro .flash.go { animation: introFlash 900ms ease-out both; }
@keyframes introFlash { 0% { opacity: .95; } 100% { opacity: 0; } }
#intro .start { position: absolute; left: 50%; top: 68%; transform: translateX(-50%); display: flex; gap: 12px; align-items: center; opacity: 0; transition: opacity 600ms ease; z-index: 3;
  font-weight: 600; font-size: 26px; letter-spacing: .3em; text-transform: uppercase; }
#intro .start.on { opacity: 1; animation: introPulse 2.2s ease-in-out infinite 600ms; }
#intro .start .glyph { width: 40px; height: 40px; }
@keyframes introPulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
#intro .skip { position: absolute; right: 40px; bottom: calc(10.5vh + 18px); z-index: 3; display: flex; gap: 8px; align-items: center; font: 500 11px 'JB Mono', monospace; letter-spacing: .25em; color: #cfc7ba; opacity: 0; transition: opacity 500ms; }
#intro .skip.on { opacity: .7; }
#intro .skip .glyph { width: 22px; height: 22px; }
#intro .loading { position: absolute; left: 50%; bottom: calc(10.5vh + 30px); transform: translateX(-50%); z-index: 3; font: 500 11px 'JB Mono', monospace; letter-spacing: .5em; color: #8f887d; opacity: 0; transition: opacity 400ms; }
#intro .loading.on { opacity: 1; animation: introPulse 1.6s ease-in-out infinite; }
#intro .veil { position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity 700ms ease; z-index: 5; }
#intro .veil.on { opacity: 1; }
#intro .sound { position: absolute; left: 50%; top: 58%; transform: translateX(-50%); z-index: 3; font: 500 13px 'JB Mono', monospace; letter-spacing: .35em; opacity: 0; transition: opacity 400ms; display: flex; gap: 10px; align-items: center; }
#intro .sound.on { opacity: .85; animation: introPulse 2s ease-in-out infinite; }
#intro .sound .glyph { width: 26px; height: 26px; }
`;

export class IntroOverlay {
  constructor(MZ) {
    this.MZ = MZ;
    if (!document.getElementById('intro-css')) { const s = document.createElement('style'); s.id = 'intro-css'; s.textContent = CSS; document.head.appendChild(s); }
    const el = this.root = document.createElement('div'); el.id = 'intro';
    el.innerHTML = `<div class="lb"></div><div class="black"></div><div class="title"></div>
      <div class="word"><h1>MARK ZERO</h1><div class="rule"></div><small>IRON MAN · SPIDER-MAN</small></div><div class="flash"></div>
      <div class="start">${MZ.glyph('south')}<span>Start</span></div><div class="sound"></div><div class="skip"></div><div class="loading">LOADING</div><div class="veil"></div>`;
    document.body.appendChild(el);
    document.documentElement.classList.add('intro-on');
    const q = s => el.querySelector(s);
    this.el = { black: q('.black'), title: q('.title'), word: q('.word'), flash: q('.flash'), start: q('.start'), skip: q('.skip'), veil: q('.veil'), sound: q('.sound'), lb: q('.lb'), loading: q('.loading') };
  }
  black(on) { this.el.black.classList.toggle('off', !on); }
  title(text, sub) { const t = this.el.title; if (!text) { t.classList.remove('on'); return; } t.innerHTML = `<b>${text}</b>${sub ? `<small>${sub}</small>` : ''}`; requestAnimationFrame(() => t.classList.add('on')); }
  wordmark() { this.el.word.classList.add('on'); this.el.flash.classList.remove('go'); void this.el.flash.offsetWidth; this.el.flash.classList.add('go'); }
  start(on) { this.el.start.classList.toggle('on', on); }
  skipHint(on) { this.el.skip.innerHTML = `${this.MZ.glyph('south')}${this.MZ.glyph('east')}<span>SKIP</span>`; this.el.skip.classList.toggle('on', on); }
  soundGate(on) { this.el.sound.innerHTML = `${this.MZ.glyph('south')}<span>PRESS TO START</span>`; this.el.sound.classList.toggle('on', on); }
  loading(on) { this.el.loading.classList.toggle('on', on); }
  /** first launch in a browser downloads everything first: show how far (0..1) */
  progress(p) { const t = `LOADING ${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`; if (this._pt !== t) { this._pt = t; this.el.loading.textContent = t; } }
  veil(on) { this.el.veil.classList.toggle('on', on); }
  dispose() { this.root.remove(); document.documentElement.classList.remove('intro-on'); }
}
