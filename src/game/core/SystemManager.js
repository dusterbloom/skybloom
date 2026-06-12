import { Logger } from '../../utils/Logger';

export class SystemManager {
  constructor(engine) {
    this.engine = engine;
    this.systems = new Map();
    this.updateOrder = [];
  }

  register(system) {
      //       // Logger.debug('Attempting to register system:', system.constructor.name, 'has name property:', !!system.name, 'properties:', Object.keys(system));
      if (!system.name) {
        throw new Error(`System must have a name property: ${system.constructor.name}`);
      }
      this.systems.set(system.name, system);
      // Much of the codebase reads systems as properties (engine.systems.playerState,
      // engine.systems.ui, ...) while engine.systems is the raw Map — those reads were
      // silently undefined. Mirror each registered system as a getter on both the
      // manager and the Map so every access pattern resolves.
      for (const target of [this, this.systems]) {
        if (!(system.name in target)) {
          Object.defineProperty(target, system.name, {
            get: () => this.systems.get(system.name),
            configurable: true,
          });
        }
      }
      return this;
    }

  get(name) {
    return this.systems.get(name);
  }

  setUpdateOrder(orderArray) {
    this.updateOrder = orderArray;
    return this;
  }

  async initialize() {
    for (const systemName of this.updateOrder) {
      const system = this.get(systemName);
      if (system) {
        await system.initialize();
        //         // Logger.info(`System initialized: ${systemName}`);
      }
    }
  }

  update(delta, elapsed) {
    // Logger.debug(`SystemManager.update: Starting update cycle with delta=${delta}, elapsed=${elapsed}, systems: ${this.updateOrder.join(', ')}`);
    for (let i = 0; i < this.updateOrder.length; i++) {
      const systemName = this.updateOrder[i];
      const system = this.get(systemName);
      // Logger.debug(`SystemManager.update: Updating system ${i+1}/${this.updateOrder.length}: ${systemName}, exists: ${!!system}`);
      if (system && typeof system.update === 'function') {
        try {
          // Logger.debug(`SystemManager.update: Calling ${systemName}.update(${delta}, ${elapsed})`);
          system.update(delta, elapsed);
          // Logger.debug(`SystemManager.update: ${systemName} updated successfully`);
        } catch (error) {
          Logger.error(`SystemManager.update: Error updating ${systemName}:`, error);
          throw error;
        }
      } else if (!system) {
        Logger.warn(`SystemManager.update: System ${systemName} not found`);
      } else {
        Logger.warn(`SystemManager.update: System ${systemName} has no update method`);
      }
    }
    //     // Logger.debug('SystemManager.update: Finished update cycle');
  }

  handleVisibilityChange(visible) {
    for (const system of this.systems.values()) {
      if (typeof system.handleVisibilityChange === 'function') {
        system.handleVisibilityChange(visible);
      }
    }
  }

  destroy() {
    for (const system of this.systems.values()) {
      if (typeof system.destroy === 'function') {
        system.destroy();
      }
    }
    this.systems.clear();
    this.updateOrder = [];
  }
}