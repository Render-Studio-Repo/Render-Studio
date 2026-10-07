/**
 * Viewport object delete vs project persist.
 *
 * Ghost Create/Architect catalogs (`.local`, `__create_*`) may hide immediately.
 * Anything with a real model extension must go through DELETE /files/{path}
 * the same way gizmo transform POSTs the remaining geometry.
 */

const PERSISTED_MODEL_EXT = /\.(glb|gltf|step|stp|stl|3mf|obj|ply|off)$/i;

export function encodeProjectFileRel(filename) {
  return String(filename || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function projectFileDeleteApiPath(projectId, filename) {
  return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeProjectFileRel(filename)}`;
}

export function isGhostLocalCatalogName(name) {
  const value = String(name || "").trim();
  if (!value) return false;
  const base = value.replace(/\\/g, "/").split("/").pop() || value;
  return (
    base.endsWith(".local")
    || value.endsWith(".local")
    || value.startsWith("__architect_")
    || value.startsWith("__create_")
    || base.startsWith("__architect_")
    || base.startsWith("__create_")
  );
}

/** True when the catalog key is a project file (including jake/vibecad/mesh/…). */
export function isPersistedProjectCatalogName(name) {
  const value = String(name || "").trim().replace(/\\/g, "/");
  if (!value || isGhostLocalCatalogName(value)) return false;
  const base = value.split("/").pop() || value;
  return PERSISTED_MODEL_EXT.test(base);
}

export function persistedDeleteTargets({ catalogName, object } = {}) {
  const names = new Set();
  const persisted = String(object?.userData?.persistedFilename || "").trim();
  if (persisted && isPersistedProjectCatalogName(persisted)) names.add(persisted);
  if (catalogName && isPersistedProjectCatalogName(catalogName)) names.add(catalogName);
  return [...names];
}
