import * as THREE from "three";
import { Logger } from '../../utils/Logger.js';
import { System } from '../core/System.js';

export class LandmarkSystem extends System {
  constructor(engine) {
    super(engine, 'landmarks');
    this.scene = engine.scene;
    this.worldSystem = null; // Will be set later when available
    
    // Landmarks configuration
    this.landmarks = new Map();
    this.landmarkTypes = [
      {
        name: "ancient_ruins",
        minHeight: 5,          // Lowered min height
        maxHeight: 100,        // Increased max height
        minDistance: 800,      // Reduced minimum distance
        maxSlope: 0.3,         // Increased allowed slope
        frequency: 0.00002,     // 2x higher frequency
        size: { min: 200, max: 400 },
        requiresWater: false
      },
      {
        name: "magical_circle",
        minHeight: 0,          // Lowered min height
        maxHeight: 120,        // Increased max height
        minDistance: 600,      // Reduced minimum distance
        maxSlope: 0.4,         // Increased allowed slope
        frequency: 0.0004,     // 20x higher frequency
        size: { min: 60, max: 120 },
        requiresWater: false
      },
      {
        name: "crystal_formation",
        minHeight: 20,          // Lowered min height
        maxHeight: 150,         // Increased max height
        minDistance: 900,       // Reduced minimum distance
        maxSlope: 0.8,          // Increased allowed slope
        frequency: 0.0003,      // 20x higher frequency
        size: { min: 80, max: 160 },
        requiresWater: false
      }
    ];
    
    // Materials
    this.materials = {
      stone: new THREE.MeshStandardMaterial({
        color: 0x999999,
        roughness: 0.8,
        metalness: 0.1
      }),
      ruinedStone: new THREE.MeshStandardMaterial({
        color: 0x777777,
        roughness: 0.9,
        metalness: 0.05
      }),
      crystal: new THREE.MeshStandardMaterial({
        color: 0x8866ff,
        emissive: 0x6644aa,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.9,
        roughness: 0.2,
        metalness: 0.8
      }),
      magicCircle: new THREE.MeshStandardMaterial({
        color: 0xcc66ff,
        emissive: 0xcc66ff,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.7
      })
    };

    // Beacon light-pillars so landmarks are visible from afar
    // One shared geometry + one shared material per type (1 draw call per landmark)
    this.beaconColors = {
      ancient_ruins: 0xffcc66,
      magical_circle: 0xcc66ff,
      crystal_formation: 0x66ffee
    };
    this.beaconGeometry = new THREE.CylinderGeometry(2.5, 4, 300, 8, 1, true);
    this.beaconMaterials = {};
    for (const [typeName, color] of Object.entries(this.beaconColors)) {
      this.beaconMaterials[typeName] = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false // Keep beacons visible at distance despite scene fog
      });
    }
  }

  async _initialize() {
    Logger.info('LandmarkSystem._initialize: Initializing landmark materials and configuration');
    Logger.info('LandmarkSystem: Landmark types configured:', this.landmarkTypes.map(t => t.name));
    // Materials already created in constructor, no additional initialization needed
    // Will start generating landmarks in update loop
  }

  _update(delta, elapsed) {
    // Check for new landmark locations
    this.checkForLandmarkLocations();

    // Animate landmarks
    this.animateLandmarks(elapsed);

    // Remove landmarks that are too far from player
    const player = this.engine.systems.player?.localPlayer;
    if (player && player.position && this.worldSystem) {
      // Validate player position
      if (isNaN(player.position.x) || isNaN(player.position.z)) {
        return; // Skip if player position is invalid
      }

      const maxDistance = this.worldSystem.chunkSize * (this.worldSystem.viewDistance + 4);

      for (const [id, landmark] of this.landmarks.entries()) {
        // Skip landmarks with invalid positions
        if (!landmark.position || isNaN(landmark.position.x) || isNaN(landmark.position.z)) {
          // Clean up invalid landmark
          if (landmark.mesh) this.scene.remove(landmark.mesh);
          this.landmarks.delete(id);
          continue;
        }

        const dx = landmark.position.x - player.position.x;
        const dz = landmark.position.z - player.position.z;
        const distanceSquared = dx * dx + dz * dz;

        if (distanceSquared > maxDistance * maxDistance) {
          // Remove landmark from scene
          this.scene.remove(landmark.mesh);
          this.landmarks.delete(id);
        }
      }
    }
  }


  /**
   * Check if a position is suitable for a landmark
   * @param {number} x - X coordinate
   * @param {number} z - Z coordinate
   * @param {Object} landmarkType - Landmark type configuration
   * @returns {boolean} True if position is suitable
   */
  isPositionSuitableForLandmark(x, z, landmarkType) {
    // Ensure worldSystem is available
    if (!this.worldSystem) {
      this.worldSystem = this.engine.systems.world || this.engine.systemManager.get('world');
      if (!this.worldSystem) return false;
    }
    
    // Check terrain height constraints
    const height = this.worldSystem.getTerrainHeight(x, z);
    if (height < landmarkType.minHeight || height > landmarkType.maxHeight) {
      // console.log(`[LandmarkSystem] Height check failed: ${height} not in range ${landmarkType.minHeight}-${landmarkType.maxHeight}`);
      return false;
    }
    
    // Check slope constraints
    const slope = this.worldSystem.calculateSlope(x, z);
    if (slope > landmarkType.maxSlope) {
      // console.log(`[LandmarkSystem] Slope check failed: ${slope} > ${landmarkType.maxSlope}`);
      return false;
    }
    
    // Check distance from other landmarks of same type
    for (const [key, landmark] of this.landmarks.entries()) {
      if (landmark.type === landmarkType.name) {
        const dx = landmark.position.x - x;
        const dz = landmark.position.z - z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance < landmarkType.minDistance) {
          return false;
        }
      }
    }
    
    // Check water requirement
    if (landmarkType.requiresWater) {
      let hasWaterNearby = false;
      
      // Sample several points around the position looking for water
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const checkDist = 50; // Check 50 units away
        const checkX = x + Math.cos(angle) * checkDist;
        const checkZ = z + Math.sin(angle) * checkDist;
        const checkHeight = this.worldSystem.getTerrainHeight(checkX, checkZ);
        
        if (checkHeight < (this.worldSystem.waterLevel ?? 0)) {
          hasWaterNearby = true;
          break;
        }
      }
      
      if (!hasWaterNearby) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Creates a procedural landmark at a position
   * @param {number} x - X coordinate
   * @param {number} z - Z coordinate
   * @param {Object} landmarkType - Landmark type configuration
   * @returns {THREE.Group} The landmark mesh group
   */
  createLandmark(x, z, landmarkType) {
    try {
      // Validate coordinates
      if (x === undefined || isNaN(x) || z === undefined || isNaN(z)) {
        Logger.warn('Invalid coordinates for landmark:', x, z);
        return null;
      }
      
      // Ensure worldSystem is available
      if (!this.worldSystem) {
        this.worldSystem = this.engine.systems.world || this.engine.systemManager.get('world');
        if (!this.worldSystem) return null;
      }
      
      // Validate terrain height
      let height;
      try {
        height = this.worldSystem.getTerrainHeight(x, z);
        if (isNaN(height)) {
          Logger.warn('Invalid terrain height for landmark at', x, z);
          return null;
        }
      } catch (error) {
        Logger.warn('Error getting terrain height:', error);
        return null;
      }
      
      const y = height;
      
      // Create landmark group
      const landmarkGroup = new THREE.Group();
      landmarkGroup.position.set(x, y, z);
      
      // Determine size (with some randomness)
      const sizeRange = landmarkType.size.max - landmarkType.size.min;
      const size = landmarkType.size.min + Math.random() * sizeRange;
      
      // Create different landmark types
      switch (landmarkType.name) {
        case "ancient_ruins":
          this.createAncientRuins(landmarkGroup, size);
          break;
        case "magical_circle":
          this.createMagicalCircle(landmarkGroup, size);
          break;
        case "crystal_formation":
          this.createCrystalFormation(landmarkGroup, size);
          break;
        default:
          Logger.warn('Unknown landmark type:', landmarkType.name);
          return null;
      }

      // Add a tall light-pillar beacon so the landmark can be spotted from afar
      const beacon = this.createBeacon(landmarkType.name);
      landmarkGroup.add(beacon);

      // Save landmark with unique ID
      const landmarkId = `${landmarkType.name}_${this.landmarks.size}`;
      this.landmarks.set(landmarkId, {
        id: landmarkId,
        type: landmarkType.name,
        position: new THREE.Vector3(x, y, z),
        size: size,
        mesh: landmarkGroup,
        beacon: beacon,
        beaconPhase: Math.random() * Math.PI * 2
      });
      
      // Add to scene
      this.scene.add(landmarkGroup);
      
      return landmarkGroup;
    } catch (error) {
      Logger.error('Error creating landmark:', error);
      return null;
    }
  }
  
  /**
   * Creates a vertical light-pillar beacon marking a landmark from afar
   * @param {string} typeName - Landmark type name (selects beacon color)
   * @returns {THREE.Mesh} The beacon mesh
   */
  createBeacon(typeName) {
    const material = this.beaconMaterials[typeName] || this.beaconMaterials.ancient_ruins;
    const beacon = new THREE.Mesh(this.beaconGeometry, material);
    beacon.position.y = 150; // Pillar reaches ~300 units above the terrain
    return beacon;
  }

  /**
   * Creates ancient ruins landmark
   * @param {THREE.Group} group - Parent group
   * @param {number} size - Size of the landmark
   */
  createAncientRuins(group, size) {
    // Create circular arrangement of broken columns
    const columnCount = Math.floor(5 + size / 8);
    const radius = size * 0.5;
    
    for (let i = 0; i < columnCount; i++) {
      const angle = (i / columnCount) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      
      // Random column height (some broken)
      const height = size * 0.3 * (0.3 + Math.random() * 0.7);
      const isIntact = Math.random() > 0.6;
      
      // Create column
      const columnGeometry = new THREE.CylinderGeometry(
        size * 0.05, size * 0.06, height, 8
      );
      const column = new THREE.Mesh(
        columnGeometry,
        isIntact ? this.materials.stone : this.materials.ruinedStone
      );
      
      column.position.set(x, height * 0.5, z);
      column.castShadow = true;
      column.receiveShadow = true;
      
      // Add some randomness to rotation
      column.rotation.y = Math.random() * 0.2;
      
      // If broken, tilt the column
      if (!isIntact) {
        const tiltAmount = Math.random() * 0.3;
        const tiltDirection = Math.random() * Math.PI * 2;
        column.rotation.x = Math.cos(tiltDirection) * tiltAmount;
        column.rotation.z = Math.sin(tiltDirection) * tiltAmount;
      }
      
      group.add(column);
      
      // Add broken pieces around some columns
      if (Math.random() > 0.5) {
        const pieceCount = Math.floor(Math.random() * 3) + 1;
        
        for (let j = 0; j < pieceCount; j++) {
          const pieceSize = size * 0.03 + Math.random() * size * 0.03;
          const pieceGeometry = new THREE.BoxGeometry(
            pieceSize, pieceSize, pieceSize
          );
          const piece = new THREE.Mesh(pieceGeometry, this.materials.ruinedStone);
          
          // Position relative to column
          const distance = size * 0.1 * Math.random();
          const pieceAngle = Math.random() * Math.PI * 2;
          piece.position.set(
            x + Math.cos(pieceAngle) * distance,
            pieceSize * 0.5, // Half height
            z + Math.sin(pieceAngle) * distance
          );
          
          // Random rotation
          piece.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
          );
          
          piece.castShadow = true;
          piece.receiveShadow = true;
          group.add(piece);
        }
      }
    }
    
    // Add central platform or altar
    const platformGeometry = new THREE.CylinderGeometry(
      size * 0.3,
      size * 0.35,
      size * 0.1,
      16
    );
    const platform = new THREE.Mesh(platformGeometry, this.materials.stone);
    platform.position.y = size * 0.05;
    platform.castShadow = true;
    platform.receiveShadow = true;
    group.add(platform);
    
    // Add decorative patterns to the platform
    const patternGeometry = new THREE.RingGeometry(
      size * 0.15,
      size * 0.25,
      16
    );
    patternGeometry.rotateX(-Math.PI / 2);
    const patternMaterial = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.7
    });
    const pattern = new THREE.Mesh(patternGeometry, patternMaterial);
    pattern.position.y = size * 0.1 + 0.01; // Slightly above platform
    group.add(pattern);
  }
  
  /**
   * Creates magical circle landmark
   * @param {THREE.Group} group - Parent group
   * @param {number} size - Size of the landmark
   */
  createMagicalCircle(group, size) {
    // Create circular platform
    const platformGeometry = new THREE.CylinderGeometry(
      size * 0.5,
      size * 0.5,
      size * 0.05,
      32
    );
    const platformMaterial = new THREE.MeshStandardMaterial({
      color: 0xddccff,
      emissive: 0x5522aa,
      emissiveIntensity: 0.25,
      roughness: 0.3,
      metalness: 0.5
    });
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.y = size * 0.025;
    platform.receiveShadow = true;
    group.add(platform);
    
    // Create magical runes and circles
    for (let i = 0; i < 3; i++) {
      const radius = size * 0.2 * (i + 1) / 3;
      
      const circleGeometry = new THREE.RingGeometry(
        radius - size * 0.01,
        radius,
        32
      );
      circleGeometry.rotateX(-Math.PI / 2);
      
      const circle = new THREE.Mesh(circleGeometry, this.materials.magicCircle);
      circle.position.y = size * 0.051 + i * 0.002; // Slightly above platform
      circle.userData.isGlowing = true;
      group.add(circle);
    }
    
    // Add pillars around the circle
    // Emissive tint so pillars read against sand/grass at distance
    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0xbbaaee,
      emissive: 0x6633aa,
      emissiveIntensity: 0.35,
      roughness: 0.7
    });
    const pillarCount = 5;
    for (let i = 0; i < pillarCount; i++) {
      const angle = (i / pillarCount) * Math.PI * 2;
      const x = Math.cos(angle) * size * 0.4;
      const z = Math.sin(angle) * size * 0.4;

      const pillarGeometry = new THREE.CylinderGeometry(
        size * 0.03,
        size * 0.03,
        size * 0.4,
        8
      );
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      
      pillar.position.set(x, size * 0.2, z);
      pillar.castShadow = true;
      group.add(pillar);
      
      // Add glowing crystal on top of each pillar
      const crystalGeometry = new THREE.OctahedronGeometry(size * 0.05);
      const crystal = new THREE.Mesh(crystalGeometry, this.materials.crystal.clone());
      crystal.material.color.set(0xcc66ff);
      crystal.material.emissive.set(0xcc66ff);
      
      crystal.position.set(x, size * 0.4 + size * 0.05, z);
      crystal.castShadow = true;
      crystal.userData.isGlowing = true;
      crystal.userData.originalIntensity = 0.7;
      group.add(crystal);
    }
  }
  
  /**
   * Creates crystal formation landmark
   * @param {THREE.Group} group - Parent group
   * @param {number} size - Size of the landmark
   */
  createCrystalFormation(group, size) {
    // Choose main color theme for this formation
    const colors = [
      new THREE.Color(0x8866ff), // Purple
      new THREE.Color(0x66aaff), // Blue
      new THREE.Color(0xff66aa), // Pink
      new THREE.Color(0x66ffaa)  // Green
    ];
    const mainColor = colors[Math.floor(Math.random() * colors.length)];
    
    // Create base rock formation
    const baseGeometry = new THREE.DodecahedronGeometry(size * 0.3);
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.9,
      metalness: 0.1
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    
    // Distort the base geometry for more natural look
    const basePositions = baseGeometry.attributes.position;
    for (let i = 0; i < basePositions.count; i++) {
      const x = basePositions.getX(i);
      const y = basePositions.getY(i);
      const z = basePositions.getZ(i);
      
      const distortAmount = size * 0.05;
      const noise = Math.random() * distortAmount;
      
      basePositions.setXYZ(
        i,
        x + (Math.random() - 0.5) * noise,
        y + (Math.random() - 0.5) * noise,
        z + (Math.random() - 0.5) * noise
      );
    }
    
    baseGeometry.computeVertexNormals();
    base.position.y = size * 0.2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);
    
    // Add crystal clusters (divisor tuned for size 80-160 to keep mesh count low)
    const crystalCount = Math.floor(size / 16) + 5;
    for (let i = 0; i < crystalCount; i++) {
      // Vary crystal properties
      const crystalSize = size * (0.05 + Math.random() * 0.1);
      const crystalType = Math.floor(Math.random() * 3);
      
      // Choose geometry based on type
      let crystalGeometry;
      if (crystalType === 0) {
        crystalGeometry = new THREE.ConeGeometry(
          crystalSize * 0.4,
          crystalSize * 2,
          6
        );
      } else if (crystalType === 1) {
        crystalGeometry = new THREE.OctahedronGeometry(crystalSize);
      } else {
        crystalGeometry = new THREE.TetrahedronGeometry(crystalSize);
      }
      
      // Slightly vary crystal color from main theme
      const crystalColor = mainColor.clone();
      
      const crystalMaterial = this.materials.crystal.clone();
      crystalMaterial.color = crystalColor;
      crystalMaterial.emissive = crystalColor.clone().multiplyScalar(0.8);
      
      const crystal = new THREE.Mesh(crystalGeometry, crystalMaterial);
      
      // Position crystal on base rock
      const angle = Math.random() * Math.PI * 2;
      const distance = size * 0.3 * Math.random();
      const height = size * 0.2 + size * 0.1 * Math.random();
      
      crystal.position.set(
        Math.cos(angle) * distance,
        height,
        Math.sin(angle) * distance
      );
      
      // Random rotation
      crystal.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      
      crystal.castShadow = true;
      crystal.userData.isGlowing = true;
      crystal.userData.originalIntensity = 0.7;
      crystal.userData.pulseRate = 0.5 + Math.random();
      group.add(crystal);
    }
  }
  
  /**
   * Check for potential landmark locations in loaded chunks
   * Should be called periodically during gameplay
   */
  checkForLandmarkLocations() {
    try {
      // Try to get player from PlayerSystem first, then playerState
      let player = this.engine.systems.player?.localPlayer;
      if (!player) {
        const playerState = this.engine.systemManager.get('playerState');
        player = playerState?.localPlayer;
      }
      
      if (!player) {
        Logger.warn("[LandmarkSystem] No player found in either PlayerSystem or playerState");
        return;
      }
      
      // Check if player position is valid
      if (!player.position || isNaN(player.position.x) || isNaN(player.position.z)) {
        // console.log("[LandmarkSystem] Invalid player position");
        return; // Skip this update if player position is invalid
      }
      
      // Get worldSystem dynamically
      if (!this.worldSystem) {
        this.worldSystem = this.engine.systems.world || this.engine.systemManager.get('world');
      }
      
      // Check if worldSystem is ready
      if (!this.worldSystem || !this.worldSystem.chunkSize || !this.worldSystem.viewDistance) {
        Logger.warn("[LandmarkSystem] WorldSystem not ready:", !!this.worldSystem, this.worldSystem?.chunkSize, this.worldSystem?.viewDistance);
        return; // Skip if worldSystem is not properly initialized
      }
      
      // Check more frequently for landmarks
      if (Math.random() > 0.05) return; // 5% chance per call (increased from 1%)

      // Get player chunk
      const playerChunkX = Math.floor(player.position.x / this.worldSystem.chunkSize);
      const playerChunkZ = Math.floor(player.position.z / this.worldSystem.chunkSize);
      
      // Check a larger area around player
      const checkDistance = this.worldSystem.viewDistance + 2;
      
      // Try several random locations
      const attemptCount = 5;
      
      for (let i = 0; i < attemptCount; i++) {
        // Pick random chunk in range
        const dx = Math.floor(Math.random() * checkDistance * 2) - checkDistance;
        const dz = Math.floor(Math.random() * checkDistance * 2) - checkDistance;
        
        const chunkX = playerChunkX + dx;
        const chunkZ = playerChunkZ + dz;
        
        // Convert to world coordinates
        const worldX = chunkX * this.worldSystem.chunkSize + Math.random() * this.worldSystem.chunkSize;
        const worldZ = chunkZ * this.worldSystem.chunkSize + Math.random() * this.worldSystem.chunkSize;
        
        // Validate coordinates
        if (isNaN(worldX) || isNaN(worldZ)) {
          continue; // Skip this attempt if coordinates are invalid
        }
        
        // Use global frequency check - increased chance
        if (Math.random() > 0.4) continue; // Consider 40% of attempts (increased from 20%)
        
        // Try each landmark type
        for (const landmarkType of this.landmarkTypes) {
          // Check if this type should spawn based on frequency
          if (Math.random() > landmarkType.frequency * 1000) continue;
          
          // Check if location is suitable
          if (this.isPositionSuitableForLandmark(worldX, worldZ, landmarkType)) {
            Logger.info(`[LandmarkSystem] Creating ${landmarkType.name} landmark at ${worldX.toFixed(2)}, ${worldZ.toFixed(2)}`);
            const landmark = this.createLandmark(worldX, worldZ, landmarkType);
            if (landmark) {
              Logger.info(`[LandmarkSystem] Successfully created landmark, total count: ${this.landmarks.size}`);
            } else {
              Logger.warn(`[LandmarkSystem] Failed to create landmark`);
            }
            return; // Only create one landmark at a time
          }
        }
      }
    } catch (error) {
      Logger.error('Error checking for landmark locations:', error);
    }
  }
  
  /**
   * Animate landmark elements
   * @param {number} elapsed - Total elapsed time
   */
  animateLandmarks(elapsed) {
    // Apply animations to landmark elements
    for (const [id, landmark] of this.landmarks.entries()) {
      const landmarkMesh = landmark.mesh;

      // Skip if not in scene or invalid
      if (!landmarkMesh || !landmarkMesh.parent) continue;

      // Slow beacon pulse (scale only - beacon materials are shared per type)
      if (landmark.beacon) {
        const pulse = 0.85 + 0.15 * Math.sin(elapsed * 0.8 + landmark.beaconPhase);
        landmark.beacon.scale.set(pulse, 1, pulse);
      }

      // Animate any glowing objects
      landmarkMesh.traverse(object => {
        if (object.userData && object.userData.isGlowing) {
          // Pulsing glow effect
          const pulseRate = object.userData.pulseRate || 1.0;
          const intensity = object.userData.originalIntensity || 0.5;
          
          const newIntensity = intensity * (0.7 + Math.sin(elapsed * pulseRate) * 0.3);
          if (object.material && object.material.emissiveIntensity !== undefined) {
            object.material.emissiveIntensity = newIntensity;
          }
        }
      });
    }
  }

  /**
   * Handle visibility change event
   */
  handleVisibilityChange(isVisible) {
    if (isVisible) {
      // Clean up landmarks when tab becomes visible again
      // This will allow proper landmark generation on next update
      this.cleanupInvalidLandmarks();
    }
  }
  
  /**
   * Clean up any invalid landmarks
   */
  cleanupInvalidLandmarks() {
    for (const [id, landmark] of this.landmarks.entries()) {
      // Check if position is valid
      const position = landmark.position;
      if (!position || isNaN(position.x) || isNaN(position.y) || isNaN(position.z)) {
        Logger.debug(`Removing invalid landmark: ${id}`);
        
        // Remove from scene
        if (landmark.mesh) {
          this.scene.remove(landmark.mesh);
        }
        
        // Remove from collection
        this.landmarks.delete(id);
      }
    }
  }
}