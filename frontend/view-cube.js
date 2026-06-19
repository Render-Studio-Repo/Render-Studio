import * as THREE from "three";

// Z-up CAD (Fusion / build123d): +Y front, +Z top, +X right. Offset is target → camera.
const VIEWS = {
  front: { label: "FRONT", direction: [0, 1, 0], up: [0, 0, 1] },
  back: { label: "BACK", direction: [0, -1, 0], up: [0, 0, 1] },
  top: { label: "TOP", direction: [0, 0, 1], up: [0, 1, 0] },
  bottom: { label: "BOTTOM", direction: [0, 0, -1], up: [0, -1, 0] },
  right: { label: "RIGHT", direction: [1, 0, 0], up: [0, 0, 1] },
  left: { label: "LEFT", direction: [-1, 0, 0], up: [0, 0, 1] },
};

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

function nearestViewName(camera, controls) {
  const target = controls.target || new THREE.Vector3();
  const dir = camera.position.clone().sub(target).normalize();
  let best = "top";
  let bestDot = -Infinity;
  for (const [name, spec] of Object.entries(VIEWS)) {
    const d = new THREE.Vector3(...spec.direction).normalize();
    const dot = dir.dot(d);
    if (dot > bestDot) {
      bestDot = dot;
      best = name;
    }
  }
  return best;
}

export function createViewCube({ container, camera, controls, getSceneRadius }) {
  if (!container || !camera || !controls) {
    return { update() {}, dispose() {} };
  }

  const root = document.createElement("div");
  root.className = "view-cube";
  root.innerHTML = `
    <div class="view-cube-label" title="Top view">View</div>
    <div class="view-cube-stage">
      <div class="view-cube-body">
        <div class="view-cube-spin"></div>
      </div>
    </div>
  `;

  const spin = root.querySelector(".view-cube-spin");
  const label = root.querySelector(".view-cube-label");
  for (const [name, spec] of Object.entries(VIEWS)) {
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
    const spec = VIEWS[name];
    if (!spec) return;

    const target = controls.target.clone();
    const dist = cameraDistance(camera, controls, getSceneRadius);
    const dir = new THREE.Vector3(...spec.direction);
    const up = new THREE.Vector3(...spec.up).normalize();

    // Tiny offset off exact poles keeps TrackballControls stable (Z-up top/bottom).
    if (name === "top") dir.set(0, 1e-4, 1);
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
    const spherical = startSpherical.clone();
    const sensitivity = 0.012;
    spherical.theta -= dx * sensitivity;
    spherical.phi += dy * sensitivity;
    spherical.phi = Math.max(1e-4, Math.min(Math.PI - 1e-4, spherical.phi));

    const next = new THREE.Vector3().setFromSpherical(spherical);
    camera.position.copy(target).add(next);
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
    dir.normalize();
    let yaw = Math.atan2(dir.y, dir.x);
    if (!Number.isFinite(yaw)) yaw = 0;
    const horiz = Math.hypot(dir.x, dir.y);
    const pitch = Math.atan2(dir.z, horiz || 1e-6);
    spin.style.transform =
      `rotateZ(${THREE.MathUtils.radToDeg(yaw - Math.PI / 2)}deg) ` +
      `rotateX(${-THREE.MathUtils.radToDeg(pitch)}deg)`;
  }

  function finishPointer(e) {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    root.releasePointerCapture?.(pointerId);
    const wasDragging = dragging;
    pointerId = null;
    dragging = false;
    startSpherical = null;
    root.classList.remove("view-cube--dragging");
    controls.enabled = controlsEnabledBeforeDrag;
    suppressClick = true;
    if (wasDragging) snapTo(nearestViewName(camera, controls));
    else snapTo("top");
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
    controlsEnabledBeforeDrag = controls.enabled;
    startSpherical = new THREE.Spherical().setFromVector3(
      camera.position.clone().sub(controls.target)
    );
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

  label.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    snapTo("top");
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
