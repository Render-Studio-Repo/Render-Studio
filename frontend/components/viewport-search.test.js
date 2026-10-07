import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_HOVER_DELAY_MS,
  SEARCH_PROMPT_PREVIEW_CHARS,
  SEARCH_RESULT_LIMIT,
  clampSearchPromptText,
  filterViewportSearchItems,
  formatSearchPromptUsage,
  indexViewportSearchItems,
  ownViewportSearchEntries,
  ownViewportSearchProjects,
  renderSearchAvatarCluster,
  renderSearchPeopleBar,
  renderViewportSearchPreview,
  renderViewportSearchMenu,
  renderViewportSearchDetails,
  renderViewportSearchResults,
  searchAvatarBarPeople,
  searchAvatarCluster,
  searchHitPeople,
  shouldApplySearchGeneration,
  shouldInterceptViewportFind,
  usesMacFindModifier,
  VIEWPORT_SEARCH_CACHE,
  SEARCH_THUMB_CACHE_LIMIT,
  fetchSearchThumbnail,
  rememberSearchThumb,
  clearSearchThumbCache,
} from "./viewport-search.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const css = readFileSync(join(here, "viewport-search.css"), "utf8");
const searchJs = readFileSync(join(here, "viewport-search.js"), "utf8");

const me = "user-sam";
const projects = [
  { id: "yeti-bike", name: "Yeti SB160", owner_user_id: me, updated_at: "2026-09-08T12:00:00Z" },
  {
    id: "lamp",
    name: "Desk lamp",
    owner_user_id: me,
    updated_at: "2026-09-07T12:00:00Z",
    timeline: { entries: [
      { id: "tl-other", kind: "prompt", label: "Shade", user_id: me, meta: { prompt: "fluted glass shade" }, created_at: "2026-09-07T11:00:00Z" },
      { id: "tl-collab", kind: "prompt", label: "Secret", user_id: "other-user", meta: { prompt: "other users shade" } },
    ] },
  },
  { id: "public-feed", name: "Community", public: true, folder_id: "__public__", owner_user_id: "someone" },
  { id: "not-mine", name: "Kiefer bike", owner_user_id: "kiefer" },
];
const prompts = [
  { id: "ph1", prompt: "titanium yeti linkage", original_prompt: "yeti linkage", user_id: me, created_at: "2026-09-09T10:00:00Z" },
  { id: "ph-other", prompt: "teammate secret prompt", user_id: "other-user" },
];
const timeline = [
  { id: "tl1", kind: "transform", label: "Move swingarm", user_id: me, created_at: "2026-09-09T09:00:00Z" },
];

test("indexes owned in-memory lists; other projects are name/id unless timeline already loaded", () => {
  const mine = ownViewportSearchProjects(projects, { currentUserId: me });
  assert.deepEqual(mine.map((p) => p.id).sort(), ["lamp", "yeti-bike"]);
  const items = indexViewportSearchItems({
    projects: mine,
    prompts: ownViewportSearchEntries(prompts, me),
    timelineEntries: ownViewportSearchEntries(timeline, me),
    currentProjectId: "yeti-bike",
    currentProjectName: "Yeti SB160",
    currentUserId: me,
  });
  assert.ok(items.some((i) => i.kind === "project" && i.projectId === "lamp"));
  assert.ok(items.some((i) => i.kind === "timeline" && /fluted glass/.test(i.haystack)));
  assert.equal(items.some((i) => /other users shade|teammate secret/.test(i.haystack || i.title || "")), false);
  const nameOnly = indexViewportSearchItems({
    projects: [{ id: "bare", name: "Bare", owner_user_id: me }],
    currentProjectId: "yeti-bike",
  });
  assert.equal(nameOnly.filter((i) => i.kind === "timeline").length, 0);
  assert.equal(nameOnly[0].haystack.includes("Bare"), true);
});

test("filters as the user types by name, id, and prompt text", () => {
  const items = indexViewportSearchItems({
    projects: ownViewportSearchProjects(projects, { currentUserId: me }),
    prompts: ownViewportSearchEntries(prompts, me),
    timelineEntries: ownViewportSearchEntries(timeline, me),
    currentProjectId: "yeti-bike",
    currentProjectName: "Yeti SB160",
    currentUserId: me,
  });
  assert.equal(filterViewportSearchItems(items, "yeti")[0]?.kind, "project");
  assert.ok(filterViewportSearchItems(items, "linkage").some((i) => i.kind === "prompt"));
  assert.ok(filterViewportSearchItems(items, "swingarm").some((i) => i.kind === "timeline"));
  assert.equal(filterViewportSearchItems(items, "no-such-thing").length, 0);
  assert.ok(filterViewportSearchItems(items, "").length >= 1);
  const many = Array.from({ length: 80 }, (_, i) => ({ kind: "project", title: `P${i}`, haystack: `P${i}`, date: "" }));
  assert.equal(filterViewportSearchItems(many, "").length, SEARCH_RESULT_LIMIT);
  assert.ok(SEARCH_RESULT_LIMIT >= 20 && SEARCH_RESULT_LIMIT <= 40);
});

test("Cmd+F on Mac, Ctrl+F on Windows / non-macOS", () => {
  const mac = { userAgentData: { platform: "macOS" }, platform: "MacIntel" };
  const win = { userAgentData: { platform: "Windows" }, platform: "Win32" };
  const linux = { platform: "Linux x86_64", userAgent: "X11" };
  const cmdF = { key: "f", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
  const ctrlF = { key: "f", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false };
  assert.equal(usesMacFindModifier(mac), true);
  assert.equal(usesMacFindModifier(win), false);
  assert.equal(shouldInterceptViewportFind(cmdF, { inViewport: true, inField: false, navigator: mac }), true);
  assert.equal(shouldInterceptViewportFind(ctrlF, { inViewport: true, inField: false, navigator: mac }), false);
  assert.equal(shouldInterceptViewportFind(ctrlF, { inViewport: true, inField: false, navigator: win }), true);
  assert.equal(shouldInterceptViewportFind(cmdF, { inViewport: true, inField: false, navigator: win }), false);
  assert.equal(shouldInterceptViewportFind(ctrlF, { inViewport: true, navigator: linux }), true);
  assert.equal(shouldInterceptViewportFind(cmdF, { inViewport: true, inField: true, navigator: mac }), false);
  assert.equal(shouldInterceptViewportFind(cmdF, { inViewport: false, inField: false, navigator: mac }), false);
  assert.equal(shouldInterceptViewportFind(cmdF, { overlayOpen: true, inField: true, inViewport: false, navigator: mac }), true);
  assert.equal(shouldInterceptViewportFind({ key: "f" }, { inViewport: true, navigator: mac }), false);
});

test("debounce and stale generation skip outdated filters", () => {
  assert.equal(SEARCH_DEBOUNCE_MS >= 150 && SEARCH_DEBOUNCE_MS <= 200, true);
  assert.equal(shouldApplySearchGeneration(3, 3), true);
  assert.equal(shouldApplySearchGeneration(2, 3), false);
  assert.match(searchJs, /SEARCH_DEBOUNCE_MS/);
  assert.match(searchJs, /shouldApplySearchGeneration/);
  assert.match(searchJs, /rebuildIndex\(\)/);
});

test("results render icon, title, subtitle", () => {
  const htmlRows = renderViewportSearchResults([
    { kind: "project", title: "Yeti SB160", subtitle: "yeti-bike · Project" },
  ], { selectedIndex: 0, query: "yeti" });
  assert.match(htmlRows, /viewport-search-hit-icon/);
  assert.match(htmlRows, /Yeti SB160/);
  assert.match(htmlRows, /yeti-bike/);
  assert.match(renderViewportSearchResults([], { query: "zzz" }), /No matches/);
});

test("prompt hover clamps text and shows cost / tokens", () => {
  const long = "meta ".repeat(400);
  const clamped = clampSearchPromptText(long);
  assert.equal(clamped.clamped, true);
  assert.ok(clamped.text.length <= SEARCH_PROMPT_PREVIEW_CHARS);
  assert.match(clamped.text, /…$/);
  const usage = formatSearchPromptUsage({
    cost_usd: 0.12,
    credits: 4,
    usage: { total_tokens: 1500 },
  });
  assert.match(usage, /4 cr/);
  assert.match(usage, /\$0\.12/);
  assert.match(usage, /1\.5k tok/);
  const preview = renderViewportSearchPreview({
    kind: "prompt",
    title: "meta",
    promptText: long,
    cost_usd: 0.12,
    usage: { total_tokens: 1500 },
  });
  assert.match(preview, /viewport-search-preview--prompt/);
  assert.match(preview, /is-clamped/);
  assert.match(preview, /viewport-search-preview-usage/);
  assert.ok(preview.includes("…"));
  assert.equal(preview.includes("meta ".repeat(400).trim()), false);
});

test("project hover preview is a small card with thumb, name, date, type", () => {
  const preview = renderViewportSearchPreview({
    kind: "project",
    title: "Yeti SB160",
    date: "2026-09-08T12:00:00Z",
    typeLabel: "Project",
    thumbUrl: "/api/projects/yeti-bike/thumb",
  });
  assert.match(preview, /viewport-search-preview--project/);
  assert.match(preview, /viewport-search-preview-thumb/);
  assert.match(preview, /Yeti SB160/);
  assert.match(preview, /Project/);
  assert.match(css, /max-width:\s*min\(260px/);
  assert.equal(/\.viewport-search-preview[^{]*\{[^}]*backdrop-filter/.test(css), false);
});

test("avatar cluster shows two +N, hides self-only, bar caps at 6", () => {
  assert.deepEqual(searchHitPeople([{ id: me, display_name: "Sam", self: true }], me), []);
  const people = [
    { id: "a", display_name: "Ada" },
    { id: "b", display_name: "Bea" },
    { id: "c", display_name: "Cyd" },
    { id: "d", display_name: "Dee" },
    { id: "e", display_name: "Eve" },
    { id: "f", display_name: "Fay" },
    { id: "g", display_name: "Gus" },
  ];
  const cluster = searchAvatarCluster(people);
  assert.equal(cluster.shown.length, 2);
  assert.equal(cluster.extra, 5);
  assert.equal(searchAvatarBarPeople(people, 6).length, 6);
  const row = renderSearchAvatarCluster(people);
  assert.match(row, /viewport-search-hit-people/);
  assert.match(row, /\+5/);
  assert.match(renderSearchPeopleBar(people), /viewport-search-avatar--bar/);
  const withMe = searchHitPeople([
    { id: me, display_name: "Sam" },
    { id: "a", display_name: "Ada" },
  ], me);
  assert.equal(withMe.length, 1);
  assert.equal(withMe[0].id, "a");
});

test("hover is debounced, thumbs abort, no per-row listeners or presence poll", () => {
  assert.equal(SEARCH_HOVER_DELAY_MS, 150);
  assert.match(searchJs, /AbortController/);
  assert.match(searchJs, /pointerover/);
  assert.match(searchJs, /cancelThumb/);
  assert.match(searchJs, /contextmenu/);
  assert.match(searchJs, /Share to friends inside Render/);
  assert.doesNotMatch(searchJs, /setInterval/);
  assert.match(searchJs, /list\.addEventListener\("mousedown"/);
  assert.doesNotMatch(searchJs, /results\.map\([\s\S]{0,200}addEventListener/);
  assert.match(app, /applyViewportSearchAction/);
  assert.match(app, /openProjectShare/);
});

test("studio loads Spotlight overlay with cache-bust", () => {
  assert.match(html, /viewport-search\.css\?v=[^"']*cmdf1/);
  assert.match(html, /viewport-search\.css\?v=[^"']*findui1/);
  assert.match(html, /app\.js\?v=[^"']*cmdf1/);
  assert.match(html, /app\.js\?v=[^"']*findui1/);
  assert.match(html, /cliptrim1/);
  assert.match(html, /imageref1/);
  assert.match(html, /esctran1/);
  assert.match(app, /viewport-search\.js\?v=[^"']*cmdf1/);
  assert.match(app, /viewport-search\.js\?v=[^"']*findui1/);
  assert.match(app, /shouldInterceptViewportFind/);
  assert.match(app, /createViewportSearchOverlay/);
  assert.match(app, /ownViewportSearchProjects/);
  assert.match(app, /belongsInPersonalProjectsList/);
  assert.match(app, /isSharedWorkspaceSearchProject/);
  assert.match(app, /await openProjectById\(pid\)/);
  assert.match(app, /function revealDesktopProjectViewport/);
  assert.match(app, /PROJECTS_FETCH_WAIT_MS/);
  assert.match(app, /getProjectsLoading: \(\) => projectsListLoading/);
  assert.match(app, /runViewportRemix/);
  assert.match(css, /\.viewport-search-overlay/);
  assert.match(css, /\.viewport-search-menu/);
  assert.match(css, /\.viewport-search-details-card/);
  assert.equal(VIEWPORT_SEARCH_CACHE.includes("cmdf1"), true);
  assert.equal(VIEWPORT_SEARCH_CACHE.includes("findui1"), true);
  assert.equal(VIEWPORT_SEARCH_CACHE.includes("projpin1"), true);
  assert.match(html, /app\.js\?v=[^"']*projpin1/);
  assert.match(app, /viewport-search\.js\?v=[^"']*projpin1/);
});

test("right-click menu and details popup stay compact", () => {
  const menu = renderViewportSearchMenu();
  assert.match(menu, /Share to friends inside Render/);
  assert.match(menu, /Copy share link/);
  assert.match(menu, /Download/);
  assert.match(menu, /Project details/);
  assert.doesNotMatch(menu, /Pin to projects/);
  const pinMenu = renderViewportSearchMenu({ canPin: true, pinned: false });
  assert.match(pinMenu, /Pin to projects/);
  assert.match(pinMenu, /data-vp-search-action="pin"/);
  assert.match(renderViewportSearchMenu({ canPin: true, pinned: true }), /Unpin from projects/);
  const details = renderViewportSearchDetails({
    title: "Meta Quest 3 Headset",
    workspaceName: "Render Studio",
    people: [{ id: "a", name: "Ada" }, { id: "b", name: "Bea" }],
    editors: [{ id: "a", name: "Ada" }],
    promptCount: 12,
    costUsd: 1.25,
    tokens: 4400,
  });
  assert.match(details, /Render Studio/);
  assert.match(details, /Users involved/);
  assert.match(details, /Users who edited/);
  assert.match(details, /Total prompts/);
  assert.match(details, /Project costs/);
  assert.match(details, /data-vp-search-action="remix"/);
  assert.match(details, /data-vp-search-action="open"/);
});

test("search thumb cache caps and revokes evicted blob URLs", async () => {
  const cache = new Map();
  const created = [];
  const revoked = [];
  const prevCreate = URL.createObjectURL;
  const prevRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => `blob:search:${created.length}:${blob.size}`;
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  try {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(["x"], { type: "image/png" }),
    });
    const first = await fetchSearchThumbnail("/api/thumbs/0", { cache, created, limit: 2, fetch: fetchFn });
    await fetchSearchThumbnail("/api/thumbs/1", { cache, created, limit: 2, fetch: fetchFn });
    await fetchSearchThumbnail("/api/thumbs/2", { cache, created, limit: 2, fetch: fetchFn });
    assert.equal(cache.size, 2);
    assert.equal(cache.has("/api/thumbs/0"), false);
    assert.ok(revoked.includes(first));
    assert.match(searchJs, /trackObjectUrl\(blob, created\)/);
    assert.match(searchJs, /SEARCH_THUMB_CACHE_LIMIT = 32/);
    assert.match(app, /leakfix11/);
    assert.match(html, /leakfix11/);
    clearSearchThumbCache(cache, created);
    assert.equal(cache.size, 0);
    assert.equal(created.length, 0);
  } finally {
    URL.createObjectURL = prevCreate;
    URL.revokeObjectURL = prevRevoke;
  }
});

test("rememberSearchThumb refreshes LRU without revoking the hit", () => {
  const cache = new Map();
  const created = ["blob:keep"];
  rememberSearchThumb("a", "blob:keep", cache, created, 2);
  rememberSearchThumb("b", "https://cdn.example/b.png", cache, created, 2);
  rememberSearchThumb("a", "blob:keep", cache, created, 2);
  rememberSearchThumb("c", "https://cdn.example/c.png", cache, created, 2);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.get("a"), "blob:keep");
  assert.equal(created.includes("blob:keep"), true);
});
