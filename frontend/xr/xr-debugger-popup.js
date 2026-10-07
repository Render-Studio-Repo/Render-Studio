/**
 * Desktop XR Controls log popup — recording-style, last 5 logs, download.
 * Reuses /api/xr/debugger/logs and *-xr-ctl.jsonl. No screenshots.
 */

export const XR_DEBUGGER_POPUP_ID = "xr-debugger-log-modal";
export const XR_DEBUGGER_LOG_EVENT = "render3d:xr-debugger-log";
export const XR_DEBUGGER_SEEN_KEY = "render3d:xrDebuggerSeen";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Compact JSONL for clipboard / Load restore — one object per line, not a screenshot. */
export function compactXrDebuggerJsonl(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}

export async function copyXrDebuggerLogToClipboard(text) {
  const value = String(text ?? "");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through to execCommand */
    }
  }
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export function formatXrDebuggerLogText(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  const extra = payload.extra && typeof payload.extra === "object" ? payload.extra : {};
  const controls = payload.controls && typeof payload.controls === "object" ? payload.controls : payload;
  const rows = Array.isArray(controls.rows) ? controls.rows : Array.isArray(payload.rows) ? payload.rows : [];
  const ev = Array.isArray(controls.ev) ? controls.ev : Array.isArray(payload.ev) ? payload.ev : [];
  const spikes = Array.isArray(payload.spikes) ? payload.spikes : Array.isArray(extra.spikes) ? extra.spikes : [];
  const tag = debuggerLogTag(payload, payload);
  const lines = [];
  if (payload.filename || payload.description || tag) {
    lines.push(JSON.stringify({
      filename: payload.filename || extra.filename || "",
      description: payload.description || extra.description || "",
      timestamp: payload.timestamp || extra.timestamp || "",
      tag,
    }));
  }
  const perf = {
    avgMs: payload.avgMs ?? extra.avgMs,
    p95Ms: payload.p95Ms ?? extra.p95Ms,
    n: payload.n ?? extra.n,
    memMb: payload.memMb ?? extra.memMb,
    hitchCount: payload.hitchCount ?? extra.hitchCount,
    maxDt: payload.maxDt ?? extra.maxDt,
    framebufferScale: payload.framebufferScale ?? extra.framebufferScale,
    foveation: payload.foveation ?? extra.foveation,
    hudScale: payload.hudScale ?? extra.hudScale,
    presenting: payload.presenting ?? extra.presenting,
    laser: payload.laser ?? extra.laser ?? controls?.ov?.l,
    durationMs: payload.durationMs ?? extra.durationMs ?? controls?.durationMs,
  };
  if (Object.values(perf).some((v) => v != null && v !== "")) {
    lines.push(JSON.stringify(perf));
  }
  const trace = debuggerSpikeTraceText(payload);
  if (tag === "spike" && trace) lines.push(JSON.stringify({ spikeTrace: trace }));
  for (const row of spikes.slice(-24)) lines.push(JSON.stringify({ spike: row }));
  for (const row of ev.slice(-24)) lines.push(JSON.stringify(row));
  for (const row of rows.slice(-80)) lines.push(JSON.stringify(row));
  return lines.join("\n");
}

/** Popup / Foundry last-5: stick-hold Send only — never auto session dumps. */
export function xrDebuggerLogIsManual(row = {}) {
  if (!row || typeof row !== "object") return false;
  if (row.auto === true) return false;
  const name = String(row.name || "");
  const desc = String(row.description || "");
  if (/auto perf/i.test(desc)) return false;
  return /xr-ctl/i.test(name) || /XR debugger session|XR Controls debug/i.test(desc);
}

export function isDesktopDebuggerLog(row = {}) {
  if (!row || typeof row !== "object") return false;
  if (row.auto === true) return false;
  const name = String(row.name || "");
  const desc = String(row.description || "");
  const kind = String(row.kind || "");
  return /desk-dbg/i.test(name) || kind === "desktop-perf" || /Desktop debugger session/i.test(desc);
}

export function debuggerLogTag(row = {}, payload = null) {
  const src = payload && typeof payload === "object" ? payload : {};
  const explicit = String(row?.tag || src.tag || "").toLowerCase();
  if (explicit === "spike" || explicit === "normal") return explicit;
  const hitch = Number(row?.hitchCount ?? src.hitchCount ?? 0);
  const spikes = Array.isArray(src.spikes) ? src.spikes : Array.isArray(row?.spikes) ? row.spikes : [];
  if (hitch > 0 || spikes.length) return "spike";
  return "normal";
}

export function debuggerSpikeTraceText(payload = null) {
  const src = payload && typeof payload === "object" ? payload : {};
  if (src.spikeTrace) return String(src.spikeTrace).slice(0, 800);
  const spikes = Array.isArray(src.spikes) ? src.spikes : [];
  return spikes.map((row) => {
    const where = String(row?.where || row?.scope || "").trim();
    const stack = String(row?.stack || row?.trace || "").trim();
    const click = String(row?.lastClick || "").trim();
    return [
      `${Math.round(Number(row?.t) || 0)}ms`,
      Number.isFinite(Number(row?.dt)) ? `dt=${row.dt}` : "",
      Number.isFinite(Number(row?.cpu)) ? `cpu=${row.cpu}` : "",
      Number.isFinite(Number(row?.memMb)) ? `ram=${row.memMb}MB` : "",
      where,
      click && click !== where ? `click=${click}` : "",
      stack,
    ].filter(Boolean).join(" ");
  }).filter(Boolean).join("\n").slice(0, 800);
}

export function formatDebuggerLogTime(iso) {
  const raw = String(iso || "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return raw;
  try {
    return d.toLocaleString();
  } catch {
    return raw;
  }
}

export function recentXrDebuggerLogs(list = [], limit = 5) {
  const rows = Array.isArray(list) ? list : [];
  return rows.filter((n) => xrDebuggerLogIsManual(n)).slice(0, limit);
}

export function recentDesktopDebuggerLogs(list = [], limit = 5) {
  const rows = Array.isArray(list) ? list : [];
  return rows.filter((n) => isDesktopDebuggerLog(n)).slice(0, limit);
}

export function recentManualDebuggerLogs(list = [], limit = 5) {
  const rows = Array.isArray(list) ? list : [];
  return rows.filter((n) => xrDebuggerLogIsManual(n) || isDesktopDebuggerLog(n)).slice(0, limit);
}

function recentRowHtml(row) {
  const tag = debuggerLogTag(row);
  const ts = formatDebuggerLogTime(row.timestamp || row.mtime);
  const trace = tag === "spike" ? String(row.spikeTrace || "").trim() : "";
  return `<li class="xr-dbg-recent-row">
    <div class="xr-dbg-recent-meta">
      <button type="button" class="btn secondary btn-compact xr-dbg-recent-name" data-xr-dbg-pick="${esc(row.name)}">${esc(row.name)}</button>
      <span class="dbg-log-tag dbg-log-tag--${tag}">${tag}</span>
      <span class="muted small xr-dbg-recent-time">${esc(ts)}</span>
    </div>
    ${trace ? `<pre class="xr-dbg-where">${esc(trace)}</pre>` : ""}
  </li>`;
}

export function xrDebuggerPopupHtml({
  name = "",
  text = "",
  recent = [],
  payload = null,
  title = "XR Controls log",
} = {}) {
  const rec = recentManualDebuggerLogs(recent, 5);
  const tag = debuggerLogTag(rowFromPayload(name, payload), payload);
  const trace = tag === "spike" ? debuggerSpikeTraceText(payload) : "";
  return `<div class="auth-backdrop" data-xr-dbg-dismiss></div>
    <div class="auth-card record-done-hint-card xr-dbg-card" role="document">
      <div class="record-done-hint-head">
        <img class="record-done-hint-logo" src="/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1" alt="" width="40" height="40" />
        <div class="record-done-hint-heading">
          <h2 id="xr-debugger-log-title">${esc(title)}</h2>
          <p>${esc(name || "Compact JSONL · no screenshots")} <span class="dbg-log-tag dbg-log-tag--${tag}">${tag}</span></p>
        </div>
        <button type="button" class="auth-close" data-xr-dbg-dismiss aria-label="Close">&times;</button>
      </div>
      ${trace ? `<pre class="xr-dbg-trace" id="xr-dbg-trace-body">${esc(trace)}</pre>` : ""}
      <pre class="xr-dbg-log" id="xr-dbg-log-body">${esc(text)}</pre>
      <div class="record-done-hint-actions">
        <button type="button" class="btn secondary" data-xr-dbg-load>Load</button>
        <button type="button" class="btn secondary" data-xr-dbg-copy>Copy</button>
        <input type="file" accept=".jsonl,.json,application/jsonl,application/json,text/plain" hidden data-xr-dbg-file />
        <button type="button" class="btn accent" data-xr-dbg-download>Download log</button>
        <button type="button" class="btn secondary" data-xr-dbg-dismiss>Dismiss</button>
      </div>
      <div class="xr-dbg-recent">
        <p class="muted small">Last 5 logs</p>
        <ul>
          ${rec.map((row) => recentRowHtml(row)).join("") || "<li class=\"muted small\">No earlier logs</li>"}
        </ul>
      </div>
    </div>`;
}

function rowFromPayload(name, payload) {
  if (!payload || typeof payload !== "object") return { name };
  return {
    name: name || payload.filename || "",
    hitchCount: payload.hitchCount,
    tag: payload.tag,
    spikes: payload.spikes,
    kind: payload.kind,
    description: payload.description,
  };
}

export function readSeenXrDebuggerName() {
  try { return String(localStorage.getItem(XR_DEBUGGER_SEEN_KEY) || ""); } catch { return ""; }
}

export function writeSeenXrDebuggerName(name) {
  try { localStorage.setItem(XR_DEBUGGER_SEEN_KEY, String(name || "")); } catch { /* ignore */ }
}

export function openXrDebuggerLogPopup({
  name = "",
  text = "",
  recent = [],
  payload = null,
  title = "XR Controls log",
  onDownload,
  onPickRecent,
  onLoad,
} = {}) {
  if (typeof document === "undefined") return null;
  let el = document.getElementById(XR_DEBUGGER_POPUP_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = XR_DEBUGGER_POPUP_ID;
    el.className = "auth-modal r3d-record-done xr-dbg-modal hidden";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "xr-debugger-log-title");
    document.body.appendChild(el);
  }
  const body = text || compactXrDebuggerJsonl(payload) || formatXrDebuggerLogText(payload);
  el.innerHTML = xrDebuggerPopupHtml({ name, text: body, recent, payload, title });
  el.classList.remove("hidden");
  writeSeenXrDebuggerName(name);
  el.querySelectorAll("[data-xr-dbg-dismiss]").forEach((btn) => {
    btn.addEventListener("click", () => el.classList.add("hidden"));
  });
  el.querySelector("[data-xr-dbg-download]")?.addEventListener("click", () => {
    if (typeof onDownload === "function") {
      onDownload(name, body);
      return;
    }
    const blob = new Blob([body], { type: "application/jsonl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name || "last-xr-ctl.jsonl";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 800);
  });
  const copyBtn = el.querySelector("[data-xr-dbg-copy]");
  copyBtn?.addEventListener("click", () => {
    void copyXrDebuggerLogToClipboard(body).then((ok) => {
      if (!copyBtn) return;
      const prev = copyBtn.textContent;
      copyBtn.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(() => {
        copyBtn.textContent = prev;
      }, 1400);
    });
  });
  const fileEl = el.querySelector("[data-xr-dbg-file]");
  el.querySelector("[data-xr-dbg-load]")?.addEventListener("click", () => fileEl?.click());
  fileEl?.addEventListener("change", () => {
    const file = fileEl.files?.[0];
    fileEl.value = "";
    if (!file) return;
    void file.text().then((loaded) => {
      const nextName = file.name || name || "loaded-xr-ctl.jsonl";
      if (typeof onLoad === "function") {
        onLoad(nextName, loaded);
        return;
      }
      openXrDebuggerLogPopup({
        name: nextName,
        text: loaded,
        recent,
        payload,
        title,
        onDownload,
        onPickRecent,
        onLoad,
      });
    });
  });
  el.querySelectorAll("[data-xr-dbg-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pick = btn.getAttribute("data-xr-dbg-pick") || "";
      onPickRecent?.(pick);
    });
  });
  return el;
}
