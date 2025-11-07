import * as THREE from "three";
import { System } from "../../core/System.js";
import { Logger } from "../../../utils/Logger.js";

/**
 * Procedural Skybox System based on Nugget8's implementation
 * Features dynamic day/night cycle with realistic atmospheric scattering
 */
export class SkyboxSystem extends System {
  constructor(engine) {
    super(engine, 'skybox');
    this.scene = engine.scene;
    this.camera = engine.camera;

    // Skybox geometry and material
    this.skybox = new THREE.Mesh();
    this.skyboxMaterial = null;

    // Skybox parameters - now dynamic based on camera
    this.baseSkyboxSize = 5000;
    this.skyboxSize = this.baseSkyboxSize;

    // Time and lighting parameters
    this.timeOfDay = 0.5; // 0 = midnight, 0.5 = noon, 1 = midnight
    this.sunDirection = new THREE.Vector3(0, 1, 0);
    this.moonDirection = new THREE.Vector3(0, -1, 0);

    // Horizon and astronomical parameters
    this.horizonOffset = 0; // Will be updated based on terrain
    this.seasonalTilt = 0; // Earth's axial tilt effect
    this.dayLength = 24; // Hours in a day

    // Sky colors
    this.daySkyColor = new THREE.Color(0.25, 0.4, 0.6);
    this.dayHorizonColor = new THREE.Color(0.75, 0.9, 1);
    this.nightSkyColor = new THREE.Color(0.06, 0.1, 0.15);
    this.nightHorizonColor = new THREE.Color(0.07, 0.13, 0.18);

    // Twilight colors
    this.earlyTwilightColor = new THREE.Color(1, 0.83, 0.5);
    this.lateTwilightColor = new THREE.Color(1, 0.333, 0.167);

    // Lighting parameters
    this.sunVisibility = 1.0;
    this.moonVisibility = 0.0;
    this.twilightVisibility = 0.0;
    this.twilightTime = 0.0;

    // Stars texture (will be generated procedurally)
    this.starsTexture = null;
    this.ditherTexture = null;

    // Sky rotation matrix for day/night cycle
    this.skyRotationMatrix = new THREE.Matrix3();
  }

  async _initialize() {
    Logger.info("🎨 Initializing Simple Skybox System...");

    try {
      // Start with a very simple working skybox
      this.createSimpleSkybox();

      Logger.info("🎨 Simple Skybox System initialized successfully ✅");

    } catch (error) {
      Logger.error("Failed to initialize Skybox System:", error);
      // Create ultra-simple fallback
      this.createBasicFallback();
    }
  }

  async generateTextures() {
    Logger.debug("Generating procedural skybox textures...");

    // Generate stars texture
    this.starsTexture = this.generateStarsTexture();

    // Generate dither texture for anti-aliasing
    this.ditherTexture = this.generateDitherTexture();

    Logger.debug("Procedural textures generated successfully");
  }

  generateStarsTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, size, size);

    // Generate random stars
    const starCount = 200;
    for (let i = 0; i < starCount; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const brightness = Math.random();
      const starSize = Math.random() * 2 + 1;

      ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
      ctx.beginPath();
      ctx.arc(x, y, starSize, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  generateDitherTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);

    // Generate Bayer dither pattern
    const bayer = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5]
    ];

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const patternX = x % 4;
        const patternY = y % 4;
        const value = bayer[patternY][patternX] / 16.0;

        const index = (y * size + x) * 4;
        imageData.data[index] = value * 255;     // R
        imageData.data[index + 1] = value * 255; // G
        imageData.data[index + 2] = value * 255; // B
        imageData.data[index + 3] = 255;         // A
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  createSkyboxGeometry() {
    Logger.debug("Creating skybox geometry...");

    // Create large sphere for skybox
    const geometry = new THREE.SphereGeometry(this.skyboxSize, 32, 32);
    // Flip normals so we see the inside
    geometry.scale(1, 1, -1);

    this.skybox.geometry = geometry;
  }

  createSkyboxMaterial() {
    Logger.debug("Creating skybox material...");

    this.skyboxMaterial = new THREE.ShaderMaterial({
      vertexShader: this.getSkyboxVertexShader(),
      fragmentShader: this.getSkyboxFragmentShader(),
      side: THREE.BackSide,
      uniforms: {
        _SkyRotationMatrix: { value: this.skyRotationMatrix },
        _DitherTexture: { value: this.ditherTexture },
        _DitherTextureSize: { value: new THREE.Vector2(64, 64) },
        _SunVisibility: { value: this.sunVisibility },
        _TwilightTime: { value: this.twilightTime },
        _TwilightVisibility: { value: this.twilightVisibility },
        _MoonVisibility: { value: this.moonVisibility },
        _GridSize: { value: 50.0 },
        _GridSizeScaled: { value: 50.0 / 6.0 },
        _Stars: { value: this.starsTexture },
        _SpecularVisibility: { value: 1.0 },
        _DirToLight: { value: this.sunDirection },
        _Light: { value: new THREE.Vector3(1, 1, 1) }
      }
    });

    this.skybox.material = this.skyboxMaterial;
  }

  getSkyboxVertexShader() {
    return `
      varying vec3 vWorldDirection;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `;
  }

  getSkyboxFragmentShader() {
    return `
      uniform mat3 _SkyRotationMatrix;
      uniform sampler2D _DitherTexture;
      uniform vec2 _DitherTextureSize;
      uniform float _SunVisibility;
      uniform float _TwilightTime;
      uniform float _TwilightVisibility;
      uniform float _MoonVisibility;
      uniform float _GridSize;
      uniform float _GridSizeScaled;
      uniform sampler2D _Stars;
      uniform float _SpecularVisibility;
      uniform vec3 _DirToLight;
      uniform vec3 _Light;

      varying vec3 vWorldDirection;

      const vec3 UP = vec3(0.0, 1.0, 0.0);
      const float DITHER_STRENGTH = 0.1;
      const vec3 DAY_SKY_COLOR = vec3(0.25, 0.4, 0.6);
      const vec3 DAY_HORIZON_COLOR = vec3(0.75, 0.9, 1);
      const vec3 EARLY_TWILIGHT_COLOR = vec3(1, 0.83, 0.5);
      const vec3 LATE_TWILIGHT_COLOR = vec3(1, 0.333, 0.167);
      const vec3 NIGHT_SKY_COLOR = vec3(0.06, 0.1, 0.15);
      const vec3 NIGHT_HORIZON_COLOR = vec3(0.07, 0.13, 0.18);
      const float SUN_SHARPNESS = 2000.0;
      const float SUN_SIZE = 5.0;
      const float MOON_SHARPNESS = 12000.0;
      const float MOON_SIZE = 5000.0;
      const float STARS_SHARPNESS = 50.0;
      const float STARS_SIZE = 10.0;
      const float WIDTH_SCALE = 1.0 / 6.0;
      const float WIDTH_SCALE_HALF = WIDTH_SCALE / 2.0;
      const vec3 STARS_COLORS[6] = vec3[6](
        vec3(1.0, 0.95, 0.9),
        vec3(1.0, 0.9, 0.9),
        vec3(0.9, 1.0, 1.0),
        vec3(0.9, 0.95, 1.0),
        vec3(1.0, 0.9, 1.0),
        vec3(1.0, 1.0, 1.0)
      );
      const float STARS_FALLOFF = 15.0;
      const float STARS_VISIBILITY = 450.0;

      float dither = 0.0;

      vec2 sampleCubeCoords(vec3 dir) {
        vec3 absDir = abs(dir);
        bool xPositive = dir.x > 0.0 ? true : false;
        bool yPositive = dir.y > 0.0 ? true : false;
        bool zPositive = dir.z > 0.0 ? true : false;
        float maxAxis = 1.0;
        float u = 0.0;
        float v = 0.0;
        float i = 0.0;

        if (xPositive && absDir.x >= absDir.y && absDir.x >= absDir.z) {
          maxAxis = absDir.x;
          u = -dir.z;
          v = dir.y;
          i = 0.0;
        }
        if (!xPositive && absDir.x >= absDir.y && absDir.x >= absDir.z) {
          maxAxis = absDir.x;
          u = dir.z;
          v = dir.y;
          i = 1.0;
        }
        if (yPositive && absDir.y >= absDir.x && absDir.y >= absDir.z) {
          maxAxis = absDir.y;
          u = dir.x;
          v = -dir.z;
          i = 2.0;
        }
        if (!yPositive && absDir.y >= absDir.x && absDir.y >= absDir.z) {
          maxAxis = absDir.y;
          u = dir.x;
          v = dir.z;
          i = 3.0;
        }
        if (zPositive && absDir.z >= absDir.x && absDir.z >= absDir.y) {
          maxAxis = absDir.z;
          u = dir.x;
          v = dir.y;
          i = 4.0;
        }
        if (!zPositive && absDir.z >= absDir.x && absDir.z >= absDir.y) {
          maxAxis = absDir.z;
          u = -dir.x;
          v = dir.y;
          i = 5.0;
        }

        u = i * WIDTH_SCALE + (u / maxAxis + 1.0) * WIDTH_SCALE_HALF;
        v = (v / maxAxis + 1.0) * 0.5;
        return vec2(u, v);
      }

      void sampleDither(vec2 fragCoord) {
        dither = (texture2D(_DitherTexture, (fragCoord - vec2(0.5)) / _DitherTextureSize).x - 0.5) * DITHER_STRENGTH;
      }

      vec3 sampleSkybox(vec3 dir) {
        vec3 viewDir = _SkyRotationMatrix * dir;

        float density = clamp(pow(1.0 - max(0.0, dot(dir, UP)) + dither, 2.0), 0.0, 1.0);

        float sunLight = dot(viewDir, UP);
        float sun = min(pow(max(0.0, sunLight), SUN_SHARPNESS) * SUN_SIZE, 1.0);

        float moonLight = -sunLight;
        float moon = min(pow(max(0.0, moonLight), MOON_SHARPNESS) * MOON_SIZE, 1.0);

        vec3 day = mix(DAY_SKY_COLOR, DAY_HORIZON_COLOR, density);
        vec3 twilight = mix(LATE_TWILIGHT_COLOR, EARLY_TWILIGHT_COLOR, _TwilightTime);
        vec3 night = mix(NIGHT_SKY_COLOR, NIGHT_HORIZON_COLOR, density);

        vec3 sky = mix(night, day, _SunVisibility);
        sky = mix(sky, twilight, density * clamp(sunLight * 0.5 + 0.5 + dither, 0.0, 1.0) * _TwilightVisibility);

        vec2 cubeCoords = sampleCubeCoords(viewDir);
        vec4 gridValue = texture2D(_Stars, cubeCoords);

        vec2 gridCoords = vec2(cubeCoords.x * _GridSizeScaled, cubeCoords.y * _GridSize);
        vec2 gridCenterCoords = floor(gridCoords) + gridValue.xy;
        float stars = max(min(pow(1.0 - min(distance(gridCoords, gridCenterCoords), 1.0), STARS_SHARPNESS) * gridValue.z * STARS_SIZE, 1.0), moon);
        stars *= min(exp(-dot(sky, vec3(1.0)) * STARS_FALLOFF) * STARS_VISIBILITY, 1.0);

        sky = mix(sky, max(STARS_COLORS[int(gridValue.w * 6.0)], vec3(moon)), stars);
        sky = mix(sky, vec3(1.0), sun);

        return sky;
      }

      void main() {
        sampleDither(gl_FragCoord.xy);
        vec3 skyColor = sampleSkybox(normalize(vWorldDirection));
        gl_FragColor = vec4(skyColor, 1.0);
      }
    `;
  }

  _update(deltaTime) {
    if (!this._initialized) return;

    // Update time of day (simple day/night cycle)
    this.timeOfDay += deltaTime * 0.0002; // Slow cycle
    if (this.timeOfDay > 1.0) this.timeOfDay = 0.0;

    // Update skybox position to follow camera
    this.updateSkyboxPosition();

    // Calculate horizon offset based on terrain
    this.updateHorizonOffset();

    // Calculate sun direction based on time of day and horizon
    this.calculateSunPosition();

    // Calculate visibility values
    this.updateVisibility();

    // Update scene fog based on time of day
    this.updateSceneFog();

    // Update shader uniforms if they exist
    this.updateShaderUniforms();
  }

  updateSkyboxPosition() {
    if (!this.skybox || !this.camera) return;

    // Make skybox follow camera position
    this.skybox.position.copy(this.camera.position);

    // Scale skybox size based on camera far plane to prevent boundary issues
    const targetSize = Math.max(this.baseSkyboxSize, this.camera.far * 0.8);
    if (Math.abs(this.skyboxSize - targetSize) > 1) {
      this.skyboxSize = targetSize;
      // Update geometry if size changed significantly
      if (this.skybox.geometry) {
        this.skybox.geometry.dispose();
        this.skybox.geometry = new THREE.SphereGeometry(this.skyboxSize, 32, 32);
        this.skybox.geometry.scale(1, 1, -1); // Flip normals to see inside
      }
    }
  }

  updateHorizonOffset() {
    // Get terrain height at camera position for horizon calculations
    if (this.engine.systems.world && this.camera) {
      try {
        const terrainHeight = this.engine.systems.world.getTerrainHeight(
          this.camera.position.x,
          this.camera.position.z
        );
        this.horizonOffset = terrainHeight || 0;
      } catch (error) {
        this.horizonOffset = 0;
        Logger.warn("Could not get terrain height for horizon calculation:", error.message);
      }
    } else {
      this.horizonOffset = 0;
    }
  }

  calculateSunPosition() {
    // Convert time of day to angle (0 = midnight, π = noon, 2π = midnight)
    const timeAngle = this.timeOfDay * Math.PI * 2;

    // Calculate sun altitude (height above mathematical horizon)
    // Sun rises at -π/2, sets at π/2, peaks at noon
    const baseAltitude = Math.sin(timeAngle - Math.PI);
    const maxSunAltitude = Math.PI / 2.5; // ~72 degrees max above horizon (more realistic)
    const sunAltitude = baseAltitude * maxSunAltitude;

    // Calculate sun azimuth (East-West position)
    // Sun moves from East (-π/2) to West (π/2)
    const sunAzimuth = timeAngle - Math.PI;

    // Adjust for terrain horizon - sun should appear to rise from terrain, not just mathematical horizon
    // If camera is above terrain, sun appears lower on horizon
    const cameraHeightAboveTerrain = this.camera ? Math.max(0, this.camera.position.y - this.horizonOffset) : 0;
    const terrainAdjustment = Math.min(cameraHeightAboveTerrain * 0.001, Math.PI / 6); // Max 30 degree adjustment
    const adjustedSunAltitude = sunAltitude - terrainAdjustment;

    // Convert to direction vector relative to camera
    const cosAlt = Math.cos(adjustedSunAltitude);
    this.sunDirection.set(
      Math.sin(sunAzimuth) * cosAlt,  // East-West
      Math.sin(adjustedSunAltitude),  // Up-Down (adjusted for terrain)
      Math.cos(sunAzimuth) * cosAlt   // North-South
    );

    // Calculate moon position (opposite to sun)
    const moonAltitude = -adjustedSunAltitude; // Moon is opposite to sun
    const moonAzimuth = sunAzimuth + Math.PI; // 180 degrees from sun
    const cosMoonAlt = Math.cos(moonAltitude);
    this.moonDirection.set(
      Math.sin(moonAzimuth) * cosMoonAlt,
      Math.sin(moonAltitude),
      Math.cos(moonAzimuth) * cosMoonAlt
    );
  }

  updateVisibility() {
    // Calculate sun visibility based on altitude above horizon
    const sunAltitude = Math.asin(Math.max(-1, Math.min(1, this.sunDirection.y)));
    const sunDegrees = sunAltitude * 180 / Math.PI;

    // Sun is visible when above horizon (with some atmospheric effect)
    const horizonThreshold = -6; // Sun visible 6 degrees below horizon
    this.sunVisibility = Math.max(0, Math.min(1, (sunDegrees - horizonThreshold) / 10));

    // Moon visibility (opposite of sun)
    const moonAltitude = Math.asin(Math.max(-1, Math.min(1, this.moonDirection.y)));
    const moonDegrees = moonAltitude * 180 / Math.PI;
    this.moonVisibility = Math.max(0, Math.min(1, (moonDegrees - horizonThreshold) / 10));

    // Twilight visibility during transitions
    this.twilightVisibility = 0;
    if (sunDegrees > -6 && sunDegrees < 6) {
      this.twilightVisibility = 1 - Math.abs(sunDegrees) / 6;
    }
  }

  updateSceneFog() {
    if (!this.scene || !this.scene.fog) return;

    // Adjust fog color and density based on time of day
    let fogColor, fogDensity;

    if (this.timeOfDay < 0.25) {
      // Night to dawn - deep blue fog
      const t = this.timeOfDay / 0.25;
      fogColor = new THREE.Color().lerpColors(
        new THREE.Color(0x0a0a1a), // Deep night blue
        new THREE.Color(0x4a5a7a), // Dawn blue
        t
      );
      fogDensity = 0.0004 + t * 0.0002; // Denser at night
    } else if (this.timeOfDay < 0.75) {
      // Dawn to dusk - lighter blue fog
      const t = (this.timeOfDay - 0.25) / 0.5;
      fogColor = new THREE.Color().lerpColors(
        new THREE.Color(0x4a5a7a), // Dawn blue
        new THREE.Color(0x87CEEB), // Day sky blue
        t
      );
      fogDensity = 0.0003; // Standard density during day
    } else {
      // Dusk to night - transition to night colors
      const t = (this.timeOfDay - 0.75) / 0.25;
      fogColor = new THREE.Color().lerpColors(
        new THREE.Color(0x87CEEB), // Day sky blue
        new THREE.Color(0x0a0a1a), // Deep night blue
        t
      );
      fogDensity = 0.0003 + t * 0.0003; // Getting denser toward night
    }

    // Apply fog settings to scene (but keep minimum density for atmosphere)
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.density = Math.max(fogDensity, 0.00015); // Minimum fog for atmospheric depth
  }

  updateShaderUniforms() {
    if (!this.skyboxMaterial || !this.skyboxMaterial.uniforms) return;

    // Only update time of day - pure gradient skybox
    if (this.skyboxMaterial.uniforms._TimeOfDay) {
      this.skyboxMaterial.uniforms._TimeOfDay.value = this.timeOfDay;
    }
  }

  // Match Nugget8's SetSkyboxUniforms approach
  setSkyboxUniforms(material) {
    if (!material || !material.uniforms) return;

    // Add skybox uniforms to the material
    material.uniforms._SkyRotationMatrix = { value: this.skyRotationMatrix };
    material.uniforms._SunVisibility = { value: this.sunVisibility };
    material.uniforms._MoonVisibility = { value: this.moonVisibility };
    material.uniforms._DirToLight = { value: this.sunDirection };

    Logger.debug("Set skybox uniforms for material");
  }

  createSimpleSkybox() {
    Logger.info("Creating dynamic skybox with horizon-based sun positioning...");

    try {
      // Create large sphere for skybox
      const geometry = new THREE.SphereGeometry(this.skyboxSize, 32, 32);
      geometry.scale(1, 1, -1); // Flip normals to see inside

      // Position skybox at camera initially
      if (this.camera) {
        this.skybox.position.copy(this.camera.position);
      }

      // PURE GRADIENT SKYBOX - No celestial rendering
      // All celestial objects (sun/moon/stars) handled by dedicated mesh systems
      this.skyboxMaterial = new THREE.ShaderMaterial({
        vertexShader: `
          varying vec3 vWorldDirection;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);

            // Calculate direction from camera to vertex
            vWorldDirection = normalize(position.xyz);

            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: `
          uniform float _TimeOfDay;
          varying vec3 vWorldDirection;

          void main() {
            // Calculate horizon factor (0 = horizon, 1 = zenith/nadir)
            float horizonFactor = abs(vWorldDirection.y);

            // Sky colors for different times of day
            vec3 skyColor;
            vec3 horizonColor;

            if (_TimeOfDay < 0.25) {
              // Night to dawn (0.0 - 0.25)
              float t = _TimeOfDay / 0.25;
              vec3 nightSky = vec3(0.02, 0.05, 0.15);
              vec3 nightHorizon = vec3(0.05, 0.08, 0.2);
              vec3 dawnSky = vec3(0.3, 0.4, 0.6);
              vec3 dawnHorizon = vec3(0.8, 0.5, 0.3);

              skyColor = mix(nightSky, dawnSky, t);
              horizonColor = mix(nightHorizon, dawnHorizon, t);

            } else if (_TimeOfDay < 0.75) {
              // Day (0.25 - 0.75)
              float t = (_TimeOfDay - 0.25) / 0.5;
              vec3 dawnSky = vec3(0.3, 0.4, 0.6);
              vec3 dawnHorizon = vec3(0.8, 0.5, 0.3);
              vec3 daySky = vec3(0.4, 0.6, 0.9);
              vec3 dayHorizon = vec3(0.7, 0.8, 0.95);
              vec3 duskSky = vec3(0.3, 0.4, 0.6);
              vec3 duskHorizon = vec3(0.9, 0.4, 0.2);

              if (t < 0.5) {
                // Dawn to midday
                float tt = t * 2.0;
                skyColor = mix(dawnSky, daySky, tt);
                horizonColor = mix(dawnHorizon, dayHorizon, tt);
              } else {
                // Midday to dusk
                float tt = (t - 0.5) * 2.0;
                skyColor = mix(daySky, duskSky, tt);
                horizonColor = mix(dayHorizon, duskHorizon, tt);
              }

            } else {
              // Dusk to night (0.75 - 1.0)
              float t = (_TimeOfDay - 0.75) / 0.25;
              vec3 duskSky = vec3(0.3, 0.4, 0.6);
              vec3 duskHorizon = vec3(0.9, 0.4, 0.2);
              vec3 nightSky = vec3(0.02, 0.05, 0.15);
              vec3 nightHorizon = vec3(0.05, 0.08, 0.2);

              skyColor = mix(duskSky, nightSky, t);
              horizonColor = mix(duskHorizon, nightHorizon, t);
            }

            // Blend between horizon and sky based on view angle
            float blendFactor = pow(horizonFactor, 0.6);
            vec3 finalColor = mix(horizonColor, skyColor, blendFactor);

            gl_FragColor = vec4(finalColor, 1.0);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: true,
        fog: false,
        uniforms: {
          _TimeOfDay: { value: 0.5 }
        }
      });

      this.skybox = new THREE.Mesh(geometry, this.skyboxMaterial);
      this.skybox.renderOrder = -1; // Render first
      this.scene.add(this.skybox);

      Logger.info("Simple skybox created successfully");
    } catch (error) {
      Logger.error("Failed to create simple skybox:", error);
      this.createBasicFallback();
    }
  }

  createBasicFallback() {
    Logger.warn("Creating ultra-basic fallback skybox...");

    // Absolute simplest possible skybox
    const geometry = new THREE.SphereGeometry(this.skyboxSize, 8, 8);
    geometry.scale(1, 1, -1);

    const material = new THREE.MeshBasicMaterial({
      color: 0x87CEEB, // Sky blue
      side: THREE.BackSide
    });

    this.skybox = new THREE.Mesh(geometry, material);
    this.scene.add(this.skybox);

    Logger.info("Basic fallback skybox created");
  }

  createFallbackSkybox() {
    Logger.warn("Creating fallback skybox...");

    // Simple gradient skybox
    const geometry = new THREE.SphereGeometry(this.skyboxSize, 16, 16);
    geometry.scale(1, 1, -1);

    const material = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vWorldDirection;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldDirection;
        void main() {
          float height = vWorldDirection.y * 0.5 + 0.5;
          vec3 skyColor = mix(vec3(0.1, 0.3, 0.6), vec3(0.5, 0.7, 1.0), height);
          gl_FragColor = vec4(skyColor, 1.0);
        }
      `,
      side: THREE.BackSide
    });

    this.skybox.geometry = geometry;
    this.skybox.material = material;
    this.scene.add(this.skybox);

    Logger.info("Fallback skybox created");
  }

  updateSkyRotation() {
    // Rotate sky based on time of day
    const rotationAngle = this.timeOfDay * Math.PI * 2;
    const rotationMatrix = new THREE.Matrix4().makeRotationZ(rotationAngle);
    this.skyRotationMatrix.setFromMatrix4(rotationMatrix);

    // Note: The current simple skybox doesn't use rotation matrix uniforms
    // The sun/moon position is controlled via _DirToLight uniform instead
    if (this.skyboxMaterial && this.skyboxMaterial.uniforms._SkyRotationMatrix) {
      this.skyboxMaterial.uniforms._SkyRotationMatrix.value = this.skyRotationMatrix;
    }
  }

  updateLighting() {
    // Update sun direction
    const sunAngle = (this.timeOfDay - 0.5) * Math.PI;
    this.sunDirection.set(Math.sin(sunAngle), Math.cos(sunAngle), 0);

    // Update moon direction (opposite to sun)
    this.moonDirection.copy(this.sunDirection).multiplyScalar(-1);

    // Update visibility values
    this.sunVisibility = Math.max(0, Math.cos(sunAngle));
    this.moonVisibility = Math.max(0, -Math.cos(sunAngle));

    // Twilight calculations
    const twilightRange = 0.1;
    const twilightStart = 0.4;
    const twilightEnd = 0.6;

    if (this.timeOfDay < twilightStart) {
      this.twilightVisibility = 0;
    } else if (this.timeOfDay < twilightStart + twilightRange) {
      this.twilightVisibility = (this.timeOfDay - twilightStart) / twilightRange;
      this.twilightTime = 0; // Early twilight
    } else if (this.timeOfDay < twilightEnd - twilightRange) {
      this.twilightVisibility = 1;
      this.twilightTime = (this.timeOfDay - (twilightStart + twilightRange)) / (twilightEnd - twilightStart - 2 * twilightRange);
    } else if (this.timeOfDay < twilightEnd) {
      this.twilightVisibility = (twilightEnd - this.timeOfDay) / twilightRange;
      this.twilightTime = 1; // Late twilight
    } else {
      this.twilightVisibility = 0;
    }

    // Update material uniforms (with safety checks for optional uniforms)
    if (this.skyboxMaterial && this.skyboxMaterial.uniforms) {
      if (this.skyboxMaterial.uniforms._SunVisibility) {
        this.skyboxMaterial.uniforms._SunVisibility.value = this.sunVisibility;
      }
      if (this.skyboxMaterial.uniforms._MoonVisibility) {
        this.skyboxMaterial.uniforms._MoonVisibility.value = this.moonVisibility;
      }
      if (this.skyboxMaterial.uniforms._TwilightVisibility) {
        this.skyboxMaterial.uniforms._TwilightVisibility.value = this.twilightVisibility;
      }
      if (this.skyboxMaterial.uniforms._TwilightTime) {
        this.skyboxMaterial.uniforms._TwilightTime.value = this.twilightTime;
      }
      if (this.skyboxMaterial.uniforms._DirToLight) {
        this.skyboxMaterial.uniforms._DirToLight.value.copy(this.sunDirection);
      }
    }
  }

  _update(deltaTime) {
    // Update time of day (slow cycle for demo)
    this.timeOfDay += deltaTime * 0.01;
    if (this.timeOfDay > 1) this.timeOfDay = 0;

    // Update sky rotation and lighting
    this.updateSkyRotation();
    this.updateLighting();
  }

  setTimeOfDay(time) {
    this.timeOfDay = Math.max(0, Math.min(1, time));
    this.updateSkyRotation();
    this.updateLighting();
  }

  getSunDirection() {
    return this.sunDirection.clone();
  }

  getMoonDirection() {
    return this.moonDirection.clone();
  }

  dispose() {
    Logger.info("Disposing Skybox System...");

    if (this.skybox) {
      this.scene.remove(this.skybox);
      if (this.skybox.geometry) this.skybox.geometry.dispose();
      if (this.skybox.material) this.skybox.material.dispose();
    }

    if (this.starsTexture) this.starsTexture.dispose();
    if (this.ditherTexture) this.ditherTexture.dispose();

    Logger.info("Skybox System disposed");
  }
}