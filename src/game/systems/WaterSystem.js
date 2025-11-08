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

    // Create ocean material with custom shader for waves
    this.oceanMaterial = new THREE.MeshStandardMaterial({
      color: waterColor,
      transparent: true,
      opacity: 0.7,
      metalness: 0.1,
      roughness: 0.3,
    });

    // Add custom shader for wave animation
    this.oceanMaterial.onBeforeCompile = (shader) => {
      // Add time uniform
      shader.uniforms.uTime = { value: 0 };

      // Store reference for updates
      this.waterShader = shader;

      // Add wave displacement in vertex shader (optimized)
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        uniform float uTime;

        #include <begin_vertex>

        // Optimized wave calculation with fewer operations
        float waveHeight =
          sin(position.x * 0.005 + uTime) * cos(position.z * 0.005 + uTime) * 3.0 +
          sin(position.x * 0.01 + uTime * 1.3) * 1.5;

        transformed.y += waveHeight;
        `
      );
    };

    // Create large ocean plane with optimized segment count
    const oceanSize = 15000;
    const segments = 32; // Balanced segment count for smooth shorelines without FPS drop
    const oceanGeometry = new THREE.PlaneGeometry(oceanSize, oceanSize, segments, segments);
    oceanGeometry.rotateX(-Math.PI / 2);

    this.oceanMesh = new THREE.Mesh(oceanGeometry, this.oceanMaterial);
    // Lower water slightly to prevent z-fighting with shoreline
    this.oceanMesh.position.y = this.waterLevel - 0.2;
    this.oceanMesh.receiveShadow = true;

    this.scene.add(this.oceanMesh);

    Logger.info("Ocean created with animated waves");
  }

  _update(deltaTime) {
    // Keep ocean centered on camera for infinite world
    if (this.camera && this.oceanMesh) {
      this.oceanMesh.position.x = this.camera.position.x;
      this.oceanMesh.position.z = this.camera.position.z;
    }

    // Update wave animation
    if (this.waterShader && this.waterShader.uniforms.uTime) {
      this.waterShader.uniforms.uTime.value += deltaTime * 0.5; // Slow wave speed
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
