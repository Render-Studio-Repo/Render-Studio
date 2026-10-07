/** Shared close / grip-drag / corner-resize chrome for studio overlay windows. Token: jointwin1 */

export const JOINT_WIN1_CACHE = "jointwin1";
export const JOINTS_WINDOW_BOUNDS_KEY = "render3d:jointsWindowBounds:v1";
export const GRID_WINDOW_BOUNDS_KEY = "render3d:gridWindowBounds:v1";

export const DEFAULT_JOINTS_BOUNDS = { x: 24, y: 160, w: 370, h: 520 };
export const DEFAULT_GRID_BOUNDS = { x: 24, y: 80, w: 280, h: 360 };

const HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const HANDLE_EDGES = {
  n: { t: 1, b: 0, l: 0, r: 0 },
  s: { t: 0, b: 1, l: 0, r: 0 },
  e: { t: 0, b: 0, l: 0, r: 1 },
  w: { t: 0, b: 0, l: 1, r: 0 },
  ne: { t: 1, b: 0, l: 0, r: 1 },
  nw: { t: 1, b: 0, l: 1, r: 0 },
  se: { t: 0, b: 1, l: 0, r: 1 },
  sw: { t: 0, b: 1, l: 1, r: 0 },
};

const attached = typeof WeakMap === "function" ? new WeakMap() : null;

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function viewportSize() {
  if (typeof window === "undefined") return { width: 1280, height: 800 };
  const vv = window.visualViewport;
  return {
    width: Math.max(1, Number(vv?.width || window.innerWidth || 1280)),
    height: Math.max(1, Number(vv?.height || window.innerHeight || 800)),
  };
}

export function clampFloatBounds(bounds, viewport = viewportSize(), { minW = 240, minH = 160 } = {}) {
  const maxW = Math.max(minW, viewport.width - 16);
  const maxH = Math.max(minH, viewport.height - 16);
  const w = Math.min(maxW, Math.max(minW, Number(bounds?.w) || minW));
  const h = Math.min(maxH, Math.max(minH, Number(bounds?.h) || minH));
  const x = Math.min(Math.max(Number(bounds?.x) || 8, 8), Math.max(8, viewport.width - w - 8));
  const y = Math.min(Math.max(Number(bounds?.y) || 8, 8), Math.max(8, viewport.height - h - 8));
  return { x, y, w, h };
}

export function defaultJointsBounds(viewport = viewportSize()) {
  const w = 370;
  const h = Math.min(560, Math.max(280, Math.round(viewport.height * 0.62)));
  return clampFloatBounds(
    { x: viewport.width - w - 24, y: 160, w, h },
    viewport,
    { minW: 280, minH: 220 },
  );
}

export function readFloatBounds(key, fallback = DEFAULT_JOINTS_BOUNDS) {
  try {
    const parsed = JSON.parse(storage()?.getItem(key) || "null");
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    const w = Number(parsed?.w);
    const h = Number(parsed?.h);
    if (![x, y, w, h].every(Number.isFinite)) return { ...fallback };
    return { x, y, w, h };
  } catch {
    return { ...fallback };
  }
}

export function hasSavedFloatBounds(key) {
  try {
    const parsed = JSON.parse(storage()?.getItem(key) || "null");
    return [parsed?.x, parsed?.y, parsed?.w, parsed?.h].every((n) => Number.isFinite(Number(n)));
  } catch {
    return false;
  }
}

export function persistFloatBounds(key, bounds, opts = {}) {
  const next = clampFloatBounds(bounds, viewportSize(), opts);
  try { storage()?.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

function resolveDefault(defaultBounds, fallback) {
  if (typeof defaultBounds === "function") {
    try { return defaultBounds() || fallback; } catch { return fallback; }
  }
  return defaultBounds || fallback;
}

function applyBox(el, box) {
  el.style.position = "fixed";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;
  el.style.maxWidth = "none";
  el.style.maxHeight = "none";
  el.style.transform = "none";
}

function currentBox(el, fallback) {
  const rect = el.getBoundingClientRect?.();
  return {
    x: parseFloat(el.style.left) || rect?.left || fallback.x,
    y: parseFloat(el.style.top) || rect?.top || fallback.y,
    w: parseFloat(el.style.width) || el.offsetWidth || fallback.w,
    h: parseFloat(el.style.height) || el.offsetHeight || fallback.h,
  };
}

function ensureChrome(el, { title, closeTitle, closeLabel }) {
  let chrome = el.querySelector(":scope > .studio-float-chrome");
  if (chrome) return chrome;
  chrome = document.createElement("header");
  chrome.className = "studio-float-chrome";
  chrome.dataset.floatChrome = "1";

  const grip = document.createElement("button");
  grip.type = "button";
  grip.className = "floating-panel-grip studio-float-grip";
  grip.dataset.floatGrip = "1";
  grip.title = "Drag to move";
  grip.setAttribute("aria-label", "Drag panel");
  grip.textContent = "⠿";

  const label = document.createElement("strong");
  label.className = "studio-float-title";
  label.dataset.floatTitle = "1";
  label.textContent = title || "";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "object-iteration-close studio-float-close";
  close.dataset.floatClose = "1";
  close.title = closeTitle || "Close";
  close.setAttribute("aria-label", closeLabel || closeTitle || "Close");
  close.textContent = "✕";

  chrome.append(grip, label, close);
  el.insertBefore(chrome, el.firstChild);
  return chrome;
}

function ensureBody(el) {
  let body = el.querySelector(":scope > .studio-float-body");
  if (body) return body;
  body = document.createElement("div");
  body.className = "studio-float-body";
  body.dataset.floatBody = "1";
  const skip = new Set(["studio-float-chrome", "studio-float-handle"]);
  const moving = [];
  for (const child of [...el.childNodes]) {
    if (child.nodeType === 1 && skip.has(child.classList?.[0])) continue;
    if (child.nodeType === 1 && child.classList?.contains("studio-float-chrome")) continue;
    if (child.nodeType === 1 && child.classList?.contains("studio-float-handle")) continue;
    moving.push(child);
  }
  for (const child of moving) body.appendChild(child);
  el.appendChild(body);
  return body;
}

function ensureHandles(el) {
  for (const dir of HANDLES) {
    if (el.querySelector(`:scope > .studio-float-handle[data-float-handle="${dir}"]`)) continue;
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `studio-float-handle studio-float-handle--${dir}`;
    handle.dataset.floatHandle = dir;
    handle.setAttribute("aria-label", `Resize ${dir}`);
    handle.tabIndex = -1;
    el.appendChild(handle);
  }
}

export function attachStudioFloatWindow(el, opts = {}) {
  if (!el || typeof document === "undefined") return null;
  const existing = attached?.get(el);
  if (existing) {
    if (opts.title) existing.setTitle(opts.title);
    if (opts.onClose) existing.onClose = opts.onClose;
    return existing;
  }

  const minW = Number(opts.minW) || 240;
  const minH = Number(opts.minH) || 160;
  const fallback = resolveDefault(opts.defaultBounds, DEFAULT_JOINTS_BOUNDS);
  const key = opts.storageKey || "";
  const saved = key && hasSavedFloatBounds(key)
    ? readFloatBounds(key, fallback)
    : fallback;

  el.classList.add("studio-float-window");
  el.dataset.studioFloat = "1";
  if (opts.reparentTo && el.parentElement !== opts.reparentTo) {
    opts.reparentTo.appendChild(el);
  }

  const chrome = ensureChrome(el, opts);
  const body = ensureBody(el);
  ensureHandles(el);

  const clampOpts = { minW, minH };
  let box = clampFloatBounds(saved, viewportSize(), clampOpts);
  applyBox(el, box);

  const api = {
    body,
    onClose: opts.onClose || null,
    setTitle(text) {
      const label = el.querySelector("[data-float-title]");
      if (label) label.textContent = text || "";
    },
    currentBounds() {
      box = currentBox(el, box);
      return { ...box };
    },
    applyBounds(next) {
      box = clampFloatBounds(next || box, viewportSize(), clampOpts);
      applyBox(el, box);
      return box;
    },
    save() {
      if (!key) return box;
      box = persistFloatBounds(key, currentBox(el, box), clampOpts);
      applyBox(el, box);
      return box;
    },
    destroy() {
      window.removeEventListener("resize", onWinResize);
      attached?.delete(el);
    },
  };

  function onWinResize() {
    api.applyBounds(currentBox(el, box));
  }

  const closeBtn = chrome.querySelector("[data-float-close]");
  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    api.save();
    api.onClose?.();
  });

  let drag = null;

  function startDrag(e, kind, dir = "") {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const live = currentBox(el, box);
    drag = {
      kind,
      dir,
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      ...live,
    };
    el.classList.add("studio-float-window--dragging");
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (drag.kind === "move") {
      api.applyBounds({ x: drag.x + dx, y: drag.y + dy, w: drag.w, h: drag.h });
      return;
    }
    const edge = HANDLE_EDGES[drag.dir] || HANDLE_EDGES.se;
    let x = drag.x;
    let y = drag.y;
    let w = drag.w;
    let h = drag.h;
    if (edge.l) {
      x = drag.x + dx;
      w = drag.w - dx;
    } else if (edge.r) {
      w = drag.w + dx;
    }
    if (edge.t) {
      y = drag.y + dy;
      h = drag.h - dy;
    } else if (edge.b) {
      h = drag.h + dy;
    }
    api.applyBounds({ x, y, w, h });
  }

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    el.classList.remove("studio-float-window--dragging");
    drag = null;
    api.save();
  }

  chrome.addEventListener("pointerdown", (e) => {
    if (e.target.closest?.("[data-float-close]")) return;
    startDrag(e, "move");
  });
  chrome.addEventListener("pointermove", moveDrag);
  chrome.addEventListener("pointerup", endDrag);
  chrome.addEventListener("pointercancel", endDrag);

  for (const handle of el.querySelectorAll(":scope > .studio-float-handle")) {
    handle.addEventListener("pointerdown", (e) => startDrag(e, "resize", handle.dataset.floatHandle));
    handle.addEventListener("pointermove", moveDrag);
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.addEventListener("contextmenu", (e) => {
    if (e.target.closest?.("[data-float-grip],[data-float-handle],[data-float-chrome]")) e.preventDefault();
  });

  window.addEventListener("resize", onWinResize);
  attached?.set(el, api);
  if (opts.title) api.setTitle(opts.title);
  return api;
}
