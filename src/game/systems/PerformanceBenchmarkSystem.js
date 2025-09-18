import * as THREE from "three";
import { System } from "../core/System.js";
import { Logger } from "../../utils/Logger.js";

/**
 * Performance Benchmarking System
 * Compares old CSS water vs new 3D water performance
 */
export class PerformanceBenchmarkSystem extends System {
  constructor(engine) {
    super(engine, 'performanceBenchmark');
    this.scene = engine.scene;
    this.camera = engine.camera;

    // Benchmark data
    this.benchmarks = {
      cssWater: { fps: [], memory: [], frameTime: [] },
      threeDWater: { fps: [], memory: [], frameTime: [] }
    };

    // Current benchmark state
    this.isBenchmarking = false;
    this.currentMode = 'threeDWater'; // 'cssWater' or 'threeDWater'
    this.benchmarkDuration = 10000; // 10 seconds
    this.benchmarkStartTime = 0;

    // Performance metrics
    this.frameCount = 0;
    this.lastTime = 0;
    this.fps = 0;
    this.frameTime = 0;

    // Memory tracking
    this.memoryUsage = 0;

    // Results
    this.results = null;
  }

  async _initialize() {
    Logger.info("📊 Initializing Performance Benchmark System...");

    // Add benchmark controls to window
    this.setupBenchmarkControls();

    Logger.info("📊 Performance Benchmark System initialized ✅");
  }

  setupBenchmarkControls() {
    // Add global benchmark functions
    window.startBenchmark = () => this.startBenchmark();
    window.stopBenchmark = () => this.stopBenchmark();
    window.getBenchmarkResults = () => this.getBenchmarkResults();
    window.switchWaterMode = (mode) => this.switchWaterMode(mode);

    Logger.debug("Benchmark controls added to window:");
    Logger.debug("- startBenchmark(): Start performance benchmark");
    Logger.debug("- stopBenchmark(): Stop current benchmark");
    Logger.debug("- getBenchmarkResults(): Get benchmark results");
    Logger.debug("- switchWaterMode('cssWater'|'threeDWater'): Switch water rendering mode");
  }

  startBenchmark() {
    if (this.isBenchmarking) {
      Logger.warn("Benchmark already running");
      return;
    }

    Logger.info("Starting performance benchmark...");
    this.isBenchmarking = true;
    this.benchmarkStartTime = performance.now();
    this.frameCount = 0;
    this.lastTime = this.benchmarkStartTime;

    // Reset benchmark data
    this.resetBenchmarkData();

    // Start monitoring
    this.startPerformanceMonitoring();
  }

  stopBenchmark() {
    if (!this.isBenchmarking) {
      Logger.warn("No benchmark running");
      return;
    }

    Logger.info("Stopping performance benchmark...");
    this.isBenchmarking = false;

    // Calculate results
    this.calculateResults();

    // Log results
    this.logResults();
  }

  resetBenchmarkData() {
    this.benchmarks.cssWater = { fps: [], memory: [], frameTime: [] };
    this.benchmarks.threeDWater = { fps: [], memory: [], frameTime: [] };
  }

  startPerformanceMonitoring() {
    // Monitor performance every frame
    this.monitorPerformance();
  }

  monitorPerformance() {
    if (!this.isBenchmarking) return;

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTime;

    if (deltaTime >= 1000) { // Update every second
      this.fps = Math.round((this.frameCount * 1000) / deltaTime);
      this.frameTime = deltaTime / this.frameCount;

      // Track memory usage
      if (performance.memory) {
        this.memoryUsage = performance.memory.usedJSHeapSize / 1024 / 1024; // MB
      }

      // Store data
      const data = this.benchmarks[this.currentMode];
      data.fps.push(this.fps);
      data.frameTime.push(this.frameTime);
      if (this.memoryUsage > 0) {
        data.memory.push(this.memoryUsage);
      }

      // Reset counters
      this.frameCount = 0;
      this.lastTime = currentTime;

      Logger.debug(`Benchmark [${this.currentMode}]: FPS=${this.fps}, FrameTime=${this.frameTime.toFixed(2)}ms, Memory=${this.memoryUsage.toFixed(1)}MB`);
    }

    this.frameCount++;

    // Check if benchmark duration is reached
    if (currentTime - this.benchmarkStartTime >= this.benchmarkDuration) {
      this.stopBenchmark();
      return;
    }

    // Continue monitoring
    requestAnimationFrame(() => this.monitorPerformance());
  }

  switchWaterMode(mode) {
    if (mode !== 'cssWater' && mode !== 'threeDWater') {
      Logger.error("Invalid water mode. Use 'cssWater' or 'threeDWater'");
      return;
    }

    Logger.info(`Switching to ${mode} water rendering...`);
    this.currentMode = mode;

    // Here you would actually switch between CSS and 3D water systems
    // For now, just log the mode change
    const waterSystem = this.engine.systemManager.get('water');
    if (waterSystem) {
      Logger.info(`Water system mode switched to: ${mode}`);
      // In a real implementation, you'd toggle between CSS and 3D water here
    }
  }

  calculateResults() {
    this.results = {};

    for (const [mode, data] of Object.entries(this.benchmarks)) {
      if (data.fps.length === 0) continue;

      this.results[mode] = {
        averageFps: this.average(data.fps),
        minFps: Math.min(...data.fps),
        maxFps: Math.max(...data.fps),
        averageFrameTime: this.average(data.frameTime),
        averageMemory: data.memory.length > 0 ? this.average(data.memory) : 0,
        sampleCount: data.fps.length
      };
    }
  }

  average(array) {
    return array.reduce((a, b) => a + b, 0) / array.length;
  }

  logResults() {
    if (!this.results) {
      Logger.warn("No benchmark results available");
      return;
    }

    Logger.info("=== PERFORMANCE BENCHMARK RESULTS ===");

    for (const [mode, result] of Object.entries(this.results)) {
      Logger.info(`${mode.toUpperCase()} WATER:`);
      Logger.info(`  Average FPS: ${result.averageFps.toFixed(1)}`);
      Logger.info(`  FPS Range: ${result.minFps} - ${result.maxFps}`);
      Logger.info(`  Average Frame Time: ${result.averageFrameTime.toFixed(2)}ms`);
      Logger.info(`  Average Memory: ${result.averageMemory.toFixed(1)}MB`);
      Logger.info(`  Samples: ${result.sampleCount}`);
      Logger.info("");
    }

    // Compare results
    if (this.results.cssWater && this.results.threeDWater) {
      const cssFps = this.results.cssWater.averageFps;
      const threeDFps = this.results.threeDWater.averageFps;
      const fpsDifference = threeDFps - cssFps;
      const fpsPercent = (fpsDifference / cssFps) * 100;

      Logger.info("COMPARISON:");
      Logger.info(`  FPS Difference: ${fpsDifference > 0 ? '+' : ''}${fpsDifference.toFixed(1)} (${fpsPercent > 0 ? '+' : ''}${fpsPercent.toFixed(1)}%)`);
      Logger.info(`  Winner: ${fpsDifference > 0 ? '3D Water' : fpsDifference < 0 ? 'CSS Water' : 'Tie'}`);
    }

    Logger.info("===================================");
  }

  getBenchmarkResults() {
    return {
      isRunning: this.isBenchmarking,
      currentMode: this.currentMode,
      results: this.results,
      currentMetrics: {
        fps: this.fps,
        frameTime: this.frameTime,
        memoryUsage: this.memoryUsage
      }
    };
  }

  _update(deltaTime) {
    // Update is handled by the performance monitoring when benchmarking
  }

  dispose() {
    Logger.info("Disposing Performance Benchmark System...");

    // Clean up any resources
    this.stopBenchmark();

    Logger.info("Performance Benchmark System disposed");
  }
}