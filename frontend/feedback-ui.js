import { authHeaders, getStoredUser, isAdminUser } from "./auth.js?v=20260709-admin-matt";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatWhen(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  } catch {
    return String(value);
  }
}

async function requestJson(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    try {
      const data = await res.json();
      message = data.detail || message;
    } catch {
      /* keep status text */
    }
    throw new Error(message);
  }
  return res.json();
}

export function createFeedbackUI({
  suggestionBtn,
  bugBtn,
  getProjects = () => [],
  getCurrentProjectId = () => "",
  getSelectedFile = () => "",
  getPromptText = () => "",
  onSubmitted,
} = {}) {
  let modal = null;
  let prompts = [];

  function projectOptions() {
    const current = getCurrentProjectId?.() || "";
    const projects = [...(getProjects?.() || [])];
    projects.sort((a, b) => String(a.name || a.id || "").localeCompare(String(b.name || b.id || "")));
    return [
      `<option value="">No project context</option>`,
      ...projects.map((project) => {
        const id = String(project.id || "");
        const label = project.name || id;
        return `<option value="${esc(id)}" ${id === current ? "selected" : ""}>${esc(label)} (${esc(id)})</option>`;
      }),
    ].join("");
  }

  async function loadPrompts(projectId) {
    prompts = [];
    const select = modal?.querySelector("#feedback-prompt");
    if (!select) return;
    select.innerHTML = `<option value="">Loading prompt history...</option>`;
    if (!projectId) {
      select.innerHTML = `<option value="">No prompt context</option>`;
      return;
    }
    try {
      const data = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/prompt-history?kind=cad&limit=50`);
      prompts = data.entries || [];
      select.innerHTML = [
        `<option value="">No prompt context</option>`,
        ...prompts.map((entry) => {
          const label = `${formatWhen(entry.created_at)} · ${String(entry.prompt || "").slice(0, 72)}`;
          return `<option value="${esc(entry.id)}">${esc(label)}</option>`;
        }),
      ].join("");
    } catch (err) {
      select.innerHTML = `<option value="">Could not load prompts: ${esc(err.message || "error")}</option>`;
    }
  }

  function close() {
    modal?.remove();
    modal = null;
    prompts = [];
  }

  function open(kind) {
    close();
    const title = kind === "bug" ? "Report a Bug" : "Send a Suggestion";
    modal = document.createElement("div");
    modal.className = "feedback-modal-backdrop";
    modal.innerHTML = `
      <form class="feedback-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="feedback-modal-head">
          <div>
            <p class="info-eyebrow">${kind === "bug" ? "Bug report" : "Suggestion"}</p>
            <h2>${esc(title)}</h2>
            <p class="muted small">Attach screenshots and choose a project or prompt so management can inspect trace logs.</p>
          </div>
          <button type="button" class="feedback-modal-close" aria-label="Close">×</button>
        </header>
        <label class="feedback-field">Message
          <textarea id="feedback-message" rows="5" required maxlength="6000" placeholder="${kind === "bug" ? "What broke? What did you expect to happen?" : "What should we improve or add?"}"></textarea>
        </label>
        <div class="feedback-grid">
          <label class="feedback-field">Project
            <select id="feedback-project">${projectOptions()}</select>
          </label>
          <label class="feedback-field">Prompt / trace
            <select id="feedback-prompt"><option value="">No prompt context</option></select>
          </label>
        </div>
        <label class="feedback-field">Screenshots
          <input id="feedback-screenshots" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple />
          <span class="muted small">Up to 5 images. Current project, selected file, page URL, and prompt text are included as context.</span>
        </label>
        <p class="feedback-status muted small" id="feedback-status"></p>
        <footer class="feedback-actions">
          <button type="button" class="btn secondary" data-feedback-cancel>Cancel</button>
          <button type="submit" class="btn primary">${kind === "bug" ? "Submit Bug" : "Submit Suggestion"}</button>
        </footer>
      </form>
    `;
    document.body.appendChild(modal);
    const projectSelect = modal.querySelector("#feedback-project");
    const currentProject = projectSelect?.value || "";
    void loadPrompts(currentProject);
    modal.querySelector(".feedback-modal-close")?.addEventListener("click", close);
    modal.querySelector("[data-feedback-cancel]")?.addEventListener("click", close);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });
    projectSelect?.addEventListener("change", () => void loadPrompts(projectSelect.value));
    modal.querySelector("form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submit(kind);
    });
    modal.querySelector("#feedback-message")?.focus();
  }

  async function submit(kind) {
    const status = modal?.querySelector("#feedback-status");
    const submitBtn = modal?.querySelector('button[type="submit"]');
    const projectSelect = modal?.querySelector("#feedback-project");
    const promptSelect = modal?.querySelector("#feedback-prompt");
    const messageEl = modal?.querySelector("#feedback-message");
    const filesEl = modal?.querySelector("#feedback-screenshots");
    const message = String(messageEl?.value || "").trim();
    if (!message) {
      if (status) status.textContent = "Please add a short message.";
      return;
    }
    const projectId = projectSelect?.value || "";
    const project = (getProjects?.() || []).find((item) => String(item.id) === projectId);
    const promptId = promptSelect?.value || "";
    const prompt = prompts.find((item) => String(item.id) === promptId);
    const form = new FormData();
    form.append("kind", kind);
    form.append("message", message);
    form.append("page_url", window.location.href);
    if (projectId) form.append("project_id", projectId);
    if (project?.name) form.append("project_name", project.name);
    if (promptId) form.append("prompt_id", promptId);
    if (prompt?.trace_id) form.append("trace_id", prompt.trace_id);
    if (prompt?.prompt) form.append("prompt_label", prompt.prompt);
    form.append("context_json", JSON.stringify({
      selected_file: getSelectedFile?.() || null,
      current_project_id: getCurrentProjectId?.() || null,
      current_prompt_text: String(getPromptText?.() || "").slice(0, 4000),
      user_agent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
    }));
    [...(filesEl?.files || [])].slice(0, 5).forEach((file) => form.append("screenshots", file));
    if (status) status.textContent = "Submitting...";
    if (submitBtn) submitBtn.disabled = true;
    try {
      const res = await fetch("/api/feedback/requests", {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || res.statusText || "Submit failed");
      }
      const data = await res.json();
      onSubmitted?.(data.request);
      if (status) status.textContent = "Sent. Thank you.";
      setTimeout(close, 650);
    } catch (err) {
      if (status) status.textContent = err.message || "Could not submit.";
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  suggestionBtn?.addEventListener("click", () => open("suggestion"));
  bugBtn?.addEventListener("click", () => open("bug"));

  return { open, close };
}

export function initManagementNotifications({ intervalMs = 30000 } = {}) {
  const toolbar = document.getElementById("btn-admin-dashboard-toolbar");
  const menuLink = document.getElementById("btn-admin-dashboard");
  let timer = null;

  function ensureBadge(target) {
    if (!target) return null;
    let badge = target.querySelector(".management-notification-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "management-notification-badge hidden";
      target.appendChild(badge);
    }
    return badge;
  }

  function apply(summary) {
    const count = Number(summary?.unread_count || 0);
    [ensureBadge(toolbar), ensureBadge(menuLink)].forEach((badge) => {
      if (!badge) return;
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.title = `${count} unread management request${count === 1 ? "" : "s"}`;
      badge.classList.toggle("hidden", count <= 0);
    });
  }

  async function poll() {
    const user = getStoredUser();
    if (!isAdminUser(user)) {
      apply({ unread_count: 0 });
      return;
    }
    try {
      apply(await requestJson("/api/admin/feedback/summary"));
    } catch {
      /* ignore badge refresh failures */
    }
  }

  void poll();
  window.addEventListener("storage", (event) => {
    if (event.key === "render3d:user") void poll();
  });
  window.addEventListener("render3d:feedback-submitted", () => void poll());
  timer = window.setInterval(poll, intervalMs);
  return { refresh: poll, stop: () => timer && window.clearInterval(timer) };
}
