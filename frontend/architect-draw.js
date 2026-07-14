/**
 * Architect draw / select interaction for 3 ft bays.
 * Cozy builder: click a lattice edge to place Wall / Door / Window tiles.
 * Only active when enabled; host forwards pointer events.
 */

import * as THREE from "three";
import {
  isValidBay,
  modelToNearestBay,
  modelToNearestVertex,
  neighborVertices,
  vertexToModel,
} from "./architect-lattice.js?v=20260714-cozy-build";

/**
 * @param {{
 *   scene: THREE.Scene,
 *   camera: THREE.Camera,
 *   domElement: HTMLElement,
 *   building: ReturnType<import("./architect-building.js").createArchitectBuilding>,
 *   getMmPerModelUnit: () => number,
 *   onStatus?: (tone: string, msg: string) => void,
 * }} opts
 */
export function createArchitectDrawTool(opts) {
  const { scene, camera, domElement, building, getMmPerModelUnit, onStatus } = opts;

  let enabled = false;
  let mode = "select"; // select | draw | window | door
  let selectedId = null;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hitPoint = new THREE.Vector3();
  let ghost = null;

  function status(tone, msg) {
    onStatus?.(tone, msg);
  }

  function tileFeature() {
    if (mode === "window") return "window";
    if (mode === "door") return "door";
    return "wall";
  }

  function tileLabel() {
    if (mode === "window") return "Window";
    if (mode === "door") return "Door";
    return "Wall";
  }

  function setEnabled(next) {
    enabled = !!next;
    if (!enabled) {
      clearGhost();
      mode = "select";
    }
  }

  function isEnabled() {
    return enabled;
  }

  function setMode(next) {
    mode = next === "draw" || next === "window" || next === "door" ? next : "select";
    clearGhost();
    if (mode === "draw") {
      status("ok", "Wall — click a blue lattice edge to place a 3 ft bay. Keep clicking to grow the plan.");
    } else if (mode === "window") {
      status("ok", "Window — click a lattice edge (or existing bay) to place a window tile.");
    } else if (mode === "door") {
      status("ok", "Door — click a lattice edge (or existing bay) to place a door tile.");
    } else {
      status("ok", "Select — click a bay. Delete removes it.");
    }
  }

  function getMode() {
    return mode;
  }

  function getSelectedId() {
    return selectedId;
  }

  function setSelectedId(id) {
    selectedId = id || null;
  }

  function clearGhost() {
    if (!ghost) return;
    scene.remove(ghost);
    ghost.geometry?.dispose?.();
    if (Array.isArray(ghost.material)) ghost.material.forEach((m) => m.dispose?.());
    else ghost.material?.dispose?.();
    ghost = null;
  }

  function ghostColor() {
    if (mode === "window") return 0x7eb6ff;
    if (mode === "door") return 0xc4a35a;
    return 0x4da3ff;
  }

  function showGhost(a, b) {
    clearGhost();
    if (!isValidBay(a, b)) return;
    const mmPer = getMmPerModelUnit();
    const pa = vertexToModel(a, mmPer);
    const pb = vertexToModel(b, mmPer);
    const mid = new THREE.Vector3((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, 0.04);
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const length = Math.hypot(dx, dy);
    const thickness = Math.max(length * 0.12, 0.08);
    const geo = new THREE.BoxGeometry(
      Math.abs(dx) > Math.abs(dy) ? length * 0.92 : thickness,
      Math.abs(dx) > Math.abs(dy) ? thickness : length * 0.92,
      0.06,
    );
    const mat = new THREE.MeshBasicMaterial({
      color: ghostColor(),
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    ghost = new THREE.Mesh(geo, mat);
    ghost.position.copy(mid);
    ghost.name = "architect-draw-ghost";
    scene.add(ghost);
  }

  function eventToPlanePoint(e) {
    const rect = domElement.getBoundingClientRect();
    ndc.set(
      ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(plane, hitPoint)) return null;
    return { x: hitPoint.x, y: hitPoint.y };
  }

  function eventToNearestBay(e) {
    const pt = eventToPlanePoint(e);
    if (!pt) return null;
    return modelToNearestBay(pt, getMmPerModelUnit());
  }

  function eventRaycaster(e) {
    const rect = domElement.getBoundingClientRect();
    ndc.set(
      ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  }

  function placeOrStampBay(a, b) {
    const existing = building.findBay?.(a, b) || null;
    const feature = tileFeature();
    if (existing) {
      if (mode === "select") {
        selectedId = existing.id;
        status("ok", "Bay selected — Delete to remove, or pick Door/Window to change it.");
        return existing;
      }
      building.setFeature(existing.id, feature);
      selectedId = existing.id;
      status("ok", `Updated bay → ${tileLabel()}.`);
      return existing;
    }
    if (mode === "select") {
      status("error", "Click an existing wall bay to select it.");
      return null;
    }
    const placed = building.placeSegment(a, b, { feature });
    if (placed) {
      selectedId = placed.id;
      status("ok", `Placed ${tileLabel()} bay. Keep clicking edges to grow the plan.`);
    }
    return placed;
  }

  /**
   * @param {PointerEvent|MouseEvent} e
   * @param {{ pickSegmentId: (rc: THREE.Raycaster) => string|null }} meshLayer
   * @returns {boolean} true if event was handled (caller should preventDefault)
   */
  function handleClick(e, meshLayer) {
    if (!enabled) return false;

    const segId = meshLayer?.pickSegmentId?.(eventRaycaster(e));

    // Prefer mesh hit when selecting or stamping an existing bay
    if (segId && (mode === "select" || mode === "window" || mode === "door" || mode === "draw")) {
      if (mode === "select") {
        selectedId = segId;
        status("ok", "Bay selected — press Delete to remove.");
        return true;
      }
      if (mode === "window" || mode === "door") {
        building.setFeature(segId, mode);
        selectedId = segId;
        status("ok", `Set bay to ${mode}.`);
        return true;
      }
      // draw mode on existing bay → select it (don't block empty-edge placement below unless close)
      const bay = eventToNearestBay(e);
      if (!bay || building.hasBay(bay.a, bay.b)) {
        selectedId = segId;
        status("ok", "Bay selected. Click an empty lattice edge to add another wall.");
        return true;
      }
    }

    const bay = eventToNearestBay(e);
    if (!bay) {
      if (mode === "select") {
        selectedId = null;
        status("ok", "Nothing selected.");
        return true;
      }
      status("error", "Click closer to a blue lattice edge.");
      return true;
    }

    placeOrStampBay(bay.a, bay.b);
    clearGhost();
    return true;
  }

  function handleMove(e) {
    if (!enabled || mode === "select") {
      clearGhost();
      return false;
    }
    const bay = eventToNearestBay(e);
    if (!bay) {
      clearGhost();
      return false;
    }
    // Always preview the tile under the cursor — even if occupied (shows stamp target)
    showGhost(bay.a, bay.b);
    return false;
  }

  function handleKey(e) {
    if (!enabled) return false;
    if (e.key === "Escape") {
      clearGhost();
      selectedId = null;
      status("ok", "Cleared selection.");
      return true;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedId) {
        building.removeSegment(selectedId);
        selectedId = null;
        status("ok", "Bay removed.");
        return true;
      }
    }
    return false;
  }

  function dispose() {
    clearGhost();
    enabled = false;
  }

  return {
    setEnabled,
    isEnabled,
    setMode,
    getMode,
    getSelectedId,
    setSelectedId,
    handleClick,
    handleMove,
    handleKey,
    dispose,
  };
}
