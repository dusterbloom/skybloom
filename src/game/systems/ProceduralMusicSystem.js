import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';

/**
 * ProceduralMusicSystem — Ennio Morricone-inspired procedural soundtrack.
 *
 * Generates sparse, desert-atmosphere music entirely in real time using the
 * WebAudio API: whistled melodies, twangy guitar, distant brass stabs,
 * timpani/rimshot percussion, and a slow-moving drone, all bathed in a
 * generous plate-style reverb.
 *
 * The score reacts to gameplay:
 *   - Higher speed increases tempo and brings in percussion/brass.
 *   - Night time thins the arrangement and favors whistle/guitar.
 *   - The context is created lazily on first user gesture and suspends on
 *     tab hide, matching the behavior of ProceduralAudioSystem.
 */
export class ProceduralMusicSystem extends System {
  constructor(engine) {
    super(engine, 'proceduralMusic');

    this.supported = typeof window !== 'undefined' &&
      !!(window.AudioContext || window.webkitAudioContext);

    // WebAudio graph nodes (created lazily)
    this.context = null;
    this.masterGain = null;
    this.reverbGain = null;
    this.reverb = null;

    // Mix / playback state
    this.muted = false;
    this.masterVolume = 0.35;
    this.reverbSend = 0.45;
    this.intensityOverride = null;

    // Tempo and scheduling
    this.baseTempo = 75;
    this.maxTempo = 112;
    this.currentTempo = this.baseTempo;
    this.targetTempo = this.baseTempo;
    this.tempoSmoothing = 0.08;

    this.isPlaying = false;
    this.nextPhraseTime = 0;
    this.phraseCount = 0;
    this.beatDuration = 60 / this.baseTempo;
    this.phraseBeats = 16; // 4 bars of 4/4
    this.lookahead = 0.5;
    this.scheduleAheadTime = 0.15;

    // E harmonic minor: root, m2, m3, 4, 5, m6, 7
    this.scale = [0, 2, 3, 5, 7, 8, 11];
    this.rootNote = 40; // E2 (MIDI note number)

    // Motif banks (scale degrees relative to root, durations in beats)
    this.whistleMotifs = [
      { degrees: [0, 2, 4, 2, 0], rhythm: [1, 1, 2, 1, 1] },
      { degrees: [4, 3, 2, 0], rhythm: [1.5, 0.5, 1, 1] },
      { degrees: [0, 0, 4, 2, 3, 2], rhythm: [0.5, 0.5, 1, 0.5, 1, 0.5] },
      { degrees: [6, 4, 2, 0], rhythm: [2, 1, 1, 2] },
    ];

    this.guitarMotifs = [
      { degrees: [0, 4], rhythm: [2, 2] },
      { degrees: [0, 3, 4], rhythm: [1, 1, 2] },
      { degrees: [4, 2, 0], rhythm: [1, 1, 2] },
      { degrees: [0], rhythm: [4] },
    ];

    this.brassMotifs = [
      { degrees: [0, 4], rhythm: [2, 2] },
      { degrees: [4, 0], rhythm: [1, 3] },
      { degrees: [0], rhythm: [4] },
    ];

    // Listener bookkeeping
    this._gestureHandler = null;
    this._onGameStarted = null;
    this._suspendedByVisibility = false;
    this._gameStarted = false;
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
      // If the game already started before the gesture, begin playing now.
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

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
    this.masterGain.connect(ctx.destination);

    // Simple plate-style reverb using a multitap delay + feedback loop.
    this.reverb = this._buildReverb();
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = this.reverbSend;
    this.reverb.output.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGain);
  }

  _buildReverb() {
    const ctx = this.context;
    const input = ctx.createGain();
    const output = ctx.createGain();

    const delayTimes = [0.037, 0.051, 0.073, 0.097, 0.121];
    const taps = [];
    delayTimes.forEach((delaySec) => {
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = delaySec;
      const gain = ctx.createGain();
      gain.gain.value = 0.35;
      input.connect(delay);
      delay.connect(gain);
      gain.connect(output);
      taps.push({ delay, gain });
    });

    // Feedback path for a smooth tail
    const feedbackGain = ctx.createGain();
    feedbackGain.gain.value = 0.25;
    output.connect(feedbackGain);
    taps.forEach((tap) => {
      feedbackGain.connect(tap.delay);
    });

    return { input, output };
  }

  _reverbInput() {
    const ctx = this.context;
    const send = ctx.createGain();
    send.gain.value = 1.0;
    send.connect(this.reverb.input);
    return send;
  }

  // --- Playback control ---------------------------------------------------

  _startMusic() {
    if (!this.context || this.isPlaying) return;
    if (this.context.state === 'suspended') {
      this.context.resume().catch(() => {});
    }
    this.isPlaying = true;
    this.nextPhraseTime = this.context.currentTime + 0.5;
    this.phraseCount = 0;
    Logger.info('ProceduralMusicSystem: music started');
  }

  _stopMusic() {
    this.isPlaying = false;
  }

  // --- Per-frame update ----------------------------------------------------

  _update(delta, elapsed) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.isPlaying) return;

    // Smooth tempo toward target based on intensity.
    const intensity = this._getIntensity();
    this.targetTempo = this.baseTempo + intensity * (this.maxTempo - this.baseTempo);
    this.currentTempo += (this.targetTempo - this.currentTempo) *
      (1 - Math.exp(-delta / this.tempoSmoothing));
    this.beatDuration = 60 / this.currentTempo;

    // Schedule phrases as we approach them.
    while (this.nextPhraseTime < ctx.currentTime + this.lookahead) {
      this._schedulePhrase(this.nextPhraseTime, intensity);
      this.nextPhraseTime += this.phraseBeats * this.beatDuration;
      this.phraseCount++;
    }
  }

  _getIntensity() {
    if (this.intensityOverride !== null) {
      return Math.min(Math.max(this.intensityOverride, 0), 1);
    }

    const playerState = this.engine.systems.get('playerState');
    const velocity = playerState && playerState.localPlayer
      ? playerState.localPlayer.velocity
      : null;
    const speed = velocity && typeof velocity.length === 'function'
      ? velocity.length()
      : 0;

    // Map typical flight speed 20-220 to intensity 0-1.
    let intensity = (speed - 20) / 200;
    intensity = Math.min(Math.max(intensity, 0), 1);

    // Night thins the arrangement slightly.
    const atmosphere = this.engine.systems.get('atmosphere');
    const timeOfDay = atmosphere && typeof atmosphere.timeOfDay === 'number'
      ? atmosphere.timeOfDay
      : 0.5;
    const isNight = timeOfDay < 0.25 || timeOfDay > 0.75;
    if (isNight) {
      intensity *= 0.7;
    }

    return intensity;
  }

  // --- Phrase scheduler ----------------------------------------------------

  _schedulePhrase(startTime, intensity) {
    const beat = this.beatDuration;
    const phraseEnd = startTime + this.phraseBeats * beat;

    // Always play a slow drone under the phrase.
    this._playDrone(startTime, this.phraseBeats * beat);

    // Decide which layers are active this phrase.
    const whistleActive = true;
    const guitarActive = Math.random() < 0.85;
    const brassActive = intensity > 0.35 && Math.random() < 0.55;
    const percussionActive = intensity > 0.5 && Math.random() < 0.6;

    // Whistle: one motif somewhere in the phrase.
    if (whistleActive) {
      const motif = this._pick(this.whistleMotifs);
      const offsetBeats = Math.random() < 0.5 ? 0 : 8;
      this._scheduleMotif(motif, startTime + offsetBeats * beat, beat, 'whistle');
    }

    // Guitar: sparse comping on downbeats and offbeats.
    if (guitarActive) {
      const motif = this._pick(this.guitarMotifs);
      this._scheduleMotif(motif, startTime, beat, 'guitar');
      if (Math.random() < 0.4) {
        const motif2 = this._pick(this.guitarMotifs);
        this._scheduleMotif(motif2, startTime + 8 * beat, beat, 'guitar');
      }
    }

    // Brass: dramatic stabs, more frequent as intensity rises.
    if (brassActive) {
      const motif = this._pick(this.brassMotifs);
      const offset = Math.floor(Math.random() * 8) * beat;
      this._scheduleMotif(motif, startTime + offset, beat, 'brass');
      if (intensity > 0.7 && Math.random() < 0.5) {
        const motif2 = this._pick(this.brassMotifs);
        this._scheduleMotif(motif2, startTime + (offset + 8 * beat) % (this.phraseBeats * beat), beat, 'brass');
      }
    }

    // Percussion: timpani on downbeats, rimshots on backbeats.
    if (percussionActive) {
      this._playPercussion('timpani', startTime);
      this._playPercussion('timpani', startTime + 8 * beat);
      if (intensity > 0.75) {
        this._playPercussion('rimshot', startTime + 2 * beat);
        this._playPercussion('rimshot', startTime + 10 * beat);
      }
    }

    // Occasional pad swell near the end of the phrase for cinematic lift.
    if (this.phraseCount % 4 === 3) {
      this._playPadSwell(startTime + 12 * beat, 4 * beat);
    }
  }

  _scheduleMotif(motif, startTime, beatDuration, instrument) {
    let cursor = 0;
    for (let i = 0; i < motif.degrees.length; i++) {
      const degree = motif.degrees[i];
      const duration = (motif.rhythm[i] || 1) * beatDuration;
      const time = startTime + cursor;

      if (instrument === 'whistle') {
        this._playWhistle(degree, duration, time);
      } else if (instrument === 'guitar') {
        this._playGuitarTwang(degree, duration, time);
      } else if (instrument === 'brass') {
        this._playBrassStab(degree, duration, time);
      }

      cursor += duration;
    }
  }

  // --- Instrument voices ---------------------------------------------------

  /** Whistle: pure sine with subtle vibrato and a gentle, breathy envelope. */
  _playWhistle(scaleDegree, duration, time) {
    const ctx = this.context;
    if (!ctx || !this.masterGain) return;

    const freq = this._degreeToFreq(scaleDegree, 2);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    // Vibrato: 5.5 Hz, ±8 cents.
    const vibrato = ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 5.5;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = freq * 0.005;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);
    vibrato.start(time);
    vibrato.stop(time + duration + 0.1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.18, time + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    const reverbSend = this._reverbInput();

    osc.connect(gain);
    gain.connect(this.masterGain);
    gain.connect(reverbSend);

    osc.start(time);
    osc.stop(time + duration + 0.1);

    this._autoDisconnect(osc, [gain, vibrato, vibratoGain, reverbSend]);
  }

  /** Guitar twang: filtered sawtooth pluck with a sharp attack/decay. */
  _playGuitarTwang(scaleDegree, duration, time) {
    const ctx = this.context;
    if (!ctx || !this.masterGain) return;

    const freq = this._degreeToFreq(scaleDegree, 2);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    // Slight detune for thickness.
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(freq * 1.005, time);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2.5;
    filter.frequency.setValueAtTime(3000, time);
    filter.frequency.exponentialRampToValueAtTime(400, time + 0.3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.16, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(duration, 0.35));

    const reverbSend = this._reverbInput();

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    gain.connect(reverbSend);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + duration + 0.15);
    osc2.stop(time + duration + 0.15);

    this._autoDisconnect(osc, [osc2, filter, gain, reverbSend]);
  }

  /** Brass stab: sawtooth/square mix through a filter envelope. */
  _playBrassStab(scaleDegree, duration, time) {
    const ctx = this.context;
    if (!ctx || !this.masterGain) return;

    const freq = this._degreeToFreq(scaleDegree, 1);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(freq * 0.995, time);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3.0;
    filter.frequency.setValueAtTime(600, time);
    filter.frequency.exponentialRampToValueAtTime(1800, time + 0.08);
    filter.frequency.exponentialRampToValueAtTime(500, time + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.2, time + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    const reverbSend = this._reverbInput();

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    gain.connect(reverbSend);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + duration + 0.1);
    osc2.stop(time + duration + 0.1);

    this._autoDisconnect(osc, [osc2, filter, gain, reverbSend]);
  }

  /** Percussion: noise burst filtered for timpani (low) or rimshot (high). */
  _playPercussion(type, time) {
    const ctx = this.context;
    if (!ctx || !this.masterGain) return;

    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * 0.2));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const isTimpani = type === 'timpani';
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = isTimpani ? 120 : 2500;
    filter.Q.value = isTimpani ? 1.2 : 2.0;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(isTimpani ? 0.28 : 0.12, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + (isTimpani ? 0.4 : 0.08));

    const reverbSend = this._reverbInput();

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    gain.connect(reverbSend);

    source.start(time);
    source.stop(time + (isTimpani ? 0.5 : 0.15));

    this._autoDisconnect(source, [filter, gain, reverbSend]);
  }

  /** Low drone: a pair of detuned triangle oscillators for a wide, dusty bed. */
  _playDrone(time, duration) {
    const ctx = this.context;
    if (!ctx || !this.masterGain) return;

    const freq = this._degreeToFreq(0, 0); // Root, two octaves below melody
    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.value = freq;

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 1.015;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280;
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.14, time + 1.0);
    gain.gain.setTargetAtTime(0.0001, time + duration - 1.0, 0.6);

    const reverbSend = this._reverbInput();

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    gain.connect(reverbSend);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + duration + 0.2);
    osc2.stop(time + duration + 0.2);

    this._autoDisconnect(osc1, [osc2, filter, gain, reverbSend]);
  }

  /** Pad swell: a slow brass-like chord for cinematic transitions. */
  _playPadSwell(time, duration) {
    const ctx = this.context;
    if (!ctx || !this.masterGain) return;

    const chordDegrees = [0, 4, 6];
    chordDegrees.forEach((degree) => {
      const freq = this._degreeToFreq(degree, 1);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.06, time + duration * 0.5);
      gain.gain.linearRampToValueAtTime(0.0001, time + duration);

      const reverbSend = this._reverbInput();

      osc.connect(gain);
      gain.connect(this.masterGain);
      gain.connect(reverbSend);

      osc.start(time);
      osc.stop(time + duration + 0.2);

      this._autoDisconnect(osc, [gain, reverbSend]);
    });
  }

  // --- Utilities -----------------------------------------------------------

  _degreeToFreq(scaleDegree, octaveOffset = 0) {
    const semitones = this.scale[((scaleDegree % this.scale.length) + this.scale.length) % this.scale.length];
    const octave = Math.floor(scaleDegree / this.scale.length);
    const midi = this.rootNote + (octave + octaveOffset) * 12 + semitones;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  _pick(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  _autoDisconnect(source, nodes) {
    source.onended = () => {
      try {
        nodes.forEach((node) => node.disconnect());
      } catch (e) {
        // Already disconnected.
      }
    };
  }

  // --- Public API ----------------------------------------------------------

  setMuted(muted) {
    this.muted = !!muted;
    this._applyMasterVolume();
  }

  setVolume(volume) {
    this.masterVolume = Math.min(Math.max(Number(volume) || 0, 0), 1);
    this._applyMasterVolume();
  }

  setIntensity(intensity) {
    this.intensityOverride = intensity === null ? null : Math.min(Math.max(Number(intensity), 0), 1);
  }

  _applyMasterVolume() {
    if (!this.context || !this.masterGain) return;
    const target = this.muted ? 0 : this.masterVolume;
    this.masterGain.gain.setTargetAtTime(target, this.context.currentTime, 0.05);
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

    if (this.context) {
      try { this.context.close().catch(() => {}); } catch (e) { /* already closed */ }
      this.context = null;
    }
    this.masterGain = null;
    this.reverbGain = null;
    this.reverb = null;

    super.destroy();
  }
}
