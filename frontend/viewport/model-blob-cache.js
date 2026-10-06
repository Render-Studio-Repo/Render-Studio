/** Bounded byte cache for large previews that browsers may exclude from HTTP cache. */
export function createModelBlobCache({ maxBytes = 64 * 1024 * 1024, maxEntries = 8 } = {}) {
  const entries = new Map();
  const pending = new Map();
  let bytes = 0;
  let scope = null;
  let generation = 0;
  function clear() {
    generation++;
    entries.clear();
    pending.clear();
    bytes = 0;
  }
  function get(key, fetchBlob, owner = "anonymous") {
    if (scope !== owner) { clear(); scope = owner; }
    if (entries.has(key)) {
      const blob = entries.get(key);
      entries.delete(key);
      entries.set(key, blob);
      return Promise.resolve(blob);
    }
    if (pending.has(key)) return pending.get(key);
    const run = generation;
    const promise = Promise.resolve().then(fetchBlob).then((blob) => {
      const size = Number(blob?.size) || 0;
      if (run === generation && size > 0 && size <= maxBytes && maxEntries > 0) {
        while (entries.size && (bytes + size > maxBytes || entries.size >= maxEntries)) {
          const oldest = entries.keys().next().value;
          bytes -= entries.get(oldest).size;
          entries.delete(oldest);
        }
        entries.set(key, blob);
        bytes += size;
      }
      return blob;
    }).finally(() => {
      if (pending.get(key) === promise) pending.delete(key);
    });
    pending.set(key, promise);
    return promise;
  }
  return { get, clear, stats: () => ({ bytes, entries: entries.size }) };
}
