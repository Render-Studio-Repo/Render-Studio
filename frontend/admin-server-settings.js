/**
 * Management dashboard → Server Settings:
 * branding + local update-publishing toggles + profile catalog import.
 *
 * Local settings live under data/server-config/ (gitignored) and survive git pull.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isVideoUrl(url = "") {
  return /\.(mp4|webm)(?:$|\?)/i.test(String(url || ""));
}

export function serverSettingsSectionHtml() {
  return `
    <section class="admin-panel admin-panel--server-settings" id="admin-section-server-settings" data-admin-section="server-settings">
      <div class="admin-agent-head">
        <div>
          <h3>Server Settings</h3>
          <p class="muted small admin-panel-hint">
            Branding, update publishing, and configuration profiles.
            Public templates ship in <code>server-configurations/</code>; this machine’s live settings stay in
            <code>data/server-config/</code> (gitignored) so <code>git pull</code> cannot overwrite them.
          </p>
        </div>
        <button type="button" class="btn secondary btn-compact" id="admin-server-settings-refresh">Refresh</button>
      </div>
      <div id="admin-server-settings-body" class="admin-server-settings-body">
        <p class="muted small">Loading server settings…</p>
      </div>
    </section>
  `;
}

function previewHtml(branding) {
  const name = escapeHtml(branding.product_name || "Render Studio");
  const logo = escapeHtml(branding.logo_url || "");
  const loading = escapeHtml(branding.loading_screen_url || "");
  const attr = escapeHtml(branding.attribution_logo_url || "");
  const repo = escapeHtml(branding.attribution_repo_url || "https://github.com/wprojects/Render-Studio");
  const loadingPreview = loading
    ? (isVideoUrl(loading)
      ? `<video class="admin-brand-preview-media" src="${loading}" muted loop autoplay playsinline></video>`
      : `<img class="admin-brand-preview-media" src="${loading}" alt="Custom loading screen" />`)
    : `<div class="admin-brand-preview-builtin"><span>Built-in PC loading animation</span></div>`;
  return `
    <div class="admin-brand-preview" aria-label="Loading screen preview">
      <a class="admin-brand-preview-attribution" href="${repo}" target="_blank" rel="noopener noreferrer">
        <img src="${attr}" alt="Render Studio" width="28" height="28" />
        <span>Render Studio</span>
      </a>
      <div class="admin-brand-preview-stage">${loadingPreview}</div>
      <p class="admin-brand-preview-title">Loading <strong>${name}</strong></p>
      <div class="admin-brand-preview-logo-row">
        <img src="${logo}" alt="" width="28" height="28" />
        <span>${name}</span>
      </div>
    </div>
  `;
}

function channelToggle(id, label, checked, envOk, instruction) {
  const env = envOk
    ? `<span class="admin-env-pill is-ok">env ready</span>`
    : `<span class="admin-env-pill">env missing</span>`;
  return `
    <label class="admin-toggle-row">
      <input type="checkbox" data-publish-target="${id}" ${checked ? "checked" : ""} />
      <span>
        <strong>${escapeHtml(label)}</strong>
        ${id === "docs" ? "" : env}
        <small class="muted">${escapeHtml(instruction || "")}</small>
      </span>
    </label>
  `;
}

function publishingHtml(config) {
  const up = config?.update_publishing || {};
  const targets = up.targets || {};
  const env = up.env_configured || config.env_configured || {};
  const instructions = (config.local?.update_publishing?.instructions)
    || (config.public_defaults?.update_publishing?.instructions)
    || config.instructions
    || {};
  const paths = config.paths || {};
  return `
    <div class="admin-server-card" id="admin-update-publishing-card">
      <h4>Update publishing</h4>
      <p class="muted small">
        Agents read <code>instructions/server/UPDATE-DOCS.md</code> and
        <code>${escapeHtml(paths.workflow_doc || "docs/UPDATE-PUBLISHING.md")}</code>,
        then publish from the local update log without merging or deploying.
        Public-repo default: <strong>ON → docs only</strong>.
      </p>
      <label class="admin-toggle-row">
        <input type="checkbox" id="admin-publish-enabled" ${up.enabled ? "checked" : ""} />
        <span><strong>Enable automatic update publishing</strong>
          <small class="muted">When off, <code>publish-server-updates.py</code> stops without posting.</small>
        </span>
      </label>
      <label class="admin-toggle-row">
        <input type="checkbox" id="admin-publish-auto" ${up.auto_publish ? "checked" : ""} />
        <span><strong>Auto-publish on eligible log entries</strong>
          <small class="muted">Still uses the ledger to prevent duplicate posts.</small>
        </span>
      </label>
      <div class="admin-publish-targets">
        ${channelToggle("docs", "Docs", !!targets.docs, true, instructions.docs || "Writes frontend/docs/updates/shipped.json")}
        ${channelToggle("slack", "Slack", !!targets.slack, !!env.slack, instructions.slack || "Set SLACK_UPDATES_WEBHOOK_URL")}
        ${channelToggle("discord", "Discord", !!targets.discord, !!env.discord, instructions.discord || "Configure Discord bot/webhook")}
        ${channelToggle("linkedin", "LinkedIn", !!targets.linkedin, !!env.linkedin, instructions.linkedin || "Configure LinkedIn token")}
      </div>
      <div class="admin-field-row">
        <button type="button" class="btn primary btn-compact" id="admin-publish-save">Save publishing settings</button>
        <button type="button" class="btn secondary btn-compact" id="admin-publish-dry-run">Dry-run publisher</button>
        <button type="button" class="btn secondary btn-compact" id="admin-publish-run">Publish now</button>
      </div>
      <p class="muted small">
        Local log: <code>${escapeHtml(paths.update_log || "data/server-config/updates/UPDATE-LOG.md")}</code>
        · Ledger entries: <strong>${escapeHtml(String(up.ledger_count ?? config.ledger_count ?? 0))}</strong>
      </p>
      <pre class="admin-publish-report muted small" id="admin-publish-report" hidden></pre>
    </div>
  `;
}

function profilesHtml(config) {
  const profiles = config?.catalog?.profiles || [];
  const cards = profiles.map((p) => {
    const tags = (p.tags || []).map((t) => `<span class="admin-tag">${escapeHtml(t)}</span>`).join("");
    const popular = p.popular || Number(p.popularity || 0) >= 70
      ? `<span class="admin-env-pill is-ok">popular</span>`
      : "";
    return `
      <article class="admin-profile-card" data-profile-id="${escapeHtml(p.id)}">
        <header>
          <h5>${escapeHtml(p.name || p.id)} ${popular}</h5>
          <div class="admin-tag-row">${tags}</div>
        </header>
        <p class="muted small">${escapeHtml(p.summary || "")}</p>
        <p class="muted small">Popularity ${escapeHtml(String(p.popularity ?? 0))}</p>
        <div class="admin-field-row">
          <button type="button" class="btn secondary btn-compact" data-profile-view="${escapeHtml(p.id)}">View README</button>
          <button type="button" class="btn primary btn-compact" data-profile-import="${escapeHtml(p.id)}">Import to this server</button>
        </div>
      </article>
    `;
  }).join("") || `<p class="muted small">No profiles found under server-configurations/profiles.</p>`;

  return `
    <div class="admin-server-card" id="admin-profiles-card">
      <h4>Configuration profiles</h4>
      <p class="muted small">
        Browse templates from the public <code>Server-Configurations</code> catalog
        (<a href="${escapeHtml(config?.catalog?.github_url || "https://github.com/wprojects/Render-Studio/tree/Server-Configurations")}" target="_blank" rel="noopener noreferrer">GitHub</a>).
        Import copies into local <code>data/server-config/</code> only.
      </p>
      <div class="admin-profile-grid">${cards}</div>
      <div class="admin-profile-reader" id="admin-profile-reader" hidden>
        <div class="admin-agent-head">
          <h5 id="admin-profile-reader-title">Profile</h5>
          <button type="button" class="btn secondary btn-compact" id="admin-profile-reader-close">Close</button>
        </div>
        <div class="admin-profile-assets" id="admin-profile-assets"></div>
        <article class="admin-profile-markdown" id="admin-profile-markdown"></article>
      </div>
    </div>
  `;
}

function renderBody(branding, config) {
  const name = escapeHtml(branding.product_name || config?.local?.product_name || "Render Studio");
  return `
    <div class="admin-server-settings-stack">
      <div class="admin-server-settings-grid">
        <form class="admin-server-settings-form" id="admin-server-settings-form">
          <label class="admin-field">
            <span>Product name</span>
            <input type="text" id="admin-product-name" maxlength="64" value="${name}" placeholder="Render Studio" />
          </label>
          <div class="admin-field-row">
            <button type="submit" class="btn primary btn-compact">Save name</button>
            <button type="button" class="btn secondary btn-compact" id="admin-branding-reset">Reset all branding</button>
          </div>

          <div class="admin-field">
            <span>Product logo</span>
            <p class="muted small">Toolbar / boot wordmark. Does not replace the top-left Render Studio attribution.</p>
            <div class="admin-upload-row">
              <input type="file" id="admin-logo-file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" />
              <button type="button" class="btn secondary btn-compact" id="admin-logo-upload">Upload logo</button>
              <button type="button" class="btn secondary btn-compact" id="admin-logo-clear">Use default</button>
            </div>
          </div>

          <div class="admin-field">
            <span>Loading screen</span>
            <p class="muted small">Replace the built-in PC boot stage with an image, GIF, or short muted video.</p>
            <div class="admin-upload-row">
              <input type="file" id="admin-loading-file" accept="image/*,video/mp4,video/webm" />
              <button type="button" class="btn secondary btn-compact" id="admin-loading-upload">Upload loading screen</button>
              <button type="button" class="btn secondary btn-compact" id="admin-loading-clear">Use built-in</button>
            </div>
          </div>
          <p class="muted small" id="admin-server-settings-status" role="status"></p>
        </form>
        ${previewHtml(branding)}
      </div>
      ${publishingHtml(config || {})}
      ${profilesHtml(config || {})}
      <p class="muted small">${escapeHtml(config?.note || "")}</p>
    </div>
  `;
}

async function uploadFile(api, path, file) {
  const body = new FormData();
  body.append("file", file);
  return api(path, { method: "POST", body });
}

function setStatus(root, message, isError = false) {
  const el = root.querySelector("#admin-server-settings-status");
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("is-error", Boolean(isError));
}

function simpleMarkdown(md) {
  return escapeHtml(md || "")
    .replace(/^### (.*)$/gm, "<h5>$1</h5>")
    .replace(/^## (.*)$/gm, "<h4>$1</h4>")
    .replace(/^# (.*)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^\- (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
    .replace(/\n\n/g, "<br/><br/>");
}

function bindPublishing(root, { api }) {
  root.querySelector("#admin-publish-save")?.addEventListener("click", async () => {
    const enabled = !!root.querySelector("#admin-publish-enabled")?.checked;
    const auto_publish = !!root.querySelector("#admin-publish-auto")?.checked;
    const targets = {};
    root.querySelectorAll("[data-publish-target]").forEach((el) => {
      targets[el.getAttribute("data-publish-target")] = !!el.checked;
    });
    setStatus(root, "Saving publishing settings…");
    try {
      await api("/api/admin/server-config", {
        method: "PUT",
        body: JSON.stringify({ update_publishing: { enabled, auto_publish, targets } }),
      });
      setStatus(root, "Publishing settings saved (local only).");
      await loadServerSettings(root, { api });
    } catch (err) {
      setStatus(root, err.message || "Save failed", true);
    }
  });

  const runPublish = async (dry_run) => {
    const reportEl = root.querySelector("#admin-publish-report");
    setStatus(root, dry_run ? "Dry-running publisher…" : "Publishing…");
    try {
      const report = await api("/api/admin/server-config/publish-updates", {
        method: "POST",
        body: JSON.stringify({ dry_run, force: false }),
      });
      if (reportEl) {
        reportEl.hidden = false;
        reportEl.textContent = JSON.stringify(report, null, 2);
      }
      setStatus(root, dry_run ? "Dry-run complete." : "Publisher finished — see report.");
    } catch (err) {
      setStatus(root, err.message || "Publisher failed", true);
    }
  };
  root.querySelector("#admin-publish-dry-run")?.addEventListener("click", () => void runPublish(true));
  root.querySelector("#admin-publish-run")?.addEventListener("click", () => {
    if (!window.confirm("Publish eligible updates from the local UPDATE-LOG now?")) return;
    void runPublish(false);
  });
}

function bindProfiles(root, { api, config }) {
  const reader = root.querySelector("#admin-profile-reader");
  const mdEl = root.querySelector("#admin-profile-markdown");
  const assetsEl = root.querySelector("#admin-profile-assets");
  const titleEl = root.querySelector("#admin-profile-reader-title");

  root.querySelector("#admin-profile-reader-close")?.addEventListener("click", () => {
    reader?.setAttribute("hidden", "hidden");
  });

  root.querySelectorAll("[data-profile-view]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-profile-view");
      setStatus(root, `Loading ${id}…`);
      try {
        const data = await api(`/api/admin/server-config/profiles/${encodeURIComponent(id)}/readme`);
        const profile = (config?.catalog?.profiles || []).find((p) => p.id === id);
        if (titleEl) titleEl.textContent = profile?.name || id;
        if (mdEl) mdEl.innerHTML = simpleMarkdown(data.markdown || "");
        if (assetsEl) {
          const assets = profile?.assets || [];
          assetsEl.innerHTML = assets.map((url) => (
            /\.(mp4|webm)(?:$|\?)/i.test(url)
              ? `<video src="${escapeHtml(url)}" controls muted playsinline></video>`
              : `<img src="${escapeHtml(url)}" alt="" />`
          )).join("") || `<p class="muted small">No assets uploaded for this profile.</p>`;
        }
        reader?.removeAttribute("hidden");
        setStatus(root, "");
      } catch (err) {
        setStatus(root, err.message || "Could not load profile README", true);
      }
    });
  });

  root.querySelectorAll("[data-profile-import]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-profile-import");
      if (!window.confirm(`Import profile “${id}” into this server’s local settings? Public templates stay unchanged.`)) return;
      setStatus(root, `Importing ${id}…`);
      try {
        await api(`/api/admin/server-config/profiles/${encodeURIComponent(id)}/import`, { method: "POST" });
        setStatus(root, `Imported ${id} into data/server-config/.`);
        await loadServerSettings(root, { api });
      } catch (err) {
        setStatus(root, err.message || "Import failed", true);
      }
    });
  });
}

function bindBranding(root, { api }) {
  const form = root.querySelector("#admin-server-settings-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = root.querySelector("#admin-product-name");
    const product_name = String(input?.value || "").trim();
    setStatus(root, "Saving…");
    try {
      await api("/api/admin/server-settings", {
        method: "PUT",
        body: JSON.stringify({ product_name }),
      });
      await api("/api/admin/server-config", {
        method: "PUT",
        body: JSON.stringify({ product_name }),
      });
      setStatus(root, "Product name saved.");
      await loadServerSettings(root, { api });
    } catch (err) {
      setStatus(root, err.message || "Save failed", true);
    }
  });

  root.querySelector("#admin-logo-upload")?.addEventListener("click", async () => {
    const file = root.querySelector("#admin-logo-file")?.files?.[0];
    if (!file) return setStatus(root, "Choose a logo image first.", true);
    setStatus(root, "Uploading logo…");
    try {
      await uploadFile(api, "/api/admin/server-settings/logo", file);
      setStatus(root, "Logo updated.");
      await loadServerSettings(root, { api });
    } catch (err) {
      setStatus(root, err.message || "Logo upload failed", true);
    }
  });

  root.querySelector("#admin-logo-clear")?.addEventListener("click", async () => {
    setStatus(root, "Restoring default logo…");
    try {
      await api("/api/admin/server-settings/logo", { method: "DELETE" });
      setStatus(root, "Default logo restored.");
      await loadServerSettings(root, { api });
    } catch (err) {
      setStatus(root, err.message || "Could not restore logo", true);
    }
  });

  root.querySelector("#admin-loading-upload")?.addEventListener("click", async () => {
    const file = root.querySelector("#admin-loading-file")?.files?.[0];
    if (!file) return setStatus(root, "Choose a loading-screen file first.", true);
    setStatus(root, "Uploading loading screen…");
    try {
      await uploadFile(api, "/api/admin/server-settings/loading-screen", file);
      setStatus(root, "Loading screen updated.");
      await loadServerSettings(root, { api });
    } catch (err) {
      setStatus(root, err.message || "Loading screen upload failed", true);
    }
  });

  root.querySelector("#admin-loading-clear")?.addEventListener("click", async () => {
    setStatus(root, "Restoring built-in loading animation…");
    try {
      await api("/api/admin/server-settings/loading-screen", { method: "DELETE" });
      setStatus(root, "Built-in loading animation restored.");
      await loadServerSettings(root, { api });
    } catch (err) {
      setStatus(root, err.message || "Could not restore loading screen", true);
    }
  });

  root.querySelector("#admin-branding-reset")?.addEventListener("click", async () => {
    if (!window.confirm("Reset product name, logo, and loading screen to Render Studio defaults?")) return;
    setStatus(root, "Resetting…");
    try {
      await api("/api/admin/server-settings/reset", { method: "POST" });
      setStatus(root, "Branding reset to defaults.");
      await loadServerSettings(root, { api });
    } catch (err) {
      setStatus(root, err.message || "Reset failed", true);
    }
  });
}

export async function loadServerSettings(root, { api }) {
  const body = root.querySelector("#admin-server-settings-body");
  if (!body) return;
  body.innerHTML = `<p class="muted small">Loading server settings…</p>`;
  try {
    const [branding, config] = await Promise.all([
      api("/api/admin/server-settings"),
      api("/api/admin/server-config"),
    ]);
    body.innerHTML = renderBody(branding, config);
    bindBranding(root, { api });
    bindPublishing(root, { api });
    bindProfiles(root, { api, config });
  } catch (err) {
    body.innerHTML = `<p class="muted">Could not load server settings: ${escapeHtml(err.message || "error")}</p>`;
  }
}

export function bindServerSettingsSection(root, { api }) {
  root.querySelector("#admin-server-settings-refresh")?.addEventListener("click", () => {
    void loadServerSettings(root, { api });
  });
  void loadServerSettings(root, { api });
}
