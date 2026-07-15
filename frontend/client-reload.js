/** Detect server/client updates and reload without losing the open project.

Auto-reloads when the tab is idle (not mid-drag / sketch / generate).
If busy, shows a banner so the user can reload when ready.
*/

const LS_CLIENT_VERSION = "render3d:client-version";
const LS_SESSION_SNAPSHOT = "render3d:session-snapshot";
const LS_PENDING_RESTORE = "render3d:pending-restore";
const POLL_MS = 20000;
const IDLE_RELOAD_DELAY_MS = 1200;

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

function ensureUpdateBanner(onReloadNow, onDismiss) {
  let banner = document.getElementById("client-update-banner");
  if (banner) return banner;
  banner = document.createElement("div");
  banner.id = "client-update-banner";
  banner.className = "client-update-banner hidden";
  banner.innerHTML = `
    <span>A new Render3D version is available.</span>
    <button type="button" class="btn btn-compact" data-client-reload-now>Reload &amp; restore project</button>
    <button type="button" class="btn-icon" data-client-reload-dismiss title="Dismiss">×</button>
  `;
  document.body.appendChild(banner);
  banner.querySelector("[data-client-reload-now]")?.addEventListener("click", () => onReloadNow?.());
  banner.querySelector("[data-client-reload-dismiss]")?.addEventListener("click", () => {
    banner.classList.add("hidden");
    onDismiss?.();
  });
  return banner;
}

/**
 * Watch for client asset updates.
 * Idle tabs auto-reload (with project restore). Busy tabs get a banner instead.
 */
export function initClientVersionWatcher({ getSnapshot, onUpdating, isBusy, onUpdateAvailable } = {}) {
  let currentVersion = null;
  let pendingVersion = null;
  let reloading = false;
  let dismissedVersion = null;
  let idleReloadTimer = null;

  function performReload(nextVersion) {
    if (reloading) return;
    reloading = true;
    if (idleReloadTimer) {
      clearTimeout(idleReloadTimer);
      idleReloadTimer = null;
    }
    try {
      // Persist BEFORE reload so the next boot does not loop on a stale value.
      sessionStorage.setItem(LS_CLIENT_VERSION, String(nextVersion));
    } catch {
      /* ignore */
    }
    const snapshot = getSnapshot?.();
    if (snapshot?.projectId) markPendingRestore(snapshot);
    onUpdating?.(nextVersion);
    const banner = document.getElementById("client-update-banner");
    if (banner) {
      banner.classList.remove("hidden");
      const label = banner.querySelector("span");
      if (label) label.textContent = "Reloading new version and restoring your project…";
      banner.querySelector("[data-client-reload-now]")?.classList.add("hidden");
    }
    window.setTimeout(() => window.location.reload(), 250);
  }

  function showUpdateAvailable(nextVersion) {
    if (dismissedVersion && dismissedVersion === nextVersion) return;
    pendingVersion = nextVersion;
    onUpdateAvailable?.(nextVersion);
    const banner = ensureUpdateBanner(
      () => performReload(nextVersion),
      () => {
        dismissedVersion = nextVersion;
        pendingVersion = null;
        if (idleReloadTimer) {
          clearTimeout(idleReloadTimer);
          idleReloadTimer = null;
        }
      },
    );
    banner.classList.remove("hidden");
  }

  function scheduleIdleReload(nextVersion) {
    if (dismissedVersion && dismissedVersion === nextVersion) return;
    pendingVersion = nextVersion;
    if (idleReloadTimer) clearTimeout(idleReloadTimer);
    idleReloadTimer = setTimeout(() => {
      idleReloadTimer = null;
      if (reloading) return;
      if (isBusy?.()) {
        showUpdateAvailable(nextVersion);
        return;
      }
      performReload(nextVersion);
    }, IDLE_RELOAD_DELAY_MS);
  }

  async function pollVersion() {
    if (reloading) return;
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const nextVersion = String(data.client_version || "dev");
      if (!currentVersion) {
        currentVersion = nextVersion;
        try {
          sessionStorage.setItem(LS_CLIENT_VERSION, nextVersion);
        } catch {
          /* ignore */
        }
        return;
      }
      if (nextVersion !== currentVersion) {
        currentVersion = nextVersion;
        try {
          sessionStorage.setItem(LS_CLIENT_VERSION, nextVersion);
        } catch {
          /* ignore */
        }
        if (isBusy?.()) {
          showUpdateAvailable(nextVersion);
        } else {
          onUpdateAvailable?.(nextVersion);
          scheduleIdleReload(nextVersion);
        }
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

  // If an update arrived while busy, reload/banner once the tab is idle again.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || reloading) return;
    if (pendingVersion && !isBusy?.()) {
      scheduleIdleReload(pendingVersion);
    } else if (pendingVersion) {
      showUpdateAvailable(pendingVersion);
    }
    void pollVersion();
  });
}
