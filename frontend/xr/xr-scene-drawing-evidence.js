const byteSize = value => new TextEncoder().encode(JSON.stringify(value)).length;
const finiteVector = value => value && [value.x, value.y, value.z].every(Number.isFinite) ? [value.x, value.y, value.z] : null;

/** Reads geometry only when voice context is requested; samples do not replace source meshes. */
export function collectSceneDrawingEvidence(objects = [], { maxBytes = 10000 } = {}) {
  if (!Number.isFinite(maxBytes) || maxBytes < 1024) throw new RangeError('Scene evidence needs at least 1024 bytes.');
  const seen = new Set(), meshes = [];
  const visit = object => {
    if (!object || seen.has(object)) return;
    seen.add(object);
    const position = object.geometry?.getAttribute?.('position') || object.geometry?.attributes?.position;
    if (position?.count > 0) meshes.push({ object, position });
    for (const child of object.children || []) visit(child);
  };
  for (const object of objects || []) visit(object);
  let totalVertices = 0;
  const result = { coordinateSystem: 'Mesh-local vertices with matrixWorld to transform into scene metres.',
    totalObjects: meshes.length, omittedObjects: 0, totalVertices: 0, retainedVertices: 0, omittedVertices: 0,
    truncated: false, objects: [] };
  for (const { object, position } of meshes) {
    const count = Math.max(0, Math.floor(position.count));
    totalVertices += count;
    if (result.objects.length >= 24) continue;
    const vertices = [], sampledIndices = [];
    let invalidSamples = 0;
    const samples = Math.min(count, 24);
    for (let i = 0; i < samples; i++) {
      const index = samples === 1 ? 0 : Math.round(i * (count - 1) / (samples - 1));
      const point = typeof position.getX === 'function' ? [position.getX(index), position.getY(index), position.getZ(index)]
        : [position.array?.[index * position.itemSize], position.array?.[index * position.itemSize + 1], position.array?.[index * position.itemSize + 2]];
      if (point.every(Number.isFinite)) { vertices.push(point); sampledIndices.push(index); } else invalidSamples++;
    }
    const matrix = Array.from(object.matrixWorld?.elements || []);
    const geometry = object.geometry;
    result.objects.push({ id: String(object.uuid || object.id || '').slice(0, 160), name: String(object.name || '').slice(0, 160),
      type: String(object.type || '').slice(0, 60), geometryId: String(geometry.uuid || geometry.id || '').slice(0, 160),
      vertexCount: count, indexCount: geometry.index?.count || 0, vertices, sampledIndices, invalidSamples,
      omittedVertices: count - vertices.length,
      matrixWorld: matrix.length === 16 && matrix.every(Number.isFinite) ? matrix : null,
      bounds: geometry.boundingBox ? { min: finiteVector(geometry.boundingBox.min), max: finiteVector(geometry.boundingBox.max) } : null });
  }
  function coverage() {
    result.totalVertices = totalVertices;
    result.retainedVertices = result.objects.reduce((sum, row) => sum + row.vertices.length, 0);
    result.omittedVertices = totalVertices - result.retainedVertices;
    result.omittedObjects = meshes.length - result.objects.length;
    result.truncated = result.omittedObjects > 0 || result.omittedVertices > 0;
  }
  coverage();
  while (byteSize(result) > maxBytes && result.objects.length) { result.objects.pop(); coverage(); }
  return result;
}

/** Complete source geometry for an explicit recording/save boundary. Oversize input fails atomically. */
export function exportSceneDrawingDocument(objects = [], { maxVertices = 200000 } = {}) {
  if (!Number.isSafeInteger(maxVertices) || maxVertices < 1) throw new RangeError('A positive vertex limit is required.');
  const seen = new Set(), meshes = [], unique = new Map();
  let totalVertices = 0;
  const visit = object => {
    if (!object || seen.has(object)) return;
    seen.add(object);
    const geometry = object.geometry;
    const position = geometry?.getAttribute?.('position') || geometry?.attributes?.position;
    if (position?.count > 0) {
      if (!Number.isSafeInteger(position.count)) throw new Error('Drawing geometry has an invalid vertex count.');
      if (!unique.has(geometry)) {
        totalVertices += position.count;
        if (totalVertices > maxVertices) throw new Error(`Drawing document exceeds ${maxVertices} vertices. Simplify the drawings before recording; no partial document was saved.`);
        unique.set(geometry, { position, id: `geometry-${unique.size + 1}`, sourceId: String(geometry.uuid || geometry.id || '') });
      }
      meshes.push(object);
    }
    for (const child of object.children || []) visit(child);
  };
  for (const object of objects || []) visit(object);
  const geometries = [];
  let totalIndices = 0;
  for (const [geometry, { position, id, sourceId }] of unique) {
    const positions = [];
    for (let i = 0; i < position.count; i++) {
      const point = typeof position.getX === 'function' ? [position.getX(i), position.getY(i), position.getZ(i)]
        : [position.array?.[i * position.itemSize], position.array?.[i * position.itemSize + 1], position.array?.[i * position.itemSize + 2]];
      if (!point.every(Number.isFinite)) throw new Error(`Drawing ${id} contains invalid vertex coordinates. No partial document was saved.`);
      positions.push(...point);
    }
    const index = geometry.getIndex?.() || geometry.index;
    const indices = [];
    if (index) {
      totalIndices += index.count;
      if (!Number.isSafeInteger(index.count) || index.count < 0 || totalIndices > maxVertices * 12) throw new Error('Drawing index data exceeds the document limit. No partial document was saved.');
      for (let i = 0; i < index.count; i++) {
        const value = typeof index.getX === 'function' ? index.getX(i) : index.array?.[i];
        if (!Number.isSafeInteger(value) || value < 0 || value >= position.count) throw new Error(`Drawing ${id} has an invalid vertex index. No partial document was saved.`);
        indices.push(value);
      }
    }
    geometries.push({ id, sourceId, vertexCount: position.count, positions, indices,
      drawRange: { start: geometry.drawRange?.start || 0, count: Number.isFinite(geometry.drawRange?.count) ? geometry.drawRange.count : (index?.count ?? position.count) } });
  }
  const instances = meshes.map((object, index) => {
    const matrixWorld = Array.from(object.matrixWorld?.elements || []);
    if (matrixWorld.length !== 16 || !matrixWorld.every(Number.isFinite)) throw new Error('Drawing transform is unavailable. Update the scene before recording.');
    let instanceMatrices = null;
    if (object.isInstancedMesh) {
      const count = object.count;
      if (!Number.isSafeInteger(count) || count < 0 || count > maxVertices) throw new Error('Drawing instance count exceeds the document limit.');
      instanceMatrices = Array.from(object.instanceMatrix?.array || []).slice(0, count * 16);
      if (instanceMatrices.length !== count * 16 || !instanceMatrices.every(Number.isFinite)) throw new Error('Drawing instance transforms are unavailable.');
    }
    return { id: String(object.uuid || object.id || `instance-${index + 1}`), name: String(object.name || ''),
      type: String(object.type || ''), geometryId: unique.get(object.geometry).id, matrixWorld,
      ...(instanceMatrices ? { instanceCount: object.count, instanceMatrices } : {}),
      sourceFilename: String(object.userData?.filename || object.userData?.catalogFilename || object.userData?.sourceFilename || '') };
  });
  return { kind: 'render-studio-scene-drawings', version: 1,
    coordinateSystem: 'Complete mesh-local positions; apply each instance matrixWorld for scene metres.',
    totalVertices, totalInstances: instances.length, geometries, instances };
}
