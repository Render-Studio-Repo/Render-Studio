/**
 * World-space nametag card: profile, friend, send file, message, mute.
 */

import {
  fillDarkMetalChrome,
  fillDarkMetalHeader,
  drawWindowCloseX,
} from "./xr-ui-tex.js?v=20260907-xr-prof1";

const CANVAS = { w: 640, h: 470 };
const PLANE = { w: 0.42, h: 0.31 };

const ACTIONS = [
  { id: "profile", label: "View profile" },
  { id: "friend", label: "Add friend" },
  { id: "file", label: "Send file" },
  { id: "message", label: "Message" },
  { id: "meet", label: "Request meeting" },
  { id: "mute", label: "Mute / unmute" },
];

function paint(ctx, user, footer) {
  const { w, h } = CANVAS;
  ctx.clearRect(0, 0, w, h);
  fillDarkMetalChrome(ctx, w, h, 22);
  fillDarkMetalHeader(ctx, w, 100, 22);
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "700 32px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(String(user?.display_name || "Teammate").slice(0, 20), 28, 46);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 20px system-ui, sans-serif";
  const handle = user?.handle ? `@${String(user.handle).replace(/^@/, "")}` : "In this space";
  ctx.fillText(handle.slice(0, 28), 28, 78);
  drawWindowCloseX(ctx, w, 72);
  ACTIONS.forEach((a, i) => {
    const y = 118 + i * 46;
    ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.06)" : "rgba(125,211,252,0.10)";
    ctx.fillRect(16, y, w - 32, 42);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "600 24px system-ui, sans-serif";
    let label = a.label;
    if (a.id === "friend" && user?.is_friend) label = "Friends";
    if (a.id === "mute" && user?.muted) label = "Unmute";
    ctx.fillText(label, 32, y + 28);
  });
  if (footer) {
    ctx.fillStyle = "#fde68a";
    ctx.font = "500 18px system-ui, sans-serif";
    ctx.fillText(String(footer).slice(0, 48), 28, h - 18);
  }
}

export function createXrSocialCard({ THREE, scene } = {}) {
  const group = new THREE.Group();
  group.name = "xrSocialCard";
  group.visible = false;
  group.renderOrder = 12000;
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS.w;
  canvas.height = CANVAS.h;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE.w, PLANE.h),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  plane.userData.xrSocialCard = true;
  plane.renderOrder = 12000;
  const titleBar = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE.w - 0.07, 0.055),
    new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.001, depthTest: false, depthWrite: false }),
  );
  titleBar.position.set(-0.018, PLANE.h / 2 - 0.03, 0.003);
  titleBar.userData.xrSocialDrag = true;
  titleBar.renderOrder = 12001;
  group.add(plane, titleBar);
  try { scene?.add(group); } catch { /* ignore */ }

  let user = null;
  let footer = "";

  function redraw() {
    paint(ctx, user, footer);
    tex.needsUpdate = true;
  }

  function open(nextUser, worldPos, toward) {
    user = nextUser || null;
    footer = "";
    if (!user?.id) {
      group.visible = false;
      return;
    }
    redraw();
    if (worldPos) group.position.copy(worldPos);
    if (toward) {
      const dir = toward.clone().sub(group.position);
      dir.y = 0;
      if (dir.lengthSq() > 1e-6) {
        dir.normalize();
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      }
    }
    group.visible = true;
  }

  function close() {
    group.visible = false;
    user = null;
  }

  function pickAction(uv) {
    if (!uv || !group.visible) return null;
    const px = uv.x * CANVAS.w;
    const pxY = (1 - uv.y) * CANVAS.h;
    if (pxY < 100 && px > CANVAS.w - 88) return { id: "close", user };
    if (pxY < 100) return { id: "drag", user };
    const idx = Math.floor((pxY - 118) / 46);
    const action = ACTIONS[idx];
    if (!action) return { id: "chrome", user };
    return { id: action.id, user };
  }

  function setFooter(text) {
    footer = String(text || "");
    redraw();
  }

  function setUser(patch) {
    if (!user) return;
    user = { ...user, ...patch };
    redraw();
  }

  return {
    group,
    plane,
    titleBar,
    open,
    close,
    pickAction,
    setFooter,
    setUser,
    isOpen: () => group.visible,
    currentUser: () => user,
  };
}
