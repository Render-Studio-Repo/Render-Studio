/**
 * First-run Server Setup wizard:
 * identity, secrets vault, ecosystem privacy, apps, storage, harness prompts.
 */

const STEPS = [
  "welcome",
  "identity",
  "keys",
  "ecosystem",
  "apps",
  "storage",
  "dashboard",
  "harness",
  "done",
];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, options = {}) {
  const opts = { credentials: "include", ...options };
  opts.headers = {
    Accept: "application/json",
    ...(opts.body && !(opts.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.error || res.statusText || "Request failed");
  }
  return data;
}

function ensureShell() {
  let root = document.getElementById("server-setup-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "server-setup-root";
  root.className = "server-setup-root";
  root.innerHTML = `
    <div class="server-setup-backdrop" data-setup-close="1"></div>
    <aside class="server-setup-panel" role="dialog" aria-modal="true" aria-labelledby="server-setup-title">
      <header class="server-setup-head">
        <div>
          <p class="server-setup-kicker">Server setup</p>
          <h2 id="server-setup-title">Configure this Render Studio</h2>
        </div>
        <button type="button" class="server-setup-x" data-setup-close="1" aria-label="Close">×</button>
      </header>
      <div class="server-setup-layout">
        <nav class="server-setup-steps" id="server-setup-steps"></nav>
        <section class="server-setup-main" id="server-setup-main"></section>
        <aside class="server-setup-agent" id="server-setup-agent"></aside>
      </div>
      <footer class="server-setup-foot">
        <button type="button" class="btn secondary" id="server-setup-back">Back</button>
        <div class="server-setup-foot-right">
          <button type="button" class="btn secondary" id="server-setup-agent-focus">Ask Render Agent</button>
          <button type="button" class="btn primary" id="server-setup-next">Continue</button>
        </div>
      </footer>
    </aside>
  `;
  document.body.appendChild(root);
  return root;
}

function tipForStep(step) {
  const tips = {
    welcome: "Local settings stay under data/server-config so git pull cannot overwrite them.",
    identity: "Name this server, then set owner identity in Secrets so backups verify it’s you.",
    keys: "Upload a bulk settings .txt or fill each app folder’s secret.env. Every app has a README.",
    ecosystem: "Private = no sync. Curated = only items you publish. Public = eligible listings sync out.",
    apps: "Enable only the integrations this organization should use.",
    storage: "Choose where models live. Use Send to Agent for wiring instructions.",
    dashboard: "Finish branding and update publishing in the management dashboard.",
    harness: "Describe custom work (2FA, MySQL, Drive). Copy a Cursor/VS Code prompt with paths.",
    done: "Setup complete. Re-open anytime from Management → Server setup.",
  };
  return tips[step] || tips.welcome;
}

function renderAgent(root, tip) {
  root.querySelector("#server-setup-agent").innerHTML = `
    <div class="server-setup-agent-card">
      <h3>Render Agent</h3>
      <p class="muted small">Uses the <code>server-setup</code> skill for keys, privacy, storage, and harness prompts.</p>
      <p>${esc(tip)}</p>
      <label class="server-setup-field">
        <span>Ask / intent</span>
        <textarea id="server-setup-agent-input" rows="4" placeholder="e.g. Wire MySQL for users and Google Drive for models"></textarea>
      </label>
      <div class="server-setup-agent-actions">
        <button type="button" class="btn secondary btn-compact" id="server-setup-send-agent">Open in Render Agent</button>
        <button type="button" class="btn primary btn-compact" id="server-setup-copy-harness">Copy harness prompt</button>
      </div>
      <pre class="server-setup-harness-out muted small" id="server-setup-harness-out" hidden></pre>
    </div>
  `;
}

function renderSteps(root, state, catalog) {
  const current = state.current_step || "welcome";
  root.querySelector("#server-setup-steps").innerHTML = (catalog.steps || [])
    .map((step) => {
      const active = step.id === current ? "is-active" : "";
      return `<button type="button" class="server-setup-step ${active}" data-step="${esc(step.id)}">${esc(step.title)}</button>`;
    })
    .join("");
}

function renderMain(view) {
  const state = view.state || {};
  const catalog = view.catalog || {};
  const step = state.current_step || "welcome";

  if (step === "welcome") {
    return `
      <h3>Welcome</h3>
      <p>Name this install, add API keys, choose ecosystem privacy, pick authorized apps, and set where models are stored.</p>
      <ul class="server-setup-list">
        <li>Local runtime: <code>data/server-config/</code> (gitignored)</li>
        <li>Public templates: <code>server-configurations/</code></li>
        <li>Secrets vault: <code>data/server-config/secrets/&lt;app&gt;/secret.env</code></li>
      </ul>
    `;
  }

  if (step === "identity") {
    const loadingOn = state.loading_screen_enabled !== false;
    return `
      <h3>Server identity</h3>
      <label class="server-setup-field">
        <span>Server name</span>
        <input type="text" id="server-setup-name" maxlength="80" value="${esc(state.server_name || "Render Studio")}" />
      </label>
      <label class="server-setup-choice" style="margin-top:12px">
        <input type="checkbox" id="server-setup-loading-enabled" ${loadingOn ? "checked" : ""} />
        <span>
          <strong>Show loading screen for 5 seconds</strong>
          <span class="muted small">Boot splash on Studio open. Turn off to skip straight into the editor.</span>
        </span>
      </label>
      <p class="muted small">Owner identity for backups lives in Secrets → <code>owner</code> (<code>OWNER_EMAIL</code>, <code>OWNER_GITHUB</code>, <code>BACKUP_OWNER_TOKEN</code>).</p>
    `;
  }

  if (step === "keys") {
    const apps = view.secrets?.apps || [];
    return `
      <h3>API keys &amp; subscriptions</h3>
      <p class="muted small">Each authorized app has its own folder + README. Upload a bulk .txt to fill many at once.</p>
      <div class="server-setup-key-grid">
        ${apps.map((app) => `
          <article class="server-setup-key-card ${app.configured ? "is-ready" : ""}">
            <header>
              <h4>${esc(app.label)}</h4>
              <span class="server-setup-pill ${app.configured ? "is-ok" : ""}">${app.configured ? "ready" : "needed"}</span>
            </header>
            <p class="muted small">${esc(app.description || "")}</p>
            <p class="muted small"><code>${esc(app.path || "")}</code></p>
          </article>
        `).join("")}
      </div>
      <label class="server-setup-field">
        <span>Bulk upload (.txt)</span>
        <textarea id="server-setup-bulk" rows="8" placeholder="Paste EXAMPLE-bulk-settings.txt with your real values"></textarea>
      </label>
      <div class="server-setup-inline-actions">
        <button type="button" class="btn secondary btn-compact" id="server-setup-download-example">Download example</button>
        <button type="button" class="btn primary btn-compact" id="server-setup-apply-bulk">Apply bulk secrets</button>
      </div>
      <p class="muted small" id="server-setup-keys-status"></p>
    `;
  }

  if (step === "ecosystem") {
    return `
      <h3>Marketplace ecosystem</h3>
      <div class="server-setup-choice-grid">
        ${(catalog.ecosystem_modes || []).map((mode) => `
          <label class="server-setup-choice ${state.ecosystem_mode === mode.id ? "is-selected" : ""}">
            <input type="radio" name="ecosystem_mode" value="${esc(mode.id)}" ${state.ecosystem_mode === mode.id ? "checked" : ""} />
            <strong>${esc(mode.label)}</strong>
            <span class="muted small">${esc(mode.summary)}</span>
          </label>
        `).join("")}
      </div>
    `;
  }

  if (step === "apps") {
    const apps = state.authorized_apps || {};
    return `
      <h3>Authorized apps</h3>
      <div class="server-setup-choice-grid">
        ${(catalog.authorized_apps || []).map((app) => `
          <label class="server-setup-choice">
            <input type="checkbox" data-auth-app="${esc(app.id)}" ${apps[app.id] ? "checked" : ""} />
            <strong>${esc(app.label)}</strong>
          </label>
        `).join("")}
      </div>
    `;
  }

  if (step === "storage") {
    return `
      <h3>Model &amp; data storage</h3>
      <div class="server-setup-choice-grid">
        ${(catalog.storage_backends || []).map((backend) => `
          <label class="server-setup-choice ${state.storage_backend === backend.id ? "is-selected" : ""}">
            <input type="radio" name="storage_backend" value="${esc(backend.id)}" ${state.storage_backend === backend.id ? "checked" : ""} />
            <strong>${esc(backend.label)}</strong>
            <span class="muted small">${esc(backend.summary)}</span>
            <span class="muted small">${esc(backend.instructions || "")}</span>
            <button type="button" class="btn secondary btn-compact" data-send-storage="${esc(backend.id)}">Send to Render Agent</button>
          </label>
        `).join("")}
      </div>
    `;
  }

  if (step === "dashboard") {
    return `
      <h3>Management dashboard</h3>
      <p>Review branding, update publishing, and admin tools.</p>
      <a class="btn primary" href="/admin-dashboard.html">Open management dashboard</a>
      <label class="server-setup-choice" style="margin-top:12px">
        <input type="checkbox" id="server-setup-dashboard-ready" ${state.dashboard_ready ? "checked" : ""} />
        <strong>I’ve reviewed the dashboard</strong>
      </label>
    `;
  }

  if (step === "harness") {
    return `
      <h3>Dev harness prompts</h3>
      <p>Generate a paste-ready prompt for Cursor / VS Code with file paths and follow-up questions.</p>
      <label class="server-setup-field">
        <span>Custom request</span>
        <textarea id="server-setup-harness-intent" rows="5" placeholder="I want 2FA on login and MySQL for usernames/passwords"></textarea>
      </label>
      <button type="button" class="btn primary" id="server-setup-build-harness">Generate harness prompt</button>
      <pre class="server-setup-harness-out" id="server-setup-harness-main-out" hidden></pre>
    `;
  }

  return `
    <h3>You’re set</h3>
    <p><strong>${esc(state.server_name)}</strong> · ecosystem <code>${esc(state.ecosystem_mode)}</code> · storage <code>${esc(state.storage_backend)}</code></p>
    <p class="muted small">Re-open anytime from Management → Server setup.</p>
  `;
}

function stepIndex(step) {
  const idx = STEPS.indexOf(step);
  return idx < 0 ? 0 : idx;
}

async function collectAndSave(root, view, nextStep) {
  const state = { ...(view.state || {}) };
  const step = state.current_step || "welcome";
  if (step === "identity") {
    state.server_name = root.querySelector("#server-setup-name")?.value || state.server_name;
    state.loading_screen_enabled = !!root.querySelector("#server-setup-loading-enabled")?.checked;
    try {
      await api("/api/admin/server-settings", {
        method: "PUT",
        body: JSON.stringify({
          loading_screen_enabled: state.loading_screen_enabled,
          loading_screen_duration_ms: state.loading_screen_enabled ? 5000 : 0,
        }),
      });
      try {
        localStorage.setItem("render3d:loadingScreenEnabled:v1", state.loading_screen_enabled ? "1" : "0");
      } catch (_) {
        /* ignore */
      }
    } catch (_) {
      /* branding save is best-effort during setup */
    }
  }
  if (step === "ecosystem") {
    state.ecosystem_mode =
      root.querySelector('input[name="ecosystem_mode"]:checked')?.value || state.ecosystem_mode;
  }
  if (step === "apps") {
    const apps = { ...(state.authorized_apps || {}) };
    root.querySelectorAll("[data-auth-app]").forEach((el) => {
      apps[el.getAttribute("data-auth-app")] = !!el.checked;
    });
    state.authorized_apps = apps;
  }
  if (step === "storage") {
    state.storage_backend =
      root.querySelector('input[name="storage_backend"]:checked')?.value || state.storage_backend;
  }
  if (step === "dashboard") {
    state.dashboard_ready = !!root.querySelector("#server-setup-dashboard-ready")?.checked;
  }
  if (nextStep) state.current_step = nextStep;
  await api("/api/admin/server-setup", {
    method: "PUT",
    body: JSON.stringify(state),
  });
}

function openRenderAgentWithPrompt(text) {
  const input =
    document.querySelector("#render-agent-input") ||
    document.querySelector("#renderAgentInput") ||
    document.querySelector("textarea[name='render-agent']");
  const panel =
    document.querySelector("#render-agent-panel") ||
    document.querySelector("#render-agent");
  panel?.classList?.remove("hidden");
  if (input) {
    input.value = `[server-setup skill]\n${text}`;
    input.focus();
    return;
  }
  window.prompt("Copy into Render Agent / Cursor:", text);
}

async function copyHarness(root, intent, outSel = "#server-setup-harness-out") {
  const report = await api("/api/admin/server-setup/harness-prompt", {
    method: "POST",
    body: JSON.stringify({ intent: intent || "Help configure this Render Studio server." }),
  });
  const out = root.querySelector(outSel);
  if (out) {
    out.hidden = false;
    out.textContent = report.prompt || "";
  }
  try {
    await navigator.clipboard.writeText(report.prompt || "");
  } catch (_) {
    /* ignore */
  }
}

function bindDynamic(root) {
  root.querySelectorAll("[data-step]").forEach((btn) => {
    btn.onclick = async () => {
      await collectAndSave(root, root._setupView, btn.getAttribute("data-step"));
      await refresh(root);
    };
  });

  root.querySelector("#server-setup-apply-bulk")?.addEventListener("click", async () => {
    const text = root.querySelector("#server-setup-bulk")?.value || "";
    const status = root.querySelector("#server-setup-keys-status");
    try {
      const report = await api("/api/admin/server-setup/secrets/bulk", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      if (status) status.textContent = `Applied ${report.applied_count || 0} app(s).`;
      await refresh(root);
    } catch (err) {
      if (status) status.textContent = err.message || "Bulk apply failed";
    }
  });

  root.querySelector("#server-setup-download-example")?.addEventListener("click", () => {
    window.open("/api/admin/server-setup/secrets/example.txt", "_blank");
  });

  root.querySelectorAll("[data-send-storage]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = btn.getAttribute("data-send-storage");
      const input = root.querySelector("#server-setup-agent-input");
      if (input) {
        input.value = `Help me configure storage backend “${id}” for this Render Studio server, including secrets vault paths and harness wiring.`;
      }
    });
  });

  root.querySelector("#server-setup-copy-harness")?.addEventListener("click", () => {
    void copyHarness(root, root.querySelector("#server-setup-agent-input")?.value);
  });
  root.querySelector("#server-setup-build-harness")?.addEventListener("click", () => {
    void copyHarness(
      root,
      root.querySelector("#server-setup-harness-intent")?.value,
      "#server-setup-harness-main-out",
    );
  });
  root.querySelector("#server-setup-send-agent")?.addEventListener("click", () => {
    const text =
      root.querySelector("#server-setup-agent-input")?.value ||
      "Help me finish Render Studio server setup.";
    openRenderAgentWithPrompt(text);
  });
}

async function refresh(root) {
  const [view, branding] = await Promise.all([
    api("/api/admin/server-setup"),
    api("/api/admin/server-settings").catch(() => null),
  ]);
  if (branding && view.state) {
    view.state.loading_screen_enabled = branding.loading_screen_enabled !== false;
  }
  root._setupView = view;
  renderSteps(root, view.state || {}, view.catalog || {});
  root.querySelector("#server-setup-main").innerHTML = renderMain(view);
  renderAgent(root, tipForStep(view.state?.current_step));
  bindDynamic(root);
  const next = root.querySelector("#server-setup-next");
  if (next) next.textContent = view.state?.current_step === "done" ? "Finish" : "Continue";
  return view;
}

function bindChrome(root) {
  if (root.dataset.bound === "1") return;
  root.dataset.bound = "1";

  root.querySelectorAll("[data-setup-close]").forEach((el) => {
    el.addEventListener("click", () => closeServerSetup());
  });

  root.querySelector("#server-setup-back")?.addEventListener("click", async () => {
    const view = root._setupView;
    const idx = stepIndex(view.state?.current_step);
    const prev = STEPS[Math.max(0, idx - 1)];
    await collectAndSave(root, view, prev);
    await refresh(root);
  });

  root.querySelector("#server-setup-next")?.addEventListener("click", async () => {
    const view = root._setupView;
    const idx = stepIndex(view.state?.current_step);
    if (idx >= STEPS.length - 1) {
      await api("/api/admin/server-setup/complete", { method: "POST", body: "{}" });
      await refresh(root);
      return;
    }
    await collectAndSave(root, view, STEPS[idx + 1]);
    await refresh(root);
  });

  root.querySelector("#server-setup-agent-focus")?.addEventListener("click", () => {
    root.querySelector("#server-setup-agent-input")?.focus();
  });
}

export async function openServerSetup() {
  const root = ensureShell();
  root.classList.add("is-open");
  document.body.classList.add("server-setup-open");
  bindChrome(root);
  await refresh(root);
}

export function closeServerSetup() {
  document.getElementById("server-setup-root")?.classList.remove("is-open");
  document.body.classList.remove("server-setup-open");
}

export async function maybeAutoOpenServerSetup() {
  try {
    const view = await api("/api/admin/server-setup");
    if (view.needs_setup) await openServerSetup();
  } catch (_) {
    /* not admin / not signed in */
  }
}

export function mountServerSetupEntry(target) {
  if (!target) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn secondary btn-compact";
  btn.textContent = "Server setup wizard";
  btn.addEventListener("click", () => void openServerSetup());
  target.appendChild(btn);
}

if (typeof window !== "undefined") {
  window.RenderServerSetup = {
    open: openServerSetup,
    close: closeServerSetup,
    maybeAutoOpen: maybeAutoOpenServerSetup,
    mountEntry: mountServerSetupEntry,
  };
}
