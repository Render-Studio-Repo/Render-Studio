/**
 * Architect draw / select interaction for 3 ft bays.
 * Only active when enabled; does not register global listeners itself —
 * host forwards pointer events.
 */

import * as THREE from "three";
import {
  isValidBay,
  modelToNearestVertex,
  neighborVertices,
  vertexToModel,
} from "./architect-lattice.js?v=20260710-bay-lattice";

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
  let anchor = null; // lattice vertex [i,j]
  let ghost = null;
  let selectedId = null;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hitPoint = new THREE.Vector3();

  function status(tone, msg) {
    onStatus?.(tone, msg);
  }

  function setEnabled(next) {
    enabled = !!next;
    if (!enabled) {
      anchor = null;
      clearGhost();
      mode = "select";
    }
  }

  function isEnabled() {
    return enabled;
  }

  function setMode(next) {
    mode = next === "draw" || next === "window" || next === "door" ? next : "select";
    anchor = null;
    clearGhost();
    if (mode === "draw") status("ok", "Draw walls — click lattice points to chain 3 ft bays. Click a segment to select.");
    else if (mode === "window") status("ok", "Window — click a wall bay to glaze it.");
    else if (mode === "door") status("ok", "Door — click a wall bay to add a door.");
    else status("ok", "Select — click a bay. Delete removes it.");
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
    ghost.material?.dispose?.();
    ghost = null;
  }

  function showGhost(a, b) {
    clearGhost();
    if (!isValidBay(a, b)) return;
    const mmPer = getMmPerModelUnit();
    const pa = vertexToModel(a, mmPer);
    const pb = vertexToModel(b, mmPer);
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(pa.x, pa.y, 0.05),
      new THREE.Vector3(pb.x, pb.y, 0.05),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0x4da3ff, linewidth: 2, transparent: true, opacity: 0.9 });
    ghost = new THREE.Line(geo, mat);
    ghost.name = "architect-draw-ghost";
    scene.add(ghost);
  }

  function eventToLattice(e) {
    const rect = domElement.getBoundingClientRect();
    ndc.set(
      ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(plane, hitPoint)) return null;
    return modelToNearestVertex({ x: hitPoint.x, y: hitPoint.y }, getMmPerModelUnit());
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

  /**
   * @param {PointerEvent|MouseEvent} e
   * @param {{ pickSegmentId: (rc: THREE.Raycaster) => string|null }} meshLayer
   * @returns {boolean} true if event was handled (caller should preventDefault)
   */
  function handleClick(e, meshLayer) {
    if (!enabled) return false;

    const segId = meshLayer?.pickSegmentId?.(eventRaycaster(e));

    if (mode === "window" || mode === "door") {
      if (!segId) {
        status("error", "Click an existing wall bay.");
        return true;
      }
      building.setFeature(segId, mode);
      selectedId = segId;
      status("ok", `Set bay to ${mode}.`);
      return true;
    }

    if (mode === "select") {
      selectedId = segId || null;
      if (selectedId) status("ok", "Bay selected — press Delete to remove, or switch to Window/Door.");
      return !!segId;
    }

    // draw mode
    if (segId && !anchor) {
      selectedId = segId;
      status("ok", "Bay selected. Click empty lattice to start drawing, or Delete to remove.");
      return true;
    }

    const vertex = eventToLattice(e);
    if (!vertex) return true;

    if (!anchor) {
      anchor = vertex;
      selectedId = null;
      status("ok", `Anchor (${vertex[0]}, ${vertex[1]}) — click an adjacent 3 ft bay.`);
      return true;
    }

    if (anchor[0] === vertex[0] && anchor[1] === vertex[1]) {
      anchor = null;
      clearGhost();
      status("ok", "Anchor cleared.");
      return true;
    }

    if (!isValidBay(anchor, vertex)) {
      // snap to nearest valid neighbor toward click
      const neighbors = neighborVertices(anchor);
      let best = null;
      let bestDist = Infinity;
      const mmPer = getMmPerModelUnit();
      const clickModel = vertexToModel(vertex, mmPer);
      for (const n of neighbors) {
        if (building.hasBay(anchor, n)) continue;
        const nm = vertexToModel(n, mmPer);
        const d = (nm.x - clickModel.x) ** 2 + (nm.y - clickModel.y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = n;
        }
      }
      if (!best) {
        status("error", "No free 3 ft bay from this anchor.");
        return true;
      }
      const placed = building.placeSegment(anchor, best);
      if (placed) {
        anchor = best;
        selectedId = placed.id;
        clearGhost();
        status("ok", `Placed wall bay → (${best[0]}, ${best[1]}). Keep clicking to chain.`);
      }
      return true;
    }

    if (building.hasBay(anchor, vertex)) {
      status("error", "Bay already exists.");
      anchor = vertex;
      return true;
    }

    const placed = building.placeSegment(anchor, vertex);
    if (placed) {
      anchor = vertex;
      selectedId = placed.id;
      clearGhost();
      status("ok", `Placed wall bay. Chain continues from (${vertex[0]}, ${vertex[1]}).`);
    }
    return true;
  }

  function handleMove(e) {
    if (!enabled || mode !== "draw" || !anchor) {
      clearGhost();
      return false;
    }
    const vertex = eventToLattice(e);
    if (!vertex) return false;
    if (isValidBay(anchor, vertex) && !building.hasBay(anchor, vertex)) {
      showGhost(anchor, vertex);
    } else {
      // ghost toward nearest free neighbor
      const neighbors = neighborVertices(anchor);
      const mmPer = getMmPerModelUnit();
      const clickModel = vertexToModel(vertex, mmPer);
      let best = null;
      let bestDist = Infinity;
      for (const n of neighbors) {
        if (building.hasBay(anchor, n)) continue;
        const nm = vertexToModel(n, mmPer);
        const d = (nm.x - clickModel.x) ** 2 + (nm.y - clickModel.y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = n;
        }
      }
      if (best) showGhost(anchor, best);
      else clearGhost();
    }
    return false;
  }

  function handleKey(e) {
    if (!enabled) return false;
    if (e.key === "Escape") {
      if (anchor) {
        anchor = null;
        clearGhost();
        status("ok", "Anchor cleared.");
        return true;
      }
      setMode("select");
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
