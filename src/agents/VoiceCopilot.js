/**
 * VoiceCopilot — talk to the carpet, it talks back AND does what you ask. Fully
 * in the browser, no server: the browser's Speech Recognition for input, a
 * pluggable LLM provider (cloud Claude / OpenAI-compatible / on-device WebLLM)
 * for the brain, and browser speechSynthesis or on-device Kokoro for output.
 *
 * It is open-ended, not racing-only: each turn the LLM returns a spoken reply AND
 * an intent, which it hands to a Companion controller — roam, go to a landmark,
 * collect mana, race, hover, or hand control back. It's grounded: every turn it
 * folds window.agentAPI.observe() (landmarks, mana, race, kinematics) into the
 * prompt, so it talks and acts about the actual world.
 *
 * DevTools:
 *   const { VoiceCopilot } = await import('/src/agents/VoiceCopilot.js');
 *   const v = await new VoiceCopilot(window.agentAPI,
 *     { config: { provider:'openai', baseURL:'http://localhost:1234/v1', model:'local-model' } }).start();
 *   v.listen();              // push-to-talk one turn
 *   v.say('take me to the crystal formation');
 */
import { createProvider } from './llmProviders.js';
import { Companion } from './Companion.js';

const SYSTEM = `You are the voice of a magical flying carpet — a warm, witty co-pilot in the game SkyBloom, free to roam an open world, visit landmarks, gather mana, fly alongside the player, or race.
Each turn you get the live GAME STATE. Reply with ONLY a JSON object, nothing else:
{"reply":"<one or two short SPOKEN sentences — no markdown, no emoji>","intent":"chat|roam|goto|collect|race|hover|manual","target":<a landmark type for goto else null>}
Intents:
- chat: just talk; keep doing whatever you were doing.
- roam: wander and explore the world.
- goto: fly to a landmark; set target to one of ancient_ruins, magical_circle, crystal_formation (pick the most sensible from the state).
- collect: go gather nearby mana.
- race: start or continue a gate race.
- hover: stop and hold position.
- manual: give control back to the human.
Pick the intent that matches what the player asked; default to "chat" if they're just talking. Speak naturally; never read the JSON aloud.`;

function parseJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) {
    const m = text.match(/\{[\s\S]*\}/); // tolerate prose around the JSON
    if (m) { try { return JSON.parse(m[0]); } catch (e2) { /* give up */ } }
  }
  return null;
}

export class VoiceCopilot {
  constructor(api = window.agentAPI, opts = {}) {
    this.api = api;
    this.config = opts.config || {};
    this.tts = this.config.tts === 'kokoro' ? 'kokoro' : 'browser';
    this.onText = opts.onText || (() => {});
    this.onState = opts.onState || (() => {});
    this.history = [];
    this._provider = null;
    this.companion = null;
    this._rec = null;
    this._listening = false;
    this._kokoro = null;
    this._voice = this.config.voice || 'af_heart';
    this._audioCtx = null;
    this.state = 'idle';
  }

  async start() {
    this._provider = await createProvider(this.config);
    if (this.tts === 'kokoro') await this._initKokoro();
    this._setState('ready');
    return this;
  }

  stop() {
    this.stopListening();
    if (this.companion) { try { this.companion.stop(); } catch (e) { /* ignore */ } this.companion = null; }
    try { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    this._setState('off');
    return this;
  }

  /** One push-to-talk turn: listen until silence, transcribe, then act + reply. */
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

  /** Take a text turn (from speech or typed): reason -> act on intent -> speak. */
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
    let intent = 'chat';
    let target = null;
    try {
      const raw = await this._provider.complete(messages);
      const obj = parseJSON(raw);
      if (obj) {
        reply = String(obj.reply || '').trim();
        intent = String(obj.intent || 'chat').trim().toLowerCase();
        target = typeof obj.target === 'string' ? obj.target : null;
      } else {
        reply = (raw || '').trim(); // model ignored the format — just say it
      }
    } catch (e) {
      reply = `Comms trouble — ${e && e.message ? e.message : 'no answer'}.`;
    }
    if (!reply) reply = '…';

    this.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    this.onText({ role: 'assistant', text: reply });

    // Act first (start flying immediately), then speak over it.
    this._applyIntent(intent, target);
    this._setState('speaking');
    await this._speak(reply);
    this._setState('ready');
    return reply;
  }

  _applyIntent(intent, target) {
    if (!intent || intent === 'chat') return;
    if (intent === 'manual') { if (this.companion) this.companion.setGoal('manual'); return; }
    this._ensureCompanion().setGoal(intent, target);
  }

  _ensureCompanion() {
    if (!this.companion) {
      this.companion = new Companion(this.api, {
        onGoal: (g) => this.onText({ role: 'system', text: `(flying: ${g.type}${g.target ? ' → ' + g.target : ''})` }),
      });
      this.companion.start();
    }
    return this.companion;
  }

  _stateSummary() {
    try {
      const o = this.api && this.api.observe && this.api.observe();
      if (!o || !o.self) return 'on the title screen, not flying yet';
      const parts = [`speed ${Math.round(o.self.speed)}`, `altitude ${Math.round(o.self.altitude)}`, `mana ${Math.round(o.self.mana || 0)}`];
      if (o.race && o.race.state && o.race.state !== 'idle') parts.push(`race ${o.race.state}, gate ${o.race.gateIndex + 1} of ${o.race.gateCount || '?'}`);
      const lms = (o.nearby && o.nearby.landmarks) || [];
      if (lms.length) parts.push('landmarks in sight: ' + lms.slice(0, 3).map((l) => `${l.type} (${Math.round(l.dist)} units, ${l.bearing < 0 ? 'left' : 'right'})`).join(', '));
      const mn = (o.nearby && o.nearby.manaNodes) || [];
      if (mn.length) parts.push(`${mn.length} mana node(s) nearby`);
      parts.push(`current goal: ${this.companion ? this.companion.goal.type : 'manual (human flying)'}`);
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

  // ponytail: Kokoro loads from a CDN only when chosen — no npm dep. Defensive
  // about the kokoro-js return shape so a minor API bump won't break it.
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
