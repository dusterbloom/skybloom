import * as THREE from "three";
import { Logger } from '../../../utils/Logger.js';
import { System } from "../../core/System.js";

export class PlayerPhysics extends System {
  constructor(engine) {
    super(engine, 'playerPhysics');

    // Physics constants (unchanged)
    this.gravity = 5.8;
    this.minAltitude = 5;
    this.maxAltitude = 450;
    this.dragCoefficient = 0.15;
    this.altitudeDamping = 0.92;
    this.bankingSensitivity = 0.08;
    this.turnDamping = 0.97;
    
    // Add reusable vector objects to eliminate allocations
    this._tempVec1 = new THREE.Vector3();
    this._tempVec2 = new THREE.Vector3();
    this._tempVec3 = new THREE.Vector3();
    
    // Performance optimization flags
    this._skipThreshold = 0.0005; // Skip physics updates below this delta
    this._lastSignificantUpdate = 0; // Time tracking for forced updates
    this._forceUpdateInterval = 0.1; // Force update every 100ms regardless of delta
  }

  async _initialize() {
    this.playerSystem = this.engine.systems.get('playerState');
    if (!this.playerSystem) {
      throw new Error('PlayerPhysics requires playerState system');
    }

    // Get references to systems with collidable objects
    this.treeSystem = null;
    this.landmarkSystem = null;

    // Collision settings
    this.playerRadius = 3; // Collision radius around player (carpet is 5x8, use ~half width)
    this.collisionPushback = 0.8; // How much to push back on collision (0-1)
  }

  _update(delta, elapsed) {
    this.updatePhysics(delta);
  }

  updatePhysics(delta) {
    const player = this.playerSystem.localPlayer;
    if (!player) return;

    // Skip micro-updates to reduce CPU load
    // However, always force an update periodically to maintain consistency
    this._lastSignificantUpdate += delta;
    if (delta < this._skipThreshold && this._lastSignificantUpdate < this._forceUpdateInterval) {
      return;
    }
    this._lastSignificantUpdate = 0;

    // Store previous position for collision detection
    this._tempVec3.copy(player.position);

    // Preserve momentum during turns with reused vectors
    if (Math.abs(player.bankAngle) > 0.01) {
      const currentSpeed = player.velocity.length();
      if (currentSpeed > 0.01) {
        // Get forward direction using reused vector
        this._tempVec1.set(0, 0, 1).applyEuler(player.rotation);

        // Scale to match current speed
        this._tempVec1.multiplyScalar(currentSpeed);

        // Lerp velocity toward forward direction
        player.velocity.lerp(this._tempVec1, 0.1);
      }
    }

    // Update velocity with acceleration (reuse vector for scaled acceleration)
    this._tempVec1.copy(player.acceleration).multiplyScalar(delta);
    player.velocity.add(this._tempVec1);

    // Apply progressive drag based on speed (without creating new objects)
    const currentSpeed = player.velocity.length();
    if (currentSpeed > 0.001) { // Only apply drag when actually moving
      const dragFactor = 1 - (this.dragCoefficient * (currentSpeed / player.maxSpeed)) * delta;
      player.velocity.multiplyScalar(dragFactor);
    }

    // Update position (reuse vector for position delta)
    this._tempVec1.copy(player.velocity).multiplyScalar(delta);
    player.position.add(this._tempVec1);

    // Check for collisions with objects
    this.checkObjectCollisions(player, this._tempVec3);

    // Enhanced altitude control (no changes to logic, just optimized calculation)
    this.updateAltitude(player, delta);

    // Reset acceleration (without allocating new vector)
    player.acceleration.set(0, 0, 0);
  }

  // Optimized version of altitude control
  updateAltitude(player, delta) {
    // Apply altitude changes from user input
    if (Math.abs(player.altitudeVelocity) > 0.001) {
      player.position.y += player.altitudeVelocity * delta;
      
      // Apply damping to altitude velocity
      player.altitudeVelocity *= this.altitudeDamping;
      
      // Zero out extremely small values to prevent endless damping calculations
      if (Math.abs(player.altitudeVelocity) < 0.001) {
        player.altitudeVelocity = 0;
      }
    }

    // Enforce minimum altitude (above terrain)
    const worldSystem = this.engine.systemManager.get('world');
    if (!worldSystem) {
      Logger.warn('PlayerPhysics: world system not available');
      return;
    }
    const terrainHeight = worldSystem.getTerrainHeight(
      player.position.x,
      player.position.z
    );

    const minHeightAboveTerrain = Math.max(this.minAltitude, terrainHeight + 5);

    if (player.position.y < minHeightAboveTerrain) {
      player.position.y = minHeightAboveTerrain;

      // Stop downward velocity
      if (player.velocity.y < 0) {
        player.velocity.y = 0;
      }
    }

    // Enforce maximum altitude
    if (player.position.y > this.maxAltitude) {
      player.position.y = this.maxAltitude;

      // Stop upward velocity
      if (player.velocity.y > 0) {
        player.velocity.y = 0;
      }
    }
  }

  // Optimized helper methods for adding forces
  applyForwardForce(player, force) {
    // Calculate forward direction based on player's rotation using the reused vector
    this._tempVec1.set(0, 0, 1).applyEuler(player.rotation);
    
    // Add scaled forward vector to acceleration
    player.acceleration.addScaledVector(this._tempVec1, force);
  }

  applySideForce(player, force) {
    // Calculate right direction based on player's rotation using reused vector
    this._tempVec1.set(1, 0, 0).applyEuler(player.rotation);
    
    // Add scaled right vector to acceleration
    player.acceleration.addScaledVector(this._tempVec1, force);

    // Apply banking effect for turns (unchanged logic)
    const maxBankAngle = Math.PI / 6; // 30 degrees
    player.bankAngle = THREE.MathUtils.clamp(
      player.bankAngle + force * 0.01,
      -maxBankAngle,
      maxBankAngle
    );
  }

  applyAltitudeChange(player, force) {
    player.altitudeVelocity += force;

    // Limit maximum altitude velocity
    const maxAltitudeVelocity = 40;
    player.altitudeVelocity = THREE.MathUtils.clamp(
      player.altitudeVelocity,
      -maxAltitudeVelocity,
      maxAltitudeVelocity
    );
  }

  /**
   * Check for collisions with trees and landmarks
   * @param {Object} player - Player object
   * @param {THREE.Vector3} previousPosition - Position before movement
   */
  checkObjectCollisions(player, previousPosition) {
    // Lazy load system references
    if (!this.treeSystem) {
      this.treeSystem = this.engine.systems.get('simpleTrees');
    }
    if (!this.landmarkSystem) {
      this.landmarkSystem = this.engine.systems.get('landmarks');
    }

    let collisionDetected = false;

    // Check tree collisions
    if (this.treeSystem && this.treeSystem.spawnedTrees) {
      for (const tree of this.treeSystem.spawnedTrees) {
        // Calculate horizontal distance (ignore Y for now)
        const dx = player.position.x - tree.position.x;
        const dz = player.position.z - tree.position.z;
        const distanceXZ = Math.sqrt(dx * dx + dz * dz);

        // Estimate tree collision radius (trees are 6-12 units tall, use ~3-6 radius)
        const treeRadius = tree.scale.x * 0.5; // Half the scale as radius
        const collisionDistance = this.playerRadius + treeRadius;

        if (distanceXZ < collisionDistance) {
          // Check vertical distance too (player at similar height as tree)
          const dy = Math.abs(player.position.y - tree.position.y);
          if (dy < tree.scale.y) { // Within tree height
            collisionDetected = true;
            break;
          }
        }
      }
    }

    // Check landmark collisions
    if (!collisionDetected && this.landmarkSystem && this.landmarkSystem.landmarks) {
      for (const landmark of this.landmarkSystem.landmarks.values()) {
        const dx = player.position.x - landmark.position.x;
        const dz = player.position.z - landmark.position.z;
        const distanceXZ = Math.sqrt(dx * dx + dz * dz);

        // Landmark collision radius based on size
        const landmarkRadius = landmark.size * 0.5;
        const collisionDistance = this.playerRadius + landmarkRadius;

        if (distanceXZ < collisionDistance) {
          // Check vertical distance (landmarks are on ground, player can fly over)
          const dy = player.position.y - landmark.position.y;
          if (dy < landmark.size * 0.8) { // Within landmark height
            collisionDetected = true;
            break;
          }
        }
      }
    }

    // Handle collision response
    if (collisionDetected) {
      // Push player back towards previous position
      player.position.lerp(previousPosition, this.collisionPushback);

      // Dampen velocity to prevent bouncing through objects
      player.velocity.multiplyScalar(0.3);
      player.altitudeVelocity *= 0.3;
    }
  }
}