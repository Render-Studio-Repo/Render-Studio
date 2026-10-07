import { initMobileLayout } from './mobile-layout.js?v=20260916-mobile-taps2';
import { createMobileOverlayCoordinator } from './mobile-overlay-coordinator.js?v=20260930-mesh-session1';
/**
 * App-like mobile chrome: lock page zoom/scale, slim header, and wire Menu tiles.
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
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      meta.setAttribute(
        "content",
        "width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover"
      );
    }
    const socialTab = document.querySelector('.right-panel-tab[data-right-tab="social"]');
    if (socialTab?.classList.contains("active")) {
      document.querySelector('.right-panel-tab[data-right-tab="prompt"]')?.click();
    }
    const collapseBrowser = () => {
      const browser = document.getElementById("viewport-browser-panel");
      if (browser && !browser.classList.contains("hidden") && !browser.hidden) {
        document.getElementById("btn-viewport-browser-collapse")?.click();
      }
      document.getElementById("mobile-browser-fab")?.classList.remove("is-open");
    };
    collapseBrowser();
  }
  syncJoinScreen();
}

function syncVisualViewportChrome() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const height = Math.round(vv?.height || window.innerHeight || 0);
  root.style.setProperty("--app-height", height ? `${height}px` : "100dvh");
  if (!vv) {
    root.style.setProperty("--safari-chrome-bottom", "0px");
    return;
  }
  // Measure how much of the layout viewport sits below the visible area so
  // docks clear iOS Safari's toolbar — never invent extra chrome that
  // letterboxes the studio.
  const visualBottom = vv.offsetTop + vv.height;
  const layoutBottom = window.innerHeight || height;
  const covered = Math.max(0, Math.round(layoutBottom - visualBottom));
  root.style.setProperty("--safari-chrome-bottom", `${covered}px`);
  try {
    window.dispatchEvent(new CustomEvent("render3d:viewport-chrome"));
  } catch (_) {}
}

function initVisualViewportChrome() {
  syncVisualViewportChrome();
  window.visualViewport?.addEventListener("resize", syncVisualViewportChrome);
  window.visualViewport?.addEventListener("scroll", syncVisualViewportChrome);
  window.addEventListener("resize", syncVisualViewportChrome);
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
  const backdrop = document.getElementById("toolbar-nav-backdrop");
  if (backdrop) { backdrop.hidden = true; backdrop.classList.add("hidden"); }
  document.body.classList.remove("toolbar-nav-open");
}

function _setFabPopup(fabId, popupId, open) {
  const fab = document.getElementById(fabId);
  const popup = document.getElementById(popupId);
  if (!fab || !popup) return;
  popup.classList.toggle("hidden", !open);
  fab.classList.toggle("is-open", open);
  fab.setAttribute("aria-expanded", String(open));
  if (popupId === "mobile-tools-popup") document.querySelector('[data-mobile-banner="tools"]')?.setAttribute("aria-expanded", String(open));
}

function _closeSelectPopupOnly() {
  const fab = document.getElementById("mobile-select-fab");
  const popup = document.getElementById("mobile-select-popup");
  if (!fab || !popup) return;
  popup.classList.add("hidden");
  fab.classList.remove("is-open");
  fab.setAttribute("aria-expanded", "false");
}

function _closeToolsPopupOnly() {
  const fab = document.getElementById("mobile-tools-fab");
  const popup = document.getElementById("mobile-tools-popup");
  if (!fab || !popup) return;
  popup.classList.add("hidden");
  fab.classList.remove("is-open");
  fab.setAttribute("aria-expanded", "false");
}

export function setMobileToolsPopupOpen(open) {
  if (open) mobileOverlayCoordinator().activate("tools");
  _setFabPopup("mobile-tools-fab", "mobile-tools-popup", open);
}

export function closeMobileToolsPopup() {
  setMobileToolsPopupOpen(false);
}

export function setMobileSelectPopupOpen(open) {
  if (open) mobileOverlayCoordinator().activate("select");
  _setFabPopup("mobile-select-fab", "mobile-select-popup", open);
}

export function closeMobileSelectPopup() {
  setMobileSelectPopupOpen(false);
}

function studioBridge() {
  return window.Render3DMobileStudio || null;
}

let _mobileOverlayCoordinator = null;
function mobileOverlayCoordinator() {
  if (_mobileOverlayCoordinator) return _mobileOverlayCoordinator;
  _mobileOverlayCoordinator = createMobileOverlayCoordinator({
    tools: _closeToolsPopupOnly,
    select: _closeSelectPopupOnly,
    nav: closeToolbarNavMenu,
    more: closeMoreSheet,
    ai: closeAiComposer,
    panel: () => studioBridge()?.closePanels?.(),
  });
  return _mobileOverlayCoordinator;
}

function runMobileAppAction(action) {
  const bridge = studioBridge();
  mobileOverlayCoordinator().activate(["explorer", "ai", "edit-tools"].includes(action) ? "panel" : null);

  switch (action) {
    case "explorer":
      bridge?.openLeftPanel?.();
      break;
    case "ai":
      bridge?.openAiPanel?.();
      break;
    case "edit-tools":
      bridge?.openRightPanel?.("tools");
      break;
    case "models":
      bridge?.openModelPicker?.();
      break;
    case "browser":
      bridge?.openBrowser?.();
      break;
    case "new-project":
      document.getElementById("btn-new-project")?.click();
      break;
    case "upload":
      if (bridge?.triggerUpload) bridge.triggerUpload();
      else document.getElementById("file-upload")?.click();
      break;
    case "catalog":
      bridge?.openDesignTab?.("CATALOG");
      break;
    case "sketch":
      bridge?.openDesignTab?.("SKETCH");
      break;
    case "wiring":
      bridge?.openDesignTab?.("WIRING");
      break;
    case "export":
      document.getElementById("btn-export-model")?.click();
      break;
    default:
      break;
  }
}

function initMobileAppMenuActions() {
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-mobile-app]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    runMobileAppAction(btn.getAttribute("data-mobile-app") || "");
  });
}

function initPanelWindowClose() {
  document.addEventListener("click", (e) => {
    const closeBtn = e.target?.closest?.(".sidebar .mobile-sheet-close");
    if (!closeBtn) return;
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove("mobile-left-panel-open", "mobile-right-panel-open");
    if (isMobileShell()) mobileOverlayCoordinator().closeAll();
    else {
      closeMobileToolsPopup();
      closeMobileSelectPopup();
    }
  });
}

function initDockFlyouts() {
  document.getElementById("mobile-tools-fab")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const popup = document.getElementById("mobile-tools-popup");
    const willOpen = popup?.classList.contains("hidden");
    setMobileToolsPopupOpen(Boolean(willOpen));
  });
  document.getElementById("mobile-select-fab")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const popup = document.getElementById("mobile-select-popup");
    const willOpen = popup?.classList.contains("hidden");
    setMobileSelectPopupOpen(Boolean(willOpen));
  });
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.("#mobile-tools-popup, #mobile-select-popup, #mobile-point-view-tray, #mobile-tools-fab, #mobile-select-fab, #mobile-browser-fab, #btn-xr-vr, #mobile-app-banner, #mobile-more-sheet, #mobile-ai-composer")) {
      return;
    }
    if (isMobileShell()) mobileOverlayCoordinator().closeAll();
    else {
      closeMobileToolsPopup();
      closeMobileSelectPopup();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMobileToolsPopup();
      closeMobileSelectPopup();
    }
  });
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
    }
  }, { passive: false });
  document.addEventListener("wheel", preventCtrlWheelZoom, { passive: false });

  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      if (!isMobileShell()) return;
      // Never cancel the native click generated for an interactive touch target.
      if (e.target?.closest?.('button, a, input, select, textarea, [role="button"], [contenteditable="true"]')) return;
      const now = Date.now();
      if (now - lastTouchEnd < 320) {
        const t = e.target;
        const inScrollable =
          t?.closest?.(".sidebar, .toolbar-nav-menu, .user-menu, .mobile-tools-popup, .mobile-select-popup, .mobile-point-view-tray, .mobile-model-picker, .mobile-browser-fab, #btn-xr-vr, .viewport-browser-panel, .section-view-panel, .camera-ar-tools, .viewport-measure-readout, textarea, input, select, #mobile-app-banner, #mobile-more-sheet, #mobile-ai-composer, #mobile-join-screen, #auth-modal");
        if (!inScrollable) e.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );
}

function initStudioWindowHeaders() {
  const specs = [
    [".sidebar.left", "Explorer"],
    [".sidebar.right", "Studio"],
  ];
  for (const [sel, title] of specs) {
    const sidebar = document.querySelector(sel);
    if (!sidebar || sidebar.querySelector(":scope > .mobile-sheet-header")) continue;
    const header = document.createElement("div");
    header.className = "mobile-sheet-header";
    header.innerHTML = `<h2 class="mobile-sheet-title">${title}</h2><button type="button" class="mobile-sheet-close" aria-label="Close panel">×</button>`;
    sidebar.insertBefore(header, sidebar.firstChild);
  }
}

function setHidden(el, hidden) {
  if (!el) return;
  el.hidden = !!hidden;
  el.classList.toggle("hidden", !!hidden);
}

function syncJoinScreen() {
  const join = document.getElementById("mobile-join-screen");
  const signedIn = document.body.classList.contains("is-signed-in")
    || document.documentElement.classList.contains("has-session");
  const show = isMobileShell() && !signedIn;
  setHidden(join, !show);
  document.body.classList.toggle("mobile-join-visible", show);
  document.documentElement.classList.toggle("mobile-join-visible", show);
  const banner = document.getElementById("mobile-app-banner");
  setHidden(banner, !isMobileShell() || show);
}

function setMoreSheetOpen(open) {
  const sheet = document.getElementById("mobile-more-sheet");
  const btn = document.querySelector("[data-mobile-banner='more']");
  if (open) mobileOverlayCoordinator().activate("more");
  setHidden(sheet, !open);
  btn?.setAttribute("aria-expanded", String(!!open));
}

function closeMoreSheet() {
  setMoreSheetOpen(false);
}

function currentAiMode() {
  return document.body.dataset.mobileAiMode || "cad";
}

function setAiMode(mode) {
  const next = ["imagine", "mesh", "render", "cad"].includes(mode) ? mode : "cad";
  document.body.dataset.mobileAiMode = next;
  document.body.classList.remove("is-active");
  document.body.removeAttribute("aria-selected");
  document.querySelectorAll("#mobile-ai-composer [data-mobile-ai-mode]").forEach((btn) => {
    const on = btn.dataset.mobileAiMode === next;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", String(on));
  });
  const studio = studioBridge();
  // Open the right panel first. showAiComposePanel() would undo Imagine if we
  // switch tabs before openAiPanel().
  studio?.openAiPanel?.();
  if (next === "imagine") {
    document.getElementById("prompt-tab-imagine")?.click();
  } else {
    document.querySelector('.prompt-tab[data-pane="compose"]')?.click();
    const promptMode = next === "cad" ? "v2" : next;
    document.querySelector(`.prompt-mode-btn[data-prompt-mode="${promptMode}"]`)?.click();
  }
  syncComposerField();
}

function syncComposerField() {
  const input = document.getElementById("mobile-ai-composer-input");
  if (!input) return;
  const studio = studioBridge();
  if (currentAiMode() === "imagine") input.value = studio?.getImagineText?.() || document.getElementById("imagine-input")?.value || "";
  else input.value = studio?.getPromptText?.() || "";
}

function commitComposerField() {
  const input = document.getElementById("mobile-ai-composer-input");
  if (!input) return;
  const studio = studioBridge();
  if (currentAiMode() === "imagine") studio?.setImagineText?.(input.value);
  else studio?.setPromptText?.(input.value);
}

function openAiComposer(mode) {
  if (!isMobileShell()) return;
  mobileOverlayCoordinator().activate("ai");
  const cadPop = document.getElementById("prompt-cad-engine-popup");
  if (cadPop) cadPop.hidden = true;
  const cadHost = document.getElementById("prompt-cad-engine-host");
  if (cadHost) cadHost.dataset.open = "false";
  const overlay = document.getElementById("mobile-ai-composer");
  if (mode) setAiMode(mode);
  else setAiMode(currentAiMode());
  setHidden(overlay, false);
  document.body.classList.add("mobile-ai-composer-open");
  syncComposerField();
  queueMicrotask(() => {
    const input = document.getElementById("mobile-ai-composer-input");
    if (!input) return;
    input.style.pointerEvents = "auto";
    input.removeAttribute("readonly");
    input.focus({ preventScroll: true });
  });
}

function closeAiComposer() {
  commitComposerField();
  setHidden(document.getElementById("mobile-ai-composer"), true);
  document.body.classList.remove("mobile-ai-composer-open");
}

function initMobileBanner() {
  syncJoinScreen();
  document.getElementById("mobile-app-banner")?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-mobile-banner]");
    if (!btn) return;
    const action = btn.getAttribute("data-mobile-banner");
    if (action === "help") return;
    e.preventDefault();
    if (action === "tools") {
      const popup = document.getElementById("mobile-tools-popup");
      const willOpen = popup?.classList.contains("hidden") || popup?.hidden;
      setMobileToolsPopupOpen(Boolean(willOpen));
      btn.setAttribute("aria-expanded", String(Boolean(willOpen)));
      return;
    }
    if (action === "more") {
      const sheet = document.getElementById("mobile-more-sheet");
      const willOpen = sheet?.classList.contains("hidden") || sheet?.hidden;
      setMoreSheetOpen(Boolean(willOpen));
      return;
    }
    if (action === "suggest") document.getElementById("btn-suggestion")?.click();
    if (action === "bug") document.getElementById("btn-report-bug")?.click();
  });
  document.getElementById("mobile-more-sheet")?.addEventListener("click", (e) => {
    if (e.target?.closest?.("[data-mobile-more-close]")) {
      e.preventDefault();
      closeMoreSheet();
      return;
    }
    const btn = e.target?.closest?.("[data-mobile-more]");
    if (!btn) return;
    e.preventDefault();
    const action = btn.getAttribute("data-mobile-more");
    closeMoreSheet();
    const map = {
      agent: "btn-render-agent",
      chat: "btn-project-chat",
      social: "btn-social-network",
      suggest: "btn-suggestion",
      bug: "btn-report-bug",
      activity: "btn-workspace-activity-toggle",
    };
    document.getElementById(map[action] || "")?.click();
  });
  document.getElementById("btn-type-ai-prompt")?.addEventListener("click", (e) => {
    e.preventDefault();
    openAiComposer();
  });
  document.querySelectorAll("[data-mobile-join]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const tab = btn.getAttribute("data-mobile-join") === "register" ? "register" : "login";
      document.getElementById("btn-auth")?.click();
      document.querySelector(`.auth-tab[data-tab="${tab}"]`)?.click();
    });
  });
  document.getElementById("mobile-ai-composer")?.addEventListener("click", (e) => {
    if (e.target?.closest?.("[data-mobile-ai-close]")) {
      e.preventDefault();
      closeAiComposer();
    }
  });
  document.querySelectorAll("#mobile-ai-composer [data-mobile-ai-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      commitComposerField();
      setAiMode(btn.dataset.mobileAiMode);
      queueMicrotask(() => document.getElementById("mobile-ai-composer-input")?.focus?.());
    });
  });
  document.getElementById("mobile-ai-composer-input")?.addEventListener("input", commitComposerField);
  document.getElementById("mobile-ai-model-btn")?.addEventListener("click", () => {
    if (currentAiMode() === "imagine") document.getElementById("imagine-key-picker-btn")?.click();
    else document.getElementById("prompt-key-picker-btn")?.click();
  });
  document.querySelector("[data-mobile-ai-tool='photo']")?.addEventListener("click", () => {
    document.getElementById("mobile-ai-photo-input")?.click();
  });
  document.querySelector("[data-mobile-ai-tool='camera']")?.addEventListener("click", () => {
    document.getElementById("mobile-ai-camera-input")?.click();
  });
  document.querySelector("[data-mobile-ai-tool='transcribe']")?.addEventListener("click", () => {
    const targetId = currentAiMode() === "imagine" ? "imagine-input" : "prompt-input";
    commitComposerField();
    const mic = document.querySelector(`.prompt-mic-btn[data-mic-target="${targetId}"]`)
      || document.querySelector('.prompt-mic-btn[data-mic-target="prompt-input"]');
    mic?.click();
    window.setTimeout(syncComposerField, 400);
  });
  const onFiles = (input) => {
    input?.addEventListener("change", () => {
      const files = [...(input.files || [])];
      input.value = "";
      if (!files.length) return;
      const studio = studioBridge();
      if (currentAiMode() === "imagine") studio?.attachImagineFiles?.(files);
      else studio?.attachPromptFiles?.(files);
    });
  };
  onFiles(document.getElementById("mobile-ai-photo-input"));
  onFiles(document.getElementById("mobile-ai-camera-input"));
  document.getElementById("mobile-ai-generate")?.addEventListener("click", () => {
    commitComposerField();
    if (currentAiMode() === "imagine") document.getElementById("imagine-generate")?.click();
    else document.getElementById("btn-prompt")?.click();
  });
  window.addEventListener("render3d:auth-session", syncJoinScreen);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!document.getElementById("mobile-ai-composer")?.classList.contains("hidden")) {
      closeAiComposer();
      return;
    }
    closeMoreSheet();
  });
}

initViewportLock();
initVisualViewportChrome();
initMobileAppMenuActions();
initPanelWindowClose();
initDockFlyouts();
initStudioWindowHeaders();
initMobileBanner();
initMobileLayout();

window.Render3DMobileChrome = {
  isMobileShell,
  closeToolbarNavMenu,
  setMobileToolsPopupOpen,
  closeMobileToolsPopup,
  setMobileSelectPopupOpen,
  closeMobileSelectPopup,
  syncMobileAppLock,
  runMobileAppAction,
  openAiComposer,
  closeAiComposer,
  syncJoinScreen,
};
