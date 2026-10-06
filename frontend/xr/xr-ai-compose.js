/** XR AI compose helpers — sketches + voice stay together until Run. */

export const XR_COMPOSE_MAX_SKETCHES = 4;

export function isVoiceDrawImage(img) {
  if (!img) return false;
  if (img.kind === "voice-draw") return true;
  return /^voice-draw/i.test(String(img.name || img.id || ""));
}

export function nextVoiceDrawImageName(images = []) {
  const used = new Set((images || []).map((img) => String(img?.name || "")));
  let n = 1;
  let name = `voice-draw-${n}.png`;
  while (used.has(name) && n < 32) {
    n += 1;
    name = `voice-draw-${n}.png`;
  }
  return name;
}

export function composeImagesForPanel(images = []) {
  return (images || [])
    .filter(isVoiceDrawImage)
    .slice(0, XR_COMPOSE_MAX_SKETCHES)
    .map((img, i) => ({
      id: String(img.id || `voice-draw-${i + 1}`),
      name: String(img.name || `Sketch ${i + 1}`),
      data_url: String(img.data_url || img.preview_url || ""),
      promptAugment: String(img.promptAugment || ""),
    }));
}

export function seedXrComposePrompt({ hasDrawings = false, spoken = "" } = {}) {
  const said = String(spoken || "").trim();
  if (said) return said;
  if (hasDrawings) return "Build a 3D model from my attached sketches.";
  return "";
}

export function mergeComposeAugment(current, clips = []) {
  const text = String(current || "").trim();
  const extras = (clips || [])
    .map((clip, i) => {
      const body = String(clip?.promptAugment || "").trim();
      if (!body) return "";
      if (text.includes(body)) return "";
      const label = `Voice-draw sketch ${i + 1}`;
      if (body.startsWith("Voice-draw")) return body.replace(/^Voice-draw 3D spatial reference:/, `${label}:`);
      return `${label}:\n${body}`;
    })
    .filter(Boolean);
  if (!extras.length) return text;
  return text ? `${text}\n\n${extras.join("\n\n")}` : extras.join("\n\n");
}

export function runRowHit(px, py, { width, runY, runH } = {}) {
  const w = Number(width) || 1080;
  const y = Number(runY) || 0;
  const h = Number(runH) || 80;
  if (py < y || py > y + h || px < 40 || px > w - 40) return null;
  const inner = w - 80;
  const gap = 12;
  const bw = (inner - gap * 2) / 3;
  if (px <= 40 + bw) return "draw";
  if (px <= 40 + bw * 2 + gap) return "talk";
  return "run";
}

export function thumbRowHit(px, py, { width, y, h, n = 4 } = {}) {
  const w = Number(width) || 1080;
  const count = Math.max(1, Number(n) || 4);
  if (py < y || py > y + h || px < 40 || px > w - 40) return null;
  const gap = 12;
  const bw = (w - 80 - gap * (count - 1)) / count;
  for (let i = 0; i < count; i += 1) {
    const x0 = 40 + i * (bw + gap);
    if (px >= x0 && px <= x0 + bw) return i;
  }
  return null;
}

/** World-space model list (WebXR cannot use native &lt;select&gt;). */
export const XR_MODEL_PICKER = {
  rowH: 52,
  maxVisible: 8,
  pad: 40,
};

export function shortModelLabel(opt) {
  return String(opt?.label || opt?.value || "").replace(/ · .*/, "");
}

export function modelPickerLayout({
  width = 1080,
  height = 1280,
  modelY = 494,
  rowH = 56,
  options = [],
  scroll = 0,
} = {}) {
  const opts = (Array.isArray(options) ? options : []).filter((o) => o && (o.value || o.id));
  const overlayY = Number(modelY) + Number(rowH || 56) + 8;
  const overlayH = Math.max(88, Number(height) - overlayY - 24);
  const n = opts.length;
  const needNav = n > XR_MODEL_PICKER.maxVisible;
  const navH = needNav ? 44 : 0;
  const headerH = 28;
  const maxVisible = Math.max(
    1,
    Math.min(XR_MODEL_PICKER.maxVisible, Math.floor((overlayH - navH - headerH - 8) / XR_MODEL_PICKER.rowH)),
  );
  const start = Math.max(0, Math.min(Number(scroll) || 0, Math.max(0, n - maxVisible)));
  const visible = Math.min(n, maxVisible);
  const rows = [];
  const listTop = overlayY + 28;
  for (let i = 0; i < visible; i += 1) {
    const opt = opts[start + i];
    if (!opt) break;
    rows.push({
      value: String(opt.value || opt.id),
      label: shortModelLabel(opt),
      x: XR_MODEL_PICKER.pad,
      y: listTop + i * XR_MODEL_PICKER.rowH,
      w: width - XR_MODEL_PICKER.pad * 2,
      h: XR_MODEL_PICKER.rowH - 6,
    });
  }
  const navY = overlayY + overlayH - 48;
  const half = (width - 80 - 12) / 2;
  const canUp = start > 0;
  const canDown = start + visible < n;
  return {
    overlayX: 24,
    overlayY,
    overlayW: width - 48,
    overlayH,
    start,
    visible,
    total: n,
    rows,
    canUp,
    canDown,
    up: canUp ? { id: "model_up", x: XR_MODEL_PICKER.pad, y: navY, w: half, h: 40 } : null,
    down: canDown ? { id: "model_down", x: XR_MODEL_PICKER.pad + half + 12, y: navY, w: half, h: 40 } : null,
  };
}

export function modelPickerHit(px, py, layout) {
  if (!layout) return null;
  const inRect = (r) => r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  if (inRect(layout.up)) return { kind: "ai-action", id: "model_up" };
  if (inRect(layout.down)) return { kind: "ai-action", id: "model_down" };
  for (const row of layout.rows || []) {
    if (inRect(row)) return { kind: "ai-action", id: `model:${row.value}` };
  }
  if (
    px >= layout.overlayX
    && px <= layout.overlayX + layout.overlayW
    && py >= layout.overlayY
    && py <= layout.overlayY + layout.overlayH
  ) {
    return { kind: "ai-action", id: "model_chrome" };
  }
  return null;
}

export function aiHitBlockedByModelPicker(id, open) {
  if (!open) return false;
  const s = String(id || "");
  if (
    s === "hide"
    || s === "send_pc"
    || s === "drag"
    || s === "model"
    || s === "mic"
    || s === "model_chrome"
    || s === "model_up"
    || s === "model_down"
    || s.startsWith("model:")
  ) {
    return false;
  }
  return true;
}

/** Prompt draft box on the AI window — tap to open the in-headset keyboard. */
export function promptFieldHit(px, py, box = {}) {
  const x = Number(box.x) || 0;
  const y = Number(box.y) || 0;
  const w = Number(box.w) || 0;
  const h = Number(box.h) || 0;
  if (px < x || px > x + w || py < y || py > y + h) return null;
  return { kind: "ai-action", id: "type" };
}

/** Generate progress strip — tap to open the loading-screen / McMaster panel. */
export function progressHit(px, py, box = {}) {
  const x = Number(box.x ?? 40) || 40;
  const y = Number(box.y) || 0;
  const w = Number(box.w) || 0;
  const h = Number(box.h) || 0;
  if (px < x || px > x + w || py < y || py > y + h) return null;
  return { kind: "ai-action", id: "progress" };
}

export const XR_KB_SHIFT_MAP = {
  "1": "!", "2": "@", "3": "#", "4": "$", "5": "%",
  "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
  "-": "_", "=": "+", ",": "<", ".": ">", "'": "\"", "/": "?",
};

export const XR_KB_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "back"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["shift", "z", "x", "c", "v", "b", "n", "m", ",", ".", "'"],
  ["space", "enter", "done"],
];

export function keyboardLayout({ width = 1080, height = 420, shift = false } = {}) {
  const pad = 16;
  const gap = 8;
  const rows = XR_KB_ROWS;
  const rowH = (height - pad * 2 - gap * (rows.length - 1)) / rows.length;
  const keys = [];
  rows.forEach((row, ri) => {
    const y = pad + ri * (rowH + gap);
    const weights = row.map((id) => {
      if (id === "space") return 4;
      if (id === "enter" || id === "done" || id === "back" || id === "shift") return 1.6;
      return 1;
    });
    const totalW = weights.reduce((a, b) => a + b, 0);
    const inner = width - pad * 2 - gap * (row.length - 1);
    let x = pad;
    row.forEach((id, i) => {
      const w = (weights[i] / totalW) * inner;
      let label = id;
      if (id === "back") label = "⌫";
      else if (id === "shift") label = shift ? "⇧" : "shift";
      else if (id === "space") label = "space";
      else if (id === "enter") label = "↵";
      else if (id === "done") label = "Done";
      else label = shift ? (XR_KB_SHIFT_MAP[id] || String(id).toUpperCase()) : id;
      keys.push({
        id: `kb:${id}`,
        key: id,
        label,
        x,
        y,
        w,
        h: rowH,
      });
      x += w + gap;
    });
  });
  return { width, height, shift: !!shift, keys };
}

export function keyboardHit(px, py, layout) {
  if (!layout?.keys) return null;
  for (const key of layout.keys) {
    if (px >= key.x && px <= key.x + key.w && py >= key.y && py <= key.y + key.h) {
      return { kind: "ai-action", id: key.id, key: key.key };
    }
  }
  return { kind: "ai-action", id: "kb_chrome" };
}

export function applyKeyboardKey(draft, keyId, { shift = false } = {}) {
  const text = String(draft || "");
  const id = String(keyId || "").replace(/^kb:/, "");
  if (!id || id === "kb_chrome") return { draft: text, shift: !!shift, action: null };
  if (id === "back") return { draft: text.slice(0, -1), shift: !!shift, action: null };
  if (id === "space") return { draft: `${text} `, shift: !!shift, action: null };
  if (id === "enter") return { draft: `${text}\n`, shift: !!shift, action: null };
  if (id === "done") return { draft: text, shift: false, action: "done" };
  if (id === "shift") return { draft: text, shift: !shift, action: null };
  const ch = shift ? (XR_KB_SHIFT_MAP[id] || String(id).toUpperCase()) : id;
  return { draft: text + ch, shift: !!shift, action: null };
}

export function mcmasterThumbUrl(row = {}, { projectId = "" } = {}) {
  const direct = String(
    row.thumb_url || row.thumbnail_url || row.image_url || row.preview_url || row.image || "",
  ).trim();
  if (direct) return direct;
  const file = String(row.preview_filename || row.filename || "").trim();
  if (projectId && file && /\.(png|jpe?g|webp|gif)$/i.test(file)) {
    return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(file)}`;
  }
  return "";
}

export function loadingScreenLayout({
  width = 1080,
  height = 1400,
  scroll = 0,
  parts = [],
} = {}) {
  const headerEnd = 88;
  const progressY = 108;
  const progressH = 52;
  const listY = 180;
  const rowH = 92;
  const visible = Math.max(1, Math.floor((height - listY - 80) / rowH));
  const n = Array.isArray(parts) ? parts.length : 0;
  const start = Math.max(0, Math.min(Number(scroll) || 0, Math.max(0, n - visible)));
  return {
    width,
    height,
    headerEnd,
    progressY,
    progressH,
    listY,
    rowH,
    visible,
    start,
    close: { x: width - 140, y: 16, w: 120, h: 56 },
    up: { x: 40, y: height - 68, w: 200, h: 48 },
    down: { x: 256, y: height - 68, w: 200, h: 48 },
  };
}

export function loadingScreenHit(px, py, layout) {
  if (!layout) return null;
  const inRect = (r) => r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  if (inRect(layout.close)) return { kind: "ai-action", id: "load_close" };
  if (py < layout.headerEnd) return { kind: "ai-action", id: "load_drag" };
  if (inRect(layout.up)) return { kind: "ai-action", id: "load_up" };
  if (inRect(layout.down)) return { kind: "ai-action", id: "load_down" };
  return { kind: "ai-action", id: "load_chrome" };
}
