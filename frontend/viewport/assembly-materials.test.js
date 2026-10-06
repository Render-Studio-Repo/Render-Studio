import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureAssemblyMaterials, restoreAssemblyMaterials } from './assembly-materials.js';
const mat = (color) => ({ color, clone() { return mat(this.color); }, dispose() {} });
const mesh = (name, color) => ({ isMesh: true, name, material: mat(color), userData: {} });
const root = (items) => ({ traverse(fn) { items.forEach(fn); } });
test('assembled restore preserves named material colours despite reordered leaves', () => {
  const saved = captureAssemblyMaterials(root([mesh('rubber', 'black'), mesh('brass', 'gold')]));
  const items = [mesh('brass', 'white'), mesh('rubber', 'white')];
  restoreAssemblyMaterials(root(items), saved);
  assert.deepEqual(items.map((m) => m.material.color), ['gold', 'black']);
});
test('ambiguous and unnamed leaves are not painted by traversal order', () => {
  const saved = captureAssemblyMaterials(root([mesh('part', 'red'), mesh('part', 'blue'), mesh('', 'pink')]));
  const item = mesh('part', 'silver');
  restoreAssemblyMaterials(root([item]), saved);
  assert.equal(item.material.color, 'silver');
});
