/** Approvals tab — debugger pending queue, imported into the viewport strip. */

export const APPROVALS_TAB_ID = "approvals:debug";

export function summarizeApprovals(data = {}) {
  const pending = data.pending || {};
  const watchdogs = pending.pending_watchdogs || [];
  const cli = pending.pending_cli || [];
  const skills = pending.pending_skills || [];
  return {
    watchdogs,
    cli,
    skills,
    total: watchdogs.length + cli.length + skills.length,
  };
}

export function createApprovalsDebug({
  hostEl,
  docTabs,
  apiFn,
  onStatus,
} = {}) {
  async function refresh() {
    const list = hostEl?.querySelector("[data-appr-list]");
    if (!list) return;
    list.textContent = "Loading…";
    try {
      const data = await apiFn?.("/api/ops/debugger-analytics/overview");
      const sum = summarizeApprovals(data);
      const rows = [
        ...sum.watchdogs.map((w) => `<li><strong>watchdog</strong> ${w.title || w.id}</li>`),
        ...sum.cli.map((c) => `<li><strong>cli</strong> ${c.command_key || c.id}</li>`),
        ...sum.skills.map((s) => `<li><strong>skill</strong> ${s.path || s.id} (${s.approval_count || 0}/3)</li>`),
      ];
      list.innerHTML = rows.join("") || "<li>Nothing waiting.</li>";
      const count = hostEl?.querySelector("[data-appr-count]");
      if (count) count.textContent = String(sum.total);
    } catch (err) {
      list.innerHTML = `<li>${err?.message || "Could not load approvals."}</li>`;
    }
  }

  function reveal() {
    docTabs?.setActive(APPROVALS_TAB_ID);
    hostEl?.classList.remove("hidden");
    hostEl?.setAttribute("aria-hidden", "false");
    document.querySelector(".main-column")?.classList.add("approvals-layout");
    void refresh();
    onStatus?.("ok", "Approvals — debugger queue. Viewport stays 3D.");
  }

  function hideViewerOnly() {
    hostEl?.classList.add("hidden");
    hostEl?.setAttribute("aria-hidden", "true");
    document.querySelector(".main-column")?.classList.remove("approvals-layout");
  }

  hostEl?.addEventListener("click", (e) => {
    if (e.target?.closest?.("[data-appr-refresh]")) void refresh();
  });

  return {
    open: reveal,
    refresh,
    hideViewerOnly,
    closeTab: hideViewerOnly,
    activateFromShared: reveal,
    isOpen: () => !hostEl?.classList.contains("hidden"),
  };
}
