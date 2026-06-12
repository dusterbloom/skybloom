import { Engine } from './game/core/Engine.js';
import { Logger } from './utils/Logger.js';
import { setupPerformanceTools } from './PerformanceTools.js';

// Update font style for the entire app
document.documentElement.style.setProperty('--app-font', '"Helvetica Neue", Helvetica, sans-serif');

// Debug info for mobile detection
function logDeviceInfo() {
  console.log('Device Detection Info:');
  console.log('- Touch Points:', navigator.maxTouchPoints);
  console.log('- ontouchstart:', 'ontouchstart' in window);
  console.log('- User Agent:', navigator.userAgent);
  console.log('- Screen Size:', window.innerWidth, 'x', window.innerHeight);
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Log device info
    logDeviceInfo();
    
    // Create and initialize game engine
    const engine = new Engine();
    
    // Expose engine globally for debugging and performance monitoring only in development
    if (import.meta.env.DEV) {
      window.gameEngine = engine;
    }
    
    await engine.initialize();
    setupPerformanceTools();

    console.log('SkyBloom initialized successfully!');
    console.log('Use window.getPerformanceReport() to view performance metrics');
  } catch (error) {
    console.error('Error initializing game:', error);
    document.getElementById('loading-text').textContent = 'Error loading game. Please refresh.';
  }
});
