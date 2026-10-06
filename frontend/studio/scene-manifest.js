/** Portable, project-scoped scene manifest used by Workshop and scene exports. */

export const SCENE_MANIFEST_SCHEMA = "render-studio-scene/v1";
export const DEFAULT_AVATAR_HEIGHT_M = 1.75;
export const MIN_SCENE_SIDE_M = 6;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const vec3 = (value, fallback) => Array.from({ length: 3 }, (_, index) => finite(value?.[index], fallback[index]));

export function sceneAssetId(projectId, filename) {
  return `${String(projectId || "anon")}:${String(filename || "model")}`;
}

export function normalizeSceneAsset(raw = {}) {
  const projectId = String(raw.projectId || raw.project_id || "anon");
  const filename = String(raw.filename || raw.viewer_filename || raw.name || "");
  const dimensions = vec3(raw.dimensionsMeters || raw.dimensions_m, [0, 0, 0]).map((n) => Math.max(0, n));
  return {
    id: String(raw.id || sceneAssetId(projectId, filename)),
    kind: "model",
    projectId,
    filename,
    label: String(raw.label || raw.stem || filename.replace(/\.[^.]+$/, "") || "Model").slice(0, 120),
    units: "m",
    metersPerUnit: clamp(raw.metersPerUnit ?? raw.meters_per_unit ?? 1, 0.000001, 1000),
    transform: {
      position: vec3(raw.transform?.position, [0, 0, 0]),
      rotation: vec3(raw.transform?.rotation, [0, 0, 0]),
      scale: vec3(raw.transform?.scale, [1, 1, 1]).map((n) => clamp(n, 0.000001, 1000)),
    },
    dimensionsMeters: dimensions,
  };
}

export function boundsForAssets(assets = [], avatarHeightM = DEFAULT_AVATAR_HEIGHT_M) {
  const avatar = clamp(avatarHeightM, 1, 2.5);
  let width = MIN_SCENE_SIDE_M;
  let depth = MIN_SCENE_SIDE_M;
  let height = Math.max(3, avatar + 1.25);
  for (const asset of assets) {
    const item = normalizeSceneAsset(asset);
    const [x, y, z] = item.dimensionsMeters.map((n, i) => n * item.transform.scale[i]);
    width = Math.max(width, x + avatar * 3);
    depth = Math.max(depth, z + avatar * 3);
    height = Math.max(height, y + avatar * 0.75);
  }
  return { width, height, depth, avatarHeightM: avatar, paddingM: avatar * 1.5 };
}

export function defaultSceneManifest(projectId = "") {
  return {
    schema: SCENE_MANIFEST_SCHEMA,
    projectId: String(projectId || "anon"),
    name: "Project Workshop",
    assets: [],
    bounds: boundsForAssets([]),
    spawnPoints: [{ id: "entrance", label: "Entrance", position: [0, 1.65, 3.2], yaw: 0 }],
    activeSpawnId: "entrance",
    publication: { state: "draft", target: "profile_marketplace", exportedAt: null },
  };
}

export function normalizeSceneManifest(raw, projectId = "") {
  const base = defaultSceneManifest(projectId);
  if (!raw || typeof raw !== "object") return base;
  const assets = (Array.isArray(raw.assets) ? raw.assets : []).map(normalizeSceneAsset).filter((item) => item.filename);
  const rawSpawns = Array.isArray(raw.spawnPoints) ? raw.spawnPoints : [];
  const spawnPoints = rawSpawns.length ? rawSpawns.slice(0, 24).map((spawn, index) => ({
    id: String(spawn?.id || `spawn-${index + 1}`),
    label: String(spawn?.label || `Spawn ${index + 1}`).slice(0, 80),
    position: vec3(spawn?.position, [0, 1.65, 0]),
    yaw: finite(spawn?.yaw, 0),
  })) : base.spawnPoints;
  const activeSpawnId = spawnPoints.some((spawn) => spawn.id === raw.activeSpawnId)
    ? raw.activeSpawnId : spawnPoints[0].id;
  const fitted = boundsForAssets(assets, raw.bounds?.avatarHeightM);
  return {
    ...base,
    projectId: String(projectId || raw.projectId || base.projectId),
    name: String(raw.name || base.name).slice(0, 80),
    assets,
    bounds: {
      width: clamp(raw.bounds?.width ?? fitted.width, MIN_SCENE_SIDE_M, 500),
      height: clamp(raw.bounds?.height ?? fitted.height, 2.5, 100),
      depth: clamp(raw.bounds?.depth ?? fitted.depth, MIN_SCENE_SIDE_M, 500),
      avatarHeightM: fitted.avatarHeightM,
      paddingM: fitted.paddingM,
    },
    spawnPoints,
    activeSpawnId,
    publication: {
      state: raw.publication?.state === "exported" ? "exported" : "draft",
      target: "profile_marketplace",
      exportedAt: raw.publication?.exportedAt || null,
    },
  };
}

export function addAssetToScene(manifest, asset) {
  const nextAsset = normalizeSceneAsset(asset);
  const next = normalizeSceneManifest(manifest, manifest?.projectId || nextAsset.projectId);
  next.assets = [...next.assets.filter((item) => item.id !== nextAsset.id), nextAsset];
  next.bounds = boundsForAssets(next.assets, next.bounds.avatarHeightM);
  return next;
}

export function activeSceneSpawn(manifest) {
  const next = normalizeSceneManifest(manifest, manifest?.projectId);
  return next.spawnPoints.find((spawn) => spawn.id === next.activeSpawnId) || next.spawnPoints[0];
}

export function exportableScenePackage(manifest) {
  const next = normalizeSceneManifest(manifest, manifest?.projectId);
  return {
    ...next,
    publication: { ...next.publication, state: "exported", exportedAt: new Date().toISOString() },
    install: { kind: "workshop", action: "install_scene_manifest", schema: SCENE_MANIFEST_SCHEMA },
  };
}

export async function publishSceneToMarketplace(api, manifest, { pinToProfile } = {}) {
  if (typeof api !== "function") throw new Error("Marketplace API is unavailable.");
  const scene = exportableScenePackage(manifest);
  if (!scene.assets.length) throw new Error("Add at least one model before publishing this scene.");
  const created = await api("/api/model-listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: scene.name,
      tagline: `${scene.name} VR workshop scene`.slice(0, 120),
      description: `${scene.name} is a life-size Render Studio scene with avatar-safe bounds and a configured entry point.`,
      category: "workshop-scenes",
      access_mode: "free",
      license: "cc-by",
      price_cents: 0,
      download_enabled: true,
      files: [{ name: `${scene.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.scene.json`, product_type: SCENE_MANIFEST_SCHEMA, scene }],
    }),
  });
  const listing = created?.listing || created;
  if (!listing?.id) throw new Error("Marketplace did not return a scene listing.");
  if (typeof pinToProfile === "function") await pinToProfile(listing);
  return listing;
}
