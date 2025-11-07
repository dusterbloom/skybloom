# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Running the Game
```bash
npm run dev          # Start development server with Vite (port 5173)
npm run build        # Build for production
npm run preview      # Preview production build
npm start            # Start production server with Express
```

### Dependencies
- Uses Yarn as package manager (yarn@1.22.22)
- No test framework currently configured
- No linting/formatting tools configured

## Architecture Overview

### Core System Architecture
The game uses a component-based ECS (Entity-Component-System) architecture with the following key patterns:

1. **Engine** (`src/game/core/Engine.js`): Main game loop orchestrator
   - Manages SystemManager for all game systems
   - Handles rendering via RendererManager
   - Quality management via QualityManager
   - Performance monitoring and adaptive quality settings

2. **System Base Class** (`src/game/core/System.js`): All systems extend this
   - Provides lifecycle methods: `initialize()`, `update(delta, elapsed)`, `destroy()`
   - Dependency management between systems
   - Error boundary handling per system

3. **SystemManager** (`src/game/core/SystemManager.js`): Manages system lifecycle
   - Registration and initialization order control
   - Update loop orchestration with logging
   - Currently has verbose console logging for debugging update cycles

### System Dependencies & Order
Systems must be initialized in this specific order (defined in Engine.js):
1. `network` - Multiplayer connections
2. `mobileLOD` - Device-specific optimizations
3. `world` - Terrain generation (base dependency)
4. `water` - Water rendering (depends on world)
5. `vegetation` - Tree/plant placement (depends on world)
6. `playerState` - Player state management
7. `playerPhysics` - Physics simulation
8. `playerInput` - Input handling
9. `playerCamera` - Camera controls
10. `player` - Player orchestration
11. `atmosphere` - Sky/weather (depends on player)
12. `ui` - HUD and interface
13. `carpetTrail` - Visual effects
14. `landmarks` - Points of interest
15. `minimap` - Currently disabled in Engine.js line 125
16. `questManager` - Quest system

### Key Systems

**WorldSystem** (`src/game/systems/WorldSystem.js`)
- Procedural terrain generation using Simplex noise
- Chunk-based infinite world with LOD
- Mana node placement and management

**PlayerSystem** (`src/game/systems/PlayerSystem.js`)
- Orchestrates player subsystems (physics, input, camera, state)
- Manages carpet model and animations
- Handles spell casting and mana collection

**NetworkManager** (`src/game/systems/NetworkManager.js`)
- Socket.io based multiplayer
- Player synchronization and state updates

**QuestManager** (`src/game/systems/QuestManager.js`)
- Quest progression tracking
- Integration with landmarks and mana collection

### Performance Considerations
- Mobile detection and adaptive quality via `MobileLODManager`
- Dynamic quality adjustment based on frame rate
- Visibility change handling to pause when tab inactive
- Extensive console logging in development mode (should be reduced for production)

## Current State Notes

### Active Development
- Spell system being developed (see `docs/SPELL_SYSTEM.md`)
- Quest and landmark systems recently added
- Minimap system currently commented out (line 125 in Engine.js)

### Debug Features
- Extensive console logging throughout SystemManager update cycle
- Stats display in development mode
- Test runner available in dev: `window.runSystemTests()`

## File Conventions
- Systems extend the base `System` class
- Each system must have a `name` property for registration
- Player subsystems in `src/game/systems/player/`
- UI components in `src/game/ui/`
- Core engine components in `src/game/core/`
- Asset definitions in `public/assets/`