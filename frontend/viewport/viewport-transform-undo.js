/**
 * LOCKED INVARIANT — Cmd+Z after gizmo move must never wipe sibling parts
 * or switch projects.
 *
 * Do not delete this module or fold it back into a “just call undoTimeline()”
 * shortcut. See `.cursor/rules/cmdz-transform-undo.mdc` and AGENTS.md.
 *
 * History: when transform undo fell through to generation timeline undo, the
 * previous prompt snapshot restored, deleted other assembly parts, and could
 * adoptCopiedProject() into a different project.
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
    resolveMesh,
    cancelPendingApply,
    resetDragBaseline,
    refreshGizmo,
    setStatus,
  } = ctx;

  if (!action || action.type !== "transform") {
    return { handled: false, undid: false };
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

  // Could not restore the live pose — put the action back.
  // Never call undoTimeline() from here (restores generations / can switch projects).
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
    resolveMesh,
    resetDragBaseline,
    refreshGizmo,
    setStatus,
  } = ctx;

  if (!action || action.type !== "transform") {
    return { handled: false, undid: false };
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

  redoStack.push(action);
  setStatus?.("error", "Nothing to redo.");
  return { handled: true, undid: false };
}

/** True when Cmd+Z must not fall through to generation/timeline undo. */
export function viewportUndoBlocksTimelineFallthrough(stack = []) {
  const top = stack.length ? stack[stack.length - 1] : null;
  return top?.type === "transform";
}
