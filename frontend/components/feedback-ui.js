/** Modern bug / suggestion feedback UI with page-wide image drop. */

import { authHeaders, getStoredUser, getToken, isManagementDashboardUser, isTokenExpired } from "../studio/auth.js?v=20260907-session-keep";

const MAX_SHOTS = 5;
const ACCEPT = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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

function isImageFile(file) {
  if (!file) return false;
  if (file.type && ACCEPT.has(file.type)) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name || "");
}

function collectImageFiles(fileList) {
  return [...(fileList || [])].filter(isImageFile).slice(0, MAX_SHOTS);
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
  instanceBugBtn,
  getProjects = () => [],
  getCurrentProjectId = () => "",
  getSelectedFile = () => "",
  getPromptText = () => "",
  onSubmitted,
} = {}) {
  let modal = null;
  let pageDrop = null;
  let prompts = [];
  let pendingFiles = [];
  let previewUrls = [];
  let dragDepth = 0;
  let activeKind = "bug";
  let feedbackPromptsAbort = null; // leakfix78
  function beginFeedbackPromptsFetch() {
    if (feedbackPromptsAbort) {
      try { feedbackPromptsAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    feedbackPromptsAbort = ctl;
    return ctl;
  }

  function projectOptions() {
    const current = getCurrentProjectId?.() || "";
    const projects = [...(getProjects?.() || [])];
    projects.sort((a, b) => String(a.name || a.id || "").localeCompare(String(b.name || b.id || "")));
    return [
      `<option value="">No project context</option>`,
      ...projects.map((project) => {
        const id = String(project.id || "");
        const label = project.name || id;
        return `<option value="${esc(id)}" ${id === current ? "selected" : ""}>${esc(label)}</option>`;
      }),
    ].join("");
  }

  function revokePreviews() {
    for (const url of previewUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    previewUrls = [];
  }

  function addFiles(files) {
    for (const file of collectImageFiles(files)) {
      if (pendingFiles.length >= MAX_SHOTS) break;
      const dup = pendingFiles.some((f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
      if (dup) continue;
      pendingFiles.push(file);
    }
    renderShots();
  }

  function removeFile(index) {
    pendingFiles.splice(index, 1);
    renderShots();
  }

  function renderShots() {
    const host = modal?.querySelector("#feedback-shots");
    const hint = modal?.querySelector("#feedback-drop-hint");
    if (!host) return;
    revokePreviews();
    if (!pendingFiles.length) {
      host.innerHTML = "";
      host.classList.add("is-empty");
      if (hint) hint.classList.remove("hidden");
      return;
    }
    host.classList.remove("is-empty");
    if (hint) hint.classList.add("hidden");
    host.innerHTML = pendingFiles
      .map((file, index) => {
        const url = URL.createObjectURL(file);
        previewUrls.push(url);
        return `
          <figure class="feedback-shot" data-shot-index="${index}">
            <img src="${esc(url)}" alt="${esc(file.name)}" />
            <button type="button" class="feedback-shot-remove" data-remove-shot="${index}" aria-label="Remove ${esc(file.name)}">×</button>
            <figcaption>${esc(file.name)}</figcaption>
          </figure>`;
      })
      .join("");
    host.querySelectorAll("[data-remove-shot]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        removeFile(Number(btn.dataset.removeShot));
      });
    });
  }

  async function loadPrompts(projectId) {
    const select = modal?.querySelector("#feedback-prompt");
    if (!select) return;
    if (!projectId) {
      if (feedbackPromptsAbort) {
        try { feedbackPromptsAbort.abort(); } catch (_) { /* ignore */ }
        feedbackPromptsAbort = null;
      }
      prompts = [];
      select.innerHTML = `<option value="">No prompt context</option>`;
      return;
    }
    const ctl = beginFeedbackPromptsFetch();
    if (!select.querySelector("option[value]:not([value=''])")) {
      select.innerHTML = `<option value="">Loading…</option>`;
    }
    try {
      const data = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/prompt-history?kind=cad&limit=50`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      prompts = data.entries || [];
      select.innerHTML = [
        `<option value="">No prompt context</option>`,
        ...prompts.map((entry) => {
          const label = `${formatWhen(entry.created_at)} · ${String(entry.prompt || "").slice(0, 64)}`;
          return `<option value="${esc(entry.id)}">${esc(label)}</option>`;
        }),
      ].join("");
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      select.innerHTML = `<option value="">Could not load prompts</option>`;
    } finally {
      if (feedbackPromptsAbort === ctl) feedbackPromptsAbort = null;
    }
  }

  function setKind(kind) {
    activeKind = kind === "instance" ? "instance" : kind === "suggestion" ? "suggestion" : "bug";
    if (!modal) return;
    modal.querySelectorAll("[data-feedback-kind]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.feedbackKind === activeKind);
    });
    const title = modal.querySelector("#feedback-title");
    const sub = modal.querySelector("#feedback-sub");
    const submit = modal.querySelector("#feedback-submit");
    const message = modal.querySelector("#feedback-message");
    if (title) title.textContent = activeKind === "instance" ? "Report an instance bug" : activeKind === "bug" ? "Report a bug" : "Share a suggestion";
    if (sub) {
      sub.textContent =
        activeKind === "instance"
          ? "Report installation, updates, connectivity, or Render ecosystem problems. This goes to central Render management with the instance ID."
          : activeKind === "bug"
          ? "Tell us what broke. Drop screenshots anywhere on the page or into this panel."
          : "Tell us what to improve. Drop reference images anywhere on the page or into this panel.";
    }
    if (submit) submit.textContent = activeKind === "instance" ? "Send instance bug" : activeKind === "bug" ? "Send bug report" : "Send suggestion";
    if (message && !message.value) {
      message.placeholder =
        activeKind === "instance" ? "What is wrong with this Render installation?" : activeKind === "bug" ? "What broke? What did you expect?" : "What should we add or improve?";
    }
    modal.querySelector("#feedback-dropzone")?.classList.toggle("hidden", activeKind === "instance");
    modal.querySelector(".feedback-context")?.classList.toggle("hidden", activeKind === "instance");
    modal.classList.toggle("feedback-modal-backdrop--bug", activeKind === "bug");
    modal.classList.toggle("feedback-modal-backdrop--idea", activeKind === "suggestion");
  }

  function close() {
    hidePageDrop();
    revokePreviews();
    document.body.classList.remove("feedback-open");
    try {
      window.__stopPromptDictation?.("feedback-message");
    } catch {
      /* ignore */
    }
    if (feedbackPromptsAbort) {
      try { feedbackPromptsAbort.abort(); } catch (_) { /* ignore */ }
      feedbackPromptsAbort = null;
    }
    modal?.remove();
    modal = null;
    prompts = [];
    pendingFiles = [];
  }

  function open(kind = "bug", { files = [] } = {}) {
    close();
    activeKind = kind === "instance" ? "instance" : kind === "suggestion" ? "suggestion" : "bug";
    pendingFiles = [];
    document.body.classList.add("feedback-open");
    modal = document.createElement("div");
    modal.className = `feedback-modal-backdrop feedback-modal-backdrop--${activeKind === "bug" ? "bug" : "idea"}`;
    modal.innerHTML = `
      <form class="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <header class="feedback-modal-head">
          <div class="feedback-modal-brand">
            <div class="feedback-kind-switch" role="tablist" aria-label="Feedback type">
              <button type="button" class="feedback-kind-btn" data-feedback-kind="bug" role="tab">Bug</button>
              <button type="button" class="feedback-kind-btn" data-feedback-kind="suggestion" role="tab">Suggestion</button>
            </div>
            <h2 id="feedback-title">Report a bug</h2>
            <p class="feedback-sub" id="feedback-sub">Tell us what broke. Drop screenshots anywhere on the page or into this panel.</p>
          </div>
          <button type="button" class="feedback-modal-close" aria-label="Close">×</button>
        </header>

        <div class="feedback-field feedback-field--message">
          <span class="feedback-message-head">
            <label for="feedback-message">Message</label>
            <button type="button" class="prompt-mic-btn" data-mic-target="feedback-message" title="Dictate prompt (click to start/stop)" aria-label="Dictate suggestion">
              <span class="prompt-mic-icon" aria-hidden="true">🎙</span>
            </button>
          </span>
          <textarea id="feedback-message" rows="4" required maxlength="6000" placeholder="What broke? What did you expect?"></textarea>
        </div>

        <div class="feedback-dropzone" id="feedback-dropzone" tabindex="0" aria-label="Drop screenshots here">
          <input id="feedback-screenshots" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden />
          <div class="feedback-drop-hint" id="feedback-drop-hint">
            <strong>Drop images here</strong>
            <span>or click to browse · PNG, JPG, WebP, GIF · up to ${MAX_SHOTS}</span>
          </div>
          <div class="feedback-shots is-empty" id="feedback-shots"></div>
        </div>

        <details class="feedback-context">
          <summary>Add project / prompt context</summary>
          <div class="feedback-grid">
            <label class="feedback-field">Project
              <select id="feedback-project">${projectOptions()}</select>
            </label>
            <label class="feedback-field">Prompt / trace
              <select id="feedback-prompt"><option value="">No prompt context</option></select>
            </label>
          </div>
          <p class="muted small feedback-context-note">Current file, page URL, and prompt text are included automatically.</p>
        </details>

        <p class="feedback-status" id="feedback-status" role="status"></p>
        <footer class="feedback-actions">
          <button type="button" class="btn secondary" data-feedback-cancel>Cancel</button>
          <button type="submit" class="btn accent" id="feedback-submit">Send bug report</button>
        </footer>
      </form>
    `;
    document.body.appendChild(modal);
    setKind(activeKind);
    if (files?.length) addFiles(files);

    const projectSelect = modal.querySelector("#feedback-project");
    void loadPrompts(projectSelect?.value || "");

    modal.querySelector(".feedback-modal-close")?.addEventListener("click", close);
    modal.querySelector("[data-feedback-cancel]")?.addEventListener("click", close);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });
    modal.querySelectorAll("[data-feedback-kind]").forEach((btn) => {
      btn.addEventListener("click", () => setKind(btn.dataset.feedbackKind));
    });
    projectSelect?.addEventListener("change", () => void loadPrompts(projectSelect.value));
    modal.querySelector("form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submit();
    });

    const dropzone = modal.querySelector("#feedback-dropzone");
    const fileInput = modal.querySelector("#feedback-screenshots");
    dropzone?.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-remove-shot]")) return;
      fileInput?.click();
    });
    fileInput?.addEventListener("change", () => {
      addFiles(fileInput.files);
      fileInput.value = "";
    });
    ["dragenter", "dragover"].forEach((type) => {
      dropzone?.addEventListener(type, (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        dropzone.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      dropzone?.addEventListener(type, (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        dropzone.classList.remove("is-dragover");
      });
    });
    dropzone?.addEventListener("drop", (ev) => {
      addFiles(ev.dataTransfer?.files);
    });

    modal.querySelector("#feedback-message")?.focus();
  }

  async function submit() {
    const status = modal?.querySelector("#feedback-status");
    const submitBtn = modal?.querySelector("#feedback-submit");
    const projectSelect = modal?.querySelector("#feedback-project");
    const promptSelect = modal?.querySelector("#feedback-prompt");
    const messageEl = modal?.querySelector("#feedback-message");
    const message = String(messageEl?.value || "").trim();
    if (!message) {
      if (status) {
        status.textContent = "Add a short message first.";
        status.className = "feedback-status is-error";
      }
      messageEl?.focus();
      return;
    }
    const projectId = projectSelect?.value || "";
    const project = (getProjects?.() || []).find((item) => String(item.id) === projectId);
    const promptId = promptSelect?.value || "";
    const prompt = prompts.find((item) => String(item.id) === promptId);
    const form = new FormData();
    form.append("kind", activeKind);
    form.append("message", message);
    form.append("page_url", window.location.href);
    if (projectId) form.append("project_id", projectId);
    if (project?.name) form.append("project_name", project.name);
    if (promptId) form.append("prompt_id", promptId);
    if (prompt?.trace_id) form.append("trace_id", prompt.trace_id);
    if (prompt?.prompt) form.append("prompt_label", prompt.prompt);
    form.append(
      "context_json",
      JSON.stringify({
        selected_file: getSelectedFile?.() || null,
        current_project_id: getCurrentProjectId?.() || null,
        current_prompt_text: String(getPromptText?.() || "").slice(0, 4000),
        user_agent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
        },
      })
    );
    pendingFiles.slice(0, MAX_SHOTS).forEach((file) => form.append("screenshots", file));
    if (status) {
      status.textContent = "Sending…";
      status.className = "feedback-status";
    }
    if (submitBtn) submitBtn.disabled = true;
    try {
      if (activeKind === "instance") {
        await requestJson("/api/setup/instance-support", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "issue",
            subject: "Studio instance bug",
            message,
            severity: "normal",
            diagnostic: "",
          }),
        });
        onSubmitted?.({ kind: "instance_bug" });
        if (status) {
          status.textContent = "Sent to Render management — thank you.";
          status.className = "feedback-status is-ok";
        }
        setTimeout(close, 700);
        return;
      }
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
      if (status) {
        status.textContent = "Sent — thank you.";
        status.className = "feedback-status is-ok";
      }
      setTimeout(close, 700);
    } catch (err) {
      if (status) {
        status.textContent = err.message || "Could not submit.";
        status.className = "feedback-status is-error";
      }
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function ensurePageDrop() {
    if (pageDrop) return pageDrop;
    pageDrop = document.createElement("div");
    pageDrop.id = "feedback-page-drop";
    pageDrop.className = "feedback-page-drop hidden";
    pageDrop.innerHTML = `
      <div class="feedback-page-drop-card">
        <strong>Drop screenshot to report</strong>
        <span>Opens Report Bug with your images attached — switch to Suggestion in the dialog if you prefer</span>
      </div>
    `;
    document.body.appendChild(pageDrop);
    return pageDrop;
  }

  function showPageDrop(files) {
    const el = ensurePageDrop();
    el._pendingFiles = files;
    el.classList.remove("hidden");
    document.body.classList.add("feedback-page-dragging");
  }

  function hidePageDrop() {
    if (!pageDrop) return;
    pageDrop.classList.add("hidden");
    pageDrop._pendingFiles = null;
    document.body.classList.remove("feedback-page-dragging");
    dragDepth = 0;
  }

  function isForeignDropTarget(target) {
    return !!target?.closest?.(
      [
        "#viewport",
        "#viewport-drop-overlay",
        ".viewport-drop-overlay",
        "#ref-viewer",
        "#dxf-viewer",
        "#doc-tab-bar",
        "#prompt-panel",
        "#prompt-pane-compose",
        "#prompt-image-drop",
        "#wiring-prompt-image-drop",
        "#rigging-prompt-image-drop",
        "#project-chat-overlay",
        ".pc-composer",
        ".prompt-composer",
        ".prompt-dropzone",
        "[data-no-feedback-drop]",
        "input",
        "textarea",
        ".CodeMirror",
        ".monaco-editor",
      ].join(", "),
    );
  }

  function hasImageDrag(ev) {
    const types = [...(ev.dataTransfer?.types || [])];
    if (!types.includes("Files")) return false;
    const items = [...(ev.dataTransfer?.items || [])];
    if (!items.length) return true;
    return items.some((item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")));
  }

  document.addEventListener("dragenter", (ev) => {
    if (!hasImageDrag(ev)) return;
    // Viewport / studio surfaces own image drops — never keep the screenshot banner up there.
    if (isForeignDropTarget(ev.target)) {
      hidePageDrop();
      return;
    }
    ev.preventDefault();
    dragDepth += 1;
    if (modal) {
      modal.querySelector("#feedback-dropzone")?.classList.add("is-dragover");
      return;
    }
    showPageDrop([]);
  });

  document.addEventListener("dragover", (ev) => {
    if (!hasImageDrag(ev)) return;
    if (isForeignDropTarget(ev.target)) {
      hidePageDrop();
      return;
    }
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  });

  document.addEventListener("dragleave", (ev) => {
    if (!hasImageDrag(ev) && dragDepth <= 0) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      if (modal) modal.querySelector("#feedback-dropzone")?.classList.remove("is-dragover");
      else hidePageDrop();
    }
  });

  document.addEventListener("drop", (ev) => {
    if (!hasImageDrag(ev)) return;
    if (isForeignDropTarget(ev.target)) {
      dragDepth = 0;
      hidePageDrop();
      return;
    }
    ev.preventDefault();
    dragDepth = 0;
    const files = collectImageFiles(ev.dataTransfer?.files);
    if (modal) {
      modal.querySelector("#feedback-dropzone")?.classList.remove("is-dragover");
      if (files.length) addFiles(files);
      hidePageDrop();
      return;
    }
    if (!files.length) {
      hidePageDrop();
      return;
    }
    // Drop straight onto the page → open bug report with images attached.
    hidePageDrop();
    open("bug", { files });
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && modal) close();
  });

  suggestionBtn?.addEventListener("click", (event) => {
    if (typeof window.__openStudioSuggest === "function") {
      event.preventDefault();
      window.__openStudioSuggest();
      return;
    }
    open("suggestion");
  });
  bugBtn?.addEventListener("click", () => open("bug"));
  instanceBugBtn?.addEventListener("click", () => open("instance"));

  return { open, close };
}

export function initManagementNotifications({ intervalMs = 30000 } = {}) {
  const toolbar = document.getElementById("btn-admin-dashboard-toolbar");
  const menuLink = document.getElementById("btn-admin-dashboard");
  let timer = null;
  let socket = null;
  let reconnectTimer = null;

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
    if (!isManagementDashboardUser(user)) {
      apply({ unread_count: 0 });
      return;
    }
    try {
      apply(await requestJson("/api/admin/management/summary"));
    } catch {
      /* ignore badge refresh failures */
    }
  }

  function realtimeUrl() {
    const token = encodeURIComponent(getToken());
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/api/ws/user?token=${token}`;
  }

  let realtimeAuthFailed = false;
  function connectRealtime() {
    if (socket || realtimeAuthFailed || !isManagementDashboardUser(getStoredUser()) || !getToken()) return;
    socket = new WebSocket(realtimeUrl());
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "management.notification.updated") {
          apply(msg.summary || {});
          window.dispatchEvent(new CustomEvent("render3d:management-notification", { detail: msg }));
        }
      } catch {
        /* ignore malformed realtime payload */
      }
    };
    socket.onclose = (ev) => {
      socket = null;
      // Expired JWT only — a KeepAlive restart close must reconnect, not logout.
      if ((ev?.code === 1008 || ev?.code === 4401) && isTokenExpired()) {
        realtimeAuthFailed = true;
        return;
      }
      if (!getToken()) {
        realtimeAuthFailed = true;
        return;
      }
      if (!reconnectTimer && isManagementDashboardUser(getStoredUser())) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connectRealtime();
        }, 2500);
      }
    };
  }

  void poll();
  connectRealtime();
  window.addEventListener("storage", (event) => {
    if (event.key === "render3d:user") {
      void poll();
      connectRealtime();
    }
  });
  window.addEventListener("render3d:feedback-submitted", () => void poll());
  timer = window.setInterval(poll, intervalMs);
  return {
    refresh: poll,
    stop: () => {
      if (timer) window.clearInterval(timer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
