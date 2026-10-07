/**
 * Fusion-style direct modeling tools for the viewport.
 *
 * Press-Pull: click a planar face region, drag the arrow handle to pull
 * (join) or push (cut) material with a live ghost preview, or type an exact
 * distance ("12.5mm", "0.5in"). Options: join/cut/intersect/new body,
 * one-sided/symmetric/two-sided, taper angle, through-all cuts.
 *
 * Mirror: pick an origin plane (YZ/XZ/XY), drag it along its normal or type
 * an offset, see a live mirrored ghost, then keep/join/replace.
 *
 * All math is done in world space; values sent to the API are converted to
 * the server mesh's native units via the mesh child's world transform.
 */

import * as THREE from "three";
import { profileWorldData } from "./sketch-plane.js";
import {
  catalogNormalFromHit,
  catalogPointFromHit,
  pickKernelFace,
} from "../viewport/picking.js?v=20260907-kernel-topo&editctx=20260915-1&editscale=20260915-1";
import {
  getUnits,
  parseLength,
  formatLength,
  displayValue,
  unitSuffix,
  onUnitsChanged,
} from "../studio/units.js?v=20260714-units-ft-m";
import { createFloatingPanelBehavior } from "../studio/floating-panel.js?v=20260611-hud-drag";

const HOVER_COLOR = 0x58a6ff;
const JOIN_COLOR = 0x3fb950;
const CUT_COLOR = 0xf85149;
const HANDLE_COLOR = 0x4f8cff;

const SNAP_CHOICES = {
  mm: [0, 0.1, 0.5, 1, 5],
  in: [0, 25.4 / 32, 25.4 / 16, 25.4 / 8, 25.4 / 4],
};
const SNAP_LABELS = {
  mm: ["Off", "0.1 mm", "0.5 mm", "1 mm", "5 mm"],
  in: ["Off", '1/32"', '1/16"', '1/8"', '1/4"'],
};

// ───────────────────────── geometry helpers ─────────────────────────────────

function vertKey(x, y, z) {
  return `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
}

function triVertexIndices(geom, faceIndex) {
  const index = geom.index;
  if (index) {
    return [index.getX(faceIndex * 3), index.getX(faceIndex * 3 + 1), index.getX(faceIndex * 3 + 2)];
  }
  const base = faceIndex * 3;
  return [base, base + 1, base + 2];
}

/** Merged-vertex adjacency + per-face merged indices, cached per geometry. */
const regionCache = new WeakMap();
function getTopology(geom) {
  let topo = regionCache.get(geom);
  if (topo) return topo;
  const pos = geom.attributes.position;
  const triCount = geom.index ? geom.index.count / 3 : pos.count / 3;
  const keyToMerged = new Map();
  const mergedPositions = [];
  const faceMerged = new Array(triCount);
  const edgeToFaces = new Map();
  for (let f = 0; f < triCount; f++) {
    const idx = triVertexIndices(geom, f);
    const m = idx.map((vi) => {
      const k = vertKey(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
      let mi = keyToMerged.get(k);
      if (mi === undefined) {
        mi = mergedPositions.length;
        mergedPositions.push(new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi)));
        keyToMerged.set(k, mi);
      }
      return mi;
    });
    faceMerged[f] = m;
    for (let e = 0; e < 3; e++) {
      const a = m[e];
      const b = m[(e + 1) % 3];
      const ek = a < b ? `${a}_${b}` : `${b}_${a}`;
      let arr = edgeToFaces.get(ek);
      if (!arr) edgeToFaces.set(ek, (arr = []));
      arr.push(f);
    }
  }
  const adjacency = new Array(triCount);
  for (let f = 0; f < triCount; f++) adjacency[f] = [];
  for (const faces of edgeToFaces.values()) {
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        adjacency[faces[i]].push(faces[j]);
        adjacency[faces[j]].push(faces[i]);
      }
    }
  }
  topo = { mergedPositions, faceMerged, adjacency, triCount };
  regionCache.set(geom, topo);
  return topo;
}

function faceLocalNormal(topo, f) {
  const [a, b, c] = topo.faceMerged[f];
  const vA = topo.mergedPositions[a];
  const vB = topo.mergedPositions[b];
  const vC = topo.mergedPositions[c];
  return new THREE.Vector3().crossVectors(vB.clone().sub(vA), vC.clone().sub(vA)).normalize();
}

/** Grow the planar region around a picked triangle. */
function growRegion(geom, faceIndex, tol = 0.9986) {
  const topo = getTopology(geom);
  const startN = faceLocalNormal(topo, faceIndex);
  const seen = new Set([faceIndex]);
  const queue = [faceIndex];
  while (queue.length) {
    const cur = queue.pop();
    for (const nb of topo.adjacency[cur]) {
      if (seen.has(nb)) continue;
      if (faceLocalNormal(topo, nb).dot(startN) >= tol) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return { topo, faces: [...seen], normalLocal: startN };
}

/** Pack a region into world-space data ready for prism building.
 *  Pass `cam` (a THREE.Camera) so the outward-facing normal is resolved correctly.
 */
function regionWorldData(mesh, region, hit = null, cam = null) {
  mesh.updateWorldMatrix(true, false);
  const mw = mesh.matrixWorld;
  const usedSet = new Set();
  for (const f of region.faces) for (const mi of region.topo.faceMerged[f]) usedSet.add(mi);
  const used = [...usedSet];
  const remap = new Map(used.map((mi, i) => [mi, i]));
  const verts = used.map((mi) => region.topo.mergedPositions[mi].clone().applyMatrix4(mw));
  const tris = region.faces.map((f) => region.topo.faceMerged[f].map((mi) => remap.get(mi)));
  const directed = new Set();
  for (const [a, b, c] of tris) {
    directed.add(`${a}_${b}`);
    directed.add(`${b}_${c}`);
    directed.add(`${c}_${a}`);
  }
  const boundary = [];
  for (const ek of directed) {
    const [a, b] = ek.split("_").map(Number);
    if (!directed.has(`${b}_${a}`)) boundary.push([a, b]);
  }
  const centroid = verts.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / verts.length);
  // Use the picked triangle normal (matches Three.js / raycast winding), not just cross-product order.
  let normal;
  if (hit?.face?.normal) {
    normal = hit.face.normal.clone().transformDirection(mw).normalize();
  } else {
    normal = region.normalLocal.clone().transformDirection(mw).normalize();
  }
  // Arrow points outward from the solid (toward the camera that picked the face).
  if (cam) {
    const toCamera = cam.position.clone().sub(centroid);
    if (normal.dot(toCamera) < 0) normal.negate();
  }
  const scale = new THREE.Vector3().setFromMatrixColumn(mw, 0).length() || 1;
  return { verts, tris, boundary, normal, centroid, scale };
}

/** Build a world-space prism BufferGeometry from region data between t0..t1. */
function prismGeometry(data, t0, t1, taperDeg = 0) {
  const { verts, tris, boundary, normal, centroid } = data;
  const nv = verts.length;
  const bottom = verts.map((v) => v.clone().addScaledVector(normal, t0));
  let top = verts.map((v) => v.clone().addScaledVector(normal, t1));
  if (Math.abs(taperDeg) > 1e-9) {
    const span = Math.abs(t1 - t0);
    const apex = centroid.clone().addScaledVector(normal, t1);
    let rMax = 0;
    const inPlane = top.map((v) => {
      const d = v.clone().sub(apex);
      d.addScaledVector(normal, -d.dot(normal));
      rMax = Math.max(rMax, d.length());
      return d;
    });
    const s = THREE.MathUtils.clamp(1 - (Math.tan(THREE.MathUtils.degToRad(taperDeg)) * span) / (rMax || 1), 0.05, 10);
    top = inPlane.map((d) => apex.clone().addScaledVector(d, s));
  }
  const positions = new Float32Array((nv * 2) * 3);
  bottom.forEach((v, i) => positions.set([v.x, v.y, v.z], i * 3));
  top.forEach((v, i) => positions.set([v.x, v.y, v.z], (nv + i) * 3));
  const idx = [];
  for (const [a, b, c] of tris) {
    idx.push(c, b, a); // bottom cap flipped
    idx.push(a + nv, b + nv, c + nv); // top cap
  }
  for (const [a, b] of boundary) {
    idx.push(a, b, b + nv, a, b + nv, a + nv);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  return geom;
}

function sceneScaleOf(data) {
  // rough world-size of the region, used for tiny offsets
  const box = new THREE.Box3();
  for (const v of data.verts) box.expandByPoint(v);
  return Math.max(box.getSize(new THREE.Vector3()).length(), 0.001);
}

function disposeObj(obj) {
  obj?.traverse?.((c) => {
    c.geometry?.dispose?.();
    if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
    else c.material?.dispose?.();
  });
}

// ───────────────────────── main controller ──────────────────────────────────

export function createDirectModeling({
  scene,
  camera,
  renderer,
  controls,
  viewport,
  getMesh,
  getModelInfo, // () => ({ projectId, filename })
  getFilenameForMesh,
  getRootForMesh,
  onSelectFilename,
  api,
  onApplied, // async (data) => {}
  onStatus, // (kind, text) => {}
  onToolChange, // (tool|null) => {}
  pickSketch, // (event) => sketchData | null
  getSketchExtrudeMeta, // (sketchData) => { combine?, onApply? }
  ensureSolidReady, // async () => ({ filename?, mesh? } | null) — await kernel persist for instant solids
  getKernelTopo,
  session = null,
}) {
  const dom = renderer.domElement;
  const raycaster = new THREE.Raycaster();

  function planeNormalFor(skPlane) {
    if (skPlane === "XZ") return new THREE.Vector3(0, 1, 0);
    if (skPlane === "YZ") return new THREE.Vector3(1, 0, 0);
    return new THREE.Vector3(0, 0, 1);
  }

  function planeAxesFor(skPlane) {
    if (skPlane === "XZ") return { u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1) };
    if (skPlane === "YZ") return { u: new THREE.Vector3(0, 1, 0), v: new THREE.Vector3(0, 0, 1) };
    return { u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) };
  }

  /** 2D sketch profile → world-space region for extrude preview. */
  function profileWorldDataLegacy(profile, skPlane) {
    const ax = planeAxesFor(skPlane);
    const verts = profile.map(([u, v]) =>
      ax.u.clone().multiplyScalar(u).add(ax.v.clone().multiplyScalar(v))
    );
    const tris = [];
    for (let i = 1; i < verts.length - 1; i++) tris.push([0, i, i + 1]);
    const boundary = verts.map((_, i) => [i, (i + 1) % verts.length]);
    const centroid = verts.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / verts.length);
    let normal = planeNormalFor(skPlane).clone();
    const toCamera = camera.position.clone().sub(centroid);
    if (normal.dot(toCamera) < 0) normal.negate();
    return { verts, tris, boundary, normal, centroid, scale: 1 };
  }

  function sketchProfileWorldData(profile, sketchData) {
    if (sketchData?.plane_ref || (typeof sketchData === "object" && sketchData?.plane)) {
      return profileWorldData(profile, sketchData);
    }
    return profileWorldDataLegacy(profile, typeof sketchData === "string" ? sketchData : "XY");
  }

  function normalizeTool(next) {
    if (!next || next === "off") return null;
    return next;
  }

  let tool = null; // null | "presspull" | "mirror"
  let busy = false;

  function editTarget(filename = null) {
    const current = getModelInfo?.() || {};
    return {
      ...current,
      filename: filename || current.filename || current.viewerFilename,
      viewerFilename: filename || current.viewerFilename || current.viewer_filename || current.filename,
      catalogTarget: current.catalogTarget || current.catalog_name || current.filename || filename,
    };
  }

  function beginEdit(operation, filename = null) {
    return session?.begin?.(operation, editTarget(filename)) || null;
  }

  function guardEdit(ticket, filename = null) {
    session?.assertCurrent?.(ticket, editTarget(filename));
  }

  function acceptEdit(ticket, data) {
    return session?.acceptMutation?.(ticket, data) || data;
  }

  const group = new THREE.Group();
  group.name = "direct-modeling";
  scene.add(group);

  // ── shared helpers ─────────────────────────────────────────────────────────

  function ndc(event) {
    const rect = dom.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  function castModel(event) {
    const mesh = getMesh();
    if (!mesh) return null;
    raycaster.setFromCamera(ndc(event), camera);
    const hits = raycaster.intersectObject(mesh, true).filter((h) => h.object.isMesh && h.faceIndex != null);
    return hits[0] || null;
  }

  function meshWorldExtent() {
    const mesh = getMesh();
    if (!mesh) return 1;
    const box = new THREE.Box3().setFromObject(mesh);
    return Math.max(box.getSize(new THREE.Vector3()).length(), 0.001);
  }

  /** mm per server unit, using a mesh child's scale (kernel parts are mm, legacy meshes metres). */
  function mmPerServerUnit(childScale) {
    const serverExtent = meshWorldExtent() / (childScale || 1);
    return serverExtent >= 1.0 ? 1 : 1000;
  }

  /** Signed distance along `origin + t * dir` closest to the pointer ray. */
  function axisParamAtPointer(event, origin, dir) {
    raycaster.setFromCamera(ndc(event), camera);
    const r0 = raycaster.ray.origin;
    const rd = raycaster.ray.direction;
    const w0 = origin.clone().sub(r0);
    const a = dir.dot(dir);
    const b = dir.dot(rd);
    const c = rd.dot(rd);
    const d = dir.dot(w0);
    const e = rd.dot(w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-12) return 0;
    // Positive t = drag toward arrow tip (along dir).
    return (b * e - c * d) / denom;
  }

  function snapValueMm() {
    const sel = hud?.querySelector("[data-dm-snap]");
    if (!sel) return 0;
    return parseFloat(sel.value) || 0;
  }

  function applySnap(mm) {
    const inc = snapValueMm();
    if (inc > 0) return Math.round(mm / inc) * inc;
    return mm;
  }

  // ── HUD (floating input panel) ─────────────────────────────────────────────

  let hud = null;
  let hudFloat = null;

  function destroyHud() {
    hudFloat?.reset();
    hudFloat = null;
    hud?.remove();
    hud = null;
  }

  function createHud(html) {
    destroyHud();
    hud = document.createElement("div");
    hud.className = "dm-hud floating-panel";
    hud.innerHTML = html;
    viewport.appendChild(hud);
    hudFloat = createFloatingPanelBehavior(viewport, hud);
    hudFloat.bindDrag();
    return hud;
  }

  function positionHud(worldPoint) {
    if (!hud || !hudFloat) return;
    const rect = dom.getBoundingClientRect();
    const p = worldPoint.clone().project(camera);
    const screenY = ((1 - p.y) / 2) * rect.height;
    hudFloat.dockRight(screenY);
  }

  function snapOptionsHtml() {
    const u = getUnits();
    const vals = SNAP_CHOICES[u];
    const labels = SNAP_LABELS[u];
    const def = u === "mm" ? 2 : 2;
    return vals
      .map((v, i) => `<option value="${v}" ${i === def ? "selected" : ""}>${labels[i]}</option>`)
      .join("");
  }

  // ── press-pull state ───────────────────────────────────────────────────────

  let pp = null; // { mesh, faceIndex, data, distanceServer, handle, hitMesh, ghost, dimLine, hover }
  let hoverMesh = null;
  let dragging = false;
  let dragStartParam = 0;
  let dragStartDistance = 0;

  function clearHover() {
    if (hoverMesh) {
      group.remove(hoverMesh);
      disposeObj(hoverMesh);
      hoverMesh = null;
    }
  }

  function clearPressPull() {
    clearHover();
    if (pp) {
      for (const k of ["handle", "hitMesh", "ghost", "dimLine"]) {
        if (pp[k]) {
          group.remove(pp[k]);
          disposeObj(pp[k]);
        }
      }
      pp = null;
    }
    destroyHud();
  }

  function showHoverFromData(data) {
    clearHover();
    const geom = prismGeometry(data, 0, sceneScaleOf(data) * 0.002);
    const mat = new THREE.MeshBasicMaterial({
      color: HOVER_COLOR,
      transparent: true,
      opacity: 0.4,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    hoverMesh = new THREE.Mesh(geom, mat);
    hoverMesh.renderOrder = 5;
    group.add(hoverMesh);
  }

  function showHover(hit) {
    const region = growRegion(hit.object.geometry, hit.faceIndex);
    const data = regionWorldData(hit.object, region, null, camera);
    showHoverFromData(data);
  }

  function showSketchHover(sketchData) {
    if (!sketchData?.profile?.length) return;
    showHoverFromData(sketchProfileWorldData(sketchData.profile, sketchData));
  }

  function buildHandle(data) {
    const extent = meshWorldExtent();
    const len = Math.max(extent * 0.28, 0.02);
    const shaftR = Math.max(extent * 0.012, 0.0015);
    const handle = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(shaftR, shaftR, len * 0.75, 16),
      new THREE.MeshBasicMaterial({ color: HANDLE_COLOR, depthTest: false, transparent: true, opacity: 0.95 })
    );
    shaft.position.y = len * 0.375;
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(shaftR * 3.4, len * 0.28, 20),
      new THREE.MeshBasicMaterial({ color: HANDLE_COLOR, depthTest: false, transparent: true, opacity: 0.95 })
    );
    head.position.y = len * 0.875;
    shaft.renderOrder = 20;
    head.renderOrder = 20;
    handle.add(shaft, head);
    handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), data.normal);
    handle.position.copy(data.centroid);

    // Generous invisible hit volume so the arrow is easy to grab (Fusion-like).
    const hitMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(shaftR * 12, shaftR * 12, len * 1.35, 10),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitMesh.position.y = len * 0.55;
    const hitWrap = new THREE.Group();
    hitWrap.add(hitMesh);
    hitWrap.quaternion.copy(handle.quaternion);
    hitWrap.position.copy(handle.position);
    return { handle, hitWrap };
  }

  function ppPromptHudHtml() {
    return `
      <div class="dm-hud-title">Press-Pull</div>
      <p class="dm-hud-hint muted small" style="margin:0 0 8px">Click a sketch profile or a face on the model to start.</p>
      <div class="dm-hud-actions">
        <button type="button" class="btn secondary" data-dm-cancel>Cancel</button>
      </div>`;
  }

  function bindHudCancel(el) {
    el.querySelector("[data-dm-cancel]")?.addEventListener("click", () => setTool(null));
  }

  function showPressPullPrompt() {
    if (taskBannerOpen()) return;
    const el = createHud(ppPromptHudHtml());
    bindHudCancel(el);
    hudFloat?.dockRight?.(Math.min(viewport.clientHeight * 0.35, 220));
  }

  function ppHudHtml({ defaultOp = "auto" } = {}) {
    const u = unitSuffix();
    const op = ["auto", "join", "cut", "intersect", "new_body"].includes(defaultOp) ? defaultOp : "auto";
    return `
      <div class="dm-hud-title">Press-Pull <span class="dm-hud-hint">drag arrow or type a value</span></div>
      <div class="dm-hud-row">
        <label>Distance</label>
        <input type="text" data-dm-distance value="0" spellcheck="false" />
        <span class="dm-hud-unit">${u}</span>
      </div>
      <div class="dm-hud-row">
        <label>Operation</label>
        <select data-dm-op>
          <option value="auto"${op === "auto" ? " selected" : ""}>Auto (pull = join, push = cut)</option>
          <option value="join"${op === "join" ? " selected" : ""}>Join / Extrude</option>
          <option value="cut"${op === "cut" ? " selected" : ""}>Cut</option>
          <option value="intersect"${op === "intersect" ? " selected" : ""}>Intersect</option>
          <option value="new_body"${op === "new_body" ? " selected" : ""}>New body</option>
        </select>
      </div>
      <div class="dm-hud-row">
        <label>Direction</label>
        <select data-dm-direction>
          <option value="one" selected>One side</option>
          <option value="symmetric">Symmetric</option>
          <option value="two">Two sided</option>
        </select>
      </div>
      <div class="dm-hud-row dm-hud-row-hidden" data-dm-distance2-row>
        <label>Side 2</label>
        <input type="text" data-dm-distance2 value="0" spellcheck="false" />
        <span class="dm-hud-unit">${u}</span>
      </div>
      <div class="dm-hud-row">
        <label>Taper</label>
        <input type="text" data-dm-taper value="0" spellcheck="false" />
        <span class="dm-hud-unit">°</span>
      </div>
      <div class="dm-hud-row">
        <label>Snap</label>
        <select data-dm-snap>${snapOptionsHtml()}</select>
        <label class="dm-hud-check"><input type="checkbox" data-dm-through /> Through all</label>
      </div>
      <div class="dm-hud-actions">
        <button type="button" class="btn secondary" data-dm-cancel>Cancel</button>
        <button type="button" class="btn primary" data-dm-apply>Apply</button>
      </div>`;
  }

  let preferredOp = "auto";
  let lastApplyError = "";

  function taskBannerOpen() {
    return document.body.classList.contains("create-task-banner-open");
  }

  function readTaskValuesFromDom() {
    const root = document.getElementById("create-task-banner");
    if (!root || root.classList.contains("hidden")) return null;
    const lengthEl = root.querySelector("[name=length]");
    if (!lengthEl && !root.querySelector("[name=combine]") && !root.querySelector("[name=type]")) {
      return null;
    }
    const lengthMm = parseLength(lengthEl?.value || "");
    const length2Mm = parseLength(root.querySelector("[name=length2]")?.value || "0");
    return {
      length: Number.isFinite(lengthMm) ? lengthMm : null,
      length2: Number.isFinite(length2Mm) ? length2Mm : 0,
      type: root.querySelector("[name=type]")?.value || "one",
      combine: root.querySelector("[name=combine]")?.value || preferredOp || "join",
      reversed: !!root.querySelector("[name=reversed]")?.checked,
      taper: parseFloat(root.querySelector("[name=taper]")?.value) || 0,
    };
  }

  function taskOptsFromValues(values) {
    const type = String(values?.type || "one");
    let op = String(values?.combine || preferredOp || "auto");
    if (op === "add") op = "join";
    if (op === "new") op = "new_body";
    return {
      op,
      direction: type === "two" ? "two" : type === "symmetric" ? "symmetric" : "one",
      taper_deg: Number(values?.taper) || 0,
      through_all: type === "through",
      distance2Mm: Number(values?.length2) || 0,
      reversed: !!values?.reversed,
    };
  }

  function emitTaskLength(mm) {
    if (!taskBannerOpen()) return;
    const lengthEl = document.querySelector("#create-task-banner [name=length]");
    if (lengthEl && document.activeElement === lengthEl && !dragging) return;
    window.dispatchEvent(
      new CustomEvent("render3d:create-preview-dims", {
        detail: { values: { length: mm } },
      }),
    );
  }

  function syncFromTaskValues(values) {
    if (!pp) return;
    const v = values && typeof values === "object" && Object.keys(values).length
      ? values
      : readTaskValuesFromDom();
    if (!v) {
      updatePressPullPreview({ skipInput: true, skipTaskEmit: true });
      return;
    }
    const mmScale = mmPerServerUnit(pp.data.scale);
    let mm = Number(v.length);
    if (Number.isFinite(mm)) {
      pp.distanceServer = mm / mmScale;
    }
    updatePressPullPreview({ skipInput: true, skipTaskEmit: true });
  }

  function lockPressPullFromData(data, meta = {}) {
    clearHover();
    if (pp) {
      for (const k of ["handle", "hitMesh", "ghost", "dimLine"]) {
        if (pp[k]) {
          group.remove(pp[k]);
          disposeObj(pp[k]);
        }
      }
      pp = null;
    }
    destroyHud();
    const { handle, hitWrap } = buildHandle(data);
    group.add(handle, hitWrap);
    pp = {
      mesh: meta.mesh || null,
      faceIndex: meta.faceIndex ?? null,
      faceIndices: Array.isArray(meta.faceIndices) ? meta.faceIndices : null,
      kernelFaceIndex: meta.kernelFaceIndex ?? null,
      kernelCenter: meta.kernelCenter || null,
      kernelNormal: meta.kernelNormal || null,
      bodyIndex: meta.bodyIndex ?? null,
      bodyName: meta.bodyName || null,
      sketchMode: !!meta.sketchMode,
      profile: meta.profile || null,
      plane: meta.plane || null,
      combine: meta.combine || "new",
      onApply: meta.onApply || null,
      data,
      distanceServer: 0,
      handle,
      hitMesh: hitWrap,
      ghost: null,
      dimLine: null,
    };
    const taskVals = readTaskValuesFromDom();
    if (taskVals && Number.isFinite(taskVals.length) && Math.abs(taskVals.length) > 1e-9) {
      pp.distanceServer = taskVals.length / mmPerServerUnit(data.scale);
    }
    if (!taskBannerOpen()) {
      const el = createHud(ppHudHtml({ defaultOp: meta.defaultOp || preferredOp }));
      if (meta.sketchMode) {
        const title = el.querySelector(".dm-hud-title");
        if (title) title.innerHTML = `Extrude <span class="dm-hud-hint">click a face or drag the arrow</span>`;
      }
      positionHud(data.centroid);
      el.querySelector("[data-dm-apply]").addEventListener("click", applyPressPull);
      el.querySelector("[data-dm-cancel]").addEventListener("click", () => setTool(null));
      el.querySelector("[data-dm-direction]").addEventListener("change", (e) => {
        el.querySelector("[data-dm-distance2-row]").classList.toggle("dm-hud-row-hidden", e.target.value !== "two");
        updatePressPullPreview();
      });
      el.querySelector("[data-dm-op]").addEventListener("change", updatePressPullPreview);
      el.querySelector("[data-dm-taper]").addEventListener("input", updatePressPullPreview);
      el.querySelector("[data-dm-distance2]").addEventListener("input", updatePressPullPreview);
      el.querySelector("[data-dm-through]").addEventListener("change", updatePressPullPreview);
      const distInput = el.querySelector("[data-dm-distance]");
      distInput.addEventListener("input", () => {
        const mm = parseLength(distInput.value);
        if (Number.isFinite(mm)) {
          pp.distanceServer = mm / mmPerServerUnit(pp.data.scale);
          updatePressPullPreview({ skipInput: true });
        }
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          applyPressPull();
        }
        if (e.key === "Escape") setTool(null);
        e.stopPropagation();
      });
    }
    onStatus?.(
      "ok",
      meta.sketchMode ? "Drag the arrow or type an extrude height" : "Face selected — drag the arrow or type a distance"
    );
    updatePressPullPreview();
    if (hud) requestAnimationFrame(() => positionHud(data.centroid));
  }

  function bodyMetaForMesh(mesh) {
    const root = getRootForMesh?.(mesh) || getMesh?.();
    const meshes = [];
    root?.traverse?.((obj) => {
      if (!obj?.isMesh || !obj.geometry) return;
      if (obj.userData?.isEdge || obj.userData?.isSilhouette || obj.userData?.isObjectHighlight) return;
      meshes.push(obj);
    });
    const bodyIndex = mesh && meshes.length ? Math.max(0, meshes.indexOf(mesh)) : null;
    const bodyName = String(mesh?.name || "").trim() || null;
    const filename = getFilenameForMesh?.(mesh) || getModelInfo?.()?.filename || null;
    return {
      bodyIndex: bodyIndex != null && bodyIndex >= 0 ? bodyIndex : null,
      bodyName,
      filename,
      bodyCount: meshes.length || 1,
    };
  }

  function kernelFaceWorldData(face, root, cam = null) {
    root.updateMatrixWorld(true);
    const mw = root.matrixWorld;
    const raw = face.tris || [];
    const verts = [];
    const tris = [];
    for (let i = 0; i + 8 < raw.length; i += 9) {
      const i0 = verts.length;
      verts.push(new THREE.Vector3(raw[i], raw[i + 1], raw[i + 2]).applyMatrix4(mw));
      verts.push(new THREE.Vector3(raw[i + 3], raw[i + 4], raw[i + 5]).applyMatrix4(mw));
      verts.push(new THREE.Vector3(raw[i + 6], raw[i + 7], raw[i + 8]).applyMatrix4(mw));
      tris.push([i0, i0 + 1, i0 + 2]);
    }
    if (!verts.length) {
      const c = new THREE.Vector3(...face.center).applyMatrix4(mw);
      const n = new THREE.Vector3(...(face.normal || [0, 0, 1])).transformDirection(mw).normalize();
      const bb = face.bbox || [];
      const size = bb.length >= 6 ? Math.max(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2], 1) * 0.2 : 2;
      const up = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(n, up).normalize().multiplyScalar(size);
      const v = new THREE.Vector3().crossVectors(n, u.clone().normalize()).normalize().multiplyScalar(size);
      verts.push(c.clone().add(u).add(v), c.clone().add(u).sub(v), c.clone().sub(u).sub(v), c.clone().sub(u).add(v));
      tris.push([0, 1, 2], [0, 2, 3]);
    }
    const centroid = new THREE.Vector3(...face.center).applyMatrix4(mw);
    let normal = new THREE.Vector3(...(face.normal || [0, 0, 1])).transformDirection(mw).normalize();
    if (cam) {
      const toCamera = cam.position.clone().sub(centroid);
      if (normal.dot(toCamera) < 0) normal.negate();
    }
    const scale = new THREE.Vector3().setFromMatrixColumn(mw, 0).length() || 1;
    return { verts, tris, boundary: [], normal, centroid, scale };
  }

  function kernelFaceForHit(hit) {
    const topo = getKernelTopo?.();
    if (topo?.kernel !== "freecad" || !hit) return null;
    const root = getRootForMesh?.(hit.object) || getMesh();
    const point = catalogPointFromHit(hit, root);
    const normal = catalogNormalFromHit(hit, root);
    return pickKernelFace(topo, point, normal);
  }

  function lockPressPull(hit) {
    const kernelFace = kernelFaceForHit(hit);
    if (kernelFace) {
      const root = getRootForMesh?.(hit.object) || getMesh();
      const data = kernelFaceWorldData(kernelFace, root, camera);
      const bodyMeta = bodyMetaForMesh(hit.object);
      lockPressPullFromData(data, {
        mesh: hit.object,
        faceIndex: kernelFace.index,
        faceIndices: [kernelFace.index],
        kernelFaceIndex: kernelFace.index,
        kernelCenter: kernelFace.center,
        kernelNormal: kernelFace.normal,
        bodyIndex: kernelFace.body_index ?? bodyMeta.bodyIndex,
        bodyName: bodyMeta.bodyName,
      });
      return;
    }
    const region = growRegion(hit.object.geometry, hit.faceIndex);
    const data = regionWorldData(hit.object, region, hit, camera);
    const bodyMeta = bodyMetaForMesh(hit.object);
    lockPressPullFromData(data, {
      mesh: hit.object,
      faceIndex: hit.faceIndex,
      faceIndices: region.faces,
      bodyIndex: bodyMeta.bodyIndex,
      bodyName: bodyMeta.bodyName,
    });
  }

  function findMeshByUuid(root, uuid) {
    let found = null;
    root?.traverse?.((obj) => {
      if (!found && obj.isMesh && obj.uuid === uuid) found = obj;
    });
    return found;
  }

  function startPressPullFromRef(ref) {
    if (!ref || (ref.face_index == null && ref.kernel_face_index == null)) return false;
    if (session && !session.referenceMatchesTarget?.(ref, editTarget(), { requireRevision: true })) {
      onStatus?.("error", "That face belongs to another model revision. Pick the face again on the current model.");
      return false;
    }
    const root = getMesh();
    const mesh = findMeshByUuid(root, ref.mesh_uuid) || (() => {
      let first = null;
      root?.traverse?.((obj) => {
        if (!first && obj.isMesh) first = obj;
      });
      return first;
    })();
    if (!mesh?.geometry) return false;
    ensureTool("presspull");
    const topo = getKernelTopo?.();
    const kernelIndex = ref.kernel_face_index ?? (ref.kernel === "freecad" ? ref.face_index : null);
    const face = Array.isArray(topo?.faces) ? topo.faces.find((item) => Number(item.index) === Number(kernelIndex)) : null;
    if (face) {
      const catalogRoot = getRootForMesh?.(mesh) || root;
      const data = kernelFaceWorldData(face, catalogRoot, camera);
      const bodyMeta = bodyMetaForMesh(mesh);
      lockPressPullFromData(data, {
        mesh,
        faceIndex: face.index,
        faceIndices: [face.index],
        kernelFaceIndex: face.index,
        kernelCenter: face.center,
        kernelNormal: face.normal,
        bodyIndex: face.body_index ?? bodyMeta.bodyIndex,
        bodyName: bodyMeta.bodyName,
      });
      return true;
    }
    lockPressPull({ object: mesh, faceIndex: Number(ref.face_index) });
    return true;
  }

  function beginAxisDrag(event) {
    if (!pp) return;
    dragging = true;
    dragKind = "pp-handle";
    dragStartParam = axisParamAtPointer(event, pp.data.centroid, pp.data.normal);
    dragStartDistance = pp.distanceServer * pp.data.scale;
    controls.enabled = false;
    try {
      dom.setPointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function tryPickFaceForPressPull(event) {
    const hit = castModel(event);
    if (!hit) return false;
    const fname = getFilenameForMesh?.(hit.object);
    if (fname) onSelectFilename?.(fname);
    lockPressPull(hit);
    return true;
  }

  function ppOptions() {
    const mmScale = mmPerServerUnit(pp?.data.scale || 1);
    const taskVals = readTaskValuesFromDom();
    if (taskVals && !hud) {
      const opts = taskOptsFromValues(taskVals);
      return {
        op: opts.op,
        direction: opts.direction,
        taper_deg: opts.taper_deg,
        through_all: opts.through_all,
        distance2: opts.distance2Mm / mmScale,
        reversed: opts.reversed,
      };
    }
    const op = hud?.querySelector("[data-dm-op]")?.value || "auto";
    const direction = hud?.querySelector("[data-dm-direction]")?.value || "one";
    const taper = parseFloat(hud?.querySelector("[data-dm-taper]")?.value) || 0;
    const through = !!hud?.querySelector("[data-dm-through]")?.checked;
    const d2mm = parseLength(hud?.querySelector("[data-dm-distance2]")?.value || "0");
    return {
      op,
      direction: direction === "two" ? "two" : direction,
      taper_deg: taper,
      through_all: through,
      distance2: Number.isFinite(d2mm) ? d2mm / mmScale : 0,
      reversed: false,
    };
  }

  function updatePressPullPreview({ skipInput = false, skipTaskEmit = false } = {}) {
    if (!pp) return;
    const opts = ppOptions();
    const dServer = pp.distanceServer;
    const dWorld = dServer * pp.data.scale;
    const isCut = opts.op === "cut" || (opts.op === "auto" && dServer < 0);
    const mag = Math.abs(dWorld);
    const pullSign = opts.reversed ? -1 : 1;

    // handle follows the pulled face
    pp.handle.position.copy(pp.data.centroid).addScaledVector(pp.data.normal, isCut ? 0 : dWorld * pullSign);
    pp.hitMesh.position.copy(pp.handle.position);

    if (pp.ghost) {
      group.remove(pp.ghost);
      disposeObj(pp.ghost);
      pp.ghost = null;
    }
    if (mag > 1e-9) {
      let t0;
      let t1;
      const extent = meshWorldExtent();
      if (isCut) {
        const depth = opts.through_all ? extent * 1.5 : mag;
        if (opts.direction === "symmetric") [t0, t1] = [-depth, depth];
        else if (opts.reversed) [t0, t1] = [extent * 0.0015, depth];
        else [t0, t1] = [-depth, extent * 0.0015];
      } else if (opts.direction === "symmetric") {
        [t0, t1] = [-mag, mag];
      } else if (opts.direction === "two") {
        [t0, t1] = [-Math.abs(opts.distance2 * pp.data.scale), mag * pullSign];
        if (t0 > t1) [t0, t1] = [t1, t0];
      } else if (opts.reversed) {
        [t0, t1] = [-mag, 0];
      } else {
        [t0, t1] = [0, mag];
      }
      const geom = prismGeometry(pp.data, t0, t1, opts.taper_deg);
      const mat = new THREE.MeshBasicMaterial({
        color: isCut ? CUT_COLOR : JOIN_COLOR,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });
      pp.ghost = new THREE.Mesh(geom, mat);
      pp.ghost.renderOrder = 18;
      group.add(pp.ghost);

      // Dimension line along pull axis
      if (pp.dimLine) {
        group.remove(pp.dimLine);
        disposeObj(pp.dimLine);
      }
      const p0 = pp.data.centroid.clone();
      const p1 = pp.handle.position.clone();
      const lineGeom = new THREE.BufferGeometry().setFromPoints([p0, p1]);
      pp.dimLine = new THREE.Line(
        lineGeom,
        new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: mag * 0.08, gapSize: mag * 0.04, depthTest: false })
      );
      pp.dimLine.computeLineDistances();
      pp.dimLine.renderOrder = 10;
      group.add(pp.dimLine);
    } else if (pp.dimLine) {
      group.remove(pp.dimLine);
      disposeObj(pp.dimLine);
      pp.dimLine = null;
    }

    // Live distance label in HUD title area
    const title = hud?.querySelector(".dm-hud-title");
    if (title && mag > 1e-9) {
      const mmVal = Math.abs(dServer * mmPerServerUnit(pp.data.scale));
      const sign = isCut ? "cut" : "join";
      title.innerHTML = `Press-Pull <span class="dm-hud-hint">${formatLength(mmVal)} · ${sign}</span>`;
    }

    if (!skipInput) {
      const input = hud?.querySelector("[data-dm-distance]");
      if (input && document.activeElement !== input) {
        input.value = String(displayValue(dServer * mmPerServerUnit(pp.data.scale)));
      }
    }
    if (!skipTaskEmit) {
      emitTaskLength(Math.abs(dServer * mmPerServerUnit(pp.data.scale)));
    }
    if (hud) positionHud(pp.handle.position);
  }

  async function applyPressPull({ allowEmpty = false } = {}) {
    lastApplyError = "";
    if (!pp || busy) {
      lastApplyError = pp ? "Already applying…" : "Select a face or a closed sketch, then click OK.";
      onStatus?.("error", lastApplyError);
      return false;
    }
    const opts = ppOptions();
    if (Math.abs(pp.distanceServer) < 1e-9 && !(opts.op === "cut" && opts.through_all)) {
      if (allowEmpty) return false;
      lastApplyError = "Set a non-zero Length first.";
      onStatus?.("error", lastApplyError);
      return false;
    }

    if (pp.sketchMode) {
      busy = true;
        onStatus?.("loading", "Extruding sketch with FreeCAD…");
      try {
        const mmScale = mmPerServerUnit(pp.data.scale || 1);
        const heightMm = Math.abs(pp.distanceServer * mmScale);
        const op = opts.op || "auto";
        const combineMap = { join: "add", new_body: "new", cut: "cut", intersect: "intersect", auto: "new" };
        const useCombine = combineMap[op] || pp.combine || "new";
        await pp.onApply?.(heightMm, useCombine);
        setTool(null);
        return true;
      } catch (err) {
        lastApplyError = err.message || "Sketch extrude failed";
        onStatus?.("error", lastApplyError);
        return false;
      } finally {
        busy = false;
      }
      return false;
    }

    const isCut = opts.op === "cut" || (opts.op === "auto" && (pp.distanceServer || 0) < 0);
    busy = true;
    let ticket = null;
    try {
      const startedProjectId = getModelInfo?.()?.projectId;
      // Instant-placed boxes are `.local` until create-primitive finishes — wait so Pad hits the kernel.
      if (typeof ensureSolidReady === "function") {
        onStatus?.("ok", "Saving solid for CAD kernel…");
        const ready = await ensureSolidReady({ mesh: pp.mesh });
        if (ready?.mesh) pp.mesh = ready.mesh;
      }
      const bodyMeta = bodyMetaForMesh(pp.mesh);
      let filename = bodyMeta.filename || getModelInfo()?.filename;
      const { projectId } = getModelInfo();
      if (startedProjectId && projectId !== startedProjectId) {
        throw new Error("The project changed while preparing this edit. Pick the face again.");
      }
      if (!projectId || !filename) {
        lastApplyError = "Select a model file first.";
        onStatus?.("error", lastApplyError);
        return false;
      }
      if (/\.local$/i.test(String(filename))) {
        lastApplyError = "Solid is still saving — try Extrude again in a moment.";
        onStatus?.("error", lastApplyError);
        return false;
      }
      onStatus?.("ok", isCut ? "Cutting…" : "Extruding…");
      const inv = new THREE.Matrix4().copy(pp.mesh.matrixWorld).invert();
      const localNormal = pp.data.normal.clone().transformDirection(inv);
      const mmScale = mmPerServerUnit(pp.data.scale || 1);
      let distanceMm = (pp.distanceServer || 0) * mmScale;
      if (opts.op === "cut") {
        const mag = Math.abs(distanceMm || 1e-6);
        distanceMm = opts.reversed ? mag : -mag;
      } else if (opts.op === "join" || opts.op === "new_body" || opts.op === "intersect") {
        const mag = Math.abs(distanceMm || 1e-6);
        distanceMm = opts.reversed ? -mag : mag;
      } else {
        if (opts.reversed) distanceMm = -distanceMm;
        if (Math.abs(distanceMm) < 1e-12) distanceMm = -1e-6;
      }
      const faceIndices = Array.isArray(pp.faceIndices) && pp.faceIndices.length
        ? pp.faceIndices
        : pp.faceIndex != null
          ? [pp.faceIndex]
          : [];
      const payload = {
        face_index: faceIndices[0] ?? pp.faceIndex,
        face_indices: faceIndices,
        // Kernel expects mm; mesh path converts when distance_mm is set.
        distance: pp.distanceServer || 0,
        distance_mm: distanceMm,
        distance2: opts.distance2 || 0,
        distance2_mm: Math.abs(opts.distance2 || 0) * mmScale,
        normal: pp.kernelNormal || [localNormal.x, localNormal.y, localNormal.z],
        op: opts.op,
        direction: opts.direction === "two" ? "two" : opts.direction,
        taper_deg: opts.taper_deg,
        through_all: opts.through_all,
      };
      if (pp.kernelFaceIndex != null) {
        payload.kernel_face_index = pp.kernelFaceIndex;
        payload.kernel_face_indices = [pp.kernelFaceIndex];
        if (Array.isArray(pp.kernelCenter)) payload.center = pp.kernelCenter;
      }
      if (bodyMeta.bodyCount > 1) {
        if (bodyMeta.bodyIndex != null) payload.body_index = bodyMeta.bodyIndex;
        if (bodyMeta.bodyName || pp.bodyName) payload.body_name = bodyMeta.bodyName || pp.bodyName;
      }
      ticket = beginEdit("press-pull", filename);
      const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/face-pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      guardEdit(ticket, filename);
      const accepted = acceptEdit(ticket, data);
      if (accepted?.program) {
        window.dispatchEvent(
          new CustomEvent("render3d:program-updated", { detail: { program: accepted.program, filename: accepted.filename } }),
        );
      }
      const via =
        accepted?.pipeline === "freecad" ? "FreeCAD" :
        accepted?.pipeline === "kernel" ? "CAD kernel" :
        "mesh";
      onStatus?.("ok", `${isCut ? "Cut" : "Pad"} applied (${via})`);
      setTool(null);
      await onApplied?.({
        ...accepted,
        action: accepted?.action || (accepted?.pipeline === "freecad" || accepted?.pipeline === "kernel" ? "face_pad" : "face_pull"),
        replaceCatalog: accepted?.replace_catalog || accepted?.replaceCatalog || filename,
      });
      return true;
    } catch (err) {
      lastApplyError = err.message || "Press-pull failed";
      onStatus?.("error", lastApplyError);
      return false;
    } finally {
      session?.finish?.(ticket);
      busy = false;
    }
  }

  function tryStartSketchExtrudeFromPick(event) {
    const sketchData = pickSketch?.(event);
    if (!sketchData?.profile?.length) return false;
    const meta = getSketchExtrudeMeta?.(sketchData) || {};
    return startSketchExtrude({
      profile: sketchData.profile,
      plane: sketchData.plane || "XY",
      combine: meta.combine || "new",
      onApply: meta.onApply,
    });
  }

  function startSketchExtrude({ profile, plane = "XY", plane_ref = null, combine = "new", onApply }) {
    if (!profile?.length) {
      onStatus?.("error", "No sketch profile to extrude.");
      return false;
    }
    clearPressPull();
    clearMirror();
    dragging = false;
    tool = "presspull";
    controls.enabled = false;
    onToolChange?.("presspull");
    const sketchData = { plane, plane_ref };
    const data = sketchProfileWorldData(profile, sketchData);
    lockPressPullFromData(data, {
      sketchMode: true,
      profile,
      plane,
      plane_ref,
      combine,
      onApply,
    });
    return true;
  }

  // ── mirror state ───────────────────────────────────────────────────────────

  let mi = null; // { frame, planes:{XY,YZ,XZ}, active, offsetServer, ghost, dragPlane }

  const PLANE_DEFS = {
    YZ: { normal: new THREE.Vector3(1, 0, 0), color: 0xff4d4f },
    XZ: { normal: new THREE.Vector3(0, 1, 0), color: 0x3fb950 },
    XY: { normal: new THREE.Vector3(0, 0, 1), color: 0x4f7dff },
  };

  function serverFrame() {
    const mesh = getMesh();
    let child = null;
    mesh?.traverse((c) => {
      if (!child && c.isMesh) child = c;
    });
    if (!child) return null;
    child.updateWorldMatrix(true, false);
    return child.matrixWorld.clone();
  }

  function clearMirror() {
    if (mi) {
      for (const p of Object.values(mi.planes)) {
        group.remove(p);
        disposeObj(p);
      }
      if (mi.ghost) {
        group.remove(mi.ghost);
        disposeObj(mi.ghost);
      }
      mi = null;
    }
    destroyHud();
  }

  function mirrorHudHtml() {
    const u = unitSuffix();
    return `
      <div class="dm-hud-title">Mirror <span class="dm-hud-hint">click a plane, drag it, or type an offset</span></div>
      <div class="dm-hud-row">
        <label>Plane</label>
        <div class="dm-hud-btns">
          <button type="button" class="btn secondary dm-plane-btn" data-dm-plane="YZ">YZ</button>
          <button type="button" class="btn secondary dm-plane-btn" data-dm-plane="XZ">XZ</button>
          <button type="button" class="btn secondary dm-plane-btn" data-dm-plane="XY">XY</button>
        </div>
      </div>
      <div class="dm-hud-row">
        <label>Offset</label>
        <input type="text" data-dm-offset value="0" spellcheck="false" />
        <span class="dm-hud-unit">${u}</span>
      </div>
      <div class="dm-hud-row">
        <label>Result</label>
        <select data-dm-mirror-mode>
          <option value="join" selected>Join (single body)</option>
          <option value="keep">Keep both bodies</option>
          <option value="replace">Mirrored only</option>
        </select>
      </div>
      <div class="dm-hud-actions">
        <button type="button" class="btn secondary" data-dm-cancel>Cancel</button>
        <button type="button" class="btn primary" data-dm-apply>Apply</button>
      </div>`;
  }

  function startMirror() {
    clearMirror();
    const frame = serverFrame();
    const mesh = getMesh();
    if (!frame || !mesh) {
      onStatus?.("error", "Load a model first.");
      return;
    }
    const extent = meshWorldExtent();
    const scale = new THREE.Vector3().setFromMatrixColumn(frame, 0).length() || 1;
    const origin = new THREE.Vector3().setFromMatrixPosition(frame);
    const rot = new THREE.Quaternion().setFromRotationMatrix(frame);

    const planes = {};
    for (const [name, def] of Object.entries(PLANE_DEFS)) {
      const geo = new THREE.PlaneGeometry(extent * 1.25, extent * 1.25);
      const mat = new THREE.MeshBasicMaterial({
        color: def.color,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 3;
      const nWorld = def.normal.clone().applyQuaternion(rot).normalize();
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nWorld);
      m.position.copy(origin);
      m.userData.dmPlane = name;
      m.userData.normalWorld = nWorld;
      group.add(m);
      planes[name] = m;
    }
    mi = { frame, planes, active: null, offsetServer: 0, ghost: null, origin, scale, mmScale: mmPerServerUnit(scale) };

    const el = createHud(mirrorHudHtml());
    const rect = dom.getBoundingClientRect();
    hud.style.left = `${rect.width - (hud.offsetWidth || 260) - 16}px`;
    hud.style.top = "16px";
    el.querySelectorAll("[data-dm-plane]").forEach((btn) =>
      btn.addEventListener("click", () => selectMirrorPlane(btn.dataset.dmPlane))
    );
    el.querySelector("[data-dm-apply]").addEventListener("click", applyMirror);
    el.querySelector("[data-dm-cancel]").addEventListener("click", () => setTool(null));
    el.querySelector("[data-dm-mirror-mode]").addEventListener("change", updateMirrorPreview);
    const offInput = el.querySelector("[data-dm-offset]");
    offInput.addEventListener("input", () => {
      const mm = parseLength(offInput.value);
      if (Number.isFinite(mm) && mi) {
        mi.offsetServer = mm / mi.mmScale;
        updateMirrorPreview({ skipInput: true });
      }
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyMirror();
      }
      if (e.key === "Escape") setTool(null);
      e.stopPropagation();
    });
    selectMirrorPlane("YZ");
    onStatus?.("ok", "Pick a mirror plane — preview updates live");
  }

  function selectMirrorPlane(name) {
    if (!mi) return;
    mi.active = name;
    for (const [n, m] of Object.entries(mi.planes)) {
      m.material.opacity = n === name ? 0.3 : 0.08;
    }
    hud?.querySelectorAll("[data-dm-plane]").forEach((b) => b.classList.toggle("active", b.dataset.dmPlane === name));
    updateMirrorPreview();
  }

  function updateMirrorPreview({ skipInput = false } = {}) {
    if (!mi || !mi.active) return;
    const mesh = getMesh();
    const plane = mi.planes[mi.active];
    const nWorld = plane.userData.normalWorld;
    const offsetWorld = mi.offsetServer * mi.scale;
    const pWorld = mi.origin.clone().addScaledVector(nWorld, offsetWorld);
    plane.position.copy(pWorld);

    // reflection matrix in world space
    const n = nWorld;
    const d = pWorld.dot(n);
    const R = new THREE.Matrix4().set(
      1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 2 * d * n.x,
      -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 2 * d * n.y,
      -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, 2 * d * n.z,
      0, 0, 0, 1
    );

    if (!mi.ghost) {
      const clone = mesh.clone(true);
      const ghostMat = new THREE.MeshBasicMaterial({
        color: HOVER_COLOR,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      clone.traverse((c) => {
        if (c.isMesh) c.material = ghostMat;
      });
      const wrap = new THREE.Group();
      wrap.matrixAutoUpdate = false;
      wrap.add(clone);
      group.add(wrap);
      mi.ghost = wrap;
    }
    mi.ghost.matrix.copy(R);
    mi.ghost.matrixWorldNeedsUpdate = true;

    if (!skipInput) {
      const input = hud?.querySelector("[data-dm-offset]");
      if (input && document.activeElement !== input) {
        input.value = String(displayValue(mi.offsetServer * mi.mmScale));
      }
    }
  }

  async function applyMirror() {
    if (!mi || !mi.active || busy) return;
    const { projectId, filename } = getModelInfo();
    if (!projectId || !filename) {
      onStatus?.("error", "Select a model file first.");
      return;
    }
    let ticket = null;
    try {
      ticket = beginEdit("mirror", filename);
    } catch (err) {
      onStatus?.("error", err.message || "Mirror is not ready.");
      return;
    }
    busy = true;
    onStatus?.("loading", "Mirroring…");
    try {
      const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/mirror`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plane: mi.active,
          offset: mi.offsetServer,
          mode: hud?.querySelector("[data-dm-mirror-mode]")?.value || "join",
        }),
      });
      guardEdit(ticket, filename);
      const accepted = acceptEdit(ticket, data);
      onStatus?.("ok", `Saved ${accepted.filename}`);
      setTool(null);
      await onApplied?.(accepted);
    } catch (err) {
      onStatus?.("error", err.message || "Mirror failed");
    } finally {
      session?.finish?.(ticket);
      busy = false;
    }
  }

  // ── fillet / chamfer tools ─────────────────────────────────────────────────

  function fcHudHtml(kind) {
    const isFillet = kind === "fillet";
    const title  = isFillet ? "Fillet" : "Chamfer";
    const hint   = isFillet ? "rounds edges" : "bevels edges";
    const vLabel = isFillet ? "Radius" : "Distance";
    return `
      <div class="dm-hud-title">${title} <span class="dm-hud-hint">${hint}</span></div>
      <div class="dm-hud-row dm-fc-scrub-row">
        <label>${vLabel}</label>
        <span class="dm-fc-scrub" title="Drag left/right to adjust value" data-dm-fc-scrub>
          <span class="dm-fc-scrub-icon">↔</span>
          <input type="text" data-dm-fc-radius value="2" spellcheck="false" />
          <span class="dm-hud-unit">mm</span>
        </span>
      </div>
      <div class="dm-hud-row">
        <label>Edges</label>
        <select data-dm-fc-edges>
          <option value="top" selected>Top</option>
          <option value="vertical">Vertical (sides)</option>
          <option value="bottom">Bottom</option>
          <option value="all">All edges</option>
        </select>
      </div>
      <div class="dm-fc-preview-status" data-dm-fc-preview></div>
      <div class="dm-hud-actions">
        <button type="button" class="btn secondary" data-dm-cancel>Cancel</button>
        <button type="button" class="btn primary" data-dm-apply>Apply ${title}</button>
      </div>`;
  }

  function _bindFcScrub(el, kind) {
    const scrubEl  = el.querySelector("[data-dm-fc-scrub]");
    const inputEl  = el.querySelector("[data-dm-fc-radius]");
    const previewEl = el.querySelector("[data-dm-fc-preview]");
    if (!scrubEl || !inputEl) return;

    let scrubActive = false;
    let scrubStartX = 0;
    let scrubStartVal = 2;
    let previewTimer = null;

    function getCurrentVal() {
      const v = parseFloat(inputEl.value);
      return Number.isFinite(v) && v > 0 ? v : 2;
    }

    function setVal(v) {
      v = Math.max(0.1, +v.toFixed(2));
      inputEl.value = v;
      schedulePreview();
    }

    function schedulePreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => previewFilletChamfer(kind, previewEl), 600);
    }

    scrubEl.addEventListener("pointerdown", (e) => {
      if (e.target === inputEl) return;
      e.preventDefault();
      scrubActive = true;
      scrubStartX = e.clientX;
      scrubStartVal = getCurrentVal();
      scrubEl.setPointerCapture(e.pointerId);
      scrubEl.classList.add("dm-fc-scrub--dragging");
    });

    scrubEl.addEventListener("pointermove", (e) => {
      if (!scrubActive) return;
      const dx = e.clientX - scrubStartX;
      const speed = e.shiftKey ? 0.05 : 0.25; // shift = fine control
      setVal(scrubStartVal + dx * speed);
    });

    scrubEl.addEventListener("pointerup", () => {
      if (!scrubActive) return;
      scrubActive = false;
      scrubEl.classList.remove("dm-fc-scrub--dragging");
    });

    // Arrow key nudge on the input
    inputEl.addEventListener("keydown", (e) => {
      const v = getCurrentVal();
      if (e.key === "ArrowUp")   { e.preventDefault(); setVal(v + (e.shiftKey ? 0.1 : 1)); }
      if (e.key === "ArrowDown") { e.preventDefault(); setVal(Math.max(0.1, v - (e.shiftKey ? 0.1 : 1))); }
    });

    inputEl.addEventListener("input", schedulePreview);
  }

  function startFilletChamfer(kind) {
    const el = createHud(fcHudHtml(kind));
    hudFloat?.dockRight?.(16);
    _bindFcScrub(el, kind);
    el.querySelector("[data-dm-cancel]").addEventListener("click", () => setTool(null));
    el.querySelector("[data-dm-apply]").addEventListener("click", () => applyFilletChamfer(kind));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); applyFilletChamfer(kind); }
      if (e.key === "Escape") setTool(null);
      e.stopPropagation();
    });
    onStatus?.("ok", `Drag ↔ or type a value, then click Apply`);
  }

  let _fcPreviewBusy = false;
  async function previewFilletChamfer(kind, previewEl) {
    if (_fcPreviewBusy) return;
    const { projectId, filename } = getModelInfo();
    if (!projectId || !filename) return;
    const valStr = hud?.querySelector("[data-dm-fc-radius]")?.value || "2";
    const val = parseFloat(valStr);
    if (!Number.isFinite(val) || val <= 0) return;
    const edges = hud?.querySelector("[data-dm-fc-edges]")?.value || "top";
    const endpoint = kind === "fillet" ? "fillet-edges" : "chamfer-edges";
    const bodyKey  = kind === "fillet" ? "radius_mm" : "length_mm";
    let ticket = null;
    try {
      ticket = beginEdit("preview", filename);
    } catch (err) {
      if (previewEl) { previewEl.textContent = `⚠ ${err.message}`; previewEl.className = "dm-fc-preview-status dm-fc-preview--err"; }
      return;
    }
    _fcPreviewBusy = true;
    if (previewEl) { previewEl.textContent = "Previewing…"; previewEl.className = "dm-fc-preview-status dm-fc-preview--loading"; }
    try {
      const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [bodyKey]: val, edges, preview: true }),
      });
      guardEdit(ticket, filename);
      if (previewEl) { previewEl.textContent = "✓ Preview updated"; previewEl.className = "dm-fc-preview-status dm-fc-preview--ok"; }
      await onApplied?.(data);
    } catch (err) {
      if (previewEl) { previewEl.textContent = `⚠ ${err.message || "preview failed"}`; previewEl.className = "dm-fc-preview-status dm-fc-preview--err"; }
    } finally {
      session?.finish?.(ticket);
      _fcPreviewBusy = false;
    }
  }

  async function applyFilletChamfer(kind) {
    if (busy) return;
    const { projectId, filename } = getModelInfo();
    if (!projectId || !filename) {
      onStatus?.("error", "Select a model file first.");
      return;
    }
    const valStr = hud?.querySelector("[data-dm-fc-radius]")?.value || "2";
    const val = parseFloat(valStr);
    if (!Number.isFinite(val) || val <= 0) {
      onStatus?.("error", `Enter a valid ${kind === "fillet" ? "radius" : "distance"} > 0`);
      return;
    }
    const edges = hud?.querySelector("[data-dm-fc-edges]")?.value || "top";
    let ticket = null;
    try {
      ticket = beginEdit(kind, filename);
    } catch (err) {
      onStatus?.("error", err.message || `${kind} is not ready.`);
      return;
    }
    busy = true;
    onStatus?.("loading", `Applying ${kind}…`);
    const endpoint = kind === "fillet" ? "fillet-edges" : "chamfer-edges";
    const bodyKey  = kind === "fillet" ? "radius_mm" : "length_mm";
    try {
      const data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [bodyKey]: val, edges }),
      });
      guardEdit(ticket, filename);
      const accepted = acceptEdit(ticket, data);
      onStatus?.("ok", `${kind === "fillet" ? "Fillet" : "Chamfer"} applied → ${accepted.filename}`);
      setTool(null);
      await onApplied?.(accepted);
    } catch (err) {
      onStatus?.("error", err.message || `${kind} failed`);
    } finally {
      session?.finish?.(ticket);
      busy = false;
    }
  }

  // ── pointer handling ───────────────────────────────────────────────────────

  let downPos = null;
  let dragKind = null; // "pp-handle" | "mirror-plane"

  function onPointerDown(event) {
    if (!tool || event.button !== 0) return;
    if (event.target.closest?.(".dm-hud, .floating-panel, #create-task-banner")) return;
    downPos = { x: event.clientX, y: event.clientY };
    if (tool === "presspull") {
      if (pp) {
        raycaster.setFromCamera(ndc(event), camera);
        const hits = raycaster.intersectObject(pp.hitMesh, true);
        if (hits.length) {
          controls.enabled = false;
          beginAxisDrag(event);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // FreeCAD Tasks: click another face to retarget. Drag the arrow (not the face) to change length.
        if (tryPickFaceForPressPull(event)) {
          if (!taskBannerOpen()) {
            controls.enabled = false;
            beginAxisDrag(event);
          }
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        return;
      }
      // Click face (or sketch). With Tasks open, lock and wait for arrow drag / OK — don't apply on release.
      if (tryStartSketchExtrudeFromPick(event) || tryPickFaceForPressPull(event)) {
        clearHover();
        if (!taskBannerOpen()) {
          controls.enabled = false;
          beginAxisDrag(event);
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // Missed the model — let orbit handle this gesture.
      return;
    }
    if (tool === "mirror" && mi?.active) {
      raycaster.setFromCamera(ndc(event), camera);
      const hits = raycaster.intersectObject(mi.planes[mi.active], false);
      if (hits.length) {
        dragging = true;
        dragKind = "mirror-plane";
        controls.enabled = false;
        const nWorld = mi.planes[mi.active].userData.normalWorld;
        dragStartParam = axisParamAtPointer(event, mi.origin, nWorld);
        dragStartDistance = mi.offsetServer * mi.scale;
        dom.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  function onPointerMove(event) {
    if (!tool) return;
    // Keep orbit controls from panning/rotating while a tool handles the pointer.
    if (dragging) event.stopPropagation();
    if (dragging && dragKind === "pp-handle" && pp) {
      const t = axisParamAtPointer(event, pp.data.centroid, pp.data.normal);
      const worldDist = dragStartDistance + (t - dragStartParam);
      const mmScale = mmPerServerUnit(pp.data.scale);
      const mm = applySnap((worldDist / pp.data.scale) * mmScale);
      pp.distanceServer = mm / mmScale;
      updatePressPullPreview();
      return;
    }
    if (dragging && dragKind === "mirror-plane" && mi?.active) {
      const nWorld = mi.planes[mi.active].userData.normalWorld;
      const t = axisParamAtPointer(event, mi.origin, nWorld);
      const worldOff = dragStartDistance + (t - dragStartParam);
      mi.offsetServer = worldOff / mi.scale;
      updateMirrorPreview();
      return;
    }
    if (tool === "presspull" && !pp) {
      const sketchData = pickSketch?.(event);
      if (sketchData) showSketchHover(sketchData);
      else {
        const hit = castModel(event);
        if (hit) showHover(hit);
        else clearHover();
      }
    }
  }

  function onPointerUp(event) {
    if (!tool) return;
    if (event.target.closest?.(".dm-hud, .floating-panel, #create-task-banner")) return;
    if (dragging) {
      const wasPpDrag = dragKind === "pp-handle" && tool === "presspull" && pp;
      const dist = pp?.distanceServer || 0;
      dragging = false;
      dragKind = null;
      // Keep orbit available after releasing the drag handle.
      controls.enabled = tool !== "mirror";
      try {
        dom.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
      // FreeCAD Tasks: OK commits. HUD-only mode still applies on a meaningful drag release.
      if (wasPpDrag && Math.abs(dist) > 1e-6 && !taskBannerOpen()) {
        void applyPressPull();
      }
      return;
    }
    if (!downPos) return;
    const moved = Math.hypot(event.clientX - downPos.x, event.clientY - downPos.y);
    downPos = null;
    if (moved > 8) return;
    // Fallback click-to-select if pointerdown didn't lock a face (e.g. missed mesh).
    if (tool === "presspull" && !pp) {
      if (tryStartSketchExtrudeFromPick(event)) {
        clearHover();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (tryPickFaceForPressPull(event)) {
        clearHover();
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  function onKeyDown(event) {
    if (!tool) return;
    if (event.key === "Escape") {
      setTool(null);
      return;
    }
    // numeric entry while dragging → focus the value input
    if (dragging || (tool === "presspull" && pp)) {
      if (/^[0-9.\-]$/.test(event.key) && !event.target.matches("input, select, textarea")) {
        const input = hud?.querySelector("[data-dm-distance], [data-dm-offset]")
          || document.querySelector("#create-task-banner [name=length]");
        if (input) {
          input.focus();
          if (hud) input.value = "";
        }
      }
    }
  }

  dom.addEventListener("pointerdown", onPointerDown, true);
  dom.addEventListener("pointermove", onPointerMove, true);
  dom.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("keydown", onKeyDown);
  controls.addEventListener?.("change", () => {
    if (tool === "presspull" && pp && hud) positionHud(pp.handle.position);
  });

  window.addEventListener("render3d:presspull-task-values", (ev) => {
    if (tool !== "presspull" || !pp) return;
    syncFromTaskValues(ev.detail?.values || {});
  });

  onUnitsChanged(() => {
    // refresh unit suffixes + values in the open HUD
    if (tool === "presspull" && pp) {
      hud?.querySelectorAll(".dm-hud-unit").forEach((el, i) => {
        if (el.textContent !== "°") el.textContent = unitSuffix();
      });
      updatePressPullPreview();
    }
    if (tool === "mirror" && mi) {
      hud?.querySelectorAll(".dm-hud-unit").forEach((el) => {
        if (el.textContent !== "°") el.textContent = unitSuffix();
      });
      updateMirrorPreview();
    }
  });

  // ── public API ─────────────────────────────────────────────────────────────

  function ensureTool(nextRaw) {
    const next = normalizeTool(nextRaw);
    if (!next) return;
    if (tool === next) {
      // Orbit while waiting to pick a face; lock only during drag / mirror.
      controls.enabled = next !== "mirror";
      onToolChange?.(tool);
      return;
    }
    setTool(next, { force: true });
  }

  function setTool(nextRaw, { force = false } = {}) {
    let next = normalizeTool(nextRaw);
    if (!force && next === tool) next = null;
    if (force && next === tool) {
      controls.enabled = next !== "mirror";
      return;
    }
    clearPressPull();
    clearMirror();
    dragging = false;
    tool = next;
    if (tool === "mirror") {
      controls.enabled = false;
      startMirror();
    } else if (tool === "presspull") {
      // Keep orbit enabled until the user starts dragging a face (FreeCAD-like).
      controls.enabled = true;
      showPressPullPrompt();
      onStatus?.("ok", "Select a face or closed sketch, set Length, then OK.");
    } else if (tool === "fillet" || tool === "chamfer") {
      controls.enabled = true;
      startFilletChamfer(tool);
    } else {
      controls.enabled = true;
      preferredOp = "auto";
    }
    onToolChange?.(tool);
    if (tool === "mirror" && !mi) {
      tool = null;
      controls.enabled = true;
      onToolChange?.(null);
    }
  }

  return {
    setTool,
    ensureTool,
    setPreferredOp: (op) => {
      preferredOp = op || "auto";
    },
    getTool: () => tool,
    isToolActive: () => !!tool,
    isBusy: () => !!tool || busy || dragging,
    startPressPullFromRef,
    startSketchExtrude,
    tryStartSketchExtrudeFromPick,
    applyPressPull,
    hasPressPullSession: () => Boolean(pp),
    syncFromTaskValues,
    getLastError: () => lastApplyError,
    /** Called when the model is reloaded/cleared. */
    reset() {
      setTool(null);
    },
  };
}
