/**
 * Opaque XR puck textures — small canvases (Quest GPU). No mipmaps, no alpha fringe.
 */

import * as THREE from "three";

export function hexColor(n) {
  const v = Number(n) || 0;
  return `#${v.toString(16).padStart(6, "0")}`;
}

export function sharpTexture(canvas, { anisotropy = 4 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = Math.max(1, Math.min(8, Number(anisotropy) || 4));
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  return tex;
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

/** White pictogram on a fully opaque colored disc. */
export function drawFilledIcon(ctx, icon, cx, cy, size, color = "#ffffff") {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(7, size * 0.1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const s = size * 0.32;
  const id = String(icon || "move");

  if (id === "folder") {
    ctx.beginPath();ctx.moveTo(cx-s,cy-s*.55);ctx.lineTo(cx-s*.2,cy-s*.55);
    ctx.lineTo(cx,cy-s*.25);ctx.lineTo(cx+s,cy-s*.25);ctx.lineTo(cx+s,cy+s*.7);
    ctx.lineTo(cx-s,cy+s*.7);ctx.closePath();ctx.fill();
  } else if (id === "menu") {
    for (const dy of [-s * 0.45, 0, s * 0.45]) {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.7, cy + dy);
      ctx.lineTo(cx + s * 0.7, cy + dy);
      ctx.stroke();
    }
  } else if (id === "social" || id === "people") {
    ctx.beginPath();
    ctx.arc(cx - s * 0.22, cy - s * 0.18, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + s * 0.28, cy - s * 0.08, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.22, cy + s * 0.32, s * 0.38, s * 0.22, 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + s * 0.28, cy + s * 0.36, s * 0.3, s * 0.18, 0, Math.PI, 0);
    ctx.fill();
  } else if (id === "workspace") {
    ctx.fillRect(cx - s * 0.62, cy - s * 0.08, s * 1.24, s * 0.7);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.72, cy - s * 0.08);
    ctx.lineTo(cx, cy - s * 0.7);
    ctx.lineTo(cx + s * 0.72, cy - s * 0.08);
    ctx.closePath();
    ctx.fill();
  } else if (id === "ai" || id === "run") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.15, cy - s * 0.7);
    ctx.lineTo(cx + s * 0.7, cy);
    ctx.lineTo(cx - s * 0.15, cy + s * 0.7);
    ctx.closePath();
    ctx.fill();
  } else if (id === "move") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.7, cy);
    ctx.lineTo(cx + s * 0.7, cy);
    ctx.moveTo(cx, cy - s * 0.7);
    ctx.lineTo(cx, cy + s * 0.7);
    ctx.stroke();
  } else if (id === "measure") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.65, cy + s * 0.45);
    ctx.lineTo(cx + s * 0.65, cy - s * 0.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - s * 0.65, cy + s * 0.45, s * 0.16, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.65, cy - s * 0.45, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "draw") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.45, cy + s * 0.55);
    ctx.lineTo(cx + s * 0.2, cy - s * 0.6);
    ctx.lineTo(cx + s * 0.5, cy - s * 0.3);
    ctx.lineTo(cx - s * 0.15, cy + s * 0.85);
    ctx.closePath();
    ctx.fill();
  } else if (id === "mic" || id === "transcribe") {
    roundRect(ctx, cx - s * 0.28, cy - s * 0.62, s * 0.56, s * 0.78, s * 0.28);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.18, s * 0.46, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.64);
    ctx.lineTo(cx, cy + s * 0.82);
    ctx.stroke();
  } else if (id === "box") {
    ctx.fillRect(cx - s * 0.62, cy - s * 0.38, s * 1.24, s * 0.95);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.strokeRect(cx - s * 0.62, cy - s * 0.38, s * 1.24, s * 0.95);
  } else if (id === "cyl" || id === "cylinder") {
    ctx.beginPath();
    ctx.ellipse(cx, cy - s * 0.42, s * 0.55, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - s * 0.55, cy - s * 0.42, s * 1.1, s * 0.85);
    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.43, s * 0.55, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "sphere") {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.7, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "cone") {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.75);
    ctx.lineTo(cx + s * 0.72, cy + s * 0.65);
    ctx.lineTo(cx - s * 0.72, cy + s * 0.65);
    ctx.closePath();
    ctx.fill();
  } else if (id === "torus") {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(10, size * 0.14);
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.32, 0, Math.PI * 2);
    ctx.stroke();
  } else if (id === "color") {
    ctx.beginPath();
    ctx.arc(cx - s * 0.22, cy - s * 0.1, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(cx + s * 0.28, cy + s * 0.12, s * 0.38, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "front" || id === "place") {
    ctx.fillRect(cx - s * 0.55, cy - s * 0.12, s * 1.1, s * 0.72);
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.7);
    ctx.lineTo(cx, cy - s * 0.12);
    ctx.stroke();
  } else if (id === "fit") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.6, cy - s * 0.05);
    ctx.lineTo(cx, cy - s * 0.7);
    ctx.lineTo(cx + s * 0.6, cy - s * 0.05);
    ctx.closePath();
    ctx.fill();
  } else if (id === "pass" || id === "eye") {
    ctx.beginPath();
    ctx.ellipse(cx, cy, s * 0.78, s * 0.48, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.24, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "room") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.7, cy - s * 0.05);
    ctx.lineTo(cx, cy - s * 0.72);
    ctx.lineTo(cx + s * 0.7, cy - s * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - s * 0.52, cy - s * 0.05, s * 1.04, s * 0.7);
  } else if (id === "cam") {
    ctx.fillRect(cx - s * 0.7, cy - s * 0.28, s * 1.4, s * 0.78);
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.08, s * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fill();
  } else if (id === "rec") {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "pause") {
    ctx.fillRect(cx - s * 0.38, cy - s * 0.5, s * 0.26, s * 1.0);
    ctx.fillRect(cx + s * 0.12, cy - s * 0.5, s * 0.26, s * 1.0);
  } else if (id === "stream") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.55, cy + s * 0.45);
    ctx.lineTo(cx, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.55, cy + s * 0.45);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.08, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "robot" || id === "robotics") {
    roundRect(ctx, cx - s * 0.55, cy - s * 0.18, s * 1.1, s * 0.85, s * 0.18);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.42, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(cx - s * 0.16, cy - s * 0.44, s * 0.1, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.16, cy - s * 0.44, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(cx - s * 0.04, cy - s * 0.92, s * 0.08, s * 0.22);
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.96, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "stop") {
    ctx.fillRect(cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.84);
  } else if (id === "undo") {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.55, 0.4, Math.PI * 1.5);
    ctx.stroke();
  } else if (id === "redo") {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.55, Math.PI - 0.4, Math.PI * 1.5, true);
    ctx.stroke();
  } else if (id === "search") {
    ctx.beginPath();
    ctx.arc(cx - s * 0.12, cy - s * 0.12, s * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.18, cy + s * 0.18);
    ctx.lineTo(cx + s * 0.52, cy + s * 0.52);
    ctx.stroke();
  } else if (id === "share") {
    ctx.beginPath();
    ctx.arc(cx - s * 0.38, cy, s * 0.16, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.38, cy - s * 0.38, s * 0.16, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.38, cy + s * 0.38, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.24, cy - s * 0.08);
    ctx.lineTo(cx + s * 0.22, cy - s * 0.3);
    ctx.moveTo(cx - s * 0.24, cy + s * 0.08);
    ctx.lineTo(cx + s * 0.22, cy + s * 0.3);
    ctx.stroke();
  } else if (id === "export") {
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.55);
    ctx.lineTo(cx, cy - s * 0.45);
    ctx.moveTo(cx - s * 0.4, cy - s * 0.05);
    ctx.lineTo(cx, cy - s * 0.5);
    ctx.lineTo(cx + s * 0.4, cy - s * 0.05);
    ctx.stroke();
  } else if (id === "exit") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.45, cy - s * 0.45);
    ctx.lineTo(cx + s * 0.45, cy + s * 0.45);
    ctx.moveTo(cx + s * 0.45, cy - s * 0.45);
    ctx.lineTo(cx - s * 0.45, cy + s * 0.45);
    ctx.stroke();
  } else if (id === "section") {
    ctx.fillRect(cx - s * 0.7, cy - s * 0.55, s * 1.4, s * 1.1);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.7, cy + s * 0.2);
    ctx.lineTo(cx + s * 0.7, cy - s * 0.35);
    ctx.lineTo(cx + s * 0.7, cy + s * 0.55);
    ctx.lineTo(cx - s * 0.7, cy + s * 0.55);
    ctx.closePath();
    ctx.fill();
  } else if (id === "ghost" || id === "transparent") {
    ctx.globalAlpha = 0.32;
    ctx.beginPath();
    ctx.ellipse(cx, cy, s * 0.72, s * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, s * 0.46, s * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.18, cy - s * 0.08);
    ctx.lineTo(cx + s * 0.22, cy);
    ctx.lineTo(cx - s * 0.18, cy + s * 0.08);
    ctx.closePath();
    ctx.fill();
  } else if (id === "explode") {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dx * s * 0.65, cy + dy * s * 0.65);
      ctx.stroke();
    }
  } else if (id === "wall") {
    ctx.fillRect(cx - s * 0.7, cy - s * 0.45, s * 1.4, s * 0.9);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(cx - s * 0.18, cy - s * 0.1, s * 0.36, s * 0.55);
  } else if (id === "floor") {
    ctx.fillRect(cx - s * 0.7, cy + s * 0.15, s * 1.4, s * 0.22);
    ctx.strokeRect(cx - s * 0.55, cy - s * 0.35, s * 1.1, s * 0.5);
  } else if (id === "snap") {
    ctx.strokeRect(cx - s * 0.55, cy - s * 0.55, s * 1.1, s * 1.1);
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.55);
    ctx.lineTo(cx, cy + s * 0.55);
    ctx.moveTo(cx - s * 0.55, cy);
    ctx.lineTo(cx + s * 0.55, cy);
    ctx.stroke();
  } else if (id === "copy" || id === "duplicate") {
    ctx.strokeRect(cx - s * 0.55, cy - s * 0.45, s * 0.85, s * 0.85);
    ctx.fillRect(cx - s * 0.2, cy - s * 0.2, s * 0.85, s * 0.85);
  } else if (id === "layer" || id === "layers") {
    ctx.globalAlpha = 0.45;
    ctx.fillRect(cx - s * 0.55, cy - s * 0.5, s * 1.1, s * 0.32);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(cx - s * 0.55, cy - s * 0.14, s * 1.1, s * 0.32);
    ctx.globalAlpha = 1;
    ctx.fillRect(cx - s * 0.55, cy + s * 0.22, s * 1.1, s * 0.32);
  } else if (id === "pull" || id === "height") {
    ctx.fillRect(cx - s * 0.55, cy + s * 0.15, s * 1.1, s * 0.22);
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.15);
    ctx.lineTo(cx, cy - s * 0.55);
    ctx.moveTo(cx - s * 0.28, cy - s * 0.22);
    ctx.lineTo(cx, cy - s * 0.58);
    ctx.lineTo(cx + s * 0.28, cy - s * 0.22);
    ctx.stroke();
  } else if (id === "slice") {
    ctx.strokeRect(cx - s * 0.55, cy - s * 0.45, s * 0.95, s * 0.9);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.75, cy + s * 0.55);
    ctx.lineTo(cx + s * 0.75, cy - s * 0.55);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.fillRect(cx - s * 0.55, cy - s * 0.45, s * 0.48, s * 0.9);
    ctx.globalAlpha = 1;
  } else if (id === "sym" || id === "mirror") {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.7);
    ctx.lineTo(cx, cy + s * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - s * 0.35, cy, s * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + s * 0.35, cy, s * 0.28, 0, Math.PI * 2);
    ctx.stroke();
  } else if (id === "wheel") {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * s * 0.48, cy + Math.sin(a) * s * 0.48, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === "settings") {
    ctx.lineWidth = Math.max(12, size * 0.16);
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * s * 0.58;
      const y = cy + Math.sin(a) * s * 0.58;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === "hand_left" || id === "hand_right") {
    const flip = id === "hand_left" ? -1 : 1;
    ctx.fillRect(cx - s * 0.16, cy - s * 0.12, s * 0.32, s * 0.72);
    ctx.fillRect(cx + flip * s * 0.16, cy + s * 0.02, s * 0.28, s * 0.2);
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.28, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "view") {
    ctx.strokeRect(cx - s * 0.62, cy - s * 0.42, s * 1.24, s * 0.84);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.28, cy - s * 0.12);
    ctx.lineTo(cx, cy - s * 0.42);
    ctx.lineTo(cx + s * 0.28, cy - s * 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.08, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "wire") {
    ctx.strokeRect(cx - s * 0.55, cy - s * 0.38, s * 1.1, s * 0.76);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.55, cy);
    ctx.lineTo(cx + s * 0.55, cy);
    ctx.moveTo(cx, cy - s * 0.38);
    ctx.lineTo(cx, cy + s * 0.38);
    ctx.stroke();
  } else if (id === "group") {
    ctx.beginPath();
    ctx.arc(cx - s * 0.28, cy - s * 0.18, s * 0.28, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.28, cy - s * 0.18, s * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeRect(cx - s * 0.7, cy + s * 0.12, s * 1.4, s * 0.55);
  } else if (id === "tree") {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.7);
    ctx.lineTo(cx, cy + s * 0.7);
    ctx.moveTo(cx, cy - s * 0.15);
    ctx.lineTo(cx - s * 0.5, cy + s * 0.15);
    ctx.moveTo(cx, cy - s * 0.15);
    ctx.lineTo(cx + s * 0.5, cy + s * 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - s * 0.5, cy + s * 0.2, s * 0.14, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.5, cy + s * 0.2, s * 0.14, 0, Math.PI * 2);
    ctx.arc(cx, cy + s * 0.7, s * 0.14, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "knowledge") {
    ctx.fillRect(cx - s * 0.55, cy - s * 0.5, s * 1.1, s * 1.0);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(cx - s * 0.38, cy - s * 0.32, s * 0.76, s * 0.12);
    ctx.fillRect(cx - s * 0.38, cy - s * 0.08, s * 0.76, s * 0.12);
    ctx.globalAlpha = 1;
  } else if (id === "units") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.7, cy + s * 0.35);
    ctx.lineTo(cx + s * 0.7, cy + s * 0.35);
    ctx.stroke();
    for (const t of [-0.7, -0.35, 0, 0.35, 0.7]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * t, cy + s * 0.35);
      ctx.lineTo(cx + s * t, cy + s * (t === 0 ? -0.15 : 0.08));
      ctx.stroke();
    }
  } else if (id === "eraser") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.55, cy + s * 0.1);
    ctx.lineTo(cx - s * 0.1, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.25, cy - s * 0.2);
    ctx.lineTo(cx - s * 0.2, cy + s * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(15,23,42,0.45)";
    ctx.fillRect(cx - s * 0.52, cy + s * 0.18, s * 0.42, s * 0.28);
  } else if (id === "plus") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.42, cy);
    ctx.lineTo(cx + s * 0.42, cy);
    ctx.moveTo(cx, cy - s * 0.42);
    ctx.lineTo(cx, cy + s * 0.42);
    ctx.stroke();
  } else if (id === "minus") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.42, cy);
    ctx.lineTo(cx + s * 0.42, cy);
    ctx.stroke();
  } else if (id === "restore") {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.52, Math.PI * 0.15, Math.PI * 1.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.18, cy - s * 0.62);
    ctx.lineTo(cx + s * 0.52, cy - s * 0.22);
    ctx.lineTo(cx + s * 0.02, cy - s * 0.18);
    ctx.closePath();
    ctx.fill();
  } else if (id === "agent") {
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.08, s * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.55, cy - s * 0.08);
    ctx.lineTo(cx - s * 0.78, cy + s * 0.22);
    ctx.moveTo(cx + s * 0.55, cy - s * 0.08);
    ctx.lineTo(cx + s * 0.78, cy + s * 0.22);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - s * 0.16, cy - s * 0.12, s * 0.08, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.16, cy - s * 0.12, s * 0.08, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeRect(cx - s * 0.55, cy - s * 0.55, s * 1.1, s * 1.1);
  }
  ctx.restore();
}

/** Dark chassis — thick rim, no hairline silver wash. */
export function fillDarkMetalChrome(ctx, w, h, radius = 26) {
  ctx.fillStyle = "#0f1720";
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fill();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 6;
  roundRect(ctx, 4, 4, w - 8, h - 8, Math.max(10, radius - 2));
  ctx.stroke();
}

export function fillHighContrastHudChrome(ctx, w, h, radius = 24) {
  fillDarkMetalChrome(ctx, w, h, radius);
}

export function fillDarkMetalHeader(ctx, w, headerEnd, radius = 26) {
  ctx.fillStyle = "#1e293b";
  roundRect(ctx, 0, 0, w, headerEnd, radius);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, headerEnd - 10, w, 10);
}

/** Keep glyphs off the plane edge so headset sampling does not clip strokes. */
export const XR_HUD_TEXT_INSET = 28;

export function hudTextMaxWidth(x, logicalW, { inset = XR_HUD_TEXT_INSET, align = "left" } = {}) {
  const w = Number(logicalW) || 0;
  if (!(w > 0)) return Number.POSITIVE_INFINITY;
  const pad = Math.max(8, Number(inset) || XR_HUD_TEXT_INSET);
  const px = Number(x) || 0;
  const key = String(align || "left").toLowerCase();
  if (key === "center" || key === "middle") {
    return Math.max(32, Math.min(px - pad, w - px - pad) * 2);
  }
  if (key === "right" || key === "end") {
    return Math.max(32, px - pad);
  }
  return Math.max(32, w - px - pad);
}

export function wrapHudCanvasText(ctx, logicalW, inset = XR_HUD_TEXT_INSET) {
  if (!ctx) return ctx;
  ctx._xrHudLogicalW = Number(logicalW) || ctx._xrHudLogicalW || 0;
  ctx._xrHudTextInset = Number(inset) > 0 ? Number(inset) : XR_HUD_TEXT_INSET;
  if (ctx._xrHudTextWrapped) return ctx;
  const fill = ctx.fillText.bind(ctx);
  const stroke = ctx.strokeText.bind(ctx);
  const capFor = (x) => hudTextMaxWidth(x, ctx._xrHudLogicalW, {
    inset: ctx._xrHudTextInset,
    align: ctx.textAlign,
  });
  const draw = (fn, text, x, y, maxW) => {
    const cap = capFor(x);
    if (!Number.isFinite(cap)) {
      return Number.isFinite(maxW) && maxW > 0 ? fn(text, x, y, maxW) : fn(text, x, y);
    }
    const used = Number.isFinite(maxW) && maxW > 0 ? Math.min(maxW, cap) : cap;
    return fn(text, x, y, used);
  };
  ctx.fillText = (text, x, y, maxW) => draw(fill, text, x, y, maxW);
  ctx.strokeText = (text, x, y, maxW) => draw(stroke, text, x, y, maxW);
  ctx._xrHudTextWrapped = true;
  return ctx;
}

export function drawHudLabel(ctx, text, x, y, {
  font = "800 34px Arial,sans-serif",
  fill = "#ffffff",
  stroke = "#020617",
  lineWidth = 7,
  align = "left",
  baseline = "middle",
  maxWidth,
  pad,
} = {}) {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  const t = String(text || "");
  const logicalW = Number(ctx?._xrHudLogicalW)
    || (Number(ctx?.canvas?.width) / (Number(ctx?.getTransform?.().a) || 1))
    || 0;
  const inset = Number(pad) > 0 ? Number(pad) : XR_HUD_TEXT_INSET;
  const inferred = logicalW > 0 ? hudTextMaxWidth(x, logicalW, { inset, align }) : Number.POSITIVE_INFINITY;
  const explicit = Number(maxWidth);
  const mw = Number.isFinite(explicit) && explicit > 0
    ? Math.min(explicit, inferred)
    : inferred;
  if (Number.isFinite(mw)) {
    ctx.strokeText(t, x, y, mw);
    ctx.fillText(t, x, y, mw);
  } else {
    ctx.strokeText(t, x, y);
    ctx.fillText(t, x, y);
  }
  ctx.restore();
}

export function drawWindowOverflowDots(ctx, w, headerH = 72) {
  const cx = w - 96;
  const cy = Math.round(headerH * 0.42);
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fillStyle = "#334155";
  ctx.fill();
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.fillStyle = "#f8fafc";
  for (const dy of [-8, 0, 8]) {
    ctx.beginPath();
    ctx.arc(cx, cy + dy, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  return { cx, cy, r: 18 };
}

export function drawWindowCloseX(ctx, w, headerH = 72) {
  const cx = w - 40;
  const cy = Math.round(headerH * 0.42);
  const r = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#4b5563";
  ctx.fill();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy - 7);
  ctx.lineTo(cx + 7, cy + 7);
  ctx.moveTo(cx + 7, cy - 7);
  ctx.lineTo(cx - 7, cy + 7);
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 4.2;
  ctx.lineCap = "round";
  ctx.stroke();
  return { cx, cy, r };
}

export function makeColoredPuckTexture({
  label = "",
  icon = "move",
  color = 0xe85d4c,
  active = false,
  size = 256,
  iconOnly = false,
} = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  const fill = hexColor(color);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.49, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.48, 0, Math.PI * 2);
  ctx.fillStyle = active ? fill : "#1e293b";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.455, 0, Math.PI * 2);
  ctx.strokeStyle = active ? "#ffffff" : "#f8fafc";
  ctx.lineWidth = size * 0.07;
  ctx.stroke();
  const ink = "#ffffff";
  if (iconOnly) {
    drawFilledIcon(ctx, icon, size / 2, size / 2, size * 0.72, ink);
  } else {
    drawFilledIcon(ctx, icon, size / 2, size * 0.38, size * 0.56, ink);
    ctx.fillStyle = "rgba(2,6,23,0.82)";
    roundRect(ctx, size * 0.08, size * 0.64, size * 0.84, size * 0.28, size * 0.08);
    ctx.fill();
    ctx.font = `800 ${Math.round(size * 0.18)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(10, size * 0.06);
    ctx.strokeStyle = "#020617";
    ctx.fillStyle = ink;
    const text = String(label || "").slice(0, 10);
    ctx.strokeText(text, size / 2, size * 0.78);
    ctx.fillText(text, size / 2, size * 0.78);
  }
  ctx.restore();
  return sharpTexture(canvas);
}

export function makeColorSwatchTexture(color, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#1c1917";
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = hexColor(color);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = size * 0.06;
  ctx.stroke();
  return sharpTexture(canvas);
}

export function makeWheelDiscTexture(size = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#efe8df";
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size * 0.42, size * 0.38, 24, size / 2, size / 2, size / 2);
  g.addColorStop(0, "#fffaf4");
  g.addColorStop(0.55, "#f3ebe3");
  g.addColorStop(1, "#e2d5c8");
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(28,25,23,0.16)";
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = "#fffdf9";
  ctx.fill();
  ctx.strokeStyle = "#e85d4c";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = "#1c1917";
  ctx.font = `700 ${Math.round(size * 0.055)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Move", size / 2, size / 2);
  return sharpTexture(canvas);
}

export function makeBandTexture(label, size = { w: 256, h: 256 }) {
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, size.w, size.h);
  roundRect(ctx, 10, 10, size.w - 20, size.h - 20, 28);
  ctx.fillStyle = "#1e293b";
  ctx.fill();
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = "#cbd5e1";
  ctx.font = `700 ${Math.round(size.h * 0.11)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(label || "Tools").slice(0, 22), size.w / 2, size.h * 0.12);
  return sharpTexture(canvas);
}
