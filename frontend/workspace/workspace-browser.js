/** Workspace folders + drag-and-drop project organization. */

import { recognizePart } from "../components/part-catalog.js?v=20260906-fritz";
import { authHeaders } from "../studio/auth.js?v=20260805-handle-signup";
import { setExplorerDragData } from "../studio/explorer-drag.js?v=20260618-multi-drag";
import { createProjectShareDialog } from "../social/project-share.js?v=20260907-xr-hub-sharechat1-20260915-nativejoints1-projshare1-20260916-shareui1&leakfix79";
import {
  nestReferenceFolderItems,
  filterBrowserEntriesByName,
  sortReferenceEntries,
  formatReferenceTimestamp,
  collectProjectReferenceItems,
  isReferenceVirtualFolder,
  referenceFolderKey,
  isReferenceFolderOpen,
  REFERENCE_FILES_GRID_CLASS,
  entryOpensInVideoEditor,
  videoEditorActionEntry,
} from "../components/reference-files.js?v=20260907-capture-names-hidrig1-refcap1-treefold1-20260914-clipmedia2-20260915-refrec1-reftab1-refcode1-foldcode1-20260915-code-workspace3-heicpng1-vidopen1-browcol1&leakfix7&leakfix9&filmapply=20261006-2";
import {
  captureHoverTitle,
  friendlyCaptureDisplayName,
  isCaptureBrowserEntry,
  formatEntryCapturedAt,
} from "../viewport/capture-labels.js?v=20260907-capture-names-20260915-refrec1-20260915-recclock1";
import {
  VR_CREATIONS_FOLDER,
  XR_CREATIONS_SORTS,
  authorHighlightText,
  nestXrCreationsInBrowser,
} from "../xr/xr-creations-browser.js?v=20260908-bodiesvr1-vrbodies1";
import {
  browserEntryIsImage,
  browserEntryIsVideo,
  isBrowserCadExportEntry,
  isBrowserDirectDownloadEntry,
  keysInVisibleRange,
  nestRendersWithImagine,
  nestReferencesWithSketches,
} from "../components/project-tree.js?v=20260923-draw-recordings1&vrrobot=20260927-2&design-readable=20260927-4&filmapply=20261006-2";
import { formatTreeCount, treeCountValue } from "../components/tree-count.js?v=20260915-treecount1";
import { pickBrowserFolderImage, editableCanvasBoard } from "../viewport/canvas-context.js?v=canvas-2e2d00af6fb4";
import {
  isProjectCodeFolder,
  folderHasCode,
  folderHasEditorFiles,
  folderShareEntry,
} from "../components/project-code.js?v=foldcode1";

function folderOpensInCodeEditor(entry) {
  if (entryOpensInVideoEditor(entry)) return false;
  return isProjectCodeFolder(entry) || folderHasCode(entry) || folderHasEditorFiles(entry);
}
import { listedSidebarWorkspaces, lastOpenedSidebarProject, currentListedSidebarWorkspace, listedSidebarSharedProjects, loadSharedSidebarPrefs, saveSharedSidebarPrefs, clampSharedRecentsCount, belongsInPersonalFolderList, belongsInPersonalProjectsList, inferPersonalWorkspaceId, projectOwnerId, isCommunityProject, unlistedPersonalProjects, canPinPersonalProject, normalizePersonalPinIds, partitionPersonalPinnedProjects, sortProjectsForDisplay as sortProjectsByRecency } from "./workspace-list.js?v=20260908-projsearch1-shared1-20260909-projopen2-authfast1-20260915-shareui1-20260915-pubpin1-projpin1-publicmine1";
import {
  GUEST_PUBLIC_LIST_LIMIT,
  guestPublicVisibleSlice,
  isNewOrGuestExplorer,
  onlineModelsNeedsLogin,
  publicAuthorHandle,
  publicAuthorName,
  publicAuthorUserId,
  publicProfileHref,
  publicProjectThumbUrl,
  shouldShowPublicHover,
  withGuestPublicPin,
} from "../components/online-models.js?v=onlinemod1-publicmine1";

const FOLDER_COLLAPSE_KEY = "render3d:folder-collapsed";
const PROJECT_EXPAND_KEY = "render3d:project-expanded";
const PROJECT_SEARCH_KEY = "render3d:project-search";
const PROJECT_VIEW_KEY = "render3d:project-view";
const EXPLORER_PANE_KEY = "render3d:explorer-pane";
const REFS_SORT_KEY = "render3d:refs-sort";
const REFS_VIEW_KEY = "render3d:refs-view";
const REFS_SEARCH_KEY = "render3d:refs-search";
const FOLDER_SHOW_ALL_KEY = "render3d:folder-show-all";
const HIERARCHY_SHOW_ALL_KEY = "render3d:hierarchy-show-all";
const HIERARCHY_BODIES_EXPAND_KEY = "render3d:hierarchy-bodies-expanded:v1";
const FOLDER_ARCHIVE_KEY = "render3d:archived-folders:v1";
const ARCHIVE_SECTION_COLLAPSE_KEY = "render3d:archive-section-collapsed:v1";
const EXPANDED_WS_KEY = "render3d:workspace-row-expanded:v1";
const ARCHIVE_SECTION_ID = "__archive__";
const COMPACT_LIST_LIMIT = 5;
const projectThumbBlobs = new Map();
function revokeUnlistedProjectThumbs(keepIds) { // leakfix27
  const keep = new Set([...keepIds || []].map((id) => String(id || "")).filter(Boolean));
  for (const [id, entry] of [...projectThumbBlobs.entries()]) {
    if (keep.has(String(id))) continue;
    projectThumbBlobs.delete(id);
    const url = entry?.objectUrl;
    if (!url) continue;
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
}
let thumbIntersectObserver = null;
let thumbObserverRoot = undefined;
const THUMB_RETRY_MS = [900, 2200, 5000];
let generationElapsedTimer = null;

export function formatGenerationElapsed(startedAt, nowMs = Date.now()) {
  const startedMs = Date.parse(String(startedAt || ""));
  if (!Number.isFinite(startedMs)) return "";
  const totalMinutes = Math.max(1, Math.floor((Number(nowMs) - startedMs) / 60000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

export function personalProjectPinAction(project, {
  signedIn = false,
  canToggle = false,
  pinnedIds = [],
} = {}) {
  const id = String(project?.id || "").trim();
  const pinned = !!id && normalizePersonalPinIds(pinnedIds).includes(id);
  const visible = !!signedIn && !!canToggle && (pinned || canPinPersonalProject(project));
  return {
    visible,
    pinned,
    label: pinned ? "Unpin from projects" : "Pin to projects",
  };
}

function refreshGenerationElapsed(root = document, nowMs = Date.now()) {
  root.querySelectorAll?.("[data-generation-started-at]").forEach((el) => {
    const value = formatGenerationElapsed(el.dataset.generationStartedAt, nowMs);
    if (value && el.textContent !== value) el.textContent = value;
  });
}

function ensureGenerationElapsedClock() {
  if (generationElapsedTimer != null || typeof window === "undefined") return;
  generationElapsedTimer = window.setInterval(() => refreshGenerationElapsed(), 15000);
}

const EMPTY_THUMB_SRC = "/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1";

export function projectsInCurrentWorkspace(projects = [], workspaceId = null) {
  const list = Array.isArray(projects) ? projects : [];
  const wid = workspaceId != null && String(workspaceId).trim() && String(workspaceId) !== "__all__"
    ? String(workspaceId)
    : "";
  if (!wid) return list.slice();
  return list.filter((p) => String(p?.team_id || "") === wid);
}

function projectThumbRevision(project = {}) {
  const gen = project.generation || {};
  return [
    project.file_count ?? "",
    project.latest_file || project.latest_model || "",
    gen.trace_id || "",
    gen.status || "",
  ].join(":");
}

function paintEmptyThumb(thumb) {
  if (!thumb) return;
  thumb.classList.add("proj-thumb--empty");
  const img = document.createElement("img");
  img.className = "proj-thumb-img proj-thumb-logo";
  img.alt = "";
  img.src = EMPTY_THUMB_SRC;
  thumb.replaceChildren(img);
}

function paintCachedThumb(thumb, objectUrl) {
  if (!thumb || !objectUrl) return false;
  thumb.classList.remove("proj-thumb--empty");
  const existing = thumb.querySelector("img.proj-thumb-img");
  if (existing && existing.src === objectUrl) return true;
  const img = document.createElement("img");
  img.className = "proj-thumb-img";
  img.alt = "";
  img.src = objectUrl;
  thumb.replaceChildren(img);
  return true;
}

function ensureProjectThumbObserver() {
  const root = document.querySelector(".sidebar.left .left-scroll")
    || document.querySelector(".left-scroll")
    || null;
  if (thumbIntersectObserver && thumbObserverRoot === root) return thumbIntersectObserver;
  try { thumbIntersectObserver?.disconnect?.(); } catch { /* ignore */ }
  thumbObserverRoot = root;
  try {
    thumbIntersectObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (window.__studioDeferExplorerThumbs) continue;
          thumbIntersectObserver.unobserve(entry.target);
          void hydrateProjectThumb(entry.target);
        }
      },
      { root, rootMargin: "80px 0px", threshold: 0.01 },
    );
  } catch {
    thumbIntersectObserver = { observe() {}, unobserve() {}, disconnect() {} };
  }
  return thumbIntersectObserver;
}

function flushDeferredExplorerThumbs() {
  if (window.__studioDeferExplorerThumbs) return;
  document.querySelectorAll(".proj-thumb[data-thumb-url]").forEach((el) => {
    if (el.querySelector("img")) return;
    try { ensureProjectThumbObserver()?.observe?.(el); } catch (_) {}
  });
}
try {
  window.addEventListener("render3d:explorer-thumbs-ready", flushDeferredExplorerThumbs);
} catch (_) {}

async function hydrateProjectThumb(thumb, attempt = 0) {
  const url = thumb?.dataset?.thumbUrl;
  const projectId = thumb?.dataset?.projectId;
  const rev = thumb?.dataset?.thumbRev || "";
  if (!url || !projectId) {
    paintEmptyThumb(thumb);
    return;
  }
  const cached = projectThumbBlobs.get(projectId);
  if (cached?.objectUrl && cached.rev === rev && cached.sourceUrl === url) {
    paintCachedThumb(thumb, cached.objectUrl);
    return;
  }
  try {
    const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    if (res.status === 204) {
      const err = new Error("no thumb");
      err.retry = true;
      throw err;
    }
    if (!res.ok) throw new Error("no thumb");
    const blob = await res.blob();
    if (!blob?.size) throw new Error("empty");
    const type = String(blob.type || "").toLowerCase();
    if (type && !type.startsWith("image/") && type !== "application/octet-stream") {
      throw new Error("empty");
    }
    const objectUrl = URL.createObjectURL(blob);
    const prev = cached?.objectUrl;
    projectThumbBlobs.set(projectId, { objectUrl, sourceUrl: url, rev });
    paintCachedThumb(thumb, objectUrl);
    if (prev && prev !== objectUrl) URL.revokeObjectURL(prev);
  } catch (err) {
    if (cached?.objectUrl) paintCachedThumb(thumb, cached.objectUrl);
    else paintEmptyThumb(thumb);
    const retry = !!(err && err.retry) && attempt < THUMB_RETRY_MS.length;
    if (retry && thumb?.isConnected) {
      const delay = THUMB_RETRY_MS[attempt];
      window.setTimeout(() => {
        if (!thumb.isConnected) return;
        void hydrateProjectThumb(thumb, attempt + 1);
      }, delay);
    }
  }
}

let projectSearchQuery = "";
try {
  projectSearchQuery = sessionStorage.getItem(PROJECT_SEARCH_KEY) || "";
} catch (_) {}

let projectViewMode = "list";
try {
  const savedView = localStorage.getItem(PROJECT_VIEW_KEY);
  if (savedView === "grid" || savedView === "list") projectViewMode = savedView;
} catch (_) {}

let explorerPane = "projects";
// Refresh / page load always opens Projects. In-session tab clicks stay until reload.

let refsSortDirection = "newest";
try {
  if (localStorage.getItem(REFS_SORT_KEY) === "oldest") refsSortDirection = "oldest";
} catch (_) {}

let refsViewMode = "list";
try {
  if (localStorage.getItem(REFS_VIEW_KEY) === "grid") refsViewMode = "grid";
} catch (_) {}

let refsSearchQuery = "";
try {
  refsSearchQuery = sessionStorage.getItem(REFS_SEARCH_KEY) || "";
} catch (_) {}

function loadIdSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

function saveIdSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

const ICON_HIERARCHY_KEBAB = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="3.4" r="1.35" fill="currentColor"/><circle cx="8" cy="8" r="1.35" fill="currentColor"/><circle cx="8" cy="12.6" r="1.35" fill="currentColor"/></svg>`;

/** Long-press (mobile) → same action as right-click context menu. */
function bindLongPress(el, onLongPress, { ms = 480, moveTolerance = 14 } = {}) {
  if (!el || typeof onLongPress !== "function") return () => {};
  let timer = 0;
  let armTimer = 0;
  let startX = 0;
  let startY = 0;
  let fired = false;
  let armed = false;

  const clearSelection = () => {
    try {
      const sel = window.getSelection?.();
      if (sel && sel.rangeCount) sel.removeAllRanges();
    } catch {
      /* ignore */
    }
  };

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = 0;
    }
    armed = false;
    el.classList.remove("is-long-pressing");
  };

  const onSelectStart = (e) => {
    if (armed || fired || timer) {
      e.preventDefault();
      clearSelection();
    }
  };

  const onStart = (e) => {
    if (e.target?.closest?.("button, a, input, select, textarea, .btn-folder-new-project, .btn-folder-menu, .folder-collapse-btn")) return;
    if (e.touches?.length && e.touches.length !== 1) return;
    const t = e.touches?.[0] || e;
    startX = t.clientX;
    startY = t.clientY;
    fired = false;
    clear();
    el.classList.add("is-long-pressing");
    // Arm early so iOS can't start a text highlight while the hold continues.
    armTimer = window.setTimeout(() => {
      armed = true;
      clearSelection();
    }, 180);
    timer = window.setTimeout(() => {
      fired = true;
      armed = true;
      clearSelection();
      try {
        navigator.vibrate?.(14);
      } catch {
        /* ignore */
      }
      onLongPress({
        clientX: startX,
        clientY: startY,
        preventDefault() {},
        stopPropagation() {},
        target: el,
      });
      clearSelection();
    }, ms);
  };

  const onMove = (e) => {
    const t = e.touches?.[0] || e;
    if (!t || (!timer && !armTimer)) return;
    if (Math.hypot(t.clientX - startX, t.clientY - startY) > moveTolerance) {
      clear();
      return;
    }
    if (armed) clearSelection();
  };

  const onEnd = (e) => {
    if (fired || armed) {
      e.preventDefault?.();
      e.stopPropagation?.();
      clearSelection();
    }
    if (fired) {
      el.dataset.longPressConsumed = "1";
      window.setTimeout(() => {
        delete el.dataset.longPressConsumed;
        clearSelection();
      }, 450);
    }
    clear();
  };

  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: true });
  el.addEventListener("touchend", onEnd, { passive: false });
  el.addEventListener("touchcancel", clear, { passive: true });
  el.addEventListener("selectstart", onSelectStart);
  el.addEventListener("dragstart", onSelectStart);

  return () => {
    clear();
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", clear);
    el.removeEventListener("selectstart", onSelectStart);
    el.removeEventListener("dragstart", onSelectStart);
  };
}

function loadArchivedFolders() {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLDER_ARCHIVE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((entry) => entry && entry.id)
      .map((entry) => ({
        id: String(entry.id),
        name: String(entry.name || "Folder"),
        team_id: entry.team_id ? String(entry.team_id) : null,
        archived_at: String(entry.archived_at || ""),
      }))
      .sort((a, b) => String(b.archived_at || "").localeCompare(String(a.archived_at || "")));
  } catch {
    return [];
  }
}

function saveArchivedFolders(entries) {
  localStorage.setItem(FOLDER_ARCHIVE_KEY, JSON.stringify(entries));
}

function archivedFolderIds() {
  return new Set(loadArchivedFolders().map((entry) => entry.id));
}

function isArchiveSectionCollapsed() {
  try {
    return localStorage.getItem(ARCHIVE_SECTION_COLLAPSE_KEY) !== "0";
  } catch {
    return true;
  }
}

function setArchiveSectionCollapsed(collapsed) {
  try {
    localStorage.setItem(ARCHIVE_SECTION_COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function isCommunityFolder(folder) {
  if (!folder) return false;
  const id = folder.id;
  return (
    folder.public === true
    || id === "__public__"
    || id === "__other_user_renders__"
  );
}

function canArchiveFolder(folder) {
  if (!folder?.id) return false;
  if (folder.virtual || folder.read_only || folder.public) return false;
  const id = folder.id;
  if (id === "__public__" || id === "__other_user_renders__") return false;
  return true;
}

export const PUBLIC_PROJECTS_LABEL = "Public projects";

export function publicExplorerFolderLabel(folder = {}) {
  const id = String(folder?.id || "");
  const name = String(folder?.name || "").trim();
  const isPublic = !!(folder?.public || id === "__public__");
  if (isPublic || (/^unfiled$/i.test(name) && (isPublic || folder?.virtual))) {
    return PUBLIC_PROJECTS_LABEL;
  }
  return name || "Folder";
}

function archiveFolderEntry(folder) {
  if (!canArchiveFolder(folder)) return;
  const now = new Date().toISOString();
  const next = loadArchivedFolders().filter((entry) => entry.id !== folder.id);
  next.unshift({
    id: folder.id,
    name: folder.name || "Folder",
    team_id: folder.team_id || null,
    archived_at: now,
  });
  saveArchivedFolders(next);
  document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
}

function restoreArchivedFolder(folderId) {
  if (!folderId) return;
  const next = loadArchivedFolders().filter((entry) => entry.id !== folderId);
  saveArchivedFolders(next);
  document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
}

function hierarchyItemCount(project) {
  const browser = project.browser || {};
  return (
    (browser.components?.length || 0) +
    (browser.bodies?.length || 0) +
    (browser.drawings?.length || 0) +
    (browser.references?.length || 0) +
    (browser.sketches?.length || 0) +
    (browser.wiring?.length || 0)
  );
}

function formatCostUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function compactTokenCount(value) {
  const total = Number(value) || 0;
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(2)}M tokens`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k tokens`;
  return `${total.toLocaleString()} tokens`;
}

function projectProviderLabel(summary) {
  const provider = (summary?.provider || "").toLowerCase();
  if (provider === "deterministic") return "Deterministic";
  if (provider === "anthropic") return "Claude";
  if (provider === "openai") return "OpenAI";
  if (provider === "kimi" || provider === "moonshot") return "Kimi";
  if (provider === "xai" || provider === "grok") return "Grok";
  if (provider === "gemini" || provider === "google") return "Gemini";
  if (provider === "qwen" || provider === "dashscope" || provider === "alibaba") return "Qwen";
  // Infer from model name if provider field missing
  const model = (summary?.model || "").toLowerCase();
  if (model.includes("claude") || model.includes("anthropic")) return "Claude";
  if (model.includes("kimi")) return "Kimi";
  if (model.includes("grok")) return "Grok";
  if (model.includes("qwen")) return "Qwen";
  if (model.includes("gemini") || model.includes("flash")) return "Gemini";
  if (model.includes("gpt") || model.includes("o1") || model.includes("o3")) return "OpenAI";
  return "AI";
}

function projectCostAnalyticsHtml(p) {
  const esc = (s) => String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const summary = p?.usage_summary;
  const name = esc(p?.name || p?.id || "Project");
  if (!summary || !(summary.tracked_count > 0 || summary.cost_usd > 0)) {
    return `
      <div class="proj-cost-pop-title">${name}</div>
      <div class="proj-cost-pop-empty">No tracked AI usage yet</div>
    `;
  }
  const total = formatCostUsd(summary.cost_usd ?? 0) || "$0.00";
  const provider = esc(projectProviderLabel(summary));
  const prompts = summary.tracked_count ?? summary.prompt_count ?? 0;
  const tokens = summary.usage?.total_tokens ?? 0;
  const inTok = summary.usage?.input_tokens ?? 0;
  const outTok = summary.usage?.output_tokens ?? 0;
  const openai = summary.openai_cost_usd;
  const anthropic = summary.anthropic_cost_usd;
  const breakdown = Array.isArray(summary.model_breakdown) ? summary.model_breakdown.slice(0, 4) : [];
  const rows = breakdown.map((row) => {
    const label = esc(row?.model || row?.provider || "model");
    const cost = formatCostUsd(row?.cost_usd ?? 0) || "$0.00";
    const n = row?.count ?? row?.prompt_count ?? 0;
    return `<div class="proj-cost-pop-row"><span>${label}</span><strong>${cost}${n ? ` · ${n}` : ""}</strong></div>`;
  }).join("");
  const providerBits = [
    openai != null && openai > 0 ? `OpenAI ${formatCostUsd(openai)}` : null,
    anthropic != null && anthropic > 0 ? `Claude ${formatCostUsd(anthropic)}` : null,
  ].filter(Boolean).join(" · ");
  const comps = (p?.browser?.components || []).slice(0, 5)
    .map((c) => esc(hierarchyDisplayName(c) || c.stem || c.name || ""))
    .filter(Boolean);
  return `
    <div class="proj-cost-pop-title">${name}</div>
    <div class="proj-cost-pop-total">${total}</div>
    <div class="proj-cost-pop-sub">${provider} · ${prompts} prompt${prompts !== 1 ? "s" : ""}${tokens ? ` · ${compactTokenCount(tokens)} tokens` : ""}</div>
    ${providerBits ? `<div class="proj-cost-pop-sub">${esc(providerBits)}</div>` : ""}
    ${inTok || outTok ? `<div class="proj-cost-pop-sub">In ${compactTokenCount(inTok)} · Out ${compactTokenCount(outTok)}</div>` : ""}
    ${rows ? `<div class="proj-cost-pop-models">${rows}</div>` : ""}
    ${comps.length ? `<div class="proj-cost-pop-comps"><span>Models</span>${comps.map((c) => `<em>${c}</em>`).join("")}</div>` : ""}
  `;
}

function friendlyHierarchyReferenceLabel(entry) {
  const captureName = friendlyCaptureDisplayName(entry);
  if (captureName) return captureName;
  const raw = String(entry?.label || entry?.stem || entry?.name || "").trim();
  const stem = raw.replace(/\.[^.]+$/, "");
  if (!stem) return "Untitled";

  const folder = String(entry?.folder || entry?.parent_folder || "").toLowerCase();
  const isMcMaster = folder === "mcmaster" || /^mcmaster[_-\s]/i.test(stem) || stem === "parts_list";
  if (isMcMaster) {
    if (stem === "parts_list") return "Parts list";
    const part = stem.replace(/^mcmaster[_\s-]*/i, "");
    const cat = part.match(/([0-9]{4,}[A-Za-z]?[0-9A-Za-z.-]*)/);
    return cat ? cat[1] : part || stem;
  }

  return stem;
}

function hierarchyDisplayName(entry) {
  if (entry?.format === "body" || entry?.virtual_body) {
    const label = String(entry.label || entry.body_name || "").trim();
    if (label) {
      const short = label.includes("|") ? label.split("|", 1)[0].trim() : label;
      return short || label;
    }
  }
  if (entry.format === "program") {
    return entry.stem || entry.name.replace(/\.program\.json$/i, "");
  }
  if (entry.format === "wiring") return entry.name;
  if (
    entry?.parent_folder
    || /^(mcmaster|recordings|screen recordings|screenshots|ar)$/i.test(String(entry?.folder || ""))
    || /\.(webm|mp4|mov|m4v|png|jpe?g|webp)$/i.test(String(entry?.name || ""))
  ) {
    return friendlyHierarchyReferenceLabel(entry);
  }
  if (entry.label) return entry.label;
  return entry.stem || entry.name.replace(/\.[^.]+$/, "");
}

function normalizeProjectSearch(query) {
  return String(query || "").trim().toLowerCase();
}

function projectSearchHaystack(project, folderName = "") {
  const parts = [
    project?.name,
    project?.id,
    folderName,
    project?.usage_summary?.provider,
    project?.usage_summary?.model,
  ];
  const browser = project?.browser || {};
  const walk = (list) => {
    for (const entry of list || []) {
      if (!entry) continue;
      parts.push(entry?.name, entry?.stem, hierarchyDisplayName(entry));
      walk(entry.children);
      walk(entry.hardware);
    }
  };
  walk(browser.components);
  walk(browser.bodies);
  walk(browser.drawings);
  walk(browser.references);
  walk(browser.sketches);
  walk(browser.wiring);
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function matchesProjectSearch(project, query, folderName = "") {
  const q = normalizeProjectSearch(query);
  if (!q) return true;
  return projectSearchHaystack(project, folderName).includes(q);
}

function vrHeadsetMini() {
  return `<svg class="browser-vr-glyph" viewBox="0 0 16 16" width="12" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.25" d="M2.2 6.2h11.6v5.2c0 .7-.6 1.3-1.3 1.3H10L8.8 11.2H7.2L6 12.7H3.5c-.7 0-1.3-.6-1.3-1.3V6.2Z"/><path fill="none" stroke="currentColor" stroke-width="1.2" d="M4.3 8.2h2.6v2.1H4.3zm4.8 0h2.6v2.1H9.1z"/></svg>`;
}

const EYE_ON_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M1.2 8s2.4-4.5 6.8-4.5S14.8 8 14.8 8s-2.4 4.5-6.8 4.5S1.2 8 1.2 8z"/><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.35"/></svg>`;
const EYE_OFF_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M2 2l12 12M6.3 6.3A2.7 2.7 0 0 0 8 10.7c.7 0 1.3-.2 1.8-.7M4.8 4.1C2.9 4.9 1.3 6.4.3 8c1.7 2.6 4.5 5 7.7 5 1.2 0 2.3-.3 3.3-.8M7.4 3.1 8 3c3.5 0 6.3 2.4 8 5-.4.7-.9 1.3-1.5 1.9"/></svg>`;
const GEAR_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M6.5 1.8h3l.6 1.5 1.6.6 1.4-1 1.6 1.6-1 1.4.6 1.6 1.5.6v3l-1.5.6-.6 1.6 1 1.4-1.6 1.6-1.4-1-1.6.6-.6 1.5h-3l-.6-1.5-1.6-.6-1.4 1L1.8 12l1-1.4-.6-1.6L.8 8.4v-3l1.5-.6.6-1.6-1-1.4L3.5 1.8l1.4 1 .6-.6.6-1.4z"/><circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
const PIN_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M6.2 2.4h3.6l.8 3.2 1.8.8-2.2 2.2.6 4.2L8 11.2 5.2 12.8l.6-4.2-2.2-2.2 1.8-.8z"/></svg>`;

function hierarchyEyeSvg(hidden) {
  return hidden
    ? `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M2 2l12 12M6.3 6.3A2.7 2.7 0 0 0 8 10.7c.7 0 1.3-.2 1.8-.7M4.8 4.1C2.9 4.9 1.3 6.4.3 8c1.7 2.6 4.5 5 7.7 5 1.2 0 2.3-.3 3.3-.8M7.4 3.1 8 3c3.5 0 6.3 2.4 8 5-.4.7-.9 1.3-1.5 1.9"/>
  </svg>`
    : `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M1.2 8s2.4-4.5 6.8-4.5S14.8 8 14.8 8s-2.4 4.5-6.8 4.5S1.2 8 1.2 8z"/>
    <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.35"/>
  </svg>`;
}

export function createWorkspaceBrowser({
  container,
  api,
  getWorkspaceId,
  getFolderTeamId = getWorkspaceId,
  getWorkspaceMeta = () => ({}),
  getProjects,
  getProjectsLoading = () => false,
  getActiveProjectId,
  getLastOpenedProjectId = () => null,
  getCurrentUserId = () => null,
  getTeams = () => [],
  getHiddenWorkspaceIds = () => new Set(),
  getPersonalWorkspaceId = () => null,
  getPersonalWorkspaceLabel = () => "Projects",
  onOpenWorkspace = null,
  onToggleWorkspaceVisible = null,
  onManageWorkspaces = null,
  onManageSharedProjects = null,
  getRecentWorkspaceIds = () => [],
  onTouchWorkspace = null,
  getExplorerPrefs = () => ({}),
  onExplorerPrefs = null,
  isProjectLoading,
  isProjectGenerating,
  isProjectNew,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onExportProject,
  onMakePublicProject,
  onPinPublicProject = null,
  canPinToPublic = null,
  onToggleIncognitoProject = null,
  onCreateProjectInFolder,
  onOpenHierarchyItem,
  onFrameHierarchyItem,
  onOpenCanvasBoard,
  onOpenCodeFolder = null,
  onSendReferenceToPrompt,
  canDeleteProject,
  onEditHierarchyItem,
  onOpenProfile,
  onRenameHierarchyItem,
  onDeleteHierarchyItem,
  onDeleteHierarchyItems,
  onExportHierarchyItem,
  onReferenceShareAction = null,
  onStoreListing = null,
  onAddToScene = null,
  onOpenVideoEditor = null,
  getVideoEditReady = () => null,
  onAddToVideoEditor = null,
  onAttachWiringComponent,
  onToggleHierarchyVisibility,
  isHierarchyItemHidden,
  onDragComponent,
  getPartProfile,
  onInviteWorkspace = null,
  onLeaveWorkspace = null,
  onManageWorkspacePermissions = null,
  onXrCreationsSort = null,
  onOpenOnlineModels = null,
  onPublicModelAction = null,
  onLoginForPublicAction = null,
  getPersonalPinIds = () => [],
  onTogglePersonalPin = null,
}) {
  ensureGenerationElapsedClock();
  try {
    const prefView = getExplorerPrefs?.()?.view;
    if (prefView === "grid" || prefView === "list") projectViewMode = prefView;
  } catch (_) {}

  function closeHierarchyKebabs() {
    closeActionStrip();
  }

  function attachHierarchyKebab(item, buttons) {
    const list = (buttons || []).filter(Boolean);
    if (!list.length) return;
    const more = document.createElement("div");
    more.className = "browser-item-more proj-hierarchy-more";
    const kebab = document.createElement("button");
    kebab.type = "button";
    kebab.className = "browser-item-kebab";
    kebab.title = "More actions";
    kebab.setAttribute("aria-label", "More actions");
    kebab.setAttribute("aria-haspopup", "menu");
    kebab.setAttribute("aria-expanded", "false");
    kebab.innerHTML = ICON_HIERARCHY_KEBAB;
    kebab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openActionStrip(kebab, list.map((btn) => btn.cloneNode(true)).map((clone, i) => {
        const src = list[i];
        clone.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          closeActionStrip();
          src.click();
        });
        return clone;
      }));
    });
    more.append(kebab);
    item.appendChild(more);
  }

  if (container && !container.dataset.hierarchyKebabBound) {
    container.dataset.hierarchyKebabBound = "1";
    container.addEventListener("scroll", () => closeActionStrip(), true);
  }

  function isCommunityFolder(folder) {
    if (!folder) return false;
    const id = folder.id;
    return (
      folder.public === true
      || id === "__public__"
      || id === "__other_user_renders__"
    );
  }

  let folders = [];
  let explorerOpenedWorkspaceId = "";
  let lastSyncedProjectId = "";
  let recentsAtBoot = null;
  let dragProjectId = null;
  let dropBeforeProjectId = null;
  let dropAtEnd = false;
  let contextMenu = null;
  let actionStripEl = null;
  let actionStripAnchor = null;
  let shareModalEl = null;
  let renameModalEl = null;
  let createFolderModalEl = null;
  let shareModalFolder = null;
  let sharedStripReorder = false;
  let sharedDragId = null;
  const projectShareDialog = createProjectShareDialog({
    api,
    getWorkspaceId,
    onChanged: () => {
      document.dispatchEvent(new CustomEvent("workspace-projects-changed"));
      void refreshFolders();
      render();
    },
  });
  let collapsedFolders = loadIdSet(FOLDER_COLLAPSE_KEY);
  let expandedWorkspaces = loadIdSet(EXPANDED_WS_KEY);
  let showAllFolders = loadIdSet(FOLDER_SHOW_ALL_KEY);
  let showAllHierarchySections = loadIdSet(HIERARCHY_SHOW_ALL_KEY);
  let expandedProjects = loadIdSet(PROJECT_EXPAND_KEY);
  const forceCollapsedProjects = new Set();
  const expandedSections = new Map();
  const expandedHierarchyBodies = loadIdSet(HIERARCHY_BODIES_EXPAND_KEY);
  const selectedHierarchyKeys = new Set();
  let hierarchySelectionAnchor = null;
  const visibleHierarchyOrder = [];
  /** @type {Map<string, { project: object, sectionId: string, entry: object }>} */
  const hierarchyEntryCache = new Map();
  let suppressHierarchyClick = false;

  function resolveTeamId() {
    const folderTeamId = getFolderTeamId?.();
    if (folderTeamId) return folderTeamId;
    return getWorkspaceId?.() || null;
  }

  function personalPinIds() {
    return normalizePersonalPinIds(getPersonalPinIds?.() || getExplorerPrefs?.()?.pinnedIds || []);
  }

  function isUserPinnedProject(project) {
    return personalProjectPinAction(project, { pinnedIds: personalPinIds() }).pinned;
  }

  function canShowPersonalPin(project) {
    return personalProjectPinAction(project, {
      signedIn: !!getCurrentUserId?.(),
      canToggle: typeof onTogglePersonalPin === "function",
      pinnedIds: personalPinIds(),
    }).visible;
  }

  function toggleHierarchyBodies(key) {
    if (!key) return;
    if (expandedHierarchyBodies.has(key)) expandedHierarchyBodies.delete(key);
    else expandedHierarchyBodies.add(key);
    try {
      saveIdSet(HIERARCHY_BODIES_EXPAND_KEY, expandedHierarchyBodies);
    } catch {
      /* private mode / quota */
    }
  }

  function clearHierarchyClickSuppress() {
    window.setTimeout(() => {
      suppressHierarchyClick = false;
    }, 0);
  }

  function persistExplorerPane() {
    try { localStorage.setItem(EXPLORER_PANE_KEY, explorerPane); } catch (_) {}
  }

  function setExplorerPane(pane) {
    explorerPane = pane === "references" ? "references" : "projects";
    persistExplorerPane();
    syncExplorerPaneTabs();
    render();
  }

  function syncExplorerPaneTabs() {
    const hint = document.querySelector(".workspace-browser-hint");
    if (hint) {
      hint.textContent = explorerPane === "references"
        ? "Search, sort, and open files"
        : "Your projects and models";
    }
    document.querySelectorAll("[data-explorer-pane]").forEach((btn) => {
      const on = btn.dataset.explorerPane === explorerPane;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelector(".workspace-browser-section")?.classList.toggle(
      "workspace-browser-section--refs",
      explorerPane === "references",
    );
    document.querySelector(".sidebar.left")?.classList.toggle("explorer-pane-refs", explorerPane === "references");
    const refsPane = document.getElementById("reference-files-pane");
    if (container) {
      container.hidden = explorerPane === "references";
      container.classList.toggle("is-hidden", explorerPane === "references");
    }
    if (refsPane && refsPane.dataset.userHidden !== "1") {
      refsPane.hidden = explorerPane !== "references";
      refsPane.classList.toggle("is-hidden", explorerPane !== "references");
    }
  }

  function bindExplorerPaneTabs() {
    document.querySelectorAll("[data-explorer-pane]").forEach((btn) => {
      if (btn.dataset.explorerPaneBound === "1") return;
      btn.dataset.explorerPaneBound = "1";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setExplorerPane(btn.dataset.explorerPane);
      });
    });
    syncExplorerPaneTabs();
  }

  function activeExplorerProject() {
    const id = String(getActiveProjectId?.() || getLastOpenedProjectId?.() || "");
    const projects = Array.isArray(getProjects?.()) ? getProjects() : [];
    return (id && projects.find((p) => String(p.id) === id)) || null;
  }

  function showReferenceFilesPane(opts = {}) {
    explorerPane = "references";
    persistExplorerPane();
    const folder = String(opts.folder || "").split("/")[0].trim();
    const project = activeExplorerProject();
    if (folder && project?.id) {
      expandedHierarchyBodies.add(referenceFolderKey(project.id, { folder }));
      try { saveIdSet(HIERARCHY_BODIES_EXPAND_KEY, expandedHierarchyBodies); } catch (_) {}
    }
    try {
      document.dispatchEvent(new CustomEvent("render3d:reveal-reference-folder", { detail: { folder, projectId: project?.id || "" } }));
    } catch (_) {}
    syncExplorerPaneTabs();
    render();
  }

  function referenceRowTimestamp(entry) {
    return formatReferenceTimestamp(entry) || formatEntryCapturedAt(entry) || "";
  }

  function canvasBoardForEntry(entry) {
    return editableCanvasBoard(entry) || null;
  }

  function attachOpenCanvasAffordance(item, project, entry) {
    const board = canvasBoardForEntry(entry);
    if (!board || typeof onOpenCanvasBoard !== "function") return;
    item.classList.add("proj-hierarchy-item--canvas-board");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "proj-hierarchy-open-canvas";
    btn.title = `Open ${board.name} in canvas viewport`;
    btn.setAttribute("aria-label", `Open ${board.name} in canvas viewport`);
    btn.innerHTML = `<span aria-hidden="true">↗</span>`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onOpenCanvasBoard(project, entry, board);
    });
    item.appendChild(btn);
  }

  function appendReferenceFileRow(listEl, project, entry, sectionId, { depth = 0, child = false } = {}) {
    const item = document.createElement("li");
    item.className = sectionId === "bodies"
      ? "proj-hierarchy-item proj-hierarchy-item--child"
      : `proj-hierarchy-item${child ? " proj-hierarchy-item--child" : ""} proj-hierarchy-item--reference`;
    item.style.setProperty("--refs-depth", String(depth));
    const childKey = hierarchySelectionKey(project, sectionId, entry);
    hierarchyEntryCache.set(childKey, { project, sectionId, entry });
    if (selectedHierarchyKeys.has(childKey)) {
      item.classList.add("proj-hierarchy-item--selected");
    }
    const childBtn = document.createElement("button");
    childBtn.type = "button";
    childBtn.className = "proj-hierarchy-item-btn";
    const childName = hierarchyDisplayName(entry);
    const when = referenceRowTimestamp(entry);
    childBtn.innerHTML = `
      <span class="proj-hierarchy-item-copy">
        <span class="proj-hierarchy-item-name">${escapeHtml(childName)}</span>
        ${when ? `<span class="proj-hierarchy-item-time">${escapeHtml(when)}</span>` : ""}
      </span>
    `;
    childBtn.title = isCaptureBrowserEntry(entry)
      ? captureHoverTitle(entry, childName)
      : `${childName} — click to open`;
    childBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedHierarchyKeys.clear();
      selectedHierarchyKeys.add(childKey);
      onOpenHierarchyItem?.(project, entry, sectionId === "bodies" ? "components" : sectionId);
      render();
    });
    if (sectionId === "sketches") {
      childBtn.title = `${childName} — double-click to open in feature editor`;
      childBtn.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onEditHierarchyItem?.(project, entry, sectionId);
      });
    } else if ((sectionId === "components" || sectionId === "bodies" || sectionId === "vr_creations") && typeof onFrameHierarchyItem === "function") {
      childBtn.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectedHierarchyKeys.clear();
        selectedHierarchyKeys.add(childKey);
        onFrameHierarchyItem(project, entry, sectionId === "bodies" ? "components" : sectionId);
      });
    }
    item.appendChild(childBtn);
    attachOpenCanvasAffordance(item, project, entry);
    const childPayload = hierarchyPayload(project, sectionId, entry);
    attachHierarchyKebab(item, hierarchyStripButtons(project, entry, sectionId));
    const openChildMenu = (ev) => showHierarchyItemContextMenu(ev, project, entry, sectionId, childPayload);
    item.addEventListener("contextmenu", openChildMenu);
    bindLongPress(item, openChildMenu);
    listEl.appendChild(item);
  }

  function appendReferenceFolderRow(listEl, project, entry, sectionId, { depth = 0, viewMode = "list" } = {}) {
    const folderKey = referenceFolderKey(project.id, entry);
    const folderOpen = isReferenceFolderOpen(expandedHierarchyBodies, folderKey);
    const folderLi = document.createElement("li");
    folderLi.className = "proj-hierarchy-item proj-hierarchy-item--virtual-folder refs-folder-block";
    folderLi.dataset.folderKey = folderKey;
    folderLi.style.setProperty("--refs-depth", String(depth));
    const folderBtn = document.createElement("button");
    folderBtn.type = "button";
    folderBtn.className = "proj-hierarchy-item-btn proj-hierarchy-folder-toggle";
    folderBtn.setAttribute("aria-expanded", folderOpen ? "true" : "false");
    const childCount = (entry.children || []).length;
    folderBtn.innerHTML = `
      <span class="browser-chevron">${folderOpen ? "▾" : "▸"}</span>
      <span class="proj-hierarchy-item-copy">
        <span class="proj-hierarchy-item-name">${escapeHtml(entry.label || entry.children_label || entry.name || "Folder")}</span>
        ${referenceRowTimestamp(entry) ? `<span class="proj-hierarchy-item-time">${escapeHtml(referenceRowTimestamp(entry))}</span>` : ""}
      </span>
      <span class="proj-hierarchy-section-count" title="${treeCountValue(childCount)}">${formatTreeCount(childCount)}</span>
    `;
    folderBtn.title = folderOpen ? "Collapse folder" : "Expand folder";
    folderBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleHierarchyBodies(folderKey);
      render();
    });
    folderLi.appendChild(folderBtn);
    attachOpenCanvasAffordance(folderLi, project, entry);
    attachHierarchyKebab(folderLi, hierarchyStripButtons(project, entry, sectionId));
    const openFolderMenu = (ev) => showHierarchyItemContextMenu(ev, project, entry, sectionId);
    folderLi.addEventListener("contextmenu", openFolderMenu);
    bindLongPress(folderLi, openFolderMenu);
    listEl.appendChild(folderLi);
    if (!folderOpen) return;
    const nested = document.createElement("ul");
    nested.className = `proj-hierarchy-list proj-hierarchy-list--nested${viewMode === "grid" ? ` ${REFERENCE_FILES_GRID_CLASS}` : ""}`;
    if (viewMode === "grid") nested.classList.add("refs-files-grid");
    appendReferenceTree(nested, entry.children || [], project, entry.browser_section || sectionId, { depth: depth + 1, viewMode });
    folderLi.appendChild(nested);
  }

  function appendReferenceTree(listEl, items, project, sectionId, { depth = 0, viewMode = "list" } = {}) {
    for (const entry of items || []) {
      if (isReferenceVirtualFolder(entry)) {
        appendReferenceFolderRow(listEl, project, entry, sectionId, { depth, viewMode });
      } else {
        appendReferenceFileRow(listEl, project, entry, sectionId, { depth, child: depth > 0 });
      }
    }
  }

  function renderReferenceFilesPane() {
    const project = activeExplorerProject();
    container.innerHTML = "";
    container.classList.toggle("project-browser--grid", refsViewMode === "grid");
    container.classList.toggle("project-browser--list", refsViewMode !== "grid");
    container.classList.add("project-browser--refs");

    const pane = document.createElement("section");
    pane.className = "refs-files-pane";
    pane.setAttribute("aria-label", "Reference Files");

    const toolbar = document.createElement("div");
    toolbar.className = "refs-files-toolbar project-browser-toolbar";

    const searchBar = document.createElement("label");
    searchBar.className = "project-search-bar refs-files-search";
    searchBar.innerHTML = `
      <span class="project-search-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="6.5" cy="6.5" r="4.25"></circle>
          <path d="M10 10l3.5 3.5" stroke-linecap="round"></path>
        </svg>
      </span>
      <input type="search" class="project-search-input refs-files-search-input" placeholder="Search reference files…" maxlength="120" autocomplete="off" spellcheck="false" />
      <button type="button" class="project-search-clear${refsSearchQuery.trim() ? "" : " hidden"}" title="Clear search" aria-label="Clear search">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"></path>
        </svg>
      </button>
    `;
    toolbar.appendChild(searchBar);

    const sortBtn = document.createElement("button");
    sortBtn.type = "button";
    sortBtn.className = "refs-files-sort";
    sortBtn.setAttribute("aria-pressed", refsSortDirection === "oldest" ? "true" : "false");
    sortBtn.title = refsSortDirection === "oldest" ? "Showing oldest first — click for newest" : "Showing newest first — click for oldest";
    sortBtn.textContent = refsSortDirection === "oldest" ? "Oldest" : "Newest";
    sortBtn.addEventListener("click", () => {
      refsSortDirection = refsSortDirection === "newest" ? "oldest" : "newest";
      try { localStorage.setItem(REFS_SORT_KEY, refsSortDirection); } catch (_) {}
      render();
    });
    toolbar.appendChild(sortBtn);

    const viewToggle = document.createElement("div");
    viewToggle.className = "project-view-toggle refs-files-view";
    viewToggle.setAttribute("role", "group");
    viewToggle.setAttribute("aria-label", "Reference file layout");
    viewToggle.innerHTML = `
      <button type="button" class="project-view-btn${refsViewMode === "list" ? " active" : ""}" data-view="list" title="List view" aria-pressed="${refsViewMode === "list"}">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <path d="M3 4h10M3 8h10M3 12h10" stroke-linecap="round"/>
        </svg>
      </button>
      <button type="button" class="project-view-btn${refsViewMode === "grid" ? " active" : ""}" data-view="grid" title="Grid view" aria-pressed="${refsViewMode === "grid"}">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/>
          <rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/>
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/>
          <rect x="9" y="9" width="4.5" height="4.5" rx="1"/>
        </svg>
      </button>
    `;
    viewToggle.querySelectorAll(".project-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.view === "grid" ? "grid" : "list";
        if (next === refsViewMode) return;
        refsViewMode = next;
        try { localStorage.setItem(REFS_VIEW_KEY, refsViewMode); } catch (_) {}
        render();
      });
    });
    toolbar.appendChild(viewToggle);
    pane.appendChild(toolbar);

    const searchInput = searchBar.querySelector(".refs-files-search-input");
    const clearBtn = searchBar.querySelector(".project-search-clear");
    searchInput.value = refsSearchQuery;
    searchInput.addEventListener("input", () => {
      refsSearchQuery = searchInput.value;
      try {
        if (refsSearchQuery.trim()) sessionStorage.setItem(REFS_SEARCH_KEY, refsSearchQuery);
        else sessionStorage.removeItem(REFS_SEARCH_KEY);
      } catch (_) {}
      render();
      const next = container.querySelector(".refs-files-search-input");
      if (next) {
        next.focus();
        const len = next.value.length;
        next.setSelectionRange(len, len);
      }
    });
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      refsSearchQuery = "";
      try { sessionStorage.removeItem(REFS_SEARCH_KEY); } catch (_) {}
      render();
      container.querySelector(".refs-files-search-input")?.focus();
    });

    if (!project) {
      const empty = document.createElement("p");
      empty.className = "muted small browser-empty refs-files-empty";
      empty.textContent = "Open a project from the Projects tab to see its reference files.";
      pane.appendChild(empty);
      container.appendChild(pane);
      return;
    }

    const label = document.createElement("p");
    label.className = "refs-files-project muted small";
    label.textContent = project.name || "Project";
    pane.appendChild(label);

    const rawItems = collectProjectReferenceItems(project.browser || {});
    const filtered = refsSearchQuery.trim()
      ? filterBrowserEntriesByName(rawItems, refsSearchQuery)
      : rawItems;
    const items = sortReferenceEntries(filtered, refsSortDirection);

    const list = document.createElement("ul");
    list.className = `proj-hierarchy-list refs-files-tree${refsViewMode === "grid" ? ` ${REFERENCE_FILES_GRID_CLASS}` : ""}`;
    if (refsViewMode === "grid") list.classList.add("refs-files-grid");
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "proj-hierarchy-empty muted small";
      empty.textContent = refsSearchQuery.trim()
        ? `No reference files match “${refsSearchQuery.trim()}”`
        : "No reference files";
      list.appendChild(empty);
    } else {
      if (refsSearchQuery.trim()) {
        for (const entry of items) {
          if (isReferenceVirtualFolder(entry)) {
            expandedHierarchyBodies.add(referenceFolderKey(project.id, entry));
          }
        }
      }
      appendReferenceTree(list, items, project, "references", { depth: 0, viewMode: refsViewMode });
    }
    pane.appendChild(list);
    container.appendChild(pane);
  }

  const ICON_SHARE = `<svg class="icon-share" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11 9.5a2.5 2.5 0 1 0-.9-1.9L8.5 5.6V5a2.5 2.5 0 1 0-1 0v.6L5.9 7.6a2.5 2.5 0 1 0 .9 1.9l2.6-1.6V11a2.5 2.5 0 1 0 1 0V7.9l2.6 1.6zM5 4.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm6 7a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zM3 11a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"/></svg>`;
  const ICON_PENCIL = `<svg class="icon-pencil" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11.5 2.5a1.5 1.5 0 0 1 2.12 2.12L5.62 12.62 2 13.5l.88-3.62L11.5 2.5z"/></svg>`;
  const ICON_PLUS = `<svg class="icon-plus" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7.25 2.75a.75.75 0 0 1 1.5 0V7.25h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5V2.75z"/></svg>`;
  const ICON_EDIT_FOLDER = `<svg class="icon-edit-folder" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 3.75A1.75 1.75 0 0 1 3.75 2h3.1L8.2 3.5h4.05A1.75 1.75 0 0 1 14 5.25v6A1.75 1.75 0 0 1 12.25 13h-8.5A1.75 1.75 0 0 1 2 11.25v-7.5zm8.22 2.03a.75.75 0 0 0-1.06 1.06l.72.72-1.9 1.9-.22.9.9-.22 1.9-1.9.72.72a.75.75 0 1 0 1.06-1.06l-.72-.72.72-.72z"/></svg>`;
  let editFolderModalEl = null;

  function hideProjectHovers() {
    document.querySelectorAll(".proj-public-hover, .proj-cost-pop").forEach((el) => {
      el.hidden = true;
    });
  }

  function setProjectContextMenuOpen(open) {
    document.body.classList.toggle("proj-context-menu-open", !!open);
    if (open) hideProjectHovers();
  }

  function closeContextMenu() {
    setProjectContextMenuOpen(false);
    contextMenu?.remove();
    contextMenu = null;
    moveSubmenuEl?.remove();
    moveSubmenuEl = null;
  }

  function closeActionStrip() {
    actionStripEl?.remove();
    actionStripEl = null;
    actionStripAnchor = null;
    container?.querySelectorAll(".browser-item-more.is-open, .folder-header-actions.is-open, .proj-row-actions.is-open").forEach((el) => {
      el.classList.remove("is-open");
      el.querySelector(".browser-item-kebab, .btn-folder-menu, .proj-item-kebab")?.setAttribute("aria-expanded", "false");
    });
  }

  function layoutActionStrip(panel, anchor) {
    if (!panel || !anchor) return;
    const r = anchor.getBoundingClientRect();
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

  function makeStripBtn(label, { title = "", action = "", danger = false, onClick } = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `explorer-action-strip-btn${danger ? " is-danger" : ""}`;
    btn.textContent = label;
    btn.title = title || label;
    if (action) btn.dataset.action = action;
    btn.setAttribute("role", "menuitem");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeActionStrip();
      onClick?.(e);
    });
    return btn;
  }

  function openActionStrip(anchor, buttons) {
    const list = (buttons || []).filter(Boolean);
    if (!anchor || !list.length) return;
    if (actionStripAnchor === anchor && actionStripEl) {
      closeActionStrip();
      return;
    }
    closeActionStrip();
    closeContextMenu();
    const panel = document.createElement("div");
    panel.className = "explorer-action-strip";
    panel.setAttribute("role", "menu");
    for (const btn of list) panel.appendChild(btn);
    const closeBtn = makeStripBtn("×", {
      title: "Close",
      action: "close",
      onClick: () => {},
    });
    closeBtn.classList.add("explorer-action-strip-close");
    closeBtn.setAttribute("aria-label", "Close");
    panel.appendChild(closeBtn);
    document.body.appendChild(panel);
    actionStripEl = panel;
    actionStripAnchor = anchor;
    const wrap = anchor.closest?.(".browser-item-more, .folder-header-actions, .proj-row-actions");
    wrap?.classList.add("is-open");
    anchor.setAttribute?.("aria-expanded", "true");
    layoutActionStrip(panel, anchor);
  }

  function folderStripButtons(folder) {
    const caps = folderMenuCapabilities(folder);
    const buttons = [];
    if (!folder || caps.canManage) {
      buttons.push(makeStripBtn("New", {
        title: folder?.id ? `New project in ${folder.name}` : "New project",
        action: "new-project",
        onClick: () => void createProjectInFolder(folder),
      }));
    }
    if (caps.canInviteShared) {
      buttons.push(makeStripBtn("Invite", {
        action: "invite-workspace",
        onClick: () => void onInviteWorkspace?.(caps.sharedTeamId, caps.sharedTeam),
      }));
    }
    if (caps.canManage && folder) {
      buttons.push(makeStripBtn("Share", {
        action: "share",
        onClick: () => openShareDialog(folder),
      }));
      buttons.push(makeStripBtn("Settings", {
        title: "Edit folder",
        action: "edit",
        onClick: () => openEditFolderDialog(folder),
      }));
      buttons.push(makeStripBtn("Rename", {
        action: "rename",
        onClick: () => openRenameDialog(folder),
      }));
    }
    if (caps.canManageSharedPerms) {
      buttons.push(makeStripBtn("Members", {
        action: "manage-workspace-perms",
        onClick: () => void onManageWorkspacePermissions?.(caps.sharedTeamId, caps.sharedTeam),
      }));
    }
    if (caps.canLeaveShare && folder) {
      buttons.push(makeStripBtn("Leave", {
        action: "leave-folder",
        onClick: async () => {
          const userId = caps.myId;
          const teamId = caps.folderTeamId;
          if (!folder?.id || !userId || !teamId) return;
          if (!window.confirm(`Leave folder “${folder.name}”? It will disappear from your explorer.`)) return;
          try {
            await api(`/api/teams/${encodeURIComponent(teamId)}/folders/${folder.id}/shares/${encodeURIComponent(userId)}`, {
              method: "DELETE",
            });
            await refreshFolders();
            render();
            document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
          } catch (err) {
            alert(err.message || "Could not leave folder");
          }
        },
      }));
    } else if (caps.showLeaveWorkspace) {
      const leaveId = caps.isSharedTarget ? caps.sharedTeamId : caps.folderTeamId;
      const leaveTeam = caps.isSharedTarget ? caps.sharedTeam : caps.folderTeam;
      buttons.push(makeStripBtn("Leave", {
        action: "leave-workspace",
        onClick: () => void onLeaveWorkspace?.(leaveId, leaveTeam),
      }));
    }
    if (folder && canArchiveFolder(folder)) {
      buttons.push(makeStripBtn("Archive", {
        action: "archive",
        onClick: () => {
          archiveFolderEntry(folder);
          render();
        },
      }));
    }
    if (caps.canManage && folder) {
      buttons.push(makeStripBtn("Delete", {
        action: "delete",
        danger: true,
        onClick: async () => {
          if (!window.confirm(`Delete folder "${folder.name}"? Projects inside will move to ${rootFolderLabel()}.`)) return;
          const teamId = caps.folderTeamId || getWorkspaceId();
          try {
            await api(`/api/teams/${encodeURIComponent(teamId)}/folders/${folder.id}`, { method: "DELETE" });
            restoreArchivedFolder(folder.id);
            await refreshFolders();
            render();
            document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
          } catch (err) {
            alert(err.message || "Could not delete folder");
          }
        },
      }));
    }
    return buttons;
  }

  function projectStripButtons(project) {
    const publicRow = isPublicSidebarProject(project);
    const readOnly = !!project?.read_only_project;
    const canDelete = !readOnly || !!canDeleteProject?.(project);
    const sharedWithMe = !!project?.shared_with_me;
    const me = getCurrentUserId?.();
    const canShare =
      !readOnly
      && !project?.public
      && !sharedWithMe
      && (!!me && (project?.owner_user_id === me || project?.created_by === me));
    const buttons = [];
    if (!publicRow && typeof onAddToScene === "function") {
      buttons.push(makeStripBtn("Scene", { title: "Add project model to scene", action: "add-scene", onClick: () => onAddToScene(project, null, "project") }));
    }
    if (publicRow) {
      buttons.push(makeStripBtn("Remix", {
        action: "remix",
        onClick: () => runPublicModelAction("remix", project),
      }));
      buttons.push(makeStripBtn("Share", {
        action: "share-public",
        onClick: () => runPublicModelAction("share", project),
      }));
      if (typeof onPinPublicProject === "function" && (typeof canPinToPublic === "function" ? canPinToPublic(project) : true)) {
        buttons.push(makeStripBtn(project?.public_pinned ? "Unpin" : "Public", {
          title: project?.public_pinned ? "Unpin from public" : "Pin to public",
          action: "pin-public",
          onClick: () => onPinPublicProject?.(project),
        }));
      }
      return buttons;
    }
    if (canShowPersonalPin(project)) {
      buttons.push(makeStripBtn(isUserPinnedProject(project) ? "Unpin" : "Pin", {
        title: isUserPinnedProject(project) ? "Unpin from projects" : "Pin to projects",
        action: "pin-personal",
        onClick: () => onTogglePersonalPin?.(project),
      }));
    }
    if (canShare && !project?.incognito) {
      buttons.push(makeStripBtn("Share", {
        action: "share",
        onClick: () => void projectShareDialog.open(project),
      }));
    }
    if (typeof onPinPublicProject === "function"
      && (typeof canPinToPublic === "function" ? canPinToPublic(project) : true)
      && !project?.incognito) {
      buttons.push(makeStripBtn(project?.public_pinned ? "Unpin public" : "Public", {
        title: project?.public_pinned ? "Unpin from public" : "Pin to public",
        action: "pin-public",
        onClick: () => onPinPublicProject?.(project),
      }));
    }
    if (!readOnly) {
      buttons.push(makeStripBtn("Settings", {
        title: "Rename project",
        action: "rename",
        onClick: () => onRenameProject?.(project),
      }));
    }
    if (sharedWithMe) {
      buttons.push(makeStripBtn("Remove", {
        title: "Remove from my folder",
        action: "leave-share",
        onClick: async () => {
          try {
            await projectShareDialog.leave(project);
          } catch (err) {
            alert(err.message || "Could not remove shared project");
          }
        },
      }));
    }
    if (canDelete) {
      buttons.push(makeStripBtn("Delete", {
        action: "delete",
        danger: true,
        onClick: () => onDeleteProject?.(project),
      }));
    }
    return buttons;
  }

  function hierarchyStripButtons(project, entry, sectionId, extras = []) {
    const buttons = [];
    const isFolder = !!entry?.virtual_folder;
    const isComp = sectionId === "components" || sectionId === "bodies" || sectionId === "vr_creations";
    const isDxf = entry?.format === "dxf" || /\.dxf$/i.test(String(entry?.name || ""));
    const board = !isComp ? canvasBoardForEntry(entry) : null;
    const shareFile = isFolder ? folderShareEntry(entry) : null;
    if (board && typeof onOpenCanvasBoard === "function") {
      buttons.push(makeStripBtn("Open canvas", {
        action: "open-canvas",
        title: `Open ${board.name} in the canvas viewer`,
        onClick: () => onOpenCanvasBoard(project, entry, board),
      }));
    }
    if (entryOpensInVideoEditor(entry) && typeof onOpenVideoEditor === "function") {
      buttons.push(makeStripBtn("Open in video editor", {
        action: "open-video",
        title: "Open in the video editor",
        onClick: () => onOpenVideoEditor(project, videoEditorActionEntry(entry)),
      }));
    }
    if (folderOpensInCodeEditor(entry) && typeof onOpenCodeFolder === "function") {
      buttons.push(makeStripBtn("Open in code editor", {
        action: "open-code",
        title: "Open the project tree in the code editor",
        onClick: () => onOpenCodeFolder(project, entry),
      }));
    }
    const canSend =
      !isComp
      && (sectionId === "references" || sectionId === "renders" || sectionId === "imagine")
      && typeof onSendReferenceToPrompt === "function"
      && !isDxf
      && (isFolder ? !!(board || shareFile || pickBrowserFolderImage(entry) || isProjectCodeFolder(entry)) : !!entry?.name);
    if (canSend) {
      buttons.push(makeStripBtn("Send to AI", {
        action: "send-ai",
        onClick: () => onSendReferenceToPrompt?.(project, entry),
      }));
    }
    buttons.push(...(extras || []).filter(Boolean));
    const canShare =
      !isFolder
      && !isComp
      && (sectionId === "references" || sectionId === "renders" || sectionId === "imagine")
      && !!entry?.name
      && !(entry.format === "dxf" || /\.dxf$/i.test(String(entry.name || "")))
      && typeof onReferenceShareAction === "function";
    const canRename =
      !isFolder
      && !isComp
      && (sectionId === "references" || sectionId === "renders" || sectionId === "robots" || sectionId === "imagine")
      && !!entry?.name
      && typeof onRenameHierarchyItem === "function";
    const canDelete =
      !isFolder
      && !isComp
      && (sectionId === "references" || sectionId === "renders" || sectionId === "robots" || sectionId === "imagine")
      && !!entry?.name
      && typeof onDeleteHierarchyItem === "function";
    const folderImage = isFolder ? pickBrowserFolderImage(entry) : null;
    const canDownload = !isComp && (
      isBrowserDirectDownloadEntry(entry, sectionId)
      || entry?.catalog_hardware
      || ((folderImage || shareFile) && typeof onExportHierarchyItem === "function")
    );
    if (isFolder && shareFile && typeof onReferenceShareAction === "function") {
      buttons.push(makeStripBtn("Copy share link", {
        action: "copy-link",
        onClick: () => onReferenceShareAction?.(project, shareFile, sectionId, "copy-link"),
      }));
    }
    if (canShare) {
      buttons.push(makeStripBtn("Share", {
        action: "share",
        onClick: () => onReferenceShareAction?.(project, entry, sectionId, "export-share"),
      }));
    } else if (canDownload && typeof onExportHierarchyItem === "function") {
      buttons.push(makeStripBtn("Download", {
        action: "download",
        onClick: () => onExportHierarchyItem?.(project, folderImage || shareFile || entry),
      }));
    }
    if (canRename) {
      buttons.push(makeStripBtn("Rename", {
        action: "rename",
        onClick: () => onRenameHierarchyItem?.(project, entry, sectionId),
      }));
    }
    if (canDelete) {
      buttons.push(makeStripBtn("Delete", {
        action: "delete",
        danger: true,
        onClick: () => deleteSelectedHierarchy(project, entry, sectionId),
      }));
    }
    if (isComp && !entry?.virtual_folder) {
      const extraHasDownload = extras.some((b) => b?.classList?.contains("browser-action-download"));
      if (typeof onExportHierarchyItem === "function" && !extraHasDownload) {
        buttons.push(makeStripBtn(entry?.catalog_hardware ? "Download" : "Export", {
          action: entry?.catalog_hardware ? "download" : "export",
          onClick: () => onExportHierarchyItem?.(project, entry),
        }));
      }
      if (typeof onRenameHierarchyItem === "function" && !entry?.virtual_body) {
        buttons.push(makeStripBtn("Rename", {
          action: "rename",
          onClick: () => onRenameHierarchyItem?.(project, entry, "components"),
        }));
      }
      if (typeof onDeleteHierarchyItem === "function" && !(entry?.virtual_component && !(entry.sidecar_filename || entry.filename || entry.source_filename))) {
        buttons.push(makeStripBtn("Delete", {
          action: "delete",
          danger: true,
          onClick: () => deleteSelectedHierarchy(project, entry, "components"),
        }));
      }
    }
    return buttons;
  }

  function isPublicSidebarFolder(folder) {
    return !!(folder && (folder.public || folder.id === "__public__"));
  }

  function isPublicSidebarProject(project) {
    const owned = !!getCurrentUserId?.() && projectOwnerId(project) === String(getCurrentUserId());
    return !owned && !!(project && (project.public || project.folder_id === "__public__"));
  }

  function signedInForPublic() {
    return !!getCurrentUserId?.();
  }

  function runPublicModelAction(action, project, extra = {}) {
    if (!action || !project) return;
    if (onlineModelsNeedsLogin(action, { signedIn: signedInForPublic() })) {
      onLoginForPublicAction?.({ action, projectId: project.id, ...extra });
      return;
    }
    onPublicModelAction?.(action, project, extra);
  }

  let moveSubmenuEl = null;

  function projectFromContextTarget(target) {
    const row = target?.closest?.(".proj-item[data-project-id]");
    const projectId = row?.dataset?.projectId || "";
    if (!projectId) return null;
    return (getProjects?.() || []).find((project) => project.id === projectId) || null;
  }

  function effectiveProjectFolderId(project) {
    const folderIds = new Set(folders.map((f) => f.id));
    const fid = project?.folder_id || null;
    return fid && folderIds.has(fid) ? fid : null;
  }

  function folderListKey(folderId) {
    return folderId || "__root__";
  }

  function rootFolderLabel() {
    const meta = getWorkspaceMeta?.(resolveTeamId()) || {};
    return meta.rootLabel || "Personal files";
  }

  function isSharedWorkspaceFolder(folder) {
    if (!folder) return false;
    const id = String(folder.id || "");
    return folder.shared_workspace === true || id.startsWith("__shared_ws_");
  }

  function sharedWorkspaceTeamId(folder = null) {
    if (folder && isSharedWorkspaceFolder(folder)) {
      const id = String(folder.id || "");
      if (folder.team_id) return String(folder.team_id);
      if (id.startsWith("__shared_ws_")) return id.slice("__shared_ws_".length) || null;
    }
    const meta = getWorkspaceMeta?.(resolveTeamId()) || {};
    if (meta.shared && meta.id) return String(meta.id);
    return null;
  }

  function teamRecord(teamId) {
    if (!teamId) return null;
    return (getTeams?.() || []).find((t) => String(t.id) === String(teamId)) || null;
  }

  function folderTeamIdOf(folder) {
    if (folder?.team_id) return String(folder.team_id);
    return sharedWorkspaceTeamId(folder) || resolveTeamId() || null;
  }

  function folderMenuCapabilities(folder) {
    const canManage = !!(folder && (folder.can_manage || folder.is_owner));
    const sharedTeamId = sharedWorkspaceTeamId(folder);
    const folderTeamId = folderTeamIdOf(folder);
    const sharedTeam = teamRecord(sharedTeamId);
    const folderTeam = teamRecord(folderTeamId) || sharedTeam;
    const isSharedTarget = !!sharedTeamId && (
      isSharedWorkspaceFolder(folder)
      || (!folder && !!(getWorkspaceMeta?.(resolveTeamId()) || {}).shared)
    );
    const canInviteShared = !!(
      isSharedTarget
      && (sharedTeam?.can_invite || sharedTeam?.role === "owner")
      && typeof onInviteWorkspace === "function"
    );
    const teamRole = String(folderTeam?.role || sharedTeam?.role || "").toLowerCase();
    const canLeaveSharedWs = !!(
      isSharedTarget
      && sharedTeam
      && teamRole !== "owner"
      && teamRole !== "admin"
      && typeof onLeaveWorkspace === "function"
    );
    const canManageSharedPerms = !!(
      isSharedTarget
      && sharedTeam
      && String(sharedTeam.role || "").toLowerCase() === "owner"
      && typeof onManageWorkspacePermissions === "function"
    );
    const myId = getCurrentUserId?.() || null;
    const canLeaveShare = !!(folder?.received_share && folder?.id && myId && folderTeamId);
    const canLeaveFolderTeam = !!(
      folder
      && folderTeamId
      && folderTeam
      && typeof onLeaveWorkspace === "function"
      && teamRole !== "owner"
      && teamRole !== "admin"
      && (folder.shared_with_me || isSharedWorkspaceFolder(folder) || canLeaveShare)
    );
    const showLeaveWorkspace = canLeaveSharedWs || (canLeaveFolderTeam && !isSharedTarget);
    const showMenuChrome = !!(
      canManage
      || canInviteShared
      || showLeaveWorkspace
      || canManageSharedPerms
      || canLeaveShare
      || (folder && canArchiveFolder(folder))
    );
    return {
      canManage,
      sharedTeamId,
      folderTeamId,
      sharedTeam,
      folderTeam,
      isSharedTarget,
      canInviteShared,
      canLeaveSharedWs,
      canManageSharedPerms,
      canLeaveShare,
      canLeaveFolderTeam,
      showLeaveWorkspace,
      showMenuChrome,
      myId,
    };
  }

  function appendFolderGroupLabel(parent, label, { breakBefore = false, extraClass = "" } = {}) {
    const el = document.createElement("div");
    el.className = breakBefore ? "folder-group-label folder-group-label--break" : "folder-group-label";
    if (extraClass) el.classList.add(extraClass);
    el.setAttribute("role", "presentation");
    el.textContent = label;
    parent.appendChild(el);
  }

  function sharedSidebarPrefs() {
    return loadSharedSidebarPrefs(String(getCurrentUserId?.() || ""));
  }

  function writeSharedSidebarPrefs(patch) {
    return saveSharedSidebarPrefs(String(getCurrentUserId?.() || ""), {
      ...sharedSidebarPrefs(),
      ...patch,
    });
  }

  function closeSharedRecentsMenu() {
    container?.querySelector(".shared-strip-recents-menu")?.remove();
  }

  function appendSharedProjectsHeader(parent, recentsCount) {
    const el = document.createElement("div");
    el.className = "folder-group-label folder-group-label--shared-projects";
    el.innerHTML = `
      <span>Shared Projects</span>
      <div class="shared-strip-controls">
        <button type="button" class="shared-strip-recents" data-shared-recents title="How many recents to show" aria-label="How many recents to show" aria-haspopup="menu" aria-expanded="false">⋯</button>
        <button type="button" class="shared-strip-reorder${sharedStripReorder ? " is-on" : ""}" data-shared-reorder title="Reorder sidebar shared projects" aria-pressed="${sharedStripReorder ? "true" : "false"}" aria-label="Reorder shared projects">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/>
            <rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/>
            <rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/>
            <rect x="9" y="9" width="4.5" height="4.5" rx="1"/>
          </svg>
        </button>
        <button type="button" class="workspace-section-manage" title="Browse shared projects">View more</button>
      </div>
    `;
    el.querySelector(".workspace-section-manage")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onManageSharedProjects?.();
    });
    el.querySelector("[data-shared-reorder]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      sharedStripReorder = !sharedStripReorder;
      refreshSharedProjectsStrip();
    });
    el.querySelector("[data-shared-recents]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const btn = ev.currentTarget;
      const existing = parent.querySelector(".shared-strip-recents-menu");
      if (existing) {
        existing.remove();
        btn.setAttribute("aria-expanded", "false");
        return;
      }
      const menu = document.createElement("div");
      menu.className = "shared-strip-recents-menu";
      menu.setAttribute("role", "menu");
      menu.innerHTML = Array.from({ length: 10 }, (_, i) => {
        const n = i + 1;
        const on = n === recentsCount;
        return `<button type="button" role="menuitemradio" aria-checked="${on ? "true" : "false"}" data-recents-count="${n}"${on ? " class=\"is-on\"" : ""}>${n}</button>`;
      }).join("");
      menu.addEventListener("click", (menuEv) => {
        const item = menuEv.target.closest("[data-recents-count]");
        if (!item) return;
        menuEv.preventDefault();
        menuEv.stopPropagation();
        writeSharedSidebarPrefs({ recentsCount: clampSharedRecentsCount(item.getAttribute("data-recents-count")) });
        refreshSharedProjectsStrip();
      });
      parent.appendChild(menu);
      btn.setAttribute("aria-expanded", "true");
    });
    parent.appendChild(el);
  }

  function appendSharedProjectRow(parent, project, { selected = false, reorder = false } = {}) {
    const wrap = document.createElement("section");
    wrap.className = "folder-zone workspace-sidebar-row-zone workspace-sidebar-row-zone--shared-project";
    wrap.classList.toggle("workspace-sidebar-row-zone--current", !!selected);
    wrap.dataset.sharedProjectId = project.id;
    wrap.draggable = !!reorder;
    const row = document.createElement("div");
    row.className = "workspace-sidebar-row";
    if (selected) row.classList.add("workspace-sidebar-row--current");
    const owner = project.owner_name || project.owner_email || (project.shared_by_me ? "You" : "Shared");
    const kicker = project.sidebarKind === "pinned" ? "Pinned" : "Recent";
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "workspace-sidebar-row-open";
    openBtn.title = `Open ${project.name || "shared project"}`;
    openBtn.setAttribute("aria-label", `Open ${project.name || "shared project"}`);
    openBtn.innerHTML = `
      ${reorder ? `<span class="shared-strip-handle" aria-hidden="true">⠿</span>` : ""}
      <span class="folder-icon">🔗</span>
      <span class="workspace-sidebar-row-copy">
        <span class="workspace-from-kicker">${escapeHtml(kicker)}</span>
        <span class="workspace-sidebar-row-name">${escapeHtml(project.name || "Shared project")}</span>
      </span>
      <span class="folder-count muted small">${escapeHtml(owner)}</span>
    `;
    openBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (project.id) onOpenProject?.(project.id);
    });
    const actions = document.createElement("div");
    actions.className = "workspace-sidebar-row-actions";
    actions.innerHTML = `
      <button type="button" class="workspace-row-icon workspace-row-icon--open" data-shared-open ${workspaceActionTipAttrs("Open shared project")}>
        <span class="workspace-sidebar-row-affordance" aria-hidden="true">↗</span>
      </button>
    `;
    actions.querySelector("[data-shared-open]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (project.id) onOpenProject?.(project.id);
    });
    actions.querySelectorAll(".workspace-row-icon").forEach(bindWorkspaceActionTip);
    row.append(openBtn, actions);
    wrap.appendChild(row);
    if (reorder) {
      wrap.addEventListener("dragstart", (ev) => {
        sharedDragId = String(project.id);
        wrap.classList.add("is-dragging");
        try { ev.dataTransfer.setData("text/plain", String(project.id)); } catch { /* ignore */ }
        ev.dataTransfer.effectAllowed = "move";
      });
      wrap.addEventListener("dragend", () => {
        sharedDragId = null;
        wrap.classList.remove("is-dragging");
      });
      wrap.addEventListener("dragover", (ev) => {
        if (!sharedDragId || sharedDragId === String(project.id)) return;
        ev.preventDefault();
        wrap.classList.add("is-drop-target");
      });
      wrap.addEventListener("dragleave", () => wrap.classList.remove("is-drop-target"));
      wrap.addEventListener("drop", (ev) => {
        ev.preventDefault();
        wrap.classList.remove("is-drop-target");
        const from = sharedDragId || ev.dataTransfer.getData("text/plain");
        const to = String(project.id);
        if (!from || from === to) return;
        const host = parent.closest("#explorer-shared-projects") || parent;
        const ids = [...host.querySelectorAll("[data-shared-project-id]")].map((node) => node.dataset.sharedProjectId);
        const next = ids.filter((id) => id && id !== from);
        const at = next.indexOf(to);
        next.splice(at < 0 ? next.length : at, 0, from);
        writeSharedSidebarPrefs({ order: next });
        refreshSharedProjectsStrip();
      });
    }
    parent.appendChild(wrap);
  }

  function paintSharedProjectsStrip(host, projects = []) {
    host.replaceChildren();
    const local = sharedSidebarPrefs();
    appendSharedProjectsHeader(host, local.recentsCount);
    const rows = listedSidebarSharedProjects({
      projects,
      lastOpenedProjectId: getLastOpenedProjectId?.() || null,
      activeProjectId: getActiveProjectId?.() || null,
      currentUserId: String(getCurrentUserId?.() || ""),
      pinnedIds: local.pinnedIds,
      recentsCount: local.recentsCount,
      order: local.order,
    });
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "muted small workspace-last-opened-empty";
      empty.textContent = "No shared projects yet — use View more to browse or share one.";
      host.appendChild(empty);
      return;
    }
    const activeId = String(getActiveProjectId?.() || "");
    for (const project of rows) {
      appendSharedProjectRow(host, project, {
        selected: !!activeId && String(project.id) === activeId,
        reorder: sharedStripReorder,
      });
    }
  }

  function appendSharedProjectsSection(parent, projects = []) {
    const host = document.createElement("div");
    host.id = "explorer-shared-projects";
    host.className = "explorer-shared-projects";
    paintSharedProjectsStrip(host, projects);
    parent.appendChild(host);
  }

  function refreshSharedProjectsStrip() {
    const host = container?.querySelector("#explorer-shared-projects");
    if (!host) return;
    closeSharedRecentsMenu();
    const projects = Array.isArray(getProjects?.()) ? getProjects() : [];
    paintSharedProjectsStrip(host, projects);
  }

  function appendWorkspacesHeader(parent) {
    const el = document.createElement("div");
    el.className = "folder-group-label folder-group-label--workspaces";
    el.innerHTML = `
      <span>Workspaces</span>
      <button type="button" class="workspace-section-manage" title="Manage workspaces">Manage</button>
    `;
    el.querySelector(".workspace-section-manage")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onManageWorkspaces?.();
    });
    parent.appendChild(el);
  }

  function workspaceActionTipAttrs(label) {
    const safe = escapeHtml(label);
    return `title="${safe}" aria-label="${safe}" data-tooltip="${safe}"`;
  }

  function bindWorkspaceActionTip(el) {
    if (!el) return;
    const label = el.getAttribute("data-tooltip") || el.getAttribute("title") || "";
    if (!label) return;
    el.setAttribute("data-tooltip", label);
    el.setAttribute("aria-label", el.getAttribute("aria-label") || label);
    const restoreTitle = () => el.setAttribute("title", label);
    el.addEventListener("pointerenter", () => el.removeAttribute("title"));
    el.addEventListener("pointerleave", restoreTitle);
    el.addEventListener("focus", () => el.removeAttribute("title"));
    el.addEventListener("blur", restoreTitle);
  }

  function togglePersonalWorkspaceRow(ws) {
    const key = `ws:${ws.id}`;
    if (expandedWorkspaces.has(key)) expandedWorkspaces.delete(key);
    else expandedWorkspaces.add(key);
    saveIdSet(EXPANDED_WS_KEY, expandedWorkspaces);
    render();
  }

  function markExplorerWorkspace(teamId) {
    const id = String(teamId || "").trim();
    if (id) explorerOpenedWorkspaceId = id;
  }

  function recentsTouchedThisSession() {
    const recents = (getRecentWorkspaceIds?.() || []).map((id) => String(id));
    if (recentsAtBoot === null) recentsAtBoot = recents.slice();
    return !!(recents[0] && recents[0] !== recentsAtBoot[0]);
  }

  function explorerWorkspaceRoster(projects, personalId, personalLabel) {
    const last = lastOpenedSidebarProject({
      teams: getTeams?.() || [],
      projects,
      lastOpenedProjectId: getLastOpenedProjectId?.() || null,
      activeProjectId: getActiveProjectId?.() || null,
      personalId: personalId || null,
      personalLabel: personalLabel || "Projects",
    });
    const pid = String(last?.project?.id || "");
    if (pid && pid !== lastSyncedProjectId) {
      const firstSync = !lastSyncedProjectId;
      lastSyncedProjectId = pid;
      if (!firstSync) explorerOpenedWorkspaceId = "";
    }
    const current = currentListedSidebarWorkspace({
      teams: getTeams?.() || [],
      personalId: personalId || null,
      personalLabel: personalLabel || "Projects",
      projects,
      recentIds: getRecentWorkspaceIds?.() || [],
      lastOpenedProjectId: getLastOpenedProjectId?.() || null,
      activeProjectId: getActiveProjectId?.() || null,
      savedWorkspaceId: getWorkspaceId?.() || resolveTeamId() || null,
      openedWorkspaceId: explorerOpenedWorkspaceId,
      preferRecent: recentsTouchedThisSession(),
    });
    return {
      rows: current ? [current] : [],
      currentId: current?.id || "",
      last,
    };
  }

  function openWorkspaceFromRow(ws) {
    markExplorerWorkspace(ws.id);
    onTouchWorkspace?.(ws.id);
    if (ws.personal) {
      togglePersonalWorkspaceRow(ws);
      return;
    }
    onOpenWorkspace?.(ws.id);
  }

  function appendWorkspaceRow(parent, ws, { selected = false } = {}) {
    const wrap = document.createElement("section");
    wrap.className = "folder-zone workspace-sidebar-row-zone";
    wrap.classList.toggle("workspace-sidebar-row-zone--shared", !!ws.shared && !ws.personal);
    wrap.classList.toggle("workspace-sidebar-row-zone--personal", !!ws.personal);
    wrap.classList.toggle("workspace-sidebar-row-zone--current", !!selected);
    wrap.dataset.workspaceId = ws.id;
    const hidden = !!(getHiddenWorkspaceIds?.() || new Set()).has(String(ws.id));
    const personalExpanded = !!(ws.personal && expandedWorkspaces.has(`ws:${ws.id}`));
    const openLabel = ws.personal
      ? (personalExpanded ? "Collapse personal Projects" : "Expand personal Projects")
      : "Open workspace — people and projects";
    const eyeLabel = ws.personal
      ? openLabel
      : (hidden ? "Show in sidebar" : "Hide from sidebar");
    const shareLabel = "Invite people";
    const gearLabel = "Who can share and edit";
    const row = document.createElement("div");
    row.className = "workspace-sidebar-row";
    if (selected) row.classList.add("workspace-sidebar-row--current");
    row.dataset.workspaceId = ws.id;
    const count = ws.projectCount ? String(ws.projectCount) : "";
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "workspace-sidebar-row-open";
    openBtn.title = openLabel;
    openBtn.setAttribute("aria-label", openLabel);
    openBtn.innerHTML = `
      <span class="folder-icon">${ws.personal ? "📁" : "🟧"}</span>
      <span class="workspace-sidebar-row-name">${escapeHtml(ws.label)}</span>
      <span class="folder-count muted small">${escapeHtml(count)}</span>
    `;
    openBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openWorkspaceFromRow(ws);
    });
    const actions = document.createElement("div");
    actions.className = "workspace-sidebar-row-actions";
    actions.innerHTML = `
      <button type="button" class="workspace-row-icon workspace-row-icon--open" data-ws-open ${workspaceActionTipAttrs(openLabel)}>
        <span class="workspace-sidebar-row-affordance" aria-hidden="true">↗</span>
      </button>
      <button type="button" class="workspace-row-icon" data-ws-eye ${workspaceActionTipAttrs(eyeLabel)}>
        ${hidden ? EYE_OFF_SVG : EYE_ON_SVG}
      </button>
      ${`<button type="button" class="workspace-row-icon" data-ws-share ${workspaceActionTipAttrs(shareLabel)}>
        ${ICON_SHARE}
      </button>`}
      ${ws.canManagePerms ? `<button type="button" class="workspace-row-icon" data-ws-gear ${workspaceActionTipAttrs(gearLabel)}>
        ${GEAR_SVG}
      </button>` : ""}
    `;
    actions.querySelector("[data-ws-open]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openWorkspaceFromRow(ws);
    });
    actions.querySelector("[data-ws-eye]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ws.personal) {
        togglePersonalWorkspaceRow(ws);
        return;
      }
      onToggleWorkspaceVisible?.(ws.id, hidden);
    });
    actions.querySelector("[data-ws-share]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!ws.canInvite) {
        window.alert("You do not have permission to invite people to this workspace.");
        return;
      }
      onInviteWorkspace?.(ws.id);
    });
    actions.querySelector("[data-ws-gear]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onManageWorkspacePermissions?.(ws.id);
    });
    actions.querySelectorAll(".workspace-row-icon").forEach(bindWorkspaceActionTip);
    row.append(openBtn, actions);
    wrap.appendChild(row);
    parent.appendChild(wrap);
    return wrap;
  }

  function appendWorkspaceRoster(parent, listed, currentId = "") {
    if (!listed?.length) {
      const empty = document.createElement("p");
      empty.className = "muted small workspace-last-opened-empty";
      empty.textContent = "No workspaces yet — use Manage to create or show one.";
      parent.appendChild(empty);
      return;
    }
    const current = String(currentId || "");
    for (const ws of listed) {
      appendWorkspaceRow(parent, ws, { selected: !!current && String(ws.id) === current });
    }
  }

  function appendLastOpenedWorkspace(parent, focus) {
    const block = document.createElement("div");
    block.className = "workspace-last-opened";
    if (!focus?.project) {
      const empty = document.createElement("p");
      empty.className = "muted small workspace-last-opened-empty";
      empty.textContent = "No last opened project";
      block.appendChild(empty);
      parent.appendChild(block);
      return;
    }
    const origin = document.createElement("div");
    origin.className = "workspace-from";
    const kicker = document.createElement("span");
    kicker.className = "workspace-from-kicker";
    kicker.textContent = "Workspace";
    const name = document.createElement("button");
    name.type = "button";
    name.className = "workspace-from-name";
    name.textContent = focus.label || "Workspace";
    name.title = `Open ${focus.label || "workspace"}`;
    name.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!focus.id) return;
      onTouchWorkspace?.(focus.id);
      onOpenWorkspace?.(focus.id);
    });
    origin.append(kicker, name);
    block.appendChild(origin);
    appendRecentWorkspaceProject(block, focus);
    parent.appendChild(block);
  }

  function appendRecentWorkspaceProject(parent, focus) {
    if (!parent || !focus?.project) return;
    const wrap = document.createElement("section");
    wrap.className = "folder-zone workspace-recent-project";
    wrap.dataset.workspaceId = focus.id;
    wrap.dataset.projectId = focus.project.id;
    wrap.setAttribute("aria-label", `Last opened project in ${focus.label || "workspace"}`);
    const list = document.createElement("ul");
    list.className = "project-list";
    appendProjectRow(list, focus.project);
    wrap.appendChild(list);
    wrap.addEventListener("contextmenu", (ev) => {
      if (ev.target.closest(".proj-item, .proj-row-body, .btn-icon")) return;
      showProjectContextMenu(ev, focus.project);
    });
    parent.appendChild(wrap);
  }

  function hierarchyListKey(projectId, sectionId) {
    return `${projectId}:${sectionId}`;
  }

  function visibleSlice(items, key, set, forceAll = false) {
    const list = items || [];
    if (forceAll || set.has(key) || list.length <= COMPACT_LIST_LIMIT) return list;
    return list.slice(0, COMPACT_LIST_LIMIT);
  }

  function buildShowMoreControl({ total, shown, expanded, label, onToggle }) {
    if (total <= COMPACT_LIST_LIMIT) return null;
    const li = document.createElement("li");
    li.className = "browser-show-more-row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "browser-show-more-btn";
    btn.textContent = expanded
      ? `Show less ${label}`
      : `Show ${total - shown} more ${label}`;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onToggle?.();
    });
    li.appendChild(btn);
    return li;
  }

  function clearDropIndicators() {
    dropBeforeProjectId = null;
    dropAtEnd = false;
    container?.querySelectorAll(".drop-target-active, .drop-before, .drop-after").forEach((el) => {
      el.classList.remove("drop-target-active", "drop-before", "drop-after");
    });
  }

  function sortProjectsForDisplay(list, { recencyFirst = false } = {}) {
    return sortProjectsByRecency(list, {
      recencyFirst,
      isGenerating: (id) => !!isProjectGenerating?.(id),
    });
  }

  function applyLocalFolderOrder(projectId, folderId, { beforeProjectId = null, atEnd = false } = {}) {
    const projects = getProjects();
    const moved = projects.find((p) => p.id === projectId);
    if (!moved) return;
    moved.folder_id = folderId || null;
    const siblings = sortProjectsForDisplay(
      projects.filter((p) => p.id !== projectId && effectiveProjectFolderId(p) === (folderId || null)),
    );
    let nextOrder;
    if (beforeProjectId) {
      const idx = siblings.findIndex((p) => p.id === beforeProjectId);
      nextOrder = idx >= 0 ? siblings.slice(0, idx).concat(moved, siblings.slice(idx)) : siblings.concat(moved);
    } else if (atEnd) {
      nextOrder = siblings.concat(moved);
    } else {
      nextOrder = [moved, ...siblings];
    }
    nextOrder.forEach((p, index) => {
      p.sort_order = index;
      p.folder_id = folderId || null;
    });
  }

  async function moveProjectToFolder(projectId, folderId, { beforeProjectId = null, atEnd = false } = {}) {
    const projects = getProjects();
    const proj = projects.find((x) => x.id === projectId);
    if (proj?.read_only_project) return;
    const targetFolder = folderId || null;
    const sameFolder = proj && effectiveProjectFolderId(proj) === targetFolder;
    const isReorder = !!(beforeProjectId || atEnd);
    if (sameFolder && !isReorder) return;
    try {
      const data = await api(`/api/projects/${projectId}/folder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_id: targetFolder,
          before_project_id: beforeProjectId || null,
          at_end: !!atEnd,
        }),
      });
      applyLocalFolderOrder(projectId, targetFolder, { beforeProjectId, atEnd });
      if (proj && data?.sort_order != null) proj.sort_order = data.sort_order;
      render();
      // Same-folder reorder: keep local order. A full project refetch can race and
      // briefly restore the previous sort before the DB read sees the new values.
      if (!sameFolder || !isReorder) {
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      }
    } catch (err) {
      alert(err.message || "Could not move project");
    }
  }

  function openMoveProjectSubmenu(anchorBtn, project) {
    if (project?.read_only_project) return;
    moveSubmenuEl?.remove();
    moveSubmenuEl = null;
    const submenu = document.createElement("div");
    submenu.className = "folder-context-submenu";
    submenu.setAttribute("role", "menu");
    const currentFolderId = effectiveProjectFolderId(project);
    const workspaces = (getTeams?.() || []).filter((t) => t?.id);
    if (workspaces.length) {
      const wsLabel = document.createElement("div");
      wsLabel.className = "folder-context-submenu-label";
      wsLabel.textContent = "Save to workspace";
      submenu.appendChild(wsLabel);
      for (const team of workspaces) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "menuitem");
        const isCurrent = String(project?.team_id || "") === String(team.id);
        btn.textContent = isCurrent
          ? `🟧 ${team.name || "Workspace"} (current)`
          : `🟧 ${team.name || "Workspace"}`;
        btn.disabled = isCurrent;
        btn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          closeContextMenu();
          try {
            await api(`/api/projects/${encodeURIComponent(project.id)}/workspace`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ team_id: team.id }),
            });
            if (project) project.team_id = team.id;
            document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
          } catch (err) {
            alert(err.message || "Could not save to workspace");
          }
        });
        submenu.appendChild(btn);
      }
      const folderLabel = document.createElement("div");
      folderLabel.className = "folder-context-submenu-label";
      folderLabel.textContent = "Move to folder";
      submenu.appendChild(folderLabel);
    }

    const targets = [
      { id: null, label: rootFolderLabel(), icon: "📁" },
      ...folders
        .filter((f) => !(f.virtual || f.read_only || f.public))
        .map((f) => ({ id: f.id, label: f.name, icon: "📂" })),
    ];

    for (const target of targets) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      const isCurrent = (target.id || null) === currentFolderId;
      btn.textContent = isCurrent ? `${target.icon} ${target.label} (current)` : `${target.icon} ${target.label}`;
      btn.disabled = isCurrent;
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        closeContextMenu();
        await moveProjectToFolder(project.id, target.id);
      });
      submenu.appendChild(btn);
    }

    document.body.appendChild(submenu);
    moveSubmenuEl = submenu;
    const anchorRect = anchorBtn.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    let left = anchorRect.right + 4;
    let top = anchorRect.top;
    if (left + submenuRect.width > window.innerWidth - 8) {
      left = Math.max(8, anchorRect.left - submenuRect.width - 4);
    }
    top = Math.min(top, window.innerHeight - submenuRect.height - 8);
    submenu.style.left = `${Math.max(8, left)}px`;
    submenu.style.top = `${Math.max(8, top)}px`;
  }

  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0) return;
      if (contextMenu?.contains(e.target)) return;
      if (moveSubmenuEl?.contains(e.target)) return;
      if (actionStripEl?.contains(e.target)) return;
      if (e.target?.closest?.(".btn-folder-menu, .browser-item-kebab, .proj-item-kebab, .explorer-action-strip")) return;
      closeContextMenu();
      closeActionStrip();
    },
    true
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (e.target?.closest?.("[data-measure-kebab], .measure-label-menu, .measure-label-kebab")) return;
    closeContextMenu();
    closeActionStrip();
  }, true);
  document.addEventListener("scroll", () => {
    closeContextMenu();
    closeActionStrip();
  }, true);
  window.addEventListener("resize", () => {
    closeContextMenu();
    closeActionStrip();
  });

  function ensureShareModal() {
    if (shareModalEl) return shareModalEl;
    shareModalEl = document.createElement("div");
    shareModalEl.className = "auth-modal hidden";
    shareModalEl.id = "folder-share-modal";
    shareModalEl.setAttribute("role", "dialog");
    shareModalEl.setAttribute("aria-modal", "true");
    shareModalEl.innerHTML = `
      <div class="auth-backdrop" data-share-close></div>
      <div class="auth-card app-dialog-card">
        <button type="button" class="auth-close" data-share-close aria-label="Close">&times;</button>
        <h2 class="app-dialog-title" id="folder-share-title">Share folder</h2>
        <p class="muted small folder-share-hint">Pick a team member or type an email. They must have an account (or will get a workspace invite).</p>
        <ul class="folder-share-list" id="folder-share-list"></ul>
        <label class="app-dialog-label">Team member
          <select id="folder-share-member" class="folder-share-member-select">
            <option value="">Loading workspace members…</option>
          </select>
        </label>
        <label class="app-dialog-label">Email <span class="muted small">(optional if you picked a member)</span>
          <input type="email" id="folder-share-email" placeholder="coworker@company.com" autocomplete="email" />
        </label>
        <label class="folder-share-restrict">
          <input type="checkbox" id="folder-share-restrict" checked />
          <span>Private — only you and people you share with can see this folder</span>
        </label>
        <p id="folder-share-status" class="muted small"></p>
        <div class="app-dialog-actions">
          <button type="button" class="btn secondary" data-share-close>Close</button>
          <button type="button" class="btn accent" id="folder-share-submit">Share</button>
        </div>
      </div>
    `;
    document.body.appendChild(shareModalEl);
    shareModalEl.querySelectorAll("[data-share-close]").forEach((el) => {
      el.addEventListener("click", closeShareModal);
    });
    shareModalEl.querySelector("#folder-share-submit")?.addEventListener("click", () => {
      submitShareModal();
    });
    shareModalEl.querySelector("#folder-share-member")?.addEventListener("change", (e) => {
      const email = String(e.target.value || "").trim();
      const emailInput = shareModalEl?.querySelector("#folder-share-email");
      const status = shareModalEl?.querySelector("#folder-share-status");
      if (emailInput) emailInput.value = email;
      if (status) status.textContent = email ? `Ready to share with ${email}` : "";
    });
    shareModalEl.querySelector("#folder-share-email")?.addEventListener("input", () => {
      const status = shareModalEl?.querySelector("#folder-share-status");
      if (status && status.textContent === "Enter an email address.") status.textContent = "";
    });
    shareModalEl.querySelector("#folder-share-email")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitShareModal();
      }
    });
    return shareModalEl;
  }

  let folderShareAbort = null; // leakfix83
  function beginFolderShareFetch() {
    if (folderShareAbort) {
      try { folderShareAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    folderShareAbort = ctl;
    return ctl;
  }

  async function loadMemberOptions(existingShares = [], signal) {
    const teamId = getWorkspaceId();
    const select = shareModalEl?.querySelector("#folder-share-member");
    if (!select || !teamId) return;
    if (!select.querySelector("option[value]:not([value=''])")) {
      select.innerHTML = `<option value="">Loading workspace members…</option>`;
    }
    try {
      const data = await api(`/api/teams/${teamId}/members`, signal ? { signal } : undefined);
      if (signal?.aborted) return;
      const sharedEmails = new Set(
        existingShares
          .map((s) => String(s.email || "").toLowerCase())
          .filter(Boolean)
      );
      const ownerId = shareModalFolder?.created_by;
      const members = (data.members || []).filter(
        (m) => m.id !== ownerId && !sharedEmails.has(String(m.email || "").toLowerCase())
      );
      select.innerHTML = "";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Type a new email…";
      select.appendChild(blank);
      for (const member of members) {
        const opt = document.createElement("option");
        opt.value = member.email;
        opt.textContent = `${member.display_name || member.email} (${member.email})`;
        select.appendChild(opt);
      }
      if (!members.length) {
        blank.textContent = "No unshared team members — type a new email…";
      }
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") return;
      select.innerHTML = `<option value="">Could not load members — type a new email…</option>`;
    }
  }

  function closeShareModal() {
    if (folderShareAbort) {
      try { folderShareAbort.abort(); } catch (_) { /* ignore */ }
      folderShareAbort = null;
    }
    shareModalEl?.classList.add("hidden");
    shareModalFolder = null;
  }

  async function loadShareList(folder, signal) {
    const teamId = getWorkspaceId();
    const listEl = shareModalEl?.querySelector("#folder-share-list");
    if (!listEl || !teamId) return [];
    if (!listEl.querySelector(".folder-share-item")) {
      listEl.innerHTML = `<li class="muted small">Loading…</li>`;
    }
    let shares = [];
    try {
      const data = await api(`/api/teams/${teamId}/folders/${folder.id}/shares`, signal ? { signal } : undefined);
      if (signal?.aborted) return [];
      shares = data.shares || [];
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") return [];
      listEl.innerHTML = `<li class="muted small">Could not load shares.</li>`;
      return [];
    }
    if (signal?.aborted) return [];
    if (!shares.length) {
      listEl.innerHTML = `<li class="muted small folder-share-empty">Not shared with anyone yet.</li>`;
      return shares;
    }
    listEl.innerHTML = "";
    for (const s of shares) {
      const li = document.createElement("li");
      li.className = "folder-share-item";
      if (s.pending) {
        li.innerHTML = `<span>⏳ ${escapeHtml(s.email)} <span class="muted small">(pending)</span></span>`;
      } else {
        li.innerHTML = `<span><strong>${escapeHtml(s.display_name || s.email)}</strong> <span class="muted small">${escapeHtml(s.email)}</span></span>`;
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "btn-icon btn-share-remove";
        rm.title = "Remove access";
        rm.textContent = "×";
        rm.addEventListener("click", async () => {
          if (!window.confirm(`Remove ${s.display_name || s.email} from this folder?`)) return;
          try {
            await api(`/api/teams/${teamId}/folders/${folder.id}/shares/${s.user_id}`, {
              method: "DELETE",
            });
            await loadShareList(folder);
            await refreshFolders();
            render();
            document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
          } catch (err) {
            alert(err.message || "Could not remove share");
          }
        });
        li.appendChild(rm);
      }
      listEl.appendChild(li);
    }
    return shares;
  }

  async function submitShareModal() {
    const folder = shareModalFolder;
    const teamId = getWorkspaceId();
    const status = shareModalEl?.querySelector("#folder-share-status");
    const emailInput = shareModalEl?.querySelector("#folder-share-email");
    const memberSelect = shareModalEl?.querySelector("#folder-share-member");
    const restrict = shareModalEl?.querySelector("#folder-share-restrict");
    if (!folder || !teamId) return;
    // Typed email wins if present; otherwise use the selected team member.
    const email = String(emailInput?.value || memberSelect?.value || "").trim();
    if (!email) {
      if (status) status.textContent = "Pick a team member or enter an email address.";
      memberSelect?.focus();
      return;
    }
    if (status) status.textContent = "Sharing…";
    try {
      const res = await api(`/api/teams/${teamId}/folders/${folder.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          restrict_access: restrict?.checked ?? true,
        }),
      });
      if (status) status.textContent = res.message || "Folder shared.";
      if (emailInput) emailInput.value = "";
      if (memberSelect) memberSelect.value = "";
      const shares = await loadShareList(folder);
      await loadMemberOptions(shares);
      await refreshFolders();
      render();
      document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
    } catch (err) {
      if (status) status.textContent = err.message || "Could not share folder";
    }
  }

  async function openShareDialog(folder) {
    const teamId = getWorkspaceId();
    if (!teamId) return;
    shareModalFolder = folder;
    const modal = ensureShareModal();
    modal.querySelector("#folder-share-title").textContent = `Share “${folder.name}”`;
    modal.querySelector("#folder-share-email").value = "";
    const memberSelect = modal.querySelector("#folder-share-member");
    if (!memberSelect?.querySelector("option[value]:not([value=''])")) {
      memberSelect.innerHTML = `<option value="">Loading workspace members…</option>`;
    }
    modal.querySelector("#folder-share-status").textContent = "";
    modal.querySelector("#folder-share-restrict").checked =
      folder.visibility !== "workspace";
    modal.classList.remove("hidden");
    const ctl = beginFolderShareFetch();
    const shares = await loadShareList(folder, ctl.signal);
    if (ctl.signal.aborted) return;
    await loadMemberOptions(shares, ctl.signal);
    if (ctl.signal.aborted) return;
    modal.querySelector("#folder-share-member")?.focus();
  }

  function ensureRenameModal() {
    if (renameModalEl) return renameModalEl;
    renameModalEl = document.createElement("div");
    renameModalEl.className = "auth-modal hidden";
    renameModalEl.setAttribute("role", "dialog");
    renameModalEl.setAttribute("aria-modal", "true");
    renameModalEl.innerHTML = `
      <div class="auth-backdrop" data-rename-close></div>
      <div class="auth-card app-dialog-card">
        <button type="button" class="auth-close" data-rename-close aria-label="Close">&times;</button>
        <h2 class="app-dialog-title">Rename folder</h2>
        <label class="app-dialog-label">Folder name
          <input type="text" id="folder-rename-input" maxlength="120" />
        </label>
        <p id="folder-rename-error" class="auth-error hidden"></p>
        <div class="app-dialog-actions">
          <button type="button" class="btn secondary" data-rename-close>Cancel</button>
          <button type="button" class="btn accent" id="folder-rename-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(renameModalEl);
    let renameTarget = null;
    renameModalEl.querySelectorAll("[data-rename-close]").forEach((el) => {
      el.addEventListener("click", () => {
        renameModalEl.classList.add("hidden");
        renameTarget = null;
      });
    });
    renameModalEl.querySelector("#folder-rename-save")?.addEventListener("click", async () => {
      const folder = renameTarget;
      const teamId = getWorkspaceId();
      const input = renameModalEl.querySelector("#folder-rename-input");
      const errEl = renameModalEl.querySelector("#folder-rename-error");
      const next = input?.value?.trim();
      if (!folder || !teamId || !next || next === folder.name) {
        renameModalEl.classList.add("hidden");
        return;
      }
      errEl.classList.add("hidden");
      try {
        await api(`/api/teams/${teamId}/folders/${folder.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: next }),
        });
        renameModalEl.classList.add("hidden");
        renameTarget = null;
        await refreshFolders();
        render();
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      } catch (err) {
        errEl.textContent = err.message || "Could not rename folder";
        errEl.classList.remove("hidden");
      }
    });
    renameModalEl.openFor = (folder) => {
      renameTarget = folder;
      renameModalEl.querySelector("#folder-rename-input").value = folder.name;
      renameModalEl.querySelector("#folder-rename-error").classList.add("hidden");
      renameModalEl.classList.remove("hidden");
      renameModalEl.querySelector("#folder-rename-input")?.focus();
      renameModalEl.querySelector("#folder-rename-input")?.select();
    };
    return renameModalEl;
  }

  function openRenameDialog(folder) {
    ensureRenameModal().openFor(folder);
  }

  function creatableFoldersForPicker() {
    return (folders || []).filter((f) => {
      if (!f || !f.id) return false;
      if (isCommunityFolder(f) || f.virtual || f.public) return false;
      if (isSharedWorkspaceFolder(f)) return false;
      if (archivedFolderIds().has(f.id)) return false;
      return true;
    });
  }

  function ensureCreateFolderModal() {
    if (createFolderModalEl) return createFolderModalEl;
    createFolderModalEl = document.createElement("div");
    createFolderModalEl.className = "auth-modal hidden";
    createFolderModalEl.id = "folder-create-modal";
    createFolderModalEl.setAttribute("role", "dialog");
    createFolderModalEl.setAttribute("aria-modal", "true");
    createFolderModalEl.setAttribute("aria-labelledby", "folder-create-title");
    createFolderModalEl.innerHTML = `
      <div class="auth-backdrop" data-create-folder-close></div>
      <div class="auth-card app-dialog-card folder-create-card">
        <button type="button" class="auth-close" data-create-folder-close aria-label="Close">&times;</button>
        <h2 class="app-dialog-title" id="folder-create-title">New folder</h2>
        <p class="muted small folder-create-hint">Name the folder, then choose a top-level spot or nest it inside an existing folder.</p>
        <label class="app-dialog-label">Folder name
          <input type="text" id="folder-create-name" maxlength="120" placeholder="e.g. Client work" autocomplete="off" />
        </label>
        <div class="folder-create-location">
          <span class="folder-create-location-label">Location</span>
          <div class="folder-create-location-list" id="folder-create-location-list" role="listbox" aria-label="Folder location"></div>
        </div>
        <p id="folder-create-error" class="auth-error hidden"></p>
        <div class="app-dialog-actions">
          <button type="button" class="btn secondary" data-create-folder-close>Cancel</button>
          <button type="button" class="btn accent" id="folder-create-save">Create folder</button>
        </div>
      </div>
    `;
    document.body.appendChild(createFolderModalEl);

    let selectedParentId = "";

    const close = () => {
      createFolderModalEl.classList.add("hidden");
      selectedParentId = "";
    };

    createFolderModalEl.querySelectorAll("[data-create-folder-close]").forEach((el) => {
      el.addEventListener("click", close);
    });

    const renderLocations = () => {
      const list = createFolderModalEl.querySelector("#folder-create-location-list");
      if (!list) return;
      const projects = getProjects?.() || [];
      const options = [
        {
          id: "",
          title: "Top level",
          subtitle: "New folder in this workspace",
          icon: "📁",
        },
        ...creatableFoldersForPicker().map((folder) => {
          const kids = projects.filter((p) => p.folder_id === folder.id);
          const names = kids.slice(0, 3).map((p) => p.name || p.id).filter(Boolean);
          const extra = kids.length > 3 ? ` +${kids.length - 3} more` : "";
          const subtitle = kids.length
            ? `${kids.length} project${kids.length === 1 ? "" : "s"}${names.length ? ` · ${names.join(", ")}${extra}` : ""}`
            : "Empty folder";
          return {
            id: folder.id,
            title: folder.name || "Folder",
            subtitle,
            icon: "📂",
          };
        }),
      ];
      list.innerHTML = options
        .map((opt) => {
          const active = String(selectedParentId || "") === String(opt.id || "");
          return `
            <button type="button" class="folder-create-location-option${active ? " is-active" : ""}" role="option" aria-selected="${active ? "true" : "false"}" data-parent-id="${escapeHtml(opt.id)}">
              <span class="folder-create-location-icon" aria-hidden="true">${opt.icon}</span>
              <span class="folder-create-location-copy">
                <strong>${escapeHtml(opt.title)}</strong>
                <small>${escapeHtml(opt.subtitle)}</small>
              </span>
            </button>
          `;
        })
        .join("");
      list.querySelectorAll("[data-parent-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedParentId = btn.getAttribute("data-parent-id") || "";
          renderLocations();
        });
      });
    };

    let createFolderTeamOverride = null;

    const submit = async () => {
      const teamId = createFolderTeamOverride || resolveTeamId();
      const input = createFolderModalEl.querySelector("#folder-create-name");
      const errEl = createFolderModalEl.querySelector("#folder-create-error");
      const saveBtn = createFolderModalEl.querySelector("#folder-create-save");
      const name = input?.value?.trim();
      errEl?.classList.add("hidden");
      if (!teamId) {
        if (errEl) {
          errEl.textContent = "Select a workspace first.";
          errEl.classList.remove("hidden");
        }
        return;
      }
      if (!name) {
        if (errEl) {
          errEl.textContent = "Enter a folder name.";
          errEl.classList.remove("hidden");
        }
        input?.focus();
        return;
      }
      if (saveBtn) saveBtn.disabled = true;
      try {
        const body = { name };
        if (selectedParentId) body.parent_id = selectedParentId;
        await api(`/api/teams/${teamId}/folders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        close();
        await refreshFolders();
        render();
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || "Could not create folder";
          errEl.classList.remove("hidden");
        }
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    };

    createFolderModalEl.querySelector("#folder-create-save")?.addEventListener("click", () => {
      void submit();
    });
    createFolderModalEl.querySelector("#folder-create-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });

    createFolderModalEl.open = ({ parentId = "", teamId = "" } = {}) => {
      selectedParentId = parentId || "";
      createFolderTeamOverride = teamId || null;
      const input = createFolderModalEl.querySelector("#folder-create-name");
      const errEl = createFolderModalEl.querySelector("#folder-create-error");
      if (input) input.value = "";
      errEl?.classList.add("hidden");
      renderLocations();
      createFolderModalEl.classList.remove("hidden");
      window.setTimeout(() => input?.focus(), 30);
    };
    return createFolderModalEl;
  }

  function openCreateFolderDialog(opts = {}) {
    ensureCreateFolderModal().open(opts);
  }

  async function renameProjectInline(project, nextName) {
    const trimmed = String(nextName || "").trim();
    if (!project?.id || !trimmed || trimmed === (project.name || project.id)) return false;
    try {
      const data = await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const projects = getProjects();
      const local = projects.find((p) => p.id === project.id);
      if (local) local.name = data?.name || trimmed;
      project.name = data?.name || trimmed;
      document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      return true;
    } catch (err) {
      alert(err.message || "Could not rename project");
      return false;
    }
  }

  function ensureEditFolderModal() {
    if (editFolderModalEl) return editFolderModalEl;
    editFolderModalEl = document.createElement("div");
    editFolderModalEl.className = "auth-modal hidden";
    editFolderModalEl.id = "folder-edit-modal";
    editFolderModalEl.setAttribute("role", "dialog");
    editFolderModalEl.setAttribute("aria-modal", "true");
    editFolderModalEl.innerHTML = `
      <div class="auth-backdrop" data-edit-folder-close></div>
      <div class="auth-card app-dialog-card folder-edit-card">
        <button type="button" class="auth-close" data-edit-folder-close aria-label="Close">&times;</button>
        <h2 class="app-dialog-title" id="folder-edit-title">Edit folder</h2>
        <p class="muted small folder-edit-hint">Rename this folder and manage the projects inside it.</p>
        <label class="app-dialog-label">Folder name
          <input type="text" id="folder-edit-name" maxlength="120" />
        </label>
        <div class="folder-edit-projects-head">
          <strong>Projects in this folder</strong>
          <span class="muted small" id="folder-edit-count"></span>
        </div>
        <ul class="folder-edit-project-list" id="folder-edit-project-list"></ul>
        <p id="folder-edit-status" class="muted small"></p>
        <p id="folder-edit-error" class="auth-error hidden"></p>
        <div class="app-dialog-actions">
          <button type="button" class="btn secondary" data-edit-folder-close>Cancel</button>
          <button type="button" class="btn accent" id="folder-edit-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(editFolderModalEl);
    let editTarget = null;

    const close = () => {
      editFolderModalEl.classList.add("hidden");
      editTarget = null;
    };

    editFolderModalEl.querySelectorAll("[data-edit-folder-close]").forEach((el) => {
      el.addEventListener("click", close);
    });

    editFolderModalEl.querySelector("#folder-edit-save")?.addEventListener("click", async () => {
      const folder = editTarget;
      const teamId = getWorkspaceId();
      const input = editFolderModalEl.querySelector("#folder-edit-name");
      const errEl = editFolderModalEl.querySelector("#folder-edit-error");
      const statusEl = editFolderModalEl.querySelector("#folder-edit-status");
      const listEl = editFolderModalEl.querySelector("#folder-edit-project-list");
      const next = input?.value?.trim();
      if (!folder || !teamId) {
        close();
        return;
      }
      errEl?.classList.add("hidden");
      if (!next) {
        if (errEl) {
          errEl.textContent = "Folder name is required";
          errEl.classList.remove("hidden");
        }
        return;
      }

      const folderNameChanged = next !== folder.name;
      const projectRenames = [];
      const rows = [...(listEl?.querySelectorAll(".folder-edit-project-row") || [])];
      for (const row of rows) {
        const projectId = row.getAttribute("data-project-id");
        const project = projectsInFolder(folder.id).find((p) => p.id === projectId)
          || getProjects().find((p) => p.id === projectId);
        if (!project) continue;
        const nameInput = row.querySelector(".folder-edit-project-name");
        const trimmed = String(nameInput?.value || "").trim();
        if (!trimmed) {
          if (errEl) {
            errEl.textContent = "Project name is required";
            errEl.classList.remove("hidden");
          }
          nameInput?.focus();
          return;
        }
        if (trimmed !== (project.name || project.id)) {
          projectRenames.push({ project, nextName: trimmed });
        }
      }

      if (!folderNameChanged && !projectRenames.length) {
        close();
        render();
        return;
      }

      try {
        if (statusEl) statusEl.textContent = "Saving…";
        if (folderNameChanged) {
          await api(`/api/teams/${teamId}/folders/${folder.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: next }),
          });
          folder.name = next;
        }
        for (const { project, nextName } of projectRenames) {
          const ok = await renameProjectInline(project, nextName);
          if (!ok) {
            if (statusEl) statusEl.textContent = "";
            return;
          }
        }
        close();
        await refreshFolders();
        render();
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      } catch (err) {
        if (statusEl) statusEl.textContent = "";
        if (errEl) {
          errEl.textContent = err.message || "Could not save changes";
          errEl.classList.remove("hidden");
        }
      }
    });

    function renderProjectRows(folder) {
      const listEl = editFolderModalEl.querySelector("#folder-edit-project-list");
      const countEl = editFolderModalEl.querySelector("#folder-edit-count");
      const projects = projectsInFolder(folder.id);
      if (countEl) countEl.textContent = `${projects.length}`;
      if (!listEl) return;
      if (!projects.length) {
        listEl.innerHTML = `<li class="folder-edit-empty muted small">No projects in this folder yet.</li>`;
        return;
      }
      listEl.innerHTML = projects
        .map(
          (p) => `
        <li class="folder-edit-project-row" data-project-id="${escapeHtml(p.id)}">
          <input type="text" class="folder-edit-project-name" value="${escapeHtml(p.name || p.id)}" maxlength="120" aria-label="Project name" />
          <div class="folder-edit-project-actions">
            <button type="button" class="btn secondary btn-compact" data-edit-remove title="Remove from folder">Remove</button>
          </div>
        </li>`
        )
        .join("");

      listEl.querySelectorAll(".folder-edit-project-row").forEach((row) => {
        const projectId = row.getAttribute("data-project-id");
        const project = projects.find((p) => p.id === projectId);
        if (!project) return;
        const nameInput = row.querySelector(".folder-edit-project-name");
        nameInput?.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          editFolderModalEl.querySelector("#folder-edit-save")?.click();
        });
        row.querySelector("[data-edit-remove]")?.addEventListener("click", async () => {
          if (!window.confirm(`Remove “${project.name || project.id}” from this folder?\n\nIt will move to ${rootFolderLabel()}.`)) return;
          await moveProjectToFolder(project.id, null);
          renderProjectRows(folder);
        });
      });
    }

    editFolderModalEl.openFor = (folder) => {
      editTarget = folder;
      editFolderModalEl.querySelector("#folder-edit-title").textContent = `Edit “${folder.name}”`;
      editFolderModalEl.querySelector("#folder-edit-name").value = folder.name;
      editFolderModalEl.querySelector("#folder-edit-error")?.classList.add("hidden");
      const statusEl = editFolderModalEl.querySelector("#folder-edit-status");
      if (statusEl) statusEl.textContent = "";
      renderProjectRows(folder);
      editFolderModalEl.classList.remove("hidden");
      editFolderModalEl.querySelector("#folder-edit-name")?.focus();
      editFolderModalEl.querySelector("#folder-edit-name")?.select();
    };
    return editFolderModalEl;
  }

  function openEditFolderDialog(folder) {
    ensureEditFolderModal().openFor(folder);
  }

  async function createProjectInFolder(folder) {
    const folderId = folder?.id || null;
    collapsedFolders.delete(folderStorageId(folderId));
    saveIdSet(FOLDER_COLLAPSE_KEY, collapsedFolders);
    render();
    try {
      if (typeof onCreateProjectInFolder === "function") {
        await onCreateProjectInFolder(folderId);
      } else {
        const teamId = resolveTeamId() || "";
        const qs = teamId ? `?team_id=${encodeURIComponent(teamId)}` : "";
        const { project_id } = await api(`/api/projects${qs}`, {
          method: "POST",
        });
        if (folderId) {
          await api(`/api/projects/${project_id}/folder`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder_id: folderId }),
          });
        }
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      }
      void refreshFolders().then(() => render());
    } catch (err) {
      alert(err.message || "Could not create project");
    }
  }

  function buildFolderNewProjectBtn(folder) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-icon btn-folder-new-project";
    const label = folder?.id ? `New project in ${folder.name}` : "New project";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.textContent = "+";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void createProjectInFolder(folder);
    });
    return btn;
  }

  function projectsInFolder(folderId) {
    const projects = getProjects();
    const folderIds = new Set(folders.map((f) => f.id));
    const list = folderId == null
      ? projects.filter((p) => !p.folder_id || !folderIds.has(p.folder_id))
      : projects.filter((p) => p.folder_id === folderId);
    return sortProjectsForDisplay(list, { recencyFirst: folderId == null });
  }

  function folderHasExpandedProjects(folderId) {
    return projectsInFolder(folderId).some((p) => {
      if (isProjectExpanded(p.id)) return true;
      return ["components", "references", "renders", "wiring"].some((sectionId) => sectionExpanded(p.id, sectionId));
    });
  }

  function collapseAllProjectsInFolder(folderId) {
    let changed = false;
    for (const p of projectsInFolder(folderId)) {
      if (!forceCollapsedProjects.has(p.id)) {
        forceCollapsedProjects.add(p.id);
        changed = true;
      }
      if (expandedProjects.has(p.id)) {
        expandedProjects.delete(p.id);
        changed = true;
      }
      for (const sectionId of ["components", "references", "renders", "wiring"]) {
        const key = `${p.id}:${sectionId}`;
        if (!expandedSections.has(key) || expandedSections.get(key) !== false) {
          expandedSections.set(key, false);
          changed = true;
        }
      }
    }
    if (changed) {
      saveIdSet(PROJECT_EXPAND_KEY, expandedProjects);
      render();
    }
  }

  function showFolderContextMenu(e, folder) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    closeContextMenu();
    const folderId = folder?.id ?? null;
    const caps = folderMenuCapabilities(folder);
    const {
      canManage,
      sharedTeamId,
      folderTeamId,
      sharedTeam,
      folderTeam,
      isSharedTarget,
      canInviteShared,
      canManageSharedPerms,
      canLeaveShare,
      showLeaveWorkspace,
    } = caps;
    const inFolder = projectsInFolder(folderId);
    const canCollapseAll = inFolder.length > 0 && folderHasExpandedProjects(folderId);
    const leaveWorkspaceLabel = folderTeam?.name || sharedTeam?.name
      ? `Leave ${folderTeam?.name || sharedTeam?.name}…`
      : "Leave workspace…";

    const canCreateHere = !folder || canManage;
    let html = "";
    if (canCreateHere) {
      html += `<button type="button" data-action="new-project">${folder?.id ? "New project in this folder" : "New project"}</button>`;
    }
    if (inFolder.length) {
      html += `<button type="button" data-action="collapse-all"${canCollapseAll ? "" : " disabled"}>Collapse all projects</button>`;
      if (canManage || isSharedTarget || showLeaveWorkspace || canLeaveShare) html += `<hr />`;
    } else if (canCreateHere && (canManage || isSharedTarget || showLeaveWorkspace || canLeaveShare)) {
      html += `<hr />`;
    }
    if (isSharedTarget) {
      if (canInviteShared) {
        html += `<button type="button" data-action="invite-workspace">Invite people…</button>`;
      }
      if (showLeaveWorkspace) {
        html += `<button type="button" data-action="leave-workspace">${escapeHtml(leaveWorkspaceLabel)}</button>`;
      }
      if (canManageSharedPerms) {
        html += `<button type="button" data-action="manage-workspace-perms">Member permissions…</button>`;
      }
      if (html && (canManage || canLeaveShare || canArchiveFolder(folder))) html += `<hr />`;
    } else if (showLeaveWorkspace || canLeaveShare) {
      if (canLeaveShare) {
        html += `<button type="button" data-action="leave-folder">Leave folder</button>`;
      }
      if (showLeaveWorkspace) {
        html += `<button type="button" data-action="leave-workspace">${escapeHtml(leaveWorkspaceLabel)}</button>`;
      }
      if (html && (canManage || canArchiveFolder(folder))) html += `<hr />`;
    }
    if (canManage) {
      html += `
      <button type="button" data-action="edit">Edit folder…</button>
      <hr />
      <button type="button" data-action="share">Share folder…</button>
      <button type="button" data-action="rename">Rename folder…</button>
      <button type="button" data-action="delete">Delete folder</button>
    `;
    }
    if (folder && canArchiveFolder(folder)) {
      if (html && !html.trimEnd().endsWith("<hr />")) html += `<hr />`;
      html += `<button type="button" data-action="archive">Move to archive</button>`;
    }
    if (!html) return;

    const menu = document.createElement("div");
    menu.className = "folder-context-menu";
    menu.innerHTML = html;
    const x = e?.clientX ?? 0;
    const y = e?.clientY ?? 0;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    contextMenu = menu;

    menu.querySelector('[data-action="collapse-all"]')?.addEventListener("click", () => {
      closeContextMenu();
      collapseAllProjectsInFolder(folderId);
    });
    menu.querySelector('[data-action="invite-workspace"]')?.addEventListener("click", () => {
      closeContextMenu();
      void onInviteWorkspace?.(sharedTeamId, sharedTeam);
    });
    menu.querySelector('[data-action="leave-workspace"]')?.addEventListener("click", () => {
      closeContextMenu();
      const leaveId = isSharedTarget ? sharedTeamId : folderTeamId;
      const leaveTeam = isSharedTarget ? sharedTeam : folderTeam;
      void onLeaveWorkspace?.(leaveId, leaveTeam);
    });
    menu.querySelector('[data-action="leave-folder"]')?.addEventListener("click", async () => {
      closeContextMenu();
      const userId = caps.myId;
      const teamId = folderTeamId;
      if (!folder?.id || !userId || !teamId) return;
      if (!window.confirm(`Leave folder “${folder.name}”? It will disappear from your explorer.`)) return;
      try {
        await api(`/api/teams/${encodeURIComponent(teamId)}/folders/${folder.id}/shares/${encodeURIComponent(userId)}`, {
          method: "DELETE",
        });
        await refreshFolders();
        render();
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      } catch (err) {
        alert(err.message || "Could not leave folder");
      }
    });
    menu.querySelector('[data-action="manage-workspace-perms"]')?.addEventListener("click", () => {
      closeContextMenu();
      void onManageWorkspacePermissions?.(sharedTeamId, sharedTeam);
    });
    menu.querySelector('[data-action="new-project"]')?.addEventListener("click", () => {
      closeContextMenu();
      void createProjectInFolder(folder);
    });
    menu.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
      closeContextMenu();
      openEditFolderDialog(folder);
    });
    menu.querySelector('[data-action="share"]')?.addEventListener("click", () => {
      closeContextMenu();
      openShareDialog(folder);
    });
    menu.querySelector('[data-action="rename"]')?.addEventListener("click", () => {
      closeContextMenu();
      openRenameDialog(folder);
    });
    menu.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      closeContextMenu();
      if (!window.confirm(`Delete folder "${folder.name}"? Projects inside will move to ${rootFolderLabel()}.`)) return;
      const teamId = folderTeamId || getWorkspaceId();
      try {
        await api(`/api/teams/${encodeURIComponent(teamId)}/folders/${folder.id}`, { method: "DELETE" });
        restoreArchivedFolder(folder.id);
        await refreshFolders();
        render();
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      } catch (err) {
        alert(err.message || "Could not delete folder");
      }
    });
    menu.querySelector('[data-action="archive"]')?.addEventListener("click", () => {
      closeContextMenu();
      archiveFolderEntry(folder);
      render();
    });
  }

  function showArchiveFolderContextMenu(e, entry) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "folder-context-menu archive-folder-context-menu";
    menu.innerHTML = `
      <button type="button" data-action="restore">Restore to workspace</button>
      <button type="button" data-action="remove">Remove from archive</button>
    `;
    const x = e?.clientX ?? 0;
    const y = e?.clientY ?? 0;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    contextMenu = menu;
    menu.querySelector('[data-action="restore"]')?.addEventListener("click", () => {
      closeContextMenu();
      restoreArchivedFolder(entry.id);
      render();
    });
    menu.querySelector('[data-action="remove"]')?.addEventListener("click", () => {
      closeContextMenu();
      restoreArchivedFolder(entry.id);
      render();
    });
  }

  function renderArchiveSection(parent, { searching = false, query = "", multiWorkspace = false } = {}) {
    const archived = loadArchivedFolders();
    if (!archived.length) return;

    const visibleArchived = searching
      ? archived.filter((entry) => String(entry.name || "").toLowerCase().includes(query))
      : archived;
    if (!visibleArchived.length) return;

    appendFolderGroupLabel(parent, "Archive", { breakBefore: true });

    const archiveCollapsed = searching ? false : isArchiveSectionCollapsed();
    const zone = document.createElement("section");
    zone.className = "folder-zone folder-zone-archive";
    if (archiveCollapsed) zone.classList.add("folder-zone-collapsed");
    zone.dataset.folderId = ARCHIVE_SECTION_ID;

    const header = document.createElement("header");
    header.className = "folder-header folder-header-archive";
    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "folder-collapse-btn";
    collapseBtn.setAttribute("aria-expanded", archiveCollapsed ? "false" : "true");
    collapseBtn.title = archiveCollapsed ? "Expand archive" : "Collapse archive";
    collapseBtn.textContent = archiveCollapsed ? "▸" : "▾";
    collapseBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setArchiveSectionCollapsed(!archiveCollapsed);
      render();
    });
    header.append(
      collapseBtn,
      Object.assign(document.createElement("span"), { className: "folder-icon", textContent: "🗃" }),
      Object.assign(document.createElement("span"), { className: "folder-title", textContent: "Archived folders" }),
      Object.assign(document.createElement("span"), {
        className: "folder-count muted small",
        textContent: `${visibleArchived.length}`,
      })
    );
    header.title = "Click a folder to restore it to Projects";
    zone.appendChild(header);

    if (!archiveCollapsed) {
      const list = document.createElement("ul");
      list.className = "project-list archive-folder-list";
      for (const entry of visibleArchived) {
        const li = document.createElement("li");
        li.className = "archive-folder-item";
        const wsMeta = entry.team_id ? getWorkspaceMeta?.(entry.team_id) : null;
        const wsTag =
          multiWorkspace && wsMeta?.label
            ? `<span class="folder-workspace-tag" title="Workspace">${escapeHtml(wsMeta.label)}</span>`
            : "";
        const when = entry.archived_at
          ? `<span class="archive-folder-when muted small">${escapeHtml(new Date(entry.archived_at).toLocaleDateString())}</span>`
          : "";
        li.innerHTML = `
          <button type="button" class="archive-folder-restore" title="Restore ${escapeHtml(entry.name)} to Projects">
            <span class="archive-folder-icon" aria-hidden="true">📂</span>
            <span class="archive-folder-name">${escapeHtml(entry.name)}</span>
            ${wsTag}
            ${when}
            <span class="archive-folder-action muted small">Restore</span>
          </button>
        `;
        li.querySelector(".archive-folder-restore")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          restoreArchivedFolder(entry.id);
          render();
        });
        li.addEventListener("contextmenu", (ev) => showArchiveFolderContextMenu(ev, entry));
        list.appendChild(li);
      }
      zone.appendChild(list);
    }

    parent.appendChild(zone);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hierarchyEntryKey(project, sectionId, entry) {
    if (sectionId === "components" || sectionId === "vr_creations") {
      return entry?.id || entry?.stem || entry?.name?.replace(/\.[^.]+$/, "") || entry?.name || "";
    }
    return entry?.id || entry?.stem || entry?.filename || entry?.name || "";
  }

  function explorerIdToken(project, sectionId, entry) {
    const pid = project?.id || "";
    const key = hierarchyEntryKey(project, sectionId, entry);
    const kind =
      sectionId === "components" || sectionId === "vr_creations"
        ? "component"
        : sectionId === "references"
          ? (/\.dxf$/i.test(String(entry?.name || "")) || entry?.format === "dxf" ? "dxf" : "reference")
          : sectionId === "sketches"
            ? "sketch"
            : sectionId === "wiring"
              ? "wiring"
              : sectionId;
    return `${kind}:${pid}:${key}`;
  }

  function projectExplorerId(project) {
    return `project:${project?.id || ""}`;
  }

  function shortExplorerIdLabel(token) {
    const parts = String(token || "").split(":");
    if (parts[0] === "project") return `#${parts[1] || ""}`;
    const key = parts.slice(2).join(":") || parts[parts.length - 1] || "";
    return key.length > 22 ? `#${key.slice(0, 10)}…${key.slice(-8)}` : `#${key}`;
  }

  async function copyExplorerId(text) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else window.prompt("Copy ID", text);
    } catch {
      window.prompt("Copy ID", text);
    }
  }

  function componentPayload(project, entry, { stem, stored, recognized, wiringType } = {}) {
    const safeStem = stem || entry.stem || entry.name.replace(/\.[^.]+$/, "");
    const safeStored = stored || getPartProfile?.(safeStem) || null;
    const safeRecognized = recognized || recognizePart(safeStem);
    const safeWiringType = wiringType || safeStored?.wiring_type || null;
    return {
      type: "component",
      projectId: project?.id || null,
      projectName: project?.name || project?.id || "Project",
      name: entry.name,
      filename: entry.name,
      stem: safeStem,
      format: entry.format,
      viewer_filename: entry.viewer_filename,
      label: safeStored?.label || hierarchyDisplayName(entry),
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

  function hierarchySelectionKey(project, sectionId, entry) {
    const id =
      sectionId === "sketches"
        ? (entry.filename || entry.name || entry.id || entry.stem)
        : (entry.name || entry.id || entry.stem);
    return `${project?.id || ""}:${sectionId}:${id}`;
  }

  function trackHierarchySelectKey(key) {
    if (key && !visibleHierarchyOrder.includes(key)) visibleHierarchyOrder.push(key);
  }

  function applySingleHierarchySelection(key) {
    selectedHierarchyKeys.clear();
    if (key) selectedHierarchyKeys.add(key);
    hierarchySelectionAnchor = key || null;
  }

  function applyToggleHierarchySelection(key) {
    if (!key) return;
    if (selectedHierarchyKeys.has(key)) selectedHierarchyKeys.delete(key);
    else selectedHierarchyKeys.add(key);
    hierarchySelectionAnchor = key;
  }

  function applyRangeHierarchySelection(key) {
    const pid = String(key || "").split(":")[0];
    const ordered = pid
      ? visibleHierarchyOrder.filter((row) => String(row).startsWith(`${pid}:`))
      : visibleHierarchyOrder;
    const anchor = hierarchySelectionAnchor && ordered.includes(hierarchySelectionAnchor)
      ? hierarchySelectionAnchor
      : key;
    const keys = keysInVisibleRange(ordered, anchor, key);
    selectedHierarchyKeys.clear();
    for (const next of keys) selectedHierarchyKeys.add(next);
    if (!hierarchySelectionAnchor) hierarchySelectionAnchor = key;
  }

  function applyHierarchyPointerSelection(e, key) {
    if (e?.shiftKey && (hierarchySelectionAnchor || selectedHierarchyKeys.size)) {
      applyRangeHierarchySelection(key);
      return "range";
    }
    if (e?.metaKey || e?.ctrlKey) {
      applyToggleHierarchySelection(key);
      return "toggle";
    }
    applySingleHierarchySelection(key);
    return "single";
  }

  function selectedHierarchyRecords(project = null) {
    const pid = project?.id || "";
    const out = [];
    for (const key of selectedHierarchyKeys) {
      const cached = hierarchyEntryCache.get(key);
      if (!cached?.entry) continue;
      if (pid && cached.project?.id !== pid) continue;
      out.push(cached);
    }
    return out;
  }

  function selectedHierarchyDeletable(project = null) {
    return selectedHierarchyRecords(project).filter((row) => {
      const entry = row.entry;
      if (!entry || entry.virtual_folder) return false;
      if (entry.virtual_component && !entry.source_filename && !entry.filename && entry.children?.length) return false;
      return !!(entry.name || entry.filename || entry.source_filename);
    });
  }

  function deleteSelectedHierarchy(project, entry, sectionId) {
    const selected = selectedHierarchyDeletable(project);
    if (selected.length > 1 && typeof onDeleteHierarchyItems === "function") {
      onDeleteHierarchyItems(project, selected.map((row) => ({ entry: row.entry, sectionId: row.sectionId })));
      return;
    }
    onDeleteHierarchyItem?.(project, entry, sectionId);
  }

  function hierarchyPayload(project, sectionId, entry, extras = {}) {
    if (sectionId === "components" || sectionId === "vr_creations") {
      return componentPayload(project, entry, extras);
    }
    const filename = entry.filename || entry.name;
    const stem = entry.stem || entry.id || String(filename || entry.name || sectionId).replace(/\.[^.]+$/, "");
    return {
      type:
        sectionId === "references"
          ? (/\.dxf$/i.test(String(filename || "")) || entry.format === "dxf" ? "dxf" : "reference")
          : sectionId === "sketches"
            ? "sketch"
            : "wiring",
      projectId: project?.id || null,
      projectName: project?.name || project?.id || "Project",
      name: entry.name,
      filename,
      stem,
      format: entry.format || sectionId,
      label: hierarchyDisplayName(entry),
    };
  }

  function selectedHierarchyPayloads(fallbackPayload) {
    const selected = [];
    for (const key of selectedHierarchyKeys) {
      const cached = hierarchyEntryCache.get(key);
      if (!cached) continue;
      const { project, sectionId, entry } = cached;
      const stem = entry.stem || entry.name?.replace(/\.[^.]+$/, "");
      const stored = sectionId === "components" ? (getPartProfile?.(stem) || null) : null;
      const recognized = sectionId === "components" ? recognizePart(stem) : null;
      const wiringType = stored?.wiring_type || null;
      selected.push(hierarchyPayload(project, sectionId, entry, { stem, stored, recognized, wiringType }));
    }
    if (!selected.length && fallbackPayload) return [fallbackPayload];
    return selected;
  }

  function setHierarchyDragData(e, payloads) {
    setExplorerDragData(e, payloads);
  }

  function publicModelMenuHtml(project, { signedIn } = {}) {
    const login = (action) => onlineModelsNeedsLogin(action, { signedIn });
    return `
      <div class="component-context-title">
        <strong>${escapeHtml(project?.name || project?.id || "Project")}</strong>
        <span>${escapeHtml(projectExplorerId(project))}</span>
      </div>
      ${login("remix")
        ? `<button type="button" data-action="login" data-pending="remix">Log in to remix</button>`
        : `<button type="button" data-action="remix">Remix</button>`}
      ${login("download")
        ? `<button type="button" data-action="login" data-pending="download">Log in to download</button>`
        : `<button type="button" data-action="download">Download file</button>`}
      <button type="button" data-action="prompt-history">View prompt history</button>
      ${login("share")
        ? `<button type="button" data-action="login" data-pending="share">Log in to share</button>`
        : `<button type="button" data-action="share-public">Share</button>`}
      <button type="button" data-action="copy-link">Copy link</button>
      ${login("send-to")
        ? `<button type="button" data-action="login" data-pending="send-to">Log in to Send to…</button>`
        : `<button type="button" data-action="send-to-person">Send to person…</button>
           <button type="button" data-action="send-to-team">Send to team…</button>
           <button type="button" data-action="send-to-workspace">Send to workspace…</button>`}
      ${login("add-new-project")
        ? `<button type="button" data-action="login" data-pending="add-new-project">Log in to add to a project</button>`
        : `<button type="button" data-action="add-new-project">Add to a new project</button>
           <button type="button" data-action="add-current-project">Add to current project</button>`}
      ${typeof onPinPublicProject === "function" && (typeof canPinToPublic === "function" ? canPinToPublic(project) : true)
        ? `<button type="button" data-action="pin-public">${project?.public_pinned ? "Unpin from public" : "Pin to public"}</button>`
        : ""}
    `;
  }

  function showProjectContextMenu(e, project) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    closeContextMenu();
    const idToken = projectExplorerId(project);
    const readOnly = !!project?.read_only_project;
    const canDelete = !readOnly || !!canDeleteProject?.(project);
    const sharedWithMe = !!project?.shared_with_me;
    const me = getCurrentUserId?.();
    const canShare =
      !readOnly
      && !project?.public
      && !sharedWithMe
      && (!!me && (project?.owner_user_id === me || project?.created_by === me));
    const coarse = window.matchMedia?.("(pointer: coarse)").matches
      || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    const canIncognito =
      !readOnly
      && !project?.public
      && !sharedWithMe
      && (!!me && (project?.owner_user_id === me || project?.created_by === me));
    const incognitoOn = !!project?.incognito;
    const publicRow = isPublicSidebarProject(project);
    const menu = document.createElement("div");
    menu.className = `folder-context-menu project-context-menu${coarse ? " project-context-menu--mobile" : ""}`;
    menu.innerHTML = publicRow
      ? publicModelMenuHtml(project, { signedIn: signedInForPublic() })
      : `
      <div class="component-context-title">
        <strong>${escapeHtml(project?.name || project?.id || "Project")}</strong>
        <span>${escapeHtml(idToken)}${incognitoOn ? " · Incognito" : ""}</span>
      </div>
      <button type="button" data-action="export">Export / share…</button>
      ${typeof onAddToScene === "function" ? `<button type="button" data-action="add-scene">Add to scene</button>` : ""}
      ${canIncognito
        ? `<button type="button" data-action="incognito">${incognitoOn ? "Disable Incognito mode" : "Enable Incognito mode"}</button>`
        : `<button type="button" data-action="open">Open project</button>`}
      <button type="button" data-action="copy-id">Copy project ID</button>
      ${canShare && !incognitoOn ? `<button type="button" data-action="share">Share with teammate…</button>` : ""}
      ${sharedWithMe ? `<button type="button" data-action="leave-share">Remove from my folder</button>` : ""}
      ${readOnly || project?.public ? "" : `<button type="button" data-action="move">Move to…</button>`}
      ${readOnly || project?.public || incognitoOn ? "" : `<button type="button" data-action="make-public">Make public</button>`}
      ${canShowPersonalPin(project)
        ? `<button type="button" data-action="pin-personal">${isUserPinnedProject(project) ? "Unpin from projects" : "Pin to projects"}</button>`
        : ""}
      ${typeof onPinPublicProject === "function" && (typeof canPinToPublic === "function" ? canPinToPublic(project) : true) && !incognitoOn
        ? `<button type="button" data-action="pin-public">${project?.public_pinned ? "Unpin from public" : "Pin to public"}</button>`
        : ""}
      ${readOnly ? "" : `<button type="button" data-action="rename">Rename…</button>`}
      ${canDelete ? `<hr />
      <button type="button" data-action="delete">Delete project</button>` : ""}
    `;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    let left = Math.min(e.clientX || 16, window.innerWidth - rect.width - 8);
    let top = Math.min(e.clientY || 16, window.innerHeight - rect.height - 8);
    if (coarse) {
      // Prefer a bottom-sheet style menu on phones so thumbs can reach Export.
      left = Math.max(8, (window.innerWidth - rect.width) / 2);
      top = Math.max(8, window.innerHeight - rect.height - 16);
    }
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    contextMenu = menu;
    setProjectContextMenuOpen(true);

    menu.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest("button");
      const action = btn?.dataset?.action;
      if (!action) return;
      if (action === "move") {
        ev.stopPropagation();
        openMoveProjectSubmenu(btn, project);
        return;
      }
      closeContextMenu();
      if (action === "login") {
        onLoginForPublicAction?.({ action: btn.dataset.pending, projectId: project.id });
      } else if (action === "remix" || action === "download" || action === "prompt-history"
        || action === "copy-link" || action === "share-public"
        || action === "send-to-person" || action === "send-to-team" || action === "send-to-workspace"
        || action === "add-new-project" || action === "add-current-project") {
        runPublicModelAction(action === "share-public" ? "share" : action, project);
      } else if (action === "open") {
        onOpenProject?.(project.id);
      } else if (action === "incognito") {
        await onToggleIncognitoProject?.(project);
      } else if (action === "copy-id") {
        await copyExplorerId(idToken);
      } else if (action === "share") {
        await projectShareDialog.open(project);
      } else if (action === "leave-share") {
        try {
          await projectShareDialog.leave(project);
        } catch (err) {
          alert(err.message || "Could not remove shared project");
        }
      } else if (action === "export") {
        onExportProject?.(project);
      } else if (action === "add-scene") {
        onAddToScene?.(project, null, "project");
      } else if (action === "make-public") {
        onMakePublicProject?.(project);
      } else if (action === "pin-personal") {
        onTogglePersonalPin?.(project);
      } else if (action === "pin-public") {
        onPinPublicProject?.(project);
      } else if (action === "rename") {
        onRenameProject?.(project);
      } else if (action === "delete") {
        onDeleteProject?.(project);
      }
    });
  }

  function showHierarchyItemContextMenu(e, project, entry, sectionId, payload = null) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    closeContextMenu();
    const rowKey = hierarchySelectionKey(project, sectionId, entry);
    if (!selectedHierarchyKeys.has(rowKey)) applySingleHierarchySelection(rowKey);
    const isFolder = !!entry?.virtual_folder;
    const folderImage = isFolder ? pickBrowserFolderImage(entry) : null;
    const folderBoard = editableCanvasBoard(entry);
    const shareFile = isFolder ? folderShareEntry(entry) : null;
    const canOpenVideo = entryOpensInVideoEditor(entry) && typeof onOpenVideoEditor === "function";
    const canOpenCode = isFolder && folderOpensInCodeEditor(entry)
      && typeof onOpenCodeFolder === "function";
    if (isFolder && !folderBoard && !folderImage && !shareFile && !canOpenCode && !canOpenVideo) return;
    const idToken = explorerIdToken(project, sectionId, entry);
    const kindLabel =
      sectionId === "components"
        ? "component"
        : sectionId === "references"
          ? "reference file"
          : sectionId === "renders"
            ? "render"
            : sectionId === "imagine"
              ? "Imagine file"
            : sectionId === "sketches"
              ? "sketch"
              : sectionId === "wiring"
                ? "wiring"
                : "item";
    const canDelete =
      !isFolder
      && (sectionId === "references" || sectionId === "renders" || sectionId === "robots" || sectionId === "imagine")
      && !!entry?.name
      && typeof onDeleteHierarchyItem === "function";
    const canRename =
      !isFolder
      && (sectionId === "references" || sectionId === "renders" || sectionId === "robots" || sectionId === "imagine")
      && !!entry?.name
      && typeof onRenameHierarchyItem === "function";
    const canShare =
      !isFolder
      && (sectionId === "references" || sectionId === "renders" || sectionId === "imagine")
      && !!entry?.name
      && !(entry.format === "dxf" || /\.dxf$/i.test(String(entry.name || "")))
      && typeof onReferenceShareAction === "function";
    const canDownload = isBrowserDirectDownloadEntry(entry, sectionId) || entry?.catalog_hardware || !!folderImage || !!shareFile;
    const canExportCad = isBrowserCadExportEntry(entry, sectionId === "bodies" ? "components" : sectionId)
      && typeof onExportHierarchyItem === "function";
    const menu = document.createElement("div");
    menu.className = "folder-context-menu component-context-menu";
    menu.innerHTML = `
      <div class="component-context-title">
        <strong>${escapeHtml(hierarchyDisplayName(entry))}</strong>
        <span>${escapeHtml(idToken)}</span>
      </div>
      <button type="button" data-action="copy-id">Copy ${kindLabel} ID</button>
      ${folderBoard ? `<button type="button" data-action="open-canvas">Open canvas</button>` : ""}
      ${canOpenVideo ? `<button type="button" data-action="open-video">Open in video editor</button>` : ""}
      ${canOpenCode ? `<button type="button" data-action="open-code">Open in code editor</button>` : ""}
      ${isFolder ? "" : `<button type="button" data-action="open">Open / view</button>`}
      ${
        (sectionId === "references" || sectionId === "renders" || sectionId === "imagine")
        && (browserEntryIsImage(entry) || entryOpensInVideoEditor(entry))
        && !canOpenVideo
          ? `<button type="button" data-action="open-editor">Open editor</button>`
          : ""
      }
      ${
        (sectionId === "references" || sectionId === "renders" || sectionId === "imagine")
        && browserEntryIsImage(entry)
          ? `<button type="button" data-action="add-editor">Add to editor</button>`
          : ""
      }
      ${
        (sectionId === "references" || sectionId === "renders" || sectionId === "imagine") &&
        !(entry.format === "dxf" || /\.dxf$/i.test(String(entry.name || "")))
          ? `<button type="button" data-action="send-ai">Send to AI prompt</button>`
          : ""
      }
      ${canExportCad ? `<button type="button" data-action="export">${entry.virtual_body ? "Export body..." : "Export..."}</button>` : ""}
      ${canShare ? `
      <hr />
      ${browserEntryIsImage(entry) ? "" : `<button type="button" data-action="copy-link">Copy share link</button>`}
      <button type="button" data-action="share-x">Share to X…</button>
      <button type="button" data-action="share-slack">Share to Slack…</button>
      <button type="button" data-action="share-discord">Share to Discord…</button>
      <button type="button" data-action="download">Download</button>
      ${browserEntryIsImage(entry) ? "" : `<button type="button" data-action="export-share">Export / share…</button>`}
      ` : (canDownload ? `<button type="button" data-action="download">Download</button>` : "")}
      ${isFolder && shareFile ? `<button type="button" data-action="copy-link">Copy share link</button>` : ""}
      ${
        typeof onStoreListing === "function"
        && (browserEntryIsImage(entry) || /\.(stl|step|stp|glb|gltf|obj|3mf|ply|off|zip)$/i.test(String(entry?.name || entry?.filename || "")))
          ? `<button type="button" data-action="store">Add to public profile/store...</button>`
          : ""
      }
      ${canRename ? `<button type="button" data-action="rename">Rename</button>` : ""}
      ${canDelete ? `<hr /><button type="button" data-action="delete" class="danger">${selectedHierarchyDeletable(project).length > 1 ? `Delete ${selectedHierarchyDeletable(project).length} items` : `Delete ${kindLabel}`}</button>` : ""}
    `;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(e.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(e.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    contextMenu = menu;

    menu.addEventListener("click", async (ev) => {
      const action = ev.target?.closest("button")?.dataset?.action;
      if (!action) return;
      closeContextMenu();
      if (action === "copy-id") {
        await copyExplorerId(idToken);
      } else if (action === "open-canvas") {
        onOpenCanvasBoard?.(project, entry, folderBoard);
      } else if (action === "open-code") {
        onOpenCodeFolder?.(project, entry);
      } else if (action === "open") {
        onOpenHierarchyItem?.(project, entry, sectionId);
      } else if (action === "open-video" || action === "open-editor") {
        onOpenVideoEditor?.(project, videoEditorActionEntry(entry));
      } else if (action === "add-editor") {
        onAddToVideoEditor?.(project, entry);
      } else if (action === "send-ai") {
        onSendReferenceToPrompt?.(project, entry);
      } else if (action === "copy-link" || action === "share-x" || action === "share-slack" || action === "share-discord" || action === "download" || action === "export-share") {
        const shareTarget = isFolder ? (shareFile || folderImage || entry) : entry;
        if (action === "download" && !canShare) {
          onExportHierarchyItem?.(project, folderImage || shareFile || entry, ev.target);
        } else {
          onReferenceShareAction?.(project, shareTarget, sectionId, action);
        }
      } else if (action === "export") {
        onExportHierarchyItem?.(project, entry, ev.target);
      } else if (action === "store") {
        onStoreListing?.(project, entry, sectionId);
      } else if (action === "rename") {
        onRenameHierarchyItem?.(project, entry, sectionId);
      } else if (action === "delete") {
        deleteSelectedHierarchy(project, entry, sectionId);
      } else if (action === "attach" && payload) {
        onAttachWiringComponent?.(project, entry, payload);
      }
    });
  }

  function showComponentContextMenu(e, project, entry, payload) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    closeContextMenu();
    const rowKey = hierarchySelectionKey(project, "components", entry);
    if (!selectedHierarchyKeys.has(rowKey)) applySingleHierarchySelection(rowKey);

    const token = `@${payload.stem}`;
    const idToken = explorerIdToken(project, "components", entry);
    const isHidden = entry.__hidden ?? !!isHierarchyItemHidden?.(project, entry, "components");
    const isHardware = !!entry?.catalog_hardware;
    const menu = document.createElement("div");
    menu.className = "folder-context-menu component-context-menu";
    menu.innerHTML = `
      <div class="component-context-title">
        <strong>${escapeHtml(hierarchyDisplayName(entry))}</strong>
        <span>${escapeHtml(idToken)}</span>
      </div>
      <button type="button" data-action="copy-id">Copy component ID</button>
      <button type="button" data-action="open">Open / view</button>
      <button type="button" data-action="attach">Attach to Wiring Simulator</button>
      ${typeof onAddToScene === "function" ? `<button type="button" data-action="add-scene">Add to scene</button>` : ""}
      <button type="button" data-action="profile">Profile / source</button>
      <button type="button" data-action="visibility">${isHidden ? "Show object" : "Hide object"}</button>
      <button type="button" data-action="${isHardware ? "download" : "export"}">${isHardware ? "Download" : "Export component..."}</button>
      ${typeof onStoreListing === "function" && /\.(stl|step|stp|glb|gltf|obj|3mf|ply|off|zip)$/i.test(String(entry?.name || entry?.filename || payload?.filename || "")) ? `<button type="button" data-action="store">Add to public profile/store...</button>` : ""}
      <button type="button" data-action="copy">Copy ${escapeHtml(token)} reference</button>
      <button type="button" data-action="rename">Rename</button>
      <hr />
      <button type="button" data-action="delete">${selectedHierarchyDeletable(project).length > 1 ? `Delete ${selectedHierarchyDeletable(project).length} items` : "Delete component"}</button>
    `;
    if (!onExportHierarchyItem) {
      menu.querySelector('[data-action="export"]')?.setAttribute("disabled", "true");
      menu.querySelector('[data-action="download"]')?.setAttribute("disabled", "true");
    }

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(e.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(e.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    contextMenu = menu;

    menu.addEventListener("click", async (ev) => {
      const action = ev.target?.closest("button")?.dataset?.action;
      if (!action) return;
      closeContextMenu();
      if (action === "open") {
        onOpenHierarchyItem?.(project, entry, "components");
      } else if (action === "copy-id") {
        await copyExplorerId(idToken);
      } else if (action === "attach") {
        onAttachWiringComponent?.(project, entry, payload);
      } else if (action === "add-scene") {
        onAddToScene?.(project, entry, "components");
      } else if (action === "profile") {
        onOpenProfile?.(project, entry);
      } else if (action === "visibility") {
        const nextVisible = isHidden;
        entry.__hidden = !nextVisible;
        await onToggleHierarchyVisibility?.(project, entry, nextVisible, "components");
        render();
      } else if (action === "export" || action === "download") {
        onExportHierarchyItem?.(project, entry, ev.target);
      } else if (action === "store") {
        onStoreListing?.(project, entry, "components");
      } else if (action === "copy") {
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(token);
          else window.prompt("Copy component reference", token);
        } catch {
          window.prompt("Copy component reference", token);
        }
      } else if (action === "rename") {
        onRenameHierarchyItem?.(project, entry, "components");
      } else if (action === "delete") {
        deleteSelectedHierarchy(project, entry, "components");
      }
    });
  }

  function folderStorageId(folderId) {
    return folderId || "__root__";
  }

  function toggleFolderCollapse(folderId) {
    const key = folderStorageId(folderId);
    if (collapsedFolders.has(key)) collapsedFolders.delete(key);
    else collapsedFolders.add(key);
    saveIdSet(FOLDER_COLLAPSE_KEY, collapsedFolders);
  }

  function toggleProjectExpand(projectId) {
    forceCollapsedProjects.delete(projectId);
    if (expandedProjects.has(projectId)) expandedProjects.delete(projectId);
    else expandedProjects.add(projectId);
    saveIdSet(PROJECT_EXPAND_KEY, expandedProjects);
  }

  function isProjectExpanded(projectId) {
    if (forceCollapsedProjects.has(projectId)) return false;
    return expandedProjects.has(projectId);
  }

  function sectionExpanded(projectId, sectionId) {
    const key = `${projectId}:${sectionId}`;
    if (!expandedSections.has(key)) return false;
    return expandedSections.get(key);
  }

  function toggleSection(projectId, sectionId) {
    const key = `${projectId}:${sectionId}`;
    expandedSections.set(key, !sectionExpanded(projectId, sectionId));
  }

  function buildFolderCollapseBtn(folderId, isCollapsed) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "folder-collapse-btn";
    btn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    btn.title = isCollapsed ? "Expand folder" : "Collapse folder";
    btn.textContent = isCollapsed ? "▸" : "▾";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFolderCollapse(folderId);
      render();
    });
    return btn;
  }

  function attachFolderTitleToggle(titleEl, folderId) {
    titleEl.classList.add("folder-title-toggle");
    titleEl.addEventListener("click", (e) => {
      if (e.target.closest(".btn-icon, .btn-folder-menu, .btn-folder-new-project, .folder-header-actions")) return;
      toggleFolderCollapse(folderId);
      render();
    });
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

  function buildProjectHierarchy(project) {
    const browser = nestXrCreationsInBrowser(project.browser || { components: [], drawings: [], references: [], renders: [], sketches: [], wiring: [] });
    const wrap = document.createElement("div");
    wrap.className = "proj-hierarchy";

    const referenceItems = nestReferencesWithSketches(nestReferenceFolderItems([
      ...(browser.drawings || []),
      ...(browser.references || []),
    ]), browser.sketches || []);
    const renderItems = nestRendersWithImagine(browser.renders || [], browser.imagine || []);
    const sections = [
      { id: "components", label: "Components", items: browser.components || [] },
      { id: "bodies", label: "Bodies", items: browser.bodies || [] },
      { id: "references", label: "Reference Files", items: referenceItems },
      { id: "renders", label: "Renders", items: renderItems },
      { id: "wiring", label: "Wiring", items: browser.wiring || [] },
      { id: "vr_creations", label: VR_CREATIONS_FOLDER, items: browser.vr_creations || [] },
    ];

    for (const section of sections) {
      const rawItems = section.items;
      const items = section.id === "references"
        ? sortReferenceEntries(rawItems, refsSortDirection)
        : rawItems;
      if (section.id === "bodies" && !rawItems.length) continue;
      const sectionEl = document.createElement("div");
      sectionEl.className = "proj-hierarchy-section";
      sectionEl.dataset.section = section.id;

      const open = sectionExpanded(project.id, section.id);
      const head = document.createElement("div");
      head.className = "proj-hierarchy-section-head";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "proj-hierarchy-section-toggle";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.innerHTML = `
        <span class="browser-chevron">${open ? "▾" : "▸"}</span>
        <span class="proj-hierarchy-section-label">${section.label}</span>
      `;
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSection(project.id, section.id);
        render();
      });
      const count = document.createElement("span");
      count.className = "proj-hierarchy-section-count";
      const sectionCount = rawItems.length;
      count.textContent = formatTreeCount(sectionCount);
      count.title = String(treeCountValue(sectionCount));
      head.append(toggle, count);
      sectionEl.appendChild(head);

      if (open) {
        if (section.id === "vr_creations") {
          sectionEl.appendChild(buildVrCreationsGroupBy(browser));
        }
        const list = document.createElement("ul");
        list.className = "proj-hierarchy-list";
        if (!items.length) {
          const empty = document.createElement("li");
          empty.className = "proj-hierarchy-empty muted small";
          empty.textContent =
            section.id === "components"
              ? "No components"
              : section.id === "vr_creations"
                ? "Draw solids in VR — they appear here as bodies under VR Room"
              : section.id === "bodies"
                ? "No designed bodies"
              : section.id === "references"
                ? "No reference files"
                : section.id === "renders"
                  ? "No renders yet"
                : section.id === "sketches"
                  ? "No sketches"
                  : "No wiring";
          list.appendChild(empty);
        } else {
          const sectionKey = hierarchyListKey(project.id, section.id);
          const sectionShowAll = showAllHierarchySections.has(sectionKey);
          const visibleItems = visibleSlice(items, sectionKey, showAllHierarchySections);
          for (const entry of visibleItems) {
            if ((section.id === "references" || section.id === "renders") && isReferenceVirtualFolder(entry)) {
              appendReferenceFolderRow(list, project, entry, section.id, { depth: 0, viewMode: "list" });
              continue;
            }
            const item = document.createElement("li");
            item.className = "proj-hierarchy-item";
            const isComponent = section.id === "components" || section.id === "bodies" || section.id === "vr_creations";
            const isReference = section.id === "references" || section.id === "renders";
            const isDxf = section.id === "references" && (entry.format === "dxf" || /\.dxf$/i.test(String(entry.name || "")));
            const isEditableSketch = section.id === "sketches";
            const itemHidden = isComponent && (entry.__hidden ?? !!isHierarchyItemHidden?.(project, entry, section.id));
            const selectionKey = hierarchySelectionKey(project, section.id, entry);
            hierarchyEntryCache.set(selectionKey, { project, sectionId: section.id, entry });
            trackHierarchySelectKey(selectionKey);
            if (selectedHierarchyKeys.has(selectionKey)) {
              item.classList.add("proj-hierarchy-item--selected");
            }
            if (itemHidden) {
              item.classList.add("proj-hierarchy-item--hidden");
            }

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "proj-hierarchy-item-btn";

            const stem = entry.stem || entry.name.replace(/\.[^.]+$/, "");
            const recognized = isComponent ? recognizePart(stem) : null;
            const stored = isComponent ? (getPartProfile?.(stem) || null) : null;
            const wiringType = stored?.wiring_type || null;

            const displayName = hierarchyDisplayName(entry);
            const editHint = isEditableSketch ? ` <span class="proj-hierarchy-edit-hint" title="Double-click to edit">✎</span>` : "";
            const vrIcon = entry.xr_creation || entry.xr_headset
              ? ` <span class="browser-vr-icon" title="Created in VR">${vrHeadsetMini()}</span>`
              : "";
            const authorBit = (entry.xr_creation || entry.xr_body)
              ? `<span class="browser-item-author">${escapeHtml(authorHighlightText(entry))}</span>`
              : "";
            const refWhen = (isReference || isDxf) ? referenceRowTimestamp(entry) : "";
            btn.innerHTML = isReference
              ? `<span class="proj-hierarchy-item-copy"><span class="proj-hierarchy-item-name">${escapeHtml(displayName)}${vrIcon}</span>${refWhen ? `<span class="proj-hierarchy-item-time">${escapeHtml(refWhen)}</span>` : ""}</span>${editHint}${authorBit}`
              : `<span class="proj-hierarchy-item-name">${escapeHtml(displayName)}${vrIcon}</span>${editHint}${authorBit}`;
            btn.title = isEditableSketch
              ? `${displayName} — double-click to open in feature editor`
              : isDxf
              ? `${displayName} — click to open this DXF drawing preview.`
              : isCaptureBrowserEntry(entry)
              ? captureHoverTitle(entry, displayName)
              : (entry.xr_creation || entry.xr_body)
              ? `${displayName} — ${authorHighlightText(entry)}`
              : isComponent
              ? `${displayName} — double-click to frame in the viewport`
              : isReference
              ? `${displayName} — click to open this reference file.`
              : displayName;
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (suppressHierarchyClick) {
                e.preventDefault();
                return;
              }
              const mode = applyHierarchyPointerSelection(e, selectionKey);
              if (mode !== "single") {
                render();
                return;
              }
              if (itemHidden) {
                render();
                return;
              }
              onOpenHierarchyItem?.(project, entry, section.id);
            });
            if (isEditableSketch) {
              btn.addEventListener("dblclick", (e) => {
                e.preventDefault();
                e.stopPropagation();
                onEditHierarchyItem?.(project, entry, section.id);
              });
            } else if (isComponent && typeof onFrameHierarchyItem === "function") {
              btn.addEventListener("dblclick", (e) => {
                if (suppressHierarchyClick) {
                  e.preventDefault();
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                onFrameHierarchyItem(project, entry, section.id);
              });
            }
            btn.draggable = !isReference;
            item.draggable = !isReference;

            if (isComponent) {
              const visBtn = document.createElement("button");
              visBtn.type = "button";
              visBtn.className = "proj-hierarchy-vis-btn";
              visBtn.classList.toggle("is-hidden", itemHidden);
              visBtn.title = itemHidden ? "Show object" : "Hide object";
              visBtn.setAttribute("aria-label", itemHidden ? "Show object" : "Hide object");
              visBtn.setAttribute("aria-pressed", itemHidden ? "true" : "false");
              visBtn.innerHTML = hierarchyEyeSvg(itemHidden);
              visBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const nextVisible = itemHidden;
                entry.__hidden = !nextVisible;
                await onToggleHierarchyVisibility?.(project, entry, nextVisible, section.id);
                render();
              });
              item.appendChild(visBtn);

              item.classList.add("proj-hierarchy-item--component");
              const payload = componentPayload(project, entry, { stem, stored, recognized, wiringType });
              item.addEventListener("contextmenu", (e) => showComponentContextMenu(e, project, entry, payload));
              const onDragStart = (e) => {
                e.stopPropagation();
                suppressHierarchyClick = true;
                if (!selectedHierarchyKeys.has(selectionKey)) {
                  selectedHierarchyKeys.clear();
                  selectedHierarchyKeys.add(selectionKey);
                  item.classList.add("proj-hierarchy-item--selected");
                }
                setHierarchyDragData(e, selectedHierarchyPayloads(payload));
                onDragComponent?.(project, entry);
              };
              const onDragEnd = () => clearHierarchyClickSuppress();
              btn.addEventListener("dragstart", onDragStart);
              item.addEventListener("dragstart", onDragStart);
              btn.addEventListener("dragend", onDragEnd);
              item.addEventListener("dragend", onDragEnd);

              const prof = document.createElement("button");
              prof.type = "button";
              prof.className = "proj-hierarchy-profile-btn";
              prof.textContent = "ⓘ";
              prof.title = "View component ID, tags, part profile, and 3D preview";
              prof.setAttribute("aria-label", "Component info");
              prof.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenProfile?.(project, entry);
              });
              // Row order: eye → name (actions sit behind the far-right kebab).
              item.appendChild(btn);
              attachHierarchyKebab(item, hierarchyStripButtons(project, entry, section.id, [prof]));
            } else if (isReference) {
              item.appendChild(btn);
              const payload = hierarchyPayload(project, section.id, entry);
              item.classList.add(isDxf ? "proj-hierarchy-item--drawing" : "proj-hierarchy-item--reference");
              const refActions = [];
              if (!isDxf && browserEntryIsImage(entry) && !entryOpensInVideoEditor(entry)) {
                const ed = document.createElement("button");
                ed.type = "button";
                ed.className = "proj-hierarchy-editor-btn";
                ed.textContent = "Editor";
                ed.title = "Open clip editor";
                ed.addEventListener("click", (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenVideoEditor?.(project, entry);
                });
                refActions.push(ed);
              }
              attachHierarchyKebab(item, hierarchyStripButtons(project, entry, section.id, refActions));
              const openRefMenu = (ev) => showHierarchyItemContextMenu(ev, project, entry, section.id, payload);
              item.addEventListener("contextmenu", openRefMenu);
              bindLongPress(item, openRefMenu);
              bindLongPress(btn, openRefMenu);
            } else {
              item.appendChild(btn);
              const payload = hierarchyPayload(project, section.id, entry);
              item.addEventListener("contextmenu", (e) => showHierarchyItemContextMenu(e, project, entry, section.id, payload));
              const onDragStart = (e) => {
                e.stopPropagation();
                suppressHierarchyClick = true;
                if (!selectedHierarchyKeys.has(selectionKey)) {
                  selectedHierarchyKeys.clear();
                  selectedHierarchyKeys.add(selectionKey);
                  item.classList.add("proj-hierarchy-item--selected");
                }
                setHierarchyDragData(e, selectedHierarchyPayloads(payload));
                onDragComponent?.(project, entry);
              };
              const onDragEnd = () => clearHierarchyClickSuppress();
              btn.addEventListener("dragstart", onDragStart);
              item.addEventListener("dragstart", onDragStart);
              btn.addEventListener("dragend", onDragEnd);
              item.addEventListener("dragend", onDragEnd);
              attachHierarchyKebab(item, hierarchyStripButtons(project, entry, section.id));
            }

            // Bodies nest under the component row (header first, then body parts).
            if (isComponent && ((Array.isArray(entry.children) && entry.children.length) || entry.hardware?.length)) {
              const bodiesGroup = document.createElement("div");
              bodiesGroup.className = "proj-hierarchy-bodies";
              const bodiesKey = `${project.id}:${entry.name}:bodies`;
              const bodiesOpen = expandedHierarchyBodies.has(bodiesKey);
              const bodiesToggle = document.createElement("button");
              bodiesToggle.type = "button";
              bodiesToggle.className = "proj-hierarchy-bodies-toggle";
              bodiesToggle.setAttribute("aria-expanded", bodiesOpen ? "true" : "false");
              const bodyChildCount = (entry.children?.length || 0) + (entry.hardware?.length ? 1 : 0);
              bodiesToggle.innerHTML = `
                <span class="browser-chevron">${bodiesOpen ? "▾" : "▸"}</span>
                <span class="proj-hierarchy-section-label">${escapeHtml(entry.children_label || "Bodies")}</span>
                <span class="proj-hierarchy-section-count" title="${treeCountValue(bodyChildCount)}">${formatTreeCount(bodyChildCount)}</span>
              `;
              bodiesToggle.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleHierarchyBodies(bodiesKey);
                render();
              });
              bodiesGroup.appendChild(bodiesToggle);
              if (bodiesOpen) {
                const nested = document.createElement("ul");
                nested.className = "proj-hierarchy-list proj-hierarchy-list--bodies";
                for (const child of entry.children || []) {
                  if (child.virtual_folder && child.children?.length) continue;
                  const childItem = document.createElement("li");
                  childItem.className = "proj-hierarchy-item proj-hierarchy-item--body";
                  const childHidden = child.__hidden ?? !!isHierarchyItemHidden?.(project, child, section.id);
                  if (childHidden) childItem.classList.add("proj-hierarchy-item--hidden");
                  const childSelectionKey = hierarchySelectionKey(project, section.id, child);
                  hierarchyEntryCache.set(childSelectionKey, { project, sectionId: section.id, entry: child });
                  trackHierarchySelectKey(childSelectionKey);
                  if (selectedHierarchyKeys.has(childSelectionKey)) {
                    childItem.classList.add("proj-hierarchy-item--selected");
                  }

                  const childVis = document.createElement("button");
                  childVis.type = "button";
                  childVis.className = "proj-hierarchy-vis-btn";
                  childVis.classList.toggle("is-hidden", childHidden);
                  childVis.title = childHidden ? "Show body" : "Hide body";
                  childVis.setAttribute("aria-label", childHidden ? "Show body" : "Hide body");
                  childVis.setAttribute("aria-pressed", childHidden ? "true" : "false");
                  childVis.innerHTML = hierarchyEyeSvg(childHidden);
                  childVis.addEventListener("click", async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const nextVisible = childHidden;
                    child.__hidden = !nextVisible;
                    await onToggleHierarchyVisibility?.(project, child, nextVisible, section.id);
                    render();
                  });

                  const childBtn = document.createElement("button");
                  childBtn.type = "button";
                  childBtn.className = "proj-hierarchy-item-btn";
                  const childDisplayName = hierarchyDisplayName(child);
                  childBtn.innerHTML = `<span class="proj-hierarchy-body-icon" aria-hidden="true">◆</span><span class="proj-hierarchy-item-name">${escapeHtml(childDisplayName)}</span>`;
                  childBtn.title = `${child.body_name || child.label || child.name || childDisplayName} — double-click to frame in the viewport`;
                  childBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const mode = applyHierarchyPointerSelection(e, childSelectionKey);
                    if (mode !== "single") {
                      render();
                      return;
                    }
                    if (!childHidden) onOpenHierarchyItem?.(project, child, section.id);
                    render();
                  });
                  if (typeof onFrameHierarchyItem === "function") {
                    childBtn.addEventListener("dblclick", (e) => {
                      if (suppressHierarchyClick) {
                        e.preventDefault();
                        return;
                      }
                      e.preventDefault();
                      e.stopPropagation();
                      if (!childHidden) onFrameHierarchyItem(project, child, section.id);
                    });
                  }

                  childItem.append(childVis, childBtn);
                  nested.appendChild(childItem);
                }
                const nestedFolders = [
                  ...(entry.children || []).filter((child) => child?.virtual_folder && child.children?.length),
                  ...(entry.hardware?.length
                    ? [{
                        name: `${entry.name}:mcmaster-parts`,
                        label: entry.hardware_label || "McMaster Parts",
                        children_label: entry.hardware_label || "McMaster Parts",
                        virtual_folder: true,
                        catalog_hardware_folder: true,
                        children: entry.hardware,
                      }]
                    : []),
                ];
                for (const folder of nestedFolders) {
                  const folderKey = `${project.id}:${folder.name || folder.id}:hw`;
                  const folderOpen = expandedHierarchyBodies.has(folderKey);
                  const folderLi = document.createElement("li");
                  folderLi.className = "proj-hierarchy-item proj-hierarchy-item--virtual-folder";
                  const folderBtn = document.createElement("button");
                  folderBtn.type = "button";
                  folderBtn.className = "proj-hierarchy-item-btn proj-hierarchy-folder-toggle";
                  folderBtn.innerHTML = `
                    <span class="browser-chevron">${folderOpen ? "▾" : "▸"}</span>
                    <span class="proj-hierarchy-item-name">${escapeHtml(folder.children_label || folder.label || folder.name || "McMaster Parts")}</span>
                    <span class="proj-hierarchy-section-count" title="${treeCountValue(folder.children.length)}">${formatTreeCount(folder.children.length)}</span>
                  `;
                  folderBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleHierarchyBodies(folderKey);
                    render();
                  });
                  folderLi.appendChild(folderBtn);
                  nested.appendChild(folderLi);
                  if (folderOpen) {
                    for (const hw of folder.children || []) {
                      const hwItem = document.createElement("li");
                      hwItem.className = "proj-hierarchy-item proj-hierarchy-item--child";
                      const hwHidden = hw.__hidden ?? !!isHierarchyItemHidden?.(project, hw, "components");
                      if (hwHidden) hwItem.classList.add("proj-hierarchy-item--hidden");
                      const hwKey = hierarchySelectionKey(project, "components", hw);
                      hierarchyEntryCache.set(hwKey, { project, sectionId: "components", entry: hw });
                      trackHierarchySelectKey(hwKey);
                      if (selectedHierarchyKeys.has(hwKey)) hwItem.classList.add("proj-hierarchy-item--selected");
                      const hwBtn = document.createElement("button");
                      hwBtn.type = "button";
                      hwBtn.className = "proj-hierarchy-item-btn";
                      const hwName = hierarchyDisplayName(hw);
                      hwBtn.innerHTML = `<span class="proj-hierarchy-item-name">${escapeHtml(hwName)}</span>`;
                      hwBtn.title = `${hwName} — double-click to frame in the viewport`;
                      hwBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        const mode = applyHierarchyPointerSelection(e, hwKey);
                        if (mode !== "single") {
                          render();
                          return;
                        }
                        onOpenHierarchyItem?.(project, hw, "components");
                        render();
                      });
                      if (typeof onFrameHierarchyItem === "function") {
                        hwBtn.addEventListener("dblclick", (e) => {
                          if (suppressHierarchyClick) {
                            e.preventDefault();
                            return;
                          }
                          e.preventDefault();
                          e.stopPropagation();
                          onFrameHierarchyItem(project, hw, "components");
                        });
                      }
                      hwItem.appendChild(hwBtn);
                      const hwPayload = hierarchyPayload(project, "components", hw);
                      const openHwMenu = (ev) => showComponentContextMenu(ev, project, hw, hwPayload);
                      hwItem.addEventListener("contextmenu", openHwMenu);
                      const hwDl = document.createElement("button");
                      hwDl.type = "button";
                      hwDl.className = "browser-action-btn browser-action-btn--icon browser-action-download";
                      hwDl.title = "Download";
                      hwDl.setAttribute("aria-label", "Download");
                      hwDl.textContent = "↓";
                      hwDl.addEventListener("click", (e) => {
                        e.stopPropagation();
                        onExportHierarchyItem?.(project, hw, hwDl);
                      });
                      attachHierarchyKebab(hwItem, hierarchyStripButtons(project, hw, "components", [hwDl]));
                      nested.appendChild(hwItem);
                    }
                  }
                }
                bodiesGroup.appendChild(nested);
              }
              item.appendChild(bodiesGroup);
            }

            list.appendChild(item);
          }
          const more = buildShowMoreControl({
            total: section.items.length,
            shown: visibleItems.length,
            expanded: sectionShowAll,
            label: section.label.toLowerCase(),
            onToggle: () => {
              if (sectionShowAll) showAllHierarchySections.delete(sectionKey);
              else showAllHierarchySections.add(sectionKey);
              saveIdSet(HIERARCHY_SHOW_ALL_KEY, showAllHierarchySections);
              render();
            },
          });
          if (more) list.appendChild(more);
        }
        sectionEl.appendChild(list);
      }
      wrap.appendChild(sectionEl);
    }
    return wrap;
  }

  function activeGenerationForBadge(project = {}) {
    const jobs = Array.isArray(project.generation?.running_jobs) && project.generation.running_jobs.length
      ? project.generation.running_jobs
      : Array.isArray(project.generation?.jobs)
        ? project.generation.jobs.filter((job) => job?.status === "running")
        : [];
    return jobs.find((job) => String(job?.kind || "").toLowerCase() === "rigging")
      || jobs.find((job) => ["video", "film_edit", "film-edit", "video_edit"].includes(String(job?.kind || "").toLowerCase()))
      || jobs[0]
      || project.generation
      || {};
  }

  function generationVisualTone(gen = {}) {
    const kind = String(gen?.kind || "").toLowerCase();
    if (kind === "improve_lab") return "improve_lab";
    if (kind === "rigging") return "rigging";
    if (kind === "wiring") return "wiring";
    if (kind === "video" || kind === "film_edit" || kind === "film-edit" || kind === "video_edit") return "video";
    if (kind === "render" || kind === "scene_render" || kind === "render_region_edit") return "render";
    const mode = String(
      gen?.mode
      || gen?.prompt_mode
      || gen?.promptMode
      || gen?.request_body?.mode
      || gen?.request_body?.prompt_mode
      || "",
    ).toLowerCase();
    if (mode === "render" || mode === "standard") return "render";
    if ([
      "mesh", "mesh_beta", "mesh-beta", "fusion", "fusion360", "fusion-360",
      "img2threejs", "threejs",
    ].includes(mode)) {
      return "mesh";
    }
    if ([
      "v2", "2.0", "2", "cad", "jake", "vibecad", "vibe", "vibecade",
      "mac", "macad", "multi_agent_cad", "architect", "architecture",
    ].includes(mode)) {
      return "v2";
    }
    const searchable = String([
      gen?.message,
      gen?.label,
      gen?.prompt,
      gen?.progress?.label,
    ].filter(Boolean).join(" "));
    if (/\brender(?:ing)?\b|photoreal/i.test(searchable)) return "render";
    if (/\bmesh(?:[_-]?beta)?\b|img2threejs/i.test(searchable)) return "mesh";
    if (/\b(v2|2\.0|cad|jake|vibecad)\b/i.test(searchable)) return "v2";
    if (/\bfusion\b/i.test(searchable)) return "mesh";
    if (/\barchitect(?:ure)?\b/i.test(searchable)) return "v2";
    return "v2";
  }

  function isVrGeneration(gen = {}) {
    const jobs = Array.isArray(gen?.running_jobs) && gen.running_jobs.length
      ? gen.running_jobs
      : Array.isArray(gen?.jobs)
        ? gen.jobs.filter((job) => job?.status === "running")
        : [];
    const lead = jobs[0] || gen || {};
    const token = String(
      lead.client
      || gen.client
      || lead.request_body?.client
      || gen.request_body?.client
      || "",
    ).toLowerCase();
    return token === "xr" || token === "vr" || token === "headset" || token === "quest";
  }

  function generationFirstName(gen = {}, project = {}) {
    const raw = String(
      gen.by_user_name
      || project.owner_name
      || project.generated_by?.display_name
      || "Someone",
    ).trim();
    return raw.split(/\s+/)[0] || "Someone";
  }

  function generationToneChrome(tone = "", { vr = false } = {}) {
    if (tone === "improve_lab") {
      return {
        userClass: " proj-gen-user--lab",
        itemClass: "proj-item--lab-gen",
        spinnerClass: " proj-loading-spinner--lab",
        progressClass: " proj-gen-progress--lab",
        labelClass: " proj-loading-label--lab",
        badge: vr ? "VR LAB" : "LAB",
        verb: vr ? "comparing Improve Lab in VR" : "comparing Improve Lab overlays",
        loading: "Improve Lab…",
      };
    }
    if (tone === "mesh") {
      return {
        userClass: " proj-gen-user--mesh",
        itemClass: "proj-item--mesh-gen",
        spinnerClass: " proj-loading-spinner--mesh",
        progressClass: " proj-gen-progress--mesh",
        labelClass: " proj-loading-label--mesh",
        badge: vr ? "VR Mesh" : "MESH",
        verb: vr ? "generating VR Mesh" : "generating Mesh",
        loading: vr ? "VR Mesh…" : "Mesh…",
      };
    }
    if (tone === "v2") {
      return {
        userClass: " proj-gen-user--v2",
        itemClass: "proj-item--v2-gen",
        spinnerClass: " proj-loading-spinner--v2",
        progressClass: " proj-gen-progress--v2",
        labelClass: " proj-loading-label--v2",
        badge: vr ? "VR CAD" : "CAD",
        verb: vr ? "generating VR CAD" : "generating CAD",
        loading: vr ? "VR CAD…" : "CAD…",
      };
    }
    if (tone === "render") {
      return {
        userClass: " proj-gen-user--render",
        itemClass: "proj-item--render-gen",
        spinnerClass: " proj-loading-spinner--render",
        progressClass: " proj-gen-progress--render",
        labelClass: " proj-loading-label--render",
        badge: vr ? "VR Render" : "RENDER",
        verb: vr ? "generating VR Render" : "rendering",
        loading: vr ? "VR Render…" : "Rendering…",
      };
    }
    if (tone === "rigging") {
      return {
        userClass: " proj-gen-user--rigging",
        itemClass: "",
        spinnerClass: " proj-loading-spinner--rigging",
        progressClass: " proj-gen-progress--rigging",
        labelClass: " proj-loading-label--rigging",
        badge: vr ? "VR RIG" : "RIG",
        verb: vr ? "generating VR rigging" : "generating rigging",
        loading: vr ? "VR Rigging…" : "Rigging…",
      };
    }
    if (tone === "video") {
      return {
        userClass: " proj-gen-user--video",
        itemClass: "proj-item--video-gen",
        spinnerClass: " proj-loading-spinner--video",
        progressClass: " proj-gen-progress--video",
        labelClass: " proj-loading-label--video",
        badge: vr ? "VR VIDEO" : "VIDEO",
        verb: vr ? "generating VR video" : "generating video",
        loading: vr ? "VR Video…" : "Video…",
      };
    }
    return {
      userClass: "",
      itemClass: "",
      spinnerClass: "",
      progressClass: "",
      labelClass: "",
      badge: vr ? "VR AI" : "AI",
      verb: vr ? "generating with VR AI" : "generating with AI",
      loading: vr ? "VR…" : "Generating…",
    };
  }

  function generationExplorerBadge(gen = {}) {
    if (!gen || gen.status !== "running") return "";
    const name = gen.by_user_name || "Someone";
    const initial = escapeHtml(String(name).trim().charAt(0).toUpperCase() || "A");
    const avatar = gen.by_avatar_url || "";
    const tone = generationVisualTone(gen);
    const chrome = generationToneChrome(tone, { vr: isVrGeneration(gen) });
    const startedAt = gen.started_at || gen.progress?.started_at || "";
    const elapsed = formatGenerationElapsed(startedAt);
    const elapsedEl = elapsed
      ? ` · <span data-generation-started-at="${escapeHtml(startedAt)}">${escapeHtml(elapsed)}</span>`
      : "";
    const avatarEl = avatar
      ? `<span class="proj-gen-avatar proj-gen-avatar--image" style="background-image:url('${escapeHtml(avatar)}')" title="${escapeHtml(name)} ${chrome.verb}"></span>`
      : `<span class="proj-gen-avatar" title="${escapeHtml(name)} ${chrome.verb}">${initial}</span>`;
    const labIcon = tone === "improve_lab"
      ? `<span class="proj-gen-lab-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 2.5a2 2 0 012 2v1.2l.8.5A4.5 4.5 0 118 2.5zm0 0V1M6.2 3.1 5.4 1.8M9.8 3.1l.8-1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>`
      : "";
    const rigIcon = tone === "rigging"
      ? `<span class="proj-gen-rig-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 12.5h8M5 12.5V9l3-3 3 3v3.5M8 6V2.5M6.5 4h3M8 2.5l2 1.5M8 2.5 6 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`
      : "";
    const videoIcon = tone === "video"
      ? `<span class="proj-gen-video-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.2 4.2h6.4c.6 0 1 .4 1 1v5.6c0 .6-.4 1-1 1H3.2c-.6 0-1-.4-1-1V5.2c0-.6.4-1 1-1zm8.2 1.6 2.4-1.4v7.2l-2.4-1.4V5.8z" fill="currentColor"/></svg></span>`
      : "";
    return `<span class="proj-gen-user${chrome.userClass}" aria-label="${escapeHtml(name)} ${chrome.verb}">${avatarEl}${labIcon}${rigIcon}${videoIcon}<span class="proj-gen-ai${isVrGeneration(gen) ? " proj-gen-ai--vr" : ""}">${escapeHtml(chrome.badge)}${elapsedEl}</span></span>`;
  }

  function generationProgressPercent(gen = {}, fallback = {}) {
    const raw = gen?.progress?.pct ?? gen?.pct ?? fallback?.progress?.pct ?? fallback?.pct;
    const pct = Number(raw);
    if (!Number.isFinite(pct)) return null;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  function appendProjectRow(listEl, p, opts) {
    if (!listEl || !p) return;
    try {
      listEl.appendChild(buildProjectRow(p, opts));
    } catch (err) {
      console.error("project row failed:", p?.id, err);
      const li = document.createElement("li");
      li.className = "proj-item";
      if (p.id) li.dataset.projectId = p.id;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "proj-row-body";
      btn.textContent = p.name || p.id || "Project";
      btn.addEventListener("click", () => { if (p.id) onOpenProject?.(p.id); });
      li.appendChild(btn);
      listEl.appendChild(li);
    }
  }

  function buildProjectRow(p, { showHierarchy = false, forceExpand = false } = {}) {
    const li = document.createElement("li");
    li.className = "proj-item";
    li.dataset.projectId = p.id;
    const generating = isProjectGenerating?.(p.id);
    const loading = isProjectLoading?.(p.id) && !generating;
    const showSpinner = loading || generating;
    const publicCompact = isPublicSidebarProject(p);
    if (p.id === getActiveProjectId()) li.classList.add("active");
    if (showSpinner) li.classList.add("proj-item--loading");
    if (publicCompact) li.classList.add("proj-item--public-compact");
    const readOnly = !!p.read_only_project;

    const steps = p.timeline?.entries?.length || 0;
    const files = p.file_count ?? p.files?.length ?? 0;
    const when = p.updated_at
      ? new Date(p.updated_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
      : "";

    const handle = document.createElement("span");
    handle.className = "proj-drag-handle";
    handle.title = readOnly ? "Read-only render" : "Drag to reorder or move to another folder";
    handle.setAttribute("aria-hidden", "true");
    handle.draggable = !readOnly;
    handle.textContent = readOnly ? "👁" : "⠿";

    const hasHierarchy = !!showHierarchy;
    const projectOpen = hasHierarchy && (forceExpand || isProjectExpanded(p.id));

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = hasHierarchy && !forceExpand ? "proj-expand-btn" : "proj-expand-btn proj-expand-btn-spacer";
    if (!hasHierarchy || forceExpand) {
      expandBtn.disabled = true;
      expandBtn.setAttribute("aria-hidden", "true");
      expandBtn.textContent = hasHierarchy ? "▾" : " ";
    } else {
      expandBtn.setAttribute("aria-expanded", projectOpen ? "true" : "false");
      expandBtn.title = projectOpen ? "Collapse project folders" : "Expand References, Renders, Wiring";
      expandBtn.textContent = projectOpen ? "▾" : "▸";
      expandBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleProjectExpand(p.id);
        render();
      });
    }

    const thumb = document.createElement("div");
    thumb.className = "proj-thumb proj-thumb--empty";
    thumb.setAttribute("aria-hidden", "true");
    thumb.dataset.projectId = p.id;
    thumb.dataset.thumbUrl = publicCompact
      ? (publicProjectThumbUrl(p) || `/api/public/projects/${encodeURIComponent(p.id)}/thumb`)
      : (p.preview_url || `/api/projects/${encodeURIComponent(p.id)}/thumb`);
    thumb.dataset.thumbRev = projectThumbRevision(p);
    const cachedThumb = projectThumbBlobs.get(p.id);
    if (cachedThumb?.objectUrl) {
      paintCachedThumb(thumb, cachedThumb.objectUrl);
    } else {
      paintEmptyThumb(thumb);
    }
    const needsHydrate = !cachedThumb?.objectUrl
      || cachedThumb.rev !== thumb.dataset.thumbRev
      || cachedThumb.sourceUrl !== thumb.dataset.thumbUrl;
    if (needsHydrate) {
      const el = thumb;
      const observe = () => {
        if (!el.isConnected) return;
        try { ensureProjectThumbObserver()?.observe?.(el); } catch (_) {}
      };
      if (typeof requestIdleCallback === "function") requestIdleCallback(observe, { timeout: 900 });
      else requestAnimationFrame(observe);
    }

    const body = document.createElement("button");
    body.type = "button";
    body.className = "proj-row-body";
    const activeGen = activeGenerationForBadge(p);
    const activeTone = generationVisualTone(activeGen);
    const vrGen = isVrGeneration(activeGen);
    const toneChrome = generationToneChrome(activeTone, { vr: vrGen });
    const genBadge = generating && activeGen?.status === "running"
      ? generationExplorerBadge(activeGen)
      : "";
    const promptGenerating = generating && activeTone !== "wiring";
    if (toneChrome.itemClass) li.classList.add(toneChrome.itemClass);
    const spinner = showSpinner && !genBadge
      ? `<span class="proj-loading-spinner${promptGenerating ? toneChrome.spinnerClass : ""}" aria-hidden="true"></span>`
      : "";
    const promptProgress = promptGenerating ? generationProgressPercent(activeGen, p.generation) : null;
    const progressBadge = promptProgress != null
      ? `<span class="proj-gen-progress${toneChrome.progressClass}" title="${toneChrome.badge} progress: ${promptProgress}%">${promptProgress}%</span>`
      : "";
    const loadingLabel = generating
      ? `<span class="proj-loading-label${toneChrome.labelClass}">${activeTone === "video" ? "Generating AI edit clip…" : toneChrome.loading}</span>`
      : loading
        ? '<span class="proj-loading-label">Loading…</span>'
        : "";
    const projectIdToken = projectExplorerId(p);
    const projectIdLabel = shortExplorerIdLabel(projectIdToken);
    const isNew = !generating && isProjectNew?.(p.id);
    const hasRig = !!p.has_rig
      || !!(p.browser?.robots?.length)
      || String(p.generation?.kind || "").toLowerCase() === "rigging";
    const newBadge = isNew && hasRig
      ? '<span class="proj-new-badge proj-rig-badge" title="Rig ready — click to view" aria-label="Rig ready">Rig ✓</span>'
      : isNew
        ? '<span class="proj-new-badge" title="New model ready — click to view" aria-label="New model ready">✓</span>'
        : hasRig
          ? '<span class="proj-rig-badge" title="This project has a rig" aria-label="Rig">Rig ✓</span>'
          : "";
    if (isNew && !publicCompact) li.classList.add("proj-item--new");
    const genOwner = p.generation?.by_user_name || p.generated_by?.display_name || "";
    const ownerLabel = [p.owner_name || genOwner, p.public ? null : p.owner_email].filter(Boolean).join(" · ");
    const otherUserRender = p.folder_id === "__other_user_renders__";
    const generatingForMe = !!(generating && otherUserRender);
    const whoFirst = generationFirstName(activeGen, p);
    const forMeLine = generatingForMe
      ? `${whoFirst} is generating for me${vrGen ? ` · ${toneChrome.badge}` : ""}`
      : "";
    const showOwner = !!(generatingForMe || (ownerLabel && (readOnly || p.public || generating || isProjectNew?.(p.id) || p.shared_with_me)));
    const ownerMeta = showOwner
      ? `<span class="proj-owner-badge" title="${escapeHtml(generatingForMe ? forMeLine : (generating ? `${ownerLabel} is generating` : `Generated by ${ownerLabel}`))}">${escapeHtml(generatingForMe ? forMeLine : (generating ? `${(p.owner_name || genOwner || "Teammate")}` : `By ${p.owner_name || genOwner || ownerLabel}`))}</span>`
      : "";
    const sharedTag = p.shared_with_me
      ? `<span class="folder-shared-tag proj-shared-tag" title="Shared with you">Shared</span>`
      : "";
    const incognitoTag = p.incognito
      ? `<span class="folder-shared-tag proj-incognito-tag" title="Incognito — private to you">${p.incognito_has_pin && !p.incognito_unlocked ? "Incognito 🔒" : "Incognito"}</span>`
      : "";
    const publicVisibilityTag = p.public
      ? '<span class="proj-public-visibility" role="img" aria-label="Public project" title="Public — anyone can view this project">🌐</span>'
      : "";
    const publicPinTag = p.public_pinned
      ? `<span class="proj-public-pin-badge" title="Pinned to the top of Public">Pinned</span>`
      : "";
    if (p.incognito) li.classList.add("proj-item--incognito");
    if (p.public_pinned) li.classList.add("proj-item--public-pinned");
    const userPinned = isUserPinnedProject(p);
    if (userPinned && !publicCompact) li.classList.add("proj-item--user-pinned");
    if (projectViewMode === "grid") li.classList.add("proj-item--grid");
    const componentCount = (p.browser?.components || []).length;
    const promptCount = Number(p?.usage_summary?.tracked_count || 0);
    const metaBits = [];
    if (componentCount > 0) metaBits.push(`${componentCount} model${componentCount !== 1 ? "s" : ""}`);
    else if (files > 0) metaBits.push(`${files} file${files !== 1 ? "s" : ""}`);
    if (promptCount > 0) metaBits.push(`${promptCount} prompt${promptCount !== 1 ? "s" : ""}`);
    if (steps > 0) metaBits.push(`${steps} step${steps !== 1 ? "s" : ""}`);
    if (when) metaBits.push(when);
    const metaLine = metaBits.join(" · ");
    const metaTitle = [
      files ? `${files} file${files !== 1 ? "s" : ""}` : null,
      componentCount ? `${componentCount} model${componentCount !== 1 ? "s" : ""}` : null,
      promptCount ? `${promptCount} prompt${promptCount !== 1 ? "s" : ""}` : null,
      steps ? `${steps} step${steps !== 1 ? "s" : ""}` : null,
      when || null,
    ].filter(Boolean).join(" · ");
    const costChip = (() => {
      const summary = p?.usage_summary;
      if (!summary || !(summary.tracked_count > 0 || summary.cost_usd > 0)) return "";
      const cost = formatCostUsd(summary.cost_usd ?? 0) || "$0.00";
      return `<span class="proj-cost-chip" title="AI project cost">${escapeHtml(cost)}</span>`;
    })();
    body.innerHTML = publicCompact
      ? `${spinner}<span class="proj-name" title="${escapeHtml(p.name || p.id)}">${escapeHtml(p.name || p.id)}</span>${publicPinTag}<span class="proj-meta">${escapeHtml(metaBits.slice(0, 2).join(" · "))}</span>`
      : `${genBadge}${spinner}${progressBadge}<span class="proj-name">${escapeHtml(p.name || p.id)}</span>${publicVisibilityTag}${publicPinTag}${sharedTag}${incognitoTag}${newBadge}${costChip}<span class="proj-id-badge" title="${escapeHtml(projectIdToken)}">${escapeHtml(projectIdLabel)}</span>${loadingLabel}${ownerMeta}<span class="proj-meta" title="${escapeHtml(metaTitle)}">${escapeHtml(metaLine)}</span>`;
    const actions = document.createElement("div");
    const showPersonalPin = canShowPersonalPin(p);
    actions.className = showPersonalPin
      ? "proj-row-actions proj-row-actions--with-pin proj-row-actions--kebab"
      : "proj-row-actions proj-row-actions--kebab";
    const coarse = window.matchMedia?.("(pointer: coarse)").matches
      || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    if (showPersonalPin) {
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = `btn-icon btn-proj-pin${userPinned ? " is-pinned" : ""}`;
      pinBtn.dataset.action = "pin-personal";
      pinBtn.title = userPinned ? "Unpin from projects" : "Pin to projects";
      pinBtn.setAttribute("aria-label", pinBtn.title);
      pinBtn.setAttribute("aria-pressed", userPinned ? "true" : "false");
      pinBtn.innerHTML = PIN_SVG;
      pinBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onTogglePersonalPin?.(p);
      });
      actions.appendChild(pinBtn);
    }
    {
      const kebab = document.createElement("button");
      kebab.type = "button";
      kebab.className = "browser-item-kebab proj-item-kebab";
      kebab.title = "More actions";
      kebab.setAttribute("aria-label", "More actions");
      kebab.setAttribute("aria-haspopup", "menu");
      kebab.setAttribute("aria-expanded", "false");
      kebab.innerHTML = ICON_HIERARCHY_KEBAB;
      kebab.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openActionStrip(kebab, projectStripButtons(p));
      });
      actions.appendChild(kebab);
    }
    if (!readOnly || p.shared_with_me) {
      actions.title = coarse
        ? (p.shared_with_me
          ? "Hold to open menu or remove from your folder"
          : "Hold for export, share, pin, rename, and delete")
        : (p.shared_with_me
          ? "Right-click to open or remove from your folder"
          : "Right-click project for share, export, pin, rename, and delete");
    }

    const main = document.createElement("div");
    main.className = "proj-item-main";
    main.append(handle, expandBtn, thumb, body, actions);
    const readyEdit = getVideoEditReady?.(p.id);
    let readyEditButton = null;
    if (readyEdit?.editor_name) {
      const reopen = document.createElement("button");
      reopen.type = "button";
      reopen.className = "proj-video-edit-ready";
      reopen.textContent = "AI edit ready · Open editor";
      reopen.title = "Render Agent finished the AI edit clip. Open its editor.";
      reopen.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenVideoEditor?.(p, { editor_name: readyEdit.editor_name, ready_edit: true });
      });
      readyEditButton = reopen;
    }

    body.addEventListener("click", (e) => {
      if (main.dataset.longPressConsumed === "1") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      onOpenProject?.(p.id);
    });

    main.addEventListener("contextmenu", (e) => {
      showProjectContextMenu(e, p);
    });
    bindLongPress(main, (fakeEvent) => {
      showProjectContextMenu(fakeEvent, p);
    });

    const hoverPop = document.createElement("div");
    hoverPop.className = publicCompact ? "proj-public-hover" : "proj-cost-pop";
    hoverPop.setAttribute("role", "tooltip");
    hoverPop.hidden = true;
    if (publicCompact) {
      const author = publicAuthorName(p);
      const profileHref = publicProfileHref(p);
      const handle = publicAuthorHandle(p);
      const signedIn = signedInForPublic();
      const addNeedsLogin = onlineModelsNeedsLogin("add-author", { signedIn });
      hoverPop.innerHTML = `
        <p class="proj-public-hover-name">${escapeHtml(p.name || p.id)}<span class="proj-public-hover-trunc" aria-hidden="true">…</span></p>
        <p class="proj-public-hover-by">By ${
          profileHref
            ? `<a href="${escapeHtml(profileHref)}" data-public-author>${escapeHtml(author)}</a>`
            : `<span>${escapeHtml(author)}</span>`
        }</p>
        <p class="proj-public-hover-details">${escapeHtml([projectIdLabel, metaLine].filter(Boolean).join(" · "))}</p>
        <div class="proj-public-hover-actions">
          ${profileHref ? `<a class="btn secondary btn-compact" href="${escapeHtml(profileHref)}" data-public-author>Profile</a>` : ""}
          ${addNeedsLogin
            ? `<button type="button" class="btn accent btn-compact" data-public-login="add-author">Log in</button>`
            : `<button type="button" class="btn accent btn-compact" data-add-author>Add</button>`}
        </div>
      `;
      hoverPop.querySelectorAll("[data-public-author]").forEach((el) => {
        el.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          runPublicModelAction("profile", p, { handle, userId: publicAuthorUserId(p) });
        });
      });
      hoverPop.querySelector("[data-add-author]")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        runPublicModelAction("add-author", p, { handle, userId: publicAuthorUserId(p) });
      });
      hoverPop.querySelector("[data-public-login]")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        onLoginForPublicAction?.({ action: "add-author", projectId: p.id, handle, userId: publicAuthorUserId(p) });
      });
    } else {
      hoverPop.innerHTML = projectCostAnalyticsHtml(p);
    }
    let costHideTimer = 0;
    const placeCostPop = () => {
      const anchor = main.getBoundingClientRect();
      const pad = 8;
      const width = Math.min(280, window.innerWidth - 24);
      let left = anchor.right + pad;
      let top = anchor.top;
      if (left + width > window.innerWidth - pad) {
        left = Math.max(pad, anchor.left - width - pad);
      }
      hoverPop.style.width = `${width}px`;
      hoverPop.style.left = `${Math.round(left)}px`;
      hoverPop.hidden = false;
      const h = hoverPop.getBoundingClientRect().height || 160;
      if (top + h > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - h - pad);
      }
      hoverPop.style.top = `${Math.round(top)}px`;
    };
    const showCostPop = () => {
      if (!shouldShowPublicHover({
        contextMenuOpen: !!contextMenu || document.body.classList.contains("proj-context-menu-open"),
      })) return;
      if (costHideTimer) { clearTimeout(costHideTimer); costHideTimer = 0; }
      document.querySelectorAll(".proj-cost-pop:not([hidden]), .proj-public-hover:not([hidden])").forEach((el) => {
        if (el !== hoverPop) el.hidden = true;
      });
      placeCostPop();
    };
    const hideCostPop = () => {
      costHideTimer = window.setTimeout(() => { hoverPop.hidden = true; }, 120);
    };
    main.addEventListener("mouseenter", showCostPop);
    main.addEventListener("mouseleave", hideCostPop);
    hoverPop.addEventListener("mouseenter", showCostPop);
    hoverPop.addEventListener("mouseleave", hideCostPop);
    main.addEventListener("focusin", showCostPop);
    main.addEventListener("focusout", hideCostPop);
    window.addEventListener("scroll", () => {
      if (!hoverPop.hidden) placeCostPop();
    }, true);

    li.append(main, hoverPop);
    if (readyEditButton) li.appendChild(readyEditButton);
    if (hasHierarchy && projectOpen) {
      li.appendChild(buildProjectHierarchy(p));
    }

    handle.addEventListener("dragstart", (e) => {
      if (readOnly) {
        e.preventDefault();
        return;
      }
      e.stopPropagation();
      dragProjectId = p.id;
      clearDropIndicators();
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", p.id);
    });
    handle.addEventListener("dragend", () => {
      dragProjectId = null;
      li.classList.remove("dragging");
      clearDropIndicators();
    });

    if (!readOnly) {
      li.addEventListener("dragover", (e) => {
        if (!dragProjectId || dragProjectId === p.id) return;
        const projects = getProjects();
        if (projects.find((x) => x.id === dragProjectId)?.read_only_project) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const rect = li.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        container?.querySelectorAll(".drop-before, .drop-after").forEach((el) => {
          el.classList.remove("drop-before", "drop-after");
        });
        li.classList.add(before ? "drop-before" : "drop-after");
        dropAtEnd = false;
        if (before) {
          dropBeforeProjectId = p.id;
        } else {
          const siblings = [...(li.parentElement?.querySelectorAll(":scope > .proj-item") || [])];
          const idx = siblings.indexOf(li);
          const next = siblings.slice(idx + 1).find((el) => el.dataset.projectId !== dragProjectId);
          dropBeforeProjectId = next?.dataset?.projectId || null;
          dropAtEnd = !dropBeforeProjectId;
        }
      });
      li.addEventListener("dragleave", (e) => {
        if (!li.contains(e.relatedTarget)) {
          li.classList.remove("drop-before", "drop-after");
        }
      });
      li.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pid = dragProjectId || e.dataTransfer.getData("text/plain");
        const beforeId = dropBeforeProjectId;
        const atEnd = dropAtEnd;
        clearDropIndicators();
        if (!pid || pid === p.id) return;
        const projects = getProjects();
        if (projects.find((x) => x.id === pid)?.read_only_project) return;
        const targetFolder = effectiveProjectFolderId(p);
        await moveProjectToFolder(pid, targetFolder, {
          beforeProjectId: beforeId,
          atEnd,
        });
      });
    }

    return li;
  }

  function setupDropZone(zoneEl, folderId) {
    zoneEl.addEventListener("dragover", (e) => {
      if (!dragProjectId) return;
      const projects = getProjects();
      if (projects.find((p) => p.id === dragProjectId)?.read_only_project) return;
      // Project-row handlers own precise before/after placement.
      if (e.target.closest?.(".proj-item")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      zoneEl.classList.add("drop-target-active");
      dropBeforeProjectId = null;
      dropAtEnd = false;
    });
    zoneEl.addEventListener("dragleave", (e) => {
      if (!zoneEl.contains(e.relatedTarget)) {
        zoneEl.classList.remove("drop-target-active");
      }
    });
    zoneEl.addEventListener("drop", async (e) => {
      if (e.target.closest?.(".proj-item")) return;
      e.preventDefault();
      zoneEl.classList.remove("drop-target-active");
      const pid = dragProjectId || e.dataTransfer.getData("text/plain");
      clearDropIndicators();
      if (!pid) return;
      const projects = getProjects();
      if (projects.find((p) => p.id === pid)?.read_only_project) return;
      await moveProjectToFolder(pid, folderId || null);
    });
  }

  function paintFallbackProjects() {
    const projects = Array.isArray(getProjects?.()) ? getProjects() : [];
    const teams = getTeams?.() || [];
    const personalId = inferPersonalWorkspaceId(teams, getPersonalWorkspaceId?.() || null) || "";
    const mine = projects.filter((p) => belongsInPersonalProjectsList(p, {
      personalWorkspaceId: personalId,
      currentUserId: String(getCurrentUserId?.() || ""),
    }));
    const shown = sortProjectsForDisplay(
      mine.length ? mine : projects.filter((p) => !isCommunityProject(p)),
      { recencyFirst: true },
    ).slice(0, 40);
    container.innerHTML = "";
    const tree = document.createElement("section");
    tree.className = "explorer-projects-section";
    tree.setAttribute("aria-label", "Projects");
    const head = document.createElement("div");
    head.className = "folder-group-label folder-group-label--projects";
    head.textContent = "Projects";
    tree.appendChild(head);
    const ul = document.createElement("ul");
    ul.className = "project-list";
    if (!shown.length) {
      const empty = document.createElement("li");
      empty.className = "folder-drop-hint muted small";
      empty.textContent = getProjectsLoading?.()
        ? "Loading projects…"
        : "No projects yet — create one or upload a model.";
      ul.appendChild(empty);
    } else {
      for (const p of shown) {
        const li = document.createElement("li");
        li.className = "proj-item";
        if (p?.id) li.dataset.projectId = p.id;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "proj-row-body";
        btn.textContent = p?.name || p?.id || "Project";
        btn.addEventListener("click", () => { if (p?.id) onOpenProject?.(p.id); });
        li.appendChild(btn);
        ul.appendChild(li);
      }
    }
    tree.appendChild(ul);
    container.appendChild(tree);
    try { appendSharedProjectsSection(container, projects); } catch (_) {}
    appendWorkspacesHeader(container);
    try {
      const roster = explorerWorkspaceRoster(
        projects,
        personalId || null,
        getPersonalWorkspaceLabel?.() || "Projects",
      );
      appendWorkspaceRoster(container, roster.rows, roster.currentId);
    } catch (_) {}
  }

  function render() {
    if (!container) return;
    try {
      renderExplorer();
    } catch (err) {
      console.error("workspace browser render failed:", err);
      try {
        if (!container.querySelector(".proj-item")) {
          paintFallbackProjects();
        }
      } catch (err2) {
        console.error("fallback project list failed:", err2);
        try {
          container.innerHTML = `<p class="status error browser-empty">Could not render projects.</p>`;
        } catch (_) {}
      }
    }
  }

  function renderExplorer() {
    closeActionStrip();
    hierarchyEntryCache.clear();
    visibleHierarchyOrder.length = 0;
    bindExplorerPaneTabs();
    const projects = Array.isArray(getProjects?.()) ? getProjects() : [];
    const folderIds = new Set((folders || []).map((f) => f.id).filter(Boolean));
    const allRootProjects = sortProjectsForDisplay(
      projects.filter((p) => !p.folder_id || !folderIds.has(p.folder_id)),
      { recencyFirst: true },
    );
    const query = normalizeProjectSearch(projectSearchQuery);
    const searching = query.length > 0;
    const filterProjects = (list, folderName = "") =>
      searching ? list.filter((p) => matchesProjectSearch(p, query, folderName)) : list;
    const folderTeamId = resolveTeamId();
    const workspaceMeta = getWorkspaceMeta?.(folderTeamId) || {};
    const listedWorkspaces = listedSidebarWorkspaces({
      teams: getTeams?.() || [],
      hiddenIds: getHiddenWorkspaceIds?.() || new Set(),
      personalId: inferPersonalWorkspaceId(getTeams?.() || [], getPersonalWorkspaceId?.() || null) || null,
      personalLabel: getPersonalWorkspaceLabel?.() || "Projects",
      projects,
      recentIds: getRecentWorkspaceIds?.() || [],
    });
    const multiWorkspace = listedWorkspaces.length > 1;
    const rootLabel = !multiWorkspace
      ? (workspaceMeta.rootLabel || "Personal files")
      : "Projects";
    const rootProjects = filterProjects(allRootProjects, rootLabel);
    const folderProjects = (fid, folderName = "") =>
      filterProjects(
        sortProjectsForDisplay(projects.filter((p) => p.folder_id === fid)),
        folderName
      );

    container.innerHTML = "";
    container.classList.toggle("project-browser--grid", projectViewMode === "grid");
    container.classList.toggle("project-browser--list", projectViewMode !== "grid");

    const browserToolbar = document.createElement("div");
    browserToolbar.className = "project-browser-toolbar";

    const searchBar = document.createElement("label");
    searchBar.className = "project-search-bar";
    searchBar.innerHTML = `
      <span class="project-search-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="6.5" cy="6.5" r="4.25"></circle>
          <path d="M10 10l3.5 3.5" stroke-linecap="round"></path>
        </svg>
      </span>
      <input type="search" class="project-search-input" placeholder="Search projects, models, components…" maxlength="120" autocomplete="off" spellcheck="false" />
      <button type="button" class="project-search-clear${projectSearchQuery.trim() ? "" : " hidden"}" title="Clear search" aria-label="Clear search">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"></path>
        </svg>
      </button>
    `;
    browserToolbar.appendChild(searchBar);

    const viewToggle = document.createElement("div");
    viewToggle.className = "project-view-toggle";
    viewToggle.setAttribute("role", "group");
    viewToggle.setAttribute("aria-label", "Project layout");
    viewToggle.innerHTML = `
      <button type="button" class="project-view-btn${projectViewMode === "list" ? " active" : ""}" data-view="list" title="List view" aria-pressed="${projectViewMode === "list"}">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <path d="M3 4h10M3 8h10M3 12h10" stroke-linecap="round"/>
        </svg>
      </button>
      <button type="button" class="project-view-btn${projectViewMode === "grid" ? " active" : ""}" data-view="grid" title="Grid view" aria-pressed="${projectViewMode === "grid"}">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/>
          <rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/>
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/>
          <rect x="9" y="9" width="4.5" height="4.5" rx="1"/>
        </svg>
      </button>
    `;
    viewToggle.querySelectorAll(".project-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.view === "grid" ? "grid" : "list";
        if (next === projectViewMode) return;
        projectViewMode = next;
        try { localStorage.setItem(PROJECT_VIEW_KEY, projectViewMode); } catch (_) {}
        onExplorerPrefs?.({ view: projectViewMode, inspectView: projectViewMode });
        render();
      });
    });
    browserToolbar.appendChild(viewToggle);

    const searchInput = searchBar.querySelector(".project-search-input");
    const clearBtn = searchBar.querySelector(".project-search-clear");
    searchInput.value = projectSearchQuery;
    searchInput.addEventListener("input", () => {
      projectSearchQuery = searchInput.value;
      try {
        if (projectSearchQuery.trim()) {
          sessionStorage.setItem(PROJECT_SEARCH_KEY, projectSearchQuery);
        } else {
          sessionStorage.removeItem(PROJECT_SEARCH_KEY);
        }
      } catch (_) {}
      render();
      const nextInput = container.querySelector(".project-search-input");
      if (nextInput) {
        nextInput.focus();
        const len = nextInput.value.length;
        nextInput.setSelectionRange(len, len);
      }
    });
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      projectSearchQuery = "";
      try { sessionStorage.removeItem(PROJECT_SEARCH_KEY); } catch (_) {}
      render();
      container.querySelector(".project-search-input")?.focus();
    });

    const toolbar = document.createElement("div");
    toolbar.className = "folder-toolbar folder-toolbar--icon-only";
    if (folderTeamId) {
      toolbar.innerHTML = `
        <button type="button" class="btn-create-folder" title="New folder" aria-label="New folder">
          <svg class="btn-create-folder-icon" viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
            <path d="M2.75 5.75c0-.97.78-1.75 1.75-1.75h3.15l1.55 1.65h6.3c.97 0 1.75.78 1.75 1.75v7.1c0 .97-.78 1.75-1.75 1.75h-11c-.97 0-1.75-.78-1.75-1.75V5.75z" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round"></path>
            <path d="M10 8.25v5M7.5 10.75h5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"></path>
          </svg>
        </button>
      `;
      browserToolbar.appendChild(toolbar);
    }

    toolbar.querySelector(".btn-create-folder")?.addEventListener("click", () => {
      const personalId = getPersonalWorkspaceId?.() || listedWorkspaces.find((ws) => ws.personal)?.id || "";
      openCreateFolderDialog(personalId ? { teamId: personalId } : {});
    });

    let visibleProjectCount = 0;

    const personalWorkspaceId = inferPersonalWorkspaceId(
      getTeams?.() || [],
      listedWorkspaces.find((ws) => ws.personal)?.id || getPersonalWorkspaceId?.() || null,
    );
    const sharedTeamIds = new Set(
      (getTeams?.() || [])
        .map((team) => String(team?.id || ""))
        .filter((id) => id && id !== personalWorkspaceId)
    );
    const explorerRoster = explorerWorkspaceRoster(
      projects,
      personalWorkspaceId,
      getPersonalWorkspaceLabel?.() || "Projects",
    );
    const currentUserId = String(getCurrentUserId?.() || "");
    const isPersonalProject = (item) => belongsInPersonalProjectsList(item, {
      personalWorkspaceId,
      sharedWorkspaceIds: sharedTeamIds,
      currentUserId,
    });
    const ownedFolderIds = new Set(
      projects.filter(isPersonalProject).map((p) => String(p.folder_id || "")).filter(Boolean)
    );
    const personalFolders = folders.filter((f) => {
      if (isCommunityFolder(f) || archivedFolderIds().has(f.id) || isSharedWorkspaceFolder(f)) return false;
      return belongsInPersonalFolderList(f, {
        personalWorkspaceId,
        currentUserId,
        ownedFolderIds,
      });
    });
    const personalRootProjects = filterProjects(
      allRootProjects.filter(isPersonalProject),
      "Projects"
    );
    const personalFolderIds = new Set(personalFolders.map((f) => String(f.id)));
    const listedIds = new Set(personalRootProjects.map((p) => p.id));
    for (const folder of personalFolders) {
      for (const p of folderProjects(folder.id, folder.name)) listedIds.add(p.id);
    }
    for (const p of unlistedPersonalProjects(projects, {
      listedIds,
      isPersonalProject,
      personalFolderIds,
      includeProject: (p) => !searching || matchesProjectSearch(p, query, "Projects"),
    })) {
      personalRootProjects.push(p);
      listedIds.add(p.id);
    }
    if (personalRootProjects.length > 1) {
      const resorted = sortProjectsForDisplay(personalRootProjects, { recencyFirst: true });
      personalRootProjects.splice(0, personalRootProjects.length, ...resorted);
    }
    const rootCollapsed = searching ? false : collapsedFolders.has(folderStorageId(null));
    const privateFolders = listedWorkspaces.length
      ? []
      : folders.filter(
        (f) => !isCommunityFolder(f) && !archivedFolderIds().has(f.id) && !isSharedWorkspaceFolder(f)
          && (!multiWorkspace || searching)
      );
    const communityFolders = folders.filter((f) => isCommunityFolder(f));
    const showPrivateGroup = !!(rootProjects.length || !searching || privateFolders.some((f) => folderProjects(f.id, f.name).length));
    const showCommunityGroup = communityFolders.some((f) => {
      if (!searching) return true;
      return folderProjects(f.id, f.name).length > 0;
    });

    const pinIdSet = new Set(personalPinIds());
    const allPersonalProjects = [
      ...personalRootProjects,
      ...personalFolders.flatMap((folder) => folderProjects(folder.id, folder.name).filter(isPersonalProject)),
    ];
    const seenPersonal = new Set();
    const uniquePersonal = [];
    for (const row of allPersonalProjects) {
      const id = String(row?.id || "");
      if (!id || seenPersonal.has(id)) continue;
      seenPersonal.add(id);
      uniquePersonal.push(row);
    }
    const { pinned: pinnedPersonalProjects } = partitionPersonalPinnedProjects(uniquePersonal, [...pinIdSet]);
    const hidePinnedFromLists = new Set(pinnedPersonalProjects.map((p) => String(p.id)));

    const appendFolderZone = (folder, parentEl = container, { personalOnly = false } = {}) => {
      const inFolder = (personalOnly
        ? folderProjects(folder.id, folder.name).filter(isPersonalProject)
        : folderProjects(folder.id, folder.name)
      ).filter((p) => !personalOnly || !hidePinnedFromLists.has(String(p.id)));
      if (searching && !inFolder.length) return;
      const publicFolder = isPublicSidebarFolder(folder);
      if (publicFolder && isNewOrGuestExplorer(getCurrentUserId?.(), getProjects?.() || [])) {
        collapsedFolders.delete(folderStorageId(folder.id));
      }
      const folderCollapsed = searching ? false : collapsedFolders.has(folderStorageId(folder.id));
      const zone = document.createElement("section");
      zone.className = "folder-zone";
      if (folderCollapsed) zone.classList.add("folder-zone-collapsed");
      if (publicFolder) zone.classList.add("folder-zone--public");
      zone.dataset.folderId = folder.id;

      const header = document.createElement("header");
      header.className = publicFolder ? "folder-header folder-header--public" : "folder-header";
      const shareBadge =
        folder.visibility === "shared" || (folder.share_count ?? 0) > 0
          ? `<span class="folder-share-badge" title="Shared folder">👥 ${folder.share_count || ""}</span>`
          : "";
      const sharedLabel = folder.shared_with_me
        ? `<span class="folder-shared-tag">Shared with you</span>`
        : "";

      const canManage = folder.can_manage || folder.is_owner;
      const caps = folderMenuCapabilities(folder);
      const showSharedMenu = caps.showMenuChrome;

      header.appendChild(buildFolderCollapseBtn(folder.id, folderCollapsed));
      const folderWsMeta = folder.team_id ? getWorkspaceMeta?.(folder.team_id) : null;
      const folderWsTag =
        multiWorkspace && folderWsMeta?.label && !folder.virtual && !folder.public
          ? `<span class="folder-workspace-tag" title="Workspace">${escapeHtml(folderWsMeta.label)}</span>`
          : "";
      const sharedWsBadge = isSharedWorkspaceFolder(folder)
        ? `<span class="folder-shared-tag">Shared workspace</span>`
        : "";
      header.insertAdjacentHTML(
        "beforeend",
        `
        <span class="folder-icon">${isSharedWorkspaceFolder(folder) ? "🟧" : folder.public ? "🌐" : "📂"}</span>
        <span class="folder-title-row">
          <span class="folder-title">${escapeHtml(publicFolder ? publicExplorerFolderLabel(folder) : folder.name)}</span>
        </span>
        ${folderWsTag}
        ${sharedLabel}
        ${sharedWsBadge}
        ${shareBadge}
        <span class="folder-count muted small">${inFolder.length}</span>
        ${canManage || showSharedMenu ? `<span class="folder-header-actions">
          ${canManage ? `<button type="button" class="btn-icon btn-folder-new-project" title="New project in ${escapeHtml(folder.name)}" aria-label="New project in ${escapeHtml(folder.name)}">+</button>` : ""}
          <button type="button" class="btn-folder-menu" title="Folder menu" aria-label="Folder menu">⋯</button>
        </span>` : ""}
      `
      );
      attachFolderTitleToggle(header.querySelector(".folder-title"), folder.id);
      header.title = isSharedWorkspaceFolder(folder)
        ? "Right-click to invite, leave, or manage this shared workspace"
        : canManage
          ? "Right-click to edit, share, or delete this folder"
          : caps.showLeaveWorkspace || caps.canLeaveShare
            ? "Right-click to leave this folder or workspace"
            : "Right-click for folder menu";

      const openMenu = (ev) => showFolderContextMenu(ev, folder);
      header.addEventListener("contextmenu", openMenu);
      bindLongPress(header, openMenu);
      zone.addEventListener("contextmenu", (ev) => {
        if (ev.target.closest(".proj-item, .proj-row-body, .btn-proj-rename, .btn-proj-delete, .btn-icon, .btn-folder-menu, .btn-folder-new-project")) return;
        openMenu(ev);
      });
      header.querySelector(".btn-folder-new-project")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void createProjectInFolder(folder);
      });
      header.querySelector(".btn-folder-menu")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const btn = ev.currentTarget;
        openActionStrip(btn, folderStripButtons(folder));
      });

      const list = document.createElement("ul");
      list.className = "project-list";
      if (!folderCollapsed) {
        if (!inFolder.length) {
          const empty = document.createElement("li");
          empty.className = "folder-drop-hint muted small";
          empty.textContent = folder.virtual || folder.read_only ? "No renders yet" : "Drop projects here";
          list.appendChild(empty);
        } else {
          const listKey = folderListKey(folder.id);
          const folderShowAll = showAllFolders.has(listKey);
          const publicRows = publicFolder ? withGuestPublicPin(inFolder) : inFolder;
          const visibleFolderProjects = publicFolder
            ? (searching ? publicRows : guestPublicVisibleSlice(publicRows, { limit: GUEST_PUBLIC_LIST_LIMIT }))
            : visibleSlice(inFolder, listKey, showAllFolders, searching);
          visibleFolderProjects.forEach((p) => appendProjectRow(list, p));
          visibleProjectCount += visibleFolderProjects.length;
          if (publicFolder && !searching && publicRows.length > visibleFolderProjects.length) {
            const more = document.createElement("li");
            more.className = "browser-show-more-row browser-view-more-catalog";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "browser-show-more-btn";
            btn.textContent = "View more →";
            btn.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenOnlineModels?.({ tab: "public" });
            });
            more.appendChild(btn);
            list.appendChild(more);
          } else {
            const more = buildShowMoreControl({
              total: inFolder.length,
              shown: visibleFolderProjects.length,
              expanded: folderShowAll || searching,
              label: "projects",
              onToggle: () => {
                if (folderShowAll) showAllFolders.delete(listKey);
                else showAllFolders.add(listKey);
                saveIdSet(FOLDER_SHOW_ALL_KEY, showAllFolders);
                render();
              },
            });
            if (!searching && more) list.appendChild(more);
          }
        }
      }

      zone.append(header, list);
      if (!(folder.virtual || folder.read_only)) setupDropZone(zone, folder.id);
      parentEl.appendChild(zone);
    };

    const appendPersonalTree = (parent) => {
      if (!parent || parent.querySelector(".explorer-projects-tree")) return;
      const tree = document.createElement("div");
      tree.className = "explorer-projects-tree workspace-personal-tree";
      tree.appendChild(browserToolbar);
      if (personalRootProjects.length || !searching) {
        const rootZone = document.createElement("section");
        rootZone.className = "folder-zone folder-zone-root folder-zone-root--personal";
        if (rootCollapsed) rootZone.classList.add("folder-zone-collapsed");
        rootZone.dataset.folderId = "";
        const rootHeader = document.createElement("header");
        rootHeader.className = "folder-header";
        const rootTitleRow = document.createElement("span");
        rootTitleRow.className = "folder-title-row";
        const rootTitle = Object.assign(document.createElement("span"), { className: "folder-title", textContent: "Projects" });
        rootTitleRow.append(rootTitle);
        const rootActions = document.createElement("span");
        rootActions.className = "folder-header-actions";
        const rootMenuBtn = document.createElement("button");
        rootMenuBtn.type = "button";
        rootMenuBtn.className = "btn-folder-menu";
        rootMenuBtn.title = "Folder menu";
        rootMenuBtn.setAttribute("aria-label", "Folder menu");
        rootMenuBtn.setAttribute("aria-haspopup", "menu");
        rootMenuBtn.setAttribute("aria-expanded", "false");
        rootMenuBtn.textContent = "⋯";
        rootMenuBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openActionStrip(rootMenuBtn, folderStripButtons(null));
        });
        rootActions.append(buildFolderNewProjectBtn(null), rootMenuBtn);
        rootHeader.append(
          buildFolderCollapseBtn(null, rootCollapsed),
          Object.assign(document.createElement("span"), { className: "folder-icon", textContent: "📁" }),
          rootTitleRow,
          Object.assign(document.createElement("span"), {
            className: "folder-count muted small",
            textContent: personalRootProjects.length ? `${personalRootProjects.length}` : "",
          }),
          rootActions,
        );
        attachFolderTitleToggle(rootTitle, null);
        rootHeader.classList.add("folder-title-toggle");
        rootHeader.addEventListener("click", (e) => {
          if (e.target.closest(".btn-icon, .btn-folder-menu, .btn-folder-new-project, .folder-header-actions, .folder-collapse-btn")) return;
          if (e.target.closest(".folder-title")) return;
          toggleFolderCollapse(null);
          render();
        });
        const openRootMenu = (ev) => showFolderContextMenu(ev, null);
        rootHeader.addEventListener("contextmenu", openRootMenu);
        rootZone.addEventListener("contextmenu", (ev) => {
          if (ev.target.closest(".proj-item, .proj-row-body, .btn-proj-rename, .btn-proj-delete, .btn-icon")) return;
          openRootMenu(ev);
        });
        rootZone.appendChild(rootHeader);
        const rootList = document.createElement("ul");
        rootList.className = "project-list";
        if (!rootCollapsed) {
          const visiblePinned = searching
            ? pinnedPersonalProjects.filter((p) => matchesProjectSearch(p, query, "Projects"))
            : pinnedPersonalProjects;
          if (visiblePinned.length) {
            const pinSection = document.createElement("section");
            pinSection.className = "explorer-pinned-section";
            pinSection.setAttribute("aria-label", "Pinned projects");
            const pinLabel = document.createElement("div");
            pinLabel.className = "explorer-pinned-label";
            pinLabel.textContent = "Pinned";
            const pinList = document.createElement("ul");
            pinList.className = "project-list project-list--pinned";
            visiblePinned.forEach((p) => appendProjectRow(pinList, p));
            pinSection.append(pinLabel, pinList);
            rootZone.appendChild(pinSection);
            visibleProjectCount += visiblePinned.length;
          }
          const rootKey = folderListKey(null);
          const rootShowAll = showAllFolders.has(rootKey);
          const unpinnedRoot = personalRootProjects.filter((p) => !hidePinnedFromLists.has(String(p.id)));
          const visibleRootProjects = visibleSlice(unpinnedRoot, rootKey, showAllFolders, searching);
          visibleRootProjects.forEach((p) => appendProjectRow(rootList, p));
          visibleProjectCount += visibleRootProjects.length;
          const more = buildShowMoreControl({
            total: unpinnedRoot.length,
            shown: visibleRootProjects.length,
            expanded: rootShowAll || searching,
            label: "projects",
            onToggle: () => {
              if (rootShowAll) showAllFolders.delete(rootKey);
              else showAllFolders.add(rootKey);
              saveIdSet(FOLDER_SHOW_ALL_KEY, showAllFolders);
              render();
            },
          });
          if (!searching && more) rootList.appendChild(more);
          if (!visibleRootProjects.length && !visiblePinned.length && !searching) {
            const empty = document.createElement("li");
            empty.className = "folder-drop-hint muted small";
            empty.textContent = "Drop projects here, or create a folder";
            rootList.appendChild(empty);
          }
        }
        rootZone.appendChild(rootList);
        setupDropZone(rootZone, null);
        tree.appendChild(rootZone);
      }
      parent.appendChild(tree);
      if (!rootCollapsed) {
        for (const folder of personalFolders) {
          appendFolderZone(folder, tree, { personalOnly: true });
        }
      }
    };
    if (isNewOrGuestExplorer(getCurrentUserId?.(), projects)) {
      const guestWrap = document.createElement("section");
      guestWrap.className = "explorer-projects-section explorer-guest-public";
      guestWrap.setAttribute("aria-label", "Online Models");
      guestWrap.appendChild(browserToolbar);
      appendFolderGroupLabel(guestWrap, PUBLIC_PROJECTS_LABEL, { extraClass: "folder-group-label--public" });
      const publicFolders = communityFolders.filter((f) => isPublicSidebarFolder(f));
      for (const folder of (publicFolders.length ? publicFolders : [{
        id: "__public__",
        name: PUBLIC_PROJECTS_LABEL,
        virtual: true,
        read_only: true,
        public: true,
      }])) {
        appendFolderZone(folder, guestWrap);
      }
      container.appendChild(guestWrap);
      if (searching && visibleProjectCount === 0) {
        const noMatch = document.createElement("p");
        noMatch.className = "muted small browser-empty project-search-empty";
        noMatch.textContent = `No projects or objects match “${projectSearchQuery.trim()}”`;
        container.appendChild(noMatch);
      }
      syncExplorerPaneTabs();
      return;
    }

    const projectsSection = document.createElement("section");
    projectsSection.id = "explorer-projects";
    projectsSection.className = "explorer-projects-section";
    projectsSection.setAttribute("aria-label", "Projects");
    const projectsHead = document.createElement("div");
    projectsHead.className = "folder-group-label folder-group-label--projects folder-title-toggle";
    projectsHead.textContent = "Projects";
    projectsHead.title = rootCollapsed ? "Expand Projects" : "Collapse Projects";
    projectsHead.addEventListener("click", () => {
      toggleFolderCollapse(null);
      render();
    });
    projectsSection.appendChild(projectsHead);
    appendPersonalTree(projectsSection);
    container.appendChild(projectsSection);
    try { appendSharedProjectsSection(container, projects); } catch (_) {}

    appendWorkspacesHeader(container);
    try {
      appendWorkspaceRoster(
        container,
        explorerRoster.rows,
        explorerRoster.currentId,
      );
    } catch (err) {
      console.error("workspace list failed:", err);
    }
    container.prepend(projectsSection);

    if (searching) {
      const matches = filterProjects(sortProjectsForDisplay(projects, { recencyFirst: true })).filter((p) => !isPersonalProject(p));
      if (matches.length) {
        appendFolderGroupLabel(container, "Matching projects", { breakBefore: true });
        const matchList = document.createElement("ul");
        matchList.className = "project-list workspace-search-hits";
        matches.forEach((p) => appendProjectRow(matchList, p));
        container.appendChild(matchList);
        visibleProjectCount += matches.length;
      }
    }

    for (const folder of privateFolders) {
      appendFolderZone(folder);
    }

    if (showCommunityGroup) {
      appendFolderGroupLabel(container, PUBLIC_PROJECTS_LABEL, { breakBefore: true, extraClass: "folder-group-label--public" });
      for (const folder of communityFolders) {
        appendFolderZone(folder);
      }
    }

    const archivedMatchesSearch = false;

    if (searching && visibleProjectCount === 0 && !archivedMatchesSearch) {
      const noMatch = document.createElement("p");
      noMatch.className = "muted small browser-empty project-search-empty";
      noMatch.textContent = `No projects or objects match “${projectSearchQuery.trim()}”`;
      container.appendChild(noMatch);
    } else if (!projects.length && !folders.length) {
      const empty = document.createElement("p");
      empty.className = "muted small browser-empty";
      empty.textContent = getProjectsLoading?.()
        ? "Loading projects…"
        : "No projects yet — create one or upload a model.";
      container.appendChild(empty);
    }
    const keepThumbIds = [...container.querySelectorAll(".proj-item[data-project-id], .proj-thumb[data-project-id]")]
      .map((el) => el.getAttribute("data-project-id"));
    try {
      const active = getActiveProjectId?.();
      if (active) keepThumbIds.push(active);
    } catch { /* ignore */ }
    revokeUnlistedProjectThumbs(keepThumbIds); // leakfix27
    syncExplorerPaneTabs();
  }

  let foldersRefreshAbort = null; // leakfix47
  async function refreshFolders() {
    if (foldersRefreshAbort) {
      try { foldersRefreshAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    foldersRefreshAbort = ctl;
    const projects = getProjects() || [];
    const seen = new Set();
    const nextFolders = [];

    // Seed from project folder refs (covers virtual Public / other-user / shared-ws folders too).
    for (const project of projects) {
      const id = project?.folder_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const isPublic = id === "__public__";
      const isOtherRenders = id === "__other_user_renders__";
      const isSharedWs = String(id).startsWith("__shared_ws_") || !!project.shared_workspace_folder;
      nextFolders.push({
        id,
        team_id: project.team_id || null,
        name:
          isPublic
            ? PUBLIC_PROJECTS_LABEL
            : (project.folder_name
              || (isOtherRenders ? "New renders from other users" : isSharedWs ? "Shared workspace" : "Folder")),
        virtual: isPublic || isOtherRenders || isSharedWs || !project.team_id,
        read_only: isPublic || isOtherRenders || isSharedWs || !!project.read_only_project,
        public: isPublic,
        shared_workspace: isSharedWs,
      });
    }
    if (!seen.has("__public__")) {
      seen.add("__public__");
      nextFolders.push({
        id: "__public__",
        team_id: null,
        name: PUBLIC_PROJECTS_LABEL,
        virtual: true,
        read_only: true,
        public: true,
      });
    }

    // Load real folders for visible workspaces only. Do not fan out to every
    // team (admin other-user renders used to add all team ids and hang init).
    const teamIds = new Set();
    const hidden = getHiddenWorkspaceIds?.() || new Set();
    const personalId = String(getPersonalWorkspaceId?.() || "");
    if (personalId) teamIds.add(personalId);
    for (const project of projects) {
      if (isCommunityProject(project)) continue;
      const tid = project?.team_id;
      if (tid && !hidden.has(String(tid))) teamIds.add(String(tid));
    }
    const focusId = resolveTeamId();
    if (focusId) teamIds.add(String(focusId));
    for (const team of getTeams?.() || []) {
      if (!team?.id) continue;
      const id = String(team.id);
      if (hidden.has(id)) continue;
      teamIds.add(id);
    }
    const ids = [...teamIds].slice(0, 12);
    try {
      await Promise.all(ids.map(async (tid) => {
        if (ctl.signal.aborted) return;
        try {
          const data = await api(`/api/teams/${encodeURIComponent(tid)}/folders`, { signal: ctl.signal }, 4000);
          if (ctl.signal.aborted) return;
          for (const folder of data.folders || []) {
            if (!folder?.id || seen.has(folder.id)) continue;
            seen.add(folder.id);
            nextFolders.push(folder);
          }
        } catch (err) {
          if (ctl.signal.aborted || err?.name === "AbortError") return;
          /* keep whatever we already have for this team */
        }
      }));
      if (ctl.signal.aborted) return;
      folders = nextFolders;

      const archived = loadArchivedFolders();
      if (archived.length) {
        let changed = false;
        const next = archived.map((entry) => {
          const live = folders.find((f) => f.id === entry.id);
          if (!live) return entry;
          const name = live.name || entry.name;
          const team_id = live.team_id || entry.team_id;
          if (name !== entry.name || team_id !== entry.team_id) {
            changed = true;
            return { ...entry, name, team_id };
          }
          return entry;
        });
        if (changed) saveArchivedFolders(next);
      }
    } finally {
      if (foldersRefreshAbort === ctl) foldersRefreshAbort = null;
    }
  }

  async function refresh() {
            await refreshFolders();
            render();
            document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
  }

  try {
    document.addEventListener("render3d:shared-sidebar-changed", () => {
      refreshSharedProjectsStrip();
    });
  } catch { /* ignore */ }

  bindExplorerPaneTabs();

  return {
    refresh,
    refreshFolders,
    render,
    refreshSharedProjectsStrip,
    getFolders: () => folders.slice(),
    setFolders: (f) => {
      folders = f;
    },
    upsertFolder(folder) {
      if (!folder?.id) return;
      const idx = folders.findIndex((f) => f.id === folder.id);
      if (idx >= 0) {
        folders[idx] = { ...folders[idx], ...folder };
      } else {
        folders = [...folders, folder];
      }
      render();
    },
    removeFolder(folderId) {
      if (!folderId) return;
      const next = folders.filter((f) => f.id !== folderId);
      if (next.length === folders.length) return;
      folders = next;
      render();
    },
    expandFolder(folderId) {
      if (!folderId) return;
      collapsedFolders.delete(folderStorageId(folderId));
      saveIdSet(FOLDER_COLLAPSE_KEY, collapsedFolders);
    },
    expandProject(projectId) {
      if (!projectId) return;
      forceCollapsedProjects.delete(projectId);
      expandedProjects.add(projectId);
      saveIdSet(PROJECT_EXPAND_KEY, expandedProjects);
    },
    openProjectShare(project) {
      if (!project?.id) return Promise.resolve(false);
      return projectShareDialog.open(project);
    },
    markOpenedWorkspace(teamId) {
      markExplorerWorkspace(teamId);
    },
    expandPublicFolder() {
      collapsedFolders.delete(folderStorageId("__public__"));
    },
    showReferenceFiles: showReferenceFilesPane,
    setExplorerPane,
    getExplorerPane: () => explorerPane,
  };
}
