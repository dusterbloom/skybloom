import * as THREE from "three";
import { Logger } from '../../../utils/Logger.js';
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { deviceCapabilities } from "../../core/utils/DeviceCapabilities.js"; // Import device caps
import {
  SKY_ZENITH_KEYFRAMES,
  SKY_HORIZON_KEYFRAMES,
  FOG_DENSITY_KEYFRAMES,
  sampleKeyframes
} from "../../../config/SunConfig.js";

// Scratch white reused when softening the sun-glow tint (no per-frame allocation)
const _glowWhite = new THREE.Color(0xffffff);

/**
 * SkySystem - Manages the sky background and fog
 */
export class SkySystem {
  /**
   * Create a new SkySystem
   * @param {AtmosphereSystem} atmosphereSystem - The parent atmosphere system
   */
  constructor(atmosphereSystem) {
    this.atmosphereSystem = atmosphereSystem;
    this.scene = atmosphereSystem.scene;
    this.engine = atmosphereSystem.engine;
    this.sky = null;
    this.isFallbackSky = false; // Flag for fallback
    this.fallbackSkyMaterial = null; // Material for fallback

    // Scratch colors reused every frame (no per-frame allocation)
    this._zenithColor = new THREE.Color(0x77bbff);
    this._horizonColor = new THREE.Color(0xbcdfff);
    this._sunGlowColor = new THREE.Color(0xffd9a0); // warm halo tint, refreshed per frame
    this._sunDir = new THREE.Vector3(); // scratch for the per-frame sun direction

    // Per-vertex zenith/horizon blend factors + unit directions for the gradient sky
    this._skyGradientFactors = null;
    this._skyVertexDirs = null;
  }

  /**
   * Initialize the sky system
   */
  async initialize() {
    Logger.info("Initializing SkySystem...");

    // Use fallback sky for now to avoid rendering issues
    Logger.info("Using Fallback Sky");
    this.isFallbackSky = true;
    this.createFallbackSky();

    // NOTE: the renderer usually does not exist yet at init time
    // (RendererManager.setup() runs later). All renderer work (clear color)
    // is done lazily per-frame in updateSkyColors(), and tone mapping
    // exposure is owned by RendererManager (ACESFilmic @ 1.0).
    if (!this.getRenderer()) {
      Logger.debug('SkySystem: renderer not ready at init; per-frame updates will pick it up lazily');
    }

    // Initialize scene fog. After init, SkySystem is the ONLY system that
    // writes scene.fog - color and density are keyframed in updateSkyColors()
    // so distant terrain always melts into the horizon color.
    this.scene.fog = new THREE.FogExp2(0xbcdfff, 0.00022);

    Logger.info("SkySystem initialization complete");
  }

  /**
   * Lazily resolve the renderer (it may not exist during early init)
   * @returns {THREE.WebGLRenderer|null}
   */
  getRenderer() {
    if (this.engine.rendererManager && this.engine.rendererManager.renderer) {
      return this.engine.rendererManager.renderer;
    }
    return this.engine.renderer || null;
  }


  // Direct sun creation method removed - now using SunSystem

  createStandardSky() {
    // Create Three.js Sky
    this.sky = new Sky();
    
    // Scale the sky appropriately relative to camera far plane
    const farPlane = this.engine.camera.far;
    const skyboxScale = farPlane * 0.8; // Keep skybox within far plane
    this.sky.scale.setScalar(skyboxScale);
    
    // Adjust sky mesh geometry based on screen ratio for better rendering
    const screenRatio = window.innerWidth / window.innerHeight;
    const skyMesh = this.sky.geometry;
    skyMesh.parameters.widthSegments = Math.max(32, Math.floor(32 * screenRatio));
    skyMesh.parameters.heightSegments = Math.max(32, Math.floor(32 * screenRatio));
    
    this.scene.add(this.sky);

    const uniforms = this.sky.material.uniforms;
    uniforms['turbidity'].value = 8;
    uniforms['rayleigh'].value = 1;
    uniforms['mieCoefficient'].value = 0.025;
    uniforms['mieDirectionalG'].value = 0.999;
    
    // Fix seam issue by adjusting material settings
    this.sky.material.side = THREE.BackSide;
    this.sky.material.depthWrite = false;
  }

  createFallbackSky() {
    // Calculate appropriate size based on camera far plane
    const farPlane = this.engine.camera.far;
    const skyboxRadius = farPlane * 0.8; // Keep within far plane

    // Create a sphere geometry to act as the skybox
    // Use more segments for better quality on mobile (prevent visible seams)
    const segmentsWidth = deviceCapabilities.gpuTier === 'low' ? 24 : 32;
    const segmentsHeight = deviceCapabilities.gpuTier === 'low' ? 12 : 16;
    const geometry = new THREE.SphereGeometry(skyboxRadius, segmentsWidth, segmentsHeight);

    // Vertical gradient via vertex colors: horizon color at/below the horizon
    // blending to the zenith color overhead. Precompute each vertex's blend
    // factor once; updateFallbackSkyGradient() rewrites the colors per frame.
    const positions = geometry.getAttribute('position');
    const vertexCount = positions.count;
    this._skyGradientFactors = new Float32Array(vertexCount);
    this._skyVertexDirs = new Float32Array(vertexCount * 3); // unit dir per vertex, for sun glow
    for (let i = 0; i < vertexCount; i++) {
      const px = positions.getX(i) / skyboxRadius;
      const ny = positions.getY(i) / skyboxRadius; // -1 (below) .. 1 (zenith)
      const pz = positions.getZ(i) / skyboxRadius;
      const f = Math.max(0, Math.min(1, ny / 0.55)); // horizon band ~0..33 degrees
      this._skyGradientFactors[i] = Math.pow(f, 0.8);
      this._skyVertexDirs[i * 3] = px;
      this._skyVertexDirs[i * 3 + 1] = ny;
      this._skyVertexDirs[i * 3 + 2] = pz;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));

    // Vertex-colored material; tone mapping/color space handled like any
    // built-in material so the sky matches the lit terrain.
    this.fallbackSkyMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide, // Render inside of the sphere
      fog: false, // Fallback sky shouldn't be affected by fog
      depthWrite: false // Pure background - never occlude distant geometry
    });

    this.sky = new THREE.Mesh(geometry, this.fallbackSkyMaterial);
    this.sky.renderOrder = -1; // Render very first
    this.scene.add(this.sky);

    // Paint the initial gradient so the first frame isn't black
    this.updateFallbackSkyGradient();
  }

  /**
   * Rewrite the fallback sky's vertex colors from the current
   * horizon/zenith scratch colors. Cheap: a few hundred vertices.
   */
  updateFallbackSkyGradient() {
    if (!this.sky || !this._skyGradientFactors) return;
    const colorAttr = this.sky.geometry.getAttribute('color');
    if (!colorAttr) return;

    const arr = colorAttr.array;
    const factors = this._skyGradientFactors;
    const dirs = this._skyVertexDirs;
    const h = this._horizonColor;
    const z = this._zenithColor;

    // Sun-direction glow: a warm halo blooming around where the sun actually is,
    // strongest when it sits low (sunrise/sunset) and gone once it's below the
    // horizon. This is what makes the sky read as lit from a real, distant sun
    // instead of a flat vertical gradient.
    const sun = this.atmosphereSystem.sunSystem;
    let sx = 0, sy = 1, sz = 0, glowGate = 0;
    const TIGHTNESS = 3.5;   // higher = tighter halo around the sun
    const GLOW_MAX = 0.6;    // peak blend toward the glow colour
    if (sun && dirs && sun.getSunDirection) {
      const sd = sun.getSunDirection(this._sunDir);
      sx = sd.x; sy = sd.y; sz = sd.z;
      // Full halo whenever the sun is at/above the horizon; fade only as it sinks
      // below (twilight afterglow), off at night. Gate on the UNCLAMPED altitude:
      // sunPosition.y is clamped to -200 for the light, and its normalized y
      // (~-0.013) would hold this gate ~0.9 all night — a phantom sunset glow.
      let gateY = sy;
      if (typeof sun.rawSunAltitude === 'number' && sun.sunPosition) {
        const sp = sun.sunPosition;
        const rawLen = Math.sqrt(sp.x * sp.x + sun.rawSunAltitude * sun.rawSunAltitude + sp.z * sp.z);
        if (rawLen > 0) gateY = sun.rawSunAltitude / rawLen;
      }
      glowGate = Math.max(0, Math.min(1, gateY / 0.15 + 1.0));
      if (sun.sunMesh && sun.sunMesh.material) {
        this._sunGlowColor.copy(sun.sunMesh.material.color).lerp(_glowWhite, 0.25);
      }
    }
    const g = this._sunGlowColor;

    for (let i = 0; i < factors.length; i++) {
      const f = factors[i];
      const j = i * 3;
      let r = h.r + (z.r - h.r) * f;
      let gg = h.g + (z.g - h.g) * f;
      let b = h.b + (z.b - h.b) * f;
      if (glowGate > 0) {
        const dot = dirs[j] * sx + dirs[j + 1] * sy + dirs[j + 2] * sz;
        if (dot > 0) {
          const amt = Math.pow(dot, TIGHTNESS) * GLOW_MAX * glowGate;
          r += (g.r - r) * amt;
          gg += (g.g - gg) * amt;
          b += (g.b - b) * amt;
        }
      }
      arr[j] = r;
      arr[j + 1] = gg;
      arr[j + 2] = b;
    }
    colorAttr.needsUpdate = true;
  }



  updateSkyColors() {
    const timeOfDay = this.atmosphereSystem.getTimeOfDay();

    // --- Sample the shared atmosphere keyframes (same timeline the sun uses) ---
    sampleKeyframes(SKY_ZENITH_KEYFRAMES, timeOfDay, this._zenithColor);
    sampleKeyframes(SKY_HORIZON_KEYFRAMES, timeOfDay, this._horizonColor);
    const fogDensity = sampleKeyframes(FOG_DENSITY_KEYFRAMES, timeOfDay, null);

    // --- Fog: SkySystem is the single fog owner after init ---
    // Fog color IS the horizon color so distant terrain melts into the sky.
    // Guarded on FogExp2 so a special-effect fog override (if one is ever
    // active) is left alone.
    if (this.scene.fog && this.scene.fog.isFogExp2) {
      this.scene.fog.color.copy(this._horizonColor);
      this.scene.fog.density = fogDensity;
    }

    // --- Clear color tracks the horizon too (covers any undrawn background) ---
    const renderer = this.getRenderer();
    if (renderer) {
      renderer.setClearColor(this._horizonColor);
    }

    // --- Update the actual sky object ---
    if (this.isFallbackSky) {
      // Repaint the gradient sphere (horizon -> zenith)
      this.updateFallbackSkyGradient();
    } else if (this.sky && this.sky.material && this.sky.material.uniforms) {
      // Standard THREE.Sky path (currently unused - isFallbackSky is forced
      // true at init). Kept functional but without per-frame log spam.
      const uniforms = this.sky.material.uniforms;
      const sunPosition = this.engine.systems.sun.getSunPosition();
      uniforms['sunPosition'].value.copy(sunPosition.normalize());

      if (timeOfDay < 0.25) {
        const t = timeOfDay / 0.25;
        uniforms['turbidity'].value = 0.5 + t * 7.5;
        uniforms['rayleigh'].value = 0.05 + t * 0.95;
        uniforms['mieCoefficient'].value = 0.001 + t * 0.024;
      } else if (timeOfDay < 0.5) {
        const t = (timeOfDay - 0.25) / 0.25;
        uniforms['turbidity'].value = 8;
        uniforms['rayleigh'].value = 1 + t * 0.5;
        uniforms['mieCoefficient'].value = 0.025;
      } else if (timeOfDay < 0.75) {
        const t = (timeOfDay - 0.5) / 0.25;
        uniforms['turbidity'].value = 8 + t * 2;
        uniforms['rayleigh'].value = 1.5 - t * 0.5;
        uniforms['mieCoefficient'].value = 0.025;
      } else {
        const t = (timeOfDay - 0.75) / 0.25;
        uniforms['turbidity'].value = 10 - t * 9.5;
        uniforms['rayleigh'].value = 1 - t * 0.95;
        uniforms['mieCoefficient'].value = 0.025 - t * 0.024;
      }
    }
  }

  /**
   * Update the sky system
   * @param {number} delta - Time delta
   * @param {number} elapsed - Total elapsed time
   */
  update(delta, elapsed) {
    try {
      // Update sky colors based on time of day
      this.updateSkyColors();

      // Update sky position to follow camera
      this.updateSkyPosition();
    } catch (error) {
      Logger.error('SkySystem update failed:', error);
    }
  }

  /**
   * Update sky position to follow camera
   */
  updateSkyPosition() {
    // Make sure sky follows camera to avoid black areas
    if (this.sky && this.engine.camera) {
      this.sky.position.copy(this.engine.camera.position);
    }
  }
}