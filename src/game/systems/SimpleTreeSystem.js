import * as THREE from "three";
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';

/**
 * SimpleTreeSystem - Loads and spawns GLTF tree models
 * Much simpler than the instanced rendering system
 */
export class SimpleTreeSystem extends System {
  constructor(engine) {
    super(engine, 'simpleTrees');
    this.requireDependencies(['world']);
    this.scene = engine.scene;
    this.worldSystem = engine.systems.world;
    this.assetManager = engine.assets;

    // Tree collections
    this.treeModels = []; // Loaded GLTF models
    this.spawnedTrees = []; // Trees in the scene
    this.chunksWithTrees = new Set();

    // Configuration - tuned for cozy forest feel
    this.treeDensity = 0.08; // Probability of tree per attempt (increased for lush forests)
    this.attemptsPerChunk = 50; // How many tries per chunk (more attempts = more trees)
    this.minTreeDistance = 18; // Min distance between trees (slightly closer)
    this.maxTreesPerChunk = 25; // Limit trees per chunk (increased for lusher world)

    // Model paths - Kenney Nature Kit trees (CC0 License)
    this.modelPaths = [
      '/assets/models/pine_tree.glb',
      '/assets/models/oak_tree.glb',
      '/assets/models/default_tree.glb',
      '/assets/models/palm_tree.glb',
      '/assets/models/detailed_tree.glb',
      '/assets/models/fat_tree.glb',
    ];

    // Fallback to procedural if no models
    this.useProcedural = false;

    // Diagnostic flags
    this._loggedFirstUpdate = false;
  }

  async _initialize() {
    Logger.info("🌲 Initializing Simple Tree System...");

    // Try to load tree models
    if (this.modelPaths.length > 0) {
      await this.loadTreeModels();
    }

    // If no models loaded, use procedural fallback
    if (this.treeModels.length === 0) {
      Logger.warn("No tree models found, using procedural fallback");
      this.useProcedural = true;
      this.createProceduralTreeModels();
    }

    Logger.info(`Simple Tree System initialized with ${this.treeModels.length} tree types`);
  }

  /**
   * Load tree models from GLTF files
   */
  async loadTreeModels() {
    Logger.info(`Attempting to load ${this.modelPaths.length} tree models...`);
    const loadPromises = this.modelPaths.map(async (path) => {
      try {
        return new Promise((resolve, reject) => {
          this.assetManager.gltfLoader.load(
            path,
            (gltf) => {
              Logger.info(`✅ Successfully loaded tree model: ${path}`);
              // Make sure materials are visible
              gltf.scene.traverse((node) => {
                if (node.isMesh) {
                  node.castShadow = true;
                  node.receiveShadow = true;
                  if (node.material) {
                    node.material.needsUpdate = true;
                  }
                }
              });
              resolve(gltf.scene);
            },
            (progress) => {
              // Optional: log progress
            },
            (error) => {
              Logger.error(`❌ Failed to load tree model ${path}:`, error);
              resolve(null);
            }
          );
        });
      } catch (error) {
        Logger.error(`❌ Error loading tree model ${path}:`, error);
        return null;
      }
    });

    const loadedModels = await Promise.all(loadPromises);
    this.treeModels = loadedModels.filter(model => model !== null);
    Logger.info(`Loaded ${this.treeModels.length} out of ${this.modelPaths.length} tree models`);
  }

  /**
   * Create simple procedural tree models as fallback
   */
  createProceduralTreeModels() {
    // Simple pine tree
    const pine = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.5, 4, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a2f1a })
    );
    trunk.position.y = 2;
    trunk.castShadow = true;

    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(2, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0x2d5016 })
    );
    leaves.position.y = 5;
    leaves.castShadow = true;

    pine.add(trunk);
    pine.add(leaves);
    this.treeModels.push(pine);

    // Simple round tree
    const round = new THREE.Group();
    const trunk2 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.4, 3, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a2f1a })
    );
    trunk2.position.y = 1.5;
    trunk2.castShadow = true;

    const leaves2 = new THREE.Mesh(
      new THREE.SphereGeometry(2, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a7a1a })
    );
    leaves2.position.y = 4;
    leaves2.castShadow = true;

    round.add(trunk2);
    round.add(leaves2);
    this.treeModels.push(round);

    Logger.info("Created 2 procedural tree models");
  }

  /**
   * Update - spawn trees for visible chunks
   */
  _update(delta) {
    const playerSystem = this.engine.systems.get('player');
    if (!playerSystem || !playerSystem.localPlayer) {
      return; // Silently skip until player is ready
    }

    const player = playerSystem.localPlayer;

    // Log first successful update
    if (!this._loggedFirstUpdate) {
      Logger.info(`🌲 Tree system starting - Player at (${player.position.x.toFixed(0)}, ${player.position.z.toFixed(0)})`);
      this._loggedFirstUpdate = true;
    }

    const chunkSize = this.worldSystem.chunkSize;
    const playerChunkX = Math.floor(player.position.x / chunkSize);
    const playerChunkZ = Math.floor(player.position.z / chunkSize);
    const viewDistance = 3; // Spawn trees within 3 chunks

    // Spawn trees for nearby chunks
    for (let x = -viewDistance; x <= viewDistance; x++) {
      for (let z = -viewDistance; z <= viewDistance; z++) {
        const chunkX = playerChunkX + x;
        const chunkZ = playerChunkZ + z;
        const chunkKey = `${chunkX},${chunkZ}`;

        if (!this.chunksWithTrees.has(chunkKey)) {
          this.spawnTreesForChunk(chunkX, chunkZ);
          this.chunksWithTrees.add(chunkKey);
        }
      }
    }
  }

  /**
   * Spawn trees for a chunk
   */
  spawnTreesForChunk(chunkX, chunkZ) {
    if (this.treeModels.length === 0) {
      if (this.chunksWithTrees.size === 0) {
        Logger.warn("No tree models loaded! Falling back to procedural...");
      }
      return;
    }

    const chunkSize = this.worldSystem.chunkSize;
    const minX = chunkX * chunkSize;
    const minZ = chunkZ * chunkSize;

    let treesSpawned = 0;
    let rejectedReasons = { water: 0, tooHigh: 0, steep: 0, tooClose: 0, density: 0 };

    for (let i = 0; i < this.attemptsPerChunk && treesSpawned < this.maxTreesPerChunk; i++) {
      // Random position in chunk
      const x = minX + Math.random() * chunkSize;
      const z = minZ + Math.random() * chunkSize;

      // Get terrain height
      const height = this.worldSystem.getTerrainHeight(x, z);

      // Basic checks - MUCH more permissive height range
      if (height < 5) { rejectedReasons.water++; continue; } // Not underwater
      if (height > 300) { rejectedReasons.tooHigh++; continue; } // Not on extreme peaks

      const slope = this.worldSystem.calculateSlope(x, z);
      if (slope > 0.6) { rejectedReasons.steep++; continue; } // Slightly less restrictive

      // Check distance to nearby trees
      if (!this.isValidTreePosition(x, z)) { rejectedReasons.tooClose++; continue; }

      // Random chance
      if (Math.random() > this.treeDensity) { rejectedReasons.density++; continue; }

      // Spawn tree!
      this.spawnTree(x, height, z);
      treesSpawned++;
    }

    // Only log first few successful chunks
    if (treesSpawned > 0 && this.chunksWithTrees.size <= 3) {
      Logger.info(`🌲 Spawned ${treesSpawned} trees in chunk ${chunkX},${chunkZ}`);
    }
  }

  /**
   * Check if position is valid for tree (not too close to others)
   */
  isValidTreePosition(x, z) {
    // Only check recent trees for performance (same optimization as before)
    const checkStart = Math.max(0, this.spawnedTrees.length - 50);
    for (let i = checkStart; i < this.spawnedTrees.length; i++) {
      const tree = this.spawnedTrees[i];
      const dx = tree.position.x - x;
      const dz = tree.position.z - z;
      const distSq = dx * dx + dz * dz;

      if (distSq < this.minTreeDistance * this.minTreeDistance) {
        return false;
      }
    }
    return true;
  }

  /**
   * Spawn a single tree
   */
  spawnTree(x, y, z) {
    // Pick random tree model
    const modelIndex = Math.floor(Math.random() * this.treeModels.length);
    const originalModel = this.treeModels[modelIndex];

    // Clone the model (deep clone with materials)
    const tree = originalModel.clone(true);

    // Position
    tree.position.set(x, y, z);

    // Random rotation
    tree.rotation.y = Math.random() * Math.PI * 2;

    // MUCH larger scale - Kenney models are small!
    // Scale up 15-25x to be visible in the world
    const scale = 15 + Math.random() * 10;
    tree.scale.set(scale, scale, scale);

    // Ensure all meshes are visible
    tree.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.visible = true;
      }
    });

    // Add to scene
    this.scene.add(tree);
    this.spawnedTrees.push(tree);

    // Log only first tree for debugging
    if (this.spawnedTrees.length === 1) {
      Logger.info(`🌲 First tree spawned at (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}) with scale ${scale.toFixed(1)}`);
    }
  }

  /**
   * Clean up
   */
  _destroy() {
    // Remove all trees
    for (const tree of this.spawnedTrees) {
      this.scene.remove(tree);
    }
    this.spawnedTrees = [];
    this.chunksWithTrees.clear();
    Logger.info("Simple Tree System destroyed");
  }
}
