/** Edit panel: move / rotate / scale / extrude tools (mm in UI, meters in API). */

const MM = 0.001;

export function createEditTools({ api, getState, onApplied, onStatus }) {
  const panel = document.getElementById("edit-panel");
  if (!panel) return {};

  let activeTool = "move";
  let stepMm = 1;

  function $(id) {
    return document.getElementById(id);
  }

  function readNum(id, fallback = 0) {
    const v = parseFloat($(id)?.value);
    return Number.isFinite(v) ? v : fallback;
  }

  function setStatus(kind, text) {
    onStatus?.(kind, text);
  }

  function selectedFaceRef() {
    const { composer } = getState();
    const refs = composer?.getReferences?.() || [];
    return refs.find((r) => r.type === "face") || refs.find((r) => r.face_index != null) || null;
  }

  function updateExtrudeTarget() {
    const el = $("extrude-target");
    if (!el) return;
    const ref = selectedFaceRef();
    if (ref) {
      el.textContent = `@${ref.id.replace(/^@/, "")} · face #${ref.face_index ?? "?"}`;
      el.classList.remove("muted");
    } else {
      el.textContent = "Pick a face (F) on the model";
      el.classList.add("muted");
    }
  }

  function setTool(tool) {
    activeTool = tool;
    panel.querySelectorAll(".edit-tool-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    panel.querySelectorAll(".edit-tool-pane").forEach((pane) => {
      pane.classList.toggle("hidden", pane.dataset.tool !== tool);
    });
    const gizmoBtn = $("btn-gizmo");
    if (gizmoBtn && getState().transformControls) {
      const tc = getState().transformControls;
      if (tool === "move") tc.setMode("translate");
      if (tool === "rotate") tc.setMode("rotate");
      if (tool === "scale") tc.setMode("scale");
      if (tool === "extrude") {
        tc.detach();
        gizmoBtn.classList.remove("active");
        getState().controls.enabled = true;
      }
    }
    updateExtrudeTarget();
  }

  function nudge(axis, sign) {
    const delta = sign * stepMm * MM;
    const map = { x: "edit-dx", y: "edit-dy", z: "edit-dz" };
    const input = $(map[axis]);
    if (input) input.value = ((readNum(map[axis]) + delta / MM) * 1000) / 1000;
  }

  function resetDeltas() {
    ["edit-dx", "edit-dy", "edit-dz", "edit-rx", "edit-ry", "edit-rz"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "0";
    });
    const sc = $("edit-scale-d");
    if (sc) sc.value = "1";
  }

  async function applyTransform() {
    const { projectId, selectedFile } = getState();
    if (!projectId || !selectedFile) {
      alert("Select a file first.");
      return;
    }

    const body = { mode: "delta" };

    if (activeTool === "move") {
      body.translation = [
        readNum("edit-dx") * MM,
        readNum("edit-dy") * MM,
        readNum("edit-dz") * MM,
      ];
      if (body.translation.every((v) => Math.abs(v) < 1e-12)) {
        setStatus("error", "Enter a move distance (mm).");
        return;
      }
    } else if (activeTool === "rotate") {
      body.rotation_deg = [readNum("edit-rx"), readNum("edit-ry"), readNum("edit-rz")];
      if (body.rotation_deg.every((v) => Math.abs(v) < 1e-9)) {
        setStatus("error", "Enter a rotation (degrees).");
        return;
      }
    } else if (activeTool === "scale") {
      const s = readNum("edit-scale-d", 1);
      if (Math.abs(s - 1) < 1e-9) {
        setStatus("error", "Scale must differ from 1.");
        return;
      }
      body.scale = s;
    } else {
      return applyExtrude();
    }

    setStatus("loading", "Applying transform…");
    try {
      const data = await api(`/api/projects/${projectId}/files/${selectedFile}/transform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      resetDeltas();
      setStatus("ok", `Saved ${data.filename}`);
      await onApplied?.(data);
    } catch (err) {
      setStatus("error", err.message);
    }
  }

  async function applyExtrude() {
    const { projectId, selectedFile } = getState();
    if (!projectId || !selectedFile) {
      alert("Select a file first.");
      return;
    }

    const ref = selectedFaceRef();
    if (!ref || ref.face_index == null) {
      setStatus("error", "Pick a face on the model first (F).");
      return;
    }

    const distance_mm = readNum("extrude-distance", 10);
    if (distance_mm <= 0) {
      setStatus("error", "Extrude distance must be > 0 mm.");
      return;
    }

    setStatus("loading", "Extruding face…");
    try {
      const data = await api(`/api/projects/${projectId}/files/${selectedFile}/extrude`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          at_ref: ref.id,
          face_index: ref.face_index,
          distance_mm,
          inward: $("extrude-inward")?.checked || false,
          axis: ref.normal || undefined,
        }),
      });
      setStatus("ok", `Extruded → ${data.filename}`);
      await onApplied?.(data);
    } catch (err) {
      setStatus("error", err.message);
    }
  }

  panel.querySelectorAll(".edit-tool-tab").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  $("edit-step")?.addEventListener("change", (e) => {
    stepMm = parseFloat(e.target.value) || 1;
  });

  panel.querySelectorAll("[data-nudge]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [axis, sign] = btn.dataset.nudge.split(",");
      nudge(axis, parseInt(sign, 10));
    });
  });

  $("btn-reset-transform")?.addEventListener("click", resetDeltas);
  $("btn-apply-transform")?.addEventListener("click", applyTransform);
  $("btn-extrude")?.addEventListener("click", applyExtrude);

  setTool("move");

  return {
    setTool,
    updateExtrudeTarget,
    resetDeltas,
  };
}

export function mmToApi(mm) {
  return mm * MM;
}
