/**
 * Quest AR/VR — Meta-style controllers + left-hand tool palette
 *
 * - Official XR controller models (Quest Touch)
 * - Tool dock parented to LEFT controller (not head-locked)
 * - Explorer opens a world-space panel you can grab and move
 * - AR passthrough kept clear (no black sky when looking around)
 */

import * as THREE from "three";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import { nearestWorldEdgeFromHit } from "./picking.js?v=20260729-xr-edge";

const LS_POSE = "render3d:xr-room-pose";
const LS_SPAWN = "render3d:xr-spawn-preset";

const SPAWN_PRESETS = [
  { id: "eye", label: "In front of you", distance: 0.7, sizeM: 0.2 },
  { id: "near", label: "Near (arm)", distance: 0.45, sizeM: 0.14 },
  { id: "far", label: "Farther", distance: 1.2, sizeM: 0.25 },
  { id: "floor", label: "Lower / floor", distance: 0.9, sizeM: 0.2, yMode: "floor" },
];

const QUICK_DOCK = [
  { id: "menu", label: "Menu", color: 0x94a3b8, glyph: "☰", icon: "menu" },
  { id: "undo", label: "Undo", color: 0x64748b, glyph: "↶", icon: "undo" },
  { id: "redo", label: "Redo", color: 0x64748b, glyph: "↷", icon: "redo" },
  { id: "grab", label: "Move", color: 0x3b82f6, glyph: "✥", icon: "move" },
  { id: "measure", label: "Measure", color: 0xf59e0b, glyph: "⌖", icon: "measure" },
  { id: "exit", label: "Exit", color: 0xef4444, glyph: "✕", icon: "exit" },
];
const DOCK_TOOLS = QUICK_DOCK;

const MENU_TABS = [
  { id: "projects", label: "Projects" },
  { id: "parts", label: "Models" },
  { id: "files", label: "Files" },
  { id: "ai", label: "AI" },
  { id: "tools", label: "Tools" },
  { id: "view", label: "View" },
];

const TOOL_ACTIONS = [
  { id: "front", label: "Place in front", section: "tools", icon: "front" },
  { id: "place", label: "Placement presets", section: "tools", icon: "place" },
  { id: "zoom_in", label: "Scale up", section: "tools", icon: "plus" },
  { id: "zoom_out", label: "Scale down", section: "tools", icon: "minus" },
  { id: "restore", label: "Restore saved pose", section: "tools", icon: "restore" },
  { id: "export", label: "Export model", section: "tools", icon: "export" },
  { id: "bambu", label: "Send to Bambu", section: "tools", icon: "bambu" },
  { id: "fit", label: "Fit / recenter", section: "view", icon: "fit" },
  { id: "explode", label: "Toggle explode", section: "view", icon: "explode" },
  { id: "section", label: "Toggle section", section: "view", icon: "section" },
  { id: "wireframe", label: "Toggle wireframe", section: "view", icon: "wire" },
  { id: "units", label: "Cycle units", section: "view", icon: "units" },
  { id: "screenshot", label: "Screenshot → Share", section: "view", icon: "cam" },
  { id: "record", label: "Record video", section: "view", icon: "rec" },
];

const MENU_CANVAS = {
  w: 1400,
  h: 980,
  headerEnd: 100,
  tabStart: 118,
  tabEnd: 188,
  listTop: 220,
  rowH: 78,
  footerTop: 900,
};
const MENU_PLANE = { w: 0.72, h: 0.5 };

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawGlyphIcon(ctx, icon, cx, cy, size, color = "#e2e8f0") {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2.5, size * 0.08);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const s = size * 0.32;
  if (icon === "menu") {
    for (const dy of [-s * 0.7, 0, s * 0.7]) {
      ctx.beginPath();
      ctx.moveTo(cx - s, cy + dy);
      ctx.lineTo(cx + s, cy + dy);
      ctx.stroke();
    }
  } else if (icon === "undo") {
    ctx.beginPath();
    ctx.arc(cx, cy, s, Math.PI * 0.2, Math.PI * 1.4, true);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.2, cy - s);
    ctx.lineTo(cx - s, cy - s * 0.35);
    ctx.lineTo(cx - s * 0.05, cy - s * 0.25);
    ctx.fill();
  } else if (icon === "redo") {
    ctx.beginPath();
    ctx.arc(cx, cy, s, Math.PI * 0.8, Math.PI * -0.4, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.2, cy - s);
    ctx.lineTo(cx + s, cy - s * 0.35);
    ctx.lineTo(cx + s * 0.05, cy - s * 0.25);
    ctx.fill();
  } else if (icon === "move") {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s);
    ctx.stroke();
  } else if (icon === "measure") {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s * 0.4);
    ctx.lineTo(cx + s, cy - s * 0.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - s, cy + s * 0.4, s * 0.22, 0, Math.PI * 2);
    ctx.arc(cx + s, cy - s * 0.4, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else if (icon === "exit") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.7, cy - s * 0.7);
    ctx.lineTo(cx + s * 0.7, cy + s * 0.7);
    ctx.moveTo(cx + s * 0.7, cy - s * 0.7);
    ctx.lineTo(cx - s * 0.7, cy + s * 0.7);
    ctx.stroke();
  } else if (icon === "mic") {
    roundRect(ctx, cx - s * 0.35, cy - s, s * 0.7, s * 1.2, s * 0.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.35, s * 0.7, 0, Math.PI, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 1.05); ctx.lineTo(cx, cy + s * 1.4);
    ctx.moveTo(cx - s * 0.45, cy + s * 1.4); ctx.lineTo(cx + s * 0.45, cy + s * 1.4);
    ctx.stroke();
  } else if (icon === "ai") {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - s * 0.3, cy - s * 0.1, s * 0.15, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.3, cy - s * 0.1, s * 0.15, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // default diamond
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx, cy + s);
    ctx.lineTo(cx - s, cy);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function makeIconTexture(glyph, bgHex, label, icon = null) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Brushed metal disc
  const g = ctx.createRadialGradient(90, 80, 10, 128, 128, 120);
  g.addColorStop(0, "#f8fafc");
  g.addColorStop(0.35, "#94a3b8");
  g.addColorStop(0.7, "#334155");
  g.addColorStop(1, "#0f172a");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fill();
  const c = new THREE.Color(bgHex);
  ctx.strokeStyle = `#${c.getHexString()}`;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.stroke();
  drawGlyphIcon(ctx, icon || "move", 128, 118, 140, "#f8fafc");
  if (label) {
    ctx.fillStyle = "rgba(248,250,252,0.92)";
    ctx.font = "bold 28px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(label).slice(0, 8), 128, 200);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function drawPanelCanvas(title, lines, footer = "") {
  return drawConsoleCanvas({ title, tabs: [], activeTab: "", lines, footer });
}

function drawConsoleCanvas({ title, tabs = [], activeTab = "", lines = [], footer = "" }) {
  const width = MENU_CANVAS.w;
  const height = MENU_CANVAS.h;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  // Metallic chassis
  const body = ctx.createLinearGradient(0, 0, width, height);
  body.addColorStop(0, "#1e293b");
  body.addColorStop(0.35, "#0f172a");
  body.addColorStop(0.7, "#111827");
  body.addColorStop(1, "#020617");
  ctx.fillStyle = body;
  roundRect(ctx, 0, 0, width, height, 28);
  ctx.fill();

  // Chrome rim
  const rim = ctx.createLinearGradient(0, 0, width, 0);
  rim.addColorStop(0, "#94a3b8");
  rim.addColorStop(0.25, "#e2e8f0");
  rim.addColorStop(0.5, "#38bdf8");
  rim.addColorStop(0.75, "#e2e8f0");
  rim.addColorStop(1, "#64748b");
  ctx.strokeStyle = rim;
  ctx.lineWidth = 5;
  roundRect(ctx, 3, 3, width - 6, height - 6, 26);
  ctx.stroke();

  // Header metal bar
  const hg = ctx.createLinearGradient(0, 0, width, 0);
  hg.addColorStop(0, "#334155");
  hg.addColorStop(0.4, "#64748b");
  hg.addColorStop(0.6, "#94a3b8");
  hg.addColorStop(1, "#1e293b");
  ctx.fillStyle = hg;
  roundRect(ctx, 0, 0, width, MENU_CANVAS.headerEnd, 28);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, MENU_CANVAS.headerEnd - 28, width, 28);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 48px Arial,sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(String(title || "Render Studio").slice(0, 32), 48, 48);
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 22px Arial,sans-serif";
  ctx.fillText("SPATIAL WORKSPACE", 48, 82);

  if (tabs.length) {
    const tabW = Math.min(200, (width - 72) / tabs.length - 10);
    tabs.forEach((tab, i) => {
      const x = 36 + i * (tabW + 10);
      const on = tab.id === activeTab;
      const tg = ctx.createLinearGradient(x, MENU_CANVAS.tabStart, x, MENU_CANVAS.tabEnd);
      if (on) {
        tg.addColorStop(0, "#38bdf8");
        tg.addColorStop(1, "#0284c7");
      } else {
        tg.addColorStop(0, "#334155");
        tg.addColorStop(1, "#1e293b");
      }
      ctx.fillStyle = tg;
      roundRect(ctx, x, MENU_CANVAS.tabStart, tabW, MENU_CANVAS.tabEnd - MENU_CANVAS.tabStart, 14);
      ctx.fill();
      ctx.fillStyle = on ? "#0f172a" : "#cbd5e1";
      ctx.font = on ? "bold 30px Arial,sans-serif" : "28px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(tab.label).slice(0, 12), x + tabW / 2, (MENU_CANVAS.tabStart + MENU_CANVAS.tabEnd) / 2);
    });
  }

  const listTop = tabs.length ? MENU_CANVAS.listTop : 150;
  lines.forEach((line, i) => {
    const y = listTop + i * MENU_CANVAS.rowH;
    if (y > MENU_CANVAS.footerTop - 20) return;
    const rowG = ctx.createLinearGradient(40, y - 30, width - 40, y + 30);
    if (line.active) {
      rowG.addColorStop(0, "rgba(56,189,248,0.28)");
      rowG.addColorStop(1, "rgba(14,165,233,0.12)");
    } else {
      rowG.addColorStop(0, i % 2 ? "rgba(51,65,85,0.55)" : "rgba(30,41,59,0.35)");
      rowG.addColorStop(1, "rgba(15,23,42,0.5)");
    }
    ctx.fillStyle = rowG;
    roundRect(ctx, 36, y - 30, width - 72, 64, 16);
    ctx.fill();
    // Icon badge
    const ig = ctx.createRadialGradient(78, y, 4, 78, y, 26);
    ig.addColorStop(0, "#e2e8f0");
    ig.addColorStop(1, "#475569");
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.arc(78, y, 24, 0, Math.PI * 2);
    ctx.fill();
    drawGlyphIcon(ctx, line.icon || (line.kind === "project" ? "front" : line.kind === "part" ? "move" : "ai"), 78, y, 44, "#0f172a");
    ctx.fillStyle = line.active ? "#f0f9ff" : "#e2e8f0";
    ctx.font = line.active ? "bold 34px Arial,sans-serif" : "32px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(line.label || "").slice(0, 46), 120, y + 2);
  });

  if (footer) {
    const fg = ctx.createLinearGradient(0, height - 80, 0, height);
    fg.addColorStop(0, "#1e293b");
    fg.addColorStop(1, "#020617");
    ctx.fillStyle = fg;
    ctx.fillRect(0, height - 80, width, 80);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 28px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(footer).slice(0, 78), width / 2, height - 40);
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
    getExplorerItems = null,
    onExplorerSelect = null,
    getProjects = null,
    onOpenProject = null,
    getProjectFiles = null,
    getPromptDraft = null,
    onPromptSubmit = null,
    onToolAction = null,
    onUndo = null,
    onRedo = null,
    onTranscribeToggle = null,
    isTranscribing = null,
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
  let menuTab = "projects";
  let menuScroll = 0;
  let menuFooterHint = "";
  let lastSelectAt = 0;
  let scaleGrab = null;
  let prevSqueeze = [false, false];

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
  faceProbe.visible = false;
  xrHud.add(faceProbe);

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
  const measureEdges = [];
  let measureLine = null;
  let measureLabel = null;
  let measureHoverEdge = null;

  // Left-controller tool dock (Meta-style palette on the grip)
  const dock = new THREE.Group();
  dock.name = "xrToolDock";
  dock.visible = false;
  dock.frustumCulled = false;
  dock.renderOrder = 10000;
  const dockButtons = [];
  const BTN_R = 0.018;
  const BTN_GAP = 0.042;
  DOCK_TOOLS.forEach((tool, i) => {
    const btn = new THREE.Mesh(
      new THREE.CircleGeometry(BTN_R, 32),
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
      new THREE.CircleGeometry(BTN_R * 0.9, 32),
      new THREE.MeshBasicMaterial({
        map: makeIconTexture(tool.glyph, tool.color, tool.label, tool.icon),
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    label.position.copy(btn.position);
    label.position.z = 0.0015;
    label.renderOrder = 10052;
    label.frustumCulled = false;
    label.raycast = () => {};
    dock.add(label);
    btn.userData.labelMesh = label;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(BTN_R + 0.0015, BTN_R + 0.004, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    ring.position.copy(btn.position);
    ring.position.z = 0.002;
    ring.renderOrder = 10053;
    ring.frustumCulled = false;
    dock.add(ring);
    btn.userData.ring = ring;
  });
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, DOCK_TOOLS.length * BTN_GAP + 0.03),
    new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  );
  plate.position.z = -0.006;
  plate.renderOrder = 10040;
  plate.frustumCulled = false;
  dock.add(plate);
  // Stay unparented until a left grip connects
  xrHud.add(dock);

  let explorerPanel = null;
  let sessionIsPassthrough = false;

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
    if (id === "menu") {
      openMenuConsole({ tab: menuTab || "projects" });
      return;
    }
    if (id === "undo") {
      try { onUndo?.(); } catch (err) { console.warn("[viewport-xr] undo", err); }
      return;
    }
    if (id === "redo") {
      try { onRedo?.(); } catch (err) { console.warn("[viewport-xr] redo", err); }
      return;
    }
    if (id === "explorer") {
      openMenuConsole({ tab: "projects" });
      return;
    }
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
      return;
    }
    // Forward console tool rows through host callbacks
    runHostTool(id);
  }

  function runHostTool(id) {
    try {
      if (id === "prompt") {
        onPromptSubmit?.();
        return;
      }
      if (typeof onToolAction === "function") {
        onToolAction(id);
        return;
      }
    } catch (err) {
      console.warn("[viewport-xr] tool", id, err);
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
    lines.push({ id: "__saved__", label: "Last saved spot", active: false });
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

  function ensureMenuConsole() {
    if (explorerPanel) return explorerPanel;
    const canvas = drawConsoleCanvas({
      title: "Render Studio",
      tabs: MENU_TABS,
      activeTab: "projects",
      lines: [],
      footer: "Squeeze both grips to resize · grab title to move",
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(MENU_PLANE.w, MENU_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    plane.renderOrder = 2200;
    plane.frustumCulled = false;
    plane.userData.xrExplorerPanel = true;
    const titleBar = new THREE.Mesh(
      new THREE.PlaneGeometry(MENU_PLANE.w, 0.07),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    titleBar.position.y = MENU_PLANE.h / 2 - 0.035;
    titleBar.position.z = 0.002;
    titleBar.renderOrder = 2201;
    titleBar.frustumCulled = false;
    titleBar.userData.xrExplorerDrag = true;
    // Tab hit strips aligned to canvas tab row
    const tabHits = MENU_TABS.map((tab, i) => {
      const hit = new THREE.Mesh(
        new THREE.PlaneGeometry(0.13, 0.045),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.001,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      );
      const tabY = MENU_PLANE.h / 2 - ((MENU_CANVAS.tabStart + MENU_CANVAS.tabEnd) / 2 / MENU_CANVAS.h) * MENU_PLANE.h;
      const span = MENU_PLANE.w - 0.06;
      const tabW = span / Math.max(MENU_TABS.length, 1);
      hit.scale.set(tabW / 0.13, 1, 1);
      hit.position.set(-MENU_PLANE.w / 2 + 0.03 + tabW * (i + 0.5), tabY, 0.003);
      hit.renderOrder = 2202;
      hit.frustumCulled = false;
      hit.userData.xrMenuTab = tab.id;
      return hit;
    });
    explorerPanel = {
      group: new THREE.Group(),
      plane,
      titleBar,
      tabHits,
      tex,
      lines: [],
      kind: "menu",
    };
    explorerPanel.group.add(plane);
    explorerPanel.group.add(titleBar);
    tabHits.forEach((h) => explorerPanel.group.add(h));
    xrHud.add(explorerPanel.group);
    return explorerPanel;
  }

  function menuLinesForTab(tab) {
    if (tab === "projects") {
      let items = [];
      try { items = (typeof getProjects === "function" && getProjects()) || []; } catch { items = []; }
      if (!items.length) return [{ id: "", label: "No projects yet", active: false, kind: "hint", icon: "front" }];
      return items.slice(0, 9).map((it) => ({
        id: it.id,
        label: it.label || it.name || it.id,
        active: !!it.active,
        kind: "project",
        icon: "front",
      }));
    }
    if (tab === "parts") {
      let items = [];
      try { items = (typeof getExplorerItems === "function" && getExplorerItems()) || []; } catch { items = []; }
      if (!items.length) return [{ id: "", label: "No models in this project", active: false, kind: "hint", icon: "move" }];
      return items.slice(0, 9).map((it) => ({
        id: it.id || it.name || "",
        label: it.label || it.name || it.id,
        active: !!it.active,
        kind: "part",
        icon: "move",
      }));
    }
    if (tab === "files") {
      let items = [];
      try { items = (typeof getProjectFiles === "function" && getProjectFiles()) || []; } catch { items = []; }
      if (!items.length) return [{ id: "", label: "No files — upload on desktop/mobile", active: false, kind: "hint", icon: "export" }];
      return items.slice(0, 9).map((it) => ({
        id: it.id || it.name || "",
        label: it.label || it.name || it.id,
        active: !!it.active,
        kind: "file",
        icon: "export",
      }));
    }
    if (tab === "ai") {
      let draft = "";
      try { draft = String(getPromptDraft?.() || ""); } catch { draft = ""; }
      const listening = !!(typeof isTranscribing === "function" && isTranscribing());
      const preview = draft.trim() ? draft.trim().slice(0, 42) : "(empty prompt)";
      return [
        { id: "transcribe", label: listening ? "Stop transcribe" : "Transcribe (mic)", active: listening, kind: "action", icon: "mic" },
        { id: "prompt_preview", label: preview, active: false, kind: "hint", icon: "ai" },
        { id: "prompt", label: "Run AI prompt", active: false, kind: "action", icon: "ai" },
        { id: "prompt_clear", label: "Clear prompt", active: false, kind: "action", icon: "exit" },
        { id: "link_part", label: "Link selected model to prompt", active: false, kind: "action", icon: "move" },
      ];
    }
    if (tab === "tools") {
      return TOOL_ACTIONS.filter((a) => a.section === "tools").map((a) => ({
        id: a.id, label: a.label, active: false, kind: "action", icon: a.icon || "move",
      }));
    }
    return TOOL_ACTIONS.filter((a) => a.section === "view").map((a) => ({
      id: a.id, label: a.label, active: false, kind: "action", icon: a.icon || "fit",
    }));
  }

  function defaultMenuFooter() {
    if (menuFooterHint) return menuFooterHint;
    if (menuTab === "projects") return "Load any project · grab metal header to move panel";
    if (menuTab === "parts") return "Switch models in this project";
    if (menuTab === "files") return "Open / link project files";
    if (menuTab === "ai") return "Transcribe with mic · run prompt · link models";
    if (menuTab === "view") return "Capture & view tools · Share to X after capture";
    return "Tools · squeeze both grips to resize · undo/redo on left controller";
  }

  function openMenuConsole(opts = {}) {
    if (opts.tab) menuTab = opts.tab;
    if (typeof opts.footerHint === "string") menuFooterHint = opts.footerHint;
    const panel = ensureMenuConsole();
    const lines = menuLinesForTab(menuTab);
    panel.lines = lines;
    const canvas = drawConsoleCanvas({
      title: "RENDER STUDIO",
      tabs: MENU_TABS,
      activeTab: menuTab,
      lines,
      footer: defaultMenuFooter(),
    });
    panel.tex.image = canvas;
    panel.tex.needsUpdate = true;
    panel.group.visible = true;
    if (!opts.keepPose) {
      getHeadPose();
      const f = headForward();
      panel.group.position.copy(_headPos).addScaledVector(f, 0.95).add(new THREE.Vector3(-0.12, 0.02, 0));
      panel.group.quaternion.copy(_headQuat);
    }
  }

  function openExplorerPanel() {
    openMenuConsole({ tab: "projects" });
  }

  function clearMeasure() {
    measurePoints.length = 0;
    measureEdges.length = 0;
    measureHoverEdge = null;
    while (measureGroup.children.length) {
      const c = measureGroup.children.pop();
      c.geometry?.dispose?.();
      c.material?.map?.dispose?.();
      c.material?.dispose?.();
    }
    measureLine = null;
    measureLabel = null;
  }

  function pickMenuFromLocalPoint(local) {
    // Plane local: x in [-w/2, w/2], y in [-h/2, h/2]; top of panel = +y
    const halfW = MENU_PLANE.w / 2;
    const halfH = MENU_PLANE.h / 2;
    const u = (local.x + halfW) / MENU_PLANE.w;
    const fromTop = (halfH - local.y) / MENU_PLANE.h;
    if (u < 0 || u > 1 || fromTop < 0 || fromTop > 1) return null;

    const pxY = fromTop * MENU_CANVAS.h;
    if (pxY < MENU_CANVAS.headerEnd) return { kind: "explorer-drag" };
    if (pxY >= MENU_CANVAS.tabStart && pxY < MENU_CANVAS.tabEnd) {
      const tabIdx = Math.max(0, Math.min(MENU_TABS.length - 1, Math.floor(u * MENU_TABS.length)));
      return { kind: "menu-tab", tab: MENU_TABS[tabIdx].id };
    }
    if (pxY >= MENU_CANVAS.listTop && pxY < MENU_CANVAS.footerTop) {
      const idx = Math.floor((pxY - MENU_CANVAS.listTop) / MENU_CANVAS.rowH);
      if (idx < 0 || idx >= (explorerPanel?.lines?.length || 0)) return null;
      return { kind: "menu-row", line: explorerPanel.lines[idx] };
    }
    return null;
  }

  function pickWithController(controller) {
    if (!controller) return null;
    controller.updateMatrixWorld?.(true);
    _mat.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_mat);

    // XR console first when open — otherwise the left-hand Menu chip steals every select
    if (explorerPanel?.group.visible) {
      const titleHits = raycaster.intersectObject(explorerPanel.titleBar, false);
      if (titleHits.length) return { kind: "explorer-drag" };
      for (const tabHit of explorerPanel.tabHits || []) {
        if (raycaster.intersectObject(tabHit, false).length) {
          return { kind: "menu-tab", tab: tabHit.userData.xrMenuTab };
        }
      }
      const ph = raycaster.intersectObject(explorerPanel.plane, false);
      if (ph.length) {
        const local = explorerPanel.plane.worldToLocal(ph[0].point.clone());
        const menuHit = pickMenuFromLocalPoint(local);
        if (menuHit) return menuHit;
      }
    }

    // Dock chips on the left grip (only when not hitting the open console)
    const dockHits = raycaster.intersectObjects(dockButtons, false);
    if (dockHits.length) return { kind: "tool", tool: dockHits[0].object.userData.xrTool };

    // Place panel
    if (placePanel?.group.visible) {
      const ph = raycaster.intersectObject(placePanel.plane, false);
      if (ph.length) {
        const local = placePanel.plane.worldToLocal(ph[0].point.clone());
        const halfH = 0.19;
        const fromTop = (halfH - local.y) / 0.38;
        if (fromTop >= 0.16 && fromTop <= 0.9 && placePanel.lines?.length) {
          const idx = Math.floor(((fromTop - 0.16) / 0.74) * placePanel.lines.length);
          if (idx >= 0 && idx < placePanel.lines.length) {
            return { kind: "place", line: placePanel.lines[idx] };
          }
        }
      }
    }

    const mesh = getLiveMesh();
    if (mesh) {
      const hits = raycaster.intersectObject(mesh, true).filter((h) => h.object.isMesh);
      if (hits.length) {
        const hit = hits[0];
        if (activeTool === "measure") {
          try {
            const edge = nearestWorldEdgeFromHit(hit);
            if (edge && edge.pick_distance < Math.max(0.04, edge.length * 0.35)) {
              return { kind: "edge", edge, point: edge.closest.clone() };
            }
          } catch (err) {
            console.warn("[viewport-xr] edge snap", err);
          }
        }
        return { kind: "mesh", point: hit.point.clone() };
      }
    }
    return null;
  }

  function closestPointsOnSegments(a0, a1, b0, b1) {
    // Robust segment-segment closest points
    const u = a1.clone().sub(a0);
    const v = b1.clone().sub(b0);
    const w0 = a0.clone().sub(b0);
    const a = u.dot(u);
    const b = u.dot(v);
    const c = v.dot(v);
    const d = u.dot(w0);
    const e = v.dot(w0);
    const denom = a * c - b * b;
    let sc, tc;
    if (denom < 1e-12) {
      sc = 0;
      tc = (b > c ? d / b : e / c);
    } else {
      sc = (b * e - c * d) / denom;
      tc = (a * e - b * d) / denom;
    }
    sc = THREE.MathUtils.clamp(sc, 0, 1);
    tc = THREE.MathUtils.clamp(tc, 0, 1);
    const pa = a0.clone().addScaledVector(u, sc);
    const pb = b0.clone().addScaledVector(v, tc);
    return { pa, pb, dist: pa.distanceTo(pb) };
  }

  function addMeasureEdgeVisual(edge, color = 0xfbbf24) {
    const geo = new THREE.BufferGeometry().setFromPoints([edge.start, edge.end]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 2 }),
    );
    line.renderOrder = 2600;
    measureGroup.add(line);
    const ends = [edge.start, edge.end];
    for (const p of ends) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 10, 8),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      m.position.copy(p);
      m.renderOrder = 2601;
      measureGroup.add(m);
    }
  }

  function finishEdgeMeasure() {
    if (measureEdges.length < 2) return;
    const [e0, e1] = measureEdges;
    const { pa, pb, dist } = closestPointsOnSegments(e0.start, e0.end, e1.start, e1.end);
    measureLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([pa, pb]),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, depthTest: false }),
    );
    measureLine.renderOrder = 2610;
    measureGroup.add(measureLine);
    const worldDist = dist / Math.max(presentationScale, 1e-9);
    const mm = worldDist * (Number(getMmPerUnit?.()) || 1);
    const text = typeof formatLength === "function" ? formatLength(mm) : `${mm.toFixed(2)} mm`;
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 140;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(15,23,42,0.92)";
    ctx.fillRect(0, 0, 640, 140);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 632, 132);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 54px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 320, 70);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 28px Arial,sans-serif";
    ctx.fillText("edge distance", 320, 112);
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }),
    );
    sp.scale.set(0.32, 0.07, 1);
    sp.position.copy(pa).lerp(pb, 0.5);
    measureGroup.add(sp);
    measureLabel = sp;
  }

  function handleSelect(controller) {
    const now = performance.now();
    // Debounce double-fire from selectstart + leftover gamepad edges
    if (now - lastSelectAt < 160) return;
    lastSelectAt = now;

    const hit = pickWithController(controller);
    if (!hit) {
      if (activeTool === "grab" || activeTool === "rotate") {
        beginGrab(controller);
      }
      return;
    }
    if (hit.kind === "tool") {
      setTool(hit.tool);
      return;
    }
    if (hit.kind === "explorer-drag") {
      beginPanelDrag(controller, explorerPanel.group);
      return;
    }
    if (hit.kind === "menu-tab") {
      menuFooterHint = "";
      openMenuConsole({ tab: hit.tab, keepPose: true });
      return;
    }
    if (hit.kind === "menu-row") {
      const line = hit.line;
      if (!line?.id && line?.kind === "hint") return;
      if (line?.kind === "project" || menuTab === "projects") {
        if (line?.id) {
          try {
            onOpenProject?.(line.id);
          } catch (err) {
            console.warn("[viewport-xr] open project", err);
          }
          setTimeout(() => {
            if (presenting) openMenuConsole({ tab: "projects", keepPose: true });
          }, 600);
        }
        return;
      }
      if (line?.kind === "part" || menuTab === "parts") {
        if (line?.id) {
          try {
            onExplorerSelect?.(line.id);
          } catch (err) {
            console.warn("[viewport-xr] part select", err);
          }
          openMenuConsole({ tab: "parts", keepPose: true });
        }
        return;
      }
      if (line?.kind === "file" || menuTab === "files") {
        if (line?.id) {
          try {
            onExplorerSelect?.(line.id);
            onToolAction?.("link_file", line.id);
          } catch (err) {
            console.warn("[viewport-xr] file select", err);
          }
          openMenuConsole({ tab: "files", keepPose: true });
        }
        return;
      }
      if (menuTab === "ai") {
        if (line?.id === "transcribe") {
          try { onTranscribeToggle?.(); } catch (err) { console.warn("[viewport-xr] mic", err); }
          setTimeout(() => openMenuConsole({ tab: "ai", keepPose: true }), 200);
          return;
        }
        if (line?.id === "prompt_clear") {
          try { onToolAction?.("prompt_clear"); } catch (_) {}
          openMenuConsole({ tab: "ai", keepPose: true });
          return;
        }
        if (line?.id === "link_part") {
          try { onToolAction?.("link_part"); } catch (_) {}
          openMenuConsole({ tab: "ai", keepPose: true });
          return;
        }
        if (line?.id === "prompt") {
          try { onPromptSubmit?.(); } catch (_) {}
          return;
        }
        return;
      }
      // tools / view actions stay inside the general Menu console
      if (line?.id === "front" || line?.id === "place" || line?.id === "zoom_in" || line?.id === "zoom_out" || line?.id === "restore") {
        setTool(line.id);
        return;
      }
      if (line?.id === "screenshot" || line?.id === "record") {
        menuFooterHint = line.id === "record"
          ? "Recording… trigger Record again in View to stop"
          : "Capturing POV… Share to X opens when you exit VR";
        openMenuConsole({ tab: "view", keepPose: true });
        runHostTool(line.id);
        return;
      }
      runHostTool(line?.id);
      return;
    }
    if (hit.kind === "explorer") {
      if (hit.line?.id) onExplorerSelect?.(hit.line.id);
      return;
    }
    if (hit.kind === "place") {
      if (hit.line?.id === "__saved__") applySavedPose();
      else if (hit.line?.id) placeInFront({ spawnId: hit.line.id, keepZoom: false });
      openPlacePanel();
      return;
    }
    if (activeTool === "measure" && (hit.kind === "edge" || hit.kind === "mesh")) {
      if (measureEdges.length >= 2) clearMeasure();
      if (hit.kind === "edge" && hit.edge) {
        measureEdges.push(hit.edge);
        addMeasureEdgeVisual(hit.edge, measureEdges.length === 1 ? 0xfbbf24 : 0x38bdf8);
        if (measureEdges.length === 2) finishEdgeMeasure();
        return;
      }
      // Fallback: point pick if no edge snap
      measurePoints.push(hit.point);
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.01, 12, 10),
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
        const c = document.createElement("canvas");
        c.width = 512; c.height = 128;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "rgba(15,23,42,0.9)";
        ctx.fillRect(0, 0, 512, 128);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 56px Arial,sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(text, 256, 80);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
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
    if (panelDrag?.controller === controller) {
      panelDrag = null;
    }
  }

  function beginPanelDrag(controller, group) {
    if (!group) return;
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(controller.matrixWorld).invert();
    const local = new THREE.Matrix4().multiplyMatrices(inv, group.matrixWorld);
    const op = new THREE.Vector3();
    const oq = new THREE.Quaternion();
    const os = new THREE.Vector3();
    local.decompose(op, oq, os);
    panelDrag = { controller, group, offsetPos: op, offsetQuat: oq };
  }

  function updatePanelDrag() {
    if (!panelDrag?.group) return;
    const { controller, group, offsetPos, offsetQuat } = panelDrag;
    controller.updateMatrixWorld(true);
    const next = new THREE.Matrix4().compose(offsetPos, offsetQuat, new THREE.Vector3(1, 1, 1));
    const world = new THREE.Matrix4().multiplyMatrices(controller.matrixWorld, next);
    world.decompose(group.position, group.quaternion, _s);
    group.scale.set(1, 1, 1);
  }

  function setupControllers() {
    for (let i = 0; i < 2; i += 1) {
      const controller = renderer.xr.getController(i);
      controller.addEventListener("selectstart", (e) => handleSelect(e.target));
      controller.addEventListener("selectend", (e) => endGrab(e.target));
      controller.addEventListener("connected", (e) => {
        controller.userData.handedness = e.data?.handedness || "";
        controller.visible = presenting;
      });
      controller.addEventListener("disconnected", () => {
        controller.visible = false;
      });

      // Thin laser pointer only — no colored blobs (official grip model is the controller)
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, -1.5),
        ]),
        new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.65,
          depthTest: false,
        }),
      );
      ray.name = "xrRay";
      ray.renderOrder = 3000;
      ray.frustumCulled = false;
      controller.add(ray);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.006, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
      );
      tip.position.z = -1.5;
      tip.renderOrder = 3001;
      tip.frustumCulled = false;
      controller.add(tip);
      controller.visible = false;
      scene.add(controller);
      controllers.push(controller);

      const grip = renderer.xr.getControllerGrip(i);
      // Official Quest / Oculus controller mesh from WebXR input profiles
      const model = controllerModelFactory.createControllerModel(grip);
      model.frustumCulled = false;
      grip.add(model);
      grip.addEventListener("connected", (e) => {
        grip.userData.handedness = e.data?.handedness || "";
        grip.visible = presenting;
        // Prefer attaching the tool dock as soon as left grip appears
        if (presenting && grip.userData.handedness === "left") attachDockToLeftGrip();
      });
      grip.addEventListener("disconnected", () => {
        grip.visible = false;
      });
      grip.visible = false;
      scene.add(grip);
      grips.push(grip);

      const hand = renderer.xr.getHand(i);
      hand.add(handModelFactory.createHandModel(hand, "mesh"));
      hand.addEventListener("selectstart", (e) => handleSelect(e.target));
      hand.addEventListener("selectend", (e) => endGrab(e.target));
      hand.addEventListener("connected", (e) => {
        hand.userData.handedness = e.data?.handedness || "";
        hand.visible = presenting;
      });
      hand.addEventListener("disconnected", () => {
        hand.visible = false;
      });
      hand.visible = false;
      scene.add(hand);
      hands.push(hand);
    }
  }

  function getLeftGrip() {
    for (const g of grips) {
      if (g.userData.handedness === "left") return g;
    }
    // Fallback: Quest often reports left as index 0 before handedness arrives
    return grips[0] || null;
  }

  function attachDockToLeftGrip() {
    const left = getLeftGrip();
    if (!left) return false;
    if (dock.parent !== left) {
      if (dock.parent) dock.parent.remove(dock);
      left.add(dock);
    }
    // Meta-style: palette floats just above the left controller, facing inward/up
    dock.position.set(0.0, 0.055, 0.02);
    dock.rotation.set(-0.95, 0.0, 0.0);
    dock.scale.setScalar(1);
    dock.visible = true;
    return true;
  }

  function attachHudToCamera() {
    // Tools live on the left controller — not head-locked
    attachDockToLeftGrip();
    faceProbe.visible = false;
  }

  function detachHudFromCamera() {
    if (dock.parent && dock.parent !== xrHud) {
      dock.parent.remove(dock);
      xrHud.add(dock);
    }
    dock.visible = false;
    faceProbe.visible = false;
  }

  function updateDockFollow() {
    attachDockToLeftGrip();
    const pointer = controllers.find((c) => c.userData.handedness === "right")
      || controllers[1]
      || controllers[0];
    if (!pointer) return;
    const hit = pickWithController(pointer);
    dockButtons.forEach((btn) => {
      const hover = hit?.kind === "tool" && hit.tool === btn.userData.xrTool;
      const on = btn.userData.xrTool === activeTool;
      btn.scale.setScalar(hover ? 1.25 : on ? 1.12 : 1);
      if (btn.userData.ring) btn.userData.ring.material.opacity = hover || on ? 1 : 0;
    });
  }

  function pollGamepads() {
    const sess = renderer.xr.getSession?.();
    if (!sess) return;

    const squeezes = [false, false];
    const triggers = [false, false];
    const sourcesByHand = [null, null];
    let idx = 0;
    for (const source of sess.inputSources) {
      const gp = source.gamepad;
      if (!gp) continue;
      const handIndex = source.handedness === "left" ? 0 : source.handedness === "right" ? 1 : idx;
      sourcesByHand[handIndex] = source;
      triggers[handIndex] = !!(gp.buttons?.[0]?.pressed || (gp.buttons?.[0]?.value || 0) > 0.7);
      squeezes[handIndex] = !!(gp.buttons?.[1]?.pressed || (gp.buttons?.[1]?.value || 0) > 0.7);
      idx += 1;
    }

    // Triggers are handled by WebXR selectstart/selectend on the correct controller.
    // Do NOT re-fire from gamepad polling — handedness/index mismatch was always
    // activating the left dock Menu / first console row ("start position").
    for (let handIndex = 0; handIndex < 2; handIndex += 1) {
      prevTrigger[handIndex] = triggers[handIndex];
    }

    // Left squeeze alone opens console; both squeezes reserved for resize
    if (squeezes[0] && !squeezes[1] && !prevSqueeze[0]) {
      openMenuConsole({ tab: menuTab || "projects" });
    }
    prevSqueeze[0] = squeezes[0];
    prevSqueeze[1] = squeezes[1];

    // Stick zoom / rotate (right hand preferred)
    for (const source of sess.inputSources) {
      const gp = source.gamepad;
      if (!gp) continue;
      if (squeezes[0] && squeezes[1]) break;
      const ax = gp.axes || [];
      const axisX = ax.length >= 4 ? ax[2] : ax[0];
      const axisY = ax.length >= 4 ? ax[3] : ax[1];
      if (Math.abs(axisY || 0) > 0.25) applyZoom(Math.exp(-axisY * 0.03));
      if (Math.abs(axisX || 0) > 0.25 && getLiveMesh()) {
        getLiveMesh().rotation.y -= axisX * 0.045;
        saveRoomPose();
      }
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

  function controllerWorldPos(controller, out = new THREE.Vector3()) {
    controller.updateMatrixWorld(true);
    return controller.getWorldPosition(out);
  }

  /** Meta-style two-hand resize: squeeze both grips and pull apart / pinch */
  function updateTwoHandScale() {
    const sess = renderer.xr.getSession?.();
    if (!sess || controllers.length < 2) {
      if (scaleGrab) {
        scaleGrab = null;
        saveRoomPose();
      }
      return;
    }
    const mesh = getLiveMesh();
    if (!mesh) return;

    const squeezes = [false, false];
    let gi = 0;
    for (const source of sess.inputSources) {
      const gp = source.gamepad;
      if (!gp) continue;
      const handIndex = source.handedness === "left" ? 0 : source.handedness === "right" ? 1 : gi;
      // Quest squeeze = button 1
      const pressed = !!(gp.buttons?.[1]?.pressed || (gp.buttons?.[1]?.value || 0) > 0.7);
      squeezes[handIndex] = pressed;
      gi += 1;
    }

    const both = squeezes[0] && squeezes[1];
    if (!both) {
      if (scaleGrab) {
        scaleGrab = null;
        saveRoomPose();
      }
      prevSqueeze[0] = squeezes[0];
      prevSqueeze[1] = squeezes[1];
      return;
    }

    // Cancel one-hand grab while scaling
    grabState = null;

    const a = controllerWorldPos(controllers[0], new THREE.Vector3());
    const b = controllerWorldPos(controllers[1], new THREE.Vector3());
    const dist = Math.max(a.distanceTo(b), 1e-4);
    const mid = a.clone().lerp(b, 0.5);

    if (!scaleGrab) {
      mesh.updateMatrixWorld(true);
      const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      scaleGrab = {
        startDist: dist,
        startScale: presentationScale || mesh.scale.x || 1,
        startCenter: center.clone(),
        startMid: mid.clone(),
        startPos: mesh.position.clone(),
      };
      prevSqueeze[0] = true;
      prevSqueeze[1] = true;
      return;
    }

    const factor = THREE.MathUtils.clamp(dist / scaleGrab.startDist, 0.25, 4);
    const nextScale = scaleGrab.startScale * factor;
    const ratio = nextScale / Math.max(presentationScale, 1e-9);
    presentationScale = nextScale;
    baseScale = presentationScale / Math.max(userZoom, 1e-6);

    mesh.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    const parent = mesh.parent;
    const localCenter = parent ? parent.worldToLocal(center.clone()) : center.clone();
    mesh.scale.multiplyScalar(ratio);
    mesh.position.sub(localCenter).multiplyScalar(ratio).add(localCenter);

    // Follow midpoint delta so the model stays between your hands
    const midDelta = mid.clone().sub(scaleGrab.startMid);
    if (parent) {
      const wp = mesh.getWorldPosition(new THREE.Vector3()).add(midDelta);
      mesh.position.copy(parent.worldToLocal(wp));
      scaleGrab.startMid.copy(mid);
    } else {
      mesh.position.add(midDelta);
      scaleGrab.startMid.copy(mid);
    }
    mesh.updateMatrixWorld(true);
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
    sessionIsPassthrough = !!passthrough;
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
    camera.near = 0.02;
    camera.far = 200;
    camera.updateProjectionMatrix();
    try {
      session.updateRenderState({ depthNear: 0.02, depthFar: 200 });
    } catch {
      /* ignore */
    }

    presenting = true;
    xrHud.visible = true;
    attachHudToCamera();
    faceProbe.visible = false;
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
    if (explorerPanel) explorerPanel.group.visible = false;
    panelDrag = null;
    sessionIsPassthrough = false;
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
    scaleGrab = null;
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
    if (camera.near > 0.08 || camera.far < 50) {
      camera.near = 0.02;
      camera.far = 200;
      camera.updateProjectionMatrix();
    }
    // Keep AR passthrough clear — prevents black voids when looking around
    if (sessionIsPassthrough) {
      scene.background = null;
      scene.fog = null;
      renderer.setClearColor(0x000000, 0);
      renderer.setClearAlpha(0);
    }
    xrHud.visible = true;
    controllers.forEach((c) => {
      c.visible = true;
    });
    grips.forEach((g) => {
      g.visible = true;
    });
    updateTwoHandScale();
    updateGrab();
    updatePanelDrag();
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

  function capturePovDataUrl() {
    const hidePairs = [];
    const stash = (obj) => {
      if (!obj) return;
      hidePairs.push([obj, obj.visible]);
      obj.visible = false;
    };
    stash(dock);
    stash(explorerPanel?.group);
    stash(placePanel?.group);
    stash(measureGroup);
    stash(faceProbe);
    stash(beacon);
    try {
      // Prefer the live XR camera when presenting
      const xrCam = renderer.xr?.isPresenting ? renderer.xr.getCamera?.(camera) : null;
      renderer.render(scene, xrCam || camera);
      const url = renderer.domElement?.toDataURL?.("image/png");
      if (url && url.startsWith("data:image/") && url.length > 2000) return url;
    } catch (err) {
      console.warn("[viewport-xr] capture failed", err);
    } finally {
      for (const [obj, vis] of hidePairs) obj.visible = vis;
    }
    return null;
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
    capturePovDataUrl,
    openMenuConsole,
    setMenuFooterHint: (hint) => {
      menuFooterHint = String(hint || "");
      if (presenting && explorerPanel?.group.visible) {
        openMenuConsole({ tab: menuTab, keepPose: true });
      }
    },
  };
}
