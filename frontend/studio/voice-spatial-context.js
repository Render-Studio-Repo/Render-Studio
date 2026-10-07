const REFERENCE_LIMIT = 16;
const POINT_LIMIT = 40;
const INDEX_LIMIT = 40;

function finiteVector(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const vector = value.slice(0, 3).map(Number);
  if (!vector.every(Number.isFinite)) return null;
  return vector.map((part) => Number(part.toFixed(5)));
}

function boundedVectors(value, toWorldPoint) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, POINT_LIMIT).map((point) => finiteVector(toWorldPoint?.(point) || point)).filter(Boolean);
}

function boundedIndices(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, INDEX_LIMIT).map(Number).filter(Number.isInteger);
}

function spatialReference(ref, selectedFile, toWorldPoint, toWorldModelPoint, toWorldNormal) {
  const kind = String(ref?.type || "reference");
  const localPosition = finiteVector(ref?.local_point);
  const modelPosition = finiteVector(ref?.position);
  const worldPosition = finiteVector(
    ref?.world_position
      || (localPosition && toWorldPoint?.(localPosition))
      || (modelPosition && toWorldModelPoint?.(modelPosition))
      || modelPosition
  );
  const localPoints = Array.isArray(ref?.local_loop_points) ? ref.local_loop_points : null;
  const modelPoints = ref?.loop_points || ref?.selected_vertices || [];
  const worldPoints = boundedVectors(localPoints || modelPoints, localPoints ? toWorldPoint : toWorldModelPoint);
  const edgeWorld = boundedVectors([ref?.edge_start, ref?.edge_end], toWorldModelPoint);
  return {
    id: String(ref?.id || ref?.token || ""),
    kind,
    object_id: ref?.mesh_uuid ?? ref?.object_id ?? ref?.body_index ?? null,
    file_id: ref?.filename || ref?.source_filename || selectedFile || null,
    world_position: worldPosition,
    world_points: worldPoints.length ? worldPoints : edgeWorld,
    normal: finiteVector(toWorldNormal?.(ref?.normal) || ref?.normal),
    face_indices: boundedIndices(ref?.face_indices ?? (ref?.face_index != null ? [ref.face_index] : [])),
    edge_index: Number.isInteger(ref?.kernel_edge_index) ? ref.kernel_edge_index : null,
    vertex_index: Number.isInteger(ref?.kernel_vertex_index) ? ref.kernel_vertex_index : null,
  };
}

export function voiceSpatialSelection({ pointer = null, references = [], selection = null, selectedFile = null, toWorldPoint = null, toWorldModelPoint = null, toWorldNormal = null } = {}) {
  const pointerWorld = finiteVector(pointer?.world);
  const selectedObject = selection || null;
  return {
    pointer: pointerWorld ? {
      kind: String(pointer?.kind || "hover"),
      world: pointerWorld,
      object_id: pointer?.object || selectedObject?.catalogName || selectedObject?.label || null,
      file_id: selectedFile || null,
    } : null,
    selected_object: selectedObject ? {
      object_id: selectedObject.catalogName || selectedObject.label || selectedObject.mesh?.uuid || null,
      file_id: selectedObject.catalogName || selectedFile || null,
      kind: "object",
    } : null,
    references: (Array.isArray(references) ? references : [])
      .filter((ref) => ["face", "edge", "corner", "vertex", "lasso", "path"].includes(ref?.type))
      .slice(-REFERENCE_LIMIT)
      .map((ref) => spatialReference(ref, selectedFile, toWorldPoint, toWorldModelPoint, toWorldNormal)),
  };
}
