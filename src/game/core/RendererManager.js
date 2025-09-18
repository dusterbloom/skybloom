import * as THREE from "three";
import { Logger } from '../../utils/Logger.js';

export class RendererManager {
  constructor(engine, canvas) {
    this.engine = engine;
    this.canvas = canvas;
    this.renderer = null;
    this.isMobile = engine.isMobile;
    this.deviceCapabilities = engine.deviceCapabilities;
    this.scene = engine.scene;
    this.camera = engine.camera;
    this._shadowUpdateCounter = 0;
    this._frameSkipAccumulator = 0;

    // Safety check: warn if camera is not available during construction
    if (!this.camera) {
      console.warn('RendererManager: Camera not available during construction. This may cause issues.');
    }
  }

  setup() {
    try {
      // Common renderer settings
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: !this.isMobile,
        powerPreference: "high-performance",
        precision: this.isMobile ? "highp" : "highp",
        depth: true,
        stencil: false,
        alpha: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        logarithmicDepthBuffer: false
      });

      Logger.info("WebGL Renderer created successfully");
    } catch (error) {
      Logger.error("Failed to create WebGL Renderer:", error);
      // Fallback to basic renderer
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: false,
        precision: "lowp"
      });
      Logger.warn("Using fallback WebGL renderer");
    }

    this.renderer.setClearColor(0x88ccff);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    THREE.ColorManagement.enabled = true;

    // Check for WebGL errors
    const gl = this.renderer.getContext();
    if (gl) {
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        Logger.error("WebGL Error during setup:", error);
      } else {
        Logger.info("WebGL context initialized successfully");
      }
    } else {
      Logger.error("Failed to get WebGL context");
    }

    // Platform-specific configuration
    if (this.isMobile) {
      const pixelRatio = this.deviceCapabilities.gpuTier === 'low' ? 
        Math.min(window.devicePixelRatio, 1.0) : 
        Math.min(window.devicePixelRatio, 1.5);
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.toneMapping = THREE.ReinhardToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.shadowMap.enabled = this.deviceCapabilities.gpuTier !== 'low';
      if (this.renderer.shadowMap.enabled) {
        this.renderer.shadowMap.type = THREE.BasicShadowMap;
        this.renderer.shadowMap.autoUpdate = false;
      }
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
  }

  updateResolution() {
    // Safety check: ensure camera exists before updating
    if (!this.camera) {
      console.warn('RendererManager.updateResolution: Camera not available, skipping update');
      return;
    }

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Force frustum culling update if world system exists
    if (this.engine.systemManager && this.engine.systemManager.get('world') &&
        this.engine.systemManager.get('world').updateVisibility) {
      this.engine.systemManager.get('world').updateVisibility(this.camera);
    }
  }

  applyQualitySettings(level) {
    // Apply material optimizations based on quality level
    if (!this.scene) {
      Logger.warn('Cannot apply quality settings: scene not initialized');
      return;
    }

    const LOW_QUALITY_SETTINGS = {
      aoMapIntensity: 0.5,
      displacementScale: 0,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.8,
      metalness: 0.2,
      envMapIntensity: 0.5,
      flatShading: true
    };

    const MID_QUALITY_SETTINGS = {
      aoMapIntensity: 0.7,
      displacementScale: 0,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.7,
      metalness: 0.3,
      envMapIntensity: 0.7,
      flatShading: false
    };

    const qualitySettings = level === 0 ? LOW_QUALITY_SETTINGS : 
                            level === 1 ? MID_QUALITY_SETTINGS : null;

    if (!qualitySettings) return;

    const materials = [];
    this.scene.traverse((node) => {
      if (node.material) {
        if (Array.isArray(node.material)) {
          materials.push(...node.material);
        } else {
          materials.push(node.material);
        }
      }
    });

    for (const material of materials) {
      if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
        if (material.aoMap) material.aoMapIntensity = qualitySettings.aoMapIntensity;
        if (material.normalMap) material.normalScale.copy(qualitySettings.normalScale);
        if (material.displacementMap) material.displacementScale = qualitySettings.displacementScale;
        material.roughness = qualitySettings.roughness;
        material.metalness = qualitySettings.metalness;
        material.envMapIntensity = qualitySettings.envMapIntensity;
        material.flatShading = qualitySettings.flatShading;
        material.needsUpdate = true;
      }
    }

    Logger.info(`Applied quality settings level ${level} to ${materials.length} materials`);
  }

  render(scene, camera) {
    // Mobile frame skipping
    if (this.isMobile && this.deviceCapabilities.gpuTier === 'low') {
      const targetFrameTime = 1/30;
      if (this._frameSkipAccumulator < targetFrameTime) {
        this._frameSkipAccumulator += this.engine.delta;
        // Update player for responsiveness
        if (this.engine.systemManager) {
          const player = this.engine.systemManager.get('player');
          if (player) {
            player.update(this.engine.delta, this.engine.elapsed);
          }
        }
        return;
      }
      this._frameSkipAccumulator = 0;
    }

    // Update shadow maps
    if (this.renderer.shadowMap.enabled) {
      const shadowUpdateInterval = this.isMobile ? 
        (this.deviceCapabilities.gpuTier === 'low' ? 15 : 5) : 1;
      if (this._shadowUpdateCounter % shadowUpdateInterval === 0) {
        this.renderer.shadowMap.needsUpdate = true;
      } else {
        this.renderer.shadowMap.needsUpdate = false;
      }
      this._shadowUpdateCounter++;
    }

    // Optimize before render
    this._optimizeBeforeRender();

    // Render
    this.renderer.render(scene, camera);

    // Cleanup after render
    this._cleanupAfterRender();
  }

  _optimizeBeforeRender() {
    if (this.isMobile && this.scene) {
      let activeLights = 0;
      const maxLights = this.deviceCapabilities.gpuTier === 'low' ? 2 : 
                        this.deviceCapabilities.gpuTier === 'medium' ? 3 : 4;
      const playerPos = this.engine.systemManager ? 
        (this.engine.systemManager.get('player')?.localPlayer?.position) : null;

      if (playerPos) {
        const lights = [];
        this.scene.traverse((object) => {
          if (object.isLight && object.visible) {
            const distance = playerPos.distanceTo(object.position);
            const importance = object.intensity * (1 / (1 + distance * 0.01));
            lights.push({ light: object, importance, distance });
          }
        });
        lights.sort((a, b) => b.importance - a.importance);
        for (let i = 0; i < lights.length; i++) {
          const lightData = lights[i];
          if (i < maxLights) {
            lightData.light._wasEnabled = lightData.light.visible;
            lightData.light.visible = true;
            activeLights++;
          } else {
            lightData.light._wasEnabled = lightData.light.visible;
            lightData.light.visible = false;
          }
        }
      }
    }

    if (this.isMobile && this.deviceCapabilities.gpuTier === 'low') {
      const atmosphere = this.engine.systemManager ? this.engine.systemManager.get('atmosphere') : null;
      if (atmosphere && atmosphere.setEffectsEnabled) {
        atmosphere._effectsWereEnabled = atmosphere.effectsEnabled;
        atmosphere.setEffectsEnabled(false);
      }
    }
  }

  _cleanupAfterRender() {
    if (this.isMobile && this.scene) {
      this.scene.traverse((object) => {
        if (object.isLight && object._wasEnabled !== undefined) {
          object.visible = object._wasEnabled;
          delete object._wasEnabled;
        }
      });
    }

    if (this.isMobile && this.deviceCapabilities.gpuTier === 'low') {
      const atmosphere = this.engine.systemManager ? this.engine.systemManager.get('atmosphere') : null;
      if (atmosphere && atmosphere._effectsWereEnabled !== undefined) {
        atmosphere.setEffectsEnabled(atmosphere._effectsWereEnabled);
        delete atmosphere._effectsWereEnabled;
      }
    }
  }

  handleVisibilityChange(visible) {
    // Pause/resume rendering based on visibility
    this.engine.isVisible = visible;
  }

  destroy() {
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}