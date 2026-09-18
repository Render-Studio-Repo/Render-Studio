const SESSION_PREFIX = "render3d:sandbox-session:v1:";
const PREVIEW_PREFIX = "render3d:sandbox-preview:v1:";

function safeStorage(op, fallback) {
  try {
    return op();
  } catch {
    return fallback;
  }
}

function sessionKey(projectId) {
  return `${SESSION_PREFIX}${projectId || "none"}`;
}

function previewKey(projectId, sandboxSessionKey) {
  return `${PREVIEW_PREFIX}${projectId || "none"}:${sandboxSessionKey || "default"}`;
}

export function loadSandboxClientState(projectId) {
  return safeStorage(() => {
    const raw = localStorage.getItem(sessionKey(projectId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  }, {});
}

export function saveSandboxClientState(projectId, value) {
  safeStorage(() => {
    localStorage.setItem(sessionKey(projectId), JSON.stringify(value || {}));
  });
}

export function clearSandboxClientState(projectId) {
  safeStorage(() => {
    localStorage.removeItem(sessionKey(projectId));
  });
}

export function loadSandboxPreviews(projectId, sandboxSessionKey) {
  return safeStorage(() => {
    const raw = localStorage.getItem(previewKey(projectId, sandboxSessionKey));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  }, {});
}

export function saveSandboxPreviews(projectId, sandboxSessionKey, value) {
  safeStorage(() => {
    localStorage.setItem(previewKey(projectId, sandboxSessionKey), JSON.stringify(value || {}));
  });
}

export function clearSandboxPreviews(projectId, sandboxSessionKey) {
  safeStorage(() => {
    localStorage.removeItem(previewKey(projectId, sandboxSessionKey));
  });
}

export function createSandboxSessionKey() {
  return `sandbox-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
