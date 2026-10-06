export const MCMASTER_WINDOW_NAME = "render3d-mcmaster-webview";

export function isCatalogWindowOpen(catalogWindow) {
  try {
    return Boolean(catalogWindow && !catalogWindow.closed);
  } catch {
    return false;
  }
}

export function openCatalogWindow(windowRef, url, features) {
  const catalogWindow = windowRef.open(url, MCMASTER_WINDOW_NAME, features);
  if (!catalogWindow) return { kind: "blocked", window: null, url };
  try { catalogWindow.focus(); } catch { /* cross-origin popup can still be open */ }
  return { kind: "open", window: catalogWindow, url };
}

export function catalogWindowState(catalogWindow, blocked = false) {
  if (isCatalogWindowOpen(catalogWindow)) return "open";
  return blocked ? "blocked" : "idle";
}
