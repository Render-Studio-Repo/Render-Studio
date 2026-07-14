import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import {
  pickGeometry,
  pickObject,
  resetRefCounter,
  setPickMode,
  getPickMode,
  updateHover,
  clearHover,
  getMarkersGroup,
  getHoverGroup,
  beginLasso,
  updateLasso,
  finishLasso,
  cancelLasso,
  addLinePoint,
  updateLinePreview,
  finishLinePath,
  cancelLinePath,
  hasLineDraft,
  lineDraftPointCount,
  pickReferenceRemove,
  removeReferenceMarker,
  getMarkerRefIds,
  restoreReferenceMarkers,
  getMeasureAnnotGroup,
  getMeasureHoverGroup,
  setMeasureAnnotations,
  clearMeasureAnnotations,
  updateMeasureLivePreview,
  clearMeasureLivePreview,
} from "./picking.js?v=20260706-pick-face";
import {
  FUSION,
  setupSceneLighting,
  setupRenderer,
  applyCadStyle,
  disposeStyledModel,
  positionShadowFloor,
  setViewMode,
  reapplyViewMode,
  viewMode,
} from "./scene-style.js?v=20260710-jake-part-colors";
import { createEditTools } from "./edit-tools.js?v=20260629-transform-drag-guard";
import { createTimelineUI } from "./timeline.js?v=20260629-avatars";
import { createPromptComposer } from "./prompt-composer.js?v=20260707-doc-references";
import { createPromptHistoryUI } from "./prompt-history.js?v=20260707-restore-history-refs";
import { copyText, formatModelLabel, formatPromptRef } from "./prompt-ref.js";
import { createSkillsPromptUI, fetchSkillsCatalog, getEnabledSkillsForPrompt, setSkillEnabled, syncBlueprintVisionForImages } from "./skills-library.js?v=20260706-ui-fix";
import { createObjectHistoryUI } from "./object-history.js?v=20260629-avatars";
import { createWorkspaceActivityUI } from "./workspace-activity.js";
import { createWorkspaceBrowser } from "./workspace-browser.js?v=20260714-project-reorder2";
import { readExplorerDragPayloads, setExplorerDragData } from "./explorer-drag.js?v=20260618-multi-drag";
import { createActivityLog } from "./activity-log.js";
import { createAuthUI, authHeaders, getToken, getStoredUser } from "./auth.js?v=20260709-admin-matt";
import { createRenderAgent } from "./render-agent.js?v=20260630-logo-avatar";
import { createAIKeyUI } from "./ai-key-ui.js?v=20260701-claude-fable-5";
import { createCollab } from "./collab.js?v=20260629-live-object-transform";
import { createRibbon } from "./ribbon.js?v=20260714-architect-phases";
import { initPanelResize } from "./panel-resize.js?v=20260611-timeline-restore";
import { createViewerOverlay } from "./viewer-overlay.js?v=20260629-fusion-loader";
import { createViewCube, VIEW_CUBE_WORLD_UP } from "./view-cube.js?v=20260611-viewcube-top";
import { openFileExportMenu, closeFileExportMenu } from "./file-actions.js?v=20260707-download-retry";
import { initOnshapePanel } from "./onshape-panel.js?v=20260617-onshape-filter";
import { initFusionPanel } from "./fusion-panel.js?v=20260709-unlink-clear";
import { formatLength, initUnitSwitcher, mmPerModelUnit } from "./units.js?v=20260610-direct";
import { createGizmoPanel } from "./gizmo-panel.js?v=20260630-architect-local-transform";
import { createArchitectBayGrid } from "./architect-grid-visual.js?v=20260714-erase-grid";
import { createArchitectSession } from "./architect-session.js?v=20260714-shift-mmb-tilt";
import { createDirectModeling } from "./direct-modeling.js?v=20260629-presspull-face-source";
import { createMeshCleanup } from "./mesh-cleanup.js?v=20260611-mesh-checkup";
import { createObjectTools } from "./object-tools.js?v=20260707-body-selection-fix";
import { createFeatureEditor } from "./feature-editor.js?v=20260610-direct";
import { fetchCadParams, cadParamControlsHtml, bindCadParamControls } from "./text-to-cad-params.js?v=20260710-live-adjust";
import { createProjectTree } from "./project-tree.js?v=20260707-dxf-drawings-section";
import {
  saveSessionSnapshot,
  clearPendingRestore,
  readPendingRestore,
  initClientVersionWatcher,
} from "./client-reload.js?v=20260710-fix-reload-loop";
import { createDxfViewer } from "./dxf-viewer.js?v=20260706-dxf-viewport-drop";
import { createProjectAssembly, filesToBrowserComponents } from "./project-assembly.js?v=20260629-fusion-body-folder";
import { createWorkspaceModes } from "./workspace-modes.js?v=20260706-design-tabs";
import { createWiringSimulator } from "./wiring-simulator.js?v=20260707-pin-labels";
import { createWiringDebugPanel } from "./wiring-photo-debug.js?v=20260619-debug-panel-fix";
import { createCanvasMode } from "./canvas-mode.js?v=20260619-canvas-sketch-fix";
import { createWiringCodeUI } from "./wiring-code-ui.js?v=20260617-general-ide";
import { createDriverPicker } from "./driver-picker.js?v=20260617-driver-aware";
import { createComponentProfileUI } from "./component-profile.js?v=20260618-hide-tags";
import { createCatalogPanel } from "./catalog-panel.js?v=20260618-catalog-import-fallback";
import { createMiniViewer } from "./mini-viewer.js?v=20260628-baked-normals";
import { createSketchEditor } from "./sketch-editor.js?v=20260629-sketch-shortcuts";
import { computeFacePlaneRef } from "./sketch-plane.js";
import { createRiggingEditor } from "./rigging-editor.js?v=20260710-step-module";
import { createUrdfRobotRuntime, createMoveIt2Client } from "./urdf-robot-runtime.js?v=20260710-jake-runtime";
import { createPlanetaryGearRuntime, detectPlanetaryGearAssembly } from "./planetary-gear-runtime.js?v=20260710-step-module";
import { createStepModuleRuntime } from "./step-module-runtime.js?v=20260710-step-module";
import { createSectionView } from "./section-view.js?v=20260629-section-outline-shell";

const API = "";
const PROMPT_TIMEOUT_MS = 480000;
const LS_LAST_PROJECT = "render3d:lastProjectId";
const LS_LAST_WORKSPACE = "render3d:lastWorkspaceId";
const LS_MODEL_PROMPT_STATE = "render3d:modelPromptState:v1";
const LS_COMPOSE_DRAFT = "render3d:aiComposeDraft:v1";
const LS_PROMPT_AI_KEY = "render3d:promptAiKey:v1";
const LS_PROJECT_PROMPT_AI_KEY = "render3d:projectPromptAiKey:v1";
const LS_HIDDEN_WORKSPACES = "render3d:hiddenWorkspaces:v1";
const LS_WORKSPACE_REALTIME_COLLAPSED = "render3d:workspaceRealtimeCollapsed:v1";

let projectId = null;
const wiringLoadCache = { projectId: null, promise: null, data: null };

function prefetchWiringForProject(id) {
  if (!id || !currentUser) {
    wiringLoadCache.projectId = null;
    wiringLoadCache.promise = null;
    wiringLoadCache.data = null;
    return;
  }
  if (wiringLoadCache.projectId === id && (wiringLoadCache.data || wiringLoadCache.promise)) return;
  wiringLoadCache.projectId = id;
  wiringLoadCache.data = null;
  wiringLoadCache.promise = api(`/api/projects/${encodeURIComponent(id)}/wiring`)
    .then((data) => {
      if (wiringLoadCache.projectId === id) wiringLoadCache.data = data;
      return data;
    })
    .catch(() => {
      const empty = { components: [], wires: [], notes: [] };
      if (wiringLoadCache.projectId === id) wiringLoadCache.data = empty;
      return empty;
    });
}

function getWiringPrefetch() {
  if (!projectId || wiringLoadCache.projectId !== projectId) return null;
  return wiringLoadCache;
}

function invalidateWiringPrefetch() {
  wiringLoadCache.data = null;
}
let lastProjectBrowser = { components: [], drawings: [], sketches: [], wiring: [] };
let lastProjectFiles = [];
let robotArtifactData = null;
let allProjects = [];
let projectsFetchGeneration = 0;
let allTeams = [];
let currentUser = null;
const A1PROJECTS_ADMIN_EMAILS = new Set(["a1projects@protonmail.com", "a1projects.usa@gmail.com"]);
let authUi = null;
let renderAgentUi = null;
let selectedFile = null;
let currentMesh = null;
let meshCenterOffset = new THREE.Vector3();
let timelineData = null;
let aiStatus = null;
let workspaceAiUsage = null;
let aiKeyUi = null;
let restoringModelPromptState = false;
let promptImages = [];
let suppressAiComposePanelSwitch = false;
let loadModelGeneration = 0;
let loadProjectGeneration = 0;
let currentSim = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isA1ProjectsAdminUser() {
  const email = String(currentUser?.email || "").trim().toLowerCase();
  return !!email && A1PROJECTS_ADMIN_EMAILS.has(email);
}

const loadingProjectIds = new Set();
let generationPollTimer = null;
let generationWatchPid = null;
let generationWatchOverlay = null;
let viewportOverlayPid = null;
// Projects with a completed generation the user hasn't viewed yet.
const newlyCompletedProjects = new Set();
let viewportOverlayState = null;
let wiringOverlay = null;
let activePromptAbort = null;
let activePromptGenerationId = 0;
let userCancelRequested = false;
let lastPromptCopyContext = null;
let latestPromptHistoryEntries = [];
let viewportPromptDropdown = null;
let userRealtimeSocket = null;
let userRealtimeReconnectTimer = null;
let workspaceRealtimeSocket = null;
let workspaceRealtimeTeamId = null;
let workspaceRealtimeReconnectTimer = null;
let workspaceRealtimeUsers = [];
let refreshTeamInvitesRealtime = () => {};
let refreshTeamMembersRealtime = () => {};
let refreshWorkspacePanelRealtime = () => {};
let pendingPromptSelectionContext = null;

function syncViewportGenerationOverlay(completeOpts = {}) {
  const overlayPid = generationWatchPid || viewportOverlayPid;
  const activeOverlay = generationWatchOverlay?.kind === "wiring" ? (wiringOverlay || viewerOverlay) : viewerOverlay;
  const inactiveOverlay = activeOverlay === viewerOverlay ? wiringOverlay : viewerOverlay;
  if (overlayPid && overlayPid === projectId) {
    if (generationWatchPid === projectId && generationWatchOverlay) {
      inactiveOverlay?.setGenerating(false);
      const liveGen = allProjects.find((p) => p.id === projectId)?.generation;
      activeOverlay.setGenerating(true, generationWatchOverlay.message, {
        ...generationWatchOverlay,
        progress: liveGen?.progress || generationWatchOverlay.progress,
      });
      syncViewportGenerationUserBadge(liveGen?.status === "running" ? liveGen : generationWatchOverlay);
    } else if (viewportOverlayPid === projectId && viewportOverlayState) {
      viewerOverlay.setGenerating(true, viewportOverlayState.message, viewportOverlayState);
      wiringOverlay?.setGenerating(false);
      syncViewportGenerationUserBadge(viewportOverlayState);
    }
    return;
  }
  const currentGeneration = allProjects.find((p) => p.id === projectId)?.generation;
  if (currentGeneration?.status === "running" && currentGeneration.kind !== "wiring") {
    const mode = generationPromptMode(currentGeneration);
    viewerOverlay.setGenerating(true, promptGenerationOverlayOpts(mode).message, {
      kind: currentGeneration.kind || "prompt",
      promptMode: mode,
      progress: currentGeneration.progress,
      ...promptGenerationOverlayOpts(mode),
    });
    wiringOverlay?.setGenerating(false);
    syncViewportGenerationUserBadge(currentGeneration);
    return;
  }
  viewerOverlay.setGenerating(false, null, { complete: completeOpts.complete ?? false });
  wiringOverlay?.setGenerating(false, null, { complete: completeOpts.complete ?? false });
  syncViewportGenerationUserBadge(null);
  syncStopButtonVisibility();
}

function generationUserAvatar(gen = {}) {
  const name = gen.by_user_name || "AI";
  const initial = appEscapeHtml(String(name).trim().charAt(0).toUpperCase() || "A");
  const avatar = gen.by_avatar_url || "";
  if (avatar) {
    return `<span class="vgu-avatar vgu-avatar--image" style="background-image:url('${appEscapeHtml(avatar)}')"></span>`;
  }
  return `<span class="vgu-avatar">${initial}</span>`;
}

function syncViewportGenerationUserBadge(gen) {
  const btn = document.getElementById("viewport-generation-user");
  if (!btn) return;
  if (!gen || gen.status !== "running" || gen.kind === "wiring") {
    btn.classList.add("hidden");
    btn.innerHTML = "";
    return;
  }
  const name = gen.by_user_name || "Someone";
  const prompt = gen.prompt || gen.label || "Generating model";
  btn.classList.remove("hidden");
  btn.dataset.prompt = prompt;
  btn.dataset.user = name;
  btn.dataset.userId = gen.by_user_id || "";
  btn.innerHTML = `
    ${generationUserAvatar(gen)}
    <span class="vgu-copy"><strong>${appEscapeHtml(name)}</strong><small>… generating with AI</small></span>
    <span class="vgu-ai">AI</span>
  `;
}

function closeViewportPromptDropdown() {
  viewportPromptDropdown?.remove();
  viewportPromptDropdown = null;
}

function promptHistoryUserKey(entry = {}) {
  return entry.user_id || entry.user_name || "";
}

function latestPromptsForGenerationUser(userId, userName, limit = 5) {
  const wanted = userId || userName || "";
  const byUser = latestPromptHistoryEntries
    .filter((entry) => entry.prompt && promptHistoryUserKey(entry) === wanted)
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, limit);
  if (byUser.length || !userName) return byUser;
  return latestPromptHistoryEntries
    .filter((entry) => entry.prompt && entry.user_name === userName)
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, limit);
}

function showViewportPromptDropdown(anchor, entries) {
  closeViewportPromptDropdown();
  if (!anchor || !entries.length) return;
  const menu = document.createElement("div");
  menu.className = "ph-person-menu vgu-prompt-menu";
  menu.innerHTML = `
    <div class="ph-person-menu-title">Latest prompts</div>
    ${entries.map((entry, idx) => `
      <button type="button" data-prompt-index="${idx}">
        <strong>${idx === 0 ? "Latest" : new Date(entry.created_at || 0).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</strong>
        <span>${appEscapeHtml(entry.prompt)}</span>
      </button>
    `).join("")}
  `;
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(10, Math.min(rect.left, window.innerWidth - menuRect.width - 10))}px`;
  menu.style.top = `${Math.max(10, Math.min(rect.bottom + 8, window.innerHeight - menuRect.height - 10))}px`;
  menu.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-prompt-index]");
    if (!btn) return;
    const entry = entries[Number(btn.dataset.promptIndex)];
    if (!entry) return;
    const ok = await copyText(entry.prompt);
    setEditStatus(ok ? "ok" : "error", ok ? "Copied to clipboard: prompt." : "Could not copy prompt.");
    closeViewportPromptDropdown();
  });
  viewportPromptDropdown = menu;
}

function showViewportOverlay(pid, message, opts = {}) {
  if (!pid) return;
  viewportOverlayPid = pid;
  viewportOverlayState = { message, ...opts };
  syncViewportGenerationOverlay();
  syncStopButtonVisibility();
}

function hideViewportOverlay(pid, completeOpts = {}) {
  if (pid != null && viewportOverlayPid !== pid) return;
  viewportOverlayPid = null;
  viewportOverlayState = null;
  syncViewportGenerationOverlay(completeOpts);
  syncStopButtonVisibility();
}

function isGenerationUiActive(pid = projectId) {
  if (!pid) return false;
  if (generationWatchPid === pid) return true;
  if (viewportOverlayPid === pid && viewerOverlay.isGenerating?.()) return true;
  return isProjectGenerating(pid);
}

function isProjectGenerating(id) {
  if (!id) return false;
  if (generationWatchPid === id) return true;
  const proj = allProjects.find((p) => p.id === id);
  return proj?.generation?.status === "running";
}

const LS_CANVAS_GEN = "render3d:canvas-gen-pending";

function markCanvasGenerationPending(pid = projectId) {
  if (!pid || !document.body.classList.contains("canvas-design-tab")) return;
  try {
    sessionStorage.setItem(LS_CANVAS_GEN, JSON.stringify({ pid, at: Date.now() }));
  } catch (_) {}
}

function clearCanvasGenerationPending(pid = projectId) {
  try {
    const raw = sessionStorage.getItem(LS_CANVAS_GEN);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!pid || data?.pid === pid) sessionStorage.removeItem(LS_CANVAS_GEN);
  } catch (_) {}
}

function syncCanvasGenerationUi() {
  const banner = document.getElementById("canvas-generation-banner");
  const messageEl = document.getElementById("canvas-generation-message");
  if (!banner) return;
  const active =
    document.body.classList.contains("canvas-design-tab")
    && projectId
    && isGenerationUiActive(projectId)
    && isCadGenerationActive(projectId);
  banner.classList.toggle("hidden", !active);
  if (!active) return;
  const msg =
    generationWatchOverlay?.message
    || "Generating 3D model in background — safe to switch tabs or refresh.";
  const bannerMode = generationPromptMode(generationWatchOverlay, viewportOverlayState?.promptMode);
  banner.classList.toggle("canvas-generation-banner--fusion", bannerMode === "fusion");
  banner.classList.toggle("canvas-generation-banner--v2", bannerMode === "v2");
  if (messageEl) {
    messageEl.textContent = msg.replace(/\s*\(safe to refresh\)/i, " — safe to switch tabs or refresh");
  }
  const statusEl = document.getElementById("prompt-status");
  if (statusEl && !statusEl.textContent) {
    statusEl.className = "status loading";
    statusEl.textContent = "Generating in background… safe to switch tabs or refresh.";
  }
}

async function resumeGenerationFromProjects() {
  if (!projectId) return;
  const proj = allProjects.find((p) => p.id === projectId);
  if (proj?.generation?.status === "running") {
    await resumeGenerationIfNeeded(projectId, proj.generation);
    return;
  }
  try {
    const gen = await api(`/api/projects/${projectId}/generation`);
    if (gen?.status === "running") {
      const cached = allProjects.find((p) => p.id === projectId);
      if (cached) cached.generation = gen;
      await resumeGenerationIfNeeded(projectId, gen);
    }
  } catch (_) {}
}

function generationAppliedKey(pid) {
  return `render3d:gen-applied:${pid}`;
}

function wasGenerationApplied(pid, traceId) {
  if (!pid || !traceId) return false;
  try {
    return localStorage.getItem(generationAppliedKey(pid)) === traceId;
  } catch {
    return false;
  }
}

function markGenerationApplied(pid, traceId) {
  if (!pid || !traceId) return;
  try {
    localStorage.setItem(generationAppliedKey(pid), traceId);
  } catch (_) {}
}

async function applyGenerationComplete(gen, pid = projectId) {
  if (!gen?.filename || !pid) return;
  window.dispatchEvent(new CustomEvent("render3d:model", { detail: { ...gen, projectId: pid } }));
  // Always mark the project as having a new model — badge shows in the explorer
  // for every completion and is cleared when the user clicks on the project.
  newlyCompletedProjects.add(pid);
  renderProjectList();
  if (pid === projectId) {
    const completionMode = generationPromptMode(
      gen,
      generationWatchOverlay?.promptMode || (document.body.classList.contains("architect-design-tab") ? "architect" : "")
    );
    saveActiveModelPromptState();
    selectedFile = gen.filename;
    const hiddenAfterReveal = setStoredComponentHidden(pid, gen.filename, false);
    projectTree.setHidden?.([...hiddenAfterReveal]);
    await refreshFiles();
    const placedFiles = (gen.placed_parts || []).map((part) => part.filename).filter(Boolean);
    await reloadViewportFromProject({
      fitView: true,
      latestFile: gen.filename,
      placedFiles,
      loadAll: completionMode === "architect",
    });
    restorePromptSelectionContext(pendingPromptSelectionContext, { resultFilename: gen.filename });
    viewerOverlay.clearError();
    await refreshTimeline();
    await refreshPromptHistory();
    showAiComposePanel();
    clearPromptComposeResult();
    const statusEl = document.getElementById("prompt-status");
    if (statusEl) {
      const ref = gen.prompt_id
        ? formatPromptRef({
            promptId: gen.prompt_id,
            projectId: pid,
            filename: gen.filename,
            traceId: gen.trace_id,
            promptMode: gen.mode || gen.prompt_mode,
            model: gen.model,
            provider: gen.provider,
          })
        : "";
      statusEl.className = "status ok";
      statusEl.textContent = ref ? `Model ready · ${ref}` : "Model ready.";
    }
    if (document.body.classList.contains("canvas-design-tab")) {
      workspaceModes?.setDesignTab?.("SOLID");
      setEditStatus("ok", "Model ready — opened in 3D view.");
    }
    pendingPromptSelectionContext = null;
  }
  clearCanvasGenerationPending(pid);
  markGenerationApplied(pid, gen.trace_id);
}

async function applyLiveModelReload(msg = {}, pid = msg.project_id || projectId) {
  if (!msg?.filename || !pid) return;
  window.dispatchEvent(new CustomEvent("render3d:model", { detail: { ...msg, projectId: pid } }));
  if (pid !== projectId) {
    newlyCompletedProjects.add(pid);
    renderProjectList();
    return;
  }
  if (isDxfDrawingFilename(msg.filename)) {
    await refreshFiles();
    setEditStatus("ok", `Added DXF drawing ${msg.filename}. Open it from DXF Drawings when needed.`);
    return;
  }
  const reloadMode = generationPromptMode(
    msg,
    generationWatchOverlay?.promptMode || (document.body.classList.contains("architect-design-tab") ? "architect" : "")
  );
  saveActiveModelPromptState();
  selectedFile = msg.filename;
  const hiddenAfterReveal = setStoredComponentHidden(pid, msg.filename, false);
  projectTree.setHidden?.([...hiddenAfterReveal]);
  await refreshFiles();
  const placedFiles = (msg.placed_parts || []).map((part) => part.filename).filter(Boolean);
  await reloadViewportFromProject({
    fitView: true,
    latestFile: msg.filename,
    placedFiles,
    loadAll: reloadMode === "architect",
  });
  restorePromptSelectionContext(pendingPromptSelectionContext, { resultFilename: msg.filename });
  viewerOverlay.clearError();
  await refreshTimeline();
  await refreshPromptHistory();
  showAiComposePanel();
  pendingPromptSelectionContext = null;
}

async function applyWiringGenerationComplete(gen, pid = projectId) {
  if (!pid) return;
  const statusEl = document.getElementById("wiring-prompt-status");
  if (statusEl && pid === projectId) {
    statusEl.className = "status ok";
    const ref = gen.prompt_id
      ? formatPromptRef({
          promptId: gen.prompt_id,
          projectId: pid,
          traceId: gen.trace_id,
          promptMode: gen.mode || gen.prompt_mode,
          model: gen.model,
          provider: gen.provider,
        })
      : (gen.trace_id ? `trace #${gen.trace_id}` : "");
    statusEl.textContent = ref ? `Schematic ready · ${ref}` : "Schematic ready.";
  }
  if (pid === projectId) {
    const schematic = await api(`/api/projects/${pid}/wiring`);
    wiringSim.applySchematic(schematic);
    invalidateWiringPrefetch();
    wiringOverlay?.clearError();
    await refreshFiles();
    await refreshWiringPromptHistory();
    showAiComposePanel();
  }
  markGenerationApplied(pid, gen.trace_id);
}

function isCadGenerationActive(pid = projectId) {
  if (!pid || !isGenerationUiActive(pid)) return false;
  if (generationWatchPid === pid) {
    return generationWatchOverlay?.kind !== "wiring";
  }
  const kind = allProjects.find((p) => p.id === pid)?.generation?.kind;
  return kind !== "wiring";
}

function syncStopButtonVisibility() {
  const btn = document.getElementById("btn-stop-generation");
  const promptBtn = document.getElementById("btn-prompt");
  const wiringBtn = document.getElementById("btn-wiring-stop");
  const wiringToolbeltBtn = document.getElementById("btn-wiring-toolbelt-stop");
  const watchMatchesProject = generationWatchPid === projectId;
  const wiringGenerating = watchMatchesProject && generationWatchOverlay?.kind === "wiring";
  const cadGenerating = watchMatchesProject
    ? generationWatchOverlay?.kind !== "wiring"
    : isCadGenerationActive(projectId);
  if (btn) {
    btn.classList.toggle("hidden", !cadGenerating);
    if (!cadGenerating) btn.disabled = false;
  }
  if (promptBtn) {
    promptBtn.classList.toggle("hidden", cadGenerating);
    if (!cadGenerating) promptBtn.removeAttribute("disabled");
  }
  if (wiringBtn) wiringBtn.classList.toggle("hidden", !wiringGenerating);
  if (wiringToolbeltBtn) wiringToolbeltBtn.classList.toggle("hidden", !wiringGenerating);
  viewerOverlay.setStopVisible?.(cadGenerating);
  wiringOverlay?.setStopVisible?.(wiringGenerating);
  syncCanvasGenerationUi();
}

function stopGenerationWatch() {
  if (generationPollTimer) {
    clearInterval(generationPollTimer);
    generationPollTimer = null;
  }
  const pid = generationWatchPid;
  generationWatchPid = null;
  generationWatchOverlay = null;
  if (pid) setProjectLoading(pid, false);
  clearCanvasGenerationPending(pid);
  syncViewportGenerationOverlay({ complete: true });
  document.getElementById("btn-prompt")?.removeAttribute("disabled");
  document.getElementById("btn-wiring-prompt")?.removeAttribute("disabled");
  document.getElementById("btn-wiring-toolbelt-generate")?.removeAttribute("disabled");
  syncStopButtonVisibility();
}

async function cancelActiveGeneration() {
  const pid =
    (isGenerationUiActive(projectId) && projectId)
    || generationWatchPid
    || viewportOverlayPid
    || projectId;
  if (!pid || !isGenerationUiActive(pid)) return;

  userCancelRequested = true;
  activePromptGenerationId++;
  activePromptAbort?.abort();
  activePromptAbort = null;

  const btn = document.getElementById("btn-stop-generation");
  const wiringBtn = document.getElementById("btn-wiring-stop");
  const wiringToolbeltBtn = document.getElementById("btn-wiring-toolbelt-stop");
  if (btn) btn.disabled = true;
  if (wiringBtn) wiringBtn.disabled = true;
  if (wiringToolbeltBtn) wiringToolbeltBtn.disabled = true;
  try {
    await api(`/api/projects/${pid}/generation/cancel`, { method: "POST" });
    if (pid === projectId) {
      const isWiring = generationWatchOverlay?.kind === "wiring";
      const stopMode = (generationWatchOverlay?.promptMode || "").toLowerCase();
      const isV2 = stopMode === "v2";
      const isFusion = stopMode === "fusion";
      const statusEl = document.getElementById(isWiring ? "wiring-prompt-status" : "prompt-status");
      if (statusEl) {
        statusEl.className = "status";
        statusEl.textContent = isWiring
          ? "Stopping… killing generation now"
          : isFusion
            ? "Stopping Fusion mode… killing generation now"
          : isV2
            ? "Stopping 2.0… killing generation now"
            : "Stopping… killing generation now";
      }
    }
    let gen;
    try {
      gen = await api(`/api/projects/${pid}/generation`);
    } catch (_) {
      /* best-effort status check */
    }
    if (gen?.status === "running") {
      if (!generationPollTimer) {
        beginGenerationWatch(pid, {
          kind: gen.kind || "prompt",
          mode: generationPromptMode(gen, generationWatchOverlay?.promptMode || "standard"),
        });
      }
    } else {
      stopGenerationWatch();
      hideViewportOverlay(pid);
      document.getElementById("btn-prompt")?.removeAttribute("disabled");
      document.getElementById("btn-wiring-prompt")?.removeAttribute("disabled");
      document.getElementById("btn-wiring-toolbelt-generate")?.removeAttribute("disabled");
      userCancelRequested = false;
      if (gen?.status === "canceled" && pid === projectId) {
        const statusEl = document.getElementById(gen.kind === "wiring" ? "wiring-prompt-status" : "prompt-status");
        if (statusEl) {
          statusEl.className = "status";
          statusEl.textContent = gen.error || "Generation canceled.";
        }
      }
    }
  } catch (err) {
    const statusEl = document.getElementById(generationWatchOverlay?.kind === "wiring" ? "wiring-prompt-status" : "prompt-status");
    if (statusEl && pid === projectId) {
      statusEl.className = "status error";
      statusEl.textContent = formatUserError(err);
    }
  } finally {
    if (btn) btn.disabled = false;
    if (wiringBtn) wiringBtn.disabled = false;
    if (wiringToolbeltBtn) wiringToolbeltBtn.disabled = false;
    syncStopButtonVisibility();
  }
}

function promptGenerationOverlayOpts(mode = "standard") {
  const normalized = (mode || "standard").toLowerCase();
  if (normalized === "fusion") {
    return {
      message: "Fusion is revolving geometry... building, rendering, reviewing, and repairing.",
      mode: "ai",
      estimateMs: 1200000,
    };
  }
  if (normalized === "v2") {
    return {
      message: "Generating with 2.0 in background... refresh anytime; model loads when ready.",
      mode: "ai",
      estimateMs: 900000,
    };
  }
  return {
    message: "Generating in background… (safe to refresh)",
    mode: "ai",
    estimateMs: 360000,
  };
}

function generationPromptMode(generation = {}, fallback = "standard") {
  const explicitRaw =
    generation?.mode ||
    generation?.prompt_mode ||
    generation?.promptMode ||
    generation?.request_body?.mode ||
    generation?.request_body?.prompt_mode;
  const text = String(explicitRaw || "").toLowerCase();
  if (text === "fusion" || text === "fusion360" || text === "fusion-360") return "fusion";
  if (text === "architect" || text === "architecture") return "architect";
  if (text === "v2" || text === "2.0" || text === "2") return "v2";
  if (text === "draw") return "draw";
  const searchable = String([
    generation?.message,
    generation?.label,
    generation?.prompt,
    generation?.progress?.label,
  ].filter(Boolean).join(" "));
  if (searchable.match(/\bfusion\b/i)) return "fusion";
  if (searchable.match(/\barchitect(?:ure)?\b/i)) return "architect";
  if (searchable.match(/\b(v2|2\.0)\b/i)) return "v2";
  const fallbackText = String(fallback || "standard").toLowerCase();
  if (fallbackText === "fusion" || fallbackText === "fusion360" || fallbackText === "fusion-360") return "fusion";
  if (fallbackText === "architect" || fallbackText === "architecture") return "architect";
  if (fallbackText === "v2" || fallbackText === "2.0" || fallbackText === "2") return "v2";
  return fallbackText === "draw" ? "draw" : "standard";
}

function applyPromptModeUI(mode = promptMode) {
  promptMode = mode || "render";
  document.querySelectorAll("[data-prompt-mode]").forEach((b) => {
    b.classList.toggle("active", (b.dataset.promptMode || "render") === promptMode);
  });
  const promptBtn = document.getElementById("btn-prompt");
  if (promptBtn) {
    if (promptMode === "render") promptBtn.textContent = "Render scene";
    else if (promptMode === "draw") promptBtn.textContent = "Apply Draw command";
    else if (promptMode === "architect") promptBtn.textContent = "Generate modular house part";
    else if (promptMode === "fusion") promptBtn.textContent = `Generate with ${fusionTargetLabel()}`;
    else if (promptMode === "v2") promptBtn.textContent = "Generate with 2.0";
    else promptBtn.textContent = "Generate / modify with AI";
  }
  const input = document.getElementById("prompt-input");
  if (input) {
    input.placeholder = promptMode === "render"
      ? "Describe the real-life environment to render. Example: put this model on a kitchen counter in morning light..."
      : "Describe what to make or edit. Drag parts/faces here to add @ reference chips...";
  }
  if (promptMode === "architect") {
    setSkillEnabled("cad", true);
    setSkillEnabled("architect", true);
    skillsPromptUI?.render?.();
    skillsPromptUI?.updatePlan?.();
  }
}

function beginGenerationWatch(pid = projectId, { kind = "prompt", mode = "standard", pendingStart = false } = {}) {
  if (!pid) return;
  if (generationPollTimer) {
    clearInterval(generationPollTimer);
    generationPollTimer = null;
  }
  generationWatchPid = pid;
  if (currentUser) {
    upsertProjectInList({
      id: pid,
      generation: {
        ...(allProjects.find((p) => p.id === pid)?.generation || {}),
        status: "running",
        kind,
        by_user_id: currentUser.id,
        by_user_name: currentUser.display_name,
        by_avatar_url: currentUser.avatar_url,
      },
    });
    renderProjectList();
  }
  if (kind === "wiring") {
    generationWatchOverlay = {
      kind,
      promptMode: "wiring",
      startedAt: Date.now(),
      pendingStart: !!pendingStart,
      message: "Generating wiring schematic… (safe to refresh)",
      mode: "ai",
      estimateMs: 120000,
    };
  } else if (kind === "build") {
    generationWatchOverlay = {
      kind,
      promptMode: "build",
      startedAt: Date.now(),
      pendingStart: !!pendingStart,
      message: "Building in background… (safe to refresh)",
      mode: "build",
      estimateMs: 90000,
    };
  } else {
    generationWatchOverlay = {
      kind,
      promptMode: mode,
      startedAt: Date.now(),
      pendingStart: !!pendingStart,
      ...promptGenerationOverlayOpts(mode),
    };
  }
  setProjectLoading(pid, true);
  if (kind === "wiring") {
    showAiComposePanel();
  } else if (kind !== "build") {
    showAiComposePanel();
  }
  syncViewportGenerationOverlay();
  if (kind === "wiring") {
    document.getElementById("btn-wiring-prompt")?.setAttribute("disabled", "true");
    document.getElementById("btn-wiring-toolbelt-generate")?.setAttribute("disabled", "true");
    const wiringStatus = document.getElementById("wiring-prompt-status");
    if (wiringStatus && pid === projectId) {
      wiringStatus.className = "status loading";
      wiringStatus.textContent = "Generating schematic… safe to refresh.";
    }
  } else {
    document.getElementById("btn-prompt")?.setAttribute("disabled", "true");
    const statusEl = document.getElementById("prompt-status");
    if (statusEl && pid === projectId) {
      statusEl.className = "status loading";
      statusEl.textContent =
        (mode || "standard").toLowerCase() === "fusion"
          ? "Generating with Fusion mode in background... building, rendering, reviewing, and repairing."
          : (mode || "standard").toLowerCase() === "v2"
          ? "Generating with 2.0 in background... refresh anytime; model loads when ready."
          : "Generating in background… safe to refresh.";
    }
    if (["v2", "fusion", "architect"].includes((mode || "standard").toLowerCase()) && pid === projectId) {
      applyPromptModeUI((mode || "standard").toLowerCase());
    }
  }
  syncStopButtonVisibility();

  const poll = async () => {
    try {
      const gen = await api(`/api/projects/${pid}/generation`);
      const proj = allProjects.find((p) => p.id === pid);
      if (proj) proj.generation = gen;
      if (gen.status === "running") {
        if (generationWatchOverlay) {
          const liveMode = generationPromptMode(gen, generationWatchOverlay.promptMode || mode);
          Object.assign(generationWatchOverlay, {
            promptMode: liveMode,
            pendingStart: false,
            progress: gen.progress,
            ...promptGenerationOverlayOpts(liveMode),
          });
        }
        syncViewportGenerationOverlay();
        syncExplorerLoadingUI();
        syncStopButtonVisibility();
        syncCanvasGenerationUi();
        return;
      }
      const watchAgeMs = Math.max(0, Date.now() - Number(generationWatchOverlay?.startedAt || Date.now()));
      if (
        (!gen.status || gen.status === "idle") &&
        (generationWatchOverlay?.pendingStart || watchAgeMs < 20_000)
      ) {
        syncStopButtonVisibility();
        syncCanvasGenerationUi();
        return;
      }
      stopGenerationWatch();
      userCancelRequested = false;
      if (gen.status === "complete") {
        if (gen.kind === "wiring") {
          if (!wasGenerationApplied(pid, gen.trace_id)) {
            await applyWiringGenerationComplete(gen, pid);
          } else if (pid === projectId) {
            const schematic = await api(`/api/projects/${pid}/wiring`);
            wiringSim.applySchematic(schematic);
            invalidateWiringPrefetch();
            await refreshFiles();
            await refreshWiringPromptHistory();
          }
        } else if (!wasGenerationApplied(pid, gen.trace_id)) {
          await applyGenerationComplete(gen, pid);
        } else if (pid === projectId) {
          await refreshFiles();
          await refreshTimeline();
          await refreshPromptHistory();
          const statusEl = document.getElementById("prompt-status");
          if (statusEl && gen.filename) {
            const ref = gen.prompt_id
              ? formatPromptRef({
                  promptId: gen.prompt_id,
                  projectId: pid,
                  filename: gen.filename,
                  traceId: gen.trace_id,
                  promptMode: gen.mode || gen.prompt_mode,
                  model: gen.model,
                  provider: gen.provider,
                })
              : "";
            statusEl.className = "status ok";
            statusEl.textContent = ref ? `Model ready · ${ref}` : "Model ready.";
          }
        }
      } else if (gen.status === "failed") {
        const msg = formatUserError({ message: gen.error || "Generation failed." });
        const copyContext = {
          promptId: gen.prompt_id,
          projectId: pid,
          filename: gen.filename || selectedFile,
          traceId: gen.trace_id,
          promptText: gen.prompt || lastPromptCopyContext?.promptText,
        };
        const statusEl = document.getElementById(gen.kind === "wiring" ? "wiring-prompt-status" : "prompt-status");
        if (statusEl) {
          statusEl.className = "status error";
          statusEl.textContent = msg;
        }
        if (pid === projectId) {
          if (gen.kind === "wiring") {
            wiringOverlay?.showError(msg, copyContext);
            await refreshWiringPromptHistory();
          } else {
            viewerOverlay.showError(msg, copyContext);
            await refreshPromptHistory();
          }
        }
      } else if (gen.status === "canceled") {
        const msg = gen.error || "Generation canceled.";
        const statusEl = document.getElementById(gen.kind === "wiring" ? "wiring-prompt-status" : "prompt-status");
        if (statusEl && pid === projectId) {
          statusEl.className = "status";
          statusEl.textContent = msg;
        }
        if (pid === projectId) {
          viewerOverlay.clearError();
          wiringOverlay?.clearError();
        }
      }
      syncExplorerLoadingUI();
      document.getElementById("btn-wiring-prompt")?.removeAttribute("disabled");
      document.getElementById("btn-wiring-toolbelt-generate")?.removeAttribute("disabled");
    } catch (err) {
      console.warn("generation poll failed", err);
    }
  };
  poll();
  generationPollTimer = setInterval(poll, 2500);
  syncStopButtonVisibility();
  syncCanvasGenerationUi();
}

async function resumeGenerationIfNeeded(pid, generation) {
  if (!pid || !generation || generation.status === "idle") {
    if (pid === projectId) syncStopButtonVisibility();
    return;
  }
  if (generation.status === "running") {
    beginGenerationWatch(pid, {
      kind: generation.kind || "prompt",
      mode: generationPromptMode(generation),
    });
    return;
  }
  if (generation.status === "complete" && !wasGenerationApplied(pid, generation.trace_id)) {
    if (generation.kind === "wiring") {
      await applyWiringGenerationComplete(generation, pid);
      return;
    }
    await applyGenerationComplete(generation, pid);
  }
}

initPanelResize();

const viewportHint = document.getElementById("viewport-hint");
const pickHintTitle = document.getElementById("pick-hint-title");
const pickHintText = document.getElementById("pick-hint-text");

const viewport = document.getElementById("viewport");
if (!viewport) {
  throw new Error("Render3D: #viewport element missing from page");
}
const scene = new THREE.Scene();
scene.background = new THREE.Color(FUSION.canvas);
const APP_THEME_KEY = "render3d:app-theme:v1";
const DEFAULT_APP_THEME = "dark";
const APP_THEMES = {
  dark: {
    label: "Dark",
    canvas: FUSION.canvas,
    gridMajor: FUSION.gridMajor,
    gridMinor: FUSION.gridMinor,
  },
  light: {
    label: "Light",
    canvas: 0xdbeafe,
    gridMajor: 0x8ea7c8,
    gridMinor: 0xb9cbea,
  },
};
function normalizedAppTheme(theme) {
  return Object.prototype.hasOwnProperty.call(APP_THEMES, theme) ? theme : DEFAULT_APP_THEME;
}
let appTheme = (() => {
  try {
    return normalizedAppTheme(localStorage.getItem(APP_THEME_KEY));
  } catch {
    return DEFAULT_APP_THEME;
  }
})();
function currentThemeSceneColors() {
  return APP_THEMES[appTheme] || APP_THEMES.dark;
}
function applyThemeClass() {
  document.body?.classList.toggle("theme-light", appTheme === "light");
  document.body?.classList.toggle("theme-dark", appTheme !== "light");
  document.documentElement?.style.setProperty("color-scheme", appTheme === "light" ? "light" : "dark");
}
applyThemeClass();
scene.background.setHex(currentThemeSceneColors().canvas);

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 20000);
camera.up.copy(VIEW_CUBE_WORLD_UP);
// Start far enough back so the viewport isn't zoomed into the origin
// before the first model loads and triggers fitCamera.
camera.position.set(6, -6, 4.5);

function createFallbackRenderer(error) {
  const canvas = document.createElement("canvas");
  canvas.className = "webgl-fallback-canvas";
  canvas.setAttribute("aria-label", "3D viewport unavailable");
  const message = document.createElement("div");
  message.className = "webgl-fallback-message";
  message.innerHTML = `
    <strong>3D viewport unavailable</strong>
    <span>Your browser could not create a WebGL context. You can still sign in, create an account, and use non-3D panels.</span>
    <small>${appEscapeHtml(error?.message || "WebGL is disabled or unsupported on this device.")}</small>
  `;
  viewport.appendChild(message);
  return {
    domElement: canvas,
    shadowMap: {},
    clippingPlanes: [],
    localClippingEnabled: false,
    setPixelRatio() {},
    setSize(w, h) {
      canvas.width = Math.max(1, Math.floor(w || 1));
      canvas.height = Math.max(1, Math.floor(h || 1));
      canvas.style.width = `${Math.max(1, Math.floor(w || 1))}px`;
      canvas.style.height = `${Math.max(1, Math.floor(h || 1))}px`;
    },
    render() {},
    dispose() {},
  };
}

let renderer;
let webglAvailable = true;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
  setupRenderer(renderer);
} catch (err) {
  webglAvailable = false;
  console.error("WebGL renderer failed; continuing with UI-only fallback.", err);
  renderer = createFallbackRenderer(err);
}
renderer.domElement.tabIndex = 0;  // allow canvas to receive keyboard focus
renderer.domElement.style.outline = "none";
renderer.domElement.classList.toggle("webgl-unavailable", !webglAvailable);
viewport.appendChild(renderer.domElement);

function errorCopyContext(extra = {}) {
  const ctx = { ...(lastPromptCopyContext || {}), ...extra };
  const promptId = ctx.promptId || ctx.prompt_id || ctx.id;
  const traceId = ctx.traceId || ctx.trace_id;
  const filename = ctx.filename || ctx.file || selectedFile;
  const pid = ctx.projectId || ctx.project_id || projectId;
  return {
    ref: promptId
      ? formatPromptRef({
          promptId,
          projectId: pid,
          filename,
          traceId,
          promptMode: ctx.promptMode || ctx.mode || ctx.prompt_mode,
          model: ctx.model,
          provider: ctx.provider,
        })
      : "",
    projectId: pid,
    filename,
    traceId,
    promptText: ctx.promptText || ctx.prompt || "",
  };
}

const viewerOverlay = createViewerOverlay(viewport, {
  fetchLogs: () => rawFetch("/api/logs?limit=40"),
  onStopGeneration: () => void cancelActiveGeneration(),
  getCopyContext: errorCopyContext,
});
const sceneLights = setupSceneLighting(scene);
const VIEWPORT_LIGHTING_KEY = "render3d.viewportLightingPct";
const sceneLightBaseIntensities = new Map(
  Object.values(sceneLights || {})
    .filter((light) => light && typeof light.intensity === "number")
    .map((light) => [light, light.intensity])
);

function applyViewportLighting(percent) {
  const pct = Math.min(180, Math.max(35, Number(percent) || 100));
  const multiplier = pct / 100;
  for (const [light, base] of sceneLightBaseIntensities) {
    light.intensity = base * multiplier;
  }
  const value = document.getElementById("viewport-light-value");
  if (value) value.textContent = `${Math.round(pct)}%`;
  return pct;
}

function initViewportLightingControl() {
  const slider = document.getElementById("viewport-light-slider");
  if (!slider) return;
  const panel = document.querySelector(".viewport-lighting-tab");
  let saved = Number(slider.value || slider.max || 180);
  try {
    const raw = localStorage.getItem(VIEWPORT_LIGHTING_KEY);
    if (raw != null) saved = Number(raw);
  } catch {
    /* local storage is best-effort */
  }
  slider.value = String(applyViewportLighting(saved));
  slider.addEventListener("input", () => {
    const pct = applyViewportLighting(slider.value);
    try {
      localStorage.setItem(VIEWPORT_LIGHTING_KEY, String(pct));
    } catch {
      /* local storage is best-effort */
    }
  });
  const syncLightToggle = () => {
    const btn = document.getElementById("btn-light");
    const open = !!panel && !panel.classList.contains("hidden");
    btn?.classList.toggle("active", open);
    btn?.setAttribute("aria-pressed", open ? "true" : "false");
    if (btn) btn.title = open ? "Hide viewport lighting slider" : "Show viewport lighting slider";
  };
  document.addEventListener("click", (event) => {
    const lightBtn = event.target.closest?.("#btn-light");
    if (lightBtn) {
      panel?.classList.toggle("hidden");
      syncLightToggle();
      return;
    }
    if (!panel || panel.classList.contains("hidden")) return;
    if (event.target.closest?.(".viewport-lighting-tab")) return;
    panel.classList.add("hidden");
    syncLightToggle();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !panel || panel.classList.contains("hidden")) return;
    panel.classList.add("hidden");
    syncLightToggle();
  });
  syncLightToggle();
}

initViewportLightingControl();
const projectAssembly = createProjectAssembly(scene);
scene.add(getMarkersGroup());
scene.add(getHoverGroup());
scene.add(getMeasureAnnotGroup());
scene.add(getMeasureHoverGroup());

const controls = new TrackballControls(camera, renderer.domElement);
controls._up0?.copy(VIEW_CUBE_WORLD_UP);
controls.rotateSpeed  = 2.0;    // feel close to old OrbitControls
controls.zoomSpeed    = 1.2;
controls.panSpeed     = 0.8;
controls.staticMoving = true;   // no inertia (matches enableDamping=false)
controls.minDistance  = 0.05;
controls.maxDistance  = Infinity;

const LEFT_DRAG_MODE_KEY = "render3d:left-drag-mode:v1";
const MOUSE_CONTROL_PRESET_KEY = "render3d:mouse-control-preset:v1";
const MOUSE_CONTROL_PRESETS = {
  render3d: {
    label: "Render3D default",
    hint: "Left drag uses the toolbar Select/Rotate toggle. Middle-drag pans. Right-drag rotates.",
  },
  solidworks: {
    label: "SolidWorks",
    hint: "Middle-drag orbits, Ctrl/Cmd+middle pans, Shift+middle zooms, mouse wheel zooms.",
  },
  fusion360: {
    label: "Fusion 360",
    hint: "Middle-drag pans, Shift+middle orbits, Ctrl/Cmd+middle zooms, mouse wheel zooms.",
  },
  onshape: {
    label: "Onshape",
    hint: "Right-drag orbits, middle-drag pans, mouse wheel zooms, and left drag stays available for selection.",
  },
};
const MOBILE_INTERACTION_QUERY = window.matchMedia?.("(max-width: 820px), (pointer: coarse) and (max-width: 1024px)");
function isMobileInteraction() {
  return Boolean(MOBILE_INTERACTION_QUERY?.matches);
}
function normalizedMousePreset(preset) {
  return Object.prototype.hasOwnProperty.call(MOUSE_CONTROL_PRESETS, preset) ? preset : "render3d";
}
function isCadMousePreset(preset = mouseControlPreset) {
  return !isMobileInteraction() && normalizedMousePreset(preset) !== "render3d";
}
let mouseControlPreset = (() => {
  try {
    const saved = localStorage.getItem(MOUSE_CONTROL_PRESET_KEY);
    return normalizedMousePreset(saved);
  } catch {
    return "render3d";
  }
})();
let leftDragMode = (() => {
  if (isMobileInteraction()) return "rotate";
  try {
    return localStorage.getItem(LEFT_DRAG_MODE_KEY) === "rotate" ? "rotate" : "select";
  } catch {
    return "select";
  }
})();
if (isCadMousePreset()) {
  leftDragMode = "select";
}

let architectControlsActive = false;
/** @type {null | { pointerId: number, lastX: number, lastY: number, controlsWereEnabled: boolean }} */
let architectZOrbit = null;

function applyLeftDragMouseButtons() {
  if (!controls?.mouseButtons) return;
  // Architect owns LMB for painting walls; MMB pans; Shift+MMB orbits Z in custom handlers.
  if (architectControlsActive) {
    controls.mouseButtons.LEFT = -1;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = -1;
    return;
  }
  const effectiveMode = isMobileInteraction() ? "rotate" : leftDragMode;
  if (isCadMousePreset()) {
    controls.mouseButtons.LEFT = -1; // CAD presets keep left click/drag available for selection.
    if (mouseControlPreset === "solidworks") {
      controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
      controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    } else {
      controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
      controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    }
    return;
  }
  if (effectiveMode === "select") {
    controls.mouseButtons.LEFT = -1; // left drag belongs to selection/marquee
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  } else {
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  }
}
applyLeftDragMouseButtons();

function syncMousePreferenceUI() {
  const select = document.getElementById("pref-mouse-preset");
  if (select) select.value = mouseControlPreset;
  const hint = document.getElementById("pref-mouse-preset-hint");
  if (hint) hint.textContent = MOUSE_CONTROL_PRESETS[mouseControlPreset]?.hint || "";
}

function setMouseControlPreset(preset, { announce = false } = {}) {
  mouseControlPreset = normalizedMousePreset(preset);
  if (isCadMousePreset(mouseControlPreset)) {
    leftDragMode = "select";
    try {
      localStorage.setItem(LEFT_DRAG_MODE_KEY, leftDragMode);
    } catch {
      /* local storage is best-effort */
    }
  }
  try {
    localStorage.setItem(MOUSE_CONTROL_PRESET_KEY, mouseControlPreset);
  } catch {
    /* local storage is best-effort */
  }
  applyLeftDragModeControls();
  syncLeftDragModeButton();
  syncMousePreferenceUI();
  if (announce) {
    setEditStatus("ok", `${MOUSE_CONTROL_PRESETS[mouseControlPreset].label} controls enabled.`);
  }
}

function withCadMiddleMouseModifier(event) {
  if (architectControlsActive) return;
  if (!isCadMousePreset() || event.button !== 1 || !controls?.mouseButtons) return;
  if (mouseControlPreset === "solidworks") {
    if (event.ctrlKey || event.metaKey) controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    else if (event.shiftKey) controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    else controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    return;
  }
  if (mouseControlPreset === "fusion360") {
    if (event.shiftKey) controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    else if (event.ctrlKey || event.metaKey) controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    else controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    return;
  }
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
}

function resetCadMiddleMouseModifier() {
  if (!isCadMousePreset() || !controls?.mouseButtons) return;
  applyLeftDragMouseButtons();
}

renderer.domElement.addEventListener("mousedown", withCadMiddleMouseModifier, true);
renderer.domElement.addEventListener("pointerdown", withCadMiddleMouseModifier, true);
window.addEventListener("mouseup", resetCadMiddleMouseModifier, true);
window.addEventListener("pointerup", resetCadMiddleMouseModifier, true);

// ── Section View (cross-section clipping plane) ───────────────────────────
const sectionView = createSectionView({
  renderer,
  scene,
  camera,
  getModelBounds: () => {
    if (!currentMesh) return null;
    const box = new THREE.Box3();
    box.setFromObject(currentMesh);
    if (!box.isEmpty()) return box;
    return null;
  },
});

function sceneRadius() {
  const box = projectAssembly.boundingBox() || (currentMesh ? new THREE.Box3().setFromObject(currentMesh) : null);
  if (!box) return 1;
  return Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, 0.1);
}

function normalizeBrowser(data) {
  const browser = data?.browser || {};
  let components = (browser.components || []).filter((entry) => !isInternalCadSidecar(entry?.name) && !isInternalCadSidecar(entry?.viewer_filename));
  if (!components.length && data?.files?.length) {
    components = filesToBrowserComponents((data.files || []).filter((file) => !isDxfDrawingFilename(file?.name)));
  }
  const browserDrawings = (browser.drawings || []).filter((entry) => !isInternalCadSidecar(entry?.name));
  const seenDrawings = new Set(browserDrawings.map((entry) => entry.name).filter(Boolean));
  const fileDrawings = (data?.files || [])
    .filter((file) => isDxfDrawingFilename(file?.name) && !isInternalCadSidecar(file?.name) && !seenDrawings.has(file.name))
    .map((file) => ({
      id: file.id || file.stem || fileStem(file.name),
      name: file.name,
      stem: file.stem || fileStem(file.name),
      format: "dxf",
      size: file.size,
    }));
  return {
    components,
    sketches: browser.sketches || [],
    wiring: browser.wiring || [],
    drawings: [...browserDrawings, ...fileDrawings],
  };
}

function isInternalCadSidecar(name = "") {
  const lower = String(name || "").toLowerCase();
  return (
    lower.startsWith("_active_")
    || lower.startsWith("_export_")
    || lower.endsWith(".ezdxf.dxf")
    || (lower.startsWith(".") && lower.endsWith(".step.glb"))
  );
}

function isDxfDrawingFilename(name = "") {
  return /\.dxf$/i.test(String(name || ""));
}

async function openDxfDrawingByName(filename, opts = {}) {
  if (!filename) return false;
  const pid = opts.projectId ?? projectId;
  if (!pid) {
    setEditStatus("error", "Select a project before opening a DXF drawing.");
    return false;
  }
  selectedFile = filename;
  projectTree.setSelected(filename);
  await dxfViewer.openTab(filename, {
    projectId: pid,
    label: opts.label || filename.replace(/\.dxf$/i, ""),
  });
  viewerOverlay.clearError();
  setEditStatus("ok", `Opened ${filename.replace(/\.dxf$/i, "")} in Drawings.`);
  return true;
}

let mobileBrowserComponents = [];

function formatComponentDisplayLabel(value = "") {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase()) || "Model";
}

function renderMobileModelPicker() {
  const list = document.getElementById("mobile-model-list");
  if (!list) return;
  const comps = mobileBrowserComponents || [];
  if (!comps.length) {
    list.innerHTML = `<p class="muted small browser-empty">No models in this project yet.</p>`;
    return;
  }
  list.innerHTML = comps
    .map((entry) => {
      const active = entry.name === selectedFile || entry.viewer_filename === selectedFile;
      const label = formatComponentDisplayLabel(entry.label || entry.stem || entry.name || "Model");
      const format = String(entry.format || entry.name?.split(".").pop() || "model").toUpperCase();
      return `<button type="button" class="mobile-model-item ${active ? "active" : ""}" data-mobile-model="${appEscapeHtml(entry.name)}">
        <span><strong>${appEscapeHtml(label)}</strong><span>${appEscapeHtml(entry.name || "")}</span></span>
        <em class="mobile-model-format">${appEscapeHtml(format)}</em>
      </button>`;
    })
    .join("");
  list.querySelectorAll("[data-mobile-model]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.mobileModel;
      const entry = comps.find((c) => c.name === name);
      if (!entry) return;
      closeMobileModelPicker();
      await openBrowserComponent(entry);
      renderMobileModelPicker();
    });
  });
}

function openMobileModelPicker() {
  renderMobileModelPicker();
  document.getElementById("mobile-model-picker")?.classList.remove("hidden");
}

function closeMobileModelPicker() {
  document.getElementById("mobile-model-picker")?.classList.add("hidden");
}

function catalogNameForMesh(mesh) {
  if (!mesh) return null;
  let o = mesh;
  const assemblyRoot = projectAssembly.getRoot();
  while (o && o !== assemblyRoot) {
    if (o.userData?.catalogFilename) return o.userData.catalogFilename;
    o = o.parent;
  }
  return null;
}

function componentRootForMesh(mesh) {
  if (!mesh) return null;
  const catalogName = catalogNameForMesh(mesh);
  if (catalogName) return projectAssembly.get(catalogName) || mesh;
  return mesh;
}

function selectionTargetFromMesh(hitMesh) {
  const catalogName = catalogNameForMesh(hitMesh);
  const comp = catalogName ? projectAssembly.get(catalogName) : null;
  const root = comp || componentRootForMesh(hitMesh) || currentMesh;
  const mesh = comp && isLocalAssemblyObject(catalogName, comp) ? comp : (hitMesh || comp);
  return { mesh, root, catalogName };
}

function selectAssemblyComponent(catalogName, { autoGizmo = false, fitView = false } = {}) {
  const obj = projectAssembly.get(catalogName);
  if (!obj) return;
  if (isComponentHidden(catalogName)) {
    projectAssembly.setVisible(catalogName, false);
    setEditStatus("ok", "Component is hidden. Use the eye icon or right-click Show object to make it visible.");
    return;
  }
  projectAssembly.setVisible(catalogName, true);
  selectedFile = catalogName;
  syncPromptTargetUI();
  projectTree.setSelected(catalogName);
  featureEditor.setModel(projectId, catalogName);
  objectTools.selectObject?.({ mesh: obj, root: obj, bodyIndex: 0, catalogName });
  if (autoGizmo) {
    showObjectGizmo(obj, "translate", { switchTab: false });
  }
  if (fitView) fitCameraToComponent(catalogName);
  syncExportButton();
}

function bodyIndexForHitMesh(hitMesh, root, faceIndex = null) {
  const meshes = listObjectMeshes(root);
  if (meshes.length > 1) {
    const idx = meshes.indexOf(hitMesh);
    if (idx >= 0) return idx;
  }
  const info = objectTools.getBodyInfo?.();
  const offsets = info?.face_offsets || [];
  if (faceIndex != null && offsets.length) {
    for (let i = offsets.length - 1; i >= 0; i -= 1) {
      if (faceIndex >= offsets[i]) return i;
    }
  }
  return 0;
}

function browserBodySelectionName(catalogName, bodyIndex) {
  if (!catalogName || !Number.isInteger(bodyIndex)) return catalogName;
  const parent = projectTree.getComponents?.().find((entry) => entry.name === catalogName || entry.viewer_filename === catalogName);
  const child = (parent?.children || []).find((entry) => entry.body_index === bodyIndex);
  return child?.name || catalogName;
}

function selectObjectHit(hit, { showGizmo = true } = {}) {
  if (!hit?.mesh) return null;
  const target = selectionTargetFromMesh(hit.mesh);
  const wholeLocalModule = target.catalogName && isLocalAssemblyObject(target.catalogName, target.root);
  const bodyIndex = wholeLocalModule ? 0 : bodyIndexForHitMesh(hit.mesh, target.root, hit.faceIndex);
  if (target.catalogName) {
    selectedFile = target.catalogName;
    syncPromptTargetUI();
    projectTree.setSelected(wholeLocalModule ? target.catalogName : browserBodySelectionName(target.catalogName, bodyIndex));
    featureEditor.setModel(projectId, target.catalogName);
  }
  objectTools.selectObject({ ...target, faceIndex: wholeLocalModule ? null : hit.faceIndex, bodyIndex });
  if (showGizmo) showObjectGizmo(target.mesh, "translate", { switchTab: false });
  renderer.domElement.focus({ preventScroll: true });
  syncExportButton();
  return target;
}

async function selectBrowserBody(entry, { fitView = false } = {}) {
  const catalogName = entry?.source_filename || entry?.parent_filename || entry?.filename || entry?.name;
  const bodyIndex = Number.isInteger(entry?.body_index) ? entry.body_index : null;
  if (!catalogName || bodyIndex == null) return false;
  if (!projectAssembly.has(catalogName)) return false;
  selectedFile = catalogName;
  projectTree.setSelected(entry.name);
  featureEditor.setModel(projectId, catalogName);
  await objectTools.refreshBodyInfo?.();
  const root = projectAssembly.get(catalogName);
  const meshes = listObjectMeshes(root);
  const mesh = meshes[bodyIndex] || meshes[0] || root;
  objectTools.selectObject?.({
    mesh,
    root,
    bodyIndex,
    catalogName,
  });
  if (fitView) fitCameraToComponent(catalogName);
  setEditStatus("ok", `Selected ${entry.body_name || entry.label || `Body ${bodyIndex + 1}`} inside ${catalogName}.`);
  syncPromptTargetUI();
  syncExportButton();
  return true;
}

function selectBrowserVirtualComponent(entry, { fitView = false } = {}) {
  const catalogName = entry?.source_filename || entry?.parent_filename || entry?.filename || entry?.name;
  if (!catalogName || !projectAssembly.has(catalogName)) return false;
  selectedFile = catalogName;
  projectTree.setSelected(entry.name);
  featureEditor.setModel(projectId, catalogName);
  const root = projectAssembly.get(catalogName);
  const targetName = String(entry.node_name || entry.component_name || entry.stem || "").toLowerCase();
  const meshes = listObjectMeshes(root);
  const mesh = meshes.find((item) => {
    const names = [item.name, item.userData?.name, item.parent?.name].filter(Boolean).map((name) => String(name).toLowerCase());
    return names.includes(targetName) || names.some((name) => name.includes(targetName) || targetName.includes(name));
  }) || meshes[entry.component_index] || meshes[0] || root;
  objectTools.selectObject?.({
    mesh,
    root,
    bodyIndex: Number.isInteger(entry.component_index) ? entry.component_index : 0,
    catalogName,
  });
  if (fitView) fitCameraToComponent(catalogName);
  setEditStatus("ok", `Selected component ${entry.label || entry.component_name || entry.stem} inside ${catalogName}.`);
  syncPromptTargetUI();
  syncExportButton();
  return true;
}

/** Switch to Select tool and show the move gizmo on the chosen mesh. */
function showObjectGizmo(mesh, mode = "translate", { switchTab = true } = {}) {
  if (directModeling.isToolActive?.()) return;
  const target = mesh || objectTools.getSelection()?.mesh;
  if (!target) return;
  if (switchTab) setRightTab("tools");
  activatePickMode("object");
  directModeling.reset();
  meshCleanup.hide();
  document.getElementById("btn-gizmo")?.classList.add("active");
  setLeftDragMode("rotate", { silent: true });
  transformControls.attach(target);
  transformControls.setMode(mode);
  controls.enabled = true;
  gizmoPanel.show();
  gizmoPanel.refresh();
  setEditStatus("ok", `${mode === "rotate" ? "Rotate" : mode === "scale" ? "Scale" : "Move"}: drag the gizmo or type values in the panel.`);
}

const viewCube = createViewCube({
  container: viewport,
  camera,
  controls,
  getSceneRadius: sceneRadius,
});

const transformControls = new TransformControls(camera, renderer.domElement);
let transformGizmoDragging = false;
let suppressSelectionUntil = 0;
let collabTransformBroadcastAt = 0;
transformControls.addEventListener("dragging-changed", (e) => {
  transformGizmoDragging = Boolean(e.value);
  if (transformGizmoDragging) {
    suppressSelectionUntil = performance.now() + 450;
    suppressNextObjectClick = true;
    sendCollabPresence({ moving: true });
  } else {
    suppressSelectionUntil = performance.now() + 350;
    window.setTimeout(() => {
      suppressNextObjectClick = false;
    }, 350);
    sendCollabPresence({ moving: false });
    if (document.body.classList.contains("architect-design-tab")) {
      tryArchitectLegoSnap(transformControls.object);
    }
  }
  controls.enabled = !e.value;
});
transformControls.addEventListener("objectChange", () => {
  if (!transformGizmoDragging) return;
  const now = performance.now();
  if (now - collabTransformBroadcastAt < 90) return;
  collabTransformBroadcastAt = now;
  sendCollabPresence({ moving: true });
});
// Add only the gizmo helper — adding TransformControls itself to the scene causes runaway rotation
scene.add(transformControls.getHelper());

let gridVisible = true;
let gridHelper = null;
const SKETCH_CANVAS = 0xe8e8e8;
let savedSceneBg = null;
let gridAxesGroup = null;
let gridDotsGroup = null;
let axesHelper = null;

function disposeSceneObject(obj) {
  obj?.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
    else child.material?.dispose?.();
  });
}

function niceGridSize(radius) {
  const desired = Math.max(radius * 7, 10);
  const pow = 10 ** Math.floor(Math.log10(desired));
  for (const m of [1, 2, 5, 10]) {
    if (pow * m >= desired) return pow * m;
  }
  return pow * 10;
}

function makeAxisLine(points, color) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color, depthTest: true, depthWrite: false, transparent: true, opacity: 0.88 });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = -9;
  return line;
}

function makeGridDepthAware(grid) {
  // Let object geometry occlude the grid. The slight negative offset prevents
  // floor-aligned parts from z-fighting with grid lines.
  grid.position.z = -0.002;
  grid.renderOrder = -10;
  const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const mat of mats) {
    if (!mat) continue;
    mat.depthTest = true;
    mat.depthWrite = false;
    mat.transparent = true;
    mat.opacity = 0.62;
    mat.needsUpdate = true;
  }
}

function buildGridDots(size, step, color = 0x6a7d99) {
  const half = size / 2;
  const points = [];
  const dotStep = Math.max(step, 0.5);
  for (let x = -half; x <= half + 1e-6; x += dotStep) {
    for (let y = -half; y <= half + 1e-6; y += dotStep) {
      points.push(x, y, -0.0015);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size: Math.max(dotStep * 0.06, 0.02),
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.34,
    depthTest: true,
    depthWrite: false,
  });
  const dots = new THREE.Points(geo, mat);
  dots.renderOrder = -11;
  dots.name = "architect-grid-dots";
  return dots;
}

function rebuildGrid() {
  if (gridHelper) {
    scene.remove(gridHelper);
    disposeSceneObject(gridHelper);
  }
  if (gridAxesGroup) {
    scene.remove(gridAxesGroup);
    disposeSceneObject(gridAxesGroup);
  }
  if (gridDotsGroup) {
    scene.remove(gridDotsGroup);
    disposeSceneObject(gridDotsGroup);
  }
  if (axesHelper) {
    scene.remove(axesHelper);
    disposeSceneObject(axesHelper);
  }

  const size = niceGridSize(sceneRadius());
  const divisions = Math.min(240, Math.max(80, Math.round(size / (size >= 100 ? 5 : 0.25))));
  const themeColors = currentThemeSceneColors();
  gridHelper = new THREE.GridHelper(size, divisions, themeColors.gridMajor, themeColors.gridMinor);
  gridHelper.rotation.x = Math.PI / 2;
  makeGridDepthAware(gridHelper);
  gridHelper.visible = gridVisible;
scene.add(gridHelper);

  gridAxesGroup = new THREE.Group();
  gridAxesGroup.name = "large-grid-axes";
  const half = size / 2;
  gridAxesGroup.add(makeAxisLine([new THREE.Vector3(-half, 0, -0.001), new THREE.Vector3(half, 0, -0.001)], 0xff4d4f));
  gridAxesGroup.add(makeAxisLine([new THREE.Vector3(0, -half, -0.001), new THREE.Vector3(0, half, -0.001)], 0x3fb950));
  gridAxesGroup.visible = gridVisible;
  scene.add(gridAxesGroup);

  const dotStep = Math.max(size / 70, size >= 100 ? 5 : 0.5);
  gridDotsGroup = buildGridDots(size, dotStep, themeColors.gridMinor);
  gridDotsGroup.visible = gridVisible;
  scene.add(gridDotsGroup);

  axesHelper = new THREE.AxesHelper(Math.max(size * 0.035, 1));
  axesHelper.visible = gridVisible;
  scene.add(axesHelper);
}

function setGridVisible(visible) {
  gridVisible = visible;
  if (gridHelper) gridHelper.visible = visible;
  if (gridAxesGroup) gridAxesGroup.visible = visible;
  if (gridDotsGroup) gridDotsGroup.visible = visible;
  if (axesHelper) axesHelper.visible = visible;
  syncGridToggleButtons();
}

function syncGridToggleButtons() {
  for (const id of ["btn-grid", "btn-grid-viewport"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle("active", gridVisible);
    el.setAttribute("aria-pressed", gridVisible ? "true" : "false");
  }
}

function toggleGrid() {
  setGridVisible(!gridVisible);
}

rebuildGrid();

function applyAppTheme({ persist = false, rebuild = true, announce = false } = {}) {
  appTheme = normalizedAppTheme(appTheme);
  applyThemeClass();
  if (savedSceneBg == null) {
    scene.background?.setHex?.(currentThemeSceneColors().canvas);
  }
  if (rebuild) rebuildGrid();
  const select = document.getElementById("pref-app-theme");
  if (select) select.value = appTheme;
  if (persist) {
    try {
      localStorage.setItem(APP_THEME_KEY, appTheme);
    } catch {
      /* local storage is best-effort */
    }
  }
  if (announce) setEditStatus("ok", `${APP_THEMES[appTheme].label} mode enabled.`);
}

function setAppTheme(theme, options = {}) {
  appTheme = normalizedAppTheme(theme);
  applyAppTheme(options);
}

let collab;

function projectPromptStateKey(pid = projectId) {
  return pid ? `${pid}:__project_draft` : null;
}

function modelStateKey(filename = selectedFile, pid = projectId) {
  return pid && filename ? `${pid}:${filename}` : projectPromptStateKey(pid);
}

function readModelPromptState() {
  try {
    return JSON.parse(localStorage.getItem(LS_MODEL_PROMPT_STATE) || "{}");
  } catch {
    return {};
  }
}

function writeModelPromptState(state) {
  try {
    localStorage.setItem(LS_MODEL_PROMPT_STATE, JSON.stringify(state));
  } catch (_) {}
}

function readGlobalComposeDraft() {
  try {
    return JSON.parse(localStorage.getItem(LS_COMPOSE_DRAFT) || "null");
  } catch {
    return null;
  }
}

function writeGlobalComposeDraft(snapshot) {
  try {
    localStorage.setItem(LS_COMPOSE_DRAFT, JSON.stringify(snapshot));
  } catch {
    // Images can exceed localStorage quota; keep text/refs rather than failing.
    try {
      const { images, ...small } = snapshot || {};
      localStorage.setItem(LS_COMPOSE_DRAFT, JSON.stringify({ ...small, images: [] }));
    } catch (_) {}
  }
}

function currentComposeSnapshot() {
  return {
    prompt: composer?.getRawPromptText?.() || "",
    references: composer?.getReferences?.() || [],
    images: promptImages || [],
    project_id: projectId || null,
    filename: selectedFile || null,
    updated_at: Date.now(),
  };
}

function saveActiveModelPromptState() {
  if (!composer) return;
  const snapshot = currentComposeSnapshot();
  writeGlobalComposeDraft(snapshot);
  if (!projectId) return;
  const key = modelStateKey();
  const projectKey = projectPromptStateKey();
  if (!key && !projectKey) return;
  const state = readModelPromptState();
  if (key) state[key] = snapshot;
  if (projectKey) state[projectKey] = snapshot;
  writeModelPromptState(state);
}

const composer = createPromptComposer({
  textarea: document.getElementById("prompt-input"),
  chipsEl: document.getElementById("ref-chips"),
  inlineChipsEl: document.getElementById("prompt-inline-ref-chips"),
  refsListEl: document.getElementById("ref-list"),
  onReferencesChange: (refs) => {
    if (!restoringModelPromptState) saveActiveModelPromptState();
    sendCollabPresence();
    meshCleanup?.refresh?.();
  },
});

function isExplorerPromptRef(ref) {
  return (
    ref?.type === "component" ||
    ref?.type === "sketch" ||
    ref?.type === "wiring" ||
    ref?.type === "dxf" ||
    ref?.type === "document"
  );
}

function dedupeRefsById(refs = []) {
  const out = [];
  const seen = new Set();
  for (const ref of refs) {
    if (!ref?.id || seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
  }
  return out;
}

function mergePromptReferenceSnapshots(modelState, projectState, globalState) {
  const candidates = [modelState, projectState, globalState].filter(Boolean);
  candidates.sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
  const newest = candidates[0] || null;
  if (Array.isArray(newest?.references)) {
    return {
      prompt: newest?.prompt || "",
      references: dedupeRefsById(newest.references),
      images: newest?.images,
    };
  }
  const modelRefs = modelState?.references || [];
  const projectRefs = projectState?.references || [];
  return {
    prompt: newest?.prompt || "",
    references: dedupeRefsById([...modelRefs, ...projectRefs]),
    images: newest?.images,
  };
}

function restoreActiveModelPromptState() {
  const key = modelStateKey();
  const projectKey = projectPromptStateKey();
  const states = readModelPromptState();
  const modelState = key ? states[key] : null;
  const projectState = projectKey ? states[projectKey] : null;
  const globalState = readGlobalComposeDraft();
  const merged = mergePromptReferenceSnapshots(modelState, projectState, globalState);
  restoringModelPromptState = true;
  resetRefCounter();
  promptImages = Array.isArray(merged.images) ? merged.images.slice(0, 4) : [];
  renderPromptImages();
  composer.replaceReferences(merged.references);
  composer.setPromptText(merged.prompt || "");
  restoreReferenceMarkers(merged.references.filter((ref) => !isExplorerPromptRef(ref)), {
    meshRoot: currentMesh,
    meshCenterOffset,
  });
  restoringModelPromptState = false;
  sendCollabPresence();
}

function safeRestoreActiveModelPromptState() {
  try {
    restoreActiveModelPromptState();
  } catch (err) {
    console.error("Could not restore AI compose draft:", err);
    restoringModelPromptState = false;
  }
}

document.getElementById("prompt-input")?.addEventListener("input", () => {
  if (!restoringModelPromptState) saveActiveModelPromptState();
});

const promptImageDrop = document.getElementById("prompt-image-drop");
const promptImageInput = document.getElementById("prompt-image-input");
const promptImageList = document.getElementById("prompt-image-list");
const promptPaneCompose = document.getElementById("prompt-pane-compose");
const promptPanel = document.querySelector(".prompt-panel");

function renderPromptImages() {
  if (!promptImageList) return;
  promptImageList.innerHTML = promptImages
    .map(
      (img) => `<div class="prompt-image-card" data-id="${img.id}">
        <img src="${img.data_url}" alt="${appEscapeHtml(img.name)}" />
        <button type="button" class="prompt-image-remove" title="Remove image">×</button>
        <span>${appEscapeHtml(img.name)}</span>
      </div>`
    )
    .join("");
  promptImageList.querySelectorAll(".prompt-image-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".prompt-image-card")?.dataset.id;
      promptImages = promptImages.filter((img) => img.id !== id);
      renderPromptImages();
      if (!restoringModelPromptState) saveActiveModelPromptState();
    });
  });
  syncBlueprintVisionForImages(promptImages.length);
  skillsPromptUI.render();
  skillsPromptUI.updatePlan?.();
  if (promptImages.length > 0) {
    requestAnimationFrame(() => {
      document.getElementById("btn-prompt")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

async function addPromptImages(files) {
  const allowed = ["image/png", "image/jpeg", "image/webp"];
  let added = 0;
  for (const file of [...files]) {
    if (promptImages.length >= 4) break;
    if (!allowed.includes(file.type)) continue;
    if (file.size > 6 * 1024 * 1024) {
      viewerOverlay.showError(`${file.name} is too large. Use images under 6 MB.`);
      continue;
    }
    const dataUrl = await readImageFile(file);
    promptImages.push({
      id: `img-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name,
      media_type: file.type,
      data_url: dataUrl,
    });
    added += 1;
  }
  renderPromptImages();
  if (added > 0) {
    setEditStatus("ok", added === 1 ? "Attached 1 image to the AI prompt." : `Attached ${added} images to the AI prompt.`);
    showAiComposePanel();
  }
  if (!restoringModelPromptState) saveActiveModelPromptState();
}

promptImageDrop?.addEventListener("click", () => promptImageInput?.click());
promptImageDrop?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") promptImageInput?.click();
});
promptImageInput?.addEventListener("change", async (e) => {
  const selected = [...(e.target.files || [])];
  const dxfFiles = selected.filter((file) => /\.dxf$/i.test(file.name));
  const docFiles = selected.filter((file) => !/\.dxf$/i.test(file.name) && isPromptDocumentFile(file));
  const imageFiles = selected.filter((file) => !/\.dxf$/i.test(file.name) && !isPromptDocumentFile(file));
  if (dxfFiles.length) await addPromptDxfFiles(dxfFiles);
  if (docFiles.length) await addPromptDocumentFiles(docFiles);
  if (imageFiles.length) await addPromptImages(imageFiles);
  e.target.value = "";
});

function droppedImageFiles(e) {
  const out = [];
  const seen = new Set();
  const addFile = (file) => {
    if (!file?.type?.startsWith("image/")) return;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  [...(e.dataTransfer?.items || [])].forEach((item) => {
    if (item.kind === "file") addFile(item.getAsFile());
  });
  [...(e.dataTransfer?.files || [])].forEach(addFile);
  return out;
}

function droppedDxfFiles(e) {
  return [...(e.dataTransfer?.files || [])].filter(
    (file) => /\.dxf$/i.test(file.name) || file.type === "application/dxf" || file.type === "image/vnd.dxf"
  );
}

const PROMPT_DOC_EXT_RE = /\.(txt|md|csv|tsv|json|ya?ml|log)$/i;

function isPromptDocumentFile(file) {
  const name = String(file?.name || "");
  if (!name) return false;
  if (PROMPT_DOC_EXT_RE.test(name)) return true;
  const mime = String(file?.type || "").toLowerCase();
  return mime.startsWith("text/") || mime === "application/json" || mime.includes("yaml");
}

function droppedDocumentFiles(e) {
  return [...(e.dataTransfer?.files || [])].filter(
    (file) => isPromptDocumentFile(file) && !/\.dxf$/i.test(file.name) && !file.type?.startsWith?.("image/")
  );
}

function droppedExplorerRefs(e) {
  return readExplorerDragPayloads(e);
}

function isExplorerComponentDrag(e) {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return [...types].includes("application/render3d-component");
}

function isPromptImageDrag(e) {
  if (droppedImageFiles(e).length) return true;
  if (droppedDxfFiles(e).length) return true;
  const types = e.dataTransfer?.types;
  return types && [...types].includes("Files");
}

async function addPromptDxfFiles(files) {
  const MAX_DXF_CHARS = 400_000;
  let added = 0;
  for (const file of [...files]) {
    if (file.size > 8 * 1024 * 1024) {
      viewerOverlay?.showError?.(`${file.name} is too large for a DXF reference (max 8 MB).`);
      continue;
    }
    let uploaded = null;
    try {
      await ensureProject();
      const form = new FormData();
      form.append("file", file, file.name);
      uploaded = await api(`/api/projects/${projectId}/upload`, {
        method: "POST",
        body: form,
      });
      await refreshFiles();
    } catch (err) {
      console.warn("DXF project upload failed; falling back to inline DXF reference", err);
      setEditStatus("warn", `Attached ${file.name} as inline DXF; project upload failed.`);
    }
    const text = await file.text();
    const filename = uploaded?.filename || file.name;
    const stem = filename.replace(/\.dxf$/i, "");
    const id = `dxf:${projectId || "project"}:${filename}`;
    const token = `@${stem.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "dxf"}`;
    const truncated = text.length > MAX_DXF_CHARS;
    composer.addReference({
      id,
      type: "dxf",
      token,
      label: filename,
      filename,
      stem,
      format: "dxf",
      text_content: truncated ? text.slice(0, MAX_DXF_CHARS) : text,
      text_truncated: truncated,
      projectId,
    });
    added += 1;
    setEditStatus("ok", `Attached DXF reference ${filename}.`);
  }
  if (added > 0) {
    setSkillEnabled("dxf", true);
    skillsPromptUI?.render?.();
    skillsPromptUI?.updatePlan?.();
  }
  if (!restoringModelPromptState) saveActiveModelPromptState();
}

async function addPromptDocumentFiles(files) {
  const MAX_DOC_BYTES = 2 * 1024 * 1024;
  const MAX_DOC_CHARS = 100_000;
  let added = 0;
  for (const file of [...files]) {
    if (!isPromptDocumentFile(file)) continue;
    if (file.size > MAX_DOC_BYTES) {
      viewerOverlay?.showError?.(`${file.name} is too large for a prompt document (max 2 MB).`);
      continue;
    }
    const text = await file.text();
    if (!text.trim()) continue;
    const filename = file.name;
    const stem = filename.replace(/\.[^.]+$/, "");
    const tokenStem = String(stem || "doc").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "doc";
    const truncated = text.length > MAX_DOC_CHARS;
    composer.addReference({
      id: `document:${projectId || "project"}:${filename}`,
      type: "document",
      token: `@doc-${tokenStem}`,
      label: filename,
      filename,
      stem,
      format: filename.split(".").pop()?.toLowerCase() || "txt",
      text_content: truncated ? text.slice(0, MAX_DOC_CHARS) : text,
      text_truncated: truncated,
      projectId,
    });
    added += 1;
  }
  if (added > 0) {
    setEditStatus("ok", added === 1 ? "Attached 1 document reference." : `Attached ${added} document references.`);
  }
  if (!restoringModelPromptState) saveActiveModelPromptState();
}

function handlePromptComposeDragover(e) {
  if (!isPromptImageDrag(e) && !isExplorerComponentDrag(e)) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  promptPaneCompose?.classList.add("dragging-image");
  promptImageDrop?.classList.add("dragging");
}

function handlePromptComposeDragleave(e) {
  if (!promptPanel?.contains(e.relatedTarget)) {
    promptPaneCompose?.classList.remove("dragging-image");
    promptImageDrop?.classList.remove("dragging");
  }
}

async function handlePromptComposeDrop(e) {
  const componentRefs = droppedExplorerRefs(e);
  if (componentRefs.length) {
    e.preventDefault();
    e.stopPropagation();
    promptPaneCompose?.classList.remove("dragging-image");
    promptImageDrop?.classList.remove("dragging");
    const added = addComponentPromptReferences(componentRefs);
    if (added > 0) {
      const componentCount = composer.getReferences().filter((r) => r.type === "component").length;
      setEditStatus(
        "ok",
        added === 1
          ? "Referenced 1 item in the AI prompt."
          : `Referenced ${added} items in the AI prompt (${componentCount} component${componentCount === 1 ? "" : "s"} total).`
      );
    }
    return;
  }
  const dxfFiles = droppedDxfFiles(e);
  if (dxfFiles.length) {
    e.preventDefault();
    e.stopPropagation();
    promptImageDrop?.classList.remove("dragging");
    await addPromptDxfFiles(dxfFiles);
    return;
  }
  const docFiles = droppedDocumentFiles(e);
  if (docFiles.length) {
    e.preventDefault();
    e.stopPropagation();
    promptPaneCompose?.classList.remove("dragging-image");
    promptImageDrop?.classList.remove("dragging");
    await addPromptDocumentFiles(docFiles);
    return;
  }
  const files = droppedImageFiles(e);
  if (!files.length) return;
  if (e.target instanceof Element && e.target.closest("#prompt-image-drop")) return;
  e.preventDefault();
  e.stopPropagation();
  promptPaneCompose?.classList.remove("dragging-image");
  promptImageDrop?.classList.remove("dragging");
  await addPromptImages(files);
}

function compactComponentToken(stem = "component") {
  return `@${String(stem || "component").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "component"}`;
}

function componentPromptReference(payload) {
  if (!payload?.filename && !payload?.name) return null;
  const filename = payload.filename || payload.name;
  const stem = payload.stem || filename.replace(/\.[^.]+$/, "");
  const pid = payload.projectId || projectId || null;
  return {
    id: `component:${pid || "project"}:${filename}`,
    type: payload.type === "sketch" || payload.type === "wiring" ? payload.type : "component",
    token: compactComponentToken(stem),
    label: payload.label || stem,
    filename,
    stem,
    format: payload.format,
    viewer_filename: payload.viewer_filename,
    projectId: pid,
  };
}

function addComponentPromptReference(payload) {
  const ref = componentPromptReference(payload);
  if (!ref) return false;
  composer.addReference(ref);
  return true;
}

function addComponentPromptReferences(payloads = []) {
  const refs = payloads.map((payload) => componentPromptReference(payload)).filter(Boolean);
  if (!refs.length) return 0;
  return composer.addReferences(refs) || 0;
}

promptImageDrop?.addEventListener("dragover", (e) => {
  if (!isPromptImageDrag(e) && !isExplorerComponentDrag(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  promptImageDrop.classList.add("dragging");
});
promptImageDrop?.addEventListener("dragleave", () => promptImageDrop.classList.remove("dragging"));
promptImageDrop?.addEventListener("drop", async (e) => {
  if (isExplorerComponentDrag(e) && droppedExplorerRefs(e).length) {
    await handlePromptComposeDrop(e);
    return;
  }
  const dxfFiles = droppedDxfFiles(e);
  if (dxfFiles.length) {
    e.preventDefault();
    e.stopPropagation();
    promptImageDrop.classList.remove("dragging");
    await addPromptDxfFiles(dxfFiles);
    return;
  }
  const docFiles = droppedDocumentFiles(e);
  if (docFiles.length) {
    e.preventDefault();
    e.stopPropagation();
    promptImageDrop.classList.remove("dragging");
    await addPromptDocumentFiles(docFiles);
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  promptImageDrop.classList.remove("dragging");
  await addPromptImages(e.dataTransfer?.files || []);
});

promptPaneCompose?.addEventListener("dragover", handlePromptComposeDragover);
promptPaneCompose?.addEventListener("dragleave", handlePromptComposeDragleave);
promptPaneCompose?.addEventListener("drop", handlePromptComposeDrop);
promptPanel?.addEventListener("dragover", handlePromptComposeDragover);
promptPanel?.addEventListener("dragleave", handlePromptComposeDragleave);
promptPanel?.addEventListener("drop", handlePromptComposeDrop);
document.getElementById("prompt-input")?.addEventListener("dragover", handlePromptComposeDragover);
document.getElementById("prompt-input")?.addEventListener("drop", handlePromptComposeDrop);
document.getElementById("prompt-inline-ref-chips")?.addEventListener("dragover", handlePromptComposeDragover);
document.getElementById("prompt-inline-ref-chips")?.addEventListener("drop", handlePromptComposeDrop);
document.getElementById("prompt-input")?.addEventListener("paste", async (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((file) => file.type?.startsWith("image/"));
  if (!files.length) return;
  e.preventDefault();
  await addPromptImages(files);
});

collab = createCollab({
  getToken,
  getProjectId: () => projectId,
  getMeshOffset: () => meshCenterOffset,
  scene,
});
collab.setupLabels(viewport);

function userRealtimeUrl() {
  const token = encodeURIComponent(getToken());
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/ws/user?token=${token}`;
}

function workspaceRealtimeUrl(teamId) {
  const token = encodeURIComponent(getToken());
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/ws/workspaces/${encodeURIComponent(teamId)}?token=${token}`;
}

function scheduleUserRealtimeReconnect() {
  if (userRealtimeReconnectTimer || !getToken()) return;
  userRealtimeReconnectTimer = setTimeout(() => {
    userRealtimeReconnectTimer = null;
    connectUserRealtime();
  }, 2500);
}

function scheduleWorkspaceRealtimeReconnect() {
  if (workspaceRealtimeReconnectTimer || !getToken() || !workspaceRealtimeTeamId) return;
  workspaceRealtimeReconnectTimer = setTimeout(() => {
    workspaceRealtimeReconnectTimer = null;
    connectWorkspaceRealtime(workspaceRealtimeTeamId);
  }, 2500);
}

function renderWorkspaceRealtimePresence() {
  const el = document.getElementById("workspace-realtime-presence");
  if (!el) return;
  if (!workspaceRealtimeTeamId) {
    el.textContent = "Select workspace";
    return;
  }
  const count = workspaceRealtimeUsers.length;
  el.textContent = count ? `${count} live` : "Live";
  el.title = workspaceRealtimeUsers.map((u) => u.display_name || "User").join(", ");
}

function handleWorkspaceRealtimeEvent(msg = {}) {
  if (msg.type === "workspace.presence.sync") {
    workspaceRealtimeUsers = msg.users || [];
    renderWorkspaceRealtimePresence();
    return;
  }
  if (msg.type === "workspace.presence.join") {
    const user = msg.user;
    if (user && !workspaceRealtimeUsers.some((u) => u.id === user.id)) {
      workspaceRealtimeUsers.push(user);
      renderWorkspaceRealtimePresence();
    }
    return;
  }
  if (msg.type === "workspace.presence.leave") {
    workspaceRealtimeUsers = workspaceRealtimeUsers.filter((u) => u.id !== msg.user_id);
    renderWorkspaceRealtimePresence();
    return;
  }
  handleRealtimeEvent(msg);
  if (msg.type === "workspace.render_folder.updated" || msg.type === "workspace.updated" || msg.type === "project.created" || msg.type === "project.deleted") {
    void refreshWorkspaceRealtimeEditor();
  }
}

function connectWorkspaceRealtime(teamId) {
  if (teamId && workspaceRealtimeTeamId === teamId && workspaceRealtimeSocket && workspaceRealtimeSocket.readyState <= WebSocket.OPEN) {
    return;
  }
  workspaceRealtimeSocket?.close();
  workspaceRealtimeSocket = null;
  workspaceRealtimeTeamId = teamId || null;
  workspaceRealtimeUsers = [];
  renderWorkspaceRealtimePresence();
  if (!teamId || !getToken()) return;
  const ws = new WebSocket(workspaceRealtimeUrl(teamId));
  workspaceRealtimeSocket = ws;
  ws.onmessage = (ev) => {
    try {
      handleWorkspaceRealtimeEvent(JSON.parse(ev.data));
    } catch {
      /* ignore malformed websocket packets */
    }
  };
  ws.onclose = () => {
    if (workspaceRealtimeSocket === ws) {
      workspaceRealtimeSocket = null;
      scheduleWorkspaceRealtimeReconnect();
    }
  };
}

function connectUserRealtime() {
  userRealtimeSocket?.close();
  if (!getToken()) return;
  const ws = new WebSocket(userRealtimeUrl());
  userRealtimeSocket = ws;
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleRealtimeEvent(msg);
  };
  ws.onclose = () => {
    if (userRealtimeSocket === ws) {
      userRealtimeSocket = null;
      scheduleUserRealtimeReconnect();
    }
  };
}

const promptHistory = createPromptHistoryUI({
  listEl: document.getElementById("prompt-history-list"),
  summaryEl: document.getElementById("prompt-history-summary"),
  getProjectId: () => projectId,
  onReuse: (entry) => {
    const reusedMode = generationPromptMode({ prompt_mode: entry.prompt_mode }, promptMode);
    if (["v2", "fusion", "architect", "draw", "standard"].includes(reusedMode)) {
      applyPromptModeUI(reusedMode === "standard" ? "render" : reusedMode);
    }
    const refs = promptHistoryReferencesForReuse(entry);
    restoringModelPromptState = true;
    composer.setPromptText(entry.prompt || "");
    composer.replaceReferences(refs);
    restoringModelPromptState = false;
    promptImages = [];
    renderPromptImages();
    saveActiveModelPromptState();
    document.getElementById("prompt-input")?.focus();
    const refCount = refs.length;
    setEditStatus("ok", refCount ? `Reused prompt with ${refCount} reference${refCount === 1 ? "" : "s"}.` : "Reused prompt.");
  },
});

let promptMode = "v2";
const PROMPT_SPEED_KEY = "render3d:prompt-speed:v1";
const WIRING_SPEED_KEY = "render3d:wiring-speed:v1";

function getPromptGenerationSpeed() {
  return document.getElementById("prompt-speed")?.value === "quality" ? "quality" : "fast";
}

function getWiringGenerationSpeed() {
  const value = document.getElementById("wiring-speed")?.value
    ?? document.getElementById("wiring-toolbelt-speed")?.value
    ?? document.getElementById("wdbg-speed")?.value;
  return value === "quality" ? "quality" : "fast";
}

function setWiringGenerationSpeed(value, { persist = true } = {}) {
  const next = value === "quality" ? "quality" : "fast";
  for (const id of ["wiring-speed", "wiring-toolbelt-speed", "wdbg-speed"]) {
    const select = document.getElementById(id);
    if (select) select.value = next;
  }
  if (persist) {
    try { localStorage.setItem(WIRING_SPEED_KEY, next); } catch {}
  }
}

function initWiringGenerationSpeed() {
  let saved = "fast";
  try { saved = localStorage.getItem(WIRING_SPEED_KEY) || "fast"; } catch {}
  setWiringGenerationSpeed(saved, { persist: false });
  for (const id of ["wiring-speed", "wiring-toolbelt-speed", "wdbg-speed"]) {
    document.getElementById(id)?.addEventListener("change", (e) => {
      setWiringGenerationSpeed(e.currentTarget.value);
    });
  }
}

function setPromptGenerationSpeed(value, { persist = true } = {}) {
  const next = value === "quality" ? "quality" : "fast";
  const select = document.getElementById("prompt-speed");
  if (select) select.value = next;
  if (persist) {
    try { localStorage.setItem(PROMPT_SPEED_KEY, next); } catch {}
  }
  applyPromptModeUI(promptMode);
}

function initPromptGenerationSpeed() {
  let saved = "fast";
  try { saved = localStorage.getItem(PROMPT_SPEED_KEY) || "fast"; } catch {}
  setPromptGenerationSpeed(saved, { persist: false });
  document.getElementById("prompt-speed")?.addEventListener("change", (e) => {
    setPromptGenerationSpeed(e.currentTarget.value);
  });
}

const FUSION_TARGET_KEY = "render3d:fusion-target:v1";
let fusionTarget = (() => {
  try {
    return localStorage.getItem(FUSION_TARGET_KEY) === "fusion360" ? "fusion360" : "in_app";
  } catch {
    return "in_app";
  }
})();

function fusionTargetLabel(target = fusionTarget) {
  return target === "fusion360" ? "Fusion 360 plugin" : "in-app Fusion";
}

function promptModeForRef(mode = promptMode) {
  const normalized = (mode || "render").toLowerCase();
  if (normalized === "fusion") return "fusion";
  if (normalized === "architect") return "architect";
  if (normalized === "v2") return "v2";
  if (normalized === "draw") return "draw";
  return "standard";
}

function promptCopyContextBase(promptText, extra = {}) {
  const { model, provider } = getSelectedPromptModelInfo();
  return {
    projectId,
    filename: selectedFile,
    promptText,
    promptMode: promptModeForRef(),
    model,
    provider,
    ...extra,
  };
}

function clearPromptComposeResult() {
  const status = document.getElementById("prompt-status");
  const reply = document.getElementById("prompt-reply");
  if (status) {
    status.className = "status";
    status.textContent = "";
  }
  if (reply) reply.textContent = "";
}
document.querySelectorAll("[data-prompt-mode]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if ((btn.dataset.promptMode || "render") === "fusion") {
      openFusionCapabilityModal();
      return;
    }
    applyPromptModeUI(btn.dataset.promptMode || "render");
  });
});

function setFusionTarget(target) {
  fusionTarget = target === "fusion360" ? "fusion360" : "in_app";
  try {
    localStorage.setItem(FUSION_TARGET_KEY, fusionTarget);
  } catch {
    /* local storage is best-effort */
  }
}

function openFusionCapabilityModal() {
  const modal = document.getElementById("fusion-capability-modal");
  if (!modal) {
    applyPromptModeUI("fusion");
    return;
  }
  if (modal.parentElement !== document.body) document.body.appendChild(modal);
  modal.querySelectorAll("[data-fusion-target]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.fusionTarget === fusionTarget);
  });
  modal.classList.remove("hidden");
}

function closeFusionCapabilityModal() {
  document.getElementById("fusion-capability-modal")?.classList.add("hidden");
}

document.getElementById("fusion-capability-close")?.addEventListener("click", closeFusionCapabilityModal);
function connectFusionTargetIfNeeded() {
  if (!getToken()) {
    authUi?.openModal?.();
    setEditStatus("error", "Sign in to Render3D first, then connect Autodesk Fusion 360.");
    return;
  }
  if (authUi?.startAutodeskConnect) {
    void authUi.startAutodeskConnect({ promptForCredentials: false }).then((status) => {
      if (status?.linked) {
        setEditStatus("ok", "Fusion cloud is connected. APS can import/export project files; live desktop edits need the local Fusion add-in bridge.");
      }
    });
    return;
  }
  void api("/api/autodesk/status")
    .then((status) => {
      if (status?.linked) {
        setEditStatus("ok", "Fusion cloud is connected. APS can import/export project files; live desktop edits need the local Fusion add-in bridge.");
        return null;
      }
      return api("/api/autodesk/oauth-url", { method: "POST" });
    })
    .then((oauth) => {
      if (oauth?.url) window.location.href = oauth.url;
    })
    .catch(() => setEditStatus("error", "Could not start Fusion 360 connection."));
}

document.getElementById("fusion-capability-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "fusion-capability-modal") {
    closeFusionCapabilityModal();
    return;
  }
  const option = e.target.closest("[data-fusion-target]");
  if (!option) return;
  setFusionTarget(option.dataset.fusionTarget);
  closeFusionCapabilityModal();
  applyPromptModeUI("fusion");
  if (option.dataset.fusionTarget === "fusion360") {
    connectFusionTargetIfNeeded();
  }
});

document.getElementById("prompt-target-mode")?.addEventListener("change", () => {
  if (getPromptTargetMode() !== "edit") promptTargetSelectedBody = null;
  syncPromptTargetUI();
});

document.getElementById("prompt-target-object")?.addEventListener("change", (e) => {
  const name = e.currentTarget.value;
  if (!name) return;
  promptTargetSelectedBody = null;
  selectedFile = name;
  projectTree.setSelected(name);
  featureEditor.setModel(projectId, name);
  selectAssemblyComponent(name, { fitView: false });
  syncPromptTargetUI();
});

document.getElementById("prompt-target-picker-btn")?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  togglePromptTargetPopup();
});

document.getElementById("prompt-target-popup")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-prompt-target-name]");
  if (!btn) return;
  const bodyIndex = btn.dataset.promptTargetBodyIndex === undefined ? null : Number(btn.dataset.promptTargetBodyIndex);
  choosePromptTargetObject(btn.dataset.promptTargetName, Number.isInteger(bodyIndex) ? bodyIndex : null);
});

document.getElementById("prompt-target-popup")?.addEventListener("pointerover", (e) => {
  const btn = e.target.closest("[data-prompt-target-name]");
  if (!btn) return;
  beginPromptTargetPreview(btn.dataset.promptTargetName);
});

document.getElementById("prompt-target-popup")?.addEventListener("pointerout", (e) => {
  const btn = e.target.closest("[data-prompt-target-name]");
  if (!btn || btn.contains(e.relatedTarget)) return;
  if (e.relatedTarget?.closest?.("[data-prompt-target-name]")) return;
  endPromptTargetPreview();
});

document.addEventListener("mousedown", (e) => {
  const popup = document.getElementById("prompt-target-popup");
  const trigger = document.getElementById("prompt-target-picker-btn");
  if (popup?.classList.contains("hidden")) return;
  if (popup.contains(e.target) || trigger?.contains(e.target)) return;
  closePromptTargetPopup();
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePromptTargetPopup();
});

const wiringPromptHistory = createPromptHistoryUI({
  listEl: document.getElementById("wiring-prompt-history-list"),
  summaryEl: document.getElementById("wiring-prompt-history-summary"),
  tabSelector: ".wiring-prompt-tab",
  panes: {
    compose: document.getElementById("wiring-prompt-pane-compose"),
    history: document.getElementById("wiring-prompt-pane-history"),
  },
  refStatusEl: document.getElementById("wiring-prompt-ref-status"),
  historyTabSelector: '.wiring-prompt-tab[data-pane="history"]',
  getProjectId: () => projectId,
  onReuse: (entry) => {
    const ta = document.getElementById("wiring-prompt-input");
    if (ta) {
      ta.value = entry.prompt;
      ta.focus();
    }
  },
});

async function refreshWiringPromptHistory() {
  if (!projectId) {
    wiringPromptHistory.render([]);
    wiringPromptHistory.setCountBadge(0);
    return;
  }
  try {
    const data = await api(`/api/projects/${projectId}/prompt-history?kind=wiring`);
    const entries = data.entries || [];
    wiringPromptHistory.render(entries, data.filtered_usage_summary || data.usage_summary || null);
    wiringPromptHistory.setCountBadge(entries.length);
  } catch {
    wiringPromptHistory.render([]);
    wiringPromptHistory.setCountBadge(0);
  }
}

const riggingPromptHistory = createPromptHistoryUI({
  listEl: document.getElementById("rigging-prompt-history-list"),
  tabSelector: ".rigging-prompt-tab",
  panes: {
    compose: document.getElementById("rigging-prompt-pane-compose"),
    history: document.getElementById("rigging-prompt-pane-history"),
  },
  refStatusEl: document.getElementById("rigging-prompt-ref-status"),
  historyTabSelector: '.rigging-prompt-tab[data-pane="history"]',
  getProjectId: () => projectId,
  onReuse: (entry) => {
    const ta = document.getElementById("rigging-prompt-input");
    if (ta) {
      ta.value = entry.prompt;
      ta.focus();
    }
  },
});

async function refreshRiggingPromptHistory() {
  if (!projectId) {
    riggingPromptHistory.render([]);
    riggingPromptHistory.setCountBadge(0);
    return;
  }
  try {
    const data = await api(`/api/projects/${projectId}/prompt-history?kind=rigging`);
    const entries = data.entries || [];
    riggingPromptHistory.render(entries);
    riggingPromptHistory.setCountBadge(entries.length);
  } catch {
    riggingPromptHistory.render([]);
    riggingPromptHistory.setCountBadge(0);
  }
}

function updateWiringToolbelt({ canUndo, canRedo } = {}) {
  const undoBtn = document.getElementById("btn-wiring-undo");
  const redoBtn = document.getElementById("btn-wiring-redo");
  if (undoBtn) undoBtn.disabled = !canUndo;
  if (redoBtn) redoBtn.disabled = !canRedo;
}

const skillsPromptUI = createSkillsPromptUI({
  chipsEl: document.getElementById("prompt-skills-chips"),
  linkEl: document.getElementById("prompt-skills-link"),
  toggleEl: document.getElementById("prompt-skills-toggle"),
  planEl: document.getElementById("prompt-skills-plan"),
  promptEl: document.getElementById("prompt-input"),
  getHasImages: () => promptImages.length > 0,
});
fetchSkillsCatalog((path, options) => fetch(path, options)).then(() => {
  skillsPromptUI.render();
  skillsPromptUI.updatePlan?.();
});
safeRestoreActiveModelPromptState();

async function refreshWorkspaceAiUsage() {
  try {
    workspaceAiUsage = await api("/api/user/ai-usage");
  } catch {
    workspaceAiUsage = null;
  }
  renderUserMenuAiCost();
  renderAIStatus(aiStatus);
}

function renderUserMenuAiCost() {
  const valueEl = document.getElementById("user-menu-ai-cost-value");
  const labelEl = document.getElementById("user-menu-ai-cost-label");
  const hintEl = document.getElementById("user-menu-ai-cost-hint");
  if (!valueEl) return;

  const usage = workspaceAiUsage;
  if (!usage) {
    valueEl.textContent = "—";
    if (labelEl) labelEl.textContent = "OpenAI est. · this month";
    if (hintEl) hintEl.textContent = "Estimated from tracked prompts";
    return;
  }

  const projectCount = usage.project_count ?? 0;
  const monthLabel = usage.month_label || "This month";
  if (labelEl) {
    labelEl.textContent = `OpenAI est. · ${monthLabel} · ${projectCount} project${projectCount === 1 ? "" : "s"}`;
  }

  const openaiTotal = Number(usage.openai_cost_usd ?? usage.cost_usd) || 0;
  valueEl.textContent = formatCostUsd(openaiTotal) ?? "$0.00";

  if (hintEl) {
    const tracked = usage.tracked_count ?? 0;
    const untracked = usage.untracked_count ?? Math.max(0, (usage.prompt_count ?? 0) - tracked);
    let hint =
      tracked > 0
        ? `${tracked} tracked prompt${tracked === 1 ? "" : "s"} · estimated from token usage`
        : "No tracked prompts this month";
    if (untracked > 0) {
      hint += ` · ${untracked} older prompt${untracked === 1 ? "" : "s"} missing usage (not included)`;
    }
    const allProviders = Number(usage.cost_usd) || 0;
    if (allProviders > openaiTotal + 0.0001) {
      hint += ` · all providers ${formatCostUsd(allProviders)}`;
    }
    hintEl.textContent = hint;
  }
}

function compactTokenCount(value) {
  const total = Number(value) || 0;
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(2)}M tokens`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k tokens`;
  return `${total} tokens`;
}

function usageTokenTotal(usage) {
  if (!usage) return 0;
  return Number(usage.total_tokens) || Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0) || 0;
}

function renderProjectCostThumb(entries = [], summary = null) {
  const wrap = document.getElementById("project-cost-thumb");
  if (!wrap) return;
  const totalEl = document.getElementById("project-cost-thumb-total");
  const costEl = document.getElementById("project-cost-thumb-cost");
  const promptEl = document.getElementById("project-cost-thumb-prompts");
  const tokenEl = document.getElementById("project-cost-thumb-tokens");
  const chartEl = document.getElementById("project-cost-thumb-chart");
  const totalCost = Number((summary?.cost_usd ?? 0) > 0 ? summary.cost_usd : (summary?.openai_cost_usd ?? 0)) || 0;
  const costLabel = formatCostUsd(totalCost) || "$0.00";
  const tracked = Number(summary?.tracked_count ?? entries.filter((e) => e.cost_usd != null || e.usage).length) || 0;
  const tokens = usageTokenTotal(summary?.usage) || entries.reduce((sum, e) => sum + usageTokenTotal(e.usage), 0);
  if (totalEl) totalEl.textContent = costLabel;
  if (costEl) costEl.textContent = `Cost ${costLabel}`;
  if (promptEl) promptEl.textContent = `${tracked} tracked prompt${tracked === 1 ? "" : "s"}`;
  if (tokenEl) tokenEl.textContent = compactTokenCount(tokens);
  if (chartEl) {
    const recent = entries
      .slice()
      .reverse()
      .slice(-14)
      .map((e) => Number(e.cost_usd) || 0);
    const values = recent.length ? recent : [0, 0, 0, 0, 0, 0, 0];
    const max = Math.max(0.000001, ...values);
    chartEl.innerHTML = values
      .map((value) => {
        const h = value > 0 ? Math.max(6, Math.round((value / max) * 42)) : 3;
        return `<i style="height:${h}px" title="${formatCostUsd(value) || "$0.00"}"></i>`;
      })
      .join("");
  }
  wrap.classList.toggle("is-empty", !tracked);
}

function promptHistoryReferencesForReuse(entry = {}) {
  const saved = Array.isArray(entry.references) ? entry.references : [];
  const refs = saved
    .filter((ref) => ref?.id && ref?.type)
    .map((ref) => ({
      ...ref,
      projectId: ref.projectId || projectId || null,
    }));
  if (refs.length) return refs;

  const prompt = String(entry.prompt || "");
  const asksForDxf = /\b(dxf|dwg|drawing|blueprint|from this .* file)\b/i.test(prompt);
  if (!asksForDxf) return [];
  const drawings = (lastProjectBrowser?.drawings || []).filter((drawing) => /\.dxf$/i.test(String(drawing?.name || "")));
  return drawings.slice(0, 4).map((drawing) => {
    const filename = drawing.name || drawing.filename;
    const stem = drawing.stem || fileStem(filename);
    return {
      id: `dxf:${projectId || "project"}:${filename}`,
      type: "dxf",
      token: `@${String(stem || "dxf").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "dxf"}`,
      label: filename,
      filename,
      stem,
      format: "dxf",
      projectId,
    };
  });
}

async function refreshPromptHistory() {
  if (!projectId) {
    promptHistory.render([], null);
    promptHistory.setCountBadge(0);
    renderProjectCostThumb([], null);
    return [];
  }
  try {
    const data = await api(`/api/projects/${projectId}/prompt-history?kind=cad`);
    const entries = data.entries || [];
    latestPromptHistoryEntries = entries;
    promptHistory.render(entries, data.usage_summary);
    promptHistory.setCountBadge(entries.length);
    renderProjectCostThumb(entries, data.usage_summary);
    if (data.usage_summary) {
      const proj = allProjects.find((p) => p.id === projectId);
      if (proj) {
        proj.usage_summary = data.usage_summary;
        workspaceBrowser?.render?.();
      }
    }
    return entries;
  } catch {
    latestPromptHistoryEntries = [];
    promptHistory.render([], null);
    promptHistory.setCountBadge(0);
    renderProjectCostThumb([], null);
    return [];
  }
}

const timeline = createTimelineUI(document.getElementById("timeline-panel"), {
  onSelect: (index) => restoreTimeline(index),
  onRestoreLatest: (index) => restoreTimelineAsLatest(index),
  onRemove: (index, entry) => removeTimelineEntry(index, entry),
});

function createWiringBottomPanel(container) {
  const wrap = document.createElement("div");
  wrap.className = "wiring-bottom-wrap";
  wrap.innerHTML = `
    <div class="wiring-bottom-header">
      <div class="wiring-bottom-tabs" role="tablist" aria-label="Wiring bottom panel">
        <button type="button" class="wiring-bottom-tab active" data-wiring-bottom-tab="history">Wiring History</button>
        <button type="button" class="wiring-bottom-tab" data-wiring-bottom-tab="logs">Terminal Logs</button>
      </div>
      <span class="wiring-bottom-summary muted small">No wiring history yet</span>
      <button type="button" class="btn-collapse wiring-bottom-collapse" title="Collapse wiring history" aria-label="Collapse wiring history">▼</button>
    </div>
    <div class="wiring-bottom-body">
      <div class="wiring-bottom-pane active" data-wiring-bottom-pane="history">
        <div class="wiring-history-actions">
          <button type="button" class="wiring-history-undo btn secondary" disabled>Undo</button>
          <button type="button" class="wiring-history-redo btn secondary" disabled>Redo</button>
        </div>
        <div class="wiring-history-list"></div>
      </div>
      <div class="wiring-bottom-pane" data-wiring-bottom-pane="logs">
        <div class="wiring-terminal-actions">
          <span class="muted small">Code & Simulate output continues here when the popup is closed.</span>
          <button type="button" class="btn secondary wiring-terminal-clear">Clear</button>
        </div>
        <div class="wiring-terminal-log"></div>
      </div>
    </div>
  `;
  container?.appendChild(wrap);

  const tabs = wrap.querySelectorAll(".wiring-bottom-tab");
  const panes = wrap.querySelectorAll(".wiring-bottom-pane");
  const summary = wrap.querySelector(".wiring-bottom-summary");
  const historyList = wrap.querySelector(".wiring-history-list");
  const undoBtn = wrap.querySelector(".wiring-history-undo");
  const redoBtn = wrap.querySelector(".wiring-history-redo");
  const logEl = wrap.querySelector(".wiring-terminal-log");
  const clearBtn = wrap.querySelector(".wiring-terminal-clear");
  const logs = [];

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.wiringBottomTab;
      tabs.forEach((b) => b.classList.toggle("active", b === btn));
      panes.forEach((pane) => pane.classList.toggle("active", pane.dataset.wiringBottomPane === tab));
    });
  });
  wrap.querySelector(".wiring-bottom-collapse")?.addEventListener("click", () => {
    document.getElementById("btn-timeline-collapse")?.click();
  });
  undoBtn?.addEventListener("click", () => wiringSim?.undo?.());
  redoBtn?.addEventListener("click", () => wiringSim?.redo?.());
  clearBtn?.addEventListener("click", () => {
    logs.length = 0;
    renderLogs();
  });

  function renderLogs() {
    if (!logEl) return;
    if (!logs.length) {
      logEl.innerHTML = `<div class="wiring-terminal-empty muted small">No simulation logs yet. Run Code & Simulate to stream output here.</div>`;
      return;
    }
    logEl.innerHTML = logs
      .slice(-120)
      .map((line) => `<div class="wiring-terminal-line wiring-terminal-line--${esc(line.kind || "info")}"><span>${esc(line.time || "")}</span>${esc(line.message)}</div>`)
      .join("");
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setHistory(state = {}) {
    const current = state.current || {};
    if (summary) {
      summary.textContent = `${current.componentCount || 0} components · ${current.wireCount || 0} wires · ${state.undoCount || 0} undo · ${state.redoCount || 0} redo`;
    }
    if (undoBtn) undoBtn.disabled = !state.canUndo;
    if (redoBtn) redoBtn.disabled = !state.canRedo;
    const undo = state.undo || [];
    const redo = state.redo || [];
    const recentUndo = undo.slice(-14).reverse();
    const recentRedo = redo.slice(-8);
    const rows = [
      `<button type="button" class="wiring-history-step wiring-history-step--current">
        <span class="step-kind">current</span>
        <span class="step-label">${esc(current.label || "Current wiring")}</span>
        <span class="step-user">${current.componentCount || 0} components · ${current.wireCount || 0} wires</span>
      </button>`,
      ...recentUndo.map(
        (entry, i) => `<button type="button" class="wiring-history-step" data-history-action="undo" title="Undo to this checkpoint">
          <span class="step-kind">undo ${recentUndo.length - i}</span>
          <span class="step-label">${esc(entry.label)}</span>
          <span class="step-user">${entry.componentCount} components · ${entry.wireCount} wires</span>
        </button>`,
      ),
      ...recentRedo.map(
        (entry, i) => `<button type="button" class="wiring-history-step wiring-history-step--redo" data-history-action="redo" title="Redo one step">
          <span class="step-kind">redo ${i + 1}</span>
          <span class="step-label">${esc(entry.label)}</span>
          <span class="step-user">${entry.componentCount} components · ${entry.wireCount} wires</span>
        </button>`,
      ),
    ];
    if (historyList) {
      historyList.innerHTML = rows.join("");
      historyList.querySelectorAll('[data-history-action="undo"]').forEach((btn) => btn.addEventListener("click", () => wiringSim?.undo?.()));
      historyList.querySelectorAll('[data-history-action="redo"]').forEach((btn) => btn.addEventListener("click", () => wiringSim?.redo?.()));
    }
  }

  function addLog(line = {}) {
    logs.push(line);
    if (logs.length > 240) logs.splice(0, logs.length - 240);
    renderLogs();
  }

  renderLogs();
  setHistory();
  return {
    setHistory,
    addLog,
    clearLogs() {
      logs.length = 0;
      renderLogs();
    },
  };
}

const wiringBottomPanel = createWiringBottomPanel(document.getElementById("timeline-panel"));

const objectHistory = createObjectHistoryUI({
  listEl: document.getElementById("object-history-list"),
  onHighlight: (index) => timeline.goToIndex(index, { preview: true }),
  onRestore: (index) => restoreTimelineAsLatest(index),
});

const workspaceActivity = createWorkspaceActivityUI({
  listEl: document.getElementById("workspace-activity-list"),
});

function initWorkspaceActivityDropdown() {
  const toggle = document.getElementById("btn-workspace-activity-toggle");
  const panel = document.getElementById("workspace-activity-dropdown");
  if (!toggle || !panel) return;
  const close = () => {
    toggle.setAttribute("aria-expanded", "false");
    panel.classList.add("hidden");
  };
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    panel.classList.toggle("hidden", !open);
  });
  document.addEventListener("click", (event) => {
    if (!panel.classList.contains("hidden") && !event.target.closest(".workspace-activity-switcher")) {
      close();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}

initWorkspaceActivityDropdown();

const activityLog = createActivityLog(document.getElementById("activity-log-panel"), rawFetch);

async function ensureMissingBrowserComponentsLoaded({ keepGizmoOn = null, fitView = false } = {}) {
  if (!projectId) return;
  const browser = normalizeBrowser(await api(`/api/projects/${projectId}`));
  const visibleComps = (browser.components || []).filter((c) => !isBrowserComponentHidden(c));
  let loadedAny = false;
  for (const entry of visibleComps) {
    if (projectAssembly.has(entry.name)) {
      projectAssembly.setVisible(entry.name, true);
      continue;
    }
    const viewer = entry.viewer_filename || entry.name;
    const ok = await loadModel(projectFileUrl(projectId, viewer), viewer, {
      projectId,
      append: projectAssembly.count() > 0,
      catalogFilename: entry.name,
      center: !hasBakedPlacement(entry),
      fitView: false,
      autoGizmo: false,
    });
    if (ok || projectAssembly.has(entry.name)) loadedAny = true;
  }
  currentMesh = projectAssembly.getRoot();
  rebuildGrid();
  if (keepGizmoOn && projectAssembly.has(keepGizmoOn)) {
    selectAssemblyComponent(keepGizmoOn, { autoGizmo: true, fitView: false });
  } else if (fitView || loadedAny) {
    fitCamera();
  }
}

async function afterModelEdit(data) {
  const prevCatalog = data?.replaceCatalog || data?.replace_catalog || catalogNameForMesh(transformControls.object) || selectedFile;
  // Count components that are NOT the one about to be replaced so we know whether
  // other components are in the assembly. If yes, use append+replaceCatalog to swap
  // the reloaded mesh in-place without ever blanking the scene.
  const siblingsInAssembly = [...projectAssembly.list()].filter(
    ([name]) => name !== prevCatalog && fileStem(name) !== fileStem(prevCatalog)
  ).length;
  const inAssembly = siblingsInAssembly > 0;
  const isBakedTransform = data?.action === "transform" || data?.action === "body_transform";
  const placementBaseline = isBakedTransform ? transformBaselineFromPayload(data?.placementBaseline) : null;

  // Snapshot the existing mesh transform so we can restore it after reload.
  // This prevents the model from jumping when the new GLB has a slightly
  // different internal origin (e.g. after a face-pull or fillet).
  let savedTransform = null;
  const prevMesh = projectAssembly.get?.(prevCatalog || selectedFile) || currentMesh;
  if (prevMesh && !isBakedTransform) {
    prevMesh.updateMatrixWorld(true);
    savedTransform = {
      position: prevMesh.position.clone(),
      quaternion: prevMesh.quaternion.clone(),
      scale: prevMesh.scale.clone(),
    };
  }

  selectedFile = data.filename;
  await refreshFiles();
  await loadModel(data.url, data.filename, {
    projectId,
    preservePlacement: isBakedTransform ? !!placementBaseline : true,
    center: isBakedTransform ? false : !hasBakedPlacement(data.filename),
    normalizePivot: !isBakedTransform && !hasBakedPlacement(data.filename),
    resetTransform: isBakedTransform && !placementBaseline,
    savedTransform: isBakedTransform ? placementBaseline : savedTransform,
    catalogFilename: data.filename,
    append: inAssembly,
    replaceCatalog: prevCatalog || null,
    fitView: false,
    autoGizmo: true,
  });
  gizmoPanel.resetDragBaseline?.();
  if (isBakedTransform || projectAssembly.count() > 0) {
    await ensureMissingBrowserComponentsLoaded({
      keepGizmoOn: isBakedTransform ? data.filename : null,
      fitView: false,
    });
  }
  if (data.timeline) {
    timelineData = data.timeline;
    timeline.setTimeline(data.timeline, { scroll: true, scrollAlign: "end" });
  }
  await refreshTimeline();
  await refreshPromptHistory();
}

let objectClipboard = null;
const viewportUndoStack = [];

function captureViewportAssemblyState() {
  return projectAssembly.list().map(([name, obj]) => ({
    name,
    visible: obj?.visible !== false,
  }));
}

function pushViewportUndoAction(action) {
  if (!action) return;
  viewportUndoStack.push(action);
  if (viewportUndoStack.length > 20) viewportUndoStack.shift();
}

function undoViewportAction() {
  const action = viewportUndoStack.pop();
  if (!action) return false;
  if (action.type === "fusion-component-drop") {
    const beforeNames = new Set((action.before || []).map((item) => item.name));
    for (const [name] of [...projectAssembly.list()]) {
      if (!beforeNames.has(name)) projectAssembly.remove(name);
    }
    for (const item of action.before || []) {
      projectAssembly.setVisible(item.name, item.visible);
    }
    const restoreName = action.selectedBefore || (action.before || []).find((item) => item.visible)?.name || null;
    if (restoreName && projectAssembly.has(restoreName)) {
      selectAssemblyComponent(restoreName, { fitView: true });
    } else {
      objectTools.clearSelection?.();
      transformControls.detach();
      gizmoPanel.hide();
      document.getElementById("btn-gizmo")?.classList.remove("active");
      currentMesh = projectAssembly.getRoot();
      fitCamera();
    }
    setEditStatus("ok", `Undo drop: removed ${action.label || "component"}.`);
    return true;
  }
  return false;
}

function selectedObjectFilename() {
  const selection = objectTools.getSelection?.();
  const fromSelection = selection?.catalogName || (selection?.mesh ? catalogNameForMesh(selection.mesh) : null);
  return fromSelection || selectedFile || null;
}

function capturePromptSelectionContext() {
  const selection = objectTools.getSelection?.();
  const filename = selection?.catalogName || (selection?.mesh ? catalogNameForMesh(selection.mesh) : null) || selectedFile || null;
  if (!filename) return null;
  return {
    filename,
    targetMode: getPromptTargetMode(),
    bodyIndex: Number.isInteger(selection?.bodyIndex) ? selection.bodyIndex : null,
    bodyName: selection?.label || null,
  };
}

function restorePromptSelectionContext(context = pendingPromptSelectionContext, { resultFilename = null } = {}) {
  if (!context?.filename) return false;
  const targetModeSelect = document.getElementById("prompt-target-mode");
  if (context.targetMode === "edit" && targetModeSelect) targetModeSelect.value = "edit";
  const restoreName =
    (context.targetMode === "edit" && resultFilename && projectAssembly.has(resultFilename) ? resultFilename : null) ||
    (projectAssembly.has(context.filename) ? context.filename : null) ||
    (resultFilename && projectAssembly.has(resultFilename) ? resultFilename : null);
  if (!restoreName) return false;
  const objectSelect = document.getElementById("prompt-target-object");
  if (objectSelect) objectSelect.value = restoreName;
  selectedFile = restoreName;
  const bodyIndex = restoreName === context.filename && Number.isInteger(context.bodyIndex) ? context.bodyIndex : null;
  if (bodyIndex != null) {
    const entry = visiblePromptTargetEntries().find((candidate) => candidate.name === restoreName);
    const body = promptTargetBodies(entry).find((candidate) => candidate.index === bodyIndex);
    promptTargetSelectedBody = {
      filename: restoreName,
      bodyIndex,
      bodyName: body?.name || context.bodyName || `Body ${bodyIndex + 1}`,
    };
    const root = projectAssembly.get(restoreName);
    const meshes = root ? listObjectMeshes(root) : [];
    const mesh = meshes[bodyIndex] || meshes[0] || root;
    if (mesh && root) {
      objectTools.selectObject?.({ mesh, root, bodyIndex, catalogName: restoreName });
    }
    projectTree.setSelected(browserBodySelectionName(restoreName, bodyIndex));
  } else {
    promptTargetSelectedBody = null;
    selectAssemblyComponent(restoreName, { fitView: false });
  }
  featureEditor.setModel(projectId, restoreName);
  syncPromptTargetUI();
  return true;
}

function copySelectedObjectToClipboard() {
  const filename = selectedObjectFilename();
  if (!filename) {
    setEditStatus("error", "Select an object to copy.");
    return false;
  }
  objectClipboard = { projectId, filename };
  setEditStatus("ok", `Copied ${filename.replace(/\.[^.]+$/, "")}. Press Cmd/Ctrl+V to paste.`);
  return true;
}

async function duplicateSelectedObject(filename = selectedObjectFilename()) {
  if (!projectId || !filename) {
    setEditStatus("error", "Select an object to duplicate.");
    return null;
  }
  try {
    setEditStatus("loading", `Duplicating ${filename.replace(/\.[^.]+$/, "")}…`);
    const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/transform`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "delta",
        copy: true,
        // Small baked offset makes pasted copies visible instead of perfectly overlapping.
        translation: [20, 0, 0],
      }),
    });
    selectedFile = data.filename;
    await refreshFiles();
    await loadModel(data.url, data.filename, {
      projectId,
      append: true,
      catalogFilename: data.filename,
      center: false,
      normalizePivot: false,
      fitView: false,
      autoGizmo: true,
    });
    await refreshTimeline();
    setEditStatus("ok", `Duplicated as ${data.filename.replace(/\.[^.]+$/, "")}.`);
    return data;
  } catch (err) {
    const msg = err.message || "Duplicate failed.";
    setEditStatus("error", msg);
    viewerOverlay.showError(msg);
    return null;
  }
}

function transformBaselineFromPayload(raw) {
  if (!raw) return null;
  if (raw.position instanceof THREE.Vector3) {
    return {
      position: raw.position.clone(),
      quaternion: raw.quaternion?.clone?.() || new THREE.Quaternion(),
      scale: raw.scale?.clone?.() || new THREE.Vector3(1, 1, 1),
    };
  }
  const pos = raw.position;
  const quat = raw.quaternion;
  const scale = raw.scale;
  if (!Array.isArray(pos) || pos.length < 3) return null;
  return {
    position: new THREE.Vector3(pos[0], pos[1], pos[2]),
    quaternion: new THREE.Quaternion(
      Array.isArray(quat) && quat.length === 4 ? quat[0] : 0,
      Array.isArray(quat) && quat.length === 4 ? quat[1] : 0,
      Array.isArray(quat) && quat.length === 4 ? quat[2] : 0,
      Array.isArray(quat) && quat.length === 4 ? quat[3] : 1,
    ),
    scale: new THREE.Vector3(
      Array.isArray(scale) && scale.length >= 3 ? scale[0] : 1,
      Array.isArray(scale) && scale.length >= 3 ? scale[1] : 1,
      Array.isArray(scale) && scale.length >= 3 ? scale[2] : 1,
    ),
  };
}

function setEditStatus(kind, text) {
  const el = document.getElementById("edit-status");
  if (el) {
    el.className = `status ${kind}`;
    el.textContent = text;
  }
}

// ── Fusion-style direct modeling (press-pull, mirror, gizmo panel, units) ────
initUnitSwitcher(document.getElementById("unit-select"));

function currentMmPerModelUnit() {
  if (!currentMesh) return 1;
  const box = new THREE.Box3().setFromObject(currentMesh);
  return mmPerModelUnit(box.getSize(new THREE.Vector3()).length());
}

let pendingSnapTarget = null; // object | face

function objectWorldBoxCenter(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  return box.getCenter(new THREE.Vector3());
}

function objectWorldBoxCorners(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const min = box.min;
  const max = box.max;
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];
}

function supportPointAgainstNormal(obj, normalWorld) {
  const corners = objectWorldBoxCorners(obj);
  if (!corners.length) return objectWorldBoxCenter(obj);
  let best = corners[0];
  let bestDot = best.dot(normalWorld);
  for (const corner of corners.slice(1)) {
    const d = corner.dot(normalWorld);
    if (d < bestDot) {
      best = corner;
      bestDot = d;
    }
  }
  return best.clone();
}

function worldDeltaToParentDelta(obj, deltaWorld) {
  if (!obj?.parent) return deltaWorld.clone();
  obj.parent.updateMatrixWorld(true);
  const origin = objectWorldBoxCenter(obj);
  const a = obj.parent.worldToLocal(origin.clone());
  const b = obj.parent.worldToLocal(origin.clone().add(deltaWorld));
  return b.sub(a);
}

function beginSnapTarget(type) {
  const selection = objectTools?.getSelection?.();
  if (!selection?.mesh) {
    setEditStatus("error", "Select the object you want to move first.");
    gizmoPanel.clearSnapTarget?.();
    return;
  }
  pendingSnapTarget = type === "face" ? "face" : "object";
  setEditStatus(
    "ok",
    pendingSnapTarget === "face"
      ? "Snap Face: click the target face. The selected object will sit on that face."
      : "Snap Object: click a target object. Centers will align."
  );
}

function clearSnapTarget() {
  pendingSnapTarget = null;
  gizmoPanel.clearSnapTarget?.();
}

function handlePendingSnapTarget(event) {
  if (!pendingSnapTarget) return false;
  const selection = objectTools?.getSelection?.();
  if (!selection?.mesh) {
    clearSnapTarget();
    setEditStatus("error", "Select the object you want to move first.");
    return true;
  }
  const root = projectAssembly.getRoot() || currentMesh;
  const hit = pickObject(event, {
    camera,
    domElement: renderer.domElement,
    meshRoot: root,
  });
  if (!hit?.mesh) {
    setEditStatus("error", "Click a target object or face to snap to.");
    return true;
  }
  const target = selectionTargetFromMesh(hit.mesh);
  if (target.mesh === selection.mesh || target.root === selection.root) {
    setEditStatus("error", "Pick a different object or face as the snap target.");
    return true;
  }

  const source = selection.mesh;
  const mode = pendingSnapTarget;
  const targetWorld =
    mode === "face" && hit.point
      ? hit.point.clone()
      : objectWorldBoxCenter(target.mesh);
  const sourceAnchor =
    mode === "face" && hit.normal
      ? supportPointAgainstNormal(source, hit.normal.clone().normalize())
      : objectWorldBoxCenter(source);
  const delta = worldDeltaToParentDelta(source, targetWorld.sub(sourceAnchor));
  if (!gizmoPanel.translateBy?.(delta, { autoApply: true })) {
    setEditStatus("error", "Could not move the selected object.");
    return true;
  }
  clearSnapTarget();
  setEditStatus(
    "loading",
    mode === "face" ? "Snapped to face. Saving transform…" : "Snapped to object. Saving transform…"
  );
  event.preventDefault();
  return true;
}

const gizmoPanel = createGizmoPanel({
  viewport,
  transformControls,
  getMesh: () => currentMesh,
  getModelInfo: () => {
    const selection = objectTools?.getSelection?.();
    return {
      projectId,
      filename: selection?.catalogName || catalogNameForMesh(transformControls.object) || selectedFile,
      bodyIndex: selection?.bodyIndex ?? null,
      bodyCount: selection?.bodyCount || 1,
      isRoot: selection?.isRoot ?? true,
    };
  },
  getMmPerModelUnit: currentMmPerModelUnit,
  api,
  onApplied: afterModelEdit,
  onStatus: setEditStatus,
  onSnapRequest: beginSnapTarget,
});

let ribbon = null;

function setSketchModelDim(active) {
  const root = projectAssembly.getRoot();
  root?.traverse((obj) => {
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const mat of mats) {
      if (!mat) continue;
      if (active) {
        if (mat.userData._sketchOrigOpacity == null) {
          mat.userData._sketchOrigOpacity = mat.opacity ?? 1;
        }
        mat.transparent = true;
        mat.opacity = 0.12;
      } else if (mat.userData._sketchOrigOpacity != null) {
        mat.opacity = mat.userData._sketchOrigOpacity;
        mat.transparent = mat.opacity < 1;
      }
      mat.needsUpdate = true;
    }
  });
  if (currentMesh && !root) {
    currentMesh.traverse((obj) => {
      const mat = obj.material;
      if (!mat) return;
      if (active) {
        if (mat.userData._sketchOrigOpacity == null) mat.userData._sketchOrigOpacity = mat.opacity ?? 1;
        mat.transparent = true;
        mat.opacity = 0.12;
      } else if (mat.userData._sketchOrigOpacity != null) {
        mat.opacity = mat.userData._sketchOrigOpacity;
        mat.transparent = mat.opacity < 1;
      }
      mat.needsUpdate = true;
    });
  }
}

function formatSketchTool(tool) {
  return String(tool || "line").replace(/_/g, " ");
}

function enterSketchVisualMode() {
  savedSceneBg = scene.background?.getHex?.() ?? currentThemeSceneColors().canvas;
  scene.background.setHex(SKETCH_CANVAS);
  if (gridHelper) gridHelper.visible = false;
  ribbon?.setSketchEditing?.(true);
  document.querySelector(".sketch-mode-tab")?.classList.remove("hidden");
  setRightTab("sketch");
}

function exitSketchVisualMode() {
  scene.background.setHex(savedSceneBg ?? currentThemeSceneColors().canvas);
  savedSceneBg = null;
  if (gridHelper) gridHelper.visible = gridVisible;
  ribbon?.setSketchEditing?.(false);
  ribbon?.setActiveSketchTool?.(null);
  document.querySelector(".sketch-mode-tab")?.classList.add("hidden");
  document.querySelectorAll(".sketch-quick-btn").forEach((b) => b.classList.remove("active"));
}

function updateSketchChrome({ visible, plane, tool, hint, entities = 0, constraints = 0 } = {}) {
  const chrome = document.getElementById("sketch-chrome");
  if (!chrome) return;
  chrome.classList.toggle("hidden", !visible);

  const planeLabel = document.getElementById("sketch-plane-label");
  const statusTool = document.getElementById("sketch-status-tool");
  const statusHint = document.getElementById("sketch-status-hint");
  const statusStats = document.getElementById("sketch-status-stats");
  const inspPlane = document.getElementById("sketch-inspector-plane");
  const inspTool = document.getElementById("sketch-inspector-tool");
  const inspEntities = document.getElementById("sketch-inspector-entities");
  const inspConstraints = document.getElementById("sketch-inspector-constraints");
  const inspHint = document.getElementById("sketch-inspector-hint");

  const toolLabel = formatSketchTool(tool);
  if (planeLabel && visible) planeLabel.textContent = `${plane || "XY"} Plane · Edit Sketch`;
  if (statusTool) statusTool.textContent = toolLabel;
  if (statusHint) {
    statusHint.textContent = hint || "";
    statusHint.classList.toggle("sketch-status-hint--error", !!hint && /closed profile|draw a closed|constraints/i.test(hint));
  }
  if (statusStats) statusStats.textContent = `${entities} ent · ${constraints} constraints`;
  if (inspPlane) inspPlane.textContent = plane || "XY";
  if (inspTool) inspTool.textContent = toolLabel;
  if (inspEntities) inspEntities.textContent = String(entities);
  if (inspConstraints) inspConstraints.textContent = String(constraints);
  if (inspHint) inspHint.textContent = hint || "";

  document.querySelectorAll(".sketch-quick-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.sketchTool === tool);
  });
  ribbon?.setActiveSketchTool?.(tool);
}

function enterSketchMode() {
  transformControls.detach();
  gizmoPanel.hide();
  document.getElementById("btn-gizmo")?.classList.remove("active");
  objectTools.clearSelection();
  activatePickMode("off");
  directModeling.setTool?.(null);
}

function exitSketchMode() {
  if (sketchEditor.isActive()) sketchEditor.cancel();
  else {
    setSketchModelDim(false);
    document.getElementById("app")?.classList.remove("sketch-editing");
    updateSketchChrome({ visible: false });
    exitSketchVisualMode();
    controls.enabled = true;
  }
}

function finishActiveSketch() {
  if (!sketchEditor.isActive()) {
    setEditStatus("error", "No active sketch to finish.");
    return false;
  }
  try {
    return sketchEditor.finish();
  } catch (err) {
    console.error("Finish sketch failed:", err);
    setEditStatus("error", err?.message || "Finish sketch failed.");
    sketchEditor.cancel();
    exitSketchMode();
    return false;
  }
}

function enterRiggingMode() {
  transformControls.detach();
  gizmoPanel.hide();
  document.getElementById("btn-gizmo")?.classList.remove("active");
  objectTools.clearSelection();
  controls.enabled = true;
  document.getElementById("rigging-chrome")?.classList.remove("hidden");
  refreshRiggingPromptHistory();
  setRightTab("rigging");
  riggingPromptHistory.setTab("compose");
  void (async () => {
    if (selectedFile) await loadSimForFile(selectedFile);
    await riggingEditor.show();
    const bound = riggingEditor.refreshMeshBindings?.() ?? 0;
    const root = getRiggingPartRoot() || projectAssembly.getRoot() || currentMesh;
    // Jake contract: motion comes from .step.js (or URDF), not mesh-name heuristics.
    const stepBound = await stepModuleRuntime.bind(root);
    if (stepBound > 0 && stepModuleRuntime.hasModule()) {
      setEditStatus(
        "ok",
        `STEP module ready (${stepBound} features from ${stepModuleRuntime.moduleName() || ".step.js"}). Press Play.`
      );
    } else if (detectPlanetaryGearAssembly(root)) {
      const n = planetaryGearRuntime.bind(root);
      setEditStatus("ok", `Planetary fallback ready (${n} parts). Prefer authoring a .step.js module.`);
    } else if (bound >= 2) {
      setEditStatus("ok", `Rigging ready — ${bound} parts bound for animation. Press Play.`);
    } else if (selectedFile) {
      setEditStatus(
        "error",
        "No .step.js motion module for this model. Mechanisms need a Jake-style parameter sidecar."
      );
    }
    syncRiggingToolbelt();
    syncRiggingViewportPlaybackUi();
  })();
  setRiggingViewportPlaybackVisible(true);
}

function exitRiggingMode() {
  document.getElementById("rigging-chrome")?.classList.add("hidden");
  stepModuleRuntime?.stop?.({ reset: true });
  planetaryGearRuntime?.stop?.({ reset: true });
  riggingEditor.hide();
  setRiggingViewportPlaybackVisible(false);
}

const riggingViewportPlaybackUi = {
  container: null,
  button: null,
  pollTimer: null,
};

function ensureRiggingViewportPlaybackUi() {
  if (riggingViewportPlaybackUi.container) return riggingViewportPlaybackUi;
  if (!viewport) return riggingViewportPlaybackUi;
  const computed = window.getComputedStyle(viewport);
  if (computed.position === "static") viewport.style.position = "relative";

  const container = document.createElement("div");
  container.id = "rigging-viewport-playback";
  container.style.position = "absolute";
  container.style.left = "50%";
  container.style.bottom = "14px";
  container.style.transform = "translateX(-50%)";
  container.style.zIndex = "18";
  container.style.display = "none";

  const button = document.createElement("button");
  button.type = "button";
  button.id = "btn-rigging-viewport-play";
  button.className = "btn";
  button.textContent = "Play";
  button.title = "Play/pause rig animation";
  button.addEventListener("click", () => {
    toggleRiggingPlayback();
  });

  container.appendChild(button);
  viewport.appendChild(container);
  riggingViewportPlaybackUi.container = container;
  riggingViewportPlaybackUi.button = button;
  return riggingViewportPlaybackUi;
}

function syncRiggingViewportPlaybackUi() {
  const ui = ensureRiggingViewportPlaybackUi();
  if (!ui.button) return;
  const playing = !!(
    riggingEditor?.isPlaying?.() ||
    stepModuleRuntime?.isPlaying?.() ||
    planetaryGearRuntime?.isPlaying?.()
  );
  ui.button.textContent = playing ? "Pause" : "Play";
  ui.button.classList.toggle("active", playing);
}

function setRiggingViewportPlaybackVisible(visible) {
  const ui = ensureRiggingViewportPlaybackUi();
  if (!ui.container) return;
  ui.container.style.display = visible ? "block" : "none";
  if (visible) {
    syncRiggingViewportPlaybackUi();
    if (!ui.pollTimer) {
      ui.pollTimer = window.setInterval(syncRiggingViewportPlaybackUi, 350);
    }
  } else if (ui.pollTimer) {
    window.clearInterval(ui.pollTimer);
    ui.pollTimer = null;
  }
}

function architectPromptPrefix() {
  const gridMm = Number(document.getElementById("architect-grid-size")?.value || 1000);
  const wallHeightMm = Number(document.getElementById("architect-wall-height")?.value || 2800);
  return [
    "Architect mode room-first modular house CAD:",
    `Use a ${gridMm} mm snap grid and ${wallHeightMm} mm wall height.`,
    "Build one recognizable room module at a time unless I explicitly ask for a full multi-room house, but make it out of separate editable bodies/pieces.",
    "A room module must include separate named parts/bodies for the floor slab, north/south/east/west wall panels, door/window inserts, trim/baseboards, corner connectors, ceiling/roof sockets, and snap interfaces.",
    "Never fuse the room or house into one solid; Render3D must be able to select each wall piece, adjust its length, move it around, and snap it into place.",
    "Design parts for 3D printing and robot assembly: chunky tabs, sockets, rails, keyed connectors, chamfered lead-ins, robot pick tabs, grip flats, orientation labels, and mating-side labels.",
    "Leave one wall open, lowered, or cut away so the Render3D preview looks like a real interior room instead of a closed cube.",
    "Use house materials/colors: warm wood or tan floors, light plaster/drywall walls, darker roof/ceiling parts, blue glass, and contrasting trim/connectors.",
    "Keep modules rectangular/grid-aligned unless asked otherwise, with STEP-valid separate solids, semantic names, connector pockets/tabs, alignment keys, robot assembly labels, clearance notes, and build order notes.",
  ].join(" ");
}

function architectPresetPrompt(kind = "room") {
  const prefix = architectPromptPrefix();
  const presets = {
    room: "Generate `starter_room_2x3`: a complete living-room module built from separate editable bodies, not one fused block. Include separate warm wood floor slab, separate light plaster north/south/east/west wall panels with adjustable wall lengths, one open/cutaway wall for visibility, a door opening with separate removable door insert, a separate blue-glass window insert, separate baseboards/trim, corner posts, snap rails around the floor, roof/ceiling sockets, print-friendly connectors, robot pick tabs, orientation labels, and mating-side labels.",
    wall: "Generate a modular wall panel that clearly belongs to a room: light plaster wall body with visible thickness, independently adjustable length, bottom snap rail, side connector pockets, top cap, baseboard trim, one framed blue-glass window insert, sill/lintel parts, robot pick tabs, and labeled mating interfaces to floor and corner posts.",
    roof: "Generate a roof and ceiling module that snaps onto a 2 by 3 room: separate dark roof panels, ceiling underside, overhang, ridge/edge beams, alignment sockets, removable panel sections, robot grip flats, and labels showing which room walls it mates to.",
    robot: "Generate a robot-assembly-friendly starter room kit: separate floor slab, separate wall panels, one corner connector, one small window insert, one door insert, numbered snap features, chunky printable tabs/sockets, lift tabs, grip flats, and explicit assembly order labels.",
    window: "Generate a replaceable window insert module for a house wall: blue glass pane, frame, sill, lintel, weather lip, snap tabs, alignment keys, trim, and robot gripper flats. Include a matching wall-opening reference frame.",
    door: "Generate a modular door insert for a room wall: door panel, frame, threshold rail, hinge-side connector features, latch-side alignment pockets, trim, handle detail, snap sockets, and robot assembly labels.",
    floor: "Generate a modular room floor slab, not just a plate: warm wood/tan finish, visible plank or tile pattern, perimeter wall snap rails, corner-post sockets, underside robot lift pockets, alignment sockets on all edges, and labels for north/south/east/west wall positions.",
    pattern: "Generate a two-room grid pattern made from separate room modules: separate floor slabs, separate wall panels, a shared wall connection, labeled module coordinates, doors/windows as separate inserts, snap sockets, and assembly order labels. Keep each room and each wall readable/selectable as a separate module.",
    image: "Use Architect mode to generate one complete modular room from an attached reference image. Preserve recognizable house colors/materials, include floor/walls/windows/door/trim, leave one side open for interior visibility, and add snap interfaces plus robot pick labels.",
    blueprint: "Use Architect mode to convert an attached floor plan or blueprint into one room module at a time. Start with a 2 by 3 starter room with floor, named walls, door/window modules, trim, snap interfaces, and labels showing where the next room connects.",
    service: "Generate a compact service-core wall module for a room: light wall panel, electrical conduit chase, plumbing chase placeholder, removable cover, access panel, baseboard/trim, connector rails, and robot pick tabs.",
  };
  return `${prefix}\n\n${presets[kind] || presets.room}`;
}

function architectEditPrompt(kind = "customize", filename = selectedObjectFilename()) {
  const target = architectSelectedEditTarget(filename);
  const prompts = {
    wall: `${target}Edit only the selected wall piece. Preserve it as a separate editable wall body/component and keep its floor/corner/roof snap interfaces unchanged. Add or refine house details as separate named parts: studs or panel seams, baseboard, trim, connector pockets, robot lift tabs, wall labels, and optional accent pattern.`,
    window: `${target}Edit only the selected wall piece to add or resize a window opening. Preserve the wall as its own editable piece, and add separate named parts for blue-glass window_insert, sill, lintel, trim frame, snap tabs, alignment keys, and robot pick tabs.`,
    door: `${target}Edit only the selected wall piece to add a modular door opening. Preserve the wall as its own editable piece, and add separate named parts for removable door_insert, threshold rail, hinge-side labels, latch-side alignment pocket, snap sockets, and trim.`,
    idea: `${target}Create a generative architectural idea for the selected wall piece while preserving its grid footprint and snap interfaces. Examples: bay window, built-in shelves, planter window, service chase, decorative trim pattern, stronger robot lift tabs, or alternate window layout. Keep every added detail as separate named pieces where practical.`,
    materials: `${target}Apply house-like material/color styling to the selected architect piece(s). Use warm wood floors, light drywall or plaster walls, darker roof material, glassy blue window panels, trim colors, and keep all snap interfaces visible and labeled.`,
    customize: `${target}Customize the selected architect piece while preserving its grid footprint and snap interfaces. Add useful house-building details as separate named parts: labeled panels, stronger rails, connector pockets, robot lift points, trim, and assembly notes.`,
  };
  return `${architectPromptPrefix()}\n\n${prompts[kind] || prompts.customize}`;
}

function architectTexturePatternPrompt(filename = selectedObjectFilename()) {
  const target = architectSelectedEditTarget(filename);
  return `${architectPromptPrefix()}

${target}Generate a realistic surface texture/color pattern on this selected wall module for Bambu multi-color printing.

Requirements:
- Keep the wall footprint, sockets, and snap connectors unchanged.
- Add printable pattern regions as separate named solids/material zones, not just visual color: pattern_color_1, pattern_color_2, pattern_color_3 (use fewer if prompt only implies 2 colors).
- Pattern bodies must be shallow raised/inlaid features on the wall skin (about 0.4 mm to 1.2 mm deep), manifold, and fully attached (no floating islands).
- Use realistic interior style details: cabinet grain bands, shelving accents, trim stripes, tile/plaster motif, or brick/plank style as appropriate.
- Keep all pattern geometry printable and easy to assign to separate filament colors in the slicer.
- Return separate editable parts/bodies so the viewport tree can select/move each pattern piece if needed.

If no style is specified, produce a clean 3-color modern wall pattern with printable stripe and panel accents.`;
}

function architectSelectedEditTarget(filename = selectedObjectFilename()) {
  const selection = objectTools?.getSelection?.();
  const selectedBody = selection && Number.isInteger(selection.bodyIndex) && (selection.bodyCount || 1) > 1
    ? {
        filename: selection.catalogName || filename,
        bodyIndex: selection.bodyIndex,
        bodyName: selection.label || `Body ${selection.bodyIndex + 1}`,
      }
    : null;
  if (selectedBody?.filename) {
    return `Target selected wall/body: ${selectedBody.bodyName} inside ${selectedBody.filename}. Use body_index ${selectedBody.bodyIndex}. `;
  }
  return filename
    ? `Target selected module: ${filename}. If this is a room assembly, ask me to select an individual wall body before wall-level edits. `
    : "No wall is selected yet; ask me to select a wall piece first before applying wall-level Architect tools. ";
}

const ARCHITECT_LOCAL_MODULES = [
  {
    id: "floor",
    title: "Floor Slab",
    category: "Floors",
    description: "Grid floor slab with wall rails, corner sockets, and warm wood material.",
  },
  {
    id: "floor-small",
    title: "Small Floor Tile",
    category: "Floors",
    description: "One-cell floor tile for fast fort-builder style layouts.",
  },
  {
    id: "floor-wide",
    title: "Wide Floor Bay",
    category: "Floors",
    description: "Wide 2 x 2 floor bay with snap rails on every side.",
  },
  {
    id: "wall",
    title: "Wall Panel",
    category: "Walls",
    description: "Straight grid wall panel with connector rails. Drag or scale it by hand after placement.",
  },
  {
    id: "wall-half",
    title: "Half Wall",
    category: "Walls",
    description: "Short half-wall / railing piece for open rooms and balconies.",
  },
  {
    id: "wall-low",
    title: "Low Divider",
    category: "Walls",
    description: "Low interior divider wall that snaps to the same grid.",
  },
  {
    id: "wall-corner",
    title: "Corner Wall",
    category: "Walls",
    description: "L-shaped corner wall piece with two snap faces.",
  },
  {
    id: "wall-window-wide",
    title: "Wide Window Wall",
    category: "Walls",
    description: "Wide wall segment with a larger window opening and reinforced side rails.",
  },
  {
    id: "wall-double-window",
    title: "Double Window Wall",
    category: "Walls",
    description: "Long wall panel with two window bays and center support.",
  },
  {
    id: "wall-shelf",
    title: "Shelved Utility Wall",
    category: "Walls",
    description: "Wall panel with integrated shelf and bracket details for room interiors.",
  },
  {
    id: "pillar",
    title: "Snap Pillar",
    category: "Walls",
    description: "Printable corner/structural pillar with sockets for walls and floor rails.",
  },
  {
    id: "pillar-tall",
    title: "Tall Pillar",
    category: "Walls",
    description: "Full-height robot-grabbable pillar for roof and wall alignment.",
  },
  {
    id: "window",
    title: "Window Insert",
    category: "Openings",
    description: "Separate blue-glass window insert with frame, sill, lintel, and snap tabs.",
  },
  {
    id: "window-large",
    title: "Large Window Insert",
    category: "Openings",
    description: "Panoramic style window insert with broader glass and trim.",
  },
  {
    id: "door",
    title: "Door Insert",
    category: "Openings",
    description: "Separate door insert with frame, threshold, trim, and connector pockets.",
  },
  {
    id: "window-wall",
    title: "Wall + Window",
    category: "Walls",
    description: "Wall panel with window opening, sill, lintel, and snap rails.",
  },
  {
    id: "door-wall",
    title: "Wall + Door",
    category: "Walls",
    description: "Wall panel with door opening, threshold, and side connector pockets.",
  },
  {
    id: "room",
    title: "Starter Room Kit",
    category: "Rooms",
    description: "Floor slab plus four wall runs with a window and a door opening.",
  },
  {
    id: "roof",
    title: "Roof / Ceiling Panel",
    category: "Roof",
    description: "Flat roof module with overhang and alignment sockets.",
  },
  {
    id: "roof-gable",
    title: "Gable Roof",
    category: "Roof",
    description: "Pitched gable roof made from two sloped-looking panels and a ridge cap.",
  },
  {
    id: "roof-flat",
    title: "Flat Roof Tile",
    category: "Roof",
    description: "Simple flat roof/ceiling tile for stacking room modules.",
  },
  {
    id: "roof-corner",
    title: "Roof Corner Cap",
    category: "Roof",
    description: "Corner cap for turning roof runs around an L-shaped house.",
  },
  {
    id: "service",
    title: "Service Core",
    category: "Utilities",
    description: "Wall utility chase with removable cover and robot pick tabs.",
  },
];

const ARCHITECT_FAVORITES_KEY = "render3d:architect-favorites:v1";

function readArchitectFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(ARCHITECT_FAVORITES_KEY) || "null");
    const modules = Array.isArray(raw?.modules) ? raw.modules.filter((item) => typeof item === "string") : [];
    const files = Array.isArray(raw?.files) ? raw.files.filter((item) => typeof item === "string") : [];
    return { modules, files };
  } catch {
    return { modules: [], files: [] };
  }
}

function writeArchitectFavorites(value) {
  try {
    localStorage.setItem(ARCHITECT_FAVORITES_KEY, JSON.stringify({
      modules: [...new Set([...(value?.modules || [])])],
      files: [...new Set([...(value?.files || [])])],
    }));
  } catch {
    /* local storage is best-effort */
  }
}

function toggleArchitectFavorite(kind, value) {
  const favorites = readArchitectFavorites();
  const key = kind === "file" ? "files" : "modules";
  const items = new Set(favorites[key] || []);
  if (items.has(value)) items.delete(value);
  else items.add(value);
  favorites[key] = [...items];
  writeArchitectFavorites(favorites);
  return items.has(value);
}

function architectDimensions() {
  const grid = Number(document.getElementById("architect-grid-size")?.value || 1000);
  const wallHeight = Number(document.getElementById("architect-wall-height")?.value || 2800);
  return {
    grid,
    wallHeight,
    thickness: Math.max(90, Math.round(grid * 0.12)),
    wallLength: Math.round(grid * 2),
  };
}

const ARCHITECT_CONNECTOR_PROFILE_KEY = "render3d:architect-connector-profile:v1";

function clampArchitectConnectorSize(value) {
  return Math.round(THREE.MathUtils.clamp(Number(value) || 180, 60, 600));
}

function storedArchitectConnectorProfile() {
  try {
    return JSON.parse(localStorage.getItem(ARCHITECT_CONNECTOR_PROFILE_KEY) || "null");
  } catch {
    return null;
  }
}

function architectConnectorSettings() {
  const profile = storedArchitectConnectorProfile();
  const preset = document.getElementById("architect-connector-preset")?.value || (profile ? "dxf_profile" : "robot_snap");
  const sizeInput = document.getElementById("architect-connector-size");
  const size = clampArchitectConnectorSize(sizeInput?.value || profile?.size_mm || 180);
  return {
    preset,
    profileName: profile?.name || "",
    size,
    width: size,
    depth: Math.max(75, Math.round(size * 0.58)),
    height: Math.max(62, Math.round(size * 0.42)),
  };
}

function parseArchitectConnectorDxfProfile(text = "", name = "connector.dxf") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim());
  const xs = [];
  const ys = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = Number(lines[i]);
    const value = Number(lines[i + 1]);
    if (!Number.isFinite(code) || !Number.isFinite(value)) continue;
    if (code >= 10 && code <= 18) xs.push(value);
    if (code >= 20 && code <= 28) ys.push(value);
    if (code === 40) {
      xs.push(-value, value);
      ys.push(-value, value);
    }
  }
  const width = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const footprint = Math.max(width, height);
  return {
    name,
    size_mm: clampArchitectConnectorSize(footprint || 180),
    width_mm: Math.round(width || footprint || 180),
    height_mm: Math.round(height || footprint || 180),
  };
}

function updateArchitectConnectorStatus() {
  const status = document.getElementById("architect-connector-status");
  if (!status) return;
  const settings = architectConnectorSettings();
  status.textContent = settings.preset === "dxf_profile" && settings.profileName
    ? `Using DXF connector profile: ${settings.profileName} (${settings.size} mm).`
    : `Using ${settings.preset === "simple" ? "simple block" : "built-in no-screw robot snap"} connector (${settings.size} mm).`;
}

function architectBoxFeature(length, width, height, at = [0, 0, 0], combine = "add") {
  return { op: "box", combine, length, width, height, at };
}

let architectInstanceSerial = 0;

function sceneMmPerModelUnit() {
  const box = projectAssembly.boundingBox();
  const extent = box ? box.getSize(new THREE.Vector3()).length() : NaN;
  return Number(mmPerModelUnit(extent) || 1) || 1;
}

function architectInstanceScale() {
  const unit = sceneMmPerModelUnit();
  return 1 / unit;
}

function architectGridModelUnits() {
  const gridMm = Number(document.getElementById("architect-grid-size")?.value || 1000);
  return gridMm / sceneMmPerModelUnit();
}

/** Architect 3 ft bay overlay — separate from Design GridHelper; hidden outside Architect. */
const architectBayGrid = createArchitectBayGrid({
  scene,
  getMmPerModelUnit: () => sceneMmPerModelUnit(),
  // Large field: ~100+ bays across so the plan never feels like a tiny postage stamp.
  getExtentModel: () => Math.max(sceneRadius() * 10, architectGridModelUnits() * 64),
});

/** Architect session (building + draw + mesh + camera). Created lazily after api() exists… 
 *  api is defined later — we bind getProjectId/api via closures that read live bindings. */
let architectSession = null;
function getArchitectSession() {
  if (architectSession) return architectSession;
  architectSession = createArchitectSession({
    scene,
    camera,
    controls,
    domElement: renderer.domElement,
    getMmPerModelUnit: () => sceneMmPerModelUnit(),
    bayGrid: architectBayGrid,
    api: (...args) => api(...args),
    getProjectId: () => projectId,
    onStatus: (tone, msg) => setEditStatus(tone, msg),
  });
  return architectSession;
}

function architectBoxMesh({ length, width, height, at = [0, 0, 0], color = "#d8cab0", name = "architect_part", opacity = 1 }) {
  const scale = architectInstanceScale();
  const geom = new THREE.BoxGeometry(length * scale, width * scale, height * scale, 2, 2, 2);
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: 0.58,
    metalness: 0.04,
    clearcoat: 0.12,
    clearcoatRoughness: 0.35,
    transparent: opacity < 1,
    opacity,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = name;
  mesh.position.set(at[0] * scale, at[1] * scale, at[2] * scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addArchitectBox(group, box) {
  const mesh = architectBoxMesh(box);
  group.add(mesh);
  return mesh;
}

function architectCylinderMesh({
  radius,
  depth,
  at = [0, 0, 0],
  color = "#d8cab0",
  name = "architect_round_part",
  axis = "y",
  segments = 24,
}) {
  const scale = architectInstanceScale();
  const geom = new THREE.CylinderGeometry(radius * scale, radius * scale, depth * scale, segments);
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: 0.5,
    metalness: 0.18,
    clearcoat: 0.2,
    clearcoatRoughness: 0.28,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = name;
  mesh.position.set(at[0] * scale, at[1] * scale, at[2] * scale);
  if (axis === "x") mesh.rotation.z = Math.PI / 2;
  if (axis === "z") mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addArchitectCylinder(group, cylinder) {
  const mesh = architectCylinderMesh(cylinder);
  group.add(mesh);
  return mesh;
}

function markArchitectInstance(obj, catalogName, kind) {
  obj.traverse((child) => {
    child.userData.catalogFilename = catalogName;
    child.userData.localOnly = true;
    child.userData.architectInstance = true;
    child.userData.architectKind = kind;
  });
}

function createArchitectInstance(kind = "wall") {
  const { grid, wallHeight, thickness, wallLength } = architectDimensions();
  const connectorProfile = architectConnectorSettings();
  const group = new THREE.Group();
  group.userData.localOnly = true;
  group.userData.architectInstance = true;
  group.userData.architectKind = kind;
  const add = (length, width, height, at, color, name, opacity = 1) =>
    addArchitectBox(group, { length, width, height, at, color, name, opacity });
  const cyl = (radius, depth, at, color, name, axis = "y", segments = 24) =>
    addArchitectCylinder(group, { radius, depth, at, color, name, axis, segments });
  const wallColor = "#e8e1d2";
  const trim = "#f7f0de";
  const connector = "#5c6b73";
  const wood = "#c79552";
  const roof = "#3f3f46";
  const glass = "#6fb6ff";
  const darkWood = "#7b5436";
  const metal = "#c8a75a";

  const addSnapConnector = ({
    side = "east",
    type = "male",
    at = [0, 0, 0],
    name = "robot_snap_connector",
    size = connectorProfile.size,
  } = {}) => {
    const simple = connectorProfile.preset === "simple";
    const width = size;
    const depth = Math.max(65, Math.round(size * 0.55));
    const height = Math.max(55, Math.round(size * 0.38));
    const axisX = side === "east" || side === "west";
    const sign = side === "east" || side === "north" ? 1 : -1;
    const cx = at[0] + (axisX ? sign * depth / 2 : 0);
    const cy = at[1] + (!axisX ? sign * depth / 2 : 0);
    const lx = axisX ? depth : width;
    const ly = axisX ? width : depth;
    const railX = axisX ? depth * 0.82 : width * 0.24;
    const railY = axisX ? width * 0.24 : depth * 0.82;
    const faceX = at[0] + (axisX ? sign * (depth + 10) : 0);
    const faceY = at[1] + (!axisX ? sign * (depth + 10) : 0);
    if (type === "female") {
      add(lx, ly, height, [cx, cy, at[2] + height / 2], connector, `${name}_female_outer_socket`);
      if (!simple) {
        add(axisX ? 18 : width * 0.72, axisX ? width * 0.72 : 18, height * 0.62, [faceX, faceY, at[2] + height * 0.52], "#1f2937", `${name}_visible_snap_cavity`);
        add(axisX ? depth * 0.72 : 22, axisX ? 22 : depth * 0.72, height * 0.18, [cx, cy, at[2] + height + 10], "#94a3b8", `${name}_lead_in_chamfer_lip`);
        add(axisX ? 24 : width * 0.16, axisX ? width * 0.16 : 24, height * 0.5, [cx - (axisX ? 0 : width * 0.28), cy - (axisX ? width * 0.28 : 0), at[2] + height * 0.55], "#334155", `${name}_left_lock_relief`);
        add(axisX ? 24 : width * 0.16, axisX ? width * 0.16 : 24, height * 0.5, [cx + (axisX ? 0 : width * 0.28), cy + (axisX ? width * 0.28 : 0), at[2] + height * 0.55], "#334155", `${name}_right_lock_relief`);
      }
      return;
    }
    add(lx, ly, height, [cx, cy, at[2] + height / 2], "#64748b", `${name}_male_tongue`);
    if (!simple) {
      add(railX, railY, height * 0.32, [cx, cy, at[2] + height + height * 0.16], "#cbd5e1", `${name}_raised_center_key`);
      add(axisX ? depth * 0.22 : width * 0.72, axisX ? width * 0.72 : depth * 0.22, height * 0.28, [faceX, faceY, at[2] + height * 0.64], "#94a3b8", `${name}_rounded_lead_in_nose`);
      cyl(Math.max(14, size * 0.075), axisX ? width * 0.72 : depth * 0.72, [cx, cy, at[2] + height * 0.72], "#e2e8f0", `${name}_spring_lock_bar`, axisX ? "y" : "x", 18);
      add(axisX ? depth * 0.18 : width * 0.16, axisX ? width * 0.16 : depth * 0.18, height * 0.25, [cx, cy, at[2] + height * 1.48], "#f8fafc", `${name}_robot_visual_alignment_mark`);
    }
  };

  const addWallDetails = (length = wallLength, h = wallHeight, prefix = "wall") => {
    add(length, 26, 62, [0, -thickness / 2 - 18, 90], trim, `${prefix}_baseboard_front`);
    add(length, 22, 48, [0, -thickness / 2 - 16, h - 52], trim, `${prefix}_crown_trim_front`);
    add(48, 24, h * 0.76, [-length * 0.28, -thickness / 2 - 18, h * 0.52], "#ddd6c5", `${prefix}_subtle_vertical_panel_seam_left`);
    add(48, 24, h * 0.76, [length * 0.28, -thickness / 2 - 18, h * 0.52], "#ddd6c5", `${prefix}_subtle_vertical_panel_seam_right`);
    for (let i = -2; i <= 2; i += 1) {
      add(12, 18, h * 0.84, [i * (length / 5), -thickness / 2 - 12, h * 0.52], "#e1d8c7", `${prefix}_wall_texture_batten_${i + 3}`);
    }
    const shelfWidth = Math.max(220, length * 0.42);
    const shelfUpperZ = h * 0.66;
    add(shelfWidth, 36, 24, [0, -thickness / 2 - 46, shelfUpperZ], wood, `${prefix}_floating_shelf_upper`);
    add(shelfWidth * 0.9, 34, 22, [0, -thickness / 2 - 46, shelfUpperZ - 92], wood, `${prefix}_floating_shelf_lower`);
    add(16, 44, 64, [-shelfWidth * 0.35, -thickness / 2 - 48, shelfUpperZ - 28], "#a67c52", `${prefix}_shelf_bracket_left`);
    add(16, 44, 64, [shelfWidth * 0.35, -thickness / 2 - 48, shelfUpperZ - 28], "#a67c52", `${prefix}_shelf_bracket_right`);
    const cabinetWidth = Math.max(240, length * 0.48);
    const cabinetHeight = Math.max(130, h * 0.34);
    const cabinetCenterZ = cabinetHeight / 2 + 72;
    add(cabinetWidth, 74, cabinetHeight, [0, -thickness / 2 - 68, cabinetCenterZ], "#d6cfbf", `${prefix}_base_cabinet_body`);
    add(cabinetWidth * 0.48, 18, cabinetHeight * 0.92, [-cabinetWidth * 0.24, -thickness / 2 - 108, cabinetCenterZ], "#ece6d9", `${prefix}_cabinet_door_left`);
    add(cabinetWidth * 0.48, 18, cabinetHeight * 0.92, [cabinetWidth * 0.24, -thickness / 2 - 108, cabinetCenterZ], "#ece6d9", `${prefix}_cabinet_door_right`);
    cyl(7, 14, [-cabinetWidth * 0.03, -thickness / 2 - 122, cabinetCenterZ + cabinetHeight * 0.2], metal, `${prefix}_cabinet_handle_left`, "y", 16);
    cyl(7, 14, [cabinetWidth * 0.03, -thickness / 2 - 122, cabinetCenterZ + cabinetHeight * 0.2], metal, `${prefix}_cabinet_handle_right`, "y", 16);
    addSnapConnector({ side: "west", type: "male", at: [-length / 2, 0, 125], name: `${prefix}_west_robot_snap` });
    addSnapConnector({ side: "east", type: "male", at: [length / 2, 0, 125], name: `${prefix}_east_robot_snap` });
    addSnapConnector({ side: "south", type: "male", at: [-length * 0.28, -thickness / 2, 0], name: `${prefix}_floor_left_robot_snap`, size: connectorProfile.size * 0.75 });
    addSnapConnector({ side: "south", type: "male", at: [length * 0.28, -thickness / 2, 0], name: `${prefix}_floor_right_robot_snap`, size: connectorProfile.size * 0.75 });
    add(125, 48, 44, [0, -thickness / 2 - 28, h * 0.62], "#b8c0c8", `${prefix}_robot_grip_pad`);
  };

  const addWindowDetails = (cx = 0, zc = wallHeight * 0.58, w = grid * 0.52, h = wallHeight * 0.36, y = -thickness / 2 - 28) => {
    add(w, 30, h, [cx, y - 4, zc], glass, "blue_glass_pane", 0.72);
    add(w + 155, 58, 72, [cx, y - 8, zc - h / 2 - 58], trim, "deep_window_sill_with_lip");
    add(w + 135, 52, 68, [cx, y - 7, zc + h / 2 + 54], trim, "window_lintel_header_trim");
    add(64, 52, h + 140, [cx - w / 2 - 62, y - 7, zc], trim, "window_left_jamb_trim");
    add(64, 52, h + 140, [cx + w / 2 + 62, y - 7, zc], trim, "window_right_jamb_trim");
    add(42, 42, h, [cx, y - 16, zc], "#f1f5f9", "window_center_mullion");
    add(w, 42, 42, [cx, y - 17, zc], "#f1f5f9", "window_cross_mullion");
    addSnapConnector({ side: "west", type: "male", at: [cx - w / 2 - 80, y - 2, zc - 70], name: "window_left_robot_snap", size: connectorProfile.size * 0.62 });
    addSnapConnector({ side: "east", type: "male", at: [cx + w / 2 + 80, y - 2, zc - 70], name: "window_right_robot_snap", size: connectorProfile.size * 0.62 });
  };

  const addDoorDetails = (cx = 0, y = -thickness / 2 - 24, w = grid * 0.5, h = wallHeight * 0.72) => {
    add(w, 42, h, [cx, y, h / 2], darkWood, "recessed_wood_door_slab");
    add(w * 0.34, 16, h * 0.25, [cx - w * 0.18, y - 26, h * 0.68], "#8f6844", "upper_left_raised_door_panel");
    add(w * 0.34, 16, h * 0.25, [cx + w * 0.18, y - 26, h * 0.68], "#8f6844", "upper_right_raised_door_panel");
    add(w * 0.34, 16, h * 0.32, [cx - w * 0.18, y - 26, h * 0.34], "#8f6844", "lower_left_raised_door_panel");
    add(w * 0.34, 16, h * 0.32, [cx + w * 0.18, y - 26, h * 0.34], "#8f6844", "lower_right_raised_door_panel");
    add(w + 175, 72, 78, [cx, y - 8, h + 38], trim, "door_header_casing");
    add(78, 70, h + 120, [cx - w / 2 - 78, y - 8, (h + 120) / 2], trim, "door_left_jamb_casing");
    add(78, 70, h + 120, [cx + w / 2 + 78, y - 8, (h + 120) / 2], trim, "door_right_jamb_casing");
    add(w + 210, 92, 70, [cx, y - 12, 35], "#d6b37a", "door_threshold_sill");
    cyl(34, 32, [cx + w * 0.34, y - 54, h * 0.52], metal, "round_brass_door_knob", "y", 28);
    addSnapConnector({ side: "west", type: "male", at: [cx - w / 2 - 85, y + 10, h * 0.35], name: "door_left_robot_snap", size: connectorProfile.size * 0.64 });
    addSnapConnector({ side: "east", type: "male", at: [cx + w / 2 + 85, y + 10, h * 0.35], name: "door_right_robot_snap", size: connectorProfile.size * 0.64 });
  };

  if (kind === "floor" || kind === "floor-small" || kind === "floor-wide") {
    const lx = kind === "floor-small" ? grid : kind === "floor-wide" ? grid * 2 : wallLength;
    const ly = kind === "floor-small" ? grid : kind === "floor-wide" ? grid * 2 : grid * 1.5;
    add(lx, ly, 90, [0, 0, 45], wood, "floor_slab_wood");
    for (let i = -3; i <= 3; i += 1) {
      add(lx - 120, 18, 8, [0, (i * ly) / 8, 94], i % 2 ? "#d2a45f" : "#bb8343", `floor_plank_gap_${i + 4}`);
    }
    for (let i = -2; i <= 2; i += 1) {
      add(16, ly - 140, 10, [(i * lx) / 6, 0, 98], "#b77738", `floor_cross_grain_seam_${i + 3}`);
    }
    add(lx + 140, 55, 70, [0, -ly / 2 - 70, 125], "#d8b074", "floor_snap_rail_south");
    add(lx + 140, 55, 70, [0, ly / 2 + 70, 125], "#d8b074", "floor_snap_rail_north");
    add(55, ly + 140, 70, [-lx / 2 - 70, 0, 125], "#d8b074", "floor_snap_rail_west");
    add(55, ly + 140, 70, [lx / 2 + 70, 0, 125], "#d8b074", "floor_snap_rail_east");
    [-0.25, 0.25].forEach((t, i) => {
      addSnapConnector({ side: "south", type: "female", at: [lx * t, -ly / 2 - 50, 96], name: `floor_south_robot_socket_${i + 1}` });
      addSnapConnector({ side: "north", type: "female", at: [lx * t, ly / 2 + 50, 96], name: `floor_north_robot_socket_${i + 1}` });
    });
    [-0.25, 0.25].forEach((t, i) => {
      addSnapConnector({ side: "west", type: "female", at: [-lx / 2 - 50, ly * t, 96], name: `floor_west_robot_socket_${i + 1}` });
      addSnapConnector({ side: "east", type: "female", at: [lx / 2 + 50, ly * t, 96], name: `floor_east_robot_socket_${i + 1}` });
    });
    addSnapConnector({ side: "south", type: "female", at: [-lx / 2, -ly / 2, 132], name: "floor_corner_socket_sw", size: connectorProfile.size * 0.78 });
    addSnapConnector({ side: "south", type: "female", at: [lx / 2, -ly / 2, 132], name: "floor_corner_socket_se", size: connectorProfile.size * 0.78 });
    addSnapConnector({ side: "north", type: "female", at: [-lx / 2, ly / 2, 132], name: "floor_corner_socket_nw", size: connectorProfile.size * 0.78 });
    addSnapConnector({ side: "north", type: "female", at: [lx / 2, ly / 2, 132], name: "floor_corner_socket_ne", size: connectorProfile.size * 0.78 });
    return group;
  }

  if (kind === "wall" || kind === "wall-half" || kind === "wall-low") {
    const h = kind === "wall-half" ? wallHeight * 0.52 : kind === "wall-low" ? wallHeight * 0.28 : wallHeight;
    add(wallLength, thickness, h, [0, 0, h / 2], wallColor, "wall_panel_light_plaster");
    addWallDetails(wallLength, h, kind);
    return group;
  }

  if (kind === "wall-window-wide") {
    add(wallLength * 1.1, thickness, wallHeight, [0, 0, wallHeight / 2], wallColor, "wall_panel_light_plaster");
    addWallDetails(wallLength * 1.1, wallHeight, "wall");
    const openingW = grid * 0.8;
    const openingH = wallHeight * 0.42;
    add(openingW, thickness + 18, openingH, [0, 0, wallHeight * 0.56], "#111827", "window_opening_cut", 0.02);
    addWindowDetails(0, wallHeight * 0.56, openingW, openingH, -6);
    add(140, thickness + 54, 150, [-wallLength * 0.55 + 110, 0, 210], connector, "left_connector_pocket");
    add(140, thickness + 54, 150, [wallLength * 0.55 - 110, 0, 210], connector, "right_connector_pocket");
    return group;
  }

  if (kind === "wall-double-window") {
    add(wallLength * 1.2, thickness, wallHeight, [0, 0, wallHeight / 2], wallColor, "wall_panel_light_plaster");
    addWallDetails(wallLength * 1.2, wallHeight, "wall");
    const openingW = grid * 0.48;
    const openingH = wallHeight * 0.38;
    add(openingW, thickness + 18, openingH, [-grid * 0.43, 0, wallHeight * 0.57], "#111827", "window_opening_left", 0.02);
    add(openingW, thickness + 18, openingH, [grid * 0.43, 0, wallHeight * 0.57], "#111827", "window_opening_right", 0.02);
    addWindowDetails(-grid * 0.43, wallHeight * 0.57, openingW, openingH, -6);
    addWindowDetails(grid * 0.43, wallHeight * 0.57, openingW, openingH, -6);
    add(120, thickness + 20, wallHeight * 0.62, [0, 0, wallHeight * 0.42], trim, "window_center_post");
    return group;
  }

  if (kind === "wall-shelf") {
    add(wallLength, thickness, wallHeight, [0, 0, wallHeight / 2], wallColor, "wall_panel_light_plaster");
    addWallDetails(wallLength, wallHeight, "wall");
    add(grid * 0.58, 160, 36, [0, -thickness / 2 - 85, wallHeight * 0.62], "#d4a574", "integrated_shelf");
    add(52, 108, 128, [-grid * 0.24, -thickness / 2 - 58, wallHeight * 0.56], "#8b7355", "shelf_bracket_left");
    add(52, 108, 128, [grid * 0.24, -thickness / 2 - 58, wallHeight * 0.56], "#8b7355", "shelf_bracket_right");
    return group;
  }

  if (kind === "pillar" || kind === "pillar-tall") {
    const h = kind === "pillar-tall" ? wallHeight : wallHeight * 0.58;
    add(180, 180, h, [0, 0, h / 2], trim, "pillar_body_printable");
    add(132, 132, 70, [0, 0, 35], "#d6b37a", "pillar_foot_plate");
    add(132, 132, 70, [0, 0, h - 35], "#f8eed8", "pillar_cap_plate");
    add(34, 34, h * 0.78, [-72, -72, h * 0.5], "#e9dcc6", "pillar_corner_bead_sw");
    add(34, 34, h * 0.78, [72, -72, h * 0.5], "#e9dcc6", "pillar_corner_bead_se");
    add(34, 34, h * 0.78, [-72, 72, h * 0.5], "#e9dcc6", "pillar_corner_bead_nw");
    add(34, 34, h * 0.78, [72, 72, h * 0.5], "#e9dcc6", "pillar_corner_bead_ne");
    addSnapConnector({ side: "south", type: "female", at: [0, -90, 120], name: "pillar_wall_socket_south" });
    addSnapConnector({ side: "north", type: "female", at: [0, 90, 120], name: "pillar_wall_socket_north" });
    addSnapConnector({ side: "west", type: "female", at: [-90, 0, 120], name: "pillar_wall_socket_west" });
    addSnapConnector({ side: "east", type: "female", at: [90, 0, 120], name: "pillar_wall_socket_east" });
    addSnapConnector({ side: "south", type: "male", at: [0, 0, 0], name: "pillar_floor_robot_snap", size: connectorProfile.size * 0.7 });
    add(120, 120, 70, [0, 0, h + 35], "#94a3b8", "robot_pick_tab_top");
    return group;
  }

  if (kind === "wall-corner") {
    add(grid, thickness, wallHeight, [grid / 2, 0, wallHeight / 2], wallColor, "corner_wall_east");
    add(thickness, grid, wallHeight, [0, grid / 2, wallHeight / 2], wallColor, "corner_wall_north");
    add(130, 130, wallHeight, [0, 0, wallHeight / 2], trim, "corner_connector_post");
    add(grid, 28, 64, [grid / 2, -thickness / 2 - 20, 94], trim, "corner_east_baseboard");
    add(28, grid, 64, [-thickness / 2 - 20, grid / 2, 94], trim, "corner_north_baseboard");
    add(grid, 24, 50, [grid / 2, -thickness / 2 - 18, wallHeight - 52], trim, "corner_east_crown_trim");
    add(24, grid, 50, [-thickness / 2 - 18, grid / 2, wallHeight - 52], trim, "corner_north_crown_trim");
    add(135, thickness + 48, 125, [grid - 95, 0, 185], connector, "corner_east_snap_socket");
    add(thickness + 48, 135, 125, [0, grid - 95, 185], connector, "corner_north_snap_socket");
    return group;
  }

  if (kind === "window-wall" || kind === "door-wall") {
    const side = (wallLength - grid * 0.62) / 2;
    add(side, thickness, wallHeight, [-wallLength / 2 + side / 2, 0, wallHeight / 2], wallColor, "wall_left_piece");
    add(side, thickness, wallHeight, [wallLength / 2 - side / 2, 0, wallHeight / 2], wallColor, "wall_right_piece");
    add(wallLength, 22, 54, [0, -thickness / 2 - 18, wallHeight - 52], trim, "continuous_top_crown_trim");
    add(120, thickness + 50, 130, [-wallLength / 2 + 95, 0, 185], connector, "left_connector_pocket");
    add(120, thickness + 50, 130, [wallLength / 2 - 95, 0, 185], connector, "right_connector_pocket");
    if (kind === "window-wall") {
      add(grid * 0.62, thickness, wallHeight * 0.28, [0, 0, wallHeight * 0.14], wallColor, "wall_under_window");
      add(grid * 0.62, thickness, wallHeight * 0.22, [0, 0, wallHeight * 0.89], wallColor, "wall_above_window");
      addWindowDetails();
      add(grid * 0.62, 30, 46, [0, -thickness / 2 - 20, wallHeight * 0.22], "#ddd6c5", "under_window_panel_seam");
    } else {
      add(grid * 0.62, thickness, wallHeight * 0.18, [0, 0, wallHeight * 0.91], wallColor, "wall_header_above_door");
      addDoorDetails(0, -thickness / 2 - 24, grid * 0.5, wallHeight * 0.78);
    }
    return group;
  }

  if (kind === "window") {
    addWindowDetails(0, wallHeight * 0.58, grid * 0.58, wallHeight * 0.36, -6);
    return group;
  }

  if (kind === "window-large") {
    addWindowDetails(0, wallHeight * 0.56, grid * 0.85, wallHeight * 0.44, -6);
    add(grid * 0.9, 22, 30, [0, 0, wallHeight * 0.8], "#f6e7cf", "window_top_trim_wide");
    add(grid * 0.9, 22, 30, [0, 0, wallHeight * 0.32], "#f6e7cf", "window_bottom_trim_wide");
    return group;
  }

  if (kind === "door") {
    addDoorDetails(0, -8, grid * 0.52, wallHeight * 0.72);
    return group;
  }

  if (kind === "roof" || kind === "roof-flat" || kind === "roof-gable" || kind === "roof-corner") {
    if (kind === "roof-gable") {
      add(wallLength + 180, grid * 0.78, 120, [0, -grid * 0.22, wallHeight + 160], roof, "gable_roof_left_panel");
      add(wallLength + 180, grid * 0.78, 120, [0, grid * 0.22, wallHeight + 160], roof, "gable_roof_right_panel");
      group.children[0].rotation.x = THREE.MathUtils.degToRad(-12);
      group.children[1].rotation.x = THREE.MathUtils.degToRad(12);
      add(wallLength + 220, 80, 90, [0, 0, wallHeight + 260], "#27272a", "roof_ridge_cap");
      add(wallLength + 260, 70, 70, [0, -grid * 0.68, wallHeight + 88], "#27272a", "gable_eave_trim_south");
      add(wallLength + 260, 70, 70, [0, grid * 0.68, wallHeight + 88], "#27272a", "gable_eave_trim_north");
      for (let i = -3; i <= 3; i += 1) {
        add(wallLength + 80, 18, 12, [0, (i * grid) / 7, wallHeight + 210], "#52525b", `gable_roof_shingle_line_${i + 4}`);
      }
      add(160, 120, 70, [-wallLength / 2, 0, wallHeight + 95], "#94a3b8", "gable_left_alignment_socket");
      add(160, 120, 70, [wallLength / 2, 0, wallHeight + 95], "#94a3b8", "gable_right_alignment_socket");
    } else {
      const lx = kind === "roof-corner" ? grid * 1.15 : wallLength + 180;
      const ly = kind === "roof-corner" ? grid * 1.15 : grid * 1.5 + 180;
      add(lx, ly, 120, [0, 0, wallHeight + 80], roof, "flat_roof_panel");
      add(lx + 80, 70, 80, [0, -ly / 2 - 25, wallHeight + 130], "#27272a", "roof_edge_trim_south");
      add(lx + 80, 70, 80, [0, ly / 2 + 25, wallHeight + 130], "#27272a", "roof_edge_trim_north");
      add(70, ly + 80, 80, [-lx / 2 - 25, 0, wallHeight + 130], "#27272a", "roof_edge_trim_west");
      add(70, ly + 80, 80, [lx / 2 + 25, 0, wallHeight + 130], "#27272a", "roof_edge_trim_east");
      for (let i = -3; i <= 3; i += 1) {
        add(lx - 180, 20, 12, [0, (i * ly) / 8, wallHeight + 146], "#52525b", `roof_panel_seam_${i + 4}`);
      }
      add(180, 180, 48, [-lx / 2 + 120, -ly / 2 + 120, wallHeight + 166], "#94a3b8", "roof_corner_socket_sw");
      add(180, 180, 48, [lx / 2 - 120, ly / 2 - 120, wallHeight + 166], "#94a3b8", "roof_corner_socket_ne");
    }
    return group;
  }

  if (kind === "service") {
    add(grid, thickness, wallHeight, [0, 0, wallHeight / 2], wallColor, "service_wall_panel");
    add(grid * 0.24, 40, wallHeight * 0.82, [0, -thickness / 2 - 26, wallHeight * 0.5], "#94a3b8", "removable_service_cover");
    add(80, 60, wallHeight * 0.7, [-grid * 0.28, -thickness / 2 - 30, wallHeight * 0.52], "#475569", "conduit_chase");
    add(46, 72, wallHeight * 0.62, [grid * 0.24, -thickness / 2 - 34, wallHeight * 0.48], "#64748b", "plumbing_chase_pipe");
    cyl(26, wallHeight * 0.58, [grid * 0.24, -thickness / 2 - 78, wallHeight * 0.5], "#78909c", "round_service_pipe", "z", 20);
    add(grid * 0.18, 54, 70, [0, -thickness / 2 - 56, wallHeight * 0.16], "#334155", "low_access_panel");
    add(grid * 0.18, 54, 70, [0, -thickness / 2 - 56, wallHeight * 0.82], "#334155", "upper_access_panel");
    addWallDetails(grid, wallHeight, "service");
    return group;
  }

  // Starter room kit.
  const room = createArchitectInstance("floor");
  const north = createArchitectInstance("wall");
  north.position.y = grid * architectInstanceScale() * 0.75;
  const west = createArchitectInstance("wall");
  west.rotation.z = Math.PI / 2;
  west.position.x = -wallLength * architectInstanceScale() / 2;
  const east = createArchitectInstance("wall");
  east.rotation.z = Math.PI / 2;
  east.position.x = wallLength * architectInstanceScale() / 2;
  const south = createArchitectInstance("wall-half");
  south.position.y = -grid * architectInstanceScale() * 0.75;
  const door = createArchitectInstance("door");
  door.position.set(wallLength * architectInstanceScale() * 0.24, grid * architectInstanceScale() * 0.75 + thickness * architectInstanceScale(), 0);
  const window = createArchitectInstance("window");
  window.position.set(-wallLength * architectInstanceScale() * 0.26, -grid * architectInstanceScale() * 0.75 - thickness * architectInstanceScale(), 0);
  const roofEdge = createArchitectInstance("roof-flat");
  roofEdge.position.z = wallHeight * architectInstanceScale() * 0.02;
  room.add(north, west, east, south, door, window, roofEdge);
  return room;
}

function nextArchitectInstancePosition() {
  const grid = architectGridModelUnits();
  const count = [...projectAssembly.list()].filter(([name]) => String(name).startsWith("__architect_")).length;
  return new THREE.Vector3((count % 6) * grid * 0.35, Math.floor(count / 6) * grid * 0.35, 0);
}

function architectSavedFilename(kind = "wall") {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const clean = String(kind || "module").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "module";
  return `architect_${clean}_${stamp}.glb`;
}

async function exportArchitectObjectToGlb(object) {
  const clone = object.clone(true);
  clone.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  return await new Promise((resolve, reject) => {
    exporter.parse(
      clone,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
          return;
        }
        try {
          const text = JSON.stringify(result);
          resolve(new TextEncoder().encode(text).buffer);
        } catch (err) {
          reject(err);
        }
      },
      (err) => reject(err),
      { binary: true, onlyVisible: true, trs: false },
    );
  });
}

async function persistArchitectModulePlacement(object, kind = "wall") {
  try {
    await ensureProject();
    if (!projectId || !object) return;
    const glbBuffer = await exportArchitectObjectToGlb(object);
    const filename = architectSavedFilename(kind);
    const blob = new Blob([glbBuffer], { type: "model/gltf-binary" });
    const form = new FormData();
    form.append("file", new File([blob], filename, { type: "model/gltf-binary" }), filename);
    const uploaded = await api(`/api/projects/${projectId}/upload`, {
      method: "POST",
      body: form,
    });
    object.userData.persistedFilename = uploaded?.name || filename;
    await refreshFiles();
    refreshArchitectBrowserEntries();
  } catch (err) {
    console.warn("Architect auto-save failed", err);
  }
}

function placeArchitectModuleInstant(kind = "wall") {
  const localKind = localArchitectKind(kind);
  if (!localKind) {
    openArchitectLibrary();
    return null;
  }
  const module = ARCHITECT_LOCAL_MODULES.find((item) => item.id === localKind);
  const label = module?.title || "Architect part";
  const object = createArchitectInstance(localKind);
  const catalogName = `__architect_${localKind}_${++architectInstanceSerial}.local`;
  markArchitectInstance(object, catalogName, localKind);
  object.position.copy(nextArchitectInstancePosition());
  projectAssembly.add(catalogName, object);
  currentMesh = projectAssembly.getRoot();
  selectedFile = catalogName;
  objectTools.selectObject?.({ mesh: object, root: object, bodyIndex: 0, catalogName, isRoot: true });
  showObjectGizmo(object, "translate", { switchTab: false });
  rebuildGrid();
  fitCameraToComponent(catalogName);
  refreshArchitectBrowserEntries();
  void persistArchitectModulePlacement(object, localKind);
  setEditStatus("ok", `Placed ${label} instantly. Drag it with the gizmo — modules snap together like LEGO when you release.`);
  return object;
}

function architectModuleProgram(kind = "wall") {
  const { grid, wallHeight, thickness, wallLength } = architectDimensions();
  const base = {
    name: `architect_${kind.replace(/[^a-z0-9]+/gi, "_")}`,
    description: `Local Architect module: ${kind}`,
    units: "mm",
    meta: { architect_module: kind, grid_mm: grid, wall_height_mm: wallHeight },
    parts: [{ id: "module", color: "#d8cab0", material: "architectural_model", features: [] }],
  };
  const f = base.parts[0].features;
  if (kind === "floor") {
    base.parts = [
      { id: "floor_slab_wood", color: "#c79552", material: "warm_wood_floor", features: [
        architectBoxFeature(wallLength, grid * 1.5, 90, [0, 0, 45], "new"),
      ] },
      { id: "floor_wall_snap_rails", color: "#d8b074", material: "wood_snap_rails", features: [
        architectBoxFeature(wallLength + 160, 60, 70, [0, -grid * 0.75 - 80, 125], "new"),
        architectBoxFeature(wallLength + 160, 60, 70, [0, grid * 0.75 + 80, 125], "add"),
        architectBoxFeature(60, grid * 1.5 + 160, 70, [-wallLength / 2 - 80, 0, 125], "add"),
        architectBoxFeature(60, grid * 1.5 + 160, 70, [wallLength / 2 + 80, 0, 125], "add"),
      ] },
      { id: "corner_post_sockets", color: "#5c6b73", material: "connector_socket", features: [
        architectBoxFeature(130, 130, 55, [-wallLength / 2, -grid * 0.75, 145], "new"),
        architectBoxFeature(130, 130, 55, [wallLength / 2, -grid * 0.75, 145], "add"),
        architectBoxFeature(130, 130, 55, [-wallLength / 2, grid * 0.75, 145], "add"),
        architectBoxFeature(130, 130, 55, [wallLength / 2, grid * 0.75, 145], "add"),
      ] },
    ];
    return base;
  }
  if (kind === "window") {
    const w = grid * 0.62;
    const h = wallHeight * 0.36;
    base.parts = [
      { id: "window_glass_blue", color: "#6fb6ff", material: "blue_glass", features: [
        architectBoxFeature(w, 24, h, [0, 0, wallHeight * 0.58], "new"),
      ] },
      { id: "window_frame_trim", color: "#f7f0de", material: "painted_window_trim", features: [
        architectBoxFeature(w + 120, 42, 60, [0, 0, wallHeight * 0.58 - h / 2 - 40], "new"),
        architectBoxFeature(w + 120, 42, 60, [0, 0, wallHeight * 0.58 + h / 2 + 40], "add"),
        architectBoxFeature(60, 42, h + 160, [-w / 2 - 60, 0, wallHeight * 0.58], "add"),
        architectBoxFeature(60, 42, h + 160, [w / 2 + 60, 0, wallHeight * 0.58], "add"),
      ] },
      { id: "window_snap_tabs", color: "#5c6b73", material: "connector_tabs", features: [
        architectBoxFeature(120, 70, 90, [-w / 2 - 110, 0, wallHeight * 0.58], "new"),
        architectBoxFeature(120, 70, 90, [w / 2 + 110, 0, wallHeight * 0.58], "add"),
      ] },
    ];
    return base;
  }
  if (kind === "door") {
    const w = grid * 0.58;
    const h = wallHeight * 0.78;
    base.parts = [
      { id: "door_panel_wood", color: "#7b5436", material: "wood_door", features: [
        architectBoxFeature(w, 38, h, [0, 0, h / 2], "new"),
        architectBoxFeature(70, 55, 70, [w * 0.28, -32, h * 0.55], "add"),
      ] },
      { id: "door_frame_trim", color: "#f7f0de", material: "painted_door_trim", features: [
        architectBoxFeature(w + 160, 58, 75, [0, 0, h + 38], "new"),
        architectBoxFeature(70, 58, h + 90, [-w / 2 - 70, 0, (h + 90) / 2], "add"),
        architectBoxFeature(70, 58, h + 90, [w / 2 + 70, 0, (h + 90) / 2], "add"),
        architectBoxFeature(w + 180, 70, 70, [0, 0, 35], "add"),
      ] },
      { id: "door_snap_pockets", color: "#5c6b73", material: "connector_pockets", features: [
        architectBoxFeature(90, 80, 100, [-w / 2 - 130, 0, h * 0.35], "new"),
        architectBoxFeature(90, 80, 100, [w / 2 + 130, 0, h * 0.35], "add"),
      ] },
    ];
    return base;
  }
  if (kind === "roof") {
    f.push(architectBoxFeature(wallLength + 180, grid + 180, 120, [0, 0, wallHeight + 80], "new"));
    f.push(architectBoxFeature(wallLength, grid, 50, [0, 0, wallHeight + 150], "cut"));
    return base;
  }
  if (kind === "service") {
    f.push(architectBoxFeature(grid, thickness, wallHeight, [0, 0, wallHeight / 2], "new"));
    f.push(architectBoxFeature(grid * 0.18, thickness + 20, wallHeight * 0.78, [0, 0, wallHeight * 0.52], "cut"));
    f.push(architectBoxFeature(grid * 0.26, 28, wallHeight * 0.8, [0, -thickness / 2 - 18, wallHeight * 0.52], "add"));
    return base;
  }
  if (kind === "room") {
    base.parts = [
      { id: "room_floor_wood", color: "#c79552", material: "warm_wood_floor", features: [
        architectBoxFeature(wallLength, grid * 1.5, 90, [0, 0, 45], "new"),
        architectBoxFeature(wallLength + 160, 60, 70, [0, -grid * 0.75 - 80, 125], "add"),
        architectBoxFeature(wallLength + 160, 60, 70, [0, grid * 0.75 + 80, 125], "add"),
        architectBoxFeature(60, grid * 1.5 + 160, 70, [-wallLength / 2 - 80, 0, 125], "add"),
        architectBoxFeature(60, grid * 1.5 + 160, 70, [wallLength / 2 + 80, 0, 125], "add"),
      ] },
      { id: "wall_north_light_plaster", color: "#e8e1d2", material: "light_plaster_wall", features: [
        architectBoxFeature(wallLength, thickness, wallHeight, [0, grid * 0.75, wallHeight / 2], "new"),
        architectBoxFeature(grid * 0.55, thickness + 40, wallHeight * 0.75, [grid * 0.35, grid * 0.75, wallHeight * 0.38], "cut"),
      ] },
      { id: "wall_south_open_cutaway", color: "#e8e1d2", material: "light_plaster_wall", features: [
        architectBoxFeature(wallLength * 0.42, thickness, wallHeight * 0.72, [-wallLength * 0.29, -grid * 0.75, wallHeight * 0.36], "new"),
        architectBoxFeature(wallLength * 0.24, thickness, wallHeight * 0.72, [wallLength * 0.38, -grid * 0.75, wallHeight * 0.36], "add"),
        architectBoxFeature(grid * 0.5, thickness + 40, wallHeight * 0.38, [-grid * 0.35, -grid * 0.75, wallHeight * 0.58], "cut"),
      ] },
      { id: "wall_west_light_plaster", color: "#e8e1d2", material: "light_plaster_wall", features: [
        architectBoxFeature(thickness, grid * 1.5, wallHeight, [-wallLength / 2, 0, wallHeight / 2], "new"),
      ] },
      { id: "wall_east_light_plaster", color: "#e8e1d2", material: "light_plaster_wall", features: [
        architectBoxFeature(thickness, grid * 1.5, wallHeight, [wallLength / 2, 0, wallHeight / 2], "new"),
      ] },
      { id: "window_blue_glass_insert", color: "#6fb6ff", material: "blue_glass", features: [
        architectBoxFeature(grid * 0.48, 22, wallHeight * 0.32, [-grid * 0.35, -grid * 0.75 - thickness / 2 - 18, wallHeight * 0.58], "new"),
      ] },
      { id: "door_dark_insert", color: "#6c4a2f", material: "wood_door", features: [
        architectBoxFeature(grid * 0.45, 36, wallHeight * 0.68, [grid * 0.35, grid * 0.75 + thickness / 2 + 18, wallHeight * 0.34], "new"),
      ] },
      { id: "trim_and_corner_connectors", color: "#f7f0de", material: "painted_trim_connectors", features: [
        architectBoxFeature(wallLength, 35, 60, [0, grid * 0.75 - thickness / 2 - 22, 130], "new"),
        architectBoxFeature(wallLength * 0.68, 35, 60, [-wallLength * 0.16, -grid * 0.75 + thickness / 2 + 22, 130], "add"),
        architectBoxFeature(90, 90, wallHeight, [-wallLength / 2, -grid * 0.75, wallHeight / 2], "add"),
        architectBoxFeature(90, 90, wallHeight, [wallLength / 2, -grid * 0.75, wallHeight / 2], "add"),
        architectBoxFeature(90, 90, wallHeight, [-wallLength / 2, grid * 0.75, wallHeight / 2], "add"),
        architectBoxFeature(90, 90, wallHeight, [wallLength / 2, grid * 0.75, wallHeight / 2], "add"),
      ] },
    ];
    return base;
  }
  f.push(architectBoxFeature(wallLength, thickness, wallHeight, [0, 0, wallHeight / 2], "new"));
  f.push(architectBoxFeature(wallLength, 36, 80, [0, -thickness / 2 - 20, 80], "add"));
  f.push(architectBoxFeature(120, thickness + 24, 120, [-wallLength / 2 + 80, 0, 160], "cut"));
  f.push(architectBoxFeature(120, thickness + 24, 120, [wallLength / 2 - 80, 0, 160], "cut"));
  if (kind === "window-wall") {
    f.push(architectBoxFeature(grid * 0.55, thickness + 40, wallHeight * 0.38, [0, 0, wallHeight * 0.58], "cut"));
    f.push(architectBoxFeature(grid * 0.68, 40, 70, [0, -thickness / 2 - 28, wallHeight * 0.38], "add"));
    f.push(architectBoxFeature(grid * 0.68, 40, 70, [0, -thickness / 2 - 28, wallHeight * 0.79], "add"));
  } else if (kind === "door-wall") {
    f.push(architectBoxFeature(grid * 0.55, thickness + 40, wallHeight * 0.78, [0, 0, wallHeight * 0.39], "cut"));
    f.push(architectBoxFeature(grid * 0.7, 52, 90, [0, -thickness / 2 - 32, 45], "add"));
  }
  return base;
}

async function buildArchitectModule(kind = "wall") {
  const placed = placeArchitectModuleInstant(kind);
  if (placed) return { status: "placed", local: true };
  await ensureProject();
  if (!projectId) throw new Error("Open or create a project first.");
  const module = ARCHITECT_LOCAL_MODULES.find((item) => item.id === kind);
  const label = module?.title || "Architect module";
  setEditStatus("loading", `Building ${label} locally...`);
  const data = await api(`/api/projects/${projectId}/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(architectModuleProgram(kind)),
  }, 120000);
  if (data.accepted || data.status === "running") {
    beginGenerationWatch(projectId, { kind: "build", mode: "architect", pendingStart: true });
    setEditStatus("ok", `${label} is building. Drag/scale it after it appears in the viewport.`);
    return data;
  }
  return data;
}

function localArchitectKind(kind = "wall") {
  const value = String(kind || "wall").toLowerCase();
  if (value === "pattern" || value === "robot") return "room";
  if (value === "image" || value === "blueprint") return "";
  if (ARCHITECT_LOCAL_MODULES.some((item) => item.id === value)) return value;
  return "wall";
}

function setArchitectPromptForNewModule(kind = "room") {
  const localKind = localArchitectKind(kind);
  if (!localKind) {
    openArchitectLibrary();
    return;
  }
  void buildArchitectModule(localKind).catch((err) => {
    setEditStatus("error", err.message || "Could not build Architect module.");
  });
}

function setArchitectPromptForSelectedEdit(kind = "customize") {
  if (kind === "window" || kind === "door") {
    void buildArchitectModule(kind).catch((err) => {
      setEditStatus("error", err.message || `Could not build Architect ${kind}.`);
    });
    return;
  }
  if (kind === "idea") {
    openArchitectLibrary();
    setEditStatus("ok", "Architect library opened. Pick a local module, then drag, scale, or snap it into the room.");
    return;
  }
  if (kind === "texture_ai") {
    applyPromptModeUI("architect");
    const input = document.getElementById("prompt-input");
    const prompt = architectTexturePatternPrompt();
    if (input) {
      input.value = prompt;
      input.focus();
      input.select();
    }
    showAiComposePanel?.();
    setRightTab("prompt");
    syncPromptTargetUI();
    setEditStatus(
      "ok",
      "AI texture prompt ready for the selected wall. Edit color/pattern wording if needed, then click Generate."
    );
    return;
  }
  const mesh = architectSelectedMesh();
  if (mesh) {
    showObjectGizmo(mesh);
    const action = kind === "materials"
      ? "use local house-colored pieces, or scale/snap this selected module"
      : "drag, scale, or stretch the selected wall/module";
    setEditStatus("ok", `Architect local edit: ${action}. No generative AI started.`);
    return;
  }
  openArchitectLibrary();
}

function architectSelectedMesh() {
  const selection = objectTools?.getSelection?.();
  if (selection?.mesh) return selection.mesh;
  const active = selectedFile && projectAssembly.has(selectedFile) ? projectAssembly.get(selectedFile) : null;
  if (active) return active;
  if (projectAssembly.count() === 1) return projectAssembly.list()[0]?.[1] || null;
  return null;
}

function isArchitectFloorObject(obj) {
  const kind = String(obj?.userData?.architectKind || "").toLowerCase();
  if (kind.startsWith("floor") || kind === "room") return true;
  let found = false;
  obj?.traverse?.((child) => {
    const name = String(child?.name || "").toLowerCase();
    if (name.includes("floor_slab") || name.includes("floor_snap_rail")) found = true;
  });
  return found;
}

function selectedArchitectKind(mesh) {
  let obj = mesh;
  while (obj) {
    if (obj.userData?.architectKind) return String(obj.userData.architectKind).toLowerCase();
    obj = obj.parent;
  }
  return "";
}

function architectWorldBox(obj) {
  obj?.updateMatrixWorld?.(true);
  const box = new THREE.Box3().setFromObject(obj);
  return box.isEmpty() ? null : box;
}

function architectSnapRole(kind = "") {
  if (kind.startsWith("floor") || kind === "room") return "floor";
  if (kind.includes("wall") || kind === "service" || kind === "window" || kind === "door") return "wall";
  if (kind.includes("pillar")) return "pillar";
  if (kind.includes("roof")) return "roof";
  return "module";
}

function architectFloorSnapAnchors(obj, box = architectWorldBox(obj)) {
  if (!box) return [];
  const floorBox = new THREE.Box3();
  let foundFloorGeometry = false;
  obj?.traverse?.((child) => {
    if (!child?.isMesh) return;
    const name = String(child.name || "").toLowerCase();
    if (!name.includes("floor_slab") && !name.includes("floor_snap_rail") && !name.includes("floor_corner_socket")) return;
    child.updateMatrixWorld?.(true);
    floorBox.union(new THREE.Box3().setFromObject(child));
    foundFloorGeometry = true;
  });
  if (foundFloorGeometry && !floorBox.isEmpty()) box = floorBox;
  const grid = architectGridModelUnits();
  const z = box.max.z;
  const xs = [];
  const ys = [];
  for (let x = box.min.x + grid / 2; x < box.max.x; x += grid) xs.push(x);
  for (let y = box.min.y + grid / 2; y < box.max.y; y += grid) ys.push(y);
  if (!xs.length) xs.push((box.min.x + box.max.x) / 2);
  if (!ys.length) ys.push((box.min.y + box.max.y) / 2);
  return [
    ...xs.map((x, i) => ({ role: "floor-edge", side: "south", rotation: 0, point: new THREE.Vector3(x, box.min.y, z), label: `south socket ${i + 1}` })),
    ...xs.map((x, i) => ({ role: "floor-edge", side: "north", rotation: 0, point: new THREE.Vector3(x, box.max.y, z), label: `north socket ${i + 1}` })),
    ...ys.map((y, i) => ({ role: "floor-edge", side: "west", rotation: Math.PI / 2, point: new THREE.Vector3(box.min.x, y, z), label: `west socket ${i + 1}` })),
    ...ys.map((y, i) => ({ role: "floor-edge", side: "east", rotation: Math.PI / 2, point: new THREE.Vector3(box.max.x, y, z), label: `east socket ${i + 1}` })),
    { role: "floor-corner", side: "south-west", rotation: 0, point: new THREE.Vector3(box.min.x, box.min.y, z), label: "south-west corner socket" },
    { role: "floor-corner", side: "south-east", rotation: 0, point: new THREE.Vector3(box.max.x, box.min.y, z), label: "south-east corner socket" },
    { role: "floor-corner", side: "north-west", rotation: Math.PI / 2, point: new THREE.Vector3(box.min.x, box.max.y, z), label: "north-west corner socket" },
    { role: "floor-corner", side: "north-east", rotation: Math.PI / 2, point: new THREE.Vector3(box.max.x, box.max.y, z), label: "north-east corner socket" },
  ];
}

function architectModuleSnapAnchors(obj, box = architectWorldBox(obj)) {
  if (!box) return [];
  const kind = selectedArchitectKind(obj);
  const role = architectSnapRole(kind);
  const center = box.getCenter(new THREE.Vector3());
  const bottom = box.min.z;
  const midZ = THREE.MathUtils.lerp(box.min.z, box.max.z, role === "pillar" ? 0.32 : 0.18);
  const anchors = [
    { role: "module-side", side: "west", point: new THREE.Vector3(box.min.x, center.y, midZ), label: "west connector" },
    { role: "module-side", side: "east", point: new THREE.Vector3(box.max.x, center.y, midZ), label: "east connector" },
    { role: "module-side", side: "south", point: new THREE.Vector3(center.x, box.min.y, midZ), label: "south connector" },
    { role: "module-side", side: "north", point: new THREE.Vector3(center.x, box.max.y, midZ), label: "north connector" },
  ];
  if (role !== "floor" && role !== "roof") {
    anchors.push({ role: "floor-foot", side: "bottom", point: new THREE.Vector3(center.x, center.y, bottom), label: "floor foot" });
  }
  if (role === "pillar") {
    anchors.push(
      { role: "pillar-socket", side: "west", point: new THREE.Vector3(box.min.x, center.y, midZ), label: "west pillar socket" },
      { role: "pillar-socket", side: "east", point: new THREE.Vector3(box.max.x, center.y, midZ), label: "east pillar socket" },
      { role: "pillar-socket", side: "south", point: new THREE.Vector3(center.x, box.min.y, midZ), label: "south pillar socket" },
      { role: "pillar-socket", side: "north", point: new THREE.Vector3(center.x, box.max.y, midZ), label: "north pillar socket" },
    );
  }
  return anchors;
}

function architectNamedConnectorAnchors(obj) {
  const anchors = [];
  obj?.updateMatrixWorld?.(true);
  obj?.traverse?.((child) => {
    if (!child?.isMesh) return;
    const name = String(child.name || "").toLowerCase();
    const isMale = name.includes("_male_tongue") || name.includes("male_tongue");
    const isFemale = name.includes("_female_outer_socket") || name.includes("female_outer_socket") || name.includes("visible_snap_cavity");
    if (!isMale && !isFemale) return;
    const box = new THREE.Box3().setFromObject(child);
    if (box.isEmpty()) return;
    const side =
      name.includes("west") || name.includes("_left_") ? "west" :
      name.includes("east") || name.includes("_right_") ? "east" :
      name.includes("south") ? "south" :
      name.includes("north") ? "north" :
      "connector";
    anchors.push({
      role: isMale ? "connector-male" : "connector-female",
      side,
      point: box.getCenter(new THREE.Vector3()),
      label: `${side} ${isMale ? "tongue" : "socket"}`,
    });
  });
  return anchors;
}

function architectAnchorsCompatible(a, b) {
  if (!a || !b) return false;
  if (a.role === "connector-male" && b.role === "connector-female") return true;
  if (a.role === "connector-female" && b.role === "connector-male") return true;
  if (a.role === "floor-foot" && (b.role === "floor-edge" || b.role === "floor-corner")) return true;
  if (b.role === "floor-foot" && (a.role === "floor-edge" || a.role === "floor-corner")) return true;
  if (a.role === "module-side" && (b.role === "module-side" || b.role === "pillar-socket")) return true;
  if (b.role === "module-side" && (a.role === "module-side" || a.role === "pillar-socket")) return true;
  return false;
}

function hideArchitectMergedConnectors(obj, side = "") {
  const sideToken = String(side || "").toLowerCase();
  const sideAliases = {
    west: ["west", "left"],
    east: ["east", "right"],
    south: ["south", "front"],
    north: ["north", "back"],
  };
  const aliases = sideAliases[sideToken] || [];
  obj?.traverse?.((child) => {
    if (!child?.isMesh) return;
    const name = String(child.name || "").toLowerCase();
    const isConnector = /(connector|snap|socket|tongue|cavity|lock_relief|lead_in|raised_center_key)/.test(name);
    if (!isConnector) return;
    if (aliases.length && !aliases.some((token) => name.includes(token))) return;
    child.visible = false;
  });
}

function architectSelectedSnapAnchors(mesh) {
  const named = architectNamedConnectorAnchors(mesh);
  return named.length ? named : architectModuleSnapAnchors(mesh);
}

function architectTargetSnapAnchors(obj) {
  const kind = selectedArchitectKind(obj);
  const named = architectNamedConnectorAnchors(obj);
  if (architectSnapRole(kind) === "floor") return [...named, ...architectFloorSnapAnchors(obj)];
  return named.length ? named : architectModuleSnapAnchors(obj);
}

function nearestArchitectConnectorSnap(mesh) {
  if (!mesh?.userData?.architectInstance) return null;
  const grid = architectGridModelUnits();
  const snapRadius = grid * 0.42;
  const selectedAnchors = architectSelectedSnapAnchors(mesh);
  let best = null;
  for (const [name, obj] of projectAssembly.list()) {
    if (obj === mesh || !obj?.userData?.architectInstance) continue;
    const targetAnchors = architectTargetSnapAnchors(obj);
    for (const selectedAnchor of selectedAnchors) {
      for (const targetAnchor of targetAnchors) {
        if (!architectAnchorsCompatible(selectedAnchor, targetAnchor)) continue;
        const dist = selectedAnchor.point.distanceTo(targetAnchor.point);
        if (dist > snapRadius) continue;
        const score = dist + (targetAnchor.role === "floor-edge" ? -grid * 0.08 : 0);
        if (!best || score < best.score) {
          best = {
            score,
            dist,
            mateName: name,
            selectedAnchor,
            targetAnchor,
            delta: targetAnchor.point.clone().sub(selectedAnchor.point),
            rotation: targetAnchor.rotation,
          };
        }
      }
    }
  }
  return best;
}

function nearestArchitectFloorSnap(mesh) {
  const kind = selectedArchitectKind(mesh);
  const snapsToFloor = kind.includes("wall") || kind.includes("pillar") || kind === "door" || kind === "window" || kind === "service";
  if (!snapsToFloor) return null;
  mesh.updateMatrixWorld(true);
  const selBox = new THREE.Box3().setFromObject(mesh);
  if (selBox.isEmpty()) return null;
  const center = selBox.getCenter(new THREE.Vector3());
  let best = null;
  for (const [name, obj] of projectAssembly.list()) {
    if (obj === mesh || !isArchitectFloorObject(obj)) continue;
    obj.updateMatrixWorld(true);
    const floorBox = new THREE.Box3().setFromObject(obj);
    if (floorBox.isEmpty()) continue;
    const candidates = [
      { side: "north", point: new THREE.Vector3(THREE.MathUtils.clamp(center.x, floorBox.min.x, floorBox.max.x), floorBox.max.y, center.z), rotation: 0 },
      { side: "south", point: new THREE.Vector3(THREE.MathUtils.clamp(center.x, floorBox.min.x, floorBox.max.x), floorBox.min.y, center.z), rotation: 0 },
      { side: "east", point: new THREE.Vector3(floorBox.max.x, THREE.MathUtils.clamp(center.y, floorBox.min.y, floorBox.max.y), center.z), rotation: Math.PI / 2 },
      { side: "west", point: new THREE.Vector3(floorBox.min.x, THREE.MathUtils.clamp(center.y, floorBox.min.y, floorBox.max.y), center.z), rotation: Math.PI / 2 },
    ];
    for (const candidate of candidates) {
      const dist = candidate.point.distanceTo(center);
      if (!best || dist < best.dist) {
        best = { ...candidate, dist, floorBox, floorName: name };
      }
    }
  }
  if (!best) return null;
  const targetCenter = best.point.clone();
  targetCenter.z = center.z + (best.floorBox.max.z - selBox.min.z);
  return { targetCenter, rotation: best.rotation, side: best.side, floorName: best.floorName };
}

function nearestArchitectModuleSnap(mesh) {
  if (!mesh?.userData?.architectInstance) return null;
  mesh.updateMatrixWorld(true);
  const selBox = new THREE.Box3().setFromObject(mesh);
  if (selBox.isEmpty()) return null;
  const center = selBox.getCenter(new THREE.Vector3());
  const grid = architectGridModelUnits();
  let best = null;
  for (const [name, obj] of projectAssembly.list()) {
    if (obj === mesh || !obj?.userData?.architectInstance) continue;
    obj.updateMatrixWorld(true);
    const otherBox = new THREE.Box3().setFromObject(obj);
    if (otherBox.isEmpty()) continue;
    const otherCenter = otherBox.getCenter(new THREE.Vector3());
    const dx = otherCenter.x - center.x;
    const dy = otherCenter.y - center.y;
    const axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    const sign = axis === "x" ? Math.sign(dx || 1) : Math.sign(dy || 1);
    const target = center.clone();
    if (axis === "x") {
      target.x = otherCenter.x + sign * grid;
      target.y = Math.round(center.y / grid) * grid;
    } else {
      target.y = otherCenter.y + sign * grid;
      target.x = Math.round(center.x / grid) * grid;
    }
    target.z = center.z;
    const dist = target.distanceTo(center);
    if (dist > grid * 1.35 || dist < grid * 0.25) continue;
    if (!best || dist < best.dist) best = { targetCenter: target, dist, mateName: name, axis };
  }
  return best;
}

function tryArchitectLegoSnap(mesh = architectSelectedMesh()) {
  if (!mesh?.userData?.architectInstance) return false;
  if (!document.body.classList.contains("architect-design-tab")) return false;
  let connectorSnap = nearestArchitectConnectorSnap(mesh);
  if (connectorSnap) {
    if (Number.isFinite(connectorSnap.rotation)) {
      mesh.rotation.z = connectorSnap.rotation;
      mesh.updateMatrixWorld(true);
      connectorSnap = nearestArchitectConnectorSnap(mesh) || connectorSnap;
    }
    const delta = worldDeltaToParentDelta(mesh, connectorSnap.delta);
    if (gizmoPanel.translateBy?.(delta, { autoApply: true })) {
      const mateObj = connectorSnap.mateName ? projectAssembly.get(connectorSnap.mateName) : null;
      hideArchitectMergedConnectors(mesh, connectorSnap.selectedAnchor?.side || "");
      hideArchitectMergedConnectors(mateObj, connectorSnap.targetAnchor?.side || "");
      const targetLabel = connectorSnap.targetAnchor?.label || "connector";
      setEditStatus("ok", `Snapped ${connectorSnap.selectedAnchor?.label || "module"} to ${connectorSnap.mateName} ${targetLabel}.`);
      return true;
    }
  }
  const moduleSnap = nearestArchitectModuleSnap(mesh);
  if (moduleSnap) {
    const center = objectWorldBoxCenter(mesh);
    const delta = worldDeltaToParentDelta(mesh, moduleSnap.targetCenter.clone().sub(center));
    if (gizmoPanel.translateBy?.(delta, { autoApply: true })) {
      setEditStatus("ok", `Snapped to ${moduleSnap.mateName} — LEGO-style connector aligned.`);
      return true;
    }
  }
  const floorSnap = nearestArchitectFloorSnap(mesh);
  if (floorSnap) {
    if (mesh.userData?.architectInstance) mesh.rotation.z = floorSnap.rotation;
    mesh.updateMatrixWorld(true);
    const center = objectWorldBoxCenter(mesh);
    const delta = worldDeltaToParentDelta(mesh, floorSnap.targetCenter.clone().sub(center));
    if (gizmoPanel.translateBy?.(delta, { autoApply: true })) {
      setEditStatus("ok", `Snapped to ${floorSnap.side} floor edge.`);
      return true;
    }
  }
  const grid = architectGridModelUnits();
  const center = objectWorldBoxCenter(mesh);
  const target = center.clone();
  target.x = Math.round(target.x / grid) * grid;
  target.y = Math.round(target.y / grid) * grid;
  const delta = worldDeltaToParentDelta(mesh, target.sub(center));
  if (!gizmoPanel.translateBy?.(delta, { autoApply: true })) return false;
  setEditStatus("ok", "Snapped module to Architect grid.");
  return true;
}

function refreshArchitectBrowserEntries() {
  const localComponents = projectAssembly
    .list()
    .filter(([name, obj]) => String(name).startsWith("__architect_") || obj?.userData?.architectInstance)
    .map(([name, obj]) => ({
      id: name,
      name,
      stem: name.replace(/^__architect_|\.local$/g, ""),
      format: "architect",
      viewer_filename: name,
      label: obj?.userData?.architectKind || name,
      localOnly: true,
    }));
  const persistedComponents = (lastProjectBrowser.components || [])
    .filter((c) => !String(c.name).startsWith("__architect_") && !String(c.name).endsWith(".local"));
  if (!localComponents.length && persistedComponents.length === (lastProjectBrowser.components || []).length) return;
  const merged = [
    ...localComponents,
    ...persistedComponents,
  ];
  renderProjectBrowser({ ...lastProjectBrowser, components: merged });
}

function snapArchitectSelectionToGrid() {
  const mesh = architectSelectedMesh();
  if (!mesh) {
    setEditStatus("error", "Select an architect module first.");
    return;
  }
  if (!tryArchitectLegoSnap(mesh)) {
    setEditStatus("error", "Could not snap module to grid or neighbor.");
  }
}

function nudgeArchitectSelection(dx = 0, dy = 0) {
  const mesh = architectSelectedMesh();
  if (!mesh) {
    setEditStatus("error", "Select an architect module first.");
    return;
  }
  const grid = architectGridModelUnits();
  const deltaWorld = new THREE.Vector3(dx * grid, dy * grid, 0);
  const delta = worldDeltaToParentDelta(mesh, deltaWorld);
  if (!gizmoPanel.translateBy?.(delta, { autoApply: true })) {
    setEditStatus("error", "Could not move module on grid.");
    return;
  }
  setEditStatus("ok", mesh.userData?.localOnly ? "Moved local Architect module one grid cell." : "Moved module one Architect grid cell.");
}

function handleArchitectRibbonAction(action, entry, data = {}) {
  if (action === "tool") {
    const tool = String(data.tool || entry?.architectTool || "wall").toLowerCase();
    if (tool === "wall" || tool === "window" || tool === "door") {
      applyArchitectBuildTile(tool);
      return;
    }
    const phase = ARCHITECT_RIBBON_TOOL_PHASE[tool] || "design";
    setArchitectPhase(phase);
    setEditStatus(
      "ok",
      ARCHITECT_PHASES[phase]?.ribbonHint
        || "That tool belongs to a later Architect phase (in development). Use Build for wall / door / window tiles.",
    );
    return;
  }
  if (action === "edit") {
    const edit = String(data.edit || entry?.architectEdit || "customize").toLowerCase();
    if (edit === "window" || edit === "door") {
      applyArchitectBuildTile(edit);
      return;
    }
    setArchitectPhase("design");
    setEditStatus("ok", ARCHITECT_PHASES.design.ribbonHint);
    return;
  }
  if (action === "snap_grid") {
    snapArchitectSelectionToGrid();
  }
}

function enterArchitectMode() {
  exitSketchMode();
  exitRiggingMode();
  exitCanvasTab();
  catalogPanel?.close?.();
  setRightTab("architect");
  setArchitectPhase("build");
  setSkillEnabled("cad", true);
  setSkillEnabled("architect", true);
  skillsPromptUI.render();
  skillsPromptUI.updatePlan?.();
  // Suspend Design pick/select so lattice clicks build walls instead of selecting CAD.
  try {
    objectTools.clearSelection?.();
  } catch (_) {}
  activatePickMode("off");
  // Bay lattice is the only grid that matters in Architect Build.
  setGridVisible(false);
  // Tuck Design CAD away so the plan lattice is the stage.
  const designRoot = projectAssembly?.getRoot?.() || currentMesh;
  if (designRoot && !Object.prototype.hasOwnProperty.call(designRoot.userData || {}, "_architectHidden")) {
    designRoot.userData._architectHidden = designRoot.visible;
    designRoot.visible = false;
  }
  void getArchitectSession().enter();
  architectControlsActive = true;
  applyLeftDragMouseButtons();
  controls.enabled = true;
}

function exitArchitectMode() {
  architectZOrbit = null;
  architectControlsActive = false;
  architectSession?.exit?.();
  architectBayGrid?.setActive(false);
  const designRoot = projectAssembly?.getRoot?.() || currentMesh;
  if (designRoot && Object.prototype.hasOwnProperty.call(designRoot.userData || {}, "_architectHidden")) {
    designRoot.visible = designRoot.userData._architectHidden !== false;
    delete designRoot.userData._architectHidden;
  }
  applyLeftDragMouseButtons();
}

function syncRiggingToolbelt() {
  const tool = riggingEditor.getTool();
  document.querySelectorAll("[data-rig-tool]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.rigTool === tool);
  });
}

function enterCanvasTab() {
  catalogPanel?.close?.();
  exitRiggingMode();
  document.getElementById("canvas-workspace")?.classList.remove("hidden");
  document.getElementById("app")?.classList.add("canvas-design-tab");
  document.body.classList.add("canvas-design-tab");
  canvasModeInstance?.show?.();
  showAiComposePanel();
  ribbon?.setDesignTab?.("CANVAS");
  syncCanvasGenerationUi();
  window.dispatchEvent(new Event("resize"));
}

function exitCanvasTab() {
  document.getElementById("canvas-workspace")?.classList.add("hidden");
  document.getElementById("app")?.classList.remove("canvas-design-tab");
  document.body.classList.remove("canvas-design-tab");
  canvasModeInstance?.hide?.();
  syncCanvasGenerationUi();
  refreshViewportAfterLayoutChange({ fit: !!currentMesh });
}

function handleDesignTabChange(tab) {
  const app = document.getElementById("app");
  if (tab !== "SKETCH" && sketchEditor.isActive()) {
    if (!finishActiveSketch()) sketchEditor.cancel();
  }
  if (tab === "RIGGING") {
    exitSketchMode();
    exitArchitectMode();
    enterRiggingMode();
  } else {
    exitRiggingMode();
  }
  if (tab === "ARCHITECT") {
    enterArchitectMode();
  } else {
    exitArchitectMode();
  }
  if (tab === "SKETCH") {
    setRightTab("sketch");
    focusViewportForShortcuts();
    setEditStatus("ok", "Sketch mode — click Create Sketch to enter locked 2D edit.");
  } else if (tab === "RIGGING") {
    focusViewportForShortcuts();
    setEditStatus("ok", "Rigging mode — Add Bone, Connect hierarchy, Save Rig.");
  } else if (tab === "ARCHITECT") {
    focusViewportForShortcuts();
    setEditStatus("ok", "Architect — drag walls, Shift+drag rooms, right-click delete. Middle pans; Shift+middle orbits.");
  } else if (tab === "CATALOG") {
    exitCanvasTab();
    exitSketchMode();
    catalogPanel?.open?.();
    setRightTab("prompt");
    setEditStatus("ok", "Catalog — search STEP models, compare supplier prices, and import parts.");
  } else if (tab === "CANVAS") {
    exitSketchMode();
    enterCanvasTab();
    setEditStatus("ok", "Canvas — sketch on the grid, describe it in the AI panel, then Generate.");
  } else {
    exitCanvasTab();
    exitSketchMode();
    setRightTab("prompt");
    promptHistory.setTab("compose");
    focusViewportForShortcuts();
  }
  if (tab !== "CANVAS") ribbon?.setDesignTab(tab);
  app?.classList.toggle("sketch-design-tab", tab === "SKETCH");
  app?.classList.toggle("rigging-design-tab", tab === "RIGGING");
  app?.classList.toggle("architect-design-tab", tab === "ARCHITECT");
  app?.classList.toggle("canvas-design-tab", tab === "CANVAS");
}

let sketchFacePickActive = false;

function pickFaceHit(event) {
  if (!currentMesh) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const hits = rc.intersectObject(currentMesh, true).filter((h) => h.object.isMesh && h.faceIndex != null);
  return hits[0] || null;
}

function beginSketchFacePick() {
  if (!currentMesh) {
    setEditStatus("error", "Load a model first, then pick a face for the sketch.");
    return false;
  }
  if (sketchEditor.isActive?.()) {
    setEditStatus("ok", "Already editing a sketch — use Finish Sketch or Cancel.");
    return false;
  }
  sketchFacePickActive = true;
  activatePickMode("off");
  transformControls.detach();
  gizmoPanel.hide();
  document.getElementById("btn-gizmo")?.classList.remove("active");
  setEditStatus("ok", "Click a face on the model to sketch on it. Esc to cancel.");
  return true;
}

function cancelSketchFacePick() {
  if (!sketchFacePickActive) return;
  sketchFacePickActive = false;
  clearHover();
  setEditStatus("", "");
}

function maybeStartSketch(data = {}) {
  const planeChoice = data?.plane || "XY";
  workspaceModes.setDesignTab("SKETCH");
  ribbon?.setDesignTab("SKETCH");
  applyWorkspaceMode("design");
  if (planeChoice === "Face") {
    beginSketchFacePick();
    return;
  }
  sketchEditor.start(planeChoice);
  enterSketchMode();
}

function handleSketchAction(action, entry, data = {}) {
  if (action === "start_tab") {
    if (sketchEditor.isActive()) {
      setEditStatus("ok", "Already editing a sketch — use Finish Sketch or Cancel.");
      return;
    }
    workspaceModes.setDesignTab("SKETCH");
    maybeStartSketch(data);
    return;
  }
  if (action === "start") {
    if (sketchEditor.isActive()) {
      setEditStatus("ok", "Already editing a sketch — use Finish Sketch or Cancel.");
      return;
    }
    if (workspaceModes.getDesignTab() !== "SKETCH") {
      workspaceModes.setDesignTab("SKETCH");
    }
    maybeStartSketch(data);
    return;
  }
  if (action === "tool") {
    if (!sketchEditor.isActive()) {
      workspaceModes.setDesignTab("SKETCH");
      sketchEditor.start("XY");
      enterSketchMode();
    }
    sketchEditor.setTool(data?.tool || entry?.sketchTool || "line");
    ribbon?.setActiveSketchTool?.(data?.tool || entry?.sketchTool || "line");
    return;
  }
  if (action === "finish") {
    finishActiveSketch();
    return;
  }
  if (action === "cancel") {
    sketchEditor.cancel();
    exitSketchMode();
    return;
  }
  if (action === "extrude") {
    if (sketchEditor.isActive()) {
      setEditStatus("error", "Finish the sketch first.");
      return;
    }
    const finished = sketchEditor.getFinishedSketch?.() || sketchEditor.getActiveViewportSketch?.();
    if (!startExtrudeFromSketchData(finished)) {
      setEditStatus("error", "Finish the sketch with a closed profile first, or click a sketch in the browser.");
    }
    return;
  }
}

function handleRiggingAction(action, entry, data = {}) {
  if (workspaceModes.getDesignTab() !== "RIGGING") {
    workspaceModes.setDesignTab("RIGGING");
  }
  if (action === "tool") {
    riggingEditor.setTool(data?.tool || entry?.rigTool || "select");
    syncRiggingToolbelt();
    return;
  }
  if (action === "add") {
    riggingEditor.setTool("add");
    syncRiggingToolbelt();
    setEditStatus("ok", "Click the model or grid to place a bone.");
    return;
  }
  if (action === "connect") {
    riggingEditor.setTool("connect");
    syncRiggingToolbelt();
    setEditStatus("ok", "Connect: click parent bone, then child bone.");
    return;
  }
  if (action === "delete") {
    riggingEditor.deleteSelected();
    return;
  }
  if (action === "clear") {
    if (window.confirm("Clear all bones from this rig?")) riggingEditor.clearRig();
    return;
  }
  if (action === "save") {
    riggingEditor.save().then(() => setEditStatus("ok", "Rig saved."));
    return;
  }
  if (action === "reload") {
    riggingEditor.load().then(() => setEditStatus("ok", "Rig reloaded."));
    return;
  }
  if (action === "auto") {
    riggingEditor.autoRigChain();
    return;
  }
  if (action === "simulate") {
    void simulateRiggingModel();
    return;
  }
  if (action === "keyframe") {
    riggingEditor.insertKeyframe();
    return;
  }
  if (action === "play") {
    toggleRiggingPlayback();
    return;
  }
  if (action === "stop") {
    stepModuleRuntime?.stop?.({ reset: true });
    planetaryGearRuntime?.stop?.({ reset: true });
    riggingEditor.setPlaying(false);
    syncRiggingViewportPlaybackUi();
    return;
  }
  if (action === "export_urdf") {
    riggingEditor.exportUrdf();
    return;
  }
}

function syncSketchVisibilityFromTree(browser) {
  for (const entry of browser?.sketches || []) {
    if (entry.format !== "sketch") continue;
    const key = entry.stem || entry.id;
    if (projectTree.isHidden?.(key)) {
      sketchEditor.setViewportSketchVisible?.(key, false);
    }
  }
}

const sketchEditor = createSketchEditor({
  scene,
  camera,
  renderer,
  controls,
  viewport,
  onStatus: setEditStatus,
  onOverlay: updateSketchChrome,
  onModeChange: (active, payload) => {
    controls.enabled = !active;
    document.getElementById("app")?.classList.toggle("sketch-editing", active);
    setSketchModelDim(active);
    if (active) {
      enterSketchVisualMode();
    } else if (payload?.profile?.length) {
      updateSketchChrome({ visible: false });
      scene.background.setHex(savedSceneBg ?? currentThemeSceneColors().canvas);
      savedSceneBg = null;
      if (gridHelper) gridHelper.visible = gridVisible;
      ribbon?.setSketchEditing?.(false);
      ribbon?.setActiveSketchTool?.(null);
      document.querySelector(".sketch-mode-tab")?.classList.remove("hidden");
      setRightTab("sketch");
    } else {
      updateSketchChrome({ visible: false });
      exitSketchVisualMode();
      showAiComposePanel();
    }
  },
  onFinished: async (payload) => {
    const { plane, plane_ref, profile, entities, constraints, id: viewportId } = payload;
    ribbon?.setSketchProfile(profile, plane);
    setSketchModelDim(false);
    document.getElementById("app")?.classList.remove("sketch-editing");
    controls.enabled = true;
    workspaceModes.setDesignTab("SKETCH");
    ribbon?.setDesignTab("SKETCH");

    if (projectId) {
      try {
        const name = `Sketch ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        const data = await api(`/api/projects/${projectId}/sketches`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, plane, plane_ref, profile, entities, constraints }),
        });
        if (data.sketch?.id && viewportId) {
          sketchEditor.updateViewportSketchId?.(viewportId, data.sketch.id);
          payload.id = data.sketch.id;
          ribbon?.setSketchProfile(data.sketch.profile || profile, data.sketch.plane || plane);
        }
        await refreshFiles();
        setEditStatus("ok", data.message || "Sketch saved — shown in viewport. Use Extrude when ready.");
      } catch (err) {
        setEditStatus("error", err.message || "Sketch save failed — profile still visible for extrude.");
      }
    } else {
      setEditStatus("ok", "Sketch finished — profile shown in viewport. Use Extrude when ready.");
    }
  },
});

function getRiggingPartRoot() {
  const catalogs = [];
  if (selectedFile && projectAssembly.has(selectedFile)) {
    catalogs.push(projectAssembly.get(selectedFile));
  }
  for (const [name, obj] of projectAssembly.list()) {
    if (name.endsWith(".glb") && !catalogs.includes(obj)) catalogs.push(obj);
  }
  if (!catalogs.length) {
    const root = projectAssembly.getRoot() || currentMesh;
    if (root) catalogs.push(root);
  }
  for (const obj of catalogs) {
    if (!obj) continue;
    let world = null;
    obj.traverse((o) => {
      if (o.name === "world") world = o;
    });
    const root = world || obj;
    if (detectPlanetaryGearAssembly(root)) return root;
    const hasGears =
      root.children?.some((c) => /gear_input|gear_1_link|gear_1/i.test(c.name || "")) &&
      root.children?.some((c) => /gear_output|gear_2_link|gear_2/i.test(c.name || ""));
    if (hasGears || (findGearMesh(root, "gear_input") && findGearMesh(root, "gear_output"))) {
      return root;
    }
  }
  return catalogs[0] || null;
}

function findGearMesh(root, partId) {
  const names =
    partId === "gear_input"
      ? ["gear_input", "gear_1_link", "gear_1"]
      : ["gear_output", "gear_2_link", "gear_2"];
  let found = null;
  root?.traverse((obj) => {
    if (found || !obj?.isMesh || obj.userData?.isSilhouette || obj.userData?.isEdge) return;
    if (names.includes(obj.name)) found = obj;
  });
  return found;
}

const riggingEditor = createRiggingEditor({
  scene,
  camera,
  renderer,
  controls,
  getMeshRoot: () => projectAssembly.getRoot() || currentMesh,
  getAssemblyRoot: () => projectAssembly.getRoot() || currentMesh,
  getPartRoot: getRiggingPartRoot,
  getSim: () => currentSim,
  api,
  getProjectId: () => projectId,
  onStatus: setEditStatus,
  onChange: () => refreshFiles(),
  timelineContainer: document.getElementById("rigging-anim-panel"),
});

const urdfRobotRuntime = createUrdfRobotRuntime({
  scene,
  authHeaders: () => authHeaders(),
});
const planetaryGearRuntime = createPlanetaryGearRuntime({
  getRoot: () => getRiggingPartRoot() || projectAssembly.getRoot() || currentMesh,
});
const stepModuleRuntime = createStepModuleRuntime({
  getRoot: () => getRiggingPartRoot() || projectAssembly.getRoot() || currentMesh,
  getProjectId: () => projectId,
  getFilename: () => selectedFile,
  authHeaders: () => authHeaders(),
  requestRender: () => {},
});
const moveIt2Client = createMoveIt2Client({
  url: (() => {
    try {
      return new URLSearchParams(window.location.search).get("moveit2Ws") || "ws://127.0.0.1:8765/ws";
    } catch {
      return "ws://127.0.0.1:8765/ws";
    }
  })(),
});
let urdfRobotBusy = false;

async function toggleRiggingPlayback() {
  const root = getRiggingPartRoot() || projectAssembly.getRoot() || currentMesh;
  // 1) Jake contract: .step.js module (works for gears, hinges, linkages, …)
  try {
    if (!stepModuleRuntime.hasModule()) await stepModuleRuntime.ensureLoaded();
    if (stepModuleRuntime.hasModule()) {
      if (!stepModuleRuntime.isBound()) await stepModuleRuntime.bind(root);
      if (planetaryGearRuntime.isPlaying()) planetaryGearRuntime.stop({ reset: false });
      riggingEditor?.setPlaying?.(false);
      const playing = stepModuleRuntime.togglePlay();
      setEditStatus(
        "ok",
        playing
          ? `Playing STEP module (${stepModuleRuntime.moduleName() || ".step.js"}).`
          : "STEP module paused."
      );
      syncRiggingViewportPlaybackUi();
      return;
    }
  } catch (err) {
    console.warn("STEP module playback failed", err);
  }
  // 2) Temporary planetary name heuristic only if no module exists
  if (detectPlanetaryGearAssembly(root)) {
    if (!planetaryGearRuntime.isBound()) planetaryGearRuntime.bind(root);
    const playing = planetaryGearRuntime.togglePlay();
    if (playing) {
      riggingEditor?.setPlaying?.(false);
      setEditStatus("ok", "Planetary fallback playing (no .step.js module found).");
    } else {
      setEditStatus("ok", "Planetary playback paused.");
    }
    syncRiggingViewportPlaybackUi();
    return;
  }
  if (planetaryGearRuntime.isPlaying()) planetaryGearRuntime.stop({ reset: false });
  if (stepModuleRuntime.isPlaying()) stepModuleRuntime.stop({ reset: false });
  riggingEditor?.togglePlay?.();
  syncRiggingViewportPlaybackUi();
}

document.getElementById("btn-sketch-finish")?.addEventListener("click", () => {
  finishActiveSketch();
});
document.getElementById("btn-sketch-cancel")?.addEventListener("click", () => {
  if (sketchEditor.isActive()) {
    sketchEditor.cancel();
    exitSketchMode();
  }
});
document.getElementById("btn-sketch-panel-finish")?.addEventListener("click", () => {
  finishActiveSketch();
});
document.getElementById("btn-sketch-panel-cancel")?.addEventListener("click", () => {
  if (sketchEditor.isActive()) {
    sketchEditor.cancel();
    exitSketchMode();
  }
});

async function runSketchPrompt() {
  if (!projectId) {
    setEditStatus("error", "Select a project in the sidebar first.");
    return;
  }
  const input = document.getElementById("sketch-prompt-input");
  const status = document.getElementById("sketch-prompt-status");
  const prompt = input?.value?.trim();
  if (!prompt) {
    if (status) {
      status.className = "status error";
      status.textContent = "Describe the 2D sketch you want.";
    }
    return;
  }
  if (status) {
    status.className = "status loading";
    status.textContent = "Generating sketch…";
  }
  try {
    const data = await api(`/api/projects/${projectId}/sketch/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        speed: document.getElementById("prompt-speed")?.value || "fast",
      }),
    });
    const sketch = data.sketch;
    if (sketchEditor.isActive()) {
      sketchEditor.applySketchData(sketch);
    } else {
      workspaceModes.setDesignTab("SKETCH");
      ribbon?.setDesignTab("SKETCH");
      sketchEditor.applySketchData(sketch);
      enterSketchMode();
    }
    if (status) {
      status.className = "status ok";
      status.textContent = data.message || "Sketch generated — edit or Finish Sketch.";
    }
    setEditStatus("ok", data.message || "Sketch generated.");
  } catch (err) {
    if (status) {
      status.className = "status error";
      status.textContent = err.message || "Sketch prompt failed.";
    }
    setEditStatus("error", err.message || "Sketch prompt failed.");
  }
}

document.getElementById("btn-sketch-prompt")?.addEventListener("click", () => {
  runSketchPrompt();
});

document.getElementById("btn-sketch-demo-plate")?.addEventListener("click", () => {
  const input = document.getElementById("sketch-prompt-input");
  if (input) {
    input.value =
      "40×30 mm rectangular mounting plate on XY with a 10 mm diameter hole centered. Add horizontal and vertical constraints and dimensions.";
  }
  runSketchPrompt();
});
document.querySelectorAll(".sketch-quick-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.sketchTool;
    if (!tool) return;
    handleSketchAction("tool", { sketchTool: tool }, { tool });
  });
});

const directModeling = createDirectModeling({
  scene,
  camera,
  renderer,
  controls,
  viewport,
  getMesh: () => projectAssembly.getRoot() || currentMesh,
  getMeshCenterOffset: () => meshCenterOffset,
  getMeshCenterOffsetForMesh: (mesh) => componentRootForMesh(mesh)?.userData?.meshCenterOffset || meshCenterOffset,
  getRootForMesh: (mesh) => componentRootForMesh(mesh) || projectAssembly.getRoot() || currentMesh,
  getFilenameForMesh: (mesh) => catalogNameForMesh(mesh) || selectedFile,
  getModelInfo: () => ({ projectId, filename: selectedFile }),
  api,
  onApplied: afterModelEdit,
  onStatus: setEditStatus,
  pickSketch: (event) => sketchEditor.pickViewportSketch?.(event, camera),
  getSketchExtrudeMeta: (data) => ({
    combine: "new",
    onApply: async (heightMm, combine) => {
      await ribbon?.appendFeatureAndBuild?.(
        {
          op: "extrude",
          combine,
          profile: data.profile,
          height: heightMm,
          plane: data.plane || "XY",
          plane_ref: data.plane_ref || null,
        },
        "Extrude"
      );
    },
  }),
  onToolChange: (tool) => {
    document.querySelectorAll("[data-dm-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.dmTool === tool);
    });
    if (tool) {
      activatePickMode("off");
      transformControls.detach();
      gizmoPanel.hide();
      document.getElementById("btn-gizmo")?.classList.remove("active");
      viewportHint?.classList.remove("hidden");
      if (pickHintTitle) {
        pickHintTitle.textContent =
          tool === "presspull" ? "Press-Pull" :
          tool === "hole" ? "Hole" :
          tool === "fillet" ? "Fillet" :
          tool === "chamfer" ? "Chamfer" :
          "Mirror";
      }
      if (pickHintText) {
        pickHintText.textContent =
          tool === "presspull"
            ? "Click a sketch profile or model face, drag/type a distance, or use To Face to pick the target face. Esc to exit."
            : tool === "hole"
            ? "Click a face point, drag the blue center handle to move it, set depth/through-all, then Apply. Orbit/zoom still work."
            : tool === "fillet" || tool === "chamfer"
            ? "Drag the viewport handle or type an exact value, choose edge scope, then Apply. Esc to exit."
            : "Pick a plane, drag it or type an offset. Esc to exit.";
      }
    } else {
      viewportHint?.classList.add("hidden");
    }
  },
});

function startExtrudeFromSketchData(sketchData) {
  const profile = sketchData?.profile;
  if (!profile?.length) return false;
  const plane = sketchData.plane || "XY";
  const plane_ref = sketchData.plane_ref || null;
  setRightTab("tools");
  activatePickMode("off");
  transformControls.detach();
  gizmoPanel.hide();
  document.getElementById("btn-gizmo")?.classList.remove("active");
  const ok = directModeling.startSketchExtrude?.({
    profile,
    plane,
    plane_ref,
    combine: "new",
    onApply: async (heightMm, combine) => {
      await ribbon?.appendFeatureAndBuild?.(
        { op: "extrude", combine, profile, height: heightMm, plane, plane_ref },
        "Extrude"
      );
    },
  });
  if (ok) {
    setEditStatus("ok", "Extrude: drag the arrow or type a height, then Apply.");
  }
  return !!ok;
}

function getSketchForExtrude() {
  return sketchEditor.getActiveViewportSketch?.() || sketchEditor.getFinishedSketch?.() || null;
}

const meshCleanup = createMeshCleanup({
  viewport,
  api,
  getModelInfo: () => ({ projectId, filename: selectedFile }),
  getReferences: () => composer.getReferences?.() || [],
  onApplied: afterModelEdit,
  onStatus: setEditStatus,
});

const objectTools = createObjectTools({
  scene,
  getMeshRoot: () => currentMesh,
  getModelInfo: () => {
    const selection = objectTools?.getSelection?.();
    return { projectId, filename: selection?.catalogName || selectedFile };
  },
  api,
  onApplied: afterModelEdit,
  onStatus: setEditStatus,
  transformControls,
});

function objectSelectionPresenceRefs({ moving = false } = {}) {
  const selection = objectTools?.getSelection?.();
  const items = selection?.selections?.length ? selection.selections : selection?.mesh ? [selection] : [];
  if (!currentMesh || !items.length) return [];
  return items
    .map((item, index) => {
      const target = item.root || item.mesh;
      if (!target) return null;
      target.updateMatrixWorld?.(true);
      currentMesh.updateMatrixWorld?.(true);
      const box = new THREE.Box3().setFromObject(target);
      if (box.isEmpty()) return null;
      const center = box.getCenter(new THREE.Vector3());
      const localCenter = currentMesh.worldToLocal(center.clone());
      const localMin = currentMesh.worldToLocal(box.min.clone());
      const localMax = currentMesh.worldToLocal(box.max.clone());
      return {
        id: `object-selection-${item.catalogName || item.mesh?.uuid || index}`,
        type: "object",
        label: item.label || selection.label || "object",
        catalog_name: item.catalogName || selection.catalogName || target.userData?.catalogFilename || null,
        mesh_uuid: item.mesh?.uuid || null,
        body_index: item.bodyIndex ?? selection.bodyIndex ?? null,
        local_point: [localCenter.x, localCenter.y, localCenter.z],
        local_box_min: [localMin.x, localMin.y, localMin.z],
        local_box_max: [localMax.x, localMax.y, localMax.z],
        transform_position: [target.position.x, target.position.y, target.position.z],
        transform_quaternion: [target.quaternion.x, target.quaternion.y, target.quaternion.z, target.quaternion.w],
        transform_scale: [target.scale.x, target.scale.y, target.scale.z],
        moving: !!moving,
        mode: transformControls.getMode?.() || "translate",
      };
    })
    .filter(Boolean);
}

function sendCollabPresence({ moving = transformGizmoDragging } = {}) {
  const promptRefs = composer?.getReferences?.() || [];
  const objectRefs = objectSelectionPresenceRefs({ moving });
  collab?.sendPicks([...promptRefs, ...objectRefs]);
}

window.addEventListener("render3d:object-selection-changed", () => {
  sendCollabPresence({ moving: false });
});

const editTools = createEditTools({
  api,
  getState: () => ({
    projectId,
    selectedFile,
    composer,
    transformControls,
    controls,
    getMesh: () => currentMesh,
    getSketchForExtrude,
    countVisibleSketches: () => sketchEditor.countVisibleSketches?.() ?? 0,
    startExtrudeFromSketch: startExtrudeFromSketchData,
  }),
  onStatus: setEditStatus,
  onApplied: afterModelEdit,
  gizmoPanel,
  directModeling,
  getMmPerModelUnit: currentMmPerModelUnit,
  onTransformActive: () => setLeftDragMode("rotate", { silent: true }),
});

document.getElementById("btn-gizmo-panel")?.addEventListener("click", () => {
  directModeling.reset();
  meshCleanup.hide();
  document.getElementById("btn-gizmo")?.click();
});

document.getElementById("btn-mesh-checkup")?.addEventListener("click", () => {
  directModeling.reset();
  gizmoPanel.hide();
  transformControls.detach();
  document.getElementById("btn-gizmo")?.classList.remove("active");
  setRightTab("tools");
  meshCleanup.show();
});

const colorToolPanel = document.getElementById("color-tool-panel");
const colorToolInput = document.getElementById("color-tool-input");

function activeColorValue() {
  return colorToolInput?.value || "#58a6ff";
}

function selectedColorFilename() {
  const selection = objectTools.getSelection?.();
  const fromSelection = selection?.catalogName || (selection?.mesh ? catalogNameForMesh(selection.mesh) : null);
  return fromSelection || selectedFile;
}

function showColorTool() {
  setRightTab("tools");
  directModeling.reset();
  meshCleanup.hide();
  gizmoPanel.hide();
  transformControls.detach();
  document.getElementById("btn-gizmo")?.classList.remove("active");
  colorToolPanel?.classList.remove("hidden");
  document.querySelectorAll("[data-dm-tool]").forEach((btn) => btn.classList.remove("active"));
  document.getElementById("btn-color-tool")?.classList.add("active");
  setEditStatus("ok", "Color tool: select an object, or pick faces, choose a color, then apply.");
}

async function paintCurrentModel(scope) {
  if (!projectId) {
    setEditStatus("error", "Select or create a project first.");
    return;
  }
  const filename = selectedColorFilename();
  if (!filename) {
    setEditStatus("error", scope === "faces" ? "Open a model and pick faces first." : "Select an object first (V).");
    return;
  }
  const refs = composer.getReferences?.() || [];
  const faceRefs = refs.filter((r) => r.type === "face" || r.face_index != null);
  if (scope === "faces" && !faceRefs.length) {
    activatePickMode("face");
    setEditStatus("error", "Pick one or more faces first, then click Color picked faces.");
    return;
  }
  try {
    const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/paint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        color: activeColorValue(),
        references: scope === "faces" ? faceRefs : [],
      }),
    });
    await afterModelEdit({ ...data, replaceCatalog: filename });
    setEditStatus("ok", scope === "faces" ? "Colored picked faces." : `Colored ${filename}.`);
    viewerOverlay.clearError();
  } catch (err) {
    const msg = err.message || "Could not apply color.";
    setEditStatus("error", msg);
    viewerOverlay.showError(msg);
  }
}

document.getElementById("btn-color-tool")?.addEventListener("click", showColorTool);
document.getElementById("btn-color-viewport")?.addEventListener("click", showColorTool);
document.getElementById("btn-color-object")?.addEventListener("click", () => {
  void paintCurrentModel("object");
});
document.getElementById("btn-color-faces")?.addEventListener("click", () => {
  void paintCurrentModel("faces");
});
document.getElementById("btn-color-pick-face")?.addEventListener("click", () => {
  showColorTool();
  activatePickMode("face");
  setEditStatus("ok", "Click faces in the viewport to collect them, then click Color picked faces.");
});
document.querySelectorAll(".color-swatch").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (colorToolInput) colorToolInput.value = btn.dataset.color || activeColorValue();
  });
});

document.getElementById("btn-split-bodies")?.addEventListener("click", () => {
  setRightTab("tools");
  objectTools.splitBodies();
});

document.getElementById("btn-delete-object")?.addEventListener("click", () => {
  void deleteActiveAssemblyObject();
});

function isDimensionQuestion(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value || value.length > 240) return false;
  const dimensionTerms = [
    "dimension",
    "dimensions",
    "how big",
    "what size",
    "size of",
    "measure",
    "measurements",
    "width",
    "height",
    "depth",
    "length",
    "bounding box",
    "bbox",
  ];
  const questionTerms = ["what", "how", "show", "tell", "give", "list", "?"];
  return dimensionTerms.some((term) => value.includes(term)) && questionTerms.some((term) => value.includes(term));
}

function formatDimensionsMessage(data) {
  const dims = data?.dimensions || {};
  const width = Number(dims.width_mm ?? data?.size_mm?.[0]);
  const depth = Number(dims.depth_mm ?? data?.size_mm?.[1]);
  const height = Number(dims.height_mm ?? data?.size_mm?.[2]);
  const file = data?.filename || selectedFile || "Current object";
  return `${file}: ${formatLength(width)} W x ${formatLength(depth)} D x ${formatLength(height)} H`;
}

let measureModalEl = null;
let measureModeActive = false;
let measurePickMode = "face";
const measureReferences = [];
const MEASURE_PICK_MODES = new Set(["face", "edge", "corner"]);

function ensureMeasureModal() {
  if (measureModalEl) return measureModalEl;
  measureModalEl = document.createElement("div");
  measureModalEl.className = "auth-modal hidden measure-modal";
  measureModalEl.setAttribute("role", "dialog");
  measureModalEl.setAttribute("aria-modal", "true");
  measureModalEl.innerHTML = `
    <div class="auth-backdrop" data-measure-close></div>
    <div class="auth-card app-dialog-card measure-card">
      <button type="button" class="auth-close" data-measure-close aria-label="Close">&times;</button>
      <div class="measure-header">
        <span class="measure-title-icon">📏</span>
        <h2 class="app-dialog-title measure-title">Measure</h2>
      </div>
      <div class="measure-pick-toolbar" role="toolbar" aria-label="Measure pick mode">
        <button type="button" class="measure-mode-btn" data-measure-pick="face" title="Pick a planar face">▣ Face</button>
        <button type="button" class="measure-mode-btn" data-measure-pick="edge" title="Pick an edge">━ Edge</button>
        <button type="button" class="measure-mode-btn" data-measure-pick="corner" title="Pick a vertex or corner">◆ Corner</button>
        <button type="button" class="measure-clear-btn" data-measure-clear title="Remove all picks">✕ Clear</button>
      </div>
      <p class="measure-hint-text">Click a mode above, then click geometry in the viewport. Lines appear between picks.</p>
      <div class="measure-content"></div>
    </div>`;
  document.body.appendChild(measureModalEl);
  measureModalEl.querySelectorAll("[data-measure-close]").forEach((el) => {
    el.addEventListener("click", () => {
      endMeasureMode();
      measureModalEl.classList.add("hidden");
    });
  });
  measureModalEl.querySelectorAll("[data-measure-pick]").forEach((el) => {
    el.addEventListener("click", () => beginMeasureMode(el.dataset.measurePick || "face"));
  });
  measureModalEl.querySelector("[data-measure-clear]")?.addEventListener("click", () => {
    clearMeasureReferences();
    void showMeasureAnalytics({ refs: measureReferences, promptMode: true });
  });
  return measureModalEl;
}

function syncMeasureButtons() {
  if (!measureModalEl) return;
  measureModalEl.querySelectorAll("[data-measure-pick]").forEach((el) => {
    const on = measureModeActive && el.dataset.measurePick === measurePickMode;
    el.classList.toggle("active", on);
    el.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const toolbar = measureModalEl.querySelector(".measure-pick-toolbar");
  if (toolbar) toolbar.classList.toggle("measure-active", measureModeActive);
}

function clearMeasureReferences() {
  for (const ref of measureReferences.splice(0)) {
    removeReferenceMarker(ref.id);
  }
  clearMeasureAnnotations();
  clearMeasureLivePreview();
  viewerOverlay.clearError();
}

function clearPickedFaceReferences() {
  let cleared = false;
  const transientTypes = new Set(["face", "path", "lasso"]);
  const promptRefs = composer.getReferences?.() || [];
  for (const ref of promptRefs) {
    if (transientTypes.has(ref.type)) {
      composer.removeReference(ref.id);
      cleared = true;
    }
  }
  for (let i = measureReferences.length - 1; i >= 0; i -= 1) {
    const ref = measureReferences[i];
    if (ref?.type === "face") {
      measureReferences.splice(i, 1);
      removeReferenceMarker(ref.id);
      cleared = true;
    }
  }
  for (const id of getMarkerRefIds()) {
    if (/^(path|lasso)-/.test(id)) {
      removeReferenceMarker(id);
      cleared = true;
    }
  }
  if (cleared && measureModeActive) {
    void showMeasureAnalytics({ refs: measureReferences, promptMode: true });
  }
  return cleared;
}

function handleReferenceRemove(event) {
  const removeRefId = pickReferenceRemove(event, { camera, domElement: renderer.domElement });
  if (!removeRefId) return false;
  if (measureModeActive && measureReferences.some((ref) => ref.id === removeRefId)) {
    const idx = measureReferences.findIndex((ref) => ref.id === removeRefId);
    if (idx >= 0) measureReferences.splice(idx, 1);
    removeReferenceMarker(removeRefId);
    void showMeasureAnalytics({ refs: measureReferences, promptMode: true });
  } else {
    composer.removeReference(removeRefId);
    editTools.updateExtrudeTarget?.();
  }
  viewerOverlay.clearError();
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

function beginMeasureMode(mode = measurePickMode) {
  if (!MEASURE_PICK_MODES.has(mode)) mode = "face";
  measureModeActive = true;
  measurePickMode = mode;
  ensureMeasureModal().classList.remove("hidden");
  activatePickMode(mode);
  syncMeasureButtons();
  void showMeasureAnalytics({ refs: measureReferences, promptMode: true });
  setEditStatus("ok", `Measure ${mode}: click ${mode}s in the viewport. Pick another mode in the Measure popup.`);
}

function endMeasureMode() {
  measureModeActive = false;
  syncMeasureButtons();
  clearMeasureLivePreview();
  if (MEASURE_PICK_MODES.has(getPickMode())) {
    activatePickMode("off");
  }
}

function escMeasure(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function selectedMeasureObject() {
  const selection = objectTools.getSelection?.();
  return selection?.mesh || (selectedFile ? projectAssembly.get(selectedFile) : null) || currentMesh;
}

function meshAnalytics(obj) {
  if (!obj) return null;
  obj.updateMatrixWorld?.(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const mmPer = currentMmPerModelUnit();
  let triangles = 0;
  let area = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  obj.traverse?.((child) => {
    if (!child.isMesh || !child.geometry || child.userData?.isEdge || child.userData?.isSilhouette) return;
    const geom = child.geometry;
    const pos = geom.attributes?.position;
    if (!pos) return;
    const index = geom.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    triangles += triCount;
    for (let i = 0; i < triCount; i += 1) {
      const ia = index ? index.getX(i * 3) : i * 3;
      const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(child.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(child.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(child.matrixWorld);
      area += b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
    }
  });
  return {
    sizeMm: [size.x * mmPer, size.y * mmPer, size.z * mmPer],
    diagonalMm: size.length() * mmPer,
    center,
    centerMm: [center.x * mmPer, center.y * mmPer, center.z * mmPer],
    triangles,
    areaMm2: area * mmPer * mmPer,
  };
}

function refPoint(ref) {
  if (!Array.isArray(ref?.position) || ref.position.length !== 3) return null;
  return new THREE.Vector3(Number(ref.position[0]), Number(ref.position[1]), Number(ref.position[2]));
}

function refsMeasureHtml(refs = []) {
  const measured = refs.filter((r) => ["corner", "edge", "face"].includes(r.type) && refPoint(r));
  if (!measured.length) {
    return `<p class="muted small measure-empty-hint">Click <strong>Face</strong>, <strong>Edge</strong>, or <strong>Corner</strong> above, then click geometry in the viewport to pick measurement points.</p>`;
  }
  const mmPer = currentMmPerModelUnit();

  const rows = measured.map((r, idx) => {
    const p = refPoint(r);
    const label = String(idx + 1);
    const typeIcon = r.type === "face" ? "▣" : r.type === "edge" ? "━" : "◆";
    const coords = `X ${formatLength(p.x * mmPer)} · Y ${formatLength(p.y * mmPer)} · Z ${formatLength(p.z * mmPer)}`;
    let extra = "";
    if (r.type === "face" && r.face_area != null) {
      const areaMm2 = r.face_area * mmPer * mmPer;
      extra = `<span class="measure-extra">Area: ${areaMm2 < 1 ? areaMm2.toFixed(4) : areaMm2.toFixed(2)} mm²</span>`;
    }
    if (r.type === "face" && Array.isArray(r.normal)) {
      const n = new THREE.Vector3(...r.normal);
      const dominantAxis = ["X", "Y", "Z"][n.toArray().map(Math.abs).indexOf(Math.max(...n.toArray().map(Math.abs)))];
      extra += `<span class="measure-extra">Normal: ${dominantAxis} axis</span>`;
    }
    return `<div class="measure-pick-row">
      <span class="measure-pick-num">${label}</span>
      <span class="measure-pick-type">${typeIcon} ${r.type}</span>
      <span class="measure-pick-coords">${coords}</span>
      ${extra}
    </div>`;
  });

  const distances = [];
  const angles = [];
  for (let i = 0; i < measured.length; i += 1) {
    for (let j = i + 1; j < measured.length; j += 1) {
      const a = refPoint(measured[i]);
      const b = refPoint(measured[j]);
      const dist = a.distanceTo(b) * mmPer;
      const dxyz = b.clone().sub(a).multiplyScalar(mmPer);
      distances.push(`<div class="measure-dist-row">
        <span class="measure-dist-label"><span class="measure-pick-num">${i+1}</span> → <span class="measure-pick-num">${j+1}</span></span>
        <strong class="measure-dist-value">${formatLength(dist)}</strong>
        <span class="measure-dist-delta">ΔX ${formatLength(Math.abs(dxyz.x))} · ΔY ${formatLength(Math.abs(dxyz.y))} · ΔZ ${formatLength(Math.abs(dxyz.z))}</span>
      </div>`);
      // Angle between faces
      if (measured[i].type === "face" && measured[j].type === "face" &&
          Array.isArray(measured[i].normal) && Array.isArray(measured[j].normal)) {
        const n1 = new THREE.Vector3(...measured[i].normal).normalize();
        const n2 = new THREE.Vector3(...measured[j].normal).normalize();
        const dot = Math.max(-1, Math.min(1, n1.dot(n2)));
        const angleDeg = (Math.acos(Math.abs(dot)) * 180 / Math.PI).toFixed(1);
        const supplementDeg = (180 - parseFloat(angleDeg)).toFixed(1);
        angles.push(`<div class="measure-dist-row">
          <span class="measure-dist-label"><span class="measure-pick-num">${i+1}</span> ∠ <span class="measure-pick-num">${j+1}</span></span>
          <strong class="measure-dist-value">${angleDeg}°</strong>
          <span class="measure-dist-delta">supplement: ${supplementDeg}°</span>
        </div>`);
      }
    }
  }

  return `
    <div class="measure-section">
      <div class="measure-section-title">Picked Points</div>
      ${rows.join("")}
    </div>
    ${distances.length ? `<div class="measure-section"><div class="measure-section-title">Distances</div>${distances.join("")}</div>` : ""}
    ${angles.length ? `<div class="measure-section"><div class="measure-section-title">Angles</div>${angles.join("")}</div>` : ""}`;
}

async function showMeasureAnalytics({ promptMode = false, refs = null } = {}) {
  const modal = ensureMeasureModal();
  const content = modal.querySelector(".measure-content");
  const selection = objectTools.getSelection?.();
  const catalogName = selection?.catalogName || (selection?.mesh ? catalogNameForMesh(selection.mesh) : null);
  const filename = catalogName || selectedFile;
  const analytics = meshAnalytics(selectedMeasureObject());
  const pickedRefs = refs || (measureReferences.length ? measureReferences : composer.getReferences?.() || []);

  const objectHtml = analytics
    ? `<div class="measure-section">
        <div class="measure-section-title">Selected Object</div>
        <div class="measure-summary">
          <div class="measure-stat"><span>Width</span><strong>${formatLength(analytics.sizeMm[0])}</strong></div>
          <div class="measure-stat"><span>Depth</span><strong>${formatLength(analytics.sizeMm[1])}</strong></div>
          <div class="measure-stat"><span>Height</span><strong>${formatLength(analytics.sizeMm[2])}</strong></div>
          <div class="measure-stat"><span>Diagonal</span><strong>${formatLength(analytics.diagonalMm)}</strong></div>
          <div class="measure-stat"><span>Surface area</span><strong>${analytics.areaMm2.toLocaleString(undefined, { maximumFractionDigits: 1 })} mm²</strong></div>
          <div class="measure-stat"><span>Triangles</span><strong>${Math.round(analytics.triangles).toLocaleString()}</strong></div>
        </div>
        <div class="measure-center-row"><span>Center</span><strong>${analytics.centerMm.map((v) => formatLength(v)).join(" · ")}</strong></div>
      </div>`
    : `<p class="muted small">No selected or visible object to measure.</p>`;

  content.innerHTML = `${objectHtml}${refsMeasureHtml(pickedRefs)}<p class="muted small measure-loading">Checking server dimensions…</p>`;
  modal.classList.remove("hidden");
  if (promptMode) {
    content.querySelector(".measure-loading")?.remove();
    return null;
  }

  if (projectId) {
    try {
      const query = filename ? `?filename=${encodeURIComponent(filename)}` : "";
      const data = await api(`/api/projects/${projectId}/dimensions${query}`);
      const server = formatDimensionsMessage(data);
      content.querySelector(".measure-loading")?.remove();
      content.insertAdjacentHTML("beforeend", `<h3>Server Measurement</h3><div class="measure-row"><span>${escMeasure(data.filename || filename || "Model")}</span><strong>${escMeasure(server)}</strong><small>from backend mesh bounds</small></div>`);
      setEditStatus("ok", server);
      return { ...data, message: server };
    } catch (err) {
      content.querySelector(".measure-loading")?.remove();
      content.insertAdjacentHTML("beforeend", `<p class="status error">${escMeasure(err.message || "Could not measure dimensions.")}</p>`);
    }
  }
  return null;
}

async function showDimensions({ promptMode = false } = {}) {
  return showMeasureAnalytics({ promptMode });
  /*
  if (!projectId) {
    setEditStatus("error", "Select or create a project first.");
    return null;
  }
  const selection = objectTools.getSelection?.();
  const catalogName = selection?.catalogName || (selection?.mesh ? catalogNameForMesh(selection.mesh) : null);
  const filename = catalogName || selectedFile;
  try {
    const query = filename ? `?filename=${encodeURIComponent(filename)}` : "";
    const data = await api(`/api/projects/${projectId}/dimensions${query}`);
    const message = formatDimensionsMessage(data);
    setEditStatus("ok", message);
    viewerOverlay.clearError();
    if (!promptMode) {
      window.alert(`Dimensions\n\n${message}`);
    }
    return { ...data, message };
  } catch (err) {
    const msg = err.message || "Could not measure dimensions.";
    setEditStatus("error", msg);
    viewerOverlay.showError(msg);
    return null;
  }
  */
}

document.getElementById("btn-show-dimensions")?.addEventListener("click", () => {
  beginMeasureMode("face");
});
document.getElementById("btn-measure-viewport")?.addEventListener("click", () => {
  beginMeasureMode("face");
});

async function answerDimensionPrompt(prompt) {
  await ensureProject();
  const status = document.getElementById("prompt-status");
  const reply = document.getElementById("prompt-reply");
  if (status) {
    status.className = "status loading";
    status.textContent = "Measuring model dimensions...";
  }
  if (reply) reply.textContent = "";
  const body = {
    prompt,
    base_filename: selectedFile,
    references: composer.getReferences(),
    images: [],
    skills: [],
    ...getPromptAiKeyBodyFields(),
  };
  const data = await api(`/api/projects/${projectId}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const measurement = data.dimensions || data;
  const message = data.message || formatDimensionsMessage(measurement);
  if (status) {
    status.className = "status ok";
    status.textContent = data.prompt_id
      ? `Answered dimensions · ${formatPromptRef({
          promptId: data.prompt_id,
          projectId,
          filename: data.filename,
          traceId: data.trace_id,
          promptMode: data.prompt_mode || promptModeForRef(),
          model: data.model || getSelectedPromptModelInfo().model,
          provider: data.provider || getSelectedPromptModelInfo().provider,
        })}`
      : "Answered dimensions.";
  }
  if (reply) {
    const dims = measurement?.dimensions || {};
    reply.textContent = [
      message,
      `Width: ${formatLength(Number(dims.width_mm ?? measurement?.size_mm?.[0]))}`,
      `Depth: ${formatLength(Number(dims.depth_mm ?? measurement?.size_mm?.[1]))}`,
      `Height: ${formatLength(Number(dims.height_mm ?? measurement?.size_mm?.[2]))}`,
    ].join("\n");
  }
  setEditStatus("ok", message);
  await refreshPromptHistory();
  showAiComposePanel();
  void refreshWorkspaceAiUsage();
  return data;
}

async function reloadViewportFromProject({ fitView = false, latestFile = null, placedFiles = [], loadAll = false } = {}) {
  if (!projectId) return;
  const data = await api(`/api/projects/${projectId}`);
  const modelLatestFile = isDxfDrawingFilename(latestFile) ? null : latestFile;
  const serverLatestFile = isDxfDrawingFilename(data.latest_file) ? null : data.latest_file;
  timelineData = data.timeline;
  const cur = timelineData?.current_index ?? -1;
  const max = Math.max(0, (timelineData?.entries?.length || 1) - 1);
  timeline.setTimeline(timelineData, {
    scroll: true,
    scrollAlign: cur >= max ? "end" : "auto",
  });
  renderFileList(data.files || []);
  const browser = normalizeBrowser(data);
  renderProjectBrowser(browser);
  await sketchEditor.loadProjectSketches?.(projectId, api, browser.sketches);
  syncSketchVisibilityFromTree(browser);
  let comps = browser.components || [];
  const projectFiles = data.files || [];
  const ensureLoadFile = (filename, { primary = false } = {}) => {
    if (!filename) return;
    const file = projectFiles.find((f) => f.name === filename);
    if (!file) return;
    const existing = comps.find((c) => c.name === filename || c.viewer_filename === filename);
    const patch = {
      auto_load: true,
      baked_placement: true,
      primary: primary || existing?.primary === true,
      viewer_filename: filename,
    };
    if (existing) {
      Object.assign(existing, patch);
      return;
    }
    comps = [
      {
        id: fileStem(filename),
        name: filename,
        stem: fileStem(filename),
        format: filename.slice(filename.lastIndexOf(".") + 1).toLowerCase(),
        size: file.size,
        ...patch,
      },
      ...comps,
    ];
  };
  ensureLoadFile(modelLatestFile, { primary: true });
  for (const filename of placedFiles || []) ensureLoadFile(filename);
  if (
    modelLatestFile &&
    !comps.some((c) => c.name === modelLatestFile || c.viewer_filename === modelLatestFile) &&
    projectFiles.some((f) => f.name === modelLatestFile)
  ) {
    comps = [
      {
        id: fileStem(modelLatestFile),
        name: modelLatestFile,
        stem: fileStem(modelLatestFile),
        format: modelLatestFile.slice(modelLatestFile.lastIndexOf(".") + 1).toLowerCase(),
        viewer_filename: modelLatestFile,
        size: projectFiles.find((f) => f.name === modelLatestFile)?.size,
        primary: true,
        auto_load: true,
        baked_placement: true,
      },
      ...comps,
    ];
  }
  prepareViewportForModels();
  if (comps.length) {
    await loadProjectComponents(comps, {
      projectId,
      latestFile: modelLatestFile || serverLatestFile,
      fitView,
      loadAll,
    });
  } else {
    selectedFile = null;
    clearModel();
    showEmptyProjectViewport();
  }
  await refreshObjectHistory();
}

async function syncAfterObjectDelete(result) {
  const deletedFile = result?.deletedFile;
  const deletedFiles = Array.isArray(result?.deleted_files) ? result.deleted_files : [];
  const deletedStem = deletedFile ? fileStem(deletedFile) : null;
  const deletedStems = new Set(deletedFiles.map((name) => fileStem(name)).filter(Boolean));
  if (deletedStem) deletedStems.add(deletedStem);

  // Remove deleted entries from the assembly first (keeps others visible during reload).
  if (deletedStems.size) {
    for (const [name] of [...projectAssembly.list()]) {
      if (deletedStems.has(fileStem(name))) {
        projectAssembly.remove(name);
      }
    }
  } else if (deletedFile) {
    projectAssembly.remove(deletedFile);
  }

  objectTools.clearSelection();
  transformControls.detach();
  gizmoPanel.hide();
  document.getElementById("btn-gizmo")?.classList.remove("active");

  await refreshFiles();

  const data = await api(`/api/projects/${projectId}`);
  const comps = normalizeBrowser(data).components || [];

  if (comps.length) {
    selectedFile = data.latest_file || comps[comps.length - 1]?.name;
    // Only wipe any remaining stale objects (the deleted ones are already gone).
    // Do NOT call clearModelContents() here — that would briefly blank all other components.
    const remaining = new Set(comps.map((c) => c.name));
    for (const [name] of [...projectAssembly.list()]) {
      if (!remaining.has(name)) projectAssembly.remove(name);
    }
    currentMesh = projectAssembly.getRoot();
    await loadProjectComponents(comps, {
      projectId,
      latestFile: selectedFile,
      fitView: false,
    });
  } else {
    selectedFile = null;
    showEmptyProjectViewport({ keepBrowser: true });
  }

  if (result?.timeline) {
    timelineData = result.timeline;
    timeline.setTimeline(result.timeline);
  } else {
    await refreshTimeline();
  }
  await refreshObjectHistory();
}

function isLocalAssemblyObject(name, obj = null) {
  const value = String(name || obj?.userData?.catalogFilename || "");
  if (value.endsWith(".local") || value.startsWith("__architect_")) return true;
  let local = Boolean(obj?.userData?.localOnly);
  obj?.traverse?.((child) => {
    if (child?.userData?.localOnly) local = true;
  });
  return local;
}

function localSelectionCatalogNames(selection = objectTools.getSelection?.()) {
  const names = new Set();
  const selections = selection?.selections?.length ? selection.selections : selection ? [selection] : [];
  for (const item of selections) {
    const catalogName = item.catalogName || catalogNameForMesh(item.mesh) || item.root?.userData?.catalogFilename;
    const obj = catalogName ? projectAssembly.get(catalogName) : item.root;
    if (!catalogName || !isLocalAssemblyObject(catalogName, obj)) continue;
    names.add(catalogName);
  }
  if (!names.size && selectedFile && projectAssembly.has(selectedFile)) {
    const obj = projectAssembly.get(selectedFile);
    if (isLocalAssemblyObject(selectedFile, obj)) names.add(selectedFile);
  }
  return [...names];
}

function deleteLocalAssemblyObjects(names = []) {
  const targets = [...new Set(names)].filter((name) => projectAssembly.has(name));
  if (!targets.length) return false;
  for (const name of targets) projectAssembly.remove(name);
  objectTools.clearSelection();
  transformControls.detach();
  gizmoPanel.hide();
  document.getElementById("btn-gizmo")?.classList.remove("active");
  currentMesh = projectAssembly.count() ? projectAssembly.getRoot() : null;
  selectedFile = projectAssembly.list()[0]?.[0] || null;
  if (selectedFile) {
    projectTree.setSelected?.(selectedFile);
    featureEditor.setModel(projectId, selectedFile);
  }
  refreshArchitectBrowserEntries();
  rebuildGrid();
  setEditStatus("ok", `Deleted ${targets.length} local module${targets.length === 1 ? "" : "s"}.`);
  return true;
}

async function deleteActiveAssemblyObject() {
  if (objectTools.getSelection?.()) {
    await deleteSelectedObject();
    return true;
  }
  const catalogName = selectedFile && projectAssembly.has(selectedFile) ? selectedFile : null;
  if (!catalogName) return false;
  const obj = projectAssembly.get(catalogName);
  if (isLocalAssemblyObject(catalogName, obj)) {
    deleteLocalAssemblyObjects([catalogName]);
    return true;
  }
  if (!projectId) {
    setEditStatus("error", "Select an object first (V).");
    return true;
  }
  setEditStatus("loading", `Deleting ${catalogName.replace(/\.[^.]+$/, "")}...`);
  try {
    const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(catalogName)}`, { method: "DELETE" });
    await syncAfterObjectDelete({ deletedFile: catalogName, deleted_files: [catalogName], ...data });
    setEditStatus("ok", `Deleted ${catalogName}.`);
  } catch (err) {
    setEditStatus("error", err.message || "Delete failed.");
  }
  return true;
}

async function deleteSelectedObject() {
  const sel = objectTools.getSelection();
  const localTargets = localSelectionCatalogNames(sel);
  if (localTargets.length) {
    deleteLocalAssemblyObjects(localTargets);
    return;
  }

  if (!sel?.mesh || !projectId) {
    setEditStatus("error", "Select an object first (V).");
    return;
  }

  const catalogName = sel.catalogName || catalogNameForMesh(sel.mesh) || selectedFile;
  if (catalogName && catalogName !== selectedFile) {
    selectedFile = catalogName;
    featureEditor.setModel(projectId, catalogName);
  }

  const result = await objectTools.deleteSelected();
  if (!result) return;

  if (result.deletedFile) {
    await syncAfterObjectDelete(result);
    setEditStatus("ok", `Deleted ${result.deletedFile}.`);
    return;
  }
  // Multi-body remove — onApplied handled reload via afterModelEdit.
}

document.querySelectorAll("[data-dm-tool]").forEach((btn) => {
  btn.addEventListener("click", () => directModeling.setTool(btn.dataset.dmTool));
});

function setRightTab(tab) {
  document.querySelectorAll("[data-right-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.rightTab === tab);
  });
  document.querySelectorAll("[data-right-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.rightPanel === tab);
  });
  document.getElementById("project-cost-thumb")?.classList.toggle("hidden", tab !== "prompt");
  if (tab === "rigging") refreshRobotArtifacts({ quiet: true });
}

async function refreshRobotArtifacts({ quiet = false } = {}) {
  if (!projectId) return null;
  try {
    robotArtifactData = await api(`/api/projects/${projectId}/rigging/artifacts`);
    renderRobotArtifacts();
    await refreshMoveIt2ProjectContext({ quiet: true });
    await ensureUrdfRobotScene({ quiet });
    return robotArtifactData;
  } catch (err) {
    if (!quiet) setEditStatus("error", err?.message || "Could not load robot artifacts.");
    return null;
  }
}

function pickPreferredRobotFiles(data = {}) {
  const artifacts = data.artifacts || [];
  const urdfFile = artifacts.find((name) => /\.urdf$/i.test(name)) || null;
  const stem = urdfFile ? String(urdfFile).replace(/\.urdf$/i, "") : "";
  const srdfFile =
    (stem && artifacts.find((name) => name.toLowerCase() === `${stem.toLowerCase()}.srdf`))
    || artifacts.find((name) => /\.srdf$/i.test(name))
    || null;
  return { urdfFile, srdfFile };
}

async function ensureUrdfRobotScene({ quiet = false, force = false } = {}) {
  if (!projectId || urdfRobotBusy) return null;
  const { urdfFile, srdfFile } = pickPreferredRobotFiles(robotArtifactData || {});
  if (!urdfFile) {
    urdfRobotRuntime.clear();
    setCadAssemblyHiddenForUrdf(false);
    updateMoveIt2StatusUi({ connected: false, detail: "No URDF loaded" });
    return null;
  }
  const current = urdfRobotRuntime.getState();
  if (!force && current.urdfFile === urdfFile && current.srdfFile === (srdfFile || null) && current.loaded) {
    return current;
  }
  urdfRobotBusy = true;
  try {
    const state = await urdfRobotRuntime.loadFromProject(projectId, { urdfFile, srdfFile });
    setCadAssemblyHiddenForUrdf(true);
    const box = urdfRobotRuntime.fitBox();
    if (box && !box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      controls.target.copy(center);
      const radius = Math.max(size.x, size.y, size.z, 0.2);
      camera.position.set(center.x + radius * 1.6, center.y + radius * 1.1, center.z + radius * 1.6);
      camera.near = Math.max(0.001, radius / 200);
      camera.far = Math.max(1000, radius * 40);
      camera.updateProjectionMatrix();
      controls.update();
    }
    if (!quiet) setEditStatus("ok", `Loaded robot scene from ${urdfFile}${srdfFile ? ` + ${srdfFile}` : ""}.`);
    syncUrdfSlidersFromRuntime();
    fillMoveIt2Selectors(robotArtifactData || {});
    void refreshMoveIt2Connection({ quiet: true });
    return state;
  } catch (err) {
    if (!quiet) setEditStatus("error", err?.message || "Could not load URDF robot scene.");
    return null;
  } finally {
    urdfRobotBusy = false;
  }
}

function setCadAssemblyHiddenForUrdf(hidden) {
  const root = projectAssembly?.getRoot?.() || currentMesh;
  if (root) root.visible = !hidden;
}

function syncUrdfSlidersFromRuntime() {
  const values = urdfRobotRuntime.getState()?.jointValuesRad || {};
  (robotArtifactData?.joints || []).forEach((joint) => {
    if (String(joint.type || "").toLowerCase() === "fixed") return;
    const rad = Number(values[joint.name] || 0);
    const display = isAngularRobotJoint(joint) ? rad * 180 / Math.PI : rad;
    document.querySelectorAll(`[data-robot-urdf-joint="${CSS.escape(joint.name)}"], [data-robot-urdf-joint-number="${CSS.escape(joint.name)}"]`).forEach((el) => {
      el.value = String(Number(display.toFixed(isAngularRobotJoint(joint) ? 1 : 4)));
    });
  });
}

function jointValuesForMoveIt2Display() {
  const values = urdfRobotRuntime.getState()?.jointValuesRad || {};
  const out = {};
  (robotArtifactData?.joints || []).forEach((joint) => {
    if (String(joint.type || "").toLowerCase() === "fixed") return;
    const rad = Number(values[joint.name] || 0);
    out[joint.name] = isAngularRobotJoint(joint) ? rad * 180 / Math.PI : rad;
  });
  return out;
}

let moveIt2Context = null;

async function refreshMoveIt2ProjectContext({ quiet = false } = {}) {
  if (!projectId) {
    moveIt2Context = null;
    return null;
  }
  try {
    moveIt2Context = await api(`/api/projects/${projectId}/rigging/moveit2-context`);
    const hint = document.getElementById("urdf-moveit2-hint");
    if (hint && moveIt2Context?.hint) hint.textContent = moveIt2Context.hint;
    return moveIt2Context;
  } catch (err) {
    if (!quiet) setEditStatus("error", err?.message || "Could not load MoveIt2 context.");
    return null;
  }
}

function buildMoveIt2Payload() {
  const { urdfFile, srdfFile } = pickPreferredRobotFiles(robotArtifactData || {});
  const group = document.getElementById("urdf-moveit2-group")?.value || "";
  const ee = document.getElementById("urdf-moveit2-ee")?.value || "";
  const frame = document.getElementById("urdf-moveit2-frame")?.value || "";
  const x = Number(document.getElementById("urdf-moveit2-x")?.value || 0);
  const y = Number(document.getElementById("urdf-moveit2-y")?.value || 0);
  const z = Number(document.getElementById("urdf-moveit2-z")?.value || 0);
  const eeMeta = (urdfRobotRuntime.getState()?.srdf?.endEffectors || []).find((item) => item.name === ee) || null;
  const apiEe = (robotArtifactData?.srdf?.end_effectors || []).find((item) => item.name === ee) || null;
  const targetLink = eeMeta?.parentLink || eeMeta?.link || apiEe?.parent_link || "";
  const displayJoints = jointValuesForMoveIt2Display();
  const preferredSrdf = moveIt2Context?.file || srdfFile || "";
  const preferredUrdf = moveIt2Context?.urdfFile || urdfFile || "";
  return {
    dir: moveIt2Context?.dir || "",
    file: preferredSrdf,
    urdfFile: preferredUrdf,
    startJointValuesByName: { ...(urdfRobotRuntime.getState()?.jointValuesRad || {}) },
    startJointValuesByNameDeg: displayJoints,
    target: {
      endEffector: ee,
      frame: frame || urdfRobotRuntime.getState()?.urdf?.rootLink || "",
      targetLink,
      xyz: [x, y, z],
    },
    moveit2: {
      planningGroup: group,
      endEffector: ee,
      targetLink,
      targetFrame: frame || urdfRobotRuntime.getState()?.urdf?.rootLink || "",
      ik: {
        positionOnly: true,
        timeout: 0.05,
        attempts: 1,
        tolerance: 0.002,
      },
      planning: {
        pipeline: "ompl",
        plannerId: "RRTConnectkConfigDefault",
        planningTime: 1,
        maxVelocityScalingFactor: 1,
        maxAccelerationScalingFactor: 1,
      },
    },
  };
}

function applyMoveIt2Result(payload) {
  if (!payload || typeof payload !== "object") return false;
  const trajectory = payload.trajectory || null;
  if (trajectory?.points?.length) {
    urdfRobotRuntime.playTrajectory(trajectory, {
      durationSec: Math.max(0.8, Math.min(4, (trajectory.points.length || 8) * 0.08)),
      onFrame: () => syncUrdfSlidersFromRuntime(),
    });
    return "trajectory";
  }
  const values = payload.jointValuesByName || payload.joint_values || null;
  if (values) {
    urdfRobotRuntime.setJointValues(values);
    syncUrdfSlidersFromRuntime();
    return "pose";
  }
  const degValues = payload.jointValuesByNameDeg || null;
  if (degValues && typeof degValues === "object") {
    const radMap = {};
    Object.entries(degValues).forEach(([name, display]) => {
      const joint = (robotArtifactData?.joints || []).find((item) => item.name === name) || { name, type: "revolute" };
      radMap[name] = isAngularRobotJoint(joint) ? (Number(display) || 0) * Math.PI / 180 : (Number(display) || 0);
    });
    urdfRobotRuntime.setJointValues(radMap);
    syncUrdfSlidersFromRuntime();
    return "pose";
  }
  return false;
}

function updateMoveIt2StatusUi({ connected = false, detail = "" } = {}) {
  const el = document.getElementById("urdf-moveit2-status");
  if (!el) return;
  el.textContent = connected
    ? `MoveIt2: connected${detail ? ` · ${detail}` : ""}`
    : `MoveIt2: offline${detail ? ` · ${detail}` : ""}`;
  el.classList.toggle("ok", !!connected);
  el.classList.toggle("error", !connected);
}

async function refreshMoveIt2Connection({ quiet = false } = {}) {
  await refreshMoveIt2ProjectContext({ quiet: true });
  updateMoveIt2StatusUi({ connected: false, detail: "connecting…" });
  const result = await moveIt2Client.connect();
  if (result?.ok) {
    const root = moveIt2Context?.repoRoot ? PathBasename(moveIt2Context.repoRoot) : "";
    updateMoveIt2StatusUi({
      connected: true,
      detail: root ? `${result.url || ""} · ${root}` : (result.url || ""),
    });
    if (!quiet) {
      const hint = moveIt2Context?.hint || "MoveIt2 server connected.";
      setEditStatus("ok", hint);
    }
    return true;
  }
  updateMoveIt2StatusUi({ connected: false, detail: result?.reason || "not running" });
  if (!quiet) {
    setEditStatus(
      "error",
      "MoveIt2 offline. Start with: scripts/run-moveit2-for-project.sh <projectId>",
    );
  }
  return false;
}

function PathBasename(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  return parts[parts.length - 1] || path || "";
}

async function runMoveIt2Solve() {
  if (!urdfRobotRuntime.isLoaded()) {
    setEditStatus("error", "Load a URDF robot scene first.");
    return;
  }
  const payloadBase = buildMoveIt2Payload();
  if (!payloadBase.file) {
    setEditStatus("error", "MoveIt2 needs an SRDF artifact in this project.");
    return;
  }
  const connected = moveIt2Client.isConnected() || await refreshMoveIt2Connection({ quiet: true });
  if (!connected) {
    setEditStatus("error", "MoveIt2 server offline. Start it or pass ?moveit2Ws=ws://host:8765/ws");
    return;
  }
  try {
    const payload = await moveIt2Client.request("srdf.solvePose", payloadBase);
    const kind = applyMoveIt2Result(payload);
    if (kind) setEditStatus("ok", kind === "trajectory" ? "Playing MoveIt2 IK trajectory." : "MoveIt2 IK solve applied.");
    else setEditStatus("error", "MoveIt2 solve returned no joint values.");
  } catch (err) {
    setEditStatus("error", err?.message || "MoveIt2 solve failed.");
  }
}

async function runMoveIt2Plan() {
  if (!urdfRobotRuntime.isLoaded()) {
    setEditStatus("error", "Load a URDF robot scene first.");
    return;
  }
  const payloadBase = buildMoveIt2Payload();
  if (!payloadBase.file) {
    setEditStatus("error", "MoveIt2 needs an SRDF artifact in this project.");
    return;
  }
  const connected = moveIt2Client.isConnected() || await refreshMoveIt2Connection({ quiet: true });
  if (!connected) {
    setEditStatus("error", "MoveIt2 server offline.");
    return;
  }
  try {
    const payload = await moveIt2Client.request("srdf.planToPose", payloadBase);
    const kind = applyMoveIt2Result(payload);
    if (kind) setEditStatus("ok", kind === "trajectory" ? "Playing MoveIt2 planned trajectory." : "MoveIt2 plan goal applied.");
    else setEditStatus("error", "MoveIt2 plan returned no trajectory.");
  } catch (err) {
    setEditStatus("error", err?.message || "MoveIt2 plan failed.");
  }
}

function fillMoveIt2Selectors(data = {}) {
  const groups = data?.srdf?.groups || urdfRobotRuntime.getState()?.srdf?.groups || [];
  const groupSelect = document.getElementById("urdf-moveit2-group");
  if (groupSelect) {
    const current = groupSelect.value;
    groupSelect.innerHTML = groups.length
      ? groups.map((g) => `<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)}</option>`).join("")
      : `<option value="">No SRDF groups</option>`;
    if (current && [...groupSelect.options].some((opt) => opt.value === current)) groupSelect.value = current;
  }
  const eeSelect = document.getElementById("urdf-moveit2-ee");
  if (eeSelect) {
    const runtimeEe = urdfRobotRuntime.getState()?.srdf?.endEffectors || [];
    const apiEe = data?.srdf?.end_effectors || [];
    const names = [
      ...runtimeEe.map((ee) => ee.name),
      ...apiEe.map((ee) => ee.name),
    ].filter(Boolean);
    const unique = [...new Set(names)];
    eeSelect.innerHTML = unique.length
      ? unique.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")
      : `<option value="">No end effectors</option>`;
  }
  const frameSelect = document.getElementById("urdf-moveit2-frame");
  if (frameSelect) {
    const links = (urdfRobotRuntime.getState()?.urdf?.links || data.links || [])
      .map((link) => (typeof link === "string" ? link : link?.name))
      .filter(Boolean);
    const current = frameSelect.value;
    const root = urdfRobotRuntime.getState()?.urdf?.rootLink || links[0] || "";
    frameSelect.innerHTML = links.length
      ? links.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")
      : `<option value="">No links</option>`;
    if (current && [...frameSelect.options].some((opt) => opt.value === current)) frameSelect.value = current;
    else if (root) frameSelect.value = root;
  }
}

function artifactLinksHtml(artifacts = []) {
  return artifacts.length
    ? artifacts.map((file) => `<a class="urdf-artifact-chip" href="/api/projects/${projectId}/files/${encodeURIComponent(file)}" target="_blank" rel="noopener">${escapeHtml(file)}</a>`).join("")
    : `<p class="muted small">No URDF/SRDF/SDF artifacts yet. Generate robot artifacts from a Python source.</p>`;
}

function isAngularRobotJoint(joint) {
  const type = String(joint?.type || "").toLowerCase();
  return type === "revolute" || type === "continuous";
}

function robotJointDisplayLimits(joint) {
  const lowerRad = Number(joint?.lower);
  const upperRad = Number(joint?.upper);
  if (isAngularRobotJoint(joint)) {
    return {
      lower: Math.round((Number.isFinite(lowerRad) ? lowerRad : -Math.PI) * 180 / Math.PI),
      upper: Math.round((Number.isFinite(upperRad) ? upperRad : Math.PI) * 180 / Math.PI),
      step: 1,
      unit: "deg",
    };
  }
  return {
    lower: Number.isFinite(lowerRad) ? lowerRad : -0.2,
    upper: Number.isFinite(upperRad) ? upperRad : 0.2,
    step: 0.001,
    unit: "m",
  };
}

function robotSrdfGroupsHtml(srdf = {}) {
  const groups = srdf.groups || [];
  const states = srdf.states || [];
  if (!groups.length && !states.length) {
    return `<p class="cad-param-hint">No SRDF planning groups or group states found yet.</p>`;
  }
  const stateOptions = states.map((state) => {
    const label = state.group ? `${state.name} · ${state.group}` : state.name;
    const payload = encodeURIComponent(JSON.stringify(state.joint_values || {}));
    return `<option value="${escapeHtml(state.name)}" data-group="${escapeHtml(state.group || "")}" data-joint-values="${payload}">${escapeHtml(label)}</option>`;
  }).join("");
  return `<div class="urdf-planning-grid">
    ${groups.map((group) => `<span class="urdf-artifact-chip">Group: ${escapeHtml(group.name)}${group.joints?.length ? ` · ${group.joints.length} joints` : ""}</span>`).join("")}
    <label class="cad-param-row urdf-group-state-row">
      <span>Group state</span>
      <select data-urdf-group-state>
        <option value="">custom / none</option>
        ${stateOptions}
      </select>
    </label>
  </div>`;
}

function robotLinkTreeHtml(links = [], joints = []) {
  if (!links.length && !joints.length) {
    return `<p class="cad-param-hint">No URDF links yet. Generate a URDF artifact to populate the tree.</p>`;
  }
  const byParent = new Map();
  const childLinks = new Set();
  for (const joint of joints) {
    const parent = String(joint.parent || "").trim();
    const child = String(joint.child || "").trim();
    if (!parent || !child) continue;
    childLinks.add(child);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push({ child, joint });
  }
  const roots = (links.map((l) => l.name).filter(Boolean)).filter((name) => !childLinks.has(name));
  const fallbackRoots = roots.length ? roots : [...new Set((links.map((l) => l.name).filter(Boolean)))];

  const renderNode = (linkName, depth = 0) => {
    const kids = byParent.get(linkName) || [];
    const jointHint = kids.length ? `${kids.length} child joint(s)` : "leaf";
    return `<div class="urdf-tree-node" style="--depth:${depth}">
      <button type="button" class="urdf-tree-row" data-urdf-link="${escapeHtml(linkName)}">
        <span class="urdf-tree-glyph">${kids.length ? "▣" : "●"}</span>
        <span class="urdf-tree-label">${escapeHtml(linkName)}</span>
        <em>${escapeHtml(jointHint)}</em>
      </button>
      ${kids.map(({ child, joint }) => `
        <div class="urdf-tree-joint" style="--depth:${depth + 1}">
          <span class="urdf-tree-glyph">⟷</span>
          <span>${escapeHtml(joint.name)} <em>(${escapeHtml(joint.type || "joint")})</em></span>
        </div>
        ${renderNode(child, depth + 1)}
      `).join("")}
    </div>`;
  };

  return `<div class="urdf-tree-root" role="tree">${fallbackRoots.map((name) => renderNode(name)).join("")}</div>`;
}

function robotJointSlidersHtml(joints = []) {
  const movable = joints.filter((joint) => String(joint.type || "").toLowerCase() !== "fixed");
  if (!movable.length) {
    return `<p class="cad-param-hint">No URDF movable joints found. Export/generate URDF with revolute or prismatic joints.</p>`;
  }
  return movable.map((joint) => {
    const limits = robotJointDisplayLimits(joint);
    const child = String(joint.child || "").trim();
    return `<label class="cad-param-row urdf-joint-row" data-joint-id="${escapeHtml(joint.name)}" data-joint-type="${escapeHtml(joint.type || "")}" data-joint-child="${escapeHtml(child)}">
      <span>${escapeHtml(joint.name)}${child ? ` → ${escapeHtml(child)}` : ""}</span>
      <input type="range" min="${limits.lower}" max="${limits.upper}" step="${limits.step}" value="0" data-robot-urdf-joint="${escapeHtml(joint.name)}" />
      <input type="number" step="${limits.step}" value="0" data-robot-urdf-joint-number="${escapeHtml(joint.name)}" />
      <em>${limits.unit}</em>
    </label>`;
  }).join("");
}

function renderRobotArtifacts() {
  const data = robotArtifactData || { sources: [], artifacts: [], joints: [], links: [], srdf: { groups: [], states: [] } };
  const sourceSelect = document.getElementById("rigging-artifact-source");
  if (sourceSelect) {
    const current = sourceSelect.value;
    sourceSelect.innerHTML = (data.sources || []).length
      ? (data.sources || []).map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join("")
      : `<option value="">No Python source files</option>`;
    if (current && [...sourceSelect.options].some((opt) => opt.value === current)) sourceSelect.value = current;
  }
  const artifactHtml = artifactLinksHtml(data.artifacts || []);
  const srdfHtml = robotSrdfGroupsHtml(data.srdf || {});
  const jointHtml = robotJointSlidersHtml(data.joints || []);
  const treeHtml = robotLinkTreeHtml(data.links || [], data.joints || []);
  const movableCount = (data.joints || []).filter((joint) => String(joint.type || "").toLowerCase() !== "fixed").length;

  const rigList = document.getElementById("rigging-artifact-list");
  if (rigList) rigList.innerHTML = artifactHtml;

  const artifactList = document.getElementById("urdf-artifact-list");
  if (artifactList) artifactList.innerHTML = artifactHtml;
  const urdfGroups = document.getElementById("urdf-srdf-groups");
  if (urdfGroups) urdfGroups.innerHTML = srdfHtml;
  const sliders = document.getElementById("urdf-joint-sliders");
  if (sliders) sliders.innerHTML = jointHtml;
  const tree = document.getElementById("urdf-link-tree");
  if (tree) tree.innerHTML = treeHtml;
  const summary = document.getElementById("urdf-joint-summary");
  if (summary) summary.textContent = `${movableCount} movable joint(s)`;
  const linkSummary = document.getElementById("urdf-link-summary");
  if (linkSummary) linkSummary.textContent = `${(data.links || []).length} link(s) · ${movableCount} joint(s)`;
  fillMoveIt2Selectors(data);
}

function isUrdfMotionModalOpen() {
  return !document.getElementById("urdf-motion-modal")?.classList.contains("hidden");
}

function openUrdfMotionModal() {
  const modal = document.getElementById("urdf-motion-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.body.classList.add("urdf-motion-open");
  renderUrdfPanel();
  void refreshRobotArtifacts({ quiet: true });
}

function closeUrdfMotionModal() {
  document.getElementById("urdf-motion-modal")?.classList.add("hidden");
  document.body.classList.remove("urdf-motion-open");
}

function renderUrdfPanel() {
  renderRobotArtifacts();
}

function applyRobotJointDisplayValue(jointName, displayValue, jointMeta = null) {
  const joint = jointMeta || (robotArtifactData?.joints || []).find((item) => item.name === jointName) || { name: jointName, type: "revolute" };
  const angular = isAngularRobotJoint(joint);
  const value = Number(displayValue) || 0;
  const rad = angular ? value * Math.PI / 180 : value;
  document.querySelectorAll(`[data-robot-urdf-joint="${CSS.escape(jointName)}"], [data-robot-urdf-joint-number="${CSS.escape(jointName)}"]`).forEach((el) => {
    el.value = String(value);
  });
  let applied = false;
  if (urdfRobotRuntime.isLoaded()) {
    applied = urdfRobotRuntime.setJointValue(jointName, rad) || applied;
  }
  const child = String(joint.child || joint.childLink || "").trim();
  const candidates = [jointName, child, jointName.replace(/^joint_/, ""), jointName.replace(/^joint_/, "").replace(/_to_/g, "_")];
  for (const id of candidates) {
    if (!id) continue;
    if (riggingEditor?.setJointValue?.(id, rad)) {
      applied = true;
      break;
    }
  }
  return applied;
}

function resetRobotJointPose() {
  const joints = (robotArtifactData?.joints || []).filter((joint) => String(joint.type || "").toLowerCase() !== "fixed");
  if (urdfRobotRuntime.isLoaded()) urdfRobotRuntime.resetPose();
  joints.forEach((joint) => applyRobotJointDisplayValue(joint.name, 0, joint));
  document.querySelectorAll("[data-urdf-group-state]").forEach((el) => {
    el.value = "";
  });
  setEditStatus("ok", "Robot pose reset to zero.");
}

async function copyRobotJointAngles() {
  const joints = (robotArtifactData?.joints || []).filter((joint) => String(joint.type || "").toLowerCase() !== "fixed");
  const payload = {};
  joints.forEach((joint) => {
    const input = document.querySelector(`[data-robot-urdf-joint="${CSS.escape(joint.name)}"]`);
    payload[joint.name] = Number(input?.value || 0);
  });
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    setEditStatus("ok", "Copied joint angles JSON.");
  } catch {
    setEditStatus("error", "Could not copy joint angles.");
  }
}

function applySrdfGroupStateFromSelect(selectEl) {
  if (!(selectEl instanceof HTMLSelectElement) || !selectEl.value) return;
  const option = selectEl.selectedOptions?.[0];
  if (!option) return;
  if (urdfRobotRuntime.isLoaded() && urdfRobotRuntime.applyGroupState(selectEl.value)) {
    syncUrdfSlidersFromRuntime();
    setEditStatus("ok", `Applied SRDF group state “${selectEl.value}”.`);
    return;
  }
  let values = {};
  try {
    values = JSON.parse(decodeURIComponent(option.dataset.jointValues || "%7B%7D"));
  } catch {
    values = {};
  }
  Object.entries(values).forEach(([jointName, radValue]) => {
    const joint = (robotArtifactData?.joints || []).find((item) => item.name === jointName) || { name: jointName, type: "revolute" };
    const display = isAngularRobotJoint(joint) ? (Number(radValue) || 0) * 180 / Math.PI : (Number(radValue) || 0);
    applyRobotJointDisplayValue(jointName, display, joint);
  });
  setEditStatus("ok", `Applied SRDF group state “${selectEl.value}”.`);
}

function bindUrdfPanel() {
  document.getElementById("btn-open-urdf-motion")?.addEventListener("click", () => openUrdfMotionModal());
  document.querySelectorAll(".btn-rigging-toolbelt-motion").forEach((btn) => {
    btn.addEventListener("click", () => openUrdfMotionModal());
  });
  document.querySelectorAll("[data-urdf-motion-close]").forEach((el) => {
    el.addEventListener("click", () => closeUrdfMotionModal());
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isUrdfMotionModalOpen()) closeUrdfMotionModal();
  });
  document.getElementById("btn-urdf-refresh")?.addEventListener("click", () => refreshRobotArtifacts());
  document.getElementById("btn-urdf-play")?.addEventListener("click", () => {
    if (urdfRobotRuntime.isLoaded()) {
      const joints = (robotArtifactData?.joints || []).filter((j) => String(j.type || "").toLowerCase() !== "fixed");
      if (joints.length) {
        const points = [];
        for (let i = 0; i <= 20; i += 1) {
          const t = i / 20;
          const values = {};
          joints.forEach((joint, idx) => {
            const amp = isAngularRobotJoint(joint) ? (Math.PI / 4) : 0.05;
            values[joint.name] = Math.sin((t * Math.PI * 2) + idx) * amp;
          });
          points.push({ jointValuesByName: values });
        }
        urdfRobotRuntime.playTrajectory({ points }, { durationSec: 2.4, onFrame: () => syncUrdfSlidersFromRuntime() });
        setEditStatus("ok", "Playing URDF joint sweep.");
        return;
      }
    }
    toggleRiggingPlayback();
  });
  document.getElementById("btn-urdf-export")?.addEventListener("click", async () => {
    await riggingEditor?.exportUrdf?.();
    await refreshFiles();
    await refreshRobotArtifacts({ quiet: true });
  });
  document.getElementById("btn-urdf-reset")?.addEventListener("click", () => resetRobotJointPose());
  document.getElementById("btn-urdf-copy")?.addEventListener("click", () => copyRobotJointAngles());
  document.getElementById("btn-urdf-load-scene")?.addEventListener("click", () => ensureUrdfRobotScene({ force: true }));
  document.getElementById("btn-urdf-moveit2-connect")?.addEventListener("click", () => refreshMoveIt2Connection());
  document.getElementById("btn-urdf-moveit2-solve")?.addEventListener("click", () => runMoveIt2Solve());
  document.getElementById("btn-urdf-moveit2-plan")?.addEventListener("click", () => runMoveIt2Plan());

  const onJointInput = (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const id = input.dataset.urdfJoint || input.dataset.urdfJointNumber || input.dataset.robotUrdfJoint || input.dataset.robotUrdfJointNumber;
    if (!id) return;
    const joint = (robotArtifactData?.joints || []).find((item) => item.name === id) || null;
    applyRobotJointDisplayValue(id, input.value, joint);
  };
  document.getElementById("urdf-joint-sliders")?.addEventListener("input", onJointInput);

  const onGroupState = (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || !select.matches("[data-urdf-group-state]")) return;
    applySrdfGroupStateFromSelect(select);
  };
  document.getElementById("urdf-srdf-groups")?.addEventListener("change", onGroupState);
}

/** Right panel → AI (CAD or Wiring) with Compose sub-tab active. */
function showAiComposePanel() {
  if (workspaceModes?.isWiring?.()) {
    setRightTab("wiring");
    wiringPromptHistory.setTab("compose");
    return;
  }
  setRightTab("prompt");
  promptHistory.setTab("compose");
  applyPromptModeUI("v2");
}

function activateArchitectPrompt(kind = "room") {
  setSkillEnabled("cad", true);
  setSkillEnabled("architect", true);
  skillsPromptUI.render();
  applyPromptModeUI("architect");
  composer.setPromptText(architectPresetPrompt(kind));
  setRightTab("prompt");
  promptHistory.setTab("compose");
  saveActiveModelPromptState();
  setEditStatus("ok", "Architect prompt loaded — review it, then Generate modular house part.");
  document.getElementById("prompt-input")?.focus();
}

document.querySelectorAll("[data-right-tab]").forEach((btn) => {
  btn.addEventListener("click", () => setRightTab(btn.dataset.rightTab));
});
bindUrdfPanel();

async function currentProjectModelFiles() {
  if (!projectId) return [];
  try {
    const data = await api(`/api/projects/${projectId}`);
    return (data.files || []).filter((file) => /\.(glb|gltf|step|stp|stl|obj|3mf)$/i.test(file.name || ""));
  } catch {
    return [];
  }
}

let architectLibraryFilter = "";
let architectLibraryViewers = [];
let architectLibraryView = "all";
let architectPhase = "build";

const ARCHITECT_PHASES = {
  build: {
    label: "Build",
    badge: "Build",
  },
  design: {
    label: "Design",
    badge: "Design · Dev",
    ribbonHint: "Styled kits and materials live in Design (in development). Stay in Build for wireframe tiles.",
  },
  structure: {
    label: "Structure",
    badge: "Structure · Dev",
    ribbonHint: "Floors, roofs, and levels live in Structure (in development).",
  },
  comfort: {
    label: "Comfort",
    badge: "Comfort · Dev",
    ribbonHint: "Daylight and comfort overlays live in Comfort (in development).",
  },
  review: {
    label: "Review",
    badge: "Review · Dev",
    ribbonHint: "Plan review and export prep live in Review (in development).",
  },
};

const ARCHITECT_RIBBON_TOOL_PHASE = {
  wall: "build",
  window: "build",
  door: "build",
  room: "structure",
  floor: "structure",
  roof: "structure",
  pattern: "structure",
  service: "comfort",
  robot: "review",
  image: "design",
  blueprint: "design",
};

function setArchitectPhase(phase = "build") {
  const next = ARCHITECT_PHASES[phase] ? phase : "build";
  architectPhase = next;
  document.querySelectorAll("[data-architect-phase]").forEach((btn) => {
    const active = btn.getAttribute("data-architect-phase") === next;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-architect-phase-pane]").forEach((pane) => {
    const active = pane.getAttribute("data-architect-phase-pane") === next;
    pane.classList.toggle("active", active);
    pane.hidden = !active;
  });
  const badge = document.getElementById("architect-phase-badge");
  if (badge) badge.textContent = ARCHITECT_PHASES[next]?.badge || next;
  const legacy = document.getElementById("architect-legacy-details");
  // Legacy kit library stays out of Build wireframing; only peek under Design for now.
  if (legacy) legacy.hidden = next !== "design";
  if (next === "build") closeArchitectLibrary();
  setRightTab("architect");
}

function applyArchitectBuildTile(tool = "wall") {
  setArchitectPhase("build");
  const step = tool === "window" ? "window" : tool === "door" ? "door" : tool === "select" ? "select" : "draw";
  getArchitectSession().setStep(step);
  const labels = { draw: "Wall", window: "Window", door: "Door", select: "Select" };
  setEditStatus("ok", `Build tile: ${labels[step] || "Wall"}. Same 3 ft size — window/door are openings in a wall bay.`);
}

function disposeArchitectLibraryViewers() {
  architectLibraryViewers.forEach((viewer) => viewer?.dispose?.());
  architectLibraryViewers = [];
}

function architectPreviewFilename(file, allFiles = []) {
  const name = String(file?.name || "");
  if (/\.(glb|gltf)$/i.test(name)) return name;
  const stem = name.replace(/\.[^.]+$/, "");
  const glb = allFiles.find((entry) => String(entry?.name || "").toLowerCase() === `${stem.toLowerCase()}.glb`);
  return glb?.name || null;
}

function architectLibraryQueryForTool(tool = "") {
  const value = String(tool || "").toLowerCase();
  if (value === "wall") return "wall";
  if (value === "pillar") return "pillar";
  if (value === "roof") return "roof";
  if (value === "floor") return "floor";
  if (value === "window" || value === "door") return value;
  if (value === "room" || value === "pattern" || value === "robot") return "room";
  if (value === "service") return "service";
  return "";
}

function architectPreviewKind(id = "") {
  const value = String(id || "");
  if (value.includes("roof-gable")) return "roof-gable";
  if (value.includes("roof-corner")) return "roof-corner";
  if (value.includes("roof")) return "roof";
  if (value.includes("corner")) return "corner";
  if (value.includes("pillar")) return "pillar";
  if (value.includes("window-wall")) return "window-wall";
  if (value.includes("door-wall")) return "door-wall";
  if (value === "window") return "window";
  if (value === "door") return "door";
  if (value.includes("floor")) return "floor";
  if (value.includes("room")) return "room";
  if (value.includes("service")) return "service";
  if (value.includes("half") || value.includes("low")) return "low-wall";
  return "wall";
}

function architectPreviewMarkup(item = {}) {
  const kind = architectPreviewKind(item.id);
  return `<div class="architect-part-preview architect-part-preview--${appEscapeHtml(kind)}" aria-hidden="true">
    <span class="ap-grid"></span>
    <span class="ap-floor"></span>
    <span class="ap-wall ap-wall-a"></span>
    <span class="ap-wall ap-wall-b"></span>
    <span class="ap-wall ap-wall-c"></span>
    <span class="ap-window"></span>
    <span class="ap-door"></span>
    <span class="ap-roof ap-roof-a"></span>
    <span class="ap-roof ap-roof-b"></span>
    <span class="ap-connector ap-connector-a"></span>
    <span class="ap-connector ap-connector-b"></span>
    <span class="ap-tab ap-tab-a"></span>
    <span class="ap-tab ap-tab-b"></span>
  </div>`;
}

function architectCustomCategoryPrompt(category = "Walls") {
  const prefix = architectPromptPrefix();
  const section = String(category || "Walls");
  const detail = {
    Walls: "Generate a custom wall module variant with separate named parts, snap connectors, and printable details.",
    Openings: "Generate a custom opening module (window/door insert or wall opening system) with separate named parts.",
    Floors: "Generate a custom floor module with rails/sockets and realistic texture-ready details.",
    Roof: "Generate a custom roof/ceiling module with alignment sockets and printable segments.",
    Rooms: "Generate a full custom room kit composed of separate floor, walls, and openings.",
    Utilities: "Generate a custom utility wall/core module with removable service panels and channels.",
  }[section] || "Generate a custom architect module with separate named parts and snap interfaces.";
  return `${prefix}

${detail}

Use any attached references as authoritative:
- DXF drawings for exact profile/layout
- images for style and proportions
- txt/md/csv/json/yaml/log documents for specs, requirements, and instructions

Return separate editable bodies/components and keep parts printable for multi-part assembly.`;
}

function startArchitectCategoryPrompt(category = "Walls", { openRefPicker = false } = {}) {
  applyPromptModeUI("architect");
  const input = document.getElementById("prompt-input");
  const prompt = architectCustomCategoryPrompt(category);
  if (input) {
    input.value = prompt;
    input.focus();
    input.select();
  }
  showAiComposePanel?.();
  setRightTab("prompt");
  syncPromptTargetUI();
  if (openRefPicker) promptImageInput?.click();
  setEditStatus(
    "ok",
    openRefPicker
      ? `${category}: custom Architect prompt ready. Add DXF/image/txt refs, then Generate.`
      : `${category}: custom Architect prompt ready. Add refs if needed, then Generate.`
  );
}

async function renderArchitectLibrary() {
  const grid = document.getElementById("architect-library-grid");
  const search = document.getElementById("architect-library-search");
  const tabButtons = [...document.querySelectorAll("[data-architect-filter-view]")];
  if (!grid) return;
  disposeArchitectLibraryViewers();
  tabButtons.forEach((btn) => {
    const active = btn.dataset.architectFilterView === architectLibraryView;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  const query = (search?.value || architectLibraryFilter || "").trim().toLowerCase();
  const models = await currentProjectModelFiles();
  const favorites = readArchitectFavorites();
  const favoriteModules = new Set(favorites.modules || []);
  const favoriteFiles = new Set(favorites.files || []);
  const visibleModules = ARCHITECT_LOCAL_MODULES
    .filter((item) => (architectLibraryView === "favorites" ? favoriteModules.has(item.id) : true))
    .filter((item) => `${item.title} ${item.category} ${item.description}`.toLowerCase().includes(query));
  const categoryMap = new Map();
  for (const item of visibleModules) {
    const key = item.category || "Other";
    if (!categoryMap.has(key)) categoryMap.set(key, []);
    categoryMap.get(key).push(item);
  }
  const moduleCards = [...categoryMap.entries()].map(([category, items]) => {
    const sortedItems = [...items].sort((a, b) => Number(favoriteModules.has(b.id)) - Number(favoriteModules.has(a.id)) || a.title.localeCompare(b.title));
    const cards = sortedItems.map((item) => `
      <article class="architect-library-item architect-library-item--module" draggable="true" data-architect-library-drag="${appEscapeHtml(item.id)}">
        <div class="architect-library-preview">${architectPreviewMarkup(item)}</div>
        <div>
          <small>${appEscapeHtml(item.category)}</small>
          <strong>${appEscapeHtml(item.title)}</strong>
          <p>${appEscapeHtml(item.description)}</p>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn accent" data-architect-library-module="${appEscapeHtml(item.id)}">Place module</button>
          <button type="button" class="btn secondary" data-architect-fav-module="${appEscapeHtml(item.id)}">${favoriteModules.has(item.id) ? "★ Favorited" : "☆ Favorite"}</button>
        </div>
      </article>
    `).join("");
    return `
      <section class="architect-library-section">
        <div class="row" style="justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <h4 style="margin:0">${appEscapeHtml(category)}</h4>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <button type="button" class="btn secondary btn-compact" data-architect-category-prompt="${appEscapeHtml(category)}">Generate custom</button>
            <button type="button" class="btn secondary btn-compact" data-architect-category-prompt-refs="${appEscapeHtml(category)}">Generate + attach refs</button>
          </div>
        </div>
        <div class="architect-library-section-grid">${cards}</div>
      </section>
    `;
  });
  const modelCards = models
    .filter((file) => (architectLibraryView === "favorites" ? favoriteFiles.has(String(file.name || "")) : true))
    .filter((file) => `${file.name || ""}`.toLowerCase().includes(query))
    .sort((a, b) =>
      Number(favoriteFiles.has(String(b.name || ""))) - Number(favoriteFiles.has(String(a.name || "")))
      || String(a.name || "").localeCompare(String(b.name || ""))
    )
    .map((file) => {
      const previewName = architectPreviewFilename(file, models);
      const previewMarkup = previewName
        ? `<div class="architect-library-preview architect-library-preview--model" data-architect-glb-preview="${appEscapeHtml(previewName)}" aria-hidden="true"></div>`
        : `<div class="architect-library-preview architect-library-preview--file" aria-hidden="true">${appEscapeHtml((file.name || "CAD").split(".").pop()?.toUpperCase() || "CAD")}</div>`;
      return `
      <article class="architect-library-item">
        ${previewMarkup}
        <div>
          <small>Uploaded / saved model</small>
          <strong>${appEscapeHtml(file.name || "Model")}</strong>
          <p>${file.size ? `${Math.round(Number(file.size) / 1024)} KB` : "Saved in current project"}</p>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn secondary" data-architect-library-open="${appEscapeHtml(file.name || "")}">Open / place</button>
          <button type="button" class="btn secondary" data-architect-fav-file="${appEscapeHtml(file.name || "")}">${favoriteFiles.has(String(file.name || "")) ? "★ Favorited" : "☆ Favorite"}</button>
        </div>
      </article>
    `;
    });
  grid.innerHTML = [...moduleCards, ...modelCards].join("") || `<p class="muted small">No Architect modules or saved models match that search.</p>`;
  if (projectId) {
    grid.querySelectorAll("[data-architect-glb-preview]").forEach((el) => {
      const filename = el.dataset.architectGlbPreview;
      if (!filename) return;
      const viewer = createMiniViewer(el, { autoRotate: true });
      architectLibraryViewers.push(viewer);
      void viewer.load(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}`).catch(() => {
        el.classList.remove("architect-library-preview--model");
        el.classList.add("architect-library-preview--file");
        el.textContent = filename.split(".").pop()?.toUpperCase() || "CAD";
      });
    });
  }
  grid.querySelectorAll("[data-architect-library-module]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await buildArchitectModule(btn.dataset.architectLibraryModule || "wall");
      closeArchitectLibrary();
    });
  });
  grid.querySelectorAll("[data-architect-library-drag]").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      const kind = card.dataset.architectLibraryDrag || "wall";
      e.dataTransfer?.setData("application/render3d-architect-module", JSON.stringify({ kind }));
      e.dataTransfer?.setData("text/plain", `Architect module: ${kind}`);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    });
  });
  grid.querySelectorAll("[data-architect-library-open]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const filename = btn.dataset.architectLibraryOpen;
      if (!filename || !projectId) return;
      selectedFile = filename;
      await loadModel(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}`, filename, {
        projectId,
        append: projectAssembly.count() > 0,
        catalogFilename: filename,
        autoGizmo: true,
        fitView: true,
      });
      projectTree.setSelected(filename);
      closeArchitectLibrary();
      setEditStatus("ok", `Opened ${filename}. Drag it by hand or use grid snap.`);
    });
  });
  grid.querySelectorAll("[data-architect-category-prompt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const category = btn.dataset.architectCategoryPrompt || "Walls";
      closeArchitectLibrary();
      startArchitectCategoryPrompt(category, { openRefPicker: false });
    });
  });
  grid.querySelectorAll("[data-architect-category-prompt-refs]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const category = btn.dataset.architectCategoryPromptRefs || "Walls";
      closeArchitectLibrary();
      startArchitectCategoryPrompt(category, { openRefPicker: true });
    });
  });
  grid.querySelectorAll("[data-architect-fav-module]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.architectFavModule || "";
      if (!id) return;
      toggleArchitectFavorite("module", id);
      void renderArchitectLibrary();
    });
  });
  grid.querySelectorAll("[data-architect-fav-file]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.architectFavFile || "";
      if (!name) return;
      toggleArchitectFavorite("file", name);
      void renderArchitectLibrary();
    });
  });
}

function openArchitectLibrary(filter = "", options = {}) {
  const force = !!options.force;
  // Kit library is not part of Build wireframing. Later phases are docs-only for now.
  if (!force && document.body.classList.contains("architect-design-tab")) {
    const tool = String(filter || "wall").toLowerCase();
    if (architectPhase === "build" || tool === "wall" || tool === "window" || tool === "door") {
      applyArchitectBuildTile(tool === "window" || tool === "door" ? tool : "wall");
      return;
    }
    const phase = ARCHITECT_RIBBON_TOOL_PHASE[tool] || architectPhase || "design";
    setArchitectPhase(phase);
    setEditStatus(
      "ok",
      "Module library is reserved for Design (still in development). Build phase only uses Wall, Door, and Window tiles.",
    );
    return;
  }
  architectLibraryFilter = architectLibraryQueryForTool(filter);
  document.getElementById("architect-library-modal")?.classList.remove("hidden");
  const search = document.getElementById("architect-library-search");
  if (search && architectLibraryFilter) search.value = architectLibraryFilter;
  void renderArchitectLibrary();
  setTimeout(() => document.getElementById("architect-library-search")?.focus(), 50);
}

function closeArchitectLibrary() {
  disposeArchitectLibraryViewers();
  document.getElementById("architect-library-modal")?.classList.add("hidden");
  architectLibraryFilter = "";
}

document.getElementById("btn-architect-advanced")?.addEventListener("click", () => {
  openArchitectLibrary("", { force: true });
});
document.querySelectorAll("[data-architect-library-close]").forEach((el) => {
  el.addEventListener("click", closeArchitectLibrary);
});
document.getElementById("architect-library-search")?.addEventListener("input", () => {
  void renderArchitectLibrary();
});
document.querySelectorAll("[data-architect-filter-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const next = btn.dataset.architectFilterView === "favorites" ? "favorites" : "all";
    if (next === architectLibraryView) return;
    architectLibraryView = next;
    void renderArchitectLibrary();
  });
});

function initializeArchitectConnectorControls() {
  const presetEl = document.getElementById("architect-connector-preset");
  const sizeEl = document.getElementById("architect-connector-size");
  const inputEl = document.getElementById("architect-connector-dxf-input");
  const buttonEl = document.getElementById("btn-architect-connector-dxf");
  const storedProfile = storedArchitectConnectorProfile();
  if (storedProfile) {
    if (presetEl) presetEl.value = "dxf_profile";
    if (sizeEl) sizeEl.value = String(clampArchitectConnectorSize(storedProfile.size_mm));
  }
  updateArchitectConnectorStatus();
  presetEl?.addEventListener("change", updateArchitectConnectorStatus);
  sizeEl?.addEventListener("input", updateArchitectConnectorStatus);
  buttonEl?.addEventListener("click", () => inputEl?.click());
  inputEl?.addEventListener("change", async () => {
    const file = inputEl.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const profile = parseArchitectConnectorDxfProfile(text, file.name);
      localStorage.setItem(ARCHITECT_CONNECTOR_PROFILE_KEY, JSON.stringify(profile));
      if (presetEl) presetEl.value = "dxf_profile";
      if (sizeEl) sizeEl.value = String(profile.size_mm);
      updateArchitectConnectorStatus();
      setEditStatus("ok", `Loaded Architect connector DXF profile ${file.name}. New modules use that snap size.`);
    } catch (err) {
      setEditStatus("error", err.message || "Could not read connector DXF.");
    } finally {
      inputEl.value = "";
    }
  });
}

initializeArchitectConnectorControls();

document.querySelectorAll("[data-architect-module]").forEach((btn) => {
  btn.addEventListener("click", () => {
    void buildArchitectModule(btn.dataset.architectModule || "wall").catch((err) => {
      setEditStatus("error", err.message || "Could not build Architect module.");
    });
  });
});
document.querySelectorAll("[data-architect-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.architectTool || "wall";
    if (tool === "wall" || tool === "window" || tool === "door") {
      applyArchitectBuildTile(tool);
      return;
    }
    const kind = tool === "window" ? "window-wall" : tool === "door" ? "door-wall" : tool;
    void buildArchitectModule(kind).catch((err) => {
      setEditStatus("error", err.message || "Could not build Architect module.");
    });
  });
});
document.querySelectorAll("[data-architect-edit-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mesh = architectSelectedMesh();
    if (mesh) {
      showObjectGizmo(mesh);
      setEditStatus("ok", "Use the viewport gizmo to drag, scale, or stretch the selected Architect module by hand.");
    } else {
      setArchitectPhase("design");
      setEditStatus("ok", ARCHITECT_PHASES.design.ribbonHint);
    }
  });
});
document.getElementById("btn-architect-snap-grid")?.addEventListener("click", () => snapArchitectSelectionToGrid());
document.querySelectorAll("[data-architect-nudge]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const dir = btn.dataset.architectNudge || "";
    if (dir === "x+") nudgeArchitectSelection(1, 0);
    else if (dir === "x-") nudgeArchitectSelection(-1, 0);
    else if (dir === "y+") nudgeArchitectSelection(0, 1);
    else if (dir === "y-") nudgeArchitectSelection(0, -1);
  });
});
document.querySelectorAll("[data-architect-phase]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const phase = btn.getAttribute("data-architect-phase") || "build";
    setArchitectPhase(phase);
    if (phase === "build") {
      applyArchitectBuildTile("wall");
    } else {
      setEditStatus(
        "ok",
        `${ARCHITECT_PHASES[phase]?.label || phase} is in development — read the plan in the side panel. Build is the live phase today.`,
      );
    }
  });
});
document.querySelectorAll("[data-architect-step]").forEach((btn) => {
  btn.addEventListener("click", () => {
    setArchitectPhase("build");
    const step = btn.getAttribute("data-architect-step") || "draw";
    getArchitectSession().setStep(step);
  });
});
document.getElementById("btn-architect-clear-plan")?.addEventListener("click", () => {
  getArchitectSession().clearPlan();
});

document.getElementById("btn-feature-collapse")?.addEventListener("click", (e) => {
  const panel = document.querySelector("[data-right-panel='history']");
  const collapsed = !panel?.classList.contains("feature-history-collapsed");
  panel?.classList.toggle("feature-history-collapsed", collapsed);
  e.currentTarget.setAttribute("aria-pressed", String(collapsed));
  e.currentTarget.textContent = collapsed ? "Expand" : "Collapse";
});

function openTransformMode(mode) {
  setRightTab("tools");
  directModeling.reset();
  document.querySelectorAll("[data-dm-tool]").forEach((btn) => btn.classList.remove("active"));
  const mesh = objectTools.getSelection()?.mesh || currentMesh;
  if (mesh) {
    if (!objectTools.getSelection()?.mesh) {
      objectTools.selectObject({ mesh, root: currentMesh, bodyIndex: 0 });
    }
    showObjectGizmo(mesh, mode);
  }
}

function openGenerativeEdits() {
  const filename = selectedObjectFilename();
  showAiComposePanel();
  applyPromptModeUI("v2");
  const targetModeSelect = document.getElementById("prompt-target-mode");
  if (targetModeSelect) targetModeSelect.value = filename ? "edit" : "new";
  if (filename) {
    const objectSelect = document.getElementById("prompt-target-object");
    selectedFile = filename;
    if (objectSelect) objectSelect.value = filename;
    projectTree.setSelected(filename);
    featureEditor.setModel(projectId, filename);
    selectAssemblyComponent(filename, { fitView: false });
  }
  syncPromptTargetUI();
  const input = document.getElementById("prompt-input");
  const example =
    "Resize the selected object: make the main body ___ mm wider, adjust the related supports/holes/clearances proportionally, and preserve the existing functional relationships.";
  if (input && !input.value.trim()) {
    input.value = example;
    input.focus();
    input.select();
  } else {
    input?.focus();
  }
  setEditStatus(
    filename ? "ok" : "error",
    filename
      ? "Generative Edits: describe width, size, clearance, or proportion changes for the selected object, then Generate."
      : "Generative Edits opened. Select an object first to edit its width/sizes."
  );
  return true;
}

function launchViewportTool(toolId) {
  if (toolId === "generative_edits") {
    return openGenerativeEdits();
  }
  setRightTab("tools");
  activatePickMode("off");
  document.querySelectorAll("[data-dm-tool]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.dmTool === toolId);
  });
  if (toolId === "transform") {
    openTransformMode("translate");
    return true;
  }
  if (toolId === "measure") {
    beginMeasureMode("face");
    return true;
  }
  if (toolId === "mirror") {
    gizmoPanel.hide();
    transformControls.detach();
    document.getElementById("btn-gizmo")?.classList.remove("active");
    controls.enabled = true;
    directModeling.setTool("mirror");
    setEditStatus("ok", "Mirror: choose/drag a plane or type an offset.");
    return true;
  }
  if (toolId === "hole") {
    gizmoPanel.hide();
    transformControls.detach();
    document.getElementById("btn-gizmo")?.classList.remove("active");
    controls.enabled = true;
    directModeling.setTool("hole");
    setEditStatus("ok", "Hole: click a face point, set diameter/depth/pattern, then Apply.");
    return true;
  }
  if (toolId === "fillet" || toolId === "chamfer") {
    gizmoPanel.hide();
    transformControls.detach();
    document.getElementById("btn-gizmo")?.classList.remove("active");
    controls.enabled = true;
    directModeling.setTool(toolId);
    setEditStatus(
      "ok",
      toolId === "fillet"
        ? "Fillet: drag the viewport radius handle or type a radius, then Apply."
        : "Chamfer: drag the viewport distance handle or type a distance, then Apply."
    );
    return true;
  }
  if (toolId === "presspull" || toolId === "presspull-cut" || toolId === "extrude") {
    gizmoPanel.hide();
    transformControls.detach();
    document.getElementById("btn-gizmo")?.classList.remove("active");
    controls.enabled = true;
    const faceRef = (composer.getReferences?.() || []).find((r) => r.type === "face" || r.face_index != null);
    const sketch = getSketchForExtrude();
    const sketchCount = sketchEditor.countVisibleSketches?.() ?? 0;
    if (sketch?.profile?.length && sketchCount === 1) {
      startExtrudeFromSketchData(sketch);
    } else if (faceRef && directModeling.startPressPullFromRef?.(faceRef)) {
      setEditStatus("ok", "Press-Pull linked to the selected face. Drag/type a distance or click To Face.");
    } else {
      directModeling.setTool("presspull");
      setEditStatus(
        "ok",
        sketchCount > 0
          ? "Click a sketch profile to extrude, or click a model face for Press-Pull."
          : "Press-Pull: click a sketch profile or model face, then drag/type a distance or use To Face."
      );
    }
    editTools.updateExtrudeTarget?.();
    return true;
  }
  return false;
}

function closeMarkingMenu() {
  document.querySelector(".marking-menu")?.remove();
  document.removeEventListener("mousedown", onMarkingMenuOutside, true);
}

function onMarkingMenuOutside(e) {
  if (e.target.closest?.(".marking-menu")) return;
  closeMarkingMenu();
}

function openMarkingMenu(event) {
  if (!currentMesh) return;
  event.preventDefault();
  closeMarkingMenu();
  const hit = pickObject(event, {
    camera,
    domElement: renderer.domElement,
    meshRoot: currentMesh,
  });
  if (hit?.mesh) {
    selectObjectHit(hit, { showGizmo: false });
  }
  const menu = document.createElement("div");
  menu.className = "marking-menu";
  const actions = [
    ["⇕", "Press-Pull", () => launchViewportTool("presspull")],
    ["⌾", "Hole", () => launchViewportTool("hole")],
    ["✥", "Move", () => openTransformMode("translate")],
    ["⟳", "Rotate", () => openTransformMode("rotate")],
    ["⤢", "Scale", () => openTransformMode("scale")],
    ["⧉", "Duplicate", () => { void duplicateSelectedObject(); }],
    ["↔", "Mirror", () => launchViewportTool("mirror")],
    ["◈", "Mesh Checkup", () => {
      directModeling.reset();
      gizmoPanel.hide();
      transformControls.detach();
      setRightTab("tools");
      meshCleanup.show();
    }],
    ["⊞", "Split bodies", () => {
      setRightTab("tools");
      objectTools.splitBodies();
    }],
    ["🎨", "Color", () => showColorTool()],
    ["🧱", "AI Wall Texture", () => setArchitectPromptForSelectedEdit("texture_ai")],
    ["▣", "Pick Face", () => { activatePickMode("face"); setEditStatus("ok", "Click faces on the model to add @face references."); }],
    ["⌁", "Pick Edge", () => { activatePickMode("edge"); setEditStatus("ok", "Click near edges on the model to add @edge references."); }],
    ["▣", "Select object", () => { activatePickMode("object"); setEditStatus("ok", "Click objects in the viewport · Delete / Backspace / X to delete · Cmd+Z to undo."); }],
    ["↶", "History", () => setRightTab("history")],
  ];
  menu.innerHTML = actions
    .map(([icon, label], i) => `<button type="button" data-mm="${i}"><span>${icon}</span><small>${label}</small></button>`)
    .join("");
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  // Block outside-dismiss from stealing mousedown before button click fires.
  menu.addEventListener("mousedown", (e) => e.stopPropagation());
  menu.addEventListener("pointerdown", (e) => e.stopPropagation());
  document.body.appendChild(menu);
  actions.forEach(([, , fn], i) => {
    menu.querySelector(`[data-mm="${i}"]`)?.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMarkingMenu();
      fn();
    });
  });
  setTimeout(() => document.addEventListener("mousedown", onMarkingMenuOutside, true), 0);
}

// Open the marking menu only for a true right-click. Right-button drag is pan,
// so wait until pointerup and check travel distance before showing the menu.
let _rcDownX = 0, _rcDownY = 0, _rcActive = false, _rcDragged = false;
viewport.addEventListener("pointerdown", (e) => {
  if (e.button === 2) {
    _rcDownX = e.clientX;
    _rcDownY = e.clientY;
    _rcActive = true;
    _rcDragged = false;
  }
}, true);
viewport.addEventListener("pointermove", (e) => {
  if (_rcActive && (e.buttons & 2)) { // right button held
    const moved = Math.hypot(e.clientX - _rcDownX, e.clientY - _rcDownY);
    if (moved > 6) _rcDragged = true;
  }
}, true);
viewport.addEventListener("pointerup", (e) => {
  if (!_rcActive || e.button !== 2) return;
  const moved = Math.hypot(e.clientX - _rcDownX, e.clientY - _rcDownY);
  const shouldOpen = !_rcDragged && moved <= 6;
  _rcActive = false;
  _rcDragged = false;
  if (shouldOpen) {
    e.preventDefault();
    openMarkingMenu(e);
  }
}, true);
viewport.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

const featureEditor = createFeatureEditor({
  container: document.getElementById("feature-editor"),
  api,
  rawFetch,
  onApplied: afterModelEdit,
  isBusy: () => isGenerationUiActive(projectId),
  onGenerating: (active, message) => {
    if (active) {
      showViewportOverlay(projectId, message || "Rebuilding…", { mode: "build", estimateMs: 60000 });
    } else if (!generationPollTimer) {
      hideViewportOverlay(projectId, { complete: true });
    }
  },
});

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  // Viewport is display:none in Canvas / Wiring modes — skip so we don't shrink to 0×0.
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  sketchEditor.resize?.();
  collab?.resizeLabels();
}

function refreshViewportAfterLayoutChange({ fit = false } = {}) {
  requestAnimationFrame(() => {
    resize();
    controls.update();
    viewCube.update?.();
    if (fit && currentMesh) fitCamera();
  });
}
window.addEventListener("resize", resize);
resize();

const IMPORT_ACCEPT = /\.(stl|obj|glb|gltf|ply|off|3mf|step|stp)$/i;
const DXF_ACCEPT = /\.dxf$/i;

function isViewportImportFile(name = "") {
  return IMPORT_ACCEPT.test(name) || DXF_ACCEPT.test(name);
}

let viewportDragDepth = 0;
const viewportDropOverlay = document.getElementById("viewport-drop-overlay");

function isCadFileDrag(e) {
  const types = [...(e.dataTransfer?.types || [])];
  if (!types.includes("Files")) return false;
  const items = [...(e.dataTransfer?.items || [])];
  if (!items.length) return true;
  return items.some((item) => {
    if (item.kind !== "file") return false;
    const file = item.getAsFile?.();
    if (file?.name && isViewportImportFile(file.name)) return true;
    if (!item.type) return true;
    return /model|mesh|octet|zip|step|stl|gltf|3mf|dxf/i.test(item.type);
  });
}

function isArchitectModuleDrag(e) {
  return [...(e.dataTransfer?.types || [])].includes("application/render3d-architect-module");
}

function droppedArchitectModuleKind(e) {
  try {
    const raw = e.dataTransfer?.getData("application/render3d-architect-module");
    return raw ? JSON.parse(raw)?.kind || "" : "";
  } catch {
    return "";
  }
}

function viewportGridPointForEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const point = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, point)) return null;
  const grid = architectGridModelUnits();
  point.x = Math.round(point.x / grid) * grid;
  point.y = Math.round(point.y / grid) * grid;
  point.z = 0;
  return point;
}

function isDesignLikeWorkspaceMode() {
  const mode = workspaceModes?.getMode?.() || "design";
  return mode === "design" || mode === "architect";
}

function clearViewportDropOverlay() {
  viewportDragDepth = 0;
  viewport.classList.remove("viewport-drag-over");
  viewportDropOverlay?.classList.add("hidden");
}

viewport.addEventListener("dragenter", (e) => {
  if (!isDesignLikeWorkspaceMode()) return;
  if (!isCadFileDrag(e)) return;
  e.preventDefault();
  viewportDragDepth += 1;
  viewport.classList.add("viewport-drag-over");
  viewportDropOverlay?.classList.remove("hidden");
});
viewport.addEventListener("dragleave", (e) => {
  if (!isDesignLikeWorkspaceMode()) return;
  if (!isCadFileDrag(e)) return;
  if (e.currentTarget.contains(e.relatedTarget)) return;
  viewportDragDepth = Math.max(0, viewportDragDepth - 1);
  if (viewportDragDepth === 0) {
    clearViewportDropOverlay();
  }
});
viewport.addEventListener("dragover", (e) => {
  if (!isDesignLikeWorkspaceMode()) return;
  if (!isCadFileDrag(e) && !isExplorerComponentDrag(e) && !isArchitectModuleDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
viewport.addEventListener("drop", async (e) => {
  if (isArchitectModuleDrag(e)) {
    e.preventDefault();
    clearViewportDropOverlay();
    if (!isDesignLikeWorkspaceMode()) return;
    const kind = droppedArchitectModuleKind(e) || "wall";
    const obj = placeArchitectModuleInstant(kind);
    const point = viewportGridPointForEvent(e);
    if (obj && point) {
      obj.position.copy(point);
      showObjectGizmo(obj, "translate", { switchTab: false });
      setEditStatus("ok", `Dropped ${kind} on the grid. Drag or Snap Grid to lock it into place.`);
    }
    closeArchitectLibrary();
    return;
  }
  if (isExplorerComponentDrag(e)) {
    e.preventDefault();
    clearViewportDropOverlay();
    if (!isDesignLikeWorkspaceMode()) return;
    const payload = droppedExplorerRefs(e)[0];
    if (!payload?.projectId || !payload?.filename) {
      setEditStatus("error", "This Fusion item is only a reference right now; sync/import it before dropping into the viewport.");
      return;
    }
    try {
      await openProjectById(payload.projectId);
      const beforeDropState = captureViewportAssemblyState();
      const selectedBeforeDrop = selectedObjectFilename();
      const data = await api(`/api/projects/${encodeURIComponent(payload.projectId)}`);
      const browserComponents = normalizeBrowser(data).components || [];
      const compCandidates = [
        ...browserComponents,
        ...browserComponents.flatMap((entry) => entry.children || []),
      ];
      const comp = compCandidates.find((entry) =>
        entry.name === payload.filename || entry.viewer_filename === payload.filename || entry.filename === payload.filename
      );
      if (comp) {
        await openBrowserComponent(comp);
        for (const topLevel of browserComponents) {
          if (topLevel.name !== comp.name) setAssemblyComponentVisible(topLevel, false);
        }
        setAssemblyComponentVisible(comp, true);
        selectAssemblyComponent(comp.name, { fitView: true });
        pushViewportUndoAction({
          type: "fusion-component-drop",
          before: beforeDropState,
          selectedBefore: selectedBeforeDrop,
          label: comp.name || payload.name || payload.filename,
        });
      }
    } catch (err) {
      setEditStatus("error", err.message || "Could not open dropped Fusion component.");
    }
    return;
  }
  if (!isCadFileDrag(e)) {
    clearViewportDropOverlay();
    return;
  }
  e.preventDefault();
  clearViewportDropOverlay();
  if (!isDesignLikeWorkspaceMode()) return;
  const files = [...(e.dataTransfer.files || [])].filter((f) => isViewportImportFile(f.name));
  if (!files.length) return;
  try {
    const choice = await askDropDestination(files);
    if (!choice) return;
    await uploadProjectFiles(files, choice);
  } catch (err) {
    alert(err.message || "Upload failed");
  }
});
window.addEventListener("drop", clearViewportDropOverlay, true);
window.addEventListener("dragend", clearViewportDropOverlay, true);
window.addEventListener("blur", clearViewportDropOverlay);
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)) {
    clearViewportDropOverlay();
  }
}, true);

let promptTargetPreview = null;
let promptTargetSearch = "";
let promptTargetSelectedBody = null;
const promptTargetBodyCache = new Map();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  architectSession?.frame?.();
  if (promptTargetPreview?.active) {
    promptTargetPreview.angle += 0.008;
    const center = promptTargetPreview.center;
    const dist = promptTargetPreview.radius;
    camera.position.set(
      center.x + Math.cos(promptTargetPreview.angle) * dist,
      center.y + Math.sin(promptTargetPreview.angle) * dist,
      center.z + dist * 0.42
    );
    controls.target.copy(center);
    camera.lookAt(center);
    controls._eye?.subVectors(camera.position, controls.target);
  }

  // Dynamically adjust clip planes so the camera never clips at any zoom level.
  // near = 0.05% of orbit radius keeps depth-buffer precision while preventing
  // near-plane pop; far = 4000× ensures the grid/far objects stay visible.
  const orbitDist = camera.position.distanceTo(controls.target);
  if (orbitDist > 0) {
    const desiredNear = Math.max(0.0001, orbitDist * 0.0005);
    const desiredFar  = orbitDist * 4000;
    if (
      Math.abs(camera.near - desiredNear) > desiredNear * 0.15 ||
      Math.abs(camera.far  - desiredFar)  > desiredFar  * 0.15
    ) {
      camera.near = desiredNear;
      camera.far  = desiredFar;
      camera.updateProjectionMatrix();
    }
  }

  const renderCam = sketchEditor.getRenderCamera?.() || camera;
  renderer.render(scene, renderCam);
  viewCube.update();
  collab?.renderLabels(renderCam);
}
animate();

function clearModelContents() {
  cancelLasso();
  directModeling.reset();
  projectAssembly.clear();
  sketchEditor.clearViewportSketches?.();
    currentMesh = null;
  transformControls.detach();
  gizmoPanel.hide();
  objectTools?.clearSelection?.();
  clearHover();
  rebuildGrid();
}

function clearModel() {
  loadModelGeneration += 1;
  clearModelContents();
}

function resetComposerForProject() {
  restoringModelPromptState = true;
  composer.setPromptText?.("");
  composer.replaceReferences([]);
  resetRefCounter();
  restoringModelPromptState = false;
  promptImages = [];
  renderPromptImages();
  sendCollabPresence();
  saveActiveModelPromptState();
}

function showEmptyProjectViewport({ keepBrowser = false } = {}) {
  selectedFile = null;
  clearModel();
  resetComposerForProject();
  const list = document.getElementById("file-list");
  if (list) list.innerHTML = "";
  if (!keepBrowser) {
    projectTree.render({ components: [], sketches: [], wiring: [] });
  }
  timeline.setTimeline({ entries: [], current_index: -1 });
  objectHistory.render([]);
  promptHistory.render([]);
  promptHistory.setCountBadge(0);
  controls.target.set(0, 0, 0);
  fitCamera();
}

function prepareViewportForModels() {
  if (sketchEditor.isActive?.()) sketchEditor.cancel();
  setSketchModelDim(false);
  document.getElementById("app")?.classList.remove("sketch-editing");
  updateSketchChrome({ visible: false });
  controls.enabled = true;
}

function fileStem(name) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

let objectIterationPopover = null;

function formatHistoryWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

function selectedPartFilterName() {
  const selection = objectTools.getSelection?.();
  const bodyName = selection?.label || promptTargetSelectedBody?.bodyName || null;
  if (bodyName && !/^body\s+\d+$/i.test(String(bodyName))) return bodyName;
  return null;
}

function closeObjectIterationTree() {
  objectIterationPopover?.remove();
  objectIterationPopover = null;
  document.getElementById("btn-history-tree")?.setAttribute("aria-pressed", "false");
}

function timelineParentFilename(entry) {
  const meta = entry?.meta || {};
  return meta.parent || meta.replace_catalog || meta.replaceCatalog || meta.source_file || null;
}

function timelineKindLabel(kind) {
  return {
    upload: "Upload",
    prompt: "AI",
    build: "Build",
    restore: "Restore",
    transform: "Move",
    body_transform: "Body move",
    extrude: "Extrude",
    face_pull: "Press-pull",
    fillet: "Fillet",
    chamfer: "Chamfer",
    mirror: "Mirror",
    hole: "Hole",
    paint: "Paint",
    mesh_cleanup: "Mesh cleanup",
    delete_object: "Delete",
  }[kind] || (kind ? String(kind).replace(/_/g, " ") : "Change");
}

function relatedTimelineIterations(filename) {
  const entries = timelineData?.entries || [];
  if (!entries.length) return [];
  const related = new Set([filename].filter(Boolean));
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of entries) {
      const child = entry.filename || null;
      const parent = timelineParentFilename(entry);
      if ((child && related.has(child)) || (parent && related.has(parent))) {
        for (const name of [child, parent]) {
          if (name && !related.has(name)) {
            related.add(name);
            changed = true;
          }
        }
      }
    }
  }
  return entries.filter((entry) => {
    const child = entry.filename || null;
    const parent = timelineParentFilename(entry);
    return (child && related.has(child)) || (parent && related.has(parent));
  });
}

function objectIterationTreeHtml(filename) {
  const entries = relatedTimelineIterations(filename);
  const current = timelineData?.current_index ?? -1;
  if (!entries.length) {
    return `<div class="object-iteration-empty">Version history will appear here after you apply a size change, upload, generate, or edit this object.</div>`;
  }
  return entries
    .map((entry, idx) => {
      const index = entry.index ?? idx;
      const parent = timelineParentFilename(entry);
      const filenameLabel = entry.filename ? fileStem(entry.filename) : "project";
      const parentLabel = parent && parent !== entry.filename ? `from ${fileStem(parent)}` : "";
      const active = index === current;
      const label = entry.label || timelineKindLabel(entry.kind);
      const when = formatHistoryWhen(entry.created_at);
      const meta = [timelineKindLabel(entry.kind), when, parentLabel].filter(Boolean).join(" · ");
      return `<div class="object-iteration-node${active ? " active" : ""}" data-index="${index}">
        <span class="object-iteration-rail" aria-hidden="true"></span>
        <div class="object-iteration-card">
          <div class="object-iteration-main">
            <span class="object-iteration-badge">#${index + 1}</span>
            <span class="object-iteration-title">${appEscapeHtml(label)}</span>
            ${active ? '<span class="object-iteration-current">Current</span>' : ""}
          </div>
          <div class="object-iteration-meta">${appEscapeHtml(filenameLabel)}${meta ? ` · ${appEscapeHtml(meta)}` : ""}</div>
          <div class="object-iteration-actions">
            <button type="button" class="btn secondary btn-compact" data-history-view="${index}">View</button>
            <button type="button" class="btn secondary btn-compact" data-history-latest="${index}">Make latest</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function objectResizeTarget(filename) {
  const selection = objectTools.getSelection?.();
  const catalogName = selection?.catalogName || filename;
  const root = catalogName ? projectAssembly.get(catalogName) : (selection?.root || null);
  const mesh = selection?.mesh || firstPromptTargetMesh(root);
  if (!root || !mesh) return null;
  const bodyIndex = Number.isInteger(selection?.bodyIndex) ? selection.bodyIndex : null;
  const bodyInfo = objectTools.getBodyInfo?.();
  const box = bodyIndex != null && mesh?.isMesh && (bodyInfo?.count || 0) > 1
    ? bodyBoundsForMesh(mesh, bodyIndex, bodyInfo)
    : new THREE.Box3().setFromObject(selection?.root || root);
  if (!box || box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const label = bodyIndex != null && (bodyInfo?.count || 0) > 1
    ? (bodyInfo.body_names?.[bodyIndex] || `Body ${bodyIndex + 1}`)
    : fileStem(catalogName || filename);
  return {
    filename: catalogName || filename,
    bodyIndex,
    bodyCount: bodyInfo?.count || 1,
    label,
    size,
  };
}

function bodyBoundsForMesh(mesh, bodyIndex, bodyInfo) {
  if (!mesh?.isMesh || !mesh.geometry?.attributes?.position || !bodyInfo?.face_offsets?.length) {
    return new THREE.Box3().setFromObject(mesh);
  }
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const index = geom.index;
  const faceCount = geom.index ? Math.floor(geom.index.count / 3) : Math.floor(pos.count / 3);
  const start = Math.max(0, bodyInfo.face_offsets[bodyIndex] ?? 0);
  const end = Math.min(bodyInfo.face_offsets[bodyIndex + 1] ?? faceCount, faceCount);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let fi = start; fi < end; fi += 1) {
    for (let j = 0; j < 3; j += 1) {
      const vi = index ? index.getX(fi * 3 + j) : fi * 3 + j;
      v.fromBufferAttribute(pos, vi);
      mesh.localToWorld(v);
      box.expandByPoint(v);
    }
  }
  return box.isEmpty() ? new THREE.Box3().setFromObject(mesh) : box;
}

function objectSizeControlsHtml(filename) {
  const target = objectResizeTarget(filename);
  if (!target) {
    return `<section class="object-size-panel">
      <strong>Generative Size Controls</strong>
      <p class="object-size-hint">Select an object or body in the viewport, then use this panel to adjust width, depth, and height.</p>
    </section>`;
  }
  const dims = [
    ["width", "Width", target.size.x],
    ["depth", "Depth", target.size.y],
    ["height", "Height", target.size.z],
  ];
  const rows = dims.map(([axis, label, value]) => {
    const base = Math.max(0.01, value);
    const min = Math.max(0.1, base * 0.2);
    const max = Math.max(base * 2.5, min + 1);
    return `<label class="object-size-row" data-axis="${axis}">
      <span>${label}</span>
      <input type="range" min="${min.toFixed(2)}" max="${max.toFixed(2)}" step="0.1" value="${base.toFixed(2)}" data-size-range="${axis}" data-base="${base.toFixed(6)}" />
      <input type="number" min="0.1" step="0.1" value="${base.toFixed(2)}" data-size-number="${axis}" />
      <em>mm</em>
    </label>`;
  }).join("");
  return `<section class="object-size-panel" data-resize-filename="${appEscapeHtml(target.filename)}" data-resize-body="${target.bodyIndex ?? ""}">
    <div class="object-size-head">
      <div>
        <strong>Generative Size Controls</strong>
        <span>${appEscapeHtml(target.label)} · ${target.bodyCount > 1 && target.bodyIndex != null ? "selected body" : "selected object"}</span>
      </div>
      <button type="button" class="btn secondary btn-compact" data-size-reset>Reset</button>
    </div>
    ${rows}
    <label class="object-size-row object-size-row--uniform">
      <span>Overall</span>
      <input type="range" min="20" max="250" step="1" value="100" data-size-uniform />
      <input type="number" min="1" step="1" value="100" data-size-uniform-number />
      <em>%</em>
    </label>
    <div class="object-size-actions">
      <button type="button" class="btn accent btn-compact" data-size-apply>Apply size change</button>
      <small>Drag for live preview; release to bake the size into the model.</small>
    </div>
  </section>`;
}

function bindObjectSizeControls(pop, filename) {
  const panel = pop.querySelector(".object-size-panel[data-resize-filename]");
  if (!panel) return;
  let applyTimer = null;
  let applying = false;
  let queued = false;
  let lastAppliedKey = "";
  let previewObj = null;
  let previewBaseScale = null;
  const originalBases = {
    width: Number(panel.querySelector('[data-size-range="width"]')?.dataset.base),
    depth: Number(panel.querySelector('[data-size-range="depth"]')?.dataset.base),
    height: Number(panel.querySelector('[data-size-range="height"]')?.dataset.base),
  };

  const syncNumber = (axis, value) => {
    const num = panel.querySelector(`[data-size-number="${axis}"]`);
    if (num) num.value = Number(value).toFixed(2);
  };
  const syncRange = (axis, value) => {
    const range = panel.querySelector(`[data-size-range="${axis}"]`);
    if (range) range.value = String(value);
  };
  const currentSizeValues = () => ["width", "depth", "height"].map((axis) => Number(panel.querySelector(`[data-size-number="${axis}"]`)?.value));

  const ensurePreviewObj = () => {
    const target = objectResizeTarget(filename);
    if (!target) return null;
    const obj = projectAssembly.get(target.filename);
    if (!obj) return null;
    if (previewObj !== obj) {
      previewObj = obj;
      previewBaseScale = obj.scale.clone();
    }
    return previewObj;
  };

  const applyLivePreview = () => {
    const obj = ensurePreviewObj();
    if (!obj || !previewBaseScale) return;
    const values = currentSizeValues();
    if (!values.every((value) => Number.isFinite(value) && value > 0)) return;
    const bases = [originalBases.width, originalBases.depth, originalBases.height].map((v) => Math.max(0.01, Number(v) || 0.01));
    obj.scale.set(
      previewBaseScale.x * (values[0] / bases[0]),
      previewBaseScale.y * (values[1] / bases[1]),
      previewBaseScale.z * (values[2] / bases[2])
    );
  };

  const resetLivePreview = () => {
    if (previewObj && previewBaseScale) previewObj.scale.copy(previewBaseScale);
  };

  const applySizeChange = async (status = "Applying size change...") => {
    if (applying) {
      queued = true;
      return;
    }
    const target = objectResizeTarget(filename);
    if (!target) {
      setEditStatus("error", "Select an object or body first.");
      return;
    }
    const values = currentSizeValues();
    if (!values.every((value) => Number.isFinite(value) && value > 0)) return;
    // Scale against the panel's original bases (file geometry), not the live-preview bounds.
    const bases = [originalBases.width, originalBases.depth, originalBases.height].map((v) => Math.max(0.01, Number(v) || 0.01));
    const scale = values.map((value, idx) => value / bases[idx]);
    const valueKey = `${target.filename}:${target.bodyIndex ?? "all"}:${scale.map((v) => v.toFixed(4)).join(":")}`;
    if (valueKey === lastAppliedKey) return;
    applying = true;
    const applyBtn = panel.querySelector("[data-size-apply]");
    if (applyBtn) applyBtn.disabled = true;
    setEditStatus("loading", status);
    // Reset viewport preview so the reloaded baked mesh isn't double-scaled.
    resetLivePreview();
    try {
      const endpoint = target.bodyCount > 1 && target.bodyIndex != null
        ? `/api/projects/${projectId}/files/${encodeURIComponent(target.filename)}/transform-body`
        : `/api/projects/${projectId}/files/${encodeURIComponent(target.filename)}/transform`;
      const body = target.bodyCount > 1 && target.bodyIndex != null
        ? { body_index: target.bodyIndex, scale }
        : { scale };
      const data = await api(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await afterModelEdit({ ...data, replaceCatalog: target.filename });
      lastAppliedKey = valueKey;
      // Refresh bases to the newly baked size.
      const next = objectResizeTarget(data.filename || target.filename);
      if (next) {
        originalBases.width = next.size.x;
        originalBases.depth = next.size.y;
        originalBases.height = next.size.z;
        ["width", "depth", "height"].forEach((axis, idx) => {
          const range = panel.querySelector(`[data-size-range="${axis}"]`);
          const val = [next.size.x, next.size.y, next.size.z][idx];
          if (range) {
            range.dataset.base = String(val);
            const min = Math.max(0.1, val * 0.2);
            const max = Math.max(val * 2.5, min + 1);
            range.min = String(min);
            range.max = String(max);
            range.value = String(val);
          }
          syncNumber(axis, val);
        });
        const uniform = panel.querySelector("[data-size-uniform]");
        const uniformNumber = panel.querySelector("[data-size-uniform-number]");
        if (uniform) uniform.value = "100";
        if (uniformNumber) uniformNumber.value = "100";
      }
      previewObj = null;
      previewBaseScale = null;
      ensurePreviewObj();
      setEditStatus("ok", `Resized ${target.label}.`);
    } catch (err) {
      setEditStatus("error", err.message || "Could not apply size change.");
      applyLivePreview();
    } finally {
      applying = false;
      if (applyBtn) applyBtn.disabled = false;
      if (queued) {
        queued = false;
        await applySizeChange("Applying latest size change...");
      }
    }
  };

  const scheduleApply = (delayMs = 260) => {
    if (applyTimer) window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(() => {
      applyTimer = null;
      void applySizeChange("Applying size change...");
    }, delayMs);
  };

  panel.querySelectorAll("[data-size-range]").forEach((range) => {
    range.addEventListener("input", () => {
      syncNumber(range.dataset.sizeRange, range.value);
      applyLivePreview();
    });
    range.addEventListener("change", () => scheduleApply(60));
    range.addEventListener("pointerup", () => scheduleApply(40));
  });
  panel.querySelectorAll("[data-size-number]").forEach((num) => {
    num.addEventListener("input", () => {
      syncRange(num.dataset.sizeNumber, num.value);
      applyLivePreview();
    });
    num.addEventListener("change", () => scheduleApply(80));
  });
  const applyUniform = (percent) => {
    const factor = Math.max(0.01, Number(percent || 100) / 100);
    panel.querySelectorAll("[data-size-range]").forEach((range) => {
      const base = Number(range.dataset.base || range.value || 1);
      const next = base * factor;
      range.value = String(next);
      syncNumber(range.dataset.sizeRange, next);
    });
  };
  panel.querySelector("[data-size-uniform]")?.addEventListener("input", (event) => {
    const value = event.currentTarget.value;
    const number = panel.querySelector("[data-size-uniform-number]");
    if (number) number.value = value;
    applyUniform(value);
    applyLivePreview();
  });
  panel.querySelector("[data-size-uniform]")?.addEventListener("change", () => scheduleApply(60));
  panel.querySelector("[data-size-uniform]")?.addEventListener("pointerup", () => scheduleApply(40));
  panel.querySelector("[data-size-uniform-number]")?.addEventListener("input", (event) => {
    const value = event.currentTarget.value;
    const range = panel.querySelector("[data-size-uniform]");
    if (range) range.value = value;
    applyUniform(value);
    applyLivePreview();
  });
  panel.querySelector("[data-size-uniform-number]")?.addEventListener("change", () => scheduleApply(80));
  panel.querySelector("[data-size-reset]")?.addEventListener("click", () => {
    panel.querySelectorAll("[data-size-range]").forEach((range) => {
      const base = Number(range.dataset.base || range.value || 1);
      range.value = String(base);
      syncNumber(range.dataset.sizeRange, base);
    });
    const uniform = panel.querySelector("[data-size-uniform]");
    const uniformNumber = panel.querySelector("[data-size-uniform-number]");
    if (uniform) uniform.value = "100";
    if (uniformNumber) uniformNumber.value = "100";
    resetLivePreview();
  });
  panel.querySelector("[data-size-apply]")?.addEventListener("click", async () => {
    if (applyTimer) {
      window.clearTimeout(applyTimer);
      applyTimer = null;
    }
    await applySizeChange();
  });
}

async function openObjectIterationTree(anchor = document.getElementById("btn-history-tree")) {
  if (objectIterationPopover) {
    closeObjectIterationTree();
    return;
  }
  const filename = selectedObjectFilename();
  if (!projectId || !filename) {
    setEditStatus("error", "Select an object first to view its iteration tree.");
    return;
  }
  const partFilter = selectedPartFilterName();
  const cadParams = await fetchCadParams(rawFetch, projectId, filename, { part: partFilter });
  const pop = document.createElement("div");
  pop.className = "object-iteration-popover";
  pop.innerHTML = `
    <div class="object-iteration-header">
      <div>
        <strong>Object Adjustments</strong>
        <span>${appEscapeHtml(fileStem(filename))}</span>
      </div>
      <button type="button" class="object-iteration-close" aria-label="Close history tree">✕</button>
    </div>
    <div class="object-iteration-list">
      ${cadParamControlsHtml(cadParams, { partLabel: partFilter })}
      ${objectSizeControlsHtml(filename)}
      <div class="object-iteration-history-head">History Tree</div>
      ${objectIterationTreeHtml(filename)}
    </div>
  `;
  document.body.appendChild(pop);
  objectIterationPopover = pop;
  anchor?.setAttribute("aria-pressed", "true");
  const rect = anchor?.getBoundingClientRect?.();
  const top = rect ? rect.bottom + 8 : 72;
  const right = rect ? Math.max(12, window.innerWidth - rect.right) : 16;
  pop.style.top = `${top}px`;
  pop.style.right = `${right}px`;
  pop.querySelector(".object-iteration-close")?.addEventListener("click", closeObjectIterationTree);
  bindCadParamControls(pop, {
    projectId,
    filename,
    part: partFilter,
    initialData: cadParams,
    api,
    rawFetch,
    onStatus: setEditStatus,
    getPreviewRoot: () => {
      const name = selectedObjectFilename() || filename;
      return (name && projectAssembly.get(name)) || currentMesh || null;
    },
    onApplied: async (result) => {
      const reloadName = result?.artifacts?.glb || filename;
      const url = projectFileUrl(projectId, reloadName);
      // Always swap the selected catalog for the rebuilt generative GLB.
      await afterModelEdit({
        filename: reloadName,
        url,
        replaceCatalog: filename,
      });
      featureEditor.setModel(projectId, reloadName);
      selectedFile = reloadName;
    },
  });
  bindObjectSizeControls(pop, filename);
  pop.querySelectorAll("[data-history-view]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const index = parseInt(btn.dataset.historyView, 10);
      closeObjectIterationTree();
      if (!Number.isNaN(index)) await restoreTimeline(index);
    });
  });
  pop.querySelectorAll("[data-history-latest]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const index = parseInt(btn.dataset.historyLatest, 10);
      closeObjectIterationTree();
      if (!Number.isNaN(index)) await restoreTimelineAsLatest(index);
    });
  });
  setTimeout(() => {
    document.addEventListener("mousedown", function onDocClick(event) {
      if (objectIterationPopover && !objectIterationPopover.contains(event.target) && !anchor?.contains?.(event.target)) {
        closeObjectIterationTree();
      } else if (objectIterationPopover) {
        document.addEventListener("mousedown", onDocClick, { once: true });
      }
    }, { once: true });
  }, 0);
}

async function loadSimForFile(filename) {
  currentSim = null;
  if (!projectId) return null;

  const stems = new Set();
  if (filename) stems.add(fileStem(filename));
  for (const [name] of projectAssembly.list()) {
    const safeName = String(name || "");
    if (safeName.toLowerCase().endsWith(".glb")) stems.add(fileStem(safeName));
  }

  for (const stem of stems) {
    try {
      const res = await rawFetch(
        `/api/projects/${projectId}/files/${encodeURIComponent(`${stem}.sim.json`)}`
      );
      if (!res.ok) continue;
      const sim = await res.json();
      const parts = sim?.parts || [];
      const joints = sim?.joints || [];
      if (parts.length || joints.length) {
        currentSim = sim;
        if (riggingEditor.isActive?.()) riggingEditor.refreshMeshBindings?.();
        return currentSim;
      }
    } catch {
      /* try next stem */
    }
  }
  return null;
}

function primaryViewportComponent(comps = [], latestFile = null) {
  const auto = comps.filter((c) => c.auto_load === true);
  const assembly = auto.find((c) => c.primary) || comps.find((c) => c.primary);
  if (latestFile) {
    const latestStem = fileStem(latestFile).replace(/_edited(?:_\d+)?$/i, "");
    const latest =
      auto.find((c) => c.name === latestFile || c.viewer_filename === latestFile) ||
      comps.find((c) => c.name === latestFile || c.viewer_filename === latestFile) ||
      auto.find((c) => c.stem === latestStem || fileStem(c.name) === latestStem) ||
      comps.find((c) => c.stem === latestStem || fileStem(c.name) === latestStem);
    // Timeline/latest-file already resolves prompt artifacts back to the primary
    // assembly on the backend. If it names a real transformed mesh, prefer it so
    // applied gizmo rotations/moves persist after refresh.
    if (latest) {
      if (latest.name !== latestFile && latest.viewer_filename !== latestFile && /\.(glb|gltf|stl|obj|ply|off)$/i.test(latestFile)) {
        return { ...latest, name: latestFile, viewer_filename: latestFile };
      }
      return latest;
    }
  }
  return assembly || auto[0] || comps[0] || null;
}

function componentsAlreadyLoaded(comps = [], latestFile = null) {
  const primary = primaryViewportComponent(comps, latestFile);
  return primary ? projectAssembly.has(primary.name) : false;
}

function modelMatchesSelection(viewFilename, catalogName) {
  const sel = catalogName || selectedFile;
  if (!sel) return true;
  if (viewFilename === sel) return true;
  return fileStem(viewFilename) === fileStem(sel);
}

function hasBakedPlacement(filenameOrEntry) {
  if (filenameOrEntry && typeof filenameOrEntry === "object" && filenameOrEntry.baked_placement) return true;
  const name = typeof filenameOrEntry === "string" ? filenameOrEntry : filenameOrEntry?.name || filenameOrEntry?.viewer_filename || "";
  return /(?:_edited(?:_\d+)?|_copy\d*|component_mounting_fixture)\.(glb|gltf|stl|obj|ply|off)$/i.test(String(name || ""));
}

function isFixtureArtifactFilename(name) {
  return /component_mounting_fixture|fixture_base|mounting_plate|mount_plate/i.test(String(name || ""));
}

function getPromptTargetMode() {
  return document.getElementById("prompt-target-mode")?.value === "edit" ? "edit" : "new";
}

function visiblePromptTargetEntries() {
  const entries = (projectTree.getComponents?.() || [])
    .filter((entry) => entry?.name && !isBrowserComponentHidden(entry) && !isFixtureArtifactFilename(entry.name));
  if (
    selectedFile
    && !entries.some((entry) => entry.name === selectedFile)
    && !isComponentHidden(selectedFile)
    && !isFixtureArtifactFilename(selectedFile)
  ) {
    entries.unshift({
      name: selectedFile,
      stem: fileStem(selectedFile),
      viewer_filename: selectedFile,
    });
  }
  return entries;
}

function promptTargetEntryLabel(entry) {
  return entry?.stem || fileStem(entry?.name || "") || entry?.name || "Object";
}

function promptTargetEntrySubtitle(entry) {
  const fmt = String(entry?.format || entry?.name?.split(".").pop() || "model").toUpperCase();
  const viewer = entry?.viewer_filename && entry.viewer_filename !== entry.name
    ? ` - view ${entry.viewer_filename.split(".").pop()?.toUpperCase()}`
    : "";
  const obj = projectAssembly.get(entry?.name);
  if (!obj) return `${fmt}${viewer}`;
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return `${fmt}${viewer}`;
  const size = box.getSize(new THREE.Vector3());
  const dims = [size.x, size.y, size.z].map((v) => Math.max(0, v).toFixed(v >= 10 ? 0 : 1)).join(" x ");
  return `${fmt}${viewer} - ${dims} mm`;
}

function promptTargetBodyInfo(entry) {
  return promptTargetBodyCache.get(entry?.name)?.data || null;
}

async function loadPromptTargetBodyInfo(entry) {
  if (!projectId || !entry?.name) return null;
  const cached = promptTargetBodyCache.get(entry.name);
  if (cached?.data || cached?.promise) return cached.data || cached.promise;
  const promise = api(`/api/projects/${projectId}/files/${encodeURIComponent(entry.name)}/bodies`)
    .then((data) => {
      promptTargetBodyCache.set(entry.name, { data });
      return data;
    })
    .catch(() => {
      promptTargetBodyCache.set(entry.name, { data: null });
      return null;
    });
  promptTargetBodyCache.set(entry.name, { promise });
  return promise;
}

function refreshPromptTargetBodies(entries = visiblePromptTargetEntries()) {
  const popup = document.getElementById("prompt-target-popup");
  if (!popup || popup.classList.contains("hidden")) return;
  entries.forEach((entry) => {
    if (promptTargetBodyCache.has(entry.name)) return;
    void loadPromptTargetBodyInfo(entry).then(() => {
      if (!popup.classList.contains("hidden")) {
        renderPromptTargetPopup();
        positionPromptTargetPopup();
      }
    });
  });
}

function promptTargetBodies(entry) {
  const info = promptTargetBodyInfo(entry);
  const count = Number(info?.count) || 0;
  if (count <= 1) return [];
  return Array.from({ length: count }, (_, index) => ({
    index,
    name: info?.body_names?.[index] || `Body ${index + 1}`,
  }));
}

function promptTargetSearchText(entry) {
  const bodyNames = promptTargetBodies(entry).map((body) => body.name).join(" ");
  return `${entry?.name || ""} ${entry?.stem || ""} ${promptTargetEntryLabel(entry)} ${promptTargetEntrySubtitle(entry)} ${bodyNames}`.toLowerCase();
}

function visiblePromptTargetEntriesForSearch(entries) {
  const query = promptTargetSearch.trim().toLowerCase();
  if (!query) return entries;
  return entries.filter((entry) => promptTargetSearchText(entry).includes(query));
}

function firstPromptTargetMesh(root) {
  let found = null;
  root?.traverse?.((child) => {
    if (!found && child.isMesh && child.geometry && !child.userData?.isEdge && !child.userData?.isSilhouette) {
      found = child;
    }
  });
  return found || (root?.isMesh ? root : null);
}

function selectedPromptTargetBodyRef() {
  if (getPromptTargetMode() !== "edit" || !promptTargetSelectedBody?.filename) return null;
  const filename = promptTargetSelectedBody.filename;
  const stem = fileStem(filename);
  return {
    id: `component:${projectId || "project"}:${filename}:body:${promptTargetSelectedBody.bodyIndex}`,
    type: "component",
    token: compactComponentToken(`${stem}-body-${Number(promptTargetSelectedBody.bodyIndex) + 1}`),
    label: promptTargetSelectedBody.bodyName || `Body ${Number(promptTargetSelectedBody.bodyIndex) + 1}`,
    filename,
    stem,
    format: filename.split(".").pop(),
    viewer_filename: filename,
    projectId,
    body_index: promptTargetSelectedBody.bodyIndex,
    body_name: promptTargetSelectedBody.bodyName,
  };
}

function selectedPromptTargetObjectRef() {
  if (getPromptTargetMode() !== "edit") return null;
  const filename = promptBaseFilename();
  if (!filename) return null;
  const stem = fileStem(filename);
  const entry = visiblePromptTargetEntries().find((item) => item.name === filename || item.viewer_filename === filename);
  return {
    id: `component:${projectId || "project"}:${filename}:object`,
    type: "component",
    token: compactComponentToken(stem),
    label: entry ? promptTargetEntryLabel(entry) : stem,
    filename,
    stem,
    format: filename.split(".").pop(),
    viewer_filename: entry?.viewer_filename || filename,
    projectId,
  };
}

function promptReferencesForSubmit() {
  const refs = composer.getReferences();
  const bodyRef = selectedPromptTargetBodyRef();
  const objectRef = selectedPromptTargetObjectRef();
  const additions = [objectRef, bodyRef].filter(Boolean);
  if (!additions.length) return refs;
  const existingIds = new Set(refs.map((ref) => ref.id));
  return [...refs, ...additions.filter((ref) => !existingIds.has(ref.id))];
}

function promptTargetColor(entry) {
  const seed = String(entry?.name || entry?.stem || "object");
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return ["#58a6ff", "#3fb950", "#d29922", "#a371f7", "#f778ba", "#56d4dd"][hash % 6];
}

function drawPromptTargetThumb(canvas, entry, active = false) {
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const w = 68;
  const h = 52;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const accent = promptTargetColor(entry);
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, active ? "rgba(88,166,255,0.28)" : "rgba(88,166,255,0.12)");
  grad.addColorStop(1, "rgba(13,17,23,0.92)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = active ? "#58a6ff" : "rgba(139,148,158,0.35)";
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  let sx = 34;
  let sy = 20;
  let sz = 16;
  const obj = projectAssembly.get(entry?.name);
  if (obj) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const max = Math.max(size.x, size.y, size.z, 1);
      sx = Math.max(10, (size.x / max) * 38);
      sy = Math.max(8, (size.y / max) * 24);
      sz = Math.max(8, (size.z / max) * 28);
    }
  }
  const cx = 34;
  const cy = 31;
  const dx = sx * 0.45;
  const dy = sy * 0.35;
  const top = [[cx - dx, cy - sz * 0.5 - dy], [cx, cy - sz * 0.5 - dy * 1.8], [cx + dx, cy - sz * 0.5 - dy], [cx, cy - sz * 0.5]];
  const right = [top[2], [top[2][0], top[2][1] + sz], [top[3][0], top[3][1] + sz], top[3]];
  const left = [top[0], top[3], [top[3][0], top[3][1] + sz], [top[0][0], top[0][1] + sz]];
  const poly = (pts, fill) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.stroke();
  };
  poly(left, "rgba(88,166,255,0.28)");
  poly(right, "rgba(163,113,247,0.22)");
  poly(top, accent);
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "700 10px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(String(entry?.format || entry?.name?.split(".").pop() || "3D").toUpperCase().slice(0, 4), w - 6, h - 6);
}

function renderPromptTargetThumb(target, entry, active = false) {
  if (!target) return;
  target.innerHTML = "";
  if (!entry) return;
  const canvas = document.createElement("canvas");
  drawPromptTargetThumb(canvas, entry, active);
  target.appendChild(canvas);
}

promptTargetPreview = {
  name: null,
  saved: null,
  center: new THREE.Vector3(),
  radius: 1,
  angle: 0,
  active: false,
};

function savePromptTargetPreviewCamera() {
  if (promptTargetPreview.saved) return;
  promptTargetPreview.saved = {
    position: camera.position.clone(),
    target: controls.target.clone(),
    up: camera.up.clone(),
  };
}

function syncControlsAfterCameraMove() {
  camera.lookAt(controls.target);
  controls._up0?.copy(camera.up);
  controls._position0?.copy(camera.position);
  controls._target0?.copy(controls.target);
  controls._eye?.subVectors(camera.position, controls.target);
  controls._lastAngle = 0;
  controls.update();
  viewCube.update?.();
}

function framePromptTargetPreview(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return false;
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size * 0.5, 0.1);
  const halfFovRad = (camera.fov * Math.PI) / 360;
  const dist = Math.max((radius / Math.tan(halfFovRad)) * 1.05, 0.15);
  promptTargetPreview.center.copy(center);
  promptTargetPreview.radius = dist;
  promptTargetPreview.angle = Math.atan2(camera.position.y - center.y, camera.position.x - center.x) || -0.8;
  controls.target.copy(center);
  camera.up.copy(VIEW_CUBE_WORLD_UP);
  camera.position.set(
    center.x + Math.cos(promptTargetPreview.angle) * dist,
    center.y + Math.sin(promptTargetPreview.angle) * dist,
    center.z + dist * 0.42
  );
  syncControlsAfterCameraMove();
  return true;
}

function beginPromptTargetPreview(name) {
  if (!name || promptTargetPreview.name === name) return;
  const obj = projectAssembly.get(name);
  if (!obj) return;
  savePromptTargetPreviewCamera();
  promptTargetPreview.name = name;
  promptTargetPreview.active = framePromptTargetPreview(obj);
  document.querySelectorAll(".prompt-target-card").forEach((card) => {
    card.classList.toggle("previewing", card.dataset.promptTargetName === name);
  });
}

function endPromptTargetPreview({ restore = true } = {}) {
  if (restore && promptTargetPreview.saved) {
    camera.position.copy(promptTargetPreview.saved.position);
    controls.target.copy(promptTargetPreview.saved.target);
    camera.up.copy(promptTargetPreview.saved.up);
    syncControlsAfterCameraMove();
  }
  promptTargetPreview.name = null;
  promptTargetPreview.saved = null;
  promptTargetPreview.active = false;
  document.querySelectorAll(".prompt-target-card.previewing").forEach((card) => card.classList.remove("previewing"));
}

function commitPromptTargetPreview() {
  endPromptTargetPreview({ restore: false });
}

function choosePromptTargetObject(name, bodyIndex = null) {
  if (!name) return;
  const objectSelect = document.getElementById("prompt-target-object");
  if (objectSelect) objectSelect.value = name;
  selectedFile = name;
  projectTree.setSelected(name);
  featureEditor.setModel(projectId, name);
  selectAssemblyComponent(name, { fitView: false });
  if (Number.isInteger(bodyIndex)) {
    const entry = visiblePromptTargetEntries().find((candidate) => candidate.name === name);
    const body = promptTargetBodies(entry).find((candidate) => candidate.index === bodyIndex);
    promptTargetSelectedBody = {
      filename: name,
      bodyIndex,
      bodyName: body?.name || `Body ${bodyIndex + 1}`,
    };
    const root = projectAssembly.get(name) || currentMesh;
    const mesh = firstPromptTargetMesh(root);
    if (mesh && root) {
      objectTools.selectObject?.({ mesh, root, bodyIndex, catalogName: name });
    }
    setEditStatus("ok", `Editing ${promptTargetSelectedBody.bodyName} in ${promptTargetEntryLabel(entry)}.`);
  } else {
    promptTargetSelectedBody = null;
  }
  commitPromptTargetPreview();
  closePromptTargetPopup({ restorePreview: false });
  syncPromptTargetUI();
}

function closePromptTargetPopup({ restorePreview = true } = {}) {
  if (restorePreview) endPromptTargetPreview();
  const popup = document.getElementById("prompt-target-popup");
  const trigger = document.getElementById("prompt-target-picker-btn");
  popup?.classList.add("hidden");
  trigger?.setAttribute("aria-expanded", "false");
}

function positionPromptTargetPopup() {
  const popup = document.getElementById("prompt-target-popup");
  const trigger = document.getElementById("prompt-target-picker-btn");
  if (!popup || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 18);
  let left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width));
  let top = rect.bottom + 8;
  const height = Math.min(520, popup.offsetHeight || 420);
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
  popup.style.width = `${width}px`;
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function renderPromptTargetPopup() {
  const popup = document.getElementById("prompt-target-popup");
  if (!popup) return;
  const allEntries = visiblePromptTargetEntries();
  const entries = visiblePromptTargetEntriesForSearch(allEntries);
  const current = document.getElementById("prompt-target-object")?.value || selectedFile || entries[0]?.name || "";
  popup.innerHTML = "";
  const header = document.createElement("div");
  header.className = "prompt-target-popup-header";
  header.innerHTML = `<div><strong>Select object/body to edit</strong><span>Search components and bodies. Hover a component to preview it.</span></div><button type="button" class="prompt-target-popup-close" aria-label="Close">x</button>`;
  header.querySelector("button")?.addEventListener("click", closePromptTargetPopup);
  popup.appendChild(header);
  const searchWrap = document.createElement("div");
  searchWrap.className = "prompt-target-search";
  searchWrap.innerHTML = `
    <span aria-hidden="true">⌕</span>
    <input type="search" id="prompt-target-search-input" placeholder="Search bodies, objects, filenames..." value="${appEscapeHtml(promptTargetSearch)}" />
    ${promptTargetSearch ? '<button type="button" class="prompt-target-search-clear" aria-label="Clear search">x</button>' : ""}
  `;
  const searchInput = searchWrap.querySelector("input");
  searchInput?.addEventListener("input", (event) => {
    promptTargetSearch = event.currentTarget.value;
    renderPromptTargetPopup();
    positionPromptTargetPopup();
    requestAnimationFrame(() => {
      const next = document.getElementById("prompt-target-search-input");
      next?.focus();
      next?.setSelectionRange(promptTargetSearch.length, promptTargetSearch.length);
    });
  });
  searchWrap.querySelector(".prompt-target-search-clear")?.addEventListener("click", () => {
    promptTargetSearch = "";
    renderPromptTargetPopup();
    positionPromptTargetPopup();
    requestAnimationFrame(() => document.getElementById("prompt-target-search-input")?.focus());
  });
  popup.appendChild(searchWrap);
  const list = document.createElement("div");
  list.className = "prompt-target-popup-list";
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "prompt-target-popup-empty";
    empty.textContent = allEntries.length
      ? "No matching objects or bodies."
      : "No visible objects available. Show a component in the Browser first.";
    list.appendChild(empty);
  }
  for (const entry of entries) {
    const selectedBodyMatches = promptTargetSelectedBody?.filename === entry.name;
    const active = entry.name === current && !selectedBodyMatches;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `prompt-target-card${active ? " active" : ""}`;
    btn.dataset.promptTargetName = entry.name;
    btn.title = entry.name;
    const thumb = document.createElement("span");
    thumb.className = "prompt-target-card-thumb";
    renderPromptTargetThumb(thumb, entry, active);
    const info = document.createElement("span");
    info.className = "prompt-target-card-info";
    const name = document.createElement("strong");
    name.textContent = promptTargetEntryLabel(entry);
    const meta = document.createElement("small");
    meta.textContent = promptTargetEntrySubtitle(entry);
    const file = document.createElement("em");
    file.textContent = entry.name;
    info.append(name, meta, file);
    const check = document.createElement("span");
    check.className = "prompt-target-card-check";
    check.textContent = active ? "Selected" : "Choose";
    btn.append(thumb, info, check);
    list.appendChild(btn);
    const bodies = promptTargetBodies(entry);
    if (bodies.length) {
      const bodyWrap = document.createElement("div");
      bodyWrap.className = "prompt-target-body-list";
      bodies.forEach((body) => {
        const bodyActive = promptTargetSelectedBody?.filename === entry.name && promptTargetSelectedBody?.bodyIndex === body.index;
        const bodyBtn = document.createElement("button");
        bodyBtn.type = "button";
        bodyBtn.className = `prompt-target-body-card${bodyActive ? " active" : ""}`;
        bodyBtn.dataset.promptTargetName = entry.name;
        bodyBtn.dataset.promptTargetBodyIndex = String(body.index);
        bodyBtn.innerHTML = `
          <span class="prompt-target-body-badge">Body ${body.index + 1}</span>
          <span class="prompt-target-body-name">${appEscapeHtml(body.name)}</span>
          <span class="prompt-target-body-action">${bodyActive ? "Selected" : "Edit body"}</span>
        `;
        bodyWrap.appendChild(bodyBtn);
      });
      list.appendChild(bodyWrap);
    } else if (!promptTargetBodyCache.get(entry.name)) {
      const loading = document.createElement("div");
      loading.className = "prompt-target-body-loading";
      loading.textContent = "Checking bodies...";
      list.appendChild(loading);
    }
  }
  popup.appendChild(list);
  refreshPromptTargetBodies(allEntries);
}

function openPromptTargetPopup() {
  const popup = document.getElementById("prompt-target-popup");
  const trigger = document.getElementById("prompt-target-picker-btn");
  if (!popup || !trigger) return;
  renderPromptTargetPopup();
  popup.classList.remove("hidden");
  trigger.setAttribute("aria-expanded", "true");
  positionPromptTargetPopup();
}

function togglePromptTargetPopup() {
  const popup = document.getElementById("prompt-target-popup");
  if (!popup || popup.classList.contains("hidden")) openPromptTargetPopup();
  else closePromptTargetPopup();
}

function syncPromptTargetUI() {
  const select = document.getElementById("prompt-target-mode");
  const objectSelect = document.getElementById("prompt-target-object");
  const pickerBtn = document.getElementById("prompt-target-picker-btn");
  const pickerTitle = document.getElementById("prompt-target-picker-title");
  const pickerSubtitle = document.getElementById("prompt-target-picker-subtitle");
  const pickerThumb = document.getElementById("prompt-target-picker-thumb");
  const entries = visiblePromptTargetEntries();
  const targetControlsEnabled = ["standard", "v2", "fusion"].includes(promptMode);
  const canEdit = targetControlsEnabled && entries.length > 0;
  if (select) {
    select.disabled = !targetControlsEnabled;
    select.querySelector("option[value='edit']")?.toggleAttribute("disabled", !canEdit);
    if (!canEdit && select.value === "edit") select.value = "new";
  }
  if (objectSelect) {
    const current = entries.some((entry) => entry.name === objectSelect.value)
      ? objectSelect.value
      : entries.some((entry) => entry.name === selectedFile)
        ? selectedFile
        : entries[0]?.name || "";
    objectSelect.innerHTML = "";
    for (const entry of entries) {
      const option = document.createElement("option");
      option.value = entry.name;
      option.textContent = promptTargetEntryLabel(entry);
      option.title = entry.name;
      objectSelect.appendChild(option);
    }
    objectSelect.value = current;
    objectSelect.disabled = !canEdit || getPromptTargetMode() !== "edit";
    objectSelect.hidden = true;
  }
  const editing = select?.value === "edit" && canEdit;
  const currentEntry = entries.find((entry) => entry.name === objectSelect?.value) || entries[0];
  if (promptTargetSelectedBody && promptTargetSelectedBody.filename !== currentEntry?.name) {
    promptTargetSelectedBody = null;
  }
  if (pickerBtn) {
    pickerBtn.hidden = !editing;
    pickerBtn.disabled = !editing;
  }
  if (pickerTitle) {
    pickerTitle.textContent = editing && currentEntry
      ? (promptTargetSelectedBody?.bodyName || promptTargetEntryLabel(currentEntry))
      : "Select object";
  }
  if (pickerSubtitle) {
    pickerSubtitle.textContent = editing && currentEntry
      ? promptTargetSelectedBody
        ? `${promptTargetEntryLabel(currentEntry)} - body ${Number(promptTargetSelectedBody.bodyIndex) + 1}`
        : promptTargetEntrySubtitle(currentEntry)
      : `${entries.length} visible component${entries.length === 1 ? "" : "s"}`;
  }
  renderPromptTargetThumb(pickerThumb, currentEntry, true);
  if (!editing) closePromptTargetPopup();
  else if (!document.getElementById("prompt-target-popup")?.classList.contains("hidden")) {
    renderPromptTargetPopup();
    positionPromptTargetPopup();
  }
}

function promptBaseFilename({ canvasAttached = false } = {}) {
  if (canvasAttached) return null;
  if (getPromptTargetMode() !== "edit") return null;
  const chosen = document.getElementById("prompt-target-object")?.value || selectedFile;
  if (!chosen || isComponentHidden(chosen) || isFixtureArtifactFilename(chosen)) return null;
  return chosen;
}

function annotatePickedReference(ref) {
  if (!ref || !selectedFile) return ref;
  return {
    ...ref,
    filename: ref.filename || selectedFile,
    viewer_filename: ref.viewer_filename || selectedFile,
    projectId: ref.projectId || projectId,
  };
}

function materializeObject(object3d, { center = true, normalizePivot = center } = {}) {
  object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3d);
  meshCenterOffset = box.getCenter(new THREE.Vector3());
  object3d.userData.meshCenterOffset = meshCenterOffset.clone();
  if (center) {
    // Z-up CAD: sit on XY floor (z = 0), center in X/Y.
    object3d.position.x -= meshCenterOffset.x;
    object3d.position.y -= meshCenterOffset.y;
    object3d.position.z -= box.min.z;
    object3d.updateMatrixWorld(true);
  }
  if (normalizePivot) {
    normalizeObjectPivotToBounds(object3d);
  }
  applyCadStyle(object3d);
  positionShadowFloor(scene, object3d);
  return object3d;
}

function normalizeObjectPivotToBounds(object3d) {
  if (!object3d) return;
  object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3d);
  if (box.isEmpty()) return;

  // STEP/GLB imports can keep geometry far from the scene root origin. Move the
  // root pivot to the visible bounds center, then offset its contents back so
  // the part does not visually move. TransformControls attach to this pivot.
  const pivot = box.getCenter(new THREE.Vector3());
  const delta = pivot.sub(object3d.position);
  if (delta.lengthSq() < 1e-12) return;

  if (object3d.isMesh && object3d.geometry) {
    object3d.geometry.translate(-delta.x, -delta.y, -delta.z);
  } else {
    for (const child of object3d.children) {
      child.position.sub(delta);
    }
  }
  object3d.position.add(delta);
  object3d.updateMatrixWorld(true);
}

function centerAndMaterialize(object3d) {
  return materializeObject(object3d, { center: true });
}

function frameCameraToBox(box) {
  if (!box) return;
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  // Place camera so bounding sphere fills ~55% of viewport height —
  // formula: dist = radius / tan(vFOV/2) × padding
  // With vFOV=50°, tan(25°)≈0.466, radius=size/2, padding=1.35:
  //   dist = (size/2) / 0.466 × 1.35 ≈ size × 1.45  (≈ 2.0 at old default)
  // Using 1.55 here gives comfortable breathing room without dwarfing the model.
  const radius = size / 2;
  const halfFovRad = (camera.fov * Math.PI) / 360;
  const dist = Math.max((radius / Math.tan(halfFovRad)) * 1.55, 0.15);
  camera.up.copy(VIEW_CUBE_WORLD_UP);
  // Fusion-style home: front-right, slightly above, Z stays vertical.
  const viewDir = new THREE.Vector3(1, -1, 0.72).normalize();
  camera.position.copy(center).addScaledVector(viewDir, dist);
  camera.lookAt(center);
  controls._up0?.copy(camera.up);
  controls._position0?.copy(camera.position);
  controls._target0?.copy(controls.target);
  controls._eye?.subVectors(camera.position, controls.target);
  controls._lastAngle = 0;
  controls.update();
  viewCube.update();
}

function fitCamera() {
  const box = projectAssembly.boundingBox() || (currentMesh ? new THREE.Box3().setFromObject(currentMesh) : null);
  frameCameraToBox(box);
}

function fitCameraToComponent(catalogName) {
  const obj = projectAssembly.get(catalogName);
  if (obj) {
    obj.updateMatrixWorld(true);
    frameCameraToBox(new THREE.Box3().setFromObject(obj));
    return;
  }
  fitCamera();
}

function resolveViewerPaths(filename, url) {
  let viewFilename = filename;
  let viewUrl = url;
  const ext = filename.split(".").pop().toLowerCase();
  if (ext === "3mf") {
    viewFilename = filename.replace(/\.3mf$/i, ".glb");
    viewUrl = url.replace(/\/files\/[^/?#]+/, `/files/${encodeURIComponent(viewFilename)}`);
  } else if (ext === "step" || ext === "stp") {
    viewFilename = `${fileStem(filename)}.glb`;
    viewUrl = url.replace(/\/files\/[^/?#]+/, `/files/${encodeURIComponent(viewFilename)}`);
  }
  return { viewFilename, viewUrl };
}

function _apiPath(url) {
  if (!url) return url;
  if (url.startsWith("/")) return url;
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function formatApiDetail(detail, statusText = "", status = 0) {
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (detail && typeof detail === "object") {
    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => item?.msg || item?.message || (typeof item === "string" ? item : ""))
        .filter(Boolean);
      if (parts.length) return parts.join("; ");
    } else if (detail.msg || detail.message) {
      return String(detail.msg || detail.message);
    } else {
      const encoded = JSON.stringify(detail);
      if (encoded && encoded !== "{}" && encoded !== "null") return encoded;
    }
  }
  if (status === 502 || status === 503 || status === 504) {
    return "Server is restarting or busy — wait a few seconds and try Generate again.";
  }
  if (status === 409) {
    return "A generation is already running for this project. Wait for it to finish or cancel it first.";
  }
  return (statusText || "").trim() || "Request failed";
}

function formatUserError(err, fallback = "Something went wrong — check Prompt History or the Activity Log.") {
  if (!err) return fallback;
  if (typeof err === "string" && err.trim()) return err.trim();
  const name = err.name || "";
  const msg = (err.message || "").trim();
  if (name === "AbortError" || /aborted a request/i.test(msg)) {
    if (userCancelRequested) return "Generation canceled.";
    return "Generation was interrupted (page refresh or navigation). The server may still be building — wait a minute, refresh, and check Prompt History before retrying.";
  }
  if (msg === "Failed to fetch" || /networkerror/i.test(msg)) {
    return "Connection lost during generation. The server may still be building — wait a minute, refresh, and check Prompt History before retrying.";
  }
  if (/overloaded|529|rate limit hit \(429\)/i.test(msg)) {
    const cleaned = msg.replace(/^Server error \d+:\s*/i, "").replace(/^\{.*"detail":\s*"([^"]+)".*\}$/s, "$1");
    return cleaned.includes("Anthropic") ? cleaned : "Anthropic's API is temporarily overloaded. Wait a minute and try again, or switch models in the account menu.";
  }
  if (/truncated at token limit|max_output_tokens/i.test(msg)) {
    const cleaned = msg.replace(/^Server error \d+:\s*/i, "").replace(/^\{.*"detail":\s*"([^"]+)".*\}$/s, "$1");
    return cleaned.includes("Try again") ? cleaned : "The AI response was cut off before it finished. Try again or switch to a faster model in the account menu.";
  }
  return msg || fallback;
}

function _cacheBustModelPath(path) {
  if (!path?.startsWith("/api/projects/") || !path.includes("/files/")) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}_=${Date.now()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchModelBlob(path, { retries = 2 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const fetchPath = attempt ? _cacheBustModelPath(path.split("?")[0]) : path;
    const res = await rawFetch(fetchPath);
    if (res.ok) return res.blob();
    const data = await res.json().catch(() => ({}));
    const detail = data.detail;
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail) || res.statusText;
    lastError = new Error(`fetch for "${API}${fetchPath}" responded with ${res.status}: ${msg}`);
    if (![502, 503, 504].includes(res.status) || attempt === retries) break;
    await sleep(350 * (attempt + 1));
  }
  throw lastError || new Error(`Could not fetch model "${API}${path}".`);
}

async function loadModel(url, filename, opts = {}) {
  const expectedProjectId = opts.projectId ?? projectId;
  if (isDxfDrawingFilename(filename)) {
    return openDxfDrawingByName(filename, {
      projectId: expectedProjectId,
      label: opts.label,
    });
  }
  const append = opts.append === true;
  const catalogName = opts.catalogFilename || filename;
  const preservePlacement = opts.preservePlacement === true;
  const replaceCatalog = opts.replaceCatalog || null;
  const gen = ++loadModelGeneration;
  const { viewFilename, viewUrl } = resolveViewerPaths(filename, url);
  const viewExt = viewFilename.split(".").pop().toLowerCase();
  const path = _cacheBustModelPath(_apiPath(viewUrl));
  const blob = await fetchModelBlob(path);
  const blobUrl = URL.createObjectURL(blob);

  let object;
  try {
    if (viewExt === "stl") {
      const geo = new STLLoader().parse(await blob.arrayBuffer());
      geo.computeVertexNormals();
      object = new THREE.Mesh(geo);
    } else if (viewExt === "obj") {
      object = new OBJLoader().parse(await blob.text());
    } else if (viewExt === "glb" || viewExt === "gltf") {
      object = (await new GLTFLoader().loadAsync(blobUrl)).scene;
  } else {
      throw new Error(`Unsupported format: ${viewExt}`);
    }
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  if (gen !== loadModelGeneration || expectedProjectId !== projectId) {
    disposeStyledModel(object);
    return false;
  }
  if (opts.cancelIfSelectionChanged && !append && !modelMatchesSelection(viewFilename, catalogName)) {
    disposeStyledModel(object);
    onStatus?.("error", "Model load cancelled — selection changed.");
    return false;
  }

  // Only wipe the scene if we're doing a full fresh load (not appending or swapping one component).
  if (!append && !replaceCatalog) clearModelContents();

  const shouldCenter = opts.center !== false;
  const shouldNormalizePivot = opts.normalizePivot !== false;
  if (preservePlacement) {
    const saved = opts.savedTransform;
    if (saved) {
      // Restore the previous mesh's exact world transform so the model
      // doesn't jump after a press-pull, fillet, chamfer, etc.
      materializeObject(object, { center: false, normalizePivot: shouldNormalizePivot });
      object.position.copy(saved.position);
      object.quaternion.copy(saved.quaternion);
      object.scale.copy(saved.scale);
    } else {
      // Fallback: re-center (floor-align + X/Y center) so the model
      // sits in the same visual area rather than jumping to raw origin.
      materializeObject(object, { center: shouldCenter, normalizePivot: shouldNormalizePivot });
    }
    object.updateMatrixWorld(true);
  } else {
    materializeObject(object, { center: shouldCenter, normalizePivot: shouldNormalizePivot });
  }
  if (opts.resetTransform) {
    object.position.set(0, 0, 0);
    object.quaternion.set(0, 0, 0, 1);
    object.scale.set(1, 1, 1);
    object.updateMatrixWorld(true);
  }
  projectAssembly.add(catalogName, object);
  if (replaceCatalog && replaceCatalog !== catalogName) {
    projectAssembly.remove(replaceCatalog);
  }
  projectAssembly.setVisible(catalogName, !isComponentHidden(catalogName));
  currentMesh = projectAssembly.getRoot();
  reapplyViewMode(currentMesh);
  positionShadowFloor(scene, currentMesh);
  rebuildGrid();
  featureEditor.setModel(projectId, catalogName);
  objectTools.clearSelection?.();
  void objectTools.refreshBodyInfo?.().catch(() => {});
  if (opts.fitView !== false) {
    fitCameraToComponent(catalogName);
  }

  if (opts.autoGizmo) {
    selectAssemblyComponent(catalogName, { autoGizmo: true, fitView: false });
  } else if (!append) {
  transformControls.detach();
    gizmoPanel.hide();
    document.getElementById("btn-gizmo")?.classList.remove("active");
  }
  safeRestoreActiveModelPromptState();
  collab?.refreshAllRemote(currentMesh);
  const refs = composer.getReferences();
  if (refs?.length || objectTools.getSelection?.()) sendCollabPresence();
  sectionView.onModelChanged?.();
  if (riggingEditor.isActive?.()) {
    void loadSimForFile(catalogName);
  }
  if (opts.autoGizmo) {
    const sel = objectTools.getSelection()?.mesh;
    if (sel) showObjectGizmo(sel, opts.gizmoMode || transformControls.getMode?.() || "translate", { switchTab: false });
  }
  syncExportButton();
  return true;
}

async function rawFetch(path, options = {}, timeoutMs = 200000) {
  const externalSignal = options.signal;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const { signal: _ignored, ...rest } = options;
  const headers = authHeaders(rest.headers || {});
  try {
    return await fetch(`${API}${path}`, { ...rest, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

async function api(path, options = {}, timeoutMs = 200000) {
  const method = options.method || "GET";
  const skipLog = path.startsWith("/api/logs");
  const t0 = performance.now();
  let bodyPreview = "";
  if (options.body && typeof options.body === "string") {
    if (path.includes("diagnose-photo") || options.body.length > 50000) {
      try {
        const parsed = JSON.parse(options.body);
        const imgCount = Array.isArray(parsed?.images) ? parsed.images.length : 0;
        bodyPreview = {
          ...parsed,
          images: imgCount ? `[${imgCount} image(s)]` : parsed?.images,
        };
        if (bodyPreview.client_secret) bodyPreview.client_secret = "[redacted]";
        if (parsed?.images) delete bodyPreview.images?.[0]?.data_url;
      } catch {
        bodyPreview = { note: "large payload", bytes: options.body.length };
      }
    } else {
      try {
        bodyPreview = JSON.parse(options.body);
        if (bodyPreview?.client_secret) bodyPreview.client_secret = "[redacted]";
      } catch {
        bodyPreview = options.body.slice(0, 200);
      }
    }
  }

  if (!skipLog) {
    activityLog.push({
      level: "info",
      message: `→ ${method} ${path}`,
      data: bodyPreview ? { request: bodyPreview } : undefined,
    });
  }

  try {
    const res = await rawFetch(path, options, timeoutMs);
    const data = await res.json().catch(() => ({}));
    const ms = performance.now() - t0;
    const traceId = res.headers.get("X-Trace-Id") || data.trace_id;

    if (!res.ok) {
      const detail = data.detail;
      const msg = formatApiDetail(detail, res.statusText, res.status);
      if (!skipLog) {
        activityLog.push({
          level: "error",
          message: `✗ ${method} ${path} (${res.status})`,
          trace_id: traceId,
          duration_ms: ms,
          status: res.status,
          data: { error: msg, trace_id: traceId, ...data },
        });
      }
      if (!skipLog) activityLog.refreshServerDebounced();
      throw new Error(traceId ? `${msg} [trace #${traceId}]` : msg);
    }

    const logData = { ...data };
    if (logData.trace?.ai?.raw_preview) {
      logData.ai_raw_preview = logData.trace.ai.raw_preview;
    }
    delete logData.trace;

    if (!skipLog) {
      activityLog.push({
        level: "info",
        message: `✓ ${method} ${path}`,
        trace_id: traceId || data.trace_id,
        duration_ms: ms,
        status: res.status,
        data: summarizeResponse(logData),
      });
      if (data.trace) {
        activityLog.push({
          level: "info",
          message: "AI trace",
          trace_id: traceId || data.trace_id,
          data: data.trace,
        });
      }
      activityLog.refreshServerDebounced();
    }
    return data;
  } catch (err) {
    const ms = performance.now() - t0;
    if (err.name === "AbortError") {
      if (userCancelRequested || options.signal?.aborted) {
        activityLog.push({ level: "info", message: `✗ ${method} ${path} (canceled)`, duration_ms: ms });
        throw new Error("Generation canceled.");
      }
      const isPrompt = path.includes("/prompt");
      const msg = isPrompt
        ? "Generation timed out (8 min limit). Try a simpler prompt, disable extra skills, or use fast mode."
        : "Request timed out — is the server running?";
      activityLog.push({ level: "error", message: `✗ ${method} ${path} (timeout)`, duration_ms: ms, data: { error: msg } });
      throw new Error(msg);
    }
    if (err.message === "Failed to fetch") {
      const isPrompt = path.includes("/prompt");
      const msg = isPrompt
        ? "Connection lost during generation (server may have restarted mid-build). Refresh the page and retry — use a simpler prompt if it keeps failing."
        : "Cannot reach server — refresh the page. If it persists, the backend service may need a restart.";
      activityLog.push({ level: "error", message: `✗ ${method} ${path}`, duration_ms: ms, data: { error: msg } });
      throw new Error(msg);
    }
    if (!err.message?.includes("[trace #")) {
      activityLog.push({ level: "error", message: `✗ ${method} ${path}`, duration_ms: ms, data: { error: formatUserError(err) } });
    }
    throw new Error(formatUserError(err));
  }
}

function summarizeResponse(data) {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  if (out.actions) out.actions = `[${out.actions.length} ops]`;
  return out;
}

function formatCostUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function promptKeyOptionValue(source, keyId) {
  return `${source}:${keyId}`;
}

function parsePromptKeyOptionValue(value) {
  if (!value || !String(value).includes(":")) return null;
  const [source, ...rest] = String(value).split(":");
  const keyId = rest.join(":");
  if (!source || !keyId) return null;
  return { source, keyId };
}

function getStoredPromptAiKeyValue() {
  try {
    return localStorage.getItem(LS_PROMPT_AI_KEY) || "";
  } catch {
    return "";
  }
}

function getProjectPromptAiKeyMap() {
  try {
    return JSON.parse(localStorage.getItem(LS_PROJECT_PROMPT_AI_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function getStoredProjectPromptAiKeyValue(pid = projectId) {
  if (!pid) return "";
  const map = getProjectPromptAiKeyMap();
  return typeof map[pid] === "string" ? map[pid] : "";
}

function storeProjectPromptAiKeyValue(value, pid = projectId) {
  if (!pid) return;
  try {
    const map = getProjectPromptAiKeyMap();
    if (value) map[pid] = value;
    else delete map[pid];
    localStorage.setItem(LS_PROJECT_PROMPT_AI_KEY, JSON.stringify(map));
  } catch (_) {}
}

function storePromptAiKeyValue(value, { projectScoped = true } = {}) {
  try {
    if (value) localStorage.setItem(LS_PROMPT_AI_KEY, value);
    else localStorage.removeItem(LS_PROMPT_AI_KEY);
  } catch (_) {}
  if (projectScoped) storeProjectPromptAiKeyValue(value);
}

function defaultPromptKeyValue(status) {
  const eff = status?.effective;
  if (eff?.key_id && eff?.source) {
    return promptKeyOptionValue(eff.source, eff.key_id);
  }
  if (status?.active_key_id) {
    return promptKeyOptionValue("personal", status.active_key_id);
  }
  return "";
}

function getSelectedPromptAiKey() {
  return parsePromptKeyOptionValue(document.getElementById("prompt-ai-key-select")?.value);
}

function getPromptAiKeyBodyFields() {
  const picked = getSelectedPromptAiKey();
  if (!picked?.keyId) return {};
  return { ai_key_id: picked.keyId, ai_key_source: picked.source };
}

function getSelectedPromptAiKeyLabel() {
  const sel = document.getElementById("prompt-ai-key-select");
  if (!sel?.value) return aiStatus?.effective?.key_name || "Default key";
  // find label from aiStatus rather than option text
  const parsed = parsePromptKeyOptionValue(sel.value);
  if (!parsed) return aiStatus?.effective?.key_name || "Default key";
  const allKeys = [...(aiStatus?.keys || []), ...(aiStatus?.team_keys || [])];
  const found = allKeys.find((k) => k.id === parsed.keyId);
  return found?.name || "Selected key";
}

function getSelectedPromptModelInfo() {
  const parsed = parsePromptKeyOptionValue(document.getElementById("prompt-ai-key-select")?.value);
  const allKeys = [...(aiStatus?.keys || []), ...(aiStatus?.team_keys || [])];
  const found = parsed ? allKeys.find((k) => k.id === parsed.keyId) : null;
  if (found) {
    return {
      model: found.model || found.effective_model || "",
      provider: found.provider || "",
    };
  }
  if (aiStatus?.ai_ready) {
    const eff = aiStatus.effective || {};
    return {
      model: eff.model || aiStatus.model || "",
      provider: eff.provider || aiStatus.provider || "",
    };
  }
  return { model: "", provider: "" };
}

// Update the pill button text to reflect current selection
function syncPromptKeyPill(status) {
  const sel = document.getElementById("prompt-ai-key-select");
  const parsed = sel?.value ? parsePromptKeyOptionValue(sel.value) : null;
  const allKeys = [...(status?.keys || []), ...(status?.team_keys || [])];
  const found = parsed ? allKeys.find((k) => k.id === parsed.keyId) : null;

  let keyName, modelName, providerName;
  if (found) {
    keyName = "";
    modelName = found.model || found.effective_model || "";
    providerName = found.provider || "";
  } else if (status?.ai_ready) {
    const eff = status.effective;
    keyName = "";
    modelName = eff?.model || status.model || "";
    providerName = eff?.provider || status.provider || "";
  } else {
    keyName = "No key";
    modelName = "";
    providerName = "";
  }
  const modelLabel = formatModelLabel(modelName, providerName) || modelName || keyName;

  // Sync all pill buttons (design prompt + wiring prompt + circuit debugger)
  for (const [nameId, modelId] of [
    ["prompt-key-pill-name", "prompt-key-pill-model"],
    ["wiring-key-pill-name", "wiring-key-pill-model"],
    ["wdbg-key-pill-name", "wdbg-key-pill-model"],
  ]) {
    const nameEl = document.getElementById(nameId);
    const modelEl = document.getElementById(modelId);
    if (nameEl) {
      nameEl.textContent = keyName;
      nameEl.classList.toggle("hidden", !keyName);
    }
    if (modelEl) modelEl.textContent = modelLabel;
  }
}

// Keep old name as alias so renderAIStatus still works
function syncPromptAiKeyDisplay() {
  syncPromptKeyPill(aiStatus);
}

// MODEL_OPTIONS is defined in ai-key-ui.js; mirror it here for the popup
const PROMPT_KEY_MODEL_OPTIONS = {
  openai: [
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.5-pro", label: "GPT-5.5 Pro" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  ],
  anthropic: [
    { value: "claude-fable-5", label: "Claude Fable 5" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { value: "claude-4.6-sonnet", label: "Claude Sonnet 4.6" },
    { value: "claude-4.6-opus", label: "Claude Opus 4.6" },
  ],
};

const BADGE_CLASS_MAP = { openai: "badge-openai", anthropic: "badge-claude" };

function buildModelOptionsHTML(provider, currentModel) {
  const opts = PROMPT_KEY_MODEL_OPTIONS[provider] || PROMPT_KEY_MODEL_OPTIONS.openai;
  const known = opts.map((o) => o.value);
  let html = opts.map((o) =>
    `<option value="${o.value}"${o.value === currentModel ? " selected" : ""}>${o.label}</option>`
  ).join("");
  if (currentModel && !known.includes(currentModel)) {
    html += `<option value="${currentModel}" selected>${currentModel}</option>`;
  }
  return html;
}

function aiKeyAllowedForCurrentProject(key) {
  if (!key || !key.scope_type || key.scope_type === "all") return true;
  if (key.scope_type === "project") {
    return !!projectId && String(key.scope_project_id || "") === String(projectId);
  }
  if (key.scope_type === "folder") {
    const current = allProjects.find((project) => String(project.id || "") === String(projectId || ""));
    return !!current?.folder_id && String(current.folder_id) === String(key.scope_project_id || "");
  }
  return true;
}

function renderPromptAiKeySelect(status, { preserveSelection = true } = {}) {
  const sel = document.getElementById("prompt-ai-key-select");
  if (!sel) return;
  const prev = preserveSelection ? sel.value : "";
  sel.innerHTML = "";

  const personalKeys = status?.keys || [];
  const teamKeys = (status?.team_keys || []).filter((k) => k.enabled !== false && aiKeyAllowedForCurrentProject(k));

  if (!personalKeys.length && !teamKeys.length) {
    sel.disabled = true;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "";
    sel.appendChild(opt);
    syncPromptKeyPill(status);
    return;
  }

  personalKeys.forEach((key) => {
    const opt = document.createElement("option");
    opt.value = promptKeyOptionValue("personal", key.id);
    opt.textContent = key.name || "Personal key";
    sel.appendChild(opt);
  });
  teamKeys.forEach((key) => {
    const opt = document.createElement("option");
    opt.value = promptKeyOptionValue("team", key.id);
    opt.textContent = key.name || "Shared key";
    sel.appendChild(opt);
  });

  sel.disabled = false;
  const projectStored = getStoredProjectPromptAiKeyValue();
  const candidates = [prev, projectStored, getStoredPromptAiKeyValue(), defaultPromptKeyValue(status)].filter(Boolean);
  for (const value of candidates) {
    if ([...sel.options].some((opt) => opt.value === value)) {
      sel.value = value;
      storePromptAiKeyValue(sel.value);
      syncPromptKeyPill(status);
      return;
    }
  }
  sel.value = defaultPromptKeyValue(status) || sel.options[0]?.value || "";
  if (sel.value) storePromptAiKeyValue(sel.value);
  syncPromptKeyPill(status);

  // Refresh popup if open
  if (promptKeyPopupOpen) renderPromptKeyPopup(status);
}

// ── Prompt key popup ──────────────────────────────────────────────────────────
let promptKeyPopupOpen = false;
let promptKeyPopupAnchor = null; // the pill button that last opened the popup

function renderPromptKeyPopup(status) {
  const popup = document.getElementById("prompt-key-popup");
  if (!popup) return;

  const personalKeys = status?.keys || [];
  const teamKeys = (status?.team_keys || []).filter((k) => k.enabled !== false && aiKeyAllowedForCurrentProject(k));
  const currentValue = document.getElementById("prompt-ai-key-select")?.value || "";

  const isSelected = (source, id) => currentValue === promptKeyOptionValue(source, id);

  const keyRow = (key, source) => {
    const active = isSelected(source, key.id);
    const badge = BADGE_CLASS_MAP[key.provider] || "badge-openai";
    const providerLabel = key.provider_label || (key.provider === "anthropic" ? "Claude" : "OpenAI");
    return `<div class="prompt-key-popup-row${active ? " active" : ""}"
         data-action="select-key" data-source="${source}" data-key-id="${key.id}">
      <div class="prompt-key-popup-check">
        <div class="prompt-key-popup-check-dot"></div>
      </div>
      <div class="prompt-key-popup-info">
        <span class="prompt-key-popup-name">
          ${key.name || "Key"}
          <span class="prompt-key-popup-badge ${badge}">${providerLabel}</span>
        </span>
      </div>
      <div class="prompt-key-popup-model-wrap">
        <select class="prompt-key-popup-model-select"
          data-action="change-model"
          data-key-id="${key.id}"
          data-source="${source}"
          title="Model for this key">
          ${buildModelOptionsHTML(key.provider, key.model || key.effective_model || "")}
        </select>
      </div>
    </div>`;
  };

  let html = `
    <div class="prompt-key-popup-header">
      <span class="prompt-key-popup-title">AI Key</span>
      <button type="button" class="prompt-key-popup-manage" data-action="open-key-manager">Manage keys →</button>
    </div>`;

  if (!personalKeys.length && !teamKeys.length) {
    html += `<p class="prompt-key-popup-empty">No keys saved. Use <strong>Manage keys</strong> to add one.</p>`;
  } else {
    if (personalKeys.length) {
      html += `<div class="prompt-key-popup-section">Your keys</div>`;
      html += personalKeys.map((k) => keyRow(k, "personal")).join("");
    }
    if (teamKeys.length) {
      html += `<div class="prompt-key-popup-section">Shared keys</div>`;
      html += teamKeys.map((k) => keyRow(k, "team")).join("");
    }
  }

  popup.innerHTML = html;
}

function positionPromptKeyPopup() {
  const anchor = promptKeyPopupAnchor || document.getElementById("prompt-key-picker-btn");
  const popup = document.getElementById("prompt-key-popup");
  if (!anchor || !popup) return;
  const rect = anchor.getBoundingClientRect();
  const popupW = 296;
  const vw = window.innerWidth;
  let left = rect.right - popupW;
  if (left < 8) left = 8;
  if (left + popupW > vw - 8) left = vw - popupW - 8;
  popup.style.top = `${rect.bottom + 6}px`;
  popup.style.left = `${left}px`;
}

function openPromptKeyPopup(anchor) {
  const popup = document.getElementById("prompt-key-popup");
  if (!popup) return;
  promptKeyPopupAnchor = anchor || document.getElementById("prompt-key-picker-btn");
  promptKeyPopupOpen = true;
  renderPromptKeyPopup(aiStatus);
  popup.classList.remove("hidden");
  promptKeyPopupAnchor?.setAttribute("aria-expanded", "true");
  positionPromptKeyPopup();
}

function closePromptKeyPopup() {
  const popup = document.getElementById("prompt-key-popup");
  if (!popup) return;
  promptKeyPopupOpen = false;
  const allPills = document.querySelectorAll("#prompt-key-picker-btn, #wiring-key-picker-btn, #wdbg-key-picker-btn");
  allPills.forEach((b) => b.setAttribute("aria-expanded", "false"));
  popup.classList.add("hidden");
  promptKeyPopupAnchor = null;
}

function initPromptKeyPopup() {
  const popup = document.getElementById("prompt-key-popup");
  if (!popup) return;

  // Attach to both design-prompt pill and wiring-prompt pill
  const pillIds = ["prompt-key-picker-btn", "wiring-key-picker-btn", "wdbg-key-picker-btn"];
  for (const id of pillIds) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (promptKeyPopupOpen && promptKeyPopupAnchor === btn) {
        closePromptKeyPopup();
        return;
      }
      openPromptKeyPopup(btn);
    });
  }

  // Close on outside click (not on any pill button)
  document.addEventListener("click", (e) => {
    if (!promptKeyPopupOpen) return;
    if (popup.contains(e.target)) return;
    if (pillIds.some((id) => document.getElementById(id)?.contains(e.target))) return;
    closePromptKeyPopup();
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && promptKeyPopupOpen) closePromptKeyPopup();
  });

  // Reposition on resize/scroll
  window.addEventListener("resize", () => { if (promptKeyPopupOpen) positionPromptKeyPopup(); });

  // Delegate clicks/changes in popup
  popup.addEventListener("click", async (e) => {
    const manageBtn = e.target.closest("[data-action='open-key-manager']");
    if (manageBtn) {
      closePromptKeyPopup();
      document.getElementById("btn-ai-key-menu")?.click();
      return;
    }

    const row = e.target.closest("[data-action='select-key']");
    if (row && !e.target.closest("select")) {
      const source = row.dataset.source;
      const keyId = row.dataset.keyId;
      const sel = document.getElementById("prompt-ai-key-select");
      if (sel) {
        sel.value = promptKeyOptionValue(source, keyId);
        storePromptAiKeyValue(sel.value);
      }
      syncPromptKeyPill(aiStatus);
      renderPromptKeyPopup(aiStatus);
      closePromptKeyPopup();
    }
  });

  popup.addEventListener("change", async (e) => {
    const modelSel = e.target.closest("[data-action='change-model']");
    if (!modelSel) return;
    e.stopPropagation();
    const keyId = modelSel.dataset.keyId;
    const source = modelSel.dataset.source;
    const newModel = modelSel.value;
    const endpoint = source === "team"
      ? null // team key model changes go through the key manager for now
      : `/api/user/ai-keys/${keyId}`;
    if (!endpoint) return;
    try {
      const data = await api(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: newModel }),
      });
      // Update aiStatus and re-render
      const updatedAi = { ...(data.ai || {}), keys: data.ai?.keys || [] };
      aiKeyUi?.render(updatedAi);
      // aiKeyUi.render will call renderAIStatus via onStatusChange -> re-renders pill
    } catch (err) {
      console.error("Could not update model:", err);
    }
  });
}

function renderAIStatus(status) {
  aiStatus = status || null;
  renderPromptAiKeySelect(aiStatus);
  const el = document.getElementById("prompt-status");
  if (!el || !aiStatus) return;
  if (aiStatus.ai_ready) {
    el.className = "status";
    el.textContent = "";
    return;
  }
  el.className = "status error";
  el.textContent = "Add your OpenAI or Claude API key from the account menu before prompting.";
}

function saveLastProjectId(id) {
  try {
    localStorage.setItem(LS_LAST_PROJECT, id);
  } catch (_) {}
  captureSessionSnapshot();
}

function captureSessionSnapshot() {
  if (!projectId) return;
  saveSessionSnapshot({
    projectId,
    selectedFile: selectedFile || null,
    workspaceId: document.getElementById("team-select")?.value || readSavedWorkspaceId() || null,
  });
}

function getSelectedWorkspaceId() {
  const value = document.getElementById("team-select")?.value;
  if (value === "__all__") return null;
  return value || allTeams[0]?.id || null;
}

function getFolderTeamId() {
  const selected = getSelectedWorkspaceId();
  if (selected) return selected;
  const owned = allTeams.find((team) => team.role === "owner");
  return owned?.id || allTeams[0]?.id || null;
}

function userWorkspaceStorageKey(user = currentUser) {
  return user?.id ? `${LS_LAST_WORKSPACE}:${user.id}` : LS_LAST_WORKSPACE;
}

function readSavedWorkspaceId() {
  try {
    const userScoped = localStorage.getItem(userWorkspaceStorageKey());
    if (userScoped) return userScoped;
    return localStorage.getItem(LS_LAST_WORKSPACE) || "";
  } catch (_) {
    return "";
  }
}

function hasUserScopedSavedWorkspace(id) {
  if (!id) return false;
  try {
    return localStorage.getItem(userWorkspaceStorageKey()) === id;
  } catch (_) {
    return false;
  }
}

function writeSavedWorkspaceId(id) {
  if (!id) return;
  try {
    localStorage.setItem(userWorkspaceStorageKey(), id);
    localStorage.setItem(LS_LAST_WORKSPACE, id);
  } catch (_) {}
}

function defaultWorkspaceIdForUser(teams = allTeams) {
  const owned = teams.find((team) => team.role === "owner");
  return owned?.id || (teams.length > 1 ? "__all__" : teams[0]?.id || "");
}

function upsertProjectInList(summary = {}) {
  const id = summary?.id;
  if (!id) return;
  const idx = allProjects.findIndex((p) => p.id === id);
  if (idx >= 0) {
    allProjects[idx] = { ...allProjects[idx], ...summary, id };
  } else {
    allProjects = [{ ...summary, id }, ...allProjects];
  }
}

async function ensureActiveProjectListed(activeId = projectId) {
  if (!activeId) return true;
  if (allProjects.some((p) => p.id === activeId)) return true;
  try {
    const data = await api(`/api/projects/${activeId}`);
    upsertProjectInList({
      id: activeId,
      name: data.name || activeId,
      updated_at: data.updated_at,
      created_at: data.created_at,
      file_count: data.files?.length ?? data.file_count ?? 0,
      files: data.files,
      browser: normalizeBrowser(data),
      timeline: data.timeline,
      latest_file: data.latest_file,
      generation: data.generation,
    });
    return true;
  } catch {
    return false;
  }
}

let projectFetchSucceeded = false;

function isAnonymousPublicProject(id = projectId) {
  return !currentUser && !!id && allProjects.some((p) => p.id === id && p.public);
}

function projectApiPath(id = projectId) {
  return isAnonymousPublicProject(id) ? `/api/public/projects/${id}` : `/api/projects/${id}`;
}

function projectFileUrl(id, filename) {
  return `${projectApiPath(id)}/files/${encodeURIComponent(filename)}`;
}

async function fetchPublicProjectsForAnonymous() {
  const data = await api("/api/public/projects");
  const folder = data.folder || {
    id: "__public__",
    name: "Public",
    virtual: true,
    read_only: true,
    public: true,
  };
  allProjects = (data.projects || []).map((p) => ({
    ...p,
    folder_id: p.folder_id || folder.id,
    read_only_project: true,
    public: true,
  }));
  workspaceBrowser.setFolders([folder]);
  projectFetchSucceeded = true;
  renderProjectList();
  return allProjects;
}

async function fetchAllProjects() {
  const fetchGen = ++projectsFetchGeneration;
  const teamId = getSelectedWorkspaceId();
  const previousProjects = allProjects;
  projectFetchSucceeded = false;
  try {
    const qs = teamId ? `?team_id=${encodeURIComponent(teamId)}` : "";
    const data = await api(`/api/projects${qs}`);
    if (fetchGen !== projectsFetchGeneration) return allProjects;
    allProjects = data.projects || [];
    if (!allProjects.length && teamId) {
      const all = await api("/api/projects");
      if (fetchGen !== projectsFetchGeneration) return allProjects;
      const fallback = all.projects || [];
      if (fallback.length) {
        allProjects = fallback;
        setEditStatus(
          "error",
          `No projects in this workspace — showing all ${fallback.length} projects you can access.`
        );
      }
    }
    projectFetchSucceeded = true;
  } catch (err) {
    if (fetchGen !== projectsFetchGeneration) return allProjects;
    // Keep the last good list on refresh failures so rename/move doesn't wipe the explorer.
    if (!previousProjects.length) allProjects = [];
    const msg = err.message || "Could not load projects";
    setEditStatus("error", msg);
    if (/not authenticated|invalid or expired token|401/i.test(msg)) {
      document.getElementById("auth-modal")?.classList.remove("hidden");
      const browser = document.getElementById("project-browser");
      if (browser && !browser.querySelector(".proj-item")) {
        browser.innerHTML =
          '<p class="status error browser-empty">Session expired — sign in again from the account menu (top right).</p>';
      }
    }
    throw err;
  }
  if (fetchGen !== projectsFetchGeneration) return allProjects;
  if (projectId && !allProjects.some((p) => p.id === projectId)) {
    await ensureActiveProjectListed(projectId);
  }
  await workspaceBrowser.refreshFolders();
  void resumeGenerationFromProjects();
  return allProjects;
}

async function loadProjectComponents(comps, { projectId: pid, latestFile, loadGen, fitView = true, loadAll = false } = {}) {
  if (!comps?.length) return false;
  comps = comps.filter((entry) => !isInternalCadSidecar(entry?.name) && !isInternalCadSidecar(entry?.viewer_filename));
  if (!comps.length) return false;
  prepareViewportForModels();
  const visibleComps = comps.filter((c) => !isBrowserComponentHidden(c));
  if (!visibleComps.length) {
    selectedFile = null;
    clearModelContents();
    currentMesh = projectAssembly.getRoot();
    setEditStatus("ok", "All components are hidden.");
    syncExportButton();
    return false;
  }
  const primary = primaryViewportComponent(visibleComps, latestFile);
  if (!primary) return false;
  if (loadGen != null && loadGen !== loadProjectGeneration) return false;
  const seen = new Set();
  const ordered = [];
  const pushUnique = (entry) => {
    const key = entry?.viewer_filename || entry?.name;
    if (!entry || !key || seen.has(key)) return;
    seen.add(key);
    ordered.push(entry);
  };
  pushUnique(primary);
  if (loadAll) {
    const autoLoadComps = visibleComps.filter((c) => c.auto_load === true);
    for (const comp of (autoLoadComps.length ? autoLoadComps : visibleComps)) pushUnique(comp);
  }
  selectedFile = primary.name;
  let lastError = null;
  let loadedCount = 0;
  try {
    for (const entry of ordered) {
      const viewer = entry.viewer_filename || entry.name;
      selectedFile = entry.name;
      const ok = await loadModel(
        projectFileUrl(pid, viewer),
        viewer,
        {
          projectId: pid,
          append: loadedCount > 0,
          catalogFilename: entry.name,
          center: !hasBakedPlacement(entry),
          fitView: false,
          autoGizmo: false,
        },
      );
      if (loadGen != null && loadGen !== loadProjectGeneration) return false;
      if (!ok && !projectAssembly.has(entry.name)) {
        throw new Error(`Model load was cancelled or did not complete for ${entry.name}.`);
      }
      if (ok || projectAssembly.has(entry.name)) loadedCount += 1;
    }
    selectedFile = primary.name;
    projectTree.setSelected(primary.name);
    featureEditor.setModel(projectId, primary.name);
    safeRestoreActiveModelPromptState();
    if (fitView) fitCameraToComponent(primary.name);
    setEditStatus("ok", "Loaded model in viewport.");
    viewerOverlay.clearError();
    return loadedCount > 0;
  } catch (err) {
    lastError = err;
    console.error("loadModel failed:", primary.name, err);
    const msg = lastError?.message || "Could not load model into the viewport.";
    setEditStatus("error", msg);
    viewerOverlay.showError(msg);
    return false;
  }
}

async function openSketchInViewport(entry) {
  if (!projectId || !entry || entry.format !== "sketch") return;
  workspaceModes.setMode("design");
  applyWorkspaceMode("design");
  workspaceModes.setDesignTab("SKETCH");
  try {
    const sketch = await api(`/api/projects/${projectId}/sketches/${encodeURIComponent(entry.stem)}`);
    sketchEditor.loadSketch(sketch);
    ribbon?.setSketchProfile(sketch.profile, sketch.plane || "XY");
    projectTree.setSelected(entry.name);
    setEditStatus("ok", `Loaded sketch “${sketch.name || entry.name}”.`);
    setRightTab("sketch");
  } catch (err) {
    setEditStatus("error", err.message || "Could not load sketch.");
  }
}

async function openSketchForEdit(entry) {
  if (!projectId || !entry || entry.format !== "sketch") return;
  if (sketchEditor.isActive()) {
    setEditStatus("ok", "Already editing a sketch — finish or cancel first.");
    return;
  }
  workspaceModes.setMode("design");
  applyWorkspaceMode("design");
  workspaceModes.setDesignTab("SKETCH");
  try {
    const sketch = await api(`/api/projects/${projectId}/sketches/${encodeURIComponent(entry.stem)}`);
    sketchEditor.applySketchData(sketch);
    enterSketchMode();
    const nameEl = document.getElementById("sketch-name");
    if (nameEl && sketch.name) nameEl.textContent = sketch.name;
    ribbon?.setSketchProfile(sketch.profile, sketch.plane || "XY");
    projectTree.setSelected(entry.name);
    setEditStatus("ok", `Editing sketch “${sketch.name || entry.name}”.`);
    setRightTab("sketch");
  } catch (err) {
    setEditStatus("error", err.message || "Could not open sketch for editing.");
  }
}

async function openProgramForEdit(entry) {
  if (!projectId || !entry || entry.format !== "program") return;
  setEditStatus("loading", `Opening ${entry.stem}…`);
  try {
    // Load the GLB in the viewport
    const data = await api(`/api/projects/${projectId}`);
    const comp = (data.browser?.components || []).find((c) => c.stem === entry.stem);
    if (comp) {
      await openBrowserComponent(comp);
    } else {
      // Fall back: just set the selected file
      selectedFile = `${entry.stem}.glb`;
      featureEditor.setModel(projectId, selectedFile);
    }
    // Show the feature editor (History tab on right panel)
    setRightTab("history");
    featureEditor.setModel(projectId, `${entry.stem}.glb`);
    setEditStatus("ok", `Editing features for "${entry.stem}" — modify values then Rebuild.`);
  } catch (err) {
    setEditStatus("error", err.message || "Could not open program for editing.");
  }
}

async function openHierarchyItem(project, entry, sectionId) {
  if (!project?.id || !entry) return;
  if (project.id !== projectId) {
    await loadProject(project.id);
  }
  if (sectionId === "components") {
    await openBrowserComponent(entry);
    return;
  }
  if (sectionId === "drawings") {
    await openDxfDrawing(entry);
    showAiComposePanel();
    return;
  }
  if (sectionId === "sketches") {
    if (entry.format === "sketch") {
      await openSketchInViewport(entry);
      return;
    }
    const data = await api(`/api/projects/${projectId}`);
    const comp = (data.browser?.components || []).find((c) => c.stem === entry.stem);
    if (comp) await openBrowserComponent(comp);
    else featureEditor.setModel(projectId, `${entry.stem}.glb`);
    showAiComposePanel();
    return;
  }
  workspaceModes.setMode("wiring");
  applyWorkspaceMode("wiring");
}

async function deleteHierarchyComponent(project, entry) {
  if (!project?.id || !entry?.name) return;
  if (!window.confirm(`Delete "${entry.name}" from this project?`)) return;
  try {
    const data = await api(`/api/projects/${project.id}/files/${encodeURIComponent(entry.name)}`, { method: "DELETE" });
    if (project.id === projectId) {
      await syncAfterObjectDelete({ deletedFile: entry.name, ...data });
    } else {
      await fetchAllProjects();
    }
  } catch (err) {
    alert(err.message || "Failed to delete component");
  }
}

async function renameHierarchyComponent(project, entry) {
  if (!project?.id || !entry?.name) return;
  if (project.id !== projectId) {
    await loadProject(project.id);
  }
  renameProjectFile(entry.name);
}

async function attachHierarchyComponentToWiring(project, entry, payload) {
  if (!project?.id || !entry) return;
  if (project.id !== projectId) {
    await loadProject(project.id);
  }
  workspaceModes.setMode("wiring");
  applyWorkspaceMode("wiring");
  await wiringSim.load?.();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const result = wiringSim.attachComponentRef?.(payload || entry);
  const label = payload?.label || entry.stem || entry.name;
  setEditStatus("ok", `${label} attached to the Wiring Simulator${result?.recognized === false ? " as a generic module" : ""}.`);
}

const workspaceBrowser = createWorkspaceBrowser({
  container: document.getElementById("project-browser"),
  api,
  getWorkspaceId: getSelectedWorkspaceId,
  getFolderTeamId,
  getProjects: () => allProjects,
  getActiveProjectId: () => projectId,
  isProjectLoading: (id) => loadingProjectIds.has(id),
  isProjectGenerating: (id) => isProjectGenerating(id),
  isProjectNew: (id) => newlyCompletedProjects.has(id),
  onOpenProject: (id) => openProjectById(id),
  onRenameProject: (p) => renameProject(p),
  onDeleteProject: (p) => deleteProject(p),
  canDeleteProject: (p) => !!p?.public && isA1ProjectsAdminUser(),
  onExportProject: (p) => exportProject(p),
  onMakePublicProject: (p) => makeProjectPublic(p),
  onCreateProjectInFolder: (folderId) => createNewProjectInFolder(folderId),
  onOpenHierarchyItem: (project, entry, sectionId) => openHierarchyItem(project, entry, sectionId),
  onOpenProfile: (project, entry) => componentProfileUI.open(entry, project?.id),
  onRenameHierarchyItem: (project, entry) => renameHierarchyComponent(project, entry),
  onDeleteHierarchyItem: (project, entry) => deleteHierarchyComponent(project, entry),
  onExportHierarchyItem: (project, entry) => {
    openFileExportMenu({ api, projectId: project.id, filename: entry.name, anchorEl: document.body }).catch((err) => {
      alert(err.message || "Could not load exports");
    });
  },
  onAttachWiringComponent: (project, entry, payload) => attachHierarchyComponentToWiring(project, entry, payload),
  isHierarchyItemHidden: (project, entry) => isHierarchyEntryHidden(project, entry),
  onToggleHierarchyVisibility: (project, entry, visible) => setHierarchyComponentVisible(project, entry, visible),
  onDragComponent: () => {},
  getPartProfile,
  onEditHierarchyItem: async (project, entry, sectionId) => {
    if (sectionId !== "sketches") return;
    if (project?.id && project.id !== projectId) {
      await loadProject(project.id);
    }
    if (entry.format === "sketch") {
      await openSketchForEdit(entry);
      return;
    }
    if (entry.format === "program") {
      await openProgramForEdit(entry);
      return;
    }
  },
});

function componentIdentityNames(entryOrName = {}) {
  if (typeof entryOrName === "string") return [entryOrName].filter(Boolean);
  const entry = entryOrName || {};
  if (entry.virtual_component) {
    return [
      entry.name,
      entry.id,
      entry.stem,
      entry.component_name,
      entry.node_name,
      entry.source_filename,
      entry.parent_filename,
      entry.viewer_filename,
    ].filter(Boolean).map(String);
  }
  if (entry.virtual_body) {
    return [
      entry.name,
      entry.id,
      entry.stem,
      entry.body_name,
      entry.body_name ? `${entry.body_name}.glb` : null,
      entry.body_name ? `${entry.body_name}.step` : null,
      entry.body_name ? `${entry.body_name}.stp` : null,
    ].filter(Boolean).map(String);
  }
  return [
    entry.name,
    entry.filename,
    entry.viewer_filename,
    entry.source_filename,
    entry.parent_filename,
    entry.source_file,
    entry.glb,
    entry.step_file,
    entry.id,
    entry.stem,
    entry.stem ? `${entry.stem}.glb` : null,
    entry.stem ? `${entry.stem}.step` : null,
    entry.stem ? `${entry.stem}.stp` : null,
  ].filter(Boolean).map(String);
}

function setStoredComponentHidden(pid, entryOrName, hidden) {
  const candidateNames = componentIdentityNames(entryOrName);
  if (!pid || !candidateNames.length) return new Set();
  const names = new Set(loadHiddenComponentState(pid));
  const candidateStems = new Set(candidateNames.map(componentStemName).filter(Boolean));
  if (hidden) {
    for (const name of candidateNames) names.add(name);
  } else {
    for (const name of [...names]) {
      if (candidateNames.includes(name) || candidateStems.has(componentStemName(name))) {
        names.delete(name);
      }
    }
  }
  const key = hiddenComponentsStorageKey(pid);
  if (key) {
    try {
      localStorage.setItem(key, JSON.stringify([...names]));
    } catch {
      /* local storage is best-effort */
    }
  }
  return names;
}

function componentStemName(name = "") {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/^.+?__\d+_/, "")
    .replace(/_edited(?:_\d+)?$/i, "")
    .replace(/_cleaned(?:_\d+)?$/i, "")
    .replace(/_(loops|duct|hole|extruded|pulled|mirrored)(?:_\d+)?$/i, "")
    .replace(/_copy\d*$/i, "");
}

function componentVisibilityCandidates(entry = {}) {
  const raw = componentIdentityNames(entry);
  const stems = new Set(raw.map(componentStemName).filter(Boolean));
  for (const [name] of projectAssembly.list()) {
    if (raw.includes(name) || stems.has(componentStemName(name))) raw.push(name);
  }
  return [...new Set(raw)];
}

function setAssemblyComponentVisible(entry, visible) {
  let changed = false;
  for (const name of componentVisibilityCandidates(entry)) {
    const didChange = projectAssembly.setVisible(name, visible);
    if (!didChange) continue;
    changed = true;
    if (!visible) {
      const selected = objectTools.getSelection?.();
      const selectedName = selected?.catalogName || (selected?.mesh ? catalogNameForMesh(selected.mesh) : null);
      if (selectedName === name || componentStemName(selectedName) === componentStemName(name)) {
        objectTools.clearSelection?.();
        transformControls.detach();
        gizmoPanel.hide();
        document.getElementById("btn-gizmo")?.classList.remove("active");
      }
    }
  }
  return changed;
}

function isHierarchyEntryHidden(project, entry) {
  const names = new Set(loadHiddenComponentState(project?.id || projectId));
  const candidates = componentVisibilityCandidates(entry);
  const candidateStems = new Set(candidates.map(componentStemName).filter(Boolean));
  return [...names].some((name) => candidates.includes(name) || candidateStems.has(componentStemName(name)));
}

async function setHierarchyComponentVisible(project, entry, visible) {
  if (!entry?.name) return;
  const pid = project?.id || projectId;
  const hidden = setStoredComponentHidden(pid, entry, !visible);
  if (pid === projectId) {
    projectTree.setHidden?.([...hidden]);
    const changed = setAssemblyComponentVisible(entry, visible);
    if (visible && !changed) {
      await openBrowserComponent(entry);
    } else {
      fitCamera();
    }
    syncExportButton();
  }
  workspaceBrowser?.render?.();
}

async function openBrowserComponent(entry) {
  if (!projectId || !entry) return;
  if (entry.format === "dxf" || isDxfDrawingFilename(entry.name)) {
    await openDxfDrawing(entry);
    await refreshPromptHistory();
    showAiComposePanel();
    return;
  }
  saveActiveModelPromptState();
  prepareViewportForModels();
  try {
    const catalogName = (entry.virtual_body || entry.virtual_component)
      ? (entry.source_filename || entry.parent_filename || entry.filename || entry.name)
      : entry.name;
    if (projectAssembly.has(catalogName)) {
      if (entry.virtual_component) {
        selectBrowserVirtualComponent(entry, { fitView: true });
      } else if (entry.virtual_body) {
        await selectBrowserBody(entry, { fitView: true });
      } else {
        selectAssemblyComponent(catalogName, { fitView: true });
      }
      await refreshPromptHistory();
      showAiComposePanel();
      return;
    }
    selectedFile = catalogName;
    projectTree.setSelected(entry.name);
    const viewer = entry.viewer_filename || entry.name;
    const ok = await loadModel(projectFileUrl(projectId, viewer), viewer, {
      projectId,
      append: projectAssembly.count() > 0,
      catalogFilename: catalogName,
      center: !hasBakedPlacement(entry),
      fitView: true,
      autoGizmo: false,
    });
    if (!ok) {
      if (!projectAssembly.has(entry.name)) {
        throw new Error("Model load was cancelled or did not complete.");
      }
    }
    if (ok && entry.virtual_component) {
      selectBrowserVirtualComponent(entry, { fitView: false });
    } else if (ok && entry.virtual_body) {
      await selectBrowserBody(entry, { fitView: false });
    } else if (ok) {
      selectAssemblyComponent(catalogName, { fitView: true });
    }
    viewerOverlay.clearError();
    await refreshPromptHistory();
    showAiComposePanel();
  } catch (err) {
    setEditStatus("error", err.message || "Could not load model.");
    viewerOverlay.showError(err.message || "Could not load model.");
  }
}

// Cache of per-component part profiles (identity, stats, online source).
const partProfiles = new Map();
function getPartProfile(stem) {
  return stem ? partProfiles.get(stem) || null : null;
}
async function refreshPartProfiles() {
  if (!projectId) {
    partProfiles.clear();
    return;
  }
  try {
    const data = await api(`/api/projects/${projectId}/parts`);
    partProfiles.clear();
    for (const [stem, profile] of Object.entries(data.profiles || {})) {
      partProfiles.set(stem, profile);
    }
    projectTree.setPartProfiles?.(partProfiles);
    renderProjectList();
  } catch {
    /* profiles are best-effort */
  }
}

const componentProfileUI = createComponentProfileUI({
  api,
  rawFetch,
  getProjectId: () => projectId,
  createMiniViewer,
  onProfileChange: (stem, profile) => {
    if (stem) partProfiles.set(stem, profile);
    projectTree.setPartProfiles?.(partProfiles);
    renderProjectList();
  },
  onImportSource: ({ source, profile, entry } = {}) => importSourcedStepToProject(source, { profile, entry }),
});

const catalogPanel = createCatalogPanel({
  api,
  getProjectId: () => projectId,
  onImport: (source) => importSourcedStepToProject(source),
  onStatus: (kind, text) => {
    if (text) setEditStatus(kind || "ok", text);
  },
});

const dxfViewer = createDxfViewer({
  tabBarEl: document.getElementById("dxf-tab-bar"),
  viewerEl: document.getElementById("dxf-viewer"),
  api,
  getProjectId: () => projectId,
  onStatus: (kind, text) => {
    if (text) setEditStatus(kind || "ok", text);
  },
  onActiveChange: (filename) => {
    if (filename) {
      selectedFile = filename;
      projectTree?.setSelected?.(filename);
      return;
    }
    if (isDxfDrawingFilename(selectedFile)) {
      selectedFile = projectAssembly.list?.()[0]?.[0] || null;
      projectTree?.setSelected?.(selectedFile);
    }
  },
});

async function openDxfDrawing(entry) {
  if (!entry?.name) return;
  await openDxfDrawingByName(entry.name, {
    projectId,
    label: entry.stem || entry.name.replace(/\.dxf$/i, ""),
  });
}

const projectTree = createProjectTree({
  container: document.getElementById("design-browser"),
  getProjectId: () => projectId,
  onOpenComponent: (entry) => openBrowserComponent(entry),
  onOpenDrawing: (entry) => openDxfDrawing(entry),
  onOpenProfile: (entry) => componentProfileUI.open(entry),
  getPartProfile,
  onOpenSketch: (entry) => openSketchInViewport(entry),
  onEditSketch: (entry) => openSketchForEdit(entry),
  onOpenWiring: () => {
    workspaceModes.setMode("wiring");
    applyWorkspaceMode("wiring");
  },
  onToggleVisibility: (entry, visible, sectionId) => {
    if (entry.format === "sketch" || sectionId === "sketches") {
      saveHiddenComponentState();
      sketchEditor.setViewportSketchVisible?.(entry.stem || entry.id, visible);
      return;
    }
    const hidden = setStoredComponentHidden(projectId, entry, !visible);
    projectTree.setHidden?.([...hidden]);
    const changed = setAssemblyComponentVisible(entry, visible);
    if (visible && !changed) {
      void openBrowserComponent(entry);
    } else {
      fitCamera();
    }
    syncExportButton();
    syncPromptTargetUI();
    workspaceBrowser?.render?.();
  },
  onExport: (entry, anchorEl) => {
    if (isComponentHidden(entry.name)) {
      alert("Show this component before exporting it.");
      return;
    }
    openFileExportMenu({ api, projectId, filename: entry.name, anchorEl }).catch((err) => {
      alert(err.message || "Could not load exports");
    });
  },
  onRename: (entry) => renameProjectFile(entry.name),
  onDelete: (entry) => deleteProjectFile(entry.name),
});

function hiddenComponentsStorageKey(pid = projectId) {
  return pid ? `render3d:hidden-components:${pid}` : "";
}

function loadHiddenComponentState(pid = projectId) {
  const key = hiddenComponentsStorageKey(pid);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function saveHiddenComponentState(pid = projectId) {
  const key = hiddenComponentsStorageKey(pid);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify([...(projectTree.getHidden?.() || [])]));
  } catch {
    /* local storage is best-effort */
  }
}

function isComponentHidden(name) {
  if (!name) return false;
  const hidden = new Set(projectTree.getHidden?.() || loadHiddenComponentState());
  if (hidden.has(String(name))) return true;
  const stem = componentStemName(name);
  return [...hidden].some((candidate) => componentStemName(candidate) === stem);
}

function isBrowserComponentHidden(entry) {
  return componentVisibilityCandidates(entry).some((name) => isComponentHidden(name));
}

let browserBodyHydrationRun = 0;

function bodyChildSlug(label = "", fallback = "body") {
  return String(label || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function bodyChildrenFromInfo(entry, info) {
  const count = Number(info?.count || 0);
  if (count <= 1) return [];
  const names = Array.isArray(info.body_names) ? info.body_names : [];
  return Array.from({ length: count }, (_, idx) => {
    const label = names[idx] || `Body ${idx + 1}`;
    const slug = bodyChildSlug(label, `body_${idx + 1}`);
    return {
      id: `${entry.stem || fileStem(entry.name)}:body:${slug}`,
      name: `${entry.name}#body:${idx + 1}`,
      filename: entry.name,
      stem: slug,
      label,
      format: "body",
      viewer_filename: entry.viewer_filename,
      source_filename: entry.name,
      parent_filename: entry.name,
      body_index: idx,
      body_name: label,
      virtual_body: true,
    };
  });
}

async function hydrateBrowserBodyChildren(browser) {
  const run = ++browserBodyHydrationRun;
  if (!projectId || !browser?.components?.length) return;
  // Dense text-to-cad Compounds (stairs, gearsets) tessellate into dozens of
  // disconnected solids. Expanding them under Components → Parts recreates the
  // "59 components" explosion even when only one assembly file exists.
  const MAX_BROWSER_BODY_CHILDREN = 24;
  let changed = false;
  await Promise.all((browser.components || []).map(async (entry) => {
    if (!entry?.name || entry.children?.length || entry.format === "body") return;
    try {
      // Prefer the viewport mesh (.glb) — STEP often reports 100+ solids for the
      // same assembly the viewer already shows as one model.
      const bodySource = entry.viewer_filename || entry.name;
      const info = await api(`/api/projects/${projectId}/files/${encodeURIComponent(bodySource)}/bodies`);
      const count = Number(info?.count || 0);
      if (count > MAX_BROWSER_BODY_CHILDREN) {
        if (entry.children) {
          delete entry.children;
          delete entry.children_label;
          changed = true;
        }
        return;
      }
      const children = bodyChildrenFromInfo(entry, info);
      if (!children.length || run !== browserBodyHydrationRun) return;
      entry.children_label = entry.children_label || "Parts";
      entry.children = children;
      changed = true;
    } catch {
      /* body hydration is best-effort; backend browser metadata may already include it */
    }
  }));
  if (changed && run === browserBodyHydrationRun) {
    projectTree.render(browser);
    projectTree.setHidden?.(loadHiddenComponentState());
  }
}

function renderProjectBrowser(browser) {
  lastProjectBrowser = browser || lastProjectBrowser;
  mobileBrowserComponents = browser?.components || [];
  promptTargetBodyCache.clear();
  promptTargetSelectedBody = null;
  renderMobileModelPicker();
  projectTree.render(browser);
  projectTree.setHidden?.(loadHiddenComponentState());
  for (const comp of browser?.components || []) {
    setAssemblyComponentVisible(comp, !isBrowserComponentHidden(comp));
  }
}

document.getElementById("btn-mobile-models")?.addEventListener("click", openMobileModelPicker);
document.querySelectorAll("[data-mobile-model-close]").forEach((el) => {
  el.addEventListener("click", closeMobileModelPicker);
});
document.getElementById("btn-mobile-fit")?.addEventListener("click", () => fitCamera());
document.getElementById("btn-mobile-grid")?.addEventListener("click", () => {
  document.getElementById("btn-grid-viewport")?.click();
});

function closeMobilePanels() {
  document.body.classList.remove("mobile-left-panel-open", "mobile-right-panel-open");
  document.getElementById("mobile-corner-sheet")?.classList.add("hidden");
}

function openMobileLeftPanel() {
  closeMobilePanels();
  document.body.classList.add("mobile-left-panel-open");
  window.dispatchEvent(new Event("resize"));
}

function openMobileRightPanel(tab = "prompt") {
  closeMobilePanels();
  setRightTab(tab);
  document.body.classList.add("mobile-right-panel-open");
  window.dispatchEvent(new Event("resize"));
}

function openMobileDesignTab(tab) {
  closeMobilePanels();
  workspaceModes?.setDesignTab?.(tab);
}

function triggerMobileUpload() {
  closeMobilePanels();
  document.getElementById("file-upload")?.click();
}

function openMobileAccountMenu(action = "account") {
  closeMobilePanels();
  document.getElementById("btn-auth")?.click();
  window.setTimeout(() => {
    if (action === "keys") document.getElementById("btn-ai-key-menu")?.click();
    if (action === "costs") document.getElementById("btn-costs-menu")?.click();
    if (action === "preferences") document.getElementById("btn-preferences-menu")?.click();
    if (action === "workspaces") document.getElementById("btn-workspace-menu")?.click();
  }, 80);
}

function openMobileActionSheet(title, items = []) {
  const sheet = document.getElementById("mobile-corner-sheet");
  const titleEl = document.getElementById("mobile-corner-sheet-title");
  const actionsEl = document.getElementById("mobile-corner-sheet-actions");
  if (!sheet || !actionsEl) return;
  closeMobilePanels();
  if (titleEl) titleEl.textContent = title;
  actionsEl.innerHTML = items.map((item, idx) => `
    <button type="button" class="mobile-corner-action" data-mobile-action-index="${idx}">
      <span>${appEscapeHtml(item.label)}</span>
      ${item.hint ? `<small>${appEscapeHtml(item.hint)}</small>` : ""}
    </button>
  `).join("");
  actionsEl.querySelectorAll("[data-mobile-action-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = items[Number(btn.dataset.mobileActionIndex)];
      sheet.classList.add("hidden");
      item?.run?.();
    });
  });
  sheet.classList.remove("hidden");
}

document.querySelectorAll("[data-mobile-corner]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const corner = btn.dataset.mobileCorner;
    if (corner === "workspace") {
      openMobileActionSheet("Explorer & Build", [
        { label: "Explorer", hint: "Projects, browser tree, workspace, Onshape library", run: openMobileLeftPanel },
        { label: "Tools", hint: "Direct modeling, split bodies, delete, transform", run: () => openMobileRightPanel("tools") },
        { label: "New project", hint: "Start a fresh project", run: () => document.getElementById("btn-new-project")?.click() },
        { label: "Upload CAD", hint: "Import STEP, STL, GLB, OBJ, 3MF", run: triggerMobileUpload },
        { label: "Export model", hint: "Download visible part/assembly", run: () => document.getElementById("btn-export-model")?.click() },
        { label: "Catalog", hint: "Search STEP models, suppliers, datasheets", run: () => openMobileDesignTab("CATALOG") },
        { label: "Canvas", hint: "2D grid sketch pad with pen tools", run: () => openMobileDesignTab("CANVAS") },
      ]);
      return;
    }
    if (corner === "account") {
      openMobileActionSheet("Account & View", [
        { label: "Account", hint: "Profile and sign-in menu", run: () => openMobileAccountMenu("account") },
        { label: "AI keys", hint: "Personal and shared key management", run: () => openMobileAccountMenu("keys") },
        { label: "Costs", hint: "AI cost analytics", run: () => openMobileAccountMenu("costs") },
        { label: "Preferences", hint: "Mouse controls and viewport settings", run: () => openMobileAccountMenu("preferences") },
        { label: "Team workspaces", hint: "Members, invites, visibility", run: () => openMobileAccountMenu("workspaces") },
        { label: "Fit view", hint: "Center the current model", run: () => fitCamera() },
        { label: "Toggle grid", hint: "Show or hide viewport grid", run: () => document.getElementById("btn-grid-viewport")?.click() },
        { label: "Measure", hint: "Open model measurement tool", run: () => document.getElementById("btn-measure-viewport")?.click() },
        { label: "Color", hint: "Color selected object or faces", run: () => document.getElementById("btn-color-viewport")?.click() },
      ]);
      return;
    }
    if (corner === "ai") {
      openMobileActionSheet("AI & Modes", [
        { label: "AI prompt", hint: "Text-to-CAD compose and prompt history", run: () => { showAiComposePanel(); openMobileRightPanel(workspaceModes?.isWiring?.() ? "wiring" : "prompt"); } },
        { label: "Prompt history", hint: "Reuse previous prompts and references", run: () => { openMobileRightPanel("prompt"); promptHistory.setTab("history"); } },
        { label: "Sketch", hint: "2D sketch and constraints", run: () => openMobileDesignTab("SKETCH") },
        { label: "Canvas", hint: "Freehand grid sketch for AI prompts", run: () => openMobileDesignTab("CANVAS") },
        { label: "Wiring", hint: "Breadboard wiring simulator and AI", run: () => openMobileDesignTab("WIRING") },
        { label: "Rigging", hint: "Joints, bones, animation, URDF", run: () => openMobileDesignTab("RIGGING") },
        { label: "Solid", hint: "Return to main CAD design mode", run: () => openMobileDesignTab("SOLID") },
      ]);
      return;
    }
    openMobileActionSheet("Model & Selection", [
      { label: "Models", hint: "Choose component to view", run: openMobileModelPicker },
      { label: "Fit", hint: "Fit model to screen", run: () => fitCamera() },
      { label: "Grid", hint: "Toggle grid", run: () => document.getElementById("btn-grid-viewport")?.click() },
      { label: "Orbit mode", hint: "One finger drag rotates the model", run: () => { setLeftDragMode("rotate"); activatePickMode("off"); } },
      { label: "Object select", hint: "Tap objects intentionally, then transform/delete", run: () => { openMobileRightPanel("tools"); activatePickMode("object"); } },
      { label: "Face pick", hint: "Pick faces for prompts or press-pull", run: () => { openMobileRightPanel("tools"); activatePickMode("face"); } },
      { label: "Line/path", hint: "Place path refs for wires, ducts, routes", run: () => activatePickMode("line") },
      { label: "Lasso", hint: "Pick an area reference", run: () => activatePickMode("lasso") },
      { label: "Close panels", hint: "Return to full viewport", run: closeMobilePanels },
    ]);
  });
});

document.querySelector("[data-mobile-sheet-close]")?.addEventListener("click", closeMobilePanels);
document.getElementById("mobile-panel-close")?.addEventListener("click", closeMobilePanels);
document.getElementById("mobile-corner-sheet")?.addEventListener("click", (e) => {
  if (e.target?.id === "mobile-corner-sheet") closeMobilePanels();
});

const wiringSim = createWiringSimulator({
  root: document.getElementById("wiring-viewport"),
  paletteEl: document.getElementById("wiring-palette-list"),
  api,
  getProjectId: () => projectId,
  getWiringPrefetch,
  onChange: () => refreshFiles(),
  onHistoryChange: (state) => {
    updateWiringToolbelt(state);
    wiringBottomPanel.setHistory(state);
  },
  onStatus: (kind, text) => {
    const el = document.getElementById("wiring-prompt-status");
    if (el && text) {
      el.className = `status ${kind || ""}`;
      el.textContent = text;
    }
  },
});
wiringBottomPanel.setHistory(wiringSim.getHistoryState?.());

// ── Circuit photo debug dashboard ─────────────────────────────────────────
const wiringDebug = createWiringDebugPanel({
  getProjectId: () => projectId,
  getSchematic: () => wiringSim.getSchematic?.(),
  getAiKeyBodyFields: () => getPromptAiKeyBodyFields(),
  getGenerationSpeed: () => getWiringGenerationSpeed(),
  onApplyFocusDiagram: (schematic, focusMeta) => {
    if (!schematic) return;
    wiringSim.applyFocusPath?.(schematic, focusMeta || {});
    activityLog.push({
      level: "info",
      message: "Circuit debugger path highlighted in wiring canvas",
    });
  },
  apiFn: (url, opts, timeoutMs) => api(url, opts, timeoutMs ?? 360000),
});

document.getElementById("btn-wiring-photo-debug")?.addEventListener("click", () => {
  wiringDebug.toggle();
  if (wiringDebug.isOpen?.()) syncPromptKeyPill(aiStatus);
});

// ── Prompt mic buttons (speech-to-text for all prompt textareas) ──────────
(function initPromptMicButtons() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return; // browser doesn't support it — buttons stay hidden-ish

  let activeRec = null;   // currently running SpeechRecognition instance
  let activeBtn = null;   // the button that started it

  function stopActive() {
    if (activeRec) { try { activeRec.stop(); } catch (_) {} activeRec = null; }
    if (activeBtn) { activeBtn.classList.remove("mic-active"); activeBtn.title = "Dictate prompt (click to start/stop)"; activeBtn = null; }
  }

  document.querySelectorAll(".prompt-mic-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.micTarget;
      const textarea = document.getElementById(targetId);
      if (!textarea) return;

      // If this button is already recording — stop it
      if (btn === activeBtn) { stopActive(); return; }
      // Stop any other active recording first
      stopActive();

      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      const base = textarea.value;  // text that was there before dictation
      let committed = base;

      rec.onresult = (e) => {
        let interim = "";
        let finals = base;
        for (const r of e.results) {
          if (r.isFinal) finals += (finals && !finals.endsWith(" ") ? " " : "") + r[0].transcript;
          else interim += r[0].transcript;
        }
        committed = finals;
        textarea.value = finals + (interim ? " " + interim : "");
        // Move cursor to end
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      };

      rec.onerror = (e) => {
        if (e.error !== "aborted") stopActive();
      };

      rec.onend = () => {
        textarea.value = committed;
        if (activeRec === rec) stopActive();
      };

      rec.start();
      activeRec = rec;
      activeBtn = btn;
      btn.classList.add("mic-active");
      btn.title = "Recording… click to stop";
    });
  });
})();

// ── Canvas mode ───────────────────────────────────────────────────────────
function attachCanvasSketchImage(dataUrl, target = "design") {
  if (!dataUrl) return false;
  const entry = {
    id: `canvas-${Date.now()}`,
    name: "canvas-sketch.png",
    media_type: "image/png",
    data_url: dataUrl,
  };
  if (target === "wiring") {
    wiringPromptImages = wiringPromptImages.filter((img) => img.name !== "canvas-sketch.png");
    if (wiringPromptImages.length < 4) {
      wiringPromptImages.push(entry);
      renderWiringPromptImages();
    }
    return true;
  }
  promptImages = promptImages.filter((img) => img.name !== "canvas-sketch.png");
  if (promptImages.length < 4) {
    promptImages.push(entry);
    renderPromptImages();
    if (!restoringModelPromptState) saveActiveModelPromptState();
    return true;
  }
  return false;
}

const CANVAS_SKETCH_PROMPT_HINT =
  "Build a 3D CAD model from my attached canvas sketch reference image.";

function augmentPromptForCanvasSketch(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return CANVAS_SKETCH_PROMPT_HINT;
  if (/\b(sketch|drawing|reference image|attached canvas|canvas sketch)\b/i.test(text)) return text;
  return `${text}\n\nUse the attached canvas sketch as a visual reference for the design.`;
}

function applyCanvasSketchToPrompt({ showFeedback = false } = {}) {
  if (!document.body.classList.contains("canvas-design-tab")) return false;
  canvasModeInstance.stopVoice?.();
  if (!canvasModeInstance.hasDrawing?.()) {
    if (showFeedback) {
      const status = document.getElementById("prompt-status");
      if (status) {
        status.className = "status error";
        status.textContent = "Draw something on the canvas first.";
      }
    }
    return false;
  }
  const dataUrl = canvasModeInstance.getCanvasDataUrl?.();
  if (!dataUrl || !attachCanvasSketchImage(dataUrl, "design")) return false;
  showAiComposePanel();
  promptImageList?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  if (showFeedback) {
    const status = document.getElementById("prompt-status");
    if (status) {
      status.className = "status ok";
      status.textContent = "Canvas sketch attached to AI prompt.";
    }
  }
  return true;
}

const canvasModeInstance = createCanvasMode({
  containerEl: document.getElementById("canvas-mode-container"),
});

window.addEventListener("canvas:attach-sketch", () => {
  applyCanvasSketchToPrompt({ showFeedback: true });
});
wiringOverlay = createViewerOverlay(document.getElementById("wiring-viewport"), {
  fetchLogs: () => rawFetch("/api/logs?limit=40"),
  onStopGeneration: () => void cancelActiveGeneration(),
  getCopyContext: errorCopyContext,
});

const driverPicker = createDriverPicker({
  api,
  getProjectId: () => projectId,
  sim: wiringSim,
  onChange: ({ imported } = {}) => {
    wiringCodeUI.refresh?.();
    if (imported) refreshFiles();
  },
});

const wiringCodeUI = createWiringCodeUI({
  getSchematic: () => wiringSim.getSchematic(),
  sim: wiringSim,
  onLog: (line) => wiringBottomPanel.addLog(line),
  onLogsClear: () => wiringBottomPanel.clearLogs(),
  onAddDriver: (actuator) => driverPicker.open(actuator),
});

function openWiringCode() {
  if (!projectId) {
    setEditStatus("error", "Select a project in the sidebar first.");
    return;
  }
  wiringCodeUI.open();
}
document.getElementById("btn-wiring-code")?.addEventListener("click", openWiringCode);
document.getElementById("btn-wiring-code-panel")?.addEventListener("click", openWiringCode);
document.getElementById("btn-wiring-run-schematic")?.addEventListener("click", () => {
  if (!projectId) {
    setEditStatus("error", "Select a project in the sidebar first.");
    return;
  }
  wiringCodeUI.runSchematic?.({ show: false });
  setEditStatus("ok", "Running schematic loop in the wiring simulator.");
});

let wiringPromptImages = [];

function renderWiringPromptImages() {
  const list = document.getElementById("wiring-prompt-image-list");
  if (!list) return;
  list.innerHTML = wiringPromptImages
    .map(
      (img) => `<div class="prompt-image-card" data-id="${img.id}">
        <img src="${img.data_url}" alt="${appEscapeHtml(img.name)}" />
        <button type="button" class="prompt-image-remove" title="Remove">×</button>
      </div>`
    )
    .join("");
  list.querySelectorAll(".prompt-image-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".prompt-image-card")?.dataset.id;
      wiringPromptImages = wiringPromptImages.filter((img) => img.id !== id);
      renderWiringPromptImages();
    });
  });
}

async function addWiringPromptImages(files) {
  const allowed = ["image/png", "image/jpeg", "image/webp"];
  for (const file of [...files]) {
    if (wiringPromptImages.length >= 4) break;
    if (!allowed.includes(file.type)) continue;
    const dataUrl = await readImageFile(file);
    wiringPromptImages.push({
      id: `wimg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name,
      media_type: file.type,
      data_url: dataUrl,
    });
  }
  renderWiringPromptImages();
}

const wiringImageDrop = document.getElementById("wiring-prompt-image-drop");
const wiringImageInput = document.getElementById("wiring-prompt-image-input");
wiringImageDrop?.addEventListener("click", () => wiringImageInput?.click());
wiringImageDrop?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") wiringImageInput?.click();
});
wiringImageInput?.addEventListener("change", async (e) => {
  await addWiringPromptImages(e.target.files || []);
  e.target.value = "";
});
wiringImageDrop?.addEventListener("dragover", (e) => e.preventDefault());
wiringImageDrop?.addEventListener("drop", async (e) => {
  e.preventDefault();
  await addWiringPromptImages(e.dataTransfer?.files || []);
});

// Drop a CAD component from the browser onto the Wiring AI prompt to reference it.
const wiringPromptInput = document.getElementById("wiring-prompt-input");
const wiringInlineRefs = document.getElementById("wiring-inline-ref-chips");
let wiringPromptRefs = [];

function renderWiringPromptRefs() {
  if (!wiringInlineRefs) return;
  wiringInlineRefs.innerHTML = "";
  wiringInlineRefs.classList.toggle("hidden", wiringPromptRefs.length === 0);
  for (const ref of wiringPromptRefs) {
    const chip = document.createElement("span");
    chip.className = "ref-chip ref-chip--inline";
    chip.innerHTML = `<span class="ref-token">${appEscapeHtml(ref.token)}</span><span class="ref-coords">${appEscapeHtml(ref.label || ref.stem)}</span><button type="button" class="ref-remove" title="Remove">×</button>`;
    chip.querySelector(".ref-remove")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      wiringPromptRefs = wiringPromptRefs.filter((r) => r.id !== ref.id);
      renderWiringPromptRefs();
    });
    wiringInlineRefs.appendChild(chip);
  }
}

function addWiringPromptComponentRef(payload) {
  if (!payload?.filename && !payload?.name) return null;
  const filename = payload.filename || payload.name;
  const stem = payload.stem || filename.replace(/\.[^.]+$/, "");
  const ref = {
    id: `component:${filename}`,
    token: compactComponentToken(stem),
    label: payload.label || stem,
    stem,
    filename,
    kind: payload.part?.kind || payload.profile?.kind || payload.wiringType || "",
  };
  if (!wiringPromptRefs.some((r) => r.id === ref.id)) {
    wiringPromptRefs.push(ref);
    renderWiringPromptRefs();
  }
  return ref;
}

function wiringPromptTextWithRefs(prompt) {
  if (!wiringPromptRefs.length) return prompt;
  const refs = wiringPromptRefs
    .map((r) => `- ${r.token}: "${r.label}"${r.kind ? ` (${r.kind})` : ""} from file ${r.filename}.`)
    .join("\n");
  return `${prompt}\n\nReferenced components:\n${refs}`;
}

wiringPromptInput?.addEventListener("dragover", (e) => {
  if (isExplorerComponentDrag(e)) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    wiringPromptInput.classList.add("dragging");
  }
});
wiringPromptInput?.addEventListener("dragleave", () => wiringPromptInput.classList.remove("dragging"));
wiringPromptInput?.addEventListener("drop", (e) => {
  const payloads = droppedExplorerRefs(e).filter((ref) => !ref.type || ref.type === "component");
  if (!payloads.length) return;
  e.preventDefault();
  wiringPromptInput.classList.remove("dragging");
  let ref = null;
  payloads.forEach((payload) => {
    ref = addWiringPromptComponentRef(payload) || ref;
  });
  wiringPromptInput.focus();
  const status = document.getElementById("wiring-prompt-status");
  if (status) {
    status.className = "status ok";
    status.textContent = `Referenced ${payloads.length} component${payloads.length === 1 ? "" : "s"} in the wiring prompt.`;
  }
});

document.getElementById("btn-wiring-prompt")?.addEventListener("click", () => {
  runWiringPrompt();
});
document.getElementById("btn-wiring-stop")?.addEventListener("click", () => {
  void cancelActiveGeneration();
});
document.getElementById("btn-wiring-toolbelt-stop")?.addEventListener("click", () => {
  void cancelActiveGeneration();
});

async function runWiringPrompt() {
  if (!projectId) {
    setEditStatus("error", "Select a project in the sidebar first.");
    return;
  }
  const input = document.getElementById("wiring-prompt-input");
  const driverLinkInput = document.getElementById("wiring-driver-link-input");
  const status = document.getElementById("wiring-prompt-status");
  const prompt = input?.value?.trim();
  const driverLink = driverLinkInput?.value?.trim();
  if (!prompt) {
    if (status) {
      status.className = "status error";
      status.textContent = "Describe the circuit you want to wire.";
    }
    return;
  }
  if (status) {
    status.className = "status loading";
    status.textContent = "Generating schematic…";
  }
  lastPromptCopyContext = {
    projectId,
    filename: selectedFile,
    promptText: wiringPromptTextWithRefs(prompt),
  };
  showAiComposePanel();
  beginGenerationWatch(projectId, { kind: "wiring", pendingStart: true });
  try {
    const data = await api(`/api/projects/${projectId}/wiring/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: wiringPromptTextWithRefs(prompt),
        images: wiringPromptImages.map(({ id, name, media_type, data_url }) => ({
          id,
          name,
          media_type,
          data_url,
        })),
        driver_links: driverLink ? [driverLink] : [],
        speed: getWiringGenerationSpeed(),
        ...getPromptAiKeyBodyFields(),
      }),
    });
    lastPromptCopyContext = {
      ...lastPromptCopyContext,
      promptId: data?.prompt_id,
      traceId: data?.trace_id,
    };
    if (data?.accepted || data?.status === "running") {
      if (status) {
        status.className = "status loading";
        status.textContent = "Generating schematic… safe to refresh.";
      }
      return;
    }
    stopGenerationWatch();
    wiringSim.applySchematic(data.schematic);
    await refreshFiles();
    await refreshWiringPromptHistory();
    if (status) {
      status.className = "status ok";
      status.textContent = data.message || "Schematic updated.";
    }
    markGenerationApplied(projectId, data.trace_id);
    wiringPromptImages = [];
    wiringPromptRefs = [];
    if (driverLinkInput) driverLinkInput.value = "";
    renderWiringPromptRefs();
    renderWiringPromptImages();
  } catch (err) {
    if (!userCancelRequested) stopGenerationWatch();
    await refreshWiringPromptHistory();
    if (status) {
      const wasCanceled = userCancelRequested || err.name === "AbortError" || err.message?.toLowerCase().includes("cancel");
      status.className = wasCanceled ? "status" : "status error";
      status.textContent = wasCanceled ? "Generation canceled." : (err.message || "Wiring prompt failed.");
    }
  }
}

document.getElementById("btn-wiring-toolbelt-generate")?.addEventListener("click", () => {
  runWiringPrompt();
});

document.getElementById("btn-wiring-toolbelt-save")?.addEventListener("click", async () => {
  const status = document.getElementById("wiring-prompt-status");
  if (status) {
    status.className = "status loading";
    status.textContent = "Saving…";
  }
  try {
    await wiringSim.save();
    if (status) {
      status.className = "status ok";
      status.textContent = "Schematic saved.";
    }
  } catch (err) {
    if (status) {
      status.className = "status error";
      status.textContent = err.message || "Save failed.";
    }
  }
});

document.getElementById("btn-wiring-undo")?.addEventListener("click", () => wiringSim.undo());
document.getElementById("btn-wiring-redo")?.addEventListener("click", () => wiringSim.redo());

document.getElementById("btn-wiring-toolbelt-demo-motor")?.addEventListener("click", async () => {
  await loadWiringDemo("pi-button-motor");
});
document.getElementById("btn-wiring-toolbelt-demo-servo")?.addEventListener("click", async () => {
  await loadWiringDemo("pi-servo");
});
document.getElementById("btn-wiring-toolbelt-demo-blink")?.addEventListener("click", async () => {
  await loadWiringDemo("blink-led");
});
document.getElementById("btn-wiring-toolbelt-demo-stepper")?.addEventListener("click", async () => {
  await loadWiringDemo("stepper");
});

document.getElementById("btn-wiring-demo-motor")?.addEventListener("click", async () => {
  await loadWiringDemo("pi-button-motor");
});

document.getElementById("btn-wiring-demo")?.addEventListener("click", async () => {
  await loadWiringDemo("pi-servo");
});

document.getElementById("btn-wiring-demo-blink")?.addEventListener("click", async () => {
  await loadWiringDemo("blink-led");
});

async function loadWiringDemo(example) {
  if (!projectId) {
    setEditStatus("error", "Select a project in the sidebar first.");
    return;
  }
  const status = document.getElementById("wiring-prompt-status");
  if (status) {
    status.className = "status loading";
    status.textContent = "Loading demo circuit…";
  }
  try {
    const data = await wiringSim.loadDemo(example);
    await refreshFiles();
    if (status) {
      status.className = "status ok";
      status.textContent = data?.message || "Demo schematic loaded.";
    }
  } catch (err) {
    if (status) {
      status.className = "status error";
      status.textContent = err.message || "Could not load demo.";
    }
  }
}

async function loadGearTrainDemo({ switchToRigging = false } = {}) {
  if (!projectId) {
    setEditStatus("error", "Select a project in the sidebar first.");
    return;
  }
  const designStatus = document.getElementById("prompt-status");
  const rigStatus = document.getElementById("rigging-prompt-status");
  const setStatus = (kind, text) => {
    for (const el of [designStatus, rigStatus]) {
      if (!el) continue;
      el.className = `status ${kind}`;
      el.textContent = text;
    }
  };
  setStatus("loading", "Building mounted 2-gear train…");
  showViewportOverlay(projectId, "Building gear train…", { mode: "build", estimateMs: 120000 });
  let failed = false;
  try {
    workspaceModes.setDesignTab("SOLID");
    ribbon?.setDesignTab("SOLID");
    exitRiggingMode();
    const data = await api(`/api/projects/${projectId}/design/demo/gear-train`, { method: "POST" });
    selectedFile = data.filename;
    await refreshFiles();
    await loadModel(data.url, data.filename);
    window.dispatchEvent(new CustomEvent("render3d:model", { detail: { ...data, projectId } }));
    await refreshTimeline();
    if (data.rigging) {
      riggingEditor.applyRigData(data.rigging);
    }
    setStatus("ok", data.message || "Mounted gear train ready.");
    setEditStatus("ok", "Gear model loaded in SOLID. Orange spheres in RIGGING mark shaft joints.");
    viewerOverlay.clearError();
    if (switchToRigging) {
      workspaceModes.setDesignTab("RIGGING");
      enterRiggingMode();
      showAiComposePanel();
    } else {
      showAiComposePanel();
    }
  } catch (err) {
    failed = true;
    const msg = formatUserError(err);
    setStatus("error", msg);
    setEditStatus("error", msg);
    viewerOverlay.showError(msg);
  } finally {
    hideViewportOverlay(projectId, { complete: !failed });
  }
}

function clearWiringPrompts() {
  const input = document.getElementById("wiring-prompt-input");
  if (input) input.value = "";
  const driverLinkInput = document.getElementById("wiring-driver-link-input");
  if (driverLinkInput) driverLinkInput.value = "";
  wiringPromptImages = [];
  renderWiringPromptImages();
  const status = document.getElementById("wiring-prompt-status");
  if (status) {
    status.className = "status";
    status.textContent = "";
  }
}

let riggingPromptImages = [];

function renderRiggingPromptImages() {
  const list = document.getElementById("rigging-prompt-image-list");
  if (!list) return;
  list.innerHTML = riggingPromptImages
    .map(
      (img) => `<div class="prompt-image-card" data-id="${img.id}">
        <img src="${img.data_url}" alt="${appEscapeHtml(img.name)}" />
        <button type="button" class="prompt-image-remove" title="Remove">×</button>
      </div>`
    )
    .join("");
  list.querySelectorAll(".prompt-image-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".prompt-image-card")?.dataset.id;
      riggingPromptImages = riggingPromptImages.filter((img) => img.id !== id);
      renderRiggingPromptImages();
    });
  });
}

async function addRiggingPromptImages(files) {
  const allowed = ["image/png", "image/jpeg", "image/webp"];
  for (const file of [...files]) {
    if (riggingPromptImages.length >= 4) break;
    if (!allowed.includes(file.type)) continue;
    const dataUrl = await readImageFile(file);
    riggingPromptImages.push({
      id: `rimg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name,
      media_type: file.type,
      data_url: dataUrl,
    });
  }
  renderRiggingPromptImages();
}

const riggingImageDrop = document.getElementById("rigging-prompt-image-drop");
const riggingImageInput = document.getElementById("rigging-prompt-image-input");
riggingImageDrop?.addEventListener("click", () => riggingImageInput?.click());
riggingImageDrop?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") riggingImageInput?.click();
});
riggingImageInput?.addEventListener("change", async (e) => {
  await addRiggingPromptImages(e.target.files || []);
  e.target.value = "";
});
riggingImageDrop?.addEventListener("dragover", (e) => e.preventDefault());
riggingImageDrop?.addEventListener("drop", async (e) => {
  e.preventDefault();
  await addRiggingPromptImages(e.dataTransfer?.files || []);
});

document.getElementById("btn-rigging-prompt")?.addEventListener("click", () => {
  runRiggingPrompt();
});

async function runRiggingPrompt() {
  if (!projectId) {
    setEditStatus("error", "Select a project in the sidebar first.");
    return;
  }
  const input = document.getElementById("rigging-prompt-input");
  const status = document.getElementById("rigging-prompt-status");
  const prompt = input?.value?.trim();
  if (!prompt) {
    if (status) {
      status.className = "status error";
      status.textContent = "Describe the robot rig or animation you want.";
    }
    return;
  }
  if (status) {
    status.className = "status loading";
    status.textContent = "Generating rig…";
  }
  try {
    const data = await api(`/api/projects/${projectId}/rigging/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        images: riggingPromptImages.map(({ id, name, media_type, data_url }) => ({
          id,
          name,
          media_type,
          data_url,
        })),
        speed: document.getElementById("prompt-speed")?.value || "fast",
      }),
    });
    riggingEditor.applyRigData(data.rigging);
    await refreshFiles();
    await refreshRobotArtifacts({ quiet: true });
    await refreshRiggingPromptHistory();
    if (status) {
      status.className = "status ok";
      status.textContent = data.message || "Rig updated.";
    }
    riggingPromptImages = [];
    renderRiggingPromptImages();
  } catch (err) {
    await refreshRiggingPromptHistory();
    if (status) {
      status.className = "status error";
      status.textContent = err.message || "Rigging prompt failed.";
    }
  }
}

document.getElementById("btn-rigging-toolbelt-generate")?.addEventListener("click", () => {
  runRiggingPrompt();
});

document.getElementById("btn-rigging-toolbelt-save")?.addEventListener("click", async () => {
  await riggingEditor.save();
  setEditStatus("ok", "Rig saved.");
});

document.getElementById("btn-rigging-toolbelt-export")?.addEventListener("click", async () => {
  await riggingEditor.exportUrdf();
  await refreshFiles();
  await refreshRobotArtifacts({ quiet: true });
});

async function simulateRiggingModel() {
  if (selectedFile) await loadSimForFile(selectedFile);
  await riggingEditor.show();
  const result = riggingEditor.simulateModel?.();
  syncRiggingToolbelt();
  return result;
}

document.getElementById("btn-rigging-toolbelt-simulate")?.addEventListener("click", () => {
  void simulateRiggingModel();
});

document.getElementById("btn-rigging-toolbelt-auto")?.addEventListener("click", () => {
  handleRiggingAction("auto");
});

async function generateRobotArtifacts(kind = "both") {
  if (!projectId) {
    setEditStatus("error", "Select a project first.");
    return;
  }
  const source = document.getElementById("rigging-artifact-source")?.value;
  const status = document.getElementById("rigging-prompt-status");
  if (!source) {
    setEditStatus("error", "No Python source selected for URDF/SRDF generation.");
    if (status) {
      status.className = "status error";
      status.textContent = "No Python source selected.";
    }
    return;
  }
  if (status) {
    status.className = "status loading";
    status.textContent = `Generating ${kind.toUpperCase()} robot artifacts…`;
  }
  try {
    const data = await api(`/api/projects/${projectId}/rigging/generate-artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, kind }),
    });
    robotArtifactData = data;
    await refreshFiles();
    renderRobotArtifacts();
    const outputs = (data.outputs || []).map((out) => out.filename).filter(Boolean).join(", ");
    const errors = (data.errors || []).length;
    const msg = outputs
      ? `Generated ${outputs}${errors ? ` (${errors} warning${errors === 1 ? "" : "s"})` : ""}.`
      : data.message || "No robot artifacts generated.";
    setEditStatus(errors ? "error" : "ok", msg);
    if (status) {
      status.className = errors ? "status error" : "status ok";
      status.textContent = msg;
    }
  } catch (err) {
    await refreshRobotArtifacts({ quiet: true });
    const msg = err?.message || "Robot artifact generation failed.";
    setEditStatus("error", msg);
    if (status) {
      status.className = "status error";
      status.textContent = msg;
    }
  }
}

document.getElementById("btn-rigging-artifacts-refresh")?.addEventListener("click", () => refreshRobotArtifacts());
document.getElementById("btn-rigging-generate-urdf")?.addEventListener("click", () => generateRobotArtifacts("urdf"));
document.getElementById("btn-rigging-generate-srdf")?.addEventListener("click", () => generateRobotArtifacts("srdf"));
document.getElementById("btn-rigging-generate-robot")?.addEventListener("click", () => generateRobotArtifacts("both"));

document.getElementById("btn-rigging-demo-gear-train")?.addEventListener("click", () => {
  loadGearTrainDemo({ switchToRigging: true });
});

document.getElementById("btn-rigging-demo-arm")?.addEventListener("click", () => {
  const input = document.getElementById("rigging-prompt-input");
  if (input) {
    input.value =
      "4-DOF robot arm: base_link fixed at origin, link_1 shoulder revolute Z (+/- 180°), link_2 upper arm revolute Z, link_3 forearm revolute Z, ee_link gripper. Animate a 4-second pick cycle: home → reach → grasp → home.";
  }
  runRiggingPrompt();
});

document.querySelectorAll("[data-rig-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    handleRiggingAction("tool", { rigTool: btn.dataset.rigTool }, { tool: btn.dataset.rigTool });
  });
});

document.querySelectorAll("[data-rig-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    handleRiggingAction(btn.dataset.rigAction);
  });
});

document.querySelectorAll("[data-rig-pick]").forEach((btn) => {
  btn.addEventListener("click", () => {
    activatePickMode(btn.dataset.rigPick);
    document.querySelectorAll("[data-rig-pick]").forEach((b) => {
      b.classList.toggle("active", b.dataset.rigPick === btn.dataset.rigPick);
    });
  });
});

function enterWiringMode() {
  catalogPanel?.close?.();
  resetComposerForProject();
  clearWiringPrompts();
  transformControls.detach();
  gizmoPanel.hide();
  document.getElementById("btn-gizmo")?.classList.remove("active");
  objectTools.clearSelection();
  activatePickMode("off");
  controls.enabled = true;
  refreshWiringPromptHistory();
}

function handleWiringTabChange(tab) {
  if (tab === "CATALOG") {
    exitCanvasTab();
    exitSketchMode();
    exitRiggingMode();
    catalogPanel?.open?.();
    setEditStatus("ok", "Catalog — search STEP models, compare supplier prices, and import parts into your wiring project.");
    return;
  }
  catalogPanel?.close?.();
  setRightTab("wiring");
  wiringPromptHistory.setTab("compose");
  setEditStatus("ok", "Wiring Simulator — build and debug circuits.");
}

function applyWorkspaceMode(mode) {
  const app = document.getElementById("app");
  const wiringWorkspace = document.getElementById("wiring-workspace");
  app?.classList.toggle("wiring-mode", mode === "wiring");
  document.body.classList.toggle("wiring-mode", mode === "wiring");
  if (mode === "wiring") {
    exitSketchMode();
    exitRiggingMode();
    exitArchitectMode();
    exitCanvasTab();
    wiringWorkspace?.classList.remove("hidden");
    setRightTab("wiring");
    wiringPromptHistory.setTab("compose");
    enterWiringMode();
    wiringSim.show();
    window.dispatchEvent(new Event("resize"));
  } else {
    catalogPanel?.close?.();
    wiringWorkspace?.classList.add("hidden");
    clearWiringPrompts();
    wiringSim.hide();
    const tab = workspaceModes.getDesignTab();
    if (tab === "CANVAS") {
      enterCanvasTab();
    } else if (tab === "ARCHITECT") {
      enterArchitectMode();
    } else {
      exitCanvasTab();
      exitArchitectMode();
      setRightTab("prompt");
      promptHistory.setTab("compose");
    }
    resize();
    if (currentMesh && tab !== "CANVAS" && tab !== "ARCHITECT") fitCamera();
    if (tab === "RIGGING") enterRiggingMode();
    else exitRiggingMode();
    if (tab === "ARCHITECT") enterArchitectMode();
  }
}

const workspaceModes = createWorkspaceModes({
  barEl: document.getElementById("workspace-mode-btn"),
  menuEl: document.getElementById("workspace-mode-menu"),
  tabsEl: document.getElementById("workspace-tabs"),
  onChange: (mode) => applyWorkspaceMode(mode),
  onDesignTabChange: (tab) => handleDesignTabChange(tab),
  onWiringTabChange: (tab) => handleWiringTabChange(tab),
});

document.getElementById("canvas-gen-view-solid")?.addEventListener("click", () => {
  workspaceModes?.setDesignTab?.("SOLID");
  refreshViewportAfterLayoutChange({ fit: !!currentMesh });
});

document.addEventListener("workspace-folders-changed", () => {
  refreshWorkspaceHistory();
  fetchAllProjects().then(() => renderProjectList());
});

function syncExplorerLoadingUI() {
  workspaceBrowser?.render?.();
  projectTree?.setLoading?.(!!(projectId && loadingProjectIds.has(projectId)));
}

function setProjectLoading(id, loading) {
  if (!id) return;
  if (loading) loadingProjectIds.add(id);
  else loadingProjectIds.delete(id);
  syncExplorerLoadingUI();
}

function renderProjectList() {
  window.__appProjectListReady = true;
  workspaceBrowser.render();
}

function setProjectHeader(name, id) {
  const el = document.getElementById("project-id");
  const btn = document.getElementById("btn-rename-project");
  const exportBtn = document.getElementById("btn-export-model");
  if (!el) return;
  if (!id) {
    el.textContent = "—";
    if (btn) btn.disabled = true;
    if (exportBtn) exportBtn.disabled = true;
    return;
  }
  el.textContent = name && name !== id ? `${name} (${id})` : id;
  if (btn) btn.disabled = false;
  syncExportButton();
}

function syncExportButton() {
  const exportBtn = document.getElementById("btn-export-model");
  if (!exportBtn) return;
  const hasVisibleLoaded = projectAssembly
    .list()
    .some(([name, obj]) => obj?.visible !== false && !isComponentHidden(name));
  const hasVisibleBrowser = (projectTree.getComponents?.() || []).some((entry) => !isBrowserComponentHidden(entry));
  exportBtn.disabled = !(projectId && (hasVisibleBrowser || hasVisibleLoaded || (selectedFile && !isComponentHidden(selectedFile))));
}

async function exportCurrentModel(anchorEl) {
  if (!projectId) {
    alert("Open a project first.");
    return;
  }
  const visibleLoaded = projectAssembly
    .list()
    .filter(([name, obj]) => obj?.visible !== false && !isComponentHidden(name))
    .map(([name]) => name);
  const visibleBrowser = (projectTree.getComponents?.() || [])
    .filter((entry) => !isBrowserComponentHidden(entry))
    .map((entry) => entry.name)
    .filter(Boolean);
  const visibleFiles = visibleBrowser.length ? visibleBrowser : visibleLoaded;
  const anchor = anchorEl || document.getElementById("btn-export-model") || document.body;
  if (visibleFiles.length > 1) {
    const regularFile = selectedFile && visibleFiles.includes(selectedFile) && !isComponentHidden(selectedFile)
      ? selectedFile
      : visibleFiles[0];
    const regularStepName = String(regularFile || "").replace(/\.[^.]+$/, ".step");
    await openFileExportMenu({
      api,
      projectId,
      filename: "visible assembly",
      anchorEl: anchor,
      title: `Export visible assembly`,
      hint: `Choose regular STEP for one selected part, or assembly STEP for all ${visibleFiles.length} visible components.`,
      allowOnshape: false,
      extraExports: regularStepName ? [{
        name: regularStepName,
        format: "step",
        size: null,
        label: "STEP (regular part)",
        url: `/api/projects/${projectId}/files/${encodeURIComponent(regularStepName)}`,
      }] : [],
      exportsRequest: {
        path: `/api/projects/${projectId}/assembly/exports`,
        options: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filenames: visibleFiles }),
        },
      },
    });
    return;
  }
  let file = visibleFiles[0] || selectedFile || allProjects.find((p) => p.id === projectId)?.latest_file;
  if (isComponentHidden(file)) file = null;
  if (!file) {
    alert("No visible component to export. Show at least one component first.");
    return;
  }
  await openFileExportMenu({ api, projectId, filename: file, anchorEl: anchor });
}

function openRenameDialog({
  title = "Rename",
  eyebrow = "Rename",
  description = "",
  label = "Name",
  value = "",
  placeholder = "Enter a name",
  confirmText = "Rename",
} = {}) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "auth-modal app-rename-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <div class="auth-backdrop app-rename-backdrop" data-rename-cancel></div>
      <div class="auth-card app-dialog-card app-rename-card">
        <button type="button" class="auth-close app-rename-close" data-rename-cancel aria-label="Close">&times;</button>
        <div class="app-rename-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11.5 4.5l4 4L7 17H3v-4l8.5-8.5z"></path>
            <path d="M10 6l4 4"></path>
          </svg>
        </div>
        <p class="app-rename-eyebrow">${appEscapeHtml(eyebrow)}</p>
        <h2 class="app-dialog-title app-rename-title">${appEscapeHtml(title)}</h2>
        ${description ? `<p class="app-rename-description">${appEscapeHtml(description)}</p>` : ""}
        <label class="app-dialog-label app-rename-label">${appEscapeHtml(label)}
          <input type="text" class="app-rename-input" value="${appEscapeHtml(value)}" placeholder="${appEscapeHtml(placeholder)}" maxlength="180" spellcheck="false" />
        </label>
        <p class="auth-error hidden app-rename-error"></p>
        <div class="app-dialog-actions app-rename-actions">
          <button type="button" class="btn secondary" data-rename-cancel>Cancel</button>
          <button type="button" class="btn accent app-rename-submit">${appEscapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    const input = modal.querySelector(".app-rename-input");
    const error = modal.querySelector(".app-rename-error");
    const cleanup = (result) => {
      document.removeEventListener("keydown", onKey);
      modal.remove();
      resolve(result);
    };
    const showError = (message) => {
      if (!error) return;
      error.textContent = message;
      error.classList.remove("hidden");
    };
    const submit = () => {
      const next = input?.value?.trim() || "";
      if (!next) {
        showError("Name cannot be empty.");
        input?.focus();
        return;
      }
      cleanup(next);
    };
    function onKey(event) {
      if (event.key === "Escape") cleanup(null);
      if (event.key === "Enter" && document.activeElement === input) {
        event.preventDefault();
        submit();
      }
    }
    modal.querySelectorAll("[data-rename-cancel]").forEach((el) => {
      el.addEventListener("click", () => cleanup(null));
    });
    modal.querySelector(".app-rename-submit")?.addEventListener("click", submit);
    input?.addEventListener("input", () => error?.classList.add("hidden"));
    document.addEventListener("keydown", onKey);
    document.body.appendChild(modal);
    setTimeout(() => {
      input?.focus();
      input?.select();
    }, 30);
  });
}

async function renameProject(p) {
  const current = p.name || p.id;
  const trimmed = await openRenameDialog({
    eyebrow: "Current project",
    title: "Rename Project",
    description: "Give this project a clear name for the explorer, history, and sharing menus.",
    label: "Project name",
    value: current,
    confirmText: "Save name",
  });
  if (trimmed === null) return;
  if (trimmed === current) return;

  try {
    const data = await api(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    updateProjectNameLocal(p.id, data.name || trimmed, data.meta);
    try {
      await fetchAllProjects();
    } catch (err) {
      console.warn("Project list refresh after rename failed", err);
    }
    renderProjectList();
  } catch (err) {
    alert(err.message || "Failed to rename project");
  }
}

async function makeProjectPublic(p) {
  if (!p?.id || p.read_only_project || p.public) return;
  const name = p.name || p.id;
  if (!window.confirm(`Make "${name}" public?\n\nAnyone, including people without an account, will be able to view and download this model.`)) {
    return;
  }
  try {
    await api(`/api/projects/${p.id}/public`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public: true }),
    });
    await fetchAllProjects();
    renderProjectList();
    setEditStatus("ok", `"${name}" is now public.`);
  } catch (err) {
    alert(err.message || "Could not make project public");
  }
}

async function deleteProject(p) {
  const name = p.name || p.id;
  const warned = window.confirm(
    `Delete project "${name}"?\n\n` +
      "This permanently removes all files, models, timeline, and history for this project from disk.\n\n" +
      "This cannot be undone."
  );
  if (!warned) return;

  const absolutely = window.confirm(
    `Are you absolutely sure you want to delete "${name}"?\n\n` +
      "Click OK only if you want to permanently delete this project."
  );
  if (!absolutely) return;

  try {
    await api(`/api/projects/${p.id}`, { method: "DELETE" });
  } catch (err) {
    alert(err.message || "Failed to delete project");
    return;
  }

  if (generationWatchPid === p.id) stopGenerationWatch();

  if (projectId === p.id) {
    projectId = null;
    wiringDebug.setProjectId?.(null);
    selectedFile = null;
    try {
      localStorage.removeItem(LS_LAST_PROJECT);
    } catch (_) {}
    clearModel();
    composer.clearReferences();
    resetRefCounter();
    setProjectHeader(null, null);
    document.getElementById("file-list").innerHTML = "";
    timeline.setTimeline({ entries: [], current_index: 0 });
    promptHistory.render([]);
    promptHistory.setCountBadge(0);
  }

  await fetchAllProjects();
  renderProjectList();

  if (projectId) return;

  const next = allProjects[0];
  if (next) {
    await loadProject(next.id);
  } else {
    await createNewProject();
  }
}

function appEscapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function openProjectById(id) {
  if (!id) return;
  try {
    // Stay in wiring/canvas mode when picking projects from those views.
    // Only reset to design for other non-design modes (sketch, rigging, etc.).
    const mode = workspaceModes.getMode();
    if (mode !== "design" && mode !== "architect" && mode !== "wiring" && mode !== "canvas") {
      workspaceModes.setMode("design");
      applyWorkspaceMode("design");
    }
    await loadProject(id);
  } catch (err) {
    console.error("openProject failed:", err);
    setEditStatus("error", err.message || "Could not open project");
  }
}

window.__openProject = openProjectById;

async function refreshProjectShell({ refreshInvites = false, refreshMembers = false } = {}) {
  try {
    // Skip the full project list reload while a generation is actively running so the
    // active project is not displaced from the sidebar by an incoming WS event.
    if (!isGenerationUiActive(projectId)) {
      await fetchAllProjects();
      renderProjectList();
      workspaceBrowser.refresh();
    }
  } catch (err) {
    console.warn("Realtime project refresh failed", err);
  }
  if (refreshInvites) refreshTeamInvitesRealtime();
  if (refreshMembers) refreshTeamMembersRealtime();
  const workspacePanel = document.getElementById("profile-workspace-panel");
  if (workspacePanel && !workspacePanel.classList.contains("hidden")) {
    refreshWorkspacePanelRealtime();
  }
}

function updateProjectNameLocal(projectIdToUpdate, name, meta = null) {
  if (!projectIdToUpdate || !name) return;
  upsertProjectInList({
    id: projectIdToUpdate,
    name,
    ...(meta?.updated_at ? { updated_at: meta.updated_at } : {}),
  });
  if (projectId === projectIdToUpdate) {
    setProjectHeader(name, projectIdToUpdate);
  }
  renderProjectList();
}

function projectSummaryFromRealtime(msg = {}) {
  const entry = msg.entry || {};
  const meta = msg.meta || entry.meta || {};
  const id = msg.project_id || entry.project_id || meta.project_id;
  if (!id) return null;
  const label = msg.name || meta.name || meta.project_name || entry.label || id;
  const name = String(label)
    .replace(/^Imported\s+/i, "")
    .replace(/\s+from\s+(Autodesk|Onshape)$/i, "")
    .trim() || id;
  return {
    id,
    name,
    team_id: msg.team_id || entry.team_id || meta.team_id,
    updated_at: msg.updated_at || meta.updated_at || entry.created_at,
    created_at: msg.created_at || meta.created_at || entry.created_at,
    file_count: msg.file_count ?? meta.file_count ?? 0,
  };
}

function handleRealtimeEvent(msg = {}) {
  if (!msg?.type) return;
  if (msg.entry) workspaceActivity.prependEntry(msg.entry);

  if (msg.type === "generation.updated") {
    const pid = msg.project_id;
    if (pid) {
      upsertProjectInList({ id: pid, generation: msg.generation || { status: "idle" } });
      renderProjectList();
      if (pid === projectId) syncViewportGenerationOverlay();
    }
    return;
  }

  if (msg.type === "project.meta" || msg.type === "project.renamed") {
    updateProjectNameLocal(msg.project_id || projectId, msg.name, msg.meta);
    return;
  }

  if (msg.type === "model.reload") {
    void applyLiveModelReload(msg, msg.project_id || projectId);
    if (msg.timeline_entry) void refreshTimeline();
    return;
  }

  if (msg.type === "drawing.added") {
    if ((msg.project_id || projectId) === projectId) {
      void refreshFiles();
      setEditStatus("ok", `Added DXF drawing ${msg.filename}. Open it from DXF Drawings when needed.`);
    }
    return;
  }

  if (msg.type === "project.created" || msg.type === "project.deleted") {
    if (msg.type === "project.deleted" && msg.project_id === projectId) {
      showEmptyProjectViewport({ message: "This project was deleted by a teammate." });
      projectId = null;
      wiringDebug.setProjectId?.(null);
      selectedFile = null;
    }
    if (msg.type === "project.created" && msg.project_id) {
      upsertProjectInList({
        id: msg.project_id,
        name: msg.name || msg.meta?.name || msg.project_id,
        updated_at: msg.meta?.updated_at,
        created_at: msg.meta?.created_at,
        file_count: 0,
      });
      renderProjectList();
      if (msg.project_id === projectId) return;
    }
    refreshProjectShell();
    return;
  }

  if (msg.type === "team.invite.created" || msg.type === "team.invites.changed") {
    refreshProjectShell({ refreshInvites: true });
    return;
  }

  if (msg.type === "workspace.invite.updated" || msg.type === "workspace.member.updated" || msg.type === "workspace.updated") {
    const summary = projectSummaryFromRealtime(msg);
    if (summary) {
      upsertProjectInList(summary);
      renderProjectList();
    }
    refreshProjectShell({ refreshInvites: true, refreshMembers: true });
  }
  if (msg.type === "workspace.render_folder.updated") {
    if (msg.team) {
      const idx = allTeams.findIndex((team) => team.id === msg.team.id);
      if (idx >= 0) allTeams[idx] = { ...allTeams[idx], ...msg.team };
    }
    void refreshWorkspaceRealtimeEditor();
  }
}

async function loadProject(id) {
  const loadGen = ++loadProjectGeneration;
  setProjectLoading(id, true);
  const wiringMode = workspaceModes?.isWiring?.() ?? false;
  let wiringLoadPromise = null;
  try {
    saveActiveModelPromptState();
    const prevProjectId = projectId;
    prefetchWiringForProject(id);
    projectId = id;
    if (wiringMode) wiringLoadPromise = wiringSim.load();
    renderPromptAiKeySelect(aiStatus, { preserveSelection: prevProjectId === id });
    wiringDebug.setProjectId?.(id);
    ribbon?.setProjectId?.(id);
    saveLastProjectId(id);
    // Clear any new-model badge when the user opens this project.
    if (newlyCompletedProjects.has(id)) {
      newlyCompletedProjects.delete(id);
      renderProjectList();
    }
    if (prevProjectId !== id) {
      viewportUndoStack.length = 0;
      dxfViewer?.closeAll?.();
      showEmptyProjectViewport({ keepBrowser: true });
      window.dispatchEvent(new CustomEvent("render3d:project-changed", { detail: { projectId: id } }));
      // If Architect is open, reload that project's building.json (additive; Design path unchanged).
      if (architectSession?.isActive?.()) {
        void architectSession.enter();
      }
      // If this project is known to be generating (from cache) but we're not watching it,
      // start the watch immediately so the stop button appears before the API call returns.
      if (generationWatchPid !== id && isProjectGenerating(id)) {
        const cached = allProjects.find((p) => p.id === id);
        beginGenerationWatch(id, {
          kind: cached?.generation?.kind || "prompt",
          mode: generationPromptMode(cached?.generation),
        });
      }
      syncViewportGenerationOverlay();
      syncStopButtonVisibility();
    }
    if (currentUser) {
      collab.connect(projectId, currentUser, {
        getMeshRoot: () => currentMesh,
        onModelReload: async (msg) => {
          await applyLiveModelReload(msg, id);
        },
        onProjectMeta: (msg) => handleRealtimeEvent(msg),
        onTimeline: () => refreshTimeline(),
        onProjectHistory: () => refreshObjectHistory(),
        onWorkspaceUpdated: (msg) => handleRealtimeEvent(msg),
      });
    }
  const data = await api(projectApiPath(id));
    if (loadGen !== loadProjectGeneration) return;

  setProjectHeader(data.name, id);
    timelineData = data.timeline;
  const cur = timelineData?.current_index ?? -1;
  const max = Math.max(0, (timelineData?.entries?.length || 1) - 1);
  timeline.setTimeline(timelineData, {
    scroll: true,
    scrollAlign: cur >= max ? "end" : "auto",
  });
  renderProjectList();
    renderFileList(data.files || []);
    const browser = normalizeBrowser(data);
    const modelLatestFile = isDxfDrawingFilename(data.latest_file) ? null : data.latest_file;
    upsertProjectInList({
      id,
      ...data,
      browser,
      name: data.name || id,
    });
    renderProjectList();
    captureSessionSnapshot();
    renderProjectBrowser(browser);
    if (wiringMode) {
      void hydrateBrowserBodyChildren(browser);
    } else {
      await hydrateBrowserBodyChildren(browser);
    }
    if (currentUser && !wiringMode) {
      await sketchEditor.loadProjectSketches?.(projectId, api, browser.sketches);
    }
    syncSketchVisibilityFromTree(browser);
    const comps = browser.components || [];
    if (!wiringMode) prepareViewportForModels();
    if (comps.length && !wiringMode) {
      const alreadyLoaded = prevProjectId === id && componentsAlreadyLoaded(comps, modelLatestFile);
      if (alreadyLoaded) {
        for (const comp of comps) {
          setAssemblyComponentVisible(comp, !isBrowserComponentHidden(comp));
        }
        const visibleComps = comps.filter((c) => !isBrowserComponentHidden(c));
        selectedFile = (visibleComps.find((c) => c.name === modelLatestFile || c.viewer_filename === modelLatestFile) || visibleComps[0])?.name || null;
        projectTree.setSelected(selectedFile);
        if (selectedFile) selectAssemblyComponent(selectedFile, { fitView: true });
        else {
          objectTools.clearSelection?.();
          transformControls.detach();
          gizmoPanel.hide();
          setEditStatus("ok", "All components are hidden.");
        }
        if (currentUser) await refreshPromptHistory();
      } else {
        await loadProjectComponents(comps, {
          projectId: id,
          latestFile: modelLatestFile,
          loadGen,
          fitView: true,
        });
        if (currentUser) await refreshPromptHistory();
      }
    } else if (!comps.length) {
      showEmptyProjectViewport();
      if (currentUser) await refreshPromptHistory();
    } else if (currentUser) {
      await refreshPromptHistory();
    }
    if (loadGen !== loadProjectGeneration) return;
    safeRestoreActiveModelPromptState();
    if (wiringMode && wiringLoadPromise) {
      await wiringLoadPromise;
    }
    if (currentUser) await resumeGenerationIfNeeded(id, data.generation);
    if (loadGen !== loadProjectGeneration) return;
    // If resumeGenerationIfNeeded applied a completion for this project,
    // clear any badge that was set — the user is already viewing the model.
    if (newlyCompletedProjects.has(id)) {
      newlyCompletedProjects.delete(id);
      renderProjectList();
    }
    // Ensure stop button reflects current state after resumeGenerationIfNeeded runs.
    syncStopButtonVisibility();
    if (!currentUser) {
      showAiComposePanel();
    } else if (wiringMode) {
      clearWiringPrompts();
      if (!wiringLoadPromise) await wiringSim.load();
      refreshWiringPromptHistory();
      showAiComposePanel();
    } else {
      showAiComposePanel();
    }
  } catch (err) {
    console.error("loadProject failed:", err);
    setEditStatus("error", err.message || "Could not load project");
    viewerOverlay.showError(err.message || "Could not load project");
  } finally {
    setProjectLoading(id, false);
    if (loadGen === loadProjectGeneration) {
      syncViewportGenerationOverlay();
      syncStopButtonVisibility();
    }
  }
}

async function createNewProject() {
  saveActiveModelPromptState();
  const teamId = getFolderTeamId();
  if (!teamId) {
    setEditStatus("error", "Could not find a workspace for the new project.");
    return;
  }
  writeSavedWorkspaceId(teamId);
  const teamSelect = document.getElementById("team-select");
  if (teamSelect && [...teamSelect.options].some((opt) => opt.value === teamId)) {
    teamSelect.value = teamId;
  }
  const qs = `?team_id=${encodeURIComponent(teamId)}`;
  const { project_id, meta } = await api(`/api/projects${qs}`, { method: "POST" });
  upsertProjectInList({
    id: project_id,
    name: meta?.name || `Project ${project_id}`,
    created_at: meta?.created_at,
    updated_at: meta?.updated_at,
    file_count: 0,
  });
  renderProjectList();
  ribbon.reset();
  await fetchAllProjects();
  await loadProject(project_id);
}

async function createNewProjectInFolder(folderId) {
  saveActiveModelPromptState();
  const teamId = getFolderTeamId();
  if (!teamId) {
    throw new Error("Could not find a workspace for the new project.");
  }
  writeSavedWorkspaceId(teamId);
  const teamSelect = document.getElementById("team-select");
  if (teamSelect && [...teamSelect.options].some((opt) => opt.value === teamId)) {
    teamSelect.value = teamId;
  }
  const qs = `?team_id=${encodeURIComponent(teamId)}`;
  const { project_id, meta } = await api(`/api/projects${qs}`, { method: "POST" });
  if (folderId) {
    await api(`/api/projects/${project_id}/folder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id: folderId }),
    });
  }
  upsertProjectInList({
    id: project_id,
    name: meta?.name || `Project ${project_id}`,
    created_at: meta?.created_at,
    updated_at: meta?.updated_at,
    file_count: 0,
    folder_id: folderId || null,
  });
  ribbon.reset();
  await fetchAllProjects();
  await loadProject(project_id);
  renderProjectList();
}

async function ensureProject() {
  if (projectId) {
    ribbon.setProjectId(projectId);
    return projectId;
  }
  try {
  await fetchAllProjects();
  } catch {
    return null;
  }
  if (!projectFetchSucceeded) return null;
  const last = localStorage.getItem(LS_LAST_PROJECT);
  const match = last ? allProjects.find((p) => p.id === last) : null;
  const withFiles = allProjects.find((p) => (p.file_count ?? p.files?.length ?? 0) > 0);
  if (match) {
    await loadProject(match.id);
    return projectId;
  }
  if (withFiles) {
    await loadProject(withFiles.id);
    return projectId;
  }
  if (allProjects.length) {
    await loadProject(allProjects[0].id);
    return projectId;
  }
  await createNewProject();
  return projectId;
}

/** Keep viewport drops on the active project — never switch projects or auto-create when one is open. */
async function ensureProjectForUpload() {
  if (projectId) {
    ribbon.setProjectId(projectId);
    return projectId;
  }
  await fetchAllProjects();
  const activeId = document.querySelector(".proj-item.active")?.dataset?.projectId;
  if (activeId && allProjects.some((p) => p.id === activeId)) {
    await loadProject(activeId);
    return projectId;
  }
  const last = localStorage.getItem(LS_LAST_PROJECT);
  const match = last ? allProjects.find((p) => p.id === last) : null;
  if (match) {
    await loadProject(match.id);
    return projectId;
  }
  if (allProjects.length) {
    await loadProject(allProjects[0].id);
    return projectId;
  }
  await createNewProject();
  return projectId;
}

async function refreshTimeline() {
  if (!projectId) return;
  timelineData = await api(`/api/projects/${projectId}/timeline`);
  const cur = timelineData?.current_index ?? -1;
  const max = Math.max(0, (timelineData?.entries?.length || 1) - 1);
  timeline.setTimeline(timelineData, {
    scroll: true,
    scrollAlign: cur >= max ? "end" : "auto",
  });
  await refreshObjectHistory();
}

async function refreshObjectHistory() {
  if (!projectId) return;
  try {
    const data = await api(`/api/projects/${projectId}/project-history`);
    objectHistory.render(data.entries || []);
    const cur = timelineData?.current_index;
    if (cur != null && cur >= 0) objectHistory.highlightActive(cur);
  } catch {
    objectHistory.render([]);
  }
}

async function refreshWorkspaceHistory() {
  const teamId = getSelectedWorkspaceId();
  if (!teamId) {
    workspaceActivity.render([]);
    return;
  }
  try {
    const data = await api(`/api/teams/${teamId}/workspace-history`);
    workspaceActivity.render(data.entries || []);
  } catch {
    workspaceActivity.render([]);
  }
}

const WORKSPACE_FUSION_AUTO_SYNC_MS = 30000;
let workspaceFusionAutoSyncTimer = null;
let workspaceFusionAutoSyncTargets = [];
let workspaceFusionAutoSyncInFlight = false;
let workspaceFusionAutoSyncLastRun = new Map();

function userFusionMirror(project) {
  const userId = getStoredUser()?.id || "";
  return (project?.fusion_mirrors || []).find((mirror) => mirror.user_id === userId) || null;
}

function mirrorUpdatedAt(mirror) {
  const value = Date.parse(mirror?.updated_at || "");
  return Number.isFinite(value) ? value : 0;
}

function sortFusionWorkspaceProjects(projects = []) {
  return [...projects].sort((a, b) => {
    if (a.id === projectId) return -1;
    if (b.id === projectId) return 1;
    const aMirror = userFusionMirror(a);
    const bMirror = userFusionMirror(b);
    const aStale = !!aMirror?.contents?.needs_relink;
    const bStale = !!bMirror?.contents?.needs_relink;
    if (aStale !== bStale) return aStale ? 1 : -1;
    return mirrorUpdatedAt(bMirror) - mirrorUpdatedAt(aMirror);
  });
}

function fusionWorkspaceProjects(projects = []) {
  return (projects || []).filter((project) => {
    const mirrors = project.fusion_mirrors || [];
    if (!mirrors.length) return !!project.fusion_source;
    return mirrors.some((mirror) => !mirror.contents?.needs_relink);
  });
}

function countStaleFusionMirrors(projects = []) {
  return (projects || []).filter((project) => {
    const mirrors = project.fusion_mirrors || [];
    if (!mirrors.length) return false;
    return mirrors.every((mirror) => mirror.contents?.needs_relink);
  }).length;
}

function fusionMirrorPathLabel(mirror = {}) {
  return [
    mirror.hub_label || mirror.hub_id || "Hub",
    mirror.aps_project_label || mirror.aps_project_id || "Project",
    mirror.folder_label || mirror.folder_id || "Folder",
  ].join(" · ");
}

async function cleanupStaleFusionMirrors() {
  const result = await api("/api/autodesk/fusion-mirrors/cleanup-stale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  await refreshWorkspaceRealtimeEditor();
  window.dispatchEvent(new CustomEvent("render3d:open-fusion-library"));
  return result;
}

function updateWorkspaceFusionAutoSync(data = null) {
  const userId = getStoredUser()?.id || "";
  workspaceFusionAutoSyncTargets = (data?.projects || [])
    .filter((project) => project?.id)
    .map((project) => ({
      projectId: project.id,
      mirror: (project.fusion_mirrors || []).find((mirror) => mirror.user_id === userId),
    }))
    .filter((entry) => entry.mirror && !entry.mirror.contents?.needs_relink);
  if (!workspaceFusionAutoSyncTargets.length) {
    if (workspaceFusionAutoSyncTimer) {
      clearInterval(workspaceFusionAutoSyncTimer);
      workspaceFusionAutoSyncTimer = null;
    }
    return;
  }
  if (!workspaceFusionAutoSyncTimer) {
    workspaceFusionAutoSyncTimer = setInterval(() => {
      void runWorkspaceFusionAutoSync();
    }, WORKSPACE_FUSION_AUTO_SYNC_MS);
  }
  void runWorkspaceFusionAutoSync();
}

async function runWorkspaceFusionAutoSync({ force = false } = {}) {
  if (workspaceFusionAutoSyncInFlight || document.hidden || !workspaceFusionAutoSyncTargets.length) return;
  const now = Date.now();
  const dueTargets = workspaceFusionAutoSyncTargets.filter((target) => {
    const last = workspaceFusionAutoSyncLastRun.get(target.projectId) || 0;
    return force || now - last >= WORKSPACE_FUSION_AUTO_SYNC_MS;
  });
  if (!dueTargets.length) return;
  workspaceFusionAutoSyncInFlight = true;
  let shouldRefresh = false;
  try {
    for (const target of dueTargets) {
      workspaceFusionAutoSyncLastRun.set(target.projectId, Date.now());
      try {
        const result = await api(`/api/projects/${encodeURIComponent(target.projectId)}/fusion-mirror/sync-from-fusion`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ import_bodies: true }),
        });
        if (result.changed || result.pushed_mirrors?.length || result.push_errors?.length) {
          shouldRefresh = true;
        }
      } catch (err) {
        console.warn("Fusion auto-sync failed", target.projectId, err);
      }
    }
  } finally {
    workspaceFusionAutoSyncInFlight = false;
  }
  if (shouldRefresh) {
    await refreshWorkspaceRealtimeEditor();
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void runWorkspaceFusionAutoSync({ force: true });
  }
});

function isWorkspaceRealtimeCollapsed() {
  try {
    return localStorage.getItem(LS_WORKSPACE_REALTIME_COLLAPSED) === "1";
  } catch {
    return false;
  }
}

function setWorkspaceRealtimeCollapsed(collapsed) {
  try {
    localStorage.setItem(LS_WORKSPACE_REALTIME_COLLAPSED, collapsed ? "1" : "0");
  } catch {
    /* local storage is best-effort */
  }
  syncWorkspaceRealtimeCollapse();
}

function syncWorkspaceRealtimeCollapse() {
  const panel = document.getElementById("workspace-realtime-editor");
  const toggle = document.getElementById("workspace-realtime-toggle");
  const collapsed = isWorkspaceRealtimeCollapsed();
  panel?.classList.toggle("is-collapsed", collapsed);
  if (toggle) {
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute("aria-label", collapsed ? "Expand realtime editor" : "Retract realtime editor");
    toggle.title = collapsed ? "Expand realtime editor" : "Retract realtime editor";
    toggle.textContent = collapsed ? "▸" : "▾";
  }
}

document.getElementById("workspace-realtime-toggle")?.addEventListener("click", () => {
  setWorkspaceRealtimeCollapsed(!isWorkspaceRealtimeCollapsed());
});

function renderWorkspaceRealtimeEditor(data = null) {
  syncWorkspaceRealtimeCollapse();
  const folderEl = document.getElementById("workspace-render-folder-card");
  const projectsEl = document.getElementById("workspace-fusion-projects");
  if (!folderEl || !projectsEl) return;
  if (!data) {
    updateWorkspaceFusionAutoSync(null);
    folderEl.innerHTML = "Select one workspace to use the realtime editor.";
    projectsEl.innerHTML = "";
    return;
  }
  const folder = data.render_folder || {};
  const provider = folder.provider || "render3d";
  const label = folder.label || (provider === "fusion" ? "Fusion 360" : "Render3D cloud");
  folderEl.innerHTML = `
    <strong>${appEscapeHtml(label)}</strong>
    <span>${appEscapeHtml(provider.replace(/_/g, " "))}${folder.folder_ref ? ` · ${appEscapeHtml(folder.folder_ref)}` : ""}</span>
    ${provider === "fusion"
      ? `<button type="button" class="btn secondary btn-compact workspace-fusion-link-btn" data-workspace-fusion-open>Open Fusion Library</button>`
      : `<button type="button" class="btn secondary btn-compact workspace-fusion-link-btn" data-workspace-fusion-link>Link Fusion to workspace</button>`
    }
  `;
  folderEl.querySelector("[data-workspace-fusion-open]")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("render3d:open-fusion-library"));
    setEditStatus("ok", "Fusion is already connected to this workspace. Use Fusion Library to link a project mirror or sync the latest version.");
  });
  folderEl.querySelector("[data-workspace-fusion-link]")?.addEventListener("click", () => {
    void linkActiveWorkspaceToFusion();
  });
  const allFusionProjects = (data.projects || []).filter((p) => p.fusion_source || (p.fusion_mirrors || []).length);
  const staleMirrorCount = countStaleFusionMirrors(allFusionProjects);
  const fusionProjects = sortFusionWorkspaceProjects(fusionWorkspaceProjects(allFusionProjects));
  updateWorkspaceFusionAutoSync({ ...data, projects: fusionProjects });
  if (!fusionProjects.length) {
    projectsEl.innerHTML = `
      <strong>Fusion projects</strong>
      <span>No Fusion mirror folders linked yet. Open a Render3D project, then use Fusion Library → Link mirror on each teammate's own Fusion folder.</span>
    `;
    return;
  }
  projectsEl.innerHTML = `
    <strong>Fusion linked folders</strong>
    <p class="muted small">Auto-sync checks your linked Fusion folder every 30 seconds, pulls newer versions into Render3D, then pushes them to teammate mirrors.</p>
    ${staleMirrorCount ? `
      <div class="workspace-fusion-stale-banner">
        <p class="muted small error">${staleMirrorCount} stale Fusion mirror${staleMirrorCount === 1 ? "" : "s"} on old Render3D projects still point at hubs you no longer have access to. They do not affect your current link.</p>
        <button type="button" class="btn btn-compact" data-workspace-cleanup-stale-fusion>Remove ${staleMirrorCount} stale mirror${staleMirrorCount === 1 ? "" : "s"}</button>
      </div>
    ` : ""}
    <div class="workspace-fusion-project-list">
      ${fusionProjects.slice(0, 8).map((p) => {
        const mine = userFusionMirror(p);
        const isCurrent = p.id === projectId;
        const isStale = !!mine?.contents?.needs_relink;
        return `
        <div class="workspace-fusion-project-card${isCurrent ? " workspace-fusion-project-card--current" : ""}${isStale ? " workspace-fusion-project-card--stale" : ""}">
          <div class="workspace-fusion-project-head">
            <span>${appEscapeHtml(p.name || p.id)}${isCurrent ? " · open now" : ""}</span>
            ${isStale ? `<small class="workspace-fusion-stale-badge">Stale mirror</small>` : ""}
          </div>
          <small>${appEscapeHtml(p.latest_file || "No preview file")} · ${appEscapeHtml(p.fusion_source?.item_name || "Fusion item")}</small>
          ${renderWorkspaceFusionComponents(p)}
          ${renderWorkspaceFusionMirrors(p)}
        </div>
      `;
      }).join("")}
    </div>
  `;
  projectsEl.querySelector("[data-workspace-cleanup-stale-fusion]")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Removing...";
    try {
      const result = await cleanupStaleFusionMirrors();
      setEditStatus("ok", `Removed ${result.count || 0} stale Fusion mirror${result.count === 1 ? "" : "s"}.`);
      window.dispatchEvent(new CustomEvent("render3d:fusion-mirror-changed"));
    } catch (err) {
      btn.disabled = false;
      btn.textContent = original;
      setEditStatus("error", err.message || "Could not remove stale Fusion mirrors.");
    }
  });
  projectsEl.querySelectorAll("[data-workspace-open-component]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pid = btn.dataset.projectId;
      const filename = btn.dataset.filename;
      if (!pid) return;
      await openProjectById(pid);
      if (!filename || !projectId) return;
      try {
        const data = await api(`/api/projects/${encodeURIComponent(pid)}`);
        const browserComponents = normalizeBrowser(data).components || [];
        const compCandidates = [
          ...browserComponents,
          ...browserComponents.flatMap((entry) => entry.children || []),
        ];
        const comp = compCandidates.find((entry) =>
          entry.name === filename || entry.viewer_filename === filename || entry.filename === filename
        );
        if (comp) {
          await openBrowserComponent(comp);
          for (const topLevel of browserComponents) {
            if (topLevel.name !== comp.name) setAssemblyComponentVisible(topLevel, false);
          }
          setAssemblyComponentVisible(comp, true);
          if (comp.name) selectAssemblyComponent(comp.name, { fitView: true });
        }
      } catch {
        /* Project open already succeeded; component targeting is best-effort. */
      }
    });
  });
  projectsEl.querySelectorAll("[data-fusion-drag-row]").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      const payload = fusionDragPayloadFromRow(row);
      if (!payload) return;
      setExplorerDragData(event, [payload]);
    });
  });
  projectsEl.querySelectorAll("[data-workspace-sync-fusion]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pid = btn.dataset.workspaceSyncFusion;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Syncing...";
      try {
        const result = await api(`/api/projects/${encodeURIComponent(pid)}/fusion-mirror/sync-from-fusion`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ import_bodies: true }),
        });
        btn.textContent = result.changed ? "Synced ✓" : "Latest";
        setEditStatus("ok", result.changed ? "Fusion update synced through Render3D." : "Fusion mirror already has the latest version.");
        await refreshWorkspaceRealtimeEditor();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = original;
        setEditStatus("error", err.message || "Could not sync Fusion folder.");
      }
    });
  });
  projectsEl.querySelectorAll("[data-workspace-relink-fusion]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pid = btn.dataset.workspaceRelinkFusion;
      if (!pid) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Removing...";
      try {
        await api(`/api/projects/${encodeURIComponent(pid)}/fusion-mirror`, { method: "DELETE" });
        setEditStatus("ok", "Stale Fusion mirror removed.");
        await refreshWorkspaceRealtimeEditor();
        window.dispatchEvent(new CustomEvent("render3d:fusion-mirror-changed"));
      } catch (err) {
        btn.disabled = false;
        btn.textContent = original;
        setEditStatus("error", err.message || "Could not unlink Fusion mirror.");
      }
    });
  });
}

function renderWorkspaceFusionComponents(project) {
  const components = (project.browser?.components || []).filter((entry) => entry?.name || entry?.viewer_filename || entry?.filename);
  const fusionComponents = (project.browser?.fusion_components || []).filter((entry) => entry?.label || entry?.name);
  const splitBodies = components.flatMap((entry) => (entry.children || []).map((child) => ({ ...child, parent: entry })));
  const fusionBodies = (project.browser?.fusion_bodies || []).filter((entry) => entry?.label || entry?.name);
  const hasFusionSourceBrowser = fusionComponents.length || fusionBodies.length;
  const componentEntries = fusionComponents.length ? fusionComponents : components;
  const bodies = hasFusionSourceBrowser ? fusionBodies : splitBodies;
  const sketches = project.browser?.sketches || [];
  const componentRows = componentEntries.map((entry) => {
    const filename = entry.name || entry.viewer_filename || entry.filename || "";
    const label = entry.label || entry.component_name || entry.stem || filename;
    const bodyCount = entry.children?.length || 0;
    return renderFusionBrowserItem({
      projectId: project.id,
      filename,
      name: label,
      badge: entry.fusion_component ? "Fusion component" : (bodyCount ? `${bodyCount} bodies` : (entry.format || "component")),
      icon: "▣",
      disabled: !filename,
    });
  }).join("");
  const bodyRows = bodies.map((entry) => {
    const filename = entry.name || entry.viewer_filename || entry.filename || "";
    const label = entry.label || entry.component_name || entry.stem || filename;
    const parentLabel = entry.parent?.label || entry.parent?.stem || entry.parent?.name || "component";
    return renderFusionBrowserItem({
      projectId: project.id,
      filename,
      name: label,
      badge: entry.fusion_body ? "Fusion body" : parentLabel,
      icon: "◦",
      child: true,
      disabled: !filename,
    });
  }).join("");
  const sketchRows = sketches.map((entry) => renderFusionBrowserItem({
    projectId: project.id,
    filename: entry.name || entry.filename || "",
    name: entry.label || entry.name || entry.stem || "Sketch",
    badge: entry.format || "sketch",
    icon: "⌁",
    disabled: true,
  })).join("");
  return `
    <div class="workspace-fusion-browser">
      ${renderFusionBrowserSection("Components", componentEntries.length, componentRows || renderFusionEmptyRow("No visible Fusion components yet."), true)}
      ${renderFusionBrowserSection("Bodies", bodies.length, bodyRows || renderFusionEmptyRow("No Fusion bodies found in the source design."), false)}
      ${renderFusionBrowserSection("Sketches", sketches.length, sketchRows || renderFusionEmptyRow("No sketches synced into this Render3D project yet."), false)}
    </div>
  `;
}

function fusionItemStem(name = "") {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/_edited(?:_\d+)?$/i, "")
    .replace(/_copy\d*$/i, "")
    .toLowerCase();
}

function activeFusionMirrorItems(mirror = {}, items = []) {
  return items;
}

function renderWorkspaceFusionMirrors(project) {
  const mirrors = project.fusion_mirrors || [];
  if (!mirrors.length) {
    return `<p class="muted small">No teammate mirror folders linked for this project yet.</p>`;
  }
  return `
    <div class="workspace-fusion-mirror-list">
      ${mirrors.map((mirror) => {
        const contents = mirror.contents || {};
        const folders = contents.folders || [];
        const items = contents.items || [];
        const activeItems = activeFusionMirrorItems(mirror, items);
        const latestLink = renderFusionLatestVersionLink(mirror, activeItems);
        const contentRows = contents.error
          ? `<p class="muted small error">${appEscapeHtml(contents.error)}</p>${contents.needs_relink && mirror.user_id === getStoredUser()?.id ? `<button type="button" class="btn btn-compact" data-workspace-relink-fusion="${appEscapeHtml(project.id)}">Remove stale link</button>` : ""}`
          : [
              ...folders.map((folder) => renderFusionFolderRow("Folder", folder.name || "Folder", "▸")),
              ...activeItems.map((item) => renderFusionFolderRow("File", item.name || "Untitled", "□")),
            ].join("") || renderFusionEmptyRow("Folder is empty.");
        return `
          <div class="workspace-fusion-mirror-card${contents.needs_relink ? " workspace-fusion-mirror-card--stale" : ""}">
            <div class="workspace-fusion-mirror-head">
              <span>${appEscapeHtml(mirror.display_name || mirror.email || "Teammate")}</span>
              <small>${mirror.user_id === getStoredUser()?.id ? "Your mirror" : "Teammate mirror"}${contents.needs_relink ? " · stale" : ""}</small>
            </div>
            <p class="muted small workspace-fusion-mirror-meta">
              <span>${appEscapeHtml(fusionMirrorPathLabel(mirror))}</span>
              ${latestLink}
            </p>
            <div class="workspace-fusion-browser">
              ${renderFusionBrowserSection(mirror.folder_label || "Fusion folder", folders.length + activeItems.length, contentRows, !contents.needs_relink)}
            </div>
            ${mirror.user_id === getStoredUser()?.id
              ? `<button type="button" class="btn btn-compact" data-workspace-sync-fusion="${appEscapeHtml(project.id)}">Sync latest from Fusion</button>`
              : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderFusionBrowserSection(title, count, rows, open = true) {
  return `
    <details class="workspace-fusion-browser-section"${open ? " open" : ""}>
      <summary class="workspace-fusion-browser-summary">
        <span class="browser-chevron">▾</span>
        <span>${appEscapeHtml(title)}</span>
        <small>${Number(count) || 0}</small>
      </summary>
      <div class="workspace-fusion-browser-list">${rows}</div>
    </details>
  `;
}

function renderFusionLatestVersionLink(mirror, items = []) {
  const version = String(mirror.last_version_id || "");
  if (!version) return `<span>Latest: not pushed</span>`;
  const item = items.find((candidate) =>
    candidate.id === mirror.last_item_id || candidate.version_id === mirror.last_version_id
  ) || items[0] || {};
  const href = item.web_url || item.download_url || "";
  const label = version.match(/[?&]version=([^&]+)/)?.[1]
    ? `Latest v${version.match(/[?&]version=([^&]+)/)[1]}`
    : "Latest version";
  if (!href) {
    return `<span title="${appEscapeHtml(version)}">${appEscapeHtml(label)}</span>`;
  }
  return `<a class="workspace-fusion-version-link" href="${appEscapeHtml(href)}" target="_blank" rel="noopener" title="${appEscapeHtml(version)}">${appEscapeHtml(label)}</a>`;
}

function renderFusionBrowserItem({ projectId, filename, name, badge, icon = "□", child = false, disabled = false }) {
  const stem = String(name || filename || "fusion_item")
    .replace(/\.[^.]+$/, "")
    .replace(/[:\s]+/g, "_")
    .replace(/[^\w-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const openAttrs = !disabled && filename
    ? `data-workspace-open-component data-project-id="${appEscapeHtml(projectId)}" data-filename="${appEscapeHtml(filename)}"`
    : "";
  const attrs = disabled
    ? "disabled"
    : openAttrs;
  return `
    <button type="button" class="workspace-fusion-browser-row${child ? " workspace-fusion-browser-row-child" : ""}" ${attrs} ${disabled ? "" : "draggable=\"true\" data-fusion-drag-row"} data-drag-project-id="${appEscapeHtml(projectId)}" data-drag-filename="${appEscapeHtml(filename)}" data-drag-name="${appEscapeHtml(name || filename || "Untitled")}" data-drag-stem="${appEscapeHtml(stem)}" data-drag-format="${appEscapeHtml(badge || "fusion")}">
      <span class="workspace-fusion-browser-icon">${appEscapeHtml(icon)}</span>
      <span class="workspace-fusion-browser-name">${appEscapeHtml(name || filename || "Untitled")}</span>
      <small>${appEscapeHtml(badge || filename || "")}</small>
    </button>
  `;
}

function fusionDragPayloadFromRow(row) {
  const name = row.dataset.dragName || "";
  const filename = row.dataset.dragFilename || "";
  if (!name && !filename) return null;
  return {
    type: "component",
    projectId: row.dataset.dragProjectId || null,
    name: filename || name,
    filename: filename || "",
    stem: row.dataset.dragStem || (filename || name).replace(/\.[^.]+$/, ""),
    format: row.dataset.dragFormat || "fusion",
    viewer_filename: filename || "",
    label: name || filename,
    fusion_mirror: true,
  };
}

function renderFusionFolderRow(kind, name, icon = "□") {
  return `
    <div class="workspace-fusion-browser-row workspace-fusion-browser-row-static">
      <span class="workspace-fusion-browser-icon">${appEscapeHtml(icon)}</span>
      <span class="workspace-fusion-browser-name">${appEscapeHtml(name)}</span>
      <small>${appEscapeHtml(kind)}</small>
    </div>
  `;
}

function renderFusionEmptyRow(message) {
  return `<p class="muted small workspace-fusion-browser-empty">${appEscapeHtml(message)}</p>`;
}

async function linkActiveWorkspaceToFusion() {
  const teamId = getSelectedWorkspaceId();
  if (!teamId) {
    setEditStatus("error", "Select one workspace before linking Fusion.");
    return;
  }
  try {
    const saved = await api(`/api/teams/${encodeURIComponent(teamId)}/render-folder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "fusion",
        label: "Fusion 360 workspace",
        folder_ref: "autodesk-user-cloud",
      }),
    });
    if (saved.team) {
      const idx = allTeams.findIndex((team) => team.id === teamId);
      if (idx >= 0) allTeams[idx] = { ...allTeams[idx], ...saved.team };
    }
    await refreshWorkspaceRealtimeEditor();
    setEditStatus("ok", "Fusion is linked to this workspace. Use Fusion Library to import a design or link project mirror folders.");
  } catch (err) {
    setEditStatus("error", err.message || "Could not link Fusion to this workspace.");
  }
}

async function refreshWorkspaceRealtimeEditor() {
  const teamId = getSelectedWorkspaceId();
  if (!teamId) {
    renderWorkspaceRealtimeEditor(null);
    connectWorkspaceRealtime(null);
    return;
  }
  connectWorkspaceRealtime(teamId);
  try {
    const data = await api(`/api/teams/${teamId}/realtime-editor`);
    renderWorkspaceRealtimeEditor(data);
  } catch {
    renderWorkspaceRealtimeEditor(null);
  }
}

function renderFileList(files = []) {
  const list = document.getElementById("file-list");
  if (!list) return;
  list.innerHTML = "";
  for (const f of files) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.dataset.filename = f.name;
    if (f.name === selectedFile) li.classList.add("active");

    const body = document.createElement("button");
    body.type = "button";
    body.className = "file-item-body";
    body.textContent = f.name;
    body.title = "Open in viewer";
    body.addEventListener("click", async () => {
      saveActiveModelPromptState();
      selectedFile = f.name;
      list.querySelectorAll(".file-item").forEach((el) => el.classList.remove("active"));
      li.classList.add("active");
      try {
        if (isDxfDrawingFilename(f.name)) {
          await openDxfDrawingByName(f.name, { projectId });
          if (currentUser) await refreshPromptHistory();
          return;
        }
        const viewer = f.viewer_filename || f.name;
        await loadModel(projectFileUrl(projectId, viewer), viewer, {
          projectId,
          catalogFilename: f.name,
          center: !hasBakedPlacement(f),
          fitView: true,
        });
        if (currentUser) await refreshPromptHistory();
      } catch (err) {
        setEditStatus("error", err.message || "Could not load model.");
        viewerOverlay.showError(err.message || "Could not load model.");
      }
    });

    const actions = document.createElement("div");
    actions.className = "file-item-actions";

    const exp = document.createElement("button");
    exp.type = "button";
    exp.className = "btn-file-export";
    exp.title = "Export / share";
    exp.textContent = "Export";
    exp.disabled = isComponentHidden(f.name);
    exp.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isComponentHidden(f.name)) {
        alert("Show this component before exporting it.");
        return;
      }
      openFileExportMenu({ api, projectId, filename: f.name, anchorEl: exp }).catch((err) => {
        alert(err.message || "Could not load exports");
      });
    });

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "btn-file-rename";
    rename.title = "Rename model";
    rename.textContent = "Rename";
    rename.addEventListener("click", (e) => {
      e.stopPropagation();
      renameProjectFile(f.name);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-file-delete";
    del.title = "Delete model";
    del.textContent = "Delete";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteProjectFile(f.name);
    });

    if (!isAnonymousPublicProject(projectId)) {
      actions.append(exp, rename, del);
    }
    li.append(body, actions);
    list.appendChild(li);
  }
}

async function renameProjectFile(filename) {
  if (!projectId) return;
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  const stem = filename.slice(0, filename.length - ext.length);
  const trimmed = await openRenameDialog({
    eyebrow: "Model file",
    title: "Rename Model",
    description: ext ? `Keep the ${ext} extension or enter a new full filename.` : "Rename this model in the project browser.",
    label: "Model name",
    value: stem,
    placeholder: "model-name",
    confirmText: "Rename model",
  });
  if (trimmed === null) return;
  const newName = trimmed.includes(".") ? trimmed : `${trimmed}${ext}`;
  if (newName === filename) return;
  try {
    const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (selectedFile === filename) selectedFile = data.filename;
    await refreshFiles();
    if (selectedFile === data.filename) {
      await loadModel(`/api/projects/${projectId}/files/${data.filename}`, data.filename, {
        center: !hasBakedPlacement(data.filename),
      });
    }
  } catch (err) {
    alert(err.message || "Failed to rename file");
  }
}

async function deleteProjectFile(filename) {
  if (!projectId) return;
  if (!window.confirm(`Delete "${filename}" from this project?`)) return;
  try {
    const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}`, { method: "DELETE" });
    dxfViewer?.closeIfOpen?.(filename);
    await syncAfterObjectDelete({ deletedFile: filename, ...data });
  } catch (err) {
    alert(err.message || "Failed to delete file");
  }
}

async function exportProject(p) {
  const file = p.latest_file || p.files?.[0]?.name;
  if (!file) {
    alert("This project has no model to export yet.");
    return;
  }
  const pid = p.id;
  if (isAnonymousPublicProject(pid)) {
    window.open(projectFileUrl(pid, file), "_blank", "noopener");
    return;
  }
  const anchor = document.querySelector(`.proj-item[data-project-id="${pid}"] .btn-proj-export`);
  try {
    await openFileExportMenu({ api, projectId: pid, filename: file, anchorEl: anchor || document.body });
  } catch (err) {
    alert(err.message || "Could not export project");
  }
}

async function refreshFiles() {
  if (!projectId) await ensureProject();
  await fetchAllProjects();
  const data = await api(`/api/projects/${projectId}`);
  lastProjectFiles = data.files || [];
  timelineData = data.timeline;
  timeline.setTimeline(data.timeline);
  renderProjectList();
  renderFileList(data.files || []);
  const browser = normalizeBrowser(data);
  renderProjectBrowser(browser);
  await sketchEditor.loadProjectSketches?.(projectId, api, browser.sketches);
  syncSketchVisibilityFromTree(browser);
  if (selectedFile) projectTree.setSelected(selectedFile);
  syncPromptTargetUI();
  if (
    isUrdfMotionModalOpen() ||
    document.querySelector('[data-right-panel="rigging"]')?.classList.contains("active")
  ) {
    await refreshRobotArtifacts({ quiet: true });
  }
  refreshPartProfiles();
}

let restoringTimeline = false;

function timelineCurrentIndex() {
  const entries = timelineData?.entries || [];
  if (!entries.length) return -1;
  const cur = timelineData?.current_index;
  return cur != null && cur >= 0 ? cur : entries.length - 1;
}

async function undoTimeline() {
  if (!projectId || restoringTimeline) return;
  const entries = timelineData?.entries || [];
  const cur = timelineCurrentIndex();
  if (cur <= 0) { setEditStatus("error", "Nothing to undo."); return; }

  const target = cur - 1;
  const currentEntry = entries[cur];
  await restoreTimeline(target);
  if (currentEntry?.kind === "delete_object") {
    setEditStatus("ok", `Undo delete: ${currentEntry.meta?.deleted_file || currentEntry.filename || currentEntry.label} restored.`);
    return;
  }
  if (currentEntry?.kind === "remove_body") {
    setEditStatus("ok", `Undo: ${currentEntry.label || "body restored"}.`);
    return;
  }
  if (currentEntry?.kind === "transform") {
    setEditStatus("ok", "Undo transform: object moved back.");
    return;
  }
  setEditStatus("ok", `Undo: ${entries[target]?.label || "previous step"}`);
}

async function redoTimeline() {
  if (!projectId || restoringTimeline) return;
  const entries = timelineData?.entries || [];
  const cur = timelineCurrentIndex();
  if (cur < 0 || cur >= entries.length - 1) { setEditStatus("error", "Nothing to redo."); return; }

  const target = cur + 1;
  const nextEntry = entries[target];
  await restoreTimeline(target);
  if (nextEntry?.kind === "delete_object") {
    setEditStatus("ok", `Redo delete: ${nextEntry.meta?.deleted_file || nextEntry.filename || nextEntry.label}`);
    return;
  }
  if (nextEntry?.kind === "transform") {
    setEditStatus("ok", "Redo transform: object moved again.");
    return;
  }
  setEditStatus("ok", `Redo: ${nextEntry?.label || "next step"}`);
}

async function restoreTimeline(index) {
  if (restoringTimeline) return;
  restoringTimeline = true;
  try {
    const data = await api(`/api/projects/${projectId}/timeline/${index}`, { method: "POST" });
    saveActiveModelPromptState();
    if (data.timeline) {
      timelineData = data.timeline;
    } else if (timelineData) {
      timelineData = { ...timelineData, current_index: data.index ?? index };
    }
    if (data.timeline) timeline.setTimeline(data.timeline);
    await refreshFiles();
    if (data.filename && data.url) {
      selectedFile = data.filename;
      await reloadViewportFromProject({ fitView: true, latestFile: data.filename });
    } else {
      await reloadViewportFromProject({ fitView: true });
    }
    gizmoPanel.resetDragBaseline?.();
    objectHistory.highlightActive(timelineCurrentIndex());
    viewerOverlay.clearError();
  } catch (err) {
    setEditStatus("error", err.message || "Timeline restore failed.");
    viewerOverlay.showError(err.message || "Timeline restore failed.");
  } finally {
    restoringTimeline = false;
  }
}

async function restoreTimelineAsLatest(index) {
  if (!projectId || restoringTimeline) return;
  restoringTimeline = true;
  try {
    const data = await api(`/api/projects/${projectId}/timeline/${index}/restore-latest`, { method: "POST" });
    saveActiveModelPromptState();
    if (data.timeline) {
      timelineData = data.timeline;
    } else if (timelineData && data.index != null) {
      timelineData = { ...timelineData, current_index: data.index };
    }
    const activeIndex = data.index ?? timelineData?.current_index ?? index;
    if (timelineData) {
      timeline.setTimeline(timelineData, { scroll: true, scrollAlign: "end" });
      timeline.goToIndex(activeIndex, { preview: true, scroll: true, scrollAlign: "end" });
    }
    projectAssembly.clear();
    prepareViewportForModels();
    selectedFile = data.filename || selectedFile;
    await refreshFiles();
    const browser = normalizeBrowser(await api(`/api/projects/${projectId}`));
    renderProjectBrowser(browser);
    const comps = browser.components || [];
    if (comps.length) {
      await loadProjectComponents(comps, {
        projectId,
        latestFile: data.filename || null,
        fitView: true,
      });
    } else {
      await reloadViewportFromProject({ fitView: true, latestFile: data.filename || null });
    }
    if (timelineData) {
      timeline.setTimeline(timelineData, { scroll: true, scrollAlign: "end" });
      timeline.goToIndex(activeIndex, { preview: true, scroll: true, scrollAlign: "end" });
    }
    await refreshObjectHistory();
    objectHistory.highlightActive(activeIndex);
    gizmoPanel.resetDragBaseline?.();
    viewerOverlay.clearError();
    const restoredFrom = data.restored_from?.label ? ` from ${data.restored_from.label}` : "";
    setEditStatus("ok", `Restored timeline state${restoredFrom} as the latest step.`);
  } catch (err) {
    setEditStatus("error", err.message || "Timeline restore failed.");
    viewerOverlay.showError(err.message || "Timeline restore failed.");
  } finally {
    restoringTimeline = false;
  }
}

async function removeTimelineEntry(index, entry) {
  if (!projectId || index == null) return;
  const label = entry?.label || `step ${Number(index) + 1}`;
  if (!window.confirm(`Remove "${label}" from the timeline?`)) return;
  try {
    const data = await api(`/api/projects/${projectId}/timeline/${index}`, { method: "DELETE" });
    if (data.timeline) {
      timelineData = data.timeline;
      timeline.setTimeline(data.timeline);
    }
    await refreshFiles();
    if (data.filename && data.url) {
      selectedFile = data.filename;
      await reloadViewportFromProject({ fitView: true, latestFile: data.filename });
    } else {
      await reloadViewportFromProject({ fitView: true });
    }
    objectHistory.highlightActive(timelineCurrentIndex());
    viewerOverlay.clearError();
    setEditStatus("ok", `Removed timeline node: ${label}`);
  } catch (err) {
    setEditStatus("error", err.message || "Timeline node removal failed.");
    viewerOverlay.showError(err.message || "Timeline node removal failed.");
  }
}

const PICK_HINTS = {
  object: { title: "Select object", text: "Click a body, or drag a box around bodies/objects · Split bodies separates them · Delete/Backspace removes selected · Tab toggles Orbit" },
  corner: { title: "Pick corner", text: "Click a corner of the model — adds @corner-N to your prompt" },
  face: { title: "Pick face", text: "Click faces to add @face-N — click again to deselect. Multiple faces supported." },
  edge: { title: "Pick edge", text: "Click near an edge — adds @edge-N" },
  lasso: { title: "Lasso surface", text: "Drag on the model surface to draw a dotted closed loop — adds @lasso-N to your prompt" },
  line: { title: "Line / path tool", text: "Click points between parts to build a path (e.g. click part A then part B) · double-click or Enter to finish · adds @path-N — then prompt e.g. \"create wire ducts between these 2 points\"" },
  off: { title: "", text: "" },
};

function activatePickMode(mode) {
  if (mode !== "line") cancelLinePath();
  setPickMode(mode);
  document.querySelectorAll(".pick-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  const isPick = mode !== "off";
  viewport.classList.toggle("pick-mode", isPick);
  applyLeftDragModeControls(mode);
  if (mode === "object") {
    directModeling.reset();
    meshCleanup.hide();
    viewportHint?.classList.remove("hidden");
    if (pickHintTitle) pickHintTitle.textContent = PICK_HINTS.object.title;
    if (pickHintText) pickHintText.textContent = PICK_HINTS.object.text;
    const sel = objectTools.getSelection()?.mesh;
    if (sel) {
      document.getElementById("btn-gizmo")?.classList.add("active");
      transformControls.attach(sel);
      if (!gizmoPanel.isVisible?.()) {
        transformControls.setMode("translate");
        gizmoPanel.show();
        gizmoPanel.refresh();
      }
    }
    return;
  }
  if (isPick) {
    objectTools.clearSelection();
    transformControls.detach();
    gizmoPanel.hide();
    document.getElementById("btn-gizmo")?.classList.remove("active");
    directModeling.reset();
    viewportHint?.classList.remove("hidden");
    if (pickHintTitle) pickHintTitle.textContent = PICK_HINTS[mode]?.title || "Pick";
    if (pickHintText) pickHintText.textContent = PICK_HINTS[mode]?.text || "";
  } else {
    objectTools.clearSelection();
    transformControls.detach();
    gizmoPanel.hide();
    document.getElementById("btn-gizmo")?.classList.remove("active");
    controls.enabled = true;
    viewportHint?.classList.add("hidden");
    clearHover();
  }
}

document.querySelectorAll(".pick-btn").forEach((btn) => {
  btn.addEventListener("click", () => activatePickMode(btn.dataset.mode || "off"));
});

let pointerDownPos = null;
let lassoPointerActive = false;
let viewportSelectDrag = null;
let viewportMarqueeEl = null;
let suppressNextObjectClick = false;
let controlsEnabledBeforeViewportSelect = true;

function syncLeftDragModeButton() {
  const btn = document.getElementById("btn-left-drag-mode");
  if (!btn) return;
  if (isCadMousePreset()) {
    const preset = MOUSE_CONTROL_PRESETS[mouseControlPreset] || MOUSE_CONTROL_PRESETS.render3d;
    btn.textContent = `Mouse: ${preset.label}`;
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
    btn.title = `${preset.hint} Click to switch back to Render3D default controls.`;
    return;
  }
  const selecting = !isMobileInteraction() && leftDragMode !== "rotate";
  btn.textContent = `Left drag: ${selecting ? "Select" : "Rotate"}`;
  btn.classList.toggle("active", selecting);
  btn.setAttribute("aria-pressed", selecting ? "true" : "false");
  btn.title = selecting
    ? "Left-drag selects objects. Click to switch left-drag back to camera rotate."
    : "Left-drag rotates the camera. Click to switch left-drag to object selection.";
}

function setLeftDragMode(mode, { silent = false } = {}) {
  leftDragMode = isMobileInteraction() ? "rotate" : (mode === "rotate" ? "rotate" : "select");
  try {
    localStorage.setItem(LEFT_DRAG_MODE_KEY, leftDragMode);
  } catch {
    /* local storage is best-effort */
  }
  syncLeftDragModeButton();
  applyLeftDragModeControls();
  if (silent) return;
  if (leftDragMode === "rotate" && !directModeling.isToolActive?.() && !sketchEditor.isActive?.()) {
    setEditStatus("ok", "Left drag now rotates the camera. Click the top toggle to switch back to selection.");
  } else if (leftDragMode === "select") {
    setEditStatus("ok", "Left drag now selects objects. Drag empty space for a selection box.");
  }
}

function applyLeftDragModeControls(mode = getPickMode()) {
  applyLeftDragMouseButtons();
  if (directModeling.isToolActive?.() || sketchEditor.isActive?.()) return;
  if (mode === "off" || mode === "object") {
    controls.enabled = true;
  } else {
    controls.enabled = false;
  }
}

function isTransformEditActive() {
  return Boolean(transformControls?.object && (gizmoPanel?.isVisible?.() || document.getElementById("btn-gizmo")?.classList.contains("active")));
}

function shouldSuppressViewportSelection() {
  return transformGizmoDragging || performance.now() < suppressSelectionUntil;
}

document.getElementById("btn-left-drag-mode")?.addEventListener("click", () => {
  if (isCadMousePreset()) {
    setMouseControlPreset("render3d", { announce: true });
    return;
  }
  setLeftDragMode(leftDragMode === "select" ? "rotate" : "select");
});
syncLeftDragModeButton();
MOBILE_INTERACTION_QUERY?.addEventListener?.("change", () => {
  if (isMobileInteraction()) {
    leftDragMode = "rotate";
    activatePickMode("off");
  }
  syncLeftDragModeButton();
  applyLeftDragModeControls();
});

function canUseViewportSelectGesture(e) {
  if (architectControlsActive || architectSession?.isActive?.()) return false;
  if (isMobileInteraction()) return false;
  if (leftDragMode === "rotate") return false;
  if (isTransformEditActive() || shouldSuppressViewportSelection()) return false;
  if (e.button !== 0 || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.code === "Space") return false;
  const mode = getPickMode();
  if (!["off", "object", "face"].includes(mode)) return false;
  if (!currentMesh || sketchEditor.isActive?.() || sketchFacePickActive || directModeling.isToolActive?.()) return false;
  return true;
}

function ensureViewportMarquee() {
  if (viewportMarqueeEl) return viewportMarqueeEl;
  viewportMarqueeEl = document.createElement("div");
  viewportMarqueeEl.className = "viewport-selection-marquee hidden";
  viewport.appendChild(viewportMarqueeEl);
  return viewportMarqueeEl;
}

function setViewportMarqueeVisible(visible) {
  ensureViewportMarquee().classList.toggle("hidden", !visible);
}

function updateViewportMarquee(drag, e) {
  const rect = viewport.getBoundingClientRect();
  const x0 = drag.startX - rect.left;
  const y0 = drag.startY - rect.top;
  const x1 = e.clientX - rect.left;
  const y1 = e.clientY - rect.top;
  const left = Math.max(0, Math.min(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const right = Math.min(rect.width, Math.max(x0, x1));
  const bottom = Math.min(rect.height, Math.max(y0, y1));
  const el = ensureViewportMarquee();
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${Math.max(1, right - left)}px`;
  el.style.height = `${Math.max(1, bottom - top)}px`;
}

function projectObjectBoundsToViewport(obj) {
  if (!obj?.visible) return null;
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const corner of corners) {
    corner.project(camera);
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) continue;
    const x = ((corner.x + 1) / 2) * rect.width + rect.left;
    const y = ((-corner.y + 1) / 2) * rect.height + rect.top;
    bounds.left = Math.min(bounds.left, x);
    bounds.right = Math.max(bounds.right, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.bottom = Math.max(bounds.bottom, y);
  }
  return Number.isFinite(bounds.left) ? bounds : null;
}

function listObjectMeshes(root) {
  const meshes = [];
  root?.traverse?.((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    if (obj.userData?.isEdge || obj.userData?.isSilhouette || obj.userData?.isObjectHighlight) return;
    meshes.push(obj);
  });
  return meshes;
}

function bodyFaceRange(bodyInfo, bodyIndex, mesh) {
  const geom = mesh?.geometry;
  const faceCount = geom?.index
    ? Math.floor(geom.index.count / 3)
    : Math.floor((geom?.attributes?.position?.count || 0) / 3);
  const start = bodyInfo?.face_offsets?.[bodyIndex] ?? 0;
  const end = bodyInfo?.face_offsets?.[bodyIndex + 1] ?? faceCount;
  return { start: Math.max(0, start), end: Math.min(end, faceCount) };
}

function projectMeshBodyBoundsToViewport(mesh, bodyIndex, bodyInfo) {
  if (!mesh?.visible || !mesh.geometry?.attributes?.position) return null;
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const index = geom.index;
  const { start, end } = bodyFaceRange(bodyInfo, bodyIndex, mesh);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let fi = start; fi < end; fi += 1) {
    for (let j = 0; j < 3; j += 1) {
      const vi = index ? index.getX(fi * 3 + j) : fi * 3 + j;
      v.fromBufferAttribute(pos, vi);
      mesh.localToWorld(v);
      box.expandByPoint(v);
    }
  }
  if (box.isEmpty()) return null;
  return projectBoxToViewport(box);
}

function projectMeshFaceBoundsToViewport(mesh, faceIndex) {
  const geom = mesh?.geometry;
  const pos = geom?.attributes?.position;
  if (!mesh?.visible || !pos || faceIndex == null) return null;
  const faceCount = geom.index ? Math.floor(geom.index.count / 3) : Math.floor(pos.count / 3);
  if (faceIndex < 0 || faceIndex >= faceCount) return null;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let j = 0; j < 3; j += 1) {
    const vi = geom.index ? geom.index.getX(faceIndex * 3 + j) : faceIndex * 3 + j;
    v.fromBufferAttribute(pos, vi);
    mesh.localToWorld(v);
    box.expandByPoint(v);
  }
  if (box.isEmpty()) return null;
  return projectBoxToViewport(box);
}

function projectBoxToViewport(box) {
  if (!box || box.isEmpty()) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const corner of corners) {
    corner.project(camera);
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) continue;
    const x = ((corner.x + 1) / 2) * rect.width + rect.left;
    const y = ((-corner.y + 1) / 2) * rect.height + rect.top;
    bounds.left = Math.min(bounds.left, x);
    bounds.right = Math.max(bounds.right, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.bottom = Math.max(bounds.bottom, y);
  }
  return Number.isFinite(bounds.left) ? bounds : null;
}

function selectFacesFromViewportMarquee(dragRect) {
  const root = projectAssembly.getRoot() || currentMesh;
  if (!root) return false;
  const selections = [];
  const seenBodies = new Set();
  root.traverse((mesh) => {
    if (!mesh?.isMesh || !mesh.geometry || mesh.userData?.isEdge || mesh.userData?.isSilhouette) return;
    const catalogName = catalogNameForMesh(mesh) || mesh.userData?.catalogFilename || selectedFile;
    const componentRoot = catalogName ? projectAssembly.get(catalogName) : componentRootForMesh(mesh);
    if (!componentRoot) return;
    const geom = mesh.geometry;
    const faceCount = geom.index
      ? Math.floor(geom.index.count / 3)
      : Math.floor((geom.attributes?.position?.count || 0) / 3);
    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      const bounds = projectMeshFaceBoundsToViewport(mesh, faceIndex);
      if (!bounds || !rectsIntersect(dragRect, bounds)) continue;
      const info = catalogName === selectedFile ? objectTools.getBodyInfo?.() : null;
      const bodyIndex = info?.face_offsets?.length
        ? (() => {
            const offsets = info.face_offsets || [];
            for (let i = offsets.length - 1; i >= 0; i -= 1) {
              if (faceIndex >= offsets[i]) return i;
            }
            return 0;
          })()
        : 0;
      const key = `${catalogName || mesh.uuid}:${bodyIndex}`;
      if (seenBodies.has(key)) continue;
      seenBodies.add(key);
      selections.push({
        mesh,
        root: componentRoot,
        catalogName,
        bodyIndex,
        faceIndex,
        label: `${catalogName ? catalogName.replace(/\.[^.]+$/, "") : "Object"} face group`,
      });
      break;
    }
  });
  if (!selections.length) return false;
  objectTools.selectMany(selections);
  if (selections[0]?.catalogName) {
    selectedFile = selections[0].catalogName;
    projectTree.setSelectedMany?.(selections.map((item) => item.catalogName));
    featureEditor.setModel(projectId, selectedFile);
  }
  setEditStatus("ok", `Selected ${selections.length} face group${selections.length === 1 ? "" : "s"} · Delete removes the selected object/body.`);
  return true;
}

function rectsIntersect(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function selectFromViewportMarquee(drag, e) {
  const dragRect = {
    left: Math.min(drag.startX, e.clientX),
    right: Math.max(drag.startX, e.clientX),
    top: Math.min(drag.startY, e.clientY),
    bottom: Math.max(drag.startY, e.clientY),
  };
  if (getPickMode() === "face" && selectFacesFromViewportMarquee(dragRect)) {
    return true;
  }
  const bodyInfo = objectTools.getBodyInfo?.();
  const bodySelections = [];
  const activeBodyCatalog = selectedFile && projectAssembly.has(selectedFile)
    ? selectedFile
    : (projectAssembly.count() === 1 ? projectAssembly.list()[0]?.[0] : null);
  const activeBodyRoot = activeBodyCatalog ? projectAssembly.get(activeBodyCatalog) : null;
  if (activeBodyRoot && (bodyInfo?.count || 0) > 1) {
    const mesh = listObjectMeshes(activeBodyRoot)[0];
    if (mesh) {
      for (let bodyIndex = 0; bodyIndex < bodyInfo.count; bodyIndex += 1) {
        const bounds = projectMeshBodyBoundsToViewport(mesh, bodyIndex, bodyInfo);
        if (!bounds || !rectsIntersect(dragRect, bounds)) continue;
        bodySelections.push({
          mesh,
          root: activeBodyRoot,
          catalogName: activeBodyCatalog,
          bodyIndex,
          label: bodyInfo.body_names?.[bodyIndex] || `Body ${bodyIndex + 1}`,
        });
      }
    }
  }
  if (bodySelections.length) {
    selectedFile = activeBodyCatalog;
    projectTree.setSelectedMany?.([activeBodyCatalog]);
    featureEditor.setModel(projectId, activeBodyCatalog);
    objectTools.selectMany(bodySelections);
    setEditStatus("ok", `Selected ${bodySelections.length} bod${bodySelections.length === 1 ? "y" : "ies"} · Delete removes them · Split bodies separates them into files.`);
    return true;
  }

  const candidates = [];
  for (const [catalogName, obj] of projectAssembly.list()) {
    const bounds = projectObjectBoundsToViewport(obj);
    if (!bounds || !rectsIntersect(dragRect, bounds)) continue;
    const area = Math.max(1, (bounds.right - bounds.left) * (bounds.bottom - bounds.top));
    candidates.push({ catalogName, obj, area });
  }
  candidates.sort((a, b) => a.area - b.area);
  if (!candidates.length) return false;
  if (candidates.length === 1) {
    const picked = candidates[0];
    selectAssemblyComponent(picked.catalogName, { autoGizmo: true, fitView: false });
    setEditStatus("ok", `Selected ${picked.catalogName.replace(/\.[^.]+$/, "")} from drag selection.`);
    return true;
  }
  objectTools.selectMany(candidates.map(({ catalogName, obj }) => ({
    mesh: obj,
    root: obj,
    catalogName,
    bodyIndex: 0,
    label: catalogName.replace(/\.[^.]+$/, ""),
  })));
  selectedFile = candidates[0].catalogName;
  projectTree.setSelectedMany?.(candidates.map((item) => item.catalogName));
  featureEditor.setModel(projectId, selectedFile);
  setEditStatus("ok", `Selected ${candidates.length} objects · Delete removes them.`);
  return true;
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
  if (handleReferenceRemove(e)) return;

  // Architect Build owns LMB paint / RMB delete; Shift+MMB orbits around Z; MMB pans via Trackball.
  if (architectControlsActive && architectSession?.isActive?.()) {
    if (e.button === 1 && e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      architectZOrbit = {
        pointerId: e.pointerId,
        lastX: e.clientX,
        lastY: e.clientY,
        controlsWereEnabled: controls.enabled,
      };
      controls.enabled = false;
      renderer.domElement.setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button === 0 || e.button === 2) {
      const handled = architectSession.handlePointerDown(e);
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
        try {
          renderer.domElement.setPointerCapture?.(e.pointerId);
        } catch (_) {}
        return;
      }
    }
  }

  if (canUseViewportSelectGesture(e)) {
    controlsEnabledBeforeViewportSelect = controls.enabled;
    controls.enabled = false;
    renderer.domElement.setPointerCapture?.(e.pointerId);
    const hit = pickObject(e, {
      camera,
      domElement: renderer.domElement,
      meshRoot: currentMesh,
    });
    viewportSelectDrag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      hit,
      marquee: false,
    };
    if (hit?.mesh) {
      const beforeSelection = objectTools.getSelection?.();
      const target = selectionTargetFromMesh(hit.mesh);
      const wasAlreadySelected = beforeSelection?.mesh === target.mesh || beforeSelection?.root === target.root;
      selectObjectHit(hit);
      suppressNextObjectClick = true;
      if (!wasAlreadySelected) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }
  }
  if (getPickMode() === "lasso" && currentMesh) {
    if (e.button !== 0) return;
    e.stopImmediatePropagation();
    lassoPointerActive = beginLasso(e, {
      camera,
      domElement: renderer.domElement,
      meshRoot: currentMesh,
      meshCenterOffset,
    });
    if (lassoPointerActive) {
      renderer.domElement.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    }
  }
}, true);

renderer.domElement.addEventListener("pointermove", (e) => {
  if (architectZOrbit?.pointerId === e.pointerId) {
    const dx = e.clientX - architectZOrbit.lastX;
    const dy = e.clientY - architectZOrbit.lastY;
    architectZOrbit.lastX = e.clientX;
    architectZOrbit.lastY = e.clientY;
    const t = controls.target;
    const offset = new THREE.Vector3().subVectors(camera.position, t);
    const radius = Math.max(offset.length(), 0.5);

    // Left/right → yaw around world Z
    if (dx) {
      const yaw = -dx * 0.0075;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const x = offset.x;
      const y = offset.y;
      offset.x = x * c - y * s;
      offset.y = x * s + y * c;
    }

    // Up/down → tilt between head-on and top-down (orbit pitch around target)
    if (dy) {
      const horiz = Math.hypot(offset.x, offset.y);
      let polar = Math.atan2(horiz, offset.z); // 0 = top-down, π/2 = horizontal
      polar += dy * 0.0075;
      // Keep above the floor: nearly top-down → nearly head-on, never under
      const minPolar = 0.12; // ~7° from straight down
      const maxPolar = Math.PI / 2 - 0.08; // slightly above horizon
      polar = Math.min(maxPolar, Math.max(minPolar, polar));
      const az = Math.atan2(offset.y, offset.x);
      offset.x = radius * Math.sin(polar) * Math.cos(az);
      offset.y = radius * Math.sin(polar) * Math.sin(az);
      offset.z = radius * Math.cos(polar);
    } else if (dx) {
      // After yaw-only, preserve radius
      offset.setLength(radius);
    }

    camera.position.copy(t).add(offset);
    camera.up.set(0, 0, 1);
    camera.lookAt(t);
    controls._eye?.subVectors(camera.position, controls.target);
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  if (architectSession?.isActive?.()) {
    architectSession.handlePointerMove(e);
  }
  if (viewportSelectDrag?.pointerId === e.pointerId) {
    const moved = Math.hypot(e.clientX - viewportSelectDrag.startX, e.clientY - viewportSelectDrag.startY);
    if (moved > 6 && !viewportSelectDrag.marquee) {
      viewportSelectDrag.marquee = true;
      setViewportMarqueeVisible(true);
      updateViewportMarquee(viewportSelectDrag, e);
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    if (viewportSelectDrag.marquee) {
      updateViewportMarquee(viewportSelectDrag, e);
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
  }
  if (getPickMode() === "off" || !currentMesh) return;
  if (getPickMode() === "lasso") {
    if (lassoPointerActive) {
      e.stopImmediatePropagation();
      updateLasso(e, {
        camera,
        domElement: renderer.domElement,
        meshRoot: currentMesh,
        meshCenterOffset,
      });
      e.preventDefault();
    }
    return;
  }
  if (getPickMode() === "line") {
    if (hasLineDraft()) {
      updateLinePreview(e, {
        camera,
        domElement: renderer.domElement,
        meshRoot: currentMesh,
        meshCenterOffset,
      });
    }
    return;
  }
  updateHover(e, {
    camera,
    domElement: renderer.domElement,
    meshRoot: currentMesh,
    meshCenterOffset,
  });
  // Live preview: dashed line from last measurement pick to cursor
  if (measureModeActive && measureReferences.length > 0 && currentMesh) {
    updateMeasureLivePreview(
      e,
      measureReferences[measureReferences.length - 1],
      camera,
      renderer.domElement,
      currentMesh
    );
  }
}, true);

function finishActiveLinePath() {
  if (getPickMode() !== "line" || !hasLineDraft()) return false;
  const result = finishLinePath({ meshRoot: currentMesh, meshCenterOffset });
  if (result?.ref) {
    composer.addReference(result.ref);
    viewerOverlay.clearError();
    editTools.updateExtrudeTarget?.();
    if (pickHintText) pickHintText.textContent = PICK_HINTS.line.text;
    return true;
  }
  return false;
}

renderer.domElement.addEventListener("dblclick", (e) => {
  if (getPickMode() !== "line") return;
  e.preventDefault();
  finishActiveLinePath();
});

function finishActiveLasso(e) {
  if (!lassoPointerActive) return;
  e.stopImmediatePropagation();
  const result = finishLasso(e, {
    camera,
    domElement: renderer.domElement,
    meshRoot: currentMesh,
    meshCenterOffset,
  });
  renderer.domElement.releasePointerCapture?.(e.pointerId);
  lassoPointerActive = false;
  if (result?.ref) {
    composer.addReference(result.ref);
    viewerOverlay.clearError();
    editTools.updateExtrudeTarget?.();
  }
  e.preventDefault();
}

renderer.domElement.addEventListener("pointerup", finishActiveLasso, true);
renderer.domElement.addEventListener("pointerup", (e) => {
  if (architectZOrbit?.pointerId === e.pointerId) {
    controls.enabled = architectZOrbit.controlsWereEnabled !== false;
    architectZOrbit = null;
    try {
      renderer.domElement.releasePointerCapture?.(e.pointerId);
    } catch (_) {}
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  if (architectSession?.isActive?.()) {
    if (architectSession.handlePointerUp(e)) {
      try {
        renderer.domElement.releasePointerCapture?.(e.pointerId);
      } catch (_) {}
      e.preventDefault();
    }
  }
  if (viewportSelectDrag?.pointerId !== e.pointerId) return;
  const drag = viewportSelectDrag;
  viewportSelectDrag = null;
  renderer.domElement.releasePointerCapture?.(e.pointerId);
  controls.enabled = controlsEnabledBeforeViewportSelect;
  if (drag.hit?.mesh && !drag.marquee) {
    window.setTimeout(() => {
      suppressNextObjectClick = false;
    }, 0);
  }
  if (drag.marquee) {
    setViewportMarqueeVisible(false);
    selectFromViewportMarquee(drag, e);
    suppressNextObjectClick = true;
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}, true);
renderer.domElement.addEventListener("pointercancel", (e) => {
  if (architectZOrbit?.pointerId === e.pointerId) {
    controls.enabled = architectZOrbit.controlsWereEnabled !== false;
    architectZOrbit = null;
  }
  if (architectSession?.isActive?.()) {
    architectSession.handlePointerUp(e);
  }
  if (viewportSelectDrag?.pointerId === e.pointerId) {
    viewportSelectDrag = null;
    setViewportMarqueeVisible(false);
    renderer.domElement.releasePointerCapture?.(e.pointerId);
    controls.enabled = controlsEnabledBeforeViewportSelect;
  }
  if (!lassoPointerActive) return;
  e.stopImmediatePropagation();
  cancelLasso();
  renderer.domElement.releasePointerCapture?.(e.pointerId);
  lassoPointerActive = false;
}, true);

renderer.domElement.addEventListener("contextmenu", (e) => {
  if (!architectControlsActive || !architectSession?.isActive?.()) return;
  e.preventDefault();
}, true);

renderer.domElement.addEventListener("click", (e) => {
  // Architect uses pointerdown/move/up for paint — ignore leftover clicks.
  if (architectSession?.isActive?.()) {
    e.preventDefault();
    return;
  }
  if (suppressNextObjectClick) {
    suppressNextObjectClick = false;
    e.preventDefault();
    return;
  }
  if (sketchFacePickActive) {
    const hit = pickFaceHit(e);
    if (hit) {
      const planeRef = computeFacePlaneRef(hit, camera);
      sketchFacePickActive = false;
      clearHover();
      workspaceModes.setDesignTab("SKETCH");
      sketchEditor.startWithPlaneRef(planeRef);
      enterSketchMode();
      setEditStatus("ok", "Sketching on selected face — draw your profile, then Finish Sketch.");
    } else {
      setEditStatus("error", "Click a face on the model (not empty space).");
    }
    e.preventDefault();
    return;
  }
  if (sketchEditor.isActive?.()) return;
  if (!currentMesh) return;
  // Press-pull / mirror use pointer events on the canvas — don't treat clicks as object select.
  if (directModeling.isToolActive?.()) return;
  if (handleReferenceRemove(e)) return;
  if (pointerDownPos) {
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (dx * dx + dy * dy > 36) return;
  }
  if (handlePendingSnapTarget(e)) {
    e.preventDefault();
    return;
  }
  if (getPickMode() === "off") {
    if (isMobileInteraction()) return;
    const hit = pickObject(e, {
      camera,
      domElement: renderer.domElement,
      meshRoot: currentMesh,
    });
    if (hit?.mesh) {
      selectObjectHit(hit);
      e.preventDefault();
    }
    return;
  }
  if (getPickMode() === "lasso") return;
  if (getPickMode() === "line") {
    const added = addLinePoint(e, {
    camera,
    domElement: renderer.domElement,
    meshRoot: currentMesh,
    meshCenterOffset,
  });
    if (added) {
      viewerOverlay.clearError();
      if (pickHintText) {
        pickHintText.textContent = `${added.count} point${added.count === 1 ? "" : "s"} placed · click more, or double-click / Enter to finish`;
      }
    }
    e.preventDefault();
    return;
  }
  if (getPickMode() === "object") {
    const hit = pickObject(e, {
      camera,
      domElement: renderer.domElement,
      meshRoot: currentMesh,
    });
    if (!hit?.mesh) {
      objectTools.clearSelection();
      gizmoPanel.hide();
      transformControls.detach();
      document.getElementById("btn-gizmo")?.classList.remove("active");
      setEditStatus("", "");
      e.preventDefault();
      return;
    }
    if (objectTools.getSelection()?.mesh === hit.mesh) {
      objectTools.clearSelection();
      gizmoPanel.hide();
      transformControls.detach();
      document.getElementById("btn-gizmo")?.classList.remove("active");
      setEditStatus("", "");
    } else {
      selectObjectHit(hit);
    }
    e.preventDefault();
    return;
  }
  const pickingForMeasure = measureModeActive && MEASURE_PICK_MODES.has(getPickMode());
  const activeReferences = pickingForMeasure ? measureReferences : composer.getReferences();
  const result = pickGeometry(e, {
    camera,
    domElement: renderer.domElement,
    meshRoot: currentMesh,
    meshCenterOffset,
    references: activeReferences,
  });
  if (!result) return;
  if (pickingForMeasure) {
    if (result.toggle === "remove") {
      const idx = measureReferences.findIndex((ref) => ref.id === result.ref.id);
      if (idx >= 0) measureReferences.splice(idx, 1);
    } else {
      measureReferences.push(result.ref);
    }
    setMeasureAnnotations(measureReferences, currentMmPerModelUnit(), currentMesh, formatLength);
    clearMeasureLivePreview();
    void showMeasureAnalytics({ refs: measureReferences, promptMode: true });
    viewerOverlay.clearError();
    clearHover();
    e.preventDefault();
    return;
  } else if (result.toggle === "remove") {
    composer.removeReference(result.ref.id);
    viewerOverlay.clearError();
  } else {
    composer.addReference(annotatePickedReference(result.ref));
    viewerOverlay.clearError();
  }
  editTools.updateExtrudeTarget?.();
  clearHover();
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("#btn-gizmo");
  if (!btn) return;
  const on = btn.classList.toggle("active");
  if (on && currentMesh) {
    const mesh = objectTools.getSelection()?.mesh || currentMesh;
    if (!objectTools.getSelection()?.mesh) {
      objectTools.selectObject({ mesh, root: currentMesh, bodyIndex: 0 });
    }
    showObjectGizmo(mesh);
  } else {
    transformControls.detach();
    gizmoPanel.hide();
    controls.enabled = getPickMode() === "off";
  }
});

document.getElementById("btn-new-project")?.addEventListener("click", () => createNewProject());
document.getElementById("btn-export-model")?.addEventListener("click", (e) => {
  exportCurrentModel(e.currentTarget).catch((err) => alert(err.message || "Could not export"));
});
document.getElementById("btn-rename-project")?.addEventListener("click", () => {
  if (!projectId) return;
  const p = allProjects.find((x) => x.id === projectId) || { id: projectId, name: projectId };
  renameProject(p);
});

function currentProjectLabel() {
  if (!projectId) return null;
  const p = allProjects.find((x) => x.id === projectId);
  return p?.name ? `${p.name} (${projectId})` : projectId;
}

function askDropDestination(fileOrFiles) {
  return new Promise((resolve) => {
    const modal = document.getElementById("drop-destination-modal");
    const fileEl = document.getElementById("drop-destination-file");
    const currentBtn = document.getElementById("drop-destination-current");
    const currentLabel = document.getElementById("drop-destination-current-label");
    const newBtn = document.getElementById("drop-destination-new");
    const capturedProjectId = projectId;
    if (!modal || !fileEl || !currentBtn || !newBtn) {
      resolve(capturedProjectId ? { destination: "current", projectId: capturedProjectId } : { destination: "new" });
      return;
    }

    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    const label = currentProjectLabel();
    fileEl.textContent = files.length === 1
      ? files[0].name
      : `${files.length} CAD files: ${files.slice(0, 3).map((f) => f.name).join(", ")}${files.length > 3 ? ", ..." : ""}`;
    if (capturedProjectId && label) {
      currentBtn.disabled = false;
      currentLabel.textContent = label;
    } else {
      currentBtn.disabled = true;
      currentLabel.textContent = "No project open — use New project";
    }

    const cleanup = () => {
      modal.classList.add("hidden");
      currentBtn.removeEventListener("click", onCurrent);
      newBtn.removeEventListener("click", onNew);
      modal.querySelectorAll("[data-drop-dest-close]").forEach((el) => {
        el.removeEventListener("click", onCancel);
      });
      document.removeEventListener("keydown", onKey);
    };

    const onCurrent = () => {
      cleanup();
      resolve({ destination: "current", projectId: capturedProjectId });
    };
    const onNew = () => {
      cleanup();
      resolve({ destination: "new" });
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") onCancel();
    };

    currentBtn.addEventListener("click", onCurrent);
    newBtn.addEventListener("click", onNew);
    modal.querySelectorAll("[data-drop-dest-close]").forEach((el) => {
      el.addEventListener("click", onCancel);
    });
    document.addEventListener("keydown", onKey);
    modal.classList.remove("hidden");
    (capturedProjectId && label ? currentBtn : newBtn).focus();
  });
}

async function uploadDxfProjectFile(file, choice = {}) {
  const destination = choice.destination || "current";
  let targetProjectId;

  if (destination === "new") {
    saveActiveModelPromptState();
    await createNewProject();
    targetProjectId = projectId;
  } else {
    targetProjectId = choice.projectId || projectId;
    if (!targetProjectId && choice.projectId === undefined) {
      await ensureProjectForUpload();
      targetProjectId = projectId;
    }
    if (!targetProjectId) {
      throw new Error("Select a project in the sidebar first, or choose New project.");
    }
    if (targetProjectId !== projectId) {
      await loadProject(targetProjectId);
    } else {
      ribbon.setProjectId(targetProjectId);
    }
  }

  const form = new FormData();
  form.append("file", file);
  const res = await rawFetch(`/api/projects/${targetProjectId}/upload`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : "Upload failed");
  }
  saveActiveModelPromptState();
  selectedFile = data.filename;
  await refreshFiles();
  projectTree.setSelected(data.filename);
  await refreshTimeline();
  await dxfViewer.openTab(data.filename, {
    projectId: targetProjectId,
    label: file.name.replace(/\.dxf$/i, ""),
  });
  setEditStatus("ok", `Added ${data.filename} to Drawings.`);
  return data;
}

async function uploadProjectFile(file, choice = {}) {
  const destination = choice.destination || "current";
  const hadComponents = projectAssembly.count() > 0;
  let targetProjectId;

  if (destination === "new") {
    saveActiveModelPromptState();
    await createNewProject();
    targetProjectId = projectId;
  } else {
    targetProjectId = choice.projectId || projectId;
    if (!targetProjectId && choice.projectId === undefined) {
      await ensureProjectForUpload();
      targetProjectId = projectId;
    }
    if (!targetProjectId) {
      throw new Error("Select a project in the sidebar first, or choose New project.");
    }
    if (targetProjectId !== projectId) {
      await loadProject(targetProjectId);
    } else {
      ribbon.setProjectId(targetProjectId);
    }
  }

  const form = new FormData();
  form.append("file", file);
  const res = await rawFetch(`/api/projects/${targetProjectId}/upload`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : "Upload failed");
  }
  saveActiveModelPromptState();
  selectedFile = data.filename;
  await refreshFiles();
  projectTree.setSelected(data.filename);
  const viewerFile = data.viewer_filename || data.filename;
  await loadModel(data.url, viewerFile, {
    projectId: targetProjectId,
    append: destination === "current" && hadComponents,
    catalogFilename: data.filename,
    autoGizmo: false,
    fitView: true,
  });
  await refreshTimeline();
  setEditStatus("ok", `Added ${data.filename} to this project.`);
  return data;
}

async function importSourcedStepToProject(source, { profile = null, entry = null } = {}) {
  if (!source?.step_url) {
    throw new Error("This sourced part does not include a downloadable STEP file.");
  }
  const displayName = source.name || profile?.label || entry?.stem || "sourced-part";
  const choice = await askDropDestination({ name: `${displayName}.step` });
  if (!choice) return null;

  let targetProjectId = choice.projectId || projectId;
  if ((choice.destination || "current") === "new") {
    saveActiveModelPromptState();
    await createNewProject();
    targetProjectId = projectId;
  } else if (!targetProjectId) {
    await ensureProjectForUpload();
    targetProjectId = projectId;
  } else if (targetProjectId !== projectId) {
    await loadProject(targetProjectId);
  }
  if (!targetProjectId) throw new Error("Select a project first, or choose New project.");

  setEditStatus("ok", `Importing ${displayName} STEP...`);
  const data = await api(`/api/projects/${targetProjectId}/parts/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: source.name || profile?.label || entry?.stem || "part",
      step_url: source.step_url,
      glb_url: source.glb_url,
      png_url: source.png_url,
      page_url: source.page_url,
      product_page_url: source.product_page_url,
      source_id: source.id,
      wiring_type: source.wiring_type || profile?.wiring_type || null,
      attributes: source.attributes || profile?.stats || {},
    }),
  });

  saveActiveModelPromptState();
  selectedFile = data.filename;
  await refreshFiles();
  await refreshPartProfiles();
  projectTree.setSelected(data.filename);
  const viewerFile = data.viewer_filename || data.filename;
  await loadModel(data.url || `/api/projects/${targetProjectId}/files/${encodeURIComponent(viewerFile)}`, viewerFile, {
    projectId: targetProjectId,
    append: projectAssembly.count() > 0,
    catalogFilename: data.filename,
    autoGizmo: false,
    fitView: true,
  });
  await refreshTimeline();
  setEditStatus("ok", `Imported ${data.filename} to this project.`);
  return data;
}

async function uploadProjectFiles(files, choice = {}) {
  const meshFiles = [...(files || [])].filter((file) => IMPORT_ACCEPT.test(file.name));
  const dxfFiles = [...(files || [])].filter((file) => DXF_ACCEPT.test(file.name));
  if (!meshFiles.length && !dxfFiles.length) return [];

  let uploadChoice = { ...choice };
  if ((uploadChoice.destination || "current") === "new") {
    saveActiveModelPromptState();
    await createNewProject();
    uploadChoice = { destination: "current", projectId };
  }

  if ((uploadChoice.destination || "current") === "current" && !uploadChoice.projectId) {
    await ensureProjectForUpload();
    uploadChoice = { destination: "current", projectId };
  }

  const results = [];
  for (const file of meshFiles) {
    setEditStatus("ok", `Uploading ${file.name}...`);
    results.push(await uploadProjectFile(file, uploadChoice));
  }
  for (const file of dxfFiles) {
    setEditStatus("ok", `Uploading ${file.name}...`);
    results.push(await uploadDxfProjectFile(file, uploadChoice));
  }

  const total = meshFiles.length + dxfFiles.length;
  setEditStatus(
    "ok",
    total === 1
      ? `Added ${results[0]?.filename || meshFiles[0]?.name || dxfFiles[0]?.name} to this project.`
      : `Added ${total} files to this project.`,
  );
  return results;
}

document.getElementById("file-upload")?.addEventListener("change", async (e) => {
  const files = [...(e.target.files || [])].filter((f) => isViewportImportFile(f.name));
  if (!files.length) return;
  try {
    const choice = await askDropDestination(files);
    if (choice) await uploadProjectFiles(files, choice);
  } catch (err) {
    alert(err.message || "Upload failed");
  }
  e.target.value = "";
});

document.getElementById("btn-grid-viewport")?.addEventListener("click", toggleGrid);

// Delegated listeners for view buttons that live inside the ribbon (inserted after module eval)
document.addEventListener("click", async (e) => {
  if (e.target.closest("#btn-fit")) { fitCamera(); return; }

  const historyTreeBtn = e.target.closest("#btn-history-tree");
  if (historyTreeBtn) {
    if (projectId) await refreshTimeline();
    openObjectIterationTree(historyTreeBtn);
    return;
  }

  const wireBtn = e.target.closest("#btn-wireframe");
  if (wireBtn) {
    const wire = viewMode !== "wireframe";
    setViewMode(wire ? "wireframe" : "solid", currentMesh);
    wireBtn.classList.toggle("active", wire);
    return;
  }

  if (e.target.closest("#btn-section")) {
    if (sectionView.isActive()) sectionView.deactivate();
    else sectionView.activate();
    return;
  }

  if (e.target.closest("#btn-grid")) { toggleGrid(); return; }
});
document.getElementById("btn-sketches-viewport")?.addEventListener("click", () => {
  const btn = document.getElementById("btn-sketches-viewport");
  const next = !sketchEditor.isGlobalSketchesVisible?.();
  sketchEditor.setAllViewportSketchesVisible?.(next);
  btn?.classList.toggle("active", next);
  btn?.setAttribute("aria-pressed", next ? "true" : "false");
  setEditStatus("ok", next ? "Sketches shown in viewport." : "Sketches hidden in viewport.");
});
function formatDesignPlanReply(plan) {
  if (!plan || typeof plan !== "object") return "";
  const lines = ["\n--- Design plan ---"];
  const sections = [
    ["Requirements", plan.requirements_analysis],
    ["Hierarchy", plan.component_hierarchy],
    ["Assembly", plan.assembly_plan],
    ["Feature plan", plan.cad_feature_plan],
    ["Part generation", plan.part_generation],
    ["Constraints", plan.assembly_constraints],
    ["B-rep output", plan.step_ready_brep_output],
  ];
  for (const [label, text] of sections) {
    if (text) lines.push(`${label}: ${text}`);
  }
  const dims = plan.parametric_dimension_table;
  if (Array.isArray(dims) && dims.length) {
    lines.push("Dimensions:");
    for (const row of dims.slice(0, 24)) {
      if (!row?.param) continue;
      const src = row.source ? ` (${row.source})` : "";
      const note = row.notes ? ` — ${row.notes}` : "";
      lines.push(`  • ${row.param} = ${row.value_mm} mm${src}${note}`);
    }
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function parseHoleDiameterMm(prompt) {
  const text = String(prompt || "").toLowerCase();
  const spec = parseDrawHoleSpec(prompt);
  return spec.diameterMm;
}

function toMmValue(value, unit = "mm") {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return unit === "in" || unit === "inch" || unit === "inches" || unit === '"' ? n * 25.4 : n;
}

function parseDrawHoleSpec(prompt) {
  const text = String(prompt || "").toLowerCase();
  const countMatch = text.match(/\b(\d+)\s*(?:x\s*)?holes?\b/);
  const depthMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?\s*(?:deep|depth)\b|\bdepth\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?/);
  const explicitDiameter =
    text.match(/(?:ø|diameter|dia)\s*(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?/) ||
    text.match(/\b(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?\s*(?:diameter|dia|ø)\b/);
  const circleSize =
    text.match(/\b(?:on|around|in)\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?\s*(?:bolt\s*)?(?:circle|pcd)\b/) ||
    text.match(/\b(?:radius|circle\s+radius)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?/);
  let diameterMm = explicitDiameter ? toMmValue(explicitDiameter[1], explicitDiameter[2] || "mm") : null;
  if (!diameterMm) {
    const numeric = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?\b/g)];
    for (const match of numeric) {
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 16);
      if (/^\s*holes?\b/.test(after)) continue;
      if (/^\s*(deep|depth)\b/.test(after)) continue;
      if (circleSize && match[1] === circleSize[1]) continue;
      diameterMm = toMmValue(match[1], match[2] || "mm");
      if (diameterMm) break;
    }
  }
  const depthMm = depthMatch
    ? toMmValue(depthMatch[1] || depthMatch[3], depthMatch[2] || depthMatch[4] || "mm")
    : null;
  let patternRadiusMm = circleSize ? toMmValue(circleSize[1], circleSize[2] || "mm") : null;
  if (circleSize && /(?:diameter|pcd|bolt\s*circle|circle)\b/.test(circleSize[0]) && !/radius/.test(circleSize[0])) {
    patternRadiusMm = patternRadiusMm ? patternRadiusMm / 2 : null;
  }
  return {
    diameterMm: diameterMm || 3,
    depthMm,
    patternCount: countMatch ? Math.max(1, Number(countMatch[1]) || 1) : null,
    patternRadiusMm,
    isCirclePattern: /\bcircle|circular|around|evenly|pattern|bolt\s*circle|pcd\b/.test(text),
  };
}

function parseLegacyHoleDiameterMm(prompt) {
  const text = String(prompt || "").toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?\s*(?:diameter|dia|ø|hole)?/);
  if (!match) return null;
  return toMmValue(match[1], match[2] || "mm");
}

function isHoleDrawPrompt(prompt) {
  const text = String(prompt || "").toLowerCase();
  return /\bhole\b|\bdrill\b|\bthrough\b|ø/.test(text);
}

function isRouteDrawPrompt(prompt) {
  const text = String(prompt || "").toLowerCase();
  return /\bducts?\b|\bconduit\b|\bwire\s*loops?\b|\bloops?\b|\bhoops?\b|\bclips?\b|\brouting\b|\broute\b/.test(text);
}

function parseDrawRouteSpec(prompt) {
  const text = String(prompt || "").toLowerCase();
  const routeType = /\bloops?\b|\bhoops?\b|\bclips?\b/.test(text) ? "loops" : "duct";
  const diameterMatch =
    text.match(/\b(?:diameter|dia|ø|wire|duct)\s*(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?/) ||
    text.match(/\b(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?\s*(?:diameter|dia|ø|wide|thick)\b/);
  const heightMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?\s*(?:high|tall|height)\b/);
  const widthMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?\s*(?:wide|width)\b/);
  const spacingMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|in|inch|inches|")?\s*(?:apart|spacing|spaced)\b/);
  return {
    routeType,
    diameterMm: (diameterMatch ? toMmValue(diameterMatch[1], diameterMatch[2] || "mm") : null) || (routeType === "loops" ? 2.0 : 4.0),
    loopHeightMm: heightMatch ? toMmValue(heightMatch[1], heightMatch[2] || "mm") : null,
    loopWidthMm: widthMatch ? toMmValue(widthMatch[1], widthMatch[2] || "mm") : null,
    loopSpacingMm: spacingMatch ? toMmValue(spacingMatch[1], spacingMatch[2] || "mm") : null,
  };
}

async function runDrawRoutePrompt(prompt, pathRef) {
  await ensureProject();
  const status = document.getElementById("prompt-status");
  const reply = document.getElementById("prompt-reply");
  const points = (pathRef?.loop_points || []).filter((p) => Array.isArray(p) && p.length === 3);
  const surfaceNormals = Array.isArray(pathRef?.surface_normals)
    ? pathRef.surface_normals.filter((n) => n === null || (Array.isArray(n) && n.length === 3))
    : [];
  if (points.length < 2) {
    throw new Error("Draw route needs a line path. Use the Line tool, click at least two points between objects, then finish the path.");
  }
  const selection = objectTools.getSelection?.();
  const filename = selection?.catalogName || selectedFile;
  if (!filename) throw new Error("Load or select a model file first.");
  const spec = parseDrawRouteSpec(prompt);
  status.className = "status loading";
  status.textContent = spec.routeType === "loops" ? "Drawing wire loops along path..." : "Drawing wire duct along path...";
  if (reply) reply.textContent = "";
  const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/draw-route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      points,
      surface_normals: surfaceNormals.length === points.length ? surfaceNormals : null,
      surface_locked: pathRef?.surface_locked !== false,
      route_type: spec.routeType,
      diameter_mm: spec.diameterMm,
      loop_width_mm: spec.loopWidthMm,
      loop_height_mm: spec.loopHeightMm,
      loop_spacing_mm: spec.loopSpacingMm,
    }),
  });
  await afterModelEdit({ ...data, replaceCatalog: filename });
    status.className = "status ok";
  status.textContent = data.message || "Draw route applied.";
  if (reply) {
    reply.textContent = `${data.message || "Added route geometry."}\nMode: Draw · Path: ${pathRef.token || pathRef.id} · Type: ${spec.routeType}`;
  }
  viewerOverlay.clearError();
  showAiComposePanel();
  return data;
}

async function runDrawPrompt(prompt) {
  await ensureProject();
  const status = document.getElementById("prompt-status");
  const reply = document.getElementById("prompt-reply");
  const refs = composer.getReferences?.() || [];
  const pathRef = refs.find((r) => r.type === "path" && Array.isArray(r.loop_points) && r.loop_points.length >= 2);
  if (isRouteDrawPrompt(prompt)) {
    if (!pathRef) {
      throw new Error("Draw route needs a line path. Use the Line tool, click points between the two objects, finish the path, then ask for a duct or wire loops.");
    }
    return runDrawRoutePrompt(prompt, pathRef);
  }
  const faceRef = refs.find((r) => r.type === "face" || r.face_index != null);
  if (!faceRef) {
    throw new Error("Draw needs a selected face. Pick Face, click a surface, then ask for the hole/sketch edit.");
  }
  if (!isHoleDrawPrompt(prompt)) {
    throw new Error("Draw currently supports selected-face hole commands. Try: “put a 4 mm hole in the middle of this face.”");
  }
  const spec = parseDrawHoleSpec(prompt);
  const diameterMm = spec.diameterMm || parseLegacyHoleDiameterMm(prompt) || 3;
  const selection = objectTools.getSelection?.();
  const filename = selection?.catalogName || selectedFile;
  if (!filename) throw new Error("Load or select a model file first.");
  const patternCount = spec.isCirclePattern && spec.patternCount > 1 ? spec.patternCount : null;
  const placement = patternCount || /\bmiddle\b|\bcenter\b|\bcentre\b/.test(String(prompt).toLowerCase()) ? "center" : "picked";
  const throughAll = !spec.depthMm || /\bthrough\b|through-all|all\s+the\s+way/i.test(String(prompt));
  status.className = "status loading";
  status.textContent = patternCount
    ? `Drawing ${patternCount} × ${Number(diameterMm.toFixed(3))} mm holes...`
    : `Drawing ${Number(diameterMm.toFixed(3))} mm hole...`;
  if (reply) reply.textContent = "";
  const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/draw-hole`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      face_index: faceRef.face_index,
      position: faceRef.position,
      normal: faceRef.normal,
      diameter_mm: diameterMm,
      depth_mm: spec.depthMm || null,
      placement,
      through_all: throughAll,
      pattern_count: patternCount,
      pattern_radius_mm: spec.patternRadiusMm || null,
    }),
  });
  await afterModelEdit({ ...data, replaceCatalog: filename });
  status.className = "status ok";
  status.textContent = data.message || `Draw applied: ${diameterMm} mm hole.`;
  if (reply) {
    reply.textContent = `${data.message || `Added ${patternCount || 1} hole${patternCount ? "s" : ""}.`}\nMode: Draw · Placement: ${placement}${spec.depthMm ? ` · Depth: ${spec.depthMm} mm` : ""}`;
  }
  viewerOverlay.clearError();
  showAiComposePanel();
  return data;
}

document.getElementById("btn-stop-generation")?.addEventListener("click", () => {
  void cancelActiveGeneration();
});

document.addEventListener("click", (event) => {
  if (!viewportPromptDropdown) return;
  if (event.target.closest(".vgu-prompt-menu") || event.target.closest("#viewport-generation-user")) return;
  closeViewportPromptDropdown();
});

document.getElementById("viewport-generation-user")?.addEventListener("click", async (event) => {
  event.stopPropagation();
  const gen = allProjects.find((p) => p.id === projectId)?.generation || {};
  const btn = document.getElementById("viewport-generation-user");
  if (!latestPromptHistoryEntries.length && projectId) {
    try {
      const data = await api(`/api/projects/${projectId}/prompt-history?kind=cad`);
      latestPromptHistoryEntries = data.entries || [];
    } catch {
      latestPromptHistoryEntries = [];
    }
  }
  const recentPrompts = latestPromptsForGenerationUser(
    gen.by_user_id || btn?.dataset.userId || "",
    gen.by_user_name || btn?.dataset.user || "",
  );
  const latestPrompt = recentPrompts[0]?.prompt || gen.prompt || btn?.dataset.prompt || "";
  const user = gen.by_user_name || document.getElementById("viewport-generation-user")?.dataset.user || "Someone";
  showAiComposePanel();
  const statusEl = document.getElementById("prompt-status");
  if (statusEl) {
    statusEl.className = "status ok";
    statusEl.textContent = latestPrompt
      ? `Copied to clipboard: latest prompt by ${user}`
      : `${user} is generating. No prompt text found to copy.`;
  }
  if (latestPrompt) {
    const ok = await copyText(latestPrompt);
    setEditStatus(ok ? "ok" : "error", ok ? "Copied to clipboard: latest prompt." : "Could not copy prompt.");
  }
  showViewportPromptDropdown(btn, recentPrompts);
});

document.getElementById("btn-prompt")?.addEventListener("click", async () => {
  const canvasAttached = applyCanvasSketchToPrompt();
  if (canvasAttached && promptMode === "draw") applyPromptModeUI("render");
  let prompt = composer.getPromptText();
  if (canvasAttached) prompt = augmentPromptForCanvasSketch(prompt);
  if (canvasAttached && prompt !== composer.getPromptText()) composer.setPromptText(prompt);
  if (!prompt) return;
  if (!suppressAiComposePanelSwitch) showAiComposePanel();
  suppressAiComposePanelSwitch = false;
  if (workspaceModes?.isWiring?.()) {
    const wiringInput = document.getElementById("wiring-prompt-input");
    const wiringStatus = document.getElementById("wiring-prompt-status");
    if (wiringInput) wiringInput.value = prompt;
    if (wiringStatus) {
      wiringStatus.className = "status";
      wiringStatus.textContent = "Generating wiring schematic…";
    }
    document.getElementById("btn-wiring-prompt")?.click();
    return;
  }
  if (isGenerationUiActive(projectId)) {
    try {
      const gen = await api(`/api/projects/${projectId}/generation`);
      const proj = allProjects.find((p) => p.id === projectId);
      if (proj) proj.generation = gen;
      if (gen?.status === "running") {
        await resumeGenerationIfNeeded(projectId, gen);
        return;
      }
      if (gen?.status === "complete") {
        await resumeGenerationIfNeeded(projectId, gen);
        return;
      }
      stopGenerationWatch();
      hideViewportOverlay(projectId);
    } catch {
      syncViewportGenerationOverlay();
      return;
    }
  }
  if (promptMode === "draw") {
    lastPromptCopyContext = promptCopyContextBase(prompt);
    try {
      await runDrawPrompt(prompt);
    } catch (err) {
      const status = document.getElementById("prompt-status");
      if (status) {
        status.className = "status error";
        status.textContent = formatUserError(err);
      }
      viewerOverlay.showError(formatUserError(err));
    }
    return;
  }
  if (isDimensionQuestion(prompt)) {
    lastPromptCopyContext = promptCopyContextBase(prompt);
    try {
      await answerDimensionPrompt(prompt);
      viewerOverlay.clearError();
    } catch (err) {
      const status = document.getElementById("prompt-status");
      if (status) {
        status.className = "status error";
        status.textContent = formatUserError(err);
      }
      viewerOverlay.showError(formatUserError(err));
    }
    return;
  }
  if (!aiStatus?.ai_ready && promptMode !== "render") {
    const status = document.getElementById("prompt-status");
    status.className = "status error";
    status.textContent = "Add your OpenAI or Claude API key from the account menu before prompting.";
    viewerOverlay.showError(status.textContent);
    aiKeyUi?.openRequired();
    return;
  }
  await ensureProject();
  syncPromptTargetUI();
  pendingPromptSelectionContext = capturePromptSelectionContext();
  const targetMode = getPromptTargetMode();
  const targetBaseFilename = promptBaseFilename({ canvasAttached });
  const promptReferences = promptReferencesForSubmit();
  const status = document.getElementById("prompt-status");
  const reply = document.getElementById("prompt-reply");
  const genMode = promptMode === "fusion" ? "fusion" : promptMode === "architect" ? "architect" : promptMode === "v2" ? "v2" : "standard";
  status.className = "status loading";
  status.textContent = promptMode === "fusion"
    ? `${targetMode === "edit" ? "Editing selected object" : "Adding new object"} with ${fusionTargetLabel()}... (builds, renders, reviews, repairs)`
    : promptMode === "architect"
    ? `${targetMode === "edit" ? "Editing selected module" : "Adding modular house part"} with Architect mode... (runs in background - safe to refresh)`
    : promptMode === "v2"
    ? `${targetMode === "edit" ? "Editing selected object" : "Adding new object"} with 2.0... (runs in background - safe to refresh)`
    : `${targetMode === "edit" ? "Editing selected object" : "Adding new object"} with ${getSelectedPromptAiKeyLabel()}… (runs in background — safe to refresh)`;
  reply.textContent = "";
  if (canvasAttached) markCanvasGenerationPending(projectId);
  beginGenerationWatch(projectId, { kind: "prompt", mode: genMode, pendingStart: true });
  const genId = ++activePromptGenerationId;
  userCancelRequested = false;
  activePromptAbort = null;
  let promptFailed = false;
  try {
    const body = {
      prompt,
      base_filename: targetBaseFilename,
      references: promptReferences,
      images: promptImages,
      speed: getPromptGenerationSpeed(),
      skills: getEnabledSkillsForPrompt({ hasImages: promptImages.length > 0 }),
      ...getPromptAiKeyBodyFields(),
      ...(promptMode === "fusion" ? { mode: "fusion", fusion_target: fusionTarget } : {}),
      ...(promptMode === "architect" ? { mode: "architect", skills: [...new Set([...getEnabledSkillsForPrompt({ hasImages: promptImages.length > 0 }), "cad", "architect"])] } : {}),
      ...(promptMode === "v2" ? { mode: "v2" } : {}),
    };
    lastPromptCopyContext = promptCopyContextBase(prompt, { promptMode: promptModeForRef(genMode) });
    const data = await api(
      `/api/projects/${projectId}/prompt`,
      {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      },
      120000
    );
    if (genId !== activePromptGenerationId) return;
    if (data.answered) {
      stopGenerationWatch();
    status.className = "status ok";
      status.textContent = data.prompt_id
        ? `Answered · ${formatPromptRef({
            promptId: data.prompt_id,
            projectId,
            filename: data.filename,
            traceId: data.trace_id,
            promptMode: data.prompt_mode || promptModeForRef(),
            model: data.model || getSelectedPromptModelInfo().model,
            provider: data.provider || getSelectedPromptModelInfo().provider,
          })}`
        : "Answered.";
    reply.textContent = data.message || "";
      setEditStatus("ok", data.message || "Answered.");
      await refreshPromptHistory();
      showAiComposePanel();
      pendingPromptSelectionContext = null;
      return;
    }
    if (data.accepted || data.status === "running") {
      if (!generationWatchOverlay || generationWatchPid !== projectId) {
        beginGenerationWatch(projectId, { kind: "prompt", mode: genMode, pendingStart: true });
      }
      lastPromptCopyContext = {
        ...lastPromptCopyContext,
        promptId: data.prompt_id,
        filename: data.filename || lastPromptCopyContext?.filename,
        traceId: data.trace_id,
      };
      if (data.generation) {
        const proj = allProjects.find((p) => p.id === projectId);
        if (proj) proj.generation = data.generation;
      }
      status.textContent = promptMode === "fusion"
        ? `Generating with ${fusionTargetLabel()} in background... building, rendering, reviewing, and repairing.`
        : promptMode === "architect"
        ? "Generating Architect module in background... building, rendering, reviewing, and repairing."
        : promptMode === "v2"
        ? "Generating with 2.0 in background... refresh anytime; model loads when ready."
        : "Generating in background... safe to switch tabs or refresh; model loads when ready.";
      syncViewportGenerationOverlay();
      syncStopButtonVisibility();
      syncCanvasGenerationUi();
      return;
    }
    stopGenerationWatch();
    window.dispatchEvent(new CustomEvent("render3d:model", { detail: { ...data, projectId } }));
    saveActiveModelPromptState();
    selectedFile = data.filename;
    await refreshFiles();
    const placedFiles = (data.placed_parts || []).map((part) => part.filename).filter(Boolean);
    await reloadViewportFromProject({
      fitView: true,
      latestFile: data.filename,
      placedFiles,
      loadAll: promptMode === "architect",
    });
    restorePromptSelectionContext(pendingPromptSelectionContext, { resultFilename: data.filename });
    pendingPromptSelectionContext = null;
    viewerOverlay.clearError();
    await refreshTimeline();
    await refreshPromptHistory();
    void refreshWorkspaceAiUsage();
    showAiComposePanel();
    clearPromptComposeResult();
    setEditStatus("ok", data.message || "Model ready.");
  } catch (err) {
    if (genId !== activePromptGenerationId || userCancelRequested) {
      if (userCancelRequested || !generationPollTimer) stopGenerationWatch();
      return;
    }
    promptFailed = true;
    pendingPromptSelectionContext = null;
    stopGenerationWatch();
    status.className = "status error";
    status.textContent = formatUserError(err);
    viewerOverlay.showError(formatUserError(err), lastPromptCopyContext || {});
    await refreshPromptHistory();
    showAiComposePanel();
  } finally {
    if (genId === activePromptGenerationId) activePromptAbort = null;
    if (genId !== activePromptGenerationId) return;
    if (!generationPollTimer && !isCadGenerationActive(projectId)) {
      hideViewportOverlay(projectId, { complete: !promptFailed });
      syncStopButtonVisibility();
    }
  }
});

// ── Parametric ribbon ─────────────────────────────────────────────────────────
ribbon = createRibbon({
  container: document.getElementById("ribbon-container"),
  apiFn: api,
  projectId: null,
  isBusy: () => isGenerationUiActive(projectId),
  onGenerating: (active, message) => {
    if (active) {
      showViewportOverlay(projectId, message || "Building model…", { mode: "build", estimateMs: 60000 });
    } else if (!generationPollTimer) {
      hideViewportOverlay(projectId, { complete: true });
    }
  },
  onGenerationStarted: (data) => {
    beginGenerationWatch(projectId, { kind: data?.generation?.kind || "build", pendingStart: true });
  },
  onBuildError: (message) => viewerOverlay.showError(message || "Build failed — see ribbon status or Activity Log."),
  onViewportTool: (toolId) => launchViewportTool(toolId),
  onSketchAction: handleSketchAction,
  onRiggingAction: handleRiggingAction,
  onArchitectAction: handleArchitectRibbonAction,
  onExportAction: () => {
    exportCurrentModel(document.querySelector('.ribbon-btn[data-id="export_model"]')).catch((err) =>
      alert(err.message || "Could not export"),
    );
  },
  onBuilt: async (filename, url) => {
    saveActiveModelPromptState();
    const inAssembly = projectAssembly.count() > 0;
    selectedFile = filename;
    await refreshFiles();
    await loadModel(url, filename, {
      projectId,
      preservePlacement: true,
      catalogFilename: filename,
      append: inAssembly,
      fitView: false,
      autoGizmo: true,
    });
    await refreshTimeline();
    await refreshPromptHistory();
  },
});

function isEditableShortcutTarget(target) {
  return !!target?.closest?.("textarea, input, select, [contenteditable='true'], [contenteditable='']");
}

function isUiPanelShortcutTarget(target) {
  return !!target?.closest?.(
    [
      ".sidebar",
      "#timeline-panel",
      "#ribbon-container",
      ".topbar",
      ".catalog-panel-overlay",
      ".modal",
      ".modal-backdrop",
      ".floating-panel",
      ".dm-hud",
      ".gizmo-panel",
      ".viewport-error-banner",
      ".viewport-spinner",
      ".viewport-generation-user",
      ".marking-menu",
      ".prompt-key-popup",
      ".prompt-target-popup",
      ".ribbon-search-results",
      ".workspace-menu",
      ".account-menu",
      ".canvas-generation-banner",
    ].join(", ")
  );
}

function shouldUseNativeClipboardShortcut(event, key, mod) {
  if (!mod || !["a", "c", "v", "x"].includes(key)) return false;
  if (isEditableShortcutTarget(event.target)) return true;
  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed) return true;
  return isUiPanelShortcutTarget(event.target);
}

function focusViewportForShortcuts() {
  const active = document.activeElement;
  if (active && isEditableShortcutTarget(active)) {
    active.blur?.();
  }
  renderer.domElement.focus({ preventScroll: true });
}

function isObjectDeleteShortcut(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const key = String(e.key || "").toLowerCase();
  if (key === "x") return !e.shiftKey;
  return key === "delete" || key === "backspace" || key === "del" || key === "x";
}

function hasDeletableObjectSelection() {
  return Boolean(objectTools.getSelection?.() || (selectedFile && projectAssembly.has(selectedFile)));
}

document.addEventListener("keydown", (e) => {
  if (architectSession?.isActive?.() && !isEditableShortcutTarget(e.target)) {
    if (architectSession.handleKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
  if (!isObjectDeleteShortcut(e) || isEditableShortcutTarget(e.target)) return;
  if (!hasDeletableObjectSelection()) return;
  e.preventDefault();
  e.stopPropagation();
  void deleteActiveAssemblyObject();
}, true);

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const key = String(e.key || "").toLowerCase();
  const inField = isEditableShortcutTarget(e.target);
  if (shouldUseNativeClipboardShortcut(e, key, mod)) return;
  if (workspaceModes?.isWiring?.() && !inField) {
    if (mod && key === "z" && !e.shiftKey) {
      e.preventDefault();
      wiringSim.undo();
      return;
    }
    if ((mod && key === "y") || (mod && key === "z" && e.shiftKey)) {
      e.preventDefault();
      wiringSim.redo();
      return;
    }
  }
  if (sketchEditor.isActive() && !inField) {
    if (mod && key === "z" && !e.shiftKey) {
      e.preventDefault();
      if (sketchEditor.undo()) setEditStatus("ok", "Sketch undo.");
      else setEditStatus("error", "Nothing to undo.");
      return;
    }
    if ((mod && key === "y") || (mod && key === "z" && e.shiftKey)) {
      e.preventDefault();
      if (sketchEditor.redo()) setEditStatus("ok", "Sketch redo.");
      else setEditStatus("error", "Nothing to redo.");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      finishActiveSketch();
      return;
    }
  if (e.key === "Escape") {
      e.preventDefault();
      sketchEditor.cancelCurrentAction?.();
      return;
    }
  }
  if (inField && e.key === "Escape") {
    e.preventDefault();
    e.target?.blur?.();
    focusViewportForShortcuts();
  } else if (inField) {
    return;
  }
  if (mod && key === "c") {
    if (selectedObjectFilename()) {
      e.preventDefault();
      copySelectedObjectToClipboard();
    }
    return;
  }
  if (mod && key === "v") {
    if (objectClipboard?.filename) {
      e.preventDefault();
      if (objectClipboard.projectId && objectClipboard.projectId !== projectId) {
        setEditStatus("error", "Copied object is from another project. Open that project to paste it.");
        return;
      }
      void duplicateSelectedObject(objectClipboard.filename);
    }
    return;
  }
  if (key === "tab") {
    e.preventDefault();
    if (getPickMode() === "object" && leftDragMode === "select") {
      activatePickMode("off");
      setLeftDragMode("rotate");
      setEditStatus("ok", "Orbit mode: left drag rotates the camera. Press Tab for Select/edit mode.");
    } else {
      setRightTab("tools");
      setLeftDragMode("select");
      activatePickMode("object");
      setEditStatus("ok", "Select/edit mode: click or drag a box around bodies, then Split bodies or Delete.");
    }
    return;
  }
  if (mod && key === "z" && !e.shiftKey) {
    e.preventDefault();
    if (undoViewportAction()) return;
    undoTimeline();
    return;
  }
  if ((mod && key === "y") || (mod && key === "z" && e.shiftKey)) {
    e.preventDefault();
    redoTimeline();
    return;
  }
  if (e.key === "w" || e.key === "W") document.getElementById("btn-wireframe")?.click();
  if (e.shiftKey && key === "x") {
    e.preventDefault();
    document.getElementById("btn-section")?.click();
    return;
  }
  if (e.shiftKey && (key === "g")) {
    e.preventDefault();
    toggleGrid();
  }
  if (key === "g" || key === "t") openTransformMode("translate");
  if (key === "r") openTransformMode("rotate");
  if (key === "s") openTransformMode("scale");
  if (isObjectDeleteShortcut(e)) {
    if (hasDeletableObjectSelection()) {
      e.preventDefault();
      void deleteActiveAssemblyObject();
      return;
    }
  }
  if (key === "p" || (key === "e" && !e.shiftKey)) {
    e.preventDefault();
    setRightTab("tools");
    launchViewportTool("presspull");
    return;
  }
  if (key === "v") activatePickMode("object");
  if (key === "m") {
    setRightTab("tools");
    directModeling.setTool("mirror");
  }
  if (key === "c") activatePickMode("corner");
  if (key === "f") {
    activatePickMode("face");
    editTools.updateExtrudeTarget?.();
  }
  if (e.shiftKey && key === "e") {
    e.preventDefault();
    activatePickMode("edge");
    return;
  }
  if (key === "l") activatePickMode("lasso");
  if (key === "n") activatePickMode("line");
  if (e.key === "Enter" && !inField && getPickMode() === "line" && hasLineDraft()) {
    e.preventDefault();
    finishActiveLinePath();
  }
  if (key === "h") {
    setRightTab("history");
    document.getElementById("btn-feature-collapse")?.click();
  }
  if (key === "u") {
    const unitSelect = document.getElementById("unit-select");
    if (unitSelect) {
      unitSelect.value = unitSelect.value === "in" ? "mm" : "in";
      unitSelect.dispatchEvent(new Event("change"));
    }
  }
  if (e.key === "Escape") {
    e.preventDefault();
    closeMarkingMenu();

    if (pendingSnapTarget) {
      clearSnapTarget();
      setEditStatus("", "");
      return;
    }

    // In line mode, Esc should complete the current path just like Enter.
    // Finished references stay until the user clicks their remove button or
    // selects them and presses Delete.
    if (getPickMode() === "line" && hasLineDraft()) {
      finishActiveLinePath();
      return;
    }

    cancelLasso();
    cancelLinePath();
    lassoPointerActive = false;
    clearHover();

    if (clearPickedFaceReferences()) {
      activatePickMode("off");
      controls.enabled = true;
      setEditStatus("", "");
      return;
    }

    // Cancel sketch face pick first
    if (sketchFacePickActive) {
      cancelSketchFacePick();
      return;
    }

    // Let sketch editor handle its own Escape (undo current action)
    if (sketchEditor.isActive()) {
      sketchEditor.cancelCurrentAction?.();
      return;
    }

    // Cancel any active direct-modeling tool (press-pull, mirror, fillet, chamfer)
    if (directModeling.isToolActive?.()) {
      directModeling.reset();
      // don't return — also clear selection/picks below
    }

    // Clear object selection and pick mode
    objectTools.clearSelection();
    activatePickMode("off");
    controls.enabled = true;
    transformControls.detach();
    gizmoPanel.hide();
    document.getElementById("btn-gizmo")?.classList.remove("active");
    document.querySelectorAll("[data-dm-tool]").forEach((btn) => btn.classList.remove("active"));

    setEditStatus("", "");
  }
});

(async function init() {
  initPromptKeyPopup();
  initPromptGenerationSpeed();
  initWiringGenerationSpeed();

  aiKeyUi = createAIKeyUI({
    api,
    getProjects: () => allProjects,
    getCurrentProjectId: () => projectId,
    onStatusChange: (status) => {
      renderAIStatus(status);
      void refreshWorkspaceAiUsage();
    },
  });

  renderAgentUi = createRenderAgent({
    api,
    getProjectId: () => projectId,
    getSelectedFile: () => selectedFile,
    getCurrentUser: () => currentUser,
    getTeams: () => allTeams,
    getSelectedWorkspaceId,
    getSelectedAiKey: getPromptAiKeyBodyFields,
    onRequireLogin: () => authUi?.openModal?.(),
    onStatus: (kind, message) => setEditStatus(kind, message),
  });

  const auth = createAuthUI({
    api,
    onUserMenuOpen: () => {
      void refreshWorkspaceAiUsage();
    },
    onReady: async (data) => {
      currentUser = data.user;
      renderAgentUi?.setUser?.(data.user);
      allTeams = data.teams || [];
      aiKeyUi.render(data.ai);
      connectUserRealtime();
      renderTeams();
      await startApp();
    },
  });
  authUi = auth;

  window.addEventListener("render3d:open-fusion-library", () => {
    const appEl = document.getElementById("app");
    if (appEl?.classList.contains("left-panel-hidden")) {
      appEl.classList.remove("left-panel-hidden");
      const reopen = document.getElementById("sidebar-reopen-tab");
      if (reopen) reopen.style.display = "none";
      try {
        localStorage.setItem("render3d:sidebarHidden", "0");
      } catch (_) {}
    }
    requestAnimationFrame(() => {
      document.getElementById("fusion-library-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Onshape Library panel — initialised once; auto-loads when scrolled into view
  initOnshapePanel({
    api,
    getCurrentProjectId: () => projectId,
    onImported: async (importedProjectId, filename, name) => {
      await loadProject(importedProjectId);
      await loadModel(`/api/projects/${importedProjectId}/files/${encodeURIComponent(filename)}`, filename, {
        projectId: importedProjectId,
        catalogFilename: filename,
        label: name,
      });
    },
    onView: async (viewProjectId, filename, name) => {
      await loadProject(viewProjectId);
      await loadModel(`/api/projects/${viewProjectId}/files/${encodeURIComponent(filename)}`, filename, {
        projectId: viewProjectId,
        catalogFilename: filename,
        label: name,
      });
    },
  });

  initFusionPanel({
    api,
    getCurrentProjectId: () => projectId,
    getCurrentProjectLabel: () => currentProjectLabel(),
    getSelectedFile: () => selectedFile,
    getWorkspaceId: () => getSelectedWorkspaceId(),
    onImported: async (importedProjectId, filename, name) => {
      await loadProject(importedProjectId);
      await loadModel(`/api/projects/${importedProjectId}/files/${encodeURIComponent(filename)}`, filename, {
        projectId: importedProjectId,
        catalogFilename: filename,
        label: name,
      });
    },
    onView: async (viewProjectId, filename, name) => {
      await loadProject(viewProjectId);
      await loadModel(`/api/projects/${viewProjectId}/files/${encodeURIComponent(filename)}`, filename, {
        projectId: viewProjectId,
        catalogFilename: filename,
        label: name,
      });
    },
    onOpenProject: async (openProjectId) => {
      await loadProject(openProjectId);
    },
    onStatus: (kind, message) => setEditStatus(kind, message),
    onMirrorLinked: () => void refreshWorkspaceRealtimeEditor(),
  });

  async function restoreSessionSnapshot() {
    const snap = readPendingRestore();
    if (!snap?.projectId) return false;
    clearPendingRestore();
    try {
      const sel = document.getElementById("team-select");
      if (snap.workspaceId && sel && [...sel.options].some((opt) => opt.value === snap.workspaceId)) {
        if (sel.value !== snap.workspaceId) {
          sel.value = snap.workspaceId;
          await onWorkspaceChange({ deferProjectPick: true });
        }
      }
      if (!allProjects.some((project) => project.id === snap.projectId)) {
        await fetchAllProjects();
      }
      if (!allProjects.some((project) => project.id === snap.projectId)) return false;
      if (projectId !== snap.projectId) {
        await loadProject(snap.projectId);
      }
      if (snap.selectedFile && projectId === snap.projectId && selectedFile !== snap.selectedFile) {
        const file = snap.selectedFile;
        if (isDxfDrawingFilename(file)) {
          await openDxfDrawingByName(file, { projectId });
        } else if (!isComponentHidden(file)) {
          await loadModel(projectFileUrl(projectId, file), file, {
            projectId,
            catalogFilename: file,
            fitView: false,
          });
          selectAssemblyComponent(file, { fitView: false });
        }
      }
      captureSessionSnapshot();
      return true;
    } catch (err) {
      console.warn("Session restore failed:", err);
      return false;
    }
  }

  async function startApp() {
    try {
      if (!aiStatus) {
        try {
          await aiKeyUi.refresh();
  } catch (err) {
    document.getElementById("prompt-status").className = "status error";
    document.getElementById("prompt-status").textContent = err.message;
  }
      }
      await onWorkspaceChange({ deferProjectPick: true });
      const restored = await restoreSessionSnapshot();
      if (!restored) await ensureProject();
      else captureSessionSnapshot();
      await resumeGenerationFromProjects();
      showAiComposePanel();
  activityLog.refreshServerDebounced();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelector(".sidebar.left .left-scroll")?.scrollTo?.({ top: 0, left: 0 });
  }));
    } catch (err) {
      console.error("startApp failed:", err);
      setEditStatus("error", err.message || "Failed to load workspace");
      renderProjectList();
    }
  }

  async function onWorkspaceChange({ deferProjectPick = false } = {}) {
    const rawId = document.getElementById("team-select")?.value || "";
    const id = getSelectedWorkspaceId();
    writeSavedWorkspaceId(rawId);
    updateWorkspaceRenameButton();
    await refreshTeamMembers();
    try {
      await fetchAllProjects();
    } catch {
      renderProjectList();
      return;
    }
    await refreshWorkspaceHistory();
    await refreshWorkspaceRealtimeEditor();
    await refreshWorkspaceAiUsage();
    renderProjectList();
    if (projectId && !allProjects.some((p) => p.id === projectId)) {
      const stillThere = await ensureActiveProjectListed(projectId);
      renderProjectList();
      if (stillThere) return;
    }
    if (projectId && allProjects.some((p) => p.id === projectId)) return;
    if (deferProjectPick) return;
    const last = localStorage.getItem(LS_LAST_PROJECT);
    if (last && allProjects.some((p) => p.id === last)) return;
    if (allProjects.length) {
      await loadProject(allProjects[0].id);
    } else if (projectId) {
      projectId = null;
      ribbon.setProjectId(null);
      setProjectHeader(null, null);
      clearModel();
      const list = document.getElementById("file-list");
      if (list) list.innerHTML = "";
    }
  }

  function getActiveTeam() {
    const teamId = document.getElementById("team-select")?.value || allTeams[0]?.id;
    return allTeams.find((t) => t.id === teamId) || null;
  }

  function hiddenWorkspaceIds() {
    try {
      return new Set(JSON.parse(localStorage.getItem(LS_HIDDEN_WORKSPACES) || "[]"));
    } catch {
      return new Set();
    }
  }

  function setWorkspaceVisible(teamId, visible) {
    const hidden = hiddenWorkspaceIds();
    if (visible) hidden.delete(teamId);
    else hidden.add(teamId);
    try {
      localStorage.setItem(LS_HIDDEN_WORKSPACES, JSON.stringify([...hidden]));
    } catch (_) {}
  }

  function visibleTeamsForExplorer() {
    const hidden = hiddenWorkspaceIds();
    const visible = allTeams.filter((t) => !hidden.has(t.id));
    return visible.length ? visible : allTeams;
  }

  function updateWorkspaceRenameButton() {
    const btn = document.getElementById("btn-rename-workspace");
    const team = getActiveTeam();
    if (!btn) return;
    const isOwner = team?.role === "owner";
    btn.hidden = !isOwner;
    btn.disabled = !isOwner;
  }

  function renderTeams() {
    const sel = document.getElementById("team-select");
    if (!sel) return;
    sel.innerHTML = "";
    const explorerTeams = visibleTeamsForExplorer();
    if (explorerTeams.length > 1) {
      const allOpt = document.createElement("option");
      allOpt.value = "__all__";
      allOpt.textContent = "All workspaces";
      sel.appendChild(allOpt);
    }
    explorerTeams.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    const saved = readSavedWorkspaceId();
    if (saved === "__all__" && explorerTeams.length > 1) {
      sel.value = "__all__";
    } else if (saved && explorerTeams.some((t) => t.id === saved)) {
      const savedTeam = explorerTeams.find((t) => t.id === saved);
      const hasUserScopedSave = hasUserScopedSavedWorkspace(saved);
      const savedIsOwned = savedTeam?.role === "owner";
      sel.value = hasUserScopedSave || savedIsOwned ? saved : defaultWorkspaceIdForUser(explorerTeams);
    } else if (explorerTeams.length) {
      sel.value = defaultWorkspaceIdForUser(explorerTeams);
    }
    sel.onchange = () => {
      onWorkspaceChange();
      updateWorkspaceRenameButton();
    };
    updateWorkspaceRenameButton();
    refreshTeamMembers();
    refreshTeamInvites();
  }

  function openWorkspaceRenameModal() {
    const team = getActiveTeam();
    if (!team || team.role !== "owner") return;
    const modal = document.getElementById("workspace-rename-modal");
    const input = document.getElementById("workspace-rename-input");
    const err = document.getElementById("workspace-rename-error");
    if (!modal || !input) return;
    input.value = team.name;
    err?.classList.add("hidden");
    if (err) err.textContent = "";
    modal.classList.remove("hidden");
    input.focus();
    input.select();
  }

  function closeWorkspaceRenameModal() {
    document.getElementById("workspace-rename-modal")?.classList.add("hidden");
  }

  document.getElementById("btn-rename-workspace")?.addEventListener("click", openWorkspaceRenameModal);
  document.querySelectorAll("[data-ws-rename-close]").forEach((el) => {
    el.addEventListener("click", closeWorkspaceRenameModal);
  });
  document.getElementById("btn-workspace-rename-save")?.addEventListener("click", async () => {
    const team = getActiveTeam();
    const input = document.getElementById("workspace-rename-input");
    const err = document.getElementById("workspace-rename-error");
    if (!team || !input) return;
    const name = input.value.trim();
    if (!name || name === team.name) {
      closeWorkspaceRenameModal();
      return;
    }
    err?.classList.add("hidden");
    try {
      const data = await api(`/api/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const updated = data.team;
      const idx = allTeams.findIndex((t) => t.id === team.id);
      if (idx >= 0 && updated) allTeams[idx] = { ...allTeams[idx], ...updated };
      renderTeams();
      const sel = document.getElementById("team-select");
      if (sel) sel.value = team.id;
      closeWorkspaceRenameModal();
    } catch (e) {
      if (err) {
        err.textContent = e.message || "Could not rename workspace";
        err.classList.remove("hidden");
      }
    }
  });
  document.getElementById("workspace-rename-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-workspace-rename-save")?.click();
  });

  function costText(value) {
    return formatCostUsd(Number(value) || 0) || "$0.00";
  }

  function renderCostBars(daily = []) {
    const recent = daily.slice(-30);
    const max = Math.max(0.000001, ...recent.map((d) => Number(d.total_usd) || 0));
    return `
      <div class="profile-costs-bars" aria-label="Daily AI costs">
        ${recent.map((d) => {
          const mine = Number(d.mine_usd) || 0;
          const shared = Number(d.shared_usd) || 0;
          const total = mine + shared;
          const height = Math.max(3, Math.round((total / max) * 54));
          const minePct = total > 0 ? Math.round((mine / total) * 100) : 0;
          const sharedPct = Math.max(0, 100 - minePct);
          return `
            <div class="profile-cost-bar" title="${appEscapeHtml(d.date)} · ${costText(total)}">
              <span style="height:${height}px">
                <i class="mine" style="height:${minePct}%"></i>
                <i class="shared" style="height:${sharedPct}%"></i>
              </span>
            </div>
          `;
        }).join("")}
      </div>
      <div class="profile-costs-legend">
        <span><i class="mine"></i> Mine</span>
        <span><i class="shared"></i> Shared</span>
      </div>
    `;
  }

  let costsAnalyticsModal = null;
  let costsAnalyticsState = {
    days: 30,
    filter: "all",
    chart: "stacked",
    metric: "cost",
    data: null,
    promptSort: { key: "cost", dir: "desc" },
    expandedProjects: new Set(),
  };

  function filteredCostDaily(data, filter) {
    const daily = data?.daily || [];
    if (filter === "mine") {
      return daily.map((d) => ({ ...d, shared_usd: 0, total_usd: Number(d.mine_usd) || 0 }));
    }
    if (filter === "shared") {
      return daily.map((d) => ({ ...d, mine_usd: 0, total_usd: Number(d.shared_usd) || 0 }));
    }
    if (filter?.startsWith("user:")) {
      const uid = filter.slice(5);
      const user = (data?.shared_users || []).find((u) => u.user_id === uid);
      const byDate = new Map((user?.daily || []).map((d) => [d.date, Number(d.cost_usd) || 0]));
      return daily.map((d) => {
        const shared = byDate.get(d.date) || 0;
        return { ...d, mine_usd: 0, shared_usd: shared, total_usd: shared };
      });
    }
    return daily;
  }

  function svgPointSeries(daily, width, height, pad) {
    const max = Math.max(0.000001, ...daily.map((d) => Number(d.total_usd) || 0));
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    return daily.map((d, i) => {
      const x = pad.left + (daily.length <= 1 ? innerW / 2 : (i / (daily.length - 1)) * innerW);
      const y = pad.top + innerH - ((Number(d.total_usd) || 0) / max) * innerH;
      return { ...d, x, y };
    });
  }

  function renderCostLineChart(data, filter = "all", { area = false } = {}) {
    const daily = filteredCostDaily(data, filter);
    const width = 1000;
    const height = 330;
    const pad = { left: 54, right: 22, top: 18, bottom: 52 };
    const pts = svgPointSeries(daily, width, height, pad);
    const max = Math.max(0.000001, ...daily.map((d) => Number(d.total_usd) || 0));
    const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const areaPath = pts.length
      ? `M ${pts[0].x.toFixed(1)} ${height - pad.bottom} L ${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")} L ${pts.at(-1).x.toFixed(1)} ${height - pad.bottom} Z`
      : "";
    const labelEvery = Math.max(1, Math.ceil(daily.length / 14));
    return `
      <div class="costs-modal-chart">
        <svg class="costs-modal-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${area ? "Area" : "Line"} chart of AI costs">
          ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = pad.top + (height - pad.top - pad.bottom) * t;
            const value = max * (1 - t);
            return `<line class="cost-grid-line ${t === 1 ? "" : "muted"}" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" /><text class="cost-axis-label" x="8" y="${y + 5}">${costText(value)}</text>`;
          }).join("")}
          ${area && areaPath ? `<path class="cost-area-fill" d="${areaPath}" />` : ""}
          <polyline class="cost-line-total" points="${line}" />
          ${pts.map((p, i) => i % labelEvery === 0 || i === pts.length - 1 ? `<text class="cost-date-label" x="${p.x}" y="${height - 16}" text-anchor="middle">${appEscapeHtml(String(p.date).slice(5))}</text>` : "").join("")}
          ${pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="var(--accent)" opacity="${Number(p.total_usd) > 0 ? "1" : "0.25"}"><title>${appEscapeHtml(p.date)} · ${costText(p.total_usd)}</title></circle>`).join("")}
        </svg>
      </div>
    `;
  }

  function renderCostUserBars(data) {
    const totals = data?.totals || {};
    const rows = [
      { label: "Mine", sub: "Your prompts", cost: Number(totals.mine_window_usd) || 0, kind: "mine" },
      ...(data?.shared_users || []).map((u) => ({
        label: u.display_name || u.email || "Team member",
        sub: `${u.email || ""}${u.tracked_count ? ` · ${u.tracked_count} tracked` : ""}`,
        cost: Number(u.window_cost_usd) || 0,
        kind: "shared",
      })),
    ].sort((a, b) => b.cost - a.cost);
    const max = Math.max(0.000001, ...rows.map((r) => r.cost));
    return `
      <div class="costs-modal-feature-bars" role="img" aria-label="AI cost by person">
        ${rows.map((row) => {
          const pct = Math.max(1, Math.round((row.cost / max) * 100));
          return `
            <div class="costs-feature-row" title="${appEscapeHtml(row.label)} · ${costText(row.cost)}">
              <span><strong>${appEscapeHtml(row.label)}</strong><small>${appEscapeHtml(row.sub || "")}</small></span>
              <div><i class="${row.kind}" style="width:${pct}%"></i></div>
              <strong>${costText(row.cost)}</strong>
            </div>
          `;
        }).join("") || `<p class="muted small">No cost data in this range.</p>`}
      </div>
    `;
  }

  function costMetricValue(row) {
    const metric = costsAnalyticsState.metric || "cost";
    if (metric === "tokens") return Number(row.total_tokens || 0);
    if (metric === "prompts") return Number(row.display_tracked_count ?? row.tracked_count ?? row.prompt_count ?? 0);
    if (metric === "calls") return Number(row.ai_calls || 0);
    return Number(row.display_cost_usd ?? row.window_cost_usd ?? row.cost ?? 0);
  }

  function costMetricText(row) {
    const metric = costsAnalyticsState.metric || "cost";
    const value = costMetricValue(row);
    if (metric === "tokens") return `${value.toLocaleString()} tokens`;
    if (metric === "prompts") return `${value.toLocaleString()} prompts`;
    if (metric === "calls") return `${value.toLocaleString()} calls`;
    return costText(value);
  }

  function fullCostAndTokenText(row, costKey = "display_cost_usd") {
    const cost = Number(row?.[costKey] ?? row?.window_cost_usd ?? row?.cost_usd ?? row?.cost ?? 0) || 0;
    const tokens = Number(row?.total_tokens || 0) || 0;
    return `${costText(cost)} · ${tokens.toLocaleString()} tokens`;
  }

  function effectiveTokenRateText(cost, tokens) {
    const c = Number(cost) || 0;
    const t = Number(tokens) || 0;
    if (!c || !t) return "";
    return `${costText((c / t) * 1_000_000)} / 1M tok`;
  }

  function projectModelBreakdownHtml(project) {
    const rows = project?.model_breakdown || [];
    if (!rows.length) return `<div class="costs-model-breakdown"><p class="muted small">No per-model breakdown available for this project yet.</p></div>`;
    return `
      <div class="costs-model-breakdown">
        ${rows.map((row) => {
          const cost = Number(row.window_cost_usd || row.total_cost_usd || 0) || 0;
          const tokens = Number(row.total_tokens || 0) || 0;
          const modelLabel = formatModelLabel(row.model, row.provider) || row.model || row.provider || "AI";
          const rate = effectiveTokenRateText(cost, tokens);
          return `
            <div class="costs-model-row">
              <span>
                <strong>${appEscapeHtml(modelLabel)}</strong>
                <small>${appEscapeHtml(row.provider || "AI")} · ${Number(row.prompt_count || 0)} prompts · ${Number(row.ai_calls || 0)} calls${rate ? ` · ${appEscapeHtml(rate)}` : ""}</small>
              </span>
              <span>${Number(row.input_tokens || 0).toLocaleString()} in · ${Number(row.output_tokens || 0).toLocaleString()} out</span>
              <strong>${costText(cost)} · ${tokens.toLocaleString()} tokens</strong>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function filteredCostProjects(data, filter = "all") {
    const projects = data?.projects || [];
    return projects.map((project) => {
      let cost = Number(project.window_cost_usd) || 0;
      let promptCount = Number(project.tracked_count || 0);
      if (filter === "mine") {
        cost = Number(project.mine_window_usd) || 0;
      } else if (filter === "shared") {
        cost = Number(project.shared_window_usd) || 0;
      } else if (filter?.startsWith("user:")) {
        const uid = filter.slice(5);
        const userRow = (project.users || []).find((u) => u.user_id === uid);
        cost = Number(userRow?.window_cost_usd) || 0;
        promptCount = Number(userRow?.tracked_count || 0);
      }
      return { ...project, display_cost_usd: cost, display_tracked_count: promptCount };
    }).filter((project) => project.display_cost_usd > 0 || project.display_tracked_count > 0)
      .sort((a, b) => b.display_cost_usd - a.display_cost_usd);
  }

  function filteredCostPrompts(data, filter = "all") {
    const currentUserId = data?.current_user_id;
    return (data?.recent_prompts || []).filter((prompt) => {
      if (filter === "mine") return prompt.user_id === currentUserId && prompt.key_source !== "team";
      if (filter === "shared") return prompt.user_id !== currentUserId || prompt.key_source === "team";
      if (filter?.startsWith("user:")) return prompt.user_id === filter.slice(5);
      return true;
    });
  }

  function promptSortValue(row, key) {
    if (key === "prompt") return row.prompt || "Untitled prompt";
    if (key === "project") return row.project_name || row.project_id || "";
    if (key === "model") return row.model || row.provider || "AI";
    if (key === "usage") return Number(row.total_tokens || 0);
    if (key === "cost") return Number(row.cost_usd || 0);
    return "";
  }

  function sortedCostPrompts(data, filter = "all") {
    const sort = costsAnalyticsState.promptSort || { key: "cost", dir: "desc" };
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filteredCostPrompts(data, filter)].sort((a, b) => {
      const av = promptSortValue(a, sort.key);
      const bv = promptSortValue(b, sort.key);
      if (typeof av === "number" || typeof bv === "number") {
        return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
      }
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  }

  function costPromptSortHeader(key, label) {
    const sort = costsAnalyticsState.promptSort || {};
    const active = sort.key === key;
    const isText = key === "prompt" || key === "project" || key === "model";
    const nextDir = active && sort.dir === "desc" ? "asc" : "desc";
    const hint = isText
      ? (active && sort.dir === "asc" ? "Z-A" : "A-Z")
      : (active && sort.dir === "asc" ? "Highest first" : "Lowest first");
    const arrow = active ? (sort.dir === "asc" ? "↑" : "↓") : "↕";
    return `
      <button type="button"
        class="costs-sort-btn${active ? " active" : ""}"
        data-action="cost-prompt-sort"
        data-sort-key="${appEscapeHtml(key)}"
        data-sort-dir="${appEscapeHtml(nextDir)}"
        title="Sort ${appEscapeHtml(label)} ${appEscapeHtml(hint)}">
        <span>${appEscapeHtml(label)}</span><i aria-hidden="true">${arrow}</i>
      </button>`;
  }

  function renderCostProjectBars(data, filter = "all") {
    const rows = filteredCostProjects(data, filter);
    const max = Math.max(0.000001, ...rows.map((r) => costMetricValue(r)));
    return `
      <div class="costs-modal-feature-bars" role="img" aria-label="AI cost by project">
        ${rows.map((row) => {
          const value = costMetricValue(row);
          const pct = Math.max(1, Math.round((value / max) * 100));
          const expanded = costsAnalyticsState.expandedProjects?.has?.(row.project_id);
          return `
            <div class="costs-project-group">
              <div class="costs-feature-row" title="${appEscapeHtml(row.name)} · ${appEscapeHtml(fullCostAndTokenText(row))}">
                <span><strong>${appEscapeHtml(row.name || row.project_id)}</strong><small>${Number(row.display_tracked_count || 0)} prompts · ${Number(row.total_tokens || 0).toLocaleString()} tokens</small></span>
                <div><i class="project" style="width:${pct}%"></i></div>
                <strong>${appEscapeHtml(fullCostAndTokenText(row))}<button type="button" data-action="cost-project-toggle" data-project-id="${appEscapeHtml(row.project_id)}">${expanded ? "Hide" : "View more"}</button></strong>
              </div>
              ${expanded ? projectModelBreakdownHtml(row) : ""}
            </div>
          `;
        }).join("") || `<p class="muted small">No project cost data in this range.</p>`}
      </div>
    `;
  }

  function renderCostPromptRows(data, filter = "all") {
    const rows = sortedCostPrompts(data, filter);
    return `
      <div class="costs-modal-table" role="table" aria-label="Recent AI prompts and usage">
        <div class="costs-table-head" role="row">
          ${costPromptSortHeader("prompt", "Prompt")}
          ${costPromptSortHeader("project", "Project")}
          ${costPromptSortHeader("model", "Model")}
          ${costPromptSortHeader("usage", "Usage")}
          ${costPromptSortHeader("cost", "Cost")}
        </div>
        ${rows.map((row) => `
          <div class="costs-table-row" role="row" title="${appEscapeHtml(row.prompt || "")}">
            <span>
              <strong>${appEscapeHtml((row.prompt || "Untitled prompt").slice(0, 92))}${(row.prompt || "").length > 92 ? "..." : ""}</strong>
              <small>${appEscapeHtml(row.user_name || "Unknown user")} · ${appEscapeHtml(row.created_at ? new Date(row.created_at).toLocaleString() : "")}</small>
            </span>
            <span>${appEscapeHtml(row.project_name || row.project_id || "")}</span>
            <span>${appEscapeHtml(row.model || row.provider || "AI")}</span>
            <span>${Number(row.total_tokens || 0).toLocaleString()} tokens${row.ai_calls ? ` · ${Number(row.ai_calls)} calls` : ""}</span>
            <strong>${costText(row.cost_usd)}</strong>
          </div>
        `).join("") || `<p class="muted small">No prompt usage in this range.</p>`}
      </div>
    `;
  }

  function renderLargeCostBars(data, filter = "all") {
    const daily = filteredCostDaily(data, filter);
    const max = Math.max(0.000001, ...daily.map((d) => Number(d.total_usd) || 0));
    return `
      <div class="costs-modal-chart">
        ${daily.map((d) => {
          const mine = Number(d.mine_usd) || 0;
          const shared = Number(d.shared_usd) || 0;
          const total = Number(d.total_usd) || mine + shared;
          const height = total > 0 ? Math.max(10, Math.round((total / max) * 320)) : 3;
          const minePct = total > 0 ? Math.round((mine / total) * 100) : 0;
          return `
            <div class="costs-modal-bar" title="${appEscapeHtml(d.date)} · ${costText(total)}">
              <span class="${total > 0 ? "" : "empty"}" style="height:${height}px">
                <i class="mine" style="height:${minePct}%"></i>
                <i class="shared" style="height:${Math.max(0, 100 - minePct)}%"></i>
              </span>
              <em>${appEscapeHtml(d.date.slice(5))}</em>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderSelectedCostChart(data, filter = "all") {
    const chart = costsAnalyticsState.chart || "stacked";
    if (chart === "line") return renderCostLineChart(data, filter);
    if (chart === "area") return renderCostLineChart(data, filter, { area: true });
    if (chart === "users") return renderCostUserBars(data);
    if (chart === "projects") return renderCostProjectBars(data, filter);
    if (chart === "prompts") return renderCostPromptRows(data, filter);
    return renderLargeCostBars(data, filter);
  }

  function applyCostChartPrompt(raw) {
    const text = String(raw || "").toLowerCase();
    if (!text.trim()) return;
    if (text.includes("project")) costsAnalyticsState.chart = "projects";
    else if (text.includes("prompt") || text.includes("usage")) costsAnalyticsState.chart = "prompts";
    else if (text.includes("person") || text.includes("people") || text.includes("user") || text.includes("individual")) costsAnalyticsState.chart = "users";
    else if (text.includes("line")) costsAnalyticsState.chart = "line";
    else if (text.includes("area")) costsAnalyticsState.chart = "area";
    else if (text.includes("bar")) costsAnalyticsState.chart = "stacked";
    if (text.includes("token")) costsAnalyticsState.metric = "tokens";
    else if (text.includes("call")) costsAnalyticsState.metric = "calls";
    else if (text.includes("prompt")) costsAnalyticsState.metric = "prompts";
    else if (text.includes("cost") || text.includes("spend") || text.includes("price")) costsAnalyticsState.metric = "cost";
    if (text.includes("mine") || text.includes("my ")) costsAnalyticsState.filter = "mine";
    else if (text.includes("shared") || text.includes("team")) costsAnalyticsState.filter = "shared";
    const dayMatch = text.match(/(\d+)\s*(day|days)/);
    if (dayMatch) costsAnalyticsState.days = Math.min(365, Math.max(7, Number(dayMatch[1]) || 30));
    renderCostsAnalyticsModal();
    if (dayMatch) refreshCostsAnalyticsModal();
  }

  function renderCostDetailSection(data, filter = "all") {
    const chart = costsAnalyticsState.chart || "stacked";
    if (chart === "projects") {
      const projects = filteredCostProjects(data, filter).slice(0, 12);
      return `
        <div class="costs-modal-users">
          <h3>Project comparison</h3>
          ${projects.map((project) => `
            <div class="profile-cost-user">
              <div>
                <strong>${appEscapeHtml(project.name || project.project_id)}</strong>
                <span class="muted small">${Number(project.prompt_count || 0)} prompts · ${Number(project.total_tokens || 0).toLocaleString()} tokens · ${Number(project.ai_calls || 0)} AI calls</span>
              </div>
              <div class="profile-cost-user-stats">
                <strong>${costText(project.display_cost_usd)}</strong>
                <span class="muted small">${costText(project.total_cost_usd)} all time</span>
              </div>
            </div>
            ${costsAnalyticsState.expandedProjects?.has?.(project.project_id) ? projectModelBreakdownHtml(project) : ""}
          `).join("") || `<p class="muted small">No projects with tracked cost in this range.</p>`}
        </div>
      `;
    }
    if (chart === "prompts") {
      const prompts = filteredCostPrompts(data, filter).slice(0, 8);
      return `
        <div class="costs-modal-users">
          <h3>Recent prompts</h3>
          ${prompts.map((prompt) => `
            <div class="profile-cost-user">
              <div>
                <strong>${appEscapeHtml((prompt.prompt || "Untitled prompt").slice(0, 110))}${(prompt.prompt || "").length > 110 ? "..." : ""}</strong>
                <span class="muted small">${appEscapeHtml(prompt.project_name || "")} · ${Number(prompt.total_tokens || 0).toLocaleString()} tokens · ${appEscapeHtml(prompt.model || prompt.provider || "AI")}</span>
              </div>
              <div class="profile-cost-user-stats">
                <strong>${costText(prompt.cost_usd)}</strong>
                <span class="muted small">${appEscapeHtml(prompt.created_at ? new Date(prompt.created_at).toLocaleDateString() : "")}</span>
              </div>
            </div>
          `).join("") || `<p class="muted small">No prompt usage in this range.</p>`}
        </div>
      `;
    }
    const sharedUsers = data.shared_users || [];
    return `
      <div class="costs-modal-users">
        <h3>Shared key users</h3>
        ${sharedUsers.length ? sharedUsers.map((u) => `
          <div class="profile-cost-user">
            <div>
              <strong>${appEscapeHtml(u.display_name || u.email || "Team member")}</strong>
              <span class="muted small">${appEscapeHtml(u.email || "")} · ${Number(u.tracked_count || 0)} tracked prompts</span>
            </div>
            <div class="profile-cost-user-stats">
              <strong>${costText(u.window_cost_usd)}</strong>
              <span class="muted small">${costText(u.total_cost_usd)} all time</span>
            </div>
          </div>
        `).join("") : `<p class="muted small">No shared-key users with access found.</p>`}
      </div>
    `;
  }

  function ensureCostsAnalyticsModal() {
    if (costsAnalyticsModal) return costsAnalyticsModal;
    costsAnalyticsModal = document.createElement("div");
    costsAnalyticsModal.className = "auth-modal hidden";
    costsAnalyticsModal.id = "costs-analytics-modal";
    costsAnalyticsModal.innerHTML = `
      <div class="auth-backdrop" data-costs-close></div>
      <div class="auth-card app-dialog-card costs-modal-card">
        <button type="button" class="auth-close" data-costs-close aria-label="Close">&times;</button>
        <div class="costs-modal-header">
          <div>
            <h2 class="app-dialog-title">AI cost analytics</h2>
            <p class="muted small">Filter spend by range, personal usage, shared usage, or a shared-key user.</p>
          </div>
          <div class="costs-modal-filters">
            <label>Range
              <select id="costs-range-filter">
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="60">Last 60 days</option>
                <option value="90">Last 90 days</option>
                <option value="180">Last 6 months</option>
                <option value="365">Last year</option>
              </select>
            </label>
            <label>View
              <select id="costs-user-filter">
                <option value="all">Mine + shared</option>
                <option value="mine">Mine only</option>
                <option value="shared">Shared only</option>
              </select>
            </label>
            <label>Chart
              <select id="costs-chart-filter">
                <option value="stacked">Stacked bars</option>
                <option value="line">Line</option>
                <option value="area">Area</option>
                <option value="users">By person</option>
                <option value="projects">By project</option>
                <option value="prompts">Recent prompts</option>
              </select>
            </label>
            <label>Metric
              <select id="costs-metric-filter">
                <option value="cost">Cost</option>
                <option value="tokens">Tokens</option>
                <option value="prompts">Prompts</option>
                <option value="calls">AI calls</option>
              </select>
            </label>
          </div>
        </div>
        <div class="costs-quickbar">
          <button type="button" data-cost-chart="projects" data-cost-metric="cost">Compare projects</button>
          <button type="button" data-cost-chart="projects" data-cost-metric="tokens">Project tokens</button>
          <button type="button" data-cost-chart="prompts" data-cost-metric="prompts">Prompt usage</button>
          <button type="button" data-cost-chart="users" data-cost-metric="cost">Compare users</button>
          <label>Prompt chart
            <input id="costs-chart-prompt" type="text" placeholder="e.g. compare project token usage last 90 days" />
          </label>
          <button type="button" id="costs-chart-prompt-run">Build</button>
        </div>
        <div id="costs-analytics-body" class="costs-modal-body">Loading costs...</div>
      </div>
    `;
    document.body.appendChild(costsAnalyticsModal);
    costsAnalyticsModal.querySelectorAll("[data-costs-close]").forEach((el) => {
      el.addEventListener("click", () => costsAnalyticsModal.classList.add("hidden"));
    });
    costsAnalyticsModal.querySelector("#costs-range-filter")?.addEventListener("change", async (e) => {
      costsAnalyticsState.days = Number(e.target.value) || 30;
      await refreshCostsAnalyticsModal();
    });
    costsAnalyticsModal.querySelector("#costs-user-filter")?.addEventListener("change", (e) => {
      costsAnalyticsState.filter = e.target.value;
      renderCostsAnalyticsModal();
    });
    costsAnalyticsModal.querySelector("#costs-chart-filter")?.addEventListener("change", (e) => {
      costsAnalyticsState.chart = e.target.value || "stacked";
      renderCostsAnalyticsModal();
    });
    costsAnalyticsModal.querySelector("#costs-metric-filter")?.addEventListener("change", (e) => {
      costsAnalyticsState.metric = e.target.value || "cost";
      renderCostsAnalyticsModal();
    });
    costsAnalyticsModal.querySelectorAll("[data-cost-chart]").forEach((btn) => {
      btn.addEventListener("click", () => {
        costsAnalyticsState.chart = btn.dataset.costChart || "stacked";
        costsAnalyticsState.metric = btn.dataset.costMetric || costsAnalyticsState.metric || "cost";
        renderCostsAnalyticsModal();
      });
    });
    costsAnalyticsModal.querySelector("#costs-chart-prompt-run")?.addEventListener("click", () => {
      applyCostChartPrompt(costsAnalyticsModal.querySelector("#costs-chart-prompt")?.value);
    });
    costsAnalyticsModal.querySelector("#costs-chart-prompt")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyCostChartPrompt(e.currentTarget.value);
    });
    costsAnalyticsModal.querySelector("#costs-analytics-body")?.addEventListener("click", (e) => {
      const projectToggle = e.target.closest("[data-action='cost-project-toggle']");
      if (projectToggle) {
        const id = projectToggle.dataset.projectId;
        if (id) {
          if (!costsAnalyticsState.expandedProjects) costsAnalyticsState.expandedProjects = new Set();
          if (costsAnalyticsState.expandedProjects.has(id)) costsAnalyticsState.expandedProjects.delete(id);
          else costsAnalyticsState.expandedProjects.add(id);
          costsAnalyticsState.chart = "projects";
          renderCostsAnalyticsModal();
        }
        return;
      }
      const sortBtn = e.target.closest("[data-action='cost-prompt-sort']");
      if (!sortBtn) return;
      costsAnalyticsState.promptSort = {
        key: sortBtn.dataset.sortKey || "cost",
        dir: sortBtn.dataset.sortDir || "desc",
      };
      costsAnalyticsState.chart = "prompts";
      renderCostsAnalyticsModal();
    });
    return costsAnalyticsModal;
  }

  function renderCostsAnalyticsModal() {
    const modal = ensureCostsAnalyticsModal();
    const body = modal.querySelector("#costs-analytics-body");
    const select = modal.querySelector("#costs-user-filter");
    const rangeSelect = modal.querySelector("#costs-range-filter");
    const chartSelect = modal.querySelector("#costs-chart-filter");
    const metricSelect = modal.querySelector("#costs-metric-filter");
    const data = costsAnalyticsState.data;
    if (!body || !data) return;
    const sharedUsers = data.shared_users || [];
    const current = costsAnalyticsState.filter || "all";
    const currentChart = costsAnalyticsState.chart || "stacked";
    if (rangeSelect) rangeSelect.value = String(costsAnalyticsState.days || data.days || 30);
    if (chartSelect) chartSelect.value = currentChart;
    if (metricSelect) metricSelect.value = costsAnalyticsState.metric || "cost";
    if (select) {
      select.innerHTML = `
        <option value="all">Mine + shared</option>
        <option value="mine">Mine only</option>
        <option value="shared">Shared only</option>
        ${sharedUsers.map((u) => `<option value="user:${appEscapeHtml(u.user_id)}">${appEscapeHtml(u.display_name || u.email || "Team member")}</option>`).join("")}
      `;
      select.value = current;
    }
    const totals = data.totals || {};
    body.innerHTML = `
      <div class="costs-modal-summary">
        <div><span>Total</span><strong>${costText(totals.all_window_usd)}</strong></div>
        <div><span>Mine</span><strong>${costText(totals.mine_window_usd)}</strong></div>
        <div><span>Shared</span><strong>${costText(totals.shared_window_usd)}</strong></div>
        <div><span>Tokens</span><strong>${compactTokenCount(totals.total_tokens)}</strong></div>
      </div>
      ${renderSelectedCostChart(data, current)}
      <div class="profile-costs-legend">
        <span><i class="mine"></i> Mine</span>
        <span><i class="shared"></i> Shared</span>
      </div>
      ${renderCostDetailSection(data, current)}
    `;
  }

  async function refreshCostsAnalyticsModal() {
    const modal = ensureCostsAnalyticsModal();
    const body = modal.querySelector("#costs-analytics-body");
    if (body) body.textContent = "Loading costs...";
    costsAnalyticsState.data = await api(`/api/user/ai-costs?days=${costsAnalyticsState.days}`);
    renderCostsAnalyticsModal();
  }

  async function openCostsAnalyticsModal() {
    ensureCostsAnalyticsModal().classList.remove("hidden");
    await refreshCostsAnalyticsModal();
  }

  function setProfileAvatarStatus(message, cls = "muted small") {
    const status = document.getElementById("profile-avatar-status");
    if (!status) return;
    status.className = `${cls} profile-preferences-note`;
    status.textContent = message || "";
  }

  function applyUpdatedUser(user) {
    if (!user) return;
    currentUser = user;
    authUi?.setUser?.(user);
    renderPreferencesMenuPanel();
  }

  async function uploadProfileAvatar(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg)$/i.test(file.type || "")) {
      setProfileAvatarStatus("Upload a PNG or JPEG image.", "status error");
      return;
    }
    if (file.size > 1_500_000) {
      setProfileAvatarStatus("Profile picture must be under 1.5 MB.", "status error");
      return;
    }
    setProfileAvatarStatus("Uploading profile picture...");
    const form = new FormData();
    form.append("file", file);
    try {
      let data;
      try {
        data = await api("/api/users/me/avatar", { method: "POST", body: form });
      } catch (err) {
        if (!/Method Not Allowed/i.test(err.message || "")) throw err;
        const retry = new FormData();
        retry.append("file", file);
        data = await api("/api/users/me/avatar", { method: "PUT", body: retry });
      }
      applyUpdatedUser(data.user);
      setProfileAvatarStatus("Profile picture updated.", "status ok");
    } catch (err) {
      setProfileAvatarStatus(err.message || "Could not upload profile picture.", "status error");
    }
  }

  async function removeProfileAvatar() {
    setProfileAvatarStatus("Removing profile picture...");
    try {
      const data = await api("/api/users/me/avatar", { method: "DELETE" });
      applyUpdatedUser(data.user);
      setProfileAvatarStatus("Profile picture removed.", "status ok");
    } catch (err) {
      setProfileAvatarStatus(err.message || "Could not remove profile picture.", "status error");
    }
  }

  async function refreshCostsMenuPanel() {
    const panel = document.getElementById("profile-costs-panel");
    if (!panel || panel.classList.contains("hidden")) return;
    panel.innerHTML = `<div class="profile-workspace-loading muted small">Loading costs…</div>`;
    try {
      const data = await api("/api/user/ai-costs?days=30");
      const totals = data.totals || {};
      const sharedUsers = data.shared_users || [];
      const topProjects = (data.projects || [])
        .filter((project) => Number(project.window_cost_usd || 0) > 0 || Number(project.total_tokens || 0) > 0)
        .slice(0, 5);
      panel.innerHTML = `
        <div class="profile-workspace-title">
          <strong>AI costs</strong>
          <span class="muted small">${appEscapeHtml(data.range?.start || "")} to ${appEscapeHtml(data.range?.end || "")}</span>
          <button type="button" class="btn secondary btn-compact profile-costs-expand" id="btn-costs-expand">View analytics</button>
        </div>
        <div class="profile-costs-grid">
          <div class="profile-cost-card">
            <span class="muted small">All time total</span>
            <strong>${costText(totals.all_total_usd)}</strong>
          </div>
          <div class="profile-cost-card">
            <span class="muted small">Last 30 days</span>
            <strong>${costText(totals.all_window_usd)}</strong>
          </div>
          <div class="profile-cost-card">
            <span class="muted small">Mine</span>
            <strong>${costText(totals.mine_window_usd)}</strong>
          </div>
          <div class="profile-cost-card">
            <span class="muted small">Shared</span>
            <strong>${costText(totals.shared_window_usd)}</strong>
          </div>
        </div>
        ${renderCostBars(data.daily || [])}
        <div class="profile-costs-section">
          <div class="profile-costs-section-title">
            <strong>Top projects</strong>
            <span class="muted small">Cost + tokens</span>
          </div>
          ${topProjects.length ? topProjects.map((project) => `
            <div class="profile-cost-user">
              <div>
                <strong>${appEscapeHtml(project.name || project.project_id)}</strong>
                <span class="muted small">${Number(project.tracked_count || 0)} prompts · ${Number(project.total_tokens || 0).toLocaleString()} tokens</span>
              </div>
              <div class="profile-cost-user-stats">
                <strong>${costText(project.window_cost_usd)}</strong>
                <span class="muted small">${costText(project.total_cost_usd)} all time</span>
              </div>
            </div>
          `).join("") : `<p class="muted small">No project cost data found yet.</p>`}
        </div>
        <div class="profile-costs-section">
          <div class="profile-costs-section-title">
            <strong>Shared key users</strong>
            <span class="muted small">${sharedUsers.length} user${sharedUsers.length === 1 ? "" : "s"}</span>
          </div>
          ${sharedUsers.length ? sharedUsers.map((u) => `
            <div class="profile-cost-user">
              <div>
                <strong>${appEscapeHtml(u.display_name || u.email || "Team member")}</strong>
                <span class="muted small">${appEscapeHtml(u.email || "")}</span>
              </div>
              <div class="profile-cost-user-stats">
                <strong>${costText(u.window_cost_usd)}</strong>
                <span class="muted small">${costText(u.total_cost_usd)} all time</span>
              </div>
            </div>
          `).join("") : `<p class="muted small">No shared-key usage found yet.</p>`}
        </div>
        <p class="muted small profile-costs-note">
          Estimates use tracked prompt token usage. Shared costs are attributed to users currently using your shared keys.
        </p>
      `;
      panel.querySelector("#btn-costs-expand")?.addEventListener("click", () => {
        void openCostsAnalyticsModal();
      });
    } catch (err) {
      panel.innerHTML = `<span class="ai-key-members-error">${appEscapeHtml(err.message || "Could not load costs")}</span>`;
    }
  }

  document.getElementById("btn-costs-menu")?.addEventListener("click", async () => {
    const panel = document.getElementById("profile-costs-panel");
    const workspacePanel = document.getElementById("profile-workspace-panel");
    const preferencesPanel = document.getElementById("profile-preferences-panel");
    if (!panel) return;
    workspacePanel?.classList.add("hidden");
    preferencesPanel?.classList.add("hidden");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      await refreshCostsMenuPanel();
    }
  });

  function renderPreferencesMenuPanel() {
    const panel = document.getElementById("profile-preferences-panel");
    if (!panel) return;
    const avatar = currentUser?.avatar_url || "";
    const initial = (currentUser?.display_name || currentUser?.email || "?").trim().charAt(0).toUpperCase();
    const mouseOptions = Object.entries(MOUSE_CONTROL_PRESETS)
      .map(([value, preset]) => `<option value="${appEscapeHtml(value)}">${appEscapeHtml(preset.label)}</option>`)
      .join("");
    const themeOptions = Object.entries(APP_THEMES)
      .map(([value, theme]) => `<option value="${appEscapeHtml(value)}">${appEscapeHtml(theme.label)}</option>`)
      .join("");
    panel.innerHTML = `
      <div class="profile-preferences-card" role="dialog" aria-modal="true" aria-labelledby="profile-preferences-title">
        <button type="button" class="profile-preferences-close" data-preferences-close aria-label="Close preferences">x</button>
        <div class="profile-preferences-header">
          <div>
            <span class="profile-preferences-kicker">Studio Settings</span>
            <h2 id="profile-preferences-title">Preferences</h2>
            <p class="muted small">General settings for the viewport, account, and controls.</p>
          </div>
        </div>
        <div class="profile-preferences-grid">
          <section class="profile-preferences-section profile-preferences-section--wide">
            <strong>Profile picture</strong>
            <div class="profile-avatar-preference">
              <span class="profile-avatar-preview ${avatar ? "profile-avatar-preview--image" : ""}" style="${avatar ? `background-image:url('${appEscapeHtml(avatar)}')` : ""}">${avatar ? "" : appEscapeHtml(initial)}</span>
              <div class="profile-avatar-actions">
                <label class="btn secondary btn-compact">
                  Upload picture
                  <input id="profile-avatar-input" type="file" accept="image/png,image/jpeg" hidden />
                </label>
                <button type="button" id="profile-avatar-remove" class="btn secondary btn-compact" ${avatar ? "" : "disabled"}>Remove</button>
                <small class="muted">PNG or JPEG, under 1.5 MB.</small>
              </div>
            </div>
            <p id="profile-avatar-status" class="muted small profile-preferences-note"></p>
          </section>
          <section class="profile-preferences-section">
            <strong>Controls</strong>
            <label class="profile-preference-field">
              <span>
                <b>Mouse controls</b>
                <small id="pref-mouse-preset-hint">${appEscapeHtml(MOUSE_CONTROL_PRESETS[mouseControlPreset]?.hint || "")}</small>
              </span>
              <select id="pref-mouse-preset">
                ${mouseOptions}
              </select>
            </label>
            <div class="mouse-preset-guide" aria-label="Mouse control preset details">
              ${Object.entries(MOUSE_CONTROL_PRESETS).map(([, preset]) => `
                <div>
                  <b>${appEscapeHtml(preset.label)}</b>
                  <span>${appEscapeHtml(preset.hint)}</span>
                </div>
              `).join("")}
            </div>
          </section>
          <section class="profile-preferences-section">
            <strong>General</strong>
            <label class="profile-preference-field">
              <span>
                <b>Appearance</b>
                <small>Switch the studio UI and viewport workspace between dark and light mode.</small>
              </span>
              <select id="pref-app-theme">
                ${themeOptions}
              </select>
            </label>
            <p class="muted small profile-preferences-note">
              Viewport lighting can be adjusted from the ribbon Light button and is remembered on this device.
            </p>
          </section>
        </div>
      </div>
    `;
    syncMousePreferenceUI();
    const themeSelect = panel.querySelector("#pref-app-theme");
    if (themeSelect) themeSelect.value = appTheme;
  }

  function closePreferencesModal() {
    document.getElementById("profile-preferences-panel")?.classList.add("hidden");
  }

  function openPreferencesModal() {
    const panel = document.getElementById("profile-preferences-panel");
    if (!panel) return;
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    document.getElementById("profile-costs-panel")?.classList.add("hidden");
    document.getElementById("profile-workspace-panel")?.classList.add("hidden");
    document.getElementById("user-menu")?.classList.add("hidden");
    renderPreferencesMenuPanel();
    panel.classList.remove("hidden");
    requestAnimationFrame(() => panel.querySelector("#pref-mouse-preset")?.focus?.({ preventScroll: true }));
  }

  document.getElementById("btn-preferences-menu")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openPreferencesModal();
  });

  document.getElementById("profile-preferences-panel")?.addEventListener("change", (e) => {
    const mouseSelect = e.target.closest("#pref-mouse-preset");
    if (mouseSelect) {
      setMouseControlPreset(mouseSelect.value, { announce: true });
      return;
    }
    const themeSelect = e.target.closest("#pref-app-theme");
    if (themeSelect) {
      setAppTheme(themeSelect.value, { persist: true, announce: true });
      return;
    }
    const avatarInput = e.target.closest("#profile-avatar-input");
    if (avatarInput?.files?.[0]) {
      void uploadProfileAvatar(avatarInput.files[0]);
    }
  });

  document.getElementById("profile-preferences-panel")?.addEventListener("click", (e) => {
    const panel = document.getElementById("profile-preferences-panel");
    if (e.target === panel || e.target.closest("[data-preferences-close]")) {
      closePreferencesModal();
      return;
    }
    if (!e.target.closest("#profile-avatar-remove")) return;
    void removeProfileAvatar();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("profile-preferences-panel")?.classList.contains("hidden")) {
      closePreferencesModal();
    }
  });

  async function refreshWorkspaceMenuPanel() {
    const panel = document.getElementById("profile-workspace-panel");
    if (!panel || panel.classList.contains("hidden")) return;
    const hidden = hiddenWorkspaceIds();
    const activeTeamId = document.getElementById("team-select")?.value;
    panel.innerHTML = `<div class="profile-workspace-loading muted small">Loading workspaces…</div>`;
    const parts = [];
    for (const team of allTeams) {
      let data = { members: [], invites: [] };
      let loadError = "";
      try {
        const membersRes = await api(`/api/teams/${team.id}/members`);
        data.members = membersRes.members || [];
      } catch (err) {
        loadError = err.message || "Could not load members.";
      }
      try {
        const management = await api(`/api/teams/${team.id}/management`);
        data = {
          ...management,
          // Use the dedicated members endpoint as source of truth. It is
          // simpler and should work for every team member, while management
          // can grow owner-only fields over time.
          members: data.members?.length ? data.members : (management.members || []),
        };
      } catch (err) {
        try {
          if (!data.members?.length) {
            const members = await api(`/api/teams/${team.id}/members`);
            data.members = members.members || [];
          }
        } catch (memberErr) {
          loadError = memberErr.message || err.message || "Could not load members.";
        }
      }
      const isOwner = team.role === "owner";
      const visible = !hidden.has(team.id);
      const memberRows = data.members || [];
      parts.push(`
        <section class="profile-workspace-card" data-team-id="${appEscapeHtml(team.id)}">
          <div class="profile-workspace-head">
            <div>
              <strong>${appEscapeHtml(team.name)}</strong>
              <span class="muted small">${appEscapeHtml(team.role || "member")}${team.id === activeTeamId ? " · current" : ""}</span>
            </div>
            <label class="profile-workspace-visible">
              <input type="checkbox" data-action="workspace-visible" data-team-id="${appEscapeHtml(team.id)}" ${visible ? "checked" : ""} />
              Explorer
            </label>
          </div>
          <div class="profile-workspace-actions">
            ${isOwner ? `
              <input type="text" value="${appEscapeHtml(team.name)}" data-workspace-name="${appEscapeHtml(team.id)}" maxlength="120" />
              <button type="button" class="btn btn-compact secondary" data-action="workspace-rename" data-team-id="${appEscapeHtml(team.id)}">Rename</button>
            ` : `
              <button type="button" class="btn btn-compact danger" data-action="workspace-leave" data-team-id="${appEscapeHtml(team.id)}">Leave team</button>
            `}
          </div>
          <div class="profile-workspace-invite">
            <input type="email" placeholder="Invite email" data-workspace-invite="${appEscapeHtml(team.id)}" />
            <button type="button" class="btn btn-compact secondary" data-action="workspace-invite" data-team-id="${appEscapeHtml(team.id)}">Invite</button>
          </div>
          <div class="profile-workspace-members">
            ${memberRows.map((m) => `
              <div class="profile-workspace-member">
                <span><strong>${appEscapeHtml(m.display_name || m.email)}</strong> <span class="muted">${appEscapeHtml(m.email || "")}</span></span>
                <small>${appEscapeHtml(m.role || "member")}</small>
              </div>
            `).join("") || `<p class="muted small">${loadError ? `Could not load members: ${appEscapeHtml(loadError)}` : "No members in this team yet."}</p>`}
          </div>
          ${(data.invites || []).length ? `
            <div class="profile-workspace-pending">
              <strong class="muted small">Pending invites</strong>
              ${(data.invites || []).map((inv) => `<div class="muted small">${appEscapeHtml(inv.email)}</div>`).join("")}
            </div>
          ` : ""}
        </section>
      `);
    }
    panel.innerHTML = `
      <div class="profile-workspace-title">
        <strong>Team workspaces</strong>
        <span class="muted small">Choose explorer visibility, invite, rename, or leave.</span>
      </div>
      ${parts.join("") || `<p class="muted small">No workspaces yet.</p>`}
    `;
  }

  document.getElementById("btn-workspace-menu")?.addEventListener("click", async () => {
    const panel = document.getElementById("profile-workspace-panel");
    const costsPanel = document.getElementById("profile-costs-panel");
    const preferencesPanel = document.getElementById("profile-preferences-panel");
    if (!panel) return;
    costsPanel?.classList.add("hidden");
    preferencesPanel?.classList.add("hidden");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      await refreshWorkspaceMenuPanel();
    }
  });

  document.getElementById("profile-workspace-panel")?.addEventListener("change", async (e) => {
    const visibleToggle = e.target.closest("[data-action='workspace-visible']");
    if (!visibleToggle) return;
    setWorkspaceVisible(visibleToggle.dataset.teamId, visibleToggle.checked);
    renderTeams();
    await onWorkspaceChange();
    await refreshWorkspaceMenuPanel();
  });

  document.getElementById("profile-workspace-panel")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const teamId = btn.dataset.teamId;
    if (!teamId || action === "workspace-visible") return;
    try {
      if (action === "workspace-rename") {
        const input = document.querySelector(`[data-workspace-name="${CSS.escape(teamId)}"]`);
        const name = input?.value?.trim();
        if (!name) return;
        const data = await api(`/api/teams/${teamId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const idx = allTeams.findIndex((t) => t.id === teamId);
        if (idx >= 0 && data.team) allTeams[idx] = { ...allTeams[idx], ...data.team };
        renderTeams();
        await refreshWorkspaceMenuPanel();
        return;
      }
      if (action === "workspace-invite") {
        const input = document.querySelector(`[data-workspace-invite="${CSS.escape(teamId)}"]`);
        const email = input?.value?.trim();
        if (!email) return;
        await api(`/api/teams/${teamId}/invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        input.value = "";
        await refreshWorkspaceMenuPanel();
        return;
      }
      if (action === "workspace-leave") {
        if (!confirm("Leave this workspace? It will disappear from your explorer.")) return;
        await api(`/api/teams/${teamId}/leave`, { method: "DELETE" });
        allTeams = allTeams.filter((t) => t.id !== teamId);
        renderTeams();
        await onWorkspaceChange();
        await refreshWorkspaceMenuPanel();
      }
    } catch (err) {
      alert(err.message || "Workspace action failed");
    }
  });

  async function refreshTeamInvites() {
    const container = document.getElementById("team-invites-alert");
    if (!container || !currentUser) return;
    try {
      const data = await api("/api/teams/invites/pending");
      const invites = data.invites || [];
      if (!invites.length) {
        container.classList.add("hidden");
        container.innerHTML = "";
        return;
      }
      container.classList.remove("hidden");
      container.innerHTML = invites
        .map(
          (inv) => `
        <div class="team-invite-banner" data-invite-id="${appEscapeHtml(inv.id)}">
          <p><strong>${appEscapeHtml(inv.inviter_name)}</strong> invited you to the workspace <strong>${appEscapeHtml(inv.team_name)}</strong>.</p>
          <div class="team-invite-actions">
            <button type="button" class="btn btn-compact team-invite-accept">Accept</button>
            <button type="button" class="btn secondary btn-compact team-invite-decline">Decline</button>
          </div>
        </div>`
        )
        .join("");
      container.querySelectorAll(".team-invite-accept").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.closest(".team-invite-banner")?.dataset.inviteId;
          if (!id) return;
          try {
            await api(`/api/teams/invites/${id}/accept`, { method: "POST" });
            const teamsData = await api("/api/teams");
            allTeams = teamsData.teams || [];
            renderTeams();
            await onWorkspaceChange();
          } catch (err) {
            alert(err.message || "Could not accept invite");
          }
        });
      });
      container.querySelectorAll(".team-invite-decline").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.closest(".team-invite-banner")?.dataset.inviteId;
          if (!id) return;
          try {
            await api(`/api/teams/invites/${id}/decline`, { method: "POST" });
            await refreshTeamInvites();
          } catch (err) {
            alert(err.message || "Could not decline invite");
          }
        });
      });
    } catch {
      container.classList.add("hidden");
      container.innerHTML = "";
    }
  }

  async function refreshTeamMembers() {
    const teamId = document.getElementById("team-select")?.value;
    const ul = document.getElementById("team-members");
    if (!teamId || !ul) return;
    try {
      const data = await api(`/api/teams/${teamId}/members`);
      const members = data.members || [];
      const count = members.length;
      ul.innerHTML = `
        <li class="team-members-dropdown">
          <details>
            <summary>
              <span>${count} member${count === 1 ? "" : "s"}</span>
              <small class="muted">Click to view</small>
            </summary>
            <div class="team-members-list">
              ${members.map((m) => `
                <div class="team-member-row">
                  <strong>${appEscapeHtml(m.display_name)}</strong>
                  <span class="muted">${appEscapeHtml(m.email)}</span>
                  <small>${appEscapeHtml(m.role || "member")}</small>
                </div>
              `).join("") || `<p class="muted small">No members yet.</p>`}
            </div>
          </details>
        </li>`;
    } catch {
      ul.innerHTML = "";
    }
  }

  refreshTeamInvitesRealtime = () => void refreshTeamInvites();
  refreshTeamMembersRealtime = () => void refreshTeamMembers();
  refreshWorkspacePanelRealtime = () => void refreshWorkspaceMenuPanel();

  document.getElementById("btn-create-workspace")?.addEventListener("click", async () => {
    const name = document.getElementById("workspace-name")?.value?.trim();
    const connectFusion = document.getElementById("workspace-connect-fusion")?.checked === true;
    const status = document.getElementById("workspace-create-status");
    if (!name) {
      if (status) status.textContent = "Enter a workspace name.";
      return;
    }
    try {
      const data = await api("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const team = data.team;
      if (team && !allTeams.some((t) => t.id === team.id)) {
        allTeams.push(team);
      } else if (team) {
        const idx = allTeams.findIndex((t) => t.id === team.id);
        if (idx >= 0) allTeams[idx] = team;
      }
      document.getElementById("workspace-name").value = "";
      if (status) status.textContent = `Created workspace "${team.name}"`;
      renderTeams();
      const sel = document.getElementById("team-select");
      if (sel && team) sel.value = team.id;
      await onWorkspaceChange();
      if (connectFusion && team?.id) {
        const saved = await api(`/api/teams/${encodeURIComponent(team.id)}/render-folder`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "fusion",
            label: "Fusion 360 workspace",
            folder_ref: "autodesk-user-cloud",
          }),
        });
        const idx = allTeams.findIndex((t) => t.id === team.id);
        if (idx >= 0 && saved.team) allTeams[idx] = { ...allTeams[idx], ...saved.team };
        if (status) status.textContent = `Created workspace "${team.name}" and connected Fusion.`;
        await refreshWorkspaceRealtimeEditor();
      }
    } catch (err) {
      if (status) status.textContent = err.message;
    }
  });

  document.getElementById("btn-team-invite")?.addEventListener("click", async () => {
    const teamId = document.getElementById("team-select")?.value;
    const email = document.getElementById("team-invite-email")?.value?.trim();
    const status = document.getElementById("team-invite-status");
    if (!teamId || !email) return;
    try {
      const res = await api(`/api/teams/${teamId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      status.textContent =
        res.status === "invited"
          ? `Invite sent to ${email}`
          : `${email} is already in this workspace`;
      document.getElementById("team-invite-email").value = "";
      await refreshTeamMembers();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  const session = await auth.bootstrap();
  initClientVersionWatcher({
    getSnapshot: () => ({
      projectId,
      selectedFile: selectedFile || null,
      workspaceId: document.getElementById("team-select")?.value || readSavedWorkspaceId() || null,
    }),
    onUpdating: () => {
      setEditStatus("ok", "New version available — reloading and restoring your project…");
    },
  });
  window.addEventListener("beforeunload", () => {
    captureSessionSnapshot();
  });
  if (session) {
    currentUser = session.user;
    renderAgentUi?.setUser?.(session.user);
    allTeams = session.teams || [];
    aiKeyUi.render(session.ai);
    connectUserRealtime();
    renderTeams();
    await startApp();
  } else {
    const browser = document.getElementById("project-browser");
    try {
      await fetchPublicProjectsForAnonymous();
      if (allProjects.length) {
        setEditStatus("ok", "Viewing public projects. Sign in to create or edit models.");
        await loadProject(allProjects[0].id);
      } else {
        setEditStatus("ok", "No public projects yet. Sign in to create one.");
      }
    } catch (err) {
      console.warn("Public project load failed", err);
      if (browser) {
        browser.innerHTML = '<p class="muted small browser-empty">Sign in to view your projects</p>';
      }
      auth.openModal?.();
    }
    document.getElementById("prompt-status").className = "status";
    document.getElementById("prompt-status").textContent = "Sign in to use AI prompting.";
  }
})().catch((err) => {
  console.error("Editor startup failed:", err);
  window.__appProjectListReady = true;
  const browser = document.getElementById("project-browser");
  if (browser) {
    browser.innerHTML = `<p class="status error browser-empty">Editor failed to start: ${appEscapeHtml(err?.message || "Unknown error")}</p>`;
  }
  setEditStatus?.("error", err?.message || "Editor failed to start");
});
