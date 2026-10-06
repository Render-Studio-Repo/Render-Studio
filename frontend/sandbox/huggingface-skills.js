/** Hugging Face skills rack — new jobs agents can wield. Token hfskill1. Account: samwins. */

export const HFSKILL1_TOKEN = "hfskill1";

export const HF_SKILL_CATALOG = Object.freeze([
  { id: "ocr", space: "mcp-tools/DeepSeek-OCR-experimental", category: "OCR", label: "Read screenshots", job: "Read the monitor / screenshot and extract text" },
  { id: "tts", space: "ResembleAI/Chatterbox", category: "Text to Speech", label: "Voice line", job: "Speak a new job line in the workspace" },
  { id: "bg", space: "not-lain/background-removal", category: "Background Removal", label: "Cut background", job: "Clean a reference still" },
  { id: "img-fast", space: "evalstate/flux1_schnell", category: "Image Generation", label: "Quick still", job: "Sketch a still for a new job" },
  { id: "img-edit", space: "mcp-tools/FLUX.1-Kontext-Dev", category: "Image Editing", label: "Edit still", job: "Edit a still from a prompt" },
  { id: "video", space: "zerogpu-aoti/wan2-2-fp8da-aoti-faster", category: "Video Generation", label: "Clip", job: "Make a short clip from a still" },
]);

const LS = "render3d.sandbox.hfSkills";

export function loadWielded(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LS);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function wieldedFor(agentId, storage = globalThis.localStorage) {
  return loadWielded(storage)[agentId] || null;
}

export function setWielded(agentId, skillId, storage = globalThis.localStorage) {
  const skill = HF_SKILL_CATALOG.find((s) => s.id === skillId) || null;
  const next = { ...loadWielded(storage) };
  if (!skill) delete next[agentId];
  else next[agentId] = { ...skill, at: new Date().toISOString() };
  try { storage?.setItem?.(LS, JSON.stringify(next)); } catch { /* private */ }
  return next[agentId] || null;
}

export function skillById(id) {
  return HF_SKILL_CATALOG.find((s) => s.id === id) || null;
}

export function mountHfRack(host) {
  if (!host) return null;
  const existing = host.querySelector("[data-hf-rack]");
  if (existing) return existing;
  const rack = document.createElement("ul");
  rack.className = "sb-hf-rack";
  rack.setAttribute("data-hf-rack", "1");
  rack.innerHTML = HF_SKILL_CATALOG.map((s) =>
    `<li><strong>${s.label}</strong> · ${s.category}<br><code>${s.space}</code></li>`
  ).join("");
  host.appendChild(rack);
  return rack;
}
