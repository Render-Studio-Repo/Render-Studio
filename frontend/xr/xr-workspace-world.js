/** Shared VR/PC workspace world — floors, tables, walls, spawn.
 *  Default is empty: CAD projects must not inherit a stock workshop mesh. */


export const WORKSPACE_WORLD_KEY = "render3d:workspace-world:v1";
export const WORKSPACE_WORLD_EVENT = "render3d:workspace-world";

export const WORKSPACE_WORLD_PIECES = [
  { id: "floor", label: "Studio floor", desc: "8 × 8 m wood-tone floor" },
  { id: "table", label: "Work table", desc: "Standing bench for CAD and arms" },
  { id: "round_table", label: "Agent round table", desc: "Crew table at the origin" },
  { id: "wall", label: "Partition", desc: "3 m wall bay" },
  { id: "pedestal", label: "Arm pedestal", desc: "OpenArm standstill mount" },
  { id: "lamp", label: "Area light", desc: "Soft overhead fill" },
  { id: "spawn", label: "Spawn mark", desc: "PC / VR entry point" },
];

export function emptyWorkspaceWorld() {
  return {
    schema: "render-studio-workspace-world/v1",
    pieces: [],
  };
}

/** Starter floor/table/spawn that was auto-copied into every project. */
export function isStockWorkshopSeed(pieces = []) {
  if (!Array.isArray(pieces) || !pieces.length) return true;
  if (pieces.length > 3) return false;
  const kinds = [...new Set(pieces.map((p) => String(p.kind || "")))].sort().join(",");
  return kinds === "floor" || kinds === "floor,spawn" || kinds === "floor,round_table" || kinds === "floor,round_table,spawn" || kinds === "round_table" || kinds === "round_table,spawn" || kinds === "spawn";
}

export function normalizeWorkspaceWorld(raw) {
  const base = emptyWorkspaceWorld();
  if (!raw || typeof raw !== "object") return base;
  const pieces = Array.isArray(raw.pieces) ? raw.pieces : [];
  const mapped = pieces.slice(0, 80).map((row, i) => ({
    id: String(row.id || `${row.kind || "piece"}-${i}`),
    kind: WORKSPACE_WORLD_PIECES.some((p) => p.id === row.kind) ? row.kind : "table",
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
    z: Number(row.z) || 0,
    yaw: Number(row.yaw) || 0,
  }));
  if (isStockWorkshopSeed(mapped)) return base;
  return {
    schema: "render-studio-workspace-world/v1",
    pieces: mapped,
  };
}

export function readWorkspaceWorld(projectId = "") {
  const key = `${WORKSPACE_WORLD_KEY}:${projectId || "anon"}`;
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null");
    const next = normalizeWorkspaceWorld(raw);
    if (raw && isStockWorkshopSeed(Array.isArray(raw.pieces) ? raw.pieces : [])) {
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota */ }
    }
    return next;
  } catch { /* ignore */ }
  return emptyWorkspaceWorld();
}

export function persistWorkspaceWorld(world, projectId = "") {
  const next = normalizeWorkspaceWorld(world);
  const key = `${WORKSPACE_WORLD_KEY}:${projectId || "anon"}`;
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota */ }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(WORKSPACE_WORLD_EVENT, { detail: { projectId, world: next } }));
  } catch { /* ignore */ }
  return next;
}

function meshForKind(THREE, kind) {
  if (kind === "floor") {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.06, 8),
      new THREE.MeshStandardMaterial({ color: 0x3f2f23, roughness: 0.86, metalness: 0.04 }),
    );
    mesh.position.y = -0.03;
    return mesh;
  }
  if (kind === "table") {
    const g = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.06, 0.9),
      new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.55 }),
    );
    top.position.y = 0.72;
    g.add(top);
    for (const [x, z] of [[-0.78, -0.36], [0.78, -0.36], [-0.78, 0.36], [0.78, 0.36]]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.72, 0.07),
        new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.2 }),
      );
      leg.position.set(x, 0.36, z);
      g.add(leg);
    }
    return g;
  }
  if (kind === "round_table") {
    const g = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.15, 0.07, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e3a4c, roughness: 0.45, metalness: 0.12 }),
    );
    top.position.y = 0.74;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.22, 0.7, 16),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.35, roughness: 0.3 }),
    );
    stem.position.y = 0.35;
    g.add(top, stem);
    return g;
  }
  if (kind === "wall") {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(3, 2.4, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.9 }),
    );
    mesh.position.y = 1.2;
    return mesh;
  }
  if (kind === "pedestal") {
    const g = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.34, 0.7, 20),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.25, roughness: 0.4 }),
    );
    base.position.y = 0.35;
    g.add(base);
    return g;
  }
  if (kind === "lamp") {
    const g = new THREE.Group();
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.32, 0.16, 16),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0xfbbf24, emissiveIntensity: 0.45 }),
    );
    shade.position.y = 2.35;
    g.add(shade);
    return g;
  }
  const mark = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.28, 24),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }),
  );
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = 0.02;
  return mark;
}

export function createWorkspaceWorld({ THREE, scene, getProjectId } = {}) {
  const root = new THREE.Group();
  root.name = "xr-workspace-world";
  root.userData.xrWorkspaceWorld = true;
  scene?.add(root);

  function clear() {
    while (root.children.length) {
      const child = root.children.pop();
      child.traverse?.((obj) => {
        obj.geometry?.dispose?.();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
        else obj.material?.dispose?.();
      });
      root.remove(child);
    }
  }

  function rebuild(world) {
    const data = normalizeWorkspaceWorld(world || readWorkspaceWorld(getProjectId?.() || ""));
    clear();
    for (const piece of data.pieces) {
      const mesh = meshForKind(THREE, piece.kind);
      mesh.position.set(piece.x, piece.y, piece.z);
      mesh.rotation.y = piece.yaw;
      mesh.userData.workspacePieceId = piece.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    root.visible = data.pieces.length > 0;
    return data;
  }

  function addPiece(kind, pose = {}) {
    const world = readWorkspaceWorld(getProjectId?.() || "");
    const id = `${kind}-${Date.now().toString(36)}`;
    world.pieces.push({
      id,
      kind,
      x: Number(pose.x) || 0,
      y: Number(pose.y) || 0,
      z: Number(pose.z) || (kind === "wall" ? -2.4 : kind === "spawn" ? 2.2 : 0),
      yaw: Number(pose.yaw) || 0,
    });
    persistWorkspaceWorld(world, getProjectId?.() || "");
    rebuild(world);
    return world;
  }

  function removeLast() {
    const world = readWorkspaceWorld(getProjectId?.() || "");
    if (!world.pieces.length) return world;
    world.pieces.pop();
    persistWorkspaceWorld(world, getProjectId?.() || "");
    return rebuild(world);
  }

  return {
    root,
    rebuild,
    addPiece,
    removeLast,
    read: () => readWorkspaceWorld(getProjectId?.() || ""),
  };
}
