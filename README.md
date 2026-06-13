# SkyBloom

SkyBloom is a cozy browser flying game and a small benchmark for human-vs-agent racing. Fly a magic carpet through an infinite procedural world, press **R** to start a seeded 12-gate time trial, save local replays, race your best ghost, or let the bundled SimpleBot fly through the same public Agent API a researcher would use.

![SkyBloom screenshot](https://github.com/dusterbloom/skybloom/blob/main/screenshots/image.png)

## Research Mode

The research loop is visible in-game through the Race Panel:

- **Start Race** creates a seeded 12-gate course.
- **Load Ghost** loads the best local replay for that seed.
- **Run SimpleBot** starts the reference agent through `window.agentAPI`.
- **Export JSON** downloads an honest benchmark result with `courseSeed`, `worldSeed`, `finalTimeMs`, `splits`, `pilot`, fairness config, replay samples, optional action log, build version, and `verificationStatus`.

Quick SimpleBot run from DevTools:

```js
const { SimpleBot } = await import('/src/agents/SimpleBot.js');
const bot = new SimpleBot(window.agentAPI, { once: true });
bot.start();
```

More detail: [docs/BENCHMARK.md](docs/BENCHMARK.md), [docs/AGENT_QUICKSTART.md](docs/AGENT_QUICKSTART.md), and [docs/AGENT_API.md](docs/AGENT_API.md).

## Play

1. Open the deployed site or run locally.
2. Press **Play** for free flight, **Race 12 gates** to start a race after loading, or **Run SimpleBot** to watch the reference agent.
3. Fly through the lit ring to start the race clock.
4. Follow the next-gate beacon until all 12 gates are passed.
5. Finish to save a local replay, then load the ghost and race it.

Controls:

| Input | Action |
|---|---|
| **W** | Throttle up |
| **S** | Gentle brake |
| **Shift** | Hard brake |
| **A / D** | Banked turn left / right |
| **Mouse** | Steer and pitch after pointer lock |
| **Space / Ctrl** | Climb / dive |
| **1-4 / E** | Select / cast spell |
| **M** | Toggle map |
| **R** | Start a race when not already racing |

Tip: diving trades altitude for speed. The first race is meant to be readable: follow the gold gate and beacon, use the Race Panel for status, and load a ghost after a clean finish.

## What Works

- Infinite procedural terrain, water, day/night atmosphere, landmarks, mana, spells, and mobile touch controls.
- Seeded 12-gate time trials with local splits, best times, replay storage, and ghost playback.
- Agent API with information/action/tempo fairness constraints: `observe()`, `act()`, `startRace()`, replay/ghost helpers, config, WebSocket transport, and result export.
- Reference SimpleBot that uses only `window.agentAPI`.
- Optional socket.io multiplayer scaffold for casual local experimentation.
- CI build check and local smoke script.

## Known Limitations

- Benchmark results are client-recorded and cooperative. `verificationStatus` is currently `ghost-only` or `action-log-present`; `verified` is not used because deterministic re-simulation does not exist yet.
- Replays are path ghosts, not authoritative physics replays.
- LocalStorage is the replay store, capped to a small number of recent/best runs.
- Multiplayer is optional and untrusted for benchmark claims.
- Mobile should load and fly, but the research panel is intentionally compact rather than a full mobile leaderboard UI.

## Run Locally

Requires Node 18+.

```bash
git clone https://github.com/dusterbloom/skybloom.git
cd skybloom
npm install
npm run dev
```

Open `http://localhost:5173`.

Useful scripts:

```bash
npm run build
npm run preview
npm run smoke
```

Optional multiplayer server:

```bash
npm run build
npm start
```

For LAN play, copy `.env.example` to `.env`; `VITE_AUTO_IP=true` makes clients connect back to the host that served the page.

## Deploy

Any static host that can serve the Vite `dist/` output works:

```bash
npm install
npm run build
```

Publish `dist/`. For GitHub Pages, use a Pages workflow or upload `dist/` as the site artifact. The optional `server.js` is only needed for socket.io multiplayer.

## Current Docs

- [docs/BENCHMARK.md](docs/BENCHMARK.md): benchmark task and result format.
- [docs/AGENT_QUICKSTART.md](docs/AGENT_QUICKSTART.md): SimpleBot, WebSocket agent, and export examples.
- [docs/AGENT_API.md](docs/AGENT_API.md): full API contract.
- [docs/VERIFIED_LEADERBOARD_ROADMAP.md](docs/VERIFIED_LEADERBOARD_ROADMAP.md): what real verification requires.
- [docs/STATUS_AND_ROADMAP.md](docs/STATUS_AND_ROADMAP.md): release status and practical next steps.

Older branch notes and task logs are archived under `bot/` and are not release documentation.

## License

MIT, see [LICENSE](LICENSE).
