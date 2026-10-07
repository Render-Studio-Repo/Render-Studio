/** Context Lab — connect machines, save customers, nested Improve. Reuses Studio Improve. */

import { authHeaders } from "../studio/auth.js?v=20260907-session-keep";
import { createMiniViewer } from "../viewport/mini-viewer.js?v=20260916-shared-previews2-20260724-texture-keep-20260907-iphone-view2-20260724-mesh-pbr-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2&xrtalk=20260916-1&astra=20260916-5&webglrevert2&miniview1&gpu=20260916-startup2&gpu=20260916-startup3";
import { fetchSkillsCatalog, getEnabledSkills } from "./skills-library.js?v=20260906-mesh-nomcm&leakfix85";
import { getSelectedKnowledgeBaseIds } from "./knowledge-base.js?v=20260907-ctx-lab&leakfix73&leakfix93";

const STORAGE_CUSTOM = "render3d:context-lab:custom-off";

function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, options = {}, timeoutMs = 60000) {
  const headers = { ...authHeaders(), ...(options.headers || {}) };
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(path, { ...options, headers, signal: ctrl?.signal });
    if (!res.ok) {
      let message = res.statusText || "Request failed";
      try {
        const data = await res.json();
        message = data.detail || message;
      } catch {
        /* ignore */
      }
      throw new Error(typeof message === "string" ? message : JSON.stringify(message));
    }
    if (res.status === 204) return null;
    return res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function field(label, inner) {
  return `<label>${esc(label)}${inner}</label>`;
}

const PANES = [
  ["machines", "Machines"],
  ["print", "Print"],
  ["customers", "Customers"],
];

const IMPROVE_TABS = [
  ["settings", "Settings"],
  ["notes", "Notes"],
  ["custom", "Custom"],
  ["example", "Example"],
  ["files", "Files"],
  ["lab", "Lab"],
  ["sources", "Sources"],
];

export function getContextLabImproveFields() {
  try {
    if (localStorage.getItem(STORAGE_CUSTOM) === "1") {
      return { use_context_lab: true, custom_improve_id: null, context_custom_off: true };
    }
  } catch {
    /* ignore */
  }
  return { use_context_lab: true };
}

export function createContextLabUI({
  iconBtn,
  badgeEl,
  getProjectId,
  getPromptText,
  getPromptImages,
  getPromptMode,
  getAiKeyFields,
  startLabJobs,
  openKnowledge,
  openSkills,
  openRenderAgent,
  sendSelectionToAgent,
  onStatus,
} = {}) {
  const modal = document.getElementById("context-lab-modal");
  const bodyEl = document.getElementById("ctx-lab-body");
  const tabHost = document.getElementById("ctx-lab-tabs");
  const overlay = document.getElementById("improve-lab-overlay");
  let snap = null;
  let pane = "machines";
  let improveOpen = false;
  let improveTab = "settings";
  let editingMachineId = null;
  let editingCustomerId = null;
  let formStatus = "";
  let exampleSeed = "";
  let exampleGhost = true;
  let exampleRight = "";
  let labViewers = [];
  let selectedSlotKinds = ["original", "builtin"];
  let selectedCustomIds = [];
  let fileDraft = { name: "Photo / CAD instructions", instructions: "", skill_ids: [], knowledge_base_ids: [] };
  let catalogQuery = "";
  let selectedCatalogId = "";
  let machineListOpen = false;
  let machineEditOpen = false;
  const SAVED_VISIBLE = 4;
  const PRINTER_KINDS = new Set(["fdm_printer", "resin_printer", "sls_printer"]);

  function note(kind, message) {
    if (typeof onStatus === "function") onStatus(kind, message);
  }

  function customOff() {
    try {
      return localStorage.getItem(STORAGE_CUSTOM) === "1";
    } catch {
      return false;
    }
  }

  function setCustomOff(off) {
    try {
      if (off) localStorage.setItem(STORAGE_CUSTOM, "1");
      else localStorage.removeItem(STORAGE_CUSTOM);
    } catch {
      /* ignore */
    }
    syncIcon();
  }

  function syncIcon() {
    const on = Boolean(
      snap?.active_profile
      || snap?.active_customer
      || (snap?.settings?.toggles && Object.values(snap.settings.toggles).some(Boolean))
      || (snap?.custom_improves || []).some((c) => c.is_active && !customOff()),
    );
    iconBtn?.classList.toggle("is-on", on);
    iconBtn?.setAttribute("aria-pressed", on ? "true" : "false");
    if (badgeEl) {
      const n = (snap?.profiles || []).length
        + (snap?.customers || []).length
        + (snap?.custom_improves || []).filter((c) => c.is_active).length;
      badgeEl.textContent = String(n);
      badgeEl.classList.toggle("hidden", n < 1);
    }
  }

  let contextLabAbort = null; // leakfix68
  function beginContextLabFetch() {
    if (contextLabAbort) {
      try { contextLabAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    contextLabAbort = ctl;
    return ctl;
  }

  let driveFoldersAbort = null; // leakfix92
  function beginDriveFoldersFetch() {
    if (driveFoldersAbort) {
      try { driveFoldersAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    driveFoldersAbort = ctl;
    return ctl;
  }

  async function refresh() {
    const ctl = beginContextLabFetch();
    try {
      snap = await api("/api/context-lab", { signal: ctl.signal });
      if (ctl.signal.aborted) return;
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      if (!snap) {
        snap = {
          catalog: [],
          kinds: [],
          profiles: [],
          customers: [],
          settings: { definitions: [], toggles: {} },
          note_folders: [],
          custom_improves: [],
          file_instructions: [],
          categories: [],
          benchmarks: [],
          drive: {},
        };
      }
      formStatus = err.message || "Could not load Context Lab.";
      syncIcon();
      render();
      throw err;
    } finally {
      if (contextLabAbort === ctl) contextLabAbort = null;
    }
    if (editingMachineId && !(snap.profiles || []).some((p) => p.id === editingMachineId)) {
      editingMachineId = null;
    }
    if (editingCustomerId && !(snap.customers || []).some((c) => c.id === editingCustomerId)) {
      editingCustomerId = null;
    }
    if (!exampleSeed) {
      exampleSeed = snap?.example?.prompt || "create a enclosure and mount for a";
      exampleRight = snap?.example?.improved || "";
      exampleGhost = true;
    }
    syncIcon();
    render();
  }

  function open() {
    exampleSeed = "";
    exampleGhost = true;
    exampleRight = "";
    formStatus = "";
    modal?.classList.remove("hidden");
    iconBtn?.setAttribute("aria-expanded", "true");
    if (!snap) render();
    void refresh().catch((err) => note("error", err.message || "Could not load Context Lab"));
  }

  function close() {
    if (driveFoldersAbort) {
      try { driveFoldersAbort.abort(); } catch (_) { /* ignore */ }
    }
    machineEditOpen = false;
    machineListOpen = false;
    modal?.classList.add("hidden");
    iconBtn?.setAttribute("aria-expanded", "false");
  }

  function renderNav() {
    if (!tabHost) return;
    tabHost.innerHTML = `
      <div class="ctx-lab-panes" role="tablist" aria-label="Context Lab">
        ${PANES.map(([id, label]) => `
          <button type="button" class="ctx-lab-pane" data-ctx-pane="${id}" aria-selected="${pane === id ? "true" : "false"}">${esc(label)}</button>
        `).join("")}
      </div>
      <button type="button" class="ctx-lab-improve-toggle" data-ctx-improve-toggle aria-expanded="${improveOpen ? "true" : "false"}">
        Improve
      </button>
    `;
  }

  function render() {
    renderNav();
    if (!bodyEl) return;
    if (!snap) {
      bodyEl.innerHTML = `<p class="muted">Loading Context Lab…</p>`;
      return;
    }
    const improveMap = {
      settings: renderSettings,
      notes: renderNotes,
      custom: renderCustom,
      example: renderExample,
      files: renderFiles,
      lab: renderLab,
      sources: renderSources,
    };
    const main = pane === "customers" ? renderCustomer() : pane === "print" ? renderPrint() : renderMachine();
    const improve = improveOpen ? `
      <section class="ctx-lab-improve" id="ctx-lab-improve">
        <header class="ctx-lab-improve-head">
          <div>
            <strong>Improve details</strong>
            <p class="muted small">Optional overlays — Studio Improve, Skills, Knowledge, and Render Agent stay the same.</p>
          </div>
        </header>
        <div class="ctx-lab-improve-tabs" role="tablist" aria-label="Improve details">
          ${IMPROVE_TABS.map(([id, label]) => `
            <button type="button" class="ctx-lab-improve-tab" data-ctx-improve-tab="${id}" aria-selected="${improveTab === id ? "true" : "false"}">${esc(label)}</button>
          `).join("")}
        </div>
        <div class="ctx-lab-improve-body">${(improveMap[improveTab] || renderSettings)()}</div>
      </section>
    ` : "";
    bodyEl.innerHTML = `${main}${improve}`;
    renderPopups();
    bind();
  }

  function popupHost() {
    const card = modal?.querySelector(".ctx-lab-card");
    if (!card) return null;
    let host = card.querySelector("#ctx-lab-popups");
    if (!host) {
      host = document.createElement("div");
      host.id = "ctx-lab-popups";
      card.appendChild(host);
    }
    return host;
  }

  function labQuery(sel) {
    return popupHost()?.querySelector(sel) || bodyEl?.querySelector(sel);
  }

  const ORCA_PNG_IDS = new Set(["prusa-mk4", "prusa-mini", "prusa-xl", "bambu-x1c", "bambu-p1s", "bambu-a1", "bambu-a1-mini", "ender-3-v3", "voron-24"]);

  function machineThumbUrl(row = {}) {
    const catalogId = row.catalog_id || ((snap?.catalog || []).some((m) => m.id === row.id) ? row.id : "");
    if (catalogId && ORCA_PNG_IDS.has(catalogId)) return `/machine-thumbs/${catalogId}.png`;
    if (row.image_url) return row.image_url;
    if (row.catalog_id) return `/machine-thumbs/${row.catalog_id}.svg`;
    if (row.id && (snap?.catalog || []).some((m) => m.id === row.id)) return `/machine-thumbs/${row.id}.svg`;
    return `/machine-thumbs/${row.kind || "other"}.svg`;
  }

  function machineDraft() {
    const profiles = snap?.profiles || [];
    const editing = profiles.find((p) => p.id === editingMachineId) || null;
    if (editing) return editing;
    const row = catalogById(selectedCatalogId);
    if (!row) return { catalog_id: "", kind: "fdm_printer" };
    return {
      catalog_id: row.id,
      kind: row.kind,
      brand: row.brand,
      model: row.model,
      name: `${row.brand} ${row.model}`.trim(),
      specs: row,
      kind_label: row.kind_label,
      fit_clearances: row.fit_clearances,
      image_url: row.image_url,
    };
  }

  function isPrinterKind(kind) {
    return PRINTER_KINDS.has(String(kind || ""));
  }

  function toleranceHover(draft = {}) {
    const clear = draft.fit_clearances || {};
    const machine = `${draft.brand || ""} ${draft.model || draft.name || "this printer"}`.trim();
    const sliding = clear.sliding_mm != null ? Number(clear.sliding_mm).toFixed(2) : "0.20";
    return `When on, Improve adds assembly/print-fit clearances matched to ${machine} accuracy (about ${sliding} mm sliding / XY). Sliding fits, snaps, screw bosses, and lids get that clearance so parts assemble after printing. Turn off to omit this from the Improve prompt.`;
  }

  function toleranceSwitchHtml(draft, { compact = false } = {}) {
    if (!isPrinterKind(draft.kind)) return "";
    const on = Boolean(draft.specs?.printer_tolerance || draft.printer_tolerance);
    const title = esc(toleranceHover(draft));
    return `
      <label class="ctx-switch-row${compact ? " is-compact" : ""}" title="${title}">
        <span>
          <b>Tolerance</b>
          ${compact ? "" : `<small>Add printer-accurate fit clearance to Improve</small>`}
        </span>
        <span class="ctx-switch">
          <input type="checkbox" ${compact ? "" : `id="ctx-machine-tolerance"`} data-ctx-tolerance="${compact ? "active" : "draft"}" ${on ? "checked" : ""} aria-label="Tolerance" />
          <span class="ctx-switch-ui" aria-hidden="true"></span>
        </span>
      </label>
    `;
  }

  function improveApplyState() {
    const active = snap?.active_profile;
    if (active) {
      return {
        kind: "applied",
        text: `Improve uses ${active.name} live — edits, Tolerance, and settings apply immediately.`,
      };
    }
    return {
      kind: "empty",
      text: "Save or Use a machine to apply it to Improve.",
    };
  }

  function filteredCatalog() {
    const q = catalogQuery.trim().toLowerCase();
    const rows = snap?.catalog || [];
    if (!q) return rows;
    return rows.filter((m) => {
      const hay = `${m.brand} ${m.model} ${m.kind_label || ""} ${m.kind || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function catalogThumbsHtml(selectedId) {
    const selected = selectedId || selectedCatalogId || machineDraft().catalog_id || "";
    const customOn = !selected;
    const items = [
      `<button type="button" class="ctx-machine-thumb${customOn ? " is-selected" : ""}" data-catalog-pick="" title="Custom specs">
        <img src="/machine-thumbs/custom.svg" alt="" />
        <span>Custom specs</span>
      </button>`,
      ...filteredCatalog().map((m) => `
        <button type="button" class="ctx-machine-thumb${selected === m.id ? " is-selected" : ""}" data-catalog-pick="${esc(m.id)}" title="${esc(m.brand)} ${esc(m.model)}">
          <img src="${esc(machineThumbUrl(m))}" alt="" />
          <span>${esc(m.brand)} ${esc(m.model)}</span>
        </button>
      `),
    ];
    return items.join("");
  }

  function savedMachineRowHtml(p, { compact = false } = {}) {
    const editing = editingMachineId === p.id;
    const active = snap?.active_profile?.id === p.id;
    return `
      <article class="ctx-lab-card-row ctx-saved-machine${editing || active ? " is-active" : ""}" data-edit-machine="${esc(p.id)}">
        <img class="ctx-saved-machine-thumb" src="${esc(machineThumbUrl(p))}" alt="" />
        <div>
          <strong>${esc(p.name)}</strong>
          <div class="muted small">${esc(p.kind_label)} · ${esc(p.brand)} ${esc(p.model)}${p.is_active ? " · Improve" : ""}</div>
        </div>
        <span class="ctx-lab-actions">
          ${p.is_active ? "" : `<button type="button" class="btn secondary btn-compact" data-activate-machine="${esc(p.id)}">Use</button>`}
          <button type="button" class="btn danger btn-compact" data-delete-machine="${esc(p.id)}">Delete</button>
        </span>
      </article>
    `;
  }

  function renderActiveMachine() {
    const active = snap.active_profile;
    const state = improveApplyState();
    return `
      <section class="ctx-active-machine" aria-label="Active machine">
        <div class="ctx-active-machine-main">
          ${active ? `<img class="ctx-saved-machine-thumb" src="${esc(machineThumbUrl(active))}" alt="" />` : ""}
          <div>
            <p class="ctx-active-machine-label">Active machine</p>
            <strong>${active ? `${esc(active.name)} (${esc(active.kind_label)})` : "None yet"}</strong>
          </div>
        </div>
        <p class="ctx-improve-apply-status is-${esc(state.kind)}" role="status">${esc(state.text)}</p>
        ${active ? toleranceSwitchHtml(active, { compact: true }) : ""}
      </section>
    `;
  }

  function renderMachineFormFields(draft) {
    const status = formStatus && pane === "machines" ? `<p class="ctx-lab-status" role="status">${esc(formStatus)}</p>` : "";
    const editing = (snap.profiles || []).find((p) => p.id === editingMachineId) || null;
    return `
      <input type="hidden" id="ctx-machine-catalog" value="${esc(draft.catalog_id || selectedCatalogId || "")}" />
      ${field("Profile name", `<input id="ctx-machine-name" required maxlength="120" value="${esc(draft.name || "")}" placeholder="Shop MK4" />`)}
      ${field("Kind", `<select id="ctx-machine-kind">
        ${(snap.kinds || []).map((k) => `<option value="${esc(k.id)}"${(draft.kind || "fdm_printer") === k.id ? " selected" : ""}>${esc(k.label)}</option>`).join("")}
      </select>`)}
      ${field("Brand", `<input id="ctx-machine-brand" value="${esc(draft.brand || "")}" placeholder="Prusa, Bambu, Haas…" />`)}
      ${field("Model", `<input id="ctx-machine-model" value="${esc(draft.model || "")}" placeholder="MK4, X1C, VF-2…" />`)}
      ${field("Volume / bed (mm)", `<input id="ctx-machine-volume" value="${esc(fmtSpec(draft.specs))}" placeholder="250 × 210 × 220 or bed 500 × 300" />`)}
      ${field("Nozzle / kerf / tool (mm)", `<input id="ctx-machine-nozzle" value="${esc(draft.specs?.nozzle_mm ?? draft.specs?.kerf_mm ?? draft.specs?.min_tool_mm ?? "")}" placeholder="0.4" />`)}
      ${toleranceSwitchHtml(draft)}
      ${field("Stock / notes", `<textarea id="ctx-machine-notes" rows="3" placeholder="Max stock, fixture, materials…">${esc(draft.specs?.notes || "")}</textarea>`)}
      ${status}
      <p class="muted small">${editing ? "Update machine saves the profile. If this machine is active, Improve updates immediately." : "Save machine writes the profile and applies it to Improve when it is the active machine."}</p>
    `;
  }

  function renderPrint() {
    const profiles = snap.print_profiles || [];
    const filaments = snap.filaments || ["PLA", "PETG", "ABS", "ASA", "TPU", "Nylon", "PLA-CF"];
    const def = snap.default_print_profile || profiles.find((p) => p.is_default) || null;
    return `
      <p class="ctx-hint">Save filament + supports profiles. The default is applied when you export to Bambu Studio.</p>
      <div class="ctx-saved-block ctx-print-block">
        <div class="ctx-lab-list-head">
          <strong>Print profiles</strong>
        </div>
        <form class="ctx-print-form" data-print-form>
          ${field("Profile name", `<input id="ctx-print-name" maxlength="80" value="" placeholder="PLA · supports" />`)}
          ${field("Preferred filament", `<select id="ctx-print-filament">
            ${filaments.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("")}
          </select>`)}
          <label class="profile-preference-switch ctx-print-supports">
            <span><b>Supports enabled</b><small>Default for Bambu / slicer export</small></span>
            <input id="ctx-print-supports" type="checkbox" checked />
          </label>
          <label class="profile-preference-switch">
            <span><b>Set as default export profile</b></span>
            <input id="ctx-print-default" type="checkbox" ${def ? "" : "checked"} />
          </label>
          <button type="submit" class="btn btn-compact">Save profile</button>
        </form>
        <div class="ctx-saved-machines" id="ctx-print-profiles">
          ${profiles.length ? profiles.map((p) => `
            <div class="ctx-saved-machine${p.is_default ? " is-active" : ""}" data-print-id="${esc(p.id)}">
              <div>
                <strong>${esc(p.name)}</strong>
                <p class="muted small">${esc(p.filament)} · supports ${p.supports_enabled ? "on" : "off"}${p.is_default ? " · default" : ""}</p>
              </div>
              <div class="ctx-print-row-actions">
                ${p.is_default ? "" : `<button type="button" class="btn secondary btn-compact" data-print-default="${esc(p.id)}">Default</button>`}
                <button type="button" class="btn secondary btn-compact" data-print-delete="${esc(p.id)}">Delete</button>
              </div>
            </div>
          `).join("") : `<div class="ctx-lab-empty"><strong>No print profiles yet</strong>Save filament + supports above.</div>`}
        </div>
      </div>
    `;
  }

  function renderMachine() {
    const profiles = snap.profiles || [];
    const visible = profiles.slice(0, SAVED_VISIBLE);
    const hiddenCount = Math.max(0, profiles.length - visible.length);
    return `
      <p class="ctx-hint">Search the catalog, pick a printer thumbnail, then save. The active machine is live in Improve — no extra apply step.</p>
      <div class="ctx-saved-block">
        <div class="ctx-lab-list-head">
          <strong>Saved machines</strong>
          <button type="button" class="btn secondary btn-compact" data-new-machine>New</button>
        </div>
        ${renderActiveMachine()}
        <div class="ctx-saved-machines" id="ctx-saved-machines">
          ${profiles.length ? visible.map((p) => savedMachineRowHtml(p, { compact: true })).join("") : `
            <div class="ctx-lab-empty">
              <strong>No machine saved yet</strong>
              Pick a printer below, then Save machine. Extra saved printers stay in Expand — they will not overlay the lab.
            </div>`}
        </div>
        ${hiddenCount ? `
          <button type="button" class="btn secondary btn-compact ctx-expand-machines" data-expand-machines>
            Expand ${hiddenCount} more machine${hiddenCount === 1 ? "" : "s"}
          </button>
        ` : (profiles.length > 1 ? `
          <button type="button" class="btn secondary btn-compact ctx-expand-machines" data-expand-machines>Expand all machines</button>
        ` : "")}
        <div class="ctx-catalog-block">
          <label class="ctx-machine-search-label" for="ctx-machine-search">Printers &amp; machines</label>
          <input id="ctx-machine-search" class="ctx-machine-search" type="search" placeholder="Search printers — Bambu, Prusa, Haas…" value="${esc(catalogQuery)}" />
          <div class="ctx-machine-thumbs" id="ctx-machine-catalog-grid">${catalogThumbsHtml()}</div>
        </div>
      </div>
    `;
  }

  function renderPopups() {
    const host = popupHost();
    if (!host) return;
    if (pane !== "machines") {
      machineEditOpen = false;
      machineListOpen = false;
      host.innerHTML = "";
      return;
    }
    const draft = machineDraft();
    const editing = (snap?.profiles || []).find((p) => p.id === editingMachineId) || null;
    const saveLabel = editing ? "Update machine" : "Save machine";
    const list = machineListOpen ? `
      <div class="ctx-lab-list-popup" role="dialog" aria-modal="true" aria-labelledby="ctx-machine-list-title">
        <button type="button" class="ctx-lab-popup-backdrop" data-close-machine-list aria-label="Close machine list"></button>
        <div class="ctx-lab-list-card">
          <header class="ctx-lab-popup-head">
            <strong id="ctx-machine-list-title">All saved machines</strong>
            <button type="button" class="auth-close" data-close-machine-list aria-label="Close">&times;</button>
          </header>
          <div class="ctx-lab-list-popup-body">
            ${(snap.profiles || []).map((p) => savedMachineRowHtml(p)).join("") || `<p class="muted small">No machines saved.</p>`}
          </div>
        </div>
      </div>
    ` : "";
    const edit = machineEditOpen ? `
      <div class="ctx-lab-edit-popup" role="dialog" aria-modal="true" aria-labelledby="ctx-edit-title">
        <button type="button" class="ctx-lab-popup-backdrop" data-close-machine-edit aria-label="Close editor"></button>
        <form class="ctx-lab-edit-card ctx-lab-form" id="ctx-machine-form">
          <header class="ctx-lab-popup-head">
            <div class="ctx-lab-edit-head-main">
              ${draft.image_url || machineThumbUrl(draft) ? `<img class="ctx-edit-machine-thumb" src="${esc(machineThumbUrl(draft))}" alt="" />` : ""}
              <p class="ctx-lab-form-kicker" id="ctx-edit-title">${editing ? `Editing <strong>${esc(editing.name)}</strong>` : "Connect a machine"}</p>
            </div>
            <button type="button" class="auth-close" data-close-machine-edit aria-label="Close">&times;</button>
          </header>
          <div class="ctx-lab-edit-scroll">
            ${renderMachineFormFields(draft)}
          </div>
          <footer class="ctx-lab-edit-footer">
            <button type="submit" class="btn accent" id="ctx-machine-save">${saveLabel}</button>
          </footer>
        </form>
      </div>
    ` : "";
    host.innerHTML = `${list}${edit}`;
  }

  function renderCustomer() {
    const customers = snap.customers || [];
    const active = snap.active_customer;
    const editing = customers.find((c) => c.id === editingCustomerId) || null;
    const draft = editing || {};
    const status = formStatus && pane === "customers" ? `<p class="ctx-lab-status" role="status">${esc(formStatus)}</p>` : "";
    return `
      <p class="ctx-hint">Save a named customer (or client) with notes. <strong>Save customer</strong> writes the profile — it shows in the list and is included in Improve.</p>
      <div class="ctx-lab-grid">
        <div>
          <div class="ctx-lab-list-head">
            <strong>Saved customers</strong>
            <button type="button" class="btn secondary btn-compact" data-new-customer>New</button>
          </div>
          ${active ? `<p class="muted small">Using for Improve: <strong>${esc(active.name)}</strong></p>` : ""}
          <div class="ctx-lab-list">
            ${customers.length ? customers.map((c) => `
              <article class="ctx-lab-card-row${c.id === (editing?.id || active?.id) ? " is-active" : ""}" data-edit-customer="${esc(c.id)}">
                <div>
                  <strong>${esc(c.name)}</strong>
                  <div class="muted small">${esc(c.company || "Customer")}${c.is_active ? " · Improve" : ""}</div>
                </div>
                <span class="ctx-lab-actions">
                  ${c.is_active ? "" : `<button type="button" class="btn secondary btn-compact" data-activate-customer="${esc(c.id)}">Use</button>`}
                  <button type="button" class="btn danger btn-compact" data-delete-customer="${esc(c.id)}">Delete</button>
                </span>
              </article>
            `).join("") : `
              <div class="ctx-lab-empty">
                <strong>No customer saved yet</strong>
                Add a name and notes on the right, then click Save customer.
              </div>`}
          </div>
        </div>
        <form class="ctx-lab-form" id="ctx-customer-form">
          <p class="ctx-lab-form-kicker">${editing ? `Editing <strong>${esc(editing.name)}</strong>` : "Save a customer"}</p>
          ${field("Customer name", `<input id="ctx-customer-name" required maxlength="120" value="${esc(draft.name || "")}" placeholder="Acme Robotics" />`)}
          ${field("Company / org", `<input id="ctx-customer-company" maxlength="120" value="${esc(draft.company || "")}" placeholder="Optional" />`)}
          ${field("Notes / settings", `<textarea id="ctx-customer-notes" rows="7" placeholder="Brand, materials, hardware rules, finish…">${esc(draft.notes || "")}</textarea>`)}
          ${status}
          <div class="ctx-lab-actions">
            <button type="submit" class="btn accent" id="ctx-customer-save">${editing ? "Update customer" : "Save customer"}</button>
          </div>
        </form>
      </div>
    `;
  }

  function fmtSpec(specs = {}) {
    if (specs?.volume_mm?.length >= 3) return specs.volume_mm.join(" × ");
    if (specs?.bed_mm?.length >= 2) return `bed ${specs.bed_mm.join(" × ")}`;
    return "";
  }

  function parseVolume(text) {
    const nums = String(text || "").match(/[\d.]+/g)?.map(Number) || [];
    if (nums.length >= 3) return { volume_mm: nums.slice(0, 3) };
    if (nums.length >= 2) return { bed_mm: nums.slice(0, 2) };
    return {};
  }

  function catalogById(id) {
    return (snap?.catalog || []).find((m) => m.id === id) || null;
  }

  function fillMachineFromCatalog(catalogId) {
    const row = catalogById(catalogId);
    selectedCatalogId = catalogId || "";
    const hidden = labQuery("#ctx-machine-catalog");
    if (hidden) hidden.value = catalogId || "";
    if (!row) return;
    const set = (sel, val) => {
      const el = labQuery(sel);
      if (el) el.value = val ?? "";
    };
    set("#ctx-machine-kind", row.kind);
    set("#ctx-machine-brand", row.brand);
    set("#ctx-machine-model", row.model);
    const nameEl = labQuery("#ctx-machine-name");
    if (nameEl) nameEl.value = `${row.brand} ${row.model}`.trim();
    const vol = Array.isArray(row.volume_mm) && row.volume_mm.length >= 3
      ? row.volume_mm.join(" × ")
      : (Array.isArray(row.bed_mm) && row.bed_mm.length >= 2 ? `bed ${row.bed_mm.join(" × ")}` : "");
    set("#ctx-machine-volume", vol);
    set("#ctx-machine-nozzle", row.nozzle_mm ?? row.kerf_mm ?? row.min_tool_mm ?? "");
  }

  function collectMachinePayload(activate) {
    const catalogId = labQuery("#ctx-machine-catalog")?.value || selectedCatalogId || "";
    const brand = labQuery("#ctx-machine-brand")?.value || "";
    const model = labQuery("#ctx-machine-model")?.value || "";
    const name = (labQuery("#ctx-machine-name")?.value || "").trim() || `${brand} ${model}`.trim();
    const existing = (snap?.profiles || []).find((p) => p.id === editingMachineId);
    if (!labQuery("#ctx-machine-name") && existing) {
      return {
        id: existing.id,
        catalog_id: existing.catalog_id || null,
        kind: existing.kind,
        brand: existing.brand,
        model: existing.model,
        name: existing.name,
        specs: existing.specs || {},
        activate,
      };
    }
    const nozzle = Number(labQuery("#ctx-machine-nozzle")?.value || "");
    const specs = {
      ...(existing?.specs || {}),
      ...parseVolume(labQuery("#ctx-machine-volume")?.value || ""),
      notes: labQuery("#ctx-machine-notes")?.value || existing?.specs?.notes || "",
    };
    if (Number.isFinite(nozzle) && nozzle > 0) specs.nozzle_mm = nozzle;
    const kind = labQuery("#ctx-machine-kind")?.value || existing?.kind || "fdm_printer";
    if (isPrinterKind(kind)) {
      const tolEl = labQuery("#ctx-machine-tolerance") || labQuery("[data-ctx-tolerance='draft']") || labQuery("[data-ctx-tolerance]");
      specs.printer_tolerance = Boolean(tolEl?.checked ?? existing?.specs?.printer_tolerance);
    } else {
      delete specs.printer_tolerance;
    }
    return {
      id: editingMachineId || null,
      catalog_id: catalogId || null,
      kind,
      brand,
      model,
      name,
      specs,
      activate,
    };
  }

  async function persistMachine({ activate, quiet = false } = {}) {
    const existing = (snap?.profiles || []).find((p) => p.id === editingMachineId);
    const payload = collectMachinePayload(activate);
    if (!payload.name) {
      if (quiet) return null;
      formStatus = "Name this machine, or pick a catalog model, then Save.";
      note("error", formStatus);
      render();
      return null;
    }
    if (!payload.activate && existing?.is_active) payload.activate = true;
    if (!existing && payload.activate === false && activate !== false) payload.activate = true;
    const saveBtn = labQuery("#ctx-machine-save");
    if (saveBtn && !quiet) saveBtn.disabled = true;
    const saved = await api("/api/context-lab/machines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (saved?.profile) {
      upsertSnapRow("profiles", saved.profile, "active_profile");
      editingMachineId = saved.profile.id;
      selectedCatalogId = saved.profile.catalog_id || selectedCatalogId;
    }
    return saved;
  }

  async function persistTolerance(on, profileId) {
    const profile = (snap?.profiles || []).find((p) => p.id === profileId) || snap?.active_profile;
    if (!profile || !isPrinterKind(profile.kind)) return null;
    const specs = { ...(profile.specs || {}), printer_tolerance: Boolean(on) };
    const saved = await api("/api/context-lab/machines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: profile.id,
        catalog_id: profile.catalog_id,
        kind: profile.kind,
        brand: profile.brand,
        model: profile.model,
        name: profile.name,
        specs,
        activate: Boolean(profile.is_active),
      }),
    });
    if (saved?.profile) upsertSnapRow("profiles", saved.profile, "active_profile");
    return saved;
  }

  function upsertSnapRow(listKey, row, activeKey) {
    if (!snap || !row?.id) return;
    const list = [...(snap[listKey] || []).filter((item) => item.id !== row.id)];
    list.unshift(row);
    snap[listKey] = list.map((item) => (
      row.is_active ? { ...item, is_active: item.id === row.id } : item
    ));
    if (activeKey && row.is_active) snap[activeKey] = row;
  }

  function renderSettings() {
    const defs = snap.settings?.definitions || [];
    const toggles = snap.settings?.toggles || {};
    const machine = snap.active_profile;
    return `
      <p class="ctx-hint">${esc(snap.settings?.hint || "These apply when Improve is enabled.")}</p>
      <p class="muted small">Active machine lives under Saved machines. These toggles tune Improve immediately while that machine is active.</p>
      <div>
        ${defs.map((d) => `
          <label class="ctx-toggle-row">
            <input type="checkbox" data-ctx-toggle="${esc(d.id)}"${toggles[d.id] ? " checked" : ""} ${machine ? "" : "disabled"} />
            <span>${esc(d.label)}${d.hint ? ` <span class="muted small">${esc(d.hint)}</span>` : ""}</span>
          </label>
        `).join("") || `<p class="muted">No machine-specific toggles yet.</p>`}
      </div>
      <p class="ctx-hint">Improve stays the Studio Improve engine. These only tune it.</p>
    `;
  }

  function renderNotes() {
    const folders = snap.note_folders || [];
    return `
      <p class="ctx-hint">Named notes live in a folder. Toggle which ones feed Improve or a custom Improve overlay.</p>
      <form class="ctx-lab-form ctx-lab-actions" id="ctx-folder-form">
        <input id="ctx-folder-name" placeholder="Folder name" />
        <button type="submit" class="btn secondary">Add folder</button>
      </form>
      ${(folders).map((folder) => `
        <section>
          <h3>${esc(folder.name || "Notes")}</h3>
          ${(folder.notes || []).map((n) => `
            <article class="ctx-note-row">
              <div>
                <strong>${esc(n.name)}</strong>
                <div class="muted small">${esc((n.body || "").slice(0, 140))}</div>
                <label class="muted small"><input type="checkbox" data-note-improve="${esc(n.id)}"${n.use_improve ? " checked" : ""}/> Improve</label>
                <label class="muted small"><input type="checkbox" data-note-custom="${esc(n.id)}"${n.use_custom ? " checked" : ""}/> Custom Improve</label>
              </div>
              <button type="button" class="btn danger btn-compact" data-delete-note="${esc(n.id)}">Delete</button>
            </article>
          `).join("") || `<p class="muted small">Empty folder.</p>`}
          ${folder.id ? `
            <form class="ctx-lab-form" data-note-form="${esc(folder.id)}">
              <input name="name" placeholder="Note name" required />
              <textarea name="body" rows="3" placeholder="Constraints, shop notes, preferred hardware…"></textarea>
              <button type="submit" class="btn accent btn-compact">Add note</button>
            </form>
          ` : ""}
        </section>
      `).join("") || `<p class="muted">Create a folder to hold notes.</p>`}
    `;
  }

  function renderCustom() {
    const customs = snap.custom_improves || [];
    const notes = (snap.note_folders || []).flatMap((f) => f.notes || []);
    return `
      <p class="ctx-hint">Write a custom Improve overlay, generate a draft from notes/settings, review, then save in a category. Flip off to use Studio Improve.</p>
      <label class="ctx-toggle-row">
        <input type="checkbox" id="ctx-custom-off"${customOff() ? " checked" : ""} />
        <span>Use Studio Improve (ignore saved custom overlays)</span>
      </label>
      <div class="ctx-lab-grid">
        <div class="ctx-lab-list">
          ${customs.map((c) => `
            <article class="ctx-custom-row${c.is_active && !customOff() ? " is-active" : ""}">
              <div>
                <strong>${esc(c.name)}</strong>
                <div class="muted small">${esc(c.category)}</div>
              </div>
              <span class="ctx-lab-actions">
                <button type="button" class="btn secondary btn-compact" data-activate-custom="${esc(c.id)}">${c.is_active ? "Active" : "Use"}</button>
                <button type="button" class="btn danger btn-compact" data-delete-custom="${esc(c.id)}">Delete</button>
              </span>
            </article>
          `).join("") || `<p class="muted small">No custom Improve saved.</p>`}
        </div>
        <form class="ctx-lab-form" id="ctx-custom-form">
          ${field("Name", `<input id="ctx-custom-name" required placeholder="No-support print overlay" />`)}
          ${field("Category", `<select id="ctx-custom-cat">${(snap.categories || []).map((c) => `<option>${esc(c)}</option>`).join("")}</select>`)}
          <div>
            <span class="muted small">Include notes</span>
            ${notes.map((n) => `<label class="ctx-toggle-row"><input type="checkbox" data-custom-note="${esc(n.id)}"${n.use_custom ? " checked" : ""}/> ${esc(n.name)}</label>`).join("") || `<p class="muted small">No notes yet.</p>`}
          </div>
          <label class="ctx-toggle-row"><input type="checkbox" id="ctx-custom-machine" checked /> Include machine profile</label>
          <label class="ctx-toggle-row"><input type="checkbox" id="ctx-custom-settings" checked /> Include Improve settings</label>
          <textarea id="ctx-custom-extra" rows="2" placeholder="Optional author brief for Generate"></textarea>
          <textarea id="ctx-custom-prompt" rows="8" placeholder="Review the generated overlay here, then save."></textarea>
          <div class="ctx-lab-actions">
            <button type="button" class="btn secondary" id="ctx-custom-generate">Generate</button>
            <button type="submit" class="btn accent">Save in category</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderExample() {
    const ghost = exampleGhost ? exampleSeed : "";
    const right = exampleGhost ? exampleRight : (exampleRight || "");
    return `
      <p class="ctx-hint">Type a prompt and see the improved result. Ghost text is an example — click the box to clear it. Delete all text to bring the example back.</p>
      <div class="ctx-example-wrap">
        <div class="ctx-example-box">
          <textarea id="ctx-example-input" class="ctx-example-input" rows="8" ${exampleGhost ? "" : ""}>${exampleGhost ? "" : esc(exampleSeed)}</textarea>
          ${exampleGhost ? `<div class="ctx-example-ghost" id="ctx-example-ghost">${esc(ghost)}</div>` : ""}
        </div>
        <div class="ctx-example-result${right ? "" : " is-empty"}" id="ctx-example-result">${esc(right || "Improved prompt will show here.")}</div>
      </div>
      <div class="ctx-lab-actions">
        <button type="button" class="btn accent" id="ctx-example-run">Improve this example</button>
      </div>
    `;
  }

  function renderFiles() {
    const skills = getEnabledSkills?.() || [];
    const kbs = getSelectedKnowledgeBaseIds?.() || [];
    const saved = snap.file_instructions || [];
    return `
      <p class="ctx-hint">Custom instructions for uploaded files and images. Pulls Skills and Knowledge bases you already saved — not a second prompt engine.</p>
      <div class="ctx-lab-actions">
        <button type="button" class="btn secondary btn-compact" data-open-skills>Skills / Manage</button>
        <button type="button" class="btn secondary btn-compact" data-open-kb>Knowledge bases</button>
      </div>
      <p class="muted small">Active skills: ${esc(skills.join(", ") || "none")} · Knowledge: ${kbs.length} selected</p>
      <form class="ctx-lab-form" id="ctx-file-form">
        ${field("Name", `<input id="ctx-file-name" value="${esc(fileDraft.name)}" />`)}
        <textarea id="ctx-file-instructions" rows="5" placeholder="How to use photos, DXF, STEP, and canvas sketches…">${esc(fileDraft.instructions)}</textarea>
        <div class="ctx-lab-actions">
          <button type="button" class="btn secondary" id="ctx-file-generate">Generate example</button>
          <button type="submit" class="btn accent">Save instructions</button>
        </div>
      </form>
      <pre class="ctx-example-result" id="ctx-file-example">${esc(fileDraft.example || "")}</pre>
      <div class="ctx-lab-list">
        ${saved.map((row) => `
          <article class="ctx-lab-card-row">
            <div><strong>${esc(row.name)}</strong><div class="muted small">${esc((row.instructions || "").slice(0, 120))}</div></div>
            <button type="button" class="btn danger btn-compact" data-delete-file="${esc(row.id)}">Delete</button>
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderLab() {
    const customs = snap.custom_improves || [];
    const files = snap.file_instructions || [];
    const benches = snap.benchmarks || [];
    return `
      <p class="ctx-hint"><strong>Improve Lab</strong> — ${esc(snap.lab_tagline || "")} Pick No Improve plus up to three overlays. Runs are nested in Reference Files → Improve Lab (not the main timeline).</p>
      <div class="ctx-lab-form">
        <textarea id="ctx-lab-prompt" rows="3" placeholder="Prompt + images/canvas from the composer">${esc(getPromptText?.() || "")}</textarea>
        <p class="muted small">Uses the prompt composer’s images, canvas, and Generate path. Custom gear in project status.</p>
        <div>
          ${(benches).map((b) => `<button type="button" class="btn secondary btn-compact" data-bench="${esc(b.prompt)}">${esc(b.title)}</button>`).join("")}
        </div>
        <label class="ctx-toggle-row"><input type="checkbox" data-lab-slot="original" checked /> No Improve (original prompt)</label>
        <label class="ctx-toggle-row"><input type="checkbox" data-lab-slot="builtin" checked /> Studio Improve</label>
        ${customs.map((c) => `<label class="ctx-toggle-row"><input type="checkbox" data-lab-custom="${esc(c.id)}" /> ${esc(c.name)}</label>`).join("")}
        ${files.map((f) => `<label class="ctx-toggle-row"><input type="checkbox" data-lab-file="${esc(f.id)}" /> File: ${esc(f.name)}</label>`).join("")}
        <p class="muted small" id="ctx-lab-slot-count">Selected: 2 / 4</p>
        <div class="ctx-lab-actions">
          <button type="button" class="btn accent" id="ctx-lab-run">Generate compare</button>
          <button type="button" class="btn secondary" id="ctx-lab-open">Open 4-up</button>
        </div>
      </div>
    `;
  }

  function renderSources() {
    const drive = snap.drive || {};
    return `
      <p class="ctx-hint">Connect a knowledge base to a website or a Google Drive folder — not just uploads. Reuses Google OAuth when Drive is authorized.</p>
      <div class="ctx-lab-actions">
        <button type="button" class="btn secondary" data-open-kb>Open Knowledge bases</button>
        ${drive.connected
          ? `<span class="muted small">Drive connected${drive.email ? ` · ${esc(drive.email)}` : ""}</span>
             <button type="button" class="btn secondary btn-compact" id="ctx-drive-disconnect">Disconnect Drive</button>`
          : `<button type="button" class="btn accent" id="ctx-drive-connect"${drive.configured ? "" : " disabled"}>Connect Google Drive</button>`}
      </div>
      <form class="ctx-lab-form" id="ctx-web-form">
        ${field("Knowledge base id", `<input id="ctx-source-kb" placeholder="Paste KB id from Knowledge bases" />`)}
        ${field("Website URL", `<input id="ctx-web-url" placeholder="https://…" />`)}
        <button type="submit" class="btn accent">Add website source</button>
      </form>
      <form class="ctx-lab-form" id="ctx-drive-form">
        ${field("Drive folder id", `<input id="ctx-drive-folder" placeholder="Folder id from Drive" />`)}
        <div class="ctx-lab-actions">
          <button type="button" class="btn secondary" id="ctx-drive-list">List Drive folders</button>
          <button type="submit" class="btn accent">Import Drive folder</button>
        </div>
        <div id="ctx-drive-folders" class="ctx-lab-list"></div>
      </form>
    `;
  }

  function selectedLabSlots() {
    const boxes = bodyEl?.querySelectorAll("[data-lab-slot], [data-lab-custom], [data-lab-file]") || [];
    const slots = [];
    boxes.forEach((el) => {
      if (!el.checked) return;
      if (el.dataset.labSlot === "original") slots.push({ kind: "original", label: "No Improve" });
      else if (el.dataset.labSlot === "builtin") slots.push({ kind: "builtin", label: "Studio Improve" });
      else if (el.dataset.labCustom) {
        const c = (snap.custom_improves || []).find((x) => x.id === el.dataset.labCustom);
        slots.push({ kind: "custom", label: c?.name || "Custom", instruction_id: el.dataset.labCustom });
      } else if (el.dataset.labFile) {
        const f = (snap.file_instructions || []).find((x) => x.id === el.dataset.labFile);
        slots.push({ kind: "file", label: f?.name || "File", instruction_id: el.dataset.labFile });
      }
    });
    return slots.slice(0, 4);
  }

  function bind() {
    const switchPane = (next) => {
      pane = next;
      formStatus = "";
      render();
    };
    tabHost?.querySelectorAll("[data-ctx-pane]").forEach((el) => {
      el.addEventListener("click", () => switchPane(el.getAttribute("data-ctx-pane") || "machines"));
    });
    tabHost?.querySelector("[data-ctx-improve-toggle]")?.addEventListener("click", () => {
      improveOpen = !improveOpen;
      render();
    });
    bodyEl?.querySelectorAll("[data-ctx-improve-tab]").forEach((el) => {
      el.addEventListener("click", () => {
        improveTab = el.getAttribute("data-ctx-improve-tab") || "settings";
        improveOpen = true;
        render();
      });
    });
    const roots = [bodyEl, popupHost()].filter(Boolean);
    const onAll = (sel, ev, fn) => {
      roots.forEach((root) => {
        root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));
      });
    };
    bodyEl?.querySelector("[data-print-form]")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const name = bodyEl.querySelector("#ctx-print-name")?.value || "";
      const filament = bodyEl.querySelector("#ctx-print-filament")?.value || "PLA";
      const supports = !!bodyEl.querySelector("#ctx-print-supports")?.checked;
      const isDefault = !!bodyEl.querySelector("#ctx-print-default")?.checked;
      void api("/api/context-lab/print-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || `${filament}${supports ? " · supports" : ""}`,
          filament,
          supports_enabled: supports,
          is_default: isDefault,
        }),
      }).then(() => refresh()).catch((err) => note("error", err.message || "Could not save print profile"));
    });
    bodyEl?.querySelectorAll("[data-print-default]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-print-default");
        if (!id) return;
        void api(`/api/context-lab/print-profiles/${encodeURIComponent(id)}/default`, { method: "POST" })
          .then(() => refresh())
          .catch((err) => note("error", err.message || "Could not set default"));
      });
    });
    bodyEl?.querySelectorAll("[data-print-delete]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-print-delete");
        if (!id) return;
        void api(`/api/context-lab/print-profiles/${encodeURIComponent(id)}`, { method: "DELETE" })
          .then(() => refresh())
          .catch((err) => note("error", err.message || "Could not delete profile"));
      });
    });
    bodyEl?.querySelector("[data-new-machine]")?.addEventListener("click", () => {
      editingMachineId = null;
      selectedCatalogId = "";
      formStatus = "";
      machineEditOpen = true;
      machineListOpen = false;
      render();
    });
    onAll("[data-edit-machine]", "click", (ev) => {
      if (ev.target.closest("button")) return;
      const el = ev.currentTarget;
      editingMachineId = el.getAttribute("data-edit-machine");
      const profile = (snap.profiles || []).find((p) => p.id === editingMachineId);
      selectedCatalogId = profile?.catalog_id || "";
      formStatus = "";
      pane = "machines";
      machineEditOpen = true;
      machineListOpen = false;
      render();
    });
    const pickCatalog = (id) => {
      selectedCatalogId = id;
      editingMachineId = null;
      machineEditOpen = true;
      machineListOpen = false;
      formStatus = "";
      render();
      fillMachineFromCatalog(id);
    };
    bodyEl?.querySelector("#ctx-machine-search")?.addEventListener("input", (e) => {
      catalogQuery = e.target.value || "";
      const grid = bodyEl.querySelector("#ctx-machine-catalog-grid");
      if (grid) {
        grid.innerHTML = catalogThumbsHtml();
        grid.querySelectorAll("[data-catalog-pick]").forEach((btn) => {
          btn.addEventListener("click", () => pickCatalog(btn.getAttribute("data-catalog-pick") || ""));
        });
      }
    });
    bodyEl?.querySelectorAll("[data-catalog-pick]").forEach((btn) => {
      btn.addEventListener("click", () => pickCatalog(btn.getAttribute("data-catalog-pick") || ""));
    });
    bodyEl?.querySelector("[data-expand-machines]")?.addEventListener("click", () => {
      machineListOpen = true;
      render();
    });
    onAll("[data-close-machine-list]", "click", () => {
      machineListOpen = false;
      render();
    });
    onAll("[data-close-machine-edit]", "click", () => {
      machineEditOpen = false;
      render();
    });
    onAll("[data-ctx-tolerance]", "change", async (ev) => {
      const on = ev.currentTarget.checked;
      const scope = ev.currentTarget.getAttribute("data-ctx-tolerance") || "draft";
      const profileId = scope === "active"
        ? snap?.active_profile?.id
        : (editingMachineId || snap?.active_profile?.id);
      const sameMachine = profileId && snap?.active_profile?.id === profileId;
      roots.forEach((root) => {
        root.querySelectorAll("[data-ctx-tolerance]").forEach((el) => {
          if (sameMachine || el.getAttribute("data-ctx-tolerance") === scope) el.checked = on;
        });
      });
      const existing = (snap?.profiles || []).find((p) => p.id === profileId) || snap?.active_profile;
      try {
        if (existing) await persistTolerance(on, existing.id);
        else await persistMachine({ activate: true, quiet: true });
        const mm = existing?.fit_clearances?.sliding_mm;
        formStatus = on
          ? `Tolerance on — Improve adds ~${mm != null ? Number(mm).toFixed(2) : "0.20"} mm fit clearance for this printer.`
          : "Tolerance off — Improve will not add printer fit clearance.";
        note("ok", formStatus);
        syncIcon();
      } catch (err) {
        formStatus = err.message || "Could not save Tolerance.";
        note("error", formStatus);
      }
    });
    labQuery("#ctx-machine-kind")?.addEventListener("change", (e) => {
      const row = labQuery(".ctx-switch-row");
      if (row) row.hidden = !isPrinterKind(e.target.value);
    });
    ["#ctx-machine-name", "#ctx-machine-volume", "#ctx-machine-nozzle", "#ctx-machine-notes", "#ctx-machine-brand", "#ctx-machine-model"].forEach((sel) => {
      labQuery(sel)?.addEventListener("change", () => {
        if (!editingMachineId) return;
        void persistMachine({ activate: false, quiet: true }).catch((err) => {
          formStatus = err.message || "Could not save machine.";
          note("error", formStatus);
        });
      });
    });
    labQuery("#ctx-machine-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const existing = (snap?.profiles || []).find((p) => p.id === editingMachineId);
        const saved = await persistMachine({ activate: !existing || existing.is_active });
        if (!saved) return;
        const live = Boolean(saved?.profile?.is_active);
        formStatus = live
          ? `${saved.profile.name} saved. Improve now uses this machine.`
          : `${saved?.profile?.name || "Machine"} saved.`;
        note("ok", formStatus);
        machineEditOpen = true;
        syncIcon();
        render();
        try {
          await refresh();
          machineEditOpen = true;
          render();
        } catch {
          /* List already shows the saved profile. */
        }
      } catch (err) {
        formStatus = err.message || "Could not save machine.";
        note("error", formStatus);
        machineEditOpen = true;
        render();
      }
    });
    onAll("[data-activate-machine]", "click", async (ev) => {
      ev.stopPropagation();
      const id = ev.currentTarget.getAttribute("data-activate-machine");
      const profile = (snap.profiles || []).find((p) => p.id === id);
      if (!profile) return;
      editingMachineId = id;
      selectedCatalogId = profile.catalog_id || "";
      machineEditOpen = false;
      try {
        const saved = await api("/api/context-lab/machines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            catalog_id: profile.catalog_id,
            kind: profile.kind,
            brand: profile.brand,
            model: profile.model,
            name: profile.name,
            specs: profile.specs,
            activate: true,
          }),
        });
        if (saved?.profile) upsertSnapRow("profiles", saved.profile, "active_profile");
        formStatus = `Improve now uses ${profile.name}.`;
        note("ok", formStatus);
        await refresh();
        render();
      } catch (err) {
        formStatus = err.message || "Could not switch Improve machine.";
        note("error", formStatus);
        render();
      }
    });
    onAll("[data-delete-machine]", "click", async (ev) => {
      ev.stopPropagation();
      const id = ev.currentTarget.getAttribute("data-delete-machine");
      try {
        await api(`/api/context-lab/machines/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (editingMachineId === id) editingMachineId = null;
        formStatus = "Machine deleted. Improve no longer uses it.";
        await refresh();
      } catch (err) {
        formStatus = err.message || "Could not delete machine.";
        note("error", formStatus);
        render();
      }
    });
    bodyEl?.querySelector("[data-new-customer]")?.addEventListener("click", () => {
      editingCustomerId = null;
      formStatus = "";
      render();
    });
    bodyEl?.querySelectorAll("[data-edit-customer]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        if (ev.target.closest("button")) return;
        editingCustomerId = el.getAttribute("data-edit-customer");
        formStatus = "";
        pane = "customers";
        render();
      });
    });
    bodyEl?.querySelector("#ctx-customer-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = (bodyEl.querySelector("#ctx-customer-name")?.value || "").trim();
      if (!name) {
        formStatus = "Enter a customer name, then Save.";
        note("error", formStatus);
        render();
        return;
      }
      const saveBtn = bodyEl.querySelector("#ctx-customer-save");
      if (saveBtn) saveBtn.disabled = true;
      try {
        const saved = await api("/api/context-lab/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingCustomerId || null,
            name,
            company: bodyEl.querySelector("#ctx-customer-company")?.value || "",
            notes: bodyEl.querySelector("#ctx-customer-notes")?.value || "",
            activate: true,
          }),
        });
        if (saved?.customer) {
          upsertSnapRow("customers", saved.customer, "active_customer");
          editingCustomerId = saved.customer.id;
        }
        formStatus = `${saved?.customer?.name || name} saved and used for Improve.`;
        note("ok", formStatus);
        syncIcon();
        render();
        try {
          await refresh();
        } catch {
          /* List already shows the saved customer. */
        }
      } catch (err) {
        formStatus = err.message || "Could not save customer.";
        note("error", formStatus);
        render();
      }
    });
    bodyEl?.querySelectorAll("[data-activate-customer]").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute("data-activate-customer");
        const customer = (snap.customers || []).find((c) => c.id === id);
        if (!customer) return;
        try {
          const saved = await api("/api/context-lab/customers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              name: customer.name,
              company: customer.company,
              notes: customer.notes,
              settings: customer.settings || {},
              activate: true,
            }),
          });
          if (saved?.customer) upsertSnapRow("customers", saved.customer, "active_customer");
          editingCustomerId = id;
          formStatus = `${customer.name} is Improve context.`;
          await refresh();
        } catch (err) {
          formStatus = err.message || "Could not use customer.";
          note("error", formStatus);
          render();
        }
      });
    });
    bodyEl?.querySelectorAll("[data-delete-customer]").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute("data-delete-customer");
        try {
          await api(`/api/context-lab/customers/${encodeURIComponent(id)}`, { method: "DELETE" });
          if (editingCustomerId === id) editingCustomerId = null;
          formStatus = "Customer deleted.";
          await refresh();
        } catch (err) {
          formStatus = err.message || "Could not delete customer.";
          note("error", formStatus);
          render();
        }
      });
    });
    bodyEl?.querySelectorAll("[data-ctx-toggle]").forEach((el) => {
      el.addEventListener("change", async () => {
        const toggles = { ...(snap.settings?.toggles || {}) };
        bodyEl.querySelectorAll("[data-ctx-toggle]").forEach((box) => {
          toggles[box.getAttribute("data-ctx-toggle")] = box.checked;
        });
        await api("/api/context-lab/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toggles }),
        });
        await refresh();
        render();
      });
    });
    bodyEl?.querySelector("#ctx-folder-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await api("/api/context-lab/note-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bodyEl.querySelector("#ctx-folder-name")?.value }),
      });
      await refresh();
    });
    bodyEl?.querySelectorAll("[data-note-form]").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        await api("/api/context-lab/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folder_id: form.getAttribute("data-note-form"),
            name: fd.get("name"),
            body: fd.get("body"),
            use_improve: true,
            use_custom: true,
          }),
        });
        await refresh();
      });
    });
    bodyEl?.querySelectorAll("[data-note-improve], [data-note-custom]").forEach((el) => {
      el.addEventListener("change", async () => {
        const id = el.getAttribute("data-note-improve") || el.getAttribute("data-note-custom");
        const noteRow = (snap.note_folders || []).flatMap((f) => f.notes || []).find((n) => n.id === id);
        if (!noteRow) return;
        const improveEl = bodyEl.querySelector(`[data-note-improve="${id}"]`);
        const customEl = bodyEl.querySelector(`[data-note-custom="${id}"]`);
        await api("/api/context-lab/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            folder_id: noteRow.folder_id,
            name: noteRow.name,
            body: noteRow.body,
            use_improve: improveEl?.checked,
            use_custom: customEl?.checked,
          }),
        });
        await refresh();
      });
    });
    bodyEl?.querySelectorAll("[data-delete-note]").forEach((el) => {
      el.addEventListener("click", async () => {
        await api(`/api/context-lab/notes/${encodeURIComponent(el.getAttribute("data-delete-note"))}`, { method: "DELETE" });
        await refresh();
      });
    });
    bodyEl?.querySelector("#ctx-custom-off")?.addEventListener("change", (e) => {
      setCustomOff(e.target.checked);
      if (e.target.checked) {
        void api("/api/context-lab/custom-improves/active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: null }),
        }).then(() => refresh());
      }
      render();
    });
    bodyEl?.querySelector("#ctx-custom-generate")?.addEventListener("click", async () => {
      const noteIds = [...bodyEl.querySelectorAll("[data-custom-note]:checked")].map((el) => el.getAttribute("data-custom-note"));
      const data = await api("/api/context-lab/custom-improves/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note_ids: noteIds,
          include_machine: bodyEl.querySelector("#ctx-custom-machine")?.checked,
          include_settings: bodyEl.querySelector("#ctx-custom-settings")?.checked,
          extra: bodyEl.querySelector("#ctx-custom-extra")?.value || "",
        }),
        timeoutMs: 120000,
      });
      const ta = bodyEl.querySelector("#ctx-custom-prompt");
      if (ta) ta.value = data.prompt || data.draft || "";
      note("ok", "Review the custom Improve prompt, then save.");
    });
    bodyEl?.querySelector("#ctx-custom-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const noteIds = [...bodyEl.querySelectorAll("[data-custom-note]:checked")].map((el) => el.getAttribute("data-custom-note"));
      await api("/api/context-lab/custom-improves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bodyEl.querySelector("#ctx-custom-name")?.value,
          category: bodyEl.querySelector("#ctx-custom-cat")?.value,
          prompt: bodyEl.querySelector("#ctx-custom-prompt")?.value,
          note_ids: noteIds,
          include_machine: bodyEl.querySelector("#ctx-custom-machine")?.checked,
          include_settings: bodyEl.querySelector("#ctx-custom-settings")?.checked,
          activate: true,
        }),
      });
      setCustomOff(false);
      note("ok", "Custom Improve saved and active.");
      await refresh();
    });
    bodyEl?.querySelectorAll("[data-activate-custom]").forEach((el) => {
      el.addEventListener("click", async () => {
        setCustomOff(false);
        await api("/api/context-lab/custom-improves/active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: el.getAttribute("data-activate-custom") }),
        });
        await refresh();
      });
    });
    bodyEl?.querySelectorAll("[data-delete-custom]").forEach((el) => {
      el.addEventListener("click", async () => {
        await api(`/api/context-lab/custom-improves/${encodeURIComponent(el.getAttribute("data-delete-custom"))}`, { method: "DELETE" });
        await refresh();
      });
    });
    const exampleInput = bodyEl?.querySelector("#ctx-example-input");
    const ghostEl = bodyEl?.querySelector("#ctx-example-ghost");
    const resultEl = bodyEl?.querySelector("#ctx-example-result");
    exampleInput?.addEventListener("pointerdown", () => {
      if (!exampleGhost) return;
      exampleGhost = false;
      exampleRight = "";
      ghostEl?.remove();
      if (resultEl) {
        resultEl.textContent = "";
        resultEl.classList.add("is-empty");
      }
    });
    exampleInput?.addEventListener("focus", () => {
      if (!exampleGhost) return;
      exampleGhost = false;
      exampleRight = "";
      ghostEl?.remove();
      if (resultEl) {
        resultEl.textContent = "";
        resultEl.classList.add("is-empty");
      }
    });
    exampleInput?.addEventListener("input", () => {
      const text = exampleInput.value;
      if (!text.trim()) {
        exampleGhost = true;
        exampleSeed = snap?.example?.prompt || exampleSeed;
        exampleRight = snap?.example?.improved || "";
        render();
      }
    });
    bodyEl?.querySelector("#ctx-example-run")?.addEventListener("click", async () => {
      const text = exampleGhost ? exampleSeed : (exampleInput?.value || "").trim();
      if (!text) return;
      const data = await api("/api/prompt/improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          mode: getPromptMode?.() || "v2",
          project_id: getProjectId?.() || null,
          ...getContextLabImproveFields(),
          ...(getAiKeyFields?.() || {}),
        }),
      }, 120000);
      exampleGhost = false;
      exampleSeed = text;
      exampleRight = data.improved_prompt || "";
      if (exampleInput) exampleInput.value = text;
      if (resultEl) {
        resultEl.textContent = exampleRight;
        resultEl.classList.remove("is-empty");
      }
    });
    bodyEl?.querySelectorAll("[data-open-kb]").forEach((el) => el.addEventListener("click", () => openKnowledge?.()));
    bodyEl?.querySelectorAll("[data-open-skills]").forEach((el) => el.addEventListener("click", () => openSkills?.()));
    bodyEl?.querySelector("#ctx-file-generate")?.addEventListener("click", async () => {
      fileDraft.name = bodyEl.querySelector("#ctx-file-name")?.value || fileDraft.name;
      fileDraft.instructions = bodyEl.querySelector("#ctx-file-instructions")?.value || "";
      const data = await api("/api/context-lab/file-instructions/example", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instructions: fileDraft.instructions,
          skill_ids: getEnabledSkills?.() || [],
          knowledge_base_ids: getSelectedKnowledgeBaseIds?.() || [],
        }),
      }, 120000);
      fileDraft.example = data.example || "";
      const pre = bodyEl.querySelector("#ctx-file-example");
      if (pre) pre.textContent = fileDraft.example;
    });
    bodyEl?.querySelector("#ctx-file-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await api("/api/context-lab/file-instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bodyEl.querySelector("#ctx-file-name")?.value,
          instructions: bodyEl.querySelector("#ctx-file-instructions")?.value,
          skill_ids: getEnabledSkills?.() || [],
          knowledge_base_ids: getSelectedKnowledgeBaseIds?.() || [],
          example: fileDraft.example || "",
        }),
      });
      await refresh();
    });
    bodyEl?.querySelectorAll("[data-delete-file]").forEach((el) => {
      el.addEventListener("click", async () => {
        await api(`/api/context-lab/file-instructions/${encodeURIComponent(el.getAttribute("data-delete-file"))}`, { method: "DELETE" });
        await refresh();
      });
    });
    const countEl = bodyEl?.querySelector("#ctx-lab-slot-count");
    const updateCount = () => {
      const n = selectedLabSlots().length;
      if (countEl) countEl.textContent = `Selected: ${n} / 4`;
    };
    bodyEl?.querySelectorAll("[data-lab-slot], [data-lab-custom], [data-lab-file]").forEach((el) => {
      el.addEventListener("change", () => {
        const slots = selectedLabSlots();
        if (slots.length > 4) {
          el.checked = false;
          note("error", "Improve Lab compares at most 4 instructions.");
        }
        updateCount();
      });
    });
    bodyEl?.querySelectorAll("[data-bench]").forEach((el) => {
      el.addEventListener("click", () => {
        const ta = bodyEl.querySelector("#ctx-lab-prompt");
        if (ta) ta.value = el.getAttribute("data-bench") || "";
      });
    });
    bodyEl?.querySelector("#ctx-lab-open")?.addEventListener("click", () => openLabOverlay());
    bodyEl?.querySelector("#ctx-lab-run")?.addEventListener("click", () => void runLab());
    bodyEl?.querySelector("#ctx-drive-connect")?.addEventListener("click", async () => {
      const data = await api("/api/users/me/drive/connect");
      if (data?.url) window.location.href = data.url;
    });
    bodyEl?.querySelector("#ctx-drive-disconnect")?.addEventListener("click", async () => {
      await api("/api/users/me/drive/connect", { method: "DELETE" });
      await refresh();
    });
    bodyEl?.querySelector("#ctx-web-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const kb = bodyEl.querySelector("#ctx-source-kb")?.value?.trim();
      const url = bodyEl.querySelector("#ctx-web-url")?.value?.trim();
      if (!kb || !url) return;
      await api(`/api/knowledge-bases/${encodeURIComponent(kb)}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: "website", url }),
      }, 60000);
      note("ok", "Website added to the knowledge base.");
    });
    bodyEl?.querySelector("#ctx-drive-list")?.addEventListener("click", async () => {
      const host = bodyEl.querySelector("#ctx-drive-folders");
      if (!host) return;
      const ctl = beginDriveFoldersFetch();
      if (!host.querySelector("[data-pick-folder]")) {
        host.innerHTML = `<p class="muted small">Loading folders…</p>`;
      }
      try {
        const res = await fetch("/api/users/me/drive/folders", { headers: authHeaders(), signal: ctl.signal });
        if (ctl.signal.aborted) return;
        if (!res.ok) throw new Error("Could not list Drive folders.");
        const data = await res.json().catch(() => ({}));
        if (ctl.signal.aborted) return;
        host.innerHTML = (data.folders || []).map((f) => `
          <button type="button" class="ctx-lab-card-row" data-pick-folder="${esc(f.id)}">${esc(f.name)}</button>
        `).join("") || `<p class="muted small">No folders.</p>`;
        host.querySelectorAll("[data-pick-folder]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const input = bodyEl.querySelector("#ctx-drive-folder");
            if (input) input.value = btn.getAttribute("data-pick-folder") || "";
          });
        });
      } catch (err) {
        if (ctl.signal.aborted || err?.name === "AbortError") return;
        host.innerHTML = `<p class="muted small">${esc(err.message || "Could not list Drive folders.")}</p>`;
      }
    });
    bodyEl?.querySelector("#ctx-drive-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const kb = bodyEl.querySelector("#ctx-source-kb")?.value?.trim();
      const folder = bodyEl.querySelector("#ctx-drive-folder")?.value?.trim();
      if (!kb || !folder) return;
      await api(`/api/knowledge-bases/${encodeURIComponent(kb)}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: "drive", drive_folder_id: folder }),
      }, 120000);
      note("ok", "Drive folder imported into the knowledge base.");
    });
  }

  async function runLab() {
    const projectId = getProjectId?.();
    if (!projectId) {
      note("error", "Open a project first.");
      return;
    }
    const slots = selectedLabSlots();
    if (!slots.length) {
      note("error", "Select No Improve plus up to three overlays.");
      return;
    }
    const prompt = bodyEl.querySelector("#ctx-lab-prompt")?.value?.trim() || getPromptText?.() || "";
    if (!prompt) {
      note("error", "Type a prompt for Improve Lab.");
      return;
    }
    const session = await api(`/api/projects/${encodeURIComponent(projectId)}/improve-lab/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, slots }),
    });
    const images = getPromptImages?.() || [];
    const jobs = [];
    for (const slot of session.slots || []) {
      let text = prompt;
      if (slot.kind !== "original") {
        const improved = await api("/api/prompt/improve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            mode: getPromptMode?.() || "v2",
            project_id: projectId,
            custom_improve_id: slot.kind === "custom" ? slot.instruction_id : undefined,
            file_instruction_id: slot.kind === "file" ? slot.instruction_id : undefined,
            use_context_lab: slot.kind !== "original",
            context_custom_off: slot.kind === "builtin",
            images: images.slice(0, 4),
            has_images: images.length > 0,
            ...(getAiKeyFields?.() || {}),
          }),
        }, 120000);
        text = improved.improved_prompt || prompt;
      }
      jobs.push({
        ...slot,
        prompt: text,
        original: prompt,
        images,
      });
    }
    openLabOverlay(session, jobs);
    close();
    if (typeof startLabJobs === "function") {
      await startLabJobs({ session, jobs, prompt, images });
    }
  }

  function openLabOverlay(session = null, jobs = []) {
    if (!overlay) return;
    overlay.classList.remove("hidden");
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    const grid = overlay.querySelector("#improve-lab-grid");
    const stats = overlay.querySelector("#improve-lab-stats-body");
    disposeLabViewers();
    const slots = (session?.slots || jobs || [{ label: "No Improve" }, { label: "Studio Improve" }, { label: "Overlay A" }, { label: "Overlay B" }]).slice(0, 4);
    while (slots.length < 4) slots.push({ label: `Empty ${slots.length + 1}`, status: "idle" });
    if (grid) {
      grid.innerHTML = slots.map((slot, i) => `
        <article class="improve-lab-slot" data-lab-view="${i}">
          <span class="improve-lab-slot-label">${esc(slot.label || `Slot ${i + 1}`)}</span>
          <div class="improve-lab-slot-view" id="improve-lab-view-${i}"></div>
        </article>
      `).join("");
      slots.forEach((slot, i) => {
        const host = document.getElementById(`improve-lab-view-${i}`);
        const viewer = createMiniViewer(host, { autoRotate: true });
        labViewers[i] = viewer;
        if (slot.url || slot.filename) {
          const rel = slot.url || slot.filename;
          const pid = getProjectId?.();
          if (pid) void viewer.load(`/api/projects/${encodeURIComponent(pid)}/files/${rel.split("/").map(encodeURIComponent).join("/")}`);
        }
      });
    }
    if (stats) {
      stats.textContent = slots.map((s, i) => `${i + 1}. ${s.label || "Slot"} — ${s.status || "queued"}`).join("\n");
    }
  }

  function disposeLabViewers() {
    labViewers.forEach((v) => v?.dispose?.());
    labViewers = [];
  }

  function updateLabSlot(index, { url, filename, status, label } = {}) {
    const pid = getProjectId?.();
    const viewer = labViewers[index];
    const rel = url || filename;
    if (viewer && rel && pid) {
      void viewer.load(`/api/projects/${encodeURIComponent(pid)}/files/${String(rel).split("/").map(encodeURIComponent).join("/")}`);
    }
    const tag = overlay?.querySelector(`[data-lab-view="${index}"] .improve-lab-slot-label`);
    if (tag && label) tag.textContent = label;
    const stats = overlay?.querySelector("#improve-lab-stats-body");
    if (stats && status) {
      const lines = String(stats.textContent || "").split("\n");
      lines[index] = `${index + 1}. ${label || "Slot"} — ${status}`;
      stats.textContent = lines.join("\n");
    }
  }

  async function applyAgentOverlay(promptText) {
    const prompt = String(promptText || "").trim();
    if (!prompt) return null;
    const row = await api("/api/context-lab/custom-improves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Render Agent overlay",
        category: "Improve Lab",
        prompt,
        activate: true,
      }),
    });
    setCustomOff(false);
    await refresh();
    note("ok", "Custom Improve updated from Render Agent.");
    return row;
  }

  iconBtn?.addEventListener("click", () => {
    if (modal?.classList.contains("hidden")) open();
    else close();
  });
  modal?.querySelectorAll("[data-ctx-lab-close]").forEach((el) => el.addEventListener("click", close));
  overlay?.querySelectorAll("[data-improve-lab-close]").forEach((el) => {
    el.addEventListener("click", () => {
      overlay.classList.add("hidden");
      overlay.setAttribute("hidden", "");
      overlay.setAttribute("aria-hidden", "true");
      disposeLabViewers();
    });
  });
  overlay?.querySelector("#improve-lab-send-agent")?.addEventListener("click", () => {
    sendSelectionToAgent?.({
      source: "improve-lab",
      prompt: getPromptText?.() || "",
    });
    openRenderAgent?.({ debugImprove: true });
  });

  void fetchSkillsCatalog?.((path, options) => fetch(path, options)).catch(() => {});
  void (async () => {
    const ctl = beginContextLabFetch();
    try {
      const data = await api("/api/context-lab", { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      snap = data;
      syncIcon();
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
    } finally {
      if (contextLabAbort === ctl) contextLabAbort = null;
    }
  })();

  return {
    open,
    close,
    refresh,
    openLabOverlay,
    updateLabSlot,
    applyAgentOverlay,
    getImproveFields: getContextLabImproveFields,
    getActiveMachineIndex: () => snap?.active_profile ? JSON.parse(JSON.stringify({
      ...snap.active_profile,
      toggles: snap?.settings?.toggles || {},
    })) : null,
  };
}
