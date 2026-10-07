import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GUEST_PUBLIC_LIST_LIMIT,
  ONLINE_MODELS_CACHE,
  ONLINE_MODELS_DEFAULT_TAB,
  ONLINE_MODELS_RETURN_KEY,
  consumeOnlineModelsReturn,
  defaultOnlineModelsTab,
  guestPublicVisibleSlice,
  isGuestExplorerUser,
  isNewOrGuestExplorer,
  onlineModelsNeedsLogin,
  peekOnlineModelsReturn,
  publicProfileHref,
  publicProjectThumbUrl,
  shouldShowPublicHover,
  withGuestPublicPin,
  writeOnlineModelsReturn,
} from "./online-models.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
const browser = readFileSync(join(here, "../workspace/workspace-browser.js"), "utf8");
const panel = readFileSync(join(here, "online-models-panel.js"), "utf8");

test("guest Public list is capped at 10 and pins first featured", () => {
  assert.equal(GUEST_PUBLIC_LIST_LIMIT, 10);
  const rows = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, name: `Model ${i}` }));
  const sliced = guestPublicVisibleSlice(rows);
  assert.equal(sliced.length, 10);
  assert.equal(sliced[0].public_pinned, true);
  assert.equal(sliced[0].guest_pin, true);
  const already = withGuestPublicPin([
    { id: "a", public_pinned: false },
    { id: "pin", public_pinned: true },
  ]);
  assert.equal(already[1].id, "pin");
  assert.equal(already.find((p) => p.id === "pin").guest_pin, undefined);
});

test("guest explorer helpers treat signed-out and empty personal as new", () => {
  assert.equal(isGuestExplorerUser(null), true);
  assert.equal(isGuestExplorerUser("u1"), false);
  assert.equal(isNewOrGuestExplorer("", [{ id: "pub", public: true }]), true);
  assert.equal(isNewOrGuestExplorer("u1", [{ id: "mine", public: false }]), false);
});

test("hover hides when the context menu is open", () => {
  assert.equal(shouldShowPublicHover({ contextMenuOpen: false }), true);
  assert.equal(shouldShowPublicHover({ contextMenuOpen: true }), false);
});

test("login is required for remix/send/add but not copy-link or public prompts", () => {
  assert.equal(onlineModelsNeedsLogin("remix", { signedIn: false }), true);
  assert.equal(onlineModelsNeedsLogin("add-new-project", { signedIn: false }), true);
  assert.equal(onlineModelsNeedsLogin("send-to", { signedIn: false }), true);
  assert.equal(onlineModelsNeedsLogin("copy-link", { signedIn: false }), false);
  assert.equal(onlineModelsNeedsLogin("prompt-history", { signedIn: false }), false);
  assert.equal(onlineModelsNeedsLogin("remix", { signedIn: true }), false);
});

test("profile href and public thumb rewrite stay on public routes", () => {
  assert.equal(publicProfileHref({ owner_handle: "SamW" }), "/u/SamW");
  assert.equal(
    publicProjectThumbUrl({ id: "abc", preview_url: "/api/projects/abc/thumb?v=1" }),
    "/api/public/projects/abc/thumb?v=1",
  );
});

test("login return keeps Online Models open", () => {
  const store = new Map();
  const storage = {
    setItem: (k, v) => store.set(k, v),
    getItem: (k) => store.get(k) || null,
    removeItem: (k) => store.delete(k),
  };
  writeOnlineModelsReturn({ tab: "public", pendingAction: { action: "remix", projectId: "abc" } }, storage);
  const peeked = peekOnlineModelsReturn(storage);
  assert.equal(peeked.open, true);
  assert.equal(peeked.tab, ONLINE_MODELS_DEFAULT_TAB);
  assert.equal(peeked.pendingAction.action, "remix");
  const taken = consumeOnlineModelsReturn(storage);
  assert.equal(taken.open, true);
  assert.equal(peekOnlineModelsReturn(storage), null);
  assert.equal(ONLINE_MODELS_RETURN_KEY, "openOnlineModels");
  assert.equal(defaultOnlineModelsTab(), "public");
  assert.equal(defaultOnlineModelsTab("marketplace"), "marketplace");
});

test("guest tree expands Public, View more opens catalog, compact rows", () => {
  assert.match(browser, /isNewOrGuestExplorer/);
  assert.match(browser, /expandPublicFolder/);
  assert.match(browser, /GUEST_PUBLIC_LIST_LIMIT/);
  assert.match(browser, /View more →/);
  assert.match(browser, /onOpenOnlineModels/);
  assert.match(browser, /proj-item--public-compact/);
  assert.match(browser, /proj-public-hover/);
  assert.match(browser, /proj-context-menu-open/);
  assert.match(browser, /shouldShowPublicHover/);
  assert.match(browser, /explorer-guest-public/);
  assert.match(css, /proj-item--public-compact/);
  assert.match(css, /text-overflow:\s*ellipsis/);
  assert.match(css, /body\.proj-context-menu-open \.proj-public-hover/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /z-index:\s*12000/);
});

test("left explorer public section says Public projects, not Unfiled", () => {
  assert.match(browser, /PUBLIC_PROJECTS_LABEL = "Public projects"/);
  assert.match(browser, /publicExplorerFolderLabel/);
  assert.match(browser, /folder-group-label--public/);
  assert.match(browser, /folder-zone--public/);
  assert.match(browser, /folder-header--public/);
  assert.equal(/appendFolderGroupLabel\([^)]*"Unfiled"/.test(browser), false);
  assert.match(css, /\.folder-group-label--public/);
  assert.match(css, /\.folder-zone--public \.folder-header--public/);
  assert.match(css, /\.folder-zone--public \.folder-title/);
  assert.match(css, /font-size:\s*0\.82rem/);
  assert.match(css, /font-size:\s*0\.92rem/);
});

test("Online Models popup defaults to Public projects", () => {
  assert.match(panel, /aria-label="Online Models"/);
  assert.match(panel, /data-om-tab="public"/);
  assert.match(panel, /data-om-tab="marketplace"/);
  assert.match(panel, /Public projects/);
  assert.match(panel, /Marketplace/);
  assert.match(panel, /ONLINE_MODELS_DEFAULT_TAB/);
  assert.match(panel, /Log in to remix/);
  assert.match(app, /createOnlineModelsPanel/);
  assert.match(app, /restoreOnlineModelsAfterAuth/);
  assert.match(app, /openOnlineModelsCatalog/);
});

test("online-models marketplace aborts the previous catalog GETs", () => {
  assert.match(panel, /let onlineModelsAbort = null; \/\/ leakfix71/);
  assert.match(panel, /async function loadMarketplace\(\)[\s\S]{0,900}signal: ctl\.signal/);
});

test("cache-bust onlinemod1 merges without dropping XR/pty/find tokens", () => {
  assert.equal(ONLINE_MODELS_CACHE, "onlinemod1");
  assert.match(html, /styles\.css\?v=[^"']*onlinemod1/);
  assert.match(html, /app\.js\?v=[^"']*onlinemod1/);
  assert.match(html, /app\.js\?v=[^"']*pty1/);
  assert.match(html, /app\.js\?v=[^"']*xrclick1/);
  assert.match(html, /app\.js\?v=[^"']*xrctl1/);
  assert.match(html, /app\.js\?v=[^"']*xrstick1/);
  assert.match(html, /app\.js\?v=[^"']*xrrest1/);
  assert.match(html, /app\.js\?v=[^"']*xrrest2/);
  assert.match(html, /app\.js\?v=[^"']*mobui1/);
  assert.match(html, /app\.js\?v=[^"']*gifbtn1/);
  assert.match(html, /app\.js\?v=[^"']*findui1/);
  assert.match(html, /app\.js\?v=[^"']*imageref1/);
  assert.match(html, /app\.js\?v=[^"']*esctran1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*onlinemod1/);
  assert.match(app, /online-models-panel\.js\?v=onlinemod1/);
});

test("publishing your only project does not switch to the guest explorer", () => {
  assert.equal(isNewOrGuestExplorer("u1", [{ id: "mine", public: true, owner_user_id: "u1" }]), false);
  assert.equal(isNewOrGuestExplorer("u2", [{ id: "mine", public: true, owner_user_id: "u1" }]), true);
});
