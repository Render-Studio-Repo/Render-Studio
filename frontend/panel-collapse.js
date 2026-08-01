/**
 * Collapsible panels — left sidebar, right panel, activity log.
 * Loaded as a module after app.js so all DOM elements exist.
 */

const LS = {
  sidebar: "render3d:sidebarHidden",
  rightPanel: "render3d:rightPanelHidden",
  log: "render3d:logCollapsed",
  timeline: "render3d:timelineCollapsed",
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
document.body.appendChild(reopenTabLeft);

// Fixed re-open tab on the right edge when right panel is collapsed
const reopenTabRight = document.createElement("button");
reopenTabRight.id = "right-panel-reopen-tab";
reopenTabRight.title = "Open right panel";
reopenTabRight.setAttribute("aria-label", "Open right panel");
reopenTabRight.textContent = "◀";
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

function readFlag(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch (_) {
    return false;
  }
}

function setSidebarHidden(v) {
  appEl?.classList.toggle("left-panel-hidden", v);
  reopenTabLeft.style.display = v ? "flex" : "none";
  if (btnSidebar) {
    btnSidebar.setAttribute("aria-pressed", String(v));
    btnSidebar.title = v ? "Show sidebar" : "Hide sidebar";
  }
  try {
    localStorage.setItem(LS.sidebar, v ? "1" : "0");
  } catch (_) {}
  notifyLayoutChange();
}

function setRightPanelHidden(v) {
  appEl?.classList.toggle("right-panel-hidden", v);
  reopenTabRight.style.display = v ? "flex" : "none";
  if (btnCollapseRight) {
    btnCollapseRight.setAttribute("aria-pressed", String(v));
    btnCollapseRight.title = v ? "Show wiring panel" : "Hide wiring panel";
    btnCollapseRight.textContent = v ? "◀" : "▶";
  }
  try {
    localStorage.setItem(LS.rightPanel, v ? "1" : "0");
  } catch (_) {}
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

// ── Activity log ───────────────────────────────────────────────────────────

const logDock = document.getElementById("activity-log-panel");

function getLogBtn() {
  return document.getElementById("btn-log-collapse");
}

function setLogCollapsed(v) {
  logDock?.classList.toggle("log-dock--collapsed", v);
  const btn = getLogBtn();
  if (btn) {
    btn.innerHTML = v
      ? '<span style="font-size:1em">▶</span> Activity log'
      : '<span style="font-size:1em">▼</span> Activity log';
    btn.title = v ? "Show activity log" : "Hide activity log";
    btn.setAttribute("aria-pressed", String(v));
  }
  try {
    localStorage.setItem(LS.log, v ? "1" : "0");
  } catch (_) {}
}

function bindLogCollapseButton() {
  const btn = getLogBtn();
  if (!btn || !logDock || btn.dataset.collapseBound === "1") return false;
  btn.dataset.collapseBound = "1";
  btn.addEventListener("click", () =>
    setLogCollapsed(!logDock.classList.contains("log-dock--collapsed")));
  setLogCollapsed(readFlag(LS.log));
  return true;
}

if (!bindLogCollapseButton()) {
  const logObserver = new MutationObserver(() => {
    if (bindLogCollapseButton()) logObserver.disconnect();
  });
  logObserver.observe(document.body, { childList: true, subtree: true });
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

function setTimelineCollapsed(v) {
  if (v && timelinePanel && !timelinePanel.classList.contains("timeline-panel--collapsed")) {
    timelineHeightBeforeCollapse = readTimelineHeightPx();
  }
  timelinePanel?.classList.toggle("timeline-panel--collapsed", v);
  if (timelineExpandTab) timelineExpandTab.style.display = v ? "flex" : "none";
  if (timelinePanel && !v) {
    timelinePanel.style.removeProperty("height");
    restoreTimelineHeight();
  }
  const btn = getTimelineBtn();
  if (btn) {
    btn.title = v ? "Timeline collapsed" : "Collapse timeline";
    btn.setAttribute("aria-pressed", String(v));
  }
  try {
    localStorage.setItem(LS.timeline, v ? "1" : "0");
  } catch (_) {}
  notifyLayoutChange();
}

const _timelineBtn = getTimelineBtn();
if (_timelineBtn && timelinePanel) {
  _timelineBtn.addEventListener("click", () =>
    setTimelineCollapsed(!timelinePanel.classList.contains("timeline-panel--collapsed")));
}
timelineExpandTab.addEventListener("click", () => setTimelineCollapsed(false));

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
  if (readFlag(LS.sidebar)) setSidebarHidden(true);
  if (readFlag(LS.rightPanel)) setRightPanelHidden(true);
  if (readFlag(LS.log)) setLogCollapsed(true);
  bindLogCollapseButton();
  if (readFlag(LS.timeline)) setTimelineCollapsed(true);
  else {
    const saved = parseFloat(localStorage.getItem(LS.timelineHeight));
    // Reset missing/corrupt/legacy tall card heights to the slim dock default.
    if (!Number.isFinite(saved) || saved < 48 || saved >= 110) {
      document.documentElement.style.setProperty("--timeline-height", `${DEFAULT_TIMELINE_HEIGHT}px`);
      localStorage.setItem(LS.timelineHeight, String(DEFAULT_TIMELINE_HEIGHT));
    }
  }
} catch (_) {}

const _initialLogBtn = getLogBtn();
if (_initialLogBtn && !readFlag(LS.log)) {
  _initialLogBtn.innerHTML = '<span style="font-size:1em">▼</span> Activity log';
}

export { setSidebarHidden, setRightPanelHidden, resetLeftSidebarScroll };
