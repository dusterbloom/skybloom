import { useGameState, GameStates } from '../state/gameState';
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';
import { ensureVibeTheme } from '../ui/theme.js';

// Engineering readouts (fog, etc.) render only when explicitly enabled.
const debugUI = () => {
  try { return localStorage.getItem('vc.debug') === '1'; } catch (e) { return false; }
};

export class UISystem extends System {
  constructor(engine) {
    super(engine, 'ui');
    this.container = document.getElementById('ui-container');
    this.elements = {};
    this.unsubscribeState = null;

    // Minimap properties
    this.canvas = null;
    this.context = null;
    this.size = 150;
    this.baseRange = 10000;      // Base range for zoom calculations
    this.range = 10000;          // Current range (affected by zoom)
    this.zoomLevel = 1.0;        // Current zoom level (0.5 = zoomed out, 2.0 = zoomed in)
    this.minZoom = 0.25;         // Minimum zoom level
    this.maxZoom = 2.5;          // Maximum zoom level
    this.minimapContainer = null;
    this.lastUpdate = 0;
    this.updateInterval = 1/60;
    this.highlightedNodes = new Set(); // Set of node IDs to highlight
    this.highlightEndTime = 0; // When highlighting should end
    this.terrainColorCache = new Map(); // Cache for terrain colors
    this.cacheMaxSize = 1000; // Maximum cache size

    // Colors for minimap rendering
    this.colors = {
      ocean: '#1e3a8a',
      beach: '#f4a460',
      plains: '#90ee90',
      forest: '#228b22',
      hills: '#8b4513',
      mountains: '#696969',
      snow: '#ffffff',
      player: '#ffffff',
      otherPlayer: '#ff0000',
      landmark: '#ffff00',
      mana: '#00ff00',
      compassN: '#ffffff',
      compassE: '#ffffff',
      compassS: '#ffffff',
      compassW: '#ffffff',
      background: 'rgba(0, 0, 0, 0.8)',
      border: '#ffffff'
    };

    // Fog status display
    this.fogStatusElement = null;

    // Quest tracker toggle (Q) — panel is non-blocking, gameplay never pauses
    this._questKeyHandler = (e) => {
      if (e.code === 'KeyQ' && !e.repeat && this.engine.gameStarted) {
        this.showQuestLog();
      }
    };
    window.addEventListener('keydown', this._questKeyHandler);
  }

  async _initialize() {
    ensureVibeTheme();
    this.createBaseUI();
    this.createManaDisplay();
    // this.createHealthDisplay();
    // this.createSpellsUI();
    this.createMinimapContainer();
    this.createTimeControls();
    
    // Subscribe to game state changes
    this.unsubscribeState = useGameState.subscribe(
      this.handleStateChange.bind(this)
    );

    // Start fog status updates
    this.startFogStatusUpdates();

    Logger.info("UI system initialized");
    this.minimapInitialized = true;
  }

  createFogStatus() {
    if (!debugUI()) return; // engineering readout, not player UI
    // Create fog status element
    this.fogStatusElement = document.createElement('div');
    this.fogStatusElement.style.position = 'absolute';
    this.fogStatusElement.style.top = '10px';
    this.fogStatusElement.style.right = '10px';
    this.fogStatusElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    this.fogStatusElement.style.color = 'white';
    this.fogStatusElement.style.padding = '5px 10px';
    this.fogStatusElement.style.borderRadius = '5px';
    this.fogStatusElement.style.fontSize = '12px';
    this.fogStatusElement.style.fontFamily = 'monospace';
    this.fogStatusElement.style.zIndex = '1000';
    this.fogStatusElement.textContent = 'Fog: Initializing...';

    this.container.appendChild(this.fogStatusElement);
  }

  startFogStatusUpdates() {
    if (!debugUI()) return; // engineering readout, not player UI
    // Update fog status every 2 seconds
    this.fogStatusInterval = setInterval(() => {
      this.updateFogStatus();
    }, 2000);
  }

  updateFogStatus() {
    if (!this.fogStatusElement) return;

    const skyboxSystem = this.engine.systems.skybox;
    if (skyboxSystem && this.engine.scene && this.engine.scene.fog) {
      const fogColor = this.engine.scene.fog.color.getHexString();
      const fogDensity = this.engine.scene.fog.density.toFixed(6);
      const timeOfDay = skyboxSystem.timeOfDay.toFixed(2);

      this.fogStatusElement.textContent = `Fog: #${fogColor} | ${fogDensity} | T:${timeOfDay}`;
      this.fogStatusElement.style.display = 'block';
    } else {
      this.fogStatusElement.textContent = 'Fog: Not available';
    }
  }
  
  /**
   * Handle state changes
   */
  handleStateChange(state) {
    // Update UI elements based on game state
    const currentState = state.currentState;
    switch (currentState) {
      case GameStates.LOADING:
        if (this.minimapContainer) this.minimapContainer.style.display = 'none';
        break;
      case GameStates.INTRO:
        if (this.minimapContainer) this.minimapContainer.style.display = 'none';
        // IntroScreen handles its own visibility
        break;
      case GameStates.PLAYING:
        this.showGameUI();
        if (this.minimapContainer) this.minimapContainer.style.display = 'block';
        break;
      case GameStates.PAUSED:
        this.showPauseMenu();
        if (this.minimapContainer) this.minimapContainer.style.display = 'none';
        break;
    }
  }
  
  createBaseUI() {
    // Apply global UI styles
    this.container.style.position = 'absolute';
    this.container.style.top = '0';
    this.container.style.left = '0';

    // Create fog status display
    this.createFogStatus();
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.container.style.pointerEvents = 'none';
    this.container.style.display = 'flex';
    this.container.style.flexDirection = 'column';
    this.container.style.fontFamily = 'var(--vc-font)';
    this.container.style.color = 'white';
  }
  
  createManaDisplay() {
    // Mana pill, top-right — Twilight Glass chip with the cyan accent
    const manaContainer = document.createElement('div');
    manaContainer.className = 'vc-chip';
    manaContainer.style.position = 'absolute';
    manaContainer.style.top = '14px';
    manaContainer.style.right = '14px';

    const manaIcon = document.createElement('div');
    manaIcon.style.width = '8px';
    manaIcon.style.height = '8px';
    manaIcon.style.borderRadius = '50%';
    manaIcon.style.background = 'var(--vc-cyan)';
    manaIcon.style.boxShadow = '0 0 6px var(--vc-cyan)';

    const manaText = document.createElement('div');
    manaText.className = 'vc-num';
    manaText.textContent = '0';
    manaText.style.fontSize = '15px';
    manaText.style.fontWeight = '600';
    manaText.style.transition = 'transform 0.2s ease';

    manaContainer.appendChild(manaIcon);
    manaContainer.appendChild(manaText);
    this.container.appendChild(manaContainer);

    this.elements.manaText = manaText;
  }
  
  createHealthDisplay() {
    // Create health bar at bottom center
    const healthContainer = document.createElement('div');
    healthContainer.style.position = 'absolute';
    healthContainer.style.bottom = '20px';
    healthContainer.style.left = '50%';
    healthContainer.style.transform = 'translateX(-50%)';
    healthContainer.style.width = '200px';
    healthContainer.style.padding = '5px';
    healthContainer.style.background = 'rgba(0, 0, 30, 0.7)';
    healthContainer.style.borderRadius = '5px';
    healthContainer.style.boxShadow = '0 0 10px rgba(255, 0, 100, 0.5)';
    
    const healthBar = document.createElement('div');
    healthBar.style.height = '10px';
    healthBar.style.width = '100%';
    healthBar.style.background = 'linear-gradient(90deg, #ff0066, #ff6699)';
    healthBar.style.borderRadius = '3px';
    healthBar.style.boxShadow = 'inset 0 0 5px rgba(0, 0, 0, 0.5)';
    
    healthContainer.appendChild(healthBar);
    this.container.appendChild(healthContainer);
    
    this.elements.healthBar = healthBar;
  }
  
  createSpellsUI() {
    // Create spell selection UI at bottom right
    const spellsContainer = document.createElement('div');
    spellsContainer.style.position = 'absolute';
    spellsContainer.style.bottom = '20px';
    spellsContainer.style.right = '20px';
    spellsContainer.style.display = 'flex';
    spellsContainer.style.gap = '10px';
    spellsContainer.style.pointerEvents = 'auto';
    
    // Create spell slots
    const spells = [
      { name: 'Fireball', color: '#ff3300', key: '1' },
      { name: 'Lightning', color: '#33ccff', key: '2' },
      { name: 'Shield', color: '#ffcc00', key: '3' }
    ];
    
    this.elements.spellSlots = [];
    
    spells.forEach((spell, index) => {
      const spellSlot = document.createElement('div');
      spellSlot.style.width = '50px';
      spellSlot.style.height = '50px';
      spellSlot.style.borderRadius = '5px';
      spellSlot.style.background = 'rgba(0, 0, 30, 0.7)';
      spellSlot.style.display = 'flex';
      spellSlot.style.flexDirection = 'column';
      spellSlot.style.justifyContent = 'center';
      spellSlot.style.alignItems = 'center';
      spellSlot.style.cursor = 'pointer';
      spellSlot.style.transition = 'all 0.2s';
      spellSlot.style.boxShadow = `0 0 10px ${spell.color}80`;
      
      const spellIndicator = document.createElement('div');
      spellIndicator.style.width = '30px';
      spellIndicator.style.height = '30px';
      spellIndicator.style.borderRadius = '50%';
      spellIndicator.style.background = spell.color;
      spellIndicator.style.boxShadow = `0 0 5px ${spell.color}`;
      
      const spellKey = document.createElement('div');
      spellKey.textContent = spell.key;
      spellKey.style.fontSize = '12px';
      spellKey.style.marginTop = '5px';
      
      spellSlot.appendChild(spellIndicator);
      spellSlot.appendChild(spellKey);
      spellsContainer.appendChild(spellSlot);
      
      // Add hover effect
      spellSlot.addEventListener('mouseover', () => {
        spellSlot.style.transform = 'scale(1.1)';
      });
      
      spellSlot.addEventListener('mouseout', () => {
        spellSlot.style.transform = 'scale(1)';
      });
      
      // Add click handler
      spellSlot.addEventListener('click', () => {
        this.selectSpell(index);
      });
      
      this.elements.spellSlots.push({
        element: spellSlot,
        indicator: spellIndicator,
        data: spell
      });
    });
    
    this.container.appendChild(spellsContainer);
    
    // Listen for key presses to select spells
    window.addEventListener('keydown', (event) => {
      if (event.key >= '1' && event.key <= '3') {
        const index = parseInt(event.key) - 1;
        this.selectSpell(index);
      }
    });
  }
  
  createMinimapContainer() {
    // Remove existing container if present
    const existingContainer = document.getElementById('minimap-container');
    if (existingContainer) {
      existingContainer.remove();
    }

    // Create canvas for the minimap
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.style.borderRadius = '50%'; // Circular map
    this.canvas.style.display = 'block';

    // Create container for the minimap
    this.minimapContainer = document.createElement('div');
    this.minimapContainer.id = 'minimap-container';
    this.minimapContainer.style.position = 'absolute';
    this.minimapContainer.style.top = '10px';
    this.minimapContainer.style.left = '10px';
    this.minimapContainer.style.width = `${this.size}px`;
    this.minimapContainer.style.height = `${this.size}px`;
    this.minimapContainer.style.border = '2px solid ' + this.colors.border;
    this.minimapContainer.style.backgroundColor = this.colors.background;
    this.minimapContainer.style.borderRadius = '50%';
    this.minimapContainer.style.boxShadow = '0 0 20px rgba(255, 255, 255, 0.3)';
    this.minimapContainer.style.pointerEvents = 'none';
    this.minimapContainer.style.zIndex = '1000';

    // Append canvas to container
    this.minimapContainer.appendChild(this.canvas);

    // Create zoom controls
    const zoomControls = document.createElement('div');
    zoomControls.style.position = 'absolute';
    zoomControls.style.top = '5px';
    zoomControls.style.right = '5px';
    zoomControls.style.display = 'flex';
    zoomControls.style.flexDirection = 'column';
    zoomControls.style.gap = '2px';
    zoomControls.style.pointerEvents = 'auto';

    // Zoom in button
    const zoomInBtn = document.createElement('button');
    zoomInBtn.textContent = '+';
    zoomInBtn.style.width = '20px';
    zoomInBtn.style.height = '20px';
    zoomInBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    zoomInBtn.style.color = '#ffffff';
    zoomInBtn.style.border = '1px solid #ffffff';
    zoomInBtn.style.borderRadius = '3px';
    zoomInBtn.style.cursor = 'pointer';
    zoomInBtn.style.fontSize = '12px';
    zoomInBtn.style.fontWeight = 'bold';
    zoomInBtn.style.display = 'flex';
    zoomInBtn.style.alignItems = 'center';
    zoomInBtn.style.justifyContent = 'center';
    zoomInBtn.title = 'Zoom In';
    zoomInBtn.addEventListener('click', () => this.zoomIn());

    // Zoom out button
    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.textContent = '−';
    zoomOutBtn.style.width = '20px';
    zoomOutBtn.style.height = '20px';
    zoomOutBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    zoomOutBtn.style.color = '#ffffff';
    zoomOutBtn.style.border = '1px solid #ffffff';
    zoomOutBtn.style.borderRadius = '3px';
    zoomOutBtn.style.cursor = 'pointer';
    zoomOutBtn.style.fontSize = '12px';
    zoomOutBtn.style.fontWeight = 'bold';
    zoomOutBtn.style.display = 'flex';
    zoomOutBtn.style.alignItems = 'center';
    zoomOutBtn.style.justifyContent = 'center';
    zoomOutBtn.title = 'Zoom Out';
    zoomOutBtn.addEventListener('click', () => this.zoomOut());

    // Reset zoom button
    const resetZoomBtn = document.createElement('button');
    resetZoomBtn.textContent = '⌖';
    resetZoomBtn.style.width = '20px';
    resetZoomBtn.style.height = '20px';
    resetZoomBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    resetZoomBtn.style.color = '#ffffff';
    resetZoomBtn.style.border = '1px solid #ffffff';
    resetZoomBtn.style.borderRadius = '3px';
    resetZoomBtn.style.cursor = 'pointer';
    resetZoomBtn.style.fontSize = '12px';
    resetZoomBtn.style.display = 'flex';
    resetZoomBtn.style.alignItems = 'center';
    resetZoomBtn.style.justifyContent = 'center';
    resetZoomBtn.title = 'Reset Zoom';
    resetZoomBtn.addEventListener('click', () => this.resetZoom());

    // Zoom level indicator
    const zoomIndicator = document.createElement('div');
    zoomIndicator.style.width = '20px';
    zoomIndicator.style.height = '16px';
    zoomIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    zoomIndicator.style.color = '#ffffff';
    zoomIndicator.style.border = '1px solid #ffffff';
    zoomIndicator.style.borderRadius = '3px';
    zoomIndicator.style.fontSize = '8px';
    zoomIndicator.style.fontWeight = 'bold';
    zoomIndicator.style.display = 'flex';
    zoomIndicator.style.alignItems = 'center';
    zoomIndicator.style.justifyContent = 'center';
    zoomIndicator.style.marginTop = '2px';
    zoomIndicator.textContent = '1.0x';
    this.zoomIndicator = zoomIndicator;

    zoomControls.appendChild(zoomInBtn);
    zoomControls.appendChild(zoomOutBtn);
    zoomControls.appendChild(resetZoomBtn);
    zoomControls.appendChild(zoomIndicator);

    // Append zoom controls to container
    this.minimapContainer.appendChild(zoomControls);

    // Add mouse wheel zoom support
    this.minimapContainer.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (event.deltaY < 0) {
        this.zoomIn();
      } else {
        this.zoomOut();
      }
    });

    // Create legend toggle button
    const legendBtn = document.createElement('button');
    legendBtn.textContent = '?';
    legendBtn.style.position = 'absolute';
    legendBtn.style.bottom = '5px';
    legendBtn.style.right = '5px';
    legendBtn.style.width = '20px';
    legendBtn.style.height = '20px';
    legendBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    legendBtn.style.color = '#ffffff';
    legendBtn.style.border = '1px solid #ffffff';
    legendBtn.style.borderRadius = '3px';
    legendBtn.style.cursor = 'pointer';
    legendBtn.style.fontSize = '12px';
    legendBtn.style.fontWeight = 'bold';
    legendBtn.style.display = 'flex';
    legendBtn.style.alignItems = 'center';
    legendBtn.style.justifyContent = 'center';
    legendBtn.style.pointerEvents = 'auto';
    legendBtn.title = 'Minimap Legend';
    legendBtn.style.zIndex = '10';

    // Create legend panel
    const legendPanel = document.createElement('div');
    legendPanel.style.position = 'absolute';
    legendPanel.style.bottom = '30px';
    legendPanel.style.right = '5px';
    legendPanel.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    legendPanel.style.border = '1px solid #ffffff';
    legendPanel.style.borderRadius = '5px';
    legendPanel.style.padding = '8px';
    legendPanel.style.color = '#ffffff';
    legendPanel.style.fontSize = '11px';
    legendPanel.style.fontFamily = 'Arial, sans-serif';
    legendPanel.style.display = 'none';
    legendPanel.style.pointerEvents = 'auto';
    legendPanel.style.zIndex = '11';
    legendPanel.style.maxWidth = '150px';

    legendPanel.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 5px;">Legend</div>
      <div style="display: flex; align-items: center; margin-bottom: 3px;">
        <div style="width: 12px; height: 12px; background: #ffffff; border-radius: 50%; margin-right: 5px;"></div>
        <span>You</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 3px;">
        <div style="width: 12px; height: 12px; background: #00ff00; border-radius: 50%; margin-right: 5px;"></div>
        <span>Mana</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 3px;">
        <div style="width: 12px; height: 12px; background: #ffff00; border-radius: 50%; margin-right: 5px;"></div>
        <span>Landmark</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 3px;">
        <div style="width: 12px; height: 12px; background: #ff0000; border-radius: 50%; margin-right: 5px;"></div>
        <span>Other Player</span>
      </div>
      <div style="margin-top: 5px; font-size: 10px; color: #cccccc;">
        N/S/E/W: Cardinal directions
      </div>
    `;

    // Toggle legend visibility
    legendBtn.addEventListener('click', () => {
      legendPanel.style.display = legendPanel.style.display === 'none' ? 'block' : 'none';
    });

    // Hide legend when clicking outside
    document.addEventListener('click', (event) => {
      if (!legendBtn.contains(event.target) && !legendPanel.contains(event.target)) {
        legendPanel.style.display = 'none';
      }
    });

    // Append legend to container
    this.minimapContainer.appendChild(legendBtn);
    this.minimapContainer.appendChild(legendPanel);

    // Append container to UI container
    this.container.appendChild(this.minimapContainer);

    Logger.info("Minimap container with zoom controls created in UISystem");
  }

  createTimeControls() {
    // Create time controls container
    const timeContainer = document.createElement('div');
    timeContainer.id = 'time-controls';
    timeContainer.style.position = 'absolute';
    timeContainer.style.top = '10px';
    timeContainer.style.right = '10px';
    timeContainer.style.display = 'flex';
    timeContainer.style.flexDirection = 'column';
    timeContainer.style.alignItems = 'flex-end';
    timeContainer.style.gap = '5px';
    timeContainer.style.zIndex = '1000';

    // Time display
    const timeDisplay = document.createElement('div');
    timeDisplay.id = 'time-display';
    timeDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    timeDisplay.style.color = '#ffffff';
    timeDisplay.style.padding = '10px 15px';
    timeDisplay.style.borderRadius = '8px';
    timeDisplay.style.fontSize = '16px';
    timeDisplay.style.fontFamily = 'monospace';
    timeDisplay.style.border = '2px solid #ffffff';
    timeDisplay.style.boxShadow = '0 0 15px rgba(255, 255, 255, 0.5)';
    timeDisplay.style.position = 'relative';
    timeDisplay.style.zIndex = '1000';
    timeDisplay.style.marginBottom = '10px';
    timeDisplay.textContent = '12:00';

    // Control buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'flex';
    buttonsContainer.style.gap = '5px';

    // Play/Pause button
    const playPauseBtn = document.createElement('button');
    playPauseBtn.id = 'play-pause-btn';
    playPauseBtn.textContent = '⏸️';
    playPauseBtn.style.padding = '6px 10px';
    playPauseBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    playPauseBtn.style.color = '#ffffff';
    playPauseBtn.style.border = '1px solid #ffffff';
    playPauseBtn.style.borderRadius = '3px';
    playPauseBtn.style.cursor = 'pointer';
    playPauseBtn.style.fontSize = '12px';
    playPauseBtn.style.boxShadow = '0 0 5px rgba(255, 255, 255, 0.3)';
    playPauseBtn.title = 'Play/Pause time';

    // Speed control buttons
    const speedButtons = [
      { label: '1x', speed: 1.0 },
      { label: '2x', speed: 2.0 },
      { label: '60x', speed: 60.0 },
      { label: '120x', speed: 120.0 }
    ];

    const speedBtnElements = [];

    speedButtons.forEach(({ label, speed }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.dataset.speed = speed;
      btn.style.padding = '8px 12px';
      btn.style.backgroundColor = speed === 1.0 ? 'rgba(255, 255, 0, 0.9)' : 'rgba(0, 0, 0, 0.8)';
      btn.style.color = '#ffffff';
      btn.style.border = '2px solid #ffffff';
      btn.style.borderRadius = '6px';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '14px';
      btn.style.fontWeight = 'bold';
      btn.style.boxShadow = '0 0 10px rgba(255, 255, 255, 0.5)';
      btn.style.margin = '2px';
      btn.style.transition = 'all 0.2s ease';
      btn.title = `Set time speed to ${label}`;

      // Add hover effects
      btn.addEventListener('mouseover', () => {
        btn.style.transform = 'scale(1.05)';
        btn.style.boxShadow = '0 0 15px rgba(255, 255, 255, 0.8)';
      });
      btn.addEventListener('mouseout', () => {
        btn.style.transform = 'scale(1)';
        btn.style.boxShadow = '0 0 10px rgba(255, 255, 255, 0.5)';
      });

      btn.addEventListener('click', () => {
        this.setTimeSpeed(speed);
        // Update button styles
        speedBtnElements.forEach(b => {
          b.style.backgroundColor = b.dataset.speed == speed ? 'rgba(255, 255, 0, 0.8)' : 'rgba(0, 0, 0, 0.8)';
        });
      });

      speedBtnElements.push(btn);
      buttonsContainer.appendChild(btn);
    });

    // Time preset buttons
    const timePresets = [
      { label: 'Dawn', time: 0.25 },
      { label: 'Noon', time: 0.5 },
      { label: 'Dusk', time: 0.75 },
      { label: 'Midnight', time: 0.0 }
    ];

    const presetContainer = document.createElement('div');
    presetContainer.style.display = 'flex';
    presetContainer.style.gap = '3px';
    presetContainer.style.marginTop = '5px';

    timePresets.forEach(({ label, time }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.dataset.time = time;
      btn.style.padding = '3px 6px';
      btn.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
      btn.style.color = '#ffffff';
      btn.style.border = '1px solid #ffffff';
      btn.style.borderRadius = '3px';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '10px';
      btn.style.boxShadow = '0 0 5px rgba(255, 255, 255, 0.3)';
      btn.title = `Set time to ${label.toLowerCase()}`;

      btn.addEventListener('click', () => {
        this.setTimeOfDay(time);
      });

      presetContainer.appendChild(btn);
    });

    // Event listeners
    let isPlaying = true;
    playPauseBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      playPauseBtn.textContent = isPlaying ? '⏸️' : '▶️';
      this.setTimeSpeed(isPlaying ? 1.0 : 0.0);
    });

    // Add elements to container
    timeContainer.appendChild(timeDisplay);
    timeContainer.appendChild(buttonsContainer);
    timeContainer.appendChild(presetContainer);

    // Add to UI container
    this.container.appendChild(timeContainer);

    // Store references
    this.elements.timeDisplay = timeDisplay;
    this.elements.playPauseBtn = playPauseBtn;
    this.elements.speedButtons = speedBtnElements;

    Logger.info("Time controls created in UISystem");
  }

  setTimeSpeed(speed) {
    Logger.debug(`setTimeSpeed called with speed=${speed}`);
    const atmosphereSystem = this.engine.systemManager.get('atmosphere');
    if (atmosphereSystem) {
      const oldSpeed = atmosphereSystem.timeScale;
      atmosphereSystem.timeScale = speed;
      Logger.info(`Time speed changed from ${oldSpeed}x to ${speed}x`);

      // Update button styles to reflect current speed
      if (this.elements.speedButtons) {
        this.elements.speedButtons.forEach(btn => {
          const btnSpeed = parseFloat(btn.dataset.speed);
          btn.style.backgroundColor = btnSpeed === speed ? 'rgba(255, 255, 0, 0.9)' : 'rgba(0, 0, 0, 0.8)';
        });
        Logger.debug(`Updated ${this.elements.speedButtons.length} speed button styles`);
      } else {
        Logger.warn('speedButtons not found in elements');
      }
    } else {
      Logger.error('AtmosphereSystem not found when setting time speed');
      Logger.debug('Available systems:', Array.from(this.engine.systemManager.systems.keys()));
    }
  }

  setTimeOfDay(timeOfDay) {
    const atmosphereSystem = this.engine.systemManager.get('atmosphere');
    if (atmosphereSystem) {
      atmosphereSystem.timeOfDay = timeOfDay;
      Logger.info(`Time of day set to ${timeOfDay}`);
    }
  }

  updateTimeDisplay() {
    const atmosphereSystem = this.engine.systemManager.get('atmosphere');
    if (atmosphereSystem && this.elements.timeDisplay) {
      const timeOfDay = atmosphereSystem.getTimeOfDay();
      const hours = Math.floor(timeOfDay * 24);
      const minutes = Math.floor((timeOfDay * 24 * 60) % 60);
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;

      this.elements.timeDisplay.textContent = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    }
  }

  _worldToMap(x, z) {
    const playerState = this.engine.systemManager.get('playerState');
    const player = playerState?.localPlayer;
    if (!player) return { mapX: this.size / 2, mapY: this.size / 2 };

    const playerX = player.position.x;
    const playerZ = player.position.z;

    // Use current range (affected by zoom level)
    const mapX = this.size / 2 + (x - playerX) / this.range * this.size;
    const mapY = this.size / 2 - (z - playerZ) / this.range * this.size;

    // Clamp to map bounds
    const clampedX = Math.max(0, Math.min(this.size, mapX));
    const clampedY = Math.max(0, Math.min(this.size, mapY));

    return { mapX: clampedX, mapY: clampedY };
  }

  _clear() {
    // Clear canvas with background color
    this.context.fillStyle = this.colors.background;
    this.context.fillRect(0, 0, this.size, this.size);

    // Draw circular border
    this.context.beginPath();
    this.context.arc(this.size / 2, this.size / 2, this.size / 2 - 1, 0, 2 * Math.PI);
    this.context.strokeStyle = this.colors.border;
    this.context.lineWidth = 2;
    this.context.stroke();

    // Clip future drawing to circular area
    this.context.beginPath();
    this.context.arc(this.size / 2, this.size / 2, this.size / 2 - 2, 0, 2 * Math.PI);
    this.context.clip();
  }

  _getTerrainColor(height, biome) {
    // Helper to determine terrain color based on height and biome
    if (biome === 'ocean') return this.colors.ocean;
    if (biome === 'beach') return this.colors.beach;
    if (biome === 'plains') return this.colors.plains;
    if (biome === 'forest') return this.colors.forest;
    if (biome === 'hills') return this.colors.hills;
    if (biome === 'mountains') return this.colors.mountains;
    if (biome === 'snow') return this.colors.snow;

    // Default based on height
    if (height < 0) return this.colors.ocean;
    if (height < 10) return this.colors.beach;
    if (height < 50) return this.colors.plains;
    if (height < 100) return this.colors.forest;
    if (height < 200) return this.colors.hills;
    if (height < 300) return this.colors.mountains;
    return this.colors.snow;
  }

  _drawTerrain() {
    const worldSystem = this.engine.systemManager.get('world');
    if (!worldSystem) return;

    const playerState = this.engine.systemManager.get('playerState');
    const player = playerState?.localPlayer;
    if (!player) return;

    const playerX = player.position.x;
    const playerZ = player.position.z;
    // Adaptive sampling based on device and zoom level
    const isMobile = this.engine?.isMobile || false;
    const baseSamples = isMobile ? 20 : 30; // Fewer samples on mobile
    const zoomAdjustment = Math.max(0.5, this.zoomLevel); // Higher zoom = more detail
    const numSamples = Math.floor(baseSamples * zoomAdjustment);
    const sampleStep = this.size / numSamples;

    // Create ImageData for batch pixel operations
    const imageData = this.context.createImageData(this.size, this.size);
    const data = imageData.data;

    for (let i = 0; i < numSamples; i++) {
      for (let j = 0; j < numSamples; j++) {
        // Map coordinates
        const mapX = i * sampleStep;
        const mapY = j * sampleStep; // Use mapY for vertical axis

        // Convert map coordinates to world coordinates (inverse of _worldToMap)
        const worldX = playerX + (mapX - this.size / 2) * this.range / this.size;
        const worldZ = playerZ + (this.size / 2 - mapY) * this.range / this.size; // Account for inversion

        // Create cache key for this position
        const cacheKey = `${worldX.toFixed(1)}_${worldZ.toFixed(1)}`;

        // Check cache first
        let terrainColor = this.terrainColorCache.get(cacheKey);

        if (!terrainColor) {
          // Sample terrain at this world position
          const height = worldSystem.getTerrainHeight(worldX, worldZ);

        // Try to get accurate biome color from WorldSystem
           try {
             // Use WorldSystem's getBiomeColor method for accurate colors
             const biomeColor = worldSystem.getBiomeColor(height, worldX, worldZ);
             if (biomeColor && biomeColor.r !== undefined) {
               // biomeColor is a THREE.Color object
               terrainColor = `rgb(${Math.floor(biomeColor.r * 255)}, ${Math.floor(biomeColor.g * 255)}, ${Math.floor(biomeColor.b * 255)})`;
             }
           } catch (error) {
             // Fallback to height-based classification if WorldSystem method fails
             Logger.debug('Using fallback terrain color classification');
           }

          // Fallback to height-based classification if biome color not available
          if (!terrainColor) {
            let biome = 'plains';
            if (height < -10) biome = 'ocean';
            else if (height < 5) biome = 'beach';
            else if (height < 50) biome = 'plains';
            else if (height < 100) biome = 'forest';
            else if (height < 200) biome = 'hills';
            else if (height < 300) biome = 'mountains';
            else biome = 'snow';

            terrainColor = this._getTerrainColor(height, biome);
          }

          // Cache the result
          this.terrainColorCache.set(cacheKey, terrainColor);

          // Maintain cache size
          if (this.terrainColorCache.size > this.cacheMaxSize) {
            const firstKey = this.terrainColorCache.keys().next().value;
            this.terrainColorCache.delete(firstKey);
          }
        }

        const [r, g, b] = this.parseColorString(terrainColor);

        // Fill the pixel block for this sample
        const blockSize = Math.ceil(sampleStep);
        for (let px = 0; px < blockSize && mapX + px < this.size; px++) {
          for (let py = 0; py < blockSize && mapY + py < this.size; py++) {
            const pixelX = Math.floor(mapX + px);
            const pixelY = Math.floor(mapY + py);
            const pixelIndex = (pixelY * this.size + pixelX) * 4;
            data[pixelIndex] = r;     // Red
            data[pixelIndex + 1] = g; // Green
            data[pixelIndex + 2] = b; // Blue
            data[pixelIndex + 3] = 255; // Alpha
          }
        }
      }
    }

    // Put the ImageData back to canvas (single batch operation)
    this.context.putImageData(imageData, 0, 0);
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : [0, 0, 0];
  }

  parseColorString(colorStr) {
    // Handle RGB strings like "rgb(255, 255, 255)"
    const rgbMatch = colorStr.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (rgbMatch) {
      return [
        parseInt(rgbMatch[1], 10),
        parseInt(rgbMatch[2], 10),
        parseInt(rgbMatch[3], 10)
      ];
    }

    // Fallback to hex parsing
    return this.hexToRgb(colorStr);
  }

  _drawLandmarks() {
    const landmarkSystem = this.engine.systemManager.get('landmarks');
    if (!landmarkSystem || !landmarkSystem.landmarks) return;

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const currentTime = Date.now() * 0.001; // For pulsing effect

    landmarkSystem.landmarks.forEach(landmark => {
      const { mapX, mapY } = this._worldToMap(landmark.position.x, landmark.position.z);
      const distance = Math.sqrt((mapX - centerX) ** 2 + (mapY - centerY) ** 2);

      // Scale size based on distance (larger when closer)
      const baseSize = 5;
      const size = Math.max(3, baseSize - distance * 0.05);

      // Enhanced colors based on landmark type
      let landmarkColor = this.colors.landmark;
      if (landmark.type === 'ancient_ruins') {
        landmarkColor = '#DAA520'; // Golden
      } else if (landmark.type === 'magical_circle') {
        landmarkColor = '#9932CC'; // Dark orchid
      } else if (landmark.type === 'crystal_formation') {
        landmarkColor = '#00CED1'; // Dark turquoise
      }

      // Draw outer glow ring
      this.context.shadowColor = landmarkColor;
      this.context.shadowBlur = 8;
      this.context.beginPath();
      this.context.arc(mapX, mapY, size + 2, 0, 2 * Math.PI);
      this.context.fillStyle = landmarkColor + '40'; // Semi-transparent
      this.context.fill();

      // Draw main landmark circle
      this.context.shadowBlur = 4;
      this.context.beginPath();
      this.context.arc(mapX, mapY, size, 0, 2 * Math.PI);
      this.context.fillStyle = landmarkColor;
      this.context.fill();

      // Add pulsing inner highlight
      const pulseIntensity = 0.3 + 0.2 * Math.sin(currentTime * 2 + distance * 0.1);
      this.context.shadowBlur = 2;
      this.context.beginPath();
      this.context.arc(mapX, mapY, size * 0.6, 0, 2 * Math.PI);
      this.context.fillStyle = landmarkColor + Math.floor(pulseIntensity * 255).toString(16).padStart(2, '0');
      this.context.fill();

      // Add label for nearby landmarks
      if (distance < 40) {
        this.context.shadowBlur = 0;
        this.context.fillStyle = '#FFFFFF';
        this.context.font = 'bold 10px Arial';
        this.context.textAlign = 'center';
        this.context.fillText(landmark.type.replace('_', ' '), mapX, mapY - size - 8);
      }

      // Reset shadow
      this.context.shadowBlur = 0;
    });
  }

  _drawMana() {
    const worldSystem = this.engine.systemManager.get('world');
    if (!worldSystem || !worldSystem.manaNodes) return;

    const centerX = this.size / 2;
    const centerY = this.size / 2;
    const currentTime = Date.now() * 0.001; // For pulsing effect

    worldSystem.manaNodes.forEach(manaNode => {
      if (manaNode.collected) return; // Skip collected mana

      const { mapX, mapY } = this._worldToMap(manaNode.position.x, manaNode.position.z);
      const distance = Math.sqrt((mapX - centerX) ** 2 + (mapY - centerY) ** 2);

      // Check if this node is highlighted
      const nodeId = `${manaNode.position.x.toFixed(1)}_${manaNode.position.z.toFixed(1)}`;
      const isHighlighted = this.highlightedNodes.has(nodeId) && Date.now() < this.highlightEndTime;

      // Scale size based on distance and highlighting (larger when closer or highlighted)
      const baseSize = isHighlighted ? 6 : 4;
      const size = Math.max(2, baseSize - distance * 0.03);

      // Enhanced mana color with pulsing effect (more intense when highlighted)
      const pulseSpeed = isHighlighted ? 5 : 3;
      const pulseIntensity = isHighlighted ?
        0.8 + 0.2 * Math.sin(currentTime * pulseSpeed + distance * 0.05) :
        0.6 + 0.4 * Math.sin(currentTime * pulseSpeed + distance * 0.05);
      const manaColor = isHighlighted ? '#00FFFF' : this.colors.mana; // Cyan for highlighted

      // Draw outer glow ring (larger and more intense for highlighted nodes)
      this.context.shadowColor = manaColor;
      this.context.shadowBlur = isHighlighted ? 20 : 12;
      this.context.beginPath();
      this.context.arc(mapX, mapY, size + (isHighlighted ? 5 : 3), 0, 2 * Math.PI);
      this.context.fillStyle = manaColor + (isHighlighted ? '50' : '30'); // More opaque for highlighted
      this.context.fill();

      // Draw middle glow ring
      this.context.shadowBlur = isHighlighted ? 10 : 6;
      this.context.beginPath();
      this.context.arc(mapX, mapY, size + (isHighlighted ? 2.5 : 1.5), 0, 2 * Math.PI);
      this.context.fillStyle = manaColor + (isHighlighted ? '80' : '60'); // More opaque for highlighted
      this.context.fill();

      // Draw main mana orb
      this.context.shadowBlur = 3;
      this.context.beginPath();
      this.context.arc(mapX, mapY, size, 0, 2 * Math.PI);
      this.context.fillStyle = manaColor;
      this.context.fill();

      // Add bright inner core with pulsing
      this.context.shadowBlur = 1;
      this.context.beginPath();
      this.context.arc(mapX, mapY, size * 0.5, 0, 2 * Math.PI);
      const coreAlpha = Math.floor(pulseIntensity * 255).toString(16).padStart(2, '0');
      this.context.fillStyle = '#FFFFFF' + coreAlpha; // White core with pulsing alpha
      this.context.fill();

      // Add scan highlight ring for highlighted nodes
      if (isHighlighted) {
        this.context.shadowBlur = 0;
        this.context.strokeStyle = '#FFFFFF';
        this.context.lineWidth = 2;
        this.context.setLineDash([5, 5]);
        this.context.beginPath();
        this.context.arc(mapX, mapY, size + 8, 0, 2 * Math.PI);
        this.context.stroke();
        this.context.setLineDash([]); // Reset line dash
      }

      // Add mana value indicator for nearby nodes
      if (distance < 30 && manaNode.userData?.value) {
        this.context.shadowBlur = 0;
        this.context.fillStyle = isHighlighted ? '#FFFF00' : '#FFFFFF'; // Yellow for highlighted
        this.context.font = 'bold 9px Arial';
        this.context.textAlign = 'center';
        this.context.fillText(manaNode.userData.value.toString(), mapX, mapY - size - 6);
      }

      // Reset shadow and line dash
      this.context.shadowBlur = 0;
      this.context.setLineDash([]);
    });
  }

  _drawPlayerOffMap() {
    // Draw off-map indicator in corner
    this.context.fillStyle = this.colors.player;
    this.context.beginPath();
    this.context.arc(5, 5, 3, 0, 2 * Math.PI);
    this.context.fill();
  }

  _drawPlayers() {
    const playerState = this.engine.systemManager.get('playerState');
    const playerSystem = this.engine.systemManager.get('player');
    if (!playerState) return;

    const localPlayer = playerState.localPlayer;
    const players = playerSystem?.players || {};

    // Draw other players
    Object.values(players).forEach(player => {
      if (player.id === localPlayer?.id) return; // Skip local player

      const { mapX, mapY } = this._worldToMap(player.position.x, player.position.z);
      
      // Draw player dot (red for others)
      this.context.beginPath();
      this.context.arc(mapX, mapY, 2, 0, 2 * Math.PI);
      this.context.fillStyle = this.colors.otherPlayer;
      this.context.fill();

      // Draw player name if close enough
      if (mapX > 10 && mapX < this.size - 10 && mapY > 10 && mapY < this.size - 10) {
        this.context.fillStyle = this.colors.otherPlayer;
        this.context.font = '8px Arial';
        this.context.textAlign = 'center';
        this.context.fillText(player.name || 'Player', mapX, mapY - 5);
      }
    });
    // Draw local player (white dot with direction indicator)
    if (localPlayer) {
      const centerX = this.size / 2;
      const centerY = this.size / 2;

      // Draw local player dot (larger and more prominent)
      this.context.beginPath();
      this.context.arc(centerX, centerY, 3, 0, 2 * Math.PI);
      this.context.fillStyle = this.colors.player;
      this.context.fill();

      // Add player glow effect
      this.context.shadowColor = this.colors.player;
      this.context.shadowBlur = 4;
      this.context.beginPath();
      this.context.arc(centerX, centerY, 3, 0, 2 * Math.PI);
      this.context.fillStyle = this.colors.player;
      this.context.fill();
      this.context.shadowBlur = 0;

      // Direction indicator removed - keeping only the player dot
    }
  }

  _drawCompassRose() {
    const centerX = this.size / 2;
    const centerY = this.size / 2;

    // Get player rotation for compass orientation
    const playerState = this.engine.systemManager.get('playerState');
    const player = playerState?.localPlayer;
    const playerRotation = player?.rotation?.y || 0;

    // Save context for rotation
    this.context.save();

    // Rotate entire compass to match player viewpoint
    this.context.translate(centerX, centerY);
    this.context.rotate(-playerRotation);
    this.context.translate(-centerX, -centerY);

    // Draw compass labels at outer edge of map circle
    const labels = [
      { text: 'N', angle: -Math.PI/2, distance: 65, color: this.colors.compassN },
      { text: 'E', angle: 0, distance: 65, color: this.colors.compassE },
      { text: 'S', angle: Math.PI/2, distance: 65, color: this.colors.compassS },
      { text: 'W', angle: Math.PI, distance: 65, color: this.colors.compassW }
    ];

    this.context.font = 'bold 12px Arial';
    this.context.textAlign = 'center';
    this.context.textBaseline = 'middle';

    labels.forEach(label => {
      const x = centerX + Math.cos(label.angle) * label.distance;
      const y = centerY + Math.sin(label.angle) * label.distance;
      this.context.fillStyle = label.color;
      this.context.fillText(label.text, x, y);
    });

    // Restore context
    this.context.restore();

    // Draw center dot (always at center, not rotated)
    this.context.beginPath();
    this.context.arc(centerX, centerY, 2, 0, 2 * Math.PI);
    this.context.fillStyle = this.colors.player;
    this.context.fill();

    // North indicator arrow removed
  }
  
  selectSpell(index) {
    // Highlight selected spell and reset others (slot UI is currently
    // disabled — guard so spell selection never throws without it)
    (this.elements.spellSlots || []).forEach((slot, i) => {
      if (i === index) {
        slot.element.style.transform = 'scale(1.1)';
        slot.indicator.style.boxShadow = `0 0 10px ${slot.data.color}`;
      } else {
        slot.element.style.transform = 'scale(1)';
        slot.indicator.style.boxShadow = `0 0 5px ${slot.data.color}`;
      }
    });
    
    // Notify game about spell selection
    const playerState = this.engine.systemManager.get('playerState');
    if (playerState && playerState.localPlayer) {
      playerState.localPlayer.currentSpell = index;
    }
  }
  
  updateManaDisplay(mana) {
    if (this.elements.manaText) {
      this.elements.manaText.textContent = mana.toString();
      
      // Add pulse animation when mana changes
      this.elements.manaText.style.transform = 'scale(1.2)';
      setTimeout(() => {
        this.elements.manaText.style.transform = 'scale(1)';
      }, 200);
    }
  }
  
  showMessage(text, duration = 3500, accentColor = '#66ffee') {
    // Stacking corner toasts — never centered, never input-blocking.
    if (!this.elements.toastStack) {
      const stack = document.createElement('div');
      stack.style.position = 'fixed';
      stack.style.top = '70px';
      stack.style.right = '12px';
      stack.style.display = 'flex';
      stack.style.flexDirection = 'column';
      stack.style.alignItems = 'flex-end';
      stack.style.gap = '8px';
      stack.style.pointerEvents = 'none';
      stack.style.zIndex = '1001';
      document.body.appendChild(stack);
      this.elements.toastStack = stack;
    }
    const stack = this.elements.toastStack;
    while (stack.children.length >= 4) stack.removeChild(stack.firstChild);

    const toast = document.createElement('div');
    toast.style.background = 'rgba(20, 30, 60, 0.78)';
    toast.style.color = '#fff';
    toast.style.padding = '8px 14px';
    toast.style.borderRadius = '10px';
    toast.style.borderLeft = `3px solid ${accentColor}`;
    toast.style.fontFamily = 'var(--app-font, sans-serif)';
    toast.style.fontSize = '14px';
    toast.style.maxWidth = '280px';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(12px)';
    toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    toast.textContent = text;
    stack.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(12px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  updateHealthDisplay(health, maxHealth) {
    if (this.elements.healthBar) {
      const percentage = (health / maxHealth) * 100;
      this.elements.healthBar.style.width = `${percentage}%`;
      
      // Change color based on health
      if (percentage > 60) {
        this.elements.healthBar.style.background = 'linear-gradient(90deg, #ff0066, #ff6699)';
      } else if (percentage > 30) {
        this.elements.healthBar.style.background = 'linear-gradient(90deg, #ffcc00, #ff9900)';
      } else {
        this.elements.healthBar.style.background = 'linear-gradient(90deg, #ff3300, #ff6600)';
      }
    }
  }

  /**
   * Set the zoom level of the minimap
   * @param {number} level - Zoom level (0.25 to 2.5)
   */
  setZoomLevel(level) {
    this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, level));
    this.range = this.baseRange / this.zoomLevel;

    // Update zoom indicator if it exists
    if (this.zoomIndicator) {
      this.zoomIndicator.textContent = `${this.zoomLevel.toFixed(1)}x`;
    }

    Logger.info(`Minimap zoom level set to ${this.zoomLevel.toFixed(2)}x, range: ${this.range.toFixed(0)} units`);
  }

  /**
   * Zoom in the minimap
   */
  zoomIn() {
    this.setZoomLevel(this.zoomLevel * 1.2);
  }

  /**
   * Zoom out the minimap
   */
  zoomOut() {
    this.setZoomLevel(this.zoomLevel / 1.2);
  }

  /**
   * Reset zoom to default level
   */
  resetZoom() {
    this.setZoomLevel(1.0);
  }

  /**
   * Highlight mana nodes on the minimap (used by scan spell)
   * @param {Array} nodes - Array of mana node objects to highlight
   * @param {number} duration - Duration in seconds to highlight (default: 10)
   */
  highlightNodes(nodes, duration = 10) {
    if (!nodes || !Array.isArray(nodes)) return;

    // Clear previous highlights
    this.highlightedNodes.clear();

    // Add new nodes to highlight
    nodes.forEach(node => {
      if (node && node.position) {
        // Create a unique ID for this node based on position
        const nodeId = `${node.position.x.toFixed(1)}_${node.position.z.toFixed(1)}`;
        this.highlightedNodes.add(nodeId);
      }
    });

    // Set highlight duration
    this.highlightEndTime = Date.now() + (duration * 1000);

    Logger.info(`Highlighting ${this.highlightedNodes.size} mana nodes for ${duration} seconds`);

    // Auto-clear highlights after duration
    setTimeout(() => {
      this.highlightedNodes.clear();
      this.highlightEndTime = 0;
    }, duration * 1000);
  }

  /**
   * Clear all highlighted mana nodes
   */
  clearHighlights() {
    this.highlightedNodes.clear();
    this.highlightEndTime = 0;
    Logger.debug('Cleared all minimap highlights');
  }

  update(delta, elapsed) {
    // Update UI elements that need continuous updates
    
    // Update health display if local player exists
    const playerSystem = this.engine.systemManager.get('player');
    if (playerSystem && playerSystem.localPlayer) {
      const player = playerSystem.localPlayer;
      this.updateHealthDisplay(player.health, player.maxHealth);
    }
    
    // Update time display if atmosphere system exists
    this.updateTimeDisplay();
    
    // Update minimap if initialized and game is playing
    const currentState = useGameState.getState().currentState;
    if (this.minimapInitialized && currentState === GameStates.PLAYING) {
      this.lastUpdate += delta;
      if (this.lastUpdate >= this.updateInterval) {
        this.lastUpdate = 0;
        this._clear();
        this._drawTerrain();
        this._drawLandmarks();
        this._drawMana();
        this._drawPlayers();
        this._drawCompassRose();
      }
    }
    
    // Deprecated: updateMinimap() - minimap now handled internally
  }
  
  /**
   * Update time display showing current time of day
   */
  updateTimeDisplay() {
    // Logger.debug('updateTimeDisplay called');
    const atmosphereSystem = this.engine.systemManager.get('atmosphere');
    if (!atmosphereSystem) {
      Logger.warn('AtmosphereSystem not found for time display update');
      Logger.debug('Available systems:', Array.from(this.engine.systemManager.systems.keys()));
      return;
    }

    // Update current time display
    if (this.elements.timeDisplay) {
      const timeOfDay = atmosphereSystem.getTimeOfDay();
      const hours24 = Math.floor(timeOfDay * 24);
      const minutes = Math.floor((timeOfDay * 24 * 60) % 60);

      this.elements.timeDisplay.textContent =
        `${hours24.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

      // Logger.debug(`Time display updated: ${this.elements.timeDisplay.textContent} (timeOfDay: ${timeOfDay.toFixed(4)}, timeScale: ${atmosphereSystem.timeScale})`);
    } else {
      Logger.warn('timeDisplay element not found');
    }
  }
  
  /**
   * Create time control UI elements
   */
  createTimeControls() {
    // Create time controls for all devices (removed mobile restriction)
    // const isMobile = this.engine.input.isTouchDevice;

    // if (isMobile) {
    //   // Skip creating time controls for mobile
    //   Logger.info('Time controls disabled on mobile devices');
    //   return;
    // }
    
    // Create toggle button for time controls
    const toggleButton = document.createElement('div');
    toggleButton.id = 'time-controls-toggle-button';
    toggleButton.style.position = 'absolute';
    toggleButton.style.top = '70px';
    toggleButton.style.right = '20px';
    toggleButton.style.width = '40px';
    toggleButton.style.height = '40px';
    toggleButton.style.backgroundColor = 'rgba(45, 48, 52, 0.9)';
    toggleButton.style.borderRadius = '50%';
    toggleButton.style.display = 'none'; // Initially hidden, shown after game starts
    toggleButton.style.justifyContent = 'center';
    toggleButton.style.alignItems = 'center';
    toggleButton.style.cursor = 'pointer';
    toggleButton.style.zIndex = '1001';
    toggleButton.style.pointerEvents = 'auto';
    toggleButton.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.3)';
    toggleButton.style.pointerEvents = 'auto';
    toggleButton.textContent = '◔';
    toggleButton.style.fontSize = '18px';
    toggleButton.style.fontFamily = 'var(--vc-font)';
    toggleButton.style.color = 'var(--vc-ink)';
    toggleButton.style.background = 'var(--vc-panel)';
    toggleButton.style.border = '1px solid var(--vc-border)';
    toggleButton.title = 'Time of day';
    
    // Create container for time controls using modern UI style based on mockup
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = '120px'; // Positioned below the toggle button
    container.style.right = '20px';
    container.style.backgroundColor = 'rgba(45, 48, 52, 0.9)';
    container.style.padding = '15px';
    container.style.borderRadius = '10px';
    container.style.color = 'white';
    container.style.fontFamily = 'Arial, sans-serif';
    container.style.zIndex = '1000';
    container.style.pointerEvents = 'auto';
    container.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.3)';
    container.style.width = '240px';
    container.style.display = 'none'; // Initially hidden
    
    // Toggle visibility
    toggleButton.addEventListener('click', () => {
      if (container.style.display === 'none') {
        container.style.display = 'block';
        toggleButton.style.backgroundColor = 'rgba(65, 68, 72, 0.9)';
      } else {
        container.style.display = 'none';
        toggleButton.style.backgroundColor = 'rgba(45, 48, 52, 0.9)';
      }
    });
    
    // Time display
    const timeDisplay = document.createElement('div');
    timeDisplay.style.fontSize = '24px';
    timeDisplay.style.textAlign = 'center';
    timeDisplay.style.marginBottom = '15px';
    timeDisplay.textContent = '00:00';
    container.appendChild(timeDisplay);
    this.elements.timeDisplay = timeDisplay;
    
    // Create a section title for Presets
    const presetTitle = document.createElement('div');
    presetTitle.textContent = 'Presets';
    presetTitle.style.fontSize = '18px';
    presetTitle.style.textAlign = 'center';
    presetTitle.style.marginBottom = '10px';
    presetTitle.style.fontWeight = 'bold';
    container.appendChild(presetTitle);
    
    // Time presets — quiet text buttons on the glass tokens
    const presets = [
      { label: 'Night', hour: 0, minute: 0 },
      { label: 'Dawn', hour: 6, minute: 0 },
      { label: 'Noon', hour: 12, minute: 0 },
      { label: 'Dusk', hour: 18, minute: 0 }
    ];

    const presetContainer = document.createElement('div');
    presetContainer.style.display = 'grid';
    presetContainer.style.gridTemplateColumns = 'repeat(4, 1fr)';
    presetContainer.style.gap = '8px';
    presetContainer.style.marginBottom = '15px';

    presets.forEach(preset => {
      const button = document.createElement('button');
      button.className = 'vc-btn-ghost';
      button.textContent = preset.label;
      button.style.padding = '7px 6px';
      button.style.fontSize = '12px';

      // Click handler
      button.addEventListener('click', () => {
        const atmosphereSystem = this.engine.systemManager.get('atmosphere');
        if (atmosphereSystem) {
          atmosphereSystem.setTime(preset.hour, preset.minute);
        }
      });

      presetContainer.appendChild(button);
    });
    
    container.appendChild(presetContainer);
    
    // Time scale title
    const timeScaleTitle = document.createElement('div');
    timeScaleTitle.textContent = 'Time Scale';
    timeScaleTitle.style.fontSize = '18px';
    timeScaleTitle.style.textAlign = 'center';
    timeScaleTitle.style.marginBottom = '10px';
    timeScaleTitle.style.fontWeight = 'bold';
    container.appendChild(timeScaleTitle);
    
    // Time scale buttons with updated values
    const timeScaleContainer = document.createElement('div');
    timeScaleContainer.style.display = 'grid';
    timeScaleContainer.style.gridTemplateColumns = 'repeat(4, 1fr)';
    timeScaleContainer.style.gap = '8px';
    timeScaleContainer.style.marginBottom = '15px';
    
    // Updated scales according to mockup (replaced 720x with 120x)
    const scales = [
      { label: 'Real', value: 1 },
      { label: '2x', value: 2 },
      { label: '60x', value: 60 },
      { label: '120x', value: 120 }
    ];
    
    scales.forEach(scale => {
      const button = document.createElement('div');
      button.textContent = scale.label;
      button.style.backgroundColor = '#1c1e21';
      button.style.borderRadius = '8px';
      button.style.padding = '8px';
      button.style.textAlign = 'center';
      button.style.cursor = 'pointer';
      button.style.transition = 'all 0.2s';
      
      // Hover effect
      button.addEventListener('mouseover', () => {
        button.style.backgroundColor = '#2c2e31';
        button.style.transform = 'translateY(-2px)';
      });
      
      button.addEventListener('mouseout', () => {
        button.style.backgroundColor = '#1c1e21';
        button.style.transform = 'translateY(0)';
      });
      
      // Click handler
      button.addEventListener('click', () => {
        const atmosphereSystem = this.engine.systemManager.get('atmosphere');
        if (atmosphereSystem) {
          atmosphereSystem.timeScale = scale.value;
          Logger.info(`Time scale set to ${scale.value}x`);
        }
      });
      
      timeScaleContainer.appendChild(button);
    });
    
    container.appendChild(timeScaleContainer);
    
    // Custom time title
    const customTimeTitle = document.createElement('div');
    customTimeTitle.textContent = 'Custom Time';
    customTimeTitle.style.fontSize = '18px';
    customTimeTitle.style.textAlign = 'center';
    customTimeTitle.style.marginBottom = '10px';
    customTimeTitle.style.fontWeight = 'bold';
    container.appendChild(customTimeTitle);
    
    // Custom time slider
    const sliderContainer = document.createElement('div');
    sliderContainer.style.position = 'relative';
    sliderContainer.style.width = '100%';
    sliderContainer.style.height = '30px';
    sliderContainer.style.backgroundColor = '#1c1e21';
    sliderContainer.style.borderRadius = '15px';
    sliderContainer.style.marginBottom = '15px';
    
    const sliderTrack = document.createElement('div');
    sliderTrack.style.position = 'absolute';
    sliderTrack.style.top = '50%';
    sliderTrack.style.left = '10px';
    sliderTrack.style.right = '10px';
    sliderTrack.style.height = '4px';
    sliderTrack.style.transform = 'translateY(-50%)';
    sliderTrack.style.backgroundColor = '#3c3e41';
    sliderTrack.style.borderRadius = '2px';
    sliderContainer.appendChild(sliderTrack);
    
    const sliderThumb = document.createElement('div');
    sliderThumb.style.position = 'absolute';
    sliderThumb.style.top = '50%';
    sliderThumb.style.left = '10px';
    sliderThumb.style.width = '20px';
    sliderThumb.style.height = '20px';
    sliderThumb.style.transform = 'translate(0, -50%)';
    sliderThumb.style.backgroundColor = 'white';
    sliderThumb.style.borderRadius = '50%';
    sliderThumb.style.cursor = 'pointer';
    sliderThumb.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.3)';
    sliderContainer.appendChild(sliderThumb);
    
    // Make slider interactive
    let isDragging = false;
    const trackWidth = sliderTrack.clientWidth;
    
    sliderThumb.addEventListener('mousedown', (e) => {
      isDragging = true;
      e.preventDefault(); // Prevent text selection
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const rect = sliderTrack.getBoundingClientRect();
      const trackStart = rect.left + 10; // 10px padding
      const trackEnd = rect.right - 10; // 10px padding
      const trackLength = trackEnd - trackStart;
      
      let position = e.clientX - trackStart;
      position = Math.max(0, Math.min(position, trackLength));
      
      const percentage = position / trackLength;
      sliderThumb.style.left = `${percentage * 100}%`;
      
      // Calculate time based on position
      const hour = Math.floor(percentage * 24);
      const minute = Math.floor((percentage * 24 * 60) % 60);
      
      const atmosphereSystem = this.engine.systemManager.get('atmosphere');
      if (atmosphereSystem) {
        atmosphereSystem.setTime(hour, minute);
      }
    });
    
    container.appendChild(sliderContainer);
    
    // Add toggle for motion controls (only on mobile)
    if (this.engine.input.isTouchDevice) {
      const motionControlsTitle = document.createElement('div');
      motionControlsTitle.textContent = 'Motion Controls';
      motionControlsTitle.style.fontSize = '18px';
      motionControlsTitle.style.textAlign = 'center';
      motionControlsTitle.style.marginBottom = '10px';
      motionControlsTitle.style.marginTop = '15px';
      motionControlsTitle.style.fontWeight = 'bold';
      container.appendChild(motionControlsTitle);
      
      // Create toggle button for motion controls
      const toggleContainer = document.createElement('div');
      toggleContainer.style.display = 'flex';
      toggleContainer.style.justifyContent = 'center';
      toggleContainer.style.alignItems = 'center';
      toggleContainer.style.marginBottom = '15px';
      
      const toggleLabel = document.createElement('div');
      toggleLabel.textContent = 'Use device tilt for controls';
      toggleLabel.style.marginRight = '10px';
      toggleContainer.appendChild(toggleLabel);
      
      const toggleSwitch = document.createElement('div');
      toggleSwitch.style.width = '44px';
      toggleSwitch.style.height = '24px';
      toggleSwitch.style.backgroundColor = '#1c1e21';
      toggleSwitch.style.borderRadius = '12px';
      toggleSwitch.style.position = 'relative';
      toggleSwitch.style.cursor = 'pointer';
      
      const toggleIndicator = document.createElement('div');
      toggleIndicator.style.width = '18px';
      toggleIndicator.style.height = '18px';
      toggleIndicator.style.backgroundColor = 'white';
      toggleIndicator.style.borderRadius = '50%';
      toggleIndicator.style.position = 'absolute';
      toggleIndicator.style.top = '3px';
      toggleIndicator.style.left = '3px';
      toggleIndicator.style.transition = 'all 0.2s';
      toggleSwitch.appendChild(toggleIndicator);
      
      // Initialize state based on current settings
      let motionControlsEnabled = false;
      
      // Update toggle state
      const updateToggleState = (enabled) => {
        if (enabled) {
          toggleIndicator.style.left = '23px';
          toggleSwitch.style.backgroundColor = '#4285f4';
        } else {
          toggleIndicator.style.left = '3px';
          toggleSwitch.style.backgroundColor = '#1c1e21';
        }
      };
      
      // Handle toggle click
      toggleSwitch.addEventListener('click', () => {
        motionControlsEnabled = !motionControlsEnabled;
        updateToggleState(motionControlsEnabled);
        
        // Toggle motion controls in the player input system
        const playerInput = this.engine.systemManager.get('playerInput');
        if (playerInput && typeof playerInput.toggleMotionControls === 'function') {
          playerInput.toggleMotionControls(motionControlsEnabled);
        }
      });
      
      toggleContainer.appendChild(toggleSwitch);
      container.appendChild(toggleContainer);
    }
    
    // Close button
    const closeButton = document.createElement('div');
    closeButton.textContent = '✕';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '8px';
    closeButton.style.right = '12px';
    closeButton.style.fontSize = '14px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.opacity = '0.7';
    closeButton.addEventListener('mouseover', () => {
      closeButton.style.opacity = '1';
    });
    closeButton.addEventListener('mouseout', () => {
      closeButton.style.opacity = '0.7';
    });
    closeButton.addEventListener('click', () => {
      container.style.display = 'none';
      toggleButton.style.backgroundColor = 'rgba(45, 48, 52, 0.9)';
    });
    container.appendChild(closeButton);
    
    // Add to document
    this.container.appendChild(toggleButton);
    this.container.appendChild(container);
    
    // Show current time in toggle button
    // Continuously update the time in the toggle button tooltip
    toggleButton.title = "Time Controls";
    
    // Save reference to toggle button for showing it later
    this.elements.timeToggleButton = toggleButton;
  }
  
  /**
   * Show game UI elements when entering PLAYING state
   */
  showGameUI() {
    // Show time controls only on desktop
    if (!this.engine.input.isTouchDevice && this.elements.timeToggleButton) {
      this.elements.timeToggleButton.style.display = 'flex';
    }
    
    // Show other gameplay UI elements as needed
  }
  
  /**
   * Show pause menu when entering PAUSED state
   */
  showPauseMenu() {
    // TODO: Implement pause menu UI
    Logger.debug('Pause menu would show here');
  }

  showQuestLog() {
    // Toggleable quest tracker panel — non-blocking (no dialogs, no pointer
    // capture), refreshes at 1 Hz while open.
    const questManager = this.engine.systemManager.get('questManager');
    if (!questManager) {
      Logger.warn('No quest manager found');
      return;
    }

    if (this.elements.questPanel && this.elements.questPanel.style.display !== 'none') {
      this.elements.questPanel.style.display = 'none';
      clearInterval(this._questPanelTimer);
      return;
    }

    if (!this.elements.questPanel) {
      const panel = document.createElement('div');
      panel.style.position = 'fixed';
      panel.style.top = '170px';
      panel.style.left = '12px';
      panel.style.minWidth = '210px';
      panel.style.maxWidth = '260px';
      panel.style.background = 'rgba(15, 22, 40, 0.72)';
      panel.style.borderRadius = '10px';
      panel.style.padding = '10px 12px';
      panel.style.color = '#fff';
      panel.style.fontFamily = 'var(--app-font, sans-serif)';
      panel.style.fontSize = '13px';
      panel.style.pointerEvents = 'none';
      panel.style.zIndex = '1000';
      document.body.appendChild(panel);
      this.elements.questPanel = panel;
    }

    const panel = this.elements.questPanel;
    const render = () => {
      const quests = questManager.getActiveQuests();
      panel.innerHTML = '';
      const title = document.createElement('div');
      title.textContent = 'Quests — Q to close';
      title.style.opacity = '0.65';
      title.style.marginBottom = '6px';
      title.style.fontSize = '11px';
      title.style.letterSpacing = '0.08em';
      title.style.textTransform = 'uppercase';
      panel.appendChild(title);
      quests.forEach(q => {
        const done = q.status === 'completed';
        const obj = q.objectives && q.objectives[0];
        const row = document.createElement('div');
        row.style.marginBottom = '7px';
        const label = document.createElement('div');
        label.textContent = (done ? '✓ ' : '') + q.name;
        label.style.opacity = done ? '0.55' : '1';
        row.appendChild(label);
        if (!done && obj && obj.target > 1) {
          const barWrap = document.createElement('div');
          barWrap.style.height = '4px';
          barWrap.style.borderRadius = '2px';
          barWrap.style.background = 'rgba(255,255,255,0.15)';
          barWrap.style.marginTop = '3px';
          const bar = document.createElement('div');
          bar.style.height = '100%';
          bar.style.borderRadius = '2px';
          bar.style.width = Math.min(100, (obj.current / obj.target) * 100) + '%';
          bar.style.background = '#66ffee';
          barWrap.appendChild(bar);
          row.appendChild(barWrap);
        }
        panel.appendChild(row);
      });
    };
    render();
    panel.style.display = 'block';
    clearInterval(this._questPanelTimer);
    this._questPanelTimer = setInterval(render, 1000);
  }

  /**
   * Clean up resources when component is destroyed
   */
  destroy() {
    window.removeEventListener('keydown', this._questKeyHandler);
    clearInterval(this._questPanelTimer);
    if (this.elements.toastStack) this.elements.toastStack.remove();
    if (this.elements.questPanel) this.elements.questPanel.remove();
    // Clean up state subscription
    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }

    // Clean up minimap container
    if (this.minimapContainer) {
      this.minimapContainer.remove();
      this.minimapContainer = null;
    }

    // Clean up canvas context references
    this.canvas = null;
    this.context = null;
  }
  
  /**
   * Show time controls after game starts (kept for backwards compatibility)
   */
  showTimeControls() {
    if (!this.engine.input.isTouchDevice && this.elements.timeToggleButton) {
      this.elements.timeToggleButton.style.display = 'flex';
    }
  }

}