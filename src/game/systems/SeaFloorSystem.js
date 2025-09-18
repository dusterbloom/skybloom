import * as THREE from "three";
import { System } from "../core/System.js";
import { Logger } from "../../utils/Logger.js";
import { createNoise2D } from "simplex-noise";

/**
 * Procedural Sea Floor System
 * Generates underwater terrain with realistic depth variations
 */
export class SeaFloorSystem extends System {
  constructor(engine) {
    super(engine, 'seaFloor');
    this.scene = engine.scene;
    this.camera = engine.camera;

    // Sea floor parameters
    this.chunkSize = 1024;
    this.terrainResolution = 64;
    this.viewDistance = 6;
    this.maxDepth = 500;
    this.minDepth = 50;

    // Terrain chunks
    this.chunks = new Map();
    this.visibleChunks = new Set();

    // Noise generator
    this.seed = Math.random() * 1000;
    this.noise = createNoise2D(() => this.seed);

    // Materials
    this.terrainMaterial = null;

    // Performance tracking
    this.lastUpdatePosition = new THREE.Vector3();
    this.updateThreshold = this.chunkSize * 0.5;
  }

  async _initialize() {
    Logger.info("🌊 Initializing Sea Floor System...");

    try {
      // Create terrain material
      this.createMaterials();

      // Generate initial sea floor
      this.generateInitialTerrain();

      Logger.info("🌊 Sea Floor System initialized successfully ✅");

    } catch (error) {
      Logger.error("Failed to initialize Sea Floor System:", error);
    }
  }

  createMaterials() {
    Logger.debug("Creating sea floor materials...");

    // Underwater terrain material
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0.1,
      transparent: true,
      opacity: 0.8,
      depthWrite: false // Prevent z-fighting with water
    });

    // Set polygon offset to render behind water
    this.terrainMaterial.polygonOffset = true;
    this.terrainMaterial.polygonOffsetFactor = -2;
    this.terrainMaterial.polygonOffsetUnits = -2;
  }

  generateInitialTerrain() {
    Logger.debug("Generating initial sea floor terrain...");

    // Generate chunks around origin
    for (let x = -this.viewDistance; x <= this.viewDistance; x++) {
      for (let z = -this.viewDistance; z <= this.viewDistance; z++) {
        const startX = x * this.chunkSize;
        const startZ = z * this.chunkSize;
        this.createChunk(startX, startZ);
      }
    }

    Logger.debug(`Generated ${this.chunks.size} sea floor chunks`);
  }

  createChunk(startX, startZ) {
    const key = `${startX},${startZ}`;

    if (this.chunks.has(key)) return;

    try {
      // Create geometry
      const geometry = new THREE.PlaneGeometry(
        this.chunkSize,
        this.chunkSize,
        this.terrainResolution,
        this.terrainResolution
      );

      // Rotate to horizontal
      geometry.rotateX(-Math.PI / 2);

      // Generate height map
      this.generateHeightMap(geometry, startX, startZ);

      // Create mesh
      const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
      mesh.position.set(startX, -this.maxDepth, startZ);
      mesh.castShadow = false;
      mesh.receiveShadow = false;

      // Add to scene and tracking
      this.scene.add(mesh);
      this.chunks.set(key, mesh);
      this.visibleChunks.add(key);

    } catch (error) {
      Logger.error(`Failed to create sea floor chunk at ${startX}, ${startZ}:`, error);
    }
  }

  generateHeightMap(geometry, startX, startZ) {
    const vertices = geometry.attributes.position.array;
    const colors = [];

    for (let i = 0; i < vertices.length; i += 3) {
      const localX = vertices[i];
      const localZ = vertices[i + 2];
      const worldX = localX + startX;
      const worldZ = localZ + startZ;

      // Generate depth using multiple noise layers
      const depth = this.generateDepth(worldX, worldZ);

      // Set vertex height (negative for underwater)
      vertices[i + 1] = -depth;

      // Generate color based on depth
      const color = this.getDepthColor(depth);
      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  generateDepth(x, z) {
    // Multiple octaves of noise for realistic terrain
    let depth = 0;
    let amplitude = 1;
    let frequency = 0.001;

    // Large scale features
    depth += this.noise(x * frequency, z * frequency) * amplitude * 200;
    amplitude *= 0.5;
    frequency *= 2;

    // Medium scale features
    depth += this.noise(x * frequency, z * frequency) * amplitude * 150;
    amplitude *= 0.5;
    frequency *= 2;

    // Small scale features
    depth += this.noise(x * frequency, z * frequency) * amplitude * 100;
    amplitude *= 0.5;
    frequency *= 2;

    // Very small details
    depth += this.noise(x * frequency, z * frequency) * amplitude * 50;

    // Ensure depth is within bounds
    depth = Math.max(this.minDepth, Math.min(this.maxDepth, depth + 200));

    return depth;
  }

  getDepthColor(depth) {
    const color = new THREE.Color();

    // Color gradient based on depth
    if (depth < 100) {
      // Shallow water - light blue
      color.setRGB(0.4, 0.6, 0.8);
    } else if (depth < 200) {
      // Medium depth - blue
      color.setRGB(0.2, 0.4, 0.7);
    } else if (depth < 300) {
      // Deep water - dark blue
      color.setRGB(0.1, 0.2, 0.6);
    } else {
      // Very deep - very dark blue
      color.setRGB(0.05, 0.1, 0.5);
    }

    // Add some variation based on position
    const variation = (Math.sin(depth * 0.01) + 1) * 0.1;
    color.r += variation * 0.1;
    color.g += variation * 0.1;
    color.b += variation * 0.2;

    return color;
  }

  _update(deltaTime) {
    if (!this.camera) return;

    // Check if camera has moved enough to update chunks
    const distance = this.camera.position.distanceTo(this.lastUpdatePosition);

    if (distance > this.updateThreshold) {
      this.updateVisibleChunks();
      this.lastUpdatePosition.copy(this.camera.position);
    }
  }

  updateVisibleChunks() {
    const cameraX = Math.floor(this.camera.position.x / this.chunkSize) * this.chunkSize;
    const cameraZ = Math.floor(this.camera.position.z / this.chunkSize) * this.chunkSize;

    const newVisibleChunks = new Set();

    // Generate chunks around camera
    for (let x = -this.viewDistance; x <= this.viewDistance; x++) {
      for (let z = -this.viewDistance; z <= this.viewDistance; z++) {
        const startX = cameraX + x * this.chunkSize;
        const startZ = cameraZ + z * this.chunkSize;
        const key = `${startX},${startZ}`;

        newVisibleChunks.add(key);

        // Create chunk if it doesn't exist
        if (!this.chunks.has(key)) {
          this.createChunk(startX, startZ);
        }
      }
    }

    // Hide chunks that are no longer visible
    for (const key of this.visibleChunks) {
      if (!newVisibleChunks.has(key)) {
        const chunk = this.chunks.get(key);
        if (chunk) {
          chunk.visible = false;
        }
      }
    }

    // Show newly visible chunks
    for (const key of newVisibleChunks) {
      if (!this.visibleChunks.has(key)) {
        const chunk = this.chunks.get(key);
        if (chunk) {
          chunk.visible = true;
        }
      }
    }

    this.visibleChunks = newVisibleChunks;
  }

  getDepthAt(x, z) {
    // Simple depth sampling (could be improved with interpolation)
    return this.generateDepth(x, z);
  }

  isUnderwater(position) {
    const depth = this.getDepthAt(position.x, position.z);
    return position.y < -depth;
  }

  getUnderwaterDepth(position) {
    if (!this.isUnderwater(position)) return 0;
    const terrainDepth = this.getDepthAt(position.x, position.z);
    return -position.y - terrainDepth;
  }

  dispose() {
    Logger.info("Disposing Sea Floor System...");

    // Dispose all chunks
    for (const [key, chunk] of this.chunks) {
      this.scene.remove(chunk);
      if (chunk.geometry) chunk.geometry.dispose();
    }

    this.chunks.clear();
    this.visibleChunks.clear();

    if (this.terrainMaterial) {
      this.terrainMaterial.dispose();
    }

    Logger.info("Sea Floor System disposed");
  }
}