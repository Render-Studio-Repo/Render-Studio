/** Detect server/client updates and offer a reload without losing the open project.

Never auto-reload the page. CAD sessions get yanked mid-drag when mtimes change
(dev edits, deploys), so we only show a banner and reload on explicit click.
*/

const LS_CLIENT_VERSION = "render3d:client-version";
const LS_SESSION_SNAPSHOT = "render3d:session-snapshot";
const LS_PENDING_RESTORE = "render3d:pending-restore";
const POLL_MS = 60000;

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
 * Watch for client asset updates. Banner only — never force-reload.
 */
export function initClientVersionWatcher({ getSnapshot, onUpdating, isBusy, onUpdateAvailable } = {}) {
  let currentVersion = null;
  let pendingVersion = null;
  let reloading = false;
  let dismissedVersion = null;

  function performReload(nextVersion) {
    if (reloading) return;
    reloading = true;
    try {
      // Persist BEFORE reload so the next boot does not loop on a stale value.
      sessionStorage.setItem(LS_CLIENT_VERSION, String(nextVersion));
    } catch {
      /* ignore */
    }
    const snapshot = getSnapshot?.();
    if (snapshot?.projectId) markPendingRestore(snapshot);
    onUpdating?.(nextVersion);
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
      },
    );
    banner.classList.remove("hidden");
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
        // Adopt the new version in memory so we don't re-fire every poll,
        // but do not reload — user chooses when via the banner.
        currentVersion = nextVersion;
        try {
          sessionStorage.setItem(LS_CLIENT_VERSION, nextVersion);
        } catch {
          /* ignore */
        }
        if (!isBusy?.()) {
          showUpdateAvailable(nextVersion);
        } else {
          pendingVersion = nextVersion;
          onUpdateAvailable?.(nextVersion);
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

  // If an update arrived while busy, surface the banner once the tab is idle again.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || reloading) return;
    if (pendingVersion && !isBusy?.()) {
      showUpdateAvailable(pendingVersion);
    }
    void pollVersion();
  });
}
