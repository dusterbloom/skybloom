import * as THREE from "three";
import { System } from "../core/System.js";
import { Logger } from "../../utils/Logger.js";

/**
 * Advanced Underwater Effects System
 * Features caustics, particles, and atmospheric effects
 */
export class UnderwaterEffectsSystem extends System {
  constructor(engine) {
    super(engine, 'underwaterEffects');
    this.scene = engine.scene;
    this.camera = engine.camera;

    // Caustics system
    this.causticsPlane = null;
    this.causticsMaterial = null;
    this.causticsTexture = null;

    // Particle system
    this.particleSystem = null;
    this.particles = [];
    this.particleCount = 50;

    // Atmospheric effects
    this.fogColor = new THREE.Color(0.1, 0.3, 0.6);
    this.fogNear = 100;
    this.fogFar = 1000;

    // Animation parameters
    this.time = 0;
    this.causticsSpeed = 0.5;
    this.particleFloatSpeed = 0.2;

    // Underwater state
    this.isUnderwater = false;
    this.transitionSpeed = 2.0;
    this.underwaterFogColor = new THREE.Color(0.05, 0.2, 0.5);
    this.surfaceFogColor = new THREE.Color(0.5, 0.7, 0.9);
  }

  async _initialize() {
    Logger.info("✨ Initializing Underwater Effects System...");

    try {
      // Create caustics system
      this.createCausticsSystem();

      // Create particle system
      this.createParticleSystem();

      // Setup atmospheric effects
      this.setupAtmosphericEffects();

      Logger.info("✨ Underwater Effects System initialized successfully ✅");

    } catch (error) {
      Logger.error("Failed to initialize Underwater Effects System:", error);
    }
  }

  createCausticsSystem() {
    Logger.debug("Creating caustics system...");

    // Generate caustics texture
    this.causticsTexture = this.generateCausticsTexture();

    // Create large plane for caustics
    const geometry = new THREE.PlaneGeometry(10000, 10000, 1, 1);
    geometry.rotateX(-Math.PI / 2);

    // Caustics material
    this.causticsMaterial = new THREE.ShaderMaterial({
      vertexShader: this.getCausticsVertexShader(),
      fragmentShader: this.getCausticsFragmentShader(),
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        _CausticsTexture: { value: this.causticsTexture },
        _Time: { value: 0 },
        _CameraPosition: { value: new THREE.Vector3() },
        _WaterLevel: { value: 0 }
      }
    });

    this.causticsPlane = new THREE.Mesh(geometry, this.causticsMaterial);
    this.causticsPlane.position.set(0, -50, 0); // Just below water surface
    this.causticsPlane.renderOrder = -1; // Render before other objects

    this.scene.add(this.causticsPlane);
  }

  generateCausticsTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Create caustics pattern
    const imageData = ctx.createImageData(size, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Generate caustics pattern using sine waves
        const wave1 = Math.sin(x * 0.02) * Math.cos(y * 0.02);
        const wave2 = Math.sin(x * 0.03 + Math.PI / 4) * Math.cos(y * 0.03);
        const wave3 = Math.sin(x * 0.01) * Math.sin(y * 0.01);

        const intensity = (wave1 + wave2 + wave3) * 0.33 + 0.5;
        const clamped = Math.max(0, Math.min(1, intensity));

        const index = (y * size + x) * 4;
        imageData.data[index] = clamped * 255;     // R
        imageData.data[index + 1] = clamped * 255; // G
        imageData.data[index + 2] = clamped * 255; // B
        imageData.data[index + 3] = 128;           // A (semi-transparent)
      }
    }

    ctx.putImageData(imageData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  getCausticsVertexShader() {
    return `
      varying vec2 vUv;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `;
  }

  getCausticsFragmentShader() {
    return `
      uniform sampler2D _CausticsTexture;
      uniform float _Time;
      uniform vec3 _CameraPosition;
      uniform float _WaterLevel;

      varying vec2 vUv;
      varying vec3 vWorldPosition;

      void main() {
        // Animate caustics
        vec2 animatedUv = vUv + vec2(_Time * 0.1, _Time * 0.05);

        // Sample caustics texture
        vec4 caustics = texture2D(_CausticsTexture, animatedUv * 5.0);

        // Fade based on distance from camera
        float distance = length(vWorldPosition - _CameraPosition);
        float fade = 1.0 - smoothstep(100.0, 500.0, distance);

        // Fade based on depth
        float depthFade = smoothstep(_WaterLevel - 100.0, _WaterLevel, vWorldPosition.y);

        float alpha = caustics.a * fade * depthFade * 0.3;

        gl_FragColor = vec4(caustics.rgb, alpha);
      }
    `;
  }

  createParticleSystem() {
    Logger.debug("Creating underwater particle system...");

    // Create particle geometry
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    const colors = new Float32Array(this.particleCount * 3);
    const sizes = new Float32Array(this.particleCount);

    for (let i = 0; i < this.particleCount; i++) {
      // Random positions in a large underwater area
      positions[i * 3] = (Math.random() - 0.5) * 2000;
      positions[i * 3 + 1] = -Math.random() * 200; // Underwater
      positions[i * 3 + 2] = (Math.random() - 0.5) * 2000;

      // Light blue colors for underwater particles
      colors[i * 3] = 0.3 + Math.random() * 0.4;     // R
      colors[i * 3 + 1] = 0.5 + Math.random() * 0.4; // G
      colors[i * 3 + 2] = 0.7 + Math.random() * 0.3; // B

      sizes[i] = Math.random() * 10 + 5;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Particle material
    const particleMaterial = new THREE.ShaderMaterial({
      vertexShader: this.getParticleVertexShader(),
      fragmentShader: this.getParticleFragmentShader(),
      transparent: true,
      vertexColors: true,
      uniforms: {
        _Time: { value: 0 },
        _CameraPosition: { value: new THREE.Vector3() }
      }
    });

    this.particleSystem = new THREE.Points(particleGeometry, particleMaterial);
    this.scene.add(this.particleSystem);
  }

  getParticleVertexShader() {
    return `
      attribute float size;

      varying vec3 vColor;
      varying float vAlpha;

      uniform float _Time;
      uniform vec3 _CameraPosition;

      void main() {
        vColor = color;

        // Gentle floating motion
        vec3 pos = position;
        pos.y += sin(_Time * 0.5 + position.x * 0.01 + position.z * 0.01) * 5.0;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

        // Fade particles based on distance
        float distance = length(pos - _CameraPosition);
        vAlpha = 1.0 - smoothstep(500.0, 1000.0, distance);

        gl_PointSize = size * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;
  }

  getParticleFragmentShader() {
    return `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        // Create circular particles
        float distance = length(gl_PointCoord - vec2(0.5));
        float alpha = 1.0 - smoothstep(0.0, 0.5, distance);

        gl_FragColor = vec4(vColor, alpha * vAlpha * 0.6);
      }
    `;
  }

  setupAtmosphericEffects() {
    Logger.debug("Setting up atmospheric effects...");

    // Create underwater fog
    this.scene.fog = new THREE.Fog(this.fogColor, this.fogNear, this.fogFar);
  }

  _update(deltaTime) {
    this.time += deltaTime;

    // Update caustics
    if (this.causticsMaterial) {
      this.causticsMaterial.uniforms._Time.value = this.time;
      this.causticsMaterial.uniforms._CameraPosition.value.copy(this.camera.position);
    }

    // Update particles
    if (this.particleSystem && this.particleSystem.material) {
      this.particleSystem.material.uniforms._Time.value = this.time;
      this.particleSystem.material.uniforms._CameraPosition.value.copy(this.camera.position);
    }

    // Update atmospheric effects
    this.updateAtmosphericEffects(deltaTime);

    // Update caustics position to follow camera
    if (this.causticsPlane && this.camera) {
      this.causticsPlane.position.x = this.camera.position.x;
      this.causticsPlane.position.z = this.camera.position.z;
    }
  }

  updateAtmosphericEffects(deltaTime) {
    if (!this.scene.fog) return;

    // Check if underwater
    const waterLevel = 0; // Should get from water system
    const isCurrentlyUnderwater = this.camera.position.y < waterLevel;

    // Smooth transition between surface and underwater fog
    if (isCurrentlyUnderwater !== this.isUnderwater) {
      this.isUnderwater = isCurrentlyUnderwater;
    }

    const targetColor = this.isUnderwater ? this.underwaterFogColor : this.surfaceFogColor;
    const targetNear = this.isUnderwater ? 50 : 100;
    const targetFar = this.isUnderwater ? 500 : 1000;

    // Smooth color transition
    this.scene.fog.color.lerp(targetColor, deltaTime * this.transitionSpeed);

    // Smooth distance transition
    this.scene.fog.near += (targetNear - this.scene.fog.near) * deltaTime * this.transitionSpeed;
    this.scene.fog.far += (targetFar - this.scene.fog.far) * deltaTime * this.transitionSpeed;
  }

  setWaterLevel(level) {
    if (this.causticsMaterial) {
      this.causticsMaterial.uniforms._WaterLevel.value = level;
    }
  }

  dispose() {
    Logger.info("Disposing Underwater Effects System...");

    if (this.causticsPlane) {
      this.scene.remove(this.causticsPlane);
      if (this.causticsPlane.geometry) this.causticsPlane.geometry.dispose();
      if (this.causticsPlane.material) this.causticsPlane.material.dispose();
    }

    if (this.particleSystem) {
      this.scene.remove(this.particleSystem);
      if (this.particleSystem.geometry) this.particleSystem.geometry.dispose();
      if (this.particleSystem.material) this.particleSystem.material.dispose();
    }

    if (this.causticsTexture) this.causticsTexture.dispose();

    Logger.info("Underwater Effects System disposed");
  }
}