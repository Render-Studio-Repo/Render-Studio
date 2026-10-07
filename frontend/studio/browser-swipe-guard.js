/** Prevent Mac trackpad horizontal swipes inside Studio from navigating history. */

const HORIZONTAL_SWIPE_MIN = 14;
const HORIZONTAL_DOMINANCE = 1.15;

/** Viewport, video editor, and other in-viewport menus/overlays. */
export const VIEWPORT_MENU_SELECTOR = [
  "#viewport",
  ".viewport-overlay-root",
  ".clip-editor-workspace",
  ".video-editor-window",
  "#viewport-video-share-modal",
  "#screenshot-markup-modal",
  ".screenshot-markup-modal",
  ".vtl-host",
  ".vtl",
  ".video-editor-preview-wrap",
  "#r3d-record-overlay",
  ".r3d-record-overlay",
  "#record-done-hint-modal",
  "#ref-viewer",
  "#dxf-viewer",
  ".dxf-viewer",
  ".viewport-generation-user",
  ".cad-library-dock",
  "#cad-library-dock",
  "#improve-lab-overlay",
  ".viewport-search-overlay",
  "#viewport-search-root",
  ".gizmo-panel",
  ".ribbon-pick-host",
  "#ribbon-pick-host",
  ".viewport-browser-panel",
  "#canvas-mode-container",
  ".canvas-workspace-wrap",
  "[data-video-editor-card]",
  "[data-vtl-menu]",
  ".auth-modal",
].join(", ");

const OPEN_VIEWPORT_MENU_SELECTOR = [
  "#viewport-video-share-modal:not(.hidden)",
  "#screenshot-markup-modal:not(.hidden)",
  "#record-done-hint-modal:not(.hidden)",
  "#r3d-record-overlay:not(.r3d-record-overlay--off):not(.hidden)",
  "#ref-viewer:not(.hidden)",
  "#dxf-viewer:not(.hidden)",
  "#improve-lab-overlay:not(.hidden)",
  ".viewport-generation-user:not(.hidden)",
  ".auth-modal:not(.hidden)",
  ".viewport-search-overlay:not(.hidden)",
  ".cad-library-dock:not(.hidden)",
  ".clip-editor-workspace:not(.hidden)",
  ".video-editor-window:not(.hidden)",
].join(", ");

function isEditableTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function canScrollHorizontally(el, deltaX) {
  if (typeof getComputedStyle !== "function" || !el) return false;
  const stop = typeof document !== "undefined" ? document.body : null;
  for (let node = el; node && node !== stop; node = node.parentElement) {
    const style = getComputedStyle(node);
    const overflowX = style.overflowX;
    const canScroll = /(auto|scroll)/.test(overflowX) && node.scrollWidth > node.clientWidth + 1;
    if (!canScroll) continue;
    if (deltaX < 0 && node.scrollLeft > 0) return true;
    if (deltaX > 0 && node.scrollLeft + node.clientWidth < node.scrollWidth - 1) return true;
  }
  return false;
}

export function isHorizontalHistorySwipe(event) {
  if (!event) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const absX = Math.abs(event.deltaX || 0);
  const absY = Math.abs(event.deltaY || 0);
  return absX > absY;
}

export function isViewportMenuSurface(target) {
  return Boolean(target?.closest?.(VIEWPORT_MENU_SELECTOR));
}

export function shouldBlockViewportPageZoom(event) {
  if (!event || event.cancelable === false) return false;
  if (!event.ctrlKey && event.type !== "gesturestart" && event.type !== "gesturechange") return false;
  return Boolean(event.target?.closest?.("#viewport"));
}

export function viewportMenuIsOpen(root = typeof document !== "undefined" ? document : null) {
  if (!root?.querySelector) return false;
  return Boolean(root.querySelector(OPEN_VIEWPORT_MENU_SELECTOR));
}

export function shouldBlockHistorySwipe(event, opts = {}) {
  if (!event || event.cancelable === false) return false;
  if (!isHorizontalHistorySwipe(event)) return false;
  const overMenu = isViewportMenuSurface(event.target);
  const overlayOpen = opts.overlayOpen ?? (overMenu || viewportMenuIsOpen());
  const scrollCheck = opts.canScroll ?? canScrollHorizontally;
  if (overMenu || overlayOpen) {
    return !scrollCheck(event.target, event.deltaX || 0);
  }
  if (isEditableTarget(event.target)) return false;
  const absX = Math.abs(event.deltaX || 0);
  const absY = Math.abs(event.deltaY || 0);
  if (absX < HORIZONTAL_SWIPE_MIN || absX < absY * HORIZONTAL_DOMINANCE) return false;
  return !scrollCheck(event.target, event.deltaX || 0);
}

function onHistorySwipeWheel(event) {
  if (shouldBlockViewportPageZoom(event) || shouldBlockHistorySwipe(event)) event.preventDefault();
}

function onViewportGesture(event) {
  if (shouldBlockViewportPageZoom(event)) event.preventDefault();
}

export function initBrowserSwipeGuard(root = typeof document !== "undefined" ? document : null) {
  if (!root?.addEventListener) return false;
  if (root.body?.classList?.contains("info-page")) return false;
  const app = root.getElementById?.("app");
  if (app?.classList?.contains("app-info")) return false;
  if (!app && !root.getElementById?.("viewport")) return false;
  root.addEventListener("wheel", onHistorySwipeWheel, { passive: false, capture: true });
  root.addEventListener("gesturestart", onViewportGesture, { passive: false, capture: true });
  root.addEventListener("gesturechange", onViewportGesture, { passive: false, capture: true });
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initBrowserSwipeGuard());
  } else {
    initBrowserSwipeGuard();
  }
}
