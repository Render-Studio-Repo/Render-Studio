/**
 * Arkio-style horizontal drawing board, god/walk locomotion, round-table seating.
 * Math is testable without WebXR. Meshes are optional (THREE injected).
 */

export const XR_BOARD_RELAY_TYPES = ["xr.board", "xr.table", "xr.seat"];

export const BOARD_ACTIONS = {
  board: "board",
  setFloor: "ws-set-floor",
  roundTable: "ws-round-table",
  walk: "ws-walk",
  teleport: "ws-teleport",
  openPanel: "ws-board",
};

export const GOD_LIFT_M = 1.35;
export const TABLE_HEIGHT_M = 0.74;
export const FLOOR_HEIGHT_M = 0.02;
export const BOARD_RADIUS_M = 1.15;
export const TABLE_SEAT_RADIUS_M = 1.42;
export const SIT_DROP_M = 0.38;

export function packVec3(v) {
  if (!v) return [0, 0, 0];
  if (Array.isArray(v) && v.length >= 3) {
    return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
  }
  return [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
}

export function packQuat(q) {
  if (!q) return [0, 0, 0, 1];
  if (Array.isArray(q) && q.length >= 4) {
    return [Number(q[0]) || 0, Number(q[1]) || 0, Number(q[2]) || 0, Number(q[3]) || 1];
  }
  return [Number(q.x) || 0, Number(q.y) || 0, Number(q.z) || 0, Number(q.w) || 1];
}

export function defaultBoardPoseFromHead(headPos, headForward, { table = true } = {}) {
  const hx = Number(headPos?.x ?? headPos?.[0]) || 0;
  const hy = Number(headPos?.y ?? headPos?.[1]) || 1.5;
  const hz = Number(headPos?.z ?? headPos?.[2]) || 0;
  let fx = Number(headForward?.x ?? headForward?.[0]) || 0;
  let fz = Number(headForward?.z ?? headForward?.[2]) || -1;
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl;
  fz /= fl;
  const y = table ? TABLE_HEIGHT_M : FLOOR_HEIGHT_M;
  return {
    p: [hx + fx * 1.15, y, hz + fz * 1.15],
    q: [0, 0, 0, 1],
    radius: BOARD_RADIUS_M,
    heightMode: table ? "table" : "floor",
  };
}

export function projectPointOnPlane(origin, dir, planePoint, planeNormal = [0, 1, 0]) {
  const ox = Number(origin?.x ?? origin?.[0]);
  const oy = Number(origin?.y ?? origin?.[1]);
  const oz = Number(origin?.z ?? origin?.[2]);
  const dx = Number(dir?.x ?? dir?.[0]);
  const dy = Number(dir?.y ?? dir?.[1]);
  const dz = Number(dir?.z ?? dir?.[2]);
  const px = Number(planePoint?.x ?? planePoint?.[0]);
  const py = Number(planePoint?.y ?? planePoint?.[1]);
  const pz = Number(planePoint?.z ?? planePoint?.[2]);
  const nx = Number(planeNormal?.x ?? planeNormal?.[0]) || 0;
  const ny = Number(planeNormal?.y ?? planeNormal?.[1]) || 1;
  const nz = Number(planeNormal?.z ?? planeNormal?.[2]) || 0;
  const denom = dx * nx + dy * ny + dz * nz;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-6) return null;
  const t = ((px - ox) * nx + (py - oy) * ny + (pz - oz) * nz) / denom;
  if (!(t > 0.02) || t > 12) return null;
  return { p: [ox + dx * t, oy + dy * t, oz + dz * t], t };
}

export function pointInBoardDisk(p, board) {
  if (!p || !board?.p) return false;
  const [bx, , bz] = packVec3(board.p);
  const [x, , z] = packVec3(p);
  const r = Number(board.radius) || BOARD_RADIUS_M;
  return Math.hypot(x - bx, z - bz) <= r * 1.08;
}

export function seatLayout({ center, radius = TABLE_SEAT_RADIUS_M, count = 1, y = TABLE_HEIGHT_M } = {}) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const [cx, , cz] = packVec3(center);
  const seats = [];
  for (let i = 0; i < n; i += 1) {
    const ang = (i / n) * Math.PI * 2 + Math.PI / 2;
    const x = cx + Math.cos(ang) * radius;
    const z = cz + Math.sin(ang) * radius;
    const yaw = Math.atan2(cx - x, cz - z);
    seats.push({
      index: i,
      p: [x, y, z],
      yaw,
      q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    });
  }
  return seats;
}

export function assignRoundTableSeats(userIds, board = {}) {
  const ids = [...new Set((userIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  ids.sort();
  const center = board.p || [0, TABLE_HEIGHT_M, 0];
  const y = Number(center[1] ?? TABLE_HEIGHT_M);
  const layout = seatLayout({
    center,
    radius: Number(board.seatRadius) || TABLE_SEAT_RADIUS_M,
    count: ids.length || 1,
    y,
  });
  return ids.map((user_id, i) => ({
    user_id,
    p: layout[i].p,
    q: layout[i].q,
    yaw: layout[i].yaw,
  }));
}

export function locomotionForMode({
  mode = "god",
  board,
  seat = null,
} = {}) {
  const bp = packVec3(board?.p);
  if (seat?.p) {
    const sp = packVec3(seat.p);
    const yaw = Number(seat.yaw);
    const sitY = mode === "walk" ? 0 : -SIT_DROP_M;
    return {
      p: [sp[0], sitY, sp[2]],
      yaw: Number.isFinite(yaw) ? yaw : 0,
    };
  }
  if (mode === "walk") {
    return { p: [0, 0, 0], yaw: 0 };
  }
  return {
    p: [bp[0], GOD_LIFT_M, bp[2]],
    yaw: 0,
  };
}

export function formatAuthorTime(at, now = Date.now()) {
  const t = Number(at);
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "p" : "a";
  h = h % 12;
  if (h === 0) h = 12;
  const mm = m < 10 ? `0${m}` : String(m);
  const ageMin = Math.abs(Number(now) - t) / 60000;
  if (ageMin > 18 * 60) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${h}:${mm}${ap}`;
}

export function formatAuthorChip({ name, at, now } = {}) {
  const who = String(name || "Someone").trim().slice(0, 18) || "Someone";
  const when = formatAuthorTime(at, now);
  return when ? `${who} · ${when}` : who;
}

export function shouldShowAuthorChip({ authorId, localId } = {}) {
  const a = String(authorId || "").trim();
  const b = String(localId || "").trim();
  if (!a) return false;
  if (!b) return true;
  return a !== b;
}

export function tagXrAuthor(mesh, author = {}) {
  if (!mesh?.userData) return null;
  const id = String(author.id || author.authorId || author.author_id || "");
  const name = String(author.name || author.authorName || author.author_name || "");
  const at = Number(author.at || author.createdAt || author.created_at || Date.now()) || Date.now();
  mesh.userData.xrAuthorId = id;
  mesh.userData.xrAuthorName = name;
  mesh.userData.xrAuthorAt = at;
  mesh.userData.xrAuthor = { id, name, at };
  mesh.userData.createdBy = id;
  mesh.userData.createdAt = at;
  return mesh.userData.xrAuthor;
}

export function authorFromUserData(obj) {
  const u = obj?.userData || obj || {};
  const nested = u.xrAuthor || {};
  return {
    id: String(nested.id || u.xrAuthorId || u.createdBy || u.authorId || ""),
    name: String(nested.name || u.xrAuthorName || u.authorName || ""),
    at: Number(nested.at || u.xrAuthorAt || u.createdAt || 0) || 0,
  };
}

export function workspaceBoardLines({ active = false, mode = "god", teleport = false } = {}) {
  return [
    { id: BOARD_ACTIONS.openPanel, label: "Board", kind: "action", icon: "floor", active: !!active && mode === "god" },
    { id: BOARD_ACTIONS.setFloor, label: "Set floor", kind: "action", icon: "floor" },
    { id: BOARD_ACTIONS.roundTable, label: "Round table", kind: "action", icon: "social" },
    { id: BOARD_ACTIONS.walk, label: "Walk", kind: "action", icon: "front", active: mode === "walk" },
    { id: BOARD_ACTIONS.teleport, label: "Teleport", kind: "action", icon: "place", active: !!teleport },
  ];
}

function hideRaycast(mesh) {
  if (!mesh) return;
  mesh.raycast = () => {};
  mesh.userData.xrRaycast = false;
}

export function createXrBoard({ THREE: T, scene } = {}) {
  const group = new T.Group();
  group.name = "xrCollabBoard";
  try { scene?.add(group); } catch { /* ignore */ }

  const boardMat = new T.MeshStandardMaterial({
    color: 0xd6d3d1,
    roughness: 0.86,
    metalness: 0.04,
    transparent: true,
    opacity: 0.92,
  });
  const board = new T.Mesh(new T.CircleGeometry(BOARD_RADIUS_M, 64), boardMat);
  board.rotation.x = -Math.PI / 2;
  board.name = "xrBoardPlane";
  board.userData.xrBoardPlane = true;
  board.receiveShadow = false;
  group.add(board);

  const grid = new T.GridHelper(BOARD_RADIUS_M * 2, 16, 0x94a3b8, 0xcbd5e1);
  grid.position.y = 0.004;
  hideRaycast(grid);
  group.add(grid);

  const table = new T.Mesh(
    new T.CylinderGeometry(TABLE_SEAT_RADIUS_M + 0.18, TABLE_SEAT_RADIUS_M + 0.22, 0.06, 48),
    new T.MeshStandardMaterial({ color: 0x57534e, roughness: 0.7, metalness: 0.08 }),
  );
  table.position.y = -0.04;
  table.visible = false;
  table.userData.xrRoundTable = true;
  group.add(table);

  const chairs = new T.Group();
  chairs.name = "xrBoardChairs";
  group.add(chairs);

  const marker = new T.Mesh(
    new T.RingGeometry(0.08, 0.14, 24),
    new T.MeshBasicMaterial({ color: 0x38bdf8, side: T.DoubleSide, depthTest: false }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  marker.renderOrder = 2400;
  hideRaycast(marker);
  group.add(marker);

  group.visible = false;

  const state = {
    active: false,
    mode: "god",
    teleport: false,
    table: false,
    board: defaultBoardPoseFromHead({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }),
    seats: [],
    loco: { p: [0, 0, 0], yaw: 0 },
    baseRefSpace: null,
    baseSession: null,
    appliedRefSpace: null,
  };

  function applyBoardTransform() {
    const [x, y, z] = packVec3(state.board.p);
    group.position.set(x, y, z);
    const r = Number(state.board.radius) || BOARD_RADIUS_M;
    const s = r / BOARD_RADIUS_M;
    board.scale.setScalar(s);
    grid.scale.setScalar(s);
    table.scale.set(s, 1, s);
    group.visible = !!state.active;
  }

  function rebuildChairs(seats) {
    while (chairs.children.length) {
      const c = chairs.children.pop();
      try { c.geometry?.dispose?.(); } catch { /* ignore */ }
    }
    for (const seat of seats || []) {
      const mesh = new T.Mesh(
        new T.BoxGeometry(0.38, 0.08, 0.38),
        new T.MeshStandardMaterial({ color: 0x44403c, roughness: 0.8 }),
      );
      const [sx, , sz] = packVec3(seat.p);
      const [bx, , bz] = packVec3(state.board.p);
      mesh.position.set(sx - bx, 0.02, sz - bz);
      mesh.rotation.y = Number(seat.yaw) || 0;
      mesh.userData.xrChair = true;
      mesh.userData.userId = seat.user_id || "";
      chairs.add(mesh);
    }
  }

  function setBoardPose(pose, { activate = true } = {}) {
    if (pose?.p) state.board.p = packVec3(pose.p);
    if (pose?.radius) state.board.radius = Number(pose.radius) || BOARD_RADIUS_M;
    if (pose?.heightMode) state.board.heightMode = pose.heightMode;
    if (activate) state.active = true;
    applyBoardTransform();
    return state.board;
  }

  function setMode(mode) {
    state.mode = mode === "walk" ? "walk" : "god";
    if (state.mode !== "walk") state.teleport = false;
    return state.mode;
  }

  function setTeleport(on) {
    state.teleport = !!on;
    if (state.teleport) state.mode = "walk";
    marker.visible = false;
    return state.teleport;
  }

  function setTableVisible(on) {
    state.table = !!on;
    table.visible = !!on;
    chairs.visible = !!on;
  }

  function applySeats(seats) {
    state.seats = Array.isArray(seats) ? seats : [];
    setTableVisible(state.seats.length > 0);
    rebuildChairs(state.seats);
    return state.seats;
  }

  function seatForUser(userId) {
    const id = String(userId || "");
    return state.seats.find((s) => String(s.user_id) === id) || null;
  }

  function previewTeleport(point) {
    if (!state.teleport || !point) {
      marker.visible = false;
      return null;
    }
    const local = group.worldToLocal(point.clone ? point.clone() : new T.Vector3(point.x, point.y, point.z));
    marker.position.set(local.x, 0.01, local.z);
    marker.visible = true;
    return [point.x ?? point[0], state.board.p[1], point.z ?? point[2]];
  }

  function hideTeleportPreview() {
    marker.visible = false;
  }

  function captureRefSpace(renderer, { reset = false } = {}) {
    try {
      const session = renderer?.xr?.getSession?.();
      if (reset || !state.baseRefSpace || session !== state.baseSession) {
        state.baseRefSpace = renderer?.xr?.getReferenceSpace?.() || null;
        state.baseSession = session;
        state.loco = {p:[0,0,0],yaw:0};
        state.appliedRefSpace = state.baseRefSpace;
      }
    } catch { /* ignore */ }
    return state.baseRefSpace;
  }

  function applyLocomotion(renderer, loco) {
    state.loco = loco || state.loco;
    const space = state.baseRefSpace;
    if (!space || typeof XRRigidTransform === "undefined") return false;
    try {
      const [x, y, z] = packVec3(state.loco.p);
      const yaw = Number(state.loco.yaw) || 0;
      const t = new XRRigidTransform(
        { x, y, z, w: 1 },
        { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
      );
      state.appliedRefSpace = space.getOffsetReferenceSpace(t);
      renderer.xr.setReferenceSpace(state.appliedRefSpace);
      return true;
    } catch {
      return false;
    }
  }

  function packBoardMessage(extra = {}) {
    return {
      type: "xr.board",
      action: extra.action || (state.mode === "walk" ? "walk" : "god"),
      board: {
        p: packVec3(state.board.p),
        radius: Number(state.board.radius) || BOARD_RADIUS_M,
        heightMode: state.board.heightMode || "table",
      },
      mode: state.mode,
      teleport: !!state.teleport,
      ...extra,
    };
  }

  function packTableMessage(seats) {
    return {
      type: "xr.table",
      board: {
        p: packVec3(state.board.p),
        radius: Number(state.board.radius) || BOARD_RADIUS_M,
      },
      seats: (seats || state.seats).map((s) => ({
        user_id: s.user_id,
        p: packVec3(s.p),
        q: packQuat(s.q),
        yaw: Number(s.yaw) || 0,
      })),
    };
  }

  return {
    group,
    board,
    table,
    marker,
    state,
    setBoardPose,
    setMode,
    setTeleport,
    setTableVisible,
    applySeats,
    seatForUser,
    previewTeleport,
    hideTeleportPreview,
    captureRefSpace,
    applyLocomotion,
    applyBoardTransform,
    packBoardMessage,
    packTableMessage,
    pickables: () => [board],
  };
}
