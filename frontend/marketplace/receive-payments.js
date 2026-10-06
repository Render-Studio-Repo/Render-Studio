/** Receive-money settings, public pay button, and wallet connect. */

import { authHeaders, getToken } from "../studio/auth.js";

const ASSET = "20260909-proftabs1";

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
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.message || `Request failed (${res.status})`);
  return data;
}

let receivePaymentsAbort = null; // leakfix74
function beginReceivePaymentsFetch() {
  if (receivePaymentsAbort) {
    try { receivePaymentsAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  receivePaymentsAbort = ctl;
  return ctl;
}

export async function loadReceiveStatus(signal) {
  if (!getToken()) return null;
  return api("/api/receive-payments/me", signal ? { signal } : {});
}

export async function patchReceive(body) {
  return api("/api/receive-payments/me", { method: "PATCH", body: JSON.stringify(body) });
}

export async function startPaypalOAuth(next = "/") {
  const data = await api(`/api/receive-payments/paypal/connect?next=${encodeURIComponent(next)}`);
  if (data.url) window.location.href = data.url;
  return data;
}

export async function disconnectPaypal() {
  return api("/api/receive-payments/paypal", { method: "DELETE" });
}

export async function disconnectStripe() {
  return api("/api/receive-payments/stripe", { method: "DELETE" });
}

export async function disconnectWallet(chain) {
  return api(`/api/receive-payments/wallets/${encodeURIComponent(chain)}`, { method: "DELETE" });
}

export async function saveWallet(chain, address, connectedVia = "manual") {
  return api("/api/receive-payments/wallets", {
    method: "POST",
    body: JSON.stringify({ chain, address, enabled: true, connected_via: connectedVia }),
  });
}

export async function connectMetaMask() {
  const eth = window.ethereum;
  if (!eth?.request) throw new Error("Install MetaMask, Rabby, or another injected wallet.");
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  const address = accounts?.[0] || "";
  if (!address) throw new Error("Could not read the Ethereum address.");
  return saveWallet("eth", address, "metamask");
}

export async function connectPhantomSol() {
  const provider = window?.phantom?.solana || window?.solana;
  if (!provider?.isPhantom || typeof provider.connect !== "function") {
    throw new Error("Install or unlock Phantom first.");
  }
  const result = await provider.connect();
  const address = result?.publicKey?.toString?.() || provider.publicKey?.toString?.() || "";
  if (!address) throw new Error("Could not read the Phantom address.");
  return saveWallet("sol", address, "phantom");
}

export function promptAddress(chain, { initial = "" } = {}) {
  const labels = { eth: "Ethereum 0x address", sol: "Solana address", btc: "Bitcoin address" };
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "recv-pay-modal";
    el.innerHTML = `
      <form class="recv-pay-card" role="dialog" aria-modal="true">
        <h3>Add ${esc(labels[chain] || "wallet")}</h3>
        <input type="text" name="addr" value="${esc(initial)}" placeholder="${esc(labels[chain] || "Address")}" autocomplete="off" />
        <div class="recv-pay-actions">
          <button type="button" class="btn secondary" data-close>Cancel</button>
          <button type="submit" class="btn accent">Save</button>
        </div>
      </form>`;
    const close = (value) => {
      el.remove();
      resolve(value);
    };
    el.addEventListener("click", (e) => {
      if (e.target === el) close(null);
    });
    el.querySelector("[data-close]")?.addEventListener("click", () => close(null));
    el.querySelector("form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      close(el.querySelector("[name=addr]")?.value || "");
    });
    document.body.appendChild(el);
    el.querySelector("[name=addr]")?.focus();
  });
}

function preferredOptions(data) {
  const labels = {
    stripe: "Stripe (card)",
    paypal: "PayPal",
    x_money: "X money handle",
    eth: "Ethereum",
    sol: "Solana / Phantom",
    btc: "Bitcoin",
  };
  const ready = new Set(data.available_methods || []);
  const keys = ["stripe", "paypal", "x_money", "eth", "sol", "btc"];
  return keys
    .map((key) => {
      const ok = ready.has(key);
      return `<option value="${key}" ${data.preferred === key ? "selected" : ""} ${ok ? "" : "disabled"}>${esc(labels[key])}${ok ? "" : " — connect first"}</option>`;
    })
    .join("");
}

function showToggle(key, on, { title = "" } = {}) {
  return `<button type="button" class="recv-pay-toggle${on ? " is-on" : ""}" data-recv-toggle="${esc(key)}" aria-pressed="${on ? "true" : "false"}" title="${esc(title || (on ? "Visible on your public profile" : "Hidden on your public profile"))}">${on ? "On" : "Show"}</button>`;
}

function methodRow({ title, hint, toggleKey, toggleOn, actions }) {
  return `<div class="recv-pay-row">
        <span class="recv-pay-copy"><b>${esc(title)}</b><small>${hint}</small></span>
        <div class="recv-pay-actions">
          ${showToggle(toggleKey, toggleOn)}
          ${actions}
        </div>
      </div>`;
}

function settingsHtml(data) {
  const w = data.wallets || {};
  const stripeNote = data.stripe_ready
    ? "Connected"
    : data.stripe_connected
      ? "Finish Stripe Express onboarding"
      : "Not connected";
  const paypalNote = data.paypal_connected
    ? data.paypal_email || "PayPal account linked"
    : data.paypal_oauth_configured
      ? "Not connected"
      : "Server needs PayPal client id/secret";
  const paypalCta = data.paypal_connected
    ? `<button type="button" class="btn secondary btn-compact" data-recv-act="unlink-paypal">Unlink</button>`
    : `<button type="button" class="btn secondary btn-compact" data-recv-act="connect-paypal" ${data.paypal_oauth_configured ? "" : "disabled"}>${data.paypal_oauth_configured ? "Connect" : "Setup needed"}</button>`;
  const stripeCta = data.stripe_connected
    ? `<button type="button" class="btn secondary btn-compact" data-recv-act="unlink-stripe">Unlink</button>`
    : `<button type="button" class="btn secondary btn-compact" data-recv-act="connect-stripe">Connect</button>`;
  return `
    <div class="recv-pay-panel" data-recv-pay-settings>
      <h4>Receive money</h4>
      <p class="recv-pay-lead">Show a pay button on your public profile and store. Connect Stripe, PayPal, an X handle, or a wallet. Show persists immediately and controls what visitors see.</p>
      <div class="recv-pay-row">
        <span class="recv-pay-copy"><b>Show receive money button</b><small>Visitors see Send money when at least one method is on.</small></span>
        <div class="recv-pay-actions">${showToggle("show", !!data.show_receive_button)}</div>
      </div>
      <div class="recv-pay-row">
        <span class="recv-pay-copy"><b>Preferred method</b><small>The button opens this first.</small></span>
        <select class="recv-pay-select" data-recv="preferred">${preferredOptions(data)}</select>
      </div>
      ${methodRow({
        title: "Stripe",
        hint: esc(stripeNote),
        toggleKey: "stripe_enabled",
        toggleOn: !!data.stripe_enabled,
        actions: stripeCta,
      })}
      ${methodRow({
        title: "PayPal",
        hint: esc(paypalNote),
        toggleKey: "paypal_enabled",
        toggleOn: !!data.paypal_enabled,
        actions: paypalCta,
      })}
      <div class="recv-pay-row">
        <span class="recv-pay-copy"><b>PayPal.me handle</b><small>Optional public pay link · paypal.me/you</small></span>
        <input type="text" class="recv-pay-input" data-recv="paypal_me" value="${esc(data.paypal_me || "")}" placeholder="yourname" />
      </div>
      <div class="recv-pay-row">
        <span class="recv-pay-copy"><b>X money handle</b><small>Opens x.com/handle — no fake X OAuth.</small></span>
        <div class="recv-pay-actions recv-pay-actions--field">
          <input type="text" class="recv-pay-input" data-recv="x_handle" value="${esc(data.x_handle || "")}" placeholder="handle" />
          ${showToggle("x_enabled", !!data.x_enabled)}
        </div>
      </div>
      ${methodRow({
        title: "Ethereum",
        hint: esc(w.eth?.address || "0x address or MetaMask"),
        toggleKey: "eth_enabled",
        toggleOn: !!w.eth?.enabled,
        actions: `<button type="button" class="btn secondary btn-compact" data-recv-act="connect-eth">MetaMask</button>
          <button type="button" class="btn ghost btn-compact" data-recv-act="paste-eth">Paste</button>
          ${w.eth?.address ? `<button type="button" class="btn ghost btn-compact" data-recv-act="unlink-eth">Unlink</button>` : ""}`,
      })}
      ${methodRow({
        title: "Solana",
        hint: esc(w.sol?.address || "Phantom or Solana address"),
        toggleKey: "sol_enabled",
        toggleOn: !!w.sol?.enabled,
        actions: `<button type="button" class="btn secondary btn-compact" data-recv-act="connect-sol">Phantom</button>
          <button type="button" class="btn ghost btn-compact" data-recv-act="paste-sol">Paste</button>
          ${w.sol?.address ? `<button type="button" class="btn ghost btn-compact" data-recv-act="unlink-sol">Unlink</button>` : ""}`,
      })}
      ${methodRow({
        title: "Bitcoin",
        hint: esc(w.btc?.address || "bc1 / 1 / 3 address"),
        toggleKey: "btc_enabled",
        toggleOn: !!w.btc?.enabled,
        actions: `<button type="button" class="btn secondary btn-compact" data-recv-act="paste-btc">Add address</button>
          ${w.btc?.address ? `<button type="button" class="btn ghost btn-compact" data-recv-act="unlink-btc">Unlink</button>` : ""}`,
      })}
      <div class="recv-pay-actions recv-pay-actions--footer">
        <button type="button" class="btn accent btn-compact" data-recv-act="save">Save handles</button>
      </div>
      <p class="recv-pay-status" data-recv-status></p>
    </div>`;
}

function togglePatch(key, on) {
  if (key === "show") return { show_receive_button: on };
  if (key === "stripe_enabled" || key === "paypal_enabled" || key === "x_enabled") return { [key]: on };
  if (key === "eth_enabled") return { wallets: { eth: { enabled: on } } };
  if (key === "sol_enabled") return { wallets: { sol: { enabled: on } } };
  if (key === "btc_enabled") return { wallets: { btc: { enabled: on } } };
  return null;
}

function toggleOn(root, key) {
  return root.querySelector(`[data-recv-toggle="${key}"]`)?.getAttribute("aria-pressed") === "true";
}

function readForm(root) {
  const val = (sel) => root.querySelector(sel);
  return {
    show_receive_button: toggleOn(root, "show"),
    preferred: val("[data-recv=preferred]")?.value || "",
    stripe_enabled: toggleOn(root, "stripe_enabled"),
    paypal_enabled: toggleOn(root, "paypal_enabled"),
    paypal_me: val("[data-recv=paypal_me]")?.value || "",
    x_handle: val("[data-recv=x_handle]")?.value || "",
    x_enabled: toggleOn(root, "x_enabled"),
    wallets: {
      eth: { enabled: toggleOn(root, "eth_enabled") },
      sol: { enabled: toggleOn(root, "sol_enabled") },
      btc: { enabled: toggleOn(root, "btc_enabled") },
    },
  };
}

export async function mountReceivePaymentsSettings(host, { next = "/" } = {}) {
  if (!host) return;
  if (!getToken()) {
    host.innerHTML = `<div class="recv-pay-panel"><p class="recv-pay-lead">Sign in to connect payout methods.</p></div>`;
    return;
  }
  const note = (msg) => {
    const el = host.querySelector("[data-recv-status]");
    if (el) el.textContent = msg || "";
  };
  const render = async () => {
    const ctl = beginReceivePaymentsFetch();
    try {
      const data = await loadReceiveStatus(ctl.signal);
      if (ctl.signal.aborted) return;
      host.innerHTML = settingsHtml(data || {});
      bind();
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      throw err;
    } finally {
      if (receivePaymentsAbort === ctl) receivePaymentsAbort = null;
    }
  };
  function bind() {
    const root = host.querySelector("[data-recv-pay-settings]");
    if (!root) return;
    root.addEventListener("change", async (e) => {
      const preferred = e.target.closest("[data-recv=preferred]");
      if (!preferred) return;
      try {
        note("Saving…");
        await patchReceive({ preferred: preferred.value || "" });
        note("Preferred method saved.");
      } catch (err) {
        note(err.message || "Could not save preferred method.");
      }
    });
    root.addEventListener("click", async (e) => {
      const toggle = e.target.closest("[data-recv-toggle]");
      if (toggle) {
        e.preventDefault();
        const key = toggle.getAttribute("data-recv-toggle") || "";
        const next = toggle.getAttribute("aria-pressed") !== "true";
        const body = togglePatch(key, next);
        if (!body) return;
        try {
          toggle.disabled = true;
          note("Saving…");
          await patchReceive(body);
          note(next ? "Shown on your public profile when this method is ready." : "Hidden from your public profile.");
          await render();
        } catch (err) {
          note(err.message || "Could not update visibility.");
        } finally {
          toggle.disabled = false;
        }
        return;
      }
      const btn = e.target.closest("[data-recv-act]");
      if (!btn) return;
      const act = btn.getAttribute("data-recv-act");
      try {
        btn.disabled = true;
        if (act === "save") {
          note("Saving…");
          await patchReceive(readForm(host));
          note("Receive settings saved.");
          await render();
          return;
        }
        if (act === "connect-stripe") {
          const payments = await import(`./marketplace-payments.js?v=${ASSET}`);
          note("Opening Stripe Express…");
          await payments.startStripeConnect();
          return;
        }
        if (act === "unlink-stripe") {
          await disconnectStripe();
          note("Stripe disconnected.");
          await render();
          return;
        }
        if (act === "connect-paypal") {
          note("Opening PayPal…");
          await startPaypalOAuth(next);
          return;
        }
        if (act === "unlink-paypal") {
          await disconnectPaypal();
          note("PayPal disconnected.");
          await render();
          return;
        }
        if (act === "connect-eth") {
          await connectMetaMask();
          note("Ethereum wallet connected.");
          await render();
          return;
        }
        if (act === "connect-sol") {
          await connectPhantomSol();
          note("Phantom connected.");
          await render();
          return;
        }
        if (act === "paste-eth" || act === "paste-sol" || act === "paste-btc") {
          const chain = act.slice("paste-".length);
          const addr = await promptAddress(chain);
          if (!addr) return;
          await saveWallet(chain, addr, "manual");
          note("Wallet saved.");
          await render();
          return;
        }
        if (act === "unlink-eth" || act === "unlink-sol" || act === "unlink-btc") {
          await disconnectWallet(act.slice("unlink-".length));
          note("Wallet disconnected.");
          await render();
        }
      } catch (err) {
        note(err.message || "Could not update receive settings.");
      } finally {
        btn.disabled = false;
      }
    });
  }
  try {
    await render();
  } catch (err) {
    if (err?.name === "AbortError") return;
    host.innerHTML = `<div class="recv-pay-panel"><p class="recv-pay-status">${esc(err.message || "Could not load receive settings.")}</p></div>`;
  }
}

export function receiveButtonHtml(payload, { compact = false } = {}) {
  if (!payload?.show_button) return "";
  const label = payload.button_label || "Send money";
  return `<button type="button" class="recv-pay-btn${compact ? " recv-pay-btn--compact" : ""}" data-recv-pay-open>
    ${esc(label)}${payload.preferred ? `<small>${esc(payload.preferred.replace("_", " "))}</small>` : ""}
  </button>`;
}

function qrSrc(value) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(value)}`;
}

export function openReceiveFlow(payload, { handle = "", profileName = "" } = {}) {
  if (!payload?.show_button) return;
  const methods = payload.methods || [];
  const preferred = payload.action || methods[0];
  if (!preferred) return;

  const run = async (action) => {
    if (!action) return;
    if (action.mode === "link" && action.url) {
      window.open(action.url, "_blank", "noopener");
      return;
    }
    if (action.mode === "crypto") {
      showCrypto(action);
      return;
    }
    if (action.mode === "checkout" || action.kind === "stripe") {
      await showStripe(action);
    }
  };

  function showCrypto(action) {
    const el = document.createElement("div");
    el.className = "recv-pay-modal";
    const addr = action.address || "";
    el.innerHTML = `
      <div class="recv-pay-card" role="dialog" aria-modal="true">
        <h3>Pay ${esc(profileName || "this creator")} · ${esc(action.label || "Wallet")}</h3>
        <img class="recv-pay-qr" alt="QR" src="${esc(qrSrc(addr))}" />
        <p class="recv-pay-address">${esc(addr)}</p>
        <div class="recv-pay-actions">
          <button type="button" class="btn accent" data-copy>Copy address</button>
          <button type="button" class="btn secondary" data-close>Close</button>
        </div>
      </div>`;
    el.addEventListener("click", (e) => {
      if (e.target === el || e.target.closest("[data-close]")) el.remove();
    });
    el.querySelector("[data-copy]")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(addr);
      } catch {
        /* ignore */
      }
    });
    document.body.appendChild(el);
  }

  async function showStripe() {
    const el = document.createElement("div");
    el.className = "recv-pay-modal";
    el.innerHTML = `
      <form class="recv-pay-card" role="dialog" aria-modal="true">
        <h3>Send money${profileName ? ` to ${esc(profileName)}` : ""}</h3>
        <label class="recv-pay-field">Amount (USD)
          <input type="number" name="amt" min="1" step="1" value="5" />
        </label>
        <label class="recv-pay-field">Note
          <input type="text" name="note" maxlength="120" placeholder="Optional" />
        </label>
        <div class="recv-pay-actions">
          <button type="button" class="btn secondary" data-close>Cancel</button>
          <button type="submit" class="btn accent">Continue to Stripe</button>
        </div>
        <p class="recv-pay-status" data-st></p>
      </form>`;
    const close = () => el.remove();
    el.addEventListener("click", (e) => {
      if (e.target === el || e.target.closest("[data-close]")) close();
    });
    el.querySelector("form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const dollars = Number(el.querySelector("[name=amt]")?.value || 5);
      const note = el.querySelector("[name=note]")?.value || "";
      const status = el.querySelector("[data-st]");
      if (status) status.textContent = "Opening checkout…";
      try {
        const here = window.location.href.split("#")[0];
        const data = await api("/api/receive-payments/checkout", {
          method: "POST",
          body: JSON.stringify({
            handle,
            amount_cents: Math.round(Math.max(1, dollars) * 100),
            note,
            success_url: `${here}${here.includes("?") ? "&" : "?"}paid=1`,
            cancel_url: `${here}${here.includes("?") ? "&" : "?"}paid=cancel`,
          }),
        });
        if (data.url) window.location.href = data.url;
      } catch (err) {
        if (status) status.textContent = err.message || "Checkout failed.";
      }
    });
    document.body.appendChild(el);
  }

  if (methods.length > 1) {
    const el = document.createElement("div");
    el.className = "recv-pay-modal";
    el.innerHTML = `
      <div class="recv-pay-card" role="dialog" aria-modal="true">
        <h3>Send money${profileName ? ` to ${esc(profileName)}` : ""}</h3>
        <div class="recv-pay-actions">
          ${methods
            .map(
              (m) =>
                `<button type="button" class="btn ${m.kind === preferred.kind ? "accent" : "secondary"}" data-kind="${esc(m.kind)}">${esc(m.label)}</button>`,
            )
            .join("")}
        </div>
        <button type="button" class="btn secondary" data-close>Cancel</button>
      </div>`;
    el.addEventListener("click", (e) => {
      if (e.target === el || e.target.closest("[data-close]")) el.remove();
      const kind = e.target.closest("[data-kind]")?.getAttribute("data-kind");
      if (!kind) return;
      el.remove();
      void run(methods.find((m) => m.kind === kind));
    });
    document.body.appendChild(el);
    return;
  }
  void run(preferred);
}

export function bindReceiveButton(root, payload, meta = {}) {
  root?.querySelector("[data-recv-pay-open]")?.addEventListener("click", () => {
    openReceiveFlow(payload, meta);
  });
}

void ASSET;
