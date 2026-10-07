import {shopCard,renderShoppingBrowse,renderProductShopping} from './shopping-view.js?v=20260915-marketplace3&vplayout=20260916-1&layui1&free-download1';
import {mountProductExperience} from './product-experience.js?v=20260915-marketplace3&vplayout=20260916-1&layui1';
import {mountMarketplaceTopbar} from './marketplace-topbar.js?v=20260928-hey-ai-summary1';
import {openMarketplaceAssistant} from './marketplace-discovery.js?v=20260928-hey-ai-summary1';
/** Render Marketplace v2 — browse, product, cart, purchases, seller desk. */

import { authHeaders, getToken, getStoredUser } from "../studio/auth.js";
import { formatMoney, mountSellerPanel, startCheckout } from "./marketplace-payments.js?v=20260715-payout-sso";
import { bindCoverEditor, coverEditorHtml } from "./store-cover.js?v=20260908-store-ux";

const root = document.getElementById("mkt2-root");
const CATEGORIES = ["all", "viewport-layouts", "robots", "fixtures", "toolheads", "parts", "electronics", "architecture", "knowledge", "agents"];

let disposeExperience=null, renderSequence=0;

root?.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || image.dataset.marketplaceFallback === "1") return;
  image.dataset.marketplaceFallback = "1";
  let fallback = null;
  if (image.closest(".shop-card-image")) {
    fallback = document.createElement("span");
    fallback.className = "shop-no-image";
    fallback.textContent = "◇";
  } else if (image.closest(".shop-hero-art")) {
    fallback = document.createElement("div");
    fallback.className = "shop-hero-glyph";
    fallback.textContent = "◇";
  } else if (image.closest(".shop-gallery-main")) {
    fallback = document.createElement("div");
    fallback.className = "shop-media-empty";
    fallback.innerHTML = "◇<span>Preview image unavailable</span>";
  } else if (image.closest(".sf-product-image")) {
    fallback = document.createElement("span");
    fallback.className = "sf-product-placeholder";
    fallback.textContent = "◇";
  }
  if (fallback) image.replaceWith(fallback);
}, true);
const state = {
  route: { name: "browse" },
  listings: [],
  featured: [],
  config: {},
  filters: { q: new URLSearchParams(location.search).get("q") || "", source: "", kind: "", category: "all", access: "all", license: "all", sort: "rank" },
  cart: [],
  product: null,
  presentation: null,
  owned: false,
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...authHeaders(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.message || `Request failed (${res.status})`);
  return data;
}

function parseHash() {
  const raw = (location.hash || "#/").replace(/^#/, "");
  const qIndex = raw.indexOf("?");
  const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const params = new URLSearchParams(qIndex >= 0 ? raw.slice(qIndex + 1) : "");
  const parts = pathPart.split("/").filter(Boolean);
  if (parts[0] === "p" && parts[1] && parts[2]) return { name: "product", kind: parts[1], id: parts[2], params };
  const name = (parts[0] || "browse").split("?")[0];
  if (["browse", "cart", "purchases", "orders", "tickets", "sell", "account"].includes(name)) return { name, params };
  return { name: "browse", params };
}

function go(hash) {
  location.hash = hash.startsWith("#") ? hash : `#/${hash}`;
}

function stars(avg, count) {
  const n = Math.round(Number(avg) || 0);
  return `${"★".repeat(n)}${"☆".repeat(Math.max(0, 5 - n))} <span class="muted">${esc(Number(avg || 0).toFixed(1))} (${esc(count || 0)})</span>`;
}

function price(item) {
  if (state.config.show_prices === false) return "";
  if (item.access_mode === "view_only") return "View only";
  if (item.access_mode === "paid" || (item.price_cents || 0) > 0) return formatMoney(item.price_cents, item.currency);
  return "Free";
}

function isListing(item) {
  return !!(item && (item.id || item.slug) && String(item.name || "").trim());
}

function thumbUrl(item) {
  return item?.thumbnail_url || item?.thumbnail?.data_url || item?.thumbnail?.url || "";
}

function thumbFallback(item) {
  const name = String(item?.name || item?.kind || "Model");
  const kind = String(item?.kind || "model");
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hues = [210, 200, 28, 152, 262, 188, 18];
  const h = hues[hash % hues.length];
  const c1 = `hsl(${h} 16% 16%)`;
  const c2 = `hsl(${(h + 22) % 360} 12% 8%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="320" height="180" fill="url(#g)"/>
    <g fill="none" stroke="rgba(230,237,243,0.16)" stroke-width="1.2">
      <path d="M160 38 L238 78 V138 L160 178 L82 138 V78 Z"/>
      <path d="M160 38 V98 L238 138"/>
      <path d="M160 98 L82 138"/>
    </g>
    <text x="20" y="164" fill="rgba(230,237,243,0.45)" font-size="11" font-family="ui-sans-serif,system-ui">${kind}</text>
  </svg>`;
  return {
    style: `background-image:url('data:image/svg+xml,${encodeURIComponent(svg)}')`,
    letter: "",
  };
}

function thumbStyle(item) {
  const url = thumbUrl(item);
  if (url) return `background-image:url('${esc(url)}')`;
  return thumbFallback(item).style;
}

function ribbon(item) {
  if (state.config.show_boost_badges === false) return "";
  if (item.sponsored) return `<span class="mkt2-ribbon">Sponsored</span>`;
  if (item.paid_boost_active) return `<span class="mkt2-ribbon">Boosted</span>`;
  if (item.featured) return `<span class="mkt2-ribbon">Featured</span>`;
  return "";
}

function card(item) { return shopCard(item,{price}); }

function chrome(active, inner) {
  const count = state.cart.length;
  const user = getStoredUser();
  const handle = (user?.handle || "").replace(/^@/, "");
  return `
    <div class="mkt2-shell">
      <div class="mkt2-storebar">
        <a class="mkt2-wordmark" href="#/browse">Marketplace</a>
        <form class="mkt2-store-search" data-header-search>
          <input id="mkt2-q" type="search" placeholder="Search models, skills, knowledge, creators…" aria-label="Search marketplace" value="${esc(state.filters.q)}" autocomplete="off" />
        </form>
        <div class="mkt2-store-links">
          <button type="button" class="mkt2-data-explorer" data-open-data-explorer>Training data</button>
          <a class="mkt2-cart-link" href="#/cart">Cart${count ? ` <span class="mkt2-cart-count">${count}</span>` : ""}</a>
          <a href="#/sell">Profile &amp; Store</a>
          ${handle ? `<a href="/u/${esc(handle)}">View profile</a>` : `<a href="#/sell">Set up profile</a>`}
        </div>
      </div>
      <nav class="mkt2-subnav" aria-label="Marketplace">
        <a class="${active === "browse" ? "is-active" : ""}" href="#/browse">Browse</a>
        <a class="${active === "purchases" ? "is-active" : ""}" href="#/purchases">Purchases</a>
        <a class="${active === "orders" ? "is-active" : ""}" href="#/orders">Orders</a>
        <a class="${active === "tickets" ? "is-active" : ""}" href="#/tickets">Tickets</a>
        <a class="${active === "sell" ? "is-active" : ""}" href="#/sell">Profile &amp; Store</a>
        <a href="/model-store.html">Publish</a>
      </nav>
      <aside class="mkt2-roadmap-banner" aria-label="Marketplace development status">
        <div><strong>Marketplace is still in the works</strong><span>We are building creator sales, verified robotics assets, and paid cloud compute for robot simulations.</span></div>
        <div class="mkt2-roadmap-actions"><a href="/marketplace-roadmap.html">See the roadmap</a><a href="/marketplace-roadmap.html#marketplace-inquiry">Send a suggestion</a></div>
      </aside>
      ${inner}
    </div>`;
}

function filtersBar() {
  const f = state.filters;
  const cfg = state.config || {};
  const kindOpts = [
    ["", "All kinds"],
    cfg.show_models !== false ? ["model", "Models"] : null,
    cfg.show_knowledge !== false ? ["knowledge", "Knowledge"] : null,
    cfg.show_agents !== false ? ["agent", "Agents"] : null,
  ].filter(Boolean);
  const labels = { all: "All", "viewport-layouts": "Viewport layouts", robots: "Robots", fixtures: "Fixtures", toolheads: "Toolheads", parts: "Parts", electronics: "Electronics", architecture: "Architecture", knowledge: "Knowledge", agents: "Agents" };
  return `
    <form class="mkt2-toolbar" data-filters>
      <label>Kind
        <select name="kind">
          ${kindOpts.map(([value, label]) => `<option value="${esc(value)}" ${f.kind === value ? "selected" : ""}>${esc(label)}</option>`).join("")}
        </select>
      </label>
      <label>Access
        <select name="access">
          <option value="all">All</option>
          <option value="free" ${f.access === "free" ? "selected" : ""}>Free</option>
          <option value="paid" ${f.access === "paid" ? "selected" : ""}>Paid</option>
        </select>
      </label>
      <label>Sort
        <select name="sort">
          <option value="rank" ${f.sort === "rank" ? "selected" : ""}>Popular</option>
          <option value="new" ${f.sort === "new" ? "selected" : ""}>Newest</option>
          <option value="price" ${f.sort === "price" ? "selected" : ""}>Price</option>
        </select>
      </label>
      <div class="mkt2-cats">
        ${CATEGORIES.map((c) => `<button type="button" data-cat="${c}" class="${f.category === c ? "is-on" : ""}">${esc(labels[c] || c)}</button>`).join("")}
      </div>
    </form>`;
}

function renderBrowse() { return chrome("browse",renderShoppingBrowse(state,card)); }
function renderProduct() {
  if(!state.product)return chrome("browse",'<div class="shop-empty"><h2>Product not found</h2><p>This listing may no longer be available.</p><a href="#/browse" class="btn accent">Back to marketplace</a></div>');
  return chrome("browse",renderProductShopping(state.product,{owned:state.owned,config:state.config,presentation:state.presentation},card));
}

function keepPayout() {
  return `${100 - Number(state.config.platform_fee_percent || 10)}%`;
}

function renderCart() {
  const items = state.cart;
  const total = items.reduce((n, i) => n + (i.listing?.price_cents || 0) * (i.qty || 1), 0);
  return chrome("cart", `
    <div class="mkt2-page"><h2>Cart</h2>
    ${items.length ? `
      <table class="mkt2-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th></th></tr></thead>
        <tbody>
          ${items.map((i) => `<tr>
            <td>${esc(i.listing?.name)}</td>
            <td>${esc(i.qty)}</td>
            <td>${formatMoney((i.listing?.price_cents || 0) * (i.qty || 1))}</td>
            <td><button type="button" class="btn secondary btn-compact" data-remove-cart="${esc(i.id)}">Remove</button></td>
          </tr>`).join("")}
        </tbody>
      </table>
      <p><strong>Total ${formatMoney(total)}</strong></p>
      <button type="button" class="btn accent" data-checkout-cart>Checkout</button>
    ` : `<p class="mkt2-empty">Your cart is empty.</p>`}
    <p class="muted small" data-cart-status></p></div>`);
}

function renderPurchases(purchases) {
  return chrome("purchases", `
    <div class="mkt2-page"><h2>Your purchases</h2>
    ${purchases.length ? `<table class="mkt2-table"><thead><tr><th>Item</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>
      ${purchases.map((p) => `<tr>
        <td><a href="#/p/${esc(p.listing?.kind || p.kind || "model")}/${esc(p.listing?.slug || p.listing_slug || p.listing_id)}">${esc(p.listing?.name || p.listing_slug || p.listing_id)} ↗</a></td>
        <td>${esc(p.status)}${p.refund_status && p.refund_status !== "none" ? ` · ${esc(p.refund_status)}` : ""}</td>
        <td>${formatMoney(p.price_cents, p.currency)}</td>
        <td>
          ${p.status === "paid" ? `<button type="button" class="btn secondary btn-compact" data-refund="${esc(p.id)}">Request refund</button>` : ""}
          ${p.order_id ? `<button type="button" class="btn secondary btn-compact" data-ticket-order="${esc(p.order_id)}">Ticket</button>` : ""}
        </td>
      </tr>`).join("")}
    </tbody></table>` : `<p class="mkt2-empty">No purchases yet.</p>`}
    <p class="muted small" data-page-status></p></div>`);
}

function ordersBlock(orders, role) {
  return `
    <div class="mkt2-page"><h2>${role === "seller" ? "Fulfillment" : "Orders"}</h2>
    ${orders.length ? `<table class="mkt2-table"><thead><tr><th>Order</th><th>Status</th><th>Ship</th><th></th></tr></thead><tbody>
      ${orders.map((o) => `<tr>
        <td>${esc(o.id)}<div class="muted small">${esc((o.items || []).map((i) => i.name).join(", "))}</div></td>
        <td>${esc(o.status)}</td>
        <td>${esc(o.tracking_carrier || "")} ${esc(o.tracking_number || "")}</td>
        <td>
          ${role === "seller" ? `<button type="button" class="btn secondary btn-compact" data-ship="${esc(o.id)}">Mark shipped</button>` : ""}
          <button type="button" class="btn secondary btn-compact" data-ticket-order="${esc(o.id)}">Ticket</button>
        </td>
      </tr>`).join("")}
    </tbody></table>` : `<p class="mkt2-empty">No orders.</p>`}</div>`;
}

function renderOrders(orders, role) {
  return chrome(role === "seller" ? "sell" : "orders", ordersBlock(orders, role));
}

function renderTickets(tickets) {
  return chrome("tickets", `
    <div class="mkt2-page"><h2>Order tickets</h2>
    ${tickets.length ? `<table class="mkt2-table"><thead><tr><th>Subject</th><th>Status</th></tr></thead><tbody>
      ${tickets.map((t) => `<tr><td>${esc(t.subject)}</td><td>${esc(t.status)}</td></tr>`).join("")}
    </tbody></table>` : `<p class="mkt2-empty">No tickets.</p>`}</div>`);
}

function renderSell(desk, store) {
  const listings = (desk.listings || []).filter(isListing);
  const user = getStoredUser();
  const cover = store?.cover || {};
  return chrome("sell", `
    <div class="mkt2-page marketplace-profile-settings">
      <header class="marketplace-profile-head">
        <div><span class="shop-eyebrow">CREATOR PROFILE</span><h2>Profile &amp; Store</h2><p class="muted">Manage the profile customers see, your storefront, listings, payments, and fulfillment.</p></div>
        ${user?.handle ? `<a class="btn accent" href="/u/${esc(user.handle)}">View public profile ↗</a>` : ""}
      </header>
      <div data-store-builder-host></div>
      <p class="muted">Inventory, fulfillment, sponsorship, and your public store URL. Connected payouts stay in Authorized apps.</p>
      <div id="mkt2-seller-host"></div>
      <div id="mkt2-receive-host"></div>
      <form class="mkt2-form" data-slug-form>
        <label>Store URL (render3d.app/<em>slug</em>)
          <input name="slug" placeholder="og-store" maxlength="48" value="${esc(store?.slug || "")}" />
        </label>
        <button type="submit" class="btn secondary">Save store link</button>
        <p class="muted small" data-slug-status>${store?.store_url ? `Live at <a href="${esc(store.store_url)}">${esc(store.store_url)}</a>` : ""}</p>
      </form>
      <div data-cover-host>${coverEditorHtml(cover)}</div>
      <div class="mkt2-section-head"><h3>Inventory</h3><a class="btn secondary" href="/model-store.html#model-listing-form">Publish</a></div>
      <div class="mkt2-grid">${listings.map(card).join("") || `<p class="mkt2-empty">Nothing listed yet.</p>`}</div>
      ${ordersBlock(desk.orders || [], "seller")}
      <p class="muted small">${user?.handle ? `Public profile: <a href="/u/${esc(user.handle)}">/u/${esc(user.handle)}</a>` : "Claim a handle to publish a profile."}</p>
    </div>`);
}

async function loadCatalog(run = renderSequence) {
  const f = state.filters;
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.kind) params.set("kind", f.kind);
  if (f.category && f.category !== "all") params.set("category", f.category);
  if (f.access && f.access !== "all") params.set("access", f.access);
  if (f.sort) params.set("sort", f.sort);
  try {
    const data = await api(`/api/marketplace/catalog?${params}`);
    if(run!==renderSequence)return;
    state.listings = (data.listings || []).filter(isListing);
    state.featured = (data.featured || []).filter(isListing);
    state.config = data.config || {};
  } catch {
    const data = await api("/api/model-listings");
    if(run!==renderSequence)return;
    state.listings = (data.listings || []).map((l) => ({ ...l, kind: "model" })).filter(isListing);
    state.featured = state.listings.filter((l) => l.featured);
  }
}

async function loadCart(run = renderSequence) {
  if (!getToken()) {
    state.cart = [];
    return;
  }
  try {
    const data = await api("/api/marketplace/cart");
    if(run!==renderSequence)return;
    state.cart = data.items || [];
  } catch {
    if(run!==renderSequence)return;
    state.cart = [];
  }
}

function bindSearch() {
  root.querySelector("[data-open-data-explorer]")?.addEventListener("click", () => {
    void import("../studio/robotics-data-explorer.js?v=20260923-openarm-workspace1&agent-handoff=20260923-1&vrrobot=20260927-2&design-readable=20260927-4").then(module => module.openRoboticsDataExplorer());
  });
  root.querySelector("[data-header-search]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    state.filters.q = root.querySelector("#mkt2-q")?.value || "";
    const url=new URL(location.href);if(state.filters.q)url.searchParams.set('q',state.filters.q);else url.searchParams.delete('q');history.replaceState(null,'',url);
    go("browse");
    void render();
  });
}

function bindBrowse() {
  bindSearch();
  root.querySelector("[data-explore-catalog]")?.addEventListener("click",()=>root.querySelector("#shop-catalog")?.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"}));
  root.querySelector("[data-filters]")?.addEventListener("change", (e) => {
    const form = e.currentTarget;
    state.filters.kind = form.kind.value;
    state.filters.access = form.access.value;
    state.filters.sort = form.sort.value;
    state.filters.source = form.source?.value || "";
    void render();
  });
  root.querySelectorAll('[data-clear-filters]').forEach(btn=>btn.onclick=()=>{Object.assign(state.filters,{q:'',kind:'',category:'all',access:'all',source:'',sort:'rank'});void render();});
  root.querySelector('[data-shop-agent]')?.addEventListener('click',()=>openMarketplaceAssistant({query:state.filters.q}));
  root.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.getAttribute("data-cat") || "all";
      state.filters.category = cat;
      const next = cat !== "all" ? `#/browse?category=${encodeURIComponent(cat)}` : "#/browse";
      if (location.hash === next) {
        void render();
        return;
      }
      location.hash = next;
    });
  });
}

async function render() {
  if (!root) return;
  const run=++renderSequence;disposeExperience?.();disposeExperience=null;
  const route = parseHash();
  state.route = route;
  if (route.name === "browse") {
    state.filters.category = route.params?.get("category") || "all";
  }
  if (state.config.needs_setup && getStoredUser()) {
    /* setup is for admins; catalog still loads */
  }
  await loadCart(run);
  if(run!==renderSequence)return;
  if (route.name === "product") {
    let product=null,owned=false,presentation={};
    try {
      const endpoint=`/api/marketplace/product/${encodeURIComponent(route.kind)}/${encodeURIComponent(route.id)}`;
      const data = await api(endpoint);
      if(run!==renderSequence)return;
      product=data.listing;owned=!!data.owned;
      try{presentation=await api(endpoint+'/presentation');}catch{presentation={files:product?.files||[]};}
    } catch {
      product=null;
    }
    if(run!==renderSequence)return;
    Object.assign(state,{product,owned,presentation});
    root.innerHTML = renderProduct();
    bindSearch();
    bindProduct();
    if(state.product)disposeExperience=mountProductExperience(root,state.product,{api,presentation:state.presentation,onSaved:page=>{const description=root.querySelector(".shop-product-description");if(description)description.textContent=page.description||state.product.description||"";}});
    return;
  }
  if (state.route.name === "cart") {
    if(run!==renderSequence)return;
    root.innerHTML = renderCart();
    bindSearch();
    bindCart();
    return;
  }
  if (state.route.name === "purchases") {
    let purchases = [];
    try {
      purchases = (await api("/api/marketplace/purchases")).purchases || [];
    } catch {
      purchases = [];
    }
    if(run!==renderSequence)return;
    root.innerHTML = renderPurchases(purchases);
    bindSearch();
    bindPurchases();
    return;
  }
  if (state.route.name === "orders") {
    let orders = [];
    try {
      orders = (await api("/api/marketplace/orders?role=buyer")).orders || [];
    } catch {
      orders = [];
    }
    if(run!==renderSequence)return;
    root.innerHTML = renderOrders(orders, "buyer");
    bindSearch();
    bindOrders("buyer");
    return;
  }
  if (state.route.name === "tickets") {
    let tickets = [];
    try {
      tickets = (await api("/api/marketplace/tickets")).tickets || [];
    } catch {
      tickets = [];
    }
    if(run!==renderSequence)return;
    root.innerHTML = renderTickets(tickets);
    bindSearch();
    return;
  }
  if (state.route.name === "sell") {
    let desk = { listings: [], orders: [] };
    let store = null;
    try {
      desk = await api("/api/marketplace/seller/desk");
    } catch {
      desk = { listings: [], orders: [] };
    }
    try {
      store = await api("/api/marketplace/store/me");
    } catch {
      store = null;
    }
    if(run!==renderSequence)return;
    root.innerHTML = renderSell(desk, store);
    bindSearch();
    if(store?.profile?.is_self){
      const {mountStorefrontBuilder}=await import('./storefront-builder.js?v=20260915-marketplace3');
      if(run!==renderSequence)return;
      const builder=mountStorefrontBuilder(root.querySelector('[data-store-builder-host]'),store,{api,initialEdit:true});
      disposeExperience=()=>builder?.dispose?.();
    }
    mountSellerPanel(document.getElementById("mkt2-seller-host"));
    void import("./receive-payments.js?v=20260909-proftabs1&leakfix74").then((m) =>
      m.mountReceivePaymentsSettings(document.getElementById("mkt2-receive-host"), {
        next: "/marketplace.html#/sell",
      }),
    );
    bindSell();
    bindCoverEditor(root.querySelector("[data-cover-host]") || root);
    return;
  }
  await loadCatalog(run);
  if(run!==renderSequence)return;
  root.innerHTML = renderBrowse();
  bindBrowse();
}

function bindProduct() {
  const item = state.product;
  const status = root.querySelector("[data-product-status]");
  root.querySelector("[data-cart]")?.addEventListener("click", async () => {
    try {
      await api("/api/marketplace/cart", { method: "POST", body: JSON.stringify({ kind: item.kind, listing_id: item.id, qty: 1 }) });
      if (status) status.textContent = "Added to cart.";
      await loadCart();
    } catch (err) {
      if (status) status.textContent = err.message || "Sign in to add to cart.";
    }
  });
  root.querySelector("[data-buy]")?.addEventListener("click", async () => {
    try {
      const result = await startCheckout({ kind: item.kind === "knowledge" ? "knowledge" : item.kind, listingId: item.id });
      if (result?.url) window.location.href = result.url;
    } catch (err) {
      if (status) status.textContent = err.message || "Checkout failed.";
    }
  });
  root.querySelector("[data-sponsor]")?.addEventListener("click", async () => {
    const message = prompt("Why should this be sponsored?") || "";
    try {
      await api("/api/marketplace/boosts/sponsor", { method: "POST", body: JSON.stringify({ kind: item.kind, listing_id: item.id, message }) });
      if (status) status.textContent = "Sponsorship requested. Admins review it in Management → Marketplace.";
    } catch (err) {
      if (status) status.textContent = err.message;
    }
  });
  root.querySelector("[data-boost]")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/marketplace/boosts/pay", { method: "POST", body: JSON.stringify({ kind: item.kind, listing_id: item.id }) });
      if (data.url) window.location.href = data.url;
      else if (status) status.textContent = data.message || "Boost applied (demo).";
    } catch (err) {
      if (status) status.textContent = err.message;
    }
  });
}

function bindCart() {
  root.querySelectorAll("[data-remove-cart]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/marketplace/cart/${encodeURIComponent(btn.getAttribute("data-remove-cart"))}`, { method: "DELETE" });
      void render();
    });
  });
  root.querySelector("[data-checkout-cart]")?.addEventListener("click", async () => {
    const status = root.querySelector("[data-cart-status]");
    try {
      const data = await api("/api/marketplace/checkout/v2", { method: "POST", body: JSON.stringify({ from_cart: true }) });
      if (data.url) window.location.href = data.url;
      else if (status) status.textContent = data.message || "Checkout complete.";
    } catch (err) {
      if (status) status.textContent = err.message;
    }
  });
}

function bindPurchases() {
  root.querySelectorAll("[data-refund]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reason = prompt("Refund reason") || "";
      try {
        await api("/api/marketplace/refunds", { method: "POST", body: JSON.stringify({ purchase_id: btn.getAttribute("data-refund"), reason }) });
        void render();
      } catch (err) {
        alert(err.message);
      }
    });
  });
  bindTicketButtons();
}

function bindOrders(role) {
  root.querySelectorAll("[data-ship]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tracking_number = prompt("Tracking number") || "";
      const tracking_carrier = prompt("Carrier (USPS, UPS, …)") || "";
      try {
        await api(`/api/marketplace/orders/${encodeURIComponent(btn.getAttribute("data-ship"))}/ship`, {
          method: "PATCH",
          body: JSON.stringify({ tracking_carrier, tracking_number, status: "shipped" }),
        });
        void render();
      } catch (err) {
        alert(err.message);
      }
    });
  });
  bindTicketButtons();
}

function bindTicketButtons() {
  root.querySelectorAll("[data-ticket-order]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const subject = prompt("Ticket subject") || "Order issue";
      const body = prompt("Describe the issue") || "";
      try {
        await api("/api/marketplace/tickets", {
          method: "POST",
          body: JSON.stringify({ order_id: btn.getAttribute("data-ticket-order"), subject, body }),
        });
        go("tickets");
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function bindSell() {
  const form = root.querySelector("[data-slug-form]");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const slug = form.slug.value.trim();
    const status = form.querySelector("[data-slug-status]");
    try {
      const data = await api("/api/marketplace/store/slug", { method: "POST", body: JSON.stringify({ slug }) });
      if (status) status.innerHTML = `Live at <a href="${esc(data.url)}">${esc(data.url)}</a>`;
    } catch (err) {
      if (status) status.textContent = err.message;
    }
  });
  bindOrders("seller");
}

mountMarketplaceTopbar({agentContext:()=>({name:state.product?.name||state.filters.q||""})});
window.addEventListener("hashchange", () => void render());
void (async () => {
  try {
    state.config = (await api("/api/marketplace/config")).config || {};
    if (state.config.default_sort) state.filters.sort = state.config.default_sort;
  } catch {
    state.config = {};
  }
  if (state.config.needs_setup) {
    const user = getStoredUser();
    if (user) {
      root.insertAdjacentHTML("afterbegin", `<p class="muted">Marketplace setup is pending. Admins: <a href="/setup-marketplace.html">answer the install question</a> or open <a href="/admin-dashboard.html#marketplace-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2">Management → Marketplace</a>.</p>`);
    }
  }
  await render();
})();
