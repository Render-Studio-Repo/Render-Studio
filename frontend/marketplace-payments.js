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

export async function connectPhantomWallet() {
  const provider = window?.phantom?.solana || window?.solana;
  if (!provider?.isPhantom || typeof provider.connect !== "function") {
    throw new Error("Install or unlock Phantom wallet first.");
  }
  const result = await provider.connect();
  const address = result?.publicKey?.toString?.() || provider.publicKey?.toString?.() || "";
  if (!address) throw new Error("Could not read Phantom wallet address.");
  return address;
}

export async function startPhantomConnect() {
  const walletAddress = await connectPhantomWallet();
  return savePayoutMethod("phantom", { wallet_address: walletAddress, network: "solana" });
}

function shortAddress(address = "") {
  const text = String(address || "");
  return text.length > 14 ? `${text.slice(0, 6)}...${text.slice(-5)}` : text;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function openPaypalConnectModal({ initialEmail = "" } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "marketplace-connect-modal";
    el.innerHTML = `
      <form class="marketplace-connect-card" role="dialog" aria-modal="true" aria-label="Connect PayPal payouts">
        <button type="button" class="marketplace-connect-close" data-connect-close aria-label="Close">&times;</button>
        <div class="marketplace-connect-brand marketplace-connect-brand--paypal">
          <span class="marketplace-payout-logo marketplace-payout-logo--paypal" aria-hidden="true"><b>Pay</b><b>Pal</b></span>
          <div>
            <p class="info-eyebrow">Payout connection</p>
            <h3>Connect PayPal</h3>
          </div>
        </div>
        <p class="muted small">Use the PayPal email you want associated with marketplace payouts. This behaves like an account connection and appears in Authorized Apps.</p>
        <label class="marketplace-connect-field">
          <span>PayPal account email</span>
          <input id="marketplace-connect-paypal-email" type="email" required placeholder="you@paypal.com" value="${escapeAttr(initialEmail)}" />
        </label>
        <div class="marketplace-connect-actions">
          <button type="button" class="btn secondary" data-connect-close>Cancel</button>
          <button type="submit" class="btn accent">Continue with PayPal</button>
        </div>
      </form>
    `;
    const close = (value = null) => {
      el.remove();
      resolve(value);
    };
    document.body.appendChild(el);
    el.querySelector("[data-connect-close]")?.addEventListener("click", () => close(null));
    el.addEventListener("click", (event) => {
      if (event.target === el) close(null);
    });
    el.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      close(el.querySelector("#marketplace-connect-paypal-email")?.value || "");
    });
    el.querySelector("#marketplace-connect-paypal-email")?.focus();
  });
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
      <p class="muted small">Connect payout accounts the same way you connect apps. Stripe handles bank payouts, PayPal stores your payout account email, and Phantom links your crypto wallet. Render Studio keeps a <strong>10%</strong> platform fee on each sale.</p>
      <p class="marketplace-seller-status" id="mkt-seller-status">Sign in to connect payouts.</p>
      <div class="seller-actions">
        <button type="button" class="marketplace-payout-btn marketplace-payout-btn--stripe marketplace-payout-card" id="mkt-connect-stripe">
          <span class="marketplace-payout-logo marketplace-payout-logo--stripe" aria-hidden="true">stripe</span>
          <span class="marketplace-payout-copy"><strong>Connect Stripe</strong><small>Bank payouts via Express onboarding</small></span>
          <span class="marketplace-payout-state" data-payout-state="stripe">Connect</span>
        </button>
        <button type="button" class="marketplace-payout-btn marketplace-payout-btn--paypal marketplace-payout-card" id="mkt-save-paypal">
          <span class="marketplace-payout-logo marketplace-payout-logo--paypal" aria-hidden="true"><b>Pay</b><b>Pal</b></span>
          <span class="marketplace-payout-copy"><strong>Connect PayPal</strong><small>SSO-style payout email connection</small></span>
          <span class="marketplace-payout-state" data-payout-state="paypal">Connect</span>
        </button>
        <button type="button" class="marketplace-payout-btn marketplace-payout-btn--phantom marketplace-payout-card" id="mkt-connect-phantom">
          <span class="marketplace-payout-logo marketplace-payout-logo--phantom" aria-hidden="true">◇</span>
          <span class="marketplace-payout-copy"><strong>Connect Phantom</strong><small>Crypto wallet payouts</small></span>
          <span class="marketplace-payout-state" data-payout-state="phantom">Connect</span>
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
      if (seller?.paypal_email) parts.push(`PayPal ${seller.paypal_email}`);
      if (details.phantom?.wallet_address) parts.push(`Phantom ${shortAddress(details.phantom.wallet_address)}`);
      const stripeState = host.querySelector("[data-payout-state='stripe']");
      const paypalState = host.querySelector("[data-payout-state='paypal']");
      const phantomState = host.querySelector("[data-payout-state='phantom']");
      if (stripeState) {
        stripeState.textContent = seller?.stripe_ready ? "Connected" : seller?.stripe_account_id ? "Finish setup" : "Connect";
        stripeState.classList.toggle("is-connected", !!seller?.stripe_ready);
      }
      if (paypalState) {
        paypalState.textContent = seller?.paypal_email ? "Connected" : "Connect";
        paypalState.classList.toggle("is-connected", !!seller?.paypal_email);
      }
      if (phantomState) {
        phantomState.textContent = details.phantom?.wallet_address ? "Connected" : "Connect";
        phantomState.classList.toggle("is-connected", !!details.phantom?.wallet_address);
      }
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
    const current = (await loadSellerStatus().catch(() => null))?.paypal_email || "";
    const email = await openPaypalConnectModal({ initialEmail: current });
    if (!email) return;
    statusEl.textContent = "Connecting PayPal...";
    try {
      await savePaypalEmail(email);
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
      await startPhantomConnect();
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
      `Render Studio fee <strong>${formatMoney(preview.platform_fee_cents)}</strong> (${PLATFORM_FEE_PERCENT}%) · ` +
      `You receive <strong>${formatMoney(preview.seller_net_cents)}</strong>`;
  };
  priceInput.addEventListener("input", update);
  update();
}

export function isPaidListing(item) {
  return item?.access_mode === "paid" || Number(item?.price_cents || 0) > 0 || !!item?.premium;
}
