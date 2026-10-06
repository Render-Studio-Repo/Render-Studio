/** Amazon-style storefront over the open step.parts STEP catalog (~16k models). */

const DEPARTMENTS = [
  { id: "popular", label: "Popular", category: "", query: "" },
  { id: "electronics", label: "Electronics", category: "electronics" },
  { id: "fastener", label: "Fasteners", category: "fastener" },
  { id: "actuator", label: "Motors & servos", category: "actuator" },
  { id: "bearing", label: "Bearings", category: "bearing" },
  { id: "motion", label: "Linear motion", category: "motion" },
  { id: "power-transmission", label: "Gears & belts", category: "power-transmission" },
  { id: "mechanical-hardware", label: "Hardware", category: "mechanical-hardware" },
  { id: "enclosure", label: "Enclosures", category: "enclosure" },
  { id: "thermal", label: "Fans & heatsinks", category: "thermal" },
];

const MCMASTER_LOGO = "/assets/brands/mcmaster-carr-masthead.svg";
const SEARCH_HISTORY_KEY = "render3d:parts-search-history:v1";
const SUPPLIERS = {
  amazon: { label: "Amazon", search: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}` },
  walmart: { label: "Walmart", search: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}` },
  mcmaster: { label: "McMaster-Carr", search: (q) => `https://www.mcmaster.com/search?q=${encodeURIComponent(q)}` },
  newegg: { label: "Newegg", search: (q) => `https://www.newegg.com/p/pl?d=${encodeURIComponent(q)}` },
  digikey: { label: "DigiKey", search: (q) => `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(q)}` },
  mouser: { label: "Mouser", search: (q) => `https://www.mouser.com/c/?q=${encodeURIComponent(q)}` },
  adafruit: { label: "Adafruit", search: (q) => `https://www.adafruit.com/search?q=${encodeURIComponent(q)}` },
};

export function supplierSearchUrl(id, query) {
  const q = String(query || "").trim();
  return q && SUPPLIERS[id] ? SUPPLIERS[id].search(q) : "";
}

export function loadPartsSearchHistory(storage = globalThis.localStorage) {
  try {
    const rows = JSON.parse(storage?.getItem?.(SEARCH_HISTORY_KEY) || "[]");
    return Array.isArray(rows) ? rows.filter((row) => typeof row === "string").slice(0, 20) : [];
  } catch { return []; }
}

export function savePartsSearchHistory(rows, storage = globalThis.localStorage) {
  const clean = [...new Set(rows.map((row) => String(row || "").trim()).filter(Boolean))].slice(0, 20);
  try { storage?.setItem?.(SEARCH_HISTORY_KEY, JSON.stringify(clean)); } catch { /* ignore */ }
  return clean;
}

export const CATALOG_LAYOUT_KEY = "render3d:catalog-layout:v1";
export const CATALOG_MENU_IDS = ["parts", "mcmaster", "list"];
const CATALOG_PANE_IDS = ["parts", "mcmaster"];
const SPLIT_MIN = 0.28;
const SPLIT_MAX = 0.72;

export function defaultCatalogLayout() {
  return { split: false, ratio: 0.5, catalogTab: "parts" };
}

export function parseCatalogLayout(raw) {
  const fallback = defaultCatalogLayout();
  let data = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch { return fallback; }
  }
  if (!data || typeof data !== "object") return fallback;
  const ratio = Number(data.ratio);
  return {
    split: data.split === true,
    ratio: Number.isFinite(ratio) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio)) : 0.5,
    catalogTab: data.catalogTab === "mcmaster" ? "mcmaster" : "parts",
  };
}

export function loadCatalogLayout(storage = globalThis.localStorage) {
  try {
    return parseCatalogLayout(storage?.getItem?.(CATALOG_LAYOUT_KEY));
  } catch {
    return defaultCatalogLayout();
  }
}

export function saveCatalogLayout(layout, storage = globalThis.localStorage) {
  const next = parseCatalogLayout(layout);
  try { storage?.setItem?.(CATALOG_LAYOUT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

function resolveMenu(id) {
  return CATALOG_MENU_IDS.includes(id) ? id : "parts";
}

function resolvePane(id) {
  return CATALOG_PANE_IDS.includes(id) ? id : "parts";
}

export function createCatalogPanel({
  api,
  getProjectId,
  onImport,
  onSendToWiring = null,
  onStatus,
  onLoadMcMaster = null,
  onManageMcMasterSteps = null,
  onMountPartsList = null,
} = {}) {
  const overlay = document.createElement("div");
  overlay.className = "catalog-panel-overlay hidden";
  overlay.innerHTML = `
    <div class="catalog-panel catalog-panel--store" role="dialog" aria-label="Parts Catalog">
      <div class="catalog-panel-head">
        <div>
          <strong>Parts Catalog</strong>
          <span class="muted small">Browse STEP models, load McMaster-Carr, or manage McMaster STEP files.</span>
        </div>
        <button type="button" class="catalog-panel-close" aria-label="Close Parts Catalog">×</button>
      </div>
      <div class="catalog-menu-tabs" role="tablist" aria-label="Parts Catalog">
        <button type="button" class="catalog-menu-tab active" role="tab" aria-selected="true" data-catalog-menu="parts">Browse parts</button>
        <button type="button" class="catalog-menu-tab" role="tab" aria-selected="false" data-catalog-menu="mcmaster">McMaster-Carr</button>
        <button type="button" class="catalog-menu-tab" role="tab" aria-selected="false" data-catalog-menu="list">My Parts List</button>
        <button type="button" class="catalog-menu-tab catalog-split-toggle" aria-pressed="false" title="Show My Parts List beside another catalog tab">Split view</button>
      </div>
      <div class="catalog-body">
        <div class="catalog-section hidden catalog-parts-list" data-catalog-section="list" role="tabpanel" aria-label="My Parts List">
          <div class="assist-content catalog-parts-host"></div>
        </div>
        <div class="catalog-split-gutter hidden" role="separator" aria-orientation="vertical" aria-label="Resize parts list"></div>
        <div class="catalog-section" data-catalog-section="parts" role="tabpanel" aria-label="Browse parts">
          <div class="catalog-source-hero">
            <img src="/assets/parts/source-your-parts.svg" alt="Source your Parts lettering assembled with screws and mechanical components" />
            <div class="catalog-source-notes">
              <span><i aria-hidden="true"></i>Search for a part manually across suppliers.</span>
              <span><i aria-hidden="true"></i>Revisit and manage your search history.</span>
            </div>
          </div>
          <div class="catalog-panel-search">
            <input type="text" class="catalog-panel-query" placeholder="Search parts, e.g. Arduino Nano, NEMA 17, M3 screw" autocomplete="off" />
            <select class="catalog-supplier-select" aria-label="Compare with supplier">
              <option value="">Catalog only</option>
              <option value="mcmaster">McMaster-Carr</option>
              <option value="amazon">Amazon</option>
              <option value="walmart">Walmart</option>
              <option value="newegg">Newegg</option>
              <option value="digikey">DigiKey</option>
              <option value="mouser">Mouser</option>
              <option value="adafruit">Adafruit</option>
            </select>
            <button type="button" class="btn accent catalog-panel-search-btn">Search</button>
          </div>
          <div class="catalog-history"><span>Recent searches</span><div class="catalog-history-items"></div><button type="button" class="catalog-history-clear">Clear all</button></div>
          <div class="catalog-compare hidden" aria-label="Supplier comparison">
            <div class="catalog-compare-head"><strong>Compare suppliers</strong><button type="button" class="catalog-compare-close" aria-label="Close comparison">×</button></div>
            <div class="catalog-compare-grid"></div>
            <p class="catalog-compare-note">Open each result to check the live price. Amazon checkout stays on Amazon.</p>
          </div>
          <p class="catalog-browse-label">Departments</p>
          <div class="catalog-category-chips" role="tablist" aria-label="Parts Catalog departments">
            ${DEPARTMENTS.map(
              (d, i) => `<button type="button" class="catalog-category-chip${i === 0 ? " active" : ""}" data-catalog-dept="${escapeAttr(d.id)}" data-category="${escapeAttr(d.category || "")}">${escapeHtml(d.label)}</button>`
            ).join("")}
          </div>
          <div class="catalog-panel-status muted small"></div>
          <div class="catalog-panel-results"></div>
        </div>
        <div class="catalog-section hidden" data-catalog-section="mcmaster" role="tabpanel" aria-label="McMaster-Carr">
          <p class="muted small catalog-mcmaster-lead">McMaster-Carr lives in this catalog. Load the live site, or open the tab that stages and inserts downloaded STEP files.</p>
          <div class="catalog-mcmaster-stack">
            <button type="button" class="insert-source-card catalog-mcmaster-action" data-catalog-mcmaster-load>
              <span class="insert-source-icon insert-source-icon--logo" aria-hidden="true">
                <img src="${MCMASTER_LOGO}" alt="" width="120" height="18" />
              </span>
              <span class="insert-source-copy">
                <strong>Load McMaster-Carr</strong>
                <small>Open the live catalog to search part numbers and fetch STEP onto the server</small>
              </span>
            </button>
            <button type="button" class="insert-source-card catalog-mcmaster-action" data-catalog-mcmaster-steps>
              <span class="insert-source-icon catalog-mcmaster-steps-icon" aria-hidden="true">STEP</span>
              <span class="insert-source-copy">
                <strong>Manage STEP files</strong>
                <small>Open the McMaster-Carr tab to stage downloads, pick STEP files, and insert them into this project</small>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const panelEl = overlay.querySelector(".catalog-panel");
  const queryEl = overlay.querySelector(".catalog-panel-query");
  const supplierEl = overlay.querySelector(".catalog-supplier-select");
  const compareEl = overlay.querySelector(".catalog-compare");
  const historyItemsEl = overlay.querySelector(".catalog-history-items");
  const resultsEl = overlay.querySelector(".catalog-panel-results");
  const statusEl = overlay.querySelector(".catalog-panel-status");
  const splitBtn = overlay.querySelector(".catalog-split-toggle");
  const gutterEl = overlay.querySelector(".catalog-split-gutter");
  const partsHost = overlay.querySelector(".catalog-parts-host");
  const saved = loadCatalogLayout();
  let searchTimer = 0;
  let lastAutoQuery = "";
  let activeDept = "popular";
  let requestGen = 0;
  let catalogMenu = saved.split ? saved.catalogTab : "parts";
  let catalogPane = saved.catalogTab;
  let splitOn = saved.split;
  let splitRatio = saved.ratio;
  let partsListPid = "";
  let history = loadPartsSearchHistory();

  function renderHistory() {
    historyItemsEl.innerHTML = history.length ? history.map((q) => `<span class="catalog-history-entry"><button type="button" data-history-query="${escapeAttr(q)}">${escapeHtml(q)}</button><button type="button" data-history-remove="${escapeAttr(q)}" aria-label="Remove ${escapeAttr(q)} from search history">×</button></span>`).join("") : '<small>No searches yet</small>';
  }

  function rememberSearch(q) {
    if (!q) return;
    history = savePartsSearchHistory([q, ...history.filter((row) => row !== q)]);
    renderHistory();
  }

  function showComparison(q) {
    const supplier = supplierEl.value;
    if (!q || !supplier || !SUPPLIERS[supplier]) { compareEl.classList.add("hidden"); return; }
    const grid = compareEl.querySelector(".catalog-compare-grid");
    grid.innerHTML = (supplier === "amazon" ? ["amazon"] : ["amazon", supplier]).map((id) => {
      const href = supplierSearchUrl(id, q);
      return `<section class="catalog-compare-card"><div><strong>${escapeHtml(SUPPLIERS[id].label)}</strong><span>“${escapeHtml(q)}”</span></div><p>View current listings and prices on ${escapeHtml(SUPPLIERS[id].label)}.</p><a class="btn accent" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${id === "amazon" ? "Shop on Amazon" : "Search supplier"} ↗</a><label>Price found ($) <input type="number" min="0" step="0.01" inputmode="decimal" data-compare-price="${id}" placeholder="Enter price" /></label>${id === "amazon" ? '<small>Choose a product there to add it to your Amazon cart.</small>' : ""}</section>`;
    }).join("");
    compareEl.classList.remove("hidden");
    compareEl.querySelector(".catalog-compare-note").textContent = "Enter the prices you find to compare them here. Amazon checkout stays on Amazon.";
  }

  function persistLayout() {
    saveCatalogLayout({ split: splitOn, ratio: splitRatio, catalogTab: catalogPane });
  }

  function visibleSections() {
    if (splitOn) return new Set(["list", catalogPane]);
    return new Set([catalogMenu]);
  }

  function mountPartsList() {
    if (!partsHost) return;
    const pid = String(getProjectId?.() || "");
    if (partsListPid === pid && partsHost.querySelector(".assist-tabs")) return;
    partsListPid = pid;
    if (typeof onMountPartsList === "function") {
      onMountPartsList(partsHost, { tab: "home" });
      return;
    }
    document.dispatchEvent(new CustomEvent("render:open-parts", { detail: { tab: "home", host: partsHost } }));
  }

  function applyLayout() {
    const shown = visibleSections();
    panelEl.classList.toggle("catalog-panel--split", splitOn);
    panelEl.style.setProperty("--catalog-split-left", `${Math.round(splitRatio * 1000) / 10}%`);
    splitBtn?.setAttribute("aria-pressed", splitOn ? "true" : "false");
    splitBtn?.classList.toggle("active", splitOn);
    overlay.querySelectorAll("[data-catalog-menu]").forEach((btn) => {
      const id = btn.dataset.catalogMenu;
      const on = splitOn ? id === "list" || id === catalogPane : id === catalogMenu;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    overlay.querySelectorAll("[data-catalog-section]").forEach((section) => {
      section.classList.toggle("hidden", !shown.has(section.dataset.catalogSection));
    });
    gutterEl?.classList.toggle("hidden", !splitOn);
    if (shown.has("list") && !overlay.classList.contains("hidden")) mountPartsList();
  }

  function setCatalogMenu(id) {
    const next = resolveMenu(id);
    catalogMenu = next;
    if (next !== "list") catalogPane = resolvePane(next);
    persistLayout();
    applyLayout();
  }

  function setSplit(on) {
    splitOn = !!on;
    if (splitOn && catalogMenu !== "list") catalogPane = resolvePane(catalogMenu);
    persistLayout();
    applyLayout();
  }

  function setStatus(text, kind = "") {
    statusEl.textContent = text || "";
    statusEl.className = `catalog-panel-status small ${kind}`;
    onStatus?.(kind, text);
  }

  function syncDeptChips() {
    overlay.querySelectorAll("[data-catalog-dept]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.catalogDept === activeDept);
    });
  }

  function initials(name) {
    const parts = String(name || "Part").trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p.slice(0, 1).toUpperCase()).join("") || "P";
  }

  function specLink(candidate, query) {
    return candidate.datasheet_url || candidate.page_url
      || `https://www.google.com/search?q=${encodeURIComponent(`${candidate.name || query} datasheet pdf`)}`;
  }

  function renderResults(candidates, { heading = "", query = "", shopLinks = [] } = {}) {
    const parts = (candidates || []).filter((c) => c?.step_url || c?.png_url || c?.is_real_result);
    if (!parts.length) {
      resultsEl.innerHTML = `<p class="muted small catalog-empty">No STEP models for that search. Try a department above, or a shorter part name.</p>`;
      return;
    }
    const title = heading || (query ? `Results for “${query}”` : "Popular right now");
    resultsEl.innerHTML = `
      <div class="catalog-store-head">
        <h3>${escapeHtml(title)}</h3>
        <span class="muted small">${parts.length} part${parts.length === 1 ? "" : "s"} with downloadable STEP</span>
      </div>
      <div class="catalog-product-grid"></div>
    `;
    const grid = resultsEl.querySelector(".catalog-product-grid");
    for (const candidate of parts) {
      const card = document.createElement("article");
      card.className = "catalog-product-card";
      const buy = (candidate.price_links || shopLinks || []).slice(0, 3);
      const canImport = Boolean(candidate.step_url);
      card.innerHTML = `
        <div class="catalog-product-thumb${candidate.png_url ? "" : " catalog-product-thumb--empty"}">
          ${candidate.png_url
            ? `<img src="${escapeAttr(candidate.png_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="const p=this.parentElement;this.remove();if(p)p.classList.add('catalog-product-thumb--empty')" />`
            : ""}
          <span class="catalog-product-thumb-fallback">${escapeHtml(initials(candidate.name))}</span>
        </div>
        <div class="catalog-product-body">
          <h4 class="catalog-product-title">${escapeHtml(candidate.name || candidate.id || "Catalog part")}</h4>
          <p class="catalog-product-meta">${escapeHtml([candidate.category, candidate.family].filter(Boolean).join(" · ") || "step.parts")}</p>
          ${candidate.description ? `<p class="catalog-product-desc">${escapeHtml(candidate.description)}</p>` : ""}
          <div class="catalog-product-actions">
            <button type="button" class="btn accent catalog-import" ${canImport ? "" : "disabled"}>${canImport ? "Add to project" : "No STEP"}</button>
            <button type="button" class="btn secondary catalog-send-wiring">Send to wiring</button>
            <a class="btn secondary" href="${escapeAttr(specLink(candidate, query))}" target="_blank" rel="noopener">Datasheet</a>
          </div>
          ${buy.length ? `<div class="catalog-price-links">${buy.map((link) => `<a href="${escapeAttr(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.provider)}</a>`).join("")}</div>` : ""}
        </div>
      `;
      card.querySelector(".catalog-import")?.addEventListener("click", async (e) => {
        if (!getProjectId?.()) {
          setStatus("Create or select a project before importing.", "error");
          return;
        }
        const button = e.currentTarget;
        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = "Adding…";
        setStatus(`Importing ${candidate.name || "part"}…`);
        try {
          const result = await onImport?.(candidate);
          setStatus(result ? `Imported ${candidate.name || "part"}.` : "Import cancelled.", result ? "ok" : "");
        } catch (err) {
          setStatus(err.message || "Import failed.", "error");
        } finally {
          button.disabled = !canImport;
          button.textContent = originalText;
        }
      });
      card.querySelector(".catalog-send-wiring")?.addEventListener("click", async (e) => {
        const button = e.currentTarget;
        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = "Sending…";
        setStatus(`Sending ${candidate.name || "part"} to wiring…`);
        try {
          const result = await onSendToWiring?.(candidate);
          setStatus(
            result ? `Linked ${candidate.name || "part"} in Wiring.` : "Could not send to wiring.",
            result ? "ok" : "error",
          );
        } catch (err) {
          setStatus(err.message || "Could not send to wiring.", "error");
        } finally {
          button.disabled = false;
          button.textContent = originalText;
        }
      });
      grid.appendChild(card);
    }
  }

  let catalogSearchAbort = null; // leakfix64
  function beginCatalogSearchFetch() {
    if (catalogSearchAbort) {
      try { catalogSearchAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    catalogSearchAbort = ctl;
    return ctl;
  }

  async function search({ query, category, heading } = {}) {
    const q = String(query ?? queryEl.value ?? "").trim();
    if (q) rememberSearch(q);
    showComparison(q);
    const cat = String(category ?? "").trim();
    const gen = ++requestGen;
    const ctl = beginCatalogSearchFetch();
    if (!resultsEl.querySelector(".catalog-product-card")) setStatus("Loading catalog…");
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (cat) params.set("category", cat);
      params.set("sources", "step_parts");
      params.set("limit", "36");
      const data = await api(`/api/catalog/search?${params.toString()}`, { signal: ctl.signal });
      if (ctl.signal.aborted || gen !== requestGen) return;
      const parts = data.candidates || [];
      renderResults(parts, {
        heading: heading || data.heading || (q ? `Results for “${q}”` : "Popular right now"),
        query: data.query || q,
        shopLinks: data.shop_links || data.price_links || [],
      });
      const errors = data.errors ? Object.values(data.errors) : [];
      setStatus(
        `${parts.length} STEP model${parts.length === 1 ? "" : "s"}.${errors.length ? " Catalog source had an error." : ""}`,
        errors.length ? "warn" : "ok",
      );
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError" || gen !== requestGen) return;
      setStatus(err.message || "Catalog search failed.", "error");
    } finally {
      if (catalogSearchAbort === ctl) catalogSearchAbort = null;
    }
  }

  function loadDepartment(id) {
    const dept = DEPARTMENTS.find((d) => d.id === id) || DEPARTMENTS[0];
    activeDept = dept.id;
    syncDeptChips();
    lastAutoQuery = "";
    if (dept.id === "popular") {
      queryEl.value = "";
      return search({ query: "", category: "", heading: "Popular right now" });
    }
    queryEl.value = "";
    return search({
      query: "",
      category: dept.category,
      heading: dept.label,
    });
  }

  function scheduleSearch() {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const q = queryEl.value.trim();
      if (q.length >= 2 && q !== lastAutoQuery) {
        lastAutoQuery = q;
        activeDept = "";
        syncDeptChips();
        void search({ query: q });
      } else if (!q && lastAutoQuery) {
        lastAutoQuery = "";
        void loadDepartment("popular");
      }
    }, 280);
  }

  function maybeLoadBrowse() {
    if (splitOn ? catalogPane === "parts" : catalogMenu === "parts") {
      if (queryEl.value.trim()) {
        activeDept = "";
        syncDeptChips();
        void search({ query: queryEl.value });
      } else {
        void loadDepartment(activeDept || "popular");
      }
    }
  }

  function open(initialQuery = "", opts = {}) {
    let query = initialQuery;
    let section = opts.section;
    if (query && typeof query === "object") {
      section = query.section || section;
      query = query.query || "";
    }
    overlay.classList.remove("hidden");
    if (section) setCatalogMenu(resolveMenu(section));
    else applyLayout();
    if (catalogMenu === "mcmaster" && !splitOn) return;
    queryEl.value = query || queryEl.value || "";
    lastAutoQuery = "";
    if (splitOn ? catalogPane === "parts" : catalogMenu === "parts") queryEl.focus();
    maybeLoadBrowse();
  }

  function close() {
    overlay.classList.add("hidden");
    window.clearTimeout(searchTimer);
  }

  overlay.querySelectorAll("[data-catalog-menu]").forEach((btn) => {
    btn.addEventListener("click", () => setCatalogMenu(btn.dataset.catalogMenu));
  });
  splitBtn?.addEventListener("click", () => setSplit(!splitOn));
  partsHost?.addEventListener("catalog-parts-close", close);
  overlay.querySelector("[data-catalog-mcmaster-load]")?.addEventListener("click", () => {
    close();
    onLoadMcMaster?.();
  });
  overlay.querySelector("[data-catalog-mcmaster-steps]")?.addEventListener("click", () => {
    close();
    onManageMcMasterSteps?.();
  });
  overlay.querySelector(".catalog-panel-close")?.addEventListener("click", close);
  overlay.querySelector(".catalog-panel-search-btn")?.addEventListener("click", () => {
    activeDept = "";
    syncDeptChips();
    void search({ query: queryEl.value });
  });
  overlay.querySelectorAll("[data-catalog-dept]").forEach((btn) => {
    btn.addEventListener("click", () => void loadDepartment(btn.dataset.catalogDept));
  });
  queryEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      window.clearTimeout(searchTimer);
      lastAutoQuery = queryEl.value.trim();
      activeDept = "";
      syncDeptChips();
      void search({ query: queryEl.value });
    }
  });
  queryEl.addEventListener("input", scheduleSearch);
  supplierEl.addEventListener("change", () => showComparison(queryEl.value.trim()));
  document.addEventListener("render:compare-part", (event) => {
    const q = String(event.detail?.query || "").trim();
    const supplier = String(event.detail?.supplier || "amazon");
    if (!q || !SUPPLIERS[supplier]) return;
    setCatalogMenu("parts");
    supplierEl.value = supplier;
    open(q, { section: "parts" });
    showComparison(q);
  });
  compareEl.querySelector(".catalog-compare-close")?.addEventListener("click", () => { supplierEl.value = ""; compareEl.classList.add("hidden"); });
  compareEl.addEventListener("input", (event) => {
    if (!event.target.matches("[data-compare-price]")) return;
    const prices = [...compareEl.querySelectorAll("[data-compare-price]")].map((input) => ({ supplier: SUPPLIERS[input.dataset.comparePrice]?.label, price: Number(input.value) }))
      .filter((row, i) => compareEl.querySelectorAll("[data-compare-price]")[i].value !== "" && Number.isFinite(row.price));
    const note = compareEl.querySelector(".catalog-compare-note");
    note.textContent = prices.length > 1 ? `${prices.sort((a, b) => a.price - b.price)[0].supplier} is lower by $${(prices[1].price - prices[0].price).toFixed(2)} before tax and shipping.` : "Enter the prices you find to compare them here. Amazon checkout stays on Amazon.";
  });
  historyItemsEl.addEventListener("click", (e) => {
    const remove = e.target.closest("[data-history-remove]");
    if (remove) { history = savePartsSearchHistory(history.filter((q) => q !== remove.dataset.historyRemove)); renderHistory(); return; }
    const use = e.target.closest("[data-history-query]");
    if (use) { queryEl.value = use.dataset.historyQuery; void search({ query: queryEl.value }); }
  });
  overlay.querySelector(".catalog-history-clear")?.addEventListener("click", () => { history = savePartsSearchHistory([]); renderHistory(); });
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  gutterEl?.addEventListener("pointerdown", (e) => {
    if (!splitOn) return;
    e.preventDefault();
    const body = overlay.querySelector(".catalog-body");
    const startX = e.clientX;
    const startRatio = splitRatio;
    const width = body?.getBoundingClientRect().width || 1;
    const onMove = (ev) => {
      splitRatio = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, startRatio + (ev.clientX - startX) / width));
      panelEl.style.setProperty("--catalog-split-left", `${Math.round(splitRatio * 1000) / 10}%`);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      persistLayout();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  renderHistory();
  applyLayout();

  return { open, close, search, setCatalogMenu, setSplit };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
