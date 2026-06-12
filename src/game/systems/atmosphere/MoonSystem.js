import * as THREE from "three";
import { Logger } from '../../../utils/Logger.js';

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
        "/assets/textures/moon.jpg",
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
    
    // Add moonlight
    this.moonLight = new THREE.DirectionalLight(0xdedeff, 0.2);
    this.moonLight.position.set(0, 1, 0);
    this.moonMesh.add(this.moonLight);
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

    // Calculate moon position on arc
    const moonDistance = 8000; // Distance from camera
    const x = Math.cos(moonAngle) * moonDistance;
    const y = Math.max(0, Math.sin(moonAngle) * moonDistance); // Only show when above horizon
    const z = 0;

    this.moonPosition.set(x, y, z);

    // Moon visible when above horizon AND at night
    const isAboveHorizon = y > 300; // Above minimum height
    this.moonMesh.visible = isAboveHorizon && nightFactor > 0.1;

    // If visible, update position and appearance
    if (this.moonMesh.visible) {
      this.moonMesh.position.copy(this.moonPosition);

      // Make moon face camera
      if (this.engine.camera) {
        this.moonMesh.lookAt(this.engine.camera.position);
      }

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