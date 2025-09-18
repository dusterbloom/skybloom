# Task 084: Enhance Accessibility Features

## 1. Task & Context
**Task:** Add comprehensive accessibility features including keyboard navigation, screen reader support, and inclusive design
**Scope:** UI components, input handling, visual elements, audio cues
**Branch:** slow-mode
**Priority:** LOW - Inclusive user experience

## 2. Quick Plan
**Approach:** Implement keyboard navigation, add ARIA labels, improve color contrast, add screen reader support
**Complexity:** 2-Moderate (accessibility standards implementation)
**Uncertainty:** 1-Low (established accessibility patterns)

## 3. Implementation

### Current Issues Found:
- No keyboard navigation
- No screen reader support
- No colorblind-friendly options
- No audio descriptions
- Missing focus management

### Solution Approach:
1. Add keyboard navigation for all interactive elements
2. Implement ARIA labels and roles
3. Improve color contrast and visual accessibility
4. Add screen reader announcements
5. Include audio cues and descriptions

### Implementation Steps:

**Step 1: Implement Keyboard Navigation System**
```javascript
// src/game/systems/AccessibilitySystem.js
export class AccessibilitySystem extends System {
  constructor() {
    super();
    this.name = 'accessibility';
    this.focusableElements = [];
    this.currentFocusIndex = 0;
    this.screenReader = new ScreenReader();
  }

  initialize() {
    this.setupKeyboardNavigation();
    this.setupFocusManagement();
    this.setupScreenReaderSupport();
    this.applyAccessibilityImprovements();
  }

  setupKeyboardNavigation() {
    document.addEventListener('keydown', this.handleKeyDown.bind(this));

    // Make game canvas focusable
    const canvas = this.engine.renderer.domElement;
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Magical Carpet Game');

    // Add focus styles
    this.addFocusStyles();
  }

  handleKeyDown(event) {
    switch (event.key) {
      case 'Tab':
        event.preventDefault();
        this.handleTabNavigation(event.shiftKey);
        break;
      case 'Enter':
      case ' ':
        this.handleActivation();
        break;
      case 'Escape':
        this.handleEscape();
        break;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        this.handleArrowNavigation(event.key);
        break;
    }
  }

  handleTabNavigation(shiftKey) {
    if (shiftKey) {
      this.currentFocusIndex = Math.max(0, this.currentFocusIndex - 1);
    } else {
      this.currentFocusIndex = Math.min(this.focusableElements.length - 1, this.currentFocusIndex + 1);
    }

    this.focusElement(this.currentFocusIndex);
  }

  focusElement(index) {
    if (this.focusableElements[index]) {
      this.focusableElements[index].focus();
      this.announceElement(this.focusableElements[index]);
    }
  }

  announceElement(element) {
    const label = element.getAttribute('aria-label') ||
                  element.getAttribute('aria-labelledby') ||
                  element.textContent ||
                  'Interactive element';

    this.screenReader.announce(label);
  }

  addFocusStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .focus-visible:focus-visible {
        outline: 3px solid #4A90E2;
        outline-offset: 2px;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `;
    document.head.appendChild(style);
  }
}
```

**Step 2: Add ARIA Labels and Screen Reader Support**
```javascript
// src/utils/ScreenReader.js
export class ScreenReader {
  constructor() {
    this.announcementElement = this.createAnnouncementElement();
    this.liveRegion = this.createLiveRegion();
  }

  createAnnouncementElement() {
    const element = document.createElement('div');
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-atomic', 'true');
    element.className = 'sr-only';
    element.id = 'screen-reader-announcements';
    document.body.appendChild(element);
    return element;
  }

  createLiveRegion() {
    const element = document.createElement('div');
    element.setAttribute('aria-live', 'assertive');
    element.setAttribute('aria-atomic', 'true');
    element.className = 'sr-only';
    element.id = 'screen-reader-live-region';
    document.body.appendChild(element);
    return element;
  }

  announce(message, priority = 'polite') {
    const target = priority === 'assertive' ? this.liveRegion : this.announcementElement;
    target.textContent = message;

    // Clear after announcement
    setTimeout(() => {
      target.textContent = '';
    }, 1000);
  }

  announceGameState(state) {
    let message = '';

    switch (state) {
      case 'gameStarted':
        message = 'Game started. Use arrow keys to move, space to cast spells.';
        break;
      case 'spellCast':
        message = 'Spell cast successfully.';
        break;
      case 'manaLow':
        message = 'Warning: Mana is low.';
        break;
      case 'healthLow':
        message = 'Warning: Health is low.';
        break;
      case 'gameOver':
        message = 'Game over. Press Enter to restart.';
        break;
    }

    this.announce(message, 'assertive');
  }
}

// Apply ARIA labels to UI elements
export function applyAriaLabels() {
  // Health bar
  const healthBar = document.querySelector('.health-bar');
  if (healthBar) {
    healthBar.setAttribute('role', 'progressbar');
    healthBar.setAttribute('aria-valuemin', '0');
    healthBar.setAttribute('aria-valuemax', '100');
    healthBar.setAttribute('aria-label', 'Player health');
  }

  // Mana bar
  const manaBar = document.querySelector('.mana-bar');
  if (manaBar) {
    manaBar.setAttribute('role', 'progressbar');
    manaBar.setAttribute('aria-valuemin', '0');
    manaBar.setAttribute('aria-valuemax', '100');
    manaBar.setAttribute('aria-label', 'Player mana');
  }

  // Spell buttons
  const spellButtons = document.querySelectorAll('.spell-button');
  spellButtons.forEach((button, index) => {
    button.setAttribute('aria-label', `Cast spell ${index + 1}`);
    button.setAttribute('role', 'button');
  });

  // Minimap
  const minimap = document.querySelector('.minimap');
  if (minimap) {
    minimap.setAttribute('role', 'img');
    minimap.setAttribute('aria-label', 'Game world minimap showing player position and nearby landmarks');
  }
}
```

**Step 3: Improve Color Contrast and Visual Accessibility**
```javascript
// src/utils/ColorAccessibility.js
export class ColorAccessibility {
  static improveContrast() {
    // Check if user prefers high contrast
    if (window.matchMedia('(prefers-contrast: high)').matches) {
      this.applyHighContrastTheme();
    }

    // Check for colorblind preferences
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      this.applyDarkTheme();
    }

    // Listen for preference changes
    window.matchMedia('(prefers-contrast: high)').addEventListener('change', (e) => {
      if (e.matches) {
        this.applyHighContrastTheme();
      } else {
        this.applyNormalContrastTheme();
      }
    });
  }

  static applyHighContrastTheme() {
    const style = document.createElement('style');
    style.textContent = `
      .health-bar { background: #000; border: 2px solid #fff; }
      .mana-bar { background: #000; border: 2px solid #fff; }
      .ui-button { background: #000; color: #fff; border: 2px solid #fff; }
      .ui-button:hover { background: #fff; color: #000; }
      .spell-button { background: #000; color: #fff; border: 2px solid #fff; }
      .minimap { border: 3px solid #fff; }
    `;
    document.head.appendChild(style);
  }

  static applyDarkTheme() {
    const style = document.createElement('style');
    style.textContent = `
      body { background: #1a1a1a; color: #ffffff; }
      .ui-panel { background: #2d2d2d; border: 1px solid #444; }
      .ui-button { background: #444; color: #fff; }
      .ui-button:hover { background: #666; }
    `;
    document.head.appendChild(style);
  }

  static checkColorContrast(foreground, background) {
    // Calculate contrast ratio using WCAG guidelines
    const l1 = this.getLuminance(foreground);
    const l2 = this.getLuminance(background);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    // WCAG AA requires 4.5:1 for normal text, 3:1 for large text
    return {
      ratio: ratio,
      aa: ratio >= 4.5,
      aaa: ratio >= 7,
      largeText: ratio >= 3
    };
  }

  static getLuminance(color) {
    // Convert hex to RGB, then to relative luminance
    const rgb = this.hexToRgb(color);
    const rsRGB = rgb.r / 255;
    const gsRGB = rgb.g / 255;
    const bsRGB = rgb.b / 255;

    const r = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
    const g = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
    const b = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  static hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }
}
```

**Step 4: Add Audio Cues and Descriptions**
```javascript
// src/game/systems/AudioAccessibilitySystem.js
export class AudioAccessibilitySystem extends System {
  constructor() {
    super();
    this.name = 'audioAccessibility';
    this.audioContext = null;
    this.enabled = true;
  }

  initialize() {
    this.setupAudioContext();
    this.loadAudioCues();
    this.setupAudioPreferences();
  }

  setupAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (error) {
      console.warn('Web Audio API not supported');
      this.enabled = false;
    }
  }

  loadAudioCues() {
    this.audioCues = {
      spellCast: this.loadAudio('audio/spell_cast.mp3'),
      manaLow: this.loadAudio('audio/mana_low.mp3'),
      healthLow: this.loadAudio('audio/health_low.mp3'),
      levelUp: this.loadAudio('audio/level_up.mp3'),
      gameOver: this.loadAudio('audio/game_over.mp3'),
      buttonHover: this.loadAudio('audio/button_hover.mp3'),
      navigation: this.loadAudio('audio/navigation.mp3')
    };
  }

  loadAudio(url) {
    if (!this.enabled) return null;

    const audio = new Audio();
    audio.src = url;
    audio.preload = 'auto';
    return audio;
  }

  playAudioCue(cueName, volume = 0.5) {
    if (!this.enabled || !this.audioCues[cueName]) return;

    const audio = this.audioCues[cueName].cloneNode();
    audio.volume = volume;
    audio.play().catch(error => {
      console.warn('Failed to play audio cue:', error);
    });
  }

  setupAudioPreferences() {
    // Check user preferences
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.enabled = false;
    }

    // Allow users to toggle audio cues
    this.createAudioToggle();
  }

  createAudioToggle() {
    const toggle = document.createElement('button');
    toggle.textContent = 'Toggle Audio Cues';
    toggle.setAttribute('aria-label', 'Toggle audio accessibility cues');
    toggle.className = 'audio-toggle accessibility-control';

    toggle.addEventListener('click', () => {
      this.enabled = !this.enabled;
      toggle.textContent = this.enabled ? 'Disable Audio Cues' : 'Enable Audio Cues';
      this.screenReader.announce(
        `Audio cues ${this.enabled ? 'enabled' : 'disabled'}`
      );
    });

    document.body.appendChild(toggle);
  }

  announceEvent(eventType, details = {}) {
    let message = '';

    switch (eventType) {
      case 'spellCast':
        message = `Spell cast: ${details.spellName || 'Unknown spell'}`;
        this.playAudioCue('spellCast');
        break;
      case 'manaLow':
        message = 'Mana is low';
        this.playAudioCue('manaLow');
        break;
      case 'healthLow':
        message = 'Health is low';
        this.playAudioCue('healthLow');
        break;
      case 'navigation':
        message = `Navigated to ${details.location || 'new area'}`;
        this.playAudioCue('navigation', 0.3);
        break;
    }

    if (message) {
      this.screenReader.announce(message);
    }
  }
}
```

**Step 5: Add Focus Management and Keyboard Shortcuts**
```javascript
// src/utils/FocusManagement.js
export class FocusManagement {
  static setupFocusTrap(container) {
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    container.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    });
  }

  static createSkipLinks() {
    const skipLinks = document.createElement('div');
    skipLinks.innerHTML = `
      <a href="#main-content" class="skip-link sr-only focus-visible">
        Skip to main content
      </a>
      <a href="#navigation" class="skip-link sr-only focus-visible">
        Skip to navigation
      </a>
    `;
    document.body.insertBefore(skipLinks, document.body.firstChild);
  }

  static announcePageChanges() {
    // Announce when major page sections change
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          const addedNode = mutation.addedNodes[0];
          if (addedNode.nodeType === Node.ELEMENT_NODE) {
            const heading = addedNode.querySelector('h1, h2, h3');
            if (heading) {
              screenReader.announce(`New section: ${heading.textContent}`);
            }
          }
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}

// Keyboard shortcuts
export const KEYBOARD_SHORTCUTS = {
  'h': 'Show help',
  'm': 'Toggle minimap',
  'i': 'Show inventory',
  'p': 'Pause game',
  'r': 'Restart game',
  's': 'Save game',
  '?': 'Show keyboard shortcuts'
};
```

## 4. Check & Commit

**Files to Update:**
- src/game/systems/AccessibilitySystem.js (new)
- src/utils/ScreenReader.js (new)
- src/utils/ColorAccessibility.js (new)
- src/game/systems/AudioAccessibilitySystem.js (new)
- src/utils/FocusManagement.js (new)
- src/game/core/Engine.js (register accessibility systems)

**Expected Impact:**
- Full keyboard navigation support
- Screen reader compatibility
- Better color contrast options
- Audio cues for important events
- Improved focus management
- Enhanced inclusive user experience

**Testing:**
- Test with screen readers (NVDA, JAWS, VoiceOver)
- Verify keyboard navigation works
- Check color contrast ratios
- Test audio cue functionality
- Validate ARIA implementation

**Commit Message:** feat: Add comprehensive accessibility features including keyboard navigation, screen reader support, and audio cues

**Status:** Ready for implementation