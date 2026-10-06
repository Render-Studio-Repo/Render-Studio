/** End the current immersive document before replacing it with the fresh XR boot URL. */
export async function endXrSessionThenNavigate({ session, href, navigate, timeoutMs = 2500 } = {}) {
  if (typeof navigate !== "function" || !href) return false;
  let timer = 0;
  try {
    const ending = Promise.resolve(session?.end?.()).catch(() => undefined);
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, Math.max(0, Number(timeoutMs) || 0));
    });
    await Promise.race([ending, timeout]);
  } catch {
    // An already-ended session is equivalent to a completed teardown here.
  } finally {
    clearTimeout(timer);
  }
  navigate(href);
  return true;
}
