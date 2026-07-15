/** Project collaboration chat — popup over the viewport. */

import { authHeaders, getStoredUser, getToken } from "./auth.js?v=20260715-auth-connect-social";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👀"];
const LS_UNREAD = "render3d:projectChatUnread:v1";

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

function simpleMarkdown(text) {
  let html = esc(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^\*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(
    /@\[([^\]]+)\]\((user|agent):([^)]+)\)/g,
    '<span class="pc-mention pc-mention--$2" data-mention-kind="$2" data-mention-id="$3"><span class="pc-mention-label">@$1</span></span>'
  );
  html = html.replace(/\n/g, "<br>");
  return html;
}

function createMentionChip(name, kind, id) {
  const chip = document.createElement("span");
  chip.className = `pc-mention-chip pc-mention-chip--${kind === "agent" ? "agent" : "user"}`;
  chip.contentEditable = "false";
  chip.dataset.mentionKind = kind;
  chip.dataset.mentionId = id;
  chip.dataset.mentionName = name;
  chip.dataset.token = `@[${name}](${kind}:${id})`;
  chip.title = `@${name}`;
  const label = document.createElement("span");
  label.className = "pc-mention-chip-label";
  label.textContent = `@${name}`;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "pc-mention-chip-remove";
  remove.title = "Remove mention";
  remove.setAttribute("aria-label", `Remove @${name}`);
  remove.textContent = "×";
  remove.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });
  remove.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const parent = chip.parentNode;
    chip.remove();
    if (parent?.normalize) parent.normalize();
  });
  chip.append(label, remove);
  return chip;
}

function serializeComposer(el) {
  if (!el) return "";
  let out = "";
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue || "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.classList?.contains("pc-mention-chip")) {
      out += node.dataset.token || "";
      return;
    }
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    const block = node.tagName === "DIV" || node.tagName === "P";
    if (block && out && !out.endsWith("\n")) out += "\n";
    for (const child of node.childNodes) walk(child);
  };
  for (const child of el.childNodes) walk(child);
  return out.replace(/\u00a0/g, " ").replace(/\n+$/g, "").trim();
}

function clearComposer(el) {
  if (!el) return;
  el.innerHTML = "";
}

function textBeforeCaret(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) {
    return el.innerText || "";
  }
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return range.toString();
}

function insertMentionChip(el, name, kind, id) {
  el.focus();
  const sel = window.getSelection();
  const chip = createMentionChip(name, kind, id);
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
    const caret = sel.getRangeAt(0);
    const node = caret.startContainer;
    const offset = caret.startOffset;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue || "";
      const before = text.slice(0, offset);
      const match = before.match(/@([^\s@]*)$/);
      if (match) {
        const start = offset - match[0].length;
        node.nodeValue = text.slice(0, start) + text.slice(offset);
        caret.setStart(node, start);
        caret.collapse(true);
        sel.removeAllRanges();
        sel.addRange(caret);
      }
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(chip);
    const space = document.createTextNode("\u00a0");
    chip.after(space);
    range.setStartAfter(space);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  el.appendChild(chip);
  el.appendChild(document.createTextNode("\u00a0"));
}

async function api(path, options = {}) {
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
      /* ignore */
    }
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  if (res.status === 204) return null;
  return res.json();
}

async function authBlobUrl(path) {
  if (!path) return null;
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return URL.createObjectURL(await res.blob());
}

function readLocalUnread() {
  try {
    return JSON.parse(localStorage.getItem(LS_UNREAD) || "{}");
  } catch {
    return {};
  }
}

function writeLocalUnread(map) {
  try {
    localStorage.setItem(LS_UNREAD, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function createProjectChatUI({
  buttonEl,
  getProjectId = () => null,
  getProjectName = () => "",
  onOpenRenderAgent = null,
  onStatus = null,
} = {}) {
  let open = false;
  let overlay = null;
  let threads = [];
  let activeThreadId = null;
  let messages = [];
  let candidates = [];
  let replyTo = null;
  let pendingFiles = [];
  let mentionIndex = -1;
  let unread = { unread_count: 0, mention_count: 0 };
  let pollTimer = null;
  let workspaceRole = null;
  let activeThreadMeta = null;
  let imageBlobUrls = [];

  function revokeImageBlobs() {
    for (const url of imageBlobUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    imageBlobUrls = [];
  }

  function canInviteToActiveThread() {
    const me = getStoredUser()?.id;
    if (!me || !activeThreadMeta) return false;
    if (["owner", "manager"].includes(String(workspaceRole || ""))) return true;
    return String(activeThreadMeta.created_by || "") === String(me);
  }

  function setBadge() {
    if (!buttonEl) return;
    let badge = buttonEl.querySelector(".pc-btn-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "pc-btn-badge hidden";
      buttonEl.appendChild(badge);
    }
    const mentions = Number(unread.mention_count || 0);
    const count = Number(unread.unread_count || 0);
    if (mentions > 0) {
      badge.textContent = mentions > 9 ? "9+" : String(mentions);
      badge.classList.remove("hidden");
      badge.classList.add("pc-btn-badge--mention");
      badge.title = `You were tagged in ${mentions} chat message${mentions === 1 ? "" : "s"}`;
    } else if (count > 0) {
      badge.textContent = count > 9 ? "9+" : String(count);
      badge.classList.remove("hidden");
      badge.classList.remove("pc-btn-badge--mention");
      badge.title = `${count} new chat message${count === 1 ? "" : "s"}`;
    } else {
      badge.classList.add("hidden");
      badge.classList.remove("pc-btn-badge--mention");
    }
  }

  function persistUnreadHint(projectId, summary) {
    if (!projectId) return;
    const map = readLocalUnread();
    map[projectId] = {
      unread_count: summary?.unread_count || 0,
      mention_count: summary?.mention_count || 0,
      at: Date.now(),
    };
    writeLocalUnread(map);
  }

  async function refreshUnread() {
    const projectId = getProjectId?.();
    if (!projectId || !getToken()) {
      unread = { unread_count: 0, mention_count: 0 };
      setBadge();
      return unread;
    }
    try {
      unread = await api(`/api/projects/${encodeURIComponent(projectId)}/chat/unread`);
      persistUnreadHint(projectId, unread);
    } catch {
      const cached = readLocalUnread()[projectId];
      unread = cached || { unread_count: 0, mention_count: 0 };
    }
    setBadge();
    return unread;
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "project-chat-overlay";
    overlay.className = "project-chat-overlay hidden";
    overlay.innerHTML = `
      <div class="project-chat-panel" role="dialog" aria-modal="true" aria-label="Project chat">
        <header class="pc-head">
          <div class="pc-head-main">
            <strong id="pc-title">Project chat</strong>
            <span id="pc-subtitle" class="pc-subtitle muted">Collaborate on this model</span>
          </div>
          <div class="pc-head-actions">
            <button type="button" class="pc-icon-btn" id="pc-new-thread" title="New thread">＋</button>
            <button type="button" class="pc-icon-btn" id="pc-close" title="Close chat" aria-label="Close">✕</button>
          </div>
        </header>
        <div class="pc-body">
          <aside class="pc-threads" id="pc-threads" aria-label="Threads"></aside>
          <section class="pc-main">
            <div id="pc-thread-invite" class="pc-thread-invite hidden"></div>
            <div class="pc-messages" id="pc-messages" aria-live="polite"></div>
            <div id="pc-reply-bar" class="pc-reply-bar hidden"></div>
            <div id="pc-drop-hint" class="pc-drop-hint hidden">Drop images to attach</div>
            <div class="pc-composer">
              <div class="pc-toolbar" role="toolbar" aria-label="Formatting">
                <button type="button" data-fmt="bold" title="Bold">B</button>
                <button type="button" data-fmt="italic" title="Italic"><em>I</em></button>
                <button type="button" data-fmt="code" title="Code">&lt;/&gt;</button>
                <button type="button" data-fmt="mention" title="Mention someone">@</button>
                <button type="button" data-fmt="emoji" title="Emoji">☺</button>
                <label class="pc-attach-btn" title="Upload images">
                  🖼
                  <input id="pc-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden />
                </label>
              </div>
              <div id="pc-pending-images" class="pc-pending-images"></div>
              <div class="pc-input-wrap">
                <div id="pc-input" class="pc-input" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Write a message… Use @ to tag people or @RenderAgent"></div>
                <div id="pc-mention-menu" class="pc-mention-menu hidden" role="listbox"></div>
              </div>
              <div class="pc-send-row">
                <span class="muted small">Drag images in · Markdown · Replies · Reactions</span>
                <button type="button" class="btn accent" id="pc-send">Send</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) close();
    });
    overlay.querySelector("#pc-close")?.addEventListener("click", close);
    overlay.querySelector("#pc-send")?.addEventListener("click", () => void sendMessage());
    overlay.querySelector("#pc-new-thread")?.addEventListener("click", () => void createThread());
    overlay.querySelector("#pc-file-input")?.addEventListener("change", (ev) => {
      addFiles([...ev.target.files || []]);
      ev.target.value = "";
    });
    overlay.querySelectorAll("[data-fmt]").forEach((btn) => {
      btn.addEventListener("click", () => applyFormat(btn.getAttribute("data-fmt")));
    });

    const input = overlay.querySelector("#pc-input");
    input?.addEventListener("keydown", (ev) => {
      const menu = overlay.querySelector("#pc-mention-menu");
      const openMenu = menu && !menu.classList.contains("hidden");
      if (openMenu && ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(ev.key)) {
        ev.preventDefault();
        const items = [...menu.querySelectorAll("[data-mention-pick]")];
        if (!items.length) return;
        if (ev.key === "ArrowDown") mentionIndex = (mentionIndex + 1) % items.length;
        if (ev.key === "ArrowUp") mentionIndex = (mentionIndex - 1 + items.length) % items.length;
        items.forEach((el, i) => el.classList.toggle("active", i === mentionIndex));
        if ((ev.key === "Enter" || ev.key === "Tab") && mentionIndex >= 0) {
          items[mentionIndex]?.click();
        }
        return;
      }
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        void sendMessage();
      }
    });
    input?.addEventListener("input", () => updateMentionMenu());

    const panel = overlay.querySelector(".project-chat-panel");
    panel?.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      overlay.querySelector("#pc-drop-hint")?.classList.remove("hidden");
    });
    panel?.addEventListener("dragleave", () => {
      overlay.querySelector("#pc-drop-hint")?.classList.add("hidden");
    });
    panel?.addEventListener("drop", (ev) => {
      ev.preventDefault();
      overlay.querySelector("#pc-drop-hint")?.classList.add("hidden");
      const files = [...(ev.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
      addFiles(files);
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && open) close();
    });

    return overlay;
  }

  function applyFormat(kind) {
    const input = overlay?.querySelector("#pc-input");
    if (!input) return;
    input.focus();
    if (kind === "mention") {
      document.execCommand("insertText", false, "@");
      updateMentionMenu(true);
      return;
    }
    if (kind === "emoji") {
      document.execCommand("insertText", false, "🎉");
      return;
    }
    const sel = window.getSelection();
    const selected = sel?.toString() || "text";
    let insert = selected;
    if (kind === "bold") insert = `**${selected}**`;
    if (kind === "italic") insert = `*${selected}*`;
    if (kind === "code") insert = `\`${selected}\``;
    document.execCommand("insertText", false, insert);
  }

  function addFiles(files) {
    for (const file of files.slice(0, 6)) {
      if (!file.type.startsWith("image/")) continue;
      if (pendingFiles.length >= 6) break;
      pendingFiles.push(file);
    }
    renderPending();
  }

  function renderPending() {
    const host = overlay?.querySelector("#pc-pending-images");
    if (!host) return;
    if (!pendingFiles.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = pendingFiles
      .map((file, index) => {
        const url = URL.createObjectURL(file);
        return `<button type="button" class="pc-pending-thumb" data-pending-index="${index}" title="Remove">
          <img src="${url}" alt="" />
        </button>`;
      })
      .join("");
    host.querySelectorAll("[data-pending-index]").forEach((btn) => {
      btn.addEventListener("click", () => {
        pendingFiles.splice(Number(btn.dataset.pendingIndex), 1);
        renderPending();
      });
    });
  }

  function updateMentionMenu(force = false) {
    const input = overlay?.querySelector("#pc-input");
    const menu = overlay?.querySelector("#pc-mention-menu");
    if (!input || !menu) return;
    const before = textBeforeCaret(input);
    const match = before.match(/@([^\s@]*)$/);
    if (!match && !force) {
      menu.classList.add("hidden");
      return;
    }
    const query = (match?.[1] || "").toLowerCase();
    const filtered = candidates.filter((c) => {
      const hay = `${c.display_name || ""} ${c.handle || ""} ${c.email || ""}`.toLowerCase();
      return !query || hay.includes(query) || String(c.handle || "").toLowerCase().startsWith(query);
    }).slice(0, 8);
    if (!filtered.length) {
      menu.classList.add("hidden");
      return;
    }
    mentionIndex = 0;
    menu.innerHTML = filtered
      .map((c, i) => {
        const avatar = c.avatar_url
          ? `<span class="pc-avatar" style="background-image:url('${esc(c.avatar_url)}')"></span>`
          : `<span class="pc-avatar pc-avatar--initial">${esc((c.display_name || "?").charAt(0).toUpperCase())}</span>`;
        return `<button type="button" class="pc-mention-item${i === 0 ? " active" : ""}" data-mention-pick="${esc(c.id)}" data-mention-type="${esc(c.type)}" data-mention-name="${esc(c.display_name)}" data-mention-handle="${esc(c.handle || c.display_name)}">
          ${avatar}
          <span><strong>@${esc(c.handle || c.display_name)}</strong><small>${esc(c.type === "agent" ? "AI assistant" : c.display_name || c.email || "Teammate")}</small></span>
        </button>`;
      })
      .join("");
    menu.classList.remove("hidden");
    menu.querySelectorAll("[data-mention-pick]").forEach((btn) => {
      btn.addEventListener("mousedown", (ev) => ev.preventDefault());
      btn.addEventListener("click", () => {
        const name = btn.dataset.mentionHandle || btn.dataset.mentionName || "User";
        const kind = btn.dataset.mentionType || "user";
        const id = btn.dataset.mentionPick;
        insertMentionChip(input, name, kind, id);
        menu.classList.add("hidden");
        input.focus();
      });
    });
  }

  function renderThreads() {
    const host = overlay?.querySelector("#pc-threads");
    if (!host) return;
    host.innerHTML = threads
      .map((thread) => {
        const active = thread.id === activeThreadId ? " active" : "";
        const preview = thread.last_message?.body || "No messages yet";
        const badge =
          thread.visibility === "private"
            ? `<em class="pc-thread-badge">Private</em>`
            : thread.slug === "general"
              ? `<em class="pc-thread-badge pc-thread-badge--shared">Render Studio</em>`
              : `<em class="pc-thread-badge pc-thread-badge--shared">Shared</em>`;
        return `<button type="button" class="pc-thread-item${active}" data-thread-id="${esc(thread.id)}">
          <strong>${esc(thread.title || "Thread")} ${badge}</strong>
          <span>${esc(preview.slice(0, 72))}</span>
        </button>`;
      })
      .join("");
    host.querySelectorAll("[data-thread-id]").forEach((btn) => {
      btn.addEventListener("click", () => void selectThread(btn.dataset.threadId));
    });
  }

  function renderInviteBar() {
    const bar = overlay?.querySelector("#pc-thread-invite");
    if (!bar) return;
    if (!activeThreadMeta || !canInviteToActiveThread()) {
      bar.classList.add("hidden");
      bar.innerHTML = "";
      return;
    }
    const memberIds = new Set(
      (activeThreadMeta.members || []).map((m) => String(m.id)).concat(String(activeThreadMeta.created_by || ""))
    );
    const people = (candidates || []).filter((c) => c.type === "user" && c.id && !memberIds.has(String(c.id)));
    const memberChips = (activeThreadMeta.members || [])
      .map((m) => `<span class="pc-thread-member-chip">${esc(m.display_name || "User")}</span>`)
      .join("");
    bar.classList.remove("hidden");
    bar.innerHTML = `
      <div class="pc-thread-invite-row">
        <select id="pc-invite-pick" aria-label="Invite teammate">
          <option value="">Invite teammate…</option>
          ${people
            .map((c) => `<option value="${esc(c.id)}">${esc(c.display_name || c.email || "User")}</option>`)
            .join("")}
        </select>
        <button type="button" class="btn btn-compact secondary" id="pc-invite-btn">Invite</button>
      </div>
      <div class="pc-thread-members">${memberChips || `<span class="muted small">Only you so far</span>`}</div>
    `;
    bar.querySelector("#pc-invite-btn")?.addEventListener("click", () => void inviteSelectedMember());
  }

  async function inviteSelectedMember() {
    const projectId = getProjectId?.();
    const pick = overlay?.querySelector("#pc-invite-pick");
    const userId = pick?.value;
    if (!projectId || !activeThreadId || !userId) return;
    try {
      const data = await api(
        `/api/projects/${encodeURIComponent(projectId)}/chat/threads/${encodeURIComponent(activeThreadId)}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId }),
        }
      );
      if (data.thread) {
        activeThreadMeta = data.thread;
        threads = threads.map((t) => (t.id === data.thread.id ? { ...t, ...data.thread } : t));
        renderThreads();
        renderInviteBar();
      }
      onStatus?.("ok", "Teammate invited to thread");
    } catch (err) {
      onStatus?.("error", err.message || "Could not invite");
    }
  }

  function avatarHtml(msg) {
    if (msg.user_avatar_url) {
      return `<span class="pc-avatar" style="background-image:url('${esc(msg.user_avatar_url)}')" title="${esc(msg.user_name || "")}"></span>`;
    }
    const initial = esc((msg.user_name || "?").trim().charAt(0).toUpperCase() || "?");
    return `<span class="pc-avatar pc-avatar--initial${msg.is_agent ? " pc-avatar--agent" : ""}" title="${esc(msg.user_name || "")}">${initial}</span>`;
  }

  function reactionHtml(msg) {
    const reactions = msg.reactions || {};
    const chips = Object.entries(reactions)
      .filter(([, users]) => Array.isArray(users) && users.length)
      .map(([emoji, users]) => {
        const me = getStoredUser()?.id;
        const active = me && users.includes(me) ? " active" : "";
        return `<button type="button" class="pc-reaction${active}" data-react="${esc(emoji)}" data-message-id="${esc(msg.id)}">${emoji} <span>${users.length}</span></button>`;
      })
      .join("");
    const picker = `<details class="pc-react-picker"><summary>+</summary><div class="pc-react-menu">${REACTIONS.map((emoji) => `<button type="button" data-react="${esc(emoji)}" data-message-id="${esc(msg.id)}">${emoji}</button>`).join("")}</div></details>`;
    return `<div class="pc-reactions">${chips}${picker}</div>`;
  }

  function renderMessages() {
    const host = overlay?.querySelector("#pc-messages");
    if (!host) return;
    revokeImageBlobs();
    const roots = messages.filter((m) => !m.parent_id);
    const byParent = new Map();
    for (const msg of messages) {
      if (!msg.parent_id) continue;
      if (!byParent.has(msg.parent_id)) byParent.set(msg.parent_id, []);
      byParent.get(msg.parent_id).push(msg);
    }

    const renderOne = (msg, depth = 0) => {
      const images = (msg.images || [])
        .map(
          (img, index) =>
            `<a class="pc-msg-image" href="${esc(img.url)}" target="_blank" rel="noopener" data-auth-img="${esc(img.url)}">
              <img data-auth-src="${esc(img.url)}" alt="${esc(img.filename || `image-${index + 1}`)}" />
            </a>`
        )
        .join("");
      const replies = byParent.get(msg.id) || [];
      return `<article class="pc-message${msg.is_agent ? " pc-message--agent" : ""}${depth ? " pc-message--reply" : ""}" data-message-id="${esc(msg.id)}" style="--pc-depth:${depth}">
        <div class="pc-message-head">
          ${avatarHtml(msg)}
          <div class="pc-message-meta">
            <strong>${esc(msg.user_name || "User")}${msg.is_agent ? " · Agent" : ""}</strong>
            <time>${esc(formatWhen(msg.created_at))}</time>
          </div>
          <button type="button" class="pc-reply-btn" data-reply-to="${esc(msg.id)}" data-reply-name="${esc(msg.user_name || "message")}">Reply</button>
        </div>
        <div class="pc-message-body">${simpleMarkdown(msg.body || "")}</div>
        ${images ? `<div class="pc-message-images">${images}</div>` : ""}
        ${reactionHtml(msg)}
        ${replies.map((child) => renderOne(child, Math.min(depth + 1, 4))).join("")}
      </article>`;
    };

    if (!roots.length) {
      host.innerHTML = `<p class="pc-empty muted">No messages yet. Say hi, drop an image, or ping <strong>@RenderAgent</strong>.</p>`;
      return;
    }
    host.innerHTML = roots.map((msg) => renderOne(msg)).join("");
    host.querySelectorAll("[data-reply-to]").forEach((btn) => {
      btn.addEventListener("click", () => {
        replyTo = { id: btn.dataset.replyTo, name: btn.dataset.replyName };
        renderReplyBar();
        overlay.querySelector("#pc-input")?.focus();
      });
    });
    host.querySelectorAll("[data-react]").forEach((btn) => {
      btn.addEventListener("click", () => void toggleReaction(btn.dataset.messageId, btn.dataset.react));
    });
    void hydrateAuthImages(host);
    host.scrollTop = host.scrollHeight;
  }

  async function hydrateAuthImages(host) {
    const imgs = [...(host?.querySelectorAll("img[data-auth-src]") || [])];
    await Promise.all(
      imgs.map(async (img) => {
        const path = img.getAttribute("data-auth-src");
        if (!path) return;
        try {
          const blobUrl = await authBlobUrl(path);
          imageBlobUrls.push(blobUrl);
          img.src = blobUrl;
          const link = img.closest("a.pc-msg-image");
          if (link) link.href = blobUrl;
        } catch {
          img.replaceWith(Object.assign(document.createElement("span"), {
            className: "muted small",
            textContent: "Image unavailable",
          }));
        }
      })
    );
  }

  function renderReplyBar() {
    const bar = overlay?.querySelector("#pc-reply-bar");
    if (!bar) return;
    if (!replyTo) {
      bar.classList.add("hidden");
      bar.innerHTML = "";
      return;
    }
    bar.classList.remove("hidden");
    bar.innerHTML = `<span>Replying to <strong>${esc(replyTo.name)}</strong></span><button type="button" id="pc-cancel-reply">Cancel</button>`;
    bar.querySelector("#pc-cancel-reply")?.addEventListener("click", () => {
      replyTo = null;
      renderReplyBar();
    });
  }

  async function loadCandidates() {
    const projectId = getProjectId?.();
    if (!projectId) return;
    try {
      const data = await api(`/api/projects/${encodeURIComponent(projectId)}/chat/mention-candidates`);
      candidates = data.candidates || [];
    } catch {
      candidates = [
        {
          id: "render-agent",
          display_name: "Render Agent",
          type: "agent",
          handle: "RenderAgent",
          avatar_url: "/render3d-logo.png?v=20260715-new-logo",
        },
      ];
    }
  }

  async function loadThreads() {
    const projectId = getProjectId?.();
    if (!projectId) return;
    const data = await api(`/api/projects/${encodeURIComponent(projectId)}/chat/threads`);
    threads = data.threads || [];
    workspaceRole = data.workspace_role || null;
    unread = data.unread || unread;
    setBadge();
    if (!activeThreadId || !threads.some((t) => t.id === activeThreadId)) {
      activeThreadId = threads[0]?.id || null;
    }
    renderThreads();
  }

  async function selectThread(threadId) {
    const projectId = getProjectId?.();
    if (!projectId || !threadId) return;
    activeThreadId = threadId;
    renderThreads();
    const data = await api(`/api/projects/${encodeURIComponent(projectId)}/chat/threads/${encodeURIComponent(threadId)}`);
    messages = data.thread?.messages || [];
    activeThreadMeta = data.thread || threads.find((t) => t.id === threadId) || null;
    renderInviteBar();
    renderMessages();
    await api(`/api/projects/${encodeURIComponent(projectId)}/chat/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: threadId, message_id: messages.at(-1)?.id || null }),
    });
    unread = data.unread || { unread_count: 0, mention_count: 0 };
    persistUnreadHint(projectId, unread);
    setBadge();
  }

  async function createThread() {
    const projectId = getProjectId?.();
    if (!projectId) return;
    const isManager = ["owner", "manager"].includes(String(workspaceRole || ""));
    const title = window.prompt("Thread title", isManager ? "Design notes" : "My notes");
    if (!title?.trim()) return;
    let visibility = isManager ? "shared" : "private";
    if (isManager) {
      const shared = window.confirm("Create as a shared workspace thread?\n\nOK = shared with everyone\nCancel = private (invite only)");
      visibility = shared ? "shared" : "private";
    }
    const data = await api(`/api/projects/${encodeURIComponent(projectId)}/chat/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), visibility }),
    });
    await loadThreads();
    if (data.thread?.id) await selectThread(data.thread.id);
  }

  async function sendMessage() {
    const projectId = getProjectId?.();
    const input = overlay?.querySelector("#pc-input");
    if (!projectId || !activeThreadId || !input) return;
    const body = serializeComposer(input);
    if (!body && !pendingFiles.length) return;
    const form = new FormData();
    form.append("body", body);
    if (replyTo?.id) form.append("parent_id", replyTo.id);
    for (const file of pendingFiles) form.append("images", file, file.name);
    const sendBtn = overlay.querySelector("#pc-send");
    if (sendBtn) sendBtn.disabled = true;
    const taggedAgent = /@\[[^\]]+\]\(agent:[^)]+\)/i.test(body) || /@render\s*agent\b/i.test(body);
    try {
      const data = await api(
        `/api/projects/${encodeURIComponent(projectId)}/chat/threads/${encodeURIComponent(activeThreadId)}/messages`,
        { method: "POST", body: form }
      );
      clearComposer(input);
      pendingFiles = [];
      replyTo = null;
      renderPending();
      renderReplyBar();
      if (data.message) {
        messages = [...messages.filter((m) => m.id !== data.message.id), data.message];
        renderMessages();
        // Reload so agent replies (parent_id) show up shortly after send.
        await selectThread(activeThreadId);
        if (taggedAgent) {
          setTimeout(() => void selectThread(activeThreadId), 1200);
          setTimeout(() => void selectThread(activeThreadId), 3200);
        }
      }
      onStatus?.("ok", taggedAgent ? "Message sent — Render Agent is replying…" : "Message sent");
      input.focus();
    } catch (err) {
      onStatus?.("error", err.message || "Could not send message");
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  async function toggleReaction(messageId, emoji) {
    const projectId = getProjectId?.();
    if (!projectId || !activeThreadId || !messageId || !emoji) return;
    try {
      const data = await api(
        `/api/projects/${encodeURIComponent(projectId)}/chat/threads/${encodeURIComponent(activeThreadId)}/messages/${encodeURIComponent(messageId)}/reactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        }
      );
      if (data.message) {
        messages = messages.map((m) => (m.id === data.message.id ? data.message : m));
        renderMessages();
      }
    } catch (err) {
      onStatus?.("error", err.message || "Could not react");
    }
  }

  async function openChat() {
    if (!getToken()) {
      ensureOverlay();
      overlay.classList.remove("hidden");
      open = true;
      document.body.classList.add("project-chat-open");
      const title = overlay.querySelector("#pc-title");
      const subtitle = overlay.querySelector("#pc-subtitle");
      const messagesEl = overlay.querySelector("#pc-messages");
      if (title) title.textContent = "Project chat";
      if (subtitle) subtitle.textContent = "Sign in required";
      if (messagesEl) {
        messagesEl.innerHTML = `<div class="pc-empty"><strong>Sign in to use project chat.</strong><span class="muted">After signing in, teammates can chat, mention each other, and attach images here.</span></div>`;
      }
      onStatus?.("error", "Sign in to use project chat");
      return;
    }
    const projectId = getProjectId?.();
    if (!projectId) {
      ensureOverlay();
      overlay.classList.remove("hidden");
      open = true;
      document.body.classList.add("project-chat-open");
      const title = overlay.querySelector("#pc-title");
      const subtitle = overlay.querySelector("#pc-subtitle");
      const messagesEl = overlay.querySelector("#pc-messages");
      if (title) title.textContent = "Project chat";
      if (subtitle) subtitle.textContent = "Open a project first";
      if (messagesEl) {
        messagesEl.innerHTML = `<div class="pc-empty"><strong>Open a project to start chatting.</strong><span class="muted">Project chat is tied to the active Render3D workspace.</span></div>`;
      }
      onStatus?.("error", "Open a project to chat");
      return;
    }
    ensureOverlay();
    overlay.classList.remove("hidden");
    open = true;
    document.body.classList.add("project-chat-open");
    const title = overlay.querySelector("#pc-title");
    const subtitle = overlay.querySelector("#pc-subtitle");
    if (title) title.textContent = "Project chat";
    if (subtitle) subtitle.textContent = getProjectName?.() || projectId;
    await loadCandidates();
    await loadThreads();
    if (activeThreadId) await selectThread(activeThreadId);
    overlay.querySelector("#pc-input")?.focus();
  }

  function close() {
    open = false;
    overlay?.classList.add("hidden");
    document.body.classList.remove("project-chat-open");
  }

  function toggle() {
    if (open) close();
    else void openChat();
  }

  function handleRealtime(msg = {}) {
    const projectId = getProjectId?.();
    if (!projectId || msg.project_id !== projectId) {
      if (msg.type === "project.chat.mention") {
        unread = {
          unread_count: Number(unread.unread_count || 0) + 1,
          mention_count: Number(unread.mention_count || 0) + 1,
          latest_mention: msg.message,
        };
        setBadge();
      }
      return;
    }
    if (msg.type === "project.chat.message" || msg.type === "project.chat.mention") {
      if (open && msg.thread_id === activeThreadId && msg.message) {
        if (!messages.some((m) => m.id === msg.message.id)) {
          messages = [...messages, msg.message];
          renderMessages();
        }
      } else {
        unread = {
          unread_count: Number(unread.unread_count || 0) + 1,
          mention_count: Number(unread.mention_count || 0) + (msg.type === "project.chat.mention" || msg.mention ? 1 : 0),
        };
        setBadge();
      }
      if (msg.type === "project.chat.mention" || msg.mention) {
        onStatus?.("ok", `${msg.message?.user_name || "Someone"} tagged you in chat`);
      }
    }
    if (msg.type === "project.chat.reaction" && msg.message && open) {
      messages = messages.map((m) => (m.id === msg.message.id ? msg.message : m));
      renderMessages();
    }
  }

  function prefillMention(candidate) {
    if (!candidate?.id) return;
    void openChat().then?.(() => {}).catch?.(() => {});
    void openChat();
    const input = overlay?.querySelector("#pc-input");
    if (!input) {
      // openChat is sync-ish after first open
      setTimeout(() => {
        const el = overlay?.querySelector("#pc-input");
        if (!el) return;
        insertMentionChip(el, candidate.handle || candidate.display_name || "User", candidate.type || "user", candidate.id);
        el.focus();
      }, 120);
      return;
    }
    insertMentionChip(input, candidate.handle || candidate.display_name || "User", candidate.type || "user", candidate.id);
    input.focus();
  }

  buttonEl?.addEventListener("click", toggle);

  // Warm unread badge for current project.
  void refreshUnread();
  pollTimer = window.setInterval(() => {
    if (!open) void refreshUnread();
  }, 45000);

  return {
    open: openChat,
    close,
    toggle,
    refreshUnread,
    handleRealtime,
    prefillMention,
    destroy() {
      if (pollTimer) window.clearInterval(pollTimer);
      overlay?.remove();
      overlay = null;
    },
  };
}
