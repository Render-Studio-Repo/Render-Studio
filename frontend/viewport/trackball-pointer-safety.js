/**
 * Stop TrackballControls from staying in ROTATE/PAN/ZOOM after a missed
 * pointerup (mouse released outside the canvas, capture lost, enabled flipped
 * mid-drag, tab blur). Without this, moveCurr keeps updating and the view
 * follows the cursor after you let go.
 */

const STATE_NONE = -1;

/**
 * @param {import("three/addons/controls/TrackballControls.js").TrackballControls} controls
 * @param {HTMLElement} domElement
 * @returns {{ endDrag: () => void, dispose: () => void }}
 */
export function installTrackballPointerSafety(controls, domElement) {
  if (!controls || !domElement) {
    return { endDrag() {}, dispose() {} };
  }

  let active = false;

  function endDrag() {
    if (!controls) return;
    const wasActive = controls.state !== STATE_NONE
      || (Array.isArray(controls._pointers) && controls._pointers.length > 0);
    if (!wasActive && !active) return;
    active = false;

    controls.state = STATE_NONE;
    if ("keyState" in controls) controls.keyState = STATE_NONE;
    if (typeof controls._lastAngle === "number") controls._lastAngle = 0;

    if (controls._movePrev && controls._moveCurr?.copy) {
      controls._movePrev.copy(controls._moveCurr);
    }
    if (controls._zoomStart && controls._zoomEnd?.copy) {
      controls._zoomStart.copy(controls._zoomEnd);
    }
    if (controls._panStart && controls._panEnd?.copy) {
      controls._panStart.copy(controls._panEnd);
    }

    if (Array.isArray(controls._pointers)) controls._pointers.length = 0;
    if (controls._pointerPositions && typeof controls._pointerPositions === "object") {
      for (const key of Object.keys(controls._pointerPositions)) {
        delete controls._pointerPositions[key];
      }
    }

    try {
      domElement.removeEventListener("pointermove", controls._onPointerMove);
      domElement.removeEventListener("pointerup", controls._onPointerUp);
    } catch {
      /* ignore */
    }
  }

  function onPointerDown() {
    // Defer — Trackball sets state in its own pointerdown handler.
    queueMicrotask(() => {
      active = controls.state !== STATE_NONE
        || (Array.isArray(controls._pointers) && controls._pointers.length > 0);
    });
  }

  function onPointerMove(event) {
    if (!active && controls.state === STATE_NONE) return;
    // Mouse buttons cleared but controls still think they're dragging.
    if (event.pointerType === "mouse" && event.buttons === 0 && controls.state !== STATE_NONE) {
      endDrag();
    }
  }

  function onPointerUp(event) {
    if (event.pointerType === "mouse" && event.buttons === 0) {
      endDrag();
      return;
    }
    if (event.pointerType !== "mouse") {
      // Touch/pen: end when no pointers remain on this element.
      queueMicrotask(() => {
        if (!Array.isArray(controls._pointers) || controls._pointers.length === 0) {
          endDrag();
        }
      });
    }
  }

  function onBlurOrHide() {
    endDrag();
  }

  // Capture phase so we still run if other handlers stopPropagation.
  domElement.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("blur", onBlurOrHide);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) onBlurOrHide();
  });

  // If something disables controls mid-drag (gizmo, select, architect), end cleanly.
  let enabledDesc = Object.getOwnPropertyDescriptor(controls, "enabled");
  if (!enabledDesc || enabledDesc.configurable) {
    let enabledValue = controls.enabled !== false;
    Object.defineProperty(controls, "enabled", {
      configurable: true,
      enumerable: true,
      get() {
        return enabledValue;
      },
      set(next) {
        const on = next !== false;
        if (enabledValue && !on) endDrag();
        enabledValue = on;
      },
    });
  }

  return {
    endDrag,
    isBusy() {
      return active
        || controls.state !== STATE_NONE
        || (Array.isArray(controls._pointers) && controls._pointers.length > 0);
    },
    dispose() {
      endDrag();
      domElement.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("blur", onBlurOrHide);
    },
  };
}
