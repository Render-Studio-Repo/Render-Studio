import * as THREE from "three";
import {
  VIEW_CUBE_FACES,
  nearestViewCubeFace,
  viewCubeSpinCss,
  zUpOffsetFromSpherical,
  zUpSphericalFromOffset,
} from "./view-cube-orientation.js?v=20260914-vcube1";

const WORLD_UP = new THREE.Vector3(0, 0, 1);

function makeButton(name, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `view-cube-face view-cube-face--${name}`;
  btn.dataset.view = name;
  btn.textContent = label;
  btn.setAttribute("aria-label", `View ${label.toLowerCase()}`);
  return btn;
}

function cameraDistance(camera, controls, getSceneRadius) {
  const target = controls.target || new THREE.Vector3();
  const current = camera.position.distanceTo(target);
  const radius = getSceneRadius?.() || 1;
  return Math.max(current || 0, radius * 2.4, 0.25);
}

function syncTrackballState(camera, controls) {
  controls.object?.up?.copy(camera.up);
  controls._eye.subVectors(camera.position, controls.target);
  controls._movePrev.set(0, 0);
  controls._moveCurr.set(0, 0);
  controls._lastAngle = 0;
  controls._lastAxis?.set(0, 0, 0);
  controls._panStart.copy(controls._panEnd);
  controls._zoomStart.copy(controls._zoomEnd);
  controls._up0?.copy(camera.up);
  controls._position0?.copy(camera.position);
  controls._target0?.copy(controls.target);
  controls.state = -1;
  controls.update();
}

export function createViewCube({ container, camera, controls, getSceneRadius }) {
  if (!container || !camera || !controls) {
    return { update() {}, dispose() {} };
  }

  const root = document.createElement("div");
  root.className = "view-cube";
  root.innerHTML = `
    <div class="view-cube-stage">
      <div class="view-cube-body">
        <div class="view-cube-spin"></div>
      </div>
    </div>
  `;

  const spin = root.querySelector(".view-cube-spin");
  for (const [name, spec] of Object.entries(VIEW_CUBE_FACES)) {
    spin.appendChild(makeButton(name, spec.label));
  }

  let dragging = false;
  let suppressClick = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startSpherical = null;
  let controlsEnabledBeforeDrag = true;

  function snapTo(name) {
    const spec = VIEW_CUBE_FACES[name];
    if (!spec) return;

    const target = controls.target.clone();
    const dist = cameraDistance(camera, controls, getSceneRadius);
    const dir = new THREE.Vector3(...spec.direction);
    const up = new THREE.Vector3(...spec.up).normalize();

    // Tiny offset off exact poles keeps TrackballControls stable (Z-up top/bottom).
    // Nudge toward Front (−Y) so Top keeps Front at the bottom of the screen.
    if (name === "top") dir.set(0, -1e-4, 1);
    else if (name === "bottom") dir.set(0, -1e-4, -1);
    dir.normalize();

    camera.up.copy(up);
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    syncTrackballState(camera, controls);
    update();
  }

  function rotateFromDrag(dx, dy) {
    if (!startSpherical) return;
    const target = controls.target.clone();
    const spherical = { ...startSpherical };
    const sensitivity = 0.012;
    spherical.theta -= dx * sensitivity;
    spherical.phi -= dy * sensitivity;
    spherical.phi = Math.max(1e-4, Math.min(Math.PI - 1e-4, spherical.phi));

    const next = zUpOffsetFromSpherical(spherical.radius, spherical.theta, spherical.phi);
    camera.position.copy(target).add(new THREE.Vector3(next.x, next.y, next.z));
    camera.up.copy(WORLD_UP);
    camera.lookAt(target);
    controls.target.copy(target);
    syncTrackballState(camera, controls);
    update();
  }

  function update() {
    const target = controls.target || new THREE.Vector3();
    const dir = camera.position.clone().sub(target);
    if (dir.lengthSq() < 1e-8) return;
    spin.style.transform = viewCubeSpinCss(dir.x, dir.y, dir.z);
    const active = nearestViewCubeFace(dir.x, dir.y, dir.z);
    for (const btn of spin.querySelectorAll("[data-view]")) {
      btn.classList.toggle("is-active", btn.dataset.view === active);
    }
  }

  let dragView = null;

  function finishPointer(e) {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    root.releasePointerCapture?.(pointerId);
    const wasDragging = dragging;
    const face =
      dragView
      || e.target?.closest?.("[data-view]")?.dataset?.view
      || null;
    pointerId = null;
    dragging = false;
    dragView = null;
    startSpherical = null;
    root.classList.remove("view-cube--dragging");
    controls.enabled = controlsEnabledBeforeDrag;
    suppressClick = true;
    if (wasDragging) {
      const offset = camera.position.clone().sub(controls.target);
      snapTo(nearestViewCubeFace(offset.x, offset.y, offset.z));
    } else {
      snapTo(face && VIEW_CUBE_FACES[face] ? face : "top");
    }
  }

  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    suppressClick = false;
    dragging = false;
    dragView = e.target?.closest?.("[data-view]")?.dataset?.view || null;
    controlsEnabledBeforeDrag = controls.enabled;
    const offset = camera.position.clone().sub(controls.target);
    startSpherical = zUpSphericalFromOffset(offset.x, offset.y, offset.z);
    root.setPointerCapture?.(pointerId);
    root.classList.add("view-cube--dragging");
    controls.enabled = false;
  });

  root.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId || !startSpherical) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > 3) {
      dragging = true;
      suppressClick = true;
    }
    if (dragging) rotateFromDrag(dx, dy);
  });

  root.addEventListener("pointerup", (e) => {
    finishPointer(e);
  });

  root.addEventListener("pointercancel", (e) => {
    finishPointer(e);
  });

  root.addEventListener("click", (e) => {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }
  });

  controls.addEventListener?.("change", update);
  container.appendChild(root);
  update();

  return {
    update,
    snapTo,
    dispose() {
      controls.removeEventListener?.("change", update);
      root.remove();
    },
  };
}

export { WORLD_UP as VIEW_CUBE_WORLD_UP };
export {
  VIEW_CUBE_FACES,
  nearestViewCubeFace,
  viewCubeSpinCss,
  viewCubeYawPitch,
} from "./view-cube-orientation.js?v=20260914-vcube1";
