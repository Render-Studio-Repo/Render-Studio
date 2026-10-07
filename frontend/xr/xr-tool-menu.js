import * as THREE from "three";
import { WHEEL_INNER, WHEEL_OUTER, WHEEL_COLORS, mapWheelIntersection as mapHit } from "./xr-tool-wheel.js?v=20260909-xr-int1-20260909-xr-vis1";
import { drawFilledIcon, sharpTexture } from "./xr-ui-tex.js?v=20260908-xr-ent4-atrig1";

export const TOOL_PAGES = {
  Tools: ["measure", "ai", "draw", "voice_mold", "prompt", "grab", "scale", "studio"],
  Shapes: ["create_box", "create_cylinder", "create_sphere", "create_cone", "create_torus", "create_floor", "create_wall"],
  Model: ["wall_height", "combine", "slice", "revolve", "loft", "symmetry", "mirror"],
  Edit: ["snap", "duplicate", "stamp", "array", "layer", "undo", "group_select"],
  Color: [],
};

export function wheelFirstPageToolIds(pages = TOOL_PAGES) {
  const first = Object.keys(pages || {})[0];
  return [...(pages?.[first] || [])];
}

export function wheelFirstPageHasMeasure(pages = TOOL_PAGES) {
  return wheelFirstPageToolIds(pages).includes("measure");
}

function texture(label, icon = "", active = false) {
  const size = icon ? 256 : 256;
  const h = icon ? 256 : 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = active ? "#245c53" : "#1e293b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = active ? "#e0f2fe" : "#94a3b8";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 2, canvas.width - 8, canvas.height - 4);
  if (icon) drawFilledIcon(ctx, icon, size / 2, icon ? 88 : h / 2, 96, "#ffffff");
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#020617";
  ctx.lineWidth = 6;
  ctx.font = `800 ${icon ? 28 : 32}px Arial,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const y = icon ? 210 : h / 2;
  ctx.strokeText(label, size / 2, y, size - 24);
  ctx.fillText(label, size / 2, y, size - 24);
  return sharpTexture(canvas, { anisotropy: 4 });
}

export function createXrToolWheel() {
  const group = new THREE.Group();
  group.name = "xrToolWheel"; group.visible = false;
  let moved = false, active = "", hovered = "", page = "Tools", snapOn = false;
  const buttons = [], colorHits = [], tabs = [], pages = {};
  const definitions = new Map([...WHEEL_INNER, ...WHEEL_OUTER].map(t => [t.id, t]));
  function tile(parent, label, icon, w, h, x, y) {
    const idle = texture(label, icon), selected = texture(label, icon, true);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      map: idle, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    mesh.position.set(x, y, 0.01); mesh.renderOrder = 10122;
    mesh.userData.idleMap = idle; mesh.userData.activeMap = selected;
    parent.add(mesh); return mesh;
  }
  Object.keys(TOOL_PAGES).forEach((name, index) => {
    const tab = tile(group, name, "", .061, .025, (index - 2) * .065, .177);
    tab.userData.xrTool = `wheel-page:${name}`; tabs.push(tab);
    const items = new THREE.Group(); pages[name] = items; group.add(items);
    TOOL_PAGES[name].forEach((id, i, list) => {
      const angle = Math.PI / 2 - i * Math.PI * 2 / list.length;
      const tool = definitions.get(id);
      const button = tile(items, tool.label, tool.icon, .061, .061, Math.cos(angle) * .112, Math.sin(angle) * .112);
      button.userData.xrTool = id; buttons.push(button);
    });
  });
  WHEEL_COLORS.forEach((color, i) => {
    const angle = Math.PI / 2 - i * Math.PI / 4;
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(.025, 32), new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    mesh.position.set(Math.cos(angle) * .112, Math.sin(angle) * .112, .01);
    mesh.renderOrder = 10122;
    mesh.userData.xrColor = `#${color.toString(16).padStart(6, "0")}`;
    mesh.userData.xrColorNum = color;
    pages.Color.add(mesh); colorHits.push(mesh);
  });
  const handle = tile(group, "Move", "move", .036, .036, 0, 0);
  handle.userData.xrWheelDrag = true;
  function paint() {
    for (const [name, items] of Object.entries(pages)) items.visible = name === page;
    for (const button of [...buttons, ...tabs]) {
      const id = button.userData.xrTool;
      const snapLit = id === "snap" && snapOn;
      const on = id === active || id === hovered || snapLit || id === `wheel-page:${page}`;
      button.material.map = on ? button.userData.activeMap : button.userData.idleMap;
      button.scale.setScalar(id === hovered ? 1.14 : snapLit ? 1.08 : 1);
    }
  }
  paint();
  return {
    group, buttons, colorHits,
    setVisible(on) { group.visible = !!on; },
    isVisible: () => group.visible,
    markMoved() { moved = true; },
    wasMoved: () => moved,
    selectPage(id) {
      const next = String(id || "").replace(/^wheel-page:/, "");
      if (!String(id).startsWith("wheel-page:") || !pages[next]) return false;
      page = next; hovered = ""; paint(); return true;
    },
    setActive(id) { if (active !== id) { active = id; paint(); } },
    setHovered(id) { if (hovered !== id) { hovered = id; paint(); } },
    setSnapOn(on) { if (snapOn !== !!on) { snapOn = !!on; paint(); } },
    setColorSelected(hex) {
      for (const hit of colorHits) hit.scale.setScalar(hit.userData.xrColor === String(hex).toLowerCase() ? 1.12 : 1);
    },
    placeInFront(headPos, forward, headY, { force = false } = {}) {
      if (force || !moved) {
        group.position.copy(headPos).addScaledVector(forward.clone().normalize(), .48);
        group.position.y = headY - .12;
        group.lookAt(headPos);
      }
      group.visible = true;
    },
  };
}

export function mapWheelIntersection(hits) {
  return mapHit((hits || []).filter(({object}) => {
    for (let node = object; node; node = node.parent) if (!node.visible) return false;
    return true;
  }));
}
