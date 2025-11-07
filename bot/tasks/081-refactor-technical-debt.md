# Task 081: Refactor Technical Debt and Code Organization

## 1. Task & Context
**Task:** Address technical debt by refactoring inconsistent patterns, removing duplicate code, and improving code organization
**Scope:** All JavaScript files with inconsistent patterns and duplicate code
**Branch:** slow-mode
**Priority:** MEDIUM - Long-term maintainability

## 2. Quick Plan
**Approach:** Identify code smells, standardize patterns, remove duplicates, improve file organization
**Complexity:** 3-High (broad scope across codebase)
**Uncertainty:** 2-Medium (need to understand existing patterns first)

## 3. Implementation

### Current Issues Found:
- Inconsistent error handling patterns
- Mixed async/sync patterns
- Hardcoded values scattered throughout
- Duplicate code in player systems
- Inconsistent import patterns
- Mixed file naming conventions

### Solution Approach:
1. Standardize error handling patterns
2. Remove duplicate code
3. Extract hardcoded values to constants
4. Improve import organization
5. Standardize naming conventions

### Implementation Steps:

**Step 1: Standardize Error Handling**
Create consistent error handling patterns:
```javascript
// src/utils/ErrorHandler.js
export class ErrorHandler {
  static handle(error, context = {}) {
    const errorInfo = {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString()
    };

    Logger.error('Error occurred:', errorInfo);

    // Report to error tracking if available
    if (window.reportError) {
      window.reportError(error, errorInfo);
    }

    return errorInfo;
  }

  static async withRetry(operation, maxRetries = 3, delay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
}

// Usage pattern
try {
  await riskyOperation();
} catch (error) {
  ErrorHandler.handle(error, { operation: 'riskyOperation' });
}
```

**Step 2: Extract Constants and Configuration**
```javascript
// src/config/GameConfig.js
export const GAME_CONFIG = {
  WORLD: {
    CHUNK_SIZE: 64,
    RENDER_DISTANCE: 8,
    MAX_HEIGHT: 100,
    MIN_HEIGHT: -50
  },
  PLAYER: {
    SPEED: 50,
    ACCELERATION: 20,
    MAX_MANA: 100,
    MANA_REGEN: 5
  },
  NETWORK: {
    UPDATE_RATE: 20, // Hz
    MAX_LATENCY: 100, // ms
    RECONNECT_ATTEMPTS: 5
  },
  PHYSICS: {
    GRAVITY: -9.81,
    FRICTION: 0.8,
    BOUNCE: 0.3
  }
};

// Replace hardcoded values
// Before: this.chunkSize = 64;
// After: this.chunkSize = GAME_CONFIG.WORLD.CHUNK_SIZE;
```

**Step 3: Remove Duplicate Code in Player Systems**
Consolidate common functionality:
```javascript
// src/game/systems/player/PlayerUtils.js
export class PlayerUtils {
  static calculateMovement(position, velocity, delta) {
    // Common movement calculation logic
    return new THREE.Vector3().copy(position).add(
      new THREE.Vector3().copy(velocity).multiplyScalar(delta)
    );
  }

  static clampToWorldBounds(position) {
    // World boundary clamping logic
    position.x = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, position.x));
    position.z = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, position.z));
    return position;
  }

  static updateMana(currentMana, delta, isRegenerating = true) {
    // Mana management logic
    if (isRegenerating && currentMana < MAX_MANA) {
      return Math.min(MAX_MANA, currentMana + MANA_REGEN * delta);
    }
    return currentMana;
  }
}

// Refactor player systems to use shared utilities
// Before: Duplicate movement code in each player system
// After: this.position = PlayerUtils.calculateMovement(this.position, this.velocity, delta);
```

**Step 4: Standardize Import Patterns**
```javascript
// src/game/systems/WorldSystem.js
// Group imports by type and sort alphabetically
import { GAME_CONFIG } from '../../config/GameConfig.js';
import { ErrorHandler } from '../../utils/ErrorHandler.js';
import { Logger } from '../../utils/Logger.js';

// Three.js imports
import * as THREE from 'three';

// Local imports
import { System } from '../core/System.js';
import { PlayerUtils } from './player/PlayerUtils.js';

// External libraries
import { SimplexNoise } from 'simplex-noise';
```

**Step 5: Improve File Organization**
Restructure files for better organization:
```
src/
├── config/           # Configuration constants
│   ├── GameConfig.js
│   └── SystemConfig.js
├── utils/            # Utility functions
│   ├── ErrorHandler.js
│   ├── Logger.js
│   └── MathUtils.js
├── game/
│   ├── core/         # Core engine
│   ├── systems/      # Game systems
│   │   ├── player/   # Player-related systems
│   │   │   ├── PlayerMovementSystem.js
│   │   │   ├── PlayerPhysicsSystem.js
│   │   │   └── PlayerUtils.js
│   │   └── world/    # World-related systems
│   └── ui/           # UI components
```

**Step 6: Standardize Naming Conventions**
```javascript
// Class names: PascalCase
export class WorldSystem extends System { }

// Method names: camelCase
calculateHeight(x, z) { }

// Constant names: UPPER_SNAKE_CASE
const MAX_CHUNK_SIZE = 64;

// Private methods: prefix with underscore
_updateChunk(chunk) { }

// File names: PascalCase for classes, camelCase for utilities
// WorldSystem.js, playerUtils.js
```

**Step 7: Add Type Hints and Documentation**
```javascript
/**
 * Calculates terrain height at given coordinates
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @returns {number} Height value between 0 and 1
 */
calculateHeight(x, z) {
  // Implementation
}
```

## 4. Check & Commit

**Files to Update:**
- All JavaScript files with inconsistent patterns
- src/config/GameConfig.js (new)
- src/utils/ErrorHandler.js (new)
- src/game/systems/player/PlayerUtils.js (new)
- Import statements across all files

**Expected Impact:**
- Improved code maintainability
- Reduced bug introduction risk
- Better developer experience
- Easier code reviews
- More consistent codebase

**Testing:**
- Verify all imports work correctly
- Test refactored functionality
- Check for any breaking changes
- Ensure performance is maintained

**Commit Message:** refactor: Address technical debt with standardized patterns, removed duplicates, and improved organization

**Status:** Ready for implementation