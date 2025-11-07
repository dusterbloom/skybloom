import * as THREE from "three";
import { Logger } from '../../../utils/Logger.js';

/**
 * CloudSystem - Manages cloud formations and movement
 */
export class CloudSystem {
  /**
   * Create a new CloudSystem
   * @param {AtmosphereSystem} atmosphereSystem - The parent atmosphere system
   */
  constructor(atmosphereSystem) {
    this.atmosphereSystem = atmosphereSystem;
    this.scene = atmosphereSystem.scene;
    this.engine = atmosphereSystem.engine;
    
    // Cloud collection
    this.clouds = [];
    
    // Configuration - Enhanced for cozy world
    this.cloudCount = 100; // More clouds for a livelier sky
    this.cloudSpread = 3000; // Spread clouds wider
    this.cloudHeight = 600; // Lower clouds for more presence
  }
  
  /**
   * Initialize the cloud system
   */
  async initialize() {
    // Create volumetric clouds
    this.createVolumetricClouds();
  }
  
  /**
   * Create cloud sprite material
   * @returns {THREE.SpriteMaterial} Cloud material
   */
  createCloudSpriteMaterial() {
    // Use a texture loader with fallback
    const textureLoader = new THREE.TextureLoader();
    
    // Try to load cloud texture, with fallback
    return new Promise((resolve) => {
      textureLoader.load(
        '/assets/textures/particles.png',
        (texture) => {
          const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.4,  // Subtle clouds
            blending: THREE.NormalBlending,  // Normal blending instead of additive
            depthWrite: false
          });
          resolve(material);
        },
        undefined,
        () => {
          Logger.warn('Error loading cloud texture, using fallback');
          // Create a simple cloud texture as fallback
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 128;
          const ctx = canvas.getContext('2d');

          // Draw a soft cloud shape
          const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
          gradient.addColorStop(0, 'rgba(240, 245, 255, 0.9)');
          gradient.addColorStop(0.5, 'rgba(230, 240, 255, 0.5)');
          gradient.addColorStop(1, 'rgba(220, 235, 255, 0)');

          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, 128, 128);

          const texture = new THREE.CanvasTexture(canvas);
          const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.4,  // Subtle clouds
            blending: THREE.NormalBlending,  // Normal blending
            depthWrite: false
          });

          resolve(material);
        }
      );
    });
  }
  
  /**
   * Create volumetric clouds
   */
  async createVolumetricClouds() {
    Logger.info('Creating volumetric clouds...');
    this.clouds = [];
    
    const cloudMaterial = await this.createCloudSpriteMaterial();
    
    // Check if player exists, if not use a default position
    const player = this.engine.systems.player?.localPlayer;
    const playerPos = player ? player.position : new THREE.Vector3(0, 0, 0);
    
    for (let i = 0; i < this.cloudCount; i++) {
      const cloud = new THREE.Sprite(cloudMaterial.clone());

      // Make clouds visible but not overwhelming
      const scale = 500 + Math.random() * 400;
      cloud.scale.set(scale, scale * 0.7, 1);
      
      // Position clouds in a circle around player or origin
      const radius = 1000 + Math.random() * 3000;
      const theta = Math.random() * Math.PI * 2;
      
      cloud.position.set(
        playerPos.x + radius * Math.cos(theta),
        this.cloudHeight + Math.random() * 400,
        playerPos.z + radius * Math.sin(theta)
      );
      
      // Add cloud movement properties
      cloud.userData = {
        rotationSpeed: (Math.random() - 0.5) * 0.01,
        horizontalSpeed: (Math.random() - 0.5) * 10,
        verticalFactor: Math.random() * 5,
        timeOffset: Math.random() * 1000
      };
      
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
    
    Logger.info(`Created ${this.cloudCount} clouds`);
  }
  
  /**
   * Update the cloud system
   * @param {number} delta - Time delta in minutes
   */
  update(delta) {
    if (!this.clouds || this.clouds.length === 0) return;
    
    const player = this.engine.systems.player?.localPlayer;
    if (!player) {
      // If player not available, update clouds but don't position them relative to player
      const time = this.atmosphereSystem.elapsed;
      
      // Just update cloud positions without player-relative positioning
      this.clouds.forEach((cloud) => {
        // Update cloud rotation
        cloud.material.rotation += cloud.userData.rotationSpeed * delta;
        
        // Update cloud position
        cloud.position.x += cloud.userData.horizontalSpeed * delta;
        cloud.position.z += cloud.userData.horizontalSpeed * 0.5 * delta;
        
        // Add slight vertical bobbing
        cloud.position.y += 
          Math.sin(time * 0.001 + cloud.userData.timeOffset) * 
          cloud.userData.verticalFactor * 
          delta;
      });
      
      return;
    }
    
    const time = this.atmosphereSystem.elapsed;
    
    // Update each cloud
    this.clouds.forEach((cloud) => {
      // Update cloud rotation
      cloud.material.rotation += cloud.userData.rotationSpeed * delta;
      
      // Update cloud position
      cloud.position.x += cloud.userData.horizontalSpeed * delta;
      cloud.position.z += cloud.userData.horizontalSpeed * 0.5 * delta;
      
      // Add slight vertical bobbing
      cloud.position.y += 
        Math.sin(time * 0.001 + cloud.userData.timeOffset) * 
        cloud.userData.verticalFactor * 
        delta;
      
      // Check if cloud is too far from player
      const distX = cloud.position.x - player.position.x;
      const distZ = cloud.position.z - player.position.z;
      const distSq = distX * distX + distZ * distZ;
      
      // If cloud is too far, move it to the other side of the play area
      if (distSq > 9000000) { // 3000^2
        const angle = Math.random() * Math.PI * 2;
        const radius = 2000 + Math.random() * 500;
        
        cloud.position.x = player.position.x + radius * Math.cos(angle);
        cloud.position.z = player.position.z + radius * Math.sin(angle);
      }
    });
  }
}
