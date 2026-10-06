/** Compact, opt-in sandbox reference capture. No poses, speech, prompt text, or raw frames. */
export function controllerButtons(inputSources = []) {
  const state = new Map();
  for (const source of inputSources) {
    const hand = source.handedness === "left" || source.handedness === "right" ? source.handedness : "other";
    (source.gamepad?.buttons || []).forEach((button, index) => state.set(`${hand}.b${index}`, Boolean(button.pressed)));
  }
  return state;
}

export function createVrReferenceCapture({
  getSession = () => globalThis.Render3DXrControls?.getSession?.(),
  fetchImpl = globalThis.fetch?.bind(globalThis),
  intervalMs = 120,
  flushMs = 30000,
  onStatus = () => {},
} = {}) {
  let pollTimer = 0;
  let flushTimer = 0;
  let previous = new Map();
  let counts = new Map();
  let tools = new Map();
  let samples = 0;
  let started = "";
  let flushing = false;
  let previousTool = "";

  const short = (value) => String(value || "").replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 48);
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const sample = () => {
    const session = getSession();
    if (!session?.inputSources) { onStatus("Recording · waiting for XR session"); return; }
    const next = controllerButtons(session.inputSources);
    for (const [key, pressed] of next) {
      if (previous.has(key) && previous.get(key) !== pressed) bump(counts, `${key}.${pressed ? "down" : "up"}`);
    }
    previous = next;
    const activeTool = short(globalThis.Render3DXrControls?.getActiveTool?.());
    if (activeTool && previousTool && activeTool !== previousTool) bump(tools, `xr:${activeTool}`);
    previousTool = activeTool;
    samples += 1;
    onStatus(`Recording · ${counts.size} input transitions · ${samples} samples`);
  };
  const onTool = (event) => {
    const target = event.target?.closest?.("button,[data-tool],[data-action]");
    if (!target) return;
    const name = short(target.dataset?.tool || target.dataset?.action || target.id);
    if (name) bump(tools, name);
  };
  const onXrSelection = (event) => {
    const kind = short(event.detail?.kind);
    if (kind) bump(tools, `xr-select:${kind}`);
  };
  async function flush() {
    if (flushing || (!counts.size && !tools.size) || !fetchImpl) return false;
    flushing = true;
    const snapshotCounts = counts;
    const snapshotTools = tools;
    counts = new Map();
    tools = new Map();
    const ranked = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, count]) => `${key}:${count}`).join(",");
    const note = `from=${started};to=${new Date().toISOString()};edges=${ranked(snapshotCounts)};tools=${ranked(snapshotTools)}`.slice(0, 390);
    try {
      const response = await fetchImpl("/api/xr/control-config", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "note", feature: "vr.reference", ok: true, attempt: "sandbox edge capture", note, source: "sandbox-capture" }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      try {
        await fetchImpl("/api/sandbox/context-log", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "sandbox-capture",
            feature_id: "vr.reference",
            event_kind: "flush",
            target_id: "xr-batch",
            edge_summary: ranked(snapshotCounts),
            tool_summary: ranked(snapshotTools),
            context: { samples: String(samples) },
          }),
        });
      } catch { /* supabase/jsonl optional */ }
      started = new Date().toISOString();
      onStatus("Recorded compact VR reference");
      return true;
    } catch (error) {
      for (const [key, value] of snapshotCounts) counts.set(key, (counts.get(key) || 0) + value);
      for (const [key, value] of snapshotTools) tools.set(key, (tools.get(key) || 0) + value);
      onStatus(`Recording · save failed (${error.message})`);
      return false;
    } finally { flushing = false; }
  }
  function start() {
    if (pollTimer) return;
    started = new Date().toISOString();
    previous = new Map();
    previousTool = "";
    document.addEventListener("click", onTool, true);
    window.addEventListener("render3d:xr-selection", onXrSelection);
    pollTimer = setInterval(sample, Math.max(80, intervalMs));
    flushTimer = setInterval(() => { void flush(); }, Math.max(5000, flushMs));
    onStatus("Recording · waiting for XR session");
  }
  function stop() {
    if (pollTimer) clearInterval(pollTimer);
    if (flushTimer) clearInterval(flushTimer);
    pollTimer = flushTimer = 0;
    document.removeEventListener("click", onTool, true);
    window.removeEventListener("render3d:xr-selection", onXrSelection);
    previous = new Map();
    void flush();
  }
  return { start, stop, flush, running: () => Boolean(pollTimer), summary: () => ({ edges: Object.fromEntries(counts), tools: Object.fromEntries(tools), samples }) };
}
