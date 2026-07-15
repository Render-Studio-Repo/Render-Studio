/** Shared closable tab strip for DXF + PDF/TXT/image document viewers. */

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{
 *   tabBarEl?: HTMLElement | null,
 *   mainColumnEl?: HTMLElement | null,
 * }} options
 */
export function createDocumentTabBar(options = {}) {
  const { tabBarEl, mainColumnEl } = options;

  /** @type {Map<string, { id: string, label: string, kind: string, dirty?: boolean }>} */
  const tabs = new Map();
  let activeId = null;
  /** @type {((tab: { id: string, label: string, kind: string }) => void) | null} */
  let activateHandler = null;
  /** @type {((tab: { id: string, label: string, kind: string }) => void) | null} */
  let closeHandler = null;

  function syncChrome() {
    const open = tabs.size > 0;
    tabBarEl?.classList.toggle("hidden", !open);
    mainColumnEl?.classList.toggle("doc-tabs-open", open);
    const viewport = document.getElementById("viewport");
    viewport?.classList.toggle("doc-viewer-active", open && !!activeId);
    viewport?.classList.toggle("dxf-viewer-active", false);
    viewport?.classList.toggle("ref-viewer-active", false);
  }

  function render() {
    if (!tabBarEl) return;
    if (!tabs.size) {
      tabBarEl.innerHTML = "";
      activeId = null;
      syncChrome();
      return;
    }
    if (!activeId || !tabs.has(activeId)) {
      activeId = tabs.keys().next().value;
    }
    tabBarEl.innerHTML = [...tabs.values()]
      .map((tab) => {
        const active = tab.id === activeId;
        const dirty = tab.dirty ? " *" : "";
        const label = `${tab.label || tab.id}${dirty}`;
        const badge =
          tab.kind === "dxf"
            ? "DXF"
            : tab.kind === "pdf"
              ? "PDF"
              : tab.kind === "text"
                ? "TXT"
                : tab.kind === "image"
                  ? "IMG"
                  : "FILE";
        return `<button type="button" class="dxf-tab ${active ? "active" : ""}" data-doc-tab="${escapeHtml(tab.id)}" role="tab" aria-selected="${active ? "true" : "false"}">
          <span class="doc-tab-kind">${badge}</span>
          <span class="dxf-tab-label">${escapeHtml(label)}</span>
          <span class="dxf-tab-close" data-doc-close="${escapeHtml(tab.id)}" role="button" aria-label="Close ${escapeHtml(label)}" title="Close">×</span>
        </button>`;
      })
      .join("");
    syncChrome();
  }

  tabBarEl?.addEventListener("click", (e) => {
    const closeBtn = e.target.closest?.("[data-doc-close]");
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = closeBtn.dataset.docClose;
      const tab = tabs.get(id);
      if (tab) closeHandler?.(tab);
      return;
    }
    const tabBtn = e.target.closest?.("[data-doc-tab]");
    if (tabBtn) {
      const id = tabBtn.dataset.docTab;
      const tab = tabs.get(id);
      if (!tab) return;
      activeId = id;
      render();
      activateHandler?.(tab);
    }
  });

  return {
    upsert(entry) {
      const id = String(entry.id || "");
      if (!id) return;
      const prev = tabs.get(id);
      tabs.set(id, {
        id,
        label: entry.label || prev?.label || id,
        kind: entry.kind || prev?.kind || "file",
        dirty: entry.dirty ?? prev?.dirty ?? false,
      });
      render();
    },
    setDirty(id, dirty) {
      const tab = tabs.get(String(id || ""));
      if (!tab) return;
      tab.dirty = !!dirty;
      render();
    },
    setActive(id, { notify = true } = {}) {
      const key = String(id || "");
      if (!tabs.has(key)) return;
      const changed = activeId !== key;
      activeId = key;
      render();
      if (notify && changed) activateHandler?.(tabs.get(key));
    },
    remove(id) {
      const key = String(id || "");
      if (!tabs.has(key)) return null;
      const removed = tabs.get(key);
      tabs.delete(key);
      if (activeId === key) {
        activeId = tabs.keys().next().value || null;
      }
      render();
      if (activeId) activateHandler?.(tabs.get(activeId));
      return removed;
    },
    clear() {
      tabs.clear();
      activeId = null;
      render();
    },
    has(id) {
      return tabs.has(String(id || ""));
    },
    getActive() {
      return activeId ? tabs.get(activeId) || null : null;
    },
    list() {
      return [...tabs.values()];
    },
    onActivate(fn) {
      activateHandler = fn;
    },
    onClose(fn) {
      closeHandler = fn;
    },
    render,
  };
}
