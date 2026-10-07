/** Fusion 360-style project browser tree (components, sketches, wiring, reference files). */

import { recognizePart } from "./part-catalog.js?v=20260906-fritz";
import { groupPartsList, CART_ICON, openPartsList, syncPartsCartShortcut } from "./parts-list-tree.js?v=20260915-parts1";
import { setExplorerDragData } from "../studio/explorer-drag.js?v=20260618-multi-drag";
import { nestReferenceFolderItems, isVideoEditorHubFolder, videoEditorHubItems, entryOpensInVideoEditor, videoEditorActionEntry } from "./reference-files.js?v=20260907-capture-names-hidrig1-refcap1-treefold1-20260914-clipmedia2-20260915-refrec1-foldcode1-20260915-code-workspace3-heicpng1-veditorhub1-clipui1-vidopen1-browcol1&leakfix7&leakfix9&filmapply=20261006-2";
import { formatTreeCount, treeCountValue } from "./tree-count.js?v=20260915-treecount1";
import {
  isProjectCodeFolder,
  folderHasCode,
  folderHasEditorFiles,
  folderShareEntry,
  isCodeFilename,
  entryMatchesNameAndType,
} from "./project-code.js?v=foldcode1-code1";
import { captureHoverTitle, friendlyCaptureDisplayName, formatEntryCapturedAt, isCaptureBrowserEntry, sortCaptureEntriesNewestFirst } from "../viewport/capture-labels.js?v=20260907-capture-names-20260915-refrec1-20260915-recclock1";
import { editableCanvasBoard } from "../viewport/canvas-context.js?v=canvas-2e2d00af6fb4";

import {
  VR_CREATIONS_FOLDER,
  XR_CREATIONS_SORTS,
  authorHighlightText,
} from "../xr/xr-creations-browser.js?v=20260908-bodiesvr1-vrbodies1";

const SECTIONS = [
  { id: "components", label: "Components", icon: "cube" },
  { id: "bodies", label: "Bodies", icon: "body" },
  { id: "robots", label: "Robots", icon: "robot" },
  { id: "references", label: "Reference Files", icon: "file" },
  { id: "renders", label: "Renders", icon: "render" },
  { id: "wiring", label: "Wiring", icon: "wire" },
  { id: "vr_creations", label: VR_CREATIONS_FOLDER, icon: "headset" },
];

/** Always-visible nested Browser folders (Imagine / Sketches). Joints stay off the tree. */
export function pinnedBrowserFolder(id, label, items = []) {
  return {
    id: `folder:${id}`,
    name: label,
    label,
    children_label: label,
    virtual_folder: true,
    folder: label,
    browser_section: id,
    pinned_folder: true,
    default_collapsed: true,
    children: Array.isArray(items) ? [...items] : [],
  };
}

export function nestRendersWithImagine(renders = [], imagine = []) {
  const list = [...(renders || [])];
  const nested = !list.length
    ? []
    : list.every((row) => row?.virtual_folder)
      ? list
      : nestReferenceFolderItems(list.map((row) => (
          row?.folder || row?.virtual_folder
            ? row
            : { ...row, folder: /\.(webm|mp4|mov|m4v)$/i.test(String(row?.name || "")) ? "Videos" : "Images" }
        )));
  return [...nested, pinnedBrowserFolder("imagine", "Imagine", imagine)];
}

export function nestReferencesWithSketches(items = [], sketches = []) {
  return [...(items || []), pinnedBrowserFolder("sketches", "Sketches", sketches)];
}

export function nestRobotsWithUrdfFolder(robots = []) {
  return [pinnedBrowserFolder("robots-urdf", "URDF / SRDF", robots || [])];
}

export function isRobotUrdfFolder(entry) {
  return !!(entry?.pinned_folder && (entry.browser_section === "robots-urdf" || entry.id === "folder:robots-urdf"));
}

const TREE_EXPAND_KEY = "render3d:browser-expand:v1";
const TREE_VIEW_KEY = "render3d:browser-view:v1";
/** Bump when a section’s first-visit default changes so old dumps don’t keep the prior default. */
const SECTION_DEFAULTS_REV = 3;
const DEFAULT_EXPANDED = {
  components: false,
  joints: false,
  vr_creations: false,
  bodies: false,
  robots: false,
  "robots-urdf": false,
  references: false,
  renders: false,
  imagine: false,
  sketches: false,
  wiring: false,
};

function readTreeExpandStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(TREE_EXPAND_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function isStoreImageFilename(name) {
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(String(name || ""));
}

function isStoreModelFilename(name) {
  return /\.(stl|step|stp|glb|gltf|obj|3mf|ply|off|zip)$/i.test(String(name || ""));
}

function isDxfEntry(entry) {
  return entry?.format === "dxf" || /\.dxf$/i.test(String(entry?.name || ""));
}

function isImagineCadEntry(entry) {
  return /\.(step|stp|stl|glb|gltf|3mf)$/i.test(String(entry?.name || entry?.filename || ""));
}

function isCadSection(sectionId) {
  return sectionId === "components" || sectionId === "bodies" || sectionId === "vr_creations";
}

function isRobotBrowserSection(sectionId) {
  return sectionId === "robots" || sectionId === "robots-urdf";
}

/** On-disk path for a browser row. Strips `#body:N` and prefers part sidecars. */
export function browserDiskFilename(entry) {
  const sidecar = String(entry?.sidecar_filename || "").trim();
  if (sidecar) return sidecar.replace(/\\/g, "/");
  const raw = String(
    entry?.source_path
    || entry?.filename
    || entry?.source_filename
    || entry?.parent_filename
    || entry?.name
    || "",
  ).replace(/\\/g, "/");
  return raw.split("#")[0].trim();
}

function entryLooksLikeFile(entry) {
  const name = browserDiskFilename(entry).split("/").pop() || "";
  return /\.[a-z0-9]+$/i.test(name);
}

export function browserEntryIsImage(entry) {
  const name = browserDiskFilename(entry);
  return /\.(png|jpe?g|webp|gif|bmp|svg|tiff?)$/i.test(name);
}

export function browserEntryIsVideo(entry) {
  const name = browserDiskFilename(entry);
  if (String(entry?.kind || "").toLowerCase() === "video") return true;
  const mime = String(entry?.mime || entry?.type || "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  return /\.(webm|mp4|mov|m4v)$/i.test(name);
}

function folderOpensInCodeEditor(entry) {
  if (entryOpensInVideoEditor(entry)) return false;
  return isProjectCodeFolder(entry) || folderHasCode(entry) || folderHasEditorFiles(entry);
}

/** Reference / McMaster / other files already on disk — download, no format picker. */
export function isBrowserDirectDownloadEntry(entry, sectionId) {
  if (!entry || entry.virtual_folder || entry.virtual_body || entry.virtual_component) return false;
  if (entry.catalog_hardware) return true;
  if (sectionId === "references" || sectionId === "renders" || isRobotBrowserSection(sectionId) || sectionId === "imagine") {
    return entryLooksLikeFile(entry);
  }
  if (sectionId === "sketches" || sectionId === "wiring") return entryLooksLikeFile(entry);
  return false;
}

/** Designed CAD components and generated bodies — STEP/GLB/STL format picker. */
export function isBrowserCadExportEntry(entry, sectionId) {
  if (!entry || entry.virtual_folder || entry.catalog_hardware) return false;
  if (!isCadSection(sectionId) && sectionId !== "components") return false;
  return !!(browserDiskFilename(entry) || Number.isInteger(entry.body_index));
}

function hardwareFolderEntry(parent) {
  if (!parent?.hardware?.length) return null;
  return {
    id: `${parent.name || parent.id || "component"}:mcmaster-parts`,
    name: `${parent.name || parent.id || "component"}::mcmaster-parts`,
    label: parent.hardware_label || "McMaster Parts",
    virtual_folder: true,
    catalog_hardware_folder: true,
    children_label: parent.hardware_label || "McMaster Parts",
    children: parent.hardware,
  };
}

function referenceSectionItems(browser = {}) {
  const drawings = [...(browser.drawings || [])];
  const refs = [...(browser.references || [])];
  const all = [...drawings, ...refs];
  const nested = groupPartsList(nestReferenceFolderItems(all.filter(row => !row.parts_tab)), all.filter(row => row.parts_tab));
  return nestReferencesWithSketches(nested, browser.sketches || []);
}

const SECTION_SEARCH_ICON = `<svg class="browser-section-search-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9.6 9.6L13.2 13.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

function sectionRawItems(section, data = {}) {
  if (section.id === "references") return referenceSectionItems(data);
  if (section.id === "renders") return nestRendersWithImagine(data.renders || [], data.imagine || []);
  if (section.id === "robots") return nestRobotsWithUrdfFolder(data.robots || []);
  return data[section.id] || [];
}

function isShownVirtualFolder(entry) {
  return !!(entry?.virtual_folder && (entry.children?.length || entry.pinned_folder || entry.parts_tab));
}

function sectionEmptyMessage(sectionId) {
  if (sectionId === "components") return "Drop STEP or mesh files in the viewport";
  if (sectionId === "bodies") return "Designed solids and McMaster parts appear here";
  if (sectionId === "vr_creations") return "Draw solids in VR — they appear here as bodies under VR Room";
  if (sectionId === "robots" || sectionId === "robots-urdf") return "No URDF/SRDF yet — generate from Rigging or drop robot files";
  if (sectionId === "references") return "Record a clip or drop PDF, DXF, text, or images here";
  if (sectionId === "renders") return "No renders yet — use the Render prompt tab";
  if (sectionId === "imagine") return "No Imagine files yet";
  if (sectionId === "sketches") return "No sketches — Finish Sketch to save one";
  return "Open Wiring Simulator to design a circuit";
}

function iconSvg(type) {
  if (type === "cube") {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1 1 4.5v7L8 15l7-3.5v-7L8 1Zm0 1.3 5.5 2.75v5.9L8 13.7l-5.5-2.75v-5.9L8 2.3Z"/></svg>';
  }
  if (type === "body") {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M3 4.5h10v8H3z"/><path fill="currentColor" d="M4.2 6.2h7.6v5.1H4.2z"/></svg>';
  }
  if (type === "drawing") {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M3 2.5h10v11H3z"/><path fill="none" stroke="currentColor" stroke-width="1.2" d="M5 6h6M5 9h4"/></svg>';
  }
  if (type === "file") {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M4 2.5h5.5L12 5v8.5H4z"/><path fill="none" stroke="currentColor" stroke-width="1.2" d="M9.5 2.5V5H12M5.5 8h5M5.5 10.5h3.5"/></svg>';
  }
  if (type === "sketch") {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M2 12 6 4l4 3 4-5"/></svg>';
  }
  if (type === "robot") {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="4" y="3" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="6.2" cy="5.5" r="0.9" fill="currentColor"/><circle cx="9.8" cy="5.5" r="0.9" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.2" d="M6 9.5v2.5M10 9.5v2.5M4 12h8"/></svg>';
  }
  if (type === "render") {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.5" cy="6.5" r="1.2" fill="none" stroke="currentColor" stroke-width="1.1"/><path fill="none" stroke="currentColor" stroke-width="1.2" d="M2.8 12.2 6.2 8.5l2.2 2.1 2.4-3.1 2.4 4.7"/></svg>';
  }
  if (type === "imagine") {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M8 2.2 9.1 6.1 13 7.2 9.1 8.3 8 12.2 6.9 8.3 3 7.2 6.9 6.1Z"/><path fill="none" stroke="currentColor" stroke-width="1.1" d="M12.2 2.8 12.7 4.4 14.3 4.9 12.7 5.4 12.2 7 11.7 5.4 10.1 4.9 11.7 4.4Z"/></svg>';
  }
  if (type === "headset") {
    return vrHeadsetGlyph();
  }
  return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M2 8h4l2-3 2 6 2-3h2"/></svg>';
}

function vrHeadsetGlyph() {
  return '<svg class="browser-vr-glyph" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.25" d="M2.2 6.2h11.6v5.2c0 .7-.6 1.3-1.3 1.3H10L8.8 11.2H7.2L6 12.7H3.5c-.7 0-1.3-.6-1.3-1.3V6.2Z"/><path fill="none" stroke="currentColor" stroke-width="1.2" d="M4.3 8.2h2.6v2.1H4.3zm4.8 0h2.6v2.1H9.1z"/></svg>';
}

function eyeSvg(hidden) {
  return hidden
    ? `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M2 2l12 12M6.3 6.3A2.7 2.7 0 0 0 8 10.7c.7 0 1.3-.2 1.8-.7M4.8 4.1C2.9 4.9 1.3 6.4.3 8c1.7 2.6 4.5 5 7.7 5 1.2 0 2.3-.3 3.3-.8M7.4 3.1 8 3c3.5 0 6.3 2.4 8 5-.4.7-.9 1.3-1.5 1.9"/>
      </svg>`
    : `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M.5 8C2.2 5.4 4.8 3 8 3s5.8 2.4 7.5 5c-1.7 2.6-4.3 5-7.5 5S2.2 10.6.5 8Z"/>
        <circle cx="8" cy="8" r="2.7" fill="none" stroke="currentColor" stroke-width="1.35"/>
      </svg>`;
}

function iconBtn(svg, { className = "", title = "", danger = false } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `browser-action-btn browser-action-btn--icon${danger ? " danger" : ""}${className ? ` ${className}` : ""}`;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = svg;
  return btn;
}

/** Viewport marking-menu listeners are capture-phase on #viewport; skip Browser chrome. */
export const VIEWPORT_BROWSER_POINTER_SEL = [
  "#viewport-browser-panel",
  "#btn-viewport-browser-expand",
  ".design-browser-root",
  ".browser-context-menu",
].join(",");

export function isViewportBrowserPointerTarget(target) {
  const el = target?.nodeType === 1 ? target : target?.parentElement;
  return !!el?.closest?.(VIEWPORT_BROWSER_POINTER_SEL);
}

/** Inclusive range of visible tree keys between two clicks (Shift-select). */
export function keysInVisibleRange(orderedKeys = [], fromKey, toKey) {
  const list = Array.isArray(orderedKeys) ? orderedKeys : [];
  const a = list.indexOf(fromKey);
  const b = list.indexOf(toKey);
  if (a < 0 && b < 0) return toKey ? [toKey] : [];
  if (a < 0) return toKey ? [toKey] : [];
  if (b < 0) return fromKey ? [fromKey] : [];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return list.slice(lo, hi + 1);
}

function escapeBrowserHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function swallowBrowserWheelGesture(ev) {
  if (ev.type === "contextmenu" || ev.button === 2) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
  }
}

function bindBrowserRightClick(el, handler) {
  if (!el) return;
  el.addEventListener("contextmenu", (ev) => {
    swallowBrowserWheelGesture(ev);
    handler?.(ev);
  }, true);
  el.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 2) return;
    // Do not preventDefault — Chromium cancels contextmenu if we do.
    ev.stopPropagation();
  }, true);
}

const ICON_EXPORT = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7.5M5.2 5.2 8 2.5l2.8 2.7"/><path d="M3 10.5v2h10v-2"/></svg>`;
const ICON_DOWNLOAD = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7.2M5.3 7.2 8 9.7l2.7-2.5"/><path d="M3 12.2h10"/></svg>`;
const ICON_HUB_OPEN = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.6" y="3.2" width="12.8" height="9.6" rx="1.8"/><path d="M6.3 6.1 10.4 8 6.3 9.9z" fill="currentColor" stroke="none"/></svg>`;
const ICON_SHARE_X = `<svg class="viewport-video-share-logo" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.734l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg>`;
const ICON_RENAME = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 3.2 12.8 6.6 6 13.4H2.6V10z"/><path d="M8.2 4.4 11.6 7.8"/></svg>`;
const ICON_DELETE = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 4.2h9.6M6.2 4.2V3h3.6v1.2M4.4 4.2 5 13h6l.6-8.8"/></svg>`;
const ICON_KEBAB = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="3.4" r="1.35" fill="currentColor"/><circle cx="8" cy="8" r="1.35" fill="currentColor"/><circle cx="8" cy="12.6" r="1.35" fill="currentColor"/></svg>`;

function displayName(entry) {
  if (entry?.kind === "joints") return entry.display_name || entry.stem || entry.name;
  const formatLabel = (value = "") => String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  if (entry?.format === "body" || entry?.virtual_body) {
    const label = String(entry.label || entry.body_name || "").trim();
    if (label) {
      const short = label.includes("|") ? label.split("|", 1)[0].trim() : label;
      return formatLabel(short || label);
    }
  }
  if (isCaptureBrowserEntry(entry)) {
    const friendly = friendlyCaptureDisplayName(entry);
    if (friendly) return friendly;
  }
  if (entry.label) return formatLabel(entry.label);
  if (entry.format === "program") {
    return formatLabel(entry.stem || entry.name.replace(/\.program\.json$/i, ""));
  }
  if (entry.format === "wiring") return entry.name;
  const stem = entry.stem || entry.name.replace(/\.[^.]+$/, "");
  return formatLabel(stem);
}

export function createProjectTree(options = {}) {
  const {
    container,
    onOpenComponent,
    onFrameComponent,
    onOpenJoint,
    onOpenDrawing,
    onOpenReference,
    onOpenCanvasBoard,
    onSendReferenceToPrompt,
    onOpenSketch,
    onEditSketch,
    onOpenWiring,
    onOpenRobot,
    onOpenSection,
    onToggleVisibility,
    onExport,
    onDownload,
    onRename,
    onDelete,
    onDeleteMany,
    onDragComponent,
    onOpenProfile,
    onSendComponentToPrompt,
    onFixWheels = null,
    onQcRig = null,
    onAttachWiring,
    onReferenceShareAction,
    onStoreListing,
    onAddToScene,
    getPartProfile,
    getProjectId,
    onXrCreationsSort,
    onOpenVideoEditor,
    onAddToVideoEditor,
    onOpenCodeFolder = null,
    onToggleRobotVisuals = null,
    getRobotVisualsVisible = null,
  } = options;

  let partProfiles = new Map();
  const hidden = new Set();
  let browser = { components: [], vr_creations: [], bodies: [], robots: [], drawings: [], references: [], renders: [], sketches: [], wiring: [] };
  let selectedName = null;
  let selectedBodyIndex = null;
  let selectedCatalogName = null;
  const selectedBrowserKeys = new Set();
  let selectionAnchorKey = null;
  const visibleSelectOrder = [];
  /** @type {Map<string, { entry: object, sectionId: string }>} */
  const browserEntryCache = new Map();
  let loading = false;
  let expanded = { ...DEFAULT_EXPANDED };
  let selectedSection = "components";
  let browserThinkOpen = false;
  let browserThinkQuery = "";
  let browserViewMode = "list";
  try { localStorage.setItem(TREE_VIEW_KEY, "list"); } catch { /* private mode */ }
  const childGroupsExpanded = new Set();
  const childGroupsInitialized = new Set();
  let persistPid = null;
  let expandDirty = false;
  let suppressBrowserClick = false;
  let browserContextMenu = null;
  let videoEditorHubEl = null;

  function runOpenInVideoEditor(entry) {
    const target = videoEditorActionEntry(entry);
    if (entry?.virtual_folder && target === entry && isVideoEditorHubFolder(entry)) {
      showVideoEditorHub(entry);
      return;
    }
    onOpenVideoEditor?.(target);
  }

  function runBrowserDownload(entry, sectionId) {
    if (typeof onDownload === "function") {
      onDownload(entry, sectionId);
      return;
    }
    if (typeof onReferenceShareAction === "function") {
      onReferenceShareAction(entry, sectionId, "download");
      return;
    }
    onExport?.(entry);
  }

  function persistExpandState(pid = persistPid) {
    if (!pid || !expandDirty) return;
    try {
      const store = readTreeExpandStore();
      store[pid] = {
        sections: { ...expanded },
        childGroups: [...childGroupsExpanded],
        defaultsRev: SECTION_DEFAULTS_REV,
      };
      localStorage.setItem(TREE_EXPAND_KEY, JSON.stringify(store));
    } catch {
      /* private mode / quota */
    }
  }

  function markExpandDirty() {
    expandDirty = true;
    persistExpandState();
  }

  function applyExpandStateForProject(pid) {
    const nextPid = pid || null;
    if (nextPid === persistPid) return;
    if (persistPid) persistExpandState(persistPid);
    persistPid = nextPid;
    expandDirty = false;
    expanded = { ...DEFAULT_EXPANDED };
    childGroupsExpanded.clear();
    childGroupsInitialized.clear();
    if (!nextPid) return;
    const saved = readTreeExpandStore()[nextPid];
    const savedRev = Number(saved?.defaultsRev) || 1;
    if (saved?.sections && typeof saved.sections === "object") {
      expanded = { ...DEFAULT_EXPANDED, ...saved.sections };
      // Old stores dumped first-visit defaults (Components / VR Creations open), not a user choice.
      if (savedRev < SECTION_DEFAULTS_REV) {
        expanded.components = false;
        expanded.vr_creations = false;
      }
    }
    // Pre-rev dumps also auto-seeded Video Editor / capture folders into childGroups.
    if (savedRev >= SECTION_DEFAULTS_REV && Array.isArray(saved?.childGroups)) {
      for (const key of saved.childGroups) {
        if (!key) continue;
        childGroupsExpanded.add(String(key));
        childGroupsInitialized.add(String(key));
      }
    }
  }

  function clearBrowserClickSuppress() {
    window.setTimeout(() => {
      suppressBrowserClick = false;
    }, 0);
  }

  function closeBrowserContextMenu() {
    browserContextMenu?.remove();
    browserContextMenu = null;
    document.removeEventListener("mousedown", onBrowserContextMenuOutside, true);
    document.removeEventListener("keydown", onBrowserContextMenuKey, true);
  }

  function restoreKebabPanel(more) {
    const panel = more._kebabPanel;
    more.classList.remove("is-open");
    more.querySelector(".browser-item-kebab")?.setAttribute("aria-expanded", "false");
    if (!panel) return;
    panel.classList.remove("explorer-action-strip");
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    panel.style.position = "";
    panel.style.zIndex = "";
    if (panel.parentElement !== more) more.appendChild(panel);
    panel.querySelector(".explorer-action-strip-close")?.remove();
  }

  function closeOpenRowKebabs(except = null) {
    container?.querySelectorAll(".browser-item-more.is-open").forEach((el) => {
      if (el === except) return;
      restoreKebabPanel(el);
    });
  }

  function layoutOpenKebabMenu(more) {
    const kebab = more.querySelector(".browser-item-kebab");
    const panel = more._kebabPanel || more.querySelector(".browser-item-actions");
    if (!kebab || !panel) return;
    more._kebabPanel = panel;
    panel.classList.add("explorer-action-strip");
    let closeBtn = panel.querySelector(".explorer-action-strip-close");
    if (!closeBtn) {
      closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "browser-action-btn explorer-action-strip-close";
      closeBtn.textContent = "×";
      closeBtn.title = "Close";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        restoreKebabPanel(more);
      });
      panel.appendChild(closeBtn);
    }
    document.body.appendChild(panel);
    const r = kebab.getBoundingClientRect();
    const pad = 8;
    panel.style.position = "fixed";
    panel.style.zIndex = "12050";
    const w = panel.offsetWidth || 168;
    const h = panel.offsetHeight || 36;
    let left = r.right - w;
    if (left < pad) left = pad;
    if (left + w > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - w - pad);
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - pad) top = Math.max(pad, r.top - h - 4);
    panel.style.left = `${Math.round(left)}px`;
    panel.style.right = "auto";
    panel.style.top = `${Math.round(top)}px`;
  }

  function attachBrowserRowKebab(li, actions) {
    if (!actions?.childElementCount) return;
    const more = document.createElement("div");
    more.className = "browser-item-more";
    more._kebabPanel = actions;
    const kebab = document.createElement("button");
    kebab.type = "button";
    kebab.className = "browser-item-kebab";
    kebab.title = "More actions";
    kebab.setAttribute("aria-label", "More actions");
    kebab.setAttribute("aria-haspopup", "menu");
    kebab.setAttribute("aria-expanded", "false");
    kebab.innerHTML = ICON_KEBAB;
    kebab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = !more.classList.contains("is-open");
      closeOpenRowKebabs(willOpen ? more : null);
      more.classList.toggle("is-open", willOpen);
      kebab.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (willOpen) layoutOpenKebabMenu(more);
      else restoreKebabPanel(more);
    });
    more.append(kebab, actions);
    li.appendChild(more);
  }

  function onBrowserRowKebabOutside(e) {
    if (e.target?.closest?.(".browser-item-more, .explorer-action-strip, .browser-item-actions")) return;
    closeOpenRowKebabs();
  }

  function onBrowserRowKebabKey(e) {
    if (e.key !== "Escape") return;
    closeOpenRowKebabs();
  }

  if (container && !container.dataset.browserKebabBound) {
    container.dataset.browserKebabBound = "1";
    document.addEventListener("mousedown", onBrowserRowKebabOutside, true);
    document.addEventListener("keydown", onBrowserRowKebabKey, true);
    container.addEventListener("scroll", () => closeOpenRowKebabs(), true);
  }

  function onBrowserContextMenuOutside(e) {
    if (e.button !== 0) return;
    if (browserContextMenu?.contains(e.target)) return;
    closeBrowserContextMenu();
  }

  function onBrowserContextMenuKey(e) {
    if (e.key !== "Escape") return;
    closeBrowserContextMenu();
  }

  function browserIdToken(sectionId, entry) {
    const pid = getProjectId?.() || "";
    const key = entry?.id || entry?.stem || entry?.name || "";
    const kind =
      sectionId === "components" || sectionId === "bodies" || sectionId === "vr_creations"
        ? "component"
        : sectionId === "references" && isDxfEntry(entry)
          ? "dxf"
          : sectionId || "item";
    return `${kind}:${pid}:${key}`;
  }

  async function copyBrowserText(text, promptLabel = "Copy ID") {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else window.prompt(promptLabel, text);
    } catch {
      window.prompt(promptLabel, text);
    }
  }

  function openBrowserEntry(entry, sectionId) {
    if (!entry) return;
    if (entry.parts_tab) { openPartsList(entry.parts_tab); return; }
    const cad = isCadSection(sectionId) || sectionId === "components";
    const visKey = itemKey(entry, cad ? "components" : sectionId);
    selectedBrowserKeys.clear();
    selectedName = entry.name;
    selectedBodyIndex = Number.isInteger(entry.body_index) ? entry.body_index : null;
    selectedCatalogName = entry.source_filename || entry.parent_filename || entry.filename || null;
    selectedBrowserKeys.add(browserSelectionKey(cad ? "components" : sectionId, entry));
    if (cad && hidden.has(visKey)) {
      hidden.delete(visKey);
      onToggleVisibility?.(entry, true, sectionId);
    }
    if (sectionId === "joints") onOpenJoint?.(entry);
    else if (cad) onOpenComponent?.(entry);
    else if (isRobotBrowserSection(sectionId)) onOpenRobot?.(entry);
    else if (sectionId === "references") {
      if (isDxfEntry(entry)) onOpenDrawing?.(entry);
      else onOpenReference?.(entry);
    } else if (sectionId === "renders") onOpenReference?.(entry);
    else if (sectionId === "imagine") {
      if (isImagineCadEntry(entry)) onOpenComponent?.(entry);
      else onOpenReference?.(entry);
    } else if (sectionId === "sketches") onOpenSketch?.(entry);
    else onOpenWiring?.(entry);
    render();
  }

  function showBrowserContextMenu(e, { title, subtitle, actions }) {
    swallowBrowserWheelGesture(e);
    closeBrowserContextMenu();
    closeOpenRowKebabs();
    const items = (actions || []).filter(Boolean);
    if (!items.length) return;
    const menu = document.createElement("div");
    menu.className = "folder-context-menu component-context-menu browser-context-menu";
    const titleHtml = `
      <div class="component-context-title">
        <strong>${escapeBrowserHtml(title || "")}</strong>
        ${subtitle ? `<span>${escapeBrowserHtml(subtitle)}</span>` : ""}
      </div>
    `;
    menu.innerHTML = titleHtml + items.map((item) => {
      if (item.hr) return "<hr />";
      const danger = item.danger ? ` class="danger"` : "";
      const disabled = item.disabled ? " disabled" : "";
      return `<button type="button" data-action="${escapeBrowserHtml(item.action)}"${danger}${disabled}>${escapeBrowserHtml(item.label)}</button>`;
    }).join("");
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(e.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(e.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    browserContextMenu = menu;
    menu.addEventListener("mousedown", (ev) => ev.stopPropagation());
    menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    menu.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest("button");
      const action = btn?.dataset?.action;
      if (!action || btn.disabled) return;
      const spec = items.find((item) => item.action === action);
      closeBrowserContextMenu();
      await spec?.run?.(ev);
    });
    setTimeout(() => {
      document.addEventListener("mousedown", onBrowserContextMenuOutside, true);
      document.addEventListener("keydown", onBrowserContextMenuKey, true);
    }, 0);
  }

  function showItemContextMenu(e, entry, sectionId, payload = null) {
    if (entry?.virtual_folder) {
      const board = editableCanvasBoard(entry);
      const shareFile = folderShareEntry(entry);
      const canSendFolder = (sectionId === "references" || sectionId === "renders" || sectionId === "imagine")
        && typeof onSendReferenceToPrompt === "function";
      const canOpenVideo = entryOpensInVideoEditor(entry) && typeof onOpenVideoEditor === "function";
      const canOpenCode = folderOpensInCodeEditor(entry) && typeof onOpenCodeFolder === "function";
      if (!canSendFolder && !board && !canOpenCode && !canOpenVideo && !shareFile) {
        swallowBrowserWheelGesture(e);
        return;
      }
      showBrowserContextMenu(e, {
        title: displayName(entry),
        subtitle: browserIdToken(sectionId, entry),
        actions: [
          board && typeof onOpenCanvasBoard === "function" ? {
            action: "open-canvas",
            label: "Open canvas",
            run: () => onOpenCanvasBoard(entry, board),
          } : null,
          canSendFolder ? { action: "send-ai", label: "Send to AI", run: () => onSendReferenceToPrompt(entry) } : null,
          shareFile ? {
            action: "download",
            label: "Download",
            run: () => runBrowserDownload(shareFile, sectionId),
          } : null,
          shareFile && typeof onReferenceShareAction === "function" ? {
            action: "copy-link",
            label: "Copy share link",
            run: () => onReferenceShareAction(shareFile, sectionId, "copy-link"),
          } : null,
          canOpenCode && typeof onReferenceShareAction === "function" ? {
            action: "share-code",
            label: "Share",
            run: () => onReferenceShareAction(entry, sectionId, "copy-link"),
          } : null,
          canOpenVideo ? { action: "open-video", label: "Open in video editor", run: () => runOpenInVideoEditor(entry) } : null,
          canOpenCode ? { action: "open-code", label: "Open in code editor", run: () => onOpenCodeFolder(entry) } : null,
        ],
      });
      return;
    }
    const cad = isCadSection(sectionId) || sectionId === "components";
    const visKey = itemKey(entry, cad ? "components" : sectionId);
    const isHidden = hidden.has(visKey);
    const idToken = browserIdToken(sectionId, entry);
    const virtualPart = !!(entry.virtual_body || entry.virtual_component);
    const stem = entry.stem || String(entry.name || "").replace(/\.[^.]+$/, "");
    const token = stem ? `@${stem}` : "";
    const isRef = sectionId === "references" || sectionId === "renders" || sectionId === "imagine";
    const isDxf = sectionId === "references" && isDxfEntry(entry);
    const canFileMutate = isRef || isRobotBrowserSection(sectionId);
    const canShare = isRef && !isDxf && typeof onReferenceShareAction === "function";
    const actions = [];
    if (cad) actions.push({ action: "rate-model", label: "Rate model…", run: () =>
      document.dispatchEvent(new CustomEvent("render:rate-model", {detail: {filename: entry.source_filename || entry.parent_filename || entry.name}})) });

    actions.push({
      action: "copy-id",
      label: `Copy ${cad ? "component" : sectionId === "references" ? (isDxf ? "drawing" : "reference") : sectionId === "renders" ? "render" : sectionId === "imagine" ? "Imagine file" : sectionId === "sketches" ? "sketch" : "item"} ID`,
      run: () => copyBrowserText(idToken),
    });
    actions.push({
      action: "open",
      label: "Open / view",
      run: () => openBrowserEntry(entry, sectionId),
    });
    const fileBoard = editableCanvasBoard(entry);
    if (fileBoard && typeof onOpenCanvasBoard === "function") {
      actions.push({
        action: "open-canvas",
        label: "Open in canvas",
        run: () => onOpenCanvasBoard(entry, fileBoard),
      });
    }

    if (cad) {
      if (typeof onAddToScene === "function" && !virtualPart) {
        actions.push({ action: "add-scene", label: "Add to scene", run: () => onAddToScene(entry, sectionId) });
      }
      if (typeof onAttachWiring === "function" && !virtualPart) {
        actions.push({
          action: "attach",
          label: "Attach to Wiring Simulator",
          run: () => onAttachWiring(entry, payload),
        });
      }
      if (typeof onOpenProfile === "function" && !virtualPart) {
        actions.push({
          action: "profile",
          label: "Profile / source",
          run: () => onOpenProfile(entry),
        });
      }
      if (typeof onSendComponentToPrompt === "function") {
        actions.push({
          action: "send-ai",
          label: "Send to AI prompt",
          run: () => onSendComponentToPrompt(entry),
        });
      }
      actions.push({
        action: "visibility",
        label: isHidden ? "Show object" : "Hide object",
        run: () => {
          if (hidden.has(visKey)) hidden.delete(visKey);
          else hidden.add(visKey);
          onToggleVisibility?.(entry, !hidden.has(visKey), sectionId);
          render();
        },
      });
      if (isBrowserDirectDownloadEntry(entry, sectionId)) {
        actions.push({
          action: "download",
          label: "Download",
          run: () => runBrowserDownload(entry, sectionId),
        });
      } else if (isBrowserCadExportEntry(entry, sectionId)) {
        actions.push({
          action: "export",
          label: entry.virtual_body ? "Export body..." : "Export component...",
          disabled: isHidden || typeof onExport !== "function",
          run: () => onExport?.(entry, e.currentTarget || e.target),
        });
      }
      if (typeof onStoreListing === "function" && !virtualPart && isStoreModelFilename(browserDiskFilename(entry))) {
        actions.push({
          action: "store",
          label: "Add to public profile/store...",
          run: () => onStoreListing(entry, sectionId),
        });
      }
      if (!virtualPart || entryDeleteFilename(entry)) {
        if (!virtualPart && token) {
          actions.push({
            action: "copy",
            label: `Copy ${token} reference`,
            run: () => copyBrowserText(token, "Copy component reference"),
          });
        }
        if (!virtualPart) {
          actions.push({
            action: "rename",
            label: "Rename",
            run: () => onRename?.(entry),
          });
        }
        const deletable = selectedDeletableRecords();
        const deleteCount = Math.max(1, deletable.length);
        actions.push({ hr: true });
        actions.push({
          action: "delete",
          label: deleteCount > 1 ? `Delete ${deleteCount} items` : (entry.virtual_body ? "Delete body" : "Delete component"),
          danger: true,
          run: () => {
            if (deleteCount > 1 && typeof onDeleteMany === "function") {
              onDeleteMany(deletable.map((row) => row.entry));
              return;
            }
            onDelete?.(entry);
          },
        });
      }
    } else {
      if (isRef && !isDxf && (browserEntryIsImage(entry) || entryOpensInVideoEditor(entry))) {
        actions.push({
          action: "open-editor",
          label: entryOpensInVideoEditor(entry) ? "Open in video editor" : "Open editor",
          run: () => runOpenInVideoEditor(entry),
        });
      }
      if (isRef && !isDxf && browserEntryIsImage(entry) && typeof onAddToVideoEditor === "function") {
        actions.push({
          action: "add-editor",
          label: "Add to editor",
          run: () => onAddToVideoEditor?.(entry),
        });
      }
      if (isRef && !isDxf && typeof onSendReferenceToPrompt === "function") {
        actions.push({
          action: "send-ai",
          label: "Send to AI prompt",
          run: () => {
            if (sectionId === "imagine" && isImagineCadEntry(entry) && typeof onSendComponentToPrompt === "function") {
              onSendComponentToPrompt(entry);
              return;
            }
            onSendReferenceToPrompt(entry);
          },
        });
      }
      if (isBrowserDirectDownloadEntry(entry, sectionId) && !canShare) {
        actions.push({
          action: "download",
          label: "Download",
          run: () => runBrowserDownload(entry, sectionId),
        });
      }
      if (canShare) {
        const imageEntry = browserEntryIsImage(entry);
        actions.push({ hr: true });
        if (!imageEntry) {
          actions.push({ action: "copy-link", label: "Copy share link", run: () => onReferenceShareAction(entry, sectionId, "copy-link") });
        }
        if (isCodeFilename(entry?.name || entry?.filename || "") || folderHasCode(entry) || isProjectCodeFolder(entry)) {
          actions.push({ action: "share-code", label: "Share", run: () => onReferenceShareAction(entry, sectionId, "copy-link") });
        }
        actions.push({ action: "share-x", label: "Share to X…", run: () => onReferenceShareAction(entry, sectionId, "share-x") });
        actions.push({ action: "share-slack", label: "Share to Slack…", run: () => onReferenceShareAction(entry, sectionId, "share-slack") });
        actions.push({ action: "share-discord", label: "Share to Discord…", run: () => onReferenceShareAction(entry, sectionId, "share-discord") });
        actions.push({ action: "download", label: "Download", run: () => runBrowserDownload(entry, sectionId) });
        if (!imageEntry) {
          actions.push({ action: "export-share", label: "Export / share…", run: () => onReferenceShareAction(entry, sectionId, "export-share") });
        }
      }
      if (typeof onStoreListing === "function" && isStoreImageFilename(browserDiskFilename(entry) || entry?.name)) {
        actions.push({
          action: "store",
          label: "Add to public profile/store...",
          run: () => onStoreListing(entry, sectionId),
        });
      }
      if (canFileMutate) {
        actions.push({
          action: "rename",
          label: "Rename",
          run: () => onRename?.(entry),
        });
        const deletable = selectedDeletableRecords();
        const deleteCount = Math.max(1, deletable.length);
        const kindLabel = isRobotBrowserSection(sectionId) ? "robot" : sectionId === "renders" ? "render" : sectionId === "imagine" ? "Imagine file" : "file";
        actions.push({ hr: true });
        actions.push({
          action: "delete",
          label: deleteCount > 1 ? `Delete ${deleteCount} items` : `Delete ${kindLabel}`,
          danger: true,
          run: () => {
            if (deleteCount > 1 && typeof onDeleteMany === "function") {
              onDeleteMany(deletable.map((row) => row.entry));
              return;
            }
            onDelete?.(entry);
          },
        });
      }
    }

    showBrowserContextMenu(e, {
      title: displayName(entry),
      subtitle: idToken,
      actions,
    });
  }

  function renderLoading() {
    if (!container) return;
    container.innerHTML = "";
    container.classList.add("design-browser");
    const wrap = document.createElement("div");
    wrap.className = "design-browser-loading";
    wrap.innerHTML =
      '<span class="proj-loading-spinner" aria-hidden="true"></span>' +
      "<span>Loading project…</span>";
    container.appendChild(wrap);
  }

  function buildVrCreationsGroupBy(browser) {
    const groupWrap = document.createElement("label");
    groupWrap.className = "browser-groupby";
    groupWrap.title = "Group VR Creations";
    const sel = document.createElement("select");
    sel.className = "browser-groupby-select";
    sel.setAttribute("aria-label", "Group VR Creations by");
    const current = browser.xr_creations_sort || "newest";
    for (const opt of XR_CREATIONS_SORTS) {
      const o = document.createElement("option");
      o.value = opt.id;
      o.textContent = opt.label;
      if (opt.id === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", (e) => {
      e.stopPropagation();
      onXrCreationsSort?.(sel.value);
    });
    groupWrap.append("Group by ", sel);
    return groupWrap;
  }

  function syncHeaderSearchButton() {
    const btn = document.getElementById("btn-viewport-browser-search");
    if (!btn) return;
    if (!btn.querySelector("svg")) btn.innerHTML = SECTION_SEARCH_ICON;
    btn.classList.add("viewport-browser-search", "browser-section-search", "browser-think-search");
    btn.title = "Search Browser by file name and type";
    btn.setAttribute("aria-label", "Search Browser");
    btn.setAttribute("aria-pressed", browserThinkOpen ? "true" : "false");
  }

  function setBrowserViewMode(_next) {
    browserViewMode = "list";
    try { localStorage.setItem(TREE_VIEW_KEY, "list"); } catch { /* private mode */ }
    syncHeaderViewButtons();
  }

  function syncHeaderViewButtons() {
    browserViewMode = "list";
    container?.classList.remove("design-browser--grid");
    document.getElementById("viewport-browser-host")?.classList.remove("design-browser--grid");
  }

  function bindHeaderView() {
    /* Grid view removed from Browser — list is the only layout. */
  }

  function bindHeaderSearch() {
    const btn = document.getElementById("btn-viewport-browser-search");
    if (!btn || btn.dataset.browserSearchBound === "1") return;
    btn.dataset.browserSearchBound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      browserThinkOpen = !browserThinkOpen;
      if (!browserThinkOpen) browserThinkQuery = "";
      render();
      if (browserThinkOpen) {
        requestAnimationFrame(() => container.querySelector("[data-browser-think]")?.focus());
      }
    });
  }

  function render() {
    if (!container) return;
    bindHeaderSearch();
    bindHeaderView();
    syncHeaderSearchButton();
    syncHeaderViewButtons();
    syncPartsCartShortcut(referenceSectionItems(browser).some(row => row.parts_tab));
    closeOpenRowKebabs();
    applyExpandStateForProject(getProjectId?.() || null);
    if (loading) {
      renderLoading();
      return;
    }
    browserEntryCache.clear();
    visibleSelectOrder.length = 0;
    container.innerHTML = "";
    container.classList.add("design-browser");
    container.classList.toggle("design-browser--think", browserThinkOpen);
    container.classList.remove("design-browser--grid");

    if (browserThinkOpen) {
      const overlay = document.createElement("div");
      overlay.className = "browser-think-overlay";
      const thinkWrap = document.createElement("div");
      thinkWrap.className = "browser-section-search-wrap browser-think-search-wrap";
      const input = document.createElement("input");
      input.type = "search";
      input.className = "browser-section-search-input";
      input.dataset.browserThink = "1";
      input.placeholder = "Think… name and type (e.g. js canvas)";
      input.value = browserThinkQuery;
      input.setAttribute("aria-label", "Search Browser by file name and type");
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          browserThinkOpen = false;
          browserThinkQuery = "";
          render();
        }
      });
      input.addEventListener("input", (e) => {
        browserThinkQuery = e.target.value;
        const start = e.target.selectionStart;
        render();
        const next = container.querySelector("[data-browser-think]");
        if (next) {
          next.focus();
          try { next.setSelectionRange(start, start); } catch { /* ignore */ }
        }
      });
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "browser-think-clear";
      clearBtn.textContent = "Clear";
      clearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        browserThinkOpen = false;
        browserThinkQuery = "";
        render();
      });
      thinkWrap.append(input, clearBtn);
      overlay.appendChild(thinkWrap);
      const hits = [];
      const walkHits = (items, sectionId) => {
        for (const entry of items || []) {
          if (hits.length >= 200) return;
          const childSection = entry?.browser_section || sectionId;
          if (entry?.virtual_folder && Array.isArray(entry.children)) {
            if (entryMatchesNameAndType(entry, browserThinkQuery)) hits.push({ entry, sectionId: childSection });
            walkHits(entry.children, childSection);
            continue;
          }
          if (entryMatchesNameAndType(entry, browserThinkQuery)) hits.push({ entry, sectionId });
        }
      };
      for (const section of SECTIONS) {
        walkHits(sectionRawItems(section, browser), isCadSection(section.id) ? "components" : section.id);
      }
      const list = document.createElement("ul");
      list.className = "browser-item-list browser-think-results";
      if (!hits.length) {
        const empty = document.createElement("li");
        empty.className = "browser-empty-item muted small";
        empty.textContent = browserThinkQuery.trim() ? "No matching files." : "Type a name and type, then clear to restore the tree.";
        list.appendChild(empty);
      } else {
        for (const hit of hits) {
          if (isShownVirtualFolder(hit.entry)) {
            list.appendChild(renderChildGroup(hit.entry, hit.sectionId));
            continue;
          }
          list.appendChild(renderItem(hit.entry, hit.sectionId));
        }
      }
      overlay.appendChild(list);
      container.appendChild(overlay);
      return;
    }

    for (const section of SECTIONS) {
      const rawItems = sectionRawItems(section, browser);
      const items = rawItems;
      if (section.id === "bodies" && !rawItems.length) continue;
      const sectionEl = document.createElement("div");
      sectionEl.className = "browser-section";
      sectionEl.dataset.section = section.id;

      const head = document.createElement("div");
      head.className = "browser-section-head";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "browser-section-toggle";
      if (section.id === selectedSection) toggle.classList.add("is-current");
      toggle.setAttribute("aria-expanded", expanded[section.id] ? "true" : "false");
      toggle.innerHTML = `
        <span class="browser-chevron">${expanded[section.id] ? "▾" : "▸"}</span>
        ${iconSvg(section.icon)}
        <span class="browser-section-label">${section.label}</span>
      `;
      toggle.addEventListener("click", () => {
        selectedSection = section.id;
        expanded[section.id] = !expanded[section.id];
        markExpandDirty();
        render();
        onOpenSection?.(section.id, rawItems);
      });
      bindBrowserRightClick(toggle, swallowBrowserWheelGesture);

      const count = document.createElement("span");
      count.className = "browser-section-count";
      const robotFolder = section.id === "robots" ? items.find(isRobotUrdfFolder) : null;
      const sectionCount = robotFolder ? (robotFolder.children || []).length : rawItems.length;
      count.textContent = formatTreeCount(sectionCount);
      count.title = String(treeCountValue(sectionCount));
      head.append(toggle, count);
      sectionEl.appendChild(head);

      if (expanded[section.id]) {
        if (section.id === 'robots') {
          const recordings = document.createElement('button');
          recordings.type = 'button'; recordings.className = 'browser-section-toggle';
          recordings.textContent = 'Recordings · Simulation / Viser / Hardware';
          recordings.addEventListener('click', () => {
            void import('../studio/robotics-data-explorer.js?v=20260923-recordings2-viser1&openarm-workspace=20260923-1&agent-handoff=20260923-1&vrrobot=20260927-2&design-readable=20260927-4').then(module => module.openRoboticsDataExplorer());
          });
          sectionEl.appendChild(recordings);
        }
        if (section.id === "vr_creations") {
          sectionEl.appendChild(buildVrCreationsGroupBy(browser));
        }
        const list = document.createElement("ul");
        list.className = "browser-item-list";
        if (!items.length) {
          const empty = document.createElement("li");
          empty.className = "browser-empty-item muted small";
          empty.textContent = sectionEmptyMessage(section.id);
          list.appendChild(empty);
        }
        for (const entry of items) {
          if (isShownVirtualFolder(entry)) {
            list.appendChild(renderChildGroup(entry, isCadSection(section.id) ? "components" : section.id));
            continue;
          }
          list.appendChild(renderItem(entry, isCadSection(section.id) ? "components" : section.id));
          if (isCadSection(section.id) && (entry.children?.length || entry.hardware?.length)) {
            list.appendChild(renderChildGroup(entry, "components"));
          }
        }
        sectionEl.appendChild(list);
      }
      container.appendChild(sectionEl);
    }
  }

  function itemKey(entry, sectionId) {
    if (sectionId === "sketches") return entry.stem || entry.id || entry.name;
    return entry.name;
  }

  function browserSelectionKey(sectionId, entry) {
    const id =
      sectionId === "sketches"
        ? (entry.filename || entry.name || entry.id || entry.stem)
        : (entry.name || entry.id || entry.stem);
    return `${sectionId}:${id}`;
  }

  function trackVisibleSelectKey(key) {
    if (key && !visibleSelectOrder.includes(key)) visibleSelectOrder.push(key);
  }

  function applySingleBrowserSelection(key) {
    selectedBrowserKeys.clear();
    if (key) selectedBrowserKeys.add(key);
    selectionAnchorKey = key || null;
  }

  function applyToggleBrowserSelection(key) {
    if (!key) return;
    if (selectedBrowserKeys.has(key)) selectedBrowserKeys.delete(key);
    else selectedBrowserKeys.add(key);
    selectionAnchorKey = key;
  }

  function applyRangeBrowserSelection(key) {
    const anchor = selectionAnchorKey && visibleSelectOrder.includes(selectionAnchorKey)
      ? selectionAnchorKey
      : key;
    const keys = keysInVisibleRange(visibleSelectOrder, anchor, key);
    selectedBrowserKeys.clear();
    for (const next of keys) selectedBrowserKeys.add(next);
    if (!selectionAnchorKey) selectionAnchorKey = key;
  }

  function applyBrowserPointerSelection(e, key) {
    if (e?.shiftKey && (selectionAnchorKey || selectedBrowserKeys.size)) {
      applyRangeBrowserSelection(key);
      return "range";
    }
    if (e?.metaKey || e?.ctrlKey) {
      applyToggleBrowserSelection(key);
      return "toggle";
    }
    applySingleBrowserSelection(key);
    return "single";
  }

  function selectedBrowserRecords() {
    const out = [];
    for (const key of selectedBrowserKeys) {
      const cached = browserEntryCache.get(key);
      if (cached?.entry) out.push(cached);
    }
    return out;
  }

  function entryDeleteFilename(entry) {
    if (!entry || entry.virtual_folder) return "";
    if (entry.virtual_component && !entry.source_filename && !entry.filename && entry.children?.length) return "";
    return browserDiskFilename(entry) || String(entry.name || "").trim();
  }

  function selectedDeletableRecords() {
    return selectedBrowserRecords().filter((row) => entryDeleteFilename(row.entry));
  }

  function entryMatchesSelection(entry, name, bodyIndex = null) {
    if (!entry) return false;
    const key = String(name || "");
    if (!key) return false;
    if (entry.name === key || entry.id === key || entry.viewer_filename === key) return true;
    if (entry.label && String(entry.label) === key) return true;
    if (entry.body_name && String(entry.body_name) === key) return true;
    if (Number.isInteger(bodyIndex) && entry.body_index === bodyIndex) return true;
    if (Number.isInteger(entry.body_index)) {
      const suffix = `#body:${entry.body_index + 1}`;
      if (key.endsWith(suffix) || key === `${entry.source_filename || entry.filename || ""}${suffix}`) return true;
    }
    return false;
  }

  function findSelectionTarget(name, bodyIndex = null) {
    const key = String(name || "");
    const idx = Number.isInteger(bodyIndex) ? bodyIndex : null;
    for (const parent of [...(browser.components || []), ...(browser.vr_creations || [])]) {
      const children = parent.children || [];
      if (idx != null) {
        const parentHit = parent.name === key || parent.viewer_filename === key || parent.id === key;
        const child = children.find((item) => item.body_index === idx && (
          parentHit
          || item.source_filename === key
          || item.parent_filename === key
          || item.filename === key
          || entryMatchesSelection(item, key, idx)
        ));
        if (child) return { entry: child, parent };
      }
      const nested = children.find((item) => entryMatchesSelection(item, key, idx));
      if (nested) return { entry: nested, parent };
      if (entryMatchesSelection(parent, key, null) && idx == null) return { entry: parent, parent: null };
    }
    return null;
  }

  function componentPayload(entry, sectionId, { stem, stored, recognized, wiringType } = {}) {
    const safeStem = stem || entry.stem || entry.name.replace(/\.[^.]+$/, "");
    const safeStored = stored || (sectionId === "components" ? getPartProfile?.(safeStem) || partProfiles.get(safeStem) || null : null);
    const safeRecognized = recognized || (sectionId === "components" ? recognizePart(safeStem) : null);
    const safeWiringType = wiringType || safeStored?.wiring_type || null;
    const pid = getProjectId?.() || null;
    if (sectionId === "components") {
      return {
        type: "component",
        sectionId: "components",
        projectId: pid,
        name: entry.name,
        filename: entry.source_filename || entry.filename || entry.name,
        stem: safeStem,
        format: entry.format,
        viewer_filename: entry.viewer_filename,
        body_index: Number.isInteger(entry.body_index) ? entry.body_index : null,
        body_name: entry.body_name || null,
        component_index: Number.isInteger(entry.component_index) ? entry.component_index : null,
        component_name: entry.component_name || entry.node_name || null,
        virtual_component: !!entry.virtual_component,
        virtual_body: !!entry.virtual_body,
        label: safeStored?.label || displayName(entry),
        wiringType: safeWiringType,
        part: safeStored
          ? { kind: safeStored.kind, label: safeStored.label, datasheet: safeStored.datasheet }
          : safeRecognized
          ? {
              kind: safeRecognized.kind,
              label: safeRecognized.label,
              partNumber: safeRecognized.partNumber,
              datasheet: safeRecognized.datasheet,
            }
          : null,
        profile: safeStored || null,
      };
    }
    const filename = entry.filename || entry.name;
    return {
      type: sectionId === "sketches" ? "sketch" : "wiring",
      projectId: pid,
      name: entry.name,
      filename,
      stem: safeStem,
      format: entry.format || sectionId,
      label: displayName(entry),
    };
  }

  function selectedBrowserPayloads(fallbackPayload) {
    const selected = [];
    for (const key of selectedBrowserKeys) {
      const cached = browserEntryCache.get(key);
      if (!cached) continue;
      const { entry, sectionId } = cached;
      const stem = entry.stem || entry.name?.replace(/\.[^.]+$/, "");
      const stored = sectionId === "components" ? (getPartProfile?.(stem) || partProfiles.get(stem) || null) : null;
      const recognized = sectionId === "components" ? recognizePart(stem) : null;
      const wiringType = stored?.wiring_type || null;
      selected.push(componentPayload(entry, sectionId, { stem, stored, recognized, wiringType }));
    }
    if (!selected.length && fallbackPayload) return [fallbackPayload];
    return selected;
  }

  function escapeHubText(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function hideVideoEditorHub() {
    videoEditorHubEl?.remove();
    videoEditorHubEl = null;
  }

  function hubFileExt(entry) {
    const name = String(entry?.filename || entry?.name || "");
    const match = name.match(/\.(webm|mp4|mov|m4v)$/i);
    return match ? match[1].toUpperCase() : "";
  }

  function hubFileSizeLabel(entry) {
    const n = Number(entry?.size ?? entry?.bytes ?? entry?.file_size);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }

  function hubDurationLabel(entry) {
    const n = Number(entry?.duration ?? entry?.duration_sec ?? entry?.length);
    if (!Number.isFinite(n) || n <= 0) return "";
    const sec = Math.round(n);
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}` : `${m}:${s}`;
  }

  function hubClipMeta(item) {
    const entry = item?.entry || {};
    return [
      item?.group || "",
      hubFileExt(entry),
      hubDurationLabel(entry),
      formatEntryCapturedAt(entry),
      hubFileSizeLabel(entry),
    ].filter(Boolean).join(" · ");
  }

  function hubIconButton(attr, svg, label, title) {
    return `<button type="button" class="video-editor-hub-icon" ${attr} title="${escapeHubText(title)}" aria-label="${escapeHubText(title)}">${svg}<span>${escapeHubText(label)}</span></button>`;
  }

  function showVideoEditorHub(folder) {
    hideVideoEditorHub();
    const items = videoEditorHubItems(folder);
    const overlay = document.createElement("div");
    overlay.className = "video-editor-hub";
    overlay.dataset.videoEditorHub = "1";
    overlay.innerHTML = `
      <div class="video-editor-hub-card" role="dialog" aria-label="Video Editor" aria-modal="true">
        <div class="video-editor-hub-head">
          <div class="video-editor-hub-title">
            <strong>Video Editor</strong>
            <p class="muted small">Open a project or clip. Studio stays open.</p>
          </div>
          <button type="button" class="btn secondary btn-compact" data-hub-close>Close</button>
        </div>
        <ul class="video-editor-hub-list">
          ${items.length ? items.map((item, i) => `
            <li class="video-editor-hub-row">
              <div class="video-editor-hub-copy">
                <span class="video-editor-hub-name">${escapeHubText(item.label)}</span>
                <span class="video-editor-hub-meta">${escapeHubText(hubClipMeta(item))}</span>
              </div>
              <span class="video-editor-hub-actions">
                ${hubIconButton(`data-hub-open="${i}"`, ICON_HUB_OPEN, "Open", "Open in editor")}
                ${hubIconButton(`data-hub-x="${i}"`, ICON_SHARE_X, "X", "Share to X")}
                ${hubIconButton(`data-hub-download="${i}"`, ICON_DOWNLOAD, "Save", "Download")}
              </span>
            </li>
          `).join("") : `<li class="video-editor-hub-empty muted small">No editor projects yet.</li>`}
        </ul>
      </div>
    `;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-hub-close]")) {
        hideVideoEditorHub();
        return;
      }
      const openBtn = e.target.closest("[data-hub-open]");
      const xBtn = e.target.closest("[data-hub-x]");
      const downloadBtn = e.target.closest("[data-hub-download]");
      const idx = Number(openBtn?.dataset.hubOpen ?? xBtn?.dataset.hubX ?? downloadBtn?.dataset.hubDownload);
      const row = items[idx];
      const entry = row?.entry;
      if (!entry) return;
      if (openBtn) {
        hideVideoEditorHub();
        onOpenVideoEditor?.(entry);
        return;
      }
      if (xBtn) {
        hideVideoEditorHub();
        onReferenceShareAction?.(row.mediaEntry || entry, "references", "share-x");
        return;
      }
      if (downloadBtn) {
        hideVideoEditorHub();
        onReferenceShareAction?.(row.mediaEntry || entry, "references", "download");
      }
    });
    document.body.appendChild(overlay);
    videoEditorHubEl = overlay;
  }

  function renderChildGroup(parentEntry, sectionId) {
    const childSectionId = parentEntry.browser_section || sectionId;
    const li = document.createElement("li");
    li.className = "browser-child-group";
    const groupKey = `${childSectionId}:${parentEntry.name}:children`;
    const captureFolder = sectionId === "references" && parentEntry.virtual_folder
      && /^(Screen Recordings|Screenshots|AR|Video Editor|recordings)$/i.test(String(parentEntry.folder || parentEntry.name || ""));
    // Folders stay collapsed until the user expands them. Do not auto-open
    // Video Editor, Screen Recordings, hardware, or body groups on first paint.
    childGroupsInitialized.add(groupKey);
    const isOpen = childGroupsExpanded.has(groupKey);
    const childCount = (parentEntry.children || []).length + (parentEntry.hardware?.length ? 1 : 0);
    const isVideoHub = sectionId === "references" && isVideoEditorHubFolder(parentEntry);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "browser-child-group-toggle";
    if (isVideoHub) btn.classList.add("browser-child-group-toggle--video-hub");
    btn.innerHTML = `
      <span class="browser-chevron" data-browser-folder-arrow>${isOpen ? "▾" : "▸"}</span>
      <span class="browser-section-label" data-browser-folder-label>${parentEntry.children_label || parentEntry.label || "Bodies"}</span>
      <span class="browser-section-count" title="${treeCountValue(childCount)}">${formatTreeCount(childCount)}</span>
    `;
    const toggleGroup = () => {
      if (childGroupsExpanded.has(groupKey)) childGroupsExpanded.delete(groupKey);
      else childGroupsExpanded.add(groupKey);
      markExpandDirty();
      render();
    };
    btn.addEventListener("click", (e) => {
      const onArrow = !!e.target.closest("[data-browser-folder-arrow]");
      const onLabel = !!e.target.closest("[data-browser-folder-label]");
      if (parentEntry.parts_tab && !onArrow) {
        e.preventDefault(); e.stopPropagation(); openPartsList(parentEntry.parts_tab); return;
      }
      if (isVideoHub && onLabel) {
        e.preventDefault();
        e.stopPropagation();
        showVideoEditorHub(parentEntry);
        return;
      }
      if (isVideoHub && !onArrow) {
        e.preventDefault();
        e.stopPropagation();
        showVideoEditorHub(parentEntry);
        return;
      }
      toggleGroup();
    });
    bindBrowserRightClick(btn, (ev) => {
      if (parentEntry.virtual_folder && !parentEntry.format && !parentEntry.viewer_filename) {
        if (sectionId === "references" || sectionId === "renders") {
          showItemContextMenu(ev, parentEntry, sectionId);
          return;
        }
        swallowBrowserWheelGesture(ev);
        return;
      }
      showItemContextMenu(ev, parentEntry, sectionId);
    });
    li.appendChild(btn);
    if (isRobotUrdfFolder(parentEntry) && typeof onToggleRobotVisuals === "function") {
      const shown = !!getRobotVisualsVisible?.();
      const vis = document.createElement("button");
      vis.type = "button";
      vis.className = "browser-vis-btn browser-robot-eye";
      vis.classList.toggle("is-hidden", !shown);
      vis.title = shown ? "Hide URDF/SRDF in the viewport" : "Show URDF/SRDF in the viewport";
      vis.setAttribute("aria-label", vis.title);
      vis.setAttribute("aria-pressed", shown ? "true" : "false");
      vis.innerHTML = eyeSvg(!shown);
      vis.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggleRobotVisuals(!shown);
      });
      li.appendChild(vis);
    }
    if (parentEntry.parts_tab) {
      li.classList.add("browser-parts-folder");
      btn.querySelector(".browser-section-label")?.insertAdjacentHTML("afterbegin", '<span class="parts-folder-icon" aria-hidden="true">▣</span> ');
      const cart = iconBtn(CART_ICON, {className: "browser-parts-open", title: "Open Parts List shopping cart"});
      cart.onclick = event => { event.stopPropagation(); openPartsList(parentEntry.parts_tab); };
      li.append(cart);
    }
    const folderBoard = parentEntry.virtual_folder ? editableCanvasBoard(parentEntry) : null;
    if (folderBoard && typeof onOpenCanvasBoard === "function") {
      const openCanvas = document.createElement("button");
      openCanvas.type = "button";
      openCanvas.className = "browser-open-canvas";
      openCanvas.title = `Open ${folderBoard.name} in canvas viewport`;
      openCanvas.setAttribute("aria-label", `Open ${folderBoard.name} in canvas viewport`);
      openCanvas.innerHTML = `<span aria-hidden="true">↗</span>`;
      openCanvas.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenCanvasBoard(parentEntry, folderBoard);
      });
      li.appendChild(openCanvas);
    }
    if (parentEntry.virtual_folder && (sectionId === "references" || sectionId === "renders" || sectionId === "imagine")) {
      const folderActions = document.createElement("div");
      folderActions.className = "browser-item-actions";
      const shareFile = folderShareEntry(parentEntry);
      const board = editableCanvasBoard(parentEntry);
      const addFolderBtn = (label, title, run) => {
        const actionBtn = document.createElement("button");
        actionBtn.type = "button";
        actionBtn.className = "browser-action-btn";
        actionBtn.textContent = label;
        actionBtn.title = title || label;
        actionBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          run?.(e);
        });
        folderActions.append(actionBtn);
      };
      if (typeof onSendReferenceToPrompt === "function") {
        addFolderBtn("Send to AI", "Send to AI", () => onSendReferenceToPrompt(parentEntry));
      }
      if (shareFile) {
        addFolderBtn("Download", "Download", () => runBrowserDownload(shareFile, sectionId));
      }
      if (board && typeof onOpenCanvasBoard === "function") {
        addFolderBtn("Open canvas", "Open the canvas in the canvas viewer", () => onOpenCanvasBoard(parentEntry, board));
      }
      if (shareFile && typeof onReferenceShareAction === "function") {
        addFolderBtn("Copy share link", "Copy share link", () => onReferenceShareAction(shareFile, sectionId, "copy-link"));
      }
      if (folderOpensInCodeEditor(parentEntry) && typeof onReferenceShareAction === "function") {
        addFolderBtn("Share", "Copy a code share link", () => onReferenceShareAction(parentEntry, sectionId, "copy-link"));
      }
      if (entryOpensInVideoEditor(parentEntry) && typeof onOpenVideoEditor === "function") {
        addFolderBtn("Open in video editor", "Open this folder in the video editor", () => runOpenInVideoEditor(parentEntry));
      }
      if (folderOpensInCodeEditor(parentEntry) && typeof onOpenCodeFolder === "function") {
        addFolderBtn("Open in code editor", "Open the project tree in the code editor", () => onOpenCodeFolder(parentEntry));
      }
      attachBrowserRowKebab(li, folderActions);
    }
    if (isOpen) {
      const nested = document.createElement("ul");
      nested.className = "browser-item-list browser-item-list--children";
      const nestedKids = captureFolder
        ? sortCaptureEntriesNewestFirst(parentEntry.children || [])
        : (parentEntry.children || []);
      if (!nestedKids.length && !parentEntry.hardware?.length && parentEntry.pinned_folder) {
        const empty = document.createElement("li");
        empty.className = "browser-empty-item muted small";
        empty.textContent = sectionEmptyMessage(childSectionId);
        nested.appendChild(empty);
      }
      for (const child of nestedKids) {
        if (isShownVirtualFolder(child)) {
          nested.appendChild(renderChildGroup(child, childSectionId));
          continue;
        }
        nested.appendChild(renderItem(child, childSectionId, { child: true }));
      }
      const hardwareFolder = hardwareFolderEntry(parentEntry);
      if (hardwareFolder) nested.appendChild(renderChildGroup(hardwareFolder, childSectionId));
      li.appendChild(nested);
    }
    return li;
  }

  function renderItem(entry, sectionId, { child = false } = {}) {
    if (sectionId === "joints") {
      const row = document.createElement("li"); row.className = "browser-item";
      row.dataset.filename = entry.name; row.dataset.section = "joints";
      const button = document.createElement("button"); button.type = "button"; button.className = "browser-item-body";
      button.textContent = `${displayName(entry)}${entry.joint_count ? ` · ${entry.joint_count} joints` : ""}`;
      button.title = "Open joint definitions and motion controls";
      button.addEventListener("click", () => openBrowserEntry(entry, "joints"));
      row.appendChild(button); return row;
    }
    const li = document.createElement("li");
    li.className = "browser-item";
    if (child) li.classList.add("browser-item--child");
    if (sectionId === "references" && isDxfEntry(entry)) li.classList.add("browser-item--drawing");
    if ((sectionId === "references" && !isDxfEntry(entry)) || sectionId === "renders" || sectionId === "imagine") {
      li.classList.add("browser-item--reference");
    }
    if (sectionId === "renders") li.classList.add("browser-item--render");
    if (sectionId === "imagine") li.classList.add("browser-item--imagine");
    const selectionKey = browserSelectionKey(sectionId, entry);
    browserEntryCache.set(selectionKey, { entry, sectionId });
    trackVisibleSelectKey(selectionKey);
    if (entryMatchesSelection(entry, selectedName, selectedBodyIndex) || (
      selectedBodyIndex != null
      && entry.body_index === selectedBodyIndex
      && (entry.source_filename === selectedCatalogName || entry.parent_filename === selectedCatalogName || entry.filename === selectedCatalogName)
    )) {
      li.classList.add("active");
    }
    if (selectedBrowserKeys.has(selectionKey)) {
      li.classList.add("browser-item--selected");
    }
    li.dataset.filename = entry.name;
    li.dataset.section = sectionId;
    let recognized = null;
    let stored = null;
    if (sectionId === "components") {
      const stem = entry.stem || entry.name.replace(/\.[^.]+$/, "");
      recognized = recognizePart(stem);
      stored = (getPartProfile?.(stem)) || partProfiles.get(stem) || null;
      // A saved/sourced profile is authoritative over the filename heuristic.
      const wiringType = stored?.wiring_type || null;
      const kindLabel = stored?.kind || recognized?.kind || null;
      const sourced = !!stored?.source;
      li.classList.add("browser-item--draggable");
      li.draggable = true;
      li.title = entry.virtual_component
        ? `${displayName(entry)} — component inside ${entry.source_filename || entry.parent_filename || entry.viewer_filename || entry.name}. Click to select this component in the viewport.`
        : entry.virtual_body
        ? `${displayName(entry)} — generated body inside ${entry.source_filename || entry.parent_filename || entry.viewer_filename || entry.name}. Drag into the AI prompt to target this body.`
        : sourced
        ? `${entry.name} — sourced as "${stored.label || kindLabel}". Drag into the Wiring Simulator to drop the exact part with its pins & stats.`
        : kindLabel
        ? `${entry.name} — recognized as ${kindLabel}. Click the ⓘ profile to source it online. Drag into the AI prompt or Wiring Simulator.`
        : `${entry.name} — click the ⓘ profile to identify & source this part. Drag into the AI prompt or Wiring Simulator.`;
      li.addEventListener("dragstart", (e) => {
        suppressBrowserClick = true;
        if (!selectedBrowserKeys.has(selectionKey)) {
          selectedBrowserKeys.clear();
          selectedBrowserKeys.add(selectionKey);
          li.classList.add("browser-item--selected");
        }
        const payload = componentPayload(entry, sectionId, { stem, stored, recognized, wiringType });
        setExplorerDragData(e, selectedBrowserPayloads(payload));
        onDragComponent?.(entry);
      });
      li.addEventListener("dragend", clearBrowserClickSuppress);
    }

    const visKey = itemKey(entry, sectionId);
    const vis = document.createElement("button");
    vis.type = "button";
    vis.className = "browser-vis-btn";
    const isHidden = hidden.has(visKey);
    li.classList.toggle("hidden-component", isHidden);
    vis.classList.toggle("is-hidden", isHidden);
    vis.title = isRobotBrowserSection(sectionId)
      ? (isHidden ? "Show this robot file in the viewport" : "Hide this robot file in the viewport")
      : isHidden ? "Show component" : "Hide component";
    vis.setAttribute("aria-label", isHidden ? "Show component" : "Hide component");
    vis.setAttribute("aria-pressed", isHidden ? "true" : "false");
    vis.innerHTML = eyeSvg(isHidden);
    vis.addEventListener("click", (e) => {
      e.stopPropagation();
      if (hidden.has(visKey)) hidden.delete(visKey);
      else hidden.add(visKey);
      onToggleVisibility?.(entry, !hidden.has(visKey), sectionId);
      render();
    });

    const body = document.createElement("button");
    body.type = "button";
    body.className = "browser-item-body";
    const bodyIcon = (child && entry.virtual_body) ? '<span class="browser-body-icon" aria-hidden="true">◆</span>' : '';
    const shownName = displayName(entry);
    const vrIcon = (!child && (entry.xr_creation || entry.xr_headset))
      ? `<span class="browser-vr-icon" title="Created in VR">${vrHeadsetGlyph()}</span>`
      : "";
    const authorBit = (entry.xr_creation || entry.xr_body || entry.authorName || entry.authorId)
      ? `<span class="browser-item-author">${authorHighlightText(entry)}</span>`
      : "";
    body.innerHTML = `${bodyIcon}<span class="browser-item-name">${shownName}${vrIcon}</span>${authorBit}`;
    body.title = sectionId === "sketches"
      ? `${entry.name} — double-click to edit`
      : isCadSection(sectionId)
        ? `${shownName} — double-click to frame in the viewport`
        : isCaptureBrowserEntry(entry)
        ? captureHoverTitle(entry, shownName)
        : (entry.xr_creation || entry.xr_body)
          ? `${shownName} — ${authorHighlightText(entry)}`
          : entry.name;
    body.addEventListener("click", (e) => {
      if (suppressBrowserClick) return;
      const mode = applyBrowserPointerSelection(e, selectionKey);
      if (mode !== "single") {
        render();
        return;
      }
      selectedName = entry.name;
      selectedBodyIndex = Number.isInteger(entry.body_index) ? entry.body_index : null;
      selectedCatalogName = entry.source_filename || entry.parent_filename || entry.filename || null;
      // Clicking a hidden component should bring it back, not silently no-op.
      if ((sectionId === "components" || isRobotBrowserSection(sectionId)) && hidden.has(visKey)) {
        hidden.delete(visKey);
        onToggleVisibility?.(entry, true, sectionId);
      }
      if (sectionId === "joints") onOpenJoint?.(entry);
      else if (sectionId === "components") onOpenComponent?.(entry);
      else if (isRobotBrowserSection(sectionId)) onOpenRobot?.(entry);
      else if (sectionId === "references") {
        if (isDxfEntry(entry)) onOpenDrawing?.(entry);
        else onOpenReference?.(entry);
      }
      else if (sectionId === "renders") onOpenReference?.(entry);
      else if (sectionId === "imagine") {
        if (isImagineCadEntry(entry)) onOpenComponent?.(entry);
        else onOpenReference?.(entry);
      }
      else if (sectionId === "sketches") onOpenSketch?.(entry);
      else onOpenWiring?.(entry);
      render();
    });
    if (sectionId === "sketches") {
      body.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectedName = entry.name;
        onEditSketch?.(entry);
        render();
      });
    } else if (isCadSection(sectionId) && typeof onFrameComponent === "function") {
      body.addEventListener("dblclick", (e) => {
        if (suppressBrowserClick) return;
        e.preventDefault();
        e.stopPropagation();
        selectedName = entry.name;
        selectedBodyIndex = Number.isInteger(entry.body_index) ? entry.body_index : null;
        selectedCatalogName = entry.source_filename || entry.parent_filename || entry.filename || null;
        onFrameComponent(entry);
      });
    }

    const actions = document.createElement("div");
    actions.className = "browser-item-actions";
    let profileBtn = null;
    let downloadBtn = null;
    if (isBrowserDirectDownloadEntry(entry, sectionId)) {
      downloadBtn = iconBtn(ICON_DOWNLOAD, {
        className: "browser-action-download",
        title: "Download",
      });
      downloadBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        runBrowserDownload(entry, sectionId);
      });
    }
    if (sectionId === "components") {
      const sendAi = document.createElement("button");
      sendAi.type = "button";
      sendAi.className = "browser-action-btn browser-action-send-ai";
      sendAi.textContent = "AI";
      sendAi.title = entry.virtual_body
        ? "Send this body to the AI prompt as a reference"
        : "Send this object to the AI prompt as a reference";
      sendAi.addEventListener("click", (e) => {
        e.stopPropagation();
        onSendComponentToPrompt?.(entry);
      });
      if (typeof onFixWheels === "function") {
        const fixWheels = document.createElement("button");
        fixWheels.type = "button";
        fixWheels.className = "browser-action-btn browser-action-fix-wheels";
        fixWheels.textContent = "Fix wheels";
        fixWheels.title = "Send selected CAD (1–few) to agents so wheels drive, then clip-bot QC";
        fixWheels.addEventListener("click", (e) => {
          e.stopPropagation();
          const selected = (selectedBrowserPayloads(null) || []).filter((row) => row);
          onFixWheels(selected.length ? selected : [entry]);
        });
        actions.append(fixWheels);
      }
      if (typeof onQcRig === "function") {
        const qcBtn = document.createElement("button");
        qcBtn.type = "button";
        qcBtn.className = "browser-action-btn browser-action-qc-rig";
        qcBtn.textContent = "QC rig";
        qcBtn.title = "Second bot: check sidecars, Play clip, no dummy spheres";
        qcBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          onQcRig(entry);
        });
        actions.append(qcBtn);
      }
      if (!(entry.virtual_body || entry.virtual_component)) {
        profileBtn = document.createElement("button");
        profileBtn.type = "button";
        profileBtn.className = "browser-action-btn browser-action-profile";
        profileBtn.textContent = "ⓘ";
        profileBtn.title = "View component ID, tags, part profile, and 3D preview";
        profileBtn.setAttribute("aria-label", "Component info");
        profileBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          onOpenProfile?.(entry);
        });
        if (!entry.catalog_hardware) {
          const exp = iconBtn(ICON_EXPORT, { title: isHidden ? "Show this component before exporting it" : "Export" });
          exp.disabled = isHidden;
          exp.addEventListener("click", (e) => {
            e.stopPropagation();
            if (isHidden) return;
            onExport?.(entry, exp);
          });
          actions.append(exp);
        }
        const ren = iconBtn(ICON_RENAME, { title: "Rename" });
        ren.addEventListener("click", (e) => {
          e.stopPropagation();
          onRename?.(entry);
        });
        const del = iconBtn(ICON_DELETE, { title: "Delete", danger: true });
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          onDelete?.(entry);
        });
        actions.append(ren, del);
      } else if (isBrowserCadExportEntry(entry, sectionId)) {
        const exp = iconBtn(ICON_EXPORT, { title: isHidden ? "Show this body before exporting it" : "Export" });
        exp.disabled = isHidden;
        exp.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isHidden) return;
          onExport?.(entry, exp);
        });
        actions.append(exp);
      }
      actions.prepend(sendAi);
    } else if (sectionId === "references" || isRobotBrowserSection(sectionId) || sectionId === "renders" || sectionId === "imagine") {
      if ((sectionId === "references" && !isDxfEntry(entry)) || sectionId === "renders" || sectionId === "imagine") {
        const sendAi = document.createElement("button");
        sendAi.type = "button";
        sendAi.className = "browser-action-btn browser-action-send-ai";
        sendAi.textContent = "AI";
        sendAi.title = "Send this file, notes, and markups to the AI prompt";
        sendAi.addEventListener("click", (e) => {
          e.stopPropagation();
          if (sectionId === "imagine" && isImagineCadEntry(entry)) onSendComponentToPrompt?.(entry);
          else onSendReferenceToPrompt?.(entry);
        });
        actions.append(sendAi);
        if (isCodeFilename(entry?.name || entry?.filename || "") && typeof onReferenceShareAction === "function") {
          const shareBtn = document.createElement("button");
          shareBtn.type = "button";
          shareBtn.className = "browser-action-btn";
          shareBtn.textContent = "Share";
          shareBtn.title = "Copy a code share link";
          shareBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            onReferenceShareAction(entry, sectionId, "copy-link");
          });
          actions.append(shareBtn);
        }
        if (browserEntryIsVideo(entry) && typeof onReferenceShareAction === "function") {
          const shareX = iconBtn(ICON_SHARE_X, {
            className: "browser-action-share-x",
            title: "Share to X",
          });
          shareX.innerHTML = `${ICON_SHARE_X}<span class="viewport-video-share-x-spinner" hidden aria-hidden="true"></span>`;
          shareX.addEventListener("click", (e) => {
            e.stopPropagation();
            onReferenceShareAction(entry, sectionId, "share-x");
          });
          actions.append(shareX);
        }
        if (browserEntryIsImage(entry) || browserEntryIsVideo(entry)) {
          const ed = document.createElement("button");
          ed.type = "button";
          ed.className = "browser-action-btn browser-action-editor";
          ed.textContent = browserEntryIsVideo(entry) ? "Open in video editor" : "Editor";
          ed.title = browserEntryIsVideo(entry) ? "Open in video editor" : "Open clip editor";
          ed.addEventListener("click", (e) => {
            e.stopPropagation();
            runOpenInVideoEditor(entry);
          });
          actions.append(ed);
        }
      }
      const ren = iconBtn(ICON_RENAME, { title: "Rename" });
      ren.addEventListener("click", (e) => {
        e.stopPropagation();
        onRename?.(entry);
      });
      const del = iconBtn(ICON_DELETE, { title: "Delete", danger: true });
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        onDelete?.(entry);
      });
      actions.append(ren, del);
    } else if (isBrowserCadExportEntry(entry, sectionId) || isBrowserDirectDownloadEntry(entry, sectionId)) {
      if (isBrowserCadExportEntry(entry, sectionId) && !downloadBtn) {
        const exp = iconBtn(ICON_EXPORT, { title: isHidden ? "Show this item before exporting it" : "Export" });
        exp.disabled = isHidden;
        exp.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isHidden) return;
          onExport?.(entry, exp);
        });
        actions.append(exp);
      }
    }

    if (downloadBtn) {
      const ai = actions.querySelector(".browser-action-send-ai");
      if (ai) ai.after(downloadBtn);
      else actions.prepend(downloadBtn);
    }
    if (profileBtn) actions.append(profileBtn);

    if (sectionId === "references" || sectionId === "renders" || sectionId === "imagine") {
      li.append(body);
    } else {
      li.append(vis, body);
    }
    attachBrowserRowKebab(li, actions);
    const menuStem = entry.stem || String(entry.name || "").replace(/\.[^.]+$/, "");
    const menuPayload = componentPayload(
      entry,
      sectionId === "sketches" || sectionId === "wiring"
        ? sectionId
        : (isCadSection(sectionId) ? "components" : sectionId),
      { stem: menuStem, stored, recognized, wiringType: stored?.wiring_type || null },
    );
    bindBrowserRightClick(li, (ev) => {
      if (!selectedBrowserKeys.has(selectionKey)) applySingleBrowserSelection(selectionKey);
      showItemContextMenu(ev, entry, sectionId, menuPayload);
    });
    return li;
  }

  return {
    render(data = browser) {
      loading = false;
      applyExpandStateForProject(getProjectId?.() || null);
      browser = {
        components: data.components || [],
        joints: data.joints || [],
        vr_creations: data.vr_creations || [],
        bodies: data.bodies || [],
        robots: data.robots || [],
        drawings: data.drawings || [],
        references: data.references || [],
        renders: data.renders || [],
        imagine: data.imagine || [],
        sketches: data.sketches || [],
        wiring: data.wiring || [],
        xr_creations_sort: data.xr_creations_sort || "newest",
      };
      render();
    },
    setLoading(on) {
      const next = !!on;
      if (loading === next) return;
      loading = next;
      render();
    },
    setSelected(name, opts = {}) {
      const bodyIndex = Number.isInteger(opts.bodyIndex) ? opts.bodyIndex : null;
      const match = findSelectionTarget(name, bodyIndex);
      selectedName = match?.entry?.name || name;
      selectedBodyIndex = match?.entry && Number.isInteger(match.entry.body_index)
        ? match.entry.body_index
        : bodyIndex;
      selectedCatalogName = match?.parent?.name
        || match?.entry?.source_filename
        || match?.entry?.parent_filename
        || (bodyIndex != null ? name : null);
      // Do not auto-expand Bodies on selection — that undoes collapse after
      // hydration / viewport picks. Expand the Components section only so the
      // parent row stays visible.
      if (match?.entry) expanded.components = true;
      selectedBrowserKeys.clear();
      if (match?.entry) selectedBrowserKeys.add(browserSelectionKey("components", match.entry));
      render();
      requestAnimationFrame(() => {
        container?.querySelector(".browser-item.active")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      });
    },
    setSelectedMany(names = []) {
      selectedBrowserKeys.clear();
      const orderedNames = [...new Set((names || []).filter(Boolean).map(String))];
      selectedName = orderedNames[0] || null;
      selectedBodyIndex = null;
      selectedCatalogName = null;
      for (const name of orderedNames) {
        const entry = (browser.components || []).find((item) => item?.name === name || item?.viewer_filename === name);
        if (entry) selectedBrowserKeys.add(browserSelectionKey("components", entry));
      }
      render();
    },
    setPartProfiles(map) {
      partProfiles = map instanceof Map ? map : new Map(Object.entries(map || {}));
      render();
    },
    ensureVisible(name) {
      const key = String(name || "");
      if (!key || !hidden.has(key)) return false;
      hidden.delete(key);
      render();
      return true;
    },
    getHidden() {
      return new Set(hidden);
    },
    getComponents() {
      return [...(browser.components || [])];
    },
    getSelectedName() {
      return selectedName;
    },
    getSelectedEntries() {
      return selectedBrowserPayloads(null);
    },
    isHidden(name) {
      return hidden.has(name);
    },
    setHidden(names = []) {
      hidden.clear();
      for (const name of names) {
        if (name) hidden.add(String(name));
      }
      render();
    },
    revealReferenceFolder(folderName) {
      const raw = String(folderName || "").trim();
      const top = raw.split("/")[0] || "Screen Recordings";
      expanded.references = true;
      const groupKey = `references:${top}:children`;
      childGroupsExpanded.add(groupKey);
      childGroupsInitialized.add(groupKey);
      markExpandDirty();
      render();
    },
  };
}
