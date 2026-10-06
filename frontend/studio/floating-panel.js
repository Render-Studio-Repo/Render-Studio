/** Drag handle + pixel-grid snapping for viewport HUD panels (press-pull, mirror, gizmo). */

export const PANEL_DRAG_GRID = 8;
const DOCK_RIGHT_INSET = 12;

function snapPx(v, grid = PANEL_DRAG_GRID) {
  return Math.round(v / grid) * grid;
}

function ensureGrip(panelEl) {
  if (panelEl.querySelector(".floating-panel-grip")) return;
  const grip = document.createElement("button");
  grip.type = "button";
  grip.className = "floating-panel-grip";
  grip.title = "Drag to move";
  grip.setAttribute("aria-label", "Drag panel");
  grip.textContent = "⠿";
  panelEl.appendChild(grip);
}

export function createFloatingPanelBehavior(viewportEl, panelEl) {
  let manual = false;
  let dragState = null;

  function clamp(x, y) {
    const rect = viewportEl.getBoundingClientRect();
    const w = panelEl.offsetWidth || 280;
    const h = panelEl.offsetHeight || 200;
    return {
      x: Math.min(Math.max(snapPx(x), 8), Math.max(8, rect.width - w - 8)),
      y: Math.min(Math.max(snapPx(y), 8), Math.max(8, rect.height - h - 8)),
    };
  }

  function setPosition(x, y, { manual: isManual = false } = {}) {
    panelEl.style.right = "auto";
    panelEl.style.bottom = "auto";
    panelEl.style.transform = "none";
    const c = clamp(x, y);
    panelEl.style.left = `${c.x}px`;
    panelEl.style.top = `${c.y}px`;
    if (isManual) manual = true;
    return c;
  }

  /** Dock on the right edge; optional anchorY keeps vertical alignment with a viewport point. */
  function dockRight(anchorY = null) {
    if (manual) return;
    const rect = viewportEl.getBoundingClientRect();
    const w = panelEl.offsetWidth || 280;
    const h = panelEl.offsetHeight || 200;
    const x = rect.width - w - DOCK_RIGHT_INSET;
    const y = anchorY != null
      ? Math.min(Math.max(snapPx(anchorY - h / 2), 8), Math.max(8, rect.height - h - 8))
      : 16;
    setPosition(x, y);
  }

  function bindDrag() {
    ensureGrip(panelEl);
    const grip = panelEl.querySelector(".floating-panel-grip");
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragState = {
        id: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        left: parseFloat(panelEl.style.left) || 0,
        top: parseFloat(panelEl.style.top) || 0,
      };
      panelEl.classList.add("floating-panel--dragging");
      grip.setPointerCapture?.(e.pointerId);
    });
    grip.addEventListener("pointermove", (e) => {
      if (!dragState || e.pointerId !== dragState.id) return;
      e.preventDefault();
      setPosition(
        dragState.left + (e.clientX - dragState.sx),
        dragState.top + (e.clientY - dragState.sy),
        { manual: true },
      );
    });
    const endDrag = (e) => {
      if (!dragState || e.pointerId !== dragState.id) return;
      grip.releasePointerCapture?.(e.pointerId);
      panelEl.classList.remove("floating-panel--dragging");
      dragState = null;
    };
    grip.addEventListener("pointerup", endDrag);
    grip.addEventListener("pointercancel", endDrag);

    panelEl.addEventListener("contextmenu", (e) => e.preventDefault());
    panelEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".floating-panel-grip")) return;
      e.stopPropagation();
    });
  }

  function reset() {
    manual = false;
    dragState = null;
    panelEl.classList.remove("floating-panel--dragging");
  }

  return {
    dockRight,
    setPosition,
    bindDrag,
    reset,
    get isManual() {
      return manual;
    },
  };
}
