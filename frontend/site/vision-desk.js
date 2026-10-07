/** Shared fetch + stats for white paper / suggestions. */

export async function vd(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.message || res.statusText);
  return data;
}

export function paintStats(el, data) {
  if (!el || !data) return;
  el.innerHTML = `
    <div class="vision-stat"><span>People talked</span><strong>${data.people_talked ?? 0}</strong></div>
    <div class="vision-stat"><span>Questions</span><strong>${data.questions ?? 0}</strong></div>
    <div class="vision-stat"><span>Vision questions</span><strong>${data.vision_questions ?? 0}</strong></div>
    <div class="vision-stat"><span>Comments</span><strong>${data.comments ?? 0}</strong></div>
  `;
}

export function sessionId() {
  const key = "rs:vision-session";
  try {
    const got = localStorage.getItem(key);
    if (got) return got;
    const next = crypto.randomUUID().slice(0, 12);
    localStorage.setItem(key, next);
    return next;
  } catch {
    return "anon";
  }
}
