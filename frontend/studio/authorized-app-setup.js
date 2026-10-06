/** Connected apps: independent status loading and actionable, explicit setup dialogs. */
import { authorizedAppLogoHtml } from "./authorized-app-logos.js?v=20260916-settings1-settings-redesign2";

const CSS_URL = new URL("./authorized-app-setup.css?v=20260916-settings1-settings-redesign2-grokd1", import.meta.url).href;
const snapshots = new WeakMap();
const loads = new WeakMap();
const GROUPS = [
  ["work", "Files & calendars", "Bring your files and availability into Render."],
  ["social", "Community & development", "Share work, receive updates and connect your tools."],
  ["payments", "Payments & wallets", "Choose where you receive marketplace payments."],
  ["stream", "Streaming", "Set up a destination for your live sessions."],
];
const GOOGLE_DOCS = "https://developers.google.com/identity/protocols/oauth2/web-server";
const STREAM_NOTE = "Streaming authorization is not complete in this version. Use your provider’s studio to go live.";
export const APP_SETUP = Object.freeze({
  stripe: { label: "Stripe", group: "payments", description: "Accept card payments and receive bank payouts.", env: ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY"], docs: "https://docs.stripe.com/connect/express-accounts", steps: ["Continue to Stripe to create or select your Express account.", "Complete the identity and bank details requested by Stripe.", "Return to Render to check whether onboarding is complete."], developer: "Enable Connect in the Stripe platform dashboard. This integration already uses Express accounts. Use matching test or live keys; configure STRIPE_WEBHOOK_SECRET separately for checkout webhooks. Onboarding returns to /marketplace.html?seller=connected#payments-readme and refreshes at /marketplace.html?seller=refresh#payments-readme. Never enable the backend’s demo account path for a real user." },
  paypal: { label: "PayPal", group: "payments", description: "Link the PayPal account you use to receive payments.", env: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_MODE=live"], callback: "/oauth/paypal/callback", redirectEnv: "PAYPAL_REDIRECT_URI", docs: "https://developer.paypal.com/log-in/build", steps: ["Continue to PayPal and sign in to your account.", "Review the requested profile and email access, then return to Render."], developer: "Create a PayPal REST app with Log in with PayPal enabled. Match PAYPAL_MODE to the app credentials (live or sandbox). This route requests openid, profile and email; linking identity does not itself implement PayPal merchant checkout or payouts." },
  phantom: { label: "Phantom", group: "payments", description: "Use a Solana address for wallet payouts.", docs: "https://phantom.com/download", steps: ["Install or open Phantom in a supported browser and unlock your wallet.", "Connect the wallet here, or paste a public Solana address.", "Check the address before saving. Render never needs a recovery phrase."], developer: "No server OAuth credentials are required. Render uses Phantom’s injected Solana provider or saves a public address with /api/receive-payments/wallets. A wallet connection requests account access, not a transaction. The receive-payments service also synchronizes the seller’s Solana payout address." },
  "wallet-eth": { label: "Ethereum", group: "payments", description: "Save an Ethereum address for wallet payouts.", docs: "https://metamask.io/download", steps: ["Unlock MetaMask or a compatible browser wallet, or copy your public Ethereum address.", "Connect the browser wallet or paste the address below.", "Saving an address does not send funds or request a transaction."], developer: "No server OAuth credentials are required. Use the injected EIP-1193 provider’s eth_requestAccounts, or manually save a public 0x address with /api/receive-payments/wallets. Do not request a private key or seed phrase." },
  "wallet-btc": { label: "Bitcoin", group: "payments", description: "Save the Bitcoin address where you receive funds.", docs: "https://bitcoin.org/en/choose-your-wallet", steps: ["Open your Bitcoin wallet and copy a receive address.", "Paste the public address below and check it before saving."], developer: "This integration stores a public Bitcoin address through /api/receive-payments/wallets. There is no Bitcoin OAuth connection or wallet extension requirement. Never request private keys or a recovery phrase." },
  twitter: { label: "X", group: "social", description: "Share clips and screenshots from Render.", env: ["TWITTER_CLIENT_ID", "TWITTER_CLIENT_SECRET", "TWITTER_OAUTH_MODE=auto"], callback: "/oauth/twitter/callback", redirectEnv: "TWITTER_REDIRECT_URI", docs: "https://docs.x.com/fundamentals/authentication/overview", steps: ["Continue to X and review the account permissions.", "If X provides a PIN, keep this dialog open and enter it here.", "Return to Render after authorizing."], developer: "Use the X app’s API Key and API Key Secret for OAuth 1.0a (auto mode), with Read and write access. OAuth 2.0 Client ID/Secret require TWITTER_OAUTH_MODE=oauth2. A user’s stored X consumer keys take precedence. The existing /api/integrations/twitter/link-url and link-pin routes handle redirect and PIN flows." },
  grok_bot: { label: "Grok bot", group: "social", description: "Connect your X app and optionally use Grok chat.", env: ["X_CONSUMER_KEY", "X_CONSUMER_SECRET", "X_WEBHOOK_PATH=/api/webhooks/x"], docs: "https://console.x.ai/", steps: ["Create or open your X developer app and find its Consumer Key and Secret.", "Enter the keys below, or leave them blank to use keys already saved.", "Add an optional xAI API key for Grok chat, then save.", "Register https://render3d.app/api/webhooks/x in the X developer portal Account Activity settings."], developer: "Use the existing /api/integrations/grok-bot/connect endpoint with consumer_key, consumer_secret and optional xai_api_key. Inbound mentions/DMs: GET/POST https://render3d.app/api/webhooks/x (alias /api/x/webhook) — CRC HMAC and X-Twitter-Webhooks-Signature. For a local AI harness, locate mcp/grok-bot/server.py in this checkout and configure a stdio MCP server with python3 and the absolute script path; set PYTHONPATH to the checkout root and RENDER_STUDIO_URL to the local service. Supply X_CONSUMER_KEY, X_CONSUMER_SECRET and optional XAI_API_KEY through secure environment settings. To use keys saved in Studio, set RENDER_STUDIO_TOKEN (or RENDER3D_TOKEN) securely; never paste a real token into the harness instructions. Verify with grok_status; keep posts as drafts until explicit approval. Do not hard-code another developer’s machine path." },
  discord: { label: "Discord", group: "social", description: "Link your account for messages and bot alerts.", env: ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"], callback: "/oauth/discord/callback", redirectEnv: "DISCORD_REDIRECT_URI", docs: "https://docs.discord.com/developers/topics/oauth2", steps: ["Continue to Discord and choose the account you use with Render.", "Approve account identity access and return here.", "Bot alerts also require Render’s Discord bot to be available."], developer: "Register an application in the Discord Developer Portal with the identify scope. DISCORD_BOT_TOKEN and the running Gateway listener are separate requirements for DM/mention alerts; OAuth identity linking alone does not start a bot. Existing status exposes required bot permissions and intents." },
  github: { label: "GitHub", group: "social", description: "Find your repositories and pull requests in Foundry.", env: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"], callback: "/oauth/github/callback", redirectEnv: "GITHUB_REDIRECT_URI", docs: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app", steps: ["Continue to GitHub and select your account.", "Review the requested read:user and repo access, including any organization approval.", "Return to Render and open Foundry."], developer: "Create a GitHub OAuth App, not a personal access token. Register the exact callback URL. Client ID and secret are stored on the Supabase Auth GitHub provider (server-side) with a local .env runtime copy — never in frontend JS. Existing linking requests read:user and repo; organization restrictions may require owner approval. User PATs are Fernet ciphertext on Users.github_pat (service role only). This links an integration, not a new Render login identity." },
  "google-drive": { label: "Google Drive", group: "work", description: "Import Drive folders into a knowledge base.", env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], callback: "/oauth/drive/callback", docs: GOOGLE_DOCS, steps: ["Continue to Google and select the account containing your files.", "Review read-only Drive access, then return to Render.", "Choose a folder when adding a knowledge base source."], developer: "Create a Google Cloud Web application OAuth client, enable the Drive API and configure the consent screen. Add test users while the app is in Testing. Register /oauth/drive/callback using PUBLIC_BASE_URL; GOOGLE_REDIRECT_URI is used by sign-in and should not be replaced with the Drive callback. The Drive integration requests drive.readonly plus identity scopes." },
  "google-calendar": { label: "Google Calendar", group: "work", description: "Share availability and create meeting events.", env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], callback: "/oauth/calendar/callback", docs: GOOGLE_DOCS, steps: ["Continue to Google and choose your calendar account.", "Review event and availability access, then return to Render.", "Use meeting scheduling to share busy/free times and create Google Meet events."], developer: "Enable the Google Calendar API and configure the OAuth consent screen. Register /oauth/calendar/callback derived from PUBLIC_BASE_URL (unless GOOGLE_REDIRECT_URI explicitly points to that calendar callback). Keep the existing sign-in callback registered. This integration requests calendar.events and calendar.freebusy plus identity scopes." },
  outlook: { label: "Outlook", group: "work", description: "Use your Microsoft calendar for scheduling.", env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"], callback: "/oauth/calendar/callback", docs: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app", steps: ["Continue to Microsoft and choose your Outlook or Microsoft 365 account.", "Review calendar access. Your organization may require admin approval.", "Return to Render to use availability and scheduling."], developer: "Register a Web application in Microsoft Entra ID with account types matching your users. Register /oauth/calendar/callback derived from PUBLIC_BASE_URL; calendar linking shares that callback with Google, not /oauth/microsoft/callback. Add delegated Calendars.ReadWrite and identity/offline_access permissions." },
  "stream-x_live": { label: "X Live", group: "stream", description: "Plan a live session on X.", env: ["TWITTER_CLIENT_ID", "TWITTER_CLIENT_SECRET"], callback: "/oauth/stream/x_live/callback", docs: "https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code", studio: "https://studio.x.com/", steps: ["Use X’s producer tools to set up your broadcast.", "Render can prepare your session; streaming account authorization needs developer setup."], developer: "The current stream callback only stores a destination flag. Implement OAuth 2.0 PKCE, exchange and validate the returned code, store/refresh tokens and fetch the verified identity before claiming authorization. Use OAuth 2.0 client credentials, not an OAuth 1.0a consumer key. Live RTMP/WHIP ingest is not implemented." },
  "stream-twitch": { label: "Twitch", group: "stream", description: "Plan a stream on Twitch.", env: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"], callback: "/oauth/stream/twitch/callback", docs: "https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/", studio: "https://dashboard.twitch.tv/", steps: ["Open Twitch Creator Dashboard to configure your broadcast.", "Render’s streaming account authorization needs developer setup before it can verify a connected account."], developer: "Register a Twitch application and the exact callback. The current stream callback only stores a destination flag. Implement server-side authorization-code exchange, token validation, refresh and verified account identity before enabling authorization; request user:read:email only if needed. Live RTMP/WHIP ingest is not implemented." },
  "stream-kick": { label: "Kick", group: "stream", description: "Plan a stream on Kick.", env: ["KICK_CLIENT_ID", "KICK_CLIENT_SECRET"], callback: "/oauth/stream/kick/callback", docs: "https://docs.kick.com/getting-started/generating-tokens-oauth2-flow", studio: "https://dashboard.kick.com/", steps: ["Open your Kick dashboard to configure your broadcast.", "Render’s streaming account authorization needs developer setup before it can verify a connected account."], developer: "Register a Kick developer application and callback. The current stream callback only stores a destination flag. Implement the required PKCE challenge/verifier, server-side code exchange, token refresh and verified user identity. The present authorize URL is incomplete without PKCE. Live RTMP/WHIP ingest is not implemented." },
});

function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function short(value) { const text = String(value || ""); return text.length > 20 ? `${text.slice(0, 7)}…${text.slice(-6)}` : text; }
function ensureStyles() {
  if (document.querySelector('link[data-authorized-app-setup]')) return;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = CSS_URL; link.dataset.authorizedAppSetup = ""; document.head.append(link);
}
export function buildAuthorizedAppRows(statuses = {}) {
  const { seller = {}, receive = {}, twitter = {}, discord = {}, github = {}, calendars = {}, streams = {}, drive = {}, grok = {} } = statuses;
  const stripeId = seller.stripe_account_id || receive.stripe_account_id;
  const stripeDemo = String(stripeId || "").startsWith("acct_demo_");
  const stripeReady = !stripeDemo && !!(seller.stripe_ready || receive.stripe_ready);
  const wallets = receive.wallets || {};
  const sol = seller.payout_details?.phantom?.wallet_address || wallets.sol?.address;
  const calendar = (provider) => (calendars.connections || []).find((row) => row.provider === provider);
  const row = (key, source, connected, extra = {}) => ({ key, ...APP_SETUP[key], connected: !!connected, configured: source.configured, error: source.error || "", ...extra });
  return [
    row("google-drive", drive, drive.connected, { detail: drive.connected ? `Read-only files${drive.email ? ` · ${drive.email}` : ""}` : APP_SETUP["google-drive"].description }),
    row("google-calendar", calendars, calendar("google"), { detail: calendar("google")?.email || APP_SETUP["google-calendar"].description }),
    row("outlook", calendars, calendar("microsoft"), { detail: calendar("microsoft")?.email || APP_SETUP.outlook.description }),
    row("twitter", twitter, twitter.connected, { detail: twitter.connected ? `Sharing as ${twitter.account?.username || twitter.account?.display_name || "your X account"}` : APP_SETUP.twitter.description }),
    row("grok_bot", grok, grok.connected, { configured: true }),
    row("discord", discord, discord.connected, { detail: discord.account?.handle || discord.account?.display_name || APP_SETUP.discord.description }),
    row("github", github, github.connected, { detail: github.account?.login || APP_SETUP.github.description }),
    row("stripe", { error: receive.error || seller.error, configured: receive.stripe_configured }, !!stripeId && !stripeDemo, { ready: stripeReady, demo: stripeDemo, action: stripeReady ? "unlink-stripe" : "connect-stripe", cta: stripeId && !stripeReady ? "Finish setup" : undefined, detail: stripeDemo ? "Demo account · set up Stripe for real payments" : stripeId && !stripeReady ? "Finish Express onboarding to receive payments" : APP_SETUP.stripe.description }),
    row("paypal", { error: receive.error, configured: receive.paypal_oauth_configured }, receive.paypal_connected, { detail: receive.paypal_email || APP_SETUP.paypal.description }),
    row("phantom", receive, sol, { configured: true, detail: sol ? `${short(sol)} · Solana` : APP_SETUP.phantom.description }),
    row("wallet-eth", receive, wallets.eth?.address, { configured: true, detail: wallets.eth?.address ? `${short(wallets.eth.address)} · Ethereum` : APP_SETUP["wallet-eth"].description }),
    row("wallet-btc", receive, wallets.btc?.address, { configured: true, detail: wallets.btc?.address ? short(wallets.btc.address) : APP_SETUP["wallet-btc"].description }),
    ...["x_live", "twitch", "kick"].map((id) => { const state = (streams.providers || []).find((p) => p.id === id) || {}; return row(`stream-${id}`, { ...state, error: streams.error }, state.connected, { configured: false, destinationOnly: true, detail: state.connected ? "Destination saved · authorization setup needed" : "Broadcast through your provider’s studio" }); }),
  ].map((entry) => ({ ...entry, action: entry.action || (entry.connected ? `disconnect-${entry.key}` : `connect-${entry.key}`) }));
}

let authorizedAppsAbort = null; // leakfix57
export async function loadAuthorizedAppStatuses(api, signal) {
  const endpoints = { seller: "/api/marketplace/seller", receive: "/api/receive-payments/me", discord: "/api/integrations/discord/status", twitter: "/api/integrations/twitter/status", github: "/api/integrations/github/status", calendars: "/api/users/me/calendar-connections", streams: "/api/integrations/stream/status", drive: "/api/users/me/drive/status", grok: "/api/integrations/grok-bot/status" };
  const entries = Object.entries(endpoints);
  const settled = await Promise.allSettled(entries.map(async ([, url]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const onParentAbort = () => { try { controller.abort(); } catch (_) { /* ignore */ } };
    if (signal?.aborted) {
      clearTimeout(timer);
      throw new DOMException("Aborted", "AbortError");
    }
    signal?.addEventListener("abort", onParentAbort, { once: true });
    try { return await api(url, { signal: controller.signal }); } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onParentAbort);
    }
  }));
  return Object.fromEntries(entries.map(([key], i) => {
    const result = settled[i];
    if (result.status === "rejected") return [key, { error: result.reason?.name === "AbortError" ? "Status request timed out. Try again." : result.reason?.message || "Status is unavailable. Try again." }];
    return [key, (key === "seller" ? result.value?.seller : result.value) || {}];
  }));
}

export async function hydrateAuthorizedAppList({ host, api, authenticated, refresh } = {}) {
  if (!host) return;
  ensureStyles();
  if (authorizedAppsAbort) {
    try { authorizedAppsAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  authorizedAppsAbort = ctl;
  const loadId = Symbol(); loads.set(host, loadId);
  try {
    if (!authenticated) { host.innerHTML = '<p class="apps-empty">Sign in to connect accounts and manage integrations.</p>'; return; }
    if (!snapshots.has(host)) host.innerHTML = '<p class="apps-empty" role="status">Checking your connected apps…</p>';
    const statuses = await loadAuthorizedAppStatuses(api, ctl.signal);
    if (ctl.signal.aborted) return;
    if (!host.isConnected || loads.get(host) !== loadId) return;
    const rows = buildAuthorizedAppRows(statuses);
    snapshots.set(host, rows);
    host.parentElement?.querySelector("[data-grok-bot-wiring]")?.remove();
    host.innerHTML = `<div class="apps-list-toolbar"><p>Connect an account or open its setup guide.</p><button type="button" class="apps-text-button" data-apps-refresh>Refresh status</button></div>` + GROUPS.map(([group, title, detail]) => `<section class="apps-group" aria-label="${title}"><header><h3>${title}</h3><p>${detail}</p></header><div class="apps-group-grid">${rows.filter((item) => item.group === group).map((item) => {
      const state = item.error ? "Status unavailable" : item.destinationOnly ? (item.connected ? "Destination saved" : "Setup needed") : item.demo ? "Demo account" : item.key === "stripe" && item.connected && !item.ready ? "Incomplete" : item.connected ? "Connected" : item.configured === false ? "Setup needed" : "Not connected";
      const label = item.cta || (item.connected ? "Manage" : item.error || item.configured === false ? "Setup guide" : "Connect");
      return `<article class="authorized-app-row apps-card authorized-app-row--${esc(item.key)}" data-app-key="${esc(item.key)}"><span class="authorized-app-icon">${authorizedAppLogoHtml(item.key, item.label)}</span><span class="authorized-app-copy"><b>${esc(item.label)}</b><small>${esc(item.error || item.detail || item.description)}</small></span><span class="authorized-app-state ${item.connected && !item.destinationOnly && !item.error && (item.key !== "stripe" || item.ready) ? "is-connected" : ""}">${state}</span><button type="button" class="apps-connect-button" data-authorized-app-key="${esc(item.key)}" data-authorized-app-action="${esc(item.action)}" aria-label="${esc(label)} ${esc(item.label)}">${esc(label)}</button></article>`;
    }).join("")}</div></section>`).join("");
    host.querySelector("[data-apps-refresh]")?.addEventListener("click", () => void (refresh?.() || hydrateAuthorizedAppList({ host, api, authenticated, refresh })));
    const grokRow = host.querySelector('.authorized-app-row--grok_bot');
    if (grokRow) {
      try {
        const grokMod = await import("./authorized-grok-bot.js?v=grokdimos1&teleop-y=20260922-poseconnect1&studio-relay=20260927-1&vrrobot=20260927-2");
        const grokStatus = statuses?.grok || statuses?.grok_bot || {};
        grokMod.mountAfterList(grokRow, grokStatus, {
          api: async (path, opts = {}) => {
            const method = String(opts.method || "GET").toUpperCase();
            const init = { method, ...(opts.body ? { body: opts.body, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } } : opts) };
            const res = await api(path, init);
            if (res?.detail && (res.ok === false || typeof res.detail === "string") && !res.linked && !res.upstream && path.includes("/dimos")) {
              /* allow probe/link payloads */
            }
            if (typeof res?.detail === "string" && res.status_code >= 400) {
              throw new Error(res.detail);
            }
            return res;
          },
          setStatus: (_kind, msg) => {
            const el = host.parentElement?.querySelector("[data-grok-dimos-status]");
            if (el && msg) el.textContent = msg;
          },
          refresh: () => refresh?.() || hydrateAuthorizedAppList({ host, api, authenticated, refresh }),
        });
      } catch { /* optional */ }
    }
  } finally {
    if (authorizedAppsAbort === ctl) authorizedAppsAbort = null;
  }
}

export function buildSetupInstructions(key, { origin = "https://render3d.app" } = {}) {
  const app = APP_SETUP[key];
  if (!app) throw new Error("Unknown app.");
  let base;
  try { const parsed = new URL(origin); base = ["https:", "http:"].includes(parsed.protocol) ? parsed.origin : "https://render3d.app"; } catch { base = "https://render3d.app"; }
  const env = [...(app.env || []).map((name) => name.includes("=") ? name : `${name}=<set securely>`), ...(app.callback ? [`PUBLIC_BASE_URL=${base}`, ...(app.redirectEnv ? [`${app.redirectEnv}=${base}${app.callback}`] : [])] : [])];
  return [
    `Set up ${app.label} for this Render Studio checkout.`,
    "Inspect backend/config.py and the existing provider service/routes first. Preserve existing settings, linked accounts and unrelated integrations. Use the current environment’s service manager; do not restart a live server during active generations.",
    app.developer,
    app.callback ? `Register this example callback with the provider: ${base}${app.callback}. Confirm the deployment’s actual public origin and callback before saving.` : "",
    env.length ? `Server .env / secret-manager template (placeholders only):\n${env.join("\n")}` : "No server OAuth .env credentials are required for this connection.",
    "Obtain any real credentials from the account owner via secure settings. Never put secrets in frontend code, source control, copied chat instructions or logs. Do not fabricate connected status. Test failures and cancellation as well as successful authorization; do not connect, unlink or post with a real account during automated tests.",
    `Provider reference: ${app.docs}`,
    "After setup, return to Settings → Connected apps, refresh status and have the account owner explicitly continue. Explain any provider approval or implementation still needed. This is a setup task for your AI coding harness, not a universal one-command installer.",
  ].filter(Boolean).join("\n\n");
}

const OAUTH_START = {
  stripe: ["/api/marketplace/seller/connect", "POST"], paypal: ["/api/receive-payments/paypal/connect?next=%2F", "GET"], twitter: ["/api/integrations/twitter/link-url", "POST"], discord: ["/api/integrations/discord/link-url", "POST"], github: ["/api/integrations/github/link-url", "POST"], "google-drive": ["/api/users/me/drive/connect", "GET"], "google-calendar": ["/api/users/me/calendar/connect/google", "GET"], outlook: ["/api/users/me/calendar/connect/microsoft", "GET"],
};
const DISCONNECT = { stripe: "/api/receive-payments/stripe", paypal: "/api/receive-payments/paypal", phantom: "/api/receive-payments/wallets/sol", "wallet-eth": "/api/receive-payments/wallets/eth", "wallet-btc": "/api/receive-payments/wallets/btc", twitter: "/api/integrations/twitter/link", discord: "/api/integrations/discord/link", github: "/api/integrations/github/link", grok_bot: "/api/integrations/grok-bot", "google-drive": "/api/users/me/drive/connect", "google-calendar": "/api/users/me/calendar-connections/google", outlook: "/api/users/me/calendar-connections/microsoft", "stream-x_live": "/api/integrations/stream/x_live", "stream-twitch": "/api/integrations/stream/twitch", "stream-kick": "/api/integrations/stream/kick" };
export function resolveAppAction(key, action) {
  if (!APP_SETUP[key]) return null;
  if (key === "stripe" && action === "connect-stripe") return { kind: "connect", endpoint: OAUTH_START.stripe[0], method: "POST" };
  if (/^(unlink|disconnect)-/.test(action)) return { kind: "disconnect", endpoint: DISCONNECT[key], method: "DELETE" };
  if (key.startsWith("stream-")) return { kind: "setup" };
  if (OAUTH_START[key]) return { kind: "connect", endpoint: OAUTH_START[key][0], method: OAUTH_START[key][1] };
  return { kind: key === "grok_bot" ? "grok" : "wallet" };
}

function safeProviderUrl(raw) {
  const url = new URL(String(raw || ""), window.location.origin);
  if (!/^https?:$/.test(url.protocol)) throw new Error("The provider returned an invalid authorization URL.");
  return url.href;
}
function walletFields(key) {
  const chain = key === "phantom" ? "sol" : key === "wallet-eth" ? "eth" : "btc";
  return `<div class="apps-setup-fields"><label>Public ${chain === "sol" ? "Solana" : chain === "eth" ? "Ethereum" : "Bitcoin"} address<input name="wallet_address" type="text" autocomplete="off" spellcheck="false" placeholder="${chain === "eth" ? "0x…" : "Paste a receive address"}" /></label><p>Your address is public. Never enter a private key or recovery phrase.</p><button type="button" class="apps-secondary" data-save-address>Save address</button></div>`;
}
function grokFields() {
  return `<div class="apps-setup-fields"><label>X Consumer Key<input name="consumer_key" autocomplete="off" spellcheck="false" placeholder="Leave blank to keep your saved key" /></label><label>X Consumer Secret<input name="consumer_secret" type="password" autocomplete="new-password" placeholder="Leave blank to keep your saved secret" /></label><label>xAI API key <small>Optional · for Grok chat</small><input name="xai_api_key" type="password" autocomplete="new-password" placeholder="xai-…" /></label></div>`;
}

export function openAuthorizedAppAction({ host, key, action, api, refresh, row: suppliedRow, navigate = (url) => window.location.assign(url), clipboard = (text) => navigator.clipboard.writeText(text) } = {}) {
  const row = suppliedRow || snapshots.get(host)?.find((item) => item.key === key) || { key, ...APP_SETUP[key] };
  const app = APP_SETUP[key];
  if (!app) throw new Error("This app does not have a setup guide yet.");
  ensureStyles();
  document.querySelector(".apps-setup-overlay")?.dispatchEvent(new Event("apps-close"));
  const previousFocus = document.activeElement;
  const mode = resolveAppAction(key, action || row.action || `connect-${key}`);
  const manage = mode.kind === "disconnect";
  const wallet = mode.kind === "wallet";
  const needsSetup = !manage && (row.configured === false || mode.kind === "setup");
  const title = manage ? `${app.label} connection` : `Set up ${app.label}`;
  const overlay = document.createElement("div");
  overlay.className = "apps-setup-overlay";
  overlay.innerHTML = `<section class="apps-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="apps-setup-title" tabindex="-1"><header class="apps-setup-header"><span class="apps-setup-brand">${authorizedAppLogoHtml(key, app.label)}</span><div><p>${manage ? "Connected apps" : "Connection guide"}</p><h2 id="apps-setup-title">${esc(title)}</h2></div><button type="button" class="apps-setup-close" aria-label="Close setup" data-close>×</button></header><div class="apps-setup-body"><p class="apps-setup-intro">${esc(app.description)}</p>${key.startsWith("stream-") ? `<p class="apps-setup-callout">${STREAM_NOTE}${row.connected ? " Your saved destination is not proof of authorization." : ""}</p>` : needsSetup ? `<p class="apps-setup-callout">A workspace administrator needs to configure this integration first. Use the developer guide below, or copy the setup instructions to your AI harness.</p>` : ""}${row.error ? `<p class="apps-setup-callout">Status could not be checked: ${esc(row.error)}. You can retry from this dialog.</p>` : ""}${manage ? `<p>This account is linked to Render. Disconnecting removes the Render connection; it does not delete your ${esc(app.label)} account.</p>` : `<ol class="apps-setup-steps">${app.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>`}${!manage && wallet ? walletFields(key) : ""}${!manage && key === "grok_bot" ? grokFields() : ""}<div data-x-pin hidden><a class="apps-secondary" data-x-open target="_blank" rel="noopener noreferrer">Open X authorization ↗</a><label>PIN from X<input name="x_pin" inputmode="numeric" autocomplete="one-time-code" placeholder="Enter PIN" /></label><button type="button" class="apps-secondary" data-x-submit>Finish connection</button></div><details class="apps-developer" ${needsSetup ? "open" : ""}><summary>Developer setup <span>Instructions for you or your AI harness</span></summary><p>${esc(app.developer)}</p>${app.env?.length ? `<pre class="apps-env-template">${esc(app.env.map((name) => name.includes("=") ? name : `${name}=<set securely>`).join("\n"))}</pre>` : ""}${app.callback ? `<p>Callback example <code>${esc(window.location.origin + app.callback)}</code><small>Match the public URL configured on your Render server.</small></p>` : ""}<p><a href="${esc(app.docs)}" target="_blank" rel="noopener noreferrer">${key === "phantom" || key === "wallet-eth" || key === "wallet-btc" ? "Wallet setup" : "Provider documentation"} ↗</a></p><button type="button" class="apps-secondary" data-copy>Copy setup instructions</button><textarea data-copy-fallback readonly hidden aria-label="Setup instructions to copy"></textarea></details><p class="apps-setup-status" role="status" aria-live="polite" data-status></p></div><footer class="apps-setup-footer"><button type="button" class="apps-secondary" data-close>Close</button>${app.studio ? `<a class="apps-secondary" href="${esc(app.studio)}" target="_blank" rel="noopener noreferrer">Open ${esc(app.label)} studio ↗</a>` : ""}${manage ? '<button type="button" class="apps-disconnect" data-continue>Disconnect</button>' : needsSetup ? '<button type="button" class="apps-primary" data-recheck>Check setup again</button>' : `<button type="button" class="apps-primary" data-continue>${wallet ? key === "wallet-btc" ? "Save address" : "Connect browser wallet" : key === "grok_bot" ? "Save and connect" : `Continue to ${esc(app.label)}`}</button>`}</footer></section>`;
  const dialog = overlay.querySelector(".apps-setup-dialog");
  const status = overlay.querySelector("[data-status]");
  let closed = false;
  const close = () => { if (closed) return; closed = true; document.removeEventListener("keydown", onKeyDown, true); overlay.remove(); previousFocus?.isConnected && previousFocus.focus?.(); };
  overlay.addEventListener("apps-close", close, { once: true });
  const note = (message, error = false) => { status.textContent = message; status.classList.toggle("is-error", error); };
  const busy = async (button, work) => {
    if (button.disabled) return;
    button.disabled = true;
    try { await work(); } catch (error) { note(error?.message || "Could not complete this connection. Try again or open Developer setup.", true); }
    finally { button.disabled = false; if (button.isConnected && document.activeElement === document.body) button.focus(); }
  };
  const complete = async (message) => { note(message); overlay.querySelectorAll(".apps-setup-fields input").forEach((input) => { input.value = ""; }); await refresh?.(); };
  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });
  const chain = key === "phantom" ? "sol" : key === "wallet-eth" ? "eth" : "btc";
  const saveAddress = async (address, connectedVia) => {
    if (!String(address).trim()) throw new Error("Enter a public wallet address first.");
    await post("/api/receive-payments/wallets", { chain, address: String(address).trim(), enabled: true, connected_via: connectedVia });
    await complete("Wallet address saved.");
  };
  const continueFlow = async (button) => {
    if (manage) { await api(mode.endpoint, { method: "DELETE" }); await complete(`${app.label} disconnected.`); button.remove(); return; }
    if (wallet) {
      if (key === "wallet-btc") return saveAddress(overlay.querySelector('[name="wallet_address"]').value, "manual");
      if (key === "phantom") {
        const provider = window.phantom?.solana || window.solana;
        if (!provider?.isPhantom || typeof provider.connect !== "function") throw new Error("Open this page in a browser with Phantom installed and unlocked, or paste a public address above.");
        const result = await provider.connect();
        return saveAddress(result?.publicKey?.toString?.() || provider.publicKey?.toString?.() || "", "phantom");
      }
      if (!window.ethereum?.request) throw new Error("Open this page in a browser with MetaMask or another Ethereum wallet, or paste a public address above.");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      return saveAddress(accounts?.[0] || "", "metamask");
    }
    if (mode.kind === "grok") {
      const body = Object.fromEntries(["consumer_key", "consumer_secret", "xai_api_key"].map((name) => [name, overlay.querySelector(`[name="${name}"]`).value]));
      await post("/api/integrations/grok-bot/connect", body);
      return complete("Grok bot connected.");
    }
    if (mode.kind !== "connect") return;
    // Recheck Stripe configuration to avoid the backend's unconfigured demo-account fallback.
    if (key === "stripe") {
      const current = await api("/api/receive-payments/me");
      if (!current?.stripe_configured) throw new Error("Stripe is not configured on this server. Open Developer setup and configure Connect before continuing.");
    }
    note(`Preparing ${app.label} authorization…`);
    const data = await api(mode.endpoint, { method: mode.method, ...(mode.method === "POST" ? { body: "{}" } : {}) });
    if (!data?.url || data.demo) throw new Error(data?.message || `${app.label} did not return an authorization link. Check Developer setup.`);
    const url = safeProviderUrl(data.url);
    if (key === "twitter" && data.mode === "oob") {
      const pin = overlay.querySelector("[data-x-pin]"); pin.hidden = false;
      pin.querySelector("[data-x-open]").href = url;
      pin.querySelector("[data-x-submit]").onclick = (event) => void busy(event.currentTarget, async () => {
        const value = pin.querySelector('[name="x_pin"]').value.trim();
        if (!value) throw new Error("Enter the PIN shown by X first.");
        await post("/api/integrations/twitter/link-pin", { state: data.state, pin: value });
        pin.hidden = true; await complete("X connected.");
      });
      note("Open X authorization, approve access, then enter the PIN above.");
      return;
    }
    note(`Opening ${app.label} in this tab…`);
    navigate(url);
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-close]")) return close();
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-continue]")) void busy(button, () => continueFlow(button));
    if (button.matches("[data-save-address]")) void busy(button, () => saveAddress(overlay.querySelector('[name="wallet_address"]').value, "manual"));
    if (button.matches("[data-copy]")) void busy(button, async () => {
      const instructions = buildSetupInstructions(key, { origin: window.location.origin });
      try { await clipboard(instructions); note("Setup instructions copied. Paste them into your AI coding harness."); }
      catch { const area = overlay.querySelector("[data-copy-fallback]"); area.hidden = false; area.value = instructions; area.focus(); area.select(); note("Clipboard access is unavailable. Copy the selected instructions below."); }
    });
    if (button.matches("[data-recheck]")) void busy(button, async () => {
      note("Checking server setup…");
      const statuses = await loadAuthorizedAppStatuses(api);
      const current = buildAuthorizedAppRows(statuses).find((item) => item.key === key);
      await refresh?.();
      if (current.error) throw new Error(current.error);
      if (current.configured === false) { note(key.startsWith("stream-") ? STREAM_NOTE : "Setup is still needed. Ask the workspace administrator to follow Developer setup.", true); return; }
      close(); openAuthorizedAppAction({ host, key, action: `connect-${key}`, api, refresh, row: current, navigate, clipboard });
    });
  });
  function onKeyDown(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled), a[href], input, textarea, summary')].filter((node) => node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  }
  document.addEventListener("keydown", onKeyDown, true);
  document.body.append(overlay);
  overlay.querySelector(".apps-setup-close").focus();
  return { close, element: overlay };
}
