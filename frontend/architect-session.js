/**
 * Architect session — ties building, mesh, draw, bay grid, camera, and API.
 * Host calls enter/exit/frame; Design mode never constructs this until Architect opens.
 */

import { createArchitectBuilding } from "./architect-building.js?v=20260710-usable";
import { createArchitectMeshLayer } from "./architect-mesh.js?v=20260710-usable";
import { createArchitectDrawTool } from "./architect-draw.js?v=20260710-usable";
import {
  applyArchitectDefaultView,
  clampArchitectHorizon,
} from "./architect-camera.js?v=20260710-usable";

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
  let saveTimer = null;
  let suppressSave = false;

  building.onChange((b) => {
    meshLayer.setSelected(draw.getSelectedId());
    meshLayer.rebuild(b);
    syncToolbar();
    if (!suppressSave) scheduleSave();
  });

  function syncToolbar() {
    const mode = draw.getMode();
    document.querySelectorAll("[data-architect-step]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-architect-step") === mode);
    });
    const hintEl = document.getElementById("architect-domino-hint");
    if (hintEl) {
      if (mode === "draw") {
        hintEl.textContent = "Wall — click lattice points to chain blank 3 ft bays. Esc clears anchor. Delete removes a selected bay.";
      } else if (mode === "window") {
        hintEl.textContent = "Window — click an existing wall bay to stamp a window into that same-size tile.";
      } else if (mode === "door") {
        hintEl.textContent = "Door — click an existing wall bay to stamp a door into that same-size tile.";
      } else {
        hintEl.textContent = "Select — click a bay to select it. Delete removes it. Switch tiles above to draw or stamp openings.";
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
      return;
    }
    suppressSave = true;
    try {
      const data = await api(`/api/projects/${encodeURIComponent(pid)}/architect/building`);
      building.loadSnapshot(data);
    } catch (err) {
      console.warn("architect load failed", err);
      building.reset();
    } finally {
      suppressSave = false;
    }
  }

  async function enter() {
    active = true;
    bayGrid?.setActive(true);
    bayGrid?.syncFromScene();
    await loadFromServer();
    meshLayer.rebuild(building.getBuilding());
    draw.setEnabled(true);
    draw.setMode("draw");
    applyArchitectDefaultView(camera, controls, getMmPerModelUnit());
    syncToolbar();
    onStatus?.(
      "ok",
      "Architect Build — wireframe with Wall, Door, or Window tiles (same 3 ft size). Style kits open in later phases.",
    );
  }

  function exit() {
    active = false;
    draw.setEnabled(false);
    draw.dispose();
    bayGrid?.setActive(false);
    // Keep meshes visible if user peeks back? Clear to avoid polluting Design view.
    meshLayer.clear();
    clearTimeout(saveTimer);
  }

  function isActive() {
    return active;
  }

  function frame() {
    if (!active) return;
    clampArchitectHorizon(camera, controls, getMmPerModelUnit());
  }

  function handleClick(e) {
    if (!active) return false;
    const handled = draw.handleClick(e, meshLayer);
    meshLayer.setSelected(draw.getSelectedId());
    meshLayer.rebuild(building.getBuilding());
    syncToolbar();
    return handled;
  }

  function handleMove(e) {
    if (!active) return false;
    return draw.handleMove(e);
  }

  function handleKey(e) {
    if (!active) return false;
    const handled = draw.handleKey(e);
    if (handled) {
      meshLayer.setSelected(draw.getSelectedId());
      meshLayer.rebuild(building.getBuilding());
      syncToolbar();
    }
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
