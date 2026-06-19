/** Client + server activity trace panel */

const LOCAL_MAX = 40;
const DISPLAY_MAX = 25;

export function createActivityLog(container, fetchFn = fetch) {
  const wrap = document.createElement("section");
  wrap.className = "activity-log-section";
  wrap.innerHTML = `
    <div class="activity-log-header">
      <div class="activity-log-actions">
        <button type="button" id="btn-log-refresh" class="btn secondary small-btn">Refresh</button>
        <button type="button" id="btn-log-clear" class="btn secondary small-btn">Clear</button>
      </div>
      <button type="button" id="btn-log-collapse" class="btn-collapse" title="Hide activity log" aria-label="Toggle activity log" aria-pressed="false"><span style="font-size:1em">▼</span> Activity log</button>
    </div>
    <div id="activity-log-list" class="activity-log-list"></div>
    <div id="activity-log-footer" class="activity-log-footer"></div>
  `;
  container.appendChild(wrap);

  const listEl = wrap.querySelector("#activity-log-list");
  const footerEl = wrap.querySelector("#activity-log-footer");

  function formatTime(isoOrDate) {
    const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function renderEntry(entry, expanded = false) {
    const el = document.createElement("div");
    el.className = `log-entry log-${entry.level || "info"}`;
    const dataStr = entry.data && Object.keys(entry.data).length
      ? JSON.stringify(entry.data, null, 2)
      : entry.body || entry.response || "";
    const trace = entry.trace_id ? `<span class="log-trace">#${entry.trace_id}</span>` : "";
    el.innerHTML = `
      <div class="log-line">
        <span class="log-time">${formatTime(entry.ts || entry.time || Date.now())}</span>
        <span class="log-level">${(entry.level || "info").toUpperCase()}</span>
        ${trace}
        <span class="log-msg">${escapeHtml(entry.message || entry.method + " " + entry.path || "")}</span>
        ${entry.duration_ms != null ? `<span class="log-ms">${Math.round(entry.duration_ms)}ms</span>` : ""}
        ${entry.status != null ? `<span class="log-status">${entry.status}</span>` : ""}
      </div>
      ${dataStr ? `<pre class="log-detail${expanded ? " open" : ""}">${escapeHtml(typeof dataStr === "string" ? dataStr : JSON.stringify(dataStr, null, 2))}</pre>` : ""}
    `;
    if (dataStr) {
      el.querySelector(".log-line").style.cursor = "pointer";
      el.querySelector(".log-line").addEventListener("click", () => {
        el.querySelector(".log-detail")?.classList.toggle("open");
      });
    }
    return el;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  const localEntries = [];
  let refreshTimer = null;

  function trimLocal() {
    while (localEntries.length > LOCAL_MAX) localEntries.pop();
  }

  function push(entry) {
    localEntries.unshift({ ...entry, ts: entry.ts || new Date().toISOString() });
    trimLocal();
    render();
  }

  function render(mergeServer = []) {
    const combined = [];
    const seen = new Set();
    for (const e of [...localEntries, ...mergeServer]) {
      const key = e.id || `${e.ts}-${e.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(e);
    }
    combined.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const shown = combined.slice(0, DISPLAY_MAX);
    const dropped = combined.length - shown.length;

    listEl.innerHTML = "";
    if (!shown.length) {
      listEl.innerHTML = '<p class="muted small">API calls and AI responses appear here.</p>';
      if (footerEl) footerEl.textContent = "";
      return;
    }
    for (const e of shown) {
      listEl.appendChild(renderEntry(e, e.level === "error"));
    }
    if (footerEl) {
      footerEl.textContent = dropped > 0
        ? `Showing ${shown.length} · ${dropped} older hidden`
        : `${shown.length} entr${shown.length === 1 ? "y" : "ies"}`;
    }
  }

  async function refreshServer() {
    try {
      const res = await fetchFn("/api/logs?limit=30");
      const data = await res.json();
      render(data.entries || []);
    } catch (err) {
      push({ level: "error", message: `Failed to load server logs: ${err.message}` });
    }
  }

  function refreshServerDebounced() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshServer(), 400);
  }

  wrap.querySelector("#btn-log-refresh").addEventListener("click", () => refreshServer());
  wrap.querySelector("#btn-log-clear").addEventListener("click", async () => {
    localEntries.length = 0;
    try {
      await fetchFn("/api/logs", { method: "DELETE" });
    } catch (_) {}
    render();
  });

  return { push, render, refreshServer, refreshServerDebounced, el: wrap };
}
