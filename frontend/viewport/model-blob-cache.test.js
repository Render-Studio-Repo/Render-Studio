import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelBlobCache } from './model-blob-cache.js';
const blob = (size) => new Blob(['x'.repeat(size)]);

test('reopening large unchanged previews reuses bytes; simultaneous loads share a request', async () => {
  const cache = createModelBlobCache(); let calls = 0;
  const fetch = async () => { calls++; return blob(200); };
  const [a,b] = await Promise.all([cache.get('project/file?v=1', fetch), cache.get('project/file?v=1', fetch)]);
  assert.equal(a,b);
  assert.equal(await cache.get('project/file?v=1', fetch), a);
  assert.equal(calls,1);
  await cache.get('project/file?v=2', fetch);
  assert.equal(calls,2);
});
test('LRU eviction respects both byte and entry limits; oversized files are not retained', async () => {
  const cache = createModelBlobCache({ maxBytes: 10, maxEntries: 2 }); let calls=0;
  const fetch = async () => { calls++; return blob(4); };
  await cache.get('a',fetch);await cache.get('b',fetch);await cache.get('a',fetch);await cache.get('c',fetch);
  assert.deepEqual(cache.stats(),{ bytes:8, entries:2 });
  await cache.get('a',fetch);assert.equal(calls,3);
  await cache.get('b',fetch);assert.equal(calls,4);
  await cache.get('huge',async()=>blob(11));assert.deepEqual(cache.stats(),{ bytes:8, entries:2 });
});
test('failed fetches retry and account switches cannot reuse another account bytes', async () => {
  const cache = createModelBlobCache(); let calls=0;
  const fetch = async () => { calls++; return blob(4); };
  await assert.rejects(cache.get('fail',()=>Promise.reject(Error('offline'))));
  await cache.get('fail',fetch,'alice');await cache.get('fail',fetch,'bob');
  assert.equal(calls,2);
  assert.equal(cache.stats().entries,1);
});
test('clearing or changing account while a request runs cannot repopulate the cache', async () => {
  const cache = createModelBlobCache(); let resolve;
  const first = cache.get('old',()=>new Promise(r=>{ resolve=r; }),'alice');
  await Promise.resolve();
  await cache.get('new',async()=>blob(2),'bob');
  resolve(blob(4));await first;
  assert.deepEqual(cache.stats(),{bytes:2,entries:1});
  cache.clear();assert.deepEqual(cache.stats(),{bytes:0,entries:0});
});
