/** Live CAD connection badges overlay the avatar (top-right), not a sibling chip column. */

const ASSET = "20260908-profclick1";

const CAD_APPS = [
  {
    id: "onshape",
    label: "Onshape",
    src: `/cad/onshape-logo.png?v=${ASSET}`,
    badgeId: "onshape-badge",
  },
  {
    id: "fusion",
    label: "Fusion 360",
    src: `/cad/fusion-360-logo.png?v=${ASSET}`,
    badgeId: "fusion-badge",
  },
];

const MULTI_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
  <path fill="currentColor" d="M7.05 7.05A7 7 0 0 1 19 12h2a9 9 0 0 0-15.36-6.36L4 4v5h5L7.05 7.05Zm9.9 9.9A7 7 0 0 1 5 12H3a9 9 0 0 0 15.36 6.36L20 20v-5h-5l1.95 1.95Z"/>
  <path fill="currentColor" d="M10.6 13.4a2.2 2.2 0 0 1 0-3.1l1.2-1.2 1.1 1.1-1.2 1.2a.6.6 0 0 0 .85.85l1.2-1.2 1.1 1.1-1.2 1.2a2.2 2.2 0 0 1-3.1 0Zm2.8-2.8 1.15-1.15a2.2 2.2 0 0 1 3.1 3.1l-1.15 1.15-1.1-1.1 1.15-1.15a.6.6 0 0 0-.85-.85L14.5 11.7l-1.1-1.1Z"/>
</svg>`;

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function accountLabel(conn) {
  const raw =
    conn?.account
    || conn?.autodesk_email
    || conn?.autodesk_name
    || conn?.onshape_email
    || conn?.email
    || conn?.name
    || "";
  const text = String(raw).trim();
  return text || "Connected";
}

/** Live CAD cloud links only. Library-ready / disconnected never count. */
export function liveCadConnections({ onshape, fusion } = {}) {
  const rows = [];
  const sources = { onshape, fusion };
  for (const app of CAD_APPS) {
    const status = sources[app.id];
    if (!status || status.linked !== true) continue;
    rows.push({
      id: app.id,
      label: app.label,
      src: app.src,
      badgeId: app.badgeId,
      account: accountLabel(status),
    });
  }
  return rows;
}

export function cadBadgeLayout(connections = []) {
  const all = Array.isArray(connections) ? connections.filter((c) => c?.id) : [];
  const n = all.length;
  if (n <= 2) {
    return {
      overlay: all.slice(0, 2),
      toolbar: [],
      menu: all.slice(0, 2),
      showMulti: false,
    };
  }
  return {
    overlay: [],
    toolbar: [],
    menu: all.slice(0, 6),
    showMulti: true,
  };
}

function chipButton(conn) {
  const title = `${conn.label}: ${conn.account}`;
  return `<button type="button" class="cad-app-chip" data-cad-app="${escapeAttr(conn.id)}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}">
    <img src="${escapeAttr(conn.src)}" alt="" width="16" height="16" />
  </button>`;
}

function bindChipClicks(root) {
  root?.querySelectorAll("[data-cad-app], [data-cad-multi]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent("render3d:open-authorized-apps"));
    });
  });
}

function renderChipRow(el, conns) {
  if (!el) return;
  if (!conns.length) {
    el.innerHTML = "";
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = conns.map(chipButton).join("");
  bindChipClicks(el);
}

function paintOverlayBadges(overlay = []) {
  const shown = new Set(overlay.map((c) => c.id));
  for (const app of CAD_APPS) {
    const el = document.getElementById(app.badgeId);
    if (!el) continue;
    const conn = overlay.find((c) => c.id === app.id);
    const visible = shown.has(app.id);
    el.classList.toggle("hidden", !visible);
    el.classList.toggle("cad-avatar-overlay", visible);
    const offset = visible && overlay.length > 1 && overlay[0]?.id !== app.id;
    el.classList.toggle("cad-avatar-overlay--offset", offset);
    el.setAttribute("aria-hidden", visible ? "false" : "true");
    if (conn) {
      const title = `${conn.label}: ${conn.account}`;
      el.setAttribute("title", title);
    }
  }
}

export function syncCadAvatarBadges(status = {}) {
  const connections = liveCadConnections(status);
  const layout = cadBadgeLayout(connections);
  const toolbar = document.getElementById("cad-toolbar-chips");
  const menu = document.getElementById("cad-menu-chips");
  const multi = document.getElementById("cad-avatar-multi");

  paintOverlayBadges(layout.overlay);
  renderChipRow(toolbar, layout.toolbar);
  renderChipRow(menu, layout.menu);

  const cluster = document.querySelector(".auth-avatar-cluster");
  cluster?.classList.toggle("has-cad-multi", layout.showMulti);

  if (multi) {
    const n = connections.length;
    const title = n > 2 ? `${n} apps connected` : "Multiple apps connected";
    multi.classList.toggle("hidden", !layout.showMulti);
    multi.setAttribute("title", title);
    multi.setAttribute("aria-label", title);
    multi.setAttribute("aria-hidden", layout.showMulti ? "false" : "true");
  }
}

export function initCadAvatarBadges() {
  const multi = document.getElementById("cad-avatar-multi");
  if (multi && !multi.dataset.cadBound) {
    multi.dataset.cadBound = "1";
    multi.innerHTML = MULTI_ICON;
  }
}
