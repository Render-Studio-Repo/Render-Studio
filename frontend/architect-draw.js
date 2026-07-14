/**
 * Architect draw tool — cozy builder controls:
 * - LMB drag: paint connected 3 ft wall bays along the lattice
 * - Shift+LMB drag: stamp a closed rectangular room
 * - Right-click: delete a wall bay
 * Door/Window tiles stamp features (or paint with that feature while dragging)
 */

import * as THREE from "three";
import {
  isValidBay,
  modelToNearestBay,
  modelToNearestVertex,
  vertexToModel,
} from "./architect-lattice.js?v=20260714-erase-grid";

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
  let mode = "draw"; // select | draw | window | door
  let selectedId = null;

  /** @type {null | { kind: "paint" | "room", pointerId: number, startVertex: [number, number], lastVertex: [number, number], shift: boolean }} */
  let stroke = null;
  let ghostGroup = null;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hitPoint = new THREE.Vector3();

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

  function sameVertex(a, b) {
    return a && b && a[0] === b[0] && a[1] === b[1];
  }

  function setEnabled(next) {
    enabled = !!next;
    if (!enabled) {
      endStroke();
      clearGhost();
      mode = "draw";
    }
  }

  function isEnabled() {
    return enabled;
  }

  function setMode(next) {
    mode = next === "draw" || next === "window" || next === "door" ? next : "select";
    endStroke();
    clearGhost();
    if (mode === "draw") {
      status("ok", "Wall — drag to paint connected 3×9 ft panels. Shift+drag for a room. Right-click deletes.");
    } else if (mode === "window") {
      status("ok", "Window — drag to paint window tiles, or click a bay to glaze it. Right-click deletes.");
    } else if (mode === "door") {
      status("ok", "Door — drag to paint door tiles, or click a bay to add a door. Right-click deletes.");
    } else {
      status("ok", "Select — click a bay. Right-click or Delete removes it.");
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
    if (!ghostGroup) return;
    scene.remove(ghostGroup);
    ghostGroup.traverse((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
      else child.material?.dispose?.();
    });
    ghostGroup = null;
  }

  function ghostColor() {
    if (mode === "window") return 0x7eb6ff;
    if (mode === "door") return 0xc4a35a;
    return 0x4da3ff;
  }

  function showEraseRect(a, b) {
    clearGhost();
    const i0 = Math.min(a[0], b[0]);
    const i1 = Math.max(a[0], b[0]);
    const j0 = Math.min(a[1], b[1]);
    const j1 = Math.max(a[1], b[1]);
    if (i1 === i0 && j1 === j0) return;
    const mmPer = getMmPerModelUnit();
    const p00 = vertexToModel([i0, j0], mmPer);
    const p11 = vertexToModel([i1, j1], mmPer);
    const w = Math.abs(p11.x - p00.x) || 0.01;
    const h = Math.abs(p11.y - p00.y) || 0.01;
    ghostGroup = new THREE.Group();
    ghostGroup.name = "architect-draw-ghost";
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xf04438,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const planeMesh = new THREE.Mesh(geo, mat);
    planeMesh.position.set((p00.x + p11.x) / 2, (p00.y + p11.y) / 2, 0.03);
    ghostGroup.add(planeMesh);
    // Border lines
    const border = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p00.x, p00.y, 0.04),
      new THREE.Vector3(p11.x, p00.y, 0.04),
      new THREE.Vector3(p11.x, p11.y, 0.04),
      new THREE.Vector3(p00.x, p11.y, 0.04),
      new THREE.Vector3(p00.x, p00.y, 0.04),
    ]);
    ghostGroup.add(
      new THREE.Line(
        border,
        new THREE.LineBasicMaterial({ color: 0xf04438, transparent: true, opacity: 0.9 }),
      ),
    );
    scene.add(ghostGroup);
  }

  function segmentsInLatticeRect(a, b) {
    const i0 = Math.min(a[0], b[0]);
    const i1 = Math.max(a[0], b[0]);
    const j0 = Math.min(a[1], b[1]);
    const j1 = Math.max(a[1], b[1]);
    return building.segmentsOnActiveLevel().filter((seg) => {
      const ai = seg.a[0];
      const aj = seg.a[1];
      const bi = seg.b[0];
      const bj = seg.b[1];
      return (
        ai >= i0 && ai <= i1 && aj >= j0 && aj <= j1
        && bi >= i0 && bi <= i1 && bj >= j0 && bj <= j1
      );
    });
  }

  /** Optional callback so the host can live-highlight pending deletes. */
  let onPendingDeleteChange = null;
  function setOnPendingDeleteChange(fn) {
    onPendingDeleteChange = fn;
  }

  function publishPendingDelete(ids) {
    onPendingDeleteChange?.(ids);
  }

  function addGhostBay(parent, a, b) {
    if (!isValidBay(a, b)) return;
    const mmPer = getMmPerModelUnit();
    const pa = vertexToModel(a, mmPer);
    const pb = vertexToModel(b, mmPer);
    const mid = new THREE.Vector3((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, 0.05);
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const length = Math.hypot(dx, dy);
    const thickness = Math.max(length * 0.14, 0.08);
    const geo = new THREE.BoxGeometry(
      Math.abs(dx) > Math.abs(dy) ? length * 0.92 : thickness,
      Math.abs(dx) > Math.abs(dy) ? thickness : length * 0.92,
      0.07,
    );
    const mat = new THREE.MeshBasicMaterial({
      color: ghostColor(),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    parent.add(mesh);
  }

  function showGhostBays(edges) {
    clearGhost();
    if (!edges?.length) return;
    ghostGroup = new THREE.Group();
    ghostGroup.name = "architect-draw-ghost";
    for (const edge of edges) addGhostBay(ghostGroup, edge.a, edge.b);
    scene.add(ghostGroup);
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

  function eventToNearestVertex(e) {
    const pt = eventToPlanePoint(e);
    if (!pt) return null;
    return modelToNearestVertex(pt, getMmPerModelUnit());
  }

  function eventToNearestBay(e) {
    const pt = eventToPlanePoint(e);
    if (!pt) return null;
    return modelToNearestBay(pt, getMmPerModelUnit(), { maxDistFrac: 0.48 });
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

  /** Axis-aligned Manhattan bay path from → to (horizontal then vertical). */
  function manhattanEdges(from, to) {
    const edges = [];
    let i = Number(from[0]) || 0;
    let j = Number(from[1]) || 0;
    const ti = Number(to[0]) || 0;
    const tj = Number(to[1]) || 0;
    while (i !== ti) {
      const ni = i + Math.sign(ti - i);
      edges.push({ a: [i, j], b: [ni, j] });
      i = ni;
    }
    while (j !== tj) {
      const nj = j + Math.sign(tj - j);
      edges.push({ a: [i, j], b: [i, nj] });
      j = nj;
    }
    return edges;
  }

  /** Closed rectangular room perimeter between two lattice corners. */
  function roomEdges(a, b) {
    const i0 = Math.min(a[0], b[0]);
    const i1 = Math.max(a[0], b[0]);
    const j0 = Math.min(a[1], b[1]);
    const j1 = Math.max(a[1], b[1]);
    if (i1 - i0 < 1 || j1 - j0 < 1) return [];
    const edges = [];
    for (let i = i0; i < i1; i += 1) {
      edges.push({ a: [i, j0], b: [i + 1, j0] });
      edges.push({ a: [i, j1], b: [i + 1, j1] });
    }
    for (let j = j0; j < j1; j += 1) {
      edges.push({ a: [i0, j], b: [i0, j + 1] });
      edges.push({ a: [i1, j], b: [i1, j + 1] });
    }
    return edges;
  }

  function placeEdge(a, b) {
    if (!isValidBay(a, b)) return null;
    const existing = building.findBay?.(a, b);
    const feature = tileFeature();
    if (existing) {
      if (mode === "window" || mode === "door") {
        building.setFeature(existing.id, feature);
        selectedId = existing.id;
        return existing;
      }
      selectedId = existing.id;
      return existing;
    }
    if (mode === "select") return null;
    const placed = building.placeSegment(a, b, { feature });
    if (placed) selectedId = placed.id;
    return placed;
  }

  function placeEdges(edges) {
    let placed = 0;
    for (const edge of edges) {
      const before = building.findBay?.(edge.a, edge.b);
      const result = placeEdge(edge.a, edge.b);
      if (result && !before) placed += 1;
      else if (result && before && (mode === "window" || mode === "door") && before.feature !== tileFeature()) {
        placed += 1;
      }
    }
    return placed;
  }

  function endStroke() {
    stroke = null;
    publishPendingDelete([]);
  }

  /**
   * @returns {boolean} true if architect consumed the event
   */
  function handlePointerDown(e, meshLayer) {
    if (!enabled) return false;

    // Right-click: Shift+drag erase area, or click to delete one wall
    if (e.button === 2) {
      const vertex = eventToNearestVertex(e);
      if (e.shiftKey && vertex) {
        stroke = {
          kind: "erase",
          pointerId: e.pointerId,
          startVertex: vertex,
          lastVertex: vertex,
          shift: true,
          moved: false,
        };
        showEraseRect(vertex, vertex);
        publishPendingDelete([]);
        status("ok", "Erase — drag over walls to highlight, release to delete them.");
        return true;
      }
      const segId = meshLayer?.pickSegmentId?.(eventRaycaster(e));
      if (segId) {
        building.removeSegment(segId);
        if (selectedId === segId) selectedId = null;
        status("ok", "Bay deleted.");
        return true;
      }
      const bay = eventToNearestBay(e);
      if (bay) {
        const existing = building.findBay?.(bay.a, bay.b);
        if (existing) {
          building.removeSegment(existing.id);
          if (selectedId === existing.id) selectedId = null;
          status("ok", "Bay deleted.");
          return true;
        }
      }
      return true; // swallow right-click so the browser menu stays away
    }

    if (e.button !== 0) return false;

    const vertex = eventToNearestVertex(e);
    if (!vertex) return false;

    // Shift+drag → room rectangle
    if (e.shiftKey) {
      stroke = {
        kind: "room",
        pointerId: e.pointerId,
        startVertex: vertex,
        lastVertex: vertex,
        shift: true,
      };
      showGhostBays([]);
      status("ok", "Room — drag to size a closed space, release to build walls.");
      return true;
    }

    // Select mode: click picks a bay
    if (mode === "select") {
      const segId = meshLayer?.pickSegmentId?.(eventRaycaster(e));
      selectedId = segId || null;
      status("ok", selectedId ? "Bay selected — right-click or Delete to remove." : "Nothing selected.");
      return true;
    }

    // Door/Window: click existing bay to stamp without starting a stroke
    if ((mode === "window" || mode === "door") && !e.shiftKey) {
      const segId = meshLayer?.pickSegmentId?.(eventRaycaster(e));
      if (segId) {
        building.setFeature(segId, mode);
        selectedId = segId;
        status("ok", `Set bay to ${mode}.`);
        // Still allow drag paint if they move — only stamp if no drag follows
        stroke = {
          kind: "paint",
          pointerId: e.pointerId,
          startVertex: vertex,
          lastVertex: vertex,
          shift: false,
          stampedClick: true,
          moved: false,
        };
        return true;
      }
    }

    stroke = {
      kind: "paint",
      pointerId: e.pointerId,
      startVertex: vertex,
      lastVertex: vertex,
      shift: false,
      moved: false,
    };
    status("ok", `${tileLabel()} — drag across the lattice to paint connected panels.`);
    return true;
  }

  function handlePointerMove(e) {
    if (!enabled) return false;

    if (stroke && stroke.pointerId === e.pointerId) {
      const vertex = eventToNearestVertex(e);
      if (!vertex) return true;

      if (stroke.kind === "room") {
        stroke.lastVertex = vertex;
        showGhostBays(roomEdges(stroke.startVertex, vertex));
        return true;
      }

      if (stroke.kind === "erase") {
        stroke.moved = !sameVertex(vertex, stroke.startVertex);
        stroke.lastVertex = vertex;
        showEraseRect(stroke.startVertex, vertex);
        const targets = segmentsInLatticeRect(stroke.startVertex, vertex);
        publishPendingDelete(targets.map((s) => s.id));
        status(
          "ok",
          targets.length
            ? `${targets.length} wall${targets.length === 1 ? "" : "s"} highlighted — release to delete.`
            : "Erase — drag over walls to highlight them.",
        );
        return true;
      }

      // paint stroke
      if (!sameVertex(vertex, stroke.lastVertex)) {
        stroke.moved = true;
        const edges = manhattanEdges(stroke.lastVertex, vertex);
        const n = placeEdges(edges);
        stroke.lastVertex = vertex;
        if (n > 0) {
          status("ok", `Painting ${tileLabel().toLowerCase()}s…`);
        }
      }
      // preview next bay toward cursor
      const bay = eventToNearestBay(e);
      if (bay && !building.hasBay(bay.a, bay.b)) showGhostBays([bay]);
      else clearGhost();
      return true;
    }

    // Hover preview when not stroking
    if (mode === "select") {
      clearGhost();
      return false;
    }
    if (e.shiftKey) {
      // wait for drag to start
      clearGhost();
      return false;
    }
    const bay = eventToNearestBay(e);
    if (bay) showGhostBays([bay]);
    else clearGhost();
    return false;
  }

  function handlePointerUp(e) {
    if (!enabled || !stroke || stroke.pointerId !== e.pointerId) return false;

    if (stroke.kind === "room") {
      const edges = roomEdges(stroke.startVertex, stroke.lastVertex);
      const n = placeEdges(edges);
      clearGhost();
      endStroke();
      if (n > 0) status("ok", `Built a room — ${n} new ${tileLabel().toLowerCase()} panels.`);
      else status("ok", "Room needs at least a 1×1 bay footprint. Drag farther.");
      return true;
    }

    if (stroke.kind === "erase") {
      const targets = segmentsInLatticeRect(stroke.startVertex, stroke.lastVertex);
      const ids = targets.map((s) => s.id);
      for (const id of ids) {
        building.removeSegment(id);
        if (selectedId === id) selectedId = null;
      }
      publishPendingDelete([]);
      clearGhost();
      endStroke();
      if (ids.length) status("ok", `Deleted ${ids.length} wall${ids.length === 1 ? "" : "s"}.`);
      else status("ok", "No walls in that area.");
      return true;
    }

    // paint: if never moved, place the single bay under the click
    if (!stroke.moved) {
      const bay = eventToNearestBay(e) || (() => {
        // fallback: bay from start toward a neighbor if click was on a vertex
        return null;
      })();
      if (!stroke.stampedClick && bay) {
        placeEdge(bay.a, bay.b);
        status("ok", `Placed ${tileLabel()} panel.`);
      } else if (!stroke.stampedClick) {
        // Click on vertex with no clear edge — try nearest bay with looser snap
        const pt = eventToPlanePoint(e);
        const loose = pt ? modelToNearestBay(pt, getMmPerModelUnit(), { maxDistFrac: 0.7 }) : null;
        if (loose) {
          placeEdge(loose.a, loose.b);
          status("ok", `Placed ${tileLabel()} panel.`);
        }
      }
    } else {
      status("ok", `${tileLabel()} run finished. Drag again to keep building.`);
    }

    clearGhost();
    endStroke();
    return true;
  }

  /** @deprecated prefer pointer handlers — kept for compatibility */
  function handleClick() {
    return false;
  }

  function handleMove(e) {
    return handlePointerMove(e);
  }

  function handleKey(e) {
    if (!enabled) return false;
    if (e.key === "Escape") {
      endStroke();
      clearGhost();
      selectedId = null;
      status("ok", "Cleared.");
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
    endStroke();
    clearGhost();
    enabled = false;
  }

  function isStrokeActive() {
    return !!stroke;
  }

  return {
    setEnabled,
    isEnabled,
    setMode,
    getMode,
    getSelectedId,
    setSelectedId,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleClick,
    handleMove,
    handleKey,
    isStrokeActive,
    setOnPendingDeleteChange,
    dispose,
  };
}
