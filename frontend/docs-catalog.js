/** Render complete categorized feature documentation on /docs.html */

import { DOC_CATEGORIES, DOC_FEATURES, featuresByCategory } from "./docs-features.js?v=20260715-agent-store-docs";
import { enhanceDocsGifs } from "./docs-gif-expand.js?v=20260715-gif-expand";

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
  return app.owner?.name || app.owner?.email || "Render3D creator";
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
    <article class="docs-feature-card" id="doc-${esc(feature.id)}">
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
      </div>
    </article>
  `;
}

function categorySection(row) {
  return `
    <section class="docs-category" id="cat-${esc(row.id)}">
      <header class="docs-category-head">
        <h3>${esc(row.title)}</h3>
        <p class="muted">${esc(row.blurb || "")}</p>
      </header>
      <div class="docs-feature-grid">
        ${row.features.map((f) => featureCard(f)).join("")}
      </div>
    </section>
  `;
}

function mountNav() {
  const host = document.getElementById("docs-catalog-nav");
  if (!host) return;
  host.innerHTML = `
    <p class="docs-catalog-nav-title">On this page</p>
    ${DOC_CATEGORIES.map((cat) => {
      const count = DOC_FEATURES.filter((f) => f.category === cat.id).length;
      if (!count) return "";
      return `<a href="#cat-${esc(cat.id)}">${esc(cat.title)} <em>${count}</em></a>`;
    }).join("")}
    <a class="docs-catalog-gs-link" href="/getting-started.html">Getting Started demos →</a>
  `;
}

function mountCatalog() {
  const host = document.getElementById("docs-catalog");
  if (!host) return;
  const rows = featuresByCategory();
  host.innerHTML = `
    <div class="docs-catalog-intro">
      <label class="docs-catalog-filter">
        <span class="visually-hidden">Filter features</span>
        <input type="search" id="docs-feature-filter" placeholder="Filter features (e.g. URDF, wiring, share)…" />
      </label>
      <p class="docs-catalog-count muted small">${DOC_FEATURES.length} features across ${rows.length} categories</p>
    </div>
    ${rows.map((row) => categorySection(row)).join("")}
  `;

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

  const input = host.querySelector("#docs-feature-filter");
  input?.addEventListener("input", () => {
    const q = String(input.value || "").trim().toLowerCase();
    host.querySelectorAll(".docs-feature-card").forEach((card) => {
      const text = card.textContent?.toLowerCase() || "";
      card.classList.toggle("is-hidden", !!q && !text.includes(q));
    });
    host.querySelectorAll(".docs-category").forEach((section) => {
      const visible = [...section.querySelectorAll(".docs-feature-card")].some(
        (card) => !card.classList.contains("is-hidden")
      );
      section.classList.toggle("is-hidden", !!q && !visible);
    });
  });
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

async function mountAgentDocs() {
  const host = document.getElementById("agent-docs");
  if (!host) return;
  let apps = [];
  try {
    const res = await fetch("/api/agent-apps");
    if (!res.ok) throw new Error("Could not load public Agent Store docs.");
    const data = await res.json();
    apps = Array.isArray(data.apps) ? data.apps : [];
  } catch (err) {
    host.innerHTML = `<p class="muted">${esc(err.message || "Could not load public Agent Store docs.")}</p>`;
    return;
  }

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

function mount() {
  mountNav();
  mountCatalog();
  void mountAgentDocs();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
