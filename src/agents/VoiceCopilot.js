/**
 * VoiceCopilot — talk to the carpet, it talks back AND does what you ask. Fully
 * in the browser, no server: the browser's Speech Recognition for input, a
 * pluggable LLM provider (cloud Claude / OpenAI-compatible / on-device WebLLM)
 * for the brain, and a pluggable voice for output: the browser's speechSynthesis,
 * or on-device neural TTS — Kokoro or Supertonic-3 — via config.tts.
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
 *
 * Voice (config.tts): 'supertonic' (default, English), 'kokoro', or 'browser'. Supertonic-3
 * extras: supertonicVoice 'F1'..'F5'/'M1'..'M5' (default 'M2'), supertonicSteps
 * (flow-matching denoise steps, default 4). A neural voice that fails to load
 * falls back to the browser voice — it never blocks the co-pilot.
 */
import { createProvider } from './llmProviders.js';
import { Companion } from './Companion.js';

const SYSTEM = `You are the voice of a magical flying carpet — a warm, witty co-pilot in the game SkyBloom, free to roam an open world, visit landmarks, gather mana, fly alongside the player, or race.
Each turn you get the live GAME STATE. Reply with ONLY a JSON object, nothing else:
{"reply":"<one or two short SPOKEN sentences — no markdown, no emoji>","intent":"chat|roam|goto|collect|race|hover|manual","target":<a landmark type for goto else null>,"world":<null, or a creative world edit (see below)>}
Intents (what to DO):
- chat: just talk; keep doing whatever you were doing.
- roam: wander and explore the world.
- goto: fly to a landmark; set target to one of ancient_ruins, magical_circle, crystal_formation.
- collect: go gather nearby mana.
- race: start or continue a gate race.
- hover: stop and hold position.
- manual: give control back to the human.
You can ALSO reshape the world (creative power). When the player asks for it, set "world" to:
{"op":"raiseTerrain|carveTerrain|spawnMana|setTimeOfDay|reroll|clearTerrain","where":"ahead|here","radius":<50-800>,"amount":<40-300>,"t":<0..1 time: 0 midnight, 0.25 sunrise, 0.5 noon, 0.65 sunset>}
- raiseTerrain raises a hill/mountain; carveTerrain digs a crater/canyon; spawnMana drops a mana orb; setTimeOfDay changes the light; reroll regenerates the whole landscape; clearTerrain undoes your terrain edits.
- "where" places terrain/mana ahead of the carpet (default) or here. Leave "world" null when not editing.
Default intent to "chat" if they're only talking. Speak naturally; never read the JSON aloud.`;

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
    // Supertonic-3 (English) is the default voice; pass config.tts to override.
    this.tts = ['browser', 'kokoro', 'supertonic'].includes(this.config.tts) ? this.config.tts : 'supertonic';
    this.lang = this.config.lang || 'en-US';
    this.onText = opts.onText || (() => {});
    this.onState = opts.onState || (() => {});
    this.onGoal = opts.onGoal || (() => {}); // host hook: fires when the companion's goal changes
    this.history = [];
    this._provider = null;
    this.companion = null;
    this._rec = null;
    this._listening = false;
    this._kokoro = null;
    this._supertonic = null;
    this._voice = this.config.voice || 'af_heart';
    this._audioCtx = null;
    this.state = 'idle';
  }

  async start() {
    // Create/unlock the AudioContext NOW, while we're still inside the user's
    // click on the Talk button — browsers block audio created off a gesture, so
    // a context made lazily after the async LLM call would stay suspended and
    // Kokoro/Supertonic would render silently. This is the gesture that unlocks it.
    this._ensureAudio();
    this._provider = await createProvider(this.config);
    try {
      if (this.tts === 'kokoro') await this._initKokoro();
      else if (this.tts === 'supertonic') await this._initSupertonic();
    } catch (e) {
      // a TTS that won't load must not block the co-pilot — fall back to the browser voice
      this.onText({ role: 'system', text: `(${this.tts} voice unavailable — using the browser voice)` });
      this.tts = 'browser';
    }
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

  // Create the WebAudio context and resume it if suspended. Only effective at
  // unlocking audio when called synchronously inside a user gesture.
  _ensureAudio() {
    try {
      if (typeof window === 'undefined') return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!this._audioCtx) this._audioCtx = new AC();
      if (this._audioCtx.state === 'suspended') this._audioCtx.resume().catch(() => {});
      return this._audioCtx;
    } catch (e) { return null; }
  }

  /** One push-to-talk turn: listen until silence, transcribe, then act + reply. */
  listen() {
    this._ensureAudio(); // pressing Talk is a gesture — keep audio unlocked
    if (this._listening) return;
    const SR = (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) { this._setState('no-mic'); this.onText({ role: 'system', text: 'Speech input not supported here — try Chrome, or call say("...") with text.' }); return; }
    const rec = new SR();
    rec.lang = this.lang;
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
    let world = null;
    try {
      const raw = await this._provider.complete(messages);
      const obj = parseJSON(raw);
      if (obj) {
        reply = String(obj.reply || '').trim();
        intent = String(obj.intent || 'chat').trim().toLowerCase();
        target = typeof obj.target === 'string' ? obj.target : null;
        world = obj.world && typeof obj.world === 'object' ? obj.world : null;
      } else {
        reply = (raw || '').trim(); // model ignored the format — just say it
      }
    } catch (e) {
      reply = `Comms trouble — ${e && e.message ? e.message : 'no answer'}.`;
    }
    if (!reply) reply = '…';

    this.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    this.onText({ role: 'assistant', text: reply });

    // Act first (start flying / edit the world immediately), then speak over it.
    this._applyIntent(intent, target);
    this._applyWorld(world);
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
        onGoal: (g) => {
          this.onGoal(g); // let the host arbitrate control (stop other autonomous drivers)
          this.onText({ role: 'system', text: `(flying: ${g.type}${g.target ? ' → ' + g.target : ''})` });
        },
      });
      this.companion.start();
    }
    return this.companion;
  }

  _applyWorld(w) {
    if (!w || typeof w !== 'object' || !w.op) return;
    const api = (typeof window !== 'undefined') && window.worldAPI;
    if (!api) { this.onText({ role: 'system', text: '(world editing not available)' }); return; }
    const op = String(w.op);
    try {
      if (op === 'setTimeOfDay') { if (api.setTimeOfDay) api.setTimeOfDay(Number(w.t)); }
      else if (op === 'reroll') { if (api.reroll) api.reroll(); }
      else if (op === 'clearTerrain') { if (api.clearTerrain) api.clearTerrain(); }
      else {
        const p = this._worldPoint(w.where);
        if (!p) { this.onText({ role: 'system', text: '(can’t place that yet — take off first)' }); return; }
        if (op === 'raiseTerrain' && api.raiseTerrain) api.raiseTerrain(p.x, p.z, Number(w.radius) || 250, Math.abs(Number(w.amount) || 170));
        else if (op === 'carveTerrain' && api.carveTerrain) api.carveTerrain(p.x, p.z, Number(w.radius) || 250, Math.abs(Number(w.amount) || 150));
        else if (op === 'spawnMana' && api.spawnMana) api.spawnMana(p.x, p.z);
      }
      this.onText({ role: 'system', text: `(world: ${op})` });
    } catch (e) { /* a world edit must never break the conversation */ }
  }

  // A world point ahead of the carpet (default) or right here, from the live state.
  _worldPoint(where) {
    try {
      const o = this.api && this.api.observe && this.api.observe();
      if (!o || !o.self || !o.self.pos) return null;
      const p = o.self.pos;
      if (where === 'here') return { x: p[0], z: p[2] };
      const h = Number(o.self.heading) || 0;
      const dist = 340;
      return { x: p[0] + Math.sin(h) * dist, z: p[2] + Math.cos(h) * dist };
    } catch (e) { return null; }
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
    if (this.tts === 'supertonic' && this._supertonic) {
      try { const out = await this._supertonic.generate(text); return await this._playPCM(out.audio, out.sampleRate); } catch (e) { /* fall back */ }
    }
    return this._speakBrowser(text);
  }

  _speakBrowser(text) {
    return new Promise((resolve) => {
      try {
        if (typeof window === 'undefined' || !window.speechSynthesis) return resolve();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = this.lang;
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
    return this._playPCM(pcm, rate);
  }

  // ponytail: Supertonic-3 loads from a CDN/HF only when chosen — no npm dep.
  async _initSupertonic() {
    const { createSupertonicTTS } = await import('./supertonicTTS.js');
    this._supertonic = await createSupertonicTTS({
      voice: this.config.supertonicVoice || (this._voice && /^[FM][1-5]$/.test(this._voice) ? this._voice : 'M2'),
      lang: String(this.lang).split('-')[0] || 'en',
      steps: this.config.supertonicSteps || 4,
      onStatus: (s) => this.onText({ role: 'system', text: `(supertonic: ${s})` }),
    });
  }

  // Float32 PCM -> WebAudio, shared by Kokoro and Supertonic.
  async _playPCM(pcm, rate) {
    if (!pcm || !pcm.length) return;
    const ctx = this._ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* ignore */ } }
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
