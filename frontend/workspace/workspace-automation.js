/** Workspace Automation — prompt + owned workspaces + schedule + email-if. */

import { authHeaders } from "../studio/auth.js?v=20260907-ops-dash";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...authHeaders(options.headers || {}),
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    try {
      const data = await res.json();
      message = data.detail || message;
    } catch {
      /* ignore */
    }
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  if (res.status === 204) return null;
  return res.json();
}

function ownedTeams(teams = [], userId) {
  return (teams || []).filter((t) => t.role === "owner" || t.created_by === userId);
}

export function automationFormHtml({ teams = [], userId = "", selected = [] } = {}) {
  const owned = ownedTeams(teams, userId);
  return `
    <div class="ws-auto-form">
      <label class="ws-auto-field">
        <span>Prompt</span>
        <textarea id="ws-auto-prompt" rows="3" maxlength="2000" placeholder="Watch my owned workspaces. Compare project expenses. Email me if a generation starts failing."></textarea>
      </label>
      <fieldset class="ws-auto-field">
        <legend>Workspaces you own</legend>
        <div class="ws-auto-teams">
          ${
            owned
              .map(
                (t) => `
            <label class="ws-auto-chip">
              <input type="checkbox" data-ws-auto-team value="${esc(t.id)}" ${selected.includes(t.id) ? "checked" : ""} />
              ${esc(t.name || "Workspace")}
            </label>`
              )
              .join("") || `<p class="muted small">Create or own a workspace first.</p>`
          }
        </div>
      </fieldset>
      <label class="ws-auto-field">
        <span>Schedule</span>
        <select id="ws-auto-schedule">
          <option value="hourly">Hourly</option>
          <option value="next_2_days">Next 2 days</option>
          <option value="weekly">Weekly</option>
          <option value="custom">Custom period</option>
        </select>
      </label>
      <label class="ws-auto-field ws-auto-custom hidden" id="ws-auto-custom-wrap">
        <span>Every (minutes)</span>
        <input id="ws-auto-interval" type="number" min="5" max="10080" value="120" />
      </label>
      <div class="ws-auto-email">
        <button type="button" class="btn secondary btn-compact" id="ws-auto-email-toggle">Email me if…</button>
        <div id="ws-auto-email-panel" class="ws-auto-email-panel hidden">
          <p class="muted small">Mail the workspace owner and sam@render3d.app when the scenario hits. Existing SMTP.</p>
          <div class="ws-auto-chips">
            <label class="ws-auto-chip"><input type="checkbox" data-ws-auto-chip value="bug" /> bug</label>
            <label class="ws-auto-chip"><input type="checkbox" data-ws-auto-chip value="users" /> users</label>
            <label class="ws-auto-chip"><input type="checkbox" data-ws-auto-chip value="projects" /> projects</label>
          </div>
          <input id="ws-auto-scenario" type="text" maxlength="800" placeholder="Describe the scenario (e.g. a project spend spikes)" />
        </div>
      </div>
      <div class="ws-auto-actions">
        <button type="button" class="btn accent btn-compact" id="ws-auto-create">Create watchdog</button>
      </div>
      <p id="ws-auto-status" class="muted small" role="status"></p>
      <div id="ws-auto-list" class="ws-auto-list"></div>
    </div>
  `;
}

function collectPayload(root) {
  const prompt = String(root.querySelector("#ws-auto-prompt")?.value || "").trim();
  const teamIds = [...root.querySelectorAll("[data-ws-auto-team]:checked")].map((el) => el.value);
  const schedule = root.querySelector("#ws-auto-schedule")?.value || "hourly";
  const interval = Number(root.querySelector("#ws-auto-interval")?.value || 0);
  const emailOn = !root.querySelector("#ws-auto-email-panel")?.classList.contains("hidden");
  const chips = [...root.querySelectorAll("[data-ws-auto-chip]:checked")].map((el) => el.value);
  const scenario = String(root.querySelector("#ws-auto-scenario")?.value || "").trim();
  return {
    prompt,
    team_ids: teamIds,
    schedule_kind: schedule,
    interval_minutes: schedule === "custom" ? interval : null,
    email_if: emailOn || /email me if/i.test(prompt) || chips.length > 0 || !!scenario,
    email_chips: chips,
    email_scenario: scenario,
  };
}

function previewLine(row = {}) {
  const ready = String(row.last_preview || "").trim();
  if (ready) return ready;
  const digest = String(row.last_digest || "").split(/\r?\n/).map((ln) => ln.trim()).find(Boolean);
  return digest ? digest.replace(/\s+/g, " ").slice(0, 120) : "";
}

function eventLines(row = {}) {
  const events = Array.isArray(row.events) ? row.events : [];
  const lines = events
    .map((ev) => String(ev?.text || ev || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (lines.length) return lines;
  const preview = previewLine(row);
  return preview ? [preview] : [];
}

function setRunBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = !!busy;
  btn.classList.toggle("is-running", !!busy);
  btn.setAttribute("aria-busy", busy ? "true" : "false");
  btn.innerHTML = busy
    ? `<span class="ws-auto-run-spin" aria-hidden="true"></span>Running…`
    : "Run now";
}

function renderList(host, rows = [], openIds = new Set()) {
  if (!host) return;
  if (!rows.length) {
    host.innerHTML = `<p class="muted small">No watchdogs yet.</p>`;
    return;
  }
  host.innerHTML = rows
    .map((row) => {
      const preview = previewLine(row);
      const events = eventLines(row);
      const open = openIds.has(row.id) ? "open" : "";
      return `
      <article class="ws-auto-card">
        <div class="ws-auto-card-head">
          <div class="ws-auto-card-copy">
            <strong>${esc(row.schedule_kind)} · every ${esc(row.interval_minutes)}m</strong>
            <p class="muted small">${esc(row.prompt)}</p>
            ${row.email_if ? `<small>Email if: ${esc((row.email_chips || []).join(", ") || "scenario")} — ${esc(row.email_scenario || "—")}</small>` : ""}
            ${preview ? `<p class="ws-auto-preview" title="${esc(preview)}">${esc(preview)}</p>` : `<p class="ws-auto-preview muted">No ticks yet.</p>`}
          </div>
          <div class="ws-auto-card-actions">
            <button type="button" class="btn secondary btn-compact ws-auto-run" data-ws-auto-run="${esc(row.id)}">Run now</button>
            <button type="button" class="btn danger btn-compact" data-ws-auto-del="${esc(row.id)}">Stop</button>
          </div>
        </div>
        <details class="ws-auto-events-wrap" data-auto-id="${esc(row.id)}" ${open}>
          <summary>Recent events</summary>
          <div class="ws-auto-events">
            ${
              events.length
                ? `<ul>${events.map((line) => `<li title="${esc(line)}">${esc(line)}</li>`).join("")}</ul>`
                : `<p class="muted small">No events yet. Run now to tick.</p>`
            }
          </div>
        </details>
      </article>`;
    })
    .join("");
}

export async function bindAutomationForm(root, { onStatus = null } = {}) {
  if (!root) return;
  const status = (text, err = false) => {
    const el = root.querySelector("#ws-auto-status");
    if (el) {
      el.textContent = text || "";
      el.classList.toggle("is-error", !!err);
    }
    onStatus?.(text, err);
  };
  const refresh = async () => {
    const list = root.querySelector("#ws-auto-list");
    const openIds = new Set(
      [...(list?.querySelectorAll("details.ws-auto-events-wrap[open]") || [])].map((el) => el.dataset.autoId)
    );
    try {
      const data = await api("/api/workspace/automations");
      renderList(list, data.automations || [], openIds);
    } catch (err) {
      status(err.message || "Could not load watchdogs", true);
    }
  };
  root.querySelector("#ws-auto-schedule")?.addEventListener("change", (e) => {
    root.querySelector("#ws-auto-custom-wrap")?.classList.toggle("hidden", e.target.value !== "custom");
  });
  root.querySelector("#ws-auto-email-toggle")?.addEventListener("click", () => {
    root.querySelector("#ws-auto-email-panel")?.classList.toggle("hidden");
  });
  root.querySelector("#ws-auto-create")?.addEventListener("click", async () => {
    try {
      status("Creating…");
      await api("/api/workspace/automations", { method: "POST", body: JSON.stringify(collectPayload(root)) });
      status("Watchdog created. It writes pruned notes and emails only when the scenario hits.");
      await refresh();
    } catch (err) {
      status(err.message || "Could not create", true);
    }
  });
  root.addEventListener("click", async (e) => {
    const run = e.target.closest("[data-ws-auto-run]");
    const del = e.target.closest("[data-ws-auto-del]");
    try {
      if (run) {
        if (run.disabled) return;
        setRunBusy(run, true);
        status("Running…");
        try {
          const data = await api(`/api/workspace/automations/${encodeURIComponent(run.dataset.wsAutoRun)}/run`, { method: "POST" });
          status(data.important ? "Important hit — note kept." : "Tick stored (pruned temp log).");
          await refresh();
        } finally {
          const still = root.querySelector(`[data-ws-auto-run="${CSS.escape(run.dataset.wsAutoRun || "")}"]`);
          setRunBusy(still || run, false);
        }
      }
      if (del) {
        await api(`/api/workspace/automations/${encodeURIComponent(del.dataset.wsAutoDel)}`, { method: "DELETE" });
        status("Watchdog stopped.");
        await refresh();
      }
    } catch (err) {
      status(err.message || "Failed", true);
    }
  });
  await refresh();
}
