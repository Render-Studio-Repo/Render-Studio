/**
 * Sandbox auto-push — MCP write + collab-index + code-update history in one shot.
 * Token autopush1. Hot-reloads under frontend/sandbox/; no git remote push.
 */

import { appendCodeUpdate } from "./project-file-viewer.js?v=20260923-draw-recordings1";

export const AUTOPUSH1_TOKEN = "autopush1";

export async function mcpSandboxWrite(path, text, agent = "cursor") {
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "write",
      agent,
      path,
      text: String(text ?? "").slice(0, 200_000),
    }),
  }).catch(() => null);
  if (!res || !res.ok) {
    return { ok: false, detail: res ? `HTTP ${res.status}` : "network", path };
  }
  return { ok: true, ...(await res.json().catch(() => ({}))), path, agent };
}

export async function postCollabEdit({ path, agent = "cursor", note = "" } = {}) {
  const res = await fetch("/mcp/collab-index", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "post",
      agent,
      path: String(path || "").slice(0, 200),
      note: String(note || "sandbox write").slice(0, 200),
      text: String(note || `updated ${path}`).slice(0, 400),
    }),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false, detail: res ? `HTTP ${res.status}` : "network" };
  return { ok: true, ...(await res.json().catch(() => ({}))) };
}

/**
 * Write sandbox file and automatically:
 * 1) land on disk via /mcp/sandbox (hot_reload)
 * 2) post to collab-index live history
 * 3) append code-updates-link history
 */
export async function autoPushSandboxCode({
  path,
  text,
  agent = "cursor",
  note = "auto-push",
  track = true,
  collab = true,
} = {}) {
  const rel = String(path || "").replace(/^\/+/, "").slice(0, 200);
  if (!rel) return { ok: false, detail: "missing path" };
  const write = await mcpSandboxWrite(rel, text, agent);
  if (!write.ok) return { ...write, token: AUTOPUSH1_TOKEN };

  let collabOut = null;
  if (collab) {
    collabOut = await postCollabEdit({ path: rel, agent, note });
  }
  let trackOut = null;
  if (track) {
    try {
      trackOut = await appendCodeUpdate({ path: rel, agent, note });
    } catch { /* optional */ }
  }

  try {
    window.dispatchEvent(new CustomEvent("render3d-sandbox-autopush", {
      detail: {
        token: AUTOPUSH1_TOKEN,
        path: rel,
        agent,
        note,
        at: new Date().toISOString(),
        hot_reload: !!write.hot_reload,
      },
    }));
  } catch { /* optional */ }

  return {
    ok: true,
    token: AUTOPUSH1_TOKEN,
    path: rel,
    agent,
    hot_reload: !!write.hot_reload,
    collab: collabOut,
    track: trackOut,
  };
}
