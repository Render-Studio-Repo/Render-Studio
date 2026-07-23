/** Project share dialog — teammates or any email (accept → Shared linked project). */

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
      <div class="auth-card app-dialog-card project-share-card">
        <button type="button" class="auth-close" data-project-share-close aria-label="Close">&times;</button>
        <h2 class="app-dialog-title" id="project-share-title">Share project</h2>
        <p class="muted small project-share-lead">Add people by email. Teammates get it right away; others accept an invite. Same live project — your edits stay linked.</p>
        <div class="project-share-people" id="project-share-list"></div>
        <div class="project-share-compose">
          <label class="app-dialog-label" for="project-share-email">Email</label>
          <div class="project-share-row">
            <input type="email" id="project-share-email" list="project-share-suggestions" placeholder="name@company.com" autocomplete="email" />
            <button type="button" class="btn accent" id="project-share-submit">Share</button>
          </div>
          <datalist id="project-share-suggestions"></datalist>
          <p class="muted small project-share-hint">Workspace members appear as suggestions. Outside emails get an invite link.</p>
        </div>
        <p id="project-share-status" class="project-share-status muted small" role="status"></p>
        <div class="app-dialog-actions">
          <button type="button" class="btn secondary" data-project-share-close>Done</button>
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

  function setStatus(text, isError = false) {
    const status = modalEl?.querySelector("#project-share-status");
    if (!status) return;
    status.textContent = text || "";
    status.classList.toggle("is-error", !!isError && !!text);
  }

  async function loadMemberSuggestions(existingShares = [], pending = []) {
    const teamId = activeProject?.team_id || getWorkspaceId?.();
    const list = modalEl?.querySelector("#project-share-suggestions");
    if (!list || !teamId) return;
    list.innerHTML = "";
    try {
      const data = await api(`/api/teams/${teamId}/members`);
      const taken = new Set([
        ...existingShares.map((s) => String(s.email || "").toLowerCase()),
        ...pending.map((p) => String(p.email || "").toLowerCase()),
      ].filter(Boolean));
      const ownerId = activeProject?.owner_user_id;
      for (const member of data.members || []) {
        const email = String(member.email || "").toLowerCase();
        if (!email || member.id === ownerId || taken.has(email)) continue;
        const opt = document.createElement("option");
        opt.value = member.email;
        opt.label = member.display_name || member.email;
        list.appendChild(opt);
      }
    } catch {
      /* suggestions optional */
    }
  }

  function renderPeople(shares, pending) {
    const host = modalEl?.querySelector("#project-share-list");
    if (!host) return;
    const items = [];
    for (const s of shares || []) {
      items.push({
        kind: "active",
        key: `u:${s.user_id}`,
        title: s.display_name || s.email,
        subtitle: s.email,
        userId: s.user_id,
      });
    }
    for (const p of pending || []) {
      items.push({
        kind: "pending",
        key: `i:${p.id}`,
        title: p.email,
        subtitle: "Invite pending",
        inviteId: p.id,
      });
    }
    if (!items.length) {
      host.innerHTML = `<p class="muted small project-share-empty">Not shared yet.</p>`;
      return;
    }
    host.innerHTML = items
      .map(
        (item) => `
      <div class="project-share-person" data-kind="${item.kind}">
        <div class="project-share-person-copy">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.subtitle || "")}</small>
        </div>
        <span class="project-share-chip">${item.kind === "pending" ? "Pending" : "Shared"}</span>
        <button type="button" class="btn-icon btn-share-remove" data-remove-kind="${item.kind}" data-remove-id="${escapeHtml(item.userId || item.inviteId || "")}" title="Remove" aria-label="Remove">&times;</button>
      </div>`,
      )
      .join("");
    host.querySelectorAll("[data-remove-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void removePerson(btn.getAttribute("data-remove-kind"), btn.getAttribute("data-remove-id"));
      });
    });
  }

  async function loadShareList(project) {
    const host = modalEl?.querySelector("#project-share-list");
    if (!host || !project?.id) return { shares: [], pending: [] };
    host.innerHTML = `<p class="muted small">Loading…</p>`;
    try {
      const data = await api(`/api/projects/${encodeURIComponent(project.id)}/shares`);
      const shares = data.shares || [];
      const pending = data.pending || [];
      renderPeople(shares, pending);
      return { shares, pending };
    } catch {
      host.innerHTML = `<p class="muted small">Could not load shares.</p>`;
      return { shares: [], pending: [] };
    }
  }

  async function removePerson(kind, id) {
    const project = activeProject;
    if (!project?.id || !id) return;
    try {
      if (kind === "pending") {
        await api(`/api/projects/${encodeURIComponent(project.id)}/share-invites/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } else {
        if (!window.confirm("Remove this person’s access?")) return;
        await api(`/api/projects/${encodeURIComponent(project.id)}/shares/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      }
      const next = await loadShareList(project);
      await loadMemberSuggestions(next.shares, next.pending);
      onChanged?.();
      setStatus("Removed.");
    } catch (err) {
      setStatus(err.message || "Could not remove", true);
    }
  }

  async function submit() {
    const project = activeProject;
    const emailInput = modalEl?.querySelector("#project-share-email");
    if (!project?.id) return;
    const email = String(emailInput?.value || "").trim();
    if (!email) {
      setStatus("Enter an email address.", true);
      emailInput?.focus();
      return;
    }
    setStatus("Sending…");
    try {
      const res = await api(`/api/projects/${encodeURIComponent(project.id)}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setStatus(res.message || (res.status === "invited" ? "Invite sent." : "Shared."));
      if (emailInput) emailInput.value = "";
      const next = await loadShareList(project);
      await loadMemberSuggestions(next.shares, next.pending);
      onChanged?.();
    } catch (err) {
      setStatus(err.message || "Could not share project", true);
    }
  }

  async function open(project) {
    if (!project?.id) return;
    activeProject = project;
    const modal = ensureModal();
    modal.querySelector("#project-share-title").textContent = `Share “${project.name || project.id}”`;
    modal.querySelector("#project-share-email").value = "";
    setStatus("");
    modal.classList.remove("hidden");
    const next = await loadShareList(project);
    await loadMemberSuggestions(next.shares, next.pending);
    modal.querySelector("#project-share-email")?.focus();
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
