/**
 * In-headset studio popup: Stats (tokens/queries), History, Access, Keys.
 * History rows come from the same project-history API as the laptop History tab.
 */

import {
  fillDarkMetalChrome,
  fillDarkMetalHeader,
  drawWindowOverflowDots,
  wrapHudCanvasText,
  XR_HUD_TEXT_INSET,
} from "./xr-ui-tex.js?v=20260908-xr-robotics1&uisharp=20260916-1";
import { studioLinesForTab, studioTabIds, shouldRedrawXrConsole, xrConsoleSignature, applyWorldUiMaterialFlags, applyWorldUiPickMaterialFlags, xrHudCanvasScale, xrHudCanvasBackingSize } from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&uisharp=20260916-1&astra=20260916-5";
import { hudOverflowMenuLayout, pickHudHeader } from "./xr-hud-lock.js?v=20260909-xr-wm1-voiceactivate2-menutop2";

export { studioLinesForTab, studioTabIds };

const CANVAS = { w: 1024, h: 720 };
const PLANE = { w: 0.68, h: 0.48 };
const TABS = [
  { id: "stats", label: "Stats" },
  { id: "history", label: "History" },
  { id: "access", label: "Access" },
  { id: "keys", label: "Keys" },
];
const VISIBLE_ROWS = 8;

function paint(ctx, state) {
  const scale = xrHudCanvasScale();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = "high";
  wrapHudCanvasText(ctx, CANVAS.w, XR_HUD_TEXT_INSET);
  const { w, h } = CANVAS;
  const tab = state.tab || "stats";
  ctx.clearRect(0, 0, w, h);
  fillDarkMetalChrome(ctx, w, h, 26);
  fillDarkMetalHeader(ctx, w, 72, 26);
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "700 32px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(state.title || "Studio", 28, 46, w - 168);
  drawWindowOverflowDots(ctx, w, 72);
  if (state.overflowOpen) {
    const menu = hudOverflowMenuLayout(w, 72, { locked: !!state.locked });
    const rows = (menu.rows || []).filter((cell) => cell.id !== "hide");
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(menu.x, menu.y, menu.w, Math.max(52, 10 + rows.length * 52));
    ctx.fillStyle = "#f8fafc";
    ctx.font = "800 18px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const cell of rows) {
      ctx.fillStyle = (cell.id === "lock" || cell.id === "unlock") && state.locked ? "#166534" : "#1e293b";
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(cell.label, cell.x + cell.w / 2, cell.y + cell.h / 2 + 6);
    }
  }

  const tabW = (w - 48) / TABS.length;
  TABS.forEach((t, i) => {
    const x = 24 + i * tabW;
    ctx.fillStyle = t.id === tab ? "#7dd3fc" : "#3f4854";
    ctx.fillRect(x, 86, tabW - 10, 44);
    ctx.fillStyle = t.id === tab ? "#0f172a" : "#e2e8f0";
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(t.label, x + (tabW - 10) / 2, 116);
  });

  ctx.textAlign = "left";
  const rows = Array.isArray(state.lines) ? state.lines : [];
  const start = Math.max(0, Number(state.scroll) || 0);
  rows.slice(start, start + VISIBLE_ROWS).forEach((line, i) => {
    const y = 160 + i * 58;
    ctx.fillStyle = line.active ? "rgba(125,211,252,0.18)" : (i % 2 ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.28)");
    ctx.fillRect(20, y, w - 40, 52);
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "600 24px system-ui, sans-serif";
    ctx.fillText(String(line.label || "").slice(0, 42), 36, y + 22, w - 80);
    if (line.sub) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "500 18px system-ui, sans-serif";
      ctx.fillText(String(line.sub).slice(0, 58), 36, y + 44, w - 80);
    }
  });

  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 18px system-ui, sans-serif";
  ctx.fillText(String(state.footer || "Trigger a row · grip header to move").slice(0, 72), 28, h - 28, w - 56);
}

export function createXrStudioPanel({ THREE, scene } = {}) {
  const group = new THREE.Group();
  group.name = "xrStudioPanel";
  group.visible = false;
  group.renderOrder = 11900;
  const canvas = document.createElement("canvas");
  const backing = xrHudCanvasBackingSize(CANVAS.w, CANVAS.h, xrHudCanvasScale());
  canvas.width = backing.width;
  canvas.height = backing.height;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 4;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE.w, PLANE.h),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  plane.userData.xrStudioPanel = true;
  plane.renderOrder = 11900;
  const titleBar = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE.w - 0.08, 0.05),
    new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.001, depthTest: true, depthWrite: false }),
  );
  titleBar.position.y = PLANE.h / 2 - 0.024;
  titleBar.position.x = -0.02;
  titleBar.userData.xrStudioDrag = true;
  titleBar.renderOrder = 11901;
  applyWorldUiMaterialFlags(plane.material);
  applyWorldUiPickMaterialFlags(titleBar.material);
  group.add(plane, titleBar);
  try { scene?.add(group); } catch { /* ignore */ }

  let tab = "stats";
  let lines = [];
  let footer = "";
  let title = "Studio";
  let scroll = 0;
  let lastSig = "";
  let overflowOpen = false;
  let locked = false;

  function redraw(force = false) {
    const nextSig = xrConsoleSignature({ title, tab, lines, footer: `${footer}|${scroll}|${overflowOpen ? 1 : 0}|${locked ? 1 : 0}` });
    if (!shouldRedrawXrConsole({ lastSig, nextSig, force })) return;
    lastSig = nextSig;
    paint(ctx, { tab, lines, footer, title, scroll, overflowOpen, locked });
    tex.needsUpdate = true;
  }

  function setContent({ nextTab, nextLines, nextFooter, nextTitle } = {}) {
    if (nextTab) tab = nextTab;
    if (Array.isArray(nextLines)) {
      lines = nextLines;
      scroll = 0;
    }
    if (nextFooter != null) footer = nextFooter;
    if (nextTitle) title = nextTitle;
    redraw();
  }

  function open(headPos, forward) {
    group.visible = true;
    if (headPos && forward) {
      group.position.copy(headPos).addScaledVector(forward, 0.55);
      group.position.y -= 0.08;
      const toHead = headPos.clone().sub(group.position);
      toHead.y = 0;
      if (toHead.lengthSq() > 1e-6) {
        toHead.normalize();
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toHead);
      }
    }
    redraw(true);
  }

  function close() {
    group.visible = false;
  }

  function pickFromUv(uv) {
    if (!uv || !group.visible) return null;
    const px = uv.x * CANVAS.w;
    const py = (1 - uv.y) * CANVAS.h;
    const header = pickHudHeader(px, py, CANVAS.w, 72, { overflowOpen, locked });
    if (header) {
      if (header.id === "hide") return { kind: "studio-drag" };
      if (header.id === "rotate") return { kind: "studio-rotate" };
      if (header.id === "overflow" || header.id === "lock" || header.id === "unlock" || header.id === "move-this" || header.id === "move-set") {
        return { kind: "studio-action", id: header.id };
      }
      return { kind: "studio-drag" };
    }
    if (py < 72) return { kind: "studio-drag" };
    if (py >= 86 && py <= 130) {
      const tabW = (CANVAS.w - 48) / TABS.length;
      const idx = Math.floor((px - 24) / tabW);
      const t = TABS[idx];
      if (t) return { kind: "studio-tab", tab: t.id };
    }
    if (py >= 160 && py <= 160 + VISIBLE_ROWS * 58) {
      const idx = Math.floor((py - 160) / 58) + scroll;
      const line = lines[idx];
      if (line?.id) return { kind: "studio-row", line };
    }
    return { kind: "studio-chrome" };
  }

  return {
    group,
    plane,
    titleBar,
    open,
    close,
    setContent,
    pickFromUv,
    getTab: () => tab,
    setTab: (id) => { tab = id; scroll = 0; },
    toggleOverflow: () => {
      overflowOpen = !overflowOpen;
      redraw(true);
    },
    setOverflowOpen: (on) => {
      overflowOpen = !!on;
      redraw(true);
    },
    setLocked: (on) => {
      locked = !!on;
      redraw(true);
    },
    isOpen: () => group.visible,
    getScroll: () => scroll,
    setScroll: (n) => {
      const max = Math.max(0, lines.length - VISIBLE_ROWS);
      scroll = Math.max(0, Math.min(max, Number(n) || 0));
      redraw();
    },
  };
}
