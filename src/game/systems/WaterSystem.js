// FILE: src/game/systems/WaterSystem.js

import * as THREE from "three";
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Simplified Water System - Magic Carpet Style
 * Clean, performant water without complex reflections
 */
export class WaterSystem extends System {
  constructor(engine) {
    super(engine, 'water');
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.waterLevel = 0;
    this.water = null;
    this.waterMaterial = null;

    // Animation parameters
    this.time = 0;
    this.waveSpeed = 0.05;
    this.waveScale = 0.15;
  }

  async _initialize() {
    Logger.info("🌊 Initializing Simplified Water System...");

    // Calculate water level based on world terrain
    if (this.engine.systems.world) {
      const baseLevel = this.engine.systems.world.minHeight || 0;
      // Position water below beach level to prevent overlap
      this.waterLevel = baseLevel + 25;
      Logger.info(`Water level set to ${this.waterLevel.toFixed(2)}`);
    } else {
      this.waterLevel = 0;
      Logger.warn("World system not available, defaulting water level to 0");
    }

    // Create simple, performant water
    await this.createSimpleWater();

    Logger.info("🌊 Water System initialized successfully ✅");
  }

  async createSimpleWater() {
    Logger.info("Creating simplified water surface...");

    // Load normal map for subtle wave detail
    const waterNormals = await this.loadWaterNormals();

    // Create large plane geometry
    const geometry = new THREE.PlaneGeometry(15000, 15000, 100, 100);
    geometry.rotateX(-Math.PI / 2);

    // Simple, clean material - Magic Carpet style
    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x0066aa,  // Nice ocean blue
      metalness: 0.8,    // Shiny like water
      roughness: 0.2,    // Smooth surface with slight texture
      normalMap: waterNormals,
      normalScale: new THREE.Vector2(0.5, 0.5), // Subtle wave bumps
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false, // Prevent z-fighting

      // Anti-z-fighting settings
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });

    // Create mesh
    this.water = new THREE.Mesh(geometry, this.waterMaterial);
    this.water.position.set(0, this.waterLevel, 0);
    this.water.receiveShadow = true;

    this.scene.add(this.water);

    Logger.info("Simple water created successfully");
  }

  async loadWaterNormals() {
    return new Promise((resolve) => {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(
        'textures/2waternormals.jpg',
        (texture) => {
          // LOW repeat to prevent aliasing artifacts (was 16, now 4)
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(4, 4);
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = true;

          // Enable anisotropic filtering for better quality at angles
          const renderer = this.engine.rendererManager?.renderer;
          if (renderer) {
            const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
            texture.anisotropy = Math.min(4, maxAnisotropy);
          }

          resolve(texture);
        },
        undefined,
        (error) => {
          Logger.warn("Water normals texture failed to load, using fallback");
          // Fallback: flat normal map
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = 'rgb(128, 128, 255)'; // Neutral normal
          ctx.fillRect(0, 0, 1, 1);

          const fallbackTexture = new THREE.CanvasTexture(canvas);
          fallbackTexture.wrapS = fallbackTexture.wrapT = THREE.RepeatWrapping;
          resolve(fallbackTexture);
        }
      );
    });
  }

  _update(deltaTime) {
    if (!this.water || !this.waterMaterial || !this.waterMaterial.normalMap) return;

    // Animate water by offsetting the normal map
    this.time += deltaTime * this.waveSpeed;

    // Subtle wave movement
    this.waterMaterial.normalMap.offset.x = Math.sin(this.time) * this.waveScale;
    this.waterMaterial.normalMap.offset.y = Math.cos(this.time * 0.7) * this.waveScale;

    // Keep water centered on camera (for infinite world)
    if (this.camera) {
      this.water.position.x = this.camera.position.x;
      this.water.position.z = this.camera.position.z;
    }

    // Update sun direction for realistic lighting (if atmosphere system exists)
    const atmosphere = this.engine.systems.atmosphere;
    if (atmosphere && atmosphere.getSunDirection) {
      const sunDir = atmosphere.getSunDirection();
      // Material automatically uses scene lighting, no manual update needed
    }
  }

  destroy() {
    Logger.info("Destroying Water System...");

    if (this.water) {
      this.scene.remove(this.water);
      if (this.water.geometry) this.water.geometry.dispose();
      if (this.waterMaterial) {
        if (this.waterMaterial.normalMap) this.waterMaterial.normalMap.dispose();
        this.waterMaterial.dispose();
      }
      this.water = null;
      this.waterMaterial = null;
    }

    Logger.info("Water System destroyed");
  }

  // Public API
  getWaterLevel() {
    return this.waterLevel;
  }

  setWaterLevel(level) {
    this.waterLevel = level;
    if (this.water) {
      this.water.position.y = level;
    }
  }

  isUnderwater(position) {
    return position.y < this.waterLevel;
  }
}
