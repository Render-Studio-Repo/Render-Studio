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
    ${
      profile.status_text || profile.status_icon
        ? `<p class="user-profile-status">${esc([profile.status_icon, profile.status_text].filter(Boolean).join(" "))}${profile.online ? " · Online" : ""}</p>`
        : profile.online
          ? `<p class="user-profile-status">Online</p>`
          : ""
    }
    <div class="user-profile-actions">
      ${isSelf ? "" : `<button type="button" class="btn accent btn-compact" data-profile-message>Message in chat</button>`}
      ${isSelf ? "" : `<button type="button" class="btn secondary btn-compact" data-profile-meeting-toggle>Request meeting</button>`}
      <button type="button" class="btn secondary btn-compact" data-profile-copy>Copy profile link</button>
    </div>
    <div class="user-profile-meeting hidden" id="user-profile-meeting">
      <label class="muted small">Pick an available slot or set a custom time</label>
      <select id="user-profile-meeting-slot">
        <option value="">Custom time…</option>
        ${(profile.suggested_slots || [])
          .map((s) => `<option value="${esc(s.starts_at)}|${esc(s.ends_at)}">${esc(s.label || s.starts_at)}</option>`)
          .join("")}
      </select>
      <input type="datetime-local" id="user-profile-meeting-start" />
      <input type="datetime-local" id="user-profile-meeting-end" />
      <input type="text" id="user-profile-meeting-time" placeholder="Or note a proposed time (e.g. Thu 3pm PT)" />
      <textarea id="user-profile-meeting-msg" placeholder="Add a short note…"></textarea>
      <div class="user-profile-actions">
        <button type="button" class="btn accent btn-compact" data-profile-meeting-chat>Send via chat + email invite</button>
        <button type="button" class="btn secondary btn-compact" data-profile-meeting-cal>Google Calendar</button>
        <button type="button" class="btn secondary btn-compact" data-profile-meeting-outlook>Outlook</button>
        <button type="button" class="btn secondary btn-compact" data-profile-meeting-ics>Download .ics</button>
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
    ${
      profile.store?.store_enabled && profile.store?.show_on_profile !== false
        ? `<section class="user-profile-section">
        <h3>Store</h3>
        <p class="user-profile-bio"><strong>${esc(profile.store.store_title || "Shop")}</strong><br/>${esc(profile.store.store_tagline || "")}</p>
        <a class="btn secondary btn-compact" href="/model-store.html?seller=${esc(profile.handle || profile.id)}">Browse their models</a>
      </section>`
        : ""
    }
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

  card.querySelector("#user-profile-meeting-slot")?.addEventListener("change", (ev) => {
    const val = ev.target.value || "";
    if (!val.includes("|")) return;
    const [start, end] = val.split("|");
    const toLocal = (iso) => {
      try {
        const d = new Date(iso);
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } catch {
        return "";
      }
    };
    const startEl = card.querySelector("#user-profile-meeting-start");
    const endEl = card.querySelector("#user-profile-meeting-end");
    if (startEl) startEl.value = toLocal(start);
    if (endEl) endEl.value = toLocal(end);
  });

  const sendMeeting = async (channel) => {
    const status = card.querySelector("#user-profile-meeting-status");
    const message = card.querySelector("#user-profile-meeting-msg")?.value || "";
    const proposed_time = card.querySelector("#user-profile-meeting-time")?.value || "";
    const startLocal = card.querySelector("#user-profile-meeting-start")?.value || "";
    const endLocal = card.querySelector("#user-profile-meeting-end")?.value || "";
    const starts_at = startLocal ? new Date(startLocal).toISOString() : "";
    const ends_at = endLocal ? new Date(endLocal).toISOString() : "";
    if (!apiFn) return;
    if (status) status.textContent = "Sending…";
    try {
      const data = await apiFn(`/api/users/${encodeURIComponent(profile.id)}/meeting-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          proposed_time,
          starts_at: starts_at || undefined,
          ends_at: ends_at || undefined,
          channel,
          send_email: true,
          project_id: currentProjectId || undefined,
        }),
      });
      const req = data?.request || {};
      if (channel === "calendar" || channel === "both") {
        if (req.calendar_url) window.open(req.calendar_url, "_blank", "noopener");
      }
      let note = "Meeting request sent.";
      if (req.email?.ok) note += " Calendar invite emailed from info@render3d.app.";
      else if (req.email?.error === "smtp_not_configured") note += " (Email SMTP not configured — use .ics / Google / Outlook.)";
      if (status) status.textContent = note;
      if (channel === "chat" || channel === "both") onOpenChat?.();
      return req;
    } catch (err) {
      if (status) status.textContent = err.message || "Could not send meeting request.";
      return null;
    }
  };

  card.querySelector("[data-profile-meeting-chat]")?.addEventListener("click", () => sendMeeting(currentProjectId ? "both" : "calendar"));
  card.querySelector("[data-profile-meeting-cal]")?.addEventListener("click", () => sendMeeting("calendar"));
  card.querySelector("[data-profile-meeting-outlook]")?.addEventListener("click", async () => {
    const req = await sendMeeting("calendar");
    if (req?.outlook_url) window.open(req.outlook_url, "_blank", "noopener");
  });
  card.querySelector("[data-profile-meeting-ics]")?.addEventListener("click", async () => {
    const req = await sendMeeting("calendar");
    if (req?.ics_download_url) window.open(req.ics_download_url, "_blank", "noopener");
  });
}

export function closeUserProfile() {
  ensureOverlay().classList.add("hidden");
}

export async function openUserProfile({ userId, handle, openMeeting = false } = {}) {
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
    if (openMeeting) {
      card.querySelector("#user-profile-meeting")?.classList.remove("hidden");
    }
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
