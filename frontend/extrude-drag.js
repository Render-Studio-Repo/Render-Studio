import * as THREE from "three";
import { pickFaceAt } from "./picking.js";

const MM_PER_IN = 25.4;

function convexHull2D(points) {
  if (points.length <= 2) return points;
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function getTriangleVertexIndices(geom, faceIndex) {
  const index = geom.index;
  if (index) {
    return [index.getX(faceIndex * 3), index.getX(faceIndex * 3 + 1), index.getX(faceIndex * 3 + 2)];
  }
  const base = faceIndex * 3;
  return [base, base + 1, base + 2];
}

function faceRingWorld(meshObject, faceIndices) {
  const geom = meshObject.geometry;
  const posAttr = geom.attributes.position;
  const unique = new Map();
  for (const fi of faceIndices) {
    for (const vi of getTriangleVertexIndices(geom, fi)) {
      const v = new THREE.Vector3().fromBufferAttribute(posAttr, vi);
      meshObject.localToWorld(v);
      const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
      unique.set(key, v);
    }
  }
  const verts = [...unique.values()];
  if (verts.length < 3) return verts;

  const normal = new THREE.Vector3();
  const a = verts[0];
  const b = verts[1];
  const c = verts[2];
  normal.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
  const origin = new THREE.Vector3();
  verts.forEach((v) => origin.add(v));
  origin.divideScalar(verts.length);

  const helper = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(normal, helper).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();

  const flat = verts.map((pt) => {
    const d = pt.clone().sub(origin);
    return { x: d.dot(u), y: d.dot(v), world: pt };
  });
  const hull = convexHull2D(flat);
  return hull.map((p) => p.world);
}

function buildExtrudePreviewGeometry(ring, normal, distance) {
  const n = normal.clone().normalize();
  const dist = Math.max(distance, 0.001);
  const bottom = ring.map((v) => v.clone());
  const top = ring.map((v) => v.clone().add(n.clone().multiplyScalar(dist)));
  const positions = [];
  const indices = [];
  const addTri = (a, b, c) => {
    const base = positions.length / 3;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    indices.push(base, base + 1, base + 2);
  };

  if (bottom.length >= 3) {
    for (let i = 1; i < bottom.length - 1; i += 1) addTri(bottom[0], bottom[i + 1], bottom[i]);
    for (let i = 1; i < top.length - 1; i += 1) addTri(top[0], top[i], top[i + 1]);
    for (let i = 0; i < bottom.length; i += 1) {
      const j = (i + 1) % bottom.length;
      addTri(bottom[i], bottom[j], top[j]);
      addTri(bottom[i], top[j], top[i]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function formatDist(mm, units) {
  if (units === "in") return `${(mm / MM_PER_IN).toFixed(4)} in`;
  return `${mm.toFixed(2)} mm`;
}

export function createExtrudeDragTool({
  scene,
  camera,
  domElement,
  getMeshRoot,
  getMeshCenterOffset,
  getUnitScale,
  getState,
  api,
  onApplied,
  onStatus,
  onDistanceChange,
  getUnits = () => "mm",
}) {
  const group = new THREE.Group();
  group.name = "extrude-drag";
  scene.add(group);

  let active = false;
  let mode = "face"; // face | profile
  let face = null;
  let dragging = false;
  let dragStartDist = 0;
  let distanceModel = 10;
  let inward = false;
  let previewMesh = null;
  let arrow = null;
  let labelSprite = null;
  let hudEl = null;
  let profileValues = null;
  let profileFeatureOf = null;
  let pointerStart = null;
  let suppressClick = false;

  function ensureHud() {
    if (hudEl) return hudEl;
    hudEl = document.createElement("div");
    hudEl.className = "extrude-drag-hud hidden";
    hudEl.innerHTML = `<strong>Extrude</strong><span class="extrude-drag-dist">—</span><span class="extrude-drag-hint muted small">Drag along the arrow · release to apply · Esc cancel</span>`;
    document.getElementById("viewport")?.appendChild(hudEl);
    return hudEl;
  }

  function modelToMm(native) {
    return native * (getUnitScale?.().toMm ?? 1);
  }

  function mmToModel(mm) {
    const toMm = getUnitScale?.().toMm ?? 1;
    return mm / toMm;
  }

  function clearOverlay() {
    while (group.children.length) {
      const c = group.children[0];
      c.geometry?.dispose();
      c.material?.dispose();
      group.remove(c);
    }
    previewMesh = null;
    arrow = null;
    labelSprite = null;
  }

  function updateHud() {
    const hud = ensureHud();
    const distEl = hud.querySelector(".extrude-drag-dist");
    const mm = modelToMm(Math.abs(distanceModel));
    if (distEl) distEl.textContent = formatDist(mm, getUnits());
    onDistanceChange?.(mm);
    hud.classList.toggle("hidden", !active);
  }

  function redrawOverlay() {
    clearOverlay();
    if (!face || distanceModel <= 0) return;
    if (mode === "profile") {
      redrawProfilePreview();
      return;
    }
    const meshRoot = getMeshRoot?.();
    if (!meshRoot || !face.mesh_object) return;

    const ring = faceRingWorld(face.mesh_object, face.face_indices?.length ? face.face_indices : [face.face_index]);
    if (!ring.length) return;

    const normal = face.normal.clone().normalize();
    if (inward) normal.multiplyScalar(-1);
    const dist = inward ? -distanceModel : distanceModel;

    const geo = buildExtrudePreviewGeometry(ring, normal, dist);
    previewMesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x58a6ff,
        transparent: true,
        opacity: 0.45,
        metalness: 0.1,
        roughness: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    previewMesh.renderOrder = 1002;
    group.add(previewMesh);

    const centroid = new THREE.Vector3();
    ring.forEach((v) => centroid.add(v));
    centroid.divideScalar(ring.length);
    const end = centroid.clone().add(normal.clone().multiplyScalar(dist));
    const arrowDir = end.clone().sub(centroid).normalize();
    arrow = new THREE.ArrowHelper(arrowDir, centroid, Math.max(Math.abs(dist), 0.01), 0xffa657, Math.abs(dist) * 0.12, Math.abs(dist) * 0.08);
    arrow.renderOrder = 1003;
    group.add(arrow);

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const text = formatDist(modelToMm(Math.abs(distanceModel)), getUnits());
    if (ctx) {
      ctx.fillStyle = "rgba(13,17,23,0.9)";
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = "#e6edf3";
      ctx.font = "bold 28px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 128, 32);
    }
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    labelSprite = new THREE.Sprite(mat);
    labelSprite.position.copy(end);
    labelSprite.scale.set(Math.abs(dist) * 0.5, Math.abs(dist) * 0.15, 1);
    labelSprite.renderOrder = 1004;
    group.add(labelSprite);
  }

  function redrawProfilePreview() {
    if (!profileValues || !profileFeatureOf) return;
    try {
      const feat = profileFeatureOf({ ...profileValues, height: String(modelToMm(distanceModel)) });
      const shape = new THREE.Shape();
      const pts = feat.profile || [];
      if (pts.length >= 3) {
        shape.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i += 1) shape.lineTo(pts[i][0], pts[i][1]);
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: distanceModel, bevelEnabled: false });
        previewMesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            color: 0x58a6ff,
            transparent: true,
            opacity: 0.5,
            metalness: 0.1,
            roughness: 0.6,
          }),
        );
        group.add(previewMesh);
      }
    } catch (_) {
      /* preview optional */
    }
  }

  function distanceFromPointer(event) {
    if (mode === "profile" && pointerStart) {
      const dy = pointerStart.y - event.clientY;
      const scale = getUnitScale?.().toMm ?? 1;
      const sens = 0.12 / scale;
      return Math.max(mmToModel(0.5), dragStartDist + dy * sens);
    }
    if (!face) return distanceModel;
    const rect = domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const normal = face.normal.clone().normalize();
    if (inward) normal.multiplyScalar(-1);
    const centroid = face.position.clone();
    const meshRoot = getMeshRoot?.();
    if (meshRoot && face.localPoint) {
      const local = face.localPoint.clone();
      meshRoot.localToWorld(local);
      centroid.copy(local);
    }
    const plane = new THREE.Plane(normal, -normal.dot(centroid));
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return distanceModel;
    let dist = hit.clone().sub(centroid).dot(normal);
    if (!Number.isFinite(dist)) dist = distanceModel;
    return Math.max(mmToModel(0.1), Math.abs(dist));
  }

  async function commitFaceExtrude() {
    const { projectId, selectedFile } = getState?.() || {};
    if (!projectId || !selectedFile || !face) return;
    const distance_mm = modelToMm(distanceModel);
    if (distance_mm <= 0) {
      onStatus?.("error", "Extrude distance must be > 0");
      return;
    }
    onStatus?.("loading", "Extruding…");
    try {
      const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(selectedFile)}/extrude`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          face_index: face.face_index,
          distance_mm,
          inward,
          axis: [face.normal.x, face.normal.y, face.normal.z],
        }),
      });
      onStatus?.("ok", `Extruded ${formatDist(distance_mm, getUnits())}`);
      await onApplied?.(data);
      stop();
    } catch (err) {
      onStatus?.("error", err.message || "Extrude failed");
    }
  }

  async function commitProfileExtrude() {
    if (!profileFeatureOf || !profileValues) return;
    const height = modelToMm(distanceModel);
    const values = { ...profileValues, height: String(height) };
    try {
      const feat = profileFeatureOf(values);
      onStatus?.("loading", "Building extrusion…");
      await onApplied?.({ profileFeature: feat, label: "Extrude" });
      stop();
    } catch (err) {
      onStatus?.("error", err.message || "Build failed");
    }
  }

  function startFace() {
    active = true;
    mode = "face";
    face = null;
    dragging = false;
    distanceModel = mmToModel(10);
    inward = document.getElementById("extrude-inward")?.checked || false;
    ensureHud();
    updateHud();
    onStatus?.("info", "Click a face, then drag along the arrow to set depth");
    domElement.classList.add("extrude-drag-mode");
  }

  function startProfile(values, featureOf) {
    active = true;
    mode = "profile";
    profileValues = values;
    profileFeatureOf = featureOf;
    face = {
      position: new THREE.Vector3(0, 0, 0),
      normal: new THREE.Vector3(0, 0, 1),
      localPoint: new THREE.Vector3(0, 0, 0),
      face_index: 0,
      face_indices: [0],
      mesh_object: null,
    };
    distanceModel = mmToModel(15);
    dragging = false;
    ensureHud();
    updateHud();
    redrawOverlay();
    domElement.classList.add("extrude-drag-mode");
    onStatus?.("info", "Drag vertically to set extrude depth");
  }

  function stop() {
    active = false;
    dragging = false;
    face = null;
    profileValues = null;
    profileFeatureOf = null;
    clearOverlay();
    hudEl?.classList.add("hidden");
    domElement.classList.remove("extrude-drag-mode");
    document.getElementById("viewport")?.classList.remove("extrude-drag-mode");
  }

  function onPointerDown(event) {
    if (!active) return false;
    pointerStart = { x: event.clientX, y: event.clientY };
    if (mode === "face" && !face) return false;
    dragging = true;
    dragStartDist = distanceModel;
    distanceModel = distanceFromPointer(event);
    redrawOverlay();
    updateHud();
    return true;
  }

  function onPointerMove(event) {
    if (!active) return false;
    if (mode === "face" && !face) return false;
    if (!dragging) return false;
    distanceModel = distanceFromPointer(event);
    redrawOverlay();
    updateHud();
    return true;
  }

  async function onPointerUp(event) {
    if (!active) return false;
    if (pointerStart) {
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      if (!dragging && dx * dx + dy * dy < 36 && mode === "face" && !face) {
        return false;
      }
    }
    if (!dragging) return false;
    dragging = false;
    suppressClick = true;
    if (mode === "face") await commitFaceExtrude();
    else await commitProfileExtrude();
    return true;
  }

  function onClick(event) {
    if (suppressClick) {
      suppressClick = false;
      return true;
    }
    if (!active || mode !== "face" || face) return false;
    const picked = pickFaceAt(event, {
      camera,
      domElement,
      meshRoot: getMeshRoot?.(),
      meshCenterOffset: getMeshCenterOffset?.(),
    });
    if (!picked) return false;
    face = picked;
    distanceModel = mmToModel(10);
    redrawOverlay();
    updateHud();
    onStatus?.("info", "Drag along the blue arrow to set extrude depth, release to apply");
    return true;
  }

  function setInward(value) {
    inward = !!value;
    if (active && face) redrawOverlay();
  }

  return {
    isActive: () => active,
    startFace,
    startProfile,
    stop,
    onClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    setInward,
    setDistanceMm: (mm) => {
      distanceModel = mmToModel(mm);
      redrawOverlay();
      updateHud();
    },
  };
}
