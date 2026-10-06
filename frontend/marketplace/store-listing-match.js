/** Match studio files to public store listings (no DOM / auth). */

export const MODEL_EXTS = new Set(["stl", "step", "stp", "glb", "gltf", "obj", "3mf", "ply", "off", "zip"]);
export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"]);

export function fileExt(name) {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop() || "";
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

export function fileBase(name) {
  return String(name || "").replace(/\\/g, "/").split("/").pop() || "";
}

export function fileStem(name) {
  const base = fileBase(name);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

export function isStoreImageFilename(name) {
  return IMAGE_EXTS.has(fileExt(name));
}

export function isStoreModelFilename(name) {
  return MODEL_EXTS.has(fileExt(name));
}

function listingFileNames(listing) {
  const names = [];
  for (const f of listing?.files || []) {
    names.push(f.name, f.filename, f.rel);
  }
  const thumb = listing?.thumbnail;
  if (thumb && typeof thumb === "object") names.push(thumb.filename, thumb.name);
  else if (typeof thumb === "string") names.push(thumb);
  for (const g of listing?.gallery || []) names.push(g.filename, g.name);
  return names.map((n) => fileBase(n).toLowerCase()).filter(Boolean);
}

export function listingMentionsFile(listing, filename, projectId, { includeArchived = false } = {}) {
  if (!listing) return false;
  if (!includeArchived && String(listing.status || "").toLowerCase() === "archived") return false;
  const base = fileBase(filename).toLowerCase();
  if (!base) return false;
  const pid = String(projectId || "");
  for (const f of listing.files || []) {
    const hit = fileBase(f.name || f.filename || f.rel).toLowerCase() === base;
    if (!hit) continue;
    if (!pid || !f.project_id || String(f.project_id) === pid) return true;
  }
  return listingFileNames(listing).includes(base);
}

export function isFeaturedOnStore(listing, storeSettings) {
  if (!listing?.id) return false;
  const ids = storeSettings?.featured_listing_ids || [];
  return ids.includes(listing.id) || ids.includes(listing.slug);
}

export function withFeaturedListing(storeSettings, listingId, featured) {
  const id = String(listingId || "").trim();
  const prev = [...(storeSettings?.featured_listing_ids || [])].map(String).filter(Boolean);
  const next = featured ? [...new Set([...prev, id])] : prev.filter((x) => x !== id);
  return { ...storeSettings, featured_listing_ids: next.slice(0, 24) };
}
