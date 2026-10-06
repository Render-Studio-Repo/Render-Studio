export const MOBILE_OVERLAYS = Object.freeze({
  tools: Object.freeze({ selector: "#mobile-tools-popup", hiddenClass: "hidden" }),
  select: Object.freeze({ selector: "#mobile-select-popup", hiddenClass: "hidden" }),
  more: Object.freeze({ selector: "#mobile-more-sheet", hiddenClass: "hidden" }),
  ai: Object.freeze({ selector: "#mobile-ai-composer", hiddenClass: "hidden" }),
  nav: Object.freeze({ selector: "nav.toolbar-nav.is-open", hiddenClass: "is-open" }),
});

export function createMobileOverlayCoordinator(closers = {}) {
  let active = null;
  function activate(name) {
    for (const [key, close] of Object.entries(closers)) {
      if (key !== name && typeof close === "function") close();
    }
    active = name || null;
    return active;
  }
  function closeAll() {
    for (const close of Object.values(closers)) {
      if (typeof close === "function") close();
    }
    active = null;
  }
  return Object.freeze({ activate, closeAll, active: () => active });
}

/** Close every registered mobile overlay except the one that is about to open. */
export function closeCompetingMobileOverlays(active, {
  document: doc = globalThis.document,
  closePanels = null,
} = {}) {
  if (!doc) return [];
  const closed = [];
  for (const [name, spec] of Object.entries(MOBILE_OVERLAYS)) {
    if (name === active) continue;
    for (const element of doc.querySelectorAll?.(spec.selector) || []) {
      if (name === "nav") element.classList.remove(spec.hiddenClass);
      else {
        element.hidden = true;
        element.classList.add(spec.hiddenClass);
      }
      closed.push(name);
    }
  }
  doc.body?.classList?.remove("toolbar-nav-open", "mobile-ai-composer-open");
  if (active !== "panel" && typeof closePanels === "function") closePanels();
  return [...new Set(closed)];
}
