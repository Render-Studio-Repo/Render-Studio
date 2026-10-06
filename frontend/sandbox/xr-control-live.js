/** Live VR control poll + Simulate sandbox controls. Token xrctrl2. No extra WebGL. */

export const XRCTRL2_CACHE = "xrctrl2";
export const LIVE_CONTROLS_URL = "/mcp/sandbox/controls";
export const LIVE_NOTES_URL = "/mcp/sandbox/control-notes";
export const LIVE_API_URL = "/api/xr/control-config";

export function sessionShouldUseLiveBindings({ simulate = false, listen = false, apply_scene = false } = {}) {
  if (apply_scene === true) return true;
  return simulate === true || listen === true;
}

export function bindingsFromLiveDoc(doc) {
  const hid = String(doc?.headset || "quest3");
  const map = doc?.profiles?.[hid] || doc?.map || doc?.bindings || {};
  return {
    headset: hid,
    trigger: Number(map.trigger?.btn) || 0,
    squeeze: Number.isFinite(Number(map.squeeze?.btn)) ? Number(map.squeeze.btn) : 1,
    selectstart: String(doc?.session?.selectstart || "ui-then-poll"),
    grab: String(doc?.session?.grab || "squeeze-or-trigger"),
    dimos: String(doc?.session?.dimos || "ui-beats-overlay"),
    rev: Number(doc?.rev) || 0,
  };
}

export function createXrLiveControlClient({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  applyDoc,
  intervalMs = 800,
} = {}) {
  let timer = 0;
  let lastRev = 0;
  let lastDoc = null;
  let running = false;

  async function pull() {
    if (!fetchImpl) return lastDoc;
    const res = await fetchImpl(LIVE_CONTROLS_URL + "?t=" + Date.now()).catch(() => null);
    if (!res || !res.ok) {
      const api = await fetchImpl(LIVE_API_URL + "?t=" + Date.now()).catch(() => null);
      if (!api || !api.ok) return null;
      const data = await api.json().catch(() => null);
      return ingest(data);
    }
    const data = await res.json().catch(() => null);
    return ingest(data);
  }

  function ingest(data) {
    if (!data || data.ok === false) return null;
    lastDoc = data;
    lastRev = Number(data.rev) || 0;
    applyDoc?.(data);
    return data;
  }

  function start() {
    if (running) return { ok: true, running: true, token: XRCTRL2_CACHE };
    running = true;
    void pull();
    timer = setInterval(() => { void pull(); }, Math.max(250, Number(intervalMs) || 800));
    return { ok: true, running: true, token: XRCTRL2_CACHE };
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = 0;
    return { ok: true, running: false, token: XRCTRL2_CACHE };
  }

  async function patch(partial) {
    if (!fetchImpl) return lastDoc;
    const res = await fetchImpl(LIVE_CONTROLS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "put", ...(partial || {}) }),
    }).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      return ingest(data);
    }
    const api = await fetchImpl(LIVE_API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial || {}),
    }).catch(() => null);
    if (!api || !api.ok) return lastDoc;
    return ingest(await api.json());
  }

  async function addNote(note) {
    if (!fetchImpl) return { ok: false };
    const res = await fetchImpl(LIVE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "note", ...(note || {}) }),
    }).catch(() => null);
    return res && res.ok ? res.json() : { ok: false };
  }

  return {
    start,
    stop,
    pull,
    patch,
    addNote,
    last: () => lastDoc,
    running: () => running,
    token: XRCTRL2_CACHE,
  };
}
