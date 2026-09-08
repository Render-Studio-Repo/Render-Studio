/** Management → Server Settings — Repository Governance (Secure Publish). */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mdLite(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  let inCode = false;
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      closeList();
      if (inCode) {
        out.push("</code></pre>");
        inCode = false;
      } else {
        out.push("<pre class=\"admin-gov-code\"><code>");
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(`${esc(line)}\n`);
      continue;
    }
    if (/^#\s+/.test(line)) {
      closeList();
      out.push(`<h3 class="admin-gov-h">${esc(line.replace(/^#\s+/, ""))}</h3>`);
      continue;
    }
    if (/^##\s+/.test(line)) {
      closeList();
      out.push(`<h4 class="admin-gov-h">${esc(line.replace(/^##\s+/, ""))}</h4>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) {
      out.push("<br/>");
      continue;
    }
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");

  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }
}

/**
 * @param {{ api: Function, escapeHtml?: Function }} deps
 */
export function createAdminServerSettings({ api }) {
  let state = {
    summary: null,
    docs: [],
    activeDoc: null,
    offLimits: [],
    candidates: [],
    selectedPaths: new Set(),
    feedback: null,
    suggestedLogs: [],
    selectedLogIds: new Set(),
    aiKeys: null,
    promptKey: "subscription",
    status: "",
    explain: "",
    busy: false,
  };

  function setStatus(msg, isError = false) {
    state.status = msg || "";
    const el = document.getElementById("admin-gov-status");
    if (!el) return;
    el.textContent = state.status;
    el.classList.toggle("error", !!isError);
  }

  async function loadAll(root) {
    setStatus("Loading Repository Governance…");
    try {
      const [summary, off, candidates, feedback, logs, keys] = await Promise.all([
        api("/api/admin/repository-governance"),
        api("/api/admin/repository-governance/off-limits"),
        api("/api/admin/repository-governance/candidates"),
        api("/api/admin/repository-governance/feedback"),
        api("/api/admin/repository-governance/suggested-logs?section=server-settings"),
        api("/api/user/ai-keys").catch(() => null),
      ]);
      state.summary = summary;
      state.docs = summary.documents || [];
      state.offLimits = off.paths || [];
      state.candidates = candidates.candidates || [];
      state.feedback = feedback;
      state.suggestedLogs = logs.logs || [];
      state.selectedLogIds = new Set((state.suggestedLogs.slice(0, 2) || []).map((l) => l.id));
      state.aiKeys = keys;
      state.selectedPaths = new Set(state.offLimits);
      render(root);
      if (state.docs[0]) void openDoc(root, state.docs[0].rel || state.docs[0].name);
      setStatus("Repository Governance ready.");
    } catch (err) {
      setStatus(err?.message || "Could not load Server Settings", true);
    }
  }

  async function openDoc(root, rel) {
    try {
      const doc = await api(`/api/admin/repository-governance/docs/${encodeURIComponent(rel)}`);
      state.activeDoc = doc;
      const viewer = root.querySelector("#admin-gov-doc-body");
      const meta = root.querySelector("#admin-gov-doc-meta");
      if (meta) meta.textContent = `${doc.path} · ${doc.bytes || 0} bytes`;
      if (viewer) {
        viewer.innerHTML = doc.kind === "markdown" ? mdLite(doc.content) : `<pre class="admin-gov-code"><code>${esc(doc.content || "")}</code></pre>`;
      }
      root.querySelectorAll("[data-gov-doc]").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-gov-doc") === rel);
      });
    } catch (err) {
      setStatus(err?.message || "Could not open document", true);
    }
  }

  function keyOptionsHtml() {
    const credits = state.aiKeys?.ai?.credits || state.aiKeys?.credits || {};
    const keys = state.aiKeys?.keys || state.aiKeys?.ai?.keys || [];
    const team = state.aiKeys?.ai?.team_keys || [];
    const opts = [
      `<option value="subscription" selected>Subscription (Render Studio credits) — default</option>`,
    ];
    for (const k of keys) {
      opts.push(`<option value="personal:${esc(k.id)}">Key: ${esc(k.name || k.provider)} (${esc(k.provider)})</option>`);
    }
    for (const k of team) {
      opts.push(`<option value="team:${esc(k.id)}">Team: ${esc(k.name || k.provider)}</option>`);
    }
    if (credits?.available) {
      opts.push(`<option value="platform:openai">Platform OpenAI</option>`);
      opts.push(`<option value="platform:anthropic">Platform Anthropic</option>`);
    }
    return opts.join("");
  }

  function render(root) {
    const host = root.querySelector("#admin-section-server-settings");
    if (!host) return;
    const summary = state.summary || {};
    const fb = state.feedback || {};
    host.innerHTML = `
      <div class="admin-agent-head">
        <div>
          <h3>Server Settings</h3>
          <p class="muted small admin-panel-hint">
            Enterprise: <strong>Repository Governance</strong> (Secure Publish Policy Pack).
            Former “system settings notes.” Push engine code; never push <code>premium-features/</code>.
          </p>
        </div>
        <button type="button" class="btn secondary btn-compact" id="admin-gov-refresh">Refresh</button>
      </div>

      <div class="admin-gov-grid">
        <aside class="admin-gov-side">
          <h4>Policy pack folder</h4>
          <p class="muted small">Open files agents must read before push.</p>
          <div class="admin-gov-doc-list" id="admin-gov-doc-list">
            ${(state.docs || []).map((d) => `
              <button type="button" class="admin-gov-doc-btn" data-gov-doc="${esc(d.rel || d.name)}">
                <strong>${esc(d.name)}</strong>
                <small>${esc(d.rel || d.path || "")}</small>
              </button>
            `).join("") || '<p class="muted small">No documents</p>'}
          </div>
          <div class="admin-gov-summary-card">
            <div><span>Mode</span><strong>${esc(summary.mode || "allowlist-first")}</strong></div>
            <div><span>Premium fence</span><strong>${esc(summary.premium_folder || "premium-features/")}</strong></div>
            <div><span>Off-limits</span><strong>${esc(String((state.offLimits || []).length))}</strong></div>
            <div><span>Gate</span><code>check-repository-governance.py</code></div>
          </div>
        </aside>

        <div class="admin-gov-main">
          <div class="admin-gov-doc-view">
            <div class="admin-gov-doc-toolbar">
              <strong id="admin-gov-doc-title">Document</strong>
              <span class="muted small" id="admin-gov-doc-meta"></span>
            </div>
            <div id="admin-gov-doc-body" class="admin-gov-doc-body"><p class="muted small">Select a file…</p></div>
          </div>

          <section class="admin-gov-panel">
            <h4>AI explanation</h4>
            <p class="muted small">Ask for a plain-language explanation of how Secure Publish is configured. Billing defaults to <strong>subscription</strong>.</p>
            <div class="admin-gov-row">
              <label class="admin-gov-field">
                <span>Key / subscription</span>
                <select id="admin-gov-ai-key">${keyOptionsHtml()}</select>
              </label>
            </div>
            <textarea id="admin-gov-explain-q" rows="2" placeholder="Optional question, e.g. What happens if someone tries to push premium-features?"></textarea>
            <div class="admin-gov-actions">
              <button type="button" class="btn accent btn-compact" id="admin-gov-explain">Explain configuration</button>
            </div>
            <div id="admin-gov-explain-out" class="admin-gov-explain-out">${state.explain ? mdLite(state.explain) : ""}</div>
          </section>

          <section class="admin-gov-panel">
            <h4>Off-limits folders &amp; files</h4>
            <p class="muted small"><code>premium-features/**</code> is locked. Add more paths that must never leave this host.</p>
            <div class="admin-gov-candidates" id="admin-gov-candidates">
              ${(state.candidates || []).map((c) => {
                const checked = state.selectedPaths.has(c.path) ? "checked" : "";
                const locked = c.locked ? "disabled" : "";
                return `<label class="admin-gov-check ${c.locked ? "is-locked" : ""}">
                  <input type="checkbox" data-gov-path="${esc(c.path)}" ${checked} ${locked} />
                  <span><strong>${esc(c.name)}</strong> <code>${esc(c.path)}</code>${c.locked ? " · always fenced" : ""}</span>
                </label>`;
              }).join("")}
            </div>
            <label class="admin-gov-field">
              <span>Add custom path / glob</span>
              <input type="text" id="admin-gov-custom-path" placeholder="e.g. private-integrations/**" />
            </label>
            <div class="admin-gov-actions">
              <button type="button" class="btn secondary btn-compact" id="admin-gov-add-path">Add path</button>
              <button type="button" class="btn accent btn-compact" id="admin-gov-save-offlimits">Save off-limits</button>
            </div>
            <p class="muted small">Current: ${(state.offLimits || []).map((p) => `<code>${esc(p)}</code>`).join(" ") || "—"}</p>
          </section>

          <section class="admin-gov-panel">
            <h4>Safeguard note / generate instructions</h4>
            <p class="muted small">Select folders above, then either generate AI safeguarding instructions or submit a plain note without generation.</p>
            <textarea id="admin-gov-safeguard-prompt" rows="3" placeholder="Describe what you want protected, or leave blank and just submit a note…"></textarea>
            <div class="admin-gov-row">
              <label class="admin-gov-field">
                <span>Key / subscription for generation</span>
                <select id="admin-gov-safeguard-key">${keyOptionsHtml()}</select>
              </label>
            </div>
            <div class="admin-gov-actions">
              <button type="button" class="btn accent btn-compact" id="admin-gov-generate">Generate instructions</button>
              <button type="button" class="btn secondary btn-compact" id="admin-gov-note-only">Submit note only (no AI)</button>
            </div>
            <div id="admin-gov-safeguard-out" class="admin-gov-explain-out"></div>
          </section>

          <section class="admin-gov-panel admin-gov-panel--feedback">
            <h4>Working well? Tell GitHub</h4>
            <p class="muted small">Thumbs write to <code>repository-governance/notes/README.md</code> so the main repo can see operator sentiment.</p>
            <div class="admin-gov-votes">
              <button type="button" class="btn admin-gov-thumb" id="admin-gov-thumb-up" title="Working well">👍 ${esc(String(fb.thumbs_up ?? 0))}</button>
              <button type="button" class="btn admin-gov-thumb" id="admin-gov-thumb-down" title="Needs work">👎 ${esc(String(fb.thumbs_down ?? 0))}</button>
            </div>
            <label class="admin-gov-field">
              <span>Optional note with vote</span>
              <textarea id="admin-gov-vote-note" rows="2" placeholder="Short note about what’s working or not…"></textarea>
            </label>
            <label class="admin-gov-field">
              <span>Contact (optional)</span>
              <input type="text" id="admin-gov-contact" placeholder="email or Discord handle" />
            </label>

            <h4 class="admin-gov-subh">Report an issue (+ suggested logs)</h4>
            <p class="muted small">We’ll suggest logs for this Server Settings section. Pick which to attach.</p>
            <div class="admin-gov-logs">
              ${(state.suggestedLogs || []).map((l) => `
                <label class="admin-gov-check">
                  <input type="checkbox" data-gov-log="${esc(l.id)}" ${state.selectedLogIds.has(l.id) ? "checked" : ""} />
                  <span><strong>${esc(l.label)}</strong><br/><code>${esc(l.command)}</code></span>
                </label>
              `).join("")}
            </div>
            <textarea id="admin-gov-issue-note" rows="3" placeholder="What’s going wrong?"></textarea>
            <div class="admin-gov-actions">
              <button type="button" class="btn secondary btn-compact" id="admin-gov-issue">Submit issue note + logs</button>
            </div>
          </section>
        </div>
      </div>
      <p id="admin-gov-status" class="muted small admin-gov-status" role="status"></p>
    `;

    bind(root);
  }

  function selectedPathsFromUi(root) {
    const set = new Set();
    root.querySelectorAll("[data-gov-path]").forEach((input) => {
      if (input.checked || input.disabled) set.add(input.getAttribute("data-gov-path"));
    });
    state.offLimits.forEach((p) => set.add(p));
    return [...set];
  }

  function parseKeySelect(sel) {
    const raw = String(sel?.value || "subscription").trim();
    if (!raw || raw === "subscription") {
      return { ai_key_source: "platform", ai_key_id: null, use_subscription: true };
    }
    const idx = raw.indexOf(":");
    if (idx < 0) return { ai_key_source: "platform", ai_key_id: null, use_subscription: true };
    return {
      ai_key_source: raw.slice(0, idx),
      ai_key_id: raw.slice(idx + 1),
      use_subscription: raw.startsWith("platform:") || raw === "subscription",
    };
  }

  function bind(root) {
    root.querySelector("#admin-gov-refresh")?.addEventListener("click", () => void loadAll(root));
    root.querySelectorAll("[data-gov-doc]").forEach((btn) => {
      btn.addEventListener("click", () => void openDoc(root, btn.getAttribute("data-gov-doc")));
    });
    root.querySelector("#admin-gov-add-path")?.addEventListener("click", () => {
      const input = root.querySelector("#admin-gov-custom-path");
      const val = String(input?.value || "").trim();
      if (!val) return;
      state.selectedPaths.add(val);
      if (input) input.value = "";
      const paths = selectedPathsFromUi(root);
      if (!paths.includes(val)) paths.push(val);
      state.offLimits = paths;
      render(root);
    });
    root.querySelector("#admin-gov-save-offlimits")?.addEventListener("click", async () => {
      const paths = selectedPathsFromUi(root);
      setStatus("Saving off-limits…");
      try {
        const data = await api("/api/admin/repository-governance/off-limits", {
          method: "PUT",
          body: JSON.stringify({ paths }),
        });
        state.offLimits = data.paths || paths;
        state.selectedPaths = new Set(state.offLimits);
        setStatus("Off-limits saved to repository-governance/off-limits.yaml");
        render(root);
      } catch (err) {
        setStatus(err?.message || "Save failed", true);
      }
    });
    root.querySelector("#admin-gov-explain")?.addEventListener("click", async () => {
      const q = root.querySelector("#admin-gov-explain-q")?.value || "";
      const key = parseKeySelect(root.querySelector("#admin-gov-ai-key"));
      setStatus("Generating explanation…");
      try {
        const data = await api("/api/admin/repository-governance/explain", {
          method: "POST",
          body: JSON.stringify({
            question: q,
            ai_key_id: key.ai_key_id,
            ai_key_source: key.ai_key_source,
            use_subscription: key.use_subscription,
          }),
        });
        state.explain = data.answer || "";
        const out = root.querySelector("#admin-gov-explain-out");
        if (out) out.innerHTML = mdLite(state.explain);
        setStatus("Explanation ready.");
      } catch (err) {
        setStatus(err?.message || "Explain failed", true);
      }
    });
    root.querySelector("#admin-gov-generate")?.addEventListener("click", async () => {
      const prompt = root.querySelector("#admin-gov-safeguard-prompt")?.value || "";
      const key = parseKeySelect(root.querySelector("#admin-gov-safeguard-key"));
      const paths = selectedPathsFromUi(root);
      setStatus("Generating safeguarding instructions…");
      try {
        const data = await api("/api/admin/repository-governance/safeguard", {
          method: "POST",
          body: JSON.stringify({
            selected_paths: paths,
            prompt,
            generate_instructions: true,
            save_note: true,
            ai_key_id: key.ai_key_id,
            ai_key_source: key.ai_key_source,
            use_subscription: key.use_subscription,
          }),
        });
        const out = root.querySelector("#admin-gov-safeguard-out");
        if (out) out.innerHTML = mdLite(data.instructions || data.note || "");
        setStatus("Instructions generated and saved to notes/safeguard-notes.md");
      } catch (err) {
        setStatus(err?.message || "Generate failed", true);
      }
    });
    root.querySelector("#admin-gov-note-only")?.addEventListener("click", async () => {
      const prompt = root.querySelector("#admin-gov-safeguard-prompt")?.value || "";
      if (!prompt.trim()) {
        setStatus("Write a note first (no AI generation).", true);
        return;
      }
      const paths = selectedPathsFromUi(root);
      try {
        await api("/api/admin/repository-governance/safeguard", {
          method: "POST",
          body: JSON.stringify({
            selected_paths: paths,
            prompt,
            generate_instructions: false,
            save_note: true,
          }),
        });
        const out = root.querySelector("#admin-gov-safeguard-out");
        if (out) out.innerHTML = mdLite(prompt);
        setStatus("Note saved without generating instructions.");
      } catch (err) {
        setStatus(err?.message || "Could not save note", true);
      }
    });
    const vote = async (direction) => {
      const note = root.querySelector("#admin-gov-vote-note")?.value || "";
      const contact = root.querySelector("#admin-gov-contact")?.value || "";
      try {
        state.feedback = await api("/api/admin/repository-governance/feedback", {
          method: "POST",
          body: JSON.stringify({ vote: direction, note, contact }),
        });
        setStatus(direction === "up" ? "Thanks — recorded 👍 in notes/README.md" : "Recorded 👎 in notes/README.md");
        render(root);
      } catch (err) {
        setStatus(err?.message || "Vote failed", true);
      }
    };
    root.querySelector("#admin-gov-thumb-up")?.addEventListener("click", () => void vote("up"));
    root.querySelector("#admin-gov-thumb-down")?.addEventListener("click", () => void vote("down"));
    root.querySelectorAll("[data-gov-log]").forEach((input) => {
      input.addEventListener("change", () => {
        const id = input.getAttribute("data-gov-log");
        if (input.checked) state.selectedLogIds.add(id);
        else state.selectedLogIds.delete(id);
      });
    });
    root.querySelector("#admin-gov-issue")?.addEventListener("click", async () => {
      const note = root.querySelector("#admin-gov-issue-note")?.value || "";
      const contact = root.querySelector("#admin-gov-contact")?.value || "";
      if (!note.trim()) {
        setStatus("Describe the issue before submitting.", true);
        return;
      }
      try {
        const data = await api("/api/admin/repository-governance/issue", {
          method: "POST",
          body: JSON.stringify({
            note,
            contact,
            section: "server-settings",
            log_ids: [...state.selectedLogIds],
            include_log_excerpts: true,
          }),
        });
        state.feedback = data.feedback || state.feedback;
        setStatus("Issue note + suggested/attached logs saved to notes/README.md");
        render(root);
      } catch (err) {
        setStatus(err?.message || "Issue submit failed", true);
      }
    });
  }

  return {
    mount(root) {
      const host = root.querySelector("#admin-section-server-settings");
      if (!host) return;
      host.innerHTML = `<p class="muted small">Loading Server Settings…</p>`;
      void loadAll(root);
    },
    reload: loadAll,
  };
}
