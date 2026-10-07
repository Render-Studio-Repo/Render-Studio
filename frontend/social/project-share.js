/** Project share dialog — teammates or any email (accept → Shared linked project). */

import { createShareRecord, patchShareSettings } from "../components/file-actions.js?v=20260909-sharefast1-20260909-remix1-fusionfolder1-sharechat1-shareperm1-20260915-nativejoints1-projshare1-20260916-shareui1&leakfix6&leakfix81&leakfix82";

const VIDEO_SHARE_EXTS = /\.(mp4|webm|mov|m4v|ogg)$/i;
const VIDEO_SHARE_FORMATS = ["mp4", "webm", "gif"];

function projectPreviewFilename(project) {
  return String(project?.latest_file || project?.latest_model || project?.filename || "").trim();
}

function isVideoShareFile(name) {
  return VIDEO_SHARE_EXTS.test(String(name || ""));
}

function shareModeFromRecord(share) {
  const mode = String(share?.share_mode || "").toLowerCase();
  if (mode === "edit" || mode === "remix" || mode === "view") return mode;
  if (share?.allow_edit) return "edit";
  if (share?.allow_remix || share?.allow_download) return "remix";
  return "view";
}

export function createProjectShareDialog({ api, getWorkspaceId, onChanged } = {}) {
  let modalEl = null;
  let activeProject = null;
  let preparedShare = null;
  let ensureSharePromise = null;
  let projectShareAbort = null; // leakfix79
  function beginProjectShareFetch() {
    if (projectShareAbort) {
      try { projectShareAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    projectShareAbort = ctl;
    return ctl;
  }

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
        <div class="project-share-link" id="project-share-link">
          <label class="app-dialog-label" for="project-share-url">Copy share link</label>
          <div class="project-share-row">
            <input type="text" id="project-share-url" readonly inputmode="none" autocomplete="off" spellcheck="false" placeholder="Creating link…" />
            <button type="button" class="btn accent share-fx-btn share-fx-btn--compact" data-project-share-copy>
              <svg class="share-fx-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              Copy
            </button>
          </div>
        </div>
        <div class="project-share-perms" id="project-share-perms">
          <div class="file-export-share-settings-head">
            <strong>Who can use this link</strong>
          </div>
          <label class="file-export-share-opt">
            <input type="radio" name="project-share-mode" value="view" data-share-mode="view" checked>
            <span><strong>View only</strong><span class="muted small">People can watch and leave comments</span></span>
          </label>
          <label class="file-export-share-opt">
            <input type="radio" name="project-share-mode" value="remix" data-share-mode="remix">
            <span><strong>Remix only</strong><span class="muted small">They can download and copy into their own project</span></span>
          </label>
          <label class="file-export-share-opt">
            <input type="radio" name="project-share-mode" value="edit" data-share-mode="edit">
            <span><strong>Remix and edit</strong><span class="muted small">They can edit the live project and pin markup</span></span>
          </label>
          <label class="file-export-share-opt file-export-share-opt--join">
            <input type="checkbox" data-share-join>
            <span><strong>Anyone can join this project</strong><span class="muted small">A separate join-project link. Copy share link still copies the view URL.</span></span>
          </label>
          <div class="file-export-share-join hidden" data-share-join-box>
            <label class="muted small">Join-project link</label>
            <div class="file-export-share-join-row">
              <input type="text" readonly data-share-join-url>
              <button type="button" class="btn share-fx-btn share-fx-btn--compact" data-share-join-copy>Copy</button>
            </div>
            <p class="muted small" data-share-join-hint>Signed-in visitors are added automatically. Role matches view / remix / edit above.</p>
          </div>
          <label class="file-export-share-opt">
            <input type="checkbox" data-project-share-public>
            <span><strong>List on Public</strong><span class="muted small">Unlisted keeps the share link working without showing the project in Public.</span></span>
          </label>
          <p class="muted small file-export-share-settings-status" data-share-settings-status></p>
        </div>
        <div class="project-share-video hidden" data-project-share-video>
          <div class="file-export-share-settings-head">
            <strong>Video export</strong>
          </div>
          <p class="muted small">Format, audio, and markups are stored on the copied share link.</p>
          <div class="project-share-video-row" role="radiogroup" aria-label="Download format">
            <button type="button" class="btn share-fx-btn share-fx-btn--chip is-active" data-video-format="mp4">MP4</button>
            <button type="button" class="btn share-fx-btn share-fx-btn--chip" data-video-format="webm">WebM</button>
            <button type="button" class="btn share-fx-btn share-fx-btn--chip" data-video-format="gif">GIF</button>
          </div>
          <div class="project-share-video-row" role="radiogroup" aria-label="Audio">
            <button type="button" class="btn share-fx-btn share-fx-btn--chip is-active" data-video-audio="1">With audio</button>
            <button type="button" class="btn share-fx-btn share-fx-btn--chip" data-video-audio="0">Without audio</button>
          </div>
          <label class="file-export-share-opt">
            <input type="checkbox" data-video-markup>
            <span><strong>Include markups</strong><span class="muted small">Burn timeline markups into the download from this link</span></span>
          </label>
        </div>
        <div class="project-share-workspace" id="project-share-workspace">
          <label class="app-dialog-label" for="project-share-workspace-select">Save to workspace</label>
          <div class="project-share-row">
            <select id="project-share-workspace-select" aria-label="Workspace that can view this project"></select>
            <button type="button" class="btn share-fx-btn" id="project-share-workspace-save">Save</button>
          </div>
        </div>
        <div class="project-share-people" id="project-share-list"></div>
        <div class="project-share-compose">
          <label class="app-dialog-label" for="project-share-email">Email</label>
          <div class="project-share-row">
            <input type="email" id="project-share-email" list="project-share-suggestions" placeholder="name@company.com" autocomplete="email" />
            <button type="button" class="btn accent share-fx-btn" id="project-share-submit">Share</button>
          </div>
          <datalist id="project-share-suggestions"></datalist>
        </div>
        <p id="project-share-status" class="project-share-status muted small" role="status"></p>
        <div class="app-dialog-actions">
          <button type="button" class="btn share-fx-btn" data-project-share-close>Done</button>
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
    modalEl.querySelector("#project-share-workspace-save")?.addEventListener("click", () => {
      void saveWorkspace();
    });
    modalEl.querySelector("#project-share-email")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
    });
    modalEl.querySelector("[data-project-share-copy]")?.addEventListener("click", () => {
      void copyShareLink();
    });
    modalEl.querySelector("#project-share-url")?.addEventListener("focus", (e) => {
      try {
        e.currentTarget.select();
      } catch {
        /* ignore */
      }
    });
    modalEl.querySelectorAll("[data-share-mode]").forEach((input) => {
      input.addEventListener("change", () => {
        const mode = modalEl.querySelector("[data-share-mode]:checked")?.getAttribute("data-share-mode") || "view";
        void persistShareSettings({ share_mode: mode });
      });
    });
    modalEl.querySelector("[data-share-join]")?.addEventListener("change", (ev) => {
      void persistShareSettings({ allow_join: !!ev.currentTarget.checked });
    });
    modalEl.querySelector("[data-share-join-copy]")?.addEventListener("click", () => {
      void copyJoinLink();
    });
    modalEl.querySelector("[data-project-share-public]")?.addEventListener("change", (ev) => {
      void persistPublicListing(!!ev.currentTarget.checked);
    });
    modalEl.querySelectorAll("[data-video-format]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setVideoFormat(btn.getAttribute("data-video-format"));
      });
    });
    modalEl.querySelectorAll("[data-video-audio]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setVideoAudio(btn.getAttribute("data-video-audio") !== "0");
      });
    });
    modalEl.querySelector("[data-video-markup]")?.addEventListener("change", (ev) => {
      setVideoMarkup(!!ev.currentTarget.checked);
    });
    return modalEl;
  }

  function close() {
    if (projectShareAbort) {
      try { projectShareAbort.abort(); } catch (_) { /* ignore */ }
      projectShareAbort = null;
    }
    modalEl?.classList.add("hidden");
    activeProject = null;
    preparedShare = null;
    ensureSharePromise = null;
  }

  function setStatus(text, isError = false) {
    const status = modalEl?.querySelector("#project-share-status");
    if (!status) return;
    status.textContent = text || "";
    status.classList.toggle("is-error", !!isError && !!text);
  }

  function setPermsStatus(text) {
    const status = modalEl?.querySelector("[data-share-settings-status]");
    if (!status) return;
    status.textContent = text || "";
  }

  function videoPrefs() {
    const formatBtn = modalEl?.querySelector("[data-video-format].is-active");
    const format = VIDEO_SHARE_FORMATS.includes(formatBtn?.getAttribute("data-video-format"))
      ? formatBtn.getAttribute("data-video-format")
      : "mp4";
    const audio = modalEl?.querySelector("[data-video-audio].is-active")?.getAttribute("data-video-audio") !== "0";
    const markup = !!modalEl?.querySelector("[data-video-markup]")?.checked;
    return { format, audio: format === "gif" ? false : audio, markup };
  }

  function displayShareUrl() {
    const base = String(preparedShare?.share_url || "").trim();
    if (!base) return "";
    if (!isVideoShareFile(preparedShare?.filename || projectPreviewFilename(activeProject))) {
      return base;
    }
    try {
      const url = new URL(base, window.location.origin);
      const prefs = videoPrefs();
      url.searchParams.set("format", prefs.format);
      if (prefs.format === "gif") url.searchParams.delete("audio");
      else url.searchParams.set("audio", prefs.audio ? "1" : "0");
      if (prefs.markup) url.searchParams.set("markup", "1");
      else url.searchParams.delete("markup");
      return url.toString();
    } catch {
      return base;
    }
  }

  function syncShareUrlField() {
    const input = modalEl?.querySelector("#project-share-url");
    if (!input) return;
    input.value = displayShareUrl();
  }

  function syncShareSettingsUi(share = preparedShare) {
    const host = modalEl?.querySelector("#project-share-perms");
    if (!host) return;
    const mode = shareModeFromRecord(share);
    host.querySelectorAll("[data-share-mode]").forEach((input) => {
      input.checked = input.getAttribute("data-share-mode") === mode;
    });
    const joinOn = !!share?.allow_join;
    const joinCheck = host.querySelector("[data-share-join]");
    if (joinCheck) joinCheck.checked = joinOn;
    host.querySelector("[data-share-join-box]")?.classList.toggle("hidden", !joinOn);
    const joinInput = host.querySelector("[data-share-join-url]");
    if (joinInput) joinInput.value = share?.join_url || "";
    const hint = host.querySelector("[data-share-join-hint]");
    if (hint) {
      hint.textContent = mode === "edit"
        ? "Signed-in visitors are added as editors. Copy share link still copies the view URL."
        : mode === "remix"
          ? "Signed-in visitors are added as remixers. Copy share link still copies the view URL."
          : "Signed-in visitors are added as viewers. Copy share link still copies the view URL.";
    }
    const publicCheck = host.querySelector("[data-project-share-public]");
    if (publicCheck) publicCheck.checked = !!activeProject?.public;
    const videoHost = modalEl?.querySelector("[data-project-share-video]");
    const videoOn = isVideoShareFile(share?.filename || projectPreviewFilename(activeProject));
    videoHost?.classList.toggle("hidden", !videoOn);
    syncShareUrlField();
  }

  async function copyText(text) {
    const value = String(text || "");
    if (!value) throw new Error("Nothing to copy.");
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        /* fall through */
      }
    }
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    if (!ok) throw new Error("Clipboard copy was blocked on this device.");
    return true;
  }

  async function resolveShareFilename(project) {
    let name = projectPreviewFilename(project);
    if (name) return name;
    try {
      const data = await api(`/api/projects/${encodeURIComponent(project.id)}`);
      activeProject = { ...project, ...data, id: project.id };
      name = projectPreviewFilename(activeProject);
    } catch {
      /* keep empty */
    }
    return name;
  }

  async function ensureShare() {
    if (preparedShare?.share_url) return preparedShare;
    if (ensureSharePromise) return ensureSharePromise;
    const project = activeProject;
    if (!project?.id) return null;
    ensureSharePromise = (async () => {
      const filename = await resolveShareFilename(project);
      if (!filename) {
        setStatus("Export a model or video first to create a share link.", true);
        const input = modalEl?.querySelector("#project-share-url");
        if (input) input.placeholder = "No shareable file yet";
        return null;
      }
      preparedShare = await createShareRecord(project.id, filename, null, { reuse: true });
      preparedShare.filename = preparedShare.filename || filename;
      syncShareSettingsUi(preparedShare);
      return preparedShare;
    })().finally(() => {
      ensureSharePromise = null;
    });
    return ensureSharePromise;
  }

  async function persistShareSettings(patch) {
    setPermsStatus("Saving…");
    try {
      const share = await ensureShare();
      if (!share?.token) throw new Error("No share link to update.");
      const data = await patchShareSettings(share.token, patch);
      preparedShare = { ...(preparedShare || {}), ...data, filename: preparedShare?.filename || share.filename };
      syncShareSettingsUi(preparedShare);
      setPermsStatus("Saved — link updated.");
      window.setTimeout(() => {
        const status = modalEl?.querySelector("[data-share-settings-status]");
        if (status?.isConnected && status.textContent === "Saved — link updated.") status.textContent = "";
      }, 1400);
    } catch (err) {
      setPermsStatus(err.message || "Could not save permissions.");
      syncShareSettingsUi(preparedShare);
    }
  }

  async function persistPublicListing(makePublic) {
    const project = activeProject;
    if (!project?.id) return;
    setPermsStatus(makePublic ? "Listing on Public…" : "Taking off Public…");
    try {
      const data = await api(`/api/projects/${encodeURIComponent(project.id)}/public`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public: !!makePublic }),
      });
      activeProject = { ...project, public: !!data.public };
      syncShareSettingsUi(preparedShare);
      onChanged?.();
      setPermsStatus(makePublic ? "Listed on Public." : "Unlisted — share link still works.");
    } catch (err) {
      setPermsStatus(err.message || "Could not update Public listing.");
      const check = modalEl?.querySelector("[data-project-share-public]");
      if (check) check.checked = !!activeProject?.public;
    }
  }

  function setVideoFormat(format) {
    const next = VIDEO_SHARE_FORMATS.includes(format) ? format : "mp4";
    modalEl?.querySelectorAll("[data-video-format]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-video-format") === next);
    });
    const gif = next === "gif";
    modalEl?.querySelectorAll("[data-video-audio]").forEach((btn) => {
      btn.disabled = gif;
    });
    syncShareUrlField();
  }

  function setVideoAudio(keep) {
    const format = videoPrefs().format;
    if (format === "gif") return;
    modalEl?.querySelectorAll("[data-video-audio]").forEach((btn) => {
      const on = btn.getAttribute("data-video-audio") !== "0";
      btn.classList.toggle("is-active", keep ? on : !on);
    });
    syncShareUrlField();
  }

  function setVideoMarkup(on) {
    const box = modalEl?.querySelector("[data-video-markup]");
    if (box) box.checked = !!on;
    syncShareUrlField();
  }

  async function copyShareLink() {
    const btn = modalEl?.querySelector("[data-project-share-copy]");
    try {
      const share = await ensureShare();
      if (!share?.share_url) throw new Error("Could not create a share link.");
      const url = displayShareUrl();
      await copyText(url);
      if (btn) btn.textContent = "Copied!";
      setStatus("Share link copied.");
      window.setTimeout(() => {
        if (btn?.isConnected) btn.textContent = "Copy";
      }, 1600);
    } catch (err) {
      if (btn) btn.textContent = "Copy";
      setStatus(err.message || "Could not copy share link.", true);
    }
  }

  async function copyJoinLink() {
    const url = preparedShare?.join_url || modalEl?.querySelector("[data-share-join-url]")?.value;
    const copyBtn = modalEl?.querySelector("[data-share-join-copy]");
    try {
      if (!url) throw new Error("Turn on join-project to create the link.");
      await copyText(url);
      if (copyBtn) copyBtn.textContent = "Copied!";
      setPermsStatus("Join-project link copied.");
      window.setTimeout(() => {
        if (copyBtn?.isConnected) copyBtn.textContent = "Copy";
      }, 1400);
    } catch (err) {
      setPermsStatus(err.message || "Could not copy join link.");
    }
  }

  async function loadMemberSuggestions(existingShares = [], pending = [], signal) {
    const teamId = activeProject?.team_id || getWorkspaceId?.();
    const list = modalEl?.querySelector("#project-share-suggestions");
    if (!list || !teamId) return;
    if (!list.querySelector("option[value]")) list.innerHTML = "";
    try {
      const data = await api(`/api/teams/${teamId}/members`, signal ? { signal } : undefined);
      if (signal?.aborted) return;
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
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") return;
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

  async function loadShareList(project, signal) {
    const host = modalEl?.querySelector("#project-share-list");
    if (!host || !project?.id) return { shares: [], pending: [] };
    if (!host.querySelector(".project-share-person")) {
      host.innerHTML = `<p class="muted small">Loading…</p>`;
    }
    try {
      const data = await api(`/api/projects/${encodeURIComponent(project.id)}/shares`, signal ? { signal } : undefined);
      if (signal?.aborted) return { shares: [], pending: [] };
      const shares = data.shares || [];
      const pending = data.pending || [];
      renderPeople(shares, pending);
      return { shares, pending };
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") return { shares: [], pending: [] };
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
      const ctl = beginProjectShareFetch();
      try {
        const next = await loadShareList(project, ctl.signal);
        if (ctl.signal.aborted) return;
        await loadMemberSuggestions(next.shares, next.pending, ctl.signal);
      } finally {
        if (projectShareAbort === ctl) projectShareAbort = null;
      }
      onChanged?.();
      setStatus("Removed.");
    } catch (err) {
      setStatus(err.message || "Could not remove", true);
    }
  }

  async function loadWorkspaces(project, signal) {
    const select = modalEl?.querySelector("#project-share-workspace-select");
    if (!select) return;
    if (!select.querySelector("option[value]:not([value=''])")) {
      select.innerHTML = `<option value="">Loading workspaces…</option>`;
    }
    try {
      const data = await api("/api/teams", signal ? { signal } : undefined);
      if (signal?.aborted) return;
      const teams = Array.isArray(data?.teams) ? data.teams : [];
      if (!teams.length) {
        select.innerHTML = `<option value="">No workspaces yet</option>`;
        return;
      }
      const current = String(project?.team_id || "");
      select.innerHTML = teams.map((t) => {
        const id = escapeHtml(t.id);
        const name = escapeHtml(t.name || "Workspace");
        const selected = String(t.id) === current ? " selected" : "";
        const mark = String(t.id) === current ? " (current)" : "";
        return `<option value="${id}"${selected}>${name}${mark}</option>`;
      }).join("");
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") return;
      select.innerHTML = `<option value="">Could not load workspaces</option>`;
    }
  }

  async function saveWorkspace() {
    const project = activeProject;
    const select = modalEl?.querySelector("#project-share-workspace-select");
    const teamId = String(select?.value || "").trim();
    if (!project?.id || !teamId) {
      setStatus("Pick a workspace.", true);
      return;
    }
    setStatus("Saving to workspace…");
    try {
      const res = await api(`/api/projects/${encodeURIComponent(project.id)}/workspace`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: teamId }),
      });
      activeProject = { ...project, team_id: res.team_id || teamId };
      const ctl = beginProjectShareFetch();
      try {
        await loadWorkspaces(activeProject, ctl.signal);
      } finally {
        if (projectShareAbort === ctl) projectShareAbort = null;
      }
      onChanged?.();
      setStatus(res.team_name ? `Saved to ${res.team_name}.` : "Saved to workspace.");
    } catch (err) {
      setStatus(err.message || "Could not save to workspace", true);
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
      const ctl = beginProjectShareFetch();
      try {
        const next = await loadShareList(project, ctl.signal);
        if (!ctl.signal.aborted) await loadMemberSuggestions(next.shares, next.pending, ctl.signal);
      } finally {
        if (projectShareAbort === ctl) projectShareAbort = null;
      }
      onChanged?.();
    } catch (err) {
      setStatus(err.message || "Could not share project", true);
    }
  }

  async function open(project) {
    if (!project?.id) return;
    activeProject = project;
    preparedShare = null;
    ensureSharePromise = null;
    const modal = ensureModal();
    modal.querySelector("#project-share-title").textContent = `Share “${project.name || project.id}”`;
    modal.querySelector("#project-share-email").value = "";
    const urlInput = modal.querySelector("#project-share-url");
    if (urlInput) {
      urlInput.value = "";
      urlInput.placeholder = "Creating link…";
    }
    setStatus("");
    setPermsStatus("");
    syncShareSettingsUi(null);
    modal.classList.remove("hidden");
    const ctl = beginProjectShareFetch();
    try {
      await Promise.all([
        loadWorkspaces(project, ctl.signal),
        loadShareList(project, ctl.signal).then((next) => {
          if (ctl.signal.aborted) return;
          return loadMemberSuggestions(next.shares, next.pending, ctl.signal);
        }),
        ensureShare().catch((err) => setStatus(err.message || "Could not create share link.", true)),
      ]);
    } finally {
      if (projectShareAbort === ctl) projectShareAbort = null;
    }
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
