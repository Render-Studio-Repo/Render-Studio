import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeStudioRenderer } from './studio-graphics-startup.js';

function fixture(failures, reason = 'GPU temporarily unavailable') {
  const canvases = [], options = [], waits = [], disposed = [];
  class WebGLRenderer {
    constructor(attributes) {
      options.push(attributes);
      if (options.length <= failures) {
        attributes.canvas.handlers.webglcontextcreationerror({ statusMessage: reason });
        throw new Error('Error creating WebGL context.');
      }
      this.xr = { native: true };
    }
    getContext() { return { isContextLost: () => false }; }
    dispose() { disposed.push(this); }
  }
  return { THREE: { WebGLRenderer }, canvases, options, waits, disposed, dependencies: {
    wait: async ms => waits.push(ms),
    makeCanvas() {
      const canvas = { handlers: {}, addEventListener(k, fn) { this.handlers[k] = fn; }, removeEventListener(k) { delete this.handlers[k]; } };
      canvases.push(canvas);
      return canvas;
    },
  } };
}
const attributes = { alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true };

test('healthy startup retains the native renderer and XR manager without retries', async () => {
  const f = fixture(0);
  const result = await createNativeStudioRenderer(f.THREE, attributes, f.dependencies);
  assert.equal(result.renderer.xr.native, true);
  assert.equal(result.profile, 'standard');
  assert.equal(f.options.length, 1);
  assert.equal(f.options[0].context, undefined);
  assert.equal(f.options[0].antialias, true);
  assert.deepEqual(f.waits, []);
  assert.deepEqual(f.disposed, []);
  assert.deepEqual(f.canvases[0].handlers, {});
});

test('transient failure recovers after yielding, with fresh canvases and reduced allocation', async () => {
  const f = fixture(2);
  const result = await createNativeStudioRenderer(f.THREE, attributes, f.dependencies);
  assert.equal(result.profile, 'compatible-retry');
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(f.waits, [300]);
  assert.equal(new Set(f.canvases).size, 3);
  assert.equal(f.options[2].antialias, false);
  assert.equal(f.options[2].preserveDrawingBuffer, false);
  assert.equal(f.options[2].alpha, true);
  assert.equal(f.options[2].logarithmicDepthBuffer, true);
});

test('permanent failure is bounded and preserves the browser reason', async () => {
  const f = fixture(99);
  await assert.rejects(createNativeStudioRenderer(f.THREE, attributes, f.dependencies), error => {
    assert.match(error.message, /GPU temporarily unavailable/);
    assert.equal(error.webglDiagnostics.length, 4);
    return true;
  });
  assert.deepEqual(f.waits, [300, 900]);
  assert.equal(f.options.length, 4);
});

test('a temporarily disabled GPU backend still gets the bounded delayed recovery attempts', async () => {
  const f = fixture(2, 'GL_VENDOR = Disabled, GL_RENDERER = Disabled / BindToCurrentSequence');
  const result = await createNativeStudioRenderer(f.THREE, attributes, f.dependencies);
  assert.equal(result.profile, 'compatible-retry');
  assert.equal(f.options.length, 3);
  assert.deepEqual(f.waits, [300]);
});

test('a persistently disabled GPU backend remains bounded', async () => {
  const f = fixture(99, 'GL_VENDOR = Disabled, GL_RENDERER = Disabled / BindToCurrentSequence');
  await assert.rejects(createNativeStudioRenderer(f.THREE, attributes, f.dependencies), error => {
    assert.equal(error.webglDiagnostics.length, 4);
    return true;
  });
  assert.equal(f.options.length, 4);
  assert.deepEqual(f.waits, [300, 900]);
});

test('explicit retry starts with reduced graphics and preserves passthrough alpha', async () => {
  const f = fixture(0);
  await createNativeStudioRenderer(f.THREE, attributes, { ...f.dependencies, compatibilityOnly: true });
  assert.equal(f.options[0].alpha, true);
  assert.equal(f.options[0].preserveDrawingBuffer, false);
  assert.equal(f.options[0].antialias, false);
});
