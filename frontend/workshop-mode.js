import * as THREE from "three";
import { createWorkshopWarehouseFloor } from "./workshop-warehouse-floor.js?v=20260918-warehouse-mvp2";

const WORKSHOP_HASH = "#workshop";
const PLACED_LS_PREFIX = "render3d:workshop-placed:v1:";
const PLACE_PRESETS = [
  {
    id: "part-bin",
    label: "Part bin",
    summary: "Small tray for staged parts",
    width: 0.58,
    depth: 0.42,
    height: 0.2,
    color: 0x5b8cff,
    accent: 0xbdd7ff,
    shape: "bin",
  },
  {
    id: "print-cart",
    label: "Print cart",
    summary: "Mobile surface for printer jobs",
    width: 0.9,
    depth: 0.58,
    height: 0.78,
    color: 0x64748b,
    accent: 0xf8fafc,
    shape: "cart",
  },
  {
    id: "fixture-stand",
    label: "Fixture stand",
    summary: "Pedestal for checking placement",
    width: 0.48,
    depth: 0.48,
    height: 0.86,
    color: 0xf59e0b,
    accent: 0xfde68a,
    shape: "stand",
  },
];

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

function presetById(id) {
  return PLACE_PRESETS.find((entry) => entry.id === id) || PLACE_PRESETS[0];
}

function storageKey(projectId) {
  return `${PLACED_LS_PREFIX}${projectId || "none"}`;
}

function seededWorkshopState(projectName = "Project") {
  return {
    project_label: projectName,
    agents_source: "mock",
    agents: [
      {
        id: "floor-lead",
        name: "Floor lead",
        status: "In room",
        tasks: [
          { id: "prep-bay", title: "Stage the print bay", status: "active" },
          { id: "material-check", title: "Check incoming materials", status: "queued" },
        ],
      },
      {
        id: "printer-tech",
        name: "Printer tech",
        status: "Watching",
        tasks: [
          { id: "watch-queue", title: "Watch overnight print queue", status: "active" },
          { id: "plate-swap", title: "Prepare next plate swap", status: "queued" },
        ],
      },
      {
        id: "review-assistant",
        name: "Review assistant",
        status: "Ready",
        tasks: [
          { id: "qa-handoff", title: "Collect approval notes", status: "ready" },
        ],
      },
    ],
    projects: {
      create: [
        {
          id: "create-layout",
          title: `${projectName} setup`,
          summary: "Lay out the printer bay, prep cart, and handoff area for this build.",
          status: "upcoming",
        },
        {
          id: "create-fixture",
          title: "Fixture check",
          summary: "Place a simple fixture stand beside the active workbench for fast test fits.",
          status: "queued",
        },
      ],
      train: [
        {
          id: "train-ops",
          title: "Operator walkthrough",
          summary: "Train the room on first article checks and next-step handoff language.",
          status: "upcoming",
        },
        {
          id: "train-review",
          title: "Review flow",
          summary: "Teach the room which jobs can ship and which need a second look.",
          status: "planned",
        },
      ],
    },
    approvals: [
      {
        id: "approve-voice-station",
        title: "Voice prompt station",
        summary: "Approve the live prompt desk so spoken requests can flow into the editor.",
        status: "pending",
      },
      {
        id: "approve-first-article",
        title: "First article review",
        summary: "Sign off the first workshop placement and motion check before the queue moves on.",
        status: "pending",
      },
    ],
    queue: [
      {
        id: "queue-plate-a",
        label: "Plate A · enclosure shells",
        status: "waiting",
        detail: "Waiting for the next open printer.",
      },
      {
        id: "queue-brackets",
        label: "Bracket print check",
        status: "pass",
        detail: "Recent placement and clearances passed.",
      },
      {
        id: "queue-cable-guide",
        label: "Cable guide fit",
        status: "fail",
        detail: "Needs a second review before release.",
      },
    ],
    debug: {
      hook_available: false,
      last_result: null,
    },
  };
}

function normalizeWorkshopState(input, projectName = "Project") {
  const seed = seededWorkshopState(projectName);
  const value = input && typeof input === "object" ? input : {};
  const projects = value.projects && typeof value.projects === "object" ? value.projects : {};
  const debug = value.debug && typeof value.debug === "object" ? value.debug : {};
  return {
    project_label: String(value.project_label || projectName || "Project"),
    agents_source: value.agents_source === "live" ? "live" : "mock",
    agents: Array.isArray(value.agents) && value.agents.length ? value.agents : seed.agents,
    projects: {
      create: Array.isArray(projects.create) && projects.create.length ? projects.create : seed.projects.create,
      train: Array.isArray(projects.train) && projects.train.length ? projects.train : seed.projects.train,
    },
    approvals: Array.isArray(value.approvals) && value.approvals.length ? value.approvals : seed.approvals,
    queue: Array.isArray(value.queue) && value.queue.length ? value.queue : seed.queue,
    debug: {
      hook_available: !!debug.hook_available,
      last_result: debug.last_result || null,
    },
  };
}

function buildWorkshopItemMesh(item, preset) {
  const root = new THREE.Group();
  root.name = `workshop-item-${item.id}`;
  root.userData.workshopItemId = item.id;
  root.userData.workshopPresetId = preset.id;

  if (preset.shape === "cart") {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(preset.width, preset.depth, preset.height * 0.72),
      new THREE.MeshStandardMaterial({ color: preset.color, roughness: 0.72, metalness: 0.18 }),
    );
    body.position.z = preset.height * 0.36;
    root.add(body);
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(preset.width * 0.96, preset.depth * 0.94, 0.05),
      new THREE.MeshStandardMaterial({ color: preset.accent, roughness: 0.48, metalness: 0.08 }),
    );
    top.position.z = preset.height - 0.025;
    root.add(top);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const wheel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.055, 0.04, 16),
          new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.78 }),
        );
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(sx * (preset.width * 0.38), sy * (preset.depth * 0.36), 0.055);
        root.add(wheel);
      }
    }
  } else if (preset.shape === "stand") {
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, preset.height * 0.82, 18),
      new THREE.MeshStandardMaterial({ color: preset.color, roughness: 0.62, metalness: 0.16 }),
    );
    stem.position.z = preset.height * 0.41;
    root.add(stem);
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.05, 24),
      new THREE.MeshStandardMaterial({ color: preset.accent, roughness: 0.4, metalness: 0.08 }),
    );
    top.position.z = preset.height - 0.025;
    root.add(top);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.24, 0.06, 24),
      new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.75 }),
    );
    base.position.z = 0.03;
    root.add(base);
  } else {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(preset.width, preset.depth, preset.height),
      new THREE.MeshStandardMaterial({ color: preset.color, roughness: 0.62, metalness: 0.08 }),
    );
    body.position.z = preset.height * 0.5;
    root.add(body);
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(preset.width * 0.9, preset.depth * 0.82, 0.03),
      new THREE.MeshStandardMaterial({ color: preset.accent, roughness: 0.36, metalness: 0.08 }),
    );
    lip.position.z = preset.height - 0.02;
    root.add(lip);
  }

  root.position.set(
    Number(item.position?.x) || 0,
    Number(item.position?.y) || 0,
    Number(item.position?.z) || 0,
  );
  root.rotation.set(
    Number(item.rotation?.x) || 0,
    Number(item.rotation?.y) || 0,
    Number(item.rotation?.z) || 0,
  );
  root.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
    child.userData.workshopItemId = item.id;
  });
  return root;
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
    authHeaders,
    toggleDictation,
    setStudioPromptText,
    clearStudioSelection,
    openWiringWorkspace,
  } = options;

  if (!viewportEl || !renderer || !scene || !camera || !controls || !transformControls) {
    throw new Error("Workshop mode requires viewport, renderer, scene, camera, controls, and transform controls.");
  }

  const roomGroup = new THREE.Group();
  roomGroup.name = "workshop-room";
  roomGroup.visible = false;
  scene.add(roomGroup);
  const legacyRoomNodes = [];
  const addLegacy = (node) => {
    legacyRoomNodes.push(node);
    roomGroup.add(node);
    return node;
  };

  const placedGroup = new THREE.Group();
  placedGroup.name = "workshop-placed";
  roomGroup.add(placedGroup);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.95, metalness: 0.03 }),
  );
  floor.name = "workshop-floor";
  floor.receiveShadow = true;
  floor.userData.workshopSurface = "floor";
  addLegacy(floor);

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.24, 4.6),
    new THREE.MeshStandardMaterial({ color: 0x223047, roughness: 0.86 }),
  );
  backWall.position.set(0, 8.88, 2.3);
  addLegacy(backWall);

  const sideWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 18, 4.6),
    new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.86 }),
  );
  sideWall.position.set(-8.88, 0, 2.3);
  addLegacy(sideWall);

  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 1.4, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.72 }),
  );
  desk.position.set(0.6, 5.2, 0.86);
  addLegacy(desk);

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.82),
        new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.74 }),
      );
      leg.position.set(0.6 + sx * 1.46, 5.2 + sy * 0.58, 0.41);
      addLegacy(leg);
    }
  }

  const deskSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(3.1, 1.34),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  deskSurface.position.set(0.6, 5.2, 0.93);
  deskSurface.userData.workshopSurface = "desk";
  addLegacy(deskSurface);

  const printerBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.82, 0.78),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.46, metalness: 0.18 }),
  );
  printerBody.position.set(-0.35, 5.15, 1.31);
  addLegacy(printerBody);

  const printerWindow = new THREE.Mesh(
    new THREE.BoxGeometry(0.66, 0.03, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x1d4ed8, transparent: true, opacity: 0.35 }),
  );
  printerWindow.position.set(-0.35, 4.75, 1.32);
  addLegacy(printerWindow);

  const pcBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.32, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.48 }),
  );
  pcBase.position.set(1.6, 5.08, 0.97);
  addLegacy(pcBase);

  const pcMonitor = new THREE.Mesh(
    new THREE.BoxGeometry(0.86, 0.08, 0.52),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.42 }),
  );
  pcMonitor.position.set(1.6, 5.02, 1.42);
  pcMonitor.userData.workshopPc = true;
  addLegacy(pcMonitor);

  const pcScreen = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.02, 0.38),
    new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x14532d, roughness: 0.25 }),
  );
  pcScreen.position.set(1.6, 4.97, 1.42);
  pcScreen.userData.workshopPc = true;
  addLegacy(pcScreen);

  const previewMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.18),
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.34,
      emissive: 0x0f766e,
      roughness: 0.4,
    }),
  );
  previewMesh.visible = false;
  previewMesh.userData.workshopPreview = true;
  roomGroup.add(previewMesh);

  const previewGlow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.015, 32),
    new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.18 }),
  );
  previewGlow.rotation.x = Math.PI / 2;
  previewGlow.visible = false;
  roomGroup.add(previewGlow);
  const warehouseFloor = createWorkshopWarehouseFloor({
    parent: roomGroup,
    authHeaders,
    setStatus,
  });

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "workshop-enter-affordance";
  launcher.innerHTML = `
    <span class="workshop-enter-affordance-icon">PC</span>
    <span class="workshop-enter-affordance-copy">
      <strong>Workshop</strong>
      <small>Desktop scene</small>
    </span>
  `;
  viewportEl.appendChild(launcher);

  const root = document.createElement("section");
  root.className = "workshop-shell hidden";
  root.setAttribute("aria-label", "Workshop");
  root.hidden = true;
  viewportEl.appendChild(root);

  const reticle = document.createElement("div");
  reticle.className = "workshop-reticle hidden";
  reticle.innerHTML = `<span></span>`;
  viewportEl.appendChild(reticle);

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2(0, 0);
  const previewSurfaces = [];
  const visibleState = new Map();
  const placedMeshById = new Map();
  const workshopBounds = { minX: -7.5, maxX: 7.5, minY: -7.5, maxY: 7.5 };
  const sceneBgStack = [];

  let active = false;
  let lastFrameMs = 0;
  let workshopState = seededWorkshopState("Project");
  let loadToken = 0;
  let activeProjectId = "";
  let loadedProjectId = "";
  let selectedPlacePreset = "";
  let activeTopTab = "editor";
  let activeEditorTab = "public";
  let activeProjectTab = "create";
  let activeLabTab = "agents";
  let selectedItemId = "";
  let selectedWarehousePropId = "";
  let workshopError = "";
  let previewPoint = null;
  let pointerLocked = false;
  let lastPointerEvent = null;
  let dictationBtn = null;
  let dictationInputId = "workshop-voice-input";
  let voiceDraft = "";
  const keysDown = new Set();
  const lookState = { yaw: Math.PI / 2, pitch: -0.08 };
  const savedCamera = {
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
  };
  let lastDebugResult = null;
  let placedItems = [];

  function setLegacyRoomVisible(visible) {
    legacyRoomNodes.forEach((node) => {
      node.visible = !!visible;
    });
  }

  function selectedWarehouseProp() {
    if (!selectedWarehousePropId) return null;
    const mesh = warehouseFloor.getEditableMesh(selectedWarehousePropId);
    if (!mesh) return null;
    return {
      id: selectedWarehousePropId,
      label: String(mesh.userData?.workshopWarehousePropLabel || selectedWarehousePropId),
    };
  }

  function selectedThingLabel() {
    return selectedPlacedItem()?.label || selectedWarehouseProp()?.label || "";
  }

  function clearWorkshopSelection({ reRender = true } = {}) {
    selectedItemId = "";
    selectedWarehousePropId = "";
    transformControls.detach();
    if (reRender) render();
  }

  function setCameraLook(target) {
    const dir = target.clone().sub(camera.position);
    const horiz = Math.hypot(dir.x, dir.y);
    lookState.yaw = Math.atan2(dir.y, dir.x || 0.0001);
    lookState.pitch = clamp(Math.atan2(dir.z, Math.max(horiz, 0.0001)), -1.35, 0.7);
    applyLook();
    controls.target.copy(target);
  }

  function focusBay(bayId, { topDown = false } = {}) {
    const bay = warehouseFloor.getBay(bayId);
    if (!bay) {
      setStatus?.("error", "Warehouse bay layout is not ready yet.");
      return false;
    }
    warehouseFloor.setActiveBay(bayId);
    const span = Math.max(bay.rect.width, bay.rect.depth);
    if (topDown) {
      camera.position.set(bay.rect.centerX, bay.rect.centerY - 0.001, Math.max(8, span * 1.28));
      setCameraLook(new THREE.Vector3(bay.rect.centerX, bay.rect.centerY, 0));
    } else {
      camera.position.set(bay.rect.centerX, bay.rect.maxY + 3.4, 1.72);
      setCameraLook(new THREE.Vector3(bay.rect.centerX, bay.rect.centerY, 1));
    }
    render();
    return true;
  }

  async function syncWarehouseRoom() {
    try {
      await warehouseFloor.ensureLoaded();
      warehouseFloor.setVisible(true);
      previewSurfaces.splice(0, previewSurfaces.length, ...warehouseFloor.getPlacementSurfaces());
      Object.assign(workshopBounds, warehouseFloor.getWalkBounds());
      warehouseFloor.setActiveBay(activeEditorTab === "god" ? "bay_wiring" : "bay_public_pods");
      setLegacyRoomVisible(false);
      workshopError = "";
    } catch (err) {
      warehouseFloor.setVisible(false);
      previewSurfaces.splice(0, previewSurfaces.length);
      setLegacyRoomVisible(true);
      workshopError = err?.message || "Could not load the warehouse floor pack.";
    }
  }

  function currentProjectName() {
    return String(getProjectName?.() || activeProjectId || "Project").trim() || "Project";
  }

  function updateRoute(activeRoute) {
    const url = new URL(window.location.href);
    const next = activeRoute
      ? `${url.pathname}${url.search}${WORKSHOP_HASH}`
      : `${url.pathname}${url.search}`;
    if (activeRoute && url.hash === WORKSHOP_HASH) return;
    if (!activeRoute && !url.hash) return;
    window.history[activeRoute ? "pushState" : "replaceState"]({}, "", next || "/");
  }

  function loadPlacedItems(projectId) {
    if (!projectId) {
      placedItems = [];
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey(projectId));
      const parsed = raw ? JSON.parse(raw) : [];
      placedItems = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
    } catch {
      placedItems = [];
    }
  }

  function savePlacedItems() {
    if (!activeProjectId) return;
    try {
      localStorage.setItem(storageKey(activeProjectId), JSON.stringify(placedItems));
    } catch {
      /* optional */
    }
  }

  function clearPlacedScene() {
    for (const child of [...placedGroup.children]) {
      placedGroup.remove(child);
      child.traverse((node) => {
        if (node.geometry) node.geometry.dispose?.();
        const material = node.material;
        if (Array.isArray(material)) material.forEach((entry) => entry?.dispose?.());
        else material?.dispose?.();
      });
    }
    placedMeshById.clear();
  }

  function rebuildPlacedScene() {
    clearPlacedScene();
    for (const item of placedItems) {
      const preset = presetById(item.preset_id);
      const mesh = buildWorkshopItemMesh(item, preset);
      placedMeshById.set(item.id, mesh);
      placedGroup.add(mesh);
    }
  }

  function syncSelectedPlacedItem() {
    if (!selectedItemId && !selectedWarehousePropId) {
      if (transformControls.object?.userData?.workshopItemId || transformControls.object?.userData?.workshopWarehousePropId) {
        transformControls.detach();
      }
      return;
    }
    const mesh = placedMeshById.get(selectedItemId) || warehouseFloor.getEditableMesh(selectedWarehousePropId);
    if (!mesh) {
      clearWorkshopSelection({ reRender: false });
      transformControls.detach();
      return;
    }
    transformControls.attach(mesh);
    transformControls.setMode("translate");
  }

  function selectedPlacedItem() {
    return placedItems.find((item) => item.id === selectedItemId) || null;
  }

  function updatePreviewMesh() {
    if (!active || activeTopTab !== "editor" || activeEditorTab !== "public" || !selectedPlacePreset) {
      previewMesh.visible = false;
      previewGlow.visible = false;
      previewPoint = null;
      return;
    }
    const preset = presetById(selectedPlacePreset);
    previewMesh.scale.set(
      preset.width / 0.5,
      preset.depth / 0.5,
      Math.max(0.08, preset.height) / 0.18,
    );
    const hit = raycaster.intersectObjects(previewSurfaces, false)[0];
    if (!hit?.point) {
      previewMesh.visible = false;
      previewGlow.visible = false;
      previewPoint = null;
      return;
    }
    const point = hit.point.clone();
    point.z = Math.max(point.z, 0);
    previewPoint = point;
    previewMesh.position.set(point.x, point.y, point.z + preset.height * 0.5);
    previewGlow.position.set(point.x, point.y, point.z + 0.01);
    previewMesh.visible = true;
    previewGlow.visible = true;
  }

  function sceneSetVisible(node, visible) {
    if (!node) return;
    visibleState.set(node.uuid, node.visible);
    node.visible = visible;
  }

  function showWorkshopRoom() {
    roomGroup.visible = true;
    warehouseFloor.setVisible(true);
    const modelRoot = getMeshRoot?.();
    if (modelRoot) sceneSetVisible(modelRoot, false);
    scene.traverse((node) => {
      if (!node || node === roomGroup || roomGroup.children.includes(node)) return;
      if (node === transformControls.getHelper()) return;
      if (node.userData?.isFloor || node.userData?.isShadowFloor || node.userData?.isArchitectBay || node.userData?.isArchitectGrid) {
        sceneSetVisible(node, false);
      }
      if (node.isGridHelper || node.type === "GridHelper" || node.name === "large-grid-axes" || node.name === "grid-dots") {
        sceneSetVisible(node, false);
      }
    });
    if (scene.background?.getHex) sceneBgStack.push(scene.background.getHex());
    scene.background = new THREE.Color(0x08111d);
  }

  function hideWorkshopRoom() {
    roomGroup.visible = false;
    warehouseFloor.setVisible(false);
    for (const [uuid, visible] of visibleState.entries()) {
      const node = scene.getObjectByProperty("uuid", uuid);
      if (node) node.visible = visible;
    }
    visibleState.clear();
    if (sceneBgStack.length) {
      scene.background = new THREE.Color(sceneBgStack.pop());
    }
    previewMesh.visible = false;
    previewGlow.visible = false;
  }

  function applyLook() {
    const dir = new THREE.Vector3(
      Math.cos(lookState.pitch) * Math.cos(lookState.yaw),
      Math.cos(lookState.pitch) * Math.sin(lookState.yaw),
      Math.sin(lookState.pitch),
    );
    camera.up.set(0, 0, 1);
    camera.lookAt(camera.position.clone().add(dir));
  }

  function enterCameraPose() {
    savedCamera.position.copy(camera.position);
    savedCamera.target.copy(controls.target);
    camera.position.set(0, -13.4, 1.72);
    lookState.yaw = Math.PI / 2;
    lookState.pitch = -0.05;
    applyLook();
  }

  function restoreCameraPose() {
    camera.position.copy(savedCamera.position);
    controls.target.copy(savedCamera.target);
    camera.up.set(0, 0, 1);
    camera.lookAt(savedCamera.target);
  }

  async function loadWorkshopState(force = false) {
    const projectId = String(getProjectId?.() || "").trim();
    activeProjectId = projectId;
    loadPlacedItems(projectId);
    rebuildPlacedScene();
    if (!projectId) {
      workshopState = seededWorkshopState(currentProjectName());
      workshopError = "Open a project to load this workshop.";
      render();
      return;
    }
    if (!force && loadedProjectId === projectId && workshopState.project_label === currentProjectName()) {
      render();
      return;
    }
    const token = ++loadToken;
    workshopError = "";
    try {
      const data = await api(`/api/projects/${projectId}/workshop`);
      if (token !== loadToken) return;
      workshopState = normalizeWorkshopState(data, currentProjectName());
      loadedProjectId = projectId;
    } catch (err) {
      if (token !== loadToken) return;
      workshopState = seededWorkshopState(currentProjectName());
      workshopError = err?.message || "Could not load saved workshop details.";
      loadedProjectId = projectId;
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
      setStatus?.("error", err?.message || "Could not approve this item.");
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
      setStatus?.("ok", lastDebugResult?.message || "Debug handoff queued.");
      render();
    } catch (err) {
      setStatus?.("error", err?.message || "Could not send this row to debug.");
    }
  }

  function copyVoicePrompt({ submit = false } = {}) {
    const input = root.querySelector(`#${CSS.escape(dictationInputId)}`);
    const text = String(input?.value || "").trim();
    if (!text) {
      setStatus?.("error", "Say or enter a prompt first.");
      return;
    }
    setStudioPromptText?.(text, { submit });
  }

  function nextPublicRoomPoint(zone) {
    const count = placedItems.filter((item) => (
      item.position?.x >= zone.rect.minX
      && item.position?.x <= zone.rect.maxX
      && item.position?.y >= zone.rect.minY
      && item.position?.y <= zone.rect.maxY
    )).length;
    const cols = 4;
    const row = Math.floor(count / cols);
    const col = count % cols;
    const gapX = Math.max(1.8, zone.rect.width / 5.4);
    const gapY = Math.max(1.9, zone.rect.depth / 5.2);
    return {
      x: clamp(zone.rect.minX + 1.3 + col * gapX, zone.rect.minX + 0.8, zone.rect.maxX - 0.8),
      y: clamp(zone.rect.maxY - 1.3 - row * gapY, zone.rect.minY + 0.8, zone.rect.maxY - 0.8),
      z: 0,
    };
  }

  function placeSelectedPreset() {
    if (!selectedPlacePreset) {
      setStatus?.("error", "Choose something to bring into the public room first.");
      return;
    }
    const zone = warehouseFloor.getBay("bay_public_pods");
    if (!zone) {
      setStatus?.("error", "Public room bay is not ready yet.");
      return;
    }
    const preset = presetById(selectedPlacePreset);
    const spawn = previewPoint
      ? {
          x: clamp(previewPoint.x, zone.rect.minX + 0.6, zone.rect.maxX - 0.6),
          y: clamp(previewPoint.y, zone.rect.minY + 0.6, zone.rect.maxY - 0.6),
          z: Math.max(0, previewPoint.z || 0),
        }
      : nextPublicRoomPoint(zone);
    const next = {
      id: `placed-${Date.now()}`,
      preset_id: preset.id,
      label: preset.label,
      position: {
        x: spawn.x,
        y: spawn.y,
        z: (spawn.z || 0) + preset.height * 0.5,
      },
      rotation: { x: 0, y: 0, z: 0 },
    };
    placedItems.push(next);
    selectedItemId = next.id;
    selectedWarehousePropId = "";
    savePlacedItems();
    rebuildPlacedScene();
    syncSelectedPlacedItem();
    warehouseFloor.setActiveBay("bay_public_pods");
    setStatus?.("ok", `Brought ${preset.label.toLowerCase()} into the public room. Drag it to move.`);
    render();
  }

  function selectPlacedMeshFromHit(object) {
    let node = object;
    while (node && !node.userData?.workshopItemId && !node.userData?.workshopWarehousePropId) node = node.parent;
    const warehousePropId = node?.userData?.workshopWarehousePropId;
    if (warehousePropId) {
      selectedWarehousePropId = warehousePropId;
      selectedItemId = "";
      clearStudioSelection?.();
      syncSelectedPlacedItem();
      setStatus?.("ok", `Selected ${node.userData?.workshopWarehousePropLabel || "wall shell"} — drag the handles to move it.`);
      render();
      return true;
    }
    const itemId = node?.userData?.workshopItemId;
    if (!itemId) return false;
    selectedItemId = itemId;
    selectedWarehousePropId = "";
    clearStudioSelection?.();
    syncSelectedPlacedItem();
    setStatus?.("ok", "Selected workshop item — drag the handles to move it.");
    render();
    return true;
  }

  function renderPublicRoom() {
    return `
      <p class="muted small workshop-soft-note">Public room bring-in is stubbed to spawn placeholder props into the real public-room zone from <code>layout.json</code>. Next hook: swap this list to live public catalog listings.</p>
      <label class="workshop-field">
        <span>Bring into public room</span>
        <select class="workshop-select" data-workshop-bring-in-select>
          <option value="">Choose something to bring in</option>
          ${PLACE_PRESETS.map((preset) => `
            <option value="${esc(preset.id)}"${selectedPlacePreset === preset.id ? " selected" : ""}>${esc(preset.label)} — ${esc(preset.summary)}</option>
          `).join("")}
        </select>
      </label>
      <div class="workshop-inline-actions">
        <button type="button" class="btn accent btn-compact" data-workshop-place${selectedPlacePreset ? "" : " disabled"}>Bring into public room</button>
        <button type="button" class="btn secondary btn-compact" data-workshop-view-public>Look at public room bay</button>
        <button type="button" class="btn secondary btn-compact" data-workshop-clear-selection>Clear selection</button>
      </div>
      <p class="muted small">${selectedThingLabel() ? `${esc(selectedThingLabel())} is selected in the warehouse.` : "Choose a bring-in item, then click the floor or use the button to drop it into the public room."}</p>
    `;
  }

  function renderGodView() {
    const bays = warehouseFloor.listBays();
    const props = warehouseFloor.listEditableProps();
    return `
      <p class="muted small workshop-soft-note">God View frames the warehouse layout from the refreshed sandbox floor pack. Wiring is the one live training bay for this MVP.</p>
      <div class="workshop-zone-grid">
        ${bays.map((bay) => `
          <article class="workshop-card workshop-zone-card${bay.active ? " workshop-zone-card--active" : ""}">
            <div class="workshop-card-head">
              <strong>${esc(bay.label)}</strong>
              <span class="workshop-pill">${esc(bay.purpose || bay.kind || "bay")}</span>
            </div>
            <p>${esc(
              bay.id === "bay_wiring"
                ? "Live MVP training bay. Opens the existing Wiring Simulator."
                : bay.id === "bay_public_pods"
                  ? "Bring-in zone for public room items."
                  : bay.id === "bay_robot_sim"
                    ? "Reserved for later; outlined from the refreshed layout only."
                    : "Conference / operator space from the refreshed layout."
            )}</p>
            <div class="workshop-inline-actions">
              <button type="button" class="btn secondary btn-compact" data-workshop-focus-bay="${esc(bay.id)}">Frame bay</button>
              ${bay.id === "bay_wiring"
                ? `<button type="button" class="btn accent btn-compact" data-workshop-open-wiring>Open Wiring Simulator</button>`
                : ""}
            </div>
          </article>
        `).join("")}
      </div>
      <div class="workshop-zone-meta">
        <strong>Editable wall shells</strong>
        <ul class="workshop-zone-list">
          ${props.map((prop) => `<li>${esc(prop.label)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  function projectCards(items = [], kind = "generic") {
    if (!items.length) return `<p class="muted small">No ${kind} items queued right now.</p>`;
    return items.map((item) => `
      <article class="workshop-card">
        <div class="workshop-card-head">
          <strong>${esc(item.title || item.label || "Untitled")}</strong>
          ${item.status ? `<span class="workshop-pill">${esc(item.status)}</span>` : ""}
        </div>
        <p>${esc(item.summary || item.detail || "")}</p>
      </article>
    `).join("");
  }

  function renderAgents(showNote = false) {
    const agents = Array.isArray(workshopState.agents) ? workshopState.agents : [];
    if (!agents.length) return `<p class="muted small">No room agents online yet.</p>`;
    const note = showNote && workshopState.agents_source !== "live"
      ? `<p class="muted small workshop-soft-note">Example room activity is shown until a live room feed is connected.</p>`
      : "";
    return `${note}${agents.map((agent) => `
      <article class="workshop-card workshop-agent-card">
        <div class="workshop-card-head">
          <strong>${esc(agent.name || agent.id || "Agent")}</strong>
          <span class="workshop-pill">${esc(agent.status || "Ready")}</span>
        </div>
        <ul class="workshop-task-list">
          ${(Array.isArray(agent.tasks) ? agent.tasks : []).map((task) => `
            <li>
              <span>${esc(task.title || task.name || "Task")}</span>
              <em>${esc(task.status || "queued")}</em>
            </li>
          `).join("")}
        </ul>
      </article>
    `).join("")}`;
  }

  function renderQueue() {
    const queue = Array.isArray(workshopState.queue) ? workshopState.queue : [];
    if (!queue.length) return `<p class="muted small">No queue items yet.</p>`;
    return queue.map((row) => `
      <article class="workshop-card workshop-queue-card workshop-queue-card--${esc(String(row.status || "waiting").toLowerCase())}">
        <div class="workshop-card-head">
          <strong>${esc(row.label || row.title || row.id || "Queue item")}</strong>
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
      ${workshopState.debug?.hook_available
        ? `<p class="muted small">Live debug handoff is connected for this room.</p>`
        : `<p class="muted small">No live debug harness is connected, so requests are saved here for the next run.</p>`}
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

  function renderBody() {
    if (activeTopTab === "projects") {
      return `
        <div class="workshop-subtabs" role="tablist" aria-label="Workshop project tabs">
          <button type="button" class="workshop-subtab${activeProjectTab === "create" ? " active" : ""}" data-workshop-project-tab="create">Create</button>
          <button type="button" class="workshop-subtab${activeProjectTab === "train" ? " active" : ""}" data-workshop-project-tab="train">Train</button>
          <button type="button" class="workshop-subtab${activeProjectTab === "approvals" ? " active" : ""}" data-workshop-project-tab="approvals">Approvals</button>
        </div>
        <div class="workshop-panel-scroll">
          ${activeProjectTab === "create" ? projectCards(workshopState.projects?.create || [], "create") : ""}
          ${activeProjectTab === "train" ? projectCards(workshopState.projects?.train || [], "train") : ""}
          ${activeProjectTab === "approvals" ? (workshopState.approvals || []).map((item) => `
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
          `).join("") : ""}
        </div>
      `;
    }

    if (activeTopTab === "lab") {
      return `
        <div class="workshop-subtabs" role="tablist" aria-label="Workshop lab tabs">
          <button type="button" class="workshop-subtab${activeLabTab === "agents" ? " active" : ""}" data-workshop-lab-tab="agents">Manage Agents</button>
          <button type="button" class="workshop-subtab${activeLabTab === "queue" ? " active" : ""}" data-workshop-lab-tab="queue">Queue</button>
          <button type="button" class="workshop-subtab${activeLabTab === "debug" ? " active" : ""}" data-workshop-lab-tab="debug">Debug</button>
        </div>
        <div class="workshop-panel-scroll">
          ${activeLabTab === "agents" ? renderAgents(true) : ""}
          ${activeLabTab === "queue" ? renderQueue() : ""}
          ${activeLabTab === "debug" ? renderDebugRows() : ""}
        </div>
      `;
    }

    return `
      <div class="workshop-subtabs" role="tablist" aria-label="Workshop editor tabs">
        <button type="button" class="workshop-subtab${activeEditorTab === "public" ? " active" : ""}" data-workshop-editor-tab="public">Public room</button>
        <button type="button" class="workshop-subtab${activeEditorTab === "voice" ? " active" : ""}" data-workshop-editor-tab="voice">Voice Prompt</button>
        <button type="button" class="workshop-subtab${activeEditorTab === "god" ? " active" : ""}" data-workshop-editor-tab="god">God View</button>
      </div>
      <div class="workshop-panel-scroll">
        ${activeEditorTab === "public" ? renderPublicRoom() : ""}
        ${activeEditorTab === "voice" ? `
          <p class="muted small workshop-soft-note">This uses the same live dictation path as the main AI prompt, so words appear here while you speak.</p>
          <textarea id="${esc(dictationInputId)}" class="workshop-voice-input" rows="5" placeholder="Describe the next workshop step or placement...">${esc(voiceDraft)}</textarea>
          <div class="workshop-inline-actions">
            <button type="button" class="btn secondary btn-compact${pointerLocked ? " hidden" : ""}" data-workshop-dictate>Mic</button>
            <button type="button" class="btn secondary btn-compact" data-workshop-copy-prompt>Use in AI prompt</button>
            <button type="button" class="btn accent btn-compact" data-workshop-run-prompt>Run in AI prompt</button>
          </div>
        ` : ""}
        ${activeEditorTab === "god" ? renderGodView() : ""}
      </div>
    `;
  }

  function bindRootEvents() {
    root.querySelectorAll("[data-workshop-top-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTopTab = btn.getAttribute("data-workshop-top-tab") || "editor";
        render();
      });
    });
    root.querySelectorAll("[data-workshop-editor-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeEditorTab = btn.getAttribute("data-workshop-editor-tab") || "public";
        warehouseFloor.setActiveBay(activeEditorTab === "god" ? "bay_wiring" : "bay_public_pods");
        render();
      });
    });
    root.querySelectorAll("[data-workshop-project-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeProjectTab = btn.getAttribute("data-workshop-project-tab") || "create";
        render();
      });
    });
    root.querySelectorAll("[data-workshop-lab-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeLabTab = btn.getAttribute("data-workshop-lab-tab") || "agents";
        render();
      });
    });
    root.querySelector("[data-workshop-exit]")?.addEventListener("click", () => exit());
    root.querySelector("[data-workshop-look]")?.addEventListener("click", async () => {
      if (pointerLocked) {
        document.exitPointerLock?.();
        return;
      }
      try {
        await renderer.domElement.requestPointerLock?.();
      } catch {
        setStatus?.("error", "Mouse look is not available here.");
      }
    });
    root.querySelector("[data-workshop-bring-in-select]")?.addEventListener("change", (event) => {
      selectedPlacePreset = String(event.target?.value || "");
      warehouseFloor.setActiveBay("bay_public_pods");
      render();
    });
    root.querySelector("[data-workshop-place]")?.addEventListener("click", () => placeSelectedPreset());
    root.querySelector("[data-workshop-view-public]")?.addEventListener("click", () => {
      if (focusBay("bay_public_pods")) {
        setStatus?.("ok", "Focused the public room bring-in zone.");
      }
    });
    root.querySelector("[data-workshop-clear-selection]")?.addEventListener("click", () => {
      clearWorkshopSelection();
    });
    root.querySelectorAll("[data-workshop-focus-bay]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const bayId = btn.getAttribute("data-workshop-focus-bay") || "";
        if (focusBay(bayId, { topDown: true })) {
          setStatus?.("ok", "God View framed the selected bay.");
        }
      });
    });
    root.querySelector("[data-workshop-open-wiring]")?.addEventListener("click", async () => {
      try {
        await openWiringWorkspace?.();
      } catch (err) {
        setStatus?.("error", err?.message || "Could not open the Wiring Simulator.");
      }
    });
    root.querySelectorAll("[data-workshop-approve]").forEach((btn) => {
      btn.addEventListener("click", () => approveItem(btn.getAttribute("data-workshop-approve")));
    });
    root.querySelectorAll("[data-workshop-debug]").forEach((btn) => {
      btn.addEventListener("click", () => runDebugRow(btn.getAttribute("data-workshop-debug")));
    });
    dictationBtn = root.querySelector("[data-workshop-dictate]");
    root.querySelector("[data-workshop-dictate]")?.addEventListener("click", async () => {
      await toggleDictation?.(dictationInputId, dictationBtn);
    });
    root.querySelector(`#${CSS.escape(dictationInputId)}`)?.addEventListener("input", (event) => {
      voiceDraft = event.target?.value || "";
    });
    root.querySelector("[data-workshop-copy-prompt]")?.addEventListener("click", () => copyVoicePrompt({ submit: false }));
    root.querySelector("[data-workshop-run-prompt]")?.addEventListener("click", () => copyVoicePrompt({ submit: true }));
  }

  function render() {
    const canOpen = !!String(getProjectId?.() || "").trim();
    launcher.hidden = active;
    launcher.disabled = !canOpen;
    launcher.title = canOpen ? "Open the Workshop desktop scene" : "Open a project first";
    root.hidden = !active;
    root.classList.toggle("hidden", !active);
    reticle.hidden = !(active && pointerLocked);
    reticle.classList.toggle("hidden", !(active && pointerLocked));
    if (!active) return;
    const projectName = workshopState.project_label || currentProjectName();
    root.innerHTML = `
      <div class="workshop-shell-card">
        <div class="workshop-shell-head">
          <div>
            <span class="workshop-kicker">Workshop</span>
            <h2>${esc(projectName)}</h2>
            <p>Warehouse MVP active · public bring-in + one wiring training bay · Route ${esc(WORKSHOP_HASH)}</p>
          </div>
          <div class="workshop-shell-actions">
            <button type="button" class="btn secondary btn-compact" data-workshop-look>${pointerLocked ? "Exit mouse look" : "Mouse look"}</button>
            <button type="button" class="btn secondary btn-compact" data-workshop-exit>Back to Studio</button>
          </div>
        </div>
        <div class="workshop-top-tabs" role="tablist" aria-label="Workshop">
          <button type="button" class="workshop-top-tab${activeTopTab === "editor" ? " active" : ""}" data-workshop-top-tab="editor">Editor</button>
          <button type="button" class="workshop-top-tab${activeTopTab === "projects" ? " active" : ""}" data-workshop-top-tab="projects">Project</button>
          <button type="button" class="workshop-top-tab${activeTopTab === "lab" ? " active" : ""}" data-workshop-top-tab="lab">Studio Lab</button>
        </div>
        ${workshopError ? `<div class="workshop-inline-error">${esc(workshopError)}</div>` : ""}
        ${renderBody()}
        <div class="workshop-footnote">
          <span>WASD walk</span>
          <span>Mouse look</span>
          <span>Public room bring-in</span>
          <span>Wiring training bay</span>
          <span>Drag walls/items to move</span>
        </div>
      </div>
    `;
    bindRootEvents();
  }

  function updatePointerFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function handlePointerDown(event) {
    if (!active) return;
    if (event.target?.closest?.(".workshop-shell")) return;
    lastPointerEvent = event;
    updatePointerFromEvent(event);
    if (pointerLocked) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    raycaster.setFromCamera(pointerNdc, camera);
    const sceneHits = raycaster.intersectObjects([
      ...placedGroup.children,
      ...warehouseFloor.listEditableProps().map((entry) => warehouseFloor.getEditableMesh(entry.id)).filter(Boolean),
    ], true);
    if (sceneHits[0]?.object && selectPlacedMeshFromHit(sceneHits[0].object)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }

  function handlePointerMove(event) {
    if (!active) return;
    if (pointerLocked) {
      lookState.yaw -= (event.movementX || 0) * 0.0028;
      lookState.pitch = clamp(lookState.pitch - (event.movementY || 0) * 0.0022, -1.12, 0.7);
      applyLook();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    lastPointerEvent = event;
    updatePointerFromEvent(event);
  }

  function handleCanvasClick(event) {
    if (!active) return;
    if (event.target?.closest?.(".workshop-shell")) return;
    if (pointerLocked) {
      if (activeTopTab === "editor" && activeEditorTab === "public") placeSelectedPreset();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    updatePointerFromEvent(event);
    raycaster.setFromCamera(pointerNdc, camera);
    const pcHit = raycaster.intersectObjects([pcMonitor, pcScreen], false)[0];
    if (pcHit) {
      activeTopTab = "editor";
      activeEditorTab = "public";
      setStatus?.("ok", "Workshop editor ready.");
      render();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const sceneHits = raycaster.intersectObjects([
      ...placedGroup.children,
      ...warehouseFloor.listEditableProps().map((entry) => warehouseFloor.getEditableMesh(entry.id)).filter(Boolean),
    ], true);
    if (sceneHits[0]?.object && selectPlacedMeshFromHit(sceneHits[0].object)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (activeTopTab === "editor" && activeEditorTab === "public") {
      placeSelectedPreset();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handleKeyDown(event) {
    if (!active) return;
    const tag = String(event.target?.tagName || "").toLowerCase();
    const inField = tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable;
    if (event.key === "Escape" && pointerLocked) {
      document.exitPointerLock?.();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!inField) {
      keysDown.add(event.code);
      if (event.code === "KeyL") {
        try { renderer.domElement.requestPointerLock?.(); } catch (_) {}
      }
    }
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyL", "Escape"].includes(event.code)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handleKeyUp(event) {
    if (!active) return;
    keysDown.delete(event.code);
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function syncTransformSelection() {
    const obj = transformControls.object;
    if (!active || !obj) return;
    if (obj.userData?.workshopWarehousePropId) {
      warehouseFloor.syncEditableTransform(obj);
      return;
    }
    if (!obj.userData?.workshopItemId) return;
    const item = placedItems.find((entry) => entry.id === obj.userData.workshopItemId);
    if (!item) return;
    item.position = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
    item.rotation = { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
    savePlacedItems();
  }

  async function enter() {
    if (active) return;
    if (!String(getProjectId?.() || "").trim()) {
      setStatus?.("error", "Open a project before entering the Workshop.");
      return;
    }
    clearStudioSelection?.();
    controls.enabled = false;
    active = true;
    activeTopTab = "editor";
    activeEditorTab = "public";
    selectedPlacePreset = "";
    lastDebugResult = null;
    document.body.classList.add("workshop-mode-active");
    enterCameraPose();
    showWorkshopRoom();
    await syncWarehouseRoom();
    await loadWorkshopState(true);
    focusBay("bay_public_pods");
    updateRoute(true);
    setStatus?.("ok", "Workshop warehouse MVP active.");
    render();
  }

  function exit({ keepRoute = false } = {}) {
    if (!active) return;
    active = false;
    pointerLocked = false;
    keysDown.clear();
    document.exitPointerLock?.();
    document.body.classList.remove("workshop-mode-active");
    transformControls.detach();
    selectedItemId = "";
    selectedWarehousePropId = "";
    controls.enabled = true;
    hideWorkshopRoom();
    restoreCameraPose();
    if (!keepRoute) updateRoute(false);
    render();
    setStatus?.("ok", "Back in Studio view.");
  }

  function update() {
    if (!active) return;
    const now = performance.now();
    const dt = lastFrameMs ? Math.min(0.05, (now - lastFrameMs) / 1000) : 0.016;
    lastFrameMs = now;
    const speed = keysDown.has("ShiftLeft") || keysDown.has("ShiftRight") ? 6.2 : 3.2;
    const forward = (keysDown.has("KeyW") || keysDown.has("ArrowUp") ? 1 : 0) - (keysDown.has("KeyS") || keysDown.has("ArrowDown") ? 1 : 0);
    const strafe = (keysDown.has("KeyD") || keysDown.has("ArrowRight") ? 1 : 0) - (keysDown.has("KeyA") || keysDown.has("ArrowLeft") ? 1 : 0);
    if (forward || strafe) {
      const moveForward = new THREE.Vector3(Math.cos(lookState.yaw), Math.sin(lookState.yaw), 0);
      const moveRight = new THREE.Vector3(-Math.sin(lookState.yaw), Math.cos(lookState.yaw), 0);
      camera.position.addScaledVector(moveForward, forward * speed * dt);
      camera.position.addScaledVector(moveRight, strafe * speed * dt);
      camera.position.x = clamp(camera.position.x, workshopBounds.minX, workshopBounds.maxX);
      camera.position.y = clamp(camera.position.y, workshopBounds.minY, workshopBounds.maxY);
    }
    camera.position.z = 1.72;
    applyLook();
    controls.target.copy(camera.position).add(new THREE.Vector3(Math.cos(lookState.yaw), Math.sin(lookState.yaw), 0));
    raycaster.setFromCamera(pointerLocked ? new THREE.Vector2(0, 0) : pointerNdc, camera);
    updatePreviewMesh();
  }

  function setProjectContext() {
    const nextId = String(getProjectId?.() || "").trim();
    if (nextId === activeProjectId) return;
    activeProjectId = nextId;
    voiceDraft = "";
    loadPlacedItems(nextId);
    rebuildPlacedScene();
    if (active) {
      workshopState = normalizeWorkshopState(workshopState, currentProjectName());
      void syncWarehouseRoom();
      loadWorkshopState(true);
    } else if (window.location.hash === WORKSHOP_HASH && nextId) {
      void enter();
    } else {
      render();
    }
  }

  launcher.addEventListener("click", () => {
    if (active) return;
    void enter();
  });

  renderer.domElement.addEventListener("pointerdown", handlePointerDown, true);
  renderer.domElement.addEventListener("pointermove", handlePointerMove, true);
  renderer.domElement.addEventListener("click", handleCanvasClick, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keyup", handleKeyUp, true);
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    render();
  });
  window.addEventListener("hashchange", () => {
    if (window.location.hash === WORKSHOP_HASH) {
      if (!active) void enter();
      return;
    }
    if (active) exit({ keepRoute: true });
  });
  transformControls.addEventListener("objectChange", syncTransformSelection);

  render();
  if (window.location.hash === WORKSHOP_HASH && String(getProjectId?.() || "").trim()) {
    void enter();
  }

  return {
    enter,
    exit,
    isActive() {
      return active;
    },
    update,
    setProjectContext,
  };
}
