/** Workspace tab — enter VR/PC room and edit the shared world. */

import {
  WORKSPACE_WORLD_PIECES,
  readWorkspaceWorld,
} from "../xr/xr-workspace-world.js?v=wsworld2";

export const WORKSPACE_TAB_ID = "workspace:open";

export function createWorkspaceWorldEditor({
  viewerEl,
  docTabs,
  getProjectId,
  onStatus,
  onEnterPc,
  onEnterVr,
  onGodView,
  onPlacePiece,
  onUndoPiece,
} = {}) {
  function paint() {
    const list = viewerEl?.querySelector("[data-world-roster]");
    if (!list) return;
    const world = readWorkspaceWorld(getProjectId?.() || "");
    list.innerHTML = world.pieces.map((p) => {
      const meta = WORKSPACE_WORLD_PIECES.find((row) => row.id === p.kind);
      return `<li><strong>${meta?.label || p.kind}</strong> · ${p.x.toFixed(1)}, ${p.z.toFixed(1)}</li>`;
    }).join("");
  }

  function reveal() {
    docTabs?.setActive(WORKSPACE_TAB_ID);
    viewerEl?.classList.remove("hidden");
    viewerEl?.setAttribute("aria-hidden", "false");
    document.querySelector(".main-column")?.classList.add("workspace-world-layout");
    paint();
    onStatus?.("ok", "Workspace world editor — enter VR or use God View, then place floors, tables, and walls.");
  }

  function hideViewerOnly() {
    viewerEl?.classList.add("hidden");
    viewerEl?.setAttribute("aria-hidden", "true");
    document.querySelector(".main-column")?.classList.remove("workspace-world-layout");
  }

  viewerEl?.addEventListener("click", (e) => {
    if (e.target?.closest?.("[data-world-pc]")) {
      void onEnterPc?.();
      return;
    }
    if (e.target?.closest?.("[data-world-vr]")) {
      void onEnterVr?.();
      return;
    }
    if (e.target?.closest?.("[data-world-god]")) {
      void onGodView?.();
      return;
    }
    if (e.target?.closest?.("[data-world-undo]")) {
      onUndoPiece?.();
      paint();
      return;
    }
    const piece = e.target?.closest?.("[data-world-piece]")?.getAttribute("data-world-piece");
    if (piece) {
      onPlacePiece?.(piece);
      paint();
    }
  });

  return {
    open: reveal,
    hideViewerOnly,
    closeTab() {
      hideViewerOnly();
    },
    activateFromShared: reveal,
    paint,
    isOpen: () => !viewerEl?.classList.contains("hidden"),
  };
}
