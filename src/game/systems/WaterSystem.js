// FILE: src/game/systems/WaterSystem.js
// Restored from working main branch implementation

import * as THREE from "three";
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Simple Water System - Restored from working main branch
 */
export class WaterSystem extends System {
  constructor(engine) {
    super(engine, 'water');
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.waterLevel = 0;
    this.oceanMesh = null;
    this.oceanMaterial = null;
  }

  async _initialize() {
    Logger.info("🌊 Initializing Water System...");

    // Get water level from world system
    if (this.engine.systems.world) {
      this.waterLevel = this.engine.systems.world.waterLevel || 0;
      Logger.info(`Water level: ${this.waterLevel}`);
    } else {
      this.waterLevel = 0;
    }

    // Create ocean
    this.createOcean();

    Logger.info("🌊 Water System initialized ✅");
  }

  createOcean() {
    // Water color - proven working value from main branch
    const waterColor = new THREE.Color(0x0077be);

    // Create ocean material - simple and effective
    this.oceanMaterial = new THREE.MeshStandardMaterial({
      color: waterColor,
      transparent: true,
      opacity: 0.7,
      metalness: 0.1,
      roughness: 0.3,
    });

    // Create large ocean plane
    const oceanSize = 15000;
    const oceanGeometry = new THREE.PlaneGeometry(oceanSize, oceanSize, 8, 8);
    oceanGeometry.rotateX(-Math.PI / 2);

    this.oceanMesh = new THREE.Mesh(oceanGeometry, this.oceanMaterial);
    // Lower water slightly to prevent z-fighting with shoreline
    this.oceanMesh.position.y = this.waterLevel - 0.2;
    this.oceanMesh.receiveShadow = true;

    this.scene.add(this.oceanMesh);

    Logger.info("Ocean created");
  }

  _update(deltaTime) {
    // Keep ocean centered on camera for infinite world
    if (this.camera && this.oceanMesh) {
      this.oceanMesh.position.x = this.camera.position.x;
      this.oceanMesh.position.z = this.camera.position.z;
    }
  }

  destroy() {
    if (this.oceanMesh) {
      this.scene.remove(this.oceanMesh);
      if (this.oceanMesh.geometry) this.oceanMesh.geometry.dispose();
      if (this.oceanMaterial) this.oceanMaterial.dispose();
      this.oceanMesh = null;
      this.oceanMaterial = null;
    }
  }

  // Public API
  getWaterLevel() {
    return this.waterLevel;
  }
}
