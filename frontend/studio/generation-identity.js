/** Resolve who is generating for HUD / viewport pills. */

export function sessionUserIdentity(user) {
  const u = user && typeof user === "object" ? user : null;
  if (!u) {
    return { by_user_id: "", by_user_name: "", by_user_email: "", by_avatar_url: "" };
  }
  return {
    by_user_id: String(u.id || u.by_user_id || "").trim(),
    by_user_name: String(u.display_name || u.by_user_name || u.email || u.by_user_email || "").trim(),
    by_user_email: String(u.email || u.by_user_email || "").trim(),
    by_avatar_url: String(u.avatar_url || u.by_avatar_url || "").trim(),
  };
}

function pickIdentityField(sources, key) {
  for (const src of sources) {
    const value = String(src?.[key] || "").trim();
    if (value) return value;
  }
  return "";
}

/**
 * Prefer job/live/overlay author fields; if those are empty, use the signed-in
 * session user rather than a generic "Someone" / letter avatar.
 */
export function resolveGenerationIdentity(gen = {}, {
  liveGen = null,
  jobs = [],
  overlay = null,
  sessionUser = null,
  collaborator = null,
} = {}) {
  const list = Array.isArray(jobs) ? jobs : [];
  const focused = list.find((j) => j && (j.by_user_name || j.by_user_id || j.by_avatar_url))
    || list[0]
    || {};
  const session = sessionUserIdentity(sessionUser);
  const collab = sessionUserIdentity(collaborator);
  const sources = [gen, focused, overlay, liveGen, collab];
  const by_user_id = pickIdentityField(sources, "by_user_id") || collab.by_user_id;
  const foreign = !!(by_user_id && session.by_user_id && by_user_id !== session.by_user_id);
  const sessionFallback = foreign ? {
    by_user_id: "",
    by_user_name: "",
    by_user_email: "",
    by_avatar_url: "",
  } : session;
  const by_user_name = pickIdentityField(sources, "by_user_name")
    || pickIdentityField(sources, "by_user_email")
    || collab.by_user_name
    || sessionFallback.by_user_name
    || sessionFallback.by_user_email;
  const by_user_email = pickIdentityField(sources, "by_user_email") || sessionFallback.by_user_email;
  const by_avatar_url = pickIdentityField(sources, "by_avatar_url")
    || collab.by_avatar_url
    || sessionFallback.by_avatar_url;
  return {
    by_user_id: by_user_id || sessionFallback.by_user_id,
    by_user_name,
    by_user_email,
    by_avatar_url,
  };
}

/** Keep last-known author when a poll payload omits who fields. */
export function mergeGenerationIdentity(next, prev) {
  if (!next || typeof next !== "object") return next;
  const merged = { ...next };
  for (const key of ["by_user_id", "by_user_name", "by_user_email", "by_avatar_url"]) {
    if (!String(merged[key] || "").trim() && String(prev?.[key] || "").trim()) {
      merged[key] = prev[key];
    }
  }
  return merged;
}

export function isOwnGeneration(gen = {}, sessionUser = null) {
  const uid = String(gen?.by_user_id || "").trim();
  const myId = String(sessionUser?.id || sessionUser?.by_user_id || "").trim();
  if (uid && myId) return uid === myId;
  const email = String(gen?.by_user_email || "").trim().toLowerCase();
  const myEmail = String(sessionUser?.email || sessionUser?.by_user_email || "").trim().toLowerCase();
  if (email && myEmail) return email === myEmail;
  return !uid && !email && !!(myId || myEmail);
}

export function generationAuthorKey(gen = {}, sessionUser = null) {
  const ident = resolveGenerationIdentity(gen, { sessionUser, jobs: [gen] });
  return ident.by_user_id
    || String(ident.by_user_email || "").toLowerCase()
    || ident.by_user_name
    || "";
}

/**
 * Other people with live jobs — never the signed-in user.
 * One row per author; extra jobs from the same person fold into that row.
 */
export function collaboratorGeneratingPeople(jobs = [], sessionUser = null, extras = {}) {
  const people = [];
  const index = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job) continue;
    if (String(job.status || "running").toLowerCase() !== "running") continue;
    if (String(job.kind || "").toLowerCase() === "wiring") continue;
    const ident = resolveGenerationIdentity(job, {
      ...extras,
      sessionUser,
      jobs: [job],
    });
    if (isOwnGeneration(ident, sessionUser)) continue;
    const key = ident.by_user_id
      || String(ident.by_user_email || "").toLowerCase()
      || ident.by_user_name
      || "";
    if (!key) continue;
    const pct = Number(job.progress?.pct ?? job.pct);
    const existing = index.get(key);
    if (existing) {
      existing.jobs.push(job);
      if (Number.isFinite(pct) && (!Number.isFinite(existing.pct) || pct >= existing.pct)) {
        existing.job = job;
        existing.pct = pct;
        Object.assign(existing, ident);
      }
      continue;
    }
    const person = {
      key,
      ...ident,
      job,
      jobs: [job],
      pct: Number.isFinite(pct) ? pct : undefined,
    };
    index.set(key, person);
    people.push(person);
  }
  return people;
}
