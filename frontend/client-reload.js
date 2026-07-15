/** Detect server/client updates and offer a click-to-refresh banner.

Never auto-reloads — mid-workflow work stays intact until the user chooses
to refresh.
*/

const LS_CLIENT_VERSION = "render3d:client-version";
const LS_SESSION_SNAPSHOT = "render3d:session-snapshot";
const LS_PENDING_RESTORE = "render3d:pending-restore";
const LS_REFRESHED_AT = "render3d:client-refreshed-at";
const POLL_MS = 20000;
const POST_REFRESH_SUPPRESS_MS = 30000;

function isIPhoneOrMobileShell() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod/i.test(ua)) return true;
  try {
    return !!window.matchMedia?.(
      "(max-width: 820px), (pointer: coarse) and (max-width: 1024px)",
    )?.matches;
  } catch {
    return false;
  }
}

/** Update banner is desktop-only — hide on iPhone / mobile shell. */
function shouldSuppressUpdateBannerOnMobile() {
  return isIPhoneOrMobileShell();
}

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
  banner.setAttribute("role", "status");
  banner.innerHTML = `
    <span>Render3D just received an update. Click to refresh when you’re ready.</span>
    <button type="button" class="btn btn-compact accent" data-client-reload-now>Refresh</button>
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

function writeClientVersion(version) {
  try {
    sessionStorage.setItem(LS_CLIENT_VERSION, String(version));
  } catch {
    /* ignore */
  }
}

function postRefreshSuppressing() {
  try {
    const refreshedAt = Number(sessionStorage.getItem(LS_REFRESHED_AT) || 0);
    return Number.isFinite(refreshedAt) && Date.now() - refreshedAt < POST_REFRESH_SUPPRESS_MS;
  } catch {
    return false;
  }
}

/**
 * Watch for client asset updates.
 * Always shows a click-to-refresh banner — never auto-reloads the page.
 */
export function initClientVersionWatcher({ getSnapshot, onUpdating, isBusy, onUpdateAvailable } = {}) {
  let currentVersion = null;
  let pendingVersion = null;
  let reloading = false;
  let dismissedVersion = null;
  /** Once the user closes the banner, stay quiet until a full page refresh. */
  let dismissedUntilRefresh = false;

  function performReload(nextVersion) {
    if (reloading) return;
    reloading = true;
    try {
      // Persist BEFORE reload so the next boot does not loop on a stale value.
      sessionStorage.setItem(LS_CLIENT_VERSION, String(nextVersion));
      sessionStorage.setItem(LS_REFRESHED_AT, String(Date.now()));
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
      if (label) label.textContent = "Refreshing Render3D and restoring your project…";
      banner.querySelector("[data-client-reload-now]")?.classList.add("hidden");
      banner.querySelector("[data-client-reload-dismiss]")?.classList.add("hidden");
    }
    window.setTimeout(() => window.location.reload(), 250);
  }

  function showUpdateAvailable(nextVersion) {
    if (shouldSuppressUpdateBannerOnMobile()) return;
    if (dismissedUntilRefresh) return;
    if (dismissedVersion && dismissedVersion === nextVersion) return;
    pendingVersion = nextVersion;
    onUpdateAvailable?.(nextVersion);
    const banner = ensureUpdateBanner(
      () => performReload(nextVersion),
      () => {
        dismissedUntilRefresh = true;
        dismissedVersion = nextVersion;
        pendingVersion = null;
      },
    );
    const label = banner.querySelector("span");
    if (label) {
      label.textContent = "Render3D just received an update. Click to refresh when you’re ready.";
    }
    banner.querySelector("[data-client-reload-now]")?.classList.remove("hidden");
    banner.querySelector("[data-client-reload-dismiss]")?.classList.remove("hidden");
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
        writeClientVersion(nextVersion);
        return;
      }
      if (nextVersion !== currentVersion) {
        if (postRefreshSuppressing()) {
          currentVersion = nextVersion;
          pendingVersion = null;
          dismissedVersion = null;
          writeClientVersion(nextVersion);
          document.getElementById("client-update-banner")?.classList.add("hidden");
          return;
        }
        currentVersion = nextVersion;
        writeClientVersion(nextVersion);
        if (!dismissedUntilRefresh) {
          showUpdateAvailable(nextVersion);
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

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || reloading || dismissedUntilRefresh) return;
    if (pendingVersion) showUpdateAvailable(pendingVersion);
    void pollVersion();
  });
}
