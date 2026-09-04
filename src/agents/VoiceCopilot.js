/**
 * VoiceCopilot — talk to the carpet, it talks back AND does what you ask. Fully
 * in the browser, no server: the browser's Speech Recognition for input (via
 * listenModes.js — this file never touches the raw SpeechRecognition API), a
 * pluggable LLM provider (cloud Claude / OpenAI-compatible / on-device WebLLM)
 * for the brain, and a pluggable voice provider for output (see
 * voiceProviders.js): the OS's own speechSynthesis, or on-device neural TTS —
 * Kokoro or Supertonic-3 — via config.tts.
 *
 * It is open-ended, not racing-only: each turn the LLM returns a spoken reply AND
 * an intent, which it hands to a Companion controller — roam, go to a landmark,
 * collect mana, race, hover, or hand control back. It's grounded: every turn it
 * folds window.agentAPI.observe() (landmarks, mana, race, kinematics) into the
 * prompt, so it talks and acts about the actual world.
 *
 * Listening (config.listenMode): 'ptt' (default) — press-to-talk, one utterance
 * per listen() call, exactly the original behaviour. 'handsfree' — the mic stays
 * open across turns; interim text streams out via onInterim() and a turn fires
 * once listenModes.js's semantic endpointer decides the thought is finished (see
 * that file for why silence-only endpointing isn't good enough). Either way,
 * KeyV (wired by the host, e.g. RaceSystem) is the barge-in hotkey: bargeIn()
 * aborts the in-flight utterance and opens the mic immediately.
 *
 * DevTools:
 *   const { VoiceCopilot } = await import('/src/agents/VoiceCopilot.js');
 *   const v = await new VoiceCopilot(window.agentAPI,
 *     { config: { provider:'openai', baseURL:'http://localhost:1234/v1', model:'local-model' } }).start();
 *   v.listen();              // push-to-talk one turn (or opens the hands-free mic)
 *   v.say('take me to the crystal formation');
 *
 * Voice (config.tts): 'browser' (default — the OS's own voice, free and instant),
 * 'kokoro', or 'supertonic'. Both neural voices are an explicit "download a
 * better voice" opt-in: they cost a CDN/HuggingFace fetch before the first word.
 * Supertonic-3 extras: supertonicVoice 'F1'..'F5'/'M1'..'M5' (default 'M2'),
 * supertonicSteps (flow-matching denoise steps, default 4). A neural voice that
 * fails to load, or throws mid-speech, falls back to the browser voice
 * permanently for the session — it never blocks or wedges the co-pilot.
 */
import { createProvider, extractJSON } from './llmProviders.js';
import { createVoice, normalizeTtsId } from './voiceProviders.js';
import { createMicInput } from './listenModes.js';
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
{"op":"raiseTerrain|carveTerrain|spawnMana|setTimeOfDay|reroll|clearTerrain|setWorldShape|setCurveRadius|setTrees|setLandmarks|setMana|setClouds|setSeaLevel|setSeason|savePlanet|loadPlanet|spawn|import|clearObjects|vehicle|setMusic","where":"ahead|here","radius":<50-800>,"amount":<40-300>,"t":<0..1 time: 0 midnight, 0.25 sunrise, 0.5 noon, 0.65 sunset>,"shape":"flat|round|pyramid|box|sphere|cylinder|cone|falcon|paperplane","level":<number, 1=normal>,"on":<true|false>,"season":"spring|summer|autumn|winter","catalog":"<saved object name>","repo":"khronos|threejs|cesium|local","name":"<asset name>","count":<1-20>,"scale":<world size ~40>,"color":"<css color>","ride":"carpet|<saved object name>","mood":"auto|calm|epic|night|off"}
- raiseTerrain raises a hill/mountain; carveTerrain digs a crater/canyon; spawnMana drops a mana orb; setTimeOfDay changes the light; reroll regenerates the whole landscape; clearTerrain undoes your terrain edits.
- setWorldShape flips the world between "flat" (endless plane) and "round" (a planet whose horizon curves away). setCurveRadius rounds the world and sets how tight the planet is via "level": 1 = gentle Earth-like curve, higher = a tiny planet, lower = subtler.
- World knobs use "level" where 1 = normal, higher = more, 0 = none: setTrees (forest density — 0 barren, 1 normal, 3 jungle), setLandmarks (how many landmarks), setMana (how much mana to collect). setClouds takes "on": true/false. setSeaLevel uses "level": 0 normal, 1 floods the lowlands, 2 = a water planet, negative drains the sea. setSeason recolours the land and trees via "season": spring/summer/autumn/winter. savePlanet stores the whole world and loadPlanet brings it back — use them when asked to save or restore the planet.
- You can CONJURE objects (the genie's power): spawn builds a shape from scratch — use "shape" (pyramid/box/sphere/cylinder/cone), with optional count/scale/color — or re-places a saved object by "catalog" name. import brings a real model in from one of 4 repos, pick by what you want: khronos (huge general catalog — Duck, Avocado, DamagedHelmet — mostly static), threejs (animated birds — Flamingo, Parrot, Stork, Horse), cesium (animated vehicles — plane, drone, car), local (bundled — carpet, mana). Everything you conjure is remembered and can be re-spawned by name later. clearObjects removes everything you conjured.
- Use spawn for geometric things ("three pyramids", "a giant sphere") and import for named real objects ("bring me a duck", "a flamingo" -> repo threejs). Terrain ops (raiseTerrain etc.) shape the land; spawn/import place objects on it.
- vehicle changes what the player FLIES: set "ride" to a saved object name to fly it instead of the carpet (import or spawn it first if it isn't saved yet), or "carpet" to switch back. For multi-step edits give "world" an ARRAY of ops, applied strictly in order — each one finishes before the next starts, so an import is already saved by the time a following vehicle op looks it up: e.g. "let me fly the fox" -> "world":[{"op":"import","repo":"khronos","name":"Fox"},{"op":"vehicle","ride":"Fox"}].
- For a vehicle that MOVES, prefer something with a real clip: the threejs birds and cesium vehicles animate on import (Flamingo flaps, the plane's prop spins); most khronos assets don't and just hang still. The built-in shapes "falcon" (flaps) and "paperplane" (banks) always animate too. e.g. "give me a bird to fly" -> "world":[{"op":"spawn","shape":"falcon","name":"falcon"},{"op":"vehicle","ride":"falcon"}].
- When asked what you can summon or conjure, answer in words using the GENIE line you're given (saved objects + importable examples); you don't need a "world" op just to talk about it.
- setMusic steers the soundtrack via "mood": calm (sparse and gentle), epic (full gallop and brass), night (hushed pads), off (silence), auto (follows the flying). Optional "level" 0..1 sets the volume. Use it when the player asks about the music ("make the music dramatic", "quieter music", "kill the music").
- "where" places terrain/mana/objects ahead of the carpet (default) or here. Leave "world" null when not editing.
Default intent to "chat" if they're only talking. Speak naturally; never read the JSON aloud.`;

export class VoiceCopilot {
  constructor(api = window.agentAPI, opts = {}) {
    this.api = api;
    this.config = opts.config || {};
    // The OS voice is the default; pass config.tts to opt into a downloaded
    // neural voice (see the file header and voiceProviders.js).
    this.tts = normalizeTtsId(this.config.tts);
    this.lang = this.config.lang || 'en-US';
    this.onText = opts.onText || (() => {});
    this.onState = opts.onState || (() => {});
    this.onInterim = opts.onInterim || (() => {}); // host hook: live provisional transcript while listening
    this.onGoal = opts.onGoal || (() => {}); // host hook: fires when the companion's goal changes
    this.history = [];
    this._provider = null;
    this.companion = null;
    // Listening lives entirely in listenModes.js now — see _initMic(). 'ptt' is
    // the default and is what the Talk button drives; a saved config.listenMode
    // of 'handsfree' opts into a continuously-open mic (see the file header).
    this._micMode = this.config.listenMode === 'handsfree' ? 'handsfree' : 'ptt';
    this._mic = null;
    this._micRunning = false; // hands-free only: whether the mic SHOULD be open across turns (independent of the echo guard's stop/start around speaking)
    this._voiceOut = null; // the active voice provider, from createVoice()
    this._speakCtrl = null; // AbortController for the in-flight utterance, so stop() can silence it
    this._audioCtx = null;
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
    // createVoice never throws — a neural voice that won't load, or that fails
    // mid-speech later, reports once via onStatus and permanently falls back to
    // the browser voice internally (see voiceProviders.js).
    this._voiceOut = await createVoice({
      ...this.config,
      tts: this.tts,
      lang: this.lang,
      getAudioContext: () => this._audioCtx, // VoiceCopilot owns the context — see _ensureAudio()
      onStatus: (text) => this.onText({ role: 'system', text }),
    });
    if (gen !== this._gen) {
      // stopped while the voice loaded — dispose it and stay off
      try { Promise.resolve(this._voiceOut.dispose()).catch(() => {}); } catch (e) { /* ignore */ }
      this._voiceOut = null;
      return this;
    }
    this._initMic();
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
    if (this._mic) { try { this._mic.destroy(); } catch (e) { /* ignore */ } this._mic = null; }
    if (this.companion) { try { this.companion.stop(); } catch (e) { /* ignore */ } this.companion = null; }
    // Abort the in-flight utterance — the voice provider silences its own
    // playback (stops the AudioBufferSourceNode for a PCM voice, or
    // speechSynthesis.cancel() for the browser voice). No more reaching into
    // TTS internals here — see voiceProviders.js.
    if (this._speakCtrl) { try { this._speakCtrl.abort(); } catch (e) { /* ignore */ } this._speakCtrl = null; }
    if (this._voiceOut) {
      const vo = this._voiceOut;
      this._voiceOut = null;
      try { Promise.resolve(vo.dispose()).catch(() => {}); } catch (e) { /* ignore */ }
    }
    // Close the AudioContext (browsers cap live contexts; leaking one per
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

  // Build the mic controller once voice/brain are up. All the raw
  // SpeechRecognition handling lives in listenModes.js now; this is just the
  // wiring from its generic {listening,idle,error} lifecycle onto VoiceCopilot's
  // own state machine and the console/echo-guard hooks.
  _initMic() {
    this._mic = createMicInput({
      mode: this._micMode,
      lang: this.lang,
      onUtterance: (text) => { if (this.state !== 'off' && text) this.say(text); },
      onInterim: (text) => this.onInterim(text),
      onState: (s) => this._onMicState(s),
      onError: (kind) => this._onMicError(kind),
    });
  }

  _onMicState(s) {
    if (s === 'listening') {
      if (this._micMode === 'handsfree') this._micRunning = true;
      this._setState('listening');
    } else if (s === 'idle' || s === 'error') {
      // Only fall back to 'ready' from 'listening' — never clobber 'thinking'/
      // 'speaking' (a stray recognizer event mid-turn must not reset the UI).
      if (this.state === 'listening') this._setState('ready');
    }
  }

  _onMicError(kind) {
    if (kind === 'unsupported') {
      // Carried over from the old inline listen(): Firefox and friends have no
      // SpeechRecognition at all — the console still works fine via typing.
      this._setState('no-mic');
      this.onText({ role: 'system', text: 'Speech input not supported here — try Chrome, or call say("...") with text.' });
      return;
    }
    if (kind === 'not-allowed' || kind === 'service-not-allowed') {
      this._micRunning = false;
      this._setState('no-mic');
      this.onText({ role: 'system', text: 'Microphone permission was denied — allow it in your browser’s site settings, or keep typing below.' });
    }
    // Other transient recognizer errors (no-speech, network, aborted,
    // audio-capture, ...) are handled by listenModes.js's own restart/backoff
    // in hands-free mode; in push-to-talk they just fall through to onend's
    // 'idle', which _onMicState above turns back into 'ready'.
  }

  /** One turn of listening: push-to-talk (one utterance) or, in hands-free
   *  mode, (re)opens the continuously-listening mic. */
  listen() {
    if (this.state === 'off') return; // stopped — don't open the mic on a dead instance
    this._ensureAudio(); // pressing Talk (or V) is a gesture — keep audio unlocked
    if (!this._mic) return; // start() hasn't reached _initMic() yet
    if (this._micMode === 'handsfree') this._micRunning = true;
    this._mic.start();
  }

  stopListening() {
    this._micRunning = false;
    if (this._mic) this._mic.stop();
  }

  /** Barge-in hotkey (KeyV, wired by the host): abort whatever's being spoken
   *  right now and open the mic immediately, instead of waiting for the
   *  utterance to finish and the echo guard's own resume in _setState(). A
   *  no-op on a stopped instance — V must never silently start a co-pilot,
   *  since starting needs a resolved provider/voice config. */
  bargeIn() {
    if (this.state === 'off' || !this._mic) return;
    if (this._speakCtrl) { try { this._speakCtrl.abort(); } catch (e) { /* ignore */ } }
    if (this._micMode === 'handsfree') this._micRunning = true;
    this._mic.start();
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
    // _applyWorld is now internally sequential (ops within one array await each
    // other — see its comment) but is deliberately NOT awaited here: the reply
    // is meant to play OVER the edit, not wait behind it, and a slow import
    // must not leave the co-pilot silent for seconds. _applyWorldOp never lets
    // an op's promise reject (every branch funnels through try/catch to
    // ok()/fail()), so this fire-and-forget can't produce an unhandled
    // rejection — worst case the on-screen log updates a beat after speech starts.
    this._applyIntent(intent, target);
    this._applyWorld(world);
    this._setState('speaking');
    await this._speak(reply);
    // Don't wake a stopped copilot — and don't clobber 'listening' either: a
    // barge-in (V, mid-utterance) can already have reopened the mic and moved
    // the state on by the time this await resolves, and stamping 'ready' over
    // that would show a stale status while the mic is actually live.
    if (gen === this._gen && this.state !== 'listening') this._setState('ready');
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

  // "world" from the model may be one op or an array of ops — apply STRICTLY IN
  // ORDER: each op is awaited before the next starts. _applyWorldOp is async
  // for the verbs that hit the network/catalogue (spawn/import/vehicle), and
  // used to be fired without awaiting — so an array like
  // [{op:'import',name:'Fox'},{op:'vehicle',ride:'Fox'}] started the import's
  // fetch and then IMMEDIATELY ran vehicle's catalogue lookup, before the
  // import had saved anything. vehicle always missed, and the player was left
  // on the carpet next to a freshly-imported, un-ridden fox. Awaiting each op
  // here fixes that without touching the fire-and-forget call site below (see
  // _sayTurn) — one bad op still reports and does not abort the ones after it.
  async _applyWorld(w) {
    if (!w) return;
    if (Array.isArray(w)) { for (const op of w) await this._applyWorldOp(op); return; }
    await this._applyWorldOp(w);
  }

  async _applyWorldOp(w) {
    if (!w || typeof w !== 'object' || !w.op) return;
    const api = (typeof window !== 'undefined') && window.worldAPI;
    if (!api) { this.onText({ role: 'system', text: '(world editing not available)' }); return; }
    const op = String(w.op);
    // Report the ACTUAL outcome: async ops confirm on resolve, and a missing or
    // failing op says so instead of claiming success. A verb that RESOLVES but
    // returns a falsy/empty result (vehicle() -> false, spawn() -> [], import()
    // -> null on a catalogue/name miss) is still a failure — resolving is not
    // the same as succeeding, so every async branch below checks the value.
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
        if (!api.spawn) { fail(); return; }
        const ids = await api.spawn({ shape: w.shape, catalog: w.catalog, count: w.count, scale: w.scale, color: w.color, at: w.where === 'here' ? 'here' : 'ahead' });
        if (Array.isArray(ids) && ids.length) ok(); else fail('nothing spawned');
        return;
      }
      else if (op === 'import') {
        if (!api.import) { fail(); return; }
        // The model doesn't always name a repo (or names the wrong one, e.g.
        // "flamingo" with no repo defaults to khronos, which has no Flamingo).
        // Prefer a repo whose curated examples actually list this name before
        // falling back to khronos — mirrors GenieSystem's own fuzzy matching.
        const repo = w.repo || this._guessRepo(w.name, api) || 'khronos';
        const entry = await api.import({ repo, name: w.name, as: w.as });
        if (entry) ok(); else fail(`"${w.name || '?'}" not found in ${repo}`);
        return;
      }
      else if (op === 'clearObjects') { if (api.clear) { api.clear(); done = true; } }
      else if (op === 'vehicle') {
        if (!api.vehicle) { fail(); return; }
        const ride = w.ride || w.catalog || 'carpet';
        const swapped = await api.vehicle({ set: ride, scale: w.scale });
        // _lastRide grounds the next prompt — only claim the ride once it actually took.
        if (swapped) { this._lastRide = ride; ok(); } else fail(`"${ride}" isn’t saved yet — import or spawn it first`);
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

  // When the model omits (or mis-picks) a repo, prefer one whose curated
  // examples list this name (fuzzy: exact > startsWith > includes) over the
  // 'khronos' default — e.g. "flamingo" should land in threejs (which HAS a
  // Flamingo), not khronos (which doesn't and would just fail). Same fuzzy
  // order GenieSystem._resolveAsset uses within a repo, one level up.
  _guessRepo(name, api) {
    try {
      if (!name || !api || typeof api.repos !== 'function') return null;
      const want = String(name).trim().toLowerCase();
      if (!want) return null;
      const repos = api.repos();
      const hit = repos.find((r) => (r.examples || []).some((ex) => ex.toLowerCase() === want))
        || repos.find((r) => (r.examples || []).some((ex) => ex.toLowerCase().startsWith(want)))
        || repos.find((r) => (r.examples || []).some((ex) => ex.toLowerCase().includes(want)));
      return hit ? hit.id : null;
    } catch (e) { return null; }
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

  // Speak through whichever voice provider start() resolved. Fallback (a neural
  // voice that won't load, or throws mid-speech) lives entirely in
  // voiceProviders.js now — this is just a call through it, bounded by an
  // AbortController stop() can fire to silence mid-sentence.
  async _speak(text) {
    if (!text || !this._voiceOut) return;
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    this._speakCtrl = ctrl;
    try {
      await this._voiceOut.speak(text, ctrl ? { signal: ctrl.signal } : {});
    } catch (e) {
      // Swallow anything: an abort from stop() is expected and already
      // silenced; any other throw here is a dead voice provider — either way
      // a TTS failure must never break the turn or leave state stuck at 'speaking'.
    } finally {
      if (this._speakCtrl === ctrl) this._speakCtrl = null;
    }
  }

  _setState(s) {
    const prev = this.state;
    this.state = s;
    this.onState(s);
    // Echo guard (v1, hands-free only): an open mic hears the TTS and
    // transcribes the co-pilot talking to itself, so recognition is suspended
    // for exactly the duration of the utterance and resumed right after. This
    // deliberately trades voice barge-in (interrupting just by talking over
    // it) for correctness — the alternative would be acoustic similarity
    // gating (comparing what the mic hears against what we're about to play
    // and discounting the match), which is real signal-processing work we're
    // not doing for v1. bargeIn() (the V hotkey) is the escape hatch: it
    // aborts the utterance and reopens the mic immediately rather than
    // waiting for this resume.
    if (this._mic && this._micMode === 'handsfree') {
      if (s === 'speaking' && prev !== 'speaking') this._mic.stop();
      else if (prev === 'speaking' && s !== 'speaking' && this._micRunning) this._mic.start();
    }
  }
}

if (typeof window !== 'undefined') window.VoiceCopilot = VoiceCopilot;
