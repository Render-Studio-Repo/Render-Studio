/**
 * Live ghost preview for VibeCAD-style Create tools (Box / Cylinder / Pad / …).
 *
 * Viewport is Z-up (same as build123d → GLB). For Box / Cylinder / Sphere /
 * Cone / Torus: drag on the floor to draw size (base → height), like VibeCAD
 * Mac Additive Box. Other tools: edit Tasks fields + click to place.
 * OK places the ghost as a real solid instantly. Server persist is optional
 * background work — this module owns the viewport preview + commit clone.
 */

import * as THREE from "three";

const PREVIEW_COLOR = 0x58a6ff;
const CUT_COLOR = 0xf85149;
const DRAWABLE = new Set(["box", "cylinder", "sphere", "cone", "torus"]);

function _num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _profilePoints(preset, size) {
  const s = Math.max(0.1, _num(size, 20));
  const profiles = {
    square: [
      [-s / 2, -s / 2],
      [s / 2, -s / 2],
      [s / 2, s / 2],
      [-s / 2, s / 2],
    ],
    triangle: [
      [0, s * 0.577],
      [-s / 2, -s * 0.289],
      [s / 2, -s * 0.289],
    ],
    hexagon: [
      [s, 0],
      [s / 2, s * 0.866],
      [-s / 2, s * 0.866],
      [-s, 0],
      [-s / 2, -s * 0.866],
      [s / 2, -s * 0.866],
    ],
    "L-shape": [
      [0, 0],
      [s, 0],
      [s, s * 0.33],
      [s * 0.33, s * 0.33],
      [s * 0.33, s],
      [0, s],
    ],
    vase: [
      [0, 0],
      [s, 0],
      [s * 0.9, s * 0.06],
      [s * 0.8, s * 0.7],
      [s * 1.0, s],
      [s * 0.92, s * 0.995],
      [0, s * 0.995],
    ],
    "L-profile": [
      [0, 0],
      [s, 0],
      [s, s * 0.2],
      [s * 0.2, s * 0.2],
      [s * 0.2, s],
      [0, s],
    ],
    rectangle: [
      [s * 0.4, 0],
      [s, 0],
      [s, s],
      [s * 0.4, s],
    ],
  };
  return profiles[preset] || profiles.square;
}

function _extrudeGeometry(profile2d, height) {
  const shape = new THREE.Shape();
  profile2d.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, height),
    bevelEnabled: false,
    curveSegments: 8,
  });
  return geo;
}

function _revolveGeometry(profileRz, angleDeg) {
  const pts = profileRz.map(([r, z]) => new THREE.Vector2(Math.max(0, r), z));
  if (pts.length < 2) {
    pts.push(new THREE.Vector2(1, 0), new THREE.Vector2(1, 10));
  }
  const segments = Math.max(8, Math.round((_num(angleDeg, 360) / 360) * 48));
  const geo = new THREE.LatheGeometry(pts, segments, 0, THREE.MathUtils.degToRad(_num(angleDeg, 360)));
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function _geometryFor(entryId, values) {
  const id = String(entryId || "");
  const combine = String(values.combine || "new");
  const isCut = combine === "cut" || id === "pocket" || id === "hole";

  if (id === "box") {
    const l = Math.max(0.01, _num(values.length, 20));
    const w = Math.max(0.01, _num(values.width, 20));
    const h = Math.max(0.01, _num(values.height, 10));
    return { geometry: new THREE.BoxGeometry(l, w, h), isCut };
  }
  if (id === "cylinder") {
    const r = Math.max(0.01, _num(values.radius, 10));
    const h = Math.max(0.01, _num(values.height, 20));
    const geo = new THREE.CylinderGeometry(r, r, h, 48);
    geo.rotateX(Math.PI / 2);
    return { geometry: geo, isCut };
  }
  if (id === "sphere") {
    const r = Math.max(0.01, _num(values.radius, 10));
    return { geometry: new THREE.SphereGeometry(r, 40, 24), isCut };
  }
  if (id === "cone") {
    const rb = Math.max(0.01, _num(values.bottom_radius, 10));
    const rt = Math.max(0, _num(values.top_radius, 0));
    const h = Math.max(0.01, _num(values.height, 20));
    const geo = new THREE.CylinderGeometry(rt, rb, h, 48);
    geo.rotateX(Math.PI / 2);
    return { geometry: geo, isCut };
  }
  if (id === "torus") {
    const major = Math.max(0.01, _num(values.major_radius, 20));
    const minor = Math.max(0.01, _num(values.minor_radius, 5));
    return { geometry: new THREE.TorusGeometry(major, minor, 24, 64), isCut };
  }
  if (id === "hole") {
    const d = Math.max(0.01, _num(values.diameter, 5));
    const depth = _num(values.depth, 0);
    const h = depth > 0 ? depth : Math.max(40, d * 8);
    const geo = new THREE.CylinderGeometry(d / 2, d / 2, h, 40);
    geo.rotateX(Math.PI / 2);
    return { geometry: geo, isCut: true };
  }
  if (id === "revolve" || id === "groove") {
    const preset = values.profile_preset || (id === "groove" ? "L-profile" : "vase");
    const scale = _num(values.scale, 20);
    const angle = _num(values.angle, 360);
    const pts = _profilePoints(preset, scale);
    return { geometry: _revolveGeometry(pts, angle), isCut: isCut || id === "groove" };
  }
  if (
    id === "extrude" ||
    id === "pad" ||
    id === "pocket" ||
    id === "boolean" ||
    id === "loft"
  ) {
    const preset = values.profile_preset || "square";
    const size = _num(values.profile_size, 20);
    const height = Math.max(0.01, _num(values.height, 10));
    const pts = _profilePoints(preset, size);
    return {
      geometry: _extrudeGeometry(pts, height),
      isCut: isCut || id === "pocket" || id === "boolean",
    };
  }
  return { geometry: new THREE.BoxGeometry(20, 20, 10), isCut };
}

function _disposeMesh(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose?.();
  if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose?.());
  else mesh.material?.dispose?.();
  mesh.children?.forEach?.((c) => {
    c.geometry?.dispose?.();
    c.material?.dispose?.();
  });
}

/**
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {() => THREE.Camera} opts.getCamera
 * @param {() => HTMLElement} opts.getDomElement
 * @param {() => object|null} [opts.getControls]
 * @param {(kind: string, msg: string) => void} [opts.onStatus]
 */
export function createSolidPreview({
  scene,
  getCamera,
  getDomElement,
  getControls,
  onStatus,
} = {}) {
  let group = null;
  let mesh = null;
  let entry = null;
  let values = {};
  let at = [0, 0, 0];
  let placing = false;
  let drawing = false;
  let drawPhase = null; // "base" | "height"
  let drawPointerId = null;
  let drawStart = null;
  let drawCorner = null;
  let drawRadius = 0;
  let drawHeight = 10;
  let heightPlane = null;
  let heightDrag = null; // { clientY, height } — screen-space height (stable proportions)
  let raycaster = new THREE.Raycaster();
  let pointer = new THREE.Vector2();
  let floorPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  function _ensureGroup() {
    if (group && scene.children.includes(group)) return group;
    group = new THREE.Group();
    group.name = "create-solid-preview";
    group.renderOrder = 998;
    scene.add(group);
    return group;
  }

  function _snap(v, step = 0.5) {
    if (!Number.isFinite(step) || step <= 0) return v;
    return Math.round(v / step) * step;
  }

  function _emitDims() {
    window.dispatchEvent(
      new CustomEvent("render3d:create-preview-dims", {
        detail: {
          entryId: entry?.id,
          values: { ...values },
          at: [...at],
        },
      }),
    );
  }

  function _baseFootprint() {
    if (entry?.id === "box" && drawStart && drawCorner) {
      return Math.max(
        1,
        Math.abs(drawCorner.x - drawStart.x),
        Math.abs(drawCorner.y - drawStart.y),
      );
    }
    return Math.max(1, drawRadius * 2, _num(values.length, 0), _num(values.width, 0), 20);
  }

  /** Map vertical mouse motion to height — avoids sky-high boxes from far plane hits. */
  function _heightFromPointer(ev) {
    if (!heightDrag) {
      heightDrag = {
        clientY: ev.clientY,
        height: Math.max(0.5, Math.abs(drawHeight) || Math.min(10, _baseFootprint() * 0.5)),
      };
    }
    const cam = getCamera?.();
    const anchor = drawStart || new THREE.Vector3(at[0], at[1], 0);
    const dist = cam && anchor
      ? Math.max(40, cam.position.distanceTo(anchor))
      : 120;
    // ~half the footprint per ~120px drag feels like a normal box, not a tower.
    const worldPerPx = Math.max(0.05, Math.min(dist * 0.0022, _baseFootprint() / 80));
    const dy = heightDrag.clientY - ev.clientY;
    let h = heightDrag.height + dy * worldPerPx;
    if (Math.abs(h) < 0.5) h = Math.sign(h || 1) * 0.5;
    // Soft cap: height rarely needs to be > 4× the larger base side while sketching.
    const cap = Math.max(50, _baseFootprint() * 4);
    if (Math.abs(h) > cap) h = Math.sign(h) * cap;
    return _snap(h, 0.5);
  }

  function _applyDrawToValues() {
    if (!entry || !drawStart) return;
    const id = entry.id;
    if (id === "box" && drawCorner) {
      const length = Math.max(0.5, Math.abs(drawCorner.x - drawStart.x));
      const width = Math.max(0.5, Math.abs(drawCorner.y - drawStart.y));
      // Default height ~ half the smaller base side until the height drag runs.
      const defaultH = Math.max(0.5, Math.min(length, width) * 0.5 || 10);
      const height = Math.max(0.5, Math.abs(drawHeight) || defaultH);
      values = {
        ...values,
        length: _snap(length),
        width: _snap(width),
        height: _snap(height),
      };
      at = [
        (drawStart.x + drawCorner.x) / 2,
        (drawStart.y + drawCorner.y) / 2,
        Math.sign(drawHeight || 1) * (values.height / 2),
      ];
    } else if ((id === "cylinder" || id === "cone") && drawRadius > 0) {
      const defaultH = Math.max(0.5, drawRadius || 10);
      const height = Math.max(0.5, Math.abs(drawHeight) || defaultH);
      const r = _snap(Math.max(0.5, drawRadius));
      values = {
        ...values,
        radius: r,
        ...(id === "cone"
          ? { bottom_radius: r, top_radius: _num(values.top_radius, 0) }
          : {}),
        height: _snap(height),
      };
      at = [drawStart.x, drawStart.y, Math.sign(drawHeight || 1) * (values.height / 2)];
    } else if (id === "sphere" && drawRadius > 0) {
      values = { ...values, radius: _snap(Math.max(0.5, drawRadius)) };
      at = [drawStart.x, drawStart.y, values.radius];
    } else if (id === "torus" && drawRadius > 0) {
      const major = _snap(Math.max(1, drawRadius));
      values = {
        ...values,
        major_radius: major,
        minor_radius: _snap(Math.max(0.25, major / 4)),
      };
      at = [drawStart.x, drawStart.y, 0];
    } else {
      return;
    }
    values.at_x = at[0];
    values.at_y = at[1];
    values.at_z = at[2];
    _rebuild();
    _emitDims();
  }

  function _rebuild() {
    if (!entry) return;
    const g = _ensureGroup();
    if (mesh) {
      g.remove(mesh);
      _disposeMesh(mesh);
      mesh = null;
    }
    const { geometry, isCut } = _geometryFor(entry.id, values);
    const mat = new THREE.MeshStandardMaterial({
      color: isCut ? CUT_COLOR : PREVIEW_COLOR,
      transparent: true,
      opacity: isCut ? 0.38 : 0.45,
      metalness: 0.05,
      roughness: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mesh = new THREE.Mesh(geometry, mat);
    mesh.name = `preview:${entry.id}`;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 25),
      new THREE.LineBasicMaterial({
        color: isCut ? 0xff7b72 : 0x79b8ff,
        transparent: true,
        opacity: 0.95,
      }),
    );
    mesh.add(edges);
    g.add(mesh);
    g.position.set(_num(at[0]), _num(at[1]), _num(at[2]));
  }

  function _readAtFromValues(v) {
    if (v.at_x != null || v.at_y != null || v.at_z != null) {
      return [_num(v.at_x, at[0]), _num(v.at_y, at[1]), _num(v.at_z, at[2])];
    }
    return at;
  }

  function start(nextEntry, initialValues = {}) {
    stop();
    entry = nextEntry;
    values = { ...initialValues };
    at = _readAtFromValues(values);
    placing = true;
    drawing = DRAWABLE.has(entry.id);
    drawPhase = null;
    const centeredIds = new Set(["box", "cylinder", "cone", "sphere", "torus"]);
    if (
      centeredIds.has(entry.id) &&
      Math.abs(at[0]) < 1e-9 &&
      Math.abs(at[1]) < 1e-9 &&
      Math.abs(at[2]) < 1e-9
    ) {
      const h =
        _num(values.height, 0) ||
        _num(values.radius, 0) * 2 ||
        10;
      at = [0, 0, h / 2];
    }
    _rebuild();
    _bindPointer();
    onStatus?.(
      "ok",
      drawing
        ? `${entry.label || "Create"}: drag on the floor to draw (like VibeCAD) · then OK · Build`
        : `${entry.label || "Create"}: adjust sizes in Tasks · click viewport to place · OK builds solid`,
    );
  }

  function update(nextValues = {}) {
    if (!entry) return;
    if (drawPointerId != null) return;
    values = { ...values, ...nextValues };
    const nextAt = _readAtFromValues(values);
    if (
      nextAt[0] !== at[0] ||
      nextAt[1] !== at[1] ||
      nextAt[2] !== at[2]
    ) {
      at = nextAt;
    }
    _rebuild();
  }

  function getAt() {
    return [...at];
  }

  function setAt(xyz) {
    if (!Array.isArray(xyz) || xyz.length < 3) return;
    at = [_num(xyz[0]), _num(xyz[1]), _num(xyz[2])];
    if (group) group.position.set(at[0], at[1], at[2]);
  }

  function stop() {
    _unbindPointer();
    placing = false;
    drawing = false;
    drawPhase = null;
    drawPointerId = null;
    drawStart = null;
    drawCorner = null;
    heightPlane = null;
    heightDrag = null;
    entry = null;
    values = {};
    if (mesh && group) {
      group.remove(mesh);
      _disposeMesh(mesh);
      mesh = null;
    }
    if (group) {
      scene.remove(group);
      group = null;
    }
    const controls = getControls?.();
    if (controls) controls.enabled = true;
  }

  function isActive() {
    return Boolean(entry);
  }

  function activeEntry() {
    return entry;
  }

  function _eventToPoint(ev, plane = floorPlane) {
    const cam = getCamera?.();
    const el = getDomElement?.();
    if (!cam || !el) return null;
    const rect = el.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, cam);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, hit)) return hit;
    return null;
  }

  function _uiBlock(ev) {
    return !!ev.target?.closest?.(
      "#create-task-banner, .ribbon-bar, button, input, select, textarea, .panel, .sidebar, .topbar",
    );
  }

  function _onPointerDown(ev) {
    if (!placing || !entry) return;
    if (ev.button !== 0) return;
    if (_uiBlock(ev)) return;

    if (drawing) {
      const pt = _eventToPoint(ev);
      if (!pt) return;
      ev.preventDefault();
      ev.stopPropagation();
      drawPointerId = ev.pointerId;
      try {
        getDomElement?.()?.setPointerCapture?.(drawPointerId);
      } catch (_) {}
      const controls = getControls?.();
      if (controls) controls.enabled = false;

      if (drawPhase === "height") {
        // Second gesture: drag up/down to set height (screen-space, stable proportions).
        drawPointerId = ev.pointerId;
        try {
          getDomElement?.()?.setPointerCapture?.(drawPointerId);
        } catch (_) {}
        const controls = getControls?.();
        if (controls) controls.enabled = false;
        heightDrag = null;
        heightPlane = null;
        drawHeight = _heightFromPointer(ev);
        _applyDrawToValues();
        return;
      }

      drawPhase = "base";
      drawStart = pt.clone();
      drawCorner = pt.clone();
      drawRadius = 0;
      heightDrag = null;
      heightPlane = null;
      drawHeight = Math.max(1, Math.min(10, _num(values.height, 10)));
      onStatus?.(
        "ok",
        entry.id === "sphere" || entry.id === "torus"
          ? "Drag to set size · release to finish"
          : "Drag base on the floor · release · then drag height",
      );
      return;
    }

    const pt = _eventToPoint(ev);
    if (!pt) return;
    const z = ev.shiftKey ? 0 : at[2];
    at = [pt.x, pt.y, z];
    if (group) group.position.set(at[0], at[1], at[2]);
    values = { ...values, at_x: at[0], at_y: at[1], at_z: at[2] };
    onStatus?.(
      "ok",
      `Placed at ${at[0].toFixed(1)}, ${at[1].toFixed(1)}, ${at[2].toFixed(1)} mm`,
    );
    window.dispatchEvent(
      new CustomEvent("render3d:create-preview-placed", {
        detail: { at: [...at], entryId: entry.id },
      }),
    );
    _emitDims();
  }

  function _onPointerMove(ev) {
    if (!drawing || drawPointerId == null || ev.pointerId !== drawPointerId) return;
    ev.preventDefault();

    if (drawPhase === "base") {
      const pt = _eventToPoint(ev);
      if (!pt || !drawStart) return;
      drawCorner = pt;
      drawRadius = Math.hypot(pt.x - drawStart.x, pt.y - drawStart.y);
      _applyDrawToValues();
      return;
    }

    if (drawPhase === "height") {
      drawHeight = _heightFromPointer(ev);
      _applyDrawToValues();
    }
  }

  function _onPointerUp(ev) {
    if (!drawing || drawPointerId == null || ev.pointerId !== drawPointerId) return;
    ev.preventDefault();
    try {
      getDomElement?.()?.releasePointerCapture?.(drawPointerId);
    } catch (_) {}
    drawPointerId = null;
    const controls = getControls?.();
    if (controls) controls.enabled = true;

    if (drawPhase === "base") {
      if (entry.id === "sphere" || entry.id === "torus") {
        if (drawRadius < 0.5) {
          onStatus?.("error", "Drag farther to set a size");
          drawPhase = null;
          return;
        }
        _applyDrawToValues();
        drawPhase = null;
        onStatus?.("ok", "Size set — tweak in Tasks or OK · Build");
        return;
      }
      const baseOk =
        entry.id === "box"
          ? drawCorner &&
            Math.hypot(drawCorner.x - drawStart.x, drawCorner.y - drawStart.y) > 0.5
          : drawRadius > 0.5;
      if (!baseOk) {
        onStatus?.("error", "Drag a larger base, then set height");
        drawPhase = null;
        return;
      }
      drawPhase = "height";
      heightPlane = null;
      heightDrag = null;
      // Start height proportional to the base — not a sky-high leftover.
      drawHeight = Math.max(0.5, Math.min(_baseFootprint() * 0.5, _num(values.height, 10) || 10));
      _applyDrawToValues();
      onStatus?.("ok", "Now click-drag up/down for height · release to finish");
      return;
    }

    if (drawPhase === "height") {
      _applyDrawToValues();
      drawPhase = null;
      onStatus?.("ok", "Solid drawn — click OK to place it");
    }
  }

  function _bindPointer() {
    const el = getDomElement?.();
    if (!el || el.__createPreviewBound) return;
    el.addEventListener("pointerdown", _onPointerDown, true);
    el.addEventListener("pointermove", _onPointerMove, true);
    el.addEventListener("pointerup", _onPointerUp, true);
    el.addEventListener("pointercancel", _onPointerUp, true);
    el.__createPreviewBound = true;
  }

  function _unbindPointer() {
    const el = getDomElement?.();
    if (!el || !el.__createPreviewBound) return;
    el.removeEventListener("pointerdown", _onPointerDown, true);
    el.removeEventListener("pointermove", _onPointerMove, true);
    el.removeEventListener("pointerup", _onPointerUp, true);
    el.removeEventListener("pointercancel", _onPointerUp, true);
    delete el.__createPreviewBound;
  }

  /**
   * Turn the live ghost into an opaque solid Group and tear down the preview.
   * @returns {{ object: THREE.Object3D, entryId: string, values: object, at: number[] } | null}
   */
  function commit(nextValues) {
    if (!entry || !mesh || !group) return null;
    if (nextValues && typeof nextValues === "object") {
      values = { ...values, ...nextValues };
      at = _readAtFromValues(values);
      _rebuild();
    }
    if (!mesh || !group) return null;

    const object = new THREE.Group();
    object.name = entry.label || entry.id || "Solid";
    const solidMat = new THREE.MeshStandardMaterial({
      color: 0xb8c0c8,
      metalness: 0.12,
      roughness: 0.48,
      side: THREE.DoubleSide,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x6e7681 });
    mesh.updateWorldMatrix(true, true);
    const clone = mesh.clone(true);
    clone.traverse((node) => {
      if (node.isMesh) {
        node.material = solidMat.clone();
        node.castShadow = true;
        node.receiveShadow = true;
        node.renderOrder = 0;
      } else if (node.isLineSegments) {
        node.material = edgeMat.clone();
      }
    });
    // Bake preview group transform onto the committed object.
    object.add(clone);
    object.position.copy(group.position);
    object.quaternion.copy(group.quaternion);
    object.scale.copy(group.scale);
    object.updateMatrixWorld(true);

    const result = {
      object,
      entryId: entry.id,
      label: entry.label || entry.id,
      values: { ...values },
      at: [...at],
    };
    stop();
    return result;
  }

  return {
    start,
    update,
    stop,
    commit,
    getAt,
    setAt,
    isActive,
    activeEntry,
  };
}
