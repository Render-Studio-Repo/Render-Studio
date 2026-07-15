/** Public share viewer — rotate, section cut, mobile-friendly, downloads. */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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
    if (!on) meshSides.clear();
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

async function main() {
  const token = tokenFromPath();
  const titleEl = $("share-title");
  const subEl = $("share-subtitle");
  const statusEl = $("share-status");
  const downloadsEl = $("share-downloads");
  const viewerEl = $("share-viewer");
  const sectionPanel = $("share-section-panel");
  const btnSection = $("btn-share-section");
  const btnRotate = $("btn-share-rotate");
  const btnFit = $("btn-share-fit");
  const btnDownloadMenu = $("btn-share-download");
  const downloadSheet = $("share-download-sheet");

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

  document.title = `${meta.project_name || "Render3D"} · Shared model`;
  titleEl.textContent = meta.project_name || meta.filename || "Shared model";
  subEl.textContent = meta.filename || "";

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

  function renderDownloads(into) {
    into.innerHTML = "";
    if (!exportItems.length) {
      into.innerHTML = `<p class="muted">No downloadable formats yet.</p>`;
      return;
    }
    for (const item of exportItems) {
      const a = document.createElement("a");
      a.className = "share-dl-btn";
      a.href = item.url;
      a.download = item.name;
      a.rel = "noopener";
      const label = FORMAT_LABELS[String(item.format || "").toLowerCase()]
        || String(item.format || "File").toUpperCase();
      a.innerHTML = `<strong>${label}</strong><span>${item.size != null ? formatBytes(item.size) : item.name}</span>`;
      into.appendChild(a);
    }
  }

  renderDownloads(downloadsEl);
  renderDownloads($("share-download-list"));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b12);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  viewerEl.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.enablePan = true;
  camera.up.set(0, 0, 1);
  controls.object.up.copy(camera.up);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7c8f, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(4, -5, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb8d4ff, 1.05);
  fill.position.set(-4, 3, -2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.55);
  rim.position.set(0, 6, -4);
  scene.add(rim);

  const root = new THREE.Group();
  scene.add(root);
  let autoRotate = true;
  let modelBox = new THREE.Box3();

  const section = createSectionController({
    renderer,
    scene,
    getBounds: () => modelBox.clone(),
  });

  function fitCamera() {
    root.position.set(0, 0, 0);
    modelBox.setFromObject(root);
    if (modelBox.isEmpty()) return;
    const center = modelBox.getCenter(new THREE.Vector3());
    const sizeVec = modelBox.getSize(new THREE.Vector3());
    const size = Math.max(sizeVec.length(), 1e-3);
    root.position.set(-center.x, -center.y, -modelBox.min.z);
    modelBox.setFromObject(root);
    const fitted = modelBox.getSize(new THREE.Vector3());
    const span = Math.max(fitted.length(), 1e-3);
    const targetZ = Math.max(fitted.z * 0.45, span * 0.08);
    camera.position.set(span * 0.95, -span * 1.25, targetZ + span * 0.5);
    camera.near = Math.max(span / 2000, 0.001);
    camera.far = span * 40;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, targetZ);
    controls.minDistance = span * 0.15;
    controls.maxDistance = span * 12;
    controls.update();
    section.refresh();
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

  const viewerUrl = meta.viewer_url
    || (meta.viewer_filename
      ? `/api/share/${encodeURIComponent(token)}/files/${encodeURIComponent(meta.viewer_filename)}`
      : "");
  const canPreview = /\.glb$/i.test(meta.viewer_filename || viewerUrl || "");

  if (!canPreview) {
    setStatus("3D preview needs a GLB. Use Download for available formats.");
  } else {
    setStatus("Loading model…");
    await new Promise((resolve) => {
      new GLTFLoader().load(
        viewerUrl,
        (gltf) => {
          root.clear();
          root.add(gltf.scene);
          fitCamera();
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

  btnRotate?.addEventListener("click", () => {
    autoRotate = !autoRotate;
    btnRotate.classList.toggle("active", autoRotate);
    btnRotate.setAttribute("aria-pressed", String(autoRotate));
  });
  btnRotate?.classList.toggle("active", autoRotate);

  btnFit?.addEventListener("click", () => {
    fitCamera();
  });

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
    autoRotate = false;
    btnRotate?.classList.remove("active");
    btnRotate?.setAttribute("aria-pressed", "false");
  });

  window.addEventListener("resize", resize);
  resize();

  function tick() {
    requestAnimationFrame(tick);
    if (autoRotate && root.children.length) root.rotation.z += 0.003;
    controls.update();
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
