import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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
} from "./scene-style.js?v=20260617-creased-normals";
import { createEditTools } from "./edit-tools.js?v=20260611-sketch-extrude";
import { createTimelineUI } from "./timeline.js?v=20260618-restore-assembly";
import { createPromptComposer } from "./prompt-composer.js?v=20260618-multi-drag";
import { createPromptHistoryUI } from "./prompt-history.js?v=20260618-deterministic-cost";
import { formatPromptRef } from "./prompt-ref.js";
import { createSkillsPromptUI, fetchSkillsCatalog, getEnabledSkillsForPrompt, syncBlueprintVisionForImages, setSkillEnabled } from "./skills-library.js?v=20260706-restore";
import { createObjectHistoryUI } from "./object-history.js?v=20260618-restore-latest";
import { createWorkspaceActivityUI } from "./workspace-activity.js";
import { createWorkspaceBrowser } from "./workspace-browser.js?v=20260619-folder-icon";
import { readExplorerDragPayloads } from "./explorer-drag.js?v=20260618-multi-drag";
import { createActivityLog } from "./activity-log.js";
import { createAuthUI, authHeaders, getToken, getStoredUser } from "./auth.js";
import { initFusionPanel } from "./fusion-panel.js?v=20260706";
import { createAIKeyUI } from "./ai-key-ui.js?v=20260618-shared-key-dollar-limits";
import { createCollab } from "./collab.js?v=20260617-local-path-markers";
import { createRibbon } from "./ribbon.js?v=20260706-architect-ribbon";
import { initPanelResize } from "./panel-resize.js?v=20260611-timeline-restore";
import { createViewerOverlay } from "./viewer-overlay.js?v=20260618-v2-overlay";
import { createViewCube, VIEW_CUBE_WORLD_UP } from "./view-cube.js?v=20260611-viewcube-top";
import { openFileExportMenu, closeFileExportMenu } from "./file-actions.js?v=20260617-visible-assembly-export";
import { initOnshapePanel } from "./onshape-panel.js?v=20260617-onshape-filter";
import { formatLength, initUnitSwitcher, mmPerModelUnit } from "./units.js?v=20260610-direct";
import { createGizmoPanel } from "./gizmo-panel.js?v=20260618-transform-placement";
import { createDirectModeling } from "./direct-modeling.js?v=20260615-fillet-chamfer";
import { createMeshCleanup } from "./mesh-cleanup.js?v=20260611-mesh-checkup";
import { createObjectTools } from "./object-tools.js?v=20260617-marquee-bodies";
import { createFeatureEditor } from "./feature-editor.js?v=20260610-direct";
import { createProjectTree } from "./project-tree.js?v=20260618-hide-tags";
import { createProjectAssembly, filesToBrowserComponents } from "./project-assembly.js?v=20260618-explorer-ids";
import { createWorkspaceModes } from "./workspace-modes.js?v=20260619-canvas-tab";
import { createWiringSimulator } from "./wiring-simulator.js?v=20260619-wiring-viewport-fix";
import { createWiringDebugPanel } from "./wiring-photo-debug.js?v=20260619-debug-fix";
import { createCanvasMode } from "./canvas-mode.js?v=20260619-canvas-compose";
import { createWiringCodeUI } from "./wiring-code-ui.js?v=20260617-general-ide";
import { createDriverPicker } from "./driver-picker.js?v=20260617-driver-aware";
import { createComponentProfileUI } from "./component-profile.js?v=20260618-hide-tags";
import { createCatalogPanel } from "./catalog-panel.js?v=20260618-catalog-import-fallback";
import { createMiniViewer } from "./mini-viewer.js?v=20260617-visible-mini-viewer";
import { createSketchEditor } from "./sketch-editor.js?v=20260615-load-entities";
import { computeFacePlaneRef } from "./sketch-plane.js";
import { createRiggingEditor } from "./rigging-editor.js?v=20260612-spin-fix3";
import { createSectionView } from "./section-view.js?v=20260618-section-clean";
import { createViewerToast, flashViewport } from "./viewer-toast.js";
import { initMobileUI } from "./mobile-ui.js";
import { createExtrudeDragTool } from "./extrude-drag.js";
import { detectModelUnitScale } from "./measure.js";

const API = "";
const PROMPT_TIMEOUT_MS = 480000;
const LS_LAST_PROJECT = "render3d:lastProjectId";
const LS_LAST_WORKSPACE = "render3d:lastWorkspaceId";
const LS_MODEL_PROMPT_STATE = "render3d:modelPromptState:v1";
const LS_COMPOSE_DRAFT = "render3d:aiComposeDraft:v1";
const LS_PROMPT_AI_KEY = "render3d:promptAiKey:v1";
const LS_HIDDEN_WORKSPACES = "render3d:hiddenWorkspaces:v1";

let projectId = null;
let allProjects = [];
let projectsFetchGeneration = 0;
let allTeams = [];
let currentUser = null;
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
let userRealtimeSocket = null;
let userRealtimeReconnectTimer = null;
let refreshTeamInvitesRealtime = () => {};
let refreshTeamMembersRealtime = () => {};
let refreshWorkspacePanelRealtime = () => {};

function syncViewportGenerationOverlay(completeOpts = {}) {
  const overlayPid = generationWatchPid || viewportOverlayPid;
  const activeOverlay = generationWatchOverlay?.kind === "wiring" ? (wiringOverlay || viewerOverlay) : viewerOverlay;
  const inactiveOverlay = activeOverlay === viewerOverlay ? wiringOverlay : viewerOverlay;
  if (overlayPid && overlayPid === projectId) {
    if (generationWatchPid === projectId && generationWatchOverlay) {
      activeOverlay.setGenerating(true, generationWatchOverlay.message, generationWatchOverlay);
      inactiveOverlay?.setGenerating(false);
    } else if (viewportOverlayPid === projectId && viewportOverlayState) {
      viewerOverlay.setGenerating(true, viewportOverlayState.message, viewportOverlayState);
      wiringOverlay?.setGenerating(false);
    }
    return;
  }
  viewerOverlay.setGenerating(false, null, { complete: completeOpts.complete ?? false });
  wiringOverlay?.setGenerating(false, null, { complete: completeOpts.complete ?? false });
  syncStopButtonVisibility();
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
    saveActiveModelPromptState();
    selectedFile = gen.filename;
    await refreshFiles();
    const placedFiles = (gen.placed_parts || []).map((part) => part.filename).filter(Boolean);
    await reloadViewportFromProject({ fitView: true, latestFile: gen.filename, placedFiles });
    viewerOverlay.clearError();
    await refreshTimeline();
    await refreshPromptHistory();
    showAiComposePanel();
    clearPromptComposeResult();
  }
  markGenerationApplied(pid, gen.trace_id);
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
      const isV2 = (generationWatchOverlay?.promptMode || "").toLowerCase() === "v2";
      const statusEl = document.getElementById(isWiring ? "wiring-prompt-status" : "prompt-status");
      if (statusEl) {
        statusEl.className = "status";
        statusEl.textContent = isWiring
          ? "Stopping… (finishes current AI call, then cancels schematic save)"
          : isV2
            ? "Stopping 2.0… (finishes current AI call, then cancels build)"
            : "Stopping… (finishes current AI call, then cancels build)";
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
          mode: gen.mode || generationWatchOverlay?.promptMode || "standard",
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
  if (normalized === "v2") {
    return {
      message: "Generating with 2.0 in background… refresh anytime; model loads when ready.",
      mode: "ai",
      estimateMs: 900000,
    };
  }
  if (normalized === "fusion") {
    return {
      message: "Generating + pushing to Fusion 360… (runs in background — safe to refresh)",
      mode: "ai",
      estimateMs: 900000,
    };
  }
  if (normalized === "architect") {
    return {
      message: "Generating Architect layout in background… safe to refresh.",
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

function fusionTargetLabel() {
  const target = document.getElementById("prompt-target")?.value || "design";
  if (target === "fusion360") return "Fusion 360";
  if (target === "edit") return "Edit selected";
  return "Add new object";
}

function applyPromptModeUI(mode = promptMode) {
  promptMode = mode || "render";
  document.querySelectorAll("[data-prompt-mode]").forEach((b) => {
    b.classList.toggle("active", (b.dataset.promptMode || "render") === promptMode);
  });
  const promptBtn = document.getElementById("btn-prompt");
  if (promptBtn) {
    if (promptMode === "draw") promptBtn.textContent = "Apply Draw command";
    else if (promptMode === "architect") promptBtn.textContent = "Generate architect layout";
    else if (promptMode === "fusion") promptBtn.textContent = "Generate + Push to Fusion 360";
    else if (promptMode === "v2") promptBtn.textContent = "Generate with 2.0";
    else promptBtn.textContent = "Generate / modify with AI";
  }
  const hint = document.getElementById("prompt-mode-hint");
  if (hint) {
    if (promptMode === "draw") {
      hint.textContent = "Draw uses local modeling tools: pick a face for holes, or draw a Line path and ask for ducts/wire loops.";
    } else if (promptMode === "v2") {
      hint.textContent = "2.0 runs the full quality pipeline: brief → plan → build → inspect → repair. Slower but significantly better geometry.";
    } else if (promptMode === "fusion") {
      hint.textContent = "Fusion mode generates parametric CAD then pushes the STEP file directly to your linked Fusion 360 hub.";
    } else if (promptMode === "architect") {
      hint.textContent = "Architect mode builds modular rooms, walls, roofs, and site layouts on a snap grid.";
    } else {
      hint.textContent = "Render creates or regenerates CAD with AI.";
    }
  }
  document.getElementById("prompt-advanced-row")?.classList.toggle(
    "visible",
    promptMode === "v2" || promptMode === "fusion" || promptMode === "render"
  );
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
  if (kind === "wiring") {
    generationWatchOverlay = {
      kind,
      promptMode: "wiring",
      pendingStart: !!pendingStart,
      message: "Generating wiring schematic… (safe to refresh)",
      mode: "ai",
      estimateMs: 120000,
    };
  } else if (kind === "build") {
    generationWatchOverlay = {
      kind,
      promptMode: "build",
      pendingStart: !!pendingStart,
      message: "Building in background… (safe to refresh)",
      mode: "build",
      estimateMs: 90000,
    };
  } else {
    generationWatchOverlay = {
      kind,
      promptMode: mode,
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
        (mode || "standard").toLowerCase() === "v2"
          ? "Generating with 2.0 in background… refresh anytime; model loads when ready."
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
        if (generationWatchOverlay) generationWatchOverlay.pendingStart = false;
        syncExplorerLoadingUI();
        syncStopButtonVisibility();
        return;
      }
      if (gen.status === "idle" && generationWatchOverlay?.pendingStart) {
        syncStopButtonVisibility();
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
            await refreshFiles();
            await refreshWiringPromptHistory();
          }
        } else if (!wasGenerationApplied(pid, gen.trace_id)) {
          await applyGenerationComplete(gen, pid);
        } else if (pid === projectId) {
          await refreshFiles();
          await refreshTimeline();
          await refreshPromptHistory();
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
}

async function resumeGenerationIfNeeded(pid, generation) {
  if (!pid || !generation || generation.status === "idle") {
    if (pid === projectId) syncStopButtonVisibility();
    return;
  }
  if (generation.status === "running") {
    beginGenerationWatch(pid, {
      kind: generation.kind || "prompt",
      mode: generation.mode || "standard",
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

const viewportHint = document.getElementById("viewport-hint");
const pickHintTitle = document.getElementById("pick-hint-title");
const pickHintText = document.getElementById("pick-hint-text");

const viewport = document.getElementById("viewport");
if (!viewport) {
  throw new Error("Render3D: #viewport element missing from page");
}
const viewerToast = createViewerToast(viewport);

function inferMeshUsesMm() {
  if (!currentMesh) return true;
  const box = new THREE.Box3().setFromObject(currentMesh);
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z) >= 1.0;
}

function viewerToastForCollab(msg) {
  const action = msg.action;
  const by = msg.by;
  if (!action || !by) return;
  const verbs = {
    extrude: "extruded",
    transform: "edited",
    upload: "uploaded",
    prompt: "updated",
    build: "built",
  };
  const verb = verbs[action] || action;
  viewerToast.show(`${by} ${verb} the model`, { kind: "info", durationMs: 2800 });
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(FUSION.canvas);

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 20000);
camera.up.copy(VIEW_CUBE_WORLD_UP);
// Start far enough back so the viewport isn't zoomed into the origin
// before the first model loads and triggers fitCamera.
camera.position.set(6, -6, 4.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
setupRenderer(renderer);
renderer.domElement.tabIndex = 0;  // allow canvas to receive keyboard focus
renderer.domElement.style.outline = "none";
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
setupSceneLighting(scene);
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
controls.maxDistance  = 5000;

const LEFT_DRAG_MODE_KEY = "render3d:left-drag-mode:v1";
const MOBILE_INTERACTION_QUERY = window.matchMedia?.("(max-width: 820px), (pointer: coarse) and (max-width: 1024px)");
function isMobileInteraction() {
  return Boolean(MOBILE_INTERACTION_QUERY?.matches);
}
let leftDragMode = (() => {
  if (isMobileInteraction()) return "rotate";
  try {
    return localStorage.getItem(LEFT_DRAG_MODE_KEY) === "rotate" ? "rotate" : "select";
  } catch {
    return "select";
  }
})();

function applyLeftDragMouseButtons() {
  if (!controls?.mouseButtons) return;
  const effectiveMode = isMobileInteraction() ? "rotate" : leftDragMode;
  if (effectiveMode === "select") {
    controls.mouseButtons.LEFT = -1; // left drag belongs to selection/marquee
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  } else {
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  }
}
applyLeftDragMouseButtons();

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
  let components = browser.components || [];
  if (!components.length && data?.files?.length) {
    components = filesToBrowserComponents(data.files);
  }
  return {
    components,
    sketches: browser.sketches || [],
    wiring: browser.wiring || [],
  };
}

let mobileBrowserComponents = [];

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
      const label = entry.stem || entry.name || "Model";
      const format = String(entry.format || entry.name?.split(".").pop() || "model").toUpperCase();
      return `<button type="button" class="mobile-model-item ${active ? "active" : ""}" data-mobile-model="${escapeHtml(entry.name)}">
        <span><strong>${escapeHtml(label)}</strong><span>${escapeHtml(entry.name || "")}</span></span>
        <em class="mobile-model-format">${escapeHtml(format)}</em>
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
  const mesh = comp || hitMesh;
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
  projectTree.setSelected(catalogName);
  featureEditor.setModel(projectId, catalogName);
  objectTools.selectObject?.({ mesh: obj, root: obj, bodyIndex: 0, catalogName });
  if (autoGizmo) {
    showObjectGizmo(obj, "translate", { switchTab: false });
  }
  if (fitView) fitCameraToComponent(catalogName);
  syncExportButton();
}

function selectObjectHit(hit, { showGizmo = true } = {}) {
  if (!hit?.mesh) return null;
  const target = selectionTargetFromMesh(hit.mesh);
  if (target.catalogName) {
    selectedFile = target.catalogName;
    projectTree.setSelected(target.catalogName);
    featureEditor.setModel(projectId, target.catalogName);
  }
  objectTools.selectObject({ ...target, faceIndex: hit.faceIndex });
  if (showGizmo) showObjectGizmo(target.mesh, "translate", { switchTab: false });
  renderer.domElement.focus({ preventScroll: true });
  syncExportButton();
  return target;
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
  transformControls.attach(target);
  transformControls.setMode(mode);
  controls.enabled = leftDragMode === "rotate";
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
transformControls.addEventListener("dragging-changed", (e) => {
  controls.enabled = !e.value;
});
// Add only the gizmo helper — adding TransformControls itself to the scene causes runaway rotation
scene.add(transformControls.getHelper());

const extrudeDragTool = createExtrudeDragTool({
  scene,
  camera,
  domElement: renderer.domElement,
  getMeshRoot: () => currentMesh,
  getMeshCenterOffset: () => meshCenterOffset,
  getUnitScale: () => detectModelUnitScale(currentMesh),
  api,
  onApplied: () => {
    viewport.classList.remove("extrude-drag-mode");
    controls.enabled = true;
  },
  onStatus: (msg) => viewerToast?.show(msg, { kind: "info" }),
});

let gridVisible = true;
let gridHelper = null;
const SKETCH_CANVAS = 0xe8e8e8;
let savedSceneBg = null;
let gridAxesGroup = null;
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

function rebuildGrid() {
  if (gridHelper) {
    scene.remove(gridHelper);
    disposeSceneObject(gridHelper);
  }
  if (gridAxesGroup) {
    scene.remove(gridAxesGroup);
    disposeSceneObject(gridAxesGroup);
  }
  if (axesHelper) {
    scene.remove(axesHelper);
    disposeSceneObject(axesHelper);
  }

  const size = niceGridSize(sceneRadius());
  const divisions = Math.min(240, Math.max(80, Math.round(size / (size >= 100 ? 5 : 0.25))));
  gridHelper = new THREE.GridHelper(size, divisions, FUSION.gridMajor, FUSION.gridMinor);
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

  axesHelper = new THREE.AxesHelper(Math.max(size * 0.035, 1));
  axesHelper.visible = gridVisible;
  scene.add(axesHelper);
}

function setGridVisible(visible) {
  gridVisible = visible;
  if (gridHelper) gridHelper.visible = visible;
  if (gridAxesGroup) gridAxesGroup.visible = visible;
  if (axesHelper) axesHelper.visible = visible;
  syncGridToggleButtons();
}

function syncGridToggleButtons() {
  for (const id of ["btn-grid", "btn-grid-viewport", "btn-grid-sidebar"]) {
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
    collab?.sendPicks(refs);
    meshCleanup?.refresh?.();
  },
});

function isExplorerPromptRef(ref) {
  return ref?.type === "component" || ref?.type === "sketch" || ref?.type === "wiring";
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
  const modelRefs = modelState?.references || [];
  const projectRefs = projectState?.references || [];
  const globalRefs = globalState?.references || [];
  const explorerRefs = dedupeRefsById([
    ...projectRefs.filter(isExplorerPromptRef),
    ...globalRefs.filter(isExplorerPromptRef),
    ...modelRefs.filter(isExplorerPromptRef),
  ]);
  const geometryRefs = dedupeRefsById([
    ...modelRefs.filter((ref) => !isExplorerPromptRef(ref)),
    ...projectRefs.filter((ref) => !isExplorerPromptRef(ref)),
  ]);
  const references = dedupeRefsById([...explorerRefs, ...geometryRefs]);
  const candidates = [modelState, projectState, globalState].filter(Boolean);
  candidates.sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
  const newest = candidates[0] || null;
  return {
    prompt: newest?.prompt || "",
    references,
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
  collab?.sendPicks(composer.getReferences());
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

function renderPromptImages() {
  if (!promptImageList) return;
  promptImageList.innerHTML = promptImages
    .map(
      (img) => `<div class="prompt-image-card" data-id="${img.id}">
        <img src="${img.data_url}" alt="${escapeHtml(img.name)}" />
        <button type="button" class="prompt-image-remove" title="Remove image">×</button>
        <span>${escapeHtml(img.name)}</span>
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
  }
  renderPromptImages();
  if (!restoringModelPromptState) saveActiveModelPromptState();
}

promptImageDrop?.addEventListener("click", () => promptImageInput?.click());
promptImageDrop?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") promptImageInput?.click();
});
promptImageInput?.addEventListener("change", async (e) => {
  await addPromptImages(e.target.files || []);
  e.target.value = "";
});

function droppedImageFiles(e) {
  return [...(e.dataTransfer?.files || [])].filter((file) => file.type?.startsWith("image/"));
}

function droppedDxfFiles(e) {
  return [...(e.dataTransfer?.files || [])].filter(
    (file) => /\.dxf$/i.test(file.name) || file.type === "application/dxf" || file.type === "image/vnd.dxf"
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
  for (const file of [...files]) {
    if (file.size > 8 * 1024 * 1024) {
      viewerOverlay?.showError?.(`${file.name} is too large for a DXF reference (max 8 MB).`);
      continue;
    }
    const text = await file.text();
    const stem = file.name.replace(/\.dxf$/i, "");
    const id = `dxf:${stem}:${Date.now()}`;
    const token = `@${stem.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "dxf"}`;
    const truncated = text.length > MAX_DXF_CHARS;
    composer.addReference({
      id,
      type: "dxf",
      token,
      label: file.name,
      filename: file.name,
      stem,
      format: "dxf",
      text_content: truncated ? text.slice(0, MAX_DXF_CHARS) : text,
      text_truncated: truncated,
    });
  }
  if (!restoringModelPromptState) saveActiveModelPromptState();
}

function handlePromptComposeDragover(e) {
  if (!isPromptImageDrag(e) && !isExplorerComponentDrag(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  promptImageDrop?.classList.add("dragging");
}

function handlePromptComposeDragleave(e) {
  if (!promptPaneCompose?.contains(e.relatedTarget)) {
    promptImageDrop?.classList.remove("dragging");
  }
}

async function handlePromptComposeDrop(e) {
  const componentRefs = droppedExplorerRefs(e);
  if (componentRefs.length) {
    e.preventDefault();
    e.stopPropagation();
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
  const files = droppedImageFiles(e);
  if (!files.length) return;
  if (e.target instanceof Element && e.target.closest("#prompt-image-drop")) return;
  e.preventDefault();
  e.stopPropagation();
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
  e.preventDefault();
  e.stopPropagation();
  promptImageDrop.classList.remove("dragging");
  await addPromptImages(e.dataTransfer?.files || []);
});

promptPaneCompose?.addEventListener("dragover", handlePromptComposeDragover);
promptPaneCompose?.addEventListener("dragleave", handlePromptComposeDragleave);
promptPaneCompose?.addEventListener("drop", handlePromptComposeDrop);
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

function scheduleUserRealtimeReconnect() {
  if (userRealtimeReconnectTimer || !getToken()) return;
  userRealtimeReconnectTimer = setTimeout(() => {
    userRealtimeReconnectTimer = null;
    connectUserRealtime();
  }, 2500);
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
    const ta = document.getElementById("prompt-input");
    if (ta) {
      ta.value = entry.prompt;
      ta.focus();
      saveActiveModelPromptState();
    }
  },
});

let promptMode = "render";

function promptModeForRef(mode = promptMode) {
  const normalized = (mode || "render").toLowerCase();
  if (normalized === "v2") return "v2";
  if (normalized === "draw") return "draw";
  if (normalized === "fusion") return "fusion";
  if (normalized === "architect") return "architect";
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
  btn.addEventListener("click", () => {
    applyPromptModeUI(btn.dataset.promptMode || "render");
  });
});
document.getElementById("prompt-target")?.addEventListener("change", () => applyPromptModeUI(promptMode));
document.getElementById("prompt-speed")?.addEventListener("change", () => applyPromptModeUI(promptMode));
applyPromptModeUI("render");

document.getElementById("btn-architect-prompt")?.addEventListener("click", async () => {
  const prompt = document.getElementById("architect-prompt-input")?.value?.trim();
  const status = document.getElementById("architect-prompt-status");
  if (!prompt) {
    if (status) {
      status.className = "status error";
      status.textContent = "Describe the building or layout you want.";
    }
    return;
  }
  applyPromptModeUI("architect");
  composer.setPromptText(`${architectPromptPrefix()}\n\n${prompt}`);
  setSkillEnabled("cad", true);
  setSkillEnabled("architect", true);
  skillsPromptUI.render();
  showAiComposePanel();
  if (status) {
    status.className = "status loading";
    status.textContent = "Starting architect generation…";
  }
  document.getElementById("btn-prompt")?.click();
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
});
fetchSkillsCatalog((path) => fetch(path)).then(() => skillsPromptUI.render());
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
    const ok = await loadModel(`/api/projects/${projectId}/files/${encodeURIComponent(viewer)}`, viewer, {
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
  await refreshTimeline();
  await refreshPromptHistory();
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
  savedSceneBg = scene.background?.getHex?.() ?? FUSION.canvas;
  scene.background.setHex(SKETCH_CANVAS);
  if (gridHelper) gridHelper.visible = false;
  ribbon?.setSketchEditing?.(true);
  document.querySelector(".sketch-mode-tab")?.classList.remove("hidden");
  setRightTab("sketch");
}

function exitSketchVisualMode() {
  scene.background.setHex(savedSceneBg ?? FUSION.canvas);
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
    if (bound >= 2) {
      setEditStatus("ok", `Rigging ready — ${bound} parts bound for animation. Press Play.`);
    } else if (selectedFile) {
      setEditStatus("error", "Open the gear model on SOLID first, then return to RIGGING and press Play.");
    }
    syncRiggingToolbelt();
  })();
}

function exitRiggingMode() {
  document.getElementById("rigging-chrome")?.classList.add("hidden");
  riggingEditor.hide();
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
  window.dispatchEvent(new Event("resize"));
}

function exitCanvasTab() {
  document.getElementById("canvas-workspace")?.classList.add("hidden");
  document.getElementById("app")?.classList.remove("canvas-design-tab");
  document.body.classList.remove("canvas-design-tab");
  canvasModeInstance?.hide?.();
}

function selectedObjectFilename() {
  return objectTools?.getSelection?.()?.catalogName || selectedFile || "";
}

function architectPromptPrefix() {
  const gridMm = Number(document.getElementById("architect-grid-size")?.value || 1000);
  const wallHeightMm = Number(document.getElementById("architect-wall-height")?.value || 2800);
  return [
    "Architect mode modular house CAD:",
    `Use a ${gridMm} mm snap grid and ${wallHeightMm} mm wall height.`,
    "Build modular rooms, walls, roofs, and site pieces as separate editable components with snap interfaces.",
    "Use house materials/colors: warm wood floors, light plaster walls, darker roof parts, blue glass, and contrasting trim.",
  ].join(" ");
}

function architectPresetPrompt(kind = "room") {
  const presets = {
    room: "Generate a starter 2×3 grid living room module with floor slab, four walls, one door opening, one window opening, snap tabs along outside edges, and labels for wall_A through wall_D.",
    wall: "Generate a modular wall panel with a small window, connector tabs on both sides, bottom alignment rail, top cap, and robot gripper-friendly lift points.",
    roof: "Generate a roof and ceiling module that snaps onto a 2×3 grid room, with overhang, ridge beam, alignment sockets, and removable panel sections.",
    robot: "Generate a robot assembly-friendly wall kit: two wall panels, one corner connector, one small window insert, numbered snap features, and assembly order labels.",
    window: "Generate a replaceable window insert module with frame, sill, snap tabs, weather lip, alignment keys, and robot gripper flats.",
    door: "Generate a modular door panel insert with frame, threshold rail, hinge-side connector features, latch-side alignment pockets, and robot assembly labels.",
    floor: "Generate a modular floor slab panel with perimeter snap rails, underside robot lift pockets, alignment sockets on all edges, and warm wood material coloring.",
    pattern: "Generate a repeated grid pattern of modular floor and wall panels for a small house layout with labeled module coordinates and assembly order labels.",
    image: "Use Architect mode to generate a modular house element from an attached reference image with snap interfaces and robot pick labels.",
    blueprint: "Use Architect mode to generate grid-snapping modular house parts from an attached floor plan or blueprint.",
    service: "Generate a compact service-core module for a modular house wall: electrical conduit chase, plumbing chase placeholder, removable cover, connector rails, and robot pick tabs.",
  };
  return `${architectPromptPrefix()}\n\n${presets[kind] || presets.room}`;
}

function architectEditPrompt(kind = "customize", filename = selectedObjectFilename()) {
  const target = filename ? `Target selected module: ${filename}. ` : "";
  const prompts = {
    window: `${target}Edit the selected wall/room module to add or resize a window opening with a replaceable window insert, snap tabs, alignment keys, sill/lintel details, and robot pick tabs.`,
    door: `${target}Edit the selected wall/room module to add a modular door opening and removable door insert with threshold rail, hinge-side labels, and snap sockets.`,
    materials: `${target}Apply house-like material/color styling to the selected architect module while keeping snap interfaces visible and labeled.`,
    customize: `${target}Customize the selected architect module while preserving its grid footprint and snap interfaces.`,
  };
  return `${architectPromptPrefix()}\n\n${prompts[kind] || prompts.customize}`;
}

function architectGridModelUnits() {
  const gridMm = Number(document.getElementById("architect-grid-size")?.value || 1000);
  const unit = Number(mmPerModelUnit?.() || 1) || 1;
  return gridMm / unit;
}

function architectSelectedMesh() {
  const selection = objectTools?.getSelection?.();
  if (selection?.mesh) return selection.mesh;
  const active = selectedFile && projectAssembly.has(selectedFile) ? projectAssembly.get(selectedFile) : null;
  if (active) return active;
  if (projectAssembly.count() === 1) return projectAssembly.list()[0]?.[1] || null;
  return null;
}

function snapArchitectSelectionToGrid() {
  const mesh = architectSelectedMesh();
  if (!mesh) {
    setEditStatus("error", "Select an architect module first.");
    return;
  }
  const grid = architectGridModelUnits();
  const center = objectWorldBoxCenter(mesh);
  const target = center.clone();
  target.x = Math.round(target.x / grid) * grid;
  target.y = Math.round(target.y / grid) * grid;
  const delta = worldDeltaToParentDelta(mesh, target.sub(center));
  if (!gizmoPanel.translateBy?.(delta, { autoApply: true })) {
    setEditStatus("error", "Could not snap module to grid.");
    return;
  }
  setEditStatus("loading", "Snapped module to Architect grid. Saving placement…");
}

function activateArchitectPrompt(kind = "room") {
  showAiComposePanel();
  setRightTab("prompt");
  promptHistory.setTab("compose");
  setSkillEnabled("cad", true);
  setSkillEnabled("architect", true);
  skillsPromptUI.render();
  applyPromptModeUI("architect");
  composer.setPromptText(architectPresetPrompt(kind));
  skillsPromptUI.updatePlan?.();
  saveActiveModelPromptState();
}

function setArchitectPromptForNewModule(kind = "room") {
  activateArchitectPrompt(kind);
}

function setArchitectPromptForSelectedEdit(kind = "customize") {
  showAiComposePanel();
  setRightTab("prompt");
  promptHistory.setTab("compose");
  applyPromptModeUI("architect");
  setSkillEnabled("cad", true);
  setSkillEnabled("architect", true);
  composer.setPromptText(architectEditPrompt(kind, selectedObjectFilename()));
  skillsPromptUI.render();
  skillsPromptUI.updatePlan?.();
  saveActiveModelPromptState();
}

function handleArchitectRibbonAction(action, entry, data = {}) {
  if (action === "tool") {
    setArchitectPromptForNewModule(data.tool || entry?.architectTool || "room");
    return;
  }
  if (action === "edit") {
    setArchitectPromptForSelectedEdit(data.edit || entry?.architectEdit || "customize");
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
  setSkillEnabled("cad", true);
  setSkillEnabled("architect", true);
  skillsPromptUI.render();
  skillsPromptUI.updatePlan?.();
  setGridVisible(true);
  setEditStatus("ok", "Architect mode — generate modular rooms, walls, windows, and site layouts on a snap grid.");
}

function exitArchitectMode() {
  // Architect is a permanent right-panel tab; leaving the design mode should not hide it.
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
    setEditStatus("ok", "Sketch mode — click Create Sketch to enter locked 2D edit.");
  } else if (tab === "RIGGING") {
    setEditStatus("ok", "Rigging mode — Add Bone, Connect hierarchy, Save Rig.");
  } else if (tab === "ARCHITECT") {
    setEditStatus("ok", "Architect mode — modular house CAD with grid snapping and robot assembly labels.");
  } else if (tab === "CATALOG") {
    exitCanvasTab();
    exitSketchMode();
    catalogPanel?.open?.();
    setEditStatus("ok", "Catalog — search STEP models, compare supplier prices, and import parts.");
  } else if (tab === "CANVAS") {
    exitSketchMode();
    enterCanvasTab();
    setEditStatus("ok", "Canvas — sketch on the grid, describe it in the AI panel, then Generate.");
  } else {
    exitCanvasTab();
    exitSketchMode();
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
  if (action === "keyframe") {
    riggingEditor.insertKeyframe();
    return;
  }
  if (action === "play") {
    riggingEditor.togglePlay();
    return;
  }
  if (action === "stop") {
    riggingEditor.setPlaying(false);
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
      scene.background.setHex(savedSceneBg ?? FUSION.canvas);
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
      if (pickHintTitle) pickHintTitle.textContent = tool === "presspull" ? "Press-Pull" : "Mirror";
      if (pickHintText) {
        pickHintText.textContent =
          tool === "presspull"
            ? "Click a sketch profile or model face, drag the arrow or type a distance (mm/in). Esc to exit."
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
  getModelInfo: () => ({ projectId, filename: selectedFile }),
  api,
  onApplied: afterModelEdit,
  onStatus: setEditStatus,
  transformControls,
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
  deleteSelectedObject();
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

async function reloadViewportFromProject({ fitView = false, latestFile = null, placedFiles = [] } = {}) {
  if (!projectId) return;
  const data = await api(`/api/projects/${projectId}`);
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
  ensureLoadFile(latestFile, { primary: true });
  for (const filename of placedFiles || []) ensureLoadFile(filename);
  if (
    latestFile &&
    !comps.some((c) => c.name === latestFile || c.viewer_filename === latestFile) &&
    projectFiles.some((f) => f.name === latestFile)
  ) {
    comps = [
      {
        id: fileStem(latestFile),
        name: latestFile,
        stem: fileStem(latestFile),
        format: latestFile.slice(latestFile.lastIndexOf(".") + 1).toLowerCase(),
        viewer_filename: latestFile,
        size: projectFiles.find((f) => f.name === latestFile)?.size,
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
      latestFile: latestFile || data.latest_file,
      fitView,
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

async function deleteSelectedObject() {
  const sel = objectTools.getSelection();
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
}

document.querySelectorAll("[data-right-tab]").forEach((btn) => {
  btn.addEventListener("click", () => setRightTab(btn.dataset.rightTab));
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

function launchViewportTool(toolId) {
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
      setEditStatus("ok", "Press-Pull linked to the selected face. Drag the arrow or type a distance.");
    } else {
      directModeling.setTool("presspull");
      setEditStatus(
        "ok",
        sketchCount > 0
          ? "Click a sketch profile to extrude, or click a model face for Press-Pull."
          : "Press-Pull: click a sketch profile or model face, then drag the arrow or type a distance."
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
  const menu = document.createElement("div");
  menu.className = "marking-menu";
  const actions = [
    ["⇕", "Press-Pull", () => launchViewportTool("presspull")],
    ["✥", "Move", () => openTransformMode("translate")],
    ["⟳", "Rotate", () => openTransformMode("rotate")],
    ["⤢", "Scale", () => openTransformMode("scale")],
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
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  sketchEditor.resize?.();
  collab?.resizeLabels();
}

initPanelResize();
const mobileUI = initMobileUI({
  onResize: () => {
    resize();
    collab?.resizeLabels();
  },
});

window.addEventListener("resize", resize);
resize();

const IMPORT_ACCEPT = /\.(stl|obj|glb|gltf|ply|off|3mf|step|stp)$/i;
let viewportDragDepth = 0;
const viewportDropOverlay = document.getElementById("viewport-drop-overlay");

function isCadFileDrag(e) {
  const types = [...(e.dataTransfer?.types || [])];
  if (!types.includes("Files")) return false;
  const items = [...(e.dataTransfer?.items || [])];
  if (!items.length) return true;
  return items.some((item) => item.kind === "file" && (!item.type || /model|mesh|octet|zip|step|stl|gltf|3mf/i.test(item.type)));
}

function clearViewportDropOverlay() {
  viewportDragDepth = 0;
  viewport.classList.remove("viewport-drag-over");
  viewportDropOverlay?.classList.add("hidden");
}

viewport.addEventListener("dragenter", (e) => {
  if (workspaceModes?.getMode?.() !== "design") return;
  if (!isCadFileDrag(e)) return;
  e.preventDefault();
  viewportDragDepth += 1;
  viewport.classList.add("viewport-drag-over");
  viewportDropOverlay?.classList.remove("hidden");
});
viewport.addEventListener("dragleave", (e) => {
  if (workspaceModes?.getMode?.() !== "design") return;
  if (!isCadFileDrag(e)) return;
  if (e.currentTarget.contains(e.relatedTarget)) return;
  viewportDragDepth = Math.max(0, viewportDragDepth - 1);
  if (viewportDragDepth === 0) {
    clearViewportDropOverlay();
  }
});
viewport.addEventListener("dragover", (e) => {
  if (workspaceModes?.getMode?.() !== "design") return;
  if (!isCadFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
viewport.addEventListener("drop", async (e) => {
  if (!isCadFileDrag(e)) {
    clearViewportDropOverlay();
    return;
  }
  e.preventDefault();
  clearViewportDropOverlay();
  if (workspaceModes?.getMode?.() !== "design") return;
  const files = [...(e.dataTransfer.files || [])].filter((f) => IMPORT_ACCEPT.test(f.name));
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

function animate() {
  requestAnimationFrame(animate);
  controls.update();

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
  collab?.sendPicks([]);
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
      if (parts.some((p) => /gear/i.test(p.id || ""))) {
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
  const visible = comps.filter((c) => c.auto_load === true);
  const targets = visible.length ? visible : (primary ? [primary] : comps);
  return targets.length ? targets.every((c) => projectAssembly.has(c.name)) : false;
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

function materializeObject(object3d, { center = true, normalizePivot = center } = {}) {
  object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3d);
  meshCenterOffset = box.getCenter(new THREE.Vector3());
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

function formatApiDetail(detail, statusText = "") {
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
  if (refs?.length) collab?.sendPicks(refs);
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
    try {
      bodyPreview = JSON.parse(options.body);
    } catch {
      bodyPreview = options.body.slice(0, 200);
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
      const msg = formatApiDetail(detail, res.statusText);
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

function storePromptAiKeyValue(value) {
  try {
    if (value) localStorage.setItem(LS_PROMPT_AI_KEY, value);
    else localStorage.removeItem(LS_PROMPT_AI_KEY);
  } catch (_) {}
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

  let keyName, modelName;
  if (found) {
    keyName = found.name || "Selected key";
    modelName = found.model || found.effective_model || "";
  } else if (status?.ai_ready) {
    const eff = status.effective;
    keyName = eff?.key_name || status.keys?.[0]?.name || "Default key";
    modelName = eff?.model || status.model || "";
  } else {
    keyName = "No key";
    modelName = "";
  }

  // Sync all pill buttons (design prompt + wiring prompt)
  for (const [nameId, modelId] of [
    ["prompt-key-pill-name", "prompt-key-pill-model"],
    ["wiring-key-pill-name", "wiring-key-pill-model"],
  ]) {
    const nameEl = document.getElementById(nameId);
    const modelEl = document.getElementById(modelId);
    if (nameEl) nameEl.textContent = keyName;
    if (modelEl) modelEl.textContent = modelName;
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
  ],
  anthropic: [
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

function renderPromptAiKeySelect(status, { preserveSelection = true } = {}) {
  const sel = document.getElementById("prompt-ai-key-select");
  if (!sel) return;
  const prev = preserveSelection ? sel.value : "";
  sel.innerHTML = "";

  const personalKeys = status?.keys || [];
  const teamKeys = (status?.team_keys || []).filter((k) => k.enabled !== false);

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
  const candidates = [prev, getStoredPromptAiKeyValue(), defaultPromptKeyValue(status)].filter(Boolean);
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
  const teamKeys = (status?.team_keys || []).filter((k) => k.enabled !== false);
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
  const allPills = document.querySelectorAll("#prompt-key-picker-btn, #wiring-key-picker-btn");
  allPills.forEach((b) => b.setAttribute("aria-expanded", "false"));
  popup.classList.add("hidden");
  promptKeyPopupAnchor = null;
}

function initPromptKeyPopup() {
  const popup = document.getElementById("prompt-key-popup");
  if (!popup) return;

  // Attach to both design-prompt pill and wiring-prompt pill
  const pillIds = ["prompt-key-picker-btn", "wiring-key-picker-btn"];
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
}

function getSelectedWorkspaceId() {
  return document.getElementById("team-select")?.value || allTeams[0]?.id || null;
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
  return allProjects;
}

async function loadProjectComponents(comps, { projectId: pid, latestFile, loadGen, fitView = true } = {}) {
  if (!comps?.length) return false;
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
  for (const comp of visibleComps) pushUnique(comp);
  selectedFile = primary.name;
  let lastError = null;
  let loadedCount = 0;
  try {
    for (const entry of ordered) {
      const viewer = entry.viewer_filename || entry.name;
      selectedFile = entry.name;
      const ok = await loadModel(
        `/api/projects/${pid}/files/${encodeURIComponent(viewer)}`,
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
  getProjects: () => allProjects,
  getActiveProjectId: () => projectId,
  isProjectLoading: (id) => loadingProjectIds.has(id),
  isProjectGenerating: (id) => isProjectGenerating(id),
  isProjectNew: (id) => newlyCompletedProjects.has(id),
  onOpenProject: (id) => openProjectById(id),
  onRenameProject: (p) => renameProject(p),
  onDeleteProject: (p) => deleteProject(p),
  onExportProject: (p) => exportProject(p),
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
  return [
    entry.name,
    entry.filename,
    entry.viewer_filename,
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
  saveActiveModelPromptState();
  prepareViewportForModels();
  try {
    if (projectAssembly.has(entry.name)) {
      selectAssemblyComponent(entry.name, { fitView: true });
      await refreshPromptHistory();
      showAiComposePanel();
      return;
    }
    selectedFile = entry.name;
    projectTree.setSelected(entry.name);
    const viewer = entry.viewer_filename || entry.name;
    const ok = await loadModel(`/api/projects/${projectId}/files/${encodeURIComponent(viewer)}`, viewer, {
      projectId,
      append: projectAssembly.count() > 0,
      catalogFilename: entry.name,
      center: !hasBakedPlacement(entry),
      fitView: true,
      autoGizmo: false,
    });
    if (!ok) {
      if (!projectAssembly.has(entry.name)) {
        throw new Error("Model load was cancelled or did not complete.");
      }
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

const projectTree = createProjectTree({
  container: document.getElementById("design-browser"),
  getProjectId: () => projectId,
  onOpenComponent: (entry) => openBrowserComponent(entry),
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

function renderProjectBrowser(browser) {
  mobileBrowserComponents = browser?.components || [];
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
      <span>${escapeHtml(item.label)}</span>
      ${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ""}
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
        { label: "References", hint: "View picked faces, paths, and refs", run: () => openMobileRightPanel("refs") },
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
  apiFn: (url, opts) => fetch(url, {
    ...opts,
    headers: { ...authHeaders(), ...(opts?.headers || {}) },
  }),
});

document.getElementById("btn-wiring-photo-debug")?.addEventListener("click", () => {
  wiringDebug.toggle();
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
  if (!dataUrl) return;
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
    return;
  }
  promptImages = promptImages.filter((img) => img.name !== "canvas-sketch.png");
  if (promptImages.length < 4) {
    promptImages.push(entry);
    renderPromptImages();
  }
}

function syncCanvasGenerateButtonLabel() {
  const btn = document.getElementById("btn-canvas-generate");
  const target = document.getElementById("canvas-prompt-target")?.value || "design";
  if (!btn) return;
  btn.textContent = target === "wiring" ? "Generate schematic" : "Generate 3D model";
}

async function runCanvasGenerate() {
  const statusEl = document.getElementById("canvas-prompt-status");
  const promptInput = document.getElementById("canvas-prompt-input");
  let prompt = promptInput?.value?.trim() || "";
  const transcript = canvasModeInstance.getTranscript?.() || "";
  if (transcript && !prompt.includes(transcript)) {
    prompt = prompt ? `${prompt}\n\n${transcript}` : transcript;
  }
  if (!prompt) {
    if (statusEl) {
      statusEl.className = "status error";
      statusEl.textContent = "Enter a prompt or record a voice note first.";
    }
    return;
  }

  canvasModeInstance.stopVoice?.();
  const target = document.getElementById("canvas-prompt-target")?.value || "design";
  const dataUrl = canvasModeInstance.getCanvasDataUrl?.();

  if (target === "wiring") {
    workspaceModes.setMode("wiring");
    applyWorkspaceMode("wiring");
    const inp = document.getElementById("wiring-prompt-input");
    if (inp) inp.value = prompt;
    attachCanvasSketchImage(dataUrl, "wiring");
    if (statusEl) {
      statusEl.className = "status loading";
      statusEl.textContent = "Generating wiring schematic from sketch…";
    }
    document.getElementById("btn-wiring-prompt")?.click();
    return;
  }

  workspaceModes.setMode("design");
  applyWorkspaceMode("design");
  composer.setPromptText(prompt);
  if (promptInput) promptInput.value = prompt;
  attachCanvasSketchImage(dataUrl, "design");
  if (statusEl) {
    statusEl.className = "status loading";
    statusEl.textContent = "Generating 3D model from sketch…";
  }
  suppressAiComposePanelSwitch = true;
  document.getElementById("btn-prompt")?.click();
}

const canvasModeInstance = createCanvasMode({
  containerEl: document.getElementById("canvas-mode-container"),
  voiceEls: {
    recordBtn: document.getElementById("canvas-voice-btn"),
    timer: document.getElementById("canvas-voice-timer"),
    time: document.getElementById("canvas-voice-time"),
    clearTranscriptBtn: document.getElementById("btn-canvas-clear-transcript"),
    transcriptPanel: document.getElementById("canvas-panel-transcript"),
  },
});

document.getElementById("btn-canvas-generate")?.addEventListener("click", () => {
  void runCanvasGenerate();
});
document.getElementById("btn-canvas-clear-panel")?.addEventListener("click", () => {
  canvasModeInstance.clearCanvas?.();
});
document.getElementById("canvas-prompt-target")?.addEventListener("change", syncCanvasGenerateButtonLabel);
syncCanvasGenerateButtonLabel();

function mirrorStatusToCanvasPanel(sourceEl) {
  if (!document.body.classList.contains("canvas-design-tab")) return;
  const canvasStatus = document.getElementById("canvas-prompt-status");
  if (!sourceEl || !canvasStatus || !sourceEl.textContent) return;
  canvasStatus.className = sourceEl.className;
  canvasStatus.textContent = sourceEl.textContent;
}

const promptStatusEl = document.getElementById("prompt-status");
if (promptStatusEl) {
  new MutationObserver(() => mirrorStatusToCanvasPanel(promptStatusEl)).observe(promptStatusEl, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
    characterData: true,
  });
}
const wiringPromptStatusEl = document.getElementById("wiring-prompt-status");
if (wiringPromptStatusEl) {
  new MutationObserver(() => mirrorStatusToCanvasPanel(wiringPromptStatusEl)).observe(wiringPromptStatusEl, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
    characterData: true,
  });
}

document.getElementById("canvas-prompt-input")?.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    void runCanvasGenerate();
  }
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
        <img src="${img.data_url}" alt="${escapeHtml(img.name)}" />
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
    chip.innerHTML = `<span class="ref-token">${escapeHtml(ref.token)}</span><span class="ref-coords">${escapeHtml(ref.label || ref.stem)}</span><button type="button" class="ref-remove" title="Remove">×</button>`;
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
  const status = document.getElementById("wiring-prompt-status");
  const prompt = input?.value?.trim();
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
  beginGenerationWatch(projectId, { kind: "wiring" });
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
        speed: document.getElementById("prompt-speed")?.value || "fast",
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
        <img src="${img.data_url}" alt="${escapeHtml(img.name)}" />
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

document.getElementById("btn-rigging-toolbelt-export")?.addEventListener("click", () => {
  riggingEditor.exportUrdf();
});

document.getElementById("btn-rigging-toolbelt-auto")?.addEventListener("click", () => {
  handleRiggingAction("auto");
});

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

function applyWorkspaceMode(mode) {
  const app = document.getElementById("app");
  const wiringWorkspace = document.getElementById("wiring-workspace");
  app?.classList.toggle("wiring-mode", mode === "wiring");
  app?.classList.toggle("architect-workspace-mode", mode === "architect");
  document.body.classList.toggle("wiring-mode", mode === "wiring");
  document.body.classList.toggle("architect-workspace-mode", mode === "architect");
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
    let activeTab = tab;
    if (mode === "architect" && activeTab !== "ARCHITECT") {
      workspaceModes.setDesignTab("ARCHITECT");
      activeTab = "ARCHITECT";
    }
    handleDesignTabChange(activeTab);
    if (activeTab !== "ARCHITECT" && activeTab !== "CANVAS") {
      setRightTab("prompt");
      promptHistory.setTab("compose");
    }
    resize();
    if (currentMesh && tab !== "CANVAS") fitCamera();
  }
}

const workspaceModes = createWorkspaceModes({
  barEl: document.getElementById("workspace-mode-btn"),
  menuEl: document.getElementById("workspace-mode-menu"),
  tabsEl: document.getElementById("workspace-tabs"),
  onChange: (mode) => applyWorkspaceMode(mode),
  onDesignTabChange: (tab) => handleDesignTabChange(tab),
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
    await openFileExportMenu({
      api,
      projectId,
      filename: "visible assembly",
      anchorEl: anchor,
      title: `Export visible assembly`,
      hint: `Downloads include all ${visibleFiles.length} visible components in the model.`,
      allowOnshape: false,
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

async function renameProject(p) {
  const current = p.name || p.id;
  const next = window.prompt(`New name for project "${current}":`, current);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) {
    alert("Project name cannot be empty.");
    return;
  }
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function openProjectById(id) {
  if (!id) return;
  try {
    // Stay in wiring/canvas mode when picking projects from those views.
    // Only reset to design for other non-design modes (sketch, rigging, etc.).
    const mode = workspaceModes.getMode();
    if (mode !== "design" && mode !== "wiring" && mode !== "canvas") {
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

function handleRealtimeEvent(msg = {}) {
  if (!msg?.type) return;
  if (msg.entry) workspaceActivity.prependEntry(msg.entry);

  if (msg.type === "project.meta" || msg.type === "project.renamed") {
    updateProjectNameLocal(msg.project_id || projectId, msg.name, msg.meta);
    return;
  }

  if (msg.type === "project.created" || msg.type === "project.deleted") {
    if (msg.type === "project.deleted" && msg.project_id === projectId) {
      showEmptyProjectViewport({ message: "This project was deleted by a teammate." });
      projectId = null;
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
    refreshProjectShell({ refreshInvites: true, refreshMembers: true });
  }
}

async function loadProject(id) {
  const loadGen = ++loadProjectGeneration;
  setProjectLoading(id, true);
  try {
    saveActiveModelPromptState();
    const prevProjectId = projectId;
  projectId = id;
    ribbon?.setProjectId?.(id);
  saveLastProjectId(id);
    // Clear any new-model badge when the user opens this project.
    if (newlyCompletedProjects.has(id)) {
      newlyCompletedProjects.delete(id);
      renderProjectList();
    }
    if (prevProjectId !== id) {
      showEmptyProjectViewport({ keepBrowser: true });
      // If this project is known to be generating (from cache) but we're not watching it,
      // start the watch immediately so the stop button appears before the API call returns.
      if (generationWatchPid !== id && isProjectGenerating(id)) {
        const cached = allProjects.find((p) => p.id === id);
        beginGenerationWatch(id, {
          kind: cached?.generation?.kind || "prompt",
          mode: cached?.generation?.mode || "standard",
        });
      }
      syncViewportGenerationOverlay();
      syncStopButtonVisibility();
    }
    collab.connect(projectId, currentUser, {
      getMeshRoot: () => currentMesh,
      onModelReload: async (msg) => {
        if (msg.filename) {
          saveActiveModelPromptState();
          selectedFile = msg.filename;
          await refreshFiles();
          const placedFiles = (msg.placed_parts || []).map((part) => part.filename).filter(Boolean);
          await reloadViewportFromProject({ fitView: true, latestFile: msg.filename, placedFiles });
          await refreshPromptHistory();
        }
        await refreshTimeline();
      },
      onProjectMeta: (msg) => handleRealtimeEvent(msg),
      onTimeline: () => refreshTimeline(),
      onProjectHistory: () => refreshObjectHistory(),
      onWorkspaceUpdated: (msg) => handleRealtimeEvent(msg),
    });
  const data = await api(`/api/projects/${id}`);
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
    upsertProjectInList({
      id,
      ...data,
      browser,
      name: data.name || id,
    });
    renderProjectBrowser(browser);
    await sketchEditor.loadProjectSketches?.(projectId, api, browser.sketches);
    syncSketchVisibilityFromTree(browser);
    const comps = browser.components || [];
    prepareViewportForModels();
    if (comps.length) {
      const alreadyLoaded = prevProjectId === id && componentsAlreadyLoaded(comps, data.latest_file);
      if (alreadyLoaded) {
        for (const comp of comps) {
          setAssemblyComponentVisible(comp, !isBrowserComponentHidden(comp));
        }
        const visibleComps = comps.filter((c) => !isBrowserComponentHidden(c));
        selectedFile = (visibleComps.find((c) => c.name === data.latest_file || c.viewer_filename === data.latest_file) || visibleComps[0])?.name || null;
        projectTree.setSelected(selectedFile);
        if (selectedFile) selectAssemblyComponent(selectedFile, { fitView: true });
        else {
          objectTools.clearSelection?.();
          transformControls.detach();
          gizmoPanel.hide();
          setEditStatus("ok", "All components are hidden.");
        }
        await refreshPromptHistory();
      } else {
        await loadProjectComponents(comps, {
          projectId: id,
          latestFile: data.latest_file,
          loadGen,
          fitView: true,
        });
        await refreshPromptHistory();
      }
  } else {
      showEmptyProjectViewport();
      await refreshPromptHistory();
    }
    if (loadGen !== loadProjectGeneration) return;
    safeRestoreActiveModelPromptState();
    await resumeGenerationIfNeeded(id, data.generation);
    if (loadGen !== loadProjectGeneration) return;
    // If resumeGenerationIfNeeded applied a completion for this project,
    // clear any badge that was set — the user is already viewing the model.
    if (newlyCompletedProjects.has(id)) {
      newlyCompletedProjects.delete(id);
      renderProjectList();
    }
    // Ensure stop button reflects current state after resumeGenerationIfNeeded runs.
    syncStopButtonVisibility();
    if (workspaceModes.isWiring()) {
      clearWiringPrompts();
      wiringSim.load();
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
  const teamId = getSelectedWorkspaceId();
  if (!teamId) {
    alert("Create or select a workspace first.");
    return;
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
    const cb = document.getElementById("workspace-fusion-connect");
    if (cb) cb.checked = true;
    await refreshWorkspaceRealtimeEditor();
    setEditStatus("ok", "Fusion linked to this workspace. Import a design from Fusion Library to share it with the team.");
  } catch (err) {
    setEditStatus("error", err.message || "Could not link Fusion to this workspace.");
  }
}

function renderWorkspaceRealtimeEditor(data = null) {
  const folderEl = document.getElementById("workspace-render-folder-card");
  const projectsEl = document.getElementById("workspace-fusion-projects");
  if (!folderEl || !projectsEl) return;
  if (!data) {
    folderEl.innerHTML = "Select one workspace to use the realtime editor.";
    projectsEl.innerHTML = "";
    return;
  }
  const folder = data.render_folder || {};
  const provider = folder.provider || "render3d";
  const label = folder.label || (provider === "fusion" ? "Fusion 360" : "Render3D cloud");
  folderEl.innerHTML = `
    <strong>${escapeHtml(label)}</strong>
    <span>${escapeHtml(provider.replace(/_/g, " "))}${folder.folder_ref ? ` · ${escapeHtml(folder.folder_ref)}` : ""}</span>
    ${
      provider === "fusion"
        ? `<button type="button" class="btn secondary btn-compact workspace-fusion-link-btn" data-workspace-fusion-open>Open Fusion Library</button>`
        : `<button type="button" class="btn secondary btn-compact workspace-fusion-link-btn" data-workspace-fusion-link>Link Fusion to workspace</button>`
    }
  `;
  folderEl.querySelector("[data-workspace-fusion-open]")?.addEventListener("click", () => {
    document.getElementById("fusion-library-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setEditStatus("ok", "Fusion is connected. Use Fusion Library below to import or sync designs.");
  });
  folderEl.querySelector("[data-workspace-fusion-link]")?.addEventListener("click", () => {
    void linkActiveWorkspaceToFusion();
  });
  const fusionProjects = (data.projects || []).filter((p) => p.fusion_source || (p.fusion_mirrors || []).length);
  if (!fusionProjects.length) {
    projectsEl.innerHTML = `
      <strong>Fusion projects</strong>
      <span>No Fusion-linked projects yet. Use the Fusion Library below to import a design into this workspace.</span>
    `;
    return;
  }
  projectsEl.innerHTML = `
    <strong>Fusion linked folders</strong>
    <div class="workspace-fusion-project-list">
      ${fusionProjects
        .slice(0, 5)
        .map(
          (p) => `
        <div class="workspace-fusion-project-card">
          <div class="workspace-fusion-project-head">
            <span>${escapeHtml(p.name || p.id)}</span>
          </div>
          <small>${escapeHtml(p.latest_file || "No preview file")} · ${escapeHtml(p.fusion_source?.item_name || "Fusion item")}</small>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

async function refreshWorkspaceRealtimeEditor() {
  const teamId = getSelectedWorkspaceId();
  if (!teamId) {
    renderWorkspaceRealtimeEditor(null);
    return;
  }
  try {
    const data = await api(`/api/teams/${teamId}/realtime-editor`);
    renderWorkspaceRealtimeEditor(data);
    const cb = document.getElementById("workspace-fusion-connect");
    if (cb) cb.checked = (data.render_folder?.provider || "render3d") === "fusion";
  } catch {
    renderWorkspaceRealtimeEditor(null);
  }
}

async function syncWorkspaceFusionConnect() {
  const teamId = getSelectedWorkspaceId();
  const cb = document.getElementById("workspace-fusion-connect");
  if (!cb) return;
  if (!teamId) {
    cb.checked = false;
    cb.disabled = true;
    return;
  }
  cb.disabled = false;
  try {
    const data = await api(`/api/teams/${teamId}/render-folder`);
    cb.checked = (data.render_folder?.provider || "render3d") === "fusion";
  } catch {
    cb.checked = false;
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
        const viewer = f.viewer_filename || f.name;
        await loadModel(`/api/projects/${projectId}/files/${encodeURIComponent(viewer)}`, viewer, {
          projectId,
          catalogFilename: f.name,
          center: !hasBakedPlacement(f),
          fitView: true,
        });
        await refreshPromptHistory();
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

    actions.append(exp, rename, del);
    li.append(body, actions);
    list.appendChild(li);
  }
}

async function renameProjectFile(filename) {
  if (!projectId) return;
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  const stem = filename.slice(0, filename.length - ext.length);
  const next = window.prompt(`Rename "${filename}" to:`, stem);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) {
    alert("Name cannot be empty.");
    return;
  }
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
  timelineData = data.timeline;
  timeline.setTimeline(data.timeline);
  renderProjectList();
  renderFileList(data.files || []);
  const browser = normalizeBrowser(data);
  renderProjectBrowser(browser);
  await sketchEditor.loadProjectSketches?.(projectId, api, browser.sketches);
  syncSketchVisibilityFromTree(browser);
  if (selectedFile) projectTree.setSelected(selectedFile);
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
  const selecting = !isMobileInteraction() && leftDragMode !== "rotate";
  btn.textContent = `Left drag: ${selecting ? "Select" : "Rotate"}`;
  btn.classList.toggle("active", selecting);
  btn.setAttribute("aria-pressed", selecting ? "true" : "false");
  btn.title = selecting
    ? "Left-drag selects objects. Click to switch left-drag back to camera rotate."
    : "Left-drag rotates the camera. Click to switch left-drag to object selection.";
}

function setLeftDragMode(mode) {
  leftDragMode = isMobileInteraction() ? "rotate" : (mode === "rotate" ? "rotate" : "select");
  try {
    localStorage.setItem(LEFT_DRAG_MODE_KEY, leftDragMode);
  } catch {
    /* local storage is best-effort */
  }
  syncLeftDragModeButton();
  applyLeftDragModeControls();
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

document.getElementById("btn-left-drag-mode")?.addEventListener("click", () => {
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
  if (isMobileInteraction()) return false;
  if (leftDragMode === "rotate") return false;
  if (e.button !== 0 || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.code === "Space") return false;
  const mode = getPickMode();
  if (mode !== "off" && mode !== "object") return false;
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
    projectTree.setSelected(activeBodyCatalog);
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
  setEditStatus("ok", `Selected ${candidates.length} objects · Delete removes them.`);
  return true;
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
  if (handleReferenceRemove(e)) return;
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
  if (viewportSelectDrag?.pointerId === e.pointerId) {
    const moved = Math.hypot(e.clientX - viewportSelectDrag.startX, e.clientY - viewportSelectDrag.startY);
    if (!viewportSelectDrag.hit?.mesh && moved > 6) {
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
  if (viewportSelectDrag?.pointerId !== e.pointerId) return;
  const drag = viewportSelectDrag;
  viewportSelectDrag = null;
  renderer.domElement.releasePointerCapture?.(e.pointerId);
  controls.enabled = controlsEnabledBeforeViewportSelect;
  if (drag.hit?.mesh) {
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

renderer.domElement.addEventListener("click", (e) => {
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
    composer.addReference(result.ref);
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
  const validFiles = [...(files || [])].filter((file) => IMPORT_ACCEPT.test(file.name));
  if (!validFiles.length) return [];

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
  for (const file of validFiles) {
    setEditStatus("ok", `Uploading ${file.name}...`);
    results.push(await uploadProjectFile(file, uploadChoice));
  }

  setEditStatus(
    "ok",
    validFiles.length === 1
      ? `Added ${results[0]?.filename || validFiles[0].name} to this project.`
      : `Added ${validFiles.length} CAD files to this project.`,
  );
  return results;
}

document.getElementById("file-upload")?.addEventListener("change", async (e) => {
  const files = [...(e.target.files || [])].filter((f) => IMPORT_ACCEPT.test(f.name));
  if (!files.length) return;
  try {
    const choice = await askDropDestination(files);
    if (choice) await uploadProjectFiles(files, choice);
  } catch (err) {
    alert(err.message || "Upload failed");
  }
  e.target.value = "";
});

document.getElementById("btn-fit-sidebar")?.addEventListener("click", fitCamera);
document.getElementById("btn-grid-viewport")?.addEventListener("click", toggleGrid);

// Delegated listeners for view buttons that live inside the ribbon (inserted after module eval)
document.addEventListener("click", (e) => {
  if (e.target.closest("#btn-fit")) { fitCamera(); return; }

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
document.getElementById("btn-grid-sidebar")?.addEventListener("click", toggleGrid);

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

document.getElementById("btn-prompt")?.addEventListener("click", async () => {
  const prompt = composer.getPromptText();
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
    return;
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
  if (!aiStatus?.ai_ready) {
    const status = document.getElementById("prompt-status");
    status.className = "status error";
    status.textContent = "Add your OpenAI or Claude API key from the account menu before prompting.";
    viewerOverlay.showError(status.textContent);
    aiKeyUi?.openRequired();
    return;
  }
  await ensureProject();
  const status = document.getElementById("prompt-status");
  const reply = document.getElementById("prompt-reply");
  const genMode =
    promptMode === "v2" ? "v2" : promptMode === "fusion" ? "fusion" : promptMode === "architect" ? "architect" : "standard";
  const speed = document.getElementById("prompt-speed")?.value || "quality";
  const target = document.getElementById("prompt-target")?.value || "design";
  status.className = "status loading";
  status.textContent = promptMode === "v2"
    ? `Generating with 2.0 (quality pipeline)… (runs in background — safe to refresh)`
    : promptMode === "fusion"
    ? `Generating + pushing to Fusion 360… (runs in background — safe to refresh)`
    : promptMode === "architect"
    ? `Generating architect layout… (runs in background — safe to refresh)`
    : `Generating with ${getSelectedPromptAiKeyLabel()}… (runs in background — safe to refresh)`;
  reply.textContent = "";
  beginGenerationWatch(projectId, { kind: "prompt", mode: genMode, pendingStart: true });
  const genId = ++activePromptGenerationId;
  userCancelRequested = false;
  activePromptAbort = new AbortController();
  let promptFailed = false;
  try {
    const body = {
      prompt,
      base_filename: selectedFile,
      references: composer.getReferences(),
      images: promptImages,
      skills: getEnabledSkillsForPrompt({ hasImages: promptImages.length > 0 }),
      ...getPromptAiKeyBodyFields(),
      ...(promptMode === "v2" ? { mode: "v2", speed } : {}),
      ...(promptMode === "fusion"
        ? {
            mode: "fusion",
            fusion_push: target === "fusion360",
            fusion_target: target === "fusion360" ? "fusion360" : "in_app",
            speed,
          }
        : {}),
      ...(promptMode === "architect" ? { mode: "architect", speed } : {}),
    };
    lastPromptCopyContext = promptCopyContextBase(prompt, { promptMode: promptModeForRef(genMode) });
    const data = await api(
      `/api/projects/${projectId}/prompt`,
      {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
        signal: activePromptAbort.signal,
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
      return;
    }
    if (data.accepted || data.status === "running") {
      if (generationWatchOverlay) generationWatchOverlay.pendingStart = false;
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
      status.textContent = promptMode === "v2"
        ? "Generating with 2.0 in background… refresh anytime; model loads when ready."
        : "Generating in background… refresh anytime; model loads when ready.";
      syncStopButtonVisibility();
      return;
    }
    stopGenerationWatch();
    window.dispatchEvent(new CustomEvent("render3d:model", { detail: { ...data, projectId } }));
    saveActiveModelPromptState();
    selectedFile = data.filename;
    await refreshFiles();
    const placedFiles = (data.placed_parts || []).map((part) => part.filename).filter(Boolean);
    await reloadViewportFromProject({ fitView: true, latestFile: data.filename, placedFiles });
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
    beginGenerationWatch(projectId, { kind: data?.generation?.kind || "build" });
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

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const key = String(e.key || "").toLowerCase();
  const inField = e.target.matches("textarea, input, select, [contenteditable]");
  if (workspaceModes?.isWiring?.() && !inField) {
    if (mod && key === "z" && !e.shiftKey) {
      e.preventDefault();
      wiringSim.undo();
      return;
    }
    if (mod && key === "z" && e.shiftKey) {
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
    if (mod && key === "z" && e.shiftKey) {
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
  if (inField) return;
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
    undoTimeline();
    return;
  }
  if (mod && key === "z" && e.shiftKey) {
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
  if (key === "x" || key === "backspace" || key === "delete") {
    if (objectTools.getSelection()) {
      e.preventDefault();
      deleteSelectedObject();
      return;
    }
  }
  if (key === "p") {
    setRightTab("tools");
    directModeling.setTool("presspull");
  }
  if (key === "v") activatePickMode("object");
  if (key === "m") {
    setRightTab("tools");
    directModeling.setTool("mirror");
  }
  if (key === "c") activatePickMode("corner");
  if (key === "f") {
    setRightTab("tools");
    activatePickMode("face");
    editTools.updateExtrudeTarget?.();
  }
  if (key === "e") activatePickMode("edge");
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

  aiKeyUi = createAIKeyUI({
    api,
    onStatusChange: (status) => {
      renderAIStatus(status);
      void refreshWorkspaceAiUsage();
    },
  });

  const auth = createAuthUI({
    api,
    onUserMenuOpen: () => {
      void refreshWorkspaceAiUsage();
    },
    onReady: async (data) => {
      currentUser = data.user;
      allTeams = data.teams || [];
      aiKeyUi.render(data.ai);
      connectUserRealtime();
      renderTeams();
      await startApp();
    },
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
    getSelectedFile: () => selectedFile,
    getWorkspaceId: getSelectedWorkspaceId,
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
    onStatus: setEditStatus,
    onMirrorLinked: () => setEditStatus("ok", "Fusion mirror folder linked."),
  });

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
      await onWorkspaceChange();
  await ensureProject();
      showAiComposePanel();
  activityLog.refreshServerDebounced();
    } catch (err) {
      console.error("startApp failed:", err);
      setEditStatus("error", err.message || "Failed to load workspace");
      renderProjectList();
    }
  }

  async function onWorkspaceChange() {
    const id = getSelectedWorkspaceId();
    if (id) {
      try {
        localStorage.setItem(LS_LAST_WORKSPACE, id);
      } catch (_) {}
    }
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
    await syncWorkspaceFusionConnect();
    await refreshWorkspaceAiUsage();
    renderProjectList();
    if (projectId && !allProjects.some((p) => p.id === projectId)) {
      const stillThere = await ensureActiveProjectListed(projectId);
      renderProjectList();
      if (stillThere) return;
    }
    if (projectId && allProjects.some((p) => p.id === projectId)) return;
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
    explorerTeams.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    const saved = localStorage.getItem(LS_LAST_WORKSPACE);
    if (saved && explorerTeams.some((t) => t.id === saved)) {
      sel.value = saved;
    } else if (explorerTeams.length) {
      sel.value = explorerTeams[0].id;
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
            <div class="profile-cost-bar" title="${escapeHtml(d.date)} · ${costText(total)}">
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
          ${pts.map((p, i) => i % labelEvery === 0 || i === pts.length - 1 ? `<text class="cost-date-label" x="${p.x}" y="${height - 16}" text-anchor="middle">${escapeHtml(String(p.date).slice(5))}</text>` : "").join("")}
          ${pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="var(--accent)" opacity="${Number(p.total_usd) > 0 ? "1" : "0.25"}"><title>${escapeHtml(p.date)} · ${costText(p.total_usd)}</title></circle>`).join("")}
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
            <div class="costs-feature-row" title="${escapeHtml(row.label)} · ${costText(row.cost)}">
              <span><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(row.sub || "")}</small></span>
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
        data-sort-key="${escapeHtml(key)}"
        data-sort-dir="${escapeHtml(nextDir)}"
        title="Sort ${escapeHtml(label)} ${escapeHtml(hint)}">
        <span>${escapeHtml(label)}</span><i aria-hidden="true">${arrow}</i>
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
          return `
            <div class="costs-feature-row" title="${escapeHtml(row.name)} · ${costMetricText(row)}">
              <span><strong>${escapeHtml(row.name || row.project_id)}</strong><small>${Number(row.display_tracked_count || 0)} prompts · ${Number(row.total_tokens || 0).toLocaleString()} tokens</small></span>
              <div><i class="project" style="width:${pct}%"></i></div>
              <strong>${costMetricText(row)}</strong>
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
          <div class="costs-table-row" role="row" title="${escapeHtml(row.prompt || "")}">
            <span>
              <strong>${escapeHtml((row.prompt || "Untitled prompt").slice(0, 92))}${(row.prompt || "").length > 92 ? "..." : ""}</strong>
              <small>${escapeHtml(row.user_name || "Unknown user")} · ${escapeHtml(row.created_at ? new Date(row.created_at).toLocaleString() : "")}</small>
            </span>
            <span>${escapeHtml(row.project_name || row.project_id || "")}</span>
            <span>${escapeHtml(row.model || row.provider || "AI")}</span>
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
            <div class="costs-modal-bar" title="${escapeHtml(d.date)} · ${costText(total)}">
              <span class="${total > 0 ? "" : "empty"}" style="height:${height}px">
                <i class="mine" style="height:${minePct}%"></i>
                <i class="shared" style="height:${Math.max(0, 100 - minePct)}%"></i>
              </span>
              <em>${escapeHtml(d.date.slice(5))}</em>
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
                <strong>${escapeHtml(project.name || project.project_id)}</strong>
                <span class="muted small">${Number(project.prompt_count || 0)} prompts · ${Number(project.total_tokens || 0).toLocaleString()} tokens · ${Number(project.ai_calls || 0)} AI calls</span>
              </div>
              <div class="profile-cost-user-stats">
                <strong>${costText(project.display_cost_usd)}</strong>
                <span class="muted small">${costText(project.total_cost_usd)} all time</span>
              </div>
            </div>
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
                <strong>${escapeHtml((prompt.prompt || "Untitled prompt").slice(0, 110))}${(prompt.prompt || "").length > 110 ? "..." : ""}</strong>
                <span class="muted small">${escapeHtml(prompt.project_name || "")} · ${Number(prompt.total_tokens || 0).toLocaleString()} tokens · ${escapeHtml(prompt.model || prompt.provider || "AI")}</span>
              </div>
              <div class="profile-cost-user-stats">
                <strong>${costText(prompt.cost_usd)}</strong>
                <span class="muted small">${escapeHtml(prompt.created_at ? new Date(prompt.created_at).toLocaleDateString() : "")}</span>
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
              <strong>${escapeHtml(u.display_name || u.email || "Team member")}</strong>
              <span class="muted small">${escapeHtml(u.email || "")} · ${Number(u.tracked_count || 0)} tracked prompts</span>
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
        ${sharedUsers.map((u) => `<option value="user:${escapeHtml(u.user_id)}">${escapeHtml(u.display_name || u.email || "Team member")}</option>`).join("")}
      `;
      select.value = current;
    }
    const totals = data.totals || {};
    body.innerHTML = `
      <div class="costs-modal-summary">
        <div><span>Total</span><strong>${costText(totals.all_window_usd)}</strong></div>
        <div><span>Mine</span><strong>${costText(totals.mine_window_usd)}</strong></div>
        <div><span>Shared</span><strong>${costText(totals.shared_window_usd)}</strong></div>
        <div><span>Tracked prompts</span><strong>${Number(data.tracked_count || 0)}</strong></div>
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

  async function refreshCostsMenuPanel() {
    const panel = document.getElementById("profile-costs-panel");
    if (!panel || panel.classList.contains("hidden")) return;
    panel.innerHTML = `<div class="profile-workspace-loading muted small">Loading costs…</div>`;
    try {
      const data = await api("/api/user/ai-costs?days=30");
      const totals = data.totals || {};
      const sharedUsers = data.shared_users || [];
      panel.innerHTML = `
        <div class="profile-workspace-title">
          <strong>AI costs</strong>
          <span class="muted small">${escapeHtml(data.range?.start || "")} to ${escapeHtml(data.range?.end || "")}</span>
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
            <strong>Shared key users</strong>
            <span class="muted small">${sharedUsers.length} user${sharedUsers.length === 1 ? "" : "s"}</span>
          </div>
          ${sharedUsers.length ? sharedUsers.map((u) => `
            <div class="profile-cost-user">
              <div>
                <strong>${escapeHtml(u.display_name || u.email || "Team member")}</strong>
                <span class="muted small">${escapeHtml(u.email || "")}</span>
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
      panel.innerHTML = `<span class="ai-key-members-error">${escapeHtml(err.message || "Could not load costs")}</span>`;
    }
  }

  document.getElementById("btn-costs-menu")?.addEventListener("click", async () => {
    const panel = document.getElementById("profile-costs-panel");
    const workspacePanel = document.getElementById("profile-workspace-panel");
    if (!panel) return;
    workspacePanel?.classList.add("hidden");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      await refreshCostsMenuPanel();
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
        <section class="profile-workspace-card" data-team-id="${escapeHtml(team.id)}">
          <div class="profile-workspace-head">
            <div>
              <strong>${escapeHtml(team.name)}</strong>
              <span class="muted small">${escapeHtml(team.role || "member")}${team.id === activeTeamId ? " · current" : ""}</span>
            </div>
            <label class="profile-workspace-visible">
              <input type="checkbox" data-action="workspace-visible" data-team-id="${escapeHtml(team.id)}" ${visible ? "checked" : ""} />
              Explorer
            </label>
          </div>
          <div class="profile-workspace-actions">
            ${isOwner ? `
              <input type="text" value="${escapeHtml(team.name)}" data-workspace-name="${escapeHtml(team.id)}" maxlength="120" />
              <button type="button" class="btn btn-compact secondary" data-action="workspace-rename" data-team-id="${escapeHtml(team.id)}">Rename</button>
            ` : `
              <button type="button" class="btn btn-compact danger" data-action="workspace-leave" data-team-id="${escapeHtml(team.id)}">Leave team</button>
            `}
          </div>
          <div class="profile-workspace-invite">
            <input type="email" placeholder="Invite email" data-workspace-invite="${escapeHtml(team.id)}" />
            <button type="button" class="btn btn-compact secondary" data-action="workspace-invite" data-team-id="${escapeHtml(team.id)}">Invite</button>
          </div>
          <div class="profile-workspace-members">
            ${memberRows.map((m) => `
              <div class="profile-workspace-member">
                <span><strong>${escapeHtml(m.display_name || m.email)}</strong> <span class="muted">${escapeHtml(m.email || "")}</span></span>
                <small>${escapeHtml(m.role || "member")}</small>
              </div>
            `).join("") || `<p class="muted small">${loadError ? `Could not load members: ${escapeHtml(loadError)}` : "No members in this team yet."}</p>`}
          </div>
          ${(data.invites || []).length ? `
            <div class="profile-workspace-pending">
              <strong class="muted small">Pending invites</strong>
              ${(data.invites || []).map((inv) => `<div class="muted small">${escapeHtml(inv.email)}</div>`).join("")}
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
    if (!panel) return;
    costsPanel?.classList.add("hidden");
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
        <div class="team-invite-banner" data-invite-id="${escapeHtml(inv.id)}">
          <p><strong>${escapeHtml(inv.inviter_name)}</strong> invited you to the workspace <strong>${escapeHtml(inv.team_name)}</strong>.</p>
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
                  <strong>${escapeHtml(m.display_name)}</strong>
                  <span class="muted">${escapeHtml(m.email)}</span>
                  <small>${escapeHtml(m.role || "member")}</small>
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
    const connectFusion = document.getElementById("workspace-fusion-connect")?.checked === true;
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
        await linkActiveWorkspaceToFusion();
        if (status) status.textContent = `Created workspace "${team.name}" and connected Fusion.`;
      }
    } catch (err) {
      if (status) status.textContent = err.message;
    }
  });

  document.getElementById("workspace-fusion-connect")?.addEventListener("change", async (event) => {
    const teamId = getSelectedWorkspaceId();
    if (!teamId) {
      event.target.checked = false;
      return;
    }
    if (event.target.checked) {
      await linkActiveWorkspaceToFusion();
      return;
    }
    try {
      await api(`/api/teams/${encodeURIComponent(teamId)}/render-folder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "render3d",
          label: "Render3D cloud",
          folder_ref: null,
        }),
      });
      await refreshWorkspaceRealtimeEditor();
      setEditStatus("ok", "Workspace disconnected from Fusion.");
    } catch (err) {
      event.target.checked = true;
      setEditStatus("error", err.message || "Could not disconnect Fusion from this workspace.");
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
  if (session) {
    currentUser = session.user;
    allTeams = session.teams || [];
    aiKeyUi.render(session.ai);
    connectUserRealtime();
    renderTeams();
    await startApp();
  } else {
    const browser = document.getElementById("project-browser");
    const hasEarlyList = browser?.querySelector(".proj-item, .project-list-early li");
    if (!hasEarlyList && browser) {
      browser.innerHTML = '<p class="muted small browser-empty">Sign in to view your projects</p>';
    } else if (browser) {
      const note = document.createElement("p");
      note.className = "status error browser-empty browser-auth-note";
      note.textContent = "Session expired — sign in again (account menu, top right).";
      browser.prepend(note);
    }
    auth.openModal?.();
    document.getElementById("prompt-status").className = "status";
    document.getElementById("prompt-status").textContent = "Sign in to use AI prompting.";
  }
})().catch((err) => {
  console.error("Editor startup failed:", err);
  window.__appProjectListReady = true;
  const browser = document.getElementById("project-browser");
  if (browser) {
    browser.innerHTML = `<p class="status error browser-empty">Editor failed to start: ${escapeHtml(err?.message || "Unknown error")}</p>`;
  }
  setEditStatus?.("error", err?.message || "Editor failed to start");
});
