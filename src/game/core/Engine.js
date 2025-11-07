// Updated imports to include new systems
import * as THREE from "three";
import { deviceCapabilities } from "./utils/DeviceCapabilities";
import Stats from "three/examples/jsm/libs/stats.module";
import { InputManager } from "./InputManager";
import { AssetManager } from "./AssetManager";
import { PerformanceMonitor } from "./PerformanceMonitor";
import { Settings } from "./settings/Settings";
import { MobileLODManager } from "./MobileLODManager";
import { NetworkManager } from "../systems/NetworkManager";
import { QuestManager } from "../systems/QuestManager";
import { WorldSystem } from "../systems/WorldSystem";
import { PlayerSystem } from "../systems/PlayerSystem";
import { PlayerStateManager } from "../systems/player/PlayerStateManager.js";
import { PlayerInputSystem } from "../systems/player/PlayerInputSystem.js";
import { PlayerCameraSystem } from "../systems/player/PlayerCameraSystem.js";
import { UISystem } from "../systems/UISystem";
// Import new systems
import { VegetationSystem } from "../systems/VegetationSystem";
import { PlayerPhysics } from "../systems/player/PlayerPhysics.js";
import { AtmosphereSystem } from "../systems/atmosphere/AtmosphereSystem";
import { WaterSystem } from "../systems/WaterSystem";
// SeaFloorSystem and UnderwaterEffectsSystem removed - caused geometry overlap with water
import { SkyboxSystem } from "../systems/atmosphere/SkyboxSystem";
import { PerformanceBenchmarkSystem } from "../systems/PerformanceBenchmarkSystem";
import { CarpetTrailSystem } from "../systems/CarpetTrailSystem";
import { LandmarkSystem } from "../systems/LandmarkSystem";
import { MinimapSystem } from "../systems/MinimapSystem";
import { AmbientLifeSystem } from "../systems/AmbientLifeSystem";
import { IntroScreen } from "../ui/screens/IntroScreen";
import { useGameState, GameStates } from '../state/gameState.js';
import { Logger } from '../../utils/Logger.js';
import { createTestRunner } from '../systems/tests';
import { SystemManager } from './SystemManager.js';
import { RendererManager } from './RendererManager.js';
import { QualityManager } from './QualityManager.js';
import { EventBus } from './EventBus.js';

// Import mobile and physics systems from main (optional imports)
let MaterialSystemIntegration, PhysicsSystem, MobileUI;

async function loadOptionalModules() {
  try {
    const materialModule = await import("../systems/materials/MaterialSystemIntegration.js");
    MaterialSystemIntegration = materialModule.MaterialSystemIntegration;
  } catch (e) {
    // MaterialSystemIntegration not available
  }
  try {
    const physicsModule = await import("../systems/physics/PhysicsSystem.js");
    PhysicsSystem = physicsModule.PhysicsSystem;
  } catch (e) {
    // PhysicsSystem not available
  }
  try {
    const mobileModule = await import("../ui/MobileUI.js");
    MobileUI = mobileModule.MobileUI;
  } catch (e) {
    // MobileUI not available
  }
}

export class Engine {
  constructor() {
    this.canvas = document.getElementById("game-canvas");
    this.clock = new THREE.Clock();
    this.delta = 0;
    this.elapsed = 0;
    this.isRunning = false;

    this.isVisible = true;

    this.maxDeltaTime = 1/15; // Cap at 15 FPS equivalent

    // Minimap toggle flag - set to false to disable at startup
    this.minimapEnabled = true;
    this.gameStarted = false; // Flag to track if the game has started
    this._frameCounter = 0;

    // Create performance monitor
    this.performanceMonitor = new PerformanceMonitor();

    // Create settings but do NOT add it to systems list
    this.settings = new Settings();
    this.eventBus = new EventBus();

    // Use centralized device capabilities
    this.deviceCapabilities = deviceCapabilities;
    this.isMobile = this.deviceCapabilities.isMobile;

    // Create main scene and camera FIRST (before managers that depend on them)
    this.scene = new THREE.Scene();

    // Add lightweight horizon fog for atmospheric depth
    this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.0003); // Sky blue fog, density 0.0003

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      1.0,   // Increased from 0.1 for much better depth precision
      5000   // Reduced from 10000 - ratio now 5000:1 instead of 100000:1
    );

    // Create core managers (after camera is available)
    this.input = new InputManager();
    this.assets = new AssetManager();
    this.systemManager = new SystemManager(this);
    this.systems = this.systemManager.systems;
    this.rendererManager = new RendererManager(this, this.canvas);
    this.qualityManager = new QualityManager(this);
    this.qualityManager.rendererManager = this.rendererManager;

    // Performance monitoring in development
    if (import.meta.env.DEV) {
      this.stats = new Stats();
      document.body.appendChild(this.stats.dom);
    }

    // Event listeners
    window.addEventListener("resize", this.onResize.bind(this));

    // Handle visibility changes
    document.addEventListener("visibilitychange", this.onVisibilityChange.bind(this));

    // Add test system in development mode
    if (import.meta.env.DEV) {
      this._testRunner = null;
    }
  }

  async initialize() {
    // Load optional modules first
    await loadOptionalModules();

    // Initialize all core systems
    await this.assets.initialize();

    // Register systems to SystemManager
    let sm = this.systemManager;

    // Handle legacy systems that don't follow System pattern (from main branch)
    // These are managed separately from SystemManager
    if (MaterialSystemIntegration) {
      this.materialSystem = new MaterialSystemIntegration(this);
      Logger.info('MaterialSystemIntegration loaded (legacy, not managed by SystemManager)');
    }
    if (PhysicsSystem) {
      this.physicsSystem = new PhysicsSystem(this);
      Logger.info('PhysicsSystem loaded (legacy, not managed by SystemManager)');
    }

    sm = sm.register(new NetworkManager(this));
    sm = sm.register(new MobileLODManager(this));
    sm = sm.register(new WorldSystem(this));
    sm = sm.register(new WaterSystem(this));
    sm = sm.register(new SkyboxSystem(this));
    sm = sm.register(new PerformanceBenchmarkSystem(this));
    sm = sm.register(new VegetationSystem(this));
    sm = sm.register(new PlayerStateManager(this))
      .register(new PlayerPhysics(this))
      .register(new PlayerInputSystem(this))
      .register(new PlayerCameraSystem(this))
      .register(new PlayerSystem(this))
      .register(new AtmosphereSystem(this))
      .register(new AmbientLifeSystem(this))
      .register(new UISystem(this))
      .register(new CarpetTrailSystem(this))
      .register(new LandmarkSystem(this));

    // Conditionally register MinimapSystem based on flag
    if (this.minimapEnabled !== false) {
      sm = sm.register(new MinimapSystem(this));
    }

    sm = sm.register(new QuestManager(this));

    // Initialize mobile UI if on mobile device and available
    if (this.isMobile && MobileUI) {
      this.mobileUI = new MobileUI(this);
      // Note: MobileUI might not follow the System pattern, so handle separately
    }

    // Initialize legacy systems first (if available)
    if (this.materialSystem && typeof this.materialSystem.initialize === 'function') {
      await this.materialSystem.initialize();
      Logger.info('MaterialSystem initialized');
    }
    if (this.physicsSystem && typeof this.physicsSystem.initialize === 'function') {
      await this.physicsSystem.initialize();
      Logger.info('PhysicsSystem initialized');
    }

    // Define initialization order (some systems depend on others)
    const initOrder = [
      "network",
      "mobileLOD", // Initialize LOD manager first to prepare for other systems
      "skybox", // Skybox should be initialized early for proper lighting
      "world", // Base terrain must be initialized first
      "water", // Water system should be initialized after terrain
      "performanceBenchmark", // Performance benchmarking system
      "vegetation", // Vegetation needs terrain to place trees
      "playerState",
      "playerPhysics", // Physics after playerState for localPlayer access
      "playerInput", // Input after physics
      "playerCamera", // Camera after input and physics
      "player", // Orchestrator after sub-systems
      "atmosphere", // Atmosphere system manages its own sun/moon/star subsystems
      "ambientLife", // Birds and butterflies for cozy world feel
      "ui", // UI needs player for HUD elements
      "carpetTrail", // Trail system needs player
      "landmarks",   // Landmarks need world and player
      "minimap",    // Minimap needs world and player info
      "questManager"
    ];

    this.systemManager.setUpdateOrder(initOrder);

    // Initialize systems in order
    await this.systemManager.initialize();

    // Setup renderer
    this.rendererManager.setup();

    // Apply initial quality settings
    this.rendererManager.applyQualitySettings(this.isMobile ? 1 : 2);

    // Set up event handling
    this.input.initialize();

    // Configure input system to provide player state to UI
    if (this.input && this.systemManager.get('player')) {
      // Add a small delay to ensure player system is ready
      setTimeout(() => {
        try {
          this.input.setPlayerStateProvider(() => {
            const playerSystem = this.systemManager.get('player');
            return playerSystem ? playerSystem.getLocalPlayerState() : null;
          });
          Logger.info('Player state provider configured successfully');
        } catch (error) {
          Logger.warn('Error setting player state provider:', error);
        }
      }, 100); // 100ms delay
    }

    // Initialize mobile UI if available
    if (this.mobileUI && typeof this.mobileUI.initialize === 'function') {
      this.mobileUI.initialize();
      Logger.info('Mobile UI initialized');

      // Hide spell buttons in mobile view
      setTimeout(() => {
        const spellButtons = document.querySelectorAll('#ui-container .spell-slot, [id^="spell-button"]');
        spellButtons.forEach(button => {
          if (button) button.style.display = 'none';
        });

        // Hide any other UI elements that might be present
        const extraButtons = document.querySelectorAll('#ui-container > div:not(#health-bar):not(#battery-toggle)');
        extraButtons.forEach(element => {
          if (element && !element.id.includes('battery')) {
            element.style.display = 'none';
          }
        });
      }, 500);
    }

    // Set CSS variables for UI animations based on device capabilities
    document.documentElement.style.setProperty(
      '--ui-animation-speed',
      this.qualityManager.uiAnimationLevel === 'high' ? '1' : '0.5'
    );

    // Bind minimap toggle to 'M' key
    this.input.on('keydown', (event) => {
      if (event.code === 'KeyM' && useGameState.getState().currentState === GameStates.PLAYING) {
        this.toggleMinimap();
      }
    });

    // Hide loading screen
    document.getElementById("loading").style.display = "none";

    // Start game loop
    this.isRunning = true;
    this.animate();

    // Initialize intro screen
    this.introScreen = new IntroScreen(this);

    // Set callback for when play button is clicked
    this.introScreen.onPlay(async () => {
      this.gameStarted = true;

       // Start any required gameplay systems here
       const player = this.systemManager.get('player');
       if (player) {
        if (typeof player.enable === 'function') {
          player.enable();
        }
      }

       const playerInput = this.systemManager.get('playerInput');
       if (this.input.isTouchDevice && playerInput && typeof playerInput.showMobileControls === 'function') {
        playerInput.showMobileControls();
      }

       // Request pointer lock for desktop gameplay
       if (!this.input.isTouchDevice) {
        this.input.requestPointerLock();
      }

      const network = this.systemManager.get('network');
      if (network) {
        network.connect();
      }

      // Set game state to PLAYING to enable UI updates including minimap
      useGameState.getState().setGameState(GameStates.PLAYING);
    });

    // Show intro screen and transition to INTRO state
    this.introScreen.show();
    useGameState.getState().setGameState(GameStates.INTRO);

    // Initialize test system in development mode
    if (import.meta.env.DEV) {
      this._testRunner = createTestRunner(this);

      // Expose test runner to console
      window.runSystemTests = async () => {
        const results = await this._testRunner.runTests();
        return results;
      };
    }

    // Add listener to canvas for pointer lock request
    this.canvas.addEventListener('click', () => {
      // Only request lock if the game is playing and lock isn't already active
      if (useGameState.getState().currentState === GameStates.PLAYING && !this.input.pointerLocked) {
          this.input.requestPointerLock();
      }
    });

    Logger.info("Engine initialized successfully");
  }

  animate(timestamp) {
    if (!this.isRunning) return;

    requestAnimationFrame(this.animate.bind(this));

    // Skip updates if tab is not visible or game not started
    if (!this.isVisible || !this.gameStarted) return;

    // Calculate delta time and cap it to prevent huge jumps
    this.delta = Math.min(this.clock.getDelta(), this.maxDeltaTime);
    this.elapsed = this.clock.getElapsedTime();

    // Update quality
    this.qualityManager.update(this.delta);

    // Update legacy systems (if available)
    if (this.physicsSystem && typeof this.physicsSystem.update === 'function') {
      // PhysicsSystem needs world reference
      const world = this.systemManager.get('world');
      this.physicsSystem.update(this.delta, world, this.elapsed);
    }
    if (this.materialSystem && typeof this.materialSystem.update === 'function') {
      this.materialSystem.update(this.delta, this.elapsed);
    }

    // Update systems
    this.systemManager.update(this.delta, this.elapsed);

    // Update performance monitor with delta for accurate FPS
    this.performanceMonitor.update(this.rendererManager.renderer, this, this.delta);

    // Render
    this.rendererManager.render(this.scene, this.camera);

    // Check if performance requires adjusting quality settings (only occasional checks)
    if (this.isMobile && this._frameCounter % 120 === 0) {
      const report = this.performanceMonitor.generateReport();
      if (this.qualityManager.updateFromPerformance(report)) {
        // Logger.info('Performance-based quality adjustments applied');
      }
    }

    // Update mobile UI if available
    if (this.mobileUI && typeof this.mobileUI.update === 'function') {
      const player = this.systemManager.get('player');
      if (player && player.localPlayer) {
        this.mobileUI.update(this.delta, player.localPlayer);
      }
    }

    // Update frame counter
    this._frameCounter++;

    // Update stats if available (dev only)
    if (this.stats) this.stats.update();
  }

  onResize() {
    this.rendererManager.updateResolution();
  }

  onVisibilityChange() {
    this.isVisible = document.visibilityState === 'visible';
    this.systemManager.handleVisibilityChange(this.isVisible);
    this.rendererManager.handleVisibilityChange(this.isVisible);
    this.qualityManager.handleVisibilityChange(this.isVisible);
  }

  destroy() {
    this.systemManager.destroy();
    this.rendererManager.destroy();
    this.qualityManager.destroy();
    this.input.destroy();
    this.assets.destroy();
    if (this.introScreen) this.introScreen.destroy();
    if (this.mobileUI && typeof this.mobileUI.destroy === 'function') {
      this.mobileUI.destroy();
    }
    if (this.stats) document.body.removeChild(this.stats.dom);
    this.isRunning = false;
  }

  // Toggle minimap (from main branch)
  toggleMinimap() {
    const minimap = this.systemManager.get('minimap');
    if (minimap && typeof minimap.toggle === 'function') {
      minimap.toggle();
    }
  }

  // Toggle high quality mode (from main branch)
  toggleHighQualityMode() {
    const highQualityMode = !this.qualityManager.highQualityMode;
    this.qualityManager.highQualityMode = highQualityMode;

    Logger.info(`High quality mode: ${highQualityMode ? 'enabled' : 'disabled'}`);

    // Update all systems that might be affected by quality changes
    const carpetTrail = this.systemManager.get('carpetTrail');
    if (carpetTrail) {
      // Enable/disable trail effects based on quality mode
      carpetTrail.enableRibbonTrail = !this.isMobile || highQualityMode;
      carpetTrail.enableSteamParticles = !this.isMobile || highQualityMode;

      // Adjust particle counts
      if (highQualityMode) {
        carpetTrail.maxParticles = this.isMobile ? 50 : 150;
        carpetTrail.maxMotionLines = this.isMobile ? 4 : 10;
      } else {
        carpetTrail.maxParticles = this.isMobile ? 25 : 75;
        carpetTrail.maxMotionLines = this.isMobile ? 2 : 6;
      }
    }

    // Update atmosphere system
    const atmosphere = this.systemManager.get('atmosphere');
    if (atmosphere) {
      // Enable/disable birds based on quality mode
      atmosphere.enableBirds = !this.isMobile || highQualityMode;

      // Adjust cloud count
      atmosphere.cloudCount = highQualityMode ?
        (this.isMobile ? 40 : 80) :
        (this.isMobile ? 25 : 50);
    }

    // Update vegetation system view distance
    const vegetation = this.systemManager.get('vegetation');
    if (vegetation) {
      vegetation.vegetationDistance = highQualityMode ?
        (this.isMobile ? 2 : 3) :
        (this.isMobile ? 1 : 2);
    }

    // Return current state
    return highQualityMode;
  }
}
