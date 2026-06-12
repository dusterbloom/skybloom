# SkyBloom ✨

A chill 3D flying-carpet game that plays entirely in your browser. Soar over an infinite procedurally generated world, chase mana through the air, discover glowing landmarks, cast wind magic, and climb above the clouds — vanilla JavaScript + Three.js, no game engine, no binaries.

## 🌟 What it feels like

You throttle up, the field of view stretches, procedural wind rises in your ears, and a gold-to-magenta ribbon twists behind your carpet as you bank between islands. Dive to trade altitude for speed, pull up and bleed it off, ride out to a beacon on the horizon at golden hour. That's the game.

## 🚀 Features

- **Infinite procedural world** — chunked simplex-noise terrain: oceans, beaches, forests, mountains, all streamed around you as you fly
- **A real flight model** — banked turns, dive-to-gain-speed energy, speed-reactive camera FOV, frame-rate-independent physics, altitude ceiling at 2,200 (the cloud band starts at 600 — go through it)
- **Day/night cycle with keyframed lighting** — golden-hour sunsets, readable moonlit nights with stars, time presets and a time-scale slider in the HUD
- **Mana & quests** — collect mana orbs spawned along your flight path; four starter quests (collect, explore, visit landmarks, cast a spell)
- **Four spells** — Wind Glide (speed boost), Aether Shield, Mana Reveal (scan), Essence Surge (collection multiplier); select with 1-4, cast with E
- **Landmark beacons** — ancient ruins, magical circles, and crystal formations, each marked by a colored light pillar visible from kilometers away
- **Procedural audio** — wind that scales with your speed, collection chimes, spell whooshes; synthesized live with WebAudio, zero audio assets
- **Mobile support** — touch joystick, auto-forward, adaptive quality scaling
- **Multiplayer scaffold** — optional socket.io server for flying with friends (single-player works fully without it)

## 🎮 Controls

| Input | Action |
|---|---|
| **W** | Throttle up |
| **S** | Gentle brake |
| **Shift** | Hard brake |
| **A / D** | Banked turn left / right |
| **Mouse** (click canvas to lock) | Steer and pitch |
| **Space** | Climb (and charge your trail) |
| **Ctrl** | Descend |
| **1–4** | Select spell |
| **E** | Cast selected spell |
| **M** | Toggle map |
| **Esc** | Release mouse |

Tip: nose down to dive — you'll exceed the normal speed cap while you fall. That speed is yours to spend on the pull-out.

## 🛠️ Run it

Requires Node 18+.

```bash
git clone <this-repo>
cd magical-carpet
yarn install        # or npm install
npm run dev         # Vite dev server → http://localhost:5173
```

Optional multiplayer server (Express + socket.io). Build first — it serves `dist/`:

```bash
npm run build
npm start           # http://localhost:4000 (game + socket server)
```

For LAN play (phones, friends on your network), copy `.env.example` to `.env` — `VITE_AUTO_IP=true` makes clients connect back to whatever host they loaded the page from.

Other scripts: `npm run preview` (preview the production build).

## 🧰 Built with

- [Three.js](https://threejs.org/) — rendering
- [simplex-noise](https://github.com/jwagner/simplex-noise) — terrain generation
- [Vite](https://vitejs.dev/) — dev server & bundling
- [zustand](https://github.com/pmndrs/zustand) — game state
- [socket.io](https://socket.io/) — optional multiplayer
- WebAudio API — procedural sound

## 🏗️ Architecture

A lightweight system architecture: every feature is a `System` registered by name with the engine and updated in a fixed order each frame (`engine.systems.get('world')` or `engine.systems.world` both resolve).

- `Engine` — game loop, renderer, quality management
- `WorldSystem` — terrain chunks, mana nodes
- `PlayerSystem` + `player/` — physics, input, camera, spells, state
- `AtmosphereSystem` + `SunSystem` — keyframed sky, sun, moon, stars, clouds, fog
- `SimpleTreeSystem` — vegetation with chunk-based lifecycle (bounded population)
- `LandmarkSystem` — procedural points of interest with beacons
- `QuestManager` — event-driven quest progression
- `CarpetTrailSystem` — single-draw-call ribbon trail
- `ProceduralAudioSystem` — WebAudio wind/chimes/whooshes
- `NetworkManager` — optional multiplayer sync
- `UISystem` — HUD, minimap, toasts

In development, the engine is exposed as `window.gameEngine` — the whole game can be driven programmatically (state reads, synthetic input), which doubles as a primitive agent API.

## 🏁 Racing & the Agent API (experimental, `AgentAPI` branch)

Press **R** in-game to start a seeded 12-gate time-trial — follow the beacon to the next ring. Times, splits, and replays are stored locally; load any replay as a translucent ghost and race it.

AI agents are first-class players. A frozen `window.agentAPI` exposes `observe()` (20 Hz information-parity snapshots: only what the human screen shows) and `act()` (10 Hz, the same control axes through the same input ramps and physics as the keyboard). Replays are provenance-tagged `human` / `agent` / `mixed`, so leaderboards can compare fairly. Full protocol, fairness model, and a reference autopilot in [docs/AGENT_API.md](docs/AGENT_API.md) — or try it from DevTools:

```js
const { SimpleBot } = await import('/src/agents/SimpleBot.js');
new SimpleBot().start();   // .stop() to take the controls back
```

## 🗺️ Roadmap

- **P2P live races** — WebRTC (no central server) kart-style circuits woven through the procedural world
- **Verified leaderboards** — deterministic re-simulation of replays so ranked human-vs-agent times are provable
- **WebSocket agent transport** — drive the carpet from any language, not just the page

## 🙌 Credits

Created with ❤️ by Dusterbloom

Thanks to the Three.js community and everyone who test-flies the carpet.

## 📄 License

MIT — see [LICENSE](LICENSE).
