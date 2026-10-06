/**
 * VibeCAD / FreeCAD-style Tasks panel for Create / Modify solid tools.
 *
 * Docks on the right edge of the viewport (like FreeCAD's Tasks view)
 * while Box / Pad / Pocket / Extrude / Hole / primitives are active.
 * Viewport stays interactive — no modal dimmer.
 *
 * Field changes fire onChange for live ghost preview. OK runs the
 * parametric FeatureProgram through the server CAD kernel (build123d → OCCT).
 */

const COMBINE_LABELS = {
  new: "New body",
  add: "Add",
  join: "Fuse",
  cut: "Cut / Subtract",
  intersect: "Intersect",
  new_body: "New body",
};

function _optionParts(opt) {
  if (opt && typeof opt === "object" && "value" in opt) {
    return { value: String(opt.value), label: String(opt.label ?? opt.value) };
  }
  return { value: String(opt), label: String(opt) };
}

let _root = null;
let _onUnits = null;
let _changeTimer = null;
let _activeCancel = null;

function _ensureRoot() {
  if (_root && document.body.contains(_root)) return _root;
  _root = document.createElement("aside");
  _root.id = "create-task-banner";
  _root.className = "create-task-banner vibecad-task-panel hidden";
  _root.setAttribute("role", "region");
  _root.setAttribute("aria-label", "Create tool parameters");
  const host =
    document.getElementById("viewport") ||
    document.querySelector(".viewport-wrap") ||
    document.getElementById("app") ||
    document.body;
  host.appendChild(_root);
  return _root;
}

function _fieldControl(field, units) {
  const id = `ctb-${field.name}`;
  const label = (field.label || field.name).replace("(mm)", `(${units})`);
  const hiddenCls = field._hidden ? " ctb-field--hidden" : "";
  if (field.type === "select") {
    const opts = (field.options || [])
      .map((opt) => {
        const { value, label: optLabel } = _optionParts(opt);
        const text =
          field.name === "combine" && COMBINE_LABELS[value] && optLabel === value
            ? COMBINE_LABELS[value]
            : optLabel;
        const sel = String(value) === String(field.default) ? " selected" : "";
        return `<option value="${value}"${sel}>${text}</option>`;
      })
      .join("");
    return `<label class="ctb-field${hiddenCls}"><span class="ctb-field-label">${label}</span><select id="${id}" name="${field.name}">${opts}</select></label>`;
  }
  if (field.type === "checkbox") {
    return `<label class="ctb-field ctb-check${hiddenCls}"><input type="checkbox" id="${id}" name="${field.name}" ${field.default ? "checked" : ""} /><span>${label}</span></label>`;
  }
  if (/\(mm\)/.test(field.label || "") || field.type === "length") {
    return `<label class="ctb-field${hiddenCls}"><span class="ctb-field-label">${label}</span><input type="text" id="${id}" name="${field.name}" data-length="1" spellcheck="false" value="${field.default ?? 0}" /></label>`;
  }
  const min = field.min !== undefined ? ` min="${field.min}"` : "";
  const max = field.max !== undefined ? ` max="${field.max}"` : "";
  const step = field.step !== undefined ? ` step="${field.step}"` : "";
  return `<label class="ctb-field${hiddenCls}"><span class="ctb-field-label">${label}</span><input type="number" id="${id}" name="${field.name}" value="${field.default ?? 0}"${min}${max}${step} /></label>`;
}

function _syncConditionalFields(root, fields) {
  for (const f of fields || []) {
    if (!f.visibleWhen) continue;
    const wrap = root.querySelector(`#ctb-${f.name}`)?.closest(".ctb-field");
    if (!wrap) continue;
    const show = Object.entries(f.visibleWhen).every(([dep, val]) => {
      const depEl = root.querySelector(`[name="${dep}"]`);
      if (!depEl) return false;
      const current = depEl.type === "checkbox" ? (depEl.checked ? "true" : "false") : depEl.value;
      return String(current) === String(val);
    });
    wrap.classList.toggle("ctb-field--hidden", !show);
  }
}

function _readValues(fields, parseLength, getUnits, { soft = false } = {}) {
  const values = {};
  for (const f of fields || []) {
    const el = document.getElementById(`ctb-${f.name}`);
    if (!el) continue;
    if (f.type === "checkbox") {
      values[f.name] = el.checked;
    } else if (el.dataset.length === "1") {
      const parsed = parseLength(el.value, getUnits());
      if (parsed == null || !Number.isFinite(parsed)) {
        if (soft) {
          values[f.name] = Number(f.default) || 0;
          continue;
        }
        throw new Error(`Invalid length for ${f.label || f.name}`);
      }
      values[f.name] = parsed;
    } else if (f.type === "number" || el.type === "number") {
      const n = Number(el.value);
      values[f.name] = Number.isFinite(n) ? n : Number(f.default) || 0;
    } else {
      values[f.name] = el.value;
    }
  }
  return values;
}

function _setFieldValue(name, value, { displayValue, getUnits } = {}) {
  const el = document.getElementById(`ctb-${name}`);
  if (!el) return;
  if (el.dataset.length === "1" && displayValue) {
    el.value = displayValue(value, getUnits?.() || "mm");
  } else {
    el.value = value;
  }
}

/**
 * Open the VibeCAD-style Create Tasks panel in the viewport.
 * @param {object} opts
 * @param {boolean} [opts.live] - Press-Pull stretch mode; Done applies then closes
 * @param {(values: object) => void} [opts.onChange] - live param changes (ghost preview)
 * @param {() => void|Promise<void>} [opts.onDone] - live Done (apply + exit); defaults to onCancel
 */
export function openCreateTaskBanner({
  entry,
  modeHint = "",
  live = false,
  hideDone = false,
  okLabel = null,
  confirmOnEnter = false,
  kernelNote = null,
  autoFocus = true,
  stretchLabel = null,
  onStretch = null,
  onOk,
  onCancel,
  onDone = null,
  onChange,
  getUnits,
  parseLength,
  displayValue,
} = {}) {
  if (!entry) return;
  // Switching tools: tear down the previous Tasks session (preview / live tool).
  if (_activeCancel) {
    try {
      _activeCancel();
    } catch {
      /* ignore */
    }
    _activeCancel = null;
  }
  if (_onUnits) {
    try {
      _onUnits();
    } catch {
      /* ignore */
    }
    _onUnits = null;
  }
  const root = _ensureRoot();
  _activeCancel = () => {
    try {
      onCancel?.();
    } catch {
      /* ignore */
    }
  };
  const units = getUnits?.() || "mm";
  const fields = entry.fields || [];
  const icon =
    entry._iconHtml ||
    (entry.id
      ? `<img class="ctb-icon" src="/assets/icons/cad/vibecad/partdesign/PartDesign_${_iconName(entry)}.svg" alt="" />`
      : "");
  const toolName = entry.label || "Create";
  const isCut =
    entry.id === "pocket" ||
    entry.id === "hole" ||
    entry.id === "groove" ||
    entry.id === "boolean" ||
    entry.viewportTool === "presspull-cut";

  const hintDefault = live
    ? modeHint ||
      "Select a face or closed sketch · drag the arrow or type Length · OK applies"
    : modeHint ||
      entry.desc ||
      (isCut
        ? "Set parameters · click viewport to place · OK cuts"
        : "Set parameters · click viewport to place · OK places the solid");

  const showDone = live && !hideDone;
  const okText = okLabel || (live && !hideDone ? "Build from params" : isCut ? "OK · Cut" : "OK");
  const footerNote =
    kernelNote ||
    (live
      ? hideDone
        ? "OK applies the pad/pocket in place · Cancel aborts"
        : "Click a face · drag · release applies (CAD kernel) · Done finishes the tool"
      : "Drag on the floor to draw size · OK places the solid instantly");

  const dimFields = fields.filter((f) => !/^at_/.test(f.name));
  const posFields = fields.filter((f) => /^at_/.test(f.name));

  root.innerHTML = `
    <div class="ctb-inner">
      <header class="ctb-header">
        <div class="ctb-lead">
          ${icon}
          <div class="ctb-titles">
            <span class="ctb-eyebrow">Tasks</span>
            <strong class="ctb-title">${toolName}</strong>
            <span class="ctb-hint">${hintDefault}</span>
          </div>
        </div>
        <button type="button" class="ctb-close" aria-label="Close">&times;</button>
      </header>
      <form class="ctb-form" id="ctb-form" autocomplete="off">
        <div class="ctb-section">
          <div class="ctb-section-label">Parameters</div>
          ${dimFields
            .map((f) =>
              _fieldControl(
                {
                  ...f,
                  default:
                    /\(mm\)/.test(f.label || "") && displayValue
                      ? displayValue(f.default ?? 0)
                      : f.default,
                },
                units,
              ),
            )
            .join("")}
        </div>
        ${
          posFields.length
            ? `<div class="ctb-section">
          <div class="ctb-section-label">Placement <span class="ctb-section-hint">drag viewport to draw</span></div>
          ${posFields
            .map((f) =>
              _fieldControl(
                {
                  ...f,
                  default:
                    /\(mm\)/.test(f.label || "") && displayValue
                      ? displayValue(f.default ?? 0)
                      : f.default,
                },
                units,
              ),
            )
            .join("")}
        </div>`
            : ""
        }
      </form>
      <p class="ctb-kernel muted small">${footerNote}</p>
      <div class="ctb-actions">
        <button type="button" class="btn secondary ctb-cancel">Cancel</button>
        ${
          stretchLabel && typeof onStretch === "function"
            ? `<button type="button" class="btn secondary ctb-stretch">${stretchLabel}</button>`
            : ""
        }
        ${showDone ? `<button type="button" class="btn secondary ctb-done">Done</button>` : ""}
        <button type="button" class="btn primary ctb-ok">${okText}</button>
      </div>
    </div>`;

  root.classList.remove("hidden");
  document.body.classList.add("create-task-banner-open");
  _syncConditionalFields(root, fields);

  const okBtn = root.querySelector(".ctb-ok");
  const setBusy = (busy, text) => {
    if (!okBtn) return;
    okBtn.disabled = !!busy;
    okBtn.textContent = text || okText;
  };

  const emitChange = () => {
    _syncConditionalFields(root, fields);
    if (!onChange) return;
    try {
      const values = _readValues(fields, parseLength, getUnits, { soft: true });
      onChange(values);
    } catch {
      /* ignore soft parse while typing */
    }
  };

  const scheduleChange = () => {
    clearTimeout(_changeTimer);
    _changeTimer = setTimeout(emitChange, 60);
  };

  const close = () => {
    clearTimeout(_changeTimer);
    root.classList.add("hidden");
    root.innerHTML = "";
    document.body.classList.remove("create-task-banner-open");
    _activeCancel = null;
    if (_onUnits) {
      try {
        _onUnits();
      } catch {
        /* ignore */
      }
      _onUnits = null;
    }
  };

  const cancel = () => {
    close();
    onCancel?.();
  };

  const done = async () => {
    try {
      if (typeof onDone === "function") {
        await onDone();
      } else {
        onCancel?.();
      }
    } catch (err) {
      const hint = root.querySelector(".ctb-hint");
      if (hint) {
        hint.textContent = err?.message || "Could not apply";
        hint.classList.add("ctb-hint--error");
      }
      return;
    }
    close();
  };

  root.querySelector(".ctb-cancel")?.addEventListener("click", cancel);
  root.querySelector(".ctb-close")?.addEventListener("click", cancel);
  root.querySelector(".ctb-done")?.addEventListener("click", () => {
    void done();
  });
  root.querySelector(".ctb-stretch")?.addEventListener("click", () => {
    onStretch?.();
  });

  root.querySelector("#ctb-form")?.addEventListener("input", scheduleChange);
  root.querySelector("#ctb-form")?.addEventListener("change", (e) => {
    _syncConditionalFields(root, fields);
    scheduleChange();
  });

  const onPlaced = (ev) => {
    const placed = ev.detail?.at;
    if (!Array.isArray(placed) || placed.length < 3) return;
    _setFieldValue("at_x", placed[0], { displayValue, getUnits });
    _setFieldValue("at_y", placed[1], { displayValue, getUnits });
    _setFieldValue("at_z", placed[2], { displayValue, getUnits });
  };
  const onDims = (ev) => {
    const next = ev.detail?.values;
    if (!next || typeof next !== "object") return;
    for (const [name, value] of Object.entries(next)) {
      if (value == null || value === "") continue;
      if (name === "combine") continue;
      _setFieldValue(name, value, { displayValue, getUnits });
    }
    if (Array.isArray(ev.detail?.at) && ev.detail.at.length >= 3) {
      _setFieldValue("at_x", ev.detail.at[0], { displayValue, getUnits });
      _setFieldValue("at_y", ev.detail.at[1], { displayValue, getUnits });
      _setFieldValue("at_z", ev.detail.at[2], { displayValue, getUnits });
    }
  };
  window.addEventListener("render3d:create-preview-placed", onPlaced);
  window.addEventListener("render3d:create-preview-dims", onDims);

  const submit = async () => {
    try {
      const values = _readValues(fields, parseLength, getUnits);
      setBusy(true, hideDone || confirmOnEnter ? "Applying…" : live ? "Building…" : "Placing…");
      const hint = root.querySelector(".ctb-hint");
      if (hint) {
        hint.textContent =
          hideDone || confirmOnEnter
            ? `Applying ${toolName}…`
            : live
              ? `Building ${toolName} with CAD kernel…`
              : `Placing ${toolName}…`;
        hint.classList.remove("ctb-hint--error");
      }
      await onOk?.(values);
      close();
    } catch (err) {
      setBusy(false);
      const hint = root.querySelector(".ctb-hint");
      if (hint) {
        hint.textContent = err?.message || "Invalid parameters";
        hint.classList.add("ctb-hint--error");
      }
    }
  };

  okBtn?.addEventListener("click", submit);
  root.querySelector("#ctb-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (live && !confirmOnEnter) return;
    submit();
  });

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      document.removeEventListener("keydown", onKey, true);
      cancel();
    } else if (e.key === "Enter" && e.target?.closest?.("#create-task-banner")) {
      if (e.target.tagName === "TEXTAREA") return;
      if (live && !confirmOnEnter) return;
      if (okBtn?.disabled) return;
      e.preventDefault();
      submit();
    }
  };
  document.addEventListener("keydown", onKey, true);
  _onUnits = () => {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("render3d:create-preview-placed", onPlaced);
    window.removeEventListener("render3d:create-preview-dims", onDims);
  };

  const first = root.querySelector("input, select");
  if (autoFocus !== false) {
    first?.focus?.();
    first?.select?.();
  }

  queueMicrotask(emitChange);

  return { close, root, emitChange };
}

function _iconName(entry) {
  const map = {
    box: "AdditiveBox",
    cylinder: "AdditiveCylinder",
    sphere: "AdditiveSphere",
    cone: "AdditiveCone",
    torus: "AdditiveTorus",
    extrude: "Pad",
    pad: "Pad",
    pocket: "Pocket",
    revolve: "Revolution",
    groove: "Groove",
    hole: "Hole",
    draft: "Draft",
    thickness: "Thickness",
    boolean: "Boolean",
    fillet: "Fillet",
    chamfer: "Chamfer",
    mirror: "Mirrored",
  };
  return map[entry.id] || "Pad";
}

export function closeCreateTaskBanner() {
  clearTimeout(_changeTimer);
  if (_activeCancel) {
    try {
      _activeCancel();
    } catch {
      /* ignore */
    }
    _activeCancel = null;
  }
  if (_onUnits) {
    try {
      _onUnits();
    } catch {
      /* ignore */
    }
    _onUnits = null;
  }
  if (!_root) return;
  _root.classList.add("hidden");
  _root.innerHTML = "";
  document.body.classList.remove("create-task-banner-open");
}

export function isCreateTaskBannerOpen() {
  return Boolean(_root && !_root.classList.contains("hidden"));
}
