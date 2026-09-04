import * as THREE from "three";
import { Logger } from '../../../utils/Logger.js';
import { resolveAsset } from '../../../utils/assetPath.js';
import { CELESTIAL_DISTANCE_FRACTION } from './constants.js';

// The moon's original fixed distance, kept as the reference for its apparent
// (angular) size now that the render distance tracks the camera far plane.
const MOON_TRUE_DISTANCE = 8000;

/**
 * MoonSystem - Manages the moon appearance and night lighting
 */
export class MoonSystem {
  /**
   * Create a new MoonSystem
   * @param {AtmosphereSystem} atmosphereSystem - The parent atmosphere system
   */
  constructor(atmosphereSystem) {
    this.atmosphereSystem = atmosphereSystem;
    this.scene = atmosphereSystem.scene;
    this.engine = atmosphereSystem.engine;
    
    // Moon components
    this.moonMesh = null;
    this.moonLight = null;
    
    // Moon position tracking
    this.moonPosition = new THREE.Vector3();
  }
  
  /**
   * Initialize the moon system
   */
  async initialize() {
    // Load moon texture
    const textureLoader = new THREE.TextureLoader();
    const moonTexture = await new Promise((resolve) => {
      textureLoader.load(
        resolveAsset("/assets/textures/moon.jpg"),
        (texture) => resolve(texture),
        undefined,
        () => {
          Logger.warn("Failed to load moon texture, using fallback");
          // Create a fallback texture if the moon texture fails to load
          const canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 256;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#eeeeee';
          ctx.fillRect(0, 0, 256, 256);
          
          // Add some basic moon details
          for (let i = 0; i < 15; i++) {
            ctx.fillStyle = `rgba(100, 100, 120, ${Math.random() * 0.5})`;
            ctx.beginPath();
            ctx.arc(
              Math.random() * 256,
              Math.random() * 256,
              Math.random() * 30 + 5,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
          
          const fallbackTexture = new THREE.CanvasTexture(canvas);
          resolve(fallbackTexture);
        }
      );
    });
    
    // Create moon mesh - SMALLER for better visibility
    const moonGeometry = new THREE.SphereGeometry(150, 32, 32);
    const moonMaterial = new THREE.MeshBasicMaterial({
      map: moonTexture,
      fog: false,
      side: THREE.FrontSide,
      transparent: true,
      opacity: 1.0,
      depthTest: false // Render always on top like sun
    });
    
    this.moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
    this.moonMesh.renderOrder = 100; // Render moon after most other objects
    this.moonMesh.layers.set(10); // Same layer as sun for consistent rendering
    this.scene.add(this.moonMesh);
    
    // Add moonlight. Keep it origin-relative in the scene (NOT parented to the
    // camera-anchored mesh): only its DIRECTION matters, and (light at the arc
    // offset, target at world origin) stays correct wherever the camera flies —
    // the same trap the sun's light avoids.
    this.moonLight = new THREE.DirectionalLight(0xdedeff, 0.2);
    this.moonLight.position.set(0, 1, 0);
    this.scene.add(this.moonLight);
  }
  
  /**
   * Update the moon system
   * @param {number} delta - Time delta in seconds
   * @param {number} elapsed - Total elapsed time
   */
  update(delta, elapsed) {
    const timeOfDay = this.atmosphereSystem.getTimeOfDay();
    const nightFactor = this.atmosphereSystem.getNightFactor();
    const moonPhase = this.atmosphereSystem.getMoonPhase();
    const moonIllumination = this.atmosphereSystem.getMoonIllumination();

    // Simplified: Moon follows opposite path to sun
    // Sun angle based on time of day
    const sunAngle = (timeOfDay * Math.PI * 2) - (Math.PI / 2);
    // Moon is opposite to sun (PI radians offset)
    const moonAngle = sunAngle + Math.PI;

    // Calculate moon position on arc. Keep it INSIDE the camera far plane (and the
    // sky dome) or it gets clipped and the moon vanishes — it's camera-anchored, so
    // the absolute distance is arbitrary; only the direction matters.
    const moonDistance = ((this.engine.camera && this.engine.camera.far) || 5000) * CELESTIAL_DISTANCE_FRACTION;
    const x = Math.cos(moonAngle) * moonDistance;
    const y = Math.max(0, Math.sin(moonAngle) * moonDistance); // Only show when above horizon
    const z = 0;

    this.moonPosition.set(x, y, z);

    // Moon visible when above horizon AND at night. Angular threshold (~2.1
    // degrees, the old 300/8000 ratio) so it doesn't vary with the far plane.
    const isAboveHorizon = y > moonDistance * 0.0375;
    this.moonMesh.visible = isAboveHorizon && nightFactor > 0.1;

    // If visible, update position and appearance
    if (this.moonMesh.visible) {
      // Anchor to the camera so the moon, like the sun, rides at infinity —
      // moonPosition is an arc OFFSET around the viewer, never a world point.
      const cam = this.engine.camera;
      if (cam) this.moonMesh.position.copy(cam.position).add(this.moonPosition);
      else this.moonMesh.position.copy(this.moonPosition);

      // Make moon face camera
      if (cam) {
        this.moonMesh.lookAt(cam.position);
      }

      // Scale the sphere to the angular size it had at its original 8000
      // distance — moonDistance now tracks the far plane, so without this the
      // disc looms ~2x too big on desktop and shrinks ~5x on mobile.
      this.moonMesh.scale.setScalar(moonDistance / MOON_TRUE_DISTANCE);

      // Update moon appearance based on phase and night factor
      if (this.moonMesh.material) {
        const opacity = (0.7 + moonIllumination * 0.3) * nightFactor;
        this.moonMesh.material.opacity = opacity;
      }
    }

    // Update moonlight intensity. Keep a baseline so nights stay gently
    // moonlit even around the new moon - the night scene must remain
    // readable (the ambient floor handles the rest).
    if (this.moonLight) {
      // Origin-relative arc offset (like the sun's light) so the direction
      // toward the default world-origin target is camera-independent.
      this.moonLight.position.copy(this.moonPosition);
      this.moonLight.intensity = isAboveHorizon
        ? 0.35 * nightFactor * (0.3 + 0.7 * moonIllumination)
        : 0;
    }

    // Rotate moon texture for phase
    this.moonMesh.rotation.y = (moonPhase * Math.PI * 2) % (Math.PI * 2);
  }
  
  /**
   * Get the current moon position
   * @returns {THREE.Vector3} Moon position
   */
  getMoonPosition() {
    return this.moonPosition.clone();
  }


}