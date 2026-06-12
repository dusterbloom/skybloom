import * as THREE from "three";
import { Logger } from '../../../utils/Logger.js';
import { System } from "../../core/System.js";

export class PlayerPhysics extends System {
  constructor(engine) {
    super(engine, 'playerPhysics');

    // Physics constants
    this.gravity = 5.8;
    this.minAltitude = 5;
    this.maxAltitude = 2200; // Cloud band sits at 600-1000; leave room to soar well above it
    this.dragCoefficient = 0.4; // Increased for better deceleration feel
    this.altitudeDamping = 0.95; // Per-frame at 60fps; applied as pow(damping, delta * 60)
    this.bankingSensitivity = 0.08;
    this.turnDamping = 0.97;
    this.velocityAlignRate = 2.5; // Velocity-to-facing easing: 1 - exp(-rate * delta)
    this.maxAltitudeVelocity = 90;
    this.divePower = 150; // Extra forward accel per unit of nose-down forward.y
    this.diveCapStretch = 0.25; // Speed cap stretches to 1.25x in a full dive
    this.absoluteMaxSpeed = 300; // Hard ceiling regardless of boost/dive stacking
    this.climbDragCoefficient = 0.5; // Extra drag per unit of nose-up forward.y
    
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

    // Facing direction; rotation.x > 0 pitches the nose down (forward.y = -sin(rotation.x))
    this._tempVec1.set(0, 0, 1).applyEuler(player.rotation);
    const forwardY = this._tempVec1.y;

    // Gently align velocity with forward direction (time-based, ~0.04/frame at 60fps)
    let currentSpeed = player.velocity.length();
    if (currentSpeed > 1) {
      this._tempVec2.copy(this._tempVec1).multiplyScalar(currentSpeed);
      player.velocity.lerp(this._tempVec2, 1 - Math.exp(-this.velocityAlignRate * delta));
    }

    // Dive energy: nose-down trades altitude for extra forward acceleration
    if (forwardY < 0) {
      player.velocity.addScaledVector(this._tempVec1, -forwardY * this.divePower * delta);
    }

    // Update velocity with acceleration (reuse vector for scaled acceleration)
    this._tempVec1.copy(player.acceleration).multiplyScalar(delta);
    player.velocity.add(this._tempVec1);

    // Apply progressive drag based on speed (without creating new objects)
    currentSpeed = player.velocity.length();
    if (currentSpeed > 0.001) { // Only apply drag when actually moving
      let dragFactor = 1 - (this.dragCoefficient * (currentSpeed / player.maxSpeed)) * delta;
      // Climbing bleeds speed
      if (forwardY > 0) {
        dragFactor -= forwardY * this.climbDragCoefficient * delta;
      }
      player.velocity.multiplyScalar(Math.max(0, dragFactor));
    }

    // Clamp horizontal speed so top speed is frame-rate independent.
    // Diving stretches the cap; y is deliberately left unclamped.
    let speedCap = player.maxSpeed * (player.speedMultiplier || 1);
    if (forwardY < 0) {
      speedCap *= 1 + this.diveCapStretch * Math.min(1, -forwardY * 2);
    }
    // Boosts and dives stack multiplicatively; keep the game controllable
    // by bounding the stack at an absolute ceiling.
    speedCap = Math.min(speedCap, this.absoluteMaxSpeed);
    const horizontalSpeed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z);
    if (horizontalSpeed > speedCap) {
      const capScale = speedCap / horizontalSpeed;
      player.velocity.x *= capScale;
      player.velocity.z *= capScale;
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
    // Clamp input-driven vertical rate
    player.altitudeVelocity = THREE.MathUtils.clamp(
      player.altitudeVelocity,
      -this.maxAltitudeVelocity,
      this.maxAltitudeVelocity
    );

    // Apply altitude changes from user input
    if (Math.abs(player.altitudeVelocity) > 0.001) {
      player.position.y += player.altitudeVelocity * delta;

      // Apply damping to altitude velocity (frame-rate independent)
      player.altitudeVelocity *= Math.pow(this.altitudeDamping, delta * 60);

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
      if (player.altitudeVelocity < 0) {
        player.altitudeVelocity = 0;
      }
    }

    // Enforce maximum altitude
    if (player.position.y > this.maxAltitude) {
      player.position.y = this.maxAltitude;

      // Stop upward velocity
      if (player.velocity.y > 0) {
        player.velocity.y = 0;
      }
      if (player.altitudeVelocity > 0) {
        player.altitudeVelocity = 0;
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
    player.altitudeVelocity = THREE.MathUtils.clamp(
      player.altitudeVelocity,
      -this.maxAltitudeVelocity,
      this.maxAltitudeVelocity
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

    let collisionNormal = null;
    let closestDistance = Infinity;

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

        if (distanceXZ < collisionDistance && distanceXZ < closestDistance) {
          // Check vertical distance too (player at similar height as tree)
          const dy = Math.abs(player.position.y - tree.position.y);
          if (dy < tree.scale.y) { // Within tree height
            closestDistance = distanceXZ;
            // Calculate collision normal (direction from tree to player)
            collisionNormal = new THREE.Vector3(dx, 0, dz).normalize();
          }
        }
      }
    }

    // Check landmark collisions
    if (this.landmarkSystem && this.landmarkSystem.landmarks) {
      for (const landmark of this.landmarkSystem.landmarks.values()) {
        const dx = player.position.x - landmark.position.x;
        const dz = player.position.z - landmark.position.z;
        const distanceXZ = Math.sqrt(dx * dx + dz * dz);

        // Landmark collision radius based on size
        const landmarkRadius = landmark.size * 0.5;
        const collisionDistance = this.playerRadius + landmarkRadius;

        if (distanceXZ < collisionDistance && distanceXZ < closestDistance) {
          // Check vertical distance (landmarks are on ground, player can fly over)
          const dy = player.position.y - landmark.position.y;
          if (dy < landmark.size * 0.8) { // Within landmark height
            closestDistance = distanceXZ;
            // Calculate collision normal (direction from landmark to player)
            collisionNormal = new THREE.Vector3(dx, 0, dz).normalize();
          }
        }
      }
    }

    // Handle collision response with bounce
    if (collisionNormal) {
      // Move player back to previous position
      player.position.copy(previousPosition);

      // Calculate reflection of velocity vector
      // Formula: v' = v - 2(v·n)n where n is the collision normal
      const dotProduct = player.velocity.dot(collisionNormal);

      // Only reflect if moving toward the obstacle (dotProduct < 0 means moving away)
      if (dotProduct < 0) {
        // Reflect velocity with some energy loss (0.5 = 50% bounce)
        const bounceStrength = 0.5;
        this._tempVec1.copy(collisionNormal).multiplyScalar(2 * dotProduct);
        player.velocity.sub(this._tempVec1).multiplyScalar(bounceStrength);
      }

      // Also dampen altitude velocity slightly during collision
      player.altitudeVelocity *= 0.7;
    }
  }
}