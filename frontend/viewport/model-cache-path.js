/** Cache unchanged previews across project switches, without caching edits. */
export function modelCachePath(path, { files = [], projectId, epoch = 0, sessionEpoch = 0, force = null } = {}) {
  const match = String(path || "").match(/\/api\/(?:public\/)?projects\/([^/]+)\/files\/([^?#]+)/);
  if (!match) return path;
  let name;
  let owner;
  try {
    owner = decodeURIComponent(match[1]);
    name = decodeURIComponent(match[2]).replace(/\\/g, "/");
  } catch { return path; }
  const file = owner === projectId ? files.find((f) => f?.name === name || f?.viewer_filename === name) : null;
  // A version comes from this file's stat, not project recency (which changes
  // each time it is opened). Unknown/generated sidecars keep this load's key.
  const version = file?.version;
  const token = force ?? (version ? `${version}-${epoch}` : (epoch || sessionEpoch));
  const hashAt = path.indexOf("#");
  const hash = hashAt < 0 ? "" : path.slice(hashAt);
  const base = hashAt < 0 ? path : path.slice(0, hashAt);
  const encoded = encodeURIComponent(String(token));
  if (/[?&]_=/.test(base)) return base.replace(/([?&]_=)[^&]*/, `$1${encoded}`) + hash;
  return `${base}${base.includes("?") ? "&" : "?"}_=${encoded}${hash}`;
}
