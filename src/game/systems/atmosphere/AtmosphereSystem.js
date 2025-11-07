import * as THREE from "three";
import { System } from '../../../game/core/System.js';
import { Logger } from '../../../utils/Logger.js';
import { SkySystem } from "./SkySystem";
import { SunSystem } from "../SunSystem";

import { MoonSystem } from "./MoonSystem";
import { StarSystem } from "./StarSystem";
import { CloudSystem } from "./CloudSystem";

/**
 * AtmosphereSystem - Manages all atmospheric elements in the scene
 * This includes sky, sun, moon, stars, and clouds, as well as the day/night cycle
 */
export class AtmosphereSystem extends System {
  /**
   * Create a new AtmosphereSystem
   * @param {Engine} engine - The game engine instance
   */
  constructor(engine) {
    super(engine, 'atmosphere');
    this.engine = engine;
    this.scene = engine.scene;
    
    // Time tracking
    this.elapsed = 0;
    this.dayDuration = 86400;   // 86400 seconds = 24 hours (matches delta time units)
    this.timeScale = 1.0;    // Default to real-time (1 second real = 1 second game)
    
    // Calendar tracking
    this.currentDay = 0;
    this.daysPerMonth = 30;
    this.currentMonth = 0;
    this.monthsPerYear = 12;
    this.yearProgress = 0; // 0.0-1.0 for seasonal changes
    this.moonPhase = 1; // 0.0-1.0 (0 = new moon, 0.5 = full moon, 1.0 = new moon)
    
    // Initialize time of day from system clock
    const now = new Date();
    const secondsInDay = 86400;
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    // this.timeOfDay = currentSeconds / secondsInDay; // 0.0-1.0 representing full day
    
    // Optional override for testing specific times
    this.timeOfDay = 0.5; // Noon
    // this.timeOfDay = 0.0; // Midnight
    // this.timeOfDay = 0.25; // Sunrise
    // this.timeOfDay = 0.65;  // Sunset
    
    Logger.info("Synced Time of Day:", this.timeOfDay);
    
    // System components (initialized in initialize())
    this.skySystem = null;
    this.sunSystem = null;
    this.moonSystem = null;
    this.starSystem = null;
    this.cloudSystem = null;
  }
  
  /**
   * Initialize the atmosphere system and all subsystems
   */
  async _initialize() {
    Logger.info("Initializing AtmosphereSystem...");

    try {
      // Create subsystems
      Logger.debug("Creating SkySystem...");
      this.skySystem = new SkySystem(this);

      Logger.debug("Creating SunSystem...");
      this.sunSystem = new SunSystem(this);

      Logger.debug("Creating MoonSystem...");
      this.moonSystem = new MoonSystem(this);

      Logger.debug("Creating StarSystem...");
      this.starSystem = new StarSystem(this);
      this.cloudSystem = new CloudSystem(this);

      Logger.debug("Initializing subsystems...");
      // Initialize subsystems
      await Promise.all([
        this.skySystem.initialize(),
        this.sunSystem.initialize(),
        this.moonSystem.initialize(),
        this.starSystem.initialize(),
        this.cloudSystem.initialize()
      ]);

      Logger.info("AtmosphereSystem initialized successfully");
      Logger.debug(`Subsystems created: sun=${!!this.sunSystem}, sky=${!!this.skySystem}, moon=${!!this.moonSystem}, star=${!!this.starSystem}`);
    } catch (error) {
      Logger.error("AtmosphereSystem initialization failed:", error);
      throw error;
    }
  }
  
  /**
   * Update calendar and time tracking
   * @param {number} delta - Time delta in minutes
   */
  updateCalendar(delta) {
    // Update day tracking
    const previousDay = this.currentDay;
    
    // Advance days
    const dayProgress = delta / this.dayDuration;
    this.currentDay += dayProgress;
    
    // Handle month transitions
    if (this.currentDay >= this.daysPerMonth) {
      this.currentDay -= this.daysPerMonth;
      this.currentMonth++;
      
      // Handle year transitions
      if (this.currentMonth >= this.monthsPerYear) {
        this.currentMonth = 0;
      }
    }
    
    // Update year progress (for seasonal changes - future feature)
    this.yearProgress = (this.currentMonth + (this.currentDay / this.daysPerMonth)) / this.monthsPerYear;
    
    // Update moon phase (complete cycle over a month)
    this.moonPhase = (this.currentDay / this.daysPerMonth);
  }
  
  /**
   * Set the time of day manually
   * @param {number} hour - Hour (0-23)
   * @param {number} minute - Minute (0-59)
   */
  setTime(hour, minute) {
    // Convert to time of day (0.0-1.0)
    this.timeOfDay = (hour + (minute / 60)) / 24;
    Logger.info(`Time set to ${hour}:${minute.toString().padStart(2, '0')} (${this.timeOfDay.toFixed(4)})`); 
  }
  
  /**
   * Update the atmospheric systems
   * @param {number} delta - Time delta in minutes
   * @param {number} elapsed - Total elapsed time
   */
  update(delta, elapsed) {
    try {
      // Check for zero delta
      if (delta === 0) {
        return;
      }

      // Update elapsed time
      this.elapsed = elapsed;

      // Apply time scale to delta for time acceleration/deceleration
      const scaledDelta = delta * this.timeScale;

      // Update time of day (0.0-1.0)
      const previousTimeOfDay = this.timeOfDay;
      this.timeOfDay += scaledDelta / this.dayDuration;

      // Logger.debug(`AtmosphereSystem: timeOfDay changed from ${previousTimeOfDay.toFixed(4)} to ${this.timeOfDay.toFixed(4)}, timeScale=${this.timeScale}, delta=${delta.toFixed(4)}, scaledDelta=${scaledDelta.toFixed(4)}`);

      // Detect day transitions
      if (this.timeOfDay >= 1.0) {
        this.timeOfDay -= 1.0;
        // When we have a day transition, update the calendar
        this.updateCalendar(delta);
      }

      // Check subsystem status
      // Logger.debug(`AtmosphereSystem subsystems: sun=${!!this.sunSystem}, sky=${!!this.skySystem}, moon=${!!this.moonSystem}, star=${!!this.starSystem}`);

      // Update all subsystems - ensure SunSystem updates before systems that might use it
      if (this.sunSystem && typeof this.sunSystem.update === 'function') {
        // Logger.debug('Updating SunSystem...');
        this.sunSystem.update(delta, elapsed);
        // Logger.debug('SunSystem updated successfully');
      } else if (this.sunSystem) {
        Logger.error('SunSystem exists but has no update method!');
      } else {
        Logger.error('SunSystem is null!');
      }

      if (this.skySystem && typeof this.skySystem.update === 'function') {
        // Logger.debug('Updating SkySystem...');
        this.skySystem.update(delta, elapsed);
        // Logger.debug('SkySystem updated successfully');
      } else if (this.skySystem) {
        Logger.error('SkySystem exists but has no update method!');
      } else {
        Logger.error('SkySystem is null!');
      }

      if (this.moonSystem && typeof this.moonSystem.update === 'function') {
        // Logger.debug('Updating MoonSystem...');
        this.moonSystem.update(delta, elapsed);
        // Logger.debug('MoonSystem updated successfully');
      } else if (this.moonSystem) {
        Logger.error('MoonSystem exists but has no update method!');
      } else {
        Logger.error('MoonSystem is null!');
      }

      if (this.starSystem && typeof this.starSystem.update === 'function') {
        // Logger.debug('Updating StarSystem...');
        this.starSystem.update(delta, elapsed);
        // Logger.debug('StarSystem updated successfully');
      } else if (this.starSystem) {
        Logger.error('StarSystem exists but has no update method!');
      } else {
        Logger.error('StarSystem is null!');
      }

      if (this.cloudSystem && typeof this.cloudSystem.update === 'function') {
        this.cloudSystem.update(delta, elapsed);
      }
    } catch (error) {
      Logger.error('AtmosphereSystem._update failed:', error);
      throw error; // Re-throw to see in console
    }
  }
  
  /**
   * Get the current time of day (0.0-1.0)
   * @returns {number} Time of day, where:
   *   0.0 = Midnight
   *   0.25 = Sunrise
   *   0.5 = Noon
   *   0.75 = Sunset
   */
  getTimeOfDay() {
    return this.timeOfDay;
  }
  
  /**
   * Calculate how much of night time we're in
   * @returns {number} Night factor (0.0-1.0), where:
   *   0.0 = Daytime
   *   1.0 = Middle of night
   */
  getNightFactor() {
    // Night is roughly between 0.75-0.25 timeOfDay (sunset to sunrise)
    if (this.timeOfDay > 0.75 || this.timeOfDay < 0.25) {
      // Calculate how deep into night we are
      if (this.timeOfDay > 0.75) {
        // After sunset, approaching midnight
        return (this.timeOfDay - 0.75) / 0.25;
      } else {
        // After midnight, approaching sunrise
        return 1.0 - this.timeOfDay / 0.25;
      }
    }
    return 0; // Daytime
  }
  
  /**
   * Get the position of the sun
   * @returns {THREE.Vector3} Sun position
   */
  getSunPosition() {
    return this.sunSystem ? this.sunSystem.getSunPosition() : new THREE.Vector3();
  }
  
  /**
   * Get the position of the moon
   * @returns {THREE.Vector3} Moon position
   */
  getMoonPosition() {
    return this.moonSystem ? this.moonSystem.getMoonPosition() : new THREE.Vector3();
  }
  
  /**
   * Get the current moon phase (0.0-1.0)
   * 0.0 = New Moon (not visible)
   * 0.25 = Waxing Half Moon
   * 0.5 = Full Moon
   * 0.75 = Waning Half Moon
   * @returns {number} Moon phase value
   */
  getMoonPhase() {
    return this.moonPhase;
  }

  /**
   * Get the illuminated portion of the moon (0.0-1.0)
   * @returns {number} Illumination factor
   */
  getMoonIllumination() {
    // Simplified model: illumination follows a sine wave
    // Full illumination at full moon (0.5 phase)
    // No illumination at new moon (0.0 or 1.0 phase)
    return Math.sin(this.moonPhase * Math.PI);
  }
}
