/** When Sandbox is on, VR/desktop Projects menu lists frontend/sandbox files. Token sandbox2. */

export const SANDBOX2_TOKEN = "sandbox2";
export const SANDBOX1_KEEP = "sandbox1";

let cache = [];

export function sandboxEnabled() {
  try {
    return document.getElementById("sb1-window")?.classList.contains("is-open") === true;
  } catch {
    return false;
  }
}

export async function refreshSandboxProjectCache() {
  const res = await fetch("/mcp/sandbox?action=list&t=" + Date.now()).catch(() => null);
  const data = res && res.ok ? await res.json() : { files: [] };
  cache = (data.files || []).map((f) => ({
    id: f.path || f,
    label: f.path || f,
    name: f.path || f,
    active: false,
    kind: "sandbox-file",
    token: SANDBOX2_TOKEN,
  }));
  return cache;
}

export function sandboxMenuProjects() {
  if (!sandboxEnabled()) return null;
  if (!cache.length) void refreshSandboxProjectCache();
  if (!cache.length) {
    return [{ id: "", label: "Sandbox files (loading…) — frontend/sandbox only", active: false, kind: "hint", icon: "export" }];
  }
  return [
    { id: "", label: `Sandbox files · ${SANDBOX2_TOKEN} (keep ${SANDBOX1_KEEP})`, active: false, kind: "hint", icon: "export" },
    ...cache.map((it) => ({ ...it, icon: "export" })),
  ];
}

export function openSandboxMenuFile(path) {
  const rel = String(path || "").replace(/^frontend\/sandbox\//, "");
  if (!rel) return { ok: false };
  try { window.Render3DSandbox?.open?.(); } catch { /* overlay optional */ }
  try { return window.Render3DSandbox?.loadFile?.(rel); } catch {
    return { ok: false };
  }
}
