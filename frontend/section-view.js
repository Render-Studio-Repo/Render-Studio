/**
 * Section View — cross-section via renderer clipping planes.
 *
 * Cuts the model along X/Y/Z and keeps interior walls readable.
 *
 * Public API
 * ----------
 *   createSectionView({ renderer, scene, camera, getModelBounds })
 *     → { activate, deactivate, isActive, setAxis, setOffset, flip, dispose }
 */

import * as THREE from "three";

const SKIP_NAMES = new Set(["ref-markers", "hover-group", "direct-modeling"]);

function isBuildMesh(obj) {
  if (!obj.isMesh || !obj.visible || !obj.geometry) return false;
  if (obj.userData.isEdge || obj.userData.isSilhouette) return false;
  if (obj.userData.isObjectHighlight) return false;
  if (obj.userData.isSection) return false;
  let p = obj.parent;
  while (p) {
    if (SKIP_NAMES.has(p.name)) return false;
    p = p.parent;
  }
  return true;
}

export function createSectionView({ renderer, scene, camera, getModelBounds }) {
  let _active = false;
  let _axis = "Y";
  let _offset = 0.5;
  let _flipped = false;
  let _panel = null;
  let _slider = null;
  const _meshDisplayState = new Map();

  const _plane = new THREE.Plane();

  function _getBounds() {
    const bounds = getModelBounds?.();
    if (bounds) return bounds;
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

  function _applyClipping(box) {
    _plane.normal.copy(_planeNormal());
    const pos = _axisPos(box);
    const posVec = {
      X: new THREE.Vector3(pos, 0, 0),
      Y: new THREE.Vector3(0, pos, 0),
      Z: new THREE.Vector3(0, 0, pos),
    }[_axis];
    _plane.constant = -_plane.normal.dot(posVec);
    renderer.clippingPlanes = [_plane];
    renderer.localClippingEnabled = true;
  }

  function _forEachBuildMesh(fn) {
    scene.traverse((obj) => {
      if (isBuildMesh(obj)) fn(obj);
    });
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
          // DoubleSide so cut interiors stay readable without a fill cap.
          mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        });
        // Hide BackSide silhouette shells — when clipped they read as a huge
        // pale dome around the model (inside of the outline shell).
        mesh.children.forEach((child) => {
          if (!child.userData.isSilhouette) return;
          child.visible = false;
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

  function _refresh() {
    if (!_active) return;
    _applyClipping(_getBounds());
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
          <button type="button" class="sv-axis-btn" data-axis="X">X</button>
          <button type="button" class="sv-axis-btn sv-axis-active" data-axis="Y">Y</button>
          <button type="button" class="sv-axis-btn" data-axis="Z">Z</button>
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
      <div class="sv-hint">Drag slider · cut through the model along X / Y / Z</div>
    `;

    _panel.querySelectorAll(".sv-axis-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        _axis = btn.dataset.axis;
        _panel.querySelectorAll(".sv-axis-btn").forEach((b) => b.classList.toggle("sv-axis-active", b === btn));
        _refresh();
      });
    });

    _slider = _panel.querySelector(".sv-slider");
    const _pct = _panel.querySelector(".sv-pct");
    _slider.addEventListener("input", () => {
      _offset = parseFloat(_slider.value) / 100;
      _pct.textContent = `${_slider.value}%`;
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
      _slider.value = 50;
      _panel.querySelector(".sv-pct").textContent = "50%";
      _panel.querySelectorAll(".sv-axis-btn").forEach((b) => b.classList.toggle("sv-axis-active", b.dataset.axis === "Y"));
      _refresh();
    });

    _panel.querySelector(".sv-close").addEventListener("click", () => deactivate());
    document.body.appendChild(_panel);
  }

  function activate() {
    if (_active) return;
    _active = true;
    _buildPanel();
    _setSectionDisplay(true);
    _panel.classList.add("sv-visible");
    _refresh();
    document.getElementById("btn-section")?.classList.add("active");
    document.getElementById("btn-section")?.setAttribute("aria-pressed", "true");
  }

  function deactivate() {
    if (!_active) return;
    _active = false;

    renderer.clippingPlanes = [];
    renderer.localClippingEnabled = false;
    _setSectionDisplay(false);

    _panel?.classList.remove("sv-visible");
    document.getElementById("btn-section")?.classList.remove("active");
    document.getElementById("btn-section")?.setAttribute("aria-pressed", "false");
  }

  function setAxis(axis) {
    _axis = axis.toUpperCase();
    _refresh();
  }

  function setOffset(t) {
    _offset = Math.max(0, Math.min(1, t));
    if (_slider) {
      _slider.value = Math.round(_offset * 100);
      const p = _panel?.querySelector(".sv-pct");
      if (p) p.textContent = `${Math.round(_offset * 100)}%`;
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
    _panel?.remove();
    _panel = null;
  }

  function onModelChanged() {
    if (_active) {
      _setSectionDisplay(true);
      _refresh();
    }
  }

  return { activate, deactivate, isActive, setAxis, setOffset, flip, dispose, onModelChanged };
}
