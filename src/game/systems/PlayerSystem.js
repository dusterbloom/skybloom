import * as THREE from 'three';
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';
import { Howl } from 'howler';
import { PlayerPhysics } from './player/PlayerPhysics';
import { PlayerSpells } from './player/PlayerSpells';
import { PlayerInput } from './player/PlayerInput';
import { PlayerModels } from './player/PlayerModels';

export class PlayerSystem extends System {
  constructor(engine) {
    super(engine, 'player');
    this.requireDependencies(['playerState', 'playerPhysics', 'playerInput', 'playerCamera', 'world']);
    this.eventBus = engine.eventBus;
    this.scene = engine.scene;
    
    // World transition flag
    this.isTransitioning = false;
    this.transitionAlpha = 0;
    this.worldTransitionComplete = null;
    this.worldSize = 2000;

    // Keep spells and models internal
    this.spells = new PlayerSpells(this);
    this.models = new PlayerModels(this);
  }
  
  async _initialize() {
    // Wait for playerState to be ready
    const playerState = this.engine.systemManager.get('playerState');
    if (playerState.localPlayer) {
      this.localPlayer = playerState.localPlayer;
      Logger.info('PlayerSystem: Local player ready, creating model');
      
      // Initialize models before creating
      await this.models.initialize();
      
      // Create model for local player
      this.localPlayer.model = this.models.createCarpetModel(this.localPlayer.id);
      this.scene.add(this.localPlayer.model);
      Logger.info('PlayerSystem: Carpet model created and added to scene');
    } else {
      Logger.warn('PlayerSystem: No local player available during initialization');
    }
    
    // Initialize internal subsystems
    await this.spells.initialize();

    // Spell input handling
    this.engine.input.on('keydown', (event) => {
  if (!this.engine.systems.playerState?.localPlayer) return;
      if (!this.engine.systems.playerState?.localPlayer) return;

      switch (event.code) {
        case 'Digit1':
          this.spells.selectSpell(0);
          break;
        case 'Digit2':
          this.spells.selectSpell(1);
          break;
        case 'Digit3':
          this.spells.selectSpell(2);
          break;
        case 'Digit4':
          this.spells.selectSpell(3);
          break;
        case 'KeyE':
          this.spells.castSpell();
          this.eventBus.emit('spellCast', { spellIndex: this.engine.systems.playerState?.localPlayer.currentSpell });
          break;
      }
    });

    Logger.info("Player system initialized");
  }
  
  /**
   * Enable the player system (called when the game starts)
   */
  enable() {
    Logger.info('Player system enabled');
  }
  

  
  
  
  
  updateTransition(delta) {
    // Update transition effect
    this.transitionAlpha += delta * 0.5; // Fade speed
    
    if (this.transitionAlpha >= 2.0) {
      // Transition is complete
      this.isTransitioning = false;
      this.transitionAlpha = 0;
      
      // Execute the world transition callback
      if (this.worldTransitionComplete) {
        this.worldTransitionComplete();
        this.worldTransitionComplete = null;
      }
      
      // Remove transition overlay
      const overlay = document.getElementById('transition-overlay');
      if (overlay) {
        document.body.removeChild(overlay);
      }
    } else {
      // Update transition overlay opacity
      const overlay = document.getElementById('transition-overlay');
      if (overlay) {
        // First half = fade to black, second half = fade from black
        const opacity = this.transitionAlpha <= 1.0 ? 
          this.transitionAlpha : 
          2.0 - this.transitionAlpha;
          
        overlay.style.opacity = opacity.toString();
      }
    }
  }
  
  // Infinite World: Boundary check removed to allow unlimited travel
  checkWorldBoundaries() {
    // No-op: Infinite world, no boundaries enforced
  }
  
  startWorldTransition() {
    if (this.isTransitioning) return;
    
    // Create overlay for transition effect
    const overlay = document.createElement('div');
    overlay.id = 'transition-overlay';
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'black';
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.5s';
    overlay.style.zIndex = '1000';
    overlay.style.pointerEvents = 'none';
    document.body.appendChild(overlay);
    
    // Set transition state
    this.isTransitioning = true;
    this.transitionAlpha = 0;
    
    // Set callback for when transition reaches midpoint (full black)
    this.worldTransitionComplete = () => {
      // Generate a new random seed for the world
      this.engine.systems.world.seed = Math.random() * 1000;
      
      // Regenerate world
      this.engine.systems.world.createTerrain();
      this.engine.systems.world.createTerrainCollision();
      this.engine.systems.world.createManaNodes();
      
      // Move player to center of new world at appropriate height
      this.localPlayer.position.set(0, 150, 0);
      this.localPlayer.velocity.set(0, 0, 0);
    };
  }
  
  
  _update(delta, elapsed) {
    // console.log('PlayerSystem._update: Starting at', Date.now(), 'isTransitioning:', this.isTransitioning);
    if (this.isTransitioning) {
      this.updateTransition(delta);
      // console.log('PlayerSystem._update: Transitioning, skipping subsystem updates');
      return;
    }

    // Update internal subsystems
    // console.log('PlayerSystem._update: models exists:', !!this.models);
    if (this.models) {
      try {
        this.models.updateModels();
        // console.log('PlayerSystem._update: models.updateModels() completed successfully');
      } catch (error) {
        // console.error('PlayerSystem._update: Error in models.updateModels():', error);
      }
    } else {
      // console.warn('PlayerSystem._update: models is undefined');
    }
    
    // console.log('PlayerSystem._update: spells exists:', !!this.spells);
    if (this.spells) {
      this.spells.updateSpells(delta);
    } else {
      // console.warn('PlayerSystem._update: spells is undefined');
    }

    // Forward events and checks
    this.checkManaCollection();
    this.checkLandmarkVisits();
    this.checkWorldBoundaries();
    // console.log('PlayerSystem._update: Finished');
  }

  
  
  checkManaCollection() {
    const playerState = this.engine.systems.get('playerState');
    if (!playerState || !playerState.localPlayer) return;

    const localPlayer = playerState.localPlayer;
    if (!localPlayer) return;

    // Collection radius
    const radius = 5;

    // Load the mana collection sound
    const manaSound = new Howl({
      src: ['assets/audio/collect.mp3'],
      volume: 0.5,
    });

    // Check for mana node collection
    const worldSystem = this.engine.systems.get('world');
    if (!worldSystem) {
      Logger.warn('PlayerSystem: World system not available for mana collection');
      return;
    }

    const collectedNodes = worldSystem.checkManaCollection(
      localPlayer.position,
      radius
    );
    
    // Process collected nodes
    collectedNodes.forEach(node => {
      // Add mana to player
      localPlayer.mana += node.value;
      localPlayer.totalMana += node.value;
      this.eventBus.emit('manaCollected', { amount: node.value });
      
      // Update UI
      const ui = this.engine.systems.get('ui');
      if (ui) {
        ui.updateManaDisplay(localPlayer.mana);
      }
      
      // Create collection effect
      this.models.createManaCollectionEffect(node.position);
      
      // Play mana collection sound
      // // manaSound.play(); // Audio disabled // Audio disabled
    });
  }

  checkLandmarkVisits() {
    const playerState = this.engine.systems.get('playerState');
    if (!playerState || !playerState.localPlayer) return;

    const localPlayer = playerState.localPlayer;
    const landmarkSystem = this.engine.systems.get('landmarks');
    if (!landmarkSystem || !landmarkSystem.landmarks) return;

    const landmarks = landmarkSystem.landmarks;
    if (!landmarks) return;

    const visitDistance = 50;
    for (const [id, landmark] of landmarks) {
      if (landmark.position && landmark.position.distanceTo(localPlayer.position) < visitDistance) {
        if (!localPlayer.visitedLandmarks) localPlayer.visitedLandmarks = new Set();
        if (!localPlayer.visitedLandmarks.has(id)) {
          localPlayer.visitedLandmarks.add(id);
          localPlayer.landmarksVisited = localPlayer.visitedLandmarks.size;
          this.eventBus.emit('landmarkVisited', { landmarkId: id });
        }
      }
    }
  }
}
