/**
 * SimpleBot — reference autopilot for the Skybloom Agent API.
 * Paste into the DevTools console of a running game:
 *   const { SimpleBot } = await import('/src/agents/SimpleBot.js');
 *   const bot = new SimpleBot();
 *   bot.start();   // bot starts a race and flies it
 *   // bot.stop()  // to take over (control returns to you instantly)
 *
 * Uses only the public `window.agentAPI` surface documented in
 * docs/AGENT_API.md — no game internals. Total knowledge of the world:
 * one observe() call per tick. This is teaching code; keep it readable.
 */

// Tuning constants for the control law. Tweak these and watch what changes.
const TURN_GAIN = 2.2;       // proportional steering: turn = bearing * gain
const CLIMB_DIVISOR = 40;    // full climb/dive when gate is 40+ units above/below
const HAIRPIN_BEARING = 1.1; // rad; a gate this far off the nose is a hairpin
const HAIRPIN_DIST = 260;    // brake inside this distance when facing a hairpin
const TERRAIN_LOOKOUT = 300; // react to terrain probes nearer than this
const TERRAIN_MARGIN = 12;   // pull up if ground is within 12 units of altitude
const CEILING_MARGIN = 50;   // stop climbing this close to the flight ceiling

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class SimpleBot {
  /**
   * @param {object} api   Agent API object (defaults to window.agentAPI).
   * @param {object} opts  { autoStart = true   start a race if none is running,
   *                         courseSeed = undefined  seed passed to startRace(),
   *                         once = false       stop() after the first finish,
   *                         intervalMs = 100   decision period (10 Hz tick) }
   */
  constructor(api = window.agentAPI, opts = {}) {
    this.api = api;
    this.opts = { autoStart: true, courseSeed: undefined, once: false, intervalMs: 100, ...opts };
    this._timer = null;
    this._raceRequested = false; // one-shot latch so we call startRace() once
    this._released = false;      // one-shot latch so we call release() once
  }

  /** Begin driving: observe + decide + act every opts.intervalMs. */
  start() {
    if (this._timer !== null) return this;
    if (!this.api || typeof this.api.observe !== 'function') {
      throw new Error('SimpleBot: agentAPI not found. Is the game running with the Agent API loaded?');
    }
    this._timer = setInterval(() => this._tick(), this.opts.intervalMs);
    return this;
  }

  /** Stop driving and hand control back to the human immediately. */
  stop() {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this.api && typeof this.api.release === 'function') this.api.release();
    return this;
  }

  /** One decision cycle. Lifecycle here; flying lives in steer(). */
  _tick() {
    const obs = this.api.observe();
    if (!obs || !obs.self) return; // API not ready yet — try again next tick

    const race = obs.race;

    // No race loaded, or parked at the start: optionally kick one off, then wait.
    if (!race || race.state === 'idle') {
      if (this.opts.autoStart && !this._raceRequested) {
        this._raceRequested = true;
        this.api.startRace(this.opts.courseSeed);
      }
      return;
    }

    // Race over: give the carpet back. With once=false we re-arm and will
    // start another race the next time the game returns to idle.
    if (race.state === 'finished') {
      if (!this._released) {
        this._released = true;
        this.api.release();
        if (this.opts.once) this.stop();
        else this._raceRequested = false;
      }
      return;
    }

    // Any other state (run-up, racing, ...): a race is underway. Fly it.
    this._released = false;
    this._raceRequested = true;
    const action = this.steer(obs);
    if (action) this.api.act(action);
  }

  /**
   * Pure decision function: observation in, action out (or null to coast).
   * Everything it knows comes from the documented observation shape.
   */
  steer(obs) {
    const gate = obs.race && obs.race.nextGates && obs.race.nextGates[0];
    if (!gate) return null;

    // Point the nose at the gate. bearing < 0 means the gate is to our LEFT.
    const turn = clamp(gate.bearing * TURN_GAIN, -1, 1);

    // Match the gate's height. elevation > 0 means the gate is ABOVE us.
    let climb = clamp(gate.elevation / CLIMB_DIVISOR, -1, 1);

    // Full throttle by default; brake into hairpins to fly a wider, surer line.
    const throttle = 1;
    const hairpin = Math.abs(gate.bearing) > HAIRPIN_BEARING && gate.dist < HAIRPIN_DIST;
    const brake = hairpin ? 0.5 : 0;

    // Terrain safety overrides gate chasing: if any probe within 300 units is
    // near our altitude, climb hard now and sort the gate out afterwards.
    const probes = (obs.terrain && obs.terrain.ahead) || [];
    const altitude = obs.self.altitude;
    for (const probe of probes) {
      if (probe.dist <= TERRAIN_LOOKOUT && probe.height > altitude - TERRAIN_MARGIN) {
        climb = 1;
        break;
      }
    }

    // ...but never climb into the ceiling.
    const ceiling = obs.limits && obs.limits.ceiling;
    if (typeof ceiling === 'number' && altitude > ceiling - CEILING_MARGIN) {
      climb = Math.min(climb, 0);
    }

    return { throttle, brake, turn, climb };
  }
}

// Convenience for DevTools users: after a dynamic import of this module,
// `new SimpleBot().start()` works without destructuring.
if (typeof window !== 'undefined') {
  window.SimpleBot = SimpleBot;
}
