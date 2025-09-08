export class System {
  constructor(engine, name) {
    this.engine = engine;
    this.name = name;
    this.initialized = false;
    this.dependencies = [];
  }

  requireDependencies(dependencies) {
    this.dependencies = dependencies || [];
    return this;
  }

  async initialize() {
    try {
      // Check dependencies
      for (const depName of this.dependencies) {
        const depSystem = this.engine.systems.get(depName);
        if (!depSystem) {
          throw new Error(`Dependency '${depName}' not found for system '${this.name}'`);
        }
        if (!depSystem.initialized) {
          throw new Error(`Dependency '${depName}' not initialized for system '${this.name}'`);
        }
      }

      // Call abstract init
      await this._initialize();
      this.initialized = true;
    } catch (error) {
      console.error(`Failed to initialize system '${this.name}':`, error);
      this.initialized = false;
      // Optionally emit event or handle further
      throw error; // Re-throw to allow engine handling
    }
  }

  update(delta, elapsed) {
    try {
      this._update(delta, elapsed);
    } catch (error) {
      console.error(`Error updating system '${this.name}':`, error);
      // Continue without stopping other systems
    }
  }

  // Abstract methods
  async _initialize() {
    // Subclasses implement this
  }

  _update(delta, elapsed) {
    // Subclasses implement this
  }

  handleVisibilityChange(visible) {
    // Subclasses can override
  }

  destroy() {
    // Subclasses can override for cleanup
    this.initialized = false;
  }
}