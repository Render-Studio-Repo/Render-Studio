import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const auth = readFileSync(join(here, "auth.js"), "utf8");
const app = readFileSync(join(here, "app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "styles.css"), "utf8");

test("signed-in avatar primary click opens the account flyout, not the profile overlay", () => {
  assert.equal(auth.includes("onProfileOpen"), false);
  assert.match(auth, /btnAuth\?\.addEventListener\("click"/);
  assert.match(auth, /if \(loggedInUser\) \{\n      toggleUserMenu\(\);/);
  assert.equal(/if \(typeof onProfileOpen === "function"\)/.test(auth), false);
  assert.equal(html.includes("btn-account-menu"), false);
  assert.match(html, /id="btn-public-profile-menu"/);
  assert.match(html, /Manage profile and store/);
  assert.match(app, /btn-public-profile-menu/);
  assert.match(app, /userProfileUi\?\.open\?\.\(\{ userId: currentUser\.id \}\)/);
  assert.equal(app.includes("onProfileOpen:"), false);
  assert.match(html, /app\.js\?v=20260908-.*acctfly1/);
  assert.match(html, /styles\.css\?v=[^"']*acctfly1/);
  assert.match(html, /app\.js\?v=20260908-.*dimospf1/);
  assert.match(html, /styles\.css\?v=[^"']*dimospf1/);
  assert.match(html, /app\.js\?v=20260908-.*acctovl1/);
  assert.match(html, /styles\.css\?v=[^"']*acctovl1/);
});

test("account flyout does not use a desktop full-screen dimmer; menu stacks above CAD/Render chrome", () => {
  const css = readFileSync(join(here, "styles.css"), "utf8");
  const vr = readFileSync(join(here, "../xr/vr-browser.js"), "utf8");
  assert.match(css, /html:not\(\.vr-headset-browser\) #user-menu-backdrop/);
  assert.match(css, /body\.user-menu-open \.toolbar/);
  assert.match(css, /\.user-menu \{[\s\S]*?z-index: 20100/);
  assert.match(vr, /showBackdrop = open && isVrHeadsetBrowser\(\)/);
  assert.match(auth, /document\.body\?\.classList\.toggle\("user-menu-open", !!opening\)/);
});

test("preferences Robotics tab wires robot host IP to dimosWs storage", () => {
  assert.match(app, /\["robotics", "Robotics"\]/);
  assert.match(app, /data-pref-main-tab=/);
  assert.match(app, /Robot host IP/);
  assert.match(app, /id="pref-dimos-ws-url"/);
  assert.match(app, /persistDimosWsUrl/);
  assert.match(app, /formatDimosHostInput/);
  assert.match(app, /dimosQuestTeleopUrl/);
  assert.match(app, /\/api\/dimos\/ws/);
});

test("account preferences use a top tab strip and keep receive money on Payments", () => {
  assert.match(app, /PREFERENCES_MAIN_TABS/);
  const tabs = app.slice(app.indexOf("const PREFERENCES_MAIN_TABS"), app.indexOf("const PREFERENCES_MAIN_TABS") + 400);
  assert.ok(tabs.indexOf('["general", "General"]') < tabs.indexOf('["robotics", "Robotics"]'));
  assert.match(app, /\["robotics", "Robotics"\]/);
  assert.match(app, /\["payments", "Payments"\]/);
  assert.match(app, /\["notifications", "Notifications"\]/);
  assert.match(app, /\["general", "General"\]/);
  assert.match(app, /\["calendar", "Calendar"\]/);
  assert.match(app, /\["controllers", "Controllers"\]/);
  assert.match(app, /pref-receive-payments-root/);
  assert.match(app, /preferencesMainTab === "payments"/);
  assert.match(app, /profile-pref-tabs/);
  assert.match(html, /proftabs1/);
  assert.match(css, /\.profile-pref-tabs/);
  assert.match(css, /\.profile-pref-tab\.is-active/);
  assert.match(css, /\.profile-status-icon-select/);
  assert.match(css, /\.pref-avail-editor/);
});

test("avatar right-click also toggles the same account flyout", () => {
  assert.match(auth, /btnAuth\?\.addEventListener\("contextmenu"/);
  const ctx = auth.slice(auth.indexOf('btnAuth?.addEventListener("contextmenu"'));
  assert.match(ctx, /toggleUserMenu\(\)/);
});

test("account flyout header is a stable row: avatar, then name over email, icon-only close", () => {
  const headerStart = html.indexOf('id="user-menu"');
  const header = html.slice(headerStart, html.indexOf("user-menu-meta", headerStart));
  assert.match(header, /class="user-menu-who"/);
  assert.match(header, /class="user-menu-icons"/);
  assert.match(header, /class="user-menu-identity"/);
  assert.match(header, /id="user-menu-close"/);
  assert.match(header, /aria-label="Close account menu"/);
  assert.equal(header.includes("chrome-close-label"), false);
  assert.ok(header.indexOf("auth-avatar-lg") < header.indexOf("user-menu-identity"));
  assert.ok(header.indexOf("user-label") < header.indexOf("user-email"));
  const menuCss = css.slice(css.indexOf("\n.user-menu {"), css.indexOf("\n.user-menu-header strong"));
  assert.match(menuCss, /overflow-x:\s*hidden/);
  assert.match(menuCss, /transform:\s*none/);
  assert.match(css, /\.user-menu \.user-menu-close \{[\s\S]*?position:\s*absolute/);
  assert.match(css, /\.user-menu \.user-menu-close \.chrome-close-label \{\s*display:\s*none/);
  assert.match(css, /\.user-menu-identity #user-email/);
  const vr = readFileSync(join(here, "../xr/vr-browser.js"), "utf8");
  assert.equal(vr.includes('chrome-close-label">Close'), false);
  assert.match(html, /acctui1/);
  assert.match(html, /styles\.css\?v=[^"']*acctui1/);
  assert.match(html, /app\.js\?v=20260908-.*acctui1/);
});
