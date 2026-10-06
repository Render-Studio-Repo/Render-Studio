/**
 * Sandbox ↔ DIMOS LAN link (IP save + probe). Shares Studio Preferences host.
 * Does not arm teleop or send joint commands from sandbox. Token dimoswire1.
 */

export const DIMOS_WIRE_TOKEN = "dimoswire1";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function authHeaders() {
  try {
    const mod = await import("../studio/auth.js?v=dimospf1");
    return mod.authHeaders?.() || {};
  } catch {
    return {};
  }
}

async function apiJson(path, opts = {}) {
  const headers = {
    Accept: "application/json",
    ...(opts.body ? { "Content-Type": "application/json" } : {}),
    ...(await authHeaders()),
    ...(opts.headers || {}),
  };
  const res = await fetch(path, { credentials: "same-origin", ...opts, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { detail: res.statusText || "bad response" };
  }
  if (!res.ok) {
    const err = new Error(typeof data?.detail === "string" ? data.detail : `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function pollCoordinatorUntilUp(setStatus, { tries = 8, ms = 900 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const data = await apiJson("/api/dimos/coordinator");
      if (data?.up || data?.listening) {
        setStatus(`Coordinator up · ${data.blueprint || "teleop"} · :${data.port || 8443}`);
        return data;
      }
      if (data?.process || data?.started || data?.status === "starting" || data?.status === "already_running") {
        setStatus(`Coordinator starting… (${i + 1}/${tries}) · ${data.blueprint || "teleop"}`);
      } else {
        setStatus(`Waiting for :${data?.port || 8443}… (${i + 1}/${tries})`);
      }
    } catch {
      setStatus(`Coordinator poll… (${i + 1}/${tries})`);
    }
    await new Promise((r) => setTimeout(r, ms));
  }
  return null;
}

export function dimosLinkMarkup({ host = "" } = {}) {
  return `
    <div class="sb-dimos-link" data-sb-dimos data-token="${DIMOS_WIRE_TOKEN}">
      <div class="sb-dimos-copy">
        <span class="sb-kicker">DIMOS · ROBOT PC</span>
        <p>Same DIMOS coordinator as Studio (<code>:8443</code>). Probe and status only — sandbox never arms joints or overlays Sam’s Y-engage HUD. Ensure starts the coordinator if it is down; it will not spawn a second :8443.</p>
      </div>
      <label class="sb-dimos-field">
        <span>Robot PC IP</span>
        <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
          placeholder="192.168.1.77" value="${escapeHtml(host)}" data-sb-dimos-host />
      </label>
      <div class="sb-dimos-actions">
        <button type="button" class="sb-agent-btn sb-agent-btn--astra" data-sb-dimos-connect>Save IP</button>
        <button type="button" class="sb-agent-btn" data-sb-dimos-probe>Probe</button>
        <button type="button" class="sb-agent-btn" data-sb-dimos-coord title="Local coordinator status">Coordinator</button>
        <button type="button" class="sb-agent-btn" data-sb-dimos-ensure title="Start local teleop coordinator if missing — reuses :8443 if already up">Keep coordinator</button>
        <a class="sb-teleop-expand" href="/api/dimos/ws" data-sb-dimos-pipe title="Studio pipe path">pipe ↗</a>
      </div>
      <p class="sb-dimos-status" data-sb-dimos-status role="status">Not linked</p>
    </div>
  `;
}

export async function bindDimosLink(root, { onStatus } = {}) {
  if (!root) return null;
  const hostInput = root.querySelector("[data-sb-dimos-host]");
  const statusEl = root.querySelector("[data-sb-dimos-status]");
  const pipeEl = root.querySelector("[data-sb-dimos-pipe]");
  const setStatus = (msg) => {
    if (statusEl && msg) statusEl.textContent = msg;
    onStatus?.(msg);
  };
  const closeViewport = () => {
    try { window.dispatchEvent(new CustomEvent("render3d-sandbox-close-viewport", { detail: { source: "dimos" } })); }
    catch { /* optional */ }
  };
  hostInput?.addEventListener("focus", closeViewport);

  const {
    resolveDimosWsUrl,
    persistDimosWsUrl,
    formatDimosHostInput,
    DIMOS_WS_DEFAULT,
  } = await import("../xr/xr-dimos-teleop.js?v=20260929-y-record1");

  const syncHostField = () => {
    const hostText = formatDimosHostInput(resolveDimosWsUrl());
    if (hostInput && document.activeElement !== hostInput) hostInput.value = hostText;
    if (pipeEl) {
      const up = resolveDimosWsUrl();
      pipeEl.href = `/api/dimos/ws?upstream=${encodeURIComponent(up)}`;
      pipeEl.textContent = "Studio pipe ↗";
    }
    return hostText;
  };

  const logLink = async (kind, extra = {}) => {
    try {
      const { postContextEvent } = await import("./sandbox-context-log.js?v=ctxlog1");
      await postContextEvent({
        source: "sandbox-dimos-link",
        feature_id: "sandbox.dimos.link",
        event_kind: kind,
        target_id: "dimos",
        context: { href: "/sandbox/", ...extra },
      });
    } catch { /* optional */ }
  };

  syncHostField();
  setStatus(`Host saved ${syncHostField()} · Quest controllers connect in headset capture`);

  root.querySelector("[data-sb-dimos-connect]")?.addEventListener("click", async () => {
    closeViewport();
    const raw = hostInput?.value?.trim() || formatDimosHostInput(DIMOS_WS_DEFAULT);
    try {
      root.querySelector("[data-sb-dimos-connect]")?.setAttribute("disabled", "true");
      setStatus(`Saving ${raw}…`);
      const next = persistDimosWsUrl(raw);
      const hostText = formatDimosHostInput(next);
      syncHostField();
      let probeNote = "";
      let probeOk = false;
      try {
        const data = await apiJson("/api/integrations/grok-bot/dimos", {
          method: "POST",
          body: JSON.stringify({ host: hostText, probe: true }),
        });
        probeOk = !!data?.probe?.ok;
        probeNote = probeOk
          ? ` · DIMOS reachable${data.probe.tcp_open ? " (TCP)" : ""}`
          : data?.probe?.error
            ? ` · DIMOS probe failed: ${String(data.probe.error).slice(0, 80)}`
            : " · DIMOS reachability unknown";
      } catch (err) {
        if (err?.status === 401) probeNote = " · sign in to sync and probe DIMOS";
        else probeNote = ` · DIMOS probe failed: ${String(err?.message || err).slice(0, 60)}`;
      }
      setStatus(`Host saved ${hostText}${probeNote} · Quest input separate`);
      await logLink("connect", { host: hostText, probe_ok: String(probeOk), controller_input: "not_tested" });
    } catch (err) {
      setStatus(`Connect failed · ${String(err?.message || err).slice(0, 80)}`);
    } finally {
      root.querySelector("[data-sb-dimos-connect]")?.removeAttribute("disabled");
    }
  });

  root.querySelector("[data-sb-dimos-probe]")?.addEventListener("click", async () => {
    closeViewport();
    const raw = hostInput?.value?.trim() || formatDimosHostInput(resolveDimosWsUrl());
    setStatus(`Probing ${raw}…`);
    try {
      const data = await apiJson("/api/integrations/grok-bot/dimos/probe", {
        method: "POST",
        body: JSON.stringify({ host: raw }),
      });
      if (data?.ok || data?.tcp_open) {
        setStatus(`Reachable ${data.host || raw}${data.http_reachable ? " · /teleop up" : " · TCP open"}`);
      } else {
        setStatus(`Unreachable · ${data?.error || "no response"}`);
      }
      await logLink("probe", { host: raw, ok: String(!!(data?.ok || data?.tcp_open)) });
    } catch (err) {
      if (err?.status === 401) setStatus("Sign in to probe from Studio → robot PC");
      else setStatus(`Probe failed · ${String(err?.message || err).slice(0, 80)}`);
    }
  });

  root.querySelector("[data-sb-dimos-coord]")?.addEventListener("click", async () => {
    setStatus("Checking local coordinator…");
    try {
      const data = await apiJson("/api/dimos/coordinator");
      const running = data?.up || data?.running || data?.ok || data?.listening;
      const detail = data?.detail || data?.status || data?.blueprint || "";
      setStatus(
        running
          ? `Coordinator up${detail ? ` · ${String(detail).slice(0, 60)}` : ""}`
          : `Coordinator down${detail ? ` · ${String(detail).slice(0, 60)}` : " — use Ensure / install"}`,
      );
      await logLink("coordinator", { running: String(!!running) });
    } catch (err) {
      setStatus(`Coordinator · ${String(err?.message || err).slice(0, 80)}`);
    }
  });

  root.querySelector("[data-sb-dimos-ensure]")?.addEventListener("click", async () => {
    closeViewport();
    setStatus("Ensuring local DIMOS coordinator (sandbox install)…");
    try {
      root.querySelector("[data-sb-dimos-ensure]")?.setAttribute("disabled", "true");
      // Persist host first so Studio pipe + probe share the same target.
      const raw = hostInput?.value?.trim();
      if (raw) {
        try { persistDimosWsUrl(raw); syncHostField(); } catch { /* optional */ }
      }
      const data = await apiJson("/api/dimos/ensure-coordinator", {
        method: "POST",
        body: JSON.stringify({ headset: "quest3", blueprint: "teleop-quest-openarm" }),
      });
      const up = !!(data?.up || data?.ok || data?.running || data?.started || data?.already || data?.status === "already_up" || data?.status === "starting" || data?.status === "already_running");
      const detail = data?.detail || data?.blueprint || data?.reason || data?.error || data?.status || "";
      const bin = data?.dimos_bin || data?.bin || "";
      if (!up) {
        setStatus(`Ensure failed · ${String(detail || "dimos bin missing — install integrations/dimos .venv").slice(0, 100)}`);
        await logLink("ensure", { up: "false", detail: String(detail).slice(0, 80) });
        return;
      }
      setStatus(
        `Ensure ok · ${String(detail || data?.status || "starting").slice(0, 50)}${bin ? ` · ${String(bin).slice(0, 40)}` : ""} — polling…`,
      );
      const ready = await pollCoordinatorUntilUp(setStatus);
      await logLink("ensure", {
        up: String(!!(ready?.up || data?.up)),
        detail: String(detail).slice(0, 80),
        polled: ready?.up ? "1" : "0",
      });
      if (!ready?.up) {
        setStatus(
          `DIMOS ensure accepted but :8443 not up yet · ${String(detail || "retry Probe / check robot PC").slice(0, 80)}`,
        );
      }
    } catch (err) {
      if (err?.status === 401) setStatus("Sign in to ensure DIMOS coordinator from sandbox");
      else setStatus(`Ensure failed · ${String(err?.message || err).slice(0, 80)}`);
    } finally {
      root.querySelector("[data-sb-dimos-ensure]")?.removeAttribute("disabled");
    }
  });

  return { syncHostField, setStatus };
}

export async function mountDimosLink(host, opts = {}) {
  if (!host) return null;
  let hostText = "192.168.1.77";
  try {
    const { resolveDimosWsUrl, formatDimosHostInput } = await import("../xr/xr-dimos-teleop.js?v=20260929-y-record1");
    hostText = formatDimosHostInput(resolveDimosWsUrl());
  } catch { /* default */ }
  host.insertAdjacentHTML("afterbegin", dimosLinkMarkup({ host: hostText }));
  const root = host.querySelector("[data-sb-dimos]");
  await bindDimosLink(root, opts);
  return root;
}
