/**
 * App-like mobile chrome: lock page zoom/scale and keep the shell fixed.
 * Studio action wiring lives in app.js (uses existing mobile panel helpers).
 */

const MOBILE_MQ = window.matchMedia?.("(max-width: 820px), (pointer: coarse) and (max-width: 1024px)");

function isMobileShell() {
  return Boolean(MOBILE_MQ?.matches);
}

function syncMobileAppLock() {
  const on = isMobileShell();
  document.documentElement.classList.toggle("mobile-app-locked", on);
  document.body.classList.toggle("mobile-app-shell", on);
  if (on) {
    // Re-assert viewport on soft navigations / iOS gesture recovery.
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      meta.setAttribute(
        "content",
        "width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover"
      );
    }
  }
}

function preventPageZoom(e) {
  if (!isMobileShell()) return;
  if (e.touches?.length > 1) {
    e.preventDefault();
  }
}

function preventGestureZoom(e) {
  if (!isMobileShell()) return;
  e.preventDefault();
}

function preventCtrlWheelZoom(e) {
  if (!isMobileShell()) return;
  if (e.ctrlKey) e.preventDefault();
}

export function closeToolbarNavMenu() {
  document.querySelectorAll("nav.toolbar-nav.is-open").forEach((nav) => {
    nav.classList.remove("is-open");
    nav.querySelector(".toolbar-nav-toggle")?.setAttribute("aria-expanded", "false");
  });
}

export function setMobileToolsPopupOpen(open) {
  const fab = document.getElementById("mobile-tools-fab");
  const popup = document.getElementById("mobile-tools-popup");
  if (!fab || !popup) return;
  popup.classList.toggle("hidden", !open);
  fab.classList.toggle("is-open", open);
  fab.setAttribute("aria-expanded", String(open));
}

export function closeMobileToolsPopup() {
  setMobileToolsPopupOpen(false);
}

function initViewportLock() {
  syncMobileAppLock();
  MOBILE_MQ?.addEventListener?.("change", syncMobileAppLock);

  document.addEventListener("gesturestart", preventGestureZoom, { passive: false });
  document.addEventListener("gesturechange", preventGestureZoom, { passive: false });
  document.addEventListener("gestureend", preventGestureZoom, { passive: false });
  document.addEventListener("touchmove", (e) => {
    if (!isMobileShell()) return;
    if (e.touches?.length > 1) {
      e.preventDefault();
      return;
    }
  }, { passive: false });
  document.addEventListener("wheel", preventCtrlWheelZoom, { passive: false });

  // Block double-tap zoom on the viewport chrome without killing panel scroll.
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      if (!isMobileShell()) return;
      const now = Date.now();
      if (now - lastTouchEnd < 320) {
        const t = e.target;
        const inScrollable =
          t?.closest?.(".sidebar, .toolbar-nav-menu, .user-menu, .mobile-tools-popup, .mobile-model-picker, textarea, input, select");
        if (!inScrollable) e.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );
}

initViewportLock();

window.Render3DMobileChrome = {
  isMobileShell,
  closeToolbarNavMenu,
  setMobileToolsPopupOpen,
  closeMobileToolsPopup,
  syncMobileAppLock,
};
