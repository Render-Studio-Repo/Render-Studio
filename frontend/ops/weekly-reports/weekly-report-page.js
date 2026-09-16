const MARKUP_COLORS = ["#f0883e", "#58a6ff", "#3fb950", "#ff7b72", "#e6edf3", "#000000"];
const MAX_RECENT = 8;
const CYCLE_ID = "CYCLE-20260916-PM1";
const DEFAULT_CONTEXT = {
  project_id: "render-studio",
  path_id: "/ops/weekly-reports/CYCLE-20260916-PM1.html",
  log_id: "CYCLE-20260916-PM1",
  tracking_id: "INTRO-20260916",
  ref_id: "INTRO-20260916",
};

let authHeaders = (headers = {}) => ({ ...headers });
let getStoredUser = () => null;

try {
  const auth = await import("/auth.js?v=20260731-auth-restore");
  if (typeof auth.authHeaders === "function") authHeaders = auth.authHeaders;
  if (typeof auth.getStoredUser === "function") getStoredUser = auth.getStoredUser;
} catch (err) {
  console.warn("[weekly-report] auth helpers unavailable; feedback submit will require an existing session.", err);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function basename(value = "") {
  return String(value || "").split("/").pop() || "";
}

async function copyText(text) {
  const value = String(text ?? "");
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

async function api(path, options = {}, timeoutMs = 240000) {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, {
    ...options,
    signal: ctrl.signal,
    headers: authHeaders(headers),
  }).finally(() => window.clearTimeout(timer));
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const err = new Error(data?.detail || data?.message || res.statusText || "Request failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

function strokeSvg(strokes = []) {
  return (strokes || [])
    .map((stroke) => {
      const type = String(stroke.type || "pen").toLowerCase();
      const color = escapeHtml(stroke.color || MARKUP_COLORS[0]);
      const width = Number(stroke.width) || 3;
      if (type === "text") {
        const x = Number(stroke.x ?? stroke.points?.[0]?.[0] ?? 0);
        const y = Number(stroke.y ?? stroke.points?.[0]?.[1] ?? 0);
        const size = Number(stroke.fontSize) || Math.max(14, width * 5);
        const text = escapeHtml(stroke.text || "");
        if (!text) return "";
        return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-family="Inter, system-ui, sans-serif" font-weight="700">${text}</text>`;
      }
      const pts = (stroke.points || []).map((p) => `${Number(p[0])},${Number(p[1])}`).join(" ");
      if (!pts) return "";
      if (type === "rect" && (stroke.points || []).length >= 2) {
        const [[x0, y0], [x1, y1]] = stroke.points;
        const x = Math.min(x0, x1);
        const y = Math.min(y0, y1);
        const w = Math.abs(x1 - x0);
        const h = Math.abs(y1 - y0);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke" rx="8" ry="8" />`;
      }
      if (type === "arrow" && (stroke.points || []).length >= 2) {
        const ptsArr = stroke.points;
        const [x0, y0] = ptsArr[0];
        const [x1, y1] = ptsArr[ptsArr.length - 1];
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const head = Math.max(10, width * 4);
        const ax = x1 - Math.cos(ang) * head;
        const ay = y1 - Math.sin(ang) * head;
        const lx = ax + Math.cos(ang + Math.PI / 2) * head * 0.45;
        const ly = ay + Math.sin(ang + Math.PI / 2) * head * 0.45;
        const rx = ax + Math.cos(ang - Math.PI / 2) * head * 0.45;
        const ry = ay + Math.sin(ang - Math.PI / 2) * head * 0.45;
        return `<g>
          <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" vector-effect="non-scaling-stroke" />
          <polygon points="${x1},${y1} ${lx},${ly} ${rx},${ry}" fill="${color}" />
        </g>`;
      }
      const opacity = type === "highlight" ? 0.35 : 1;
      const sw = type === "highlight" ? Math.max(width * 3, 12) : width;
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`;
    })
    .join("");
}

function drawStrokesOnCtx(ctx, strokes = []) {
  for (const stroke of strokes || []) {
    const type = String(stroke.type || "pen").toLowerCase();
    const color = stroke.color || MARKUP_COLORS[0];
    const width = Number(stroke.width) || 3;
    if (type === "text") {
      const x = Number(stroke.x ?? stroke.points?.[0]?.[0] ?? 0);
      const y = Number(stroke.y ?? stroke.points?.[0]?.[1] ?? 0);
      const size = Number(stroke.fontSize) || Math.max(14, width * 5);
      if (!stroke.text) continue;
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
      ctx.fillText(String(stroke.text), x, y);
      ctx.restore();
      continue;
    }
    const pts = stroke.points || [];
    if (pts.length < 2) continue;
    if (type === "rect") {
      const [[x0, y0], [x1, y1]] = pts;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.restore();
      continue;
    }
    if (type === "arrow") {
      const [x0, y0] = pts[0];
      const [x1, y1] = pts[pts.length - 1];
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.max(10, width * 4);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(
        x1 - Math.cos(ang) * head + Math.cos(ang + Math.PI / 2) * head * 0.45,
        y1 - Math.sin(ang) * head + Math.sin(ang + Math.PI / 2) * head * 0.45,
      );
      ctx.lineTo(
        x1 - Math.cos(ang) * head + Math.cos(ang - Math.PI / 2) * head * 0.45,
        y1 - Math.sin(ang) * head + Math.sin(ang - Math.PI / 2) * head * 0.45,
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = type === "highlight" ? 0.35 : 1;
    ctx.lineWidth = type === "highlight" ? Math.max(width * 3, 12) : width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function loadDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = src;
  });
}

const dom = {
  authPill: document.getElementById("weekly-auth-pill"),
  searchInput: document.getElementById("weekly-report-search"),
  searchStatus: document.getElementById("weekly-report-search-status"),
  searchBlocks: [...document.querySelectorAll("[data-search-block]")],
  idProject: document.getElementById("weekly-project-id"),
  idPath: document.getElementById("weekly-path-id"),
  idLog: document.getElementById("weekly-log-id"),
  idTracking: document.getElementById("weekly-tracking-id"),
  idRef: document.getElementById("weekly-ref-id"),
  idScreenshotRef: document.getElementById("weekly-screenshot-ref"),
  recentList: document.getElementById("weekly-recent-list"),
  clearRecentBtn: document.getElementById("weekly-clear-recent"),
  feedbackJson: document.getElementById("weekly-feedback-json"),
  feedbackStatus: document.getElementById("weekly-feedback-status"),
  noteInput: document.getElementById("weekly-note-input"),
  submitFeedbackBtn: document.getElementById("weekly-submit-feedback"),
  copyNoteJsonBtn: document.getElementById("weekly-copy-note-json"),
  copyFeedbackJsonBtn: document.getElementById("weekly-copy-feedback-json"),
  editorStatus: document.getElementById("weekly-editor-status"),
  imageUpload: document.getElementById("weekly-image-upload"),
  projectInput: document.getElementById("weekly-project-input"),
  sourceFilenameInput: document.getElementById("weekly-source-filename"),
  saveModeSelect: document.getElementById("weekly-save-mode"),
  aiPromptInput: document.getElementById("weekly-ai-prompt"),
  runAiEditBtn: document.getElementById("weekly-run-ai-edit"),
  downloadMarkupBtn: document.getElementById("weekly-download-markup"),
  copyScreenshotRefBtn: document.getElementById("weekly-copy-screenshot-ref"),
  colorInput: document.getElementById("weekly-color-input"),
  widthInput: document.getElementById("weekly-width-input"),
  stack: document.getElementById("weekly-editor-stack"),
  placeholder: document.getElementById("weekly-editor-placeholder"),
  img: document.getElementById("weekly-editor-img"),
  svg: document.getElementById("weekly-editor-svg"),
  regionOverlay: document.getElementById("weekly-region-overlay"),
  tools: [...document.querySelectorAll("[data-tool]")],
  toolActions: [...document.querySelectorAll("[data-action]")],
};

const state = {
  currentContext: { ...DEFAULT_CONTEXT },
  recent: [],
  contextMenu: null,
  projectInputEdited: false,
  sourceDataUrl: "",
  sourceFilename: "",
  naturalW: 0,
  naturalH: 0,
  tool: "pen",
  color: MARKUP_COLORS[0],
  width: 3,
  strokes: [],
  undoStack: [],
  redoStack: [],
  drawing: false,
  currentStroke: null,
  screenshotRef: "none",
  region: null,
};

function setStatus(el, message, kind = "") {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("is-error", "is-ok");
  if (kind === "error") el.classList.add("is-error");
  if (kind === "ok") el.classList.add("is-ok");
}

function refreshAuthPill() {
  const user = getStoredUser?.();
  if (user?.email) {
    dom.authPill.textContent = `Signed in as ${user.display_name || user.email}`;
  } else {
    dom.authPill.textContent = "Not signed in here — open Studio first if you want to submit PM feedback or run AI image edit.";
  }
}

function addRecent(label, value) {
  const entry = {
    label: String(label || "event"),
    value: String(value || ""),
    at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
  state.recent = [entry, ...state.recent].slice(0, MAX_RECENT);
  renderRecent();
}

function renderRecent() {
  if (!dom.recentList) return;
  if (!state.recent.length) {
    dom.recentList.innerHTML = `<li><code>Right-click a report card or ticket row to start copying IDs.</code></li>`;
    return;
  }
  dom.recentList.innerHTML = state.recent
    .map((entry) => `<li><code>${escapeHtml(entry.at)} · ${escapeHtml(entry.label)}=${escapeHtml(entry.value)}</code></li>`)
    .join("");
}

function updateContext(next = {}) {
  state.currentContext = {
    ...state.currentContext,
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value != null && value !== "")),
  };
  dom.idProject.textContent = state.currentContext.project_id || "—";
  dom.idPath.textContent = state.currentContext.path_id || "—";
  dom.idLog.textContent = state.currentContext.log_id || "—";
  dom.idTracking.textContent = state.currentContext.tracking_id || "—";
  dom.idRef.textContent = state.currentContext.ref_id || "—";
  dom.idScreenshotRef.textContent = state.screenshotRef || "none";
  if (!state.projectInputEdited && dom.projectInput) {
    dom.projectInput.value = state.currentContext.project_id || dom.projectInput.value || "";
  }
  renderFeedbackPreview();
}

function feedbackPayload() {
  return {
    cycle_id: CYCLE_ID,
    ref_id: state.currentContext.ref_id || DEFAULT_CONTEXT.ref_id,
    instance_public_factor: 0,
    project_id: (dom.projectInput?.value || state.currentContext.project_id || "").trim() || null,
    path_id: state.currentContext.path_id || window.location.pathname,
    log_id: state.currentContext.log_id || CYCLE_ID,
    tracking_id: state.currentContext.tracking_id || DEFAULT_CONTEXT.tracking_id,
    note: String(dom.noteInput?.value || "").trim(),
    screenshot_ref: state.screenshotRef || "none",
  };
}

function renderFeedbackPreview() {
  const payload = feedbackPayload();
  dom.feedbackJson.textContent = JSON.stringify(payload, null, 2);
  dom.idScreenshotRef.textContent = state.screenshotRef || "none";
}

function closeContextMenu() {
  state.contextMenu?.remove();
  state.contextMenu = null;
}

async function copyContextKey(key) {
  const value = key === "screenshot_ref" ? state.screenshotRef : state.currentContext[key];
  if (!value) return;
  await copyText(value);
  addRecent(key, value);
}

function showContextMenu(event, context) {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "weekly-context-menu";
  menu.innerHTML = `
    <strong>${escapeHtml(context.tracking_id || context.log_id || "Weekly report IDs")}</strong>
    <button type="button" data-copy-key="project_id">Copy project_id</button>
    <button type="button" data-copy-key="path_id">Copy path_id</button>
    <button type="button" data-copy-key="log_id">Copy log_id</button>
    <button type="button" data-copy-key="tracking_id">Copy tracking_id</button>
  `;
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
  const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.addEventListener("click", async (ev) => {
    const key = ev.target.closest("[data-copy-key]")?.dataset.copyKey;
    if (!key) return;
    try {
      await copyContextKey(key);
      setStatus(dom.feedbackStatus, `Copied ${key}.`, "ok");
    } catch (err) {
      setStatus(dom.feedbackStatus, err.message || `Could not copy ${key}.`, "error");
    }
    closeContextMenu();
  });
  state.contextMenu = menu;
}

function captureContextFromElement(el) {
  if (!el) return null;
  return {
    project_id: el.dataset.projectId || state.currentContext.project_id,
    path_id: el.dataset.pathId || state.currentContext.path_id,
    log_id: el.dataset.logId || state.currentContext.log_id,
    tracking_id: el.dataset.trackingId || state.currentContext.tracking_id,
    ref_id: el.dataset.refId || state.currentContext.ref_id,
  };
}

function mountSearch() {
  dom.searchInput?.addEventListener("input", () => {
    const query = String(dom.searchInput.value || "").trim().toLowerCase();
    let shown = 0;
    for (const block of dom.searchBlocks) {
      const visible = block.contains(dom.searchInput)
        ? true
        : !query || String(block.textContent || "").toLowerCase().includes(query);
      block.classList.toggle("is-filtered", !visible);
      if (visible) shown += 1;
    }
    dom.searchStatus.textContent = query
      ? `${shown} matching block${shown === 1 ? "" : "s"} for "${query}".`
      : "Search is client-side; browser find also works because the report is plain HTML/text.";
  });
}

function snapshotState() {
  return JSON.stringify({
    strokes: state.strokes,
    region: state.region,
  });
}

function applySnapshot(raw) {
  const parsed = JSON.parse(raw || "{}");
  state.strokes = Array.isArray(parsed?.strokes) ? parsed.strokes : [];
  state.region = parsed?.region?.start && parsed?.region?.end ? parsed.region : null;
  state.currentStroke = null;
  state.drawing = false;
  redraw();
  updateRegionOverlay();
}

function pushHistory() {
  state.undoStack.push(snapshotState());
  if (state.undoStack.length > 80) state.undoStack.shift();
  state.redoStack = [];
}

function setTool(nextTool) {
  state.tool = nextTool;
  dom.stack.classList.toggle("is-pan", nextTool === "pan");
  dom.tools.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tool === nextTool);
  });
}

function redraw() {
  if (!dom.svg) return;
  dom.svg.innerHTML = strokeSvg(state.strokes);
}

function syncSvgSize() {
  const img = dom.img;
  if (!img || !dom.svg) return;
  const w = img.naturalWidth || state.naturalW || 1;
  const h = img.naturalHeight || state.naturalH || 1;
  dom.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  dom.svg.setAttribute("width", String(w));
  dom.svg.setAttribute("height", String(h));
}

function updateRegionOverlay() {
  if (!dom.regionOverlay) return;
  if (!state.region?.start || !state.region?.end) {
    dom.regionOverlay.hidden = true;
    dom.regionOverlay.innerHTML = "";
    return;
  }
  const x0 = Math.min(state.region.start[0], state.region.end[0]);
  const y0 = Math.min(state.region.start[1], state.region.end[1]);
  const x1 = Math.max(state.region.start[0], state.region.end[0]);
  const y1 = Math.max(state.region.start[1], state.region.end[1]);
  const img = dom.img;
  if (!img) return;
  const rect = img.getBoundingClientRect();
  const scaleX = rect.width / Math.max(1, img.naturalWidth || state.naturalW || rect.width);
  const scaleY = rect.height / Math.max(1, img.naturalHeight || state.naturalH || rect.height);
  const left = x0 * scaleX + (rect.left - dom.stack.getBoundingClientRect().left);
  const top = y0 * scaleY + (rect.top - dom.stack.getBoundingClientRect().top);
  const width = Math.max(1, (x1 - x0) * scaleX);
  const height = Math.max(1, (y1 - y0) * scaleY);
  dom.regionOverlay.hidden = false;
  dom.regionOverlay.innerHTML = `<div class="weekly-region-box" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px"></div>`;
}

function toLocal(event) {
  const rect = dom.img.getBoundingClientRect();
  const w = dom.img.naturalWidth || state.naturalW || rect.width || 1;
  const h = dom.img.naturalHeight || state.naturalH || rect.height || 1;
  const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * w;
  const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * h;
  return [x, y];
}

function eraseNear(point) {
  const [x, y] = point;
  const thresh = Math.max(12, state.width * 4);
  const next = [];
  let removed = false;
  for (const stroke of state.strokes) {
    if (stroke.type === "text") {
      const sx = Number(stroke.x ?? stroke.points?.[0]?.[0] ?? 0);
      const sy = Number(stroke.y ?? stroke.points?.[0]?.[1] ?? 0);
      if (Math.hypot(sx - x, sy - y) <= thresh * 2) {
        removed = true;
        continue;
      }
      next.push(stroke);
      continue;
    }
    const hit = (stroke.points || []).some(([px, py]) => Math.hypot(px - x, py - y) <= thresh);
    if (hit) {
      removed = true;
      continue;
    }
    next.push(stroke);
  }
  if (!removed) return;
  pushHistory();
  state.strokes = next;
  redraw();
}

async function buildMarkedCanvas() {
  if (!state.sourceDataUrl) throw new Error("Upload an image first.");
  const img = await loadImage(state.sourceDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  drawStrokesOnCtx(ctx, state.strokes);
  return canvas;
}

async function buildMarkedBlob() {
  const canvas = await buildMarkedCanvas();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not build marked PNG."));
    }, "image/png");
  });
}

async function buildMarkedDataUrl() {
  const canvas = await buildMarkedCanvas();
  return canvas.toDataURL("image/png");
}

async function setEditorImage(dataUrl, filename = "", screenshotRef = "") {
  const img = await loadImage(dataUrl);
  state.sourceDataUrl = dataUrl;
  state.sourceFilename = filename || basename(screenshotRef) || "weekly-report.png";
  state.naturalW = img.naturalWidth || img.width || 1;
  state.naturalH = img.naturalHeight || img.height || 1;
  state.strokes = [];
  state.undoStack = [];
  state.redoStack = [];
  state.region = null;
  state.currentStroke = null;
  state.drawing = false;
  state.screenshotRef = screenshotRef || `local-upload:${state.sourceFilename}`;
  if (dom.sourceFilenameInput) dom.sourceFilenameInput.value = state.sourceFilename;
  dom.img.src = dataUrl;
  dom.img.hidden = false;
  dom.svg.hidden = false;
  dom.placeholder.hidden = true;
  syncSvgSize();
  redraw();
  updateRegionOverlay();
  renderFeedbackPreview();
}

async function handleImageUpload(file) {
  if (!file) return;
  const dataUrl = await loadDataUrl(file);
  await setEditorImage(dataUrl, file.name, `local-upload:${file.name}`);
  setStatus(dom.editorStatus, `Loaded ${file.name}. Use right-click on report blocks to update the compact IDs before you submit.`, "ok");
}

async function downloadMarkedImage() {
  const dataUrl = await buildMarkedDataUrl();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `weekly-report-markup-${stamp}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function fetchImageAsDataUrl(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Could not load edited image (${res.status}).`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read edited image."));
    reader.readAsDataURL(blob);
  });
}

function currentRegionBox() {
  if (!state.region?.start || !state.region?.end) return null;
  const x0 = Math.min(state.region.start[0], state.region.end[0]);
  const y0 = Math.min(state.region.start[1], state.region.end[1]);
  const x1 = Math.max(state.region.start[0], state.region.end[0]);
  const y1 = Math.max(state.region.start[1], state.region.end[1]);
  return {
    x: Math.round(x0),
    y: Math.round(y0),
    w: Math.max(1, Math.round(x1 - x0)),
    h: Math.max(1, Math.round(y1 - y0)),
  };
}

async function runAiRegionEdit() {
  const projectId = String(dom.projectInput?.value || "").trim();
  const prompt = String(dom.aiPromptInput?.value || "").trim();
  const region = currentRegionBox();
  if (!projectId) throw new Error("Enter a target project_id for AI image edit.");
  if (!prompt) throw new Error("Write a prompt for the existing image edit tool.");
  if (!region || region.w < 8 || region.h < 8) throw new Error("Select a region first.");
  if (!state.sourceDataUrl) throw new Error("Upload an image first.");
  const sourceImage = await buildMarkedDataUrl();
  const sourceFilename = String(dom.sourceFilenameInput?.value || state.sourceFilename || "weekly-report.png").trim();
  const body = {
    prompt,
    source_image: sourceImage,
    source_filename: sourceFilename,
    region,
    save_mode: dom.saveModeSelect?.value === "replace" ? "replace" : "new",
  };
  setStatus(dom.editorStatus, "Running existing image edit…", "");
  const data = await api(`/api/projects/${encodeURIComponent(projectId)}/render-region-edit`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const nextRef = data?.url || `${projectId}:${data?.filename || "edited-render"}`;
  state.screenshotRef = nextRef;
  renderFeedbackPreview();
  addRecent("tracking_id", feedbackPayload().tracking_id || "");
  if (data?.url) {
    try {
      const editedUrl = await fetchImageAsDataUrl(data.url);
      dom.sourceFilenameInput.value = data.filename || sourceFilename;
      await setEditorImage(editedUrl, data.filename || sourceFilename, nextRef);
      setStatus(dom.editorStatus, `Saved existing image edit to ${data.filename || data.url}.`, "ok");
      return;
    } catch (err) {
      setStatus(dom.editorStatus, `Image edit finished, but the edited image could not be reloaded: ${err.message}`, "ok");
      return;
    }
  }
  setStatus(dom.editorStatus, "Existing image edit finished.", "ok");
}

async function submitFeedback() {
  const payload = feedbackPayload();
  if (!payload.note) throw new Error("Write a note before submitting PM feedback.");
  if (!getStoredUser?.()?.email) throw new Error("Open Studio and sign in first; PM feedback submission uses the authenticated review queue.");
  const form = new FormData();
  form.append("kind", "suggestion");
  form.append("message", payload.note);
  form.append("page_url", window.location.href);
  if (payload.project_id) form.append("project_id", payload.project_id);
  form.append("project_name", "Render Studio");
  form.append("prompt_label", `Weekly report ${payload.log_id}`);
  form.append("context_json", JSON.stringify(payload));
  if (state.sourceDataUrl) {
    const blob = await buildMarkedBlob();
    const fileName = (basename(payload.screenshot_ref) || basename(state.sourceFilename) || "weekly-report.png").replace(/\?.*$/, "");
    form.append("screenshots", new File([blob], fileName, { type: "image/png" }));
  }
  setStatus(dom.feedbackStatus, "Submitting PM feedback…", "");
  const data = await api("/api/feedback/requests", {
    method: "POST",
    body: form,
    headers: {},
  });
  const requestId = data?.request?.id || "unknown";
  setStatus(dom.feedbackStatus, `Submitted to PM review queue as ${requestId}.`, "ok");
  addRecent("feedback_id", requestId);
  if (payload.log_id) addRecent("log_id", payload.log_id);
}

function bindMarkupSurface() {
  const endStroke = () => {
    if (!state.drawing) return;
    state.drawing = false;
    if (state.currentStroke && state.currentStroke.type !== "region") {
      state.strokes = [...state.strokes, state.currentStroke];
      state.currentStroke = null;
      redraw();
    }
    updateRegionOverlay();
  };

  dom.stack.addEventListener("pointerdown", (event) => {
    if (!state.sourceDataUrl || !dom.img || dom.img.hidden) return;
    if (event.button !== 0) return;
    const point = toLocal(event);
    if (state.tool === "pan") return;
    if (state.tool === "eraser") {
      eraseNear(point);
      return;
    }
    if (state.tool === "text") {
      const text = window.prompt("Text annotation", "");
      if (!text) return;
      pushHistory();
      state.strokes = [
        ...state.strokes,
        {
          type: "text",
          text,
          x: point[0],
          y: point[1],
          color: state.color,
          width: state.width,
          fontSize: Math.max(16, state.width * 6),
          points: [point],
        },
      ];
      redraw();
      return;
    }
    pushHistory();
    if (state.tool === "region") {
      state.region = { start: point, end: point };
      state.currentStroke = { type: "region", points: [point, point] };
      state.drawing = true;
      updateRegionOverlay();
      return;
    }
    state.currentStroke = {
      type: state.tool,
      color: state.color,
      width: state.width,
      points: [point],
    };
    state.drawing = true;
    redraw();
  });

  dom.stack.addEventListener("pointermove", (event) => {
    if (!state.drawing || !state.currentStroke || !state.sourceDataUrl) return;
    const point = toLocal(event);
    if (state.tool === "region") {
      state.region = { start: state.region?.start || point, end: point };
      state.currentStroke.points[1] = point;
      updateRegionOverlay();
      return;
    }
    if (state.currentStroke.type === "rect" || state.currentStroke.type === "arrow") {
      state.currentStroke.points = [state.currentStroke.points[0], point];
    } else {
      state.currentStroke.points.push(point);
    }
    dom.svg.innerHTML = `${strokeSvg(state.strokes)}${strokeSvg([state.currentStroke])}`;
  });

  dom.stack.addEventListener("pointerup", endStroke);
  dom.stack.addEventListener("pointerleave", endStroke);
  window.addEventListener("pointerup", endStroke);
  window.addEventListener("resize", updateRegionOverlay);
}

function bindContextTargets() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-id-context]");
    if (!target) {
      closeContextMenu();
      return;
    }
    const context = captureContextFromElement(target);
    if (context) updateContext(context);
  });

  document.addEventListener("contextmenu", (event) => {
    const target = event.target.closest("[data-id-context]");
    if (!target) return;
    const context = captureContextFromElement(target);
    if (!context) return;
    event.preventDefault();
    event.stopPropagation();
    updateContext(context);
    showContextMenu(event, context);
  });

  document.addEventListener(
    "mousedown",
    (event) => {
      if (event.button !== 0) return;
      if (state.contextMenu?.contains(event.target)) return;
      closeContextMenu();
    },
    true,
  );
  document.addEventListener("scroll", closeContextMenu, true);
  window.addEventListener("resize", closeContextMenu);
}

function bindButtons() {
  dom.clearRecentBtn?.addEventListener("click", () => {
    state.recent = [];
    renderRecent();
  });

  dom.noteInput?.addEventListener("input", renderFeedbackPreview);
  dom.projectInput?.addEventListener("input", () => {
    state.projectInputEdited = true;
    renderFeedbackPreview();
  });
  dom.copyScreenshotRefBtn?.addEventListener("click", async () => {
    try {
      await copyText(state.screenshotRef || "none");
      addRecent("screenshot_ref", state.screenshotRef || "none");
      setStatus(dom.editorStatus, "Copied screenshot_ref.", "ok");
    } catch (err) {
      setStatus(dom.editorStatus, err.message || "Could not copy screenshot_ref.", "error");
    }
  });
  dom.copyNoteJsonBtn?.addEventListener("click", async () => {
    try {
      await copyText(JSON.stringify(feedbackPayload(), null, 2));
      setStatus(dom.feedbackStatus, "Copied JSON preview.", "ok");
    } catch (err) {
      setStatus(dom.feedbackStatus, err.message || "Could not copy JSON preview.", "error");
    }
  });
  dom.copyFeedbackJsonBtn?.addEventListener("click", async () => {
    try {
      await copyText(JSON.stringify(feedbackPayload(), null, 2));
      setStatus(dom.feedbackStatus, "Copied feedback JSON.", "ok");
    } catch (err) {
      setStatus(dom.feedbackStatus, err.message || "Could not copy feedback JSON.", "error");
    }
  });
  dom.submitFeedbackBtn?.addEventListener("click", async () => {
    try {
      await submitFeedback();
    } catch (err) {
      setStatus(dom.feedbackStatus, err.message || "Could not submit PM feedback.", "error");
    }
  });
  dom.imageUpload?.addEventListener("change", async () => {
    const file = dom.imageUpload.files?.[0];
    if (!file) return;
    try {
      await handleImageUpload(file);
    } catch (err) {
      setStatus(dom.editorStatus, err.message || "Could not load image.", "error");
    } finally {
      dom.imageUpload.value = "";
    }
  });
  dom.downloadMarkupBtn?.addEventListener("click", async () => {
    try {
      await downloadMarkedImage();
      setStatus(dom.editorStatus, "Downloaded marked PNG.", "ok");
    } catch (err) {
      setStatus(dom.editorStatus, err.message || "Could not download marked PNG.", "error");
    }
  });
  dom.runAiEditBtn?.addEventListener("click", async () => {
    try {
      await runAiRegionEdit();
    } catch (err) {
      setStatus(dom.editorStatus, err.message || "Could not run AI image edit.", "error");
    }
  });

  dom.tools.forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  dom.toolActions.forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "undo" && state.undoStack.length) {
        state.redoStack.push(snapshotState());
        applySnapshot(state.undoStack.pop() || "{}");
      } else if (action === "redo" && state.redoStack.length) {
        state.undoStack.push(snapshotState());
        applySnapshot(state.redoStack.pop() || "{}");
      } else if (action === "clear") {
        if (!state.strokes.length && !state.region) return;
        pushHistory();
        state.strokes = [];
        state.region = null;
        state.currentStroke = null;
        state.drawing = false;
        redraw();
        updateRegionOverlay();
      }
    });
  });

  dom.colorInput?.addEventListener("input", () => {
    state.color = dom.colorInput.value || MARKUP_COLORS[0];
  });
  dom.widthInput?.addEventListener("input", () => {
    state.width = Math.max(1, Math.min(16, Number(dom.widthInput.value) || 3));
  });
}

async function bootstrap() {
  refreshAuthPill();
  window.addEventListener("focus", async () => {
    await delay(40);
    refreshAuthPill();
  });
  mountSearch();
  bindContextTargets();
  bindMarkupSurface();
  bindButtons();
  updateContext(DEFAULT_CONTEXT);
  setTool("pen");
  renderRecent();
  renderFeedbackPreview();
}

void bootstrap();
