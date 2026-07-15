import { authHeaders, getToken } from "./auth.js";
import {
  bindPriceFeeHint,
  isPaidListing,
  mountSellerPanel,
  startCheckout,
} from "./marketplace-payments.js?v=20260715-mkt-payments";

const listEl = document.getElementById("kb-store-list");
const statusEl = document.getElementById("kb-store-status");
const formEl = document.getElementById("kb-listing-form");
const categoriesEl = document.getElementById("kb-store-categories");
const featuredSectionEl = document.getElementById("kb-featured-section");
const featuredListEl = document.getElementById("kb-featured-list");
const searchEl = document.getElementById("kb-store-search");
const resultsTitleEl = document.getElementById("kb-store-results-title");
const resultsCountEl = document.getElementById("kb-store-results-count");
const filterAccess = document.getElementById("kb-filter-access");
const filterLicense = document.getElementById("kb-filter-license");
const filterDownload = document.getElementById("kb-filter-download");
const filterBoosted = document.getElementById("kb-filter-boosted");
const dropZone = document.querySelector("[data-kb-drop]");
const fileInput = formEl?.querySelector("input[name='kb_files']");

let listings = [];
let isAdmin = false;
let activeCategory = "All";
let searchQuery = "";
let droppedFiles = [];

const DEFAULT_CATEGORIES = ["All", "Featured", "Boosted", "Robotics", "CAD Standards", "Prompt Packs", "Support", "Free", "Paid", "View only"];

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

function simpleMarkdown(text) {
  let html = escapeHtml(text || "");
  html = html.replace(/^##\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^\*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  return html.replace(/\n/g, "<br>");
}

function isKnowledgeListing(item) {
  return (item.files || []).some((file) => file?.product_type === "knowledge_base")
    || String(item.category || "").toLowerCase().includes("knowledge");
}

function knowledgeFiles(item) {
  return (item.files || []).filter((file) => file?.product_type === "knowledge_base" || file?.name);
}

function thumbUrl(item) {
  return item.thumbnail?.data_url || item.gallery?.[0]?.data_url || "";
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
  const files = knowledgeFiles(item);
  const media = thumb
    ? `<div class="marketplace-thumb" style="background-image:url('${escapeAttr(thumb)}')"></div>`
    : `<div class="marketplace-thumb marketplace-thumb--empty marketplace-thumb--kb">KB</div>`;
  const adminControls = isAdmin
    ? `<div class="agent-admin-controls">
        <button type="button" class="btn secondary btn-compact" data-review="${escapeAttr(item.slug)}" data-status="approved">Approve</button>
        <button type="button" class="btn secondary btn-compact" data-review="${escapeAttr(item.slug)}" data-status="rejected">Reject</button>
        <button type="button" class="btn secondary btn-compact" data-feature="${escapeAttr(item.slug)}">${item.featured ? "Unfeature" : "Feature"}</button>
      </div>`
    : "";
  const paid = isPaidListing(item);
  const buyBtn = paid
    ? `<button type="button" class="btn primary btn-compact" data-buy="${escapeAttr(item.id || item.slug)}">Buy ${escapeHtml(priceLabel(item))}</button>`
    : "";
  return `<article class="agent-product-card marketplace-product-card knowledge-product-card${compact ? " agent-product-card-compact" : ""}">
    ${media}
    <div class="agent-product-top">
      <div class="agent-app-price">${escapeHtml(priceLabel(item))}</div>
    </div>
    <h4>${escapeHtml(item.name)}</h4>
    <p class="agent-product-slug mono muted small">@knowledge-base:${escapeHtml(item.slug)}</p>
    <div class="agent-app-badges">${badges(item)}</div>
    <p class="agent-product-tagline">${escapeHtml(item.tagline)}</p>
    ${compact ? "" : `<div class="marketplace-body muted small">${simpleMarkdown((item.body_md || item.description || "").slice(0, 480))}</div>`}
    <div class="agent-app-actions">
      ${buyBtn}
      <span class="muted small">${files.length} file${files.length === 1 ? "" : "s"} · ${item.can_download ? "downloadable" : "preview only"}</span>
      ${getToken() && item.created_by ? `<button type="button" class="btn secondary btn-compact" data-boost="${escapeAttr(item.slug)}">Apply boost</button>` : ""}
    </div>
    ${adminControls}
  </article>`;
}

function matchesFilters(item) {
  if (!isKnowledgeListing(item)) return false;
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
  const hay = [
    item.name,
    item.slug,
    item.tagline,
    item.description,
    item.body_md,
    item.category,
    item.license,
    item.access_mode,
    item.owner?.name,
    ...knowledgeFiles(item).map((file) => file.name),
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

function visibleListings() {
  return listings.filter(matchesFilters);
}

function renderCategories() {
  if (!categoriesEl) return;
  const kbListings = listings.filter(isKnowledgeListing);
  const set = new Set(DEFAULT_CATEGORIES);
  kbListings.forEach((item) => item.category && set.add(item.category));
  categoriesEl.innerHTML = [...set].map((category) => {
    const count = category === "All"
      ? kbListings.length
      : kbListings.filter((item) => {
          const prev = activeCategory;
          activeCategory = category;
          const ok = matchesFilters(item);
          activeCategory = prev;
          return ok;
        }).length;
    return `<button type="button" class="agent-category-tile${category === activeCategory ? " active" : ""}" data-category="${escapeAttr(category)}">
      <strong>${escapeHtml(category)}</strong><span>${count}</span>
    </button>`;
  }).join("");
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
    btn.addEventListener("click", () => reviewListing(btn.dataset.feature, { status: item?.status || "approved", featured: !item?.featured }));
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
        const result = await startCheckout({ kind: "knowledge", listingId: btn.dataset.buy });
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
}

function render() {
  const visible = visibleListings();
  const kbListings = listings.filter(isKnowledgeListing);
  const featured = kbListings.filter((item) => item.featured || item.boost_status === "approved");
  if (resultsCountEl) resultsCountEl.textContent = `${visible.length} knowledge base${visible.length === 1 ? "" : "s"}`;
  if (resultsTitleEl) resultsTitleEl.textContent = activeCategory === "All" ? "All knowledge bases" : activeCategory;
  renderCategories();
  if (featuredSectionEl && featuredListEl) {
    featuredSectionEl.classList.toggle("hidden", !featured.length);
    featuredListEl.innerHTML = featured.slice(0, 8).map((item) => productCard(item, { compact: true })).join("");
    bindActions(featuredListEl);
  }
  if (listEl) {
    listEl.innerHTML = visible.length
      ? visible.map((item) => productCard(item)).join("")
      : `<p class="muted">No knowledge bases match these filters yet.</p>`;
    bindActions(listEl);
  }
}

async function loadListings() {
  if (statusEl) statusEl.textContent = "Loading knowledge bases...";
  const params = new URLSearchParams();
  if (getToken()) params.set("include_pending", "1");
  const res = await fetch(`/api/model-listings?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Could not load knowledge base marketplace.");
  const data = await res.json();
  listings = data.listings || [];
  isAdmin = !!data.admin;
  const count = listings.filter(isKnowledgeListing).length;
  if (statusEl) statusEl.textContent = `${count} knowledge base${count === 1 ? "" : "s"} available${isAdmin ? " · admin review enabled" : ""}`;
  render();
}

async function reviewListing(slug, body) {
  if (!getToken()) return alert("Sign in required.");
  const res = await fetch(`/api/model-listings/${encodeURIComponent(slug)}/review`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data.detail || "Review failed");
  await loadListings();
}

async function applyBoost(slug) {
  if (!getToken()) return alert("Sign in required.");
  const message = window.prompt("Why should this knowledge base be boosted?", "Clear reusable docs and prompt context.") || "";
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

function syncDropLabel() {
  if (!dropZone) return;
  dropZone.classList.toggle("has-files", droppedFiles.length > 0);
  dropZone.innerHTML = droppedFiles.length
    ? `<strong>${droppedFiles.length} file${droppedFiles.length === 1 ? "" : "s"} ready</strong><span>${escapeHtml(droppedFiles.slice(0, 4).map((file) => file.name).join(", "))}${droppedFiles.length > 4 ? "..." : ""}</span>`
    : `<strong>Drop knowledge base files here</strong><span>PDF, Markdown, TXT, CSV, JSON, STEP/STL/GLB, images, and ZIP-style reference packs.</span>`;
}

function setDroppedFiles(files) {
  droppedFiles = [...files].filter((file) => file?.name).slice(0, 16);
  syncDropLabel();
}

function wireDropZone() {
  if (!dropZone || !fileInput) return;
  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => setDroppedFiles(fileInput.files || []));
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

function wireEditorToolbar() {
  const area = document.getElementById("kb-body-md");
  document.querySelectorAll("[data-kb-editor-toolbar] [data-fmt]").forEach((btn) => {
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
      if (fmt === "code") insert = `\`${selected}\``;
      area.value = area.value.slice(0, start) + insert + area.value.slice(end);
      area.focus();
    });
  });
}

formEl?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!getToken()) return alert("Sign in to publish a knowledge base.");
  const form = new FormData(formEl);
  try {
    if (statusEl) statusEl.textContent = "Uploading knowledge base...";
    const thumbFile = form.get("thumbnail");
    let thumbnail = null;
    if (thumbFile && thumbFile.name) {
      if (thumbFile.size > 8 * 1024 * 1024) throw new Error("Cover image must be under 8 MB.");
      thumbnail = { name: thumbFile.name, media_type: thumbFile.type, data_url: await fileToDataUrl(thumbFile) };
    }
    const sourceFiles = droppedFiles.length ? droppedFiles : [...(form.getAll("kb_files") || [])].filter((f) => f?.name);
    const files = [];
    for (const file of sourceFiles.slice(0, 16)) {
      if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is too large (25 MB max).`);
      const textLike = /^text\//i.test(file.type || "") || /\.(txt|md|csv|json|yaml|yml)$/i.test(file.name || "");
      files.push({
        name: file.name,
        media_type: file.type || "application/octet-stream",
        size: file.size,
        product_type: "knowledge_base",
        ...(textLike ? { text: (await fileToText(file)).slice(0, 40000) } : { data_url: await fileToDataUrl(file) }),
      });
    }
    if (!files.length) throw new Error("Add at least one knowledge base file.");
    const members = String(form.get("member_emails") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((email) => ({ email, role: "member" }));
    const category = String(form.get("category") || "Knowledge Base").trim() || "Knowledge Base";
    const payload = {
      name: String(form.get("name") || "").trim(),
      tagline: String(form.get("tagline") || "").trim(),
      description: String(form.get("description") || "").trim(),
      body_md: String(form.get("body_md") || "").trim(),
      category,
      access_mode: String(form.get("access_mode") || "free"),
      license: String(form.get("license") || "proprietary"),
      download_enabled: form.get("download_enabled") === "on",
      price_cents: Number(form.get("price_cents") || 0),
      thumbnail,
      gallery: [],
      files,
      members,
    };
    const res = await fetch("/api/model-listings", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Submit failed");
    formEl.reset();
    setDroppedFiles([]);
    if (statusEl) statusEl.textContent = "Knowledge base submitted for review.";
    await loadListings();
  } catch (err) {
    alert(err.message || "Could not submit knowledge base");
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

wireDropZone();
wireEditorToolbar();
mountSellerPanel(document.getElementById("kb-seller-host"));
bindPriceFeeHint(
  document.querySelector("#kb-listing-form input[name='price_cents']"),
  document.getElementById("kb-fee-hint"),
);
loadListings().catch((err) => {
  if (statusEl) statusEl.textContent = err.message || "Failed to load";
});
