export const MESH_ENGINES = Object.freeze({
  stable: Object.freeze({
    id: "stable",
    mode: "mesh",
    label: "Regular",
    version: "2.0.0",
    runtime: "img2threejs",
    description: "Procedural PBR meshes with hierarchy and no animation rigging.",
  }),
  beta: Object.freeze({
    id: "beta",
    mode: "mesh_beta",
    label: "Beta",
    version: "2.0.0",
    runtime: "img2threejs + character plugin",
    description: "Plugin-based character clips, VFX, and viewport playback.",
  }),
});

export function normalizeMeshEngine(engine) {
  return String(engine || "").toLowerCase() === "beta" ? "beta" : "stable";
}

export function meshEngine(engine) {
  return MESH_ENGINES[normalizeMeshEngine(engine)];
}

export function meshEngineLabel(engine, { withVersion = false } = {}) {
  const entry = meshEngine(engine);
  return withVersion ? `${entry.label} (${entry.version})` : entry.label;
}

export function meshModeForEngine(engine) {
  return meshEngine(engine).mode;
}
