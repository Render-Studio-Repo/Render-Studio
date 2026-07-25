/**
 * LOCKED INVARIANT — Cmd+Z after gizmo move must never wipe sibling parts.
 *
 * Do not delete this module or fold it back into a “just call undoTimeline()”
 * shortcut. See `.cursor/rules/cmdz-transform-undo.mdc` and AGENTS.md.
 *
 * History: when transform undo fell through to generation timeline undo, the
 * previous prompt snapshot restored and deleted other assembly parts.
 */

export function isTimelineTransformEntry(entry) {
  if (!entry) return false;
  const kind = String(entry.kind || entry.action || entry.type || "").toLowerCase();
  return kind === "transform" || kind === "body_transform" || kind.includes("transform");
}

/**
 * Undo one viewport transform action.
 * @returns {{ handled: true, undid: boolean }} always handled=true for transform
 *   actions so Cmd+Z hotkeys must not fall through to generation undo.
 */
export function undoViewportTransformAction(action, ctx = {}) {
  const {
    undoStack,
    redoStack,
    timelineEntries = [],
    timelineIndex = -1,
    resolveMesh,
    cancelPendingApply,
    resetDragBaseline,
    refreshGizmo,
    setStatus,
    undoTimeline,
  } = ctx;

  if (!action || action.type !== "transform") {
    return { handled: false, undid: false };
  }

  const tip = timelineIndex >= 0 ? timelineEntries[timelineIndex] : null;
  const tipIsTransform = isTimelineTransformEntry(tip);

  // Baked transform: timeline undo only when tip is itself a transform.
  if (action.committed && tipIsTransform && timelineIndex > 0) {
    redoStack.push(action);
    cancelPendingApply?.();
    void undoTimeline?.();
    return { handled: true, undid: true };
  }

  const mesh = resolveMesh?.(action);
  if (mesh && action.before) {
    cancelPendingApply?.();
    mesh.position.fromArray(action.before.position);
    mesh.quaternion.fromArray(action.before.quaternion);
    mesh.scale.fromArray(action.before.scale);
    mesh.updateMatrixWorld?.(true);
    resetDragBaseline?.();
    refreshGizmo?.();
    setStatus?.("ok", "Undid move/rotate.");
    redoStack.push(action);
    return { handled: true, undid: true };
  }

  // Only fall back to timeline when the tip itself is a transform.
  // Never undo a generation/prompt step from a transform action — that deletes parts.
  if (tipIsTransform && timelineIndex > 0) {
    redoStack.push(action);
    cancelPendingApply?.();
    void undoTimeline?.();
    return { handled: true, undid: true };
  }

  // Could not safely undo — put the action back. Caller must NOT call undoTimeline().
  undoStack.push(action);
  setStatus?.("error", "Nothing to undo.");
  return { handled: true, undid: false };
}

/**
 * Redo one viewport transform action (mirror of undo policy).
 */
export function redoViewportTransformAction(action, ctx = {}) {
  const {
    undoStack,
    redoStack,
    timelineEntries = [],
    timelineIndex = -1,
    resolveMesh,
    resetDragBaseline,
    refreshGizmo,
    setStatus,
    redoTimeline,
  } = ctx;

  if (!action || action.type !== "transform") {
    return { handled: false, undid: false };
  }

  const next = timelineIndex + 1 < timelineEntries.length ? timelineEntries[timelineIndex + 1] : null;
  const nextIsTransform = isTimelineTransformEntry(next);

  if (action.committed && nextIsTransform) {
    undoStack.push(action);
    void redoTimeline?.();
    return { handled: true, undid: true };
  }

  const mesh = resolveMesh?.(action);
  if (mesh && action.after) {
    mesh.position.fromArray(action.after.position);
    mesh.quaternion.fromArray(action.after.quaternion);
    mesh.scale.fromArray(action.after.scale);
    mesh.updateMatrixWorld?.(true);
    resetDragBaseline?.();
    refreshGizmo?.();
    setStatus?.("ok", "Redid move/rotate.");
    undoStack.push(action);
    return { handled: true, undid: true };
  }

  if (nextIsTransform) {
    undoStack.push(action);
    void redoTimeline?.();
    return { handled: true, undid: true };
  }

  redoStack.push(action);
  setStatus?.("error", "Nothing to redo.");
  return { handled: true, undid: false };
}

/** True when Cmd+Z must not fall through to generation/timeline undo. */
export function viewportUndoBlocksTimelineFallthrough(stack = []) {
  const top = stack.length ? stack[stack.length - 1] : null;
  return top?.type === "transform";
}
