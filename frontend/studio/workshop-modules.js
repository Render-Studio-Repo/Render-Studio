/** Importable Workshop modules — feature board, tech wall, world, agents. */

export const WORKSHOP_TAB_ID = "workshop:open";

export const WORKSHOP_MODULES = [
  { id: "enter", label: "Enter", desc: "VR or God View" },
  { id: "world", label: "World", desc: "Floors, tables, walls" },
  { id: "agents", label: "Agents", desc: "God view of the round table" },
  { id: "board", label: "Board", desc: "Live vs gated features" },
  { id: "wall", label: "Tech wall", desc: "Debug extraction, no second WebGL" },
];

export async function loadWorkshopModule(id) {
  if (id === "board") {
    const mod = await import("../sandbox/sandbox-feature-board.js?v=20260923-draw-recordings1");
    return { id, markup: mod.featureBoardMarkup?.() || "", bind: mod.bindFeatureBoard };
  }
  if (id === "wall") {
    const mod = await import("../sandbox/sandbox-tech-wall.js?v=20260923-draw-recordings1&vrrobot=20260927-2");
    return { id, markup: mod.techWallMarkup?.() || "", bind: mod.bindTechWall };
  }
  if (id === "world") {
    const { WORKSPACE_WORLD_PIECES, readWorkspaceWorld } = await import("../xr/xr-workspace-world.js?v=wsworld2");
    return { id, pieces: WORKSPACE_WORLD_PIECES, read: readWorkspaceWorld };
  }
  if (id === "agents") {
    const { worktopSeatLayout } = await import("./worktop-viewer.js?v=worktop1");
    return { id, layout: worktopSeatLayout };
  }
  return { id };
}
