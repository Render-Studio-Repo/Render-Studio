import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelCachePath } from './model-cache-path.js';
const path = '/api/projects/p1/files/vibecad/robot%20base.glb';
const files = [{ name: 'vibecad/robot base.glb', version: '123456789-8192' }];
const opts = { projectId: 'p1', files, sessionEpoch: 10 };

test('reopening an unchanged file uses the same URL across switches and reloads', () => {
  assert.equal(modelCachePath(path, opts), modelCachePath(path, { ...opts, sessionEpoch: 20 }));
});
test('same-name, same-size replacement uses the new file revision', () => {
  assert.notEqual(modelCachePath(path, opts), modelCachePath(path, { ...opts, files: [{ ...files[0], version: '987654321-8192' }] }));
});
test('local edits and forced refreshes bypass stale metadata', () => {
  const original = modelCachePath(path, opts);
  assert.notEqual(original, modelCachePath(path, { ...opts, epoch: 21 }));
  assert.notEqual(original, modelCachePath(path, { ...opts, force: 30 }));
});
test('another project cannot reuse the active project file revision', () => {
  assert.equal(modelCachePath(path.replace('/p1/', '/p2/'), opts), '/api/projects/p2/files/vibecad/robot%20base.glb?_=10');
});
test('unknown preview sidecars use a stable session key and preserve other query parameters', () => {
  const input = '/api/projects/p1/files/.robot.step.glb?download=1&_=old#face';
  assert.equal(modelCachePath(input, opts), '/api/projects/p1/files/.robot.step.glb?download=1&_=10#face');
  assert.equal(modelCachePath('/unrelated.glb', opts), '/unrelated.glb');
  assert.equal(modelCachePath('/api/projects/p1/files/%zz.glb', opts), '/api/projects/p1/files/%zz.glb');
});
