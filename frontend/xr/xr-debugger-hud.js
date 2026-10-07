/**
 * In-headset debugger panel: live bindings + headset-specific controller layout.
 */

import { compactXrGamepadHands } from "./xr-controls-debug.js?v=xrctl1-xrdbg1-20260915-xrdbg2-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1&inputfix=20260916-1&teleop-y=20260922-poseconnect1";
import {
  xrControlHeadsetLabel,
  activeXrHeadset,
  XR_CONTROL_ACTIONS,
  mappedButtonIndex,
  xrButtonLabel,
  xrControlHudLabelFromId,
  xrControlHudLabel,
} from "./xr-control-map.js?v=xrmap1-20260915-xrdbg2-20260915-xrdispatch4&inputfix=20260916-1";

export const XR_DEBUGGER_HUD_CACHE = "xrdbg2";
export const DEBUGGER_CANVAS = { w: 768, h: 512 };
export const DEBUGGER_SEND_RECT = { x: 600, y: 12, w: 144, h: 40 };

export function debuggerActionFromCanvasPx(px, py) {
  const r = DEBUGGER_SEND_RECT;
  if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
    return { kind: "debugger-action", id: "send-log" };
  }
  return null;
}

const BTN_HOT = {
  0: "tr",
  1: "sq",
  4: "a",
  5: "b",
};

export function debuggerLayoutPads(headset = activeXrHeadset()) {
  const family = String(headset || "quest3");
  if (family === "vision") {
    return { left: { x: 90, y: 210 }, right: { x: 478, y: 210 }, kind: "pinch" };
  }
  return { left: { x: 70, y: 188 }, right: { x: 430, y: 188 }, kind: "touch" };
}

export function liveControlHighlights(hands = {}) {
  const out = { l: {}, r: {}, u: {} };
  for (const key of ["l", "r", "u"]) {
    const row = hands[key] || {};
    const ax = Array.isArray(row.ax) ? row.ax : [];
    out[key] = {
      tr: !!row.tr,
      sq: !!row.sq,
      a: !!row.a,
      b: !!row.b,
      stick: !!row.st,
      stickMove: !!row.move || ax.some((n) => Math.abs(Number(n) || 0) >= 0.35),
      extra: Array.isArray(row.x) ? row.x.filter((v) => Number.isInteger(Number(v))) : [],
      on: Array.isArray(row.on) ? row.on : [],
    };
  }
  return out;
}

function padSketch(ctx, origin, hand, lit, kind) {
  const { x, y } = origin;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#1e293b";
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 3;
  if (kind === "pinch") {
    ctx.beginPath();
    ctx.ellipse(110, 90, 70, 88, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(20, 20, 180, 200, 48);
    else ctx.rect(20, 20, 180, 200);
    ctx.fill();
    ctx.stroke();
  }
  const dots = [
    { id: "tr", cx: hand === "left" ? 70 : 150, cy: 70, label: "Trig" },
    { id: "sq", cx: hand === "left" ? 48 : 172, cy: 130, label: "Grip" },
    { id: "a", cx: hand === "left" ? 90 : 130, cy: 118, label: hand === "left" ? "X" : "A" },
    { id: "b", cx: hand === "left" ? 120 : 100, cy: 88, label: hand === "left" ? "Y" : "B" },
    { id: "stick", cx: 110, cy: 168, label: "Stick" },
  ];
  for (const d of dots) {
    ctx.beginPath();
    ctx.fillStyle = (lit[d.id] || (d.id === "stick" && lit.stickMove)) ? "#38bdf8" : "#334155";
    ctx.arc(d.cx, d.cy, d.id === "stick" ? 22 : 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = (lit[d.id] || (d.id === "stick" && lit.stickMove)) ? "#0f172a" : "#e2e8f0";
    ctx.font = "700 11px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(d.label, d.cx, d.cy + 36);
  }
  ctx.restore();
}

export function paintDebuggerHud(ctx, {
  headset = "quest3",
  hands = {},
  listenId = "",
  robotics = null,
  w = DEBUGGER_CANVAS.w,
  h = DEBUGGER_CANVAS.h,
} = {}) {
  if (!ctx) return;
  const lit = liveControlHighlights(hands);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#121821";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, w, 64);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 28px system-ui,sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Debugger", 24, 42);
  ctx.fillStyle = "#7dd3fc";
  ctx.font = "700 16px system-ui,sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(xrControlHeadsetLabel(headset), DEBUGGER_SEND_RECT.x - 16, 40);
  ctx.fillStyle = "#0ea5e9";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(DEBUGGER_SEND_RECT.x, DEBUGGER_SEND_RECT.y, DEBUGGER_SEND_RECT.w, DEBUGGER_SEND_RECT.h, 6);
    ctx.fill();
  } else {
    ctx.fillRect(DEBUGGER_SEND_RECT.x, DEBUGGER_SEND_RECT.y, DEBUGGER_SEND_RECT.w, DEBUGGER_SEND_RECT.h);
  }
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 15px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Send log", DEBUGGER_SEND_RECT.x + DEBUGGER_SEND_RECT.w / 2, 38);
  const layout = debuggerLayoutPads(headset);
  padSketch(ctx, layout.left, "left", lit.l, layout.kind);
  padSketch(ctx, layout.right, "right", lit.r || lit.u, layout.kind);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "600 15px system-ui,sans-serif";
  ctx.textAlign = "left";
  let y = 406;
  ctx.fillText("Responding", 24, y);
  const bits = [];
  for (const side of ["l", "r"]) {
    const row = lit[side];
    const names = row.on || [];
    if (names.length) {
      for (const id of names) bits.push(xrControlHudLabelFromId(id));
      continue;
    }
    const hand = side === "l" ? "left" : "right";
    if (row.tr) bits.push(xrControlHudLabel(0, hand));
    if (row.sq) bits.push(xrControlHudLabel(1, hand));
    if (row.a) bits.push(xrControlHudLabel(4, hand));
    if (row.b) bits.push(xrControlHudLabel(5, hand));
    if (row.stick) bits.push(xrControlHudLabel(3, hand));
    if (row.stickMove) bits.push(side === "l" ? "left stick move" : "right stick move");
    for (const idx of row.extra || []) bits.push(xrControlHudLabel(idx, hand));
  }
  ctx.fillStyle = "#38bdf8";
  ctx.fillText(bits.length ? bits.slice(0, 8).join(" · ") : "Waiting for a press…", 140, y);
  const net = robotics || {};
  ctx.fillStyle = net.socketState === "open" ? "#4ade80" : net.lastError ? "#f87171" : "#fbbf24";
  ctx.font = "600 13px system-ui,sans-serif";
  ctx.fillText(`DIMOS ${net.socketState || "idle"} · ${net.transport || "none"} · packets ${Number(net.packets) || 0}`, 24, 450);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 14px system-ui,sans-serif";
  const detail = net.lastError || net.closeReason || (net.y?.action ? `Y ${net.y.action}` : "Click both analog sticks in to exit");
  ctx.fillText(listenId ? `Listening for ${listenId}…` : String(detail).slice(0, 92), 24, 474);
  ctx.fillText(XR_CONTROL_ACTIONS.map((a) => `${a.label.split("·")[0].trim()}:${xrButtonLabel(mappedButtonIndex(a.id, headset))}`).join("  "), 24, 498);
}

export function compactHandsFromSources(inputSources = []) {
  return compactXrGamepadHands(inputSources);
}

export { BTN_HOT };
