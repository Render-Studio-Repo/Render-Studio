/**
 * Architect session — ties building, mesh, draw, bay grid, camera, and API.
 * Host calls enter/exit/frame; Design mode never constructs this until Architect opens.
 */

import { createArchitectBuilding } from "./architect-building.js?v=20260714-erase-grid";
import { createArchitectMeshLayer } from "./architect-mesh.js?v=20260714-erase-grid";
import { createArchitectDrawTool } from "./architect-draw.js?v=20260714-erase-grid";
import {
  applyArchitectDefaultView,
  clampArchitectHorizon,
} from "./architect-camera.js?v=20260714-erase-grid";

/**
 * @param {{
 *   scene: import("three").Scene,
 *   camera: import("three").Camera,
 *   controls: { target: import("three").Vector3, update?: Function, _eye?: import("three").Vector3 },
 *   domElement: HTMLElement,
 *   getMmPerModelUnit: () => number,
 *   bayGrid?: { setActive: (v: boolean) => void, syncFromScene: () => void },
 *   api: (path: string, opts?: object) => Promise<any>,
 *   getProjectId: () => string|null,
 *   onStatus?: (tone: string, msg: string) => void,
 * }} opts
 */
export function createArchitectSession(opts) {
  const {
    scene,
    camera,
    controls,
    domElement,
    getMmPerModelUnit,
    bayGrid,
    api,
    getProjectId,
    onStatus,
  } = opts;

  const building = createArchitectBuilding();
  const meshLayer = createArchitectMeshLayer({ scene, getMmPerModelUnit });
  const draw = createArchitectDrawTool({
    scene,
    camera,
    domElement,
    building,
    getMmPerModelUnit,
    onStatus,
  });

  let active = false;
  let loadedProjectId = null;
  let saveTimer = null;
  let suppressSave = false;

  draw.setOnPendingDeleteChange?.((ids) => {
    meshLayer.setPendingDeleteIds?.(ids);
    meshLayer.setSelected(draw.getSelectedId());
    meshLayer.rebuild(building.getBuilding());
  });

  building.onChange((b) => {
    meshLayer.setSelected(draw.getSelectedId());
    meshLayer.rebuild(b);
    syncToolbar();
    if (!suppressSave) scheduleSave();
  });

  function syncAfterDraw() {
    meshLayer.setSelected(draw.getSelectedId());
    meshLayer.rebuild(building.getBuilding());
    syncToolbar();
  }

  function syncToolbar() {
    const mode = draw.getMode();
    document.querySelectorAll("[data-architect-step]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-architect-step") === mode);
    });
    const hintEl = document.getElementById("architect-domino-hint");
    if (hintEl) {
      if (mode === "draw") {
        hintEl.textContent = "Drag walls · Shift+drag room · Right-click deletes one · Shift+right-drag erases area · Middle pans · Shift+middle orbits/pans up-down";
      } else if (mode === "window") {
        hintEl.textContent = "Drag window tiles · Right-click deletes · Shift+right-drag erases area · Middle pans";
      } else if (mode === "door") {
        hintEl.textContent = "Drag door tiles · Right-click deletes · Shift+right-drag erases area · Middle pans";
      } else {
        hintEl.textContent = "Click to select · Right-click or Delete removes · Shift+right-drag erases area";
      }
    }
    const levelEl = document.getElementById("architect-active-level");
    if (levelEl) {
      const level = building.activeLevel();
      levelEl.textContent = level?.name || "Ground Floor";
    }
    const countEl = document.getElementById("architect-segment-count");
    if (countEl) {
      countEl.textContent = String(building.segmentsOnActiveLevel().length);
    }
  }

  function scheduleSave() {
    const pid = getProjectId?.();
    if (!pid || !api) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void persist();
    }, 400);
  }

  async function persist() {
    const pid = getProjectId?.();
    if (!pid || !api) return;
    try {
      await api(`/api/projects/${encodeURIComponent(pid)}/architect/building`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(building.getSnapshot()),
      });
    } catch (err) {
      console.warn("architect save failed", err);
    }
  }

  async function loadFromServer() {
    const pid = getProjectId?.();
    if (!pid || !api) {
      building.reset();
      loadedProjectId = null;
      return;
    }
    suppressSave = true;
    try {
      const data = await api(`/api/projects/${encodeURIComponent(pid)}/architect/building`);
      building.loadSnapshot(data);
      loadedProjectId = pid;
    } catch (err) {
      console.warn("architect load failed", err);
      building.reset();
      loadedProjectId = pid;
    } finally {
      suppressSave = false;
    }
  }

  async function enter() {
    const pid = getProjectId?.() || null;
    const skipReload = active && loadedProjectId === pid;
    active = true;
    bayGrid?.setActive(true);
    bayGrid?.syncFromScene();
    if (!skipReload) {
      clearTimeout(saveTimer);
      await loadFromServer();
    }
    meshLayer.rebuild(building.getBuilding());
    draw.setEnabled(true);
    if (!skipReload) draw.setMode("draw");
    applyArchitectDefaultView(camera, controls, getMmPerModelUnit());
    syncToolbar();
    onStatus?.(
      "ok",
      "Architect — drag walls, Shift+drag rooms, Shift+right-drag erase. Middle pans; Shift+middle orbits & pans up/down.",
    );
  }

  function exit() {
    active = false;
    draw.setEnabled(false);
    draw.dispose();
    bayGrid?.setActive(false);
    meshLayer.clear();
    clearTimeout(saveTimer);
    void persist();
  }

  function isActive() {
    return active;
  }

  function frame() {
    if (!active) return;
    clampArchitectHorizon(camera, controls, getMmPerModelUnit());
  }

  function handlePointerDown(e) {
    if (!active) return false;
    const handled = draw.handlePointerDown(e, meshLayer);
    if (handled) syncAfterDraw();
    return handled;
  }

  function handlePointerMove(e) {
    if (!active) return false;
    const handled = draw.handlePointerMove(e);
    if (handled && draw.isStrokeActive?.()) syncAfterDraw();
    else if (handled) syncToolbar();
    return handled;
  }

  function handlePointerUp(e) {
    if (!active) return false;
    const handled = draw.handlePointerUp(e);
    if (handled) syncAfterDraw();
    return handled;
  }

  function handleClick(e) {
    if (!active) return false;
    return draw.handleClick(e, meshLayer);
  }

  function handleMove(e) {
    if (!active) return false;
    return draw.handleMove(e);
  }

  function handleKey(e) {
    if (!active) return false;
    const handled = draw.handleKey(e);
    if (handled) syncAfterDraw();
    return handled;
  }

  function setStep(step) {
    if (!active) return;
    draw.setMode(step);
    syncToolbar();
  }

  function clearPlan() {
    if (!active) return;
    if (!window.confirm("Clear all wall bays on this level?")) return;
    const snap = building.getSnapshot();
    snap.segments = snap.segments.filter((s) => s.levelId !== snap.activeLevelId);
    building.loadSnapshot(snap);
  }

  return {
    enter,
    exit,
    isActive,
    frame,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleClick,
    handleMove,
    handleKey,
    setStep,
    clearPlan,
    persist,
    syncToolbar,
    building,
  };
}
