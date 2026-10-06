/** Adapter from reviewed VR Draw documents to the existing Studio composer.
 * No generation or AI call occurs here. Call prepare only after explicit Generate.
 */
import { prepareXrImage, XR_IMAGE_BUDGET } from "./xr-image-budget.js?v=20260915-spatial-draw4";

export const XR_DRAW_PROMPT_IMAGE_BYTES = 1024 * 1024;
export const XR_DRAW_PROMPT_IMAGE_PIXELS = 2 * 1024 * 1024;
export const XR_DRAW_SPATIAL_JSON_CHARS = 64000;
const text = (value, max = 8000) => typeof value === "string" ? value.slice(0, max) : "";
const clone = (value) => JSON.parse(JSON.stringify(value));
const freeze = (value) => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const tables = ["nodes", "regions", "notes", "links", "drawings"];
const values = (value) => Array.isArray(value) ? value : Object.values(value || {});
const safeUrl = (value) => /^(?:https?:\/\/|\/(?!\/))/.test(value || "") ? text(value, 1200) : "";
const stem = (filename) => filename.split("/").pop().replace(/\.[^.]+$/, "");
const escapeReg = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function graphOf(value = {}) {
  const graph = value.graph || {};
  return { ...graph, ...Object.fromEntries(tables.map((table) => [table, values(graph[table])])) };
}
function resolveLabels(value, graph) {
  const records = new Map(tables.flatMap((table) => graph[table].map((row) => [row.id, row])));
  let result = text(value, 100000).replace(/@\{([\w.:-]+)\}/g, (token, id) => {
    const row = records.get(id); return row ? `@${row.name || row.kind || "Reference"} [${id}]` : `${token} [unavailable]`;
  });
  for (const [id, row] of records) {
    result = result.replace(new RegExp(`@[^@\\n\\[\\]]{1,160} \\[${escapeReg(id)}\\]`, "g"), `@${row.name || row.kind || "Reference"} [${id}]`);
  }
  return result;
}
function attachments(value) {
  if (Array.isArray(value)) return { images: value.filter((row) => row && !row.type && (row.media_type || row.kind === "image" || row.data_url)), references: value.filter((row) => row?.type) };
  return { images: Array.isArray(value?.images) ? value.images : [], references: Array.isArray(value?.references) ? value.references : [] };
}
function sourceKey(row) {
  const filename = row.source_filename || row.filename || row.source?.filename || "";
  return filename ? `${row.projectId || row.source?.projectId || ""}:${filename}` : safeUrl(row.url || row.source?.url);
}
function modelReference(node) {
  const source = node.source || {}, filename = text(source.filename, 500);
  return { id: `vr-board:${node.id}`, type: node.kind === "model" ? "component" : node.kind === "memo" ? "document" : "image",
    token: `@{${node.id}}`, label: text(node.name, 160), filename, source_filename: filename, stem: stem(filename),
    format: filename.split(".").pop(), viewer_filename: filename, projectId: source.projectId || "", url: safeUrl(source.url),
    ...(node.kind === "memo" ? { text_content: text(node.transcript, 8000) || "Voice memo has no transcript yet." } : {}),
    final_example: node.finalLook === true,
    description: node.finalLook ? "Final-look image selected on the VR Draw board." : undefined,
    geometry_context: { kind: "vr-draw-reference", nodeId: node.id, instanceId: node.instanceId || node.id,
      sourceRevision: source.revision || "", originalUnits: source.units || "", originalDimensions: source.dimensions || null,
      finalLook: node.finalLook === true } };
}
function regionReference(region, nodes) {
  const node = nodes.find((n) => n.id === (region.nodeId || region.anchor?.nodeId));
  const anchor = region.anchor;
  if (!node || !anchor || anchor.needsReattach) return null;
  const matrix = anchor.boardToSourceMatrix;
  const loop = (anchor.localPoints || region.points || []).map((point) => {
    if (!Array.isArray(matrix) || matrix.length !== 16) return point;
    const [x, y, z] = point, w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return point;
    return [(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
      (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
      (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w];
  });
  // Mesh triangle indices are not kernel face IDs. Keep them inside explicit
  // geometry context rather than pretending they are a CAD face_index.
  return { id: `vr-board:${region.id}`, type: region.kind === "edge" ? "edge" : region.kind === "face" ? "face" : "lasso",
    token: `@{${region.id}}`, label: region.name || "Draw region", filename: node.source.filename,
    viewer_filename: node.source.filename, projectId: node.source.projectId, local_point: anchor.sourceLocalPoint || loop[0] || null,
    loop_points: loop, surface_locked: true,
    geometry_context: { kind: "vr-draw-surface", regionId: region.id, ...clone(anchor),
      coordinateSystem: "Model-local presentation source coordinates. Triangle indices are mesh hints, not CAD face IDs." } };
}
function imageDescriptor(node) {
  const filename = text(node.source?.filename, 500), ext = filename.split(".").pop().toLowerCase();
  return { id: `vr-board-image:${node.id}`, name: text(filename.split("/").pop() || `${node.name}.jpg`, 160),
    source_filename: filename, projectId: node.source?.projectId || "", url: safeUrl(node.source?.url), data_url: "",
    media_type: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
    role: node.finalLook ? "final-example" : "reference", finalLook: node.finalLook === true };
}

export function createXrDrawPromptBridge({ getDraft = () => "", setDraft = () => {}, getAttachments = () => ({}),
  appendImage = () => false, appendReference = () => false, replaceReference, onStatus = () => {} } = {}) {
  let organizing = null;
  const status = (message) => { try { onStatus(message); } catch { /* display only */ } };
  async function appendGraph(graph) {
    const initial = attachments(getAttachments()), imageKeys = new Set(initial.images.map(sourceKey).filter(Boolean));
    const nodes = [...graph.nodes].sort((a, b) => Number(b.finalLook) - Number(a.finalLook));
    const wantedImages = nodes.filter((n) => n.kind === "image" && !imageKeys.has(sourceKey(n)));
    if (initial.images.length + new Set(wantedImages.map(sourceKey)).size > 8) throw new Error("The prompt already has too many images for these references. Remove a prompt image before organizing this board; existing attachments were kept.");
    for (const node of nodes) {
      const ref = modelReference(node), latest = attachments(getAttachments());
      const existing = latest.references.find((row) => row.id === ref.id || (sourceKey(row) && sourceKey(row) === sourceKey(ref) && row.type === ref.type));
      // The callback may merge labels/context for a stable existing board ref.
      if (!existing || (existing.id === ref.id && (existing.label !== ref.label || existing.text_content !== ref.text_content || existing.final_example !== ref.final_example))) {
        const appended = await appendReference(ref, { existing: existing || null });
        if (appended === false) throw new Error(`Could not attach ${node.name || "this reference"} to the prompt.`);
      }
      if (node.kind === "image" && !imageKeys.has(sourceKey(node))) {
        const image = imageDescriptor(node);
        if (!image.url) throw new Error(`“${node.name}” has no project image URL. Re-add the source image to the Draw board.`);
        const appended = await appendImage(image);
        if (appended === false) throw new Error(`Could not attach “${node.name}”. Existing prompt attachments were kept.`);
        imageKeys.add(sourceKey(node));
      }
    }
    for (const region of graph.regions) {
      const ref = regionReference(region, graph.nodes); if (!ref) continue;
      const existing = attachments(getAttachments()).references.find((r) => r.id === ref.id);
      if (!existing || JSON.stringify(existing.geometry_context) !== JSON.stringify(ref.geometry_context)) {
        if (await appendReference(ref, { existing: existing || null }) === false) throw new Error(`Could not attach ${region.name || "the selected region"}.`);
      }
    }
  }
  async function organize(result = {}) {
    if (organizing) return organizing;
    const graph = graphOf(result), startDraft = String(getDraft() || ""), original = String(result.originalPrompt ?? startDraft);
    status("Organizing connected references…");
    organizing = (async () => {
      await appendGraph(graph);
      const current = String(getDraft() || ""), proposed = String(result.prompt || original);
      const suffix = proposed.startsWith(original) ? proposed.slice(original.length) : `\n\n${proposed}`;
      // An edit made while a reference loads wins; append the organized block.
      const next = resolveLabels(current === startDraft ? proposed : `${current}${suffix}`, graph);
      setDraft(next);
      status("Prompt organized. Review it, then press Generate.");
      return { ok: true, prompt: next, originalPrompt: original };
    })();
    try { return await organizing; }
    catch (error) { status(error.message); throw error; }
    finally { organizing = null; }
  }
  async function prepare(snapshot = {}) {
    const graph = graphOf(snapshot), reviewed = String(snapshot.prompt ?? getDraft() ?? "");
    if (!reviewed.trim()) return { ok: false, error: "Review a prompt before generating." };
    const invalid = [...graph.regions, ...graph.drawings].find((row) => row.anchor?.needsReattach);
    if (invalid) return { ok: false, error: `Reattach “${invalid.name || "the selected surface"}” to the current model revision before generating.` };
    const unresolved = graph.notes.find((n) => n.requirements?.pending || n.requirements?.missingDetails?.length);
    if (unresolved) return { ok: false, error: `Answer the clarification for “${unresolved.name || "the split note"}” before generating: ${(unresolved.requirements.missingDetails || []).join(", ") || "printer model and joint/connector style"}.` };
    const payload = { kind: "vr-draw-board", version: 1, boardId: snapshot.boardId || graph.boardId, boardRevision: snapshot.boardRevision ?? graph.boardRevision,
      designContext: snapshot.designContext ? clone(snapshot.designContext) : null,
      coordinateSystem: snapshot.coordinateSystem || "XR presentation metres; source CAD units and dimensions are unchanged.",
      graph: clone(graph), instructions: "Annotations are planning requirements, not executed CAD edits. Use stable IDs. Preserve source units and assembly proportions. Validate mesh anchors against the source revision; mesh triangle indices are not CAD face IDs. Never invent unknown printer dimensions or connector choices." };
    const json = JSON.stringify(payload);
    if (json.length > XR_DRAW_SPATIAL_JSON_CHARS) return { ok: false, error: "The connected board is too large for one generation request. Select a smaller connected group or shorten long notes; the board remains saved." };
    const marker = `\n\n[VR DRAW SPATIAL SNAPSHOT ${payload.boardId} ${payload.boardRevision}]\n`;
    const prompt = `${resolveLabels(reviewed, graph)}${reviewed.includes(marker) ? "" : `${marker}${json}\n[END VR DRAW SPATIAL SNAPSHOT]`}`;
    if (prompt.length > 98000) return { ok: false, error: "This prompt and its spatial snapshot exceed the generation size limit. Shorten the prompt or select fewer connected references." };
    const startingDraft = String(getDraft() || "");
    try {
      await appendGraph(clone(payload.graph));
      if (String(getDraft() || "") !== startingDraft) return { ok: false, error: "The prompt changed while references were attaching. Review the updated draft and press Generate again." };
      const spatialReference = { id: `vr-board-snapshot:${payload.boardId}`, type: "document", token: "@VR-Draw-spatial-instructions",
        label: "VR Draw spatial instructions", filename: "vr-draw-spatial-instructions.json", format: "json", text_content: json,
        geometry_context: { boardId: payload.boardId, boardRevision: payload.boardRevision, immutable: true } };
      const existing = attachments(getAttachments()).references.find((r) => r.id === spatialReference.id);
      if (await appendReference(spatialReference, { existing: existing || null }) === false) throw new Error("Could not attach the reviewed spatial instructions.");
      // Build the submitted descriptors from the detached graph, never from the
      // live composer: name/surface sync can run while attachments are loading.
      const references = [...payload.graph.nodes.map(modelReference),
        ...payload.graph.regions.map(region => regionReference(region, payload.graph.nodes)).filter(Boolean),
        clone(spatialReference)];
      return freeze({ ok: true, prompt, reviewedDraft: reviewed, snapshot: clone(payload), spatialReference: clone(spatialReference), references });
    } catch (error) { status(error.message); return { ok: false, error: error.message }; }
  }
  function syncNames(state) {
    const graph = graphOf({ graph: state }), records = new Map(tables.flatMap((table) => graph[table].map((row) => [row.id, { row, table }])));
    let changed = 0;
    for (const existing of attachments(getAttachments()).references) {
      if (!String(existing.id).startsWith("vr-board:")) continue;
      const found = records.get(existing.id.slice("vr-board:".length));
      if (!found) continue;
      const { row, table } = found;
      const updated = table === "nodes" ? modelReference(row) : table === "regions" ? regionReference(row, graph.nodes)
        : { ...existing, label: row.name || row.caption || row.text?.slice(0, 80) || existing.label,
          ...(row.text || row.caption ? { text_content: row.text || row.caption } : {}) };
      if (!updated || (existing.label === updated.label && existing.text_content === updated.text_content
        && existing.final_example === updated.final_example && JSON.stringify(existing.geometry_context) === JSON.stringify(updated.geometry_context))) continue;
      const replace = replaceReference || ((ref) => appendReference(ref, { existing, renameOnly: true }));
      replace({ ...existing, ...updated }, existing);
      changed += 1;
    }
    return changed;
  }
  return { organize, prepare, syncNames };
}

/** Only small project images are read in VR. No remote URL receives an auth token. */
export async function readDrawPromptImage(image, { fetchFile, normalizeImage = async (data_url, media_type) => ({ data_url, media_type }) } = {}) {
  const url = String(image?.url || "");
  if (!/^\/api\/projects\/[^/]+\/files\//.test(url)) throw new Error("Use an image saved in this project for the VR Draw prompt.");
  const response = await fetchFile(url, { redirect: "error" });
  if (!response?.ok) throw new Error(`Could not read “${image.name}” from the project.`);
  const advertised = Number(response.headers?.get?.("content-length")) || 0;
  const tooLarge = () => new Error(`“${image.name}” is held off in VR to protect performance. Use a PNG, JPEG or WebP under 1 MB and 2 megapixels.`);
  if (advertised > XR_DRAW_PROMPT_IMAGE_BYTES) { await response.body?.cancel?.(); throw tooLarge(); }
  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength; if (length > XR_DRAW_PROMPT_IMAGE_BYTES) { await reader.cancel(); throw tooLarge(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  } else {
    if (!advertised || advertised > XR_DRAW_PROMPT_IMAGE_BYTES) throw tooLarge();
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (!bytes.length || bytes.length > XR_DRAW_PROMPT_IMAGE_BYTES) throw tooLarge();
  const size = await prepareXrImage(new Blob([bytes]), { ...XR_IMAGE_BUDGET, bytes: XR_DRAW_PROMPT_IMAGE_BYTES, pixels: XR_DRAW_PROMPT_IMAGE_PIXELS });
  let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const normalized = await normalizeImage(`data:${size.mimeType};base64,${btoa(binary)}`, size.mimeType);
  return { ...image, ...normalized };
}
