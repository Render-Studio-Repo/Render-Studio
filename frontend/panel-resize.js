/** Draggable panel widths and vertical splits (persisted in localStorage). */

const STORAGE = {
  leftWidth: "render3d:leftPanelWidth",
  rightWidth: "render3d:rightPanelWidth",
  leftLogHeight: "render3d:leftLogHeight",
  timelineHeight: "render3d:timelineHeight",
};

const DEFAULTS = {
  leftWidth: 260,
  rightWidth: 320,
  leftLogHeight: 160,
  timelineHeight: 140,
};

const LIMITS = {
  leftWidth: [180, 520],
  rightWidth: [220, 560],
  leftLogHeight: [72, 480],
  timelineHeight: [64, 360],
};

function clamp(n, [min, max]) {
  return Math.min(max, Math.max(min, n));
}

function loadNum(key, fallback) {
  const v = parseFloat(localStorage.getItem(key));
  return Number.isFinite(v) ? v : fallback;
}

function saveNum(key, value) {
  localStorage.setItem(key, String(Math.round(value)));
}

function makeRowHandle(label) {
  const el = document.createElement("div");
  el.className = "resize-handle resize-handle--row";
  el.setAttribute("role", "separator");
  el.setAttribute("aria-orientation", "horizontal");
  el.setAttribute("aria-label", label);
  el.tabIndex = 0;
  return el;
}

function makeColGutter(gutterId, label) {
  const el = document.createElement("div");
  el.className = "panel-gutter-v";
  el.dataset.gutter = gutterId;
  el.setAttribute("role", "separator");
  el.setAttribute("aria-orientation", "vertical");
  el.setAttribute("aria-label", label);
  el.tabIndex = 0;
  return el;
}

function bindDrag(handle, cursorClass, onMove, onEnd) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    let state = onMove(e, true);
    document.body.classList.add("panel-resizing", cursorClass);

    const move = (ev) => {
      state = onMove(ev, false, state) ?? state;
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      document.body.classList.remove("panel-resizing", cursorClass);
      onEnd?.(state);
      window.dispatchEvent(new Event("resize"));
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
  });
}

export function initPanelResize() {
  const app = document.getElementById("app");
  const leftSidebar = document.querySelector(".sidebar.left");
  const rightSidebar = document.querySelector(".sidebar.right");
  const mainColumn = document.querySelector(".main-column");
  const leftLogDock = document.getElementById("activity-log-panel");
  const timelinePanel = document.getElementById("timeline-panel");
  if (!app || !leftSidebar || !rightSidebar || !mainColumn || !leftLogDock || !timelinePanel) {
    console.warn("initPanelResize: layout elements missing");
    return;
  }

  const root = document.documentElement;

  function setLeftWidth(px) {
    const w = clamp(px, LIMITS.leftWidth);
    root.style.setProperty("--left-panel-width", `${w}px`);
    return w;
  }

  function setRightWidth(px) {
    const w = clamp(px, LIMITS.rightWidth);
    root.style.setProperty("--right-panel-width", `${w}px`);
    return w;
  }

  function setLeftLogHeight(px) {
    const max = Math.max(LIMITS.leftLogHeight[0], leftSidebar.clientHeight * 0.85);
    const h = clamp(px, [LIMITS.leftLogHeight[0], Math.min(LIMITS.leftLogHeight[1], max)]);
    root.style.setProperty("--left-log-height", `${h}px`);
    return h;
  }

  function setTimelineHeight(px) {
    const max = Math.max(LIMITS.timelineHeight[0], mainColumn.clientHeight * 0.65);
    const h = clamp(px, [LIMITS.timelineHeight[0], Math.min(LIMITS.timelineHeight[1], max)]);
    root.style.setProperty("--timeline-height", `${h}px`);
    return h;
  }

  setLeftWidth(loadNum(STORAGE.leftWidth, DEFAULTS.leftWidth));
  setRightWidth(loadNum(STORAGE.rightWidth, DEFAULTS.rightWidth));
  setLeftLogHeight(loadNum(STORAGE.leftLogHeight, DEFAULTS.leftLogHeight));
  setTimelineHeight(loadNum(STORAGE.timelineHeight, DEFAULTS.timelineHeight));

  const leftGutter = makeColGutter("left-split", "Resize left panel");
  const rightGutter = makeColGutter("right-split", "Resize right panel");
  app.appendChild(leftGutter);
  app.appendChild(rightGutter);

  const leftRowHandle = makeRowHandle("Resize activity log");
  leftSidebar.insertBefore(leftRowHandle, leftLogDock);

  const timelineRowHandle = makeRowHandle("Resize timeline");
  timelineRowHandle.id = "timeline-resize-handle";
  mainColumn.insertBefore(timelineRowHandle, timelinePanel);

  bindDrag(leftGutter, "panel-resizing-col", (e, isStart, state) => {
    if (isStart) {
      return { startX: e.clientX, startW: leftSidebar.offsetWidth };
    }
    setLeftWidth(state.startW + (e.clientX - state.startX));
    return state;
  }, () => saveNum(STORAGE.leftWidth, leftSidebar.offsetWidth));

  bindDrag(rightGutter, "panel-resizing-col", (e, isStart, state) => {
    if (isStart) {
      return { startX: e.clientX, startW: rightSidebar.offsetWidth };
    }
    setRightWidth(state.startW - (e.clientX - state.startX));
    return state;
  }, () => saveNum(STORAGE.rightWidth, rightSidebar.offsetWidth));

  bindDrag(leftRowHandle, "panel-resizing-row", (e, isStart, state) => {
    if (isStart) {
      return { startY: e.clientY, startH: leftLogDock.offsetHeight };
    }
    setLeftLogHeight(state.startH - (e.clientY - state.startY));
    return state;
  }, () => saveNum(STORAGE.leftLogHeight, leftLogDock.offsetHeight));

  bindDrag(timelineRowHandle, "panel-resizing-row", (e, isStart, state) => {
    if (isStart) {
      return { startY: e.clientY, startH: timelinePanel.offsetHeight };
    }
    setTimelineHeight(state.startH - (e.clientY - state.startY));
    return state;
  }, () => {
    if (!timelinePanel.classList.contains("timeline-panel--collapsed")) {
      saveNum(STORAGE.timelineHeight, timelinePanel.offsetHeight);
    }
  });

  window.addEventListener("resize", () => {
    setLeftLogHeight(leftLogDock.offsetHeight);
    if (!timelinePanel.classList.contains("timeline-panel--collapsed")) {
      setTimelineHeight(timelinePanel.offsetHeight);
    }
  });
}
