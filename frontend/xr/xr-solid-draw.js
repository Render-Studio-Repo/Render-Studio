/**
 * Quest-safe Arkio-like primitive draw: trigger-drag a box/cyl/sphere/cone/torus
 * in world meters, then commit through the host (same create-solid path).
 */

import * as THREE from "three";
import { wallSizeFromDrag, aabbCornersFromCenterSize, nearestCornerJoin, CORNER_JOIN_M, extrudeAabbFace } from "./xr-build-tools.js?v=20260908-xr-ent4-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2&xrtalk=20260916-1&astra=20260916-5";
import { worldYawQuaternion } from "./xr-cube-turn.js?v=20260923-cubeturn1";

const KINDS = new Set(["box", "cylinder", "sphere", "cone", "torus", "wall", "floor"]);

function kindFromTool(id) {
  const s = String(id || "").replace(/^create_/, "");
  return KINDS.has(s) ? s : "";
}

export function createXrSolidDraw({ THREE: T = THREE, scene, getColor } = {}) {
  const group = new T.Group();
  group.name = "xrSolidDraw";
  group.visible = false;
  try { scene?.add(group); } catch { /* ignore */ }

  let kind = "";
  let live = null;
  let mesh = null;
  let solidSeq = 0;
  const notes = [];
  const committed = new THREE.Group();
  committed.name = "xrSolidDrawCommitted";
  try { scene?.add(committed); } catch { /* ignore */ }

  const handles = new T.Group();
  handles.name = "xrSolidHandles";
  handles.visible = false;
  try { scene?.add(handles); } catch { /* ignore */ }
  const faceGeo = new T.BoxGeometry(1, 1, 1);
  const cornerGeo = new T.SphereGeometry(1, 8, 6);
  const handleMat = new T.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  const FACE_AXES = [
    ["x", 1], ["x", -1], ["y", 1], ["y", -1], ["z", 1], ["z", -1],
  ];
  const faceHandles = FACE_AXES.map(([axis, sign]) => {
    const m = new T.Mesh(faceGeo, handleMat.clone());
    m.userData.xrSolidHandle = { type: "face", axis, sign };
    m.frustumCulled = false;
    m.renderOrder = 2600;
    handles.add(m);
    return m;
  });
  const cornerHandles = [];
  for (let i = 0; i < 8; i += 1) {
    const m = new T.Mesh(cornerGeo, handleMat.clone());
    m.userData.xrSolidHandle = { type: "corner", index: i };
    m.frustumCulled = false;
    m.renderOrder = 2601;
    handles.add(m);
    cornerHandles.push(m);
  }
  const moveHandle = new T.Mesh(cornerGeo, handleMat.clone());
  moveHandle.userData.xrSolidHandle = { type: "move" };
  moveHandle.frustumCulled = false;
  moveHandle.renderOrder = 2602;
  handles.add(moveHandle);

  let editMesh = null;
  let selectedDrawable = null;
  let handleDrag = null;
  let editMode = "box_face";
  let lastBox = null;
  // Arkio-style trigger-drag only. World handles steal picks in the headset.
  const SHOW_WORLD_HANDLES = false;

  function currentBox() {
    if (live && mesh) {
      return {
        cx: group.position.x,
        cy: group.position.y,
        cz: group.position.z,
        sx: Math.abs(mesh.scale.x) || 0.04,
        sy: Math.abs(mesh.scale.y) || 0.04,
        sz: Math.abs(mesh.scale.z) || 0.04,
      };
    }
    if (editMesh) {
      return {
        cx: editMesh.position.x,
        cy: editMesh.position.y,
        cz: editMesh.position.z,
        sx: Math.abs(editMesh.scale.x) || 0.04,
        sy: Math.abs(editMesh.scale.y) || 0.04,
        sz: Math.abs(editMesh.scale.z) || 0.04,
      };
    }
    return lastBox;
  }

  function applyBoxToTarget(box) {
    if (!box) return;
    lastBox = box;
    if (live && mesh) {
      group.position.set(box.cx, box.cy, box.cz);
      applyPreviewSize(kind || "box", box.sx, box.sy, box.sz);
    } else if (editMesh) {
      editMesh.position.set(box.cx, box.cy, box.cz);
      editMesh.scale.set(box.sx, box.sy, box.sz);
    }
    if (SHOW_WORLD_HANDLES) layoutHandles(box);
  }

  function layoutHandles(box) {
    if (!SHOW_WORLD_HANDLES) {
      handles.visible = false;
      faceHandles.forEach((h) => { h.visible = false; });
      cornerHandles.forEach((h) => { h.visible = false; });
      moveHandle.visible = false;
      return;
    }
    const b = box || currentBox();
    if (!b) {
      handles.visible = false;
      return;
    }
    const showFaces = editMode === "box_face" || editMode === "box_extrude" || editMode === "prim_size";
    const showCorners = editMode === "box_corner" || editMode === "box_face";
    const showMove = editMode === "box_move" || editMode === "prim_move" || editMode === "box_face";
    FACE_AXES.forEach(([axis, sign], i) => {
      const h = faceHandles[i];
      h.visible = showFaces;
      const along = (axis === "x" ? b.sx : axis === "y" ? b.sy : b.sz) * 0.5;
      h.position.set(
        b.cx + (axis === "x" ? sign * along : 0),
        b.cy + (axis === "y" ? sign * along : 0),
        b.cz + (axis === "z" ? sign * along : 0),
      );
      if (axis === "x") h.scale.set(0.012, Math.max(0.03, b.sy * 0.35), Math.max(0.03, b.sz * 0.35));
      else if (axis === "y") h.scale.set(Math.max(0.03, b.sx * 0.35), 0.012, Math.max(0.03, b.sz * 0.35));
      else h.scale.set(Math.max(0.03, b.sx * 0.35), Math.max(0.03, b.sy * 0.35), 0.012);
    });
    const corners = aabbCornersFromCenterSize(b.cx, b.cy, b.cz, b.sx, b.sy, b.sz);
    cornerHandles.forEach((h, i) => {
      h.visible = showCorners;
      const c = corners[i];
      if (c) h.position.set(c.x, c.y, c.z);
      h.scale.setScalar(0.012);
    });
    moveHandle.visible = showMove;
    moveHandle.position.set(b.cx, b.cy, b.cz);
    moveHandle.scale.setScalar(0.016);
    handles.visible = !!(showFaces || showCorners || showMove);
  }

  function setEditMode(id) {
    editMode = String(id || "box_face");
    if (!SHOW_WORLD_HANDLES) {
      handles.visible = false;
      return;
    }
    layoutHandles(currentBox());
  }

  function joinBox(box, extraCorners = [], enabled = true) {
    if (!enabled || !box) return box;
    const source = aabbCornersFromCenterSize(box.cx, box.cy, box.cz, box.sx, box.sy, box.sz);
    const targets = [];
    for (const child of committed.children) {
      if (child === editMesh) continue;
      const size = {
        x: Math.abs(child.scale.x) || 0.04,
        y: Math.abs(child.scale.y) || 0.04,
        z: Math.abs(child.scale.z) || 0.04,
      };
      targets.push(...aabbCornersFromCenterSize(child.position.x, child.position.y, child.position.z, size.x, size.y, size.z));
    }
    targets.push(...extraCorners);
    const join = nearestCornerJoin(source, targets, CORNER_JOIN_M);
    if (!join) return box;
    return {
      ...box,
      cx: box.cx + join.dx,
      cy: box.cy + join.dy,
      cz: box.cz + join.dz,
    };
  }

  function nextDrawId() {
    solidSeq += 1;
    return `solid-${solidSeq}-${Date.now().toString(36)}`;
  }

  function tagDrawable(obj, extra = {}) {
    if (!obj) return;
    obj.userData.xrDrawable = true;
    obj.userData.xrDrawSolid = true;
    Object.assign(obj.userData, extra);
    const at = Number(extra.xrAuthorAt || extra.createdAt || Date.now()) || Date.now();
    const id = String(extra.xrAuthorId || extra.authorId || obj.userData.xrAuthorId || "");
    const name = String(extra.xrAuthorName || extra.authorName || obj.userData.xrAuthorName || "");
    obj.userData.xrAuthorId = id;
    obj.userData.xrAuthorName = name;
    obj.userData.xrAuthorAt = at;
    obj.userData.createdAt = at;
    obj.userData.createdBy = id;
    obj.userData.xrAuthor = { id, name, at };
  }

  function colorNum() {
    try {
      const c = getColor?.();
      if (typeof c === "number") return c;
      if (typeof c === "string" && c.startsWith("#")) return parseInt(c.slice(1), 16);
    } catch { /* default */ }
    return 0x58a6ff;
  }

  function ensureMesh(k) {
    if (mesh && mesh.userData.kind === k) {
      try { mesh.material.color.setHex(colorNum()); } catch { /* ignore */ }
      return;
    }
    if (mesh) {
      group.remove(mesh);
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
      mesh = null;
    }
    let geo;
    if (k === "box" || k === "wall" || k === "floor") geo = new T.BoxGeometry(1, 1, 1);
    else if (k === "sphere") geo = new T.SphereGeometry(0.5, 16, 12);
    else if (k === "cylinder") geo = new T.CylinderGeometry(0.5, 0.5, 1, 16);
    else if (k === "cone") geo = new T.CylinderGeometry(0.001, 0.5, 1, 16);
    else geo = new T.TorusGeometry(0.5, 0.12, 8, 20);
    mesh = new T.Mesh(
      geo,
      new T.MeshBasicMaterial({
        color: colorNum(),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    mesh.userData.kind = k;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  function applyPreviewSize(k, w, h, d) {
    if (!mesh) return;
    if (k === "box") mesh.scale.set(w, h, d);
    else if (k === "wall") mesh.scale.set(Math.max(w, d), h, 0.08);
    else if (k === "floor") mesh.scale.set(Math.max(w, 0.2), 0.04, Math.max(d, 0.2));
    else if (k === "sphere") {
      const s = Math.max(w, h, d);
      mesh.scale.set(s, s, s);
    } else if (k === "cylinder" || k === "cone") mesh.scale.set(w, h, w);
    else {
      const s = Math.max(w, 0.02);
      mesh.scale.set(s, s, s);
    }
  }

  function begin(toolId, origin) {
    const k = kindFromTool(toolId);
    if (!k || !origin) return false;
    kind = k;
    handleDrag = null;
    live = {
      start: origin.clone(),
      last: origin.clone(),
    };
    group.visible = true;
    ensureMesh(k);
    applyPreviewSize(k, 0.04, 0.04, 0.04);
    group.position.copy(origin);
    lastBox = { cx: origin.x, cy: origin.y, cz: origin.z, sx: 0.04, sy: 0.04, sz: 0.04 };
    handles.visible = false;
    return true;
  }

  function update(point, { joinCorners = [], join = true } = {}) {
    if (!live || !point) return;
    live.last.copy(point);
    const a = live.start;
    const b = point;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const dz = Math.abs(b.z - a.z);
    if (kind === "wall") {
      const wall = wallSizeFromDrag(dx, dy, dz);
      group.position.set((a.x + b.x) * 0.5, a.y + wall.y * 0.5, (a.z + b.z) * 0.5);
      ensureMesh(kind);
      applyPreviewSize(kind, wall.x, wall.y, wall.z);
      live.phase = wall.pulling ? "height" : "footprint";
      lastBox = {
        cx: group.position.x,
        cy: group.position.y,
        cz: group.position.z,
        sx: wall.x,
        sy: wall.y,
        sz: wall.z,
      };
      return;
    }
    if (kind === "floor") {
      group.position.set((a.x + b.x) * 0.5, a.y, (a.z + b.z) * 0.5);
      ensureMesh(kind);
      applyPreviewSize(kind, Math.max(0.16, dx), 0.04, Math.max(0.16, dz));
      lastBox = {
        cx: group.position.x,
        cy: group.position.y,
        cz: group.position.z,
        sx: Math.max(0.16, dx),
        sy: 0.04,
        sz: Math.max(0.16, dz),
      };
      return;
    }
    let box;
    if (kind === "box") {
      box = {
        cx: (a.x + b.x) * 0.5,
        cy: (a.y + b.y) * 0.5,
        cz: (a.z + b.z) * 0.5,
        sx: Math.max(0.02, dx),
        sy: Math.max(0.02, dy),
        sz: Math.max(0.02, dz),
      };
      box = joinBox(box, joinCorners, join);
      group.position.set(box.cx, box.cy, box.cz);
      ensureMesh(kind);
      applyPreviewSize(kind, box.sx, box.sy, box.sz);
      lastBox = box;
      return;
    }
    const w = Math.max(0.02, dx, dz);
    const h = Math.max(0.02, dy);
    box = {
      cx: (a.x + b.x) * 0.5,
      cy: (a.y + b.y) * 0.5,
      cz: (a.z + b.z) * 0.5,
      sx: w,
      sy: h,
      sz: w,
    };
    box = joinBox(box, joinCorners, join);
    group.position.set(box.cx, box.cy, box.cz);
    ensureMesh(kind);
    applyPreviewSize(kind, box.sx, box.sy, kind === "sphere" ? Math.max(box.sx, box.sy, box.sz) : box.sz);
    lastBox = box;
  }

  function cancel() {
    live = null;
    kind = "";
    handleDrag = null;
    group.visible = false;
    handles.visible = false;
    if (mesh) {
      group.remove(mesh);
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
      mesh = null;
    }
  }

  function finish(meta = {}) {
    if (!live || !kind) {
      cancel();
      return null;
    }
    const a = live.start;
    const b = live.last;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const dz = Math.abs(b.z - a.z);
    const wall = kind === "wall" ? wallSizeFromDrag(dx, dy, dz) : null;
    const sizeM = wall
      ? { x: wall.x, y: wall.y, z: wall.z }
      : kind === "floor"
        ? { x: Math.max(0.16, dx, dz), y: 0.04, z: Math.max(0.16, dx, dz) }
        : kind === "box"
          ? {
            x: Math.max(0.02, dx),
            y: Math.max(0.02, dy),
            z: Math.max(0.02, dz),
          }
          : {
            x: Math.max(0.02, dx, dz),
            y: Math.max(0.02, dy),
            z: Math.max(0.02, dx, dz),
          };
    if (lastBox && kind === "box") {
      sizeM.x = lastBox.sx;
      sizeM.y = lastBox.sy;
      sizeM.z = lastBox.sz;
    }
    const worldPosition = group.position.clone();
    const spec = {
      kind,
      worldPosition,
      sizeM,
      color: colorNum(),
    };
    notes.push({
      kind,
      color: `#${(spec.color >>> 0).toString(16).padStart(6, "0")}`,
      sizeM: { ...sizeM },
    });
    const kept = keepPreviewAsSolid(meta);
    spec.mesh = kept;
    spec.drawId = kept?.userData?.xrDrawId || "";
    spec.authorId = kept?.userData?.xrAuthorId || "";
    spec.authorName = kept?.userData?.xrAuthorName || "";
    live = null;
    handleDrag = null;
    if (kept) {
      lastBox = {
        cx: kept.position.x,
        cy: kept.position.y,
        cz: kept.position.z,
        sx: Math.abs(kept.scale.x) || sizeM.x,
        sy: Math.abs(kept.scale.y) || sizeM.y,
        sz: Math.abs(kept.scale.z) || sizeM.z,
      };
    }
    hideHandles();
    kind = "";
    group.visible = false;
    return spec;
  }

  function keepPreviewAsSolid(meta = {}) {
    if (!mesh || !live) return null;
    try {
      mesh.material.transparent = false;
      mesh.material.opacity = 1;
      mesh.material.depthWrite = true;
    } catch { /* ignore */ }
    const drawId = meta.drawId || nextDrawId();
    tagDrawable(mesh, {
      xrDrawId: drawId,
      xrAuthorId: meta.authorId || "",
      xrAuthorName: meta.authorName || "",
      kind,
    });
    group.updateMatrixWorld(true);
    const worldPos = group.position.clone();
    const worldQuat = group.quaternion.clone();
    const worldScale = mesh.scale.clone();
    group.remove(mesh);
    mesh.position.copy(worldPos);
    mesh.quaternion.copy(worldQuat);
    mesh.scale.copy(worldScale);
    committed.add(mesh);
    const kept = mesh;
    selectedDrawable = kind === "box" ? kept : selectedDrawable;
    mesh = null;
    return kept;
  }

  function spawnCommitted(spec = {}, meta = {}) {
    const k = kindFromTool(spec.kind);
    if (!k || !spec.worldPosition) return null;
    const prevKind = kind;
    const prevLive = live;
    const prevMesh = mesh;
    kind = k;
    live = { start: spec.worldPosition.clone(), last: spec.worldPosition.clone() };
    ensureMesh(k);
    applyPreviewSize(k, spec.sizeM?.x || 0.04, spec.sizeM?.y || 0.04, spec.sizeM?.z || 0.04);
    group.position.copy(spec.worldPosition);
    group.visible = true;
    const kept = keepPreviewAsSolid({
      drawId: spec.drawId || spec.draw_id || meta.drawId,
      authorId: spec.authorId || spec.author_id || meta.authorId,
      authorName: spec.authorName || spec.author_name || meta.authorName,
    });
    kind = prevKind;
    live = prevLive;
    mesh = prevMesh;
    group.visible = !!live;
    return kept;
  }

  function parkCommitted(mesh, parked = true) {
    if (!mesh) return mesh;
    const u = mesh.userData || (mesh.userData = {});
    if (parked) {
      if (u.xrParkPrevVisible == null) u.xrParkPrevVisible = mesh.visible !== false;
      if (u.xrParkPrevDrawable == null) u.xrParkPrevDrawable = !!u.xrDrawable;
      mesh.visible = false;
      u.xrParked = true;
      u.xrDrawable = false;
    } else {
      mesh.visible = u.xrParkPrevVisible !== false;
      u.xrDrawable = u.xrParkPrevDrawable !== false;
      u.xrParked = false;
    }
    return mesh;
  }

  function listDrawables() {
    return committed.children.filter((c) => c?.userData?.xrDrawable && !c.userData?.xrParked);
  }

  function findDrawable(drawId) {
    const id = String(drawId || "");
    if (!id) return null;
    return listDrawables().find((m) => m.userData?.xrDrawId === id) || null;
  }

  function selectDrawable(candidate) {
    const mesh = findDrawable(candidate?.userData?.xrDrawId);
    if (mesh?.userData?.kind === "box") selectedDrawable = mesh;
    return selectedDrawable;
  }

  function rotateSelectedY(degrees = 15) {
    const mesh = selectDrawable(selectedDrawable);
    if (!mesh) return null;
    mesh.quaternion.fromArray(worldYawQuaternion(mesh.quaternion.toArray(), degrees));
    mesh.updateMatrixWorld?.(true);
    return mesh;
  }

  function isActive() {
    return !!live || !!handleDrag;
  }

  function pickHandle(hits) {
    if (!hits?.length || !handles.visible) return null;
    const sorted = hits
      .filter((h) => h?.object?.userData?.xrSolidHandle && h.object.visible)
      .sort((a, b) => a.distance - b.distance);
    if (!sorted.length) return null;
    return {
      kind: "solid-handle",
      handle: sorted[0].object.userData.xrSolidHandle,
      object: sorted[0].object,
      distance: sorted[0].distance,
      point: sorted[0].point,
    };
  }

  function beginHandle(spec, point) {
    const box = currentBox();
    if (!box || !spec || !point) return false;
    handleDrag = {
      spec,
      start: point.clone ? point.clone() : { x: point.x, y: point.y, z: point.z },
      box0: { ...box },
    };
    return true;
  }

  function updateHandle(point, { joinCorners = [], join = true } = {}) {
    if (!handleDrag?.spec || !point) return false;
    const spec = handleDrag.spec;
    const box0 = handleDrag.box0;
    let next = { ...box0 };
    if (spec.type === "move") {
      const dx = (Number(point.x) || 0) - handleDrag.start.x;
      const dy = (Number(point.y) || 0) - handleDrag.start.y;
      const dz = (Number(point.z) || 0) - handleDrag.start.z;
      next = { ...box0, cx: box0.cx + dx, cy: box0.cy + dy, cz: box0.cz + dz };
    } else if (spec.type === "face") {
      const coord = spec.axis === "y" ? point.y : spec.axis === "z" ? point.z : point.x;
      next = extrudeAabbFace(box0, spec.axis, spec.sign, coord);
    } else if (spec.type === "corner") {
      const corners = aabbCornersFromCenterSize(box0.cx, box0.cy, box0.cz, box0.sx, box0.sy, box0.sz);
      const src = corners[spec.index] || { x: box0.cx, y: box0.cy, z: box0.cz };
      const opp = { x: 2 * box0.cx - src.x, y: 2 * box0.cy - src.y, z: 2 * box0.cz - src.z };
      next = {
        cx: (point.x + opp.x) * 0.5,
        cy: (point.y + opp.y) * 0.5,
        cz: (point.z + opp.z) * 0.5,
        sx: Math.max(0.02, Math.abs(point.x - opp.x)),
        sy: Math.max(0.02, Math.abs(point.y - opp.y)),
        sz: Math.max(0.02, Math.abs(point.z - opp.z)),
      };
    }
    next = joinBox(next, joinCorners, join);
    applyBoxToTarget(next);
    return true;
  }

  function finishHandle() {
    const had = !!handleDrag;
    handleDrag = null;
    return had;
  }

  function hideHandles() {
    handles.visible = false;
    handleDrag = null;
    editMesh = null;
  }

  function snapshotNotes() {
    return notes.slice();
  }

  function toPromptAugment() {
    if (!notes.length) return "";
    const lines = [
      "XR modeling tools reference:",
      "I blocked in solids with the headset modeling wheel. Use them as size, placement, and color intent.",
    ];
    notes.forEach((n, i) => {
      const mm = (m) => Math.round((m || 0) * 1000);
      lines.push(
        `Solid ${i + 1}: ${n.kind}, about ${mm(n.sizeM?.x)}×${mm(n.sizeM?.y)}×${mm(n.sizeM?.z)} mm, color ${n.color}.`,
      );
    });
    return lines.join("\n");
  }

  function dispose() {
    cancel();
    hideHandles();
    while (committed.children.length) {
      const child = committed.children[0];
      committed.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    try { scene?.remove(committed); } catch { /* ignore */ }
    try { scene?.remove(group); } catch { /* ignore */ }
    try { scene?.remove(handles); } catch { /* ignore */ }
  }

  return {
    begin,
    update,
    finish,
    cancel,
    spawnCommitted,
    parkCommitted,
    listDrawables,
    findDrawable,
    selectDrawable,
    rotateSelectedY,
    selectedDrawable: () => selectedDrawable,
    isActive,
    snapshotNotes,
    toPromptAugment,
    dispose,
    kindFromTool,
    handles,
    pickHandle,
    beginHandle,
    updateHandle,
    finishHandle,
    setEditMode,
    hideHandles,
    isHandleDragging: () => !!handleDrag,
  };
}
