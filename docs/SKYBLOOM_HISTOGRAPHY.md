# Skybloom Histography: A Development Archaeology

*Groundwork for a short story based on real events. Compiled from git history, task logs, screenshots, and repository artifacts.*

---

## Data Sources Examined

1. **Git history** — full commit graph across all branches (Mar 2025 → Jun 2026).
2. **Task transcripts** — 50+ markdown task files under `bot/tasks/` documenting implementation attempts, failures, and pivots.
3. **Screenshots** — 50+ in-repo screenshots under `screenshots/` plus the Windows Pictures folder (`/mnt/c/Users/PC/Pictures/` and `Screenshots/`).
4. **Retrospectives** — `bot/Retrospective-Multiple-Sun-Implementations.md` and `FIXES.md`.
5. **Design docs** — `docs/ARCHITECTURE.md`, `docs/STATUS_AND_ROADMAP.md`, `README.md`.
6. **Console logs** — browser logs under `logs/` showing runtime struggles (missing assets, GLTF parse errors, mobile detection).

*Note on chat transcripts:* The local AI-agent directories (`.claude/`, `.codex/`, `.agents/`) contain only configuration files and a pre-session patch; no raw conversation transcripts were found on disk. The `bot/tasks/` files function as the closest available development diary.

---

## The Story in One Paragraph

*SkyBloom* began in March 2025 as an unnamed "magical carpet" prototype, was forged in a two-week crucible of mobile performance panic, water-terrain disasters, and an atmosphere system with three competing suns, was nearly refactored into an ECS cathedral, went quiet for months, then bloomed again in late 2025 as a cozy living world, and finally reinvented itself in June 2026 as an open-sky benchmark for human-vs-agent racing. The game’s history is a story of repeated simplification after over-engineering, of water being removed and reborn, of a sky that refused to render correctly, and of a creator learning to let the world feel small and gentle before asking it to host machines.

---

## Phase 0: Genesis — 22 Mar 2025

**Repository birth.** Two near-simultaneous initial commits by `dusterbloom` (also committing under the local identity Peppi Littera). The project is called `magical-carpet`.

**Early screenshot evidence (`Screenshot 2025-03-22 171714.png`):**
- A flat, gray-blue world.
- A dark blue block represents the carpet.
- Water is a pale, flat plane.
- Minimal UI: a square minimap, three colored spell orbs, and a pink health/mana bar.
- 60 FPS counter in the corner.

**First day commits:**
- `Initial commit`
- `V2`, `V2.1`, `readme update`, `Merge branch 'main'`

The game exists as a bare proof-of-concept: fly a block over low-poly terrain.

---

## Phase 1: The Mobile Crusade — 23–31 Mar 2025

**Theme:** *Make it run everywhere, make it pretty, make it not crash.*

This is the most intense development period in the entire history: **104 commits in March 2025**, most concentrated in this nine-day window. dusterbloom is driving almost everything.

### 23 Mar — Optimization obsession
- `Optmization ended 60FPS everywhere`
- `Network optimization for mobile`
- `Carpet trail fix`
- `world system LOD`
- `adding screeshots of game evolution`

The developer is already documenting evolution with screenshots, suggesting the game is being shared or judged visually.

**Visual by 23 Mar (`Screenshot 2025-03-23 162654.png`):**
- Rugged, spiky mountains.
- Deep blue water with visible artifacts.
- Circular green minimap with compass directions.
- Many gray bubble-clouds in a bright blue sky.
- The carpet is now a red block.

### 24–27 Mar — Water wars
- `Water fixed again / new config to be improved`
- `Water 2.2 / almost there`
- `Water improvemnt`
- `Water shoreline fixed by 03/mini`
- `Night sky added`

Water is the first recurring nemesis. It is fixed, broken, fixed again, simplified, removed, and eventually rebuilt.

### 28 Mar — Celestial plumbing
- `Moon in the sky`
- `Stars in the sky`
- `Stars fixed`
- `Sync time of game with user time`
- `removing moon when it is not night`

The sky becomes a focus. Time is synced to real-world time, giving the world a living clock.

### 29 Mar — Terrain and biome surgery
Task files tell the story:
- **Task 001:** *Remove Water System* — the water is deemed too broken and is excised entirely.
- **Task 008:** *Improve Vegetation System* — trees exist but look unnatural; the goal is forests in mountains and sparse clusters in plains.
- Commits: `Fix Mountain Top Glitches` (multiple iterations), `Smooth Beach to Terrain Transitions`, `Remove water system and references`, `Adding Procedural Clouds Using Three.js Sprites`.

### 30–31 Mar — The sun becomes an antagonist
This is the most narratively rich struggle.

**Task 022:** *Add Sun to Sky* — ThreeJS Sky is introduced, a visible sun sphere added.
**Task 023:** *Update Sun Appearance* — a second sun implementation is created without removing the first.

Commits read like a battlefield diary:
- `Fix sun position`
- `Fix sun render order`
- `Improving sun appearance / still needs a fix to appear in the back`
- `Fix to restore sun visiblity`
- `SUN VISIBILITY FIXED / side: THREE.FrontSide + 3`
- `Moon rise and set improved`
- `Consolidate multiple sun implementations into single system following architecture`
- `FIX BROWN WATER`
- `MULTIPLAYER V1`

By 31 March the game has: day/night cycle, moon, stars, multiplayer, mobile UI, LOD, spells, and a consolidated sun system. It is still called `magical-carpet`.

**Retrospective (later):** `Retrospective-Multiple-Sun-Implementations.md` explicitly calls this out as "architecture drift" caused by task-based development without system thinking. Three sun implementations had overlapping responsibilities, causing z-fighting and inconsistent reflections.

---

## Phase 2: Refactoring Fever — Apr 2025

**Theme:** *Tear it down and rebuild it cleanly.*

- `REFACTORING PLAN`
- `Base system and Player System refactored`
- `54 part 3 - refactor Performance and Platform manager`
- `Implemented state management with zustand`
- `IMPROVED DEVICE CONTROLS // UNTESTED`
- `New Intro screen amazing`
- `MULTIPLAYER V1`

April has **54 commits**. The developer is trying to impose ECS architecture, system managers, and state management on a prototype that grew organically. New branches appear: `refactor-wip`, `slow-mode`, `feat-kimi-k2-refactoring`.

A major architectural merge happens:
- `78dc417` — *Merge slow-mode branch into main - Architectural refactoring with mobile compatibility*

The `slow-mode` branch contains the ECS work: SystemManager, base System class, renderer/quality managers, quest system, exploration spells, and decomposed PlayerSystem.

---

## Phase 3: The Quiet Season — May–Aug 2025

**Theme:** *Rest and planning.*

Almost no commits in this window (only a stray `DISABLED CLOUDs`, `2x freq`, `Bigger landmarks` in April). The project goes dormant. This is a real narrative beat: the creator stepped away after the March/April intensity.

---

## Phase 4: The Cozy World Overhaul — Sep–Nov 2025

**Theme:** *It is not an engine; it is a place.*

### September 2025
- `refactor: Implement ECS architecture with SystemManager and base System class`
- `feat: Add quest system and exploration-focused spell mechanics`
- `docs: Create comprehensive codebase backlog and planning documents`
- `refactor: Complete debug logging cleanup - remove 60+ verbose logs`

The codebase is being cleaned and organized, not exploded.

### November 2025 — The visual renaissance
This is the second major creative push.

**7 Nov:**
- `refactor: Remove SeaFloorSystem and UnderwaterEffectsSystem permanently`
- `refactor: Replace complex Water.js with simplified Magic Carpet style water`
- `refactor: Replace with ultra-simple flat water - Magic Carpet 1994 style`
- `feat: Transform world into cozy, living landscape`

**8 Nov:**
- `feat: Add 6 real tree models from Kenney Nature Kit (CC0)`
- `feat: Replace complex VegetationSystem with SimpleTreeSystem + model loading`
- `feat: Add collision detection for trees and landmarks`
- `feat: Replace simple water with Three.js Water for realistic reflections`
- `fix: Fix jagged shoreline and terrain bleeding through water`

**Visual evidence:**
- `Screenshot 2025-11-07 093509.png` — flat reflective water, sandy beaches, distant snowy mountains, red carpet leaving white trails.
- `Screenshot 2025-11-07 094947.png` — night scene with stars, glowing water reflection, time UI panel.
- `Screenshot 2025-11-07 120757.png` — bright sun rays, deep blue ocean, carpet trail.
- `Screenshot 2025-11-08 181408.png` — moody night sky with volumetric clouds and a moon.

The aesthetic shifts from "tech demo" to "cozy diorama." Claude (the AI contributor) is now actively committing, suggesting a resumed human-AI collaboration.

---

## Phase 5: The Agentic Arena — Jun 2026

**Theme:** *From game to benchmark; from toy to testbed.*

**12–14 Jun 2026** brings **32 commits** and a complete identity change.

- `feat: Agent API + fair human-vs-agent racing (seeded time-trials, ghosts)`
- `feat: Twilight Glass design system + new title screen`
- `feat: menu cinematic + teach-by-doing onboarding`
- `feat: HUD on Twilight Glass tokens + debug chrome behind vc.debug`
- `feat: WebSocket agent transport + Twilight Glass loading screen`
- `feat: Change name`
- `chore: rename project references to skybloom`
- `feat: prepare SkyBloom race and agent release loop`
- `feat: add pages deploy and friendly play setup`
- `ci: enable github pages deployment`
- `feat: add procedural Ennio Morricone-style music system`
- `fix: repair mobile touch controls, fit, and settings menu`

The game is renamed **SkyBloom**. The README now describes it as:

> *"SkyBloom is a cozy browser flying game and a small benchmark for human-vs-agent racing."*

It gains:
- A polished title screen: "SkyBloom — An open-sky game for humans and machines."
- Seeded 12-gate races.
- Local replays / ghosts.
- `window.agentAPI` for external AI agents.
- `SimpleBot` reference agent.
- WebSocket transport.
- GitHub Pages deployment.
- Procedural Ennio Morricone-style music.

**Final screenshot (`image.png`, 13 Jun 2026):**
- A calm sea at sunset.
- The title "SkyBloom" floats over the water.
- Tagline: "Fly · Collect · Race the Machines."
- Buttons: "Take Flight", "How to fly", "Race ghosts (R)", "Agent API".

The prototype has become a public stage for humans and machines to race under the same sky.

---

## Contributors & Roles

| Identity | Commits | Role in the story |
|----------|---------|-------------------|
| **dusterbloom** | ~215 | The human creator and repository owner. Git records split between `dusterbloom` (publishing, docs, GitHub Pages) and the local identity `Peppi Littera` (day-to-day coding). Drove the March mobile crusade, the April refactoring, the November cozy overhaul, and the June 2026 rename and release. |
| **Claude / Claude Code** | ~40 | The AI agent collaborator. Most active during the November 2025 visual fixes and atmosphere consolidation. Wrote and executed many of the `bot/tasks/` task files. |

*The real cast is small: one human (dusterbloom), one AI agent (Claude Code), and an infinite procedural world.*

---

## Major Recurring Struggles (Narrative Hooks)

### 1. Water — the element that would not cooperate
- Removed entirely (Task 001, 29 Mar).
- Rebuilt as modular WaterSystem (Task 014).
- Simplified to Magic Carpet 1994 style (Nov 2025).
- Replaced with Three.js Water for reflections (Nov 2025).
- shoreline z-fighting fixed repeatedly.

### 2. The Three Suns
A documented case of architectural drift. Multiple sun implementations caused z-fighting and inconsistent reflections. The final fix was not a tweak but a consolidation.

### 3. Mobile performance anxiety
Dozens of commits explicitly about FPS, LOD, mobile UI, input manager simplification, and Android water. The phrase "60FPS everywhere" appears as a declared victory.

### 4. Over-engineering vs. simplification
The April ECS refactoring tried to make the codebase cathedral-like; the November cozy overhaul returned to simpler, more direct systems (SimpleTreeSystem, flat water). The final Agent API layer added complexity, but only after the world felt stable.

### 5. The name
For more than a year the project was `magical-carpet`. The rename to `SkyBloom` in June 2026 marks the moment the creator knew what it was actually about.

---

## Visual Evolution Timeline (Screenshots)

| Date | File | What it shows |
|------|------|---------------|
| 22 Mar 2025 | `Screenshot 2025-03-22 171714.png` | Gray proto-world, flat water, blue block carpet. |
| 22 Mar 2025 | `Screenshot 2025-03-22 190049.png` | Colorful low-poly islands inside a blocky sky dome; green carpet. |
| 22 Mar 2025 | `Screenshot 2025-03-22 213446.png` | Teal carpet over dark water; circular minimap; simple clouds. |
| 23 Mar 2025 | `Screenshot 2025-03-23 162654.png` | Spiky mountains, deep water, many bubble clouds, red carpet. |
| 7 Nov 2025 | `Screenshot 2025-11-07 093509.png` | Calm reflective water, sandy beach, distant snow peaks, white carpet trails. |
| 7 Nov 2025 | `Screenshot 2025-11-07 094947.png` | Night scene with starfield, moonlit water, time-of-day UI panel. |
| 8 Nov 2025 | `Screenshot 2025-11-08 181408.png` | Volumetric night clouds, glowing moon, dark landscape. |
| 12 Jun 2026 | `Screenshot 2026-06-12 231859.png` | Sunset ocean, purple-pink sky, single bright trail — the SkyBloom aesthetic. |
| 13 Jun 2026 | `image.png` | The finished title screen: "SkyBloom — An open-sky game for humans and machines." |

---

## Quotes & Fragments from the Record

From commit messages and task files:

- *"Optmization ended 60FPS everywhere"* — 23 Mar 2025
- *"Remove water system and references"* — 29 Mar 2025
- *"SUN VISIBILITY FIXED / side: THREE.FrontSide + 3"* — 31 Mar 2025
- *"Consolidate multiple sun implementations into single system following architecture"* — 31 Mar 2025
- *"Refactoring Atmosphere systems - cloud disabled"* — 30 Mar 2025
- *"Transform world into cozy, living landscape"* — 7 Nov 2025
- *"Replace with ultra-simple flat water - Magic Carpet 1994 style"* — 7 Nov 2025
- *"feat: add procedural Ennio Morricone-style music system"* — 13 Jun 2026
- *"chore: rename project references to skybloom"* — 13 Jun 2026

From `Retrospective-Multiple-Sun-Implementations.md`:

> *"Tasks were likely assigned without awareness of other implementations… Each new task built on top of the existing problematic structure."*

From deeper task-file archaeology:

> *"The sun is incorrectly rendering with a green line connecting it to the player."*

> *"The current water color (0x001e0f) appears brown on mobile, and water also has flashing issues."*

> *"Users currently need to reset Chrome zoom to 50% to see all controls."*

> *"Temporary Fix Applied: Reverted error handling to throw errors instead of logging to identify root cause."*

From the final `README.md`:

> *"Fly a magic carpet through an infinite procedural world, press R to start a seeded 12-gate time trial, save local replays, race your best ghost, or let the bundled SimpleBot fly through the same public Agent API a researcher would use."*

---

## Open Questions for the Story

1. **Why "SkyBloom"?** The name appears in June 2026 with no documented etymology. Was it inspired by a visual moment (the blooming sunset sky), a pun on "sky blue," or a desired emotional quality?

2. **What happened during the quiet season?** May–August 2025 has almost no code activity. Was the creator burned out? Working on other projects? Waiting for inspiration?

3. **Who is dusterbloom vs. Peppi Littera?** Git shows two identities, but the task archive and top-level docs name only dusterbloom as the human creator and Claude Code as the AI agent. Peppi is likely dusterbloom’s local git identity, not a separate person. The social dynamic is therefore human + AI, not a team of humans.

4. **Where are the raw AI chat transcripts?** Only task outputs and commit messages survive. The actual human-AI dialogue that produced these systems is lost.

5. **What made November 2025 the turning point?** After months of quiet and a failed ECS overhaul, the project pivoted to "cozy." What triggered that aesthetic decision?

---

## Suggested Story Arcs

### Arc A: The Alchemist and the Three Suns
A creator keeps adding suns to fix the sky, each one casting a different shadow, until the world has too many lights. The climax is the realization that the answer is not more suns but one sun, well-placed.

### Arc B: Water, Removed and Reborn
The sea is broken, so it is deleted. The world becomes dry. Later, the sea returns — simpler, flatter, more forgiving. A story about learning that realism is not always beauty.

### Arc C: From Toy to Testbed
The carpet was once a blue block flown for joy. It ends as a benchmark where machines race humans through golden gates. A story about play becoming measurement, and whether wonder survives.

### Arc D: The Name
For a year it had no true name. Then, in June, it became SkyBloom. A story about waiting until you know what you have made before you call it anything.

---

*Document compiled: 2026-06-14. Sources: git log --all, bot/tasks/, screenshots/, README.md, docs/, FIXES.md, Retrospective-Multiple-Sun-Implementations.md, logs/.*
