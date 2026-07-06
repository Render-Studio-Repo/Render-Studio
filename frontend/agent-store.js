import { authHeaders, getToken } from "./auth.js";

const listEl = document.getElementById("agent-store-list");
const statusEl = document.getElementById("agent-store-status");
const formEl = document.getElementById("agent-app-form");
const categoriesEl = document.getElementById("agent-store-categories");
const featuredSectionEl = document.getElementById("agent-featured-section");
const featuredListEl = document.getElementById("agent-featured-list");
const searchEl = document.getElementById("agent-store-search");
const resultsTitleEl = document.getElementById("agent-store-results-title");
const resultsCountEl = document.getElementById("agent-store-results-count");

let apps = [];
let isAdmin = false;
let activeCategory = "All";
let searchQuery = "";
let activeCreatorId = new URLSearchParams(window.location.search).get("creator") || "";

const DEFAULT_CATEGORIES = ["All", "Featured", "Mold Making", "CAD", "Robotics", "Sourcing", "Automation", "Connectors", "Premium"];

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function initials(name) {
  return String(name || "R3")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "R3";
}

function ownerLabel(app) {
  return app.owner?.name || app.owner?.email || "Render3D";
}

function ownerAvatar(app) {
  const owner = app.owner || {};
  if (owner.avatar_url) {
    return `<span class="agent-creator-avatar agent-creator-avatar--image" style="background-image:url('${escapeAttr(owner.avatar_url)}')">${escapeHtml(initials(owner.name || owner.email))}</span>`;
  }
  return `<span class="agent-creator-avatar">${escapeHtml(initials(owner.name || owner.email || "Render3D"))}</span>`;
}

function priceLabel(app) {
  if (app.premium && !app.price_cents) return "Premium";
  if (!app.price_cents) return "Free";
  return `${(app.price_cents / 100).toLocaleString(undefined, { style: "currency", currency: app.currency || "USD" })}`;
}

function appBadges(app) {
  const badges = [app.app_type, app.category].filter(Boolean);
  if (app.featured) badges.unshift("Featured");
  if (app.premium || app.price_cents > 0) badges.push("Paid");
  if (app.status !== "approved") badges.push(app.status);
  return badges.map((b) => `<span class="agent-app-badge">${escapeHtml(b)}</span>`).join("");
}

function manifestLine(app) {
  const manifest = app.manifest || {};
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions.join(", ") : "";
  const env = Array.isArray(manifest.env) ? manifest.env.join(", ") : "";
  const examples = Array.isArray(manifest.example_images) ? manifest.example_images.length : 0;
  const docs = Array.isArray(manifest.instruction_docs) ? manifest.instruction_docs.length : 0;
  const bits = [];
  if (manifest.entrypoint) bits.push(`Entrypoint: ${manifest.entrypoint}`);
  if (permissions) bits.push(`Permissions: ${permissions}`);
  if (env) bits.push(`Env: ${env}`);
  if (examples) bits.push(`${examples} example image${examples === 1 ? "" : "s"}`);
  if (docs) bits.push(`${docs} instruction doc${docs === 1 ? "" : "s"}`);
  return bits.length ? `<p class="skill-card-meta muted small">${escapeHtml(bits.join(" · "))}</p>` : "";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsText(file);
  });
}

async function uploadedManifestAssets(form) {
  const imageFiles = [...(form.getAll("example_images") || [])].filter((file) => file?.name);
  const docFiles = [...(form.getAll("instruction_docs") || [])].filter((file) => file?.name);
  const exampleImages = [];
  for (const file of imageFiles.slice(0, 6)) {
    if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is too large. Use files under 8 MB.`);
    exampleImages.push({
      name: file.name,
      media_type: file.type || "image",
      data_url: await fileToDataUrl(file),
    });
  }
  const instructionDocs = [];
  for (const file of docFiles.slice(0, 8)) {
    if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is too large. Use files under 8 MB.`);
    const textLike = /^text\//i.test(file.type || "") || /\.(txt|md)$/i.test(file.name || "");
    instructionDocs.push({
      name: file.name,
      media_type: file.type || "application/octet-stream",
      ...(textLike ? { text: (await fileToText(file)).slice(0, 20000) } : { data_url: await fileToDataUrl(file) }),
    });
  }
  return { example_images: exampleImages, instruction_docs: instructionDocs };
}

function appIcon(app) {
  const category = String(app.category || "").toLowerCase();
  if (category.includes("mold")) return "MO";
  if (category.includes("robot")) return "RB";
  if (category.includes("source")) return "SO";
  if (category.includes("connect")) return "CN";
  if (category.includes("cad")) return "CAD";
  if (app.app_type === "script") return "JS";
  if (app.app_type === "workflow") return "WF";
  return "AI";
}

function categoryFor(app) {
  return app.category || "Agent Apps";
}

function allCategories() {
  const set = new Set(DEFAULT_CATEGORIES);
  apps.forEach((app) => set.add(categoryFor(app)));
  return [...set].filter(Boolean);
}

function matchesCategory(app) {
  if (activeCreatorId && app.owner?.id !== activeCreatorId) return false;
  if (activeCategory === "All") return true;
  if (activeCategory === "Featured") return app.featured;
  if (activeCategory === "Premium") return app.premium || app.price_cents > 0;
  return categoryFor(app).toLowerCase() === activeCategory.toLowerCase();
}

function matchesSearch(app) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  const manifest = app.manifest || {};
  const haystack = [
    app.name,
    app.slug,
    app.tagline,
    app.description,
    app.category,
    app.app_type,
    manifest.skill_id,
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

function visibleApps() {
  return apps.filter((app) => matchesCategory(app) && matchesSearch(app));
}

function productCard(app, { compact = false } = {}) {
  const installText = app.installed ? "Installed" : app.price_cents > 0 || app.premium ? "Purchase required" : "Install";
  const disabled = app.installed || app.price_cents > 0 || app.premium ? "disabled" : "";
  const adminControls = isAdmin
    ? `<div class="agent-admin-controls">
        <button type="button" class="btn secondary btn-compact" data-review="${app.slug}" data-status="approved">Approve</button>
        <button type="button" class="btn secondary btn-compact" data-review="${app.slug}" data-status="rejected">Reject</button>
        <button type="button" class="btn secondary btn-compact" data-feature="${app.slug}">${app.featured ? "Unfeature" : "Feature"}</button>
      </div>`
    : "";
  return `<article class="agent-product-card${app.installed ? " skill-card-active" : ""}${compact ? " agent-product-card-compact" : ""}">
    <div class="agent-product-top">
      <div class="agent-product-icon">${escapeHtml(appIcon(app))}</div>
      <div class="agent-app-price">${escapeHtml(priceLabel(app))}</div>
    </div>
    <h4>${escapeHtml(app.name)}</h4>
    <p class="agent-product-slug mono muted small">@agent-app:${escapeHtml(app.slug)}</p>
    <button type="button" class="agent-creator-link" data-creator="${escapeAttr(app.owner?.id || "")}" ${app.owner?.id ? "" : "disabled"}>
      ${ownerAvatar(app)}
      <span>by ${escapeHtml(ownerLabel(app))}</span>
    </button>
    <div class="agent-app-badges">${appBadges(app)}</div>
    <p class="agent-product-tagline">${escapeHtml(app.tagline)}</p>
    ${compact ? "" : `<p class="agent-product-desc muted">${escapeHtml(app.description)}</p>${manifestLine(app)}`}
    ${app.source_url && !compact ? `<p class="small"><a href="${escapeHtml(app.source_url)}" target="_blank" rel="noopener">Source / docs</a></p>` : ""}
    <div class="agent-app-actions">
      <button type="button" class="btn primary btn-compact" data-install="${app.slug}" ${disabled}>${installText}</button>
      ${app.installed ? `<button type="button" class="btn secondary btn-compact" data-uninstall="${app.slug}">Uninstall</button>` : ""}
    </div>
    ${adminControls}
  </article>`;
}

function bindCardActions(root = document) {
  root.querySelectorAll("[data-install]").forEach((btn) => {
    btn.addEventListener("click", () => installApp(btn.dataset.install));
  });
  root.querySelectorAll("[data-uninstall]").forEach((btn) => {
    btn.addEventListener("click", () => uninstallApp(btn.dataset.uninstall));
  });
  root.querySelectorAll("[data-review]").forEach((btn) => {
    btn.addEventListener("click", () => reviewApp(btn.dataset.review, { status: btn.dataset.status }));
  });
  root.querySelectorAll("[data-feature]").forEach((btn) => {
    const app = apps.find((item) => item.slug === btn.dataset.feature);
    btn.addEventListener("click", () => reviewApp(btn.dataset.feature, { status: app?.status || "approved", featured: !app?.featured }));
  });
  root.querySelectorAll("[data-creator]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const creatorId = btn.dataset.creator || "";
      if (!creatorId) return;
      activeCreatorId = creatorId;
      activeCategory = "All";
      const params = new URLSearchParams(window.location.search);
      params.set("creator", creatorId);
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
      render();
      document.querySelector(".agent-store-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderCategories() {
  if (!categoriesEl) return;
  categoriesEl.innerHTML = allCategories().map((category) => {
    const count = category === "All"
      ? apps.length
      : category === "Featured"
        ? apps.filter((app) => app.featured).length
        : category === "Premium"
          ? apps.filter((app) => app.premium || app.price_cents > 0).length
          : apps.filter((app) => categoryFor(app).toLowerCase() === category.toLowerCase()).length;
    return `<button type="button" class="agent-category-tile${category === activeCategory ? " active" : ""}" data-category="${escapeHtml(category)}">
      <span>${escapeHtml(category)}</span>
      <small>${count} app${count === 1 ? "" : "s"}</small>
    </button>`;
  }).join("");
  categoriesEl.querySelectorAll("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.category || "All";
      render();
    });
  });
}

function render() {
  if (!listEl) return;
  renderCategories();
  const filtered = visibleApps();
  const featured = apps.filter((app) => app.featured).slice(0, 8);
  const activeCreator = activeCreatorId ? apps.find((app) => app.owner?.id === activeCreatorId)?.owner : null;
  if (featuredSectionEl && featuredListEl) {
    featuredSectionEl.classList.toggle("hidden", !featured.length);
    featuredListEl.innerHTML = featured.map((app) => productCard(app, { compact: true })).join("");
    bindCardActions(featuredListEl);
  }
  if (resultsTitleEl) {
    resultsTitleEl.textContent = activeCreator
      ? `${activeCreator.name || activeCreator.email}'s Agent Apps`
      : activeCategory === "All" ? "All Agent Apps" : `${activeCategory} Apps`;
  }
  if (resultsCountEl) {
    resultsCountEl.textContent = `${filtered.length} result${filtered.length === 1 ? "" : "s"}`;
  }
  if (!apps.length) {
    listEl.innerHTML = '<p class="muted">No approved agent apps yet. Submit the first one for review.</p>';
    return;
  }
  if (activeCreator && listEl) {
    const avatar = activeCreator.avatar_url
      ? `<span class="agent-profile-avatar agent-profile-avatar--image" style="background-image:url('${escapeAttr(activeCreator.avatar_url)}')">${escapeHtml(initials(activeCreator.name || activeCreator.email))}</span>`
      : `<span class="agent-profile-avatar">${escapeHtml(initials(activeCreator.name || activeCreator.email))}</span>`;
    const profileApps = apps.filter((app) => app.owner?.id === activeCreatorId);
    const profile = `<div class="agent-creator-profile">
      ${avatar}
      <div>
        <p class="info-eyebrow">Creator Profile</p>
        <h4>${escapeHtml(activeCreator.name || activeCreator.email)}</h4>
        <p class="muted small">${profileApps.length} published agent app${profileApps.length === 1 ? "" : "s"}</p>
      </div>
      <button type="button" class="btn secondary btn-compact" data-clear-creator>Back to all creators</button>
    </div>`;
    if (!filtered.length) {
      listEl.innerHTML = `${profile}<p class="muted">No apps match this creator/search.</p>`;
      listEl.querySelector("[data-clear-creator]")?.addEventListener("click", clearCreator);
      return;
    }
    listEl.innerHTML = `${profile}${filtered.map((app) => productCard(app)).join("")}`;
    listEl.querySelector("[data-clear-creator]")?.addEventListener("click", clearCreator);
    bindCardActions(listEl);
    return;
  }
  if (!filtered.length) {
    listEl.innerHTML = '<p class="muted">No apps match this category/search.</p>';
    return;
  }
  listEl.innerHTML = filtered.map((app) => productCard(app)).join("");
  bindCardActions(listEl);
}

function clearCreator() {
  activeCreatorId = "";
  const params = new URLSearchParams(window.location.search);
  params.delete("creator");
  window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  render();
}

async function loadApps() {
  if (statusEl) statusEl.textContent = "Loading agent apps...";
  const query = getToken() ? "?include_pending=1" : "";
  const res = await fetch(`/api/agent-apps${query}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Could not load agent apps.");
  const data = await res.json();
  apps = data.apps || [];
  isAdmin = !!data.admin;
  if (statusEl) {
    statusEl.textContent = `${apps.length} app${apps.length === 1 ? "" : "s"} available${isAdmin ? " · admin review enabled" : ""}`;
  }
  render();
}

async function installApp(slug) {
  if (!getToken()) {
    alert("Log in to install agent apps.");
    return;
  }
  const res = await fetch(`/api/agent-apps/${encodeURIComponent(slug)}/install`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.detail || "Install failed.");
    return;
  }
  await loadApps();
}

async function uninstallApp(slug) {
  const res = await fetch(`/api/agent-apps/${encodeURIComponent(slug)}/install`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.detail || "Uninstall failed.");
    return;
  }
  await loadApps();
}

async function reviewApp(slug, body) {
  const res = await fetch(`/api/agent-apps/${encodeURIComponent(slug)}/review`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.detail || "Review failed.");
    return;
  }
  await loadApps();
}

formEl?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!getToken()) {
    alert("Log in to submit an agent app.");
    return;
  }
  const form = new FormData(formEl);
  let manifest = {};
  const manifestRaw = String(form.get("manifest") || "").trim();
  if (manifestRaw) {
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      alert("Manifest must be valid JSON.");
      return;
    }
  }
  try {
    const assets = await uploadedManifestAssets(form);
    if (assets.example_images.length) manifest.example_images = assets.example_images;
    if (assets.instruction_docs.length) manifest.instruction_docs = assets.instruction_docs;
    if (assets.example_images.length || assets.instruction_docs.length) {
      manifest.supports_assets = true;
    }
  } catch (err) {
    alert(err.message || "Could not read uploaded files.");
    return;
  }
  const body = {
    name: form.get("name"),
    tagline: form.get("tagline"),
    description: form.get("description"),
    category: form.get("category") || "agent",
    app_type: form.get("app_type") || "skill",
    source_url: form.get("source_url") || null,
    price_cents: Number(form.get("price_cents") || 0),
    premium: form.get("premium") === "on",
    manifest,
  };
  const res = await fetch("/api/agent-apps", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.detail || "Submission failed.");
    return;
  }
  formEl.reset();
  alert("Submitted for review.");
  await loadApps();
});

searchEl?.addEventListener("input", () => {
  searchQuery = searchEl.value || "";
  render();
});

loadApps().catch((err) => {
  if (statusEl) statusEl.textContent = err.message || "Could not load agent apps.";
});
