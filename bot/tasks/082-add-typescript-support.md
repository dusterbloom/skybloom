# Task 082: Add TypeScript Support and Type Safety

## 1. Task & Context
**Task:** Migrate from JavaScript to TypeScript for better type safety and developer experience
**Scope:** Core files and type definitions, gradual migration strategy
**Branch:** slow-mode
**Priority:** LOW - Development experience improvement

## 2. Quick Plan
**Approach:** Set up TypeScript configuration, create type definitions, migrate core files gradually
**Complexity:** 3-High (language migration, type system setup)
**Uncertainty:** 2-Medium (TypeScript integration with Three.js)

## 3. Implementation

### Current Issues Found:
- No TypeScript or JSDoc types
- Runtime type checking missing
- Prop validation absent
- Development friction from lack of type safety

### Solution Approach:
1. Set up TypeScript configuration
2. Create type definitions for Three.js and game objects
3. Migrate core files to TypeScript
4. Add type checking to build process

### Implementation Steps:

**Step 1: Set Up TypeScript Configuration**
```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "allowJs": true,
    "checkJs": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@/game/*": ["src/game/*"],
      "@/utils/*": ["src/utils/*"],
      "@/config/*": ["src/config/*"]
    }
  },
  "include": [
    "src/**/*",
    "types/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist"
  ]
}
```

**Step 2: Create Type Definitions**
```typescript
// types/game.d.ts
import * as THREE from 'three';

export interface GameConfig {
  world: WorldConfig;
  player: PlayerConfig;
  network: NetworkConfig;
  physics: PhysicsConfig;
}

export interface WorldConfig {
  chunkSize: number;
  renderDistance: number;
  maxHeight: number;
  minHeight: number;
}

export interface PlayerConfig {
  speed: number;
  acceleration: number;
  maxMana: number;
  manaRegen: number;
}

export interface NetworkConfig {
  updateRate: number;
  maxLatency: number;
  reconnectAttempts: number;
}

export interface PhysicsConfig {
  gravity: number;
  friction: number;
  bounce: number;
}

export interface System {
  name: string;
  enabled: boolean;
  initialized: boolean;
  initialize(): void;
  update(delta: number, elapsed: number): void;
  destroy(): void;
  recover?(): void;
}

export interface PlayerState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  mana: number;
  health: number;
  isGrounded: boolean;
}

export interface WorldChunk {
  x: number;
  z: number;
  mesh: THREE.Mesh;
  heightmap: Float32Array;
  biome: BiomeType;
  loaded: boolean;
}

export type BiomeType = 'forest' | 'desert' | 'mountain' | 'plains' | 'ocean';

export interface NetworkMessage {
  type: string;
  payload: any;
  timestamp: number;
  sender?: string;
}
```

**Step 3: Create Three.js Type Extensions**
```typescript
// types/three-extensions.d.ts
import * as THREE from 'three';

declare module 'three' {
  export interface Object3D {
    userData: {
      chunk?: WorldChunk;
      player?: PlayerState;
      system?: string;
      [key: string]: any;
    };
  }

  export interface Material {
    userData: {
      biome?: BiomeType;
      system?: string;
      [key: string]: any;
    };
  }
}
```

**Step 4: Migrate Core System to TypeScript**
```typescript
// src/game/core/System.ts
export abstract class System implements SystemInterface {
  public name: string;
  public enabled: boolean = true;
  public initialized: boolean = false;

  constructor(name: string) {
    this.name = name;
  }

  abstract initialize(): void;
  abstract update(delta: number, elapsed: number): void;
  abstract destroy(): void;

  public recover?(): void;

  protected handleError(error: Error, context?: Record<string, any>): void {
    ErrorHandler.handle(error, {
      system: this.name,
      ...context
    });
  }
}
```

**Step 5: Migrate Engine to TypeScript**
```typescript
// src/game/core/Engine.ts
import * as THREE from 'three';
import { System } from './System.js';
import { SystemManager } from './SystemManager.js';
import { GameConfig } from '@/config/GameConfig.js';

export class Engine {
  private config: GameConfig;
  private systemManager: SystemManager;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private clock: THREE.Clock;
  private running: boolean = false;

  constructor(config: GameConfig) {
    this.config = config;
    this.systemManager = new SystemManager();
    this.clock = new THREE.Clock();

    this.initializeRenderer();
    this.initializeScene();
    this.initializeCamera();
  }

  private initializeRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);
  }

  private initializeScene(): void {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87CEEB, 100, 1000);
  }

  private initializeCamera(): void {
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
  }

  public registerSystem(system: System, name?: string): void {
    this.systemManager.register(system, name || system.name);
  }

  public async initialize(): Promise<void> {
    try {
      await this.systemManager.initialize();
      Logger.info('Engine initialized successfully');
    } catch (error) {
      Logger.error('Failed to initialize engine:', error);
      throw error;
    }
  }

  public start(): void {
    if (this.running) return;

    this.running = true;
    this.animate();
    Logger.info('Engine started');
  }

  public stop(): void {
    this.running = false;
    Logger.info('Engine stopped');
  }

  private animate = (): void => {
    if (!this.running) return;

    requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    this.systemManager.update(delta, elapsed);
    this.render();
  };

  private render(): void {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  public destroy(): void {
    this.stop();
    this.systemManager.destroy();

    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}
```

**Step 6: Update Build Configuration**
```javascript
// vite.config.js
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/game': path.resolve(__dirname, './src/game'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/config': path.resolve(__dirname, './src/config')
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html')
      }
    }
  },
  esbuild: {
    loader: 'ts',
    include: /\.(ts|tsx|js|jsx)$/,
    exclude: /node_modules/
  }
});
```

**Step 7: Update Package.json**
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "type-check": "tsc --noEmit",
    "lint": "eslint src --ext .ts,.tsx,.js,.jsx"
  },
  "devDependencies": {
    "@types/node": "^18.0.0",
    "@types/three": "^0.150.0",
    "typescript": "^5.0.0",
    "vite": "^4.0.0"
  }
}
```

## 4. Check & Commit

**Files to Create/Update:**
- tsconfig.json
- types/game.d.ts
- types/three-extensions.d.ts
- src/game/core/System.ts
- src/game/core/Engine.ts
- vite.config.js
- package.json

**Expected Impact:**
- Better type safety and error catching
- Improved IDE support and autocomplete
- Enhanced code documentation
- Reduced runtime errors
- Better refactoring capabilities

**Testing:**
- Verify TypeScript compilation works
- Test type checking catches errors
- Ensure runtime behavior unchanged
- Check build process works correctly

**Commit Message:** feat: Add TypeScript support with type definitions and migrate core files

**Status:** Ready for implementation