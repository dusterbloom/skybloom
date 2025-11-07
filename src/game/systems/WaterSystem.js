// FILE: src/game/systems/WaterSystem.js

import * as THREE from "three";
import { Water } from 'three/examples/jsm/objects/Water.js';
import { TextureLoader } from 'three';
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Water system that integrates with the terrain's ocean beds
 */
export class WaterSystem extends System {
  constructor(engine) {
    super(engine, 'water');
    this.scene = engine.scene;
    this.waterLevel = 0;
    this.water = null;
    this.shoreline = null; // Reference to shoreline mesh for smooth transitions
    this._reflectionCameraInitialized = false;
    this._waterQuality = 'high';
    this._originalOnBeforeRender = null; // Store the original function
    this._savedAndroidBeforeRender = null; // Android-specific render function storage

    // State flag for reflections
    this.reflectionsEnabled = true; // Assume enabled by default

    // Track saved resolution for efficient reflection toggling
    this._savedResolution = null;

    // Platform detection
    this.isAndroid = /android/i.test(navigator.userAgent);

    // Debug flag
    this._debugChecked = false;
  }

  async _initialize() {
    // Logger.info("Initializing WaterSystem...");

    // Debug info about world's state
    if (this.engine.systems.world) {
      // Logger.debug("World System Details:");
      // Logger.debug(`- minHeight: ${this.engine.systems.world.minHeight}`);
      // Logger.debug(`- maxHeight: ${this.engine.systems.world.maxHeight}`);
      // Logger.debug(`- Ocean biome threshold: ${this.engine.systems.world.biomes.ocean.threshold}`);

      // Calculate water level with diagnostic info
      const baseLevel = this.engine.systems.world.minHeight || 0;
      // Position water below beach level to prevent z-fighting
      // Beach starts at minHeight + 35, water at minHeight + 25 (10 unit gap)
      this.waterLevel = baseLevel + 25;
        // Logger.info(`Setting water level to ${this.waterLevel.toFixed(2)} (baseLevel=${baseLevel}, beach starts at ${baseLevel + 35}, 10-unit gap for anti-flickering)`);
    } else {
      this.waterLevel = 0;
      // Logger.warn("World system not available, defaulting water level to 0");
    }

    // Detailed platform detection for better debugging
    const userAgent = navigator.userAgent.toLowerCase();
    const isAndroid = /android/i.test(userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(userAgent);
    this.isAndroid = isAndroid; // Store platform info

    // Log detailed platform information
    // Logger.info(`WaterSystem initializing for ${isAndroid ? 'Android' : isIOS ? 'iOS' : 'Desktop'} platform`);
    if (isAndroid) {
      // Logger.debug(`Android device info: ${userAgent}`);
    }

    // Initial quality setting based on platform
    if (this.engine.settings && this.engine.settings.isMobile) {
      // Start with reflections disabled on mobile by default for performance
      this.reflectionsEnabled = false;
      this._waterQuality = 'low'; // Reflect the disabled state
      // Logger.info(`Mobile ${isAndroid ? 'Android' : 'iOS'} device detected, starting with water reflections disabled.`);
    } else {
      this.reflectionsEnabled = true;
      this._waterQuality = 'high';
    }

    // Set global THREE.js color management to ensure proper color interpretation
    THREE.ColorManagement.enabled = true;

    await this.createWater(); // Use await if texture loading needs it

    // Add debug visualization to show where water level is
    if (isAndroid) {
      // Logger.debug("Adding water level debug markers");

      // Add a bright marker at water level
      const markerGeometry = new THREE.SphereGeometry(10, 8, 8);
      const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(0, this.waterLevel, 0);
      this.scene.add(marker);

      // Log camera position
      setInterval(() => {
        if (this.engine.camera) {
          const pos = this.engine.camera.position;
          // Logger.debug(`Camera at [${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}], Water at Y=${this.waterLevel}`);
        }
      }, 5000);
    }

    // Logger.info("WaterSystem initialized");
  }

  /**
   * Toggle water reflections without recreating water materials
   * @param {boolean} enabled - Whether to enable reflections
   */
  setReflectionEnabled(enabled) {
    // Skip if already in the requested state
    if (this.reflectionsEnabled === enabled) return;

    // Track state change
    const prevEnabled = this.reflectionsEnabled;
    this.reflectionsEnabled = enabled;

    // Update the internal quality tracker for consistency
    if (!enabled && this._waterQuality !== 'low') {
      this._waterQuality = 'low';
    } else if (enabled && this._waterQuality === 'low') {
      this._waterQuality = 'medium';
    }

    // Detect platform for platform-specific optimizations
    const isAndroid = /android/i.test(navigator.userAgent);
    // Logger.info(`Water reflections ${enabled ? 'enabled' : 'disabled'} without recreation (${isAndroid ? 'Android' : 'iOS/Desktop'})`);

    // Apply changes to existing water material
    if (this.water && this.water.material) {
      // Platform-agnostic changes (work on all platforms)
      if (this.water.material.uniforms) {
        // Update distortion scale
        if (this.water.material.uniforms.distortionScale) {
          this.water.material.uniforms.distortionScale.value = enabled ? 0.8 : 0.1;
        }

        // Explicitly set useReflection if it exists, but don't rely on it
        if (this.water.material.uniforms.useReflection) {
          this.water.material.uniforms.useReflection.value = enabled;
        }
      }

      // PLATFORM-SPECIFIC: Handle reflection method override for Android
      if (isAndroid) {
        // Use method replacement approach for Android
        if (!enabled) {
          // Store original onBeforeRender function if not already stored
          if (!this._savedAndroidBeforeRender && this.water.onBeforeRender) {
            this._savedAndroidBeforeRender = this.water.onBeforeRender;

            // Replace with minimal no-op function to prevent reflection updates
            this.water.onBeforeRender = (renderer, scene, camera) => {
              // Do nothing - skip reflection rendering entirely
              // This is the most direct way to prevent reflections on Android
            };
            // Logger.debug("Android: Replaced water onBeforeRender with no-op function");
          }
        } else if (this._savedAndroidBeforeRender) {
          // Restore original function when re-enabling
          this.water.onBeforeRender = this._savedAndroidBeforeRender;
          this._savedAndroidBeforeRender = null;
          // Logger.debug("Android: Restored original water onBeforeRender function");
        }
      } else {
        // NON-ANDROID: Handle reflection textures/render targets (iOS/Desktop approach)
        const reflector = this.water;
        if (reflector && reflector.getRenderTarget) {
          // Enable/disable reflection texture updates
          const target = reflector.getRenderTarget();
          if (target) {
            // Keep texture but stop updates if disabled
            if (!enabled) {
              // Store existing resolution to restore if re-enabled
              this._savedResolution = target.width;
              // Set to 2x2 minimal texture while disabled (near zero cost)
              target.setSize(2, 2);
            } else if (this._savedResolution) {
              // Restore previous resolution
              target.setSize(this._savedResolution, this._savedResolution);
            }
          }
        }
      }

      // Force material update on all platforms
      this.water.material.needsUpdate = true;
    }

    // Dispatch event for other systems
    if (this.engine.events) {
      this.engine.events.emit('water-reflection-changed', { enabled });
    }
  }

  /**
   * Set water quality with multiple parameters
   * This is a comprehensive method to control all water quality settings
   * @param {Object} options - Water quality options
   * @param {boolean} options.reflectionEnabled - Whether reflections are enabled
   * @param {string} options.quality - Quality level ('low', 'medium', 'high')
   * @param {number} options.renderDistance - Max distance for reflections
   * @param {number} options.textureSize - Size for reflection texture
   */
  setQuality(options) {
    // Logger.info('WaterSystem: Applying quality settings:', options);

    // First handle reflection toggle - this is the most basic operation
    // and doesn't require recreation of water
    if (options.reflectionEnabled !== undefined) {
      this.setReflectionEnabled(options.reflectionEnabled);
    }

    // Update internal quality tracker
    if (options.quality) {
      this._waterQuality = options.quality;
    }

    // For other settings, we currently don't have a way to apply them without
    // recreating the water. In a future update, more parameters could be made
    // dynamic, but for now we'll just log what we would have done.
    if (options.renderDistance) {
      // Logger.debug(`Water render distance would be set to ${options.renderDistance}`);
      // Would need to update internal variables and possibly recreate water
    }

    if (options.textureSize) {
      // Logger.debug(`Water texture size would be set to ${options.textureSize}`);
      // Would need recreation of water object with new texture size
    }

    // Note: In a more advanced implementation, we could store these settings
    // and apply them when/if water is recreated, or implement more dynamic
    // control over the existing water object.
  }


  async createWater() {
    // Clean up any existing water first
    if (this.water) {
      // Logger.info("Cleaning up existing water before creating new water");
      this.disposeWater();
    }

    // Platform-specific water creation strategies
    const userAgent = navigator.userAgent.toLowerCase();
    const isAndroid = /android/i.test(userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(userAgent);
    const isMobile = this.engine.settings && this.engine.settings.isMobile;

    // Logger.info(`WaterSystem: Platform detection - Android: ${isAndroid}, iOS: ${isIOS}, Mobile: ${isMobile}, UserAgent: ${userAgent}`);

    // Only use Android water on actual Android devices
    if (isAndroid) {
      // Logger.info("Creating Android simplified water implementation");
      await this.createAndroidSimplifiedWater();
      return;
    }

    // Use standard WebGL water for all other platforms (iOS, desktop, other mobile)
    // Logger.info("Creating standard WebGL water implementation");
    await this.createStandardWater();
  }

  disposeWater() {
    if (this.water) {
      this.scene.remove(this.water);
      if (this.water.geometry) this.water.geometry.dispose();
      if (this.water.material) {
        if (this.water.material.dispose) {
          this.water.material.dispose();
        }
      }
      this.water = null;
      // Logger.info("Existing water disposed");
    }
  }

  /**
   * Debug method to inspect water material settings
   * Call this from browser console: window.game.engine.systems.water.debugWaterMaterial()
   */
  debugWaterMaterial() {
    if (!this.water || !this.water.material) {
      // Logger.warn("No water material to debug");
      return;
    }

    const mat = this.water.material;
    // Logger.info("=== Water Material Debug ===");
    // Logger.info(`Type: ${mat.type}`);
    // Logger.info(`Depth Test: ${mat.depthTest}`);
    // Logger.info(`Depth Write: ${mat.depthWrite}`);
    // Logger.info(`Transparent: ${mat.transparent}`);
    // Logger.info(`Opacity: ${mat.opacity}`);
    // Logger.info(`Alpha Test: ${mat.alphaTest}`);

    if (mat.polygonOffset) {
      // Logger.info(`Polygon Offset: ${mat.polygonOffsetFactor}, ${mat.polygonOffsetUnits}`);
    }

    if (mat.uniforms) {
      // Logger.info("=== Water Uniforms ===");
      Object.keys(mat.uniforms).forEach(key => {
        const uniform = mat.uniforms[key];
        if (uniform.value !== undefined) {
          if (uniform.value.isVector3 || uniform.value.isColor) {
            // Logger.info(`${key}: (${uniform.value.x?.toFixed(3)}, ${uniform.value.y?.toFixed(3)}, ${uniform.value.z?.toFixed(3)})`);
          } else if (typeof uniform.value === 'number') {
            // Logger.info(`${key}: ${uniform.value.toFixed(3)}`);
          } else {
            // Logger.info(`${key}: ${uniform.value}`);
          }
        }
      });
    }

    // Logger.info("=== End Debug ===");
  }

  /**
   * Adjust water rendering settings to fix artifacts
   * Call this from browser console: window.game.engine.systems.water.fixRenderingArtifacts()
   */
  fixRenderingArtifacts() {
    if (!this.water || !this.water.material) {
      // Logger.warn("No water to fix");
      return;
    }

    const mat = this.water.material;

    // Try different combinations of settings to fix artifacts
    mat.depthTest = true;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -4; // Aggressive offset to prevent z-fighting with terrain
    mat.polygonOffsetUnits = -4;
    mat.transparent = true;
    mat.alphaTest = 0.01; // Lower threshold

    // Force update
    mat.needsUpdate = true;

    // Logger.info("Applied rendering fixes to water material");
    this.debugWaterMaterial();
  }

  /**
   * Debug shoreline positioning and levels
   * Call this from browser console: window.game.engine.systems.water.debugShoreline()
   */
  debugShoreline() {
    if (!this.engine.systems.world) {
      Logger.warn("World system not available for shoreline debug");
      return;
    }

    const world = this.engine.systems.world;
    // Logger.info("=== Shoreline Debug ===");
    // Logger.info(`World minHeight: ${world.minHeight}`);
    // Logger.info(`Water level: ${this.waterLevel}`);
    // Logger.info(`Beach starts at: ${world.minHeight + 35}`);
    // Logger.info(`Shoreline gap: ${(world.minHeight + 35 - this.waterLevel).toFixed(2)} units`);

    if (this.engine.camera) {
      const camPos = this.engine.camera.position;
      const terrainHeight = world.getTerrainHeight(camPos.x, camPos.z);
      // Logger.info(`Camera position: (${camPos.x.toFixed(0)}, ${camPos.y.toFixed(0)}, ${camPos.z.toFixed(0)})`);
      // Logger.info(`Terrain height at camera: ${terrainHeight.toFixed(2)}`);
      // Logger.info(`Camera above water: ${(camPos.y - this.waterLevel).toFixed(2)} units`);
    }

    // Logger.info("=== End Shoreline Debug ===");
  }

  /**
   * Create simplified water for Android devices
   * Avoids complex reflection/refraction issues on Android WebGL
   * @private
   */
  async createAndroidSimplifiedWater() {

    const textureLoader = new THREE.TextureLoader();
    const waterNormals = await new Promise((resolve) => {
      textureLoader.load('textures/2waternormals.jpg',
        (texture) => {
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(8, 8); // Lower repeat for Android to reduce artifacts
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = true;
          resolve(texture);
        },
        undefined,
        () => {
          // Fallback if texture fails to load
          // Logger.warn("Android water normals texture failed to load, using fallback");
          const fallbackCanvas = document.createElement('canvas');
          fallbackCanvas.width = fallbackCanvas.height = 1;
          const ctx = fallbackCanvas.getContext('2d');
          ctx.fillStyle = 'rgb(128, 128, 255)';
          ctx.fillRect(0, 0, 1, 1);
          const fallbackTexture = new THREE.CanvasTexture(fallbackCanvas);
          fallbackTexture.wrapS = fallbackTexture.wrapT = THREE.RepeatWrapping;
          resolve(fallbackTexture);
        }
      );
    });

    // Use optimized water size for Android
    const geometry = new THREE.PlaneGeometry(15000, 15000);
    // const material = new THREE.MeshBasicMaterial({
    //   color: 0x0066ff, // Bright blue for visibility
    //   side: THREE.DoubleSide,
    //   depthTest: true,
    //   transparent: false
    // });
    const material = new THREE.MeshStandardMaterial({
      // Use MeshPhongMaterial if you prefer its specular model
      color: 0x004466, // Consistent ocean blue color
      metalness: 0.3, // Slightly less metallic for more natural look
      roughness: 0.3, // Slightly rougher for better light scattering
      normalMap: waterNormals,
      normalScale: new THREE.Vector2(0.3, 0.3), // Adjust strength of bumps
      transparent: true, // Enable transparency for better blending
      depthTest: true,
      depthWrite: false, // Prevent depth conflicts
      opacity: 0.8, // Adjust transparency
      side: THREE.DoubleSide, // If needed
      alphaTest: 0.05 // Prevent rendering of nearly transparent pixels
    });

    // Aggressive polygon offset to prevent shoreline z-fighting
    material.polygonOffset = true;
    material.polygonOffsetFactor = -4;
    material.polygonOffsetUnits = -4;

    // Ensure proper depth handling for shoreline
    material.depthWrite = false;

    this.water = new THREE.Mesh(geometry, material);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, this.waterLevel, 0);
    this.water.renderOrder = 0;
    this.scene.add(this.water);

    // Ensure Android water also follows camera
    this.waterFollowsCamera = true;

    // Set state flags
    this.reflectionsEnabled = false;
    this._waterQuality = 'low';
    this.waterHigh = null;
    this.waterLow = null;

    // Logger.info(`Android simplified water created at y=${this.waterLevel}`);
  }

  /**
   * Create standard water with reflections for iOS and Desktop
   * @private
   */
  async createStandardWater() {
    // --- Determine Quality Settings (Texture Size, Distortion, Alpha) ---
    let textureSize = 2048;
    let distortionScale = 0.8;
    let alpha = 0.95;
    let waterColorHex = 0x001e0f; // Default desktop color

    // Shoreline transition width
    let shorelineWidth = 2.0;

    // Adjust quality based on internal state (_waterQuality)
    if (this.engine.settings && this.engine.settings.isMobile) {
      // Use the mobile-specific bright color
      waterColorHex = 0x0088cc; // More consistent blue for mobile visibility
      // Logger.debug('Mobile water color: 0x0088cc'); // Log the color for debugging

      switch (this._waterQuality) {
        case 'low': // Corresponds to reflectionsEnabled = false
          textureSize = 128;
          distortionScale = 0.0; // No distortion without reflections
          alpha = 0.85;
          break;
        case 'medium':
          textureSize = 256;
          distortionScale = 0.2;
          alpha = 0.9;
          break;
        case 'high':
        default:
          textureSize = 512;
          distortionScale = 0.4; // Keep distortion moderate even on high mobile
          alpha = 0.95;
          break;
      }
      // Logger.info(`Mobile Water: Quality='${this._waterQuality}', Reflections=${this.reflectionsEnabled}, TexSize=${textureSize}, Distortion=${distortionScale}`);
    } else {
      // Desktop quality settings (can still have high/medium/low if implemented)
      // For now, assume high for desktop
      textureSize = 1024; // Decent quality for desktop
      distortionScale = 0.8;
      alpha = 0.95;
      waterColorHex = 0x002244; // More realistic ocean blue for desktop
      // Logger.info(`Desktop Water: Quality='high', Reflections=${this.reflectionsEnabled}, TexSize=${textureSize}, Distortion=${distortionScale}, Color=0x${waterColorHex.toString(16)}`);
    }

    // --- Create Water Geometry and Object ---
    // Optimized water size for performance while covering horizon
    const waterGeometry = new THREE.PlaneGeometry(15000, 15000);

    // Load normals texture asynchronously
    const waterNormals = await new Promise((resolve, reject) => {
      new TextureLoader().load('textures/2waternormals.jpg',
        (texture) => {
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(16, 16); // Reduce repeat to prevent artifacts
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = true;
          resolve(texture);
        },
        undefined, // onProgress
        (error) => {
          // Logger.error("Failed to load water normals texture", error);
          // Create a fallback normal map (flat blue)
          const fallbackCanvas = document.createElement('canvas');
          fallbackCanvas.width = 1;
          fallbackCanvas.height = 1;
          const ctx = fallbackCanvas.getContext('2d');
          ctx.fillStyle = 'rgb(128, 128, 255)'; // Neutral normal color
          ctx.fillRect(0, 0, 1, 1);
          resolve(new THREE.CanvasTexture(fallbackCanvas));
        }
      );
    });


    this.water = new Water(waterGeometry, {
      textureWidth: textureSize,
      textureHeight: textureSize,
      waterNormals: waterNormals,
      sunDirection: new THREE.Vector3(), // Updated in update loop
      sunColor: 0xffffff,
      waterColor: waterColorHex,
      distortionScale: distortionScale,
      clipBias: 0.001,
      fog: this.scene.fog !== undefined,
      alpha: alpha
    });

    this.water.rotation.x = -Math.PI / 2;
    // --- POSITION FIX ---
    // Position at world origin initially, Y at calculated water level
    this.water.position.set(0, this.waterLevel, 0);
    // --- END POSITION FIX ---

    // Fix shoreline flickering and z-fighting with terrain
    if (this.water.material) {
      // Ensure proper depth testing for shoreline
      this.water.material.depthTest = true;
       this.water.material.depthWrite = false; // Prevent z-fighting with terrain

      // Aggressive polygon offset to prevent z-fighting with terrain
      this.water.material.polygonOffset = true;
      this.water.material.polygonOffsetFactor = -4;
      this.water.material.polygonOffsetUnits = -4;

      // Ensure proper blending
      this.water.material.transparent = true;
       this.water.material.alphaTest = 0.05; // Higher threshold for cleaner shoreline edges

      // Force material update
      this.water.material.needsUpdate = true;

      // Logger.info("Applied shoreline anti-flickering fixes to water material");
    }

    // Make water follow camera to prevent edge artifacts
    this.waterFollowsCamera = true;
    this._reflectionCameraInitialized = false;

    // --- Wrap onBeforeRender ---
    if (this.water.onBeforeRender) {
      this._originalOnBeforeRender = this.water.onBeforeRender; // Store original
    } else {
      // Should not happen with THREE.Water, but good practice
      this._originalOnBeforeRender = () => { };
    }

    // Assign the wrapper function
    this.water.onBeforeRender = (renderer, scene, camera) => {
      // Initialize reflection camera layers ONCE
      if (!this._reflectionCameraInitialized && this.water.material.uniforms.reflectionCamera) {
        const reflectionCamera = this.water.material.uniforms.reflectionCamera.value;
        reflectionCamera.layers.set(0); // Base layer
        reflectionCamera.layers.enable(1); // Regular scene objects
        // reflectionCamera.layers.enable(2); // Clouds (disabled for clean water reflection)
        reflectionCamera.layers.enable(10); // Sun layer (initially enabled)
        this._reflectionCameraInitialized = true;
        // Logger.info("Reflection camera initialized with layers.");
      }

       // Conditionally execute the original reflection rendering
       if (this.reflectionsEnabled && this._originalOnBeforeRender) {
         // Check if we're too close to skybox boundary (which could cause artifacts)
         const skyboxSystem = this.engine.systems.skybox;
         const cameraDistanceFromOrigin = camera.position.length();
         const skyboxBoundaryDistance = skyboxSystem ? skyboxSystem.skyboxSize * 0.9 : 4000;
         const isNearSkyboxBoundary = cameraDistanceFromOrigin > skyboxBoundaryDistance;

         if (isNearSkyboxBoundary) {
           // Near skybox boundary - reduce reflection quality to prevent artifacts
            // Logger.debug(`Near skybox boundary (${cameraDistanceFromOrigin.toFixed(0)} > ${skyboxBoundaryDistance.toFixed(0)}) - reducing reflection quality`);
           // Skip reflection update to prevent artifacts
           return;
         }

         // Check if sun should be visible in reflections using SkyboxSystem
         if (skyboxSystem && this._reflectionCameraInitialized) {
           const reflectionCamera = this.water.material.uniforms.reflectionCamera.value;

           // Use sun visibility from SkyboxSystem
           const isSunVisible = skyboxSystem.sunVisibility > 0.1;

           // Enable/disable sun layer (10) for reflection camera based on SkyboxSystem
           if (isSunVisible) {
             reflectionCamera.layers.enable(10);
           } else {
             reflectionCamera.layers.disable(10);
           }

           // Ensure other layers remain enabled
           reflectionCamera.layers.enable(0);
           reflectionCamera.layers.enable(1);
           // reflectionCamera.layers.enable(2); // Clouds (disabled for clean water reflection)

            // Logger.debug(`Water reflection: sun visible=${isSunVisible}, visibility=${skyboxSystem.sunVisibility.toFixed(2)}`);
         }

         // Call the original onBeforeRender using the water object as context
         this._originalOnBeforeRender.call(this.water, renderer, scene, camera);

      } else {
        // Reflections are disabled, skip the original onBeforeRender
        // Ensure the reflection map uniform is handled gracefully if needed
        // Option: Set reflection map to null or a dummy texture?
        // if (this.water.material.uniforms.tReflectionMap) {
        //    this.water.material.uniforms.tReflectionMap.value = null; // Or a dummy texture
        // }
        // For THREE.Water, simply skipping onBeforeRender might be enough
        // as it won't update the render target.

         // If reflections are off, ensure sun layer is disabled for reflection camera
         if (this._reflectionCameraInitialized) {
           const reflectionCamera = this.water.material.uniforms.reflectionCamera.value;
           reflectionCamera.layers.disable(10);
            // Logger.debug("Water reflections disabled - sun layer disabled in reflection camera");
         }
      }
    };

    this.scene.add(this.water);

    // Shoreline mesh removed
    this.shoreline = null; // No shoreline mesh
  }


  _update(deltaTime) {
    if (!this.water) return; // Safety check

    const isAndroid = this.isAndroid || /android/i.test(navigator.userAgent);

    // Make water follow camera on all platforms to prevent edge artifacts
    if (this.engine.camera && this.waterFollowsCamera) {
      const cameraPos = this.engine.camera.position;
      this.water.position.x = cameraPos.x;
      this.water.position.z = cameraPos.z;
      this.water.position.y = this.waterLevel;
    }

    // Platform-specific water updates
    if (isAndroid && this.engine.settings && this.engine.settings.isMobile) {
      // For Android, ensure water stays blue every frame
      if (this.water.material && this.water.material.color) {
        this.water.material.color.setHex(0x0066ff);
      }
    } else {
      // Normal update for other platforms
      this.updateStandardWater(deltaTime);
    }
  }

  /**
   * Update simplified Android water
   * @private
   */
  updateAndroidSimplifiedWater(deltaTime) {
    // ABSOLUTE MINIMAL UPDATE: Just enforce color and position
    if (!this.water) return;

    try {
      // Force pure blue every frame
      if (this.water.material && this.water.material.color) {
        // Set direct RGB values
        this.water.material.color.set(new THREE.Color(0, 0, 1));
      }

      // Keep water at consistent depth
      this.water.position.y = this.waterLevel - 5;
    } catch (e) {
      // Logger.error("Error in Android water update:", e);
    }
  }

  /**
   * Update standard water with reflections (iOS/Desktop)
   * @private
   */
  updateStandardWater(deltaTime) {
    // --- Animation Speed ---
    let animationSpeed = 0.8;

    try {
      // Apply mobile-specific optimizations
      if (this.engine.settings && this.engine.settings.isMobile) {
        // Adjust animation speed based on quality level
        animationSpeed = this._waterQuality === 'low' ? 0.3 :
          this._waterQuality === 'medium' ? 0.5 : 0.8;

        // CRITICAL: Ensure consistent water color on mobile in every frame
        // This is essential to prevent the brown water issue
        if (this.water.material && this.water.material.uniforms) {
          // Force water color in multiple uniforms to ensure it takes effect
          if (this.water.material.uniforms['waterColor']) {
            this.water.material.uniforms['waterColor'].value = new THREE.Color(0x0099ff);
          }

          // Also update baseColor if it exists (some shader variants use this)
          if (this.water.material.uniforms['baseColor']) {
            this.water.material.uniforms['baseColor'].value = new THREE.Color(0x0099ff);
          }

          // Reduce distortion on mobile for better stability
          if (this.water.material.uniforms['distortionScale']) {
            const distortion = this._waterQuality === 'low' ? 0.1 :
              this._waterQuality === 'medium' ? 0.3 : 0.5;
            this.water.material.uniforms['distortionScale'].value = distortion;
          }
        }
      }

      // Only update time uniform if it exists (with safety checks)
      if (this.water.material &&
        this.water.material.uniforms &&
        this.water.material.uniforms['time']) {

        // Cap deltaTime to prevent large jumps
        const cappedDelta = Math.min(deltaTime, 0.1);
        this.water.material.uniforms['time'].value += cappedDelta * animationSpeed;
      }

       // --- Sun Direction ---
       // Try to get sun direction from SkyboxSystem first, then fallback to SunSystem
       let sunDirection = new THREE.Vector3(0, 1, 0); // Default

       if (this.engine.systems.skybox && this.engine.systems.skybox.sunDirection) {
         sunDirection.copy(this.engine.systems.skybox.sunDirection);
       } else if (this.engine.systems.sun && this.engine.systems.sun.getSunDirection) {
         sunDirection = this.engine.systems.sun.getSunDirection();
       }

       if (this.water.material &&
           this.water.material.uniforms &&
           this.water.material.uniforms['sunDirection']) {
         this.water.material.uniforms['sunDirection'].value.copy(sunDirection);
       }

       // Also update _DirToLight uniform if it exists (for compatibility with SkyboxSystem)
       if (this.water.material &&
           this.water.material.uniforms &&
           this.water.material.uniforms['_DirToLight']) {
         this.water.material.uniforms['_DirToLight'].value.copy(sunDirection);
       }
    } catch (err) {
      // Graceful error handling to prevent crashes
      // Logger.error("Error in updateStandardWater:", err);
    }
  }

  isUnderwater(position) {
    return position.y < this.waterLevel;
  }

  getUnderwaterDepth(position) {
    if (!this.isUnderwater(position)) return 0;
    return this.waterLevel - position.y;
  }

  /**
   * Clean up reflection resources specifically
   */
  cleanupReflectionResources() {
    if (this.water && this.water.getRenderTarget) {
      const target = this.water.getRenderTarget();
      if (target) {
        target.dispose();
      }
    }

    // Clean up any additional reflection-related resources
    if (this.water && this.water.material) {
      if (this.water.material.uniforms && this.water.material.uniforms.tReflectionMap && this.water.material.uniforms.tReflectionMap.value) {
        this.water.material.uniforms.tReflectionMap.value.dispose();
      }
    }
  }

  /**
   * Clean up resources used by this system
   */
  dispose() {
    // Shoreline cleanup removed as shoreline mesh was removed

    // Clean up reflection resources first
    this.cleanupReflectionResources();

    // Clean up test interval if it exists
    if (this._testInterval) {
      clearInterval(this._testInterval);
      this._testInterval = null;
    }

    // Clean up diagnostic planes
    if (this.waterHigh) {
      this.scene.remove(this.waterHigh);
      if (this.waterHigh.geometry) this.waterHigh.geometry.dispose();
      if (this.waterHigh.material) this.waterHigh.material.dispose();
      this.waterHigh = null;
    }

    if (this.waterLow) {
      this.scene.remove(this.waterLow);
      if (this.waterLow.geometry) this.waterLow.geometry.dispose();
      if (this.waterLow.material) this.waterLow.material.dispose();
      this.waterLow = null;
    }

    if (this.water) {
      // IMPORTANT: Restore original onBeforeRender if we wrapped it
      if (this._originalOnBeforeRender) {
        this.water.onBeforeRender = this._originalOnBeforeRender;
        this._originalOnBeforeRender = null;
      }

      // IMPORTANT: Also restore the Android-specific onBeforeRender if it was saved
      if (this._savedAndroidBeforeRender) {
        this.water.onBeforeRender = this._savedAndroidBeforeRender;
        this._savedAndroidBeforeRender = null;
        // Logger.debug("Android: Restored original water render function during disposal");
      }

      this.scene.remove(this.water);
      // Safely dispose geometry and material
      if (this.water.geometry) this.water.geometry.dispose();
      if (this.water.material) {
        // Dispose water normals texture if it exists
        if (this.water.material.uniforms && this.water.material.uniforms.waterNormals && this.water.material.uniforms.waterNormals.value) {
          this.water.material.uniforms.waterNormals.value.dispose();
        }
        this.water.material.dispose();
      }
      this.water = null;
      // Logger.info("WaterSystem disposed.");
    }
  }
}