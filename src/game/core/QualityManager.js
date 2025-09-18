import { Logger } from '../../utils/Logger.js';

export class QualityManager {
  constructor(engine) {
    this.engine = engine;
    this.targetFPS = 60;
    this.currentFPS = 60;
    this.sampleSize = 20;
    this.fpsHistory = [];
    this.resolutionScale = 1.0;
    this.highQualityMode = false;
    this.batterySaving = false;
    this.performanceMonitor = engine.performanceMonitor;
    this.rendererManager = null; // Set after rendererManager is created
  }

  update(delta) {
    if (delta <= 0) return;

    // Calculate FPS and update history
    const fps = 1000 / (delta * 1000);
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > this.sampleSize) {
      this.fpsHistory.shift();
    }

    // Calculate average FPS
    this.currentFPS = this.fpsHistory.reduce((sum, f) => sum + f, 0) / this.fpsHistory.length;

    // Dynamic resolution scaling based on FPS
    if (this.currentFPS < this.targetFPS * 0.9) {
      this.resolutionScale = Math.max(0.5, this.resolutionScale * 0.95);
    } else if (this.currentFPS > this.targetFPS * 1.1) {
      this.resolutionScale = Math.min(1.0, this.resolutionScale * 1.05);
    }

    // Apply resolution scale to renderer if available
    if (this.rendererManager && this.rendererManager.renderer) {
      const basePixelRatio = Math.min(window.devicePixelRatio, this.batterySaving ? 1.0 : 2.0);
      this.rendererManager.renderer.setPixelRatio(basePixelRatio * this.resolutionScale);
    }
  }

  setBatterySavingMode(enabled) {
    this.batterySaving = enabled;
    this.targetFPS = enabled ? 30 : 60;
    if (enabled) {
      this.resolutionScale = 0.8;
    } else {
      this.resolutionScale = 1.0;
    }
    // Re-apply to renderer
    if (this.rendererManager && this.rendererManager.renderer) {
      const basePixelRatio = Math.min(window.devicePixelRatio, enabled ? 1.0 : 2.0);
      this.rendererManager.renderer.setPixelRatio(basePixelRatio * this.resolutionScale);
    }
    Logger.info(`Battery saving mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  toggleHighQualityMode() {
    this.highQualityMode = !this.highQualityMode;
    this.targetFPS = this.highQualityMode ? 120 : 60;
    this.resolutionScale = this.highQualityMode ? 1.0 : this.resolutionScale;
    // Re-apply to renderer
    if (this.rendererManager && this.rendererManager.renderer) {
      const basePixelRatio = Math.min(window.devicePixelRatio, 2.0);
      this.rendererManager.renderer.setPixelRatio(basePixelRatio * this.resolutionScale);
    }
    Logger.info(`High quality mode ${this.highQualityMode ? 'enabled' : 'disabled'}`);
  }

  updateFromPerformance(report) {
    // Integrate with PerformanceMonitor report for further adjustments
    if (report && report.fps && report.fps < this.targetFPS * 0.8) {
      // Aggressive scaling for critical performance
      this.resolutionScale = Math.max(0.5, this.resolutionScale * 0.9);
      return true;
    }
    return false;
  }

  handleVisibilityChange(visible) {
    // Pause FPS tracking when not visible
    if (!visible) {
      this.fpsHistory = [];
    }
  }

  destroy() {
    this.fpsHistory = [];
  }
}