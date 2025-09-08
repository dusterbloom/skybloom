export class SystemManager {
  constructor(engine) {
    this.engine = engine;
    this.systems = new Map();
    this.updateOrder = [];
  }

  register(system) {
      console.log('Attempting to register system:', system.constructor.name, 'has name property:', !!system.name, 'properties:', Object.keys(system));
      if (!system.name) {
        throw new Error(`System must have a name property: ${system.constructor.name}`);
      }
      this.systems.set(system.name, system);
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
        console.log(`System initialized: ${systemName}`);
      }
    }
  }

  update(delta, elapsed) {
    console.log('SystemManager.update: Starting update cycle at', Date.now(), 'with delta', delta, 'systems:', this.updateOrder);
    for (let i = 0; i < this.updateOrder.length; i++) {
      const systemName = this.updateOrder[i];
      const system = this.get(systemName);
      console.log(`SystemManager.update: Updating system ${i+1}/${this.updateOrder.length}:`, systemName, 'system exists:', !!system);
      if (system && typeof system.update === 'function') {
        try {
          system.update(delta, elapsed);
        } catch (error) {
          console.error(`Error updating system '${systemName}':`, error);
        }
      }
    }
    console.log('SystemManager.update: Finished update cycle');
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