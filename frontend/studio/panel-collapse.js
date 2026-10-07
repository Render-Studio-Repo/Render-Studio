/**
 * Collapsible panels — left sidebar, right panel, timeline.
 * Loaded as a module after app.js so all DOM elements exist.
 */

const LS = {
  sidebar: "render3d:sidebarOpen",
  rightPanel: "render3d:rightPanelOpen",
  timeline: "render3d:timelineOpen",
  timelineHeight: "render3d:timelineHeight",
};

const DEFAULT_TIMELINE_HEIGHT = 56;

const appEl = document.getElementById("app");
const btnSidebar = document.getElementById("btn-toggle-sidebar");
const btnCollapseRight = document.getElementById("btn-collapse-right-panel");

// Fixed re-open tab on the left edge when sidebar is collapsed
const reopenTabLeft = document.createElement("button");
reopenTabLeft.id = "sidebar-reopen-tab";
reopenTabLeft.title = "Open sidebar";
reopenTabLeft.setAttribute("aria-label", "Open sidebar");
reopenTabLeft.textContent = "▶";
reopenTabLeft.style.display = "none";
document.body.appendChild(reopenTabLeft);

// Fixed re-open tab on the right edge when right panel is collapsed
const reopenTabRight = document.createElement("button");
reopenTabRight.id = "right-panel-reopen-tab";
reopenTabRight.title = "Open right panel";
reopenTabRight.setAttribute("aria-label", "Open right panel");
reopenTabRight.textContent = "◀";
reopenTabRight.style.display = "none";
document.body.appendChild(reopenTabRight);

function notifyLayoutChange() {
  setTimeout(() => window.dispatchEvent(new Event("resize")), 240);
}

function resetLeftSidebarScroll() {
  const scroller = document.querySelector(".sidebar.left .left-scroll");
  if (scroller) scroller.scrollTop = 0;
}

if (typeof history !== "undefined" && "scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

window.addEventListener("DOMContentLoaded", resetLeftSidebarScroll);
window.addEventListener("pageshow", resetLeftSidebarScroll);

/** True only if the user previously opened this panel. Missing = retracted. */
function userChoseExpanded(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch (_) {
    return false;
  }
}

function userChoseCollapsed(key) {
  try {
    return localStorage.getItem(key) === "0";
  } catch (_) {
    return false;
  }
}

function persistOpen(key, open) {
  try {
    localStorage.setItem(key, open ? "1" : "0");
  } catch (_) {}
}

function setSidebarHidden(v, { persist = true } = {}) {
  appEl?.classList.toggle("left-panel-hidden", v);
  reopenTabLeft.style.display = v ? "flex" : "none";
  if (btnSidebar) {
    btnSidebar.setAttribute("aria-pressed", String(v));
    btnSidebar.title = v ? "Show sidebar" : "Hide sidebar";
  }
  if (persist) persistOpen(LS.sidebar, !v);
  notifyLayoutChange();
}

function setRightPanelHidden(v, { persist = true } = {}) {
  appEl?.classList.toggle("right-panel-hidden", v);
  // No edge rail anymore — show the floating reopen tab when collapsed.
  reopenTabRight.style.display = v ? "flex" : "none";
  if (btnCollapseRight) {
    btnCollapseRight.setAttribute("aria-pressed", String(v));
    btnCollapseRight.title = v ? "Show right panel" : "Hide right panel";
    btnCollapseRight.textContent = v ? "◀" : "▶";
  }
  if (persist) persistOpen(LS.rightPanel, !v);
  notifyLayoutChange();
}

if (btnSidebar) {
  btnSidebar.addEventListener("click", () =>
    setSidebarHidden(!appEl?.classList.contains("left-panel-hidden")));
}
reopenTabLeft.addEventListener("click", () => setSidebarHidden(false));

if (btnCollapseRight) {
  btnCollapseRight.addEventListener("click", () =>
    setRightPanelHidden(!appEl?.classList.contains("right-panel-hidden")));
}
reopenTabRight.addEventListener("click", () => setRightPanelHidden(false));

// Clicking any edge tab expands the panel body.
document.querySelectorAll(".right-panel-tabs [data-right-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (appEl?.classList.contains("right-panel-hidden")) setRightPanelHidden(false);
  });
});

function addGutterCollapseButtons() {
  const leftGutter = document.querySelector('.panel-gutter-v[data-gutter="left-split"]');
  const rightGutter = document.querySelector('.panel-gutter-v[data-gutter="right-split"]');

  if (leftGutter && !leftGutter.querySelector(".gutter-collapse-btn")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gutter-collapse-btn gutter-collapse-btn--left";
    btn.title = "Collapse sidebar";
    btn.setAttribute("aria-label", "Collapse sidebar");
    btn.textContent = "◀";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      setSidebarHidden(true);
    });
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    leftGutter.appendChild(btn);
  }

  if (rightGutter && !rightGutter.querySelector(".gutter-collapse-btn")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gutter-collapse-btn gutter-collapse-btn--right";
    btn.title = "Collapse right panel";
    btn.setAttribute("aria-label", "Collapse right panel");
    btn.textContent = "▶";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      setRightPanelHidden(true);
    });
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    rightGutter.appendChild(btn);
  }
}

// ── Timeline ───────────────────────────────────────────────────────────────

const timelinePanel = document.getElementById("timeline-panel");
const mainColumn = document.querySelector(".main-column");

const timelineExpandTab = document.createElement("button");
timelineExpandTab.type = "button";
timelineExpandTab.id = "timeline-expand-tab";
timelineExpandTab.className = "timeline-expand-tab";
timelineExpandTab.title = "Show timeline";
timelineExpandTab.setAttribute("aria-label", "Show timeline");
timelineExpandTab.textContent = "▲";
timelineExpandTab.style.display = "none";
mainColumn?.appendChild(timelineExpandTab);

function getTimelineBtn() {
  return document.getElementById("btn-timeline-collapse");
}

function readTimelineHeightPx() {
  const fromStorage = parseFloat(localStorage.getItem(LS.timelineHeight));
  // Migrate old card-style heights (≥110) down to the slim dock default.
  if (Number.isFinite(fromStorage) && fromStorage >= 48 && fromStorage < 110) return fromStorage;
  const fromVar = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--timeline-height")
  );
  if (Number.isFinite(fromVar) && fromVar >= 48 && fromVar < 110) return fromVar;
  return DEFAULT_TIMELINE_HEIGHT;
}

let timelineHeightBeforeCollapse = null;

function restoreTimelineHeight() {
  const h = timelineHeightBeforeCollapse ?? readTimelineHeightPx();
  timelineHeightBeforeCollapse = null;
  const restored = Math.max(48, Math.min(220, Math.round(h)));
  document.documentElement.style.setProperty("--timeline-height", `${restored}px`);
  try {
    localStorage.setItem(LS.timelineHeight, String(restored));
  } catch (_) {}
}

function timelineHasEntries() {
  return !!timelinePanel && !timelinePanel.classList.contains("timeline-panel--empty");
}

function syncTimelineExpandTab() {
  if (!timelineExpandTab) return;
  const collapsed = !!timelinePanel?.classList.contains("timeline-panel--collapsed");
  const show = collapsed && timelineHasEntries();
  timelineExpandTab.style.display = show ? "flex" : "none";
  timelineExpandTab.hidden = !show;
}

function setTimelineCollapsed(v, { persist = true } = {}) {
  if (v && timelinePanel && !timelinePanel.classList.contains("timeline-panel--collapsed")) {
    timelineHeightBeforeCollapse = readTimelineHeightPx();
  }
  timelinePanel?.classList.toggle("timeline-panel--collapsed", v);
  if (timelinePanel && !v) {
    timelinePanel.style.removeProperty("height");
    restoreTimelineHeight();
  }
  const btn = getTimelineBtn();
  if (btn) {
    btn.title = v ? "Timeline collapsed" : "Collapse timeline";
    btn.setAttribute("aria-pressed", String(v));
  }
  syncTimelineExpandTab();
  if (persist) persistOpen(LS.timeline, !v);
  notifyLayoutChange();
}

function bindTimelineCollapseButton() {
  const btn = getTimelineBtn();
  if (!btn || !timelinePanel || btn.dataset.collapseBound === "1") return false;
  btn.dataset.collapseBound = "1";
  btn.addEventListener("click", () =>
    setTimelineCollapsed(!timelinePanel.classList.contains("timeline-panel--collapsed")));
  return true;
}

if (!bindTimelineCollapseButton()) {
  const timelineBtnObserver = new MutationObserver(() => {
    if (bindTimelineCollapseButton()) timelineBtnObserver.disconnect();
  });
  timelineBtnObserver.observe(document.body, { childList: true, subtree: true });
}
timelineExpandTab.addEventListener("click", () => setTimelineCollapsed(false));

window.addEventListener("render3d:timeline-entries", (event) => {
  const empty = !!(event.detail?.empty || !(event.detail?.count > 0));
  const wiring = document.getElementById("app")?.classList.contains("wiring-mode");
  if (empty && !wiring) {
    // No activities — hide the dock chrome (do not remember as user-collapsed).
    if (timelinePanel && !timelinePanel.classList.contains("timeline-panel--collapsed")) {
      setTimelineCollapsed(true, { persist: false });
    } else {
      syncTimelineExpandTab();
    }
  } else {
    // Activities exist — stay retracted unless the user had the timeline open.
    if (userChoseExpanded(LS.timeline)) {
      setTimelineCollapsed(false, { persist: false });
    } else {
      if (timelinePanel && !timelinePanel.classList.contains("timeline-panel--collapsed")) {
        setTimelineCollapsed(true, { persist: false });
      } else {
        syncTimelineExpandTab();
      }
    }
  }
});

// ── Restore persisted states ───────────────────────────────────────────────

addGutterCollapseButtons();

const leftSidebar = document.querySelector(".sidebar.left");
if (leftSidebar && !document.getElementById("btn-collapse-left-edge")) {
  const edgeBtn = document.createElement("button");
  edgeBtn.type = "button";
  edgeBtn.id = "btn-collapse-left-edge";
  edgeBtn.className = "sidebar-edge-collapse sidebar-edge-collapse--left";
  edgeBtn.title = "Collapse sidebar";
  edgeBtn.setAttribute("aria-label", "Collapse sidebar");
  edgeBtn.textContent = "◀";
  edgeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setSidebarHidden(true);
  });
  leftSidebar.appendChild(edgeBtn);
}

try {
  localStorage.removeItem("render3d:ribbonHidden");
  // Explore (left) starts open for new users. Right panel / timeline stay retracted
  // unless the user had already opened them.
  setSidebarHidden(userChoseCollapsed(LS.sidebar), { persist: false });
  setRightPanelHidden(!userChoseExpanded(LS.rightPanel), { persist: false });
  if (userChoseExpanded(LS.timeline)) {
    setTimelineCollapsed(false, { persist: false });
    const saved = parseFloat(localStorage.getItem(LS.timelineHeight));
    if (!Number.isFinite(saved) || saved < 48 || saved >= 110) {
      document.documentElement.style.setProperty("--timeline-height", `${DEFAULT_TIMELINE_HEIGHT}px`);
      localStorage.setItem(LS.timelineHeight, String(DEFAULT_TIMELINE_HEIGHT));
    }
  } else {
    setTimelineCollapsed(true, { persist: false });
  }
} catch (_) {}

export { setSidebarHidden, setRightPanelHidden, setTimelineCollapsed, resetLeftSidebarScroll };

// Let app.js open the AI compose panel even when this module loads after app.js.-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1-20260915-xragent3
try {
  window.Render3DPanels = {
    setSidebarHidden,
    setRightPanelHidden,
    setTimelineCollapsed,
    resetLeftSidebarScroll,
  };
} catch (_) {}
