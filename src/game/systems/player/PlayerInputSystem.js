import * as THREE from 'three';
import { Logger } from '../../../utils/Logger.js';
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
    this.turnRate = 1.6; // rad/s yaw at full A/D or joystick deflection
    this.maxBankAngle = Math.PI / 6; // 30 degrees while turning
    this.bankEaseRate = 8; // bank easing: 1 - exp(-rate * delta)
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
    // Virtual controller: AI agents drive the carpet through the same merge points as the
    // keyboard so physics parity holds. throttle/brake: 0..1; turn: -1..1 (positive = right,
    // like KeyD); climb: -1..1 (positive = up, like Space). Only contributes while enabled.
    this.virtualPad = { enabled: false, throttle: 0, brake: 0, turn: 0, climb: 0 };
    // Which sources produced input this frame (RaceSystem reads this to tag replays human/agent/mixed)
    this.inputSourcesThisFrame = { keyboard: false, virtual: false };
  }

  async _initialize() {
    this.setupInput();
    if (this.isMobile) {
      this.setupTouchControls();
    }

    Logger.info("PlayerInputSystem initialized");
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
    // Track which sources produced input this frame (read by RaceSystem every frame)
    this.inputSourcesThisFrame.keyboard =
      this.input.isKeyDown('KeyW') || this.input.isKeyDown('KeyS') ||
      this.input.isKeyDown('ShiftLeft') || this.input.isKeyDown('ShiftRight') ||
      this.input.isKeyDown('KeyA') || this.input.isKeyDown('KeyD') ||
      this.input.isKeyDown('Space') ||
      this.input.isKeyDown('ControlLeft') || this.input.isKeyDown('ControlRight');
    this.inputSourcesThisFrame.virtual = this.virtualPad.enabled &&
      (this.virtualPad.throttle > 0.05 || this.virtualPad.brake > 0.05 ||
        Math.abs(this.virtualPad.turn) > 0.05 || Math.abs(this.virtualPad.climb) > 0.05);

    const player = this.playerState.localPlayer;
    if (!player) return;

    // Banked turning: A/D, joystick X, and virtual pad turn share the same yaw-rate path
    let turnInput = 0;
    if (this.input.isKeyDown('KeyA')) turnInput -= 1;
    if (this.input.isKeyDown('KeyD')) turnInput += 1;
    if (this.joystick && this.joystick.active && Math.abs(this.joystick.position.x) > 0.1) {
      turnInput = THREE.MathUtils.clamp(turnInput + this.joystick.position.x, -1, 1);
    }
    if (this.virtualPad.enabled && this.virtualPad.turn !== 0) {
      // Positive pad.turn = turn right, same sign convention as KeyD above
      turnInput = THREE.MathUtils.clamp(turnInput + this.virtualPad.turn, -1, 1);
    }

    if (turnInput !== 0) {
      player.rotation.y -= turnInput * this.turnRate * delta;
      // Positive bank raises the carpet's +X (left) edge, leaning into a right turn
      const bankEase = 1 - Math.exp(-this.bankEaseRate * delta);
      player.bankAngle = THREE.MathUtils.lerp(player.bankAngle || 0, turnInput * this.maxBankAngle, bankEase);
    } else {
      // Time-based decay (0.92/frame at 60fps) so mouse-look banking still settles
      player.bankAngle = (player.bankAngle || 0) * Math.pow(this.rotationDamping, delta * 60);
    }

    // Joystick Y: altitude and pitch (X is handled by the turn path above)
    if (this.joystick && this.joystick.active && Math.abs(this.joystick.position.y) > 0.1) {
      player.altitudeVelocity += -this.joystick.position.y * 90 * delta;
      const targetPitch = this.joystick.position.y * 0.5;
      player.rotation.x = THREE.MathUtils.lerp(player.rotation.x, targetPitch, 1 - Math.exp(-6 * delta));

      // Update contrail
      if (this.engine.systems.carpetTrail && this.joystick.position.y < -0.3) {
        this.engine.systems.carpetTrail.setSpaceBarState(true);
      } else if (this.engine.systems.carpetTrail) {
        this.engine.systems.carpetTrail.setSpaceBarState(false);
      }
    }

    // Throttle control (virtual pad merges into the same ramp: throttle ~ W, brake ~ S, brake > 0.6 ~ Shift)
    const keyboardAccelerating = this.input.isKeyDown('KeyW');
    const keyboardHardBraking = this.input.isKeyDown('ShiftLeft') || this.input.isKeyDown('ShiftRight');
    const padAccelerating = this.virtualPad.enabled && this.virtualPad.throttle > 0.05;
    const padHardBraking = this.virtualPad.enabled && this.virtualPad.brake > 0.6;
    const isAccelerating = keyboardAccelerating || padAccelerating;
    const isBraking = this.input.isKeyDown('KeyS') || keyboardHardBraking ||
      (this.virtualPad.enabled && this.virtualPad.brake > 0.05);

    if (isAccelerating && !isBraking) {
      // W targets full throttle; pad-only throttle uses the same ramp with the pad value as ceiling
      const throttleTarget = keyboardAccelerating ? 1.0 : this.virtualPad.throttle;
      if (this.currentThrottle <= throttleTarget) {
        this.currentThrottle = Math.min(throttleTarget, this.currentThrottle + this.throttleSpeed * delta);
      } else {
        // Pad commands less than current throttle: coast down to it (same rate as releasing W)
        this.currentThrottle = Math.max(throttleTarget, this.currentThrottle - this.throttleSpeed * 0.3 * delta);
      }
    } else if (isBraking) {
      // Shift = strong brake, S = gentle slowdown
      const brakeStrength = (keyboardHardBraking || padHardBraking) ? 3.0 : 1.5;
      this.currentThrottle = Math.max(0.0, this.currentThrottle - this.throttleSpeed * brakeStrength * delta);
    } else {
      // Natural throttle decay when no keys pressed (coast down gently)
      this.currentThrottle = Math.max(0.0, this.currentThrottle - this.throttleSpeed * 0.3 * delta);
    }

    // Auto-forward for mobile
    if (this.isMobile && this.mobileAutoForward && this.currentThrottle < 0.5) {
      this.currentThrottle = 0.5;
    }

    // Set acceleration for forward (physics integrates with delta, so none here)
    player.acceleration = player.acceleration || new THREE.Vector3(0, 0, 0);
    const forwardForce = this.currentThrottle * player.accelerationValue * (player.speedMultiplier || 1);
    const forwardDir = new THREE.Vector3(0, 0, 1).applyEuler(player.rotation).multiplyScalar(forwardForce);
    player.acceleration.add(forwardDir);

    // Vertical movement (Space = up, Ctrl = down, Shift is now brake; pad climb merges in, clamped)
    let verticalForce = 0;
    let spacePressed = this.input.isKeyDown('Space');
    if (spacePressed) verticalForce += 1;
    if (this.input.isKeyDown('ControlLeft') || this.input.isKeyDown('ControlRight')) verticalForce -= 1;
    if (this.touchAltitude.up) verticalForce += 1;
    if (this.touchAltitude.down) verticalForce -= 1;
    if (this.virtualPad.enabled && this.virtualPad.climb !== 0) {
      verticalForce = THREE.MathUtils.clamp(verticalForce + this.virtualPad.climb, -1, 1);
    }

    if (this.engine.systems.carpetTrail) {
      const padBoosting = this.virtualPad.enabled && this.virtualPad.climb > 0.3;
      this.engine.systems.carpetTrail.setSpaceBarState(spacePressed || this.touchAltitude.up || padBoosting);
    }

    if (verticalForce !== 0) {
      player.altitudeVelocity += 90 * verticalForce * delta;
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

      // Gamma for rotation (time-based; matches the previous per-frame feel at 60fps)
      let gammaResponse = 0;
      if (Math.abs(fusedOrientation.gamma) > this.motionResponseCurve.deadzone) {
        const normalizedGamma = Math.sign(fusedOrientation.gamma) * (Math.abs(fusedOrientation.gamma) - this.motionResponseCurve.deadzone);
        gammaResponse = Math.sign(normalizedGamma) * Math.min(1.0, Math.pow(Math.abs(normalizedGamma) / this.motionResponseCurve.maxResponse, 2));
        player.rotation.y -= gammaResponse * this.motionSensitivity.yaw * 120 * delta;
        const targetBankAngle = -gammaResponse * 0.5;
        player.bankAngle = THREE.MathUtils.lerp(player.bankAngle || 0, targetBankAngle, 1 - Math.exp(-10 * delta));
      }

      // Forward force for motion (half throttle equivalent; physics integrates with delta)
      const motionForwardForce = player.accelerationValue * 0.5 * (player.speedMultiplier || 1);
      const forwardDir = new THREE.Vector3(0, 0, 1).applyEuler(player.rotation).multiplyScalar(motionForwardForce);
      player.acceleration.add(forwardDir);
    }
  }

  // Virtual controller API: lets AI agents fly through the same input semantics as the keyboard.
  // Accepts a partial axis object ({ throttle, brake, turn, climb }); known axes are Number-coerced
  // (non-finite -> 0) and clamped to their range, unknown keys are ignored. Enables the pad.
  setVirtualPad(partial) {
    const axisRanges = {
      throttle: [0, 1], // like KeyW
      brake: [0, 1],    // like KeyS; > 0.6 brakes hard, like Shift
      turn: [-1, 1],    // positive = turn right, like KeyD
      climb: [-1, 1]    // positive = up, like Space
    };
    for (const axis in axisRanges) {
      if (partial && Object.prototype.hasOwnProperty.call(partial, axis)) {
        const value = Number(partial[axis]);
        this.virtualPad[axis] = Number.isFinite(value)
          ? THREE.MathUtils.clamp(value, axisRanges[axis][0], axisRanges[axis][1])
          : 0;
      }
    }
    this.virtualPad.enabled = true;
    return this.virtualPad;
  }

  // Zero all axes and disable the pad, returning full control to the keyboard instantly
  clearVirtualPad() {
    this.virtualPad.enabled = false;
    this.virtualPad.throttle = 0;
    this.virtualPad.brake = 0;
    this.virtualPad.turn = 0;
    this.virtualPad.climb = 0;
    return this.virtualPad;
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
    Logger.debug('Setting up touch controls UI elements');

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
    Logger.info('Showing mobile controls');
    this.mobileControlElements.forEach(element => {
      element.style.display = 'block';
    });
    this.updateJoystickContainerRect();
  }

  hideMobileControls() {
    Logger.info('Hiding mobile controls');
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