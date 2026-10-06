import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listingMentionsFile,
  isFeaturedOnStore,
  withFeaturedListing,
  isStoreImageFilename,
  isStoreModelFilename,
} from "./store-listing-match.js";

const here = dirname(fileURLToPath(import.meta.url));

test("listingMentionsFile matches project files and image thumbnails, skips archived", () => {
  const listing = {
    status: "pending",
    files: [{ name: "bracket.glb", project_id: "p1" }],
    thumbnail: { filename: "hero.png" },
  };
  assert.equal(listingMentionsFile(listing, "mesh/bracket.glb", "p1"), true);
  assert.equal(listingMentionsFile(listing, "hero.png", "p1"), true);
  assert.equal(listingMentionsFile(listing, "other.glb", "p1"), false);
  assert.equal(listingMentionsFile({ ...listing, status: "archived" }, "bracket.glb", "p1"), false);
  assert.equal(listingMentionsFile({ ...listing, status: "archived" }, "bracket.glb", "p1", { includeArchived: true }), true);
});

test("featured listing ids toggle without dropping siblings", () => {
  const settings = { store_enabled: true, featured_listing_ids: ["a"] };
  assert.equal(isFeaturedOnStore({ id: "a" }, settings), true);
  const on = withFeaturedListing(settings, "b", true);
  assert.deepEqual(on.featured_listing_ids, ["a", "b"]);
  const off = withFeaturedListing(on, "a", false);
  assert.deepEqual(off.featured_listing_ids, ["b"]);
});

test("image vs model helpers", () => {
  assert.equal(isStoreImageFilename("Renders/shot.PNG"), true);
  assert.equal(isStoreModelFilename("mesh/part.step"), true);
  assert.equal(isStoreModelFilename("shot.png"), false);
});

test("popup talks to existing marketplace APIs and customize actions", () => {
  const src = readFileSync(join(here, "store-listing-popup.js"), "utf8");
  assert.match(src, /\/api\/model-listings\?mine=1/);
  assert.match(src, /\/api\/users\/me\/store-settings/);
  assert.match(src, /\/api\/marketplace\/store\/me/);
  assert.match(src, /\/api\/marketplace\/store\/slug/);
  assert.match(src, /render3d:open-store-preferences/);
  assert.match(src, /Edit store \(banner, layout\)/);
  assert.match(src, /data-listing-featured/);
  assert.match(src, /data-listing-remove/);
  assert.match(src, /status: "archived"/);
  assert.equal(src.includes("20260909-storepop1"), true);
});

test("image context menu keeps download types, store item, and no copy-link/export-share on images", () => {
  const ref = readFileSync(join(here, "../components/reference-files.js"), "utf8");
  const start = ref.indexOf("function showReferenceContextMenu");
  const end = ref.indexOf("async function handleDownload", start);
  const fn = ref.slice(start, end);
  assert.match(fn, /data-ref-context="store"/);
  assert.match(fn, /imageDownloadTypeButtons/);
  assert.match(ref, /data-ref-download="png"/);
  assert.match(ref, /data-ref-download="jpg"/);
  assert.match(fn, /isImage \? "" : `<button type="button" data-ref-context="copy-link"/);
  assert.equal(fn.includes('isImage ? `<button type="button" data-ref-context="share-link"'), false);
});

test("app.js opens the store popup instead of a dead preferences jump", () => {
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(app, /openStoreListingPopup/);
  assert.match(app, /store-listing-popup\.js\?v=20260909-storepop1/);
  const start = app.indexOf('if (payload.action === "store")');
  assert.ok(start > 0);
  const block = app.slice(start, start + 500);
  assert.match(block, /openStoreListingPopup/);
  assert.equal(block.includes("openPreferencesModal"), false);
});
