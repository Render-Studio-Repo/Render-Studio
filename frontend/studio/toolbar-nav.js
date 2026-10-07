/**
 * Collapse Studio / Agent Store / Skills / Docs into a Menu dropdown
 * when the top toolbar can't fit the links without overlapping pick tools.
 */

import { applyVrHeadsetClass, isVrHeadsetBrowser } from "../xr/vr-browser.js?v=20260907-desk-boot-acctovl1-acctui1";

const TOGGLE_SVG = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M2.75 4a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75Zm0 3.25a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75Zm0 3.25a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75Z"/></svg>`;

applyVrHeadsetClass();

function gapOf(el) {
  const style = getComputedStyle(el);
  return (parseFloat(style.gap) || 0) || (parseFloat(style.columnGap) || 0);
}

function ensureToolbarNavBackdrop() {
  let backdrop = document.getElementById("toolbar-nav-backdrop");
  if (backdrop) return backdrop;
  backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.id = "toolbar-nav-backdrop";
  backdrop.className = "chrome-menu-backdrop hidden";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-label", "Close menu");
  document.body.appendChild(backdrop);
  const dismiss = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    document.querySelectorAll("nav.toolbar-nav.is-open").forEach((nav) => {
      nav.classList.remove("is-open");
      nav.querySelector(".toolbar-nav-toggle")?.setAttribute("aria-expanded", "false");
    });
    syncToolbarNavBackdrop(backdrop, false);
  };
  backdrop.addEventListener("click", dismiss);
  return backdrop;
}

function syncToolbarNavBackdrop(backdrop, open) {
  if (!backdrop) return;
  const anyOpen = open || !!document.querySelector("nav.toolbar-nav.is-open");
  backdrop.classList.toggle("hidden", !anyOpen);
  backdrop.hidden = !anyOpen;
  document.body.classList.toggle("toolbar-nav-open", anyOpen);
}

function ensureToolbarNavClose(menu, onClose) {
  if (!menu || menu.querySelector(".toolbar-nav-close")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "toolbar-nav-close";
  btn.setAttribute("aria-label", "Close menu");
  btn.innerHTML = `<span class="chrome-close-x" aria-hidden="true">×</span><span class="chrome-close-label">Close</span>`;
  menu.insertBefore(btn, menu.firstChild);
  const dismiss = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  btn.addEventListener("click", dismiss);
}

function contentWidth(el) {
  if (!el) return 0;
  const tabs = el.classList?.contains("toolbar-nav-menu")
    ? [...el.querySelectorAll("a.nav-tab")]
    : [];
  const kids = (tabs.length ? tabs : [...el.children]).filter((c) => {
    if (c.classList?.contains("toolbar-nav-toggle")) return false;
    return getComputedStyle(c).display !== "none";
  });
  if (!kids.length) return 0;
  const gap = gapOf(el);
  return kids.reduce((sum, child) => sum + child.offsetWidth, 0) + gap * Math.max(0, kids.length - 1);
}

function hideStudioOnViewport(nav) {
  if (!document.getElementById("viewport")) return;
  nav.querySelectorAll('a.nav-tab[href="/"]').forEach((tab) => {
    tab.hidden = true;
    tab.classList.add("nav-tab-studio-home");
    tab.setAttribute("aria-hidden", "true");
  });
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
  hideStudioOnViewport(nav);
  if (!menu.querySelector("a.nav-tab")) return;

  const backdrop = ensureToolbarNavBackdrop();
  ensureToolbarNavClose(menu, () => setOpen(false));

  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    syncToolbarNavBackdrop(backdrop, open);
  };

  const onToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const willOpen = !nav.classList.contains("is-open");
    setOpen(willOpen);
    if (willOpen) {
      window.Render3DMobileChrome?.closeMobileToolsPopup?.();
      window.Render3DMobileChrome?.closeMobileSelectPopup?.();
    }
  };

  // Native click works for touch, mouse and keyboard without a second activation.
  toggle.addEventListener("click", onToggle);

  menu.addEventListener("click", (e) => {
    if (e.target?.closest?.("a.nav-tab, [data-mobile-app]")) setOpen(false);
  });

  document.addEventListener("click", (e) => {
    if (!nav.contains(e.target) && e.target !== backdrop) setOpen(false);
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
    const communityEl = toolbar.querySelector(".toolbar-community");
    const communityW = communityEl ? communityEl.offsetWidth : 0;
    const actions = toolbar.querySelector(".toolbar-actions");
    const actionsW = contentWidth(actions);
    const authW = toolbar.querySelector(".auth-widget")?.offsetWidth || 0;
    const linksW = contentWidth(menu);
    const pickNeeded = pick ? contentWidth(pick) : 0;
    const gaps = gapOf(toolbar) * 5;
    const totalNeeded = brandW + communityW + linksW + pickNeeded + actionsW + authW + gaps + 16;
    const infoPage = document.body.classList.contains("info-page");
    const mobileNav = window.matchMedia("(max-width: 820px), (pointer: coarse) and (max-width: 1024px)").matches;
    const overflow = totalNeeded > toolbar.clientWidth;
    // Studio used to ignore overflow, so adding Tips & Tricks clipped Updates
    // off the right edge instead of collapsing into Menu.
    const needsCompact = infoPage
      ? brandW + linksW + 56 > toolbar.clientWidth
      : mobileNav || isVrHeadsetBrowser() || overflow;

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

  const communityEl = toolbar.querySelector(".toolbar-community");
  if (communityEl && typeof MutationObserver !== "undefined") {
    new MutationObserver(() => requestAnimationFrame(update)).observe(communityEl, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
  }
}

export function initToolbarNav(root = document) {
  root.querySelectorAll("nav.toolbar-nav").forEach(enhanceNav);
}

initToolbarNav();
