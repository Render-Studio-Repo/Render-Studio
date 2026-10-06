/**
 * Sandbox Avatar tab — networked presence skins (Studio XR Avatar, stable Sep-15 path).
 * Token avatar1. No Kenney GLB inject; procedural + networked peer list only.
 */

import {
  AVATAR_BODIES,
  AVATAR_OUTFITS,
  AVATAR_SOURCES,
  loadAvatarSpec,
  saveAvatarSpec,
  applyAvatarAction,
  avatarSettingsLines,
} from "../xr/xr-avatar.js?v=avatar1-golden1";

export const AVATAR1_TOKEN = "avatar1";

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function uid() {
  try {
    return String(localStorage.getItem("render3d:lastUserId") || "local");
  } catch {
    return "local";
  }
}

async function fetchNetworkPeers() {
  try {
    const res = await fetch("/api/collab/presence?t=" + Date.now(), { credentials: "same-origin" }).catch(() => null);
    if (!res?.ok) return [];
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.users) ? data.users : (data.peers || data.presence || []);
  } catch {
    return [];
  }
}

export function mountSandboxAvatar(host) {
  if (!host) return null;
  if (host.dataset.ready === "1") return host._avatarApi || null;
  host.dataset.ready = "1";
  host.dataset.token = AVATAR1_TOKEN;
  host.classList.add("sb-avatar-pane");

  let spec = loadAvatarSpec(uid());

  const paint = async () => {
    const peers = await fetchNetworkPeers();
    const lines = avatarSettingsLines(spec, { quest: false });
    host.innerHTML = `
      <header class="sb-avatar-head">
        <div>
          <span class="sb-kicker">AVATAR · NETWORKED · ${AVATAR1_TOKEN}</span>
          <p class="muted small">Studio XR Avatar settings (stable procedural path). Network peers below — no jitter inject.</p>
        </div>
        <button type="button" class="sb-agent-btn" data-av-refresh>Refresh peers</button>
      </header>
      <div class="sb-avatar-grid">
        <section class="sb-avatar-local">
          <h3>Your avatar</h3>
          <p class="muted small">Body ${esc(spec.body || "default")} · Outfit ${esc(spec.outfit || "studio")} · Source ${esc(spec.source || "studio")}</p>
          <div class="sb-avatar-actions">
            ${AVATAR_BODIES.map((b) => `<button type="button" class="sb-agent-btn${spec.body === b.id ? " is-on" : ""}" data-av-action="avatar-body-${esc(b.id)}">${esc(b.label)}</button>`).join("")}
          </div>
          <div class="sb-avatar-actions">
            ${AVATAR_OUTFITS.map((o) => `<button type="button" class="sb-agent-btn${spec.outfit === o.id ? " is-on" : ""}" data-av-action="avatar-outfit-${esc(o.id)}">${esc(o.label)}</button>`).join("")}
          </div>
          <div class="sb-avatar-actions">
            ${AVATAR_SOURCES.filter((s) => !String(s.id).startsWith("kenney-")).map((s) =>
              `<button type="button" class="sb-agent-btn${spec.source === s.id ? " is-on" : ""}" data-av-action="avatar-source-${esc(s.id)}">${esc(s.label)}</button>`).join("")}
          </div>
          <ul class="sb-log muted small">${lines.slice(0, 8).map((l) => `<li>${esc(l.label || l.id)}</li>`).join("")}</ul>
        </section>
        <section class="sb-avatar-peers">
          <h3>Networked in room</h3>
          <ul class="sb-avatar-peer-list">
            ${peers.length
              ? peers.map((p) => `<li><strong>${esc(p.display_name || p.name || p.handle || p.id)}</strong>
                  <span class="muted small">${p.inXr || p.xrPose ? "in XR" : "online"} · ${esc(p.avatar_source || p.avatar?.source || "studio")}</span></li>`).join("")
              : `<li class="muted small">No collab peers yet — join a Studio room to see networked avatars.</li>`}
          </ul>
        </section>
      </div>
    `;
    host.querySelector("[data-av-refresh]")?.addEventListener("click", () => { void paint(); });
    host.querySelectorAll("[data-av-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-av-action");
        const out = applyAvatarAction(spec, action, {});
        spec = saveAvatarSpec(uid(), out.spec || spec);
        void paint();
      });
    });
  };

  void paint();
  const api = { token: AVATAR1_TOKEN, refresh: paint, getSpec: () => spec };
  host._avatarApi = api;
  return api;
}
