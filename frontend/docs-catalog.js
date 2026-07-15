/** Render complete categorized feature documentation on /docs.html */

import { DOC_CATEGORIES, DOC_FEATURES, featuresByCategory } from "./docs-features.js?v=20260715-docs-catalog";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function featureCard(feature) {
  const gif = feature.gif
    ? `<div class="docs-feature-gif-wrap">
         <img class="docs-feature-gif" src="${esc(feature.gif)}" alt="" loading="lazy" />
       </div>`
    : "";
  return `
    <article class="docs-feature-card" id="doc-${esc(feature.id)}">
      ${gif}
      <div class="docs-feature-body">
        <h4>${esc(feature.title)}</h4>
        <p class="docs-feature-summary">${esc(feature.summary)}</p>
        <p class="docs-feature-where"><span>Where</span> ${esc(feature.where || "")}</p>
        <ol class="docs-feature-steps">
          ${(feature.steps || []).map((step) => `<li>${esc(step)}</li>`).join("")}
        </ol>
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
    <p class="docs-catalog-nav-title">Categories</p>
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
      <p class="info-eyebrow">Complete documentation</p>
      <h3>All features, categorized</h3>
      <p class="muted">
        ${DOC_FEATURES.length} how-tos with demo GIFs where available.
        Prefer a guided tour? Open
        <a href="/getting-started.html">Getting Started</a>
        and ask Render Agent.
      </p>
      <label class="docs-catalog-filter">
        <span class="visually-hidden">Filter features</span>
        <input type="search" id="docs-feature-filter" placeholder="Filter features (e.g. URDF, wiring, share)…" />
      </label>
    </div>
    ${rows.map((row) => categorySection(row)).join("")}
  `;

  host.querySelectorAll(".docs-feature-gif").forEach((img) => {
    img.addEventListener("error", () => img.closest(".docs-feature-gif-wrap")?.remove());
  });

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

function mount() {
  mountNav();
  mountCatalog();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
