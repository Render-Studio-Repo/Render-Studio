const MUTED_AGENT_PREFIX = "render3d:workshop-muted-agents:v1:";
const ACTIVE_TASK_STATUSES = new Set([
  "active",
  "busy",
  "claimed",
  "current",
  "in-progress",
  "in_progress",
  "running",
  "working",
]);

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (!value || typeof value !== "object") return "";
  return firstText(
    value.title,
    value.name,
    value.label,
    value.summary,
    value.task,
    value.claim,
    value.description,
    value.text,
  );
}

function firstText(...values) {
  for (const value of values) {
    const text = readText(value);
    if (text) return text;
  }
  return "";
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function agentStorageId(agent, index) {
  return String(
    agent?.id
    || agent?.profile?.id
    || agent?.handle
    || agent?.name
    || agent?.display_name
    || `agent-${index}`,
  ).trim();
}

function agentName(agent) {
  return firstText(
    agent?.profile?.display_name,
    agent?.profile?.name,
    agent?.display_name,
    agent?.name,
    agent?.profile_name,
    agent?.handle,
    agent?.id,
  ) || "Agent";
}

function agentRole(agent) {
  return firstText(
    agent?.profile?.role_label,
    agent?.profile?.role_name,
    agent?.profile?.role,
    agent?.profile?.title,
    agent?.role_label,
    agent?.role_name,
    agent?.role,
    agent?.title,
    agent?.persona,
  );
}

function agentStatus(agent) {
  return firstText(
    agent?.status_label,
    agent?.status,
    agent?.presence,
    agent?.state,
  ) || "Ready";
}

function activeTaskFromList(agent) {
  const tasks = Array.isArray(agent?.tasks) ? agent.tasks : [];
  const current = tasks.find((task) => ACTIVE_TASK_STATUSES.has(normalizeStatus(task?.status || task?.state || task?.phase)));
  return readText(current);
}

function agentCurrentTask(agent, agentSource = "mock") {
  const explicitTask = firstText(
    agent?.current_task,
    agent?.currentTask,
    agent?.active_task,
    agent?.activeTask,
    agent?.task,
    agent?.task_title,
    agent?.taskTitle,
    agent?.task_name,
    agent?.taskName,
    agent?.claim,
    agent?.current_claim,
    agent?.currentClaim,
    agent?.active_claim,
    agent?.activeClaim,
    agent?.claim_title,
    agent?.claimTitle,
    agent?.claim_name,
    agent?.claimName,
    agent?.now_working_on,
    agent?.nowWorkingOn,
    agent?.profile?.current_task,
    agent?.profile?.currentTask,
    agent?.profile?.claim,
    agent?.profile?.task,
  );
  if (explicitTask) return explicitTask;
  // Mock seed data previously carried illustrative task arrays. Keep those idle
  // unless a real live payload sends an active task/claim we can trust.
  if (String(agentSource || "").toLowerCase() !== "live") return "idle";
  return activeTaskFromList(agent) || "idle";
}

function mutedStorageKey(projectId) {
  return `${MUTED_AGENT_PREFIX}${String(projectId || "none").trim() || "none"}`;
}

export function loadMutedWorkshopAgentIds(projectId) {
  if (!projectId || typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(mutedStorageKey(projectId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((value) => String(value || "").trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function saveMutedWorkshopAgentIds(projectId, mutedAgentIds) {
  if (!projectId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(mutedStorageKey(projectId), JSON.stringify([...(mutedAgentIds || new Set())]));
  } catch {
    /* optional */
  }
}

export function renderWorkshopAgentCards(agents = [], { agentSource = "mock", mutedAgentIds = new Set() } = {}) {
  return agents.map((agent, index) => {
    const agentId = agentStorageId(agent, index);
    const muted = mutedAgentIds instanceof Set ? mutedAgentIds.has(agentId) : false;
    const name = agentName(agent);
    const role = agentRole(agent);
    const status = agentStatus(agent);
    const currentTask = agentCurrentTask(agent, agentSource);
    const profileLabel = role ? `${name} · ${role}` : name;
    return `
      <article class="workshop-card workshop-agent-card${muted ? " is-muted" : ""}" tabindex="0" data-workshop-agent-id="${esc(agentId)}">
        <div class="workshop-card-head">
          <strong>${esc(name)}</strong>
          <span class="workshop-pill">${esc(status)}</span>
        </div>
        <div class="workshop-agent-current">
          <span class="workshop-agent-current-label">Current task</span>
          <strong>${esc(currentTask)}</strong>
        </div>
        ${muted ? `<p class="workshop-agent-muted-note muted small">Chatter muted locally for this agent.</p>` : ""}
        <div class="workshop-agent-hover-card" aria-label="Agent hover details">
          <div class="workshop-agent-hover-section">
            <span class="workshop-agent-hover-label">Profile</span>
            <span class="workshop-agent-profile-chip">${esc(profileLabel)}</span>
          </div>
          <div class="workshop-agent-hover-section">
            <span class="workshop-agent-hover-label">Current task</span>
            <strong>${esc(currentTask)}</strong>
          </div>
          <button
            type="button"
            class="btn secondary btn-compact workshop-agent-mute-btn"
            data-workshop-agent-mute="${esc(agentId)}"
            aria-pressed="${muted ? "true" : "false"}"
          >${muted ? "Unmute chatter" : "Mute chatter"}</button>
        </div>
      </article>
    `;
  }).join("");
}

export function bindWorkshopAgentCardEvents(root, {
  projectId = "",
  mutedAgentIds = new Set(),
  onMutedAgentIdsChange = null,
} = {}) {
  root?.querySelectorAll("[data-workshop-agent-mute]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const agentId = String(btn.getAttribute("data-workshop-agent-mute") || "").trim();
      if (!agentId) return;
      const next = new Set(mutedAgentIds instanceof Set ? mutedAgentIds : []);
      const muted = !next.has(agentId);
      if (muted) next.add(agentId);
      else next.delete(agentId);
      saveMutedWorkshopAgentIds(projectId, next);
      try {
        window.dispatchEvent(new CustomEvent("render3d:workshop-agent-mute-changed", {
          detail: { projectId, agentId, muted },
        }));
      } catch {
        /* optional */
      }
      onMutedAgentIdsChange?.(next, { agentId, muted });
    });
  });
}
