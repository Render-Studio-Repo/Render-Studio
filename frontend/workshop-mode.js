import * as THREE from "three";
import {
  WORKSHOP_AGENT_SEATS,
  WORKSHOP_ANGLE_UNIT,
  WORKSHOP_DIMENSIONS_M,
  WORKSHOP_LAYOUT_VERSION,
  WORKSHOP_LINEAR_UNIT,
  WORKSHOP_PARTNER_OPTIONS,
  WORKSHOP_PLACE_PRESETS,
  buildDefaultWorkshopIde,
  buildDefaultWorkshopLayout,
  createWorkshopObject,
  exportWorkshopLayout,
  nextWorkshopObjectId,
  normalizeWorkshopIde,
  normalizeWorkshopLayout,
  presetById,
} from "./workshop-scale.js?v=20260918-workshop-v2";

const WORKSHOP_HASH = "#workshop";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function seededWorkshopState(projectName = "Project") {
  return {
    project_label: projectName,
    agents_source: "mock",
    partner_options: WORKSHOP_PARTNER_OPTIONS,
    selected_partner: { id: "", label: "", kind: "", summary: "" },
    bridge: {
      live_configured: false,
      status: "not_connected",
      label: "Not connected",
      detail: "Choose a workshop partner to start the room session.",
    },
    agent_seats: WORKSHOP_AGENT_SEATS,
    agents: [],
    projects: { create: [], train: [] },
    approvals: [],
    queue: [],
    debug: { hook_available: false, last_result: null },
    layout: buildDefaultWorkshopLayout(),
    ide: buildDefaultWorkshopIde(),
  };
}

function normalizeWorkshopState(input, projectName = "Project") {
  const seed = seededWorkshopState(projectName);
  const value = input && typeof input === "object" ? input : {};
  return {
    ...seed,
    ...value,
    project_label: String(value.project_label || projectName || "Project"),
    partner_options: Array.isArray(value.partner_options) && value.partner_options.length ? value.partner_options : seed.partner_options,
    selected_partner: value.selected_partner && typeof value.selected_partner === "object" ? value.selected_partner : seed.selected_partner,
    bridge: value.bridge && typeof value.bridge === "object" ? { ...seed.bridge, ...value.bridge } : seed.bridge,
    agent_seats: Array.isArray(value.agent_seats) && value.agent_seats.length ? value.agent_seats : seed.agent_seats,
    agents: Array.isArray(value.agents) ? value.agents : seed.agents,
    projects: value.projects && typeof value.projects === "object" ? value.projects : seed.projects,
    approvals: Array.isArray(value.approvals) ? value.approvals : seed.approvals,
    queue: Array.isArray(value.queue) ? value.queue : seed.queue,
    debug: value.debug && typeof value.debug === "object" ? { ...seed.debug, ...value.debug } : seed.debug,
    layout: normalizeWorkshopLayout(value.layout),
    ide: normalizeWorkshopIde(value.ide),
  };
}

function makeTextMaterial(text, { width = 512, height = 192, bg = "rgba(8,17,29,0.76)", fg = "#f8fafc", accent = "#60a5fa", font = "700 44px Inter, sans-serif" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = bg;
  ctx.strokeStyle = "rgba(148,163,184,0.55)";
  ctx.lineWidth = 6;
  const radius = 22;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(width - radius, 0);
  ctx.quadraticCurveTo(width, 0, width, radius);
  ctx.lineTo(width, height - radius);
  ctx.quadraticCurveTo(width, height, width - radius, height);
  ctx.lineTo(radius, height);
  ctx.quadraticCurveTo(0, height, 0, height - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.font = "700 22px Inter, sans-serif";
  ctx.fillText("Workshop", 28, 38);
  ctx.fillStyle = fg;
  ctx.font = font;
  const lines = String(text || "").split("\n").slice(0, 3);
  lines.forEach((line, index) => {
    ctx.fillText(line, 28, 92 + (index * 46));
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
}

function createLabelPlane(text, { w = 1.3, h = 0.42 } = {}) {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), makeTextMaterial(text));
  plane.rotation.x = Math.PI / 2;
  plane.renderOrder = 4;
  plane.userData.isWorkshopLabel = true;
  return plane;
}

function createRingMarker(width, depth, color) {
  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
  );
  marker.position.z = 0.011;
  marker.receiveShadow = true;
  return marker;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export function createWorkshopMode(options = {}) {
  const {
    viewportEl,
    renderer,
    scene,
    camera,
    controls,
    transformControls,
    getMeshRoot,
    getProjectId,
    getProjectName,
    api,
    setStatus,
    toggleDictation,
    setStudioPromptText,
    clearStudioSelection,
    showWiringWorkspace,
    hideWiringWorkspace,
    syncWorkspaceMode,
  } = options;

  if (!viewportEl || !renderer || !scene || !camera || !controls || !transformControls) {
    throw new Error("Workshop mode requires viewport, renderer, scene, camera, controls, and transform controls.");
  }

  const roomGroup = new THREE.Group();
  roomGroup.name = "workshop-room";
  roomGroup.visible = false;
  scene.add(roomGroup);

  const placedGroup = new THREE.Group();
  placedGroup.name = "workshop-placed";
  roomGroup.add(placedGroup);

  const warehouse = WORKSHOP_DIMENSIONS_M.warehouse;
  const warehouseBounds = {
    minX: -(warehouse.width / 2) + 0.45,
    maxX: warehouse.width / 2 - 0.45,
    minY: -(warehouse.depth / 2) + 0.45,
    maxY: warehouse.depth / 2 - 0.45,
  };

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(warehouse.width, warehouse.depth),
    new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.96, metalness: 0.02 }),
  );
  floor.name = "workshop-floor";
  floor.receiveShadow = true;
  floor.userData.workshopSurface = "floor";
  roomGroup.add(floor);

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(warehouse.width + 6, warehouse.depth + 6),
    new THREE.MeshStandardMaterial({ color: 0x060b12, roughness: 1, metalness: 0 }),
  );
  apron.position.z = -0.01;
  roomGroup.add(apron);

  const grid = new THREE.GridHelper(warehouse.width, warehouse.width, 0x60a5fa, 0x1e293b);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = 0.02;
  roomGroup.add(grid);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9, metalness: 0.02, transparent: true, opacity: 0.88 });
  const northWall = new THREE.Mesh(new THREE.BoxGeometry(warehouse.width, warehouse.wallThickness, warehouse.height), wallMat);
  northWall.position.set(0, warehouse.depth / 2, warehouse.height / 2);
  roomGroup.add(northWall);
  const southWall = northWall.clone();
  southWall.position.set(0, -warehouse.depth / 2, warehouse.height / 2);
  roomGroup.add(southWall);
  const eastWall = new THREE.Mesh(new THREE.BoxGeometry(warehouse.wallThickness, warehouse.depth, warehouse.height), wallMat);
  eastWall.position.set(warehouse.width / 2, 0, warehouse.height / 2);
  roomGroup.add(eastWall);
  const westWall = eastWall.clone();
  westWall.position.set(-warehouse.width / 2, 0, warehouse.height / 2);
  roomGroup.add(westWall);

  const columnPositions = [
    [-warehouse.width / 2, -warehouse.depth / 2],
    [0, -warehouse.depth / 2],
    [warehouse.width / 2, -warehouse.depth / 2],
    [-warehouse.width / 2, 0],
    [warehouse.width / 2, 0],
    [-warehouse.width / 2, warehouse.depth / 2],
    [0, warehouse.depth / 2],
    [warehouse.width / 2, warehouse.depth / 2],
  ];
  columnPositions.forEach(([x, y]) => {
    const column = new THREE.Mesh(
      new THREE.BoxGeometry(warehouse.columnSize, warehouse.columnSize, warehouse.height),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.72, metalness: 0.12 }),
    );
    column.position.set(x, y, warehouse.height / 2);
    roomGroup.add(column);
  });

  const previewMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 0.2),
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.32,
      emissive: 0x0f766e,
      roughness: 0.42,
    }),
  );
  previewMesh.visible = false;
  roomGroup.add(previewMesh);

  const previewGlow = new THREE.Mesh(
    new THREE.RingGeometry(0.25, 0.42, 32),
    new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
  );
  previewGlow.visible = false;
  roomGroup.add(previewGlow);

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "workshop-enter-affordance";
  launcher.innerHTML = `
    <span class="workshop-enter-affordance-icon">WS</span>
    <span class="workshop-enter-affordance-copy">
      <strong>Workshop</strong>
      <small>God view + editor</small>
    </span>
  `;
  viewportEl.appendChild(launcher);

  const root = document.createElement("section");
  root.className = "workshop-shell hidden";
  root.hidden = true;
  viewportEl.appendChild(root);

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2(0, 0);
  const visibleState = new Map();
  const tvScreenById = new Map();
  const placedMeshById = new Map();
  const savedCamera = {
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
  };

  let active = false;
  let activeProjectId = "";
  let loadToken = 0;
  let selectedPlacePreset = WORKSHOP_PLACE_PRESETS[0].id;
  let selectedItemId = "";
  let activeSurface = "god";
  let transformMode = "translate";
  let previewPoint = null;
  let lastPointerEvent = null;
  let workshopError = "";
  let workshopState = seededWorkshopState("Project");
  let layoutState = buildDefaultWorkshopLayout();
  let ideState = buildDefaultWorkshopIde();
  let partnerModalOpen = false;
  let voiceDraft = "";
  let persistLayoutTimer = 0;
  let persistIdeTimer = 0;
  let lastTelemetryPaintAt = 0;
  let lastDebugResult = null;
  let priorSceneBackground = null;

  function currentProjectName() {
    return String(getProjectName?.() || activeProjectId || "Project").trim() || "Project";
  }

  function activePartner() {
    return workshopState.selected_partner || { id: "", label: "", kind: "", summary: "" };
  }

  function currentBridge() {
    return workshopState.bridge || { status: "not_connected", label: "Not connected", detail: "" };
  }

  function updateRoute(on) {
    const url = new URL(window.location.href);
    const next = on ? `${url.pathname}${url.search}${WORKSHOP_HASH}` : `${url.pathname}${url.search}`;
    if (on && url.hash === WORKSHOP_HASH) return;
    if (!on && !url.hash) return;
    window.history[on ? "pushState" : "replaceState"]({}, "", next || "/");
  }

  function setSceneVisibility(node, visible) {
    if (!node) return;
    visibleState.set(node.uuid, node.visible);
    node.visible = visible;
  }

  function showWorkshopScene() {
    roomGroup.visible = activeSurface !== "wiring";
    const modelRoot = getMeshRoot?.();
    if (modelRoot) setSceneVisibility(modelRoot, false);
    scene.traverse((node) => {
      if (!node || node === roomGroup || roomGroup.children.includes(node)) return;
      if (node === transformControls.getHelper()) return;
      if (node.userData?.isFloor || node.userData?.isShadowFloor || node.userData?.isArchitectBay || node.userData?.isArchitectGrid) {
        setSceneVisibility(node, false);
      }
      if (node.isGridHelper || node.type === "GridHelper" || node.name === "large-grid-axes" || node.name === "grid-dots") {
        setSceneVisibility(node, false);
      }
    });
    priorSceneBackground = scene.background?.clone?.() || null;
    scene.background = new THREE.Color(0x07101a);
  }

  function hideWorkshopScene() {
    roomGroup.visible = false;
    previewMesh.visible = false;
    previewGlow.visible = false;
    for (const [uuid, visible] of visibleState.entries()) {
      const node = scene.getObjectByProperty("uuid", uuid);
      if (node) node.visible = visible;
    }
    visibleState.clear();
    scene.background = priorSceneBackground;
  }

  function applyCameraPose(surface = activeSurface) {
    camera.up.set(0, 0, 1);
    if (surface === "god") {
      camera.position.set(0, -0.05, 16.2);
      controls.target.set(0, 0, 0.4);
    } else {
      camera.position.set(10.5, -10.8, 7.2);
      controls.target.set(0, 0.8, 1.0);
    }
    camera.lookAt(controls.target);
    controls.update();
  }

  function rememberCameraPose() {
    savedCamera.position.copy(camera.position);
    savedCamera.target.copy(controls.target);
  }

  function restoreCameraPose() {
    camera.position.copy(savedCamera.position);
    controls.target.copy(savedCamera.target);
    camera.up.set(0, 0, 1);
    camera.lookAt(savedCamera.target);
    controls.update();
  }

  function activeFile() {
    return ideState.files.find((file) => file.id === ideState.activeFileId) || ideState.files[0] || null;
  }

  function updateActiveFileContent(content = "") {
    const next = ideState.files.map((file) => (
      file.id === ideState.activeFileId ? { ...file, content } : file
    ));
    ideState = { ...ideState, files: next };
    scheduleIdeSave();
  }

  async function saveWorkshopPatch({ savePartner = false, saveLayout = false, saveIde = false, quiet = false } = {}) {
    const projectId = String(getProjectId?.() || "").trim();
    if (!projectId) return null;
    const payload = {};
    if (savePartner) payload.selected_partner_id = activePartner().id || "";
    if (saveLayout) payload.layout = layoutState;
    if (saveIde) payload.ide = ideState;
    if (!Object.keys(payload).length) return null;
    try {
      const next = await api(`/api/projects/${projectId}/workshop`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      workshopState = normalizeWorkshopState(next, currentProjectName());
      if (next?.layout) layoutState = normalizeWorkshopLayout(next.layout);
      if (next?.ide) ideState = normalizeWorkshopIde(next.ide);
      if (!quiet) render();
      return next;
    } catch (err) {
      if (!quiet) setStatus?.("error", err?.message || "Could not save Workshop changes.");
      return null;
    }
  }

  function scheduleLayoutSave() {
    window.clearTimeout(persistLayoutTimer);
    persistLayoutTimer = window.setTimeout(() => {
      persistLayoutTimer = 0;
      void saveWorkshopPatch({ saveLayout: true, quiet: true });
    }, 450);
  }

  function scheduleIdeSave() {
    window.clearTimeout(persistIdeTimer);
    persistIdeTimer = window.setTimeout(() => {
      persistIdeTimer = 0;
      void saveWorkshopPatch({ saveIde: true, quiet: true });
    }, 350);
  }

  function objectForSelection() {
    return layoutState.objects.find((item) => item.id === selectedItemId) || null;
  }

  function disposeObject3d(object) {
    object?.traverse?.((child) => {
      if (child.geometry) child.geometry.dispose?.();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((entry) => entry?.dispose?.());
      else material?.dispose?.();
    });
  }

  function registerTvScreen(item, plane) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 576;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    plane.rotation.x = Math.PI / 2;
    plane.material = new THREE.MeshBasicMaterial({ map: texture });
    plane.material.toneMapped = false;
    tvScreenById.set(item.id, { canvas, ctx, texture, slot: item.streamSlot || "", label: item.label || "TV" });
  }

  function buildItemMesh(item) {
    const dims = item.dimensions || {};
    const rootMesh = new THREE.Group();
    rootMesh.name = `workshop-item-${item.id}`;
    rootMesh.userData.workshopItemId = item.id;
    rootMesh.userData.workshopItemType = item.type;

    if (item.type === "desk") {
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(dims.width || 1.6, dims.depth || 0.8, WORKSHOP_DIMENSIONS_M.desk.topThickness),
        new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.78, metalness: 0.04 }),
      );
      top.position.z = (dims.height || 0.74) - (WORKSHOP_DIMENSIONS_M.desk.topThickness / 2);
      rootMesh.add(top);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const leg = new THREE.Mesh(
            new THREE.BoxGeometry(WORKSHOP_DIMENSIONS_M.desk.legSize, WORKSHOP_DIMENSIONS_M.desk.legSize, (dims.height || 0.74) - WORKSHOP_DIMENSIONS_M.desk.topThickness),
            new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.68, metalness: 0.16 }),
          );
          leg.position.set(
            sx * ((dims.width || 1.6) / 2 - 0.12),
            sy * ((dims.depth || 0.8) / 2 - 0.12),
            ((dims.height || 0.74) - WORKSHOP_DIMENSIONS_M.desk.topThickness) / 2,
          );
          rootMesh.add(leg);
        }
      }
      const seatLabel = item.metadata?.seatLabel || item.label;
      const label = createLabelPlane(seatLabel, { w: 1.4, h: 0.34 });
      label.position.set(0, 0, (dims.height || 0.74) + 0.48);
      rootMesh.add(label);
    } else if (item.type === "tv") {
      const stand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.06, item.pose?.z || WORKSHOP_DIMENSIONS_M.tv.standHeight, 18),
        new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.6, metalness: 0.2 }),
      );
      stand.position.z = (item.pose?.z || WORKSHOP_DIMENSIONS_M.tv.standHeight) / 2;
      rootMesh.add(stand);
      const bezel = new THREE.Mesh(
        new THREE.BoxGeometry((dims.width || 1.4) + 0.08, dims.depth || 0.12, (dims.height || 0.86) + 0.08),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.32, metalness: 0.18 }),
      );
      bezel.position.z = item.pose?.z || WORKSHOP_DIMENSIONS_M.tv.standHeight;
      rootMesh.add(bezel);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(dims.width || 1.4, dims.height || 0.86),
        new THREE.MeshBasicMaterial({ color: 0x0f172a }),
      );
      screen.position.set(0, -((dims.depth || 0.12) / 2 + 0.005), item.pose?.z || WORKSHOP_DIMENSIONS_M.tv.standHeight);
      rootMesh.add(screen);
      registerTvScreen(item, screen);
      const label = createLabelPlane(item.label || "TV", { w: 1.3, h: 0.34 });
      label.position.set(0, 0.16, (item.pose?.z || WORKSHOP_DIMENSIONS_M.tv.standHeight) + (dims.height || 0.86) / 2 + 0.34);
      rootMesh.add(label);
    } else if (item.type === "robot-bay") {
      const marker = createRingMarker(dims.width || 4.2, dims.depth || 3.0, 0x3b82f6);
      rootMesh.add(marker);
      const border = new THREE.Mesh(
        new THREE.RingGeometry(1.05, 1.24, 32),
        new THREE.MeshBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
      );
      border.position.z = 0.018;
      rootMesh.add(border);
      const label = createLabelPlane("Robotics sim bay\nOpenArm · MuJoCo · Isaac", { w: 1.8, h: 0.54 });
      label.position.set(0, 0, 0.9);
      rootMesh.add(label);
    } else if (item.type === "wiring-bay") {
      const marker = createRingMarker(dims.width || 2.6, dims.depth || 1.6, 0xf59e0b);
      rootMesh.add(marker);
      const label = createLabelPlane("Wiring bay", { w: 1.2, h: 0.34 });
      label.position.set(0, 0, 0.72);
      rootMesh.add(label);
    } else if (item.type === "dj-zone") {
      const marker = new THREE.Mesh(
        new THREE.CircleGeometry(Math.max(dims.width || 2.2, dims.depth || 1.8) / 2, 40),
        new THREE.MeshStandardMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
      );
      rootMesh.add(marker);
      const label = createLabelPlane('DJ handoff zone\nSay "Hey DJ"', { w: 1.55, h: 0.48 });
      label.position.set(0, 0, 0.72);
      rootMesh.add(label);
    }

    rootMesh.position.set(Number(item.pose?.x) || 0, Number(item.pose?.y) || 0, Number(item.pose?.z) || 0);
    rootMesh.rotation.z = Number(item.pose?.yaw) || 0;
    rootMesh.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.workshopItemId = item.id;
    });
    return rootMesh;
  }

  function clearPlacedScene() {
    tvScreenById.forEach((entry) => entry.texture?.dispose?.());
    tvScreenById.clear();
    for (const child of [...placedGroup.children]) {
      placedGroup.remove(child);
      disposeObject3d(child);
    }
    placedMeshById.clear();
  }

  function rebuildPlacedScene() {
    clearPlacedScene();
    layoutState.objects.forEach((item) => {
      const mesh = buildItemMesh(item);
      placedMeshById.set(item.id, mesh);
      placedGroup.add(mesh);
    });
    syncSelectedPlacedItem();
  }

  function syncSelectedPlacedItem() {
    if (!selectedItemId) {
      if (transformControls.object?.userData?.workshopItemId) transformControls.detach();
      return;
    }
    const mesh = placedMeshById.get(selectedItemId);
    if (!mesh) {
      selectedItemId = "";
      transformControls.detach();
      return;
    }
    transformControls.attach(mesh);
    transformControls.setMode(transformMode);
  }

  function updatePreviewMesh() {
    if (!active || activeSurface !== "editor") {
      previewMesh.visible = false;
      previewGlow.visible = false;
      previewPoint = null;
      return;
    }
    const preset = presetById(selectedPlacePreset);
    if (!preset) return;
    const dims = preset.dimensions || {};
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects([floor], false)[0];
    if (!hit?.point) {
      previewMesh.visible = false;
      previewGlow.visible = false;
      previewPoint = null;
      return;
    }
    const x = clamp(hit.point.x, warehouseBounds.minX, warehouseBounds.maxX);
    const y = clamp(hit.point.y, warehouseBounds.minY, warehouseBounds.maxY);
    const z = (dims.height || dims.markerHeight || 0.1) / 2;
    previewPoint = new THREE.Vector3(x, y, 0);
    previewMesh.scale.set(
      dims.width || 1,
      dims.depth || 1,
      Math.max((dims.height || dims.markerHeight || 0.1) / 0.2, 0.4),
    );
    previewMesh.position.set(x, y, z);
    previewGlow.position.set(x, y, 0.02);
    previewMesh.visible = true;
    previewGlow.visible = true;
  }

  function selectPlacedMeshFromHit(object) {
    let node = object;
    while (node && !node.userData?.workshopItemId) node = node.parent;
    const itemId = node?.userData?.workshopItemId;
    if (!itemId) return false;
    selectedItemId = itemId;
    clearStudioSelection?.();
    syncSelectedPlacedItem();
    render();
    return true;
  }

  function updatePointerFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function selectedPlaceLabel() {
    return presetById(selectedPlacePreset)?.label || "Item";
  }

  function addPlacedItemFromPreview() {
    if (!previewPoint) {
      setStatus?.("error", "Move the cursor onto the warehouse floor first.");
      return;
    }
    const preset = presetById(selectedPlacePreset);
    const existing = layoutState.objects || [];
    const dims = preset.dimensions || {};
    const next = createWorkshopObject({
      id: nextWorkshopObjectId(preset.type, existing),
      type: preset.type,
      label: preset.label,
      pose: {
        x: previewPoint.x,
        y: previewPoint.y,
        z: (dims.height || dims.markerHeight || 0.1) / 2,
        yaw: 0,
      },
      dimensions: {
        width: dims.width,
        depth: dims.depth,
        height: dims.height || dims.markerHeight || 0.1,
      },
      streamSlot: preset.streamSlot || "",
    });
    layoutState = { ...layoutState, objects: [...existing, next] };
    selectedItemId = next.id;
    rebuildPlacedScene();
    scheduleLayoutSave();
    setStatus?.("ok", `Placed ${preset.label.toLowerCase()} in meters.`);
    render();
  }

  function deleteSelectedItem() {
    if (!selectedItemId) return;
    layoutState = { ...layoutState, objects: layoutState.objects.filter((item) => item.id !== selectedItemId) };
    selectedItemId = "";
    transformControls.detach();
    rebuildPlacedScene();
    scheduleLayoutSave();
    render();
  }

  function syncTransformSelection() {
    const obj = transformControls.object;
    if (!active || !obj?.userData?.workshopItemId) return;
    layoutState = {
      ...layoutState,
      objects: layoutState.objects.map((item) => (
        item.id === obj.userData.workshopItemId
          ? {
            ...item,
            pose: {
              ...item.pose,
              x: Number(obj.position.x.toFixed(4)),
              y: Number(obj.position.y.toFixed(4)),
              z: Number(obj.position.z.toFixed(4)),
              yaw: Number(obj.rotation.z.toFixed(6)),
            },
          }
          : item
      )),
    };
    scheduleLayoutSave();
  }

  async function loadWorkshopState(force = false) {
    const projectId = String(getProjectId?.() || "").trim();
    activeProjectId = projectId;
    if (!projectId) {
      workshopState = seededWorkshopState(currentProjectName());
      layoutState = buildDefaultWorkshopLayout();
      ideState = buildDefaultWorkshopIde();
      workshopError = "Open a project to load this workshop.";
      render();
      return;
    }
    if (!force && projectId === activeProjectId && workshopState.project_label === currentProjectName()) {
      render();
      return;
    }
    const token = ++loadToken;
    workshopError = "";
    try {
      const data = await api(`/api/projects/${projectId}/workshop`);
      if (token !== loadToken) return;
      workshopState = normalizeWorkshopState(data, currentProjectName());
      layoutState = normalizeWorkshopLayout(workshopState.layout);
      ideState = normalizeWorkshopIde(workshopState.ide);
      partnerModalOpen = !activePartner().id;
      rebuildPlacedScene();
      if (!Array.isArray(data?.layout?.objects) || !data.layout.objects.length) {
        void saveWorkshopPatch({ saveLayout: true, quiet: true });
      }
    } catch (err) {
      if (token !== loadToken) return;
      workshopState = seededWorkshopState(currentProjectName());
      layoutState = buildDefaultWorkshopLayout();
      ideState = buildDefaultWorkshopIde();
      workshopError = err?.message || "Could not load saved workshop details.";
      rebuildPlacedScene();
    }
    render();
  }

  async function approveItem(itemId) {
    const projectId = String(getProjectId?.() || "").trim();
    if (!projectId || !itemId) return;
    try {
      const data = await api(`/api/projects/${projectId}/workshop/approvals/${encodeURIComponent(itemId)}/approve`, {
        method: "POST",
      });
      workshopState = normalizeWorkshopState(data.workshop || data, currentProjectName());
      setStatus?.("ok", "Approval saved.");
      render();
    } catch (err) {
      setStatus?.("error", err?.message || "Could not approve this Workshop item.");
    }
  }

  async function runDebugRow(rowId) {
    const projectId = String(getProjectId?.() || "").trim();
    if (!projectId || !rowId) return;
    const row = (workshopState.queue || []).find((entry) => entry.id === rowId);
    try {
      const data = await api(`/api/projects/${projectId}/workshop/debug`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          row_id: rowId,
          label: row?.label || rowId,
          detail: row?.detail || "",
        }),
      });
      workshopState = normalizeWorkshopState(data.workshop || data, currentProjectName());
      lastDebugResult = data.result || null;
      setStatus?.("ok", lastDebugResult?.message || "Debug handoff saved.");
      render();
    } catch (err) {
      setStatus?.("error", err?.message || "Could not send this row to Debug.");
    }
  }

  function setSurface(next = "god") {
    if (!active) return;
    activeSurface = next;
    if (activeSurface === "wiring") {
      roomGroup.visible = false;
      previewMesh.visible = false;
      previewGlow.visible = false;
      transformControls.detach();
      controls.enabled = false;
      showWiringWorkspace?.();
    } else {
      hideWiringWorkspace?.();
      roomGroup.visible = true;
      controls.enabled = true;
      syncSelectedPlacedItem();
      applyCameraPose(activeSurface);
    }
    render();
  }

  function selectPartner(partnerId) {
    const match = (workshopState.partner_options || []).find((item) => item.id === partnerId)
      || WORKSHOP_PARTNER_OPTIONS.find((item) => item.id === partnerId);
    if (!match) return;
    workshopState = normalizeWorkshopState({ ...workshopState, selected_partner: match }, currentProjectName());
    partnerModalOpen = false;
    void saveWorkshopPatch({ savePartner: true, quiet: true });
    render();
    setStatus?.("ok", `${match.label} is now selected for this Workshop session.`);
  }

  function copyVoicePrompt({ submit = false } = {}) {
    const text = String(root.querySelector("[data-workshop-voice-input]")?.value || voiceDraft || "").trim();
    if (!text) {
      setStatus?.("error", "Say or enter a Workshop prompt first.");
      return;
    }
    setStudioPromptText?.(text, { submit });
  }

  function appendPartnerUpdate() {
    const partner = activePartner();
    if (!partner.id) {
      partnerModalOpen = true;
      render();
      return;
    }
    const selected = objectForSelection();
    const timestamp = new Date().toLocaleTimeString();
    const message = `\n[${timestamp}] ${partner.label}: ${selected ? `Watching ${selected.label} at x=${selected.pose.x} m, y=${selected.pose.y} m.` : "Watching the room layout."} ${currentBridge().status === "connected_live" ? "Live bridge connected." : "Live bridge stubbed; update generated in mock mode."}\n`;
    const file = activeFile();
    if (!file) return;
    updateActiveFileContent(`${file.content || ""}${message}`);
    setStatus?.("ok", "Added a partner update to the collab editor.");
    render();
  }

  function exportLayout() {
    const payload = exportWorkshopLayout(layoutState, {
      project_id: activeProjectId || undefined,
      project_label: workshopState.project_label || currentProjectName(),
      selected_partner: activePartner().id || undefined,
      notes: {
        scale: `All Workshop placements are stored in ${WORKSHOP_LINEAR_UNIT} with ${WORKSHOP_ANGLE_UNIT} yaw.`,
      },
    });
    const safeProject = String(activeProjectId || "workshop").replace(/[^a-z0-9_-]+/gi, "-");
    downloadJson(`${safeProject}-workshop-layout-meters.json`, payload);
    setStatus?.("ok", "Exported Workshop layout in meters.");
  }

  function paintTvScreens(now = performance.now()) {
    if (now - lastTelemetryPaintAt < 700) return;
    lastTelemetryPaintAt = now;
    const queueCount = (workshopState.queue || []).length;
    const pendingApprovals = (workshopState.approvals || []).filter((item) => String(item.status || "").toLowerCase() !== "approved").length;
    tvScreenById.forEach((entry) => {
      const { canvas, ctx, texture, slot, label } = entry;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#04111d";
      ctx.fillRect(0, 0, w, h);
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, "#0f172a");
      gradient.addColorStop(1, slot === "openarm-telemetry" ? "#082f49" : "#1e1b4b");
      ctx.fillStyle = gradient;
      ctx.fillRect(18, 18, w - 36, h - 36);
      ctx.fillStyle = "#93c5fd";
      ctx.font = "700 36px Inter, sans-serif";
      ctx.fillText(label, 46, 72);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "600 26px Inter, sans-serif";
      if (slot === "openarm-telemetry") {
        const sweep = (Math.sin(now / 1200) * 18 + 42).toFixed(1);
        const load = (Math.cos(now / 1500) * 8 + 54).toFixed(1);
        const fps = (29 + ((now / 100) % 4)).toFixed(0);
        ctx.fillText(`Joint sweep: ${sweep}°`, 52, 170);
        ctx.fillText(`Servo load: ${load}%`, 52, 214);
        ctx.fillText(`Camera heartbeat: ${fps} fps`, 52, 258);
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(52, 314, 360, 18);
      } else {
        ctx.fillText(`Queue rows: ${queueCount}`, 52, 170);
        ctx.fillText(`Open approvals: ${pendingApprovals}`, 52, 214);
        ctx.fillText(`Selected partner: ${activePartner().label || "None"}`, 52, 258);
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(52, 314, 300, 18);
      }
      ctx.strokeStyle = "rgba(148,163,184,0.38)";
      ctx.strokeRect(40, 120, w - 80, h - 160);
      texture.needsUpdate = true;
    });
  }

  function renderAgents() {
    const seats = Array.isArray(workshopState.agent_seats) ? workshopState.agent_seats : WORKSHOP_AGENT_SEATS;
    return seats.map((seat) => `
      <article class="workshop-card">
        <div class="workshop-card-head">
          <strong>${esc(seat.deskLabel || seat.label || seat.id)}</strong>
          <span class="workshop-pill">${esc(seat.status || seat.role || "Ready")}</span>
        </div>
        <p>${esc(seat.label || seat.id)} · ${esc(seat.role || "seat")}</p>
      </article>
    `).join("");
  }

  function renderQueue() {
    const queue = Array.isArray(workshopState.queue) ? workshopState.queue : [];
    if (!queue.length) return `<p class="muted small">No queue items yet.</p>`;
    return queue.map((row) => `
      <article class="workshop-card workshop-queue-card workshop-queue-card--${esc(String(row.status || "waiting").toLowerCase())}">
        <div class="workshop-card-head">
          <strong>${esc(row.label || row.id || "Queue row")}</strong>
          <span class="workshop-pill workshop-pill--${esc(String(row.status || "waiting").toLowerCase())}">${esc(row.status || "waiting")}</span>
        </div>
        <p>${esc(row.detail || "")}</p>
      </article>
    `).join("");
  }

  function renderDebugRows() {
    const queue = Array.isArray(workshopState.queue) ? workshopState.queue : [];
    const result = workshopState.debug?.last_result || lastDebugResult;
    return `
      ${result ? `
        <div class="workshop-debug-result workshop-debug-result--${esc(String(result.status || "waiting").toLowerCase())}">
          <strong>${esc(result.status || "waiting")}</strong>
          <span>${esc(result.message || "Latest debug handoff saved.")}</span>
        </div>
      ` : ""}
      <div class="workshop-debug-list">
        ${queue.map((row) => `
          <article class="workshop-card workshop-debug-card">
            <div>
              <strong>${esc(row.label || row.id || "Queue row")}</strong>
              <p>${esc(row.detail || "")}</p>
            </div>
            <button type="button" class="btn secondary btn-compact" data-workshop-debug="${esc(row.id)}">Send to Debug</button>
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderApprovals() {
    const approvals = Array.isArray(workshopState.approvals) ? workshopState.approvals : [];
    return approvals.map((item) => `
      <article class="workshop-card">
        <div class="workshop-card-head">
          <strong>${esc(item.title || item.id || "Approval")}</strong>
          <span class="workshop-pill workshop-pill--${esc(String(item.status || "pending").toLowerCase())}">${esc(item.status || "pending")}</span>
        </div>
        <p>${esc(item.summary || "")}</p>
        ${String(item.status || "").toLowerCase() === "approved"
          ? `<span class="workshop-inline-ok">Approved</span>`
          : `<button type="button" class="btn accent btn-compact" data-workshop-approve="${esc(item.id)}">Approve</button>`}
      </article>
    `).join("");
  }

  function renderMonitorList() {
    const monitors = layoutState.objects.filter((item) => item.type === "tv");
    return monitors.map((item) => `
      <article class="workshop-card">
        <div class="workshop-card-head">
          <strong>${esc(item.label)}</strong>
          <span class="workshop-pill">${esc(item.streamSlot || "stream")}</span>
        </div>
        <p>${esc(item.streamSlot === "openarm-telemetry" ? "Mock OpenArm telemetry feed." : "Queue and room activity feed.")}</p>
      </article>
    `).join("");
  }

  function renderPartnerModal() {
    const bridge = currentBridge();
    const options = workshopState.partner_options || WORKSHOP_PARTNER_OPTIONS;
    return `
      <div class="workshop-entry-modal">
        <div class="workshop-entry-backdrop" data-workshop-close-partner></div>
        <div class="workshop-entry-card">
          <div class="workshop-entry-head">
            <div>
              <span class="workshop-kicker">Workshop entry</span>
              <h3>Select a room partner</h3>
            </div>
            <button type="button" class="btn secondary btn-compact" data-workshop-close-partner>Close</button>
          </div>
          <p class="muted small">Choose the voice or agent partner for this project. The room keeps working even when live bridge credentials are missing.</p>
          <div class="workshop-partner-grid">
            ${options.map((item) => `
              <button type="button" class="workshop-partner-option${activePartner().id === item.id ? " active" : ""}" data-workshop-partner="${esc(item.id)}">
                <strong>${esc(item.label)}</strong>
                <span>${esc(item.summary || item.kind || "")}</span>
              </button>
            `).join("")}
          </div>
          <div class="workshop-inline-banner workshop-inline-banner--bridge">
            <strong>${esc(bridge.label || "Not connected")}</strong>
            <span>${esc(bridge.detail || "")}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderGodPanel() {
    return `
      <div class="workshop-panel-scroll">
        <div class="workshop-inline-banner">
          <strong>True-scale meters</strong>
          <span>Workshop props use 1 world unit = 1 meter. Exported layout stores meters and yaw for passthrough.</span>
        </div>
        <div class="workshop-preset-grid">
          ${WORKSHOP_PLACE_PRESETS.map((preset) => `
            <button type="button" class="workshop-preset${selectedPlacePreset === preset.id ? " active" : ""}" data-workshop-preset="${esc(preset.id)}">
              <strong>${esc(preset.label)}</strong>
              <span>${esc(preset.summary)}</span>
            </button>
          `).join("")}
        </div>
        <div class="workshop-inline-actions">
          <button type="button" class="btn accent btn-compact" data-workshop-set-surface="editor">Open editor</button>
          <button type="button" class="btn secondary btn-compact" data-workshop-export>Export layout (meters)</button>
        </div>
        <h3 class="workshop-section-title">Agent desks</h3>
        ${renderAgents()}
        <h3 class="workshop-section-title">Monitors</h3>
        ${renderMonitorList()}
        <h3 class="workshop-section-title">Approvals</h3>
        ${renderApprovals()}
        <h3 class="workshop-section-title">Queue</h3>
        ${renderQueue()}
      </div>
    `;
  }

  function renderEditorPanel() {
    const selected = objectForSelection();
    const file = activeFile();
    return `
      <div class="workshop-panel-scroll">
        <div class="workshop-inline-banner workshop-inline-banner--bridge">
          <strong>${esc(activePartner().label || "No partner selected")}</strong>
          <span>${esc(currentBridge().label)} · ${esc(currentBridge().detail || "Choose a partner to watch the room.")}</span>
        </div>
        <p class="muted small workshop-soft-note">Move the camera like the main viewport. In Editor, the placement preview follows the mouse across the room floor.</p>
        <div class="workshop-preset-grid">
          ${WORKSHOP_PLACE_PRESETS.map((preset) => `
            <button type="button" class="workshop-preset${selectedPlacePreset === preset.id ? " active" : ""}" data-workshop-preset="${esc(preset.id)}">
              <strong>${esc(preset.label)}</strong>
              <span>${esc(preset.summary)}</span>
            </button>
          `).join("")}
        </div>
        <div class="workshop-inline-actions">
          <button type="button" class="btn accent btn-compact" data-workshop-place>Place ${esc(selectedPlaceLabel())}</button>
          <button type="button" class="btn secondary btn-compact" data-workshop-transform="translate">Move</button>
          <button type="button" class="btn secondary btn-compact" data-workshop-transform="rotate">Rotate</button>
          <button type="button" class="btn secondary btn-compact" data-workshop-delete-selection ${selected ? "" : "disabled"}>Delete</button>
        </div>
        <p class="muted small">${selected ? `${esc(selected.label)} · x ${selected.pose.x} m · y ${selected.pose.y} m · yaw ${selected.pose.yaw.toFixed(2)} rad` : "Click a placed item to move or rotate it."}</p>
        <h3 class="workshop-section-title">Voice prompt</h3>
        <textarea id="workshop-voice-input" class="workshop-voice-input" rows="5" data-workshop-voice-input placeholder="Describe what you are moving or building in the room...">${esc(voiceDraft)}</textarea>
        <div class="workshop-inline-actions">
          <button type="button" class="btn secondary btn-compact" data-workshop-dictate>Mic</button>
          <button type="button" class="btn secondary btn-compact" data-workshop-copy-prompt>Use in AI prompt</button>
          <button type="button" class="btn accent btn-compact" data-workshop-run-prompt>Run in AI prompt</button>
        </div>
        <h3 class="workshop-section-title">Collab editor</h3>
        <div class="workshop-ide">
          <aside class="workshop-ide-files">
            ${ideState.files.map((ideFile) => `
              <button type="button" class="workshop-ide-file${ideState.activeFileId === ideFile.id ? " active" : ""}" data-workshop-file="${esc(ideFile.id)}">${esc(ideFile.label)}</button>
            `).join("")}
            <button type="button" class="btn secondary btn-compact workshop-ide-stub-btn" data-workshop-partner-modal>Choose partner</button>
            <button type="button" class="btn accent btn-compact workshop-ide-stub-btn" data-workshop-agent-update>Insert partner update</button>
          </aside>
          <div class="workshop-ide-editor">
            <div class="workshop-ide-filebar">${esc(file?.label || "No file selected")}</div>
            <textarea class="workshop-ide-textarea" rows="12" data-workshop-ide-text>${esc(file?.content || "")}</textarea>
          </div>
        </div>
        <div class="workshop-inline-actions">
          <button type="button" class="btn secondary btn-compact" data-workshop-export>Export layout (meters)</button>
          <button type="button" class="btn secondary btn-compact" data-workshop-dj>DJ handoff stub</button>
        </div>
      </div>
    `;
  }

  function renderWiringPanel() {
    return `
      <div class="workshop-panel-scroll">
        <div class="workshop-inline-banner">
          <strong>Workshop wiring sim</strong>
          <span>This view reuses the existing wiring workspace so Sam can click a Workshop tab and keep working in the same project.</span>
        </div>
        <div class="workshop-inline-actions">
          <button type="button" class="btn secondary btn-compact" data-workshop-set-surface="god">Back to God View</button>
          <button type="button" class="btn secondary btn-compact" data-workshop-set-surface="editor">Back to Editor</button>
        </div>
        <article class="workshop-card">
          <div class="workshop-card-head">
            <strong>Wiring bay shell</strong>
            <span class="workshop-pill">Stub + live canvas</span>
          </div>
          <p>The dedicated Workshop wiring surface is ready and hands off to the existing simulator canvas underneath.</p>
        </article>
        <h3 class="workshop-section-title">Debug</h3>
        ${renderDebugRows()}
      </div>
    `;
  }

  function renderBody() {
    if (activeSurface === "editor") return renderEditorPanel();
    if (activeSurface === "wiring") return renderWiringPanel();
    return renderGodPanel();
  }

  function bindRootEvents() {
    root.querySelectorAll("[data-workshop-set-surface]").forEach((btn) => {
      btn.addEventListener("click", () => setSurface(btn.getAttribute("data-workshop-set-surface") || "god"));
    });
    root.querySelectorAll("[data-workshop-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedPlacePreset = btn.getAttribute("data-workshop-preset") || selectedPlacePreset;
        render();
      });
    });
    root.querySelector("[data-workshop-exit]")?.addEventListener("click", () => exit());
    root.querySelectorAll("[data-workshop-export]").forEach((btn) => {
      btn.addEventListener("click", () => exportLayout());
    });
    root.querySelector("[data-workshop-place]")?.addEventListener("click", () => addPlacedItemFromPreview());
    root.querySelectorAll("[data-workshop-transform]").forEach((btn) => {
      btn.addEventListener("click", () => {
        transformMode = btn.getAttribute("data-workshop-transform") || "translate";
        syncSelectedPlacedItem();
      });
    });
    root.querySelector("[data-workshop-delete-selection]")?.addEventListener("click", () => deleteSelectedItem());
    root.querySelectorAll("[data-workshop-approve]").forEach((btn) => {
      btn.addEventListener("click", () => approveItem(btn.getAttribute("data-workshop-approve")));
    });
    root.querySelectorAll("[data-workshop-debug]").forEach((btn) => {
      btn.addEventListener("click", () => runDebugRow(btn.getAttribute("data-workshop-debug")));
    });
    root.querySelector("[data-workshop-dictate]")?.addEventListener("click", async () => {
      await toggleDictation?.("workshop-voice-input", root.querySelector("[data-workshop-dictate]"));
    });
    root.querySelector("[data-workshop-copy-prompt]")?.addEventListener("click", () => copyVoicePrompt({ submit: false }));
    root.querySelector("[data-workshop-run-prompt]")?.addEventListener("click", () => copyVoicePrompt({ submit: true }));
    root.querySelector("[data-workshop-voice-input]")?.addEventListener("input", (event) => {
      voiceDraft = event.target?.value || "";
    });
    root.querySelectorAll("[data-workshop-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ideState = { ...ideState, activeFileId: btn.getAttribute("data-workshop-file") || ideState.activeFileId };
        render();
      });
    });
    root.querySelector("[data-workshop-ide-text]")?.addEventListener("input", (event) => {
      updateActiveFileContent(event.target?.value || "");
    });
    root.querySelector("[data-workshop-agent-update]")?.addEventListener("click", () => appendPartnerUpdate());
    root.querySelectorAll("[data-workshop-partner-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        partnerModalOpen = true;
        render();
      });
    });
    root.querySelector("[data-workshop-dj]")?.addEventListener("click", () => {
      setStatus?.("ok", "DJ handoff stub: this would call the Spotify / DJ agent when a live bridge is configured.");
    });
    root.querySelectorAll("[data-workshop-partner]").forEach((btn) => {
      btn.addEventListener("click", () => selectPartner(btn.getAttribute("data-workshop-partner")));
    });
    root.querySelectorAll("[data-workshop-close-partner]").forEach((btn) => {
      btn.addEventListener("click", () => {
        partnerModalOpen = false;
        render();
      });
    });
  }

  function render() {
    const canOpen = !!String(getProjectId?.() || "").trim();
    launcher.hidden = active;
    launcher.disabled = !canOpen;
    launcher.title = canOpen ? "Open Workshop" : "Open a project first";
    root.hidden = !active;
    root.classList.toggle("hidden", !active);
    root.classList.toggle("workshop-shell--wiring", activeSurface === "wiring");
    if (!active) return;
    const partner = activePartner();
    const bridge = currentBridge();
    root.innerHTML = `
      <div class="workshop-shell-card workshop-shell-card--wide">
        <div class="workshop-shell-head">
          <div>
            <span class="workshop-kicker">Workshop</span>
            <h2>${esc(workshopState.project_label || currentProjectName())}</h2>
            <p>God view warehouse · full editor · wiring sim · ${WORKSHOP_LINEAR_UNIT} layout export</p>
          </div>
          <div class="workshop-shell-actions">
            <button type="button" class="btn secondary btn-compact" data-workshop-partner-modal>${partner.id ? "Switch partner" : "Choose partner"}</button>
            <button type="button" class="btn secondary btn-compact" data-workshop-export>Export layout (meters)</button>
            <button type="button" class="btn secondary btn-compact" data-workshop-exit>Back to Studio</button>
          </div>
        </div>
        <div class="workshop-mode-tabs" role="tablist" aria-label="Workshop view">
          <button type="button" class="workshop-top-tab${activeSurface === "god" ? " active" : ""}" data-workshop-set-surface="god">God View</button>
          <button type="button" class="workshop-top-tab${activeSurface === "editor" ? " active" : ""}" data-workshop-set-surface="editor">Editor</button>
          <button type="button" class="workshop-top-tab${activeSurface === "wiring" ? " active" : ""}" data-workshop-set-surface="wiring">Wiring Sim</button>
          <span class="workshop-pill workshop-pill--${esc(String(bridge.status || "not_connected").toLowerCase())}">${esc(bridge.label || "Not connected")}</span>
        </div>
        ${workshopError ? `<div class="workshop-inline-error">${esc(workshopError)}</div>` : ""}
        ${renderBody()}
        <div class="workshop-footnote">
          <span>1 unit = 1 meter</span>
          <span>Click placed items to move or rotate</span>
          <span>PM wrap monitor + Sales monitor are live shell surfaces</span>
          <span>Route ${esc(WORKSHOP_HASH)}</span>
        </div>
      </div>
      ${partnerModalOpen ? renderPartnerModal() : ""}
    `;
    bindRootEvents();
  }

  function handlePointerDown(event) {
    if (!active || activeSurface === "wiring") return;
    if (event.target?.closest?.(".workshop-shell")) return;
    updatePointerFromEvent(event);
    raycaster.setFromCamera(pointerNdc, camera);
    const placedHits = raycaster.intersectObjects([...placedGroup.children], true);
    if (placedHits[0]?.object && selectPlacedMeshFromHit(placedHits[0].object)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handlePointerMove(event) {
    if (!active || activeSurface === "wiring") return;
    lastPointerEvent = event;
    updatePointerFromEvent(event);
  }

  function handleCanvasClick(event) {
    if (!active || activeSurface === "wiring") return;
    if (event.target?.closest?.(".workshop-shell")) return;
    updatePointerFromEvent(event);
    raycaster.setFromCamera(pointerNdc, camera);
    const placedHits = raycaster.intersectObjects([...placedGroup.children], true);
    if (placedHits[0]?.object && selectPlacedMeshFromHit(placedHits[0].object)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (activeSurface === "editor") {
      addPlacedItemFromPreview();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handleKeyDown(event) {
    if (!active) return;
    if (event.key === "Escape" && partnerModalOpen) {
      partnerModalOpen = false;
      render();
      event.preventDefault();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && !event.target?.closest?.("textarea,input")) {
      deleteSelectedItem();
    }
  }

  async function enter({ syncMode = true } = {}) {
    if (active) return;
    if (!String(getProjectId?.() || "").trim()) {
      setStatus?.("error", "Open a project before entering the Workshop.");
      return;
    }
    clearStudioSelection?.();
    active = true;
    activeSurface = "god";
    selectedItemId = "";
    transformMode = "translate";
    voiceDraft = "";
    document.body.classList.add("workshop-mode-active");
    rememberCameraPose();
    showWorkshopScene();
    controls.enabled = true;
    applyCameraPose("god");
    await loadWorkshopState(true);
    updateRoute(true);
    if (syncMode) syncWorkspaceMode?.("workshop");
    render();
    setStatus?.("ok", "Workshop is active.");
  }

  function exit({ keepRoute = false, syncMode = true } = {}) {
    if (!active) return;
    active = false;
    window.clearTimeout(persistLayoutTimer);
    window.clearTimeout(persistIdeTimer);
    persistLayoutTimer = 0;
    persistIdeTimer = 0;
    hideWiringWorkspace?.();
    document.body.classList.remove("workshop-mode-active");
    transformControls.detach();
    hideWorkshopScene();
    restoreCameraPose();
    controls.enabled = true;
    if (!keepRoute) updateRoute(false);
    if (syncMode) syncWorkspaceMode?.("design");
    render();
    setStatus?.("ok", "Back in Studio view.");
  }

  function update() {
    if (!active) return;
    if (activeSurface !== "wiring") {
      controls.update();
      if (lastPointerEvent) updatePreviewMesh();
      paintTvScreens();
    }
  }

  function setProjectContext() {
    const nextId = String(getProjectId?.() || "").trim();
    if (nextId === activeProjectId) return;
    activeProjectId = nextId;
    if (active) {
      void loadWorkshopState(true);
    } else if (window.location.hash === WORKSHOP_HASH && nextId) {
      void enter();
    } else {
      render();
    }
  }

  launcher.addEventListener("click", () => {
    if (!active) void enter();
  });
  renderer.domElement.addEventListener("pointerdown", handlePointerDown, true);
  renderer.domElement.addEventListener("pointermove", handlePointerMove, true);
  renderer.domElement.addEventListener("click", handleCanvasClick, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("hashchange", () => {
    if (window.location.hash === WORKSHOP_HASH) {
      if (!active) void enter();
      return;
    }
    if (active) exit({ keepRoute: true, syncMode: true });
  });
  transformControls.addEventListener("objectChange", syncTransformSelection);

  render();
  if (window.location.hash === WORKSHOP_HASH && String(getProjectId?.() || "").trim()) {
    void enter({ syncMode: false });
  }

  return {
    enter,
    exit,
    isActive() {
      return active;
    },
    update,
    setProjectContext,
    setSurface,
  };
}
