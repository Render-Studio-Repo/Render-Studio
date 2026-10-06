/** Timeline-synced video markup for the public share viewer. */

export const SHARE_MARKUP_TOOLS = [
  { id: "select", label: "Select", title: "Select / pan video" },
  { id: "pen", label: "Marker", title: "Circle or mark with a marker" },
  { id: "circle", label: "Circle", title: "Circle something" },
  { id: "oval", label: "Oval", title: "Oval" },
  { id: "rect", label: "Box", title: "Rectangle" },
  { id: "line", label: "Line", title: "Line" },
  { id: "arrow", label: "Arrow", title: "Arrow" },
  { id: "view-mark", label: "View", title: "View tag" },
  { id: "face-mark", label: "Face", title: "Face of interest" },
  { id: "edge-mark", label: "Edge", title: "Edge of interest" },
  { id: "split-mark", label: "Split", title: "Split region" },
  { id: "note", label: "Note", title: "Add a note (popup)" },
];

export const SHARE_MARKUP_DRAW_TOOLS = new Set(
  SHARE_MARKUP_TOOLS.map((tool) => tool.id).filter((id) => id !== "select"),
);

const BOX_TOOLS = new Set(["circle", "oval", "rect", "view-mark", "face-mark", "split-mark"]);
const LINE_TOOLS = new Set(["line", "arrow", "edge-mark"]);

export function shareFullscreenBlocked({
  ua = "",
  platform = "",
  maxTouchPoints = 0,
  innerWidth = 0,
  matchMedia = null,
} = {}) {
  const userAgent = String(ua || "");
  const iOS = /iPhone|iPad|iPod/i.test(userAgent)
    || (String(platform || "") === "MacIntel" && Number(maxTouchPoints) > 1);
  const small = Number(innerWidth) > 0 && Number(innerWidth) <= 720;
  let coarse = false;
  try {
    coarse = !!matchMedia?.("(hover: none) and (pointer: coarse)")?.matches;
  } catch {
    coarse = false;
  }
  return !!(iOS || small || coarse);
}

export const MARKUP_DURATION_SEC = 3.2;
export const MARKUP_DRAW_SEC = 0.7;

export function markupDuration(mark) {
  const stored = Number(mark?.duration);
  if (Number.isFinite(stored) && stored > 0) return Math.max(0.4, Math.min(12, stored));
  return MARKUP_DURATION_SEC;
}

export function markupVisibleAtTime(mark, currentTime, slack = 0.08) {
  if (!mark) return false;
  const t = Math.max(0, Number(mark.t) || 0);
  const now = Number(currentTime);
  if (!Number.isFinite(now)) return false;
  const dur = markupDuration(mark);
  return now + slack >= t && now - slack <= t + dur;
}

export function markupDrawProgress(mark, currentTime) {
  if (!mark) return 0;
  const t = Math.max(0, Number(mark.t) || 0);
  const now = Number(currentTime);
  if (!Number.isFinite(now) || now < t) return 0;
  const draw = Math.max(0.2, Number(mark.draw_duration) || MARKUP_DRAW_SEC);
  return Math.max(0, Math.min(1, (now - t) / draw));
}

export function clientToNorm(clientX, clientY, rect) {
  const width = Math.max(1, Number(rect?.width) || 1);
  const height = Math.max(1, Number(rect?.height) || 1);
  const left = Number(rect?.left) || 0;
  const top = Number(rect?.top) || 0;
  return {
    x: Math.max(0, Math.min(1, (Number(clientX) - left) / width)),
    y: Math.max(0, Math.min(1, (Number(clientY) - top) / height)),
  };
}

export function boxFromDrag(start, end) {
  const a = start || { x: 0, y: 0 };
  const b = end || a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(0.012, Math.abs(b.x - a.x)),
    h: Math.max(0.012, Math.abs(b.y - a.y)),
  };
}

/** 1:1 circle in pixel space, stored as a normalized ellipse box. */
export function circleBoxFromDrag(start, end, videoWidth, videoHeight) {
  const vw = Math.max(1, Number(videoWidth) || 1);
  const vh = Math.max(1, Number(videoHeight) || 1);
  const a = start || { x: 0, y: 0 };
  const b = end || a;
  const dx = (b.x - a.x) * vw;
  const dy = (b.y - a.y) * vh;
  const r = Math.max(8, Math.hypot(dx, dy) / 2);
  const cx = (a.x * vw + b.x * vw) / 2;
  const cy = (a.y * vh + b.y * vh) / 2;
  return {
    x: (cx - r) / vw,
    y: (cy - r) / vh,
    w: (2 * r) / vw,
    h: (2 * r) / vh,
  };
}

export function colorForMarkupTool(tool) {
  const id = String(tool || "");
  if (id === "split-mark") return "#d29922";
  if (id === "face-mark") return "#bc8cff";
  if (id === "edge-mark") return "#3fb950";
  if (id === "view-mark") return "#58a6ff";
  if (id === "pen" || id === "circle") return "#f0883e";
  if (id === "note") return "#79c0ff";
  return "#f85149";
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function sanitizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points.slice(0, 400).map((p) => ({ x: clamp01(p?.x), y: clamp01(p?.y) }));
}

export function markupFromComment(row) {
  if (!row || typeof row !== "object") return null;
  const kind = String(row.kind || "comment").toLowerCase();
  const tool = String(row.tool || row.markup_tool || "").trim().toLowerCase();
  const geom = row.geometry && typeof row.geometry === "object" ? row.geometry : {};
  const isPin = kind === "pin" && row.x != null;
  const isMarkup = kind === "markup" || SHARE_MARKUP_DRAW_TOOLS.has(tool);
  if (!isMarkup && !isPin) return null;
  const resolvedTool = SHARE_MARKUP_DRAW_TOOLS.has(tool)
    ? tool
    : (isPin ? "note" : (geom.points ? "pen" : (row.x1 != null ? "line" : "circle")));
  const points = sanitizePoints(geom.points || row.points);
  const x = clamp01(geom.x ?? row.x);
  const y = clamp01(geom.y ?? row.y);
  const w = Math.max(0, Number(geom.w ?? row.w) || 0);
  const h = Math.max(0, Number(geom.h ?? row.h) || 0);
  return {
    id: String(row.id || ""),
    tool: resolvedTool,
    t: Math.max(0, Number(row.t ?? row.time) || 0),
    text: String(row.text || "").trim(),
    color: String(row.color || geom.color || colorForMarkupTool(resolvedTool)),
    x,
    y,
    w,
    h,
    x1: clamp01(geom.x1 ?? row.x1 ?? x),
    y1: clamp01(geom.y1 ?? row.y1 ?? y),
    x2: clamp01(geom.x2 ?? row.x2 ?? (w ? x + w : x)),
    y2: clamp01(geom.y2 ?? row.y2 ?? (h ? y + h : y)),
    points,
    author_id: String(row.author_id || row.user_id || ""),
    author_name: String(row.author_name || row.user_name || "Guest"),
    avatar_url: String(row.avatar_url || row.user_avatar_url || "").trim(),
    duration: markupDuration(row),
  };
}

export function commentPayloadFromMarkup(mark) {
  const tool = String(mark?.tool || "pen");
  const text = String(mark?.text || "").trim() || toolLabel(tool);
  const payload = {
    kind: "markup",
    tool,
    text,
    t: Math.max(0, Number(mark?.t) || 0),
    duration: markupDuration(mark),
    color: String(mark?.color || colorForMarkupTool(tool)),
    geometry: {},
  };
  if (tool === "pen" && Array.isArray(mark?.points)) {
    payload.geometry.points = sanitizePoints(mark.points);
    const last = payload.geometry.points[payload.geometry.points.length - 1];
    if (last) {
      payload.x = last.x;
      payload.y = last.y;
    }
  } else if (LINE_TOOLS.has(tool)) {
    payload.geometry = {
      x1: clamp01(mark.x1),
      y1: clamp01(mark.y1),
      x2: clamp01(mark.x2),
      y2: clamp01(mark.y2),
    };
    payload.x = payload.geometry.x1;
    payload.y = payload.geometry.y1;
  } else if (tool === "note") {
    payload.x = clamp01(mark.x);
    payload.y = clamp01(mark.y);
    payload.geometry = { x: payload.x, y: payload.y };
  } else {
    payload.geometry = {
      x: clamp01(mark.x),
      y: clamp01(mark.y),
      w: Math.max(0.012, Number(mark.w) || 0.012),
      h: Math.max(0.012, Number(mark.h) || 0.012),
    };
    payload.x = payload.geometry.x;
    payload.y = payload.geometry.y;
  }
  return payload;
}

export function toolLabel(tool) {
  return SHARE_MARKUP_TOOLS.find((item) => item.id === tool)?.label || "Markup";
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function dashFor(tool) {
  if (tool === "view-mark" || tool === "face-mark" || tool === "split-mark") return "7 5";
  return "";
}

function drawStrokeAttr(progress, tool) {
  const p = Math.max(0, Math.min(1, Number(progress)));
  const dash = dashFor(tool);
  if (dash) return ` stroke-dasharray="${dash}"`;
  if (p >= 0.999) return "";
  return ` pathLength="1" stroke-dasharray="1" stroke-dashoffset="${(1 - p).toFixed(4)}"`;
}

export function markupToSvg(mark, { progress = 1 } = {}) {
  if (!mark) return "";
  const tool = mark.tool;
  const color = esc(mark.color || colorForMarkupTool(tool));
  const draw = drawStrokeAttr(progress, tool);
  const common = `fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"${draw}`;
  if (tool === "pen" && mark.points?.length) {
    const d = mark.points.map((p, i) => `${i ? "L" : "M"}${Number(p.x).toFixed(4)} ${Number(p.y).toFixed(4)}`).join(" ");
    return `<path d="${d}" ${common} stroke-width="3.2" />`;
  }
  if (LINE_TOOLS.has(tool)) {
    const x1 = Number(mark.x1).toFixed(4);
    const y1 = Number(mark.y1).toFixed(4);
    const x2 = Number(mark.x2).toFixed(4);
    const y2 = Number(mark.y2).toFixed(4);
    let extra = "";
    if (tool === "arrow" || tool === "edge-mark") {
      const angle = Math.atan2(mark.y2 - mark.y1, mark.x2 - mark.x1);
      const hx = mark.x2 - 0.04 * Math.cos(angle - Math.PI / 6);
      const hy = mark.y2 - 0.04 * Math.sin(angle - Math.PI / 6);
      const hx2 = mark.x2 - 0.04 * Math.cos(angle + Math.PI / 6);
      const hy2 = mark.y2 - 0.04 * Math.sin(angle + Math.PI / 6);
      extra = `<path d="M${x2} ${y2} L${hx.toFixed(4)} ${hy.toFixed(4)} M${x2} ${y2} L${hx2.toFixed(4)} ${hy2.toFixed(4)}" ${common} />`;
    }
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${common} />${extra}`;
  }
  if (tool === "note") return "";
  const box = boxFromDrag(
    { x: mark.x, y: mark.y },
    { x: mark.x + (mark.w || 0), y: mark.y + (mark.h || 0) },
  );
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (tool === "circle" || tool === "oval") {
    return `<ellipse cx="${cx.toFixed(4)}" cy="${cy.toFixed(4)}" rx="${(box.w / 2).toFixed(4)}" ry="${(box.h / 2).toFixed(4)}" ${common} />`;
  }
  const label = tool === "view-mark" || tool === "face-mark" || tool === "split-mark"
    ? `<text x="${(box.x + 0.01).toFixed(4)}" y="${Math.max(0.04, box.y - 0.01).toFixed(4)}" fill="${color}" font-size="0.045" font-weight="700">${esc(toolLabel(tool))}</text>`
    : "";
  return `<rect x="${box.x.toFixed(4)}" y="${box.y.toFixed(4)}" width="${box.w.toFixed(4)}" height="${box.h.toFixed(4)}" rx="0.012" ${common} />${label}`;
}

export function markupAnchor(mark) {
  if (!mark) return { x: 0.5, y: 0.12 };
  if (mark.tool === "pen" && mark.points?.length) {
    const last = mark.points[mark.points.length - 1];
    return { x: clamp01(last.x), y: clamp01(last.y) };
  }
  if (LINE_TOOLS.has(mark.tool)) {
    return { x: clamp01(mark.x2 ?? mark.x), y: clamp01(mark.y2 ?? mark.y) };
  }
  if (mark.tool === "note") return { x: clamp01(mark.x), y: clamp01(mark.y) };
  return { x: clamp01(mark.x + (Number(mark.w) || 0)), y: clamp01(mark.y) };
}

export function markupSvgInner(marks, currentTime, { draft = null } = {}) {
  const visible = (Array.isArray(marks) ? marks : []).filter((mark) => markupVisibleAtTime(mark, currentTime));
  const drawn = visible.map((mark) => markupToSvg(mark, { progress: markupDrawProgress(mark, currentTime) }));
  if (draft) drawn.push(markupToSvg(draft, { progress: 1 }));
  return drawn.join("");
}

export function markupNotesHtml(marks, currentTime) {
  return (Array.isArray(marks) ? marks : [])
    .filter((mark) => mark?.tool === "note" && markupVisibleAtTime(mark, currentTime))
    .map((mark) => {
      const text = esc(mark.text || "Note");
      return `<button type="button" class="share-video-note" style="left:${(clamp01(mark.x) * 100).toFixed(2)}%;top:${(clamp01(mark.y) * 100).toFixed(2)}%" data-markup-id="${esc(mark.id)}" data-share-seek="${Number(mark.t) || 0}" title="${text}">${text}</button>`;
    })
    .join("");
}

export function markupLogosHtml(marks, currentTime) {
  return (Array.isArray(marks) ? marks : [])
    .filter((mark) => markupVisibleAtTime(mark, currentTime))
    .map((mark) => {
      const at = markupAnchor(mark);
      const name = esc(mark.author_name || "Guest");
      const url = String(mark.avatar_url || "").trim();
      const initial = esc((mark.author_name || "?").charAt(0).toUpperCase() || "?");
      const face = url
        ? `<span class="share-video-mark-logo-face" style="background-image:url('${esc(url)}')"></span>`
        : `<span class="share-video-mark-logo-face share-video-mark-logo-face--initial">${initial}</span>`;
      return `<div class="share-video-mark-logo" style="left:${(at.x * 100).toFixed(2)}%;top:${(at.y * 100).toFixed(2)}%" data-markup-id="${esc(mark.id)}" data-share-seek="${Number(mark.t) || 0}" title="${name}">${face}</div>`;
    })
    .join("");
}

function draftFromGesture(tool, start, end, points, size) {
  if (tool === "pen") {
    return { tool, points: sanitizePoints(points), color: colorForMarkupTool(tool), t: 0 };
  }
  if (LINE_TOOLS.has(tool)) {
    return {
      tool,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      color: colorForMarkupTool(tool),
      t: 0,
    };
  }
  if (tool === "circle") {
    const box = circleBoxFromDrag(start, end, size.width, size.height);
    return { tool, ...box, color: colorForMarkupTool(tool), t: 0 };
  }
  if (BOX_TOOLS.has(tool)) {
    return { tool, ...boxFromDrag(start, end), color: colorForMarkupTool(tool), t: 0 };
  }
  return null;
}

export function preferMarkupRecorderMime(format = "mp4") {
  const fmt = String(format || "mp4").toLowerCase();
  const types = fmt === "webm"
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : [
      "video/mp4;codecs=avc1.640028,mp4a.40.2",
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
    ];
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export async function recordShareMarkupVideo({
  video,
  marks = [],
  withAudio = true,
  format = "mp4",
  onProgress,
} = {}) {
  const src = video?.currentSrc || video?.src || "";
  if (!src) throw new Error("No video to record.");
  const mime = preferMarkupRecorderMime(format);
  if (!mime || !mime.startsWith("video/mp4")) {
    throw new Error("Browser cannot record H.264 MP4.");
  }
  const hidden = document.createElement("video");
  hidden.src = src;
  hidden.crossOrigin = "anonymous";
  hidden.playsInline = true;
  hidden.muted = true;
  hidden.preload = "auto";
  await new Promise((resolve, reject) => {
    hidden.onloadedmetadata = () => resolve();
    hidden.onerror = () => reject(new Error("Could not load video for markup download."));
  });
  const width = Math.max(2, hidden.videoWidth || video.videoWidth || 1280);
  const height = Math.max(2, hidden.videoHeight || video.videoHeight || 720);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("viewBox", "0 0 1 1");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const stream = canvas.captureStream(30);
  if (withAudio && hidden.captureStream) {
    try {
      hidden.muted = false;
      const audioTracks = hidden.captureStream().getAudioTracks();
      audioTracks.forEach((track) => stream.addTrack(track));
    } catch { /* optional audio */ }
  }
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("Markup recording failed."));
  });
  hidden.currentTime = 0;
  await hidden.play();
  recorder.start(250);
  let markupFrameUrl = ""; // leakfix34
  const dropMarkupFrameUrl = (href) => {
    if (!href) return;
    try { URL.revokeObjectURL(href); } catch { /* ignore */ }
    if (markupFrameUrl === href) markupFrameUrl = "";
  };
  const drawFrame = () => {
    ctx.drawImage(hidden, 0, 0, width, height);
    svg.innerHTML = markupSvgInner(marks, hidden.currentTime);
    const blob = new Blob([`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="${width}" height="${height}">${svg.innerHTML}</svg>`], { type: "image/svg+xml" });
    if (markupFrameUrl) dropMarkupFrameUrl(markupFrameUrl); // leakfix34
    const url = URL.createObjectURL(blob);
    markupFrameUrl = url;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      dropMarkupFrameUrl(url);
    };
    img.onerror = () => dropMarkupFrameUrl(url);
    img.src = url;
    onProgress?.(hidden.currentTime, hidden.duration);
    if (!hidden.paused && !hidden.ended) requestAnimationFrame(drawFrame);
  };
  requestAnimationFrame(drawFrame);
  await new Promise((resolve) => {
    hidden.onended = resolve;
  });
  if (recorder.state !== "inactive") recorder.stop();
  await stopped;
  hidden.pause();
  dropMarkupFrameUrl(markupFrameUrl); // leakfix34
  const blob = new Blob(chunks, { type: mime.split(";")[0] || "video/mp4" });
  if (!blob.size) throw new Error("Markup recording produced an empty file.");
  return blob;
}

export function createShareVideoMarkup({
  stage,
  video,
  overlay,
  svg,
  notesLayer,
  logosLayer,
  toolsRoot,
  noteDialog,
  noteInput,
  getComments,
  postComment,
  getAuthor,
  onPaint,
} = {}) {
  let tool = "select";
  let drawing = false;
  let start = null;
  let points = [];
  let captureTime = 0;
  let pendingNote = null;
  let draft = null;
  let localMarks = [];
  let raf = 0;
  let selectedId = "";

  function size() {
    const rect = (overlay || stage || video)?.getBoundingClientRect?.() || { width: 1, height: 1 };
    return { width: Math.max(1, rect.width), height: Math.max(1, rect.height), rect };
  }

  function marks() {
    return [...(getComments?.() || []).map(markupFromComment).filter(Boolean), ...localMarks];
  }

  function paint() {
    const t = Number(video?.currentTime) || 0;
    if (svg) svg.innerHTML = markupSvgInner(marks(), t, { draft });
    if (notesLayer) notesLayer.innerHTML = markupNotesHtml(marks(), t);
    if (logosLayer) logosLayer.innerHTML = markupLogosHtml(marks(), t);
    overlay?.querySelectorAll("[data-markup-id]")?.forEach((el) => {
      el.classList.toggle("is-selected", el.getAttribute("data-markup-id") === selectedId);
    });
    overlay?.classList.toggle("is-drawing", SHARE_MARKUP_DRAW_TOOLS.has(tool));
    overlay?.setAttribute("aria-hidden", SHARE_MARKUP_DRAW_TOOLS.has(tool) ? "false" : "true");
    toolsRoot?.querySelectorAll("[data-share-markup]")?.forEach((btn) => {
      const on = btn.getAttribute("data-share-markup") === tool;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    onPaint?.();
  }

  function setTool(next, { toggle = false } = {}) {
    const id = String(next || "select");
    const resolved = SHARE_MARKUP_TOOLS.some((item) => item.id === id) ? id : "select";
    if (toggle && resolved !== "select" && resolved === tool) tool = "select";
    else tool = resolved;
    if (tool !== "note") closeNote(false);
    paint();
  }

  function disableTool() {
    closeNote(false);
    if (drawing) {
      drawing = false;
      draft = null;
    }
    setTool("select");
  }

  function selectMark(id) {
    selectedId = String(id || "");
    paint();
    return selectedId;
  }

  function placeComment(at, t) {
    setTool("note");
    openNote(at || { x: 0.5, y: 0.5 }, Math.max(0, Number(t) || 0));
  }

  function closeNote(save) {
    const dialog = noteDialog;
    if (!dialog) {
      pendingNote = null;
      return;
    }
    if (save && pendingNote) {
      const text = String(noteInput?.value || "").trim();
      if (text) {
        const mark = { ...pendingNote, text };
        commitMark(mark);
      }
    }
    pendingNote = null;
    if (noteInput) noteInput.value = "";
    dialog.classList.add("hidden");
  }

  function openNote(at, t) {
    pendingNote = {
      tool: "note",
      x: at.x,
      y: at.y,
      t,
      color: colorForMarkupTool("note"),
    };
    if (noteInput) noteInput.value = "";
    noteDialog?.classList.remove("hidden");
    noteInput?.focus?.();
  }

  function commitMark(next) {
    if (!next) return;
    const author = getAuthor?.() || {};
    const optimistic = {
      ...next,
      id: next.id || `local-${Date.now()}`,
      duration: markupDuration(next),
      author_id: String(author.id || next.author_id || ""),
      author_name: String(author.display_name || next.author_name || "Guest"),
      avatar_url: String(author.avatar_url || next.avatar_url || ""),
    };
    localMarks = [...localMarks, optimistic];
    paint();
    const payload = commentPayloadFromMarkup(optimistic);
    void Promise.resolve(postComment?.(payload)).then(() => {
      localMarks = localMarks.filter((item) => item.id !== optimistic.id);
      paint();
    }).catch(() => {});
  }

  function pointerPos(event) {
    return clientToNorm(event.clientX, event.clientY, size().rect);
  }

  function onPointerDown(event) {
    if (!SHARE_MARKUP_DRAW_TOOLS.has(tool)) return;
    event.preventDefault();
    overlay?.setPointerCapture?.(event.pointerId);
    drawing = true;
    start = pointerPos(event);
    points = [start];
    captureTime = Number(video?.currentTime) || 0;
    try { video?.pause?.(); } catch { /* optional */ }
    if (tool === "note") {
      drawing = false;
      openNote(start, captureTime);
      return;
    }
    draft = draftFromGesture(tool, start, start, points, size());
    if (draft) draft.t = captureTime;
    paint();
  }

  function onPointerMove(event) {
    if (!drawing || !start) return;
    const now = pointerPos(event);
    points.push(now);
    draft = draftFromGesture(tool, start, now, points, size());
    if (draft) draft.t = captureTime;
    paint();
  }

  function onPointerUp(event) {
    if (!drawing) return;
    drawing = false;
    const end = pointerPos(event);
    const next = draftFromGesture(tool, start, end, points, size());
    start = null;
    points = [];
    draft = null;
    if (!next) {
      paint();
      return;
    }
    next.t = captureTime;
    if (next.tool === "pen" && (next.points?.length || 0) < 2) {
      paint();
      return;
    }
    commitMark(next);
    paint();
  }

  overlay?.addEventListener("pointerdown", onPointerDown);
  overlay?.addEventListener("pointermove", onPointerMove);
  overlay?.addEventListener("pointerup", onPointerUp);
  overlay?.addEventListener("pointercancel", () => {
    drawing = false;
    draft = null;
    paint();
  });
  toolsRoot?.addEventListener("click", (event) => {
    const btn = event.target.closest?.("[data-share-markup]");
    if (!btn) return;
    setTool(btn.getAttribute("data-share-markup"), { toggle: true });
  });
  const onKeydown = (event) => {
    if (event.key !== "Escape") return;
    if (tool === "select" && !pendingNote && !drawing) return;
    event.preventDefault();
    disableTool();
  };
  if (typeof document !== "undefined") document.addEventListener("keydown", onKeydown);
  noteDialog?.querySelector("[data-markup-note-save]")?.addEventListener("click", () => closeNote(true));
  noteDialog?.querySelector("[data-markup-note-cancel]")?.addEventListener("click", () => closeNote(false));
  noteDialog?.addEventListener("click", (event) => {
    if (event.target === noteDialog) closeNote(false);
  });
  function stopRaf() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function tick() {
    paint();
    if (video && !video.paused && !video.ended) raf = requestAnimationFrame(tick);
    else raf = 0;
  }
  video?.addEventListener("timeupdate", paint);
  video?.addEventListener("seeked", paint);
  video?.addEventListener("loadedmetadata", paint);
  video?.addEventListener("play", () => {
    stopRaf();
    raf = requestAnimationFrame(tick);
  });
  video?.addEventListener("pause", stopRaf);
  video?.addEventListener("ended", stopRaf);

  setTool("select");
  return {
    setTool,
    disableTool,
    paint,
    getTool: () => tool,
    closeNote,
    placeComment,
    selectMark,
    getSelected: () => selectedId,
  };
}
