/**
 * IntroScreen.js — "Twilight Glass" title screen.
 * A thin glass layer over the live golden-hour world (Engine's menu
 * cinematic). A pure-CSS twilight serves as the base layer so the screen
 * reads correctly even when the cinematic is unavailable.
 */
import { useGameState, GameStates } from '../../state/gameState';
import { ensureVibeTheme } from '../theme.js';

export class IntroScreen {
  constructor(engine) {
    this.engine = engine;
    this.container = document.createElement('div');
    this.visible = false;
    this.initialized = false;
    this.onPlayCallback = null;
    this._keyHandler = null;
    this._cinematicWatch = null;
  }

  initialize() {
    ensureVibeTheme();
    this._injectAnimations();

    const c = this.container;
    c.id = 'intro-screen';
    c.style.position = 'fixed';
    c.style.inset = '0';
    c.style.zIndex = '1000';
    c.style.pointerEvents = 'auto';
    c.style.fontFamily = 'var(--vc-font)';
    c.style.color = 'var(--vc-ink)';
    c.style.overflow = 'hidden';

    // --- Base layer: CSS twilight (visible until the live cinematic takes over)
    const fallback = document.createElement('div');
    fallback.style.position = 'absolute';
    fallback.style.inset = '0';
    fallback.style.zIndex = '0';
    fallback.style.transition = 'opacity 1.2s ease';
    fallback.style.background = [
      'radial-gradient(1.5px 1.5px at 12% 18%, rgba(255,255,255,0.8), transparent 60%)',
      'radial-gradient(1px 1px at 32% 9%, rgba(255,255,255,0.7), transparent 60%)',
      'radial-gradient(1.5px 1.5px at 55% 22%, rgba(255,255,255,0.6), transparent 60%)',
      'radial-gradient(1px 1px at 71% 12%, rgba(255,255,255,0.8), transparent 60%)',
      'radial-gradient(1.5px 1.5px at 86% 27%, rgba(255,255,255,0.5), transparent 60%)',
      'radial-gradient(1px 1px at 44% 31%, rgba(255,255,255,0.5), transparent 60%)',
      'radial-gradient(1px 1px at 92% 7%, rgba(255,255,255,0.7), transparent 60%)',
      'linear-gradient(180deg, #0b1026 0%, #2a2c5a 38%, #46518f 58%, #ff7744 72%, #6a3a52 80%, #2a1a3a 100%)',
    ].join(', ');
    for (let i = 0; i < 2; i++) {
      const cloud = document.createElement('div');
      cloud.style.position = 'absolute';
      cloud.style.top = `${52 + i * 11}%`;
      cloud.style.left = `${-30 + i * 45}%`;
      cloud.style.width = '46%';
      cloud.style.height = '9%';
      cloud.style.borderRadius = '50%';
      cloud.style.background = i === 0 ? 'rgba(255, 160, 110, 0.20)' : 'rgba(180, 140, 220, 0.16)';
      cloud.style.filter = 'blur(28px)';
      cloud.style.animation = `vc-cloud-drift ${90 + i * 40}s linear infinite`;
      fallback.appendChild(cloud);
    }
    this._fallbackLayer = fallback;
    c.appendChild(fallback);

    // --- Legibility veil over whichever sky is showing
    const veil = document.createElement('div');
    veil.style.position = 'absolute';
    veil.style.inset = '0';
    veil.style.zIndex = '1';
    veil.style.pointerEvents = 'none';
    veil.style.background =
      'linear-gradient(0deg, rgba(13,18,38,0.85) 0%, rgba(13,18,38,0.35) 30%, rgba(13,18,38,0) 48%),' +
      'radial-gradient(120% 90% at 50% 40%, transparent 60%, rgba(8,10,24,0.45) 100%)';
    c.appendChild(veil);

    // --- Content column
    const content = document.createElement('div');
    content.style.position = 'absolute';
    content.style.inset = '0';
    content.style.zIndex = '2';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.justifyContent = 'center';
    content.style.padding = '0 8%';
    content.style.maxWidth = '720px';

    const kicker = document.createElement('div');
    kicker.className = 'vc-label';
    kicker.textContent = 'an open-sky game for humans and machines';
    kicker.style.marginBottom = '14px';
    content.appendChild(kicker);

    const title = document.createElement('h1');
    title.textContent = 'SkyBloom';
    title.style.margin = '0';
    title.style.fontWeight = '800';
    title.style.fontSize = 'clamp(40px, 7vw, 76px)';
    title.style.letterSpacing = '0.16em';
    title.style.lineHeight = '1.05';
    title.style.textShadow = '0 2px 24px rgba(13, 18, 38, 0.8)';
    content.appendChild(title);

    // Ribbon underline — the carpet's trail, gold to magenta
    const ribbon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ribbon.setAttribute('width', '280');
    ribbon.setAttribute('height', '18');
    ribbon.setAttribute('viewBox', '0 0 280 18');
    ribbon.style.margin = '10px 0 18px 4px';
    ribbon.innerHTML =
      '<defs><linearGradient id="vc-ribbon" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#ffcc66"/><stop offset="1" stop-color="#ff66cc"/>' +
      '</linearGradient></defs>' +
      '<path d="M3 12 C 60 2, 110 16, 160 8 S 250 4, 277 9" fill="none" ' +
      'stroke="url(#vc-ribbon)" stroke-width="3" stroke-linecap="round"/>';
    content.appendChild(ribbon);

    const tagline = document.createElement('div');
    tagline.className = 'vc-label';
    tagline.textContent = 'fly · collect · race the machines';
    tagline.style.fontSize = '13px';
    tagline.style.marginBottom = '34px';
    content.appendChild(tagline);

    const playButton = document.createElement('button');
    playButton.className = 'vc-btn-primary';
    playButton.textContent = 'Take Flight';
    playButton.style.alignSelf = 'flex-start';
    playButton.style.animation = 'vc-breathe 3s ease-in-out infinite';
    content.appendChild(playButton);

    const ghostRow = document.createElement('div');
    ghostRow.style.display = 'flex';
    ghostRow.style.flexWrap = 'wrap';
    ghostRow.style.gap = '8px';
    ghostRow.style.marginTop = '16px';

    const howBtn = document.createElement('button');
    howBtn.className = 'vc-btn-ghost';
    howBtn.textContent = 'How to fly';

    const raceBtn = document.createElement('button');
    raceBtn.className = 'vc-btn-ghost';
    raceBtn.textContent = 'Race ghosts (R)';

    const apiLink = document.createElement('a');
    apiLink.className = 'vc-btn-ghost';
    apiLink.textContent = 'Agent API';
    apiLink.href = '/docs/AGENT_API.md';
    apiLink.target = '_blank';
    apiLink.style.textDecoration = 'none';
    apiLink.style.display = 'inline-flex';
    apiLink.style.alignItems = 'center';

    ghostRow.appendChild(howBtn);
    ghostRow.appendChild(raceBtn);
    ghostRow.appendChild(apiLink);
    content.appendChild(ghostRow);

    // Controls card (toggled by "How to fly")
    const card = document.createElement('div');
    card.className = 'vc-panel';
    card.style.display = 'none';
    card.style.marginTop = '16px';
    card.style.padding = '14px 16px';
    card.style.maxWidth = '380px';
    const rows = [
      ['W / S · Shift', 'throttle · brake'],
      ['A / D', 'bank into the turn'],
      ['Space / Ctrl', 'climb / dive'],
      ['Mouse', 'steer (click to lock)'],
      ['1–4 · E', 'select · cast spells'],
      ['R · Q', 'race · quest log'],
    ];
    rows.forEach(([keys, what]) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.gap = '18px';
      row.style.padding = '4px 0';
      const k = document.createElement('span');
      k.className = 'vc-label';
      k.style.color = 'var(--vc-gold)';
      k.textContent = keys;
      const w = document.createElement('span');
      w.style.fontSize = '13px';
      w.style.color = 'var(--vc-ink-dim)';
      w.textContent = what;
      row.appendChild(k);
      row.appendChild(w);
      card.appendChild(row);
    });
    content.appendChild(card);
    howBtn.addEventListener('click', () => {
      card.style.display = card.style.display === 'none' ? 'block' : 'none';
    });

    c.appendChild(content);

    // --- Footer: license note + multiplayer status dot
    const footer = document.createElement('div');
    footer.style.position = 'absolute';
    footer.style.left = '8%';
    footer.style.bottom = '4%';
    footer.style.zIndex = '2';
    footer.style.display = 'flex';
    footer.style.alignItems = 'center';
    footer.style.gap = '8px';
    const dot = document.createElement('span');
    dot.style.width = '8px';
    dot.style.height = '8px';
    dot.style.borderRadius = '50%';
    dot.style.background = 'rgba(255,255,255,0.25)';
    dot.title = 'multiplayer: unknown';
    const foot = document.createElement('span');
    foot.className = 'vc-label';
    foot.textContent = 'open source · MIT';
    footer.appendChild(dot);
    footer.appendChild(foot);
    c.appendChild(footer);
    this._statusDot = dot;
    this.serverStatus = foot; // legacy text target; updateServerStatus also drives the dot

    // --- Start handling (pointer lock must happen inside the user gesture)
    const self = this;
    function handlePlayPress(event) {
      event.preventDefault();
      playButton.removeEventListener('click', handlePlayPress);
      playButton.removeEventListener('touchend', handlePlayPress);
      raceBtn.removeEventListener('click', handlePlayPress);
      self._unbindKeys();

      self.container.style.display = 'none';
      self.visible = false;

      useGameState.getState().setGameState(GameStates.PLAYING);
      if (self.onPlayCallback) self.onPlayCallback();

      if (document.body.requestPointerLock) {
        document.body.requestPointerLock();
      }
    }
    this._handlePlayPress = handlePlayPress;
    playButton.addEventListener('click', handlePlayPress);
    playButton.addEventListener('touchend', handlePlayPress);
    raceBtn.addEventListener('click', handlePlayPress);

    // Responsive tweaks for narrow screens
    if (window.innerWidth < 700) {
      content.style.padding = '0 6%';
      playButton.style.alignSelf = 'stretch';
      ghostRow.style.flexDirection = 'column';
    }

    document.body.appendChild(c);
    c.style.display = 'none';
    this.initialized = true;
  }

  show() {
    if (!this.initialized) this.initialize();

    this.container.style.display = 'block';
    this.visible = true;
    this.container.style.opacity = '0';
    this.container.style.transition = 'opacity 0.5s';
    setTimeout(() => { this.container.style.opacity = '1'; }, 10);

    // Enter/Space also takes flight
    this._keyHandler = (e) => {
      if ((e.code === 'Enter' || e.code === 'Space') && this.visible && this._handlePlayPress) {
        this._handlePlayPress(e);
      }
    };
    window.addEventListener('keydown', this._keyHandler);

    // Fade the CSS sky out while the engine's live menu cinematic is running
    clearInterval(this._cinematicWatch);
    this._cinematicWatch = setInterval(() => {
      if (!this.visible) return;
      const live = this.engine && this.engine._menuCinematicActive && !this.engine._menuCinematicDisabled;
      this._fallbackLayer.style.opacity = live ? '0' : '1';
    }, 500);
  }

  hide() {
    if (!this.initialized || !this.visible) return;
    this._unbindKeys();
    this.container.style.opacity = '0';
    setTimeout(() => {
      this.container.style.display = 'none';
      this.visible = false;
    }, 500);
  }

  onPlay(callback) {
    this.onPlayCallback = callback;
  }

  updateServerStatus(message, type = 'info') {
    if (!this.initialized || !this._statusDot) return;
    this._statusDot.title = `multiplayer: ${message}`;
    this._statusDot.style.background =
      type === 'success' ? '#72e176'
      : type === 'error' ? 'rgba(255,255,255,0.25)'
      : 'rgba(255,255,255,0.4)';
  }

  _unbindKeys() {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    clearInterval(this._cinematicWatch);
  }

  _injectAnimations() {
    if (document.getElementById('vc-intro-anim')) return;
    const style = document.createElement('style');
    style.id = 'vc-intro-anim';
    style.textContent = `
      @keyframes vc-breathe {
        0%, 100% { box-shadow: 0 0 24px rgba(255, 204, 102, 0.35); }
        50% { box-shadow: 0 0 42px rgba(255, 204, 102, 0.6); }
      }
      @keyframes vc-cloud-drift {
        from { transform: translateX(0); }
        50% { transform: translateX(38vw); }
        to { transform: translateX(0); }
      }
    `;
    document.head.appendChild(style);
  }
}
