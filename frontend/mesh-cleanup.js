/**
 * Mesh Checkup — topology diagnostics and cleanup for selected or whole mesh.
 *
 * Works with @face, @lasso, and other refs that carry face_indices.
 * Check-only runs a vision-style topology report; Apply runs repair and/or smoothing.
 */

import { createFloatingPanelBehavior } from "./floating-panel.js?v=20260611-hud-drag";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function selectionSummary(refs) {
  const usable = (refs || []).filter(
    (r) => (r.face_indices && r.face_indices.length) || r.face_index != null
  );
  if (!usable.length) return { scope: "whole", label: "Whole mesh", faceCount: 0, refs: [] };
  const faceSet = new Set();
  for (const ref of usable) {
    for (const fi of ref.face_indices || []) faceSet.add(Number(fi));
    if (ref.face_index != null) faceSet.add(Number(ref.face_index));
  }
  const ids = usable.map((r) => `@${String(r.id).replace(/^@/, "")}`).join(", ");
  return {
    scope: "selection",
    label: `${ids} · ${faceSet.size} triangle${faceSet.size === 1 ? "" : "s"}`,
    faceCount: faceSet.size,
    refs: usable,
  };
}

function renderReport(report) {
  if (!report) return '<p class="muted small">No report yet.</p>';
  const healthy = report.healthy ? "ok" : "warn";
  const issues = (report.issues || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  const selection = report.selection;
  const selIssues = selection?.issues?.length
    ? `<ul class="mesh-checkup-issues">${selection.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
    : "";
  return `<div class="mesh-checkup-report mesh-checkup-${healthy}">
    <div class="mesh-checkup-stats">
      <span>${report.faces} faces</span>
      <span>${report.vertices} verts</span>
      <span>${report.bodies} bod${report.bodies === 1 ? "y" : "ies"}</span>
      <span>${report.watertight ? "watertight" : "open"}</span>
    </div>
    ${
      issues
        ? `<ul class="mesh-checkup-issues">${issues}</ul>`
        : '<p class="mesh-checkup-ok">No topology issues detected.</p>'
    }
    ${
      selection
        ? `<div class="mesh-checkup-selection">
            <strong>Selection</strong> · ${selection.face_count} triangles
            ${selIssues || '<p class="mesh-checkup-ok">Selection region looks clean.</p>'}
          </div>`
        : ""
    }
  </div>`;
}

export function createMeshCleanup({
  viewport,
  api,
  getModelInfo,
  getReferences,
  onApplied,
  onStatus,
}) {
  let panel = null;
  let panelFloat = null;
  let visible = false;
  let busy = false;
  let lastReport = null;

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.className = "mesh-checkup-panel gizmo-panel hidden";
    panel.innerHTML = `<div class="gizmo-panel-title">
        <span>Mesh Checkup</span>
        <button type="button" class="btn secondary btn-compact" data-mc-close>Close</button>
      </div>
      <p class="muted small mesh-checkup-target">Load a model to begin.</p>
      <div class="mesh-checkup-options">
        <label class="mesh-checkup-opt"><input type="checkbox" data-mc-repair checked /> Repair topology</label>
        <label class="mesh-checkup-opt"><input type="checkbox" data-mc-smooth /> Smooth selection</label>
        <label class="mesh-checkup-opt mesh-checkup-smooth-row hidden">
          Method
          <select data-mc-method>
            <option value="taubin" selected>Taubin (shape-preserving)</option>
            <option value="laplacian">Laplacian</option>
          </select>
        </label>
        <label class="mesh-checkup-opt mesh-checkup-smooth-row hidden">
          Iterations
          <input type="number" data-mc-iters min="1" max="50" value="8" />
        </label>
      </div>
      <div class="mesh-checkup-results"></div>
      <div class="gizmo-panel-actions">
        <button type="button" class="btn secondary btn-compact" data-mc-check>Check</button>
        <button type="button" class="btn accent btn-compact" data-mc-apply>Apply cleanup</button>
      </div>
      <div class="gizmo-panel-status muted small" data-mc-status></div>`;
    viewport.appendChild(panel);
    panelFloat = createFloatingPanelBehavior(viewport, panel);

    panel.querySelector("[data-mc-close]")?.addEventListener("click", hide);
    panel.querySelector("[data-mc-check]")?.addEventListener("click", () => run(false));
    panel.querySelector("[data-mc-apply]")?.addEventListener("click", () => run(true));

    const smoothCb = panel.querySelector("[data-mc-smooth]");
    const smoothRows = panel.querySelectorAll(".mesh-checkup-smooth-row");
    smoothCb?.addEventListener("change", () => {
      smoothRows.forEach((row) => row.classList.toggle("hidden", !smoothCb.checked));
    });
  }

  function setStatus(kind, text) {
    const el = panel?.querySelector("[data-mc-status]");
    if (el) {
      el.className = `gizmo-panel-status small ${kind || ""}`.trim();
      el.textContent = text || "";
    }
    onStatus?.(kind, text);
  }

  function updateTarget() {
    const targetEl = panel?.querySelector(".mesh-checkup-target");
    const { filename } = getModelInfo?.() || {};
    const refs = getReferences?.() || [];
    const sel = selectionSummary(refs);
    if (!filename) {
      if (targetEl) targetEl.textContent = "Load a model file first.";
      return sel;
    }
    if (targetEl) {
      targetEl.textContent =
        sel.scope === "selection"
          ? `Target: ${sel.label}`
          : "Target: whole mesh (pick a face or lasso to scope cleanup)";
    }
    return sel;
  }

  function renderResults(report) {
    lastReport = report;
    const el = panel?.querySelector(".mesh-checkup-results");
    if (el) el.innerHTML = renderReport(report);
  }

  async function run(apply) {
    if (busy) return;
    const { projectId, filename } = getModelInfo?.() || {};
    if (!projectId || !filename) {
      setStatus("error", "Load a model file first.");
      return;
    }
    const refs = getReferences?.() || [];
    const sel = selectionSummary(refs);
    const repair = panel.querySelector("[data-mc-repair]")?.checked ?? true;
    const smooth = panel.querySelector("[data-mc-smooth]")?.checked ?? false;
    const smoothMethod = panel.querySelector("[data-mc-method]")?.value || "taubin";
    const smoothIterations = Number(panel.querySelector("[data-mc-iters]")?.value || 8);

    if (apply && !repair && !smooth) {
      setStatus("error", "Enable repair and/or smoothing before applying.");
      return;
    }
    if (apply && smooth && sel.scope !== "selection") {
      setStatus("error", "Smoothing requires a face or lasso selection.");
      return;
    }

    busy = true;
    setStatus("loading", apply ? "Running cleanup…" : "Checking topology…");
    panel.querySelector("[data-mc-check]").disabled = true;
    panel.querySelector("[data-mc-apply]").disabled = true;
    try {
      const body = {
        scope: sel.scope,
        references: refs,
        apply,
        repair,
        smooth,
        smooth_method: smoothMethod,
        smooth_iterations: smoothIterations,
      };
      const data = await api(
        `/api/projects/${projectId}/files/${encodeURIComponent(filename)}/mesh-cleanup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      renderResults(data.report || data.before);
      if (apply) {
        setStatus("ok", `Cleanup applied → ${data.filename}`);
        onApplied?.(data);
        hide();
      } else {
        const healthy = data.report?.healthy;
        setStatus(healthy ? "ok" : "warn", healthy ? "Topology looks good." : "Issues found — review report or apply cleanup.");
      }
    } catch (err) {
      setStatus("error", err.message || "Mesh checkup failed.");
    } finally {
      busy = false;
      panel.querySelector("[data-mc-check]").disabled = false;
      panel.querySelector("[data-mc-apply]").disabled = false;
    }
  }

  function show() {
    ensurePanel();
    visible = true;
    panel.classList.remove("hidden");
    updateTarget();
    if (lastReport) renderResults(lastReport);
    panelFloat?.dockRight?.();
    setStatus("", "");
  }

  function hide() {
    visible = false;
    panel?.classList.add("hidden");
  }

  function toggle() {
    if (visible) hide();
    else show();
  }

  function refresh() {
    if (!visible) return;
    updateTarget();
  }

  return { show, hide, toggle, refresh, runCheck: () => run(false) };
}
