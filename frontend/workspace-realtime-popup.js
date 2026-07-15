/** Viewport popup + compact left chip for the Workspace Realtime editor. */

let activeObject = null;
let escapeHandler = null;

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

export function finishRealtimeObjectLoad(info = {}, { getProjectId } = {}) {
  const label = String(info.label || info.filename || info.itemName || "Object").trim();
  closeWorkspaceRealtimePopup();
  setRealtimeActiveObject({
    label,
    filename: info.filename || "",
    projectId: info.projectId || getProjectId?.() || "",
    hint: info.hint || "In viewport · click to browse",
  });
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
        <div class="workspace-realtime-modal-body">
          <div id="workspace-render-folder-card" class="workspace-render-folder-card muted small">Render3D cloud source</div>
          <div id="workspace-fusion-projects" class="workspace-fusion-projects muted small"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
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
    finishRealtimeObjectLoad: (info) => finishRealtimeObjectLoad(info, { getProjectId: api.getProjectId }),
    isRealtimePopupOpen,
  };
  Object.assign(window, wrapped);
  bindRealtimeOpenButton({ refresh: api.refresh });
  return wrapped;
}
