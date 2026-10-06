/** Compact click/context logger for sandbox + VR. No poses/frames/prompt text. Token ctxlog1. */

export const CTXLOG1_TOKEN = "ctxlog1";

function short(value, n = 48) {
  return String(value || "").replace(/[^a-zA-Z0-9_.:#-]/g, "").slice(0, n);
}

function sessionId() {
  try {
    const key = "sb-ctx-session";
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = (crypto.randomUUID?.() || `s${Date.now()}`).replace(/-/g, "").slice(0, 16);
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `s${Date.now()}`;
  }
}

export async function postContextEvent(partial = {}) {
  const body = {
    session_id: sessionId(),
    source: partial.source || "sandbox-page",
    feature_id: partial.feature_id || "sandbox.ui.click",
    event_kind: partial.event_kind || "click",
    target_id: short(partial.target_id || "", 80),
    context: partial.context || {},
    edge_summary: String(partial.edge_summary || "").slice(0, 400),
    tool_summary: String(partial.tool_summary || "").slice(0, 400),
    token: CTXLOG1_TOKEN,
  };
  const res = await fetch("/api/sandbox/context-log", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (res && res.ok) return { ok: true, ...(await res.json().catch(() => ({}))) };
  // Fallback: existing XR note path (still compact).
  const noteRes = await fetch("/api/xr/control-config", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "note",
      feature: body.feature_id.slice(0, 32),
      ok: true,
      attempt: body.event_kind,
      note: `target=${body.target_id};${body.tool_summary || body.edge_summary}`.slice(0, 390),
      source: body.source,
    }),
  }).catch(() => null);
  return { ok: !!(noteRes && noteRes.ok), fallback: true, token: CTXLOG1_TOKEN };
}

export function createSandboxContextCapture({
  root = document,
  source = "sandbox-page",
  onStatus = () => {},
} = {}) {
  let active = false;
  let edges = new Map();
  let tools = new Map();
  let samples = 0;
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const ranked = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, c]) => `${k}:${c}`).join(",");

  const onClick = (event) => {
    if (!active) return;
    const target = event.target?.closest?.("button,a,[data-tool],[data-action],[data-sandbox-toggle],[data-repair-table-toggle],.sb-action,[role='tab']");
    if (!target) return;
    const id = short(target.id || target.dataset?.tool || target.dataset?.action || target.getAttribute?.("aria-label") || target.textContent);
    if (!id) return;
    bump(tools, id);
    samples += 1;
    onStatus(`Recording · ${tools.size} targets · ${samples} clicks`);
    void postContextEvent({
      source,
      feature_id: "sandbox.ui.click",
      event_kind: "click",
      target_id: id,
      context: {
        href: short(location.pathname, 80),
        role: short(target.getAttribute?.("role"), 24),
        xr: document.body.classList.contains("xr-presenting") ? "1" : "0",
      },
      tool_summary: ranked(tools),
    });
  };

  function start() {
    if (active) return;
    active = true;
    edges = new Map();
    tools = new Map();
    samples = 0;
    root.addEventListener("click", onClick, true);
    onStatus("Recording · click + context → jsonl/Supabase");
  }

  function stop() {
    if (!active) return;
    active = false;
    root.removeEventListener("click", onClick, true);
    void flush();
  }

  async function flush() {
    if (!tools.size && !edges.size) {
      onStatus("Capture off");
      return false;
    }
    const out = await postContextEvent({
      source,
      feature_id: "vr.reference",
      event_kind: "flush",
      target_id: "batch",
      edge_summary: ranked(edges),
      tool_summary: ranked(tools),
      context: { samples: String(samples), href: short(location.pathname, 80) },
    });
    tools = new Map();
    edges = new Map();
    samples = 0;
    onStatus(out.ok ? "Recorded compact reference (Supabase when configured)" : "Recording · save failed");
    return !!out.ok;
  }

  return {
    start,
    stop,
    flush,
    running: () => active,
    token: CTXLOG1_TOKEN,
    summary: () => ({ tools: Object.fromEntries(tools), edges: Object.fromEntries(edges), samples }),
  };
}
