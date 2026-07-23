/** Project share dialog — share a project with a workspace teammate. */

export function createProjectShareDialog({ api, getWorkspaceId, onChanged } = {}) {
  let modalEl = null;
  let activeProject = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.className = "auth-modal hidden";
    modalEl.id = "project-share-modal";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.innerHTML = `
      <div class="auth-backdrop" data-project-share-close></div>
      <div class="auth-card app-dialog-card">
        <button type="button" class="auth-close" data-project-share-close aria-label="Close">&times;</button>
        <h2 class="app-dialog-title" id="project-share-title">Share project</h2>
        <p class="muted small folder-share-hint">Pick a teammate on this workspace. The project appears in their files with a Shared tag.</p>
        <ul class="folder-share-list" id="project-share-list"></ul>
        <label class="app-dialog-label">Team member
          <select id="project-share-member" class="folder-share-member-select">
            <option value="">Loading workspace members…</option>
          </select>
        </label>
        <label class="app-dialog-label">Email <span class="muted small">(optional if you picked a member)</span>
          <input type="email" id="project-share-email" placeholder="coworker@company.com" autocomplete="email" />
        </label>
        <p id="project-share-status" class="muted small"></p>
        <div class="app-dialog-actions">
          <button type="button" class="btn secondary" data-project-share-close>Close</button>
          <button type="button" class="btn accent" id="project-share-submit">Share</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
    modalEl.querySelectorAll("[data-project-share-close]").forEach((el) => {
      el.addEventListener("click", close);
    });
    modalEl.querySelector("#project-share-submit")?.addEventListener("click", () => {
      void submit();
    });
    modalEl.querySelector("#project-share-member")?.addEventListener("change", (e) => {
      const email = String(e.target.value || "").trim();
      const emailInput = modalEl?.querySelector("#project-share-email");
      const status = modalEl?.querySelector("#project-share-status");
      if (emailInput) emailInput.value = email;
      if (status) status.textContent = email ? `Ready to share with ${email}` : "";
    });
    modalEl.querySelector("#project-share-email")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
    });
    return modalEl;
  }

  function close() {
    modalEl?.classList.add("hidden");
    activeProject = null;
  }

  async function loadMemberOptions(existingShares = []) {
    const teamId = activeProject?.team_id || getWorkspaceId?.();
    const select = modalEl?.querySelector("#project-share-member");
    if (!select || !teamId) return;
    select.innerHTML = `<option value="">Loading workspace members…</option>`;
    try {
      const data = await api(`/api/teams/${teamId}/members`);
      const sharedEmails = new Set(
        existingShares.map((s) => String(s.email || "").toLowerCase()).filter(Boolean)
      );
      const ownerId = activeProject?.owner_user_id;
      const members = (data.members || []).filter(
        (m) => m.id !== ownerId && !sharedEmails.has(String(m.email || "").toLowerCase())
      );
      select.innerHTML = "";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Select a teammate…";
      select.appendChild(blank);
      for (const member of members) {
        const opt = document.createElement("option");
        opt.value = member.email;
        opt.textContent = `${member.display_name || member.email} (${member.email})`;
        select.appendChild(opt);
      }
      if (!members.length) {
        blank.textContent = "No unshared teammates — type an email…";
      }
    } catch {
      select.innerHTML = `<option value="">Could not load members — type an email…</option>`;
    }
  }

  async function loadShareList(project) {
    const listEl = modalEl?.querySelector("#project-share-list");
    if (!listEl || !project?.id) return [];
    listEl.innerHTML = `<li class="muted small">Loading…</li>`;
    let shares = [];
    try {
      const data = await api(`/api/projects/${encodeURIComponent(project.id)}/shares`);
      shares = data.shares || [];
    } catch {
      listEl.innerHTML = `<li class="muted small">Could not load shares.</li>`;
      return [];
    }
    if (!shares.length) {
      listEl.innerHTML = `<li class="muted small folder-share-empty">Not shared with anyone yet.</li>`;
      return shares;
    }
    listEl.innerHTML = "";
    for (const s of shares) {
      const li = document.createElement("li");
      li.className = "folder-share-item";
      li.innerHTML = `<span><strong>${escapeHtml(s.display_name || s.email)}</strong> <span class="muted small">${escapeHtml(s.email)}</span></span>`;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn-icon btn-share-remove";
      rm.title = "Remove access";
      rm.textContent = "×";
        rm.addEventListener("click", async () => {
        if (!window.confirm(`Remove ${s.display_name || s.email} from this project?`)) return;
        try {
          await api(`/api/projects/${encodeURIComponent(project.id)}/shares/${encodeURIComponent(s.user_id)}`, {
            method: "DELETE",
          });
          const next = await loadShareList(project);
          await loadMemberOptions(next);
          onChanged?.();
        } catch (err) {
          alert(err.message || "Could not remove share");
        }
      });
      li.appendChild(rm);
      listEl.appendChild(li);
    }
    return shares;
  }

  async function submit() {
    const project = activeProject;
    const status = modalEl?.querySelector("#project-share-status");
    const emailInput = modalEl?.querySelector("#project-share-email");
    const memberSelect = modalEl?.querySelector("#project-share-member");
    if (!project?.id) return;
    const email = String(emailInput?.value || memberSelect?.value || "").trim();
    if (!email) {
      if (status) status.textContent = "Pick a team member or enter an email address.";
      memberSelect?.focus();
      return;
    }
    if (status) status.textContent = "Sharing…";
    try {
      const res = await api(`/api/projects/${encodeURIComponent(project.id)}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (status) status.textContent = res.message || "Project shared.";
      if (emailInput) emailInput.value = "";
      if (memberSelect) memberSelect.value = "";
      const shares = await loadShareList(project);
      await loadMemberOptions(shares);
      onChanged?.();
    } catch (err) {
      if (status) status.textContent = err.message || "Could not share project";
    }
  }

  async function open(project) {
    if (!project?.id) return;
    activeProject = project;
    const modal = ensureModal();
    modal.querySelector("#project-share-title").textContent = `Share “${project.name || project.id}”`;
    modal.querySelector("#project-share-email").value = "";
    modal.querySelector("#project-share-member").innerHTML = `<option value="">Loading workspace members…</option>`;
    modal.querySelector("#project-share-status").textContent = "";
    modal.classList.remove("hidden");
    const shares = await loadShareList(project);
    await loadMemberOptions(shares);
    modal.querySelector("#project-share-member")?.focus();
  }

  async function leave(project) {
    if (!project?.id) return;
    const name = project.name || project.id;
    if (!window.confirm(`Remove “${name}” from your files? You can ask the owner to share it again later.`)) {
      return false;
    }
    await api(`/api/projects/${encodeURIComponent(project.id)}/shares/me`, { method: "DELETE" });
    onChanged?.();
    return true;
  }

  return { open, leave, close };
}
