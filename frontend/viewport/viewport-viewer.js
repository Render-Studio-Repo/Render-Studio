/** Prefer Jake multi-material viewport GLBs over washed one-color shell meshes. */

export function fileStem(name) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

export function isMeshViewerFilename(name) {
  return /\.(glb|gltf|stl|obj|ply|off)$/i.test(String(name || ""));
}

export function isStepLikeFilename(name) {
  return /\.(step|stp)$/i.test(String(name || ""));
}

export function isJakeViewportFilename(name) {
  const n = String(name || "");
  return n.startsWith(".") && /\.step\.glb$/i.test(n);
}

/** Jake CADJS sidecar: Model.step / Model.glb → .Model.step.glb */
export function jakeViewportFilenameFor(filename) {
  const name = String(filename || "").split("/").pop() || "";
  if (!name || isJakeViewportFilename(name)) return name;
  return `.${fileStem(name)}.step.glb`;
}

let projectFileNameSet = new Set();

export function rememberProjectFiles(files) {
  projectFileNameSet = new Set(
    (files || []).map((f) => (typeof f === "string" ? f : f?.name)).filter(Boolean),
  );
}

export function projectHasFile(name) {
  return Boolean(name) && projectFileNameSet.has(name);
}

/**
 * Resolve the Three.js file to load for a catalog/STEP name.
 * Trust browser.viewer_filename from the backend (already prefers Jake when the
 * product-shell GLB is a washed one-color merge). Login/collab reloads must not
 * clobber that with the STEP name → shell `.glb` path.
 */
export function preferViewportFilename(filename, { components = [], files = null } = {}) {
  const name = String(filename || "").split("/").pop() || "";
  if (!name) return name;
  if (isJakeViewportFilename(name)) return name;

  if (files) rememberProjectFiles(files);

  const stem = fileStem(name);
  const fromComp = (components || []).find(
    (c) => c?.name === name
      || c?.viewer_filename === name
      || fileStem(c?.name || "") === stem
      || fileStem(String(c?.viewer_filename || "").replace(/^\./, "").replace(/\.step$/i, "")) === stem,
  );
  const browserViewer = fromComp?.viewer_filename;
  if (browserViewer && isMeshViewerFilename(browserViewer)) {
    return browserViewer;
  }

  if (isStepLikeFilename(name)) {
    const jake = jakeViewportFilenameFor(name);
    const shell = `${stem}.glb`;
    if (projectHasFile(jake) && !projectHasFile(shell)) return jake;
    if (projectHasFile(shell)) return shell;
    if (projectHasFile(jake)) return jake;
  }
  return name;
}
