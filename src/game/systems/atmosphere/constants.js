// Shared constants for camera-anchored celestial bodies (sun, moon, stars).

// Fraction of the camera far plane at which the sun disc, the moon and the
// star domes are placed. INVARIANT: must stay below SkySystem's sky-dome
// factor (far * 0.8) so every celestial body renders inside the sky dome and
// the camera far plane — raise it past 0.8 and they get occluded/clipped.
export const CELESTIAL_DISTANCE_FRACTION = 0.72;
