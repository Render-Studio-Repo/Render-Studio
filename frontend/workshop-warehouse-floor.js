import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const SESSION_ID = "warehouse-mvp";
const SESSION_PREFIX = `/api/sandbox-sessions/${SESSION_ID}`;
const LAYOUT_URL = `${SESSION_PREFIX}/layout.json`;
const TRANSFORM_LS_KEY = `render3d:workshop-warehouse-props:v1:${SESSION_ID}`;

const ZONE_STYLES = {
  bringIn: { line: 0x38bdf8, fill: 0x0f3d63, textBg: "#0b2234", textFg: "#dff6ff" },
  training: { line: 0xf59e0b, fill: 0x4a2a00, textBg: "#351f08", textFg: "#ffe8bd" },
  conference: { line: 0x10b981, fill: 0x053d2f, textBg: "#072d26", textFg: "#dbfff4" },
  muted: { line: 0x64748b, fill: 0x17212e, textBg: "#101927", textFg: "#d6deea" },
  active: { line: 0xf8fafc, fill: 0x1d4ed8, textBg: "#123a8a", textFg: "#ffffff" },
};

function readTransformMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(TRANSFORM_LS_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeTransformMap(map) {
  try {
    localStorage.setItem(TRANSFORM_LS_KEY, JSON.stringify(map || {}));
  } catch {
    /* ignore */
  }
}

function normalizedRect(rect = {}) {
  const xs = Array.isArray(rect.x) ? rect.x : [];
  const zs = Array.isArray(rect.z) ? rect.z : [];
  const x0 = Number(xs[0]);
  const x1 = Number(xs[1]);
  const z0 = Number(zs[0]);
  const z1 = Number(zs[1]);
  if (![x0, x1, z0, z1].every(Number.isFinite)) return null;
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minZ = Math.min(z0, z1);
  const maxZ = Math.max(z0, z1);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    minY: -maxZ,
    maxY: -minZ,
    width: Math.max(0.01, maxX - minX),
    depth: Math.max(0.01, maxZ - minZ),
    centerX: (minX + maxX) * 0.5,
    centerY: (-(minZ + maxZ)) * 0.5,
  };
}

function labelTextForBay(bay = {}) {
  const id = String(bay.id || "");
  if (id === "bay_wiring") return "Wiring training bay";
  if (id === "bay_public_pods") return "Public room bring-in";
  if (id === "bay_meetings") return "Meetings bay";
  if (id === "bay_robot_sim") return "Robot sim reserve";
  return String(bay.label || bay.kind || bay.id || "Bay");
}

function styleKeyForBay(bay = {}) {
  const id = String(bay.id || "");
  if (id === "bay_public_pods") return "bringIn";
  if (id === "bay_wiring") return "training";
  if (id === "bay_meetings") return "conference";
  return "muted";
}

function makeLabelSprite(text, { bg = "#111827", fg = "#f8fafc" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 220;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = bg;
  roundRect(ctx, 24, 30, canvas.width - 48, canvas.height - 60, 42);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = "700 82px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(text || "").slice(0, 36), canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6.8, 1.46, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function fetchScene(url, authHeaders) {
  const res = await fetch(url, { headers: typeof authHeaders === "function" ? authHeaders() : {} });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status}).`);
  const blobUrl = URL.createObjectURL(await res.blob());
  try {
    const gltf = await new GLTFLoader().loadAsync(blobUrl);
    return gltf.scene;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function tuneScene(node, { receiveShadow = true } = {}) {
  node?.traverse?.((child) => {
    if (!child?.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = receiveShadow;
  });
}

function setStudioOrientation(node) {
  if (!node) return;
  node.rotation.x = Math.PI / 2;
}

export function createWorkshopWarehouseFloor(options = {}) {
  const { parent, authHeaders, setStatus } = options;
  if (!parent) throw new Error("Workshop warehouse floor needs a parent group.");

  const root = new THREE.Group();
  root.name = "workshop-warehouse-floor";
  root.visible = false;
  parent.add(root);

  const floorGroup = new THREE.Group();
  floorGroup.name = "workshop-warehouse-floor-mesh";
  root.add(floorGroup);

  const shellGroup = new THREE.Group();
  shellGroup.name = "workshop-warehouse-shells";
  root.add(shellGroup);

  const zoneGroup = new THREE.Group();
  zoneGroup.name = "workshop-warehouse-zones";
  root.add(zoneGroup);

  let loadPromise = null;
  let layout = null;
  let activeBayId = "bay_public_pods";
  const baysById = new Map();
  const propMeshes = new Map();

  function clearGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse?.((node) => {
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) node.material.forEach((mat) => mat?.dispose?.());
        else node.material?.dispose?.();
        node.material?.map?.dispose?.();
      });
    }
  }

  function clearLoaded() {
    clearGroup(floorGroup);
    clearGroup(shellGroup);
    clearGroup(zoneGroup);
    baysById.clear();
    propMeshes.clear();
  }

  function bayRectList() {
    return Array.isArray(layout?.bays) ? layout.bays : [];
  }

  function bayData(entry = {}) {
    const rect = normalizedRect(entry.rect_m || {});
    if (!rect) return null;
    return {
      id: String(entry.id || ""),
      kind: String(entry.kind || ""),
      purpose: String(entry.purpose || ""),
      label: labelTextForBay(entry),
      rect,
    };
  }

  function updateBayStyles() {
    baysById.forEach((entry, id) => {
      const active = id === activeBayId;
      const palette = active ? ZONE_STYLES.active : entry.palette;
      entry.outline.material.color.setHex(palette.line);
      entry.outline.material.opacity = active ? 0.95 : 0.72;
      entry.fill.material.color.setHex(palette.fill);
      entry.fill.material.opacity = active ? 0.17 : 0.1;
      if (entry.labelSprite?.material) entry.labelSprite.material.opacity = active ? 1 : 0.9;
    });
  }

  function buildZone(bay) {
    const palette = ZONE_STYLES[styleKeyForBay(bay)] || ZONE_STYLES.muted;
    const group = new THREE.Group();
    group.name = `workshop-bay-${bay.id}`;

    const points = [
      new THREE.Vector3(bay.rect.minX, bay.rect.minY, 0.04),
      new THREE.Vector3(bay.rect.maxX, bay.rect.minY, 0.04),
      new THREE.Vector3(bay.rect.maxX, bay.rect.maxY, 0.04),
      new THREE.Vector3(bay.rect.minX, bay.rect.maxY, 0.04),
      new THREE.Vector3(bay.rect.minX, bay.rect.minY, 0.04),
    ];
    const outline = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: palette.line, transparent: true, opacity: 0.72 })
    );
    outline.renderOrder = 20;
    group.add(outline);

    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(bay.rect.width, bay.rect.depth),
      new THREE.MeshBasicMaterial({
        color: palette.fill,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    fill.position.set(bay.rect.centerX, bay.rect.centerY, 0.02);
    group.add(fill);

    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(bay.rect.width, bay.rect.depth),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.001,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    surface.position.copy(fill.position);
    surface.name = `workshop-bay-surface-${bay.id}`;
    surface.userData.workshopZoneSurface = bay.id;
    group.add(surface);

    if (bay.id !== "bay_robot_sim") {
      const labelSprite = makeLabelSprite(bay.label, { bg: palette.textBg, fg: palette.textFg });
      labelSprite.position.set(bay.rect.centerX, bay.rect.centerY, 2.1);
      labelSprite.renderOrder = 30;
      group.add(labelSprite);
      baysById.set(bay.id, { ...bay, group, outline, fill, labelSprite, surface, palette });
    } else {
      baysById.set(bay.id, {
        ...bay,
        group,
        outline,
        fill,
        labelSprite: new THREE.Object3D(),
        surface,
        palette,
      });
    }
    zoneGroup.add(group);
  }

  function applySavedTransform(group, id) {
    const saved = readTransformMap()[id];
    if (!saved) return;
    const pos = saved.position || {};
    const rot = saved.rotation || {};
    group.position.set(Number(pos.x) || 0, Number(pos.y) || 0, Number(pos.z) || 0);
    group.rotation.set(Number(rot.x) || 0, Number(rot.y) || 0, Number(rot.z) || 0);
  }

  async function ensureLoaded() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const res = await fetch(LAYOUT_URL, { headers: typeof authHeaders === "function" ? authHeaders() : {} });
      if (!res.ok) throw new Error(`Could not load warehouse layout (${res.status}).`);
      layout = await res.json();
      clearLoaded();

      const floorMesh = String(layout?.walkable_floor?.mesh || "").trim();
      if (floorMesh) {
        const floorScene = await fetchScene(`${SESSION_PREFIX}/${encodeURIComponent(floorMesh)}`, authHeaders);
        floorScene.name = "workshop-warehouse-floor-asset";
        setStudioOrientation(floorScene);
        tuneScene(floorScene);
        floorGroup.add(floorScene);
      }

      for (const shell of Array.isArray(layout?.wall_shells) ? layout.wall_shells : []) {
        const meshName = String(shell?.mesh || "").trim();
        const shellId = String(shell?.id || meshName.replace(/\.[^.]+$/, "") || "wall-shell");
        if (!meshName) continue;
        const shellRoot = new THREE.Group();
        shellRoot.name = `workshop-warehouse-prop-${shellId}`;
        shellRoot.userData.workshopWarehousePropId = shellId;
        shellRoot.userData.workshopWarehousePropLabel = shellId.replace(/[_-]+/g, " ");
        shellRoot.userData.workshopWarehouseEditable = shell?.editable_vr !== false;
        applySavedTransform(shellRoot, shellId);
        const shellScene = await fetchScene(`${SESSION_PREFIX}/${encodeURIComponent(meshName)}`, authHeaders);
        shellScene.name = meshName;
        setStudioOrientation(shellScene);
        tuneScene(shellScene);
        shellRoot.add(shellScene);
        shellGroup.add(shellRoot);
        propMeshes.set(shellId, shellRoot);
      }

      for (const entry of bayRectList()) {
        const bay = bayData(entry);
        if (bay) buildZone(bay);
      }
      updateBayStyles();
      return layout;
    })().catch((err) => {
      loadPromise = null;
      setStatus?.("error", err?.message || "Could not load warehouse floor.");
      throw err;
    });
    return loadPromise;
  }

  function getWalkBounds() {
    const size = Array.isArray(layout?.walkable_floor?.size_m) ? layout.walkable_floor.size_m : [20, 30];
    const width = Math.max(2, Number(size[0]) || 20);
    const depth = Math.max(2, Number(size[1]) || 30);
    return {
      minX: -(width * 0.5) + 0.5,
      maxX: width * 0.5 - 0.5,
      minY: -(depth * 0.5) + 0.5,
      maxY: depth * 0.5 - 0.5,
    };
  }

  function getPlacementSurfaces() {
    const zone = baysById.get("bay_public_pods");
    return zone?.surface ? [zone.surface] : [];
  }

  function getBay(id) {
    return baysById.get(id) || null;
  }

  function listBays() {
    return [...baysById.values()].map((bay) => ({
      id: bay.id,
      label: bay.label,
      kind: bay.kind,
      purpose: bay.purpose,
      rect: { ...bay.rect },
      active: bay.id === activeBayId,
    }));
  }

  function setActiveBay(id) {
    if (!baysById.has(id)) return false;
    activeBayId = id;
    updateBayStyles();
    return true;
  }

  function getEditableMesh(id) {
    return propMeshes.get(String(id || "")) || null;
  }

  function listEditableProps() {
    return [...propMeshes.entries()].map(([id, mesh]) => ({
      id,
      label: String(mesh.userData?.workshopWarehousePropLabel || id),
      editable: mesh.userData?.workshopWarehouseEditable !== false,
    }));
  }

  function syncEditableTransform(mesh) {
    const id = String(mesh?.userData?.workshopWarehousePropId || "").trim();
    if (!id) return false;
    const saved = readTransformMap();
    saved[id] = {
      position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
    };
    writeTransformMap(saved);
    return true;
  }

  return {
    ensureLoaded,
    setVisible(visible) {
      root.visible = !!visible;
    },
    isLoaded() {
      return !!layout;
    },
    getWalkBounds,
    getPlacementSurfaces,
    getBay,
    listBays,
    setActiveBay,
    getEditableMesh,
    listEditableProps,
    syncEditableTransform,
  };
}
