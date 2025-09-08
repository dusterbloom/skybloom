import * as THREE from "three";
import { System } from '../core/System';

export class MinimapSystem extends System {
  constructor(engine) {
    super(engine, 'minimap');
    this.canvas = null;
    this.context = null;
    this.size = 150;             // Size in pixels
    this.range = 20000;           // Much wider view to show terrain variety
    this.minimapContainer = null;
    this.lastUpdate = 0;         // For throttling updates
    this.updateInterval = 1/60;  // Update at 60fps max
    this.enabled = true;         // Default enabled
    
    // Visual settings
    this.colors = {
      water: 'rgba(0, 100, 200, 0.8)',
      mountain: 'rgba(100, 100, 100, 0.8)',
      forest: 'rgba(0, 100, 0, 0.8)',
      desert: 'rgba(200, 180, 120, 0.8)',
      plains: 'rgba(0, 170, 0, 0.8)',
      snow: 'rgba(240, 240, 250, 0.8)',
      landmark: {
        ancient_ruins: 'rgba(200, 180, 100, 0.9)',
        magical_circle: 'rgba(180, 50, 180, 0.9)',
        crystal_formation: 'rgba(100, 220, 220, 0.9)',
        default: 'rgba(255, 255, 255, 0.8)'
      },
      mana: 'rgba(50, 150, 255, 0.8)',
      player: 'rgba(255, 255, 255, 1)',
      otherPlayer: 'rgba(255, 100, 100, 1)',
      background: 'rgba(0, 0, 20, 0.5)',
      border: 'rgba(255, 255, 255, 0.5)',
      direction: 'white',
      playerNames: true // Show player names on minimap
    };
  }

  async initialize() {
    console.log("MinimapSystem disabled - using UISystem for minimap rendering");
    this.enabled = false;
    this.initialized = true;
  }
  
  createContainer() {
    // Disabled - no container creation
  }
  
  /**
   * Convert world coordinates to minimap coordinates
   * @param {number} x - World X coordinate
   * @param {number} z - World Z coordinate
   * @returns {Object} - Minimap coordinates {x, z}
   */
  worldToMap(x, z) {
    // Disabled
    return { x: 0, z: 0 };
  }
  
  /**
   * Clear the minimap canvas
   */
  clear() {
    // Disabled
  }
  
  /**
   * Draw terrain on the minimap
   */
  drawTerrain() {
    // Disabled - using UISystem
  }
  
  /**
   * Draw landmarks on the minimap
   */
  drawLandmarks() {
    // Disabled - using UISystem
  }
  
  /**
   * Draw mana orbs on the minimap
   */
  drawMana() {
    // Disabled - using UISystem
  }
  
  /**
   * Draw players on the minimap
   */
  drawPlayers() {
    // Disabled - using UISystem
  }
  
  /**
   * Draw indicator for players outside of minimap range
   */
  drawPlayerOffMap(player, localPlayer) {
    // Disabled
  }
  
  /**
   * Draw compass rose on the minimap
   */
  drawCompassRose() {
    // Disabled - using UISystem
  }
  
  enable() {
    // Disabled - using UISystem
  }

  disable() {
    // Disabled - using UISystem
  }

  /**
   * Update the minimap display
   */
  update(delta, elapsed) {
    // Disabled - using UISystem
  }
}
