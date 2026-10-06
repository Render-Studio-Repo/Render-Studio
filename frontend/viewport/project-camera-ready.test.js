import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../studio/app.js', import.meta.url), 'utf8');
const hook = app.slice(app.indexOf('function scheduleFitCameraAfterProjectLoad()'), app.indexOf('\nconst HANDHELD_VIEW_M'));
function fixture(ready = () => true) {
  const queue = [], calls = [];
  const context = {renderer: {xr: {}}, viewportXR: {isPresenting: () => false}, loadProjectGeneration: 1,
    trackballPointerSafety: {isBusy: () => false}, projectAssembly: {invalidateBounds() {}},
    resize: () => calls.push('resize'), fitCamera: () => {calls.push('fit'); return ready();},
    window: {requestAnimationFrame: fn => queue.push(fn), setTimeout: fn => queue.push(fn)}};
  vm.createContext(context);vm.runInContext(hook, context);
  const flush = () => { while (queue.length) queue.shift()(); };
  return {context, calls, flush};
}
test('a ready viewport fits once instead of repeatedly snapping and rebuilding bounds', () => {
  const {context, calls, flush} = fixture();
  context.scheduleFitCameraAfterProjectLoad();flush();
  assert.deepEqual(calls, ['resize','fit']);
});
test('a delayed model retries until ready and stops immediately on success', () => {
  let attempts = 0;
  const {context, calls, flush} = fixture(() => ++attempts === 2);
  context.scheduleFitCameraAfterProjectLoad();flush();
  assert.equal(calls.filter(c => c === 'fit').length, 2);
});
test('superseded projects and active gestures cannot move the camera', () => {
  for (const changed of [c => c.loadProjectGeneration++, c => c.trackballPointerSafety.isBusy = () => true]) {
    const {context, calls, flush} = fixture();
    context.scheduleFitCameraAfterProjectLoad();changed(context);flush();
    assert.deepEqual(calls, []);
  }
});
