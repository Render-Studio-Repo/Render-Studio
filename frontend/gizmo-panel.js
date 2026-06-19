/**
 * Fusion-style transform gizmo panel.
 *
 * Companion UI for the viewport TransformControls gizmo: live X/Y/Z readouts
 * you can type into (unit-aware, "25mm" / "1in"), move/rotate/scale mode
 * switching, snap increments, local/world space toggle, and apply / apply-as-
 * copy which persist the transform server-side.
 */

import * as THREE from "three";
import { getUnits, parseLength, displayValue, unitSuffix, formatLength, onUnitsChanged } from "./units.js?v=20260610-direct";
import { createFloatingPanelBehavior } from "./floating-panel.js?v=20260611-hud-drag";

const T_SNAPS_MM = [0, 0.1, 0.5, 1, 5, 10];
const R_SNAPS_DEG = [0, 5, 15, 45, 90];
const S_SNAPS = [0, 0.05, 0.1, 0.25];

export function createGizmoPanel({
  viewport,
  transformControls,
  getMesh,
  getModelInfo, // () => ({ projectId, filename })
  getMmPerModelUnit, // () => mm per 1 viewer/model unit
  api,
  onApplied,
  onStatus,
  onSnapRequest,
}) {
  let panel = null;
  let panelFloat = null;
  let dragHud = null;
  let start = null; // { position, quaternion, scale }
  let visible = false;
  let applying = false;
  let dragActive = false;

  function destroyDragHud() {
    dragHud?.remove();
    dragHud = null;
  }

  function showDragHud(text) {
    if (!dragHud) {
      dragHud = document.createElement("div");
      dragHud.className = "gizmo-drag-hud";
      viewport.appendChild(dragHud);
    }
    dragHud.textContent = text;
    dragHud.style.left = "50%";
    dragHud.style.top = "auto";
    dragHud.style.bottom = "72px";
    dragHud.style.transform = "translateX(-50%)";
  }

  function dragHudLabel() {
    const d = deltas();
    if (!d) return "";
    const mode = transformControls.getMode();
    const mmPer = getMmPerModelUnit();
    if (mode === "translate") {
      const parts = ["x", "y", "z"].map((a, i) => {
        const mm = d.translation[a] * mmPer;
        return Math.abs(mm) > 0.001 ? `${a.toUpperCase()} ${formatLength(mm)}` : null;
      }).filter(Boolean);
      return parts.length ? parts.join(" · ") : "0";
    }
    if (mode === "rotate") {
      return d.rotation.map((v, i) => `${["X", "Y", "Z"][i]} ${v.toFixed(1)}°`).join(" · ");
    }
    return `Scale ×${d.scale.toFixed(3)}`;
  }

  function targetObject() {
    return transformControls.object || getMesh();
  }

  function captureStart() {
    const mesh = targetObject();
    if (!mesh) return;
    start = {
      position: mesh.position.clone(),
      quaternion: mesh.quaternion.clone(),
      scale: mesh.scale.clone(),
    };
  }

  function deltas() {
    const mesh = targetObject();
    if (!mesh || !start) return null;
    const translation = mesh.position.clone().sub(start.position);
    const qDelta = mesh.quaternion.clone().multiply(start.quaternion.clone().invert());
    const euler = new THREE.Euler().setFromQuaternion(qDelta, "XYZ");
    const rotation = [
      THREE.MathUtils.radToDeg(euler.x),
      THREE.MathUtils.radToDeg(euler.y),
      THREE.MathUtils.radToDeg(euler.z),
    ];
    const scale = mesh.scale.x / (start.scale.x || 1);
    return { translation, rotation, scale };
  }

  function html() {
    const u = unitSuffix();
    return `
      <div class="gizmo-panel-title">
        Transform
        <span class="gizmo-panel-modes">
          <button type="button" data-gz-mode="translate" class="active">Move</button>
          <button type="button" data-gz-mode="rotate">Rotate</button>
          <button type="button" data-gz-mode="scale">Scale</button>
        </span>
        <button type="button" class="gizmo-panel-space" data-gz-space title="Toggle local/world axes">World</button>
      </div>
      <div class="gizmo-panel-fields" data-gz-fields>
        <label class="gz-x">X <input type="text" data-gz-axis="x" value="0" spellcheck="false" /><span data-gz-unit>${u}</span></label>
        <label class="gz-y">Y <input type="text" data-gz-axis="y" value="0" spellcheck="false" /><span data-gz-unit>${u}</span></label>
        <label class="gz-z">Z <input type="text" data-gz-axis="z" value="0" spellcheck="false" /><span data-gz-unit>${u}</span></label>
      </div>
      <div class="gizmo-panel-row">
        <label>Snap</label>
        <select data-gz-snap></select>
      </div>
      <div class="gizmo-panel-row gizmo-panel-snap-targets">
        <label>Snap to</label>
        <div class="gizmo-panel-button-group">
          <button type="button" data-gz-snap-target="object" title="Move selected object center to another object center">Object</button>
          <button type="button" data-gz-snap-target="face" title="Move selected object onto a clicked face">Face</button>
        </div>
      </div>
      <div class="gizmo-panel-actions">
        <button type="button" class="btn secondary" data-gz-reset>Reset</button>
        <button type="button" class="btn secondary" data-gz-copy title="Apply the transform to a duplicate body">Copy</button>
        <button type="button" class="btn primary" data-gz-apply>Apply</button>
      </div>
      <div class="gizmo-panel-status muted small" data-gz-status>Drag the gizmo or type exact values</div>`;
  }

  function snapOptions(mode) {
    const u = getUnits();
    if (mode === "rotate") return R_SNAPS_DEG.map((v) => [v, v ? `${v}°` : "Off"]);
    if (mode === "scale") return S_SNAPS.map((v) => [v, v ? `${v}` : "Off"]);
    const vals = u === "in" ? [0, 25.4 / 32, 25.4 / 16, 25.4 / 8, 25.4 / 4, 25.4] : T_SNAPS_MM;
    const labels = u === "in" ? ["Off", '1/32"', '1/16"', '1/8"', '1/4"', '1"'] : ["Off", "0.1 mm", "0.5 mm", "1 mm", "5 mm", "10 mm"];
    return vals.map((v, i) => [v, labels[i]]);
  }

  function refreshSnapSelect() {
    const sel = panel?.querySelector("[data-gz-snap]");
    if (!sel) return;
    const mode = transformControls.getMode();
    sel.innerHTML = snapOptions(mode)
      .map(([v, l]) => `<option value="${v}">${l}</option>`)
      .join("");
    sel.value = "0";
    applySnapSetting();
  }

  function applySnapSetting() {
    const sel = panel?.querySelector("[data-gz-snap]");
    const v = parseFloat(sel?.value) || 0;
    const mode = transformControls.getMode();
    if (mode === "translate") {
      // snap value is mm → convert to model units
      transformControls.setTranslationSnap(v > 0 ? v / getMmPerModelUnit() : null);
    } else if (mode === "rotate") {
      transformControls.setRotationSnap(v > 0 ? THREE.MathUtils.degToRad(v) : null);
    } else {
      transformControls.setScaleSnap(v > 0 ? v : null);
    }
  }

  function setModeButtons(mode) {
    panel?.querySelectorAll("[data-gz-mode]").forEach((b) => b.classList.toggle("active", b.dataset.gzMode === mode));
  }

  function updateFields() {
    if (!panel || !visible) return;
    const d = deltas();
    if (!d) return;
    const mode = transformControls.getMode();
    const mmPer = getMmPerModelUnit();
    const fields = panel.querySelectorAll("[data-gz-axis]");
    const unitEls = panel.querySelectorAll("[data-gz-unit]");
    fields.forEach((input) => {
      if (document.activeElement === input) return;
      const axis = input.dataset.gzAxis;
      let val;
      if (mode === "translate") val = displayValue(d.translation[axis] * mmPer);
      else if (mode === "rotate") val = parseFloat(d.rotation[{ x: 0, y: 1, z: 2 }[axis]].toFixed(2));
      else val = parseFloat(d.scale.toFixed(4));
      input.value = String(val);
    });
    unitEls.forEach((el) => {
      el.textContent = mode === "translate" ? unitSuffix() : mode === "rotate" ? "°" : "×";
    });
  }

  function readTypedDeltas() {
    const mode = transformControls.getMode();
    const mmPer = getMmPerModelUnit();
    const out = { x: 0, y: 0, z: 0 };
    for (const input of panel.querySelectorAll("[data-gz-axis]")) {
      const axis = input.dataset.gzAxis;
      if (mode === "translate") {
        const mm = parseLength(input.value);
        out[axis] = Number.isFinite(mm) ? mm / mmPer : 0;
      } else {
        const v = parseFloat(input.value);
        out[axis] = Number.isFinite(v) ? v : mode === "scale" ? 1 : 0;
      }
    }
    return out;
  }

  /** Apply typed values to the viewport object (live preview without drag). */
  function applyTypedToObject() {
    const mesh = targetObject();
    if (!mesh || !start) return;
    const mode = transformControls.getMode();
    const t = readTypedDeltas();
    if (mode === "translate") {
      mesh.position.copy(start.position).add(new THREE.Vector3(t.x, t.y, t.z));
    } else if (mode === "rotate") {
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(t.x),
          THREE.MathUtils.degToRad(t.y),
          THREE.MathUtils.degToRad(t.z),
          "XYZ"
        )
      );
      mesh.quaternion.copy(q.multiply(start.quaternion));
    } else {
      const s = t.x || 1;
      mesh.scale.copy(start.scale).multiplyScalar(s);
    }
    updateFields();
  }

  function resetObject() {
    const mesh = targetObject();
    if (!mesh || !start) return;
    mesh.position.copy(start.position);
    mesh.quaternion.copy(start.quaternion);
    mesh.scale.copy(start.scale);
    updateFields();
  }

  function setStatus(kind, text) {
    const el = panel?.querySelector("[data-gz-status]");
    if (el) {
      el.className = `gizmo-panel-status small ${kind === "error" ? "error" : kind === "loading" ? "loading" : "muted"}`;
      el.textContent = text;
    }
    onStatus?.(kind, text);
  }

  function resetObjectTransform(mesh) {
    if (!mesh) return;
    mesh.position.set(0, 0, 0);
    mesh.quaternion.set(0, 0, 0, 1);
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrixWorld(true);
  }

  async function apply(copy = false) {
    if (applying) return;
    const { projectId, filename, bodyIndex = null, bodyCount = 1, isRoot = true } = getModelInfo();
    const d = deltas();
    if (!projectId || !filename || !d) return;
    const body = { mode: "delta", copy };
    const hasT = d.translation.length() > 1e-12;
    const hasR = d.rotation.some((v) => Math.abs(v) > 1e-9);
    const hasS = Math.abs(d.scale - 1) > 1e-9;
    if (!hasT && !hasR && !hasS) {
      setStatus("error", "Nothing to apply — drag the gizmo or type values.");
      return;
    }
    applying = true;
    dragActive = false;
    const mesh = targetObject();
    if (hasT) body.translation = [d.translation.x, d.translation.y, d.translation.z];
    if (hasR) body.rotation_deg = d.rotation;
    if (hasS) body.scale = d.scale;
    setStatus("loading", copy ? "Copying + transforming…" : "Applying transform…");
    try {
      const useBodyTransform = !copy && bodyIndex != null && bodyCount > 1 && !isRoot;
      if (useBodyTransform) body.body_index = bodyIndex;
      const endpoint = useBodyTransform ? "transform-body" : "transform";
      const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // Delta is baked into the reloaded geometry; restore the pre-drag object
      // transform so placement stays where the user left it (centering offset is
      // kept on the object, not in the file vertices).
      const placementBaseline = start
        ? {
            position: start.position.toArray(),
            quaternion: start.quaternion.toArray(),
            scale: start.scale.toArray(),
          }
        : null;
      // Geometry now owns the move — clear the temporary gizmo offset before reload.
      if (mesh && !copy) resetObjectTransform(mesh);
      setStatus("ok", `Saved ${data.filename}`);
      await onApplied?.({ ...data, placementBaseline });
      captureStart();
      updateFields();
    } catch (err) {
      setStatus("error", err.message || "Transform failed");
      captureStart();
      updateFields();
    } finally {
      applying = false;
    }
  }

  function build() {
    panel = document.createElement("div");
    panel.className = "gizmo-panel hidden floating-panel";
    panel.innerHTML = html();
    viewport.appendChild(panel);
    panelFloat = createFloatingPanelBehavior(viewport, panel);
    panelFloat.bindDrag();
    panelFloat.dockRight();

    panel.querySelectorAll("[data-gz-mode]").forEach((btn) =>
      btn.addEventListener("click", () => {
        transformControls.setMode(btn.dataset.gzMode);
        setModeButtons(btn.dataset.gzMode);
        refreshSnapSelect();
        updateFields();
      })
    );
    panel.querySelector("[data-gz-space]").addEventListener("click", (e) => {
      const next = transformControls.space === "world" ? "local" : "world";
      transformControls.setSpace(next);
      e.target.textContent = next === "world" ? "World" : "Local";
    });
    panel.querySelector("[data-gz-snap]").addEventListener("change", applySnapSetting);
    panel.querySelectorAll("[data-gz-snap-target]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.gzSnapTarget;
        panel.querySelectorAll("[data-gz-snap-target]").forEach((b) => b.classList.toggle("active", b === btn));
        onSnapRequest?.(type);
      });
    });
    panel.querySelector("[data-gz-reset]").addEventListener("click", () => {
      resetObject();
      setStatus("muted", "Reset to original pose");
    });
    panel.querySelector("[data-gz-apply]").addEventListener("click", () => apply(false));
    panel.querySelector("[data-gz-copy]").addEventListener("click", () => apply(true));
    panel.querySelectorAll("[data-gz-axis]").forEach((input) => {
      input.addEventListener("input", applyTypedToObject);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          apply(false);
        }
        e.stopPropagation();
      });
    });

    transformControls.addEventListener("objectChange", () => {
      updateFields();
      if (visible && start && dragActive) showDragHud(dragHudLabel());
    });
    transformControls.addEventListener("mouseDown", () => {
      if (applying) return;
      dragActive = true;
      captureStart();
    });
    transformControls.addEventListener("mouseUp", () => {
      destroyDragHud();
      if (applying) return;
      updateFields();
      const d = deltas();
      const hasMoved =
        dragActive &&
        d &&
        (d.translation.length() > 1e-12 ||
          d.rotation.some((v) => Math.abs(v) > 1e-9) ||
          Math.abs(d.scale - 1) > 1e-9);
      dragActive = false;
      if (visible && hasMoved) {
        void apply(false);
      }
    });
    onUnitsChanged(() => {
      refreshSnapSelect();
      updateFields();
    });
  }

  build();

  return {
    show() {
      visible = true;
      captureStart();
      panel.classList.remove("hidden");
      if (!panelFloat?.isManual) panelFloat?.dockRight();
      setModeButtons(transformControls.getMode());
      refreshSnapSelect();
      updateFields();
    },
    hide() {
      visible = false;
      panel.classList.add("hidden");
      panel.querySelectorAll("[data-gz-snap-target]").forEach((b) => b.classList.remove("active"));
      destroyDragHud();
      transformControls.setTranslationSnap(null);
      transformControls.setRotationSnap(null);
      transformControls.setScaleSnap(null);
      start = null;
    },
    isVisible: () => visible,
    refresh: updateFields,
    resetDragBaseline() {
      dragActive = false;
      captureStart();
      updateFields();
    },
    clearSnapTarget() {
      panel.querySelectorAll("[data-gz-snap-target]").forEach((b) => b.classList.remove("active"));
    },
    translateBy(delta, { autoApply = true } = {}) {
      const mesh = targetObject();
      if (!mesh || !delta) return false;
      transformControls.setMode("translate");
      setModeButtons("translate");
      captureStart();
      mesh.position.add(delta);
      transformControls.dispatchEvent({ type: "objectChange" });
      updateFields();
      if (autoApply) void apply(false);
      return true;
    },
  };
}
