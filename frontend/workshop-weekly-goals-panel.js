const VALID_STATUSES = new Set(["todo", "doing", "done", "blocked"]);
const VALID_SOURCES = new Set(["current", "manual"]);

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUpdatedAt(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Updated time unavailable";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return `Updated ${esc(raw)}`;
  return `Updated ${esc(date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  }))} CT`;
}

export function seededWorkshopWeeklyGoalsState() {
  return {
    week_id: "",
    updated_at: "",
    source: "manual",
    goals: [],
  };
}

export function normalizeWorkshopWeeklyGoalsState(input) {
  const seed = seededWorkshopWeeklyGoalsState();
  const value = input && typeof input === "object" ? input : {};
  const goals = Array.isArray(value.goals) ? value.goals : [];
  return {
    week_id: String(value.week_id || seed.week_id).trim(),
    updated_at: String(value.updated_at || seed.updated_at).trim(),
    source: VALID_SOURCES.has(String(value.source || "").toLowerCase())
      ? String(value.source).toLowerCase()
      : seed.source,
    goals: goals
      .map((goal) => {
        if (!goal || typeof goal !== "object") return null;
        const id = String(goal.id || "").trim();
        const title = String(goal.title || "").trim();
        const ownerSlug = String(goal.owner_slug || "").trim();
        if (!id || !title || !ownerSlug) return null;
        const status = String(goal.status || "todo").trim().toLowerCase();
        return {
          id,
          title,
          owner_slug: ownerSlug,
          status: VALID_STATUSES.has(status) ? status : "todo",
          claim_id: String(goal.claim_id || "").trim(),
        };
      })
      .filter(Boolean),
  };
}

export function renderWorkshopWeeklyGoalsPanel(state, options = {}) {
  const value = normalizeWorkshopWeeklyGoalsState(state);
  const surface = String(options.surface || "workshop").toLowerCase();
  const goals = Array.isArray(value.goals) ? value.goals : [];
  const weekLabel = value.week_id ? `Week ${esc(value.week_id)}` : "Current Chicago week";
  const sourceLabel = value.source === "current" ? "CURRENT mirror" : "Manual mirror";
  const surfaceNote = surface === "god"
    ? "Pinned into God Mode for room-wide visibility."
    : "Read-only mirror for the Workshop wall.";
  return `
    <section class="workshop-card workshop-weekly-goals-panel" aria-label="Weekly Goals">
      <div class="workshop-weekly-goals-head">
        <div>
          <span class="workshop-kicker">Weekly Goals</span>
          <h3>Weekly Goals</h3>
          <p>${weekLabel} - America/Chicago Mon-Sun - ${formatUpdatedAt(value.updated_at)}</p>
        </div>
        <div class="workshop-weekly-goals-badges">
          <span class="workshop-pill workshop-pill--readonly">Read-only</span>
          <span class="workshop-pill workshop-pill--mirror">${esc(sourceLabel)}</span>
        </div>
      </div>
      <p class="muted small workshop-weekly-goals-note">${esc(surfaceNote)}</p>
      ${goals.length
        ? `<div class="workshop-weekly-goals-list">${goals.map((goal) => `
          <article class="workshop-card workshop-weekly-goal-card" data-workshop-goal-id="${esc(goal.id)}">
            <div class="workshop-card-head">
              <strong>${esc(goal.title)}</strong>
              <span class="workshop-pill workshop-pill--${esc(goal.status)}">${esc(goal.status)}</span>
            </div>
            <div class="workshop-weekly-goal-meta">
              <span><strong>Owner</strong> ${esc(goal.owner_slug)}</span>
              ${goal.claim_id ? `<span><strong>Claim</strong> ${esc(goal.claim_id)}</span>` : ""}
            </div>
          </article>
        `).join("")}</div>`
        : `<p class="muted small">No weekly goals have been assigned for this Chicago week yet.</p>`}
    </section>
  `;
}
