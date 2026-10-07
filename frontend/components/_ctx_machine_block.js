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

  function machineThumbUrl(row = {}) {
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
    };
  }

  function currentImproveKey() {
    const id = snap?.active_profile?.id || "";
    return `${id}:${JSON.stringify(snap?.settings?.toggles || {})}`;
  }

  function improveApplyState() {
    const active = snap?.active_profile;
    if (pendingImproveApply) {
      return {
        kind: "pending",
        text: active
          ? `${active.name} is saved. Click Update Improve to apply this machine and settings to the Improve prompt.`
          : "Machine saved. Click Update Improve to apply it to the Improve prompt.",
      };
    }
    if (active && appliedImproveKey && appliedImproveKey === currentImproveKey()) {
      return {
        kind: "applied",
        text: `Improve has ${active.name} and current settings.`,
      };
    }
    if (active) {
      return {
        kind: "unsynced",
        text: `Improve may still have a previous machine. Click Update Improve to apply ${active.name}.`,
      };
    }
    return {
      kind: "empty",
      text: "Save a machine, then click Update Improve to apply it to the Improve prompt.",
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
          ${p.is_active && !pendingImproveApply ? "" : `<button type="button" class="btn secondary btn-compact" data-activate-machine="${esc(p.id)}">${compact ? "Use" : "Update Improve"}</button>`}
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
        <button type="button" class="btn accent" data-apply-improve ${active || machineEditOpen ? "" : "disabled"}>Update Improve</button>
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
      ${field("Stock / notes", `<textarea id="ctx-machine-notes" rows="3" placeholder="Max stock, fixture, materials…">${esc(draft.specs?.notes || "")}</textarea>`)}
      ${status}
      <p class="muted small">${editing ? "Update machine saves the profile. Update Improve applies it to the Improve prompt." : "Save machine writes the profile. Update Improve applies it to the Improve prompt."}</p>
    `;
  }

  function renderMachine() {
    const profiles = snap.profiles || [];
    const visible = profiles.slice(0, SAVED_VISIBLE);
    const hiddenCount = Math.max(0, profiles.length - visible.length);
    return `
      <p class="ctx-hint">Search the catalog, pick a printer thumbnail, then save. <strong>Update Improve</strong> is what applies the machine and settings to the Improve prompt.</p>
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
            <div>
              <p class="ctx-lab-form-kicker" id="ctx-edit-title">${editing ? `Editing <strong>${esc(editing.name)}</strong>` : "Connect a machine"}</p>
            </div>
            <button type="button" class="auth-close" data-close-machine-edit aria-label="Close">&times;</button>
          </header>
          <div class="ctx-lab-edit-scroll">
            ${renderMachineFormFields(draft)}
          </div>
          <footer class="ctx-lab-edit-footer">
            <button type="submit" class="btn accent" id="ctx-machine-save">${saveLabel}</button>
            <button type="button" class="btn accent ctx-apply-improve" data-apply-improve>Update Improve</button>
          </footer>
        </form>
      </div>
    ` : "";
    host.innerHTML = `${list}${edit}`;
  }

