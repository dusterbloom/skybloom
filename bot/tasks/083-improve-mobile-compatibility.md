# Task 083: Improve Mobile Compatibility and Touch Controls

## 1. Task & Context
**Task:** Enhance mobile experience with better touch controls, performance optimizations, and device-specific features
**Scope:** Mobile controls, touch handling, device detection, performance optimizations
**Branch:** slow-mode
**Priority:** MEDIUM - Mobile user experience

## 2. Quick Plan
**Approach:** Implement touch controls, optimize for mobile performance, add device detection, improve mobile UI
**Complexity:** 2-Moderate (mobile-specific implementations)
**Uncertainty:** 1-Low (standard mobile web patterns)

## 3. Implementation

### Current Issues Found:
- Touch controls may not work on all devices
- Battery drain from continuous rendering
- Memory constraints on older devices
- Network issues on cellular connections
- Poor mobile UI layout

### Solution Approach:
1. Implement comprehensive touch controls
2. Add mobile-specific performance optimizations
3. Improve device detection and adaptation
4. Enhance mobile UI and user experience

### Implementation Steps:

**Step 1: Implement Touch Controls System**
```javascript
// src/game/systems/TouchControlsSystem.js
export class TouchControlsSystem extends System {
  constructor() {
    super();
    this.name = 'touchControls';
    this.touchStartTime = 0;
    this.touchStartPos = new THREE.Vector2();
    this.isDragging = false;
    this.touchId = null;
  }

  initialize() {
    this.setupTouchEventListeners();
    this.createVirtualJoystick();
  }

  setupTouchEventListeners() {
    const canvas = this.engine.renderer.domElement;

    canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
    canvas.addEventListener('touchcancel', this.handleTouchCancel.bind(this), { passive: false });
  }

  handleTouchStart(event) {
    event.preventDefault();

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      this.touchId = touch.identifier;
      this.touchStartTime = Date.now();
      this.touchStartPos.set(touch.clientX, touch.clientY);
      this.isDragging = false;
    }
  }

  handleTouchMove(event) {
    event.preventDefault();

    if (event.touches.length === 1 && event.touches[0].identifier === this.touchId) {
      const touch = event.touches[0];
      const deltaX = touch.clientX - this.touchStartPos.x;
      const deltaY = touch.clientY - this.touchStartPos.y;

      // Determine if this is a drag or tap
      if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        this.isDragging = true;
        this.handleDrag(deltaX, deltaY);
      }
    }
  }

  handleTouchEnd(event) {
    event.preventDefault();

    if (event.changedTouches.length === 1 &&
        event.changedTouches[0].identifier === this.touchId) {

      const touchDuration = Date.now() - this.touchStartTime;

      if (!this.isDragging && touchDuration < 300) {
        // This was a tap
        this.handleTap(event.changedTouches[0]);
      }

      this.touchId = null;
      this.isDragging = false;
    }
  }

  handleDrag(deltaX, deltaY) {
    // Convert touch movement to player controls
    const sensitivity = 0.01;
    const moveX = deltaX * sensitivity;
    const moveY = deltaY * sensitivity;

    // Update player movement
    this.playerSystem.updateMovement(moveX, moveY);
  }

  handleTap(touch) {
    // Handle tap gestures (spell casting, interaction, etc.)
    const worldPos = this.screenToWorld(touch.clientX, touch.clientY);

    if (this.isValidSpellTarget(worldPos)) {
      this.spellSystem.castSpell(worldPos);
    }
  }

  createVirtualJoystick() {
    // Create virtual joystick for movement
    this.joystick = new VirtualJoystick({
      container: document.body,
      position: 'left-bottom',
      size: 120,
      opacity: 0.7
    });

    this.joystick.on('move', (data) => {
      this.playerSystem.updateMovement(data.x, data.y);
    });
  }
}
```

**Step 2: Add Mobile Performance Optimizations**
```javascript
// src/game/systems/MobileOptimizationSystem.js
export class MobileOptimizationSystem extends System {
  constructor() {
    super();
    this.name = 'mobileOptimization';
    this.isMobile = this.detectMobile();
    this.batteryLevel = 1.0;
    this.thermalState = 'nominal';
  }

  initialize() {
    if (this.isMobile) {
      this.setupBatteryMonitoring();
      this.setupThermalMonitoring();
      this.applyMobileOptimizations();
    }
  }

  detectMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           window.innerWidth < 768;
  }

  setupBatteryMonitoring() {
    if ('getBattery' in navigator) {
      navigator.getBattery().then(battery => {
        this.batteryLevel = battery.level;
        battery.addEventListener('levelchange', () => {
          this.batteryLevel = battery.level;
          this.adjustPerformanceForBattery();
        });
      });
    }
  }

  setupThermalMonitoring() {
    if ('thermal' in navigator) {
      navigator.thermal.addEventListener('change', () => {
        this.thermalState = navigator.thermal.state;
        this.adjustPerformanceForThermal();
      });
    }
  }

  applyMobileOptimizations() {
    // Reduce render quality on mobile
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Enable power-saving features
    this.enablePowerSavingMode();

    // Optimize texture sizes
    this.optimizeTexturesForMobile();

    // Reduce particle effects
    this.reduceParticleEffects();
  }

  adjustPerformanceForBattery() {
    if (this.batteryLevel < 0.2) {
      // Enable ultra power-saving mode
      this.enableUltraPowerSaving();
    } else if (this.batteryLevel < 0.5) {
      // Enable power-saving mode
      this.enablePowerSavingMode();
    } else {
      // Normal performance
      this.disablePowerSaving();
    }
  }

  adjustPerformanceForThermal() {
    switch (this.thermalState) {
      case 'critical':
        this.enableThermalThrottling();
        break;
      case 'serious':
        this.reduceFrameRate();
        break;
      case 'fair':
        this.applyModerateOptimizations();
        break;
      default:
        this.restoreNormalPerformance();
    }
  }

  enablePowerSavingMode() {
    // Reduce frame rate
    this.targetFPS = 30;

    // Reduce render distance
    this.worldSystem.setRenderDistance(4);

    // Disable non-essential effects
    this.atmosphereSystem.disableVolumetricLighting();
    this.particleSystem.reduceParticleCount(0.5);
  }

  optimizeTexturesForMobile() {
    // Reduce texture sizes on mobile
    const textureLoader = new THREE.TextureLoader();
    textureLoader.setSizeMobileFriendly();

    // Use compressed textures if available
    if (this.renderer.extensions.has('WEBGL_compressed_texture_s3tc')) {
      // Use DDS textures
    }
  }
}
```

**Step 3: Improve Mobile UI**
```javascript
// src/game/ui/MobileUISystem.js
export class MobileUISystem extends System {
  constructor() {
    super();
    this.name = 'mobileUI';
    this.isMobile = this.detectMobile();
  }

  initialize() {
    if (this.isMobile) {
      this.createMobileUI();
      this.setupMobileGestures();
    }
  }

  createMobileUI() {
    // Create mobile-optimized HUD
    this.hud = new MobileHUD({
      position: 'bottom',
      controls: ['joystick', 'spell-buttons', 'minimap', 'health-mana']
    });

    // Add gesture hints
    this.addGestureHints();

    // Optimize button sizes for touch
    this.optimizeButtonSizes();
  }

  setupMobileGestures() {
    // Setup swipe gestures for menu navigation
    this.setupSwipeGestures();

    // Setup pinch gestures for zoom
    this.setupPinchGestures();

    // Setup long-press for context menus
    this.setupLongPressGestures();
  }

  addGestureHints() {
    // Add visual hints for touch gestures
    this.gestureHints = new GestureHints({
      swipe: 'Swipe to move camera',
      pinch: 'Pinch to zoom',
      tap: 'Tap to cast spell',
      longPress: 'Hold for menu'
    });
  }

  optimizeButtonSizes() {
    // Ensure buttons are at least 44px for accessibility
    const buttons = document.querySelectorAll('.ui-button');
    buttons.forEach(button => {
      const rect = button.getBoundingClientRect();
      if (rect.width < 44 || rect.height < 44) {
        button.style.minWidth = '44px';
        button.style.minHeight = '44px';
      }
    });
  }

  setupSwipeGestures() {
    let startX, startY;

    document.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    });

    document.addEventListener('touchend', (e) => {
      if (!startX || !startY) return;

      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const diffX = endX - startX;
      const diffY = endY - startY;

      if (Math.abs(diffX) > Math.abs(diffY)) {
        // Horizontal swipe
        if (diffX > 50) {
          this.handleSwipeRight();
        } else if (diffX < -50) {
          this.handleSwipeLeft();
        }
      } else {
        // Vertical swipe
        if (diffY > 50) {
          this.handleSwipeDown();
        } else if (diffY < -50) {
          this.handleSwipeUp();
        }
      }
    });
  }
}
```

**Step 4: Add Device-Specific Optimizations**
```javascript
// src/utils/DeviceDetection.js
export class DeviceDetection {
  static getDeviceInfo() {
    return {
      isMobile: this.isMobile(),
      isTablet: this.isTablet(),
      screenSize: this.getScreenSize(),
      gpuTier: this.getGPUTier(),
      memoryTier: this.getMemoryTier(),
      connectionType: this.getConnectionType()
    };
  }

  static isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           window.innerWidth < 768;
  }

  static isTablet() {
    return /iPad|Android(?=.*\bMobile\b)|Tablet|PlayBook/i.test(navigator.userAgent) ||
           (window.innerWidth >= 768 && window.innerWidth < 1200);
  }

  static getScreenSize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (width < 768) return 'small';
    if (width < 1200) return 'medium';
    return 'large';
  }

  static getGPUTier() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

    if (!gl) return 'low';

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const renderer = gl.getParameter(debugInfo.UNRENDERER);
      // Analyze renderer string to determine GPU tier
      if (renderer.includes('Mali') || renderer.includes('Adreno')) {
        return 'low';
      }
      if (renderer.includes('PowerVR') || renderer.includes('Intel')) {
        return 'medium';
      }
      return 'high';
    }

    return 'medium';
  }

  static getMemoryTier() {
    // Estimate device memory
    if ('deviceMemory' in navigator) {
      const mem = navigator.deviceMemory;
      if (mem < 4) return 'low';
      if (mem < 8) return 'medium';
      return 'high';
    }

    // Fallback based on screen size and device type
    if (this.isMobile()) return 'low';
    return 'medium';
  }

  static getConnectionType() {
    if ('connection' in navigator) {
      return navigator.connection.effectiveType || 'unknown';
    }
    return 'unknown';
  }
}
```

## 4. Check & Commit

**Files to Update:**
- src/game/systems/TouchControlsSystem.js (new)
- src/game/systems/MobileOptimizationSystem.js (new)
- src/game/ui/MobileUISystem.js (new)
- src/utils/DeviceDetection.js (new)
- src/game/core/Engine.js (add mobile system registration)

**Expected Impact:**
- Better touch control responsiveness
- Improved battery life on mobile devices
- Enhanced mobile UI experience
- Device-specific performance optimizations
- Better accessibility for touch users

**Testing:**
- Test on various mobile devices
- Verify touch controls work correctly
- Check performance improvements
- Test battery usage optimization
- Validate UI layout on different screen sizes

**Commit Message:** feat: Improve mobile compatibility with touch controls, performance optimizations, and device detection

**Status:** Ready for implementation