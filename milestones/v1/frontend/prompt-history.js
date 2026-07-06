/** Prompt compose / history tabs (bottom-right panel). */

export function createPromptHistoryUI({ listEl, onReuse, onTabChange }) {
  const tabs = document.querySelectorAll(".prompt-tab");
  const panes = {
    compose: document.getElementById("prompt-pane-compose"),
    history: document.getElementById("prompt-pane-history"),
  };

  function setTab(name) {
    tabs.forEach((btn) => {
      const active = btn.dataset.pane === name;
      btn.classList.toggle("active", active);
    });
    Object.entries(panes).forEach(([key, pane]) => {
      if (!pane) return;
      pane.classList.toggle("hidden", key !== name);
      pane.classList.toggle("active", key === name);
    });
    onTabChange?.(name);
  }

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.pane));
  });

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

  function render(entries) {
    if (!listEl) return;
    if (!entries?.length) {
      listEl.innerHTML = '<p class="muted small prompt-history-empty">No prompts yet for this project.</p>';
      return;
    }
    listEl.innerHTML = entries
      .map((e) => {
        const when = formatWhen(e.created_at);
        const status = e.success
          ? `<span class="ph-status ok">OK</span>`
          : `<span class="ph-status err">Failed</span>`;
        const who = e.user_name ? escapeHtml(e.user_name) : null;
        const meta = [
          who,
          when,
          e.filename ? escapeHtml(e.filename) : null,
          e.reference_count ? `${e.reference_count} ref` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const reply = e.message
          ? `<p class="ph-reply">${escapeHtml(e.message)}</p>`
          : e.error
            ? `<p class="ph-reply ph-error">${escapeHtml(e.error)}</p>`
            : "";
        return `<button type="button" class="prompt-history-item" data-id="${escapeHtml(e.id)}">
          <span class="ph-head">${status}<span class="ph-meta">${meta}</span></span>
          <span class="ph-prompt">${escapeHtml(e.prompt)}</span>
          ${reply}
        </button>`;
      })
      .join("");

    listEl.querySelectorAll(".prompt-history-item").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        const entry = entries[i];
        if (entry) onReuse?.(entry);
        setTab("compose");
      });
    });
  }

  function setCountBadge(count) {
    const tab = document.querySelector('.prompt-tab[data-pane="history"]');
    if (!tab) return;
    const base = "History";
    tab.textContent = count > 0 ? `${base} (${count})` : base;
  }

  return {
    setTab,
    render,
    setCountBadge,
  };
}
