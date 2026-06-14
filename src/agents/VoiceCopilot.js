/**
 * VoiceCopilot — talk to the carpet, it talks back. Entirely in the browser, no
 * server: the browser's own Speech Recognition for ears, a pluggable LLM provider
 * (cloud Claude / OpenAI-compatible / on-device WebLLM) for the brain, and either
 * the browser's speechSynthesis or on-device Kokoro for the mouth.
 *
 * It's grounded: every turn it reads window.agentAPI.observe() and folds the live
 * flight state into the prompt, so it can talk about your race, not just chat.
 *
 * DevTools:
 *   const { VoiceCopilot } = await import('/src/agents/VoiceCopilot.js');
 *   const v = await new VoiceCopilot(window.agentAPI,
 *     { config: { provider:'openai', baseURL:'http://localhost:1234/v1', model:'local-model' } }).start();
 *   v.listen();        // push-to-talk one turn
 *   v.say('how am I doing?');  // or feed text directly
 */
import { createProvider } from './llmProviders.js';

const SYSTEM = `You are the voice of a magical flying carpet — a witty, warm co-pilot in the game SkyBloom.
Reply in ONE or TWO short SPOKEN sentences. No lists, no markdown, no emoji, no stage directions — your words are read aloud.
Each turn you are given the live GAME STATE (speed, altitude, race progress, the next gate's distance and which side it's on). Reference it naturally when it helps; don't recite it.
If the player asks for something you can't do, say so briefly and move on.`;

export class VoiceCopilot {
  /**
   * @param {object} api   Agent API (defaults to window.agentAPI).
   * @param {object} opts  { config: {provider,...,tts:'browser'|'kokoro',voice}, onText({role,text}), onState(s) }
   */
  constructor(api = window.agentAPI, opts = {}) {
    this.api = api;
    this.config = opts.config || {};
    this.tts = this.config.tts === 'kokoro' ? 'kokoro' : 'browser';
    this.onText = opts.onText || (() => {});
    this.onState = opts.onState || (() => {});
    this.history = [];
    this._provider = null;
    this._rec = null;
    this._listening = false;
    this._kokoro = null;
    this._voice = this.config.voice || 'af_heart';
    this._audioCtx = null;
    this.state = 'idle';
  }

  /** Build the provider (and load Kokoro if chosen), then be ready to listen. */
  async start() {
    this._provider = await createProvider(this.config);
    if (this.tts === 'kokoro') await this._initKokoro();
    this._setState('ready');
    return this;
  }

  stop() {
    this.stopListening();
    try { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    this._setState('off');
    return this;
  }

  /** One push-to-talk turn: listen until silence, transcribe, then reply. */
  listen() {
    if (this._listening) return;
    const SR = (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) { this._setState('no-mic'); this.onText({ role: 'system', text: 'Speech input not supported here — try Chrome, or call say("...") with text.' }); return; }
    const rec = new SR();
    rec.lang = this.config.lang || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => { const t = e.results[0][0].transcript; if (t) this.say(t); };
    rec.onerror = () => { this._listening = false; this._setState('ready'); };
    rec.onend = () => { this._listening = false; if (this.state === 'listening') this._setState('ready'); };
    this._rec = rec;
    this._listening = true;
    this._setState('listening');
    try { rec.start(); } catch (e) { this._listening = false; this._setState('ready'); }
  }

  stopListening() {
    this._listening = false;
    if (this._rec) { try { this._rec.stop(); } catch (e) { /* already stopped */ } this._rec = null; }
  }

  /** Take a text turn (from speech or typed), get + speak a reply. Returns the reply. */
  async say(text) {
    if (!text || !this._provider) return '';
    this.onText({ role: 'user', text });
    this._setState('thinking');
    const messages = [
      { role: 'system', content: SYSTEM },
      ...this.history.slice(-8),
      { role: 'user', content: `${text}\n\n[GAME STATE: ${this._stateSummary()}]` },
    ];
    let reply = '';
    try {
      reply = (await this._provider.complete(messages) || '').trim();
    } catch (e) {
      reply = `Comms trouble — ${e && e.message ? e.message : 'no answer'}.`;
    }
    this.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    this.onText({ role: 'assistant', text: reply });
    this._setState('speaking');
    await this._speak(reply);
    this._setState('ready');
    return reply;
  }

  _stateSummary() {
    try {
      const o = this.api && this.api.observe && this.api.observe();
      if (!o || !o.self) return 'on the title screen, not flying yet';
      const parts = [`speed ${Math.round(o.self.speed)}`, `altitude ${Math.round(o.self.altitude)}`];
      if (o.race) {
        parts.push(`race ${o.race.state}, gate ${o.race.gateIndex + 1} of ${o.race.gateCount || '?'}`);
        const g = o.race.nextGates && o.race.nextGates[0];
        if (g) parts.push(`next gate ${Math.round(g.dist)} units away, ${g.bearing < 0 ? 'to the left' : 'to the right'}`);
      }
      return parts.join('; ');
    } catch (e) { return 'unknown'; }
  }

  async _speak(text) {
    if (!text) return;
    if (this.tts === 'kokoro' && this._kokoro) {
      try { return await this._speakKokoro(text); } catch (e) { /* fall back to the browser voice */ }
    }
    return this._speakBrowser(text);
  }

  _speakBrowser(text) {
    return new Promise((resolve) => {
      try {
        if (typeof window === 'undefined' || !window.speechSynthesis) return resolve();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.0;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      } catch (e) { resolve(); }
    });
  }

  // ponytail: Kokoro loads from a CDN only when the natural voice is chosen — no npm
  // dep. Defensive about the kokoro-js return shape so a minor API bump won't break it.
  async _initKokoro() {
    const mod = await import(/* @vite-ignore */ 'https://esm.run/kokoro-js');
    const KokoroTTS = mod.KokoroTTS || (mod.default && mod.default.KokoroTTS) || mod.default;
    this._kokoro = await KokoroTTS.from_pretrained(this.config.kokoroModel || 'onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: this.config.kokoroDtype || 'q8',
      device: (typeof navigator !== 'undefined' && navigator.gpu) ? 'webgpu' : 'wasm',
    });
  }

  async _speakKokoro(text) {
    const out = await this._kokoro.generate(text, { voice: this._voice });
    const pcm = out.audio || out.waveform || (out.data && out.data.audio) || out;
    const rate = out.sampling_rate || out.sampleRate || 24000;
    if (!pcm || !pcm.length) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this._audioCtx || (this._audioCtx = new AC());
    const buf = ctx.createBuffer(1, pcm.length, rate);
    buf.copyToChannel(pcm instanceof Float32Array ? pcm : Float32Array.from(pcm), 0);
    await new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => resolve();
      src.start();
    });
  }

  _setState(s) { this.state = s; this.onState(s); }
}

if (typeof window !== 'undefined') window.VoiceCopilot = VoiceCopilot;
