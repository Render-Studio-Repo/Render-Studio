/** Recenter without letting an unresponsive runtime hold scene recovery open. */
export async function refreshXrReferenceSpace({ xr, session, timeoutMs = 1500 } = {}) {
  if (!session || session.ended || typeof session.requestReferenceSpace !== "function") return null;
  let timer;
  try {
    const space = await Promise.race([
      session.requestReferenceSpace("local-floor"),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    // A late response must never reset a different immersive session.
    if (!space || session.ended || xr?.getSession?.() !== session) return null;
    xr.setReferenceSpace?.(space);
    return space;
  } catch {
    // The current reference space remains valid when recenter is unavailable.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
