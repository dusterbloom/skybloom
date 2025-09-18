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
// Removed duplicate imports - AtmosphereSystem manages these internally
// import { SunSystem } from "../systems/SunSystem";
import { WaterSystem } from "../systems/WaterSystem";
import { SeaFloorSystem } from "../systems/SeaFloorSystem";
import { UnderwaterEffectsSystem } from "../systems/UnderwaterEffectsSystem";
import { SkyboxSystem } from "../systems/atmosphere/SkyboxSystem";
import { PerformanceBenchmarkSystem } from "../systems/PerformanceBenchmarkSystem";
import { CarpetTrailSystem } from "../systems/CarpetTrailSystem";
import { LandmarkSystem } from "../systems/LandmarkSystem";
import { MinimapSystem } from "../systems/MinimapSystem";
import { IntroScreen } from "../ui/screens/IntroScreen";
import { useGameState, GameStates } from '../state/gameState.js';
import { Logger } from '../../utils/Logger.js';
import { createTestRunner } from '../systems/tests';
import { SystemManager } from './SystemManager.js';
import { RendererManager } from './RendererManager.js';
import { QualityManager } from './QualityManager.js';
import { EventBus } from './EventBus.js';

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
      0.1,
      10000  // Increased far plane distance to better render distant terrain
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
    // Initialize all core systems
    await this.assets.initialize();

    Logger.debug('Engine initialize: systemManager exists?', !!this.systemManager);

    // Register systems to SystemManager
    let sm = this.systemManager;
    sm = sm.register(new NetworkManager(this));
    Logger.debug('After NetworkManager register, systems keys:', Array.from(this.systemManager.systems.keys()));

    sm = sm.register(new MobileLODManager(this));
    Logger.debug('After MobileLODManager register, systems keys:', Array.from(this.systemManager.systems.keys()));

    sm = sm.register(new WorldSystem(this));
    Logger.debug('After WorldSystem register, has world?:', this.systemManager.systems.has('world'), 'keys:', Array.from(this.systemManager.systems.keys()));

    sm = sm.register(new WaterSystem(this));
    Logger.debug('After WaterSystem register, systems keys:', Array.from(this.systemManager.systems.keys()));

    sm = sm.register(new SkyboxSystem(this));
    Logger.debug('After SkyboxSystem register, systems keys:', Array.from(this.systemManager.systems.keys()));

    sm = sm.register(new SeaFloorSystem(this));
    Logger.debug('After SeaFloorSystem register, systems keys:', Array.from(this.systemManager.systems.keys()));

    sm = sm.register(new UnderwaterEffectsSystem(this));
    Logger.debug('After UnderwaterEffectsSystem register, systems keys:', Array.from(this.systemManager.systems.keys()));

    sm = sm.register(new PerformanceBenchmarkSystem(this));
    Logger.debug('After PerformanceBenchmarkSystem register, systems keys:', Array.from(this.systemManager.systems.keys()));

    sm = sm.register(new VegetationSystem(this));
    Logger.debug('After VegetationSystem register, systems keys:', Array.from(this.systemManager.systems.keys()));

    sm = sm.register(new PlayerStateManager(this))
      .register(new PlayerPhysics(this))
      .register(new PlayerInputSystem(this))
      .register(new PlayerCameraSystem(this))
      .register(new PlayerSystem(this))
      .register(new AtmosphereSystem(this))
      .register(new UISystem(this))
      .register(new CarpetTrailSystem(this))
      .register(new LandmarkSystem(this));
  
      // Conditionally register MinimapSystem based on flag
      if (this.minimapEnabled !== false) {
        sm = sm.register(new MinimapSystem(this));
      }
  
      sm = sm.register(new QuestManager(this));

    Logger.debug('All systems registered, keys:', Array.from(this.systemManager.systems.keys()));

    // Define initialization order (some systems depend on others)
    const initOrder = [
      "network",
      "mobileLOD", // Initialize LOD manager first to prepare for other systems
      "skybox", // Skybox should be initialized early for proper lighting
      "world", // Base terrain must be initialized first
      "seaFloor", // Sea floor needs world system
      "water", // Water system should be initialized after terrain
      "underwaterEffects", // Underwater effects after water
      "performanceBenchmark", // Performance benchmarking system
      "vegetation", // Vegetation needs terrain to place trees
      "playerState",
      "playerPhysics", // Physics after playerState for localPlayer access
      "playerInput", // Input after physics
      "playerCamera", // Camera after input and physics
      "player", // Orchestrator after sub-systems
      "atmosphere", // Atmosphere system manages its own sun/moon/star subsystems
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
      Logger.info("Game started from intro screen");
      this.gameStarted = true;
      
       // Start any required gameplay systems here
       const player = this.systemManager.get('player');
       if (player) {
         Logger.debug("Starting player systems");
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
         Logger.debug("Requesting pointer lock for gameplay");
         this.input.requestPointerLock();
       }
      
      const network = this.systemManager.get('network');
      if (network) {
        Logger.debug("Starting network systems");
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
        Logger.info('Running system tests...');
        const results = await this._testRunner.runTests();
        Logger.info('Tests complete!');
        return results;
      };
    }

    // Add listener to canvas for pointer lock request
    this.canvas.addEventListener('click', () => {
      // Only request lock if the game is playing and lock isn't already active
      if (useGameState.getState().currentState === GameStates.PLAYING && !this.input.pointerLocked) {
          Logger.debug("Requesting pointer lock via canvas click...");
          this.input.requestPointerLock();
      }
    });

    Logger.info("Engine initialized successfully");
    Logger.debug('Device Info:', {
      userAgent: navigator.userAgent,
      deviceMemory: navigator.deviceMemory,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio: window.devicePixelRatio
    });
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

    // Update systems
    // Logger.debug(`Engine.animate: Starting system updates at frame ${this._frameCounter}, delta=${this.delta.toFixed(4)}, elapsed=${this.elapsed.toFixed(2)}, gameStarted=${this.gameStarted}, isVisible=${this.isVisible}`);
    this.systemManager.update(this.delta, this.elapsed);
    // Logger.debug('Engine.animate: Finished system updates');

    // Update performance monitor with delta for accurate FPS
    this.performanceMonitor.update(this.rendererManager.renderer, this, this.delta);

    // Render
    this.rendererManager.render(this.scene, this.camera);

    // Check if performance requires adjusting quality settings (only occasional checks)
    if (this.isMobile && this._frameCounter % 120 === 0) {
      const report = this.performanceMonitor.generateReport();
      if (this.qualityManager.updateFromPerformance(report)) {
        Logger.info('Performance-based quality adjustments applied');
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
    Logger.debug(`Visibility changed: ${this.isVisible ? 'visible' : 'hidden'}`);
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
    if (this.stats) document.body.removeChild(this.stats.dom);
    this.isRunning = false;
  }
}
