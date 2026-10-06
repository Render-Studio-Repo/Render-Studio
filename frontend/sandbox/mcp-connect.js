/**
 * Sandbox MCP listen path — agents always listen here (no connect toggle).
 * Protected reset: confirm before muting writes. Token mcplisten1.
 */

export const MCPLISTEN1_TOKEN = "mcplisten1";
/** Kept for bridge + older keys. "0" = muted after protected reset; else listening. */
export const MCP_CONNECT_KEY = "render3d:sandboxMcpConnect";
export const MCP_CONNECT_EVENT = "render3d-mcp-connect";
/** Alias used by tests / docs. */
export const MCPCONN1_TOKEN = MCPLISTEN1_TOKEN;

export function mcpConnectChoice(storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(MCP_CONNECT_KEY);
  } catch {
    return null;
  }
}

/** Always listen unless explicitly muted ("0"). */
export function isMcpConnected(storage = globalThis.localStorage) {
  return mcpConnectChoice(storage) !== "0";
}

export function isMcpMuted(storage = globalThis.localStorage) {
  return mcpConnectChoice(storage) === "0";
}

export function setMcpConnected(on, storage = globalThis.localStorage) {
  const next = !!on;
  try {
    storage?.setItem?.(MCP_CONNECT_KEY, next ? "1" : "0");
  } catch { /* private mode */ }
  const detail = { connected: next, token: MCPLISTEN1_TOKEN, alwaysListen: true };
  try {
    window.dispatchEvent(new CustomEvent(MCP_CONNECT_EVENT, { detail }));
  } catch { /* node tests */ }
  try {
    window.postMessage({ type: "openarm-mcp-connect", on: next, token: MCPLISTEN1_TOKEN }, "*");
  } catch { /* optional */ }
  return next;
}

/** Protected reset — mute agent writes. Caller should confirm in UI. */
export function resetMcpListen(storage = globalThis.localStorage) {
  return setMcpConnected(false, storage);
}

export function resumeMcpListen(storage = globalThis.localStorage) {
  return setMcpConnected(true, storage);
}

export async function probeMcp() {
  const t = Date.now();
  const revRes = await fetch(`/mcp/sandbox/rev?t=${t}`).catch(() => null);
  if (!revRes || !revRes.ok) {
    return { ok: false, detail: "sandbox rev failed" };
  }
  const rev = await revRes.json().catch(() => ({}));
  return { ok: true, rev: String(rev.rev || "").slice(-10), detail: "sandbox MCP reachable" };
}

export function mcpConnectMarkup() {
  return `
    <div class="sb-mcp-connect sb-mcp-listen" data-sb-mcp data-token="${MCPLISTEN1_TOKEN}">
      <span class="sb-mcp-listen-pill" data-sb-mcp-pill aria-live="polite">Agents listening</span>
      <button type="button" class="sb-mcp-toggle sb-mcp-reset" data-sb-mcp-reset title="Protected: mute agent MCP writes after confirm">Reset listen</button>
      <button type="button" class="sb-mcp-toggle is-on" data-sb-mcp-resume hidden title="Resume always-listen">Resume</button>
      <span class="sb-mcp-status" data-sb-mcp-status role="status">MCP · always on</span>
    </div>
  `;
}

function paint(root, { connected, detail }) {
  const pill = root.querySelector("[data-sb-mcp-pill]");
  const reset = root.querySelector("[data-sb-mcp-reset]");
  const resume = root.querySelector("[data-sb-mcp-resume]");
  const status = root.querySelector("[data-sb-mcp-status]");
  if (pill) {
    pill.textContent = connected ? "Agents listening" : "Listen muted";
    pill.classList.toggle("is-muted", !connected);
  }
  if (reset) reset.hidden = !connected;
  if (resume) resume.hidden = !!connected;
  if (status) status.textContent = detail || (connected ? "MCP · always on · write feed live" : "MCP muted · protected reset");
}

export async function bindMcpConnect(root, { onChange } = {}) {
  if (!root) return null;
  const apply = (connected, detail) => {
    paint(root, { connected, detail });
    onChange?.(connected);
  };

  // Default: always listen (no toggle required).
  if (mcpConnectChoice() == null || isMcpConnected()) {
    setMcpConnected(true);
  }
  apply(isMcpConnected(), isMcpConnected() ? "MCP · always on" : "MCP muted");

  root.querySelector("[data-sb-mcp-reset]")?.addEventListener("click", () => {
    const ok = typeof window !== "undefined"
      && window.confirm(
        "Mute agent MCP listening?\n\nAgents will stop writing analysis / sandbox feeds until you Resume.\nThis is a protected reset.",
      );
    if (!ok) return;
    resetMcpListen();
    apply(false, "MCP muted · protected reset");
  });

  root.querySelector("[data-sb-mcp-resume]")?.addEventListener("click", async () => {
    apply(false, "Probing /mcp/sandbox…");
    const probe = await probeMcp();
    if (!probe.ok) {
      apply(false, `Still muted · ${probe.detail}`);
      return;
    }
    resumeMcpListen();
    apply(true, `MCP · always on${probe.rev ? ` · rev ${probe.rev}` : ""}`);
  });

  window.addEventListener(MCP_CONNECT_EVENT, (ev) => {
    const connected = !!ev?.detail?.connected;
    apply(connected, connected ? "MCP · always on" : "MCP muted");
  });

  // Keep listen warm: probe and force on if never muted.
  if (isMcpConnected()) {
    const probe = await probeMcp().catch(() => ({ ok: false }));
    if (probe.ok) {
      setMcpConnected(true);
      apply(true, `MCP · always on${probe.rev ? ` · rev ${probe.rev}` : ""}`);
    } else {
      apply(true, "MCP · listening (probe weak — still open)");
    }
  }

  return { isConnected: isMcpConnected, setConnected: setMcpConnected, reset: resetMcpListen, resume: resumeMcpListen };
}

export async function mountMcpConnect(host, opts = {}) {
  if (!host) return null;
  host.insertAdjacentHTML("beforeend", mcpConnectMarkup());
  const root = host.querySelector("[data-sb-mcp]");
  await bindMcpConnect(root, opts);
  return root;
}
