/** Canonical personal Workshop scene. Pure data/migration/layout helpers only. */

export const WORKSHOP_PROFILE_SCHEMA = "render-studio-workshop/v2";
export const CANONICAL_WORKSHOP_PROFILE = Object.freeze({
  id: "personal-industrial-robotics-v2",
  asset: Object.freeze({
    projectId: "0a12e415",
    filename: "mesh/Optimized Realistic Industrial Robotics.glb",
    label: "Industrial Robotics Workshop",
    units: "m",
    metersPerUnit: 1,
    transform: Object.freeze({ position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [1, 1, 1] }),
  }),
  spawn: Object.freeze({ x: 0, y: 1.65, z: 5.2, yaw: Math.PI }),
  robot: Object.freeze({ node: "Clean_robot_mounting_plate", fallback: [0, 0.938, -1.8] }),
  cad: Object.freeze({ node: "Composite_worktop_2", fallback: [4.13, 0.885, -4.8], yaw: -Math.PI / 6 }),
});

const vec3 = (value, fallback) => Array.from({ length: 3 }, (_, i) => Number.isFinite(Number(value?.[i])) ? Number(value[i]) : fallback[i]);

export function isCanonicalWorkshopAsset(asset) {
  return String(asset?.projectId || asset?.project_id || "") === CANONICAL_WORKSHOP_PROFILE.asset.projectId
    && String(asset?.filename || asset?.viewer_filename || "") === CANONICAL_WORKSHOP_PROFILE.asset.filename;
}

export function isCanonicalWorkshopConfig(config) {
  return config?.profileId === CANONICAL_WORKSHOP_PROFILE.id
    || (config?.manifest?.assets || []).some(isCanonicalWorkshopAsset);
}

export function canonicalWorkshopAsset() {
  const asset = CANONICAL_WORKSHOP_PROFILE.asset;
  return { ...asset, transform: { position: [...asset.transform.position], rotation: [...asset.transform.rotation], scale: [...asset.transform.scale] } };
}

/** Empty and prior canonical personal Workshops migrate; unrelated custom scenes do not. */
export function shouldMigrateCanonicalWorkshop(raw) {
  if (!raw || typeof raw !== "object") return true;
  if (raw.profileId === CANONICAL_WORKSHOP_PROFILE.id) return true;
  const assets = Array.isArray(raw.manifest?.assets) ? raw.manifest.assets : [];
  return assets.length === 0 || assets.some(isCanonicalWorkshopAsset);
}

export function migrateCanonicalWorkshop(raw = {}, projectId = "") {
  if (!shouldMigrateCanonicalWorkshop(raw)) return raw;
  const profile = CANONICAL_WORKSHOP_PROFILE;
  const manifest = raw.manifest && typeof raw.manifest === "object" ? raw.manifest : {};
  return {
    ...raw,
    schema: WORKSHOP_PROFILE_SCHEMA,
    profileId: profile.id,
    projectId: String(projectId || raw.projectId || "anon"),
    scene: { ...raw.scene, environment: "workshop", spawn: { ...profile.spawn } },
    manifest: {
      ...manifest,
      name: manifest.name || raw.scene?.name || "Project Workshop",
      assets: [canonicalWorkshopAsset()],
      spawnPoints: [{ id: "entrance", label: "Entrance", position: [profile.spawn.x, profile.spawn.y, profile.spawn.z], yaw: profile.spawn.yaw }],
      activeSpawnId: "entrance",
    },
    generationPlacement: canonicalCadPlacement(),
    world: { ...(raw.world || {}), pieces: [] },
  };
}

export function canonicalRoomTransform(config, { desktop = false } = {}) {
  if (!isCanonicalWorkshopConfig(config)) return null;
  const transform = canonicalWorkshopAsset().transform;
  if (desktop) transform.rotation[0] += Math.PI;
  return transform;
}

/** Resolver receives a node name and returns its already-converted world-space top center. */
export function resolveCanonicalWorkshopLayout(config, resolveNodeTopCenter) {
  if (!isCanonicalWorkshopConfig(config)) return null;
  const resolve = (entry) => vec3(resolveNodeTopCenter?.(entry.node), entry.fallback);
  return {
    robot: { node: CANONICAL_WORKSHOP_PROFILE.robot.node, position: resolve(CANONICAL_WORKSHOP_PROFILE.robot) },
    cad: { node: CANONICAL_WORKSHOP_PROFILE.cad.node, position: resolve(CANONICAL_WORKSHOP_PROFILE.cad), yaw: CANONICAL_WORKSHOP_PROFILE.cad.yaw },
  };
}

export function canonicalWorkshopSpawn(config) {
  return isCanonicalWorkshopConfig(config) ? { ...CANONICAL_WORKSHOP_PROFILE.spawn } : null;
}

export function canonicalCadPlacement(position = CANONICAL_WORKSHOP_PROFILE.cad.fallback) {
  return {
    target: "surface",
    position: vec3(position, CANONICAL_WORKSHOP_PROFILE.cad.fallback),
    normal: [0, 1, 0],
    sizeMeters: 0.6,
    clearanceMeters: 0.005,
    surfaceId: CANONICAL_WORKSHOP_PROFILE.cad.node,
    label: "Workshop CAD worktop",
    yaw: CANONICAL_WORKSHOP_PROFILE.cad.yaw,
  };
}
