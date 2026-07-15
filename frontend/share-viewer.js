/** Public share viewer — rotate, section cut, mobile-friendly, downloads. */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { applyCadStyle, setupRenderer, setObjectTransparent as styleSetObjectTransparent } from "./scene-style.js?v=20260715-transparent-solid";
import { authHeaders, getToken } from "./auth.js?v=20260715-share-open-project";
import { createUrdfRobotRuntime } from "./urdf-robot-runtime.js?v=20260715-share-public-urdf";

const FORMAT_LABELS = {
  glb: "GLB",
  gltf: "GLTF",
  stl: "STL",
  step: "STEP",
  stp: "STEP",
  "3mf": "3MF",
  obj: "OBJ",
  ply: "PLY",
};

function tokenFromPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("share");
  return idx >= 0 ? decodeURIComponent(parts[idx + 1] || "") : "";
}

function isEmbedMode() {
  return new URLSearchParams(location.search).get("embed") === "1";
}

function isHeroEmbedMode() {
  const params = new URLSearchParams(location.search);
  return params.get("embed") === "1" && params.get("hero") === "1";
}

function $(id) {
  return document.getElementById(id);
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

function createSectionController({ renderer, scene, getBounds }) {
  let active = false;
  let axis = "Y";
  let offset = 0.5;
  let flipped = false;
  const plane = new THREE.Plane();
  const meshSides = new Map();
  const meshVisibility = new Map();

  function planeNormal() {
    const n = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[axis] || [0, 1, 0];
    const s = flipped ? 1 : -1;
    return new THREE.Vector3(n[0] * s, n[1] * s, n[2] * s);
  }

  function apply() {
    if (!active) return;
    const box = getBounds();
    const mn = { X: box.min.x, Y: box.min.y, Z: box.min.z }[axis];
    const mx = { X: box.max.x, Y: box.max.y, Z: box.max.z }[axis];
    const pos = mn + offset * (mx - mn);
    const posVec = {
      X: new THREE.Vector3(pos, 0, 0),
      Y: new THREE.Vector3(0, pos, 0),
      Z: new THREE.Vector3(0, 0, pos),
    }[axis];
    plane.normal.copy(planeNormal());
    plane.constant = -plane.normal.dot(posVec);
    renderer.clippingPlanes = [plane];
    renderer.localClippingEnabled = true;
  }

  function setMeshSides(on) {
    scene.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      if (obj.userData?.isSilhouette) {
        if (on) {
          if (!meshVisibility.has(obj)) meshVisibility.set(obj, obj.visible);
          obj.visible = false;
        } else if (meshVisibility.has(obj)) {
          obj.visible = meshVisibility.get(obj);
        }
        return;
      }
      if (obj.userData?.isEdge) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      if (on) {
        if (!meshSides.has(obj)) meshSides.set(obj, mats.map((m) => m?.side));
        mats.forEach((m) => {
          if (!m) return;
          m.side = THREE.DoubleSide;
          m.needsUpdate = true;
        });
      } else if (meshSides.has(obj)) {
        const prev = meshSides.get(obj);
        mats.forEach((m, i) => {
          if (!m) return;
          m.side = prev[i] ?? THREE.FrontSide;
          m.needsUpdate = true;
        });
      }
    });
    if (!on) {
      meshSides.clear();
      meshVisibility.clear();
    }
  }

  return {
    isActive: () => active,
    activate() {
      if (active) return;
      active = true;
      setMeshSides(true);
      apply();
    },
    deactivate() {
      if (!active) return;
      active = false;
      renderer.clippingPlanes = [];
      renderer.localClippingEnabled = false;
      setMeshSides(false);
    },
    setAxis(next) {
      axis = String(next || "Y").toUpperCase();
      apply();
    },
    setOffset(t) {
      offset = Math.max(0, Math.min(1, Number(t) || 0));
      apply();
    },
    flip() {
      flipped = !flipped;
      apply();
    },
    refresh: apply,
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

async function main() {
  const token = tokenFromPath();
  const embed = isEmbedMode();
  const heroEmbed = isHeroEmbedMode();
  if (embed) {
    document.documentElement.classList.add("share-embed");
    document.body.classList.add("share-embed");
  }
  if (heroEmbed) {
    document.documentElement.classList.add("share-hero");
    document.body.classList.add("share-hero");
  }
  const titleEl = $("share-title");
  const subEl = $("share-subtitle");
  const statusEl = $("share-status");
  const downloadsEl = $("share-downloads");
  const downloadMenuEl = $("share-download-menu");
  const btnDownloadPopup = $("btn-share-download-menu");
  const timelineTrackEl = $("share-timeline-track");
  const viewerEl = $("share-viewer");
  const sectionPanel = $("share-section-panel");
  const btnSection = $("btn-share-section");
  const btnRotate = $("btn-share-rotate");
  const btnFit = $("btn-share-fit");
  const btnInspector = $("btn-share-inspector");
  const btnHistory = $("btn-share-history");
  const btnWireframe = $("btn-share-wireframe");
  const btnTransparent = $("btn-share-transparent");
  const btnOpen = $("btn-share-open");
  const btnDownloadMenu = $("btn-share-download");
  const downloadSheet = $("share-download-sheet");
  const remixModal = $("share-remix-modal");
  const remixProjectSelect = $("share-remix-project-select");
  const remixShareBack = $("share-remix-share-back");
  const remixCollab = $("share-remix-collab");
  const remixCollabLabel = $("share-remix-collab-label");
  const remixStatus = $("share-remix-status");
  const btnRemixConfirm = $("btn-share-remix-confirm");
  const inspectorPanel = $("share-inspector-panel");
  const inspectorTitle = $("share-inspector-title");
  const panelPartsEl = $("share-panel-parts");
  const panelHistoryEl = $("share-panel-history");
  const promptHistoryEl = $("share-prompt-history");
  const componentListEl = $("share-component-list");
  const transparentTip = $("share-transparent-tip");
  const btnTransparentTipClose = $("btn-share-transparent-tip-close");
  const motionCard = $("share-motion-card");
  const motionStatus = $("share-motion-status");
  const btnMotionPlay = $("btn-share-motion-play");
  const btnMotionReset = $("btn-share-motion-reset");
  const jointListEl = $("share-joint-list");
  let robotRuntime = null;

  if (!token) {
    statusEl.textContent = "Invalid share link.";
    return;
  }

  let meta;
  try {
    const res = await fetch(`/api/share/${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error(res.status === 404 ? "Share link not found" : "Could not load share");
    meta = await res.json();
  } catch (err) {
    statusEl.textContent = err.message || "Share link not found";
    return;
  }

  document.title = meta.share_title || `${meta.project_name || "Render3D"} · with Render3D`;
  titleEl.textContent = meta.project_name || meta.filename || "Shared model";
  subEl.textContent = meta.filename
    ? `with Render3D · ${meta.filename}`
    : "with Render3D";

  const exportItems = Array.isArray(meta.exports) ? [...meta.exports] : [];
  const seen = new Set(exportItems.map((e) => e.name));
  if (meta.filename && !seen.has(meta.filename)) {
    exportItems.unshift({
      name: meta.filename,
      format: (meta.filename.split(".").pop() || "file").toLowerCase(),
      url: `/api/share/${encodeURIComponent(token)}/files/${encodeURIComponent(meta.filename)}`,
      size: null,
    });
  }

  function absoluteFileUrl(pathOrUrl) {
    if (!pathOrUrl) return "";
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `${window.location.origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  }

  function detectClientOs() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    if (/Mac|iPhone|iPad|iPod/i.test(ua) || /Mac/i.test(platform)) return "macos";
    if (/Win/i.test(ua) || /Win/i.test(platform)) return "windows";
    if (/Linux|X11|CrOS/i.test(ua)) return "linux";
    return "windows";
  }

  function bambuStudioOpenUrls(fileUrl) {
    const encoded = encodeURIComponent(fileUrl);
    return {
      windows: `bambustudio://open?file=${encoded}`,
      linux: `bambustudio://open?file=${encoded}`,
      macos: `bambustudioopen://${fileUrl}`,
    };
  }

  function findThreeMfExport() {
    return exportItems.find((item) => String(item.format || "").toLowerCase() === "3mf")
      || exportItems.find((item) => /\.3mf$/i.test(item.name || ""));
  }

  function openInBambuStudio() {
    const threeMf = findThreeMfExport();
    if (!threeMf?.url) {
      setStatus("No 3MF export is available for Bambu Studio yet.");
      return;
    }
    const fileUrl = absoluteFileUrl(threeMf.url);
    const urls = bambuStudioOpenUrls(fileUrl);
    const os = detectClientOs();
    window.location.href = urls[os] || urls.windows;
  }

  function renderDownloadMenu(into) {
    if (!into) return;
    into.innerHTML = "";
    if (!exportItems.length) {
      into.innerHTML = `<p class="muted" style="padding:8px 10px">No downloadable formats yet.</p>`;
      return;
    }
    for (const item of exportItems) {
      const a = document.createElement("a");
      a.className = "share-dl-menu-item";
      a.href = item.url;
      a.download = item.name;
      a.rel = "noopener";
      a.setAttribute("role", "menuitem");
      const label = FORMAT_LABELS[String(item.format || "").toLowerCase()]
        || String(item.format || "File").toUpperCase();
      a.innerHTML = `<strong>${label}</strong><span>${item.size != null ? formatBytes(item.size) : item.name}</span>`;
      into.appendChild(a);
    }
    const threeMf = findThreeMfExport();
    if (threeMf) {
      const sep = document.createElement("div");
      sep.className = "share-dl-menu-sep";
      into.appendChild(sep);
      const bambu = document.createElement("button");
      bambu.type = "button";
      bambu.className = "share-dl-menu-item share-dl-menu-item--bambu";
      bambu.setAttribute("role", "menuitem");
      bambu.innerHTML = `<strong>Import to Bambu</strong><span>Open 3MF in Bambu Studio</span>`;
      bambu.addEventListener("click", () => {
        setDownloadMenuOpen(false);
        openInBambuStudio();
      });
      into.appendChild(bambu);
    }
  }

  function setDownloadMenuOpen(open) {
    downloadMenuEl?.classList.toggle("hidden", !open);
    btnDownloadPopup?.setAttribute("aria-expanded", String(!!open));
    btnDownloadPopup?.classList.toggle("active", !!open);
  }

  function renderDownloads(into) {
    renderDownloadMenu(into);
  }

  renderDownloadMenu(downloadMenuEl);
  renderDownloadMenu($("share-download-list"));
  if (downloadsEl) downloadsEl.innerHTML = "";

  function renderTimeline() {
    if (!timelineTrackEl) return;
    const rows = Array.isArray(meta.prompt_history) ? [...meta.prompt_history] : [];
    rows.reverse();
    if (!rows.length) {
      timelineTrackEl.innerHTML = `<p class="share-timeline-empty">No timeline edits for this share yet.</p>`;
      return;
    }
    timelineTrackEl.innerHTML = rows.map((entry, index) => {
      const prompt = entry.original_prompt || entry.prompt || "Edit";
      const short = prompt.length > 42 ? `${prompt.slice(0, 42)}…` : prompt;
      const when = formatDateLabel(entry.created_at);
      const status = entry.success === false ? "Failed" : "Built";
      return `
        <button type="button" class="share-timeline-chip" data-prompt-id="${escapeHtml(entry.id || "")}" data-timeline-index="${index}">
          <strong>${escapeHtml(short)}</strong>
          <span>${escapeHtml(status)}${when ? ` · ${escapeHtml(when)}` : ""}</span>
        </button>
      `;
    }).join("");
  }

  const scene = new THREE.Scene();
  const heroEmbedActive = isHeroEmbedMode();
  // Match Getting Started / Docs page canvas (#0d1117) so the hero iframe
  // does not flash a lighter share-page background behind the arm.
  scene.background = new THREE.Color(heroEmbedActive ? 0x0d1117 : 0x070b12);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  // CAD / share meshes are Z-up — match the main studio.
  camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  if (heroEmbedActive) {
    renderer.setClearColor(0x0d1117, 1);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  setupRenderer(renderer);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  if (heroEmbedActive) renderer.domElement.style.background = "#0d1117";
  viewerEl.appendChild(renderer.domElement);

  // Z-up Orbit with full polar range = true 360° tumble (no horizon clip, no trackball roll).
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 1.05;
  controls.panSpeed = 0.75;
  controls.enablePan = !heroEmbedActive;
  controls.enableZoom = !heroEmbedActive;
  controls.minPolarAngle = 0.001;
  controls.maxPolarAngle = Math.PI - 0.001;
  controls.autoRotate = true;
  controls.autoRotateSpeed = heroEmbedActive ? 0.85 : (isEmbedMode() ? 0.55 : 1.35);
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  // Match studio balanced CAD lighting.
  scene.add(new THREE.HemisphereLight(0xf4f7fb, 0x556274, 0.88));
  scene.add(new THREE.AmbientLight(0xe6eef6, 0.48));
  const key = new THREE.DirectionalLight(0xfff5ec, 1.12);
  key.position.set(5, -5, 9);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd9e7ff, 0.74);
  fill.position.set(-6, 5, 5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xc5d6ea, 0.52);
  rim.position.set(1, 8, -7);
  scene.add(rim);
  const under = new THREE.DirectionalLight(0xe4eef8, 0.58);
  under.position.set(0, 0, -9);
  scene.add(under);

  const root = new THREE.Group();
  scene.add(root);
  let modelBox = new THREE.Box3();
  let orbitRadius = 2;
  let loadedScene = null;
  const objectsByName = new Map();
  const objectsById = new Map();
  let objectEntries = [];
  const transparentObjects = new Set();
  let wireframeEnabled = false;
  let transparentPickEnabled = false;
  let remixProjectsLoaded = false;
  let remixProjectsLoading = false;

  const section = createSectionController({
    renderer,
    scene,
    getBounds: () => modelBox.clone(),
  });

  function syncCameraClip() {
    const dist = camera.position.distanceTo(controls.target);
    // Keep near plane relative to distance so underside views don't eat the mesh.
    camera.near = Math.max(Math.min(dist / 100, dist * 0.015), 0.01);
    camera.far = Math.max(dist * 40, orbitRadius * 50, 200);
    camera.updateProjectionMatrix();
  }

  function frameBox(box, { pad = 1.32 } = {}) {
    if (!box || box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1e-3);
    const fov = THREE.MathUtils.degToRad(camera.fov || 45);
    const aspect = Math.max(camera.aspect || 1, 0.1);
    const fitHeightDistance = radius / Math.sin(fov / 2);
    const fitWidthDistance = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    orbitRadius = Math.max(fitHeightDistance, fitWidthDistance) * pad;
    const yaw = Math.PI * 0.22;
    camera.up.set(0, 0, 1);
    camera.position.set(
      orbitRadius * Math.cos(yaw),
      -orbitRadius * Math.sin(yaw),
      orbitRadius * 0.32,
    );
    controls.target.copy(sphere.center);
    controls.minDistance = Math.max(radius * 0.25, 0.01);
    controls.maxDistance = Math.max(orbitRadius * 24, radius * 80, 50);
    syncCameraClip();
    controls.update();
    section.refresh();
  }

  function fitCamera() {
    root.position.set(0, 0, 0);
    modelBox.setFromObject(root);
    if (modelBox.isEmpty()) return;
    const center = modelBox.getCenter(new THREE.Vector3());
    // Center on origin so orbiting under the model stays stable.
    root.position.set(-center.x, -center.y, -center.z);
    modelBox.setFromObject(root);
    frameBox(modelBox, { pad: heroEmbedActive ? 1.08 : 1.38 });
    if (heroEmbedActive) {
      // Seat the arm lower in the frame so it reads as sitting in the page.
      controls.target.z -= orbitRadius * 0.04;
      camera.position.z *= 0.92;
      syncCameraClip();
      controls.update();
    }
  }

  function frameObject(obj) {
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    frameBox(box, { pad: 1.6 });
  }

  function meshMaterials(mesh) {
    if (!mesh?.material) return [];
    if (!mesh.userData?._shareUniqueMaterial) {
      if (!mesh.userData) mesh.userData = {};
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((mat) => mat?.clone?.() || mat)
        : mesh.material?.clone?.() || mesh.material;
      mesh.userData._shareUniqueMaterial = true;
    }
    return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  }

  function objectMeshes(obj) {
    const meshes = [];
    obj?.traverse?.((child) => {
      if (!child.isMesh || child.userData?.isEdge || child.userData?.isSilhouette) return;
      meshes.push(child);
    });
    return meshes;
  }

  function syncObjectMaterialState(obj) {
    objectMeshes(obj).forEach((mesh) => meshMaterials(mesh));
    styleSetObjectTransparent(obj, transparentObjects.has(obj), { wireframe: wireframeEnabled });
  }

  function setObjectTransparent(obj, on) {
    if (!obj) return;
    if (on) transparentObjects.add(obj);
    else transparentObjects.delete(obj);
    syncObjectMaterialState(obj);
    renderComponentTree();
  }

  function clearTransparentObjects() {
    const targets = [...transparentObjects];
    transparentObjects.clear();
    targets.forEach(syncObjectMaterialState);
    renderComponentTree();
  }

  function syncWireframe() {
    // Clone shared mats once, then restyle whole tree and re-assert transparent roots.
    objectMeshes(root).forEach((mesh) => meshMaterials(mesh));
    styleSetObjectTransparent(root, false, { wireframe: wireframeEnabled });
    for (const target of transparentObjects) {
      styleSetObjectTransparent(target, true, { wireframe: wireframeEnabled });
    }
    btnWireframe?.classList.toggle("active", wireframeEnabled);
    btnWireframe?.setAttribute("aria-pressed", String(wireframeEnabled));
  }

  function isDescendantOf(obj, target) {
    let cur = obj;
    while (cur) {
      if (cur === target) return true;
      cur = cur.parent;
    }
    return false;
  }

  function isolateObject(target) {
    objectMeshes(root).forEach((mesh) => {
      mesh.visible = !target || isDescendantOf(mesh, target);
    });
    if (target) frameObject(target);
  }

  function allPickableMeshes() {
    return objectMeshes(root).filter((mesh) => mesh.visible !== false);
  }

  function closestTransparentTarget(mesh) {
    let cur = mesh;
    while (cur && cur !== root) {
      if (objectEntries.some((entry) => entry.obj === cur) && objectMeshes(cur).length) return cur;
      cur = cur.parent;
    }
    return mesh;
  }

  function objectDepth(obj) {
    let depth = 0;
    let cur = obj?.parent;
    while (cur && cur !== root && cur !== loadedScene) {
      if (String(cur.name || "").trim()) depth += 1;
      cur = cur.parent;
    }
    return Math.min(depth, 5);
  }

  function parentLabel(obj) {
    let cur = obj?.parent;
    while (cur && cur !== root && cur !== loadedScene) {
      const label = String(cur.name || "").trim();
      if (label) return label;
      cur = cur.parent;
    }
    return meta.filename || "Shared model";
  }

  function resize() {
    const w = viewerEl.clientWidth || window.innerWidth;
    const h = viewerEl.clientHeight || Math.max(320, window.innerHeight - 120);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function setStatus(msg) {
    if (!msg) {
      statusEl.classList.add("hidden");
      statusEl.textContent = "";
      return;
    }
    statusEl.classList.remove("hidden");
    statusEl.textContent = msg;
  }

  function setTransparentTipVisible(on) {
    transparentTip?.classList.toggle("hidden", !on);
  }

  function modelLabel(item = {}) {
    const provider = item.provider ? String(item.provider).toUpperCase() : "";
    const model = item.model || item.ai_model || "";
    return [provider, model].filter(Boolean).join(" · ") || "Model not recorded";
  }

  function formatDateLabel(raw) {
    if (!raw) return "";
    try {
      return new Date(raw).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return String(raw);
    }
  }

  function renderShareDetails() {
    if (!promptHistoryEl) return;
    const rows = Array.isArray(meta.prompt_history) ? meta.prompt_history : [];
    if (!rows.length) {
      promptHistoryEl.innerHTML = `<p class="sv-hint">No prompt history was recorded for this shared model.</p>`;
      return;
    }
    promptHistoryEl.innerHTML = rows.map((entry) => {
      const prompt = entry.original_prompt || entry.prompt || "Prompt unavailable";
      const file = entry.filename || entry.base_filename || "";
      const when = formatDateLabel(entry.created_at);
      const who = entry.user_name || "";
      const avatar = entry.user_avatar_url
        ? `<span class="sv-avatar" style="background-image:url('${escapeHtml(entry.user_avatar_url)}')"></span>`
        : who
          ? `<span class="sv-avatar sv-avatar--initial">${escapeHtml(who.trim().charAt(0).toUpperCase() || "?")}</span>`
          : "";
      const status = entry.success === false ? "Failed" : "Built";
      const fileUrl = file
        ? `/api/share/${encodeURIComponent(token)}/files/${encodeURIComponent(file)}`
        : "";
      return `
        <article class="sv-history-card" data-prompt-id="${escapeHtml(entry.id || "")}">
          ${who ? `<div class="sv-history-who">${avatar}<span>Generated by <strong>${escapeHtml(who)}</strong></span></div>` : ""}
          <strong>${escapeHtml(prompt)}</strong>
          <div class="sv-history-meta">${escapeHtml(modelLabel(entry))}${entry.speed ? ` · ${escapeHtml(entry.speed)}` : ""} · ${escapeHtml(status)}${when ? ` · ${escapeHtml(when)}` : ""}</div>
          ${fileUrl ? `
            <details class="sv-history-built">
              <summary>Built component</summary>
              <a href="${escapeHtml(fileUrl)}" download="${escapeHtml(file)}">${escapeHtml(file)}</a>
            </details>
          ` : ""}
        </article>
      `;
    }).join("");
  }

  resize();

  const viewerUrl = meta.viewer_url
    || (meta.viewer_filename
      ? `/api/share/${encodeURIComponent(token)}/files/${encodeURIComponent(meta.viewer_filename)}`
      : "");
  const canPreview = /\.glb$/i.test(meta.viewer_filename || viewerUrl || "");

  function renderComponentTree() {
    if (!componentListEl) return;
    const browserComponents = Array.isArray(meta.browser?.components) ? meta.browser.components : [];
    const rows = [];
    objectsByName.clear();
    objectsById.clear();
    objectEntries = [];
    if (loadedScene) {
      loadedScene.traverse((obj) => {
        if (!obj.isMesh) return;
        const label = String(obj.name || "").trim();
        if (label && !objectsByName.has(label)) objectsByName.set(label, obj);
      });
    }
    let serial = 0;
    const addRow = (row) => {
      const id = row.obj ? `obj-${++serial}` : `meta-${++serial}`;
      const item = { ...row, id };
      rows.push(item);
      if (row.obj) {
        objectEntries.push(item);
        objectsById.set(id, row.obj);
      }
    };
    for (const item of browserComponents) {
      const name = item.name || item.filename || item.stem || item.label;
      if (!name) continue;
      const obj = objectsByName.get(name) || objectsByName.get(item.viewer_filename) || null;
      addRow({
        label: PathBasename(name),
        kind: "part",
        obj,
        depth: obj ? objectDepth(obj) : 0,
      });
    }
    if (!rows.length && loadedScene) {
      objectsByName.forEach((obj, label) => {
        addRow({
          label: PathBasename(label),
          kind: "part",
          obj,
          depth: objectDepth(obj),
        });
      });
    }
    const unique = [];
    const seenRows = new Set();
    for (const row of rows) {
      const key = row.label.toLowerCase();
      if (seenRows.has(key)) continue;
      seenRows.add(key);
      unique.push(row);
      if (unique.length >= 80) break;
    }
    if (!unique.length) {
      componentListEl.innerHTML = `<p class="sv-hint">No parts found in this share.</p>`;
      return;
    }
    componentListEl.innerHTML = unique.map((row) => {
      const canAct = !!row.obj;
      const isTransparent = canAct && transparentObjects.has(row.obj);
      const depth = Math.max(0, Math.min(5, Number(row.depth) || 0));
      return `
        <div class="sv-tree-node${isTransparent ? " is-transparent" : ""}" style="--depth:${depth}">
          <button type="button" class="sv-tree-btn" data-action="frame" data-target="${escapeHtml(row.id)}">
            <span class="sv-tree-glyph" aria-hidden="true">P</span>
            <span class="sv-tree-main">
              <strong>${escapeHtml(row.label)}</strong>
            </span>
          </button>
          ${canAct ? `
            <div class="sv-tree-actions">
              <button type="button" class="sv-mini-btn" data-action="only" data-target="${escapeHtml(row.id)}" title="Show only this part">Only</button>
              <button type="button" class="sv-mini-btn${isTransparent ? " active" : ""}" data-action="transparent" data-target="${escapeHtml(row.id)}" title="Toggle transparency">
                ${isTransparent ? "Solid" : "Fade"}
              </button>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");
  }

  function PathBasename(name) {
    const raw = String(name || "");
    const parts = raw.split(/[\\/]/);
    return parts[parts.length - 1] || raw;
  }

  function renderJointSliders(runtime) {
    if (!jointListEl) return;
    const state = runtime?.getState?.();
    const joints = (state?.urdf?.joints || []).filter((joint) => {
      const type = String(joint.type || "").toLowerCase();
      return type === "revolute" || type === "continuous" || type === "prismatic";
    });
    if (!joints.length) {
      jointListEl.innerHTML = `<p class="sv-hint">No movable joints in this URDF.</p>`;
      return;
    }
    const values = state.jointValuesRad || {};
    jointListEl.innerHTML = joints.map((joint) => {
      const lower = Number.isFinite(Number(joint.lower)) ? Number(joint.lower) : -Math.PI;
      const upper = Number.isFinite(Number(joint.upper)) ? Number(joint.upper) : Math.PI;
      const value = Number.isFinite(Number(values[joint.name])) ? Number(values[joint.name]) : 0;
      const isPrism = String(joint.type || "").toLowerCase() === "prismatic";
      const display = isPrism ? value.toFixed(3) : `${((value * 180) / Math.PI).toFixed(0)}°`;
      return `
        <div class="sv-joint-row" data-joint="${escapeHtml(joint.name)}">
          <label>${escapeHtml(joint.name)} <small style="color:var(--muted)">${escapeHtml(joint.type || "")}</small></label>
          <input type="range" min="${lower}" max="${upper}" step="${isPrism ? 0.001 : 0.01}" value="${value}" data-joint-slider="${escapeHtml(joint.name)}" />
          <em data-joint-value>${display}</em>
        </div>
      `;
    }).join("");
  }

  renderShareDetails();
  renderTimeline();

  async function loadSharedRobot() {
    const artifacts = Array.isArray(meta.robot?.artifacts) ? meta.robot.artifacts : [];
    const urdf = artifacts.find((item) => /\.urdf$/i.test(item.name || ""));
    const srdf = artifacts.find((item) => /\.srdf$/i.test(item.name || ""));
    if (!urdf || !motionCard) return;
    motionCard.classList.remove("hidden");
    if (motionStatus) motionStatus.textContent = "Loading URDF motion…";
    try {
      robotRuntime = createUrdfRobotRuntime({ scene });
      await robotRuntime.loadFromUrls({
        urdfUrl: urdf.url,
        urdfFile: urdf.name,
        srdfUrl: srdf?.url || null,
        srdfFile: srdf?.name || null,
        resolveFileUrl: (name) => `/api/share/${encodeURIComponent(token)}/files/${encodeURIComponent(name)}`,
      });
      const state = robotRuntime.getState();
      const movable = (state.urdf?.joints || []).filter((joint) => !/fixed/i.test(joint.type || "")).length;
      if (motionStatus) motionStatus.textContent = `${state.urdf?.name || "Robot"} · ${movable} joints`;
      renderJointSliders(robotRuntime);
      btnMotionPlay?.addEventListener("click", () => {
        const playing = robotRuntime.togglePlay({ durationSec: 4.2 });
        btnMotionPlay.textContent = playing ? "Stop" : "Play";
      });
      btnMotionReset?.addEventListener("click", () => {
        robotRuntime.resetPose?.();
        renderJointSliders(robotRuntime);
        if (btnMotionPlay) btnMotionPlay.textContent = "Play";
      });
      jointListEl?.addEventListener("input", (event) => {
        const input = event.target.closest("[data-joint-slider]");
        if (!input || !robotRuntime) return;
        const name = input.getAttribute("data-joint-slider");
        const value = Number(input.value);
        robotRuntime.setJointValue(name, value);
        const row = input.closest(".sv-joint-row");
        const joint = (robotRuntime.getState()?.urdf?.joints || []).find((j) => j.name === name);
        const isPrism = String(joint?.type || "").toLowerCase() === "prismatic";
        const label = row?.querySelector("[data-joint-value]");
        if (label) label.textContent = isPrism ? value.toFixed(3) : `${((value * 180) / Math.PI).toFixed(0)}°`;
      });
    } catch (err) {
      if (motionStatus) motionStatus.textContent = err?.message || "Could not load URDF motion.";
    }
  }

  if (!canPreview) {
    setStatus("3D preview needs a GLB. Use Download for available formats.");
  } else {
    setStatus("Loading model…");
    await new Promise((resolve) => {
      new GLTFLoader().load(
        viewerUrl,
        (gltf) => {
          root.clear();
          loadedScene = gltf.scene;
          root.add(loadedScene);
          applyCadStyle(root);
          fitCamera();
          renderComponentTree();
          loadSharedRobot();
          setStatus("");
          resolve();
        },
        undefined,
        () => {
          setStatus("Could not load preview. Downloads still work below.");
          resolve();
        },
      );
    });
  }
  if (!loadedScene) {
    renderComponentTree();
    loadSharedRobot();
  }

  function setAutoRotate(on) {
    controls.autoRotate = Boolean(on);
    btnRotate?.classList.toggle("active", controls.autoRotate);
    btnRotate?.setAttribute("aria-pressed", String(controls.autoRotate));
  }

  btnRotate?.addEventListener("click", () => {
    setAutoRotate(!controls.autoRotate);
  });
  setAutoRotate(true);

  btnFit?.addEventListener("click", () => {
    fitCamera();
  });

  btnWireframe?.addEventListener("click", () => {
    wireframeEnabled = !wireframeEnabled;
    syncWireframe();
  });

  btnTransparent?.addEventListener("click", () => {
    transparentPickEnabled = !transparentPickEnabled;
    controls.enabled = true;
    renderer.domElement.style.cursor = transparentPickEnabled ? "copy" : "";
    if (transparentPickEnabled) setAutoRotate(false);
    btnTransparent.classList.toggle("active", transparentPickEnabled);
    btnTransparent.setAttribute("aria-pressed", String(transparentPickEnabled));
    setTransparentTipVisible(transparentPickEnabled);
  });
  btnTransparentTipClose?.addEventListener("click", () => setTransparentTipVisible(false));

  function setRemixStatus(message = "", cls = "") {
    if (!remixStatus) return;
    remixStatus.textContent = message;
    remixStatus.className = `share-remix-status${cls ? ` ${cls}` : ""}`;
  }

  function selectedRemixTarget() {
    return remixModal?.querySelector('input[name="share-remix-target"]:checked')?.value || "new";
  }

  function syncRemixTargetUi() {
    const existing = selectedRemixTarget() === "existing";
    if (remixProjectSelect) remixProjectSelect.disabled = !existing;
    remixCollab?.classList.toggle("hidden", existing || !meta.shared_by?.id);
    if (existing && remixShareBack) remixShareBack.checked = false;
  }

  async function loadRemixProjects() {
    if (remixProjectsLoaded || remixProjectsLoading || !remixProjectSelect) return;
    remixProjectsLoading = true;
    remixProjectSelect.innerHTML = `<option value="">Loading projects…</option>`;
    try {
      const res = await fetch("/api/projects", { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Could not load projects");
      const projects = (Array.isArray(data.projects) ? data.projects : [])
        .filter((p) => p?.id && p.folder_id !== "__public__");
      remixProjectSelect.innerHTML = projects.length
        ? `<option value="">Choose a project…</option>${projects.map((p) => `
          <option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}${p.folder_name ? ` · ${escapeHtml(p.folder_name)}` : ""}</option>
        `).join("")}`
        : `<option value="">No editable projects found</option>`;
      remixProjectsLoaded = true;
    } catch (err) {
      remixProjectSelect.innerHTML = `<option value="">Could not load projects</option>`;
      setRemixStatus(err?.message || "Could not load projects.", "error");
    } finally {
      remixProjectsLoading = false;
    }
  }

  function openRemixModal() {
    if (!getToken()) {
      location.href = `/?open_share=${encodeURIComponent(token)}`;
      return;
    }
    const sharer = meta.shared_by;
    if (remixCollabLabel && sharer?.id) {
      remixCollabLabel.textContent = `Create a collaboration workspace with ${sharer.display_name || sharer.email || "the original sharer"} for this new remix.`;
    }
    setRemixStatus("");
    remixModal?.classList.remove("hidden");
    syncRemixTargetUi();
    void loadRemixProjects();
  }

  function closeRemixModal() {
    remixModal?.classList.add("hidden");
    setRemixStatus("");
  }

  remixModal?.querySelectorAll('input[name="share-remix-target"]').forEach((input) => {
    input.addEventListener("change", syncRemixTargetUi);
  });
  remixModal?.querySelectorAll("[data-remix-close]").forEach((btn) => {
    btn.addEventListener("click", closeRemixModal);
  });
  remixModal?.addEventListener("click", (event) => {
    if (event.target === remixModal) closeRemixModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !remixModal?.classList.contains("hidden")) {
      closeRemixModal();
    }
  });

  btnOpen?.addEventListener("click", openRemixModal);

  btnRemixConfirm?.addEventListener("click", async () => {
    if (!getToken()) {
      location.href = `/?open_share=${encodeURIComponent(token)}`;
      return;
    }
    const targetMode = selectedRemixTarget();
    const targetProjectId = targetMode === "existing" ? (remixProjectSelect?.value || "") : "";
    if (targetMode === "existing" && !targetProjectId) {
      setRemixStatus("Choose a project to import into.", "error");
      return;
    }
    const originalText = btnRemixConfirm.textContent;
    btnRemixConfirm.disabled = true;
    btnRemixConfirm.textContent = "Remixing…";
    setRemixStatus(targetMode === "existing" ? "Importing shared files into project…" : "Creating editable remix project…");
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}/open-in-project`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          share_with_sharer: targetMode === "new" && !!remixShareBack?.checked,
          target_project_id: targetProjectId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Could not remix project");
      location.href = data.url || `/?project=${encodeURIComponent(data.project_id)}`;
    } catch (err) {
      setRemixStatus(err?.message || "Could not remix this share into a project.", "error");
      btnRemixConfirm.disabled = false;
      btnRemixConfirm.textContent = originalText;
    }
  });

  function syncInspectorUi(on, focus = "components") {
    btnInspector?.classList.toggle("active", on);
    btnInspector?.setAttribute("aria-pressed", String(on));
    btnHistory?.classList.toggle("active", on && focus === "history");
    btnHistory?.setAttribute("aria-pressed", String(on && focus === "history"));
    inspectorPanel?.classList.toggle("hidden", !on);
    if (inspectorTitle) inspectorTitle.textContent = focus === "history" ? "Prompt history" : "Part Tree";
    if (on) {
      renderShareDetails();
      renderComponentTree();
      if (focus === "history") {
        promptHistoryEl?.scrollIntoView({ block: "nearest" });
      }
    }
  }

  btnInspector?.addEventListener("click", () => {
    syncInspectorUi(inspectorPanel?.classList.contains("hidden"), "components");
  });
  btnHistory?.addEventListener("click", () => {
    syncInspectorUi(inspectorPanel?.classList.contains("hidden") || !btnHistory.classList.contains("active"), "history");
  });
  inspectorPanel?.querySelector("#btn-share-inspector-close")?.addEventListener("click", () => syncInspectorUi(false));
  componentListEl?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action || "frame";
    const obj = objectsById.get(btn.dataset.target);
    if (action === "all") {
      isolateObject(null);
      fitCamera();
      return;
    }
    if (!obj) return;
    if (action === "only") {
      isolateObject(obj);
      return;
    }
    if (action === "transparent") {
      setObjectTransparent(obj, !transparentObjects.has(obj));
      return;
    }
    frameObject(obj);
  });

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let transparentPointerStart = null;

  function rememberTransparentPointer(event) {
    if (!transparentPickEnabled || event.target !== renderer.domElement) return;
    if (event.button != null && event.button !== 0) return;
    transparentPointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
    };
  }

  function pickTransparentObject(event) {
    if (!transparentPickEnabled || event.target !== renderer.domElement) return;
    if (event.button != null && event.button !== 0) return;
    const start = transparentPointerStart;
    transparentPointerStart = null;
    if (!start || start.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    const elapsed = performance.now() - start.t;
    // Treat a short, steady tap/click as selection; let drags continue to OrbitControls.
    if (moved > 10 || elapsed > 1200) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    pointerNdc.y = -(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(allPickableMeshes(), true);
    const hit = hits.find((item) => item?.object && objectMeshes(item.object).length) || hits[0];
    if (!hit?.object) return;
    event.preventDefault();
    const target = closestTransparentTarget(hit.object);
    setObjectTransparent(target, !transparentObjects.has(target));
  }

  function clearTransparentPointer(event) {
    if (transparentPointerStart?.id === event.pointerId) transparentPointerStart = null;
  }

  // Keep OrbitControls live in transparent mode: drags rotate; steady clicks toggle parts.
  viewerEl.addEventListener("pointerdown", rememberTransparentPointer, true);
  viewerEl.addEventListener("pointerup", pickTransparentObject, true);
  viewerEl.addEventListener("pointercancel", clearTransparentPointer, true);

  function syncSectionUi(on) {
    btnSection?.classList.toggle("active", on);
    btnSection?.setAttribute("aria-pressed", String(on));
    sectionPanel?.classList.toggle("hidden", !on);
  }

  btnSection?.addEventListener("click", () => {
    if (section.isActive()) {
      section.deactivate();
      syncSectionUi(false);
    } else {
      section.activate();
      syncSectionUi(true);
    }
  });

  sectionPanel?.querySelectorAll("[data-axis]").forEach((btn) => {
    btn.addEventListener("click", () => {
      section.setAxis(btn.dataset.axis);
      sectionPanel.querySelectorAll("[data-axis]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
    });
  });

  const slider = sectionPanel?.querySelector("#share-section-slider");
  const pct = sectionPanel?.querySelector("#share-section-pct");
  slider?.addEventListener("input", () => {
    section.setOffset(Number(slider.value) / 100);
    if (pct) pct.textContent = `${slider.value}%`;
  });
  sectionPanel?.querySelector("#btn-share-section-flip")?.addEventListener("click", () => section.flip());
  sectionPanel?.querySelector("#btn-share-section-close")?.addEventListener("click", () => {
    section.deactivate();
    syncSectionUi(false);
  });

  btnDownloadMenu?.addEventListener("click", () => {
    downloadSheet?.classList.toggle("hidden");
    btnDownloadMenu.classList.toggle("active", !downloadSheet?.classList.contains("hidden"));
  });
  downloadSheet?.querySelector("[data-close-downloads]")?.addEventListener("click", () => {
    downloadSheet.classList.add("hidden");
    btnDownloadMenu?.classList.remove("active");
  });

  controls.addEventListener("start", () => {
    if (!isEmbedMode()) setAutoRotate(false);
  });
  // Block browser gestures that steal the drag (scroll / pinch-zoom page).
  renderer.domElement.addEventListener(
    "touchmove",
    (e) => {
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );

  window.addEventListener("resize", resize);
  resize();

  function tick() {
    requestAnimationFrame(tick);
    controls.update();
    syncCameraClip();
    renderer.render(scene, camera);
  }
  tick();
}

main().catch((err) => {
  const status = document.getElementById("share-status");
  if (status) {
    status.classList.remove("hidden");
    status.textContent = err?.message || "Something went wrong loading this share.";
  }
});
