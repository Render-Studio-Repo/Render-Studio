/**
 * Jake-style parametric controls for text-to-cad v2 models ({base}.py + gen_step()).
 *
 * Primary envelope length sliders preview live on the matching axis only.
 * Feature/detail params rebuild on release (no whole-model scale preview).
 */

import { displayValue, parseLength, unitSuffix } from "./units.js?v=20260714-units-ft-m";

/** Names that are overall envelope dims — safe for live axis preview. */
const ENVELOPE_AXIS = [
  [/^panel_w$/i, "x"],
  [/^panel_h$/i, "z"],
  [/^panel_t$/i, "y"],
  [/^(width|overall_width|body_width)$/i, "x"],
  [/^(height|overall_height|body_height)$/i, "z"],
  [/^(depth|thickness|overall_depth|body_depth)$/i, "y"],
  [/^(length|overall_length|body_length)$/i, "x"],
  [/_width$/i, "x"],
  [/_height$/i, "z"],
  [/_depth$/i, "y"],
  [/_thickness$/i, "y"],
  [/_length$/i, "x"],
  [/_w$/i, "x"],
  [/_h$/i, "z"],
  [/_t$/i, "y"],
];

/** Feature/detail tokens — never live-scale the whole mesh. */
const NO_LIVE_PREVIEW = /fillet|chamfer|angle|clearance|pitch|count|tap|bore|dia|diameter|radius|ring|clip|slot|engagement|saddle|grommet|boss|thread|access_side|front_face|lead_in|internal_|ext_|bed_|wall_t|rib_|rail_|snap_|channel_|tie_|entry_|passthrough|conduit|plumbing|jbox_|m4_|m6_|shell_wall|bolt_|cell|gap|margin|offset|spacing|orbit/;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function looksLikeLength(name) {
  const norm = String(name || "").toLowerCase();
  if (!norm) return false;
  if (NO_LIVE_PREVIEW.test(norm) && !/^panel_[wht]$/i.test(norm)) {
    // Still treat as length for unit display if it looks dimensional, but not for live preview.
  }
  return (
    /(width|height|depth|length|thickness|radius|diameter|size|pitch|offset|gap|spacing|clearance|margin|extrude|bore|orbit)/i.test(norm)
    || /_(w|h|t|d|len|dia|rad)$/i.test(norm)
    || /^panel_[wht]$/i.test(norm)
  );
}

function axisRoleForParam(name) {
  const n = String(name || "");
  for (const [re, axis] of ENVELOPE_AXIS) {
    if (re.test(n)) return axis;
  }
  return null;
}

function canLivePreviewParam(name) {
  const n = String(name || "");
  if (!n) return false;
  if (/^panel_[wht]$/i.test(n)) return true;
  if (NO_LIVE_PREVIEW.test(n)) return false;
  return axisRoleForParam(n) != null;
}

function candidateFilenames(filename) {
  const safe = String(filename || "");
  const bases = [safe.replace(/\.(glb|gltf|stl|step|stp|obj|ply|off|3mf)$/i, "")];
  const stripped = bases[0].replace(/(_edited|_pulled|_mirrored|_extruded|_copy\d*|_body\d*)+$/g, "");
  if (stripped !== bases[0]) bases.push(stripped);
  return bases.flatMap((base) => [`${base}.glb`, `${base}.step`, base]);
}

export async function fetchCadParams(rawFetch, projectId, filename, { part = null } = {}) {
  if (!projectId || !filename) return null;
  const partQuery = part ? `?part=${encodeURIComponent(part)}` : "";
  for (const candidate of candidateFilenames(filename)) {
    try {
      const res = await rawFetch(`/api/projects/${projectId}/files/${encodeURIComponent(candidate)}/cad-params${partQuery}`);
      if (!res?.ok) continue;
      const data = await res.json();
      if (data?.source && Array.isArray(data.params)) return data;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function sliderBounds(param) {
  const name = param.name || "";
  const kind = param.kind || "number";
  const numeric = Number(param.value);
  const base = Number.isFinite(numeric) ? numeric : 0;
  const isLen = looksLikeLength(name);
  const isCount = kind === "integer" || /(_count|teeth|tooth)$/i.test(name) || /^(teeth|count)$/i.test(name);
  if (isLen) {
    return {
      min: Math.max(0.1, base * 0.2),
      max: Math.max(base * 3, base + 1, 1),
      step: Number.isInteger(base) ? 1 : 0.1,
      isLen: true,
      isCount: false,
    };
  }
  if (isCount) {
    const min = Math.max(0, Math.min(base, 1));
    const max = Math.max(base * 4, base + 8, 12);
    return { min, max, step: 1, isLen: false, isCount: true };
  }
  return {
    min: Math.max(0, base - Math.abs(base || 1) * 2),
    max: base + Math.abs(base || 1) * 3,
    step: Number.isInteger(base) ? 1 : 0.1,
    isLen: false,
    isCount: false,
  };
}

export function cadParamControlsHtml(data, { partLabel = null } = {}) {
  if (!data?.source) {
    return `<section class="cad-param-panel">
      <strong>Parametric Parts</strong>
      <p class="cad-param-hint">This model has no editable text-to-cad source (.py with gen_step()). Kernel models use the History tab instead.</p>
    </section>`;
  }
  const params = data.params || [];
  const scope = partLabel
    ? `<span>${escapeHtml(partLabel)} · ${params.length} parameter${params.length === 1 ? "" : "s"}</span>`
    : `<span>${params.length} parameter${params.length === 1 ? "" : "s"} from ${escapeHtml(data.source)}</span>`;
  if (!params.length) {
    return `<section class="cad-param-panel" data-cad-source="${escapeHtml(data.source)}">
      <div class="cad-param-head">
        <div>
          <strong>Parametric Parts</strong>
          ${scope}
        </div>
      </div>
      <p class="cad-param-hint">${partLabel ? "No module-scope parameters match this part name." : "No module-scope numeric parameters were found in the source."}</p>
    </section>`;
  }
  const rows = params.map((param) => {
    const name = param.name;
    const kind = param.kind || "number";
    const label = name.replaceAll("_", " ");
    if (kind === "boolean") {
      const checked = param.value ? "checked" : "";
      return `<label class="cad-param-row cad-param-row--bool">
        <span>${escapeHtml(label)}</span>
        <input type="checkbox" data-cad-param="${escapeHtml(name)}" ${checked} />
      </label>`;
    }
    if (kind === "string") {
      return `<label class="cad-param-row">
        <span>${escapeHtml(label)}</span>
        <input type="text" data-cad-param="${escapeHtml(name)}" value="${escapeHtml(param.value)}" />
      </label>`;
    }
    const bounds = sliderBounds(param);
    const numeric = Number(param.value);
    const base = Number.isFinite(numeric) ? numeric : 0;
    const shown = bounds.isLen ? displayValue(base) : base;
    const unit = bounds.isLen ? unitSuffix() : "";
    const live = canLivePreviewParam(name) ? "1" : "0";
    const axis = axisRoleForParam(name) || "";
    const hint = live === "1"
      ? ` title="Live preview scales ${axis.toUpperCase() || "model"} only; release to rebuild"`
      : ` title="Release slider or click Rebuild to regenerate geometry"`;
    return `<label class="cad-param-row" data-param-name="${escapeHtml(name)}"${hint}>
      <span>${escapeHtml(label)}</span>
      <input type="range" min="${bounds.min}" max="${bounds.max}" step="${bounds.step}" value="${base}" data-cad-range="${escapeHtml(name)}" data-base="${base}" data-is-length="${bounds.isLen ? "1" : "0"}" data-is-count="${bounds.isCount ? "1" : "0"}" data-live-preview="${live}" data-axis-role="${escapeHtml(axis)}" data-kind="${escapeHtml(kind)}" />
      <input type="number" step="${bounds.step}" value="${shown}" data-cad-number="${escapeHtml(name)}" data-is-length="${bounds.isLen ? "1" : "0"}" data-live-preview="${live}" data-axis-role="${escapeHtml(axis)}" data-kind="${escapeHtml(kind)}" />
      <em>${unit || (kind === "integer" || bounds.isCount ? "#" : "")}</em>
    </label>`;
  }).join("");
  return `<section class="cad-param-panel" data-cad-source="${escapeHtml(data.source)}">
    <div class="cad-param-head">
      <div>
        <strong>Parametric Parts</strong>
        ${scope}
      </div>
      <button type="button" class="btn secondary btn-compact" data-cad-param-reset>Reset</button>
    </div>
    <div class="cad-param-list">${rows}</div>
    <div class="cad-param-actions">
      <button type="button" class="btn accent btn-compact" data-cad-param-apply>Rebuild model</button>
      <small>Panel W/H/T preview on one axis. Other params rebuild on release.</small>
    </div>
  </section>`;
}

function readParamValues(panel) {
  const values = {};
  panel.querySelectorAll("[data-cad-param]").forEach((input) => {
    const name = input.dataset.cadParam;
    if (!name) return;
    if (input.type === "checkbox") values[name] = !!input.checked;
    else values[name] = input.value;
  });
  panel.querySelectorAll("[data-cad-number]").forEach((input) => {
    const name = input.dataset.cadNumber;
    if (!name || values[name] != null) return;
    const isLen = input.dataset.isLength === "1";
    const kind = input.dataset.kind || "";
    const parsed = isLen ? parseLength(input.value) : Number(input.value);
    if (!Number.isFinite(parsed)) return;
    values[name] = kind === "integer" ? Math.round(parsed) : parsed;
  });
  return values;
}

export function bindCadParamControls(panel, {
  projectId,
  filename,
  part = null,
  initialData = null,
  api,
  rawFetch,
  onStatus,
  onApplied,
  getPreviewRoot = null,
} = {}) {
  const root = panel?.querySelector?.(".cad-param-panel[data-cad-source]");
  if (!root || !projectId || !filename) return;
  let baseline = structuredClone(initialData?.params || []);
  let applyTimer = null;
  let applying = false;
  let queued = false;
  let previewRoot = null;
  let previewBaseScale = null;
  let activePreviewName = null;

  const ensurePreviewTarget = () => {
    const obj = typeof getPreviewRoot === "function" ? getPreviewRoot() : null;
    if (!obj) return null;
    if (previewRoot !== obj) {
      previewRoot = obj;
      previewBaseScale = obj.scale.clone();
    }
    return previewRoot;
  };

  const applyLiveLengthPreview = (activeName = activePreviewName) => {
    const obj = ensurePreviewTarget();
    if (!obj || !previewBaseScale) return;
    if (!activeName) {
      obj.scale.copy(previewBaseScale);
      return;
    }
    const range = root.querySelector(`[data-cad-range="${CSS.escape(activeName)}"]`);
    if (!range || range.dataset.livePreview !== "1") {
      obj.scale.copy(previewBaseScale);
      return;
    }
    const base = Number(range.dataset.base);
    const value = Number(range.value);
    if (!(base > 1e-6) || !(value > 0) || !Number.isFinite(value)) {
      obj.scale.copy(previewBaseScale);
      return;
    }
    const ratio = value / base;
    const axis = range.dataset.axisRole || "";
    let sx = 1;
    let sy = 1;
    let sz = 1;
    if (axis === "x") sx = ratio;
    else if (axis === "y") sy = ratio;
    else if (axis === "z") sz = ratio;
    else {
      // Unknown axis — don't invent a uniform whole-model grow.
      obj.scale.copy(previewBaseScale);
      return;
    }
    obj.scale.set(
      previewBaseScale.x * sx,
      previewBaseScale.y * sy,
      previewBaseScale.z * sz,
    );
  };

  const resetLivePreview = () => {
    const obj = previewRoot;
    if (obj && previewBaseScale) obj.scale.copy(previewBaseScale);
    activePreviewName = null;
  };

  const syncNumber = (name, value) => {
    const num = root.querySelector(`[data-cad-number="${CSS.escape(name)}"]`);
    if (!num) return;
    const isLen = num.dataset.isLength === "1";
    const kind = num.dataset.kind || "";
    const numeric = Number(value);
    const shown = kind === "integer" ? Math.round(numeric) : numeric;
    num.value = isLen ? String(displayValue(shown)) : String(shown);
  };
  const syncRange = (name, value) => {
    const range = root.querySelector(`[data-cad-range="${CSS.escape(name)}"]`);
    if (!range) return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    if (numeric < Number(range.min)) range.min = String(numeric);
    if (numeric > Number(range.max)) range.max = String(numeric);
    range.value = String(numeric);
  };

  const runApply = async (statusMessage = "Rebuilding model from updated parameters...") => {
    if (applying) {
      queued = true;
      return;
    }
    const params = readParamValues(root);
    if (!Object.keys(params).length) {
      onStatus?.("error", "No parameter values to apply.");
      return;
    }
    applying = true;
    const applyBtn = root.querySelector("[data-cad-param-apply]");
    onStatus?.("loading", statusMessage);
    if (applyBtn) applyBtn.disabled = true;
    resetLivePreview();
    try {
      const res = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/cad-params`, {
        method: "POST",
        body: JSON.stringify({ params, part }),
      });
      baseline = structuredClone(res.params || []);
      for (const param of baseline) {
        if (param.kind === "boolean" || param.kind === "string") continue;
        const range = root.querySelector(`[data-cad-range="${CSS.escape(param.name)}"]`);
        if (range) {
          range.dataset.base = String(param.value);
          syncRange(param.name, param.value);
        }
        syncNumber(param.name, param.value);
      }
      onStatus?.("ok", "Model rebuilt from updated parameters.");
      await onApplied?.(res);
      previewRoot = null;
      previewBaseScale = null;
      ensurePreviewTarget();
    } catch (err) {
      onStatus?.("error", err?.message || "Could not rebuild model.");
      applyLiveLengthPreview(activePreviewName);
    } finally {
      applying = false;
      if (applyBtn) applyBtn.disabled = false;
      if (queued) {
        queued = false;
        await runApply("Applying latest parameter changes...");
      }
    }
  };

  const scheduleRebuild = (delayMs = 420) => {
    if (applyTimer) window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(() => {
      applyTimer = null;
      void runApply("Applying parameter change...");
    }, delayMs);
  };

  root.querySelectorAll("[data-cad-range]").forEach((range) => {
    range.addEventListener("pointerdown", () => {
      activePreviewName = range.dataset.cadRange || null;
    });
    range.addEventListener("input", () => {
      activePreviewName = range.dataset.cadRange || null;
      syncNumber(range.dataset.cadRange, range.value);
      if (range.dataset.livePreview === "1") {
        applyLiveLengthPreview(activePreviewName);
      }
    });
    range.addEventListener("change", () => scheduleRebuild(80));
    range.addEventListener("pointerup", () => scheduleRebuild(60));
  });
  root.querySelectorAll("[data-cad-number]").forEach((num) => {
    num.addEventListener("input", () => {
      const raw = num.dataset.isLength === "1" ? parseLength(num.value) : Number(num.value);
      if (!Number.isFinite(raw)) return;
      activePreviewName = num.dataset.cadNumber || null;
      syncRange(num.dataset.cadNumber, raw);
      if (num.dataset.livePreview === "1") applyLiveLengthPreview(activePreviewName);
    });
    num.addEventListener("change", () => scheduleRebuild(80));
  });
  root.querySelectorAll("[data-cad-param]").forEach((input) => {
    if (input.type === "checkbox") {
      input.addEventListener("change", () => scheduleRebuild(80));
    } else if (input.type === "text") {
      input.addEventListener("change", () => scheduleRebuild(80));
    }
  });

  root.querySelector("[data-cad-param-reset]")?.addEventListener("click", () => {
    for (const param of baseline) {
      if (param.kind === "boolean") {
        const input = root.querySelector(`[data-cad-param="${CSS.escape(param.name)}"]`);
        if (input) input.checked = !!param.value;
        continue;
      }
      if (param.kind === "string") {
        const input = root.querySelector(`[data-cad-param="${CSS.escape(param.name)}"]`);
        if (input) input.value = String(param.value ?? "");
        continue;
      }
      syncRange(param.name, param.value);
      syncNumber(param.name, param.value);
    }
    resetLivePreview();
  });

  root.querySelector("[data-cad-param-apply]")?.addEventListener("click", async () => {
    if (applyTimer) {
      window.clearTimeout(applyTimer);
      applyTimer = null;
    }
    await runApply();
  });
}
