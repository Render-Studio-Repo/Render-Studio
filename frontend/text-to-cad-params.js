/**
 * Jake-style parametric controls for text-to-cad v2 models ({base}.py + gen_step()).
 */

import { displayValue, parseLength, unitSuffix } from "./units.js?v=20260610-direct";

const LENGTH_HINTS = new Set([
  "length", "width", "height", "depth", "radius", "diameter", "thickness", "size",
  "pitch", "offset", "gap", "spacing", "clearance", "margin", "extrude", "height_mm",
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
    const isLen = looksLikeLength(name);
    const numeric = Number(param.value);
    const base = Number.isFinite(numeric) ? numeric : 0;
    const min = isLen ? Math.max(0.1, base * 0.2) : Math.max(0, base - Math.abs(base || 1));
    const max = isLen ? Math.max(base * 2.5, min + 1) : base + Math.abs(base || 1) * 2;
    const step = Number.isInteger(base) && !isLen ? 1 : 0.1;
    const shown = isLen ? displayValue(base) : base;
    const unit = isLen ? unitSuffix() : "";
    return `<label class="cad-param-row" data-param-name="${escapeHtml(name)}">
      <span>${escapeHtml(label)}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${base}" data-cad-range="${escapeHtml(name)}" data-base="${base}" data-is-length="${isLen ? "1" : "0"}" />
      <input type="number" step="${step}" value="${shown}" data-cad-number="${escapeHtml(name)}" data-is-length="${isLen ? "1" : "0"}" />
      <em>${unit || (kind === "integer" ? "#" : "")}</em>
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
      <small>Updates module constants in ${escapeHtml(data.source)} and reruns scripts/step.</small>
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
    const parsed = isLen ? parseLength(input.value) : Number(input.value);
    if (Number.isFinite(parsed)) values[name] = parsed;
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
} = {}) {
  const root = panel?.querySelector?.(".cad-param-panel[data-cad-source]");
  if (!root || !projectId || !filename) return;
  let baseline = structuredClone(initialData?.params || []);
  let applyTimer = null;
  let applying = false;
  let queued = false;

  const syncNumber = (name, value) => {
    const num = root.querySelector(`[data-cad-number="${name}"]`);
    if (!num) return;
    const isLen = num.dataset.isLength === "1";
    num.value = isLen ? String(displayValue(value)) : String(value);
  };
  const syncRange = (name, value) => {
    const range = root.querySelector(`[data-cad-range="${name}"]`);
    if (range) range.value = String(value);
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
    try {
      const res = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/cad-params`, {
        method: "POST",
        body: JSON.stringify({ params, part }),
      });
      baseline = structuredClone(res.params || []);
      onStatus?.("ok", "Model rebuilt from updated parameters.");
      await onApplied?.(res);
    } catch (err) {
      onStatus?.("error", err?.message || "Could not rebuild model.");
    } finally {
      applying = false;
      if (applyBtn) applyBtn.disabled = false;
      if (queued) {
        queued = false;
        await runApply("Applying latest parameter changes...");
      }
    }
  };

  const scheduleApply = (delayMs = 350) => {
    if (applyTimer) window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(() => {
      applyTimer = null;
      void runApply("Applying live parameter change...");
    }, delayMs);
  };

  root.querySelectorAll("[data-cad-range]").forEach((range) => {
    range.addEventListener("input", () => {
      syncNumber(range.dataset.cadRange, range.value);
      scheduleApply(280);
    });
  });
  root.querySelectorAll("[data-cad-number]").forEach((num) => {
    num.addEventListener("input", () => syncRange(num.dataset.cadNumber, num.value));
    num.addEventListener("change", () => scheduleApply(120));
  });
  root.querySelectorAll("[data-cad-param]").forEach((input) => {
    if (input.type === "checkbox") {
      input.addEventListener("change", () => scheduleApply(120));
    } else if (input.type === "text") {
      input.addEventListener("change", () => scheduleApply(120));
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
  });

  root.querySelector("[data-cad-param-apply]")?.addEventListener("click", async () => {
    if (applyTimer) {
      window.clearTimeout(applyTimer);
      applyTimer = null;
    }
    await runApply();
  });
}
