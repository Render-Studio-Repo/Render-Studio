/** Render Agent marketplace discovery. Every result comes from the public catalog. */
import { authHeaders } from "../studio/auth.js?v=20260914-forgot-pw-sblogin2-loginlog1-loginfix1";

export function isMarketplaceSearchQuestion(message) {
  const text = String(message || "").trim();
  const seeking = /\b(find|search|look(?:ing)?\s+for|recommend|similar|shop|buy|browse|show\s+me)\b/i.test(text);
  const target = /\b(marketplace|market\s+place|store|listing|product|model|models|assets?|skills?|agents?|knowledge\s+packs?)\b/i.test(text);
  const editing = /\b(create|generate|build|edit|change|fix|enable|install|publish|sell|upload)\b/i.test(text);
  if (!/\b(marketplace|market\s+place|store|listing|product)\b/i.test(text) && /\b(settings?|preferences?|button|menu|errors?|debug)\b/i.test(text)) return false;
  return seeking && target && (!editing || /\b(marketplace|market\s+place|store|listing|product)\b/i.test(text));
}

export function escapeMarketplaceHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function safeMarketplaceImage(value) {
  const raw = String(value || "");
  if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(raw)) return raw;
  try {
    const url = new URL(raw, "https://render3d.app");
    return raw && ["https:", "http:"].includes(url.protocol) ? raw : "";
  } catch { return ""; }
}

export function marketplaceSpeechRecognitionCtor(scope = globalThis) {
  return scope?.SpeechRecognition || scope?.webkitSpeechRecognition || null;
}

export function marketplaceProductHref(item) {
  if (!["model", "agent", "knowledge"].includes(item?.kind) || !item?.id) return "";
  // Rebuild the local route from identifiers instead of trusting a listing URL.
  const provided = String(item.href || "");
  const prefix = `/marketplace.html#/p/${item.kind}/`;
  if (provided.startsWith(prefix) && !/[\s<>"']/.test(provided.slice(prefix.length))) return provided;
  return `${prefix}${encodeURIComponent(item.slug || item.id)}`;
}

function money(item) {
  if (item.access_mode === "view_only") return "View only";
  if (!Number(item.price_cents) && item.access_mode !== "paid") return "Free";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: item.currency || "USD" }).format(Number(item.price_cents || 0) / 100); }
  catch { return `${(Number(item.price_cents || 0) / 100).toFixed(2)} ${String(item.currency || "USD").toUpperCase()}`; }
}

export function discoveryCardsHtml(payload) {
  const esc = escapeMarketplaceHtml;
  if (payload?.disabled) return `<p class="mkt-discovery-empty">This marketplace is currently unavailable.</p>`;
  if (payload?.login_required) return `<p class="mkt-discovery-empty">Sign in to browse this marketplace.</p>`;
  const listings = (Array.isArray(payload?.listings) ? payload.listings : []).filter(item => marketplaceProductHref(item));
  if (!listings.length) return `<div class="mkt-discovery-empty"><strong>No matching listings yet</strong><p>Try the part name, a different category, or fewer details. Render Agent only shows products that are in the marketplace.</p></div>`;
  return `<div class="mkt-discovery-results">${listings.map(item => {
    const thumbnail = safeMarketplaceImage(item.thumbnail_url);
    return `<article class="mkt-discovery-result"><a class="mkt-discovery-image" href="${esc(marketplaceProductHref(item))}">${thumbnail ? `<img src="${esc(thumbnail)}" alt="" loading="lazy"/>` : `<span aria-hidden="true">${item.kind === "model" ? "◇" : "⌘"}</span>`}</a><div><span class="mkt-discovery-kind">${esc(item.kind === "knowledge" ? "Knowledge & skills" : item.kind === "agent" ? "Agent" : "3D model")}</span><h3><a href="${esc(marketplaceProductHref(item))}">${esc(item.name)}</a></h3><p>${esc(item.description)}</p>${item.matched_terms?.length ? `<small>Matches: ${esc(item.matched_terms.join(", "))}</small>` : ""}<div class="mkt-discovery-result-actions">${payload.show_prices !== false ? `<strong>${esc(money(item))}</strong>` : ""}<a class="mkt-discovery-view" href="${esc(marketplaceProductHref(item))}">View in marketplace <span aria-hidden="true">↗</span></a></div></div></article>`;
  }).join("")}</div>`;
}

export function ensureMarketplaceTopbarStyles() {
  if (!document.querySelector("link[data-marketplace-topbar]")) {
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "/marketplace/marketplace-topbar.css?v=20260915-marketplace3";
    style.dataset.marketplaceTopbar = "1";
    document.head.append(style);
  }
  // Studio tokens win over gray-teal. Colors are CSS, not the marketplace DB.
  let theme = document.querySelector("link[data-marketplace-theme]");
  if (!theme) {
    theme = document.createElement("link");
    theme.rel = "stylesheet";
    theme.href = "/marketplace/marketplace-theme.css?v=20260918-studio-theme1";
    theme.dataset.marketplaceTheme = "1";
  }
  document.head.append(theme);
}

export async function marketplaceApi(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status})`);
  return data;
}

/** Help mode prefills the existing Agent; it never submits or runs skill code. */
export async function openMarketplaceAssistant({ query = "", context = null, mode = "discover" } = {}) {
  if (mode !== "help") return openMarketplaceDiscovery({ query, context });
  if (!document.getElementById("render-agent-panel")) await import("../site/docs-agent.js?v=20261006-designchat-hey-ai1");
  const panel = document.getElementById("render-agent-panel");
  if (panel?.classList.contains("hidden")) (document.getElementById("btn-render-agent") || document.getElementById("render-agent-fab"))?.click();
  const input = document.getElementById("render-agent-input");
  if (input && query) { input.value = String(query).slice(0, 12000); input.focus(); }
  return panel;
}

let panel = null;
let request = null;
let sequence = 0;

export function openMarketplaceDiscovery({ query = "", context = null, api = marketplaceApi } = {}) {
  ensureMarketplaceTopbarStyles();
  if (!panel) {
    panel = document.createElement("dialog");
    panel.className = "mkt-discovery-dialog mkt-community-dialog";
    panel.setAttribute("aria-labelledby", "mkt-discovery-title");
    panel.innerHTML = `<header><div><span class="mkt-discovery-eyebrow">Render Agent</span><h2 id="mkt-discovery-title">Find your next building block</h2></div><button type="button" data-close aria-label="Close Render Agent">×</button></header><p class="mkt-discovery-lead">Describe what you need. I'll find matching models, skills, agents, and knowledge packs from this marketplace.</p><form><div class="mkt-discovery-search"><input type="search" name="query" aria-label="Describe a marketplace product" maxlength="600" placeholder="A robotic gripper, Arduino skills, a building kit…"/><button type="button" data-voice aria-label="Speak marketplace search" title="Speak your search">●</button><button type="submit">Find matches</button></div><label class="mkt-discovery-filter">Search in <select name="kind"><option value="">All marketplaces</option><option value="model">3D models</option><option value="skill">Skills</option><option value="agent">Agents</option><option value="knowledge">Knowledge</option></select></label></form><div class="mkt-discovery-chips"><button type="button" data-query="Find robot models">Robot models</button><button type="button" data-query="Find electronics skills">Electronics skills</button><button type="button" data-query="Find architecture models">Architecture</button></div><p data-search-status role="status"></p><div data-results></div><footer><span>Results come from live catalog descriptions.</span><a href="/marketplace.html" data-browse>Browse all</a><button type="button" data-studio-help>Ask Render Agent with Luna</button></footer>`;
    document.body.append(panel);
    panel.querySelector("[data-close]").addEventListener("click", () => panel.close());
    panel.addEventListener("click", event => { if (event.target.closest("a[href]")) panel.close(); });
    panel.addEventListener("click", event => { if (event.target === panel && (event.clientX < panel.getBoundingClientRect().left || event.clientX > panel.getBoundingClientRect().right || event.clientY < panel.getBoundingClientRect().top || event.clientY > panel.getBoundingClientRect().bottom)) panel.close(); });
    panel.addEventListener("close", () => { sequence++; request?.abort(); });
  }
  const form = panel.querySelector("form");
  const input = form.elements.query;
  input.value = String(query || context?.name || "").slice(0, 600);
  form.elements.kind.value = "";
  const status = panel.querySelector("[data-search-status]");
  const results = panel.querySelector("[data-results]");
  async function search() {
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    request?.abort();
    request = new AbortController();
    const current = ++sequence;
    status.textContent = "Searching the marketplace…";
    panel.setAttribute("aria-busy", "true");
    const params = new URLSearchParams({ q, kind: form.elements.kind.value, limit: "8" });
    try {
      const payload = await api(`/api/marketplace/discover?${params}`, { signal: request.signal });
      if (current !== sequence) return;
      results.innerHTML = discoveryCardsHtml(payload);
      results.querySelectorAll("img").forEach(img => img.addEventListener("error", () => img.remove()));
      const count = payload.listings?.length || 0;
      status.textContent = payload.disabled ? "Marketplace unavailable" : payload.login_required ? "Sign in required" : `${count} matching ${count === 1 ? "listing" : "listings"}`;
      panel.querySelector("[data-browse]").href = `/marketplace.html?q=${encodeURIComponent(q)}`;
    } catch (error) {
      if (current !== sequence || error.name === "AbortError") return;
      status.textContent = error.message || "Marketplace search is unavailable. Try again.";
      results.replaceChildren();
    } finally { if (current === sequence) panel.removeAttribute("aria-busy"); }
  }
  form.onsubmit = event => { event.preventDefault(); void search(); };
  const voiceButton = form.querySelector("[data-voice]");
  const VoiceRecognition = marketplaceSpeechRecognitionCtor();
  if (!VoiceRecognition) voiceButton.hidden = true;
  else voiceButton.onclick = () => {
    const recognition = new VoiceRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { voiceButton.classList.add("is-listening"); status.textContent = "Listening…"; };
    recognition.onend = () => voiceButton.classList.remove("is-listening");
    recognition.onerror = () => { status.textContent = "Voice search could not hear you. Type your search and try again."; };
    recognition.onresult = event => {
      input.value = String(event.results?.[0]?.[0]?.transcript || "").slice(0, 600);
      if (input.value) void search();
    };
    recognition.start();
  };
  panel.querySelectorAll("[data-query]").forEach(button => { button.onclick = () => { input.value = button.dataset.query; void search(); }; });
  panel.querySelector("[data-studio-help]").onclick = async () => {
    panel.close();
    await openMarketplaceAssistant({ mode: "help" });
  };
  if (!panel.open) panel.showModal();
  input.focus();
  if (input.value) void search();
  else { results.replaceChildren(); status.textContent = ""; panel.removeAttribute("aria-busy"); }
  return panel;
}
