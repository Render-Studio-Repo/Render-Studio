import {
  clearSandboxClientState,
  clearSandboxPreviews,
  createSandboxSessionKey,
  loadSandboxClientState,
  loadSandboxPreviews,
  saveSandboxClientState,
  saveSandboxPreviews,
} from "./workshop-sandbox-storage.js?v=20260918-sandbox-redesign";

const SANDBOX_HASH = "#sandbox";
const LEGACY_WORKSHOP_HASH = "#workshop";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSandboxHash(hash) {
  return hash === SANDBOX_HASH || hash === LEGACY_WORKSHOP_HASH;
}

function normalizeSandboxState(input, projectName = "Project") {
  const value = input && typeof input === "object" ? input : {};
  const sandbox = value.sandbox && typeof value.sandbox === "object" ? value.sandbox : {};
  const currentIndex = Number.isFinite(Number(sandbox.current_index)) ? Number(sandbox.current_index) : -1;
  const checkpointIndex = Number.isFinite(Number(sandbox.checkpoint_index)) ? Number(sandbox.checkpoint_index) : -1;
  const checkpointEntry = sandbox.checkpoint_entry && typeof sandbox.checkpoint_entry === "object"
    ? sandbox.checkpoint_entry
    : null;
  return {
    project_label: String(value.project_label || projectName || "Project").trim() || "Project",
    sandbox: {
      active: !!sandbox.active,
      session_key: String(sandbox.session_key || "").trim(),
      checkpoint_id: String(sandbox.checkpoint_id || "").trim(),
      checkpoint_index: checkpointIndex,
      checkpoint_label: String(sandbox.checkpoint_label || "Restore point").trim() || "Restore point",
      checkpoint_filename: String(sandbox.checkpoint_filename || "").trim(),
      checkpoint_entry_id: String(sandbox.checkpoint_entry_id || "").trim(),
      entered_at: String(sandbox.entered_at || "").trim(),
      last_action: String(sandbox.last_action || "").trim(),
      last_action_at: String(sandbox.last_action_at || "").trim(),
      last_restored_at: String(sandbox.last_restored_at || "").trim(),
      timeline_entries: Number.isFinite(Number(sandbox.timeline_entries)) ? Number(sandbox.timeline_entries) : 0,
      current_index: currentIndex,
      current_label: String(sandbox.current_label || "").trim(),
      changes_since_checkpoint: Number.isFinite(Number(sandbox.changes_since_checkpoint))
        ? Math.max(0, Number(sandbox.changes_since_checkpoint))
        : Math.max(0, currentIndex - checkpointIndex),
      checkpoint_entry: checkpointEntry,
    },
  };
}

function formatWhen(value) {
  if (!value) return "just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function waitFrames(count = 2) {
  return new Promise((resolve) => {
    const step = (remaining) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      window.requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

function summarizeEntry(entry) {
  if (!entry || typeof entry !== "object") return "";
  return String(entry.label || entry.filename || entry.kind || "").trim();
}

export function createWorkshopMode({
  viewportEl,
  renderer,
  controls,
  getProjectId,
  getProjectName,
  getTimelineState,
  api,
  setStatus,
  toggleDictation,
  setStudioPromptText,
  clearStudioSelection,
  applyLatestTimelineMutation,
}) {
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "workshop-enter-affordance workshop-enter-affordance--sandbox";
  launcher.innerHTML = `
    <span class="workshop-enter-affordance-icon" aria-hidden="true">SB</span>
    <span class="workshop-enter-affordance-copy">
      <strong>Sandbox</strong>
      <small>Checkpoint, compare, test, then keep or discard</small>
    </span>
  `;
  viewportEl.appendChild(launcher);

  const root = document.createElement("section");
  root.className = "workshop-shell workshop-shell--sandbox hidden";
  root.hidden = true;
  viewportEl.appendChild(root);

  let active = false;
  let workshopState = normalizeSandboxState(null, "Project");
  let workshopError = "";
  let activeProjectId = "";
  let loadedProjectId = "";
  let activePanelTab = "session";
  let compareMode = "split";
  let compareFocus = "current";
  let voiceDraft = "";
  let previewState = {};
  let busyAction = "";
  let loadToken = 0;
  let sessionKey = "";
  const dictationInputId = "sandbox-voice-input";

  function currentProjectName() {
    return String(getProjectName?.() || activeProjectId || "Project").trim() || "Project";
  }

  function currentTimeline() {
    const value = getTimelineState?.();
    return value && typeof value === "object" ? value : null;
  }

  function currentTimelineEntry() {
    const timeline = currentTimeline();
    const index = Number.isFinite(Number(timeline?.current_index)) ? Number(timeline.current_index) : -1;
    return index >= 0 ? timeline?.entries?.[index] || null : null;
  }

  function getCurrentFilename() {
    const entry = currentTimelineEntry();
    return String(entry?.filename || workshopState.sandbox.current_label || "").trim();
  }

  function getCurrentEntryLabel() {
    const entry = currentTimelineEntry();
    return summarizeEntry(entry) || workshopState.sandbox.current_label || getCurrentFilename() || "Latest workspace state";
  }

  function currentChangeCount() {
    const timeline = currentTimeline();
    const currentIndex = Number.isFinite(Number(timeline?.current_index)) ? Number(timeline.current_index) : NaN;
    if (Number.isFinite(currentIndex)) {
      return Math.max(0, currentIndex - Number(workshopState.sandbox.checkpoint_index || -1));
    }
    return Math.max(0, Number(workshopState.sandbox.changes_since_checkpoint || 0));
  }

  function loadClientState(projectId) {
    const stored = loadSandboxClientState(projectId);
    activePanelTab = String(stored.activePanelTab || "session");
    compareMode = stored.compareMode === "ab" ? "ab" : "split";
    compareFocus = stored.compareFocus === "checkpoint" ? "checkpoint" : "current";
    voiceDraft = String(stored.voiceDraft || "");
    sessionKey = String(stored.sessionKey || "");
    previewState = sessionKey ? loadSandboxPreviews(projectId, sessionKey) : {};
  }

  function saveClientState() {
    if (!activeProjectId) return;
    saveSandboxClientState(activeProjectId, {
      activePanelTab,
      compareMode,
      compareFocus,
      voiceDraft,
      sessionKey,
    });
  }

  function loadPreviewState() {
    previewState = activeProjectId && sessionKey ? loadSandboxPreviews(activeProjectId, sessionKey) : {};
  }

  function savePreviewState() {
    if (!activeProjectId || !sessionKey) return;
    saveSandboxPreviews(activeProjectId, sessionKey, previewState);
  }

  function clearLocalSessionState() {
    if (activeProjectId) {
      clearSandboxClientState(activeProjectId);
      if (sessionKey) clearSandboxPreviews(activeProjectId, sessionKey);
    }
    sessionKey = "";
    previewState = {};
  }

  function updateRoute(activeRoute) {
    const url = new URL(window.location.href);
    if (activeRoute) {
      if (url.hash === SANDBOX_HASH) return;
      window.history.pushState({}, "", `${url.pathname}${url.search}${SANDBOX_HASH}`);
      return;
    }
    if (!isSandboxHash(url.hash)) return;
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  async function captureViewportPreview() {
    const canvas = renderer?.domElement;
    if (!canvas) return "";
    const prevVisibility = root.style.visibility;
    root.style.visibility = "hidden";
    await waitFrames(2);
    try {
      const sourceWidth = canvas.width || canvas.clientWidth || 0;
      const sourceHeight = canvas.height || canvas.clientHeight || 0;
      if (!sourceWidth || !sourceHeight) return "";
      const maxWidth = 560;
      const scale = Math.min(1, maxWidth / sourceWidth);
      const width = Math.max(320, Math.round(sourceWidth * scale));
      const height = Math.max(180, Math.round(sourceHeight * scale));
      const temp = document.createElement("canvas");
      temp.width = width;
      temp.height = height;
      const ctx = temp.getContext("2d");
      if (!ctx) return "";
      ctx.drawImage(canvas, 0, 0, width, height);
      return temp.toDataURL("image/jpeg", 0.82);
    } catch {
      return "";
    } finally {
      root.style.visibility = prevVisibility;
      await waitFrames(1);
    }
  }

  async function capturePreview(kind, { onlyIfMissing = false, silent = false } = {}) {
    if (!activeProjectId || !sessionKey) return "";
    if (onlyIfMissing && previewState?.[kind]) return previewState[kind];
    const dataUrl = await captureViewportPreview();
    if (!dataUrl) {
      if (!silent) setStatus?.("error", "Could not capture a compare preview right now.");
      return "";
    }
    previewState = {
      ...previewState,
      [kind]: dataUrl,
      [`${kind}_at`]: new Date().toISOString(),
    };
    savePreviewState();
    render();
    if (!silent) {
      setStatus?.("ok", kind === "checkpoint" ? "Saved the restore-point preview." : "Updated the current draft preview.");
    }
    return dataUrl;
  }

  async function syncSession(force = false) {
    const projectId = String(getProjectId?.() || "").trim();
    activeProjectId = projectId;
    if (!projectId) {
      workshopState = normalizeSandboxState(null, currentProjectName());
      workshopError = "Open a project to start Sandbox.";
      render();
      return;
    }
    if (!force && loadedProjectId === projectId && workshopState.sandbox.active) {
      render();
      return;
    }
    loadClientState(projectId);
    if (!sessionKey) sessionKey = createSandboxSessionKey();
    saveClientState();
    workshopError = "";
    busyAction = "starting";
    render();
    const token = ++loadToken;
    try {
      const data = await api(`/api/projects/${projectId}/workshop/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_key: sessionKey }),
      });
      if (token !== loadToken) return;
      workshopState = normalizeSandboxState(data.workshop || data, currentProjectName());
      sessionKey = workshopState.sandbox.session_key || sessionKey;
      loadedProjectId = projectId;
      saveClientState();
      loadPreviewState();
      render();
      await capturePreview("checkpoint", { onlyIfMissing: true, silent: true });
      await capturePreview("current", { silent: true });
    } catch (err) {
      if (token !== loadToken) return;
      workshopState = normalizeSandboxState(null, currentProjectName());
      workshopError = err?.message || "Could not start Sandbox for this project.";
      loadedProjectId = projectId;
    } finally {
      if (token === loadToken) {
        busyAction = "";
        render();
      }
    }
  }

  async function restoreCheckpoint({ endSession = false } = {}) {
    const projectId = String(getProjectId?.() || "").trim();
    if (!projectId || busyAction) return;
    if (endSession && !window.confirm("Discard the current sandbox changes and restore the entry point?")) return;
    busyAction = endSession ? "discarding" : "restoring";
    render();
    try {
      const path = endSession ? "discard" : "restore";
      const data = await api(`/api/projects/${projectId}/workshop/session/${path}`, { method: "POST" });
      await applyLatestTimelineMutation?.(data, {
        successMessage: endSession
          ? "Discarded sandbox changes and restored the entry point."
          : "Restored the sandbox back to the entry point.",
      });
      workshopState = normalizeSandboxState(data.workshop || data, currentProjectName());
      if (endSession) {
        clearLocalSessionState();
        exit();
        return;
      }
      loadPreviewState();
      await capturePreview("current", { silent: true });
      render();
    } catch (err) {
      setStatus?.("error", err?.message || "Could not restore the Sandbox entry point.");
    } finally {
      busyAction = "";
      render();
    }
  }

  async function publishSandbox() {
    const projectId = String(getProjectId?.() || "").trim();
    if (!projectId || busyAction) return;
    if (!window.confirm("Push the current sandbox draft live and clear this restore point?")) return;
    busyAction = "publishing";
    render();
    try {
      const data = await api(`/api/projects/${projectId}/workshop/session/publish`, { method: "POST" });
      workshopState = normalizeSandboxState(data.workshop || data, currentProjectName());
      clearLocalSessionState();
      setStatus?.("ok", "Sandbox changes kept. Back in Studio.");
      exit();
    } catch (err) {
      setStatus?.("error", err?.message || "Could not push this sandbox draft live.");
    } finally {
      busyAction = "";
      render();
    }
  }

  function copyVoicePrompt({ submit = false } = {}) {
    const input = root.querySelector(`#${CSS.escape(dictationInputId)}`);
    const text = String(input?.value || "").trim();
    if (!text) {
      setStatus?.("error", "Enter a prompt before sending it to AI.");
      return;
    }
    setStudioPromptText?.(text, { submit });
  }

  function renderStagePreview(title, kind, meta) {
    const action = kind === "checkpoint"
      ? ""
      : `<button type="button" class="btn secondary btn-compact" data-workshop-refresh-preview="current">Refresh current</button>`;
    const image = previewState?.[kind]
      ? `<img src="${esc(previewState[kind])}" alt="${esc(title)} preview" class="workshop-compare-image" />`
      : `<div class="workshop-preview-placeholder">
          <strong>${esc(title)}</strong>
          <span>${kind === "checkpoint" ? "This preview is captured when the session begins." : "Refresh after edits to capture the latest draft."}</span>
        </div>`;
    return `
      <article class="workshop-compare-card">
        <div class="workshop-compare-card-head">
          <div>
            <strong>${esc(title)}</strong>
            <span>${esc(meta)}</span>
          </div>
          ${action}
        </div>
        <div class="workshop-compare-media">${image}</div>
      </article>
    `;
  }

  function renderSplitCompare() {
    return `
      <div class="workshop-compare-grid">
        ${renderStagePreview(
          "When you entered",
          "checkpoint",
          workshopState.sandbox.checkpoint_label || "Restore point",
        )}
        ${renderStagePreview(
          "Current draft",
          "current",
          getCurrentEntryLabel(),
        )}
      </div>
    `;
  }

  function renderAbCompare() {
    const showingCheckpoint = compareFocus === "checkpoint";
    const kind = showingCheckpoint ? "checkpoint" : "current";
    const title = showingCheckpoint ? "When you entered" : "Current draft";
    const meta = showingCheckpoint
      ? (workshopState.sandbox.checkpoint_label || "Restore point")
      : getCurrentEntryLabel();
    return `
      <div class="workshop-ab-toggle" role="tablist" aria-label="Sandbox compare">
        <button type="button" class="workshop-ab-tab${showingCheckpoint ? " active" : ""}" data-workshop-compare-focus="checkpoint">A · When you entered</button>
        <button type="button" class="workshop-ab-tab${!showingCheckpoint ? " active" : ""}" data-workshop-compare-focus="current">B · Current draft</button>
      </div>
      ${renderStagePreview(title, kind, meta)}
    `;
  }

  function renderStage() {
    const changeCount = currentChangeCount();
    return `
      <div class="workshop-stage-surface">
        <div class="workshop-stage-copy">
          <span class="workshop-kicker">Sandbox</span>
          <h3>Use the full Studio canvas, not a cramped side room.</h3>
          <p>Keep editing in the viewport with the normal Studio tools. Sandbox keeps a restore point from the moment you entered so you can compare, test, and decide with confidence.</p>
        </div>
        <div class="workshop-stage-metrics">
          <span>${pluralize(changeCount, "change")} since entry</span>
          <span>${workshopState.sandbox.checkpoint_label || "Restore point ready"}</span>
          <span>${workshopState.sandbox.entered_at ? `Saved ${formatWhen(workshopState.sandbox.entered_at)}` : "Restore point ready"}</span>
        </div>
        <div class="workshop-compare-showcase">
          <div class="workshop-compare-showcase-head">
            <div>
              <strong>Compare your draft before you commit to it</strong>
              <span>Switch between side-by-side and A/B to review the current draft against the restore point.</span>
            </div>
            <div class="workshop-mode-switch" role="tablist" aria-label="Compare modes">
              <button type="button" class="workshop-mode-switch-btn${compareMode === "split" ? " active" : ""}" data-workshop-compare-mode="split">Side by side</button>
              <button type="button" class="workshop-mode-switch-btn${compareMode === "ab" ? " active" : ""}" data-workshop-compare-mode="ab">A / B</button>
            </div>
          </div>
          ${compareMode === "ab" ? renderAbCompare() : renderSplitCompare()}
        </div>
      </div>
    `;
  }

  function renderSessionPanel() {
    const checkpoint = workshopState.sandbox;
    const currentLabel = getCurrentEntryLabel();
    return `
      <div class="workshop-panel-stack">
        <article class="workshop-card workshop-session-card">
          <div class="workshop-card-head">
            <strong>Restore point</strong>
            <span class="workshop-pill">${checkpoint.entered_at ? formatWhen(checkpoint.entered_at) : "ready"}</span>
          </div>
          <p>Sandbox saved this project exactly as it was when you entered. Use it as your safety line while you test changes.</p>
          <div class="workshop-stat-list">
            <div><span>Saved state</span><strong>${esc(checkpoint.checkpoint_label || "Starting point")}</strong></div>
            <div><span>Timeline step</span><strong>${checkpoint.checkpoint_index >= 0 ? `#${checkpoint.checkpoint_index + 1}` : "Starting point"}</strong></div>
            <div><span>Changes since entry</span><strong>${pluralize(currentChangeCount(), "change")}</strong></div>
          </div>
          <div class="workshop-inline-actions">
            <button type="button" class="btn secondary btn-compact" data-workshop-restore-entry>Restore to entry point</button>
          </div>
        </article>
        <article class="workshop-card workshop-session-card">
          <div class="workshop-card-head">
            <strong>Current draft</strong>
            <span class="workshop-pill workshop-pill--pending">${pluralize(currentChangeCount(), "change")}</span>
          </div>
          <p>Use the normal Studio controls to orbit, inspect, select, and edit. When the draft looks right, refresh the preview and compare it against the restore point.</p>
          <div class="workshop-stat-list">
            <div><span>Current state</span><strong>${esc(currentLabel)}</strong></div>
            <div><span>Latest file</span><strong>${esc(getCurrentFilename() || "Workspace state")}</strong></div>
            <div><span>Last restore</span><strong>${checkpoint.last_restored_at ? formatWhen(checkpoint.last_restored_at) : "Not used yet"}</strong></div>
          </div>
          <div class="workshop-inline-actions">
            <button type="button" class="btn secondary btn-compact" data-workshop-refresh-preview="current">Refresh current preview</button>
            <button type="button" class="btn secondary btn-compact" data-workshop-panel="compare">Open compare</button>
          </div>
        </article>
        <article class="workshop-card workshop-session-card">
          <div class="workshop-card-head">
            <strong>How Sandbox works</strong>
          </div>
          <ol class="workshop-checklist">
            <li>Enter Sandbox to capture a restore point for the current project.</li>
            <li>Use the full Studio viewport to make and test changes.</li>
            <li>Compare the current draft against the restore point before choosing Push to live or Discard.</li>
          </ol>
        </article>
      </div>
    `;
  }

  function renderComparePanel() {
    return `
      <div class="workshop-panel-stack">
        <article class="workshop-card workshop-session-card">
          <div class="workshop-card-head">
            <strong>Compare modes</strong>
          </div>
          <p>Side by side works well for shape, silhouette, and overall layout. A / B is better when you want to study one version at a time without shrinking it.</p>
          <div class="workshop-inline-actions">
            <button type="button" class="btn secondary btn-compact" data-workshop-compare-mode="split">Side by side</button>
            <button type="button" class="btn secondary btn-compact" data-workshop-compare-mode="ab">A / B</button>
          </div>
        </article>
        <article class="workshop-card workshop-session-card">
          <div class="workshop-card-head">
            <strong>Refresh the visuals</strong>
          </div>
          <p>Refresh the current draft preview after a meaningful edit or before you make the final keep/discard decision.</p>
          <div class="workshop-inline-actions">
            <button type="button" class="btn secondary btn-compact" data-workshop-refresh-preview="current">Refresh current preview</button>
          </div>
        </article>
      </div>
    `;
  }

  function renderPromptPanel() {
    return `
      <div class="workshop-panel-stack">
        <article class="workshop-card workshop-session-card">
          <div class="workshop-card-head">
            <strong>Prompt the next change</strong>
          </div>
          <p>Use Sandbox to test prompt ideas before you decide whether the resulting draft should stay live.</p>
          <textarea id="${esc(dictationInputId)}" class="workshop-voice-input" rows="6" placeholder="Describe the next change you want to test in Sandbox...">${esc(voiceDraft)}</textarea>
          <div class="workshop-inline-actions">
            <button type="button" class="btn secondary btn-compact" data-workshop-dictate>Mic</button>
            <button type="button" class="btn secondary btn-compact" data-workshop-copy-prompt>Use in AI prompt</button>
            <button type="button" class="btn accent btn-compact" data-workshop-run-prompt>Run in AI prompt</button>
          </div>
        </article>
      </div>
    `;
  }

  function renderSidePanel() {
    return `
      <aside class="workshop-sidebar">
        <div class="workshop-top-tabs" role="tablist" aria-label="Sandbox panels">
          <button type="button" class="workshop-top-tab${activePanelTab === "session" ? " active" : ""}" data-workshop-panel="session">Session</button>
          <button type="button" class="workshop-top-tab${activePanelTab === "compare" ? " active" : ""}" data-workshop-panel="compare">Compare</button>
          <button type="button" class="workshop-top-tab${activePanelTab === "prompt" ? " active" : ""}" data-workshop-panel="prompt">Prompt</button>
        </div>
        <div class="workshop-panel-scroll">
          ${activePanelTab === "session" ? renderSessionPanel() : ""}
          ${activePanelTab === "compare" ? renderComparePanel() : ""}
          ${activePanelTab === "prompt" ? renderPromptPanel() : ""}
        </div>
      </aside>
    `;
  }

  function bindRootEvents() {
    root.querySelectorAll("[data-workshop-panel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activePanelTab = btn.getAttribute("data-workshop-panel") || "session";
        saveClientState();
        render();
      });
    });
    root.querySelectorAll("[data-workshop-compare-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        compareMode = btn.getAttribute("data-workshop-compare-mode") === "ab" ? "ab" : "split";
        saveClientState();
        render();
      });
    });
    root.querySelectorAll("[data-workshop-compare-focus]").forEach((btn) => {
      btn.addEventListener("click", () => {
        compareFocus = btn.getAttribute("data-workshop-compare-focus") === "checkpoint" ? "checkpoint" : "current";
        saveClientState();
        render();
      });
    });
    root.querySelector("[data-workshop-exit]")?.addEventListener("click", () => exit());
    root.querySelector("[data-workshop-restore-entry]")?.addEventListener("click", () => {
      void restoreCheckpoint({ endSession: false });
    });
    root.querySelector("[data-workshop-discard]")?.addEventListener("click", () => {
      void restoreCheckpoint({ endSession: true });
    });
    root.querySelector("[data-workshop-publish]")?.addEventListener("click", () => {
      void publishSandbox();
    });
    root.querySelectorAll("[data-workshop-refresh-preview]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = "current";
        void capturePreview(kind);
      });
    });
    root.querySelector("[data-workshop-dictate]")?.addEventListener("click", async () => {
      await toggleDictation?.(dictationInputId, root.querySelector("[data-workshop-dictate]"));
    });
    root.querySelector(`#${CSS.escape(dictationInputId)}`)?.addEventListener("input", (event) => {
      voiceDraft = event.target?.value || "";
      saveClientState();
    });
    root.querySelector("[data-workshop-copy-prompt]")?.addEventListener("click", () => copyVoicePrompt({ submit: false }));
    root.querySelector("[data-workshop-run-prompt]")?.addEventListener("click", () => copyVoicePrompt({ submit: true }));
  }

  function render() {
    const canOpen = !!String(getProjectId?.() || "").trim();
    launcher.hidden = active;
    launcher.disabled = !canOpen;
    launcher.title = canOpen ? "Open Sandbox for this project" : "Open a project first";
    root.hidden = !active;
    root.classList.toggle("hidden", !active);
    if (!active) return;

    const projectName = workshopState.project_label || currentProjectName();
    const checkpoint = workshopState.sandbox;
    root.innerHTML = `
      <div class="workshop-shell-card workshop-shell-card--sandbox">
        <header class="workshop-shell-head workshop-shell-head--sandbox">
          <div>
            <span class="workshop-kicker">Sandbox</span>
            <h2>${esc(projectName)}</h2>
            <p>Try changes safely, compare them against the moment you entered, then choose whether to keep or discard the draft.</p>
          </div>
          <div class="workshop-shell-actions">
            <span class="workshop-route-pill">${esc(SANDBOX_HASH)}</span>
            <button type="button" class="btn secondary btn-compact" data-workshop-exit>Back to Studio</button>
          </div>
        </header>
        ${workshopError ? `<div class="workshop-inline-error">${esc(workshopError)}</div>` : ""}
        <div class="workshop-shell-grid">
          ${renderStage()}
          ${renderSidePanel()}
        </div>
        <footer class="workshop-action-bar">
          <div class="workshop-action-copy">
            <strong>${busyAction ? esc(busyAction.replace("-", " ")) : "Compare first, then decide."}</strong>
            <span>${checkpoint.active
              ? "Your restore point stays available until you push live or discard the session."
              : "The last Sandbox session is closed. Enter again to capture a new restore point."}</span>
          </div>
          <div class="workshop-action-buttons">
            <button type="button" class="btn secondary btn-compact" data-workshop-discard ${busyAction ? "disabled" : ""}>Discard sandbox changes</button>
            <button type="button" class="btn accent btn-compact" data-workshop-publish ${busyAction ? "disabled" : ""}>Push to live</button>
          </div>
        </footer>
      </div>
    `;
    bindRootEvents();
  }

  async function enter() {
    if (active) return;
    if (!String(getProjectId?.() || "").trim()) {
      setStatus?.("error", "Open a project before entering Sandbox.");
      return;
    }
    activeProjectId = String(getProjectId?.() || "").trim();
    loadClientState(activeProjectId);
    clearStudioSelection?.();
    active = true;
    workshopError = "";
    document.body.classList.add("workshop-mode-active", "sandbox-mode-active");
    updateRoute(true);
    await syncSession(true);
    setStatus?.("ok", "Sandbox ready. Compare and test before you commit.");
    render();
  }

  function exit({ keepRoute = false } = {}) {
    if (!active) return;
    active = false;
    document.body.classList.remove("workshop-mode-active", "sandbox-mode-active");
    if (!keepRoute) updateRoute(false);
    render();
  }

  function update() {
    controls?.update?.();
  }

  function setProjectContext() {
    const nextId = String(getProjectId?.() || "").trim();
    if (nextId === activeProjectId) return;
    activeProjectId = nextId;
    loadedProjectId = "";
    workshopState = normalizeSandboxState(null, currentProjectName());
    workshopError = "";
    if (active) {
      void syncSession(true);
    } else {
      loadClientState(nextId);
      render();
    }
  }

  launcher.addEventListener("click", () => {
    if (active) return;
    void enter();
  });

  window.addEventListener("hashchange", () => {
    if (isSandboxHash(window.location.hash)) {
      if (!active && String(getProjectId?.() || "").trim()) void enter();
      return;
    }
    if (active) exit({ keepRoute: true });
  });

  window.addEventListener("keydown", (event) => {
    if (!active || event.key !== "Escape") return;
    const tag = String(event.target?.tagName || "").toLowerCase();
    const inField = tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable;
    if (inField) return;
    event.preventDefault();
    exit();
  }, true);

  render();
  if (isSandboxHash(window.location.hash) && String(getProjectId?.() || "").trim()) {
    void enter();
  }

  return {
    enter,
    exit,
    isActive() {
      return active;
    },
    update,
    setProjectContext,
  };
}
