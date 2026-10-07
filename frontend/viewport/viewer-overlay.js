/** Bottom-right HUD spinner, ready toast, progress bar, expandable agent checklist, and error banner. */

const LOG_STAGES = [
  { match: /CAD prompt started/i, pct: 5, label: "Starting AI prompt…" },
  { match: /Wiring prompt started/i, pct: 8, label: "Generating wiring schematic…" },
  { match: /OpenAI Responses|Anthropic Messages/i, pct: 12, label: "Calling AI model…" },
  { match: /OpenAI OK|Anthropic OK/i, pct: 38, label: "AI plan received…" },
  { match: /Design attempt 1/i, pct: 28, label: "Planning geometry (attempt 1)…" },
  { match: /Design attempt 2/i, pct: 48, label: "Repairing plan (attempt 2)…" },
  { match: /Design attempt 3/i, pct: 62, label: "Repairing plan (attempt 3)…" },
  { match: /Design attempt 4/i, pct: 72, label: "Repairing plan (attempt 4)…" },
  { match: /Design attempt/i, pct: 32, label: "Planning geometry…" },
  { match: /\[2\.0\].*Quality pipeline/i, pct: 8, label: "Starting CAD quality pipeline…" },
  { match: /\[2\.0\].*Brief missing/i, pct: 22, label: "Regenerating with design brief…" },
  { match: /\[validator\]/i, pct: 44, label: "Validating feature program…" },
  { match: /Design build failed/i, pct: 40, label: "Fixing build errors…" },
  { match: /\[2\.0\].*Inspect gate/i, pct: 82, label: "Inspecting geometry…" },
  { match: /CAD inspect gate passed/i, pct: 90, label: "Geometry inspect passed…" },
  { match: /Deterministic Benchy/i, pct: 68, label: "Building boat geometry…" },
  { match: /Design pipeline/i, pct: 58, label: "Building geometry…" },
  { match: /Build mesh from actions/i, pct: 72, label: "Meshing model…" },
  { match: /Kernel build|Building model/i, pct: 78, label: "Running kernel build…" },
  { match: /Wiring prompt done/i, pct: 94, label: "Schematic ready…" },
  { match: /Design done|CAD prompt done|Kernel build done/i, pct: 96, label: "Almost done…" },
  { match: /authoring-agent|Jake|CAD brief|scripts\/step|scripts\/inspect|scripts\/snapshot/i, pct: 20, label: "CAD authoring agent working…" },
];

const DEFAULT_CHECKLIST = [
  { id: "hardware", label: "McMaster catalog STEPs", status: "pending" },
  { id: "analyze", label: "Analyze prompt & references", status: "pending" },
  { id: "brief", label: "Jake brief", status: "pending" },
  { id: "ai_source", label: "Write / edit build123d source", status: "pending" },
  { id: "step", label: "Run scripts/step (STEP / GLB)", status: "pending" },
  { id: "inspect", label: "Inspect geometry (facts / planes)", status: "pending" },
  { id: "snapshot", label: "Render multi-view snapshot", status: "pending" },
  { id: "snapshot_review", label: "Visual review (fail-closed)", status: "pending" },
  { id: "finalize", label: "Finalize artifacts", status: "pending" },
];

const VIBECAD_CHECKLIST = [
  { id: "hardware", label: "McMaster catalog STEPs", status: "pending" },
  { id: "analyze", label: "Analyze prompt & references", status: "pending" },
  { id: "brief", label: "VibeCAD design review", status: "pending" },
  { id: "ai_source", label: "Author build123d / FreeCAD source", status: "pending" },
  { id: "step", label: "Run VibeCAD worker (STEP / GLB)", status: "pending" },
  { id: "inspect", label: "Validate named solids", status: "pending" },
  { id: "snapshot", label: "Publish viewport model", status: "pending" },
  { id: "snapshot_review", label: "Repair if worker failed", status: "pending" },
  { id: "finalize", label: "Finalize artifacts", status: "pending" },
];

const MESH_CHECKLIST = [
  { id: "analyze", label: "Analyze image & admission", status: "pending" },
  { id: "spec", label: "Sculpt spec / strict-quality", status: "pending" },
  { id: "generate", label: "Forge pass (factory)", status: "pending" },
  { id: "export", label: "Export GLB", status: "pending" },
  { id: "snapshot", label: "Playwright factory views", status: "pending" },
  { id: "review", label: "Vision review vs reference", status: "pending" },
  { id: "finalize", label: "Finalize viewport model", status: "pending" },
];

/** Opening a project — never CAD / McMaster / cost. */
const LOAD_CHECKLIST = [
  { id: "fetch", label: "Fetching model", status: "active" },
  { id: "paint", label: "Show in viewport", status: "pending" },
];

/** Kernel / ribbon solid builds — not AI generate. */
const BUILD_CHECKLIST = [
  { id: "validate", label: "Validate feature program", status: "pending" },
  { id: "kernel", label: "Run CAD kernel (OCCT)", status: "active" },
  { id: "mesh", label: "Mesh solid → GLB", status: "pending" },
  { id: "load", label: "Load into viewport", status: "pending" },
];

/** Wiring Simulator — never CAD / McMaster hardware notes. */
const WIRING_CHECKLIST = [
  { id: "analyze", label: "Read circuit prompt", status: "pending" },
  { id: "ai_source", label: "Call AI model", status: "pending" },
  { id: "schematic", label: "Build schematic", status: "pending" },
  { id: "finalize", label: "Place on board", status: "pending" },
];

/** Photoreal Render tab — never CAD / McMaster hardware notes. */
const RENDER_CHECKLIST = [
  { id: "prepare", label: "Prepare photoreal render", status: "pending" },
  { id: "capture", label: "Capture viewport geometry", status: "pending" },
  { id: "scene", label: "Generate photoreal image", status: "pending" },
  { id: "finalize", label: "Save render", status: "pending" },
];

function isLoadOverlay(opts = {}) {
  const kind = String(opts.kind || "").toLowerCase();
  const mode = String(opts.mode || "").toLowerCase();
  return kind === "project_load" || mode === "load";
}

function isBuildOverlay(opts = {}) {
  const values = [
    opts.mode,
    opts.kind,
    opts.message,
  ];
  return values.some((value) => /\bbuild(?:ing)?\b|\bkernel\b|\bribbon\b/i.test(String(value || "")));
}

const STAGE_ALIASES = {
  analyze: "analyze",
  plan: "analyze",
  hardware: "hardware",
  mcmaster: "hardware",
  build: "step",
  brief: "brief",
  ai_source: "ai_source",
  generate: "ai_source",
  authoring: "ai_source",
  repair: "ai_source",
  step: "step",
  export: "step",
  inspect: "inspect",
  "inspect-quality": "inspect",
  snapshot: "snapshot",
  snapshot_review: "snapshot_review",
  review: "snapshot_review",
  finalize: "finalize",
  done: "finalize",
};

function isRawToolLog(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  return (
    /\/bin\/bash|sed -n|command_execution|shell_call|tool_call|\$\s*\/|python3? -|node |npm |codex\/plugins|skills\/cad\/references/i.test(t)
    || (/\/home\/|\/tmp\/|\.codex\//i.test(t) && t.length > 80)
    || (t.length > 180 && /&&|scripts\//i.test(t))
  );
}

function humanizeProgressText(text, fallback = "Working…") {
  const t = String(text || "").trim();
  if (!t) return fallback;
  if (!isRawToolLog(t)) return t.length > 96 ? `${t.slice(0, 93)}…` : t;
  if (/snapshot_review|visual review/i.test(t)) return "Reviewing multi-view snapshot…";
  if (/snapshot/i.test(t)) return "Rendering multi-view snapshot…";
  if (/inspect/i.test(t)) return "Inspecting geometry…";
  if (/modeling\.md|references\/|repair-loop/i.test(t)) return "Reading CAD references…";
  if (/scripts\/step|\.step\b|tessellat/i.test(t)) return "Building STEP / GLB…";
  if (/mcmaster|catalog step/i.test(t)) return "Fetching McMaster catalog STEPs…";
  if (/brief/i.test(t)) return "Writing CAD brief…";
  if (/build123d|\.py\b|ai_source|source/i.test(t)) return "Editing CAD source…";
  if (/finalize|export/i.test(t)) return "Finalizing artifacts…";
  if (/analyze|prompt/i.test(t)) return "Analyzing prompt…";
  return "Running CAD tools…";
}

function resolveStageAlias(stage, template = DEFAULT_CHECKLIST) {
  const raw = String(stage || "").trim().toLowerCase();
  let normalized = STAGE_ALIASES[raw] || "";
  const ids = (template?.length ? template : DEFAULT_CHECKLIST).map((item) => item.id);
  if (normalized && ids.includes(normalized)) return normalized;
  if (raw === "generate" && ids.includes("generate")) return "generate";
  if ((raw === "export" || raw === "build") && ids.includes("export")) return "export";
  if ((raw === "review" || raw === "snapshot_review") && ids.includes("review")) return "review";
  if (normalized && !ids.includes(normalized)) return "";
  return normalized;
}

function checklistFromStage(stage, currentLabel = "", template = DEFAULT_CHECKLIST) {
  const source = template?.length ? template : DEFAULT_CHECKLIST;
  const normalized = resolveStageAlias(stage, source);
  const ids = source.map((item) => item.id);
  const activeIdx = ids.indexOf(normalized);
  return source.map((item, i) => {
    let status = "pending";
    if (activeIdx >= 0) {
      if (i < activeIdx) status = "done";
      else if (i === activeIdx) status = "active";
    }
    const entry = { id: item.id, label: item.label, status };
    if (status === "active" && currentLabel) {
      entry.detail = humanizeProgressText(currentLabel, item.label);
    }
    return entry;
  });
}

function stepStats(items) {
  const list = items?.length ? items : DEFAULT_CHECKLIST;
  const total = list.length || 8;
  let activeIdx = list.findIndex((item) => item.status === "active");
  if (activeIdx < 0) {
    const doneCount = list.filter((item) => item.status === "done").length;
    activeIdx = Math.min(Math.max(doneCount - 1, 0), total - 1);
    if (doneCount === 0) activeIdx = 0;
    if (doneCount >= total) activeIdx = total - 1;
  }
  const active = list[activeIdx] || list[0] || {};
  return {
    current: activeIdx + 1,
    total,
    activeIdx,
    label: humanizeProgressText(active.label || "Working…"),
    detail: humanizeProgressText(active.detail || "", ""),
  };
}

function isRepairLoop(checklist, peakIdx) {
  if (peakIdx < 0) return false;
  const stats = stepStats(checklist);
  return stats.activeIdx < peakIdx;
}

/** Display stats that only count forward — repairs keep the peak step number. */
function displayStepStats(checklist, peakIdx) {
  const stats = stepStats(checklist);
  const repair = isRepairLoop(checklist, peakIdx);
  const displayIdx = repair ? peakIdx : stats.activeIdx;
  const detail = repair
    ? humanizeProgressText(stats.detail || stats.label || "", "Revising model…")
    : stats.detail;
  return {
    ...stats,
    activeIdx: displayIdx,
    current: displayIdx + 1,
    repair,
    label: repair ? "Revising model" : stats.label,
    detail: repair ? (detail && detail !== stats.label ? detail : "Revising model…") : detail,
  };
}

/** Freeze the checklist at the farthest step reached; show revisiting as revising, not a rewind. */
function checklistForDisplay(items, peakIdx) {
  const list = items?.length ? items : DEFAULT_CHECKLIST;
  if (!isRepairLoop(list, peakIdx)) return list;
  return list.map((item, index) => {
    if (index < peakIdx) {
      return { ...item, status: "done", detail: "" };
    }
    if (index === peakIdx) {
      return {
        ...item,
        status: "active",
        detail: "Revising model…",
      };
    }
    return { ...item, status: "pending", detail: "" };
  });
}

function formatStepCounter(stats, { repair = false } = {}) {
  return `${stats.current}/${stats.total}`;
}

const TURN_RE = /\bturn\s+(\d+)\s*\/\s*(\d+)/i;

/** HUD counter: agent turn when present, otherwise the current phase — never a competing 3/8. */
export function formatMeterCounter(stats, { label = "", counter = "", repair = false } = {}) {
  const explicit = String(counter || "").trim();
  if (explicit) return explicit;
  const blob = [label, stats?.detail, stats?.label].filter(Boolean).join(" ");
  const match = blob.match(TURN_RE);
  if (match) return `Turn ${Number(match[1])}/${Number(match[2])}`;
  if (repair) return "Revising";
  const phase = String(stats?.label || "Working").replace(/\s+/g, " ").trim();
  return phase.length > 28 ? `${phase.slice(0, 26)}…` : phase;
}

/**
 * Bar % matches the project-list CAD badge (`generation.progress.pct`).
 * The left counter is a phase / turn meter, not a 3/8 fraction of the bar.
 */
export function pctFromChecklist(stats, progressValue) {
  const raw = Number(progressValue);
  if (Number.isFinite(raw)) {
    return Math.max(0, Math.min(100, Math.round(raw)));
  }
  const total = Math.max(1, Number(stats?.total) || 8);
  const current = Math.min(Math.max(Number(stats?.current) || 1, 1), total);
  const mid = Math.round(((current - 0.5) / total) * 100);
  return Math.max(0, Math.min(current >= total ? 100 : 99, mid));
}

/** Fallback when job metadata omits wand version (matches img2threejs SKILL.md). */
export const IMG2THREEJS_WAND_VERSION = "2.0.0";

function overlayHarnessJob(opts = {}) {
  if (opts.job && typeof opts.job === "object") return opts.job;
  return (Array.isArray(opts.jobs) ? opts.jobs[0] : null) || {};
}

function overlayHarnessTextBlob(opts = {}) {
  const progress = opts.progress && typeof opts.progress === "object" ? opts.progress : {};
  const items = Array.isArray(opts.checklist) ? opts.checklist : (progress.checklist || []);
  return [
    opts.message,
    opts.label,
    progress.label,
    progress.thinking,
    ...items.map((item) => (typeof item === "string" ? item : item?.label)),
  ].filter(Boolean).join(" ");
}

function overlayHarnessTokens(opts = {}) {
  const progress = opts.progress && typeof opts.progress === "object" ? opts.progress : {};
  const job = overlayHarnessJob(opts);
  const generator = opts.generator && typeof opts.generator === "object" ? opts.generator : {};
  return [
    opts.harness,
    progress.harness,
    job.harness,
    generator.harness,
    opts.cadEngine,
    opts.engine,
    progress.engine,
    job.engine,
    opts.pipeline,
    progress.pipeline,
    job.pipeline,
    opts.promptMode,
    opts.prompt_mode,
    opts.generationMode,
    opts.generation_mode,
    opts.mode,
    opts.meshEngine,
    job.mode,
    job.prompt_mode,
    job.promptMode,
    opts.kind,
    opts.variant,
    opts.wand,
    progress.wand,
    progress.skill,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}

function overlayHarnessIsMesh(opts = {}) {
  const tokens = overlayHarnessTokens(opts);
  if (tokens.some((value) => /^(mesh|mesh_beta|mesh-beta|fusion|img2threejs|threejs)$/.test(value))) {
    return true;
  }
  const message = String(opts.message || opts.progress?.label || "").toLowerCase();
  return /\bmesh(?:[_-]?beta)?\b|img2threejs/.test(message);
}

function overlayHarnessIsSkipped(opts = {}) {
  const tokens = overlayHarnessTokens(opts);
  return tokens.some((value) => /^(render|rigging|wiring|build|improve_lab)$/.test(value));
}

function overlayHasCodexHost(opts = {}) {
  const job = overlayHarnessJob(opts);
  if (job.codex_agent || opts.codex_agent) return true;
  return /\bcodex\b/i.test(overlayHarnessTextBlob(opts));
}

function cadHarnessDisplayName(opts = {}) {
  const progress = opts.progress && typeof opts.progress === "object" ? opts.progress : {};
  const job = overlayHarnessJob(opts);
  const preferred = [
    opts.harness,
    progress.harness,
    job.harness,
    opts.promptMode,
    opts.prompt_mode,
    job.mode,
    job.prompt_mode,
    opts.cadEngine,
    opts.pipeline,
    progress.pipeline,
    job.pipeline,
    opts.engine,
    progress.engine,
    job.engine,
    ...overlayHarnessTokens(opts),
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);

  for (const token of preferred) {
    if (token === "vibecad" || token === "vibe" || token === "vibecade") return "VibeCAD";
    if (token === "mac" || token === "macad" || token === "multi_agent_cad" || token === "multiagentcad") {
      return "MAC";
    }
    if (token === "architect") return "Architect";
    if (token === "jake" || token === "v2" || token === "cad" || token === "2" || token === "prompt") {
      return "Jake";
    }
    if (token === "cad 2.0" || token === "cad2.0" || token === "2.0") return "CAD 2.0";
    if (token === "freecad") return "FreeCAD";
  }
  const blob = overlayHarnessTextBlob(opts);
  if (/\bvibecad\b/i.test(blob)) return "VibeCAD";
  if (/\bmac\b|multi-?agent cad/i.test(blob)) return "MAC";
  if (/jake brief|scripts\/step|build123d|text-to-cad|\bcodex\b/i.test(blob)) return "Jake";
  return "";
}

/** Canvas generate HUD: CAD plus painting, meaning canvas sketch + CAD. */
export const CANVAS_GENERATE_CHIP = "CAD 🎨";
export const CANVAS_MESH_GENERATE_CHIP = "MESH 🎨";

const CANVAS_REF_RE = /canvas[-_\s]?(?:sketch|draw)|whiteboard|layout[-_\s]?sketch|(?:^|[\/\\])Canvas[\/\\]|^Canvas(?:[ -]|$)/i;

/** True when this generate used a canvas board, @canvas tags, or canvas attachments. */
export function generationUsedCanvas(source = {}) {
  if (!source || typeof source !== "object") return false;
  if (source.usedCanvas === true || source.from_canvas === true || source.canvas === true) return true;
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  if (meta.usedCanvas === true || meta.from_canvas === true || meta.canvas === true || meta.canvas_attached === true) {
    return true;
  }
  const body = source.request_body && typeof source.request_body === "object" ? source.request_body : {};
  if (body.usedCanvas === true || body.from_canvas === true) return true;
  if (source.canvas_board || meta.canvas_board || body.canvas_board) return true;
  const images = []
    .concat(source.images || [], meta.images || [], source.prompt_images || [], meta.prompt_images || [], body.images || [])
    .filter(Boolean);
  for (const img of images) {
    if (!img || typeof img !== "object") continue;
    if (img.role === "canvas" || img.drawing_metadata?.kind === "canvas") return true;
    const names = [img.name, img.source_filename, img.filename, img.url, img.folder];
    if (names.some((name) => CANVAS_REF_RE.test(String(name || "")))) return true;
  }
  const prompt = String(source.prompt || meta.prompt || source.summary || "").trim();
  return /\bCanvas\//.test(prompt) || /@canvas\b/i.test(prompt);
}

export function canvasGenerateChip(opts = {}) {
  const mode = String(opts.promptMode || opts.mode || opts.kind || "").toLowerCase();
  if (overlayHarnessIsMesh(opts) || ["mesh", "mesh_beta", "fusion"].includes(mode)) {
    return CANVAS_MESH_GENERATE_CHIP;
  }
  if (mode === "render" || mode === "scene_render") return "RENDER 🎨";
  if (mode === "rigging" || mode === "rig") return "RIG 🎨";
  return CANVAS_GENERATE_CHIP;
}

/**
 * Expanded generate HUD first line (hidden on the retracted capsule).
 * CAD: `Harness: Jake` / `Harness: Jake · Codex` / `Harness: VibeCAD`.
 * Mesh: `Mesh wand: img2threejs 2.0.0` (+ ` · Beta` for mesh_beta).
 */
export function formatOverlayHarnessLine(opts = {}) {
  if (opts.canvas || opts.usedCanvas || generationUsedCanvas(opts)) return canvasGenerateChip(opts);
  if (overlayHarnessIsMesh(opts)) {
    const progress = opts.progress && typeof opts.progress === "object" ? opts.progress : {};
    const job = overlayHarnessJob(opts);
    const wandRaw = String(
      progress.wand || progress.skill || opts.wand || job.wand || "img2threejs",
    ).trim() || "img2threejs";
    const wand = /img2threejs|three\.?js/i.test(wandRaw) ? "img2threejs" : wandRaw;
    const version = String(
      progress.wand_version
      || progress.skill_version
      || opts.wand_version
      || job.wand_version
      || IMG2THREEJS_WAND_VERSION,
    ).trim().replace(/^v/i, "");
    const tokens = overlayHarnessTokens(opts);
    const beta = tokens.some((value) => (
      value === "mesh_beta"
      || value === "mesh-beta"
      || value === "beta"
    ));
    const versionBit = version ? ` ${version}` : "";
    const betaBit = beta ? " · Beta" : "";
    return `Mesh wand: ${wand}${versionBit}${betaBit}`;
  }
  if (overlayHarnessIsSkipped(opts)) return "";
  const cadName = cadHarnessDisplayName(opts);
  const name = cadName || (opts.assumeCad ? "Jake" : "");
  if (!name) return "";
  if (name === "Jake" && overlayHasCodexHost(opts)) return "Harness: Jake · Codex";
  return `Harness: ${name}`;
}

/** Compact generate pill — just the harness / wand name, not the `Harness:` prefix. */
export function formatOverlayHarnessChip(opts = {}) {
  if (opts.canvas || opts.usedCanvas || generationUsedCanvas(opts)) return canvasGenerateChip(opts);
  const line = formatOverlayHarnessLine(opts);
  if (!line) return "";
  return line.replace(/^Harness:\s*/i, "").replace(/^Mesh wand:\s*/i, "Mesh ");
}

/** Compact clock for the expanded generate HUD, e.g. `12s`, `4m 12s`, `1h 03m`. */
export function formatElapsedClock(ms) {
  const sec = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function startMsFromOpts(opts = {}) {
  const jobs = Array.isArray(opts.jobs) ? opts.jobs : (opts.job ? [opts.job] : []);
  const candidates = [
    opts.startedAt,
    opts.started_at,
    opts.progress?.started_at,
    jobs.find((job) => job?.started_at)?.started_at,
    opts.generator?.started_at,
  ];
  for (const raw of candidates) {
    if (raw == null || raw === "") continue;
    const parsed = typeof raw === "number" ? raw : Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function formatProgressHeadline(stats, detailText, { repair = false, counter = "" } = {}) {
  const meter = formatMeterCounter(stats, { label: detailText, counter, repair });
  if (repair) {
    return `${meter} · Revising model`;
  }
  const detail = humanizeProgressText(detailText, stats.label);
  if (!meter) return detail;
  if (meter.startsWith("Turn ") && TURN_RE.test(detail)) return detail;
  if (detail.toLowerCase().includes(meter.toLowerCase())) return detail;
  return `${meter} · ${detail}`;
}

function formatOverlayCostUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function overlayTokenTotal(usage) {
  if (!usage || typeof usage !== "object") return 0;
  return Number(usage.total_tokens)
    || (Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0))
    || Number(usage.tokens)
    || 0;
}

function compactOverlayTokens(value) {
  const total = Number(value) || 0;
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(2)}M tokens`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k tokens`;
  return `${Math.round(total)} tokens`;
}

function shortOverlayModel(model) {
  const raw = String(model || "").trim();
  if (!raw) return "";
  const cleaned = raw
    .replace(/^openai\//i, "")
    .replace(/^anthropic\//i, "")
    .replace(/^models\//i, "")
    .split(",")[0]
    .trim();
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  const KNOWN = {
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
    "gpt-6-astra": "GPT-6 Astra",
    "gpt-6-astra-pro": "GPT-6 Astra Pro",
    "gpt-6.1-sol": "GPT-6.1 Sol",
    "gpt-5.5": "GPT-5.5",
    "gpt-5.5-pro": "GPT-5.5 Pro",
    "gpt-5.3-codex": "Codex",
    "gpt-5.6-sol": "GPT-5.6 Sol",
    "gpt-5.6-terra": "GPT-5.6 Terra",
    "gpt-5.6-luna": "GPT-5.6 Luna",
    "kimi-k2.6": "Kimi K2.6",
    "kimi-k2.5": "Kimi K2.5",
    "kimi-k3": "Kimi K3 (V3)",
    "grok-4.5": "Grok 4.5",
    "gemini-3.8-flash": "Gemini 3.8 Flash",
  };
  if (KNOWN[lower]) return KNOWN[lower];
  // Drop provider prefixes so "claude-fable-5" → "Fable 5", not "claude-fa…"
  let name = cleaned
    .replace(/^claude[-_]?/i, "")
    .replace(/^openai[-_]?/i, "")
    .replace(/^anthropic[-_]?/i, "")
    .replace(/^gpt[-_]?/i, "GPT-");
  if (/^fable/i.test(name)) {
    const m = name.match(/fable[-_ ]?(\d+)(?:[-_.](\d+))?/i);
    return m ? `Fable ${m[2] ? `${m[1]}.${m[2]}` : m[1]}` : "Fable";
  }
  if (/opus/i.test(name)) {
    const m = name.match(/opus[-_ ]?(\d+(?:\.\d+)?)/i);
    return m ? `Opus ${m[1]}` : "Opus";
  }
  if (/sonnet/i.test(name)) {
    const m = name.match(/sonnet[-_ ]?(\d+(?:\.\d+)?)/i);
    return m ? `Sonnet ${m[1]}` : "Sonnet";
  }
  if (/haiku/i.test(name)) {
    const m = name.match(/haiku[-_ ]?(\d+(?:\.\d+)?)/i);
    return m ? `Haiku ${m[1]}` : "Haiku";
  }
  name = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  // Title-case short tokens
  return name.replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
}

function usageFromJob(job) {
  if (!job || typeof job !== "object") return null;
  const usage = job.usage || job.meta?.usage || job.progress?.usage || null;
  const cost = job.cost_usd ?? job.meta?.cost_usd ?? job.progress?.cost_usd ?? null;
  const model = job.model || job.meta?.model || job.provider_model || job.progress?.model || "";
  const tokens = overlayTokenTotal(usage);
  const costNum = cost != null && Number.isFinite(Number(cost)) ? Number(cost) : null;
  if (!tokens && (costNum == null || costNum <= 0) && !model) return null;
  return {
    cost_usd: costNum,
    usage: usage || { total_tokens: tokens },
    model: shortOverlayModel(model),
    ai_calls: Number(job.ai_calls || job.meta?.ai_calls || job.progress?.ai_calls || 0) || 0,
  };
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const READY_BANNER_CSS = "/viewport/viewport-ready-banner.css?v=20260908-layout";
const GEN_LOADER_CSS = "/viewport/viewport-gen-loader.css?v=20260909-sharefast1-gencost2-canvasload1-mcmcad1-partelect1-genheadtime1";
function ensureOverlayStylesheet(href, dataAttr) {
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[${dataAttr}="1"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute(dataAttr, "1");
  document.head.appendChild(link);
}
function ensureReadyBannerStyles() {
  ensureOverlayStylesheet(READY_BANNER_CSS, "data-viewport-ready-banner");
  ensureOverlayStylesheet(GEN_LOADER_CSS, "data-viewport-gen-loader");
}

export function createViewerOverlay(viewportEl, { fetchLogs, onStopGeneration, getCopyContext } = {}) {
  ensureReadyBannerStyles();
  if (!viewportEl) {
    return {
      setGenerating() {},
      isGenerating() {
        return false;
      },
      updateProgress() {},
      setStopVisible() {},
      showError() {},
      clearError() {},
      showReadyBanner() {},
      clearReadyBanner() {},
      dismiss() {},
      syncHost() {},
    };
  }

  const root = document.createElement("div");
  root.className = "viewport-overlay-root";
  root.setAttribute("aria-live", "polite");

  const spinner = document.createElement("div");
  spinner.className = "viewport-spinner hidden";
  spinner.setAttribute("role", "status");
  spinner.innerHTML = `
    <div class="viewport-spinner-visual" aria-hidden="true">
      <div class="viewport-spinner-ring"></div>
      <div class="viewport-spinner-v2">
        <div class="v2-orbit v2-orbit--outer"></div>
        <div class="v2-orbit v2-orbit--inner"></div>
        <span class="v2-orbit-badge">CAD</span>
      </div>
      <div class="viewport-spinner-fusion">
        <div class="fusion-loader-ring"></div>
        <div class="fusion-loader-core">F</div>
        <span class="fusion-loader-drop fusion-loader-drop--a"></span>
        <span class="fusion-loader-drop fusion-loader-drop--b"></span>
        <span class="fusion-loader-drop fusion-loader-drop--c"></span>
      </div>
      <div class="viewport-gen-stage">
        <div class="viewport-gen-printer">
          <div class="vgp-gantry"></div>
          <div class="vgp-rail vgp-rail--l"></div>
          <div class="vgp-rail vgp-rail--r"></div>
          <div class="vgp-nozzle"></div>
          <div class="vgp-part"></div>
          <div class="vgp-bed"></div>
        </div>
        <div class="viewport-gen-robot vgr-idle">
          <div class="vgr-arm"></div>
          <div class="vgr-head"></div>
          <div class="vgr-body"></div>
          <div class="vgr-base"></div>
        </div>
      </div>
      <div class="viewport-spinner-lab-gear" title="Improve Lab"></div>
    </div>
    <div class="viewport-spinner-body">
      <div class="viewport-spinner-harness" hidden></div>
      <div class="viewport-spinner-who" hidden>
        <span class="viewport-spinner-provider" hidden aria-hidden="true"></span>
        <span class="viewport-spinner-who-avatar" aria-hidden="true"></span>
        <span class="viewport-spinner-who-name"></span>
        <span class="viewport-spinner-who-pct" hidden></span>
      </div>
      <div class="viewport-spinner-head">
        <p class="viewport-spinner-label">Working…</p>
        <div class="viewport-spinner-head-status" aria-live="off">
          <span class="viewport-spinner-head-pct">0%</span>
          <span class="viewport-spinner-head-elapsed">0s</span>
        </div>
        <button type="button" class="viewport-spinner-expand" aria-expanded="false" title="Show steps" aria-label="Show steps">Details</button>
      </div>
      <div class="viewport-progress">
        <div class="viewport-progress-track" aria-hidden="true">
          <div class="viewport-progress-fill"></div>
        </div>
        <div class="viewport-progress-meta">
          <span class="viewport-progress-step">Starting</span>
          <button type="button" class="viewport-spinner-mcmaster" hidden aria-expanded="false" title="Show McMaster-Carr parts being added">
            McMaster <span class="viewport-spinner-mcmaster-count">0</span>
          </button>
          <button type="button" class="viewport-spinner-electronics" hidden aria-expanded="false" title="Show electronics grabbed for this CAD build">
            Electronics <span class="viewport-spinner-electronics-count">0</span>
          </button>
          <span class="viewport-spinner-model-chip" hidden></span>
          <button type="button" class="viewport-spinner-thinking" hidden aria-expanded="false" aria-pressed="false" title="Show the model’s thinking">
            Thinking
          </button>
          <span class="viewport-progress-eta" hidden></span>
          <span class="viewport-progress-pct">0%</span>
          <span class="viewport-progress-cost-chip" hidden>$0.00</span>
        </div>
      </div>
      <div class="viewport-gen-jobs hidden" hidden aria-label="Active generations"></div>
      <div class="viewport-spinner-details hidden" hidden>
        <div class="viewport-mcmaster-panel hidden" hidden>
          <div class="viewport-agent-section-title">McMaster-Carr · live parts</div>
          <p class="viewport-mcmaster-empty muted">No catalog parts listed yet.</p>
          <ul class="viewport-mcmaster-list"></ul>
        </div>
        <div class="viewport-electronics-panel hidden" hidden>
          <div class="viewport-agent-section-title">Electronics · grabbed</div>
          <p class="viewport-electronics-empty muted">No electronics listed yet.</p>
          <ul class="viewport-electronics-list"></ul>
        </div>
        <div class="viewport-agent-thinking" hidden>
          <div class="viewport-agent-thinking-label">Thinking</div>
          <p class="viewport-agent-thinking-text">Waiting for AI…</p>
          <pre class="viewport-agent-thinking-log" hidden></pre>
        </div>
        <div class="viewport-agent-prompt-wrap hidden" hidden>
          <div class="viewport-agent-prompt-head">
            <div class="viewport-agent-section-title">Improved prompt</div>
            <button type="button" class="viewport-agent-prompt-toggle" hidden aria-expanded="false">Expand</button>
          </div>
          <pre class="viewport-agent-prompt-text"></pre>
        </div>
        <div class="viewport-agent-costing" hidden>
          <div class="viewport-agent-section-title">Cost</div>
          <p class="viewport-agent-costing-line">Costing <strong class="viewport-agent-costing-amount">$0.00</strong> <span class="viewport-agent-costing-tokens">· 0 tokens</span></p>
        </div>
        <div class="viewport-agent-checklist-wrap">
          <div class="viewport-agent-section-title">Pipeline</div>
          <ul class="viewport-agent-checklist"></ul>
        </div>
        <div class="viewport-agent-activity-wrap">
          <div class="viewport-agent-section-title">Updates</div>
          <ul class="viewport-agent-activity"></ul>
        </div>
      </div>
      <div class="viewport-spinner-footer">
        <div class="viewport-progress-usage" hidden aria-live="polite">
          <span class="viewport-progress-usage-pulse" aria-hidden="true"></span>
          <span class="viewport-progress-usage-cost">$0.00</span>
          <span class="viewport-progress-usage-sep" aria-hidden="true">·</span>
          <span class="viewport-progress-usage-tokens">0 tokens</span>
          <span class="viewport-progress-usage-model" hidden></span>
        </div>
        <button type="button" class="btn danger viewport-stop-btn hidden" aria-label="Stop generating">Stop generating</button>
      </div>
    </div>
  `;
  const spinnerLabel = spinner.querySelector(".viewport-spinner-label");
  const stopBtn = spinner.querySelector(".viewport-stop-btn");
  const progressFill = spinner.querySelector(".viewport-progress-fill");
  const progressPct = spinner.querySelector(".viewport-progress-pct");
  const headProgressPct = spinner.querySelector(".viewport-spinner-head-pct");
  const headElapsed = spinner.querySelector(".viewport-spinner-head-elapsed");
  const progressCostChip = spinner.querySelector(".viewport-progress-cost-chip");
  const costingEl = spinner.querySelector(".viewport-agent-costing");
  const costingAmountEl = spinner.querySelector(".viewport-agent-costing-amount");
  const costingTokensEl = spinner.querySelector(".viewport-agent-costing-tokens");
  const progressStep = spinner.querySelector(".viewport-progress-step");
  const progressEta = spinner.querySelector(".viewport-progress-eta");
  const progressUsage = spinner.querySelector(".viewport-progress-usage");
  const progressUsageCost = spinner.querySelector(".viewport-progress-usage-cost");
  const progressUsageTokens = spinner.querySelector(".viewport-progress-usage-tokens");
  const progressUsageModel = spinner.querySelector(".viewport-progress-usage-model");
  const expandBtn = spinner.querySelector(".viewport-spinner-expand");
  const mcmasterBtn = spinner.querySelector(".viewport-spinner-mcmaster");
  const electronicsBtn = spinner.querySelector(".viewport-spinner-electronics");
  const modelChipEl = spinner.querySelector(".viewport-spinner-model-chip");
  const mcmasterCountEl = spinner.querySelector(".viewport-spinner-mcmaster-count");
  const electronicsCountEl = spinner.querySelector(".viewport-spinner-electronics-count");
  const mcmasterPanel = spinner.querySelector(".viewport-mcmaster-panel");
  const electronicsPanel = spinner.querySelector(".viewport-electronics-panel");
  const mcmasterList = spinner.querySelector(".viewport-mcmaster-list");
  const electronicsList = spinner.querySelector(".viewport-electronics-list");
  const mcmasterEmpty = spinner.querySelector(".viewport-mcmaster-empty");
  const electronicsEmpty = spinner.querySelector(".viewport-electronics-empty");
  const thinkingBtn = spinner.querySelector(".viewport-spinner-thinking");
  const thinkingLogEl = spinner.querySelector(".viewport-agent-thinking-log");
  const detailsEl = spinner.querySelector(".viewport-spinner-details");
  const jobsEl = spinner.querySelector(".viewport-gen-jobs");
  const thinkingText = spinner.querySelector(".viewport-agent-thinking-text");
  const thinkingLabelEl = spinner.querySelector(".viewport-agent-thinking-label");
  const promptWrap = spinner.querySelector(".viewport-agent-prompt-wrap");
  const promptTextEl = spinner.querySelector(".viewport-agent-prompt-text");
  const promptToggleBtn = spinner.querySelector(".viewport-agent-prompt-toggle");
  const checklistEl = spinner.querySelector(".viewport-agent-checklist");
  const activityEl = spinner.querySelector(".viewport-agent-activity");
  const whoEl = spinner.querySelector(".viewport-spinner-who");
  const whoAvatarEl = spinner.querySelector(".viewport-spinner-who-avatar");
  const whoNameEl = spinner.querySelector(".viewport-spinner-who-name");
  const whoProviderEl = spinner.querySelector(".viewport-spinner-provider");
  const whoPctEl = spinner.querySelector(".viewport-spinner-who-pct");
  const harnessEl = spinner.querySelector(".viewport-spinner-harness");
  let generatorInfo = null;
  let harnessMeta = {};

  function classifyProviderMark(raw) {
    const blob = String(raw || "").toLowerCase();
    if (!blob.trim()) return null;
    if (/gpt-6-astra-pro/.test(blob)) {
      return { id: "openai", label: "Astra Pro", color: "#10A37F" };
    }
    if (/gpt-6\.1-sol/.test(blob)) {
      return { id: "openai", label: "GPT-6.1 Sol", color: "#10A37F" };
    }
    if (/gpt-6-astra|\bastra\b/.test(blob)) {
      return { id: "openai", label: "Astra", color: "#10A37F" };
    }
    if (/anthropic|claude|sonnet|opus|haiku|fable/.test(blob)) {
      return { id: "anthropic", label: "Claude", color: "#D97757" };
    }
    if (/openai|gpt-|o1|o3|o4|chatgpt|codex/.test(blob)) {
      return { id: "openai", label: "OpenAI", color: "#10A37F" };
    }
    if (/google|gemini/.test(blob)) {
      return { id: "google", label: "Gemini", color: "#4285F4" };
    }
    if (/kernel|build123d|occt|freecad|ribbon/.test(blob)) {
      return { id: "kernel", label: "CAD Kernel", color: "#58A6FF" };
    }
    return null;
  }

  function detectProviderMarks(info = {}) {
    // Brand the HUD from the clicked model only. Never usage traces, leftover
    // Improve calls, engine names, or the live key picker.
    const mark = classifyProviderMark(info.model || info.model_id || info.model_quality)
      || classifyProviderMark(info.provider);
    if (mark) return [mark];
    if (isBuildOverlay(info)) {
      return [{ id: "kernel", label: "CAD Kernel", color: "#58A6FF" }];
    }
    return [];
  }

  function providerLogoSvg(id, color) {
    if (id === "anthropic") {
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="${color}" d="M13.827 3.52h3.603L24 20.48h-3.603l-1.674-3.617H8.456l-1.674 3.617H3.18L10.397 3.52h3.43zm.635 3.146-3.03 6.55h6.06l-3.03-6.55z"/></svg>`;
    }
    if (id === "openai") {
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="${color}" d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .516 4.91 6.051 6.051 0 0 0 6.511 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.76a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.625 18.24a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.373v2.332a.08.08 0 0 1-.033.062L9.74 19.948a4.5 4.5 0 0 1-6.115-1.708zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.755-5.833-3.387L15.119 7.1a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.775-2.782a.776.776 0 0 0-.785 0L9.409 9.13V6.803a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.35-1.538 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`;
    }
    if (id === "google") {
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M12 11.5v2.9h6.9c-.3 1.6-1.9 4.7-6.9 4.7-4.2 0-7.6-3.4-7.6-7.6S7.8 4 12 4c2.4 0 4 .9 4.9 1.8l2-2C17.3 2.2 14.9 1 12 1 6.5 1 2 5.5 2 11s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="${color || "#58A6FF"}" d="M4 6h16v2H4V6zm2 4h12v8H6v-8zm2 2v4h8v-4H8z"/></svg>`;
  }

  const readyBanner = document.createElement("div");
  readyBanner.className = "viewport-ready-banner hidden";
  readyBanner.setAttribute("role", "status");
  readyBanner.setAttribute("aria-live", "polite");
  readyBanner.innerHTML = `
    <span class="viewport-ready-dot" aria-hidden="true"></span>
    <span class="viewport-ready-text"></span>
    <button type="button" class="viewport-ready-close" aria-label="Dismiss">×</button>
  `;
  const readyText = readyBanner.querySelector(".viewport-ready-text");
  const readyClose = readyBanner.querySelector(".viewport-ready-close");
  let readyHideTimer = null;
  let readyFadeTimer = null;

  const hudStack = document.createElement("div");
  hudStack.className = "viewport-hud-stack";
  hudStack.append(readyBanner);

  const banner = document.createElement("div");
  banner.className = "viewport-error-banner hidden";
  banner.setAttribute("role", "button");
  banner.setAttribute("tabindex", "0");
  banner.setAttribute("aria-label", "Error — click to copy");
  banner.innerHTML = `
    <button type="button" class="viewport-error-close" aria-label="Close error message">×</button>
    <span class="viewport-error-text"></span>
    <ul class="viewport-error-suggest hidden"></ul>
    <span class="viewport-error-hint">Click to copy</span>
  `;
  const bannerText = banner.querySelector(".viewport-error-text");
  const bannerSuggest = banner.querySelector(".viewport-error-suggest");
  const bannerHint = banner.querySelector(".viewport-error-hint");
  const bannerClose = banner.querySelector(".viewport-error-close");
  let copyText = "";
  let displayText = "";

  root.append(hudStack, spinner, banner);
  const cadBadgeEl = spinner.querySelector(".v2-orbit-badge");

  function canvasGenerateHost() {
    if (viewportEl?.id !== "viewport") return null;
    if (!document.body?.classList.contains("canvas-design-tab")) return null;
    const wrap = document.getElementById("canvas-workspace");
    if (!wrap || wrap.classList.contains("hidden")) return null;
    return wrap;
  }

  function mountOverlayRoot() {
    const canvasHost = canvasGenerateHost();
    const onCanvas = !!canvasHost;
    const host = onCanvas ? canvasHost : viewportEl;
    const usedCanvas = generating && generationUsedCanvas(overlayOpts);
    root.classList.toggle("viewport-overlay-root--canvas", onCanvas);
    spinner.classList.toggle("viewport-spinner--canvas", onCanvas && generating);
    spinner.classList.toggle("viewport-spinner--used-canvas", usedCanvas);
    if (cadBadgeEl) {
      if (!generating) cadBadgeEl.textContent = "CAD";
      else if (usedCanvas) cadBadgeEl.textContent = canvasGenerateChip(overlayOpts);
      else cadBadgeEl.textContent = isMeshOverlay(overlayOpts) ? "MESH" : "CAD";
    }
    if (host && root.parentElement !== host) host.appendChild(root);
    if (onCanvas) {
      hudStack.style.left = "";
      hudStack.style.bottom = "";
    } else {
      dockHudBesideAr();
    }
  }

  function syncHost() {
    mountOverlayRoot();
    renderHarnessLine();
  }

  viewportEl.appendChild(root);

  function dockHudBesideAr() {
    const ar = document.getElementById("btn-xr-vr");
    const hostRect = viewportEl.getBoundingClientRect();
    const arVisible = !!(
      ar
      && !ar.hidden
      && !ar.classList.contains("hidden")
      && ar.getClientRects().length
      && getComputedStyle(ar).display !== "none"
    );
    hudStack.style.right = "auto";
    hudStack.style.top = "auto";
    if (!arVisible) {
      hudStack.style.left = "";
      hudStack.style.bottom = "";
      return;
    }
    const arRect = ar.getBoundingClientRect();
    const left = Math.round(arRect.right - hostRect.left + 8);
    const bottom = Math.round(hostRect.bottom - arRect.bottom);
    hudStack.style.left = `${Math.max(8, left)}px`;
    hudStack.style.bottom = `${Math.max(8, bottom)}px`;
  }

  let generating = false;
  mountOverlayRoot();
  let overlayOpts = {};
  let pendingHoldUntil = 0;
  let detailsOpen = false;
  let userCollapsedDetails = false;
  let mcmasterOpen = false;
  let electronicsOpen = false;
  let thinkingOpen = false;
  let autoOpenedThinking = false;
  let userCollapsedThinking = false;
  let mcmasterParts = [];
  let electronicsParts = [];
  let mcmasterDone = 0;
  let mcmasterTotal = 0;
  let progressValue = 0;
  let meterCounter = "";
  let traceProgress = 0;
  let progressLabel = "Generating…";
  let thinkingLabel = "Waiting for AI…";
  let thinkingLog = [];
  let pinDetailsScroll = true;
  let pinThinkingScroll = true;
  let improvedPromptText = "";
  let improvedPromptExpanded = false;
  let checklist = DEFAULT_CHECKLIST.map((item) => ({ ...item }));
  let peakChecklistIdx = -1;
  let activity = [];
  let progressStart = 0;
  let estimateMs = 150000;
  let progressTimer = null;
  let usageSummary = null;
  let lastUsageSignature = "";
  let pollTimer = null;
  let finishTimer = null;
  let activeJobs = [];
  let focusedJobId = null;

  function clearProgressTimers() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (finishTimer) {
      clearTimeout(finishTimer);
      finishTimer = null;
    }
  }

  function jobKey(job) {
    return String(job?.trace_id || job?.id || "");
  }

  function truncatePrompt(text, max = 72) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return "Generating…";
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  function rowsFromActivity(items = [], progress = {}) {
    const source = Array.isArray(items) && items.length
      ? items
      : progress?.label
        ? [{ text: progress.label, stage: progress.stage }]
        : [];
    return source
      .map((row) => {
        const text = typeof row === "string" ? row : (row?.text || row?.label || "");
        const cleaned = humanizeProgressText(text, "");
        if (!cleaned || cleaned === "Running CAD tools…") return null;
        return {
          text: cleaned,
          stage: typeof row === "object" ? (row?.stage || progress?.stage || "") : (progress?.stage || ""),
        };
      })
      .filter(Boolean)
      .filter((row, index, all) => index === 0 || row.text !== all[index - 1].text)
      .slice(-4)
      .reverse();
  }

  function jobMiniLogs(job) {
    const progress = job?.progress || {};
    const rows = rowsFromActivity(progress.activity, progress);
    if (!rows.length) return `<li class="viewport-gen-job-log muted">Waiting for updates…</li>`;
    return rows.map((row) => {
      const stage = row.stage ? `<span class="viewport-gen-job-log-stage">${esc(row.stage)}</span>` : "";
      return `<li class="viewport-gen-job-log">${stage}<span>${esc(row.text)}</span></li>`;
    }).join("");
  }

  function focusJob(jobId, { openDetails = false } = {}) {
    focusedJobId = jobId || null;
    const job = activeJobs.find((j) => jobKey(j) === focusedJobId) || activeJobs[0] || null;
    if (job) {
      applyProgressPayload(job.progress || {});
      if (job.progress?.label) {
        progressLabel = humanizeProgressText(job.progress.label, progressLabel);
      }
      const pct = Number(job.progress?.pct);
      if (Number.isFinite(pct)) {
        progressValue = Math.max(progressValue, pct);
        traceProgress = Math.max(traceProgress, pct);
      }
      if (job.progress?.counter) meterCounter = String(job.progress.counter);
    }
    renderJobsList();
    renderProgress();
    if (openDetails) setDetailsOpen(true);
  }

  function renderJobsList() {
    if (!jobsEl) return;
    const multi = activeJobs.length > 1;
    spinner.classList.toggle("viewport-spinner--multi", multi);
    jobsEl.classList.toggle("hidden", !multi);
    jobsEl.hidden = !multi;
    if (!multi) {
      jobsEl.innerHTML = "";
      return;
    }
    if (!focusedJobId || !activeJobs.some((j) => jobKey(j) === focusedJobId)) {
      focusedJobId = jobKey(activeJobs[0]);
    }
    jobsEl.classList.toggle("viewport-gen-jobs--expanded", detailsOpen);
    jobsEl.innerHTML = activeJobs.map((job, index) => {
      const id = jobKey(job);
      const pct = displayPctForJob(job, Number(job.progress?.pct) || 0);
      const label = humanizeProgressText(job.progress?.label || job.label || "", "Working…");
      const prompt = truncatePrompt(job.prompt || job.label || "New part");
      const selected = id === focusedJobId;
      const pending = id === "pending";
      const jobUsage = usageFromJob(job);
      const usageBits = [];
      if (jobUsage) {
        const cost = formatOverlayCostUsd(jobUsage.cost_usd);
        const tokens = overlayTokenTotal(jobUsage.usage);
        if (cost) usageBits.push(cost);
        if (tokens) usageBits.push(compactOverlayTokens(tokens));
      }
      const usageLabel = usageBits.join(" · ");
      return `
        <article class="viewport-gen-job${selected ? " is-selected" : ""}" data-job-id="${esc(id)}" title="${esc(prompt)}">
          <span class="viewport-gen-job-top">
            <button type="button" class="viewport-gen-job-focus" data-job-focus="${esc(id)}">
              <span class="viewport-gen-job-index">Model ${index + 1}</span>
              <span class="viewport-gen-job-prompt">${esc(prompt)}</span>
            </button>
            <span class="viewport-gen-job-pct">${pct}%</span>
          </span>
          <span class="viewport-gen-job-track"><span class="viewport-gen-job-fill" style="width:${pct}%"></span></span>
          <span class="viewport-gen-job-meta">
            <span class="viewport-gen-job-label">${esc(label)}</span>
            ${usageLabel ? `<span class="viewport-gen-job-usage">${esc(usageLabel)}</span>` : ""}
            <span class="viewport-gen-job-more">${selected && detailsOpen ? "Hide" : "View more"}</span>
          </span>
          <div class="viewport-gen-job-expanded">
            <div class="viewport-gen-job-log-title">Logs</div>
            <ul class="viewport-gen-job-logs">${jobMiniLogs(job)}</ul>
            <button type="button" class="btn danger viewport-gen-job-stop" data-job-stop="${esc(id)}"${pending ? " disabled" : ""}>
              ${pending ? "Starting…" : "Stop this"}
            </button>
          </div>
        </article>
      `;
    }).join("");
    if (spinnerLabel) {
      spinnerLabel.textContent = `${activeJobs.length} models generating…`;
    }
    if (expandBtn && multi) {
      expandBtn.textContent = detailsOpen ? "Hide" : `Details (${activeJobs.length})`;
      expandBtn.title = detailsOpen ? "Hide generation steps" : `Show ${activeJobs.length} running generations`;
    }
  }

  function setActiveJobs(jobs = []) {
    const list = Array.isArray(jobs) ? jobs.filter((j) => String(j?.status || "running") === "running") : [];
    activeJobs = list;
    const preferred = focusedJobId && list.some((j) => jobKey(j) === focusedJobId) ? focusedJobId : null;
    if (preferred) {
      focusedJobId = preferred;
      const focused = list.find((j) => jobKey(j) === focusedJobId);
      if (focused?.progress) applyProgressPayload(focused.progress);
    } else if (list.length <= 1) {
      focusedJobId = list.length === 1 ? jobKey(list[0]) : null;
      if (list.length === 1 && list[0]?.progress) {
        applyProgressPayload(list[0].progress);
      }
    } else {
      focusedJobId = jobKey(list[list.length - 1]);
      if (list[list.length - 1]?.progress) applyProgressPayload(list[list.length - 1].progress);
    }
    renderJobsList();
  }

  function setDetailsOpen(open, { user = false } = {}) {
    detailsOpen = !!open;
    if (user) userCollapsedDetails = !detailsOpen;
    spinner.classList.toggle("viewport-spinner--expanded", detailsOpen);
    detailsEl?.classList.toggle("hidden", !detailsOpen);
    if (detailsEl) detailsEl.hidden = !detailsOpen;
    if (expandBtn) {
      expandBtn.setAttribute("aria-expanded", detailsOpen ? "true" : "false");
      expandBtn.textContent = detailsOpen ? "Hide" : activeJobs.length > 1 ? `Details (${activeJobs.length})` : "Details";
      expandBtn.title = detailsOpen ? "Hide generation steps" : "Show generation steps";
    }
    const wrap = spinner.querySelector(".viewport-agent-thinking");
    wrap?.classList.toggle("viewport-agent-thinking--open", thinkingOpen && detailsOpen);
    if (wrap) wrap.hidden = !(thinkingOpen && detailsOpen);
    syncThinkingButton();
    renderHarnessLine();
    renderGeneratorWho();
    requestAnimationFrame(dockHudBesideAr);
    renderMcmaster();
    renderElectronics();
  }

  function syncThinkingButton() {
    if (!thinkingBtn) return;
    const open = thinkingOpen && detailsOpen;
    thinkingBtn.hidden = !generating;
    thinkingBtn.classList.toggle("is-live", thinkingLog.length > 0);
    thinkingBtn.classList.toggle("is-open", open);
    thinkingBtn.setAttribute("aria-expanded", open ? "true" : "false");
    thinkingBtn.setAttribute("aria-pressed", open ? "true" : "false");
    thinkingBtn.title = open ? "Hide thinking" : "Show the model’s thinking";
  }

  function setThinkingOpen(open, { user = false } = {}) {
    thinkingOpen = !!open;
    if (user) userCollapsedThinking = !thinkingOpen;
    if (thinkingOpen) setDetailsOpen(true);
    const wrap = spinner.querySelector(".viewport-agent-thinking");
    wrap?.classList.toggle("viewport-agent-thinking--open", thinkingOpen && detailsOpen);
    if (wrap) wrap.hidden = !(thinkingOpen && detailsOpen);
    syncThinkingButton();
    renderDetails();
  }

  function setMcmasterOpen(open) {
    mcmasterOpen = !!open;
    if (mcmasterOpen) setDetailsOpen(true);
    renderMcmaster();
    requestAnimationFrame(dockHudBesideAr);
  }

  function setElectronicsOpen(open) {
    electronicsOpen = !!open;
    if (electronicsOpen) setDetailsOpen(true);
    renderElectronics();
    requestAnimationFrame(dockHudBesideAr);
  }

  function renderElectronics() {
    const count = electronicsParts.length;
    const allow = generating && isCadHarnessOverlay(overlayOpts);
    if (electronicsBtn) {
      electronicsBtn.hidden = !allow;
      electronicsBtn.classList.toggle("is-live", allow && count > 0);
      electronicsBtn.setAttribute("aria-expanded", allow && electronicsOpen && detailsOpen ? "true" : "false");
      electronicsBtn.title = count
        ? `Show ${count} electronics part${count === 1 ? "" : "s"} grabbed`
        : "Show electronics as they are grabbed";
    }
    if (!allow && electronicsOpen) electronicsOpen = false;
    if (electronicsCountEl) {
      electronicsCountEl.textContent = String(count);
      electronicsCountEl.hidden = count <= 0;
    }
    const show = Boolean(electronicsOpen && detailsOpen);
    if (electronicsPanel) {
      electronicsPanel.classList.toggle("hidden", !show);
      electronicsPanel.hidden = !show;
    }
    if (electronicsEmpty) electronicsEmpty.hidden = count > 0;
    if (!electronicsList) return;
    if (!count) {
      electronicsList.innerHTML = "";
      return;
    }
    electronicsList.innerHTML = electronicsParts.map((row) => {
      const name = String(row?.name || row?.id || "Electronics").trim();
      const qty = String(row?.qty || "1");
      const url = String(row?.url || "").trim();
      const file = String(row?.model_filename || "").trim();
      const status = String(row?.status || "listed");
      const title = url
        ? `<a class="viewport-mcmaster-name" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>`
        : `<span class="viewport-mcmaster-name">${esc(name)}</span>`;
      return `<li class="viewport-mcmaster-row viewport-mcmaster-row--${esc(status)}">
        <span class="viewport-mcmaster-qty">×${esc(qty)}</span>
        ${title}
        <span class="viewport-mcmaster-status">${esc(status)}</span>
        ${file ? `<span class="viewport-mcmaster-used">${esc(file)}</span>` : ""}
      </li>`;
    }).join("");
  }

  function renderMcmaster() {
    const count = mcmasterParts.length;
    const allow = generating && isCadHarnessOverlay(overlayOpts);
    if (mcmasterBtn) {
      mcmasterBtn.hidden = !allow;
      mcmasterBtn.classList.toggle("is-live", allow && count > 0);
      mcmasterBtn.setAttribute("aria-expanded", allow && mcmasterOpen && detailsOpen ? "true" : "false");
      mcmasterBtn.title = count
        ? `Show ${count} McMaster-Carr part${count === 1 ? "" : "s"} being added`
        : "Show McMaster-Carr parts as they are added";
    }
    if (!allow && mcmasterOpen) mcmasterOpen = false;
    if (mcmasterCountEl) {
      mcmasterCountEl.textContent = String(count);
      mcmasterCountEl.hidden = count <= 0;
    }
    const show = Boolean(mcmasterOpen && detailsOpen);
    if (mcmasterPanel) {
      mcmasterPanel.classList.toggle("hidden", !show);
      mcmasterPanel.hidden = !show;
    }
    if (mcmasterEmpty) mcmasterEmpty.hidden = count > 0;
    if (!mcmasterList) return;
    if (!count) {
      mcmasterList.innerHTML = "";
      return;
    }
    mcmasterList.innerHTML = mcmasterParts.map((row) => {
      const pn = String(row?.part_number || "").trim();
      const status = String(row?.status || "planned").toLowerCase();
      const buy = String(row?.buy_url || "").trim() || (pn ? `https://www.mcmaster.com/${encodeURIComponent(pn)}/` : "");
      const desc = String(row?.description || "").trim().replace(/\s*\/\s*McMaster-Carr\s*$/i, "");
      const qty = String(row?.qty || "1");
      const used = String(row?.used_in || "").trim();
      const label = desc || pn;
      const statusLabel = ({
        planned: "planned",
        fetching: "fetching",
        retrying: "retrying",
        on_server: "on server",
        downloaded: "on server",
        used: "used",
        fetch_failed: "failed",
      })[status] || status;
      const nameLink = buy
        ? `<a class="viewport-mcmaster-name" href="${esc(buy)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
        : `<span class="viewport-mcmaster-name">${esc(label)}</span>`;
      const pnLink = pn && label !== pn
        ? (buy
          ? `<a class="viewport-mcmaster-pn" href="${esc(buy)}" target="_blank" rel="noopener noreferrer">${esc(pn)}</a>`
          : `<span class="viewport-mcmaster-pn">${esc(pn)}</span>`)
        : "";
      return `
        <li class="viewport-mcmaster-row viewport-mcmaster-row--${esc(status)}">
          <span class="viewport-mcmaster-qty">${esc(qty)}×</span>
          ${nameLink}
          <span class="viewport-mcmaster-status">${esc(statusLabel)}</span>
          ${pnLink}
          ${used ? `<span class="viewport-mcmaster-used">${esc(used)}</span>` : ""}
        </li>
      `;
    }).join("");
  }

  function syncPeakChecklistIdx(items = checklist) {
    const stats = stepStats(items);
    if (peakChecklistIdx < 0) {
      peakChecklistIdx = stats.activeIdx;
      return;
    }
    peakChecklistIdx = Math.max(peakChecklistIdx, stats.activeIdx);
  }

  function renderChecklist() {
    if (!checklistEl) return;
    const items = checklistForDisplay(
      checklist.length ? checklist : DEFAULT_CHECKLIST,
      peakChecklistIdx,
    );
    const repair = isRepairLoop(checklist, peakChecklistIdx);
    checklistEl.innerHTML = items.map((item, index) => {
      const status = item.status || "pending";
      const mark = status === "done" ? "✓" : status === "active" ? "●" : "○";
      const detailRaw = item.detail ? humanizeProgressText(item.detail, "") : "";
      const detail = detailRaw && detailRaw !== item.label
        ? `<span class="viewport-agent-check-detail">${esc(detailRaw)}</span>`
        : "";
      const repairNote = status === "active" && repair
        ? `<span class="viewport-agent-check-repair">Revising model…</span>`
        : "";
      return `
        <li class="viewport-agent-check viewport-agent-check--${esc(status)}" data-status="${esc(status)}">
          <span class="viewport-agent-check-mark" aria-hidden="true">${mark}</span>
          <span class="viewport-agent-check-body">
            <span class="viewport-agent-check-label">${esc(`${index + 1}. ${item.label || item.id || "Step"}`)}</span>
            ${repairNote}
            ${!repairNote ? detail : ""}
          </span>
        </li>
      `;
    }).join("");
  }

  function renderActivity() {
    if (!activityEl) return;
    const rows = [...activity]
      .map((row) => {
        const text = typeof row === "string" ? row : (row?.text || "");
        if (isRawToolLog(text)) {
          const cleaned = humanizeProgressText(text, "");
          // Skip generic tool noise; keep only mapped stage phrases.
          if (!cleaned || cleaned === "Running CAD tools…") return null;
          return {
            text: cleaned,
            stage: typeof row === "object" ? row?.stage : "",
          };
        }
        const cleaned = humanizeProgressText(text, "");
        if (!cleaned) return null;
        return {
          text: cleaned,
          stage: typeof row === "object" ? row?.stage : "",
        };
      })
      .filter(Boolean)
      .filter((row, index, all) => index === 0 || row.text !== all[index - 1].text)
      .slice(-8)
      .reverse();
    if (!rows.length) {
      const stats = displayStepStats(checklist, peakChecklistIdx);
      const headline = formatProgressHeadline(
        stats,
        stats.detail || stats.label,
        { repair: stats.repair },
      );
      activityEl.innerHTML = `<li class="viewport-agent-activity-item muted">${esc(headline)}</li>`;
      return;
    }
    activityEl.innerHTML = rows.map((row) => {
      const stage = row.stage ? `<span class="viewport-agent-activity-stage">${esc(row.stage)}</span>` : "";
      return `<li class="viewport-agent-activity-item">${stage}<span>${esc(row.text)}</span></li>`;
    }).join("");
  }

  function detailsNearBottom() {
    if (!detailsEl) return true;
    return detailsEl.scrollHeight - detailsEl.scrollTop - detailsEl.clientHeight <= 56;
  }

  function thinkingNearBottom() {
    if (!thinkingLogEl) return true;
    return thinkingLogEl.scrollHeight - thinkingLogEl.scrollTop - thinkingLogEl.clientHeight <= 24;
  }

  function followDetailsStream() {
    if (!detailsEl || !pinDetailsScroll) return;
    detailsEl.scrollTop = detailsEl.scrollHeight;
  }

  function followThinkingStream() {
    if (!thinkingLogEl || thinkingLogEl.hidden || !pinThinkingScroll) return;
    thinkingLogEl.scrollTop = thinkingLogEl.scrollHeight;
  }

  function improvedPromptIsLong(text) {
    if (!text) return false;
    const lines = String(text).split(/\n/);
    if (lines.length > 3) return true;
    return String(text).length > 240;
  }

  function renderImprovedPrompt() {
    if (!promptWrap || !promptTextEl) return;
    const text = String(improvedPromptText || "").trim();
    const show = Boolean(text);
    const long = improvedPromptIsLong(text);
    if (!show) improvedPromptExpanded = false;
    promptWrap.classList.toggle("hidden", !show);
    promptWrap.hidden = !show;
    promptWrap.classList.toggle("is-expanded", show && improvedPromptExpanded);
    promptWrap.classList.toggle("is-collapsible", show && long);
    promptTextEl.textContent = text;
    if (promptToggleBtn) {
      promptToggleBtn.hidden = !(show && long);
      promptToggleBtn.setAttribute("aria-expanded", improvedPromptExpanded ? "true" : "false");
      promptToggleBtn.textContent = improvedPromptExpanded ? "Show less" : "Expand";
    }
  }

  function renderDetails() {
    const stats = displayStepStats(checklist, peakChecklistIdx);
    const nowText = stats.repair
      ? "Revising model…"
      : humanizeProgressText(
          thinkingLabel || progressLabel || stats.detail || stats.label,
          stats.label,
        );
    const headline = formatProgressHeadline(stats, nowText, { repair: stats.repair });
    if (thinkingLabelEl) {
      thinkingLabelEl.textContent = thinkingLog.length ? "Thinking" : (stats.repair ? "Revising" : "Current step");
    }
    const wrap = spinner.querySelector(".viewport-agent-thinking");
    wrap?.classList.toggle("viewport-agent-thinking--open", thinkingOpen && detailsOpen);
    if (wrap) wrap.hidden = !(thinkingOpen && detailsOpen);
    if (thinkingOpen && detailsOpen && thinkingLogEl && thinkingLog.length) {
      if (thinkingText) thinkingText.hidden = true;
      thinkingLogEl.hidden = false;
      const pinned = pinThinkingScroll;
      const prevTop = thinkingLogEl.scrollTop;
      thinkingLogEl.textContent = thinkingLog
        .slice(-40)
        .map((row) => String(row?.text || "").trim())
        .filter(Boolean)
        .join("\n\n");
      requestAnimationFrame(() => {
        if (pinned) followThinkingStream();
        else thinkingLogEl.scrollTop = prevTop;
      });
    } else if (thinkingText) {
      thinkingText.hidden = !(thinkingOpen && detailsOpen);
      if (thinkingLogEl) thinkingLogEl.hidden = true;
      const focused = activeJobs.length > 1 ? `Focused model · ` : "";
      const multi = activeJobs.length > 1 ? `${activeJobs.length} models generating · ` : "";
      thinkingText.textContent = `${multi}${focused}${headline}`;
    }
    syncThinkingButton();
    spinner.classList.toggle("viewport-spinner--repair", stats.repair);
    renderImprovedPrompt();
    renderChecklist();
    renderActivity();
    followDetailsStream();
  }

  function resolveUsageSummary(opts = {}) {
    let incoming = null;
    if (opts.usageSummary && typeof opts.usageSummary === "object") {
      incoming = {
        cost_usd: opts.usageSummary.cost_usd ?? opts.usageSummary.cost ?? null,
        usage: opts.usageSummary.usage || null,
        model: shortOverlayModel(opts.usageSummary.model || ""),
        ai_calls: Number(opts.usageSummary.ai_calls || 0) || 0,
      };
    } else {
      const focused = activeJobs.find((j) => jobKey(j) === focusedJobId) || activeJobs[0] || null;
      const fromFocused = usageFromJob(focused);
      if (fromFocused) incoming = fromFocused;
      else if (activeJobs.length > 1) {
        let tokens = 0;
        let cost = 0;
        let hasCost = false;
        let model = "";
        let calls = 0;
        for (const job of activeJobs) {
          const u = usageFromJob(job);
          if (!u) continue;
          tokens += overlayTokenTotal(u.usage);
          if (u.cost_usd != null) {
            cost += Number(u.cost_usd) || 0;
            hasCost = true;
          }
          calls += Number(u.ai_calls || 0) || 0;
          if (!model && u.model) model = u.model;
        }
        if (tokens || hasCost) {
          incoming = {
            cost_usd: hasCost ? cost : null,
            usage: { total_tokens: tokens },
            model,
            ai_calls: calls,
          };
        }
      }
    }
    if (incoming) return mergeUsageSummary(usageSummary, incoming);
    return usageSummary;
  }

  function renderUsageMeter(opts = {}) {
    if (!progressUsage) return;
    if (isLoadOverlay(overlayOpts)) {
      progressUsage.hidden = true;
      spinner.classList.remove("viewport-spinner--has-usage");
      if (progressCostChip) progressCostChip.hidden = true;
      return;
    }
    const next = resolveUsageSummary(opts);
    if (next) usageSummary = next;
    const tokens = overlayTokenTotal(usageSummary?.usage);
    const costNum = usageSummary?.cost_usd != null && Number.isFinite(Number(usageSummary.cost_usd))
      ? Number(usageSummary.cost_usd)
      : (generating ? 0 : null);
    const costLabel = costNum != null
      ? formatOverlayCostUsd(costNum)
      : null;
    const model = shortOverlayModel(usageSummary?.model || "");
    const show = Boolean(generating || tokens > 0 || costNum != null);
    const signature = `${costLabel || ""}|${tokens}|${model}|${usageSummary?.ai_calls || 0}`;
    progressUsage.hidden = !show;
    progressUsage.classList.toggle("is-live", show);
    spinner.classList.toggle("viewport-spinner--has-usage", show);
    if (progressUsageCost) {
      progressUsageCost.textContent = costLabel || "$0.00";
      progressUsageCost.hidden = !costLabel;
    }
    if (progressCostChip) {
      progressCostChip.textContent = tokens > 0
        ? `${costLabel || "$0.00"} · ${compactOverlayTokens(tokens)}`
        : (costLabel || "$0.00");
      progressCostChip.hidden = !show;
      progressCostChip.title = tokens > 0
        ? `Estimated cost ${costLabel || "$0.00"} · ${compactOverlayTokens(tokens)}`
        : `Estimated cost ${costLabel || "$0.00"}`;
    }
    if (costingEl) {
      costingEl.hidden = !show;
      if (costingAmountEl) costingAmountEl.textContent = costLabel || "$0.00";
      if (costingTokensEl) {
        costingTokensEl.textContent = tokens > 0
          ? `· ${compactOverlayTokens(tokens)}`
          : "· 0 tokens";
      }
    }
    if (progressUsageTokens) {
      progressUsageTokens.textContent = tokens > 0 ? compactOverlayTokens(tokens) : "0 tokens";
      progressUsageTokens.hidden = !show;
    }
    if (progressUsageModel) {
      const calls = Number(usageSummary?.ai_calls || 0) || 0;
      const modelLabel = model
        ? (calls > 1 ? `${model} · ${calls} calls` : model)
        : (calls > 1 ? `${calls} AI calls` : "");
      progressUsageModel.textContent = modelLabel ? `· ${modelLabel}` : "";
      progressUsageModel.hidden = !modelLabel;
    }
    if (show) {
      progressUsage.title = [
        costLabel ? `Estimated cost ${costLabel}` : null,
        tokens > 0 ? compactOverlayTokens(tokens) : null,
        model || null,
      ].filter(Boolean).join(" · ");
      if (signature !== lastUsageSignature) {
        lastUsageSignature = signature;
        progressUsage.classList.remove("is-ticking");
        // Retrigger the bump animation when usage climbs.
        void progressUsage.offsetWidth;
        progressUsage.classList.add("is-ticking");
      }
    } else {
      lastUsageSignature = "";
      progressUsage.classList.remove("is-ticking");
    }
  }

  function renderGeneratorWho() {
    if (!whoEl) return;
    const name = String(generatorInfo?.by_user_name || generatorInfo?.name || "").trim();
    const avatar = String(generatorInfo?.by_avatar_url || generatorInfo?.avatar || "").trim();
    const pctRaw = Number(generatorInfo?.progress?.pct ?? generatorInfo?.pct ?? progressValue);
    const hasPct = Number.isFinite(pctRaw);
    const providers = detectProviderMarks(generatorInfo || {});
    if (!name && !avatar && !hasPct && !providers.length) {
      whoEl.hidden = true;
      return;
    }
    whoEl.hidden = false;
    if (whoProviderEl) {
      if (providers.length) {
        whoProviderEl.hidden = false;
        whoProviderEl.dataset.provider = providers.map((row) => row.id).join(",");
        whoProviderEl.title = providers.map((row) => row.label).join(" + ");
        whoProviderEl.innerHTML = providers
          .map((row) => providerLogoSvg(row.id, row.color))
          .join("");
      } else {
        whoProviderEl.hidden = true;
        whoProviderEl.innerHTML = "";
        delete whoProviderEl.dataset.provider;
      }
    }
    const brand = providers.map((row) => row.label).join(" + ");
    const initial = (name.charAt(0) || (brand.charAt(0) || "A")).toUpperCase();
    if (whoAvatarEl) {
      if (avatar) {
        whoAvatarEl.classList.add("viewport-spinner-who-avatar--image");
        whoAvatarEl.style.backgroundImage = `url("${avatar.replace(/"/g, "%22")}")`;
        whoAvatarEl.textContent = "";
      } else {
        whoAvatarEl.classList.remove("viewport-spinner-who-avatar--image");
        whoAvatarEl.style.backgroundImage = "";
        whoAvatarEl.textContent = initial;
      }
      whoAvatarEl.hidden = !spinner.classList.contains("viewport-spinner--expanded");
    }
    if (whoNameEl) {
      const modelLabel = shortOverlayModel(
        generatorInfo?.model || generatorInfo?.model_id || generatorInfo?.model_quality || "",
      );
      const bits = [];
      if (modelLabel) bits.push(modelLabel);
      else if (brand) bits.push(brand);
      if (name) bits.push(name);
      whoNameEl.textContent = bits.join(" · ") || "Generating…";
      // Retracted pill: keep provider logo / %, never harness or person/model names.
      whoNameEl.hidden = !spinner.classList.contains("viewport-spinner--expanded");
      const source = String(generatorInfo?.source || "").toLowerCase();
      const titleBits = [
        source === "chatgpt" || source === "subscription" ? "ChatGPT subscription" : "",
        modelLabel || brand,
        name,
      ].filter(Boolean);
      whoNameEl.title = titleBits.join(" · ");
    }
    if (whoPctEl) {
      // Retracted HUD already shows .viewport-progress-pct. who-pct was a
      // hudstrip leftover that duplicated "6%" on both sides of McMaster.
      whoPctEl.hidden = true;
      whoPctEl.textContent = "";
    }
    renderModelChip();
  }

  function overlayModelLabel(info = generatorInfo, opts = overlayOpts) {
    return shortOverlayModel(
      info?.model
      || info?.model_id
      || info?.model_quality
      || opts?.model
      || opts?.model_id
      || "",
    );
  }

  function renderModelChip() {
    if (!modelChipEl) return;
    const label = overlayModelLabel();
    const show = generating && isWiringOverlay(overlayOpts) && !!label;
    modelChipEl.hidden = !show;
    modelChipEl.textContent = label;
    if (label) modelChipEl.title = label;
  }

  function setGeneratorInfo(info = null) {
    if (!info || info.status === "done" || info.status === "error" || info.status === "cancelled") {
      generatorInfo = null;
      renderGeneratorWho();
      return;
    }
    const prev = generatorInfo || {};
    const next = { ...prev, ...info };
    const incomingModel = String(info.model || "").trim();
    const incomingProvider = String(info.provider || "").trim();
    const incomingSource = String(info.source || "").trim();
    if (info.brandLocked && (incomingModel || incomingProvider || incomingSource)) {
      next.model = incomingModel || prev.model;
      next.provider = incomingProvider || prev.provider;
      next.source = incomingSource || prev.source;
      next.brandLocked = true;
    } else if (prev.brandLocked) {
      next.model = prev.model;
      next.provider = prev.provider;
      next.source = prev.source;
      next.brandLocked = true;
    } else if (incomingModel || incomingProvider) {
      next.model = incomingModel;
      next.provider = incomingProvider;
      next.source = incomingSource;
      next.brandLocked = true;
    }
    generatorInfo = next;
    renderGeneratorWho();
  }

  function displayPctForJob(job, fallbackValue) {
    const items = Array.isArray(job?.progress?.checklist) && job.progress.checklist.length
      ? job.progress.checklist
      : checklist;
    const stats = displayStepStats(items, peakChecklistIdx);
    const raw = Number(job?.progress?.pct);
    const serverPct = Number.isFinite(raw) ? raw : fallbackValue;
    return pctFromChecklist(stats, Math.max(Number(fallbackValue) || 0, serverPct));
  }

  function renderElapsed() {
    if (!generating || !progressStart) {
      if (progressEta) {
        progressEta.textContent = "";
        progressEta.hidden = true;
      }
      if (headElapsed) {
        headElapsed.textContent = "";
        headElapsed.hidden = true;
      }
      return;
    }
    const clock = formatElapsedClock(Date.now() - progressStart);
    if (progressEta) {
      progressEta.textContent = `${clock} elapsed`;
      progressEta.hidden = false;
      progressEta.title = `Elapsed ${clock}`;
    }
    if (headElapsed) {
      headElapsed.textContent = clock;
      headElapsed.hidden = false;
      headElapsed.title = `Elapsed ${clock}`;
    }
  }

  function applyStartTime(opts = {}) {
    const fromJob = startMsFromOpts(opts);
    if (fromJob > 0) progressStart = fromJob;
  }

  function renderProgress() {
    renderHarnessLine();
    renderUsageMeter();
    renderElapsed();
    const stats = displayStepStats(checklist, peakChecklistIdx);
    if (activeJobs.length > 1) {
      const focused = activeJobs.find((j) => jobKey(j) === focusedJobId) || activeJobs[0];
      const pct = displayPctForJob(focused, progressValue);
      spinner.style.setProperty("--gen-pct", String(pct));
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressPct) progressPct.textContent = `${pct}%`;
      if (headProgressPct) headProgressPct.textContent = `${pct}%`;
      if (generatorInfo) {
        generatorInfo = { ...generatorInfo, pct, progress: { ...(generatorInfo.progress || {}), pct } };
      }
      renderGeneratorWho();
      if (pct >= 100 && generating) spinner.classList.add("viewport-spinner--place");
      else if (pct < 100) spinner.classList.remove("viewport-spinner--place");
      renderJobsList();
      renderDetails();
      renderMcmaster();
      renderElectronics();
      return;
    }
    const loadMode = isLoadOverlay(overlayOpts);
    const pct = loadMode ? 0 : pctFromChecklist(stats, progressValue);
    spinner.style.setProperty("--gen-pct", String(pct));
    if (progressFill) progressFill.style.width = loadMode ? "100%" : `${pct}%`;
    if (progressPct) {
      progressPct.hidden = loadMode;
      progressPct.textContent = loadMode ? "" : `${pct}%`;
    }
    if (headProgressPct) {
      headProgressPct.hidden = loadMode;
      headProgressPct.textContent = loadMode ? "" : `${pct}%`;
    }
    if (generatorInfo) {
      generatorInfo = { ...generatorInfo, pct, progress: { ...(generatorInfo.progress || {}), pct } };
    }
    renderGeneratorWho();
    if (progressStep) {
      progressStep.textContent = formatMeterCounter(stats, {
        label: progressLabel || thinkingLabel || stats.label,
        counter: meterCounter,
        repair: stats.repair,
      });
    }
    if (spinnerLabel) {
      const clean = stats.repair
        ? "Revising model…"
        : humanizeProgressText(progressLabel || thinkingLabel || stats.label, stats.label);
      // Prefer the explicit message (e.g. "Building Pad…") over AI checklist headline.
      const useRawLabel = progressLabel && !/^Generating/i.test(progressLabel) && !stats.repair;
      spinnerLabel.textContent = useRawLabel
        ? clean
        : formatProgressHeadline(stats, clean, { repair: stats.repair, counter: meterCounter });
    }
    if (pct >= 100 && generating) {
      spinner.classList.add("viewport-spinner--place");
    } else if (pct < 100) {
      spinner.classList.remove("viewport-spinner--place");
    }
    renderDetails();
    renderMcmaster();
    renderElectronics();
  }

  function absorbHarnessMeta(progress) {
    if (!progress || typeof progress !== "object") return;
    for (const key of ["harness", "wand", "wand_version", "skill", "skill_version", "engine", "pipeline"]) {
      const val = progress[key];
      if (val != null && String(val).trim()) harnessMeta[key] = progress[key];
    }
  }

  function harnessLineOpts() {
    const focused = activeJobs.find((j) => jobKey(j) === focusedJobId) || activeJobs[0] || overlayOpts.job || null;
    const hudKind = overlayHudKind(overlayOpts);
    return {
      ...overlayOpts,
      kind: hudKind,
      assumeCad: hudKind === "cad" || hudKind === "vibecad",
      message: overlayOpts.message || progressLabel,
      label: progressLabel,
      checklist,
      harness: harnessMeta.harness || overlayOpts.harness || focused?.harness,
      wand: harnessMeta.wand || overlayOpts.wand || focused?.wand,
      wand_version: harnessMeta.wand_version || overlayOpts.wand_version || focused?.wand_version,
      pipeline: harnessMeta.pipeline || overlayOpts.pipeline || overlayOpts.progress?.pipeline || focused?.pipeline,
      engine: overlayOpts.engine || overlayOpts.cadEngine || harnessMeta.engine || focused?.engine,
      codex_agent: overlayOpts.codex_agent || focused?.codex_agent,
      progress: {
        ...(overlayOpts.progress || {}),
        ...harnessMeta,
        label: progressLabel || overlayOpts.progress?.label,
        checklist,
        ...(focused?.progress && typeof focused.progress === "object" ? {
          harness: focused.progress.harness,
          wand: focused.progress.wand,
          wand_version: focused.progress.wand_version,
          pipeline: focused.progress.pipeline,
          engine: focused.progress.engine,
          skill: focused.progress.skill,
          label: focused.progress.label || progressLabel,
        } : {}),
      },
      job: focused,
      jobs: activeJobs,
      generator: generatorInfo,
    };
  }

  function absorbLiveUsage(progress) {
    if (!progress || typeof progress !== "object") return;
    if (progress.usageSummary && typeof progress.usageSummary === "object") {
      usageSummary = mergeUsageSummary(usageSummary, progress.usageSummary);
    }
    const incoming = {
      cost_usd: progress.cost_usd ?? progress.cost ?? null,
      usage: progress.usage || null,
      model: progress.model || "",
      ai_calls: progress.ai_calls,
    };
    if (
      incoming.cost_usd == null
      && !incoming.usage
      && !incoming.model
      && incoming.ai_calls == null
    ) {
      return;
    }
    usageSummary = mergeUsageSummary(usageSummary, incoming);
  }

  function mergeUsageSummary(prev, incoming = {}) {
    const nextCost = incoming?.cost_usd ?? incoming?.cost;
    const prevCost = prev?.cost_usd;
    const costNum = nextCost != null && Number.isFinite(Number(nextCost))
      ? Number(nextCost)
      : null;
    const keptCost = prevCost != null && Number.isFinite(Number(prevCost))
      ? Number(prevCost)
      : null;
    const usage = incoming?.usage || prev?.usage || null;
    const tokens = overlayTokenTotal(usage);
    const prevTokens = overlayTokenTotal(prev?.usage);
    return {
      cost_usd: costNum != null
        ? (keptCost != null ? Math.max(keptCost, costNum) : costNum)
        : keptCost,
      usage: tokens >= prevTokens ? (usage || prev?.usage || null) : (prev?.usage || usage),
      model: shortOverlayModel(incoming?.model || prev?.model || ""),
      ai_calls: Math.max(
        Number(incoming?.ai_calls || 0) || 0,
        Number(prev?.ai_calls || 0) || 0,
      ),
    };
  }

  function renderHarnessLine() {
    if (!harnessEl) return;
    const opts = harnessLineOpts();
    const usedCanvas = generating && generationUsedCanvas(overlayOpts);
    const line = generating ? formatOverlayHarnessLine({ ...opts, canvas: usedCanvas, usedCanvas }) : "";
    const chip = generating ? formatOverlayHarnessChip({ ...opts, canvas: usedCanvas, usedCanvas }) : "";
    const expanded = spinner.classList.contains("viewport-spinner--expanded");
    harnessEl.textContent = expanded ? line : chip;
    harnessEl.title = line || chip;
    harnessEl.hidden = !(expanded ? line : chip);
  }

  function applyProgressPayload(progress) {
    if (!progress || typeof progress !== "object") return;
    absorbHarnessMeta(progress);
    if (progress.pct != null) {
      const pct = Number(progress.pct);
      if (Number.isFinite(pct)) {
        if (pct > traceProgress) traceProgress = pct;
        if (pct > progressValue) progressValue = pct;
        // Do not clear the submit hold during the Improve-prompt step.
        // That race hid the spinner before /api/prompt/improve finished.
        if (pct >= 5 && !progress.spiceHold) pendingHoldUntil = 0;
      }
    }
    if (progress.counter) meterCounter = String(progress.counter);
    const nextImproved = progress.improved_prompt ?? progress.prompt_preview ?? progress.improvedPrompt;
    if (typeof nextImproved === "string" && nextImproved.trim()) {
      improvedPromptText = nextImproved.trim();
    }
    if (progress.label) {
      progressLabel = humanizeProgressText(progress.label, "Generating…");
      thinkingLabel = String(progress.thinking || progress.label || progressLabel);
    } else if (progress.thinking) {
      thinkingLabel = String(progress.thinking);
    }
    if (Array.isArray(progress.thinking_log) && progress.thinking_log.length) {
      thinkingLog = progress.thinking_log
        .map((row) => ({
          ts: row?.ts,
          text: String(row?.text || row || "").trim(),
        }))
        .filter((row) => row.text);
    } else if (progress.thinking_append) {
      const chunk = String(progress.thinking_append).trim();
      const last = thinkingLog[thinkingLog.length - 1]?.text || "";
      if (chunk && chunk !== last) {
        if (last && chunk.startsWith(last)) thinkingLog[thinkingLog.length - 1] = { text: chunk };
        else thinkingLog.push({ text: chunk });
      }
    }
    if (thinkingLog.length && !autoOpenedThinking && !userCollapsedThinking) {
      autoOpenedThinking = true;
      setThinkingOpen(true);
    }
    if (Array.isArray(progress.checklist) && progress.checklist.length) {
      checklist = relabelChecklistForEngine(overlayOpts, progress.checklist.map((item) => ({
        id: item.id || item.label,
        label: item.label || item.id || "Step",
        status: item.status || "pending",
        detail: humanizeProgressText(item.detail || "", ""),
      })));
    } else if (progress.stage) {
      checklist = checklistFromStage(
        progress.stage,
        progress.label || thinkingLabel,
        checklistTemplateFor(overlayOpts, checklist),
      );
    }
    syncPeakChecklistIdx(checklist);
    if (Array.isArray(progress.activity)) {
      activity = progress.activity
        .map((row) => {
          const raw = typeof row === "string" ? row : (row?.text || "");
          if (isRawToolLog(raw)) {
            const cleaned = humanizeProgressText(raw, "");
            if (!cleaned || cleaned === "Running CAD tools…") return null;
            if (typeof row === "string") {
              return { ts: new Date().toISOString(), text: cleaned, stage: progress.stage };
            }
            return { ...row, text: cleaned };
          }
          const cleaned = humanizeProgressText(raw, "");
          if (!cleaned) return null;
          if (typeof row === "string") {
            return { ts: new Date().toISOString(), text: cleaned, stage: progress.stage };
          }
          return { ...row, text: cleaned };
        })
        .filter(Boolean);
    } else if (progress.label) {
      const cleaned = humanizeProgressText(progress.label, "");
      if (cleaned && cleaned !== "Running CAD tools…") {
        const last = activity.length ? activity[activity.length - 1] : null;
        const lastText = typeof last === "string" ? last : last?.text;
        if (lastText !== cleaned) {
          activity = [...activity, { ts: new Date().toISOString(), text: cleaned, stage: progress.stage }].slice(-40);
        }
      }
    }
    if (Array.isArray(progress.mcmaster_parts) && isCadHarnessOverlay(overlayOpts)) {
      const prevCount = mcmasterParts.length;
      mcmasterParts = progress.mcmaster_parts.filter((row) => row && row.part_number);
      if (mcmasterParts.length > prevCount && mcmasterBtn) {
        mcmasterBtn.classList.add("is-pulse");
        window.setTimeout(() => mcmasterBtn.classList.remove("is-pulse"), 900);
      }
    } else if (!isCadHarnessOverlay(overlayOpts)) {
      mcmasterParts = [];
    }
    if (Array.isArray(progress.electronics_parts) && isCadHarnessOverlay(overlayOpts)) {
      const prevEl = electronicsParts.length;
      electronicsParts = progress.electronics_parts.filter((row) => row && (row.name || row.id));
      if (electronicsParts.length > prevEl && electronicsBtn) {
        electronicsBtn.classList.add("is-pulse");
        window.setTimeout(() => electronicsBtn.classList.remove("is-pulse"), 900);
      }
    } else if (!isCadHarnessOverlay(overlayOpts)) {
      electronicsParts = [];
    }
    absorbLiveUsage(progress);
  }

  function bumpProgress(pct, label) {
    if (!generating) return;
    if (pct > traceProgress) traceProgress = pct;
    if (pct > progressValue) progressValue = pct;
    if (label) {
      const cleaned = humanizeProgressText(label, "Generating…");
      progressLabel = cleaned;
      thinkingLabel = cleaned;
      if (cleaned && cleaned !== "Running CAD tools…") {
        const last = activity.length ? activity[activity.length - 1] : null;
        const lastText = typeof last === "string" ? last : last?.text;
        if (lastText !== cleaned) {
          activity = [...activity, { ts: new Date().toISOString(), text: cleaned }].slice(-40);
        }
      }
    }
    renderProgress();
  }

  function tickProgress() {
    if (!generating) return;
    if (isLoadOverlay(overlayOpts)) {
      renderProgress();
      return;
    }
    const elapsed = Date.now() - progressStart;
    // Gentle motion while waiting on long AI calls — never outrun trace-driven progress.
    const idleCap = Math.min(30, (elapsed / estimateMs) * 28);
    const display = Math.max(traceProgress, Math.min(traceProgress + 6, idleCap));
    if (display > progressValue) progressValue = display;
    renderProgress();
  }

  async function pollTraceLogs() {
    if (!generating || !fetchLogs) return;
    // CAD 2.0 / VibeCAD / Codex stream real checklist progress. Global /api/logs
    // matches ("CAD prompt done", etc.) were painting the bar at 96–100% mid-repair.
    if (
      spinner.classList.contains("viewport-spinner--v2")
      || spinner.classList.contains("viewport-spinner--fusion")
      || spinner.classList.contains("viewport-spinner--mesh")
      || spinner.classList.contains("viewport-spinner--render")
      || spinner.classList.contains("viewport-spinner--vibecad")
      || isVibeCadOverlay(overlayOpts)
      || isRenderOverlay(overlayOpts)
    ) {
      return;
    }
    try {
      const res = await fetchLogs();
      if (!res?.ok) return;
      const data = await res.json().catch(() => ({}));
      const since = progressStart - 2000;
      for (const entry of data.entries || []) {
        const ts = entry.ts ? new Date(entry.ts).getTime() : 0;
        if (ts && ts < since) continue;
        const msg = entry.message || "";
        for (const stage of LOG_STAGES) {
          if (stage.match.test(msg)) bumpProgress(stage.pct, stage.label);
        }
      }
    } catch {
      /* polling is best-effort */
    }
  }

  function setStopVisible(active) {
    if (!stopBtn) return;
    const count = typeof active === "number" ? active : (active ? activeJobs.length || 1 : 0);
    stopBtn.classList.toggle("hidden", count <= 0);
    stopBtn.textContent = count > 1 ? `Stop ${count} generations` : "Stop generating";
    stopBtn.setAttribute("aria-label", count > 1 ? `Stop ${count} running generations` : "Stop generating");
  }

  function isVibeCadOverlay(opts = {}) {
    const values = [
      opts.promptMode,
      opts.prompt_mode,
      opts.mode,
      opts.generationMode,
      opts.generation_mode,
      opts.variant,
      opts.message,
    ];
    return values.some((value) => /\bvibecad\b|\bvibecade\b/i.test(String(value || "")));
  }

  /** Jake text-to-cad (mode v2) — not VibeCAD / MAC, even if a stale checklist says VibeCAD. */
  function isJakeOverlay(opts = {}) {
    if (isVibeCadOverlay(opts) || isMeshOverlay(opts)) return false;
    const values = [
      opts.promptMode,
      opts.prompt_mode,
      opts.mode,
      opts.generationMode,
      opts.generation_mode,
      opts.variant,
      opts.message,
    ];
    if (values.some((value) => /\b(mac|macad|multi[_-]?agent[_-]?cad)\b/i.test(String(value || "")))) {
      return false;
    }
    return values.some((value) =>
      /\b(v2|2\.0|jake|text-to-cad|text to cad)\b/i.test(String(value || ""))
    );
  }

  function relabelChecklistForEngine(opts = {}, items = []) {
    const rows = (items || []).map((item) => ({ ...item }));
    if (!isJakeOverlay(opts)) return rows;
    const byId = new Map(DEFAULT_CHECKLIST.map((row) => [row.id, row.label]));
    return rows.map((item) => {
      const id = String(item.id || "");
      if (byId.has(id)) {
        return { ...item, label: byId.get(id) };
      }
      return item;
    });
  }

  function isV2Overlay(opts = {}) {
    if (isVibeCadOverlay(opts)) return false;
    const values = [
      opts.promptMode,
      opts.prompt_mode,
      opts.mode,
      opts.generationMode,
      opts.generation_mode,
      opts.variant,
      opts.message,
    ];
    // Mode 2.0 + Mesh share the orange Jake-style spinner (long runs / look-dev).
    return values.some((value) => /\b(v2|2\.0|jake|mesh)\b/i.test(String(value || "")));
  }

  function isFusionOverlay(opts = {}) {
    const values = [
      opts.promptMode,
      opts.prompt_mode,
      opts.mode,
      opts.generationMode,
      opts.generation_mode,
      opts.variant,
      opts.message,
    ];
    return values.some((value) => /\bfusion\b/i.test(String(value || "")));
  }

  function isWiringOverlay(opts = {}) {
    const values = [opts.kind, opts.promptMode, opts.prompt_mode, opts.mode];
    return values.some((value) => String(value || "").trim().toLowerCase() === "wiring");
  }

  function isRiggingOverlay(opts = {}) {
    const values = [
      opts.promptMode,
      opts.prompt_mode,
      opts.mode,
      opts.generationMode,
      opts.generation_mode,
      opts.variant,
      opts.kind,
      opts.message,
    ];
    return values.some((value) => /\brig(?:ging)?\b/i.test(String(value || "")));
  }

  function overlayModeToken(opts = {}, key) {
    return String(opts?.[key] || "").trim().toLowerCase();
  }

  function isMeshOverlay(opts = {}) {
    const tokens = [
      overlayModeToken(opts, "promptMode"),
      overlayModeToken(opts, "prompt_mode"),
      overlayModeToken(opts, "generationMode"),
      overlayModeToken(opts, "generation_mode"),
    ];
    if (tokens.some((value) => /^(mesh|mesh_beta|mesh-beta|fusion|img2threejs)$/.test(value))) {
      return true;
    }
    return /\bmesh(?:[_-]?beta)?\b|img2threejs/i.test(String(opts.message || ""));
  }

  function isRenderOverlay(opts = {}) {
    const tokens = [
      overlayModeToken(opts, "promptMode"),
      overlayModeToken(opts, "prompt_mode"),
      overlayModeToken(opts, "mode"),
      overlayModeToken(opts, "generationMode"),
      overlayModeToken(opts, "generation_mode"),
    ];
    return tokens.some((value) => value === "render");
  }

  function isVideoOverlay(opts = {}) {
    const kind = String(opts.kind || "").toLowerCase();
    if (["video", "film_edit", "film-edit", "video_edit", "imagine"].includes(kind)) return true;
    const tokens = [
      overlayModeToken(opts, "promptMode"),
      overlayModeToken(opts, "prompt_mode"),
      overlayModeToken(opts, "mode"),
      overlayModeToken(opts, "generationMode"),
      overlayModeToken(opts, "generation_mode"),
    ];
    return tokens.some((value) => value === "video" || value === "imagine");
  }

  function isCadHarnessOverlay(opts = {}) {
    if (isLoadOverlay(opts) || isMeshOverlay(opts) || isRenderOverlay(opts)
      || isRiggingOverlay(opts) || isWiringOverlay(opts) || isVideoOverlay(opts)) {
      return false;
    }
    const kind = String(opts.kind || "").toLowerCase();
    if (kind === "improve_lab" || kind === "project_load" || kind === "scene_render") return false;
    const blob = [
      opts.promptMode,
      opts.prompt_mode,
      opts.mode,
      opts.generationMode,
      opts.generation_mode,
      opts.variant,
      opts.kind,
      opts.harness,
      opts.engine,
      opts.progress?.harness,
      opts.progress?.pipeline,
      opts.progress?.engine,
    ].map((value) => String(value || "")).join(" ");
    return /\b(v2|jake|vibecad|macad|mac|architect|fusion|text-to-cad|text_to_cad|cadgen)\b/i.test(blob);
  }

  function hidesMcmasterHud(opts = {}) {
    return !isCadHarnessOverlay(opts);
  }

  function checklistTemplateFor(opts = {}, items = checklist) {
    if (isLoadOverlay(opts)) return LOAD_CHECKLIST;
    if (isWiringOverlay(opts) || String(opts.kind || "").toLowerCase() === "wiring") return WIRING_CHECKLIST;
    if (isRenderOverlay(opts) || String(opts.kind || "").toLowerCase() === "scene_render") {
      return RENDER_CHECKLIST;
    }
    if (isBuildOverlay(opts)) return BUILD_CHECKLIST;
    if (isJakeOverlay(opts)) return DEFAULT_CHECKLIST;
    if (isVibeCadOverlay(opts) || items.some((item) => /vibecad/i.test(String(item?.label || "")))) {
      return VIBECAD_CHECKLIST;
    }
    if (isMeshOverlay(opts)) return MESH_CHECKLIST;
    return DEFAULT_CHECKLIST;
  }

  function overlayHudKind(opts = {}) {
    const kind = String(opts.kind || "").toLowerCase();
    if (isLoadOverlay(opts)) return "load";
    if (kind === "improve_lab") return "improve_lab";
    if (isRenderOverlay(opts) || kind === "scene_render" || kind === "render" || kind === "render_region_edit") {
      return "render";
    }
    if (kind === "wiring" || isRiggingOverlay(opts)) return kind === "wiring" ? "wiring" : "rigging";
    if (isBuildOverlay(opts)) return "build";
    if (isMeshOverlay(opts)) return "mesh";
    if (isJakeOverlay(opts)) return "cad";
    if (isVibeCadOverlay(opts)) return "vibecad";
    return "cad";
  }

  function applySpinnerVariant(opts = {}) {
    overlayOpts = { ...overlayOpts, ...opts };
    const fusion = isFusionOverlay(overlayOpts);
    const rigging = isRiggingOverlay(overlayOpts);
    const mesh = isMeshOverlay(overlayOpts);
    const render = isRenderOverlay(overlayOpts);
    spinner.classList.toggle("viewport-spinner--fusion", fusion);
    spinner.classList.toggle("viewport-spinner--rigging", rigging);
    spinner.classList.toggle("viewport-spinner--mesh", mesh);
    spinner.classList.toggle("viewport-spinner--render", render);
    spinner.classList.toggle("viewport-spinner--improve-lab", overlayHudKind(overlayOpts) === "improve_lab");
    spinner.classList.toggle("viewport-spinner--vibecad", isVibeCadOverlay(overlayOpts));
    spinner.classList.toggle("viewport-spinner--v2", !fusion && !rigging && isV2Overlay(overlayOpts));
    spinner.classList.toggle("viewport-spinner--load", isLoadOverlay(overlayOpts));
    spinner.classList.toggle("viewport-spinner--wiring", isWiringOverlay(overlayOpts));
    spinner.classList.toggle("viewport-spinner--no-mcmaster", hidesMcmasterHud(overlayOpts));
    renderModelChip();
    document.body.classList.toggle("mesh-generating", generating && mesh);
    document.body.classList.toggle("render-generating", generating && render);
    renderHarnessLine();
  }

  function startProgress(message, opts = {}) {
    clearProgressTimers();
    generating = true;
    overlayOpts = { ...opts };
    harnessMeta = {};
    absorbHarnessMeta(opts);
    absorbHarnessMeta(opts.progress);
    spinner.classList.remove("viewport-spinner--place");
    spinner.style.setProperty("--gen-pct", "0");
    progressValue = 0;
    traceProgress = 0;
    meterCounter = String(opts.progress?.counter || "");
    const seedPct = Number(opts.progress?.pct);
    if (Number.isFinite(seedPct) && seedPct > 0) {
      progressValue = seedPct;
      traceProgress = seedPct;
    }
    const buildMode = isBuildOverlay(opts);
    const loadMode = isLoadOverlay(opts);
    const labMode = overlayHudKind(opts) === "improve_lab";
    const fallbackLabel = loadMode
      ? "Loading model…"
      : labMode
      ? "Improve Lab — comparing overlays…"
      : buildMode ? "Building solid…" : "Generating…";
    progressLabel = humanizeProgressText(message, fallbackLabel);
    thinkingLabel = humanizeProgressText(
      opts.progress?.thinking || opts.progress?.label || message,
      progressLabel,
    );
    thinkingLog = Array.isArray(opts.progress?.thinking_log)
      ? opts.progress.thinking_log
          .map((row) => ({ text: String(row?.text || row || "").trim() }))
          .filter((row) => row.text)
      : [];
    pinDetailsScroll = true;
    pinThinkingScroll = true;
    userCollapsedThinking = false;
    autoOpenedThinking = thinkingLog.length > 0;
    thinkingOpen = thinkingLog.length > 0;
    checklist = Array.isArray(opts.progress?.checklist) && opts.progress.checklist.length
      ? relabelChecklistForEngine(opts, opts.progress.checklist.map((item) => ({
          id: item.id || item.label,
          label: item.label || item.id || "Step",
          status: item.status || "pending",
          detail: humanizeProgressText(item.detail || "", ""),
        })))
      : checklistTemplateFor(opts).map((item) => ({ ...item }));
    peakChecklistIdx = -1;
    syncPeakChecklistIdx(checklist);
    activity = Array.isArray(opts.progress?.activity)
      ? opts.progress.activity
          .map((row) => {
            const raw = typeof row === "string" ? row : (row?.text || "");
            const cleaned = humanizeProgressText(raw, "");
            if (!cleaned || (isRawToolLog(raw) && cleaned === "Running CAD tools…")) return null;
            return typeof row === "string"
              ? { text: cleaned }
              : { ...row, text: cleaned };
          })
          .filter(Boolean)
      : [];
    progressStart = Date.now();
    applyStartTime(opts);
    estimateMs = opts.estimateMs || (opts.mode === "build" ? 90000 : isV2Overlay(opts) ? 900000 : 360000);
    // Preserve improved prompt when the spinner restarts after the Improve step.
    const seedImproved = opts.progress?.improved_prompt ?? opts.progress?.prompt_preview ?? opts.progress?.improvedPrompt;
    if (typeof seedImproved === "string" && seedImproved.trim()) {
      improvedPromptText = seedImproved.trim();
    }
    mcmasterParts = (isCadHarnessOverlay(opts) && Array.isArray(opts.progress?.mcmaster_parts))
      ? opts.progress.mcmaster_parts.filter((row) => row && row.part_number)
      : [];
    electronicsParts = (isCadHarnessOverlay(opts) && Array.isArray(opts.progress?.electronics_parts))
      ? opts.progress.electronics_parts.filter((row) => row && (row.name || row.id))
      : [];
    mcmasterOpen = false;
    electronicsOpen = false;
    applySpinnerVariant(opts);
    if (progressPct) progressPct.hidden = isLoadOverlay(opts);
    spinner.classList.remove("hidden");
    clearError();
    mountOverlayRoot();
    if (!root.classList.contains("viewport-overlay-root--canvas")) {
      dockHudBesideAr();
      requestAnimationFrame(dockHudBesideAr);
    }
    // Start as the compact pill so the 3D viewport stays visible. Cost/tokens
    // stay on the pill; Details expands the costing card.
    userCollapsedDetails = false;
    setDetailsOpen(false);
    renderProgress();
    if (thinkingOpen) setThinkingOpen(true);
    progressTimer = setInterval(tickProgress, 500);
    if (fetchLogs && !isLoadOverlay(opts)) {
      pollTraceLogs();
      pollTimer = setInterval(pollTraceLogs, 1400);
    }
  }

  function hideSpinner() {
    generating = false;
    clearProgressTimers();
    setDetailsOpen(false);
    spinner.classList.add("hidden");
    spinner.classList.remove("viewport-spinner--v2");
    spinner.classList.remove("viewport-spinner--fusion");
    spinner.classList.remove("viewport-spinner--mesh");
    spinner.classList.remove("viewport-spinner--render");
    spinner.classList.remove("viewport-spinner--improve-lab");
    spinner.classList.remove("viewport-spinner--vibecad");
    spinner.classList.remove("viewport-spinner--no-mcmaster");
    spinner.classList.remove("viewport-spinner--load");
    if (progressPct) progressPct.hidden = false;
    spinner.classList.remove("viewport-spinner--multi");
    spinner.classList.remove("viewport-spinner--place");
    document.body.classList.remove("mesh-generating", "render-generating");
    overlayOpts = {};
    harnessMeta = {};
    hudStack.style.left = "";
    hudStack.style.bottom = "";
    spinner.style.setProperty("--gen-pct", "0");
    generatorInfo = null;
    renderGeneratorWho();
    if (stopBtn) stopBtn.classList.add("hidden");
    progressValue = 0;
    meterCounter = "";
    traceProgress = 0;
    improvedPromptText = "";
    improvedPromptExpanded = false;
    checklist = DEFAULT_CHECKLIST.map((item) => ({ ...item }));
    peakChecklistIdx = -1;
    activity = [];
    thinkingLog = [];
    pinDetailsScroll = true;
    pinThinkingScroll = true;
    thinkingOpen = false;
    autoOpenedThinking = false;
    userCollapsedThinking = false;
    userCollapsedDetails = false;
    mcmasterParts = [];
    electronicsParts = [];
    mcmasterOpen = false;
    electronicsOpen = false;
    activeJobs = [];
    focusedJobId = null;
    usageSummary = null;
    lastUsageSignature = "";
    if (progressUsage) {
      progressUsage.hidden = true;
      progressUsage.classList.remove("is-live", "is-ticking");
    }
    if (progressCostChip) progressCostChip.hidden = true;
    if (costingEl) costingEl.hidden = true;
    spinner.classList.remove("viewport-spinner--has-usage");
    if (jobsEl) {
      jobsEl.innerHTML = "";
      jobsEl.classList.add("hidden");
      jobsEl.hidden = true;
    }
    spinner.classList.remove("viewport-spinner--canvas");
    spinner.classList.remove("viewport-spinner--used-canvas");
    if (cadBadgeEl) cadBadgeEl.textContent = "CAD";
    mountOverlayRoot();
    renderProgress();
  }

  function updateProgress(progress = {}) {
    if (!generating) return;
    if (progress.usageSummary) usageSummary = progress.usageSummary;
    applyProgressPayload(progress);
    renderProgress();
  }

  function finishProgress() {
    bumpProgress(100, "Done");
    checklist = checklist.map((item) => ({ ...item, status: "done" }));
    spinner.classList.add("viewport-spinner--place");
    spinner.style.setProperty("--gen-pct", "100");
    renderProgress();
    clearProgressTimers();
    // Hold long enough for the robot pick-and-place animation.
    finishTimer = setTimeout(hideSpinner, 1550);
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
    return copied;
  }

  function setGenerating(active, message = "Generating…", opts = {}) {
    if (active) {
      if (opts.generator) {
        setGeneratorInfo(opts.generator);
      } else if (opts.model || opts.provider || opts.by_user_name || opts.by_avatar_url) {
        setGeneratorInfo({
          model: opts.model,
          provider: opts.provider,
          source: opts.source,
          by_user_name: opts.by_user_name,
          by_avatar_url: opts.by_avatar_url,
          pct: opts.pct,
          progress: opts.progress,
          status: opts.status || "running",
          brandLocked: !!(opts.model || opts.provider),
        });
      }
      if (opts.usageSummary) usageSummary = mergeUsageSummary(usageSummary, opts.usageSummary);
      else if (opts.jobs || opts.job) {
        const next = resolveUsageSummary(opts);
        if (next) usageSummary = mergeUsageSummary(usageSummary, next);
      }
      if (opts.progress) absorbLiveUsage(opts.progress);
      if (opts.pendingStart) {
        pendingHoldUntil = Math.max(pendingHoldUntil, Date.now() + 90000);
      } else if (opts.pendingStart === false || (opts.progress && Number(opts.progress?.pct) >= 5)) {
        pendingHoldUntil = 0;
      }
      if (opts.focusedJobId) focusedJobId = String(opts.focusedJobId);
      if (Array.isArray(opts.jobs)) setActiveJobs(opts.jobs);
      else if (opts.job) setActiveJobs([opts.job]);
      // Real server jobs (non-pending) end the submit hold.
      if (Array.isArray(opts.jobs) && opts.jobs.some((j) => String(j?.trace_id || j?.id || "") !== "pending" && j?.status === "running")) {
        pendingHoldUntil = 0;
      }
      const label = message || (
        overlayHudKind(opts) === "improve_lab"
          ? "Improve Lab — comparing overlays…"
          : (isBuildOverlay(opts) ? "Building solid…" : "Generating…")
      );
      if (generating) {
        const prevKind = overlayHudKind(overlayOpts);
        const nextKind = overlayHudKind(opts);
        if (prevKind && nextKind && prevKind !== nextKind) {
          hideSpinner();
          startProgress(label, opts);
          if (opts.progress && activeJobs.length <= 1) applyProgressPayload(opts.progress);
          renderProgress();
          return;
        }
        applyStartTime(opts);
        if (label && activeJobs.length <= 1) progressLabel = label;
        if (opts.estimateMs) estimateMs = opts.estimateMs;
        if (opts.progress && activeJobs.length <= 1) applyProgressPayload(opts.progress);
        applySpinnerVariant(opts);
        renderProgress();
        return;
      }
      startProgress(label, opts);
      if (opts.progress && activeJobs.length <= 1) applyProgressPayload(opts.progress);
      renderProgress();
      return;
    }
    // Ignore premature complete teardown while Generate submit/spice is still in flight.
    // That race was making the first click look like a no-op until a second click.
    if (
      generating
      && opts.complete
      && !opts.force
      && Date.now() < pendingHoldUntil
    ) {
      return;
    }
    pendingHoldUntil = 0;
    if (opts.complete && generating) finishProgress();
    else hideSpinner();
  }

  function isGenerating() {
    return generating;
  }

  function formatCopyContext(context) {
    const ctx = typeof getCopyContext === "function" ? getCopyContext(context || {}) : context;
    const lines = [];
    if (ctx?.ref) lines.push(ctx.ref);
    if (ctx?.projectId && !String(ctx.ref || "").includes(`project:${ctx.projectId}`)) lines.push(`project:${ctx.projectId}`);
    if (ctx?.filename && !String(ctx.ref || "").includes(`file:${ctx.filename}`)) lines.push(`model:${ctx.filename}`);
    if (ctx?.traceId && !String(ctx.ref || "").includes(`trace:${ctx.traceId}`)) lines.push(`trace:${ctx.traceId}`);
    if (ctx?.promptText) lines.push(`prompt:${ctx.promptText}`);
    if (!lines.length) return "";
    return `\n\n--- context ---\n${lines.join("\n")}`;
  }

  function showError(message, context = {}) {
    pendingHoldUntil = 0;
    displayText =
      String(message || "").trim() ||
      "Something went wrong — open Prompt History for details.";
    const suggestions = Array.isArray(context.suggestions)
      ? context.suggestions.map((s) => String(s || "").trim()).filter(Boolean)
      : [];
    copyText = `${displayText}${suggestions.length ? `\n\nWhat to do instead:\n${suggestions.map((s) => `- ${s}`).join("\n")}` : ""}${formatCopyContext(context)}`;
    if (bannerText) bannerText.textContent = displayText;
    if (bannerSuggest) {
      bannerSuggest.innerHTML = suggestions
        .map((s) => `<li>${String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))}</li>`)
        .join("");
      bannerSuggest.classList.toggle("hidden", !suggestions.length);
    }
    banner.classList.toggle("viewport-error-banner--advice", suggestions.length > 0);
    banner.classList.remove("hidden");
    bannerHint.textContent = "Click to copy";
    bannerHint.classList.remove("viewport-error-hint--copied");
  }

  function clearError() {
    copyText = "";
    displayText = "";
    banner.classList.add("hidden");
  }

  function dismiss() {
    setGenerating(false);
    clearError();
    clearReadyBanner();
  }

  expandBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setDetailsOpen(!detailsOpen, { user: true });
    renderJobsList();
  });
  mcmasterBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setMcmasterOpen(!mcmasterOpen);
  });
  electronicsBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setElectronicsOpen(!electronicsOpen);
  });
  thinkingBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setThinkingOpen(!(thinkingOpen && detailsOpen), { user: true });
  });
  promptToggleBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    improvedPromptExpanded = !improvedPromptExpanded;
    renderImprovedPrompt();
  });

  // Keep wheel/trackpad scroll inside the panel — otherwise OrbitControls eats it
  // and Updates looks like it "can't scroll" while Stop generating is clipped.
  const trapScroll = (e) => {
    e.stopPropagation();
  };
  detailsEl?.addEventListener("wheel", trapScroll, { passive: true });
  detailsEl?.addEventListener("touchmove", trapScroll, { passive: true });
  detailsEl?.addEventListener("scroll", () => {
    pinDetailsScroll = detailsNearBottom();
  }, { passive: true });
  thinkingLogEl?.addEventListener("wheel", trapScroll, { passive: true });
  thinkingLogEl?.addEventListener("touchmove", trapScroll, { passive: true });
  thinkingLogEl?.addEventListener("scroll", () => {
    pinThinkingScroll = thinkingNearBottom();
  }, { passive: true });
  spinner.addEventListener("wheel", (e) => {
    if (!detailsOpen) return;
    e.stopPropagation();
  }, { passive: true });

  // Retracted pill hides Details — click the pill itself to expand / collapse.
  spinner.addEventListener("click", (e) => {
    if (e.target.closest?.(".viewport-stop-btn, .viewport-spinner-details, .viewport-gen-jobs, a, button")) return;
    if (detailsOpen && !e.target.closest?.(".viewport-spinner-who, .viewport-spinner-head, .viewport-progress-meta")) {
      return;
    }
    e.stopPropagation();
    setDetailsOpen(!detailsOpen, { user: true });
    renderJobsList();
  });

  jobsEl?.addEventListener("click", (e) => {
    const stop = e.target.closest?.("[data-job-stop]");
    if (stop) {
      e.stopPropagation();
      const id = stop.getAttribute("data-job-stop") || "";
      if (!id || id === "pending") return;
      onStopGeneration?.({ traceId: id, focusedJobId: id, jobs: activeJobs });
      return;
    }
    const btn = e.target.closest?.("[data-job-focus], .viewport-gen-job");
    if (!btn) return;
    e.stopPropagation();
    const card = btn.closest?.(".viewport-gen-job") || btn;
    const id = btn.getAttribute("data-job-focus") || card.getAttribute("data-job-id") || "";
    const same = id === focusedJobId;
    focusJob(id, { openDetails: same ? !detailsOpen : true });
  });

  stopBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    onStopGeneration?.({ jobs: activeJobs, focusedJobId });
  });

  bannerClose?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearError();
  });

  async function copyBannerError() {
    if (!copyText) return;
    try {
      const copied = await copyToClipboard(copyText);
      if (!copied) throw new Error("copy command failed");
      bannerHint.textContent = "Copied!";
      bannerHint.classList.add("viewport-error-hint--copied");
      setTimeout(() => {
        if (banner.classList.contains("hidden")) return;
        bannerHint.textContent = "Click to copy";
        bannerHint.classList.remove("viewport-error-hint--copied");
      }, 2000);
    } catch {
      bannerHint.textContent = "Copy failed — text selected";
      const selection = window.getSelection?.();
      if (selection && bannerText) {
        const range = document.createRange();
        range.selectNodeContents(bannerText);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }

  banner.addEventListener("click", copyBannerError);

  banner.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      clearError();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      copyBannerError();
    }
  });

  function clearReadyTimers() {
    if (readyHideTimer) {
      clearTimeout(readyHideTimer);
      readyHideTimer = null;
    }
    if (readyFadeTimer) {
      clearTimeout(readyFadeTimer);
      readyFadeTimer = null;
    }
  }

  function clearReadyBanner() {
    clearReadyTimers();
    readyBanner.classList.add("is-leaving");
    readyBanner.classList.remove("is-visible");
    window.setTimeout(() => {
      readyBanner.classList.add("hidden");
      readyBanner.classList.remove("is-leaving", "is-visible");
      if (readyText) readyText.textContent = "";
    }, 280);
  }

  function showReadyBanner(message, { durationMs = 5200 } = {}) {
    const text = String(message || "").trim();
    if (!text) return;
    clearReadyTimers();
    if (readyText) readyText.textContent = text;
    readyBanner.classList.remove("hidden", "is-leaving");
    // Restart enter animation
    readyBanner.classList.remove("is-visible");
    void readyBanner.offsetWidth;
    readyBanner.classList.add("is-visible");
    dockHudBesideAr();
    readyHideTimer = window.setTimeout(() => {
      readyBanner.classList.add("is-leaving");
      readyBanner.classList.remove("is-visible");
      readyFadeTimer = window.setTimeout(() => {
        readyBanner.classList.add("hidden");
        readyBanner.classList.remove("is-leaving");
      }, 420);
    }, Math.max(1800, Number(durationMs) || 5200));
  }

  readyClose?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearReadyBanner();
  });

  window.addEventListener("resize", dockHudBesideAr);
  if (typeof ResizeObserver === "function") {
    const hudDockObserver = new ResizeObserver(() => dockHudBesideAr());
    hudDockObserver.observe(viewportEl);
    const arBtn = document.getElementById("btn-xr-vr");
    if (arBtn) hudDockObserver.observe(arBtn);
  }

  function getHudState() {
    return {
      generating,
      pct: progressValue,
      label: progressLabel,
      thinking: thinkingLabel,
      thinkingLog: thinkingLog.slice(),
      improvedPrompt: improvedPromptText,
      checklist: checklist.map((item) => ({ ...item })),
      activity: activity.map((row) => (typeof row === "string" ? row : { ...row })),
      mcmasterParts: mcmasterParts.map((row) => ({ ...row })),
      electronicsParts: electronicsParts.map((row) => ({ ...row })),
      mcmasterOpen,
      electronicsOpen,
      detailsOpen,
      usage: usageSummary,
      overlayOpts: { ...overlayOpts },
      harness: formatOverlayHarnessLine({ ...overlayOpts, progress: overlayOpts.progress || {} }),
      preview_filename: overlayOpts?.progress?.preview_filename || "",
      preview_seq: overlayOpts?.progress?.preview_seq || 0,
    };
  }

  const api = { setGenerating, isGenerating, updateProgress, setStopVisible, setActiveJobs, setGeneratorInfo, showError, clearError, showReadyBanner, clearReadyBanner, dismiss, getHudState, syncHost };
  // Main studio viewport only — wiring has its own overlay instance.
  if (viewportEl?.id === "viewport") {
    window.Render3DViewerOverlay = api;
  }
  return api;
}
