/**
 * Desktop floating ZED top camera tile — same Allow-camera UX as wrist popups.
 */

export const ZED_CAM_STATUS_PATH = "/api/robotics/zed/status";
export const ZED_CAM_PUBLISH_PATH = "/api/robotics/zed/publish";
export const ZED_CAM_PERMISSION_PATH = "/api/robotics/zed/request-permission";
export const ZED_CAM_JPEG_PATH = "/api/robotics/zed.jpg";
export const TOP_CAM_WALL_STATUS_PATH = "/api/robotics/camera-wall/status";
export const TOP_CAM_WALL_JPEG_PATH = "/api/robotics/camera-wall/zed.jpg";
export const ZED_CAPTURE_APP = "ZEDCaptureDiagnostics";
export const ZED_POLL_MS = 650;

export function zedPermissionHelper(app = ZED_CAPTURE_APP) {
  return `Check the Mac for a Camera prompt for ${app}.`;
}

export function shouldShowZedAllow({ live = false, usb = false, permission = "", publish = false } = {}) {
  if (live) return false;
  if (!usb) return false;
  const perm = String(permission || "").toLowerCase();
  if (perm === "authorized") return false;
  if (publish && perm !== "denied" && perm !== "restricted") return false;
  return true;
}

export function shouldRequestZedPermission(status = {}) {
  if (status?.source === "raspberry-pi") return false;
  if (!status?.usb) return false;
  if (status.live || status.permission === "authorized") return false;
  return true;
}

export function normalizeTopCameraStatus(wall = {}, local = {}) {
  const remote = wall?.cameras?.zed;
  if (remote?.live) {
    return {
      ...remote,
      usb: true,
      publish: true,
      permission: "authorized",
      source: "raspberry-pi",
      model: remote.label || "Top camera",
      framePath: TOP_CAM_WALL_JPEG_PATH,
    };
  }
  return {
    ...local,
    source: local?.source || "mac",
    framePath: ZED_CAM_JPEG_PATH,
  };
}

const ZED_POPUP_MIN = { w: 200, h: 120 };
const ZED_POPUP_MAX = { w: 640, h: 480 };
const ZED_POPUP_LAYOUT_KEY = "render3d:zedCamPopup:v1";

function clampZedRect(rect, bounds = {}) {
  const minW = bounds.minW ?? ZED_POPUP_MIN.w;
  const minH = bounds.minH ?? ZED_POPUP_MIN.h;
  const maxW = bounds.maxW ?? ZED_POPUP_MAX.w;
  const maxH = bounds.maxH ?? ZED_POPUP_MAX.h;
  const vw = bounds.vw ?? globalThis.innerWidth ?? 1280;
  const vh = bounds.vh ?? globalThis.innerHeight ?? 720;
  const w = Math.min(maxW, Math.max(minW, rect.w));
  const h = Math.min(maxH, Math.max(minH, rect.h));
  const x = Math.min(Math.max(0, rect.x), Math.max(0, vw - w));
  const y = Math.min(Math.max(0, rect.y), Math.max(0, vh - h));
  return { x, y, w, h };
}

function loadZedLayout() {
  try {
    const raw = globalThis.localStorage?.getItem?.(ZED_POPUP_LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return clampZedRect({
      x: Number(parsed.x) || 0,
      y: Number(parsed.y) || 52,
      w: Number(parsed.w) || 320,
      h: Number(parsed.h) || 180,
    });
  } catch {
    return null;
  }
}

function saveZedLayout(rect) {
  try {
    globalThis.localStorage?.setItem?.(ZED_POPUP_LAYOUT_KEY, JSON.stringify(rect));
  } catch { /* ignore */ }
}

function applyZedRect(panel, rect) {
  if (!panel || !rect) return;
  panel.style.left = `${rect.x}px`;
  panel.style.top = `${rect.y}px`;
  panel.style.width = `${rect.w}px`;
  panel.style.height = `${rect.h}px`;
  panel.style.transform = "none";
}

function bindZedPanelChrome(panel, getRect, setRect) {
  const title = panel?.querySelector?.(".wrist-cam-popup-titlebar");
  const handle = panel?.querySelector?.("[data-zed-resize]");
  const win = globalThis;
  let drag = null;

  function finish() {
    drag = null;
    panel?.classList?.remove("is-dragging");
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault?.();
    const bounds = {
      vw: win.innerWidth,
      vh: win.innerHeight,
      minW: ZED_POPUP_MIN.w,
      minH: ZED_POPUP_MIN.h,
      maxW: Math.min(ZED_POPUP_MAX.w, win.innerWidth - 8),
      maxH: Math.min(ZED_POPUP_MAX.h, win.innerHeight - 8),
    };
    const base = getRect();
    const next = drag.kind === "move"
      ? clampZedRect({
        ...base,
        x: drag.x + (e.clientX - drag.sx),
        y: drag.y + (e.clientY - drag.sy),
      }, bounds)
      : clampZedRect({
        ...base,
        w: drag.w + (e.clientX - drag.sx),
        h: drag.h + (e.clientY - drag.sy),
      }, bounds);
    setRect(next);
    applyZedRect(panel, next);
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    saveZedLayout(getRect());
    finish();
    win.removeEventListener("pointermove", onMove);
    win.removeEventListener("pointerup", onUp);
    win.removeEventListener("pointercancel", onUp);
  }

  function start(kind, e) {
    if (e.button != null && e.button !== 0) return;
    if (e.target?.closest?.(".wrist-cam-popup-close, [data-zed-allow]")) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    const rect = getRect();
    drag = {
      kind,
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
    };
    panel.classList.add("is-dragging");
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    win.addEventListener("pointermove", onMove);
    win.addEventListener("pointerup", onUp);
    win.addEventListener("pointercancel", onUp);
  }

  title?.addEventListener("pointerdown", (e) => start("move", e));
  handle?.addEventListener("pointerdown", (e) => start("resize", e));
}

function el(doc, tag, attrs = {}) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  return node;
}

export function createZedCamPopup({
  document: doc = typeof document !== "undefined" ? document : null,
  fetchFn = null,
} = {}) {
  let host = null;
  let panel = null;
  let open = false;
  let pollTimer = 0;
  let lastStatus = {};
  let liveMiss = 0;
  let layout = loadZedLayout() || clampZedRect({
    x: Math.max(8, ((globalThis.innerWidth || 1280) - 320) / 2),
    y: 52,
    w: 320,
    h: 180,
  });

  function fetcher() {
    return fetchFn || globalThis.fetch?.bind(globalThis);
  }

  async function fetchStatus() {
    let wall = {};
    try {
      const wallRes = await fetcher()?.(TOP_CAM_WALL_STATUS_PATH, { cache: "no-store", credentials: "include" });
      if (wallRes?.ok) wall = await wallRes.json();
    } catch { /* local ZED remains a fallback */ }
    if (wall?.cameras?.zed?.live) return normalizeTopCameraStatus(wall);
    const res = await fetcher()?.(ZED_CAM_STATUS_PATH, { cache: "no-store", credentials: "include" });
    if (!res?.ok) throw new Error("Top camera status unavailable");
    return normalizeTopCameraStatus(wall, await res.json());
  }

  async function ensurePublish() {
    if (lastStatus?.source === "raspberry-pi") return;
    try {
      await fetcher()?.(ZED_CAM_PUBLISH_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: true }),
        credentials: "include",
      });
    } catch { /* LAN / signed-out ok */ }
  }

  function setAllowVisible(on, helper = zedPermissionHelper()) {
    const wrap = panel?.querySelector?.("[data-zed-allow-wrap]");
    const btn = panel?.querySelector?.("[data-zed-allow]");
    const hint = panel?.querySelector?.("[data-zed-allow-hint]");
    if (hint) hint.textContent = helper;
    if (btn) {
      btn.hidden = !on;
      btn.classList.toggle("hidden", !on);
    }
    if (wrap) {
      wrap.hidden = !on;
      wrap.classList.toggle("hidden", !on);
    }
  }

  function setLive(meta = "live") {
    const empty = panel?.querySelector?.("[data-zed-empty]");
    const img = panel?.querySelector?.("[data-zed-img]");
    const metaEl = panel?.querySelector?.("[data-zed-meta]");
    empty?.classList.add("hidden");
    img?.classList.remove("hidden");
    if (metaEl) metaEl.textContent = meta;
    panel?.classList.remove("is-empty");
    panel?.classList.add("is-live");
    panel?.setAttribute("data-zed-status", "connected");
    setAllowVisible(false);
    liveMiss = 0;
  }

  function setEmpty(reason = "no stream", { showAllow = false, helper = "" } = {}) {
    const empty = panel?.querySelector?.("[data-zed-empty]");
    const img = panel?.querySelector?.("[data-zed-img]");
    const msg = panel?.querySelector?.("[data-zed-empty-msg]");
    img?.classList.add("hidden");
    empty?.classList.remove("hidden");
    if (msg) msg.textContent = reason;
    if (panel) {
      panel.classList.add("is-empty");
      panel.classList.remove("is-live");
      panel.setAttribute("data-zed-status", "no-stream");
    }
    setAllowVisible(showAllow, helper || zedPermissionHelper());
  }

  async function pollFrame() {
    if (!panel || !open) return;
    try {
      lastStatus = await fetchStatus();
    } catch {
      setEmpty("Top camera status unavailable");
      return;
    }
    const serial = lastStatus.serial ? `sn ${lastStatus.serial}` : "";
    const source = lastStatus.source === "raspberry-pi" ? "Pi" : "Mac";
    const meta = lastStatus.live ? `live · ${source}${serial ? ` · ${serial}` : ""}` : `${lastStatus.model || "Top camera"} · ${serial}`.trim();
    const metaEl = panel.querySelector("[data-zed-meta]");
    if (metaEl) metaEl.textContent = meta;
    const showAllow = shouldShowZedAllow({
      live: !!lastStatus.live,
      usb: !!lastStatus.usb,
      permission: lastStatus.permission,
      publish: !!lastStatus.publish,
    });
    const img = panel.querySelector("[data-zed-img]");
    if (img) {
      img.src = `${lastStatus.framePath || ZED_CAM_JPEG_PATH}?t=${Date.now()}`;
    }
    const onLoad = () => {
      img?.removeEventListener("load", onLoad);
      img?.removeEventListener("error", onError);
      setLive(meta);
    };
    const onError = () => {
      img?.removeEventListener("load", onLoad);
      img?.removeEventListener("error", onError);
      liveMiss += 1;
      const reason = lastStatus.reason
        || (showAllow ? "Allow top camera" : "No top-camera feed");
      setEmpty(reason, {
        showAllow,
        helper: lastStatus.permission === "denied"
          ? "Enable ZEDCaptureDiagnostics in System Settings → Privacy → Camera."
          : zedPermissionHelper(),
      });
    };
    img?.addEventListener("load", onLoad);
    img?.addEventListener("error", onError);
  }

  function buildPanel() {
    const label = "TOP CAMERA";
    panel = el(doc, "section", {
      className: "wrist-cam-popup wrist-cam-popup--zed",
      "data-zed-popup": "1",
      "aria-label": "Robot top camera",
    });
    const title = el(doc, "div", { className: "wrist-cam-popup-titlebar" });
    const titles = el(doc, "div", { className: "wrist-cam-popup-titles" });
    titles.appendChild(el(doc, "strong", { "data-zed-title": "1", text: label }));
    titles.appendChild(el(doc, "span", {
      className: "wrist-cam-popup-meta",
      "data-zed-meta": "1",
      text: "no stream",
    }));
    const close = el(doc, "button", {
      type: "button",
      className: "wrist-cam-popup-close",
      "aria-label": "Close top camera",
      text: "×",
    });
    close.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hide();
    });
    title.appendChild(titles);
    title.appendChild(close);
    const body = el(doc, "div", { className: "wrist-cam-popup-body" });
    const img = el(doc, "img", {
      className: "wrist-cam-popup-video hidden",
      "data-zed-img": "1",
      alt: "Robot top camera",
    });
    const empty = el(doc, "div", {
      className: "wrist-cam-popup-empty",
      "data-zed-empty": "1",
    });
    empty.appendChild(el(doc, "p", {
      className: "wrist-cam-popup-empty-msg",
      "data-zed-empty-msg": "1",
      text: "Starting top camera",
    }));
    const allowWrap = el(doc, "div", {
      className: "wrist-cam-popup-allow-wrap",
      "data-zed-allow-wrap": "1",
    });
    const allow = el(doc, "button", {
      type: "button",
      className: "wrist-cam-popup-allow",
      "data-zed-allow": "1",
      text: "Allow camera",
    });
    const hint = el(doc, "p", {
      className: "wrist-cam-popup-allow-hint",
      "data-zed-allow-hint": "1",
      text: zedPermissionHelper(),
    });
    allowWrap.appendChild(allow);
    allowWrap.appendChild(hint);
    empty.appendChild(allowWrap);
    body.appendChild(img);
    body.appendChild(empty);
    allow.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (allow.disabled) return;
      allow.disabled = true;
      allow.textContent = "Allowing…";
      try {
        const status = lastStatus?.usb ? lastStatus : await fetchStatus();
        if (!shouldRequestZedPermission(status)) {
          await ensurePublish();
          await pollFrame();
          return;
        }
        const ctl = new AbortController();
        const timer = globalThis.setTimeout(() => ctl.abort(), 4500);
        try {
          await fetcher()?.(ZED_CAM_PERMISSION_PATH, {
            method: "POST",
            credentials: "include",
            signal: ctl.signal,
          });
        } finally {
          globalThis.clearTimeout(timer);
        }
        await ensurePublish();
        await pollFrame();
      } catch {
        setEmpty("Open System Settings → Camera → ZEDCaptureDiagnostics ON", { showAllow: true });
      } finally {
        allow.disabled = false;
        allow.textContent = "Allow camera";
      }
    });
    const resize = el(doc, "button", {
      type: "button",
      className: "wrist-cam-popup-resize",
      "data-zed-resize": "1",
      "aria-label": "Resize top camera window",
    });
    panel.appendChild(title);
    panel.appendChild(body);
    panel.appendChild(resize);
    bindZedPanelChrome(panel, () => layout, (next) => { layout = next; });
    applyZedRect(panel, layout);
    return panel;
  }

  function mount() {
    if (!doc?.body) return false;
    host = el(doc, "div", {
      id: "zed-cam-popup-host",
      className: "wrist-cam-popups",
      "aria-label": "Top camera",
    });
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "22155";
    host.style.pointerEvents = "none";
    panel = buildPanel();
    host.appendChild(panel);
    doc.body.appendChild(host);
    open = true;
    return true;
  }

  async function show() {
    if (!open || !host?.isConnected) mount();
    await ensurePublish();
    setEmpty("Starting top camera…", { showAllow: false });
    await pollFrame();
    if (!pollTimer) {
      pollTimer = globalThis.setInterval(() => { void pollFrame(); }, ZED_POLL_MS);
    }
    return true;
  }

  function hide() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = 0;
    }
    try { host?.remove?.(); } catch { /* ignore */ }
    host = null;
    panel = null;
    open = false;
  }

  return { show, hide, isOpen: () => open, pollFrame, getStatus: () => ({ ...lastStatus }) };
}
