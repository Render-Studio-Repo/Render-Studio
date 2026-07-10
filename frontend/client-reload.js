/** Detect server/client updates and reload without losing the open project. */

const LS_CLIENT_VERSION = "render3d:client-version";
const LS_SESSION_SNAPSHOT = "render3d:session-snapshot";
const LS_PENDING_RESTORE = "render3d:pending-restore";
const POLL_MS = 45000;

function readJson(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

export function saveSessionSnapshot(snapshot) {
  if (!snapshot?.projectId) return;
  writeJson(LS_SESSION_SNAPSHOT, {
    projectId: snapshot.projectId,
    selectedFile: snapshot.selectedFile || null,
    workspaceId: snapshot.workspaceId || null,
    savedAt: Date.now(),
  });
}

export function markPendingRestore(snapshot) {
  if (!snapshot?.projectId) return;
  writeJson(LS_PENDING_RESTORE, {
    projectId: snapshot.projectId,
    selectedFile: snapshot.selectedFile || null,
    workspaceId: snapshot.workspaceId || null,
    savedAt: Date.now(),
  });
}

export function readPendingRestore() {
  return readJson(LS_PENDING_RESTORE) || readJson(LS_SESSION_SNAPSHOT);
}

export function clearPendingRestore() {
  try {
    sessionStorage.removeItem(LS_PENDING_RESTORE);
  } catch {
    /* ignore */
  }
}

export function initClientVersionWatcher({ getSnapshot, onUpdating } = {}) {
  let currentVersion = null;
  let reloading = false;

  async function pollVersion() {
    if (reloading || document.hidden) return;
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const nextVersion = String(data.client_version || "dev");
      if (currentVersion && nextVersion !== currentVersion) {
        reloading = true;
        const snapshot = getSnapshot?.();
        if (snapshot?.projectId) markPendingRestore(snapshot);
        onUpdating?.(nextVersion);
        window.setTimeout(() => window.location.reload(), 350);
        return;
      }
      currentVersion = nextVersion;
      try {
        sessionStorage.setItem(LS_CLIENT_VERSION, nextVersion);
      } catch {
        /* ignore */
      }
    } catch {
      /* server may be restarting — try again on next poll */
    }
  }

  try {
    currentVersion = sessionStorage.getItem(LS_CLIENT_VERSION);
  } catch {
    currentVersion = null;
  }

  void pollVersion();
  window.setInterval(() => {
    void pollVersion();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void pollVersion();
  });
}
