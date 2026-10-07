/** Bound canvas uploads independently of head/controller pose updates. */
export function createHudRefreshGate(intervalMs = 100) {
  let lastAt = -Infinity;
  let lastSignature;
  return {
    reset() { lastAt = -Infinity; lastSignature = undefined; },
    shouldPaint(now, signature) {
      if (signature === lastSignature || now - lastAt < intervalMs) return false;
      lastAt = now;
      lastSignature = signature;
      return true;
    },
  };
}

/** Keep text panels out of fixed-foveation's lower-resolution peripheral region.
 * Retain the existing eye-buffer size; restore scene foveation after panels close.
 */
export function createMenuClarityControl(sceneFoveation = 0.35) {
  let lastSession = null;
  let lastLevel;
  return function update(xr, menuVisible) {
    const session = xr?.getSession?.();
    if (!session) { lastSession = null; lastLevel = undefined; return; }
    const level = menuVisible ? 0 : sceneFoveation;
    if (session === lastSession && level === lastLevel) return;
    lastSession = session;
    lastLevel = level;
    if (typeof xr.setFoveation === "function") {
      try { xr.setFoveation(level); } catch { /* ignore */ }
    }
    try {
      const layer = session.renderState?.baseLayer;
      if (layer && "fixedFoveation" in layer) layer.fixedFoveation = level;
    } catch { /* ignore */ }
  };
}
