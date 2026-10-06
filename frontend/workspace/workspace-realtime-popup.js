/** Viewport popup + compact left chip for the Workspace Realtime editor. */

let activeObject = null;
let escapeHandler = null;
const REALTIME_VIEW_KEY = "render3d:realtimeEditorView:v1";
const REALTIME_FILTER_KEY = "render3d:realtimeEditorFilter:v1";

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function closeWorkspaceRealtimePopup() {
  document.getElementById("workspace-realtime-modal")?.remove();
  document.getElementById("workspace-realtime-open")?.setAttribute("aria-expanded", "false");
  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler);
    escapeHandler = null;
  }
}

function storedRealtimeView() {
  try {
    return localStorage.getItem(REALTIME_VIEW_KEY) || "preview";
  } catch {
    return "preview";
  }
}

function storeRealtimeView(value) {
  try {
    localStorage.setItem(REALTIME_VIEW_KEY, value);
  } catch {
    /* ignore storage failures */
  }
}

function storedRealtimeFilter() {
  try {
    return sessionStorage.getItem(REALTIME_FILTER_KEY) || "";
  } catch {
    return "";
  }
}

function storeRealtimeFilter(value) {
  try {
    sessionStorage.setItem(REALTIME_FILTER_KEY, value);
  } catch {
    /* ignore storage failures */
  }
}

function rowMatchesKind(row, kind) {
  if (!kind || kind === "all") return true;
  const text = row.textContent.toLowerCase();
  if (kind === "models") return /component|body|model|glb|step|stl/.test(text);
  if (kind === "folders") return /folder|mirror|linked/.test(text);
  if (kind === "sketches") return /sketch/.test(text);
  if (kind === "local") return /local|render3d/.test(text);
  return true;
}

export function applyRealtimeBrowserControls() {
  const modal = document.getElementById("workspace-realtime-modal");
  if (!modal) return;
  const card = modal.querySelector(".workspace-realtime-modal-card");
  const view = modal.querySelector("[data-realtime-view].active")?.dataset.realtimeView || storedRealtimeView();
  const query = (modal.querySelector("[data-realtime-search]")?.value || "").trim().toLowerCase();
  const kind = modal.querySelector("[data-realtime-kind]")?.value || "all";
  card?.classList.toggle("workspace-realtime-view-list", view === "list");
  card?.classList.toggle("workspace-realtime-view-grid", view === "grid");
  card?.classList.toggle("workspace-realtime-view-preview", view === "preview");

  const rows = [...modal.querySelectorAll(".workspace-fusion-browser-row, .workspace-fusion-file-entry")];
  for (const row of rows) {
    const text = row.textContent.toLowerCase();
    const matches = (!query || text.includes(query)) && rowMatchesKind(row, kind);
    row.classList.toggle("workspace-realtime-filter-hidden", !matches);
  }

  modal.querySelectorAll(".workspace-fusion-browser-section").forEach((section) => {
    const visibleRows = section.querySelectorAll(".workspace-fusion-browser-row:not(.workspace-realtime-filter-hidden), .workspace-fusion-file-entry:not(.workspace-realtime-filter-hidden)").length;
    section.classList.toggle("workspace-realtime-filter-hidden", query || kind !== "all" ? visibleRows === 0 : false);
    if ((query || kind !== "all") && visibleRows > 0) section.open = true;
  });

  modal.querySelectorAll(".workspace-fusion-project-card, .workspace-fusion-mirror-card").forEach((projectCard) => {
    const ownText = projectCard.textContent.toLowerCase();
    const visibleRows = projectCard.querySelectorAll(".workspace-fusion-browser-row:not(.workspace-realtime-filter-hidden), .workspace-fusion-file-entry:not(.workspace-realtime-filter-hidden)").length;
    const matchesCard = !query || ownText.includes(query) || visibleRows > 0;
    projectCard.classList.toggle("workspace-realtime-filter-hidden", !matchesCard);
  });

  const count = modal.querySelectorAll(".workspace-fusion-browser-row:not(.workspace-realtime-filter-hidden), .workspace-fusion-file-entry:not(.workspace-realtime-filter-hidden)").length;
  const countEl = modal.querySelector("[data-realtime-result-count]");
  if (countEl) countEl.textContent = query || kind !== "all" ? `${count} match${count === 1 ? "" : "es"}` : "All linked items";
}

export function setRealtimeConnectionState(state = "idle", message = "") {
  const modal = document.getElementById("workspace-realtime-modal");
  if (!modal) return;
  const status = modal.querySelector("[data-realtime-status]");
  const card = modal.querySelector(".workspace-realtime-modal-card");
  card?.classList.toggle("is-connecting-fusion", state === "loading");
  if (status) {
    status.textContent = message || (state === "loading" ? "Connecting to Fusion…" : "Fusion connection ready");
    status.classList.toggle("is-loading", state === "loading");
    status.classList.toggle("is-error", state === "error");
  }
}

export function setRealtimeActiveObject(info = null) {
  activeObject = info && info.label ? info : null;
  const el = document.getElementById("workspace-realtime-active");
  if (!el) return;
  if (!activeObject) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = `
    <button type="button" class="workspace-realtime-active-chip" data-realtime-reopen title="Browse realtime editor">
      <strong>${esc(activeObject.label)}</strong>
      <small>${esc(activeObject.hint || "Loaded · click to browse more")}</small>
    </button>
  `;
  el.querySelector("[data-realtime-reopen]")?.addEventListener("click", () => {
    openWorkspaceRealtimePopup();
  });
}

export function finishRealtimeObjectLoad(info = {}, { getProjectId, onOpened } = {}) {
  const label = String(info.label || info.filename || info.itemName || "Object").trim();
  const projectId = info.projectId || getProjectId?.() || "";
  closeWorkspaceRealtimePopup();
  setRealtimeActiveObject({
    label,
    filename: info.filename || "",
    projectId,
    hint: info.hint || "In viewport · click to browse",
  });
  if (typeof onOpened === "function") {
    onOpened({
      label,
      filename: info.filename || "",
      projectId,
      projectName: info.projectName || "",
    });
  }
}

export function openWorkspaceRealtimePopup({ refresh } = {}) {
  let modal = document.getElementById("workspace-realtime-modal");
  const openBtn = document.getElementById("workspace-realtime-open");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "workspace-realtime-modal";
    modal.className = "auth-modal workspace-realtime-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "workspace-realtime-modal-title");
    modal.innerHTML = `
      <div class="auth-backdrop" data-realtime-close></div>
      <div class="auth-card workspace-realtime-modal-card">
        <div class="workspace-realtime-modal-head">
          <div>
            <p class="app-dialog-eyebrow">Workspace</p>
            <h2 id="workspace-realtime-modal-title">Realtime editor</h2>
            <p class="muted small">Browse Fusion mirrors, open a file, then keep editing in the viewport.</p>
          </div>
          <button type="button" class="auth-close" data-realtime-close aria-label="Close">&times;</button>
        </div>
        <div class="workspace-realtime-modal-toolbar">
          <label class="workspace-realtime-search">
            <span>Search linked folders</span>
            <input type="search" data-realtime-search placeholder="Search projects, Fusion folders, components, bodies…" value="${esc(storedRealtimeFilter())}" />
          </label>
          <label class="workspace-realtime-filter">
            <span>Show</span>
            <select data-realtime-kind>
              <option value="all">Everything</option>
              <option value="models">Models + bodies</option>
              <option value="folders">Linked folders</option>
              <option value="sketches">Sketches</option>
              <option value="local">Local copies</option>
            </select>
          </label>
          <div class="workspace-realtime-view-options" role="group" aria-label="View options">
            <button type="button" data-realtime-view="preview">Preview</button>
            <button type="button" data-realtime-view="grid">Grid</button>
            <button type="button" data-realtime-view="list">List</button>
          </div>
        </div>
        <div class="workspace-realtime-connection">
          <span class="workspace-realtime-connection-dot" aria-hidden="true"></span>
          <span data-realtime-status>Connecting to Fusion…</span>
          <small data-realtime-result-count>All linked items</small>
        </div>
        <div class="workspace-realtime-modal-body">
          <div id="workspace-render-folder-card" class="workspace-render-folder-card muted small">Render Studio cloud source</div>
          <div id="workspace-fusion-projects" class="workspace-fusion-projects muted small"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const currentView = storedRealtimeView();
    modal.querySelectorAll("[data-realtime-view]").forEach((btn) => {
      const active = btn.dataset.realtimeView === currentView;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.addEventListener("click", () => {
        modal.querySelectorAll("[data-realtime-view]").forEach((other) => {
          const selected = other === btn;
          other.classList.toggle("active", selected);
          other.setAttribute("aria-pressed", selected ? "true" : "false");
        });
        storeRealtimeView(btn.dataset.realtimeView || "preview");
        applyRealtimeBrowserControls();
      });
    });
    modal.querySelector("[data-realtime-search]")?.addEventListener("input", (event) => {
      storeRealtimeFilter(event.target.value || "");
      applyRealtimeBrowserControls();
    });
    modal.querySelector("[data-realtime-kind]")?.addEventListener("change", applyRealtimeBrowserControls);
    modal.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-realtime-close]")) {
        closeWorkspaceRealtimePopup();
      }
    });
    escapeHandler = (event) => {
      if (event.key === "Escape" && document.getElementById("workspace-realtime-modal")) {
        closeWorkspaceRealtimePopup();
      }
    };
    document.addEventListener("keydown", escapeHandler);
  }
  openBtn?.setAttribute("aria-expanded", "true");
  setRealtimeConnectionState("loading", "Connecting to Fusion and linked workspace folders…");
  applyRealtimeBrowserControls();
  if (typeof refresh === "function") void refresh();
}

export function isRealtimePopupOpen() {
  return Boolean(document.getElementById("workspace-realtime-modal"));
}

export function bindRealtimeOpenButton({ refresh } = {}) {
  const btn = document.getElementById("workspace-realtime-open");
  if (!btn || btn.dataset.realtimeBound === "1") return;
  btn.dataset.realtimeBound = "1";
  btn.addEventListener("click", () => openWorkspaceRealtimePopup({ refresh }));
}

/** Install window helpers so app.js can call without fighting large rewrites. */
export function installRealtimePopupApi(api = {}) {
  const wrapped = {
    openWorkspaceRealtimePopup: () => openWorkspaceRealtimePopup({ refresh: api.refresh }),
    closeWorkspaceRealtimePopup,
    setRealtimeActiveObject,
    setRealtimeConnectionState,
    applyRealtimeBrowserControls,
    finishRealtimeObjectLoad: (info) => finishRealtimeObjectLoad(info, {
      getProjectId: api.getProjectId,
      onOpened: api.onOpened,
    }),
    isRealtimePopupOpen,
  };
  Object.assign(window, wrapped);
  bindRealtimeOpenButton({ refresh: api.refresh });
  return wrapped;
}
