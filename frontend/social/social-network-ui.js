/** Social hub — people online, public rooms, teams, friends, and incoming requests. */

import * as THREE from "three";
import {
  applyAvatarAction,
  avatarSettingsLines,
  buildProceduralHumanoid,
  canLinkHorizon,
  detectXrDevice,
  deviceLabelFromUser,
  HORIZON_AVATAR_NOTE,
  loadAvatarSpec,
  saveAvatarSpec,
  tickAvatarPreview,
  xrHeadsetFromUa,
} from "../xr/xr-avatar.js?v=roboticsworkspace3";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function initial(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

export function createSocialNetworkUI({
  api,
  buttonEl = null,
  getProjectId = () => null,
  getWorkspaceId = () => null,
  onShareKey = null,
  onStatus = null,
  onJoinPublicRoom = null,
  onLeavePublicRoom = null,
  onEnterPublicRoom = null,
  onOpenWorkspace = null,
  onOpenUserProfile = null,
  onRequestsChanged = null,
  onOpened = null,
  isPublicRoomJoined = () => false,
  getLocalUserId = () => "",
} = {}) {
  let overlay = null;
  let avatarSheetOpen = false;
  let avatarPreview = null;
  let avatarRaf = 0;
  let open = false;
  let loading = false;
  let tab = "people";
  let filterWorkspace = "all";
  let searchQ = "";
  let searchHits = [];
  let searchTimer = 0;
  let pollTimer = 0;
  let badgeTimer = 0;
  let data = {
    people: [],
    workspaces: [],
    online_count: 0,
    room: { count: 0, users: [], name: "Public room" },
    requests: { project_shares: [], workspace_invites: [], friend_requests: [], outgoing_friends: [], count: 0 },
  };

  function setStatus(kind, message) {
    try { onStatus?.(kind, message); } catch { /* ignore */ }
  }

  function requestCount() {
    const r = data.requests || {};
    return Number(r.count)
      || ((r.project_shares || []).length + (r.workspace_invites || []).length + (r.friend_requests || []).length + (r.meeting_requests || []).length);
  }

  function setButtonBadge(n) {
    if (!buttonEl) return;
    let pip = buttonEl.querySelector("[data-sn-badge]");
    if (!pip) {
      pip = document.createElement("span");
      pip.dataset.snBadge = "1";
      pip.className = "social-network-btn-badge hidden";
      buttonEl.appendChild(pip);
    }
    const count = Number(n) || 0;
    pip.textContent = count > 99 ? "99+" : String(count);
    pip.classList.toggle("hidden", count <= 0);
    buttonEl.classList.toggle("has-requests", count > 0);
  }

  function avatarHtml(person) {
    const url = person?.avatar_url || (person?.id ? `/api/users/${encodeURIComponent(person.id)}/avatar` : "");
    const letter = initial(person?.display_name || person?.email);
    if (url) {
      return `<span class="social-network-avatar"><img src="${esc(url)}" alt="" width="28" height="28" onerror="this.remove()">${esc(letter)}</span>`;
    }
    return `<span class="social-network-avatar" aria-hidden="true">${esc(letter)}</span>`;
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "social-network-overlay";
    overlay.className = "social-network-overlay social-network-overlay--popup hidden";
    overlay.innerHTML = `
      <div class="social-network-panel social-network-panel--hub social-network-panel--popup" role="dialog" aria-label="Social">
        <header class="social-network-head">
          <div>
            <strong>Social</strong>
            <span class="social-network-sub" data-sn-online-label>People in this room</span>
          </div>
          <div class="social-network-head-meta">
            <span class="social-network-online-pill" data-sn-online-pill>0 online</span>
            <button type="button" class="btn secondary btn-compact" data-sn-avatar>Avatar</button>
            <button type="button" class="social-network-close" data-sn-close aria-label="Close">×</button>
          </div>
        </header>
        <section class="social-network-room-now" aria-label="Who is in this room">
          <p class="muted small">Who is in this room right now.</p>
          <div id="social-room-list" class="social-room-list" aria-live="polite"></div>
        </section>
        <nav class="social-network-tabs" role="tablist" aria-label="Social sections">
          <button type="button" class="social-network-tab is-active" data-sn-tab="people" role="tab" aria-selected="true">People</button>
          <button type="button" class="social-network-tab" data-sn-tab="rooms" role="tab" aria-selected="false">Rooms</button>
          <button type="button" class="social-network-tab" data-sn-tab="teams" role="tab" aria-selected="false">Teams</button>
          <button type="button" class="social-network-tab" data-sn-tab="requests" role="tab" aria-selected="false">
            Requests <span class="social-network-tab-count hidden" data-sn-req-count></span>
          </button>
        </nav>
        <div class="social-network-toolbar">
          <label class="social-network-search">
            <input type="search" data-sn-search placeholder="Search people, @handle, or email…" spellcheck="false" autocomplete="off" />
          </label>
          <select data-sn-workspace aria-label="Filter workspace">
            <option value="all">All teams</option>
          </select>
        </div>
        <form class="social-network-add" data-sn-add>
          <input type="text" data-sn-add-input placeholder="Add by email or @handle" spellcheck="false" autocomplete="off" />
          <button type="submit" class="btn accent btn-compact">Add</button>
        </form>
        <div class="social-network-search-hits hidden" data-sn-hits></div>
        <div class="social-network-body" data-sn-body>
          <p class="muted small">Loading…</p>
        </div>
        <footer class="social-network-foot">
          <button type="button" class="btn secondary btn-compact" data-sn-manage-keys>Manage AI Keys</button>
          <button type="button" class="btn secondary btn-compact" data-sn-refresh>Refresh</button>
        </footer>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-sn-close]")) close();
    });
    overlay.querySelectorAll("[data-sn-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        tab = btn.dataset.snTab || "people";
        syncTabs();
        renderList();
      });
    });
    overlay.querySelector("[data-sn-search]")?.addEventListener("input", (e) => {
      searchQ = e.target.value || "";
      renderList();
      scheduleSearch();
    });
    overlay.querySelector("[data-sn-workspace]")?.addEventListener("change", async (e) => {
      filterWorkspace = e.target.value || "all";
      await refresh();
    });
    overlay.querySelector("[data-sn-add]")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await addPerson();
    });
    overlay.querySelector("[data-sn-refresh]")?.addEventListener("click", () => void refresh());
    overlay.querySelector("[data-sn-manage-keys]")?.addEventListener("click", () => {
      close();
      try { onShareKey?.(); } catch { /* ignore */ }
      document.getElementById("btn-ai-key-menu")?.click();
    });
    overlay.querySelector("[data-sn-body]")?.addEventListener("click", (e) => {
      void onBodyClick(e);
    });
    overlay.querySelector("[data-sn-hits]")?.addEventListener("click", (e) => {
      void onBodyClick(e);
    });
    overlay.querySelector("[data-sn-avatar]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAvatarSheet();
    });
    return overlay;
  }

  function localAvatarUserId() {
    try { return String(getLocalUserId?.() || "").trim(); } catch { return ""; }
  }

  function stopAvatarPreview() {
    if (avatarRaf) cancelAnimationFrame(avatarRaf);
    avatarRaf = 0;
    const preview = avatarPreview;
    avatarPreview = null;
    // Avatar geometries are shared with live peers; only these materials and
    // this preview renderer belong to the sheet being closed.
    const materials = new Set();
    preview?.figure?.traverse?.(node => {
      for (const material of [].concat(node.material || [])) materials.add(material);
    });
    for (const material of materials) { try { material.dispose?.(); } catch (_) {} }
    try { preview?.renderer?.dispose?.(); } catch (_) {}
    try { preview?.renderer?.forceContextLoss?.(); } catch (_) {}
    try { preview?.renderer?.domElement?.remove?.(); } catch (_) {}
  }

  function startAvatarPreview(host, spec) {
    stopAvatarPreview();
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(220, 260);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 220 / 260, 0.05, 8);
    camera.position.set(0.35, 0.15, 1.15);
    camera.lookAt(0, -0.05, 0);
    scene.add(new THREE.HemisphereLight(0xf8fafc, 0x334155, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(0.4, 0.8, 0.6);
    scene.add(key);
    const figure = buildProceduralHumanoid(THREE, spec, {
      prop: xrHeadsetFromUa({ userAgent: navigator.userAgent }).prop,
    });
    figure.position.y = -0.2;
    scene.add(figure);
    avatarPreview = { renderer, scene, camera, figure };
    const loop = () => {
      if (!avatarPreview) return;
      tickAvatarPreview({ visible: true, userData: { figure: avatarPreview.figure } }, 0.02);
      avatarPreview.renderer.render(avatarPreview.scene, avatarPreview.camera);
      avatarRaf = requestAnimationFrame(loop);
    };
    loop();
  }

  function renderAvatarSheet() {
    const sheet = overlay?.querySelector("[data-sn-avatar-sheet]");
    if (!sheet) return;
    const spec = loadAvatarSpec(localAvatarUserId());
    const quest = canLinkHorizon({ userAgent: navigator.userAgent });
    const lines = avatarSettingsLines(spec, { quest });
    const selfDevice = detectXrDevice({ userAgent: navigator.userAgent }).label;
    sheet.innerHTML = `
      <header>
        <strong>Your avatar</strong>
        <button type="button" class="social-network-close" data-sn-avatar-close aria-label="Close avatar">×</button>
      </header>
      <p class="muted small">Low-poly look others see in VR. ${selfDevice ? `This device: ${esc(selfDevice)}.` : ""}</p>
      <div class="social-avatar-preview" data-sn-avatar-preview></div>
      <div class="social-avatar-actions">
        ${lines.filter((l) => l.id).map((l) => `
          <button type="button" class="btn ${l.active ? "accent" : "secondary"} btn-compact" data-sn-avatar-act="${esc(l.id)}">${esc(l.label)}</button>
        `).join("")}
      </div>
      <p class="muted small social-avatar-note">${spec.source === "horizon" ? esc(HORIZON_AVATAR_NOTE) : "Ready Player Me style is a compact stand-in (no 50MB rig). Horizon cannot import the live Meta mesh here."}</p>
    `;
    startAvatarPreview(sheet.querySelector("[data-sn-avatar-preview]"), spec);
    sheet.querySelector("[data-sn-avatar-close]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      closeAvatarSheet();
    });
    sheet.querySelectorAll("[data-sn-avatar-act]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const { spec: next, note } = applyAvatarAction(loadAvatarSpec(localAvatarUserId()), btn.dataset.snAvatarAct, {
          userAgent: navigator.userAgent,
          requireQuest: btn.dataset.snAvatarAct === "avatar-source-horizon",
        });
        saveAvatarSpec(localAvatarUserId(), next);
        if (note) setStatus("ok", note.slice(0, 120));
        renderAvatarSheet();
      });
    });
  }

  function openAvatarSheet() {
    ensureOverlay();
    let sheet = overlay.querySelector("[data-sn-avatar-sheet]");
    if (!sheet) {
      sheet = document.createElement("aside");
      sheet.className = "social-avatar-sheet hidden";
      sheet.dataset.snAvatarSheet = "1";
      (overlay.querySelector(".social-network-panel") || overlay).appendChild(sheet);
    }
    avatarSheetOpen = true;
    sheet.classList.remove("hidden");
    renderAvatarSheet();
  }

  function closeAvatarSheet() {
    avatarSheetOpen = false;
    overlay?.querySelector("[data-sn-avatar-sheet]")?.classList.add("hidden");
    stopAvatarPreview();
  }

  function syncTabs() {
    overlay?.querySelectorAll("[data-sn-tab]").forEach((btn) => {
      const on = btn.dataset.snTab === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    const countEl = overlay?.querySelector("[data-sn-req-count]");
    const n = requestCount();
    if (countEl) {
      countEl.textContent = String(n);
      countEl.classList.toggle("hidden", n <= 0);
    }
    const pill = overlay?.querySelector("[data-sn-online-pill]");
    const online = Number(data.online_count || 0);
    if (pill) pill.textContent = `${online} online`;
    const sub = overlay?.querySelector("[data-sn-online-label]");
    if (sub) sub.textContent = `${online} online · ${Number(data.room?.count || 0)} in public room`;
    setButtonBadge(n);
  }

  function matchesQuery(person) {
    const q = searchQ.trim().toLowerCase().replace(/^@+/, "");
    if (!q) return true;
    const blob = [person.display_name, person.email, person.handle, person.project_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  }

  function personRow(p, { friendPending = false } = {}) {
    const handle = p.handle ? `@${String(p.handle).replace(/^@/, "")}` : "";
    const spaces = (p.workspaces || []).map((w) => w.name).filter(Boolean).slice(0, 2).join(", ");
    const outgoing = (data.requests?.outgoing_friends || []).some((r) => r?.user?.id === p.id);
    return `
      <article class="social-network-person${p.online ? " is-online" : ""}">
        <button type="button" class="social-network-person-main" data-sn-profile="${esc(p.id)}">
          ${avatarHtml(p)}
          <div>
            <div class="social-network-person-name">
              ${esc(p.display_name || p.email || "User")}
              ${handle ? `<em>${esc(handle)}</em>` : ""}
              ${deviceLabelFromUser(p) ? `<span class="social-network-device">${esc(deviceLabelFromUser(p))}</span>` : ""}
              <span class="social-network-presence">${p.online ? "Online" : "Away"}</span>
            </div>
            <div class="social-network-person-meta">${esc(p.email || "")}${spaces ? ` · ${esc(spaces)}` : ""}</div>
            ${p.status_text ? `<div class="social-network-person-status">${esc(p.status_icon || "")} ${esc(p.status_text)}</div>` : ""}
          </div>
        </button>
        <div class="social-network-person-actions">
          ${p.is_friend
            ? `<span class="social-network-friend-badge">Friends</span>`
            : outgoing || friendPending
              ? `<span class="social-network-friend-badge is-pending">Requested</span>`
              : `<button type="button" class="btn secondary btn-compact" data-sn-friend data-user-id="${esc(p.id)}">Add friend</button>`}
          <button type="button" class="btn secondary btn-compact" data-sn-invite
            data-user-id="${esc(p.id)}" data-email="${esc(p.email || "")}" data-handle="${esc(p.handle || "")}">
            Invite
          </button>
          ${p.is_self ? "" : `<button type="button" class="btn secondary btn-compact" data-sn-meet data-user-id="${esc(p.id)}">Meet</button>`}
        </div>
      </article>`;
  }

  function renderHits() {
    const host = overlay?.querySelector("[data-sn-hits]");
    if (!host) return;
    const q = searchQ.trim();
    if (!q || q.length < 2 || !searchHits.length) {
      host.classList.add("hidden");
      host.innerHTML = "";
      return;
    }
    const known = new Set((data.people || []).map((p) => p.id));
    const extra = searchHits.filter((p) => p?.id && !known.has(p.id));
    if (!extra.length) {
      host.classList.add("hidden");
      host.innerHTML = "";
      return;
    }
    host.classList.remove("hidden");
    host.innerHTML = `<h4>Search results</h4>${extra.map((p) => personRow(p)).join("")}`;
  }

  function renderPeople() {
    const people = (data.people || []).filter(matchesQuery);
    const friends = people.filter((p) => p.is_friend);
    const online = people.filter((p) => p.online);
    const rest = people.filter((p) => !p.is_friend);
    if (!people.length && !searchHits.length) {
      return `<p class="social-network-empty">No people yet. Search or add someone by email / @handle.</p>`;
    }
    return `
      ${online.length ? `<div class="social-network-section"><h4>Online · ${online.length}</h4>${online.map((p) => personRow(p)).join("")}</div>` : ""}
      ${friends.length ? `<div class="social-network-section"><h4>Friends · ${friends.length}</h4>${friends.map((p) => personRow(p)).join("")}</div>` : ""}
      ${rest.length ? `<div class="social-network-section"><h4>Everyone · ${rest.length}</h4>${rest.map((p) => personRow(p)).join("")}</div>` : ""}
    `;
  }

  function renderRooms() {
    const room = data.room || {};
    const users = (room.users || []).filter((u) => !u.is_self && matchesQuery(u));
    const joined = !!isPublicRoomJoined?.();
    const count = Number(room.count || users.length || 0);
    const scenes = Array.isArray(room.scenes) && room.scenes.length
      ? room.scenes
      : [
          { id: "white", label: "White room" },
          { id: "warehouse", label: "Warehouse" },
        ];
    const sceneChips = scenes.map((s) => `
      <button type="button" class="btn secondary btn-compact" data-sn-room-scene="${esc(s.id)}" title="Join public room · ${esc(s.label)}">
        ${esc(s.label || s.id)}
      </button>`).join("");
    return `
      <article class="social-network-room">
        <div class="social-network-room-head">
          <div>
            <h4>${esc(room.name || "Public VR room")}</h4>
            <p class="muted small">Same public room as VR — join from here, then enter headset. Scenes: White room and Warehouse.</p>
          </div>
          <span class="social-network-online-pill">${count} here</span>
        </div>
        <div class="social-network-room-actions">
          ${joined
            ? `<button type="button" class="btn secondary btn-compact" data-sn-room-leave>Leave room</button>
               <button type="button" class="btn accent btn-compact" data-sn-room-enter>Enter VR</button>`
            : `<button type="button" class="btn accent btn-compact" data-sn-room-join>Join room</button>
               <button type="button" class="btn secondary btn-compact" data-sn-room-enter>Join &amp; enter VR</button>`}
        </div>
        <div class="social-network-section">
          <h4>Public room scenes</h4>
          <p class="muted small">Pick a scene before Enter VR, or Change scene inside the headset.</p>
          <div class="social-network-room-actions">${sceneChips}</div>
        </div>
        ${users.length
          ? `<div class="social-network-section"><h4>People in the room</h4>${users.map((u) => personRow({
              ...u,
              online: true,
              email: u.email || "",
              workspaces: u.project_name ? [{ name: u.project_name }] : [],
            })).join("")}</div>`
          : `<p class="social-network-empty">Nobody else is in the public room yet.</p>`}
      </article>
    `;
  }

  function renderTeams() {
    const q = searchQ.trim().toLowerCase();
    const teams = (data.workspaces || []).filter((w) => {
      if (!q) return true;
      return String(w.name || "").toLowerCase().includes(q);
    });
    const current = getWorkspaceId?.() || "";
    if (!teams.length) {
      return `<p class="social-network-empty">No teams yet. Create or accept a workspace invite from Requests.</p>`;
    }
    return `<div class="social-network-section"><h4>Teams · ${teams.length}</h4>${teams.map((w) => `
      <article class="social-network-team${w.id === current ? " is-current" : ""}">
        <div>
          <div class="social-network-person-name">${esc(w.name || "Workspace")}</div>
          <div class="social-network-person-meta">${esc(w.role || "member")} · ${Number(w.member_count || 0)} people</div>
        </div>
        <button type="button" class="btn ${w.id === current ? "secondary" : "accent"} btn-compact" data-sn-open-team="${esc(w.id)}" ${w.id === current ? "disabled" : ""}>
          ${w.id === current ? "Current" : "Open"}
        </button>
      </article>
    `).join("")}</div>`;
  }

  function requestCard({ eyebrow, title, body, accept, decline, extra = "" }) {
    return `
      <article class="social-network-request">
        <p class="social-network-request-eyebrow">${esc(eyebrow)}</p>
        <p class="social-network-request-title">${title}</p>
        ${body ? `<p class="muted small">${body}</p>` : ""}
        <div class="social-network-request-actions">
          <button type="button" class="btn secondary btn-compact" ${decline}>Decline</button>
          <button type="button" class="btn accent btn-compact" ${accept}>Accept</button>
        </div>
        ${extra}
      </article>`;
  }

  function renderRequests() {
    const r = data.requests || {};
    const q = searchQ.trim().toLowerCase();
    const matchText = (...parts) => {
      if (!q) return true;
      return parts.filter(Boolean).join(" ").toLowerCase().includes(q);
    };
    const projects = (r.project_shares || []).filter((inv) => matchText(inv.project_name, inv.inviter_name, inv.invited_by_name));
    const workspaces = (r.workspace_invites || []).filter((inv) => matchText(inv.team_name, inv.inviter_name));
    const friends = (r.friend_requests || []).filter((inv) => matchText(inv.user?.display_name, inv.user?.email, inv.user?.handle));
    const meetings = (r.meeting_requests || []).filter((inv) => matchText(inv.from_user?.display_name, inv.from_user?.handle, inv.message, inv.proposed_time));
    const outgoing = (r.outgoing_friends || []).filter((inv) => matchText(inv.user?.display_name, inv.user?.email, inv.user?.handle));
    if (!projects.length && !workspaces.length && !friends.length && !meetings.length && !outgoing.length) {
      return `<p class="social-network-empty">No pending requests. Project shares, workspace invites, friend requests, and meeting requests land here.</p>`;
    }
    const blocks = [];
    if (projects.length) {
      blocks.push(`<div class="social-network-section"><h4>Project invites · ${projects.length}</h4>${projects.map((inv) => {
        const name = inv.project_name || inv.project_id || "a project";
        const who = inv.inviter_name || inv.invited_by_name || "Someone";
        return requestCard({
          eyebrow: "Project share",
          title: `<strong>${esc(who)}</strong> shared <strong>${esc(name)}</strong> with you`,
          accept: `data-sn-accept-share="${esc(inv.invite_token || "")}"`,
          decline: `data-sn-decline-share="${esc(inv.invite_token || "")}"`,
        });
      }).join("")}</div>`);
    }
    if (workspaces.length) {
      blocks.push(`<div class="social-network-section"><h4>Workspace invites · ${workspaces.length}</h4>${workspaces.map((inv) => {
        const who = inv.inviter_name || "Someone";
        const team = inv.team_name || "a workspace";
        return requestCard({
          eyebrow: "Team",
          title: `<strong>${esc(who)}</strong> invited you to <strong>${esc(team)}</strong>`,
          accept: `data-sn-accept-team="${esc(inv.id)}"` ,
          decline: `data-sn-decline-team="${esc(inv.id)}"`,
        });
      }).join("")}</div>`);
    }
    if (friends.length) {
      blocks.push(`<div class="social-network-section"><h4>Friend requests · ${friends.length}</h4>${friends.map((inv) => {
        const who = inv.user?.display_name || inv.user?.email || "Someone";
        return requestCard({
          eyebrow: "Friend",
          title: `<strong>${esc(who)}</strong> wants to be friends`,
          accept: `data-sn-accept-friend="${esc(inv.id)}"`,
          decline: `data-sn-decline-friend="${esc(inv.id)}"`,
        });
      }).join("")}</div>`);
    }
    if (meetings.length) {
      blocks.push(`<div class="social-network-section"><h4>Meeting requests · ${meetings.length}</h4>${meetings.map((inv) => {
        const who = inv.from_user?.display_name || inv.from_user?.email || "Someone";
        const when = inv.starts_at && inv.ends_at
          ? `${inv.starts_at} → ${inv.ends_at}`
          : (inv.proposed_time || "a proposed time");
        return requestCard({
          eyebrow: "Meeting",
          title: `<strong>${esc(who)}</strong> requested a meeting`,
          body: `${esc(when)}${inv.message ? ` · ${esc(inv.message)}` : ""}`,
          accept: `data-sn-accept-meeting="${esc(inv.id)}"`,
          decline: `data-sn-decline-meeting="${esc(inv.id)}"`,
        });
      }).join("")}</div>`);
    }
    if (outgoing.length) {
      blocks.push(`<div class="social-network-section"><h4>Sent · ${outgoing.length}</h4>
        <p class="muted small">Waiting for them to accept.</p>
        ${outgoing.map((inv) => `
          <article class="social-network-person">
            <div class="social-network-person-main">
              ${avatarHtml(inv.user || {})}
              <div>
                <div class="social-network-person-name">${esc(inv.user?.display_name || "User")}</div>
                <div class="social-network-person-meta">Friend request pending</div>
              </div>
            </div>
          </article>`).join("")}
      </div>`);
    }
    return blocks.join("");
  }

  function renderList() {
    const body = overlay?.querySelector("[data-sn-body]");
    if (!body) return;
    syncTabs();
    renderHits();
    if (loading && !(data.people || []).length) {
      body.innerHTML = `<p class="muted small">Loading…</p>`;
      return;
    }
    if (tab === "rooms") body.innerHTML = renderRooms();
    else if (tab === "teams") body.innerHTML = renderTeams();
    else if (tab === "requests") body.innerHTML = renderRequests();
    else body.innerHTML = renderPeople();
  }

  async function onBodyClick(e) {
    const profile = e.target.closest("[data-sn-profile]");
    if (profile?.dataset.snProfile) {
      try { onOpenUserProfile?.({ userId: profile.dataset.snProfile }); } catch { /* ignore */ }
      return;
    }
    const meetBtn = e.target.closest("[data-sn-meet]");
    if (meetBtn?.dataset.userId) {
      try { onOpenUserProfile?.({ userId: meetBtn.dataset.userId, tab: "calendar", openMeeting: true }); } catch { /* ignore */ }
      return;
    }
    const friendBtn = e.target.closest("[data-sn-friend]");
    if (friendBtn) {
      friendBtn.disabled = true;
      try {
        const result = await api("/api/social/friends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: friendBtn.dataset.userId }),
        });
        setStatus("ok", result?.status === "pending" ? "Friend request sent." : "You're friends now.");
        await refresh();
      } catch (err) {
        setStatus("error", err.message || "Could not add friend");
        friendBtn.disabled = false;
      }
      return;
    }
    const inviteBtn = e.target.closest("[data-sn-invite]");
    if (inviteBtn) {
      inviteBtn.disabled = true;
      try {
        await api("/api/social/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: inviteBtn.dataset.userId || undefined,
            email: inviteBtn.dataset.email || undefined,
            handle: inviteBtn.dataset.handle || undefined,
            team_id: getWorkspaceId?.() || undefined,
            project_id: getProjectId?.() || undefined,
          }),
        });
        setStatus("ok", "Invite sent.");
        await refresh();
      } catch (err) {
        setStatus("error", err.message || "Could not invite");
        inviteBtn.disabled = false;
      }
      return;
    }
    if (e.target.closest("[data-sn-room-join]")) {
      try { onJoinPublicRoom?.(); } catch { /* ignore */ }
      setStatus("ok", "Joined the public VR room.");
      await refresh();
      return;
    }
    const sceneBtn = e.target.closest("[data-sn-room-scene]");
    if (sceneBtn?.dataset.snRoomScene) {
      const sceneId = String(sceneBtn.dataset.snRoomScene || "white");
      try {
        localStorage.setItem("render3d:xrSceneKind", sceneId);
      } catch { /* ignore */ }
      try {
        if (!isPublicRoomJoined?.()) onJoinPublicRoom?.();
      } catch { /* ignore */ }
      setStatus("ok", sceneId === "warehouse"
        ? "Public room · Warehouse selected. Enter VR to load it."
        : `Public room · ${sceneId} selected.`);
      await refresh();
      return;
    }
    if (e.target.closest("[data-sn-room-leave]")) {
      try { onLeavePublicRoom?.(); } catch { /* ignore */ }
      setStatus("ok", "Left the public room.");
      await refresh();
      return;
    }
    if (e.target.closest("[data-sn-room-enter]")) {
      try {
        if (!isPublicRoomJoined?.()) onJoinPublicRoom?.();
        close();
        onEnterPublicRoom?.();
      } catch { /* ignore */ }
      return;
    }
    const teamBtn = e.target.closest("[data-sn-open-team]");
    if (teamBtn?.dataset.snOpenTeam) {
      try { onOpenWorkspace?.(teamBtn.dataset.snOpenTeam); } catch { /* ignore */ }
      close();
      return;
    }
    const acceptShare = e.target.closest("[data-sn-accept-share]");
    if (acceptShare) {
      await resolveShare(acceptShare.dataset.snAcceptShare, "accept", acceptShare);
      return;
    }
    const declineShare = e.target.closest("[data-sn-decline-share]");
    if (declineShare) {
      await resolveShare(declineShare.dataset.snDeclineShare, "decline", declineShare);
      return;
    }
    const acceptTeam = e.target.closest("[data-sn-accept-team]");
    if (acceptTeam) {
      await resolveTeam(acceptTeam.dataset.snAcceptTeam, "accept", acceptTeam);
      return;
    }
    const declineTeam = e.target.closest("[data-sn-decline-team]");
    if (declineTeam) {
      await resolveTeam(declineTeam.dataset.snDeclineTeam, "decline", declineTeam);
      return;
    }
    const acceptFriend = e.target.closest("[data-sn-accept-friend]");
    if (acceptFriend) {
      await resolveFriend(acceptFriend.dataset.snAcceptFriend, "accept", acceptFriend);
      return;
    }
    const declineFriend = e.target.closest("[data-sn-decline-friend]");
    if (declineFriend) {
      await resolveFriend(declineFriend.dataset.snDeclineFriend, "decline", declineFriend);
      return;
    }
    const acceptMeeting = e.target.closest("[data-sn-accept-meeting]");
    if (acceptMeeting) {
      await resolveMeeting(acceptMeeting.dataset.snAcceptMeeting, "accept", acceptMeeting);
      return;
    }
    const declineMeeting = e.target.closest("[data-sn-decline-meeting]");
    if (declineMeeting) {
      await resolveMeeting(declineMeeting.dataset.snDeclineMeeting, "decline", declineMeeting);
    }
  }

  async function resolveShare(token, action, btn) {
    if (!token) return;
    if (btn) btn.disabled = true;
    try {
      await api(`/api/projects/share-invites/${encodeURIComponent(token)}/${action}`, { method: "POST" });
      setStatus("ok", action === "accept" ? "Project added to your files." : "Project invite declined.");
      notifyRequestsChanged();
      await refresh();
    } catch (err) {
      setStatus("error", err.message || `Could not ${action} project invite`);
      if (btn) btn.disabled = false;
    }
  }

  async function resolveTeam(id, action, btn) {
    if (!id) return;
    if (btn) btn.disabled = true;
    try {
      await api(`/api/teams/invites/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      setStatus("ok", action === "accept" ? "Joined workspace." : "Workspace invite declined.");
      notifyRequestsChanged();
      await refresh();
    } catch (err) {
      setStatus("error", err.message || `Could not ${action} workspace invite`);
      if (btn) btn.disabled = false;
    }
  }

  async function resolveFriend(id, action, btn) {
    if (!id) return;
    if (btn) btn.disabled = true;
    try {
      await api(`/api/social/friend-requests/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      setStatus("ok", action === "accept" ? "You're friends now." : "Friend request declined.");
      await refresh();
    } catch (err) {
      setStatus("error", err.message || `Could not ${action} friend request`);
      if (btn) btn.disabled = false;
    }
  }

  async function resolveMeeting(id, action, btn) {
    if (!id) return;
    if (btn) btn.disabled = true;
    try {
      const data = await api(`/api/meeting-requests/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      if (action === "accept") {
        const meet = data?.request?.meet_url;
        setStatus("ok", meet ? `Meeting accepted. Google Meet: ${meet}` : "Meeting accepted. Calendar invite sent.");
      } else {
        setStatus("ok", "Meeting declined.");
      }
      notifyRequestsChanged();
      await refresh();
    } catch (err) {
      setStatus("error", err.message || `Could not ${action} meeting`);
      if (btn) btn.disabled = false;
    }
  }

  function scheduleSearch() {
    window.clearTimeout(searchTimer);
    const q = searchQ.trim();
    if (q.length < 2) {
      searchHits = [];
      renderHits();
      return;
    }
    searchTimer = window.setTimeout(() => void runSearch(q), 220);
  }

  async function runSearch(q) {
    if (!api) return;
    try {
      const teamId = getWorkspaceId?.() || "";
      const qs = new URLSearchParams({ q });
      if (teamId) qs.set("team_id", teamId);
      const result = await api(`/api/teams/invite-lookup?${qs.toString()}`);
      const matches = result.matches || (result.user ? [result.user] : []);
      searchHits = (Array.isArray(matches) ? matches : []).map((u) => ({
        id: u.id,
        display_name: u.display_name || u.email || "User",
        email: u.email,
        handle: u.handle,
        avatar_url: u.avatar_url,
        is_friend: (data.friend_ids || []).includes(u.id),
        online: false,
        workspaces: [],
      }));
      renderHits();
    } catch {
      searchHits = [];
      renderHits();
    }
  }

  let socialHubAbort = null; // leakfix58
  async function refresh() {
    if (!api) return;
    if (socialHubAbort) {
      try { socialHubAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    socialHubAbort = ctl;
    loading = true;
    if (open) renderList();
    try {
      const qs = filterWorkspace && filterWorkspace !== "all"
        ? `?workspace_id=${encodeURIComponent(filterWorkspace)}`
        : "";
      data = await api(`/api/social/hub${qs}`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      renderWorkspaceSelect();
      if (open) renderList();
      else syncTabs();
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      if (open) {
        const body = overlay?.querySelector("[data-sn-body]");
        if (body) body.innerHTML = `<p class="social-network-empty">${esc(err.message || "Could not load social")}</p>`;
      }
    } finally {
      if (socialHubAbort === ctl) socialHubAbort = null;
      loading = false;
      setButtonBadge(requestCount());
    }
  }

  function renderWorkspaceSelect() {
    const sel = overlay?.querySelector("[data-sn-workspace]");
    if (!sel) return;
    const spaces = data.workspaces || [];
    sel.innerHTML = `<option value="all">All teams</option>${spaces.map((w) =>
      `<option value="${esc(w.id)}"${filterWorkspace === w.id ? " selected" : ""}>${esc(w.name)} (${Number(w.member_count || 0)})</option>`
    ).join("")}`;
  }

  async function addPerson() {
    const input = overlay?.querySelector("[data-sn-add-input]");
    const raw = (input?.value || "").trim();
    if (!raw) {
      setStatus("error", "Enter an email or @handle");
      return;
    }
    const isEmail = raw.includes("@") && !raw.startsWith("@") && raw.includes(".");
    try {
      if (isEmail) {
        await api("/api/social/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: raw,
            team_id: getWorkspaceId?.() || undefined,
            project_id: getProjectId?.() || undefined,
          }),
        });
        setStatus("ok", "Invite sent — they'll see it in Requests.");
      } else {
        const result = await api("/api/social/friends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle: raw.replace(/^@+/, "") }),
        });
        setStatus("ok", result?.status === "pending" ? "Friend request sent." : "You're friends now.");
      }
      if (input) input.value = "";
      await refresh();
    } catch (err) {
      setStatus("error", err.message || "Could not add person");
    }
  }

  function notifyRequestsChanged() {
    try { onRequestsChanged?.(); } catch { /* ignore */ }
  }

  function isMobileShell() {
    return window.matchMedia?.("(max-width: 820px), (pointer: coarse) and (max-width: 1024px)")?.matches
      || document.documentElement.classList.contains("mobile-app-locked");
  }

  function positionPopup() {
    const panel = overlay?.querySelector(".social-network-panel");
    if (!overlay || !panel || !buttonEl) return;
    if (isMobileShell()) {
      overlay.classList.add("social-network-overlay--mobile-sheet");
      panel.style.width = "";
      panel.style.top = "";
      panel.style.left = "";
      panel.style.right = "";
      panel.style.bottom = "";
      return;
    }
    overlay.classList.remove("social-network-overlay--mobile-sheet");
    const r = buttonEl.getBoundingClientRect();
    const width = Math.min(380, Math.max(280, window.innerWidth - 16));
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    if (left < 8) left = 8;
    let top = r.bottom + 6;
    const maxH = Math.min(520, window.innerHeight - 24);
    if (top + 220 > window.innerHeight - 8) {
      top = Math.max(8, r.top - Math.min(maxH, 420) - 6);
    }
    panel.style.width = `${width}px`;
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  function syncButtonExpanded() {
    buttonEl?.setAttribute("aria-expanded", open ? "true" : "false");
    buttonEl?.classList.toggle("active", open);
  }

  function openPanel(opts = {}) {
    ensureOverlay();
    if (opts.tab) tab = opts.tab;
    else if (requestCount() > 0) tab = "requests";
    open = true;
    overlay.classList.remove("hidden");
    document.body.classList.add("social-network-open");
    syncButtonExpanded();
    positionPopup();
    syncTabs();
    void refresh();
    try { onOpened?.(); } catch { /* ignore */ }
    window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => {
      if (open) void refresh();
    }, 15000);
    setTimeout(() => overlay?.querySelector("[data-sn-search]")?.focus(), 40);
  }

  function close() {
    open = false;
    overlay?.classList.add("hidden");
    document.body.classList.remove("social-network-open");
    syncButtonExpanded();
    window.clearInterval(pollTimer);
    closeAvatarSheet();
  }

  function toggle() {
    if (open) close();
    else openPanel();
  }

  function handleInviteEvent(msg) {
    const type = String(msg?.type || "");
    const inbound = type === "project.share.invite"
      || type === "team.invite.created"
      || type === "social.friend.request"
      || type === "meeting.request";
    if (inbound) {
      const who = msg.from_name || msg.inviter_name || msg.by || "Someone";
      if (type === "project.share.invite") setStatus("ok", `${who} shared a project with you`);
      else if (type === "social.friend.request") setStatus("ok", `${who} sent a friend request`);
      else if (type === "meeting.request") setStatus("ok", `${who} requested a meeting`);
      else setStatus("ok", `${who} invited you to a workspace`);
      openPanel({ tab: "requests" });
      return;
    }
    void refresh();
  }

  buttonEl?.addEventListener("click", (e) => {
    e.preventDefault();
    toggle();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) close();
  });
  window.addEventListener("resize", () => {
    if (open) positionPopup();
  });
  window.addEventListener("scroll", () => {
    if (open) positionPopup();
  }, true);

  window.setInterval(() => {
    if (!api) return;
    try { void api("/api/users/me/presence", { method: "POST" }); } catch { /* ignore */ }
  }, 60000);

  badgeTimer = window.setInterval(() => {
    if (!open) void refresh();
  }, 45000);
  void refresh();

  return {
    open: openPanel,
    close,
    toggle,
    refresh,
    handleInviteEvent,
    isOpen: () => open,
    openAvatar: () => {
      openPanel();
      openAvatarSheet();
    },
  };
}
