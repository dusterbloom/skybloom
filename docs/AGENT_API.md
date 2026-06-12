# Magical Carpet Agent API

Protocol reference for `window.agentAPI` — the interface that lets a program fly the
carpet. Everything an agent can know or do goes through this one object; no knowledge
of the game's source is required. Reference bot: [`src/agents/SimpleBot.js`](../src/agents/SimpleBot.js).

## Why

Magical Carpet treats agents as first-class players, not as scripted NPCs or debug
tools. The design goal is a game where a human and a bot line up on the same seeded
gate course, fly the same carpet under the same rules, and post times that are
honestly comparable. Fair competition is the starting constraint, not a feature
bolted on later — which is why the API is organized around four parities:

- **Information parity.** `observe()` returns approximately what the human screen
  shows and nothing more: only the next 3 gates (the HUD shows the same), only mana
  nodes and landmarks inside the visibility fog radius, and 5 coarse terrain probes
  along your current heading. There is no full course dump, no world map, no
  positions of things a human couldn't see.
- **Action parity.** `act()` writes the same virtual control axes that keyboard and
  touch input write: throttle, brake, turn, climb, spell selection, cast. Those axes
  feed the same input ramps and the same physics integration as human input. An
  agent cannot teleport, set its velocity, or skip the carpet's inertia.
- **Tempo parity.** Agent actions latch at a fixed action tick (10 Hz by default)
  and observations refresh at 20 Hz, optionally delayed by a configurable latency.
  Humans get smooth 60 fps visuals but human reaction times; the latency knob lets
  an agent run under comparable reaction constraints.
- **Embodiment parity.** Agents fly the same carpet with the same caps — `maxSpeed`,
  `turnRate`, `ceiling` — and the same spell costs and cooldowns. There is no
  agent-only vehicle and no hidden stat differences.

## Fairness profiles

Two recommended configurations, set via `setConfig`:

| Profile    | `actionHz` | `observationLatencyMs` | Intended use |
|------------|-----------:|-----------------------:|--------------|
| **strict** | 10         | 150                    | Human-comparable runs. Models human reaction delay; use this when posting times you want taken seriously. |
| **open**   | 20         | 0                      | Research and maximum machine performance. Times are interesting but not human-comparable. |

```js
agentAPI.setConfig({ actionHz: 10, observationLatencyMs: 150 }); // strict
agentAPI.setConfig({ actionHz: 20, observationLatencyMs: 0 });   // open
agentAPI.getConfig();                                            // read back current values
```

`actionHz` accepts 1–20 and `observationLatencyMs` accepts 0–1000; values outside
those ranges are clamped.

Every replay records who was flying: `pilot: "human" | "agent" | "mixed"`
(`mixed` means control changed hands during the run). So leaderboard entries are
honest about their origin even when humans and agents share a session.

**Trust model:** all of this is enforced client-side and cooperatively. A modified
client can lie about its config or its pilot tag. That is fine for local play,
self-experiments, and honest comparisons between friends. Ranked competition
requires replay re-simulation on a trusted machine — see
[Limits and roadmap](#limits-and-roadmap).

## Quickstart

With the game running, paste into the DevTools console:

```js
const { SimpleBot } = await import('/src/agents/SimpleBot.js');
const bot = new SimpleBot();   // wraps window.agentAPI
bot.start();                   // starts a seeded race and flies it
// ...watch it fly...
bot.stop();                    // control snaps back to you, mid-air
```

### API surface at a glance

| Method | Purpose |
|--------|---------|
| `observe()` | Latest observation snapshot (see [Observation reference](#observation-reference)) |
| `act(action)` | Latch control inputs for the next action tick (see [Action reference](#action-reference)) |
| `release()` | Drop virtual control back to the human instantly |
| `startRace(courseSeed?)` | Load and start a race; omit the seed for a random course |
| `abortRace()` | Abandon the current run |
| `listReplays()` | All stored replays |
| `getBestReplay(seed)` | Fastest stored replay for a course seed |
| `loadGhost(replay)` / `clearGhost()` | Show / hide a translucent ghost flying a replay |
| `getConfig()` / `setConfig({...})` | Read / set `actionHz` and `observationLatencyMs` |

`window.agentAPI` is frozen (`Object.freeze`) — you cannot monkey-patch it, and you
should not need to.

## Observation reference

`observe()` can be called at any time and returns the most recent snapshot. The
snapshot refreshes at `observationHz` (20 Hz) and, if `observationLatencyMs` is set,
describes the world as it was that many milliseconds ago. Polling faster than 20 Hz
returns repeats; it does not reveal anything new.

A representative snapshot (values illustrative):

```js
{
  version: "1.0.0",         // API contract version — check it, log it with results
  t: 412.85,                // game-clock time of this snapshot, seconds
  tick: 8257,               // monotonic observation counter
  self: {
    pos: [120.4, 86.2, -310.7],
    vel: [38.1, 1.2, -11.5],
    speed: 39.8, heading: 1.32, pitch: -0.05, bank: 0.21,
    throttle: 1.0, altitude: 86.2, altitudeAboveTerrain: 41.7,
    mana: 35, totalMana: 410, currentSpell: 0, effects: []
  },
  limits: {
    maxSpeed: 60, boostedMaxSpeed: 84, ceiling: 500,
    turnRate: 1.6, actionHz: 10, observationHz: 20
  },
  terrain: {
    below: 44.5,
    ahead: [
      { dist: 100, height: 42.1 }, { dist: 300, height: 55.0 },
      { dist: 500, height: 71.3 }, { dist: 700, height: 64.9 },
      { dist: 900, height: 48.2 }
    ]
  },
  race: {
    state: "racing", courseSeed: 1337, gateIndex: 4, gateCount: 12,
    elapsedMs: 31250, splits: [6210, 13480, 21900, 29800],
    nextGates: [
      { pos: [260.0, 92.0, -355.0], dist: 142.5, bearing: -0.18, elevation: 5.8, radius: 18 },
      { pos: [410.0, 70.0, -300.0], dist: 295.4, bearing:  0.31, elevation: -16.2, radius: 18 },
      { pos: [520.0, 65.0, -180.0], dist: 421.0, bearing:  0.64, elevation: -21.2, radius: 18 }
    ]
  },
  nearby: {
    manaNodes: [ { pos: [180.0, 80.0, -290.0], dist: 63.0, bearing: 0.45 } ],
    landmarks: [ { type: "ruins", pos: [340.0, 60.0, -510.0], dist: 297.0, bearing: -0.72 } ]
  }
}
```

### Conventions

- **World units** for all positions, distances, heights, radii. The y axis is up.
- **Radians** for all angles; **units/second** for all speeds.
- **`bearing`** is the signed angle from your current heading to the target
  direction, normalized to [-π, π]. **Negative = target is to your LEFT.** A bot
  can steer with `turn = k * bearing` and never think about absolute heading:

```text
                      0  (dead ahead)
                      |
        -pi/2 ------ you ------ +pi/2
     (hard left)      |      (hard right)
                      |
                  -pi / +pi  (directly behind)

   bearing < 0  →  target left   →  steer with turn < 0
   bearing > 0  →  target right  →  steer with turn > 0
```

### Top level

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Contract version of the observation/action schema |
| `t` | number | Game-clock timestamp of this snapshot, seconds |
| `tick` | int | Monotonic observation counter (increments at `observationHz`) |

### `self` — your carpet

| Field | Type / units | Description |
|-------|--------------|-------------|
| `pos` | `[x, y, z]`, world units | Carpet position; `pos[1]` is height (y-up) |
| `vel` | `[x, y, z]`, units/s | Velocity vector |
| `speed` | units/s | Magnitude of `vel` |
| `heading` | radians | Absolute yaw in the world frame. Prefer the relative `bearing` fields — they are self-contained |
| `pitch` | radians | Nose attitude; **positive = nose down (diving)**, negative = nose up — this engine's Euler convention is inverted from aviation |
| `bank` | radians | Roll; positive = banked right |
| `throttle` | 0..1 | Throttle currently applied (yours or the human's) |
| `altitude` | world units | World-frame height; equals `pos[1]` |
| `altitudeAboveTerrain` | world units | `altitude - terrain.below`; your real safety margin |
| `mana` | number | Spendable mana (spells draw from this) |
| `totalMana` | number | Lifetime mana collected (score, not spendable) |
| `currentSpell` | int 0–3 | Selected spell slot |
| `effects` | string[] | Active status effects, e.g. `["boost"]`; empty when none |

### `limits` — the physics caps (identical for humans and agents)

| Field | Type / units | Description |
|-------|--------------|-------------|
| `maxSpeed` | units/s | Level-flight speed cap |
| `boostedMaxSpeed` | units/s | Absolute cap with boost effects or a full dive (≈ 1.4 × `maxSpeed`) |
| `ceiling` | world units | Maximum altitude; climb input is ineffective above it |
| `turnRate` | radians/s | Maximum yaw rate at full `turn` input |
| `actionHz` | Hz | Current action latch rate (see [Fairness profiles](#fairness-profiles)) |
| `observationHz` | Hz | Observation refresh rate |

### `terrain` — ground probes

| Field | Type / units | Description |
|-------|--------------|-------------|
| `below` | world units | Terrain surface height directly under the carpet |
| `ahead` | array of 5 `{ dist, height }` | Probes at `dist` 100, 300, 500, 700, 900 along your current heading; `height` is the terrain surface height there, in the same frame as `self.altitude` — so `height > altitude` means that ground is above you |

### `race` — `null` when no course is loaded

| Field | Type / units | Description |
|-------|--------------|-------------|
| `state` | string | Race lifecycle. `"idle"` = loaded but not started; `"finished"` = run complete. Treat any other value (run-up, racing, ...) as in-progress — new intermediate states may appear |
| `courseSeed` | number | Seed that generated this course; same seed = same gates, for everyone |
| `gateIndex` | int | Index of the next gate to fly (0-based) |
| `gateCount` | int | Total gates in the course |
| `elapsedMs` | ms | Time since crossing the start ring; frozen at the finish |
| `splits` | ms[] | `elapsedMs` recorded at each gate already crossed |
| `nextGates` | array ≤ 3 | The upcoming gates, nearest first — never more than 3 (information parity with the HUD) |

### `race.nextGates[i]`

| Field | Type / units | Description |
|-------|--------------|-------------|
| `pos` | `[x, y, z]`, world units | Gate center |
| `dist` | world units | Straight-line distance from you to the gate center |
| `bearing` | radians [-π, π] | Direction to the gate relative to your heading; negative = left |
| `elevation` | world units | Vertical offset, gate center minus your altitude; positive = gate is above you |
| `radius` | world units | Pass within this distance of the center to clear the gate |

### `nearby` — fog-radius entities only

| Field | Type | Description |
|-------|------|-------------|
| `manaNodes` | array of `{ pos, dist, bearing }` | Collectible mana within visibility range |
| `landmarks` | array of `{ type, pos, dist, bearing }` | Points of interest within visibility range; `type` is a string such as `"ruins"` |

## Action reference

```js
agentAPI.act({
  throttle: 1,      // 0..1
  brake: 0,         // 0..1
  turn: -0.4,       // -1..1, positive = right
  climb: 0.25,      // -1..1, positive = up
  selectSpell: 2,   // 0..3, optional
  cast: false       // boolean, optional
});
```

| Field | Range | Description |
|-------|-------|-------------|
| `throttle` | 0..1 | Forward acceleration request, through the same ramp as the human throttle key |
| `brake` | 0..1 | Deceleration request; may be combined with throttle (e.g. dragging the speed down into a corner) |
| `turn` | -1..1 | Yaw input; **positive = turn right**, scaled by `limits.turnRate` |
| `climb` | -1..1 | Vertical input; **positive = up** |
| `selectSpell` | 0..3 (int) | Switch the active spell slot |
| `cast` | boolean | Request a cast of the current spell this tick |

Semantics:

- **Clamping.** Out-of-range values are clamped, never rejected. `act()` does not throw
  for bad numbers.
- **The action tick.** Inputs do not apply instantly: they latch at the next action
  tick (`actionHz`, 10 Hz by default — every 100 ms). Calling `act()` faster than the
  tick rate is allowed but pointless: **last write wins** within a tick window.
- **Hold-last.** Latched axes hold between ticks and across ticks until you change
  them. If you send `{ throttle: 1 }` once and go silent, the carpet keeps flying at
  full throttle. Always send a complete action object every tick — relying on stale
  axes you set seconds ago is how bots fly into mountains.
- **Spell parity.** `cast: true` is a request, not a command. The game enforces mana
  costs and cooldowns exactly as it does for a human pilot; a cast you cannot afford
  simply does nothing. Send `cast: true` only on the tick you want to cast, then
  return to `false`.
- **Coexistence with the human.** While an agent holds virtual control, human input is
  superseded. `release()` returns control instantly; the human can also reclaim it
  from the game's side. If both happen in one run, the replay is tagged `mixed`.

## Racing

### Course seeds

Courses are generated deterministically from `courseSeed`. The same seed yields the
same gate layout for every player, human or agent. **Comparisons are only meaningful
on the same seed** — always record the seed alongside a time.

```js
agentAPI.startRace(1337);  // everyone who races seed 1337 flies this exact course
agentAPI.startRace();      // random seed; read it back from observe().race.courseSeed
agentAPI.abortRace();      // abandon the run (no replay is saved for aborted runs)
```

### Gate flow

1. **Run-up.** `startRace(seed)` loads the course. You get a free run-up to the start
   ring — position, line up, build speed. The clock is not running yet
   (`elapsedMs` is 0). `nextGates[0]` is always the next ring you must fly through,
   including the start ring during the run-up.
2. **Start ring.** Crossing it starts the timer.
3. **Splits.** Each gate crossed appends your `elapsedMs` at that moment to
   `race.splits`. Pass within `radius` of the gate's center; gates must be taken in
   order (`gateIndex` tells you which is next).
4. **Finish.** Crossing the final gate freezes `elapsedMs`, sets
   `race.state = "finished"`, and saves a replay.

### Replays

```js
const all  = agentAPI.listReplays();        // every stored replay
const best = agentAPI.getBestReplay(1337);  // fastest run on seed 1337, or null
```

A replay is a **recording** of a run (not a re-simulatable input log — see
[Limits and roadmap](#limits-and-roadmap)). Representative shape — illustrative; treat
`listReplays()` output as the source of truth for the exact encoding:

```json
{
  "version": 1,
  "courseSeed": 1337,
  "pilot": "agent",
  "timeMs": 84210,
  "splits": [6210, 13480, 21900, 29800, 38100, 47000, 55900, 63200, 70800, 77400, 81000, 84210],
  "recordedAt": "2026-06-12T09:30:00Z",
  "frames": [
    { "t": 0.0, "pos": [12.1, 86.0, -240.3], "heading": 1.57, "pitch": -0.05, "bank": 0.20 },
    { "t": 0.1, "pos": [15.9, 86.1, -239.0], "heading": 1.55, "pitch": -0.04, "bank": 0.18 }
  ]
}
```

### Ghosts

A ghost renders a translucent carpet flying a replay in real time alongside you —
the classic time-trial pace car:

```js
const best = agentAPI.getBestReplay(1337);
if (best) agentAPI.loadGhost(best);   // race your (or your bot's) best self
agentAPI.startRace(1337);
agentAPI.clearGhost();                // remove it
```

### Comparing human vs agent times

The honest protocol:

1. Pick a seed. Tell everyone the seed.
2. Human races it (no agent `act()` calls during the run → replay tagged `human`).
3. Agent races it under the **strict** profile (no human input → tagged `agent`).
4. Compare `timeMs`. Load each other's replays as ghosts for the rematch.

Runs where control changed hands are tagged `mixed` and should not be compared
against pure runs.

## postMessage bridge

For drivers that cannot call `window.agentAPI` directly — the game in an iframe, or
an external process speaking through a thin web page — the same API is exposed over
`postMessage`:

| Direction | Message | Effect / reply |
|-----------|---------|----------------|
| you → game | `{ type: "agentapi:observe" }` | Game replies `{ type: "agentapi:observation", payload: <observation> }` |
| you → game | `{ type: "agentapi:act", payload: <action> }` | Same as `act(payload)` |
| you → game | `{ type: "agentapi:start-race", seed: <number> }` | Same as `startRace(seed)` |

Fairness configuration applies unchanged; the bridge only adds its own messaging
latency on top. A minimal external driver — a page embedding the game in an iframe:

```html
<iframe id="game" src="http://localhost:5173/"></iframe>
<script>
  const game = document.getElementById('game').contentWindow;
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  window.addEventListener('message', (e) => {
    if (e.data?.type !== 'agentapi:observation') return;
    const gate = e.data.payload.race?.nextGates?.[0];
    if (!gate) return;
    game.postMessage({ type: 'agentapi:act', payload: {
      throttle: 1, brake: 0,
      turn: clamp(gate.bearing * 2.2),
      climb: clamp(gate.elevation / 40),
    } }, '*');
  });
  setTimeout(() => game.postMessage({ type: 'agentapi:start-race', seed: 42 }, '*'), 2000);
  setInterval(() => game.postMessage({ type: 'agentapi:observe' }, '*'), 100);
</script>
```

## Writing your own bot

### Anatomy of SimpleBot

[`src/agents/SimpleBot.js`](../src/agents/SimpleBot.js) is deliberately small. Three parts:

1. **A loop.** `setInterval` at 100 ms — matching the 10 Hz action tick, so every
   decision lands in its own tick window.
2. **Lifecycle.** No race → `startRace()` once. `state === "finished"` →
   `release()` (and stop, if configured to run once). Anything else → fly.
3. **A pure control law**, `steer(observation) → action`:

| Output | Law | Why |
|--------|-----|-----|
| `turn` | `clamp(bearing × 2.2, -1, 1)` | Proportional steering on the next gate |
| `climb` | `clamp(elevation / 40, -1, 1)` | Full climb/dive when 40+ units off the gate's height |
| `throttle` | `1` | Always; the carpet's cap does the moderating |
| `brake` | `0.5` if `|bearing| > 1.1` and `dist < 260`, else `0` | Wide line into hairpins instead of orbiting the gate |
| terrain override | any `ahead` probe with `dist ≤ 300` and `height > altitude − 12` → `climb = 1` | Not hitting mountains beats hitting gates |
| ceiling clamp | `altitude > ceiling − 50` → `climb = min(climb, 0)` | Climb input is wasted above the ceiling |

Pure means: observation in, action out, no hidden state. You can unit-test it with a
hand-written observation object and no game running.

### Three upgrades worth trying

1. **Look ahead to `nextGates[1]` for racing lines.** SimpleBot aims at gate centers,
   so it exits every gate pointed the wrong way for the next one. Blend the two
   bearings as you approach — e.g.
   `aim = bearing0 + w(dist0) * (bearing1 - bearing0)` with `w` rising as `dist0`
   shrinks — and you will cut inside, carrying speed through the exit.
2. **PD control on bearing.** Pure proportional steering oscillates at high speed:
   the bot crosses the line to the gate, overshoots, recrosses. Add a derivative
   term — `turn = Kp * bearing + Kd * (bearing - prevBearing) / dt` — to damp the
   weave. With damping you can raise `Kp` and corner harder. (Store `prevBearing`
   between ticks; this is the one place your bot wants memory.)
3. **Exploit dive energy on descending gates.** The carpet's speed cap is
   pitch-aware: nose-down flight stretches the effective cap by up to about 1.4 ×
   (boost and dive stacking is bounded by an absolute 420 u/s ceiling)
   `maxSpeed` (toward `limits.boostedMaxSpeed`). When `nextGates[0].elevation` is
   strongly negative, dive steeper than the direct line, bank the surplus speed,
   and shallow out through the gate. Watch `altitudeAboveTerrain` while you do it —
   the terrain override exists for a reason.

## Streaming transport (WebSocket) — bots in any language

External agents (a local SLM, a cloud-API middleman, any process) don't poll —
the game **streams** to them. Architecture: browsers can't listen on sockets, so
the GAME is the WebSocket *client* and your agent process runs a tiny WS
*server*. Connect either way:

```js
agentAPI.connectAgent('ws://localhost:8765')   // from DevTools
```
```
http://localhost:5173/?agent=ws://localhost:8765   // auto-connect at boot
```

Once connected the game pushes one message per observation tick (20 Hz, the
latency buffer **is** applied — fairness travels with the data):

```json
{ "type": "observation", "payload": { ...same schema as observe()... } }
```

Your process answers whenever it wants (messages are applied through the same
10 Hz action ticks as `act()`):

| You send | Effect |
|---|---|
| `{"type": "act", "payload": {throttle, brake, turn, climb, ...}}` | queued for the next action tick |
| `{"type": "start-race", "seed": 123}` | starts a race |
| `{"type": "release"}` | hands controls back to the human |
| `{"type": "config", "payload": {...}}` | setConfig (tighten-only) |

A `{"type": "hello"}` frame with the current config arrives on connect.
**Safety invariant:** if the socket drops, the game immediately releases the
virtual pad — a dead agent can never leave the carpet pinned. Reconnects are
attempted 3 times, then it stays with the human. `agentAPI.transportStatus()`
reports `connecting | connected | reconnecting | disconnected`.

A complete reference pilot lives at [`examples/agent_pilot.py`](../examples/agent_pilot.py)
(`pip install websockets`, run it, open the game with `?agent=...`). It also
shows the **two-tier pattern** for language-model pilots: a reflex loop answers
every observation with simple math at full rate, while the slow model (Ollama,
llama.cpp, a cloud API) runs beside it as a *planner*, re-reading the latest
observation every few seconds and adjusting the reflex layer's goals. Model
latency then costs strategy freshness — never control of the carpet.

## Limits and roadmap

Current, honestly stated:

- **No determinism guarantee.** Replays are recordings of what happened, not input
  logs that re-simulate bit-identically. Do not build verification or training
  pipelines that assume replaying inputs reproduces a run.
- **Cooperative enforcement.** Rate limits, latency, and pilot tags are applied
  client-side. A modified client can cheat. Local and friendly competition only.

Roadmap, in rough order:

- **Replay re-simulation** — deterministic input logs re-run by a verifier, making
  pilot tags and times trustworthy.
- **Server-verified leaderboards** — ranked seeds where only verified runs count.

Check `observe().version` and include it when you report results or file issues —
the contract above is versioned, and this document describes the `1.x` surface.
