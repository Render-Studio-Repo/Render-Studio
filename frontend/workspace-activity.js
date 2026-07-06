/** Live workspace activity feed (folders, project moves). */

const KIND_LABELS = {
  folder_created: "Folder created",
  folder_renamed: "Folder renamed",
  folder_deleted: "Folder deleted",
  folder_shared: "Folder shared",
  project_moved: "Project moved",
  render_folder_connected: "Render folder connected",
};

export function createWorkspaceActivityUI({ listEl }) {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatWhen(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    } catch {
      return "";
    }
  }

  function prependEntry(entry) {
    if (!listEl || !entry) return;
    const empty = listEl.querySelector(".workspace-activity-empty");
    if (empty) empty.remove();

    const kind = KIND_LABELS[entry.kind] || entry.kind || "Activity";
    const who = entry.user_name ? escapeHtml(entry.user_name) : "Unknown";
    const when = formatWhen(entry.created_at);
    const row = document.createElement("div");
    row.className = "workspace-activity-item ws-activity-new";
    row.innerHTML = `
      <span class="ws-act-head"><span class="ws-act-kind">${escapeHtml(kind)}</span><span class="ws-act-user">${who}</span></span>
      <span class="ws-act-label">${escapeHtml(entry.label || kind)}</span>
      <span class="ws-act-meta">${when}</span>`;
    listEl.prepend(row);
    setTimeout(() => row.classList.remove("ws-activity-new"), 2000);
    while (listEl.children.length > 40) {
      listEl.lastElementChild?.remove();
    }
  }

  function render(entries) {
    if (!listEl) return;
    if (!entries?.length) {
      listEl.innerHTML =
        '<p class="muted small workspace-activity-empty">Workspace activity appears here in real time.</p>';
      return;
    }
    listEl.innerHTML = entries
      .map((e) => {
        const kind = KIND_LABELS[e.kind] || e.kind || "Activity";
        const who = e.user_name ? escapeHtml(e.user_name) : "Unknown";
        const when = formatWhen(e.created_at);
        return `<div class="workspace-activity-item">
          <span class="ws-act-head"><span class="ws-act-kind">${escapeHtml(kind)}</span><span class="ws-act-user">${who}</span></span>
          <span class="ws-act-label">${escapeHtml(e.label || kind)}</span>
          <span class="ws-act-meta">${when}</span>
        </div>`;
      })
      .join("");
  }

  return { render, prependEntry };
}
