/**
 * Arkio-style in-headset Guides: category chips + swipeable simulated clips.
 * One reused canvas — swipe only changes which clip is painted.
 * Physical Quest recording is not available in-browser; clips are 2D simulations
 * of the real tools (controller ray + labels).
 */

export const GUIDES_CANVAS = { w: 768, h: 512, headerEnd: 62 };
export const GUIDES_PLANE = { w: 0.52, h: 0.347 };

export const XR_GUIDE_CATEGORIES = [
  {
    id: "move",
    label: "Move",
    clips: [
      { id: "grab", title: "Squeeze to grab", hint: "Aim the ray · squeeze grip · drag the part" },
      { id: "scale", title: "Two-hand scale", hint: "Squeeze both grips and pull apart" },
      { id: "wheel", title: "Hold A for tools", hint: "Hold A on the right controller — the tool wheel appears in front" },
    ],
  },
  {
    id: "draw",
    label: "Draw",
    clips: [
      { id: "stroke", title: "Draw in space", hint: "Open Draw · hold trigger · ink follows the tip" },
      { id: "color", title: "Color & size", hint: "Wrist palette · swatch · Fine / Med / Bold" },
    ],
  },
  {
    id: "board",
    label: "Board",
    clips: [
      { id: "table", title: "Round table", hint: "Settings → Board seats you with others" },
      { id: "walk", title: "Walk the board", hint: "Hold B · left and right sticks walk" },
    ],
  },
  {
    id: "capture",
    label: "Capture",
    clips: [
      { id: "shot", title: "Screenshot", hint: "Wrist Capture → Shot sends to your PC" },
      { id: "rec", title: "Record", hint: "Capture → Rec · Pause / Stop on the crescent" },
    ],
  },
  {
    id: "social",
    label: "Social",
    clips: [
      { id: "room", title: "Public room", hint: "Social → Room joins the shared lobby" },
      { id: "mic", title: "Talk", hint: "Mic on the wrist rail · mute keeps the stream" },
    ],
  },
  {
    id: "teleport",
    label: "Teleport",
    clips: [
      { id: "arc", title: "Teleport", hint: "Settings → Teleport · aim at the floor · click" },
    ],
  },
];

export function guideCategoryById(id) {
  return XR_GUIDE_CATEGORIES.find((c) => c.id === id) || XR_GUIDE_CATEGORIES[0];
}

export function guideCategoryIndex(id) {
  const i = XR_GUIDE_CATEGORIES.findIndex((c) => c.id === id);
  return i < 0 ? 0 : i;
}

export function wrapGuideClipIndex(category, index, delta = 0) {
  const clips = category?.clips || guideCategoryById(category)?.clips || [];
  const n = Math.max(1, clips.length);
  const i = Number(index) || 0;
  const d = Number(delta) || 0;
  return ((i + d) % n + n) % n;
}

/** Swipe left (negative dx) → next clip. Returns -1, 0, or 1. */
export function swipeGuideFromDeltaX(dx, threshold = 48) {
  const x = Number(dx) || 0;
  const t = Math.max(8, Number(threshold) || 48);
  if (x <= -t) return 1;
  if (x >= t) return -1;
  return 0;
}

export function guidesLayout() {
  const { w, h, headerEnd } = GUIDES_CANVAS;
  const catY = headerEnd + 10;
  const catH = 44;
  const n = XR_GUIDE_CATEGORIES.length;
  const gap = 8;
  const pad = 22;
  const catW = (w - pad * 2 - gap * (n - 1)) / n;
  const cats = XR_GUIDE_CATEGORIES.map((c, i) => ({
    id: c.id,
    x: pad + i * (catW + gap),
    y: catY,
    w: catW,
    h: catH,
  }));
  const clip = { x: 28, y: catY + catH + 14, w: w - 56, h: 268 };
  return {
    w,
    h,
    headerEnd,
    cats,
    clip,
    prev: { x: clip.x + 8, y: clip.y + clip.h / 2 - 28, w: 48, h: 56 },
    next: { x: clip.x + clip.w - 56, y: clip.y + clip.h / 2 - 28, w: 48, h: 56 },
    hide: { x: w - 86, y: 10, w: 68, h: headerEnd - 16 },
    drag: { x: 12, y: 8, w: w - 110, h: headerEnd - 12 },
  };
}

export function pickGuidesHit(px, py) {
  const L = guidesLayout();
  if (!(px >= 0 && py >= 0 && px <= L.w && py <= L.h)) return null;
  if (px >= L.hide.x && px <= L.hide.x + L.hide.w && py >= L.hide.y && py <= L.hide.y + L.hide.h) {
    return { kind: "guides-action", id: "hide", px, py };
  }
  if (py < L.headerEnd) return { kind: "guides-drag", id: "drag", px, py };
  for (const cat of L.cats) {
    if (px >= cat.x && px <= cat.x + cat.w && py >= cat.y && py <= cat.y + cat.h) {
      return { kind: "guides-action", id: `cat:${cat.id}`, px, py };
    }
  }
  if (px >= L.prev.x && px <= L.prev.x + L.prev.w && py >= L.prev.y && py <= L.prev.y + L.prev.h) {
    return { kind: "guides-action", id: "prev", px, py };
  }
  if (px >= L.next.x && px <= L.next.x + L.next.w && py >= L.next.y && py <= L.next.y + L.next.h) {
    return { kind: "guides-action", id: "next", px, py };
  }
  if (px >= L.clip.x && px <= L.clip.x + L.clip.w && py >= L.clip.y && py <= L.clip.y + L.clip.h) {
    return { kind: "guides-clip", id: "clip", px, py };
  }
  return { kind: "guides-chrome", id: "chrome", px, py };
}

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function paintSimClip(ctx, clip, t, box) {
  const { x, y, w, h } = box;
  ctx.save();
  ctx.beginPath();
  rr(ctx, x, y, w, h, 18);
  ctx.clip();
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(x, y, w, h);

  const cx = x + w * 0.42;
  const cy = y + h * 0.55;
  const id = clip?.id || "";
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);

  ctx.strokeStyle = "rgba(125,211,252,0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.moveTo(x + 16, y + 28 + i * 42);
    ctx.lineTo(x + w - 16, y + 28 + i * 42);
    ctx.stroke();
  }

  const rayX = x + w * 0.18;
  const rayY = y + h * 0.78;
  const tipX = cx + Math.sin(t * 1.4) * 36;
  const tipY = cy - 10 + Math.cos(t * 1.1) * 18;

  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(rayX, rayY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.fillStyle = "#e0f2fe";
  ctx.beginPath();
  ctx.arc(tipX, tipY, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#64748b";
  ctx.beginPath();
  ctx.roundRect?.(rayX - 18, rayY - 10, 36, 56, 10);
  if (!ctx.roundRect) {
    rr(ctx, rayX - 18, rayY - 10, 36, 56, 10);
  }
  ctx.fill();
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 11px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ray", rayX, rayY + 62);

  if (id === "grab" || id === "scale") {
    ctx.fillStyle = `rgba(14,165,233,${0.35 + pulse * 0.35})`;
    ctx.fillRect(cx - 40, cy - 28, 80, 56);
    ctx.strokeStyle = "#7dd3fc";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 40, cy - 28, 80, 56);
  } else if (id === "stroke" || id === "color") {
    ctx.strokeStyle = id === "color" ? "#e85d4c" : "#06b6d4";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cx - 70, cy + 20);
    for (let i = 0; i <= 12; i += 1) {
      const u = i / 12;
      ctx.lineTo(cx - 70 + u * 150, cy + 20 - Math.sin((u + t * 0.4) * Math.PI * 2) * 22);
    }
    ctx.stroke();
  } else if (id === "table" || id === "walk") {
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 24, 110, 36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(cx + Math.sin(t) * 50, cy + 10, 10, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === "shot" || id === "rec") {
    ctx.strokeStyle = id === "rec" ? "#ef4444" : "#38bdf8";
    ctx.lineWidth = 4;
    ctx.strokeRect(cx - 70, cy - 44, 140, 88);
    ctx.fillStyle = id === "rec" ? `rgba(239,68,68,${0.2 + pulse * 0.4})` : `rgba(255,255,255,${0.15 + pulse * 0.5})`;
    ctx.fillRect(cx - 70, cy - 44, 140, 88);
  } else if (id === "room" || id === "mic") {
    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.arc(cx - 36, cy, 16, 0, Math.PI * 2);
    ctx.arc(cx + 36, cy, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "700 14px Arial,sans-serif";
    ctx.fillText(id === "mic" ? "Mic" : "Room", cx, cy + 40);
  } else if (id === "arc") {
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(rayX, rayY);
    ctx.quadraticCurveTo(cx, y + 36, cx + 90, cy + 40);
    ctx.stroke();
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(cx + 90, cy + 40, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(15,23,42,0.78)";
  rr(ctx, x + 16, y + 12, Math.min(420, w - 32), 36, 10);
  ctx.fill();
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 16px Arial,sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(clip?.title || "Guide", x + 28, y + 30);
  ctx.restore();
}

export function paintGuidesPanel(ctx, {
  categoryId = "move",
  clipIndex = 0,
  timeSec = 0,
} = {}) {
  const L = guidesLayout();
  const cat = guideCategoryById(categoryId);
  const idx = wrapGuideClipIndex(cat, clipIndex, 0);
  const clip = cat.clips[idx];

  ctx.clearRect(0, 0, L.w, L.h);
  ctx.fillStyle = "#0f172a";
  rr(ctx, 0, 0, L.w, L.h, 26);
  ctx.fill();
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, L.w, L.headerEnd);
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "bold 28px Arial,sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Guides", 24, L.headerEnd * 0.5);
  ctx.fillStyle = "#64748b";
  ctx.font = "600 14px Arial,sans-serif";
  ctx.fillText("Simulated clips · swipe", 140, L.headerEnd * 0.5);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "700 22px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("✕", L.hide.x + L.hide.w / 2, L.hide.y + L.hide.h / 2);

  for (const chip of L.cats) {
    const on = chip.id === cat.id;
    ctx.fillStyle = on ? "#0ea5e9" : "#1e293b";
    rr(ctx, chip.x, chip.y, chip.w, chip.h, 14);
    ctx.fill();
    ctx.fillStyle = on ? "#f0f9ff" : "#cbd5e1";
    ctx.font = "700 13px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(guideCategoryById(chip.id).label, chip.x + chip.w / 2, chip.y + chip.h / 2);
  }

  paintSimClip(ctx, clip, timeSec, L.clip);

  ctx.fillStyle = "rgba(15,23,42,0.55)";
  rr(ctx, L.prev.x, L.prev.y, L.prev.w, L.prev.h, 12);
  ctx.fill();
  rr(ctx, L.next.x, L.next.y, L.next.w, L.next.h, 12);
  ctx.fill();
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "700 28px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("‹", L.prev.x + L.prev.w / 2, L.prev.y + L.prev.h / 2);
  ctx.fillText("›", L.next.x + L.next.w / 2, L.next.y + L.next.h / 2);

  const n = cat.clips.length;
  const dotsW = n * 14;
  const dotsX = L.w / 2 - dotsW / 2;
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = i === idx ? "#38bdf8" : "#334155";
    ctx.beginPath();
    ctx.arc(dotsX + i * 14 + 5, L.h - 28, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 13px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(clip?.hint || "", L.w / 2, L.h - 48);
}
