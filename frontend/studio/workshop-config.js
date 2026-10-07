/** Personal Workshop scene, monitor, and world settings. */

import { normalizeWorkspaceWorld, persistWorkspaceWorld, readWorkspaceWorld } from "../xr/xr-workspace-world.js?v=20260923-workshop1";
import { activeSceneSpawn, defaultSceneManifest, normalizeSceneManifest } from "./scene-manifest.js?v=20260923-scene1";
import { normalizeGenerationPlacement } from "./generation-placement.js?v=20260923-spawn1";
import { migrateCanonicalWorkshop, WORKSHOP_PROFILE_SCHEMA } from "./workshop-scene-profile.js?v=20260929-workshop-scene-v3";

export const WORKSHOP_CONFIG_SCHEMA = WORKSHOP_PROFILE_SCHEMA;
export const WORKSHOP_CONFIG_KEY = "render3d:workshop-config:v1";
export const PERSONAL_WORKSHOP_CONFIG_KEY = `${WORKSHOP_CONFIG_KEY}:personal`;

export const WORKSHOP_MONITORS = Object.freeze([
  { id: "screen_robotics_controls", label: "Robotics controls" },
  { id: "screen_robot_pov", label: "Robot POV" },
  { id: "screen_task_queue", label: "Task queue" },
  { id: "screen_editor_ide", label: "Editor" },
  { id: "screen_training_data", label: "Training data" },
  { id: "screen_success_statistics", label: "Statistics" },
  { id: "screen_generated_files", label: "Project files" },
  { id: "screen_render_manager", label: "Render manager" },
]);

export const WORKSHOP_FEATURES = Object.freeze([
  { id: "robotics", label: "Robotics" },
  { id: "tasks", label: "Tasks" },
  { id: "editor", label: "Editor" },
  { id: "stats", label: "Statistics" },
  { id: "files", label: "Project files" },
  { id: "training", label: "Training" },
]);

const DEFAULT_ASSIGNMENTS = Object.freeze({
  robotics: "screen_robotics_controls",
  tasks: "screen_render_manager",
  editor: "screen_editor_ide",
  stats: "screen_success_statistics",
  files: "screen_generated_files",
  training: "screen_training_data",
});

export function defaultWorkshopConfig(projectId = "") {
  const manifest = defaultSceneManifest(projectId);
  return migrateCanonicalWorkshop({
    schema: WORKSHOP_CONFIG_SCHEMA,
    projectId: String(projectId || "anon"),
    scene: {
      name: "Project Workshop",
      environment: "workshop",
      background: "#1e293b",
      walkSpeed: 1.35,
      spawn: { x: 0, y: 1.65, z: 3.2, yaw: 0 },
    },
    manifest,
    generationPlacement: normalizeGenerationPlacement(),
    monitors: { ...DEFAULT_ASSIGNMENTS },
    world: normalizeWorkspaceWorld(null),
  }, projectId);
}

export function normalizeWorkshopConfig(raw, projectId = "") {
  const base = defaultWorkshopConfig(projectId);
  if (!raw || typeof raw !== "object") return base;
  raw = migrateCanonicalWorkshop(raw, projectId);
  const monitorIds = new Set(WORKSHOP_MONITORS.map((row) => row.id));
  const monitors = { ...base.monitors };
  for (const feature of WORKSHOP_FEATURES) {
    const screen = String(raw.monitors?.[feature.id] || "");
    if (monitorIds.has(screen)) monitors[feature.id] = screen;
  }
  const legacySpawn = raw.scene?.spawn || {};
  const manifestInput = raw.manifest || {
    projectId,
    name: raw.scene?.name,
    spawnPoints: [{ id: "entrance", label: "Entrance", position: [legacySpawn.x, legacySpawn.y, legacySpawn.z], yaw: legacySpawn.yaw }],
    activeSpawnId: "entrance",
  };
  const manifest = normalizeSceneManifest(manifestInput, projectId);
  const spawn = activeSceneSpawn(manifest);
  return {
    ...base,
    schema: raw.schema || base.schema,
    profileId: raw.profileId || null,
    scene: {
      ...base.scene,
      name: String(raw.scene?.name || base.scene.name).slice(0, 80),
      environment: ["workshop", "white", "warehouse"].includes(raw.scene?.environment)
        ? raw.scene.environment : base.scene.environment,
      background: /^#[0-9a-f]{6}$/i.test(raw.scene?.background || "")
        ? raw.scene.background : base.scene.background,
      walkSpeed: Math.max(0.4, Math.min(4, Number(raw.scene?.walkSpeed) || base.scene.walkSpeed)),
      spawn: { x: spawn.position[0], y: Math.max(0.2, spawn.position[1]), z: spawn.position[2], yaw: spawn.yaw },
    },
    manifest: { ...manifest, name: String(raw.scene?.name || manifest.name) },
    generationPlacement: normalizeGenerationPlacement(raw.generationPlacement),
    monitors,
    world: normalizeWorkspaceWorld(raw.world),
  };
}

export function readWorkshopConfig(projectId = "") {
  const id = String(projectId || "anon");
  try {
    let raw = JSON.parse(localStorage.getItem(PERSONAL_WORKSHOP_CONFIG_KEY) || "null");
    // Migrate the old project-scoped setting. Prefer the current project, then
    // any previously configured Workshop scene containing real assets.
    if (!raw) raw = JSON.parse(localStorage.getItem(`${WORKSHOP_CONFIG_KEY}:${id}`) || "null");
    if (!raw && typeof localStorage?.length === "number") {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        if (!key.startsWith(`${WORKSHOP_CONFIG_KEY}:`) || key === PERSONAL_WORKSHOP_CONFIG_KEY) continue;
        const candidate = JSON.parse(localStorage.getItem(key) || "null");
        if (candidate?.manifest?.assets?.length) { raw = candidate; break; }
      }
    }
    const next = normalizeWorkshopConfig(raw, id);
    if (!raw?.world) next.world = readWorkspaceWorld(id);
    if (raw) localStorage.setItem(PERSONAL_WORKSHOP_CONFIG_KEY, JSON.stringify(next));
    return next;
  } catch {
    return defaultWorkshopConfig(id);
  }
}

export function saveWorkshopConfig(config, projectId = config?.projectId || "") {
  const next = normalizeWorkshopConfig(config, projectId);
  persistWorkspaceWorld(next.world, next.projectId);
  try { localStorage.setItem(PERSONAL_WORKSHOP_CONFIG_KEY, JSON.stringify(next)); } catch { /* quota */ }
  return next;
}
