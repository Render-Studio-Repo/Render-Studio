/**
 * Post-screenshot markup + share modal.
 * Tools mirror reference-files / PDF markup: pen, highlight, rect, arrow, text, eraser.
 * Share dropdown: Slack / Discord (share-chat copy-message + open), X, copy link, download.
 */

import {
  copyShareText,
  formatSocialShareMessage,
  shareToDiscord,
  shareToSlack,
} from "../components/share-chat.js?v=20260909-sharechat1-20260914-shareprompt1";
import { triggerTrackedBlobDownload } from "../viewport/viewport-video-editor.js?v=leakfix6";

const MARKUP_COLORS = ["#f0883e", "#58a6ff", "#3fb950", "#ff7b72", "#e6edf3", "#000000"];
const SHARE_TARGET_KEY = "render3d:shotShareTarget:v1";
const SHARE_TARGETS = ["slack", "discord", "x", "link"];
const X_SHARE_SITE = "https://render3d.app";
const X_SHARE_ATTRIBUTION = "Built in Render Studio";
const X_SHARE_ATTRIBUTION_LINE = `${X_SHARE_ATTRIBUTION} ${X_SHARE_SITE}`;
const X_SHARE_DEFAULT = `\n\n${X_SHARE_ATTRIBUTION_LINE}`;
const shotDownloadCreated = [];

const SHARE_LOGOS = {
  slack: `<svg viewBox="0 0 122.8 122.8" width="16" height="16" aria-hidden="true"><path fill="#E01E5A" d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"/><path fill="#36C5F0" d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"/><path fill="#2EB67D" d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"/><path fill="#ECB22E" d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"/></svg>`,
  discord: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#5865F2" d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.734l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg>`,
  link: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9.7 14.3a1 1 0 0 1 0-1.4l3.2-3.2a1 1 0 1 1 1.4 1.4l-3.2 3.2a1 1 0 0 1-1.4 0Zm-4.2-1.8 3.2-3.2a1 1 0 1 0-1.4-1.4L4.1 11.1a3.7 3.7 0 0 0 5.2 5.2l1.1-1.1a1 1 0 1 0-1.4-1.4l-1.1 1.1a1.7 1.7 0 1 1-2.4-2.4Zm13-3.8-3.2 3.2a1 1 0 0 0 1.4 1.4l3.2-3.2a3.7 3.7 0 0 0-5.2-5.2l-1.1 1.1a1 1 0 0 0 1.4 1.4l1.1-1.1a1.7 1.7 0 1 1 2.4 2.4Z"/></svg>`,
};

function shareTargetLabel(target) {
  if (target === "discord") return "Discord";
  if (target === "x") return "X";
  if (target === "link") return "Copy link";
  return "Slack";
}

function readShareTarget() {
  try {
    const v = String(localStorage.getItem(SHARE_TARGET_KEY) || "").toLowerCase();
    if (SHARE_TARGETS.includes(v)) return v;
  } catch {
    /* ignore */
  }
  return "slack";
}

function writeShareTarget(target) {
  const next = SHARE_TARGETS.includes(target) ? target : "slack";
  try {
    localStorage.setItem(SHARE_TARGET_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function strokeSvg(strokes = []) {
  return (strokes || [])
    .map((stroke) => {
      const type = String(stroke.type || "pen").toLowerCase();
      const color = escapeHtml(stroke.color || "#f0883e");
      const width = Number(stroke.width) || 3;
      if (type === "text") {
        const x = Number(stroke.x ?? stroke.points?.[0]?.[0] ?? 0);
        const y = Number(stroke.y ?? stroke.points?.[0]?.[1] ?? 0);
        const size = Number(stroke.fontSize) || Math.max(14, width * 5);
        const text = escapeHtml(stroke.text || "");
        if (!text) return "";
        return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-family="Inter, system-ui, sans-serif" font-weight="700">${text}</text>`;
      }
      const pts = (stroke.points || [])
        .map((p) => `${Number(p[0])},${Number(p[1])}`)
        .join(" ");
      if (!pts) return "";
      if (type === "rect" && (stroke.points || []).length >= 2) {
        const [[x0, y0], [x1, y1]] = stroke.points;
        const x = Math.min(x0, x1);
        const y = Math.min(y0, y1);
        const w = Math.abs(x1 - x0);
        const h = Math.abs(y1 - y0);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke" />`;
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
    const color = stroke.color || "#f0883e";
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load screenshot."));
    img.src = src;
  });
}

const RENDER_EDIT_PREF_KEY = "render3d:renderEditSaveMode:v1";

export function createScreenshotMarkup({ api = null, getToken = null, onStatus = null } = {}) {
  let modalEl = null;
  let sourceDataUrl = "";
  let naturalW = 0;
  let naturalH = 0;
  let strokes = [];
  let undoStack = [];
  let redoStack = [];
  let tool = "pen";
  let color = MARKUP_COLORS[0];
  let width = 3;
  let drawing = false;
  let currentStroke = null;
  let editorPurpose = "screenshot";
  let applyHandler = null;

  function setStatus(msg, isError = false) {
    const el = modalEl?.querySelector("[data-shot-markup-status]");
    if (el) {
      el.textContent = msg || "";
      el.classList.toggle("is-error", !!isError);
    }
    if (msg && typeof onStatus === "function") onStatus(!isError, msg);
  }

  function setXStatus(msg) {
    const el = modalEl?.querySelector("[data-shot-markup-x-status]");
    if (el) el.textContent = msg || "";
  }

  function readSavePref() {
    try {
      const v = localStorage.getItem(RENDER_EDIT_PREF_KEY);
      if (v === "new" || v === "replace" || v === "ask") return v;
    } catch {
      /* ignore */
    }
    return "ask";
  }

  function writeSavePref(mode) {
    if (mode !== "new" && mode !== "replace" && mode !== "ask") return;
    try {
      localStorage.setItem(RENDER_EDIT_PREF_KEY, mode);
    } catch {
      /* ignore */
    }
  }

  function hideAskPanel() {
    modalEl?.querySelector("[data-shot-ask-panel]")?.classList.add("hidden");
  }

  function syncSaveModeButtons() {
    const pref = readSavePref();
    modalEl?.querySelectorAll("[data-shot-save-mode]").forEach((btn) => {
      const active = btn.dataset.shotSaveMode === pref;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  function syncPurposeUi(modeLabel) {
    if (!modalEl) return;
    const isPrompt = editorPurpose === "prompt-image";
    modalEl.classList.toggle("is-prompt-image", isPrompt);
    const eyebrow = modalEl.querySelector(".screenshot-markup-eyebrow");
    if (eyebrow) eyebrow.textContent = modeLabel || (isPrompt ? "Prompt photo" : "Viewport screenshot");
    const title = modalEl.querySelector(".app-dialog-title");
    const hint = modalEl.querySelector("[data-shot-markup-hint]");
    if (isPrompt) {
      if (title) title.textContent = "Edit prompt photo";
      if (hint) {
        hint.textContent =
          "Same markup tools as the image editor. Send the result back as a replacement, a new AI photo, or ask each time.";
      }
    } else {
      if (title) title.textContent = "Mark up & share";
      if (hint) hint.textContent = "Annotate like the PDF / reference editor, then share.";
    }
    syncSaveModeButtons();
    hideAskPanel();
  }

  async function sendPromptImage() {
    if (typeof applyHandler !== "function") {
      setStatus("This editor is not connected to the AI prompt.", true);
      return;
    }
    const pref = readSavePref();
    if (pref === "ask") {
      modalEl?.querySelector("[data-shot-ask-panel]")?.classList.remove("hidden");
      setStatus("Choose replace or new image.");
      return;
    }
    await finishPromptApply(pref);
  }

  async function finishPromptApply(mode) {
    const choice = mode === "replace" ? "replace" : "new";
    if (typeof applyHandler !== "function") return;
    const sendBtn = modalEl?.querySelector("[data-shot-markup-send]");
    if (sendBtn) sendBtn.disabled = true;
    setStatus(choice === "replace" ? "Updating the prompt photo…" : "Attaching as a new prompt photo…");
    try {
      const dataUrl = await compositeMarkedPng();
      await applyHandler({ dataUrl, mode: choice, strokeCount: strokes.length });
      close();
    } catch (err) {
      setStatus(err?.message || "Could not send the edited photo.", true);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function pushHistory() {
    undoStack.push(JSON.stringify(strokes));
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
  }

  function redraw() {
    const svg = modalEl?.querySelector("[data-shot-markup-svg]");
    if (svg) svg.innerHTML = strokeSvg(strokes);
  }

  function syncSvgSize() {
    const img = modalEl?.querySelector("[data-shot-markup-img]");
    const svg = modalEl?.querySelector("[data-shot-markup-svg]");
    if (!img || !svg) return;
    const w = img.naturalWidth || naturalW || 1;
    const h = img.naturalHeight || naturalH || 1;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
  }

  function toLocal(e) {
    const stack = modalEl?.querySelector("[data-shot-markup-stack]");
    const img = modalEl?.querySelector("[data-shot-markup-img]");
    if (!stack || !img) return [0, 0];
    const rect = img.getBoundingClientRect();
    const w = img.naturalWidth || naturalW || rect.width || 1;
    const h = img.naturalHeight || naturalH || rect.height || 1;
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * w;
    const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * h;
    return [x, y];
  }

  function eraseNear(point) {
    const [x, y] = point;
    const thresh = Math.max(12, width * 4);
    const next = [];
    let removed = false;
    for (const stroke of strokes) {
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
    if (removed) {
      pushHistory();
      strokes = next;
      redraw();
    }
  }

  function setTool(next) {
    tool = next;
    modalEl?.querySelectorAll("[data-shot-tool]").forEach((btn) => {
      const active = btn.dataset.shotTool === tool;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const stack = modalEl?.querySelector("[data-shot-markup-stack]");
    stack?.classList.toggle("is-draw", tool !== "pan");
  }

  function isShareMenuOpen() {
    return !modalEl?.querySelector("[data-shot-share-menu]")?.classList.contains("hidden");
  }

  function closeShareMenu() {
    modalEl?.querySelector("[data-shot-share-menu]")?.classList.add("hidden");
    modalEl?.querySelector("[data-shot-share-toggle]")?.setAttribute("aria-expanded", "false");
  }

  function toggleShareMenu() {
    const menu = modalEl?.querySelector("[data-shot-share-menu]");
    if (!menu) return;
    const open = menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !open);
    modalEl?.querySelector("[data-shot-share-toggle]")?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function syncShareButton() {
    const target = readShareTarget();
    const logo = modalEl?.querySelector("[data-shot-share-logo]");
    const btn = modalEl?.querySelector("[data-shot-share-run]");
    if (logo) logo.innerHTML = SHARE_LOGOS[target] || SHARE_LOGOS.slack;
    if (btn) {
      btn.dataset.shotShareCurrent = target;
      const label = shareTargetLabel(target);
      btn.title = target === "link" ? "Copy link" : `Share to ${label}`;
      btn.setAttribute("aria-label", btn.title);
    }
    modalEl?.querySelectorAll("[data-shot-share-target]").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.shotShareTarget === target);
    });
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.id = "screenshot-markup-modal";
    modalEl.className = "auth-modal screenshot-markup-modal hidden";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.innerHTML = `
      <div class="auth-backdrop" data-shot-markup-close></div>
      <div class="auth-card app-dialog-card screenshot-markup-card">
        <button type="button" class="auth-close" data-shot-markup-close aria-label="Close">&times;</button>
        <p class="screenshot-markup-eyebrow">Viewport screenshot</p>
        <h2 class="app-dialog-title">Mark up &amp; share</h2>
        <p class="muted small screenshot-markup-hint" data-shot-markup-hint>Annotate like the PDF / reference editor, then share.</p>
        <div class="screenshot-markup-bar" role="toolbar" aria-label="Markup and share">
          <div class="screenshot-markup-tools">
            <div class="ref-tool-group" role="group" aria-label="Markup tools">
              <button type="button" class="dxf-viewer-btn" data-shot-tool="pan" aria-pressed="false" title="Pan / view">Pan</button>
              <button type="button" class="dxf-viewer-btn active" data-shot-tool="pen" aria-pressed="true" title="Pen">Pen</button>
              <button type="button" class="dxf-viewer-btn" data-shot-tool="highlight" aria-pressed="false" title="Highlight">Highlight</button>
              <button type="button" class="dxf-viewer-btn" data-shot-tool="rect" aria-pressed="false" title="Rectangle">Rect</button>
              <button type="button" class="dxf-viewer-btn" data-shot-tool="arrow" aria-pressed="false" title="Arrow">Arrow</button>
              <button type="button" class="dxf-viewer-btn" data-shot-tool="text" aria-pressed="false" title="Text">Text</button>
              <button type="button" class="dxf-viewer-btn" data-shot-tool="eraser" aria-pressed="false" title="Eraser">Eraser</button>
            </div>
            <div class="ref-tool-group ref-tool-group--style" role="group" aria-label="Stroke style">
              <label class="ref-color-picker" title="Stroke color">
                <span>Color</span>
                <input type="color" data-shot-color value="${escapeHtml(color)}" />
              </label>
              <label class="ref-width-picker" title="Stroke width">
                <span>Size</span>
                <input type="range" data-shot-width min="1" max="16" value="${width}" />
              </label>
              <div class="ref-swatch-row">
                ${MARKUP_COLORS.map((c) => `<button type="button" class="ref-swatch${c === color ? " is-active" : ""}" data-shot-swatch="${c}" style="--swatch:${c}" title="${c}"></button>`).join("")}
              </div>
            </div>
            <div class="ref-tool-group" role="group" aria-label="History">
              <button type="button" class="dxf-viewer-btn" data-shot-action="undo" title="Undo">Undo</button>
              <button type="button" class="dxf-viewer-btn" data-shot-action="redo" title="Redo">Redo</button>
              <button type="button" class="dxf-viewer-btn" data-shot-action="clear" title="Clear marks">Clear</button>
            </div>
          </div>
          <div class="screenshot-share" data-shot-share>
            <button type="button" class="screenshot-share-btn" data-shot-share-run data-shot-share-current="slack" title="Share to Slack" aria-label="Share to Slack" aria-busy="false">
              <span class="screenshot-share-logo" data-shot-share-logo aria-hidden="true">${SHARE_LOGOS.slack}</span>
              <span class="viewport-video-share-x-spinner" hidden aria-hidden="true"></span>
              <span>Share</span>
            </button>
            <button type="button" class="screenshot-share-chevron" data-shot-share-toggle aria-haspopup="menu" aria-expanded="false" aria-label="Share options">
              <span aria-hidden="true">▾</span>
            </button>
            <div class="screenshot-share-menu hidden" data-shot-share-menu role="menu">
              <button type="button" role="menuitem" data-shot-share-target="slack">${SHARE_LOGOS.slack}<span>Slack</span></button>
              <button type="button" role="menuitem" data-shot-share-target="discord">${SHARE_LOGOS.discord}<span>Discord</span></button>
              <button type="button" role="menuitem" data-shot-share-target="x">${SHARE_LOGOS.x}<span>X</span></button>
              <button type="button" role="menuitem" data-shot-share-target="link">${SHARE_LOGOS.link}<span>Copy link</span></button>
              <button type="button" role="menuitem" data-shot-share-action="download">Download PNG</button>
              <button type="button" role="menuitem" data-shot-share-action="connect-x">Connect X</button>
            </div>
          </div>
        </div>
        <div class="screenshot-markup-stage">
          <div class="screenshot-markup-stack is-draw" data-shot-markup-stack>
            <img class="screenshot-markup-img" data-shot-markup-img alt="Screenshot" draggable="false" />
            <svg class="screenshot-markup-svg ref-markup-svg" data-shot-markup-svg xmlns="http://www.w3.org/2000/svg"></svg>
          </div>
        </div>
        <label class="screenshot-markup-caption">
          <span class="screenshot-markup-caption-head">
            <span>Caption</span>
            <button type="button" class="prompt-mic-btn" data-mic-target="shot-markup-caption" title="Talk to write your X post" aria-label="Dictate caption">
              <span class="prompt-mic-icon" aria-hidden="true">🎙</span>
            </button>
          </span>
          <textarea id="shot-markup-caption" data-shot-markup-text maxlength="280" rows="3" placeholder="Talk or type your X post…"></textarea>
        </label>
        <p class="screenshot-markup-x-status muted small" data-shot-markup-x-status></p>
        <p class="screenshot-markup-status muted small" data-shot-markup-status role="status"></p>
        <div class="viewport-x-pin-panel hidden" data-shot-x-pin-panel>
          <p class="viewport-x-pin-title">Enter the PIN from X</p>
          <p class="muted small">Authorize Render Studio in the X window, then type the PIN shown there.</p>
          <div class="viewport-x-pin-row">
            <input type="text" inputmode="numeric" autocomplete="one-time-code" data-shot-x-pin-input placeholder="PIN code" maxlength="12" />
            <button type="button" class="btn accent" data-shot-x-pin-submit>Connect</button>
            <button type="button" class="btn secondary" data-shot-x-pin-cancel>Cancel</button>
          </div>
        </div>
        <div class="screenshot-prompt-apply" data-shot-prompt-apply>
          <div class="screenshot-save-mode" role="group" aria-label="How to send this photo back">
            <span class="screenshot-save-mode-label">Send as</span>
            <button type="button" class="dxf-viewer-btn" data-shot-save-mode="ask" title="Ask each time">Ask</button>
            <button type="button" class="dxf-viewer-btn" data-shot-save-mode="replace" title="Replace the current prompt photo">Replace</button>
            <button type="button" class="dxf-viewer-btn" data-shot-save-mode="new" title="Attach as a new prompt photo">New image</button>
          </div>
          <button type="button" class="btn accent" data-shot-markup-send>Send to AI prompt</button>
        </div>
        <div class="screenshot-ask-panel hidden" data-shot-ask-panel>
          <p>Update the current photo, or attach this as a new image for AI?</p>
          <div class="screenshot-ask-actions">
            <button type="button" class="btn primary" data-shot-apply="replace">Replace this photo</button>
            <button type="button" class="btn accent" data-shot-apply="new">New image</button>
            <button type="button" class="btn secondary" data-shot-ask-cancel>Back</button>
          </div>
        </div>
        <div class="app-dialog-actions">
          <button type="button" class="btn secondary" data-shot-markup-close>Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.addEventListener("click", (e) => {
      if (e.target.closest("[data-shot-markup-close]")) {
        close();
        return;
      }
      const toolBtn = e.target.closest("[data-shot-tool]");
      if (toolBtn) {
        setTool(toolBtn.dataset.shotTool || "pen");
        return;
      }
      const swatch = e.target.closest("[data-shot-swatch]");
      if (swatch) {
        color = swatch.dataset.shotSwatch || color;
        const input = modalEl.querySelector("[data-shot-color]");
        if (input) input.value = color;
        modalEl.querySelectorAll("[data-shot-swatch]").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.shotSwatch === color);
        });
        return;
      }
      const action = e.target.closest("[data-shot-action]");
      if (action) {
        const name = action.dataset.shotAction;
        if (name === "undo") {
          if (!undoStack.length) return;
          redoStack.push(JSON.stringify(strokes));
          strokes = JSON.parse(undoStack.pop() || "[]");
          redraw();
        } else if (name === "redo") {
          if (!redoStack.length) return;
          undoStack.push(JSON.stringify(strokes));
          strokes = JSON.parse(redoStack.pop() || "[]");
          redraw();
        } else if (name === "clear") {
          if (!strokes.length) return;
          pushHistory();
          strokes = [];
          redraw();
        }
        return;
      }
      if (e.target.closest("[data-shot-save-mode]")) {
        const mode = e.target.closest("[data-shot-save-mode]")?.dataset.shotSaveMode;
        writeSavePref(mode);
        syncSaveModeButtons();
        hideAskPanel();
        return;
      }
      if (e.target.closest("[data-shot-markup-send]")) {
        void sendPromptImage();
        return;
      }
      if (e.target.closest("[data-shot-apply]")) {
        const mode = e.target.closest("[data-shot-apply]")?.dataset.shotApply;
        void finishPromptApply(mode);
        return;
      }
      if (e.target.closest("[data-shot-ask-cancel]")) {
        hideAskPanel();
        return;
      }
      if (e.target.closest("[data-shot-share-toggle]")) {
        e.preventDefault();
        toggleShareMenu();
        return;
      }
      if (e.target.closest("[data-shot-share-run]")) {
        e.preventDefault();
        closeShareMenu();
        void runShareTarget(readShareTarget());
        return;
      }
      const shareTarget = e.target.closest("[data-shot-share-target]");
      if (shareTarget) {
        const next = writeShareTarget(shareTarget.dataset.shotShareTarget || "slack");
        syncShareButton();
        closeShareMenu();
        void runShareTarget(next);
        return;
      }
      if (e.target.closest("[data-shot-share-action='download']") || e.target.closest("[data-shot-markup-download]")) {
        closeShareMenu();
        void downloadMarked();
        return;
      }
      if (e.target.closest("[data-shot-share-action='connect-x']") || e.target.closest("[data-shot-markup-connect-x]")) {
        closeShareMenu();
        void connectX();
        return;
      }
      if (e.target.closest("[data-shot-markup-post-x]")) {
        writeShareTarget("x");
        syncShareButton();
        closeShareMenu();
        void postToX();
        return;
      }
      if (e.target.closest("[data-shot-x-pin-submit]")) {
        finishXPinPrompt(true);
        return;
      }
      if (e.target.closest("[data-shot-x-pin-cancel]")) {
        finishXPinPrompt(false);
      }
    });

    modalEl.querySelector("[data-shot-x-pin-input]")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishXPinPrompt(true);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        finishXPinPrompt(false);
      }
    });

    modalEl.querySelector("[data-shot-color]")?.addEventListener("input", (e) => {
      color = e.target.value || color;
      modalEl.querySelectorAll("[data-shot-swatch]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.shotSwatch === color);
      });
    });
    modalEl.querySelector("[data-shot-width]")?.addEventListener("input", (e) => {
      width = Math.max(1, Number(e.target.value) || 3);
    });

    const stack = modalEl.querySelector("[data-shot-markup-stack]");
    stack?.addEventListener("pointerdown", (e) => {
      if (tool === "pan") return;
      e.preventDefault();
      const point = toLocal(e);
      if (tool === "eraser") {
        eraseNear(point);
        return;
      }
      if (tool === "text") {
        const text = window.prompt("Text label", "");
        if (!text?.trim()) return;
        pushHistory();
        strokes = [
          ...strokes,
          {
            type: "text",
            text: text.trim().slice(0, 240),
            x: point[0],
            y: point[1],
            points: [point, point],
            color,
            width,
            fontSize: Math.max(16, width * 6),
          },
        ];
        redraw();
        return;
      }
      drawing = true;
      currentStroke = {
        type: tool === "highlight" ? "highlight" : tool === "rect" ? "rect" : tool === "arrow" ? "arrow" : "pen",
        points: [point, point],
        color,
        width,
      };
      pushHistory();
      strokes = [...strokes, currentStroke];
      stack.setPointerCapture?.(e.pointerId);
      redraw();
    });
    stack?.addEventListener("pointermove", (e) => {
      if (!drawing || !currentStroke) return;
      const point = toLocal(e);
      if (currentStroke.type === "rect" || currentStroke.type === "arrow") {
        currentStroke.points = [currentStroke.points[0], point];
      } else {
        currentStroke.points.push(point);
      }
      redraw();
    });
    const endStroke = () => {
      drawing = false;
      currentStroke = null;
    };
    stack?.addEventListener("pointerup", endStroke);
    stack?.addEventListener("pointercancel", endStroke);

    document.addEventListener("pointerdown", (e) => {
      if (modalEl?.classList.contains("hidden")) return;
      if (!e.target.closest("[data-shot-share]")) closeShareMenu();
    });

    document.addEventListener("keydown", (e) => {
      if (modalEl?.classList.contains("hidden")) return;
      if (e.key === "Escape") {
        if (isShareMenuOpen()) {
          e.preventDefault();
          closeShareMenu();
          return;
        }
        close();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        modalEl.querySelector(e.shiftKey ? '[data-shot-action="redo"]' : '[data-shot-action="undo"]')?.click();
      }
    });

    return modalEl;
  }

  async function compositeMarkedPng() {
    const img = await loadImage(sourceDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || naturalW || 1;
    canvas.height = img.naturalHeight || naturalH || 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not compose screenshot.");
    ctx.drawImage(img, 0, 0);
    drawStrokesOnCtx(ctx, strokes);
    return canvas.toDataURL("image/png");
  }

  async function downloadMarked() {
    try {
      const url = await compositeMarkedPng();
      downloadMarkedPng(url);
      setStatus("Screenshot downloaded.");
    } catch (err) {
      setStatus(err?.message || "Download failed.", true);
    }
  }

  async function refreshXStatus() {
    const connectBtn = modalEl?.querySelector("[data-shot-share-action='connect-x'], [data-shot-markup-connect-x]");
    if (!api) {
      setXStatus("Sign in to connect X.");
      if (connectBtn) connectBtn.disabled = true;
      return null;
    }
    try {
      const data = await api("/api/integrations/twitter/status");
      const connected = !!data?.connected;
      const handle = data?.account?.username ? `@${data.account.username}` : "";
      if (connected) {
        setXStatus(`Connected as ${handle || "X account"}.`);
        if (connectBtn) {
          connectBtn.textContent = "Reconnect X";
          connectBtn.disabled = false;
        }
      } else {
        setXStatus(
          data?.configured
            ? "Connect X to post this screenshot from Render Studio."
            : "X posting is not configured on this server yet.",
        );
        if (connectBtn) {
          connectBtn.textContent = "Connect X";
          connectBtn.disabled = !data?.configured;
        }
      }
      return data;
    } catch (err) {
      setXStatus(err?.message || "Could not check X status.");
      return null;
    }
  }

  let xPinResolver = null;

  function hideXPinPanel() {
    modalEl?.querySelector("[data-shot-x-pin-panel]")?.classList.add("hidden");
    const input = modalEl?.querySelector("[data-shot-x-pin-input]");
    if (input) input.value = "";
  }

  function finishXPinPrompt(submit) {
    const input = modalEl?.querySelector("[data-shot-x-pin-input]");
    const pin = submit ? String(input?.value || "").trim() : "";
    hideXPinPanel();
    const resolve = xPinResolver;
    xPinResolver = null;
    resolve?.(pin || null);
  }

  function askXPinInModal() {
    ensureModal();
    return new Promise((resolve) => {
      if (xPinResolver) {
        const prev = xPinResolver;
        xPinResolver = null;
        prev(null);
      }
      xPinResolver = resolve;
      modalEl.querySelector("[data-shot-x-pin-panel]")?.classList.remove("hidden");
      const input = modalEl.querySelector("[data-shot-x-pin-input]");
      if (input) {
        input.value = "";
        window.setTimeout(() => input.focus(), 50);
      }
      setStatus("Authorize in the X window, then enter the PIN below.");
    });
  }

  async function connectX() {
    if (!api) {
      setStatus("Sign in first.", true);
      return;
    }
    setStatus("Opening X authorization…");
    try {
      const data = await api("/api/integrations/twitter/link-url", { method: "POST" });
      if (!data?.url) throw new Error("X authorization URL was not returned.");
      const mode = String(data.mode || "redirect").toLowerCase();
      const widthPx = 560;
      const heightPx = 720;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - widthPx) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - heightPx) / 2));
      const popup = window.open(
        data.url,
        "render3d-twitter-connect",
        `popup=yes,width=${widthPx},height=${heightPx},left=${left},top=${top}`,
      );
      if (!popup) {
        setStatus("Popup blocked — allow popups for Render Studio.", true);
        return;
      }
      if (mode === "oob") {
        const pin = await askXPinInModal();
        try { popup.close(); } catch (_) {}
        if (!pin) {
          setStatus("Connect cancelled — no PIN entered.", true);
          return;
        }
        setStatus("Finishing X connect…");
        await api("/api/integrations/twitter/link-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: data.state, pin }),
        });
        setStatus("X connected — you can Share to X now.");
        void refreshXStatus();
        return;
      }
      setStatus("Finish connecting in the X window…");
      const onMessage = (event) => {
        if (event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== "render3d:oauth-done") return;
        if (!["twitter", "x"].includes(String(event.data.provider || "").toLowerCase())) return;
        window.removeEventListener("message", onMessage);
        window.clearInterval(closeTimer);
        if (event.data.ok) {
          setStatus("X connected — you can Share to X now.");
          void refreshXStatus();
        } else {
          const detail = String(event.data.detail || "").trim();
          setStatus(detail ? `X connect failed: ${detail}` : "X connect failed or was cancelled.", true);
          void refreshXStatus();
        }
      };
      window.addEventListener("message", onMessage);
      const closeTimer = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(closeTimer);
        window.removeEventListener("message", onMessage);
        void refreshXStatus().then((status) => {
          if (status?.connected) setStatus("X connected — you can Share to X now.");
          else setStatus("X window closed without connecting.", true);
        });
      }, 800);
      window.setTimeout(() => {
        window.clearInterval(closeTimer);
        window.removeEventListener("message", onMessage);
      }, 10 * 60 * 1000);
    } catch (err) {
      setStatus(err?.message || "Could not start X connect.", true);
    }
  }

  function captionTitle() {
    const caption = normalizeXShareCaption(modalEl?.querySelector("[data-shot-markup-text]")?.value);
    return caption.replace(/\s+/g, " ").trim() || "Render Studio screenshot";
  }

  function normalizeXShareCaption(text) {
    // Keep a blank line above the attribution so tweets read like:
    //   testing this out
    //
    //   Built in Render Studio https://render3d.app
    let caption = String(text ?? "");
    if (!caption.trim()) return X_SHARE_DEFAULT;
    const hasAttr = /Built in Render Studio/i.test(caption);
    const hasSite = /render3d\.app/i.test(caption);
    if (!hasAttr) {
      caption = `${caption.replace(/[ \t]+$/g, "").replace(/\n+$/g, "")}\n\n${X_SHARE_ATTRIBUTION}`;
    }
    if (!hasSite) {
      if (/Built in Render Studio\s*$/i.test(caption)) {
        caption = caption.replace(/Built in Render Studio\s*$/i, X_SHARE_ATTRIBUTION_LINE);
      } else {
        caption = `${caption.replace(/\n+$/g, "")} ${X_SHARE_SITE}`;
      }
    }
    return caption.slice(0, 270);
  }

  function openXCompose(text) {
    // Same intent flow as viewport-video-record: caption already includes
    // https://render3d.app so Render Studio is auto-linked on X.
    const caption = normalizeXShareCaption(text);
    const params = new URLSearchParams();
    params.set("text", caption);
    const url = `https://twitter.com/intent/tweet?${params.toString()}`;
    const prev = `https://x.com/intent/post?${params.toString()}`;
    try {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) window.open(prev, "_blank", "noopener,noreferrer");
    } catch { /* keep Studio tab */ }
    return caption;
  }

  function triggerPngDownload(blob, filename) {
    triggerTrackedBlobDownload(blob, filename, shotDownloadCreated);
  }

  function dataUrlToBlob(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid image data");
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] || "image/png" });
  }

  function downloadMarkedPng(dataUrl) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `render3d-screenshot-${stamp}.png`;
    try {
      triggerPngDownload(dataUrlToBlob(dataUrl), name);
    } catch {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }

  function canAttachMediaViaShareSheet() {
    // Desktop browsers often expose navigator.share for images and steal the
    // X compose path. Video files usually fail canShare, which is why video
    // share always opens intent/post. Only try the sheet on phone-like UAs.
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
    const ua = String(navigator.userAgent || "");
    const mobile = /Android|iPhone|iPad|iPod/i.test(ua);
    const coarse = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)")?.matches;
    return mobile || coarse;
  }

  async function shareImageViaWebShare(blob, text) {
    if (!blob || !canAttachMediaViaShareSheet()) return false;
    try {
      const file = new File([blob], "render3d-screenshot.png", { type: blob.type || "image/png" });
      const shareText = normalizeXShareCaption(text);
      const payload = {
        files: [file],
        text: shareText,
        title: "Render Studio",
      };
      if (navigator.canShare && !navigator.canShare(payload)) return false;
      await navigator.share(payload);
      return true;
    } catch (err) {
      if (String(err?.name || "") === "AbortError") return true;
      return false;
    }
  }

  async function shareViaComposeAttach(blob, text, dataUrl) {
    // No site can inject a file into x.com's compose box. On phones, the OS
    // share sheet can hand the photo to the X app. On desktop, we save a PNG
    // first, then open compose with the caption so the user can drag it onto X.
    const shared = await shareImageViaWebShare(blob, text);
    if (shared) {
      setStatus("Pick X in the share sheet — the photo goes with the post.");
      return true;
    }
    if (dataUrl) downloadMarkedPng(dataUrl);
    else if (blob) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      triggerPngDownload(blob, `render3d-screenshot-${stamp}.png`);
    }
    openXCompose(text);
    setStatus("X compose is open with your caption. Your PNG just downloaded — drag and drop that image into the X post.");
    return false;
  }

  function setShareBusy(busy) {
    const btn = modalEl?.querySelector("[data-shot-share-run]");
    if (!btn) return;
    btn.disabled = !!busy;
    btn.classList.toggle("is-loading", !!busy);
    btn.setAttribute("aria-busy", busy ? "true" : "false");
    const spinner = btn.querySelector(".viewport-video-share-x-spinner");
    const logo = btn.querySelector("[data-shot-share-logo]");
    if (spinner) {
      if (busy) spinner.removeAttribute("hidden");
      else spinner.setAttribute("hidden", "");
    }
    if (logo) logo.toggleAttribute("hidden", !!busy);
  }

  async function postToX() {
    try {
      setShareBusy(true);
      setStatus("Downloading screenshot…");
      const dataUrl = await compositeMarkedPng();
      const blob = await (await fetch(dataUrl)).blob();
      const caption = normalizeXShareCaption(modalEl?.querySelector("[data-shot-markup-text]")?.value);
      await shareViaComposeAttach(blob, caption, dataUrl);
    } catch (err) {
      setStatus(err?.message || "Could not open X.", true);
    } finally {
      setShareBusy(false);
    }
  }

  async function copyShareLink() {
    try {
      const message = formatSocialShareMessage({ title: captionTitle(), url: X_SHARE_SITE });
      await copyShareText(message);
      setStatus("Link copied.");
    } catch (err) {
      setStatus(err?.message || "Could not copy link.", true);
    }
  }

  async function shareScreenshotToChat(network) {
    const label = network === "discord" ? "Discord" : "Slack";
    try {
      const dataUrl = await compositeMarkedPng();
      downloadMarkedPng(dataUrl);
      const title = captionTitle();
      if (network === "discord") {
        await shareToDiscord(X_SHARE_SITE, { title });
      } else {
        await shareToSlack(X_SHARE_SITE, { title });
      }
      setStatus(`Copied caption + link — ${label} is open. Attach the downloaded PNG.`);
    } catch (err) {
      setStatus(err?.message || `Could not share to ${label}.`, true);
    }
  }

  async function runShareTarget(target) {
    const name = SHARE_TARGETS.includes(target) ? target : "slack";
    if (name === "x") return postToX();
    if (name === "link") return copyShareLink();
    if (name === "discord") return shareScreenshotToChat("discord");
    return shareScreenshotToChat("slack");
  }

  async function open(dataUrl, { modeLabel = "Screenshot", purpose = "screenshot", onApply = null } = {}) {
    if (!dataUrl) throw new Error("No screenshot to edit.");
    ensureModal();
    sourceDataUrl = dataUrl;
    editorPurpose = purpose === "prompt-image" ? "prompt-image" : "screenshot";
    applyHandler = typeof onApply === "function" ? onApply : null;
    strokes = [];
    undoStack = [];
    redoStack = [];
    setTool("pen");
    setStatus("");
    const img = modalEl.querySelector("[data-shot-markup-img]");
    const loaded = await loadImage(dataUrl);
    naturalW = loaded.naturalWidth;
    naturalH = loaded.naturalHeight;
    img.src = dataUrl;
    await new Promise((resolve) => {
      if (img.complete) resolve();
      else img.onload = () => resolve();
    });
    syncSvgSize();
    redraw();
    syncPurposeUi(modeLabel);
    syncShareButton();
    closeShareMenu();
    const caption = modalEl.querySelector("[data-shot-markup-text]");
    if (caption && editorPurpose !== "prompt-image") {
      const current = String(caption.value || "").trim();
      if (!current || current === X_SHARE_ATTRIBUTION || current === `${X_SHARE_ATTRIBUTION}\n${X_SHARE_SITE}`) {
        caption.value = X_SHARE_DEFAULT;
      }
      requestAnimationFrame(() => {
        try {
          caption.focus();
          caption.setSelectionRange(0, 0);
        } catch (_) {}
      });
    }
    modalEl.classList.remove("hidden");
    if (editorPurpose !== "prompt-image") void refreshXStatus();
  }

  function close() {
    modalEl?.classList.add("hidden");
    closeShareMenu();
    hideAskPanel();
    drawing = false;
    currentStroke = null;
    applyHandler = null;
  }

  return { open, close, shareToX: postToX };
}
