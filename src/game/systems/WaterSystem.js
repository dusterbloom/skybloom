// FILE: src/game/systems/WaterSystem.js
// Enhanced with Three.js Water for realistic reflections

import * as THREE from "three";
import { Water } from 'three/examples/jsm/objects/Water.js';
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Water System - Enhanced with realistic reflections using Three.js Water
 */
export class WaterSystem extends System {
  constructor(engine) {
    super(engine, 'water');
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.waterLevel = 0;
    this.water = null;
    this.sun = null;
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
    // Create water geometry with higher resolution for smoother shorelines
    const oceanSize = 10000;
    const waterGeometry = new THREE.PlaneGeometry(oceanSize, oceanSize, 64, 64);

    // Load water normal map texture
    const textureLoader = new THREE.TextureLoader();
    const waterNormals = textureLoader.load('/textures/2waternormals.jpg', (texture) => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    });

    // Get sun direction from atmosphere system (if available)
    const sunSystem = this.engine.systems.get('sun');
    let sunDirection = new THREE.Vector3(0.707, 0.707, 0);

    if (sunSystem && sunSystem.getSunDirection) {
      sunDirection = sunSystem.getSunDirection();
    }

    // Create Water instance with reflections
    this.water = new Water(
      waterGeometry,
      {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: waterNormals,
        sunDirection: sunDirection,
        sunColor: 0xffffff,
        waterColor: 0x001e0f,
        distortionScale: 3.7,
        fog: this.scene.fog !== undefined,
        alpha: 0.8
      }
    );

    // Rotate to horizontal plane
    this.water.rotation.x = -Math.PI / 2;
    // Position water higher above waterLevel to prevent terrain bleeding through
    this.water.position.y = this.waterLevel + 1.0;

    // Ensure water renders after terrain to prevent z-fighting
    this.water.renderOrder = 1;

    // Add polygon offset to water material to prevent terrain bleeding
    if (this.water.material) {
      this.water.material.polygonOffset = true;
      this.water.material.polygonOffsetFactor = 1;
      this.water.material.polygonOffsetUnits = 1;
    }

    this.scene.add(this.water);

    Logger.info("🌊 Ocean created with realistic reflections");
  }

  _update(deltaTime) {
    if (!this.water) return;

    // Keep ocean centered on camera for infinite world
    if (this.camera) {
      this.water.position.x = this.camera.position.x;
      this.water.position.z = this.camera.position.z;
    }

    // Update water animation (time uniform for wave normals)
    this.water.material.uniforms['time'].value += deltaTime * 0.5;

    // Update sun direction if atmosphere system available
    const sunSystem = this.engine.systems.get('sun');
    if (sunSystem && sunSystem.getSunDirection) {
      const sunDir = sunSystem.getSunDirection();
      this.water.material.uniforms['sunDirection'].value.copy(sunDir).normalize();
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
}
