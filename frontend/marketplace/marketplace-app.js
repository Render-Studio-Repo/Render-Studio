import { authHeaders, getToken } from "../auth.js";
import { mountSellerPanel, startCheckout } from "../marketplace-payments.js?v=20260715-payout-sso";

const root = document.querySelector(".marketplace-home-shell");

const state = {
  loading: true,
  error: "",
  view: location.hash === "#payments-readme" || /seller=/.test(location.search) ? "seller" : "browse",
  notice: noticeFromLocation(),
  items: [],
  search: "",
  type: "all",
  access: "all",
  sort: "recommended",
  category: "all",
};

const TYPE_META = {
  all: { label: "Everything" },
  model: { label: "3D models" },
  knowledge: { label: "Knowledge packs" },
  agent: { label: "Skills & agents" },
};

const QUICK_LINKS = [
  {
    title: "3D Model Store",
    detail: "Browse downloadable model listings and creator-made CAD.",
    href: "/model-store.html",
    type: "model",
  },
  {
    title: "Knowledge Base Center",
    detail: "Open reusable docs, prompt packs, and reference bundles.",
    href: "/knowledge-store.html",
    type: "knowledge",
  },
  {
    title: "Agent Store",
    detail: "Install skills, scripts, workflows, and automation tools.",
    href: "/agent-store.html",
    type: "agent",
  },
  {
    title: "Seller payouts",
    detail: "Connect Stripe or PayPal and review the 90/10 split.",
    href: "#payments-readme",
    type: "seller",
  },
];

function noticeFromLocation() {
  const params = new URLSearchParams(location.search);
  const purchase = params.get("purchase");
  const seller = params.get("seller");
  if (purchase === "success") return "Purchase complete. Open the relevant store page to install or download your item.";
  if (purchase === "cancel") return "Checkout canceled. You can keep browsing or try again.";
  if (seller === "connected") return "Seller connection returned successfully. Review your payout status below.";
  if (seller === "refresh") return "Stripe needs one more step before paid listings can go live.";
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function formatMoney(cents, currency = "USD") {
  const value = Number(cents || 0) / 100;
  try {
    return value.toLocaleString(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    });
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function isKnowledgeListing(item) {
  return (item.files || []).some((file) => file?.product_type === "knowledge_base")
    || String(item.category || "").toLowerCase().includes("knowledge");
}

function isPaid(item) {
  return item.access_mode === "paid" || item.premium || Number(item.price_cents || 0) > 0;
}

function priceLabel(item) {
  if (item.access_mode === "view_only") return "View only";
  if (isPaid(item)) return formatMoney(item.price_cents, item.currency);
  return "Free";
}

function ownerLabel(item) {
  return item.owner?.name || item.owner?.email || "Render Studio";
}

function productTypeLabel(kind) {
  if (kind === "model") return "3D model";
  if (kind === "knowledge") return "Knowledge pack";
  if (kind === "agent") return "Skill & agent";
  return "Product";
}

function fallbackToken(item) {
  if (item.kind === "agent") {
    const category = String(item.category || "").toLowerCase();
    if (category.includes("robot")) return "RB";
    if (category.includes("mold")) return "MO";
    if (category.includes("auto")) return "AU";
    return "AI";
  }
  if (item.kind === "knowledge") return "KB";
  const category = String(item.category || item.name || "3D").trim();
  return category.slice(0, 2).toUpperCase();
}

function fallbackArt(item) {
  const token = fallbackToken(item);
  const product = productTypeLabel(item.kind).toUpperCase();
  const title = String(item.name || "Marketplace product").slice(0, 40);
  const hue = item.kind === "agent" ? "#56d364" : item.kind === "knowledge" ? "#7aa2ff" : "#ff9a62";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#101722" />
          <stop offset="1" stop-color="#0b1017" />
        </linearGradient>
        <linearGradient id="accent" x1="0" x2="1">
          <stop offset="0" stop-color="${hue}" />
          <stop offset="1" stop-color="#78a9ff" />
        </linearGradient>
      </defs>
      <rect width="1200" height="760" fill="url(#bg)" />
      <circle cx="960" cy="130" r="220" fill="${hue}" opacity="0.18" />
      <circle cx="220" cy="610" r="280" fill="#1a2333" opacity="0.9" />
      <path d="M0 560h1200M0 620h1200M120 0v760M240 0v760M360 0v760M480 0v760M600 0v760M720 0v760M840 0v760M960 0v760" stroke="rgba(255,255,255,0.08)" />
      <rect x="88" y="96" width="220" height="56" rx="28" fill="rgba(255,255,255,0.08)" />
      <text x="126" y="132" fill="#cbd5e1" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700">${product}</text>
      <rect x="88" y="210" width="404" height="250" rx="42" fill="url(#accent)" opacity="0.18" stroke="${hue}" stroke-width="4" />
      <text x="290" y="366" text-anchor="middle" fill="#f8fafc" font-family="Inter, Arial, sans-serif" font-size="110" font-weight="800">${token}</text>
      <text x="88" y="560" fill="#f8fafc" font-family="Inter, Arial, sans-serif" font-size="58" font-weight="800">${escapeXml(title)}</text>
      <text x="88" y="620" fill="#a8b4c7" font-family="Inter, Arial, sans-serif" font-size="28">Render Studio Marketplace</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function artUrl(item) {
  if (item.kind === "agent") {
    const image = item.manifest?.example_images?.[0]?.data_url || item.icon_url;
    return image || fallbackArt(item);
  }
  const image = item.thumbnail?.data_url || item.gallery?.[0]?.data_url;
  return image || fallbackArt(item);
}

function cardHref(item) {
  if (item.kind === "agent") return `/agent-store.html?agent=${encodeURIComponent(item.slug)}`;
  if (item.kind === "knowledge") return `/knowledge-store.html?q=${encodeURIComponent(item.slug)}`;
  return `/model-store.html?q=${encodeURIComponent(item.slug)}`;
}

function ctaLabel(item) {
  if (isPaid(item)) return `Buy ${priceLabel(item)}`;
  if (item.kind === "agent") return "Open agent";
  if (item.kind === "knowledge") return "Open pack";
  return "Open model";
}

function normalizeModel(item) {
  const kind = isKnowledgeListing(item) ? "knowledge" : "model";
  return {
    ...item,
    kind,
    href: cardHref({ ...item, kind }),
  };
}

function normalizeAgent(item) {
  return {
    ...item,
    kind: "agent",
    href: cardHref({ ...item, kind: "agent" }),
  };
}

function counts(items = state.items) {
  return {
    all: items.length,
    model: items.filter((item) => item.kind === "model").length,
    knowledge: items.filter((item) => item.kind === "knowledge").length,
    agent: items.filter((item) => item.kind === "agent").length,
    featured: items.filter((item) => item.featured || item.boost_status === "approved").length,
  };
}

function categoriesFor(items) {
  const values = new Set(["all"]);
  items.forEach((item) => {
    if (item.category) values.add(item.category);
  });
  return [...values];
}

function matchesSearch(item) {
  const query = state.search.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    item.name,
    item.slug,
    item.tagline,
    item.description,
    item.body_md,
    item.category,
    item.app_type,
    item.license,
    ownerLabel(item),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function sortItems(items) {
  const rows = [...items];
  if (state.sort === "az") {
    rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return rows;
  }
  if (state.sort === "newest") {
    rows.sort((a, b) => String(b.published_at || b.updated_at || "").localeCompare(String(a.published_at || a.updated_at || "")));
    return rows;
  }
  rows.sort((a, b) => {
    const aScore = Number(!!(a.featured || a.boost_status === "approved"));
    const bScore = Number(!!(b.featured || b.boost_status === "approved"));
    if (aScore !== bScore) return bScore - aScore;
    if (Number(a.price_cents || 0) !== Number(b.price_cents || 0)) {
      return Number(a.price_cents || 0) - Number(b.price_cents || 0);
    }
    return String(b.published_at || b.updated_at || "").localeCompare(String(a.published_at || a.updated_at || ""));
  });
  return rows;
}

function visibleItems() {
  const filtered = state.items.filter((item) => {
    if (state.type !== "all" && item.kind !== state.type) return false;
    if (state.access !== "all" && (item.access_mode || "free") !== state.access) return false;
    if (state.category !== "all" && String(item.category || "").toLowerCase() !== state.category.toLowerCase()) return false;
    return matchesSearch(item);
  });
  return sortItems(filtered);
}

function featuredItems(items = visibleItems()) {
  const featured = items.filter((item) => item.featured || item.boost_status === "approved");
  return featured.length ? featured : items.slice(0, 3);
}

function quickLinkCount(type) {
  const allCounts = counts();
  if (type === "seller") return "90 / 10 split";
  return `${allCounts[type] || 0} ${type === "agent" ? "apps" : "items"}`;
}

function categoryPill(label, items) {
  const active = (label || "all").toLowerCase() === state.category.toLowerCase();
  const count = label === "all"
    ? items.length
    : items.filter((item) => String(item.category || "").toLowerCase() === String(label || "").toLowerCase()).length;
  const text = label === "all" ? "All categories" : label;
  return `<button type="button" class="marketplace-pill${active ? " is-active" : ""}" data-category="${escapeAttr(label)}">
    <span>${escapeHtml(text)}</span>
    <small>${count}</small>
  </button>`;
}

function typeTabMarkup(type) {
  const tab = TYPE_META[type];
  const active = state.type === type;
  return `<button type="button" class="marketplace-type-tab${active ? " is-active" : ""}" data-type="${escapeAttr(type)}">${escapeHtml(tab.label)}</button>`;
}

function statMarkup(label, value) {
  return `<div class="marketplace-stat-card">
    <strong>${escapeHtml(String(value))}</strong>
    <span>${escapeHtml(label)}</span>
  </div>`;
}

function featureCardMarkup(item) {
  if (!item) {
    return `<article class="marketplace-feature-card marketplace-feature-card--empty">
      <p class="marketplace-kicker">Featured collection</p>
      <h3>No featured products yet</h3>
      <p class="muted">Publish a model, knowledge pack, or agent app to start the featured shelf.</p>
      <a class="btn secondary" href="/model-store.html#model-listing-form">Publish a product</a>
    </article>`;
  }
  return `<article class="marketplace-feature-card">
    <div class="marketplace-feature-media" style="--marketplace-image:url('${escapeAttr(artUrl(item))}')">
      <span class="marketplace-feature-type">${escapeHtml(productTypeLabel(item.kind))}</span>
    </div>
    <div class="marketplace-feature-body">
      <p class="marketplace-kicker">Featured collection</p>
      <h3>${escapeHtml(item.name)}</h3>
      <p class="marketplace-feature-meta">${escapeHtml(item.category || productTypeLabel(item.kind))} · ${escapeHtml(ownerLabel(item))}</p>
      <p class="marketplace-feature-copy">${escapeHtml(item.tagline || item.description || "Open this listing in the marketplace store.")}</p>
      <div class="marketplace-feature-actions">
        <span class="marketplace-price-tag">${escapeHtml(priceLabel(item))}</span>
        <a class="btn primary" href="${escapeAttr(item.href)}">${escapeHtml(ctaLabel(item))}</a>
      </div>
    </div>
  </article>`;
}

function cardMarkup(item) {
  const paid = isPaid(item);
  const subline = [productTypeLabel(item.kind), item.category, ownerLabel(item)].filter(Boolean).join(" · ");
  return `<article class="marketplace-card">
    <div class="marketplace-card-media" style="--marketplace-image:url('${escapeAttr(artUrl(item))}')">
      <span class="marketplace-card-type">${escapeHtml(productTypeLabel(item.kind))}</span>
      ${item.boost_status === "approved" || item.featured ? `<span class="marketplace-card-flag">${item.boost_status === "approved" ? "Boosted" : "Featured"}</span>` : ""}
    </div>
    <div class="marketplace-card-body">
      <p class="marketplace-card-meta">${escapeHtml(subline)}</p>
      <h3>${escapeHtml(item.name)}</h3>
      <p class="marketplace-card-copy">${escapeHtml(item.tagline || item.description || "Open this listing to learn more.")}</p>
      <div class="marketplace-card-footer">
        <span class="marketplace-price-tag">${escapeHtml(priceLabel(item))}</span>
        ${paid
          ? `<button type="button" class="btn primary btn-compact" data-buy="${escapeAttr(item.id || item.slug)}">Buy now</button>`
          : `<a class="btn secondary btn-compact" href="${escapeAttr(item.href)}">${escapeHtml(ctaLabel(item))}</a>`}
      </div>
    </div>
  </article>`;
}

function emptyStateMarkup() {
  if (state.type === "knowledge") {
    return `<section class="marketplace-empty-state">
      <h3>No knowledge packs yet</h3>
      <p>There are no published knowledge products in this marketplace right now. You can browse the knowledge center or publish the first pack.</p>
      <div class="marketplace-empty-actions">
        <a class="btn secondary" href="/knowledge-store.html">Open Knowledge Base Center</a>
        <a class="btn primary" href="/knowledge-store.html#kb-listing-form">Publish a knowledge pack</a>
      </div>
    </section>`;
  }
  return `<section class="marketplace-empty-state">
    <h3>No products match these filters</h3>
    <p>Try a broader search, switch product types, or clear the category and access filters.</p>
    <button type="button" class="btn secondary" data-reset-filters>Reset filters</button>
  </section>`;
}

function browseMarkup() {
  const allCounts = counts();
  const filtered = visibleItems();
  const featured = featuredItems(filtered.length ? filtered : state.items);
  const primaryFeature = featured[0] || state.items[0];
  const typeScopedItems = state.items.filter((item) => state.type === "all" || item.kind === state.type);
  const categories = categoriesFor(typeScopedItems);
  return `
    <section class="marketplace-shell-section">
      <div class="marketplace-view-tabs" role="tablist" aria-label="Marketplace views">
        <button type="button" class="marketplace-view-tab${state.view === "browse" ? " is-active" : ""}" data-view="browse">Storefront</button>
        <button type="button" class="marketplace-view-tab${state.view === "seller" ? " is-active" : ""}" data-view="seller">Seller payouts</button>
      </div>

      ${state.notice ? `<div class="marketplace-notice" aria-live="polite">${escapeHtml(state.notice)}</div>` : ""}

      <section class="marketplace-hero">
        <div class="marketplace-hero-copy">
          <p class="marketplace-kicker">The Render Marketplace</p>
          <h2>Professional storefront for models, knowledge, and agent apps.</h2>
          <p class="marketplace-lead">
            Browse the existing Render Studio catalog in one place, with clearer art, stronger contrast, cleaner spacing, and direct paths into the live store pages.
          </p>
          <div class="marketplace-stats">
            ${statMarkup("Products", allCounts.all)}
            ${statMarkup("3D models", allCounts.model)}
            ${statMarkup("Agent apps", allCounts.agent)}
            ${statMarkup("Featured picks", allCounts.featured)}
          </div>
          <div class="marketplace-quick-links">
            ${QUICK_LINKS.map((link) => `
              <a class="marketplace-quick-link" href="${escapeAttr(link.href)}" ${link.type === "seller" ? 'data-view-link="seller"' : ""}>
                <strong>${escapeHtml(link.title)}</strong>
                <span>${escapeHtml(link.detail)}</span>
                <small>${escapeHtml(quickLinkCount(link.type))}</small>
              </a>
            `).join("")}
          </div>
        </div>
        ${featureCardMarkup(primaryFeature)}
      </section>

      <section class="marketplace-controls-card">
        <div class="marketplace-search-row">
          <label class="marketplace-search-field">
            <span class="visually-hidden">Search marketplace</span>
            <input id="marketplace-search" type="search" placeholder="Search models, skills, knowledge, creators..." value="${escapeAttr(state.search)}" />
          </label>
          <label class="marketplace-select-field">
            <span>Access</span>
            <select id="marketplace-access">
              <option value="all"${state.access === "all" ? " selected" : ""}>All access</option>
              <option value="free"${state.access === "free" ? " selected" : ""}>Free</option>
              <option value="paid"${state.access === "paid" ? " selected" : ""}>Paid</option>
              <option value="view_only"${state.access === "view_only" ? " selected" : ""}>View only</option>
            </select>
          </label>
          <label class="marketplace-select-field">
            <span>Sort</span>
            <select id="marketplace-sort">
              <option value="recommended"${state.sort === "recommended" ? " selected" : ""}>Recommended</option>
              <option value="newest"${state.sort === "newest" ? " selected" : ""}>Newest</option>
              <option value="az"${state.sort === "az" ? " selected" : ""}>A to Z</option>
            </select>
          </label>
        </div>

        <div class="marketplace-type-tabs">
          ${Object.keys(TYPE_META).map(typeTabMarkup).join("")}
        </div>

        <div class="marketplace-pill-row" aria-label="Product categories">
          ${categories.map((label) => categoryPill(label, typeScopedItems)).join("")}
        </div>
      </section>

      <section class="marketplace-results-head">
        <div>
          <p class="marketplace-kicker">Browse products</p>
          <h3>${escapeHtml(TYPE_META[state.type].label)}</h3>
        </div>
        <div class="marketplace-results-summary">
          <strong>${filtered.length}</strong>
          <span>${filtered.length === 1 ? "result" : "results"}</span>
        </div>
      </section>

      ${filtered.length
        ? `<section class="marketplace-grid" aria-live="polite">${filtered.map(cardMarkup).join("")}</section>`
        : emptyStateMarkup()}
    </section>
  `;
}

function sellerMarkup() {
  return `
    <section class="marketplace-shell-section">
      <div class="marketplace-view-tabs" role="tablist" aria-label="Marketplace views">
        <button type="button" class="marketplace-view-tab${state.view === "browse" ? " is-active" : ""}" data-view="browse">Storefront</button>
        <button type="button" class="marketplace-view-tab${state.view === "seller" ? " is-active" : ""}" data-view="seller">Seller payouts</button>
      </div>

      ${state.notice ? `<div class="marketplace-notice" aria-live="polite">${escapeHtml(state.notice)}</div>` : ""}

      <section class="marketplace-seller-layout">
        <div class="marketplace-seller-copy">
          <p class="marketplace-kicker">Payments README</p>
          <h2>Keep marketplace payouts understandable.</h2>
          <p class="marketplace-lead">
            Render Studio marketplace checkout uses Stripe and Link for buyers. Sellers can connect Stripe Express or save a PayPal payout email. Paid listings keep the same existing commerce hooks.
          </p>
          <div class="marketplace-readme-card">
            <h3>Platform split</h3>
            <p>Every paid listing takes a flat <strong>10%</strong> platform fee. The seller keeps the remaining <strong>90%</strong>.</p>
            <table class="marketplace-split-table">
              <thead>
                <tr><th>Buyer pays</th><th>Render Studio</th><th>Seller receives</th></tr>
              </thead>
              <tbody>
                <tr><td>$10.00</td><td>$1.00</td><td>$9.00</td></tr>
                <tr><td>$25.00</td><td>$2.50</td><td>$22.50</td></tr>
                <tr><td>$100.00</td><td>$10.00</td><td>$90.00</td></tr>
              </tbody>
            </table>
          </div>
          <div class="marketplace-readme-grid">
            <article class="marketplace-readme-card">
              <h3>How sellers get paid</h3>
              <ul>
                <li><strong>Stripe / bank</strong> — connect via Express onboarding and receive net proceeds after the platform fee.</li>
                <li><strong>PayPal</strong> — save a payout email while bank setup is finishing.</li>
                <li><strong>Free or view only</strong> — no fee, and no payout setup is required to publish.</li>
              </ul>
            </article>
            <article class="marketplace-readme-card">
              <h3>Buyer checkout</h3>
              <ul>
                <li>Paid items use Stripe Checkout with card and Link.</li>
                <li>Agent installs unlock after payment; model and knowledge downloads stay tied to their existing store behavior.</li>
                <li>Minimum paid price stays at <strong>$1.00</strong>.</li>
              </ul>
            </article>
          </div>
        </div>
        <aside class="marketplace-seller-panel-wrap">
          <div class="marketplace-readme-card marketplace-readme-card--sticky">
            <h3>Connect seller payouts</h3>
            <p class="muted">Use the existing seller connection flow. Nothing about checkout or payout APIs changes here.</p>
            <div id="marketplace-seller-host"></div>
          </div>
        </aside>
      </section>
    </section>
  `;
}

function render() {
  if (!root) return;
  if (state.loading) {
    root.innerHTML = `
      <section class="marketplace-loading-shell" aria-live="polite">
        <p class="marketplace-kicker">Render Studio marketplace</p>
        <h2>Loading products...</h2>
        <p class="muted">Fetching the current catalog and storefront filters.</p>
      </section>
    `;
    return;
  }
  if (state.error) {
    root.innerHTML = `
      <section class="marketplace-empty-state marketplace-empty-state--error" aria-live="assertive">
        <h3>Marketplace unavailable</h3>
        <p>${escapeHtml(state.error)}</p>
        <p>Try refreshing the page. If it keeps failing, open the model or agent store directly.</p>
        <div class="marketplace-empty-actions">
          <a class="btn secondary" href="/model-store.html">Open 3D Model Store</a>
          <a class="btn secondary" href="/agent-store.html">Open Agent Store</a>
        </div>
      </section>
    `;
    return;
  }
  root.innerHTML = state.view === "seller" ? sellerMarkup() : browseMarkup();
  if (state.view === "seller") {
    mountSellerPanel(document.getElementById("marketplace-seller-host"));
  }
}

async function loadCatalog() {
  state.loading = true;
  state.error = "";
  render();
  try {
    const query = getToken() ? "?include_pending=1" : "";
    const [modelRes, agentRes] = await Promise.all([
      fetch(`/api/model-listings${query}`, { headers: authHeaders() }),
      fetch(`/api/agent-apps${query}`, { headers: authHeaders() }),
    ]);
    if (!modelRes.ok) throw new Error("Could not load the 3D model marketplace.");
    if (!agentRes.ok) throw new Error("Could not load the agent marketplace.");
    const [modelData, agentData] = await Promise.all([modelRes.json(), agentRes.json()]);
    state.items = [
      ...(modelData.listings || []).map(normalizeModel),
      ...(agentData.apps || []).map(normalizeAgent),
    ];
    state.loading = false;
    if (state.type === "knowledge" && !state.items.some((item) => item.kind === "knowledge")) {
      state.category = "all";
    }
    render();
  } catch (error) {
    state.loading = false;
    state.error = error?.message || "Could not load marketplace data.";
    render();
  }
}

function setView(view) {
  state.view = view === "seller" ? "seller" : "browse";
  if (state.view === "seller") history.replaceState({}, "", "#payments-readme");
  else if (location.hash === "#payments-readme") history.replaceState({}, "", location.pathname + location.search);
  render();
}

function resetFilters() {
  state.search = "";
  state.type = "all";
  state.access = "all";
  state.sort = "recommended";
  state.category = "all";
  render();
}

async function buyItem(itemId, button) {
  const item = state.items.find((row) => row.id === itemId || row.slug === itemId);
  if (!item) return;
  if (!getToken()) {
    state.notice = "Sign in to purchase paid marketplace items.";
    render();
    return;
  }
  if (!button) return;
  button.disabled = true;
  try {
    const result = await startCheckout({ kind: item.kind, listingId: item.id || item.slug });
    if (result.already_owned || result.demo) {
      state.notice = result.message || "Purchase complete.";
      render();
      window.location.href = item.href;
      return;
    }
  } catch (error) {
    state.notice = error?.message || "Checkout failed.";
    render();
  } finally {
    button.disabled = false;
  }
}

root?.addEventListener("click", (event) => {
  const target = event.target.closest("[data-view], [data-type], [data-category], [data-reset-filters], [data-buy], [data-view-link]");
  if (!target) return;
  if (target.hasAttribute("data-view-link")) {
    event.preventDefault();
    setView("seller");
    return;
  }
  if (target.hasAttribute("data-view")) {
    setView(target.getAttribute("data-view") || "browse");
    return;
  }
  if (target.hasAttribute("data-type")) {
    state.type = target.getAttribute("data-type") || "all";
    state.category = "all";
    render();
    return;
  }
  if (target.hasAttribute("data-category")) {
    state.category = target.getAttribute("data-category") || "all";
    render();
    return;
  }
  if (target.hasAttribute("data-reset-filters")) {
    resetFilters();
    return;
  }
  if (target.hasAttribute("data-buy")) {
    void buyItem(target.getAttribute("data-buy"), target);
  }
});

root?.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.id === "marketplace-search") {
    state.search = target.value || "";
    render();
  }
});

root?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.id === "marketplace-access") {
    state.access = target.value || "all";
    render();
  }
  if (target.id === "marketplace-sort") {
    state.sort = target.value || "recommended";
    render();
  }
});

loadCatalog();
