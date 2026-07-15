/**
 * Collapse Studio / Agent Store / Skills / Docs / Roadmap into a Menu dropdown
 * when the top toolbar can't fit the links without overlapping pick tools.
 */

const TOGGLE_SVG = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M2.75 4a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75Zm0 3.25a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75Zm0 3.25a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75Z"/></svg>`;

function gapOf(el) {
  const style = getComputedStyle(el);
  return (parseFloat(style.gap) || 0) || (parseFloat(style.columnGap) || 0);
}

function contentWidth(el) {
  if (!el) return 0;
  const kids = [...el.children].filter((c) => {
    if (c.classList?.contains("toolbar-nav-toggle")) return false;
    return getComputedStyle(c).display !== "none";
  });
  if (!kids.length) return 0;
  const gap = gapOf(el);
  return kids.reduce((sum, child) => sum + child.offsetWidth, 0) + gap * Math.max(0, kids.length - 1);
}

function ensureStructure(nav) {
  let toggle = nav.querySelector(":scope > .toolbar-nav-toggle");
  let menu = nav.querySelector(":scope > .toolbar-nav-menu");

  if (!menu) {
    menu = document.createElement("div");
    menu.className = "toolbar-nav-menu";
    menu.setAttribute("role", "menu");
    const tabs = [...nav.querySelectorAll(":scope > a.nav-tab")];
    tabs.forEach((tab) => {
      tab.setAttribute("role", "menuitem");
      menu.appendChild(tab);
    });
    nav.appendChild(menu);
  } else {
    menu.querySelectorAll("a.nav-tab").forEach((tab) => tab.setAttribute("role", "menuitem"));
  }

  if (!menu.id) {
    menu.id = `toolbar-nav-menu-${Math.random().toString(36).slice(2, 8)}`;
  }

  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toolbar-nav-toggle";
    toggle.title = "Main menu";
    toggle.innerHTML = `${TOGGLE_SVG}<span class="toolbar-nav-toggle-label">Menu</span>`;
    nav.insertBefore(toggle, menu);
  }

  toggle.setAttribute("aria-haspopup", "true");
  toggle.setAttribute("aria-controls", menu.id);
  if (!toggle.getAttribute("aria-expanded")) toggle.setAttribute("aria-expanded", "false");
  return { toggle, menu };
}

function enhanceNav(nav) {
  if (nav.dataset.toolbarNavReady === "1") return;
  nav.dataset.toolbarNavReady = "1";

  const { toggle, menu } = ensureStructure(nav);
  if (!menu.querySelector("a.nav-tab")) return;

  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!nav.classList.contains("is-open"));
  });

  document.addEventListener("click", (e) => {
    if (!nav.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  const toolbar = nav.closest(".toolbar");
  const pick = toolbar?.querySelector(".toolbar-pick") || null;
  let measuring = false;

  const update = () => {
    if (measuring || !toolbar) return;
    measuring = true;
    const wasOpen = nav.classList.contains("is-open");
    nav.classList.remove("is-compact");
    setOpen(false);
    void toolbar.offsetWidth;

    const brandW = toolbar.querySelector(".brand")?.offsetWidth || 0;
    const adminEl = document.getElementById("btn-admin-dashboard-toolbar");
    const adminW = adminEl && !adminEl.classList.contains("hidden") ? adminEl.offsetWidth : 0;
    const actions = toolbar.querySelector(".toolbar-actions");
    const actionsW = contentWidth(actions);
    const authW = toolbar.querySelector(".auth-widget")?.offsetWidth || 0;
    const linksW = contentWidth(menu);
    const pickNeeded = pick ? contentWidth(pick) : 0;
    const gaps = gapOf(toolbar) * 5;
    const totalNeeded = brandW + adminW + linksW + pickNeeded + actionsW + authW + gaps + 16;
    const infoPage = document.body.classList.contains("info-page");
    const needsCompact = infoPage
      ? brandW + linksW + 56 > toolbar.clientWidth
      : totalNeeded > toolbar.clientWidth || window.innerWidth <= 1180;

    if (needsCompact) nav.classList.add("is-compact");
    if (wasOpen && needsCompact) setOpen(true);
    measuring = false;
  };

  const ro = typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(() => requestAnimationFrame(update))
    : null;
  if (toolbar) ro?.observe(toolbar);
  if (pick) ro?.observe(pick);
  window.addEventListener("resize", () => requestAnimationFrame(update));
  requestAnimationFrame(update);
  setTimeout(update, 120);
  setTimeout(update, 500);

  const adminBtn = document.getElementById("btn-admin-dashboard-toolbar");
  if (adminBtn && typeof MutationObserver !== "undefined") {
    new MutationObserver(() => requestAnimationFrame(update)).observe(adminBtn, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
}

export function initToolbarNav(root = document) {
  root.querySelectorAll("nav.toolbar-nav").forEach(enhanceNav);
}

initToolbarNav();
