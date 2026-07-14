/**
 * Jake-style parametric controls for text-to-cad v2 models ({base}.py + gen_step()).
 *
 * Length sliders preview live via mesh scale; discrete params rebuild on release.
 */

import { displayValue, parseLength, unitSuffix } from "./units.js?v=20260714-units-ft-m";

const LENGTH_HINTS = new Set([
  "length", "width", "height", "depth", "radius", "diameter", "thickness", "size",
  "pitch", "offset", "gap", "spacing", "clearance", "margin", "extrude", "height_mm",
  "orbit", "bore",
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function looksLikeLength(name) {
  const norm = String(name || "").toLowerCase();
  return [...LENGTH_HINTS].some((hint) => norm.includes(hint));
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
    return `<label class="cad-param-row" data-param-name="${escapeHtml(name)}">
      <span>${escapeHtml(label)}</span>
      <input type="range" min="${bounds.min}" max="${bounds.max}" step="${bounds.step}" value="${base}" data-cad-range="${escapeHtml(name)}" data-base="${base}" data-is-length="${bounds.isLen ? "1" : "0"}" data-is-count="${bounds.isCount ? "1" : "0"}" data-kind="${escapeHtml(kind)}" />
      <input type="number" step="${bounds.step}" value="${shown}" data-cad-number="${escapeHtml(name)}" data-is-length="${bounds.isLen ? "1" : "0"}" data-kind="${escapeHtml(kind)}" />
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
      <small>Length sliders preview live; release or Rebuild runs scripts/step.</small>
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

function lengthPreviewScale(panel) {
  const ratios = [];
  panel.querySelectorAll("[data-cad-range][data-is-length='1']").forEach((range) => {
    const base = Number(range.dataset.base);
    const value = Number(range.value);
    if (Number.isFinite(base) && base > 1e-6 && Number.isFinite(value) && value > 0) {
      ratios.push(value / base);
    }
  });
  if (!ratios.length) return 1;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
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

  const ensurePreviewTarget = () => {
    const obj = typeof getPreviewRoot === "function" ? getPreviewRoot() : null;
    if (!obj) return null;
    if (previewRoot !== obj) {
      previewRoot = obj;
      previewBaseScale = obj.scale.clone();
    }
    return previewRoot;
  };

  const applyLiveLengthPreview = () => {
    const obj = ensurePreviewTarget();
    if (!obj || !previewBaseScale) return;
    const scale = lengthPreviewScale(root);
    obj.scale.set(
      previewBaseScale.x * scale,
      previewBaseScale.y * scale,
      previewBaseScale.z * scale
    );
  };

  const resetLivePreview = () => {
    const obj = previewRoot;
    if (obj && previewBaseScale) obj.scale.copy(previewBaseScale);
  };

  const syncNumber = (name, value) => {
    const num = root.querySelector(`[data-cad-number="${name}"]`);
    if (!num) return;
    const isLen = num.dataset.isLength === "1";
    const kind = num.dataset.kind || "";
    const numeric = Number(value);
    const shown = kind === "integer" ? Math.round(numeric) : numeric;
    num.value = isLen ? String(displayValue(shown)) : String(shown);
  };
  const syncRange = (name, value) => {
    const range = root.querySelector(`[data-cad-range="${name}"]`);
    if (!range) return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    // Expand slider bounds if the typed value is outside.
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
    // Drop optimistic scale so the reloaded mesh isn't double-scaled.
    resetLivePreview();
    try {
      const res = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/cad-params`, {
        method: "POST",
        body: JSON.stringify({ params, part }),
      });
      baseline = structuredClone(res.params || []);
      // Refresh slider bases to the newly rebuilt values.
      for (const param of baseline) {
        if (param.kind === "boolean" || param.kind === "string") continue;
        const range = root.querySelector(`[data-cad-range="${param.name}"]`);
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
      applyLiveLengthPreview();
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
    range.addEventListener("input", () => {
      syncNumber(range.dataset.cadRange, range.value);
      if (range.dataset.isLength === "1") {
        applyLiveLengthPreview();
      }
    });
    // Commit geometry on release so dragging stays real-time for lengths
    // and discrete params (planet_count, teeth) rebuild once.
    range.addEventListener("change", () => scheduleRebuild(80));
    range.addEventListener("pointerup", () => scheduleRebuild(60));
  });
  root.querySelectorAll("[data-cad-number]").forEach((num) => {
    num.addEventListener("input", () => {
      const raw = num.dataset.isLength === "1" ? parseLength(num.value) : Number(num.value);
      if (!Number.isFinite(raw)) return;
      syncRange(num.dataset.cadNumber, raw);
      if (num.dataset.isLength === "1") applyLiveLengthPreview();
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
        const input = root.querySelector(`[data-cad-param="${param.name}"]`);
        if (input) input.checked = !!param.value;
        continue;
      }
      if (param.kind === "string") {
        const input = root.querySelector(`[data-cad-param="${param.name}"]`);
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
