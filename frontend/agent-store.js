import { authHeaders, getToken } from "./auth.js";
import {
  bindPriceFeeHint,
  isPaidListing,
  mountSellerPanel,
  startCheckout,
} from "./marketplace-payments.js?v=20260715-mkt-payments";

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
let activeAgentSlug = new URLSearchParams(window.location.search).get("agent") || "";

const DEFAULT_CATEGORIES = ["All", "Featured", "Boosted", "Mold Making", "CAD", "Robotics", "Sourcing", "Automation", "Connectors", "Premium", "Free", "Paid", "View only"];

const filterAccess = document.getElementById("agent-filter-access");
const filterLicense = document.getElementById("agent-filter-license");
const filterDownload = document.getElementById("agent-filter-download");
const filterBoosted = document.getElementById("agent-filter-boosted");
const dropZone = document.querySelector("[data-agent-drop]");
const docsInput = formEl?.querySelector("input[name='instruction_docs']");

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
  if (app.access_mode === "view_only") return "View only";
  if (app.premium && !app.price_cents) return "Premium";
  if (app.access_mode === "paid" || app.price_cents > 0) {
    return `${(app.price_cents / 100).toLocaleString(undefined, { style: "currency", currency: app.currency || "USD" })}`;
  }
  if (!app.price_cents) return "Free";
  return `${(app.price_cents / 100).toLocaleString(undefined, { style: "currency", currency: app.currency || "USD" })}`;
}

function appBadges(app) {
  const badges = [app.app_type, app.category, app.license, app.access_mode].filter(Boolean);
  if (app.featured) badges.unshift("Featured");
  if (app.boost_status === "approved") badges.unshift("Boosted");
  if (app.premium || app.price_cents > 0 || app.access_mode === "paid") badges.push("Paid");
  if (app.download_enabled === false) badges.push("No download");
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
  const droppedFiles = window.__agentStoreDroppedFiles || [];
  const droppedImages = droppedFiles.filter((file) => /^image\//i.test(file.type || ""));
  const droppedDocs = droppedFiles.filter((file) => !/^image\//i.test(file.type || ""));
  const imageFiles = [...(form.getAll("example_images") || []), ...droppedImages].filter((file) => file?.name);
  const docFiles = [...(form.getAll("instruction_docs") || []), ...droppedDocs].filter((file) => file?.name);
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

function syncDropLabel(files = []) {
  if (!dropZone) return;
  dropZone.classList.toggle("has-files", files.length > 0);
  dropZone.innerHTML = files.length
    ? `<strong>${files.length} asset${files.length === 1 ? "" : "s"} ready</strong><span>${escapeHtml(files.slice(0, 4).map((file) => file.name).join(", "))}${files.length > 4 ? "..." : ""}</span>`
    : `<strong>Drop agent assets here</strong><span>Example images, instruction docs, markdown, PDFs, and setup notes.</span>`;
}

function setDroppedFiles(files) {
  window.__agentStoreDroppedFiles = [...files].filter((file) => file?.name).slice(0, 14);
  syncDropLabel(window.__agentStoreDroppedFiles);
}

function wireDropZone() {
  if (!dropZone || !docsInput) return;
  dropZone.addEventListener("click", () => docsInput.click());
  docsInput.addEventListener("change", () => setDroppedFiles(docsInput.files || []));
  ["dragenter", "dragover"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === "drop") setDroppedFiles(event.dataTransfer?.files || []);
      dropZone.classList.remove("is-dragging");
    });
  });
  syncDropLabel();
}

function appIcon(app) {
  const images = app.manifest?.example_images;
  if (Array.isArray(images) && images[0]?.data_url) {
    return `<span class="marketplace-thumb marketplace-thumb--inline" style="background-image:url('${escapeAttr(images[0].data_url)}')"></span>`;
  }
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
  if (activeCategory === "Boosted") return app.boost_status === "approved";
  if (activeCategory === "Premium") return app.premium || app.price_cents > 0 || app.access_mode === "paid";
  if (activeCategory === "Free") return (app.access_mode || "free") === "free" && !app.price_cents;
  if (activeCategory === "Paid") return app.access_mode === "paid" || app.price_cents > 0 || app.premium;
  if (activeCategory === "View only") return app.access_mode === "view_only";
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
    app.body_md,
    app.category,
    app.app_type,
    app.license,
    app.access_mode,
    manifest.skill_id,
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

function matchesExtraFilters(app) {
  const access = filterAccess?.value || "all";
  if (access !== "all" && (app.access_mode || "free") !== access) return false;
  const license = filterLicense?.value || "all";
  if (license !== "all" && (app.license || "proprietary") !== license) return false;
  const download = filterDownload?.value || "all";
  if (download === "on" && app.download_enabled === false) return false;
  if (download === "off" && app.download_enabled !== false) return false;
  if (filterBoosted?.checked && app.boost_status !== "approved") return false;
  return true;
}

function visibleApps() {
  return apps.filter((app) => matchesCategory(app) && matchesSearch(app) && matchesExtraFilters(app));
}

function productCard(app, { compact = false } = {}) {
  const paid = isPaidListing(app);
  const disabled = app.installed || app.access_mode === "view_only" ? "disabled" : "";
  const actionAttr = paid && !app.installed ? `data-buy="${escapeAttr(app.id || app.slug)}"` : `data-install="${app.slug}"`;
  const adminControls = isAdmin
    ? `<div class="agent-admin-controls">
        <button type="button" class="btn secondary btn-compact" data-review="${app.slug}" data-status="approved">Approve</button>
        <button type="button" class="btn secondary btn-compact" data-review="${app.slug}" data-status="rejected">Reject</button>
        <button type="button" class="btn secondary btn-compact" data-feature="${app.slug}">${app.featured ? "Unfeature" : "Feature"}</button>
      </div>`
    : "";
  const boostBtn = getToken() && app.created_by
    ? `<button type="button" class="btn secondary btn-compact" data-boost="${escapeAttr(app.slug)}">Apply boost</button>`
    : "";
  const iconRaw = appIcon(app);
  const coverHtml = String(iconRaw).includes("marketplace-thumb")
    ? iconRaw.replace("marketplace-thumb--inline", "marketplace-thumb marketplace-thumb--cover")
    : `<div class="agent-cover"><div class="agent-product-icon">${escapeHtml(iconRaw)}</div></div>`;
  const getLabel = app.installed
    ? "Installed"
    : app.access_mode === "view_only"
      ? "View"
      : paid
        ? `Get · ${priceLabel(app)}`
        : "Get";
  return `<article class="agent-product-card${app.installed ? " skill-card-active" : ""}${compact ? " agent-product-card-compact" : ""}">
    ${coverHtml}
    <div class="agent-product-top">
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
      <button type="button" class="btn primary btn-compact" ${actionAttr} ${disabled}>${getLabel}</button>
      ${app.installed ? `<button type="button" class="btn secondary btn-compact" data-uninstall="${app.slug}">Uninstall</button>` : ""}
      ${boostBtn}
    </div>
    ${adminControls}
  </article>`;
}

function bindCardActions(root = document) {
  root.querySelectorAll("[data-install]").forEach((btn) => {
    btn.addEventListener("click", () => installApp(btn.dataset.install));
  });
  root.querySelectorAll("[data-buy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!getToken()) {
        if (statusEl) statusEl.textContent = "Sign in to purchase.";
        return;
      }
      btn.disabled = true;
      try {
        const result = await startCheckout({ kind: "agent", listingId: btn.dataset.buy });
        if (result.already_owned || result.demo) {
          if (statusEl) statusEl.textContent = result.message || "Purchase complete — installing…";
          const app = apps.find((a) => a.id === btn.dataset.buy || a.slug === btn.dataset.buy);
          await installApp(app?.slug || btn.dataset.buy);
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message || "Checkout failed.";
        btn.disabled = false;
      }
    });
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
  root.querySelectorAll("[data-boost]").forEach((btn) => {
    btn.addEventListener("click", () => applyBoost(btn.dataset.boost));
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
  if (activeAgentSlug) {
    searchQuery = activeAgentSlug;
    if (searchEl) searchEl.value = activeAgentSlug;
    activeAgentSlug = "";
  }
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

async function applyBoost(slug) {
  if (!getToken()) {
    alert("Log in to apply for a boost.");
    return;
  }
  const message = window.prompt("Why should this agent app be boosted?", "Useful workflow with clear docs.") || "";
  const res = await fetch(`/api/agent-apps/${encodeURIComponent(slug)}/boost`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ message }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.detail || "Boost application failed.");
    return;
  }
  alert("Boost application submitted for review.");
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
  const members = String(form.get("member_emails") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((email) => ({ email, role: "member" }));
  const body = {
    name: form.get("name"),
    tagline: form.get("tagline"),
    description: form.get("description"),
    body_md: form.get("body_md") || "",
    category: form.get("category") || "agent",
    app_type: form.get("app_type") || "skill",
    source_url: form.get("source_url") || null,
    price_cents: Number(form.get("price_cents") || 0),
    premium: form.get("premium") === "on",
    access_mode: form.get("access_mode") || "free",
    license: form.get("license") || "proprietary",
    download_enabled: form.get("download_enabled") === "on",
    members,
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
  setDroppedFiles([]);
  alert("Submitted for review.");
  await loadApps();
});

const agentBody = document.getElementById("agent-body-md");
document.querySelectorAll("[data-agent-editor-toolbar] [data-fmt]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!agentBody) return;
    const start = agentBody.selectionStart || 0;
    const end = agentBody.selectionEnd || 0;
    const selected = agentBody.value.slice(start, end) || "text";
    const fmt = btn.dataset.fmt;
    let insert = selected;
    if (fmt === "bold") insert = `**${selected}**`;
    if (fmt === "italic") insert = `*${selected}*`;
    if (fmt === "h2") insert = `## ${selected}`;
    if (fmt === "ul") insert = selected.split("\n").map((line) => `- ${line}`).join("\n");
    if (fmt === "code") insert = `\`${selected}\``;
    agentBody.value = agentBody.value.slice(0, start) + insert + agentBody.value.slice(end);
    agentBody.focus();
  });
});

searchEl?.addEventListener("input", () => {
  searchQuery = searchEl.value || "";
  render();
});
[filterAccess, filterLicense, filterDownload, filterBoosted].forEach((el) => el?.addEventListener("change", render));

wireDropZone();
mountSellerPanel(document.getElementById("agent-seller-host"));
bindPriceFeeHint(
  document.querySelector("#agent-app-form input[name='price_cents']"),
  document.getElementById("agent-fee-hint"),
);
loadApps().catch((err) => {
  if (statusEl) statusEl.textContent = err.message || "Could not load agent apps.";
});
