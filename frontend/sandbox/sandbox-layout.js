/** Modular sandbox panes — dock to sandbox / VR / workspace. Token sbdbg1. */

export const SBDBG1_TOKEN = "sbdbg1";
export const DOCKS = Object.freeze(["sandbox", "vr", "workspace"]);
export const LS_PANES = "render3d.sandbox.panes.v1";

export const SANDBOX_PANES = Object.freeze([
  { id: "viewport", title: "Debugger viewport", docks: ["sandbox", "vr", "workspace"], defaultOn: true, singleton: "webgl" },
  { id: "ide", title: "Live IDE", docks: ["sandbox", "workspace"], defaultOn: true },
  { id: "crew", title: "Crew floor", docks: ["sandbox", "vr", "workspace"], defaultOn: true },
  { id: "voice", title: "Voice look", docks: ["sandbox", "workspace"], defaultOn: true },
  { id: "bench", title: "Bot bench", docks: ["sandbox", "workspace"], defaultOn: true },
  { id: "hf", title: "HF skills", docks: ["sandbox", "vr"], defaultOn: true },
  { id: "arsenal", title: "Knowledge arsenal", docks: ["sandbox", "workspace"], defaultOn: true },
]);

export function defaultPaneState() {
  const out = {};
  for (const p of SANDBOX_PANES) out[p.id] = { on: p.defaultOn, dock: "sandbox" };
  return out;
}

export function loadPaneState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LS_PANES);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") return { ...defaultPaneState(), ...parsed };
  } catch { /* seed */ }
  return defaultPaneState();
}

export function savePaneState(state, storage = globalThis.localStorage) {
  try { storage?.setItem?.(LS_PANES, JSON.stringify(state)); } catch { /* private */ }
  return state;
}

export function togglePane(id, storage = globalThis.localStorage) {
  const state = loadPaneState(storage);
  if (!state[id]) return state;
  state[id] = { ...state[id], on: !state[id].on };
  return savePaneState(state, storage);
}

export function setPaneDock(id, dock, storage = globalThis.localStorage) {
  const state = loadPaneState(storage);
  if (!state[id] || !DOCKS.includes(dock)) return state;
  state[id] = { ...state[id], dock };
  return savePaneState(state, storage);
}

export function panesForDock(dock, storage = globalThis.localStorage) {
  const state = loadPaneState(storage);
  return SANDBOX_PANES.filter((p) => p.docks.includes(dock) && state[p.id]?.on && (state[p.id]?.dock === dock || dock === "sandbox"));
}

export function vrEnabledPanes(storage = globalThis.localStorage) {
  const state = loadPaneState(storage);
  return SANDBOX_PANES.filter((p) => p.docks.includes("vr") && state[p.id]?.on);
}

export function workspaceEnabledPanes(storage = globalThis.localStorage) {
  const state = loadPaneState(storage);
  return SANDBOX_PANES.filter((p) => p.docks.includes("workspace") && state[p.id]?.on);
}
