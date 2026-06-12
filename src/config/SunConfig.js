import * as THREE from "three";

// Sun system configuration constants
export const SUN_CONFIG = {
  // Visual properties
  SUN_RADIUS: 120,
  SUN_SEGMENTS: 32,
  RENDER_ORDER: 99,
  RENDER_LAYER: 10, // For water reflections

  // Lighting properties - warmer for cozy feel
  DEFAULT_COLOR: 0xffd580,  // Warm golden sun instead of pure yellow
  DEFAULT_INTENSITY: 1.4,    // Slightly brighter for cheerier world
  AMBIENT_INTENSITY: 1.0,    // Increased ambient for softer shadows
  AMBIENT_MIN_INTENSITY: 0.25, // Readability floor: night is dim blue, never black

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

/*
 * ---------------------------------------------------------------------------
 * Time-of-day keyframe tables
 * ---------------------------------------------------------------------------
 * All atmosphere lighting interpolates smoothly across these tables instead of
 * the old hard time "buckets" (which stepped abruptly and went pitch black at
 * night). Each table covers t = 0.0 (midnight) .. 1.0 (midnight) and wraps.
 *
 * Tuned for the live renderer path: ACESFilmic tone mapping at exposure 1.0.
 *
 * Timeline vibes:
 *   0.00 night -> 0.23 pre-dawn -> 0.28 sunrise -> 0.50 noon ->
 *   0.70 golden hour (the money shot) -> 0.78 sunset -> 0.85 dusk -> night
 */

// Directional sun light: `color` + `value` (= light intensity)
export const SUN_KEYFRAMES = [
  { t: 0.00, color: 0x223355, value: 0.12 }, // night - faint cool blue fill
  { t: 0.20, color: 0x223355, value: 0.12 }, // hold flat through the night
  { t: 0.23, color: 0x445577, value: 0.30 }, // pre-dawn
  { t: 0.28, color: 0xffaa55, value: 0.90 }, // sunrise
  { t: 0.35, color: 0xffe8c0, value: 1.25 }, // morning
  { t: 0.50, color: 0xfff7e0, value: 1.40 }, // noon - bright, slightly warm white
  { t: 0.65, color: 0xffe8c0, value: 1.30 }, // afternoon
  { t: 0.70, color: 0xffcc77, value: 1.15 }, // golden hour
  { t: 0.78, color: 0xff7733, value: 0.85 }, // sunset
  { t: 0.85, color: 0x553366, value: 0.30 }, // dusk - purple afterglow
  { t: 0.90, color: 0x223355, value: 0.12 }, // early night
  { t: 1.00, color: 0x223355, value: 0.12 }  // wraps to midnight
];

// Ambient light: `color` + `value` (= light intensity).
// Never dips below SUN_CONFIG.AMBIENT_MIN_INTENSITY (enforced in SunSystem).
export const AMBIENT_KEYFRAMES = [
  { t: 0.00, color: 0x334466, value: 0.28 }, // night - cool blue, still readable
  { t: 0.20, color: 0x334466, value: 0.28 },
  { t: 0.23, color: 0x445577, value: 0.34 },
  { t: 0.28, color: 0xffd9b0, value: 0.55 }, // sunrise warmth
  { t: 0.35, color: 0xe8e4da, value: 0.85 },
  { t: 0.50, color: 0xf2ede2, value: 1.00 }, // noon - warm-neutral
  { t: 0.65, color: 0xefe6d8, value: 0.90 },
  { t: 0.70, color: 0xffe2b8, value: 0.80 }, // golden hour glow on everything
  { t: 0.78, color: 0xffb588, value: 0.60 }, // sunset
  { t: 0.85, color: 0x5e4a80, value: 0.36 }, // dusk purple
  { t: 0.90, color: 0x334466, value: 0.28 },
  { t: 1.00, color: 0x334466, value: 0.28 }
];

// Visible sun disc color (the billboard mesh, not the light)
export const SUN_DISC_KEYFRAMES = [
  { t: 0.00, color: 0xff6622 },
  { t: 0.22, color: 0xff7733 },
  { t: 0.27, color: 0xff9944 }, // rising sun - deep orange
  { t: 0.33, color: 0xffcc66 },
  { t: 0.45, color: 0xffee55 }, // high sun - yellow
  { t: 0.55, color: 0xffee55 },
  { t: 0.65, color: 0xffdd55 },
  { t: 0.70, color: 0xffbb44 }, // golden hour
  { t: 0.75, color: 0xff9933 },
  { t: 0.80, color: 0xff6622 }, // setting sun - deep orange-red
  { t: 1.00, color: 0xff6622 }
];

// Sky gradient: color straight overhead (zenith)
export const SKY_ZENITH_KEYFRAMES = [
  { t: 0.00, color: 0x0b1026 }, // deep night blue
  { t: 0.20, color: 0x0b1026 },
  { t: 0.23, color: 0x1a2342 },
  { t: 0.28, color: 0x44548f }, // sunrise - zenith still cool
  { t: 0.35, color: 0x6fa8e8 },
  { t: 0.50, color: 0x77bbff }, // noon - clear bright blue
  { t: 0.65, color: 0x6aa6f0 },
  { t: 0.70, color: 0x6a8fd0 }, // golden hour - sky cools as horizon warms
  { t: 0.78, color: 0x46518f }, // sunset - blue-violet overhead
  { t: 0.85, color: 0x221c44 }, // dusk purple
  { t: 0.90, color: 0x0b1026 },
  { t: 1.00, color: 0x0b1026 }
];

// Sky gradient: color at the horizon. Fog color and the renderer clear color
// track this table exactly so distant terrain melts into the sky.
export const SKY_HORIZON_KEYFRAMES = [
  { t: 0.00, color: 0x131a33 }, // night horizon - slightly lighter than zenith
  { t: 0.20, color: 0x131a33 },
  { t: 0.23, color: 0x3a3a5e }, // pre-dawn purple
  { t: 0.28, color: 0xff9966 }, // sunrise orange
  { t: 0.36, color: 0xf5d9b8 }, // morning cream
  { t: 0.50, color: 0xbcdfff }, // noon - pale hazy blue
  { t: 0.64, color: 0xc9d9ec },
  { t: 0.70, color: 0xffcc88 }, // golden hour - warm glow band
  { t: 0.78, color: 0xff7744 }, // sunset - deep warm orange
  { t: 0.85, color: 0x53355c }, // dusk mauve
  { t: 0.90, color: 0x18203d },
  { t: 1.00, color: 0x131a33 }
];

// Exponential fog density (`value` only). Slightly denser than the old
// 0.00015 so distant terrain/trees fade into the horizon instead of popping,
// lightest at noon so midday stays crisp.
export const FOG_DENSITY_KEYFRAMES = [
  { t: 0.00, value: 0.00026 },
  { t: 0.20, value: 0.00026 },
  { t: 0.28, value: 0.00024 },
  { t: 0.50, value: 0.00020 }, // noon - clearest
  { t: 0.70, value: 0.00022 },
  { t: 0.78, value: 0.00024 },
  { t: 0.85, value: 0.00026 },
  { t: 1.00, value: 0.00026 }
];

// Cloud sprite tint (`color`) and opacity (`value`). Clouds are unlit sprites,
// so without this they would glow pure white against the night sky.
export const CLOUD_KEYFRAMES = [
  { t: 0.00, color: 0x3a4a6a, value: 0.16 }, // night - dark blue-grey wisps
  { t: 0.20, color: 0x3a4a6a, value: 0.16 },
  { t: 0.24, color: 0x55608a, value: 0.20 },
  { t: 0.29, color: 0xffc9a0, value: 0.28 }, // sunrise-lit
  { t: 0.40, color: 0xffffff, value: 0.30 },
  { t: 0.60, color: 0xffffff, value: 0.30 }, // day - soft white
  { t: 0.68, color: 0xfff0d8, value: 0.30 },
  { t: 0.74, color: 0xffcf9e, value: 0.30 }, // golden hour underlighting
  { t: 0.80, color: 0xff9a70, value: 0.26 }, // sunset embers
  { t: 0.86, color: 0x5a4a78, value: 0.20 }, // dusk
  { t: 0.92, color: 0x3a4a6a, value: 0.16 },
  { t: 1.00, color: 0x3a4a6a, value: 0.16 }
];

// Scratch colors so sampling never allocates per frame
const _frameColorA = new THREE.Color();
const _frameColorB = new THREE.Color();

/**
 * Sample a keyframe table at a given time of day.
 *
 * Frames must be sorted by `t`, starting at t=0 and ending at t=1.
 * Interpolation is eased with smoothstep between adjacent frames, so scrubbing
 * time never shows steps or hard corners.
 *
 * @param {Array<{t:number, color?:number, value?:number}>} frames - Keyframe table
 * @param {number} time - Time of day; wrapped into [0, 1)
 * @param {THREE.Color|null} outColor - If given, receives the interpolated color
 * @returns {number} Interpolated `value` field (0 if the table has none)
 */
export function sampleKeyframes(frames, time, outColor = null) {
  // Wrap into [0, 1)
  let t = time - Math.floor(time);
  if (!Number.isFinite(t)) t = 0;

  let a = frames[0];
  let b = frames[frames.length - 1];
  for (let i = 0; i < frames.length - 1; i++) {
    if (t <= frames[i + 1].t) {
      a = frames[i];
      b = frames[i + 1];
      break;
    }
  }

  const span = b.t - a.t;
  let f = span > 1e-6 ? (t - a.t) / span : 0;
  f = Math.max(0, Math.min(1, f));
  f = f * f * (3 - 2 * f); // smoothstep easing

  if (outColor && a.color !== undefined && b.color !== undefined) {
    _frameColorA.setHex(a.color);
    _frameColorB.setHex(b.color);
    outColor.copy(_frameColorA).lerp(_frameColorB, f);
  }

  const va = a.value !== undefined ? a.value : 0;
  const vb = b.value !== undefined ? b.value : 0;
  return va + (vb - va) * f;
}
