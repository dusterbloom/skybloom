# SkyBloom Benchmark

SkyBloom's first benchmark is a seeded 12-gate flying-carpet time trial. It is designed for early human-vs-agent comparisons that are easy to run in a browser and honest about what is currently verified.

## Task

Start a course with a `courseSeed`, cross the first lit ring to start the clock, then pass all 12 gates as fast as possible. The course is generated near the player's current position and heading. The race clock uses game time, so tab suspension pauses the run instead of advancing wall-clock time.

## Observation Space

Agents use `window.agentAPI.observe()`. The snapshot is limited to information parity with the playable HUD and visible world:

- Own position, velocity, speed, heading, pitch, bank, throttle, mana, spell state, and active effects.
- Physics caps such as max speed, boosted speed, ceiling, turn rate, action rate, and observation rate.
- Terrain height under the carpet and five forward terrain probes.
- Race state, seed, elapsed time, splits, current gate index, and at most the next three gates.
- Nearby mana and landmarks only within configured visibility radii.

The API does not expose the full course, hidden world map, future landmarks, or direct physics state mutation.

## Action Space

Agents use `window.agentAPI.act(action)`.

```js
agentAPI.act({
  throttle: 1,    // 0..1
  brake: 0,       // 0..1
  turn: 0.25,     // -1..1, positive right
  climb: -0.2,    // -1..1, positive up
  selectSpell: 0, // optional, 0..3
  cast: false     // optional
});
```

Actions are clamped, quantized by `actionHz`, and fed through the same virtual input path as keyboard/touch controls. Agents cannot set position, velocity, gate state, or timers.

## Fairness Profiles

Recommended profiles:

| Profile | Config | Use |
|---|---|---|
| `strict` | `{ actionHz: 10, observationLatencyMs: 150 }` | Human-comparable experiments. |
| `open` | `{ actionHz: 20, observationLatencyMs: 0 }` | Research/debug speed without human-reaction modeling. |

Examples:

```js
agentAPI.setConfig({ actionHz: 10, observationLatencyMs: 150 });
agentAPI.setConfig({ actionHz: 20, observationLatencyMs: 0 });
```

Perception radii can be reduced but not raised beyond the human-visible defaults.

## Scoring

The score is `finalTimeMs`, lower is better. Compare runs only when they share:

- `courseSeed`
- `worldSeed`
- fairness profile/config
- compatible game/build version
- clear `pilot` tag: `human`, `agent`, `mixed`, or `unknown`

`mixed` means both human and agent input were seen during the timed run. Treat it as its own category.

## Replay Format

SkyBloom still stores ghost-compatible path samples:

```json
{
  "version": 2,
  "courseSeed": 1337,
  "worldSeed": 0,
  "finalTimeMs": 84210,
  "splits": [0, 6210, 13480],
  "pilot": "agent",
  "samples": [[0, 12.1, 86.0, -240.3, 1.57]],
  "actionLog": [{"tMs": 100, "source": "agentAPI", "action": {"throttle": 1}}],
  "fairnessConfig": {"profile": "strict", "actionHz": 10, "observationLatencyMs": 150},
  "verificationStatus": "action-log-present"
}
```

`samples` are `[tMs, x, y, z, heading]`. They power ghost playback. `actionLog` is Replay v2 groundwork and appears when Agent API actions were queued during the timed run.

## Result Export

Use the Race Panel's **Export JSON** button after a finish, or call:

```js
const result = agentAPI.exportResult();
console.log(JSON.stringify(result, null, 2));
```

Exported benchmark JSON includes:

- `version`
- `courseSeed`
- `worldSeed`
- `finalTimeMs`
- `splits`
- `pilot`
- `fairnessConfig`
- `date` and `exportedAt`
- `userAgent`
- `buildVersion`
- `verificationStatus`
- `replay.pathSamples`
- `replay.actionLog` when present

## Trust Model

Current results are client-recorded. They are suitable for local play, demos, research prototypes, and friendly comparisons, but a modified client can lie.

Verification statuses:

- `ghost-only`: path replay exists, but no action stream was captured.
- `action-log-present`: an action stream exists alongside the path replay, but has not been re-simulated.
- `verified`: reserved for future deterministic re-simulation. SkyBloom must not export this value until the verifier exists.

## Current Limitations

- No deterministic re-simulation yet.
- No cryptographic signing or trusted runner.
- Browser, GPU, frame pacing, and build version can affect run behavior.
- The optional multiplayer scaffold is untrusted for benchmark claims.

See [VERIFIED_LEADERBOARD_ROADMAP.md](VERIFIED_LEADERBOARD_ROADMAP.md) for the verification plan.
