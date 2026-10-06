import { pendingSubscriptionShares } from "./pending-subscription-shares.js?v=20260928-ownerstatus1&sub-pending=20260928-1";
/** Connect Cloud (studio credits) and ChatGPT subscriptions in a VibeCAD-style preferences popup. */

export const PEOPLE_LIST_CAP = 7;
export const VR_LIST_CAP = 7;
export const SETTINGS_NAV_ORDER = ["preferences", "costs", "billing", "profile"];
export const BILLING_BANNER_TABS = ["subscriptions", "keys"];
export const PEOPLE_LIST_TABS = ["plan", "people", "workspace"];

const PANEL_IDS = [
  "profile-costs-panel",
  "profile-workspace-panel",
  "profile-preferences-panel",
  "profile-workspace-mgmt-panel",
];

export function hideProfileFlyoutPanels(exceptId = null) {
  for (const id of PANEL_IDS) {
    if (id === exceptId) continue;
    document.getElementById(id)?.classList.add("hidden");
  }
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const WEEKLY_USAGE_PREF_KEY = "render3d:promptWeeklyUsage:v1";

function readShowWeeklyUsagePref() {
  try {
    const raw = localStorage.getItem(WEEKLY_USAGE_PREF_KEY);
    if (raw == null || raw === "") return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

function writeShowWeeklyUsagePref(on) {
  try { localStorage.setItem(WEEKLY_USAGE_PREF_KEY, on ? "1" : "0"); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent("render3d:weekly-usage-pref")); } catch { /* ignore */ }
  return !!on;
}

function personId(p) {
  return String(p?.id || p?.user_id || "").trim();
}

function personEmail(p) {
  return String(p?.email || "").trim().toLowerCase();
}

function personHandle(p) {
  return String(p?.handle || "").trim().replace(/^@+/, "")
    || String(p?.handle_label || "").trim().replace(/^@+/, "");
}

function personName(p) {
  return String(p?.display_name || personHandle(p) || p?.email || "Person").trim();
}

function handleLabel(p) {
  const h = personHandle(p);
  return h ? `@${h}` : "";
}

function avatarUrlFor(p) {
  const url = String(p?.avatar_url || "").trim();
  if (url) return url;
  const id = personId(p);
  return id ? `/api/users/${encodeURIComponent(id)}/avatar` : "";
}

function avatarHtml(p) {
  const name = personName(p);
  const initial = (name || "?").charAt(0).toUpperCase() || "?";
  const url = avatarUrlFor(p);
  if (url) {
    return `<span class="ai-sub-avatar" aria-hidden="true"><img src="${esc(url)}" alt="" onerror="this.remove()">${esc(initial)}</span>`;
  }
  return `<span class="ai-sub-avatar" aria-hidden="true">${esc(initial)}</span>`;
}

function personKey(p) {
  return personId(p) || personEmail(p) || personHandle(p).toLowerCase() || personName(p).toLowerCase();
}

function mergePeople(...lists) {
  const out = [];
  const seen = new Map();
  const findExisting = (row) => {
    if (row.id && seen.has(`id:${row.id}`)) return seen.get(`id:${row.id}`);
    if (row.email && seen.has(`email:${row.email}`)) return seen.get(`email:${row.email}`);
    if (row.handle && seen.has(`handle:${row.handle.toLowerCase()}`)) {
      return seen.get(`handle:${row.handle.toLowerCase()}`);
    }
    return null;
  };
  const indexRow = (row) => {
    if (row.id) seen.set(`id:${row.id}`, row);
    if (row.email) seen.set(`email:${row.email}`, row);
    if (row.handle) seen.set(`handle:${row.handle.toLowerCase()}`, row);
  };
  for (const list of lists) {
    for (const raw of list || []) {
      if (!raw) continue;
      const row = {
        id: personId(raw) || null,
        user_id: personId(raw) || null,
        email: personEmail(raw) || null,
        handle: personHandle(raw) || null,
        handle_label: handleLabel(raw) || null,
        display_name: personName(raw),
        avatar_url: raw.avatar_url || avatarUrlFor(raw) || null,
        already_member: !!raw.already_member,
        needs_confirm: !!raw.needs_confirm,
        source_teams: raw.source_teams || "",
        source: raw.source || "",
        granted: raw.granted,
        is_owner: !!raw.is_owner,
        on_plan: !!raw.on_plan,
        plan_kind: raw.plan_kind || "",
        plan_sources: Array.isArray(raw.plan_sources) ? raw.plan_sources.filter(Boolean) : [],
        daily_limit_usd: raw.daily_limit_usd,
        team_id: raw.team_id || "",
        share_id: raw.share_id || "",
        provider: raw.provider || "",
        team_name: raw.team_name || "",
        grant_id: raw.grant_id || "",
        role: raw.role || "",
        role_label: raw.role_label || "",
        message: raw.message || "",
      };
      if (!personKey(row)) continue;
      const existing = findExisting(row);
      if (existing) {
        for (const key of Object.keys(row)) {
          if (key === "plan_sources") continue;
          if (row[key] === true) existing[key] = true;
          else if ((existing[key] == null || existing[key] === "") && row[key]) existing[key] = row[key];
        }
        existing.plan_sources = [...new Set([...(existing.plan_sources || []), ...(row.plan_sources || [])])];
        existing.on_plan = existing.on_plan || row.on_plan;
        if (row.granted === true) existing.granted = true;
        indexRow(existing);
        continue;
      }
      out.push(row);
      indexRow(row);
    }
  }
  return out;
}

function personSubtitle(p) {
  const handle = handleLabel(p);
  const email = personEmail(p);
  const name = personName(p).toLowerCase();
  const parts = [];
  if (handle && handle.toLowerCase() !== `@${name}`) parts.push(handle);
  if (email && email !== name && email !== personHandle(p).toLowerCase()) parts.push(email);
  return parts.join(" · ");
}

export function matchesQuery(p, q) {
  const query = String(q || "").trim().toLowerCase().replace(/^@+/, "");
  if (!query) return true;
  const hay = [p.display_name, p.email, p.handle, p.handle_label].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(query);
}

export function filterPeopleByQuery(people, query) {
  return (people || []).filter((p) => matchesQuery(p, query));
}

export function isOnYourPlan(p, { personal = false } = {}) {
  if (!p) return false;
  if (p.on_plan || p.is_owner) return true;
  if (p.granted === true) return true;
  if (p.granted === false) return false;
  return !!personal;
}

export function sortPlanUsersFirst(rows, enabled = true, { personal = false } = {}) {
  const list = Array.isArray(rows) ? [...rows] : [];
  if (!enabled) return list;
  return list.sort((a, b) => Number(isOnYourPlan(b, { personal })) - Number(isOnYourPlan(a, { personal })));
}

export function collectSubscriptionUsers(listing = {}, shareMembers = {}, providerId = "openai") {
  const pid = providerId === "claude" ? "claude" : providerId === "cursor" ? "cursor" : "openai";
  const lists = [];
  if (pid === "openai" || pid === "claude") {
    lists.push(
      personalPeople(listing, pid)
        .filter((p) => p && p.granted !== false)
        .map((p) => ({
          ...p,
          on_plan: true,
          granted: p.granted !== false,
          plan_kind: "personal",
          plan_sources: ["Personal"],
        })),
    );
  }
  const owned = listing[providerShareKey(pid)]?.owned || [];
  for (const share of owned) {
    if (!share?.id) continue;
    lists.push(
      (shareMembers[share.id] || [])
        .filter((m) => m && (m.granted || m.is_owner))
        .map((m) => ({
          ...m,
          on_plan: true,
          granted: true,
          plan_kind: m.is_owner ? "owner" : "workspace",
          plan_sources: [share.team_name || "Workspace"],
          team_id: share.team_id,
          share_id: share.id,
          provider: pid,
          team_name: share.team_name,
        })),
    );
  }
  return mergePeople(...lists);
}

export function capVisibleRows(rows, cap = PEOPLE_LIST_CAP) {
  const list = Array.isArray(rows) ? rows : [];
  const limit = Math.max(1, Number(cap) || PEOPLE_LIST_CAP);
  return {
    visible: list.slice(0, limit),
    hidden: Math.max(0, list.length - limit),
    cap: limit,
    total: list.length,
    overflow: list.length > limit,
  };
}

export function sharedSubscriptionAccess(provider, listing = {}) {
  const id = String(provider?.id || "");
  if (id !== "openai" && id !== "claude") return { available: false, ownerNames: [] };
  const shares = listing[id === "openai" ? "chatgpt_shares" : "claude_shares"] || {};
  const received = [
    ...(shares.received || []),
    ...(shares.personal_received || (id === "openai" ? listing.personal_received : []) || []),
  ].filter((share) => share.granted && share.owner_signed_in);
  return {
    available: received.length > 0,
    ownerNames: [...new Set(received.map((share) => share.owner_name || "a teammate"))],
  };
}

export function connectedAppState(provider, listing = {}) {
  const id = String(provider?.id || "");
  const connected = cliProviderId(provider)
    ? subscriptionAuthStatus(provider, listing) === "signed_in"
    : !!(provider?.connected || provider?.auth_status === "signed_in");
  const shared = sharedSubscriptionAccess(provider, listing).available;
  const pendingOwner = pendingSubscriptionShares(listing).some((share) => share.id === id);
  return {
    id,
    connected: connected || shared,
    label: connected ? "connected" : shared ? "shared" : pendingOwner ? "shared · owner sign-in needed" : "not connected",
  };
}

export function subscriptionOnboardingMarkup(listing = {}) {
  const providers = connectableProviders(listing.providers || DEFAULT_PROVIDERS);
  const connected = providers.some((provider) => ["openai", "claude"].includes(provider.id)
    && connectedAppState(provider, listing).connected);
  if (connected) return "";
  return `
    <section class="ai-sub-onboarding" aria-label="Connect your AI subscription">
      <div>
        <strong>Connect your subscription</strong>
        <p>Hey AI uses your ChatGPT or Claude subscription for the design conversation. Connect once, then return to the Hey button.</p>
      </div>
      <button type="button" class="btn accent" data-ai-sub-chatgpt-signin>Connect your subscription</button>
    </section>`;
}

export function preferredSubscriptionProviderId(listing = {}, currentId = "cloud", selectionLocked = false) {
  const providers = connectableProviders(listing.providers || DEFAULT_PROVIDERS);
  const ids = providers.map((provider) => provider.id);
  if (selectionLocked && ids.includes(currentId)) return currentId;
  const pending = providers.find((provider) => subscriptionLoginPending(provider, listing));
  if (pending) return pending.id;
  const connected = ["openai", "claude"].find((id) => {
    const provider = providers.find((row) => row.id === id);
    return provider && connectedAppState(provider, listing).connected;
  });
  if (connected) return connected;
  if (ids.includes(currentId)) return currentId;
  return ids.includes("cloud") ? "cloud" : (ids[0] || "cloud");
}

export function applyAiBillingTab(tab = "keys", { costs = null } = {}) {
  const modal = document.getElementById("ai-key-modal");
  if (!modal) return "keys";
  const next = tab === "subscriptions" ? "subscriptions" : "keys";
  modal.dataset.billingTab = next;
  modal.querySelectorAll("[data-ai-billing-tab]").forEach((btn) => {
    const on = btn.getAttribute("data-ai-billing-tab") === next;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  modal.querySelectorAll("[data-ai-billing-pane]").forEach((pane) => {
    const on = pane.getAttribute("data-ai-billing-pane") === next;
    pane.classList.toggle("hidden", !on);
    pane.hidden = !on;
  });
  if (costs === true || costs === false) applyAiBillingCostsOpen(costs);
  return next;
}

export function applyAiBillingCostsOpen(open) {
  const modal = document.getElementById("ai-key-modal");
  const card = modal?.querySelector(".ai-billing-card") || modal?.querySelector(".ai-keys-card");
  const panel = document.getElementById("ai-billing-costs-panel");
  const btn = document.getElementById("btn-ai-billing-costs");
  const on = !!open;
  card?.classList.toggle("is-costs-open", on);
  modal?.classList.toggle("ai-billing-costs-open", on);
  if (panel) {
    panel.classList.toggle("hidden", !on);
    panel.hidden = !on;
  }
  btn?.setAttribute("aria-expanded", on ? "true" : "false");
  btn?.classList.toggle("is-active", on);
  return on;
}

export function isAiBillingCostsOpen() {
  return !!document.getElementById("ai-key-modal")?.classList.contains("ai-billing-costs-open");
}

function invitePayloadFor(person, raw = "") {
  const handle = personHandle(person);
  const email = personEmail(person);
  const typed = String(raw || "").trim();
  if (handle) return { handle };
  if (email) return { email };
  if (typed.includes("@") && !typed.startsWith("@") && typed.includes(".")) return { email: typed.toLowerCase() };
  if (typed) return { handle: typed.replace(/^@+/, "") };
  return null;
}

function openPopup(url, name) {
  const href = String(url || "").trim();
  if (!href) return;
  const width = 520;
  const height = 740;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const features = `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener`;
  window.open(href, name || "render3d-ai-sub", features);
}

function providerIcon(id) {
  if (id === "cloud") {
    return `<span class="ai-sub-icon ai-sub-icon--cloud" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6.5 19a4.5 4.5 0 01-.4-8.98A6 6 0 0117.7 8.2 4.5 4.5 0 0117.5 19h-11z"/></svg></span>`;
  }
  if (id === "cursor") {
    return `<span class="ai-sub-icon ai-sub-icon--cursor" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 3.6 20.4 12 4 20.4V3.6Zm3.2 5.1v6.6L14.2 12 7.2 8.7Z"/></svg></span>`;
  }
  if (id === "claude") {
    return `<span class="ai-sub-icon ai-sub-icon--claude" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17.6 3.2 13.1 21h-2.5L6.4 3.2h2.7l2.8 11.4L14.9 3.2h2.7ZM4.8 8.4 3 12.2l1.8 3.8h2.2L5.3 12.2 7 8.4H4.8Zm12.2 0L15.3 12.2l1.7 3.8h2.2l-1.7-3.8 1.8-3.8H17Z"/></svg></span>`;
  }
  return `<span class="ai-sub-icon ai-sub-icon--openai" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M21.6 10.1a5.3 5.3 0 00-4.5-7.5 5.3 5.3 0 00-4.1 1.9A5.3 5.3 0 005.4 6a5.3 5.3 0 00-3 7.9 5.3 5.3 0 004.5 7.5 5.3 5.3 0 004.1-1.9 5.3 5.3 0 007.6-1.5 5.3 5.3 0 003-7.9ZM8.6 18.5a3.1 3.1 0 01-2.5-1.5 3.1 3.1 0 01.3-3.4l.1-.1 2.2 1.3a.4.4 0 01.2.3v2.6l-.1.1a3 3 0 01-2.2.7Zm-.9-6.6-.1.1-2.2-1.2v-.1A3.1 3.1 0 017.9 6a3 3 0 011.8.6l.1.1 2.2 1.3-.1.1-2.3 1.3-2 .1Zm8.9 4.4-.1.1-2.2-1.3v-2.5l.1-.1 2.2-1.3.1-.1 2.2 1.3v.1a3.1 3.1 0 01-2.3 3.8Zm2.3-4.4-.1-.1-2.2-1.3-2.2 1.3v.1l-2.2-1.3.1-.1 2.2-1.3A3.1 3.1 0 0117.6 6a3.1 3.1 0 012.5 1.5 3.1 3.1 0 01-.3 3.4Zm-7.6.7-.1-.1v-2.5l2.2-1.3.1-.1 2.2 1.3v2.6l-.1.1-2.2 1.3-2.1-1.3Zm-.9.7 2.2 1.3-2.2 1.3-2.2-1.3 2.2-1.3Z"/></svg></span>`;
}

const DEFAULT_PROVIDERS = [
  {
    id: "cloud",
    label: "Cloud",
    subtitle: "Render Studio credits",
    login_url: "",
    manage_urls: [],
    key_provider: null,
    sign_in_label: "Use studio credits",
    blurb: "Run CAD and Render on Render Studio cloud credits — the shared platform key, billed from this account. Buy credits under AI & billing if the balance is empty.",
  },
  {
    id: "openai",
    label: "ChatGPT subscription",
    subtitle: "Codex via ChatGPT Plus / Pro",
    login_url: "https://auth.openai.com/codex/device",
    manage_urls: [],
    key_provider: "openai",
    sign_in_label: "Sign in with ChatGPT",
    device_code_label: "Use device code",
    blurb: "Same ChatGPT Plus/Pro subscription VibeCAD uses. Desktop VibeCAD can do a local browser OAuth; this web app uses Codex device-auth instead. Enter the code shown here on auth.openai.com/codex/device. After sign-in, CAD 2.0, Architect, VibeCAD, Mesh (img2threejs), Wiring, and Rigging run Codex on that plan with GPT-5.6 Sol, Terra, Luna, Astra, or Astra Pro — no API key. Render still needs a key or studio credits.",
  },
  {
    id: "claude",
    label: "Claude",
    subtitle: "Anthropic subscription",
    login_url: "",
    manage_urls: [],
    key_provider: "anthropic",
    sign_in_label: "Sign in with Claude",
    blurb: "This runs the official Claude Code CLI with your subscription token. Anthropic recommends an API key for a standard third-party integration; API keys remain available on the AI Keys tab.",
  },
];

function connectableProviders(list) {
  return (Array.isArray(list) ? list : []).filter((row) => row?.id === "cloud" || row?.id === "openai" || row?.id === "claude");
}

function mergeListing(next = {}, previous = {}) {
  const incoming = connectableProviders(next.providers);
  const byId = Object.fromEntries(incoming.map((row) => [row.id, row]));
  const providers = DEFAULT_PROVIDERS.map((base) => ({
    ...base,
    connected: false,
    account_email: "",
    plan_label: "",
    has_api_key: false,
    auth_status: "not_signed_in",
    chatgpt: base.id === "openai" ? (next.chatgpt || previous.chatgpt || {}) : null,
    cursor: null,
    claude: null,
    credits: base.id === "cloud" ? (next.credits || previous.credits || byId.cloud?.credits || {}) : null,
    ...(byId[base.id] || {}),
  }));
  return {
    ...previous,
    ...next,
    providers,
    connected_count: Number(next.connected_count || providers.filter((p) => p.cad_ready || p.connected || p.has_api_key).length),
    chatgpt: next.chatgpt || previous.chatgpt || {},
    cursor: next.cursor || previous.cursor || {},
    claude: next.claude || previous.claude || {},
    credits: next.credits || previous.credits || {},
    chatgpt_shares: {
      ...(previous.chatgpt_shares || { owned: [], received: [] }),
      ...(next.chatgpt_shares || {}),
      personal_people: next.chatgpt_shares?.personal_people
        || next.personal_people
        || previous.chatgpt_shares?.personal_people
        || previous.personal_people
        || [],
      personal_received: next.chatgpt_shares?.personal_received
        || next.personal_received
        || previous.chatgpt_shares?.personal_received
        || previous.personal_received
        || [],
    },
    personal_people: next.personal_people
      || next.chatgpt_shares?.personal_people
      || previous.personal_people
      || previous.chatgpt_shares?.personal_people
      || [],
    cursor_shares: next.cursor_shares || previous.cursor_shares || { owned: [], received: [] },
    claude_shares: next.claude_shares || previous.claude_shares || { owned: [], received: [] },
    usage: next.usage || previous.usage || null,
    loadError: next.loadError || "",
  };
}

function cliProviderId(provider) {
  if (provider?.id === "openai") return "openai";
  if (provider?.id === "cursor") return "cursor";
  if (provider?.id === "claude") return "claude";
  return "";
}

function cliState(provider, listing) {
  const id = cliProviderId(provider);
  if (id === "openai") return listing?.chatgpt || provider?.chatgpt || {};
  if (id === "cursor") return listing?.cursor || provider?.cursor || {};
  if (id === "claude") return listing?.claude || provider?.claude || {};
  return {};
}

function subscriptionAuthStatus(provider, listing) {
  const cli = cliState(provider, listing);
  if (cli.status) return String(cli.status);
  if (typeof cli.signed_in === "boolean") return cli.signed_in ? "signed_in" : "not_signed_in";
  return String(provider?.auth_status || "not_signed_in");
}

function subscriptionLoginPending(provider, listing) {
  const status = subscriptionAuthStatus(provider, listing);
  return status === "starting" || status === "awaiting_browser";
}

function hasPendingSubscriptionLogin(listing) {
  return ["openai", "claude", "cursor"].some((id) => {
    const provider = (listing.providers || []).find((row) => row.id === id) || { id };
    return subscriptionLoginPending(provider, listing);
  });
}

function chatgptState(provider, listing) {
  return cliState(provider?.id === "openai" ? provider : { id: "openai" }, listing);
}

function authLabel(provider, listing) {
  if (provider.id === "cloud") {
    const credits = provider.credits || listing?.credits || {};
    const balance = Number(credits.balance_cents || provider.balance_cents || 0);
    const usd = `$${(Number.isFinite(balance) ? balance / 100 : 0).toFixed(2)}`;
    if (provider.connected || (credits.use_platform_key && balance > 0) || provider.auth_status === "signed_in") {
      return { pill: "signed_in", pillLabel: "On", text: `Studio credits on · ${usd}` };
    }
    if (balance > 0 || provider.auth_status === "verified") {
      return { pill: "verified", pillLabel: "Ready", text: `Credits available · ${usd}` };
    }
    return { pill: "idle", pillLabel: "Off", text: "No studio credits" };
  }
  const cli = cliState(provider, listing);
  const status = subscriptionAuthStatus(provider, listing);
  const name = provider.id === "openai" ? "ChatGPT" : provider.label || "account";
  if (status === "signed_in" && (provider.account_email || cli.account_email)) {
    const email = provider.account_email || cli.account_email;
    const plan = provider.plan_label ? ` · ${provider.plan_label}` : "";
    return { pill: "signed_in", text: `Signed in as ${email}${plan}` };
  }
  if (status === "signed_in") return { pill: "signed_in", text: `Signed in with ${name}` };
  const shared = sharedSubscriptionAccess(provider, listing);
  if (shared.available && !["starting", "awaiting_browser"].includes(status)) {
    return { pill: "verified", pillLabel: "Shared", text: `${name} access shared by ${shared.ownerNames.join(", ")}. Your own account is not signed in.` };
  }
  const pendingShare = pendingSubscriptionShares(listing).find((share) => share.id === provider.id);
  if (pendingShare && !["starting", "awaiting_browser"].includes(status)) {
    return { pill: "idle", pillLabel: "Owner sign-in needed", text: `${pendingShare.ownerNames.join(", ")} shared ${pendingShare.label} with you. They need to reconnect before you can use it.` };
  }
  if (provider.id === "claude" && ["starting", "awaiting_browser"].includes(status)) {
    return {
      pill: "signing_in",
      text: "Create a Claude Code subscription token on your computer, then paste it below.",
    };
  }
  if (status === "awaiting_browser") {
    if (provider.id === "cursor") return { pill: "signing_in", text: "Signing in — finish Cursor in the browser" };
    return { pill: "signing_in", text: "Signing in — enter the device code" };
  }
  if (status === "starting") return { pill: "signing_in", text: `Starting ${name} sign-in…` };
  if (status === "error") return { pill: "error", text: cli.error || provider.auth_error || "Sign-in failed" };
  if (status === "verified" || provider.has_api_key) {
    const model = provider.api_key_model ? ` · ${provider.api_key_model}` : "";
    return { pill: "verified", text: `API key saved${model}` };
  }
  if (cliProviderId(provider)) return { pill: "idle", text: "Not signed in" };
  if (provider.connected && provider.account_email) {
    const plan = provider.plan_label ? ` · ${provider.plan_label}` : "";
    return { pill: "signed_in", text: `Signed in as ${provider.account_email}${plan}` };
  }
  if (provider.connected) return { pill: "signed_in", text: "Account linked" };
  return { pill: "idle", text: "Not signed in" };
}

function pillMarkup(auth) {
  const labels = {
    signed_in: auth.pillLabel || "Signed in",
    signing_in: "Signing in",
    verified: auth.pillLabel || "Verified",
    error: "Error",
    idle: auth.pillLabel || "Not signed in",
  };
  return `<span class="ai-sub-pill ai-sub-pill--${esc(auth.pill)}">${esc(labels[auth.pill] || "Not signed in")}</span>`;
}

function deviceCodeBox(provider, listing) {
  const cli = cliState(provider, listing);
  const status = subscriptionAuthStatus(provider, listing);
  const code = String(cli.device_code || "").trim();
  const url = String(provider.id === "claude" ? (cli.login_url || "") : (provider.login_url || cli.login_url || ""));
  const signing = status === "starting" || status === "awaiting_browser";
  if (provider.id === "openai") {
    if (!code && !signing) return "";
    return `
    <div class="ai-sub-device">
      <div class="ai-sub-device-copy">
        <span class="muted small">OpenAI will ask for the code “displayed in your terminal.” Paste this one — it lives in Render Studio, not Terminal.app:</span>
        <code class="ai-sub-device-code">${esc(code || "…")}</code>
      </div>
      <div class="ai-sub-device-actions">
        ${code ? `<button type="button" class="btn secondary" data-ai-sub-copy-code="${esc(code)}">Copy code</button>` : ""}
        <button type="button" class="btn secondary" data-url="${esc(url || "https://auth.openai.com/codex/device")}" data-ai-sub-manage="openai">Open ChatGPT</button>
      </div>
    </div>`;
  }
  if (!signing && provider.id !== "claude") return "";
  if (provider.id === "cursor") {
    return `
    <div class="ai-sub-device">
      <div class="ai-sub-device-copy">
        <span class="muted small">Finish Cursor login in the popup. This window waits, then shows Signed in — the same as ChatGPT after you enter the Codex code.</span>
      </div>
      <div class="ai-sub-device-actions">
        ${url ? `<button type="button" class="btn secondary" data-url="${esc(url)}" data-ai-sub-manage="cursor">Open Cursor login</button>` : ""}
      </div>
    </div>`;
  }
  return `
    <div class="ai-sub-claude-connect-backdrop" data-ai-sub-claude-dialog>
      <section class="ai-sub-claude-connect-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-sub-claude-connect-title">
        <button type="button" class="ai-sub-claude-connect-close" data-ai-sub-claude-close aria-label="Close Claude connection">×</button>
        <div class="ai-sub-device-copy">
          <h3 id="ai-sub-claude-connect-title">Connect Claude Pro or Max</h3>
          <p class="muted small">Anthropic completes subscription sign-in through Claude Code. Render never receives your Claude password.</p>
          <ol class="ai-sub-claude-connect-steps">
            <li>Open Claude Code on this computer and sign in with your Claude Pro or Max account.</li>
            <li>Run <code>claude setup-token</code>, then paste the generated token below.</li>
          </ol>
          <p class="muted small" id="ai-sub-claude-code-help">Render stores the token encrypted and sends it only to your isolated Claude Code process.</p>
        <form class="ai-sub-save" data-ai-sub-claude-code style="grid-template-columns: minmax(0, 1fr)">
          <label for="ai-sub-claude-code">Claude subscription token</label>
          <input id="ai-sub-claude-code" type="password" name="code" placeholder="sk-ant-oat…" autocomplete="off" spellcheck="false" aria-describedby="ai-sub-claude-code-help" required />
          <button type="submit" class="btn accent" data-ai-sub-claude-connect>Connect Claude</button>
          <span class="muted small" data-ai-sub-claude-code-status role="status"></span>
        </form>
        </div>
      </section>
    </div>`;
}

function chipBtn(attrs, icon, label, extraClass = "") {
  return `<button type="button" class="ai-chip-btn ${extraClass}" ${attrs}>${icon}${esc(label)}</button>`;
}

function connectButtons(provider, listing, { claudeSetupOpen = false } = {}) {
  const cli = cliState(provider, listing);
  const auth = authLabel(provider, listing);
  const signedIn = auth.pill === "signed_in";
  if (provider.id === "cloud") {
    const credits = provider.credits || listing?.credits || {};
    const balance = Number(credits.balance_cents || provider.balance_cents || 0);
    const using = signedIn;
    return `
      ${using ? "" : (balance > 0
        ? chipBtn('data-ai-sub-cloud-enable', providerIcon("cloud"), "Use studio credits", "ai-chip-btn--accent")
        : chipBtn('data-ai-sub-cloud-buy', providerIcon("cloud"), "Buy studio credits", "ai-chip-btn--accent"))}
      ${chipBtn('data-ai-billing-tab="keys"', providerIcon("cloud"), "Manage credits")}
      ${balance <= 0 ? `<p class="muted small">Load Render Studio credits on the AI Keys tab, then enable Cloud here.</p>` : ""}
    `;
  }
  if (provider.id === "openai") {
    if (signedIn) return "";
    return `
      ${chipBtn("data-ai-sub-chatgpt-signin", providerIcon("openai"), "Sign in with ChatGPT", "ai-chip-btn--accent")}
      ${chipBtn("data-ai-sub-chatgpt-device", providerIcon("openai"), "Use device code")}
      ${cli.available === false ? `<p class="muted small">ChatGPT subscription sign-in needs Codex CLI on the Render Studio host.</p>` : ""}
    `;
  }
  if (provider.id === "cursor") {
    if (signedIn) return "";
    return `
      ${chipBtn("data-ai-sub-cursor-signin", providerIcon("cursor"), "Sign in with Cursor", "ai-chip-btn--accent")}
    `;
  }
  if (provider.id === "claude") {
    if ((signedIn && auth.pill === "signed_in") || claudeSetupOpen) return "";
    return `
      ${chipBtn("data-ai-sub-claude-signin", providerIcon("claude"), "Connect Claude subscription", "ai-chip-btn--accent")}
      ${cli.available === false || provider.cli_available === false ? `<p class="muted small">Claude Code CLI is not on this host yet.</p>` : ""}
    `;
  }
  return `
    ${chipBtn(`data-ai-sub-login="${esc(provider.id)}"`, providerIcon(provider.id), provider.sign_in_label || `Sign in with ${provider.label}`, "ai-chip-btn--accent")}
  `;
}

function formatUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(n >= 10 ? 2 : 2)}`;
}

function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(v);
}

function dailyLimitControl(m, attrs) {
  if (m.is_owner) return "";
  const val = m.daily_limit_usd == null ? "" : m.daily_limit_usd;
  return `
    <label class="ai-sub-daily-limit" title="Daily CAD spend cap we track for this person (dollars, same meter as connected-app usage today)">
      <span>$/day</span>
      <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="None" value="${esc(val)}" ${attrs} />
    </label>
  `;
}

function memberRowMarkup(m, selectedShare, providerId = "openai", label = "ChatGPT") {
  const granted = !!(m.granted || m.is_owner);
  const uid = esc(personId(m));
  const grantControl = selectedShare
    ? `<label class="ai-sub-grant" title="${m.is_owner ? "Owner" : granted ? `${label} shared` : `No ${label} access`}">
        <input type="checkbox" data-ai-sub-grant="${esc(selectedShare.team_id)}" data-provider="${esc(providerId)}" data-share-id="${esc(selectedShare.id)}" data-user-id="${uid}" ${granted ? "checked" : ""} ${m.is_owner ? "disabled" : ""} />
        <span class="ai-sub-grant-label">${m.is_owner ? "You" : label}</span>
      </label>`
    : "";
  const limitControl = selectedShare && !m.is_owner
    ? dailyLimitControl(m, `data-ai-sub-daily-limit="workspace" data-ai-sub-grant="${esc(selectedShare.team_id)}" data-provider="${esc(providerId)}" data-share-id="${esc(selectedShare.id)}" data-user-id="${uid}"`)
    : "";
  const you = m.is_owner ? `<em>you</em>` : "";
  const sub = personSubtitle(m);
  return `
    <div class="ai-sub-person-row" data-ai-sub-person="${uid}" data-on-plan="${granted ? "1" : "0"}" data-email="${esc(personEmail(m))}" data-handle="${esc(personHandle(m))}">
      <button type="button" class="ai-sub-person-main" data-ai-sub-person="${uid}" data-email="${esc(personEmail(m))}" data-handle="${esc(personHandle(m))}">
        ${avatarHtml(m)}
        <span class="ai-sub-person-copy">
          <strong>${esc(personName(m))}${you}</strong>
          ${sub ? `<small>${esc(sub)}</small>` : ""}
        </span>
      </button>
      <span class="ai-sub-person-controls">
        ${limitControl}
        ${grantControl}
      </span>
    </div>
  `;
}

function personalMemberRowMarkup(m, providerId = "openai") {
  const label = providerLabel(providerId);
  const granted = m.granted !== false;
  const uid = esc(personId(m));
  const sub = personSubtitle(m);
  return `
    <div class="ai-sub-person-row" data-ai-sub-personal-row="${uid}" data-ai-sub-person="${uid}" data-on-plan="${granted ? "1" : "0"}" data-email="${esc(personEmail(m))}" data-handle="${esc(personHandle(m))}">
      <button type="button" class="ai-sub-person-main" data-ai-sub-person="${uid}" data-email="${esc(personEmail(m))}" data-handle="${esc(personHandle(m))}" data-personal="1">
        ${avatarHtml(m)}
        <span class="ai-sub-person-copy">
          <strong>${esc(personName(m))}</strong>
          ${sub ? `<small>${esc(sub)}</small>` : ""}
        </span>
      </button>
      <span class="ai-sub-person-controls">
        ${dailyLimitControl(m, `data-ai-sub-daily-limit="personal" data-user-id="${uid}"`)}
        <label class="ai-sub-grant" title="${esc(granted ? `${label} shared` : `No ${label} access`)}">
          <input type="checkbox" data-ai-sub-personal-grant="${uid}" ${granted ? "checked" : ""} />
          <span class="ai-sub-grant-label">${esc(label)}</span>
        </label>
        <button type="button" class="ai-sub-text-btn" data-ai-sub-remove-personal="${uid}" data-name="${esc(personName(m))}">Remove</button>
      </span>
    </div>
  `;
}

function rosterBox(rowsHtml, emptyHtml, { cap = PEOPLE_LIST_CAP, searchId = "", searchValue = "", searchAttr = "", placeholder = "Search people…", extraToolbar = "", showSearch = true } = {}) {
  return `
    <div class="ai-sub-roster" data-ai-sub-roster-cap="${cap}">
      ${showSearch || extraToolbar ? `
      <div class="ai-sub-roster-toolbar">
        ${showSearch ? `
        <label class="ai-sub-roster-search">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
          <input ${searchId ? `id="${esc(searchId)}"` : ""} type="search" placeholder="${esc(placeholder)}" ${searchAttr} value="${esc(searchValue)}" spellcheck="false" autocomplete="off" />
        </label>` : ""}
        ${extraToolbar}
      </div>` : ""}
      <div class="ai-sub-roster-list" style="--ai-sub-roster-cap:${cap}">
        ${rowsHtml || emptyHtml}
      </div>
    </div>
  `;
}

function peopleTabsMarkup(active = "people", planUsersFirst = false, planCount = 0) {
  const tabs = [
    { id: "plan", label: "On your plan" },
    { id: "people", label: "People" },
    { id: "workspace", label: "Workspace people" },
  ];
  const pressed = active === "plan" || planUsersFirst;
  return `
    <div class="ai-sub-people-tabs-row">
      <nav class="ai-sub-people-tabs" data-ai-sub-people-tabs role="tablist" aria-label="Subscription people">
        ${tabs.map((t) => `
          <button type="button" class="ai-sub-people-tab${t.id === active ? " is-active" : ""}" data-ai-sub-people-tab="${esc(t.id)}" role="tab" aria-selected="${t.id === active ? "true" : "false"}">
            ${esc(t.label)}${t.id === "plan" && planCount ? `<em class="ai-sub-people-tab-count">${planCount}</em>` : ""}
          </button>
        `).join("")}
      </nav>
      <button type="button" class="ai-sub-plan-sort${pressed ? " is-on" : ""}" data-ai-sub-plan-sort aria-pressed="${pressed ? "true" : "false"}" title="Show people on your plan first" aria-label="Show people on your plan first">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 12.5V3.5m0 0 3.2 3.2M8 3.5 4.8 6.7"/></svg>
      </button>
    </div>
  `;
}

function planMemberRowMarkup(m, label = "ChatGPT") {
  const uid = esc(personId(m));
  const sources = (m.plan_sources || []).filter(Boolean);
  const subParts = [personSubtitle(m), sources.join(" · ")].filter(Boolean);
  const personal = (m.plan_kind === "personal" || sources.includes("Personal")) && !m.is_owner;
  const shareId = m.share_id || "";
  const teamId = m.team_id || "";
  const pid = m.provider || "openai";
  const granted = m.granted !== false;
  const grantControl = personal
    ? `<label class="ai-sub-grant" title="${granted ? `${label} shared` : `No ${label} access`}">
        <input type="checkbox" data-ai-sub-personal-grant="${uid}" ${granted ? "checked" : ""} />
        <span class="ai-sub-grant-label">${esc(label)}</span>
      </label>`
    : (shareId && teamId
      ? `<label class="ai-sub-grant" title="${m.is_owner ? "Owner" : granted ? `${label} shared` : `No ${label} access`}">
          <input type="checkbox" data-ai-sub-grant="${esc(teamId)}" data-provider="${esc(pid)}" data-share-id="${esc(shareId)}" data-user-id="${uid}" ${granted ? "checked" : ""} ${m.is_owner ? "disabled" : ""} />
          <span class="ai-sub-grant-label">${m.is_owner ? "You" : esc(label)}</span>
        </label>`
      : "");
  const limitControl = m.is_owner
    ? ""
    : personal
      ? dailyLimitControl(m, `data-ai-sub-daily-limit="personal" data-user-id="${uid}"`)
      : (shareId && teamId
        ? dailyLimitControl(m, `data-ai-sub-daily-limit="workspace" data-ai-sub-grant="${esc(teamId)}" data-provider="${esc(pid)}" data-share-id="${esc(shareId)}" data-user-id="${uid}"`)
        : "");
  const you = m.is_owner ? `<em>you</em>` : "";
  return `
    <div class="ai-sub-person-row" data-ai-sub-plan-row="${uid}" data-ai-sub-person="${uid}" data-on-plan="1" data-email="${esc(personEmail(m))}" data-handle="${esc(personHandle(m))}">
      <button type="button" class="ai-sub-person-main" data-ai-sub-person="${uid}" data-email="${esc(personEmail(m))}" data-handle="${esc(personHandle(m))}" ${personal ? `data-personal="1"` : ""}>
        ${avatarHtml(m)}
        <span class="ai-sub-person-copy">
          <strong>${esc(personName(m))}${you}</strong>
          ${subParts.length ? `<small>${esc(subParts.join(" · "))}</small>` : ""}
        </span>
      </button>
      <span class="ai-sub-person-controls">
        ${limitControl}
        ${grantControl}
      </span>
    </div>
  `;
}

function personalPeopleMarkup(listing, peopleSearch = "", planUsersFirst = false, providerId = "openai") {
  const label = providerLabel(providerId);
  const people = personalPeople(listing, providerId);
  const filtered = sortPlanUsersFirst(filterPeopleByQuery(people, peopleSearch), planUsersFirst, { personal: true });
  const received = listing?.[providerShareKey(providerId)]?.personal_received || (providerId === "openai" ? listing?.personal_received : []) || [];
  const rows = filtered.map((m) => personalMemberRowMarkup(m, providerId)).join("");
  const empty = people.length && String(peopleSearch || "").trim()
    ? `<p class="muted small">No one matches “${esc(peopleSearch)}”.</p>`
    : `<p class="muted small">Search a name or @handle to add someone without adding them to a workspace.</p>`;
  const receivedHtml = received.map((share) => `
    <p class="muted small ai-sub-share-received">Using <strong>${esc(share.owner_name || "someone")}</strong>’s ${esc(label)} (personal share${share.owner_signed_in ? "" : ", they’re signed out"}).</p>
  `).join("");
  return `
    <section class="ai-sub-share ai-sub-share--personal" data-ai-sub-people-personal>
      <header class="ai-sub-share-head">
        <h3 class="ai-sub-share-title">People</h3>
        <button type="button" class="ai-chip-btn" data-ai-billing-analytics="subscriptions">${esc("View analytics")}</button>
      </header>
      <p class="muted small">Search an existing user or @handle — live match, then add them to this ${esc(label)} login.</p>
      <div class="ai-sub-add">
        <div class="ai-sub-add-row">
          <div class="ai-sub-add-field" data-ai-sub-personal-field>
            <input id="ai-sub-people-search" type="search" placeholder="Search name, @handle, or email" data-ai-sub-people-search value="${esc(peopleSearch)}" spellcheck="false" autocomplete="off" />
            <div class="ai-sub-suggest hidden" data-ai-sub-personal-suggest role="listbox" aria-label="People suggestions"></div>
          </div>
          <button type="button" class="ai-chip-btn ai-chip-btn--accent" data-ai-sub-add-personal-btn>Add</button>
        </div>
      </div>
      <div class="ai-sub-peek hidden" data-ai-sub-personal-peek hidden></div>
      ${rosterBox(rows, empty, { cap: PEOPLE_LIST_CAP, showSearch: false })}
      ${receivedHtml}
    </section>
  `;
}

function personalPeople(listing, providerId = "openai") {
  return listing?.[providerShareKey(providerId)]?.personal_people
    || (providerId === "openai" ? listing?.personal_people : []) || [];
}

function personalPeopleApi(providerId) {
  return providerId === "claude" ? "/api/ai-subscriptions/claude/people" : "/api/ai-subscriptions/people";
}

function providerShareKey(providerId) {
  if (providerId === "cursor") return "cursor_shares";
  if (providerId === "claude") return "claude_shares";
  return "chatgpt_shares";
}

function providerLabel(providerId) {
  if (providerId === "cursor") return "Cursor";
  if (providerId === "claude") return "Claude";
  return "ChatGPT";
}

function shareApiBase(providerId, teamId) {
  const tid = encodeURIComponent(teamId);
  if (providerId === "openai") return `/api/teams/${tid}/chatgpt`;
  return `/api/teams/${tid}/subscriptions/${encodeURIComponent(providerId)}`;
}

function chatgptShareMarkup(provider, listing, teams, shareMembers, workspaceMgmt, selectedTeamId, creatingWorkspace, peopleSearch = "", workspaceSearch = "", peopleScope = "workspace", peopleTab = "people", planUsersFirst = false, planSearch = "") {
  const pid = cliProviderId(provider);
  if (!pid) return "";
  const label = providerLabel(pid);
  const signedIn = subscriptionAuthStatus(provider, listing) === "signed_in";
  const shares = listing?.[providerShareKey(pid)] || { owned: [], received: [] };
  const owned = shares.owned || [];
  const received = shares.received || [];
  const selectedId = selectedTeamId || owned[0]?.team_id || (teams || [])[0]?.id || "";
  const selectedShare = owned.find((s) => s.team_id === selectedId) || null;
  const teamOpts = (teams || []).map((t) => (
    `<option value="${esc(t.id)}"${t.id === selectedId ? " selected" : ""}>${esc(t.name || "Workspace")}</option>`
  )).join("");
  const grantMembers = selectedShare ? (shareMembers?.[selectedShare.id] || []) : [];
  const mgmt = workspaceMgmt || { members: [], candidates: [], invites: [] };
  const roster = mergePeople(
    (mgmt.members || []).map((m) => ({ ...m, already_member: true })),
    grantMembers.map((m) => ({ ...m, already_member: true })),
  );
  const scoped = peopleScope === "team"
    ? roster
    : peopleScope === "workspace"
      ? roster
      : roster;
  const pinPlan = peopleTab === "plan" || planUsersFirst;
  const filteredRoster = sortPlanUsersFirst(filterPeopleByQuery(scoped, workspaceSearch), pinPlan).map((m) => {
    const grant = grantMembers.find((g) => personId(g) === personId(m));
    return { ...m, ...(grant || {}) };
  });
  const memberRows = filteredRoster.length
    ? filteredRoster.map((m) => memberRowMarkup(m, selectedShare, pid, label)).join("")
    : "";
  const inviteRows = (mgmt.invites || []).slice(0, 6).map((inv) => `
    <div class="ai-sub-person-row ai-sub-person-row--pending">
      <span class="ai-sub-person-main">
        ${avatarHtml({ display_name: inv.display_name || inv.email, email: inv.email, id: inv.user_id })}
        <span class="ai-sub-person-copy">
          <strong>${esc(inv.display_name || inv.email || "Pending")}</strong>
          <small>Invite pending</small>
        </span>
      </span>
    </div>
  `).join("");
  const receivedHtml = received.map((share) => `
    <p class="muted small ai-sub-share-received">Using <strong>${esc(share.owner_name || "a teammate")}</strong>’s ${esc(label)} on ${esc(share.team_name || "a workspace")}${share.owner_signed_in ? "" : " (they’re signed out)"}.</p>
  `).join("");
  const shareStatus = selectedShare
    ? (selectedShare.owner_signed_in ? `${label} on` : "Owner signed out")
    : (signedIn ? `Not sharing ${label}` : `Sign in to share ${label}`);
  const filterToolbar = `
    <label class="ai-sub-roster-filter">
      <span>Scope</span>
      <select data-ai-sub-people-scope aria-label="Filter by team or workspace">
        <option value="workspace"${peopleScope === "workspace" ? " selected" : ""}>Workspace</option>
        <option value="team"${peopleScope === "team" ? " selected" : ""}>Team</option>
      </select>
    </label>
    <select data-ai-sub-chatgpt-team aria-label="Workspace">
      <option value="">Choose a workspace…</option>
      ${teamOpts}
    </select>
    <button type="button" class="ai-chip-btn" data-ai-sub-toggle-create>${creatingWorkspace ? "Cancel" : "New"}</button>
  `;
  const planUsers = collectSubscriptionUsers(listing, shareMembers, pid);
  const planFiltered = sortPlanUsersFirst(filterPeopleByQuery(planUsers, planSearch), true);
  const planRows = planFiltered.map((m) => planMemberRowMarkup(m, label)).join("");
  const planEmpty = planUsers.length && String(planSearch || "").trim()
    ? `<p class="muted small">No one matches “${esc(planSearch)}”.</p>`
    : `<p class="muted small">Nobody else is using this ${esc(label)} login yet. Add them under People or share with a workspace.</p>`;
  const tab = PEOPLE_LIST_TABS.includes(peopleTab) ? peopleTab : "people";
  const workspaceSection = `
    <section class="ai-sub-share ai-sub-share--workspace" data-ai-sub-people-workspace>
      <header class="ai-sub-share-head">
        <h3 class="ai-sub-share-title">Workspace people</h3>
        <span class="ai-sub-share-status">${esc(shareStatus)}</span>
      </header>
      ${creatingWorkspace ? `
        <div class="ai-sub-share-create">
          <input type="text" placeholder="Workspace name" data-ai-sub-new-workspace maxlength="120" />
          <button type="button" class="ai-chip-btn ai-chip-btn--accent" data-ai-sub-create-workspace>Create</button>
        </div>
      ` : ""}
      ${signedIn && selectedId && !selectedShare ? `
        <button type="button" class="ai-chip-btn" data-ai-sub-share="${esc(pid)}">Share this ${esc(label)} login</button>
      ` : ""}
      ${!signedIn ? `
        <p class="muted small">Hudson and other granted people can see this share, but cannot use it until the owner reconnects ${esc(label)}.</p>
        <button type="button" class="ai-chip-btn ai-chip-btn--accent" data-ai-sub-reconnect="${esc(pid)}">Reconnect ${esc(label)} to activate sharing</button>
      ` : ""}
      <div class="ai-sub-peek hidden" data-ai-sub-peek hidden></div>
      ${selectedId ? `
        <div class="ai-sub-add-field ai-sub-roster-add" data-ai-sub-add-field>
          ${rosterBox(
            memberRows || inviteRows,
            `<p class="muted small">No one else here yet. Search a name or @handle to add someone.</p>`,
            {
              cap: PEOPLE_LIST_CAP,
              searchId: "ai-sub-add-person",
              searchValue: workspaceSearch,
              searchAttr: `data-ai-sub-add-person data-ai-sub-ws-search`,
              placeholder: "Search existing user or @handle",
              extraToolbar: `${filterToolbar}<button type="button" class="ai-chip-btn ai-chip-btn--accent" data-ai-sub-add-person-btn>Add</button>`,
            },
          )}
          <div class="ai-sub-suggest hidden" data-ai-sub-suggest role="listbox" aria-label="People suggestions"></div>
        </div>
      ` : ""}
      ${selectedShare ? `
        <div class="ai-sub-people-actions">
          <button type="button" class="ai-chip-btn" data-ai-sub-members="${esc(selectedShare.team_id)}" data-provider="${esc(pid)}" data-share-id="${esc(selectedShare.id)}">Refresh</button>
          <button type="button" class="ai-chip-btn" data-ai-sub-unshare="${esc(selectedShare.team_id)}" data-provider="${esc(pid)}" data-share-id="${esc(selectedShare.id)}">Stop sharing</button>
        </div>
      ` : ""}
      ${receivedHtml}
    </section>
  `;
  const planSection = `
    <section class="ai-sub-share ai-sub-share--plan" data-ai-sub-people-plan>
      <header class="ai-sub-share-head">
        <h3 class="ai-sub-share-title">CAD access</h3>
        <span class="ai-sub-people-actions">
          <button type="button" class="ai-chip-btn ai-chip-btn--accent" data-ai-sub-open-people>Search new email</button>
          <button type="button" class="ai-chip-btn" data-ai-sub-key="${pid === "claude" ? "anthropic" : "openai"}">Add or share AI key</button>
          <button type="button" class="ai-chip-btn" data-ai-billing-analytics="subscriptions">${esc("View analytics")}</button>
        </span>
      </header>
      <p class="muted small">Everyone granted your ${esc(label)} subscription for CAD. A subscription share works only while its owner is signed in.</p>
      <div class="ai-sub-peek hidden" data-ai-sub-plan-peek hidden></div>
      ${rosterBox(
        planRows,
        planEmpty,
        {
          cap: PEOPLE_LIST_CAP,
          searchId: "ai-sub-plan-search",
          searchValue: planSearch,
          searchAttr: "data-ai-sub-plan-search",
          placeholder: "Search people on your plan",
        },
      )}
    </section>
  `;
  return `
    <div class="ai-sub-people-switch" data-ai-sub-people-switch>
      ${peopleTabsMarkup(tab, planUsersFirst, planUsers.length)}
      ${tab === "people" ? personalPeopleMarkup(listing, peopleSearch, pinPlan, pid) : ""}
      ${tab === "plan" ? planSection : ""}
      ${tab === "workspace" ? workspaceSection : ""}
    </div>
  `;
}

function vrPermissionsMarkup(provider, listing, shareMembers = {}, vrSearch = "", vrScope = "workspace", selectedTeamId = "") {
  const pid = cliProviderId(provider) || "openai";
  const label = providerLabel(pid);
  const owned = listing?.[providerShareKey(pid)]?.owned || [];
  const people = [];
  owned.forEach((share) => {
    if (vrScope === "workspace" && selectedTeamId && share.team_id !== selectedTeamId) return;
    const members = shareMembers[share.id] || [];
    members.filter((m) => !m.is_owner).forEach((m) => {
      people.push({
        ...m,
        team_id: share.team_id,
        team_name: share.team_name,
        share_id: share.id,
        provider: pid,
      });
    });
  });
  const filtered = filterPeopleByQuery(people, vrSearch);
  const rows = filtered.map((m) => `
    <div class="ai-sub-person-row" data-ai-sub-vr-row="${esc(personId(m))}" data-ai-sub-person="${esc(personId(m))}" data-email="${esc(personEmail(m))}" data-handle="${esc(personHandle(m))}" data-team-id="${esc(m.team_id || "")}" data-share-id="${esc(m.share_id || "")}" data-provider="${esc(pid)}">
      <button type="button" class="ai-sub-person-main" data-ai-sub-person="${esc(personId(m))}" data-email="${esc(personEmail(m))}" data-handle="${esc(personHandle(m))}">
        ${avatarHtml(m)}
        <span class="ai-sub-person-copy">
          <strong>${esc(personName(m))}</strong>
          <small>${esc(handleLabel(m) || m.team_name || "workspace")}</small>
        </span>
      </button>
      <span class="ai-sub-person-controls">
        <label class="ai-sub-grant" title="${m.granted ? "VR access on" : "No VR access"}">
          <input type="checkbox" data-ai-sub-grant="${esc(m.team_id)}" data-provider="${esc(pid)}" data-share-id="${esc(m.share_id)}" data-user-id="${esc(personId(m))}" ${m.granted ? "checked" : ""} />
          <span class="ai-sub-grant-label">VR</span>
        </label>
      </span>
    </div>
  `).join("");
  return `
    <div class="ai-sub-vr-permissions" data-ai-sub-vr-permissions data-ai-sub-vr-cap="${VR_LIST_CAP}">
      <header class="ai-sub-share-head">
        <h3 class="ai-sub-share-title">VR permissions</h3>
        <button type="button" class="ai-chip-btn" data-ai-billing-analytics="vr">View analytics</button>
      </header>
      <p class="muted small">Right-click a row to add or remove — same share options as a workspace. Headset Studio → Keys stays in sync.</p>
      ${rosterBox(
        rows,
        `<p class="muted small">Share ${esc(label)} with a workspace first — then grant people here or in VR.</p>`,
        {
          cap: VR_LIST_CAP,
          searchValue: vrSearch,
          searchAttr: "data-ai-sub-vr-search",
          placeholder: "Search VR people…",
          extraToolbar: `
            <label class="ai-sub-roster-filter">
              <span>Scope</span>
              <select data-ai-sub-vr-scope aria-label="Filter VR by team or workspace">
                <option value="workspace"${vrScope === "workspace" ? " selected" : ""}>Workspace</option>
                <option value="team"${vrScope === "team" ? " selected" : ""}>Team</option>
              </select>
            </label>
          `,
        },
      )}
    </div>
  `;
}

function usageMeter(provider, listing) {
  const usage = provider?.usage || listing?.usage;
  if (!usage) return "";
  const spent = Number(usage.spent_today_usd || 0);
  const tokens = Number(usage.spent_today_tokens || 0);
  const limit = usage.daily_limit_usd;
  const tokenLimit = usage.daily_token_limit;
  const remainingUsd = usage.remaining_today_usd;
  const remainingTokens = usage.remaining_today_tokens;
  const remainingPct = usage.remaining_pct;
  const usedPct = usage.used_pct;
  const weekSpent = Number(usage.spent_week_usd || 0);
  const weekLimit = usage.weekly_limit_usd;
  let pct = 0;
  if (limit != null && Number(limit) > 0) pct = Math.min(100, Math.round((spent / Number(limit)) * 100));
  else if (tokenLimit != null && Number(tokenLimit) > 0) {
    pct = Math.min(100, Math.round((tokens / Number(tokenLimit)) * 100));
  }
  const weekPct = usedPct != null ? Number(usedPct) : pct;
  const tone = remainingPct == null
    ? ""
    : Number(remainingPct) >= 75
      ? "green"
      : Number(remainingPct) >= 40
        ? "yellow"
        : "red";
  const cap = limit != null
    ? `${formatUsd(spent)} of ${formatUsd(limit)} today${remainingUsd != null ? ` · ${formatUsd(remainingUsd)} left` : ""}`
    : tokenLimit != null
      ? `${formatTokens(tokens)} of ${formatTokens(tokenLimit)} tokens today${remainingTokens != null ? ` · ${formatTokens(remainingTokens)} left` : ""}`
      : `${formatUsd(spent)} CAD spend today · ${formatTokens(tokens)} tokens`;
  const weekCap = weekLimit != null
    ? `${formatUsd(weekSpent)} of ${formatUsd(weekLimit)} this week${remainingPct != null ? ` · ${remainingPct}% left` : ""}`
    : "";
  const note = provider?.usage_note || "";
  return `
    <div class="ai-sub-usage">
      <div class="ai-sub-usage-head">
        <span>Connected-app usage today</span>
        <strong>${esc(cap)}</strong>
      </div>
      <div class="ai-sub-usage-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <span style="width:${pct || (spent > 0 ? 8 : 0)}%"></span>
      </div>
      ${weekCap ? `
      <div class="ai-sub-usage-head">
        <span>Weekly CAD limit</span>
        <strong class="ai-sub-week-pct is-${tone}">${remainingPct != null ? `${esc(String(remainingPct))}% left` : esc(weekCap)}</strong>
      </div>
      <div class="ai-sub-usage-bar ai-sub-usage-bar--week" role="progressbar" aria-valuenow="${weekPct}" aria-valuemin="0" aria-valuemax="100">
        <span style="width:${weekPct || (weekSpent > 0 ? 8 : 0)}%"></span>
      </div>
      <p class="muted small">${esc(weekCap)}</p>` : ""}
      ${note ? `<p class="muted small">${esc(note)}</p>` : ""}
    </div>
  `;
}

function connectedAppsMarkup(listing, selectedId) {
  const apps = [
    { id: "openai", label: "ChatGPT" },
    { id: "claude", label: "Claude" },
  ];
  return `
    <div class="ai-sub-apps" data-ai-sub-connected-apps>
      <span class="ai-sub-share-label">Connected apps</span>
      <div class="ai-sub-apps-row">
        ${apps.map((app) => {
          const provider = (listing.providers || []).find((p) => p.id === app.id) || { id: app.id, label: app.label };
          const state = connectedAppState(provider, listing);
          return `
            <button type="button" class="ai-sub-app ${state.connected ? "is-connected" : "is-idle"}${app.id === selectedId ? " is-active" : ""}" data-ai-sub-select="${esc(app.id)}" title="${esc(state.label)}" aria-label="${esc(app.label)} ${esc(state.label)}">
              ${providerIcon(app.id)}
              <span>${esc(app.label)}</span>
              <em class="ai-sub-app-hover">${esc(state.label)}</em>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function selectedView(provider, listing, editingId, teams = [], shareMembers = {}, workspaceMgmt = {}, selectedTeamId = "", creatingWorkspace = false, peopleSearch = "", workspaceSearch = "", peopleScope = "workspace", vrSearch = "", vrScope = "workspace", peopleTab = "people", planUsersFirst = false, planSearch = "", claudeSetupOpen = false) {
  const cli = cliState(provider, listing);
  const auth = authLabel(provider, listing);
  const signing = auth.pill === "signing_in";
  const editing = editingId === provider.id;
  const signedIn = auth.pill === "signed_in";
  const sharedClaude = provider.id === "claude" && sharedSubscriptionAccess(provider, listing).available;
  return `
    <div class="ai-sub-selected">
      ${connectedAppsMarkup(listing, provider?.id)}
      <label class="profile-preference-switch ai-sub-weekly-pref">
        <span>
          <b>Show weekly usage on the AI CAD Prompt key</b>
          <small>Percent of your weekly CAD cap left. Green at 75%+ remaining, then yellow, then red. Uses 7× the daily cap set here.</small>
        </span>
        <input id="pref-sub-weekly-usage" type="checkbox" data-ai-sub-weekly-usage ${readShowWeeklyUsagePref() ? "checked" : ""} />
      </label>
      <div class="ai-sub-auth-row">
        <span class="ai-sub-auth-label">Auth status</span>
        ${pillMarkup(auth)}
        ${signedIn && ["openai", "cloud", "claude"].includes(provider.id) ? `<button type="button" class="ai-sub-logout-link" data-ai-sub-disconnect="${esc(provider.id)}">${provider.id === "cloud" ? "Turn off" : "Log out"}</button>` : ""}
      </div>
      <p class="ai-sub-auth-text">${esc(auth.text)}</p>
      ${usageMeter(provider, listing)}
      ${signing || cli.device_code || cli.needs_code || provider.needs_code || (provider.id === "claude" && !signedIn && !sharedClaude && claudeSetupOpen) ? deviceCodeBox(provider, listing) : ""}
      ${(cli.error || provider.auth_error) && auth.pill === "error" ? `<p class="ai-sub-error">${esc(cli.error || provider.auth_error)}</p>` : ""}
      ${listing.loadError ? `<p class="ai-sub-error">${esc(listing.loadError)}</p>` : ""}
      <div class="ai-sub-connect-stack">
        ${connectButtons(provider, listing, { claudeSetupOpen })}
      </div>
      ${["openai", "claude"].includes(provider.id) ? chatgptShareMarkup(provider, listing, teams, shareMembers, workspaceMgmt, selectedTeamId, creatingWorkspace, peopleSearch, workspaceSearch, peopleScope, peopleTab, planUsersFirst, planSearch) : ""}
      ${["openai", "claude"].includes(provider.id) && peopleTab === "plan" ? vrPermissionsMarkup(provider, listing, shareMembers, vrSearch, vrScope, selectedTeamId) : ""}
      ${editing && provider.id !== "cloud" ? `
        <form class="ai-sub-save" data-ai-sub-save="${esc(provider.id)}">
          <input type="email" name="email" placeholder="Account email" value="${esc(provider.account_email || "")}" autocomplete="email" />
          <input type="text" name="plan" placeholder="Plan (Pro, Ultra, Plus…)" value="${esc(provider.plan_label || "")}" />
          <button type="submit" class="ai-chip-btn ai-chip-btn--accent">Save connection</button>
        </form>
      ` : ""}
      ${provider.connected && !editing && provider.id !== "cloud" ? `<button type="button" class="ai-chip-btn" data-ai-sub-edit="${esc(provider.id)}">Edit email / plan</button>` : ""}
      <p class="muted small ai-sub-blurb">${esc(provider.blurb)}</p>
    </div>
  `;
}

export function createAiSubscriptionsUI({ api, openKeys, onChange, openProfile } = {}) {
  const btn = document.getElementById("btn-subscriptions-menu");
  const modal = document.getElementById("ai-key-modal") || document.getElementById("ai-subscriptions-modal");
  const body = document.getElementById("ai-sub-modal-body");
  const hint = document.getElementById("ai-sub-menu-hint");
  let data = mergeListing();
  let selectedId = "cloud";
  let providerSelectionLocked = false;
  let editingId = null;
  let pollTimer = 0;
  let pendingOpenChatgpt = false;
  let pendingOpenUrl = "";
  let pendingOpenName = "";
  const claudeCode = { open: false, draft: "", submitting: false, message: "" };
  let teams = [];
  let shareMembers = {};
  let workspaceMgmt = {};
  let selectedTeamId = "";
  let creatingWorkspace = false;
  let personQuery = "";
  let suggestHits = [];
  let suggestIndex = -1;
  let suggestOpen = false;
  let lookupTimer = 0;
  let peekPerson = null;
  let restoreAddFocus = false;
  let restoreAddPos = null;
  let peopleSearch = "";
  let workspaceSearch = "";
  let peopleScope = "workspace";
  let peopleTab = "plan";
  let planUsersFirst = false;
  let planSearch = "";
  let vrSearch = "";
  let vrScope = "workspace";
  let personalQuery = "";
  let personalSuggestHits = [];
  let personalSuggestIndex = -1;
  let personalSuggestOpen = false;
  let personalLookupTimer = 0;
  let personalPeekPerson = null;
  let planPeekPerson = null;
  let restorePersonalFocus = false;
  let restorePersonalPos = null;
  let restorePeopleSearchFocus = false;
  let restorePlanSearchFocus = false;
  let restorePlanSearchPos = null;
  let restoreWorkspaceSearchFocus = false;
  let restoreWorkspaceSearchPos = null;
  let restoreVrSearchFocus = false;
  let restoreVrSearchPos = null;

  function isOpen() {
    return Boolean(modal && !modal.classList.contains("hidden") && (modal.dataset.billingTab === "subscriptions" || modal.id === "ai-subscriptions-modal"));
  }

  function isBillingHost() {
    return modal?.id === "ai-key-modal";
  }

  function stopPoll() {
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = 0;
    }
  }

  function syncHint() {
    if (!hint) return;
    const n = Number(data.connected_count || 0);
    hint.textContent = n
      ? `${n} connected · login and manage`
      : "Cloud, ChatGPT";
  }

  function selectedProvider() {
    const providers = data.providers || [];
    return providers.find((p) => p.id === selectedId) || providers[0] || null;
  }

  function currentShare() {
    return (data?.[providerShareKey(selectedId)]?.owned || []).find((s) => s.team_id === selectedTeamId) || null;
  }

  function knownPeople() {
    const share = currentShare();
    const grants = share ? (shareMembers[share.id] || []) : [];
    return mergePeople(
      (workspaceMgmt.members || []).map((m) => ({ ...m, already_member: true })),
      grants.map((m) => ({ ...m, already_member: true })),
      workspaceMgmt.candidates || [],
      personalPeople(data, selectedId),
    );
  }

  function planPeople() {
    const provider = selectedProvider();
    return provider ? collectSubscriptionUsers(data, shareMembers, provider.id) : [];
  }

  function personFromEl(el) {
    if (!el) return null;
    const id = el.getAttribute("data-ai-sub-person") || el.getAttribute("data-user-id") || "";
    const email = el.getAttribute("data-email") || "";
    const handle = el.getAttribute("data-handle") || "";
    const known = mergePeople(knownPeople(), planPeople(), suggestHits, personalSuggestHits);
    return known.find((p) =>
      (id && personId(p) === id)
      || (email && personEmail(p) === email.toLowerCase())
      || (handle && personHandle(p).toLowerCase() === handle.toLowerCase())
    ) || {
      id: id || null,
      user_id: id || null,
      email: email || null,
      handle: handle || null,
      display_name: el.getAttribute("data-name") || email || handle || "Person",
    };
  }

  function inviteableTeams() {
    return (teams || []).filter((t) => t.can_invite);
  }

  function paintSuggest() {
    const box = body?.querySelector("[data-ai-sub-suggest]");
    if (!box) return;
    if (!suggestOpen || !suggestHits.length) {
      box.classList.add("hidden");
      box.innerHTML = "";
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.classList.remove("hidden");
    box.innerHTML = suggestHits.map((p, i) => {
      const sub = personSubtitle(p);
      const badge = p.already_member
        ? "In this workspace"
        : p.source_teams
          ? String(p.source_teams).split(",")[0]
          : (p.needs_confirm ? "New" : "");
      return `
        <button type="button" class="ai-sub-suggest-item${i === suggestIndex ? " is-active" : ""}" role="option" data-ai-sub-suggest-pick="${i}" data-ai-sub-person="${esc(personId(p))}" data-email="${esc(personEmail(p))}" data-handle="${esc(personHandle(p))}" data-name="${esc(personName(p))}">
          ${avatarHtml(p)}
          <span class="ai-sub-person-copy">
            <strong>${esc(personName(p))}</strong>
            ${sub ? `<small>${esc(sub)}</small>` : ""}
          </span>
          ${badge ? `<em>${esc(badge)}</em>` : ""}
        </button>
      `;
    }).join("");
  }

  function paintPeek() {
    const box = body?.querySelector("[data-ai-sub-peek]");
    if (!box) return;
    const person = peekPerson;
    if (!person) {
      box.classList.add("hidden");
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const currentId = selectedTeamId;
    const inCurrent = !!(person.already_member || (workspaceMgmt.members || []).some((m) => personId(m) === personId(person)));
    const others = inviteableTeams().filter((t) => t.id !== currentId);
    const currentName = (teams || []).find((t) => t.id === currentId)?.name || "this workspace";
    const sub = personSubtitle(person);
    box.hidden = false;
    box.classList.remove("hidden");
    box.innerHTML = `
      <button type="button" class="ai-sub-peek-close" data-ai-sub-peek-close aria-label="Close profile">×</button>
      <div class="ai-sub-peek-head">
        ${avatarHtml(person)}
        <div>
          <strong>${esc(personName(person))}</strong>
          ${sub ? `<small>${esc(sub)}</small>` : ""}
        </div>
      </div>
      <div class="ai-sub-peek-actions">
        ${inCurrent
          ? `<span class="muted small">Already in ${esc(currentName)}</span>`
          : `<button type="button" class="btn accent btn-compact" data-ai-sub-peek-add>Add to ${esc(currentName)}</button>`}
        <button type="button" class="btn secondary btn-compact" data-ai-sub-peek-profile>View profile</button>
      </div>
      ${others.length ? `
        <div class="ai-sub-peek-teams">
          <span class="ai-sub-share-label">Invite to other workspaces</span>
          ${others.map((t) => `
            <button type="button" class="ai-sub-peek-team" data-ai-sub-peek-invite="${esc(t.id)}">Add to ${esc(t.name || "workspace")}</button>
          `).join("")}
        </div>
      ` : ""}
    `;
  }

  function paintPlanPeek() {
    const box = body?.querySelector("[data-ai-sub-plan-peek]");
    if (!box) return;
    const person = planPeekPerson;
    if (!person) {
      box.classList.add("hidden");
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const sources = (person.plan_sources || []).filter(Boolean);
    const sub = [personSubtitle(person), sources.join(" · ")].filter(Boolean).join(" · ");
    box.hidden = false;
    box.classList.remove("hidden");
    box.innerHTML = `
      <button type="button" class="ai-sub-peek-close" data-ai-sub-plan-peek-close aria-label="Close person details">×</button>
      <div class="ai-sub-peek-head">
        ${avatarHtml(person)}
        <div>
          <strong>${esc(personName(person))}</strong>
          ${sub ? `<small>${esc(sub)}</small>` : ""}
        </div>
      </div>
      <p class="muted small">This person currently has access to your ${esc(providerLabel(person.provider || selectedProvider()?.id || "openai"))} subscription.</p>
    `;
  }

  function restoreAddInput() {
    const input = body?.querySelector("[data-ai-sub-add-person]");
    const personalInput = body?.querySelector("[data-ai-sub-add-personal]");
    const searchInput = body?.querySelector("[data-ai-sub-people-search]");
    const planSearchInput = body?.querySelector("[data-ai-sub-plan-search]");
    const wsSearch = body?.querySelector("[data-ai-sub-ws-search]");
    const vrSearchInput = body?.querySelector("[data-ai-sub-vr-search]");
    if (input && personQuery) input.value = personQuery;
    if (personalInput && personalQuery) personalInput.value = personalQuery;
    if (searchInput && peopleSearch) searchInput.value = peopleSearch;
    if (planSearchInput && planSearch) planSearchInput.value = planSearch;
    if (wsSearch && workspaceSearch) wsSearch.value = workspaceSearch;
    if (vrSearchInput && vrSearch) vrSearchInput.value = vrSearch;
    if (peekPerson) {
      const next = knownPeople().find((p) =>
        (personId(peekPerson) && personId(p) === personId(peekPerson))
        || (personEmail(peekPerson) && personEmail(p) === personEmail(peekPerson))
        || (personHandle(peekPerson) && personHandle(p).toLowerCase() === personHandle(peekPerson).toLowerCase())
      );
      if (next) peekPerson = { ...peekPerson, ...next };
    }
    paintSuggest();
    paintPeek();
    paintPersonalSuggest();
    paintPersonalPeek();
    paintPlanPeek();
    if (restoreAddFocus && input) {
      input.focus();
      const pos = restoreAddPos == null ? input.value.length : restoreAddPos;
      try { input.setSelectionRange(pos, pos); } catch { /* ignore */ }
      restoreAddFocus = false;
    }
    if (restorePersonalFocus && personalInput) {
      personalInput.focus();
      const pos = restorePersonalPos == null ? personalInput.value.length : restorePersonalPos;
      try { personalInput.setSelectionRange(pos, pos); } catch { /* ignore */ }
      restorePersonalFocus = false;
    }
    if (restorePeopleSearchFocus && searchInput) {
      searchInput.focus();
      try { searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length); } catch { /* ignore */ }
      restorePeopleSearchFocus = false;
    }
    if (restorePlanSearchFocus && planSearchInput) {
      planSearchInput.focus();
      const pos = restorePlanSearchPos == null ? planSearchInput.value.length : restorePlanSearchPos;
      try { planSearchInput.setSelectionRange(pos, pos); } catch { /* ignore */ }
      restorePlanSearchFocus = false;
    }
    if (restoreWorkspaceSearchFocus && wsSearch) {
      wsSearch.focus();
      const pos = restoreWorkspaceSearchPos == null ? wsSearch.value.length : restoreWorkspaceSearchPos;
      try { wsSearch.setSelectionRange(pos, pos); } catch { /* ignore */ }
      restoreWorkspaceSearchFocus = false;
    }
    if (restoreVrSearchFocus && vrSearchInput) {
      vrSearchInput.focus();
      const pos = restoreVrSearchPos == null ? vrSearchInput.value.length : restoreVrSearchPos;
      try { vrSearchInput.setSelectionRange(pos, pos); } catch { /* ignore */ }
      restoreVrSearchFocus = false;
    }
  }

  function localSuggestions(query) {
    const people = knownPeople();
    const filtered = people.filter((p) => matchesQuery(p, query));
    if (!String(query || "").trim()) {
      return filtered.filter((p) => !p.already_member).slice(0, 6);
    }
    return filtered.slice(0, 8);
  }

  async function runSuggest(query) {
    const q = String(query || "").trim();
    personQuery = q;
    let hits = localSuggestions(q);
    if (q.length >= 2 && selectedTeamId) {
      try {
        const dataLookup = await api(
          `/api/teams/invite-lookup?q=${encodeURIComponent(q)}&team_id=${encodeURIComponent(selectedTeamId)}`,
        );
        if ((body?.querySelector("[data-ai-sub-add-person]")?.value || "").trim() !== q) return;
        hits = mergePeople(hits, dataLookup?.matches || []);
      } catch {
        /* keep local */
      }
    }
    const seen = new Set();
    suggestHits = hits.filter((p) => {
      const key = personKey(p);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
    suggestIndex = suggestHits.length ? Math.min(Math.max(suggestIndex, 0), suggestHits.length - 1) : -1;
    suggestOpen = suggestHits.length > 0;
    paintSuggest();
  }

  function scheduleSuggest(query) {
    window.clearTimeout(lookupTimer);
    lookupTimer = window.setTimeout(() => {
      void runSuggest(query);
    }, 180);
  }

  async function invitePerson(person, teamId, raw = "") {
    if (!teamId) {
      data = mergeListing({ loadError: "Choose or create a workspace first." }, data);
      render();
      restoreAddInput();
      return null;
    }
    const payload = invitePayloadFor(person, raw);
    if (!payload) return null;
    if (data?.chatgpt?.signed_in) {
      const alreadyShared = (data.chatgpt_shares?.owned || []).some((s) => s.team_id === teamId);
      if (!alreadyShared) {
        await api(`/api/teams/${encodeURIComponent(teamId)}/chatgpt`, { method: "POST" }).catch(() => {});
      }
    }
    for (const pid of ["claude"]) {
      if (!data?.[pid]?.signed_in) continue;
      const alreadyShared = (data[`${pid}_shares`]?.owned || []).some((s) => s.team_id === teamId);
      if (!alreadyShared) {
        await api(shareApiBase(pid, teamId), { method: "POST" }).catch(() => {});
      }
    }
    const inviteBody = {
      ...payload,
      confirm_new_collaborator: false,
      grant_chatgpt: teamId === selectedTeamId,
    };
    let result = await api(`/api/teams/${encodeURIComponent(teamId)}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inviteBody),
    });
    if (result?.status === "needs_confirm") {
      const label = result.user?.display_name || result.user?.handle_label || personName(person) || raw;
      const teamName = (teams || []).find((t) => t.id === teamId)?.name || "this workspace";
      const ok = window.confirm(
        result.message || `Share ${teamName} with ${label}?`,
      );
      if (!ok) return result;
      result = await api(`/api/teams/${encodeURIComponent(teamId)}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...inviteBody, confirm_new_collaborator: true }),
      });
    }
    return result;
  }

  function paintPersonalSuggest() {
    const box = body?.querySelector("[data-ai-sub-personal-suggest]");
    if (!box) return;
    if (!personalSuggestOpen || !personalSuggestHits.length) {
      box.classList.add("hidden");
      box.innerHTML = "";
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.classList.remove("hidden");
    box.innerHTML = personalSuggestHits.map((p, i) => {
      const sub = personSubtitle(p);
      const badge = p.already_personal ? "Already added" : (p.needs_confirm ? "New" : "");
      return `
        <button type="button" class="ai-sub-suggest-item${i === personalSuggestIndex ? " is-active" : ""}" role="option" data-ai-sub-personal-suggest-pick="${i}" data-ai-sub-person="${esc(personId(p))}" data-email="${esc(personEmail(p))}" data-handle="${esc(personHandle(p))}" data-name="${esc(personName(p))}">
          ${avatarHtml(p)}
          <span class="ai-sub-person-copy">
            <strong>${esc(personName(p))}</strong>
            ${sub ? `<small>${esc(sub)}</small>` : ""}
          </span>
          ${badge ? `<em>${esc(badge)}</em>` : ""}
        </button>
      `;
    }).join("");
  }

  function paintPersonalPeek() {
    const box = body?.querySelector("[data-ai-sub-personal-peek]");
    if (!box) return;
    const person = personalPeekPerson;
    if (!person) {
      box.classList.add("hidden");
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const already = personalPeople(data, selectedId).some((p) => personId(p) === personId(person));
    const sub = personSubtitle(person);
    box.hidden = false;
    box.classList.remove("hidden");
    box.innerHTML = `
      <button type="button" class="ai-sub-peek-close" data-ai-sub-personal-peek-close aria-label="Close profile">×</button>
      <div class="ai-sub-peek-head">
        ${avatarHtml(person)}
        <div>
          <strong>${esc(personName(person))}</strong>
          ${sub ? `<small>${esc(sub)}</small>` : ""}
        </div>
      </div>
      <div class="ai-sub-peek-actions">
        ${already
          ? `<span class="muted small">Already on your People list</span>`
          : `<button type="button" class="btn accent btn-compact" data-ai-sub-peek-add-personal>Add person (no workspace)</button>`}
        <button type="button" class="btn secondary btn-compact" data-ai-sub-peek-profile-personal>View profile</button>
      </div>
    `;
  }

  function personalLocalSuggestions(query) {
    const added = new Set(personalPeople(data, selectedId).map((p) => personId(p)).filter(Boolean));
    const people = knownPeople().map((p) => ({ ...p, already_personal: added.has(personId(p)) }));
    const filtered = people.filter((p) => matchesQuery(p, query));
    if (!String(query || "").trim()) {
      return filtered.filter((p) => !p.already_personal).slice(0, 6);
    }
    return filtered.slice(0, 8);
  }

  async function runPersonalSuggest(query) {
    const providerId = selectedId;
    const q = String(query || "").trim();
    personalQuery = q;
    let hits = personalLocalSuggestions(q);
    if (q.length >= 2) {
      try {
        const dataLookup = await api(`/api/teams/invite-lookup?q=${encodeURIComponent(q)}`);
        if (providerId !== selectedId || (body?.querySelector("[data-ai-sub-people-search], [data-ai-sub-add-personal]")?.value || "").trim() !== q) return;
        hits = mergePeople(hits, dataLookup?.matches || []);
      } catch {
        /* keep local */
      }
    }
    const added = new Set(personalPeople(data, selectedId).map((p) => personId(p)).filter(Boolean));
    const seen = new Set();
    personalSuggestHits = hits.filter((p) => {
      const key = personKey(p);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      if (personId(p) && added.has(personId(p))) p.already_personal = true;
      return true;
    }).slice(0, 8);
    personalSuggestIndex = personalSuggestHits.length
      ? Math.min(Math.max(personalSuggestIndex, 0), personalSuggestHits.length - 1)
      : -1;
    personalSuggestOpen = personalSuggestHits.length > 0;
    paintPersonalSuggest();
  }

  function schedulePersonalSuggest(query) {
    window.clearTimeout(personalLookupTimer);
    personalLookupTimer = window.setTimeout(() => {
      void runPersonalSuggest(query);
    }, 180);
  }

  async function addPersonalPerson(person, raw = "") {
    const providerId = selectedId;
    let payload = invitePayloadFor(person, raw);
    if (!payload && personId(person)) payload = { user_id: personId(person) };
    if (!payload) return null;
    const bodyPayload = { ...payload, confirm_new_collaborator: false };
    if (personId(person)) bodyPayload.user_id = personId(person);
    let result = await api(personalPeopleApi(providerId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });
    if (result?.status === "needs_confirm") {
      const label = result.user?.display_name || result.person?.display_name || personName(person) || raw;
      const ok = window.confirm(
        result.message || `Add ${label} as a person (not to a workspace) so they can use this ${providerLabel(providerId)} login?`,
      );
      if (!ok) return result;
      result = await api(personalPeopleApi(providerId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...bodyPayload, confirm_new_collaborator: true }),
      });
    }
    return { ...result, providerId };
  }

  function applyPersonalPeople(nextPeople, providerId) {
    const people = nextPeople || [];
    data = mergeListing({
      providers: data.providers,
      ...(providerId === "openai" ? { personal_people: people } : {}),
      [providerShareKey(providerId)]: { ...(data[providerShareKey(providerId)] || {}), personal_people: people },
    }, data);
  }

  function openPersonalPeek(person) {
    if (!person) return;
    personalPeekPerson = person;
    personalSuggestOpen = false;
    paintPersonalSuggest();
    paintPersonalPeek();
  }

  function openPeek(person) {
    if (!person) return;
    peekPerson = person;
    suggestOpen = false;
    paintSuggest();
    paintPeek();
  }

  function openPlanPeek(person) {
    if (!person) return;
    planPeekPerson = person;
    paintPlanPeek();
  }

  function render() {
    if (!body) return;
    if (modal && modal.classList.contains("hidden")) return;
    if (isBillingHost() && modal.dataset.billingTab && modal.dataset.billingTab !== "subscriptions") return;
    const providers = connectableProviders(data.providers || DEFAULT_PROVIDERS);
    const current = selectedProvider() || providers[0];
    const searchAttributes = ["data-ai-sub-plan-search", "data-ai-sub-people-search", "data-ai-sub-ws-search", "data-ai-sub-vr-search", "data-ai-sub-add-person", "data-ai-sub-add-personal"];
    const activeSearch = document.activeElement;
    const activeSearchAttribute = activeSearch && searchAttributes.find((attribute) => activeSearch === body.querySelector(`[${attribute}]`));
    const searchSelection = activeSearchAttribute
      ? [activeSearch.selectionStart, activeSearch.selectionEnd, activeSearch.selectionDirection]
      : null;
    const previousCodeInput = body.querySelector("[data-ai-sub-claude-code] input");
    const restoreCodeFocus = previousCodeInput && document.activeElement === previousCodeInput;
    const codeSelection = restoreCodeFocus
      ? [previousCodeInput.selectionStart, previousCodeInput.selectionEnd, previousCodeInput.selectionDirection]
      : null;
    const claudeProvider = providers.find((provider) => provider.id === "claude") || { id: "claude" };
    if (subscriptionAuthStatus(claudeProvider, data) === "signed_in") {
      claudeCode.open = false;
      claudeCode.draft = "";
      claudeCode.message = "";
    } else if (previousCodeInput) {
      claudeCode.draft = previousCodeInput.value;
    }
    body.innerHTML = `
      ${subscriptionOnboardingMarkup(data)}
      ${current ? selectedView(current, data, editingId, teams, shareMembers, workspaceMgmt, selectedTeamId, creatingWorkspace, peopleSearch, workspaceSearch, peopleScope, vrSearch, vrScope, peopleTab, planUsersFirst, planSearch, claudeCode.open) : ""}
      <p class="muted small profile-costs-note">
        Cloud uses studio credits. ChatGPT and Claude sharing live here. API usage, limits, billing, and keys are on the AI Keys tab.
      </p>
    `;
    restoreAddInput();
    if (activeSearchAttribute) {
      const searchInput = body.querySelector(`[${activeSearchAttribute}]`);
      if (searchInput) {
        searchInput.focus();
        try { searchInput.setSelectionRange(...searchSelection); } catch { /* ignore */ }
      }
    }
    const codeInput = body.querySelector("[data-ai-sub-claude-code] input");
    if (codeInput) {
      codeInput.value = claudeCode.draft;
      codeInput.readOnly = claudeCode.submitting;
      const submit = body.querySelector("[data-ai-sub-claude-code] button[type=submit]");
      if (submit) {
        submit.disabled = claudeCode.submitting;
        submit.textContent = claudeCode.submitting ? "Connecting…" : "Connect Claude";
      }
      const message = body.querySelector("[data-ai-sub-claude-code-status]");
      if (message) message.textContent = claudeCode.message;
      if (restoreCodeFocus) {
        codeInput.focus();
        try { codeInput.setSelectionRange(...codeSelection); } catch { /* ignore */ }
      }
    }
  }

  function maybeStartPoll() {
    const signing = hasPendingSubscriptionLogin(data);
    if (!signing) {
      stopPoll();
      return;
    }
    if (pollTimer) return;
    pollTimer = window.setInterval(() => {
      void pollStatus();
    }, 2000);
  }

  let lastCadReady = false;
  let lastHasKey = false;
  let lastCursorOn = false;
  let lastClaudeOn = false;

  async function applyListing(next) {
    data = mergeListing(next || {}, data);
    selectedId = preferredSubscriptionProviderId(data, selectedId, providerSelectionLocked);
    syncHint();
    render();
    maybeStartPoll();
    const chatgpt = data.chatgpt || {};
    if (pendingOpenChatgpt && chatgpt.device_code && chatgpt.login_url) {
      pendingOpenChatgpt = false;
      openPopup(chatgpt.login_url, "render3d-chatgpt-login");
    }
    if (pendingOpenUrl) {
      const url = pendingOpenUrl;
      const name = pendingOpenName || "render3d-login";
      pendingOpenUrl = "";
      pendingOpenName = "";
      openPopup(url, name);
    }
    const cadReady = !!(data.providers || []).some((p) => p.cad_ready || connectedAppState(p, data).connected)
      || !!(data.chatgpt?.signed_in || data.cursor?.signed_in || data.claude?.signed_in);
    const hasKey = (data.providers || []).some((p) => p.has_api_key);
    const cursorOn = !!data.cursor?.signed_in;
    const claudeOn = !!data.claude?.signed_in;
    if (cadReady !== lastCadReady || hasKey !== lastHasKey || cursorOn !== lastCursorOn || claudeOn !== lastClaudeOn) {
      lastCadReady = cadReady;
      lastHasKey = hasKey;
      lastCursorOn = cursorOn;
      lastClaudeOn = claudeOn;
      try { onChange?.(data); } catch { /* ignore */ }
    }
  }

  async function loadSelectedWorkspace() {
    const owned = [
      ...(data?.chatgpt_shares?.owned || []),
      ...(data?.cursor_shares?.owned || []),
      ...(data?.claude_shares?.owned || []),
    ];
    if (!selectedTeamId) {
      selectedTeamId = owned[0]?.team_id || (teams[0] && teams[0].id) || "";
    }
    if (!selectedTeamId) {
      workspaceMgmt = {};
      return;
    }
    try {
      workspaceMgmt = await api(`/api/teams/${encodeURIComponent(selectedTeamId)}/management`);
    } catch {
      workspaceMgmt = {};
    }
    const nextMembers = { ...shareMembers };
    await Promise.all(owned.map(async (share) => {
      if (!share?.id || !share.team_id) return;
      const pid = share.provider || "openai";
      try {
        const next = await api(`${shareApiBase(pid, share.team_id)}/${encodeURIComponent(share.id)}/members`);
        nextMembers[share.id] = next.members || [];
      } catch {
        /* ignore */
      }
    }));
    shareMembers = nextMembers;
  }

  let subscriptionsAbort = null; // leakfix59
  function beginSubscriptionsFetch() {
    if (subscriptionsAbort) {
      try { subscriptionsAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    subscriptionsAbort = ctl;
    return ctl;
  }

  async function refresh() {
    if (!body) return;
    const ctl = beginSubscriptionsFetch();
    try {
      const [listing, teamsData] = await Promise.all([
        api("/api/ai-subscriptions", { signal: ctl.signal }),
        api("/api/teams", { signal: ctl.signal }).catch((err) => {
          if (ctl.signal.aborted || err?.name === "AbortError") throw err;
          return { teams: [] };
        }),
      ]);
      if (ctl.signal.aborted) return;
      teams = Array.isArray(teamsData?.teams) ? teamsData.teams : [];
      await applyListing(listing);
      if (ctl.signal.aborted) return;
      await loadSelectedWorkspace();
      if (ctl.signal.aborted) return;
      render();
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      stopPoll();
      data = mergeListing({ loadError: err.message || "Could not refresh connection status." }, data);
      render();
    } finally {
      if (subscriptionsAbort === ctl) subscriptionsAbort = null;
    }
  }

  async function pollStatus() {
    const ctl = beginSubscriptionsFetch();
    try {
      const listing = await api("/api/ai-subscriptions", { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      await applyListing(listing);
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      stopPoll();
    } finally {
      if (subscriptionsAbort === ctl) subscriptionsAbort = null;
    }
  }

  async function startChatgpt(openBrowser) {
    selectedId = "openai";
    pendingOpenChatgpt = !!openBrowser;
    try {
      const next = await api("/api/ai-subscriptions/chatgpt/device-auth/start", { method: "POST" });
      await applyListing(next);
    } catch (err) {
      data = mergeListing({
        chatgpt: { ...(data.chatgpt || {}), status: "error", error: err.message || "Could not start ChatGPT sign-in" },
        loadError: err.message || "Could not start ChatGPT sign-in",
      }, data);
      render();
    }
  }

  async function startCursor() {
    selectedId = "cursor";
    try {
      const next = await api("/api/ai-subscriptions/cursor/login/start", { method: "POST" });
      const url = next?.cursor?.login_url || (next?.providers || []).find((p) => p.id === "cursor")?.login_url;
      if (url) {
        pendingOpenUrl = url;
        pendingOpenName = "render3d-cursor-login";
      }
      await applyListing(next);
    } catch (err) {
      data = mergeListing({
        cursor: { ...(data.cursor || {}), status: "error", error: err.message || "Could not start Cursor sign-in" },
        loadError: err.message || "Could not start Cursor sign-in",
      }, data);
      render();
    }
  }

  async function startClaude() {
    if (claudeCode.submitting) return;
    selectedId = "claude";
    providerSelectionLocked = true;
    claudeCode.open = true;
    claudeCode.draft = "";
    claudeCode.message = "";
    const input = body?.querySelector("[data-ai-sub-claude-code] input");
    if (input) input.value = "";
    render();
    body?.querySelector("[data-ai-sub-claude-code] input")?.focus?.();
  }

  function closeModal() {
    modal?.classList.add("hidden");
    applyAiBillingCostsOpen(false);
    if (!hasPendingSubscriptionLogin(data)) stopPoll();
  }

  function submitClaudeCode(codeForm) {
    const code = String(codeForm?.elements?.namedItem("code")?.value || "").trim();
    const provider = (data.providers || []).find((row) => row.id === "claude") || { id: "claude" };
    if (!code || claudeCode.submitting) return;
    claudeCode.draft = code;
    claudeCode.submitting = true;
    data = { ...data, loadError: "" };
    claudeCode.message = "Checking subscription token…";
    render();
    void (async () => {
      try {
        const next = await api("/api/ai-subscriptions/claude/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: code }),
        });
        claudeCode.draft = "";
        claudeCode.message = "Claude subscription connected.";
        const input = body?.querySelector("[data-ai-sub-claude-code] input");
        if (input) input.value = "";
        await applyListing(next);
      } catch (err) {
        data = { ...data, loadError: err.message || "Could not submit Claude code" };
        claudeCode.message = "Token was not accepted. Run `claude setup-token` again and paste the new token.";
      } finally {
        claudeCode.submitting = false;
        render();
      }
    })();
  }

  async function openModal({ tab = "subscriptions", costs = false } = {}) {
    hideProfileFlyoutPanels();
    document.getElementById("user-menu")?.classList.add("hidden");
    if (!modal) return;
    modal.classList.remove("hidden");
    applyAiBillingTab(tab === "keys" ? "keys" : "subscriptions", { costs });
    editingId = null;
    providerSelectionLocked = false;
    data = mergeListing(data);
    if (tab !== "keys") render();
    if (tab === "keys") {
      openKeys?.({ tab: "keys" });
      return;
    }
    await refresh();
  }

  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    void openModal();
  });

  modal?.querySelectorAll(".auth-close[data-ai-sub-close]").forEach((el) => {
    el.addEventListener("click", () => closeModal());
  });

  document.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      if (personalSuggestOpen) {
        personalSuggestOpen = false;
        paintPersonalSuggest();
        e.stopPropagation();
        return;
      }
      if (personalPeekPerson) {
        personalPeekPerson = null;
        paintPersonalPeek();
        e.stopPropagation();
        return;
      }
      if (planPeekPerson) {
        planPeekPerson = null;
        paintPlanPeek();
        e.stopPropagation();
        return;
      }
      if (suggestOpen) {
        suggestOpen = false;
        paintSuggest();
        e.stopPropagation();
        return;
      }
      if (peekPerson) {
        peekPerson = null;
        paintPeek();
        e.stopPropagation();
        return;
      }
      closeModal();
    }
  });

  body?.addEventListener("click", (e) => {
    // Subscription controls are a modal interaction surface. Never let their
    // clicks reach Studio's global viewport/tab handlers behind the dialog.
    e.stopPropagation();
    const claudeClose = e.target.closest("[data-ai-sub-claude-close]");
    if (claudeClose) {
      claudeCode.open = false;
      render();
      return;
    }
    const claudeConnect = e.target.closest("[data-ai-sub-claude-connect]");
    if (claudeConnect) {
      e.preventDefault();
      submitClaudeCode(claudeConnect.closest("[data-ai-sub-claude-code]"));
      return;
    }
    if (suggestOpen && !e.target.closest("[data-ai-sub-add-field]")) {
      suggestOpen = false;
      paintSuggest();
    }
    if (personalSuggestOpen && !e.target.closest("[data-ai-sub-personal-field]")) {
      personalSuggestOpen = false;
      paintPersonalSuggest();
    }
    const select = e.target.closest("[data-ai-sub-select]");
    if (select) {
      selectedId = select.getAttribute("data-ai-sub-select") || selectedId;
      window.clearTimeout(personalLookupTimer);
      personalSuggestHits = [];
      personalSuggestOpen = false;
      personalPeekPerson = null;
      planPeekPerson = null;
      providerSelectionLocked = true;
      editingId = null;
      render();
      return;
    }
    const peopleTabBtn = e.target.closest("[data-ai-sub-people-tab]");
    if (peopleTabBtn) {
      const next = peopleTabBtn.getAttribute("data-ai-sub-people-tab") || "people";
      peopleTab = PEOPLE_LIST_TABS.includes(next) ? next : "people";
      if (peopleTab === "plan") planUsersFirst = true;
      planPeekPerson = null;
      render();
      return;
    }
    const openPeople = e.target.closest("[data-ai-sub-open-people]");
    if (openPeople) {
      peopleTab = "people";
      restorePeopleSearchFocus = true;
      render();
      return;
    }
    const planSortBtn = e.target.closest("[data-ai-sub-plan-sort]");
    if (planSortBtn) {
      planUsersFirst = !planUsersFirst;
      render();
      return;
    }
    const copy = e.target.closest("[data-ai-sub-copy-code]");
    if (copy) {
      const code = copy.getAttribute("data-ai-sub-copy-code") || "";
      void navigator.clipboard?.writeText(code).then(() => {
        copy.textContent = "Copied";
        window.setTimeout(() => {
          copy.textContent = "Copy code";
        }, 1400);
      }).catch(() => {});
      return;
    }
    const signin = e.target.closest("[data-ai-sub-chatgpt-signin]");
    if (signin) {
      void startChatgpt(true);
      return;
    }
    const cursorSignin = e.target.closest("[data-ai-sub-cursor-signin]");
    if (cursorSignin) {
      void startCursor();
      return;
    }
    const claudeSignin = e.target.closest("[data-ai-sub-claude-signin]");
    if (claudeSignin) {
      void startClaude();
      return;
    }
    const reconnect = e.target.closest("[data-ai-sub-reconnect]");
    if (reconnect) {
      const id = reconnect.getAttribute("data-ai-sub-reconnect");
      if (id === "claude") void startClaude();
      else void startChatgpt(true);
      return;
    }
    const device = e.target.closest("[data-ai-sub-chatgpt-device]");
    if (device) {
      void startChatgpt(false);
      return;
    }
    const openCredits = (message) => {
      closeModal();
      openKeys?.({
        preferProvider: "openai",
        openAdd: false,
        message: message || "Buy or enable Render Studio credits for Cloud.",
      });
    };
    const cloudEnable = e.target.closest("[data-ai-sub-cloud-enable]");
    if (cloudEnable) {
      selectedId = "cloud";
      void (async () => {
        try {
          await applyListing(await api("/api/ai-subscriptions/cloud", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }));
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not enable studio credits" }, data);
          render();
        }
      })();
      return;
    }
    const cloudBuy = e.target.closest("[data-ai-sub-cloud-buy]");
    if (cloudBuy) {
      openCredits("Buy Render Studio credits, then enable Cloud in Connect subscriptions.");
      return;
    }
    const cloudManage = e.target.closest("[data-ai-sub-cloud-manage]");
    if (cloudManage) {
      openCredits("Manage Render Studio credits, auto-refill, and the shared platform key.");
      return;
    }
    const logout = e.target.closest("[data-ai-sub-chatgpt-logout]");
    if (logout) {
      void (async () => {
        if (!window.confirm("Log out of the ChatGPT subscription on this Render Studio account?")) return;
        try {
          stopPoll();
          await applyListing(await api("/api/ai-subscriptions/chatgpt/logout", { method: "POST" }));
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not log out" }, data);
          render();
        }
      })();
      return;
    }
    const shareBtn = e.target.closest("[data-ai-sub-share], [data-ai-sub-chatgpt-share]");
    if (shareBtn) {
      const teamId = body.querySelector("[data-ai-sub-chatgpt-team]")?.value;
      const pid = shareBtn.getAttribute("data-ai-sub-share") || "openai";
      if (!teamId) return;
      void (async () => {
        try {
          await api(shareApiBase(pid, teamId), { method: "POST" });
          await refresh();
        } catch (err) {
          data = mergeListing({ loadError: err.message || `Could not share ${providerLabel(pid)} login` }, data);
          render();
        }
      })();
      return;
    }
    const unshareBtn = e.target.closest("[data-ai-sub-unshare], [data-ai-sub-chatgpt-unshare]");
    if (unshareBtn) {
      const teamId = unshareBtn.getAttribute("data-ai-sub-unshare") || unshareBtn.getAttribute("data-ai-sub-chatgpt-unshare");
      const shareId = unshareBtn.getAttribute("data-share-id");
      const pid = unshareBtn.getAttribute("data-provider") || "openai";
      if (!teamId || !shareId) return;
      if (!window.confirm(`Stop sharing this ${providerLabel(pid)} login with the workspace?`)) return;
      void (async () => {
        try {
          await api(`${shareApiBase(pid, teamId)}/${encodeURIComponent(shareId)}`, { method: "DELETE" });
          delete shareMembers[shareId];
          await refresh();
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not stop sharing" }, data);
          render();
        }
      })();
      return;
    }
    const membersBtn = e.target.closest("[data-ai-sub-members], [data-ai-sub-chatgpt-members]");
    if (membersBtn) {
      const teamId = membersBtn.getAttribute("data-ai-sub-members") || membersBtn.getAttribute("data-ai-sub-chatgpt-members");
      const shareId = membersBtn.getAttribute("data-share-id");
      const pid = membersBtn.getAttribute("data-provider") || "openai";
      if (!teamId || !shareId) return;
      void (async () => {
        try {
          const next = await api(`${shareApiBase(pid, teamId)}/${encodeURIComponent(shareId)}/members`);
          shareMembers = { ...shareMembers, [shareId]: next.members || [] };
          render();
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not load members" }, data);
          render();
        }
      })();
      return;
    }
    const createToggle = e.target.closest("[data-ai-sub-toggle-create]");
    if (createToggle) {
      creatingWorkspace = !creatingWorkspace;
      render();
      if (creatingWorkspace) body.querySelector("[data-ai-sub-new-workspace]")?.focus();
      return;
    }
    const personalPeekClose = e.target.closest("[data-ai-sub-personal-peek-close]");
    if (personalPeekClose) {
      personalPeekPerson = null;
      paintPersonalPeek();
      return;
    }
    const planPeekClose = e.target.closest("[data-ai-sub-plan-peek-close]");
    if (planPeekClose) {
      planPeekPerson = null;
      paintPlanPeek();
      return;
    }
    const personalPeekProfile = e.target.closest("[data-ai-sub-peek-profile-personal]");
    if (personalPeekProfile && personalPeekPerson) {
      const id = personId(personalPeekPerson);
      const handle = personHandle(personalPeekPerson);
      if (openProfile) {
        void openProfile({ userId: id || undefined, handle: handle || undefined });
      } else if (handle) {
        window.open(`/u/${encodeURIComponent(handle)}`, "_blank", "noopener");
      }
      return;
    }
    const personalPeekAdd = e.target.closest("[data-ai-sub-peek-add-personal]");
    if (personalPeekAdd && personalPeekPerson) {
      void (async () => {
        try {
          const result = await addPersonalPerson(personalPeekPerson);
          if (result?.status === "needs_confirm") return;
          personalQuery = "";
          personalSuggestHits = [];
          personalSuggestOpen = false;
          personalPeekPerson = null;
          applyPersonalPeople(result?.people, result?.providerId);
          await refresh();
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not add that person" }, data);
          render();
        }
      })();
      return;
    }
    const personalSuggestPick = e.target.closest("[data-ai-sub-personal-suggest-pick]");
    if (personalSuggestPick) {
      const idx = Number(personalSuggestPick.getAttribute("data-ai-sub-personal-suggest-pick"));
      const person = personalSuggestHits[idx] || personFromEl(personalSuggestPick);
      openPersonalPeek(person);
      return;
    }
    const removePersonal = e.target.closest("[data-ai-sub-remove-personal]");
    if (removePersonal) {
      const userId = removePersonal.getAttribute("data-ai-sub-remove-personal");
      const name = removePersonal.getAttribute("data-name") || "this person";
      const providerId = selectedId;
      if (!userId) return;
      if (!window.confirm(`Remove ${name} from People? They will lose this ${providerLabel(providerId)} login unless they are on a workspace share.`)) return;
      void (async () => {
        try {
          const next = await api(`${personalPeopleApi(providerId)}/${encodeURIComponent(userId)}`, { method: "DELETE" });
          applyPersonalPeople(next?.people, providerId);
          render();
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not remove that person" }, data);
          render();
        }
      })();
      return;
    }
    const addPersonalBtn = e.target.closest("[data-ai-sub-add-personal-btn]");
    if (addPersonalBtn) {
      const raw = body.querySelector("[data-ai-sub-people-search], [data-ai-sub-add-personal]")?.value || personalQuery || "";
      const highlighted = personalSuggestIndex >= 0 ? personalSuggestHits[personalSuggestIndex] : null;
      if (!highlighted && !String(raw).trim()) return;
      void (async () => {
        try {
          const person = highlighted || (personalSuggestHits.length === 1 ? personalSuggestHits[0] : null);
          const result = await addPersonalPerson(person, raw);
          if (result?.status === "needs_confirm") return;
          personalQuery = "";
          personalSuggestHits = [];
          personalSuggestOpen = false;
          personalPeekPerson = null;
          applyPersonalPeople(result?.people, result?.providerId);
          await refresh();
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not add that person" }, data);
          render();
        }
      })();
      return;
    }
    const peekClose = e.target.closest("[data-ai-sub-peek-close]");
    if (peekClose) {
      peekPerson = null;
      paintPeek();
      return;
    }
    const peekProfile = e.target.closest("[data-ai-sub-peek-profile]");
    if (peekProfile && peekPerson) {
      const id = personId(peekPerson);
      const handle = personHandle(peekPerson);
      if (openProfile) {
        void openProfile({ userId: id || undefined, handle: handle || undefined });
      } else if (handle) {
        window.open(`/u/${encodeURIComponent(handle)}`, "_blank", "noopener");
      }
      return;
    }
    const peekAdd = e.target.closest("[data-ai-sub-peek-add]");
    if (peekAdd && peekPerson) {
      void (async () => {
        try {
          await invitePerson(peekPerson, selectedTeamId);
          personQuery = "";
          suggestHits = [];
          suggestOpen = false;
          await refresh();
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not add that person" }, data);
          render();
        }
      })();
      return;
    }
    const peekInvite = e.target.closest("[data-ai-sub-peek-invite]");
    if (peekInvite && peekPerson) {
      const teamId = peekInvite.getAttribute("data-ai-sub-peek-invite");
      void (async () => {
        try {
          const result = await invitePerson(peekPerson, teamId);
          const name = (teams || []).find((t) => t.id === teamId)?.name || "workspace";
          if (result?.status === "already_member") {
            peekInvite.textContent = `Already in ${name}`;
          } else if (result) {
            peekInvite.textContent = `Added to ${name}`;
            peekInvite.disabled = true;
          }
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not invite to that workspace" }, data);
          render();
        }
      })();
      return;
    }
    const suggestPick = e.target.closest("[data-ai-sub-suggest-pick]");
    if (suggestPick) {
      const idx = Number(suggestPick.getAttribute("data-ai-sub-suggest-pick"));
      const person = suggestHits[idx] || personFromEl(suggestPick);
      openPeek(person);
      return;
    }
    if (e.target.closest("[data-ai-sub-chatgpt-grant], [data-ai-sub-grant], .ai-sub-grant, [data-ai-sub-daily-limit], [data-ai-sub-personal-grant], [data-ai-sub-remove-personal]")) return;
    const personBtn = e.target.closest("[data-ai-sub-person]");
    if (personBtn && !personBtn.closest("[data-ai-sub-suggest], [data-ai-sub-personal-suggest]")) {
      const person = personFromEl(personBtn);
      if (personBtn.closest("[data-ai-sub-people-plan]")) openPlanPeek(person);
      else if (personBtn.closest("[data-ai-sub-people-personal]")) openPersonalPeek(person);
      else openPeek(person);
      return;
    }
    const createWs = e.target.closest("[data-ai-sub-create-workspace]");
    if (createWs) {
      const name = body.querySelector("[data-ai-sub-new-workspace]")?.value?.trim();
      if (!name) return;
      void (async () => {
        try {
          const created = await api("/api/teams", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          selectedTeamId = created?.team?.id || "";
          if (selectedTeamId && (data.chatgpt?.signed_in)) {
            await api(`/api/teams/${encodeURIComponent(selectedTeamId)}/chatgpt`, { method: "POST" }).catch(() => {});
          }
          creatingWorkspace = false;
          await refresh();
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not create workspace" }, data);
          render();
        }
      })();
      return;
    }
    const addPersonBtn = e.target.closest("[data-ai-sub-add-person-btn]");
    if (addPersonBtn) {
      const teamId = body.querySelector("[data-ai-sub-chatgpt-team]")?.value || selectedTeamId;
      const raw = body.querySelector("[data-ai-sub-add-person]")?.value || personQuery || "";
      const highlighted = suggestIndex >= 0 ? suggestHits[suggestIndex] : null;
      if (!highlighted && !String(raw).trim()) return;
      void (async () => {
        try {
          const person = highlighted || (suggestHits.length === 1 ? suggestHits[0] : null);
          await invitePerson(person, teamId, raw);
          personQuery = "";
          suggestHits = [];
          suggestOpen = false;
          peekPerson = null;
          await refresh();
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not add that person" }, data);
          render();
        }
      })();
      return;
    }
    const editBtn = e.target.closest("[data-ai-sub-edit]");
    if (editBtn) {
      editingId = editBtn.getAttribute("data-ai-sub-edit") || selectedId;
      render();
      return;
    }
    const login = e.target.closest("[data-ai-sub-login]");
    if (login) {
      const id = login.getAttribute("data-ai-sub-login");
      const provider = (data.providers || []).find((p) => p.id === id);
      void (async () => {
        try {
          await applyListing(await api(`/api/ai-subscriptions/${encodeURIComponent(id)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account_email: provider?.account_email || "",
              plan_label: provider?.plan_label || (id === "cursor" ? "Cursor" : provider?.label || ""),
            }),
          }));
          if (provider?.login_url) openPopup(provider.login_url, `render3d-${id}-login`);
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not save connection" }, data);
          render();
        }
      })();
      return;
    }
    const manage = e.target.closest("[data-ai-sub-manage]");
    if (manage) {
      const url = manage.getAttribute("data-url");
      if (url) window.open(url, "_blank", "noopener");
      return;
    }
    const billingTab = e.target.closest("button[data-ai-billing-tab]");
    if (billingTab && body.contains(billingTab)) {
      const tab = billingTab.getAttribute("data-ai-billing-tab") || "keys";
      applyAiBillingTab(tab);
      if (tab === "keys") openKeys?.({ tab: "keys" });
      else render();
      return;
    }
    const analyticsBtn = e.target.closest("[data-ai-billing-analytics]");
    if (analyticsBtn) {
      const scope = analyticsBtn.getAttribute("data-ai-billing-analytics") || "subscriptions";
      window.dispatchEvent(new CustomEvent("render3d:open-costs-analytics", { detail: { scope } }));
      return;
    }
    const keyBtn = e.target.closest("[data-ai-sub-key]");
    if (keyBtn) {
      const prefer = keyBtn.getAttribute("data-ai-sub-key");
      applyAiBillingTab("keys");
      openKeys?.({
        tab: "keys",
        preferProvider: prefer,
        openAdd: true,
        message: prefer === "anthropic"
          ? "Paste the Anthropic API key, then Save and Validate — same method desktop VibeCAD uses for Claude."
          : "Paste the API key, then Save and Validate — same split VibeCAD uses when you are not using a ChatGPT subscription.",
      });
      return;
    }
    const disconnect = e.target.closest("[data-ai-sub-disconnect]");
    if (disconnect) {
      const id = disconnect.getAttribute("data-ai-sub-disconnect");
      void (async () => {
        if (!window.confirm(id === "openai"
          ? "Log out of the ChatGPT subscription on this Render Studio account?"
          : id === "cloud"
            ? "Turn off studio credits for this Render Studio account?"
            : id === "cursor"
            ? "Log out of the Cursor subscription on this Render Studio account?"
            : id === "claude"
              ? "Log out of the Claude subscription on this Render Studio account?"
              : `Disconnect ${id}?`)) return;
        try {
          await applyListing(await api(`/api/ai-subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }));
          if (editingId === id) editingId = null;
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not disconnect" }, data);
          render();
        }
      })();
    }
  });

  body?.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });

  body?.addEventListener("input", (e) => {
    const search = e.target.closest("[data-ai-sub-people-search]");
    if (search) {
      peopleSearch = search.value || "";
      personalQuery = peopleSearch;
      restorePeopleSearchFocus = true;
      restorePersonalFocus = true;
      restorePersonalPos = search.selectionStart;
      if (!peopleSearch.trim()) {
        personalSuggestHits = personalLocalSuggestions("");
        personalSuggestIndex = personalSuggestHits.length ? 0 : -1;
        personalSuggestOpen = personalSuggestHits.length > 0;
        paintPersonalSuggest();
      } else {
        schedulePersonalSuggest(peopleSearch);
      }
      const list = body.querySelector("[data-ai-sub-people-personal] .ai-sub-roster-list");
      if (list) {
        const pinPlan = peopleTab === "plan" || planUsersFirst;
        const people = sortPlanUsersFirst(
          filterPeopleByQuery(personalPeople(data, selectedId), peopleSearch),
          pinPlan,
          { personal: true },
        );
        list.innerHTML = people.length
          ? people.map((m) => personalMemberRowMarkup(m, selectedId)).join("")
          : `<p class="muted small">No one matches “${esc(peopleSearch)}”.</p>`;
      }
      return;
    }
    const wsSearch = e.target.closest("[data-ai-sub-ws-search]");
    if (wsSearch && !e.target.closest("[data-ai-sub-add-person]")) {
      workspaceSearch = wsSearch.value || "";
      restoreWorkspaceSearchFocus = true;
      restoreWorkspaceSearchPos = wsSearch.selectionStart;
      render();
      return;
    }
    const planSearchField = e.target.closest("[data-ai-sub-plan-search]");
    if (planSearchField) {
      planSearch = planSearchField.value || "";
      restorePlanSearchFocus = true;
      restorePlanSearchPos = planSearchField.selectionStart;
      render();
      return;
    }
    const vrField = e.target.closest("[data-ai-sub-vr-search]");
    if (vrField) {
      vrSearch = vrField.value || "";
      restoreVrSearchFocus = true;
      restoreVrSearchPos = vrField.selectionStart;
      render();
      return;
    }
    const personalField = e.target.closest("[data-ai-sub-add-personal]");
    if (personalField) {
      personalQuery = personalField.value || "";
      restorePersonalPos = personalField.selectionStart;
      restorePersonalFocus = true;
      if (!personalQuery.trim()) {
        personalSuggestHits = personalLocalSuggestions("");
        personalSuggestIndex = personalSuggestHits.length ? 0 : -1;
        personalSuggestOpen = personalSuggestHits.length > 0;
        paintPersonalSuggest();
        return;
      }
      schedulePersonalSuggest(personalQuery);
      return;
    }
    const field = e.target.closest("[data-ai-sub-add-person]");
    if (!field) return;
    personQuery = field.value || "";
    workspaceSearch = personQuery;
    restoreAddPos = field.selectionStart;
    restoreAddFocus = true;
    if (!personQuery.trim()) {
      suggestHits = localSuggestions("");
      suggestIndex = suggestHits.length ? 0 : -1;
      suggestOpen = suggestHits.length > 0;
      paintSuggest();
      return;
    }
    scheduleSuggest(personQuery);
  });

  body?.addEventListener("focusin", (e) => {
    const personalField = e.target.closest("[data-ai-sub-add-personal], [data-ai-sub-people-search]");
    if (personalField) {
      if (!personalSuggestHits.length) {
        personalSuggestHits = personalLocalSuggestions(personalField.value || "");
        personalSuggestIndex = personalSuggestHits.length ? 0 : -1;
      }
      personalSuggestOpen = personalSuggestHits.length > 0;
      paintPersonalSuggest();
      return;
    }
    const field = e.target.closest("[data-ai-sub-add-person]");
    if (!field) return;
    if (!suggestHits.length) {
      suggestHits = localSuggestions(field.value || "");
      suggestIndex = suggestHits.length ? 0 : -1;
    }
    suggestOpen = suggestHits.length > 0;
    paintSuggest();
  });

  body?.addEventListener("keydown", (e) => {
    const personalField = e.target.closest("[data-ai-sub-add-personal], [data-ai-sub-people-search]");
    if (personalField) {
      if (e.key === "ArrowDown" && personalSuggestHits.length) {
        e.preventDefault();
        personalSuggestOpen = true;
        personalSuggestIndex = (personalSuggestIndex + 1) % personalSuggestHits.length;
        paintPersonalSuggest();
        return;
      }
      if (e.key === "ArrowUp" && personalSuggestHits.length) {
        e.preventDefault();
        personalSuggestOpen = true;
        personalSuggestIndex = personalSuggestIndex <= 0 ? personalSuggestHits.length - 1 : personalSuggestIndex - 1;
        paintPersonalSuggest();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (personalSuggestOpen && personalSuggestIndex >= 0 && personalSuggestHits[personalSuggestIndex]) {
          openPersonalPeek(personalSuggestHits[personalSuggestIndex]);
          return;
        }
        body.querySelector("[data-ai-sub-add-personal-btn]")?.click();
      }
      return;
    }
    const field = e.target.closest("[data-ai-sub-add-person]");
    if (!field) return;
    if (e.key === "ArrowDown" && suggestHits.length) {
      e.preventDefault();
      suggestOpen = true;
      suggestIndex = (suggestIndex + 1) % suggestHits.length;
      paintSuggest();
      return;
    }
    if (e.key === "ArrowUp" && suggestHits.length) {
      e.preventDefault();
      suggestOpen = true;
      suggestIndex = suggestIndex <= 0 ? suggestHits.length - 1 : suggestIndex - 1;
      paintSuggest();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestOpen && suggestIndex >= 0 && suggestHits[suggestIndex]) {
        openPeek(suggestHits[suggestIndex]);
        return;
      }
      body.querySelector("[data-ai-sub-add-person-btn]")?.click();
    }
  });

  body?.addEventListener("change", (e) => {
    const weeklyPref = e.target.closest("[data-ai-sub-weekly-usage]");
    if (weeklyPref) {
      writeShowWeeklyUsagePref(!!weeklyPref.checked);
      return;
    }
    const scopeSel = e.target.closest("[data-ai-sub-people-scope]");
    if (scopeSel) {
      peopleScope = scopeSel.value === "team" ? "team" : "workspace";
      render();
      return;
    }
    const vrScopeSel = e.target.closest("[data-ai-sub-vr-scope]");
    if (vrScopeSel) {
      vrScope = vrScopeSel.value === "team" ? "team" : "workspace";
      render();
      return;
    }
    const teamSel = e.target.closest("[data-ai-sub-chatgpt-team]");
    if (teamSel) {
      selectedTeamId = teamSel.value || "";
      void loadSelectedWorkspace().then(() => render());
      return;
    }
    const dailyLimit = e.target.closest("[data-ai-sub-daily-limit]");
    if (dailyLimit) {
      const kind = dailyLimit.getAttribute("data-ai-sub-daily-limit");
      const providerId = selectedId;
      const userId = dailyLimit.getAttribute("data-user-id");
      const raw = String(dailyLimit.value || "").trim();
      let value = null;
      if (raw) {
        value = Number(raw);
        if (!Number.isFinite(value) || value < 0) {
          data = mergeListing({ loadError: "Daily limit must be a number" }, data);
          render();
          return;
        }
      }
      void (async () => {
        try {
          if (kind === "personal") {
            const next = await api(`${personalPeopleApi(providerId)}/${encodeURIComponent(userId)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ daily_limit_usd: value }),
            });
            applyPersonalPeople(next?.people, providerId);
            render();
            return;
          }
          const teamId = dailyLimit.getAttribute("data-ai-sub-grant");
          const shareId = dailyLimit.getAttribute("data-share-id");
          const pid = dailyLimit.getAttribute("data-provider") || "openai";
          if (!teamId || !shareId || !userId) return;
          const next = await api(
            `${shareApiBase(pid, teamId)}/${encodeURIComponent(shareId)}/members/${encodeURIComponent(userId)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ daily_limit_usd: value }),
            },
          );
          shareMembers = { ...shareMembers, [shareId]: next.members || [] };
          render();
        } catch (err) {
          data = mergeListing({ loadError: err.message || "Could not save daily limit" }, data);
          render();
        }
      })();
      return;
    }
    const personalGrant = e.target.closest("[data-ai-sub-personal-grant]");
    if (personalGrant) {
      const userId = personalGrant.getAttribute("data-ai-sub-personal-grant");
      const providerId = selectedId;
      const granted = !!personalGrant.checked;
      if (!userId) return;
      void (async () => {
        try {
          const next = await api(`${personalPeopleApi(providerId)}/${encodeURIComponent(userId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ granted }),
          });
          applyPersonalPeople(next?.people, providerId);
          render();
        } catch (err) {
          personalGrant.checked = !granted;
          data = mergeListing({ loadError: err.message || "Could not update access" }, data);
          render();
        }
      })();
      return;
    }
    const grant = e.target.closest("[data-ai-sub-grant], [data-ai-sub-chatgpt-grant]");
    if (!grant || grant.disabled) return;
    const teamId = grant.getAttribute("data-ai-sub-grant") || grant.getAttribute("data-ai-sub-chatgpt-grant");
    const shareId = grant.getAttribute("data-share-id");
    const userId = grant.getAttribute("data-user-id");
    const pid = grant.getAttribute("data-provider") || "openai";
    if (!teamId || !shareId || !userId) return;
    const granted = !!grant.checked;
    void (async () => {
      try {
        const next = await api(
          `${shareApiBase(pid, teamId)}/${encodeURIComponent(shareId)}/members/${encodeURIComponent(userId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ granted }),
          },
        );
        shareMembers = { ...shareMembers, [shareId]: next.members || [] };
        render();
      } catch (err) {
        grant.checked = !granted;
        data = mergeListing({ loadError: err.message || "Could not update access" }, data);
        render();
      }
    })();
  });

  body?.addEventListener("submit", (e) => {
    const codeForm = e.target.closest("[data-ai-sub-claude-code]");
    if (codeForm) {
      e.preventDefault();
      submitClaudeCode(codeForm);
      return;
    }
    const form = e.target.closest("[data-ai-sub-save]");
    if (!form) return;
    e.preventDefault();
    const id = form.getAttribute("data-ai-sub-save");
    const email = String(form.email?.value || "").trim();
    const plan = String(form.plan?.value || "").trim();
    void (async () => {
      try {
        await applyListing(await api(`/api/ai-subscriptions/${encodeURIComponent(id)}`, {
          method: "POST",
          body: JSON.stringify({ account_email: email, plan_label: plan }),
        }));
        editingId = null;
      } catch (err) {
        data = mergeListing({ loadError: err.message || "Could not save connection" }, data);
        render();
      }
    })();
  });

  window.addEventListener("render3d:xr-permissions", () => { void refresh(); });
  window.addEventListener("render3d:ai-billing-tab", (e) => {
    const tab = e.detail?.tab || "subscriptions";
    applyAiBillingTab(tab, { costs: e.detail?.costs });
    if (tab === "subscriptions") {
      render();
      void refresh();
    }
  });

  let vrMenu = null;
  function hideVrMenu() {
    vrMenu?.remove();
    vrMenu = null;
  }
  body?.addEventListener("contextmenu", (e) => {
    const row = e.target.closest("[data-ai-sub-vr-row]");
    if (!row || !body.contains(row)) return;
    e.preventDefault();
    hideVrMenu();
    const person = personFromEl(row);
    const granted = !!row.querySelector("[data-ai-sub-grant]")?.checked;
    const teamId = row.getAttribute("data-team-id") || selectedTeamId;
    vrMenu = document.createElement("div");
    vrMenu.className = "ai-sub-ctx-menu";
    vrMenu.innerHTML = `
      <button type="button" data-vr-act="profile">View profile</button>
      <button type="button" data-vr-act="toggle">${granted ? "Remove VR access" : "Grant VR access"}</button>
      <button type="button" data-vr-act="remove">Remove from share</button>
      <button type="button" data-vr-act="invite">Add to another workspace</button>
    `;
    vrMenu.style.left = `${e.clientX}px`;
    vrMenu.style.top = `${e.clientY}px`;
    document.body.appendChild(vrMenu);
    vrMenu.addEventListener("click", (ev) => {
      const act = ev.target.closest("[data-vr-act]")?.getAttribute("data-vr-act");
      hideVrMenu();
      if (act === "profile") {
        const id = personId(person);
        const handle = personHandle(person);
        if (openProfile) void openProfile({ userId: id || undefined, handle: handle || undefined });
        return;
      }
      if (act === "toggle") {
        const grant = row.querySelector("[data-ai-sub-grant]");
        if (grant && !grant.disabled) {
          grant.checked = !grant.checked;
          grant.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
      if (act === "remove") {
        const grant = row.querySelector("[data-ai-sub-grant]");
        if (grant?.checked) {
          grant.checked = false;
          grant.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
      if (act === "invite") {
        peekPerson = person;
        selectedTeamId = teamId || selectedTeamId;
        paintPeek();
      }
    });
  });
  document.addEventListener("click", hideVrMenu);

  return { refresh, open: openModal, render };
}
