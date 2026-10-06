/**
 * Feature / quest progress events.
 * Fire-and-forget: never throw into callers. localStorage per user for now.
 *
 * Feature ids match DOC_FEATURES ids plus Welcome quest ids (welcome-*).
 * Quests tracking is ON by default; when off, we neither mark complete nor notify.
 */
const LS_PREFIX = "render3d:questProgress:v1:";
const LS_ENABLED = "render3d:questsEnabled:v1";
const PROGRESS_EVENT = "render3d:quest-progress";
const ENABLED_EVENT = "render3d:quests-enabled";

const TITLES = {
  "welcome-account": "Create your account",
  "welcome-open-book": "Open the Quest Book",
  "welcome-walkthrough": "Take the Studio walkthrough",
  "welcome-first-project": "Create your first project",
  "welcome-first-generate": "Generate your first part",
  "ai-generate": "Generate CAD with AI",
  picks: "Pick faces, edges & paths",
  preferences: "Preferences, theme & mouse",
  "render-agent": "Render Agent help chat",
  workspaces: "Workspaces & teammates",
  canvas: "Canvas sketch mode",
  wiring: "Wiring Simulator",
};

let userId = "anonymous";
let noteEl = null;
let noteTimer = 0;

function storageKey(uid = userId) {
  return `${LS_PREFIX}${uid || "anonymous"}`;
}

function loadFor(uid) {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveFor(uid, data) {
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(data));
  } catch {
    /* quota / private mode — ignore */
  }
}

function loadCompleted() {
  return loadFor(userId);
}

function saveCompleted(data) {
  saveFor(userId, data);
}

/** Quests ON by default. Only an explicit "0" / "false" turns them off. */
export function areQuestsEnabled() {
  try {
    const raw = localStorage.getItem(LS_ENABLED);
    if (raw == null || raw === "") return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

export function setQuestsEnabled(enabled) {
  try {
    const next = !!enabled;
    localStorage.setItem(LS_ENABLED, next ? "1" : "0");
    window.dispatchEvent(new CustomEvent(ENABLED_EVENT, { detail: { enabled: next } }));
    syncQuestToggleUIs(next);
    if (!next) hideQuestNote();
    return next;
  } catch {
    return true;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function ensureNote() {
  if (noteEl && document.body.contains(noteEl)) return noteEl;
  noteEl = document.getElementById("quest-complete-note");
  if (!noteEl) {
    noteEl = document.createElement("button");
    noteEl.id = "quest-complete-note";
    noteEl.type = "button";
    noteEl.className = "quest-complete-note hidden";
    noteEl.setAttribute("role", "status");
    noteEl.setAttribute("aria-live", "polite");
    const widget = document.querySelector(".auth-widget");
    if (widget) widget.insertBefore(noteEl, widget.firstChild);
    else document.body.appendChild(noteEl);
  }
  if (!noteEl.dataset.bound) {
    noteEl.dataset.bound = "1";
    noteEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideQuestNote();
      void import("./quest-book.js?v=20260907-vr-browser-vr-ai-draw1&vrboard=20260915-spatial-draw4").then((m) => m.openQuestBook?.());
    });
  }
  return noteEl;
}

function hideQuestNote() {
  const el = noteEl || document.getElementById("quest-complete-note");
  if (!el) return;
  el.classList.add("hidden");
  el.classList.remove("quest-complete-note--in");
}

function showQuestCompleteNote(featureId, title) {
  const el = ensureNote();
  const label = title || TITLES[featureId] || featureId;
  el.innerHTML = `
    <span class="quest-complete-note-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 2l2.5 6.3L21 9.1l-5 4.4 1.5 6.6L12 16.6 6.5 20.1 8 13.5 3 9.1l6.5-.8L12 2z"/></svg>
    </span>
    <span class="quest-complete-note-copy">
      <strong>Quest Complete!</strong>
      <em>${escapeHtml(label)}</em>
    </span>`;
  el.title = `Quest Complete — ${label}. Click to open Quest Book.`;
  el.classList.remove("hidden");
  el.classList.remove("quest-complete-note--in");
  void el.offsetWidth;
  el.classList.add("quest-complete-note--in");
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => hideQuestNote(), 5200);
}

function syncQuestToggleUIs(enabled = areQuestsEnabled()) {
  document.querySelectorAll("[data-quests-enabled-toggle]").forEach((input) => {
    if (input instanceof HTMLInputElement) input.checked = enabled;
  });
  document.querySelectorAll("[data-quests-enabled-label]").forEach((el) => {
    el.textContent = enabled ? "On" : "Off";
  });
}

/** Bind progress to the signed-in user; merge anonymous progress once. */
export function setQuestUser(user) {
  try {
    const next = user?.id ? String(user.id) : "anonymous";
    if (next !== userId && userId === "anonymous" && next !== "anonymous") {
      const merged = { ...loadFor("anonymous"), ...loadFor(next) };
      saveFor(next, merged);
    }
    userId = next;
  } catch {
    /* ignore */
  }
}

export function getCompletedQuestIds() {
  try {
    return new Set(Object.keys(loadCompleted()));
  } catch {
    return new Set();
  }
}

export function isQuestCompleted(featureId) {
  try {
    return !!loadCompleted()[featureId];
  } catch {
    return false;
  }
}

/**
 * Mark a feature/quest complete. Returns true if this was newly completed.
 * No-ops when quests are disabled (does not mark progress, does not notify).
 * Safe to call from hot paths — never throws.
 */
export function emitFeatureUsed(featureId, { title, silent = false } = {}) {
  try {
    if (!featureId) return false;
    if (!areQuestsEnabled()) return false;
    const completed = loadCompleted();
    if (completed[featureId]) return false;
    completed[featureId] = { at: Date.now() };
    saveCompleted(completed);
    const resolvedTitle = title || TITLES[featureId] || featureId;
    window.dispatchEvent(
      new CustomEvent(PROGRESS_EVENT, {
        detail: { featureId, title: resolvedTitle, completed: Object.keys(completed) },
      }),
    );
    if (!silent) showQuestCompleteNote(featureId, resolvedTitle);
    return true;
  } catch {
    return false;
  }
}

export function onQuestProgress(handler) {
  const wrapped = (e) => {
    try {
      handler?.(e.detail);
    } catch {
      /* ignore listener errors */
    }
  };
  window.addEventListener(PROGRESS_EVENT, wrapped);
  return () => window.removeEventListener(PROGRESS_EVENT, wrapped);
}

export function onQuestsEnabledChange(handler) {
  const wrapped = (e) => {
    try {
      handler?.(e.detail?.enabled !== false);
    } catch {
      /* ignore */
    }
  };
  window.addEventListener(ENABLED_EVENT, wrapped);
  return () => window.removeEventListener(ENABLED_EVENT, wrapped);
}

/* Keep any already-mounted toggles in sync on load. */
try {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => syncQuestToggleUIs(), { once: true });
  } else {
    syncQuestToggleUIs();
  }
} catch {
  /* ignore */
}

export { PROGRESS_EVENT, ENABLED_EVENT, TITLES };
