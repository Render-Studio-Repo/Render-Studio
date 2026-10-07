import { meshReferenceMatchesTarget, normalizeMeshArtifactIdentity } from "./mesh-edit-session.js?v=20260930-mesh-session1";

export const GEOMETRY_REFERENCE_TYPES = new Set(["component", "face", "edge", "vertex", "corner", "lasso", "path", "line"]);

export function latestEditableTarget(entries = [], files = []) {
  const date = (v) => Number.isFinite(Number(v)) ? Number(v) : (Date.parse(v) || 0) / 1000;
  const times = new Map(files.map((f) => [f.name || f.filename, date(f.created_at || f.mtime)]));
  return entries.map((entry, index) => ({ entry, index,
    time: date(entry.created_at || entry.mtime) || times.get(entry.name) || times.get(entry.viewer_filename) || 0,
  })).sort((a, b) => b.time - a.time || a.index - b.index)[0]?.entry || null;
}

export function mergePromptGeometryReferences(refs = [], additions = []) {
  const out = [...refs];
  const ids = new Set(refs.map((r) => r.id));
  for (const ref of additions) {
    if (!ref || ids.has(ref.id)) continue;
    ids.add(ref.id);
    out.push(ref);
  }
  return out;
}

export function selectedGeometryPromptReferences(selection, projectId, geometryContext = null) {
  if (!selection) return [];
  const items = selection.selections?.length > 1 ? selection.selections : [selection];
  return items.flatMap((item) => {
    const filename = item.catalogName || item.root?.userData?.catalogFilename || item.mesh?.userData?.catalogFilename;
    if (!filename) return [];
    const whole = item.wholeModel || item.isRoot;
    const face = Number.isInteger(item.faceIndex) ? item.faceIndex : null;
    const body = !whole && Number.isInteger(item.bodyIndex) ? item.bodyIndex : null;
    const suffix = face !== null ? `face-${face}` : body !== null ? `body-${body}` : "object";
    const identity = normalizeMeshArtifactIdentity({
      projectId,
      catalogTarget: filename,
      viewerFilename: item.root?.userData?.viewerFilename || item.mesh?.userData?.viewerFilename || filename,
      artifactHash: item.root?.userData?.artifactHash || item.mesh?.userData?.artifactHash || null,
      revision: item.root?.userData?.artifactRevision || item.mesh?.userData?.artifactRevision || null,
    });
    const ref = { id: `selected:${projectId || "project"}:${filename}:${suffix}`,
      type: face !== null ? "face" : "component", filename, viewer_filename: identity.viewerFilename || filename, projectId,
      label: item.label || `${filename} ${suffix}`, token: `@${`${filename}-${suffix}`.replace(/[^a-zA-Z0-9_-]+/g, "-")}` };
    if (identity.artifactHash) ref.artifact_hash = identity.artifactHash;
    if (identity.revision) ref.artifact_revision = identity.revision;
    if (face !== null) ref.face_index = face;
    if (item.mesh && item.root) {
      const path = []; let current = item.mesh;
      while (current && current !== item.root) {
        const index = current.parent?.children.indexOf(current);
        if (!Number.isInteger(index) || index < 0) break;
        path.unshift(index); current = current.parent;
      }
      if (current === item.root) ref.mesh_path = path;
    }
    if (body !== null) { ref.body_index = body; ref.body_name = item.label; }
    const context = geometryContext?.(item);
    if (context) ref.geometry_context = context;
    return [ref];
  });
}

// Only restore paths captured from the same model revision. Callers validate
// that revision on the server before passing Parts List mounting references.
export function restoreGeometrySelections(root, filename, references = [], targetIdentity = null) {
  if (!root) return [];
  return references.flatMap(ref => {
    if (ref.filename !== filename || !Array.isArray(ref.mesh_path) || !Number.isInteger(ref.face_index)) return [];
    if (targetIdentity && !meshReferenceMatchesTarget(ref, targetIdentity, { requireRevision: true })) return [];
    let mesh = root;
    for (const index of ref.mesh_path) {
      if (!Number.isInteger(index) || index < 0) return [];
      mesh = mesh?.children?.[index];
    }
    if (!mesh?.isMesh || !mesh.geometry) return [];
    const count = (mesh.geometry.index?.count ?? mesh.geometry.attributes?.position?.count ?? 0) / 3;
    if (ref.face_index < 0 || ref.face_index >= count) return [];
    return [{mesh, root, catalogName:filename, faceIndex:ref.face_index, bodyIndex:ref.body_index, label:ref.label}];
  });
}
