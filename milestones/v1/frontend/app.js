import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  pickGeometry,
  resetRefCounter,
  setPickMode,
  getPickMode,
  updateHover,
  clearHover,
  getMarkersGroup,
  getHoverGroup,
} from "./picking.js";
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
} from "./scene-style.js";
import { createEditTools } from "./edit-tools.js";
import { createTimelineUI } from "./timeline.js";
import { createPromptComposer } from "./prompt-composer.js";
import { createPromptHistoryUI } from "./prompt-history.js";
import { createObjectHistoryUI } from "./object-history.js";
import { createWorkspaceActivityUI } from "./workspace-activity.js";
import { createWorkspaceBrowser } from "./workspace-browser.js";
import { createActivityLog } from "./activity-log.js";
import { createAuthUI, authHeaders, getToken, getStoredUser } from "./auth.js";
import { createCollab } from "./collab.js";
import { createRibbon } from "./ribbon.js";
import { initPanelResize } from "./panel-resize.js";

const API = "";
const LS_LAST_PROJECT = "render3d:lastProjectId";
const LS_LAST_WORKSPACE = "render3d:lastWorkspaceId";

let projectId = null;
let allProjects = [];
let allTeams = [];
let currentUser = null;
let selectedFile = null;
let currentMesh = null;
let meshCenterOffset = new THREE.Vector3();
let timelineData = null;

initPanelResize();

const viewportHint = document.getElementById("viewport-hint");
const pickHintTitle = document.getElementById("pick-hint-title");
const pickHintText = document.getElementById("pick-hint-text");

const viewport = document.getElementById("viewport");
const scene = new THREE.Scene();
scene.background = new THREE.Color(FUSION.canvas);

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
camera.position.set(2, 1.5, 2.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
setupRenderer(renderer);
viewport.appendChild(renderer.domElement);
setupSceneLighting(scene);
scene.add(getMarkersGroup());
scene.add(getHoverGroup());

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.enablePan = true;
controls.minDistance = 0.05;
controls.maxDistance = 500;
controls.maxPolarAngle = Math.PI * 0.49;

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.addEventListener("dragging-changed", (e) => {
  controls.enabled = !e.value;
});
// Add only the gizmo helper — adding TransformControls itself to the scene causes runaway rotation
scene.add(transformControls.getHelper());

let gridHelper = new THREE.GridHelper(10, 20, FUSION.gridMajor, FUSION.gridMinor);
scene.add(gridHelper);
scene.add(new THREE.AxesHelper(0.5));

let collab;

const composer = createPromptComposer({
  textarea: document.getElementById("prompt-input"),
  chipsEl: document.getElementById("ref-chips"),
  refsListEl: document.getElementById("ref-list"),
  onReferencesChange: (refs) => collab?.sendPicks(refs),
});

collab = createCollab({
  getToken,
  getProjectId: () => projectId,
  getMeshOffset: () => meshCenterOffset,
  scene,
});
collab.setupLabels(viewport);

const promptHistory = createPromptHistoryUI({
  listEl: document.getElementById("prompt-history-list"),
  onReuse: (entry) => {
    const ta = document.getElementById("prompt-input");
    if (ta) {
      ta.value = entry.prompt;
      ta.focus();
    }
  },
});

async function refreshPromptHistory() {
  if (!projectId) {
    promptHistory.render([]);
    promptHistory.setCountBadge(0);
    return;
  }
  try {
    const data = await api(`/api/projects/${projectId}/prompt-history`);
    const entries = data.entries || [];
    promptHistory.render(entries);
    promptHistory.setCountBadge(entries.length);
  } catch {
    promptHistory.render([]);
    promptHistory.setCountBadge(0);
  }
}

const timeline = createTimelineUI(document.getElementById("timeline-panel"), {
  onSelect: (index) => restoreTimeline(index),
});

const objectHistory = createObjectHistoryUI({
  listEl: document.getElementById("object-history-list"),
  onHighlight: (index) => timeline.goToIndex(index, { preview: true }),
  onRestore: (index) => restoreTimeline(index),
});

const workspaceActivity = createWorkspaceActivityUI({
  listEl: document.getElementById("workspace-activity-list"),
});

const activityLog = createActivityLog(document.getElementById("activity-log-panel"), rawFetch);

const editTools = createEditTools({
  api,
  getState: () => ({
    projectId,
    selectedFile,
    composer,
    transformControls,
    controls,
  }),
  onStatus: (kind, text) => {
    const el = document.getElementById("edit-status");
    if (el) {
      el.className = `status ${kind}`;
      el.textContent = text;
    }
  },
  onApplied: async (data) => {
    selectedFile = data.filename;
    await refreshFiles();
    await loadModel(data.url, data.filename);
    await refreshTimeline();
    await refreshPromptHistory();
  },
});

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  collab?.resizeLabels();
}
window.addEventListener("resize", resize);
resize();

function animate() {
  requestAnimationFrame(animate);
  if (controls.enableDamping) controls.update();
  renderer.render(scene, camera);
  collab?.renderLabels(camera);
}
animate();

function clearModel() {
  if (currentMesh) {
    scene.remove(currentMesh);
    disposeStyledModel(currentMesh);
    currentMesh = null;
  }
  transformControls.detach();
  clearHover();
}

function centerAndMaterialize(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  meshCenterOffset = box.getCenter(new THREE.Vector3());
  object3d.position.sub(meshCenterOffset);
  applyCadStyle(object3d);
  positionShadowFloor(scene, object3d);
  return object3d;
}

function fitCamera() {
  if (!currentMesh) return;
  const box = new THREE.Box3().setFromObject(currentMesh);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  const dist = Math.max(size * 1.8, 0.15);
  camera.position.set(center.x + dist, center.y + dist * 0.6, center.z + dist);
  camera.lookAt(center);
  controls.update();
  controls.saveState();
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

async function loadModel(url, filename) {
  clearModel();
  const ext = filename.split(".").pop().toLowerCase();
  const path = _apiPath(url);
  const res = await rawFetch(path);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = data.detail;
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail) || res.statusText;
    throw new Error(`fetch for "${API}${path}" responded with ${res.status}: ${msg}`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  let object;
  try {
    if (ext === "stl") {
      const geo = new STLLoader().parse(await blob.arrayBuffer());
      object = new THREE.Mesh(geo);
    } else if (ext === "obj") {
      object = new OBJLoader().parse(await blob.text());
    } else if (ext === "glb" || ext === "gltf") {
      object = (await new GLTFLoader().loadAsync(blobUrl)).scene;
    } else {
      throw new Error(`Unsupported format: ${ext}`);
    }
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  currentMesh = centerAndMaterialize(object);
  scene.add(currentMesh);
  reapplyViewMode(currentMesh);
  transformControls.detach();
  controls.target.set(0, 0, 0);
  fitCamera();
  collab?.refreshAllRemote(currentMesh);
  const refs = composer.getReferences();
  if (refs?.length) collab?.sendPicks(refs);
}

async function rawFetch(path, options = {}, timeoutMs = 200000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = authHeaders(options.headers || {});
  try {
    return await fetch(`${API}${path}`, { ...options, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
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
      const msg = typeof detail === "string" ? detail : JSON.stringify(detail) || res.statusText;
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
      const msg = "Request timed out — is the server running? GPT-5.5 Pro can take 1–3 minutes.";
      activityLog.push({ level: "error", message: `✗ ${method} ${path} (timeout)`, duration_ms: ms, data: { error: msg } });
      throw new Error(msg);
    }
    if (err.message === "Failed to fetch") {
      const msg = "Cannot reach server. Start: source .venv/bin/activate && python run.py";
      activityLog.push({ level: "error", message: `✗ ${method} ${path}`, duration_ms: ms, data: { error: msg } });
      throw new Error(msg);
    }
    if (!err.message?.includes("[trace #")) {
      activityLog.push({ level: "error", message: `✗ ${method} ${path}`, duration_ms: ms, data: { error: err.message } });
    }
    throw err;
  }
}

function summarizeResponse(data) {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  if (out.actions) out.actions = `[${out.actions.length} ops]`;
  return out;
}

function saveLastProjectId(id) {
  try {
    localStorage.setItem(LS_LAST_PROJECT, id);
  } catch (_) {}
}

function getSelectedWorkspaceId() {
  return document.getElementById("team-select")?.value || allTeams[0]?.id || null;
}

async function fetchAllProjects() {
  const teamId = getSelectedWorkspaceId();
  const qs = teamId ? `?team_id=${encodeURIComponent(teamId)}` : "";
  const data = await api(`/api/projects${qs}`);
  allProjects = data.projects || [];
  await workspaceBrowser.refreshFolders();
  return allProjects;
}

const workspaceBrowser = createWorkspaceBrowser({
  container: document.getElementById("project-browser"),
  api,
  getWorkspaceId: getSelectedWorkspaceId,
  getProjects: () => allProjects,
  getActiveProjectId: () => projectId,
  onOpenProject: (id) => loadProject(id),
  onRenameProject: (p) => renameProject(p),
  onDeleteProject: (p) => deleteProject(p),
});

document.addEventListener("workspace-folders-changed", () => {
  refreshWorkspaceHistory();
  fetchAllProjects().then(() => renderProjectList());
});

function renderProjectList() {
  workspaceBrowser.render();
}

function setProjectHeader(name, id) {
  const el = document.getElementById("project-id");
  const btn = document.getElementById("btn-rename-project");
  if (!el) return;
  if (!id) {
    el.textContent = "—";
    if (btn) btn.disabled = true;
    return;
  }
  el.textContent = name && name !== id ? `${name} (${id})` : id;
  if (btn) btn.disabled = false;
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
    if (projectId === p.id) {
      setProjectHeader(data.name || trimmed, p.id);
    }
    await fetchAllProjects();
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

async function loadProject(id) {
  projectId = id;
  ribbon.setProjectId(id);
  saveLastProjectId(id);
  collab.connect(projectId, currentUser, {
    getMeshRoot: () => currentMesh,
    onModelReload: async (msg) => {
      if (msg.filename) {
        selectedFile = msg.filename;
        await refreshFiles();
        await loadModel(msg.url, msg.filename);
      }
      await refreshTimeline();
    },
    onTimeline: () => refreshTimeline(),
    onProjectHistory: () => refreshObjectHistory(),
    onWorkspaceUpdated: (msg) => {
      if (msg.entry) workspaceActivity.prependEntry(msg.entry);
      workspaceBrowser.refresh();
      fetchAllProjects().then(() => renderProjectList());
    },
  });
  const data = await api(`/api/projects/${id}`);
  setProjectHeader(data.name, id);
  timeline.setTimeline(data.timeline);
  await refreshPromptHistory();
  renderProjectList();
  const list = document.getElementById("file-list");
  list.innerHTML = "";
  for (const f of data.files || []) {
    const li = document.createElement("li");
    li.textContent = f.name;
    if (f.name === selectedFile) li.classList.add("active");
    li.addEventListener("click", async () => {
      selectedFile = f.name;
      list.querySelectorAll("li").forEach((el) => el.classList.remove("active"));
      li.classList.add("active");
      await loadModel(`/api/projects/${projectId}/files/${f.name}`, f.name);
    });
    list.appendChild(li);
  }
  const toLoad = data.latest_file || data.files?.[0]?.name;
  if (toLoad) {
    selectedFile = toLoad;
    list.querySelectorAll("li").forEach((el) => {
      el.classList.toggle("active", el.textContent === toLoad);
    });
    await loadModel(`/api/projects/${projectId}/files/${toLoad}`, toLoad);
  } else {
    selectedFile = null;
    clearModel();
  }
}

async function createNewProject() {
  const teamId = getSelectedWorkspaceId();
  if (!teamId) {
    alert("Create or select a workspace first.");
    return;
  }
  const qs = `?team_id=${encodeURIComponent(teamId)}`;
  const { project_id } = await api(`/api/projects${qs}`, { method: "POST" });
  projectId = project_id;
  ribbon.setProjectId(project_id);
  ribbon.reset();
  saveLastProjectId(project_id);
  selectedFile = null;
  clearModel();
  composer.clearReferences();
  resetRefCounter();
  await fetchAllProjects();
  await loadProject(project_id);
}

async function ensureProject() {
  if (projectId) { ribbon.setProjectId(projectId); return projectId; }
  await fetchAllProjects();
  const last = localStorage.getItem(LS_LAST_PROJECT);
  const match = allProjects.find((p) => p.id === last);
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

async function refreshTimeline() {
  if (!projectId) return;
  timelineData = await api(`/api/projects/${projectId}/timeline`);
  timeline.setTimeline(timelineData);
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

async function refreshFiles() {
  if (!projectId) await ensureProject();
  await fetchAllProjects();
  const data = await api(`/api/projects/${projectId}`);
  timeline.setTimeline(data.timeline);
  renderProjectList();
  const list = document.getElementById("file-list");
  list.innerHTML = "";
  for (const f of data.files || []) {
    const li = document.createElement("li");
    li.textContent = f.name;
    if (f.name === selectedFile) li.classList.add("active");
    li.addEventListener("click", async () => {
      selectedFile = f.name;
      list.querySelectorAll("li").forEach((el) => el.classList.remove("active"));
      li.classList.add("active");
      await loadModel(`/api/projects/${projectId}/files/${f.name}`, f.name);
    });
    list.appendChild(li);
  }
}

let restoringTimeline = false;
async function restoreTimeline(index) {
  if (restoringTimeline) return;
  restoringTimeline = true;
  try {
    const data = await api(`/api/projects/${projectId}/timeline/${index}`, { method: "POST" });
    selectedFile = data.filename;
    await loadModel(data.url, data.filename);
    await refreshTimeline();
    await refreshFiles();
    objectHistory.highlightActive(index);
  } finally {
    restoringTimeline = false;
  }
}

const PICK_HINTS = {
  corner: { title: "Pick corner", text: "Click a corner of the model — adds @corner-N to your prompt" },
  face: { title: "Pick face", text: "Click faces to add @face-N — click again to deselect. Multiple faces supported." },
  edge: { title: "Pick edge", text: "Click near an edge — adds @edge-N" },
  off: { title: "", text: "" },
};

function activatePickMode(mode) {
  setPickMode(mode);
  document.querySelectorAll(".pick-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  const isPick = mode !== "off";
  viewport.classList.toggle("pick-mode", isPick);
  controls.enabled = !isPick;
  if (isPick) {
    transformControls.detach();
    document.getElementById("btn-gizmo")?.classList.remove("active");
    viewportHint?.classList.remove("hidden");
    if (pickHintTitle) pickHintTitle.textContent = PICK_HINTS[mode]?.title || "Pick";
    if (pickHintText) pickHintText.textContent = PICK_HINTS[mode]?.text || "";
  } else {
    viewportHint?.classList.add("hidden");
    clearHover();
  }
}

document.querySelectorAll(".pick-btn").forEach((btn) => {
  btn.addEventListener("click", () => activatePickMode(btn.dataset.mode || "off"));
});

let pointerDownPos = null;
renderer.domElement.addEventListener("pointerdown", (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (getPickMode() === "off" || !currentMesh) return;
  updateHover(e, {
    camera,
    domElement: renderer.domElement,
    meshRoot: currentMesh,
    meshCenterOffset,
  });
});

renderer.domElement.addEventListener("click", (e) => {
  if (getPickMode() === "off" || !currentMesh) return;
  if (pointerDownPos) {
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (dx * dx + dy * dy > 36) return;
  }
  const result = pickGeometry(e, {
    camera,
    domElement: renderer.domElement,
    meshRoot: currentMesh,
    meshCenterOffset,
    references: composer.getReferences(),
  });
  if (!result) return;
  if (result.toggle === "remove") {
    composer.removeReference(result.ref.id);
  } else {
    composer.addReference(result.ref);
  }
  editTools.updateExtrudeTarget?.();
  clearHover();
});

document.getElementById("btn-gizmo").addEventListener("click", (e) => {
  const on = e.target.classList.toggle("active");
  if (on && currentMesh) {
    activatePickMode("off");
    controls.enabled = false;
    transformControls.attach(currentMesh);
  } else {
    transformControls.detach();
    controls.enabled = true;
  }
});

document.getElementById("btn-new-project").addEventListener("click", () => createNewProject());
document.getElementById("btn-rename-project")?.addEventListener("click", () => {
  if (!projectId) return;
  const p = allProjects.find((x) => x.id === projectId) || { id: projectId, name: projectId };
  renameProject(p);
});

document.getElementById("file-upload").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  await ensureProject();
  const form = new FormData();
  form.append("file", file);
  const res = await rawFetch(`/api/projects/${projectId}/upload`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : "Upload failed");
  }
  selectedFile = data.filename;
  await refreshFiles();
  await loadModel(data.url, data.filename);
  await refreshTimeline();
  e.target.value = "";
});

document.getElementById("btn-fit").addEventListener("click", fitCamera);
document.getElementById("btn-wireframe").addEventListener("click", (e) => {
  const wire = viewMode !== "wireframe";
  setViewMode(wire ? "wireframe" : "solid", currentMesh);
  e.target.classList.toggle("active", wire);
});
document.getElementById("btn-grid").addEventListener("click", (e) => {
  gridHelper.visible = !gridHelper.visible;
  e.target.classList.toggle("active", gridHelper.visible);
});

document.getElementById("btn-prompt").addEventListener("click", async () => {
  const prompt = composer.getPromptText();
  if (!prompt) return;
  await ensureProject();
  const status = document.getElementById("prompt-status");
  const reply = document.getElementById("prompt-reply");
  status.className = "status loading";
  status.textContent = "Generating with GPT-5.5 Pro… (may take 1–3 min)";
  reply.textContent = "";
  document.getElementById("btn-prompt").disabled = true;
  try {
    const body = {
      prompt,
      base_filename: selectedFile,
      references: composer.getReferences(),
    };
    const data = await api(`/api/projects/${projectId}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    status.className = "status ok";
    status.textContent = data.trace_id
      ? `Model ready · trace #${data.trace_id}`
      : "Model ready.";
    reply.textContent = data.message || "";
    if (data.trace?.ai?.raw_preview) {
      reply.textContent += `\n\n--- AI raw ---\n${data.trace.ai.raw_preview.slice(0, 800)}`;
    }
    // Notify the engineering panel (parts/joints/sim/DFM/downloads).
    window.dispatchEvent(new CustomEvent("render3d:model", { detail: { ...data, projectId } }));
    selectedFile = data.filename;
    await refreshFiles();
    await loadModel(data.url, data.filename);
    await refreshTimeline();
    await refreshPromptHistory();
    promptHistory.setTab("history");
  } catch (err) {
    status.className = "status error";
    status.textContent = err.message;
    await refreshPromptHistory();
    promptHistory.setTab("history");
  } finally {
    document.getElementById("btn-prompt").disabled = false;
  }
});

// ── Parametric ribbon ─────────────────────────────────────────────────────────
const ribbon = createRibbon({
  container: document.getElementById("ribbon-container"),
  apiFn: api,
  projectId: null,
  onBuilt: async (filename, url) => {
    selectedFile = filename;
    await refreshFiles();
    await loadModel(url, filename);
    await refreshTimeline();
  },
});

window.addEventListener("keydown", (e) => {
  if (e.target.matches("textarea, input")) return;
  if (e.key === "w" || e.key === "W") document.getElementById("btn-wireframe")?.click();
  if (e.key === "g") {
    document.getElementById("btn-gizmo").classList.add("active");
    if (currentMesh) transformControls.attach(currentMesh);
    transformControls.setMode("translate");
  }
  if (e.key === "r" && transformControls.object) transformControls.setMode("rotate");
  if (e.key === "s" && transformControls.object) transformControls.setMode("scale");
  if (e.key === "c" || e.key === "C") activatePickMode("corner");
  if (e.key === "f" || e.key === "F") activatePickMode("face");
  if (e.key === "e" || e.key === "E") activatePickMode("edge");
  if (e.key === "Escape") {
    activatePickMode("off");
    controls.enabled = true;
    transformControls.detach();
    document.getElementById("btn-gizmo")?.classList.remove("active");
  }
});

(async function init() {
  const auth = createAuthUI({
    api,
    onReady: async (data) => {
      currentUser = data.user;
      allTeams = data.teams || [];
      renderTeams();
      await startApp();
    },
  });

  async function startApp() {
    try {
      const health = await api("/api/health");
      if (!health.openai_configured) {
        document.getElementById("prompt-status").className = "status error";
        document.getElementById("prompt-status").textContent = "Set OPENAI_API_KEY in .env";
      } else {
        document.getElementById("prompt-status").className = "status ok";
        document.getElementById("prompt-status").textContent = `API key loaded · ${health.model}`;
      }
    } catch (err) {
      document.getElementById("prompt-status").className = "status error";
      document.getElementById("prompt-status").textContent = err.message;
    }
    await onWorkspaceChange();
    await ensureProject();
    activityLog.refreshServerDebounced();
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
    await fetchAllProjects();
    await refreshWorkspaceHistory();
    renderProjectList();
    const inWorkspace = allProjects.some((p) => p.id === projectId);
    if (!inWorkspace) {
      if (allProjects.length) {
        await loadProject(allProjects[0].id);
      } else {
        projectId = null;
        ribbon.setProjectId(null);
        setProjectHeader(null, null);
        clearModel();
        const list = document.getElementById("file-list");
        if (list) list.innerHTML = "";
      }
    }
  }

  function getActiveTeam() {
    const teamId = document.getElementById("team-select")?.value || allTeams[0]?.id;
    return allTeams.find((t) => t.id === teamId) || null;
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
    allTeams.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    const saved = localStorage.getItem(LS_LAST_WORKSPACE);
    if (saved && allTeams.some((t) => t.id === saved)) {
      sel.value = saved;
    } else if (allTeams.length) {
      sel.value = allTeams[0].id;
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
      ul.innerHTML = (data.members || [])
        .map((m) => `<li><strong>${escapeHtml(m.display_name)}</strong> <span class="muted">${escapeHtml(m.email)}</span></li>`)
        .join("");
    } catch {
      ul.innerHTML = "";
    }
  }

  document.getElementById("btn-create-workspace")?.addEventListener("click", async () => {
    const name = document.getElementById("workspace-name")?.value?.trim();
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
  if (session) {
    currentUser = session.user;
    allTeams = session.teams || [];
    renderTeams();
    await startApp();
  } else {
    const browser = document.getElementById("project-browser");
    if (browser) {
      browser.innerHTML = '<p class="muted small browser-empty">Sign in to view your projects</p>';
    }
    try {
      const health = await api("/api/health");
      if (health.openai_configured) {
        document.getElementById("prompt-status").className = "status ok";
        document.getElementById("prompt-status").textContent = `API key loaded · ${health.model}`;
      }
    } catch {
      /* health unavailable */
    }
  }
})();
