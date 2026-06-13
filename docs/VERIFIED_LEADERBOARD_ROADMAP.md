# Verified Leaderboard Roadmap

SkyBloom does not currently have a verified leaderboard. Current results are client-recorded and explicitly marked `ghost-only` or `action-log-present`.

## Requirements For Real Verification

### Deterministic Re-Simulation

A verifier must be able to re-run a submitted action log and reproduce the final state and time within a tight tolerance. That requires:

- Fixed race setup from `courseSeed`, `worldSeed`, start position, and start heading.
- Deterministic course generation and terrain sampling.
- A fixed timestep or deterministic accumulator for race physics.
- Stable floating-point behavior across the trusted runner target.
- Clear handling for pause/tab suspension, dropped frames, and late actions.

### Action Log Requirements

An accepted action log should include:

- Ordered action ticks with game-time timestamps.
- Effective fairness config.
- Initial player state needed for re-simulation.
- Course seed and world seed.
- Build/engine version.
- Pilot identity claim and source type.
- Any random seeds used by gameplay systems that affect flight.

### Engine Version Pinning

Leaderboard runs must pin:

- Git commit or release tag.
- Agent API schema version.
- Physics constants and race constants.
- Asset-independent world generation code.
- Browser/runtime target for the trusted runner, or a headless deterministic runner.

### Fixed Timestep Considerations

The current game loop is playable and race time uses game delta, but verification needs a stricter model:

- Quantize agent actions to exact ticks.
- Integrate physics at a fixed timestep.
- Decide how rendering-only systems are excluded.
- Keep race pass detection deterministic under high speed.
- Record or derive enough initial state for replay.

### Trusted Runner Model

A credible leaderboard should not trust browser-local exports. A practical first version:

1. Browser exports result JSON with path samples and action log.
2. User submits JSON to a trusted runner.
3. Runner checks schema, build version, fairness config, and seed.
4. Runner re-simulates actions in a pinned environment.
5. Runner returns `verified` only if final time and splits match tolerance.

Until that exists, SkyBloom should call results "local benchmark exports" rather than verified leaderboard entries.

## First Practical Milestone

The current release records:

- Ghost path samples for playback.
- Optional Agent API action metadata.
- Fairness config.
- Build version.
- Honest `verificationStatus`.

The next PR should add initial-state capture and a fixed-timestep replay harness behind a developer-only command.
