import {
  getConferenceSeats,
  getLightingPresets,
  normalizeConferenceState,
} from "./workshop-conference-room.js?v=20260918-workshop-conference";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function computeTimerRemainingSeconds(timer = {}) {
  const duration = Number.isFinite(Number(timer.duration_seconds))
    ? Math.max(0, Number(timer.duration_seconds))
    : 0;
  if (!timer.running || !timer.started_at) {
    const stored = Number.isFinite(Number(timer.remaining_seconds))
      ? Number(timer.remaining_seconds)
      : duration;
    return Math.max(0, stored);
  }
  const startedAt = Date.parse(String(timer.started_at));
  if (!Number.isFinite(startedAt)) {
    return Math.max(0, duration);
  }
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const base = Number.isFinite(Number(timer.remaining_seconds))
    ? Number(timer.remaining_seconds)
    : duration;
  return Math.max(0, base - elapsed);
}

export function formatTimerLabel(totalSeconds = 0) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function rosterCard(seat) {
  return `
    <article class="workshop-roster-card">
      <div class="workshop-card-head">
        <strong>${esc(seat.label)}</strong>
        <span class="workshop-pill">${esc(seat.shift)}</span>
      </div>
      <p>${esc(seat.summary)}</p>
      <ul class="workshop-task-list">
        ${seat.skills.map((skill) => `<li><span>${esc(skill)}</span><em>static</em></li>`).join("")}
      </ul>
    </article>
  `;
}

function pluginCardHeader(title, pluginKey, enabled, extra = "") {
  return `
    <div class="workshop-card-head">
      <strong>${esc(title)}</strong>
      <div class="workshop-inline-actions">
        ${extra}
        <button
          type="button"
          class="btn secondary btn-compact"
          data-workshop-plugin-toggle="${esc(pluginKey)}"
          aria-pressed="${enabled ? "true" : "false"}"
        >${enabled ? "Disable" : "Enable"}</button>
      </div>
    </div>
  `;
}

export function renderWorkshopPluginRackPanel({
  state,
  checkpointDraft = {},
  checkpointOpen = false,
} = {}) {
  const conference = normalizeConferenceState(state, {
    projectId: state?.active_project_id || "",
    projectName: state?.project_label || "Project",
  });
  const plugins = conference.plugin_modules || {};
  const timer = plugins.timers || {};
  const timerRemaining = computeTimerRemainingSeconds(timer);
  const lighting = plugins.lighting || {};
  const tvFeed = plugins.tv_feed || {};
  const notes = plugins.notes || {};
  const freeReign = plugins.free_reign || {};
  const shiftSkills = plugins.shift_skills || {};
  const seats = getConferenceSeats();
  return `
    <div class="workshop-plugin-rack-grid">
      <article class="workshop-card">
        ${pluginCardHeader("TV", "tv_feed", !!tvFeed.enabled, `<span class="workshop-pill workshop-pill--waiting">stub</span>`)}
        <p>${esc(tvFeed.source_note || "No live TV feed is wired yet.")}</p>
      </article>
      <article class="workshop-card">
        ${pluginCardHeader("Lighting", "lighting", !!lighting.enabled, `<span class="workshop-pill workshop-pill--waiting">stub</span>`)}
        <p>Preset control is UI-only for v1, but room-level enable/disable persists.</p>
        <div class="workshop-inline-actions">
          ${getLightingPresets().map((preset) => `
            <button
              type="button"
              class="workshop-chip-button${lighting.preset === preset.id ? " active" : ""}"
              data-workshop-lighting-preset="${esc(preset.id)}"
            >${esc(preset.label)}</button>
          `).join("")}
        </div>
      </article>
      <article class="workshop-card">
        ${pluginCardHeader("Timers", "timers", !!timer.enabled)}
        <p>Timer math runs in real seconds and persists with the conference session state.</p>
        <label class="workshop-field-label" for="workshop-plugin-timer-duration">Duration (seconds)</label>
        <input
          id="workshop-plugin-timer-duration"
          class="workshop-text-input"
          type="number"
          min="5"
          max="86400"
          step="1"
          value="${esc(timer.duration_seconds || 900)}"
          data-workshop-timer-duration
        />
        <div class="workshop-timer-row">
          <strong data-workshop-timer-remaining>${esc(formatTimerLabel(timerRemaining))}</strong>
          <span>${timer.running ? "running" : "paused"}</span>
        </div>
        <div class="workshop-inline-actions">
          <button type="button" class="btn accent btn-compact" data-workshop-timer-start>${timer.running ? "Restart" : "Start"}</button>
          <button type="button" class="btn secondary btn-compact" data-workshop-timer-pause>Pause</button>
          <button type="button" class="btn secondary btn-compact" data-workshop-timer-reset>Reset</button>
        </div>
      </article>
      <article class="workshop-card">
        ${pluginCardHeader("Agent shift / skills", "shift_skills", !!shiftSkills.enabled)}
        <p>Static roster config for this room:</p>
        <div class="workshop-roster-grid">
          ${seats.map((seat) => rosterCard(seat)).join("")}
        </div>
      </article>
      <article class="workshop-card">
        ${pluginCardHeader("Notes file", "notes", !!notes.enabled)}
        <p>Notes are edited in the Room tab and saved as sandbox markdown.</p>
        <div class="workshop-path-grid">
          <div class="workshop-path-row"><span>notes .md</span><code>${esc(notes.notes_path || "save the room state first")}</code></div>
          <div class="workshop-path-row"><span>KB mirror</span><code>${esc(notes.kb_entry_path || "save the room state first")}</code></div>
        </div>
      </article>
      <article class="workshop-card">
        ${pluginCardHeader("Sandbox free-reign", "free_reign", !!freeReign.enabled, `<span class="workshop-pill workshop-pill--waiting">checkpoint stub</span>`)}
        <p>Open the checkpoint UI to save a sandbox experiment marker for this conference session.</p>
        <div class="workshop-inline-actions">
          <button type="button" class="btn secondary btn-compact" data-workshop-checkpoint-open>${checkpointOpen ? "Hide checkpoint UI" : "Open checkpoint UI"}</button>
        </div>
        ${freeReign.last_checkpoint_path ? `
          <div class="workshop-path-grid">
            <div class="workshop-path-row"><span>last checkpoint</span><code>${esc(freeReign.last_checkpoint_path)}</code></div>
          </div>
        ` : ""}
        ${checkpointOpen ? `
          <div class="workshop-checkpoint-form">
            <label class="workshop-field-label" for="workshop-checkpoint-title">Checkpoint title</label>
            <input id="workshop-checkpoint-title" class="workshop-text-input" type="text" maxlength="120" value="${esc(checkpointDraft.title || "")}" />
            <label class="workshop-field-label" for="workshop-checkpoint-goal">Experiment</label>
            <textarea id="workshop-checkpoint-goal" class="workshop-notes-input" rows="4">${esc(checkpointDraft.experiment_goal || "")}</textarea>
            <label class="workshop-field-label" for="workshop-checkpoint-safety">Safety note</label>
            <textarea id="workshop-checkpoint-safety" class="workshop-notes-input" rows="3">${esc(checkpointDraft.safety_note || "")}</textarea>
            <div class="workshop-inline-actions">
              <button type="button" class="btn accent btn-compact" data-workshop-checkpoint-save>Save checkpoint stub</button>
            </div>
          </div>
        ` : ""}
      </article>
    </div>
  `;
}
