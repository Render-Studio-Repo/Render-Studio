/**
 * Quest AR/VR — reliable CAD viewing
 *
 * - Transparent passthrough (alpha canvas)
 * - Always place model in front of your headset (full gaze direction)
 * - Do NOT reparent the assembly (avoids disappearing CAD)
 * - Left-controller tool dock follows the grip every frame
 * - Gamepad trigger polling (Quest buttons) + select events
 * - Saves last room pose; restores when you re-enter AR
 */

import * as THREE from "three";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";

const LS_POSE = "render3d:xr-room-pose";
const LS_SPAWN = "render3d:xr-spawn-preset";

const SPAWN_PRESETS = [
  { id: "eye", label: "In front of you", distance: 0.7, sizeM: 0.2 },
  { id: "near", label: "Near (arm)", distance: 0.45, sizeM: 0.14 },
  { id: "far", label: "Farther", distance: 1.2, sizeM: 0.25 },
  { id: "floor", label: "Lower / floor", distance: 0.9, sizeM: 0.2, yMode: "floor" },
];

const DOCK_TOOLS = [
  { id: "grab", label: "Move", color: 0x3b82f6, glyph: "Mv" },
  { id: "rotate", label: "Rotate", color: 0xf97316, glyph: "Ro" },
  { id: "front", label: "Front", color: 0xa78bfa, glyph: "Fr" },
  { id: "restore", label: "Saved", color: 0x22c55e, glyph: "Sv" },
  { id: "zoom_in", label: "Zoom+", color: 0x14b8a6, glyph: "+" },
  { id: "zoom_out", label: "Zoom-", color: 0x0ea5e9, glyph: "-" },
  { id: "place", label: "Place", color: 0xc084fc, glyph: "Pl" },
  { id: "measure", label: "Measure", color: 0xf59e0b, glyph: "Me" },
  { id: "exit", label: "Exit", color: 0xef4444, glyph: "X" },
];

function makeIconTexture(glyph, bgHex, label) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = new THREE.Color(bgHex);
  ctx.fillStyle = `#${c.getHexString()}`;
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // ASCII only — emoji often blank on Quest WebGL canvases
  const ascii = String(glyph || "?").replace(/[^\x20-\x7E]/g, "").slice(0, 2) || "?";
  ctx.font = "bold 110px Arial,sans-serif";
  ctx.fillText(ascii, 128, label ? 108 : 128);
  if (label) {
    ctx.font = "bold 36px Arial,sans-serif";
    ctx.fillText(String(label).slice(0, 8), 128, 188);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function drawPanelCanvas(title, lines, footer = "") {
  const width = 1024;
  const height = 700;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(15,23,42,0.94)";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(30,41,59,1)";
  ctx.fillRect(0, 0, width, 100);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 44px system-ui,sans-serif";
  ctx.fillText(title, 36, 64);
  ctx.font = "36px system-ui,sans-serif";
  lines.forEach((line, i) => {
    const y = 150 + i * 56;
    ctx.fillStyle = i % 2 ? "rgba(51,65,85,0.4)" : "transparent";
    ctx.fillRect(20, y - 34, width - 40, 50);
    ctx.fillStyle = line.active ? "#7dd3fc" : "#f1f5f9";
    ctx.fillText(String(line.label || "").slice(0, 40), 40, y);
  });
  if (footer) {
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 30px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(footer, width / 2, height - 36);
  }
  return canvas;
}

export function createViewportXR(opts) {
  const {
    renderer,
    scene,
    camera,
    controls,
    transformControls = null,
    getMeshRoot,
    getMmPerUnit,
    formatLength,
    onPresentingChange = null,
    fitCamera = null,
    buttonEl = null,
    spawnModalEl = null,
    hideSceneChrome = null,
    restoreSceneChrome = null,
    getPoseStorageKey = null,
  } = opts;

  let supported = false;
  let sessionMode = "immersive-ar";
  let session = null;
  let presenting = false;
  let activeTool = "grab";
  let userZoom = 1;
  let baseScale = 1;
  let presentationScale = 1;
  let activeSpawnId = "eye";

  const xrHud = new THREE.Group();
  xrHud.name = "xrHud";
  xrHud.visible = false;
  xrHud.frustumCulled = false;
  scene.add(xrHud);

  // Dedicated lights so CAD PBR materials aren't black in AR
  const hemi = new THREE.HemisphereLight(0xffffff, 0x556677, 1.35);
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(0.4, 1.2, 0.6);
  const fill = new THREE.DirectionalLight(0xaaccff, 0.7);
  fill.position.set(-0.8, 0.4, -0.3);
  xrHud.add(hemi, key, fill);

  // Always-on probe so we can tell if XR is drawing anything at all
  const faceProbe = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.16, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, depthTest: false }),
  );
  faceProbe.name = "xrFaceProbe";
  faceProbe.renderOrder = 5000;
  faceProbe.frustumCulled = false;
  xrHud.add(faceProbe);
  // Axis helper next to probe
  const probeAxes = new THREE.AxesHelper(0.18);
  probeAxes.frustumCulled = false;
  faceProbe.add(probeAxes);

  const controllers = [];
  const grips = [];
  const hands = [];
  const raycaster = new THREE.Raycaster();
  const _headPos = new THREE.Vector3();
  const _headQuat = new THREE.Quaternion();
  const _fwd = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _mat = new THREE.Matrix4();

  let saved = null; // { mesh, pos, quat, scale, parent }
  let grabState = null;
  let panelDrag = null;
  let placePanel = null;
  let beacon = null;
  let savedBackground = null;
  let savedFog = null;
  let savedShadowMap = null;
  let savedNear = null;
  let savedFar = null;
  let frustumBackup = [];

  // Measure
  const measureGroup = new THREE.Group();
  xrHud.add(measureGroup);
  const measurePoints = [];
  let measureLine = null;
  let measureLabel = null;

  // Head-locked tool dock — huge solid discs (canvas overlays optional)
  const dock = new THREE.Group();
  dock.name = "xrToolDock";
  dock.visible = false;
  dock.frustumCulled = false;
  dock.renderOrder = 10000;
  const dockButtons = [];
  const BTN_R = 0.065;
  const BTN_GAP = 0.14;
  DOCK_TOOLS.forEach((tool, i) => {
    const btn = new THREE.Mesh(
      new THREE.CircleGeometry(BTN_R, 48),
      new THREE.MeshBasicMaterial({
        color: tool.color,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    btn.position.set(0, ((DOCK_TOOLS.length - 1) / 2 - i) * BTN_GAP, 0);
    btn.userData.xrTool = tool.id;
    btn.renderOrder = 10050;
    btn.frustumCulled = false;
    dock.add(btn);
    dockButtons.push(btn);
    const label = new THREE.Mesh(
      new THREE.CircleGeometry(BTN_R * 0.92, 48),
      new THREE.MeshBasicMaterial({
        map: makeIconTexture(tool.glyph, tool.color, tool.label),
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    label.position.copy(btn.position);
    label.position.z = 0.002;
    label.renderOrder = 10052;
    label.frustumCulled = false;
    label.raycast = () => {};
    dock.add(label);
    btn.userData.labelMesh = label;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(BTN_R + 0.004, BTN_R + 0.014, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    ring.position.copy(btn.position);
    ring.position.z = 0.003;
    ring.renderOrder = 10053;
    ring.frustumCulled = false;
    dock.add(ring);
    btn.userData.ring = ring;
  });
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, DOCK_TOOLS.length * BTN_GAP + 0.1),
    new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  );
  plate.position.z = -0.015;
  plate.renderOrder = 10040;
  plate.frustumCulled = false;
  dock.add(plate);
  xrHud.add(dock);

  const controllerModelFactory = new XRControllerModelFactory();
  const handModelFactory = new XRHandModelFactory();

  // Gamepad edge detection
  const prevTrigger = [false, false];

  function poseKey() {
    try {
      return (typeof getPoseStorageKey === "function" && getPoseStorageKey()) || LS_POSE;
    } catch {
      return LS_POSE;
    }
  }

  function saveRoomPose() {
    const mesh = getLiveMesh();
    if (!mesh || !presenting) return;
    const data = {
      position: mesh.position.toArray(),
      quaternion: mesh.quaternion.toArray(),
      scale: mesh.scale.toArray(),
      userZoom,
      activeSpawnId,
      at: Date.now(),
    };
    try {
      localStorage.setItem(poseKey(), JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  function loadRoomPose() {
    try {
      const raw = localStorage.getItem(poseKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getLiveMesh() {
    try {
      return getMeshRoot?.() || null;
    } catch {
      return null;
    }
  }

  function setButtonUi(on) {
    if (!buttonEl) return;
    buttonEl.classList.toggle("active", !!on);
    buttonEl.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function syncDock() {
    dockButtons.forEach((btn) => {
      const on = btn.userData.xrTool === activeTool;
      btn.scale.setScalar(on ? 1.15 : 1);
      if (btn.userData.ring) btn.userData.ring.material.opacity = on ? 0.95 : 0;
    });
  }

  function getHeadPose() {
    const xrCam = renderer.xr.getCamera?.();
    if (xrCam?.cameras?.[0]) {
      xrCam.cameras[0].getWorldPosition(_headPos);
      xrCam.cameras[0].getWorldQuaternion(_headQuat);
      return true;
    }
    if (xrCam) {
      xrCam.getWorldPosition(_headPos);
      xrCam.getWorldQuaternion(_headQuat);
      return true;
    }
    camera.getWorldPosition(_headPos);
    camera.getWorldQuaternion(_headQuat);
    return false;
  }

  /** Full gaze forward (includes pitch) — keeps model in your view. */
  function headForward(out = _fwd) {
    out.set(0, 0, -1).applyQuaternion(_headQuat).normalize();
    return out;
  }

  async function waitForHead(frames = 40) {
    for (let i = 0; i < frames; i += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      getHeadPose();
      if (_headPos.y > 0.4) return;
    }
    _headPos.set(0, 1.55, 0);
    _headQuat.identity();
  }

  function captureDesktop(mesh) {
    if (saved?.mesh === mesh) return;
    saved = {
      mesh,
      pos: mesh.position.clone(),
      quat: mesh.quaternion.clone(),
      scale: mesh.scale.clone(),
      parent: mesh.parent,
    };
  }

  function restoreDesktop() {
    if (!saved?.mesh) return;
    const { mesh, pos, quat, scale } = saved;
    const marker = mesh.getObjectByName("xrModelMarker");
    if (marker) {
      mesh.remove(marker);
      marker.geometry?.dispose?.();
      marker.material?.dispose?.();
    }
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    mesh.scale.copy(scale);
    mesh.updateMatrixWorld(true);
    for (const [obj, fc] of frustumBackup) {
      if (obj) obj.frustumCulled = fc;
    }
    frustumBackup = [];
    saved = null;
  }

  function prepareMeshesForXr(mesh) {
    frustumBackup = [];
    mesh.traverse((o) => {
      if (!o.isMesh) return;
      frustumBackup.push([o, o.frustumCulled]);
      o.frustumCulled = false;
      o.visible = true;
      // Lift very dark PBR so CAD isn't invisible in AR
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.emissive && m.emissiveIntensity != null && !m.userData._xrEmissiveBak) {
          m.userData._xrEmissiveBak = {
            color: m.emissive.clone(),
            intensity: m.emissiveIntensity,
          };
          m.emissive.setHex(0x555555);
          m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, 0.45);
        }
        if (m.metalness != null && m.metalness > 0.5 && m.userData._xrMetalBak == null) {
          m.userData._xrMetalBak = m.metalness;
          m.metalness = Math.min(m.metalness, 0.25);
        }
        if (m.envMapIntensity != null) {
          m.envMapIntensity = Math.max(m.envMapIntensity || 0, 0.8);
        }
        // Guaranteed unlit fallback for pitch-black CAD in AR
        if (!m.userData._xrColorBak && m.color) {
          m.userData._xrColorBak = m.color.clone();
          m.color.offsetHSL(0, 0, 0.08);
        }
      }
    });
  }

  function restoreMeshMaterials() {
    if (!saved?.mesh) return;
    saved.mesh.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const bak = m?.userData?._xrEmissiveBak;
        if (bak) {
          m.emissive.copy(bak.color);
          m.emissiveIntensity = bak.intensity;
          delete m.userData._xrEmissiveBak;
        }
        if (m?.userData?._xrMetalBak != null) {
          m.metalness = m.userData._xrMetalBak;
          delete m.userData._xrMetalBak;
        }
        if (m?.userData?._xrColorBak) {
          m.color.copy(m.userData._xrColorBak);
          delete m.userData._xrColorBak;
        }
      }
    });
  }

  /**
   * Always put the CAD assembly directly in front of the headset.
   */
  function placeInFront(opts = {}) {
    const mesh = getLiveMesh();
    if (!mesh) {
      console.warn("[viewport-xr] No CAD model loaded — load a model before entering AR");
      return false;
    }
    captureDesktop(mesh);
    prepareMeshesForXr(mesh);

    const spawnId = opts.spawnId || activeSpawnId || "eye";
    const preset = SPAWN_PRESETS.find((p) => p.id === spawnId) || SPAWN_PRESETS[0];
    activeSpawnId = preset.id;
    if (!opts.keepZoom) userZoom = opts.userZoom || 1;

    mesh.position.copy(saved.pos);
    mesh.quaternion.copy(saved.quat);
    mesh.scale.copy(saved.scale);
    mesh.updateMatrixWorld(true);

    let box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) {
      box = new THREE.Box3(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
    }
    const size0 = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size0.x, size0.y, size0.z, 1e-4);
    const targetM = Math.min(preset.sizeM || 0.2, 0.22) * Math.max(userZoom, 0.12);

    getHeadPose();
    if (!Number.isFinite(_headPos.y) || _headPos.y < 0.2) _headPos.set(0, 1.55, 0);
    const forward = headForward();
    const dist = preset.distance || 0.7;
    const target = _headPos.clone().addScaledVector(forward, dist);
    if (preset.yMode === "floor") target.y = Math.max(0.12, targetM * 0.5);

    const zUpToYUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const flatBack = forward.clone();
    flatBack.y = 0;
    if (flatBack.lengthSq() < 1e-6) flatBack.set(0, 0, 1);
    else flatBack.normalize();
    const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), flatBack.clone().negate());
    const worldQuat = face.multiply(zUpToYUp);

    const parent = mesh.parent;
    if (parent) {
      const pwq = parent.getWorldQuaternion(new THREE.Quaternion());
      mesh.quaternion.copy(pwq.clone().invert().multiply(worldQuat));
    } else {
      mesh.quaternion.copy(worldQuat);
    }

    const factor = targetM / maxDim;
    mesh.scale.copy(saved.scale).multiplyScalar(factor);
    mesh.updateMatrixWorld(true);

    box.setFromObject(mesh);
    const c1 = box.getCenter(new THREE.Vector3());
    const delta = target.clone().sub(c1);
    if (parent) {
      const wp = mesh.getWorldPosition(new THREE.Vector3()).add(delta);
      mesh.position.copy(parent.worldToLocal(wp));
    } else {
      mesh.position.add(delta);
    }
    mesh.updateMatrixWorld(true);

    presentationScale = Math.abs(mesh.scale.x) || factor;
    baseScale = presentationScale / Math.max(userZoom, 1e-6);
    enforceHandheldSize(mesh, Math.min(targetM, 0.22));

    // Bright marker so a black PBR model still has a visible anchor
    let marker = mesh.getObjectByName("xrModelMarker");
    if (!marker) {
      marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xfff200, depthTest: false, depthWrite: false }),
      );
      marker.name = "xrModelMarker";
      marker.renderOrder = 4500;
      marker.frustumCulled = false;
      mesh.add(marker);
    }
    marker.visible = true;
    const ms = Math.max(Math.abs(mesh.scale.x), 1e-9);
    marker.scale.setScalar(0.05 / ms); // ~5cm in world space

    console.info("[viewport-xr] placed", {
      maxDimBefore: maxDim,
      targetM,
      scale: mesh.scale.x,
      worldSize: new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).toArray(),
    });

    showBeacon(target);
    saveRoomPose();
    return true;
  }

  function enforceHandheldSize(mesh, targetMax = 0.2) {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const maxD = Math.max(size.x, size.y, size.z);
    if (!(maxD > 1e-8)) return;
    const factor = targetMax / maxD;
    if (!Number.isFinite(factor) || factor <= 0) return;
    if (Math.abs(1 - factor) < 0.02) return;
    const center = box.getCenter(new THREE.Vector3());
    const parent = mesh.parent;
    const localCenter = parent ? parent.worldToLocal(center.clone()) : center.clone();
    mesh.scale.multiplyScalar(factor);
    mesh.position.sub(localCenter).multiplyScalar(factor).add(localCenter);
    presentationScale = Math.abs(mesh.scale.x) || presentationScale * factor;
    baseScale = presentationScale / Math.max(userZoom, 1e-6);
    mesh.updateMatrixWorld(true);
    getHeadPose();
    const f = headForward();
    const want = _headPos.clone().addScaledVector(f, 0.7);
    const c2 = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    const dlt = want.sub(c2);
    if (parent) {
      const worldPos = mesh.getWorldPosition(new THREE.Vector3()).add(dlt);
      mesh.position.copy(parent.worldToLocal(worldPos));
    } else {
      mesh.position.add(dlt);
    }
    mesh.updateMatrixWorld(true);
  }

  function applySavedPose() {
    const mesh = getLiveMesh();
    const data = loadRoomPose();
    if (!mesh || !data?.position) return placeInFront({ spawnId: "eye" });
    captureDesktop(mesh);
    prepareMeshesForXr(mesh);
    mesh.position.fromArray(data.position);
    mesh.quaternion.fromArray(data.quaternion);
    mesh.scale.fromArray(data.scale);
    userZoom = data.userZoom || 1;
    activeSpawnId = data.activeSpawnId || "eye";
    presentationScale = mesh.scale.x || 1;
    baseScale = presentationScale / Math.max(userZoom, 1e-6);
    mesh.updateMatrixWorld(true);
    enforceHandheldSize(mesh, 0.22);
    showBeacon(mesh.getWorldPosition(new THREE.Vector3()));
    return true;
  }

  function showBeacon(worldPos) {
    if (!beacon) {
      beacon = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.14, 40),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthTest: false,
        }),
      );
      beacon.rotation.x = -Math.PI / 2;
      beacon.renderOrder = 1500;
      xrHud.add(beacon);
    }
    beacon.position.set(worldPos.x, Math.max(0.02, worldPos.y - 0.25), worldPos.z);
    beacon.visible = true;
    beacon.userData.born = performance.now();
  }

  function applyZoom(factor) {
    const mesh = getLiveMesh();
    if (!mesh || !presenting) return;
    userZoom = THREE.MathUtils.clamp(userZoom * factor, 0.25, 3);
    const next = baseScale * userZoom;
    const ratio = next / Math.max(presentationScale, 1e-9);
    presentationScale = next;
    mesh.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    // Scale about center in parent space
    const localCenter = mesh.parent
      ? mesh.parent.worldToLocal(center.clone())
      : center.clone();
    mesh.scale.multiplyScalar(ratio);
    mesh.position.sub(localCenter).multiplyScalar(ratio).add(localCenter);
    mesh.updateMatrixWorld(true);
    saveRoomPose();
  }

  function setTool(id) {
    if (id === "front") {
      placeInFront({ spawnId: activeSpawnId || "eye", keepZoom: false });
      return;
    }
    if (id === "restore") {
      applySavedPose();
      return;
    }
    if (id === "zoom_in") {
      applyZoom(1.2);
      return;
    }
    if (id === "zoom_out") {
      applyZoom(1 / 1.2);
      return;
    }
    if (id === "place") {
      openPlacePanel();
      return;
    }
    if (id === "exit") {
      exit();
      return;
    }
    if (id === "measure") {
      activeTool = "measure";
      syncDock();
      return;
    }
    if (id === "grab" || id === "rotate") {
      activeTool = id;
      syncDock();
    }
  }

  function openPlacePanel() {
    if (!placePanel) {
      const canvas = drawPanelCanvas("Place model", [], "Trigger a row");
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.38),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthTest: false }),
      );
      plane.renderOrder = 2100;
      plane.userData.xrPlacePanel = true;
      placePanel = { group: new THREE.Group(), plane, tex, lines: [] };
      placePanel.group.add(plane);
      xrHud.add(placePanel.group);
    }
    const lines = SPAWN_PRESETS.map((p) => ({
      id: p.id,
      label: `${p.id === activeSpawnId ? "● " : "○ "}${p.label}`,
      active: p.id === activeSpawnId,
    }));
    lines.push({ id: "__saved__", label: "↺  Last saved spot", active: true });
    placePanel.lines = lines;
    const canvas = drawPanelCanvas("Place model", lines, "Point + trigger");
    placePanel.tex.image = canvas;
    placePanel.tex.needsUpdate = true;
    placePanel.group.visible = true;
    getHeadPose();
    const f = headForward();
    placePanel.group.position.copy(_headPos).addScaledVector(f, 0.9).add(new THREE.Vector3(0.35, 0, 0));
    placePanel.group.quaternion.copy(_headQuat);
  }

  function clearMeasure() {
    measurePoints.length = 0;
    while (measureGroup.children.length) {
      const c = measureGroup.children.pop();
      c.geometry?.dispose?.();
      c.material?.map?.dispose?.();
      c.material?.dispose?.();
    }
    measureLine = null;
    measureLabel = null;
  }

  function pickWithController(controller) {
    _mat.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_mat);

    // Dock
    const dockHits = raycaster.intersectObjects(dockButtons, false);
    if (dockHits.length) return { kind: "tool", tool: dockHits[0].object.userData.xrTool };

    // Place panel
    if (placePanel?.group.visible) {
      const ph = raycaster.intersectObject(placePanel.plane, false);
      if (ph.length) {
        const local = placePanel.plane.worldToLocal(ph[0].point.clone());
        const v = 1 - (local.y + 0.19) / 0.38;
        const idx = Math.floor(((v - 0.16) / 0.75) * placePanel.lines.length);
        const line = placePanel.lines[Math.max(0, Math.min(placePanel.lines.length - 1, idx))];
        return { kind: "place", line };
      }
    }

    const mesh = getLiveMesh();
    if (mesh) {
      const hits = raycaster.intersectObject(mesh, true).filter((h) => h.object.isMesh);
      if (hits.length) return { kind: "mesh", point: hits[0].point.clone() };
    }
    return null;
  }

  function handleSelect(controller) {
    const hit = pickWithController(controller);
    if (!hit) {
      // Trigger with no hit in grab mode: still allow grabbing whole model if ray is near
      if (activeTool === "grab" || activeTool === "rotate") {
        beginGrab(controller);
      }
      return;
    }
    if (hit.kind === "tool") {
      setTool(hit.tool);
      return;
    }
    if (hit.kind === "place") {
      if (hit.line?.id === "__saved__") applySavedPose();
      else if (hit.line?.id) placeInFront({ spawnId: hit.line.id, keepZoom: false });
      openPlacePanel();
      return;
    }
    if (activeTool === "measure" && hit.kind === "mesh") {
      if (measurePoints.length >= 2) clearMeasure();
      measurePoints.push(hit.point);
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24, depthTest: false }),
      );
      m.position.copy(hit.point);
      measureGroup.add(m);
      if (measurePoints.length === 2) {
        const [a, b] = measurePoints;
        measureLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([a, b]),
          new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false }),
        );
        measureGroup.add(measureLine);
        const dist = a.distanceTo(b) / Math.max(presentationScale, 1e-9);
        const mm = dist * (Number(getMmPerUnit?.()) || 1);
        const text = typeof formatLength === "function" ? formatLength(mm) : `${mm.toFixed(1)} mm`;
        // simple sprite
        const c = document.createElement("canvas");
        c.width = 512;
        c.height = 128;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(0, 0, 512, 128);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 56px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(text, 256, 80);
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }),
        );
        sp.scale.set(0.28, 0.07, 1);
        sp.position.copy(a).lerp(b, 0.5);
        measureGroup.add(sp);
        measureLabel = sp;
      }
      return;
    }
    if (hit.kind === "mesh") beginGrab(controller);
  }

  function beginGrab(controller) {
    const mesh = getLiveMesh();
    if (!mesh) return;
    mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(controller.matrixWorld).invert();
    const local = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const op = new THREE.Vector3();
    const oq = new THREE.Quaternion();
    const os = new THREE.Vector3();
    local.decompose(op, oq, os);
    grabState = {
      mode: activeTool === "rotate" ? "rotate" : "grab",
      controller,
      offsetPos: op,
      offsetQuat: oq,
      startCtrlYaw: new THREE.Euler().setFromQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()), "YXZ").y,
      startMeshYaw: new THREE.Euler().setFromQuaternion(mesh.quaternion.clone(), "YXZ").y,
    };
  }

  function endGrab(controller) {
    if (grabState?.controller === controller) {
      grabState = null;
      saveRoomPose();
    }
  }

  function setupControllers() {
    for (let i = 0; i < 2; i += 1) {
      const controller = renderer.xr.getController(i);
      controller.addEventListener("selectstart", (e) => handleSelect(e.target));
      controller.addEventListener("selectend", (e) => endGrab(e.target));
      controller.addEventListener("connected", () => {
        controller.visible = presenting;
      });

      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, -1.8),
        ]),
        new THREE.LineBasicMaterial({ color: 0x7dd3fc, depthTest: false, transparent: true, opacity: 1 }),
      );
      ray.renderOrder = 3000;
      ray.frustumCulled = false;
      controller.add(ray);
      const originBall = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 14, 12),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? 0x38bdf8 : 0xf472b6,
          depthTest: false,
          depthWrite: false,
        }),
      );
      originBall.renderOrder = 3999;
      originBall.frustumCulled = false;
      controller.add(originBall);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
      );
      tip.position.z = -1.8;
      tip.renderOrder = 3001;
      controller.add(tip);
      controller.visible = false;
      scene.add(controller);
      controllers.push(controller);

      const grip = renderer.xr.getControllerGrip(i);
      grip.add(controllerModelFactory.createControllerModel(grip));
      // Always-visible controller body (BasicMaterial + no depth test — survives CAD clip quirks)
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.03, 0.14),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? 0x38bdf8 : 0xf472b6,
          depthTest: false,
          depthWrite: false,
        }),
      );
      body.position.z = 0.02;
      body.renderOrder = 4000;
      body.frustumCulled = false;
      grip.add(body);
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 16, 12),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          depthTest: false,
          depthWrite: false,
        }),
      );
      knob.position.set(0, 0.02, 0.02);
      knob.renderOrder = 4001;
      knob.frustumCulled = false;
      grip.add(knob);
      grip.addEventListener("connected", () => {
        grip.visible = presenting;
      });
      grip.visible = false;
      scene.add(grip);
      grips.push(grip);

      const hand = renderer.xr.getHand(i);
      hand.add(handModelFactory.createHandModel(hand, "spheres"));
      const palm = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 14, 12),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? 0x38bdf8 : 0xf472b6,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        }),
      );
      palm.renderOrder = 3002;
      hand.add(palm);
      hand.addEventListener("selectstart", (e) => handleSelect(e.target));
      hand.addEventListener("selectend", (e) => endGrab(e.target));
      hand.addEventListener("connected", () => {
        hand.visible = presenting;
      });
      hand.visible = false;
      scene.add(hand);
      hands.push(hand);
    }
  }

  function attachHudToCamera() {
    // Keep dock/probe in scene HUD — world billboard every frame (Quest-safe)
    if (dock.parent !== xrHud) {
      if (dock.parent) dock.parent.remove(dock);
      xrHud.add(dock);
    }
    if (faceProbe.parent !== xrHud) {
      if (faceProbe.parent) faceProbe.parent.remove(faceProbe);
      xrHud.add(faceProbe);
    }
    dock.visible = true;
    faceProbe.visible = true;
  }

  function detachHudFromCamera() {
    if (dock.parent && dock.parent !== xrHud) {
      dock.parent.remove(dock);
      xrHud.add(dock);
    }
    if (faceProbe.parent && faceProbe.parent !== xrHud) {
      faceProbe.parent.remove(faceProbe);
      xrHud.add(faceProbe);
    }
    dock.visible = false;
    faceProbe.visible = false;
  }

  function updateDockFollow() {
    attachHudToCamera();
    getHeadPose();
    const f = headForward();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_headQuat).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_headQuat).normalize();

    // Large strip on the LEFT of your view, ~0.55m ahead
    dock.position
      .copy(_headPos)
      .addScaledVector(f, 0.42)
      .addScaledVector(right, -0.22)
      .addScaledVector(up, 0.02);
    dock.quaternion.copy(_headQuat);
    dock.visible = true;
    dock.scale.setScalar(1.35);

    // Cyan cube ahead-right — if missing, XR is not drawing meshes
    faceProbe.position
      .copy(_headPos)
      .addScaledVector(f, 0.75)
      .addScaledVector(right, 0.18)
      .addScaledVector(up, -0.12);
    faceProbe.quaternion.copy(_headQuat);
    faceProbe.scale.setScalar(0.5);
    faceProbe.visible = true;

    const pointer = controllers[1] || controllers[0];
    if (!pointer) return;
    const hit = pickWithController(pointer);
    dockButtons.forEach((btn) => {
      const hover = hit?.kind === "tool" && hit.tool === btn.userData.xrTool;
      const on = btn.userData.xrTool === activeTool;
      btn.scale.setScalar(hover ? 1.2 : on ? 1.12 : 1);
      if (btn.userData.ring) btn.userData.ring.material.opacity = hover || on ? 1 : 0;
    });
  }

  function pollGamepads() {
    const sess = renderer.xr.getSession?.();
    if (!sess) return;
    let idx = 0;
    for (const source of sess.inputSources) {
      const gp = source.gamepad;
      if (!gp) continue;
      const handIndex = source.handedness === "left" ? 0 : source.handedness === "right" ? 1 : idx;
      const controller = controllers[handIndex] || controllers[idx] || controllers[0];
      // Trigger = button 0 on Quest
      const trigger = !!(gp.buttons?.[0]?.pressed || (gp.buttons?.[0]?.value || 0) > 0.7);
      if (trigger && !prevTrigger[handIndex] && controller) {
        handleSelect(controller);
      }
      if (!trigger && prevTrigger[handIndex] && controller) {
        endGrab(controller);
      }
      prevTrigger[handIndex] = trigger;

      // Squeeze (button 1) opens place menu on left
      if (source.handedness === "left" && gp.buttons?.[1]?.pressed) {
        openPlacePanel();
      }

      // Stick zoom / rotate
      const ax = gp.axes || [];
      const axisX = ax.length >= 4 ? ax[2] : ax[0];
      const axisY = ax.length >= 4 ? ax[3] : ax[1];
      if (Math.abs(axisY || 0) > 0.25) applyZoom(Math.exp(-axisY * 0.03));
      if (Math.abs(axisX || 0) > 0.25 && getLiveMesh()) {
        getLiveMesh().rotation.y -= axisX * 0.045;
        saveRoomPose();
      }
      idx += 1;
    }
  }

  function updateGrab() {
    if (!grabState) return;
    const mesh = getLiveMesh();
    if (!mesh) return;
    const { controller, mode, offsetPos, offsetQuat, startCtrlYaw, startMeshYaw } = grabState;
    controller.updateMatrixWorld(true);
    if (mode === "rotate") {
      const yaw = new THREE.Euler().setFromQuaternion(
        controller.getWorldQuaternion(new THREE.Quaternion()),
        "YXZ",
      ).y;
      mesh.rotation.y = startMeshYaw + (yaw - startCtrlYaw);
    } else {
      const next = new THREE.Matrix4().compose(offsetPos, offsetQuat, new THREE.Vector3(1, 1, 1));
      const world = new THREE.Matrix4().multiplyMatrices(controller.matrixWorld, next);
      if (mesh.parent) {
        const inv = new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert();
        new THREE.Matrix4().multiplyMatrices(inv, world).decompose(mesh.position, mesh.quaternion, _s);
      } else {
        world.decompose(mesh.position, mesh.quaternion, _s);
      }
      // Preserve uniform presentation scale
      const sx = presentationScale || mesh.scale.x;
      mesh.scale.setScalar(sx);
    }
  }

  async function enter() {
    if (presenting || !navigator.xr) return;

    // Skip modal — always start in front of you. Place menu available in-session.
    activeSpawnId = "eye";
    try {
      localStorage.setItem(LS_SPAWN, "eye");
    } catch {
      /* ignore */
    }

    let mode = "immersive-ar";
    try {
      if (!(await navigator.xr.isSessionSupported("immersive-ar"))) {
        mode = (await navigator.xr.isSessionSupported("immersive-vr")) ? "immersive-vr" : null;
      }
    } catch {
      mode = null;
    }
    if (!mode) throw new Error("WebXR unavailable");
    sessionMode = mode;

    renderer.xr.enabled = true;
    savedBackground = scene.background;
    savedFog = scene.fog;
    scene.fog = null;
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);

    try {
      session = await navigator.xr.requestSession(mode, {
        optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "hit-test"],
      });
    } catch (e) {
      session = await navigator.xr.requestSession(mode);
    }

    const blend = session.environmentBlendMode || "";
    const passthrough = mode === "immersive-ar" || blend === "alpha-blend" || blend === "additive";
    if (!passthrough) {
      scene.background = new THREE.Color(0x334155);
      renderer.setClearColor(0x334155, 1);
    }

    await renderer.xr.setSession(session);
    if (passthrough) {
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
      renderer.setClearAlpha(0);
    }

    // Shadows + exotic depth paths are a common Quest "draw nothing" cause
    savedShadowMap = renderer.shadowMap?.enabled;
    if (renderer.shadowMap) renderer.shadowMap.enabled = false;

    // CRITICAL: desktop CAD uses large near planes (often meters+). Three.js pushes
    // camera.near into XR session depthNear — that clips controllers + handheld models.
    savedNear = camera.near;
    savedFar = camera.far;
    camera.near = 0.05;
    camera.far = 100;
    camera.updateProjectionMatrix();
    try {
      session.updateRenderState({ depthNear: 0.05, depthFar: 100 });
    } catch {
      /* ignore */
    }

    presenting = true;
    xrHud.visible = true;
    attachHudToCamera();
    faceProbe.visible = true;
    controllers.forEach((c) => {
      c.visible = true;
    });
    grips.forEach((g) => {
      g.visible = true;
    });
    hands.forEach((h) => {
      h.visible = true;
    });
    dock.visible = true;
    if (controls) controls.enabled = false;
    if (transformControls) transformControls.enabled = false;
    try {
      hideSceneChrome?.();
    } catch {
      /* ignore */
    }

    await waitForHead(50);

    // Always re-place in front after tracking settles (saved pose is optional via Saved tool)
    placeInFront({ spawnId: "eye", keepZoom: false });
    setTimeout(() => {
      if (presenting) placeInFront({ spawnId: "eye", keepZoom: true });
    }, 500);

    activeTool = "grab";
    syncDock();
    setButtonUi(true);
    onPresentingChange?.(true);
    session.addEventListener("end", onSessionEnd);
  }

  function onSessionEnd() {
    saveRoomPose();
    presenting = false;
    session = null;
    xrHud.visible = false;
    dock.visible = false;
    if (placePanel) placePanel.group.visible = false;
    controllers.forEach((c) => {
      c.visible = false;
    });
    grips.forEach((g) => {
      g.visible = false;
    });
    hands.forEach((h) => {
      h.visible = false;
    });
    grabState = null;
    clearMeasure();
    restoreMeshMaterials();
    restoreDesktop();
    scene.background = savedBackground;
    scene.fog = savedFog;
    if (renderer.shadowMap && savedShadowMap != null) renderer.shadowMap.enabled = savedShadowMap;
    if (savedNear != null) {
      camera.near = savedNear;
      camera.far = savedFar ?? camera.far;
      camera.updateProjectionMatrix();
      savedNear = null;
      savedFar = null;
    }
    renderer.setClearColor(0x000000, 0);
    detachHudFromCamera();
    if (controls) controls.enabled = true;
    if (transformControls) transformControls.enabled = true;
    renderer.xr.enabled = false;
    setButtonUi(false);
    try {
      restoreSceneChrome?.();
    } catch {
      /* ignore */
    }
    onPresentingChange?.(false);
    try {
      fitCamera?.();
    } catch {
      /* ignore */
    }
  }

  async function exit() {
    if (session) {
      try {
        await session.end();
      } catch {
        onSessionEnd();
      }
    }
  }

  function toggle() {
    if (presenting) return exit();
    return enter();
  }

  function update() {
    if (!presenting) return;
    // Keep XR depth range room-scale every frame (desktop fitCamera can fight us)
    if (camera.near > 0.08 || camera.far < 20) {
      camera.near = 0.05;
      camera.far = 100;
      camera.updateProjectionMatrix();
    }
    // Force overlays visible every frame (Quest can flip them off)
    xrHud.visible = true;
    dock.visible = true;
    faceProbe.visible = true;
    controllers.forEach((c) => {
      c.visible = true;
    });
    grips.forEach((g) => {
      g.visible = true;
    });
    updateGrab();
    updateDockFollow();
    pollGamepads();
    if (beacon?.visible && beacon.userData.born && performance.now() - beacon.userData.born > 5000) {
      beacon.visible = false;
    }
    getHeadPose();
    key.position.copy(_headPos).add(new THREE.Vector3(0.5, 1.0, 0.4));
  }

  function isPresenting() {
    return presenting || !!renderer.xr?.isPresenting;
  }

  let buttonBound = false;
  async function probeSupport() {
    try {
      if (!navigator.xr) supported = false;
      else if (await navigator.xr.isSessionSupported("immersive-ar")) {
        supported = true;
        sessionMode = "immersive-ar";
      } else if (await navigator.xr.isSessionSupported("immersive-vr")) {
        supported = true;
        sessionMode = "immersive-vr";
      } else supported = false;
    } catch {
      supported = false;
    }
    if (buttonEl) {
      buttonEl.hidden = !supported;
      buttonEl.classList.toggle("hidden", !supported);
      buttonEl.disabled = !supported;
      const span = buttonEl.querySelector("span");
      if (span) span.textContent = sessionMode === "immersive-ar" ? "AR" : "VR";
      if (supported && !buttonBound) {
        buttonBound = true;
        buttonEl.addEventListener("click", (e) => {
          e.preventDefault();
          // Require a model
          if (!getLiveMesh()) {
            buttonEl.title = "Load a CAD model first, then enter AR";
            console.warn("[viewport-xr] load a model before AR");
          }
          toggle().catch((err) => console.warn("[viewport-xr]", err));
        });
      }
    }
    return supported;
  }

  setupControllers();
  void probeSupport();

  return {
    enter,
    exit,
    toggle,
    update,
    isPresenting: () => isPresenting(),
    isSupported: () => supported,
    probeSupport,
    setTool,
    getSessionMode: () => sessionMode,
    placeInFront,
    saveRoomPose,
  };
}
