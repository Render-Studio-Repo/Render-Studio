/**
 * Project-open mesh fetch helpers.
 *
 * Viewport insert stays ordered (assembly / gizmo / first-paint). Network
 * fetches start together so later GLBs overlap the primary parse instead of
 * waiting in a serial await loadModel loop.
 */

export function fileStemName(name = "") {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop() || "";
  const cut = base.lastIndexOf(".");
  return cut > 0 ? base.slice(0, cut) : base;
}

/** Preview / share / export dumps — never a designed browser component. */
export function isInternalModelArtifactName(name = "") {
  const lower = String(name || "").toLowerCase().replace(/\\/g, "/");
  const base = lower.split("/").pop() || lower;
  return (
    base.startsWith("_active_")
    || base.startsWith("_export_")
    || base.startsWith("_share_")
    || (base.startsWith(".") && base.endsWith(".step.glb"))
    || lower.includes(".generation-live.")
  );
}

function isPrefetchViewableName(name = "") {
  const n = String(name || "");
  if (!n) return false;
  const base = n.replace(/\\/g, "/").split("/").pop() || n;
  const lower = base.toLowerCase();
  if (lower.startsWith("_active_") || lower.startsWith("_export_") || lower.startsWith("_share_")) return false;
  if (/\.(step|stp)$/i.test(n)) return false;
  if (/(?:^|\/)\.[^/]+\.step\.glb$/i.test(n.replace(/\\/g, "/"))) return true;
  return /\.(glb|gltf|stl|obj|ply|off)$/i.test(n);
}

function glbSiblingFor(raw, fileNames = []) {
  const stem = fileStemName(raw);
  if (!stem) return null;
  return fileNames.find((name) => {
    if (!/\.glb$/i.test(name) || !isPrefetchViewableName(name)) return false;
    return fileStemName(name) === stem;
  }) || null;
}

/** Pick the mesh the viewport should fetch for a browser / file-list entry. */
export function resolveViewportViewer(entry, files = []) {
  const rows = (files || []).map((f) => (typeof f === "string" ? { name: f } : (f || {})));
  const fileNames = rows.flatMap((f) => [f.viewer_filename, f.name].filter(Boolean));
  const names = [entry?.viewer_filename, entry?.name].filter(Boolean);
  for (const n of names) {
    const row = rows.find((f) => f.name === n || f.viewer_filename === n);
    const recovered = row?.viewer_filename;
    const candidate = recovered && isPrefetchViewableName(recovered) ? recovered : n;
    if (!isPrefetchViewableName(candidate)) continue;
    if (/\.(obj|stl|ply|off)$/i.test(candidate)) {
      const glb = glbSiblingFor(candidate, fileNames);
      if (glb) return glb;
    }
    return candidate;
  }
  const raw = String(entry?.name || entry?.viewer_filename || "");
  if (isInternalModelArtifactName(raw) && !/(?:^|\/)\.[^/]+\.step\.glb$/i.test(raw.replace(/\\/g, "/"))) {
    return null;
  }
  const stem = fileStemName(raw).replace(/_edited(?:_\d+)?$/i, "");
  if (!stem) return null;
  const glb = fileNames.find((name) => {
    if (!isPrefetchViewableName(name)) return false;
    return fileStemName(name).replace(/_edited(?:_\d+)?$/i, "") === stem;
  });
  return glb || null;
}

export function isExplodedSidecarName(name = "") {
  return /_exploded$/i.test(fileStemName(name));
}

/** Exploded sidecars are a viewport toggle — do not fetch them beside the assembled parent. */
export function shouldSkipDuplicateExploded(viewerName, assembledStems) {
  const stem = fileStemName(viewerName).toLowerCase();
  if (!stem.endsWith("_exploded")) return false;
  const parent = stem.slice(0, -"_exploded".length);
  return !!(parent && assembledStems && assembledStems.has(parent));
}

export function assembledStemsFromEntries(entries = []) {
  const stems = new Set();
  for (const entry of entries || []) {
    const stem = String(entry?.stem || fileStemName(entry?.viewer_filename || entry?.name || "")).toLowerCase();
    if (stem && !stem.endsWith("_exploded")) stems.add(stem);
  }
  return stems;
}

/**
 * Kick off blob fetches immediately. Await the primary first; later keys overlap.
 * @param {Array<{ key: string, fetch: () => Promise<Blob> }>} jobs
 * @returns {Map<string, Promise<Blob>>}
 */
export function startBlobPrefetch(jobs = []) {
  const map = new Map();
  for (const job of jobs) {
    const key = String(job?.key || "");
    if (!key || map.has(key) || typeof job.fetch !== "function") continue;
    // A secondary fetch can fail while the primary is still parsing. Observe
    // rejection now, while preserving it for the ordered loader to handle.
    let pending;
    try { pending = Promise.resolve(job.fetch()); }
    catch (error) { pending = Promise.reject(error); }
    pending.catch(() => {});
    map.set(key, pending);
  }
  return map;
}
