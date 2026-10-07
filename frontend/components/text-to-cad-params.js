/**
 * Jake-style parametric controls for text-to-cad v2 models ({base}.py + gen_step()).
 *
 * Envelope length sliders (panel_w/h/t, width/height/depth…):
 *   live axis preview while dragging → bake via /transform on release (same as
 *   Generative Size Controls). .py is synced without a full rebuild.
 *
 * Feature/detail params rebuild on release (full regenerate).
 */

import { displayValue, parseLength, unitSuffix } from "../studio/units.js?v=20260714-units-ft-m";

/** Names that are overall envelope dims — safe for live axis preview + bake. */
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
      if (data?.source && Array.isArray(data.params)) {
        return { ...data, resolvedFilename: candidate };
      }
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
      ? ` title="Live preview scales ${axis.toUpperCase() || "model"} only; release to bake size"`
      : ` title="Release slider or click Rebuild to regenerate geometry"`;
    return `<label class="cad-param-row" data-param-name="${escapeHtml(name)}"${hint}>
      <span>${escapeHtml(label)}</span>
      <input type="range" min="${bounds.min}" max="${bounds.max}" step="${bounds.step}" value="${base}" data-cad-range="${escapeHtml(name)}" data-base="${base}" data-is-length="${bounds.isLen ? "1" : "0"}" data-is-count="${bounds.isCount ? "1" : "0"}" data-live-preview="${live}" data-axis-role="${escapeHtml(axis)}" data-kind="${escapeHtml(kind)}" />
      <input type="number" step="${bounds.step}" value="${shown}" data-cad-number="${escapeHtml(name)}" data-is-length="${bounds.isLen ? "1" : "0"}" data-live-preview="${live}" data-axis-role="${escapeHtml(axis)}" data-kind="${escapeHtml(kind)}" />
      <em>${unit || (kind === "integer" || bounds.isCount ? "#" : "")}</em>
    </label>`;
  }).join("");
  return `<section class="cad-param-panel" data-cad-source="${escapeHtml(data.source)}" data-cad-resolved="${escapeHtml(data.resolvedFilename || "")}">
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
      <small>Panel W/H/T: drag for live preview, release to bake (like Generative Size). Other params rebuild on release.</small>
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

function nearlyEqual(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a) === String(b);
  return Math.abs(na - nb) < 1e-6 * Math.max(1, Math.abs(na), Math.abs(nb));
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
  bakeScale = null,
} = {}) {
  const root = panel?.querySelector?.(".cad-param-panel[data-cad-source]");
  if (!root || !projectId || !filename) return;
  let baseline = structuredClone(initialData?.params || []);
  let applyTimer = null;
  let applying = false;
  let queued = false;
  let queuedMode = null;
  let previewRoot = null;
  let previewBaseScale = null;
  let activePreviewName = null;
  let lastBakeKey = "";
  const applyFilename = initialData?.resolvedFilename
    || root.dataset.cadResolved
    || filename;

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

  const classifyChanges = (params) => {
    const envelope = {};
    const feature = {};
    for (const [name, value] of Object.entries(params)) {
      const baseParam = baseline.find((p) => p.name === name);
      const baseVal = baseParam?.value;
      if (baseParam != null && nearlyEqual(baseVal, value)) continue;
      if (canLivePreviewParam(name)) envelope[name] = value;
      else feature[name] = value;
    }
    return { envelope, feature };
  };

  /** Axis scale ratios from current envelope sliders vs baked bases. */
  const envelopeScale = () => {
    let sx = 1;
    let sy = 1;
    let sz = 1;
    let changed = false;
    root.querySelectorAll('[data-cad-range][data-live-preview="1"]').forEach((range) => {
      const base = Number(range.dataset.base);
      const value = Number(range.value);
      if (!(base > 1e-6) || !(value > 0) || !Number.isFinite(value)) return;
      const ratio = value / base;
      if (Math.abs(ratio - 1) < 1e-6) return;
      const axis = range.dataset.axisRole || "";
      if (axis === "x") sx = ratio;
      else if (axis === "y") sy = ratio;
      else if (axis === "z") sz = ratio;
      else return;
      changed = true;
    });
    return { scale: [sx, sy, sz], changed };
  };

  const adoptBaseline = (params) => {
    baseline = structuredClone(params || []);
    for (const param of baseline) {
      if (param.kind === "boolean" || param.kind === "string") continue;
      const range = root.querySelector(`[data-cad-range="${CSS.escape(param.name)}"]`);
      if (range) {
        range.dataset.base = String(param.value);
        syncRange(param.name, param.value);
      }
      syncNumber(param.name, param.value);
    }
  };

  /** Jake-style: bake envelope size into the mesh, then sync .py without regenerate. */
  const runBakeEnvelope = async (statusMessage = "Applying size change...") => {
    if (typeof bakeScale !== "function") {
      await runRebuild("Rebuilding model from updated parameters...");
      return;
    }
    if (applying) {
      queued = true;
      queuedMode = "bake";
      return;
    }
    const { scale, changed } = envelopeScale();
    if (!changed) {
      onStatus?.("ok", "Size already applied.");
      return;
    }
    const bakeKey = scale.map((v) => v.toFixed(5)).join(":");
    if (bakeKey === lastBakeKey) return;

    applying = true;
    const applyBtn = root.querySelector("[data-cad-param-apply]");
    onStatus?.("loading", statusMessage);
    if (applyBtn) applyBtn.disabled = true;
    try {
      // Keep live preview until bake succeeds — only then clear so reload isn't double-scaled.
      const result = await bakeScale({ scale });
      lastBakeKey = bakeKey;
      // Adopt current slider values as the new baked bases.
      root.querySelectorAll('[data-cad-range][data-live-preview="1"]').forEach((range) => {
        range.dataset.base = String(range.value);
        const name = range.dataset.cadRange;
        if (name) {
          const baseParam = baseline.find((p) => p.name === name);
          if (baseParam) baseParam.value = Number(range.value);
          syncNumber(name, range.value);
        }
      });
      resetLivePreview();
      previewRoot = null;
      previewBaseScale = null;
      ensurePreviewTarget();

      // Keep .py in sync with baked envelope dims (no full CAD rebuild).
      const params = readParamValues(root);
      try {
        const syncRes = await api(`/api/projects/${projectId}/files/${encodeURIComponent(applyFilename)}/cad-params`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ params, part, sync_only: true }),
        });
        if (Array.isArray(syncRes?.params)) adoptBaseline(syncRes.params);
      } catch {
        /* mesh already baked — source sync is best-effort */
      }
      onStatus?.("ok", "Size baked into model.");
      if (result && typeof onApplied === "function" && result._skipOnApplied) {
        /* bakeScale already reloaded */
      }
    } catch (err) {
      onStatus?.("error", err?.message || "Could not bake size.");
      applyLiveLengthPreview(activePreviewName);
    } finally {
      applying = false;
      if (applyBtn) applyBtn.disabled = false;
      if (queued) {
        const mode = queuedMode;
        queued = false;
        queuedMode = null;
        if (mode === "rebuild") await runRebuild("Applying latest parameter changes...");
        else await runBakeEnvelope("Applying latest size change...");
      }
    }
  };

  const runRebuild = async (statusMessage = "Rebuilding model from updated parameters...") => {
    if (applying) {
      queued = true;
      queuedMode = "rebuild";
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
    // Do NOT resetLivePreview here — only clear after a successful rebuild so a
    // failed/idempotent request doesn't snap the mesh back to the old size.
    try {
      const res = await api(`/api/projects/${projectId}/files/${encodeURIComponent(applyFilename)}/cad-params`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params, part }),
      });
      if (Array.isArray(res?.params)) adoptBaseline(res.params);
      resetLivePreview();
      lastBakeKey = "";
      onStatus?.("ok", res?.unchanged ? "Parameters already up to date." : "Model rebuilt from updated parameters.");
      if (!res?.unchanged && !res?.synced) {
        await onApplied?.(res);
      }
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
        const mode = queuedMode;
        queued = false;
        queuedMode = null;
        if (mode === "bake") await runBakeEnvelope("Applying latest size change...");
        else await runRebuild("Applying latest parameter changes...");
      }
    }
  };

  const scheduleRelease = (delayMs = 60) => {
    if (applyTimer) window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(() => {
      applyTimer = null;
      const params = readParamValues(root);
      const { envelope, feature } = classifyChanges(params);
      const hasEnvelope = Object.keys(envelope).length > 0 || envelopeScale().changed;
      const hasFeature = Object.keys(feature).length > 0;
      if (hasFeature) {
        // Feature geometry needs a real rebuild; bake envelope first if both changed.
        void (async () => {
          if (hasEnvelope && typeof bakeScale === "function") {
            await runBakeEnvelope("Baking size before rebuild...");
          }
          await runRebuild("Applying parameter change...");
        })();
        return;
      }
      if (hasEnvelope) {
        void runBakeEnvelope("Applying size change...");
        return;
      }
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
    range.addEventListener("change", () => scheduleRelease(80));
    range.addEventListener("pointerup", () => scheduleRelease(60));
  });
  root.querySelectorAll("[data-cad-number]").forEach((num) => {
    num.addEventListener("input", () => {
      const raw = num.dataset.isLength === "1" ? parseLength(num.value) : Number(num.value);
      if (!Number.isFinite(raw)) return;
      activePreviewName = num.dataset.cadNumber || null;
      syncRange(num.dataset.cadNumber, raw);
      if (num.dataset.livePreview === "1") applyLiveLengthPreview(activePreviewName);
    });
    num.addEventListener("change", () => scheduleRelease(80));
  });
  root.querySelectorAll("[data-cad-param]").forEach((input) => {
    if (input.type === "checkbox") {
      input.addEventListener("change", () => scheduleRelease(80));
    } else if (input.type === "text") {
      input.addEventListener("change", () => scheduleRelease(80));
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
    lastBakeKey = "";
  });

  root.querySelector("[data-cad-param-apply]")?.addEventListener("click", async () => {
    if (applyTimer) {
      window.clearTimeout(applyTimer);
      applyTimer = null;
    }
    await runRebuild();
  });
}
