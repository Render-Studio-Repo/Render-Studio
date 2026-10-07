/** Shared marketplace navigation; actions reuse existing account and community APIs. */
import { getStoredUser, getToken } from "../studio/auth.js?v=20260914-forgot-pw-sblogin2-loginlog1-loginfix1";
import { ensureMarketplaceTopbarStyles, escapeMarketplaceHtml as esc, safeMarketplaceImage, openMarketplaceDiscovery, marketplaceApi } from "./marketplace-discovery.js?v=20260928-hey-ai-summary1";

const ICONS = {
  settings: '<path d="M9 3H5a2 2 0 0 0-2 2v4m18 0V5a2 2 0 0 0-2-2h-4m0 18h4a2 2 0 0 0 2-2v-4M3 15v4a2 2 0 0 0 2 2h4"/><circle cx="12" cy="12" r="4"/>',
  suggestions: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3Z"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H6l-4 3V9a7 7 0 0 1 7-7h4a8 8 0 0 1 8 9Z"/><path d="M7 8h10M7 12h7"/>',
  social: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m2 11v-3a6 6 0 0 0-3-5"/>',
  agent: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
let feedback = null;
let social = null;

async function openSignIn() {
  // Reuse the shared account modal and its existing OAuth/password behavior.
  await import("../site/docs-agent.js?v=20261006-designchat-hey-ai1");
  document.getElementById("btn-auth")?.click();
}

export async function openMarketplaceChat(options = {}) {
  if (!getToken()) return openSignIn();
  const { openMarketplaceMessages } = await import("./marketplace-messages.js?v=20260928-marketplace-dm1");
  return openMarketplaceMessages(options);
}

export async function openMarketplaceSocial({ api = marketplaceApi } = {}) {
  if (!getToken()) return openSignIn();
  ensureMarketplaceTopbarStyles();
  if (!social) {
    social = document.createElement("dialog");
    social.className = "mkt-community-dialog mkt-social-dialog";
    social.setAttribute("aria-labelledby", "mkt-social-title");
    social.innerHTML = '<header><div><span class="mkt-discovery-eyebrow">Your community</span><h2 id="mkt-social-title">Social</h2></div><button type="button" data-close aria-label="Close Social">×</button></header><div data-social-content role="status"></div>';
    social.querySelector("[data-close]").onclick = () => social.close();
    document.body.append(social);
  }
  if (!social.open) social.showModal();
  const content = social.querySelector("[data-social-content]");
  content.textContent = "Loading your community…";
  try {
    const data = await api("/api/social/hub");
    content.innerHTML = `<p class="mkt-discovery-lead">${Number(data.online_count || 0)} people online · Open a profile to see their work or send a message.</p><div class="mkt-social-people">${(data.people || []).map(person => {
      const handle = String(person.handle || "").replace(/^@/, "");
      const img = safeMarketplaceImage(person.avatar_url);
      return `<article class="mkt-social-person">${img ? `<img src="${esc(img)}" alt=""/>` : `<span class="mkt-social-avatar">${esc(String(person.display_name || person.name || "?").charAt(0))}</span>`}<div><strong>${esc(person.display_name || person.name || handle || "Render creator")}</strong><small>${person.online ? "Online" : "Offline"}</small></div>${handle ? `<a href="/u/${encodeURIComponent(handle)}">View profile</a>` : ""}${person.id && person.id !== getStoredUser()?.id ? `<button type="button" data-message="${esc(person.id)}">Message</button>` : ""}</article>`;
    }).join("") || '<p class="mkt-discovery-empty">Your connections will appear here as you join workspaces and meet creators.</p>'}</div>${(data.workspaces || []).length ? `<h3>Your workspaces</h3><div class="mkt-social-workspaces">${data.workspaces.map(workspace => `<a href="/">${esc(workspace.name || "Workspace")} <span aria-hidden="true">↗</span></a>`).join("")}</div>` : ""}<p><a class="mkt-discovery-view" href="/">Open Studio social tools ↗</a></p>`;
    content.querySelectorAll("[data-message]").forEach(button => { button.onclick = () => {
      const recipient = data.people.find(person => String(person.id) === button.dataset.message);
      social.close();
      void openMarketplaceChat({ recipient });
    }; });
  } catch (error) { content.textContent = error.message || "Could not load your community."; }
  return social;
}

export function mountMarketplaceTopbar({ host = document.querySelector("header.toolbar"), onStoreSettings, agentContext = null } = {}) {
  if (!host) return null;
  ensureMarketplaceTopbarStyles();
  if (host.querySelector(".mkt-topbar-actions")) return host.querySelector(".mkt-topbar-actions");
  host.classList.add("mkt-topbar");
  document.body.classList.add("mkt-topbar-page");
  const actions = document.createElement("nav");
  actions.className = "mkt-topbar-actions";
  actions.setAttribute("aria-label", "Marketplace account and community");
  actions.innerHTML = `<a href="/marketplace.html#/sell" class="mkt-topbar-action" data-action="settings" title="Profile and store settings">${icon("settings")}<span>Profile &amp; Store</span></a><button type="button" class="mkt-topbar-action" data-action="suggestions" title="Suggestions">${icon("suggestions")}<span>Suggestions</span></button><button type="button" class="mkt-topbar-action" data-action="chat" title="Chat">${icon("chat")}<span>Chat</span></button><button type="button" class="mkt-topbar-action" data-action="social" title="Social">${icon("social")}<span>Social</span></button><button type="button" class="mkt-topbar-action mkt-topbar-agent" data-action="agent" title="Render Agent">${icon("agent")}<span>Render Agent</span></button><details class="mkt-topbar-profile"><summary title="Your profile" aria-label="Your profile">${icon("profile")}</summary><div class="mkt-topbar-profile-menu" data-profile-menu></div></details>`;
  host.append(actions);
  if (onStoreSettings) actions.querySelector('[data-action="settings"]').onclick = event => { event.preventDefault(); onStoreSettings(); };
  actions.querySelector('[data-action="agent"]').onclick = () => openMarketplaceDiscovery({ context: typeof agentContext === "function" ? agentContext() : agentContext });
  actions.querySelector('[data-action="suggestions"]').onclick = async () => {
    try {
      if (!feedback) {
        const { createFeedbackUI } = await import("../components/feedback-ui.js?v=20260915-marketplace3&leakfix78");
        feedback = createFeedbackUI({});
      }
      feedback.open("suggestion");
    } catch (error) { alert(error.message || "Suggestions are temporarily unavailable."); }
  };
  actions.querySelector('[data-action="chat"]').onclick = () => void openMarketplaceChat();
  actions.querySelector('[data-action="social"]').onclick = () => void openMarketplaceSocial();
  const profile = actions.querySelector("details");
  function updateProfile() {
    const user = getStoredUser();
    const menu = actions.querySelector("[data-profile-menu]");
    const handle = String(user?.handle || "").replace(/^@/, "");
    const summary = profile.querySelector("summary");
    const avatar = safeMarketplaceImage(user?.avatar_url);
    summary.innerHTML = avatar ? `<img src="${esc(avatar)}" alt="Your profile"/>` : icon("profile");
    menu.innerHTML = user && getToken() ? `<strong>${esc(user.display_name || user.name || handle || "Your account")}</strong>${handle ? `<a href="/u/${encodeURIComponent(handle)}">View public profile</a>` : '<a href="/marketplace.html#/sell">Set up your profile</a>'}<a href="/marketplace.html#/sell">Profile &amp; Store settings</a><a href="/marketplace.html#/purchases">Purchases & downloads</a><a href="/marketplace.html#/orders">Seller orders</a><a href="/">Open Render Studio</a>` : '<strong>Your Render account</strong><p>Sign in to save purchases and manage your store.</p><button type="button" data-sign-in>Sign in / Create account</button>';
    menu.querySelector("[data-sign-in]")?.addEventListener("click", () => { profile.open = false; void openSignIn(); });
  }
  profile.addEventListener("toggle", () => { if (profile.open) updateProfile(); });
  document.addEventListener("click", event => { if (!profile.contains(event.target)) profile.open = false; });
  document.addEventListener("keydown", event => { if (event.key === "Escape") profile.open = false; });
  window.addEventListener("storage", updateProfile);
  updateProfile();
  return actions;
}
