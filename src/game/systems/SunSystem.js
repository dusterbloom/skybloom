import * as THREE from "three";
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';
import {
  SUN_CONFIG,
  SUN_KEYFRAMES,
  AMBIENT_KEYFRAMES,
  SUN_DISC_KEYFRAMES,
  sampleKeyframes
} from '../../config/SunConfig.js';

// Scratch color for deriving the glow tint from the disc color (no per-frame allocs)
const _glowWhite = new THREE.Color(0xffffff);

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
      depthTest: false, // Render sun always on top of sky
      fog: false
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
      depthTest: false, // Render glow always on top
      fog: false
    });

    this.sunGlow = new THREE.Mesh(glowGeometry, glowMaterial);
    this.sunMesh.add(this.sunGlow);

    this.scene.add(this.sunMesh);

    Logger.info('SunSystem: Sun mesh with glow effect created');
  }

  /**
   * Update the sun system.
   * NOTE: this class used to define update() twice - the second definition
   * silently won and skipped updateSunAppearance() and the yearProgress sync.
   * Consolidated here into a single method: time sync from AtmosphereSystem,
   * position, appearance, lighting, visibility, all inside the try/catch the
   * second body had.
   * @param {number} delta - Time delta in seconds
   * @param {number} elapsed - Total elapsed time
   */
  update(delta, elapsed) {
    try {
      // Use AtmosphereSystem's time instead of independent tracking
      this.timeOfDay = this.atmosphereSystem.getTimeOfDay();
      this.yearProgress = this.atmosphereSystem.yearProgress || 0;

      this.updateSunPosition(delta, elapsed);
      this.updateSunAppearance(delta, elapsed);
      this.updateLighting(delta, elapsed);
      this.updateVisibility();
    } catch (error) {
      Logger.error('SunSystem update failed:', error);
    }
  }

  updateSunPosition(delta, elapsed) {
    // Calculate seasonal tilt effect
    this.seasonalTilt = 1.0 + Math.sin(this.yearProgress * Math.PI * 2) * this.config.SEASONAL_VARIATION;

    // Sun angle based on time of day (midnight = -π/2)
    const angle = (this.timeOfDay * Math.PI * 2) - (Math.PI / 2);

    // Calculate position on elliptical path.
    // Keep the unclamped altitude for visual fades (opacity/scale) so the sun
    // disc fades out smoothly instead of popping at the clamp boundary.
    this.rawSunAltitude = Math.sin(angle) * this.config.MAX_HEIGHT * this.seasonalTilt;
    this.sunPosition.x = Math.cos(angle) * this.config.SUN_DISTANCE;
    this.sunPosition.y = Math.max(-200, this.rawSunAltitude);
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

    // Use the unclamped altitude so fades are continuous through the horizon
    const altitude = this.rawSunAltitude !== undefined ? this.rawSunAltitude : this.sunPosition.y;
    const horizonProximity = Math.max(0, 1 - Math.abs(altitude) / 1500);

    // Adjust opacity based on altitude - fades to 0 below the horizon
    const belowHorizonFactor = altitude > 0 ? 1.0 :
      Math.max(0, 1.0 + (altitude / this.config.BELOW_HORIZON_FACTOR));

    this.sunMesh.material.opacity = 0.9 * belowHorizonFactor;
    if (this.sunGlow) {
      // Glow swells near the horizon for a dramatic sunrise/sunset bloom
      const glowBoost = 1.0 + horizonProximity * 1.5;
      this.sunGlow.material.opacity = this.config.GLOW_OPACITY * glowBoost * belowHorizonFactor;
    }

    // Scale at horizon for more dramatic effect
    const scale = 1.0 + (horizonProximity * 0.2);
    this.sunMesh.scale.set(scale, scale, 1);

    // Update colors based on time of day
    this.updateSunColors();
  }

  updateSunColors() {
    if (!this.sunMesh) return;

    // Smoothly keyframed disc color (deep orange at horizon, yellow when high)
    sampleKeyframes(SUN_DISC_KEYFRAMES, this.timeOfDay, this.sunMesh.material.color);

    if (this.sunGlow) {
      // Glow is the disc color softened toward white
      this.sunGlow.material.color.copy(this.sunMesh.material.color).lerp(_glowWhite, 0.35);
    }
  }

  updateLighting(delta, elapsed) {
    if (!this.sunLight || !this.ambientLight) return;

    // Smooth keyframe interpolation over the full day - no hard time buckets.
    // Night keeps a faint cool fill (0.12) so the scene never goes pitch black.
    this.sunLight.intensity = sampleKeyframes(SUN_KEYFRAMES, this.timeOfDay, this.sunLight.color);

    // Ambient: warm-neutral at noon, golden in the evening, cool blue at night,
    // with a hard readability floor.
    const ambientIntensity = sampleKeyframes(AMBIENT_KEYFRAMES, this.timeOfDay, this.ambientLight.color);
    this.ambientLight.intensity = Math.max(this.config.AMBIENT_MIN_INTENSITY, ambientIntensity);
  }

  updateVisibility() {
    // Sun disc only near/above the horizon (opacity already fades it smoothly
    // before these bounds are reached, so there is no pop)
    const meshVisible = this.timeOfDay > 0.18 && this.timeOfDay < 0.82;

    if (this.sunMesh) {
      this.sunMesh.visible = meshVisible && this.isVisible;
    }
    if (this.sunLight) {
      // The light always stays on - the keyframed intensity handles night
      // dimming. Toggling visibility here caused a hard step at dusk.
      this.sunLight.visible = true;
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