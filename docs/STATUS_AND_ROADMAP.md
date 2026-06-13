# SkyBloom Release Status

This document is the current public status page for the small release. Older task logs live under `bot/` and are archival.

## What Works

- Browser-based Three.js flying game with procedural terrain, water, atmosphere, landmarks, mana, spells, and mobile controls.
- A readable first session: intro screen, free flight, in-game hints, and a compact Race Panel.
- Seeded 12-gate time trials started by **R** or the Race Panel.
- Next-gate rings and beacon, gate-pass feedback, finish message, local best times, and local replay storage.
- Ghost playback from saved local replays.
- Agent API exposed as `window.agentAPI` with observation/action/fairness controls.
- Bundled `SimpleBot` reference agent using only public API calls.
- JSON benchmark export with build version, fairness config, replay samples, optional action log, and honest verification status.
- Optional WebSocket transport for external agents.
- Optional socket.io multiplayer co-presence for casual play.
- GitHub Pages deploy workflow, CI build check, local smoke script, and one-command local launcher.

## Known Limitations

- Exports are not verified leaderboard records. Current statuses are `ghost-only` and `action-log-present`.
- Replays are path samples for ghost playback; deterministic action re-simulation is not implemented.
- Client-side fairness is cooperative. A modified browser can lie about pilot tags, config, or times.
- Replay storage is localStorage and capped.
- Multiplayer is position-sync co-presence, not authoritative gameplay. It is explicitly untrusted for benchmark claims.
- GitHub Pages is static hosting and does not run the socket.io multiplayer server.
- The release has build/smoke CI, not full unit, integration, or browser automation coverage.
- Some historical design docs and old task files remain in the repo for provenance, but are not release documentation.

## Run Locally

```bash
npm install && npm run play
```

Open the printed local URL. For hot reload development, use `npm run dev` and open `http://localhost:5173`.

## Build And Check

```bash
npm run build
npm run smoke
```

CI runs:

1. `npm install`
2. `npm run build`
3. `npm run smoke`

## Deploy

Build the static app:

```bash
npm install
npm run build
```

For GitHub Pages, set repository Pages source to GitHub Actions and use `.github/workflows/pages.yml`. It builds with `/skybloom/` as the base path and publishes `dist/`.

For other hosts, publish `dist/` to a static host. The optional `server.js` path is only for socket.io multiplayer:

```bash
npm run host
```

## Practical Next PR

Add the first deterministic verification prototype:

- Capture initial race state in exported results.
- Add fixed-timestep replay harness behind a developer command.
- Re-run action logs for one pinned browser/runtime target.
- Keep public exports marked unverified until the harness can reproduce times.
