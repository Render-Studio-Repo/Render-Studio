/** Preferences Store tab — public store settings + studio file explorer publish */

const MODEL_EXTS = new Set(["stl", "step", "stp", "glb", "gltf", "obj", "3mf", "ply", "off", "zip"]);

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(cents, currency = "USD") {
  const n = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function createStorePreferencesUI({ api, getTeamId }) {
  let projects = [];
  let expanded = new Set();
  let projectFiles = new Map(); // projectId -> files[]
  let selected = new Map(); // key projectId::filename -> {projectId, filename, name, format, size}
  let lastClickedKey = null;
  let listings = [];
  let storeSettings = {};
  let storePrefsAbort = null; // leakfix72
  function beginStorePrefsFetch() {
    if (storePrefsAbort) {
      try { storePrefsAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    storePrefsAbort = ctl;
    return ctl;
  }

  function selectedList() {
    return [...selected.values()];
  }

  function selectionKeysInOrder(projectId) {
    const files = projectFiles.get(projectId) || [];
    return files.map((f) => `${projectId}::${f.name}`);
  }

  function toggleFile(projectId, file, { shift = false, meta = false } = {}) {
    const key = `${projectId}::${file.name}`;
    if (shift && lastClickedKey && lastClickedKey.startsWith(`${projectId}::`)) {
      const keys = selectionKeysInOrder(projectId);
      const a = keys.indexOf(lastClickedKey);
      const b = keys.indexOf(key);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) {
          const k = keys[i];
          const name = k.split("::")[1];
          const f = (projectFiles.get(projectId) || []).find((x) => x.name === name);
          if (f) selected.set(k, { projectId, filename: f.name, name: f.name, format: f.format, size: f.size });
        }
        renderExplorer();
        return;
      }
    }
    if (selected.has(key) && !meta) {
      selected.delete(key);
    } else if (selected.has(key) && meta) {
      selected.delete(key);
    } else {
      selected.set(key, { projectId, filename: file.name, name: file.name, format: file.format, size: file.size });
    }
    lastClickedKey = key;
    renderExplorer();
  }

  function selectWholeProject(projectId) {
    const files = (projectFiles.get(projectId) || []).filter((f) => MODEL_EXTS.has(String(f.format || "").toLowerCase()) || MODEL_EXTS.has(String(f.name || "").split(".").pop()?.toLowerCase()));
    for (const f of files.slice(0, 8)) {
      selected.set(`${projectId}::${f.name}`, { projectId, filename: f.name, name: f.name, format: f.format, size: f.size });
    }
    renderExplorer();
  }

  async function ensureProjectFiles(projectId) {
    if (projectFiles.has(projectId)) return projectFiles.get(projectId);
    const data = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    const files = (data.files || []).map((f) => ({
      name: f.name || f.id,
      format: f.format || String(f.name || "").split(".").pop(),
      size: f.size || 0,
    }));
    projectFiles.set(projectId, files);
    return files;
  }

  async function loadProjects(signal) {
    const teamId = getTeamId?.();
    const q = teamId ? `?team_id=${encodeURIComponent(teamId)}` : "";
    const data = await api(`/api/projects${q}`, signal ? { signal } : {});
    if (signal?.aborted) return;
    projects = data.projects || [];
    renderExplorer();
  }

  async function loadListings(signal) {
    const data = await api("/api/model-listings?mine=1", signal ? { signal } : {});
    if (signal?.aborted) return;
    listings = data.listings || [];
    renderListings();
  }

  async function loadStoreSettings(signal) {
    const data = await api("/api/users/me/store-settings", signal ? { signal } : {});
    if (signal?.aborted) return;
    storeSettings = data.store_settings || {};
    fillSettingsForm();
  }

  function fillSettingsForm() {
    const root = document.getElementById("pref-store-root");
    if (!root) return;
    const set = (id, val) => {
      const el = root.querySelector(`#${id}`);
      if (!el) return;
      if (el.type === "checkbox") el.checked = !!val;
      else el.value = val ?? "";
    };
    set("pref-store-enabled", storeSettings.store_enabled);
    set("pref-store-title", storeSettings.store_title || "");
    set("pref-store-tagline", storeSettings.store_tagline || "");
    set("pref-store-license", storeSettings.default_license || "proprietary");
    set("pref-store-access", storeSettings.default_access_mode || "paid");
    set("pref-store-billing", storeSettings.default_billing_type || "one_time");
    set("pref-store-currency", storeSettings.default_currency || "USD");
    set("pref-store-price", ((storeSettings.default_price_cents || 0) / 100).toFixed(2));
    set("pref-store-download", storeSettings.download_enabled !== false);
    set("pref-store-show-profile", storeSettings.show_on_profile !== false);
    set("pref-store-slug", storeSettings.store_slug || "");
    set("pref-store-refunds", storeSettings.refunds_allowed !== false);
    set("pref-store-refund-days", storeSettings.refund_window_days ?? 14);
  }

  function readSettingsForm() {
    const root = document.getElementById("pref-store-root");
    const val = (id) => root?.querySelector(`#${id}`);
    const price = Number(val("pref-store-price")?.value || 0);
    return {
      store_enabled: !!val("pref-store-enabled")?.checked,
      store_title: val("pref-store-title")?.value || "",
      store_tagline: val("pref-store-tagline")?.value || "",
      default_license: val("pref-store-license")?.value || "proprietary",
      default_access_mode: val("pref-store-access")?.value || "paid",
      default_billing_type: val("pref-store-billing")?.value || "one_time",
      default_currency: val("pref-store-currency")?.value || "USD",
      default_price_cents: Math.round(Math.max(0, price) * 100),
      download_enabled: !!val("pref-store-download")?.checked,
      show_on_profile: !!val("pref-store-show-profile")?.checked,
      store_slug: val("pref-store-slug")?.value || "",
      refunds_allowed: !!val("pref-store-refunds")?.checked,
      refund_window_days: Number(val("pref-store-refund-days")?.value || 14),
    };
  }

  function renderExplorer() {
    const host = document.getElementById("pref-store-explorer");
    const chips = document.getElementById("pref-store-selected");
    if (!host) return;
    if (!projects.length) {
      host.innerHTML = `<p class="muted small">No projects yet. Create a project, then pick models here.</p>`;
    } else {
      host.innerHTML = projects
        .map((p) => {
          const open = expanded.has(p.id);
          const files = projectFiles.get(p.id) || [];
          const fileRows = open
            ? files
                .map((f) => {
                  const key = `${p.id}::${f.name}`;
                  const sel = selected.has(key) ? " is-selected" : "";
                  return `<button type="button" class="pref-store-tree-item pref-store-indent-2${sel}" data-kind="file" data-project="${esc(p.id)}" data-file="${esc(f.name)}">
                    <span>📄 ${esc(f.name)}</span>
                    <span class="muted">${esc(f.format || "")}</span>
                  </button>`;
                })
                .join("") || `<div class="muted small pref-store-indent-2">No model files in this project.</div>`
            : "";
          return `<button type="button" class="pref-store-tree-item" data-kind="project" data-project="${esc(p.id)}">
              <span>${open ? "▾" : "▸"} 📁 ${esc(p.name || p.id)}</span>
              <span class="muted">${esc(p.file_count || 0)} files</span>
            </button>
            ${open ? `<button type="button" class="pref-store-tree-item pref-store-indent-1" data-kind="select-folder" data-project="${esc(p.id)}">Select all models in project</button>` : ""}
            ${fileRows}`;
        })
        .join("");
    }
    if (chips) {
      const items = selectedList();
      chips.innerHTML = items.length
        ? items
            .map(
              (s) => `<span class="pref-store-chip">${esc(s.filename)} <button type="button" data-remove-sel="${esc(`${s.projectId}::${s.filename}`)}" aria-label="Remove">×</button></span>`
            )
            .join("")
        : `<span class="muted small">Drag files here, or click / Shift+click to multi-select. Select a project folder to add all models.</span>`;
    }
  }

  function renderListings() {
    const host = document.getElementById("pref-store-listings");
    if (!host) return;
    if (!listings.length) {
      host.innerHTML = `<p class="muted small">No store listings yet. Publish models from the explorer.</p>`;
      return;
    }
    host.innerHTML = `<ul class="pref-store-listings">${listings
      .map((l) => {
        const badge = `pref-store-badge is-${esc(l.status || "pending")}`;
        const price =
          l.access_mode === "free"
            ? "Free"
            : `${money(l.price_cents, l.currency)}${l.billing_type === "subscription" ? " / mo" : ""}`;
        return `<li>
          <div><strong>${esc(l.name)}</strong> <span class="${badge}">${esc(l.status)}</span></div>
          <div class="muted small">${esc(price)} · ${esc(l.license)} · ${esc(l.access_mode)}</div>
          <div class="muted small">${esc((l.files || []).map((f) => f.name || f.filename).filter(Boolean).join(", ") || "No files")}</div>
        </li>`;
      })
      .join("")}</ul>`;
  }

  async function saveSettings() {
    const status = document.getElementById("pref-store-status");
    if (status) status.textContent = "Saving store settings…";
    const data = await api("/api/users/me/store-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readSettingsForm()),
    });
    storeSettings = data.store_settings || {};
    if (status) status.textContent = "Store settings saved.";
  }

  async function publishSelected() {
    const status = document.getElementById("pref-store-status");
    const items = selectedList();
    if (!items.length) {
      if (status) status.textContent = "Select at least one model file first.";
      return;
    }
    const byProject = new Map();
    for (const item of items) {
      if (!byProject.has(item.projectId)) byProject.set(item.projectId, []);
      byProject.get(item.projectId).push(item.filename);
    }
    // One listing per project selection batch (first project if mixed)
    const [projectId, filenames] = [...byProject.entries()][0];
    const settings = readSettingsForm();
    const name = document.getElementById("pref-store-listing-name")?.value?.trim() || filenames[0].replace(/\.[^.]+$/, "");
    const tagline = document.getElementById("pref-store-listing-tagline")?.value?.trim() || settings.store_tagline || "Studio model";
    const description =
      document.getElementById("pref-store-listing-desc")?.value?.trim() ||
      settings.store_tagline ||
      `Published from Render Studio project files: ${filenames.join(", ")}`;
    if (status) status.textContent = "Publishing to store…";
    try {
      const data = await api("/api/model-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          tagline,
          description,
          license: settings.default_license,
          access_mode: settings.default_access_mode,
          billing_type: settings.default_billing_type,
          currency: settings.default_currency,
          price_cents: settings.default_access_mode === "paid" ? settings.default_price_cents || 100 : 0,
          download_enabled: settings.download_enabled,
          project_id: projectId,
          project_filenames: filenames.slice(0, 8),
        }),
      });
      if (status) status.textContent = data.message || "Submitted for review.";
      selected.clear();
      await loadListings();
      renderExplorer();
    } catch (err) {
      if (status) status.textContent = err.message || "Publish failed.";
    }
  }

  function bindExplorerEvents() {
    const host = document.getElementById("pref-store-explorer");
    const chips = document.getElementById("pref-store-selected");
    if (!host || host.dataset.bound === "1") return;
    host.dataset.bound = "1";

    host.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-kind]");
      if (!btn) return;
      const kind = btn.getAttribute("data-kind");
      const projectId = btn.getAttribute("data-project");
      if (kind === "project") {
        if (expanded.has(projectId)) expanded.delete(projectId);
        else {
          expanded.add(projectId);
          try {
            await ensureProjectFiles(projectId);
          } catch (err) {
            const status = document.getElementById("pref-store-status");
            if (status) status.textContent = err.message || "Could not load project files.";
          }
        }
        renderExplorer();
        return;
      }
      if (kind === "select-folder") {
        try {
          await ensureProjectFiles(projectId);
          selectWholeProject(projectId);
        } catch (err) {
          const status = document.getElementById("pref-store-status");
          if (status) status.textContent = err.message || "Could not select folder.";
        }
        return;
      }
      if (kind === "file") {
        const filename = btn.getAttribute("data-file");
        const file = (projectFiles.get(projectId) || []).find((f) => f.name === filename);
        if (!file) return;
        toggleFile(projectId, file, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
      }
    });

    host.addEventListener("dragover", (e) => {
      e.preventDefault();
      host.classList.add("is-dragover");
    });
    host.addEventListener("dragleave", () => host.classList.remove("is-dragover"));
    host.addEventListener("drop", async (e) => {
      e.preventDefault();
      host.classList.remove("is-dragover");
      // Dropping a project row target: if a file button is under cursor, ignore OS files —
      // OS file drops aren't mapped to studio projects; show hint.
      const status = document.getElementById("pref-store-status");
      if (status) {
        status.textContent = "Drag within the explorer to organize selection, or click files / “Select all models in project”. OS file drops publish via the Model Store upload page.";
      }
    });

    chips?.addEventListener("click", (e) => {
      const key = e.target.getAttribute?.("data-remove-sel");
      if (!key) return;
      selected.delete(key);
      renderExplorer();
    });
  }

  function panelHtml() {
    return `
      <div id="pref-store-root" class="pref-store-shell">
        <p class="muted small">Configure your public storefront, then pick Studio models to advertise. Listings go through review before appearing in the Model Store.</p>
        <div class="pref-store-grid">
          <div class="pref-store-panel">
            <h4>Public store options</h4>
            <label class="profile-preference-field"><span><b>Enable storefront on profile</b></span>
              <input id="pref-store-enabled" type="checkbox" />
            </label>
            <label class="profile-preference-field"><span><b>Store title</b></span>
              <input id="pref-store-title" type="text" maxlength="80" placeholder="My CAD store" />
            </label>
            <label class="profile-preference-field"><span><b>Store tagline</b></span>
              <input id="pref-store-tagline" type="text" maxlength="180" placeholder="Print-ready parts & assemblies" />
            </label>
            <label class="profile-preference-field"><span><b>Default license</b></span>
              <select id="pref-store-license">
                <option value="proprietary">Proprietary</option>
                <option value="royalty-free">Royalty-free</option>
                <option value="cc0">CC0</option>
                <option value="cc-by">CC BY</option>
                <option value="cc-by-sa">CC BY-SA</option>
                <option value="cc-by-nc">CC BY-NC</option>
                <option value="editorial">Editorial</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label class="profile-preference-field"><span><b>Default access</b></span>
              <select id="pref-store-access">
                <option value="paid">Paid download</option>
                <option value="free">Free download</option>
                <option value="view_only">View only</option>
              </select>
            </label>
            <label class="profile-preference-field"><span><b>Pricing type</b></span>
              <select id="pref-store-billing">
                <option value="one_time">One-time fee</option>
                <option value="subscription">Subscription</option>
              </select>
            </label>
            <label class="profile-preference-field"><span><b>Default price</b></span>
              <span style="display:flex;gap:8px;align-items:center">
                <input id="pref-store-price" type="number" min="0" step="0.01" value="9.00" style="flex:1" />
                <select id="pref-store-currency"><option>USD</option><option>EUR</option><option>GBP</option></select>
              </span>
            </label>
            <label class="profile-preference-field"><span><b>Allow downloads</b></span>
              <input id="pref-store-download" type="checkbox" checked />
            </label>
            <label class="profile-preference-field"><span><b>Store URL slug</b></span>
              <input id="pref-store-slug" type="text" maxlength="48" placeholder="og-store" />
              <small class="muted">Public link: render3d.app/<em>slug</em></small>
            </label>
            <div id="pref-store-cover"></div>
            <label class="profile-preference-field"><span><b>Allow refunds</b></span>
              <input id="pref-store-refunds" type="checkbox" checked />
            </label>
            <label class="profile-preference-field"><span><b>Refund window (days)</b></span>
              <input id="pref-store-refund-days" type="number" min="0" max="365" value="14" />
            </label>
            <label class="profile-preference-field"><span><b>Show store on public profile</b></span>
              <input id="pref-store-show-profile" type="checkbox" checked />
            </label>
            <p class="muted small">Receive money is in the Payments tab — not duplicated here.</p>
            <button type="button" class="btn secondary btn-compact" id="pref-store-open-payments">Open Payments</button>
            <button type="button" class="btn accent btn-compact" id="pref-store-save-settings">Save store settings</button>
          </div>
          <div class="pref-store-panel">
            <h4>Publish from Studio explorer</h4>
            <p class="muted small">Click a project to expand. Click files to select; hold <b>Shift</b> for a range; use “Select all models in project” for a whole folder.</p>
            <div id="pref-store-explorer" class="pref-store-explorer" tabindex="0"></div>
            <div id="pref-store-selected" class="pref-store-selected"></div>
            <label class="profile-preference-field"><span><b>Listing name</b></span>
              <input id="pref-store-listing-name" type="text" maxlength="120" placeholder="Optional — defaults to first file name" />
            </label>
            <label class="profile-preference-field"><span><b>Listing tagline</b></span>
              <input id="pref-store-listing-tagline" type="text" maxlength="180" placeholder="Optional" />
            </label>
            <label class="profile-preference-field"><span><b>Description</b></span>
              <textarea id="pref-store-listing-desc" rows="3" maxlength="4000" placeholder="What buyers get…"></textarea>
            </label>
            <button type="button" class="btn accent btn-compact" id="pref-store-publish">Publish selected to Model Store</button>
          </div>
        </div>
        <div class="pref-store-panel">
          <h4>My listings</h4>
          <div id="pref-store-listings"></div>
        </div>
        <p id="pref-store-status" class="muted small profile-preferences-note"></p>
      </div>
    `;
  }

  async function hydrate(panel) {
    const mount = panel?.querySelector("[data-preferences-advanced-panel='store']");
    if (!mount) return;
    if (!mount.querySelector("#pref-store-root")) {
      const body = mount.querySelector("[data-store-body]");
      if (body) body.innerHTML = panelHtml();
      else mount.insertAdjacentHTML("beforeend", `<div data-store-body>${panelHtml()}</div>`);
    }
    bindExplorerEvents();
    const saveBtn = document.getElementById("pref-store-save-settings");
    const pubBtn = document.getElementById("pref-store-publish");
    const payBtn = document.getElementById("pref-store-open-payments");
    if (payBtn && payBtn.dataset.bound !== "1") {
      payBtn.dataset.bound = "1";
      payBtn.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("render3d:open-preferences-tab", { detail: { tab: "payments" } }));
      });
    }
    if (saveBtn && saveBtn.dataset.bound !== "1") {
      saveBtn.dataset.bound = "1";
      saveBtn.addEventListener("click", () => void saveSettings());
    }
    if (pubBtn && pubBtn.dataset.bound !== "1") {
      pubBtn.dataset.bound = "1";
      pubBtn.addEventListener("click", () => void publishSelected());
    }
    const ctl = beginStorePrefsFetch();
    try {
      await Promise.all([
        loadStoreSettings(ctl.signal),
        loadProjects(ctl.signal),
        loadListings(ctl.signal),
      ]);
      if (ctl.signal.aborted) return;
      const coverHost = document.getElementById("pref-store-cover");
      if (coverHost) {
        const { bindCoverEditor, coverEditorHtml } = await import("./store-cover.js?v=20260908-store-ux");
        let cover = {};
        try {
          const me = await api("/api/marketplace/store/me", { signal: ctl.signal });
          if (ctl.signal.aborted) return;
          cover = me.cover || {};
        } catch (err) {
          if (ctl.signal.aborted || err?.name === "AbortError") return;
          cover = {};
        }
        coverHost.innerHTML = coverEditorHtml(cover, { heading: true });
        bindCoverEditor(coverHost);
      }
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      const status = document.getElementById("pref-store-status");
      if (status) status.textContent = err.message || "Could not load store data.";
    } finally {
      if (storePrefsAbort === ctl) storePrefsAbort = null;
    }
  }

  return { hydrate, panelHtml };
}

export default createStorePreferencesUI;
