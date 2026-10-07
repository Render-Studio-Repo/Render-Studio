/** Fusion-style workspace mode switcher (Design, Wiring Simulator, …). */

export const WORKSPACE_MODES = [
  { id: "design", label: "Design", icon: "◧", enabled: true },
  { id: "simulation", label: "Simulation", icon: "◎", enabled: false },
  { id: "manufacture", label: "Manufacture", icon: "⚙", enabled: false },
  { id: "architect", label: "Architect", icon: "⌂", enabled: true, hidden: true },
  { id: "wiring", label: "Wiring Simulator", icon: "⎍", enabled: true },
];

/** Fusion-style design environment tabs shown on the CAD ribbon. */
export const DESIGN_RIBBON_TAB_IDS = [
  "SOLID",
  "ROBOTICS",
  "CATALOG",
  "TEXTURE",
  "CANVAS",
  "EDITOR",
];

const DESIGN_TAB_LABELS = {
  CATALOG: "Parts Catalog",
  EDITOR: "Editor",
  WORKSPACE: "Workspace",
};

const LAUNCH_DESIGN_TABS = new Set(["CANVAS", "EDITOR"]);
const EDITOR_TAB_ICON = `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M6 13l7-7 2 2-7 7H6v-2z"/></svg>`;

const DESIGN_TABS = DESIGN_RIBBON_TAB_IDS.map((id) => ({
  id,
  label: DESIGN_TAB_LABELS[id] || id,
  enabled: true,
}));

/** Sketch stays available to the sketch editor; not shown on the design ribbon. */
const INTERNAL_DESIGN_TABS = [{ id: "SKETCH", label: "SKETCH", enabled: true }];

const REMOVED_DESIGN_RIBBON_TABS = new Set(["ELECTRONICS", "RIGGING", "ARCHITECT", "WORKSPACE"]);

function resolveDesignTab(tab) {
  if (tab === "INSERT") return "CATALOG";
  if (REMOVED_DESIGN_RIBBON_TABS.has(tab) || !tab) return "SOLID";
  if (tab === "SKETCH") return "SKETCH";
  const match = DESIGN_TABS.find((t) => t.id === tab);
  return match?.enabled ? tab : "SOLID";
}

export const WIRING_TABS = [
  { id: "WIRING", label: "WIRING", enabled: true },
  { id: "ELECTRONICS", label: "ELECTRONICS", enabled: true },
  { id: "ROBOTICS", label: "ROBOTICS", enabled: true },
  { id: "CATALOG", label: "Parts Catalog", enabled: true },
  { id: "PARTS_LIST", label: "Parts list", enabled: true },
];

export function createWorkspaceModes(options = {}) {
  const { barEl, menuEl, tabsEl, onChange, onDesignTabChange, onWiringTabChange } = options;
  let mode = "design";
  let designTab = "SOLID";
  let wiringTab = "WIRING";
  let shellHighlight = null;

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = "";
    const tabs = mode === "design" || mode === "architect" ? DESIGN_TABS : mode === "wiring" ? WIRING_TABS : [];
    if (!tabs.length) {
      tabsEl.classList.add("hidden");
      return;
    }
    tabsEl.classList.remove("hidden");
    for (const tab of tabs) {
      const rawActive = mode === "wiring" ? wiringTab : (shellHighlight || designTab);
      const activeTab =
        mode === "wiring"
          ? rawActive
          : DESIGN_TABS.some((t) => t.id === rawActive)
            ? rawActive
            : "SOLID";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "workspace-tab" + (tab.id === activeTab ? " active" : "")
        + (tab.id === "EDITOR" ? " workspace-tab--icon" : "");
      if (tab.id === "EDITOR") {
        btn.innerHTML = `${EDITOR_TAB_ICON}<span>${tab.label}</span>`;
      } else {
        btn.textContent = tab.label;
      }
      btn.disabled = !tab.enabled;
      btn.dataset[mode === "wiring" ? "wiringTab" : "designTab"] = tab.id;
      btn.setAttribute("aria-label", tab.label);
      btn.title = tab.enabled ? `${tab.label} workspace` : "Coming soon";
      btn.addEventListener("click", () => {
        if (!tab.enabled) return;
        if (mode === "wiring") {
          if (wiringTab === tab.id) {
            if (tab.id === "CATALOG" || tab.id === "PARTS_LIST" || tab.id === "ELECTRONICS") onWiringTabChange?.(wiringTab);
            return;
          }
          wiringTab = tab.id;
          renderTabs();
          onWiringTabChange?.(wiringTab);
          return;
        }
        if (LAUNCH_DESIGN_TABS.has(tab.id)) {
          onDesignTabChange?.(tab.id);
          return;
        }
        if (designTab === tab.id) {
          if (tab.id === "CATALOG" || tab.id === "TEXTURE" || tab.id === "ROBOTICS") onDesignTabChange?.(designTab);
          return;
        }
        designTab = tab.id;
        renderTabs();
        onDesignTabChange?.(designTab);
      });
      tabsEl.appendChild(btn);
    }
  }

  function renderMenu() {
    if (!menuEl) return;
    menuEl.innerHTML = "";
    for (const m of WORKSPACE_MODES) {
      if (m.hidden) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "workspace-mode-option" + (m.id === mode ? " active" : "");
      btn.disabled = !m.enabled;
      btn.innerHTML = `<span class="workspace-mode-option-icon">${m.icon}</span><span>${m.label}</span>`;
      if (!m.enabled) btn.title = "Coming soon";
      btn.addEventListener("click", () => {
        if (!m.enabled) return;
        setMode(m.id);
        closeMenu();
      });
      menuEl.appendChild(btn);
    }
  }

  function updateButton() {
    const current = WORKSPACE_MODES.find((m) => m.id === mode) || WORKSPACE_MODES[0];
    if (barEl) {
      barEl.innerHTML = `<span class="workspace-mode-icon">${current.icon}</span><span class="workspace-mode-label">${current.label.toUpperCase()}</span><span class="workspace-mode-caret">▾</span>`;
    }
  }

  function openMenu() {
    menuEl?.classList.remove("hidden");
    renderMenu();
  }

  function closeMenu() {
    menuEl?.classList.add("hidden");
  }

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    if (mode === "wiring") wiringTab = "WIRING";
    if (mode === "architect") designTab = "ARCHITECT";
    updateButton();
    renderTabs();
    onChange?.(mode);
  }

  function setDesignTab(tab, { force = false } = {}) {
    const next = resolveDesignTab(tab);
    if (LAUNCH_DESIGN_TABS.has(next)) {
      onDesignTabChange?.(next);
      return;
    }
    const match =
      next === "SKETCH"
        ? INTERNAL_DESIGN_TABS[0]
        : DESIGN_TABS.find((t) => t.id === next);
    if (!match?.enabled) return;
    if (designTab === next && !force) return;
    designTab = next;
    renderTabs();
    onDesignTabChange?.(designTab);
  }

  function setShellHighlight(id) {
    shellHighlight = id || null;
    renderTabs();
  }

  function setWiringTab(tab) {
    const match = WIRING_TABS.find((t) => t.id === tab);
    if (!match?.enabled) return;
    if (wiringTab === tab) return;
    wiringTab = tab;
    renderTabs();
    onWiringTabChange?.(wiringTab);
  }

  barEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menuEl?.classList.contains("hidden")) openMenu();
    else closeMenu();
  });

  document.addEventListener("click", () => closeMenu());
  menuEl?.addEventListener("click", (e) => e.stopPropagation());

  updateButton();
  renderTabs();

  return {
    getMode() {
      return mode;
    },
    setMode,
    getDesignTab() {
      return designTab;
    },
    setDesignTab,
    setShellHighlight,
    getWiringTab() {
      return wiringTab;
    },
    setWiringTab,
    isDesign() {
      return mode === "design" || mode === "architect";
    },
    isWiring() {
      return mode === "wiring";
    },
    isCanvas() {
      return mode === "canvas";
    },
  };
}
