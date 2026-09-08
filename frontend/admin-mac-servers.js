/**
 * Management → Servers — live Mac/host performance + Cursor ops prompt bridge.
 */

const POLL_MS = 3000;
const DEEPLINK_SOFT_LIMIT = 7000;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 10) / 10}%`;
}

function num(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function bar(value, kind = "cpu") {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = n >= 85 ? "crit" : n >= 65 ? "warn" : "ok";
  return `
    <div class="macmon-bar macmon-bar--${esc(kind)} macmon-bar--${tone}" title="${esc(pct(n))}">
      <span style="width:${n}%"></span>
    </div>
  `;
}

function onlinePill(server) {
  if (server?.is_local || server?.online) {
    return `<span class="macmon-pill macmon-pill--on">Live</span>`;
  }
  const age = server?.age_seconds;
  const label = age == null ? "Offline" : `Stale ${Math.round(age)}s`;
  return `<span class="macmon-pill macmon-pill--off">${esc(label)}</span>`;
}

export function adminMacServersSectionHtml() {
  return `
    <section class="admin-panel admin-panel--macmon" id="admin-section-servers" data-admin-section="servers">
      <div class="admin-agent-head">
        <div>
          <h3>Servers</h3>
          <p class="muted small admin-panel-hint">
            Live CPU / memory and top processes for the Studio host and your Mac agents.
            Draft a Cursor prompt (BYOK or platform key) and open it in your Cursor workspace.
          </p>
        </div>
        <div class="macmon-head-actions">
          <button type="button" class="btn secondary btn-compact" id="macmon-refresh">Refresh</button>
          <button type="button" class="btn primary btn-compact" id="macmon-register">Add Mac server</button>
        </div>
      </div>

      <div class="macmon-layout">
        <aside class="macmon-list" id="macmon-server-list" aria-label="Servers">
          <p class="muted small">Loading servers…</p>
        </aside>

        <div class="macmon-main" id="macmon-main">
          <p class="muted small">Select a server to watch live load and processes.</p>
        </div>
      </div>

      <div class="macmon-token-banner hidden" id="macmon-token-banner" role="status"></div>
    </section>
  `;
}

export function createMacServersMonitor({ api, onStatus = null } = {}) {
  let root = null;
  let servers = [];
  let selectedId = null;
  let pollTimer = null;
  let aiKeys = [];
  let lastPrompt = "";
  let busy = false;

  function selected() {
    return servers.find((s) => s.id === selectedId) || servers[0] || null;
  }

  async function loadKeys() {
    try {
      const data = await api("/api/user/ai-keys");
      aiKeys = Array.isArray(data.keys) ? data.keys : Array.isArray(data?.ai?.keys) ? data.ai.keys : [];
      if (!aiKeys.length && Array.isArray(data?.personal)) aiKeys = data.personal;
    } catch {
      aiKeys = [];
    }
  }

  function keyOptionsHtml() {
    const opts = [
      `<option value="platform:openai">Platform OpenAI (credits / sub)</option>`,
      `<option value="platform:anthropic">Platform Anthropic</option>`,
    ];
    for (const key of aiKeys) {
      const id = key.id || key.key_id;
      if (!id) continue;
      const source = key.source || "personal";
      const label = `${key.name || key.label || "Key"} · ${key.provider || "openai"} (${source})`;
      opts.push(`<option value="${esc(source)}:${esc(id)}">${esc(label)}</option>`);
    }
    return opts.join("");
  }

  function renderList() {
    const host = root?.querySelector("#macmon-server-list");
    if (!host) return;
    if (!servers.length) {
      host.innerHTML = `<p class="muted small">No servers yet. Studio host should appear automatically.</p>`;
      return;
    }
    host.innerHTML = servers
      .map((s) => {
        const latest = s.latest || {};
        const active = s.id === selectedId ? " active" : "";
        return `
          <button type="button" class="macmon-server-card${active}" data-macmon-id="${esc(s.id)}">
            <div class="macmon-server-card-top">
              <strong>${esc(s.name || s.hostname || "Server")}</strong>
              ${onlinePill(s)}
            </div>
            <span class="muted small">${esc(s.hostname || s.platform || "")}</span>
            <div class="macmon-mini-metrics">
              <span>CPU ${esc(pct(latest.cpu_percent))}</span>
              <span>RAM ${esc(pct(latest.mem_percent))}</span>
            </div>
            ${bar(latest.cpu_percent, "cpu")}
          </button>
        `;
      })
      .join("");
    host.querySelectorAll("[data-macmon-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedId = btn.getAttribute("data-macmon-id");
        renderMain();
        renderList();
      });
    });
  }

  function processRows(processes = []) {
    if (!processes.length) return `<p class="muted small">No process samples yet.</p>`;
    return `
      <div class="macmon-proc-table" role="table">
        <div class="macmon-proc-head" role="row">
          <span>Process</span><span>CPU</span><span>Mem</span><span>PID</span>
        </div>
        ${processes
          .slice(0, 28)
          .map((p) => {
            const title = p.command || p.name || "process";
            return `
              <div class="macmon-proc-row" role="row" title="${esc(title)}">
                <span class="macmon-proc-name">
                  <strong>${esc(p.name || "process")}</strong>
                  <em>${esc(p.user || "")}</em>
                </span>
                <span>${esc(pct(p.cpu_percent))}${bar(p.cpu_percent, "cpu")}</span>
                <span>${esc(pct(p.mem_percent))}${bar(p.mem_percent, "mem")}</span>
                <span class="muted">${esc(p.pid || "—")}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function readFormState() {
    return {
      focus: root?.querySelector("#macmon-focus")?.value || "",
      extra: root?.querySelector("#macmon-extra")?.value || "",
      useAi: root?.querySelector("#macmon-use-ai")?.checked ?? true,
      aiKey: root?.querySelector("#macmon-ai-key")?.value || "",
    };
  }

  function renderMain({ preserveForm = false } = {}) {
    const host = root?.querySelector("#macmon-main");
    const server = selected();
    if (!host) return;
    if (!server) {
      host.innerHTML = `<p class="muted small">Select a server.</p>`;
      return;
    }
    const form = preserveForm ? readFormState() : { focus: "", extra: "", useAi: true, aiKey: "" };
    selectedId = server.id;
    const latest = server.latest || {};
    const canDelete = !server.is_local && server.kind !== "studio";
    const activeEl = document.activeElement;
    const activeId = activeEl?.id || "";
    const selStart = typeof activeEl?.selectionStart === "number" ? activeEl.selectionStart : null;
    const selEnd = typeof activeEl?.selectionEnd === "number" ? activeEl.selectionEnd : null;

    host.innerHTML = `
      <div class="macmon-detail-head">
        <div>
          <h4>${esc(server.name || "Server")}</h4>
          <p class="muted small">
            ${esc(server.hostname || "—")} · ${esc(server.platform || "—")}
            ${server.arch || latest.arch ? ` · ${esc(server.arch || latest.arch)}` : ""}
            · sampled ${esc(latest.collected_at || server.last_seen_at || "—")}
          </p>
        </div>
        <div class="macmon-detail-actions">
          ${onlinePill(server)}
          ${
            canDelete
              ? `<button type="button" class="btn secondary btn-compact" id="macmon-rotate">Rotate token</button>
                 <button type="button" class="btn secondary btn-compact" id="macmon-delete">Remove</button>`
              : ""
          }
        </div>
      </div>

      <div class="macmon-stats">
        <article><span>CPU</span><strong>${esc(pct(latest.cpu_percent))}</strong>${bar(latest.cpu_percent)}</article>
        <article><span>Memory</span><strong>${esc(pct(latest.mem_percent))}</strong>
          <em class="muted small">${esc(num(latest.mem_used_mb, 0))} / ${esc(num(latest.mem_total_mb, 0))} MB</em>
          ${bar(latest.mem_percent, "mem")}
        </article>
        <article><span>Load</span><strong>${esc(num(latest.load1, 2))}</strong>
          <em class="muted small">${esc(num(latest.load5, 2))} / ${esc(num(latest.load15, 2))}</em>
        </article>
        <article><span>Disk</span><strong>${esc(pct(latest.disk_percent))}</strong>
          <em class="muted small">${esc(num(latest.disk_used_gb, 1))} / ${esc(num(latest.disk_total_gb, 1))} GB</em>
        </article>
      </div>

      <div class="macmon-grid">
        <div class="macmon-panel">
          <div class="macmon-panel-head">
            <h5>Live processes</h5>
            <span class="muted small">Sorted by CPU · updates ~${POLL_MS / 1000}s</span>
          </div>
          ${processRows(latest.processes || [])}
        </div>

        <div class="macmon-panel macmon-panel--prompt">
          <div class="macmon-panel-head">
            <h5>Cursor ops prompt</h5>
            <span class="muted small">Uses your OpenAI/Anthropic key or platform credits</span>
          </div>
          <label class="macmon-label">Focus
            <textarea id="macmon-focus" rows="2" placeholder="e.g. uvicorn worker pegged at 100% after Fusion export">${esc(form.focus)}</textarea>
          </label>
          <label class="macmon-label">Extra context
            <textarea id="macmon-extra" rows="2" placeholder="Optional notes, journalctl snippets, project ids…">${esc(form.extra)}</textarea>
          </label>
          <div class="macmon-prompt-row">
            <label class="macmon-label">AI key
              <select id="macmon-ai-key">${keyOptionsHtml()}</select>
            </label>
            <label class="macmon-check">
              <input type="checkbox" id="macmon-use-ai" ${form.useAi ? "checked" : ""} />
              Refine with AI
            </label>
          </div>
          <div class="macmon-prompt-actions">
            <button type="button" class="btn primary btn-compact" id="macmon-build-prompt">Build prompt</button>
            <button type="button" class="btn secondary btn-compact" id="macmon-copy-prompt" ${lastPrompt ? "" : "disabled"}>Copy</button>
            <a class="btn secondary btn-compact macmon-open-cursor ${lastPrompt ? "" : "disabled"}" id="macmon-open-cursor" href="#" target="_blank" rel="noopener">Open in Cursor</a>
          </div>
          <textarea id="macmon-prompt-out" class="macmon-prompt-out" rows="10" readonly placeholder="Generated Cursor prompt appears here…"></textarea>
          <p class="muted small" id="macmon-prompt-meta"></p>
        </div>
      </div>

      ${
        latest.logs
          ? `<details class="macmon-logs"><summary>Attached log snippet</summary><pre>${esc(latest.logs)}</pre></details>`
          : ""
      }
    `;

    const keySelect = host.querySelector("#macmon-ai-key");
    if (keySelect && form.aiKey) {
      keySelect.value = form.aiKey;
      if (keySelect.value !== form.aiKey && keySelect.options.length) {
        keySelect.selectedIndex = 0;
      }
    }
    host.querySelector("#macmon-delete")?.addEventListener("click", () => void removeServer(server.id));
    host.querySelector("#macmon-rotate")?.addEventListener("click", () => void rotateToken(server.id));
    host.querySelector("#macmon-build-prompt")?.addEventListener("click", () => void buildPrompt(server.id));
    host.querySelector("#macmon-copy-prompt")?.addEventListener("click", () => void copyPrompt());
    const out = host.querySelector("#macmon-prompt-out");
    if (out && lastPrompt) out.value = lastPrompt;
    if (activeId) {
      const el = host.querySelector(`#${CSS.escape(activeId)}`);
      if (el && typeof el.focus === "function") {
        el.focus();
        if (selStart != null && typeof el.setSelectionRange === "function") {
          try {
            el.setSelectionRange(selStart, selEnd ?? selStart);
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  function showTokenBanner(server) {
    const el = root?.querySelector("#macmon-token-banner");
    if (!el || !server?.ingest_token) return;
    el.classList.remove("hidden");
    el.innerHTML = `
      <strong>Agent token for ${esc(server.name)}</strong>
      <p class="muted small">Copy now — it is shown once. Run on the Mac:</p>
      <pre>${esc(server.agent_command || "")}</pre>
      <div class="macmon-prompt-actions">
        <button type="button" class="btn secondary btn-compact" id="macmon-copy-token">Copy token</button>
        <button type="button" class="btn secondary btn-compact" id="macmon-copy-cmd">Copy command</button>
        <button type="button" class="btn secondary btn-compact" id="macmon-dismiss-token">Dismiss</button>
      </div>
    `;
    el.querySelector("#macmon-copy-token")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(server.ingest_token);
        onStatus?.("ok", "Ingest token copied");
      } catch {
        onStatus?.("error", "Could not copy token");
      }
    });
    el.querySelector("#macmon-copy-cmd")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(server.agent_command || "");
        onStatus?.("ok", "Agent command copied");
      } catch {
        onStatus?.("error", "Could not copy command");
      }
    });
    el.querySelector("#macmon-dismiss-token")?.addEventListener("click", () => el.classList.add("hidden"));
  }

  function updateLiveParts(server) {
    if (!root || !server) return;
    const latest = server.latest || {};
    const stats = root.querySelector(".macmon-stats");
    if (stats) {
      stats.innerHTML = `
        <article><span>CPU</span><strong>${esc(pct(latest.cpu_percent))}</strong>${bar(latest.cpu_percent)}</article>
        <article><span>Memory</span><strong>${esc(pct(latest.mem_percent))}</strong>
          <em class="muted small">${esc(num(latest.mem_used_mb, 0))} / ${esc(num(latest.mem_total_mb, 0))} MB</em>
          ${bar(latest.mem_percent, "mem")}
        </article>
        <article><span>Load</span><strong>${esc(num(latest.load1, 2))}</strong>
          <em class="muted small">${esc(num(latest.load5, 2))} / ${esc(num(latest.load15, 2))}</em>
        </article>
        <article><span>Disk</span><strong>${esc(pct(latest.disk_percent))}</strong>
          <em class="muted small">${esc(num(latest.disk_used_gb, 1))} / ${esc(num(latest.disk_total_gb, 1))} GB</em>
        </article>
      `;
    }
    const procHost = root.querySelector(".macmon-panel .macmon-proc-table")?.parentElement;
    if (procHost) {
      const head = procHost.querySelector(".macmon-panel-head");
      const headHtml = head ? head.outerHTML : "";
      procHost.innerHTML = `${headHtml}${processRows(latest.processes || [])}`;
    }
    const sampled = root.querySelector(".macmon-detail-head .muted.small");
    if (sampled) {
      sampled.textContent = `${server.hostname || "—"} · ${server.platform || "—"}${
        server.arch || latest.arch ? ` · ${server.arch || latest.arch}` : ""
      } · sampled ${latest.collected_at || server.last_seen_at || "—"}`;
    }
  }

  async function refresh({ preserveForm = true } = {}) {
    if (!root || busy) return;
    try {
      const data = await api("/api/admin/mac-servers");
      servers = Array.isArray(data.servers) ? data.servers : [];
      if (!selectedId || !servers.some((s) => s.id === selectedId)) {
        selectedId = servers[0]?.id || null;
      }
      renderList();
      const server = selected();
      const mainReady = !!root.querySelector("#macmon-prompt-out");
      if (preserveForm && mainReady && server) {
        updateLiveParts(server);
      } else {
        renderMain({ preserveForm });
      }
    } catch (err) {
      const list = root.querySelector("#macmon-server-list");
      if (list) list.innerHTML = `<p class="status error">${esc(err?.message || "Could not load servers")}</p>`;
    }
  }

  async function registerServer() {
    const name = window.prompt("Name for this Mac server", "Mac mini");
    if (!name || !name.trim()) return;
    try {
      const data = await api("/api/admin/mac-servers", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), platform: "darwin" }),
      });
      const server = data.server || {};
      selectedId = server.id;
      showTokenBanner(server);
      onStatus?.("ok", "Mac server registered — copy the agent command");
      await refresh();
    } catch (err) {
      onStatus?.("error", err?.message || "Could not register server");
    }
  }

  async function removeServer(id) {
    if (!window.confirm("Remove this Mac server registration?")) return;
    try {
      await api(`/api/admin/mac-servers/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (selectedId === id) selectedId = null;
      await refresh();
    } catch (err) {
      onStatus?.("error", err?.message || "Could not remove server");
    }
  }

  async function rotateToken(id) {
    if (!window.confirm("Rotate ingest token? The old agent token will stop working.")) return;
    try {
      const data = await api(`/api/admin/mac-servers/${encodeURIComponent(id)}/rotate-token`, { method: "POST" });
      showTokenBanner(data.server || {});
      onStatus?.("ok", "New ingest token issued");
    } catch (err) {
      onStatus?.("error", err?.message || "Could not rotate token");
    }
  }

  function parseKeySelection(raw) {
    const value = String(raw || "");
    const idx = value.indexOf(":");
    if (idx < 0) return { ai_key_source: "platform", ai_key_id: "openai" };
    return {
      ai_key_source: value.slice(0, idx) || "platform",
      ai_key_id: value.slice(idx + 1) || "openai",
    };
  }

  function applyPromptResult(data) {
    lastPrompt = String(data.prompt || "");
    const out = root?.querySelector("#macmon-prompt-out");
    const meta = root?.querySelector("#macmon-prompt-meta");
    const copyBtn = root?.querySelector("#macmon-copy-prompt");
    const openBtn = root?.querySelector("#macmon-open-cursor");
    if (out) out.value = lastPrompt;
    if (copyBtn) copyBtn.disabled = !lastPrompt;
    if (openBtn) {
      openBtn.classList.toggle("disabled", !lastPrompt);
      const url = data.cursor_protocol_url || data.cursor_web_url || "#";
      openBtn.setAttribute("href", url);
      openBtn.onclick = (ev) => {
        ev.preventDefault();
        void openInCursor(data);
      };
    }
    if (meta) {
      const ai = data.ai || {};
      meta.textContent = [
        ai.used ? `AI refined · ${ai.provider || "ai"} ${ai.model || ""}`.trim() : "Template prompt (no AI refine)",
        data.truncated ? "deeplink truncated — prefer Copy for full text" : null,
        `${Number(data.char_count || lastPrompt.length)} chars`,
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }

  async function buildPrompt(serverId) {
    const focus = root?.querySelector("#macmon-focus")?.value || "";
    const extra = root?.querySelector("#macmon-extra")?.value || "";
    const useAi = !!root?.querySelector("#macmon-use-ai")?.checked;
    const keySel = parseKeySelection(root?.querySelector("#macmon-ai-key")?.value);
    busy = true;
    try {
      const data = await api("/api/admin/mac-servers/cursor-prompt", {
        method: "POST",
        body: JSON.stringify({
          server_id: serverId,
          focus,
          extra,
          use_ai: useAi,
          ai_key_id: keySel.ai_key_id,
          ai_key_source: keySel.ai_key_source,
          speed: "fast",
        }),
      });
      applyPromptResult(data);
      onStatus?.("ok", useAi ? "Cursor prompt refined" : "Cursor prompt ready");
    } catch (err) {
      onStatus?.("error", err?.message || "Could not build prompt");
    } finally {
      busy = false;
    }
  }

  async function copyPrompt() {
    const text = root?.querySelector("#macmon-prompt-out")?.value || lastPrompt;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      onStatus?.("ok", "Prompt copied — paste into Cursor chat");
    } catch {
      onStatus?.("error", "Could not copy prompt");
    }
  }

  async function openInCursor(data) {
    const prompt = data?.prompt || lastPrompt;
    if (!prompt) return;
    // Always copy first so the workspace has the full prompt even if the deeplink truncates.
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      /* clipboard may be blocked; still try deeplink */
    }
    const protocol = data?.cursor_protocol_url;
    const web = data?.cursor_web_url;
    const tooLong = String(protocol || "").length > DEEPLINK_SOFT_LIMIT;
    if (protocol && !tooLong) {
      window.location.href = protocol;
      onStatus?.("ok", "Opening Cursor with prompt (also copied)");
      return;
    }
    if (web && !tooLong) {
      window.open(web, "_blank", "noopener,noreferrer");
      onStatus?.("ok", "Opened Cursor web link (prompt also copied)");
      return;
    }
    onStatus?.(
      "ok",
      "Prompt copied. Cursor deeplink is too long for this log dump — paste into your Cursor chat (Cmd/Ctrl+V)."
    );
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const section = root?.querySelector("#admin-section-servers");
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const visible = rect.bottom > 80 && rect.top < window.innerHeight;
      if (visible) void refresh();
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return {
    mount(panelRoot) {
      root = panelRoot;
      root.querySelector("#macmon-refresh")?.addEventListener("click", () => void refresh());
      root.querySelector("#macmon-register")?.addEventListener("click", () => void registerServer());
      void loadKeys().then(() => refresh({ preserveForm: false }));
      startPolling();
    },
    refresh,
    destroy() {
      stopPolling();
      root = null;
    },
  };
}
