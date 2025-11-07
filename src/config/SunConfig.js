// Sun system configuration constants
export const SUN_CONFIG = {
  // Visual properties
  SUN_RADIUS: 120,
  SUN_SEGMENTS: 32,
  RENDER_ORDER: 99,
  RENDER_LAYER: 10, // For water reflections

  // Lighting properties
  DEFAULT_COLOR: 0xffff00,
  DEFAULT_INTENSITY: 1.2,
  AMBIENT_INTENSITY: 0.7,

  // Positioning and movement
  SUN_DISTANCE: 15000,
  MAX_HEIGHT: 3000,
  HORIZON_LEVEL: 0,
  SEASONAL_VARIATION: 0.15,

  // Animation timing
  CYCLE_SPEED: 0.001,
  SUNRISE_TIME: 0.25,  // 6 AM
  SUNSET_TIME: 0.75,   // 6 PM

  // Visual effects
  GLOW_OPACITY: 0.2,
  BELOW_HORIZON_FACTOR: 300,

  // Shadow settings
  SHADOW_MAP_SIZE: 2048,
  SHADOW_BIAS: -0.0005,
  SHADOW_NEAR: 100,
  SHADOW_FAR: 5000,
  SHADOW_CAMERA_SIZE: 100
};