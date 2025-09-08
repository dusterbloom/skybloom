import * as THREE from 'three';
import { System } from '../../core/System.js';
import { useGameState, GameStates } from '../../state/gameState.js';

export class PlayerInputSystem extends System {
  constructor(engine) {
    super(engine, 'playerInput');
    this.requireDependencies(['playerState']);
    this.playerState = engine.systems.get('playerState');
    this.input = engine.input;

    // Input properties from PlayerInput
    this.mouseSensitivity = 0.0015;
    this.throttleSpeed = 1.0;
    this.bankingSensitivity = 0.3;
    this.rotationDamping = 0.92;
    this.currentThrottle = 0;
    this.unsubscribeState = null;
    this.motionControlsEnabled = false;
    this.motionSensitivity = {
      pitch: 0.04,
      yaw: 0.06
    };
    this.motionResponseCurve = {
      deadzone: 2.0,
      maxResponse: 15.0
    };
    this.isMobile = this.input.isTouchDevice;
    this.mobileAutoForward = true;
    this.touchAltitude = { up: false, down: false };
    this.mobileControlElements = [];
    this.joystick = null;
  }

  async _initialize() {
    this.setupInput();
    if (this.isMobile) {
      this.setupTouchControls();
    }

    console.log("PlayerInputSystem initialized");
  }

  setupInput() {
    // Subscribe to game state changes
    this.unsubscribeState = useGameState.subscribe(
      (state) => {
        const isPlaying = state.currentState === GameStates.PLAYING;
        this.setControlsActive(isPlaying);
      }
    );

    this.input.on('mousemove', (event) => {
      if (this.input.pointerLocked) {
        const player = this.playerState.localPlayer;
        if (!player) return;

        const smoothedDX = this.input.mouse.dx * this.mouseSensitivity;
        const smoothedDY = this.input.mouse.dy * this.mouseSensitivity;

        // Update rotation
        player.rotation.y -= smoothedDX;
        const newPitch = player.rotation.x - smoothedDY;
        player.rotation.x = THREE.MathUtils.clamp(newPitch, -Math.PI / 4, Math.PI / 4);

        // Update bank angle
        const targetBankAngle = -smoothedDX * 5;
        player.bankAngle = THREE.MathUtils.lerp(player.bankAngle || 0, targetBankAngle, 0.1);
      }
    });

    this.input.on('keydown', (event) => {
      if (['Space', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(event.code)) {
        event.preventDefault();
      }
    });
  }

  _update(delta) {
    const player = this.playerState.localPlayer;
    if (!player) return;

    // Apply rotation damping
    player.bankAngle = (player.bankAngle || 0) * this.rotationDamping;

    // Handle joystick input for mobile
    if (this.joystick && this.joystick.active) {
      if (Math.abs(this.joystick.position.x) > 0.1) {
        player.rotation.y -= this.joystick.position.x * 0.05;
        const targetBankAngle = -this.joystick.position.x * 0.5;
        player.bankAngle = THREE.MathUtils.lerp(player.bankAngle || 0, targetBankAngle, 0.1);
      }

      if (Math.abs(this.joystick.position.y) > 0.1) {
        player.altitudeVelocity += -this.joystick.position.y * 30 * delta;
        const targetPitch = this.joystick.position.y * 0.5;
        player.rotation.x = THREE.MathUtils.lerp(player.rotation.x, targetPitch, 0.1);

        // Update contrail
        if (this.engine.systems.carpetTrail && this.joystick.position.y < -0.3) {
          this.engine.systems.carpetTrail.setSpaceBarState(true);
        } else if (this.engine.systems.carpetTrail) {
          this.engine.systems.carpetTrail.setSpaceBarState(false);
        }
      }
    }

    // Throttle control
    if (this.input.isKeyDown('KeyW')) {
      this.currentThrottle = Math.min(1.0, this.currentThrottle + this.throttleSpeed * delta);
    } else if (this.input.isKeyDown('KeyS')) {
      this.currentThrottle = Math.max(0.0, this.currentThrottle - this.throttleSpeed * delta);
    }

    // Auto-forward for mobile
    if (this.isMobile && this.mobileAutoForward && this.currentThrottle < 0.5) {
      this.currentThrottle = 0.5;
    }

    // Set acceleration for forward
    player.acceleration = player.acceleration || new THREE.Vector3(0, 0, 0);
    const forwardForce = this.currentThrottle * player.maxSpeed;
    const forwardDir = new THREE.Vector3(0, 0, 1).applyEuler(player.rotation).multiplyScalar(forwardForce * delta);
    player.acceleration.add(forwardDir);

    // Strafing
    let strafeForce = 0;
    if (this.input.isKeyDown('KeyA')) strafeForce -= 0.3;
    if (this.input.isKeyDown('KeyD')) strafeForce += 0.3;
    if (strafeForce !== 0) {
      const sideDir = new THREE.Vector3(1, 0, 0).applyEuler(player.rotation).multiplyScalar(player.accelerationValue * strafeForce * delta * 0.3);
      player.acceleration.add(sideDir);
      const targetBankAngle = strafeForce * Math.PI / 6;
      player.bankAngle = THREE.MathUtils.lerp(player.bankAngle || 0, targetBankAngle, 0.1);
    }

    // Vertical movement
    let verticalForce = 0;
    let spacePressed = this.input.isKeyDown('Space');
    if (spacePressed) verticalForce += 1;
    if (this.input.isKeyDown('ShiftLeft') || this.input.isKeyDown('ShiftRight')) verticalForce -= 1;
    if (this.touchAltitude.up) verticalForce += 1;
    if (this.touchAltitude.down) verticalForce -= 1;

    if (this.engine.systems.carpetTrail) {
      this.engine.systems.carpetTrail.setSpaceBarState(spacePressed || this.touchAltitude.up);
    }

    if (verticalForce !== 0) {
      player.altitudeVelocity += 30 * verticalForce * delta;
    }

    // Natural falling
    if (verticalForce === 0 && (!this.joystick || !this.joystick.active || Math.abs(this.joystick.position.y) <= 0.1)) {
      player.altitudeVelocity -= 5 * delta;
    }

    // Motion controls
    if (this.motionControlsEnabled && this.input.deviceMotionEnabled && this.input.initialOrientation) {
      const fusedOrientation = this.input.fusedOrientation;

      // Beta for altitude
      let betaResponse = 0;
      if (Math.abs(fusedOrientation.beta) > this.motionResponseCurve.deadzone) {
        const normalizedBeta = Math.sign(fusedOrientation.beta) * (Math.abs(fusedOrientation.beta) - this.motionResponseCurve.deadzone);
        betaResponse = Math.sign(normalizedBeta) * Math.min(1.0, Math.pow(Math.abs(normalizedBeta) / this.motionResponseCurve.maxResponse, 2));
        player.altitudeVelocity += betaResponse * 40 * delta;
      }

      // Gamma for rotation
      let gammaResponse = 0;
      if (Math.abs(fusedOrientation.gamma) > this.motionResponseCurve.deadzone) {
        const normalizedGamma = Math.sign(fusedOrientation.gamma) * (Math.abs(fusedOrientation.gamma) - this.motionResponseCurve.deadzone);
        gammaResponse = Math.sign(normalizedGamma) * Math.min(1.0, Math.pow(Math.abs(normalizedGamma) / this.motionResponseCurve.maxResponse, 2));
        player.rotation.y -= gammaResponse * this.motionSensitivity.yaw * 2;
        const targetBankAngle = -gammaResponse * 0.5;
        player.bankAngle = THREE.MathUtils.lerp(player.bankAngle || 0, targetBankAngle, 0.15);
      }

      // Forward force for motion
      const motionForwardForce = player.maxSpeed * 0.5 * delta;
      const forwardDir = new THREE.Vector3(0, 0, 1).applyEuler(player.rotation).multiplyScalar(motionForwardForce);
      player.acceleration.add(forwardDir);
    }
  }

  setControlsActive(active) {
    if (active) {
      if (this.isMobile) {
        this.showMobileControls();
      }
    } else {
      if (this.isMobile && this.mobileControlElements) {
        this.hideMobileControls();
      }
    }
  }

  setupTouchControls() {
    console.log('Setting up touch controls UI elements');

    // Create virtual joystick container
    const joystickContainer = document.createElement('div');
    joystickContainer.style.position = 'fixed';
    joystickContainer.style.bottom = '5%';
    joystickContainer.style.right = '5%';
    joystickContainer.style.width = '20vmin';
    joystickContainer.style.height = '20vmin';
    joystickContainer.style.borderRadius = '50%';
    joystickContainer.style.background = 'rgba(255, 255, 255, 0.2)';
    joystickContainer.style.border = '2px solid rgba(255, 255, 255, 0.4)';
    joystickContainer.style.zIndex = '1000';
    joystickContainer.style.display = 'none';
    document.body.appendChild(joystickContainer);
    this.mobileControlElements.push(joystickContainer);

    // Create joystick knob
    const joystick = document.createElement('div');
    joystick.style.position = 'absolute';
    joystick.style.top = '33%';
    joystick.style.left = '33%';
    joystick.style.width = '33%';
    joystick.style.height = '33%';
    joystick.style.borderRadius = '50%';
    joystick.style.background = 'rgba(255, 255, 255, 0.8)';
    joystick.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
    joystickContainer.appendChild(joystick);

    // Create boost button
    const boostButton = document.createElement('div');
    boostButton.style.position = 'fixed';
    boostButton.style.bottom = '5%';
    boostButton.style.left = '5%';
    boostButton.style.width = '15vmin';
    boostButton.style.height = '15vmin';
    boostButton.style.borderRadius = '50%';
    boostButton.style.background = 'rgba(30, 144, 255, 0.7)';
    boostButton.style.display = 'flex';
    boostButton.style.alignItems = 'center';
    boostButton.style.justifyContent = 'center';
    boostButton.style.fontSize = 'min(28px, 4vmin)';
    boostButton.innerHTML = '🚀';
    boostButton.style.color = 'white';
    boostButton.style.boxShadow = '0 0 15px rgba(30, 144, 255, 0.5)';
    boostButton.style.zIndex = '1000';
    boostButton.style.display = 'none';
    document.body.appendChild(boostButton);
    this.mobileControlElements.push(boostButton);

    // Initialize joystick state
    this.joystick = {
      active: false,
      position: { x: 0, y: 0 },
      startPosition: { x: 0, y: 0 },
      container: {
        rect: joystickContainer.getBoundingClientRect(),
        radius: 75
      }
    };

    // Handle boost button events
    boostButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.touchAltitude.up = true;
      boostButton.style.background = 'rgba(0, 119, 255, 0.8)';
    }, { passive: false });

    boostButton.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.touchAltitude.up = false;
      boostButton.style.background = 'rgba(30, 144, 255, 0.7)';
    }, { passive: false });

    // Setup joystick events
    this.setupJoystickEvents(joystickContainer, joystick);

    // Update on resize
    window.addEventListener('resize', () => {
      this.joystick.container.rect = joystickContainer.getBoundingClientRect();
    });
  }

  setupJoystickEvents(container, joystickElement) {
    let joystickTouchId = null;

    const handleTouchStart = (e) => {
      if (joystickTouchId !== null) return;

      for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        const rect = this.joystick.container.rect;

        if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
            touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
          e.preventDefault();
          joystickTouchId = touch.identifier;
          this.joystick.active = true;
          this.updateJoystickPosition(touch, joystickElement);
          break;
        }
      }
    };

    const handleTouchMove = (e) => {
      if (!this.joystick.active) return;

      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === joystickTouchId) {
          e.preventDefault();
          this.updateJoystickPosition(e.touches[i], joystickElement);
          break;
        }
      }
    };

    const handleTouchEnd = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joystickTouchId) {
          e.preventDefault();
          this.resetJoystick(joystickElement);
          break;
        }
      }
    };

    const updateJoystickPosition = (touch, joystickElement) => {
      const rect = this.joystick.container.rect;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      let dx = touch.clientX - centerX;
      let dy = touch.clientY - centerY;

      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > this.joystick.container.radius) {
        dx *= this.joystick.container.radius / distance;
        dy *= this.joystick.container.radius / distance;
      }

      joystickElement.style.left = `calc(33% + ${dx}px)`;
      joystickElement.style.top = `calc(33% + ${dy}px)`;

      this.joystick.position.x = dx / this.joystick.container.radius;
      this.joystick.position.y = dy / this.joystick.container.radius;
    };

    const resetJoystick = (joystickElement) => {
      joystickTouchId = null;
      this.joystick.active = false;
      this.joystick.position.x = 0;
      this.joystick.position.y = 0;
      joystickElement.style.left = '33%';
      joystickElement.style.top = '33%';
    };

    document.body.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.body.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.body.addEventListener('touchend', handleTouchEnd, { passive: false });
    document.body.addEventListener('touchcancel', handleTouchEnd, { passive: false });
  }

  showMobileControls() {
    console.log('Showing mobile controls');
    this.mobileControlElements.forEach(element => {
      element.style.display = 'block';
    });
    this.updateJoystickContainerRect();
  }

  hideMobileControls() {
    console.log('Hiding mobile controls');
    this.mobileControlElements.forEach(element => {
      element.style.display = 'none';
    });
  }

  updateJoystickContainerRect() {
    if (this.joystick) {
      this.joystick.container.rect = this.mobileControlElements[0].getBoundingClientRect(); // assuming first is container
    }
  }

  toggleMotionControls(enabled) {
    this.motionControlsEnabled = enabled;
    this.input.setDeviceMotionEnabled(enabled);
    if (enabled) {
      if (this.joystick) {
        this.joystick.active = false;
        this.joystick.position.x = 0;
        this.joystick.position.y = 0;
      }
    }
    return this.motionControlsEnabled;
  }

  destroy() {
    if (this.unsubscribeState) {
      this.unsubscribeState();
    }
    this.mobileControlElements.forEach(element => {
      document.body.removeChild(element);
    });
  }
}