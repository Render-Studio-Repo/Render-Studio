const DATA_URL = "/marketplace/agent-catalog-public.json?v=20260918-agent-market-w38";

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

function normalizeTags(tags) {
  return Array.isArray(tags)
    ? tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 8)
    : [];
}

function avatarToken(listing) {
  const parts = String(listing.name || "AI")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "AI";
}

function modeOptions(listing) {
  const options = [];
  if (Number(listing.sell_price || 0) > 0) {
    options.push({
      mode: "sell",
      label: "Sell",
      price_cents: Number(listing.sell_price || 0),
      price_label: formatMoney(listing.sell_price, listing.currency),
      helper: "One-time purchase",
    });
  }
  if (Number(listing.lease_rate || 0) > 0) {
    options.push({
      mode: "lease",
      label: "Lease",
      price_cents: Number(listing.lease_rate || 0),
      price_label: `${formatMoney(listing.lease_rate, listing.currency)}/mo`,
      helper: "Monthly lease placeholder",
    });
  }
  return options;
}

function normalizeListing(listing) {
  const row = listing && typeof listing === "object" ? listing : {};
  const normalized = {
    id: String(row.id || "").trim(),
    name: String(row.name || "").trim(),
    blurb: String(row.blurb || "").trim(),
    sell_price: Number(row.sell_price || 0),
    lease_rate: Number(row.lease_rate || 0),
    tags: normalizeTags(row.tags),
    owner_display: String(row.owner_display || "@render-studio").trim(),
    currency: String(row.currency || "USD").trim() || "USD",
  };
  normalized.modes = modeOptions(normalized);
  normalized.avatar_token = avatarToken(normalized);
  normalized.primary_mode = normalized.modes[0]?.mode || "";
  return normalized;
}

export async function loadPublicAgentCatalog() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error("Could not load the public agent catalog.");
  }
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.listings)
    ? data.listings.map(normalizeListing).filter((listing) => listing.id && listing.name && listing.blurb && listing.modes.length)
    : [];
}

export function summarizeAgentListings(listings = []) {
  return {
    total: listings.length,
    sellReady: listings.filter((listing) => listing.modes.some((mode) => mode.mode === "sell")).length,
    leaseReady: listings.filter((listing) => listing.modes.some((mode) => mode.mode === "lease")).length,
    bothModes: listings.filter((listing) => listing.modes.length > 1).length,
  };
}

export function catalogTags(listings = []) {
  const values = new Set(["all"]);
  listings.forEach((listing) => {
    listing.tags.forEach((tag) => values.add(tag));
  });
  return [...values];
}

export function filterAgentListings(listings = [], { search = "", tag = "all" } = {}) {
  const query = String(search || "").trim().toLowerCase();
  const tagFilter = String(tag || "all").trim().toLowerCase();
  return listings.filter((listing) => {
    if (tagFilter !== "all" && !listing.tags.some((item) => item.toLowerCase() === tagFilter)) {
      return false;
    }
    if (!query) return true;
    const haystack = [
      listing.name,
      listing.blurb,
      listing.owner_display,
      ...listing.tags,
      ...listing.modes.map((mode) => mode.label),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function buildAgentCheckout(listings = [], listingId = "", mode = "") {
  const listing = listings.find((row) => row.id === listingId);
  if (!listing) return null;
  const selectedMode = listing.modes.find((option) => option.mode === mode) || listing.modes[0] || null;
  if (!selectedMode) return null;
  return {
    listingId: listing.id,
    mode: selectedMode.mode,
    modeLabel: selectedMode.label,
    priceCents: selectedMode.price_cents,
    priceLabel: selectedMode.price_label,
    helper: selectedMode.helper,
    listing,
  };
}

export function agentFeatureMarkup(listing) {
  if (!listing) {
    return `<article class="marketplace-feature-card marketplace-feature-card--empty">
      <p class="marketplace-kicker">Public agent catalog</p>
      <h3>No public agent listings yet</h3>
      <p class="muted">Add public-only blurbs and pricing placeholders to the catalog data file to populate this shelf.</p>
    </article>`;
  }
  const modeSummary = listing.modes.map((mode) => `${mode.label} · ${mode.price_label}`).join(" · ");
  return `<article class="marketplace-feature-card marketplace-agent-feature-card">
    <div class="marketplace-feature-media marketplace-agent-feature-media">
      <span class="marketplace-feature-type">Agent listing</span>
      <span class="marketplace-agent-avatar marketplace-agent-avatar--hero">${escapeHtml(listing.avatar_token)}</span>
    </div>
    <div class="marketplace-feature-body">
      <p class="marketplace-kicker">Public agent catalog</p>
      <h3>${escapeHtml(listing.name)}</h3>
      <p class="marketplace-feature-meta">${escapeHtml(listing.owner_display)} · ${escapeHtml(modeSummary)}</p>
      <p class="marketplace-feature-copy">${escapeHtml(listing.blurb)}</p>
      <div class="marketplace-agent-mode-row">
        ${listing.modes.map((mode) => `<span class="marketplace-agent-mode-badge">${escapeHtml(mode.label)}</span>`).join("")}
      </div>
    </div>
  </article>`;
}

export function agentCardMarkup(listing) {
  return `<article class="marketplace-card marketplace-agent-card">
    <div class="marketplace-card-body marketplace-agent-card-body">
      <div class="marketplace-agent-head">
        <span class="marketplace-agent-avatar" aria-hidden="true">${escapeHtml(listing.avatar_token)}</span>
        <div class="marketplace-agent-head-copy">
          <p class="marketplace-card-meta">${escapeHtml(listing.owner_display)}</p>
          <h3>${escapeHtml(listing.name)}</h3>
        </div>
      </div>
      <div class="marketplace-agent-price-grid">
        ${listing.modes.map((mode) => `<div class="marketplace-agent-price-chip">
          <span>${escapeHtml(mode.label)}</span>
          <strong>${escapeHtml(mode.price_label)}</strong>
        </div>`).join("")}
      </div>
      <div class="marketplace-agent-mode-row" aria-label="Agent listing modes">
        ${listing.modes.map((mode) => `<span class="marketplace-agent-mode-badge">${escapeHtml(mode.label)}</span>`).join("")}
      </div>
      <p class="marketplace-card-copy">${escapeHtml(listing.blurb)}</p>
      <div class="marketplace-agent-tag-row" aria-label="Agent tags">
        ${listing.tags.map((tag) => `<span class="marketplace-agent-tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="marketplace-card-footer marketplace-agent-actions">
        ${listing.modes.map((mode) => `<button type="button" class="btn ${mode.mode === "sell" ? "primary" : "secondary"} btn-compact" data-agent-checkout="${escapeAttr(listing.id)}" data-agent-mode="${escapeAttr(mode.mode)}">${escapeHtml(mode.label)} · Stub</button>`).join("")}
      </div>
    </div>
  </article>`;
}

export function agentEmptyStateMarkup() {
  return `<section class="marketplace-empty-state">
    <h3>No agent listings match these filters</h3>
    <p>Try a broader search or clear the active tag to see the public catalog again.</p>
    <button type="button" class="btn secondary" data-reset-agent-filters>Reset agent filters</button>
  </section>`;
}

export function agentCheckoutModalMarkup(checkout) {
  if (!checkout?.listing) return "";
  const listing = checkout.listing;
  const modeTabs = listing.modes.length > 1
    ? `<div class="marketplace-agent-checkout-modes" role="tablist" aria-label="Checkout mode">
        ${listing.modes.map((mode) => `<button type="button" class="marketplace-pill${mode.mode === checkout.mode ? " is-active" : ""}" data-checkout-mode="${escapeAttr(mode.mode)}">${escapeHtml(mode.label)} · ${escapeHtml(mode.price_label)}</button>`).join("")}
      </div>`
    : "";
  return `<div class="marketplace-checkout-overlay" data-checkout-close>
    <div class="marketplace-checkout-modal" role="dialog" aria-modal="true" aria-labelledby="marketplace-checkout-title" data-checkout-dialog>
      <button type="button" class="marketplace-checkout-close" aria-label="Close checkout stub" data-checkout-close>&times;</button>
      <p class="marketplace-kicker">Checkout stub</p>
      <h3 id="marketplace-checkout-title">Confirm ${escapeHtml(checkout.modeLabel.toLowerCase())} flow</h3>
      <p class="marketplace-lead">MVP stub only. No payment is captured here.</p>
      ${modeTabs}
      <div class="marketplace-agent-summary">
        <div>
          <span>Agent</span>
          <strong>${escapeHtml(listing.name)}</strong>
        </div>
        <div>
          <span>Mode</span>
          <strong>${escapeHtml(checkout.modeLabel)}</strong>
        </div>
        <div>
          <span>Price</span>
          <strong>${escapeHtml(checkout.priceLabel)}</strong>
        </div>
        <div>
          <span>Owner</span>
          <strong>${escapeHtml(listing.owner_display)}</strong>
        </div>
      </div>
      <p class="marketplace-checkout-note">Public listing only. Keep internal docs, KB paths, secrets, and job IDs out of catalog blurbs.</p>
      <div class="marketplace-empty-actions">
        <button type="button" class="btn secondary" data-checkout-close>Cancel</button>
        <button type="button" class="btn primary" data-checkout-continue>Continue (stub)</button>
      </div>
    </div>
  </div>`;
}
