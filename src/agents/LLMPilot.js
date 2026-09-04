/**
 * LLMPilot — a hybrid, in-browser, server-LESS agent for SkyBloom.
 *
 * SimpleBot flies the 10 Hz floor (so the run never "dies"); an LLM advisor,
 * reached through a pluggable provider (Claude API direct or on-device WebLLM),
 * issues slow high-level OVERRIDES (racing line / speed / climb) that the fast
 * loop blends in. Every action still goes through window.agentAPI.act(), so the
 * fairness model and the verified-replay recording are untouched.
 *
 * DevTools:
 *   const { LLMPilot } = await import('/src/agents/LLMPilot.js');
 *   new LLMPilot(window.agentAPI, { config: { provider:'cloud', apiKey:'sk-ant-...' } }).start();
 */
import { SimpleBot } from './SimpleBot.js';
import { createProvider, extractJSON } from './llmProviders.js';
import { resolveTask } from './modelRouting.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// What the advisor returns and how the floor blends it. Neutral = baseline flies unchanged.
const NEUTRAL = { aggression: 0.6, lineBias: 0, climbBias: 0, note: '' };

const PROMPT = `You co-pilot a flying carpet racing through ring gates. A fast autopilot already steers toward the next gate; you only set high-level biases it blends in. Reply with ONLY one JSON object, no prose:
{"aggression":0..1,"lineBias":-1..1,"climbBias":-1..1,"note":"<=8 words"}
- aggression: 1 = push speed; 0 = cautious, brake early for tight/again gates.
- lineBias: <0 cut left of the gate, >0 cut right (racing line).
- climbBias: <0 bias lower, >0 bias higher.
Heuristic: far gate roughly ahead -> high aggression; close gate with large |bearing| -> low aggression.`;

const num = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, lo, hi) : dflt; };

function parseDirective(text) {
  const obj = extractJSON(text); // tolerate prose around the JSON
  if (!obj || typeof obj !== 'object') return null;
  return {
    aggression: num(obj.aggression, 0, 1, NEUTRAL.aggression),
    lineBias: num(obj.lineBias, -1, 1, 0),
    climbBias: num(obj.climbBias, -1, 1, 0),
    note: typeof obj.note === 'string' ? obj.note.slice(0, 80) : '',
  };
}

export class LLMPilot {
  /**
   * @param {object} api   Agent API (defaults to window.agentAPI).
   * @param {object} opts  { config: {provider,apiKey,model,onStatus}, courseSeed,
   *                         intervalMs=100 (10Hz floor), advisorMs=2000 (advisor cadence),
   *                         onDirective(d) }
   */
  constructor(api = window.agentAPI, opts = {}) {
    this.api = api;
    // autoRace stays OFF by default: starting the pilot should NOT kick off a race.
    // It arms and waits; it flies a race once one is started (Start Race / the user).
    // maxHoldMs bounds how long a directive may survive on "nothing changed"
    // alone, so a quantization plateau can't freeze the advisor indefinitely.
    this.opts = { intervalMs: 100, advisorMs: 2000, maxHoldMs: 8000, courseSeed: undefined, autoRace: false, ...opts };
    this.config = opts.config || {};
    this.onDirective = opts.onDirective || (() => {});
    this._baseline = new SimpleBot(api, { autoStart: false }); // reuse its pure steer()
    this._provider = null;
    this._timer = null;
    this._gen = 0; // bumped by stop(); an in-flight start() from an older gen must not go live
    this._raceRequested = false;
    this._released = false;
    this.directive = { ...NEUTRAL };
    this._advising = false;
    this._lastAdvice = 0;
    this._lastSignature = null; // quantized state the live directive was built for
  }

  /** Build the provider (may lazy-load WebLLM), then start the 10 Hz loop. */
  async start() {
    if (this._timer) return this;
    if (!this.api || typeof this.api.observe !== 'function') {
      throw new Error('LLMPilot: window.agentAPI not found. Is the game running?');
    }
    const gen = this._gen;
    // Route to the cheap tier: the advisor emits four numbers on a timer, and
    // SimpleBot flies the floor regardless, so this is the one workload where
    // the smallest model is the right call rather than a compromise.
    const provider = await createProvider(resolveTask('pilot', this.config)); // can take minutes (WebLLM)
    if (gen !== this._gen || this._timer) {
      // stop() was called while the model loaded — don't start an orphaned pilot
      try { if (provider.dispose) Promise.resolve(provider.dispose()).catch(() => {}); } catch (e) { /* ignore */ }
      return this;
    }
    this._provider = provider;
    this._timer = setInterval(() => this._tick(), this.opts.intervalMs);
    return this;
  }

  /** Stop and hand control back to the human immediately. */
  stop() {
    this._gen++; // cancels an in-flight start()
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._provider) {
      const p = this._provider;
      this._provider = null;
      try { if (p.dispose) Promise.resolve(p.dispose()).catch(() => {}); } catch (e) { /* ignore */ }
    }
    if (this.api && typeof this.api.release === 'function') this.api.release();
    return this;
  }

  _tick() {
    const obs = this.api.observe();
    if (!obs || !obs.self) return;
    const race = obs.race;

    if (!race || race.state === 'idle') {
      // Only auto-start a race when explicitly opted in; otherwise wait for one.
      if (this.opts.autoRace && !this._raceRequested) { this._raceRequested = true; this.api.startRace(this.opts.courseSeed); }
      return;
    }
    if (race.state === 'finished') {
      if (!this._released) {
        this._released = true;
        this.api.release();
        this._raceRequested = false;
        // Next race starts from a clean slate, not the last race's directive.
        this.directive = { ...NEUTRAL };
        this._lastSignature = null;
      }
      return;
    }
    this._released = false;
    this._raceRequested = true;

    // Floor: SimpleBot flies; the directive only biases it. Always runs => never dies.
    const base = this._baseline.steer(obs);
    if (base) this.api.act(this._applyDirective(base));

    // Advisor: refresh the directive at its own slow pace; async, never blocks the floor.
    this._maybeAdvise(obs);
  }

  _applyDirective(action) {
    const d = this.directive;
    return {
      throttle: clamp(action.throttle * (0.5 + d.aggression * 0.5), 0, 1),
      brake: clamp(action.brake * (1 - d.aggression * 0.5), 0, 1),
      turn: clamp(action.turn + d.lineBias * 0.5, -1, 1),
      climb: clamp(action.climb + d.climbBias * 0.5, -1, 1),
    };
  }

  /**
   * A quantized view of everything the advisor prompt actually carries. Two ticks
   * with the same signature would send the same question and get the same four
   * numbers back, so the second one is pure spend. Buckets are coarse enough that
   * a long straight approach costs nothing, and fine enough that closing on a
   * gate or swinging off-bearing still re-asks. Null means "nothing to advise on".
   */
  _signature(obs) {
    const gate = obs.race && obs.race.nextGates && obs.race.nextGates[0];
    if (!gate) return null;
    return [
      obs.race.gateIndex,
      Math.round(gate.dist / 150),
      Math.round(gate.bearing / 0.25),
      Math.round(gate.elevation / 60),
      Math.round(obs.self.speed / 25),
    ].join(':');
  }

  _maybeAdvise(obs) {
    if (this._advising || now() - this._lastAdvice < this.opts.advisorMs) return;
    const sig = this._signature(obs);
    // No gate in sight: the baseline flies it, and there is nothing to ask about.
    if (sig === null) return;
    // The directive we're already flying was built for this exact situation.
    // Previously the advisor re-asked on a fixed timer whether or not the race
    // had moved; this is where most of the pilot's token spend went.
    if (sig === this._lastSignature && now() - this._lastAdvice < this.opts.maxHoldMs) return;
    this._advising = true;
    this._lastAdvice = now();
    this._lastSignature = sig;
    this._ask(obs)
      .then((d) => { if (d) { this.directive = d; this.onDirective(d); } })
      .catch(() => { /* a failed/slow advisor just leaves the last directive in place */ })
      .finally(() => { this._advising = false; });
  }

  async _ask(obs) {
    const gate = obs.race && obs.race.nextGates && obs.race.nextGates[0];
    const state = {
      speed: Math.round(obs.self.speed),
      maxSpeed: Math.round((obs.limits && obs.limits.maxSpeed) || 0),
      altitude: Math.round(obs.self.altitude),
      gateIndex: obs.race.gateIndex,
      gateCount: obs.race.gateCount,
      gate: gate ? { dist: Math.round(gate.dist), bearing: +gate.bearing.toFixed(2), elevation: Math.round(gate.elevation) } : null,
    };
    const text = await this._provider.complete([{ role: 'user', content: `${PROMPT}\n\nState: ${JSON.stringify(state)}` }]);
    return parseDirective(text);
  }
}

if (typeof window !== 'undefined') window.LLMPilot = LLMPilot;
