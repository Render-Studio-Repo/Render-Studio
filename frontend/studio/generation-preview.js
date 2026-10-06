/** Live generation preview vs the already-loaded assembly object. */

export function isPendingGenerationJob(job) {
  return String(job?.trace_id || job?.id || "") === "pending";
}

/** Generate another already has at least one live job — never treat "1 running" as the new job. */
export function additionalPendingBaseline(liveJobCount = 0) {
  return Math.max(Number(liveJobCount || 0), 1);
}

export function keepPendingAdditionalGeneration({ pendingStart = false, liveJobCount = 0, baseline = 0 } = {}) {
  return !!pendingStart && Number(liveJobCount || 0) <= Number(baseline || 0);
}

export function focusedJobIdAfterPending({ keepPending = false, focusedJobId = "", newestLiveId = "" } = {}) {
  if (keepPending) return "pending";
  if (String(focusedJobId || "") === "pending") return newestLiveId || null;
  return focusedJobId || newestLiveId || null;
}

/** Sibling CAD jobs (or a queued Generate another) still own the 3D overlay / live preview. */
export function shouldDeferCompletedJobViewport({
  completedTraceId = "",
  runningJobs = [],
  pendingStart = false,
  pendingBaselineCount = 0,
} = {}) {
  const done = String(completedTraceId || "");
  const others = (runningJobs || []).filter((job) => {
    if (isPendingGenerationJob(job)) return false;
    const id = String(job?.trace_id || job?.id || "");
    return id && id !== done && String(job?.status || "running").toLowerCase() === "running";
  });
  if (others.length) return true;
  return !!pendingStart && Number(pendingBaselineCount || 0) >= 1;
}

export function overlayPreviewFields({
  focusedIsPending = false,
  focusedProgress = null,
  liveProgress = null,
  watchProgress = null,
} = {}) {
  const pick = (...vals) => vals.find((v) => v != null && v !== "");
  if (focusedIsPending) {
    return {
      preview_filename: pick(focusedProgress?.preview_filename, watchProgress?.preview_filename),
      preview_mtime: pick(focusedProgress?.preview_mtime, watchProgress?.preview_mtime),
      preview_seq: pick(focusedProgress?.preview_seq, watchProgress?.preview_seq),
      preview_bytes: pick(focusedProgress?.preview_bytes, watchProgress?.preview_bytes),
      preview_part: pick(focusedProgress?.preview_part, watchProgress?.preview_part),
      preview_parts: pick(focusedProgress?.preview_parts, watchProgress?.preview_parts),
      preview_append: pick(focusedProgress?.preview_append, watchProgress?.preview_append),
    };
  }
  return {
    preview_filename: pick(focusedProgress?.preview_filename, liveProgress?.preview_filename, watchProgress?.preview_filename),
    preview_mtime: pick(focusedProgress?.preview_mtime, liveProgress?.preview_mtime, watchProgress?.preview_mtime),
    preview_seq: pick(focusedProgress?.preview_seq, liveProgress?.preview_seq, watchProgress?.preview_seq),
    preview_bytes: pick(focusedProgress?.preview_bytes, liveProgress?.preview_bytes, watchProgress?.preview_bytes),
    preview_part: pick(focusedProgress?.preview_part, liveProgress?.preview_part, watchProgress?.preview_part),
    preview_parts: pick(focusedProgress?.preview_parts, liveProgress?.preview_parts, watchProgress?.preview_parts),
    preview_append: pick(focusedProgress?.preview_append, liveProgress?.preview_append, watchProgress?.preview_append),
  };
}

export function livePreviewSourceStem(filename = "") {
  const base = String(filename || "").replace(/\\/g, "/").split("/").pop() || "";
  return base
    .replace(/\.generation-live(?=\.(glb|gltf)$)/i, "")
    .replace(/\.(glb|gltf|stl|obj|ply|off)$/i, "")
    .replace(/_edited(?:_\d+)?$/i, "")
    .trim();
}

/**
 * Append only for a *new* part draft beside existing models.
 * Edit selected / Generate-another on the same stem must not clone the current mesh.
 */
export function livePreviewShouldAppend({
  previewAppend = false,
  previewFilename = "",
  livePreviewHasChildren = false,
  targetMode = "",
  assemblyFilenames = [],
} = {}) {
  if (!previewAppend) return false;
  if (!/\.generation-live\.(?:glb|gltf)$/i.test(String(previewFilename || ""))) return false;
  if (String(targetMode || "").toLowerCase() === "edit") return false;
  const stem = livePreviewSourceStem(previewFilename);
  if (stem && (assemblyFilenames || []).some((name) => livePreviewSourceStem(name) === stem)) {
    return false;
  }
  return true;
}

function finiteBounds(bounds) {
  const min = Array.isArray(bounds?.min) ? bounds.min.map(Number) : [];
  const max = Array.isArray(bounds?.max) ? bounds.max.map(Number) : [];
  if (min.length !== 3 || max.length !== 3 || ![...min, ...max].every(Number.isFinite)) return null;
  const size = max.map((value, axis) => value - min[axis]);
  if (size.some((value) => value < 0)) return null;
  return { min, max, size };
}

/** Move a standalone generated object beyond every visible sibling along +X. */
export function sideBySideTranslation({ newBounds, occupiedBounds = [], gapRatio = 0.18 } = {}) {
  const candidate = finiteBounds(newBounds);
  const occupied = (occupiedBounds || []).map(finiteBounds).filter(Boolean);
  if (!candidate || !occupied.length) return null;
  const largest = Math.max(
    1e-6,
    ...candidate.size,
    ...occupied.flatMap((bounds) => bounds.size),
  );
  const gap = largest * Math.max(0, Number(gapRatio) || 0);
  const occupiedMaxX = Math.max(...occupied.map((bounds) => bounds.max[0]));
  return [occupiedMaxX + gap - candidate.min[0], 0, 0];
}
