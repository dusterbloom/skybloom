// Shared world-curvature GLSL — the visual "planet bend" used by terrain
// (WorldSystem), trees (SimpleTreeSystem) and the sea (WaterSystem). One
// definition so all three shaders drop by exactly the same amount around the
// same centre (WorldSystem re-centers and eases the uniforms every frame).
//
// Usage: prepend CURVE_UNIFORMS_GLSL + CURVE_DROP_GLSL to a vertex shader,
// then subtract curveDrop(worldPos) from the vertex's world-space Y.

export const CURVE_UNIFORMS_GLSL = 'uniform vec3 uCurveCenter;\nuniform float uCurveAmount;\n';

// distance² / (2R) — the parabolic approximation of a sphere (uCurveAmount = 1/(2R)),
// so the ground falls away like a horizon. Near the viewer the drop is ~0.
export const CURVE_DROP_GLSL = `
float curveDrop(vec3 worldPos) {
  float _cdx = worldPos.x - uCurveCenter.x;
  float _cdz = worldPos.z - uCurveCenter.z;
  return uCurveAmount * (_cdx * _cdx + _cdz * _cdz);
}
`;
