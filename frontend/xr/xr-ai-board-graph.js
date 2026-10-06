/** Reference resolution and prompt snapshots for the shared VR Draw board. */
const TABLES = ["nodes", "regions", "notes", "links", "drawings"];
const copy = (value) => JSON.parse(JSON.stringify(value));
const freeze = (value) => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const find = (state, id) => TABLES.map((key) => state[key]?.[id]).find(Boolean) || null;
const text = (v, max = 8000) => typeof v === "string" ? v.slice(0, max) : "";

export function boardMentionItems(state) {
  return ["nodes", "regions", "notes"].flatMap((table) => Object.values(state?.[table] || {}).map((row) => ({
    id: row.id, name: row.name || (table === "notes" ? row.text.slice(0, 60) : row.kind) || "Reference",
    kind: table === "nodes" ? row.kind : table.slice(0, -1), thumbnailUrl: row.thumbnailUrl || row.source?.thumbnailUrl || "",
    token: `@{${row.id}}`,
  })));
}

export function boardMentionToken(_state, id) { return `@{${String(id || "").replace(/[^\w.:-]/g, "")}}`; }

export function resolveBoardMentions(value, state) {
  return text(value, 24000).replace(/@\{([\w.:-]+)\}/g, (token, id) => {
    const row = find(state, id);
    return row ? `@${row.name || row.kind || "Reference"} [${id}]` : `${token} [reference unavailable]`;
  });
}

/** Undirected links, semantic parents/children and explicit caption @refs form one graph. */
export function boardConnectedGraph(state, seedIds = state?.selectedIds) {
  state ||= {};
  const all = new Map(TABLES.flatMap((table) => Object.values(state[table] || {}).map((row) => [row.id, { table, row }])));
  const adjacency = new Map([...all.keys()].map((id) => [id, new Set()]));
  const edge = (a, b) => { if (a !== b && all.has(a) && all.has(b)) { adjacency.get(a).add(b); adjacency.get(b).add(a); } };
  for (const [recordId, { row, table }] of all) {
    edge(recordId, row.nodeId); edge(recordId, row.regionId); edge(recordId, row.anchor?.nodeId);
    if (table === "links") {
      edge(recordId, row.fromId); edge(recordId, row.toId);
      for (const ref of row.referenceIds || []) edge(recordId, ref);
      for (const match of (row.caption || "").matchAll(/@\{([\w.:-]+)\}/g)) edge(recordId, match[1]);
    }
    for (const match of (row.text || "").matchAll(/@\{([\w.:-]+)\}/g)) edge(recordId, match[1]);
  }
  const seeds = Array.isArray(seedIds) ? seedIds.filter((id) => all.has(id)) : [];
  const queue = seeds.length ? [...new Set(seeds)] : [...all.keys()];
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i += 1) for (const neighbor of adjacency.get(queue[i]) || []) if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
  const result = { boardId: state.id || "", boardRevision: state.revision || 0, title: state.title || "VR AI Draw", selectedIds: [...seeds], nodes: [], regions: [], notes: [], links: [], drawings: [] };
  for (const recordId of queue) { const item = all.get(recordId); if (item) result[item.table].push(item.row); }
  return result;
}

function compactGraph(graph) {
  return { ...graph,
    nodes: graph.nodes.map(({ id, name, kind, instanceId, source, transform, finalLook, transcript }) => ({ id, name, kind, instanceId, source, transform, finalLook, ...(transcript ? { transcript } : {}) })),
    regions: graph.regions.map(({ id, name, kind, nodeId, anchor, points, position }) => ({ id, name, kind, nodeId, anchor, points, position })),
    notes: graph.notes.map(({ id, name, regionId, nodeId, text, requirements, position }) => ({ id, name, regionId, nodeId, text, requirements, position })),
    links: graph.links.map(({ id, fromId, toId, caption, referenceIds }) => ({ id, fromId, toId, caption, referenceIds })),
  };
}

export function boardPromptContext(state, { seedIds } = {}) {
  const graph = boardConnectedGraph(state, seedIds ?? []);
  const lines = ["VR Draw planning board — annotations are instructions for review, not executed CAD changes.",
    "Spatial presentation coordinates use metres. Presentation scale does not change source CAD units, dimensions or assembly proportions.",
    "Resolve references by stable ID. Surface anchors marked needsReattach must be reattached before using them to locate a CAD edit. Do not invent printer build volumes or connector choices."];
  for (const node of graph.nodes) {
    lines.push(`@${node.name} [${node.id}] (${node.kind}${node.finalLook ? ", Final look" : ""}): ${node.source?.filename || "project reference"}${node.source?.revision ? `; revision ${node.source.revision}` : ""}${node.source?.units ? `; original units ${node.source.units}` : ""}`);
    if (node.transcript) lines.push(`Memo transcript [${node.id}]: ${resolveBoardMentions(node.transcript, state)}`);
  }
  for (const region of graph.regions) lines.push(`Region @${region.name} [${region.id}]${region.nodeId ? ` on [${region.nodeId}]` : " in space"}${region.anchor?.needsReattach ? " — NEEDS REATTACHMENT" : ""}.`);
  for (const note of graph.notes) {
    lines.push(`Note [${note.id}] for [${note.regionId || note.nodeId || "spatial board"}]: ${resolveBoardMentions(note.text, state)}`);
    const needs = note.requirements;
    if (needs?.intendedSplit) lines.push(`Intended split: ${needs.intendedSplit}`);
    if (needs?.assembly) lines.push(`Assembly requirements: ${needs.assembly}`);
    if (needs?.printerModel) lines.push(`Printer: ${needs.printerModel}`);
    if (needs?.jointStyle) lines.push(`Joint/connector style: ${needs.jointStyle}`);
    if (needs?.missingDetails?.length) lines.push(`Clarify before generation: ${needs.missingDetails.join(", ")}`);
  }
  for (const link of graph.links) lines.push(`Link [${link.id}]: [${link.fromId}] ↔ [${link.toId}] — ${resolveBoardMentions(link.caption, state) || "relationship not yet described"}`);
  if (state.canvas?.enabled) lines.push('A 2D canvas is open. Canvas placement and drawing geometry are included in the board snapshot.');
  for (const drawing of graph.drawings) {
    const points = drawing.anchor?.localPoints?.length ? drawing.anchor.localPoints : drawing.points || [];
    const bounds = points.length ? [0, 1, 2].map(axis => [Math.min(...points.map(point => point[axis])), Math.max(...points.map(point => point[axis]))]) : null;
    lines.push(`Drawing [${drawing.id}] (${drawing.tool || 'pen'}): ${points.length} vertices; ${drawing.anchor ? `node-local coordinates on [${drawing.anchor.nodeId}], apply its presentation transform` : 'world coordinates in metres'}${drawing.anchor?.needsReattach ? '; NEEDS REATTACHMENT' : ''}${bounds ? `; XYZ bounds ${JSON.stringify(bounds)}` : ''}. Full vertices are in the board snapshot.`);
  }
  return { graph, text: lines.join("\n"), references: graph.nodes.map((node) => ({ id: node.id, name: node.name, kind: node.kind, ...node.source, finalLook: node.finalLook })) };
}

/** Append only; a reviewed draft and existing attachments are never replaced. */
export function organizeBoardPrompt(state, { seedIds, prompt = "", attachments = [] } = {}) {
  const context = boardPromptContext(state, { seedIds });
  const original = text(prompt, 32000);
  const marker = `\n\n[VR Draw board ${state.id} · revision ${state.revision}]\n`;
  const organized = `${original}${original.includes(marker) ? "" : `${marker}${context.text}`}`;
  const merged = [...attachments];
  const keys = new Set(merged.map((row) => row.boardNodeId || row.id || `${row.projectId}:${row.filename || row.source_filename || row.url}`));
  for (const node of context.graph.nodes) {
    if (keys.has(node.id)) continue;
    keys.add(node.id);
    merged.push({ id: node.id, boardNodeId: node.id, name: node.name, kind: node.kind, source_filename: node.source.filename,
      projectId: node.source.projectId, sourceRevision: node.source.revision, url: node.source.url, finalLook: node.finalLook });
  }
  return { prompt: organized, originalPrompt: original, attachments: merged, graph: context.graph };
}

/** Called at the explicit Generate boundary, never from a voice annotation command. */
export function createBoardSnapshot(state, { seedIds, prompt = "", attachments = [] } = {}) {
  const graph = compactGraph(boardConnectedGraph(state, seedIds ?? []));
  // Existing composer attachments may contain megapixel data URLs. The generation
  // pipeline owns those bytes; this immutable spatial manifest contains IDs only.
  const manifest = (Array.isArray(attachments) ? attachments : []).slice(0, 80).map((item) => ({
    id: text(item.id || item.boardNodeId, 128), name: text(item.name, 160), kind: text(item.kind || item.type, 32),
    projectId: text(item.projectId, 128), source_filename: text(item.source_filename || item.filename, 500),
    sourceRevision: text(item.sourceRevision, 200), role: text(item.role, 32), finalLook: item.finalLook === true,
    url: /^(?:https?:\/\/|\/(?!\/))/.test(item.url || "") ? text(item.url, 1200) : "",
  }));
  return freeze(copy({ kind: "vr-draw-board", version: 1, boardId: state.id, boardRevision: state.revision,
    prompt: text(prompt, 48000), graph, canvas: state.canvas || { enabled: false, pose: null }, attachments: manifest,
    coordinateSystem: "XR presentation metres; original CAD units and dimensions are preserved independently." }));
}
