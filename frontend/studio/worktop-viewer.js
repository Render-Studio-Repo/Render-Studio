/** Worktop tab — overhead god view of round-table agents. */

import { XR_TEAM_AGENTS, rosterFromTeamStatus } from "../xr/xr-agent-join.js?v=agentjoin1&roundtbl1=1&worktop1=1";

export const WORKTOP_TAB_ID = "worktop:open";
export const WORKTOP_GOD_HEIGHT_M = 5.4;

export function worktopSeatLayout(agents = XR_TEAM_AGENTS, { cx = 160, cy = 132, radius = 78 } = {}) {
  const rows = Array.isArray(agents) && agents.length ? agents : XR_TEAM_AGENTS;
  return rows.map((agent, i) => {
    const a = (i / Math.max(1, rows.length)) * Math.PI * 2 - Math.PI / 2;
    return {
      ...agent,
      x: cx + Math.cos(a) * radius,
      y: cy + Math.sin(a) * radius,
    };
  });
}

export function createWorktopViewer({
  viewerEl,
  docTabs,
  apiFn,
  onStatus,
  onGodView,
} = {}) {
  let roster = XR_TEAM_AGENTS.map((row) => ({ ...row }));

  function canvas() {
    return viewerEl?.querySelector("[data-worktop-canvas]") || null;
  }

  function paint() {
    const el = canvas();
    if (!el) return;
    const ctx = el.getContext("2d");
    const w = el.width;
    const h = el.height;
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1b2430";
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2 - 8, 92, 54, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#58a6ff";
    ctx.stroke();
    ctx.fillStyle = "#e6edf3";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("God view · agents", w / 2, h / 2 - 4);
    for (const seat of worktopSeatLayout(roster, { cx: w / 2, cy: h / 2 - 8, radius: 108 })) {
      ctx.beginPath();
      ctx.arc(seat.x, seat.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = seat.hello ? "#3fb950" : "#58a6ff";
      ctx.fill();
      ctx.fillStyle = "#e6edf3";
      ctx.font = "10px sans-serif";
      ctx.fillText(String(seat.name || seat.id).split(" ")[0], seat.x, seat.y + 28);
    }
    const list = viewerEl?.querySelector("[data-worktop-roster]");
    if (list) {
      list.innerHTML = roster.map((a) => (
        `<li><strong>${a.name || a.id}</strong> · ${a.hello ? "present" : "seat"} · ${a.role || ""}</li>`
      )).join("");
    }
  }

  async function refresh() {
    try {
      const data = await apiFn?.("/api/ops/team-status");
      roster = rosterFromTeamStatus(data);
    } catch {
      roster = XR_TEAM_AGENTS.map((row) => ({ ...row }));
    }
    paint();
    return roster;
  }

  function reveal() {
    docTabs?.upsert({ id: WORKTOP_TAB_ID, label: "Worktop", kind: "worktop" });
    docTabs?.setActive(WORKTOP_TAB_ID);
    viewerEl?.classList.remove("hidden");
    viewerEl?.setAttribute("aria-hidden", "false");
    document.querySelector(".main-column")?.classList.add("worktop-layout");
    void refresh();
    onStatus?.("ok", "Worktop god view — inspect the agents and room from above.");
  }

  function hideViewerOnly() {
    viewerEl?.classList.add("hidden");
    viewerEl?.setAttribute("aria-hidden", "true");
    document.querySelector(".main-column")?.classList.remove("worktop-layout");
  }

  function closeTab() {
    hideViewerOnly();
    docTabs?.remove(WORKTOP_TAB_ID);
  }

  viewerEl?.addEventListener("click", (e) => {
    if (e.target?.closest?.("[data-worktop-god]")) {
      void onGodView?.();
      return;
    }
    if (e.target?.closest?.("[data-worktop-refresh]")) void refresh();
  });

  return {
    open: reveal,
    refresh,
    hideViewerOnly,
    closeTab,
    activateFromShared: reveal,
    isOpen: () => !viewerEl?.classList.contains("hidden"),
  };
}
