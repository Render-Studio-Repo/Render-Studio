/**
 * Edit panel coordinator — viewport-first Fusion-style tools.
 *
 * Move / rotate / scale activate the TransformControls gizmo + typed panel.
 * Extrude / cut activates Press-Pull in the viewport (drag arrow + live preview).
 * Mirror activates the mirror plane tool.
 *
 * Legacy popup-only number fields are removed; all values use units.js (mm/in).
 */

import { parseLength, formatLength, unitSuffix, onUnitsChanged } from "./units.js?v=20260610-direct";

export function createEditTools({
  api,
  getState,
  onApplied,
  onStatus,
  gizmoPanel,
  directModeling,
  getMmPerModelUnit,
}) {
  const panel = document.getElementById("edit-panel");
  if (!panel) return {};

  let activeTool = "move";

  function setStatus(kind, text) {
    onStatus?.(kind, text);
  }

  function selectedFaceRef() {
    const { composer } = getState();
    const refs = composer?.getReferences?.() || [];
    return refs.find((r) => r.type === "face") || refs.find((r) => r.face_index != null) || null;
  }

  function updateExtrudeTarget() {
    const el = document.getElementById("extrude-target");
    if (!el) return;
    const ref = selectedFaceRef();
    const sketch = getState().getSketchForExtrude?.();
    const sketchCount = getState().countVisibleSketches?.() ?? 0;
    if (ref) {
      el.textContent = `@${String(ref.id).replace(/^@/, "")} · face #${ref.face_index ?? "?"}`;
      el.classList.remove("muted");
    } else if (sketch?.profile?.length && sketchCount === 1) {
      el.textContent = `Sketch “${sketch.name || "profile"}” · click profile or Start Press-Pull`;
      el.classList.remove("muted");
    } else if (sketchCount > 0) {
      el.textContent = `${sketchCount} sketches visible — click a profile to extrude`;
      el.classList.remove("muted");
    } else {
      el.textContent = "Click a sketch profile or model face, or pick with F first";
      el.classList.add("muted");
    }
  }

  function selectedFace() {
    return selectedFaceRef();
  }

  function activateGizmo(mode) {
    const btn = document.getElementById("btn-gizmo");
    const tc = getState().transformControls;
    if (!tc || !getState().selectedFile) {
      setStatus("error", "Load a model file first.");
      return;
    }
    directModeling?.reset?.();
    document.querySelectorAll("[data-dm-tool]").forEach((b) => b.classList.remove("active"));
    tc.setMode(mode);
    const mesh = getState().getMesh?.();
    if (!mesh) {
      setStatus("error", "Load a model file first.");
      return;
    }
    tc.attach(mesh);
    btn?.classList.add("active");
    getState().controls.enabled = true;
    gizmoPanel?.show?.();
    setStatus(
      "ok",
      `${mode === "translate" ? "Move" : mode === "rotate" ? "Rotate" : "Scale"} — drag arrows/rings or type values in the gizmo panel`
    );
  }

  function setTool(tool) {
    activeTool = tool;
    panel.querySelectorAll(".edit-tool-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    panel.querySelectorAll(".edit-tool-pane").forEach((pane) => {
      pane.classList.toggle("hidden", pane.dataset.tool !== tool);
    });

    if (tool === "move") activateGizmo("translate");
    else if (tool === "rotate") activateGizmo("rotate");
    else if (tool === "scale") activateGizmo("scale");
    else if (tool === "extrude") {
      gizmoPanel?.hide?.();
      document.getElementById("btn-gizmo")?.classList.remove("active");
      getState().transformControls?.detach?.();
      const ref = selectedFace();
      const sketch = getState().getSketchForExtrude?.();
      const sketchCount = getState().countVisibleSketches?.() ?? 0;
      if (sketch?.profile?.length && sketchCount === 1) {
        getState().startExtrudeFromSketch?.(sketch);
      } else if (ref && directModeling?.startPressPullFromRef?.(ref)) {
        /* linked to picked face */
      } else {
        directModeling?.setTool?.("presspull");
      }
      updateExtrudeTarget();
    }
  }

  function launchMirror() {
    gizmoPanel?.hide?.();
    document.getElementById("btn-gizmo")?.classList.remove("active");
    getState().transformControls?.detach?.();
    directModeling?.setTool?.("mirror");
  }

  panel.querySelectorAll(".edit-tool-tab").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  document.getElementById("btn-launch-mirror")?.addEventListener("click", launchMirror);
  document.getElementById("btn-launch-presspull")?.addEventListener("click", () => setTool("extrude"));

  onUnitsChanged(() => {
    panel.querySelectorAll("[data-edit-unit-label]").forEach((el) => {
      el.textContent = unitSuffix();
    });
  });

  setTool("move");

  return {
    setTool,
    updateExtrudeTarget,
    launchMirror,
    launchPressPull: () => setTool("extrude"),
  };
}

/** Convert typed UI mm to model units for the transform API. */
export function mmToModelUnits(mm, mmPerUnit) {
  const scale = mmPerUnit ?? 1;
  return mm / scale;
}

/** Parse a length field and convert to model units. */
export function parseLengthToModelUnits(text, mmPerUnit) {
  const mm = parseLength(text);
  if (!Number.isFinite(mm)) return NaN;
  return mmToModelUnits(mm, mmPerUnit);
}

export function formatModelUnitsAsLength(modelUnits, mmPerUnit) {
  return formatLength(modelUnits * (mmPerUnit ?? 1));
}
