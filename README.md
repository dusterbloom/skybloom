# SkyBloom

SkyBloom is a cozy browser flying game and a small benchmark for human-vs-agent racing. Fly a magic carpet through an infinite procedural world, press **R** to start a seeded 12-gate time trial, save local replays, race your best ghost, or let the bundled SimpleBot fly through the same public Agent API a researcher would use.

You can also just talk to it. A co-pilot listens, answers out loud, flies you to landmarks and
reshapes the world on request — against a local model server, your own API key, or fully
on-device. It runs in the page; there is no server of ours in the loop.


![SkyBloom screenshot](https://github.com/dusterbloom/skybloom/blob/main/screenshots/image.png)

## Play Fast

- **No install:** play the GitHub Pages build at `https://dusterbloom.github.io/skybloom/`.
- **From source:** `npm install && npm run play`, then open the printed local URL.
- **Download-and-go release zip:** if the zip includes `dist/`, run `node scripts/play.mjs`. No `npm install` is needed for that path.
- **Host a small multiplayer session:** `npm install && npm run host`, then share `http://YOUR_IP:4000` with players on the same LAN or tunnel.

## Research Mode

The research loop is visible in-game through the Race Panel:

- **Start Race** creates a seeded 12-gate course.
- **Load Ghost** loads the best local replay for that seed.
- **Export JSON** downloads an honest benchmark result with `courseSeed`, `worldSeed`, `finalTimeMs`, `splits`, `pilot`, fairness config, replay samples, optional action log, build version, and `verificationStatus`.

The bundled SimpleBot reference agent flies through the same public `window.agentAPI` a researcher would use — no panel button, drive it from DevTools:

```js
const { SimpleBot } = await import('/src/agents/SimpleBot.js');
const bot = new SimpleBot(window.agentAPI, { once: true });
bot.start();
```

More detail: [docs/BENCHMARK.md](docs/BENCHMARK.md), [docs/AGENT_QUICKSTART.md](docs/AGENT_QUICKSTART.md), and [docs/AGENT_API.md](docs/AGENT_API.md).

## Talk to the Carpet

Open the menu and press **Talk**. A chat panel appears — type at it or speak to it, both go to
the same conversation. It answers out loud and acts: *take me to the crystal formation*,
*raise a mountain ahead*, *make it sunset*, *let me fly the fox*, *make the music epic*.

Pick a brain in the Agent tab:

| Brain | Cost | Notes |
|---|---|---|
| Local server | Free | Any OpenAI-compatible endpoint. LM Studio, Jan, Ollama, llama.cpp and vLLM are detected on their default ports and offered before you are asked for a key. |
| Cloud API | Paid | Your own Anthropic key. Kept in this browser, sent only to Anthropic. |
| On-device | Free | WebLLM on WebGPU. No key, and offline once the weights are cached. |

A meter in the panel counts calls, tokens and cost, so the model routing is checkable rather
than claimed.

Speech uses the browser's own engines, so nothing downloads by default and the reply starts
immediately — on macOS that is the same speech stack Siri uses. Kokoro and Supertonic-3 are
opt-in neural voices that fetch weights on first use.

Set **Listen** to hands-free and the mic stays open across turns, ending each one when you
sound finished rather than on a fixed timer, so it stops cutting you off mid-sentence. Press
**V** to talk, or to interrupt the co-pilot while it is speaking.

Typing works in every browser. Speech needs the Web Speech API — Chrome or Safari; Firefox has
no speech recognition, and there the chat panel is the whole feature.

## Play

1. Open the deployed site or run locally.
2. Press **Play** for free flight, or **R** once flying to start a seeded 12-gate race.
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
| **V** | Talk to the co-pilot, or interrupt it mid-sentence |

Tip: diving trades altitude for speed. The first race is meant to be readable: follow the gold gate and beacon, use the Race Panel for status, and load a ghost after a clean finish.

## What Works

- Infinite procedural terrain, water, day/night atmosphere, landmarks, mana, spells, and mobile touch controls.
- Seeded 12-gate time trials with local splits, best times, replay storage, and ghost playback.
- Agent API with information/action/tempo fairness constraints: `observe()`, `act()`, `startRace()`, replay/ghost helpers, config, WebSocket transport, and result export.
- Reference SimpleBot that uses only `window.agentAPI`.
- Voice co-pilot: speech or typing into one conversation, a spoken reply, and an intent it acts
  on. Runs entirely in the page against a local, cloud or on-device model, with per-task model
  routing and a token/cost meter.
- **Creative "genie" API** (`window.worldAPI`) — a separate, non-fairness godmode surface: conjure shapes and animated rigs, import real models from curated repos (flapping birds, propeller planes), fly any of them or **roam as an animal on the ground**, persist everything in a catalogue, and reshape terrain/sky. Speakable by voice or a small LLM. See [docs/AGENT_API.md](docs/AGENT_API.md#creative-mode-the-genie-windowworldapi).
- Optional socket.io multiplayer co-presence for casual local experimentation.
- GitHub Pages workflow, CI build check, local smoke script, and one-command local launcher.

## Known Limitations

- Benchmark results are client-recorded and cooperative. `verificationStatus` is currently `ghost-only` or `action-log-present`; `verified` is not used because deterministic re-simulation does not exist yet.
- Replays are path ghosts, not authoritative physics replays.
- LocalStorage is the replay store, capped to a small number of recent/best runs.
- Multiplayer is optional co-presence, not authoritative gameplay. It is untrusted for benchmark claims.
- GitHub Pages is static hosting. It runs the game, races, ghosts, SimpleBot, and browser Agent API, but it does not host the socket.io multiplayer server.
- External local agents from a Pages tab may need `wss://`; for `ws://localhost` research, use a local dev/preview page.
- Mobile should load and fly, but the research panel is intentionally compact rather than a full mobile leaderboard UI.
- Speech recognition is the browser's, not ours. Chrome sends microphone audio to Google's
  servers, Safari on macOS uses on-device dictation, and Firefox has none. Only the on-device
  brain paired with the OS voice keeps a whole turn local.
- A cloud API key typed into the settings lives in this browser's localStorage and goes straight
  from the page to Anthropic. Fine for your own key; never use a shared one.
- The co-pilot's world edits go through `window.worldAPI`, which is deliberately outside the
  fairness constraints. Reshaping terrain mid-race does not produce a comparable benchmark run.

## Run Locally

Requires Node 18+.

Friendly one-line source run:

```bash
git clone https://github.com/dusterbloom/skybloom.git
cd skybloom
npm install && npm run play
```

`npm run play` builds the game and serves `dist/` at the printed local URL.

Developer server with hot reload:

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Useful scripts:

```bash
npm run play
npm run play:dist
npm run build
npm run build:pages
npm run preview
npm run smoke
```

## Play Together

For casual live co-presence, run the bundled socket.io server:

```bash
npm install && npm run host
```

Players open the host URL, usually `http://YOUR_IP:4000`. Remote carpets are position-synced at a capped rate. This is good enough to fly around together, but races are still best treated as async benchmark runs: use the same seed, export JSON, and load each other's ghosts.

For LAN play from source, copy `.env.example` to `.env`; `VITE_AUTO_IP=true` makes clients connect back to the host that served the page.

## Deploy

### GitHub Pages

This repo includes `.github/workflows/pages.yml`. To publish:

1. Merge the release branch to `main`.
2. Push to `main` or run **Deploy GitHub Pages** from the Actions tab.

The workflow enables Pages on first run, builds with `/skybloom/` as the Vite base path, and publishes `dist/` to Pages.

### Other Static Hosts

Any static host that can serve the Vite `dist/` output works:

```bash
npm install
npm run build
```

Publish `dist/`. The optional `server.js` is only needed for socket.io multiplayer.

## Current Docs

- [docs/BENCHMARK.md](docs/BENCHMARK.md): benchmark task and result format.
- [docs/AGENT_QUICKSTART.md](docs/AGENT_QUICKSTART.md): SimpleBot, WebSocket agent, and export examples.
- [docs/AGENT_API.md](docs/AGENT_API.md): full API contract.
- [docs/VERIFIED_LEADERBOARD_ROADMAP.md](docs/VERIFIED_LEADERBOARD_ROADMAP.md): what real verification requires.
- [docs/STATUS_AND_ROADMAP.md](docs/STATUS_AND_ROADMAP.md): release status and practical next steps.

Older branch notes and task logs are archived under `bot/` and are not release documentation.

## License

MIT, see [LICENSE](LICENSE).
