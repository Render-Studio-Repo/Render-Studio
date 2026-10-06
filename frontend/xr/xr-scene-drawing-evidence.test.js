import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSceneDrawingEvidence, exportSceneDrawingDocument } from './xr-scene-drawing-evidence.js';

const mesh = (id, count = 100) => ({ uuid: id, type: 'Mesh', matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1] },
  geometry: { uuid: 'shared-geometry', index: { count: 12 }, attributes: { position: { count, getX: i => i, getY: i => i * 2, getZ: () => 0 } } } });

test('scene evidence samples local mesh geometry and preserves instance transforms', () => {
  const a = mesh('a'), b = mesh('b'); b.geometry = a.geometry;
  const evidence = collectSceneDrawingEvidence([{ children: [a, b] }, a]);
  assert.equal(evidence.totalObjects, 2);
  assert.equal(evidence.totalVertices, 200);
  assert.equal(evidence.objects[0].vertices.length, 24);
  assert.deepEqual(evidence.objects[0].vertices[0], [0, 0, 0]);
  assert.deepEqual(evidence.objects[0].vertices.at(-1), [99, 198, 0]);
  assert.deepEqual(evidence.objects[0].matrixWorld.slice(12, 15), [4, 5, 6]);
  assert.equal(evidence.objects[0].omittedVertices, 76);
  assert.equal(evidence.objects[1].id, 'b');
  assert.equal(evidence.objects[0].indexCount, 12);
});

test('scene evidence reports dropped objects and stays within the byte budget', () => {
  const evidence = collectSceneDrawingEvidence(Array.from({ length: 80 }, (_, i) => mesh(String(i))), { maxBytes: 2000 });
  assert.ok(new TextEncoder().encode(JSON.stringify(evidence)).length <= 2000);
  assert.equal(evidence.totalObjects, 80);
  assert.equal(evidence.omittedObjects + evidence.objects.length, 80);
  assert.equal(evidence.omittedVertices + evidence.retainedVertices, 8000);
  assert.equal(evidence.truncated, true);
});

test('recording export retains all source vertices with separate shared-geometry instances', () => {
  const a = mesh('a', 100), b = mesh('b', 100);
  a.geometry.index = { count: 3, array: [0, 1, 99] };
  b.geometry = a.geometry;
  a.userData = { catalogFilename: 'drawing.glb' };
  const document = exportSceneDrawingDocument([a, { children: [b, a] }]);
  assert.equal(document.totalVertices, 100);
  assert.equal(document.totalInstances, 2);
  assert.equal(document.geometries.length, 1);
  assert.equal(document.geometries[0].positions.length, 300);
  assert.deepEqual(document.geometries[0].positions.slice(-3), [99, 198, 0]);
  assert.deepEqual(document.geometries[0].indices, [0, 1, 99]);
  assert.equal(document.instances[0].geometryId, document.instances[1].geometryId);
  assert.equal(document.instances[0].sourceFilename, 'drawing.glb');
  document.instances[0].matrixWorld[12] = 500;
  assert.equal(a.matrixWorld.elements[12], 4);
});

test('recording export rejects oversize or invalid geometry without partial snapshots', () => {
  assert.throws(() => exportSceneDrawingDocument([mesh('large', 200001)]), /exceeds 200000 vertices/);
  const invalid = mesh('bad', 3); invalid.geometry.index = null;
  invalid.geometry.attributes.position.getX = () => NaN;
  assert.throws(() => exportSceneDrawingDocument([invalid]), /invalid vertex coordinates/);
  const invalidIndex = mesh('bad-index', 3); invalidIndex.geometry.index = { count: 1, array: [3] };
  assert.throws(() => exportSceneDrawingDocument([invalidIndex]), /invalid vertex index/);
});
