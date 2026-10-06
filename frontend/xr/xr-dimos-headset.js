/**
 * WebXR headset → DIMOS `dimos run teleop-*` blueprint.
 *
 * Dimos ships `teleop-quest-*` only (OpenArm: teleop-quest-openarm).
 * There is no `teleop-vision-*` or `teleop-vive-*` blueprint — Vision Pro
 * and Vive/Index fall back to teleop-quest-openarm (same :8443 /ws LCM pipe).
 */

export const DIMOS_DEFAULT_BLUEPRINT = "teleop-quest-openarm";

export const DIMOS_HEADSET_BLUEPRINTS = Object.freeze({
  quest: "teleop-quest-openarm",
  vision: "teleop-quest-openarm",
  vive: "teleop-quest-openarm",
});

export const DIMOS_HEADSET_FALLBACK_NOTES = Object.freeze({
  vision: "dimos has no teleop-vision-* blueprint; Vision Pro uses teleop-quest-openarm (same /ws LCM pipe).",
  vive: "dimos has no teleop-vive-* blueprint; Vive/Index uses teleop-quest-openarm (same /ws LCM pipe).",
});

export function collectXrInputProfiles(session) {
  const out = [];
  for (const src of session?.inputSources || []) {
    for (const p of src.profiles || []) {
      if (p) out.push(String(p));
    }
  }
  return out;
}

function navigatorUa() {
  try {
    if (typeof navigator !== "undefined" && navigator.userAgent) return String(navigator.userAgent);
  } catch { /* node tests */ }
  return "";
}

function navigatorXr() {
  try {
    if (typeof navigator !== "undefined") return navigator.xr || null;
  } catch { /* node tests */ }
  return null;
}

/**
 * Classify Quest vs Apple Vision Pro vs Vive/Index from a live XR session.
 * Quest passthrough is also immersive-ar / alpha-blend — UA + profiles win first.
 */
export function detectDimosHeadset({
  session = null,
  userAgent = "",
  xr = null,
  environmentBlendMode = "",
  sessionMode = "",
  profiles = null,
} = {}) {
  const ua = String(userAgent || navigatorUa() || "");
  const xrObj = xr === undefined || xr === null ? navigatorXr() : xr;
  const blend = String(environmentBlendMode || session?.environmentBlendMode || "").toLowerCase();
  const mode = String(sessionMode || session?.mode || "").toLowerCase();
  const prof = Array.isArray(profiles) ? profiles : collectXrInputProfiles(session);
  const blob = `${ua} ${prof.join(" ")}`.toLowerCase();

  if (/oculusbrowser|metabrowser|horizonos|\bquest\b|oculus-touch|meta-quest|\boculus\b/.test(blob)) {
    return "quest";
  }
  if (/htc-vive|vive-focus|vive-cosmos|valve-index|knuckles|\bvive\b/.test(blob)) {
    return "vive";
  }
  if (/visionos|applevisionpro|apple-visor|realityapp|vision.?pro/.test(blob)) {
    return "vision";
  }

  const arLike = mode === "immersive-ar" || blend === "alpha-blend" || blend === "additive";
  if (arLike && !/oculus|quest|vive|index/.test(blob)) {
    const hasWand = prof.some((p) => /touch|vive|index|controller|knuckles/i.test(p));
    if (!hasWand) return "vision";
  }

  if (xrObj && mode === "immersive-vr" && /vive|index/.test(blob)) return "vive";
  return "quest";
}

export function dimosBlueprintForHeadset(headset) {
  const key = String(headset || "").toLowerCase().trim();
  return DIMOS_HEADSET_BLUEPRINTS[key] || DIMOS_DEFAULT_BLUEPRINT;
}

export function dimosHeadsetFallbackNote(headset) {
  const key = String(headset || "").toLowerCase().trim();
  return DIMOS_HEADSET_FALLBACK_NOTES[key] || "";
}

export function dimosEnsurePayload(session = null, extra = {}) {
  const headset = detectDimosHeadset({ session, ...extra });
  return {
    headset,
    blueprint: dimosBlueprintForHeadset(headset),
    fallbackNote: dimosHeadsetFallbackNote(headset),
  };
}
