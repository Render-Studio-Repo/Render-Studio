/**
 * Post-screenshot markup + share modal.
 * Tools mirror reference-files / PDF markup: pen, highlight, rect, arrow, text, eraser.
 * Download the marked PNG or share to X (when connected).
 */

const MARKUP_COLORS = ["#f0883e", "#58a6ff", "#3fb950", "#ff7b72", "#e6edf3", "#000000"];

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
        <p class="muted small">Annotate like the PDF / reference editor, then download or post to X.</p>
        <div class="screenshot-markup-toolbar ref-markup-toolbar" role="toolbar" aria-label="Markup tools">
          <div class="ref-tool-group" role="group">
            <button type="button" class="dxf-viewer-btn" data-shot-tool="pan" aria-pressed="false" title="Pan / view">Pan</button>
            <button type="button" class="dxf-viewer-btn active" data-shot-tool="pen" aria-pressed="true" title="Pen">Pen</button>
            <button type="button" class="dxf-viewer-btn" data-shot-tool="highlight" aria-pressed="false" title="Highlight">Highlight</button>
            <button type="button" class="dxf-viewer-btn" data-shot-tool="rect" aria-pressed="false" title="Rectangle">Rect</button>
            <button type="button" class="dxf-viewer-btn" data-shot-tool="arrow" aria-pressed="false" title="Arrow">Arrow</button>
            <button type="button" class="dxf-viewer-btn" data-shot-tool="text" aria-pressed="false" title="Text">Text</button>
            <button type="button" class="dxf-viewer-btn" data-shot-tool="eraser" aria-pressed="false" title="Eraser">Eraser</button>
          </div>
          <div class="ref-tool-group ref-tool-group--style">
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
          <div class="ref-tool-group">
            <button type="button" class="dxf-viewer-btn" data-shot-action="undo" title="Undo">Undo</button>
            <button type="button" class="dxf-viewer-btn" data-shot-action="redo" title="Redo">Redo</button>
            <button type="button" class="dxf-viewer-btn" data-shot-action="clear" title="Clear marks">Clear</button>
          </div>
        </div>
        <div class="screenshot-markup-stage">
          <div class="screenshot-markup-stack is-draw" data-shot-markup-stack>
            <img class="screenshot-markup-img" data-shot-markup-img alt="Screenshot" draggable="false" />
            <svg class="screenshot-markup-svg ref-markup-svg" data-shot-markup-svg xmlns="http://www.w3.org/2000/svg"></svg>
          </div>
        </div>
        <label class="screenshot-markup-caption">
          <span>Caption</span>
          <textarea data-shot-markup-text maxlength="270" rows="2" placeholder="loading Render Studio"></textarea>
        </label>
        <p class="screenshot-markup-x-status muted small" data-shot-markup-x-status></p>
        <p class="screenshot-markup-status muted small" data-shot-markup-status role="status"></p>
        <div class="viewport-x-pin-panel hidden" data-shot-x-pin-panel>
          <p class="viewport-x-pin-title">Enter the PIN from X</p>
          <p class="muted small">Authorize Render3D in the X window, then type the PIN shown there.</p>
          <div class="viewport-x-pin-row">
            <input type="text" inputmode="numeric" autocomplete="one-time-code" data-shot-x-pin-input placeholder="PIN code" maxlength="12" />
            <button type="button" class="btn accent" data-shot-x-pin-submit>Connect</button>
            <button type="button" class="btn secondary" data-shot-x-pin-cancel>Cancel</button>
          </div>
        </div>
        <div class="screenshot-markup-actions">
          <button type="button" class="btn secondary" data-shot-markup-download>Download PNG</button>
          <button type="button" class="btn secondary" data-shot-markup-connect-x>Connect X</button>
          <button type="button" class="btn accent" data-shot-markup-post-x>Share to X</button>
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
      if (e.target.closest("[data-shot-markup-download]")) {
        void downloadMarked();
        return;
      }
      if (e.target.closest("[data-shot-markup-connect-x]")) {
        void connectX();
        return;
      }
      if (e.target.closest("[data-shot-markup-post-x]")) {
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

    document.addEventListener("keydown", (e) => {
      if (modalEl?.classList.contains("hidden")) return;
      if (e.key === "Escape") close();
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
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const link = document.createElement("a");
      link.href = url;
      link.download = `render3d-screenshot-${stamp}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setStatus("Screenshot downloaded.");
    } catch (err) {
      setStatus(err?.message || "Download failed.", true);
    }
  }

  async function refreshXStatus() {
    const connectBtn = modalEl?.querySelector("[data-shot-markup-connect-x]");
    const postBtn = modalEl?.querySelector("[data-shot-markup-post-x]");
    if (!api) {
      setXStatus("Sign in to connect X.");
      if (connectBtn) connectBtn.disabled = true;
      if (postBtn) postBtn.disabled = true;
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
        if (postBtn) postBtn.disabled = false;
      } else {
        setXStatus(
          data?.configured
            ? "Connect X to post this screenshot from Render3D."
            : "X posting is not configured on this server yet.",
        );
        if (connectBtn) {
          connectBtn.textContent = "Connect X";
          connectBtn.disabled = !data?.configured;
        }
        if (postBtn) postBtn.disabled = true;
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
        setStatus("Popup blocked — allow popups for Render3D.", true);
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

  function openXCompose(text) {
    // X cannot hyperlink arbitrary words; attach render3d.app via the url=
    // intent param so "loading Render Studio" posts include a live link to the site.
    const caption = String(text || "loading Render Studio").trim().slice(0, 270) || "loading Render Studio";
    const params = new URLSearchParams();
    params.set("text", caption);
    if (!/render3d\.app/i.test(caption)) {
      params.set("url", "https://render3d.app");
    }
    const url = `https://x.com/intent/post?${params.toString()}`;
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) window.location.href = url;
    return caption;
  }

  function downloadMarkedPng(dataUrl) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `render3d-screenshot-${stamp}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function shareImageViaWebShare(blob, text) {
    if (!blob || typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
    try {
      const file = new File([blob], "render3d-screenshot.png", { type: blob.type || "image/png" });
      if (navigator.canShare && !navigator.canShare({ files: [file], text })) return false;
      const shareText = text || "loading Render Studio";
      const payload = {
        files: [file],
        text: /render3d\.app/i.test(shareText) ? shareText : `${shareText}\nhttps://render3d.app`,
        title: "loading Render Studio",
      };
      if (navigator.canShare && !navigator.canShare(payload)) return false;
      await navigator.share(payload);
      return true;
    } catch (err) {
      if (String(err?.name || "") === "AbortError") return true;
      return false;
    }
  }

  async function postToX() {
    try {
      setStatus("Opening X compose…");
      const dataUrl = await compositeMarkedPng();
      const blob = await (await fetch(dataUrl)).blob();
      const caption = String(modalEl?.querySelector("[data-shot-markup-text]")?.value || "loading Render Studio").trim() || "loading Render Studio";

      const shared = await shareImageViaWebShare(blob, caption);
      if (shared) {
        setStatus("Shared via your device share sheet.");
        return;
      }

      openXCompose(caption);
      downloadMarkedPng(dataUrl);
      setStatus("Opened X compose with your caption — attach the downloaded PNG to the post.");
    } catch (err) {
      setStatus(err?.message || "Could not open X.", true);
    }
  }

  async function open(dataUrl, { modeLabel = "Screenshot" } = {}) {
    if (!dataUrl) throw new Error("No screenshot to edit.");
    ensureModal();
    sourceDataUrl = dataUrl;
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
    const eyebrow = modalEl.querySelector(".screenshot-markup-eyebrow");
    if (eyebrow) eyebrow.textContent = modeLabel;
    const caption = modalEl.querySelector("[data-shot-markup-text]");
    if (caption && !caption.value.trim()) caption.value = "loading Render Studio";
    modalEl.classList.remove("hidden");
    void refreshXStatus();
  }

  function close() {
    modalEl?.classList.add("hidden");
    drawing = false;
    currentStroke = null;
  }

  return { open, close };
}
