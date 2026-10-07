/** Compact Workshop host — imports modules instead of a second viewport. */

import { WORKSHOP_MODULES, WORKSHOP_TAB_ID, loadWorkshopModule } from "./workshop-modules.js?v=20260923-draw-recordings1&vrrobot=20260927-2";
import { WORKSPACE_WORLD_PIECES } from "../xr/xr-workspace-world.js?v=wsworld2";

export { WORKSHOP_TAB_ID };

export function createWorkshopHost({
  hostEl,
  docTabs,
  getProjectId,
  onStatus,
  onEnterVr,
  onGodView,
  onPlacePiece,
  onUndoPiece,
} = {}) {
  let module = "enter";
  let loaded = {};

  function paintWorld() {
    const list = hostEl?.querySelector("[data-ws-world-list]");
    if (!list) return;
    const { readWorkspaceWorld } = loaded.world || {};
    const world = readWorkspaceWorld?.(getProjectId?.() || "") || { pieces: [] };
    list.innerHTML = (world.pieces || []).map((p) => {
      const meta = WORKSPACE_WORLD_PIECES.find((row) => row.id === p.kind);
      return `<li>${meta?.label || p.kind}</li>`;
    }).join("");
  }

  async function showModule(id) {
    module = id;
    hostEl?.querySelectorAll("[data-ws-mod]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.getAttribute("data-ws-mod") === id);
    });
    hostEl?.querySelectorAll("[data-ws-stage]").forEach((el) => {
      el.hidden = el.getAttribute("data-ws-stage") !== id;
    });
    if (!loaded[id]) loaded[id] = await loadWorkshopModule(id);
    const stage = hostEl?.querySelector(`[data-ws-stage="${id}"]`);
    if (id === "board" && loaded.board?.markup && stage) {
      stage.innerHTML = loaded.board.markup;
      loaded.board.bind?.(stage);
    }
    if (id === "wall" && loaded.wall?.markup && stage) {
      stage.innerHTML = loaded.wall.markup;
      loaded.wall.bind?.(stage);
    }
    if (id === "world") paintWorld();
  }

  function reveal() {
    docTabs?.setActive(WORKSHOP_TAB_ID);
    hostEl?.classList.remove("hidden");
    hostEl?.setAttribute("aria-hidden", "false");
    document.querySelector(".main-column")?.classList.add("workshop-layout");
    void showModule(module);
    onStatus?.("ok", "Workshop — compact inspector. Viewport stays 3D. Import modules here.");
  }

  function hideViewerOnly() {
    hostEl?.classList.add("hidden");
    hostEl?.setAttribute("aria-hidden", "true");
    document.querySelector(".main-column")?.classList.remove("workshop-layout");
  }

  if (hostEl && !hostEl.dataset.bound) {
    hostEl.dataset.bound = "1";
    hostEl.innerHTML = `
      <div class="workshop-host-bar">
        <strong>Workshop</strong>
        ${WORKSHOP_MODULES.map((m) => `<button type="button" class="dxf-viewer-btn" data-ws-mod="${m.id}" title="${m.desc}">${m.label}</button>`).join("")}
      </div>
      <div class="workshop-host-body">
        <div data-ws-stage="enter">
          <p class="muted small">Same room as headset users. Viewport stays the 3D canvas.</p>
          <button type="button" class="dxf-viewer-btn" data-ws-vr>Enter VR</button>
          <button type="button" class="dxf-viewer-btn" data-ws-god>God view</button>
        </div>
        <div data-ws-stage="world" hidden>
          <div class="workspace-world-palette">
            ${WORKSPACE_WORLD_PIECES.map((p) => `<button type="button" class="dxf-viewer-btn" data-world-piece="${p.id}">${p.label}</button>`).join("")}
            <button type="button" class="dxf-viewer-btn" data-world-undo>Undo</button>
          </div>
          <ul data-ws-world-list class="worktop-roster"></ul>
        </div>
        <div data-ws-stage="agents" hidden>
          <p class="muted small">God view over the agent table. Import of worktop-viewer.</p>
          <button type="button" class="dxf-viewer-btn" data-ws-god>God view</button>
        </div>
        <div data-ws-stage="board" hidden></div>
        <div data-ws-stage="wall" hidden></div>
      </div>
    `;
    hostEl.addEventListener("click", (e) => {
      const mod = e.target?.closest?.("[data-ws-mod]")?.getAttribute("data-ws-mod");
      if (mod) {
        void showModule(mod);
        return;
      }
      if (e.target?.closest?.("[data-ws-vr]")) {
        void onEnterVr?.();
        return;
      }
      if (e.target?.closest?.("[data-ws-god]")) {
        void onGodView?.();
        return;
      }
      if (e.target?.closest?.("[data-world-undo]")) {
        onUndoPiece?.();
        paintWorld();
        return;
      }
      const piece = e.target?.closest?.("[data-world-piece]")?.getAttribute("data-world-piece");
      if (piece) {
        onPlacePiece?.(piece);
        paintWorld();
      }
    });
  }

  return {
    open: reveal,
    hideViewerOnly,
    closeTab: hideViewerOnly,
    activateFromShared: reveal,
    isOpen: () => !hostEl?.classList.contains("hidden"),
  };
}
