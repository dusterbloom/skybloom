import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';

/**
 * ProceduralMusicSystem — Ennio Morricone-inspired procedural soundtrack.
 *
 * Everything is synthesized in real time with the WebAudio API — no assets:
 *
 *   WHISTLE  one legato oscillator per theme with portamento, delayed
 *            vibrato and a parallel breath-noise layer
 *   GUITAR   Karplus-Strong plucked strings (noise burst -> tuned delay
 *            loop with damped feedback), arpeggios + a twang bass
 *   BRASS    detuned saw unison + fifth through a filter envelope
 *   PAD      slow detuned-saw chord swells for night and high altitude
 *   DRUMS    pitched timpani (sine drop + thump), rimshot, and a
 *            dotted gallop pattern at racing speeds
 *   REVERB   ConvolverNode with a generated stereo impulse response
 *
 * The music is not a loop: a seeded theme is composed from the planet's
 * terrain seed (reroll the world and the melody changes with it), played
 * over a real chord progression, and an arranger picks which layers play
 * each phrase from flight speed, time of day and altitude — with deliberate
 * rests, because the desert needs silence to sound wide.
 *
 * The context is created lazily on first user gesture and suspends on tab
 * hide, matching ProceduralAudioSystem. The genie can steer the score via
 * worldAPI.setMusic({mood, volume}).
 */

// Deterministic PRNG so a planet seed always composes the same theme.
function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Modes with a spaghetti-western flavour. Steps are semitones from the root.
const MODES = [
  { name: 'harmonic-minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { name: 'dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'phrygian-dominant', steps: [0, 1, 4, 5, 7, 8, 10] },
];

// Chord progressions as scale-degree roots, one chord per bar of a 4-bar
// phrase. Triads are stacked in-scale (degree, +2, +4).
const PROGRESSIONS = [
  [0, 0, 5, 6], // i  i  VI VII — the classic ride into the sunset
  [0, 5, 2, 6], // i  VI III VII — wider arc for soaring sections
  [0, 3, 5, 4], // i  iv  VI  v — plaintive, for night
];

const MOODS = ['auto', 'calm', 'epic', 'night', 'off'];

export class ProceduralMusicSystem extends System {
  constructor(engine) {
    super(engine, 'proceduralMusic');

    this.supported = typeof window !== 'undefined' &&
      !!(window.AudioContext || window.webkitAudioContext);

    // WebAudio graph (created lazily on first gesture)
    this.context = null;
    this.masterGain = null;
    this.compressor = null;
    this.dryBus = null;
    this.reverb = null;       // ConvolverNode
    this.reverbReturn = null;

    // Mix / playback state (volume persisted in vc.music)
    this.muted = false;
    this.masterVolume = 0.35;
    this.mood = 'auto';
    this.intensityOverride = null;
    this._loadSettings();

    // Tempo and scheduling — bar-by-bar so tempo reacts within a bar.
    this.baseTempo = 74;
    this.maxTempo = 118;
    this.currentTempo = this.baseTempo;
    this.beatsPerBar = 4;
    this.barsPerPhrase = 4;
    this.lookahead = 0.4;

    this.isPlaying = false;
    this.nextBarTime = 0;
    this.barCount = 0;
    this._smoothedIntensity = 0;
    this._layers = { whistle: true, guitar: false, bass: false, brass: false, drums: false, pad: false };

    // Theme (composed from the planet seed in _composeTheme)
    this._themeSeed = null;
    this.mode = MODES[0];
    this.rootNote = 40; // E2
    this.theme = null;  // { degrees, rhythm } spanning 2 bars
    this.progression = PROGRESSIONS[0];

    // Listener bookkeeping
    this._gestureHandler = null;
    this._onGameStarted = null;
    this._suspendedByVisibility = false;
    this._gameStarted = false;
    this._registeredOps = [];
  }

  async _initialize() {
    if (!this.supported) {
      Logger.warn('ProceduralMusicSystem: WebAudio not supported - music disabled');
      return;
    }

    // Browsers block audio until a user gesture.
    this._gestureHandler = this._onFirstGesture.bind(this);
    window.addEventListener('pointerdown', this._gestureHandler, { passive: true });
    window.addEventListener('keydown', this._gestureHandler, { passive: true });

    const bus = this.engine ? this.engine.eventBus : null;
    if (bus && typeof bus.on === 'function') {
      this._onGameStarted = () => {
        this._gameStarted = true;
        this._startMusic();
      };
      bus.on('gameStarted', this._onGameStarted);
    } else {
      Logger.warn('ProceduralMusicSystem: engine.eventBus unavailable - music will not auto-start');
    }

    // Let the genie DJ: compose onto worldAPI without clobbering other owners.
    if (typeof window !== 'undefined') {
      const ops = { setMusic: (opts) => this.setMusic(opts) };
      window.worldAPI = Object.assign(window.worldAPI || {}, ops);
      this._registeredOps = Object.keys(ops);
      const meta = window.worldAPI.meta;
      if (meta && Array.isArray(meta.ops)) {
        for (const k of this._registeredOps) if (!meta.ops.includes(k)) meta.ops.push(k);
      }
    }
  }

  // --- AudioContext lifecycle ---------------------------------------------

  _onFirstGesture() {
    this._removeGestureListeners();
    if (!this.supported || this.context) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.context = new Ctx();
      this._buildGraph();
      if (this.context.state === 'suspended') {
        this.context.resume().catch(() => {});
      }
      if (this._gameStarted) {
        this._startMusic();
      }
    } catch (error) {
      Logger.warn('ProceduralMusicSystem: failed to create AudioContext - music disabled', error);
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
      if (ctx.state === 'running') {
        this._suspendedByVisibility = true;
        ctx.suspend().catch(() => {});
      }
    } else if (this._suspendedByVisibility && ctx.state === 'suspended') {
      this._suspendedByVisibility = false;
      ctx.resume().catch(() => {});
    }
  }

  // --- Graph construction -------------------------------------------------

  _buildGraph() {
    const ctx = this.context;
    if (!ctx) return;

    // master -> gentle glue compressor -> hard safety clip -> destination.
    // The soft clipper is a guarantee to the listener's speakers: no voice
    // bug, ever, can push more than |1| out of this system.
    const safetyClip = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.5) / Math.tanh(1.5);
    }
    safetyClip.curve = curve;
    safetyClip.connect(ctx.destination);

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.28;
    this.compressor.connect(safetyClip);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
    this.masterGain.connect(this.compressor);

    this.dryBus = ctx.createGain();
    this.dryBus.connect(this.masterGain);

    // Watchdog tap: if any voice ever runs away again, kill the music
    // instead of letting the clipper buzz at full scale.
    this._watchdog = ctx.createAnalyser();
    this._watchdog.fftSize = 512;
    this._watchdogData = new Float32Array(this._watchdog.fftSize);
    this.masterGain.connect(this._watchdog);

    // Convolution reverb — a generated stereo impulse beats any delay loop.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._buildImpulseResponse(2.6, 0.02);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.4;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.masterGain);
  }

  /** Exponentially decaying stereo noise with a little pre-delay. */
  _buildImpulseResponse(seconds, preDelay) {
    const ctx = this.context;
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * (seconds + preDelay));
    const pad = Math.floor(rate * preDelay);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = pad; i < length; i++) {
        const t = (i - pad) / (length - pad);
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
      }
    }
    return buffer;
  }

  /**
   * Route a voice's output gain to the dry bus plus a reverb send.
   * Returns the nodes so the caller can hand them to _autoDisconnect.
   */
  _route(gainNode, wet = 0.3) {
    gainNode.connect(this.dryBus);
    const send = this.context.createGain();
    send.gain.value = wet;
    gainNode.connect(send);
    send.connect(this.reverb);
    return send;
  }

  // --- Theme composition ----------------------------------------------------

  /**
   * Compose the planet's theme from the terrain seed: mode, tempo,
   * progression and an 8-note whistle melody with an arc — mostly steps,
   * one leap, home on a chord tone. Reroll the world, get a new tune.
   */
  _composeTheme(seed) {
    this._themeSeed = seed;
    const rand = mulberry32(Math.floor((Number(seed) || 1) * 8191));

    this.mode = MODES[Math.floor(rand() * MODES.length)];
    this.rootNote = [40, 38, 41, 43][Math.floor(rand() * 4)]; // E2 D2 F2 G2
    this.baseTempo = 68 + Math.floor(rand() * 16);
    this._dayProgression = PROGRESSIONS[Math.floor(rand() * 2)]; // night swaps in [2]
    this.progression = this._dayProgression;

    // Melody: start home, wander by steps, one leap to the phrase peak,
    // resolve down to root or fifth. Rhythm favours long notes.
    const degrees = [0];
    const peakAt = 2 + Math.floor(rand() * 3);
    let cur = 0;
    for (let i = 1; i < 7; i++) {
      if (i === peakAt) {
        cur = 4 + Math.floor(rand() * 3); // leap to 5th..7th degree
      } else {
        cur += (rand() < 0.5 ? -1 : 1) * (1 + (rand() < 0.2 ? 1 : 0));
        cur = Math.max(-1, Math.min(7, cur));
      }
      degrees.push(cur);
    }
    degrees.push(rand() < 0.5 ? 0 : 4); // resolve home or to the fifth

    const rhythmBank = [
      [2, 1, 1, 2, 1, 1, 2, 6],
      [3, 1, 2, 2, 1, 1, 2, 4],
      [1.5, 0.5, 2, 2, 1.5, 0.5, 2, 6],
    ];
    const rhythm = rhythmBank[Math.floor(rand() * rhythmBank.length)];

    this.theme = { degrees, rhythm };
    Logger.info(`ProceduralMusicSystem: composed theme — ${this.mode.name}, root ${this.rootNote}, ${this.baseTempo} bpm`);
  }

  /** Re-compose when the planet is rerolled so each world owns its tune. */
  _syncThemeToWorld() {
    const world = this.engine.systems.get('world');
    const seed = world && Number.isFinite(world.seed) ? world.seed : 1;
    if (seed !== this._themeSeed) this._composeTheme(seed);
  }

  // --- Playback control ---------------------------------------------------

  _startMusic() {
    if (!this.context || this.isPlaying || this.mood === 'off') return;
    if (this.context.state === 'suspended') {
      this.context.resume().catch(() => {});
    }
    this._syncThemeToWorld();
    this.isPlaying = true;
    this.nextBarTime = this.context.currentTime + 0.35;
    this.barCount = 0;
    Logger.info('ProceduralMusicSystem: music started');
  }

  _stopMusic() {
    this.isPlaying = false;
  }

  // --- Per-frame update ----------------------------------------------------

  _update(delta) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.isPlaying) return;

    // Circuit breaker: a healthy mix at 0.35 volume never nears peak 4.
    this._watchdogTimer = (this._watchdogTimer || 0) + delta;
    if (this._watchdog && this._watchdogTimer > 1) {
      this._watchdogTimer = 0;
      this._watchdog.getFloatTimeDomainData(this._watchdogData);
      let peak = 0;
      for (const v of this._watchdogData) peak = Math.max(peak, Math.abs(v));
      this._watchdogStrikes = peak > 4 ? (this._watchdogStrikes || 0) + 1 : 0;
      if (this._watchdogStrikes >= 2) {
        Logger.error(`ProceduralMusicSystem: runaway output (peak ${peak.toFixed(1)}) - music stopped`);
        this._stopMusic();
        if (this.masterGain) this.masterGain.gain.value = 0;
        return;
      }
    }

    const intensity = this._getIntensity();
    this._smoothedIntensity += (intensity - this._smoothedIntensity) *
      (1 - Math.exp(-delta / 2.5));

    const target = this.baseTempo + this._smoothedIntensity * (this.maxTempo - this.baseTempo);
    this.currentTempo += (target - this.currentTempo) * (1 - Math.exp(-delta / 1.2));

    // Never try to catch up on a backlog (e.g. after a long tab-hide).
    if (this.nextBarTime < ctx.currentTime - 0.25) {
      this.nextBarTime = ctx.currentTime + 0.1;
      this.barCount += this.barsPerPhrase - (this.barCount % this.barsPerPhrase); // resume on a phrase boundary
    }

    while (this.nextBarTime < ctx.currentTime + this.lookahead) {
      const beat = 60 / this.currentTempo;
      this._scheduleBar(this.nextBarTime, beat);
      this.nextBarTime += this.beatsPerBar * beat;
      this.barCount++;
    }
  }

  _getIntensity() {
    if (this.intensityOverride !== null) {
      return Math.min(Math.max(this.intensityOverride, 0), 1);
    }
    if (this.mood === 'calm' || this.mood === 'night') return 0.15;
    if (this.mood === 'epic') return 0.85;

    const playerState = this.engine.systems.get('playerState');
    const velocity = playerState && playerState.localPlayer
      ? playerState.localPlayer.velocity
      : null;
    const speed = velocity && typeof velocity.length === 'function'
      ? velocity.length()
      : 0;

    // Current flight tuning: cruise ~140, boost 280+. Map 30..300 -> 0..1.
    return Math.min(Math.max((speed - 30) / 270, 0), 1);
  }

  _isNight() {
    if (this.mood === 'night') return true;
    const atmosphere = this.engine.systems.get('atmosphere');
    const t = atmosphere && typeof atmosphere.timeOfDay === 'number' ? atmosphere.timeOfDay : 0.5;
    return t < 0.22 || t > 0.78;
  }

  // --- Arranger -------------------------------------------------------------

  /** At each phrase boundary decide which layers play, with rests built in. */
  _arrangePhrase(phraseIndex) {
    this._syncThemeToWorld();
    const i = this._smoothedIntensity;
    const night = this._isNight();
    const rand = mulberry32(Math.floor((this._themeSeed || 1) * 131) + phraseIndex);

    const L = this._layers;
    L.pad = night || i > 0.75;
    L.guitar = !night ? (phraseIndex > 0 && rand() < 0.9) : rand() < 0.4;
    L.bass = i > 0.3 && !night;
    L.drums = i > 0.45 && !night;
    L.brass = i > 0.6 && rand() < 0.7;
    // The whistle rests sometimes — silence is part of the theme.
    L.whistle = phraseIndex < 2 || rand() > (night ? 0.45 : 0.25);

    this.progression = night ? PROGRESSIONS[2] : (this._dayProgression || this.progression);
  }

  _scheduleBar(startTime, beat) {
    const barInPhrase = this.barCount % this.barsPerPhrase;
    const phraseIndex = Math.floor(this.barCount / this.barsPerPhrase);
    if (barInPhrase === 0) this._arrangePhrase(phraseIndex);

    const L = this._layers;
    const i = this._smoothedIntensity;
    const chordRoot = this.progression[barInPhrase % this.progression.length];
    const barDur = this.beatsPerBar * beat;

    // Tonic pedal drone under everything, retriggered per phrase.
    if (barInPhrase === 0) {
      this._playDrone(startTime, this.barsPerPhrase * barDur, i > 0.5);
    }

    // Whistle: the theme spans bars 0-1; an answer (up a third) on 2-3 when soaring.
    if (L.whistle && this.theme) {
      if (barInPhrase === 0) {
        this._playWhistleTheme(this.theme, startTime, beat, 0);
      } else if (barInPhrase === 2 && i > 0.55) {
        this._playWhistleTheme(this.theme, startTime, beat, 2);
      }
    }

    // Guitar: chord-tone arpeggio, denser as intensity rises.
    if (L.guitar) {
      const tones = [chordRoot, chordRoot + 2, chordRoot + 4];
      const slots = i > 0.5 ? [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] : [0, 1, 2, 3];
      slots.forEach((slot, k) => {
        const deg = tones[k % tones.length] + (k % 5 === 4 ? 7 : 0);
        this._pluck(this._degreeToFreq(deg, 2), startTime + slot * beat, beat * 1.6, 0.13);
      });
    }

    // Twang bass: root on 1 and the and-of-2 — the stride under the groove.
    if (L.bass) {
      this._pluck(this._degreeToFreq(chordRoot, 1), startTime, beat * 1.8, 0.22);
      this._pluck(this._degreeToFreq(chordRoot, 1), startTime + 2.5 * beat, beat * 1.2, 0.18);
    }

    // Brass: cadence stab on the last bar of the phrase.
    if (L.brass && barInPhrase === 3) {
      this._playBrassStab(chordRoot, 2 * beat, startTime);
      if (i > 0.8) this._playBrassStab(chordRoot + 4, 1.5 * beat, startTime + 2 * beat);
    }

    // Drums: timpani downbeat; gallop when flying flat out.
    if (L.drums) {
      this._playTimpani(startTime, chordRoot);
      if (i > 0.7) {
        // dotted gallop: da-da-DUM into beats 3 and (next bar's) 1
        for (const b of [1, 3]) {
          this._playRimshot(startTime + (b + 0.5) * beat);
          this._playRimshot(startTime + (b + 0.75) * beat);
          // b === 3 lands on the next bar's downbeat, which plays its own timpani
          if (b + 1 < this.beatsPerBar) this._playTimpani(startTime + (b + 1) * beat, chordRoot, 0.6);
        }
      } else if (i > 0.55) {
        this._playRimshot(startTime + 2 * beat);
      }
    }

    // Pad: whole-bar chord swell for night skies and high drama.
    if (L.pad && barInPhrase % 2 === 0) {
      this._playPad([chordRoot, chordRoot + 2, chordRoot + 4], startTime, 2 * barDur);
    }
  }

  // --- Instrument voices ---------------------------------------------------

  /**
   * Whistle: ONE oscillator carries the whole theme legato — portamento
   * between notes, vibrato that swells in, and a breath-noise layer.
   */
  _playWhistleTheme(theme, startTime, beat, transpose) {
    const ctx = this.context;
    if (!ctx || !this.dryBus) return;

    const osc = ctx.createOscillator();
    osc.type = 'sine';

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);

    // Vibrato swells in after the first note lands — a whistler, not a synth.
    const vibrato = ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 5.2;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.setValueAtTime(0, startTime);

    let cursor = startTime;
    for (let n = 0; n < theme.degrees.length; n++) {
      const freq = this._degreeToFreq(theme.degrees[n] + transpose, 3);
      const dur = (theme.rhythm[n] || 1) * beat * 0.5; // theme spans 2 bars
      if (n === 0) {
        osc.frequency.setValueAtTime(freq, cursor);
        gain.gain.linearRampToValueAtTime(0.16, cursor + 0.09);
        vibratoGain.gain.linearRampToValueAtTime(freq * 0.006, cursor + 0.5);
      } else {
        // Glide into the note, longer for bigger intervals.
        const glide = Math.min(0.11, 0.03 + Math.abs(theme.degrees[n] - theme.degrees[n - 1]) * 0.018);
        osc.frequency.exponentialRampToValueAtTime(freq, cursor + glide);
        // Small articulation dip so repeated notes read.
        gain.gain.setTargetAtTime(0.11, cursor - 0.03, 0.02);
        gain.gain.setTargetAtTime(0.16, cursor + 0.04, 0.03);
      }
      cursor += dur;
    }
    gain.gain.setTargetAtTime(0.0001, cursor - 0.15, 0.25);
    const endTime = cursor + 0.8;

    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    // Breath: quiet band-passed noise riding the same envelope.
    const breath = this._noiseSource(endTime - startTime + 0.2);
    const breathFilter = ctx.createBiquadFilter();
    breathFilter.type = 'bandpass';
    breathFilter.frequency.value = 2600;
    breathFilter.Q.value = 0.8;
    const breathGain = ctx.createGain();
    breathGain.gain.setValueAtTime(0.0001, startTime);
    breathGain.gain.linearRampToValueAtTime(0.012, startTime + 0.12);
    breathGain.gain.setTargetAtTime(0.0001, cursor - 0.15, 0.2);

    const send = this._route(gain, 0.5);
    const breathSend = this._route(breathGain, 0.5);

    osc.connect(gain);
    breath.connect(breathFilter);
    breathFilter.connect(breathGain);

    osc.start(startTime);
    osc.stop(endTime);
    vibrato.start(startTime);
    vibrato.stop(endTime);
    breath.start(startTime);
    breath.stop(endTime);

    this._autoDisconnect(osc, [gain, vibrato, vibratoGain, breath, breathFilter, breathGain, send, breathSend]);
  }

  /**
   * Karplus-Strong pluck: a noise burst circulating in a tuned, damped
   * delay loop. This IS the twang — no oscillator imitates it.
   */
  _pluck(freq, time, duration, level) {
    const ctx = this.context;
    if (!ctx || !this.dryBus || !(freq > 0)) return;

    const period = 1 / freq;
    const burst = this._noiseSource(Math.max(period * 2, 0.004));

    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = period;

    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = Math.min(6500, freq * 9);
    // WebAudio quirk: for lowpass filters Q is in DECIBELS, and any value
    // above 0 dB peaks over unity — which multiplied by the feedback made
    // this loop gain > 1 and the string explode instead of decaying.
    // -12 dB guarantees the loop is lossy at every frequency.
    damp.Q.value = -12;

    const feedback = ctx.createGain();
    // Longer sustain for lower strings, always strictly lossy.
    feedback.gain.value = Math.min(0.95, 0.87 + 12 / freq);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, time);
    gain.gain.setTargetAtTime(0.0001, time + duration * 0.6, duration * 0.25);

    burst.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    delay.connect(gain);

    const send = this._route(gain, 0.22);

    burst.start(time);
    burst.stop(time + 0.05);

    // The loop has no natural end — stop it by killing the feedback.
    feedback.gain.setValueAtTime(feedback.gain.value, time + duration);
    feedback.gain.linearRampToValueAtTime(0, time + duration + 0.08);
    this._autoDisconnect(burst, [delay, damp, feedback, gain, send], time + duration + 0.6);
  }

  /** Brass stab: detuned saw unison + a fifth through a filter envelope. */
  _playBrassStab(scaleDegree, duration, time) {
    const ctx = this.context;
    if (!ctx || !this.dryBus) return;

    const freq = this._degreeToFreq(scaleDegree, 1);
    const detunes = [-7, 0, 7];
    const oscs = detunes.map((cents) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, time);
      o.detune.value = cents;
      return o;
    });
    const fifth = ctx.createOscillator();
    fifth.type = 'sawtooth';
    fifth.frequency.setValueAtTime(freq * 1.5, time);
    oscs.push(fifth);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2.2;
    filter.frequency.setValueAtTime(420, time);
    filter.frequency.exponentialRampToValueAtTime(2100, time + 0.1);
    filter.frequency.exponentialRampToValueAtTime(520, time + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.14, time + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    const send = this._route(gain, 0.35);

    oscs.forEach((o) => { o.connect(filter); o.start(time); o.stop(time + duration + 0.1); });
    filter.connect(gain);

    this._autoDisconnect(oscs[0], [...oscs.slice(1), filter, gain, send]);
  }

  /** Timpani: a pitched sine drop with a noise thump — it has a note now. */
  _playTimpani(time, chordRoot = 0, level = 1) {
    const ctx = this.context;
    if (!ctx || !this.dryBus) return;

    const f0 = this._degreeToFreq(chordRoot, 0);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * 2.2, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f0 * 0.9, 40), time + 0.13);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.3 * level, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.45);

    const thump = this._noiseSource(0.06);
    const thumpFilter = ctx.createBiquadFilter();
    thumpFilter.type = 'lowpass';
    thumpFilter.frequency.value = 300;
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.12 * level, time);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

    const send = this._route(gain, 0.3);
    const thumpSend = this._route(thumpGain, 0.3);

    osc.connect(gain);
    thump.connect(thumpFilter);
    thumpFilter.connect(thumpGain);

    osc.start(time);
    osc.stop(time + 0.5);
    thump.start(time);
    thump.stop(time + 0.07);

    this._autoDisconnect(osc, [gain, thump, thumpFilter, thumpGain, send, thumpSend]);
  }

  /** Rimshot/castanet: a snapped burst of high noise. */
  _playRimshot(time) {
    const ctx = this.context;
    if (!ctx || !this.dryBus) return;

    const source = this._noiseSource(0.04);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 1.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.09, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

    const send = this._route(gain, 0.25);

    source.connect(filter);
    filter.connect(gain);
    source.start(time);
    source.stop(time + 0.05);

    this._autoDisconnect(source, [filter, gain, send]);
  }

  /** Low drone: detuned triangles on the tonic pedal, fifth added when soaring. */
  _playDrone(time, duration, withFifth) {
    const ctx = this.context;
    if (!ctx || !this.dryBus) return;

    const freq = this._degreeToFreq(0, 0);
    const freqs = withFifth ? [freq, freq * 1.008, freq * 1.5] : [freq, freq * 1.008];
    const oscs = freqs.map((f) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      return o;
    });

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.13, time + 1.2);
    gain.gain.setTargetAtTime(0.0001, time + duration - 1.0, 0.6);

    const send = this._route(gain, 0.3);

    oscs.forEach((o) => { o.connect(filter); o.start(time); o.stop(time + duration + 0.3); });
    filter.connect(gain);

    this._autoDisconnect(oscs[0], [...oscs.slice(1), filter, gain, send]);
  }

  /** Pad: slow detuned-saw chord swell for night skies. */
  _playPad(chordDegrees, time, duration) {
    const ctx = this.context;
    if (!ctx || !this.dryBus) return;

    const nodes = [];
    let first = null;
    chordDegrees.forEach((degree) => {
      [-8, 8].forEach((cents) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = this._degreeToFreq(degree, 1);
        osc.detune.value = cents;
        nodes.push(osc);
        if (!first) first = osc;
      });
    });

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 850;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.045, time + duration * 0.45);
    gain.gain.linearRampToValueAtTime(0.0001, time + duration);

    const send = this._route(gain, 0.55);

    nodes.forEach((o) => { o.connect(filter); o.start(time); o.stop(time + duration + 0.2); });
    filter.connect(gain);

    this._autoDisconnect(first, [...nodes.slice(1), filter, gain, send]);
  }

  // --- Utilities -----------------------------------------------------------

  _noiseSource(seconds) {
    const ctx = this.context;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  }

  _degreeToFreq(scaleDegree, octaveOffset = 0) {
    const steps = this.mode.steps;
    const idx = ((scaleDegree % steps.length) + steps.length) % steps.length;
    const octave = Math.floor(scaleDegree / steps.length);
    const midi = this.rootNote + (octave + octaveOffset) * 12 + steps[idx];
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /**
   * Disconnect a voice's nodes when its source ends (or at endTime for
   * sources whose onended fires early, like the Karplus burst).
   */
  _autoDisconnect(source, nodes, endTime = null) {
    const cleanup = () => {
      try {
        nodes.forEach((node) => node.disconnect());
      } catch (e) {
        // Already disconnected.
      }
    };
    if (endTime !== null && this.context) {
      const ms = Math.max(0, (endTime - this.context.currentTime) * 1000) + 50;
      setTimeout(cleanup, ms);
    } else {
      source.onended = cleanup;
    }
  }

  // --- Public API ----------------------------------------------------------

  setMuted(muted) {
    this.muted = !!muted;
    this._applyMasterVolume();
    this._saveSettings();
  }

  setVolume(volume) {
    this.masterVolume = Math.min(Math.max(Number(volume) || 0, 0), 1);
    this._applyMasterVolume();
    this._saveSettings();
  }

  setIntensity(intensity) {
    this.intensityOverride = intensity === null ? null : Math.min(Math.max(Number(intensity), 0), 1);
  }

  /**
   * worldAPI op — the genie's mixing desk.
   * setMusic({mood: 'auto'|'calm'|'epic'|'night'|'off', volume: 0..1})
   */
  setMusic(opts = {}) {
    if (typeof opts.mood === 'string' && MOODS.includes(opts.mood)) {
      this.mood = opts.mood;
      if (this.mood === 'off') {
        this._stopMusic();
      } else if (!this.isPlaying && this._gameStarted) {
        this._startMusic();
      }
    }
    if (opts.volume !== undefined && opts.volume !== null && Number.isFinite(Number(opts.volume))) {
      this.setVolume(Number(opts.volume));
    }
    return { mood: this.mood, volume: this.masterVolume, playing: this.isPlaying };
  }

  _applyMasterVolume() {
    if (!this.context || !this.masterGain) return;
    const target = this.muted ? 0 : this.masterVolume;
    this.masterGain.gain.setTargetAtTime(target, this.context.currentTime, 0.05);
  }

  _loadSettings() {
    try {
      const raw = localStorage.getItem('vc.music');
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Number.isFinite(saved.volume)) this.masterVolume = Math.min(Math.max(saved.volume, 0), 1);
      if (typeof saved.muted === 'boolean') this.muted = saved.muted;
    } catch (e) { /* corrupted settings are ignored */ }
  }

  _saveSettings() {
    try {
      localStorage.setItem('vc.music', JSON.stringify({ volume: this.masterVolume, muted: this.muted }));
    } catch (e) { /* storage full or unavailable */ }
  }

  // --- Teardown ------------------------------------------------------------

  destroy() {
    this._removeGestureListeners();

    const bus = this.engine ? this.engine.eventBus : null;
    if (bus && typeof bus.off === 'function' && this._onGameStarted) {
      bus.off('gameStarted', this._onGameStarted);
    }
    this._onGameStarted = null;

    this._stopMusic();

    if (typeof window !== 'undefined' && window.worldAPI) {
      for (const k of this._registeredOps) delete window.worldAPI[k];
      const meta = window.worldAPI.meta;
      if (meta && Array.isArray(meta.ops)) {
        meta.ops = meta.ops.filter((k) => !this._registeredOps.includes(k));
      }
    }
    this._registeredOps = [];

    if (this.context) {
      try { this.context.close().catch(() => {}); } catch (e) { /* already closed */ }
      this.context = null;
    }
    this.masterGain = null;
    this.compressor = null;
    this.dryBus = null;
    this.reverb = null;
    this.reverbReturn = null;
    this._watchdog = null;
    this._watchdogData = null;

    super.destroy();
  }
}
