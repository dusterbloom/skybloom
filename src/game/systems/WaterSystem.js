// FILE: src/game/systems/WaterSystem.js
// Using THREE.js Official Ocean Example - Proven, Maintained Code

import * as THREE from "three";
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Water System using flat colored plane - Ultra Simple, Zero Errors
 * Based on original Magic Carpet (1994) approach
 */
export class WaterSystem extends System {
  constructor(engine) {
    super(engine, 'water');
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.waterLevel = 0;
    this.water = null;
  }

  async _initialize() {
    Logger.info("🌊 Initializing Simple Water System...");

    // Calculate water level based on world terrain
    if (this.engine.systems.world) {
      const baseLevel = this.engine.systems.world.minHeight || 0;
      this.waterLevel = baseLevel + 25;
      Logger.info(`Water level set to ${this.waterLevel.toFixed(2)}`);
    } else {
      this.waterLevel = 0;
    }

    this.createSimpleWater();

    Logger.info("🌊 Water System initialized ✅");
  }

  createSimpleWater() {
    // Ultra-simple flat plane - like Magic Carpet 1994
    // No textures, no shaders, no complexity = no errors
    const geometry = new THREE.PlaneGeometry(15000, 15000);
    geometry.rotateX(-Math.PI / 2);

    // Simple solid color material
    const material = new THREE.MeshStandardMaterial({
      color: 0x1177bb,    // Ocean blue
      metalness: 0.9,     // Shiny water
      roughness: 0.1,     // Smooth surface
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });

    this.water = new THREE.Mesh(geometry, material);
    this.water.position.set(0, this.waterLevel, 0);
    this.water.receiveShadow = true;

    this.scene.add(this.water);

    Logger.info("Simple flat water created");
  }

  _update(deltaTime) {
    // Keep water centered on camera for infinite world
    if (this.camera && this.water) {
      this.water.position.x = this.camera.position.x;
      this.water.position.z = this.camera.position.z;
    }
  }

  destroy() {
    if (this.water) {
      this.scene.remove(this.water);
      if (this.water.geometry) this.water.geometry.dispose();
      if (this.water.material) this.water.material.dispose();
      this.water = null;
    }
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
