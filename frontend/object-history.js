/** Full project history log with timeline restore links. */

const KIND_LABELS = {
  upload: "Upload",
  prompt: "AI prompt",
  build: "Ribbon build",
  restore: "Restore",
  transform: "Transform",
  extrude: "Extrude",
  mirror: "Mirror",
  project_moved: "Moved",
  project_renamed: "Renamed",
};

export function createObjectHistoryUI({ listEl, onRestore, onHighlight }) {
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

  function avatarHtml(e) {
    const name = e.user_name || "Unknown";
    const initial = escapeHtml(name.trim().charAt(0).toUpperCase() || "?");
    if (e.user_avatar_url) {
      return `<span class="oh-avatar oh-avatar--image" style="background-image:url('${escapeHtml(e.user_avatar_url)}')" title="${escapeHtml(name)}"></span>`;
    }
    return `<span class="oh-avatar" title="${escapeHtml(name)}">${initial}</span>`;
  }

  function render(entries) {
    if (!listEl) return;
    if (!entries?.length) {
      listEl.innerHTML =
        '<p class="muted small object-history-empty">No history yet — upload, build, extrude, or prompt to start.</p>';
      return;
    }

    listEl.innerHTML = entries
      .map((e) => {
        const kind = KIND_LABELS[e.kind] || e.kind || "Change";
        const who = e.user_name ? escapeHtml(e.user_name) : '<span class="muted">Unknown</span>';
        const when = formatWhen(e.created_at);
        const meta = [when, e.filename ? escapeHtml(e.filename) : null].filter(Boolean).join(" · ");
        const modelName = e.meta?.model || e.model;
        const modelLine = modelName
          ? `<span class="oh-model">Model · ${escapeHtml(modelName)}</span>`
          : "";
        const summary = e.summary
          ? `<p class="oh-summary">${escapeHtml(e.summary)}</p>`
          : "";
        const restorable = e.restorable && e.timeline_index != null;
        const tag = restorable
          ? `<span class="oh-restore-tag">Timeline #${e.timeline_index + 1}</span>`
          : `<span class="oh-meta-tag">Log only</span>`;
        const el = restorable ? "button" : "div";
        const extra = restorable ? "" : ' tabindex="-1"';
        return `<${el} type="button" class="object-history-item${restorable ? "" : " oh-static"}" data-index="${e.timeline_index ?? ""}" data-restorable="${restorable ? "1" : "0"}"${extra}>
          <span class="oh-head">
            <span class="oh-kind">${escapeHtml(kind)}</span>
            <span class="oh-user">${avatarHtml(e)}${who}</span>
          </span>
          <span class="oh-label">${escapeHtml(e.label || kind)}</span>
          <span class="oh-meta">${meta}</span>
          ${modelLine}
          ${summary}
          <span class="oh-foot">${tag}</span>
        </${el}>`;
      })
      .join("");

    listEl.querySelectorAll(".object-history-item[data-restorable='1']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = parseInt(btn.dataset.index, 10);
        if (Number.isNaN(index)) return;
        onHighlight?.(index);
        onRestore?.(index);
      });
    });
  }

  function highlightActive(timelineIndex) {
    if (!listEl) return;
    listEl.querySelectorAll(".object-history-item").forEach((el) => {
      const idx = el.dataset.index;
      el.classList.toggle(
        "oh-active",
        idx !== "" && parseInt(idx, 10) === timelineIndex
      );
    });
  }

  return { render, highlightActive };
}
