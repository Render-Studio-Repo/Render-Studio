import { authHeaders, getToken } from "../auth.js";
import { mountSellerPanel, startCheckout } from "../marketplace-payments.js?v=20260715-payout-sso";
import {
  agentCardMarkup,
  agentCheckoutModalMarkup,
  agentEmptyStateMarkup,
  agentFeatureMarkup,
  buildAgentCheckout,
  catalogTags,
  filterAgentListings,
  loadPublicAgentCatalog,
  summarizeAgentListings,
} from "./marketplace-agent-catalog.js?v=20260918-agent-market-w38";

const root = document.querySelector(".marketplace-home-shell");

const state = {
  loading: true,
  error: "",
  view: location.hash === "#payments-readme" || /seller=/.test(location.search) ? "seller" : "browse",
  surface: location.hash === "#agents" ? "agents" : "products",
  notice: noticeFromLocation(),
  products: [],
  agentListings: [],
  productSearch: "",
  productType: "all",
  productAccess: "all",
  productSort: "recommended",
  productCategory: "all",
  agentSearch: "",
  agentTag: "all",
  checkout: null,
};

const PRODUCT_TYPE_META = {
  all: { label: "Everything" },
  model: { label: "3D models" },
  knowledge: { label: "Knowledge packs" },
};

const SURFACE_META = {
  products: { label: "Products" },
  agents: { label: "Agents" },
};

const QUICK_LINKS = [
  {
    title: "3D Model Store",
    detail: "Browse downloadable model listings and creator-made CAD.",
    href: "/model-store.html",
    kind: "direct",
    countKey: "model",
  },
  {
    title: "Knowledge Base Center",
    detail: "Open reusable docs, prompt packs, and reference bundles.",
    href: "/knowledge-store.html",
    kind: "direct",
    countKey: "knowledge",
  },
  {
    title: "Agent catalog",
    detail: "View public sell and lease listings without leaving this shell.",
    href: "#agents",
    kind: "surface",
    surface: "agents",
    countKey: "agents",
  },
  {
    title: "Seller payouts",
    detail: "Connect Stripe or PayPal and review the 90/10 split.",
    href: "#payments-readme",
    kind: "view",
    view: "seller",
    countKey: "seller",
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
  return "Product";
}

function fallbackToken(item) {
  if (item.kind === "knowledge") return "KB";
  const category = String(item.category || item.name || "3D").trim();
  return category.slice(0, 2).toUpperCase();
}

function fallbackArt(item) {
  const token = fallbackToken(item);
  const product = productTypeLabel(item.kind).toUpperCase();
  const title = String(item.name || "Marketplace product").slice(0, 40);
  const hue = item.kind === "knowledge" ? "#7aa2ff" : "#ff9a62";
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
  const image = item.thumbnail?.data_url || item.gallery?.[0]?.data_url;
  return image || fallbackArt(item);
}

function cardHref(item) {
  if (item.kind === "knowledge") return `/knowledge-store.html?q=${encodeURIComponent(item.slug)}`;
  return `/model-store.html?q=${encodeURIComponent(item.slug)}`;
}

function ctaLabel(item) {
  if (isPaid(item)) return `Buy ${priceLabel(item)}`;
  if (item.kind === "knowledge") return "Open pack";
  return "Open model";
}

function normalizeProduct(item) {
  const kind = isKnowledgeListing(item) ? "knowledge" : "model";
  return {
    ...item,
    kind,
    href: cardHref({ ...item, kind }),
  };
}

function productCounts(items = state.products) {
  return {
    all: items.length,
    model: items.filter((item) => item.kind === "model").length,
    knowledge: items.filter((item) => item.kind === "knowledge").length,
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

function matchesProductSearch(item) {
  const query = state.productSearch.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    item.name,
    item.slug,
    item.tagline,
    item.description,
    item.body_md,
    item.category,
    item.license,
    ownerLabel(item),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function sortProducts(items) {
  const rows = [...items];
  if (state.productSort === "az") {
    rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return rows;
  }
  if (state.productSort === "newest") {
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

function visibleProducts() {
  const filtered = state.products.filter((item) => {
    if (state.productType !== "all" && item.kind !== state.productType) return false;
    if (state.productAccess !== "all" && (item.access_mode || "free") !== state.productAccess) return false;
    if (state.productCategory !== "all" && String(item.category || "").toLowerCase() !== state.productCategory.toLowerCase()) return false;
    return matchesProductSearch(item);
  });
  return sortProducts(filtered);
}

function featuredProducts(items = visibleProducts()) {
  const featured = items.filter((item) => item.featured || item.boost_status === "approved");
  return featured.length ? featured : items.slice(0, 3);
}

function catalogCounts() {
  const products = productCounts();
  const agents = summarizeAgentListings(state.agentListings);
  return {
    ...products,
    agents: agents.total,
    sellReadyAgents: agents.sellReady,
    leaseReadyAgents: agents.leaseReady,
  };
}

function quickLinkCount(key) {
  const counts = catalogCounts();
  if (key === "seller") return "90 / 10 split";
  if (key === "agents") return `${counts.agents} listings`;
  return `${counts[key] || 0} items`;
}

function categoryPill(label, items) {
  const active = (label || "all").toLowerCase() === state.productCategory.toLowerCase();
  const count = label === "all"
    ? items.length
    : items.filter((item) => String(item.category || "").toLowerCase() === String(label || "").toLowerCase()).length;
  const text = label === "all" ? "All categories" : label;
  return `<button type="button" class="marketplace-pill${active ? " is-active" : ""}" data-product-category="${escapeAttr(label)}">
    <span>${escapeHtml(text)}</span>
    <small>${count}</small>
  </button>`;
}

function agentTagPill(tag, listings) {
  const active = (tag || "all").toLowerCase() === state.agentTag.toLowerCase();
  const count = tag === "all"
    ? listings.length
    : listings.filter((listing) => listing.tags.some((item) => item.toLowerCase() === String(tag || "").toLowerCase())).length;
  const label = tag === "all" ? "All tags" : tag;
  return `<button type="button" class="marketplace-pill${active ? " is-active" : ""}" data-agent-tag="${escapeAttr(tag)}">
    <span>${escapeHtml(label)}</span>
    <small>${count}</small>
  </button>`;
}

function typeTabMarkup(type) {
  const tab = PRODUCT_TYPE_META[type];
  const active = state.productType === type;
  return `<button type="button" class="marketplace-type-tab${active ? " is-active" : ""}" data-type="${escapeAttr(type)}">${escapeHtml(tab.label)}</button>`;
}

function surfaceTabMarkup(surface) {
  const count = surface === "agents" ? state.agentListings.length : state.products.length;
  return `<button type="button" class="marketplace-surface-tab${state.surface === surface ? " is-active" : ""}" data-surface="${escapeAttr(surface)}">
    <span>${escapeHtml(SURFACE_META[surface].label)}</span>
    <small>${count}</small>
  </button>`;
}

function statMarkup(label, value) {
  return `<div class="marketplace-stat-card">
    <strong>${escapeHtml(String(value))}</strong>
    <span>${escapeHtml(label)}</span>
  </div>`;
}

function quickLinkMarkup(link) {
  const attrs = [];
  if (link.kind === "surface") attrs.push(`data-surface-link="${escapeAttr(link.surface)}"`);
  if (link.kind === "view") attrs.push(`data-view-link="${escapeAttr(link.view)}"`);
  return `<a class="marketplace-quick-link" href="${escapeAttr(link.href)}" ${attrs.join(" ")}>
    <strong>${escapeHtml(link.title)}</strong>
    <span>${escapeHtml(link.detail)}</span>
    <small>${escapeHtml(quickLinkCount(link.countKey))}</small>
  </a>`;
}

function productFeatureCardMarkup(item) {
  if (!item) {
    return `<article class="marketplace-feature-card marketplace-feature-card--empty">
      <p class="marketplace-kicker">Featured collection</p>
      <h3>No featured products yet</h3>
      <p class="muted">Publish a model or knowledge pack to populate this shelf.</p>
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

function productCardMarkup(item) {
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

function productEmptyStateMarkup() {
  if (state.productType === "knowledge") {
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
    <button type="button" class="btn secondary" data-reset-product-filters>Reset product filters</button>
  </section>`;
}

function storefrontShellMarkup(innerMarkup) {
  return `
    <section class="marketplace-shell-section">
      <div class="marketplace-view-tabs" role="tablist" aria-label="Marketplace views">
        <button type="button" class="marketplace-view-tab${state.view === "browse" ? " is-active" : ""}" data-view="browse">Storefront</button>
        <button type="button" class="marketplace-view-tab${state.view === "seller" ? " is-active" : ""}" data-view="seller">Seller payouts</button>
      </div>

      ${state.notice ? `<div class="marketplace-notice" aria-live="polite">${escapeHtml(state.notice)}</div>` : ""}

      <div class="marketplace-surface-tabs" role="tablist" aria-label="Marketplace catalog surfaces">
        ${Object.keys(SURFACE_META).map(surfaceTabMarkup).join("")}
      </div>

      ${innerMarkup}
      ${agentCheckoutModalMarkup(state.checkout)}
    </section>
  `;
}

function productBrowseMarkup() {
  const counts = catalogCounts();
  const filtered = visibleProducts();
  const featured = featuredProducts(filtered.length ? filtered : state.products);
  const primaryFeature = featured[0] || state.products[0];
  const typeScopedItems = state.products.filter((item) => state.productType === "all" || item.kind === state.productType);
  const categories = categoriesFor(typeScopedItems);
  return `
    <section class="marketplace-hero">
      <div class="marketplace-hero-copy">
        <p class="marketplace-kicker">The Render Marketplace</p>
        <h2>Professional storefront for products, with agent listings beside them.</h2>
        <p class="marketplace-lead">
          Browse models and knowledge packs in one place, then switch to the new public agent catalog without leaving the cleaned marketplace shell.
        </p>
        <div class="marketplace-stats">
          ${statMarkup("Products", counts.all)}
          ${statMarkup("3D models", counts.model)}
          ${statMarkup("Knowledge packs", counts.knowledge)}
          ${statMarkup("Agent listings", counts.agents)}
        </div>
        <div class="marketplace-quick-links">
          ${QUICK_LINKS.map(quickLinkMarkup).join("")}
        </div>
      </div>
      ${productFeatureCardMarkup(primaryFeature)}
    </section>

    <section class="marketplace-controls-card">
      <div class="marketplace-search-row">
        <label class="marketplace-search-field">
          <span class="visually-hidden">Search marketplace products</span>
          <input id="marketplace-search" type="search" placeholder="Search models, knowledge, creators..." value="${escapeAttr(state.productSearch)}" />
        </label>
        <label class="marketplace-select-field">
          <span>Access</span>
          <select id="marketplace-access">
            <option value="all"${state.productAccess === "all" ? " selected" : ""}>All access</option>
            <option value="free"${state.productAccess === "free" ? " selected" : ""}>Free</option>
            <option value="paid"${state.productAccess === "paid" ? " selected" : ""}>Paid</option>
            <option value="view_only"${state.productAccess === "view_only" ? " selected" : ""}>View only</option>
          </select>
        </label>
        <label class="marketplace-select-field">
          <span>Sort</span>
          <select id="marketplace-sort">
            <option value="recommended"${state.productSort === "recommended" ? " selected" : ""}>Recommended</option>
            <option value="newest"${state.productSort === "newest" ? " selected" : ""}>Newest</option>
            <option value="az"${state.productSort === "az" ? " selected" : ""}>A to Z</option>
          </select>
        </label>
      </div>

      <div class="marketplace-type-tabs">
        ${Object.keys(PRODUCT_TYPE_META).map(typeTabMarkup).join("")}
      </div>

      <div class="marketplace-pill-row" aria-label="Product categories">
        ${categories.map((label) => categoryPill(label, typeScopedItems)).join("")}
      </div>
    </section>

    <section class="marketplace-results-head">
      <div>
        <p class="marketplace-kicker">Browse products</p>
        <h3>${escapeHtml(PRODUCT_TYPE_META[state.productType].label)}</h3>
      </div>
      <div class="marketplace-results-summary">
        <strong>${filtered.length}</strong>
        <span>${filtered.length === 1 ? "result" : "results"}</span>
      </div>
    </section>

    ${filtered.length
      ? `<section class="marketplace-grid" aria-live="polite">${filtered.map(productCardMarkup).join("")}</section>`
      : productEmptyStateMarkup()}
  `;
}

function agentBrowseMarkup() {
  const stats = summarizeAgentListings(state.agentListings);
  const filtered = filterAgentListings(state.agentListings, {
    search: state.agentSearch,
    tag: state.agentTag,
  });
  const featured = filtered[0] || state.agentListings[0];
  const tags = catalogTags(state.agentListings);
  return `
    <section class="marketplace-hero marketplace-agent-hero">
      <div class="marketplace-hero-copy">
        <p class="marketplace-kicker">Public agent catalog</p>
        <h2>List agents with a short public blurb, then sell or lease them.</h2>
        <p class="marketplace-lead">
          This MVP intentionally uses placeholder public copy only. Final listing copy is still TBD, and no internal KB content belongs in these cards.
        </p>
        <div class="marketplace-stats">
          ${statMarkup("Public listings", stats.total)}
          ${statMarkup("Sell-ready", stats.sellReady)}
          ${statMarkup("Lease-ready", stats.leaseReady)}
          ${statMarkup("Both modes", stats.bothModes)}
        </div>
        <div class="marketplace-quick-links">
          <a class="marketplace-quick-link" href="#products" data-surface-link="products">
            <strong>Back to products</strong>
            <span>Return to model and knowledge listings in the same shell.</span>
            <small>${escapeHtml(`${state.products.length} items`)}</small>
          </a>
          <a class="marketplace-quick-link" href="/agent-store.html">
            <strong>Open agent app store</strong>
            <span>Keep the separate install-oriented store page available for existing agent apps.</span>
            <small>Existing flow</small>
          </a>
          <a class="marketplace-quick-link" href="#payments-readme" data-view-link="seller">
            <strong>Seller payouts</strong>
            <span>Review the current payout and checkout notes before wiring real payments.</span>
            <small>Stub-safe</small>
          </a>
        </div>
      </div>
      ${agentFeatureMarkup(featured)}
    </section>

    <section class="marketplace-controls-card marketplace-agent-controls-card">
      <div class="marketplace-search-row marketplace-agent-search-row">
        <label class="marketplace-search-field">
          <span class="visually-hidden">Search public agent listings</span>
          <input id="marketplace-agent-search" type="search" placeholder="Search public agent listings..." value="${escapeAttr(state.agentSearch)}" />
        </label>
        <div class="marketplace-agent-controls-note">
          <strong>Checkout stub only</strong>
          <span>Sell and lease open a local summary modal. No live payment runs yet.</span>
        </div>
      </div>

      <div class="marketplace-pill-row" aria-label="Agent tags">
        ${tags.map((tag) => agentTagPill(tag, state.agentListings)).join("")}
      </div>
    </section>

    <section class="marketplace-results-head">
      <div>
        <p class="marketplace-kicker">Browse agents</p>
        <h3>Sell and lease listings</h3>
      </div>
      <div class="marketplace-results-summary">
        <strong>${filtered.length}</strong>
        <span>${filtered.length === 1 ? "listing" : "listings"}</span>
      </div>
    </section>

    ${filtered.length
      ? `<section class="marketplace-grid marketplace-agent-grid" aria-live="polite">${filtered.map(agentCardMarkup).join("")}</section>`
      : agentEmptyStateMarkup()}
  `;
}

function browseMarkup() {
  return storefrontShellMarkup(state.surface === "agents" ? agentBrowseMarkup() : productBrowseMarkup());
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
            Render Studio marketplace checkout uses Stripe and Link for buyers. Sellers can connect Stripe Express or save a PayPal payout email. The new agent catalog stays on a stub checkout path until real payments are wired.
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
                <li>Paid model and knowledge listings use Stripe Checkout with card and Link.</li>
                <li>The new public agent catalog opens a labeled MVP checkout stub with the selected mode, owner, and placeholder price.</li>
                <li>Minimum paid price stays at <strong>$1.00</strong> once real checkout is wired.</li>
              </ul>
            </article>
          </div>
        </div>
        <aside class="marketplace-seller-panel-wrap">
          <div class="marketplace-readme-card marketplace-readme-card--sticky">
            <h3>Connect seller payouts</h3>
            <p class="muted">Use the existing seller connection flow. Nothing about payout APIs changes in this MVP.</p>
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
        <h2>Loading marketplace...</h2>
        <p class="muted">Fetching product listings and the public agent catalog.</p>
      </section>
    `;
    return;
  }
  if (state.error) {
    root.innerHTML = `
      <section class="marketplace-empty-state marketplace-empty-state--error" aria-live="assertive">
        <h3>Marketplace unavailable</h3>
        <p>${escapeHtml(state.error)}</p>
        <p>Try refreshing the page. If it keeps failing, open the model store or agent store directly.</p>
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
    const [modelRes, agentListings] = await Promise.all([
      fetch(`/api/model-listings${query}`, { headers: authHeaders() }),
      loadPublicAgentCatalog(),
    ]);
    if (!modelRes.ok) throw new Error("Could not load the 3D model marketplace.");
    const modelData = await modelRes.json();
    state.products = (modelData.listings || []).map(normalizeProduct);
    state.agentListings = agentListings;
    state.loading = false;
    if (state.productType === "knowledge" && !state.products.some((item) => item.kind === "knowledge")) {
      state.productCategory = "all";
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
  state.checkout = null;
  if (state.view === "seller") {
    history.replaceState({}, "", "#payments-readme");
  } else {
    const hash = state.surface === "agents" ? "#agents" : "";
    history.replaceState({}, "", `${location.pathname}${location.search}${hash}`);
  }
  render();
}

function setSurface(surface) {
  state.surface = surface === "agents" ? "agents" : "products";
  state.checkout = null;
  history.replaceState({}, "", `${location.pathname}${location.search}${state.surface === "agents" ? "#agents" : ""}`);
  render();
}

function resetProductFilters() {
  state.productSearch = "";
  state.productType = "all";
  state.productAccess = "all";
  state.productSort = "recommended";
  state.productCategory = "all";
  render();
}

function resetAgentFilters() {
  state.agentSearch = "";
  state.agentTag = "all";
  render();
}

function openAgentCheckout(listingId, mode) {
  state.checkout = buildAgentCheckout(state.agentListings, listingId, mode);
  render();
}

function closeAgentCheckout() {
  state.checkout = null;
  render();
}

function continueAgentCheckout() {
  if (!state.checkout?.listing) return;
  const payload = {
    listing_id: state.checkout.listingId,
    name: state.checkout.listing.name,
    owner_display: state.checkout.listing.owner_display,
    mode: state.checkout.mode,
    price_cents: state.checkout.priceCents,
    price_label: state.checkout.priceLabel,
    stub: true,
  };
  window.dispatchEvent(new CustomEvent("marketplace:agent-checkout-stub", { detail: payload }));
  console.info("marketplace:agent-checkout-stub", payload);
  state.notice = `Checkout stub ready: ${state.checkout.listing.name} · ${state.checkout.modeLabel} · ${state.checkout.priceLabel}. No payment captured.`;
  state.checkout = null;
  render();
}

async function buyItem(itemId, button) {
  const item = state.products.find((row) => row.id === itemId || row.slug === itemId);
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
  const source = event.target;
  if (!(source instanceof Element)) return;
  if (
    source.closest("[data-checkout-dialog]")
    && !source.closest("[data-checkout-mode], [data-checkout-continue], [data-checkout-close]")
  ) {
    return;
  }
  const target = source.closest(
    "[data-view], [data-type], [data-product-category], [data-reset-product-filters], [data-buy], [data-view-link], [data-surface], [data-surface-link], [data-agent-tag], [data-reset-agent-filters], [data-agent-checkout], [data-checkout-close], [data-checkout-mode], [data-checkout-continue]"
  );
  if (!target) return;
  if (target.hasAttribute("data-view-link")) {
    event.preventDefault();
    setView(target.getAttribute("data-view-link") || "seller");
    return;
  }
  if (target.hasAttribute("data-surface-link")) {
    event.preventDefault();
    setSurface(target.getAttribute("data-surface-link") || "products");
    return;
  }
  if (target.hasAttribute("data-view")) {
    setView(target.getAttribute("data-view") || "browse");
    return;
  }
  if (target.hasAttribute("data-surface")) {
    setSurface(target.getAttribute("data-surface") || "products");
    return;
  }
  if (target.hasAttribute("data-type")) {
    state.productType = target.getAttribute("data-type") || "all";
    state.productCategory = "all";
    render();
    return;
  }
  if (target.hasAttribute("data-product-category")) {
    state.productCategory = target.getAttribute("data-product-category") || "all";
    render();
    return;
  }
  if (target.hasAttribute("data-agent-tag")) {
    state.agentTag = target.getAttribute("data-agent-tag") || "all";
    render();
    return;
  }
  if (target.hasAttribute("data-reset-product-filters")) {
    resetProductFilters();
    return;
  }
  if (target.hasAttribute("data-reset-agent-filters")) {
    resetAgentFilters();
    return;
  }
  if (target.hasAttribute("data-agent-checkout")) {
    openAgentCheckout(target.getAttribute("data-agent-checkout"), target.getAttribute("data-agent-mode"));
    return;
  }
  if (target.hasAttribute("data-checkout-close")) {
    closeAgentCheckout();
    return;
  }
  if (target.hasAttribute("data-checkout-mode")) {
    if (state.checkout?.listing) {
      state.checkout = buildAgentCheckout(state.agentListings, state.checkout.listing.id, target.getAttribute("data-checkout-mode"));
      render();
    }
    return;
  }
  if (target.hasAttribute("data-checkout-continue")) {
    continueAgentCheckout();
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
    state.productSearch = target.value || "";
    render();
    return;
  }
  if (target.id === "marketplace-agent-search") {
    state.agentSearch = target.value || "";
    render();
  }
});

root?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.id === "marketplace-access") {
    state.productAccess = target.value || "all";
    render();
    return;
  }
  if (target.id === "marketplace-sort") {
    state.productSort = target.value || "recommended";
    render();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.checkout) {
    state.checkout = null;
    render();
  }
});

loadCatalog();
