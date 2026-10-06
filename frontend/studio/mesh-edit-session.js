const MUTATING_OPERATIONS = new Set([
  "cleanup",
  "press-pull",
  "mirror",
  "fillet",
  "chamfer",
]);

function text(value) {
  return String(value ?? "").trim();
}

function operationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * @typedef {Object} MeshArtifactIdentity
 * @property {string} projectId
 * @property {string} catalogTarget
 * @property {string|null} viewerFilename
 * @property {string|null} artifactHash
 * @property {string|null} revision
 * @property {string|null} parentRevision
 */

/** @returns {MeshArtifactIdentity} */
export function normalizeMeshArtifactIdentity(raw = {}) {
  return Object.freeze({
    projectId: text(raw.projectId || raw.project_id),
    catalogTarget: text(raw.catalogTarget || raw.filename || raw.catalog_name),
    viewerFilename: text(raw.viewerFilename || raw.viewer_filename) || null,
    artifactHash: text(raw.artifactHash || raw.artifact_hash || raw.sha256) || null,
    revision: text(raw.revision || raw.artifact_revision || raw.version) || null,
    parentRevision: text(raw.parentRevision || raw.parent_revision) || null,
  });
}

export function meshArtifactIdentityFromFiles(projectId, catalogTarget, files = [], viewerFilename = null) {
  const target = text(catalogTarget);
  const viewer = text(viewerFilename);
  const rows = files || [];
  const row = (viewer ? rows.find((file) => text(file?.name || file?.filename) === viewer) : null)
    || rows.find((file) => {
    const name = text(file?.name || file?.filename);
    return name === target || text(file?.viewer_filename) === target;
  });
  return normalizeMeshArtifactIdentity({
    projectId,
    catalogTarget: target,
    viewerFilename: viewer || row?.viewer_filename || null,
    artifactHash: row?.sha256 || row?.artifact_hash || row?.hash || null,
    revision: row?.version || row?.revision || row?.mtime || null,
  });
}

export function meshArtifactKey(identity) {
  const value = normalizeMeshArtifactIdentity(identity);
  return [value.projectId, value.catalogTarget, value.artifactHash || value.revision || "unversioned"].join("::");
}

export function meshReferenceMatchesTarget(reference, target, { requireRevision = true } = {}) {
  const ref = reference || {};
  const expected = normalizeMeshArtifactIdentity(target);
  const refProject = text(ref.projectId || ref.project_id);
  const refFilename = text(ref.filename || ref.viewer_filename || ref.catalogTarget);
  const refHash = text(ref.artifact_hash || ref.artifactHash);
  const refRevision = text(ref.artifact_revision || ref.revision || ref.version);
  if (!expected.projectId || !expected.catalogTarget) return false;
  if (refProject && refProject !== expected.projectId) return false;
  if (refFilename !== expected.catalogTarget && refFilename !== expected.viewerFilename) return false;
  if (expected.artifactHash && refHash !== expected.artifactHash) return false;
  if (expected.revision && refRevision !== expected.revision) return false;
  if (requireRevision && (expected.artifactHash || expected.revision) && !refHash && !refRevision) return false;
  return true;
}

export function scopeMeshReferences(references, target, options) {
  return (references || []).filter((reference) => meshReferenceMatchesTarget(reference, target, options));
}

/**
 * One revision-aware coordinator for viewport mesh edits and paid Mesh generation.
 * Async callers retain a ticket and must prove it is current before applying a result.
 */
export function createMeshEditSession({ getTarget = () => ({}), makeRequestId = null } = {}) {
  let serial = 0;
  let switchEpoch = 0;
  let state = Object.freeze({
    phase: "idle",
    projectId: "",
    catalogTarget: "",
    viewerFilename: null,
    artifactHash: null,
    revision: null,
    parentRevision: null,
    requestId: null,
    operation: null,
  });
  const paidGenerationByProject = new Map();

  const nextRequestId = () => {
    if (typeof makeRequestId === "function") return text(makeRequestId());
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    serial += 1;
    return `mesh-edit-${Date.now().toString(36)}-${serial.toString(36)}`;
  };

  const targetNow = (override = null) => normalizeMeshArtifactIdentity(override || getTarget?.() || {});

  function snapshot() {
    return state;
  }

  function syncTarget(raw = null) {
    if (state.phase === "switching") return state;
    const target = targetNow(raw);
    state = Object.freeze({
      ...state,
      projectId: target.projectId,
      catalogTarget: target.catalogTarget,
      viewerFilename: target.viewerFilename,
      artifactHash: target.artifactHash,
      revision: target.revision,
      parentRevision: target.parentRevision,
    });
    return state;
  }

  function beginProjectSwitch(projectId) {
    switchEpoch += 1;
    state = Object.freeze({
      phase: "switching",
      projectId: text(projectId),
      catalogTarget: "",
      viewerFilename: null,
      artifactHash: null,
      revision: null,
      parentRevision: null,
      requestId: null,
      operation: "project-switch",
    });
    return switchEpoch;
  }

  function completeProjectSwitch(epoch, raw = null) {
    const target = targetNow(raw);
    if (epoch !== switchEpoch || target.projectId !== state.projectId) return false;
    state = Object.freeze({
      phase: "idle",
      projectId: target.projectId,
      catalogTarget: target.catalogTarget,
      viewerFilename: target.viewerFilename,
      artifactHash: target.artifactHash,
      revision: target.revision,
      parentRevision: target.parentRevision,
      requestId: null,
      operation: null,
    });
    return true;
  }

  function begin(operation, raw = null) {
    if (state.phase === "switching") {
      throw operationError("Project is still loading. Wait for the model to finish opening.", "mesh_project_switching");
    }
    if (state.phase === "operating") {
      throw operationError("Another mesh edit is already running.", "mesh_edit_busy");
    }
    const target = targetNow(raw);
    if (!target.projectId || !target.catalogTarget) {
      throw operationError("Select a model file first.", "mesh_target_missing");
    }
    const requestId = nextRequestId();
    const ticket = Object.freeze({
      ...target,
      requestId,
      operation: text(operation) || "edit",
      switchEpoch,
    });
    state = Object.freeze({
      phase: "operating",
      ...target,
      parentRevision: target.revision,
      requestId,
      operation: ticket.operation,
    });
    return ticket;
  }

  function isCurrent(ticket, raw = null) {
    if (!ticket || ticket.switchEpoch !== switchEpoch || ticket.requestId !== state.requestId) return false;
    const target = targetNow(raw);
    return target.projectId === ticket.projectId && target.catalogTarget === ticket.catalogTarget
      && (!ticket.artifactHash || target.artifactHash === ticket.artifactHash)
      && (!ticket.revision || target.revision === ticket.revision);
  }

  function assertCurrent(ticket, raw = null) {
    if (!isCurrent(ticket, raw)) {
      throw operationError("The project or model changed while this edit was running. Review the current model and try again.", "mesh_edit_stale");
    }
    return true;
  }

  function finish(ticket, { nextTarget = null } = {}) {
    if (!ticket || ticket.requestId !== state.requestId) return false;
    const target = normalizeMeshArtifactIdentity(nextTarget || {
      projectId: ticket.projectId,
      catalogTarget: ticket.catalogTarget,
      viewerFilename: ticket.viewerFilename,
      artifactHash: ticket.artifactHash,
      revision: ticket.revision,
      parentRevision: ticket.parentRevision,
    });
    state = Object.freeze({
      phase: "idle",
      ...target,
      requestId: null,
      operation: null,
    });
    return true;
  }

  function acceptMutation(ticket, response = {}) {
    assertCurrent(ticket);
    if (MUTATING_OPERATIONS.has(ticket.operation) && !Number.isInteger(Number(response.timeline_index))) {
      throw operationError("The server did not register this edit in model history. Reload before editing again.", "mesh_history_missing");
    }
    const filename = text(response.filename);
    if (!filename) {
      throw operationError("The server returned no edited model file.", "mesh_result_missing");
    }
    const serverParent = text(response.parent || response.replace_catalog || response.replaceCatalog);
    if (serverParent && serverParent !== ticket.catalogTarget && serverParent !== ticket.viewerFilename) {
      throw operationError("The server edited a different model than the selected target. Reload before editing again.", "mesh_parent_mismatch");
    }
    const accepted = normalizeMeshArtifactIdentity({
      projectId: ticket.projectId,
      catalogTarget: filename,
      viewerFilename: response.viewer_filename || filename,
      artifactHash: response.artifact_hash || response.sha256 || null,
      revision: response.artifact_revision || response.version || null,
      parentRevision: ticket.revision,
    });
    finish(ticket, { nextTarget: accepted });
    return Object.freeze({
      ...response,
      request_id: ticket.requestId,
      parent_revision: ticket.revision,
      artifact_identity: accepted,
    });
  }

  function beginPaidGeneration(raw = null) {
    const target = targetNow(raw);
    if (!target.projectId) throw operationError("Open a project before generating Mesh.", "mesh_project_missing");
    const active = paidGenerationByProject.get(target.projectId);
    if (active) throw operationError("Mesh generation is already starting or running for this project.", "mesh_generation_busy");
    const ticket = Object.freeze({
      ...target,
      requestId: nextRequestId(),
      operation: "mesh-generate",
      switchEpoch,
    });
    paidGenerationByProject.set(target.projectId, ticket);
    return ticket;
  }

  function markPaidGenerationAccepted(ticket, traceId = null) {
    const active = paidGenerationByProject.get(ticket?.projectId);
    if (!active || active.requestId !== ticket.requestId) return false;
    paidGenerationByProject.set(ticket.projectId, Object.freeze({ ...active, traceId: text(traceId) || null }));
    return true;
  }

  function releasePaidGeneration(projectId, requestId = null) {
    const pid = text(projectId);
    const active = paidGenerationByProject.get(pid);
    if (!active || (requestId && active.requestId !== requestId)) return false;
    paidGenerationByProject.delete(pid);
    return true;
  }

  function reconcilePaidGeneration(projectId, generation) {
    const pid = text(projectId);
    const active = paidGenerationByProject.get(pid);
    if (!active) return false;
    const jobs = Array.isArray(generation?.jobs) ? generation.jobs : [];
    const running = generation?.status === "running" || jobs.some((job) => ["queued", "pending", "running"].includes(text(job?.status).toLowerCase()));
    if (!running && active.traceId) paidGenerationByProject.delete(pid);
    return running;
  }

  return Object.freeze({
    snapshot,
    syncTarget,
    beginProjectSwitch,
    completeProjectSwitch,
    begin,
    isCurrent,
    assertCurrent,
    finish,
    acceptMutation,
    beginPaidGeneration,
    markPaidGenerationAccepted,
    releasePaidGeneration,
    reconcilePaidGeneration,
    isPaidGenerationActive: (projectId) => paidGenerationByProject.has(text(projectId)),
    scopeReferences: (references, target = null, options = null) => scopeMeshReferences(references, targetNow(target), options || undefined),
    referenceMatchesTarget: (reference, target = null, options = null) => meshReferenceMatchesTarget(reference, targetNow(target), options || undefined),
  });
}
