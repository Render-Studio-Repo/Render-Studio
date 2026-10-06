/**
 * Opposite-hand AI Draw tooltip: color wheel + pen size.
 * Menu UI defaults to the left controller → this HUD sits on the right.
 */

import * as THREE from "three";
import { makeColoredPuckTexture, sharpTexture } from "./xr-ui-tex.js?v=20260907-xr-grab3";
import { drawHandWristLocalOffset, drawHandHostIsWristBone, xrHudPlateFromItems } from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&drawface1=1&lefthud1=1&astra=20260916-5";

const WHEEL_R = 0.052;
const SIZE_IDS = [
  { id: "draw_size_s", label: "Fine", r: 0.005, color: 0x94a3b8 },
  { id: "draw_size_m", label: "Med", r: 0.009, color: 0x06b6d4 },
  { id: "draw_size_l", label: "Bold", r: 0.018, color: 0xe85d4c },
];

function makeWheelTexture(selected = 0x06b6d4) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.48;
  const inner = size * 0.16;
  for (let i = 0; i < 72; i += 1) {
    const a0 = (i / 72) * Math.PI * 2;
    const a1 = ((i + 1.15) / 72) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * inner, cy + Math.sin(a0) * inner);
    ctx.arc(cx, cy, outer, a0, a1);
    ctx.lineTo(cx + Math.cos(a1) * inner, cy + Math.sin(a1) * inner);
    ctx.closePath();
    ctx.fillStyle = `hsl(${(i / 72) * 360}, 85%, 56%)`;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, inner - 2, 0, Math.PI * 2);
  ctx.fillStyle = `#${(selected >>> 0).toString(16).padStart(6, "0")}`;
  ctx.fill();
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 4;
  ctx.stroke();
  return sharpTexture(canvas);
}

function hueFromUv(uv) {
  if (!uv) return null;
  const x = uv.x * 2 - 1;
  const y = uv.y * 2 - 1;
  const r = Math.hypot(x, y);
  if (r < 0.22 || r > 1.02) return null;
  let hue = Math.atan2(y, x) / (Math.PI * 2);
  if (hue < 0) hue += 1;
  const h = hue * 360;
  const s = 0.85;
  const l = 0.56;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  const hex = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return (hex(f(0)) << 16) | (hex(f(8)) << 8) | hex(f(4));
}

export function createXrDrawHud({ THREE: T = THREE } = {}) {
  const group = new T.Group();
  group.name = "xrDrawHud";
  group.visible = false;
  group.frustumCulled = false;
  group.renderOrder = 10250;

  const plateSpec = xrHudPlateFromItems([
    { x: 0, y: 0.032, r: WHEEL_R },
    ...SIZE_IDS.map((spec, i) => ({ x: (i - 1) * 0.046, y: -0.062, r: 0.018 })),
  ], { pad: 0.022, hoverScale: 1.18 });
  const plate = new T.Mesh(
    new T.PlaneGeometry(plateSpec.w, plateSpec.h),
    new T.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.82,
      depthTest: false,
      depthWrite: false,
      side: T.DoubleSide,
      toneMapped: false,
    }),
  );
  plate.position.set(plateSpec.x, plateSpec.y, -0.004);
  plate.renderOrder = 10250;
  plate.frustumCulled = false;
  plate.userData.xrDrawHud = "chrome";
  group.add(plate);

  let wheelMap = makeWheelTexture();
  const wheel = new T.Mesh(
    new T.CircleGeometry(WHEEL_R, 48),
    new T.MeshBasicMaterial({
      map: wheelMap,
      side: T.DoubleSide,
      depthTest: false,
      depthWrite: true,
      toneMapped: false,
    }),
  );
  wheel.position.set(0, 0.032, 0.006);
  wheel.renderOrder = 10252;
  wheel.frustumCulled = false;
  wheel.userData.xrDrawHud = "wheel";
  group.add(wheel);

  const sizes = SIZE_IDS.map((spec, i) => {
    const x = (i - 1) * 0.046;
    const hit = new T.Mesh(
      new T.CircleGeometry(0.018, 24),
      new T.MeshBasicMaterial({
        color: spec.color,
        side: T.DoubleSide,
        depthTest: false,
        depthWrite: true,
        toneMapped: false,
      }),
    );
    hit.position.set(x, -0.062, 0.006);
    hit.renderOrder = 10253;
    hit.frustumCulled = false;
    hit.userData.xrDrawHud = "size";
    hit.userData.xrDrawSize = spec.id;
    group.add(hit);
    const map = makeColoredPuckTexture({
      label: spec.label,
      icon: spec.id === "draw_size_s" ? "minus" : spec.id === "draw_size_l" ? "plus" : "draw",
      color: spec.color,
      size: 192,
    });
    const puck = new T.Mesh(
      new T.CircleGeometry(0.016, 24),
      new T.MeshBasicMaterial({
        map,
        side: T.DoubleSide,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    puck.position.set(x, -0.062, 0.008);
    puck.renderOrder = 10254;
    puck.frustumCulled = false;
    puck.raycast = () => {};
    group.add(puck);
    return { id: spec.id, hit, puck };
  });

  function setColor(color) {
    const n = typeof color === "number" ? color : parseInt(String(color).replace("#", ""), 16);
    if (!Number.isFinite(n)) return;
    try { wheelMap.dispose?.(); } catch { /* ignore */ }
    wheelMap = makeWheelTexture(n);
    wheel.material.map = wheelMap;
    wheel.material.needsUpdate = true;
  }

  function setSizeId(id) {
    for (const row of sizes) {
      const on = row.id === id;
      row.hit.scale.setScalar(on ? 1.18 : 1);
      row.puck.scale.setScalar(on ? 1.18 : 1);
    }
  }

  function setVisible(on) {
    group.visible = !!on;
  }

  function attachTo(host, { dockHand = "left" } = {}) {
    if (!host) return;
    if (group.parent !== host) {
      try { group.parent?.remove(group); } catch { /* ignore */ }
      try { host.add(group); } catch { /* ignore */ }
    }
    const rightHud = dockHand !== "right";
    const off = drawHandWristLocalOffset({
      drawingIsRight: rightHud,
      useWrist: drawHandHostIsWristBone(host),
    });
    group.position.set(off.x, off.y, off.z);
    group.rotation.set(off.rx, off.ry, off.rz);
  }

  function pickFromHits(hits) {
    if (!hits?.length) return null;
    const sorted = hits
      .filter((h) => h?.object && group.visible && (h.object === wheel || h.object.userData?.xrDrawHud))
      .sort((a, b) => a.distance - b.distance);
    if (!sorted.length) return null;
    const best = sorted[0];
    const kind = best.object.userData?.xrDrawHud;
    if (kind === "wheel" || best.object === wheel) {
      const colorNum = hueFromUv(best.uv);
      if (colorNum == null) return { kind: "draw-hud-chrome", distance: best.distance };
      return { kind: "draw-hud-color", colorNum, distance: best.distance };
    }
    if (kind === "size") {
      return { kind: "draw-hud-size", id: best.object.userData.xrDrawSize, distance: best.distance };
    }
    if (kind === "chrome") return { kind: "draw-hud-chrome", distance: best.distance };
    return null;
  }

  function dispose() {
    try { group.parent?.remove(group); } catch { /* ignore */ }
    try { wheelMap.dispose?.(); } catch { /* ignore */ }
  }

  return {
    group,
    setVisible,
    setColor,
    setSizeId,
    attachTo,
    pickFromHits,
    dispose,
  };
}
