/** Authorized apps rows + disconnect for Stripe, PayPal, and wallets. */

import {
  connectMetaMask,
  connectPhantomSol,
  disconnectPaypal,
  disconnectStripe,
  disconnectWallet,
  loadReceiveStatus,
  promptAddress,
  saveWallet,
  startPaypalOAuth,
} from "./receive-payments.js?v=20260909-proftabs1&leakfix74";

export { loadReceiveStatus };

function short(value = "") {
  const text = String(value || "");
  return text.length > 14 ? `${text.slice(0, 6)}...${text.slice(-5)}` : text;
}

export function payoutAuthorizedRows({ seller, receive } = {}) {
  const stripeId = seller?.stripe_account_id || receive?.stripe_account_id;
  const stripeReady = !!(seller?.stripe_ready || receive?.stripe_ready);
  const paypalOn = !!(receive?.paypal_connected);
  const paypalConfigured = !!(receive?.paypal_oauth_configured);
  const wallets = receive?.wallets || {};
  const phantom = seller?.payout_details?.phantom?.wallet_address || wallets.sol?.address || "";
  const eth = wallets.eth?.address || "";
  const btc = wallets.btc?.address || "";

  return [
    {
      key: "stripe",
      label: "Stripe",
      icon: "stripe",
      detail: stripeReady
        ? "Bank payouts + receive money"
        : stripeId
          ? "Finish Express onboarding"
          : "Connect Express to accept cards",
      connected: !!stripeId,
      action: stripeId ? "unlink-stripe" : "connect-stripe",
      cta: stripeReady ? "Unlink" : stripeId ? "Finish setup" : "Connect",
    },
    {
      key: "paypal",
      label: "PayPal",
      icon: "PayPal",
      detail: paypalOn
        ? receive?.paypal_email || "PayPal account linked"
        : paypalConfigured
          ? "Login with PayPal to accept payments"
          : "Needs PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET",
      connected: paypalOn,
      action: paypalOn ? "unlink-paypal" : "connect-paypal-oauth",
      cta: paypalOn ? "Unlink" : paypalConfigured ? "Connect" : "Setup needed",
      disabled: !paypalOn && !paypalConfigured,
    },
    {
      key: "phantom",
      label: "Phantom",
      icon: "◇",
      detail: phantom ? `${short(phantom)} · Solana` : "Crypto wallet payouts",
      connected: !!phantom,
      action: phantom ? "unlink-wallet-sol" : "connect-phantom",
      cta: phantom ? "Unlink" : "Connect",
    },
    {
      key: "wallet-eth",
      label: "Ethereum",
      icon: "Ξ",
      detail: eth ? `${short(eth)} · ETH` : "MetaMask or paste a 0x address",
      connected: !!eth,
      action: eth ? "unlink-wallet-eth" : "connect-wallet-eth",
      cta: eth ? "Unlink" : "Connect",
    },
    {
      key: "wallet-btc",
      label: "Bitcoin",
      icon: "₿",
      detail: btc ? `${short(btc)} · BTC` : "Save a Bitcoin address",
      connected: !!btc,
      action: btc ? "unlink-wallet-btc" : "connect-wallet-btc",
      cta: btc ? "Unlink" : "Connect",
    },
  ];
}

export async function handlePayoutAction(action, { refresh, setStatus } = {}) {
  const note = (msg) => {
    if (typeof setStatus === "function") setStatus("ok", msg);
  };
  if (action === "connect-stripe") {
    const payments = await import("./marketplace-payments.js?v=20260909-proftabs1");
    note("Opening Stripe Express…");
    await payments.startStripeConnect();
    return true;
  }
  if (action === "unlink-stripe") {
    await disconnectStripe();
    note("Stripe disconnected.");
    await refresh?.();
    return true;
  }
  if (action === "connect-paypal-oauth" || action === "connect-paypal") {
    note("Opening PayPal…");
    await startPaypalOAuth("/");
    return true;
  }
  if (action === "unlink-paypal") {
    await disconnectPaypal();
    note("PayPal disconnected.");
    await refresh?.();
    return true;
  }
  if (action === "connect-phantom" || action === "connect-wallet-sol") {
    note("Opening Phantom…");
    try {
      const payments = await import("./marketplace-payments.js?v=20260909-proftabs1");
      await payments.startPhantomConnect();
    } catch {
      /* marketplace path optional */
    }
    await connectPhantomSol();
    note("Phantom connected.");
    await refresh?.();
    return true;
  }
  if (action === "connect-wallet-eth") {
    try {
      await connectMetaMask();
    } catch {
      const addr = await promptAddress("eth");
      if (!addr) return true;
      await saveWallet("eth", addr, "manual");
    }
    note("Ethereum wallet saved.");
    await refresh?.();
    return true;
  }
  if (action === "connect-wallet-btc") {
    const addr = await promptAddress("btc");
    if (!addr) return true;
    await saveWallet("btc", addr, "manual");
    note("Bitcoin address saved.");
    await refresh?.();
    return true;
  }
  if (action === "unlink-wallet-sol" || action === "unlink-wallet-eth" || action === "unlink-wallet-btc") {
    const chain = action.slice("unlink-wallet-".length);
    await disconnectWallet(chain);
    note("Wallet disconnected.");
    await refresh?.();
    return true;
  }
  return false;
}
