/**
 * Drawing-hand controller chrome: per-tool pucks (no Snap).
 * Snap On/Off is a separate chip glued to the aiming / right controller.
 * Built once; tool changes only toggle visibility — no canvas or gizmo teardown per frame.
 */

import * as THREE from "three";
import {
  makeColoredPuckTexture,
  makeColorSwatchTexture,
  drawFilledIcon,
  fillDarkMetalChrome,
  hexColor,
  sharpTexture,
} from "./xr-ui-tex.js?v=20260908-xr-undor&wristfix=20260916-3";
import { WHEEL_COLORS } from "./xr-tool-wheel.js?v=20260908-xr-ent4";
import { DRAW_HAND_COLOR_IDS, toolHandUiIds, xrSnapControlHand, drawHandWristLocalOffset, drawHandHostIsWristBone, snapControlLocalOffset, xrHudPlateFromItems } from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&drawface1=1&lefthud1=1&astra=20260916-5&cubeturn=20260923-1";

export { DRAW_HAND_COLOR_IDS, toolHandUiIds, xrSnapControlHand };

import { BRUSH_TOOLS, SHAPE_TOOLS } from "./xr-tool-appearance.js?v=20260915-toolcontext1";

const TILE = 0.026;
const GAP = 0.032;

const BOARD_TOOLS = ['move','pen','line','arrow','lasso','label','link','eraser','face','edge'].map(id=>({id:`board:tool:${id}`,label:id[0].toUpperCase()+id.slice(1),icon:id==='move'?'move':'draw',color:0x527f91}));

const BOX_MODE_TOOLS = [
  { id: "box_face", label: "Face", icon: "box", color: 0xe85d4c },
  { id: "box_extrude", label: "Extrude", icon: "pull", color: 0xf59e0b },
  { id: "box_corner", label: "Join", icon: "snap", color: 0x22c55e },
  { id: "box_move", label: "Move", icon: "move", color: 0x38bdf8 },
];

const BOX_TURN_TOOLS = [
  { id: "box_turn_left", label: "Left 15°", icon: "undo", color: 0x8b5cf6 },
  { id: "box_turn_right", label: "Right 15°", icon: "redo", color: 0x8b5cf6 },
];

const PRIM_MODE_TOOLS = [
  { id: "prim_size", label: "Size", icon: "plus", color: 0xf59e0b },
  { id: "prim_move", label: "Move", icon: "move", color: 0x38bdf8 },
];

const SIZE_TOOLS = [
  { id: "draw_size_s", label: "Fine", icon: "minus", color: 0x94a3b8 },
  { id: "draw_size_m", label: "Med", icon: "draw", color: 0x06b6d4 },
  { id: "draw_size_l", label: "Bold", icon: "plus", color: 0xe85d4c },
];

function hideRaycast(mesh) {
  mesh.raycast = () => {};
  mesh.userData.xrRaycast = false;
}

function addPuck(parent, tool, x, y, buttons, { size = 96 } = {}) {
  const color = tool.color || 0xe85d4c;
  const hit = new THREE.Mesh(
    new THREE.CircleGeometry(TILE / 2 + 0.003, 24),
    new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    }),
  );
  hit.position.set(x, y, 0.008);
  hit.userData.xrTool = tool.id;
  hit.userData.xrToolHand = true;
  hit.userData.xrLabel = tool.label;
  hit.renderOrder = 10280;
  hit.frustumCulled = false;
  parent.add(hit);
  const map = makeColoredPuckTexture({
    label: tool.label,
    icon: tool.icon,
    color,
    size,
  });
  const puck = new THREE.Mesh(
    new THREE.CircleGeometry(TILE / 2, 24),
    new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  puck.position.copy(hit.position);
  puck.position.z += 0.002;
  puck.renderOrder = 10282;
  puck.frustumCulled = false;
  hideRaycast(puck);
  parent.add(puck);
  hit.userData.puck = puck;
  hit.userData.idleMap = map;
  hit.userData.activeMap = makeColoredPuckTexture({
    label: tool.label,
    icon: tool.icon,
    color,
    active: true,
    size,
  });
  buttons.push(hit);
  return hit;
}

export function createXrToolHand({ THREE: T = THREE } = {}) {
  const group = new T.Group();
  group.name = "xrToolHand";
  group.userData.xrUi = true;
  group.visible = false;
  group.frustumCulled = false;
  group.renderOrder = 10270;

  const attachWorld = new T.Matrix4(), attachInverse = new T.Matrix4();
  const anchor = new T.Group(); anchor.name="xrToolHandAnchor"; anchor.userData.xrUi=true; anchor.add(group);
  const buttons = [];

  // Backplate is decorative: only the individual controls participate in picking.
  const plate = new T.Mesh(new T.PlaneGeometry(.18, .26), new T.MeshBasicMaterial({
    color: 0x101c2b, transparent: true, opacity: .88, side: T.DoubleSide,
    depthTest: false, depthWrite: false, toneMapped: false,
  }));
  plate.position.set(0, .008, -.004);
  plate.renderOrder = 10270;
  group.scale.setScalar(.8);
  hideRaycast(plate); group.add(plate);
  const boardHits = BOARD_TOOLS.map((tool,i)=>addPuck(group,tool,(i%3-1)*.049,.057-Math.floor(i/3)*.043,buttons));
  const brushHits = BRUSH_TOOLS.map((tool, i) => addPuck(group, tool, (i - 1) * .043, .056, buttons));
  const shapeHits = SHAPE_TOOLS.map((tool, i) => addPuck(group, tool, (i % 4 - 1.5) * GAP, .056 - Math.floor(i / 4) * GAP, buttons));

  const colorHits = [];
  WHEEL_COLORS.forEach((color, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = (col - 1.5) * 0.028;
    const y = -0.012 - row * 0.032;
    const hit = new T.Mesh(
      new T.CircleGeometry(0.011, 18),
      new T.MeshBasicMaterial({
        color,
        side: T.DoubleSide,
        depthTest: false,
        depthWrite: false,
      transparent: true,
        toneMapped: false,
      }),
    );
    hit.position.set(x, y, 0.008);
    hit.userData.xrTool = `color_${color.toString(16).padStart(6, "0")}`;
    hit.userData.xrColor = `#${color.toString(16).padStart(6, "0")}`;
    hit.userData.xrColorNum = color;
    hit.userData.xrToolHand = true;
    hit.frustumCulled = false;
    hit.renderOrder = 10280;
    group.add(hit);
    const swatch = new T.Mesh(
      new T.CircleGeometry(0.008, 16),
      new T.MeshBasicMaterial({
        map: makeColorSwatchTexture(color),
        transparent: true,
        side: T.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    swatch.renderOrder = 10282;
    swatch.position.copy(hit.position);
    swatch.position.z += 0.002;
    hideRaycast(swatch);
    group.add(swatch);
    hit.userData.puck = swatch;
    colorHits.push(hit);
    buttons.push(hit);
  });

  const sizeHits = [];
  SIZE_TOOLS.forEach((tool, i) => {
    const hit = addPuck(group, tool, (i - 1) * GAP, -0.078, buttons);
    sizeHits.push(hit);
  });

  const boxHits = [];
  BOX_MODE_TOOLS.forEach((tool, i) => {
    const hit = addPuck(group, tool, (i - 1.5) * GAP, -0.078, buttons);
    boxHits.push(hit);
  });
  BOX_TURN_TOOLS.forEach((tool, i) => {
    const hit = addPuck(group, tool, (i - 0.5) * GAP, -0.116, buttons);
    boxHits.push(hit);
  });

  const primHits = [];
  PRIM_MODE_TOOLS.forEach((tool, i) => {
    const hit = addPuck(group, tool, (i - 0.5) * GAP, -0.078, buttons);
    primHits.push(hit);
  });

  const HISTORY_TOOLS = [
    { id: "undo", label: "Undo", icon: "undo", color: 0x94a3b8 },
    { id: "redo", label: "Redo", icon: "redo", color: 0x64748b },
  ];
  const historyHits = [];
  HISTORY_TOOLS.forEach((tool, i) => {
    const hit = addPuck(group, tool, (i - 0.5) * GAP, 0.096, buttons);
    historyHits.push(hit);
  });

  const plateSpec = xrHudPlateFromItems(buttons.map((m) => ({
    x: m.position.x,
    y: m.position.y,
    r: Number(m.geometry?.parameters?.radius)
      || (Number(m.geometry?.parameters?.width) || 0) / 2
      || TILE / 2,
  })), { pad: 0.02, hoverScale: 1.18 });
  try { plate.geometry.dispose(); } catch (_) {}
  plate.geometry = new T.PlaneGeometry(plateSpec.w, plateSpec.h);
  plate.position.set(plateSpec.x, plateSpec.y, -0.004);

  let activeTool = "grab";
  let boxMode = "box_face";
  let primMode = "prim_size";
  let sizeId = "draw_size_m";
  let hoveredId = "";
  let canUndo = false;
  let canRedo = false;
  let brushId = "draw_brush_pen";

  function setLayerVisible(hits, on) {
    for (const hit of hits) {
      hit.visible = on;
      if (hit.userData.puck) hit.userData.puck.visible = on;
    }
  }

  function paintPuck(hit, selected) {
    const map = selected ? hit.userData.activeMap : hit.userData.idleMap;
    if (hit.userData.puck?.material && map && hit.userData.puck.material.map !== map) {
      hit.userData.puck.material.map = map;
      hit.userData.puck.material.needsUpdate = true;
    }
    const hover = hit.userData.xrTool === hoveredId;
    const s = selected ? 1.14 : hover ? 1.1 : 1;
    hit.scale.setScalar(s);
    hit.userData.puck?.scale.setScalar(s);
  }

  function applyVisibility() {
    const ids = new Set(toolHandUiIds(activeTool));
    const board = activeTool.startsWith("board:");
    setLayerVisible(boardHits,board);
    for(const hit of boardHits)paintPuck(hit,hit.userData.xrTool===`board:tool:${activeTool.slice(6)}`);
    const draw = activeTool === "draw";
    const box = activeTool === "create_box";
    const prim = (String(activeTool).startsWith("create_") && !box) || activeTool === "wall_height";
    setLayerVisible(brushHits, draw);
    setLayerVisible(shapeHits, box || prim);
    setLayerVisible(colorHits, draw || box || prim);
    for (const hit of brushHits) paintPuck(hit, hit.userData.xrTool === brushId);
    for (const hit of shapeHits) paintPuck(hit, hit.userData.xrTool === activeTool);
    setLayerVisible(sizeHits, draw);
    setLayerVisible(boxHits, box);
    setLayerVisible(primHits, !!prim && !draw);
    for (const hit of boxHits) paintPuck(hit, hit.userData.xrTool === boxMode);
    for (const hit of primHits) paintPuck(hit, hit.userData.xrTool === primMode);
    for (const hit of sizeHits) paintPuck(hit, hit.userData.xrTool === sizeId);
    const histOn = board || ids.has("undo") || ids.has("redo");
    setLayerVisible(historyHits, histOn);
    for (const hit of historyHits) {
      const enabled = hit.userData.xrTool === "undo" ? canUndo : canRedo;
      paintPuck(hit, false);
      const puck = hit.userData.puck;
      if (puck?.material) {
        puck.material.transparent = true;
        puck.material.opacity = enabled ? 1 : 0.32;
        puck.material.needsUpdate = true;
      }
      if (hit.material?.color) hit.material.color.setHex(enabled ? (hit.userData.xrTool === "undo" ? 0x94a3b8 : 0x64748b) : 0x334155);
    }
  }

  function setTool(id) {
    activeTool = String(id || "grab");
    applyVisibility();
  }

  function setBoxMode(id) {
    if (BOX_MODE_TOOLS.some((t) => t.id === id)) boxMode = id;
    applyVisibility();
  }

  function setPrimMode(id) {
    if (PRIM_MODE_TOOLS.some((t) => t.id === id)) primMode = id;
    applyVisibility();
  }

  function setSizeId(id) {
    sizeId = id === "draw_size_s" || id === "draw_size_l" ? id : "draw_size_m";
    applyVisibility();
  }

  function setColor(color) {
    const n = typeof color === "number" ? color : parseInt(String(color).replace("#", ""), 16);
    const want = `#${(Number.isFinite(n) ? n : 0).toString(16).padStart(6, "0")}`.toLowerCase();
    colorHits.forEach((h) => {
      const on = String(h.userData.xrColor || "").toLowerCase() === want;
      h.scale.setScalar(on ? 1.22 : 1);
      h.userData.puck?.scale.setScalar(on ? 1.22 : 1);
    });
  }

  function setHovered(id) {
    const next = String(id || "");
    if (hoveredId === next) return;
    hoveredId = next;
    applyVisibility();
  }

  function setBrush(kind) {
    brushId = `draw_brush_${kind}`;
    applyVisibility();
  }

  function setHistoryState({ undo = false, redo = false } = {}) {
    canUndo = !!undo;
    canRedo = !!redo;
    applyVisibility();
  }

  function attachTo(host, { dockHand = "left", headPosition } = {}) {
    if (!host) return;
    host.updateWorldMatrix(true,false);
    const world=attachWorld.copy(host.matrixWorld);
    if(anchor.parent){anchor.parent.updateWorldMatrix(true,false);world.premultiply(attachInverse.copy(anchor.parent.matrixWorld).invert());}
    world.decompose(anchor.position,anchor.quaternion,anchor.scale);
    anchor.scale.set(1,1,1); anchor.visible=true;
    anchor.updateWorldMatrix(false,true);
    const drawingIsRight = dockHand !== "right";
    const off = drawHandWristLocalOffset({
      drawingIsRight,
      useWrist: drawHandHostIsWristBone(host),
    });
    // Outboard of the controller: does not cover its tip or existing status buttons.
    group.position.set(off.x + (drawingIsRight ? .07 : -.07), off.y + .025, off.z - .025);
    group.rotation.set(off.rx, off.ry, off.rz);
    if(headPosition){group.updateWorldMatrix(true,false);group.lookAt(headPosition);}

  }

  function pickFromHits(hits) {
    if (!hits?.length || !group.visible) return null;
    const sorted = hits
      .filter((h) => h?.object?.userData?.xrToolHand && h.object.visible)
      .sort((a, b) => a.distance - b.distance);
    if (!sorted.length) return null;
    const obj = sorted[0].object;
    if (obj.userData.xrColorNum != null) {
      return {
        kind: "color",
        color: obj.userData.xrColor,
        colorNum: obj.userData.xrColorNum,
        distance: sorted[0].distance,
      };
    }
    if (obj.userData.xrTool) {
      return { kind: "tool", tool: obj.userData.xrTool, distance: sorted[0].distance };
    }
    return null;
  }

  function setVisible(on) {
    group.visible = !!on;
  }

  applyVisibility();

  return {
    group,
    anchor,
    buttons,
    setTool,
    setBoxMode,
    setPrimMode,
    setSizeId,
    setColor,
    setHovered,
    setBrush,
    setHistoryState,
    attachTo,
    pickFromHits,
    setVisible,
    boxMode: () => boxMode,
    primMode: () => primMode,
    dispose() {
      try { group.parent?.remove(group); } catch { /* ignore */ }
    },
  };
}

function makeSnapChipTexture(on) {
  const w = 320;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, w, h);
  fillDarkMetalChrome(ctx, w, h, 28);
  const fill = hexColor(on ? 0x22c55e : 0x475569);
  ctx.fillStyle = on ? "rgba(34,197,94,0.38)" : "rgba(71,85,105,0.32)";
  ctx.fillRect(8, 8, w - 16, h - 16);
  ctx.strokeStyle = on ? "#f8fafc" : fill;
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  drawFilledIcon(ctx, "snap", 58, h / 2, 72, "#ffffff");
  const label = on ? "Snap on" : "Snap off";
  ctx.font = "800 42px Arial, Helvetica, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#ffffff";
  ctx.strokeText(label, 108, h / 2);
  ctx.fillText(label, 108, h / 2);
  return sharpTexture(canvas);
}

/** Labeled Snap On/Off chip glued to the aiming (typically right) controller. */
export function createXrSnapControl({ THREE: T = THREE } = {}) {
  const group = new T.Group();
  group.name = "xrSnapControl";
  group.visible = false;
  group.frustumCulled = false;
  group.renderOrder = 10290;

  const buttons = [];
  const onMap = makeSnapChipTexture(true);
  const offMap = makeSnapChipTexture(false);
  const chipW = 0.078;
  const chipH = 0.032;
  const hit = new T.Mesh(
    new T.PlaneGeometry(chipW + 0.006, chipH + 0.006),
    new T.MeshBasicMaterial({
      color: 0x22c55e,
      side: T.DoubleSide,
      depthTest: false,
      depthWrite: true,
      toneMapped: false,
      transparent: true,
      opacity: 0.01,
    }),
  );
  hit.userData.xrTool = "snap";
  hit.userData.xrSnapControl = true;
  hit.userData.xrLabel = "Snap on";
  hit.renderOrder = 10290;
  hit.frustumCulled = false;
  group.add(hit);
  const face = new T.Mesh(
    new T.PlaneGeometry(chipW, chipH),
    new T.MeshBasicMaterial({
      map: onMap,
      side: T.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  face.position.z = 0.002;
  face.renderOrder = 10292;
  face.frustumCulled = false;
  hideRaycast(face);
  group.add(face);
  hit.userData.puck = face;
  buttons.push(hit);

  let snapOn = true;
  let hoveredId = "";

  function applyPaint() {
    const map = snapOn ? onMap : offMap;
    if (face.material.map !== map) {
      face.material.map = map;
      face.material.needsUpdate = true;
    }
    hit.userData.xrLabel = snapOn ? "Snap on" : "Snap off";
    const s = hoveredId === "snap" ? 1.1 : 1;
    hit.scale.setScalar(s);
    face.scale.setScalar(s);
  }

  function setSnapOn(on) {
    snapOn = !!on;
    applyPaint();
  }

  function setHovered(id) {
    hoveredId = String(id || "");
    applyPaint();
  }

  function attachTo(host, { dockHand = "left" } = {}) {
    if (!host) return;
    if (group.parent !== host) {
      try { group.parent?.remove(group); } catch { /* ignore */ }
      try { host.add(group); } catch { /* ignore */ }
    }
    const pointingIsRight = xrSnapControlHand(dockHand) === "right";
    const off = snapControlLocalOffset({ pointingIsRight });
    group.position.set(off.x, off.y, off.z);
    group.rotation.set(off.rx, off.ry, off.rz);
  }

  function pickFromHits(hits) {
    if (!hits?.length || !group.visible) return null;
    const sorted = hits
      .filter((h) => h?.object?.userData?.xrSnapControl && h.object.visible)
      .sort((a, b) => a.distance - b.distance);
    if (!sorted.length) return null;
    return { kind: "tool", tool: "snap", distance: sorted[0].distance };
  }

  function setVisible(on) {
    group.visible = !!on;
  }

  applyPaint();

  return {
    group,
    buttons,
    setSnapOn,
    setHovered,
    attachTo,
    pickFromHits,
    setVisible,
    dispose() {
      try { group.parent?.remove(group); } catch { /* ignore */ }
    },
  };
}
