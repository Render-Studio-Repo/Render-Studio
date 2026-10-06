/** Shared closable tab strip for DXF + PDF/TXT/image/McMaster document viewers. */

export const CLIP_EDITOR_TAB_ID = "__clip_editor__";
export const CANVAS_TAB_ID = "__canvas__";
export const VIEWPORT_TAB_ID = "__viewport__";
export const WORKSPACE_TAB_ID = "workshop:open";
export const WORKSHOP_TAB_ID = "workshop:open";
export const ROBOTICS_HOME_TAB_ID = "robotics:home";
export const APPROVALS_TAB_ID = "approvals:debug";
export const WIRING_TAB_ID = "__wiring__";
export const VIEWPORT_SHELL = "viewport";
export const SPLIT_DIRECTIONS = Object.freeze(["up", "left", "down", "right"]);
const SPLIT_RATIO_KEY = "render3d:viewport-doc-split-ratio";
const SPLIT_CROSS_RATIO_KEY = "render3d:viewport-doc-split-cross-ratio";
const SPLIT_MIN = 0.22;
const SPLIT_MAX = 0.78;
const HORIZ_DIRS = new Set(["left", "right"]);

export function isOrthogonalSplit(a, b) {
  const left = String(a || "").toLowerCase();
  const right = String(b || "").toLowerCase();
  if (!SPLIT_DIRECTIONS.includes(left) || !SPLIT_DIRECTIONS.includes(right)) return false;
  return HORIZ_DIRS.has(left) !== HORIZ_DIRS.has(right);
}

export function pickCompanionDocIds(tabIds, { used = [], prefer = "", need = 2 } = {}) {
  const ids = (tabIds || []).map(String).filter((id) => id && id !== VIEWPORT_TAB_ID);
  const taken = new Set((used || []).map(String).filter(Boolean));
  const out = [];
  if (prefer && ids.includes(prefer) && !taken.has(prefer)) out.push(prefer);
  for (const id of ids) {
    if (out.length >= need) break;
    if (!taken.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export function quadViewportSlot(hDir, vDir) {
  const row = String(vDir).toLowerCase() === "up" ? "s" : "n";
  const col = String(hDir).toLowerCase() === "right" ? "w" : "e";
  return `${row}${col}`;
}

export function quadSlotMap({ hDir, vDir, primaryDir, primaryId, crossId, extraId } = {}) {
  const horiz = HORIZ_DIRS.has(String(hDir).toLowerCase()) ? String(hDir).toLowerCase() : "left";
  const vert = String(vDir).toLowerCase() === "up" ? "up" : "down";
  const vp = quadViewportSlot(horiz, vert);
  const primaryIsHoriz = HORIZ_DIRS.has(String(primaryDir || horiz).toLowerCase());
  const row = vp[0];
  const col = vp[1];
  const horizSlot = `${row}${col === "e" ? "w" : "e"}`;
  const vertSlot = `${row === "n" ? "s" : "n"}${col}`;
  const farSlot = `${row === "n" ? "s" : "n"}${col === "e" ? "w" : "e"}`;
  const slots = { nw: null, ne: null, sw: null, se: null };
  slots[vp] = { type: "viewport", id: VIEWPORT_TAB_ID };
  slots[primaryIsHoriz ? horizSlot : vertSlot] = { type: "doc", id: primaryId || "" };
  slots[primaryIsHoriz ? vertSlot : horizSlot] = { type: "doc", id: crossId || "" };
  slots[farSlot] = { type: extraId ? "doc" : "empty", id: extraId || "" };
  return { slots, vpSlot: vp, hDir: horiz, vDir: vert };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function kindBadge(kind) {
  if (kind === VIEWPORT_SHELL) return "3D";
  if (kind === "dxf") return "DXF";
  if (kind === "pdf") return "PDF";
  if (kind === "text") return "TXT";
  if (kind === "code" || kind === "code-project") return "CODE";
  if (kind === "json") return "JSON";
  if (kind === "csv") return "CSV";
  if (kind === "spreadsheet") return "XLS";
  if (kind === "image") return "IMG";
  if (kind === "video" || kind === "clip") return "VID";
  if (kind === "audio") return "AUD";
  if (kind === "mcmaster") return "MC"; // mcmtab1
  if (kind === "parts") return "BOM";
  if (kind === "wiring") return "WIRE";
  if (kind === "viser") return "VR";
  if (kind === "viewport-layout") return "VIEW";
  if (kind === "teleop") return "BOT";
  if (kind === "simulation") return "SIM";
  if (kind === "robotics-home") return "BOT";
  if (kind === "worktop") return "TOP";
  if (kind === "workspace" || kind === "workshop") return "";
  if (kind === "approvals") return "";
  if (kind === "canvas") return "2D";
  if (kind === "editor") return "ED";
  return "FILE";
}

export function shellKindFromTab(tab) {
  if (!tab) return VIEWPORT_SHELL;
  return tab.kind || "file";
}

/** Hide the 3D canvas only while a document tab is the active shell (never on boot / Viewport). */
export function shouldHideViewportForShell(shell, {
  presenting = false,
  layout = "",
  canvasSplit = false,
  codeSplit = false,
  viewportSplit = false,
} = {}) {
  if (presenting) return false;
  if (viewportSplit) return false;
  if (!shell || shell === VIEWPORT_SHELL) return false;
  if (shell === "viewport-layout") return false;
  if (shell === "viser") return layout === "viser";
  if (shell === "canvas") return !canvasSplit;
  if (shell === "code-project" || shell === "code") return !codeSplit;
  if (shell === "teleop" || shell === "simulation" || shell === "robotics-home") return true;
  if (shell === "worktop" || shell === "workspace" || shell === "workshop" || shell === "approvals") return false;
  return true;
}

/** Circuit layout + schematic JSON/SVG from Reference Files / Electronics wiring. */
export function isWiringDiagramReference(entry = {}) {
  if (String(entry?.format || "").toLowerCase() === "wiring") return true;
  if (String(entry?.kind || "").toLowerCase() === "wiring") return true;
  const path = String(entry?.source_path || entry?.filename || entry?.url || entry?.name || "")
    .replace(/\\/g, "/")
    .split(/[?#]/)[0]
    .toLowerCase();
  const folder = String(entry?.folder || entry?.parent_folder || "").replace(/\\/g, "/").toLowerCase();
  const inElectronics = folder.includes("electronics wiring")
    || folder.includes("electronics-wiring")
    || path.includes("/electronics wiring/")
    || path.includes("/electronics-wiring/");
  const base = path.split("/").pop() || "";
  const stem = base.replace(/\.[^.]+$/, "");
  if (/^(wiring|schematic)(\.|$)/i.test(base)) return true;
  if (/\.(json|svg)$/i.test(base) && /(^|[._-])(wiring|schematic|circuit)([._-]|$)/i.test(stem)) return true;
  if (inElectronics && /\.(json|svg)$/i.test(base) && /wiring|schematic|circuit/i.test(stem)) return true;
  return false;
}

/** Right-click Viewport → split the active/next document; otherwise split that tab. */
export function splitDocIdForTab(clickedId, { activeId = null, tabIds = [] } = {}) {
  const clicked = String(clickedId || "");
  if (clicked && clicked !== VIEWPORT_TAB_ID) return clicked;
  const active = String(activeId || "");
  if (active && active !== VIEWPORT_TAB_ID) return active;
  const next = (tabIds || []).find((id) => id && id !== VIEWPORT_TAB_ID);
  return next || null;
}

function readSplitRatio() {
  try {
    const n = parseFloat(localStorage.getItem(SPLIT_RATIO_KEY));
    if (Number.isFinite(n)) return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n));
  } catch {
    /* ignore */
  }
  return 0.5;
}

function writeSplitRatio(ratio) {
  try {
    localStorage.setItem(SPLIT_RATIO_KEY, String(Math.round(ratio * 1000) / 1000));
  } catch {
    /* ignore */
  }
}

function readCrossRatio() {
  try {
    const n = parseFloat(localStorage.getItem(SPLIT_CROSS_RATIO_KEY));
    if (Number.isFinite(n)) return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n));
  } catch {
    /* ignore */
  }
  return 0.5;
}

function writeCrossRatio(ratio) {
  try {
    localStorage.setItem(SPLIT_CROSS_RATIO_KEY, String(Math.round(ratio * 1000) / 1000));
  } catch {
    /* ignore */
  }
}

export function revealViewportEl(viewport) {
  if (!viewport) return;
  viewport.classList.remove("doc-viewer-active", "dxf-viewer-active", "ref-viewer-active", "hidden");
  try { viewport.hidden = false; } catch { /* ignore */ }
  try { viewport.removeAttribute?.("hidden"); } catch { /* ignore */ }
  try {
    if (viewport.style?.visibility === "hidden") viewport.style.visibility = "";
  } catch { /* ignore */ }
  try {
    if (viewport.style?.display === "none") viewport.style.display = "";
  } catch { /* ignore */ }
}

export function shouldReloadViewportProject({ projectId = "", assemblyCount = 0, loading = false } = {}) {
  return Boolean(String(projectId || "").trim()) && Number(assemblyCount || 0) === 0 && !loading;
}

/** Viewport chip only when a document surface is the active shell. */
export function shouldShowViewportChip(activeId, { viewportPinned = false, pinnedCount = 0 } = {}) {
  return Boolean(activeId) || !!viewportPinned || pinnedCount > 0;
}

export function tabDisplayLabel(tab) {
  if (!tab) return "";
  return String(tab.customLabel || tab.label || tab.id || "").trim();
}

export function viewportTabsStorageKey(projectId) {
  return `render3d:viewport-tabs:${String(projectId || "").trim() || "none"}`;
}

export function isStudioShellTabId(id) {
  return id === VIEWPORT_TAB_ID || id === ROBOTICS_HOME_TAB_ID || id === WORKSHOP_TAB_ID || id === APPROVALS_TAB_ID || id === WORKSPACE_TAB_ID;
}

/**
 * Compact Viewport · Workshop · Approvals chips, then parked documents.
 */
export function buildShellTabStrip(tabs, activeId, opts = {}) {
  const docs = [...tabs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
    .filter((tab) => !isStudioShellTabId(tab.id));
  const viewportLabel = String(opts.viewportLabel || "Viewport").trim() || "Viewport";
  const viewportOn = !activeId || activeId === VIEWPORT_TAB_ID || activeId === VIEWPORT_SHELL;
  const items = [
    {
      id: VIEWPORT_TAB_ID,
      kind: VIEWPORT_SHELL,
      label: viewportLabel,
      badge: "",
      closable: !!opts.viewportLayoutActive,
      pinned: !!opts.viewportPinned,
      compact: true,
      active: viewportOn,
    },
    {
      id: ROBOTICS_HOME_TAB_ID,
      kind: "robotics-home",
      label: "Robotics Home",
      badge: "",
      closable: false,
      pinned: true,
      compact: true,
      active: activeId === ROBOTICS_HOME_TAB_ID,
    },
    {
      id: WORKSHOP_TAB_ID,
      kind: "workshop",
      label: "Workshop",
      badge: "",
      closable: false,
      pinned: true,
      compact: true,
      active: activeId === WORKSHOP_TAB_ID || activeId === WORKSPACE_TAB_ID,
    },
    {
      id: APPROVALS_TAB_ID,
      kind: "approvals",
      label: "Approvals",
      badge: "",
      closable: false,
      pinned: true,
      compact: true,
      active: activeId === APPROVALS_TAB_ID,
    },
  ];
  for (const tab of docs) {
    const dirty = tab.dirty ? " *" : "";
    items.push({
      id: tab.id,
      kind: tab.kind || "file",
      label: `${tabDisplayLabel(tab)}${dirty}`,
      badge: kindBadge(tab.kind),
      closable: !tab.pinned,
      pinned: !!tab.pinned,
      compact: false,
      active: tab.id === activeId,
    });
  }
  return items;
}

/**
 * @param {{
 *   tabBarEl?: HTMLElement | null,
 *   mainColumnEl?: HTMLElement | null,
 * }} options
 */
export function createDocumentTabBar(options = {}) {
  const { tabBarEl, mainColumnEl, getProjectId, onRename, resolveSplitPane, onSplit } = options;

  /** @type {Map<string, { id: string, label: string, kind: string, dirty?: boolean, pinned?: boolean, customLabel?: string }>} */
  const tabs = new Map();
  let activeId = null;
  let viewportLabel = "Viewport";
  let viewportPinned = false;
  let viewportLayoutActive = false;
  /** @type {{ direction: string | null, docId: string | null, ratio: number, cross: { direction: string, docId: string, extraId: string, ratio: number } | null }} */
  let split = { direction: null, docId: null, ratio: readSplitRatio(), cross: null };
  /** @type {((tab: { id: string, label: string, kind: string } | null) => void) | null} */
  let activateHandler = null;
  /** @type {((tab: { id: string, label: string, kind: string }) => void) | null} */
  let closeHandler = null;
  /** @type {HTMLElement | null} */
  let contextMenu = null;
  /** @type {HTMLElement | null} */
  let splitGutter = null;
  /** @type {HTMLElement | null} */
  let splitCrossGutter = null;
  /** @type {HTMLElement | null} */
  let splitEmptyPane = null;

  function persistState() {
    const projectId = getProjectId?.();
    if (!projectId || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(viewportTabsStorageKey(projectId), JSON.stringify({
        viewportLabel,
        viewportPinned,
        viewportLayoutActive,
        tabs: [...tabs.values()]
          .filter((tab) => tab.pinned || tab.customLabel)
          .map((tab) => ({
            id: tab.id,
            label: tab.label,
            kind: tab.kind,
            customLabel: tab.customLabel || "",
            pinned: !!tab.pinned,
            layout: tab.layout || null,
          })),
      }));
    } catch {
      /* ignore quota */
    }
  }

  function readPersisted() {
    const projectId = getProjectId?.();
    if (!projectId || typeof localStorage === "undefined") return null;
    try {
      return JSON.parse(localStorage.getItem(viewportTabsStorageKey(projectId)) || "null");
    } catch {
      return null;
    }
  }

  function ensureSplitGutter() {
    if (splitGutter || !mainColumnEl?.appendChild) return splitGutter;
    const el = document.createElement("div");
    el.id = "viewport-doc-split-gutter";
    el.className = "viewport-doc-split-gutter";
    el.setAttribute("role", "separator");
    el.setAttribute("data-split-axis", "primary");
    el.tabIndex = 0;
    el.addEventListener("pointerdown", (e) => onSplitGutterPointerDown(e, "primary"));
    mainColumnEl.appendChild(el);
    splitGutter = el;
    return el;
  }

  function ensureCrossGutter() {
    if (splitCrossGutter || !mainColumnEl?.appendChild) return splitCrossGutter;
    const el = document.createElement("div");
    el.id = "viewport-doc-split-gutter-cross";
    el.className = "viewport-doc-split-gutter viewport-doc-split-gutter--cross";
    el.setAttribute("role", "separator");
    el.setAttribute("data-split-axis", "cross");
    el.tabIndex = 0;
    el.addEventListener("pointerdown", (e) => onSplitGutterPointerDown(e, "cross"));
    mainColumnEl.appendChild(el);
    splitCrossGutter = el;
    return el;
  }

  function ensureEmptyPane() {
    if (splitEmptyPane || !mainColumnEl?.appendChild) return splitEmptyPane;
    const el = document.createElement("div");
    el.id = "viewport-split-empty";
    el.className = "vp-split-empty";
    el.innerHTML = `<strong>Pane</strong><span>Open another tab to fill this square</span>`;
    mainColumnEl.appendChild(el);
    splitEmptyPane = el;
    return el;
  }

  function splitDocIds() {
    const ids = [];
    if (split.docId) ids.push(split.docId);
    if (split.cross?.docId) ids.push(split.cross.docId);
    if (split.cross?.extraId) ids.push(split.cross.extraId);
    return [...new Set(ids.filter(Boolean))];
  }

  function hasSplitTab(id) {
    return Boolean(tabFromId(id));
  }

  function clearSlotClasses(node) {
    node?.classList?.remove?.(
      "vp-split-doc",
      "vp-split-slot-nw",
      "vp-split-slot-ne",
      "vp-split-slot-sw",
      "vp-split-slot-se",
    );
  }

  function markSplitPane() {
    try {
      document.querySelectorAll?.(".vp-split-doc, .vp-split-empty, [class*='vp-split-slot-']")?.forEach?.((node) => {
        clearSlotClasses(node);
        node.classList?.remove?.("is-on");
      });
    } catch {
      /* jsdom */
    }
    if (!split.direction || !split.docId) return;
    if (split.cross?.direction) {
      const hDir = HORIZ_DIRS.has(split.direction) ? split.direction : split.cross.direction;
      const vDir = HORIZ_DIRS.has(split.direction) ? split.cross.direction : split.direction;
      const { slots } = quadSlotMap({
        hDir,
        vDir,
        primaryDir: split.direction,
        primaryId: split.docId,
        crossId: split.cross.docId,
        extraId: split.cross.extraId,
      });
      for (const [slot, cell] of Object.entries(slots)) {
        if (!cell) continue;
        if (cell.type === "viewport") {
          const viewport = typeof document !== "undefined" ? document.getElementById?.("viewport") : null;
          viewport?.classList?.add(`vp-split-slot-${slot}`);
          continue;
        }
        if (cell.type === "empty" || !cell.id) {
          const empty = ensureEmptyPane();
          empty?.classList?.add("vp-split-doc", `vp-split-slot-${slot}`, "is-on");
          continue;
        }
        const tab = tabFromId(cell.id) || { id: cell.id, kind: "file", label: cell.id };
        const pane = resolveSplitPane?.(tab);
        pane?.classList?.add("vp-split-doc", `vp-split-slot-${slot}`);
        pane?.classList?.remove?.("hidden");
        try {
          if (pane?.style?.display === "none") pane.style.display = "";
          if (pane?.style?.visibility === "hidden") pane.style.visibility = "";
        } catch {
          /* ignore */
        }
      }
      return;
    }
    const tab = tabFromId(split.docId);
    const pane = resolveSplitPane?.(tab || { id: split.docId, kind: "file", label: split.docId });
    pane?.classList?.add("vp-split-doc");
    pane?.classList?.remove?.("hidden");
  }

  function applySplitChrome() {
    const on = Boolean(split.direction && split.docId && hasSplitTab(split.docId));
    const quad = Boolean(on && split.cross?.direction && (split.cross.docId || split.cross.extraId));
    const dir = on ? split.direction : "";
    const kind = on ? (tabFromId(split.docId)?.kind || "file") : "";
    mainColumnEl?.classList.toggle("viewport-doc-split", on);
    mainColumnEl?.classList.toggle("viewport-doc-quad", quad);
    if (on) {
      mainColumnEl?.setAttribute("data-split-dir", dir);
      mainColumnEl?.setAttribute("data-split-kind", kind);
      mainColumnEl?.setAttribute("data-split-quad", quad ? "1" : "0");
      if (quad) mainColumnEl?.setAttribute("data-split-cross", split.cross.direction);
      else mainColumnEl?.removeAttribute?.("data-split-cross");
      mainColumnEl?.style?.setProperty?.("--vp-split-ratio", `${Math.round(split.ratio * 1000) / 10}%`);
      mainColumnEl?.style?.setProperty?.("--vp-split-cross", `${Math.round((split.cross?.ratio || 0.5) * 1000) / 10}%`);
      const gutter = ensureSplitGutter();
      gutter?.classList.toggle("hidden", false);
      gutter?.setAttribute("aria-orientation", dir === "up" || dir === "down" ? "horizontal" : "vertical");
      gutter?.setAttribute("aria-label", "Resize split with viewport");
      gutter?.classList.toggle("viewport-doc-split-gutter--row", !quad && (dir === "up" || dir === "down"));
      const crossGutter = ensureCrossGutter();
      crossGutter?.classList.toggle("hidden", !quad);
      if (quad) {
        const crossVert = split.cross.direction === "up" || split.cross.direction === "down";
        crossGutter?.setAttribute("aria-orientation", crossVert ? "horizontal" : "vertical");
        crossGutter?.setAttribute("aria-label", "Resize quad split");
        crossGutter?.classList.toggle("viewport-doc-split-gutter--row", crossVert);
      }
      if (quad && !split.cross.extraId) ensureEmptyPane();
      else splitEmptyPane?.classList?.remove?.("is-on", "vp-split-doc");
    } else {
      mainColumnEl?.removeAttribute?.("data-split-dir");
      mainColumnEl?.removeAttribute?.("data-split-kind");
      mainColumnEl?.removeAttribute?.("data-split-quad");
      mainColumnEl?.removeAttribute?.("data-split-cross");
      splitGutter?.classList.toggle("hidden", true);
      splitCrossGutter?.classList.toggle("hidden", true);
      splitEmptyPane?.classList?.remove?.("is-on", "vp-split-doc");
    }
    markSplitPane();
  }

  function onSplitGutterPointerDown(e, axis = "primary") {
    if (!split.direction || e.button !== 0) return;
    const usingCross = axis === "cross" && split.cross;
    const dir = usingCross ? split.cross.direction : split.direction;
    e.preventDefault();
    const start = usingCross ? split.cross.ratio : split.ratio;
    const vertical = dir === "left" || dir === "right";
    const box = mainColumnEl?.getBoundingClientRect?.();
    const size = vertical ? (box?.width || 1) : (box?.height || 1);
    const origin = vertical ? e.clientX : e.clientY;
    try { document.body?.classList?.add("panel-resizing", vertical ? "col-resize" : "row-resize"); } catch { /* ignore */ }
    const move = (ev) => {
      const delta = ((vertical ? ev.clientX : ev.clientY) - origin) / size;
      const next = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, start + delta));
      if (usingCross) {
        split.cross.ratio = next;
        mainColumnEl?.style?.setProperty?.("--vp-split-cross", `${Math.round(next * 1000) / 10}%`);
      } else {
        split.ratio = next;
        mainColumnEl?.style?.setProperty?.("--vp-split-ratio", `${Math.round(next * 1000) / 10}%`);
      }
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      try { document.body?.classList?.remove("panel-resizing", "col-resize", "row-resize"); } catch { /* ignore */ }
      if (usingCross) writeCrossRatio(split.cross.ratio);
      else writeSplitRatio(split.ratio);
      onSplit?.(getSplitState());
      window.dispatchEvent?.(new Event("resize"));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  }

  function getSplitState() {
    if (!split.direction) return null;
    const out = { direction: split.direction, docId: split.docId, ratio: split.ratio };
    if (split.cross?.direction) out.cross = { ...split.cross };
    return out;
  }

  function clearSplit({ notify = true } = {}) {
    const had = Boolean(split.direction);
    split.direction = null;
    split.docId = null;
    split.cross = null;
    applySplitChrome();
    if (had && notify) onSplit?.({ direction: null, docId: null, ratio: split.ratio, cross: null });
  }

  function applySplit(direction, clickedId, { notify = true, ratio, extraId, crossRatio } = {}) {
    const dir = String(direction || "").toLowerCase();
    if (!SPLIT_DIRECTIONS.includes(dir)) return false;
    const docId = splitDocIdForTab(clickedId, { activeId, tabIds: [...tabs.keys()] });
    if (!docId || !hasSplitTab(docId)) return false;
    if (split.direction && isOrthogonalSplit(split.direction, dir)) {
      const requestedCross = docId !== split.docId ? docId : "";
      const requestedExtra = extraId && extraId !== split.docId && extraId !== requestedCross ? extraId : "";
      const companions = pickCompanionDocIds([...tabs.keys()], {
        used: [split.docId, requestedCross, requestedExtra],
        need: 2,
      });
      const crossDoc = requestedCross || companions[0] || "";
      const farDoc = requestedExtra || companions.find((id) => id !== crossDoc) || "";
      if (!hasSplitTab(crossDoc)) return false;
      split.cross = {
        direction: dir,
        docId: crossDoc,
        extraId: farDoc,
        ratio: Number.isFinite(Number(crossRatio))
          ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Number(crossRatio)))
          : readCrossRatio(),
      };
      writeCrossRatio(split.cross.ratio);
      if (activeId !== crossDoc) activeId = crossDoc;
      applySplitChrome();
      render();
      const tab = tabFromId(crossDoc);
      if (notify) {
        activateHandler?.(tab);
        applySplitChrome();
        onSplit?.(getSplitState());
      }
      return true;
    }
    if (Number.isFinite(Number(ratio))) {
      split.ratio = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Number(ratio)));
      writeSplitRatio(split.ratio);
    }
    split.direction = dir;
    split.docId = docId;
    split.cross = null;
    if (activeId !== docId) activeId = docId;
    applySplitChrome();
    render();
    const tab = tabFromId(docId);
    if (notify) {
      activateHandler?.(tab);
      if (isStudioShellTabId(docId)) activeId = null;
      render();
      applySplitChrome();
      onSplit?.({ direction: dir, docId, ratio: split.ratio, tab });
    }
    return true;
  }

  function syncChrome() {
    const open = true;
    if (split.docId && !hasSplitTab(split.docId)) clearSplit({ notify: false });
    const splitOn = Boolean(split.direction && split.docId);
    const shellTab = !activeId || activeId === VIEWPORT_TAB_ID
      ? null
      : (tabs.get(activeId) || tabFromId(activeId));
    const shell = shellKindFromTab(shellTab);
    tabBarEl?.classList.toggle("hidden", !open);
    mainColumnEl?.classList.toggle("doc-tabs-open", open);
    mainColumnEl?.setAttribute("data-shell-tab", shell);
    applySplitChrome();
    const viewport = document.getElementById("viewport");
    const xrOn = typeof document !== "undefined" && document.body?.classList?.contains("xr-presenting");
    // Hiding #viewport while presenting blacks out the WebXR framebuffer.
    // Never leave visibility:hidden stuck after returning to the 3D shell.
    const hide = shouldHideViewportForShell(shell, {
      presenting: xrOn,
      layout: mainColumnEl?.dataset?.viserLayout || "",
      canvasSplit: mainColumnEl?.classList?.contains("canvas-layout-split") || false,
      codeSplit: mainColumnEl?.classList?.contains("code-layout-split") || false,
      viewportSplit: splitOn,
    });
    viewport?.classList.toggle("doc-viewer-active", hide);
    viewport?.classList.toggle("dxf-viewer-active", false);
    viewport?.classList.toggle("ref-viewer-active", false);
    if (!hide) revealViewportEl(viewport);
  }

  function renderTabButton(item) {
    const selected = item.active ? "true" : "false";
    const viewportClass = item.kind === VIEWPORT_SHELL ? " dxf-tab--viewport" : "";
    const shellClass = item.compact ? " dxf-tab--shell" : "";
    const pinnedClass = item.pinned && !item.compact ? " dxf-tab--pinned" : "";
    const pinMark = item.pinned && !item.compact ? `<span class="dxf-tab-pin" aria-hidden="true" title="Pinned to viewport">📌</span>` : "";
    const badge = item.compact || !item.badge ? "" : `<span class="doc-tab-kind">${escapeHtml(item.badge)}</span>`;
    const close = item.closable
      ? `<span class="dxf-tab-close" data-doc-close="${escapeHtml(item.id)}" role="button" aria-label="Close ${escapeHtml(item.label)}" title="Close">×</span>`
      : "";
    return `<button type="button" class="dxf-tab${viewportClass}${shellClass}${pinnedClass}${item.active ? " active" : ""}" data-doc-tab="${escapeHtml(item.id)}" data-shell-kind="${escapeHtml(item.kind)}" data-doc-pinned="${item.pinned ? "1" : "0"}" role="tab" aria-selected="${selected}" title="${escapeHtml(item.label)}">
          ${badge}
          ${pinMark}
          <span class="dxf-tab-label">${escapeHtml(item.label)}</span>
          ${close}
        </button>`;
  }

  function stripOpts() {
    return {
      viewportLabel,
      viewportPinned,
      viewportLayoutActive,
    };
  }

  function layoutSavesControlHtml() {
    return `<div class="vp-layout-saves" data-vp-layout-saves="1">
    <button type="button" class="vp-layout-saves-btn dxf-tab dxf-tab--layouts" data-vp-layout-open aria-haspopup="dialog" aria-label="Split view saves" title="Save and load split view layouts">
      <span class="vp-layout-saves-icon" aria-hidden="true">⧉</span>
      <span class="vp-layout-saves-label">Layouts</span>
      <span class="vp-layout-saves-caret" data-vp-layout-caret aria-label="Saved layouts" title="Saved layouts">▾</span>
    </button>
  </div>`;
  }

  function render() {
    if (!tabBarEl) return;
    if (activeId && !tabs.has(activeId) && !isStudioShellTabId(activeId)) {
      activeId = null;
    }
    const chips = buildShellTabStrip(tabs.values(), activeId, stripOpts()).map(renderTabButton).join("");
    tabBarEl.innerHTML = `${chips}${layoutSavesControlHtml()}`;
    syncChrome();
  }

  function showViewport({ notify = true } = {}) {
    if (split.direction) clearSplit({ notify });
    activeId = null;
    render();
    // Always notify so clicking Viewport after a parked editor still
    // re-attaches/resizes WebGL (activeId may already be null).
    if (notify) activateHandler?.(null);
  }

  function clearViewportLayout({ notify = true } = {}) {
    viewportLayoutActive = false;
    viewportLabel = "Viewport";
    persistState();
    showViewport({ notify });
  }

  function hideContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
  }

  function tabFromId(id) {
    if (id === VIEWPORT_TAB_ID) {
      return {
        id: VIEWPORT_TAB_ID,
        kind: VIEWPORT_SHELL,
        label: viewportLabel,
        pinned: viewportPinned,
      };
    }
    if (id === WORKSHOP_TAB_ID || id === WORKSPACE_TAB_ID) {
      return { id: WORKSHOP_TAB_ID, kind: "workshop", label: "Workshop", pinned: true };
    }
    if (id === ROBOTICS_HOME_TAB_ID) {
      return { id: ROBOTICS_HOME_TAB_ID, kind: "robotics-home", label: "Robotics Home", pinned: true };
    }
    if (id === APPROVALS_TAB_ID) {
      return { id: APPROVALS_TAB_ID, kind: "approvals", label: "Approvals", pinned: true };
    }
    return tabs.get(id) || null;
  }

  function renameTab(id, nextLabel) {
    const cleaned = String(nextLabel || "").trim();
    if (!cleaned) return;
    if (id === VIEWPORT_TAB_ID) {
      viewportLabel = cleaned;
      persistState();
      render();
      return;
    }
    const tab = tabs.get(id);
    if (!tab) return;
    tab.customLabel = cleaned;
    tab.label = cleaned;
    persistState();
    render();
    onRename?.(tab, cleaned);
  }

  function setPinned(id, pinned) {
    if (id === VIEWPORT_TAB_ID) {
      viewportPinned = !!pinned;
      persistState();
      render();
      return;
    }
    const tab = tabs.get(id);
    if (!tab) return;
    tab.pinned = !!pinned;
    persistState();
    render();
  }

  function beginRename(id) {
    hideContextMenu();
    const btn = tabBarEl?.querySelector?.(`[data-doc-tab="${CSS.escape(id)}"]`);
    const labelEl = btn?.querySelector?.(".dxf-tab-label");
    if (!btn || !labelEl) return;
    const tab = tabFromId(id);
    const current = tabDisplayLabel(tab) || (id === VIEWPORT_TAB_ID ? viewportLabel : id);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "dxf-tab-rename";
    input.value = current;
    input.setAttribute("aria-label", "Rename tab");
    input.maxLength = 80;
    labelEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) renameTab(id, input.value);
      else render();
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        ev.preventDefault();
        finish(true);
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  function showTabContextMenu(event, id) {
    hideContextMenu();
    const tab = tabFromId(id);
    if (!tab) return;
    event.preventDefault();
    event.stopPropagation();
    const pinned = id === VIEWPORT_TAB_ID ? viewportPinned : !!tab.pinned;
    const splitTarget = splitDocIdForTab(id, { activeId, tabIds: [...tabs.keys()] });
    const canSplit = Boolean(splitTarget);
    const splitDisabled = canSplit ? "" : " disabled";
    const menu = document.createElement("div");
    menu.className = "dxf-tab-context-menu folder-context-menu";
    menu.innerHTML = `
      <button type="button" data-doc-tab-action="rename">Rename</button>
      <button type="button" data-doc-tab-action="pin">${pinned ? "Unpin from viewport" : "Pin to viewport"}</button>
      <hr />
      <button type="button" data-doc-tab-action="split-up"${splitDisabled}>Split Up</button>
      <button type="button" data-doc-tab-action="split-left"${splitDisabled}>Split Left</button>
      <button type="button" data-doc-tab-action="split-down"${splitDisabled}>Split Down</button>
      <button type="button" data-doc-tab-action="split-right"${splitDisabled}>Split Right</button>
      ${split.direction ? `<button type="button" data-doc-tab-action="unsplit">Unsplit</button>` : ""}
      ${id === VIEWPORT_TAB_ID || isStudioShellTabId(id) ? "" : `<button type="button" data-doc-tab-action="close">Delete tab</button>`}
    `;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
    menu.addEventListener("click", (ev) => {
      const btn = ev.target?.closest?.("[data-doc-tab-action]");
      const action = btn?.dataset?.docTabAction;
      if (!action || btn?.disabled) return;
      hideContextMenu();
      if (action === "rename") beginRename(id);
      if (action === "pin") setPinned(id, !pinned);
      if (action === "close") {
        const live = tabs.get(id);
        if (live) closeHandler?.(live);
      }
      if (action === "unsplit") {
        clearSplit({ notify: true });
        render();
      }
      if (action?.startsWith("split-")) applySplit(action.slice("split-".length), id);
    });
    contextMenu = menu;
  }

  tabBarEl?.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-vp-layout-saves]")) return;
    const closeBtn = e.target.closest?.("[data-doc-close]");
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = closeBtn.dataset.docClose;
      if (id === VIEWPORT_TAB_ID) {
        clearViewportLayout({ notify: true });
        return;
      }
      const tab = tabs.get(id);
      if (tab?.pinned) {
        setPinned(id, false);
        return;
      }
      if (tab) closeHandler?.(tab);
      return;
    }
    const tabBtn = e.target.closest?.("[data-doc-tab]");
    if (tabBtn) {
      const id = tabBtn.dataset.docTab;
      if (id === VIEWPORT_TAB_ID) {
        showViewport({ notify: true });
        return;
      }
      if (isStudioShellTabId(id)) {
        activeId = id === WORKSPACE_TAB_ID ? WORKSHOP_TAB_ID : id;
        render();
        activateHandler?.(tabFromId(activeId));
        return;
      }
      const tab = tabs.get(id);
      if (!tab) return;
      activeId = id;
      render();
      activateHandler?.(tab);
    }
  });

  tabBarEl?.addEventListener("contextmenu", (e) => {
    const tabBtn = e.target.closest?.("[data-doc-tab]");
    if (!tabBtn) return;
    showTabContextMenu(e, tabBtn.dataset.docTab);
  });

  tabBarEl?.addEventListener("dblclick", (e) => {
    const tabBtn = e.target.closest?.("[data-doc-tab]");
    if (!tabBtn || e.target.closest?.("[data-doc-close]")) return;
    e.preventDefault();
    beginRename(tabBtn.dataset.docTab);
  });

  document.addEventListener?.("click", (e) => {
    if (contextMenu && !contextMenu.contains(e.target) && !e.target.closest?.(".dxf-tab-context-menu")) {
      hideContextMenu();
    }
  });

  const api = {
    upsert(entry) {
      const id = String(entry.id || "");
      if (!id || isStudioShellTabId(id)) return;
      const prev = tabs.get(id);
      tabs.set(id, {
        id,
        label: entry.label || prev?.label || id,
        kind: entry.kind || prev?.kind || "file",
        dirty: entry.dirty ?? prev?.dirty ?? false,
        pinned: entry.pinned ?? prev?.pinned ?? false,
        customLabel: entry.customLabel ?? prev?.customLabel ?? "",
        layout: entry.layout ?? prev?.layout ?? null,
      });
      render();
    },
    setDirty(id, dirty) {
      const tab = tabs.get(String(id || ""));
      if (!tab) return;
      tab.dirty = !!dirty;
      render();
    },
    setActive(id, { notify = true } = {}) {
      const key = String(id || "");
      if (key === VIEWPORT_TAB_ID || key === VIEWPORT_SHELL) {
        showViewport({ notify });
        return;
      }
      if (key === WORKSHOP_TAB_ID || key === WORKSPACE_TAB_ID || key === "workshop" || key === "workspace") {
        const changed = activeId !== WORKSHOP_TAB_ID;
        activeId = WORKSHOP_TAB_ID;
        render();
        if (notify && changed) activateHandler?.(tabFromId(WORKSHOP_TAB_ID));
        return;
      }
      if (key === ROBOTICS_HOME_TAB_ID || key === "robotics-home") {
        const changed = activeId !== ROBOTICS_HOME_TAB_ID;
        activeId = ROBOTICS_HOME_TAB_ID;
        render();
        if (notify && changed) activateHandler?.(tabFromId(ROBOTICS_HOME_TAB_ID));
        return;
      }
      if (key === APPROVALS_TAB_ID || key === "approvals") {
        const changed = activeId !== APPROVALS_TAB_ID;
        activeId = APPROVALS_TAB_ID;
        render();
        if (notify && changed) activateHandler?.(tabFromId(APPROVALS_TAB_ID));
        return;
      }
      if (!tabs.has(key)) return;
      const changed = activeId !== key;
      activeId = key;
      if (split.direction && !split.cross) split.docId = key;
      render();
      if (notify && changed) activateHandler?.(tabs.get(key));
    },
    /** Keep tabs open but show the 3D viewport (e.g. McMaster minimize). */
    deactivate({ notify = false } = {}) {
      showViewport({ notify });
    },
    remove(id) {
      const key = String(id || "");
      if (!tabs.has(key)) return null;
      const removed = tabs.get(key);
      const wasActive = activeId === key;
      const wasSplit = split.docId === key;
      const wasCross = split.cross?.docId === key || split.cross?.extraId === key;
      tabs.delete(key);
      persistState();
      if (wasSplit) clearSplit({ notify: true });
      else if (wasCross && split.cross) {
        if (split.cross.docId === key) split.cross.docId = split.cross.extraId || "";
        if (split.cross.extraId === key) split.cross.extraId = "";
        if (!split.cross.docId) split.cross = null;
      }
      if (wasActive) {
        activeId = tabs.keys().next().value || null;
      }
      render();
      if (wasActive) activateHandler?.(activeId ? tabs.get(activeId) : null);
      return removed;
    },
    clear() {
      tabs.clear();
      activeId = null;
      viewportLabel = "Viewport";
      viewportPinned = false;
      viewportLayoutActive = false;
      clearSplit({ notify: false });
      hideContextMenu();
      render();
    },
    restorePinnedTabs() {
      const saved = readPersisted();
      if (!saved) return [];
      viewportLabel = String(saved.viewportLabel || "Viewport").trim() || "Viewport";
      viewportPinned = !!saved.viewportPinned;
      viewportLayoutActive = !!saved.viewportLayoutActive;
      const restored = [];
      for (const entry of saved.tabs || []) {
        const id = String(entry?.id || "");
        if (!id || isStudioShellTabId(id)) continue;
        tabs.set(id, {
          id,
          label: entry.label || id,
          kind: entry.kind || "file",
          dirty: false,
          pinned: entry.pinned !== false,
          customLabel: entry.customLabel || "",
          layout: entry.layout || null,
        });
        restored.push(tabs.get(id));
      }
      render();
      return restored;
    },
    has(id) {
      return tabs.has(String(id || ""));
    },
    getActive() {
      return activeId ? tabs.get(activeId) || null : null;
    },
    getActiveShell() {
      return shellKindFromTab(activeId ? tabs.get(activeId) : null);
    },
    list() {
      return [...tabs.values()];
    },
    setViewportLayout(label = "Viewport") {
      viewportLabel = String(label || "Viewport").trim() || "Viewport";
      viewportLayoutActive = true;
      persistState();
      render();
    },
    clearViewportLayout,
    onActivate(fn) {
      activateHandler = fn;
    },
    onClose(fn) {
      closeHandler = fn;
    },
    split(direction, id, opts) {
      return applySplit(direction, id, opts);
    },
    applySplit,
    unsplit() {
      if (!split.direction) return false;
      clearSplit({ notify: true });
      render();
      return true;
    },
    getSplit() {
      return getSplitState();
    },
    splitDocIds,
    render,
  };

  // First paint: Workspace chip + data-shell-tab=viewport, #viewport not hidden.
  render();
  return api;
}
