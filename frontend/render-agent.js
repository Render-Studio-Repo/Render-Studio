/** Floating Render Agent assistant for tooling questions and onboarding. */
import {
  bumpTipForNewThread,
  bumpTipOnRefresh,
  getCurrentTip,
  tipTopicClass,
} from "./getting-started-tips.js?v=20260715-agent-tips-refresh";


const ONBOARDING_KEY_PREFIX = "render3d:renderAgentSeen:";
const RENDER3D_LOGO_URL = "/render3d-logo.png?v=20260715-new-logo";

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function renderMessageText(value = "") {
  return esc(value)
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsText(file);
  });
}

function isTextLike(file) {
  const name = (file.name || "").toLowerCase();
  return /^text\//i.test(file.type || "") || /\.(txt|md|csv|json|svg|dxf|step|stp)$/i.test(name);
}

function isImage(file) {
  return /^image\/(png|jpeg|jpg|webp)$/i.test(file.type || "");
}

export function createRenderAgent({
  api,
  getProjectId,
  getSelectedFile,
  getCurrentUser,
  getTeams,
  getSelectedWorkspaceId,
  getSelectedAiKey,
  onRequireLogin,
  onStatus,
} = {}) {
  const btn = document.getElementById("btn-render-agent");
  const panel = document.getElementById("render-agent-panel");
  const closeBtn = document.getElementById("render-agent-close");
  const threadMenuBtn = document.getElementById("render-agent-thread-menu");
  const threadPopover = document.getElementById("render-agent-thread-popover");
  const threadListEl = document.getElementById("render-agent-thread-list");
  const activeThreadLabel = document.getElementById("render-agent-active-thread-label");
  const newThreadBtn = document.getElementById("render-agent-new-thread");
  const membersEl = document.getElementById("render-agent-members");
  const inviteSelect = document.getElementById("render-agent-invite-select");
  const inviteBtn = document.getElementById("render-agent-invite-btn");
  const onboarding = document.getElementById("render-agent-onboarding");
  const messagesEl = document.getElementById("render-agent-messages");
  const attachmentsEl = document.getElementById("render-agent-attachments");
  const form = document.getElementById("render-agent-form");
  const input = document.getElementById("render-agent-input");
  const fileInput = document.getElementById("render-agent-file-input");
  const statusEl = document.getElementById("render-agent-status");

  if (!btn || !panel || !form || !messagesEl) return null;

  let threads = [];
  let activeThread = null;
  let attachments = [];
  let teamMembers = [];
  let inviteOpen = false;
  let inviteQuery = "";
  let selectedInviteUserId = "";
  let agentKeyMode = "sam";
  let threadSearch = "";
  let busy = false;
  let invitePicker = null;
  let agentSourceRow = null;

  function setStatus(message = "", isError = false) {
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.classList.toggle("error", !!isError);
    }
    if (message) onStatus?.(isError ? "error" : "ok", message);
  }

  function currentUserId() {
    return getCurrentUser?.()?.id || "";
  }

  function avatarHtml(user = {}, className = "render-agent-avatar") {
    const name = user.display_name || user.name || user.email || "User";
    const initial = esc(String(name).trim().charAt(0).toUpperCase() || "U");
    const avatar = user.avatar_url || "";
    if (avatar) {
      return `<span class="${className} ${className}--image" style="background-image:url('${esc(avatar)}')" title="${esc(name)}"></span>`;
    }
    return `<span class="${className}" title="${esc(name)}">${initial}</span>`;
  }

  function agentLogoHtml(className = "render-agent-avatar") {
    return `<span class="${className} ${className}--image render-agent-logo-avatar" style="background-image:url('${RENDER3D_LOGO_URL}')" title="Render Agent"></span>`;
  }

  function onboardingKey() {
    return `${ONBOARDING_KEY_PREFIX}${currentUserId() || "anonymous"}`;
  }

  function shouldShowOnboarding() {
    if (!currentUserId()) return false;
    try {
      return localStorage.getItem(onboardingKey()) !== "1";
    } catch {
      return false;
    }
  }

  function markOnboardingSeen() {
    try {
      localStorage.setItem(onboardingKey(), "1");
    } catch {
      /* local storage is best-effort */
    }
  }

  function open({ onboarding: showOnboarding = false } = {}) {
    if (!currentUserId()) {
      onRequireLogin?.();
      return;
    }
    panel.classList.remove("hidden");
    if (showOnboarding && onboarding) {
      onboarding.classList.remove("hidden");
      markOnboardingSeen();
    }
    void refreshThreads();
    void refreshTeamMembers();
    setTimeout(() => input?.focus(), 50);
  }

  function close() {
    panel.classList.add("hidden");
  }

  function renderThreadMenu() {
    if (activeThreadLabel) {
      activeThreadLabel.textContent = activeThread?.title || "Ask about tools, projects, Fusion, files, and workflows";
    }
    if (!threadListEl) return;
    const folders = [...new Set(threads.map((thread) => thread.folder || "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const query = threadSearch.trim().toLowerCase();
    const filtered = query
      ? threads.filter((thread) => `${thread.title || ""} ${thread.folder || ""}`.toLowerCase().includes(query))
      : threads;
    const grouped = new Map();
    filtered.forEach((thread) => {
      const folder = thread.folder || "Unfiled";
      grouped.set(folder, [...(grouped.get(folder) || []), thread]);
    });
    const folderOptions = (current = "") => `
      <option value="">Unfiled</option>
      ${folders.map((folder) => `<option value="${esc(folder)}"${folder === current ? " selected" : ""}>${esc(folder)}</option>`).join("")}
      <option value="__new__">+ New folder...</option>
    `;
    threadListEl.innerHTML = `
      <div class="render-agent-thread-tools">
        <input type="search" class="render-agent-thread-search" placeholder="Search threads..." value="${esc(threadSearch)}" />
        <button type="button" class="btn secondary btn-compact" data-thread-new-folder>Folder</button>
      </div>
      ${filtered.length ? [...grouped.entries()].map(([folder, items]) => `
        <section class="render-agent-thread-folder">
          <div class="render-agent-thread-folder-title">
            <span>${esc(folder)}</span>
            <small>${items.length}</small>
          </div>
          ${items.map((thread) => `
            <article class="render-agent-thread-card${activeThread?.id === thread.id ? " active" : ""}">
              <button type="button" class="render-agent-thread-item" data-thread-id="${esc(thread.id)}">
                <span>${esc(thread.title || "New thread")}</span>
                <small>${thread.message_count || 0} messages · ${(thread.members || []).length || 1} people</small>
              </button>
              <label class="render-agent-thread-folder-select">Move
                <select data-thread-folder="${esc(thread.id)}">${folderOptions(thread.folder || "")}</select>
              </label>
            </article>
          `).join("")}
        </section>
      `).join("") : `<p class="muted small">No threads match your search.</p>`}
    `;
    threadListEl.querySelector(".render-agent-thread-search")?.addEventListener("input", (event) => {
      threadSearch = event.target.value || "";
      renderThreadMenu();
      const search = threadListEl.querySelector(".render-agent-thread-search");
      search?.focus();
      search?.setSelectionRange?.(threadSearch.length, threadSearch.length);
    });
    threadListEl.querySelector("[data-thread-new-folder]")?.addEventListener("click", () => {
      const name = window.prompt("New Render Agent thread folder name")?.trim();
      if (!name) return;
      if (activeThread?.id) void moveThreadToFolder(activeThread.id, name);
    });
    threadListEl.querySelectorAll("[data-thread-id]").forEach((item) => {
      item.addEventListener("click", () => {
        threadPopover?.classList.add("hidden");
        threadMenuBtn?.setAttribute("aria-expanded", "false");
        void loadThread(item.dataset.threadId);
      });
    });
    threadListEl.querySelectorAll("[data-thread-folder]").forEach((select) => {
      select.addEventListener("change", () => {
        let folder = select.value || "";
        if (folder === "__new__") {
          folder = window.prompt("Move thread to new folder")?.trim() || "";
          if (!folder) {
            renderThreadMenu();
            return;
          }
        }
        void moveThreadToFolder(select.dataset.threadFolder, folder);
      });
    });
  }

  function renderMembers() {
    if (!membersEl) return;
    const members = activeThread?.members?.length
      ? activeThread.members
      : [getCurrentUser?.()].filter(Boolean);
    membersEl.innerHTML = members
      .map((member) => avatarHtml(member, "render-agent-member-avatar"))
      .join("");
  }

  function ensureAgentControls() {
    if (!agentSourceRow && membersEl?.parentElement) {
      agentSourceRow = document.createElement("div");
      agentSourceRow.className = "render-agent-source-row";
      membersEl.parentElement.insertAdjacentElement("afterend", agentSourceRow);
    }
    if (!invitePicker && inviteSelect?.parentElement) {
      inviteSelect.hidden = true;
      invitePicker = document.createElement("div");
      invitePicker.className = "render-agent-invite-picker";
      inviteSelect.insertAdjacentElement("afterend", invitePicker);
    }
  }

  function renderAgentSource() {
    ensureAgentControls();
    if (!agentSourceRow) return;
    agentSourceRow.innerHTML = `
      <span class="render-agent-source-label">Agent</span>
      <select class="render-agent-source-select" aria-label="Render Agent model source">
        <option value="sam"${agentKeyMode === "sam" ? " selected" : ""}>Sam's gpt-4o-mini</option>
        <option value="selected"${agentKeyMode === "selected" ? " selected" : ""}>My selected AI key</option>
      </select>
      <span class="render-agent-source-hint">${agentKeyMode === "sam" ? "Cheap context chat for code/project help" : "Uses your selected personal/team key"}</span>
    `;
    agentSourceRow.querySelector("select")?.addEventListener("change", (event) => {
      agentKeyMode = event.target.value === "selected" ? "selected" : "sam";
      renderAgentSource();
    });
  }

  function candidateLabel(member = {}) {
    return member.display_name || member.email || member.id || "Teammate";
  }

  function candidateSubtitle(member = {}) {
    const team = member.team_name || "workspace";
    return member.source === "current_workspace" ? `Current workspace · ${team}` : `Other shared workspace · ${team}`;
  }

  function renderInviteOptions() {
    ensureAgentControls();
    if (!invitePicker || !inviteSelect) return;
    const existing = new Set((activeThread?.members || []).map((member) => member.id));
    const candidates = teamMembers.filter((member) => member.id && member.id !== currentUserId() && !existing.has(member.id));
    const selected = candidates.find((member) => member.id === selectedInviteUserId);
    if (selectedInviteUserId && !selected) selectedInviteUserId = "";
    const query = inviteQuery.trim().toLowerCase();
    const filtered = query
      ? candidates.filter((member) => `${candidateLabel(member)} ${member.email || ""} ${member.team_name || ""}`.toLowerCase().includes(query))
      : candidates;
    inviteSelect.value = selectedInviteUserId;
    const canInvite = !!activeThread?.id && candidates.length > 0;
    if (inviteBtn) inviteBtn.disabled = !canInvite || !selectedInviteUserId;
    invitePicker.innerHTML = `
      <button type="button" class="render-agent-invite-trigger" aria-expanded="${inviteOpen ? "true" : "false"}">
        <span>${selected ? esc(candidateLabel(selected)) : "Invite teammate or friend..."}</span>
        <small>${selected ? esc(candidateSubtitle(selected)) : `${candidates.length} available`}</small>
      </button>
      <div class="render-agent-invite-popover${inviteOpen ? "" : " hidden"}">
        <input type="search" class="render-agent-invite-search" placeholder="Search teammates..." value="${esc(inviteQuery)}" />
        <div class="render-agent-invite-list">
          ${filtered.length ? filtered.map((member) => `
            <button type="button" class="render-agent-invite-option${member.id === selectedInviteUserId ? " active" : ""}" data-user-id="${esc(member.id)}">
              ${avatarHtml(member, "render-agent-invite-avatar")}
              <span>
                <strong>${esc(candidateLabel(member))}</strong>
                <small>${esc(candidateSubtitle(member))}</small>
              </span>
            </button>
          `).join("") : `<p class="muted small">No inviteable people found.</p>`}
        </div>
      </div>
    `;
    invitePicker.querySelector(".render-agent-invite-trigger")?.addEventListener("click", () => {
      inviteOpen = !inviteOpen;
      renderInviteOptions();
      if (inviteOpen) invitePicker.querySelector(".render-agent-invite-search")?.focus();
    });
    invitePicker.querySelector(".render-agent-invite-search")?.addEventListener("input", (event) => {
      inviteQuery = event.target.value || "";
      renderInviteOptions();
    });
    invitePicker.querySelectorAll("[data-user-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedInviteUserId = btn.dataset.userId || "";
        inviteOpen = false;
        renderInviteOptions();
      });
    });
  }

  bumpTipOnRefresh();

  function renderAgentTipCard({ compact = false } = {}) {
    const tip = getCurrentTip();
    if (!tip) return "";
    return `
      <div class="render-agent-tip${compact ? " render-agent-tip--compact" : ""}">
        <div class="render-agent-tip-head">
          <span class="render-agent-tip-badge ${tipTopicClass(tip.topic)}">${esc(tip.topic)}</span>
          <span class="render-agent-tip-label">Tip to get started</span>
        </div>
        <strong class="render-agent-tip-title">${esc(tip.title)}</strong>
        <p class="render-agent-tip-body">${esc(tip.body)}</p>
        <button type="button" class="btn secondary btn-compact render-agent-tip-try" data-tip-starter="${esc(tip.starter)}">
          Ask this
        </button>
      </div>
    `;
  }

  function bindTipActions(root) {
    root?.querySelectorAll("[data-tip-starter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const starter = btn.getAttribute("data-tip-starter") || "";
        if (input && starter) {
          input.value = starter;
          input.focus();
          input.setSelectionRange(starter.length, starter.length);
        }
      });
    });
  }

  function renderMessages() {
    const messages = activeThread?.messages || [];
    if (!messages.length) {
      messagesEl.innerHTML = `
        <div class="render-agent-empty">
          <strong>Ask me anything about Render3D.</strong>
          ${renderAgentTipCard()}
        </div>
      `;
      bindTipActions(messagesEl);
      return;
    }
    const tipHtml = renderAgentTipCard({ compact: true });
    messagesEl.innerHTML = `
      ${tipHtml}
      ${messages
      .map((msg) => {
        const fallbackSender = msg.role === "user" ? getCurrentUser?.() : { display_name: "Render Agent" };
        const sender = msg.sender || fallbackSender || {};
        const name = sender.display_name || (msg.role === "user" ? "You" : "Render Agent");
        const avatar = msg.role === "user" ? avatarHtml(sender) : agentLogoHtml();
        return `
        <article class="render-agent-message render-agent-message--${esc(msg.role || "assistant")}">
          <header class="render-agent-message-head">
            ${avatar}
            <div>
              <strong>${esc(msg.role === "user" && sender.id === currentUserId() ? "You" : name)}</strong>
              <small>${esc(msg.created_at ? new Date(msg.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit" }) : "")}</small>
            </div>
          </header>
          <div class="render-agent-message-content">${renderMessageText(msg.content || "")}</div>
        </article>
      `;
      })
      .join("")}
    `;
    bindTipActions(messagesEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderAttachments() {
    if (!attachmentsEl) return;
    attachmentsEl.innerHTML = attachments
      .map((item) => `
        <button type="button" class="render-agent-attachment" data-id="${esc(item.id)}" title="Remove ${esc(item.name)}">
          <span>${esc(item.name)}</span>
          <small>${esc(item.media_type || "file")}</small>
        </button>
      `)
      .join("");
    attachmentsEl.querySelectorAll(".render-agent-attachment").forEach((el) => {
      el.addEventListener("click", () => {
        attachments = attachments.filter((item) => item.id !== el.dataset.id);
        renderAttachments();
      });
    });
  }

  async function refreshThreads() {
    try {
      const data = await api("/api/render-agent/threads");
      threads = data.threads || [];
      if (!threads.length) {
        const created = await api("/api/render-agent/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Getting started" }),
        });
        activeThread = created.thread;
        threads = [{ id: activeThread.id, title: activeThread.title, message_count: 0 }];
      } else if (!activeThread || !threads.some((thread) => thread.id === activeThread.id)) {
        await loadThread(threads[0].id, { skipSelectRender: true });
      }
      renderThreadMenu();
      renderMessages();
      renderMembers();
      renderInviteOptions();
    } catch (err) {
      setStatus(err.message || "Could not load Render Agent threads.", true);
    }
  }

  async function loadThread(threadId, { skipSelectRender = false } = {}) {
    if (!threadId) return;
    const data = await api(`/api/render-agent/threads/${encodeURIComponent(threadId)}`);
    activeThread = data.thread;
    if (!skipSelectRender) renderThreadMenu();
    renderMessages();
    renderMembers();
    renderInviteOptions();
  }

  function closeThreadMenu() {
    threadPopover?.classList.add("hidden");
    threadMenuBtn?.setAttribute("aria-expanded", "false");
  }

  async function createThread() {
    bumpTipForNewThread();
    closeThreadMenu();
    const data = await api("/api/render-agent/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New question" }),
    });
    activeThread = data.thread;
    threads = [{ id: activeThread.id, title: activeThread.title, message_count: 0 }, ...threads];
    renderThreadMenu();
    renderMessages();
    renderMembers();
    renderInviteOptions();
    setTimeout(() => input?.focus(), 40);
  }

  async function moveThreadToFolder(threadId, folder) {
    if (!threadId) return;
    try {
      const data = await api(`/api/render-agent/threads/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      const updated = data.thread || {};
      threads = threads.map((thread) => thread.id === threadId ? { ...thread, folder: updated.folder || "" } : thread);
      if (activeThread?.id === threadId) activeThread = { ...activeThread, folder: updated.folder || "" };
      renderThreadMenu();
      setStatus(folder ? `Moved thread to ${folder}.` : "Moved thread to Unfiled.");
    } catch (err) {
      setStatus(err.message || "Could not move thread.", true);
    }
  }

  async function refreshTeamMembers() {
    const teamId = getSelectedWorkspaceId?.() || getTeams?.()?.[0]?.id || "";
    try {
      const path = teamId
        ? `/api/render-agent/invite-candidates?team_id=${encodeURIComponent(teamId)}`
        : "/api/render-agent/invite-candidates";
      const data = await api(path);
      teamMembers = data.candidates || data.members || [];
    } catch {
      teamMembers = [];
    }
    renderInviteOptions();
  }

  async function inviteSelectedMember() {
    const userId = selectedInviteUserId || inviteSelect?.value;
    if (!userId || !activeThread?.id) return;
    const candidate = teamMembers.find((member) => member.id === userId);
    const teamId = candidate?.team_id || getSelectedWorkspaceId?.() || getTeams?.()?.[0]?.id || null;
    try {
      const data = await api(`/api/render-agent/threads/${encodeURIComponent(activeThread.id)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, team_id: teamId }),
      });
      activeThread = data.thread;
      selectedInviteUserId = "";
      inviteQuery = "";
      await refreshThreads();
      setStatus("Teammate added to this thread.");
    } catch (err) {
      setStatus(err.message || "Could not invite teammate.", true);
    }
  }

  async function addFiles(files) {
    setStatus("");
    for (const file of [...files]) {
      if (attachments.length >= 6) break;
      if (file.size > 8 * 1024 * 1024) {
        setStatus(`${file.name} is too large. Use files under 8 MB.`, true);
        continue;
      }
      const base = {
        id: `att-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name || "upload",
        media_type: file.type || "application/octet-stream",
      };
      try {
        if (isImage(file)) {
          attachments.push({ ...base, data_url: await fileToDataUrl(file) });
        } else if (isTextLike(file)) {
          attachments.push({ ...base, text: (await fileToText(file)).slice(0, 20000) });
        } else {
          attachments.push({ ...base, text: `Uploaded file metadata only: ${file.name} (${file.type || "unknown type"}, ${file.size} bytes).` });
        }
      } catch (err) {
        setStatus(err.message || `Could not read ${file.name}.`, true);
      }
    }
    renderAttachments();
  }

  async function sendMessage() {
    const message = input?.value.trim() || "";
    if (!message || busy) return;
    busy = true;
    input.value = "";
    setStatus("Render Agent is thinking...");
    const optimistic = {
      ...(activeThread || { messages: [] }),
      messages: [...(activeThread?.messages || []), {
        role: "user",
        content: message,
        sender: getCurrentUser?.(),
        created_at: new Date().toISOString(),
      }],
    };
    activeThread = optimistic;
    renderMessages();
    try {
      const data = await api("/api/render-agent/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          thread_id: activeThread?.id || null,
          project_id: getProjectId?.() || null,
          attachments,
          selected_file: getSelectedFile?.() || null,
          ...(agentKeyMode === "selected" ? (getSelectedAiKey?.() || {}) : {}),
        }),
      }, 240000);
      activeThread = data.thread;
      attachments = [];
      renderAttachments();
      await refreshThreads();
      setStatus("");
    } catch (err) {
      setStatus(err.message || "Render Agent failed.", true);
      renderMessages();
    } finally {
      busy = false;
    }
  }

  btn.addEventListener("click", () => open());
  closeBtn?.addEventListener("click", close);
  threadMenuBtn?.addEventListener("click", () => {
    const openMenu = threadPopover?.classList.toggle("hidden") === false;
    threadMenuBtn.setAttribute("aria-expanded", openMenu ? "true" : "false");
  });
  newThreadBtn?.addEventListener("click", () => void createThread());
  inviteBtn?.addEventListener("click", () => void inviteSelectedMember());
  fileInput?.addEventListener("change", () => {
    void addFiles(fileInput.files || []);
    fileInput.value = "";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage();
  });
  renderAgentSource();
  renderInviteOptions();

  return {
    open,
    close,
    setUser(user) {
      if (user && shouldShowOnboarding()) open({ onboarding: true });
    },
  };
}
