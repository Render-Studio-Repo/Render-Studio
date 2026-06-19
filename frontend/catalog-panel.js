export function createCatalogPanel({ api, getProjectId, onImport, onStatus } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "catalog-panel-overlay hidden";
  overlay.innerHTML = `
    <div class="catalog-panel" role="dialog" aria-label="Parts catalog">
      <div class="catalog-panel-head">
        <div>
          <strong>Catalog</strong>
          <span class="muted small">Search STEP models, compare suppliers, import parts, and find spec sheets.</span>
        </div>
        <button type="button" class="catalog-panel-close" aria-label="Close catalog">×</button>
      </div>
      <div class="catalog-panel-search">
        <input type="text" class="catalog-panel-query" placeholder="Search STEP models, e.g. Arduino Nano, NEMA 17, SG90 servo" />
        <button type="button" class="btn accent catalog-panel-search-btn">Search</button>
      </div>
      <div class="catalog-source-filter">
        <div class="catalog-source-filter-head">
          <span class="muted small">Sources</span>
          <button type="button" class="btn secondary btn-compact catalog-sources-all">All</button>
          <button type="button" class="btn secondary btn-compact catalog-sources-cad">CAD only</button>
          <button type="button" class="btn secondary btn-compact catalog-sources-price">Pricing/specs</button>
        </div>
        <div class="catalog-source-list"></div>
      </div>
      <div class="catalog-panel-status muted small"></div>
      <div class="catalog-panel-results"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const queryEl = overlay.querySelector(".catalog-panel-query");
  const resultsEl = overlay.querySelector(".catalog-panel-results");
  const statusEl = overlay.querySelector(".catalog-panel-status");
  const sourceListEl = overlay.querySelector(".catalog-source-list");
  let sourceOptions = [];
  let selectedSources = new Set();

  function setStatus(text, kind = "") {
    statusEl.textContent = text || "";
    statusEl.className = `catalog-panel-status small ${kind}`;
    onStatus?.(kind, text);
  }

  function priceLinks(candidate, query) {
    const links = candidate.price_links || [];
    if (!links.length) return "";
    return `
      <div class="catalog-price-links">
        ${links.map((link) => `<a href="${escapeAttr(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.provider)}</a>`).join("")}
      </div>
    `;
  }

  function renderSourceFilters(options = sourceOptions) {
    sourceOptions = options || [];
    if (!selectedSources.size) {
      selectedSources = new Set(sourceOptions.filter((s) => s.enabled !== false).map((s) => s.id));
    }
    sourceListEl.innerHTML = sourceOptions.map((source) => `
      <label class="catalog-source-chip ${selectedSources.has(source.id) ? "active" : ""}">
        <input type="checkbox" value="${escapeAttr(source.id)}" ${selectedSources.has(source.id) ? "checked" : ""} />
        <span>${escapeHtml(source.label)}</span>
        <em>${escapeHtml(source.importable ? "STEP" : source.kind)}</em>
        <small>${escapeHtml(source.retrieval_mode === "live" ? "live" : source.retrieval_mode === "api" ? "api" : "link")}</small>
      </label>
    `).join("");
    sourceListEl.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) selectedSources.add(input.value);
        else selectedSources.delete(input.value);
        input.closest(".catalog-source-chip")?.classList.toggle("active", input.checked);
      });
    });
  }

  function selectedSourceQuery() {
    return [...selectedSources].join(",");
  }

  function specLink(candidate, query) {
    const direct = candidate.datasheet_url || candidate.page_url;
    const fallback = `https://www.google.com/search?q=${encodeURIComponent(`${candidate.name || query} datasheet pdf`)}`;
    return direct || fallback;
  }

  function renderResults(candidates, query) {
    if (!candidates.length) {
      resultsEl.innerHTML = `<p class="muted small">No catalog matches yet. Try a shorter part number or broader keyword.</p>`;
      return;
    }
    resultsEl.innerHTML = "";
    for (const candidate of candidates) {
      const card = document.createElement("div");
      const isReal = candidate.is_real_result !== false;
      card.className = `catalog-result-card ${isReal ? "" : "catalog-result-card--link"}`;
      const sourceLabel = candidate.source_label || candidate.provider || "Catalog";
      const retrievalLabel =
        candidate.retrieval_mode === "live"
          ? `Retrieved from ${sourceLabel}`
          : candidate.retrieval_mode === "local_fallback"
          ? `Local fallback for ${sourceLabel}`
          : `External search link · ${sourceLabel}`;
      const attrs = Object.entries(candidate.attributes || {}).slice(0, 5)
        .map(([k, v]) => `${prettyKey(k)}: ${formatVal(v)}`)
        .join(" · ");
      card.innerHTML = `
        <div class="catalog-result-thumb">${candidate.png_url ? `<img src="${escapeAttr(candidate.png_url)}" alt="" loading="lazy" />` : ""}</div>
        <div class="catalog-result-main">
          <strong>${escapeHtml(candidate.name || candidate.id || "Catalog part")}</strong>
          <span class="catalog-source-line">${escapeHtml(retrievalLabel)}</span>
          <span class="muted small">${escapeHtml([candidate.source_kind, candidate.category, candidate.family].filter(Boolean).join(" · "))}</span>
          ${candidate.description ? `<p class="muted small">${escapeHtml(candidate.description)}</p>` : ""}
          ${candidate.source_note ? `<p class="catalog-source-note">${escapeHtml(candidate.source_note)}</p>` : ""}
          ${attrs ? `<span class="muted small">${escapeHtml(attrs)}</span>` : ""}
          <div class="catalog-result-actions">
            <button type="button" class="btn accent catalog-import" ${candidate.step_url ? "" : "disabled"}>${candidate.step_url ? "Import STEP" : "No STEP file"}</button>
            ${candidate.product_page_url ? `<a class="btn secondary" href="${escapeAttr(candidate.product_page_url)}" target="_blank" rel="noopener">Product Page</a>` : ""}
            <a class="btn secondary" href="${escapeAttr(specLink(candidate, query))}" target="_blank" rel="noopener">Spec PDF</a>
            ${candidate.page_url ? `<a class="btn secondary" href="${escapeAttr(candidate.page_url)}" target="_blank" rel="noopener">${isReal ? "Source" : "Open Source"}</a>` : ""}
          </div>
          <span class="muted small">Compare prices</span>
          ${priceLinks(candidate, query)}
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
        button.textContent = "Importing...";
        setStatus(`Importing ${candidate.name || "part"}...`);
        try {
          const result = await onImport?.(candidate);
          if (result) {
            setStatus(`Imported ${candidate.name || "part"}.`, "ok");
          } else {
            setStatus("Import cancelled.", "");
          }
        } catch (err) {
          setStatus(err.message || "Import failed.", "error");
        } finally {
          button.disabled = !candidate.step_url;
          button.textContent = originalText;
        }
      });
      resultsEl.appendChild(card);
    }
  }

  async function search() {
    const query = queryEl.value.trim();
    if (!query) {
      setStatus("Enter a part name or number.", "error");
      return;
    }
    setStatus("Searching catalog...");
    resultsEl.innerHTML = "";
    try {
      const sourceParam = selectedSourceQuery();
      const data = await api(`/api/catalog/search?q=${encodeURIComponent(query)}${sourceParam ? `&sources=${encodeURIComponent(sourceParam)}` : ""}`);
      if (data.sources?.length) {
        renderSourceFilters(data.sources);
      }
      renderResults(data.candidates || [], data.query || query);
      const errors = data.errors ? Object.values(data.errors) : [];
      setStatus(`${(data.candidates || []).length} result${(data.candidates || []).length === 1 ? "" : "s"}.${errors.length ? ` Some sources unavailable.` : ""}`, errors.length ? "warn" : "ok");
    } catch (err) {
      setStatus(err.message || "Catalog search failed.", "error");
    }
  }

  function open(initialQuery = "") {
    overlay.classList.remove("hidden");
    if (initialQuery) queryEl.value = initialQuery;
    queryEl.focus();
  }

  function close() {
    overlay.classList.add("hidden");
  }

  overlay.querySelector(".catalog-panel-close")?.addEventListener("click", close);
  overlay.querySelector(".catalog-panel-search-btn")?.addEventListener("click", search);
  overlay.querySelector(".catalog-sources-all")?.addEventListener("click", () => {
    selectedSources = new Set(sourceOptions.map((s) => s.id));
    renderSourceFilters();
  });
  overlay.querySelector(".catalog-sources-cad")?.addEventListener("click", () => {
    selectedSources = new Set(sourceOptions.filter((s) => s.importable || /cad/i.test(s.kind || "")).map((s) => s.id));
    renderSourceFilters();
  });
  overlay.querySelector(".catalog-sources-price")?.addEventListener("click", () => {
    selectedSources = new Set(sourceOptions.filter((s) => /(price|supplier|marketplace|spec)/i.test(s.kind || "")).map((s) => s.id));
    renderSourceFilters();
  });
  queryEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    }
  });
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  renderSourceFilters([
    { id: "step_parts", label: "step.parts", kind: "cad", importable: true, enabled: true },
    { id: "octopart", label: "Octopart / Nexar", kind: "spec_price", importable: false, enabled: true },
    { id: "digikey", label: "Digi-Key", kind: "supplier", importable: false, enabled: true },
    { id: "mouser", label: "Mouser", kind: "supplier", importable: false, enabled: true },
    { id: "snapeda", label: "SnapEDA", kind: "eda_cad", importable: false, enabled: true },
    { id: "ultralibrarian", label: "Ultra Librarian", kind: "eda_cad", importable: false, enabled: true },
    { id: "traceparts", label: "TraceParts", kind: "mechanical_cad", importable: false, enabled: true },
    { id: "3dfindit", label: "3Dfindit / CADENAS", kind: "mechanical_cad", importable: false, enabled: true },
    { id: "amazon", label: "Amazon", kind: "marketplace", importable: false, enabled: true },
    { id: "alibaba", label: "Alibaba", kind: "marketplace", importable: false, enabled: true },
    { id: "mcmaster", label: "McMaster-Carr", kind: "mechanical_supplier", importable: false, enabled: true },
  ]);

  return { open, close, search };
}

function prettyKey(k) {
  return String(k).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatVal(v) {
  if (v == null) return "-";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
