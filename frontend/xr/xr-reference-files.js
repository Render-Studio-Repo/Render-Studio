/**
 * Workspace Reference Files — list project refs and open them in the
 * shared XR window manager (same 2D viewer as recordings).
 */

export const XR_REF_ACCEPT = /\.(pdf|txt|md|csv|tsv|log|json|ya?ml|html?|rtf|docx?|xlsx?|pptx?|png|jpe?g|webp|gif|bmp|svg|tiff?|webm|mp4|mov|m4v)$/i;

export function referenceKindFromName(name = "") {
  const lower = String(name || "").split("?")[0].toLowerCase();
  if (/\.(webm|mp4|mov|m4v)$/i.test(lower)) return "video";
  if (/\.(png|jpe?g|webp|gif|bmp|svg|tiff?)$/i.test(lower)) return "image";
  if (/\.pdf$/i.test(lower)) return "pdf";
  if (/\.(txt|md|csv|tsv|log|json|ya?ml|html?|rtf)$/i.test(lower)) return "text";
  if (XR_REF_ACCEPT.test(lower)) return "file";
  return "";
}

export function isXrReferenceFilename(name = "") {
  return !!referenceKindFromName(name);
}

export function listProjectReferenceFiles(files = []) {
  const out = [];
  const seen = new Set();
  for (const raw of files || []) {
    const name = String(raw?.name || raw?.filename || raw?.id || raw || "").trim();
    if (!name || seen.has(name)) continue;
    const kind = referenceKindFromName(name);
    if (!kind) continue;
    seen.add(name);
    const url = String(raw?.url || raw?.preview_url || raw?.play_url || "").trim();
    out.push({
      id: name,
      name,
      label: name.split("/").pop() || name,
      kind,
      url,
    });
  }
  return out.slice(0, 40);
}

export function workspaceReferenceButtonLine() {
  return { id: "ws-refs", label: "Reference files", kind: "action", icon: "workspace" };
}

export function workspaceReferenceLines(files = []) {
  const refs = listProjectReferenceFiles(files);
  const lines = [
    { id: "ws-refs-back", label: "← Workspace", kind: "action", icon: "undo" },
    { id: "", label: refs.length ? "Open a video, PDF, or photo" : "No reference files in this project", kind: "hint", icon: "workspace" },
  ];
  for (const row of refs) {
    lines.push({
      id: `ws-ref:${row.name}`,
      label: row.label.slice(0, 28),
      kind: "reference",
      icon: row.kind === "video" ? "rec" : row.kind === "pdf" ? "export" : "cam",
      ref: row,
    });
  }
  return lines;
}

export function referenceFileUrl(row = {}, projectId = "") {
  const url = String(row?.url || "").trim();
  if (url) return url;
  const name = String(row?.name || row?.filename || "").trim();
  const pid = String(projectId || "").trim();
  if (!name || !pid) return "";
  return `/api/projects/${encodeURIComponent(pid)}/files/${name.split("/").map(encodeURIComponent).join("/")}`;
}

export function paintReferenceDocCard(ctx, {
  width = 720,
  height = 420,
  title = "Document",
  kind = "file",
  body = "",
} = {}) {
  if (!ctx) return;
  const w = Number(width) || 720;
  const h = Number(height) || 420;
  ctx.fillStyle = "#07111f";
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "rgba(14,165,233,0.22)");
  g.addColorStop(1, "rgba(15,23,42,0.05)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(125,211,252,0.45)";
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.fillStyle = "#7dd3fc";
  ctx.font = "800 22px Arial,sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(String(kind || "file").toUpperCase(), 36, 48);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 36px Arial,sans-serif";
  ctx.fillText(String(title || "Document").slice(0, 36), 36, 96);
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (text) {
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "22px Arial,sans-serif";
    const lineH = 32;
    let y = 150;
    let rest = text.slice(0, 420);
    while (rest && y < h - 40) {
      const chunk = rest.slice(0, 52);
      ctx.fillText(chunk, 36, y);
      rest = rest.slice(chunk.length);
      y += lineH;
    }
  }
}

export function shouldOpenReferenceInWindow(kind = "") {
  return ["video", "image", "pdf", "text", "file"].includes(String(kind || ""));
}
