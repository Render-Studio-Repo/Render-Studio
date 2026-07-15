/** User profile popup — open from @mentions, /u/handle links, Discord/LinkedIn profile URLs */

let overlayEl = null;
let apiFn = null;
let currentProjectId = null;
let onMessageUser = null;
let onOpenChat = null;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "user-profile-overlay";
  overlayEl.className = "user-profile-overlay hidden";
  overlayEl.innerHTML = `<div class="user-profile-card" role="dialog" aria-modal="true" aria-labelledby="user-profile-title"></div>`;
  document.body.appendChild(overlayEl);
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl || e.target.closest("[data-profile-close]")) {
      closeUserProfile();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlayEl && !overlayEl.classList.contains("hidden")) {
      closeUserProfile();
    }
  });
  return overlayEl;
}

function renderProfile(profile) {
  const card = ensureOverlay().querySelector(".user-profile-card");
  const avatar = profile.avatar_url || "";
  const initial = (profile.display_name || profile.handle || "?").trim().charAt(0).toUpperCase();
  const projects = profile.projects || [];
  const posts = profile.posts || [];
  const isSelf = !!profile.is_self;

  card.innerHTML = `
    <button type="button" class="user-profile-close" data-profile-close aria-label="Close">×</button>
    <div class="user-profile-head">
      <span class="user-profile-avatar ${avatar ? "has-image" : ""}" style="${avatar ? `background-image:url('${esc(avatar)}')` : ""}">${avatar ? "" : esc(initial)}</span>
      <div>
        <h2 id="user-profile-title" class="user-profile-name">${esc(profile.display_name || "User")}</h2>
        <div class="user-profile-handle">@${esc(profile.handle || "user")}</div>
        <div class="muted small">${esc(profile.profile_link || profile.profile_url || "")}</div>
      </div>
    </div>
    <p class="user-profile-bio">${esc(profile.bio || "No bio yet.")}</p>
    <div class="user-profile-actions">
      ${isSelf ? "" : `<button type="button" class="btn accent btn-compact" data-profile-message>Message in chat</button>`}
      ${isSelf ? "" : `<button type="button" class="btn secondary btn-compact" data-profile-meeting-toggle>Request meeting</button>`}
      <button type="button" class="btn secondary btn-compact" data-profile-copy>Copy profile link</button>
    </div>
    <div class="user-profile-meeting hidden" id="user-profile-meeting">
      <input type="text" id="user-profile-meeting-time" placeholder="Proposed time (e.g. Thu 3pm PT)" />
      <textarea id="user-profile-meeting-msg" placeholder="Add a short note…"></textarea>
      <div class="user-profile-actions">
        <button type="button" class="btn accent btn-compact" data-profile-meeting-chat>Send via Render Studio chat</button>
        <button type="button" class="btn secondary btn-compact" data-profile-meeting-cal>Open calendar invite</button>
      </div>
      <p id="user-profile-meeting-status" class="muted small"></p>
    </div>
    <section class="user-profile-section">
      <h3>Models & projects (${esc(profile.stats?.projects ?? projects.length)})</h3>
      ${
        projects.length
          ? `<ul class="user-profile-list">${projects
              .map(
                (p) => `<li>
                  <a href="/?project=${esc(p.project_id)}">${esc(p.name || p.project_id)}</a>
                  <span class="muted small">${esc(p.model_count || 0)} models</span>
                </li>`
              )
              .join("")}</ul>`
          : `<p class="user-profile-empty">No public projects yet.</p>`
      }
    </section>
    <section class="user-profile-section">
      <h3>Public posts (${esc(profile.stats?.posts ?? posts.length)})</h3>
      ${
        posts.length
          ? `<ul class="user-profile-list">${posts
              .map(
                (p) => `<li>
                  <a href="${esc(p.href || "#")}">${esc(p.title || "Post")}</a>
                  <span class="muted small">${esc(p.summary || "")}</span>
                </li>`
              )
              .join("")}</ul>`
          : `<p class="user-profile-empty">No public posts yet.</p>`
      }
    </section>
  `;

  card.querySelector("[data-profile-copy]")?.addEventListener("click", async () => {
    const link = profile.profile_link || `${location.origin}${profile.profile_url || ""}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* ignore */
    }
  });

  card.querySelector("[data-profile-message]")?.addEventListener("click", () => {
    closeUserProfile();
    onOpenChat?.();
    onMessageUser?.(profile);
  });

  card.querySelector("[data-profile-meeting-toggle]")?.addEventListener("click", () => {
    card.querySelector("#user-profile-meeting")?.classList.toggle("hidden");
  });

  const sendMeeting = async (channel) => {
    const status = card.querySelector("#user-profile-meeting-status");
    const message = card.querySelector("#user-profile-meeting-msg")?.value || "";
    const proposed_time = card.querySelector("#user-profile-meeting-time")?.value || "";
    if (!apiFn) return;
    if (status) status.textContent = "Sending…";
    try {
      const data = await apiFn(`/api/users/${encodeURIComponent(profile.id)}/meeting-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          proposed_time,
          channel,
          project_id: currentProjectId || undefined,
        }),
      });
      if (channel === "calendar" || channel === "both") {
        const url = data?.request?.calendar_url;
        if (url) window.open(url, "_blank", "noopener");
      }
      if (status) status.textContent = channel === "chat" || channel === "both" ? "Posted to Render Studio chat." : "Calendar invite opened.";
      if (channel === "chat" || channel === "both") onOpenChat?.();
    } catch (err) {
      if (status) status.textContent = err.message || "Could not send meeting request.";
    }
  };

  card.querySelector("[data-profile-meeting-chat]")?.addEventListener("click", () => sendMeeting(currentProjectId ? "chat" : "calendar"));
  card.querySelector("[data-profile-meeting-cal]")?.addEventListener("click", () => sendMeeting("calendar"));
}

export function closeUserProfile() {
  ensureOverlay().classList.add("hidden");
}

export async function openUserProfile({ userId, handle } = {}) {
  if (!apiFn) return;
  ensureOverlay().classList.remove("hidden");
  const card = overlayEl.querySelector(".user-profile-card");
  card.innerHTML = `<p class="muted small">Loading profile…</p>`;
  try {
    let data;
    if (handle) {
      data = await apiFn(`/api/handles/${encodeURIComponent(String(handle).replace(/^@/, ""))}/profile`);
    } else if (userId) {
      data = await apiFn(`/api/users/${encodeURIComponent(userId)}/profile`);
    } else {
      throw new Error("Missing user");
    }
    renderProfile(data.profile || data);
  } catch (err) {
    card.innerHTML = `<button type="button" class="user-profile-close" data-profile-close aria-label="Close">×</button>
      <p class="status error">${esc(err.message || "Profile not found")}</p>`;
  }
}

export function bindUserProfileDeepLinks() {
  const path = location.pathname || "";
  const m = path.match(/^\/u\/([A-Za-z][\w]{1,23})\/?$/);
  if (m) {
    void openUserProfile({ handle: m[1] });
    return;
  }
  const params = new URLSearchParams(location.search);
  const handle = params.get("profile") || params.get("u");
  if (handle) void openUserProfile({ handle: handle.replace(/^@/, "") });
}

export function createUserProfileUI(opts = {}) {
  apiFn = opts.api;
  currentProjectId = opts.getProjectId?.() || null;
  onMessageUser = opts.onMessageUser || null;
  onOpenChat = opts.onOpenChat || null;
  ensureOverlay();

  // Refresh project id lazily
  const tick = () => {
    currentProjectId = opts.getProjectId?.() || currentProjectId;
  };
  setInterval(tick, 2000);

  document.addEventListener("click", (e) => {
    const mention = e.target.closest?.(".pc-mention[data-mention-kind='user'], .pc-mention[data-mention-id]");
    if (!mention) return;
    const kind = mention.getAttribute("data-mention-kind");
    if (kind && kind !== "user") return;
    const id = mention.getAttribute("data-mention-id");
    if (!id || id === "render-agent") return;
    e.preventDefault();
    void openUserProfile({ userId: id });
  });

  return {
    open: openUserProfile,
    openHandle: (handle) => openUserProfile({ handle }),
    close: closeUserProfile,
    bindDeepLinks: bindUserProfileDeepLinks,
  };
}

export default createUserProfileUI;
