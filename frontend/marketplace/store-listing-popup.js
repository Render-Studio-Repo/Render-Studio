/** Manage adding a studio file (render or CAD) to the public store / profile. */

import { authHeaders, getToken } from "../studio/auth.js";
import {
  fileBase,
  fileStem,
  isStoreImageFilename,
  isStoreModelFilename,
  listingMentionsFile,
  isFeaturedOnStore,
  withFeaturedListing,
} from "./store-listing-match.js?v=20260909-storepop1";

export const STORE_POPUP_VERSION = "20260909-storepop1";
export {
  fileBase,
  fileStem,
  isStoreImageFilename,
  isStoreModelFilename,
  listingMentionsFile,
  isFeaturedOnStore,
  withFeaturedListing,
};

const MAX_THUMB_BYTES = 1_500_000;

let openEl = null;
let openCleanup = null;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function encodeRel(filename) {
  return String(filename || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function moneyInput(cents) {
  return (Math.max(0, Number(cents || 0)) / 100).toFixed(2);
}

function readPriceCents(value) {
  return Math.round(Math.max(0, Number(value || 0)) * 100);
}

export function closeStoreListingPopup() {
  openCleanup?.();
  openCleanup = null;
  openEl?.remove();
  openEl = null;
}

async function jsonApi(api, path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body === "string" && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  return api(path, { ...options, headers });
}

async function thumbnailForImage(projectId, filename) {
  const rel = encodeRel(filename);
  const fallback = {
    url: `/api/projects/${encodeURIComponent(projectId)}/files/${rel}`,
    filename: fileBase(filename),
  };
  if (!projectId || !filename || !isStoreImageFilename(filename)) return fallback;
  try {
    const res = await fetch(fallback.url, { headers: authHeaders() });
    if (!res.ok) return fallback;
    const blob = await res.blob();
    if (!blob.size || blob.size > MAX_THUMB_BYTES) return fallback;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(blob);
    });
    if (!dataUrl.startsWith("data:image/")) return fallback;
    return { data_url: dataUrl, filename: fileBase(filename) };
  } catch {
    return fallback;
  }
}

function defaultTagline(settings, filename) {
  return String(settings?.store_tagline || "").trim() || `Studio listing · ${fileBase(filename)}`;
}

function popupHtml({ filename, label, isImage, modelFilename, showIncludeModel }) {
  const title = label || fileStem(filename) || "Listing";
  return `
    <div class="auth-backdrop" data-store-pop-close></div>
    <div class="auth-card app-dialog-card store-listing-card" role="dialog" aria-modal="true" aria-labelledby="store-listing-title">
      <button type="button" class="auth-close" data-store-pop-close aria-label="Close">&times;</button>
      <p class="workspace-manage-eyebrow">Public profile / store</p>
      <h2 id="store-listing-title" class="app-dialog-title">Manage store listing</h2>
      <p class="muted small">Add or remove <strong>${esc(fileBase(filename))}</strong> from your public store. Listings go through review before they appear in the Model Store.</p>

      <section class="store-listing-section" data-store-setup>
        <h3>Store &amp; public profile</h3>
        <label class="profile-preference-field store-listing-check">
          <span><b>Enable storefront</b></span>
          <input type="checkbox" data-store-enabled />
        </label>
        <label class="profile-preference-field store-listing-check">
          <span><b>Show store on public profile</b></span>
          <input type="checkbox" data-store-on-profile />
        </label>
        <label class="app-dialog-label">Store title
          <input type="text" maxlength="80" data-store-title placeholder="My CAD store" />
        </label>
        <label class="app-dialog-label">Store URL slug
          <input type="text" maxlength="48" data-store-slug placeholder="og-store" />
        </label>
        <p class="muted small" data-store-url-hint></p>
        <button type="button" class="btn secondary btn-compact" data-store-save-setup>Save store setup</button>
      </section>

      <section class="store-listing-section">
        <h3>This item</h3>
        <p class="muted small" data-listing-state>Checking whether this file is already listed…</p>
        <label class="app-dialog-label">Title
          <input type="text" maxlength="120" data-listing-name value="${esc(title)}" />
        </label>
        <label class="app-dialog-label">Price
          <span class="store-listing-price-row">
            <input type="number" min="0" step="0.01" data-listing-price value="9.00" />
            <select data-listing-access>
              <option value="paid">Paid</option>
              <option value="free">Free</option>
              <option value="view_only">View only</option>
            </select>
          </span>
        </label>
        <label class="app-dialog-label">Description
          <textarea rows="3" maxlength="4000" data-listing-desc placeholder="What buyers get…"></textarea>
        </label>
        <label class="profile-preference-field store-listing-check">
          <span><b>Featured on my store</b></span>
          <input type="checkbox" data-listing-featured />
        </label>
        ${
          showIncludeModel
            ? `<label class="profile-preference-field store-listing-check">
                <span><b>Include current model</b> <small class="muted">${esc(fileBase(modelFilename))}</small></span>
                <input type="checkbox" data-include-model checked />
              </label>`
            : ""
        }
        ${isImage ? `<p class="muted small">The render is used as the listing thumbnail${showIncludeModel ? "; the model is the downloadable product." : "."}</p>` : ""}
        <div class="app-dialog-actions store-listing-actions">
          <button type="button" class="btn accent" data-listing-save>Add to store</button>
          <button type="button" class="btn secondary" data-listing-remove hidden>Remove from store</button>
        </div>
      </section>

      <div class="store-listing-links">
        <button type="button" class="btn secondary btn-compact" data-customize-studio>Customize store in Studio…</button>
        <a class="btn secondary btn-compact" data-customize-public href="/marketplace.html#/sell">Edit store (banner, layout)</a>
      </div>
      <p class="muted small" data-store-pop-status></p>
    </div>
  `;
}

/**
 * @param {object} opts
 * @param {(path: string, options?: object) => Promise<any>} opts.api
 * @param {string} [opts.projectId]
 * @param {string} opts.filename
 * @param {string} [opts.kind]
 * @param {string} [opts.label]
 * @param {string} [opts.modelFilename]
 * @param {(level: string, message: string) => void} [opts.onStatus]
 */
export async function openStoreListingPopup(opts = {}) {
  const {
    api,
    projectId = "",
    filename,
    kind = "",
    label = "",
    modelFilename = "",
    onStatus,
  } = opts;
  const file = String(filename || "").trim();
  if (!file) return;
  closeStoreListingPopup();

  const isImage = isStoreImageFilename(file) || String(kind).toLowerCase() === "image";
  const model = isStoreModelFilename(modelFilename) ? modelFilename : "";
  const showIncludeModel = isImage && !!model && fileBase(model) !== fileBase(file);

  const modal = document.createElement("div");
  modal.className = "auth-modal store-listing-modal";
  modal.innerHTML = popupHtml({ filename: file, label, isImage, modelFilename: model, showIncludeModel });
  document.body.appendChild(modal);
  openEl = modal;

  const $ = (sel) => modal.querySelector(sel);
  const statusEl = $("[data-store-pop-status]");
  const setStatus = (msg) => {
    if (statusEl) statusEl.textContent = msg || "";
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") closeStoreListingPopup();
  };
  openCleanup = () => document.removeEventListener("keydown", onKey);
  document.addEventListener("keydown", onKey);
  modal.querySelectorAll("[data-store-pop-close]").forEach((el) => {
    el.addEventListener("click", closeStoreListingPopup);
  });

  if (!getToken()) {
    $("[data-listing-state]").textContent = "Sign in to publish to your public store.";
    $("[data-listing-save]").disabled = true;
    $("[data-store-save-setup]").disabled = true;
    setStatus("Sign in required.");
    onStatus?.("error", "Sign in to add this to your public store.");
    return;
  }

  let storeSettings = {};
  let listing = null;
  let storeMe = null;

  function paintSetup() {
    $("[data-store-enabled]").checked = !!storeSettings.store_enabled;
    $("[data-store-on-profile]").checked = storeSettings.show_on_profile !== false;
    $("[data-store-title]").value = storeSettings.store_title || "";
    const slug = storeSettings.store_slug || storeMe?.slug || "";
    $("[data-store-slug]").value = slug;
    const url = storeMe?.store_url || (slug ? `https://render3d.app/${slug}` : "");
    $("[data-store-url-hint]").textContent = url
      ? `Public store: ${url}`
      : "Pick a slug to get a public link like render3d.app/og-store.";
    const publicHref = slug ? `/${encodeURIComponent(slug)}` : "/marketplace.html#/sell";
    const publicLink = $("[data-customize-public]");
    if (publicLink) {
      publicLink.href = publicHref;
      publicLink.textContent = slug ? "Edit store (banner, layout)" : "Edit store — seller desk";
    }
  }

  function paintListing() {
    const live = listing && String(listing.status || "").toLowerCase() !== "archived";
    const state = $("[data-listing-state]");
    const saveBtn = $("[data-listing-save]");
    const removeBtn = $("[data-listing-remove]");
    if (live) {
      const badge = listing.status === "approved" ? "on your public store" : `listed (${listing.status})`;
      state.textContent = `This item is ${badge}. Update the fields below, or remove it.`;
      saveBtn.textContent = "Save listing";
      removeBtn.hidden = false;
      $("[data-listing-name]").value = listing.name || fileStem(file);
      $("[data-listing-desc]").value = listing.description || "";
      $("[data-listing-access]").value = listing.access_mode || "paid";
      $("[data-listing-price]").value = moneyInput(listing.price_cents);
      $("[data-listing-featured]").checked = isFeaturedOnStore(listing, storeSettings);
    } else {
      state.textContent = "Not on your store yet. Fill in a title and description, then add it.";
      saveBtn.textContent = "Add to store";
      removeBtn.hidden = true;
      if (!$("[data-listing-name]").value) $("[data-listing-name]").value = label || fileStem(file);
      if (!$("[data-listing-desc]").value) {
        $("[data-listing-desc]").value = defaultTagline(storeSettings, file);
      }
      if (storeSettings.default_access_mode) $("[data-listing-access]").value = storeSettings.default_access_mode;
      if (storeSettings.default_price_cents != null) $("[data-listing-price]").value = moneyInput(storeSettings.default_price_cents);
      $("[data-listing-featured]").checked = false;
    }
  }

  async function load() {
    setStatus("Loading store…");
    try {
      const [settingsRes, listingsRes, meRes] = await Promise.all([
        jsonApi(api, "/api/users/me/store-settings").catch(() => ({ store_settings: {} })),
        jsonApi(api, "/api/model-listings?mine=1").catch(() => ({ listings: [] })),
        jsonApi(api, "/api/marketplace/store/me").catch(() => null),
      ]);
      storeSettings = settingsRes.store_settings || {};
      storeMe = meRes;
      if (!storeSettings.store_slug && meRes?.slug) storeSettings.store_slug = meRes.slug;
      const mine = listingsRes.listings || [];
      listing = mine.find((row) => listingMentionsFile(row, file, projectId))
        || mine.find((row) => listingMentionsFile(row, file, projectId, { includeArchived: true }))
        || null;
      paintSetup();
      paintListing();
      setStatus("");
    } catch (err) {
      setStatus(err.message || "Could not load store.");
    }
  }

  async function saveSetup() {
    const slug = String($("[data-store-slug]").value || "").trim().toLowerCase();
    setStatus("Saving store setup…");
    try {
      if (slug && slug !== String(storeSettings.store_slug || storeMe?.slug || "")) {
        const slugRes = await jsonApi(api, "/api/marketplace/store/slug", {
          method: "POST",
          body: JSON.stringify({ slug }),
        });
        storeSettings.store_slug = slugRes.slug || slug;
        if (storeMe) {
          storeMe.slug = slugRes.slug || slug;
          storeMe.store_url = slugRes.url || storeMe.store_url;
        }
      }
      const payload = {
        ...storeSettings,
        store_enabled: !!$("[data-store-enabled]").checked,
        show_on_profile: !!$("[data-store-on-profile]").checked,
        store_title: $("[data-store-title]").value.trim(),
        store_slug: slug || storeSettings.store_slug || "",
      };
      const data = await jsonApi(api, "/api/users/me/store-settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      storeSettings = data.store_settings || payload;
      paintSetup();
      setStatus("Store setup saved.");
      onStatus?.("ok", "Store setup saved.");
    } catch (err) {
      setStatus(err.message || "Could not save store setup.");
      onStatus?.("error", err.message || "Could not save store setup.");
    }
  }

  async function persistFeatured(listingId, featured) {
    const next = withFeaturedListing(storeSettings, listingId, featured);
    const data = await jsonApi(api, "/api/users/me/store-settings", {
      method: "PUT",
      body: JSON.stringify(next),
    });
    storeSettings = data.store_settings || next;
  }

  function listingPayload() {
    const name = $("[data-listing-name]").value.trim() || fileStem(file);
    const access = $("[data-listing-access]").value || storeSettings.default_access_mode || "paid";
    const description = $("[data-listing-desc]").value.trim() || defaultTagline(storeSettings, file);
    const tagline = description.slice(0, 180);
    const price_cents = access === "paid" ? Math.max(readPriceCents($("[data-listing-price]").value), storeSettings.default_price_cents || 100) : 0;
    return {
      name,
      tagline,
      description,
      license: storeSettings.default_license || "proprietary",
      access_mode: access,
      billing_type: storeSettings.default_billing_type || "one_time",
      currency: storeSettings.default_currency || "USD",
      price_cents,
      download_enabled: storeSettings.download_enabled !== false && access !== "view_only",
    };
  }

  async function saveListing() {
    if (!projectId && !listing) {
      setStatus("Open a project first.");
      return;
    }
    setStatus(listing ? "Saving listing…" : "Adding to store…");
    const body = listingPayload();
    try {
      if (!storeSettings.store_enabled) {
        $("[data-store-enabled]").checked = true;
        await saveSetup();
      }
      const includeModel = showIncludeModel && !!$("[data-include-model]")?.checked;
      const modelFile = includeModel ? model : (isStoreModelFilename(file) ? file : "");
      if (isImage) body.thumbnail = await thumbnailForImage(projectId, file);
      if (listing) {
        const data = await jsonApi(api, `/api/model-listings/${encodeURIComponent(listing.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...body,
            ...(String(listing.status || "").toLowerCase() === "archived" ? { status: "pending" } : {}),
          }),
        });
        listing = data.listing || listing;
      } else {
        if (projectId && modelFile) {
          body.project_id = projectId;
          body.project_filenames = [modelFile];
        }
        const data = await jsonApi(api, "/api/model-listings", {
          method: "POST",
          body: JSON.stringify(body),
        });
        listing = data.listing || listing;
        setStatus(data.message || "Submitted for review.");
      }
      if (listing?.id) {
        await persistFeatured(listing.id, !!$("[data-listing-featured]").checked);
      }
      paintListing();
      if (!statusEl.textContent) setStatus("Listing saved.");
      onStatus?.("ok", listing?.status === "pending" ? "Submitted for store review." : "Store listing updated.");
    } catch (err) {
      setStatus(err.message || "Could not save listing.");
      onStatus?.("error", err.message || "Could not save listing.");
    }
  }

  async function removeListing() {
    if (!listing?.id) return;
    setStatus("Removing from store…");
    try {
      const data = await jsonApi(api, `/api/model-listings/${encodeURIComponent(listing.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      });
      listing = data.listing || { ...listing, status: "archived" };
      await persistFeatured(listing.id, false);
      paintListing();
      setStatus("Removed from your public store.");
      onStatus?.("ok", "Removed from your public store.");
    } catch (err) {
      setStatus(err.message || "Could not remove listing.");
      onStatus?.("error", err.message || "Could not remove listing.");
    }
  }

  $("[data-store-save-setup]").addEventListener("click", () => void saveSetup());
  $("[data-listing-save]").addEventListener("click", () => void saveListing());
  $("[data-listing-remove]").addEventListener("click", () => void removeListing());
  $("[data-customize-studio]").addEventListener("click", () => {
    closeStoreListingPopup();
    window.dispatchEvent(new CustomEvent("render3d:open-store-preferences"));
  });
  $("[data-listing-access]").addEventListener("change", () => {
    const paid = $("[data-listing-access]").value === "paid";
    $("[data-listing-price]").disabled = !paid;
  });

  await load();
}

export default { openStoreListingPopup, closeStoreListingPopup, listingMentionsFile };
