/**
 * Send the live VR AI prompt (text + sketch clips + attachments) to the same
 * user's laptop session so they can continue at the desk.
 */

export function serializePromptBridge(state = {}, extras = {}) {
  const images = [];
  const clips = extras.clips || state.composeImages || [];
  for (const img of clips) {
    if (!img) continue;
    const url = img.imageDataUrl || img.data_url || img.url || "";
    if (!url) continue;
    images.push({
      id: img.id || `clip-${images.length + 1}`,
      name: img.name || img.label || `Sketch ${images.length + 1}`,
      imageDataUrl: String(url).slice(0, 1_400_000),
      promptAugment: img.promptAugment || "",
    });
    if (images.length >= 6) break;
  }
  return {
    type: "xr.prompt.bridge",
    prompt: String(state.draft || extras.prompt || "").slice(0, 8000),
    images,
    strokeCount: Number(extras.strokeCount || state.drawStrokes || 0) || 0,
    project_id: extras.projectId || null,
    sent_at: new Date().toISOString(),
  };
}

export function applyPromptBridgeOnLaptop(payload, {
  setPromptText,
  attachImage,
  onStatus,
} = {}) {
  if (!payload || payload.type !== "xr.prompt.bridge") return { ok: false };
  const text = String(payload.prompt || "").trim();
  if (text && typeof setPromptText === "function") {
    try { setPromptText(text); } catch { /* ignore */ }
  }
  let attached = 0;
  for (const img of payload.images || []) {
    if (!img?.imageDataUrl || typeof attachImage !== "function") continue;
    try {
      attachImage({
        id: img.id,
        name: img.name || "VR sketch",
        data_url: img.imageDataUrl,
        imageDataUrl: img.imageDataUrl,
        promptAugment: img.promptAugment || "",
        fromXr: true,
      });
      attached += 1;
    } catch { /* ignore */ }
  }
  try {
    onStatus?.("ok", attached
      ? `VR prompt arrived · ${attached} sketch${attached === 1 ? "" : "es"}`
      : "VR prompt arrived on this PC");
  } catch { /* ignore */ }
  return { ok: true, attached, prompt: text };
}
