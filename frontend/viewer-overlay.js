/** Bottom-right HUD spinner, progress bar, and clickable error banner in the 3D viewport. */

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
];

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
    </div>
    <div class="viewport-spinner-body">
      <p class="viewport-spinner-label">Generating…</p>
      <div class="viewport-progress" aria-hidden="true">
        <div class="viewport-progress-track">
          <div class="viewport-progress-fill"></div>
        </div>
        <div class="viewport-progress-meta">
          <span class="viewport-progress-pct">0%</span>
          <span class="viewport-progress-eta muted small"></span>
        </div>
      </div>
      <button type="button" class="btn danger viewport-stop-btn hidden" aria-label="Stop generating">Stop generating</button>
    </div>
  `;
  const spinnerLabel = spinner.querySelector(".viewport-spinner-label");
  const stopBtn = spinner.querySelector(".viewport-stop-btn");
  const progressFill = spinner.querySelector(".viewport-progress-fill");
  const progressPct = spinner.querySelector(".viewport-progress-pct");
  const progressEta = spinner.querySelector(".viewport-progress-eta");

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
  let progressValue = 0;
  let traceProgress = 0;
  let progressLabel = "Generating…";
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

  function formatEta(remainingMs) {
    if (remainingMs <= 0) return "Finishing up…";
    const sec = Math.ceil(remainingMs / 1000);
    if (sec < 60) return `~${sec}s left`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return rem ? `~${min}m ${rem}s left` : `~${min}m left`;
  }

  function computeRemainingMs() {
    const elapsed = Date.now() - progressStart;
    if (progressValue >= 98) return 0;

    const budgetLeft = estimateMs - elapsed;

    // Over budget: be honest instead of showing "~0s left" for minutes on end.
    if (budgetLeft <= 0) {
      return null;
    }

    // Stage-informed extrapolation once trace logs have moved the needle.
    if (traceProgress >= 18) {
      const projectedTotal = elapsed / (traceProgress / 100);
      const extrapolated = projectedTotal - elapsed;
      // Blend budget and extrapolation — conservative (use the larger remaining time).
      return Math.max(budgetLeft, extrapolated);
    }

    return budgetLeft;
  }

  function formatEtaLabel() {
    const pct = Math.round(Math.max(0, Math.min(100, progressValue)));
    if (pct >= 98) return "Finishing up…";
    const remaining = computeRemainingMs();
    if (remaining == null) return "Taking longer than usual…";
    return formatEta(remaining);
  }

  function renderProgress() {
    const pct = Math.round(Math.max(0, Math.min(100, progressValue)));
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPct) progressPct.textContent = `${pct}%`;
    if (spinnerLabel) spinnerLabel.textContent = progressLabel;
    if (progressEta && progressStart) {
      progressEta.textContent = formatEtaLabel();
    }
  }

  function bumpProgress(pct, label) {
    if (!generating) return;
    if (pct > traceProgress) traceProgress = pct;
    if (pct > progressValue) progressValue = pct;
    if (label) progressLabel = label;
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
    return (opts.promptMode || "").toLowerCase() === "v2";
  }

  function applySpinnerVariant(opts = {}) {
    spinner.classList.toggle("viewport-spinner--v2", isV2Overlay(opts));
  }

  function startProgress(message, opts = {}) {
    clearProgressTimers();
    generating = true;
    progressValue = 0;
    traceProgress = 0;
    progressLabel = message;
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
    spinner.classList.add("hidden");
    spinner.classList.remove("viewport-spinner--v2");
    if (stopBtn) stopBtn.classList.add("hidden");
    progressValue = 0;
    traceProgress = 0;
    renderProgress();
  }

  function finishProgress() {
    bumpProgress(100, "Done");
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
        applySpinnerVariant(opts);
        renderProgress();
        return;
      }
      startProgress(message, opts);
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
