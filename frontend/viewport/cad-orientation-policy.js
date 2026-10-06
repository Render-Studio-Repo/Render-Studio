/** Jake/text-to-CAD previews inherit the accepted STEP frame: millimetres, +Z up. */
export function shouldTrustAuthoredCadZUp(orientationMode = null) {
  return orientationMode === "v2-upright";
}
