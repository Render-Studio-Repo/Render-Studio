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

export async function savePayoutMethod(method, details = {}) {
  const data = await api("/api/marketplace/seller/payout-method", {
    method: "POST",
    body: JSON.stringify({ method, details }),
  });
  return data.seller;
}

async function connectPhantomWallet() {
  const provider = window?.phantom?.solana || window?.solana;
  if (!provider?.isPhantom || typeof provider.connect !== "function") {
    throw new Error("Install or unlock Phantom wallet first.");
  }
  const result = await provider.connect();
  const address = result?.publicKey?.toString?.() || provider.publicKey?.toString?.() || "";
  if (!address) throw new Error("Could not read Phantom wallet address.");
  return address;
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
        <button type="button" class="marketplace-payout-btn marketplace-payout-btn--stripe" id="mkt-connect-stripe">
          <span class="marketplace-payout-logo marketplace-payout-logo--stripe" aria-hidden="true">stripe</span>
          <span><strong>Connect Stripe</strong><small>Bank payouts via Express</small></span>
        </button>
        <div class="marketplace-paypal-connect">
          <label class="marketplace-paypal-field">
            <span class="marketplace-payout-logo marketplace-payout-logo--paypal" aria-hidden="true"><b>Pay</b><b>Pal</b></span>
            <span class="visually-hidden">PayPal email</span>
            <input id="mkt-paypal-email" type="email" placeholder="you@paypal.com" />
          </label>
          <button type="button" class="marketplace-payout-btn marketplace-payout-btn--paypal" id="mkt-save-paypal">
            <span><strong>Save PayPal</strong><small>Payout email</small></span>
          </button>
        </div>
        <button type="button" class="marketplace-payout-btn marketplace-payout-btn--phantom" id="mkt-connect-phantom">
          <span class="marketplace-payout-logo marketplace-payout-logo--phantom" aria-hidden="true">◇</span>
          <span><strong>Connect Phantom</strong><small>Crypto wallet payouts</small></span>
        </button>
        <div class="marketplace-alt-payout-row">
          <label class="marketplace-alt-payout-field marketplace-alt-payout-field--cash">
            <span class="marketplace-payout-logo marketplace-payout-logo--cash" aria-hidden="true">$</span>
            <span class="visually-hidden">Cash App handle</span>
            <input id="mkt-cash-app-handle" type="text" placeholder="$cashtag" autocomplete="off" />
          </label>
          <button type="button" class="marketplace-payout-btn marketplace-payout-btn--cash" id="mkt-save-cash-app">
            <span><strong>Save Cash App</strong><small>Cashtag payouts</small></span>
          </button>
        </div>
        <div class="marketplace-alt-payout-row">
          <label class="marketplace-alt-payout-field marketplace-alt-payout-field--venmo">
            <span class="marketplace-payout-logo marketplace-payout-logo--venmo" aria-hidden="true">V</span>
            <span class="visually-hidden">Venmo username</span>
            <input id="mkt-venmo-handle" type="text" placeholder="@venmo" autocomplete="off" />
          </label>
          <button type="button" class="marketplace-payout-btn marketplace-payout-btn--venmo" id="mkt-save-venmo">
            <span><strong>Save Venmo</strong><small>Username payouts</small></span>
          </button>
        </div>
        <button type="button" class="marketplace-payout-btn marketplace-payout-btn--apple" id="mkt-connect-apple-pay">
          <span class="marketplace-payout-logo marketplace-payout-logo--apple" aria-hidden="true">Apple Pay</span>
          <span><strong>Enable Apple Pay</strong><small>Buyer checkout via Stripe</small></span>
        </button>
      </div>
    </div>
  `;

  const statusEl = host.querySelector("#mkt-seller-status");
  const paypalInput = host.querySelector("#mkt-paypal-email");
  const cashInput = host.querySelector("#mkt-cash-app-handle");
  const venmoInput = host.querySelector("#mkt-venmo-handle");

  async function refresh() {
    if (!getToken()) {
      statusEl.textContent = "Sign in to connect payouts.";
      statusEl.classList.remove("is-ready");
      return null;
    }
    try {
      const seller = await loadSellerStatus();
      const parts = [];
      const details = seller?.payout_details || {};
      if (seller?.stripe_ready) parts.push("Stripe bank connected");
      else if (seller?.stripe_account_id) parts.push("Stripe onboarding incomplete");
      else parts.push("Stripe not connected");
      if (seller?.paypal_email) {
        parts.push(`PayPal ${seller.paypal_email}`);
        paypalInput.value = seller.paypal_email;
      }
      if (details.phantom?.wallet_address) parts.push("Phantom wallet connected");
      if (details.cash_app?.handle) {
        parts.push(`Cash App ${details.cash_app.handle}`);
        cashInput.value = details.cash_app.handle;
      }
      if (details.venmo?.handle) {
        parts.push(`Venmo ${details.venmo.handle}`);
        venmoInput.value = details.venmo.handle;
      }
      if (details.apple_pay?.enabled === "true") parts.push("Apple Pay enabled through Stripe");
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

  host.querySelector("#mkt-connect-phantom")?.addEventListener("click", async () => {
    if (!getToken()) {
      statusEl.textContent = "Sign in first.";
      return;
    }
    statusEl.textContent = "Opening Phantom wallet…";
    try {
      const walletAddress = await connectPhantomWallet();
      await savePayoutMethod("phantom", { wallet_address: walletAddress, network: "solana" });
      await refresh();
    } catch (err) {
      statusEl.textContent = err.message || "Could not connect Phantom wallet.";
    }
  });

  host.querySelector("#mkt-save-cash-app")?.addEventListener("click", async () => {
    if (!getToken()) {
      statusEl.textContent = "Sign in first.";
      return;
    }
    try {
      await savePayoutMethod("cash_app", { handle: cashInput.value });
      await refresh();
    } catch (err) {
      statusEl.textContent = err.message || "Could not save Cash App.";
    }
  });

  host.querySelector("#mkt-save-venmo")?.addEventListener("click", async () => {
    if (!getToken()) {
      statusEl.textContent = "Sign in first.";
      return;
    }
    try {
      await savePayoutMethod("venmo", { handle: venmoInput.value });
      await refresh();
    } catch (err) {
      statusEl.textContent = err.message || "Could not save Venmo.";
    }
  });

  host.querySelector("#mkt-connect-apple-pay")?.addEventListener("click", async () => {
    if (!getToken()) {
      statusEl.textContent = "Sign in first.";
      return;
    }
    statusEl.textContent = "Apple Pay checkout is enabled through Stripe Connect.";
    try {
      await savePayoutMethod("apple_pay", { enabled: "true", provider: "stripe" });
      await startStripeConnect();
      await refresh();
    } catch (err) {
      statusEl.textContent = err.message || "Could not enable Apple Pay.";
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
