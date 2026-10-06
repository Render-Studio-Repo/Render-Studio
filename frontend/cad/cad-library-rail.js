/** Compact CAD logo rail — popup browse + dock-to-viewport tabs. */

export const CAD_LIBRARIES = [
  {
    id: "onshape",
    sectionId: "onshape-library-section",
    label: "Onshape",
    logo: "/cad/onshape-logo.png?v=20260617-small",
    openEvent: "render3d:open-onshape-library",
  },
  {
    id: "fusion",
    sectionId: "fusion-library-section",
    label: "Fusion 360",
    logo: "/cad/fusion-360-logo.png?v=20260629",
    openEvent: "render3d:open-fusion-library",
  },
];

/** Normalize chip/tab ids so Onshape hits the same dock path as Fusion. */
export function resolveCadLibraryId(cadId) {
  const id = String(cadId || "").trim().toLowerCase();
  return CAD_LIBRARIES.some((lib) => lib.id === id) ? id : "";
}

/** Shared right-click actions for Fusion and Onshape. */
export function cadDockMenuActions(attached) {
  return attached
    ? [
        { id: "move", label: "Move tab" },
        { id: "detach", label: "Detach from viewport" },
      ]
    : [{ id: "attach", label: "Attach to side of viewport" }];
}

/** Attach if needed, then arm Move tab. Used by Fusion and Onshape. */
export function armCadLibraryMove(state = {}, cadId) {
  const id = resolveCadLibraryId(cadId);
  if (!id) return { state, movingCadId: "" };
  const row = state[id] && typeof state[id] === "object" ? state[id] : defaultCadDockState();
  state[id] = { ...defaultCadDockState(), ...row, attached: true };
  return { state, movingCadId: id };
}

export function shouldArmCadDockDrag(movingCadId, cadId, button = 0) {
  return Number(button) === 0 && !!movingCadId && movingCadId === cadId;
}

/** Above the CAD popup (auth-modal 10000 / popup 10050) so Move tab is clickable. */
export const CAD_DOCK_MENU_Z = 12060;

export const LS_CAD_DOCK = "render3d:cadLibraryDock:v1";
export const CAD_DOCK_EDGES = ["left", "right", "top", "bottom"];
export const CAD_DOCK_SLOT = 52;
export const CAD_DOCK_TAB_SIZE = 44;
/** Desktop explorer width so hub/settings sit left and models/files sit right. */
export const CAD_DOCK_EXPLORER_PREFERRED_WIDTH = 780;
/** Below this, panes stack instead of sitting side-by-side (never hide models). */
export const CAD_DOCK_EXPLORER_TWO_PANE_MIN = 560;
export const CAD_EXPLORER_TWO_PANE_CLASS = "cad-library-explorer--two-pane";
export const CAD_EXPLORER_MODELS_PANE_DISPLAY = "block";

/** Size the Fusion/Onshape explorer for a two-pane gallery. */
export function cadExplorerLayout(viewWidth = 1100, { pad = 24 } = {}) {
  const vw = Number(viewWidth) > 0 ? Number(viewWidth) : 1100;
  const room = Math.max(280, vw - (Number(pad) > 0 ? Number(pad) : 24));
  const width = Math.round(Math.min(CAD_DOCK_EXPLORER_PREFERRED_WIDTH, room));
  const twoPane = width >= CAD_DOCK_EXPLORER_TWO_PANE_MIN;
  return {
    width,
    twoPane,
    modelsPaneDisplay: CAD_EXPLORER_MODELS_PANE_DISPLAY,
    modelsPaneHidden: false,
  };
}

export function applyCadExplorerChrome(el, viewWidth) {
  const layout = cadExplorerLayout(viewWidth);
  if (!el) return layout;
  el.classList.toggle(CAD_EXPLORER_TWO_PANE_CLASS, layout.twoPane);
  el.style.width = `${layout.width}px`;
  el.style.maxWidth = "calc(100% - 24px)";
  return layout;
}
export const CAD_DOCK_SLOT_GAP = 4;
export const BROWSER_TAB_FALLBACK = { edge: "left", start: 14, size: 112 };

export function normalizeCadEdge(edge) {
  const value = String(edge || "left").toLowerCase();
  return CAD_DOCK_EDGES.includes(value) ? value : "left";
}

export function defaultCadDockState() {
  return {
    attached: false,
    expanded: false,
    edge: "left",
    x: 0,
    y: 96,
    order: 1,
  };
}

export function attachedDockIds(state = {}, edge = "left") {
  const want = normalizeCadEdge(edge);
  return CAD_LIBRARIES
    .filter((lib) => state[lib.id]?.attached && normalizeCadEdge(state[lib.id].edge) === want)
    .sort((a, b) => {
      const ao = Number(state[a.id]?.order);
      const bo = Number(state[b.id]?.order);
      return (Number.isFinite(ao) ? ao : 1) - (Number.isFinite(bo) ? bo : 1) || a.id.localeCompare(b.id);
    })
    .map((lib) => lib.id);
}

export function cadDockTabOffset(row = {}) {
  const edge = normalizeCadEdge(row.edge);
  const along = edge === "top" || edge === "bottom" ? Number(row.x) : Number(row.y);
  if (Number.isFinite(along) && along > 0) return along;
  const order = Number(row.order);
  const slot = Number.isFinite(order) ? order : 1;
  const base = edge === "top" || edge === "bottom" ? 72 : 14 + BROWSER_TAB_FALLBACK.size + CAD_DOCK_SLOT_GAP;
  return base + slot * CAD_DOCK_SLOT;
}

export function rangesOverlap(aStart, aSize, bStart, bSize, gap = CAD_DOCK_SLOT_GAP) {
  const a0 = Number(aStart) || 0;
  const a1 = a0 + Math.max(0, Number(aSize) || 0);
  const b0 = Number(bStart) || 0;
  const b1 = b0 + Math.max(0, Number(bSize) || 0);
  return a0 < b1 + gap && b0 < a1 + gap;
}

export function snapAlongEdge(value, { min = 8, max = 4000, slot = CAD_DOCK_SLOT } = {}) {
  const raw = Number(value);
  const n = Number.isFinite(raw) ? raw : min;
  const snapped = Math.round((n - min) / slot) * slot + min;
  return Math.min(Math.max(snapped, min), Math.max(min, max));
}

export function nextFreeDockAlong({
  preferred,
  reserved = [],
  size = CAD_DOCK_TAB_SIZE,
  slot = CAD_DOCK_SLOT,
  min = 8,
  max = 4000,
} = {}) {
  let pos = snapAlongEdge(preferred, { min, max, slot });
  const blocks = [...reserved]
    .map((row) => ({ start: Number(row.start) || 0, size: Math.max(size, Number(row.size) || size) }))
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < 80; i += 1) {
    const hit = blocks.find((block) => rangesOverlap(pos, size, block.start, block.size));
    if (!hit) return pos;
    const clear = hit.start + hit.size + CAD_DOCK_SLOT_GAP;
    let next = snapAlongEdge(clear, { min, max, slot });
    if (next < clear) next += slot;
    pos = Math.min(next, max);
    if (pos >= max) return max;
  }
  return pos;
}

export const CAD_HUD_SELECTORS = [
  "#btn-viewport-browser-expand",
  ".viewport-view-bar",
  "#btn-xr-vr",
  "#btn-video-record",
  "#btn-viewport-capture",
  "#btn-screenshot-viewport",
  ".viewport-hud-stack",
  "#ribbon-container",
  ".ribbon-bar",
  ".viewport-grid-bar",
  "#doc-tab-bar",
];

export function fallbackHudSlots(spanY = 720, spanX = 1100) {
  const height = Number(spanY) > 0 ? Number(spanY) : 720;
  const width = Number(spanX) > 0 ? Number(spanX) : 1100;
  return [
    { ...BROWSER_TAB_FALLBACK },
    { edge: "left", start: Math.max(8, height - 132), size: 124, id: "hud-ar-camera" },
    { edge: "bottom", start: 8, size: 220, id: "hud-view-bar" },
    { edge: "top", start: 8, size: Math.min(width, 640), id: "hud-ribbon" },
  ];
}

export function rectsToEdgeSlots(obstacle, viewport, id = "hud") {
  if (!obstacle || !viewport) return [];
  const left = Math.max(Number(obstacle.left) || 0, Number(viewport.left) || 0);
  const top = Math.max(Number(obstacle.top) || 0, Number(viewport.top) || 0);
  const right = Math.min(
    (Number(obstacle.left) || 0) + (Number(obstacle.width) || 0),
    (Number(viewport.left) || 0) + (Number(viewport.width) || 0),
  );
  const bottom = Math.min(
    (Number(obstacle.top) || 0) + (Number(obstacle.height) || 0),
    (Number(viewport.top) || 0) + (Number(viewport.height) || 0),
  );
  if (right - left < 4 || bottom - top < 4) return [];
  const vx = Number(viewport.left) || 0;
  const vy = Number(viewport.top) || 0;
  const vw = Number(viewport.width) || 0;
  const vh = Number(viewport.height) || 0;
  const strip = 72;
  const slots = [];
  if (left <= vx + strip) {
    slots.push({ edge: "left", start: top - vy, size: bottom - top, id: `${id}-left` });
  }
  if (right >= vx + vw - strip) {
    slots.push({ edge: "right", start: top - vy, size: bottom - top, id: `${id}-right` });
  }
  if (top <= vy + strip) {
    slots.push({ edge: "top", start: left - vx, size: right - left, id: `${id}-top` });
  }
  if (bottom >= vy + vh - strip) {
    slots.push({ edge: "bottom", start: left - vx, size: right - left, id: `${id}-bottom` });
  }
  return slots;
}

export function collectReservedHudSlots(viewportEl, queryAll = (sel) => [...(document.querySelectorAll?.(sel) || [])]) {
  const viewport = viewportEl?.getBoundingClientRect?.();
  if (!viewport?.width) {
    return fallbackHudSlots();
  }
  const slots = [...reservedBrowserSlots(typeof document !== "undefined" ? document.getElementById?.("btn-viewport-browser-expand") : null)];
  for (const selector of CAD_HUD_SELECTORS) {
    for (const el of queryAll(selector)) {
      if (!el || el.hidden || el.classList?.contains?.("hidden")) continue;
      const rect = el.getBoundingClientRect?.();
      if (!rect?.width || !rect?.height) continue;
      slots.push(...rectsToEdgeSlots(rect, viewport, selector));
    }
  }
  return slots.length ? slots : fallbackHudSlots(viewport.height, viewport.width);
}

export function clampCadContextMenu(x, y, { width = 228, height = 88, view = {}, pad = 8, anchor = null } = {}) {
  const winW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const boxW = Number(view.width) > 0 ? Number(view.width) : winW;
  const boxH = Number(view.height) > 0 ? Number(view.height) : winH;
  const originX = Number(view.left) || 0;
  const originY = Number(view.top) || 0;
  const maxRight = Math.min(winW, originX + boxW);
  const maxBottom = Math.min(winH, originY + boxH);
  const minTop = Math.max(pad, originY ? originY + pad : pad);
  let left = Number(x) || 0;
  let top = Number(y) || 0;
  const anchorTop = Number(anchor?.top);
  const anchorBottom = Number(anchor?.bottom);
  const belowFrom = Number.isFinite(anchorBottom) ? anchorBottom : top;
  const overflowBelow = belowFrom + height + pad > maxBottom;
  if (overflowBelow) {
    const above = (Number.isFinite(anchorTop) ? anchorTop : top) - height - 4;
    top = above >= minTop ? above : top - height;
  }
  if (left + width + pad > maxRight) left -= width;
  left = Math.min(Math.max(left, pad), Math.max(pad, maxRight - width - pad));
  top = Math.min(Math.max(top, minTop), Math.max(minTop, maxBottom - height - pad));
  return { left: Math.round(left), top: Math.round(top) };
}

/** Viewport-local dock explorer: sit above a low tab, then clamp on-screen. */
export function fitCadDockInView(panel = {}, { view = {}, tab = null, pad = 8 } = {}) {
  const viewW = Number(view.width) > 0 ? Number(view.width) : 800;
  const viewH = Number(view.height) > 0 ? Number(view.height) : 600;
  const panelW = Math.max(1, Number(panel.width) || CAD_DOCK_EXPLORER_PREFERRED_WIDTH);
  const panelH = Math.max(1, Number(panel.height) || 360);
  let left = Number(panel.left) || pad;
  let top = Number(panel.top) || pad;
  const tabTop = Number(tab?.top);
  const tabBottom = Number(tab?.bottom);
  const lowTab = Number.isFinite(tabTop) && tabTop > viewH * 0.42;
  if (lowTab && Number.isFinite(tabTop) && tabTop - panelH - 6 >= pad) {
    top = tabTop - panelH - 6;
  } else if (Number.isFinite(tabBottom) && tabBottom + 6 + panelH + pad <= viewH) {
    top = tabBottom + 6;
  }
  if (top + panelH + pad > viewH) top = viewH - panelH - pad;
  if (left + panelW + pad > viewW) left = viewW - panelW - pad;
  left = Math.min(Math.max(left, pad), Math.max(pad, viewW - panelW - pad));
  top = Math.min(Math.max(top, pad), Math.max(pad, viewH - panelH - pad));
  return { left: Math.round(left), top: Math.round(top) };
}

export function reservedBrowserSlots(expandEl) {
  if (!expandEl) return [];
  const hidden = !!(expandEl.hidden || expandEl.classList?.contains?.("hidden"));
  if (hidden) return [];
  const styled = parseFloat(expandEl.style?.top);
  const start = Number.isFinite(styled) ? styled : BROWSER_TAB_FALLBACK.start;
  const size = expandEl.offsetHeight > 8 ? expandEl.offsetHeight : BROWSER_TAB_FALLBACK.size;
  return [{ edge: "left", start, size, id: "browser" }];
}

export function layoutCadDockTabs(state = {}, { reserved = [], span = 720, spanX = 0 } = {}) {
  const limitY = Number(span) > 0 ? Number(span) : 720;
  const limitX = Number(spanX) > 0 ? Number(spanX) : limitY;
  const pending = [];
  for (const lib of CAD_LIBRARIES) {
    const row = state[lib.id];
    if (!row?.attached) continue;
    pending.push({ id: lib.id, row });
  }
  pending.sort((a, b) => {
    const ae = CAD_DOCK_EDGES.indexOf(normalizeCadEdge(a.row.edge));
    const be = CAD_DOCK_EDGES.indexOf(normalizeCadEdge(b.row.edge));
    const alongA = (normalizeCadEdge(a.row.edge) === "top" || normalizeCadEdge(a.row.edge) === "bottom")
      ? Number(a.row.x) || 0
      : Number(a.row.y) || 0;
    const alongB = (normalizeCadEdge(b.row.edge) === "top" || normalizeCadEdge(b.row.edge) === "bottom")
      ? Number(b.row.x) || 0
      : Number(b.row.y) || 0;
    return ae - be || alongA - alongB || a.id.localeCompare(b.id);
  });
  const taken = reserved.map((row) => ({ ...row, edge: normalizeCadEdge(row.edge || "left") }));
  for (const item of pending) {
    const tryEdges = [normalizeCadEdge(item.row.edge), ...CAD_DOCK_EDGES.filter((edge) => edge !== normalizeCadEdge(item.row.edge))];
    let placed = false;
    for (const edge of tryEdges) {
      const vertical = edge === "left" || edge === "right";
      const max = vertical ? limitY : limitX;
      const edgeTaken = taken.filter((row) => row.edge === edge);
      const preferred = vertical ? item.row.y : item.row.x;
      const pos = nextFreeDockAlong({ preferred, reserved: edgeTaken, max });
      const blocked = edgeTaken.some((row) => rangesOverlap(pos, CAD_DOCK_TAB_SIZE, row.start, row.size))
        || pos + CAD_DOCK_TAB_SIZE > max;
      if (blocked) continue;
      item.row.edge = edge;
      if (vertical) {
        item.row.y = pos;
        item.row.x = 12;
      } else {
        item.row.x = pos;
        item.row.y = 12;
      }
      taken.push({ edge, start: pos, size: CAD_DOCK_TAB_SIZE, id: item.id });
      placed = true;
      break;
    }
    if (!placed) {
      const edge = "right";
      const pos = nextFreeDockAlong({
        preferred: 8,
        reserved: taken.filter((row) => row.edge === edge),
        max: limitY,
      });
      item.row.edge = edge;
      item.row.y = pos;
      item.row.x = 12;
      taken.push({ edge, start: pos, size: CAD_DOCK_TAB_SIZE, id: item.id });
    }
  }
  return state;
}

export function nudgeCadDockOrder(state, cadId, delta) {
  const id = String(cadId || "");
  const row = state?.[id];
  if (!row?.attached) return state;
  const dir = Number(delta) < 0 ? -1 : 1;
  const edge = normalizeCadEdge(row.edge);
  const ids = attachedDockIds(state, edge);
  const index = ids.indexOf(id);
  if (index < 0) return state;
  const next = index + dir;
  if (next < 0) {
    row.order = 0;
    return state;
  }
  if (next >= ids.length) return state;
  const other = state[ids[next]];
  const ao = Number(row.order);
  const bo = Number(other?.order);
  row.order = Number.isFinite(bo) ? bo : next + 1;
  if (other) other.order = Number.isFinite(ao) ? ao : index + 1;
  return state;
}

export const CAD_DOCK_POINTER_SEL = [
  ".cad-library-dock-tab",
  ".cad-library-dock-tab-open",
  ".cad-library-dock-tab-close",
  ".cad-library-dock",
  "#cad-library-dock",
  "#cad-library-dock-tabs",
  ".cad-library-context-menu",
  ".cad-library-chip",
].join(",");

export function isCadDockPointerTarget(target) {
  const el = target?.nodeType === 1 ? target : target?.parentElement;
  return !!el?.closest?.(CAD_DOCK_POINTER_SEL);
}

export function blockCadDockPointer(event) {
  if (!event || !isCadDockPointerTarget(event.target)) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  return true;
}

/** Snap a pointer to the nearest viewport border for Move tab. */
export function snapCadDockToBorder(rect, clientX, clientY) {
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  const x = clientX - (Number(rect?.left) || 0);
  const y = clientY - (Number(rect?.top) || 0);
  const dist = {
    left: x,
    right: width - x,
    top: y,
    bottom: height - y,
  };
  let edge = "left";
  let best = dist.left;
  for (const [name, value] of Object.entries(dist)) {
    if (value < best) {
      best = value;
      edge = name;
    }
  }
  const pad = 8;
  const alongX = Math.min(Math.max(Math.round(x / 8) * 8, pad), Math.max(pad, width - 48));
  const alongY = Math.min(Math.max(Math.round((y - 16) / 8) * 8, pad), Math.max(pad, height - 48));
  if (edge === "top" || edge === "bottom") {
    return { edge, x: alongX, y: 12 };
  }
  return { edge, x: 12, y: alongY };
}

export function applyCadDockTabBox(el, row = {}) {
  if (!el) return;
  const edge = normalizeCadEdge(row.edge);
  el.classList.remove(
    "cad-library-dock-tab--left",
    "cad-library-dock-tab--right",
    "cad-library-dock-tab--top",
    "cad-library-dock-tab--bottom",
  );
  el.classList.add(`cad-library-dock-tab--${edge}`);
  el.style.top = edge === "bottom" ? "auto" : `${Number(row.y) || 14}px`;
  el.style.bottom = edge === "bottom" ? "0px" : "auto";
  el.style.left = edge === "right" ? "auto" : (edge === "top" || edge === "bottom" ? `${Number(row.x) || 72}px` : "0px");
  el.style.right = edge === "right" ? "0px" : "auto";
}

export function setCadDockEdge(state, cadId, edge) {
  const id = String(cadId || "");
  const row = state?.[id];
  if (!row) return state;
  const next = normalizeCadEdge(edge);
  row.edge = next;
  const peers = attachedDockIds(state, next).filter((peer) => peer !== id);
  row.order = peers.length
    ? Math.max(...peers.map((peer) => Number(state[peer]?.order) || 0)) + 1
    : 1;
  return state;
}

/** Persist attach/edge only — explorers always boot collapsed. */
export function persistableCadDockState(state = {}) {
  const out = {};
  for (const lib of CAD_LIBRARIES) {
    const row = state?.[lib.id] && typeof state[lib.id] === "object" ? state[lib.id] : {};
    out[lib.id] = { ...defaultCadDockState(), ...row, expanded: false };
  }
  return out;
}

export function collapseCadDockState(state = {}) {
  for (const lib of CAD_LIBRARIES) {
    if (state[lib.id]) state[lib.id].expanded = false;
  }
  return state;
}

/** Same pointerdown+click must not open then immediately close. */
export const CAD_DOCK_TOGGLE_GUARD_MS = 80;

export function shouldIgnoreCadDockToggle(nowMs, lastToggleMs, guardMs = CAD_DOCK_TOGGLE_GUARD_MS) {
  const now = Number(nowMs);
  const last = Number(lastToggleMs);
  if (!Number.isFinite(now) || !Number.isFinite(last) || last <= 0) return false;
  return now - last < Number(guardMs);
}

export function nowCadDockToggleMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** One click expands; the next (after the guard) collapses. Only one dock open. */
export function applyCadDockToggle(state, cadId) {
  const id = String(cadId || "");
  if (!state?.[id]) return state;
  const next = !state[id].expanded;
  for (const lib of CAD_LIBRARIES) {
    if (!state[lib.id]) continue;
    state[lib.id].expanded = next && lib.id === id;
  }
  return state;
}

export function readCadDockState() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_CAD_DOCK) || "{}");
    return persistableCadDockState(raw);
  } catch {
    return persistableCadDockState();
  }
}

export function writeCadDockState(state) {
  try {
    localStorage.setItem(LS_CAD_DOCK, JSON.stringify(persistableCadDockState(state)));
  } catch {
    /* private mode */
  }
}

function $(id) {
  return document.getElementById(id);
}

function libraryById(id) {
  const resolved = resolveCadLibraryId(id);
  return CAD_LIBRARIES.find((lib) => lib.id === resolved) || null;
}

function sectionEl(lib) {
  return $(lib.sectionId);
}

function parkHome() {
  return $("cad-library-home");
}

function ensureShell() {
  if (!$("cad-library-popup")) {
    const popup = document.createElement("div");
    popup.id = "cad-library-popup";
    popup.className = "auth-modal cad-library-popup hidden";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-modal", "true");
    popup.setAttribute("aria-labelledby", "cad-library-popup-title");
    popup.innerHTML = `
      <div class="auth-backdrop" data-cad-popup-close></div>
      <div class="auth-card app-dialog-card cad-library-popup-card">
        <button type="button" class="auth-close" data-cad-popup-close aria-label="Close">&times;</button>
        <p class="workspace-manage-eyebrow">CAD library</p>
        <h2 id="cad-library-popup-title" class="app-dialog-title">Library</h2>
        <p class="muted small">Browse and import files. Right-click a logo or use Attach to dock this explorer on the viewport.</p>
        <div class="cad-library-popup-actions">
          <button type="button" class="btn secondary btn-compact" data-cad-attach>Attach to side of viewport</button>
        </div>
        <div id="cad-library-popup-host" class="cad-library-popup-host"></div>
      </div>
    `;
    document.body.appendChild(popup);
  }
  const viewport = $("viewport");
  if (viewport && !$("cad-library-dock-tabs")) {
    const tabs = document.createElement("div");
    tabs.id = "cad-library-dock-tabs";
    tabs.className = "cad-library-dock-tabs";
    viewport.appendChild(tabs); // z-index 120 — above BROWSER / HUD
  }
  if (viewport && !$("cad-library-dock")) {
    const dock = document.createElement("aside");
    dock.id = "cad-library-dock";
    dock.className = "cad-library-dock hidden";
    dock.hidden = true;
    dock.innerHTML = `
      <div class="cad-library-dock-head">
        <img id="cad-library-dock-logo" class="cad-library-dock-logo" alt="" width="18" height="18" />
        <strong id="cad-library-dock-title">Library</strong>
        <button type="button" id="cad-library-dock-collapse" class="viewport-browser-collapse" title="Collapse to tab" aria-label="Collapse">‹</button>
        <button type="button" class="cad-library-dock-grip floating-panel-grip" title="Drag to move" aria-label="Drag library">⠿</button>
      </div>
      <div id="cad-library-dock-host" class="cad-library-dock-host"></div>
    `;
    viewport.appendChild(dock);
  }
}

function mountSection(lib, host) {
  const section = sectionEl(lib);
  if (!section || !host) return;
  if (section.parentElement !== host) host.appendChild(section);
  section.hidden = false;
  section.classList.remove("hidden");
}

function parkSection(lib) {
  const section = sectionEl(lib);
  const home = parkHome();
  if (!section || !home) return;
  if (section.parentElement !== home) home.appendChild(section);
}

function removeRetiredCadLibraryUi() {
  document.getElementById("solidworks-library-section")?.remove();
  document.querySelectorAll('[data-cad="solidworks"], .solidworks-library-section').forEach((el) => el.remove());
}

export function createCadLibraryRail() {
  ensureShell();
  removeRetiredCadLibraryUi();
  const rail = $("cad-library-rail");
  const popup = $("cad-library-popup");
  const popupHost = $("cad-library-popup-host");
  const dock = $("cad-library-dock");
  const dockHost = $("cad-library-dock-host");
  const tabs = $("cad-library-dock-tabs");
  const dockTitle = $("cad-library-dock-title");
  const dockLogo = $("cad-library-dock-logo");
  let state = readCadDockState();
  let savedDock = JSON.parse(JSON.stringify(state));
  let popupCad = "";
  let menu = null;
  let suppressOpenEvent = false;
  let dockDirty = false;
  let movingCadId = "";
  let lastDockToggleAt = 0;

  function notifyOpen(lib) {
    if (!lib?.openEvent) return;
    suppressOpenEvent = true;
    try {
      window.dispatchEvent(new CustomEvent(lib.openEvent));
    } finally {
      suppressOpenEvent = false;
    }
  }

  function persistSaved() {
    movingCadId = "";
    layoutAttachedTabs();
    savedDock = JSON.parse(JSON.stringify(state));
    writeCadDockState(savedDock);
    dockDirty = false;
    renderTabs();
  }

  function persistAttachOnly() {
    for (const lib of CAD_LIBRARIES) {
      if (!savedDock[lib.id]) savedDock[lib.id] = defaultCadDockState();
      savedDock[lib.id].attached = !!state[lib.id]?.attached;
      savedDock[lib.id].expanded = false;
    }
    writeCadDockState(savedDock);
  }

  function persist() {
    persistSaved();
  }

  function viewportSpan() {
    const rect = $("viewport")?.getBoundingClientRect();
    return {
      y: Math.max(240, Math.round(rect?.height || 720)),
      x: Math.max(240, Math.round(rect?.width || 1100)),
    };
  }

  function reservedChromeSlots() {
    const expand = $("btn-viewport-browser-expand");
    if (expand) expand.style.top = "";
    const viewport = $("viewport");
    const measured = collectReservedHudSlots(viewport);
    return measured.length ? measured : [
      ...reservedBrowserSlots(expand),
      ...fallbackHudSlots(viewportSpan().y, viewportSpan().x),
    ];
  }

  function layoutAttachedTabs() {
    const size = viewportSpan();
    layoutCadDockTabs(state, {
      reserved: reservedChromeSlots(),
      span: size.y,
      spanX: size.x,
    });
  }

  function closeMenu() {
    menu?.remove();
    menu = null;
  }

  function runMenuAction(cadId, action) {
    const id = resolveCadLibraryId(cadId);
    if (!id) return;
    if (action === "move") beginMoveTab(id);
    else if (action === "detach") detach(id);
    else if (action === "attach") attach(id);
  }

  function showMenu(x, y, cadId) {
    closeMenu();
    const id = resolveCadLibraryId(cadId);
    const lib = libraryById(id);
    if (!lib) return;
    const attached = !!state[id]?.attached;
    menu = document.createElement("div");
    menu.className = "cad-library-context-menu";
    menu.style.zIndex = String(CAD_DOCK_MENU_Z);
    menu.style.pointerEvents = "auto";
    menu.innerHTML = cadDockMenuActions(attached)
      .map((action) => `<button type="button" data-cad-menu="${action.id}">${action.label}</button>`)
      .join("");
    document.body.appendChild(menu);
    const box = menu.getBoundingClientRect();
    const tab = tabs?.querySelector(`[data-cad="${id}"]`);
    const anchor = tab?.getBoundingClientRect?.() || { left: x, top: y, right: x, bottom: y };
    const clamped = clampCadContextMenu(x, y, {
      width: box.width || 228,
      height: box.height || 88,
      view: { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
      anchor,
    });
    menu.style.left = `${clamped.left}px`;
    menu.style.top = `${clamped.top}px`;
    requestAnimationFrame(() => {
      if (!menu) return;
      const live = menu.getBoundingClientRect();
      const next = clampCadContextMenu(x, y, {
        width: live.width || box.width || 228,
        height: live.height || box.height || 88,
        view: { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
        anchor: tab?.getBoundingClientRect?.() || anchor,
      });
      menu.style.left = `${next.left}px`;
      menu.style.top = `${next.top}px`;
    });
    let ran = false;
    const activate = (action) => {
      if (ran || !action) return;
      ran = true;
      closeMenu();
      runMenuAction(id, action);
    };
    menu.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    }, true);
    menu.addEventListener("pointerup", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const action = ev.target?.closest?.("[data-cad-menu]")?.getAttribute("data-cad-menu");
      if (action) activate(action);
    }, true);
    menu.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const action = ev.target?.closest?.("[data-cad-menu]")?.getAttribute("data-cad-menu");
      if (action) activate(action);
    }, true);
    menu.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    }, true);
    menu.addEventListener("auxclick", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    }, true);
  }

  function beginMoveTab(cadId) {
    const id = resolveCadLibraryId(cadId);
    if (!id || !libraryById(id)) return;
    if (!state[id]?.attached) attach(id);
    if (!state[id]?.attached) return;
    movingCadId = id;
    dockDirty = true;
    renderTabs();
  }


  function closePopup() {
    if (!popupCad) {
      popup?.classList.add("hidden");
      return;
    }
    const lib = libraryById(popupCad);
    if (lib && !state[lib.id]?.attached) parkSection(lib);
    else if (lib && state[lib.id]?.expanded) mountSection(lib, dockHost);
    popupCad = "";
    popup?.classList.add("hidden");
  }

  function openPopup(cadId) {
    const lib = libraryById(cadId);
    if (!lib || !popup || !popupHost) return;
    if (state[cadId]?.attached && state[cadId]?.expanded) {
      expand(cadId);
      return;
    }
    closePopup();
    popupCad = cadId;
    const title = $("cad-library-popup-title");
    if (title) title.textContent = lib.label;
    mountSection(lib, popupHost);
    popup.classList.remove("hidden");
    const card = popup.querySelector(".cad-library-popup-card");
    applyCadExplorerChrome(card, window.innerWidth);
    notifyOpen(lib);
  }

  function rememberDockToggle() {
    lastDockToggleAt = nowCadDockToggleMs();
  }

  function canToggleDock() {
    const now = nowCadDockToggleMs();
    if (shouldIgnoreCadDockToggle(now, lastDockToggleAt)) return false;
    return true;
  }

  function toggleDock(cadId) {
    if (!canToggleDock()) return;
    rememberDockToggle();
    if (state[cadId]?.expanded) collapse(cadId);
    else expand(cadId);
  }

  function bindTabOnce(wrap, lib) {
    wrap.querySelector(".cad-library-dock-tab-open")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation?.();
      if (wrap.dataset.dragging === "1" || movingCadId === lib.id) return;
      toggleDock(lib.id);
    });
    wrap.querySelector(".cad-library-dock-tab-close")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation?.();
      if (!state[lib.id]?.expanded) return;
      if (!canToggleDock()) return;
      rememberDockToggle();
      collapse(lib.id);
    });
    bindTabDrag(wrap, lib.id);
    bindTabChrome(wrap, lib.id);
  }

  function renderTabs() {
    if (!tabs) return;
    if (!movingCadId) layoutAttachedTabs();
    const keep = new Set();
    for (const lib of CAD_LIBRARIES) {
      const row = state[lib.id];
      if (!row?.attached) continue;
      keep.add(lib.id);
      const edge = normalizeCadEdge(row.edge);
      let wrap = tabs.querySelector(`[data-cad="${lib.id}"]`);
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.dataset.cad = lib.id;
        wrap.innerHTML = `
          <button type="button" class="cad-library-dock-tab-open">
            <img src="${lib.logo}" alt="${lib.label}" width="22" height="22" />
          </button>
          <button type="button" class="cad-library-dock-tab-close" title="Collapse explorer" aria-label="Collapse">‹</button>
        `;
        bindTabOnce(wrap, lib);
        tabs.appendChild(wrap);
      }
      wrap.hidden = false;
      wrap.classList.remove("hidden");
      wrap.className = `cad-library-dock-tab cad-library-dock-tab--${edge}`;
      wrap.classList.toggle("is-expanded", !!row.expanded);
      wrap.classList.toggle("is-moving", movingCadId === lib.id);
      applyCadDockTabBox(wrap, row);
      const openBtn = wrap.querySelector(".cad-library-dock-tab-open");
      const closeBtn = wrap.querySelector(".cad-library-dock-tab-close");
      if (openBtn) {
        openBtn.title = movingCadId === lib.id
          ? `${lib.label} — drag along the viewport border`
          : row.expanded
            ? `${lib.label} — click to collapse`
            : `${lib.label} — click to open explorer`;
        openBtn.setAttribute("aria-expanded", row.expanded ? "true" : "false");
      }
      if (closeBtn) {
        closeBtn.hidden = !row.expanded;
        closeBtn.setAttribute("aria-hidden", row.expanded ? "false" : "true");
      }
    }
    for (const child of [...tabs.children]) {
      if (!keep.has(child.dataset.cad)) child.remove();
    }
  }

  function renderDock({ persistExpanded = true } = {}) {
    const expandedId = CAD_LIBRARIES.find((lib) => state[lib.id]?.attached && state[lib.id]?.expanded)?.id || "";
    if (!dock) {
      renderTabs();
      return;
    }
    if (!expandedId) {
      const parked = libraryById(popupCad);
      CAD_LIBRARIES.forEach((lib) => {
        if (lib.id !== parked?.id && !state[lib.id]?.expanded) parkSection(lib);
      });
      dock.classList.add("hidden");
      dock.hidden = true;
      renderTabs();
      return;
    }
    const lib = libraryById(expandedId);
    const row = state[expandedId];
    const edge = normalizeCadEdge(row.edge);
    dock.classList.remove("hidden");
    dock.hidden = false;
    dock.classList.toggle("cad-library-dock--right", edge === "right");
    dock.classList.toggle("cad-library-dock--top", edge === "top");
    dock.classList.toggle("cad-library-dock--bottom", edge === "bottom");
    dock.style.top = edge === "bottom" ? "auto" : `${Number(row.y) || 96}px`;
    dock.style.bottom = edge === "bottom" ? "8px" : "auto";
    dock.style.left = edge === "right" ? "auto" : `${Math.max(8, Number(row.x) || 12)}px`;
    dock.style.right = edge === "right" ? "8px" : "auto";
    const fitDock = () => {
      if (!dock || dock.hidden || dock.classList.contains("hidden")) return;
      const view = $("viewport")?.getBoundingClientRect();
      if (!view?.width) return;
      applyCadExplorerChrome(dock, view.width);
      const box = dock.getBoundingClientRect();
      const tabEl = tabs?.querySelector(`[data-cad="${expandedId}"]`);
      const tabBox = tabEl?.getBoundingClientRect?.();
      const fitted = fitCadDockInView(
        { left: box.left - view.left, top: box.top - view.top, width: box.width, height: box.height },
        {
          view: { width: view.width, height: view.height },
          tab: tabBox
            ? { top: tabBox.top - view.top, bottom: tabBox.bottom - view.top }
            : null,
        },
      );
      dock.style.top = `${fitted.top}px`;
      dock.style.bottom = "auto";
      if (edge !== "right") dock.style.left = `${fitted.left}px`;
    };
    requestAnimationFrame(fitDock);
    if (dockTitle) dockTitle.textContent = lib.label;
    if (dockLogo) {
      dockLogo.src = lib.logo;
      dockLogo.alt = lib.label;
    }
    mountSection(lib, dockHost);
    CAD_LIBRARIES.forEach((other) => {
      if (other.id !== lib.id && !popupCad) parkSection(other);
    });
    renderTabs();
    if (persistExpanded) notifyOpen(lib);
  }

  function attach(cadId) {
    const lib = libraryById(cadId);
    if (!lib) return;
    state[cadId] = {
      ...defaultCadDockState(),
      ...state[cadId],
      attached: true,
      expanded: false,
      edge: state[cadId]?.edge || "left",
      y: state[cadId]?.y || BROWSER_TAB_FALLBACK.start + BROWSER_TAB_FALLBACK.size + CAD_DOCK_SLOT,
    };
    layoutAttachedTabs();
    persistAttachOnly();
    if (popupCad === cadId) closePopup();
    renderDock();
  }

  function detach(cadId) {
    state[cadId] = { ...defaultCadDockState(), ...state[cadId], attached: false, expanded: false };
    persistAttachOnly();
    parkSection(libraryById(cadId));
    renderDock();
  }

  function expand(cadId) {
    for (const lib of CAD_LIBRARIES) {
      if (!state[lib.id]) continue;
      state[lib.id].expanded = lib.id === cadId;
    }
    persistAttachOnly();
    closePopup();
    renderDock();
  }

  function collapse(cadId) {
    if (state[cadId]) state[cadId].expanded = false;
    persistAttachOnly();
    parkSection(libraryById(cadId));
    renderDock({ persistExpanded: false });
  }

  function collapseAllDocks() {
    collapseCadDockState(state);
    closePopup();
    persistAttachOnly();
    CAD_LIBRARIES.forEach((lib) => parkSection(lib));
    renderDock({ persistExpanded: false });
  }

  function bindTabChrome(wrap, cadId) {
    const onContext = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation?.();
      showMenu(ev.clientX, ev.clientY, cadId);
    };
    wrap.addEventListener("contextmenu", onContext, true);
    wrap.addEventListener("auxclick", (ev) => {
      if (ev.button === 2) onContext(ev);
    }, true);
    wrap.addEventListener("pointerdown", (ev) => {
      if (ev.button === 2) {
        // Do not preventDefault — Chromium cancels contextmenu if we do.
        ev.stopPropagation();
        return;
      }
      if (shouldArmCadDockDrag(movingCadId, cadId, ev.button)) return;
      if (ev.button === 0) ev.stopPropagation();
    }, true);
  }

  function bindTabDrag(btn, cadId) {
    let drag = null;
    const onMove = (e) => {
      if (!drag || e.pointerId !== drag.id || movingCadId !== cadId) return;
      e.preventDefault();
      e.stopPropagation();
      const viewport = $("viewport");
      const rect = viewport?.getBoundingClientRect();
      if (!rect) return;
      const snap = snapCadDockToBorder(rect, e.clientX, e.clientY);
      const vertical = snap.edge === "left" || snap.edge === "right";
      const others = CAD_LIBRARIES
        .filter((lib) => lib.id !== cadId && state[lib.id]?.attached && !state[lib.id]?.expanded && normalizeCadEdge(state[lib.id].edge) === snap.edge)
        .map((lib) => ({
          start: vertical ? Number(state[lib.id].y) || 0 : Number(state[lib.id].x) || 0,
          size: CAD_DOCK_TAB_SIZE,
        }));
      const reserved = [
        ...reservedChromeSlots().filter((row) => normalizeCadEdge(row.edge) === snap.edge),
        ...others,
      ];
      const along = nextFreeDockAlong({
        preferred: vertical ? snap.y : snap.x,
        reserved,
        max: vertical ? rect.height - 8 : rect.width - 8,
      });
      const blocked = reserved.some((row) => rangesOverlap(along, CAD_DOCK_TAB_SIZE, row.start, row.size));
      state[cadId] = { ...state[cadId], edge: snap.edge, x: vertical ? 12 : along, y: vertical ? along : 12 };
      if (blocked) {
        layoutCadDockTabs(state, {
          reserved: reservedChromeSlots(),
          span: rect.height,
          spanX: rect.width,
        });
      }
      applyCadDockTabBox(btn, state[cadId]);
      btn.dataset.dragging = "1";
      dockDirty = true;
    };
    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      btn.releasePointerCapture?.(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const moved = btn.dataset.dragging === "1";
      movingCadId = "";
      if (moved) persist();
      renderDock();
      window.setTimeout(() => {
        delete btn.dataset.dragging;
      }, 40);
      drag = null;
    };
    btn.addEventListener("pointerdown", (e) => {
      if (!shouldArmCadDockDrag(movingCadId, cadId, e.button)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      drag = { id: e.pointerId };
      btn.setPointerCapture?.(e.pointerId);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }, true);
  }

  function bindDockDrag() {
    const grip = dock?.querySelector(".cad-library-dock-grip");
    if (!dock || !grip || grip.dataset.bound === "1") return;
    grip.dataset.bound = "1";
    let drag = null;
    const onMove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      const viewport = $("viewport");
      const rect = viewport?.getBoundingClientRect();
      if (!rect) return;
      const w = dock.offsetWidth || 280;
      const h = dock.offsetHeight || 220;
      let x = drag.left + (e.clientX - drag.sx);
      let y = drag.top + (e.clientY - drag.sy);
      x = Math.min(Math.max(Math.round(x / 8) * 8, 8), Math.max(8, rect.width - w - 8));
      y = Math.min(Math.max(Math.round(y / 8) * 8, 8), Math.max(8, rect.height - h - 8));
      const expandedId = CAD_LIBRARIES.find((lib) => state[lib.id]?.expanded)?.id;
      if (!expandedId) return;
      const edge = x + w / 2 > rect.width * 0.55 ? "right" : "left";
      state[expandedId] = { ...state[expandedId], x, y, edge };
      dock.style.top = `${y}px`;
      dock.style.left = edge === "right" ? "auto" : `${x}px`;
      dock.style.right = edge === "right" ? "8px" : "auto";
    };
    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      grip.releasePointerCapture?.(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      persist();
      renderDock();
      drag = null;
    };
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      drag = {
        id: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        left: parseFloat(dock.style.left) || 12,
        top: parseFloat(dock.style.top) || 96,
      };
      grip.setPointerCapture?.(e.pointerId);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  rail?.querySelectorAll("[data-cad]").forEach((chip) => {
    const cadId = resolveCadLibraryId(chip.getAttribute("data-cad"));
    if (!cadId) return;
    chip.addEventListener("click", (ev) => {
      ev.preventDefault();
      openPopup(cadId);
    });
    chip.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showMenu(ev.clientX, ev.clientY, cadId);
    }, true);
  });

  popup?.querySelectorAll("[data-cad-popup-close]").forEach((el) => {
    el.addEventListener("click", () => closePopup());
  });
  popup?.querySelector("[data-cad-attach]")?.addEventListener("click", () => {
    if (popupCad) attach(popupCad);
  });
  popup?.addEventListener("contextmenu", (ev) => {
    if (!popupCad) return;
    if (ev.target.closest("input, textarea, select, a, [data-cad-popup-close], [data-cad-attach]")) return;
    ev.preventDefault();
    ev.stopPropagation();
    showMenu(ev.clientX, ev.clientY, popupCad);
  }, true);
  $("cad-library-dock-collapse")?.addEventListener("click", () => {
    const expandedId = CAD_LIBRARIES.find((lib) => state[lib.id]?.expanded)?.id;
    if (expandedId) collapse(expandedId);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (popup && !popup.classList.contains("hidden")) closePopup();
  });
  document.addEventListener("click", (e) => {
    if (menu && !menu.contains(e.target)) closeMenu();
  });
  function handleExternalOpen(cadId) {
    if (suppressOpenEvent) return;
    if (state[cadId]?.attached) expand(cadId);
    else openPopup(cadId);
  }
  window.addEventListener("render3d:open-fusion-library", () => handleExternalOpen("fusion"));
  window.addEventListener("render3d:open-onshape-library", () => handleExternalOpen("onshape"));

  bindDockDrag();
  CAD_LIBRARIES.forEach((lib) => parkSection(lib));
  // Leftover expanded Fusion dock used to notifyOpen during boot and walk
  // Autodesk hubs on the origin threadpool, so index.html sat for seconds.
  renderDock({ persistExpanded: false });
  const notifyExpandedAfterBoot = () => {
    const expandedId = CAD_LIBRARIES.find((lib) => state[lib.id]?.attached && state[lib.id]?.expanded)?.id || "";
    if (expandedId) notifyOpen(libraryById(expandedId));
  };
  if (window.__studioReady) notifyExpandedAfterBoot();
  else window.addEventListener("render3d:studio-ready", notifyExpandedAfterBoot, { once: true });

  return { openPopup, attach, detach, expand, collapse, collapseAllDocks };
}
