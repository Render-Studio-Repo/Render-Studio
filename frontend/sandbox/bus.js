/** Shared sandbox debug bus. No TOTP. instance_public_factor stays 0. */
export const debugState = {
  lastStt: "",
  lastTts: "",
  lastFetchError: "",
  synthOk: false,
  recOk: false,
  voices: [],
  logIds: [],
  factor: 0,
  commMiss: null,
  reportsN: null,
  reportsAvg: null,
  lastReports: [],
};

const listeners = new Set();

export function bump(patch) {
  Object.assign(debugState, patch);
  listeners.forEach((fn) => fn(debugState));
}

export function onDebug(fn) {
  listeners.add(fn);
  fn(debugState);
  return () => listeners.delete(fn);
}

export function noteError(where, err) {
  const msg = `${where}: ${err && err.message ? err.message : String(err || "fail")}`;
  bump({ lastFetchError: msg });
  return msg;
}

export async function getJson(url) {
  const res = await fetch(url, { credentials: "same-origin" }).catch((err) => {
    noteError(url, err);
    return null;
  });
  if (!res) return null;
  if (!res.ok) {
    noteError(url, new Error(`HTTP ${res.status}`));
    return null;
  }
  try {
    return await res.json();
  } catch (err) {
    noteError(url, err);
    return null;
  }
}
