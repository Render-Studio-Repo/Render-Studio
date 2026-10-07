/** User profile popup — handle, store, activity, calendar, settings */

let overlayEl = null;
let profileReturnFocus = null;
let apiFn = null;
let userProfileAbort = null; // leakfix75
function beginUserProfileFetch() {
  if (userProfileAbort) {
    try { userProfileAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  userProfileAbort = ctl;
  return ctl;
}
let currentProjectId = null;
let onMessageUser = null;
let onOpenChat = null;
let onOpenPreferences = null;
let onNeedAuth = null;
let activeTab = "profile";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toLocal(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function formatWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(iso);
  }
}

function formatPrice(cents, currency = "USD") {
  const n = Number(cents) || 0;
  if (n <= 0) return "Free";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n / 100);
  } catch {
    return `${(n / 100).toFixed(2)} ${currency}`;
  }
}

function toLocalInput(iso) {
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function formatBusyLabel(block) {
  try {
    const start = new Date(block.starts_at);
    const end = new Date(block.ends_at);
    const sameDay = start.toDateString() === end.toDateString();
    const day = start.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const t0 = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const t1 = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return sameDay ? `${day} ${t0}–${t1}` : `${start.toLocaleString()} – ${end.toLocaleString()}`;
  } catch {
    return `${block.starts_at || ""} – ${block.ends_at || ""}`;
  }
}

function setOverlayVisible(on) {
  if (!overlayEl) return;
  overlayEl.classList.toggle("hidden", !on);
  overlayEl.hidden = !on;
  overlayEl.setAttribute("aria-hidden", on ? "false" : "true");
}

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "user-profile-overlay";
  overlayEl.className = "user-profile-overlay hidden";
  overlayEl.hidden = true;
  overlayEl.setAttribute("aria-hidden", "true");
  overlayEl.innerHTML = `<div class="user-profile-card" role="dialog" aria-modal="true" aria-labelledby="user-profile-title" tabindex="-1"></div>`;
  document.body.appendChild(overlayEl);
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl || e.target.closest("[data-profile-close]")) {
      closeUserProfile();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!overlayEl || overlayEl.hidden || overlayEl.classList.contains("hidden")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeUserProfile();
    }
  }, true);
  overlayEl.addEventListener("keydown", (e) => {
    // Keep the profile's focus loop local so a payment/setup dialog above it can own focus.
    if (e.key === "Tab") {
      const card = overlayEl.querySelector(".user-profile-card");
      const focusable = [...card.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (!first || !card.contains(document.activeElement) || document.activeElement === card || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        e.preventDefault();
        e.stopPropagation();
        (e.shiftKey ? last : first)?.focus({ preventScroll: true });
        if (!first) card.focus({ preventScroll: true });
      }
    }
  });
  return overlayEl;
}

function tabsFor(profile) {
  const isSelf = !!profile?.is_self;
  const ids = Array.isArray(profile?.tabs) && profile.tabs.length
    ? profile.tabs
    : ["profile", "store", "activity", ...(isSelf ? ["settings"] : []), "calendar"];
  const labels = {
    profile: "Profile",
    about: "Profile",
    store: "Store",
    activity: "Activity",
    calendar: "Calendar / Scheduler",
    settings: "Settings",
  };
  return ids
    .filter((id) => id !== "settings" || isSelf)
    .map((id) => {
      const key = id === "about" ? "profile" : id;
      return { id: key, label: labels[key] || key };
    });
}

function renderTabs(profile) {
  return `<nav class="user-profile-tabs" role="tablist" aria-label="Profile sections">
    ${tabsFor(profile)
      .map(
        (tab) => `<button type="button" class="user-profile-tab${activeTab === tab.id ? " is-active" : ""}" data-profile-tab="${tab.id}" role="tab" aria-selected="${activeTab === tab.id ? "true" : "false"}">${esc(tab.label)}</button>`,
      )
      .join("")}
  </nav>`;
}

function renderAbout(profile) {
  const projects = profile.projects || [];
  const posts = profile.posts || [];
  return `
    <p class="user-profile-bio">${esc(profile.bio || "No bio yet.")}</p>
    <section class="user-profile-section">
      <h3>Models &amp; projects (${esc(profile.stats?.projects ?? projects.length)})</h3>
      ${
        projects.length
          ? `<ul class="user-profile-list">${projects
              .map(
                (p) => `<li>
                  <a href="/?project=${esc(p.project_id)}">${esc(p.name || p.project_id)}</a>
                  <span class="user-profile-meta">${esc(p.model_count || 0)} models</span>
                </li>`,
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
                  <span class="user-profile-meta">${esc(p.summary || "")}</span>
                </li>`,
              )
              .join("")}</ul>`
          : `<p class="user-profile-empty">No public posts yet.</p>`
      }
    </section>
  `;
}

function renderStore(profile) {
  const listings = profile.store_listings || [];
  const store = profile.store || {};
  const enabled = store.store_enabled && store.show_on_profile !== false;
  return `
    <section class="user-profile-section user-profile-section--flush">
      <h3>Published on stores</h3>
      ${
        enabled
          ? `<p class="user-profile-store-kicker"><strong>${esc(store.store_title || "Shop")}</strong> ${esc(store.store_tagline || "")}</p>`
          : ""
      }
      ${
        listings.length
          ? `<ul class="user-profile-list">${listings
              .map(
                (item) => `<li>
                  <a href="${esc(item.href || "/model-store.html")}">${esc(item.name || "Listing")}</a>
                  <span class="user-profile-meta">${esc(formatPrice(item.price_cents, item.currency))}${item.tagline ? ` · ${esc(item.tagline)}` : ""}</span>
                </li>`,
              )
              .join("")}</ul>`
          : `<p class="user-profile-empty">No published store items yet.</p>`
      }
      ${
        enabled
          ? `<a class="btn secondary btn-compact user-profile-store-link" href="${esc(profile.store_path || `/u/${profile.handle}`)}">Browse their store</a>`
          : ""
      }
    </section>
  `;
}

function renderActivity(profile) {
  const items = profile.activity || [];
  return `
    <section class="user-profile-section user-profile-section--flush">
      <h3>Recent activity</h3>
      ${
        items.length
          ? `<ul class="user-profile-activity">${items
              .map(
                (item) => `<li>
                  <span class="user-profile-activity-label">${esc(item.label || "generated a new model with CAD")}</span>
                  <span class="user-profile-meta">${esc(item.filename || item.project_id || "")}${item.created_at ? ` · ${esc(formatWhen(item.created_at))}` : ""}</span>
                </li>`,
              )
              .join("")}</ul>`
          : `<p class="user-profile-empty">No recent public activity yet.</p>`
      }
    </section>
  `;
}

function renderCalendar(profile) {
  const cal = profile.calendar || {};
  const isSelf = !!profile.is_self;
  const canView = !!cal.can_view;
  const busy = canView ? cal.busy || [] : [];
  const slots = profile.suggested_slots || cal.suggested_slots || [];
  const privacyNote = isSelf
    ? cal.visibility === "public"
      ? "Others can see your busy times."
      : "Internal use only — others can still request a meeting, but not see busy slots."
    : canView
      ? "Busy times from their connected calendar."
      : "This calendar is internal-only. You can still request a time.";
  return `
    <section class="user-profile-section user-profile-section--flush user-profile-calendar">
      <h3>${isSelf ? "Your scheduler" : "Scheduler"}</h3>
      <p class="user-profile-calendar-note">${esc(privacyNote)}</p>
      ${
        canView && busy.length
          ? `<ul class="user-profile-list">${busy
              .slice(0, 8)
              .map(
                (b) => `<li>
                  <span>${esc(formatBusyLabel(b))}</span>
                  <span class="user-profile-meta">${esc(b.title || "Busy")}</span>
                </li>`,
              )
              .join("")}</ul>`
          : canView
            ? `<p class="user-profile-empty">No busy times in the next week.</p>`
            : ""
      }
      ${
        isSelf
          ? `<p class="user-profile-meta" data-profile-incoming></p>`
          : `
      <div class="user-profile-meeting" id="user-profile-meeting">
        <label class="user-profile-field-label">Request a meeting</label>
        <select id="user-profile-meeting-slot">
          <option value="">Custom time…</option>
          ${slots.map((s) => `<option value="${esc(s.starts_at)}|${esc(s.ends_at)}">${esc(s.label || s.starts_at)}</option>`).join("")}
        </select>
        <input type="datetime-local" id="user-profile-meeting-start" />
        <input type="datetime-local" id="user-profile-meeting-end" />
        <input type="text" id="user-profile-meeting-time" placeholder="Or note a proposed time (e.g. Thu 3pm PT)" />
        <textarea id="user-profile-meeting-msg" placeholder="Add a short note…"></textarea>
        <div class="user-profile-actions">
          <button type="button" class="btn accent btn-compact" data-profile-meeting-send>Send meeting request</button>
        </div>
        <p id="user-profile-meeting-status" class="user-profile-status-line"></p>
      </div>`
      }
    </section>
  `;
}

function renderSettings(profile) {
  if (!profile.is_self) {
    const name = profile.display_name || profile.handle || "this person";
    return `
    <section class="user-profile-section user-profile-section--flush">
      <h3>Settings for ${esc(name)}</h3>
      <p class="user-profile-calendar-note">Mute, friend, and file send for this person — not your account.</p>
      <div class="user-profile-actions">
        <button type="button" class="btn accent btn-compact" data-profile-friend>${profile.is_friend ? "Friends" : "Add friend"}</button>
        <button type="button" class="btn secondary btn-compact" data-profile-message>Message</button>
      </div>
      <p class="user-profile-meta">Headset: mute them from the nametag or Social → Settings.</p>
      <p class="user-profile-status-line" data-profile-person-status></p>
    </section>`;
  }
  const cal = profile.calendar || {};
  const vis = cal.visibility === "public" ? "public" : "internal";
  return `
    <section class="user-profile-section user-profile-section--flush">
      <h3>Your settings</h3>
      <label class="user-profile-pref">
        <span>
          <b>Calendar visibility</b>
          <small>Public lets others see busy times. Internal is Studio-only.</small>
        </span>
        <select id="user-profile-cal-visibility">
          <option value="internal"${vis === "internal" ? " selected" : ""}>Internal use only</option>
          <option value="public"${vis === "public" ? " selected" : ""}>Others can view my calendar</option>
        </select>
      </label>
      <label class="user-profile-pref user-profile-pref--switch">
        <span>
          <b>Show event titles when others view</b>
          <small>Off = busy/free only. Only applies if visibility is public.</small>
        </span>
        <input type="checkbox" id="user-profile-cal-titles" ${cal.show_titles ? "checked" : ""} />
      </label>
      <label class="user-profile-pref user-profile-pref--switch">
        <span>
          <b>Meeting reminders via email</b>
          <small>30 minutes before an accepted meeting.</small>
        </span>
        <input type="checkbox" id="user-profile-meeting-reminders" checked />
      </label>
      <div class="user-profile-actions">
        <button type="button" class="btn secondary btn-compact" data-profile-open-payments>Payments</button>
        <button type="button" class="btn secondary btn-compact" data-profile-open-calendar>Calendar</button>
        <button type="button" class="btn secondary btn-compact" data-profile-open-prefs>Open Preferences</button>
      </div>
      <p class="user-profile-status-line" data-profile-settings-status></p>
    </section>
  `;
}

let compactMode = false;

function publicProfileHref(profile) {
  if (profile?.profile_url) return profile.profile_url;
  if (profile?.handle) return `/u/${encodeURIComponent(String(profile.handle).replace(/^@/, ""))}`;
  return "#";
}

function renderCompactProfile(profile) {
  const overlay = ensureOverlay();
  overlay.classList.add("user-profile-overlay--compact");
  const card = overlay.querySelector(".user-profile-card");
  card.classList.add("user-profile-card--compact");
  const avatar = profile.avatar_url || "";
  const initial = (profile.display_name || profile.handle || "?").trim().charAt(0).toUpperCase();
  const isSelf = !!profile.is_self;
  const href = publicProfileHref(profile);
  const friendLabel = profile.is_friend ? "Friends" : "Friend request";
  card.innerHTML = `
    <button type="button" class="user-profile-close" data-profile-close aria-label="Close">×</button>
    <div class="user-profile-head">
      <span class="user-profile-avatar ${avatar ? "has-image" : ""}" style="${avatar ? `background-image:url('${esc(avatar)}')` : ""}">${avatar ? "" : esc(initial)}</span>
      <div>
        <h2 id="user-profile-title" class="user-profile-name">${esc(profile.display_name || "User")}</h2>
        <div class="user-profile-handle">@${esc(profile.handle || "user")}</div>
      </div>
    </div>
    <div class="user-profile-actions user-profile-actions--compact">
      <a class="btn secondary btn-compact" data-profile-public href="${esc(href)}">Public profile</a>
      ${isSelf ? "" : `<button type="button" class="btn accent btn-compact" data-profile-message>Send message</button>`}
      ${isSelf ? "" : `<button type="button" class="btn secondary btn-compact" data-profile-friend>${esc(friendLabel)}</button>`}
    </div>
    <p class="user-profile-status-line" data-profile-person-status></p>
  `;
  bindProfile(card, profile);
}

function renderProfile(profile) {
  const overlay = ensureOverlay();
  if (compactMode) {
    renderCompactProfile(profile);
    return;
  }
  overlay.classList.remove("user-profile-overlay--compact");
  const card = overlay.querySelector(".user-profile-card");
  card.classList.remove("user-profile-card--compact");
  const avatar = profile.avatar_url || "";
  const initial = (profile.display_name || profile.handle || "?").trim().charAt(0).toUpperCase();
  const isSelf = !!profile.is_self;
  const allowed = new Set(tabsFor(profile).map((t) => t.id));
  if (!allowed.has(activeTab)) activeTab = "profile";

  const pane =
    activeTab === "store"
      ? renderStore(profile)
      : activeTab === "activity"
        ? renderActivity(profile)
        : activeTab === "calendar"
          ? renderCalendar(profile)
          : activeTab === "settings"
            ? renderSettings(profile)
            : renderAbout(profile);

  card.innerHTML = `
    <button type="button" class="user-profile-close" data-profile-close aria-label="Close">×</button>
    <div class="user-profile-head">
      <span class="user-profile-avatar ${avatar ? "has-image" : ""}" style="${avatar ? `background-image:url('${esc(avatar)}')` : ""}">${avatar ? "" : esc(initial)}</span>
      <div>
        <h2 id="user-profile-title" class="user-profile-name">${esc(profile.display_name || "User")}</h2>
        <div class="user-profile-handle">@${esc(profile.handle || "user")}</div>
        <div class="user-profile-link">${esc(profile.profile_link || profile.profile_url || "")}</div>
      </div>
    </div>
    ${
      profile.status_text || profile.status_icon
        ? `<p class="user-profile-status">${esc([profile.status_icon, profile.status_text].filter(Boolean).join(" "))}${profile.online ? " · Online" : ""}</p>`
        : profile.online
          ? `<p class="user-profile-status">Online</p>`
          : ""
    }
    <div class="user-profile-actions">
      ${profile.receive_money?.show_button ? `<span class="user-profile-head-pay" data-recv-pay-slot></span>` : ""}
      ${isSelf ? `<button type="button" class="btn secondary btn-compact" data-profile-open-prefs>Edit settings</button>` : `<button type="button" class="btn accent btn-compact" data-profile-message>Message in chat</button>`}
      ${isSelf ? "" : `<button type="button" class="btn secondary btn-compact" data-profile-friend>${profile.is_friend ? "Friends" : "Add friend"}</button>`}
      ${isSelf ? "" : `<button type="button" class="btn secondary btn-compact" data-profile-tab="calendar">Request meeting</button>`}
      <button type="button" class="btn secondary btn-compact" data-profile-copy>Copy profile link</button>
      ${profile.store_url || profile.store_path ? `<a class="btn secondary btn-compact" href="${esc(profile.store_path || profile.profile_url || "#")}">View store</a>` : ""}
      <a class="btn secondary btn-compact" href="https://twitter.com/intent/tweet?text=${encodeURIComponent((profile.display_name || "My Render profile") + " on Render Studio")}&url=${encodeURIComponent(profile.store_url || profile.profile_link || "")}" target="_blank" rel="noopener">Share on X</a>
    </div>
    ${isSelf ? "" : `<section class="user-profile-section user-profile-invite" data-profile-invite><p class="user-profile-meta">Loading workspaces…</p></section>`}
    ${renderTabs(profile)}
    <div class="user-profile-pane" data-profile-pane>${pane}</div>
  `;

  bindProfile(card, profile);
  if (!isSelf) void fillInviteSection(profile);
  if (isSelf && activeTab === "settings") void hydrateSelfSettings(card);
  if (isSelf && activeTab === "calendar") void fillIncomingMeetings(card);
  void mountReceiveOnProfile(card, profile);
}

function bindProfile(card, profile) {
  card.querySelector("[data-profile-copy]")?.addEventListener("click", async () => {
    const link = profile.profile_link || `${location.origin}${profile.profile_url || ""}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* ignore */
    }
  });

  card.querySelector("[data-profile-message]")?.addEventListener("click", () => {
    if (onNeedAuth?.({ reason: "message", profile })) return;
    closeUserProfile();
    onOpenChat?.();
    onMessageUser?.(profile);
  });

  card.querySelector("[data-profile-public]")?.addEventListener("click", (e) => {
    const href = card.querySelector("[data-profile-public]")?.getAttribute("href");
    if (!href || href === "#") e.preventDefault();
  });

  card.querySelector("[data-profile-friend]")?.addEventListener("click", async () => {
    const status = card.querySelector("[data-profile-person-status]");
    const btn = card.querySelector("[data-profile-friend]");
    if (!profile.id || !apiFn) return;
    if (onNeedAuth?.({ reason: "friend", profile })) return;
    if (status) status.textContent = "Adding…";
    try {
      await apiFn("/api/social/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: profile.id }),
      });
      profile.is_friend = true;
      if (btn) btn.textContent = "Friends";
      if (status) status.textContent = "Added as a friend.";
    } catch (err) {
      const msg = err.message || "Could not add friend.";
      if (onNeedAuth && /401|authenticated|unauthorized|sign in/i.test(msg)) {
        if (onNeedAuth({ reason: "friend", profile })) return;
      }
      if (status) status.textContent = msg;
    }
  });

  card.querySelectorAll("[data-profile-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-profile-tab") || "profile";
      activeTab = next;
      renderProfile(profile);
    });
  });

  card.querySelector("[data-profile-open-prefs]")?.addEventListener("click", () => {
    closeUserProfile();
    onOpenPreferences?.();
  });
  card.querySelector("[data-profile-open-payments]")?.addEventListener("click", () => {
    closeUserProfile();
    onOpenPreferences?.({ tab: "payments" });
  });
  card.querySelector("[data-profile-open-calendar]")?.addEventListener("click", () => {
    closeUserProfile();
    onOpenPreferences?.({ tab: "calendar" });
  });

  card.querySelector("#user-profile-meeting-slot")?.addEventListener("change", (ev) => {
    const val = ev.target.value || "";
    if (!val.includes("|")) return;
    const [start, end] = val.split("|");
    const startEl = card.querySelector("#user-profile-meeting-start");
    const endEl = card.querySelector("#user-profile-meeting-end");
    if (startEl) startEl.value = toLocal(start);
    if (endEl) endEl.value = toLocal(end);
  });

  card.querySelector("[data-profile-meeting-send]")?.addEventListener("click", () => {
    void sendMeeting(card, profile);
  });

  card.querySelector("#user-profile-cal-visibility")?.addEventListener("change", async (ev) => {
    const status = card.querySelector("[data-profile-settings-status]");
    try {
      const data = await apiFn("/api/users/me/calendar-privacy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: ev.target.value }),
      });
      profile.calendar = { ...(profile.calendar || {}), ...(data.privacy || {}) };
      if (status) status.textContent = data.privacy?.visibility === "public" ? "Others can view your calendar." : "Calendar is internal only.";
    } catch (err) {
      if (status) status.textContent = err.message || "Could not save visibility.";
    }
  });

  card.querySelector("#user-profile-cal-titles")?.addEventListener("change", async (ev) => {
    const status = card.querySelector("[data-profile-settings-status]");
    try {
      const data = await apiFn("/api/users/me/calendar-privacy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show_titles: !!ev.target.checked }),
      });
      profile.calendar = { ...(profile.calendar || {}), ...(data.privacy || {}) };
      if (status) status.textContent = ev.target.checked ? "Event titles visible when public." : "Others see busy/free only.";
    } catch (err) {
      if (status) status.textContent = err.message || "Could not save title preference.";
    }
  });

  card.querySelector("#user-profile-meeting-reminders")?.addEventListener("change", async (ev) => {
    const status = card.querySelector("[data-profile-settings-status]");
    try {
      await apiFn("/api/users/me/email-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_reminders: !!ev.target.checked }),
      });
      if (status) status.textContent = ev.target.checked ? "Email reminders on (30 minutes before)." : "Email reminders off.";
    } catch (err) {
      if (status) status.textContent = err.message || "Could not save reminder preference.";
    }
  });

  const connect = async (provider) => {
    const status = card.querySelector("[data-profile-settings-status]");
    try {
      const data = await apiFn(`/api/users/me/calendar/connect/${provider}`);
      if (data.url) window.location.href = data.url;
    } catch (err) {
      if (status) status.textContent = err.message || "Calendar connect failed.";
    }
  };
  card.querySelector("[data-profile-cal-google]")?.addEventListener("click", () => connect("google"));
  card.querySelector("[data-profile-cal-outlook]")?.addEventListener("click", () => connect("microsoft"));
}

async function sendMeeting(card, profile) {
  const status = card.querySelector("#user-profile-meeting-status");
  const message = card.querySelector("#user-profile-meeting-msg")?.value || "";
  const proposed_time = card.querySelector("#user-profile-meeting-time")?.value || "";
  const startLocal = card.querySelector("#user-profile-meeting-start")?.value || "";
  const endLocal = card.querySelector("#user-profile-meeting-end")?.value || "";
  const starts_at = startLocal ? new Date(startLocal).toISOString() : "";
  const ends_at = endLocal ? new Date(endLocal).toISOString() : "";
  if (!apiFn) return;
  if (status) status.textContent = "Sending request…";
  try {
    const data = await apiFn(`/api/users/${encodeURIComponent(profile.id)}/meeting-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        proposed_time,
        starts_at: starts_at || undefined,
        ends_at: ends_at || undefined,
        channel: currentProjectId ? "both" : "calendar",
        send_email: true,
        project_id: currentProjectId || undefined,
      }),
    });
    const req = data?.request || {};
    let note = "Meeting request sent. They’ll get an alert to accept.";
    if (req.email?.ok) note += " Emailed from info@render3d.app.";
    else if (req.email?.error === "smtp_not_configured") note += " (Email SMTP not configured — they still get an in-app alert.)";
    if (status) status.textContent = note;
    return req;
  } catch (err) {
    if (status) status.textContent = err.message || "Could not send meeting request.";
    return null;
  }
}

async function hydrateSelfSettings(card) {
  if (!apiFn) return;
  try {
    const data = await apiFn("/api/users/me/email-preferences");
    const on = data.preferences?.meeting_reminders !== false;
    const box = card.querySelector("#user-profile-meeting-reminders");
    if (box) box.checked = on;
  } catch {
    /* keep default on */
  }
}

async function fillIncomingMeetings(card) {
  const host = card.querySelector("[data-profile-incoming]");
  if (!host || !apiFn) return;
  try {
    const data = await apiFn("/api/users/me/meeting-requests");
    const n = (data.incoming || []).length;
    host.textContent = n
      ? `${n} pending meeting request${n === 1 ? "" : "s"} — accept them in Social → Requests.`
      : "No pending meeting requests.";
  } catch {
    host.textContent = "";
  }
}

async function fillInviteSection(profile) {
  const mount = overlayEl?.querySelector("[data-profile-invite]");
  if (!mount || !apiFn || profile?.is_self) return;
  let teams = [];
  try {
    const data = await apiFn("/api/teams");
    teams = (data.teams || []).filter((t) => t.can_invite);
  } catch {
    mount.hidden = true;
    mount.innerHTML = "";
    return;
  }
  if (!teams.length) {
    mount.hidden = true;
    mount.innerHTML = "";
    return;
  }
  const handle = String(profile.handle || "").replace(/^@/, "");
  const email = String(profile.email || "").trim();
  mount.hidden = false;
  mount.innerHTML = `
    <h3>Workspaces &amp; teams</h3>
    <p class="user-profile-meta">Add ${esc(profile.display_name || handle || "this person")} to a workspace you manage.</p>
    <div class="user-profile-invite-list">
      ${teams.map((t) => `
        <button type="button" class="user-profile-invite-team" data-profile-invite-team="${esc(t.id)}">
          Add to ${esc(t.name || "workspace")}
        </button>
      `).join("")}
    </div>
    <p class="user-profile-status-line" data-profile-invite-status></p>
  `;
  mount.querySelectorAll("[data-profile-invite-team]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const teamId = btn.getAttribute("data-profile-invite-team");
      const status = mount.querySelector("[data-profile-invite-status]");
      const payload = handle ? { handle } : (email ? { email } : null);
      if (!payload) {
        if (status) status.textContent = "This profile has no @handle or email to invite with.";
        return;
      }
      btn.disabled = true;
      if (status) status.textContent = "Adding…";
      try {
        let result = await apiFn(`/api/teams/${encodeURIComponent(teamId)}/invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, confirm_new_collaborator: false }),
        });
        if (result?.status === "needs_confirm") {
          const label = profile.display_name || handle || email;
          const ok = window.confirm(result.message || `Share this workspace with ${label}?`);
          if (!ok) {
            btn.disabled = false;
            if (status) status.textContent = "Canceled.";
            return;
          }
          result = await apiFn(`/api/teams/${encodeURIComponent(teamId)}/invite`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, confirm_new_collaborator: true }),
          });
        }
        const name = teams.find((t) => t.id === teamId)?.name || "workspace";
        if (result?.status === "already_member") {
          btn.textContent = `Already in ${name}`;
          if (status) status.textContent = "";
        } else {
          btn.textContent = `Added to ${name}`;
          if (status) status.textContent = result?.status === "invited" ? "Invite emailed." : "Added.";
        }
      } catch (err) {
        btn.disabled = false;
        if (status) status.textContent = err.message || "Could not add them.";
      }
    });
  });
}

async function mountReceiveOnProfile(card, profile) {
  try {
    const recv = await import("../marketplace/receive-payments.js?v=20260909-proftabs1&leakfix74");
    const payload = profile.receive_money || {};
    const slot = card.querySelector("[data-recv-pay-slot]");
    if (slot && payload.show_button) {
      slot.innerHTML = recv.receiveButtonHtml(payload, { compact: true });
      recv.bindReceiveButton(slot, payload, {
        handle: profile.handle || "",
        profileName: profile.display_name || profile.handle || "",
      });
    }
    if (profile.is_self && activeTab === "settings") {
      /* Receive money lives in Preferences → Payments — do not duplicate here. */
    }
  } catch {
    /* optional module */
  }
}

export function closeUserProfile() {
  compactMode = false;
  if (!overlayEl) return;
  setOverlayVisible(false);
  overlayEl.classList.remove("user-profile-overlay--compact");
  overlayEl.querySelector(".user-profile-card")?.classList.remove("user-profile-card--compact");
  const returnFocus = profileReturnFocus;
  profileReturnFocus = null;
  if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus?.({ preventScroll: true });
}

export async function openUserProfile({ userId, handle, openMeeting = false, tab = "", compact = false, anchor = null } = {}) {
  if (!apiFn) return;
  compactMode = !!compact;
  activeTab = tab || (openMeeting ? "calendar" : "about");
  const overlay = ensureOverlay();
  if (overlay.hidden || overlay.classList.contains("hidden")) profileReturnFocus = document.activeElement;
  overlay.classList.toggle("user-profile-overlay--compact", compactMode);
  setOverlayVisible(true);
  const card = overlayEl.querySelector(".user-profile-card");
  card.classList.toggle("user-profile-card--compact", compactMode);
  if (compactMode && anchor) {
    const rect = anchor.getBoundingClientRect?.() || anchor;
    const left = Math.max(8, Math.min((rect.left || 0), window.innerWidth - 320));
    const top = Math.max(8, (rect.bottom || 0) + 8);
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  } else {
    card.style.left = "";
    card.style.top = "";
  }
  if (!card.querySelector("[data-profile-close]")) {
    card.innerHTML = `<p class="user-profile-meta">Loading profile…</p>`;
  }
  card.focus({ preventScroll: true });
  const ctl = beginUserProfileFetch();
  try {
    let data;
    if (handle) {
      data = await apiFn(`/api/handles/${encodeURIComponent(String(handle).replace(/^@/, ""))}/profile`, { signal: ctl.signal });
    } else if (userId) {
      data = await apiFn(`/api/users/${encodeURIComponent(userId)}/profile`, { signal: ctl.signal });
    } else {
      throw new Error("Missing user");
    }
    if (ctl.signal.aborted) return;
    renderProfile(data.profile || data);
  } catch (err) {
    if (ctl.signal.aborted || err?.name === "AbortError") return;
    card.innerHTML = `<button type="button" class="user-profile-close" data-profile-close aria-label="Close">×</button>
      <p class="status error">${esc(err.message || "Profile not found")}</p>`;
  } finally {
    if (userProfileAbort === ctl) userProfileAbort = null;
  }
  if (!overlay.hidden && !overlay.classList.contains("hidden")) card.querySelector("[data-profile-close]")?.focus({ preventScroll: true });
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
  onOpenPreferences = opts.onOpenPreferences || null;
  onNeedAuth = opts.onNeedAuth || null;

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
