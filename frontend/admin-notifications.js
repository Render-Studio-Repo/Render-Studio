/**
 * Admin Recent Notifications — one-at-a-time pager over management alerts
 * (new-user signups + suggestion/bug feedback).
 */

function normalizeNewUser(item = {}) {
  return {
    key: `new_user:${item.id}`,
    id: item.id,
    channel: "new_user",
    kind: "new_user",
    created_at: item.created_at || item.updated_at || "",
    unread: !!item.unread,
    status: item.status || "new",
    title: "New user signup",
    body: `${item.user_name || "A new user"} created an account from ${item.source || "signup"}.`,
    user_name: item.user_name || "User",
    user_email: item.user_email || "",
    user_id: item.user_id || "",
    raw: item,
  };
}

function normalizeFeedback(item = {}) {
  const kind = item.kind === "bug" ? "bug" : "suggestion";
  return {
    key: `feedback:${item.id}`,
    id: item.id,
    channel: "feedback",
    kind,
    created_at: item.created_at || item.updated_at || "",
    unread: !!item.unread,
    status: item.status || "open",
    title: kind === "bug" ? "Bug report" : "Suggestion",
    body: item.message || "",
    user_name: item.user_name || "User",
    user_email: item.user_email || "",
    user_id: item.user_id || "",
    project_id: item.project_id || "",
    project_name: item.project_name || "",
    prompt_id: item.prompt_id || "",
    page_url: item.page_url || "",
    screenshots: Array.isArray(item.screenshots) ? item.screenshots : [],
    context: item.context || {},
    admin_messages: Array.isArray(item.admin_messages) ? item.admin_messages : [],
    raw: item,
  };
}

function sortByCreatedDesc(a, b) {
  return String(b.created_at || "").localeCompare(String(a.created_at || ""));
}

export function adminNotificationsSectionHtml() {
  return `
    <section class="admin-panel admin-panel--notifications" id="admin-section-notifications" data-admin-section="notifications">
      <div class="admin-agent-head">
        <div>
          <h3>Recent notifications</h3>
          <p class="muted small admin-panel-hint">Review signup alerts and user requests one at a time. Use Previous / Next or ← → keys.</p>
        </div>
        <button type="button" class="btn secondary btn-compact" id="admin-notifications-refresh">Refresh</button>
      </div>
      <div class="admin-notif-filters" role="tablist" aria-label="Notification filters">
        <button type="button" class="admin-notif-filter active" data-notif-filter="all" role="tab" aria-selected="true">All</button>
        <button type="button" class="admin-notif-filter" data-notif-filter="unread" role="tab" aria-selected="false">Unread</button>
        <button type="button" class="admin-notif-filter" data-notif-filter="new_user" role="tab" aria-selected="false">New users</button>
        <button type="button" class="admin-notif-filter" data-notif-filter="suggestion" role="tab" aria-selected="false">Suggestions</button>
        <button type="button" class="admin-notif-filter" data-notif-filter="bug" role="tab" aria-selected="false">Bugs</button>
      </div>
      <div class="admin-agent-stats" id="admin-notifications-stats">
        <span class="admin-pill"><strong>Loading…</strong></span>
      </div>
      <div class="admin-notif-pager" id="admin-notifications-pager">
        <p class="muted small">Loading notifications…</p>
      </div>
    </section>
  `;
}

export function createAdminNotificationsPager({
  api,
  escapeHtml,
  formatDate,
  formatNumber,
  authBlobUrl,
} = {}) {
  let host = null;
  let allItems = [];
  let filter = "all";
  let index = 0;
  let loading = false;
  let keyHandler = null;

  function filteredItems() {
    if (filter === "all") return allItems;
    if (filter === "unread") return allItems.filter((item) => item.unread);
    return allItems.filter((item) => item.kind === filter);
  }

  function clampIndex() {
    const items = filteredItems();
    if (!items.length) {
      index = 0;
      return;
    }
    index = Math.max(0, Math.min(index, items.length - 1));
  }

  function setFilter(next) {
    filter = next || "all";
    index = 0;
    host?.querySelectorAll("[data-notif-filter]").forEach((btn) => {
      const active = btn.getAttribute("data-notif-filter") === filter;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    render();
  }

  function renderStats() {
    const statsEl = host?.querySelector("#admin-notifications-stats");
    if (!statsEl) return;
    const unread = allItems.filter((item) => item.unread).length;
    const openish = allItems.filter((item) => {
      const s = String(item.status || "").toLowerCase();
      return s === "new" || s === "open";
    }).length;
    statsEl.innerHTML = `
      <span class="admin-pill"><strong>Total</strong><em>${formatNumber(allItems.length)}</em></span>
      <span class="admin-pill"><strong>Unread</strong><em>${formatNumber(unread)}</em></span>
      <span class="admin-pill"><strong>Open</strong><em>${formatNumber(openish)}</em></span>
      <span class="admin-pill"><strong>Showing</strong><em>${formatNumber(filteredItems().length)}</em></span>
    `;
  }

  function kindBadge(item) {
    if (item.kind === "bug") return "Bug";
    if (item.kind === "suggestion") return "Suggestion";
    return "Signup";
  }

  function renderCard(item, position, total) {
    const unread = item.unread ? `<span class="admin-feedback-unread">Unread</span>` : "";
    const shots = (item.screenshots || [])
      .map((shot, i) => {
        const url = typeof shot === "string" ? shot : shot?.url;
        if (!url) return "";
        return `<button type="button" class="admin-feedback-shot-link" data-notif-shot="${escapeHtml(url)}">Screenshot ${i + 1}</button>`;
      })
      .filter(Boolean)
      .join(" · ");
    const adminMessages = (item.admin_messages || [])
      .map((msg) => `
        <li>
          <strong>${escapeHtml(msg.admin_name || "Admin")}</strong>
          <span>${escapeHtml(msg.message || "")}</span>
          <small>${formatDate(msg.created_at)}</small>
        </li>
      `)
      .join("");

    let actions = "";
    if (item.channel === "new_user") {
      actions = `
        <button type="button" class="btn accent btn-compact" data-notif-action="contacted">Contacted</button>
        <button type="button" class="btn secondary btn-compact" data-notif-action="checked">Check</button>
        <button type="button" class="btn secondary btn-compact" data-notif-action="dismissed">Dismiss</button>
      `;
    } else {
      actions = `
        <button type="button" class="btn accent btn-compact" data-notif-action="ask">Ask user</button>
        <button type="button" class="btn accent btn-compact" data-notif-action="approved">Approve</button>
        <button type="button" class="btn secondary btn-compact" data-notif-action="checked">Check</button>
        <button type="button" class="btn secondary btn-compact" data-notif-action="denied">Deny</button>
      `;
    }

    const metaBits = [
      item.project_id ? `Project: ${escapeHtml(item.project_name || item.project_id)}` : "",
      item.prompt_id ? `Prompt: ${escapeHtml(item.prompt_id)}` : "",
      item.page_url ? `<a href="${escapeHtml(item.page_url)}" target="_blank" rel="noopener">Page</a>` : "",
      shots,
    ].filter(Boolean);

    return `
      <article class="admin-notif-card admin-feedback-row--${escapeHtml(item.kind)}" data-notif-key="${escapeHtml(item.key)}">
        <div class="admin-notif-card-nav">
          <button type="button" class="btn secondary btn-compact" data-notif-nav="prev" ${position <= 0 ? "disabled" : ""}>← Previous</button>
          <span class="admin-notif-position">${formatNumber(position + 1)} of ${formatNumber(total)}</span>
          <button type="button" class="btn secondary btn-compact" data-notif-nav="next" ${position >= total - 1 ? "disabled" : ""}>Next →</button>
        </div>
        <div class="admin-feedback-head">
          <div>
            <strong>${escapeHtml(item.title)} ${unread}</strong>
            <span class="muted small">${escapeHtml(item.user_name)} · ${escapeHtml(item.user_email)} · ${formatDate(item.created_at)}</span>
          </div>
          <span class="admin-feedback-status">${escapeHtml(kindBadge(item))} · ${escapeHtml(item.status || "")}</span>
        </div>
        <p class="admin-notif-body">${escapeHtml(item.body || "")}</p>
        ${metaBits.length ? `<p class="muted small">${metaBits.join(" · ")}</p>` : ""}
        ${adminMessages ? `<ul class="admin-feedback-admin-messages">${adminMessages}</ul>` : ""}
        <div class="admin-gs-pending-actions admin-notif-actions">${actions}</div>
        <p class="muted small admin-notif-jump">
          Also in lists:
          ${item.channel === "new_user"
            ? `<a href="#admin-section-new-users">New Users</a>`
            : `<a href="#admin-section-requests">Suggestions &amp; bugs</a>`}
        </p>
      </article>
    `;
  }

  function render() {
    const pager = host?.querySelector("#admin-notifications-pager");
    if (!pager) return;
    renderStats();
    const items = filteredItems();
    clampIndex();
    if (loading && !allItems.length) {
      pager.innerHTML = `<p class="muted small">Loading notifications…</p>`;
      return;
    }
    if (!items.length) {
      pager.innerHTML = `<p class="muted small">No notifications in this filter.</p>`;
      return;
    }
    pager.innerHTML = renderCard(items[index], index, items.length);
    bindCard(pager, items[index]);
  }

  function bindCard(pager, item) {
    pager.querySelectorAll("[data-notif-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = btn.getAttribute("data-notif-nav");
        if (dir === "prev") index = Math.max(0, index - 1);
        if (dir === "next") index = Math.min(filteredItems().length - 1, index + 1);
        render();
      });
    });
    pager.querySelectorAll("[data-notif-shot]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const url = btn.getAttribute("data-notif-shot");
        if (!url || !authBlobUrl) return;
        btn.disabled = true;
        try {
          const blobUrl = await authBlobUrl(url);
          window.open(blobUrl, "_blank", "noopener");
        } catch (err) {
          alert(err.message || "Could not open screenshot");
        } finally {
          btn.disabled = false;
        }
      });
    });
    pager.querySelectorAll("[data-notif-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-notif-action");
        if (!action || !item?.id) return;
        btn.disabled = true;
        try {
          if (item.channel === "new_user") {
            await api(`/api/admin/new-users/${encodeURIComponent(item.id)}`, {
              method: "POST",
              body: JSON.stringify({ status: action }),
            });
          } else if (action === "ask") {
            const text = window.prompt("Message this user from Render Studio support:");
            if (!text || !text.trim()) {
              btn.disabled = false;
              return;
            }
            await api(`/api/admin/feedback/requests/${encodeURIComponent(item.id)}/message`, {
              method: "POST",
              body: JSON.stringify({ message: text.trim() }),
            });
          } else {
            await api(`/api/admin/feedback/requests/${encodeURIComponent(item.id)}`, {
              method: "POST",
              body: JSON.stringify({ status: action }),
            });
          }
          await refresh({ keepPosition: true });
        } catch (err) {
          btn.disabled = false;
          alert(err.message || "Action failed");
        }
      });
    });
  }

  async function refresh({ keepPosition = false } = {}) {
    if (!host) return;
    loading = true;
    if (!keepPosition) render();
    const prevKey = keepPosition ? filteredItems()[index]?.key : null;
    try {
      const [users, feedback] = await Promise.all([
        api("/api/admin/new-users?status=all&limit=200&mark_read=false"),
        api("/api/admin/feedback/requests?status=all&limit=200&mark_read=false"),
      ]);
      allItems = [
        ...(users.alerts || []).map(normalizeNewUser),
        ...(feedback.requests || []).map(normalizeFeedback),
      ].sort(sortByCreatedDesc);
      if (prevKey) {
        const nextItems = filteredItems();
        const found = nextItems.findIndex((item) => item.key === prevKey);
        index = found >= 0 ? found : Math.min(index, Math.max(0, nextItems.length - 1));
      }
    } catch (err) {
      const pager = host.querySelector("#admin-notifications-pager");
      if (pager) {
        pager.innerHTML = `<p class="muted small">Could not load notifications: ${escapeHtml(err.message || "error")}</p>`;
      }
      loading = false;
      return;
    }
    loading = false;
    render();
  }

  function onKeyDown(ev) {
    if (!host || host.closest(".hidden")) return;
    const section = host.querySelector("#admin-section-notifications");
    if (!section) return;
    // Only when the notifications section is roughly in view / tab active
    const tab = host.querySelector('[data-admin-view="notifications"].active');
    const rect = section.getBoundingClientRect();
    const inView = rect.top < window.innerHeight && rect.bottom > 80;
    if (!tab && !inView) return;
    if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/i.test(ev.target.tagName)) return;
    if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      index = Math.max(0, index - 1);
      render();
    } else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      index = Math.min(filteredItems().length - 1, index + 1);
      render();
    }
  }

  function mount(root) {
    host = root;
    root.querySelector("#admin-notifications-refresh")?.addEventListener("click", () => {
      void refresh();
    });
    root.querySelectorAll("[data-notif-filter]").forEach((btn) => {
      btn.addEventListener("click", () => setFilter(btn.getAttribute("data-notif-filter") || "all"));
    });
    if (keyHandler) window.removeEventListener("keydown", keyHandler);
    keyHandler = onKeyDown;
    window.addEventListener("keydown", keyHandler);
    void refresh();
  }

  function destroy() {
    if (keyHandler) window.removeEventListener("keydown", keyHandler);
    keyHandler = null;
    host = null;
  }

  return { mount, refresh, destroy, sectionHtml: adminNotificationsSectionHtml };
}
