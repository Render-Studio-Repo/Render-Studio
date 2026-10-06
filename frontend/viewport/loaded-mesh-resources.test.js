import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareLoadedMeshResources, ownMeshMaterials, loadedGeometryBounds } from './loaded-mesh-resources.js';

const material = () => ({ opacity: 1, emissive: 'black', clone() { return {...this}; } });
const geometry = () => ({ position: [0, 1, 2], clone() { return {...this, position: [...this.position]}; } });
const root = (meshes) => ({traverse(fn) { meshes.forEach(fn); }});
const mesh = (mat = material(), geo = geometry()) => ({isMesh: true, material: mat, geometry: geo});

test('thousands of fresh CAD faces retain one shared material and their own buffers', () => {
  const shared = material();
  shared.clone = () => { throw Error('no eager material copies'); };
  const faces = Array.from({length: 5447}, () => mesh(shared));
  const buffers = faces.map(m => m.geometry);
  prepareLoadedMeshResources(root(faces));
  assert.equal(new Set(faces.map(m => m.material)).size, 1);
  assert.ok(faces.every((m, i) => m.geometry === buffers[i]));
});

test('tinting or transparency of one face cannot change another face', () => {
  const shared = material(), a = mesh(shared), b = mesh(shared);
  prepareLoadedMeshResources(root([a,b]));
  ownMeshMaterials(a);
  a.material.opacity = .58;
  a.material.emissive = 'blue';
  assert.equal(b.material.opacity, 1);
  assert.equal(b.material.emissive, 'black');
  const owned = a.material;
  ownMeshMaterials(a);
  assert.equal(a.material, owned, 'repeat interaction does not clone again');
});

test('material arrays retain aliases inside a face and isolate sibling faces', () => {
  const shared = material(), unique = material();
  const a = mesh([shared, shared, unique]), b = mesh(shared);
  prepareLoadedMeshResources(root([a,b]));
  ownMeshMaterials(a);
  assert.equal(a.material[0], a.material[1]);
  assert.equal(a.material[2], unique);
  assert.notEqual(a.material[0], b.material);
});

test('geometry aliases are detached for independent edits, unique geometry is retained', () => {
  const shared = geometry(), a = mesh(material(), shared), b = mesh(material(), shared), c = mesh();
  const unique = c.geometry;
  prepareLoadedMeshResources(root([a,b,c]));
  b.geometry.position[0] = 42;
  assert.equal(a.geometry.position[0], 0);
  assert.equal(c.geometry, unique);
});

test('skinned mesh bindings stay intact and different parsed models stay independent', () => {
  const geo = geometry(), mat = material(), a = {...mesh(mat, geo), isSkinnedMesh:true};
  const b = {...mesh(mat, geo), isSkinnedMesh:true};
  const second = mesh();
  prepareLoadedMeshResources(root([a,b]));
  prepareLoadedMeshResources(root([second]));
  assert.equal(a.geometry, geo);
  assert.equal(b.geometry, geo);
  const independent = second.material;
  ownMeshMaterials(second);
  assert.equal(second.material, independent);
});

test('camera reframing reuses local bounds while vertex edits and buffer replacement invalidate them', () => {
  let position = {version: 0}, reads = 0;
  const geo = {getAttribute: () => position, computeBoundingBox() { this.boundingBox = {revision: ++reads}; }};
  const first = loadedGeometryBounds(geo);
  assert.equal(loadedGeometryBounds(geo), first);
  assert.equal(reads, 1);
  position.version++;
  assert.notEqual(loadedGeometryBounds(geo), first);
  position = {version: 0};
  loadedGeometryBounds(geo);
  assert.equal(reads, 3);
  geo.boundingBox = null;
  loadedGeometryBounds(geo);
  assert.equal(reads, 4);
});

test('interleaved vertex edits invalidate the cached bounds', () => {
  const position = {data: {version: 0}};
  let reads = 0;
  const geo = {getAttribute: () => position, computeBoundingBox() { this.boundingBox = {revision: ++reads}; }};
  loadedGeometryBounds(geo);
  position.data.version++;
  loadedGeometryBounds(geo);
  assert.equal(reads, 2);
});

test('loaded meshes recover missing vertex normals before shaded rendering', () => {
  let computed = 0;
  let normalized = 0;
  const attributes = {position: {count: 12}};
  const geo = {
    attributes,
    getAttribute(name) { return attributes[name]; },
    computeVertexNormals() { computed++; attributes.normal = {count: 12}; },
    normalizeNormals() { normalized++; },
    clone() { return this; },
  };

  prepareLoadedMeshResources(root([mesh(material(), geo)]));

  assert.equal(computed, 1);
  assert.equal(normalized, 1);
  assert.equal(attributes.normal.count, 12);
});

test('loaded meshes preserve authored vertex normals', () => {
  let computed = 0;
  const attributes = {position: {count: 12}, normal: {count: 12}};
  const geo = {
    attributes,
    getAttribute(name) { return attributes[name]; },
    computeVertexNormals() { computed++; },
    clone() { return this; },
  };

  prepareLoadedMeshResources(root([mesh(material(), geo)]));

  assert.equal(computed, 0);
  assert.equal(attributes.normal.count, 12);
});
