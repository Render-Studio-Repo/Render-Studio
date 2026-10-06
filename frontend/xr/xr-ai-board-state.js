/** Authoritative VR AI Draw document. Commands commit completed interactions only.
 * GPU objects, audio bytes and live pointer samples never enter this store.
 * Records are immutable; history shares unchanged records rather than cloning a board.
 */
export const XR_AI_BOARD_VERSION = 1;
export const XR_AI_BOARD_LIMITS = Object.freeze({ nodes: 32, regions: 64, notes: 128, links: 96, drawings: 48, points: 128, history: 40 });
const TABLES = ["nodes", "regions", "notes", "links", "drawings"];
const BAD_IDS = new Set(["__proto__", "constructor", "prototype"]);
const str = (v, max = 4000) => typeof v === "string" ? v.slice(0, max) : "";
const id = (v) => { const s = str(v, 128); return /^[\w.:-]+$/.test(s) && !BAD_IDS.has(s) ? s : ""; };
const freshId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const freeze = (v) => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const vec = (v, fallback = [0, 0, 0], n = 3) => Array.from({ length: n }, (_, i) => Math.max(-1e6, Math.min(1e6, num(Array.isArray(v) ? v[i] : v?.[["x", "y", "z", "w"][i]], fallback[i] ?? 0))));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b); // At command boundaries, one record only.
const safeUrl = (v) => { const s = str(v, 1200); return /^(?:https?:\/\/|\/(?!\/))/.test(s) ? s : ""; };
const lookup = (state, targetId) => TABLES.map((key) => state[key]?.[targetId]).find(Boolean) || null;

export function boardPoints(points, max = XR_AI_BOARD_LIMITS.points) {
  if (!Array.isArray(points)) return [];
  const input = points.filter((p) => (Array.isArray(p) ? p.slice(0, 3) : [p?.x, p?.y, p?.z]).length === 3
    && (Array.isArray(p) ? p.slice(0, 3) : [p?.x, p?.y, p?.z]).every((n) => Number.isFinite(Number(n))));
  if (input.length <= max) return input.map((p) => vec(p));
  return Array.from({ length: max }, (_, i) => vec(input[Math.round(i * (input.length - 1) / (max - 1))]));
}

function transform(v = {}) {
  v ||= {};
  const quaternion = vec(v.quaternion, [0, 0, 0, 1], 4);
  const length = Math.hypot(...quaternion);
  return { position: vec(v.position), quaternion: length > 0 ? quaternion.map((x) => x / length) : [0, 0, 0, 1],
    scale: vec(v.scale, [1, 1, 1]).map((s) => Math.min(1000, Math.max(0.000001, s))) };
}

function source(v = {}) {
  v ||= {};
  return { projectId: str(v.projectId, 128), filename: str(v.filename, 500), revision: str(v.revision, 200),
    units: str(v.units, 40), dimensions: Array.isArray(v.dimensions) ? vec(v.dimensions) : null,
    url: safeUrl(v.url), thumbnailUrl: safeUrl(v.thumbnailUrl), mediaType: str(v.mediaType, 100),
    modelName: str(v.modelName, 160), description: str(v.description, 2000) };
}

export function validateBoardAnchor(value, nodes = {}) {
  if (!value || typeof value !== "object") return null;
  const nodeId = id(value.nodeId);
  const node = nodes[nodeId];
  const instanceId = id(value.instanceId) || node?.instanceId || nodeId;
  const sourceRevision = str(value.sourceRevision, 200);
  const mismatch = !node || node.kind !== "model" || instanceId !== node.instanceId
    || (sourceRevision !== str(node.source?.revision, 200));
  return { nodeId, instanceId, sourceRevision, sourceFilename: str(value.sourceFilename || node?.source?.filename, 500),
    faceId: value.faceId != null ? String(value.faceId).slice(0, 200) : "", meshId: str(value.meshId, 200), meshPath: str(value.meshPath || value.path, 500),
    triangleIndex: Number.isInteger(value.triangleIndex) && value.triangleIndex >= 0 ? value.triangleIndex : null,
    localPoints: boardPoints(value.localPoints), localNormal: vec(value.localNormal, [0, 1, 0]),
    sourceLocalPoint: value.sourceLocalPoint ? vec(value.sourceLocalPoint) : null,
    boardToSourceMatrix: Array.isArray(value.boardToSourceMatrix) && value.boardToSourceMatrix.length === 16
      && value.boardToSourceMatrix.every(Number.isFinite) ? value.boardToSourceMatrix.slice() : null,
    needsReattach: value.needsReattach === true || mismatch
      || (!!value.sourceFilename && value.sourceFilename !== node?.source?.filename) };
}

function normalizeRecord(table, value = {}, state, fixedId = "") {
  const recordId = id(fixedId || value.id) || freshId(table.slice(0, -1));
  const base = { id: recordId, name: str(value.name, 160) };
  if (table === "nodes") {
    const kind = ["model", "image", "memo"].includes(value.kind) ? value.kind : "image";
    return freeze({ ...base, kind, instanceId: id(value.instanceId) || recordId,
      name: base.name || (kind === "memo" ? "Voice memo" : kind === "model" ? "Model" : "Image"),
      source: source(value.source), transform: transform(value.transform), finalLook: kind === "image" && value.finalLook === true,
      transcript: str(value.transcript, 8000), audioUrl: safeUrl(value.audioUrl), thumbnailUrl: safeUrl(value.thumbnailUrl),
      duration: Math.max(0, num(value.duration)), presentationScale: Math.min(1000, Math.max(0.000001, num(value.presentationScale, 1))) });
  }
  if (table === "regions") return freeze({ ...base, kind: ["lasso", "face", "edge", "space"].includes(value.kind) ? value.kind : "lasso",
    nodeId: id(value.nodeId || value.anchor?.nodeId), anchor: validateBoardAnchor(value.anchor, state.nodes),
    points: boardPoints(value.points), position: vec(value.position), name: base.name || "Region" });
  if (table === "notes") {
    const v = value.requirements || {};
    return freeze({ ...base, name: base.name || "Note", regionId: id(value.regionId), nodeId: id(value.nodeId),
      text: str(value.text, 8000), expanded: value.expanded === true, position: vec(value.position),
      requirements: { printerModel: str(v.printerModel, 200), jointStyle: str(v.jointStyle, 300), assembly: str(v.assembly, 2000),
        intendedSplit: str(v.intendedSplit, 2000), missingDetails: Array.isArray(v.missingDetails) ? v.missingDetails.slice(0, 12).map((s) => str(s, 200)) : [], pending: v.pending === true } });
  }
  if (table === "links") return freeze({ ...base, fromId: id(value.fromId), toId: id(value.toId), caption: str(value.caption, 2000),
    referenceIds: Array.isArray(value.referenceIds) ? [...new Set(value.referenceIds.map(id).filter(Boolean))].slice(0, 32) : [] });
  return freeze({ ...base, tool: ["pen", "line", "arrow", "label"].includes(value.tool) ? value.tool : "pen",
    nodeId: id(value.nodeId || value.anchor?.nodeId), regionId: id(value.regionId),
    points: boardPoints(value.points), anchor: validateBoardAnchor(value.anchor, state.nodes),
    color: /^#[\da-f]{6}$/i.test(value.color) ? value.color : "#79b9c6", width: Math.min(0.03, Math.max(0.0005, num(value.width, 0.002))) });
}

export function normalizeBoardState(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const state = { version: XR_AI_BOARD_VERSION, id: id(value.id) || freshId("board"), title: str(value.title, 160) || "VR AI Draw",
    projectId: str(value.projectId, 128), revision: Math.max(0, Math.trunc(num(value.revision))), selectedIds: [],
    canvas: { enabled: value.canvas?.enabled === true, pose: value.canvas?.pose ? transform(value.canvas.pose) : null },
    nodes: {}, regions: {}, notes: {}, links: {}, drawings: {} };
  for (const table of TABLES) {
    const values = Array.isArray(value[table]) ? value[table] : Object.values(value[table] || {});
    for (const record of values.slice(0, XR_AI_BOARD_LIMITS[table])) {
      if (!record || typeof record !== "object") continue;
      const clean = normalizeRecord(table, record, state);
      if (TABLES.some((key) => state[key][clean.id])) continue;
      if (table === "links" && (!lookup(state, clean.fromId) || !lookup(state, clean.toId) || clean.fromId === clean.toId)) continue;
      state[table][clean.id] = clean;
    }
  }
  state.selectedIds = [...new Set((Array.isArray(value.selectedIds) ? value.selectedIds : []).map(id).filter((s) => lookup(state, s)))].slice(0, 32);
  return freeze(state);
}

function updateAnchors(state, nodeId) {
  let next = state;
  for (const table of ["regions", "drawings"]) {
    for (const record of Object.values(state[table])) {
      if (record.anchor?.nodeId !== nodeId) continue;
      const anchor = validateBoardAnchor(record.anchor, state.nodes);
      if (same(record.anchor, anchor)) continue;
      next = { ...next, [table]: { ...next[table], [record.id]: freeze({ ...record, anchor }) } };
    }
  }
  return next;
}

function removeIds(state, initialIds) {
  const removed = new Set(initialIds);
  // References owned by a removed instance go too; source files are untouched.
  let grew = true;
  while (grew) {
    grew = false;
    for (const table of TABLES) for (const row of Object.values(state[table])) {
      if (removed.has(row.id)) continue;
      if (removed.has(row.nodeId) || removed.has(row.regionId) || removed.has(row.anchor?.nodeId)
        || (table === "links" && (removed.has(row.fromId) || removed.has(row.toId)))) { removed.add(row.id); grew = true; }
    }
  }
  const next = { ...state, selectedIds: state.selectedIds.filter((s) => !removed.has(s)) };
  for (const table of TABLES) {
    if (Object.keys(state[table]).some((key) => removed.has(key))) next[table] = Object.fromEntries(Object.entries(state[table]).filter(([key]) => !removed.has(key)));
  }
  return next;
}

function reduceCommand(state, command) {
  if (!command || typeof command !== "object") throw new Error("A board command is required.");
  const type = command.type;
  if (type === "batch") {
    if (!Array.isArray(command.commands) || command.commands.length > 128) throw new Error("Too many board commands in one interaction.");
    let next = state, lastId = "";
    for (const cmd of command.commands) { const result = reduceCommand(next, cmd); next = result.state; lastId = result.id || lastId; }
    return { state: next, id: lastId };
  }
  if (type === "selection.set") {
    const ids = [...new Set((command.ids || []).map(id).filter((s) => lookup(state, s)))].slice(0, 32);
    return { state: same(ids, state.selectedIds) ? state : { ...state, selectedIds: ids } };
  }
  if (type === "board.update") {
    const title = str(command.patch?.title, 160) || state.title;
    const canvas = command.patch?.canvas ? { enabled: command.patch.canvas.enabled === true, pose: command.patch.canvas.pose ? transform(command.patch.canvas.pose) : null } : state.canvas;
    return { state: title === state.title && same(canvas, state.canvas) ? state : { ...state, title, canvas } };
  }
  const [entity, action] = String(type || "").split(".");
  const table = `${entity}s`;
  if (!TABLES.includes(table)) throw new Error("Unknown board command.");
  const targetId = id(command.id);
  const old = state[table][targetId];
  if (action === "remove") return { state: old ? removeIds(state, [targetId]) : state, id: targetId };
  if (action === "duplicate" && table === "nodes") {
    if (!old) throw new Error("Select a node to duplicate.");
    const duplicateId = id(command.newId) || freshId("node");
    const position = old.transform.position.map((n, i) => n + (i === 0 ? 0.12 : 0));
    return reduceCommand(state, { type: "node.add", node: { ...old, id: duplicateId, instanceId: duplicateId,
      name: `${old.name} copy`, transform: { ...old.transform, position } } });
  }
  if (!["add", "update", "transform"].includes(action) || (action === "transform" && table !== "nodes")) throw new Error("Unknown board command.");
  if (action !== "add" && !old) throw new Error("That board item no longer exists.");
  const input = action === "add" ? (command[entity] || command.value || {}) : {
    ...old, ...(command.patch || {}),
    ...(action === "transform" ? { transform: { ...old.transform, ...(command.transform || command.patch || {}) } } : {}),
  };
  const recordId = action === "add" ? id(input.id) || freshId(entity) : targetId;
  if (action === "add" && lookup(state, recordId)) throw new Error("A board item already uses that ID.");
  if (action === "add" && Object.keys(state[table]).length >= XR_AI_BOARD_LIMITS[table]) throw new Error(`This board has reached its ${table} limit (${XR_AI_BOARD_LIMITS[table]}). Remove an item before adding more.`);
  const row = normalizeRecord(table, input, state, recordId);
  if (table === "links" && (!lookup(state, row.fromId) || !lookup(state, row.toId) || row.fromId === row.toId)) throw new Error("Select two different existing board items to link.");
  if (table === "notes" && ((row.regionId && !state.regions[row.regionId]) || (row.nodeId && !state.nodes[row.nodeId]))) throw new Error("The note's original region or node is no longer on this board.");
  if ((table === "regions" || table === "drawings") && row.nodeId && !state.nodes[row.nodeId]) throw new Error("The target model is no longer on this board.");
  if (same(old, row)) return { state, id: row.id };
  let next = { ...state, [table]: { ...state[table], [row.id]: row } };
  if (table === "nodes") next = updateAnchors(next, row.id);
  return { state: next, id: row.id };
}

export function createXrAiBoardStore(initialState = {}, { historyLimit = XR_AI_BOARD_LIMITS.history } = {}) {
  let state = normalizeBoardState(initialState);
  const past = [], future = [], listeners = new Set();
  const max = Math.min(XR_AI_BOARD_LIMITS.history, Math.max(1, Number(historyLimit) || XR_AI_BOARD_LIMITS.history));
  function emit(command, previous) {
    const changedIds = TABLES.flatMap((table) => [...new Set([...Object.keys(previous[table]), ...Object.keys(state[table])])]
      .filter((key) => previous[table][key] !== state[table][key]));
    const event = { command, changedIds, persistent: command.type !== "selection.set", canUndo: past.length > 0, canRedo: future.length > 0 };
    for (const listener of listeners) { try { listener(state, event); } catch (error) { console.warn("VR Draw board listener", error); } }
  }
  return {
    getState: () => state,
    dispatch(command) {
      try {
        const result = reduceCommand(state, command);
        if (result.state === state) return { changed: false, id: result.id, state };
        const previous = state;
        if (command.type !== "selection.set") { past.push(state); if (past.length > max) past.shift(); future.length = 0; }
        state = freeze({ ...result.state, revision: command.type === "selection.set" ? state.revision : state.revision + 1 });
        emit(command, previous);
        return { changed: true, id: result.id, state };
      } catch (error) { return { changed: false, error: error.message || "Could not update the Draw board.", state }; }
    },
    undo() {
      if (!past.length) return false;
      const previous = state; future.push(state); state = freeze({ ...past.pop(), revision: state.revision + 1 }); emit({ type: "undo" }, previous); return true;
    },
    redo() {
      if (!future.length) return false;
      const previous = state; past.push(state); state = freeze({ ...future.pop(), revision: state.revision + 1 }); emit({ type: "redo" }, previous); return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    replaceState(value = {}) { const previous = state; state = normalizeBoardState(value); past.length = future.length = 0; emit({ type: "load" }, previous); return state; },
    exportState: () => ({ ...state, selectedIds: [] }),
  };
}
