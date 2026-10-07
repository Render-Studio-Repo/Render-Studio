const INDEX_VERSION = 1;
const STORAGE_PREFIX = "render3d:hey-ai-context-index:v1:";
const SESSION_LIMIT = 8;

function text(value, limit = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function storageKey(projectId) {
  return `${STORAGE_PREFIX}${String(projectId || "pending")}`;
}

function referencePath(row = {}) {
  return text(row.source_filename || row.filename || row.name || row.viewer_filename, 500);
}

function referenceId(row = {}, index = 0) {
  return text(row.id || row.token || referencePath(row) || `reference-${index + 1}`, 500);
}

function compactMachine(machine) {
  if (!machine) return null;
  const specs = machine.specs || {};
  return {
    id: text(machine.id || machine.catalog_id, 120),
    name: text(machine.name || `${machine.brand || ""} ${machine.model || ""}`, 160),
    kind: text(machine.kind || specs.kind, 80),
    brand: text(machine.brand || specs.brand, 100),
    model: text(machine.model || specs.model, 120),
    volume_mm: machine.volume_mm || specs.volume_mm || null,
    bed_mm: machine.bed_mm || specs.bed_mm || null,
    nozzle_mm: machine.nozzle_mm ?? specs.nozzle_mm ?? null,
    kerf_mm: machine.kerf_mm ?? specs.kerf_mm ?? null,
    notes: text(machine.notes || specs.notes, 500),
  };
}

export function compactPromptHistory(entries = [], limit = 12) {
  return [...(entries || [])]
    .filter((row) => row && (row.prompt || row.original_prompt || row.filename))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, limit)
    .map((row) => ({
      id: text(row.id || row.prompt_id, 120),
      at: row.created_at || null,
      request: text(row.original_prompt || row.prompt, 320),
      result: text(row.message || row.summary || row.error, 220),
      output: text(row.filename, 300),
      status: text(row.status || (row.success ? "complete" : ""), 40),
      model: text(row.model, 100),
    }));
}

export function compactReferenceIndex(references = [], attached = []) {
  const attachedIds = new Set((attached || []).flatMap((row) => [row?.id, row?.token, referencePath(row)]).filter(Boolean).map(String));
  const seen = new Set();
  return (references || []).map((row, index) => {
    const path = referencePath(row);
    const id = referenceId(row, index);
    const key = path || id;
    if (!key || seen.has(key)) return null;
    seen.add(key);
    return {
      id,
      token: text(row.token, 120),
      label: text(row.label || row.name || row.filename || path, 180),
      path,
      type: text(row.type || row.kind || row.format, 60),
      attached: attachedIds.has(String(row.id)) || attachedIds.has(String(row.token)) || attachedIds.has(path),
      content_loaded: Boolean(row.text_content),
      ...(row.text_content && attachedIds.has(String(row.id)) ? { excerpt: text(row.text_content, 1200) } : {}),
    };
  }).filter(Boolean).slice(0, 80);
}

export function readHeyAiContextIndex(projectId, storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem?.(storageKey(projectId)) || "null");
    return value?.version === INDEX_VERSION ? value : null;
  } catch {
    return null;
  }
}

export function persistHeyAiContextIndex(index, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(storageKey(index?.project_id), JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

export function rememberHeyAiSessionSummary(projectId, session = {}, storage = globalThis.localStorage) {
  const previous = readHeyAiContextIndex(projectId, storage) || { version: INDEX_VERSION, project_id: projectId };
  const note = {
    id: text(session.id, 160),
    at: session.endedAt ? new Date(session.endedAt).toISOString() : new Date().toISOString(),
    summary: text(session.summary, 600),
    file: text(session.filename, 300),
  };
  const voice_notes = [note, ...(previous.voice_notes || []).filter((row) => row.id !== note.id)].slice(0, SESSION_LIMIT);
  const next = { ...previous, voice_notes, updated_at: new Date().toISOString() };
  persistHeyAiContextIndex(next, storage);
  return next;
}

export function buildHeyAiContextIndex({ projectId, machine, references = [], attachedReferences = [], promptHistory = [], builds = [], previous } = {}) {
  const index = {
    version: INDEX_VERSION,
    project_id: projectId || null,
    updated_at: new Date().toISOString(),
    active_machine: compactMachine(machine),
    references: compactReferenceIndex(references, attachedReferences),
    prompt_history: compactPromptHistory(promptHistory),
    recent_builds: (builds || []).map((row) => ({
      name: text(row.name || row.filename || row.viewer_filename, 220),
      kind: text(row.kind || row.type || row.format, 60),
    })).filter((row) => row.name).slice(0, 24),
    voice_notes: (previous?.voice_notes || []).slice(0, SESSION_LIMIT),
    usage: "Reference entries are metadata only. Read full text only through read_indexed_reference when it is relevant to the user's request.",
  };
  persistHeyAiContextIndex(index);
  return index;
}

export function resolveIndexedReference(index, requestedId) {
  const wanted = String(requestedId || "").trim();
  if (!wanted) return null;
  return (index?.references || []).find((row) => [row.id, row.token, row.path, row.label].some((value) => String(value || "") === wanted)) || null;
}
