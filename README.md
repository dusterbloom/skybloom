# Vibe Carpet ✨

A chill 3D flying-carpet game for the browser. Soar over an infinite procedurally generated world, chase mana through the air, discover glowing landmarks, cast wind magic, and climb above the clouds — all in vanilla JavaScript + Three.js, no install required.

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

```bash
git clone <this-repo>
cd magical-carpet
yarn install        # or npm install
npm run dev         # Vite dev server → http://localhost:5173
```

Optional multiplayer server (Express + socket.io):

```bash
npm start           # serves the built game + socket server
```

Other scripts: `npm run build` (production build), `npm run preview` (preview the build).

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

## 🗺️ Roadmap

- **Ghost time-trials** — race recordings of your own (or shared) runs; multiplayer with zero servers
- **P2P live races** — WebRTC (no central server) kart-style circuits woven through the procedural world
- **Agent API** — formalize the programmatic interface so AI agents are first-class players: structured observations and actions over the same channel humans use. An open world for agents.

## 🙌 Credits

Created with ❤️ by Dusterbloom

Thanks to the Three.js community and everyone who test-flies the carpet.

## 📄 License

MIT — see [LICENSE](LICENSE).
