const SPLIT_INLINE_PROPERTIES = [
  "display",
  "position",
  "inset",
  "top",
  "grid-column",
  "grid-row",
  "width",
  "height",
  "visibility",
];

/** Clear the old live pane and document before another monitor takes its place. */
export function prepareRoboticsMonitorReplacement(docTabs, { replaceId = "", onReplace = null, documentRef = globalThis.document } = {}) {
  clearRoboticsMonitorSplitPresentation(documentRef);
  onReplace?.();
  if (replaceId && docTabs?.has?.(replaceId)) docTabs.remove?.(replaceId);
}

/** Build the Robotics Home + live viewer as one horizontal split. */
export function setRoboticsMonitorSideSplit(docTabs, { homeId, liveId, ratio = 0.46 } = {}) {
  if (!docTabs?.split?.("right", liveId, { ratio, notify: false })) return false;
  docTabs.setActive?.(homeId, { notify: false });
  return true;
}

/** Remove the inline !important presentation applied by Robotics monitor split. */
export function clearRoboticsMonitorSplitPresentation(documentRef = globalThis.document) {
  const column = documentRef?.querySelector?.(".main-column");
  column?.classList?.remove?.("robotics-monitor-split");
  for (const id of ["robotics-home-viewer", "viser-viewer", "simulation-viewer"]) {
    const pane = documentRef?.getElementById?.(id);
    for (const property of SPLIT_INLINE_PROPERTIES) pane?.style?.removeProperty?.(property);
  }
  documentRef?.getElementById?.("viewport")?.style?.removeProperty?.("display");
}
