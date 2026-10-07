import { authHeaders, getToken } from "../studio/auth.js";
import {
  bindPriceFeeHint,
  isPaidListing,
  mountSellerPanel,
  startCheckout,
} from "../marketplace/marketplace-payments.js?v=20260715-payout-sso";

const listEl = document.getElementById("model-store-list");
const statusEl = document.getElementById("model-store-status");
const formEl = document.getElementById("model-listing-form");
const categoriesEl = document.getElementById("model-store-categories");
const featuredSectionEl = document.getElementById("model-featured-section");
const featuredListEl = document.getElementById("model-featured-list");
const searchEl = document.getElementById("model-store-search");
const resultsTitleEl = document.getElementById("model-store-results-title");
const resultsCountEl = document.getElementById("model-store-results-count");
const filterAccess = document.getElementById("filter-access");
const filterLicense = document.getElementById("filter-license");
const filterDownload = document.getElementById("filter-download");
const filterBoosted = document.getElementById("filter-boosted");
const freeCountEl = document.getElementById("model-store-free-count");
const dropZone = document.querySelector("[data-model-drop]");
const modelFilesInput = formEl?.querySelector("input[name='model_files']");

let listings = [];
let isAdmin = false;
let activeCategory = "All";
let searchQuery = "";
let droppedModelFiles = [];

const DEFAULT_CATEGORIES = ["All", "Featured", "Boosted", "Free", "Paid", "View only"];

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function priceLabel(item) {
  if (item.access_mode === "view_only") return "View only";
  if (item.access_mode === "paid" || item.price_cents > 0) {
    return (item.price_cents / 100).toLocaleString(undefined, { style: "currency", currency: item.currency || "USD" });
  }
  return "Free";
}

function simpleMarkdown(text) {
  let html = escapeHtml(text || "");
  html = html.replace(/^##\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^\*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html.replace(/\n/g, "<br>");
  return html;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function syncDropLabel() {
  if (!dropZone) return;
  dropZone.classList.toggle("has-files", droppedModelFiles.length > 0);
  dropZone.innerHTML = droppedModelFiles.length
    ? `<strong>${droppedModelFiles.length} file${droppedModelFiles.length === 1 ? "" : "s"} ready</strong><span>${escapeHtml(droppedModelFiles.slice(0, 4).map((file) => file.name).join(", "))}${droppedModelFiles.length > 4 ? "..." : ""}</span>`
    : `<strong>Drop model product files here</strong><span>Thumbnails, gallery images, STEP, STL, GLB, 3MF, OBJ, and source files.</span>`;
}

function setDroppedModelFiles(files) {
  droppedModelFiles = [...files].filter((file) => file?.name).slice(0, 12);
  syncDropLabel();
}

function wireDropZone() {
  if (!dropZone || !modelFilesInput) return;
  dropZone.addEventListener("click", () => modelFilesInput.click());
  modelFilesInput.addEventListener("change", () => setDroppedModelFiles(modelFilesInput.files || []));
  ["dragenter", "dragover"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === "drop") setDroppedModelFiles(event.dataTransfer?.files || []);
      dropZone.classList.remove("is-dragging");
    });
  });
  syncDropLabel();
}

function thumbUrl(item) {
  return item.thumbnail?.data_url || item.gallery?.[0]?.data_url || "";
}

function fileExt(name = "") {
  const ext = String(name).split(".").pop() || "";
  return ext.length <= 5 ? ext.toUpperCase() : "FILE";
}

function ownerLabel(item) {
  return item.owner?.name || item.members?.[0]?.display_name || "Render Studio creator";
}

function isKnowledgeListing(item) {
  return (item.files || []).some((file) => file?.product_type === "knowledge_base")
    || String(item.category || "").toLowerCase().includes("knowledge");
}

function badges(item) {
  const list = [item.category, item.license, item.access_mode].filter(Boolean);
  if (item.featured) list.unshift("Featured");
  if (item.boost_status === "approved") list.unshift("Boosted");
  if (!item.download_enabled) list.push("No download");
  if (item.status !== "approved") list.push(item.status);
  return list.map((b) => `<span class="agent-app-badge">${escapeHtml(b)}</span>`).join("");
}

function productCard(item, { compact = false } = {}) {
  const thumb = thumbUrl(item);
  const media = thumb
    ? `<div class="marketplace-thumb model-marketplace-thumb" style="background-image:url('${escapeAttr(thumb)}')"></div>`
    : `<div class="marketplace-thumb model-marketplace-thumb model-marketplace-thumb--generated"><span>${escapeHtml((item.category || "3D").slice(0, 2).toUpperCase())}</span></div>`;
  const adminControls = isAdmin
    ? `<div class="agent-admin-controls">
        <button type="button" class="btn secondary btn-compact" data-review="${escapeAttr(item.slug)}" data-status="approved">Approve</button>
        <button type="button" class="btn secondary btn-compact" data-review="${escapeAttr(item.slug)}" data-status="rejected">Reject</button>
        <button type="button" class="btn secondary btn-compact" data-feature="${escapeAttr(item.slug)}">${item.featured ? "Unfeature" : "Feature"}</button>
      </div>`
    : "";
  const paid = isPaidListing(item);
  const getBtn = paid
    ? `<button type="button" class="btn primary btn-compact" data-buy="${escapeAttr(item.id || item.slug)}">Get · ${escapeHtml(priceLabel(item))}</button>`
    : item.can_download && item.files?.length
      ? `<button type="button" class="btn primary btn-compact" data-preview-model="${escapeAttr(item.slug)}">Get</button>`
      : `<button type="button" class="btn primary btn-compact" disabled>View</button>`;
  const mine = getToken() && item.created_by;
  const fileTags = (item.files || []).slice(0, compact ? 3 : 5).map((file) => `<span>${escapeHtml(fileExt(file.name))}</span>`).join("");
  return `<article class="agent-product-card marketplace-product-card model-product-card${compact ? " agent-product-card-compact model-product-card--compact" : ""}">
    ${media}
    <div class="agent-product-top">
      <span class="model-product-owner">${escapeHtml(ownerLabel(item))}</span>
      <div class="agent-app-price">${escapeHtml(priceLabel(item))}</div>
    </div>
    <h4>${escapeHtml(item.name)}</h4>
    <p class="agent-product-slug mono muted small">@model:${escapeHtml(item.slug)}</p>
    <div class="agent-app-badges">${badges(item)}</div>
    <p class="agent-product-tagline">${escapeHtml(item.tagline)}</p>
    ${compact ? "" : `<div class="marketplace-body muted small">${simpleMarkdown((item.body_md || item.description || "").slice(0, 480))}</div>`}
    ${fileTags ? `<div class="model-file-tags">${fileTags}</div>` : ""}
    <div class="agent-app-actions">
      ${getBtn}
      ${!paid && item.files?.length ? `<span class="muted small">${item.files.length} file${item.files.length === 1 ? "" : "s"}</span>` : ""}
      ${mine ? `<button type="button" class="btn secondary btn-compact" data-boost="${escapeAttr(item.slug)}">Apply boost</button>` : ""}
    </div>
    ${adminControls}
  </article>`;
}

function matchesFilters(item) {
  if (isKnowledgeListing(item)) return false;
  if (activeCategory === "Featured" && !item.featured) return false;
  if (activeCategory === "Boosted" && item.boost_status !== "approved") return false;
  if (activeCategory === "Free" && item.access_mode !== "free") return false;
  if (activeCategory === "Paid" && item.access_mode !== "paid" && !(item.price_cents > 0)) return false;
  if (activeCategory === "View only" && item.access_mode !== "view_only") return false;
  if (activeCategory !== "All" && !["Featured", "Boosted", "Free", "Paid", "View only"].includes(activeCategory)) {
    if (String(item.category || "").toLowerCase() !== activeCategory.toLowerCase()) return false;
  }
  const access = filterAccess?.value || "all";
  if (access !== "all" && item.access_mode !== access) return false;
  const license = filterLicense?.value || "all";
  if (license !== "all" && item.license !== license) return false;
  const download = filterDownload?.value || "all";
  if (download === "on" && !item.download_enabled) return false;
  if (download === "off" && item.download_enabled) return false;
  if (filterBoosted?.checked && item.boost_status !== "approved") return false;
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  const hay = [item.name, item.slug, item.tagline, item.description, item.body_md, item.category, item.license, item.access_mode, item.owner?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function visibleListings() {
  return listings.filter(matchesFilters);
}

function renderCategories() {
  if (!categoriesEl) return;
  const set = new Set(DEFAULT_CATEGORIES);
  listings.filter((item) => !isKnowledgeListing(item)).forEach((item) => item.category && set.add(item.category));
  categoriesEl.innerHTML = [...set]
    .map((category) => {
      const count =
        category === "All"
          ? listings.filter((item) => !isKnowledgeListing(item)).length
          : listings.filter((item) => {
              const prev = activeCategory;
              activeCategory = category;
              const ok = matchesFilters(item);
              activeCategory = prev;
              return ok;
            }).length;
      return `<button type="button" class="agent-category-tile${category === activeCategory ? " active" : ""}" data-category="${escapeAttr(category)}">
        <strong>${escapeHtml(category)}</strong><span>${count}</span>
      </button>`;
    })
    .join("");
  categoriesEl.querySelectorAll("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.category || "All";
      render();
    });
  });
}

function bindActions(root = document) {
  root.querySelectorAll("[data-review]").forEach((btn) => {
    btn.addEventListener("click", () => reviewListing(btn.dataset.review, { status: btn.dataset.status }));
  });
  root.querySelectorAll("[data-feature]").forEach((btn) => {
    const item = listings.find((row) => row.slug === btn.dataset.feature);
    btn.addEventListener("click", () =>
      reviewListing(btn.dataset.feature, { status: item?.status || "approved", featured: !item?.featured })
    );
  });
  root.querySelectorAll("[data-boost]").forEach((btn) => {
    btn.addEventListener("click", () => applyBoost(btn.dataset.boost));
  });
  root.querySelectorAll("[data-buy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!getToken()) {
        alert("Sign in to purchase.");
        return;
      }
      btn.disabled = true;
      try {
        const result = await startCheckout({ kind: "model", listingId: btn.dataset.buy });
        if (result.already_owned || result.demo) {
          if (statusEl) statusEl.textContent = result.message || "Purchase complete.";
          await loadListings();
        }
      } catch (err) {
        alert(err.message || "Checkout failed.");
        btn.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-preview-model]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = listings.find((row) => row.slug === btn.dataset.previewModel);
      const files = (item?.files || []).map((file) => `- ${file.name}`).join("\n") || "No files listed yet.";
      alert(`${item?.name || "Model files"}\n\n${files}`);
    });
  });
}

function render() {
  const visible = visibleListings();
  const featured = listings.filter((item) => !isKnowledgeListing(item) && (item.featured || item.boost_status === "approved"));
  const freeCount = listings.filter((item) => !isKnowledgeListing(item) && item.access_mode === "free").length;
  if (freeCountEl) {
    freeCountEl.textContent = `${freeCount} free`;
  }
  if (resultsCountEl) resultsCountEl.textContent = `${visible.length} product${visible.length === 1 ? "" : "s"}`;
  if (resultsTitleEl) resultsTitleEl.textContent = activeCategory === "All" ? "All products" : activeCategory;
  renderCategories();
  if (featuredSectionEl && featuredListEl) {
    featuredSectionEl.classList.toggle("hidden", !featured.length);
    featuredListEl.innerHTML = featured.slice(0, 8).map((item) => productCard(item, { compact: true })).join("");
    bindActions(featuredListEl);
  }
  if (listEl) {
    listEl.innerHTML = visible.length
      ? visible.map((item) => productCard(item)).join("")
      : `<p class="muted">No products match these filters yet.</p>`;
    bindActions(listEl);
  }
}

async function loadListings() {
  if (statusEl) statusEl.textContent = "Loading marketplace…";
  const params = new URLSearchParams();
  if (getToken()) params.set("include_pending", "1");
  const res = await fetch(`/api/model-listings?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Could not load model marketplace.");
  const data = await res.json();
  listings = data.listings || [];
  isAdmin = !!data.admin;
  const productCount = listings.filter((item) => !isKnowledgeListing(item)).length;
  if (statusEl) statusEl.textContent = `${productCount} listing${productCount === 1 ? "" : "s"}`;
  render();
}

async function reviewListing(slug, body) {
  if (!getToken()) return alert("Sign in required.");
  const res = await fetch(`/api/model-listings/${encodeURIComponent(slug)}/review`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return alert(data.detail || "Review failed");
  }
  await loadListings();
}

async function applyBoost(slug) {
  if (!getToken()) return alert("Sign in required.");
  const message = window.prompt("Why should this product be boosted?", "High-quality model with clear documentation.") || "";
  const res = await fetch(`/api/model-listings/${encodeURIComponent(slug)}/boost`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data.detail || "Boost application failed");
  alert("Boost application submitted for review.");
  await loadListings();
}

function wireEditorToolbar() {
  const area = document.getElementById("model-body-md");
  document.querySelectorAll("[data-editor-toolbar] [data-fmt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!area) return;
      const start = area.selectionStart || 0;
      const end = area.selectionEnd || 0;
      const selected = area.value.slice(start, end) || "text";
      const fmt = btn.dataset.fmt;
      let insert = selected;
      if (fmt === "bold") insert = `**${selected}**`;
      if (fmt === "italic") insert = `*${selected}*`;
      if (fmt === "h2") insert = `## ${selected}`;
      if (fmt === "ul") insert = selected.split("\n").map((line) => `- ${line}`).join("\n");
      if (fmt === "link") insert = `[${selected}](https://)`;
      if (fmt === "code") insert = `\`${selected}\``;
      area.value = area.value.slice(0, start) + insert + area.value.slice(end);
      area.focus();
    });
  });
}

formEl?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!getToken()) return alert("Sign in to publish a product.");
  const form = new FormData(formEl);
  try {
    if (statusEl) statusEl.textContent = "Uploading product…";
    const thumbFile = form.get("thumbnail");
    let thumbnail = null;
    if (thumbFile && thumbFile.name) {
      if (thumbFile.size > 8 * 1024 * 1024) throw new Error("Thumbnail must be under 8 MB.");
      thumbnail = { name: thumbFile.name, media_type: thumbFile.type, data_url: await fileToDataUrl(thumbFile) };
    }
    const gallery = [];
    for (const file of [...(form.getAll("gallery") || [])].filter((f) => f?.name).slice(0, 8)) {
      if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is too large.`);
      gallery.push({ name: file.name, media_type: file.type, data_url: await fileToDataUrl(file) });
    }
    const files = [];
    const sourceModelFiles = droppedModelFiles.length ? droppedModelFiles : [...(form.getAll("model_files") || [])].filter((f) => f?.name);
    for (const file of sourceModelFiles.slice(0, 6)) {
      if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is too large (25 MB max).`);
      files.push({ name: file.name, media_type: file.type || "application/octet-stream", size: file.size, data_url: await fileToDataUrl(file) });
    }
    const memberEmails = String(form.get("member_emails") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((email) => ({ email, role: "member" }));
    const payload = {
      name: String(form.get("name") || "").trim(),
      tagline: String(form.get("tagline") || "").trim(),
      description: String(form.get("description") || "").trim(),
      body_md: String(form.get("body_md") || "").trim(),
      category: String(form.get("category") || "models").trim(),
      access_mode: String(form.get("access_mode") || "free"),
      license: String(form.get("license") || "proprietary"),
      download_enabled: form.get("download_enabled") === "on",
      price_cents: Number(form.get("price_cents") || 0),
      thumbnail,
      gallery,
      files,
      members: memberEmails,
    };
    const res = await fetch("/api/model-listings", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Submit failed");
    formEl.reset();
    setDroppedModelFiles([]);
    if (statusEl) statusEl.textContent = "Submitted for review.";
    await loadListings();
  } catch (err) {
    alert(err.message || "Could not submit product");
    if (statusEl) statusEl.textContent = err.message || "Submit failed";
  }
});

searchEl?.addEventListener("input", () => {
  searchQuery = searchEl.value || "";
  render();
});
[filterAccess, filterLicense, filterDownload, filterBoosted].forEach((el) => {
  el?.addEventListener("change", render);
});

wireEditorToolbar();
wireDropZone();
mountSellerPanel(document.getElementById("model-seller-host"));
bindPriceFeeHint(
  document.querySelector("#model-listing-form input[name='price_cents']"),
  document.getElementById("model-fee-hint"),
);
loadListings().catch((err) => {
  if (statusEl) statusEl.textContent = err.message || "Failed to load";
});
