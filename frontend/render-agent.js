/** Floating Render Agent assistant for tooling questions and onboarding. */
import {
  bumpTipForNewThread,
  bumpTipOnRefresh,
  getCurrentTip,
  tipTopicClass,
} from "./getting-started-tips.js?v=20260715-tips-tricks";
import { matchGettingStartedGuides, guideMediaPayload } from "./getting-started-guides.js?v=20260724-gs-gifs";
import { startShowMe } from "./show-me-tour.js?v=20260715-stepper-bench-remix";


const ONBOARDING_KEY_PREFIX = "render3d:renderAgentSeen:";
const PANEL_LAYOUT_KEY = "render3d:renderAgentPanel:v2";
const DOCS_PANEL_LAYOUT_KEY = "render3d:renderAgentPanelDocs:v9";
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

function renderInlineMarkdown(value = "") {
  return esc(value)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "<strong>$1</strong>");
}

function stripOuterPromptQuotes(value = "") {
  const trimmed = String(value || "").trim();
  return trimmed.replace(/^["“](.*)["”]$/s, "$1").trim();
}

function renderMessageText(value = "") {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let quote = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" ").trim())}</p>`);
    paragraph = [];
  };

  const flushQuote = () => {
    if (!quote.length) return;
    const prompt = stripOuterPromptQuotes(quote.join(" "));
    blocks.push(`
      <div class="render-agent-prompt-card">
        <span class="render-agent-prompt-card-kicker">Prompt example</span>
        <p>${renderInlineMarkdown(prompt)}</p>
      </div>
    `);
    quote = [];
  };

  const flushList = () => {
    if (!list?.items?.length) {
      list = null;
      return;
    }
    const tag = list.type === "ol" ? "ol" : "ul";
    blocks.push(`<${tag} class="render-agent-rich-list">${list.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`);
    list = null;
  };

  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length <= 2 ? "h3" : "h4";
      blocks.push(`<${level} class="render-agent-rich-heading">${renderInlineMarkdown(heading[2])}</${level}>`);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1]);
      continue;
    }

    const cue = line.match(/^(?:-{0,2}>|=>|→|➜)\s+(.+)$/);
    if (cue) {
      flushAll();
      blocks.push(`
        <div class="render-agent-cue">
          <span class="render-agent-cue-icon" aria-hidden="true"></span>
          <span>${renderInlineMarkdown(cue[1])}</span>
        </div>
      `);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      flushQuote();
      if (list?.type !== "ul") flushList();
      list ||= { type: "ul", items: [] };
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (list?.type !== "ol") flushList();
      list ||= { type: "ol", items: [] };
      list.items.push(ordered[1]);
      continue;
    }

    flushQuote();
    flushList();
    paragraph.push(line);
  }

  flushAll();
  return blocks.join("");
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
  getProjects = () => [],
  getProjectName = () => "",
  getSelectedFile,
  getObjectChoices = () => [],
  getCurrentUser,
  getTeams,
  getSelectedWorkspaceId,
  getSelectedAiKey,
  onOpenProject,
  onCreateProject,
  onSelectObject,
  onRequireLogin,
  onStatus,
  stickyNote = true,
} = {}) {
  let btn = document.getElementById("btn-render-agent");
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

  if (!panel || !form || !messagesEl) return null;

  if (!btn && !document.getElementById("render-agent-fab")) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "render-agent-fab";
    btn.className = "render-agent-fab";
    btn.title = "Ask Render Agent";
    btn.setAttribute("aria-label", "Ask Render Agent");
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `<img src="${RENDER3D_LOGO_URL}" alt="" /><span>Ask Agent</span>`;
    document.body.appendChild(btn);
  }

  let threads = [];
  let activeThread = null;
  let attachments = [];
  let teamMembers = [];
  let inviteOpen = false;
  let inviteQuery = "";
  let selectedInviteUserId = "";
  let agentKeyMode = (() => {
    try {
      const stored = localStorage.getItem("render3d:renderAgentKeyMode:v1");
      // Default for all users: Sam's gpt-4o-mini unless they explicitly chose their key.
      return stored === "selected" ? "selected" : "sam";
    } catch {
      return "sam";
    }
  })();
  let threadSearch = "";
  let busy = false;
  let invitePicker = null;
  let agentSourceRow = null;
  let pendingQuestionContext = "";
  let doItWizard = null;
  let doItNote = null;

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

  function isDesktopViewport() {
    // Match Studio mobile interaction breakpoint — auto-open is desktop-only.
    try {
      return !window.matchMedia("(max-width: 820px), (pointer: coarse) and (max-width: 1024px)").matches;
    } catch {
      return window.innerWidth > 820;
    }
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

  function showWelcomeTip() {
    if (!messagesEl) return;
    const hasMessages = Boolean(activeThread?.messages?.length);
    if (hasMessages) {
      // Keep tip compact above existing history.
      renderMessages();
      return;
    }
    messagesEl.innerHTML = `
      <div class="render-agent-empty">
        <strong>Ask me anything about Render3D.</strong>
        ${renderAgentTipCard()}
        <p class="muted small" style="margin-top:10px">
          New here? Read the
          <a href="/getting-started.html">Getting Started docs</a>
          for demos and walkthroughs.
        </p>
      </div>
    `;
    bindTipActions(messagesEl);
  }

  function ensureDocsMobileBackdrop() {
    let backdrop = document.getElementById("render-agent-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "render-agent-backdrop";
      backdrop.className = "render-agent-backdrop hidden";
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.addEventListener("click", () => close());
      document.body.appendChild(backdrop);
    }
    return backdrop;
  }

  function applyDocsMobileSheetLayout() {
    panel.classList.add("render-agent-panel--mobile-sheet");
    panel.style.left = "0";
    panel.style.right = "0";
    panel.style.top = "auto";
    panel.style.bottom = "0";
    panel.style.width = "100%";
    panel.style.height = `${Math.min(Math.round(window.innerHeight * 0.92), window.innerHeight - 8)}px`;
    panel.style.maxHeight = "none";
  }

  function clearDocsMobileSheetLayout() {
    panel.classList.remove("render-agent-panel--mobile-sheet");
  }

  function syncDocsPageLayout(openPanel) {
    if (!panel.classList.contains("render-agent-panel--docs")) return;
    const mobile = !isDesktopViewport();
    if (mobile) {
      document.body.classList.remove("gs-agent-open");
      document.body.classList.toggle("gs-agent-sheet-open", !!openPanel);
      document.body.style.overflow = openPanel ? "hidden" : "";
      ensureDocsMobileBackdrop()?.classList.toggle("hidden", !openPanel);
      return;
    }
    document.body.classList.remove("gs-agent-sheet-open");
    document.body.style.overflow = "";
    ensureDocsMobileBackdrop()?.classList.add("hidden");
    document.body.classList.toggle("gs-agent-open", !!openPanel);
  }

  function syncFabState(isOpen) {
    const fab = document.getElementById("render-agent-fab");
    if (!fab) return;
    const docsPanel = panel.classList.contains("render-agent-panel--docs");
    if (docsPanel) {
      // Docs: hide the FAB while the agent is open so there is no "Close Agent"
      // button; the panel header × dismisses the agent.
      fab.classList.toggle("hidden", !!isOpen);
      fab.classList.remove("is-open");
      fab.setAttribute("aria-pressed", isOpen ? "true" : "false");
      fab.setAttribute("aria-expanded", isOpen ? "true" : "false");
      fab.title = "Ask Render Agent";
      fab.setAttribute("aria-label", "Ask Render Agent");
      const label = fab.querySelector("span");
      if (label) label.textContent = "Ask Agent";
      return;
    }
    fab.classList.remove("hidden");
    fab.classList.toggle("is-open", !!isOpen);
    fab.setAttribute("aria-pressed", isOpen ? "true" : "false");
    fab.setAttribute("aria-expanded", isOpen ? "true" : "false");
    fab.title = isOpen ? "Close Render Agent" : "Ask Render Agent";
    const label = fab.querySelector("span");
    if (label) label.textContent = isOpen ? "Close Agent" : "Ask Agent";
  }

  function open({ onboarding: showOnboarding = false, question = "" } = {}) {
    const docsPanel = panel.classList.contains("render-agent-panel--docs");
    if (!currentUserId() && !docsPanel) {
      onRequireLogin?.();
      return;
    }
    try {
      void import("./feature-events.js?v=20260721-quest-notify").then((m) => {
        m.emitFeatureUsed?.("render-agent", { title: "Render Agent help chat" });
      });
    } catch {
      /* ignore */
    }
    panel.classList.remove("hidden");
    panel.classList.add("render-agent-panel--sticky");
    if (docsPanel) {
      panel.classList.add("render-agent-panel--popup");
    }
    syncFabState(true);
    ensureStickyNoteControls();
    restoreStickyLayout();
    syncDocsPageLayout(true);
    if (showOnboarding && onboarding) {
      onboarding.classList.remove("hidden");
      showWelcomeTip();
      markOnboardingSeen();
    }
    const normalizedQuestion = String(question || "").trim();
    if (normalizedQuestion && input) {
      pendingQuestionContext = normalizedQuestion;
      const currentText = input.value.trim();
      if (!currentText) {
        input.value = normalizedQuestion;
      } else if (currentText !== normalizedQuestion && !currentText.includes(normalizedQuestion)) {
        input.value = `${normalizedQuestion}\n\n${currentText}`;
      }
    }
    if (currentUserId()) {
      void refreshThreads().then(() => {
        if (showOnboarding) showWelcomeTip();
      });
      void refreshTeamMembers();
    } else if (messagesEl && !(messagesEl.childElementCount)) {
      messagesEl.innerHTML = `
        <div class="render-agent-empty">
          <strong>Ask me anything about Render3D.</strong>
          <p class="muted small">Sign in to send a question — demos from Getting Started appear in replies.</p>
          <p class="muted small"><a href="/getting-started.html">Getting Started docs</a></p>
        </div>
      `;
    }
    setTimeout(() => {
      const skipFocus = !isDesktopViewport()
        && docsPanel
        && !normalizedQuestion;
      if (!skipFocus) input?.focus();
      if (normalizedQuestion && input) {
        const len = input.value.length;
        input.setSelectionRange?.(len, len);
      }
    }, 50);
  }

  async function openWithQuestion(question, { autoSend = false } = {}) {
    const q = String(question || "").trim();
    open({ question: q });
    if (!q || !autoSend || !currentUserId()) return;
    for (let i = 0; i < 24 && !activeThread?.id; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (input) input.value = q;
    await sendMessage();
  }

  function messageWithPendingContext(message) {
    const context = pendingQuestionContext.trim();
    const body = String(message || "").trim();
    if (!context || !body || body === context || body.includes(context)) return body;
    return `${context}\n\nAdditional question:\n${body}`;
  }

  function close() {
    panel.classList.add("hidden");
    syncFabState(false);
    syncDocsPageLayout(false);
  }

  function toggle() {
    if (panel.classList.contains("hidden")) open();
    else close();
  }

  function layoutStorageKey() {
    return panel.classList.contains("render-agent-panel--docs")
      ? DOCS_PANEL_LAYOUT_KEY
      : PANEL_LAYOUT_KEY;
  }

  function readStickyLayout() {
    try {
      const raw = JSON.parse(localStorage.getItem(layoutStorageKey()) || "null");
      return raw && typeof raw === "object" ? raw : null;
    } catch {
      return null;
    }
  }

  function writeStickyLayout(next) {
    try {
      localStorage.setItem(layoutStorageKey(), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function restoreStickyLayout() {
    if (!stickyNote) return;
    panel.classList.add("render-agent-panel--sticky");
    const isDocs = panel.classList.contains("render-agent-panel--docs");
    if (isDocs) {
      panel.classList.add("render-agent-panel--popup");
      panel.classList.remove("render-agent-panel--deck");
    }
    if (isDocs && !isDesktopViewport()) {
      applyDocsMobileSheetLayout();
      return;
    }
    clearDocsMobileSheetLayout();
    const saved = readStickyLayout();
    const maxPanelW = Math.min(isDocs ? 340 : 360, Math.max(260, window.innerWidth - 32));
    const minPanelW = Math.min(isDocs ? 300 : 280, maxPanelW);
    const defaultW = maxPanelW;
    // Docs panel: bottom-right, shorter so docs can fill the column beside it.
    const defaultH = Math.min(
      isDocs ? 460 : 640,
      Math.max(280, window.innerHeight - (isDocs ? 120 : 112)),
    );
    const defaultTop = isDocs
      ? Math.max(72, window.innerHeight - defaultH - 24)
      : 72;
    if (!saved) {
      panel.style.left = "auto";
      panel.style.right = "16px";
      panel.style.width = `${defaultW}px`;
      panel.style.height = `${defaultH}px`;
      panel.style.maxHeight = "none";
      if (isDocs) {
        panel.style.top = "auto";
        panel.style.bottom = "24px";
      } else {
        panel.style.bottom = "auto";
        panel.style.top = `${defaultTop}px`;
      }
      return;
    }
    if (saved.width) panel.style.width = `${Math.min(maxPanelW, Math.max(minPanelW, saved.width))}px`;
    else panel.style.width = `${defaultW}px`;
    if (saved.height) panel.style.height = `${Math.max(isDocs ? 360 : 260, saved.height)}px`;
    else panel.style.height = `${defaultH}px`;
    panel.style.maxHeight = "none";
    if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      panel.style.right = "auto";
      panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 80, saved.left))}px`;
      panel.style.bottom = "auto";
      panel.style.top = `${Math.max(8, Math.min(window.innerHeight - 80, saved.top))}px`;
    } else if (isDocs) {
      panel.style.left = "auto";
      panel.style.right = "16px";
      panel.style.top = "auto";
      panel.style.bottom = "24px";
    } else {
      panel.style.left = "auto";
      panel.style.right = "16px";
      panel.style.bottom = "auto";
      panel.style.top = `${defaultTop}px`;
    }
  }


  function enterPresentationDeck() {
    if (panel.classList.contains("render-agent-panel--docs") && !isDesktopViewport()) {
      applyDocsMobileSheetLayout();
      return;
    }
    clearDocsMobileSheetLayout();
    panel.classList.add("render-agent-panel--deck");
    const w = Math.min(760, Math.max(420, window.innerWidth - 48));
    const h = Math.min(820, Math.max(480, window.innerHeight - 48));
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
    panel.style.maxHeight = "none";
    panel.style.left = "auto";
    panel.style.right = "20px";
    panel.style.top = "64px";
  }

  function leavePresentationDeck() {
    panel.classList.remove("render-agent-panel--deck");
  }

  function ensureStickyNoteControls() {
    if (!stickyNote || panel.dataset.stickyReady === "1") return;
    panel.dataset.stickyReady = "1";
    panel.classList.add("render-agent-panel--sticky");
    const head = panel.querySelector(".render-agent-head");
    if (head && !head.querySelector(".render-agent-drag-hint")) {
      const hint = document.createElement("span");
      hint.className = "render-agent-drag-hint";
      hint.textContent = "⠿";
      hint.title = "Drag to move";
      head.insertBefore(hint, head.firstChild);
    }
    const edges = ["n", "s", "e", "w", "se", "sw", "ne", "nw"];
    for (const edge of edges) {
      if (panel.querySelector(`.render-agent-resize--${edge}`)) continue;
      const resize = document.createElement("div");
      resize.className = `render-agent-resize render-agent-resize--${edge}`;
      resize.dataset.edge = edge;
      resize.title = "Drag edge to resize";
      panel.appendChild(resize);
    }

    let drag = null;
    const onMove = (e) => {
      if (!drag) return;
      e.preventDefault();
      if (drag.mode === "move") {
        const left = Math.max(8, Math.min(window.innerWidth - 80, drag.startLeft + (e.clientX - drag.sx)));
        const top = Math.max(8, Math.min(window.innerHeight - 80, drag.startTop + (e.clientY - drag.sy)));
        panel.style.right = "auto";
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        return;
      }
      if (drag.mode !== "resize") return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      const edge = drag.edge || "se";
      let width = drag.startW;
      let height = drag.startH;
      let left = drag.startLeft;
      let top = drag.startTop;
      if (edge.includes("e")) width = drag.startW + dx;
      if (edge.includes("w")) {
        width = drag.startW - dx;
        left = drag.startLeft + dx;
      }
      if (edge.includes("s")) height = drag.startH + dy;
      if (edge.includes("n")) {
        height = drag.startH - dy;
        top = drag.startTop + dy;
      }
      width = Math.max(260, Math.min(window.innerWidth - 16, width));
      height = Math.max(260, Math.min(window.innerHeight - 16, height));
      if (edge.includes("w")) {
        left = Math.max(8, Math.min(drag.startLeft + drag.startW - 260, left));
        width = drag.startLeft + drag.startW - left;
      }
      if (edge.includes("n")) {
        top = Math.max(8, Math.min(drag.startTop + drag.startH - 260, top));
        height = drag.startTop + drag.startH - top;
      }
      panel.style.right = "auto";
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.width = `${width}px`;
      panel.style.height = `${height}px`;
      panel.style.maxHeight = "none";
    };
    const onUp = () => {
      if (!drag) return;
      drag = null;
      panel.classList.remove("is-dragging");
      writeStickyLayout({
        left: parseFloat(panel.style.left) || panel.getBoundingClientRect().left,
        top: parseFloat(panel.style.top) || panel.getBoundingClientRect().top,
        width: panel.offsetWidth,
        height: panel.offsetHeight,
      });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    head?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("button, a, input, select, textarea")) return;
      const rect = panel.getBoundingClientRect();
      drag = {
        mode: "move",
        sx: e.clientX,
        sy: e.clientY,
        startLeft: rect.left,
        startTop: rect.top,
      };
      panel.classList.add("is-dragging");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    panel.querySelectorAll(".render-agent-resize").forEach((handle) => {
      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = panel.getBoundingClientRect();
        drag = {
          mode: "resize",
          edge: handle.dataset.edge || "se",
          sx: e.clientX,
          sy: e.clientY,
          startW: rect.width,
          startH: rect.height,
          startLeft: rect.left,
          startTop: rect.top,
        };
        panel.classList.add("is-dragging");
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
    });
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
      try {
        localStorage.setItem("render3d:renderAgentKeyMode:v1", agentKeyMode);
      } catch {
        /* ignore */
      }
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
        <div class="render-agent-tip-actions">
          <button type="button" class="btn secondary btn-compact render-agent-tip-try" data-tip-starter="${esc(tip.starter)}">
            Ask this
          </button>
          <a class="btn secondary btn-compact" href="/getting-started.html">Getting Started docs</a>
        </div>
      </div>
    `;
  }

  function bindTipActions(root) {
    root?.querySelectorAll("[data-tip-starter]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        const starter = btn.getAttribute("data-tip-starter") || "";
        if (!starter) return;
        void openWithQuestion(starter, { autoSend: true });
      });
    });
    root?.querySelectorAll("[data-show-me]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-show-me") || "";
        const onDocs = panel.classList.contains("render-agent-panel--docs");
        startShowMe(id, { onDocsPage: onDocs });
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
      .map((msg, index) => {
        const fallbackSender = msg.role === "user" ? getCurrentUser?.() : { display_name: "Render Agent" };
        const sender = msg.sender || fallbackSender || {};
        const name = sender.display_name || (msg.role === "user" ? "You" : "Render Agent");
        const avatar = msg.role === "user" ? avatarHtml(sender) : agentLogoHtml();
        const prevUser = [...messages.slice(0, index)].reverse().find((m) => m.role === "user");
        const mediaHtml = renderMessageMedia(msg, prevUser?.content || "");
        return `
        <article class="render-agent-message render-agent-message--${esc(msg.role || "assistant")}">
          <header class="render-agent-message-head">
            ${avatar}
            <div>
              <strong>${esc(msg.role === "user" && sender.id === currentUserId() ? "You" : name)}</strong>
              <small>${esc(msg.created_at ? new Date(msg.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit" }) : "")}</small>
            </div>
          </header>
          ${mediaHtml}
          <div class="render-agent-message-content">${renderMessageText(msg.content || "")}</div>
        </article>
      `;
      })
      .join("")}
    `;
    bindTipActions(messagesEl);
    messagesEl.querySelectorAll(".render-agent-media img").forEach((img) => {
      img.addEventListener("error", () => img.closest(".render-agent-media")?.remove());
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderMessageMedia(msg, previousUserText = "") {
    let media = Array.isArray(msg?.media) ? [...msg.media] : [];
    const guides = Array.isArray(msg?.guides) ? msg.guides : [];
    if (!media.length && msg?.role === "assistant" && previousUserText) {
      media = matchGettingStartedGuides(previousUserText, { limit: 2 })
        .map(guideMediaPayload)
        .filter(Boolean)
        .filter((item) => item?.url);
    }
    if (media.length) {
      // Bigger PowerPoint-style window when GIF instructions render.
      enterPresentationDeck();
    }
    if (!media.length) return "";
    return `
      <div class="render-agent-media-list">
        ${media.map((item, idx) => {
          const guideId = item.id || guides[idx]?.id || guides[0]?.id || "";
          return `
          <figure class="render-agent-media render-agent-media--deck">
            <img src="${esc(item.url)}" alt="${esc(item.title || "Demo")}" loading="lazy" />
            <figcaption>
              <strong>${esc(item.title || "Getting Started demo")}</strong>
              ${item.summary ? `<span>${esc(item.summary)}</span>` : ""}
              <div class="render-agent-media-actions">
                ${guideId ? `<button type="button" class="btn accent btn-compact" data-show-me="${esc(guideId)}">Show me</button>` : ""}
                <a class="btn secondary btn-compact" href="/getting-started.html${guideId ? `#${esc(guideId)}` : ""}">Docs</a>
              </div>
            </figcaption>
          </figure>
        `;
        }).join("")}
      </div>
    `;
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
    const typedMessage = input?.value.trim() || "";
    const message = messageWithPendingContext(typedMessage);
    if (!message || busy) return;
    if (!currentUserId()) {
      onRequireLogin?.();
      return;
    }
    busy = true;
    input.value = "";
    pendingQuestionContext = "";
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
          use_sam: agentKeyMode !== "selected",
          ...(agentKeyMode === "selected" ? (getSelectedAiKey?.() || {}) : {}),
        }),
      }, 240000);
      activeThread = data.thread;
      // Preserve media/guides if the API returned them on the latest assistant message
      if (data.message?.media?.length && activeThread?.messages?.length) {
        const last = activeThread.messages[activeThread.messages.length - 1];
        if (last?.role === "assistant" && !last.media?.length) {
          last.media = data.message.media;
          last.guides = data.message.guides || [];
        }
      }
      attachments = [];
      renderAttachments();
      renderMessages();
      await refreshThreads();
      setStatus("");
    } catch (err) {
      setStatus(err.message || "Render Agent failed.", true);
      renderMessages();
    } finally {
      busy = false;
    }
  }

  function projectOptionsHtml(selectedId = getProjectId?.() || "") {
    const projects = [...(getProjects?.() || [])].filter((project) => project?.id);
    return projects.length
      ? projects.map((project) => `
        <option value="${esc(project.id)}"${String(project.id) === String(selectedId || "") ? " selected" : ""}>${esc(project.name || project.id)}</option>
      `).join("")
      : `<option value="">No projects yet</option>`;
  }

  function objectOptionsHtml(selectedName = getSelectedFile?.() || "") {
    const choices = [...(getObjectChoices?.() || [])].filter((item) => item?.id || item?.filename);
    return [
      `<option value="">No specific object / whole project</option>`,
      ...choices.map((item) => {
        const value = item.id || item.filename;
        const label = item.label || item.filename || value;
        const sub = item.kind ? ` (${item.kind})` : "";
        return `<option value="${esc(value)}"${String(value) === String(selectedName || "") ? " selected" : ""}>${esc(label + sub)}</option>`;
      }),
    ].join("");
  }

  function removeDoItWizard() {
    doItWizard?.remove();
    doItWizard = null;
  }

  function showDoItWizard() {
    if (!currentUserId()) {
      onRequireLogin?.();
      return;
    }
    open();
    removeDoItWizard();
    const currentProjectId = getProjectId?.() || "";
    const currentProjectName = getProjectName?.() || currentProjectId;
    doItWizard = document.createElement("div");
    doItWizard.className = "render-agent-doit-modal";
    doItWizard.setAttribute("role", "dialog");
    doItWizard.setAttribute("aria-modal", "true");
    doItWizard.setAttribute("aria-labelledby", "render-agent-doit-title");
    doItWizard.innerHTML = `
      <div class="render-agent-doit-backdrop" data-doit-close></div>
      <form class="render-agent-doit-card">
        <header>
          <p class="render-agent-doit-eyebrow">Guided automation</p>
          <h2 id="render-agent-doit-title">Do it for me</h2>
          <p>Describe the result you want. Render Agent will step through the setup with sticky notes, then hand the task to AI.</p>
        </header>
        <label class="render-agent-doit-field">
          <span>What do you want to do?</span>
          <textarea id="render-agent-doit-task" rows="4" required placeholder="Example: make the selected bracket stronger, add rounded corners, and keep the mounting holes aligned."></textarea>
        </label>
        <fieldset class="render-agent-doit-fieldset">
          <legend>Project</legend>
          <label class="render-agent-doit-radio">
            <input type="radio" name="render-agent-doit-project-mode" value="current" ${currentProjectId ? "checked" : "disabled"} />
            <span><strong>Use current project</strong><small>${currentProjectId ? esc(currentProjectName || currentProjectId) : "No project is open"}</small></span>
          </label>
          <label class="render-agent-doit-radio">
            <input type="radio" name="render-agent-doit-project-mode" value="existing" ${currentProjectId ? "" : "checked"} />
            <span><strong>Select project</strong><select id="render-agent-doit-project">${projectOptionsHtml(currentProjectId)}</select></span>
          </label>
          <label class="render-agent-doit-radio">
            <input type="radio" name="render-agent-doit-project-mode" value="new" />
            <span><strong>Create new project</strong><small>Render Agent will create and open a clean project first.</small></span>
          </label>
        </fieldset>
        <label class="render-agent-doit-field">
          <span>Object to edit, if applicable</span>
          <select id="render-agent-doit-object">${objectOptionsHtml()}</select>
          <small>Leave this as whole project when the task is not object-specific.</small>
        </label>
        <p class="render-agent-doit-status muted small" id="render-agent-doit-status"></p>
        <footer>
          <button type="button" class="btn secondary" data-doit-close>Cancel</button>
          <button type="submit" class="btn accent">Start guided steps</button>
        </footer>
      </form>
    `;
    document.body.appendChild(doItWizard);
    const task = doItWizard.querySelector("#render-agent-doit-task");
    const status = doItWizard.querySelector("#render-agent-doit-status");
    doItWizard.querySelectorAll("[data-doit-close]").forEach((el) => el.addEventListener("click", removeDoItWizard));
    doItWizard.addEventListener("change", (event) => {
      const mode = doItWizard.querySelector("input[name='render-agent-doit-project-mode']:checked")?.value || "current";
      doItWizard.querySelector("#render-agent-doit-project")?.toggleAttribute("disabled", mode !== "existing");
    });
    doItWizard.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const desired = task?.value?.trim() || "";
      if (!desired) {
        if (status) status.textContent = "Describe what you want Render Agent to do.";
        return;
      }
      const mode = doItWizard.querySelector("input[name='render-agent-doit-project-mode']:checked")?.value || "current";
      const selectedProjectId = mode === "existing"
        ? doItWizard.querySelector("#render-agent-doit-project")?.value || ""
        : currentProjectId;
      if (mode !== "new" && !selectedProjectId) {
        if (status) status.textContent = "Select a project or choose Create new project.";
        return;
      }
      const objectId = doItWizard.querySelector("#render-agent-doit-object")?.value || "";
      removeDoItWizard();
      void runDoItForMe({ desired, mode, projectId: selectedProjectId, objectId });
    });
    task?.focus();
  }

  function removeDoItNote() {
    doItNote?.remove();
    doItNote = null;
    document.querySelectorAll(".render-agent-doit-target").forEach((el) => el.classList.remove("render-agent-doit-target"));
  }

  function waitForDoItContinue(step) {
    removeDoItNote();
    const target = step.selector ? document.querySelector(step.selector) : null;
    target?.classList?.add("render-agent-doit-target");
    doItNote = document.createElement("div");
    doItNote.className = "render-agent-doit-note";
    doItNote.innerHTML = `
      <strong>${esc(step.title || "Render Agent")}</strong>
      <p>${esc(step.body || "")}</p>
      <button type="button" class="btn accent btn-compact">Continue</button>
    `;
    document.body.appendChild(doItNote);
    if (target) {
      const rect = target.getBoundingClientRect();
      doItNote.style.left = `${Math.min(window.innerWidth - 330, Math.max(14, rect.left))}px`;
      doItNote.style.top = `${Math.min(window.innerHeight - 170, Math.max(14, rect.bottom + 12))}px`;
      target.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "nearest" });
    }
    return new Promise((resolve) => {
      doItNote.querySelector("button")?.addEventListener("click", () => {
        removeDoItNote();
        resolve();
      }, { once: true });
    });
  }

  async function runDoItForMe({ desired, mode, projectId: selectedProjectId, objectId }) {
    open();
    setStatus("Starting guided automation…");
    try {
      await waitForDoItContinue({
        selector: "#render-agent-panel",
        title: "1. I’m setting up the workspace",
        body: "I need a project first because every CAD edit, upload, and prompt result is saved into a Render3D project.",
      });
      let targetProjectId = selectedProjectId || getProjectId?.() || "";
      if (mode === "new") {
        await waitForDoItContinue({
          selector: "#btn-new-project, #project-browser",
          title: "2. I’m creating a new project",
          body: "You chose a clean workspace, so I’ll create a project before asking AI to make changes.",
        });
        targetProjectId = await onCreateProject?.();
      } else if (targetProjectId && targetProjectId !== getProjectId?.()) {
        await waitForDoItContinue({
          selector: "#project-browser",
          title: "2. I’m opening the selected project",
          body: "I’m switching to the project you selected so the agent works against the right files and context.",
        });
        await onOpenProject?.(targetProjectId);
      }
      if (!targetProjectId) throw new Error("No project was selected or created.");

      const objectChoice = (getObjectChoices?.() || []).find((item) => String(item.id || item.filename) === String(objectId));
      if (objectChoice) {
        await waitForDoItContinue({
          selector: "#viewport, #design-browser",
          title: "3. I’m selecting the object",
          body: "This pins the task to the object you chose instead of editing the whole project by accident.",
        });
        await onSelectObject?.(objectChoice);
      } else {
        await waitForDoItContinue({
          selector: "#viewport, #prompt-input",
          title: "3. I’m using project-level context",
          body: "No specific object was required, so I’ll describe the request using the current project as context.",
        });
      }

      const objectLine = objectChoice
        ? `Target object: ${objectChoice.label || objectChoice.filename || objectChoice.id}`
        : "Target object: whole project / no specific object";
      const projectLine = `Project: ${getProjectName?.() || targetProjectId}`;
      const finalPrompt = [
        "Do it for me in Render3D.",
        projectLine,
        objectLine,
        "",
        "Task:",
        desired,
        "",
        "Explain the buttons/actions you would use and why before any destructive step. If a model generation/edit is needed, produce the exact prompt or next command for the active project.",
      ].join("\n");
      await waitForDoItContinue({
        selector: "#render-agent-form",
        title: "4. I’m sending the task to Render Agent",
        body: "This asks the agent to plan or execute the next safe step using the selected project and object context.",
      });
      if (input) input.value = finalPrompt;
      await sendMessage();
      setStatus("Do it for me request sent.");
    } catch (err) {
      removeDoItNote();
      setStatus(err?.message || "Could not run Do it for me.", true);
    }
  }

  if (btn?.id !== "render-agent-fab") {
    btn?.addEventListener("click", () => open());
  }
  closeBtn?.addEventListener("click", close);
  document.getElementById("render-agent-fab")?.addEventListener("click", () => toggle());
  syncFabState(!panel.classList.contains("hidden"));
  window.addEventListener("resize", () => {
    if (panel.classList.contains("hidden") || !panel.classList.contains("render-agent-panel--docs")) return;
    restoreStickyLayout();
    syncDocsPageLayout(true);
  });
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
  input?.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  });
  renderAgentSource();
  renderInviteOptions();
  ensureStickyNoteControls();
  ensureAgentActionBar();
  bindThreadContextMenu();


  function ensureAgentActionBar() {
    if (panel.querySelector(".render-agent-action-bar")) return;
    const formEl = form;
    if (!formEl) return;
    const bar = document.createElement("div");
    bar.className = "render-agent-action-bar";
    bar.innerHTML = `
      <button type="button" class="btn accent btn-compact" data-ra-action="do-it">Do it for me</button>
      <button type="button" class="btn secondary btn-compact" data-ra-action="suggest">Suggest to developer</button>
      <button type="button" class="btn secondary btn-compact" data-ra-action="share">Copy share link</button>
      <a class="btn secondary btn-compact" href="/getting-started.html">Getting Started</a>
    `;
    formEl.insertAdjacentElement("beforebegin", bar);
    bar.addEventListener("click", (event) => {
      const btn = event.target.closest?.("[data-ra-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-ra-action");
      if (action === "do-it") showDoItWizard();
      if (action === "suggest") void suggestToDeveloper();
      if (action === "share") void copyShareLink();
    });
  }

  async function suggestToDeveloper() {
    if (!currentUserId()) {
      onRequireLogin?.();
      return;
    }
    const draft = (input?.value || "").trim()
      || window.prompt("What should we change or add?", "Please improve…")
      || "";
    if (!draft.trim()) return;
    setStatus("Sending suggestion…");
    try {
      const data = await api("/api/render-agent/suggest-to-developer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: draft.trim(),
          thread_id: activeThread?.id || null,
        }),
      });
      setStatus(data.detail || (data.sms_sent ? "Texted the developer." : "Saved for management."));
    } catch (err) {
      setStatus(err.message || "Could not send suggestion.", true);
    }
  }

  async function copyShareLink() {
    if (!currentUserId()) {
      onRequireLogin?.();
      return;
    }
    if (!activeThread?.id) {
      setStatus("Open or start a chat first.", true);
      return;
    }
    try {
      const data = await api(`/api/render-agent/threads/${encodeURIComponent(activeThread.id)}/share`, {
        method: "POST",
      });
      const url = data.url || `${window.location.origin}${data.url_path || ""}`;
      await navigator.clipboard.writeText(url);
      setStatus(`Share link copied (${data.share_id}).`);
    } catch (err) {
      setStatus(err.message || "Could not create share link.", true);
    }
  }

  async function copyChatId(threadId) {
    const id = String(threadId || activeThread?.id || "").trim();
    if (!id) return;
    try {
      // Prefer share id so anyone can open the preview.
      const data = await api(`/api/render-agent/threads/${encodeURIComponent(id)}/share`, { method: "POST" });
      const shareId = data.share_id || id;
      await navigator.clipboard.writeText(shareId);
      setStatus(`Copied chat id: ${shareId}`);
    } catch {
      try {
        await navigator.clipboard.writeText(id);
        setStatus(`Copied chat id: ${id}`);
      } catch (err) {
        setStatus(err.message || "Could not copy chat id.", true);
      }
    }
  }

  function bindThreadContextMenu() {
    if (threadListEl?.dataset.ctxBound === "1") return;
    if (!threadListEl) return;
    threadListEl.dataset.ctxBound = "1";
    threadListEl.addEventListener("contextmenu", (event) => {
      const row = event.target.closest?.("[data-thread-id]");
      if (!row) return;
      event.preventDefault();
      const id = row.getAttribute("data-thread-id");
      const existing = document.getElementById("render-agent-ctx");
      existing?.remove();
      const menu = document.createElement("div");
      menu.id = "render-agent-ctx";
      menu.className = "render-agent-ctx";
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
      menu.innerHTML = `
        <button type="button" data-ctx="copy-id">Copy chat id</button>
        <button type="button" data-ctx="share">Copy share link</button>
        <button type="button" data-ctx="open-preview">Open preview</button>
      `;
      document.body.appendChild(menu);
      const close = () => menu.remove();
      menu.addEventListener("click", async (e) => {
        const btn = e.target.closest?.("[data-ctx]");
        if (!btn) return;
        const act = btn.getAttribute("data-ctx");
        close();
        if (act === "copy-id") await copyChatId(id);
        if (act === "share") {
          activeThread = { ...(activeThread || {}), id };
          await copyShareLink();
        }
        if (act === "open-preview") {
          try {
            const data = await api(`/api/render-agent/threads/${encodeURIComponent(id)}/share`, { method: "POST" });
            window.open(data.url || data.url_path, "_blank", "noopener");
          } catch (err) {
            setStatus(err.message || "Could not open preview.", true);
          }
        }
      });
      setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
    });
  }


  return {
    open,
    openWithQuestion,
    close,
    toggle,
    suggestToDeveloper,
    copyShareLink,
    showDoItWizard,
    enterPresentationDeck,
    setUser(user, { suppressOnboarding = false } = {}) {
      if (!user) return;
      // Desktop only: first visit auto-opens Render Agent with tip + Getting Started link.
      if (suppressOnboarding) return;
      // Docs pages keep the panel retracted until the user opens it.
      if (panel.classList.contains("render-agent-panel--docs")) return;
      if (!isDesktopViewport()) return;
      if (!shouldShowOnboarding()) return;
      // Ensure Sam's gpt-4o-mini is the default agent for new users.
      if (agentKeyMode !== "selected") {
        agentKeyMode = "sam";
        try {
          localStorage.setItem("render3d:renderAgentKeyMode:v1", "sam");
        } catch {
          /* ignore */
        }
      }
      open({ onboarding: true });
      renderAgentSource();
      showWelcomeTip();
    },
  };
}
