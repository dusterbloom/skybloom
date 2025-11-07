import * as THREE from "three";
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';
import { SUN_CONFIG } from '../../config/SunConfig.js';

// SunSystem - manages sun lighting and appearance
export class SunSystem extends System {
  constructor(atmosphereSystem) {
    // Call parent constructor with proper parameters
    super(atmosphereSystem.engine, 'sun');

    this.atmosphereSystem = atmosphereSystem;
    this.scene = atmosphereSystem.scene;

    // Core sun components
    this.sunLight = null;
    this.sunMesh = null;
    this.sunGlow = null;
    this.ambientLight = null;
    this.sunPosition = new THREE.Vector3();

    // Configuration
    this.config = { ...SUN_CONFIG };

    // Animation state
    this.timeOfDay = 0;
    this.yearProgress = 0;
    this.isVisible = true;

    // Seasonal effects
    this.seasonalTilt = 1.0;
  }

  async initialize() {
    Logger.info('SunSystem: Initializing unified sun system');

    this.createSunLight();
    this.createSunMesh();
    this.setupDayNightCycle();

    Logger.info('SunSystem: Unified sun system initialized successfully');
  }

  createSunLight() {
    // Create directional sunlight
    this.sunLight = new THREE.DirectionalLight(
      this.config.DEFAULT_COLOR,
      this.config.DEFAULT_INTENSITY
    );

    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = this.config.SHADOW_MAP_SIZE;
    this.sunLight.shadow.mapSize.height = this.config.SHADOW_MAP_SIZE;
    this.sunLight.shadow.bias = this.config.SHADOW_BIAS;

    // Configure shadow camera
    this.sunLight.shadow.camera.near = this.config.SHADOW_NEAR;
    this.sunLight.shadow.camera.far = this.config.SHADOW_FAR;
    this.sunLight.shadow.camera.left = -this.config.SHADOW_CAMERA_SIZE;
    this.sunLight.shadow.camera.right = this.config.SHADOW_CAMERA_SIZE;
    this.sunLight.shadow.camera.top = this.config.SHADOW_CAMERA_SIZE;
    this.sunLight.shadow.camera.bottom = -this.config.SHADOW_CAMERA_SIZE;

    // Create ambient light - warmer color for cozy feel
    this.ambientLight = new THREE.AmbientLight(0x8899aa, this.config.AMBIENT_INTENSITY);

    this.scene.add(this.sunLight);
    this.scene.add(this.ambientLight);

    Logger.info('SunSystem: Sun light and ambient light created');
  }

  createSunMesh() {
    // Create sun geometry
    const sunGeometry = new THREE.CircleGeometry(
      this.config.SUN_RADIUS,
      this.config.SUN_SEGMENTS
    );

    // Create sun material
    const sunMaterial = new THREE.MeshBasicMaterial({
      color: this.config.DEFAULT_COLOR,
      transparent: true,
      opacity: 0.9,
      side: THREE.FrontSide,
      depthWrite: false,
      depthTest: true,
      depthFunc: THREE.AlwaysDepth
    });

    // Create sun mesh
    this.sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    this.sunMesh.renderOrder = this.config.RENDER_ORDER;
    this.sunMesh.layers.set(this.config.RENDER_LAYER);
    this.sunMesh.visible = this.isVisible;

    // Create glow effect
    const glowGeometry = new THREE.CircleGeometry(
      this.config.SUN_RADIUS * 1.8,
      this.config.SUN_SEGMENTS
    );

    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffaa,
      transparent: true,
      opacity: this.config.GLOW_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
      depthFunc: THREE.AlwaysDepth
    });

    this.sunGlow = new THREE.Mesh(glowGeometry, glowMaterial);
    this.sunMesh.add(this.sunGlow);

    this.scene.add(this.sunMesh);

    Logger.info('SunSystem: Sun mesh with glow effect created');
  }

  update(delta, elapsed) {
    // Use AtmosphereSystem's time instead of independent tracking
    const timeOfDay = this.atmosphereSystem.getTimeOfDay();
    const yearProgress = this.atmosphereSystem.yearProgress || 0;

    // Update our local time for compatibility
    this.timeOfDay = timeOfDay;
    this.yearProgress = yearProgress;

    this.updateSunPosition(delta, elapsed);
    this.updateSunAppearance(delta, elapsed);
    this.updateLighting(delta, elapsed);
    this.updateVisibility();
  }

  updateSunPosition(delta, elapsed) {
    // Calculate seasonal tilt effect
    this.seasonalTilt = 1.0 + Math.sin(this.yearProgress * Math.PI * 2) * this.config.SEASONAL_VARIATION;

    // Sun angle based on time of day (midnight = -π/2)
    const angle = (this.timeOfDay * Math.PI * 2) - (Math.PI / 2);

    // Calculate position on elliptical path
    this.sunPosition.x = Math.cos(angle) * this.config.SUN_DISTANCE;
    this.sunPosition.y = Math.max(-200, Math.sin(angle) * this.config.MAX_HEIGHT * this.seasonalTilt);
    this.sunPosition.z = 0;

    // Update sun mesh position
    if (this.sunMesh) {
      this.sunMesh.position.copy(this.sunPosition);

      // Face camera for billboarding effect
      if (this.engine.camera) {
        this.sunMesh.lookAt(this.engine.camera.position);
      }
    }

    // Update light position
    if (this.sunLight) {
      this.sunLight.position.copy(this.sunPosition);
    }
  }

  updateSunAppearance(delta, elapsed) {
    if (!this.sunMesh) return;

    // Calculate horizon proximity for visual effects
    const altitude = this.sunPosition.y;
    const horizonProximity = Math.max(0, 1 - Math.abs(altitude) / 1500);

    // Adjust opacity based on altitude
    const belowHorizonFactor = altitude > 0 ? 1.0 :
      Math.max(0, 1.0 + (altitude / this.config.BELOW_HORIZON_FACTOR));

    this.sunMesh.material.opacity = 0.9 * belowHorizonFactor;
    if (this.sunGlow) {
      this.sunGlow.material.opacity = this.config.GLOW_OPACITY * belowHorizonFactor;
    }

    // Scale at horizon for more dramatic effect
    const scale = 1.0 + (horizonProximity * 0.2);
    this.sunMesh.scale.set(scale, scale, 1);

    // Update colors based on time of day
    this.updateSunColors();
  }

  updateSunColors() {
    if (!this.sunMesh) return;

    const altitude = this.sunPosition.y;

    if (altitude > -300) {
      if (this.timeOfDay < 0.35 || this.timeOfDay > 0.65) {
        // Sunrise/sunset colors
        const color = this.timeOfDay < 0.5 ? 0xffaa33 : 0xff7733;
        this.sunMesh.material.color.setHex(color);
        if (this.sunGlow) {
          this.sunGlow.material.color.setHex(color);
        }
      } else {
        // Daytime - yellow
        this.sunMesh.material.color.setHex(0xffff00);
        if (this.sunGlow) {
          this.sunGlow.material.color.setHex(0xffff80);
        }
      }
    }
  }

  updateLighting(delta, elapsed) {
    if (!this.sunLight || !this.ambientLight) return;

    const altitude = this.sunPosition.y;

    if (this.timeOfDay > this.config.SUNRISE_TIME && this.timeOfDay < this.config.SUNSET_TIME) {
      // Daytime: bright and clear
      this.sunLight.color.setHex(0xffffcc);
      this.sunLight.intensity = this.config.DEFAULT_INTENSITY;
      this.ambientLight.color.setHex(0xaaccff);
      this.ambientLight.intensity = this.config.AMBIENT_INTENSITY;
    } else if (this.timeOfDay > 0.25 && this.timeOfDay < 0.35) {
      // Sunrise: warm hues and increased brightness
      this.sunLight.color.setHex(0xffaa33);
      this.sunLight.intensity = this.config.DEFAULT_INTENSITY;
      this.ambientLight.color.setHex(0xffddaa);
      this.ambientLight.intensity = this.config.AMBIENT_INTENSITY * 0.4;
    } else if (this.timeOfDay > 0.65 && this.timeOfDay < 0.75) {
      // Sunset: warm, fading light
      this.sunLight.color.setHex(0xff7733);
      this.sunLight.intensity = this.config.DEFAULT_INTENSITY;
      this.ambientLight.color.setHex(0xffccaa);
      this.ambientLight.intensity = this.config.AMBIENT_INTENSITY * 0.4;
    } else {
      // Night: dark and cooler-toned
      this.sunLight.color.setHex(0x223344);
      this.sunLight.intensity = 0.05;
      this.ambientLight.color.setHex(0x001122);
      this.ambientLight.intensity = altitude > -300 ?
        Math.max(0.05, 0.3 + (1 - Math.abs(altitude) / 1500) * 0.2) : 0.05;
    }
  }

  updateVisibility() {
    // Sun should be visible during day and transition periods
    const shouldBeVisible = this.timeOfDay > 0.2 && this.timeOfDay < 0.8;

    if (this.sunMesh) {
      this.sunMesh.visible = shouldBeVisible && this.isVisible;
    }
    if (this.sunLight) {
      this.sunLight.visible = shouldBeVisible;
    }
  }

  setupDayNightCycle() {
    // Initialize time based on real world time
    const now = new Date();
    const secondsInDay = 86400;
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    this.timeOfDay = currentSeconds / secondsInDay;

    Logger.info(`SunSystem: Initialized time of day to ${this.timeOfDay.toFixed(4)} (${(this.timeOfDay * 24).toFixed(1)} hours)`);
  }

  /**
   * Update the sun system
   * @param {number} delta - Time delta in seconds
   * @param {number} elapsed - Total elapsed time
   */
  update(delta, elapsed) {
    try {
      // Update time of day from atmosphere system
      this.timeOfDay = this.atmosphereSystem.getTimeOfDay();

      // Update sun position based on time
      this.updateSunPosition();

      // Update lighting based on time
      this.updateLighting(delta, elapsed);

      // Update visibility
      this.updateVisibility();
    } catch (error) {
      Logger.error('SunSystem update failed:', error);
    }
  }

  // Public API methods
  getSunPosition() {
    return this.sunPosition.clone();
  }

  getSunLight() {
    return this.sunLight;
  }

  getSunDirection() {
    return this.sunPosition.clone().normalize();
  }

  getSunIntensity() {
    return this.sunLight ? this.sunLight.intensity : 0;
  }

  getTimeOfDay() {
    return this.timeOfDay;
  }

  setTimeOfDay(time) {
    this.timeOfDay = Math.max(0, Math.min(1, time));
  }

  setSunVisibility(visible) {
    this.isVisible = visible;
    if (this.sunMesh) {
      this.sunMesh.visible = visible;
    }
  }

  // Methods for water reflection support
  enableReflections(enable) {
    if (this.sunMesh) {
      if (enable) {
        this.sunMesh.layers.enable(this.config.RENDER_LAYER);
      } else {
        this.sunMesh.layers.disable(this.config.RENDER_LAYER);
      }
    }
  }

  destroy() {
    if (this.sunMesh) {
      this.scene.remove(this.sunMesh);
    }
    if (this.sunLight) {
      this.scene.remove(this.sunLight);
    }
    if (this.ambientLight) {
      this.scene.remove(this.ambientLight);
    }

    Logger.info('SunSystem: Cleaned up sun system');
  }
}