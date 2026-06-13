import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';

/**
 * ProceduralAudioSystem - pure WebAudio API procedural sound (no audio assets).
 *
 * Audio graph (everything routes through one master GainNode):
 *
 *   WIND   looping 2s white-noise AudioBufferSourceNode
 *            +-- BiquadFilter bandpass 300->1100 Hz -> GainNode 0->0.22 --+
 *            +-- BiquadFilter bandpass 165->605 Hz  -> GainNode (x0.5) --+
 *   CHIME  per-event sine OscillatorNodes (880 / 1318.5 Hz) + decay env -+
 *   WHOOSH one-shot noise source -> bandpass sweep 400->2000 Hz + env  --+
 *                                                                        |
 *                                     master GainNode (0.5) -> destination
 *
 * The AudioContext is created lazily on the first user gesture (pointerdown
 * or keydown) because browsers block autoplay. While the document is hidden
 * the context is suspended via handleVisibilityChange. If WebAudio or the
 * engine eventBus is unavailable the system stays initialized but inert.
 */
export class ProceduralAudioSystem extends System {
  constructor(engine) {
    super(engine, 'proceduralAudio');

    // Lazily-created WebAudio state
    this.context = null;
    this.masterGain = null;
    this.noiseBuffer = null;

    // Wind chain (one looping noise source fanned into two bandpass layers)
    this.windSource = null;
    this.windFilter = null;   // main layer
    this.windGain = null;
    this.windFilter2 = null;  // quieter low/detuned layer for richness
    this.windGain2 = null;

    // Settings
    this.masterVolume = 0.5;
    this.muted = false;

    // Wind tuning
    this.WIND_MIN_SPEED = 20;    // below this the wind is silent (hover)
    this.WIND_MAX_SPEED = 250;   // speed at which wind is at full strength
    this.WIND_MAX_GAIN = 0.12;   // tuned down so the procedural music can breathe
    this.WIND_FREQ_MIN = 300;    // bandpass centre (Hz) at min speed
    this.WIND_FREQ_MAX = 1100;   // bandpass centre (Hz) at max speed
    this.WIND_SMOOTHING = 0.15;  // setTargetAtTime timeConstant (seconds)

    this.supported = typeof window !== 'undefined' &&
      !!(window.AudioContext || window.webkitAudioContext);

    // Listener bookkeeping (for clean removal in destroy)
    this._gestureHandler = null;
    this._onManaCollected = null;
    this._onSpellCast = null;
    this._suspendedByVisibility = false;
  }

  async _initialize() {
    if (!this.supported) {
      Logger.warn('ProceduralAudioSystem: WebAudio not supported - audio disabled');
      return;
    }

    // Browsers block audio until a user gesture: create/resume the context on
    // the first pointerdown or keydown, then remove both listeners.
    this._gestureHandler = this._onFirstGesture.bind(this);
    window.addEventListener('pointerdown', this._gestureHandler, { passive: true });
    window.addEventListener('keydown', this._gestureHandler, { passive: true });

    // Subscribe to gameplay events. Handlers no-op until the context runs.
    // Payload shape is intentionally ignored (it may change) - the event
    // firing is the only signal we need.
    const bus = this.engine ? this.engine.eventBus : null;
    if (bus && typeof bus.on === 'function') {
      this._onManaCollected = () => this._playChime();
      this._onSpellCast = () => this._playWhoosh();
      bus.on('manaCollected', this._onManaCollected);
      bus.on('spellCast', this._onSpellCast);
    } else {
      Logger.warn('ProceduralAudioSystem: engine.eventBus unavailable - event sounds disabled');
    }
  }

  // --- AudioContext lifecycle -------------------------------------------

  _onFirstGesture() {
    this._removeGestureListeners(); // one-time: detach both listeners
    if (!this.supported || this.context) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.context = new Ctx();
      this._buildGraph();
      if (this.context.state === 'suspended') {
        this.context.resume().catch(() => {});
      }
    } catch (error) {
      Logger.warn('ProceduralAudioSystem: failed to create AudioContext - audio disabled', error);
      this.context = null;
    }
  }

  _removeGestureListeners() {
    if (!this._gestureHandler) return;
    window.removeEventListener('pointerdown', this._gestureHandler);
    window.removeEventListener('keydown', this._gestureHandler);
    this._gestureHandler = null;
  }

  handleVisibilityChange(visible) {
    const ctx = this.context;
    if (!ctx) return;
    if (!visible) {
      // Suspend only a running context, and remember it was us.
      if (ctx.state === 'running') {
        this._suspendedByVisibility = true;
        ctx.suspend().catch(() => {});
      }
    } else if (this._suspendedByVisibility && ctx.state === 'suspended') {
      // Resume only contexts we suspended (never fight the autoplay block).
      this._suspendedByVisibility = false;
      ctx.resume().catch(() => {});
    }
  }

  // --- Graph construction -------------------------------------------------

  _buildGraph() {
    const ctx = this.context;
    if (!ctx) return;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
    this.masterGain.connect(ctx.destination);

    // Shared 2-second white-noise buffer (looped for wind, one-shot for whoosh)
    this.noiseBuffer = this._createNoiseBuffer(2);

    // Wind: one looping source fanned into two parallel bandpass layers
    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = this.noiseBuffer;
    this.windSource.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = this.WIND_FREQ_MIN;
    this.windFilter.Q.value = 0.9;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;

    // Second, quieter layer tuned lower for a richer/fuller wind body
    this.windFilter2 = ctx.createBiquadFilter();
    this.windFilter2.type = 'bandpass';
    this.windFilter2.frequency.value = this.WIND_FREQ_MIN * 0.55;
    this.windFilter2.Q.value = 1.4;

    this.windGain2 = ctx.createGain();
    this.windGain2.gain.value = 0;

    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);

    this.windSource.connect(this.windFilter2);
    this.windFilter2.connect(this.windGain2);
    this.windGain2.connect(this.masterGain);

    this.windSource.start();
  }

  _createNoiseBuffer(seconds) {
    const ctx = this.context;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // --- Per-frame wind update -----------------------------------------------

  _update(delta) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.windGain) return;

    const playerState = this.engine.systems.get('playerState');
    const velocity = playerState && playerState.localPlayer
      ? playerState.localPlayer.velocity
      : null;
    const speed = velocity && typeof velocity.length === 'function'
      ? velocity.length()
      : 0;

    // Map speed [20, 250] -> [0, 1] with a gentle curve (rises a bit faster
    // at low speeds). Below WIND_MIN_SPEED the target is exactly 0.
    let t = (speed - this.WIND_MIN_SPEED) / (this.WIND_MAX_SPEED - this.WIND_MIN_SPEED);
    t = Math.min(Math.max(t, 0), 1);
    const curved = Math.pow(t, 0.7);

    const gainTarget = curved * this.WIND_MAX_GAIN;
    const freqTarget = this.WIND_FREQ_MIN + curved * (this.WIND_FREQ_MAX - this.WIND_FREQ_MIN);

    // Smooth toward targets - never set .value abruptly per frame.
    const now = ctx.currentTime;
    const tc = this.WIND_SMOOTHING;
    this.windGain.gain.setTargetAtTime(gainTarget, now, tc);
    this.windFilter.frequency.setTargetAtTime(freqTarget, now, tc);
    this.windGain2.gain.setTargetAtTime(gainTarget * 0.5, now, tc);
    this.windFilter2.frequency.setTargetAtTime(freqTarget * 0.55, now, tc);
  }

  // --- One-shot effects -----------------------------------------------------

  /** Mana collect: two quick sine pings (880 Hz then 1318.5 Hz), slight overlap. */
  _playChime() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.masterGain) return;
    const now = ctx.currentTime;
    this._ping(880, now, 0.12, 0.22);
    this._ping(1318.5, now + 0.07, 0.14, 0.2);
  }

  _ping(frequency, startTime, duration, peak) {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peak, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch (e) { /* already disconnected */ }
    };
  }

  /** Spell cast: 0.6s filtered-noise sweep, bandpass 400 -> 2000 Hz. */
  _playWhoosh() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.masterGain || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const duration = 0.6;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer; // reuse the wind noise buffer, one-shot

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(2000, now + duration * 0.75);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + duration * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(now);
    source.stop(now + duration + 0.05);
    source.onended = () => {
      try {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch (e) { /* already disconnected */ }
    };
  }

  // --- Public API -------------------------------------------------------------

  setMuted(muted) {
    this.muted = !!muted;
    this._applyMasterVolume();
  }

  setVolume(volume) {
    this.masterVolume = Math.min(Math.max(Number(volume) || 0, 0), 1);
    this._applyMasterVolume();
  }

  _applyMasterVolume() {
    if (!this.context || !this.masterGain) return;
    const target = this.muted ? 0 : this.masterVolume;
    this.masterGain.gain.setTargetAtTime(target, this.context.currentTime, 0.05);
  }

  // --- Teardown -----------------------------------------------------------------

  destroy() {
    this._removeGestureListeners();

    const bus = this.engine ? this.engine.eventBus : null;
    if (bus && typeof bus.off === 'function') {
      if (this._onManaCollected) bus.off('manaCollected', this._onManaCollected);
      if (this._onSpellCast) bus.off('spellCast', this._onSpellCast);
    }
    this._onManaCollected = null;
    this._onSpellCast = null;

    if (this.windSource) {
      try { this.windSource.stop(); } catch (e) { /* never started / already stopped */ }
      this.windSource = null;
    }
    if (this.context) {
      try { this.context.close().catch(() => {}); } catch (e) { /* already closed */ }
      this.context = null;
    }
    this.masterGain = null;
    this.noiseBuffer = null;
    this.windFilter = null;
    this.windGain = null;
    this.windFilter2 = null;
    this.windGain2 = null;

    super.destroy();
  }
}
