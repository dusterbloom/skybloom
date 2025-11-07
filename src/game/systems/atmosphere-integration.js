/**
 * This file serves as an adapter to smoothly transition from the old
 * AtmosphereSystem to the new modular implementation
 */

// Import the new AtmosphereSystem from the new modular architecture
import { AtmosphereSystem as NewAtmosphereSystem } from "./atmosphere/AtmosphereSystem.js";
import { System } from "../core/System.js";

// Export the new system as a replacement for the old one
export class AtmosphereSystem extends System {
  constructor(engine) {
    super(engine, 'atmosphere');
    this._newSystem = new NewAtmosphereSystem(engine);
  }

  async _initialize() {
    await this._newSystem.initialize();
  }

  _update(delta, elapsed) {
    this._newSystem._update(delta, elapsed);
  }

  // Forward other methods to the new system
  getTimeOfDay() {
    return this._newSystem.getTimeOfDay();
  }

  getNightFactor() {
    return this._newSystem.getNightFactor();
  }

  getSunPosition() {
    return this._newSystem.getSunPosition();
  }

  getMoonPosition() {
    return this._newSystem.getMoonPosition();
  }

  getMoonPhase() {
    return this._newSystem.getMoonPhase();
  }

  getMoonIllumination() {
    return this._newSystem.getMoonIllumination();
  }

  setTime(hour, minute) {
    this._newSystem.setTime(hour, minute);
  }

  // The constructor and all methods are inherited directly
  // This adapter pattern allows us to swap implementations without changing imports elsewhere
}
