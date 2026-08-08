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
import { createProvider, extractJSON } from './llmProviders.js';
import { resolveTask } from './modelRouting.js';
import { Companion } from './Companion.js';

const SYSTEM = `You are the voice of a magical flying carpet — a warm, witty co-pilot in the game SkyBloom, free to roam an open world, visit landmarks, gather mana, fly alongside the player, or race.
Each turn you get the live GAME STATE. Reply with ONLY a JSON object, nothing else:
{"reply":"<one or two short SPOKEN sentences — no markdown, no emoji>","intent":"chat|roam|goto|collect|race|hover|manual","target":<a landmark type for goto else null>,"world":<null, one creative world edit, or an ARRAY of them applied in order (see below)>}
Intents (what to DO):
- chat: just talk; keep doing whatever you were doing.
- roam: wander and explore the world.
- goto: fly to a landmark; set target to one of ancient_ruins, magical_circle, crystal_formation.
- collect: go gather nearby mana.
- race: start or continue a gate race.
- hover: stop and hold position.
- manual: give control back to the human.
You can ALSO reshape the world (creative power). When the player asks for it, set "world" to:
{"op":"raiseTerrain|carveTerrain|spawnMana|setTimeOfDay|reroll|clearTerrain|setWorldShape|setCurveRadius|setTrees|setLandmarks|setMana|setClouds|setSeaLevel|setSeason|savePlanet|loadPlanet|spawn|import|clearObjects|vehicle|setMusic","where":"ahead|here","radius":<50-800>,"amount":<40-300>,"t":<0..1 time: 0 midnight, 0.25 sunrise, 0.5 noon, 0.65 sunset>,"shape":"flat|round|pyramid|box|sphere|cylinder|cone|falcon|paperplane","level":<number, 1=normal>,"on":<true|false>,"season":"spring|summer|autumn|winter","catalog":"<saved object name>","repo":"khronos","name":"<asset e.g. Duck, Fox, Avocado>","count":<1-20>,"scale":<world size ~100>,"color":"<css color>","ride":"carpet|<saved object name>","mood":"auto|calm|epic|night|off"}
- raiseTerrain raises a hill/mountain; carveTerrain digs a crater/canyon; spawnMana drops a mana orb; setTimeOfDay changes the light; reroll regenerates the whole landscape; clearTerrain undoes your terrain edits.
- setWorldShape flips the world between "flat" (endless plane) and "round" (a planet whose horizon curves away). setCurveRadius rounds the world and sets how tight the planet is via "level": 1 = gentle Earth-like curve, higher = a tiny planet, lower = subtler.
- World knobs use "level" where 1 = normal, higher = more, 0 = none: setTrees (forest density — 0 barren, 1 normal, 3 jungle), setLandmarks (how many landmarks), setMana (how much mana to collect). setClouds takes "on": true/false. setSeaLevel uses "level": 0 normal, 1 floods the lowlands, 2 = a water planet, negative drains the sea. setSeason recolours the land and trees via "season": spring/summer/autumn/winter. savePlanet stores the whole world and loadPlanet brings it back — use them when asked to save or restore the planet.
- You can CONJURE objects (the genie's power): spawn builds a shape from scratch — use "shape" (pyramid/box/sphere/cylinder/cone), with optional count/scale/color — or re-places a saved object by "catalog" name. import brings a real model in from a repo: set repo "khronos" and a "name" (e.g. Duck, Fox, Avocado, DamagedHelmet). Everything you conjure is remembered and can be re-spawned by name later. clearObjects removes everything you conjured.
- Use spawn for geometric things ("three pyramids", "a giant sphere") and import for named real objects ("bring me a duck"). Terrain ops (raiseTerrain etc.) shape the land; spawn/import place objects on it.
- vehicle changes what the player FLIES: set "ride" to a saved object name to fly it instead of the carpet (import or spawn it first if it isn't saved yet), or "carpet" to switch back. For multi-step edits give "world" an ARRAY of ops, applied in order: e.g. "let me fly the fox" -> "world":[{"op":"import","repo":"khronos","name":"Fox"},{"op":"vehicle","ride":"Fox"}].
- For a vehicle that MOVES, prefer the built-in animated flyers: shape "falcon" flaps its wings, shape "paperplane" banks as it glides. Imported models only animate if they ship their own clip (e.g. Fox gallops); a plain model just hangs still — so when the player wants something lively to fly, spawn a falcon or paperplane and ride it. e.g. "give me a bird to fly" -> "world":[{"op":"spawn","shape":"falcon","name":"falcon"},{"op":"vehicle","ride":"falcon"}].
- When asked what you can summon or conjure, answer in words using the GENIE line you're given (saved objects + importable examples); you don't need a "world" op just to talk about it.
- setMusic steers the soundtrack via "mood": calm (sparse and gentle), epic (full gallop and brass), night (hushed pads), off (silence), auto (follows the flying). Optional "level" 0..1 sets the volume. Use it when the player asks about the music ("make the music dramatic", "quieter music", "kill the music").
- "where" places terrain/mana/objects ahead of the carpet (default) or here. Leave "world" null when not editing.
Default intent to "chat" if they're only talking. Speak naturally; never read the JSON aloud.`;

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
    this._activeSrc = null; // the WebAudio source currently speaking, so stop() can silence it
    this._gen = 0; // bumped by stop(); in-flight start()/say() work from an older gen must not land
    this._sayChain = Promise.resolve(); // serializes say() turns
    this.state = 'idle';
  }

  async start() {
    // Create/unlock the AudioContext NOW, while we're still inside the user's
    // click on the Talk button — browsers block audio created off a gesture, so
    // a context made lazily after the async LLM call would stay suspended and
    // Kokoro/Supertonic would render silently. This is the gesture that unlocks it.
    this._ensureAudio();
    const gen = this._gen; // stop() bumps this — a stale start must not go live
    // Route to the capable tier and cache the big static SYSTEM prefix. This is
    // the workload where a wrong world op is a visible failure, and it's also the
    // one where caching pays: see modelRouting.js for why "smarter" ends up
    // cheaper per turn here than the small model would be.
    const provider = await createProvider(resolveTask('voice', this.config)); // can take minutes (WebLLM)
    if (gen !== this._gen) {
      // stopped while the brain loaded — dispose it and stay off
      try { if (provider.dispose) Promise.resolve(provider.dispose()).catch(() => {}); } catch (e) { /* ignore */ }
      return this;
    }
    this._provider = provider;
    try {
      if (this.tts === 'kokoro') await this._initKokoro();
      else if (this.tts === 'supertonic') await this._initSupertonic();
    } catch (e) {
      // a TTS that won't load must not block the co-pilot — fall back to the browser voice
      this.onText({ role: 'system', text: `(${this.tts} voice unavailable — using the browser voice)` });
      this.tts = 'browser';
    }
    if (gen !== this._gen) return this; // stopped while the voice loaded
    // Pre-fetch a small sample of importable models so the genie can answer
    // "what can you summon?" conversationally, without a tool round-trip.
    try {
      const api = (typeof window !== 'undefined') && window.worldAPI;
      // Prefer the repos' curated examples (recognizable: Duck, Fox, …) over raw
      // manifest order (which leads with dull test assets) for the spoken sample.
      const repos = (api && api.repos) ? api.repos() : [];
      const curated = repos.flatMap((r) => r.examples || []);
      if (curated.length) this._importableSample = curated.slice(0, 14);
      else if (api && api.discover) this._importableSample = (await api.discover({ limit: 14 })).map((m) => m.name);
    } catch (e) { /* discovery is best-effort grounding, never blocks start */ }
    if (gen !== this._gen) return this; // stopped during discovery
    this._setState('ready');
    return this;
  }

  // Sync grounding line: what's already saved (re-spawn/fly by name) + a sample
  // of what can be imported. Folded into each turn so the model speaks accurately.
  _summonContext() {
    try {
      const api = (typeof window !== 'undefined') && window.worldAPI;
      if (!api) return '';
      const saved = (api.listCatalog ? api.listCatalog() : []).map((e) => e.name);
      const parts = [];
      if (saved.length) parts.push(`saved (re-spawn or fly by name): ${saved.join(', ')}`);
      if (this._importableSample && this._importableSample.length) {
        parts.push(`importable examples (118 available, name any): ${this._importableSample.join(', ')}`);
      }
      const ride = (this._lastRide && this._lastRide !== 'carpet') ? `; currently flying: ${this._lastRide}` : '';
      return parts.length ? parts.join('; ') + ride : '';
    } catch (e) { return ''; }
  }

  stop() {
    this._gen++; // cancels any in-flight start()/say() from going live on this instance
    this.stopListening();
    if (this.companion) { try { this.companion.stop(); } catch (e) { /* ignore */ } this.companion = null; }
    try { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    // Silence the neural voice too: stop the in-flight WebAudio source...
    if (this._activeSrc) { try { this._activeSrc.stop(); } catch (e) { /* already ended */ } this._activeSrc = null; }
    // ...and close the AudioContext (browsers cap live contexts; leaking one per
    // restart eventually mutes the neural voice). A fresh start() recreates it.
    if (this._audioCtx) {
      const ctx = this._audioCtx;
      this._audioCtx = null;
      try { Promise.resolve(ctx.close()).catch(() => {}); } catch (e) { /* ignore */ }
    }
    // Release the brain (unloads the on-device WebLLM engine's GPU memory).
    if (this._provider) {
      const p = this._provider;
      this._provider = null;
      try { if (p.dispose) Promise.resolve(p.dispose()).catch(() => {}); } catch (e) { /* ignore */ }
    }
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
    if (this.state === 'off') return; // stopped — don't open the mic on a dead instance
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
  say(text) {
    // Serialize turns: two overlapping say() calls would interleave history and
    // play two voices over each other. Each turn waits for the previous one.
    const turn = this._sayChain.then(() => this._sayTurn(text));
    this._sayChain = turn.then(() => {}, () => {});
    return turn;
  }

  async _sayTurn(text) {
    if (!text || !this._provider || this.state === 'off') return '';
    const gen = this._gen; // stop() mid-turn must keep results from landing
    this.onText({ role: 'user', text });
    this._setState('thinking');
    const messages = [
      { role: 'system', content: SYSTEM },
      ...this.history.slice(-8),
      { role: 'user', content: `${text}\n\n[GAME STATE: ${this._stateSummary()}]${(() => { const g = this._summonContext(); return g ? `\n[GENIE: ${g}]` : ''; })()}` },
    ];

    let reply = '';
    let intent = 'chat';
    let target = null;
    let world = null;
    // Bound the brain call so a hung/unreachable endpoint surfaces as a clear
    // message instead of dead silence. Providers forward {signal} to fetch.
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 45000) : null;
    try {
      const raw = await this._provider.complete(messages, ctrl ? { signal: ctrl.signal } : {});
      const obj = extractJSON(raw);
      if (obj) {
        reply = String(obj.reply || '').trim();
        intent = String(obj.intent || 'chat').trim().toLowerCase();
        target = typeof obj.target === 'string' ? obj.target : null;
        // "world" may be one op or an array of ops applied in order.
        world = obj.world && typeof obj.world === 'object' ? obj.world : null;
      } else {
        reply = (raw || '').trim(); // model ignored the format — just say it
      }
    } catch (e) {
      reply = (e && e.name === 'AbortError')
        ? 'No answer — the brain timed out. Check the provider/endpoint and key, then try again.'
        : `Comms trouble — ${e && e.message ? e.message : 'no answer'}.`;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (gen !== this._gen) return ''; // stopped while thinking — drop the turn
    if (!reply) reply = '…';

    this.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    if (this.history.length > 16) this.history = this.history.slice(-16); // only slice(-8) is ever read
    this.onText({ role: 'assistant', text: reply });

    // Act first (start flying / edit the world immediately), then speak over it.
    this._applyIntent(intent, target);
    this._applyWorld(world);
    this._setState('speaking');
    await this._speak(reply);
    if (gen === this._gen) this._setState('ready'); // don't wake a stopped copilot
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

  // "world" from the model may be one op or an array of ops — apply in order.
  _applyWorld(w) {
    if (!w) return;
    if (Array.isArray(w)) { for (const op of w) this._applyWorldOp(op); return; }
    this._applyWorldOp(w);
  }

  _applyWorldOp(w) {
    if (!w || typeof w !== 'object' || !w.op) return;
    const api = (typeof window !== 'undefined') && window.worldAPI;
    if (!api) { this.onText({ role: 'system', text: '(world editing not available)' }); return; }
    const op = String(w.op);
    // Report the ACTUAL outcome: async ops confirm on resolve, and a missing or
    // failing op says so instead of claiming success.
    const ok = () => this.onText({ role: 'system', text: `🪄 ${this._worldLabel(w, op)}` });
    const fail = (why) => this.onText({ role: 'system', text: `(world edit "${op}" didn’t take${why ? ` — ${why}` : ''})` });
    try {
      let done = false;
      if (op === 'setTimeOfDay') { if (api.setTimeOfDay) { api.setTimeOfDay(Number(w.t)); done = true; } }
      else if (op === 'setWorldShape') { if (api.setWorldShape) { api.setWorldShape(w.shape); done = true; } }
      else if (op === 'setTrees') { if (api.setTrees) { api.setTrees(Number(w.level)); done = true; } }
      else if (op === 'setLandmarks') { if (api.setLandmarks) { api.setLandmarks(Number(w.level)); done = true; } }
      else if (op === 'setMana') { if (api.setMana) { api.setMana(Number(w.level)); done = true; } }
      else if (op === 'setClouds') { if (api.setClouds) { api.setClouds(w.on === true || w.on === 'true' || w.on === 'on'); done = true; } }
      else if (op === 'setSeaLevel') { if (api.setSeaLevel) { api.setSeaLevel(Number(w.level)); done = true; } }
      else if (op === 'setCurveRadius') { const lvl = Math.max(0.2, Number(w.level) || 1); if (api.setCurveRadius) { if (api.setWorldShape) api.setWorldShape('round'); api.setCurveRadius(30000 / lvl); done = true; } }
      else if (op === 'setSeason') { if (api.setSeason) { api.setSeason(w.season); done = true; } }
      else if (op === 'setMusic') { if (api.setMusic) { api.setMusic({ mood: w.mood, volume: w.level }); done = true; } }
      else if (op === 'savePlanet') { if (api.savePlanet) { api.savePlanet(); done = true; } }
      else if (op === 'loadPlanet') { if (api.loadPlanet) { api.loadPlanet(); done = true; } }
      else if (op === 'reroll') { if (api.reroll) { api.reroll(); done = true; } }
      else if (op === 'clearTerrain') { if (api.clearTerrain) { api.clearTerrain(); done = true; } }
      else if (op === 'spawn') {
        // Genie object-authoring. `where` -> `at`; the rest passes straight through.
        if (api.spawn) Promise.resolve(api.spawn({ shape: w.shape, catalog: w.catalog, count: w.count, scale: w.scale, color: w.color, at: w.where === 'here' ? 'here' : 'ahead' })).then(ok, (e) => fail(e && e.message));
        else fail();
        return;
      }
      else if (op === 'import') {
        if (api.import) Promise.resolve(api.import({ repo: w.repo || 'khronos', name: w.name, as: w.as })).then(ok, (e) => fail(e && e.message));
        else fail();
        return;
      }
      else if (op === 'clearObjects') { if (api.clear) { api.clear(); done = true; } }
      else if (op === 'vehicle') {
        const ride = w.ride || w.catalog || 'carpet';
        // _lastRide grounds the next prompt — only claim the ride once it resolves.
        if (api.vehicle) Promise.resolve(api.vehicle({ set: ride, scale: w.scale })).then(() => { this._lastRide = ride; ok(); }, (e) => fail(e && e.message));
        else fail();
        return;
      }
      else if (op === 'raiseTerrain' || op === 'carveTerrain' || op === 'spawnMana') {
        const radius = op === 'spawnMana' ? 0 : (Number(w.radius) || 250);
        const p = this._worldPoint(w.where, radius);
        if (!p) { this.onText({ role: 'system', text: '(can’t place that yet — take off first)' }); return; }
        if (op === 'raiseTerrain' && api.raiseTerrain) { api.raiseTerrain(p.x, p.z, Number(w.radius) || 250, Math.abs(Number(w.amount) || 170)); done = true; }
        else if (op === 'carveTerrain' && api.carveTerrain) { api.carveTerrain(p.x, p.z, Number(w.radius) || 250, Math.abs(Number(w.amount) || 150)); done = true; }
        else if (op === 'spawnMana' && api.spawnMana) { api.spawnMana(p.x, p.z); done = true; }
      }
      else { fail('unknown op'); return; }
      // Tell the player what just happened, in plain words, so the change is legible.
      if (done) ok(); else fail();
    } catch (e) { fail(e && e.message); /* a world edit must never break the conversation */ }
  }

  // Plain-language description of a world edit for the on-screen log.
  _worldLabel(w, op) {
    const dir = w.where === 'here' ? 'here' : 'ahead';
    switch (op) {
      case 'raiseTerrain': return `raised a mountain ${dir}`;
      case 'carveTerrain': return `carved a canyon ${dir}`;
      case 'spawnMana': return `dropped mana ${dir}`;
      case 'setTimeOfDay': return 'shifted the time of day';
      case 'setWorldShape': return `made the world ${w.shape === 'round' ? 'a planet' : 'flat'}`;
      case 'setCurveRadius': return 'reshaped the planet';
      case 'setTrees': return Number(w.level) <= 0 ? 'cleared the forest' : 'changed the forest';
      case 'setLandmarks': return 'changed the landmarks';
      case 'setMana': return 'changed how much mana there is';
      case 'setClouds': return (w.on === true || w.on === 'true' || w.on === 'on') ? 'brought the clouds in' : 'cleared the clouds';
      case 'setSeaLevel': return Number(w.level) >= 2 ? 'flooded it into a water planet' : 'changed the sea level';
      case 'setSeason': return `turned it to ${w.season}`;
      case 'setMusic': return w.mood === 'off' ? 'silenced the music' : `turned the music ${w.mood || 'up'}`;
      case 'savePlanet': return 'saved this planet';
      case 'loadPlanet': return 'restored your saved planet';
      case 'reroll': return 'regenerated the whole world';
      case 'clearTerrain': return 'undid the terrain edits';
      case 'spawn': { const n = Number(w.count) || 1; const what = w.catalog || w.shape || 'object'; return `conjured ${n > 1 ? n + ' ' : 'a '}${what}${n > 1 ? 's' : ''} ${dir}`; }
      case 'import': return `summoned a ${w.name || 'model'} ${dir}`;
      case 'clearObjects': return 'cleared what you conjured';
      case 'vehicle': { const r = w.ride || w.catalog || 'carpet'; return r === 'carpet' ? 'back on the carpet' : `now flying the ${r}`; }
      default: return op;
    }
  }

  // A world point ahead of the carpet (default) or right here, from the live state.
  // For area edits, pushed far enough that the WHOLE brush (clearRadius) lands in
  // front of and below the carpet — in view — instead of under its nose.
  _worldPoint(where, clearRadius = 0) {
    try {
      const o = this.api && this.api.observe && this.api.observe();
      if (!o || !o.self || !o.self.pos) return null;
      const p = o.self.pos;
      if (where === 'here') return { x: p[0], z: p[2] };
      const h = Number(o.self.heading) || 0; // forward xz = (sin h, cos h)
      const dist = 450 + clearRadius;
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
      try { return await this._speakKokoro(text); } catch (e) { this._ttsFellBack('Kokoro', e); }
    }
    if (this.tts === 'supertonic' && this._supertonic) {
      try { const out = await this._supertonic.generate(text); return await this._playPCM(out.audio, out.sampleRate); } catch (e) { this._ttsFellBack('Supertonic', e); }
    }
    return this._speakBrowser(text);
  }

  // Surface a neural-voice failure once, then fall back to the browser voice.
  _ttsFellBack(name, err) {
    if (!this._ttsWarned) {
      this._ttsWarned = true;
      this.onText({ role: 'system', text: `(${name} voice failed — using the browser voice. ${err && err.message ? err.message : ''})`.trim() });
    }
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
    const model = this.config.kokoroModel || 'onnx-community/Kokoro-82M-v1.0-ONNX';
    const gpu = typeof navigator !== 'undefined' && !!navigator.gpu;
    // Try the fast path first, then fall back. The WebGPU backend can't run the
    // q8-quantized weights (it needs fp32) and some GPUs fail outright, so if
    // WebGPU/fp32 errors we retry on wasm/q8 before giving up to the browser voice.
    const attempts = [];
    if (this.config.kokoroDtype) attempts.push({ dtype: this.config.kokoroDtype, device: gpu ? 'webgpu' : 'wasm' });
    if (gpu) attempts.push({ dtype: 'fp32', device: 'webgpu' });
    attempts.push({ dtype: 'q8', device: 'wasm' });
    let lastErr;
    for (const opt of attempts) {
      try {
        this.onText({ role: 'system', text: `(loading Kokoro on ${opt.device}…)` });
        this._kokoro = await KokoroTTS.from_pretrained(model, opt);
        return;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Kokoro failed to load');
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
    // A context still suspended (no user gesture yet) would never fire onended
    // and wedge the turn at 'speaking' — throw so _speak falls back to the
    // browser voice instead.
    if (ctx.state === 'suspended') throw new Error('audio locked (needs a user gesture)');
    const buf = ctx.createBuffer(1, pcm.length, rate);
    buf.copyToChannel(pcm instanceof Float32Array ? pcm : Float32Array.from(pcm), 0);
    await new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => { if (this._activeSrc === src) this._activeSrc = null; resolve(); };
      this._activeSrc = src; // kept so stop() can silence mid-sentence
      src.start();
    });
  }

  _setState(s) { this.state = s; this.onState(s); }
}

if (typeof window !== 'undefined') window.VoiceCopilot = VoiceCopilot;
