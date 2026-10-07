/** Render complete categorized feature documentation on /docs.html */

import { DOC_CATEGORIES, DOC_FEATURES } from "./docs-features.js?v=20261006-jake-parity1";
import { enhanceDocsGifs } from "./docs-gif-expand.js?v=20260715-gif-expand";
import {
  applyOverrides,
  heroFields,
  heroFromForm,
  loadSitePages,
  openCmsEditor,
  pencilHtml,
  saveSitePages,
  setBannerImage,
  setHeroText,
  templateFields,
  templateFromForm,
} from "../admin/site-pages-cms.js?v=20260908-site-cms";

let cmsPages = {};
let cmsCanEdit = false;
let searchBound = false;
let hashBound = false;
let cachedAgentApps = null;
let cachedAgentError = "";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function priceLabel(app) {
  if (app.premium && !app.price_cents) return "Premium";
  if (!Number(app.price_cents || 0)) return "Free";
  return `${(Number(app.price_cents || 0) / 100).toLocaleString(undefined, {
    style: "currency",
    currency: app.currency || "USD",
  })}`;
}

function categoryFor(app) {
  return String(app.category || app.app_type || "Agent Apps").trim() || "Agent Apps";
}

function appIcon(app) {
  const category = categoryFor(app).toLowerCase();
  if (category.includes("mold")) return "MO";
  if (category.includes("robot")) return "RB";
  if (category.includes("source")) return "SO";
  if (category.includes("connect")) return "CN";
  if (category.includes("cad")) return "CAD";
  if (app.app_type === "script") return "JS";
  if (app.app_type === "workflow") return "WF";
  return "AI";
}

function ownerLabel(app) {
  return app.owner?.name || app.owner?.email || "Render Studio creator";
}

const RELATED_TERMS = {
  bambu: ["3mf", "printer", "print", "export", "plate"],
  fusion: ["autodesk", "cloud", "step", "import", "export", "sync"],
  onshape: ["cloud", "step", "import", "export", "sync"],
  robot: ["rigging", "urdf", "srdf", "motion", "joints"],
  delete: ["right click", "context menu", "remove", "object"],
  share: ["remix", "public", "folder", "workspace", "collaboration"],
  prompt: ["ai", "generate", "agent", "reference", "component"],
  drawing: ["dxf", "sketch", "canvas", "markup"],
};

function queryTokens(query) {
  const base = String(query || "").toLowerCase().match(/[a-z0-9.#+-]+/g) || [];
  const expanded = [...base];
  for (const token of base) {
    for (const [key, terms] of Object.entries(RELATED_TERMS)) {
      if (token.includes(key) || key.includes(token)) expanded.push(...terms);
    }
  }
  return [...new Set(expanded.filter((token) => token.length > 1))];
}

function matchScore(text, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return 1;
  const hay = String(text || "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token)) score += 2;
    else if (token.length > 3 && hay.includes(token.slice(0, -1))) score += 1;
  }
  return score;
}

function featureSearchText(feature) {
  return [
    feature.id,
    feature.category,
    feature.title,
    feature.summary,
    feature.where,
    feature.ask,
    ...(feature.steps || []),
    ...(feature.keywords || []),
  ].filter(Boolean).join(" ");
}

const searchStreakTimers = new WeakMap();

function triggerSearchStreak(input) {
  const shell = input?.closest?.(".docs-topic-search, .docs-catalog-filter");
  if (!shell) return;
  shell.classList.remove("is-searching");
  void shell.offsetWidth;
  shell.classList.add("is-searching");
  window.clearTimeout(searchStreakTimers.get(shell));
  searchStreakTimers.set(shell, window.setTimeout(() => shell.classList.remove("is-searching"), 1000));
}

const CATEGORY_THUMBS = {
  "ai-cad": `<svg class="docs-cat-thumb-svg" viewBox="0 0 72 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M36 8l22 12v16L36 48 14 36V20z"/><path d="M36 8v16L14 36M36 24l22 12"/><path d="M28 30h10l-2 8"/></g></svg>`,
  projects: `<svg class="docs-cat-thumb-svg" viewBox="0 0 72 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M16 20h12l4 4h24v18H16z"/><path d="M20 20v-4h10l3 4"/><path d="M44 14l10 4-4 10"/><circle cx="50" cy="18" r="6"/></g></svg>`,
  modeling: `<svg class="docs-cat-thumb-svg" viewBox="0 0 72 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M36 10l16 9v18L36 46 20 37V19z"/><path d="M36 28V10M36 28l16 9M36 28L20 37"/><circle cx="36" cy="28" r="3"/></g></svg>`,
  "sketch-canvas": `<svg class="docs-cat-thumb-svg" viewBox="0 0 72 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><rect x="14" y="12" width="32" height="32" rx="3"/><path d="M20 20h20M20 26h16M20 32h12"/><path d="M42 34l8-22 6 2-8 22-4 1z"/></g></svg>`,
  rigging: `<svg class="docs-cat-thumb-svg" viewBox="0 0 72 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><circle cx="24" cy="16" r="6"/><circle cx="50" cy="40" r="6"/><path d="M28 20l18 16"/><path d="M22 22l-8 14M50 34l8-10"/></g></svg>`,
  robotics: `<svg class="docs-cat-thumb-svg" viewBox="0 0 72 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><rect x="28" y="40" width="20" height="6" rx="1"/><path d="M38 40V18"/><path d="M38 22h16l4 8"/><rect x="54" y="28" width="8" height="10" rx="1"/><circle cx="38" cy="16" r="4"/><path d="M32 16H22l-4 8"/></g></svg>`,
  wiring: `<svg class="docs-cat-thumb-svg" viewBox="0 0 72 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="12" y="14" width="48" height="28" rx="3"/><circle cx="22" cy="24" r="1.6" fill="currentColor" stroke="none"/><circle cx="30" cy="24" r="1.6" fill="currentColor" stroke="none"/><circle cx="38" cy="24" r="1.6" fill="currentColor" stroke="none"/><circle cx="46" cy="24" r="1.6" fill="currentColor" stroke="none"/><circle cx="22" cy="32" r="1.6" fill="currentColor" stroke="none"/><circle cx="30" cy="32" r="1.6" fill="currentColor" stroke="none"/><circle cx="38" cy="32" r="1.6" fill="currentColor" stroke="none"/><circle cx="46" cy="32" r="1.6" fill="currentColor" stroke="none"/><path d="M22 24c8 0 8 8 16 8"/></g></svg>`,
  cloud: `<svg class="docs-cat-thumb-svg" viewBox="0 0 72 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M22 38h28a10 10 0 00-1-20 14 14 0 00-26 6 8 8 0 00-1 14z"/><path d="M32 24v-8m0 0l-4 4m4-4l4 4M42 40v8m0 0l-4-4m4 4l4-4"/></g></svg>`,
  architect: `<svg class="docs-cat-thumb-svg" viewBox="0 0 72 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 44V24l24-12 24 12v20"/><path d="M28 44V32h16v12"/><path d="M20 28h8M44 28h8M36 12v8"/></g></svg>`,
  help: `<svg class="docs-cat-thumb-svg" viewBox="0 0 72 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M22 28c0-8 6-14 14-14s14 6 14 14v6c0 3-2 6-6 6h-4"/><path d="M22 30h-4c-2 0-4 2-4 4v2c0 4 4 8 10 8h4"/><circle cx="30" cy="28" r="1.6" fill="currentColor" stroke="none"/><circle cx="42" cy="28" r="1.6" fill="currentColor" stroke="none"/></g></svg>`,
  "agent-store": `<svg class="docs-cat-thumb-svg" viewBox="0 0 72 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M36 8l4 12 12 4-12 4-4 12-4-12-12-4 12-4z"/><path d="M54 32l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></g></svg>`,
};

export function catalogViewFromHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw || raw === "complete-docs") return { mode: "grid" };
  if (raw === "agent-store-docs" || raw === "agent-store" || raw === "cat-agent-store") {
    return { mode: "category", id: "agent-store" };
  }
  if (raw === "robotics-configuration" || raw === "cat-robotics") {
    return { mode: "category", id: "robotics" };
  }
  if (raw.startsWith("cat-")) {
    const id = raw.slice(4);
    if (DOC_CATEGORIES.some((cat) => cat.id === id)) return { mode: "category", id };
  }
  if (raw.startsWith("doc-")) {
    const featureId = raw.slice(4);
    const feature = DOC_FEATURES.find((item) => item.id === featureId);
    if (feature) return { mode: "category", id: feature.category, featureId };
  }
  return { mode: "grid" };
}

export function isCatalogHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw || raw === "complete-docs") return true;
  if (raw === "agent-store-docs" || raw === "agent-store" || raw === "robotics-configuration") return true;
  if (raw.startsWith("cat-") || raw.startsWith("doc-")) return true;
  return false;
}

function featureCard(feature) {
  const steps = feature.steps || [];
  const shown = steps.slice(0, 4);
  const more = steps.length - shown.length;
  const gif = feature.gif
    ? `<div class="docs-feature-gif-wrap">
         <img class="docs-feature-gif" src="${esc(feature.gif)}" alt="" loading="lazy" />
       </div>`
    : `<div class="docs-feature-gif-wrap docs-feature-gif-wrap--empty" aria-hidden="true"></div>`;
  return `
    <article class="docs-feature-card" id="doc-${esc(feature.id)}" data-doc-text="${esc(featureSearchText(feature).toLowerCase())}">
      ${cmsCanEdit ? pencilHtml("docs-feature", feature.id) : ""}
      ${gif}
      <div class="docs-feature-body">
        <h4>${esc(feature.title)}</h4>
        <p class="docs-feature-summary">${esc(feature.summary)}</p>
        ${feature.where ? `<p class="docs-feature-where"><span>Where</span> ${esc(feature.where)}</p>` : ""}
        <ol class="docs-feature-steps">
          ${shown.map((step) => `<li>${esc(step)}</li>`).join("")}
        </ol>
        ${more > 0 ? `<p class="docs-feature-more muted small">+${more} more step${more === 1 ? "" : "s"}</p>` : ""}
        ${feature.ask ? `<p class="docs-feature-ask muted small">Ask Agent: ${esc(feature.ask)}</p>` : ""}
        ${feature.showMe ? `<p class="docs-feature-actions"><a class="btn secondary btn-compact" href="/?designTab=ROBOTICS&amp;showMe=${esc(feature.showMe)}">Show me</a></p>` : ""}
      </div>
    </article>
  `;
}

function catalogRows() {
  const features = applyOverrides(DOC_FEATURES, cmsPages?.docs?.features);
  return DOC_CATEGORIES.map((cat) => ({
    ...cat,
    features: features.filter((item) => item.category === cat.id),
  })).filter((row) => row.features.length || row.id === "agent-store");
}

function categoryThumb(id) {
  return CATEGORY_THUMBS[id] || CATEGORY_THUMBS.help;
}

function countLabel(row) {
  const n = row.features.length;
  if (row.id === "agent-store") {
    return n ? `${n} how-to${n === 1 ? "" : "s"} · public agents` : "Public agents";
  }
  return `${n} how-to${n === 1 ? "" : "s"}`;
}

function bindGifs(host) {
  host.querySelectorAll(".docs-feature-gif").forEach((img) => {
    img.addEventListener("error", () => {
      const wrap = img.closest(".docs-feature-gif-wrap");
      if (wrap) {
        wrap.classList.add("docs-feature-gif-wrap--empty");
        wrap.innerHTML = "";
      }
    });
  });
  enhanceDocsGifs(host);
}

function currentQuery() {
  return String(document.getElementById("docs-topic-search")?.value || "").trim();
}

function setSearchStatus(text) {
  const status = document.getElementById("docs-topic-search-status");
  if (status) status.textContent = text;
}

function landingGridHtml(rows) {
  const featureCount = rows.reduce((sum, row) => sum + row.features.length, 0);
  return `
    <div class="docs-catalog-landing">
      <p class="docs-catalog-count muted small">${featureCount} how-tos across ${rows.length} categories</p>
      <nav class="docs-category-grid" id="docs-category-grid" aria-label="Documentation categories">
        ${rows.map((row) => `
          <a class="docs-cat-card" href="#cat-${esc(row.id)}" data-docs-cat="${esc(row.id)}">
            <span class="docs-cat-card-thumb docs-cat-card-thumb--${esc(row.id)}" aria-hidden="true">${categoryThumb(row.id)}</span>
            <span class="docs-cat-card-copy">
              <strong>${esc(row.title)}</strong>
              <span class="docs-cat-card-blurb">${esc(row.blurb || "")}</span>
              <span class="docs-cat-card-count">${esc(countLabel(row))}</span>
            </span>
          </a>
        `).join("")}
      </nav>
    </div>
  `;
}

function categoryViewHtml(row) {
  const alias = row.id === "agent-store" ? `<span id="agent-store-docs" hidden></span>` : "";
  const listing = row.id === "agent-store"
    ? `<div class="agent-docs-head">
         <div>
           <p class="info-eyebrow">Public listings</p>
           <h4>Approved community agents</h4>
           <p class="muted">Search published agent docs by name, category, and setup requirements.</p>
         </div>
         <a class="btn secondary" href="/agent-store.html">Open Agent Store</a>
       </div>
       <div id="agent-docs" class="agent-docs" aria-live="polite">
         <p class="muted">Loading public agent documentation…</p>
       </div>`
    : "";
  return `
    <div class="docs-catalog-category-view">
      ${alias}
      <a class="docs-catalog-back" href="#complete-docs">← All categories</a>
      <section class="docs-category" id="cat-${esc(row.id)}">
        <header class="docs-category-head docs-category-head--view">
          <span class="docs-cat-card-thumb docs-cat-card-thumb--${esc(row.id)}" aria-hidden="true">${categoryThumb(row.id)}</span>
          <div>
            <h3>${esc(row.title)}</h3>
            <p class="muted">${esc(row.blurb || "")}</p>
          </div>
        </header>
        ${row.features.length ? `<div class="docs-feature-grid">${row.features.map((f) => featureCard(f)).join("")}</div>` : ""}
        ${listing}
      </section>
    </div>
  `;
}

function searchResultsHtml(query, rows) {
  const matched = rows
    .map((row) => ({
      ...row,
      features: row.features
        .map((feature) => ({ feature, score: matchScore(featureSearchText(feature), query) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.feature),
    }))
    .filter((row) => row.features.length);
  const count = matched.reduce((sum, row) => sum + row.features.length, 0);
  if (!count) {
    return `
      <div class="docs-catalog-search-results">
        <a class="docs-catalog-back" href="#complete-docs">← All categories</a>
        <p class="muted">No how-tos match “${esc(query)}”.</p>
      </div>
    `;
  }
  return `
    <div class="docs-catalog-search-results">
      <a class="docs-catalog-back" href="#complete-docs">← All categories</a>
      <p class="docs-catalog-count muted small">${count} similar doc topic${count === 1 ? "" : "s"} for “${esc(query)}”</p>
      ${matched.map((row) => `
        <section class="docs-category" id="cat-${esc(row.id)}">
          <header class="docs-category-head">
            <h3><a href="#cat-${esc(row.id)}">${esc(row.title)}</a></h3>
            <p class="muted">${esc(row.blurb || "")}</p>
          </header>
          <div class="docs-feature-grid">
            ${row.features.map((f) => featureCard(f)).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;
}

function mountCatalog() {
  const host = document.getElementById("docs-catalog");
  if (!host) return;
  const rows = catalogRows();
  const query = currentQuery();
  if (query) {
    host.innerHTML = searchResultsHtml(query, rows);
    bindGifs(host);
    setSearchStatus(`${host.querySelectorAll(".docs-feature-card").length} similar doc topic${host.querySelectorAll(".docs-feature-card").length === 1 ? "" : "s"} found for "${query}".`);
    return;
  }

  const view = catalogViewFromHash(typeof location !== "undefined" ? location.hash : "");
  if (view.mode === "category") {
    const row = rows.find((item) => item.id === view.id) || DOC_CATEGORIES.find((item) => item.id === view.id);
    if (row) {
      const features = row.features || [];
      host.innerHTML = categoryViewHtml({ ...row, features });
      bindGifs(host);
      setSearchStatus("Type what you are trying to do and similar docs will surface below.");
      if (view.id === "agent-store") void mountAgentDocs();
      if (view.featureId) {
        requestAnimationFrame(() => {
          document.getElementById(`doc-${view.featureId}`)?.scrollIntoView({ block: "start" });
        });
      }
      return;
    }
  }

  host.innerHTML = landingGridHtml(rows);
  setSearchStatus("Type what you are trying to do and matching how-tos will appear below.");
}

function agentDocCard(app) {
  const manifest = app.manifest || {};
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions.slice(0, 4) : [];
  const env = Array.isArray(manifest.env) ? manifest.env.slice(0, 3) : [];
  const published = app.published_at || app.updated_at || app.created_at;
  const when = published ? new Date(published).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "";
  return `
    <article class="agent-doc-card" data-agent-text="${esc([
      app.name,
      app.slug,
      app.tagline,
      app.description,
      app.category,
      app.app_type,
      ownerLabel(app),
      ...permissions,
      ...env,
    ].filter(Boolean).join(" ").toLowerCase())}">
      <div class="agent-product-top">
        <div class="agent-product-icon">${esc(appIcon(app))}</div>
        <div class="agent-app-price">${esc(priceLabel(app))}</div>
      </div>
      <h4>${esc(app.name)}</h4>
      <p class="agent-product-slug mono muted small">@agent-app:${esc(app.slug)}</p>
      <p class="agent-product-tagline">${esc(app.tagline)}</p>
      <p class="agent-product-desc muted">${esc(app.description)}</p>
      <div class="agent-app-badges">
        <span class="agent-app-badge">${esc(categoryFor(app))}</span>
        <span class="agent-app-badge">${esc(app.app_type || "agent")}</span>
        ${app.featured ? `<span class="agent-app-badge">Featured</span>` : ""}
      </div>
      <p class="agent-doc-meta muted small">
        Published ${esc(when || "recently")} by ${esc(ownerLabel(app))}
      </p>
      ${permissions.length ? `<p class="agent-doc-meta muted small"><strong>Permissions:</strong> ${esc(permissions.join(", "))}</p>` : ""}
      ${env.length ? `<p class="agent-doc-meta muted small"><strong>Setup:</strong> ${esc(env.join(", "))}</p>` : ""}
      <div class="agent-doc-actions">
        <a class="btn secondary btn-compact" href="/agent-store.html?agent=${esc(app.slug)}">View in store</a>
        ${app.source_url ? `<a class="btn secondary btn-compact" href="${esc(app.source_url)}" target="_blank" rel="noopener">Source / docs</a>` : ""}
      </div>
    </article>
  `;
}

function categoryAgentSections(apps) {
  const categories = [...new Set(apps.map(categoryFor))].sort((a, b) => a.localeCompare(b));
  return categories.map((category) => {
    const group = apps.filter((app) => categoryFor(app) === category);
    return `
      <section class="agent-doc-category" data-agent-category>
        <header class="agent-store-section-head">
          <h4>${esc(category)}</h4>
          <span class="muted small">${group.length} published agent${group.length === 1 ? "" : "s"}</span>
        </header>
        <div class="agent-doc-grid">
          ${group.map(agentDocCard).join("")}
        </div>
      </section>
    `;
  }).join("");
}

function renderAgentDocs(host, apps) {
  if (!apps.length) {
    host.innerHTML = `
      <div class="agent-doc-empty">
        <h4>No public agent apps yet</h4>
        <p class="muted">Approved submissions will appear here automatically, searchable by name, category, creator, manifest permissions, and setup docs.</p>
        <a class="btn secondary" href="/agent-store.html">Submit the first Agent App</a>
      </div>
    `;
    return;
  }

  const recent = [...apps].sort((a, b) => String(b.published_at || b.updated_at || "").localeCompare(String(a.published_at || a.updated_at || ""))).slice(0, 6);
  host.innerHTML = `
    <div class="agent-docs-toolbar">
      <label class="docs-catalog-filter">
        <span class="visually-hidden">Search public agent docs</span>
        <input type="search" id="agent-doc-filter" placeholder="Search public agents (CAD, robot, connector, permission)…" />
      </label>
      <span class="muted small">${apps.length} approved public agent${apps.length === 1 ? "" : "s"}</span>
    </div>
    <section class="agent-store-section" data-agent-recent>
      <div class="agent-store-section-head">
        <h4>Most recent agents</h4>
        <span class="muted small">Newest approved submissions</span>
      </div>
      <div class="agent-doc-grid agent-doc-grid--recent">
        ${recent.map(agentDocCard).join("")}
      </div>
    </section>
    <section class="agent-store-section">
      <div class="agent-store-section-head">
        <h4>Browse by category</h4>
        <span class="muted small">Public documentation generated from approved submissions</span>
      </div>
      ${categoryAgentSections(apps)}
    </section>
    <p class="agent-doc-no-results muted hidden">No public agents match that search.</p>
  `;

  const input = host.querySelector("#agent-doc-filter");
  input?.addEventListener("input", () => {
    triggerSearchStreak(input);
    const q = String(input.value || "").trim().toLowerCase();
    const cards = [...host.querySelectorAll(".agent-doc-card")];
    cards.forEach((card) => {
      const text = card.getAttribute("data-agent-text") || card.textContent?.toLowerCase() || "";
      card.classList.toggle("is-hidden", !!q && !text.includes(q));
    });
    host.querySelectorAll("[data-agent-category], [data-agent-recent]").forEach((section) => {
      const visible = [...section.querySelectorAll(".agent-doc-card")].some((card) => !card.classList.contains("is-hidden"));
      section.classList.toggle("is-hidden", !!q && !visible);
    });
    const anyVisible = cards.some((card) => !card.classList.contains("is-hidden"));
    host.querySelector(".agent-doc-no-results")?.classList.toggle("hidden", anyVisible);
  });
}

async function mountAgentDocs() {
  const host = document.getElementById("agent-docs");
  if (!host) return;
  if (cachedAgentError && !cachedAgentApps) {
    host.innerHTML = `<p class="muted">${esc(cachedAgentError)}</p>`;
    return;
  }
  if (cachedAgentApps) {
    renderAgentDocs(host, cachedAgentApps);
    return;
  }
  try {
    const res = await fetch("/api/agent-apps");
    if (!res.ok) throw new Error("Could not load public Agent Store docs.");
    const data = await res.json();
    cachedAgentApps = Array.isArray(data.apps) ? data.apps : [];
    if (document.getElementById("agent-docs") === host) renderAgentDocs(host, cachedAgentApps);
  } catch (err) {
    cachedAgentError = err.message || "Could not load public Agent Store docs.";
    if (document.getElementById("agent-docs") === host) {
      host.innerHTML = `<p class="muted">${esc(cachedAgentError)}</p>`;
    }
  }
}

function bindCatalogChrome() {
  if (!searchBound) {
    searchBound = true;
    const topicSearch = document.getElementById("docs-topic-search");
    topicSearch?.addEventListener("input", () => {
      triggerSearchStreak(topicSearch);
      mountCatalog();
      document.getElementById("complete-docs")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
  if (!hashBound && typeof window !== "undefined") {
    hashBound = true;
    window.addEventListener("hashchange", () => {
      if (!isCatalogHash(location.hash)) return;
      const topicSearch = document.getElementById("docs-topic-search");
      if (topicSearch?.value) topicSearch.value = "";
      mountCatalog();
      const view = catalogViewFromHash(location.hash);
      if (view.mode === "category" && !view.featureId) {
        document.getElementById("complete-docs")?.scrollIntoView({ block: "start" });
      }
    });
  }
}

function mount() {
  bindCatalogChrome();
  mountCatalog();
  applyDocsHero();
  const view = catalogViewFromHash(location.hash);
  if (view.mode === "category" && !view.featureId) {
    document.getElementById("complete-docs")?.scrollIntoView({ block: "start" });
  }
}

function applyDocsHero() {
  const hero = cmsPages.docs?.hero || {};
  setHeroText(document.querySelector("[data-cms-root='docs-hero']"), hero);
  setBannerImage(document.getElementById("docs-hero-photo"), hero.banner || "", hero.title || "");
  document.querySelectorAll("[data-cms-root='docs-hero'] > .site-cms-pencil").forEach((el) => el.remove());
  if (cmsCanEdit) {
    document.body.classList.add("is-site-cms");
    document.querySelector("[data-cms-root='docs-hero']")?.insertAdjacentHTML("afterbegin", pencilHtml("docs-hero"));
  }
  mountCatalog();
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const back = event.target.closest?.(".docs-catalog-back");
    if (back) {
      const topicSearch = document.getElementById("docs-topic-search");
      if (topicSearch) topicSearch.value = "";
      if (catalogViewFromHash(location.hash).mode === "grid") {
        event.preventDefault();
        mountCatalog();
      }
    }
    const btn = event.target.closest?.(".site-cms-pencil");
    if (!btn) return;
    const kind = btn.getAttribute("data-cms-kind");
    const id = btn.getAttribute("data-cms-id") || "";
    if (kind === "docs-hero") {
      const hero = cmsPages.docs?.hero || {};
      openCmsEditor({
        title: "Edit Docs",
        html: heroFields(hero),
        onSubmit: async (_values, form) => {
          cmsPages = await saveSitePages({ docs: { hero: await heroFromForm(form, hero) } });
          applyDocsHero();
        },
      });
    }
    if (kind === "docs-feature") {
      const item = applyOverrides(DOC_FEATURES, cmsPages?.docs?.features).find((row) => row.id === id) || {};
      openCmsEditor({
        title: "Edit feature",
        html: templateFields(item),
        onSubmit: async (_values, form) => {
          const next = await templateFromForm(form);
          cmsPages = await saveSitePages({ docs: { features: { [id]: next } } });
          applyDocsHero();
        },
      });
    }
  });

  void loadSitePages().then(({ pages, canEdit }) => {
    cmsPages = pages || {};
    cmsCanEdit = canEdit;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", applyDocsHero);
    } else {
      applyDocsHero();
    }
  }).catch((err) => {
    console.warn("[docs] CMS unavailable", err);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
}
