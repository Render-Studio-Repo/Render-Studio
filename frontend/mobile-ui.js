/** Mobile layout: full-screen 3D view + bottom dock and slide-up panels. */

const MQ = "(max-width: 900px)";

export function initMobileUI({ onResize } = {}) {
  const mq = window.matchMedia(MQ);
  const backdrop = document.getElementById("mobile-backdrop");
  const dock = document.getElementById("mobile-dock");
  const toolsSheet = document.getElementById("mobile-tools-sheet");
  const ribbonContainer = document.getElementById("ribbon-container");
  const ribbonAnchor = document.getElementById("ribbon-desktop-anchor");
  const leftSidebar = document.querySelector(".sidebar.left");
  const rightSidebar = document.querySelector(".sidebar.right");

  let openId = null;

  ensureSheetHeader(leftSidebar, "Projects & files");
  ensureSheetHeader(rightSidebar, "Edit & AI");
  wireToolTriggers(toolsSheet);
  wireSheetCloses();

  dock?.querySelectorAll("[data-sheet]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.sheet;
      if (openId === id) closeAll();
      else openPanel(id);
    });
  });

  backdrop?.addEventListener("click", closeAll);

  document.getElementById("btn-mobile-menu")?.addEventListener("click", () => {
    if (openId === "tools") closeAll();
    else openPanel("tools");
  });

  function isMobile() {
    return mq.matches;
  }

  function ensureRibbonInAnchor() {
    if (!ribbonContainer || !ribbonAnchor) return;
    if (ribbonContainer.parentElement !== ribbonAnchor) {
      ribbonAnchor.appendChild(ribbonContainer);
    }
    ribbonContainer.classList.remove("ribbon-mobile-embed");
  }

  function setRibbonExpanded(expanded) {
    const body = document.querySelector(".ribbon-body");
    const chev = document.querySelector(".ribbon-chevron");
    if (!body) return;
    body.classList.toggle("ribbon-body--collapsed", !expanded);
    if (chev) {
      chev.textContent = expanded ? "▴" : "▾";
      chev.setAttribute("aria-label", expanded ? "Collapse toolbar" : "Open toolbar");
    }
  }

  function applyLayout() {
    document.body.classList.toggle("is-mobile", isMobile());
    ensureRibbonInAnchor();
    if (isMobile()) {
      closeAll();
      setRibbonExpanded(false);
    } else {
      closeAll();
      setRibbonExpanded(true);
    }
    onResize?.();
  }

  function openPanel(id) {
    if (!isMobile()) return;
    closeAll();
    openId = id;
    backdrop?.classList.remove("hidden");
    document.body.classList.add("mobile-sheet-open");

    if (id === "projects") {
      leftSidebar?.classList.add("mobile-open");
    } else if (id === "edit" || id === "ai") {
      rightSidebar?.classList.add("mobile-open");
      const sel = id === "edit" ? "#edit-panel" : ".prompt-panel";
      const target = rightSidebar?.querySelector(sel);
      requestAnimationFrame(() => {
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else if (id === "tools") {
      toolsSheet?.classList.add("mobile-open");
      setRibbonExpanded(true);
    }

    dock?.querySelectorAll("[data-sheet]").forEach((b) => {
      b.classList.toggle("active", b.dataset.sheet === id);
    });
  }

  function closeAll() {
    openId = null;
    backdrop?.classList.add("hidden");
    document.body.classList.remove("mobile-sheet-open");
    leftSidebar?.classList.remove("mobile-open");
    rightSidebar?.classList.remove("mobile-open");
    toolsSheet?.classList.remove("mobile-open");
    dock?.querySelectorAll("[data-sheet]").forEach((b) => b.classList.remove("active"));
    if (isMobile()) setRibbonExpanded(false);
  }

  mq.addEventListener("change", applyLayout);
  applyLayout();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openId) closeAll();
  });

  return { isMobile, closeAll, openPanel, ensureRibbonPlacement: applyLayout };
}

function ensureSheetHeader(sidebar, title) {
  if (!sidebar || sidebar.querySelector(".mobile-sheet-header")) return;
  const header = document.createElement("div");
  header.className = "mobile-sheet-header";
  header.innerHTML = `
    <h2 class="mobile-sheet-title">${title}</h2>
    <button type="button" class="mobile-sheet-close" aria-label="Close panel">×</button>
  `;
  sidebar.insertBefore(header, sidebar.firstChild);
}

function wireSheetCloses() {
  document.querySelectorAll(".mobile-sheet-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("mobile-backdrop")?.click();
    });
  });
}

function wireToolTriggers(root) {
  if (!root) return;
  root.querySelectorAll("[data-trigger]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.trigger)?.click();
    });
  });
  root.querySelectorAll("[data-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const map = {
        corner: "btn-pick-corner",
        face: "btn-pick-face",
        edge: "btn-pick-edge",
        off: "btn-pick-orbit",
      };
      document.getElementById(map[btn.dataset.pick])?.click();
    });
  });
}
