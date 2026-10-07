/** Recover controller connections when a boot-created XRSession predates Three's listeners. */
const recoveryState = new WeakMap();
const RETRY_MS = 250;

function liveUnboundSources(session, controllers) {
  const bound = new Set(controllers.map(node => node?.userData?.inputSource).filter(Boolean));
  return Array.from(session.inputSources || []).filter(source => source && !bound.has(source));
}

function connectionEvent(session, added) {
  if (typeof globalThis.XRInputSourcesChangeEvent === 'function') {
    try {
      return new globalThis.XRInputSourcesChangeEvent('inputsourceschange', { session, added, removed: [] });
    } catch { /* Event fallback supports runtimes without a constructible XR event. */ }
  }
  const event = new Event('inputsourceschange');
  Object.defineProperties(event, {
    session: { value: session }, added: { value: added }, removed: { value: [] },
  });
  return event;
}

export function hydrateXrSessionInputs({ session, controllers = [], now = performance.now(), force = false } = {}) {
  if (!session || typeof session.dispatchEvent !== 'function' || session.ended === true) {
    return { attempted: false, missing: 0, recovered: 0 };
  }
  const missing = liveUnboundSources(session, controllers);
  const unchanged = { attempted: false, missing: missing.length, recovered: 0 };
  if (!missing.length || !controllers.length) return unchanged;
  const state = recoveryState.get(session) || { busy: false, lastAttempt: -Infinity };
  const time = Number(now);
  if (state.busy || (!force && Number.isFinite(time) && time - state.lastAttempt < RETRY_MS)) return unchanged;
  // WebXRManager only has slots requested with getController/getHand. Do not
  // repeatedly reconnect extra sources when all those slots already have owners.
  const free = controllers.filter(node => !node?.userData?.inputSource).length;
  if (!free) return unchanged;
  state.busy = true;
  state.lastAttempt = Number.isFinite(time) ? time : performance.now();
  recoveryState.set(session, state);
  try {
    // This reaches Three's own source map and connect handlers. Stamping app
    // userData alone leaves Three's pose update and native select dispatch unbound.
    session.dispatchEvent(connectionEvent(session, missing.slice(0, free)));
  } catch {
    // Leave unresolved sources eligible for a later bounded retry.
  } finally {
    state.busy = false;
  }
  const remaining = liveUnboundSources(session, controllers).length;
  return { attempted: true, missing: remaining, recovered: missing.length - remaining };
}
