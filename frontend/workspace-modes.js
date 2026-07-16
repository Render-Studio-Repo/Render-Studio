/** Fusion-style workspace mode switcher (Design, Wiring Simulator, …). */

export const WORKSPACE_MODES = [
  { id: "design", label: "Design", icon: "◧", enabled: true },
  { id: "simulation", label: "Simulation", icon: "◎", enabled: false },
  { id: "manufacture", label: "Manufacture", icon: "⚙", enabled: false },
  { id: "architect", label: "Architect", icon: "⌂", enabled: true },
  { id: "wiring", label: "Wiring Simulator", icon: "⎍", enabled: true },
];

/** Fusion-style design environment tabs (SOLID, SKETCH, …). */
const DESIGN_TABS = [
  { id: "SOLID", label: "SOLID", enabled: true },
  { id: "SKETCH", label: "SKETCH", enabled: true },
  { id: "RIGGING", label: "RIGGING", enabled: true },
  { id: "ARCHITECT", label: "ARCHITECT", enabled: true },
  { id: "CATALOG", label: "CATALOG", enabled: true },
  { id: "TEXTURE", label: "TEXTURE", enabled: true },
  { id: "CANVAS", label: "CANVAS", enabled: true },
];

const WIRING_TABS = [
  { id: "WIRING", label: "WIRING", enabled: true },
  { id: "CATALOG", label: "CATALOG", enabled: true },
  { id: "TEXTURE", label: "TEXTURE", enabled: true },
];

export function createWorkspaceModes(options = {}) {
  const { barEl, menuEl, tabsEl, onChange, onDesignTabChange, onWiringTabChange } = options;
  let mode = "design";
  let designTab = "SOLID";
  let wiringTab = "WIRING";

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
      const activeTab = mode === "wiring" ? wiringTab : designTab;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "workspace-tab" + (tab.id === activeTab ? " active" : "");
      btn.textContent = tab.label;
      btn.disabled = !tab.enabled;
      btn.dataset[mode === "wiring" ? "wiringTab" : "designTab"] = tab.id;
      btn.title = tab.enabled ? `${tab.label} workspace` : "Coming soon";
      btn.addEventListener("click", () => {
        if (!tab.enabled) return;
        if (mode === "wiring") {
          if (wiringTab === tab.id) {
            if (tab.id === "CATALOG" || tab.id === "TEXTURE") onWiringTabChange?.(wiringTab);
            return;
          }
          wiringTab = tab.id;
          renderTabs();
          onWiringTabChange?.(wiringTab);
          return;
        }
        if (designTab === tab.id) {
          if (tab.id === "CATALOG" || tab.id === "TEXTURE" || tab.id === "CANVAS") onDesignTabChange?.(designTab);
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

  function setDesignTab(tab) {
    const match = DESIGN_TABS.find((t) => t.id === tab);
    if (!match?.enabled) return;
    if (designTab === tab) return;
    designTab = tab;
    renderTabs();
    onDesignTabChange?.(designTab);
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
