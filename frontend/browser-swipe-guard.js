/** Prevent Mac trackpad horizontal swipes inside Studio from navigating history. */

const HORIZONTAL_SWIPE_MIN = 14;
const HORIZONTAL_DOMINANCE = 1.15;

function isEditableTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function canScrollHorizontally(el, deltaX) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const overflowX = style.overflowX;
    const canScroll = /(auto|scroll)/.test(overflowX) && node.scrollWidth > node.clientWidth + 1;
    if (!canScroll) continue;
    if (deltaX < 0 && node.scrollLeft > 0) return true;
    if (deltaX > 0 && node.scrollLeft + node.clientWidth < node.scrollWidth - 1) return true;
  }
  return false;
}

function shouldBlockHistorySwipe(event) {
  if (!event.cancelable) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isEditableTarget(event.target)) return false;
  const absX = Math.abs(event.deltaX || 0);
  const absY = Math.abs(event.deltaY || 0);
  if (absX < HORIZONTAL_SWIPE_MIN || absX < absY * HORIZONTAL_DOMINANCE) return false;
  return !canScrollHorizontally(event.target, event.deltaX || 0);
}

function initBrowserSwipeGuard() {
  const app = document.getElementById("app");
  if (!app) return;
  app.addEventListener(
    "wheel",
    (event) => {
      if (shouldBlockHistorySwipe(event)) event.preventDefault();
    },
    { passive: false, capture: true },
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBrowserSwipeGuard);
} else {
  initBrowserSwipeGuard();
}
