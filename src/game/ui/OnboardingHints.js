import { System } from '../core/System.js';
import { ensureVibeTheme } from './theme.js';

/**
 * OnboardingHints — teach by doing. One hint chip at a time; each clears
 * the moment the player performs the action (with a generous timeout so
 * nobody gets stuck). Runs once per browser (localStorage flag).
 */
const DONE_FLAG = 'vc.onboarded';

export class OnboardingHints extends System {
  constructor(engine) {
    super(engine, 'onboarding');
    this.steps = [
      {
        text: 'Hold W — throttle',
        done: ({ input }) => input && input.currentThrottle > 0.5,
        timeout: Infinity,
      },
      {
        text: 'A / D — bank into the turn',
        done: ({ player }) => player && Math.abs(player.bankAngle || 0) > 0.2,
        timeout: 20,
      },
      {
        text: 'Space climbs · Ctrl sinks',
        done: ({ player }) => player && Math.abs(player.altitudeVelocity || 0) > 12,
        timeout: 20,
      },
      {
        text: 'Nose down to dive — gravity is free speed',
        done: ({ player }) => {
          if (!player) return false;
          const v = player.velocity;
          return Math.hypot(v.x, v.z) > 230;
        },
        timeout: 25,
      },
      {
        text: 'R — race · Q — quests · E — cast',
        done: () => this._finalKeySeen,
        timeout: 12,
      },
    ];
    this.stepIndex = -1;
    this.stepElapsed = 0;
    this.active = false;
    this.finished = false;
    this.chip = null;
    this._finalKeySeen = false;
    this._keyHandler = null;
  }

  async _initialize() {
    try {
      if (localStorage.getItem(DONE_FLAG) === '1') {
        this.finished = true;
        return;
      }
    } catch (e) { /* storage unavailable — hints just run every session */ }

    ensureVibeTheme();
    this._keyHandler = (e) => {
      if (e.code === 'KeyR' || e.code === 'KeyQ' || e.code === 'KeyE') {
        this._finalKeySeen = true;
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  _update(delta) {
    if (this.finished) return;

    if (!this.active) {
      if (!this.engine.gameStarted) return;
      this.active = true;
      this._advance();
      return;
    }

    const step = this.steps[this.stepIndex];
    if (!step) return;

    const input = this.engine.systems.get('playerInput');
    const player = this.engine.systems.get('playerState')?.localPlayer;
    this.stepElapsed += delta;

    if (step.done({ input, player }) || this.stepElapsed > step.timeout) {
      this._advance();
    }
  }

  _advance() {
    this.stepIndex++;
    this.stepElapsed = 0;

    if (this.stepIndex >= this.steps.length) {
      this.finished = true;
      try { localStorage.setItem(DONE_FLAG, '1'); } catch (e) { /* ignore */ }
      this._fadeOutAndRemove();
      return;
    }
    this._showText(this.steps[this.stepIndex].text);
  }

  _showText(text) {
    if (!this.chip) {
      const chip = document.createElement('div');
      chip.className = 'vc-chip';
      chip.style.position = 'fixed';
      chip.style.bottom = '9%';
      chip.style.left = '50%';
      chip.style.transform = 'translateX(-50%) translateY(6px)';
      chip.style.padding = '10px 18px';
      chip.style.fontSize = '15px';
      chip.style.borderLeft = '3px solid var(--vc-gold)';
      chip.style.pointerEvents = 'none';
      chip.style.zIndex = '1001';
      chip.style.opacity = '0';
      chip.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      document.body.appendChild(chip);
      this.chip = chip;
    }
    const chip = this.chip;
    chip.style.opacity = '0';
    chip.style.transform = 'translateX(-50%) translateY(6px)';
    setTimeout(() => {
      chip.textContent = text;
      chip.style.opacity = '1';
      chip.style.transform = 'translateX(-50%) translateY(0)';
    }, 260);
  }

  _fadeOutAndRemove() {
    if (this.chip) {
      this.chip.style.opacity = '0';
      const chip = this.chip;
      this.chip = null;
      setTimeout(() => chip.remove(), 400);
    }
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
  }

  destroy() {
    this._fadeOutAndRemove();
    super.destroy();
  }
}
