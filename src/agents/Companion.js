/**
 * Companion — an open-ended, goal-driven carpet pilot. It is NOT racing-specific:
 * steering toward a gate, a landmark, a mana node, or a free-roam heading is the
 * same math (bearing -> turn, elevation -> climb, distance/off-axis -> throttle),
 * so one controller covers every goal. The VoiceCopilot sets the goal from what
 * you say; this just flies it through window.agentAPI.act().
 *
 * Goals: 'manual' (hands off), 'roam' (explore), 'goto' (a landmark type),
 *        'collect' (nearest mana), 'race' (gate course), 'hover' (hold position).
 */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const TURN_GAIN = 2.2;
const CLIMB_DIV = 45;        // full climb when a target is ~45 units above/below
const TERRAIN_LOOKOUT = 300; // react to terrain probes nearer than this
const TERRAIN_MARGIN = 14;   // pull up if ground is within this of our altitude
const CEILING_MARGIN = 50;
const ARRIVE_DIST = 60;      // "reached" a point-of-interest within this distance

const GOALS = ['manual', 'roam', 'goto', 'collect', 'race', 'hover'];

export class Companion {
  constructor(api = window.agentAPI, opts = {}) {
    this.api = api;
    this.intervalMs = opts.intervalMs || 100;
    this.goal = { type: 'manual', target: null };
    this.onGoal = opts.onGoal || (() => {});
    this.onArrive = opts.onArrive || (() => {});
    this._timer = null;
    this._raceRequested = false;
  }

  start() { if (!this._timer) this._timer = setInterval(() => this._tick(), this.intervalMs); return this; }
  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } this._release(); return this; }

  setGoal(type, target = null) {
    this.goal = { type: GOALS.includes(type) ? type : 'roam', target: typeof target === 'string' ? target : null };
    this._raceRequested = false;
    if (this.goal.type === 'manual') this._release();
    this.onGoal(this.goal);
    return this.goal;
  }

  _release() { try { if (this.api && this.api.release) this.api.release(); } catch (e) { /* ignore */ } }

  _tick() {
    const obs = this.api && this.api.observe && this.api.observe();
    if (!obs || !obs.self) return;
    const t = this.goal.type;
    if (t === 'manual') return;
    if (t === 'race') return this._flyRace(obs);
    if (t === 'hover') return this.api.act(this._hover(obs));

    const tgt = this._pickTarget(obs);
    if (!tgt) return this.api.act(this._wander(obs)); // nothing to chase -> explore

    if (tgt.dist <= ARRIVE_DIST && t === 'goto') { this.onArrive(this.goal); return this.setGoal('hover'); }
    this.api.act(this._steerTo(obs, tgt));
  }

  _flyRace(obs) {
    const race = obs.race;
    if (!race || race.state === 'idle') {
      if (!this._raceRequested && this.api.startRace) { this._raceRequested = true; this.api.startRace(); }
      return;
    }
    if (race.state === 'finished') { this._release(); return this.setGoal('hover'); }
    const g = race.nextGates && race.nextGates[0];
    if (g) this.api.act(this._steerTo(obs, { bearing: g.bearing, dist: g.dist, elevation: g.elevation }));
  }

  // Landmarks/mana carry pos[x,y,z] + bearing + dist; elevation is derived from pos.
  _pickTarget(obs) {
    const self = obs.self.pos;
    if (this.goal.type === 'goto') {
      const lms = (obs.nearby && obs.nearby.landmarks) || [];
      let lm = this.goal.target ? lms.find((l) => l.type === this.goal.target) : null;
      if (!lm) lm = lms[0]; // named one not in sight -> head to the nearest of any kind
      return lm ? { bearing: lm.bearing, dist: lm.dist, elevation: lm.pos[1] - self[1] } : null;
    }
    if (this.goal.type === 'collect') {
      const m = ((obs.nearby && obs.nearby.manaNodes) || [])[0];
      return m ? { bearing: m.bearing, dist: m.dist, elevation: m.pos[1] - self[1] } : null;
    }
    return null; // roam is handled by _wander
  }

  _steerTo(obs, tgt) {
    const turn = clamp(tgt.bearing * TURN_GAIN, -1, 1);
    const climb = clamp(tgt.elevation / CLIMB_DIV, -1, 1);
    const bAbs = Math.abs(tgt.bearing);
    let throttle = 1;
    let brake = 0;
    if (bAbs > 1.4) { throttle = 0.15; brake = 0.7; }       // target behind: slow + pivot
    else if (bAbs > 0.7) { throttle = 0.4; brake = 0.2; }   // off-axis: ease into the turn
    else if (tgt.dist < 120) { throttle = 0.5; }            // close + on-axis: don't overshoot
    return this._safety(obs, { throttle, brake, turn, climb });
  }

  _hover(obs) {
    const low = obs.self.altitudeAboveTerrain != null && obs.self.altitudeAboveTerrain < 25;
    return this._safety(obs, { throttle: 0, brake: 0.3, turn: 0, climb: low ? 0.6 : 0.15 });
  }

  // Explore: head toward the farthest landmark in sight (keeps moving outward);
  // otherwise cruise with a gentle weave and hold altitude.
  _wander(obs) {
    const self = obs.self.pos;
    const lms = (obs.nearby && obs.nearby.landmarks) || [];
    if (lms.length) {
      const far = lms.reduce((a, b) => (b.dist > a.dist ? b : a));
      return this._steerTo(obs, { bearing: far.bearing, dist: far.dist, elevation: far.pos[1] - self[1] });
    }
    const low = obs.self.altitudeAboveTerrain != null && obs.self.altitudeAboveTerrain < 30;
    return this._safety(obs, { throttle: 0.6, brake: 0, turn: Math.sin(Date.now() / 4000) * 0.3, climb: low ? 0.5 : 0 });
  }

  _safety(obs, action) {
    const probes = (obs.terrain && obs.terrain.ahead) || [];
    const alt = obs.self.altitude;
    for (const p of probes) {
      if (p.dist <= TERRAIN_LOOKOUT && p.height != null && p.height > alt - TERRAIN_MARGIN) { action.climb = 1; break; }
    }
    const ceiling = obs.limits && obs.limits.ceiling;
    if (typeof ceiling === 'number' && alt > ceiling - CEILING_MARGIN) action.climb = Math.min(action.climb, 0);
    return action;
  }
}

if (typeof window !== 'undefined') window.Companion = Companion;
