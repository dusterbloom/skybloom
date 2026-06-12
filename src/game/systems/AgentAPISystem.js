import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';

/**
 * AgentAPISystem — the interface through which AI agents play Magical Carpet
 * as first-class players, under explicit FAIRNESS constraints:
 *
 *  - INFORMATION parity: observe() exposes only what a human could see or
 *    read off the screen/HUD (own kinematics, terrain probes along the
 *    current heading, race HUD data, mana/landmarks within human-visible
 *    perception radii). An optional observation latency buffer simulates
 *    human reaction time.
 *  - ACTION parity: agents drive the exact same virtual input pad humans use
 *    (playerInput.setVirtualPad) and the same spell methods (which enforce
 *    mana costs and cooldowns internally). This system NEVER writes player
 *    position/velocity/rotation or any other game state directly — the pad
 *    and the spell methods are the only effectors.
 *  - TEMPO parity: act() calls are quantized to actionHz ticks (default
 *    10 Hz, clamped to <= 20); between ticks the last applied axes hold,
 *    exactly like a human holding a key. Snapshots are built at
 *    observationHz (default 20 Hz, clamped to <= 20).
 *
 * Surface: `window.agentAPI` (frozen) plus a postMessage bridge
 * ('agentapi:observe' / 'agentapi:act' / 'agentapi:start-race').
 *
 * Peer systems are resolved at runtime by name and every access is
 * null-safe, so the system no-ops cleanly during boot or when an optional
 * peer (e.g. the 'race' system) is absent. This system must never throw.
 */

// Terrain look-ahead probe distances (world units along current heading).
const AHEAD_PROBE_DISTANCES = [100, 300, 500, 700, 900];

// Snapshot ring buffer size. At the 20 Hz observation ceiling this holds
// 3.2 s of history — comfortably more than the 1000 ms max latency.
const RING_SIZE = 64;

// FAIRNESS ceilings for setConfig(). Perception radii may only be reduced
// below the human-visibility defaults, never raised above them; the same
// goes for action/observation rates.
const CONFIG_LIMITS = {
  actionHz: [1, 20],
  observationHz: [1, 20],
  observationLatencyMs: [0, 1000],
  manaRadius: [0, 800],
  landmarkRadius: [0, 2000],
};

export class AgentAPISystem extends System {
  constructor(engine) {
    super(engine, 'agentAPI');

    this.config = {
      actionHz: 10,
      observationHz: 20,
      observationLatencyMs: 0,
      perceptionRadius: { mana: 800, landmarks: 2000 },
    };

    // Accumulated game time (seconds) — drives both tick schedulers and the
    // latency buffer, so pauses/tab-suspends never fast-forward the agent.
    this._gameTime = 0;
    this._tick = 0;
    this._obsAccumulator = 0;
    this._actAccumulator = 0;

    // Pending action: stored by act(), applied at the next action tick.
    // Whole-object replacement => "last write wins" within a tick window.
    this._pendingAction = null;

    // Observation ring buffer. Slots are preallocated and mutated in place;
    // only the snapshot payloads themselves are allocated (at observationHz).
    this._ring = new Array(RING_SIZE);
    for (let i = 0; i < RING_SIZE; i++) this._ring[i] = { t: 0, snap: null };
    this._ringHead = 0; // next write index
    this._ringCount = 0;

    this._api = null;
    this._onMessage = null;
  }

  async _initialize() {
    const api = {
      observe: this.observe.bind(this),
      act: this.act.bind(this),
      release: this.release.bind(this),
      startRace: this.startRace.bind(this),
      abortRace: this.abortRace.bind(this),
      listReplays: this.listReplays.bind(this),
      getBestReplay: this.getBestReplay.bind(this),
      loadGhost: this.loadGhost.bind(this),
      clearGhost: this.clearGhost.bind(this),
      setConfig: this.setConfig.bind(this),
      getConfig: this.getConfig.bind(this),
      meta: {
        version: 1,
        fairness: 'information/action/tempo parity; act 10Hz hold-last; observe 20Hz + latency',
      },
    };
    Object.freeze(api.meta);
    Object.freeze(api);
    this._api = api;

    if (typeof window !== 'undefined') {
      // Agents are players: expose unconditionally, not just in dev builds.
      window.agentAPI = api;

      this._onMessage = (event) => {
        try {
          const data = event && event.data;
          if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

          if (data.type === 'agentapi:observe') {
            const payload = this.observe();
            const reply = { type: 'agentapi:observation', payload };
            const source = event.source;
            if (source && typeof source.postMessage === 'function') {
              try {
                source.postMessage(reply, '*');
              } catch (err) {
                try { window.postMessage(reply, '*'); } catch (err2) { /* swallow */ }
              }
            } else {
              try { window.postMessage(reply, '*'); } catch (err) { /* swallow */ }
            }
          } else if (data.type === 'agentapi:act') {
            this.act(data.payload);
          } else if (data.type === 'agentapi:start-race') {
            this.startRace(data.seed);
          }
        } catch (err) {
          // The bridge must never propagate exceptions into the page.
        }
      };
      window.addEventListener('message', this._onMessage);
    }

    Logger.info('AgentAPISystem initialized — window.agentAPI is live');
  }

  _update(delta, elapsed) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this._gameTime += delta;

    try {
      // ---- Action tick scheduler (tempo parity) -------------------------
      // Fixed 1/actionHz boundaries on accumulated game time. The modulo
      // keeps tick phase stable across frames; if a long hitch spans several
      // boundaries, a single application is equivalent (last write wins and
      // the pad holds between ticks anyway).
      const actInterval = 1 / this.config.actionHz;
      this._actAccumulator += delta;
      if (this._actAccumulator >= actInterval) {
        this._actAccumulator %= actInterval;
        this._applyPendingAction();
      }
    } catch (err) {
      // Never throw — a bad action application must not kill the loop.
    }

    try {
      // ---- Observation tick scheduler -----------------------------------
      const obsInterval = 1 / this.config.observationHz;
      this._obsAccumulator += delta;
      if (this._obsAccumulator >= obsInterval) {
        this._obsAccumulator %= obsInterval;
        this._captureSnapshot();
      }
    } catch (err) {
      // Never throw — a failed snapshot just means no new observation.
    }
  }

  // =====================================================================
  // OBSERVE pipeline
  // =====================================================================

  /**
   * Returns the newest snapshot that is AT LEAST observationLatencyMs old
   * (latency 0 => the newest), as a JSON-cloned copy safe to mutate.
   * Returns null when no snapshot exists yet. If the buffer is younger than
   * the requested latency (e.g. right after boot or after raising latency),
   * the oldest available snapshot is returned as the best approximation.
   */
  observe() {
    try {
      const latencySec = this.config.observationLatencyMs / 1000;
      let chosen = null;
      let oldest = null;

      for (let i = 0; i < this._ringCount; i++) {
        const idx = (((this._ringHead - 1 - i) % RING_SIZE) + RING_SIZE) % RING_SIZE;
        const entry = this._ring[idx];
        if (!entry || !entry.snap) continue;
        oldest = entry;
        if (this._gameTime - entry.t >= latencySec) {
          chosen = entry; // newest-first scan: first qualifying entry wins
          break;
        }
      }

      const entry = chosen || oldest;
      if (!entry) return null;
      return JSON.parse(JSON.stringify(entry.snap));
    } catch (err) {
      return null;
    }
  }

  _captureSnapshot() {
    const playerState = this._getSystem('playerState');
    const player = playerState ? playerState.localPlayer : null;
    if (!player || !player.position || !player.velocity || !player.rotation) return;

    const cfg = this.config;
    const world = this._getSystem('world');
    const canProbe = !!(world && typeof world.getTerrainHeight === 'function');

    const px = this._num(player.position.x);
    const py = this._num(player.position.y);
    const pz = this._num(player.position.z);
    const vx = this._num(player.velocity.x);
    const vy = this._num(player.velocity.y);
    const vz = this._num(player.velocity.z);
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

    const heading = this._num(player.rotation.y);
    const pitch = this._num(player.rotation.x);
    // Forward in this codebase is local +Z: forward_xz = (sin(yaw), cos(yaw)).
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);

    const input = this._getSystem('playerInput');
    const throttle = input ? this._num(input.currentThrottle) : 0;

    const physics = this._getSystem('playerPhysics');
    const ceiling = physics ? this._num(physics.maxAltitude, null) : null;

    // ---- terrain ---------------------------------------------------------
    const below = canProbe ? this._num(world.getTerrainHeight(px, pz), null) : null;
    const ahead = [];
    for (let i = 0; i < AHEAD_PROBE_DISTANCES.length; i++) {
      const d = AHEAD_PROBE_DISTANCES[i];
      ahead.push({
        dist: d,
        height: canProbe ? this._num(world.getTerrainHeight(px + sinH * d, pz + cosH * d), null) : null,
      });
    }

    // ---- active spell effects (what the HUD shows) -------------------------
    const playerSys = this._getSystem('player');
    const spells = playerSys ? playerSys.spells : null;
    const effects = [];
    if (spells && Array.isArray(spells.activeEffects)) {
      for (let i = 0; i < spells.activeEffects.length; i++) {
        const fx = spells.activeEffects[i];
        if (!fx) continue;
        const name = (fx.spell && (fx.spell.name || fx.spell.id)) || fx.name || fx.type || null;
        if (typeof name === 'string') effects.push(name);
      }
    }

    // ---- race (HUD data only; null when the race system is absent) --------
    const raceSystem = this._getSystem('race');
    let race = null;
    if (raceSystem) {
      const nextGates = [];
      if (typeof raceSystem.getUpcomingGates === 'function') {
        let upcoming = null;
        try { upcoming = raceSystem.getUpcomingGates(3); } catch (err) { upcoming = null; }
        if (Array.isArray(upcoming)) {
          for (let i = 0; i < upcoming.length && nextGates.length < 3; i++) {
            const gate = upcoming[i];
            const gp = gate ? gate.position : null;
            if (!gp) continue;
            const gx = this._num(gp.x);
            const gy = this._num(gp.y);
            const gz = this._num(gp.z);
            const dx = gx - px;
            const dy = gy - py;
            const dz = gz - pz;
            nextGates.push({
              pos: [gx, gy, gz],
              dist: Math.sqrt(dx * dx + dy * dy + dz * dz),
              bearing: this._bearing(dx, dz, sinH, cosH),
              elevation: gy - py,
              radius: this._num(gate.radius),
            });
          }
        }
      }

      let gateCount = null;
      if (Number.isFinite(raceSystem.gateCount)) gateCount = raceSystem.gateCount;
      else if (Array.isArray(raceSystem.gates)) gateCount = raceSystem.gates.length;
      else if (raceSystem.course && Array.isArray(raceSystem.course.gates)) gateCount = raceSystem.course.gates.length;

      race = {
        state: typeof raceSystem.state === 'string' ? raceSystem.state : 'idle',
        courseSeed: raceSystem.courseSeed !== undefined ? raceSystem.courseSeed : null,
        gateIndex: this._num(raceSystem.currentGateIndex, 0),
        gateCount,
        elapsedMs: this._num(raceSystem.elapsedMs, 0),
        splits: Array.isArray(raceSystem.splits) ? raceSystem.splits.slice() : [],
        nextGates,
      };
    }

    // ---- nearby: mana nodes (nearest <= 10 uncollected within radius) ------
    const manaOut = [];
    const manaRadiusSq = cfg.perceptionRadius.mana * cfg.perceptionRadius.mana;
    const nodes = world && Array.isArray(world.manaNodes) ? world.manaNodes : null;
    if (nodes) {
      const candidates = [];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node || !node.position) continue;
        if (node.userData && node.userData.collected) continue;
        const dx = this._num(node.position.x) - px;
        const dy = this._num(node.position.y) - py;
        const dz = this._num(node.position.z) - pz;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq <= manaRadiusSq) candidates.push({ node, distSq });
      }
      candidates.sort((a, b) => a.distSq - b.distSq);
      const count = Math.min(10, candidates.length);
      for (let i = 0; i < count; i++) {
        const np = candidates[i].node.position;
        const nx = this._num(np.x);
        const ny = this._num(np.y);
        const nz = this._num(np.z);
        manaOut.push({
          pos: [nx, ny, nz],
          dist: Math.sqrt(candidates[i].distSq),
          bearing: this._bearing(nx - px, nz - pz, sinH, cosH),
        });
      }
    }

    // ---- nearby: landmarks within radius -----------------------------------
    const landmarksOut = [];
    const lmSystem = this._getSystem('landmarks');
    const lmMap = lmSystem ? lmSystem.landmarks : null;
    if (lmMap && typeof lmMap.forEach === 'function') {
      const lmRadiusSq = cfg.perceptionRadius.landmarks * cfg.perceptionRadius.landmarks;
      lmMap.forEach((lm) => {
        if (!lm || !lm.position) return;
        const lx = this._num(lm.position.x);
        const ly = this._num(lm.position.y);
        const lz = this._num(lm.position.z);
        const dx = lx - px;
        const dy = ly - py;
        const dz = lz - pz;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > lmRadiusSq) return;
        landmarksOut.push({
          type: typeof lm.type === 'string' ? lm.type : 'unknown',
          pos: [lx, ly, lz],
          dist: Math.sqrt(distSq),
          bearing: this._bearing(dx, dz, sinH, cosH),
        });
      });
      landmarksOut.sort((a, b) => a.dist - b.dist);
    }

    // ---- assemble + push into the latency ring -----------------------------
    const maxSpeed = this._num(player.maxSpeed);
    const snapshot = {
      version: 1,
      t: this._gameTime,
      tick: this._tick++,
      self: {
        pos: [px, py, pz],
        vel: [vx, vy, vz],
        speed,
        heading,
        pitch,
        bank: this._num(player.bankAngle),
        throttle,
        altitude: py,
        altitudeAboveTerrain: below === null ? null : py - below,
        mana: this._num(player.mana),
        totalMana: this._num(player.totalMana),
        currentSpell: this._num(player.currentSpell, 0),
        effects,
      },
      limits: {
        maxSpeed,
        boostedMaxSpeed: maxSpeed * 1.5,
        ceiling,
        turnRate: input ? this._num(input.turnRate, 1.6) : 1.6,
        actionHz: cfg.actionHz,
        observationHz: cfg.observationHz,
      },
      terrain: { below, ahead },
      race,
      nearby: { manaNodes: manaOut, landmarks: landmarksOut },
    };

    const slot = this._ring[this._ringHead];
    slot.t = this._gameTime;
    slot.snap = snapshot;
    this._ringHead = (this._ringHead + 1) % RING_SIZE;
    if (this._ringCount < RING_SIZE) this._ringCount++;
  }

  // =====================================================================
  // ACT pipeline
  // =====================================================================

  /**
   * Queue an action: { throttle?, brake?, turn?, climb?, selectSpell?, cast? }.
   * Values are clamped (throttle/brake to [0,1], turn/climb to [-1,1],
   * selectSpell to an int in [0,3]); NaN values and unknown keys are ignored.
   * The action takes effect at the NEXT action tick (1/actionHz); between
   * ticks the previously applied axes hold (the virtual pad persists).
   * Multiple act() calls within one tick window: last write wins.
   * Returns true if the action was queued, false if the input was unusable.
   */
  act(action) {
    try {
      if (!action || typeof action !== 'object') return false;

      const pad = {};
      let hasPad = false;
      const throttle = this._sanitizeAxis(action.throttle, 0, 1);
      if (throttle !== null) { pad.throttle = throttle; hasPad = true; }
      const brake = this._sanitizeAxis(action.brake, 0, 1);
      if (brake !== null) { pad.brake = brake; hasPad = true; }
      const turn = this._sanitizeAxis(action.turn, -1, 1);
      if (turn !== null) { pad.turn = turn; hasPad = true; }
      const climb = this._sanitizeAxis(action.climb, -1, 1);
      if (climb !== null) { pad.climb = climb; hasPad = true; }

      let selectSpell = null;
      if (action.selectSpell !== undefined) {
        const raw = this._sanitizeAxis(action.selectSpell, 0, 3);
        if (raw !== null) selectSpell = Math.round(raw);
      }

      this._pendingAction = {
        pad: hasPad ? pad : null,
        selectSpell,
        cast: !!action.cast,
      };
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Drop any pending action and clear the virtual pad immediately. */
  release() {
    try {
      this._pendingAction = null;
      const input = this._getSystem('playerInput');
      if (input && typeof input.clearVirtualPad === 'function') {
        input.clearVirtualPad();
      }
    } catch (err) {
      // never throw
    }
  }

  /**
   * Runs at action-tick boundaries only. The virtual pad and the player
   * system's spell methods are the SOLE effectors — spell selection and
   * casting go through player.spells so its internal mana/cooldown guards
   * enforce action parity. No game state is ever written directly.
   */
  _applyPendingAction() {
    const action = this._pendingAction;
    if (!action) return; // nothing new: pad holds its last applied values
    this._pendingAction = null;

    if (action.pad) {
      const input = this._getSystem('playerInput');
      if (input && typeof input.setVirtualPad === 'function') {
        input.setVirtualPad(action.pad);
      }
    }

    if (action.selectSpell !== null || action.cast) {
      const playerSys = this._getSystem('player');
      const spells = playerSys ? playerSys.spells : null;
      if (spells) {
        if (action.selectSpell !== null && typeof spells.selectSpell === 'function') {
          spells.selectSpell(action.selectSpell);
        }
        if (action.cast && typeof spells.castSpell === 'function') {
          spells.castSpell();
        }
      }
    }
  }

  // =====================================================================
  // RACE pass-through (thin null-safe delegates; 'race' may be absent)
  // =====================================================================

  startRace(courseSeed) { return this._raceCall('start', [courseSeed], null); }

  abortRace() { return this._raceCall('abort', [], null); }

  listReplays() { return this._raceCall('listReplays', [], []); }

  getBestReplay(courseSeed) { return this._raceCall('getBestReplay', [courseSeed], null); }

  loadGhost(replay) { return this._raceCall('loadGhost', [replay], null); }

  clearGhost() { return this._raceCall('clearGhost', [], null); }

  _raceCall(method, args, absentValue) {
    try {
      const race = this._getSystem('race');
      if (!race || typeof race[method] !== 'function') return absentValue;
      const out = race[method](...args);
      return out === undefined ? absentValue : out;
    } catch (err) {
      return absentValue;
    }
  }

  // =====================================================================
  // Config
  // =====================================================================

  /**
   * Partial config update. Rates and radii are clamped to the FAIRNESS
   * ceilings (actionHz [1,20], observationHz [1,20], latency [0,1000] ms,
   * perception radii at most the human-visibility defaults).
   * Returns the effective config.
   */
  setConfig(partial) {
    try {
      if (partial && typeof partial === 'object') {
        if (partial.actionHz !== undefined) {
          const v = Number(partial.actionHz);
          if (Number.isFinite(v)) {
            this.config.actionHz = this._clamp(v, CONFIG_LIMITS.actionHz[0], CONFIG_LIMITS.actionHz[1]);
          }
        }
        if (partial.observationHz !== undefined) {
          const v = Number(partial.observationHz);
          if (Number.isFinite(v)) {
            this.config.observationHz = this._clamp(v, CONFIG_LIMITS.observationHz[0], CONFIG_LIMITS.observationHz[1]);
          }
        }
        if (partial.observationLatencyMs !== undefined) {
          const v = Number(partial.observationLatencyMs);
          if (Number.isFinite(v)) {
            this.config.observationLatencyMs = this._clamp(v, CONFIG_LIMITS.observationLatencyMs[0], CONFIG_LIMITS.observationLatencyMs[1]);
          }
        }
        if (partial.perceptionRadius && typeof partial.perceptionRadius === 'object') {
          const mana = Number(partial.perceptionRadius.mana);
          if (Number.isFinite(mana)) {
            this.config.perceptionRadius.mana = this._clamp(mana, CONFIG_LIMITS.manaRadius[0], CONFIG_LIMITS.manaRadius[1]);
          }
          const landmarks = Number(partial.perceptionRadius.landmarks);
          if (Number.isFinite(landmarks)) {
            this.config.perceptionRadius.landmarks = this._clamp(landmarks, CONFIG_LIMITS.landmarkRadius[0], CONFIG_LIMITS.landmarkRadius[1]);
          }
        }
      }
    } catch (err) {
      // never throw
    }
    return this.getConfig();
  }

  /** Returns a detached copy of the effective config. */
  getConfig() {
    const c = this.config;
    return {
      actionHz: c.actionHz,
      observationHz: c.observationHz,
      observationLatencyMs: c.observationLatencyMs,
      perceptionRadius: { mana: c.perceptionRadius.mana, landmarks: c.perceptionRadius.landmarks },
    };
  }

  // =====================================================================
  // Internals
  // =====================================================================

  /**
   * Signed relative bearing to a target offset (dx, dz), in radians within
   * [-PI, PI]. 0 = dead ahead, NEGATIVE = target is to the LEFT, positive =
   * target is to the RIGHT — matching the virtual pad's turn axis (+ = right),
   * so a steering controller can simply feed `turn = k * bearing`.
   *
   * Derivation for THIS codebase's conventions:
   *   forward (local +Z): f = (sin h, cos h) in xz, with h = rotation.y
   *   a RIGHT turn DECREASES rotation.y (PlayerInputSystem:
   *   `rotation.y -= turnInput * turnRate * delta`, turnInput + = D/right),
   *   so the pilot's right-hand side is r = (-cos h, sin h).
   * Then
   *   bearing = atan2(d . r, d . f) = normalize((-atan2(dx, dz)) - (-h))
   * i.e. exactly "atan2 of the target direction minus heading" expressed on
   * the compass axis (where right turns increase the angle); the atan2-of-
   * dot-products form needs no extra wrap-around handling and is immune to
   * rotation.y growing beyond +/-PI (it is never wrapped by the input code).
   */
  _bearing(dx, dz, sinH, cosH) {
    const forwardComp = dx * sinH + dz * cosH; // d . forward
    const rightComp = dz * sinH - dx * cosH;   // d . right
    return Math.atan2(rightComp, forwardComp);
  }

  /**
   * Axis sanitizer: undefined or NaN -> null (key ignored); +/-Infinity and
   * out-of-range finite values clamp to [min, max].
   */
  _sanitizeAxis(value, min, max) {
    if (value === undefined || value === null) return null;
    const v = Number(value);
    if (Number.isNaN(v)) return null;
    return this._clamp(v, min, max);
  }

  _clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  /** Finite-number guard for snapshot fields. */
  _num(v, fallback = 0) {
    return Number.isFinite(v) ? v : fallback;
  }

  /** Runtime peer lookup — never imported, never cached, always null-safe. */
  _getSystem(name) {
    const engine = this.engine;
    if (!engine) return null;
    const systems = engine.systems;
    if (systems && typeof systems.get === 'function') {
      const sys = systems.get(name);
      if (sys) return sys;
    }
    const manager = engine.systemManager;
    if (manager && typeof manager.get === 'function') {
      const sys = manager.get(name);
      if (sys) return sys;
    }
    return null;
  }

  destroy() {
    try {
      if (typeof window !== 'undefined') {
        if (this._onMessage) {
          window.removeEventListener('message', this._onMessage);
        }
        if (window.agentAPI === this._api) {
          try { delete window.agentAPI; } catch (err) { window.agentAPI = undefined; }
        }
      }
      this.release();
    } catch (err) {
      // never throw
    }
    this._onMessage = null;
    this._api = null;
    this._pendingAction = null;
    for (let i = 0; i < RING_SIZE; i++) {
      this._ring[i].snap = null;
      this._ring[i].t = 0;
    }
    this._ringHead = 0;
    this._ringCount = 0;
    super.destroy();
  }
}
