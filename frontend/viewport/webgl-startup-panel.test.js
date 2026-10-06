import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { takeWebGlCompatibilityRetry, WEBGL_COMPATIBILITY_KEY, mountWebGlStartupPanel, webGlRecoveryHelp } from './webgl-startup-panel.js';

const here = dirname(fileURLToPath(import.meta.url));
const panelSrc = readFileSync(join(here, 'webgl-startup-panel.js'), 'utf8');

test('compatibility retry is consumed for exactly one startup', () => {
  const entries = new Map([[WEBGL_COMPATIBILITY_KEY, '1']]);
  const storage = { getItem: key => entries.get(key), removeItem: key => entries.delete(key) };
  assert.equal(takeWebGlCompatibilityRetry(storage), true);
  assert.equal(takeWebGlCompatibilityRetry(storage), false);
});

test('browser denying access to sessionStorage does not abort Studio startup', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  try {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() { throw new DOMException('Storage denied', 'SecurityError'); },
    });
    assert.equal(takeWebGlCompatibilityRetry(), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else delete globalThis.sessionStorage;
  }
});

test('startup panel describes the actual WebGL2 retry and does not promise unsupported WebGL1', () => {
  assert.match(panelSrc, /Reduced graphics settings/);
  assert.doesNotMatch(panelSrc, /software WebGL2, then WebGL1/);
  assert.match(panelSrc, /3D graphics still could not start/);
  assert.doesNotMatch(panelSrc, /still refusing WebGL2/);
  assert.match(panelSrc, /Signing in again will not repair/);
  assert.match(panelSrc, /Hardware accelerated/);
  assert.match(panelSrc, /chrome:\/\/gpu/);
  assert.match(panelSrc, /r172/);
  assert.match(panelSrc, /Refreshing this page is not enough/);
  assert.doesNotMatch(panelSrc, /Mini Chrome/);
});

test('gpuhang2 PC recovery copy names hardware acceleration, chrome://gpu, and WebGL1-only', () => {
  const disabled = webGlRecoveryHelp(
    { message: 'GL_RENDERER = Disabled BindToCurrentSequence' },
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128', protocol: 'https:', hostname: 'render3d.app', apis: { webgl1Only: false } },
  );
  assert.match(disabled, /hardware acceleration/i);
  assert.match(disabled, /chrome:\/\/gpu/);
  assert.match(disabled, /Onshape/);
  assert.match(disabled, /Refreshing is not enough/);
  assert.doesNotMatch(disabled, /Mac Mini/);

  const webgl1 = webGlRecoveryHelp(
    { message: 'Error creating WebGL context' },
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/128', protocol: 'http:', hostname: '192.168.1.83', apis: { webgl1Only: true } },
  );
  assert.match(webgl1, /WebGL1 but not WebGL2/);
  assert.match(webgl1, /r172/);
  assert.match(webgl1, /https:\/\/render3d\.app/);
  assert.match(webgl1, /Robot Enable/);
});

test('failed Retry 3D stays on the page and does not store compatibility mode', async () => {
  const host = { append() {}, querySelector() { return null; } };
  const created = [];
  const orig = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      const node = {
        tagName: String(tag).toUpperCase(),
        className: '',
        textContent: '',
        type: '',
        disabled: false,
        style: {},
        dataset: {},
        children: [],
        append(...nodes) { this.children.push(...nodes); },
        setAttribute() {},
        addEventListener(type, fn) { this.handlers = this.handlers || {}; this.handlers[type] = fn; },
      };
      created.push(node);
      return node;
    },
    querySelector() { return true; },
    head: { append() {} },
  };
  try {
    const storage = new Map();
    let reloads = 0;
    mountWebGlStartupPanel(host, {
      error: new Error('3D viewport could not start. GL_VENDOR = Disabled'),
      storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      probe: async () => { throw new Error('still down'); },
      reload: () => { reloads += 1; },
    });
    const retry = created.find((node) => node.className === 'webgl-retry-button');
    await retry.handlers.click();
    assert.equal(reloads, 0);
    assert.equal(storage.size, 0);
    const summary = created.find((node) => /still could not start/.test(node.textContent || ''));
    assert.ok(summary, 'failed retry must update the summary copy');
  } finally {
    if (orig) globalThis.document = orig;
    else delete globalThis.document;
  }
});
