const REASONING_LEVELS = Object.freeze([
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]);

const AUTO_ONLY = Object.freeze([REASONING_LEVELS[0]]);
const STANDARD_REASONING = REASONING_LEVELS;
const STORAGE_PREFIX = "render3d:model-reasoning:v1";

export function modelReasoningOptions(provider = "", model = "") {
  const p = String(provider || "").trim().toLowerCase();
  const m = String(model || "").trim().toLowerCase();
  if (p === "openai" && /^(gpt-5\.5|gpt-5\.6|gpt-6)/.test(m)) return STANDARD_REASONING;
  if (p === "gemini" && /^gemini-(?:2\.5|3\.)/.test(m)) return STANDARD_REASONING;
  if (p === "kimi" && /^kimi-k3(?:$|-)/.test(m)) return STANDARD_REASONING;
  return AUTO_ONLY;
}

export function modelReasoningStorageKey(provider = "", model = "") {
  const p = String(provider || "auto").trim().toLowerCase() || "auto";
  const m = String(model || "auto").trim().toLowerCase() || "auto";
  return `${STORAGE_PREFIX}:${encodeURIComponent(p)}:${encodeURIComponent(m)}`;
}

export function normalizeModelReasoning(provider = "", model = "", effort = "auto") {
  const wanted = String(effort || "auto").trim().toLowerCase() || "auto";
  const allowed = modelReasoningOptions(provider, model).map((row) => row.value);
  return allowed.includes(wanted) ? wanted : "auto";
}

export function loadModelReasoning(provider = "", model = "", storage = globalThis.localStorage) {
  try {
    return normalizeModelReasoning(provider, model, storage?.getItem?.(modelReasoningStorageKey(provider, model)));
  } catch {
    return "auto";
  }
}

export function storeModelReasoning(provider = "", model = "", effort = "auto", storage = globalThis.localStorage) {
  const normalized = normalizeModelReasoning(provider, model, effort);
  try { storage?.setItem?.(modelReasoningStorageKey(provider, model), normalized); } catch { /* local storage is best-effort */ }
  return normalized;
}

export function modelReasoningOptionsHTML(provider = "", model = "", selected = "auto") {
  const current = normalizeModelReasoning(provider, model, selected);
  return modelReasoningOptions(provider, model).map((row) => (
    `<option value="${row.value}"${row.value === current ? " selected" : ""}>Reasoning: ${row.label}</option>`
  )).join("");
}

export function modelReasoningRequestField(provider = "", model = "", storage = globalThis.localStorage) {
  const effort = loadModelReasoning(provider, model, storage);
  return effort === "auto" ? {} : { reasoning_effort: effort };
}
