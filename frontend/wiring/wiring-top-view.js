/** Top-down orthographic snapshots of CAD parts for the wiring schematic. */

import * as THREE from "three";

const SIZE = 256;
const cache = new Map();

let renderer = null;
let scene = null;
let camera = null;
let hemi = null;
let key = null;
let idleRelease = 0;

function releaseRenderer() {
  clearTimeout(idleRelease);
  idleRelease = 0;
  scene?.clear(); // Snapshot clones share the live model's geometry/materials.
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = scene = camera = hemi = key = null;
}

function ensureRenderer() {
  if (renderer?.getContext().isContextLost()) releaseRenderer();
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xe8eaed, 1);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8eaed);
  hemi = new THREE.HemisphereLight(0xffffff, 0xb0b8c0, 1.15);
  key = new THREE.DirectionalLight(0xffffff, 1.05);
  scene.add(hemi);
  scene.add(key);
  scene.add(key.target);

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  return renderer;
}

function thinnestAxis(size) {
  if (size.z <= size.x && size.z <= size.y) return "z";
  if (size.y <= size.x) return "y";
  return "x";
}

function aimTopDown(cam, center, size) {
  const span = Math.max(size.x, size.y, size.z, 1e-4);
  const dist = span * 2.4;
  const axis = thinnestAxis(size);
  if (axis === "z") {
    cam.up.set(0, 1, 0);
    cam.position.set(center.x, center.y, center.z + dist);
  } else if (axis === "y") {
    cam.up.set(0, 0, 1);
    cam.position.set(center.x, center.y + dist, center.z);
  } else {
    cam.up.set(0, 0, 1);
    cam.position.set(center.x + dist, center.y, center.z);
  }
  cam.lookAt(center);
  const half = Math.max(size.x, size.y, size.z) * 0.58 + span * 0.04;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = dist * 0.02;
  cam.far = dist * 4;
  cam.updateProjectionMatrix();
  key.position.copy(cam.position);
  key.target.position.copy(center);
  key.target.updateMatrixWorld();
}

export function captureTopDownDataUrl(object, { size = SIZE } = {}) {
  if (!object) return null;
  try {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    const dim = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const cacheKey = `${object.uuid}:${dim.x.toFixed(3)}:${dim.y.toFixed(3)}:${dim.z.toFixed(3)}:${size}`;
    const hit = cache.get(cacheKey);
    if (hit) return hit;

    const gl = ensureRenderer();
    if (size !== SIZE) gl.setSize(size, size, false);

    const clone = object.clone(true);
    clone.matrix.copy(object.matrixWorld);
    clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
    clone.updateMatrixWorld(true);

    const cloneBox = new THREE.Box3().setFromObject(clone);
    const cloneSize = cloneBox.getSize(new THREE.Vector3());
    const cloneCenter = cloneBox.getCenter(new THREE.Vector3());
    aimTopDown(camera, cloneCenter, cloneSize);

    scene.add(clone);
    gl.render(scene, camera);
    scene.remove(clone);

    const url = gl.domElement.toDataURL("image/png");
    cache.set(cacheKey, url);
    if (cache.size > 48) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
    if (size !== SIZE) gl.setSize(SIZE, SIZE, false);
    return url;
  } catch {
    return null;
  } finally {
    // Data URLs remain cached; the GPU context is only needed for a burst of
    // new snapshots, not for the lifetime of the wiring project.
    if (renderer) {
      clearTimeout(idleRelease);
      idleRelease = setTimeout(releaseRenderer, 1000);
    }
  }
}

export function clearTopDownCache() {
  cache.clear();
  releaseRenderer();
}
