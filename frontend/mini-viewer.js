/**
 * Tiny self-contained three.js viewer for showing a single GLB model spinning
 * inside a small container (used by the component profile panel and the wiring
 * simulator's 3D preview). Loads a GLB by URL, frames it, auto-rotates, and
 * supports drag-to-orbit. Call dispose() to release GPU resources.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { applyCadStyle, setupRenderer } from "./scene-style.js?v=20260710-jake-part-colors";

const PREVIEW_PALETTE = [0x78aee8, 0x8fd17f, 0xf0c15a, 0xe88974, 0xb79be8, 0x6bc7c6];

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

export function createMiniViewer(container, { autoRotate = true, background = 0x0d1117 } = {}) {
  if (!container) return { load: async () => {}, dispose() {}, setAutoRotate() {} };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
  camera.position.set(2.2, 1.6, 2.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  setupRenderer(renderer);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";

  scene.add(new THREE.HemisphereLight(0xffffff, 0x202830, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
  fill.position.set(-4, 1, -3);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = 2.2;

  let current = null;
  let raf = null;
  let disposed = false;
  let ro = null;

  function resize() {
    const w = container.clientWidth || 300;
    const h = container.clientHeight || 220;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frameObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    const radius = Math.max(size.x, size.y, size.z, 0.001) * 0.5;
    const dist = radius / Math.sin((camera.fov * Math.PI) / 180 / 2);
    camera.position.set(dist * 0.9, dist * 0.7, dist * 1.1);
    camera.near = radius / 100;
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.maxDistance = dist * 4;
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

  function animate() {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  async function load(url) {
    clearModel();
    if (!url) return;
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    if (disposed) return;
    current = gltf.scene;
    applyCadStyle(current);
    colorizePlainPreviewMeshes(current);
    scene.add(current);
    resize();
    frameObject(current);
  }

  resize();
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(resize);
    ro.observe(container);
  } else {
    window.addEventListener("resize", resize);
  }
  animate();

  return {
    load,
    setAutoRotate(v) {
      controls.autoRotate = !!v;
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", resize);
      clearModel();
      controls.dispose?.();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
