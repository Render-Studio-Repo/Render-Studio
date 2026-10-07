/** Online Models catalog — Parts Catalog chrome with Public projects + Marketplace. */

import {
  ONLINE_MODELS_CACHE,
  ONLINE_MODELS_DEFAULT_TAB,
  defaultOnlineModelsTab,
  onlineModelsNeedsLogin,
  publicAuthorHandle,
  publicAuthorName,
  publicAuthorUserId,
  publicProfileHref,
  publicProjectThumbUrl,
  withGuestPublicPin,
  writeOnlineModelsReturn,
} from "./online-models.js?v=onlinemod1";

export { ONLINE_MODELS_CACHE };

const MARKETPLACE_SOURCES = [
  {
    id: "render-store",
    name: "Render marketplace",
    href: "/marketplace.html",
    blurb: "Approved Render Studio listings and seller stores.",
  },
  {
    id: "model-store",
    name: "Model store",
    href: "/model-store.html",
    blurb: "Published models from the in-app store APIs.",
  },
  {
    id: "sketchfab",
    name: "Sketchfab",
    href: "https://sketchfab.com/3d-models?features=downloadable",
    blurb: "External downloadable 3D models. We do not scrape SKUs here.",
  },
];

export function createOnlineModelsPanel({
  api,
  getProjects = () => [],
  getSignedIn = () => false,
  onAction = null,
  onLogin = null,
  onOpenProject = null,
  onStatus = null,
} = {}) {
  const overlay = document.createElement("div");
  overlay.className = "catalog-panel-overlay online-models-overlay hidden";
  overlay.innerHTML = `
    <div class="catalog-panel catalog-panel--store online-models-panel" role="dialog" aria-label="Online Models">
      <div class="catalog-panel-head">
        <div>
          <strong>Online Models</strong>
          <span class="muted small">Public Render projects and marketplace listings.</span>
        </div>
        <button type="button" class="catalog-panel-close" aria-label="Close Online Models">×</button>
      </div>
      <div class="catalog-menu-tabs" role="tablist" aria-label="Online Models">
        <button type="button" class="catalog-menu-tab active" role="tab" aria-selected="true" data-om-tab="public">Public projects</button>
        <button type="button" class="catalog-menu-tab" role="tab" aria-selected="false" data-om-tab="marketplace">Marketplace</button>
      </div>
      <div class="catalog-section" data-om-section="public" role="tabpanel" aria-label="Public projects">
        <div class="catalog-panel-search">
          <input type="text" class="catalog-panel-query" data-om-query placeholder="Search public projects" autocomplete="off" />
          <button type="button" class="btn accent catalog-panel-search-btn" data-om-search>Search</button>
        </div>
        <div class="catalog-panel-status muted small" data-om-status></div>
        <div class="catalog-panel-results" data-om-results></div>
      </div>
      <div class="catalog-section hidden" data-om-section="marketplace" role="tabpanel" aria-label="Marketplace">
        <div class="catalog-panel-search">
          <input type="text" class="catalog-panel-query" data-om-mkt-query placeholder="Search marketplace listings" autocomplete="off" />
          <button type="button" class="btn accent catalog-panel-search-btn" data-om-mkt-search>Search</button>
        </div>
        <div class="catalog-panel-status muted small" data-om-mkt-status></div>
        <div class="catalog-panel-results" data-om-mkt-results></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const queryEl = overlay.querySelector("[data-om-query]");
  const resultsEl = overlay.querySelector("[data-om-results]");
  const statusEl = overlay.querySelector("[data-om-status]");
  const mktQueryEl = overlay.querySelector("[data-om-mkt-query]");
  const mktResultsEl = overlay.querySelector("[data-om-mkt-results]");
  const mktStatusEl = overlay.querySelector("[data-om-mkt-status]");
  let activeTab = ONLINE_MODELS_DEFAULT_TAB;
  let requestGen = 0;
  let onlineModelsAbort = null; // leakfix71
  function beginOnlineModelsFetch() {
    if (onlineModelsAbort) {
      try { onlineModelsAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    onlineModelsAbort = ctl;
    return ctl;
  }
  let menuEl = null;

  function setStatus(el, text, kind = "") {
    if (!el) return;
    el.textContent = text || "";
    el.className = `catalog-panel-status small ${kind}`;
    onStatus?.(kind, text);
  }

  function setTab(id) {
    activeTab = defaultOnlineModelsTab(id);
    overlay.querySelectorAll("[data-om-tab]").forEach((btn) => {
      const on = btn.dataset.omTab === activeTab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    overlay.querySelectorAll("[data-om-section]").forEach((section) => {
      section.classList.toggle("hidden", section.dataset.omSection !== activeTab);
    });
    if (activeTab === "marketplace") void loadMarketplace();
    else renderPublic();
  }

  function closeMenu() {
    menuEl?.remove();
    menuEl = null;
    overlay.classList.remove("online-models-menu-open");
  }

  function rememberReturn(pendingAction = null) {
    writeOnlineModelsReturn({
      tab: activeTab,
      query: activeTab === "marketplace" ? mktQueryEl.value : queryEl.value,
      pendingAction,
    });
  }

  function requestLogin(pendingAction = null) {
    rememberReturn(pendingAction);
    onLogin?.({ tab: "login", pendingAction });
  }

  function runAction(action, project, extra = {}) {
    if (!action || !project) return;
    if (onlineModelsNeedsLogin(action, { signedIn: !!getSignedIn?.() })) {
      requestLogin({ action, projectId: project.id, ...extra });
      return;
    }
    closeMenu();
    onAction?.(action, project, extra);
  }

  function showCardMenu(event, project) {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    overlay.classList.add("online-models-menu-open");
    const signedIn = !!getSignedIn?.();
    const login = (action) => onlineModelsNeedsLogin(action, { signedIn });
    menuEl = document.createElement("div");
    menuEl.className = "folder-context-menu project-context-menu online-models-context-menu";
    menuEl.innerHTML = `
      <div class="component-context-title">
        <strong>${escapeHtml(project.name || project.id || "Project")}</strong>
        <span>${escapeHtml(project.id || "")}</span>
      </div>
      ${login("remix")
        ? `<button type="button" data-om-action="login" data-om-pending="remix">Log in to remix</button>`
        : `<button type="button" data-om-action="remix">Remix</button>`}
      ${login("download")
        ? `<button type="button" data-om-action="login" data-om-pending="download">Log in to download</button>`
        : `<button type="button" data-om-action="download">Download file</button>`}
      <button type="button" data-om-action="prompt-history">View prompt history</button>
      ${login("share")
        ? `<button type="button" data-om-action="login" data-om-pending="share">Log in to share</button>`
        : `<button type="button" data-om-action="share">Share</button>`}
      <button type="button" data-om-action="copy-link">Copy link</button>
      ${login("send-to")
        ? `<button type="button" data-om-action="login" data-om-pending="send-to">Log in to Send to…</button>`
        : `<button type="button" data-om-action="send-to-person">Send to person…</button>
           <button type="button" data-om-action="send-to-team">Send to team…</button>
           <button type="button" data-om-action="send-to-workspace">Send to workspace…</button>`}
      ${login("add-new-project")
        ? `<button type="button" data-om-action="login" data-om-pending="add-new-project">Log in to add to a new project</button>`
        : `<button type="button" data-om-action="add-new-project">Add to a new project</button>
           <button type="button" data-om-action="add-current-project">Add to current project</button>`}
    `;
    document.body.appendChild(menuEl);
    const rect = menuEl.getBoundingClientRect();
    const left = Math.min(event.clientX || 16, window.innerWidth - rect.width - 8);
    const top = Math.min(event.clientY || 16, window.innerHeight - rect.height - 8);
    menuEl.style.left = `${Math.max(8, left)}px`;
    menuEl.style.top = `${Math.max(8, top)}px`;
    menuEl.addEventListener("click", (ev) => {
      const btn = ev.target?.closest("button[data-om-action]");
      if (!btn) return;
      if (btn.dataset.omAction === "login") {
        requestLogin({ action: btn.dataset.omPending, projectId: project.id });
        closeMenu();
        return;
      }
      runAction(btn.dataset.omAction, project);
    });
  }

  function cardHtml(project) {
    const name = project.name || project.id || "Project";
    const author = publicAuthorName(project);
    const href = publicProfileHref(project);
    const thumb = publicProjectThumbUrl(project);
    const pin = project.public_pinned ? `<span class="proj-public-pin-badge">Pinned</span>` : "";
    return `
      <article class="catalog-product-card online-models-card${project.public_pinned ? " is-pinned" : ""}" data-om-project="${escapeAttr(project.id)}">
        <div class="catalog-product-thumb">
          ${thumb
            ? `<img src="${escapeAttr(thumb)}" alt="" loading="lazy" />`
            : `<span class="catalog-product-thumb-fallback">${escapeHtml(name.slice(0, 2))}</span>`}
        </div>
        <div class="catalog-product-body">
          <h4 class="catalog-product-title">${escapeHtml(name)}</h4>
          <p class="catalog-product-meta">${pin} By ${href
            ? `<a href="${escapeAttr(href)}" data-om-profile>${escapeHtml(author)}</a>`
            : escapeHtml(author)}</p>
        </div>
      </article>
    `;
  }

  function bindCards(root, projects) {
    root.querySelectorAll("[data-om-project]").forEach((card) => {
      const project = projects.find((p) => String(p.id) === String(card.dataset.omProject));
      if (!project) return;
      card.addEventListener("click", (ev) => {
        if (ev.target?.closest?.("[data-om-profile], [data-om-action]")) return;
        onOpenProject?.(project.id);
      });
      card.addEventListener("contextmenu", (ev) => showCardMenu(ev, project));
      card.querySelector("[data-om-profile]")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        runAction("profile", project, {
          handle: publicAuthorHandle(project),
          userId: publicAuthorUserId(project),
        });
      });
    });
  }

  function renderPublic() {
    const q = String(queryEl.value || "").trim().toLowerCase();
    const all = withGuestPublicPin((getProjects?.() || []).filter((p) => p?.public || p?.folder_id === "__public__"));
    const rows = q
      ? all.filter((p) => [p.name, p.id, p.owner_name, p.owner_handle].some((v) => String(v || "").toLowerCase().includes(q)))
      : all;
    if (!rows.length) {
      resultsEl.innerHTML = `<p class="muted small catalog-empty">${q ? "No public projects match that search." : "No public projects yet."}</p>`;
      setStatus(statusEl, q ? "No matches." : "Public folder is empty.");
      return;
    }
    resultsEl.innerHTML = `
      <div class="catalog-store-head">
        <h3>Public projects</h3>
        <span class="muted small">${rows.length} model${rows.length === 1 ? "" : "s"}</span>
      </div>
      <div class="catalog-product-grid online-models-grid"></div>
    `;
    resultsEl.querySelector(".online-models-grid").innerHTML = rows.map(cardHtml).join("");
    bindCards(resultsEl, rows);
    setStatus(statusEl, `${rows.length} public project${rows.length === 1 ? "" : "s"}.`);
  }

  function listingCard(item) {
    const name = item.name || item.title || item.slug || item.id || "Listing";
    const href = item.slug ? `/marketplace.html#/p/${encodeURIComponent(item.kind || "model")}/${encodeURIComponent(item.slug)}` : "/marketplace.html";
    const thumb = item.thumbnail || item.icon_url || item.preview_url || "";
    const seller = item.owner?.name || item.owner_name || "";
    return `
      <a class="catalog-product-card online-models-card" href="${escapeAttr(href)}">
        <div class="catalog-product-thumb">
          ${thumb
            ? `<img src="${escapeAttr(thumb)}" alt="" loading="lazy" />`
            : `<span class="catalog-product-thumb-fallback">${escapeHtml(name.slice(0, 2))}</span>`}
        </div>
        <div class="catalog-product-body">
          <h4 class="catalog-product-title">${escapeHtml(name)}</h4>
          <p class="catalog-product-meta">${escapeHtml([item.kind || "model", seller].filter(Boolean).join(" · "))}</p>
        </div>
      </a>
    `;
  }

  async function loadMarketplace() {
    const gen = ++requestGen;
    const ctl = beginOnlineModelsFetch();
    const q = String(mktQueryEl.value || "").trim().toLowerCase();
    if (!mktResultsEl.querySelector(".catalog-product-card")) setStatus(mktStatusEl, "Loading marketplace…");
    let listings = [];
    let loginRequired = false;
    let disabled = false;
    try {
      const [catalog, models] = await Promise.all([
        api("/api/marketplace/catalog", { signal: ctl.signal }).catch((err) => {
          if (ctl.signal.aborted || err?.name === "AbortError") throw err;
          return {};
        }),
        api("/api/model-listings", { signal: ctl.signal }).catch((err) => {
          if (ctl.signal.aborted || err?.name === "AbortError") throw err;
          return {};
        }),
      ]);
      if (ctl.signal.aborted || gen !== requestGen) return;
      listings = [
        ...(catalog.listings || catalog.featured || []),
        ...(models.listings || []),
      ];
      loginRequired = !!catalog.login_required;
      disabled = !!catalog.disabled;
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError" || gen !== requestGen) return;
      setStatus(mktStatusEl, err.message || "Could not load marketplace.", "error");
    } finally {
      if (onlineModelsAbort === ctl) onlineModelsAbort = null;
    }
    const seen = new Set();
    listings = listings.filter((item) => {
      const key = String(item.id || item.slug || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (q) {
      listings = listings.filter((item) => [item.name, item.title, item.slug, item.owner?.name].some((v) => String(v || "").toLowerCase().includes(q)));
    }
    const sources = MARKETPLACE_SOURCES.map((src) => `
      <a class="insert-source-card online-models-source" href="${escapeAttr(src.href)}" ${src.href.startsWith("http") ? 'target="_blank" rel="noopener"' : ""}>
        <span class="insert-source-copy">
          <strong>${escapeHtml(src.name)}</strong>
          <small>${escapeHtml(src.blurb)}</small>
        </span>
      </a>
    `).join("");
    if (!listings.length) {
      mktResultsEl.innerHTML = `
        <p class="muted small catalog-empty">${
          loginRequired
            ? "Sign in to browse the hosted marketplace catalog."
            : disabled
              ? "The hosted marketplace is off on this instance."
              : q
                ? "No marketplace listings match that search."
                : "No hosted marketplace listings yet. External catalogs stay on their own sites — we do not invent SKUs."
        }</p>
        <div class="catalog-mcmaster-stack">${sources}</div>
      `;
      setStatus(mktStatusEl, loginRequired ? "Log in to browse listings." : "External marketplaces + existing catalog APIs.");
      return;
    }
    mktResultsEl.innerHTML = `
      <div class="catalog-store-head">
        <h3>Marketplace</h3>
        <span class="muted small">${listings.length} listing${listings.length === 1 ? "" : "s"}</span>
      </div>
      <div class="catalog-product-grid online-models-grid">${listings.map(listingCard).join("")}</div>
      <p class="muted small">Hosted listings use Render’s catalog APIs. Sketchfab and other stores are linked, not scraped.</p>
      <div class="catalog-mcmaster-stack">${sources}</div>
    `;
    setStatus(mktStatusEl, `${listings.length} listing${listings.length === 1 ? "" : "s"}.`);
  }

  function open({ tab = ONLINE_MODELS_DEFAULT_TAB, query = "" } = {}) {
    overlay.classList.remove("hidden");
    if (query) queryEl.value = query;
    setTab(defaultOnlineModelsTab(tab));
    rememberReturn();
    (activeTab === "marketplace" ? mktQueryEl : queryEl)?.focus?.();
  }

  function close() {
    overlay.classList.add("hidden");
    closeMenu();
  }

  overlay.querySelector(".catalog-panel-close")?.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelectorAll("[data-om-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.omTab));
  });
  overlay.querySelector("[data-om-search]")?.addEventListener("click", renderPublic);
  queryEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      renderPublic();
    }
  });
  overlay.querySelector("[data-om-mkt-search]")?.addEventListener("click", () => void loadMarketplace());
  mktQueryEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void loadMarketplace();
    }
  });
  document.addEventListener("click", (e) => {
    if (menuEl && !menuEl.contains(e.target) && !e.target.closest?.(".online-models-card")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
      if (menuEl) closeMenu();
      else close();
    }
  });

  return {
    open,
    close,
    isOpen: () => !overlay.classList.contains("hidden"),
    getTab: () => activeTab,
    setTab,
    refresh: () => {
      if (overlay.classList.contains("hidden")) return;
      if (activeTab === "marketplace") void loadMarketplace();
      else renderPublic();
    },
  };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
