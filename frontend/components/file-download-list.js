/** Pure helpers for export download menus — formats that exist, not invented siblings. */

export function stripExportTraceId(message) {
  return String(message || "").replace(/\s*\[trace #[^\]]+\]\s*$/i, "").trim();
}

function exportExtOf(filename) {
  const name = String(filename || "").split("/").pop() || "";
  const lower = name.toLowerCase();
  if (lower.endsWith(".program.json")) return "program";
  if (lower.endsWith(".sim.json")) return "sim";
  if (lower.endsWith(".mjcf.xml")) return "mjcf";
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Only formats that exist (or can be generated, e.g. 3MF). Never invent missing siblings. */
export function listedDownloadExports(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!item?.name) return false;
    if (item.convertible) return true;
    if (typeof item.size === "number" && item.size <= 0) return false;
    return true;
  });
}

/** Timeout / listing failure: the current model file only, with its nested path. */
export function timeoutDownloadExports(filename) {
  const name = String(filename || "").trim();
  if (!name || /^(visible|project)\s+assembly$/i.test(name)) return [];
  const format = exportExtOf(name) || "glb";
  return [{ name, format, size: null, current: true }];
}

export function missingSourceDownloadMessage(filename, err) {
  const leaf = String(filename || "").split("/").pop() || "this model";
  const raw = stripExportTraceId(err?.message || "");
  if (raw && !/^file not found$/i.test(raw) && !/^request failed$/i.test(raw)) return raw;
  return `${leaf} is not on disk. Generation never wrote this file.`;
}
