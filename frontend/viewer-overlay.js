/** Bottom-right HUD spinner, progress bar, expandable agent checklist, and error banner. */

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
  { match: /\[2\.0\].*Quality pipeline/i, pct: 8, label: "Starting 2.0 quality pipeline…" },
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
  { id: "analyze", label: "Analyze prompt & references", status: "pending" },
  { id: "brief", label: "Write CAD brief", status: "pending" },
  { id: "ai_source", label: "Write / edit build123d source", status: "pending" },
  { id: "step", label: "Run scripts/step (STEP / GLB)", status: "pending" },
  { id: "inspect", label: "Inspect geometry (facts / planes)", status: "pending" },
  { id: "snapshot", label: "Render multi-view snapshot", status: "pending" },
  { id: "snapshot_review", label: "Visual review (fail-closed)", status: "pending" },
  { id: "finalize", label: "Finalize artifacts", status: "pending" },
];

const STAGE_ALIASES = {
  analyze: "analyze",
  plan: "analyze",
  build: "step",
  brief: "brief",
  ai_source: "ai_source",
  step: "step",
  inspect: "inspect",
  "inspect-quality": "inspect",
  snapshot: "snapshot",
  snapshot_review: "snapshot_review",
  finalize: "finalize",
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
  if (/brief/i.test(t)) return "Writing CAD brief…";
  if (/build123d|\.py\b|ai_source|source/i.test(t)) return "Editing CAD source…";
  if (/finalize|export/i.test(t)) return "Finalizing artifacts…";
  if (/analyze|prompt/i.test(t)) return "Analyzing prompt…";
  return "Running CAD tools…";
}

function checklistFromStage(stage, currentLabel = "") {
  const normalized = STAGE_ALIASES[String(stage || "").trim().toLowerCase()] || "";
  const ids = DEFAULT_CHECKLIST.map((item) => item.id);
  const activeIdx = ids.indexOf(normalized);
  return DEFAULT_CHECKLIST.map((item, i) => {
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
    label: humanizeProgressText(active.label || "Working…"),
    detail: humanizeProgressText(active.detail || "", ""),
  };
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function createViewerOverlay(viewportEl, { fetchLogs, onStopGeneration, getCopyContext } = {}) {
  if (!viewportEl) {
    return {
      setGenerating() {},
      isGenerating() {
        return false;
      },
      setStopVisible() {},
      showError() {},
      clearError() {},
      dismiss() {},
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
        <span class="v2-orbit-badge">2.0</span>
      </div>
      <div class="viewport-spinner-fusion">
        <div class="fusion-loader-ring"></div>
        <div class="fusion-loader-core">F</div>
        <span class="fusion-loader-drop fusion-loader-drop--a"></span>
        <span class="fusion-loader-drop fusion-loader-drop--b"></span>
        <span class="fusion-loader-drop fusion-loader-drop--c"></span>
      </div>
    </div>
    <div class="viewport-spinner-body">
      <div class="viewport-spinner-head">
        <p class="viewport-spinner-label">Generating…</p>
        <button type="button" class="viewport-spinner-expand" aria-expanded="false" title="Show generation steps" aria-label="Show generation steps">Details</button>
      </div>
      <div class="viewport-progress" aria-hidden="true">
        <div class="viewport-progress-track">
          <div class="viewport-progress-fill"></div>
        </div>
        <div class="viewport-progress-meta">
          <span class="viewport-progress-step">1/8</span>
          <span class="viewport-progress-pct">0%</span>
        </div>
      </div>
      <div class="viewport-spinner-details hidden" hidden>
        <div class="viewport-agent-thinking">
          <div class="viewport-agent-thinking-label">Current step</div>
          <p class="viewport-agent-thinking-text">Waiting for AI…</p>
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
      <button type="button" class="btn danger viewport-stop-btn hidden" aria-label="Stop generating">Stop generating</button>
    </div>
  `;
  const spinnerLabel = spinner.querySelector(".viewport-spinner-label");
  const stopBtn = spinner.querySelector(".viewport-stop-btn");
  const progressFill = spinner.querySelector(".viewport-progress-fill");
  const progressPct = spinner.querySelector(".viewport-progress-pct");
  const progressStep = spinner.querySelector(".viewport-progress-step");
  const expandBtn = spinner.querySelector(".viewport-spinner-expand");
  const detailsEl = spinner.querySelector(".viewport-spinner-details");
  const thinkingText = spinner.querySelector(".viewport-agent-thinking-text");
  const checklistEl = spinner.querySelector(".viewport-agent-checklist");
  const activityEl = spinner.querySelector(".viewport-agent-activity");

  const banner = document.createElement("div");
  banner.className = "viewport-error-banner hidden";
  banner.setAttribute("role", "button");
  banner.setAttribute("tabindex", "0");
  banner.setAttribute("aria-label", "Error — click to copy");
  banner.innerHTML = `
    <button type="button" class="viewport-error-close" aria-label="Close error message">×</button>
    <span class="viewport-error-text"></span>
    <span class="viewport-error-hint">Click to copy</span>
  `;
  const bannerText = banner.querySelector(".viewport-error-text");
  const bannerHint = banner.querySelector(".viewport-error-hint");
  const bannerClose = banner.querySelector(".viewport-error-close");
  let copyText = "";
  let displayText = "";

  root.append(spinner, banner);
  viewportEl.appendChild(root);

  let generating = false;
  let detailsOpen = false;
  let progressValue = 0;
  let traceProgress = 0;
  let progressLabel = "Generating…";
  let thinkingLabel = "Waiting for AI…";
  let checklist = DEFAULT_CHECKLIST.map((item) => ({ ...item }));
  let activity = [];
  let progressStart = 0;
  let estimateMs = 150000;
  let progressTimer = null;
  let pollTimer = null;
  let finishTimer = null;

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

  function setDetailsOpen(open) {
    detailsOpen = !!open;
    spinner.classList.toggle("viewport-spinner--expanded", detailsOpen);
    detailsEl?.classList.toggle("hidden", !detailsOpen);
    if (detailsEl) detailsEl.hidden = !detailsOpen;
    if (expandBtn) {
      expandBtn.setAttribute("aria-expanded", detailsOpen ? "true" : "false");
      expandBtn.textContent = detailsOpen ? "Hide" : "Details";
      expandBtn.title = detailsOpen ? "Hide generation steps" : "Show generation steps";
    }
  }

  function renderChecklist() {
    if (!checklistEl) return;
    const items = checklist.length ? checklist : DEFAULT_CHECKLIST;
    checklistEl.innerHTML = items.map((item, index) => {
      const status = item.status || "pending";
      const mark = status === "done" ? "✓" : status === "active" ? "●" : "○";
      const detailRaw = item.detail ? humanizeProgressText(item.detail, "") : "";
      const detail = detailRaw && detailRaw !== item.label
        ? `<span class="viewport-agent-check-detail">${esc(detailRaw)}</span>`
        : "";
      return `
        <li class="viewport-agent-check viewport-agent-check--${esc(status)}" data-status="${esc(status)}">
          <span class="viewport-agent-check-mark" aria-hidden="true">${mark}</span>
          <span class="viewport-agent-check-body">
            <span class="viewport-agent-check-label">${esc(`${index + 1}. ${item.label || item.id || "Step"}`)}</span>
            ${detail}
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
        const cleaned = humanizeProgressText(text, "");
        if (!cleaned || isRawToolLog(text) && cleaned === "Running CAD tools…") {
          // Keep only meaningful stage updates, drop raw tool spam.
          if (isRawToolLog(text) && !/snapshot|inspect|brief|source|STEP|GLB|review|finalize|analyz/i.test(cleaned)) {
            return null;
          }
        }
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
      const stats = stepStats(checklist);
      activityEl.innerHTML = `<li class="viewport-agent-activity-item muted">Step ${stats.current}/${stats.total}: ${esc(stats.label)}</li>`;
      return;
    }
    activityEl.innerHTML = rows.map((row) => {
      const stage = row.stage ? `<span class="viewport-agent-activity-stage">${esc(row.stage)}</span>` : "";
      return `<li class="viewport-agent-activity-item">${stage}<span>${esc(row.text)}</span></li>`;
    }).join("");
  }

  function renderDetails() {
    const stats = stepStats(checklist);
    const nowText = humanizeProgressText(
      thinkingLabel || progressLabel || stats.detail || stats.label,
      stats.label,
    );
    if (thinkingText) {
      thinkingText.textContent = `${stats.current}/${stats.total} · ${nowText}`;
    }
    renderChecklist();
    renderActivity();
  }

  function renderProgress() {
    const pct = Math.round(Math.max(0, Math.min(100, progressValue)));
    const stats = stepStats(checklist);
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPct) progressPct.textContent = `${pct}%`;
    if (progressStep) progressStep.textContent = `${stats.current}/${stats.total}`;
    if (spinnerLabel) {
      const clean = humanizeProgressText(progressLabel || thinkingLabel || stats.label, stats.label);
      spinnerLabel.textContent = `${stats.current}/${stats.total} · ${clean}`;
    }
    renderDetails();
  }

  function applyProgressPayload(progress) {
    if (!progress || typeof progress !== "object") return;
    if (progress.pct != null) {
      const pct = Number(progress.pct);
      if (Number.isFinite(pct)) {
        if (pct > traceProgress) traceProgress = pct;
        if (pct > progressValue) progressValue = pct;
      }
    }
    if (progress.label) {
      progressLabel = humanizeProgressText(progress.label, "Generating…");
      thinkingLabel = humanizeProgressText(progress.thinking || progress.label, progressLabel);
    } else if (progress.thinking) {
      thinkingLabel = humanizeProgressText(progress.thinking, thinkingLabel);
    }
    if (Array.isArray(progress.checklist) && progress.checklist.length) {
      checklist = progress.checklist.map((item) => ({
        id: item.id || item.label,
        label: item.label || item.id || "Step",
        status: item.status || "pending",
        detail: humanizeProgressText(item.detail || "", ""),
      }));
    } else if (progress.stage) {
      checklist = checklistFromStage(progress.stage, progress.label || thinkingLabel);
    }
    if (Array.isArray(progress.activity)) {
      activity = progress.activity
        .map((row) => {
          if (typeof row === "string") {
            return { ts: new Date().toISOString(), text: humanizeProgressText(row, ""), stage: progress.stage };
          }
          return {
            ...row,
            text: humanizeProgressText(row?.text || "", ""),
          };
        })
        .filter((row) => row.text);
    } else if (progress.label) {
      const cleaned = humanizeProgressText(progress.label, "");
      const last = activity.length ? activity[activity.length - 1] : null;
      const lastText = typeof last === "string" ? last : last?.text;
      if (cleaned && lastText !== cleaned) {
        activity = [...activity, { ts: new Date().toISOString(), text: cleaned, stage: progress.stage }].slice(-40);
      }
    }
  }

  function bumpProgress(pct, label) {
    if (!generating) return;
    if (pct > traceProgress) traceProgress = pct;
    if (pct > progressValue) progressValue = pct;
    if (label) {
      progressLabel = label;
      thinkingLabel = label;
      const last = activity.length ? activity[activity.length - 1] : null;
      const lastText = typeof last === "string" ? last : last?.text;
      if (lastText !== label) {
        activity = [...activity, { ts: new Date().toISOString(), text: label }].slice(-40);
      }
    }
    renderProgress();
  }

  function tickProgress() {
    if (!generating) return;
    const elapsed = Date.now() - progressStart;
    // Gentle motion while waiting on long AI calls — never outrun trace-driven progress.
    const idleCap = Math.min(30, (elapsed / estimateMs) * 28);
    const display = Math.max(traceProgress, Math.min(traceProgress + 6, idleCap));
    if (display > progressValue) progressValue = display;
    renderProgress();
  }

  async function pollTraceLogs() {
    if (!generating || !fetchLogs) return;
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
    stopBtn.classList.toggle("hidden", !active);
  }

  function isV2Overlay(opts = {}) {
    const values = [
      opts.promptMode,
      opts.prompt_mode,
      opts.mode,
      opts.generationMode,
      opts.generation_mode,
      opts.variant,
      opts.message,
    ];
    return values.some((value) => /\b(v2|2\.0)\b/i.test(String(value || "")));
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

  function applySpinnerVariant(opts = {}) {
    const fusion = isFusionOverlay(opts);
    spinner.classList.toggle("viewport-spinner--fusion", fusion);
    spinner.classList.toggle("viewport-spinner--v2", !fusion && isV2Overlay(opts));
  }

  function startProgress(message, opts = {}) {
    clearProgressTimers();
    generating = true;
    progressValue = 0;
    traceProgress = 0;
    progressLabel = message;
    thinkingLabel = opts.progress?.thinking || opts.progress?.label || message;
    checklist = Array.isArray(opts.progress?.checklist) && opts.progress.checklist.length
      ? opts.progress.checklist
      : DEFAULT_CHECKLIST.map((item) => ({ ...item }));
    activity = Array.isArray(opts.progress?.activity) ? opts.progress.activity : [];
    progressStart = Date.now();
    estimateMs = opts.estimateMs || (opts.mode === "build" ? 90000 : isV2Overlay(opts) ? 900000 : 360000);
    applySpinnerVariant(opts);
    spinner.classList.remove("hidden");
    clearError();
    viewportEl.appendChild(root);
    renderProgress();
    progressTimer = setInterval(tickProgress, 500);
    if (fetchLogs) {
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
    if (stopBtn) stopBtn.classList.add("hidden");
    progressValue = 0;
    traceProgress = 0;
    checklist = DEFAULT_CHECKLIST.map((item) => ({ ...item }));
    activity = [];
    renderProgress();
  }

  function finishProgress() {
    bumpProgress(100, "Done");
    checklist = checklist.map((item) => ({ ...item, status: "done" }));
    renderProgress();
    clearProgressTimers();
    finishTimer = setTimeout(hideSpinner, 420);
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
      if (generating) {
        if (message) progressLabel = message;
        if (opts.estimateMs) estimateMs = opts.estimateMs;
        if (opts.progress) applyProgressPayload(opts.progress);
        applySpinnerVariant(opts);
        renderProgress();
        return;
      }
      startProgress(message, opts);
      if (opts.progress) applyProgressPayload(opts.progress);
      renderProgress();
      return;
    }
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
    displayText =
      String(message || "").trim() ||
      "Something went wrong — open Prompt History or the Activity Log for details.";
    copyText = `${displayText}${formatCopyContext(context)}`;
    if (bannerText) bannerText.textContent = displayText;
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
  }

  expandBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setDetailsOpen(!detailsOpen);
  });

  stopBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    onStopGeneration?.();
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

  return { setGenerating, isGenerating, setStopVisible, showError, clearError, dismiss };
}
