/** Pure Onshape library helpers (safe to unit-test without auth/DOM). */

export const ELEM_TYPE_LABEL = {
  PARTSTUDIO:  "Part Studio",
  ASSEMBLY:    "Assembly",
  BLOB:        "File",
  APPLICATION: "App",
};

export const IMPORTABLE_EXTS = /\.(step|stp|stl|3mf|obj|glb|gltf)$/i;
export const SYSTEM_NAME = /^(Open CASCADE|Default geometry|Variable Studio|BOM|Bill of Materials|Dashboard)/i;
export const ONSHAPE_THUMB_HOST = /^https:\/\/cad\.onshape\.com\//i;

export function isImportable(el) {
  if (SYSTEM_NAME.test(el.name)) return false;
  if (el.type === "PARTSTUDIO" || el.type === "ASSEMBLY") return true;
  if (el.type === "BLOB") return IMPORTABLE_EXTS.test(el.name);
  return false;
}

export function shouldShow(el) {
  if (SYSTEM_NAME.test(el.name)) return false;
  if (el.type === "APPLICATION") return false;
  if (el.type === "BLOB") return IMPORTABLE_EXTS.test(el.name);
  return true;
}

export function isOnshapeThumbnailFallbackUrl(url) {
  return ONSHAPE_THUMB_HOST.test(String(url || "").trim());
}

/** Same Autodesk pattern: authenticated proxy, then blob URL in the card. */
export function onshapeThumbnailRequestUrl({ did, wid, eid = "", size = "300x170", fallbackUrl = "", large = false } = {}) {
  if (!did || !wid) return "";
  const params = new URLSearchParams({
    did: String(did),
    wid: String(wid),
    size: large ? "300x300" : String(size || "300x170"),
  });
  if (eid) params.set("eid", String(eid));
  if (isOnshapeThumbnailFallbackUrl(fallbackUrl)) {
    params.set("fallback_url", String(fallbackUrl).trim());
  }
  return `/api/onshape/thumbnail?${params.toString()}`;
}

export function filterOnshapeLibrary(items, query) {
  const q = String(query || "").trim().toLowerCase();
  const list = Array.isArray(items) ? items : [];
  if (!q) return list;
  return list.filter((item) => {
    const typeLabel = ELEM_TYPE_LABEL[item?.type] || item?.type || "";
    return [item?.name, item?.type, typeLabel].some((part) => String(part || "").toLowerCase().includes(q));
  });
}
