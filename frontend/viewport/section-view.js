/**
 * Section View — cross-section via material-local clipping planes.
 *
 * Clips CAD meshes only (not menus, gizmos, grid, or other scene chrome).
 * Drag the cut plane (or drag in the viewport) to scrub left/right / up/down.
 *
 * Public API
 * ----------
 *   createSectionView({ renderer, scene, camera, controls, getModelBounds, domElement, ... })
 *     → { activate, deactivate, isActive, setAxis, setOffset, flip, dispose, onModelChanged }
 */

import * as THREE from "three";

const SKIP_NAMES = new Set([
  "ref-markers",
  "hover-group",
  "direct-modeling",
  "xrHud",
  "ProjectAssembly", // only skip if empty; children are clipped via traverse of meshes
]);

function isSceneChrome(obj) {
  if (!obj) return false;
  if (obj.isGridHelper || obj.type === "GridHelper") return true;
  if (obj.isLine || obj.isLineSegments || obj.isPoints) return true;
  if (obj.userData?.xrDesktopChrome) return true;
  if (obj.userData?.isFloor || obj.userData?.isShadowFloor) return true;
  if (obj.userData?.isArchitectBay || obj.userData?.isArchitectGrid) return true;
  const name = String(obj.name || "");
  return name === "architect-grid-dots" || name === "large-grid-axes";
}

function isBuildMesh(obj) {
  if (!obj?.isMesh || !obj.visible || !obj.geometry) return false;
  if (obj.userData?.isEdge || obj.userData?.isSilhouette) return false;
  if (obj.userData?.isObjectHighlight) return false;
  if (obj.userData?.isSection) return false;
  if (obj.userData?.isFloor || obj.userData?.isShadowFloor) return false;
  if (obj.userData?.isArchitectBay || obj.userData?.isArchitectGrid) return false;
  if (isSceneChrome(obj)) return false;
  let p = obj.parent;
  while (p) {
    if (p.name === "xrHud") return false;
    if (isSceneChrome(p)) return false;
    if (SKIP_NAMES.has(p.name) && p.name !== "ProjectAssembly") return false;
    p = p.parent;
  }
  return true;
}

export function createSectionView({
  renderer,
  scene,
  camera,
  controls = null,
  getModelBounds,
  domElement = null,
  onTransparentPick = null,
  onTransparentEntire = null,
  onTransparentClear = null,
  isTransparentPickActive = null,
  onActiveChange = null,
}) {
  let _active = false;
  let _axis = "Y";
  let _offset = 0.5;
  let _flipped = false;
  let _panel = null;
  let _slider = null;
  let _pct = null;
  const _meshDisplayState = new Map();
  /** @type {Map<THREE.Material, THREE.Plane[]|null>} */
  const _matClipBackup = new Map();

  const _plane = new THREE.Plane();
  const _helper = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x58a6ff,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    }),
  );
  _helper.name = "section-plane-helper";
  _helper.userData.isSection = true;
  _helper.visible = false;
  _helper.renderOrder = 40;
  _helper.frustumCulled = false;
  scene.add(_helper);

  const _edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({
      color: 0x58a6ff,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
    }),
  );
  _edge.userData.isSection = true;
  _helper.add(_edge);

  const _raycaster = new THREE.Raycaster();
  const _pointer = new THREE.Vector2();
  const _drag = {
    active: false,
    mode: "plane", // plane | viewport
    startOffset: 0.5,
    startClient: { x: 0, y: 0 },
    axisWorld: new THREE.Vector3(),
  };
  let _controlsWasEnabled = true;
  let _boundEl = null;

  function _canvas() {
    return domElement || renderer?.domElement || null;
  }

  function _getBounds() {
    const bounds = getModelBounds?.();
    if (bounds && !bounds.isEmpty?.()) return bounds.clone();
    const box = new THREE.Box3();
    scene.traverse((o) => {
      if (isBuildMesh(o)) box.expandByObject(o);
    });
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(-100, -100, -100), new THREE.Vector3(100, 100, 100));
    }
    return box;
  }

  function _planeNormal() {
    const n = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[_axis] || [0, 1, 0];
    const s = _flipped ? 1 : -1;
    return new THREE.Vector3(n[0] * s, n[1] * s, n[2] * s);
  }

  function _axisPos(box) {
    const mn = { X: box.min.x, Y: box.min.y, Z: box.min.z }[_axis];
    const mx = { X: box.max.x, Y: box.max.y, Z: box.max.z }[_axis];
    return mn + _offset * (mx - mn);
  }

  function _forEachBuildMesh(fn) {
    scene.traverse((obj) => {
      if (isBuildMesh(obj)) fn(obj);
    });
  }

  function _applyLocalClipping(box) {
    _plane.normal.copy(_planeNormal());
    const pos = _axisPos(box);
    const posVec = {
      X: new THREE.Vector3(pos, (box.min.y + box.max.y) * 0.5, (box.min.z + box.max.z) * 0.5),
      Y: new THREE.Vector3((box.min.x + box.max.x) * 0.5, pos, (box.min.z + box.max.z) * 0.5),
      Z: new THREE.Vector3((box.min.x + box.max.x) * 0.5, (box.min.y + box.max.y) * 0.5, pos),
    }[_axis];
    _plane.constant = -_plane.normal.dot(posVec);

    // Model-only: never set renderer.clippingPlanes (that clips menus/gizmos/grid too)
    renderer.clippingPlanes = [];
    renderer.localClippingEnabled = true;

    _forEachBuildMesh((mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (!_matClipBackup.has(mat)) {
          _matClipBackup.set(mat, mat.clippingPlanes ? mat.clippingPlanes.slice() : null);
        }
        mat.clippingPlanes = [_plane];
        mat.clipIntersection = false;
        mat.clipShadows = true;
        mat.needsUpdate = true;
      }
    });

    _updateHelper(box, posVec);
  }

  function _clearLocalClipping() {
    for (const [mat, prev] of _matClipBackup.entries()) {
      if (!mat) continue;
      mat.clippingPlanes = prev;
      mat.needsUpdate = true;
    }
    _matClipBackup.clear();
    renderer.clippingPlanes = [];
    renderer.localClippingEnabled = false;
  }

  function _updateHelper(box, center) {
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1) * 1.15;
    _helper.position.copy(center);
    _helper.scale.set(span, span, 1);
    // Orient plane so +Z local aligns with section normal
    const n = _plane.normal.clone().normalize();
    _helper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    _helper.visible = _active;
    _helper.updateMatrixWorld(true);
  }

  function _setSectionDisplay(on) {
    if (on) {
      _forEachBuildMesh((mesh) => {
        if (!_meshDisplayState.has(mesh)) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          _meshDisplayState.set(mesh, {
            materialSides: mats.map((m) => m?.side),
            childVisibility: mesh.children.map((child) => ({
              child,
              visible: child.visible,
            })),
          });
        }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat) => {
          if (!mat) return;
          mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        });
        mesh.children.forEach((child) => {
          if (child.userData?.isSilhouette || child.userData?.isEdge || child.isLineSegments2) {
            child.visible = false;
          }
        });
      });
      return;
    }

    for (const [mesh, state] of _meshDisplayState.entries()) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mat, idx) => {
        if (!mat) return;
        mat.side = state.materialSides[idx] ?? THREE.FrontSide;
        mat.needsUpdate = true;
      });
      state.childVisibility.forEach(({ child, visible }) => {
        if (child?.parent) child.visible = visible;
      });
    }
    _meshDisplayState.clear();
  }

  function _syncSliderUi() {
    if (_slider) _slider.value = String(Math.round(_offset * 100));
    if (_pct) _pct.textContent = `${Math.round(_offset * 100)}%`;
  }

  function _syncTransparentUi() {
    if (!_panel) return;
    const pickOn = !!isTransparentPickActive?.();
    _panel.querySelectorAll("[data-sv-transparent]").forEach((btn) => {
      const id = btn.getAttribute("data-sv-transparent");
      btn.classList.toggle("sv-ghost-active", id === "pick" && pickOn);
    });
  }

  function _refresh() {
    if (!_active) return;
    _applyLocalClipping(_getBounds());
    _syncSliderUi();
    _syncTransparentUi();
  }

  function setOffset(t) {
    _offset = Math.max(0, Math.min(1, t));
    _refresh();
  }

  function _ndcFromEvent(e, el) {
    const rect = el.getBoundingClientRect();
    _pointer.x = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    _pointer.y = -((e.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
  }

  function _hitHelper(e) {
    const el = _canvas();
    if (!el || !_helper.visible) return false;
    _ndcFromEvent(e, el);
    _raycaster.setFromCamera(_pointer, camera);
    const hits = _raycaster.intersectObject(_helper, true);
    return hits.length > 0;
  }

  function _beginDrag(e, mode) {
    _drag.active = true;
    _drag.mode = mode;
    _drag.startOffset = _offset;
    _drag.startClient.x = e.clientX;
    _drag.startClient.y = e.clientY;
    _drag.axisWorld.copy(_planeNormal()).normalize();
    if (controls) {
      _controlsWasEnabled = controls.enabled;
      controls.enabled = false;
    }
    try {
      _canvas()?.setPointerCapture?.(e.pointerId);
    } catch (_) {}
  }

  function _onPointerDown(e) {
    if (!_active) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target?.closest?.(".section-view-panel")) return;

    // Prefer dragging the visible cut plane
    if (_hitHelper(e)) {
      e.preventDefault();
      e.stopPropagation();
      _beginDrag(e, "plane");
      return;
    }

    // Alt-drag anywhere on desktop. Phones use the slider / blue cut plane.
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      _beginDrag(e, "viewport");
    }
  }

  function _onPointerMove(e) {
    if (!_active || !_drag.active) return;
    e.preventDefault();

    const el = _canvas();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const box = _getBounds();
    const mn = { X: box.min.x, Y: box.min.y, Z: box.min.z }[_axis];
    const mx = { X: box.max.x, Y: box.max.y, Z: box.max.z }[_axis];
    const span = Math.max(mx - mn, 1e-6);

    if (_drag.mode === "plane") {
      // Project mouse delta onto the section axis in screen space
      const n = _drag.axisWorld;
      const origin = new THREE.Vector3().setFromMatrixPosition(_helper.matrixWorld);
      const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      const screenAxis = new THREE.Vector2(n.dot(camRight), n.dot(camUp));
      if (screenAxis.lengthSq() < 1e-6) screenAxis.set(1, 0);
      else screenAxis.normalize();

      const dx = (e.clientX - _drag.startClient.x) / Math.max(rect.width, 1);
      const dy = -(e.clientY - _drag.startClient.y) / Math.max(rect.height, 1);
      const along = dx * screenAxis.x + dy * screenAxis.y;
      // ~full model span across ~70% of the viewport drag
      setOffset(_drag.startOffset + along / 0.7);
      return;
    }

    // Viewport scrub: X axis ↔ horizontal drag, Z (up) ↔ vertical, Y ↔ dominant
    let delta = 0;
    if (_axis === "X") delta = (e.clientX - _drag.startClient.x) / Math.max(rect.width, 1);
    else if (_axis === "Z") delta = -(e.clientY - _drag.startClient.y) / Math.max(rect.height, 1);
    else {
      const adx = Math.abs(e.clientX - _drag.startClient.x);
      const ady = Math.abs(e.clientY - _drag.startClient.y);
      delta = adx >= ady
        ? (e.clientX - _drag.startClient.x) / Math.max(rect.width, 1)
        : -(e.clientY - _drag.startClient.y) / Math.max(rect.height, 1);
    }
    setOffset(_drag.startOffset + delta / 0.7);
  }

  function _endDrag(e) {
    if (!_drag.active) return;
    _drag.active = false;
    if (controls) controls.enabled = _controlsWasEnabled;
    try {
      if (e?.pointerId != null) _canvas()?.releasePointerCapture?.(e.pointerId);
    } catch (_) {}
  }

  function _bindPointer() {
    const el = _canvas();
    if (!el || _boundEl === el) return;
    _unbindPointer();
    _boundEl = el;
    el.addEventListener("pointerdown", _onPointerDown, true);
    window.addEventListener("pointermove", _onPointerMove, true);
    window.addEventListener("pointerup", _endDrag, true);
    window.addEventListener("pointercancel", _endDrag, true);
  }

  function _unbindPointer() {
    if (_boundEl) {
      _boundEl.removeEventListener("pointerdown", _onPointerDown, true);
    }
    window.removeEventListener("pointermove", _onPointerMove, true);
    window.removeEventListener("pointerup", _endDrag, true);
    window.removeEventListener("pointercancel", _endDrag, true);
    _boundEl = null;
  }

  function _buildPanel() {
    if (_panel) return;

    _panel = document.createElement("div");
    _panel.id = "section-view-panel";
    _panel.className = "section-view-panel";
    _panel.innerHTML = `
      <div class="sv-header">
        <span class="sv-title">Section View</span>
        <button type="button" class="sv-close" title="Exit section view" aria-label="Exit section view">✕</button>
      </div>
      <div class="sv-row">
        <span class="sv-label">Axis</span>
        <div class="sv-axis-btns">
          <button type="button" class="sv-axis-btn" data-axis="X" title="Cut left / right">X</button>
          <button type="button" class="sv-axis-btn sv-axis-active" data-axis="Y" title="Cut front / back">Y</button>
          <button type="button" class="sv-axis-btn" data-axis="Z" title="Cut up / down">Z</button>
        </div>
      </div>
      <div class="sv-row">
        <span class="sv-label">Position</span>
        <input type="range" class="sv-slider" min="0" max="100" value="50" step="1" aria-label="Section plane position" />
        <span class="sv-pct">50%</span>
      </div>
      <div class="sv-row">
        <button type="button" class="sv-flip-btn">⇆ Flip</button>
        <button type="button" class="sv-reset-btn">Reset</button>
      </div>
      <div class="sv-row sv-ghost-row">
        <span class="sv-label">Ghost</span>
        <div class="sv-ghost-btns">
          <button type="button" class="sv-ghost-btn" data-sv-transparent="pick" title="Click a body to make it transparent">Click body</button>
          <button type="button" class="sv-ghost-btn" data-sv-transparent="entire" title="Ghost all objects">All objects</button>
          <button type="button" class="sv-ghost-btn" data-sv-transparent="clear" title="Restore solid materials">Clear</button>
        </div>
      </div>
      <div class="sv-hint">Drag the blue cut plane or the slider · works with Transparent and Exploded</div>
    `;

    _panel.querySelectorAll(".sv-axis-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        _axis = btn.dataset.axis;
        _panel.querySelectorAll(".sv-axis-btn").forEach((b) => b.classList.toggle("sv-axis-active", b === btn));
        _refresh();
      });
    });

    _slider = _panel.querySelector(".sv-slider");
    _pct = _panel.querySelector(".sv-pct");
    _slider.addEventListener("input", () => {
      _offset = parseFloat(_slider.value) / 100;
      if (_pct) _pct.textContent = `${_slider.value}%`;
      _refresh();
    });

    _panel.querySelector(".sv-flip-btn").addEventListener("click", () => {
      _flipped = !_flipped;
      _refresh();
    });

    _panel.querySelector(".sv-reset-btn").addEventListener("click", () => {
      _flipped = false;
      _offset = 0.5;
      _axis = "Y";
      _syncSliderUi();
      _panel.querySelectorAll(".sv-axis-btn").forEach((b) => b.classList.toggle("sv-axis-active", b.dataset.axis === "Y"));
      _refresh();
    });

    _panel.querySelectorAll("[data-sv-transparent]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-sv-transparent");
        if (id === "pick") onTransparentPick?.();
        else if (id === "entire") onTransparentEntire?.();
        else if (id === "clear") onTransparentClear?.();
        _syncTransparentUi();
      });
    });

    _panel.querySelector(".sv-close").addEventListener("click", () => deactivate());
    // Keep panel inside the viewport chrome — do not cover the right AI / browser menus
    const host = document.getElementById("viewport") || document.getElementById("canvas-wrap") || document.body;
    host.appendChild(_panel);
  }

  function activate() {
    if (_active) return;
    _active = true;
    _buildPanel();
    _setSectionDisplay(true);
    _panel.classList.add("sv-visible");
    _bindPointer();
    _refresh();
    document.getElementById("btn-section")?.classList.add("active");
    document.getElementById("btn-section")?.setAttribute("aria-pressed", "true");
    document.getElementById("btn-section-viewport")?.classList.add("active");
    document.getElementById("btn-section-viewport")?.setAttribute("aria-pressed", "true");
    try { onActiveChange?.(true); } catch (_) {}
  }

  function deactivate() {
    if (!_active) return;
    _active = false;
    _endDrag();
    _unbindPointer();
    _clearLocalClipping();
    _setSectionDisplay(false);
    _helper.visible = false;

    _panel?.classList.remove("sv-visible");
    document.getElementById("btn-section")?.classList.remove("active");
    document.getElementById("btn-section")?.setAttribute("aria-pressed", "false");
    document.getElementById("btn-section-viewport")?.classList.remove("active");
    document.getElementById("btn-section-viewport")?.setAttribute("aria-pressed", "false");
    try { onActiveChange?.(false); } catch (_) {}
  }

  function setAxis(axis) {
    _axis = String(axis || "Y").toUpperCase();
    if (_panel) {
      _panel.querySelectorAll(".sv-axis-btn").forEach((b) => {
        b.classList.toggle("sv-axis-active", b.dataset.axis === _axis);
      });
    }
    _refresh();
  }

  function flip() {
    _flipped = !_flipped;
    _refresh();
  }

  function isActive() {
    return _active;
  }

  function dispose() {
    deactivate();
    _unbindPointer();
    _panel?.remove();
    _panel = null;
    scene.remove(_helper);
    _helper.geometry?.dispose?.();
    _helper.material?.dispose?.();
    _edge.geometry?.dispose?.();
    _edge.material?.dispose?.();
  }

  function onModelChanged() {
    if (!_active) return;
    // Re-apply after exploded swap / reload so new meshes get local clipping
    _clearLocalClipping();
    _setSectionDisplay(true);
    _refresh();
  }

  return { activate, deactivate, isActive, setAxis, setOffset, flip, dispose, onModelChanged };
}
