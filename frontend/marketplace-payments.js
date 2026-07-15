/** Marketplace seller payouts (Stripe Connect + PayPal) and checkout (Link). */

import { authHeaders, getToken } from "./auth.js";

const PLATFORM_FEE_PERCENT = 10;

export function formatMoney(cents, currency = "USD") {
  const value = Number(cents || 0) / 100;
  try {
    return value.toLocaleString(undefined, { style: "currency", currency: currency || "USD" });
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export function feePreview(priceCents) {
  const price = Math.max(0, Number(priceCents) || 0);
  const fee = Math.round((price * PLATFORM_FEE_PERCENT) / 100);
  return {
    price_cents: price,
    platform_fee_cents: fee,
    seller_net_cents: Math.max(0, price - fee),
    platform_fee_percent: PLATFORM_FEE_PERCENT,
  };
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.message || `Request failed (${res.status})`);
  return data;
}

export async function loadSellerStatus() {
  if (!getToken()) return null;
  const data = await api("/api/marketplace/seller");
  return data.seller;
}

export async function startStripeConnect() {
  const data = await api("/api/marketplace/seller/connect", { method: "POST", body: "{}" });
  if (data.url) {
    window.location.href = data.url;
    return data;
  }
  return data;
}

export async function savePaypalEmail(email) {
  const data = await api("/api/marketplace/seller/paypal", {
    method: "POST",
    body: JSON.stringify({ email: String(email || "").trim() }),
  });
  return data.seller;
}

export async function startCheckout({ kind, listingId, successUrl, cancelUrl }) {
  const here = window.location.href.split("#")[0];
  const data = await api("/api/marketplace/checkout", {
    method: "POST",
    body: JSON.stringify({
      kind,
      listing_id: listingId,
      success_url: successUrl || `${here}${here.includes("?") ? "&" : "?"}purchase=success`,
      cancel_url: cancelUrl || `${here}${here.includes("?") ? "&" : "?"}purchase=cancel`,
    }),
  });
  if (data.already_owned) return data;
  if (data.url) {
    window.location.href = data.url;
    return data;
  }
  return data;
}

export function mountSellerPanel(host, { onStatus } = {}) {
  if (!host) return;
  host.innerHTML = `
    <div class="marketplace-seller-panel" id="mkt-seller-panel">
      <strong>Seller payouts</strong>
      <p class="muted small">Connect Stripe (bank via Link/Express) or save a PayPal email to sell paid agents, knowledge bases, and models. Render3D keeps a <strong>10%</strong> platform fee on each sale.</p>
      <p class="marketplace-seller-status" id="mkt-seller-status">Sign in to connect payouts.</p>
      <div class="seller-actions">
        <button type="button" class="btn primary btn-compact" id="mkt-connect-stripe">Connect bank with Stripe</button>
        <label class="muted small" style="display:inline-flex;gap:8px;align-items:center">
          PayPal email
          <input id="mkt-paypal-email" type="email" placeholder="you@paypal.com" style="min-width:180px" />
        </label>
        <button type="button" class="btn secondary btn-compact" id="mkt-save-paypal">Save PayPal</button>
      </div>
    </div>
  `;

  const statusEl = host.querySelector("#mkt-seller-status");
  const paypalInput = host.querySelector("#mkt-paypal-email");

  async function refresh() {
    if (!getToken()) {
      statusEl.textContent = "Sign in to connect payouts.";
      statusEl.classList.remove("is-ready");
      return null;
    }
    try {
      const seller = await loadSellerStatus();
      const parts = [];
      if (seller?.stripe_ready) parts.push("Stripe bank connected");
      else if (seller?.stripe_account_id) parts.push("Stripe onboarding incomplete");
      else parts.push("Stripe not connected");
      if (seller?.paypal_email) {
        parts.push(`PayPal ${seller.paypal_email}`);
        paypalInput.value = seller.paypal_email;
      }
      statusEl.textContent = parts.join(" · ");
      statusEl.classList.toggle("is-ready", !!seller?.can_sell_paid);
      onStatus?.(seller);
      return seller;
    } catch (err) {
      statusEl.textContent = err.message || "Could not load seller status.";
      statusEl.classList.remove("is-ready");
      return null;
    }
  }

  host.querySelector("#mkt-connect-stripe")?.addEventListener("click", async () => {
    if (!getToken()) {
      statusEl.textContent = "Sign in first.";
      return;
    }
    statusEl.textContent = "Opening Stripe Connect…";
    try {
      await startStripeConnect();
      await refresh();
    } catch (err) {
      statusEl.textContent = err.message || "Could not start Stripe Connect.";
    }
  });

  host.querySelector("#mkt-save-paypal")?.addEventListener("click", async () => {
    if (!getToken()) {
      statusEl.textContent = "Sign in first.";
      return;
    }
    try {
      await savePaypalEmail(paypalInput.value);
      await refresh();
    } catch (err) {
      statusEl.textContent = err.message || "Could not save PayPal email.";
    }
  });

  void refresh();
}

export function bindPriceFeeHint(priceInput, hintEl) {
  if (!priceInput || !hintEl) return;
  const update = () => {
    const preview = feePreview(priceInput.value);
    if (!preview.price_cents) {
      hintEl.innerHTML = `Platform fee: <strong>${PLATFORM_FEE_PERCENT}%</strong> on paid sales (seller keeps 90%).`;
      return;
    }
    hintEl.innerHTML =
      `Buyer pays <strong>${formatMoney(preview.price_cents)}</strong> · ` +
      `Render3D fee <strong>${formatMoney(preview.platform_fee_cents)}</strong> (${PLATFORM_FEE_PERCENT}%) · ` +
      `You receive <strong>${formatMoney(preview.seller_net_cents)}</strong>`;
  };
  priceInput.addEventListener("input", update);
  update();
}

export function isPaidListing(item) {
  return item?.access_mode === "paid" || Number(item?.price_cents || 0) > 0 || !!item?.premium;
}
