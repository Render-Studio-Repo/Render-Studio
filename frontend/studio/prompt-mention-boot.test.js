import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const start = source.indexOf('function getPromptMentionables() {');
const end = source.indexOf('\nfunction ', start + 1);
const catalog = source.slice(start, end);

test('initial composer render does not access uninitialized editor dependencies', () => {
  const result = vm.runInNewContext(`
    let promptMentionablesReady = false;
    ${catalog}
    const initial = getPromptMentionables();
    const objectTools = {};
    initial.length;
  `);
  assert.equal(result, 0);
});

test('mention catalog is enabled after synchronous editor initialization', async () => {
  const begin = source.indexOf('let promptMentionablesReady = false;');
  const finish = source.indexOf('const composer = createPromptComposer(', begin);
  const context = vm.createContext({ queueMicrotask });
  vm.runInContext(source.slice(begin, finish), context);
  assert.equal(vm.runInContext('promptMentionablesReady', context), false);
  await Promise.resolve();
  assert.equal(vm.runInContext('promptMentionablesReady', context), true);
});
