import { pendingSubscriptionShares } from "./pending-subscription-shares.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterPeopleByQuery,
  capVisibleRows,
  connectedAppState,
  sharedSubscriptionAccess,
  preferredSubscriptionProviderId,
  PEOPLE_LIST_CAP,
  VR_LIST_CAP,
  SETTINGS_NAV_ORDER,
  BILLING_BANNER_TABS,
  PEOPLE_LIST_TABS,
  isOnYourPlan,
  sortPlanUsersFirst,
  collectSubscriptionUsers,
  subscriptionOnboardingMarkup,
} from "./ai-subscriptions-ui.js";

const here = dirname(fileURLToPath(import.meta.url));
const js = readFileSync(join(here, "ai-subscriptions-ui.js"), "utf8");
const keyJs = readFileSync(join(here, "ai-key-ui.js"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");

const people = [
  { id: "a", display_name: "Ada Lovelace", email: "ada@example.com", handle: "ada" },
  { id: "b", display_name: "Sam W", email: "sam@example.com", handle: "samw" },
];

test("new users see a direct subscription explanation and connect action", () => {
  const markup = subscriptionOnboardingMarkup({
    providers: [{ id: "openai" }, { id: "claude" }],
  });
  assert.match(markup, /Connect your subscription/);
  assert.match(markup, /Hey AI uses your ChatGPT or Claude subscription/);
  assert.match(markup, /data-ai-sub-chatgpt-signin/);
  assert.equal(subscriptionOnboardingMarkup({
    providers: [{ id: "openai", auth_status: "signed_in" }],
  }), "");
});

test("settings list order is Preferences, Costs, AI and billing", () => {
  assert.deepEqual(SETTINGS_NAV_ORDER, ["preferences", "costs", "billing", "profile"]);
  const pref = html.indexOf('id="btn-preferences-menu"');
  const costs = html.indexOf('id="btn-costs-menu"');
  const billing = html.indexOf('id="btn-ai-key-menu"');
  const profile = html.indexOf('id="btn-public-profile-menu"');
  assert.ok(pref > 0 && costs > pref && billing > costs && profile > billing);
  assert.match(html, />AI and billing</);
  assert.match(html, /id="btn-subscriptions-menu"[^>]*hidden/);
  const visibleSlice = html.slice(pref, html.indexOf('id="btn-subscriptions-menu"'));
  assert.doesNotMatch(visibleSlice, />Connect subscriptions</);
});

test("AI & billing popup hosts Subscriptions | AI Keys banner", () => {
  assert.deepEqual(BILLING_BANNER_TABS, ["subscriptions", "keys"]);
  const modal = html.slice(html.indexOf('id="ai-key-modal"'), html.indexOf('id="ai-subscriptions-modal"'));
  assert.match(modal, /data-ai-billing-banner/);
  assert.match(modal, /data-ai-billing-tab="subscriptions"/);
  assert.match(modal, /data-ai-billing-tab="keys"/);
  assert.match(modal, /id="ai-sub-modal-body"/);
  assert.match(modal, /id="ai-keys-list"/);
  assert.match(modal, /id="btn-ai-billing-costs"/);
  assert.match(modal, /id="ai-billing-costs-panel"/);
  assert.match(modal, /API usage/);
  assert.match(modal, /API limits/);
  assert.match(modal, /API billing/);
  assert.match(modal, /Manage API key/);
});

test("Subscriptions view keeps connected apps and drops API key links", () => {
  assert.match(js, /data-ai-sub-connected-apps/);
  assert.match(js, /function connectedAppsMarkup/);
  assert.equal(connectedAppState({ id: "openai", auth_status: "signed_in" }).label, "connected");
  assert.equal(connectedAppState({ id: "claude" }, { claude: { signed_in: false } }).label, "not connected");
  const selected = js.slice(js.indexOf("function selectedView"), js.indexOf("export function createAiSubscriptionsUI"));
  assert.doesNotMatch(selected, /API usage/);
  assert.doesNotMatch(selected, /API limits/);
  assert.doesNotMatch(selected, /API billing/);
  assert.doesNotMatch(selected, /Manage API key/);
  assert.doesNotMatch(selected, /data-ai-sub-manage="openai"/);
});

test("connected subscription auto-expands until the user explicitly chooses a provider", () => {
  const listing = {
    providers: [
      { id: "cloud" },
      { id: "openai", auth_status: "signed_in" },
      { id: "claude", auth_status: "signed_in" },
    ],
    chatgpt: { signed_in: true },
    claude: { signed_in: true },
  };
  assert.equal(preferredSubscriptionProviderId(listing, "cloud", false), "openai");
  assert.equal(preferredSubscriptionProviderId(listing, "claude", true), "claude");
  assert.equal(preferredSubscriptionProviderId({
    providers: [{ id: "cloud" }, { id: "openai", connected: true, auth_status: "not_signed_in" }],
  }, "cloud", false), "cloud");
  assert.equal(preferredSubscriptionProviderId({ providers: [{ id: "cloud" }] }, "openai", true), "cloud");
});

test("received ChatGPT subscription opens as shared without changing login ownership", () => {
  const provider = { id: "openai", auth_status: "not_signed_in", connected: false };
  const listing = {
    providers: [{ id: "cloud" }, provider],
    chatgpt: { signed_in: false },
    chatgpt_shares: {
      received: [{ granted: true, owner_signed_in: true, owner_name: "Sam" }],
      personal_received: [{ granted: true, owner_signed_in: true, owner_name: "Sam" }],
    },
  };
  assert.deepEqual(sharedSubscriptionAccess(provider, listing), { available: true, ownerNames: ["Sam"] });
  assert.equal(connectedAppState(provider, listing).label, "shared");
  assert.equal(preferredSubscriptionProviderId(listing, "cloud", false), "openai");
  assert.equal(listing.chatgpt.signed_in, false);
  listing.chatgpt_shares.received = [];
  listing.chatgpt_shares.personal_received[0].owner_signed_in = false;
  assert.deepEqual(sharedSubscriptionAccess(provider, listing), { available: false, ownerNames: [] });
  assert.equal(connectedAppState(provider, listing).label, "shared · owner sign-in needed");
  listing.chatgpt_shares.personal_received[0].owner_signed_in = true;
  listing.chatgpt_shares.personal_received[0].granted = false;
  assert.equal(connectedAppState(provider, listing).connected, false);
});

test("personal subscription shares work without a workspace and own sign-in takes precedence", () => {
  const provider = { id: "openai" };
  const listing = { personal_received: [{ granted: true, owner_signed_in: true, owner_name: "Alex" }] };
  assert.deepEqual(sharedSubscriptionAccess(provider, listing), { available: true, ownerNames: ["Alex"] });
  listing.chatgpt = { signed_in: true };
  assert.equal(connectedAppState(provider, listing).label, "connected");
  assert.equal(sharedSubscriptionAccess({ id: "cloud" }, listing).available, false);
});

test("workspace and VR searches restore focus and cursor after rerender", () => {
  assert.match(js, /restoreWorkspaceSearchFocus = true/);
  assert.match(js, /restoreWorkspaceSearchPos = wsSearch\.selectionStart/);
  assert.match(js, /restoreVrSearchFocus = true/);
  assert.match(js, /restoreVrSearchPos = vrField\.selectionStart/);
});

test("people list is capped and uses one live-match search", () => {
  assert.equal(PEOPLE_LIST_CAP, 7);
  assert.equal(capVisibleRows(Array.from({ length: 20 }, (_, i) => i)).overflow, true);
  assert.equal(capVisibleRows(Array.from({ length: 20 }, (_, i) => i)).visible.length, 7);
  assert.match(js, /data-ai-sub-roster-cap/);
  assert.match(js, /data-ai-sub-people-search/);
  assert.match(js, /Search name, @handle, or email/);
  assert.doesNotMatch(js, /Name, @handle, or email/);
  assert.match(js, /data-ai-sub-people-scope/);
  assert.match(js, />Team</);
  assert.deepEqual(filterPeopleByQuery(people, "@samw").map((p) => p.id), ["b"]);
});

test("VR list is capped with search, team filter, and right-click menu", () => {
  assert.equal(VR_LIST_CAP, 7);
  assert.match(js, /data-ai-sub-vr-permissions/);
  assert.match(js, /data-ai-sub-vr-cap/);
  assert.match(js, /data-ai-sub-vr-search/);
  assert.match(js, /data-ai-sub-vr-scope/);
  assert.match(js, /data-ai-sub-vr-row/);
  assert.match(js, /contextmenu/);
  assert.match(js, /ai-sub-ctx-menu/);
});

test("subscriptions refresh aborts the previous listing GET", () => {
  assert.match(js, /let subscriptionsAbort = null; \/\/ leakfix59/);
  assert.match(js, /async function refresh\(\)[\s\S]{0,1200}signal: ctl\.signal/);
  assert.match(js, /async function pollStatus\(\)[\s\S]{0,500}signal: ctl\.signal/);
});

test("Costs side panel toggles with the current billing tab", () => {
  assert.match(js, /applyAiBillingCostsOpen/);
  assert.match(js, /ai-billing-costs-open/);
  assert.match(keyJs, /setCostsOpen/);
  assert.match(keyJs, /btn-ai-billing-costs/);
  assert.match(app, /render3d:refresh-billing-costs/);
  assert.match(app, /ai-billing-costs-panel/);
  assert.match(css, /\.ai-billing-costs-panel/);
  assert.match(css, /\.ai-billing-card\.is-costs-open/);
});

test("People section sits above Workspace people and is not a workspace invite", () => {
  const peopleIdx = js.indexOf('<h3 class="ai-sub-share-title">People</h3>');
  const workspaceIdx = js.indexOf('<h3 class="ai-sub-share-title">Workspace people</h3>');
  assert.ok(peopleIdx > 0);
  assert.ok(workspaceIdx > peopleIdx);
  assert.match(js, /data-ai-sub-people-personal/);
  assert.match(js, /\/api\/ai-subscriptions\/people/);
  assert.match(js, /data-ai-sub-add-personal-btn/);
  assert.match(js, /data-ai-sub-remove-personal/);
});

test("On your plan tab lists granted users across personal and every workspace", () => {
  assert.deepEqual(PEOPLE_LIST_TABS, ["plan", "people", "workspace"]);
  assert.match(js, /data-ai-sub-people-tab=/);
  assert.match(js, /id: "plan"/);
  assert.match(js, /label: "On your plan"/);
  assert.match(js, /data-ai-sub-plan-sort/);
  assert.match(js, /data-ai-sub-people-plan/);
  assert.match(js, /data-ai-sub-open-people>Search new email/);
  assert.match(js, /data-ai-sub-key=.*Add or share AI key/);
  assert.match(js, /let peopleTab = "plan"/);
  assert.ok(js.indexOf('{ id: "plan", label: "On your plan" }') < js.indexOf('{ id: "people", label: "People" }'));
  assert.match(js, /<h3 class="ai-sub-share-title">CAD access<\/h3>/);
  assert.match(js, /peopleTab === "plan" \? vrPermissionsMarkup/);
  assert.match(js, /data-ai-sub-plan-peek/);
  assert.match(js, /planPeople\(\)/);
  assert.match(js, /personBtn\.closest\("\[data-ai-sub-people-plan\]"\)/);
  assert.match(js, /openPlanPeek\(person\)/);
  assert.match(css, /\.ai-sub-plan-sort/);
  const granted = collectSubscriptionUsers(
    {
      personal_people: [
        { id: "p1", display_name: "Pat", granted: true },
        { id: "p2", display_name: "Off", granted: false },
      ],
      chatgpt_shares: {
        owned: [
          { id: "s1", team_id: "t1", team_name: "Render3D" },
          { id: "s2", team_id: "t2", team_name: "Other" },
        ],
      },
    },
    {
      s1: [{ id: "w1", display_name: "Ada", granted: true }],
      s2: [{ id: "w2", display_name: "Skip", granted: false }, { id: "w3", display_name: "Sam", granted: true }],
    },
    "openai",
  );
  assert.deepEqual(granted.map((p) => p.id).sort(), ["p1", "w1", "w3"]);
  assert.equal(isOnYourPlan({ granted: true }), true);
  assert.equal(isOnYourPlan({ granted: false }), false);
  assert.deepEqual(
    sortPlanUsersFirst([
      { id: "a", display_name: "Zed", granted: false },
      { id: "b", display_name: "Ann", granted: true },
    ]).map((p) => p.id),
    ["b", "a"],
  );
});

test("overview Search new email opens the People email search", async () => {
  const listing = claudeLoginListing("signed_in");
  const h = subscriptionLoginHarness(listing);
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  assert.match(h.body.markup, /data-ai-sub-people-plan/);
  h.click("data-ai-sub-open-people");
  assert.match(h.body.markup, /data-ai-sub-people-personal/);
  assert.match(h.body.markup, /placeholder="Search name, @handle, or email"/);
});

test("inactive owner share explains visibility and offers provider reconnect", async () => {
  const listing = claudeLoginListing("not_signed_in");
  listing.claude_shares = {
    owned: [{ id: "share", team_id: "team", owner_signed_in: false }],
    received: [],
  };
  const h = subscriptionLoginHarness(listing);
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  h.click("data-ai-sub-people-tab", "workspace");
  assert.match(h.body.markup, /can see this share, but cannot use it until the owner reconnects Claude/);
  assert.match(h.body.markup, /data-ai-sub-reconnect="claude"/);
});

test("subscription person controls cannot leak clicks into the Studio screen", () => {
  assert.match(js, /body\?\.addEventListener\("click", \(e\) => \{\s*\/\/ Subscription controls[\s\S]*?e\.stopPropagation\(\)/);
  assert.match(js, /body\?\.addEventListener\("pointerdown", \(e\) => \{\s*e\.stopPropagation\(\)/);
});

test("billing dialog stays open when its backdrop is clicked", () => {
  assert.match(js, /querySelectorAll\("\.auth-close\[data-ai-sub-close\]"\)/);
  assert.match(keyJs, /querySelectorAll\("\.auth-close\[data-ai-key-close\]"\)/);
  assert.doesNotMatch(keyJs, /querySelectorAll\("\[data-ai-key-close\]"\)/);
});

test("search filter only matches people in the regular list", () => {
  assert.deepEqual(filterPeopleByQuery(people, "ada").map((p) => p.id), ["a"]);
  assert.deepEqual(filterPeopleByQuery(people, "@samw").map((p) => p.id), ["b"]);
  assert.deepEqual(filterPeopleByQuery(people, "example.com").map((p) => p.id), ["a", "b"]);
  assert.deepEqual(filterPeopleByQuery(people, "zzz"), []);
});

test("weekly usage toggle lives on subscriptions and CAD prompt key", () => {
  assert.match(js, /data-ai-sub-weekly-usage/);
  assert.match(js, /Show weekly usage on the AI CAD Prompt key/);
  assert.match(app, /pref-weekly-usage-pill/);
  assert.match(html, /prompt-key-pill-usage/);
});

test("daily limit saves on personal and workspace rows", () => {
  assert.match(js, /data-ai-sub-daily-limit="personal"/);
  assert.match(js, /data-ai-sub-daily-limit="workspace"/);
  assert.match(js, /JSON\.stringify\(\{ daily_limit_usd: value \}\)/);
  assert.match(js, /\$\/day/);
  assert.match(css, /\.ai-sub-daily-limit/);
  assert.match(css, /\.ai-sub-share-title/);
});

test("subscription UI cache-bust preserves its feature markers", () => {
  assert.match(app, /ai-subscriptions-ui\.js\?v=[^"']*setui1/);
  assert.match(app, /ai-key-ui\.js\?v=[^"']*setui1/);
  assert.match(app, /ai-subscriptions-ui\.js\?v=[^"']*peoplimit1/);
  assert.match(app, /ai-subscriptions-ui\.js\?v=[^"']*subplan1/);
  assert.match(app, /ai-subscriptions-ui\.js\?v=[^"']*substate1/);
  assert.match(app, /ai-subscriptions-ui\.js\?v=[^"']*substate2/);
  assert.match(app, /ai-key-ui\.js\?v=[^"']*substate2/);
  assert.match(app, /ai-subscriptions-ui\.js\?v=[^"']*claude-tabs=20260928-2/);
  assert.match(html, /app\.js\?v=[^"']*substate1/);
  assert.match(html, /app\.js\?v=[^"']*substate2/);
  assert.match(html, /app\.js\?v=[^"']*claude-tabs=20260928-2/);
});


function subscriptionLoginHarness(initialListing, requestHandler, { popupReturnsNull = false } = {}) {
  let listing = initialListing;
  const requests = [];
  const opened = [];
  let submitError = null;
  const intervals = new Map();
  let intervalId = 0;
  const listeners = new Map();
  const document = {
    activeElement: null,
    addEventListener() {},
    getElementById(id) { return id === "ai-sub-modal-body" ? body : id === "ai-subscriptions-modal" ? modal : null; },
  };
  const modal = {
    id: "ai-subscriptions-modal", dataset: {},
    classList: { contains: () => false, add() {}, remove() {} },
    querySelectorAll: () => [],
  };
  let codeField = null;
  let codeForm = null;
  let codeButton = null;
  const body = {
    markup: "",
    addEventListener(type, handler) { listeners.set(type, handler); },
    querySelector(selector) {
      if (selector.includes("data-ai-sub-claude-code")) {
        if (selector.includes("input")) return codeField;
        if (selector.includes("button")) return codeButton;
        return codeForm;
      }
      return null;
    },
    set innerHTML(html) {
      this.markup = html;
      codeField = codeForm = codeButton = null;
      if (html.includes("data-ai-sub-claude-code")) {
        codeField = {
          value: "", selectionStart: 0, selectionEnd: 0, selectionDirection: "none",
          focus() { document.activeElement = this; },
          setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; },
          closest(selector) { return selector.includes("data-ai-sub-claude-code") ? codeForm : null; },
        };
        codeForm = {
          code: codeField,
          querySelector: () => codeField,
          elements: { namedItem: () => codeField },
          closest(selector) { return selector === "[data-ai-sub-claude-code]" ? this : null; },
        };
        codeButton = {
          closest(selector) {
            if (selector === "[data-ai-sub-claude-connect]") return this;
            if (selector === "[data-ai-sub-claude-code]") return codeForm;
            return null;
          },
        };
      }
    },
  };
  const window = {
    addEventListener() {}, dispatchEvent() {}, clearTimeout() {}, confirm: () => true,
    open(url) { opened.push(url); return popupReturnsNull ? null : {}; },
    setInterval(fn) { intervals.set(++intervalId, fn); return intervalId; },
    clearInterval(id) { intervals.delete(id); },
  };
  const context = vm.createContext({ document, window, AbortController, pendingSubscriptionShares, localStorage: { getItem: () => null } });
  vm.runInContext(js.replace(/^import .*pending-subscription-shares.*;\n/m, "").replace(/export /g, "") + "\nthis.makeUI = createAiSubscriptionsUI;", context);
  const ui = context.makeUI({ api: async (url, options = {}) => {
    requests.push({ url, ...options });
    if (url.endsWith("/claude/token") && submitError) throw submitError;
    if (requestHandler) { const result = await requestHandler(url, options); if (result !== undefined) return result; }
    return url === "/api/teams" ? { teams: [] } : listing;
  } });
  return {
    ui, body, document, intervals, requests, opened,
    setSubmitError(error) { submitError = error; },
    setListing(next) { listing = next; },
    get codeField() { return codeField; },
    dispatch(type, target) { listeners.get(type)({ stopPropagation() {}, preventDefault() {}, target }); },
    submit() { listeners.get("submit")({ target: codeForm, preventDefault() {} }); },
    clickClaudeConnect() {
      listeners.get("click")({ target: codeButton, preventDefault() {}, stopPropagation() {} });
    },
    clickManageClaude(url) {
      const button = {
        getAttribute(attribute) { return attribute === "data-url" ? url : null; },
        closest(selector) { return selector === "[data-ai-sub-manage]" ? this : null; },
      };
      listeners.get("click")({ target: button, preventDefault() {}, stopPropagation() {} });
    },
    click(attribute, value = "") {
      const button = { getAttribute: () => value };
      listeners.get("click")({ stopPropagation() {}, target: { closest: (selector) => selector === `[${attribute}]` ? button : null } });
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); },
    async poll() { for (const poll of intervals.values()) poll(); await this.settle(); },
  };
}

function claudeLoginListing(status, needsCode = false) {
  return {
    providers: [{ id: "cloud" }, { id: "claude", label: "Claude", auth_status: status }],
    claude: { status, signed_in: status === "signed_in", needs_code: needsCode },
  };
}

test("Claude subscription setup shows the local setup-token command", async () => {
  const h = subscriptionLoginHarness(claudeLoginListing("not_signed_in"));
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  assert.doesNotMatch(h.body.markup, /data-ai-sub-claude-code/);
  h.click("data-ai-sub-claude-signin");
  assert.match(h.body.markup, /data-ai-sub-claude-code/);
  assert.match(h.body.markup, /role="dialog" aria-modal="true"/);
  assert.match(h.body.markup, /Connect Claude Pro or Max/);
  assert.match(h.body.markup, /claude setup-token/);
  assert.match(h.body.markup, /sk-ant-oat/);
  assert.equal(h.intervals.size, 0);
});

test("Claude connection dialog can be closed and reopened", async () => {
  const h = subscriptionLoginHarness(claudeLoginListing("not_signed_in"));
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  h.click("data-ai-sub-claude-signin");
  assert.match(h.body.markup, /data-ai-sub-claude-dialog/);
  h.click("data-ai-sub-claude-close");
  assert.doesNotMatch(h.body.markup, /data-ai-sub-claude-dialog/);
  assert.match(h.body.markup, /data-ai-sub-claude-signin/);
});

test("Claude token draft and selection survive refresh; submission clears accepted token", async () => {
  const h = subscriptionLoginHarness(claudeLoginListing("not_signed_in"));
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  h.click("data-ai-sub-claude-signin");
  h.codeField.value = "sk-ant-oat01-synthetic-token";
  h.codeField.focus();
  h.codeField.setSelectionRange(3, 9, "backward");
  await h.ui.refresh();
  assert.equal(h.codeField.value, "sk-ant-oat01-synthetic-token");
  assert.equal(h.document.activeElement, h.codeField);
  assert.deepEqual([h.codeField.selectionStart, h.codeField.selectionEnd, h.codeField.selectionDirection], [3, 9, "backward"]);
  h.submit();
  await h.settle();
  const submission = h.requests.find((request) => request.url.endsWith("/claude/token"));
  assert.deepEqual(JSON.parse(submission.body), { token: "sk-ant-oat01-synthetic-token" });
  assert.equal(h.codeField.value, "");
});

test("Claude Connect directly submits the pasted token without relying on native form submit", async () => {
  const h = subscriptionLoginHarness(claudeLoginListing("not_signed_in"));
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  h.click("data-ai-sub-claude-signin");
  h.codeField.value = "sk-ant-oat01-synthetic-direct-token";
  h.clickClaudeConnect();
  await h.settle();
  const submissions = h.requests.filter((request) => request.url.endsWith("/claude/token"));
  assert.equal(submissions.length, 1);
  assert.deepEqual(JSON.parse(submissions[0].body), { token: "sk-ant-oat01-synthetic-direct-token" });
});

test("received Claude access alone never exposes an owner code form", async () => {
  const listing = claudeLoginListing("not_signed_in");
  listing.claude_shares = { received: [{ granted: true, owner_signed_in: true, owner_name: "Owner" }] };
  const h = subscriptionLoginHarness(listing);
  await h.ui.refresh();
  assert.match(h.body.markup, /Claude access shared by Owner/);
  assert.doesNotMatch(h.body.markup, /data-ai-sub-claude-code/);
  assert.equal(h.intervals.size, 0);
});


test("Claude connect focuses the token field without opening a remote OAuth page", async () => {
  const listing = claudeLoginListing("not_signed_in");
  listing.providers.push({ id: "openai", auth_status: "signed_in" });
  listing.chatgpt = { status: "signed_in", signed_in: true };
  const h = subscriptionLoginHarness(listing);
  await h.ui.refresh();
  h.click("data-ai-sub-claude-signin");
  await h.settle();
  assert.match(h.body.markup, /data-ai-sub-claude-code/);
  assert.equal(h.document.activeElement, h.codeField);
  assert.deepEqual(h.opened, []);
});

test("a noopener popup returning null never triggers a second browser page", async () => {
  const listing = {
    providers: [{ id: "openai", auth_status: "awaiting_browser" }],
    chatgpt: {
      status: "awaiting_browser",
      signed_in: false,
      device_code: "ABCD-EFGH",
      login_url: "https://auth.openai.com/codex/device",
    },
  };
  const h = subscriptionLoginHarness(listing, undefined, { popupReturnsNull: true });
  await h.ui.refresh();
  h.click("data-ai-sub-chatgpt-signin");
  await h.settle();
  assert.deepEqual(h.opened, ["https://auth.openai.com/codex/device"]);
});

test("Claude token remains editable after failed submission", async () => {
  const h = subscriptionLoginHarness(claudeLoginListing("not_signed_in"));
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  h.click("data-ai-sub-claude-signin");
  h.codeField.value = "sk-ant-oat01-synthetic-retry-token";
  h.setSubmitError(new Error("Try a new setup token."));
  h.submit();
  await h.settle();
  assert.equal(h.codeField.value, "sk-ant-oat01-synthetic-retry-token");
  assert.equal(h.codeField.readOnly, false);
  assert.match(h.body.markup, /Try a new setup token/);
  assert.equal(h.intervals.size, 0);
});


test("reopening subscriptions returns to a pending Claude login before an already connected provider", () => {
  const listing = claudeLoginListing("awaiting_browser");
  listing.providers.push({ id: "openai", auth_status: "signed_in" });
  listing.chatgpt = { signed_in: true, status: "signed_in" };
  assert.equal(preferredSubscriptionProviderId(listing, "openai", false), "claude");
  assert.equal(preferredSubscriptionProviderId(listing, "openai", true), "openai");
});


test("saved provider links never override current subscription authentication", () => {
  for (const id of ["openai", "claude"]) {
    const field = id === "openai" ? "chatgpt" : "claude";
    const provider = { id, connected: true, auth_status: "signed_in", [field]: { signed_in: true } };
    for (const status of ["not_signed_in", "error", "awaiting_browser"]) {
      assert.equal(connectedAppState(provider, { [field]: { status, signed_in: false } }).connected, false);
    }
    assert.equal(connectedAppState({ id, connected: true, auth_status: "not_signed_in" }).label, "not connected");
    assert.equal(connectedAppState({ id, auth_status: "not_signed_in" }, { [field]: { status: "signed_in", signed_in: true } }).label, "connected");
  }
});

test("Claude tab and auth text both use live status instead of a saved connection", async () => {
  const listing = claudeLoginListing("not_signed_in");
  listing.providers[1].connected = true;
  listing.providers[1].auth_status = "signed_in";
  const h = subscriptionLoginHarness(listing);
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  assert.match(h.body.markup, /Not signed in/);
  assert.match(h.body.markup, /Connect Claude subscription/);
  assert.doesNotMatch(h.body.markup, /Signed in with Claude|data-ai-sub-disconnect="claude"/);
});


test("Claude plan and People lists use Claude grants only", async () => {
  const listing = claudeLoginListing("signed_in");
  listing.personal_people = [{ id: "openai-person", display_name: "OpenAI Person", granted: true }];
  listing.claude_shares = { personal_people: [{ id: "claude-person", display_name: "Claude Person", granted: true }], personal_received: [] };
  assert.deepEqual(collectSubscriptionUsers(listing, {}, "claude").map((p) => p.id), ["claude-person"]);
  const h = subscriptionLoginHarness(listing);
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  h.click("data-ai-sub-people-tab", "people");
  assert.match(h.body.markup, /Claude Person/);
  assert.doesNotMatch(h.body.markup, /OpenAI Person|this ChatGPT login/);
});

test("Claude personal grant, daily limit, and removal use provider-scoped endpoints", async () => {
  const listing = claudeLoginListing("signed_in");
  listing.claude_shares = { personal_people: [{ id: "person", display_name: "Person", granted: true }] };
  const h = subscriptionLoginHarness(listing, async (url) => url.includes("/people/") ? { people: [] } : undefined);
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  const node = (attribute, values, extras = {}) => ({
    ...extras,
    getAttribute: (name) => values[name] || null,
    closest: (selector) => selector === `[${attribute}]` ? target : null,
  });
  let target = node("data-ai-sub-personal-grant", { "data-ai-sub-personal-grant": "person" }, { checked: false });
  h.dispatch("change", target);
  await h.settle();
  target = node("data-ai-sub-daily-limit", { "data-ai-sub-daily-limit": "personal", "data-user-id": "person" }, { value: "5" });
  h.dispatch("change", target);
  await h.settle();
  target = node("data-ai-sub-remove-personal", { "data-ai-sub-remove-personal": "person" });
  h.dispatch("click", target);
  await h.settle();
  const writes = h.requests.filter((r) => r.method);
  assert.deepEqual(writes.map((r) => [r.url, r.method]), [
    ["/api/ai-subscriptions/claude/people/person", "PUT"],
    ["/api/ai-subscriptions/claude/people/person", "PUT"],
    ["/api/ai-subscriptions/claude/people/person", "DELETE"],
  ]);
  assert.deepEqual(JSON.parse(writes[0].body), { granted: false });
  assert.deepEqual(JSON.parse(writes[1].body), { daily_limit_usd: 5 });
});

test("switching providers during a personal grant update cannot overwrite the other provider's people", async () => {
  const listing = claudeLoginListing("signed_in");
  listing.providers.push({ id: "openai", auth_status: "signed_in" });
  listing.chatgpt = { signed_in: true, status: "signed_in" };
  listing.personal_people = [{ id: "openai-person", display_name: "OpenAI Person", granted: true }];
  listing.claude_shares = { personal_people: [{ id: "claude-person", display_name: "Claude Person", granted: true }] };
  let finish;
  const h = subscriptionLoginHarness(listing, (url) => url.endsWith("/claude/people/claude-person") ? new Promise((resolve) => { finish = resolve; }) : undefined);
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  const target = {
    checked: false,
    getAttribute: () => "claude-person",
    closest: (selector) => selector === "[data-ai-sub-personal-grant]" ? target : null,
  };
  h.dispatch("change", target);
  h.click("data-ai-sub-select", "openai");
  h.click("data-ai-sub-people-tab", "people");
  finish({ people: [{ id: "claude-person", display_name: "Claude Person", granted: false }] });
  await h.settle();
  assert.match(h.body.markup, /OpenAI Person/);
  assert.doesNotMatch(h.body.markup, /Claude Person/);
  h.click("data-ai-sub-select", "claude");
  assert.match(h.body.markup, /Claude Person/);
  assert.doesNotMatch(h.body.markup, /OpenAI Person/);
});


test("Claude setup-token instructions never expose a server-side OAuth link", async () => {
  const h = subscriptionLoginHarness(claudeLoginListing("not_signed_in"));
  await h.ui.refresh();
  h.click("data-ai-sub-select", "claude");
  h.click("data-ai-sub-claude-signin");
  assert.match(h.body.markup, /claude setup-token/);
  assert.doesNotMatch(h.body.markup, /data-ai-sub-manage="claude"|claude\.com\/cai\/oauth/);
  assert.deepEqual(h.opened, []);
});


test("authorized offline-owner share stays visible without claiming a connected subscription", async () => {
  for (const id of ["openai", "claude"]) {
    const key = id === "openai" ? "chatgpt" : "claude";
    const listing = {
      providers: [{ id, label: id === "openai" ? "ChatGPT" : "Claude", auth_status: "not_signed_in" }],
      [key]: { signed_in: false, status: "not_signed_in" },
      [`${key}_shares`]: { personal_received: [{ id: "grant", granted: true, kind: "personal", owner_name: "Owner", owner_signed_in: false }] },
    };
    assert.equal(connectedAppState({ id }, listing).connected, false);
    assert.equal(connectedAppState({ id }, listing).label, "shared · owner sign-in needed");
    assert.equal(sharedSubscriptionAccess({ id }, listing).available, false);
    const h = subscriptionLoginHarness(listing);
    await h.ui.refresh();
    h.click("data-ai-sub-select", id);
    assert.match(h.body.markup, /Owner sign-in needed/);
    assert.match(h.body.markup, /They need to reconnect before you can use it/);
    assert.doesNotMatch(h.body.markup, /data-ai-sub-disconnect=/);
    listing[`${key}_shares`].personal_received[0].granted = false;
    await h.ui.refresh();
    assert.doesNotMatch(h.body.markup, /Owner sign-in needed/);
  }
});
