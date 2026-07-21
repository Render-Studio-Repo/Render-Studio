/**
 * Feature / quest progress events.
 * Fire-and-forget: never throw into callers. localStorage per user for now.
 *
 * Feature ids match DOC_FEATURES ids plus Welcome quest ids (welcome-*).
 */
const LS_PREFIX = "render3d:questProgress:v1:";
const PROGRESS_EVENT = "render3d:quest-progress";

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
let toastEl = null;
let toastTimer = 0;

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

function ensureToast() {
  if (toastEl) return toastEl;
  toastEl = document.createElement("div");
  toastEl.id = "quest-toast";
  toastEl.className = "quest-toast hidden";
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  document.body.appendChild(toastEl);
  return toastEl;
}

function showQuestToast(featureId, title) {
  const el = ensureToast();
  const label = title || TITLES[featureId] || featureId;
  el.innerHTML = `
    <span class="quest-toast-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2l2.5 6.3L21 9.1l-5 4.4 1.5 6.6L12 16.6 6.5 20.1 8 13.5 3 9.1l6.5-.8L12 2z"/></svg>
    </span>
    <div class="quest-toast-text">
      <strong>Quest complete</strong>
      <span>${escapeHtml(label)}</span>
    </div>`;
  el.classList.remove("hidden");
  el.classList.remove("quest-toast--in");
  void el.offsetWidth;
  el.classList.add("quest-toast--in");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.add("hidden");
    el.classList.remove("quest-toast--in");
  }, 3200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
 * Safe to call from hot paths — never throws.
 */
export function emitFeatureUsed(featureId, { title, silent = false } = {}) {
  try {
    if (!featureId) return false;
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
    if (!silent) showQuestToast(featureId, resolvedTitle);
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

export { PROGRESS_EVENT, TITLES };
