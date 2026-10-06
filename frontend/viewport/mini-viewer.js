/**
 * Tiny in-Studio GLB orbit preview (component profile, context-lab, admin modal).
 * Not the public /share/... page — do not load that viewer module here.
 *
 * All mini views share one offscreen WebGLRenderer and blit into a 2D canvas
 * so Architect/library cards do not consume extra GPU contexts.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { applyViewportStyle, setupRenderer } from "./scene-style.js?v=20260907-iphone-view2-20260915-cadcolor2-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2&xrtalk=20260916-1&astra=20260916-5&webglrevert2&miniview1&models1&parametric-wire1";

const PREVIEW_PALETTE = [0x4f9cf0, 0x62c45a, 0xff9f43, 0xffd166, 0xb388ff, 0x2ec4b6];

const liveViews = new Set();
let sharedRenderer = null;
let sharedFailed = false;
let pumpRaf = 0;

function isNeutralGrey(color) {
  if (!color) return true;
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  return max - min < 0.06;
}

function colorizePlainPreviewMeshes(root) {
  let i = 0;
  root?.traverse?.((node) => {
    if (!node.isMesh || node.userData?.isEdge || node.userData?.isSilhouette) return;
    const mat = Array.isArray(node.material) ? node.material[0] : node.material;
    const hasVertexColors = !!node.geometry?.attributes?.color?.count;
    const hasTexture = !!mat?.map;
    if (hasVertexColors || hasTexture || !isNeutralGrey(mat?.color)) return;
    mat.color.setHex(PREVIEW_PALETTE[i % PREVIEW_PALETTE.length]);
    mat.needsUpdate = true;
    i += 1;
  });
}

export function getSharedOffscreenRenderer() {
  if (sharedRenderer) return sharedRenderer;
  if (sharedFailed || typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    canvas.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(1);
    setupRenderer(renderer);
    sharedRenderer = renderer;
    return sharedRenderer;
  } catch {
    sharedFailed = true;
    sharedRenderer = null;
    return null;
  }
}

function pumpMiniViews() {
  pumpRaf = 0;
  if (!liveViews.size) return;
  const renderer = getSharedOffscreenRenderer();
  if (!renderer || !liveViews.size) return;
  for (const view of liveViews) view.tick(renderer);
  if (liveViews.size) pumpRaf = requestAnimationFrame(pumpMiniViews);
}

function ensurePump() {
  if (!pumpRaf && liveViews.size) pumpRaf = requestAnimationFrame(pumpMiniViews);
}

export function createMiniViewer(container, { autoRotate = true, background = 0x0d1117, worldUp = "z" } = {}) {
  if (!container) return { load: async () => {}, dispose() {}, setAutoRotate() {}, resize() {} };

  const up = worldUp === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const bgColor = new THREE.Color(background);

  const scene = new THREE.Scene();
  scene.background = bgColor;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
  camera.up.copy(up);
  camera.position.set(2.2, -2.2, 1.6);

  if (!container.style.minHeight) container.style.minHeight = "320px";
  if (container.clientHeight < 160) {
    container.style.height = "360px";
  }

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  container.appendChild(canvas);
  const ctx2d = canvas.getContext("2d");

  scene.add(new THREE.HemisphereLight(0xffffff, 0x202830, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, -4, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
  fill.position.set(-4, 3, 1);
  scene.add(fill);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = 2.2;

  let current = null;
  let disposed = false;
  let ro = null;

  function resize() {
    const w = container.clientWidth || 300;
    const h = container.clientHeight || 220;
    const pr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    const bw = Math.max(1, Math.round(w * pr));
    const bh = Math.max(1, Math.round(h * pr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frameObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    const radius = Math.max(size.x, size.y, size.z, 0.001) * 0.5;
    const dist = Math.max(radius / Math.sin((camera.fov * Math.PI) / 180 / 2), radius * 2.5, 0.5);
    camera.position.set(dist * 0.85, -dist * 0.95, dist * 0.7);
    camera.near = Math.max(radius / 200, 0.001);
    camera.far = Math.max(dist * 20, 100);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.maxDistance = dist * 6;
    controls.update();
  }

  function clearModel() {
    if (!current) return;
    scene.remove(current);
    current.traverse((node) => {
      if (node.geometry) node.geometry.dispose?.();
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) m.dispose?.();
      }
    });
    current = null;
  }

  function paintFallback() {
    if (!ctx2d) return;
    ctx2d.fillStyle = `#${bgColor.getHexString()}`;
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  }

  function tick(renderer) {
    if (disposed || !ctx2d) return;
    resize();
    controls.update();
    renderer.setPixelRatio(1);
    renderer.setSize(canvas.width, canvas.height, false);
    renderer.setClearColor(bgColor, 1);
    renderer.render(scene, camera);
    ctx2d.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
  }

  const view = { tick };

  async function load(url) {
    clearModel();
    if (!url) return;
    resize();
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    if (disposed) return;
    current = gltf.scene;
    applyViewportStyle(current, { filename: url || "", styleMode: "auto" });
    colorizePlainPreviewMeshes(current);
    scene.add(current);
    resize();
    frameObject(current);
    requestAnimationFrame(() => {
      if (disposed || !current) return;
      resize();
      frameObject(current);
    });
  }

  resize();
  paintFallback();
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(resize);
    ro.observe(container);
  } else if (typeof window !== "undefined") {
    window.addEventListener("resize", resize);
  }

  if (getSharedOffscreenRenderer()) {
    liveViews.add(view);
    ensurePump();
  }

  return {
    load,
    resize,
    setAutoRotate(v) {
      controls.autoRotate = !!v;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      liveViews.delete(view);
      if (!liveViews.size) {
        cancelAnimationFrame(pumpRaf);
        pumpRaf = 0;
        // All preview canvases are 2D copies. The offscreen context has no
        // remaining owner once the last mini viewer closes.
        const closedPreviewRenderer = sharedRenderer;
        sharedRenderer = null;
        closedPreviewRenderer?.dispose();
        // dispose() frees Three resources but keeps the browser context alive.
        // This is the preview-only offscreen renderer, never Studio's XR canvas.
        closedPreviewRenderer?.forceContextLoss();
        sharedFailed = false;
      }
      ro?.disconnect();
      if (typeof window !== "undefined") window.removeEventListener("resize", resize);
      clearModel();
      controls.dispose?.();
      canvas.remove();
    },
  };
}
