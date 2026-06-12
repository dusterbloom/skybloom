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
    this.worldSystem = null; // Will be set during initialization
    this.assetManager = engine.assets;

    // Tree collections
    this.treeModels = []; // Loaded GLTF models
    this.spawnedTrees = []; // Flat list of live trees (PlayerPhysics iterates this every frame)
    // chunkKey -> { x, z, trees: [] }. A Map keeps .has()/.size/.clear() compatible
    // with the old Set usage while letting us despawn trees per chunk.
    this.chunksWithTrees = new Map();

    // Configuration - tuned for forest clustering
    this.clustersPerChunk = 3; // Number of forest clusters per chunk
    this.treesPerCluster = 15; // Average trees per cluster (will vary)
    this.clusterRadius = 40; // How spread out each cluster is
    this.minTreeDistance = 4; // Min distance between trees in cluster (tight)
    this.scatteredTreeDensity = 0.15; // Probability for scattered individual trees
    this.scatteredTreeAttempts = 30; // Attempts for scattered trees
    this.maxTreesPerChunk = 80; // Limit trees per chunk

    // Lifecycle configuration (despawn / cap / fade) - spawn density above is unchanged
    this.viewDistance = 3; // Spawn trees within this many chunks of the player
    this.keepDistance = this.viewDistance + 1; // Despawn chunks beyond this (hysteresis ring)
    this.maxTotalTrees = 1200; // Global safety cap; farthest chunks evicted first when exceeded
    this.treeFadeDistance = 1800; // Hide trees beyond this horizontal distance (fog softens the cutoff)

    // Last player chunk - despawn/cap checks only need to run when this changes
    this._lastPlayerChunkX = null;
    this._lastPlayerChunkZ = null;

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

    // Get world system reference (after dependencies are initialized)
    this.worldSystem = this.engine.systems.get('world');
    if (!this.worldSystem) {
      Logger.error("SimpleTreeSystem: World system not found!");
      return;
    }

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
    const viewDistance = this.viewDistance; // Spawn trees within 3 chunks

    // Spawn trees for nearby chunks (each chunk spawns once while it stays in range)
    for (let x = -viewDistance; x <= viewDistance; x++) {
      for (let z = -viewDistance; z <= viewDistance; z++) {
        const chunkX = playerChunkX + x;
        const chunkZ = playerChunkZ + z;
        const chunkKey = `${chunkX},${chunkZ}`;

        if (!this.chunksWithTrees.has(chunkKey)) {
          const trees = this.spawnTreesForChunk(chunkX, chunkZ);
          this.chunksWithTrees.set(chunkKey, { x: chunkX, z: chunkZ, trees });
        }
      }
    }

    // Despawn far chunks / enforce the global cap only when the player crosses a
    // chunk boundary - chunk distances cannot change otherwise.
    if (playerChunkX !== this._lastPlayerChunkX || playerChunkZ !== this._lastPlayerChunkZ) {
      this._lastPlayerChunkX = playerChunkX;
      this._lastPlayerChunkZ = playerChunkZ;
      this.despawnDistantChunks(playerChunkX, playerChunkZ, player);
    }

    // Cheap distance fade every tick (despawn above is the hard bound)
    this.updateTreeVisibility(player);
  }

  /**
   * Despawn chunks that fell out of range and enforce the global tree cap.
   * NOTE: cloned trees share geometry/materials with the source models in
   * this.treeModels, so we only scene.remove() and drop references - never
   * dispose() a clone's resources.
   */
  despawnDistantChunks(playerChunkX, playerChunkZ, player) {
    let liveCount = this.spawnedTrees.length;
    let removedAny = false;

    // 1) Remove chunks outside the keep ring (viewDistance + 1, Chebyshev to
    // match the square spawn grid). Deleting the entry lets the area respawn
    // if the player comes back.
    for (const [chunkKey, entry] of this.chunksWithTrees) {
      if (Math.abs(entry.x - playerChunkX) > this.keepDistance ||
          Math.abs(entry.z - playerChunkZ) > this.keepDistance) {
        liveCount -= entry.trees.length;
        this.removeChunkTrees(chunkKey, entry);
        removedAny = true;
      }
    }

    // 2) Global safety cap: evict farthest chunks first (by chunk-center
    // distance to the player). Only chunks outside the spawn window are
    // evictable - evicting one inside it would just respawn next frame
    // (churn) and punch visible holes around the player.
    if (liveCount > this.maxTotalTrees) {
      const chunkSize = this.worldSystem.chunkSize;
      const px = player.position.x;
      const pz = player.position.z;
      const candidates = [];

      for (const [chunkKey, entry] of this.chunksWithTrees) {
        if (Math.abs(entry.x - playerChunkX) > this.viewDistance ||
            Math.abs(entry.z - playerChunkZ) > this.viewDistance) {
          const dx = (entry.x + 0.5) * chunkSize - px;
          const dz = (entry.z + 0.5) * chunkSize - pz;
          candidates.push({ chunkKey, entry, distSq: dx * dx + dz * dz });
        }
      }

      candidates.sort((a, b) => b.distSq - a.distSq); // Farthest first

      for (let i = 0; i < candidates.length && liveCount > this.maxTotalTrees; i++) {
        liveCount -= candidates[i].entry.trees.length;
        this.removeChunkTrees(candidates[i].chunkKey, candidates[i].entry);
        removedAny = true;
      }
    }

    // Keep the flat array PlayerPhysics iterates accurate and bounded
    if (removedAny) {
      this.rebuildSpawnedTrees();
    }
  }

  /**
   * Remove one chunk's trees from the scene and forget the chunk.
   * No geometry/material dispose: clones share GPU resources with this.treeModels.
   */
  removeChunkTrees(chunkKey, entry) {
    const trees = entry.trees;
    for (let i = 0; i < trees.length; i++) {
      this.scene.remove(trees[i]);
    }
    trees.length = 0;
    this.chunksWithTrees.delete(chunkKey);
  }

  /**
   * Rebuild this.spawnedTrees in place from the per-chunk lists, so any
   * external reader (PlayerPhysics collision loop) never sees a stale array.
   */
  rebuildSpawnedTrees() {
    const flat = this.spawnedTrees;
    flat.length = 0;
    for (const entry of this.chunksWithTrees.values()) {
      const trees = entry.trees;
      for (let i = 0; i < trees.length; i++) {
        flat.push(trees[i]);
      }
    }
  }

  /**
   * Distance fade: hide trees beyond treeFadeDistance (horizontal only).
   * Saves draw calls; scene fog (FogExp2) softens the cutoff. Allocation-free.
   */
  updateTreeVisibility(player) {
    const px = player.position.x;
    const pz = player.position.z;
    const fadeDistSq = this.treeFadeDistance * this.treeFadeDistance;
    const trees = this.spawnedTrees;
    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i];
      const dx = tree.position.x - px;
      const dz = tree.position.z - pz;
      tree.visible = (dx * dx + dz * dz) < fadeDistSq;
    }
  }

  /**
   * Spawn trees for a chunk using cluster-based generation.
   * Returns the array of tree groups spawned for this chunk (possibly empty).
   */
  spawnTreesForChunk(chunkX, chunkZ) {
    const chunkTrees = [];

    if (this.treeModels.length === 0) {
      if (this.chunksWithTrees.size === 0) {
        Logger.warn("No tree models loaded! Falling back to procedural...");
      }
      return chunkTrees;
    }

    const chunkSize = this.worldSystem.chunkSize;
    const minX = chunkX * chunkSize;
    const minZ = chunkZ * chunkSize;

    let treesSpawned = 0;

    // Generate forest clusters
    for (let c = 0; c < this.clustersPerChunk && treesSpawned < this.maxTreesPerChunk; c++) {
      // Random cluster center position in chunk
      const clusterCenterX = minX + Math.random() * chunkSize;
      const clusterCenterZ = minZ + Math.random() * chunkSize;
      const clusterCenterHeight = this.worldSystem.getTerrainHeight(clusterCenterX, clusterCenterZ);

      // Skip cluster if center is invalid (underwater or too high)
      if (clusterCenterHeight < 5 || clusterCenterHeight > 300) continue;

      const clusterSlope = this.worldSystem.calculateSlope(clusterCenterX, clusterCenterZ);
      if (clusterSlope > 0.6) continue;

      // Spawn trees around this cluster center
      const treesInThisCluster = Math.floor(this.treesPerCluster * (0.7 + Math.random() * 0.6)); // 70-130% variation

      for (let t = 0; t < treesInThisCluster && treesSpawned < this.maxTreesPerChunk; t++) {
        // Use exponential distribution for natural clustering (more trees near center)
        const distance = this.clusterRadius * Math.pow(Math.random(), 0.5);
        const angle = Math.random() * Math.PI * 2;

        const x = clusterCenterX + Math.cos(angle) * distance;
        const z = clusterCenterZ + Math.sin(angle) * distance;

        // Get terrain height at tree position
        const height = this.worldSystem.getTerrainHeight(x, z);

        // Basic validation
        if (height < 5 || height > 300) continue;

        const slope = this.worldSystem.calculateSlope(x, z);
        if (slope > 0.6) continue;

        // Check distance to nearby trees (reduced distance for clusters)
        if (!this.isValidTreePosition(x, z)) continue;

        // Spawn tree in cluster
        chunkTrees.push(this.spawnTree(x, height, z));
        treesSpawned++;
      }
    }

    // Add some scattered individual trees for variety
    for (let i = 0; i < this.scatteredTreeAttempts && treesSpawned < this.maxTreesPerChunk; i++) {
      // Random position in chunk
      const x = minX + Math.random() * chunkSize;
      const z = minZ + Math.random() * chunkSize;

      // Get terrain height
      const height = this.worldSystem.getTerrainHeight(x, z);

      // Basic checks
      if (height < 5 || height > 300) continue;

      const slope = this.worldSystem.calculateSlope(x, z);
      if (slope > 0.6) continue;

      // Check distance to nearby trees
      if (!this.isValidTreePosition(x, z)) continue;

      // Lower probability for scattered trees
      if (Math.random() > this.scatteredTreeDensity) continue;

      // Spawn scattered tree
      chunkTrees.push(this.spawnTree(x, height, z));
      treesSpawned++;
    }

    // Only log first few successful chunks
    if (treesSpawned > 0 && this.chunksWithTrees.size <= 3) {
      Logger.info(`🌲 Spawned ${treesSpawned} trees in chunk ${chunkX},${chunkZ} (cluster-based)`);
    }

    return chunkTrees;
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
   * Spawn a single tree. Returns the spawned tree group.
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

    // Scale to carpet-relative size (carpet is 5x8 units)
    const scale = 6 + Math.random() * 6; // 6-12 units tall
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

    return tree;
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
    this._lastPlayerChunkX = null;
    this._lastPlayerChunkZ = null;
    Logger.info("Simple Tree System destroyed");
  }
}
