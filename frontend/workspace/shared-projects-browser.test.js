import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderSharedProjectsBody,
  sharedProjectMatchesQuery,
  sharedProjectRowHtml,
  SHARE_SEARCH_DEBOUNCE_MS,
  SHARE_PERMISSIONS,
} from "./shared-projects-browser.js";
import { mergeHubTeams } from "./workspace-hub.js";
import { sharePermissionLabel } from "./workspace-list.js";

const here = dirname(fileURLToPath(import.meta.url));

test("shared projects popup lists with-me and by-me separately", () => {
  const html = renderSharedProjectsBody({
    currentUserId: "me",
    projects: [
      { id: "arm", name: "Robot Arm", shared_with_me: true, owner_name: "Docs Demo", preview_url: "/api/projects/arm/thumb" },
      { id: "boat", name: "Boat", shared_by_me: true, share_count: 3, owner_user_id: "me" },
    ],
    pinnedIds: ["arm"],
    view: "grid",
  });
  assert.match(html, /Shared with me/);
  assert.match(html, /Shared by me/);
  assert.match(html, /Robot Arm/);
  assert.match(html, /Boat/);
  assert.match(html, /shared-projects-grid/);
  assert.match(html, /data-thumb-src=/);
  assert.match(html, /data-shared-pin="arm"/);
  assert.match(sharedProjectRowHtml({ id: "arm", name: "Robot Arm", owner_name: "Docs Demo" }), /data-shared-open="arm"/);
  assert.match(sharedProjectRowHtml({ id: "arm", name: "Robot Arm" }, { kind: "by-me" }), /data-shared-share="arm"/);
  assert.doesNotMatch(html, /Pin a row to the left rail/);
});

test("shared projects search matches titles and people without mixing private lists", () => {
  const projects = [
    { id: "arm", name: "Robot Arm", shared_with_me: true, owner_name: "Docs Demo", owner_user_id: "docs" },
    { id: "boat", name: "Boat", shared_by_me: true, share_count: 1, owner_user_id: "me" },
    { id: "car", name: "Car", shared_by_me: true, share_count: 1, owner_user_id: "me" },
  ];
  const titleHtml = renderSharedProjectsBody({ currentUserId: "me", projects, query: "robot" });
  assert.match(titleHtml, /Robot Arm/);
  assert.doesNotMatch(titleHtml, /data-shared-project="boat"/);
  assert.doesNotMatch(titleHtml, /data-shared-project="car"/);

  const ownerHtml = renderSharedProjectsBody({ currentUserId: "me", projects, query: "docs demo" });
  assert.match(ownerHtml, /Robot Arm/);
  assert.doesNotMatch(ownerHtml, /data-shared-project="boat"/);

  const peopleHtml = renderSharedProjectsBody({
    currentUserId: "me",
    projects,
    query: "alice",
    sharePeopleByProject: {
      boat: { shares: [{ display_name: "Alice Chen", email: "alice@x.com", user_id: "a1" }], pending: [] },
      car: { shares: [{ display_name: "Bob", email: "bob@x.com", user_id: "b1" }], pending: [] },
    },
  });
  assert.match(peopleHtml, /data-shared-project="boat"/);
  assert.doesNotMatch(peopleHtml, /data-shared-project="car"/);
  assert.doesNotMatch(peopleHtml, /data-shared-project="arm"/);

  const friendHtml = renderSharedProjectsBody({
    currentUserId: "me",
    projects,
    query: "Alice",
    friends: [{ id: "docs", display_name: "Alice Chen" }],
  });
  assert.match(friendHtml, /Robot Arm/);
  assert.ok(sharedProjectMatchesQuery(
    { name: "Boat", owner_user_id: "me" },
    { query: "chen", sharePeople: { shares: [{ display_name: "Alice Chen", user_id: "a1" }] }, friendIds: ["a1"] },
  ));
});

test("share permission labels map onto viewer remixer editor", () => {
  assert.equal(sharePermissionLabel("view"), "View only");
  assert.equal(sharePermissionLabel("remix only"), "Remix only");
  assert.equal(sharePermissionLabel("remix and edit"), "Remix and edit");
  assert.deepEqual(SHARE_PERMISSIONS.map((row) => row.id), ["viewer", "remixer", "editor"]);
  assert.equal(SHARE_SEARCH_DEBOUNCE_MS, 220);
});

test("Manage hub merges every workspace so the roster is never only the current row", () => {
  const rows = mergeHubTeams(
    [{ id: "s3", name: "Render3D", member_count: 133, role: "member" }],
    [
      { id: "s1", name: "Ambots", member_count: 9, role: "member" },
      { id: "s2", name: "Fusion - Render", member_count: 25, role: "owner" },
      { id: "s3", name: "Render3D", member_count: 18, role: "member" },
      { id: "e1", name: "vineetsai@gmail.com", member_count: 2, role: "owner" },
    ],
  );
  assert.equal(rows.length, 4);
  assert.ok(rows.some((t) => t.id === "s1"));
  assert.ok(rows.some((t) => t.id === "s2"));
  assert.ok(rows.some((t) => t.id === "e1"));
  const hub = readFileSync(join(here, "workspace-hub.js"), "utf8");
  assert.match(hub, /data-hub-switch/);
  assert.match(hub, /Every workspace you belong to/);
  const browser = readFileSync(join(here, "workspace-browser.js"), "utf8");
  assert.match(browser, /appendSharedProjectsSection/);
  assert.match(browser, /rows: current \? \[current\] : \[\]/);
  assert.match(browser, /refreshSharedProjectsStrip/);
  assert.match(browser, /data-shared-recents/);
  assert.match(browser, /render3d:shared-sidebar-changed/);
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(app, /shared-projects-browser\.js\?v=20260908-shared1/);
  assert.match(app, /leakfix80/);
  assert.match(app, /20260915-shareui1/);
  assert.match(app, /20260915-sharesearch1/);
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(html, /styles\.css\?v=/);
  assert.match(html, /20260909-remix1/);
  assert.match(html, /20260915-shareui1/);
  assert.match(html, /20260915-sharesearch1/);
  assert.match(html, /id="shared-projects-filter"/);
  const src = readFileSync(join(here, "shared-projects-browser.js"), "utf8");
  assert.match(src, /IntersectionObserver/);
  assert.match(src, /invite-lookup/);
  assert.match(src, /\/api\/social\/friends/);
  assert.match(src, /\/api\/projects\/\$\{encodeURIComponent\(id\)\}\/shares/);
  assert.match(src, /SHARE_SEARCH_DEBOUNCE_MS = 220/);
  assert.match(src, /let sharedInvitesAbort = null; \/\/ leakfix80/);
  assert.match(src, /async function refreshInvites\(\)[\s\S]{0,700}signal: ctl\.signal/);
});

test("Your projects picker includes unshared and public owned projects, excludes other owners", () => {
  const projects = [
    { id: "new", name: "New arm", owner_user_id: "me" },
    { id: "public", name: "Public arm", owner_user_id: "me", public: true },
    { id: "other", name: "Other arm", owner_user_id: "other", shared_with_me: true },
  ];
  for (const view of ["grid", "list"]) {
    const html = renderSharedProjectsBody({ projects, currentUserId: "me", collection: "mine", view, query: "arm" });
    assert.match(html, /data-shared-share="new"/);
    assert.match(html, /data-shared-share="public"/);
    assert.doesNotMatch(html, /data-shared-project="other"/);
  }
  const filtered = renderSharedProjectsBody({ projects, currentUserId: "me", collection: "mine", query: "Public" });
  assert.doesNotMatch(filtered, /data-shared-project="new"/);
  assert.match(filtered, /data-shared-project="public"/);
});

test("access rows distinguish member removal and pending invite cancellation", async () => {
  const { detailsPeopleHtml } = await import('./shared-projects-browser.js');
  const data = { shares: [{ user_id: "u", display_name: "Alice", role: "editor" }], pending: [{ id: "i", email: "bob@example.com", role: "viewer" }] };
  const html = detailsPeopleHtml(data);
  assert.match(html, /data-shared-perm-select="active:u"/);
  assert.match(html, /data-shared-perm-select="pending:i"/);
  assert.match(html, /Cancel invite/);
  const readonly = detailsPeopleHtml(data, { manage: false });
  assert.doesNotMatch(readonly, /data-remove-person|<select/);
  assert.match(readonly, /Remix and edit/);
  const filtered = detailsPeopleHtml(data, { query: "bob" });
  assert.doesNotMatch(filtered, /Alice/);
  assert.match(filtered, /bob@example.com/);
});
