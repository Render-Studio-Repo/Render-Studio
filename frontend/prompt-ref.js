/** Copyable prompt instance references (@prompt:id). */

const MODEL_LABELS = {
  "gpt-5.5": "GPT-5.5",
  "gpt-5.5-pro": "GPT-5.5 Pro",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-4.6-sonnet": "Claude Sonnet 4.6",
  "claude-4.6-opus": "Claude Opus 4.6",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-opus-4-5": "Claude Opus 4.5",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5": "Claude Haiku 4.5",
};

export function formatPromptModeLabel(mode) {
  const m = String(mode || "").trim().toLowerCase();
  if (!m) return null;
  if (m === "v2" || m === "2.0" || m === "2") return "2.0";
  if (m === "draw") return "draw";
  if (m === "standard" || m === "render") return "render";
  return m;
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
  if (lower.includes("5.5-pro") || lower.includes("5-5-pro")) return "GPT-5.5 Pro";
  if (lower.includes("5.5") || lower.includes("5-5")) return "GPT-5.5";
  if (lower.includes("codex")) return "GPT-5.3 Codex";
  if (lower.startsWith("gpt-")) return primary.replace(/^gpt-/i, "GPT-").replace(/-/g, " ");
  if (lower.startsWith("claude-")) return primary.replace(/^claude-/i, "").replace(/-/g, " ");
  return primary;
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
} = {}) {
  if (!promptId) return "";
  const parts = [`@prompt:${promptId}`];
  if (projectId) parts.push(`project:${projectId}`);
  if (filename) parts.push(`file:${filename}`);
  const modeLabel = formatPromptModeLabel(mode ?? promptMode);
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
    }),
  );
}
