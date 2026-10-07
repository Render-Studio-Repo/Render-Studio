/** Copyable prompt instance references (@prompt:id). */

const MODEL_LABELS = {
  "chatgpt": "Codex",
  "gpt-6-astra": "GPT-6 Astra",
  "gpt-6-astra-pro": "GPT-6 Astra Pro",
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.5-pro": "GPT-5.5 Pro",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.6-sol": "GPT-5.6 Sol",
  "gpt-5.6-terra": "GPT-5.6 Terra",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "claude-opus-5": "Opus 5",
  "claude-fable-5-1": "Fable 5.1",
  "claude-fable-5": "Fable 5",
  "claude-sonnet-4-5": "Sonnet 4.5",
  "claude-opus-4-8": "Opus 4.8",
  "claude-4.6-sonnet": "Sonnet 4.6",
  "claude-4.6-opus": "Opus 4.6",
  "claude-opus-4-7": "Opus 4.7",
  "claude-opus-4-6": "Opus 4.6",
  "claude-opus-4-5": "Opus 4.5",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5": "Haiku 4.5",
  "kimi-k2.6": "Kimi K2.6",
  "kimi-k2.5": "Kimi K2.5",
  "kimi-k3": "Kimi K3 (V3)",
  "grok-4.5": "Grok 4.5",
  "grok-4.6": "Grok 4.6",
  "auto": "Auto",
  "composer-2.5": "Composer 2.5",
  "composer-1.5": "Composer",
  "gemini-3.1-pro": "Gemini 3.1 Pro",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "qwen3-coder-plus": "Qwen3 Coder Plus",
  "qwen3-coder-flash": "Qwen3 Coder Flash",
  "qwen-plus": "Qwen Plus",
  "qwen-max": "Qwen Max",
  "qwen-turbo": "Qwen Turbo",
};

/** Jake text-to-cad skills. Extra ones (dxf, cad-viewer, …) do not rename the engine. */
export const CAD_FAMILY_SKILL_IDS = Object.freeze([
  "cad",
  "dxf",
  "cad-viewer",
  "step-parts",
  "architect",
  "implicit-cad",
]);

const CAD_FAMILY_SKILL_SET = new Set(CAD_FAMILY_SKILL_IDS);

function skillId(value) {
  if (value && typeof value === "object") {
    return String(value.id || value.skill || value.name || "").trim().toLowerCase();
  }
  return String(value || "").trim().toLowerCase();
}

export function cadFamilySkillsUsed(skills) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(skills) ? skills : []) {
    const id = skillId(item);
    if (!id || seen.has(id) || !CAD_FAMILY_SKILL_SET.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isTextToCadModeToken(mode) {
  const m = String(mode || "").trim().toLowerCase();
  return (
    m === "v2"
    || m === "2.0"
    || m === "2"
    || m === "cad"
    || m === "jake"
    || m === "text to cad"
    || m === "text-to-cad"
    || m === "text_to_cad"
  );
}

/** History / overlay / timeline labels that are CAD engines (not Mesh / Render). */
export function isCadPromptModeLabel(label) {
  const l = String(label || "").trim().toLowerCase();
  return l === "jake" || l === "text to cad" || l === "vibecad" || l === "mac" || l === "dxf";
}

/**
 * Display label for history / overlay / copied @prompt: `mode:` field.
 * Stored kind/mode ids stay `cad` / `v2` / `mac`; this is copy only.
 * Jake text-to-cad (engine picker “Jake”) vs MAC (Multi-Agent CAD) vs VibeCAD.
 */
export function formatPromptModeLabel(mode, skills) {
  const m = String(mode || "").trim().toLowerCase();
  if (m === "vibecad" || m === "vibe" || m === "vibecade") return "VibeCAD";
  if (m === "draw") return "draw";
  if (m === "standard" || m === "render") return "render";
  if (
    m === "mac"
    || m === "macad"
    || m === "multi_agent_cad"
    || m === "multiagentcad"
    || m === "multi-cad"
  ) {
    return "MAC";
  }
  if (m === "mesh" || m === "mesh_beta" || m === "mesh-beta" || m === "img2threejs") {
    return m === "mesh-beta" ? "mesh_beta" : m === "img2threejs" ? "mesh" : m;
  }
  if (m === "fusion") return "mesh";
  if (m === "wiring") return "wiring";
  if (m === "rigging" || m === "rig") return "rigging";
  if (m === "architect") return "architect";

  const family = cadFamilySkillsUsed(skills);
  const cadish = !m || isTextToCadModeToken(m);
  // cad + dxf / cad-viewer is still Jake text-to-cad — never “multi cad” (that
  // name collides with MAC / Multi-Agent CAD).
  if (isTextToCadModeToken(m) || (cadish && family.includes("cad"))) return "Jake";
  if (cadish && family.length === 1 && family[0] === "dxf") return "dxf";
  if (!m) return null;
  return m;
}

const HISTORY_PENDING_STATUSES = new Set([
  "accepted",
  "pending",
  "queued",
  "running",
  "starting",
]);

const HISTORY_ABORTED_STATUSES = new Set([
  "stopped",
  "canceled",
  "cancelled",
  "aborted",
]);

const HISTORY_ABORTED_ERROR_RE =
  /stopped by user|generation (?:was )?(?:stopped|canceled|cancelled|aborted)|operation was aborted|design canceled/i;

function isMeshModeLabel(modeLabel) {
  const m = String(modeLabel || "").trim().toLowerCase();
  return m === "mesh" || m === "mesh_beta" || m === "mesh-beta" || m.startsWith("mesh_");
}

/**
 * CSS class list for the history mode chip.
 * Mesh is purple; CAD family (Jake / MAC / VibeCAD) stays the default yellow `.ph-mode`.
 */
export function historyModeChipClass(modeLabel) {
  if (isMeshModeLabel(modeLabel)) return "ph-mode ph-mode--mesh";
  return "ph-mode";
}

/**
 * History row status chip: Generating / OK / Failed / Aborted.
 * Aborted wins over Failed whenever the stored job was stopped/canceled.
 */
export function formatHistoryStatus(entry = {}) {
  const status = String(entry?.status || "").trim().toLowerCase();
  const error = String(entry?.error || "");
  if (HISTORY_PENDING_STATUSES.has(status)) {
    return { state: "pending", label: "Generating" };
  }
  if (HISTORY_ABORTED_STATUSES.has(status) || HISTORY_ABORTED_ERROR_RE.test(error)) {
    return { state: "aborted", label: "Aborted" };
  }
  if (entry?.success) {
    return { state: "ok", label: "OK" };
  }
  return { state: "err", label: "Failed" };
}

function historyStatusKey(entry = {}) {
  return String(entry?.status || "").trim().toLowerCase();
}

function historyIsPending(entry = {}) {
  return HISTORY_PENDING_STATUSES.has(historyStatusKey(entry));
}

function parseHistoryTimeMs(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw < 1e12 ? raw * 1000 : raw;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function storedHistoryDurationMs(entry = {}) {
  for (const key of ["elapsed_ms", "duration_ms"]) {
    const n = Number(entry?.[key]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  for (const key of ["elapsed_seconds", "duration_seconds"]) {
    const n = Number(entry?.[key]);
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
  }
  return null;
}

function historyStartMs(entry = {}) {
  return parseHistoryTimeMs(entry?.started_at) ?? parseHistoryTimeMs(entry?.created_at);
}

function historyEndMs(entry = {}) {
  return parseHistoryTimeMs(entry?.finished_at) ?? parseHistoryTimeMs(entry?.completed_at);
}

/**
 * Compact clock matching the generate HUD, e.g. `12s`, `2m 14s`, `1h 03m`.
 */
export function formatHistoryElapsedClock(ms) {
  const sec = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Milliseconds the generation ran, or live elapsed while Generating. Null if unknown. */
export function historyElapsedMs(entry = {}, nowMs = Date.now()) {
  const stored = storedHistoryDurationMs(entry);
  const start = historyStartMs(entry);
  const end = historyEndMs(entry);
  if (historyIsPending(entry)) {
    if (start) return Math.max(0, Number(nowMs) - start);
    return stored;
  }
  if (stored != null) return stored;
  if (start != null && end != null && end >= start) return end - start;
  return null;
}

export function formatHistoryDuration(entry = {}, nowMs = Date.now()) {
  const ms = historyElapsedMs(entry, nowMs);
  if (ms == null) return null;
  return formatHistoryElapsedClock(ms);
}

export function formatSpeedLabel(speed) {
  const s = String(speed || "").trim().toLowerCase();
  if (s === "quality") return "Quality";
  if (s === "fast" || s === "speed") return "Speed";
  return null;
}

export function formatTargetModeLabel(targetMode, baseFilename) {
  const t = String(targetMode || "").trim().toLowerCase();
  if (t === "edit") return "Edit selected";
  if (t === "new") return "New object";
  if (baseFilename) return "Edit selected";
  return "New object";
}

export function formatModelLabel(model, provider) {
  const prov = String(provider || "").trim().toLowerCase();
  if (prov === "deterministic") return null;
  const raw = String(model || "").trim();
  if (!raw) return null;
  const primary = raw.split(",")[0].trim();
  if (!primary) return null;
  const lower = primary.toLowerCase();
  if (MODEL_LABELS[lower]) return MODEL_LABELS[lower];
  if (lower.includes("opus")) {
    const m = lower.match(/opus[- ]?(\d+(?:\.\d+)?)/);
    return m ? `Opus ${m[1]}` : "Opus";
  }
  if (lower.includes("sonnet")) {
    const m = lower.match(/sonnet[- ]?(\d+(?:\.\d+)?)/);
    return m ? `Sonnet ${m[1]}` : "Sonnet";
  }
  if (lower.includes("haiku")) {
    const m = lower.match(/haiku[- ]?(\d+(?:\.\d+)?)/);
    return m ? `Haiku ${m[1]}` : "Haiku";
  }
  if (lower.startsWith("gpt-6-astra-pro")) return "GPT-6 Astra Pro";
  if (lower.startsWith("gpt-6.1-sol")) return "GPT-6.1 Sol";
  if (lower.includes("astra")) return "GPT-6 Astra";
  if (lower.includes("5.5-pro") || lower.includes("5-5-pro")) return "GPT-5.5 Pro";
  if (lower.includes("5.5") || lower.includes("5-5")) return "GPT-5.5";
  if (lower.includes("codex")) return "GPT-5.3 Codex";
  if (lower.startsWith("gpt-")) return primary.replace(/^gpt-/i, "GPT-").replace(/-/g, " ");
  if (lower.startsWith("claude-")) return primary.replace(/^claude-/i, "").replace(/-/g, " ");
  if (lower.startsWith("qwen")) return primary.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return primary;
}

const DOUBLE_PROMPT_QUOTES = new Set(['"', "\u201C", "\u201D"]);
const SINGLE_PROMPT_QUOTES = new Set(["'", "\u2018", "\u2019"]);

function isDoublePromptQuote(ch) {
  return DOUBLE_PROMPT_QUOTES.has(ch);
}

function isSinglePromptQuote(ch) {
  return SINGLE_PROMPT_QUOTES.has(ch);
}

/**
 * Strip wrapping quotation marks from a prompt example.
 * Render Agent markdown quote blocks often wrap the whole prompt in "..." or “...”.
 * Only outer pairs are removed; quotes inside the prompt stay.
 */
export function stripOuterPromptQuotes(value = "") {
  let text = String(value ?? "").trim();
  if (!text) return "";
  let guard = 0;
  while (text.length >= 2 && guard++ < 4) {
    const first = text[0];
    const last = text[text.length - 1];
    const wrapped =
      (isDoublePromptQuote(first) && isDoublePromptQuote(last))
      || (isSinglePromptQuote(first) && isSinglePromptQuote(last));
    if (!wrapped) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

export function formatPromptRef({
  promptId,
  projectId,
  filename,
  traceId,
  mode,
  promptMode,
  model,
  provider,
  skills,
} = {}) {
  if (!promptId) return "";
  const parts = [`@prompt:${promptId}`];
  if (projectId) parts.push(`project:${projectId}`);
  if (filename) parts.push(`file:${filename}`);
  const modeLabel = formatPromptModeLabel(mode ?? promptMode, skills);
  if (modeLabel) parts.push(`mode:${modeLabel}`);
  const modelLabel = formatModelLabel(model, provider);
  if (modelLabel) parts.push(`model:${modelLabel}`);
  if (traceId) parts.push(`trace:${traceId}`);
  return parts.join(" · ");
}

export async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export async function copyPromptRef(entry, projectId) {
  return copyText(
    formatPromptRef({
      promptId: entry?.id,
      projectId,
      filename: entry?.filename,
      traceId: entry?.trace_id,
      promptMode: entry?.prompt_mode,
      model: entry?.model,
      provider: entry?.provider,
      skills: entry?.skills,
    }),
  );
}
