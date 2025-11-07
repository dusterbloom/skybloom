import * as THREE from "three";
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';

/**
 * AmbientLifeSystem - Adds life to the world with birds and butterflies
 */
export class AmbientLifeSystem extends System {
  constructor(engine) {
    super(engine, 'ambientLife');
    this.scene = engine.scene;
    this.camera = engine.camera;

    // Bird flock
    this.birds = [];
    this.birdCount = 30;
    this.birdSpread = 1500;
    this.birdHeight = 150; // Base height for birds

    // Butterfly swarms (optional, lighter weight)
    this.butterflies = [];
    this.butterflyCount = 20;
    this.butterflySpread = 500;
  }

  async _initialize() {
    Logger.info("🐦 Initializing Ambient Life System...");

    // Create birds
    this.createBirds();

    // Create butterflies
    this.createButterflies();

    Logger.info("🐦 Ambient Life System initialized ✅");
  }

  /**
   * Create simple bird sprites
   */
  createBirds() {
    // Create a simple bird shape using canvas
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Draw a more visible bird silhouette (V-shaped wings)
    ctx.fillStyle = 'rgba(50, 50, 50, 1.0)';
    ctx.beginPath();
    // Left wing
    ctx.moveTo(32, 28);
    ctx.lineTo(8, 36);
    ctx.lineTo(32, 32);
    // Right wing
    ctx.lineTo(56, 36);
    ctx.lineTo(32, 28);
    ctx.closePath();
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1.0,
      depthTest: true,
      depthWrite: false
    });

    const playerPos = this.camera.position;

    for (let i = 0; i < this.birdCount; i++) {
      const bird = new THREE.Sprite(material.clone());

      // Much larger size for visibility
      const scale = 15 + Math.random() * 10;
      bird.scale.set(scale, scale * 0.4, 1);

      // Position around player
      const radius = 500 + Math.random() * this.birdSpread;
      const theta = Math.random() * Math.PI * 2;

      bird.position.set(
        playerPos.x + radius * Math.cos(theta),
        this.birdHeight + Math.random() * 200,
        playerPos.z + radius * Math.sin(theta)
      );

      // Add movement properties
      bird.userData = {
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 5,
          (Math.random() - 0.5) * 20
        ),
        flapSpeed: 0.5 + Math.random() * 0.5,
        flapPhase: Math.random() * Math.PI * 2,
        turnSpeed: 0.1 + Math.random() * 0.1,
        heightPreference: this.birdHeight + Math.random() * 200
      };

      this.scene.add(bird);
      this.birds.push(bird);
    }

    Logger.info(`Created ${this.birdCount} birds`);
  }

  /**
   * Create butterfly particles
   */
  createButterflies() {
    // Create a colorful butterfly shape
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    // Draw butterfly (simple colored dots/wings)
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 200, 100, 1.0)');
    gradient.addColorStop(0.5, 'rgba(255, 180, 80, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
      depthWrite: false
    });

    const playerPos = this.camera.position;

    for (let i = 0; i < this.butterflyCount; i++) {
      const butterfly = new THREE.Sprite(material.clone());

      // Larger scale for visibility
      const scale = 5 + Math.random() * 3;
      butterfly.scale.set(scale, scale, 1);

      // Position closer to ground and player
      const radius = 100 + Math.random() * this.butterflySpread;
      const theta = Math.random() * Math.PI * 2;

      butterfly.position.set(
        playerPos.x + radius * Math.cos(theta),
        20 + Math.random() * 80,
        playerPos.z + radius * Math.sin(theta)
      );

      // Add erratic movement properties
      butterfly.userData = {
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 8
        ),
        flutterSpeed: 2 + Math.random() * 2,
        flutterPhase: Math.random() * Math.PI * 2,
        heightPreference: 30 + Math.random() * 60
      };

      this.scene.add(butterfly);
      this.butterflies.push(butterfly);
    }

    Logger.info(`Created ${this.butterflyCount} butterflies`);
  }

  /**
   * Update bird and butterfly positions
   */
  _update(delta) {
    const deltaSeconds = delta / 1000;
    const playerPos = this.camera.position;

    // Update birds
    for (const bird of this.birds) {
      const userData = bird.userData;

      // Flapping animation (scale variation)
      userData.flapPhase += deltaSeconds * userData.flapSpeed;
      const flapScale = 1 + 0.2 * Math.sin(userData.flapPhase * 10);
      bird.scale.y = bird.scale.x * 0.5 * flapScale;

      // Height correction (tend toward preferred height)
      const heightDiff = userData.heightPreference - bird.position.y;
      userData.velocity.y += heightDiff * 0.01;

      // Damping
      userData.velocity.multiplyScalar(0.99);

      // Random direction changes
      if (Math.random() < 0.02) {
        userData.velocity.x += (Math.random() - 0.5) * 10;
        userData.velocity.z += (Math.random() - 0.5) * 10;
      }

      // Move bird
      bird.position.add(userData.velocity.clone().multiplyScalar(deltaSeconds));

      // Keep birds near player (respawn if too far)
      const distToPlayer = bird.position.distanceTo(playerPos);
      if (distToPlayer > 2500) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 800 + Math.random() * 500;
        bird.position.set(
          playerPos.x + distance * Math.cos(angle),
          userData.heightPreference,
          playerPos.z + distance * Math.sin(angle)
        );
      }
    }

    // Update butterflies
    for (const butterfly of this.butterflies) {
      const userData = butterfly.userData;

      // Flutter animation
      userData.flutterPhase += deltaSeconds * userData.flutterSpeed;
      const flutter = Math.sin(userData.flutterPhase * 15);

      // Erratic movement pattern
      userData.velocity.x += Math.sin(userData.flutterPhase) * 0.5;
      userData.velocity.z += Math.cos(userData.flutterPhase * 1.3) * 0.5;

      // Height correction
      const heightDiff = userData.heightPreference - butterfly.position.y;
      userData.velocity.y = heightDiff * 0.05;

      // Damping
      userData.velocity.multiplyScalar(0.95);

      // Move butterfly
      butterfly.position.add(userData.velocity.clone().multiplyScalar(deltaSeconds));

      // Keep butterflies near player
      const distToPlayer = butterfly.position.distanceTo(playerPos);
      if (distToPlayer > 1000) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 200 + Math.random() * 300;
        butterfly.position.set(
          playerPos.x + distance * Math.cos(angle),
          userData.heightPreference,
          playerPos.z + distance * Math.sin(angle)
        );
      }
    }
  }

  /**
   * Clean up
   */
  _destroy() {
    // Remove all birds
    for (const bird of this.birds) {
      this.scene.remove(bird);
      bird.material.dispose();
    }
    this.birds = [];

    // Remove all butterflies
    for (const butterfly of this.butterflies) {
      this.scene.remove(butterfly);
      butterfly.material.dispose();
    }
    this.butterflies = [];

    Logger.info("Ambient Life System destroyed");
  }
}
