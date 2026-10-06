/** Headless activity logger — no UI dock.
 *
 * Call sites still push/refresh; entries stay in memory and server logs
 * continue via /api/logs. The bottom-left Activity log panel is gone.
 */

const LOCAL_MAX = 40;
const MAX_DATA_CHARS = 1200;

function clipData(data) {
  if (data == null) return data;
  try {
    const text = JSON.stringify(data);
    if (text.length <= MAX_DATA_CHARS) return data;
    return { _clipped: true, preview: `${text.slice(0, MAX_DATA_CHARS - 24)}…` };
  } catch {
    return { _clipped: true };
  }
}

export function createActivityLog(_container, fetchFn = fetch) {
  // `_container` kept for call-site compatibility; UI is intentionally not mounted.
  const localEntries = [];
  let refreshTimer = null;

  function trimLocal() {
    while (localEntries.length > LOCAL_MAX) localEntries.pop();
  }

  function push(entry) {
    localEntries.unshift({
      ...entry,
      ts: entry.ts || new Date().toISOString(),
      data: clipData(entry.data),
    });
    trimLocal();
  }

  function render() {
    // UI removed — keep no-op for call sites.
  }

  async function refreshServer() {
    try {
      await fetchFn("/api/logs?limit=30");
    } catch (_) {
      // Background fetch only; nothing to show in the UI.
    }
  }

  function refreshServerDebounced() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshServer(), 400);
  }

  function destroy() {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    localEntries.length = 0;
  }

  return {
    push,
    render,
    refreshServer,
    refreshServerDebounced,
    destroy,
    el: null,
    getEntries: () => localEntries.slice(),
  };
}
