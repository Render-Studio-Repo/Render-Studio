/**
 * Viewport WebXR / AR for Meta Quest 3
 *
 * - Prefers immersive-ar (passthrough in your room); falls back to immersive-vr
 * - Places the model in front of your head (not a fixed world direction)
 * - Thumbstick / Zoom tools to scale like other Quest apps
 * - Left-hand tool dock: point with the other controller + trigger to click
 * - Movable spatial panels (AI Prompt, Explorer) you can grab and arrange in space
 */

import * as THREE from "three";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";

const DOCK_TOOLS = [
  { id: "grab", label: "Move", color: 0x3b82f6, glyph: "✋" },
  { id: "measure", label: "Measure", color: 0xf59e0b, glyph: "📏" },
  { id: "zoom_in", label: "Zoom+", color: 0x22c55e, glyph: "+" },
  { id: "zoom_out", label: "Zoom−", color: 0x14b8a6, glyph: "−" },
  { id: "recenter", label: "Front", color: 0xa78bfa, glyph: "⌂" },
  { id: "panel_prompt", label: "AI", color: 0xec4899, glyph: "✦" },
  { id: "panel_explorer", label: "Files", color: 0x38bdf8, glyph: "☰" },
  { id: "clear", label: "Clear", color: 0x94a3b8, glyph: "⌫" },
  { id: "exit", label: "Exit", color: 0xef4444, glyph: "✕" },
];

function makeIconTexture(glyph, bgHex, label) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const r = size * 0.44;
  const cx = size / 2;
  const cy = size / 2;
  ctx.clearRect(0, 0, size, size);
  const c = new THREE.Color(bgHex);
  const light = c.clone().multiplyScalar(1.35);
  light.r = Math.min(1, light.r);
  light.g = Math.min(1, light.g);
  light.b = Math.min(1, light.b);
  const grad = ctx.createRadialGradient(cx, cy - 24, 8, cx, cy, r);
  grad.addColorStop(0, `#${light.getHexString()}`);
  grad.addColorStop(1, `#${c.getHexString()}`);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.stroke();
  ctx.font = "bold 92px system-ui,Segoe UI,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(glyph, cx, cy - (label ? 10 : 0));
  if (label) {
    ctx.font = "bold 34px system-ui,Segoe UI,sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(label, cx, cy + 72);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeLabelSprite(text, { scale = 0.12 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "bold 72px system-ui,Segoe UI,sans-serif";
  const padX = 36;
  const tw = Math.min(ctx.measureText(text).width + padX * 2, canvas.width - 8);
  const th = 120;
  const x = (canvas.width - tw) / 2;
  const y = (canvas.height - th) / 2;
  ctx.fillStyle = "rgba(12, 18, 32, 0.88)";
  roundRect(ctx, x, y, tw, th, 48);
  ctx.fill();
  ctx.strokeStyle = "rgba(96, 165, 250, 0.7)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale * 2.4, scale * 0.6, 1);
  sprite.renderOrder = 999;
  return sprite;
}

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

function drawPanelCanvas(title, lines, { width = 1024, height = 768, footer = "" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
  roundRect(ctx, 0, 0, width, height, 36);
  ctx.fill();
  // Title bar (grab zone visual)
  ctx.fillStyle = "rgba(30, 41, 59, 0.98)";
  roundRect(ctx, 0, 0, width, 96, 36);
  ctx.fill();
  ctx.fillStyle = "rgba(30, 41, 59, 0.98)";
  ctx.fillRect(0, 48, width, 48);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 44px system-ui,Segoe UI,sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, 36, 48);
  ctx.fillStyle = "rgba(148, 163, 184, 0.9)";
  ctx.font = "28px system-ui,Segoe UI,sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("⠿ drag title", width - 36, 48);

  ctx.textAlign = "left";
  ctx.font = "36px system-ui,Segoe UI,sans-serif";
  let y = 140;
  const maxLines = Math.floor((height - 180) / 52);
  const shown = lines.slice(0, maxLines);
  shown.forEach((line, i) => {
    const rowY = y + i * 52;
    if (i % 2 === 0) {
      ctx.fillStyle = "rgba(51, 65, 85, 0.35)";
      ctx.fillRect(20, rowY - 28, width - 40, 48);
    }
    ctx.fillStyle = line.active ? "#7dd3fc" : "#f1f5f9";
    ctx.fillText(line.label.slice(0, 42), 40, rowY);
  });
  if (footer) {
    ctx.fillStyle = "rgba(56, 189, 248, 0.95)";
    ctx.font = "bold 32px system-ui,Segoe UI,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(footer, width / 2, height - 40);
  }
  return canvas;
}

/**
 * @param {object} opts
 */
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
    getExplorerItems = null,
    onExplorerSelect = null,
    getPromptDraft = null,
    onPromptSubmit = null,
    hideSceneChrome = null,
    restoreSceneChrome = null,
  } = opts;

  if (!renderer) throw new Error("createViewportXR: renderer required");

  let supported = false;
  let sessionMode = "immersive-vr";
  let session = null;
  let presenting = false;
  let activeTool = "grab";
  let basePresentationScale = 1;
  let userZoom = 1;
  let presentationScale = 1;

  const xrRoot = new THREE.Group();
  xrRoot.name = "xrRoot";
  xrRoot.visible = false;
  scene.add(xrRoot);

  const panelsRoot = new THREE.Group();
  panelsRoot.name = "xrPanels";
  xrRoot.add(panelsRoot);

  const controllers = [];
  const grips = [];
  const hands = [];
  const raycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4();
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _scale = new THREE.Vector3();
  const _forward = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _headPos = new THREE.Vector3();
  const _headQuat = new THREE.Quaternion();

  let savedMesh = null;
  let savedPos = null;
  let savedQuat = null;
  let savedScale = null;
  let savedBackground = null;
  let savedBgWasNull = false;
  let grabState = null; // model or panel
  let panelDrag = null;

  // Measure
  const measureGroup = new THREE.Group();
  measureGroup.name = "xrMeasure";
  xrRoot.add(measureGroup);
  const measurePoints = [];
  let measureLine = null;
  let measureLabel = null;
  let hoverMarker = null;

  // Left-hand dock (vertical Meta-style tool strip)
  const dock = new THREE.Group();
  dock.name = "xrLeftDock";
  dock.visible = false;
  const dockButtons = [];
  const BUTTON_R = 0.028;
  const BUTTON_GAP = 0.062;
  DOCK_TOOLS.forEach((tool, i) => {
    const geo = new THREE.CircleGeometry(BUTTON_R, 40);
    const mat = new THREE.MeshBasicMaterial({
      map: makeIconTexture(tool.glyph, tool.color, tool.label),
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const y = ((DOCK_TOOLS.length - 1) / 2 - i) * BUTTON_GAP;
    mesh.position.set(0, y, 0);
    mesh.userData.xrTool = tool.id;
    mesh.renderOrder = 1000;
    dock.add(mesh);
    dockButtons.push(mesh);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(BUTTON_R + 0.002, BUTTON_R + 0.006, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    ring.position.copy(mesh.position);
    ring.renderOrder = 1001;
    dock.add(ring);
    mesh.userData.ring = ring;
  });
  // Backplate
  const plateH = DOCK_TOOLS.length * BUTTON_GAP + 0.04;
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.09, plateH),
    new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.72,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  );
  plate.position.z = -0.01;
  plate.renderOrder = 990;
  dock.add(plate);

  const controllerModelFactory = new XRControllerModelFactory();
  const handModelFactory = new XRHandModelFactory();

  function attachDockTo(parent, { isHand = false } = {}) {
    if (!parent || dock.parent === parent) {
      if (parent) parent.add(dock);
      return;
    }
    parent.add(dock);
    if (isHand) {
      // Sit above the palm, facing outward for pointing
      dock.position.set(0, 0.04, 0.08);
      dock.rotation.set(-Math.PI / 2.4, 0, 0);
    } else {
      dock.position.set(0.02, 0.1, -0.08);
      dock.rotation.set(-0.55, 0.15, 0.08);
    }
    dock.visible = presenting;
  }

  function setInputVisible(on) {
    controllers.forEach((c) => {
      c.visible = !!on;
    });
    grips.forEach((g) => {
      g.visible = !!on;
    });
    hands.forEach((h) => {
      h.visible = !!on;
    });
    dock.visible = !!on;
  }

  /** @type {Map<string, {group: THREE.Group, plane: THREE.Mesh, titleHit: THREE.Mesh, kind: string, tex: THREE.CanvasTexture, lines: any[]}>} */
  const panels = new Map();

  function setButtonUi(active) {
    if (!buttonEl) return;
    buttonEl.classList.toggle("active", !!active);
    buttonEl.setAttribute("aria-pressed", active ? "true" : "false");
    buttonEl.title = active ? "Exit AR/VR" : "Enter AR (Meta Quest — view in your room)";
  }

  function flashTool(id) {
    const btn = dockButtons.find((b) => b.userData.xrTool === id);
    if (!btn) return;
    btn.scale.setScalar(1.28);
    setTimeout(() => {
      btn.scale.setScalar(btn.userData.xrTool === activeTool ? 1.14 : 1);
    }, 160);
  }

  function syncDockSelection() {
    dockButtons.forEach((btn) => {
      const on = btn.userData.xrTool === activeTool;
      btn.scale.setScalar(on ? 1.14 : 1);
      if (btn.userData.ring) btn.userData.ring.material.opacity = on ? 0.9 : 0;
    });
  }

  function getHeadPose() {
    const xrCam = renderer.xr.getCamera?.();
    if (xrCam) {
      xrCam.getWorldPosition(_headPos);
      xrCam.getWorldQuaternion(_headQuat);
      return true;
    }
    camera.getWorldPosition(_headPos);
    camera.getWorldQuaternion(_headQuat);
    return false;
  }

  function headForward(out = _forward) {
    out.set(0, 0, -1).applyQuaternion(_headQuat);
    out.y = 0;
    if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
    else out.normalize();
    return out;
  }

  function applyUserZoom(factor) {
    userZoom = THREE.MathUtils.clamp(userZoom * factor, 0.15, 8);
    presentationScale = basePresentationScale * userZoom;
    // Scale mesh about its current center
    const mesh = getMeshRoot?.();
    if (!mesh || !savedMesh) return;
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const ratio = factor;
    mesh.scale.multiplyScalar(ratio);
    mesh.position.sub(center).multiplyScalar(ratio).add(center);
    mesh.updateMatrixWorld(true);
  }

  function placeModelInFront({ distance = 0.95, heightOffset = -0.12 } = {}) {
    const mesh = getMeshRoot?.();
    if (!mesh) return;

    if (!savedMesh) {
      savedMesh = mesh;
      savedPos = mesh.position.clone();
      savedQuat = mesh.quaternion.clone();
      savedScale = mesh.scale.clone();
    } else {
      mesh.position.copy(savedPos);
      mesh.quaternion.copy(savedQuat);
      mesh.scale.copy(savedScale);
    }
    mesh.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    // Comfortable handheld / desk size in room (~40cm)
    basePresentationScale = 0.4 / maxDim;
    presentationScale = basePresentationScale * userZoom;

    getHeadPose();
    const forward = headForward();
    const targetCenter = _headPos
      .clone()
      .addScaledVector(forward, distance)
      .addScaledVector(_up, heightOffset);

    // CAD Z-up → room Y-up, then yaw so the model faces the user
    const zUpToYUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const faceUser = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), // after z-up→y-up, original -Y often faces "front"; use +Z as facing axis in Y-up
      forward.clone().negate(), // face toward head
    );
    // Prefer yaw-only facing so model stays upright
    const flatAway = forward.clone().negate();
    flatAway.y = 0;
    if (flatAway.lengthSq() > 1e-6) {
      flatAway.normalize();
      faceUser.setFromUnitVectors(new THREE.Vector3(0, 0, 1), flatAway);
    }
    const orient = faceUser.clone().multiply(zUpToYUp);

    const toOrigin = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
    const sc = new THREE.Matrix4().makeScale(presentationScale, presentationScale, presentationScale);
    const rot = new THREE.Matrix4().makeRotationFromQuaternion(orient);
    const toTarget = new THREE.Matrix4().makeTranslation(targetCenter.x, targetCenter.y, targetCenter.z);
    const present = new THREE.Matrix4().multiplyMatrices(toTarget, rot).multiply(sc).multiply(toOrigin);

    const world = mesh.matrixWorld.clone();
    const nextWorld = new THREE.Matrix4().multiplyMatrices(present, world);
    if (mesh.parent) {
      const parentInv = new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert();
      new THREE.Matrix4().multiplyMatrices(parentInv, nextWorld).decompose(
        mesh.position,
        mesh.quaternion,
        mesh.scale,
      );
    } else {
      nextWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    }
    mesh.updateMatrixWorld(true);
  }

  function restoreMeshTransform() {
    if (!savedMesh) return;
    savedMesh.position.copy(savedPos);
    savedMesh.quaternion.copy(savedQuat);
    savedMesh.scale.copy(savedScale);
    savedMesh.updateMatrixWorld(true);
    savedMesh = null;
    savedPos = savedQuat = savedScale = null;
  }

  function clearMeasure() {
    measurePoints.length = 0;
    while (measureGroup.children.length) {
      const c = measureGroup.children.pop();
      c.geometry?.dispose?.();
      if (c.material?.map) c.material.map.dispose?.();
      c.material?.dispose?.();
    }
    measureLine = null;
    measureLabel = null;
    hoverMarker = null;
  }

  function addMeasureMarker(worldPoint, color = 0xfbbf24) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 18, 14),
      new THREE.MeshBasicMaterial({ color, depthTest: true }),
    );
    m.position.copy(worldPoint);
    measureGroup.add(m);
    return m;
  }

  function updateMeasureVisuals() {
    if (measureLine) {
      measureGroup.remove(measureLine);
      measureLine.geometry.dispose();
      measureLine.material.dispose();
      measureLine = null;
    }
    if (measureLabel) {
      measureGroup.remove(measureLabel);
      measureLabel.material.map?.dispose?.();
      measureLabel.material.dispose();
      measureLabel = null;
    }
    if (measurePoints.length === 2) {
      const [a, b] = measurePoints;
      measureLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false }),
      );
      measureLine.renderOrder = 998;
      measureGroup.add(measureLine);
      const worldDist = a.distanceTo(b);
      const modelDist = worldDist / Math.max(presentationScale, 1e-9);
      const mm = modelDist * (Number(getMmPerUnit?.()) || 1);
      const label = typeof formatLength === "function" ? formatLength(mm) : `${mm.toFixed(2)} mm`;
      measureLabel = makeLabelSprite(label, { scale: 0.16 });
      measureLabel.position.copy(a).lerp(b, 0.5);
      measureLabel.position.y += 0.035;
      measureGroup.add(measureLabel);
    }
  }

  function refreshPanelTexture(kind) {
    const panel = panels.get(kind);
    if (!panel) return;
    let lines = [];
    let footer = "Trigger a row to select";
    if (kind === "explorer") {
      const items = (typeof getExplorerItems === "function" ? getExplorerItems() : []) || [];
      lines = items.slice(0, 12).map((it) => ({
        label: it.label || it.name || "Item",
        id: it.id || it.name,
        active: !!it.active,
      }));
      if (!lines.length) lines = [{ label: "(no files in project)", id: null }];
      footer = "Point + trigger to open · drag title to move";
    } else if (kind === "prompt") {
      const draft = (typeof getPromptDraft === "function" ? getPromptDraft() : "") || "";
      const preview = draft.trim() || "(empty — edit on desktop, then submit here)";
      const chunks = preview.match(/.{1,40}/g) || [preview];
      lines = chunks.slice(0, 8).map((t, i) => ({ label: t, id: `line-${i}` }));
      lines.push({ label: "▶  Submit prompt", id: "__submit__", active: true });
      footer = "Drag title to place panel in your room";
    }
    panel.lines = lines;
    const canvas = drawPanelCanvas(kind === "prompt" ? "AI Prompt" : "Explorer", lines, {
      footer,
    });
    panel.tex.image = canvas;
    panel.tex.needsUpdate = true;
  }

  function spawnPanel(kind) {
    if (panels.has(kind)) {
      refreshPanelTexture(kind);
      const existing = panels.get(kind);
      existing.group.visible = true;
      // Bring in front of user again
      getHeadPose();
      const forward = headForward();
      existing.group.position.copy(_headPos).addScaledVector(forward, 0.85).addScaledVector(_up, kind === "prompt" ? 0.05 : -0.05);
      existing.group.position.addScaledVector(new THREE.Vector3().crossVectors(_up, forward).normalize(), kind === "prompt" ? 0.35 : -0.35);
      existing.group.quaternion.copy(_headQuat);
      return;
    }

    const canvas = drawPanelCanvas(kind === "prompt" ? "AI Prompt" : "Explorer", [], {});
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const w = 0.55;
    const h = 0.42;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: true,
      }),
    );
    plane.userData.xrPanel = kind;
    plane.userData.xrPanelBody = true;

    // Invisible thicker title hit target (top ~18% of panel)
    const titleHit = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h * 0.16),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    titleHit.position.y = h * 0.42;
    titleHit.userData.xrPanel = kind;
    titleHit.userData.xrPanelTitle = true;

    const group = new THREE.Group();
    group.name = `xrPanel-${kind}`;
    group.add(plane);
    group.add(titleHit);
    panelsRoot.add(group);

    panels.set(kind, { group, plane, titleHit, kind, tex, lines: [] });
    refreshPanelTexture(kind);

    getHeadPose();
    const forward = headForward();
    const side = new THREE.Vector3().crossVectors(_up, forward).normalize();
    group.position
      .copy(_headPos)
      .addScaledVector(forward, 0.9)
      .addScaledVector(_up, kind === "prompt" ? 0.08 : -0.02)
      .addScaledVector(side, kind === "prompt" ? 0.4 : -0.4);
    group.quaternion.copy(_headQuat);
  }

  function disposePanels() {
    for (const panel of panels.values()) {
      panelsRoot.remove(panel.group);
      panel.plane.geometry.dispose();
      panel.plane.material.map?.dispose?.();
      panel.plane.material.dispose();
      panel.titleHit.geometry.dispose();
      panel.titleHit.material.dispose();
      panel.tex.dispose();
    }
    panels.clear();
  }

  function getPickables() {
    const root = getMeshRoot?.();
    if (!root) return [];
    const list = [];
    root.traverse((o) => {
      if (o.isMesh && o.visible && !o.userData?.isEdge && !o.userData?.isSilhouette) list.push(o);
    });
    return list;
  }

  function allPanelMeshes() {
    const out = [];
    for (const p of panels.values()) {
      if (!p.group.visible) continue;
      out.push(p.plane, p.titleHit);
    }
    return out;
  }

  function raycastController(controller) {
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    // Dock first
    if (dock.visible) {
      const hits = raycaster.intersectObjects(dockButtons, false);
      if (hits.length) {
        return { kind: "tool", tool: hits[0].object.userData.xrTool, point: hits[0].point };
      }
    }

    // Spatial panels
    const panelHits = raycaster.intersectObjects(allPanelMeshes(), false);
    if (panelHits.length) {
      const obj = panelHits[0].object;
      const kind = obj.userData.xrPanel;
      const panel = panels.get(kind);
      const local = panel.plane.worldToLocal(panelHits[0].point.clone());
      // PlaneGeometry is centered; x in [-w/2,w/2], y in [-h/2,h/2]
      const w = 0.55;
      const h = 0.42;
      const u = (local.x + w / 2) / w;
      const v = 1 - (local.y + h / 2) / h; // 0 top → 1 bottom
      return {
        kind: "panel",
        panelKind: kind,
        isTitle: !!obj.userData.xrPanelTitle || v < 0.14,
        u,
        v,
        point: panelHits[0].point.clone(),
        object: obj,
      };
    }

    const meshHits = raycaster.intersectObjects(getPickables(), false);
    if (meshHits.length) {
      return { kind: "mesh", point: meshHits[0].point.clone(), object: meshHits[0].object };
    }
    return null;
  }

  function handlePanelClick(hit) {
    const panel = panels.get(hit.panelKind);
    if (!panel) return;
    if (hit.isTitle) return; // drag handled separately
    // Map v into row index (content starts ~after title)
    const contentV = (hit.v - 0.14) / 0.78;
    if (contentV < 0 || contentV > 1) return;
    const idx = Math.floor(contentV * Math.max(panel.lines.length, 1));
    const line = panel.lines[idx];
    if (!line) return;
    if (hit.panelKind === "explorer" && line.id != null) {
      try {
        onExplorerSelect?.(line.id, line);
      } catch (e) {
        console.warn("[xr] explorer select", e);
      }
      refreshPanelTexture("explorer");
    }
    if (hit.panelKind === "prompt" && line.id === "__submit__") {
      try {
        onPromptSubmit?.();
      } catch (e) {
        console.warn("[xr] prompt submit", e);
      }
      flashTool("panel_prompt");
    }
  }

  function setTool(id) {
    if (id === "recenter") {
      userZoom = 1;
      placeModelInFront();
      flashTool("recenter");
      return;
    }
    if (id === "zoom_in") {
      applyUserZoom(1.18);
      flashTool("zoom_in");
      return;
    }
    if (id === "zoom_out") {
      applyUserZoom(1 / 1.18);
      flashTool("zoom_out");
      return;
    }
    if (id === "clear") {
      clearMeasure();
      flashTool("clear");
      return;
    }
    if (id === "exit") {
      exit();
      return;
    }
    if (id === "panel_prompt") {
      spawnPanel("prompt");
      flashTool("panel_prompt");
      return;
    }
    if (id === "panel_explorer") {
      spawnPanel("explorer");
      flashTool("panel_explorer");
      return;
    }
    if (!DOCK_TOOLS.some((t) => t.id === id)) return;
    activeTool = id;
    syncDockSelection();
  }

  function onSelectStart(event) {
    const controller = event.target;
    const hit = raycastController(controller);

    if (hit?.kind === "tool") {
      setTool(hit.tool);
      return;
    }

    if (hit?.kind === "panel") {
      if (hit.isTitle) {
        const panel = panels.get(hit.panelKind);
        if (!panel) return;
        panel.group.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(controller.matrixWorld).invert();
        const local = new THREE.Matrix4().multiplyMatrices(inv, panel.group.matrixWorld);
        local.decompose(_v, _q, _scale);
        panelDrag = {
          controller,
          panelKind: hit.panelKind,
          offsetPos: _v.clone(),
          offsetQuat: _q.clone(),
          offsetScale: _scale.clone(),
        };
        return;
      }
      handlePanelClick(hit);
      return;
    }

    if (activeTool === "measure") {
      if (!hit || hit.kind !== "mesh") return;
      if (measurePoints.length >= 2) clearMeasure();
      measurePoints.push(hit.point.clone());
      addMeasureMarker(hit.point);
      updateMeasureVisuals();
      return;
    }

    if (activeTool === "grab" && hit?.kind === "mesh") {
      const mesh = getMeshRoot?.();
      if (!mesh) return;
      mesh.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(controller.matrixWorld).invert();
      const local = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      local.decompose(_v, _q, _scale);
      grabState = {
        controller,
        offsetPos: _v.clone(),
        offsetQuat: _q.clone(),
        offsetScale: _scale.clone(),
      };
    }
  }

  function onSelectEnd(event) {
    const controller = event.target;
    if (grabState?.controller === controller) grabState = null;
    if (panelDrag?.controller === controller) panelDrag = null;
  }

  function setupControllers() {
    for (let i = 0; i < 2; i += 1) {
      const controller = renderer.xr.getController(i);
      controller.addEventListener("selectstart", onSelectStart);
      controller.addEventListener("selectend", onSelectEnd);
      controller.addEventListener("connected", (event) => {
        controller.visible = presenting;
        // Controllers provide a target ray; keep it bright in passthrough
        const style = event?.data?.targetRayMode;
        controller.userData.targetRayMode = style || "";
      });
      controller.addEventListener("disconnected", () => {
        controller.visible = false;
      });

      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1.5),
      ]);
      const line = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({
          color: 0x7dd3fc,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        }),
      );
      line.name = "xrRay";
      line.renderOrder = 1005;
      controller.add(line);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
      );
      tip.position.z = -1.5;
      tip.renderOrder = 1006;
      controller.add(tip);
      controller.visible = false;
      scene.add(controller);
      controllers.push(controller);

      const grip = renderer.xr.getControllerGrip(i);
      const ctrlModel = controllerModelFactory.createControllerModel(grip);
      grip.add(ctrlModel);
      // Always-on bright marker so a hand/controller is visible even if GLTF models fail
      const fallback = new THREE.Group();
      fallback.name = "xrGripFallback";
      const palm = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.015, 0.08),
        new THREE.MeshBasicMaterial({ color: i === 0 ? 0x38bdf8 : 0xf472b6 }),
      );
      palm.position.z = 0.02;
      fallback.add(palm);
      const knuckle = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      knuckle.position.set(0, 0.01, -0.02);
      fallback.add(knuckle);
      grip.add(fallback);
      grip.addEventListener("connected", (event) => {
        grip.visible = presenting;
        // Hide crude fallback once a real controller model profile connects
        const hasGamepad = !!event?.data?.gamepad;
        fallback.visible = !hasGamepad;
        if (i === 0) attachDockTo(grip, { isHand: false });
      });
      grip.addEventListener("disconnected", () => {
        grip.visible = false;
      });
      grip.visible = false;
      scene.add(grip);
      grips.push(grip);

      // Tracked hands (Quest hand tracking — put controllers down / enable Hand Tracking)
      const hand = renderer.xr.getHand(i);
      // Sphere joints always render (no GLB fetch). Visible in passthrough AR.
      hand.add(handModelFactory.createHandModel(hand, "spheres"));
      hand.addEventListener("selectstart", onSelectStart);
      hand.addEventListener("selectend", onSelectEnd);
      hand.addEventListener("connected", (event) => {
        hand.visible = presenting;
        if (event?.data?.hand && i === 0) {
          attachDockTo(hand, { isHand: true });
        }
      });
      hand.addEventListener("disconnected", () => {
        hand.visible = false;
      });
      hand.visible = false;
      scene.add(hand);
      hands.push(hand);

      if (i === 0) {
        // Default dock on left grip until a hand/controller connects
        attachDockTo(grip, { isHand: false });
      }
    }
  }

  function pollThumbsticks() {
    const src = renderer.xr.getSession?.();
    if (!src) return;
    for (const source of src.inputSources) {
      const gp = source.gamepad;
      if (!gp?.axes?.length) continue;
      // Quest: axes[2], axes[3] often thumbstick X/Y (or 0/1)
      const axisY = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1];
      if (!Number.isFinite(axisY) || Math.abs(axisY) < 0.2) continue;
      // Hold stick: continuous zoom
      const factor = Math.exp(-axisY * 0.035);
      applyUserZoom(factor);
    }
  }

  function updateGrab() {
    if (grabState) {
      const mesh = getMeshRoot?.();
      if (mesh) {
        const { controller, offsetPos, offsetQuat, offsetScale } = grabState;
        controller.updateMatrixWorld(true);
        const next = new THREE.Matrix4().compose(offsetPos, offsetQuat, offsetScale);
        const world = new THREE.Matrix4().multiplyMatrices(controller.matrixWorld, next);
        if (mesh.parent) {
          const parentInv = new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert();
          new THREE.Matrix4().multiplyMatrices(parentInv, world).decompose(
            mesh.position,
            mesh.quaternion,
            mesh.scale,
          );
        } else {
          world.decompose(mesh.position, mesh.quaternion, mesh.scale);
        }
      }
    }
    if (panelDrag) {
      const panel = panels.get(panelDrag.panelKind);
      if (panel) {
        const { controller, offsetPos, offsetQuat, offsetScale } = panelDrag;
        controller.updateMatrixWorld(true);
        const next = new THREE.Matrix4().compose(offsetPos, offsetQuat, offsetScale);
        const world = new THREE.Matrix4().multiplyMatrices(controller.matrixWorld, next);
        world.decompose(panel.group.position, panel.group.quaternion, panel.group.scale);
      }
    }
  }

  function updateHover(controller) {
    const hit = raycastController(controller);
    dockButtons.forEach((btn) => {
      const hover = hit?.kind === "tool" && hit.tool === btn.userData.xrTool;
      const selected = btn.userData.xrTool === activeTool;
      btn.scale.setScalar(hover ? 1.24 : selected ? 1.14 : 1);
      if (btn.userData.ring) btn.userData.ring.material.opacity = hover ? 1 : selected ? 0.9 : 0;
    });

    if (activeTool === "measure") {
      if (!hoverMarker) {
        hoverMarker = new THREE.Mesh(
          new THREE.SphereGeometry(0.008, 14, 12),
          new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
          }),
        );
        hoverMarker.renderOrder = 997;
        measureGroup.add(hoverMarker);
      }
      if (hit?.kind === "mesh") {
        hoverMarker.visible = true;
        hoverMarker.position.copy(hit.point);
      } else if (hoverMarker) hoverMarker.visible = false;
    } else if (hoverMarker) hoverMarker.visible = false;
  }

  function billboardPanels() {
    // Keep slight face-to-user while free-floating (optional soft billboard of title only — skip full billboard so arranged layout stays)
    if (measureLabel && renderer.xr.getCamera) {
      measureLabel.quaternion.copy(renderer.xr.getCamera().quaternion);
    }
  }

  async function pickSessionMode() {
    if (!navigator.xr) return null;
    try {
      if (await navigator.xr.isSessionSupported("immersive-ar")) return "immersive-ar";
    } catch (_) {
      /* continue */
    }
    try {
      if (await navigator.xr.isSessionSupported("immersive-vr")) return "immersive-vr";
    } catch (_) {
      /* continue */
    }
    return null;
  }

  async function enter() {
    if (presenting) return;
    if (!navigator.xr) return;
    const mode = (await pickSessionMode()) || sessionMode;
    sessionMode = mode;
    try {
      renderer.xr.enabled = true;
      // Passthrough / AR: clear background so the room shows through
      savedBackground = scene.background;
      savedBgWasNull = scene.background == null;
      if (mode === "immersive-ar") {
        scene.background = null;
        renderer.setClearAlpha?.(0);
      }
      session = await navigator.xr.requestSession(mode, {
        optionalFeatures: [
          "local-floor",
          "bounded-floor",
          "hand-tracking",
          "layers",
          "dom-overlay",
          "hit-test",
        ],
      });
      await renderer.xr.setSession(session);
      presenting = true;
      userZoom = 1;
      xrRoot.visible = true;
      setInputVisible(true);
      // If hand tracking is available, Quest will fire hand `connected` and show mesh hands.
      // Keep controllers visible too when Touch controllers are in use.
      if (controls) controls.enabled = false;
      if (transformControls) transformControls.enabled = false;
      try {
        hideSceneChrome?.();
      } catch (_) {
        /* ignore */
      }
      // Wait one frame so XR camera pose is valid, then place model in front of you
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      placeModelInFront();
      clearMeasure();
      activeTool = "grab";
      syncDockSelection();
      setButtonUi(true);
      onPresentingChange?.(true);
      session.addEventListener("end", onSessionEnd);
    } catch (err) {
      console.warn("[viewport-xr] failed to enter", err);
      presenting = false;
      renderer.xr.enabled = false;
      if (!savedBgWasNull) scene.background = savedBackground;
      setButtonUi(false);
      throw err;
    }
  }

  function onSessionEnd() {
    presenting = false;
    session = null;
    xrRoot.visible = false;
    setInputVisible(false);
    grabState = null;
    panelDrag = null;
    clearMeasure();
    disposePanels();
    restoreMeshTransform();
    if (!savedBgWasNull) scene.background = savedBackground;
    else scene.background = null;
    try {
      renderer.setClearAlpha?.(1);
    } catch (_) {
      /* ignore */
    }
    if (controls) controls.enabled = true;
    if (transformControls) transformControls.enabled = true;
    renderer.xr.enabled = false;
    setButtonUi(false);
    try {
      restoreSceneChrome?.();
    } catch (_) {
      /* ignore */
    }
    onPresentingChange?.(false);
    try {
      fitCamera?.();
    } catch (_) {
      /* ignore */
    }
  }

  async function exit() {
    if (session) {
      try {
        await session.end();
      } catch (_) {
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
    updateGrab();
    pollThumbsticks();
    const pointer = controllers[1] || controllers[0];
    if (pointer) updateHover(pointer);
    billboardPanels();
    // Soft-refresh panel content occasionally
    if ((performance.now() / 1000) % 2 < 0.05) {
      if (panels.has("explorer")) refreshPanelTexture("explorer");
      if (panels.has("prompt")) refreshPanelTexture("prompt");
    }
  }

  function isPresenting() {
    return presenting;
  }

  function isSupported() {
    return supported;
  }

  let buttonBound = false;

  async function probeSupport() {
    try {
      const mode = await pickSessionMode();
      supported = !!mode;
      if (mode) sessionMode = mode;
    } catch {
      supported = false;
    }
    if (buttonEl) {
      buttonEl.hidden = !supported;
      buttonEl.classList.toggle("hidden", !supported);
      buttonEl.disabled = !supported;
      if (supported) {
        buttonEl.title =
          sessionMode === "immersive-ar"
            ? "AR — view the model in your room (Meta Quest)"
            : "VR — view the model (Meta Quest)";
        buttonEl.querySelector("span") && (buttonEl.querySelector("span").textContent = sessionMode === "immersive-ar" ? "AR" : "VR");
      }
      if (supported && !buttonBound) {
        buttonBound = true;
        buttonEl.addEventListener("click", (e) => {
          e.preventDefault();
          toggle().catch((err) => {
            console.warn("[viewport-xr]", err);
            buttonEl.title = "Open this page in Meta Quest Browser";
          });
        });
      }
    }
    return supported;
  }

  try {
    renderer.xr.enabled = false;
  } catch (_) {
    /* ignore */
  }

  setupControllers();
  void probeSupport();

  return {
    enter,
    exit,
    toggle,
    update,
    isPresenting,
    isSupported,
    probeSupport,
    setTool,
    getActiveTool: () => activeTool,
    getSessionMode: () => sessionMode,
  };
}
