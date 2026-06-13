import * as THREE from 'three';
import { Logger } from '../../utils/Logger.js';
import { System } from '../core/System.js';
import { SimpleBot } from '../../agents/SimpleBot.js';
import { useGameState, GameStates } from '../state/gameState.js';
import { ensureVibeTheme } from '../ui/theme.js';

/**
 * RaceSystem — seeded gate time-trials with replays and ghost playback.
 *
 * Designed so humans and AI agents can compete fairly: the course layout is
 * fully deterministic from `courseSeed` (anchored at the player's position and
 * heading when start() is called), the race clock is GAME time (sum of update
 * deltas — pausing the tab pauses the race; wall clock is never used), and
 * finished runs are recorded as replays that can be played back as ghosts in
 * later runs. Competition is async, so network latency never matters.
 *
 * PUBLIC CONTRACT (consumed by the AgentAPI system, built in parallel):
 *   Properties: state ('idle'|'running'|'finished'), courseSeed (int),
 *               elapsedMs, currentGateIndex, splits (ms array),
 *               gateCount (getter).
 *   Methods:    start(courseSeed?), abort(), getUpcomingGates(n),
 *               listReplays(), getBestReplay(courseSeed),
 *               loadGhost(replayObj), clearGhost().
 *   EventBus:   'raceStarted' {courseSeed},
 *               'gatePassed'  {index, splitMs},
 *               'raceFinished'{timeMs, replay}.
 *
 * Peer systems are resolved at runtime (never captured at init):
 *   playerState → .localPlayer {position, rotation, velocity}
 *   world       → .getTerrainHeight(x, z), .seed (may be undefined → 0)
 *   playerInput → .inputSourcesThisFrame {keyboard, virtual} (read
 *                 defensively; the field is being built in parallel)
 *   ui          → .showMessage?(text) for the one-time hint
 *
 * Registration is wired by the orchestrator (not done here):
 *   sm.register(new RaceSystem(engine)) and add 'race' to the update order
 *   after 'player'.
 */

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

const GATE_COUNT = 12;
const GATE_RADIUS = 18;                 // torus major radius (world units)
const PASS_MARGIN = 2;                  // pass when segment comes within radius + margin
const FIRST_GATE_DISTANCE = 330;        // gate 0 sits this far along the player's heading
const GATE_SPACING_MIN = 450;           // min distance between consecutive gates
const GATE_SPACING_SPREAD = 200;        // spacing = 450 + rand * 200 → [450, 650)
const HEADING_DRIFT_MAX = 0.55;         // per-gate cumulative heading drift, ± radians
const GATE_CLEARANCE = 30;              // min height above terrain (or sea level 0)
const GATE_ALTITUDE_SPREAD = 80;        // extra altitude = rand * 80
const GATE_ALTITUDE_CEILING = 800;      // hard clamp on gate altitude
const BEACON_HEIGHT = 250;
const BEACON_RADIUS = 2;

const SAMPLE_INTERVAL = 0.1;            // replay recording: 10 Hz
const HUD_INTERVAL = 0.1;               // HUD refresh: ~10 Hz
const REPLAY_STORE_KEY = 'vibecarpet.replays.v1';
const REPLAY_STORE_CAP = 20;
const RESULT_SCHEMA_VERSION = 2;

const COLOR_UPCOMING = 0x66ffee;
const COLOR_PASSED = 0x335555;
const COLOR_NEXT = 0xffcc66;
const COLOR_GHOST = 0x66ffee;

const BUILD_VERSION = typeof __SKYBLOOM_BUILD_VERSION__ !== 'undefined'
  ? __SKYBLOOM_BUILD_VERSION__
  : 'dev';

/**
 * mulberry32 — tiny deterministic PRNG. Same seed → same course, everywhere.
 * Returns floats in [0, 1).
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RaceSystem extends System {
  constructor(engine) {
    super(engine, 'race');

    // --- Public contract state -------------------------------------------
    this.state = 'idle';        // 'idle' | 'running' | 'finished'
    this.courseSeed = 0;        // uint32 seed of the current course
    this.elapsedMs = 0;         // game-time ms since gate 0 was crossed
    this.currentGateIndex = 0;  // index of the gate the player must cross next
    this.splits = [];           // ms at each gate pass (splits[0] === 0)

    // --- Course data -------------------------------------------------------
    // Gate objects are pooled and reused across rebuilds (no steady-state churn).
    this.gates = [];            // [{ position: Vector3, radius, index, passed }]
    this._gatePool = [];

    // --- Race bookkeeping ---------------------------------------------------
    this._clockRunning = false; // true once gate 0 is crossed
    this._finalTimeMs = 0;
    this._sawKeyboard = false;  // pilot attribution, tracked while clock runs
    this._sawVirtual = false;

    // --- Replay recording ----------------------------------------------------
    this._samples = [];         // [[tMs, x, y, z, heading], ...] at 10 Hz
    this._actionLog = [];       // agent action/config metadata when available
    this._sampleAccum = 0;
    this.replays = [];          // in-memory mirror of the localStorage store
    this._latestReplay = null;  // last finished replay in this session
    this._storageWarned = false;

    // --- Ghost playback -------------------------------------------------------
    this.ghostReplay = null;    // armed replay (persists across runs until cleared)
    this.ghostMesh = null;
    this._ghostActive = false;  // playing on the current race clock
    this._ghostCursor = 0;      // index of the sample segment in use (monotonic)

    // --- Visuals ---------------------------------------------------------------
    this.courseGroup = null;
    this._gateMeshes = [];
    this._beaconMesh = null;
    this._nextGateMesh = null;
    this._torusGeometry = null;
    this._beaconGeometry = null;
    this._ghostGeometry = null;
    this._materials = null;

    // --- HUD ---------------------------------------------------------------------
    this._hudRoot = null;
    this._raceChip = null;
    this._ghostChip = null;
    this._panelRoot = null;
    this._panelToggle = null;
    this._panelFields = {};
    this._panelButtons = {};
    this._panelOpen = false;
    this._hudAccum = 0;
    this._hudDirty = false;
    this._panelDirty = false;
    this._lastRaceText = null;
    this._lastGhostText = null;
    this._lastPanelText = {};

    // --- Reference bot controls ---------------------------------------------------
    this._simpleBot = null;
    this._simpleBotRunning = false;

    // --- Reused temporaries (no per-frame allocations in steady state) -------------
    this._prevPlayerPos = new THREE.Vector3();
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();

    this._onKeyDown = null;
    this._onAgentActionQueued = null;
    this._hintTimer = null;
  }

  /** Number of gates in the current course (0 when no course is built). */
  get gateCount() {
    return this.gates.length;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async _initialize() {
    this._createSharedResources();
    this._createHud();
    this._removePanelNodes();
    this.replays = this._loadReplayStore();
    this._latestReplay = this.replays.length ? this.replays[this.replays.length - 1] : null;

    // KeyR starts a fresh race (deliberately NOT a restart while running, so a
    // stray keypress mid-race can't wipe a good run — call start() for that).
    this._onKeyDown = (event) => {
      if (event.code !== 'KeyR' || event.repeat) return;
      const t = event.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!this._isGamePlaying()) return;
      if (this.state !== 'running') this.start();
    };
    window.addEventListener('keydown', this._onKeyDown);

    this._onAgentActionQueued = (event) => this.recordAgentAction(event);
    this.engine.eventBus.on('agentActionQueued', this._onAgentActionQueued);

    // One-time discoverability hint, guarded — UI system may be absent.
    this._hintTimer = setTimeout(() => {
      try {
        this.engine.systems.get('ui')?.showMessage?.('Press R to race');
      } catch (e) {
        /* hint is best-effort */
      }
    }, 3000);

    Logger.info(`RaceSystem initialized (${this.replays.length} stored replays)`);
  }

  _update(delta, elapsed) {
    // Pulse the next-gate ring/beacon whenever a course exists (also in the
    // idle preview, where gate 0 stays lit as the start ring).
    if (this._nextGateMesh) this._animateNextGate(elapsed);

    if (this.state === 'running') {
      const player = this._getLocalPlayer();
      if (player) {
        if (this._clockRunning) {
          // GAME time only: pausing the tab pauses the engine loop and
          // therefore the race clock. Never Date.now().
          this.elapsedMs += delta * 1000;
          this._trackPilot();
          this._sampleAccum += delta;
          while (this._sampleAccum >= SAMPLE_INTERVAL) {
            this._sampleAccum -= SAMPLE_INTERVAL;
            this._pushSample(player);
          }
          this._updateGhost();
        }
        this._checkGatePass(player);
        this._prevPlayerPos.copy(player.position);
      }
    }

    // HUD refresh at ~10 Hz (immediately when something changed).
    this._hudAccum += delta;
    if (this._hudAccum >= HUD_INTERVAL || this._hudDirty) {
      this._hudAccum = 0;
      this._hudDirty = false;
      this._updateHud();
      this._updatePanel();
    }
  }

  destroy() {
    if (this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this._hintTimer) {
      clearTimeout(this._hintTimer);
      this._hintTimer = null;
    }
    if (this._hudRoot && this._hudRoot.parentNode) {
      this._hudRoot.parentNode.removeChild(this._hudRoot);
    }
    if (this._panelRoot && this._panelRoot.parentNode) {
      this._panelRoot.parentNode.removeChild(this._panelRoot);
    }
    if (this._panelToggle && this._panelToggle.parentNode) {
      this._panelToggle.parentNode.removeChild(this._panelToggle);
    }
    this._hudRoot = null;
    this._raceChip = null;
    this._ghostChip = null;
    this._panelRoot = null;
    this._panelToggle = null;
    this._panelFields = {};
    this._panelButtons = {};

    if (this._onAgentActionQueued) {
      this.engine.eventBus.off('agentActionQueued', this._onAgentActionQueued);
      this._onAgentActionQueued = null;
    }
    this.stopSimpleBot();

    if (this.courseGroup) {
      this.engine.scene.remove(this.courseGroup);
      this.courseGroup = null;
    }
    if (this.ghostMesh) {
      this.engine.scene.remove(this.ghostMesh);
      this.ghostMesh = null;
    }
    if (this._torusGeometry) this._torusGeometry.dispose();
    if (this._beaconGeometry) this._beaconGeometry.dispose();
    if (this._ghostGeometry) this._ghostGeometry.dispose();
    this._torusGeometry = null;
    this._beaconGeometry = null;
    this._ghostGeometry = null;
    if (this._materials) {
      for (const key of Object.keys(this._materials)) this._materials[key].dispose();
      this._materials = null;
    }
    this._gateMeshes.length = 0;
    this._beaconMesh = null;
    this._nextGateMesh = null;

    this.gates.length = 0;
    this.ghostReplay = null;
    this._ghostActive = false;
    this.state = 'idle';

    super.destroy();
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Build (or rebuild) a course near the player and enter 'running'.
   * The clock does NOT start yet — it starts when gate 0 (the start ring) is
   * crossed, so the run-up is free. Calling start() while running restarts.
   * @param {number} [courseSeed] uint32; omitted → fresh random seed.
   * @returns {number|null} the seed in use, or null if no player exists yet.
   */
  start(courseSeed) {
    const player = this._getLocalPlayer();
    if (!player) {
      Logger.warn('RaceSystem.start: no local player yet, cannot place a course');
      return null;
    }

    const seed = Number.isFinite(courseSeed)
      ? (courseSeed >>> 0)
      : ((Math.random() * 0x100000000) >>> 0);

    this.courseSeed = seed;
    this._buildCourse(seed, player);

    this.state = 'running';
    this.elapsedMs = 0;
    this._finalTimeMs = 0;
    this.currentGateIndex = 0;
    this.splits.length = 0;
    this._clockRunning = false;
    this._sawKeyboard = false;
    this._sawVirtual = false;
    this._samples = [];
    this._actionLog = [];
    this._sampleAccum = 0;
    this._prevPlayerPos.copy(player.position);

    // Ghost stays armed across runs; playback re-syncs to the new clock.
    this._ghostActive = false;
    this._ghostCursor = 0;
    if (this.ghostMesh) this.ghostMesh.visible = false;

    this._refreshGateVisuals();
    this._hudDirty = true;
    this._panelDirty = true;
    this._toast(`Race seed ${seed} ready — fly through the lit ring`, '#ffcc66');
    this.engine.eventBus.emit('raceStarted', { courseSeed: seed });
    Logger.info(`RaceSystem: race started, courseSeed=${seed}`);
    return seed;
  }

  /** Stop the current run. The course stays visible as an idle preview. */
  abort() {
    this.state = 'idle';
    this._clockRunning = false;
    this.elapsedMs = 0;
    this.currentGateIndex = 0;
    this.splits.length = 0;
    this._samples = [];
    this._actionLog = [];
    for (let i = 0; i < this.gates.length; i++) this.gates[i].passed = false;
    this._ghostActive = false;
    if (this.ghostMesh) this.ghostMesh.visible = false;
    const api = typeof window !== 'undefined' ? window.agentAPI : null;
    if (api && typeof api.release === 'function') api.release();
    this._refreshGateVisuals(); // idle preview: gate 0 lit as the start ring
    this._hudDirty = true;
    this._panelDirty = true;
  }

  /**
   * Upcoming gates for HUD/agents: up to n of { position, radius, index },
   * starting at currentGateIndex while running, or gate 0 otherwise (idle or
   * finished course preview). No course built → []. Positions are clones —
   * safe for callers to mutate.
   */
  getUpcomingGates(n = 3) {
    const result = [];
    if (this.gates.length === 0) return result;
    const start = this.state === 'running' ? this.currentGateIndex : 0;
    for (let i = start; i < this.gates.length && result.length < n; i++) {
      const gate = this.gates[i];
      result.push({ position: gate.position.clone(), radius: gate.radius, index: gate.index });
    }
    return result;
  }

  /**
   * Lightweight metas of all stored replays (no samples). Each meta carries
   * an `id` that loadGhost() also accepts, so callers can ghost any stored
   * run without holding the full sample payload.
   */
  listReplays() {
    return this.replays.map((r, i) => ({
      id: i,
      version: r.version,
      pilot: r.pilot,
      worldSeed: r.worldSeed,
      courseSeed: r.courseSeed,
      date: r.date,
      finalTimeMs: r.finalTimeMs,
      splits: Array.isArray(r.splits) ? r.splits.slice() : [],
      sampleCount: Array.isArray(r.samples) ? r.samples.length : 0,
      actionLogCount: Array.isArray(r.actionLog) ? r.actionLog.length : 0,
      verificationStatus: r.verificationStatus || (Array.isArray(r.actionLog) && r.actionLog.length > 0 ? 'action-log-present' : 'ghost-only')
    }));
  }

  /** Full replay object (with samples) of the fastest run on a seed, or null. */
  getBestReplay(courseSeed) {
    let best = null;
    for (let i = 0; i < this.replays.length; i++) {
      const r = this.replays[i];
      if (r.courseSeed === courseSeed && (!best || r.finalTimeMs < best.finalTimeMs)) best = r;
    }
    return best;
  }

  /**
   * Arm a replay for ghost playback. The ghost flies on the race clock: it
   * appears when the NEXT run's clock starts (gate 0), and if a clock is
   * already running it joins at the current race time.
   *
   * A replay recorded on a different courseSeed (or worldSeed) is still
   * accepted — the ghost simply flies its recorded world-space path.
   * Comparing apples to apples is the caller's concern.
   *
   * Accepts a full replay object, or a meta from listReplays() (resolved via
   * its `id`). Returns true if the ghost was armed.
   */
  loadGhost(replayObj) {
    let replay = replayObj;
    if (replay && !Array.isArray(replay.samples) && Number.isInteger(replay.id)) {
      replay = this.replays[replay.id] || null;
    }
    if (!replay || !Array.isArray(replay.samples) || replay.samples.length < 2) {
      Logger.warn('RaceSystem.loadGhost: replay has no usable samples');
      return false;
    }
    this.ghostReplay = replay;
    this._ghostCursor = 0;
    this._ghostActive = this.state === 'running' && this._clockRunning;
    this._ensureGhostMesh();
    this.ghostMesh.visible = false; // positioned on the next update tick
    this._hudDirty = true;
    return true;
  }

  /** Disarm and hide the ghost. */
  clearGhost() {
    this.ghostReplay = null;
    this._ghostActive = false;
    if (this.ghostMesh) this.ghostMesh.visible = false;
    this._hudDirty = true;
  }

  /** Most recent full replay saved in this browser session/store, or null. */
  getLatestReplay() {
    if (this._latestReplay) return this._latestReplay;
    return this.replays.length ? this.replays[this.replays.length - 1] : null;
  }

  /** Best replay for the current seed, or the fastest stored replay when no seed is active. */
  getPanelBestReplay() {
    if (this.courseSeed) return this.getBestReplay(this.courseSeed);
    let best = null;
    for (let i = 0; i < this.replays.length; i++) {
      const replay = this.replays[i];
      if (!best || replay.finalTimeMs < best.finalTimeMs) best = replay;
    }
    return best;
  }

  /** Load the current seed's best local replay as a ghost. */
  loadBestGhost() {
    const replay = this.getPanelBestReplay();
    const ok = this.loadGhost(replay);
    this._toast(ok ? 'Best ghost loaded' : 'No saved ghost yet', ok ? '#66ffee' : '#ffcc66');
    return ok;
  }

  /** Restart the current seed when available, otherwise start a fresh course. */
  restartSameSeed() {
    return this.start(this.courseSeed || undefined);
  }

  /** Start the bundled reference agent through the same public Agent API users get. */
  runSimpleBot() {
    if (this._simpleBotRunning) return true;
    const api = typeof window !== 'undefined' ? window.agentAPI : null;
    if (!api) {
      this._toast('Agent API is not ready yet', '#ffcc66');
      return false;
    }
    try {
      this._simpleBot = new SimpleBot(api, {
        courseSeed: this.courseSeed || undefined,
        once: false,
      });
      this._simpleBot.start();
      this._simpleBotRunning = true;
      this._panelDirty = true;
      this._toast('SimpleBot is flying', '#66ffee');
      return true;
    } catch (error) {
      Logger.warn('RaceSystem: SimpleBot failed to start', error);
      this._toast('SimpleBot failed to start', '#ff7777');
      return false;
    }
  }

  /** Stop the bundled reference agent and immediately return control to the human. */
  stopSimpleBot() {
    if (this._simpleBot) {
      try { this._simpleBot.stop(); } catch (error) { /* best effort */ }
    }
    this._simpleBot = null;
    this._simpleBotRunning = false;
    this._panelDirty = true;
    return true;
  }

  /**
   * Record sanitized agent action metadata while the race clock is running.
   * This is not deterministic verification; it is replay v2 groundwork.
   */
  recordAgentAction(event) {
    if (!event || this.state !== 'running' || !this._clockRunning) return;
    const action = event.action && typeof event.action === 'object' ? event.action : null;
    if (!action) return;
    this._actionLog.push({
      tMs: Math.round(this.elapsedMs),
      source: event.source || 'agentAPI',
      action: JSON.parse(JSON.stringify(action)),
      config: event.config ? JSON.parse(JSON.stringify(event.config)) : this._getFairnessConfig(),
    });
  }

  /**
   * Return an honest benchmark JSON object. With { download: true }, also
   * downloads it in the browser. The current implementation records ghost path
   * samples and optional agent action metadata; it does not verify by replaying.
   */
  exportResult(replayRef = null, options = {}) {
    const replay = this._resolveReplayRef(replayRef) || this.getLatestReplay();
    if (!replay) return null;
    const result = this._buildExportResult(replay);
    if (options && options.download) this._downloadJson(result, this._resultFilename(result));
    return result;
  }

  // =========================================================================
  // Course generation
  // =========================================================================

  /**
   * Deterministic layout from `seed`, anchored at the player's position and
   * horizontal heading at start() time. RNG draw order is part of the course
   * format — do not reorder:
   *   gate 0:  [altitude]
   *   gate i:  [headingDrift, spacing, altitude]
   * Heading convention matches PlayerPhysics: forward = (0,0,1) rotated by
   * rotation.y, i.e. dir = (sin(heading), 0, cos(heading)).
   */
  _buildCourse(seed, player) {
    const rng = mulberry32(seed);
    const world = this.engine.systems.get('world');

    let heading = player.rotation.y;
    let prevX = player.position.x;
    let prevZ = player.position.z;

    this.gates.length = 0;
    for (let i = 0; i < GATE_COUNT; i++) {
      let dist;
      if (i === 0) {
        dist = FIRST_GATE_DISTANCE;
      } else {
        heading += (rng() * 2 - 1) * HEADING_DRIFT_MAX;
        dist = GATE_SPACING_MIN + rng() * GATE_SPACING_SPREAD;
      }
      const x = prevX + Math.sin(heading) * dist;
      const z = prevZ + Math.cos(heading) * dist;
      const ground = this._terrainHeightAt(world, x, z);
      const y = Math.min(
        Math.max(ground, 0) + GATE_CLEARANCE + rng() * GATE_ALTITUDE_SPREAD,
        GATE_ALTITUDE_CEILING
      );

      let gate = this._gatePool[i];
      if (!gate) {
        gate = { position: new THREE.Vector3(), radius: GATE_RADIUS, index: i, passed: false };
        this._gatePool[i] = gate;
      }
      gate.position.set(x, y, z);
      gate.radius = GATE_RADIUS;
      gate.index = i;
      gate.passed = false;
      this.gates.push(gate);

      prevX = x;
      prevZ = z;
    }

    this._layoutCourseMeshes(player);
  }

  _terrainHeightAt(world, x, z) {
    if (!world || typeof world.getTerrainHeight !== 'function') return 0;
    try {
      const h = world.getTerrainHeight(x, z);
      return Number.isFinite(h) ? h : 0;
    } catch (e) {
      return 0;
    }
  }

  // =========================================================================
  // Visuals
  // =========================================================================

  _createSharedResources() {
    // Geometries and materials are created ONCE and shared by every gate;
    // rebuilds only move/re-skin the pooled meshes. Disposal happens solely
    // in destroy().
    this._torusGeometry = new THREE.TorusGeometry(GATE_RADIUS, 1.2, 8, 28);
    this._beaconGeometry = new THREE.CylinderGeometry(
      BEACON_RADIUS, BEACON_RADIUS, BEACON_HEIGHT, 8, 1, true
    );
    this._ghostGeometry = new THREE.BoxGeometry(5, 0.4, 8);

    const makeMat = (color, opacity, extra) => new THREE.MeshBasicMaterial(Object.assign({
      color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity,
      depthWrite: false
    }, extra));

    this._materials = {
      upcoming: makeMat(COLOR_UPCOMING, 0.6),
      passed: makeMat(COLOR_PASSED, 0.6),
      next: makeMat(COLOR_NEXT, 0.6),
      beacon: makeMat(COLOR_NEXT, 0.18, { side: THREE.DoubleSide }),
      ghost: makeMat(COLOR_GHOST, 0.35)
    };

    this.courseGroup = new THREE.Group();
    this.courseGroup.name = 'race-course';
    this.courseGroup.visible = false;
    for (let i = 0; i < GATE_COUNT; i++) {
      const mesh = new THREE.Mesh(this._torusGeometry, this._materials.upcoming);
      mesh.name = `race-gate-${i}`;
      this.courseGroup.add(mesh);
      this._gateMeshes.push(mesh);
    }
    this._beaconMesh = new THREE.Mesh(this._beaconGeometry, this._materials.beacon);
    this._beaconMesh.name = 'race-beacon';
    this._beaconMesh.visible = false;
    this.courseGroup.add(this._beaconMesh);
    this.engine.scene.add(this.courseGroup);
  }

  /** Position/orient the pooled tori along the freshly built course. */
  _layoutCourseMeshes(player) {
    for (let i = 0; i < this.gates.length; i++) {
      const gate = this.gates[i];
      const mesh = this._gateMeshes[i];
      mesh.position.copy(gate.position);
      // Torus lies in its local XY plane with the hole axis along +Z, and
      // lookAt() aims +Z — so aim along the incoming course direction
      // (previous gate → this gate; for gate 0, player start → gate 0).
      const prev = i === 0 ? player.position : this.gates[i - 1].position;
      this._tmpA.subVectors(gate.position, prev).normalize();
      this._tmpB.copy(gate.position).add(this._tmpA);
      mesh.lookAt(this._tmpB);
      mesh.scale.setScalar(1);
      mesh.visible = true;
    }
    this.courseGroup.visible = true;
  }

  /**
   * Re-skin gates to match race progress: passed = dim, next = bright with
   * the beacon pillar ("follow the light"), everything else = upcoming cyan.
   * In the idle preview gate 0 stays lit as the start ring; when finished,
   * every gate is dim and the beacon is off.
   */
  _refreshGateVisuals() {
    if (this.gates.length === 0) return;
    const nextIdx = this.state === 'running'
      ? this.currentGateIndex
      : (this.state === 'idle' ? 0 : -1);

    this._nextGateMesh = null;
    for (let i = 0; i < this.gates.length; i++) {
      const mesh = this._gateMeshes[i];
      if (i === nextIdx) {
        mesh.material = this._materials.next;
        this._nextGateMesh = mesh;
      } else {
        mesh.material = this.gates[i].passed ? this._materials.passed : this._materials.upcoming;
        mesh.scale.setScalar(1); // undo any leftover pulse
      }
    }

    if (this._nextGateMesh) {
      this._beaconMesh.position.copy(this.gates[nextIdx].position);
      this._beaconMesh.visible = true;
    } else {
      this._beaconMesh.visible = false;
    }
  }

  /**
   * Cheap salience animation on the next gate. A torus is rotationally
   * symmetric about its hole axis, so spinning it is invisible — a gentle
   * scale/opacity breathing pulse reads far better for the same cost.
   */
  _animateNextGate(elapsed) {
    const pulse = 1 + 0.06 * Math.sin(elapsed * 2.2);
    this._nextGateMesh.scale.setScalar(pulse);
    this._materials.next.opacity = 0.6 + 0.15 * Math.sin(elapsed * 3.1);
  }

  // =========================================================================
  // Pass detection & race progression
  // =========================================================================

  /**
   * Swept test against the CURRENT gate only: closest point on the segment
   * (previous frame position → current position) vs the gate sphere. At 250+
   * u/s a frame covers ~4 u while gates sit 450+ apart, so a single-gate
   * sweep cannot tunnel or skip.
   */
  _checkGatePass(player) {
    const gate = this.gates[this.currentGateIndex];
    if (!gate) return;

    const seg = this._tmpA.subVectors(player.position, this._prevPlayerPos);
    const lenSq = seg.lengthSq();
    let t = 0;
    if (lenSq > 1e-10) {
      t = this._tmpB.subVectors(gate.position, this._prevPlayerPos).dot(seg) / lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const closest = this._tmpB.copy(this._prevPlayerPos).addScaledVector(seg, t);
    const hitRadius = gate.radius + PASS_MARGIN;
    if (closest.distanceToSquared(gate.position) <= hitRadius * hitRadius) {
      this._onGatePassed(gate, player);
    }
  }

  _onGatePassed(gate, player) {
    if (gate.index === 0 && !this._clockRunning) {
      // Crossing the start ring starts the clock (the run-up was free).
      this._clockRunning = true;
      this.elapsedMs = 0;
      this._sampleAccum = 0;
      this._samples = [];
      this._pushSample(player); // t = 0 anchor sample
      this._ghostActive = !!this.ghostReplay;
      this._ghostCursor = 0;
    }

    const splitMs = Math.round(this.elapsedMs);
    this.splits.push(splitMs);
    gate.passed = true;
    this.currentGateIndex++;
    this.engine.eventBus.emit('gatePassed', { index: gate.index, splitMs });
    this._toast(`Gate ${gate.index + 1}/${this.gateCount} passed`, gate.index + 1 >= this.gateCount ? '#66ffee' : '#ffcc66', 1800);

    if (this.currentGateIndex >= this.gates.length) {
      this._finishRace(player);
    } else {
      this._refreshGateVisuals();
    }
    this._hudDirty = true;
    this._panelDirty = true;
  }

  _finishRace(player) {
    this.state = 'finished';
    this._clockRunning = false;
    this._finalTimeMs = Math.round(this.elapsedMs);
    this._pushSample(player); // final sample so the ghost reaches the last gate

    const world = this.engine.systems.get('world');
    const worldSeed = (world && world.seed !== undefined && world.seed !== null) ? world.seed : 0;
    const actionLog = this._actionLog.slice();
    const replay = {
      version: RESULT_SCHEMA_VERSION,
      schemaVersion: RESULT_SCHEMA_VERSION,
      pilot: this._resolvePilot(),
      worldSeed,
      courseSeed: this.courseSeed,
      date: new Date().toISOString(),
      finalTimeMs: this._finalTimeMs,
      splits: this.splits.slice(),
      samples: this._samples,
      actionLog,
      fairnessConfig: this._getFairnessConfig(),
      verificationStatus: actionLog.length > 0 ? 'action-log-present' : 'ghost-only',
      buildVersion: BUILD_VERSION,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
    };
    this._samples = []; // the array now belongs to the replay
    this._actionLog = [];

    // Save BEFORE emitting so listeners see the run via listReplays()/best.
    this._saveReplay(replay);
    this._latestReplay = replay;
    this._refreshGateVisuals();
    this._hudDirty = true;
    this._panelDirty = true;
    this.engine.eventBus.emit('raceFinished', { timeMs: this._finalTimeMs, replay });
    this._toast(`Finished ${this._formatTime(this._finalTimeMs, 3)} — replay saved`, '#66ffee', 5000);
    Logger.info(`RaceSystem: race finished in ${this._finalTimeMs} ms (pilot: ${replay.pilot})`);
  }

  // =========================================================================
  // Replay recording & persistence
  // =========================================================================

  _pushSample(player) {
    // Compact: [tMs, x, y, z, heading], positions to cm, heading to mrad.
    this._samples.push([
      Math.round(this.elapsedMs),
      Math.round(player.position.x * 100) / 100,
      Math.round(player.position.y * 100) / 100,
      Math.round(player.position.z * 100) / 100,
      Math.round(player.rotation.y * 1000) / 1000
    ]);
  }

  /**
   * Pilot attribution, tracked per frame while the clock runs. The field is
   * being built in parallel in PlayerInputSystem — read defensively and
   * default to {keyboard:false, virtual:false} when absent.
   */
  _trackPilot() {
    const input = this.engine.systems.get('playerInput');
    const src = input ? input.inputSourcesThisFrame : null;
    if (!src) return;
    if (src.keyboard) this._sawKeyboard = true;
    if (src.virtual) this._sawVirtual = true;
  }

  _resolvePilot() {
    if (this._sawKeyboard && this._sawVirtual) return 'mixed';
    if (this._sawKeyboard) return 'human';
    if (this._sawVirtual) return 'agent';
    // No input source observed during the timed run (coasting, or the
    // inputSourcesThisFrame field isn't wired up yet).
    return 'unknown';
  }

  _loadReplayStore() {
    try {
      const raw = window.localStorage.getItem(REPLAY_STORE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      this._warnStorageOnce(e);
      return [];
    }
  }

  /**
   * Append and cap at REPLAY_STORE_CAP: evict the oldest replay that is not
   * a per-seed best; if every stored replay is a per-seed best (20 distinct
   * seeds), evict the oldest outright.
   */
  _saveReplay(replay) {
    this.replays.push(replay);
    while (this.replays.length > REPLAY_STORE_CAP) {
      const bestBySeed = new Map();
      for (let i = 0; i < this.replays.length; i++) {
        const r = this.replays[i];
        const cur = bestBySeed.get(r.courseSeed);
        if (!cur || r.finalTimeMs < cur.finalTimeMs) bestBySeed.set(r.courseSeed, r);
      }
      let evicted = false;
      for (let i = 0; i < this.replays.length; i++) {
        if (bestBySeed.get(this.replays[i].courseSeed) !== this.replays[i]) {
          this.replays.splice(i, 1);
          evicted = true;
          break;
        }
      }
      if (!evicted) this.replays.shift();
    }
    try {
      window.localStorage.setItem(REPLAY_STORE_KEY, JSON.stringify(this.replays));
    } catch (e) {
      this._warnStorageOnce(e); // keep the in-memory copy and carry on
    }
  }

  _warnStorageOnce(error) {
    if (this._storageWarned) return;
    this._storageWarned = true;
    Logger.warn('RaceSystem: replay storage unavailable, replays kept in memory only', error);
  }

  // =========================================================================
  // Ghost playback
  // =========================================================================

  _ensureGhostMesh() {
    if (this.ghostMesh) return;
    this.ghostMesh = new THREE.Mesh(this._ghostGeometry, this._materials.ghost);
    this.ghostMesh.name = 'race-ghost';
    this.ghostMesh.visible = false;
    this.engine.scene.add(this.ghostMesh);
  }

  /**
   * Drive the ghost from the shared race clock by lerping between adjacent
   * samples (position) and shortest-arc lerping heading. The cursor only
   * moves forward because elapsedMs is monotonic within a run; it resets to
   * 0 on start()/loadGhost(). Hidden once samples are exhausted.
   */
  _updateGhost() {
    const replay = this.ghostReplay;
    if (!replay || !this._ghostActive || !this.ghostMesh) return;

    const samples = replay.samples;
    const t = this.elapsedMs;
    if (t > samples[samples.length - 1][0]) {
      this.ghostMesh.visible = false; // ghost finished its run
      return;
    }

    let i = this._ghostCursor;
    while (i < samples.length - 2 && samples[i + 1][0] <= t) i++;
    this._ghostCursor = i;

    const a = samples[i];
    const b = samples[i + 1];
    const span = b[0] - a[0];
    let alpha = span > 0 ? (t - a[0]) / span : 1;
    if (alpha < 0) alpha = 0;
    else if (alpha > 1) alpha = 1;

    this.ghostMesh.position.set(
      a[1] + (b[1] - a[1]) * alpha,
      a[2] + (b[2] - a[2]) * alpha,
      a[3] + (b[3] - a[3]) * alpha
    );
    let dh = b[4] - a[4];
    dh = Math.atan2(Math.sin(dh), Math.cos(dh)); // shortest arc, wrap-safe
    this.ghostMesh.rotation.y = a[4] + dh * alpha;
    this.ghostMesh.visible = true;
  }

  // =========================================================================
  // HUD (self-contained DOM, styled like the game's translucent chips)
  // =========================================================================

  _createHud() {
    const root = document.createElement('div');
    root.id = 'race-hud';
    Object.assign(root.style, {
      position: 'fixed',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      zIndex: '1000',
      pointerEvents: 'none',
      fontFamily: 'var(--app-font, sans-serif)'
    });

    const chip = document.createElement('div');
    Object.assign(chip.style, {
      padding: '8px 20px',
      borderRadius: '18px',
      background: 'rgba(20, 30, 60, 0.75)',
      color: '#fff',
      fontSize: '16px',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
      display: 'none'
    });

    const ghostChip = document.createElement('div');
    Object.assign(ghostChip.style, {
      padding: '4px 14px',
      borderRadius: '14px',
      background: 'rgba(20, 30, 60, 0.6)',
      color: '#aaffee',
      fontSize: '13px',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
      display: 'none'
    });

    root.appendChild(chip);
    root.appendChild(ghostChip);
    document.body.appendChild(root);
    this._hudRoot = root;
    this._raceChip = chip;
    this._ghostChip = ghostChip;
  }

  _updateHud() {
    if (!this._raceChip) return; // not initialized yet (or already destroyed)
    let raceText = null;
    if (this.state === 'running') {
      raceText = this._clockRunning
        ? `Gate ${this.currentGateIndex}/${this.gateCount} — ${this._formatTime(this.elapsedMs, 1)}`
        : 'Race ready — fly through the lit ring';
    } else if (this.state === 'finished' && this.gates.length > 0) {
      const best = this.getBestReplay(this.courseSeed);
      const bestNote = (best && best.finalTimeMs < this._finalTimeMs)
        ? `(best ${this._formatTime(best.finalTimeMs, 1)})`
        : '(new best)';
      raceText = `Finished: ${this._formatTime(this._finalTimeMs, 3)} ${bestNote}`;
    }
    // state === 'idle' → raceText stays null → chip hidden

    if (raceText !== this._lastRaceText) {
      this._lastRaceText = raceText;
      this._raceChip.style.display = raceText === null ? 'none' : 'block';
      if (raceText !== null) this._raceChip.textContent = raceText;
    }

    let ghostText = null;
    if (this.ghostReplay && this.state !== 'idle') {
      ghostText = `vs ghost: ${this.ghostReplay.pilot} ${this._formatTime(this.ghostReplay.finalTimeMs, 1)}`;
    }
    if (ghostText !== this._lastGhostText) {
      this._lastGhostText = ghostText;
      this._ghostChip.style.display = ghostText === null ? 'none' : 'block';
      if (ghostText !== null) this._ghostChip.textContent = ghostText;
    }
  }

  _createPanel() {
      if (this._panelRoot || !this._isGamePlaying()) return;
      ensureVibeTheme();
      const uiRoot = document.getElementById('ui-container') || document.body;

      const root = document.createElement('div');
      root.id = 'race-panel';
      root.style.display = 'block';
      root.style.pointerEvents = 'auto';

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'baseline';
    head.style.gap = '10px';
    head.style.marginBottom = '10px';
    const title = document.createElement('div');
    title.className = 'vc-label';
    title.textContent = 'Race';
    const sub = document.createElement('div');
    sub.className = 'vc-num';
    sub.textContent = 'R starts a run';
    sub.style.fontSize = '11px';
    sub.style.color = 'var(--vc-ink-dim)';
    head.appendChild(title);
    head.appendChild(sub);
    root.appendChild(head);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'minmax(68px, 0.8fr) minmax(0, 1.2fr)';
    grid.style.gap = '4px 8px';
    grid.style.fontSize = '12px';
    grid.style.fontVariantNumeric = 'tabular-nums';
    grid.style.marginBottom = '10px';
    const fields = [
      ['seed', 'Seed'],
      ['gate', 'Gate'],
      ['elapsed', 'Elapsed'],
      ['best', 'Best'],
      ['pilot', 'Pilot'],
      ['ghost', 'Ghost'],
    ];
    for (const [key, labelText] of fields) {
      const label = document.createElement('div');
      label.className = 'vc-label';
      label.style.fontSize = '10px';
      label.textContent = labelText;
      const value = document.createElement('div');
      value.className = 'vc-num';
      value.textContent = '--';
      value.style.textAlign = 'right';
      value.style.minWidth = '0';
      value.style.overflow = 'hidden';
      value.style.textOverflow = 'ellipsis';
      value.style.whiteSpace = 'nowrap';
      grid.appendChild(label);
      grid.appendChild(value);
      this._panelFields[key] = value;
    }
    root.appendChild(grid);

    const actions = document.createElement('div');
    actions.style.display = 'grid';
    actions.style.gridTemplateColumns = '1fr 1fr';
    actions.style.gap = '6px';
    const addButton = (key, text, handler, primary = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = primary ? 'vc-btn-primary' : 'vc-btn-ghost';
      button.textContent = text;
      button.style.minHeight = '30px';
      button.style.padding = primary ? '6px 8px' : '6px 8px';
      button.style.fontSize = '12px';
      button.style.borderRadius = '999px';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler();
      });
      actions.appendChild(button);
      this._panelButtons[key] = button;
    };
    addButton('start', 'Start Race', () => this.start(), true);
    addButton('restart', 'Same Seed', () => this.restartSameSeed());
    addButton('abort', 'Stop Race', () => {
      this.abort();
      this._toast('Race stopped');
    });
    addButton('loadGhost', 'Load Ghost', () => this.loadBestGhost());
    addButton('clearGhost', 'Clear Ghost', () => {
      this.clearGhost();
      this._toast('Ghost cleared');
    });
    addButton('runBot', 'Run SimpleBot', () => this.runSimpleBot());
    addButton('stopBot', 'Stop Bot', () => this.stopSimpleBot());
    addButton('export', 'Export JSON', () => {
      const result = this.exportResult(null, { download: true });
      this._toast(result ? 'Benchmark JSON exported' : 'Finish a race before export', result ? '#66ffee' : '#ffcc66');
    });
    root.appendChild(actions);

    const ui = this.engine.systems.get('ui');
    if (!ui || typeof ui.registerSettingsPane !== 'function' || !ui.registerSettingsPane('race', root)) {
      uiRoot.appendChild(root);
    }
    this._panelToggle = null;
    this._panelRoot = root;
    this._updatePanel();
  }

  _updatePanel() {
    if (!this._panelRoot && this._isGamePlaying()) this._createPanel();
    if (!this._panelRoot) return;
    const playing = this._isGamePlaying();
    if (!playing) {
      this._panelRoot.style.display = 'none';
      return;
    }
    this._panelRoot.style.display = 'block';

    const best = this.courseSeed ? this.getBestReplay(this.courseSeed) : this.getPanelBestReplay();
    const latest = this.getLatestReplay();
    const ghost = this.ghostReplay;
    const gateValue = this.gateCount
      ? `${Math.min(this.currentGateIndex + 1, this.gateCount)} / ${this.gateCount}`
      : '--';
    const elapsed = this.state === 'finished'
      ? this._finalTimeMs
      : (this.state === 'running' ? this.elapsedMs : null);
    const values = {
      seed: this.courseSeed ? String(this.courseSeed) : '--',
      gate: gateValue,
      elapsed: elapsed === null ? '--' : this._formatTime(elapsed, 1),
      best: best ? `${this._formatTime(best.finalTimeMs, 1)} ${best.pilot || 'unknown'}` : '--',
      pilot: this._currentPilotLabel(),
      ghost: ghost ? `${ghost.pilot || 'unknown'} ${this._formatTime(ghost.finalTimeMs, 1)}` : 'none',
    };

    for (const key of Object.keys(values)) {
      if (this._lastPanelText[key] === values[key]) continue;
      this._lastPanelText[key] = values[key];
      if (this._panelFields[key]) this._panelFields[key].textContent = values[key];
    }

    const buttons = this._panelButtons;
    if (buttons.restart) buttons.restart.disabled = !this.courseSeed;
    if (buttons.abort) buttons.abort.disabled = this.state !== 'running';
    if (buttons.loadGhost) buttons.loadGhost.disabled = !best;
    if (buttons.clearGhost) buttons.clearGhost.disabled = !ghost;
    if (buttons.runBot) buttons.runBot.disabled = this._simpleBotRunning;
    if (buttons.stopBot) buttons.stopBot.disabled = !this._simpleBotRunning;
    if (buttons.export) buttons.export.disabled = !latest;
  }

  _currentPilotLabel() {
    if (this.state === 'finished' && this._latestReplay && this._latestReplay.courseSeed === this.courseSeed) {
      return this._latestReplay.pilot || 'unknown';
    }
    if (this._sawKeyboard && this._sawVirtual) return 'mixed';
    if (this._sawKeyboard) return 'human';
    if (this._sawVirtual || this._simpleBotRunning) return 'agent';
    return 'unknown';
  }

  _isGamePlaying() {
    try {
      return this.engine.gameStarted && useGameState.getState().currentState === GameStates.PLAYING;
    } catch (error) {
      return !!this.engine.gameStarted;
    }
  }

  _removePanelNodes() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('#race-panel, #race-panel-toggle').forEach((node) => node.remove());
    this._panelRoot = null;
    this._panelToggle = null;
    this._panelOpen = false;
  }

  _resolveReplayRef(replayRef) {
    if (replayRef === null || replayRef === undefined) return null;
    if (Number.isInteger(replayRef)) return this.replays[replayRef] || null;
    if (replayRef && typeof replayRef === 'object') {
      if (!Array.isArray(replayRef.samples) && Number.isInteger(replayRef.id)) {
        return this.replays[replayRef.id] || null;
      }
      return replayRef;
    }
    return null;
  }

  _buildExportResult(replay) {
    const actionLog = Array.isArray(replay.actionLog) ? replay.actionLog : [];
    const verificationStatus = replay.verificationStatus ||
      (actionLog.length > 0 ? 'action-log-present' : 'ghost-only');
    return {
      type: 'skybloom.benchmark-result',
      version: RESULT_SCHEMA_VERSION,
      game: 'SkyBloom',
      buildVersion: replay.buildVersion || BUILD_VERSION,
      date: replay.date,
      exportedAt: new Date().toISOString(),
      courseSeed: replay.courseSeed,
      worldSeed: replay.worldSeed,
      finalTimeMs: replay.finalTimeMs,
      splits: Array.isArray(replay.splits) ? replay.splits.slice() : [],
      pilot: replay.pilot || 'unknown',
      fairnessConfig: replay.fairnessConfig || this._getFairnessConfig(),
      verificationStatus,
      trustModel: 'client-recorded path replay; not verified by deterministic re-simulation',
      replay: {
        sampleFormat: ['tMs', 'x', 'y', 'z', 'heading'],
        pathSamples: Array.isArray(replay.samples) ? replay.samples : [],
        actionLog,
      },
      userAgent: replay.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'),
    };
  }

  _getFairnessConfig() {
    const api = typeof window !== 'undefined' ? window.agentAPI : null;
    const config = api && typeof api.getConfig === 'function'
      ? api.getConfig()
      : { actionHz: 10, observationHz: 20, observationLatencyMs: 0, perceptionRadius: { mana: 800, landmarks: 2000 } };
    return {
      profile: this._fairnessProfile(config),
      actionHz: config.actionHz,
      observationHz: config.observationHz,
      observationLatencyMs: config.observationLatencyMs,
      perceptionRadius: config.perceptionRadius ? { ...config.perceptionRadius } : undefined,
    };
  }

  _fairnessProfile(config) {
    if (config.actionHz === 10 && config.observationLatencyMs === 150) return 'strict';
    if (config.actionHz === 20 && config.observationLatencyMs === 0) return 'open';
    return 'custom';
  }

  _downloadJson(data, filename) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  _resultFilename(result) {
    const seed = result && result.courseSeed !== undefined ? result.courseSeed : 'unknown-seed';
    const time = result && Number.isFinite(result.finalTimeMs) ? result.finalTimeMs : 'unfinished';
    return `skybloom-${seed}-${time}.json`;
  }

  _toast(text, accentColor = '#66ffee', duration = 3000) {
    try {
      this.engine.systems.get('ui')?.showMessage?.(text, duration, accentColor);
    } catch (error) {
      // UI messages are best-effort.
    }
  }

  _formatTime(ms, decimals) {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    // Round to display precision FIRST so 59.96s renders as 1:00.0, not 0:60.0.
    const factor = Math.pow(10, decimals);
    const totalSec = Math.round((ms / 1000) * factor) / factor;
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec - minutes * 60;
    const secStr = seconds.toFixed(decimals);
    return `${minutes}:${seconds < 10 ? '0' + secStr : secStr}`;
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  _getLocalPlayer() {
    const playerState = this.engine.systems.get('playerState');
    return playerState ? playerState.localPlayer : null;
  }
}
