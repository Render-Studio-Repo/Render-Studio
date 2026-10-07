/**
 * Parametric feature timeline editor.
 *
 * Loads the Feature Program persisted next to kernel-built models
 * ({base}.program.json) and lets the user edit parameter values (unit-aware),
 * suppress, reorder, or delete features after creation, then rebuilds the
 * model parametrically via POST /api/projects/{id}/build.
 */

import { parseLength, displayValue, unitSuffix, onUnitsChanged } from "../studio/units.js?v=20260610-direct";

// Parameter keys that are lengths (mm) and should follow the document unit.
const LENGTH_KEYS = new Set([
  "length", "width", "height", "radius", "diameter", "depth", "distance",
  "thickness", "size", "bottom_radius", "top_radius", "major_radius",
  "minor_radius", "offset", "pitch", "x", "y", "z",
]);
const SKIP_KEYS = new Set(["op", "id", "combine", "suppressed"]);

const OP_ICONS = {
  box: "⬛", cylinder: "🔵", sphere: "🟡", cone: "🔺", torus: "⭕",
  extrude: "⬆", revolve: "🔄", hole: "🕳", fillet: "◠", chamfer: "◆",
  shell: "🪣", transform: "✥", move: "✥", mirror: "↔", loft: "🔷", pattern: "┼",
};

export function createFeatureEditor({ container, api, rawFetch, onApplied, onGenerating, isBusy }) {
  let projectId = null;
  let filename = null;
  let program = null;
  let programName = null;
  let dirty = false;

  function lengthKey(key) {
    return LENGTH_KEYS.has(key);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function candidateBases(name) {
    let base = name.replace(/\.(glb|gltf|stl|step|stp|obj|ply|off|3mf)$/i, "");
    const bases = [base];
    const stripped = base.replace(/(_edited|_pulled|_mirrored|_extruded|_copy\d*|_body\d*)+$/g, "");
    if (stripped !== base) bases.push(stripped);
    return bases;
  }

  async function setModel(pid, fname) {
    projectId = pid;
    filename = fname;
    program = null;
    programName = null;
    dirty = false;
    if (!pid || !fname) return render();
    for (const base of candidateBases(fname)) {
      try {
        const res = await rawFetch(`/api/projects/${pid}/files/${base}.program.json`);
        if (!res?.ok) continue;
        const json = await res.json();
        if (json && (json.parts?.length || json.meta?.mesh_edits?.length)) {
          program = json;
          programName = base;
          break;
        }
      } catch (_) {
        /* no program for this base */
      }
    }
    render();
  }

  function markDirty() {
    dirty = true;
    const btn = container.querySelector("[data-fe-rebuild]");
    if (btn) btn.disabled = false;
    const status = container.querySelector("[data-fe-status]");
    if (status) {
      status.textContent = "Edited — rebuild to apply";
      status.className = "feature-editor-status small";
    }
  }

  function paramRow(feat, key, value) {
    const row = el("div", "fe-param");
    const isLen = lengthKey(key);
    row.appendChild(el("label", "fe-param-label", key.replaceAll("_", " ")));

    if (Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "number")) {
      const wrap = el("div", "fe-param-vec");
      ["x", "y", "z"].forEach((axis, i) => {
        const input = el("input", "fe-input fe-input-vec");
        input.type = "text";
        input.value = String(displayValue(value[i]));
        input.title = `${key}.${axis}`;
        input.addEventListener("change", () => {
          const mm = parseLength(input.value);
          if (Number.isFinite(mm)) {
            feat[key][i] = mm;
            markDirty();
          }
          input.value = String(displayValue(feat[key][i]));
        });
        wrap.appendChild(input);
      });
      row.appendChild(wrap);
      row.appendChild(el("span", "fe-param-unit", unitSuffix()));
      return row;
    }

    const input = el("input", "fe-input");
    input.type = "text";
    input.value = isLen ? String(displayValue(value)) : String(value);
    input.addEventListener("change", () => {
      if (isLen) {
        const mm = parseLength(input.value);
        if (Number.isFinite(mm)) {
          feat[key] = mm;
          markDirty();
        }
        input.value = String(displayValue(feat[key]));
      } else {
        const v = parseFloat(input.value);
        if (Number.isFinite(v)) {
          feat[key] = v;
          markDirty();
        }
        input.value = String(feat[key]);
      }
    });
    row.appendChild(input);
    row.appendChild(el("span", "fe-param-unit", isLen ? unitSuffix() : key === "angle" || key.startsWith("rot") ? "°" : ""));
    return row;
  }

  function featureCard(part, feat, idx) {
    const card = el("div", "fe-feature" + (feat.suppressed ? " fe-feature-suppressed" : ""));
    const head = el("div", "fe-feature-head");
    head.appendChild(el("span", "fe-feature-icon", OP_ICONS[feat.op] || "◦"));
    const title = el("span", "fe-feature-title", `${idx + 1}. ${feat.op}`);
    if (feat.combine && feat.combine !== "new" && feat.combine !== "add") {
      title.textContent += ` (${feat.combine})`;
    }
    head.appendChild(title);

    const actions = el("div", "fe-feature-actions");
    const mkBtn = (label, titleText, fn, disabled = false) => {
      const b = el("button", "fe-btn", label);
      b.type = "button";
      b.title = titleText;
      b.disabled = disabled;
      b.addEventListener("click", fn);
      actions.appendChild(b);
    };
    mkBtn("↑", "Move earlier in timeline", () => {
      part.features.splice(idx - 1, 0, part.features.splice(idx, 1)[0]);
      markDirty();
      render();
    }, idx === 0);
    mkBtn("↓", "Move later in timeline", () => {
      part.features.splice(idx + 1, 0, part.features.splice(idx, 1)[0]);
      markDirty();
      render();
    }, idx === part.features.length - 1);
    mkBtn(feat.suppressed ? "▶" : "⏸", feat.suppressed ? "Unsuppress feature" : "Suppress feature (skip on rebuild)", () => {
      feat.suppressed = !feat.suppressed;
      markDirty();
      render();
    });
    mkBtn("✕", "Delete feature", () => {
      part.features.splice(idx, 1);
      markDirty();
      render();
    }, part.features.length <= 1);
    head.appendChild(actions);
    card.appendChild(head);

    const params = el("div", "fe-params");
    let shown = 0;
    for (const [key, value] of Object.entries(feat)) {
      if (SKIP_KEYS.has(key)) continue;
      if (key === "rotation" && Array.isArray(value) && value.every((v) => v === 0)) continue;
      if (key === "at" && Array.isArray(value) && value.every((v) => v === 0)) continue;
      if (typeof value === "number" || (Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "number"))) {
        params.appendChild(paramRow(feat, key, value));
        shown += 1;
      } else if (typeof value === "string" && key !== "edges" && key !== "openings" && key !== "plane" && key !== "arrange") {
        continue;
      } else if (typeof value === "string") {
        const row = el("div", "fe-param");
        row.appendChild(el("label", "fe-param-label", key));
        row.appendChild(el("span", "fe-param-static", value));
        params.appendChild(row);
        shown += 1;
      }
    }
    if (!shown) params.appendChild(el("p", "muted small", "No editable parameters"));
    card.appendChild(params);
    return card;
  }

  async function rebuild() {
    if (!program || !projectId) return;
    if (isBusy?.()) return;
    const status = container.querySelector("[data-fe-status]");
    if (status) {
      status.textContent = "Rebuilding…";
      status.className = "feature-editor-status small loading";
    }
    onGenerating?.(true, "Rebuilding model…");
    try {
      const data = await api(`/api/projects/${projectId}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(program),
      });
      dirty = false;
      if (status) {
        status.textContent = `✓ Rebuilt ${data.filename}`;
        status.className = "feature-editor-status small ok";
      }
      await onApplied?.(data);
    } catch (err) {
      if (status) {
        status.textContent = "✗ " + (err.message || "Rebuild failed");
        status.className = "feature-editor-status small error";
      }
    } finally {
      onGenerating?.(false);
    }
  }

  function render() {
    container.innerHTML = "";
    if (!program) {
      container.appendChild(
        el("p", "muted small", filename
          ? "No parametric history for this file. Models built with the toolbar or AI kernel keep an editable feature program."
          : "Load a model to see its feature history.")
      );
      return;
    }

    const head = el("div", "feature-editor-head");
    head.appendChild(el("strong", null, program.name || programName));
    const rebuildBtn = el("button", "btn accent btn-compact", "Rebuild");
    rebuildBtn.type = "button";
    rebuildBtn.disabled = !dirty;
    rebuildBtn.setAttribute("data-fe-rebuild", "");
    rebuildBtn.addEventListener("click", rebuild);
    head.appendChild(rebuildBtn);
    container.appendChild(head);

    const status = el("div", "feature-editor-status small muted", "Edit values, suppress, reorder — then rebuild");
    status.setAttribute("data-fe-status", "");
    container.appendChild(status);

    for (const part of program.parts || []) {
      if ((program.parts || []).length > 1) {
        container.appendChild(el("div", "fe-part-label", part.id));
      }
      (part.features || []).forEach((feat, idx) => {
        container.appendChild(featureCard(part, feat, idx));
      });
    }

    const meshEdits = program.meta?.mesh_edits || [];
    if (meshEdits.length) {
      container.appendChild(el("div", "fe-part-label", "Viewport edits"));
      meshEdits.forEach((edit, idx) => {
        const card = el("div", "fe-feature fe-mesh-edit");
        const head = el("div", "fe-feature-head");
        head.appendChild(el("span", "fe-feature-icon", OP_ICONS[edit.op] || "✎"));
        head.appendChild(el("span", "fe-feature-title", `${idx + 1}. ${edit.op}`));
        card.appendChild(head);
        const params = el("div", "fe-params");
        for (const [key, value] of Object.entries(edit)) {
          if (key === "at") continue;
          const row = el("div", "fe-param");
          row.appendChild(el("label", "fe-param-label", key));
          row.appendChild(el("span", "fe-param-static", typeof value === "object" ? JSON.stringify(value) : String(value)));
          params.appendChild(row);
        }
        card.appendChild(params);
        container.appendChild(card);
      });
    }
  }

  onUnitsChanged(() => render());

  return { setModel, render };
}
