/**
 * Compact world-space tool wheel: primitives, studio tools, color options.
 * Popup in front of the headset; grab the center nub to move it.
 */

import * as THREE from "three";
import {
  makeColoredPuckTexture,
  makeColorSwatchTexture,
  makeWheelDiscTexture,
} from "./xr-ui-tex.js?v=20260908-xr-ent4";

const INNER_R = 0.048;
const OUTER_R = 0.082;
const DISC_R = 0.108;
const TILE = 0.028;
const HIT = 0.016;
const COLOR_R = 0.022;
const TEX = 256;

export const WHEEL_INNER = [
  { id: "measure", label: "Measure", icon: "measure", color: 0x14b8a6 },
  { id: "create_box", label: "Box", icon: "box", color: 0xe85d4c },
  { id: "create_cylinder", label: "Cyl", icon: "cyl", color: 0x3b82f6 },
  { id: "create_sphere", label: "Sphere", icon: "sphere", color: 0xf59e0b },
  { id: "create_wall", label: "Wall", icon: "wall", color: 0xf8fafc },
  { id: "wall_height", label: "Height", icon: "pull", color: 0xe2e8f0 },
  { id: "create_floor", label: "Floor", icon: "floor", color: 0x94a3b8 },
  { id: "create_cone", label: "Cone", icon: "cone", color: 0x22c55e },
  { id: "create_torus", label: "Torus", icon: "torus", color: 0xa855f7 },
  { id: "combine", label: "Bool", icon: "box", color: 0xf97316 },
  { id: "slice", label: "Slice", icon: "slice", color: 0xf43f5e },
  { id: "revolve", label: "Revolve", icon: "cyl", color: 0x38bdf8 },
  { id: "loft", label: "Loft", icon: "draw", color: 0x22c55e },
];

export const WHEEL_OUTER = [
  { id: "ai", label: "Prompt", icon: "ai", color: 0xe85d4c },
  { id: "draw", label: "Draw", icon: "draw", color: 0x06b6d4 },
  { id: "voice_mold", label: "Talk", icon: "mic", color: 0x8b5cf6 },
  { id: "prompt", label: "Generate", icon: "run", color: 0x16a34a },
  { id: "grab", label: "Move", icon: "move", color: 0x64748b },
  { id: "scale", label: "Scale", icon: "move", color: 0xeab308 },
  { id: "snap", label: "Snap", icon: "snap", color: 0xf59e0b },
  { id: "symmetry", label: "Sym", icon: "sym", color: 0xa855f7 },
  { id: "mirror", label: "Mirror", icon: "sym", color: 0xc084fc },
  { id: "duplicate", label: "Copy", icon: "copy", color: 0x38bdf8 },
  { id: "stamp", label: "Stamp", icon: "copy", color: 0x0ea5e9 },
  { id: "array", label: "Array", icon: "group", color: 0xf97316 },
  { id: "layer", label: "Layer", icon: "layer", color: 0x6366f1 },
  { id: "undo", label: "Undo", icon: "undo", color: 0x94a3b8 },
  { id: "group_select", label: "Group", icon: "group", color: 0x38bdf8 },
  { id: "studio", label: "Studio", icon: "menu", color: 0x1c1917 },
];

export const WHEEL_COLORS = [
  0xe85d4c, 0xf59e0b, 0x22c55e, 0x06b6d4,
  0x3b82f6, 0xa855f7, 0xec4899, 0xf8fafc,
];

function hideRaycast(mesh) {
  mesh.raycast = () => {};
  mesh.userData.xrRaycast = false;
}

function ringPos(i, n, r, offset = -Math.PI / 2) {
  const a = (i / n) * Math.PI * 2 + offset;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

function addTool(parent, tool, x, y, buttons) {
  const hit = new THREE.Mesh(
    new THREE.CircleGeometry(HIT + 0.005, 28),
    new THREE.MeshBasicMaterial({
      color: tool.color || 0xffffff,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: true,
      toneMapped: false,
    }),
  );
  hit.position.set(x, y, 0.008);
  hit.userData.xrTool = tool.id;
  hit.frustumCulled = false;
  hit.renderOrder = 10120;
  parent.add(hit);

  const map = makeColoredPuckTexture({
    label: tool.label,
    icon: tool.icon,
    color: tool.color,
    size: TEX,
  });
  const puck = new THREE.Mesh(
    new THREE.CircleGeometry(TILE / 2, 32),
    new THREE.MeshBasicMaterial({
      map,
      depthWrite: true,
      side: THREE.DoubleSide,
    }),
  );
  puck.position.set(x, y, 0.01);
  puck.renderOrder = 10122;
  puck.frustumCulled = false;
  hideRaycast(puck);
  parent.add(puck);
  hit.userData.puck = puck;
  hit.userData.idleMap = map;
  hit.userData.activeMap = makeColoredPuckTexture({
    label: tool.label,
    icon: tool.icon,
    color: tool.color,
    active: true,
    size: TEX,
  });
  buttons.push(hit);
}

export function createXrToolWheel() {
  const group = new THREE.Group();
  group.name = "xrToolWheel";
  group.visible = false;
  group.frustumCulled = false;
  group.renderOrder = 10100;
  let moved = false;

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(DISC_R, 48),
    new THREE.MeshBasicMaterial({
      map: makeWheelDiscTexture(),
      side: THREE.DoubleSide,
      depthWrite: true,
    }),
  );
  disc.position.z = -0.008;
  disc.userData.xrUi = "chrome";
  disc.userData.xrWheel = true;
  hideRaycast(disc);
  group.add(disc);

  const grab = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 14, 10),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      depthTest: false,
      depthWrite: true,
      toneMapped: false,
    }),
  );
  grab.position.set(0, 0, 0.012);
  grab.userData.xrWheelDrag = true;
  grab.userData.xrUi = "chrome";
  grab.frustumCulled = false;
  grab.renderOrder = 10140;
  group.add(grab);

  const buttons = [];
  WHEEL_INNER.forEach((tool, i) => {
    const { x, y } = ringPos(i, WHEEL_INNER.length, INNER_R);
    addTool(group, tool, x, y, buttons);
  });
  WHEEL_OUTER.forEach((tool, i) => {
    const { x, y } = ringPos(i, WHEEL_OUTER.length, OUTER_R, -Math.PI / 2 + 0.12);
    addTool(group, tool, x, y, buttons);
  });

  const colorHits = [];
  WHEEL_COLORS.forEach((color, i) => {
    const { x, y } = ringPos(i, WHEEL_COLORS.length, COLOR_R, 0);
    const hit = new THREE.Mesh(
      new THREE.CircleGeometry(0.012, 20),
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: true,
        toneMapped: false,
      }),
    );
    hit.position.set(x, y, 0.012);
    hit.userData.xrColor = `#${color.toString(16).padStart(6, "0")}`;
    hit.userData.xrColorNum = color;
    hit.frustumCulled = false;
    hit.renderOrder = 10130;
    group.add(hit);
    const swatch = new THREE.Mesh(
      new THREE.CircleGeometry(0.008, 16),
      new THREE.MeshBasicMaterial({
        map: makeColorSwatchTexture(color),
        side: THREE.DoubleSide,
      }),
    );
    swatch.position.copy(hit.position);
    swatch.position.z += 0.002;
    hideRaycast(swatch);
    group.add(swatch);
    hit.userData.puck = swatch;
    colorHits.push(hit);
  });

  function setVisible(on) {
    group.visible = !!on;
  }

  function placeInFront(headPos, forwardFlat, headY, { force = false } = {}) {
    if (!force && moved && group.position.lengthSq() > 0.01) {
      setVisible(true);
      return;
    }
    const f = forwardFlat.clone().normalize();
    group.position.copy(headPos).addScaledVector(f, 0.48);
    group.position.y = (Number.isFinite(headY) ? headY : headPos.y) - 0.04;
    const toHead = headPos.clone().sub(group.position);
    toHead.y = 0;
    if (toHead.lengthSq() < 1e-6) toHead.copy(f).multiplyScalar(-1);
    else toHead.normalize();
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toHead);
    group.updateMatrixWorld(true);
    setVisible(true);
  }

  function markMoved() {
    moved = true;
  }

  let hoveredId = "";
  let activeId = "";
  let snapOn = false;

  function paintTool(btn, { selected = false, hovered = false } = {}) {
    const on = selected || hovered;
    const map = on ? btn.userData.activeMap : btn.userData.idleMap;
    if (btn.userData.puck?.material && map) {
      btn.userData.puck.material.map = map;
      btn.userData.puck.material.needsUpdate = true;
    }
    const s = selected ? 1.18 : hovered ? 1.12 : 1;
    btn.scale.setScalar(s);
    btn.userData.puck?.scale.setScalar(s);
  }

  function paintAll() {
    buttons.forEach((btn) => {
      const id = btn.userData.xrTool;
      paintTool(btn, {
        selected: id === activeId || (id === "snap" && snapOn),
        hovered: id === hoveredId && id !== activeId && !(id === "snap" && snapOn),
      });
    });
  }

  function setActive(id) {
    activeId = String(id || "");
    paintAll();
  }

  function setHovered(id) {
    hoveredId = String(id || "");
    paintAll();
  }

  function setSnapOn(on) {
    snapOn = !!on;
    paintAll();
  }

  function setColorSelected(hex) {
    const want = String(hex || "").toLowerCase();
    colorHits.forEach((h) => {
      const on = String(h.userData.xrColor || "").toLowerCase() === want;
      h.scale.setScalar(on ? 1.25 : 1);
      h.userData.puck?.scale.setScalar(on ? 1.25 : 1);
    });
  }

  return {
    group,
    buttons,
    colorHits,
    setVisible,
    placeInFront,
    setActive,
    setHovered,
    setSnapOn,
    setColorSelected,
    markMoved,
    isVisible: () => group.visible,
    wasMoved: () => moved,
  };
}

export function mapWheelIntersection(hits) {
  if (!hits?.length) return null;
  const sorted = hits
    .filter((h) => h?.object && h.object.userData?.xrRaycast !== false)
    .sort((a, b) => a.distance - b.distance);
  if (!sorted.length) return null;
  const colorHit = sorted.find((h) => h.object.userData?.xrColor);
  if (colorHit) {
    return {
      kind: "color",
      color: colorHit.object.userData.xrColor,
      colorNum: colorHit.object.userData.xrColorNum,
      distance: colorHit.distance,
    };
  }
  const toolHit = sorted.find((h) => h.object.userData?.xrTool);
  if (toolHit) {
    return {
      kind: "tool",
      tool: toolHit.object.userData.xrTool,
      distance: toolHit.distance,
    };
  }
  const dragHit = sorted.find((h) => h.object.userData?.xrWheelDrag);
  if (dragHit) {
    return { kind: "wheel-drag", distance: dragHit.distance };
  }
  return null;
}
