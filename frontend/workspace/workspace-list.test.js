import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatGenerationElapsed } from "./workspace-browser.js";
import {
  belongsInPersonalFolderList,
  belongsInPersonalProjectsList,
  currentListedSidebarSharedProject,
  currentListedSidebarWorkspace,
  currentSidebarWorkspaceId,
  listedSidebarSharedProjects,
  loadSharedSidebarPrefs,
  saveSharedSidebarPrefs,
  PERSONAL_PIN_CACHE,
  PERSONAL_PIN_CAP_MESSAGE,
  PERSONAL_PIN_MAX,
  canPinPersonalProject,
  loadPersonalPinIds,
  normalizePersonalPinIds,
  partitionPersonalPinnedProjects,
  savePersonalPinIds,
  togglePersonalProjectPin,
  partitionSharedProjects,
  sharedCreateTeamId,
  foldersForWorkspace,
  inferPersonalWorkspaceId,
  lastOpenedSidebarProject,
  listedSidebarWorkspaces,
  mostRecentProjectForWorkspace,
  projectsForWorkspace,
  readCachedProjectList,
  resolveLastProjectIdForXrBoot,
  resolveXrEnterSessionIntent,
  sortProjectsForDisplay,
  promoteOpenedProjectInList,
  unlistedPersonalProjects,
  writeCachedProjectList,
  xrBootEnterPayload,
  xrEnterNeedsDeferredOpen,
  xrEnterShouldNavigateToViewportHash,
  xrViewportEnterPayload,
  resolveSelectedProjectIdForXrEnter,
  selectedProjectIsInXrScene,
} from "./workspace-list.js";

test("running generation elapsed time uses compact minutes and hours", () => {
  const now = Date.parse("2026-10-01T00:05:00Z");
  assert.equal(formatGenerationElapsed("2026-10-01T00:04:50Z", now), "1m");
  assert.equal(formatGenerationElapsed("2026-09-30T23:18:00Z", now), "47m");
  assert.equal(formatGenerationElapsed("2026-09-30T22:53:00Z", now), "1h 12m");
  assert.equal(formatGenerationElapsed("", now), "");
});

const here = dirname(fileURLToPath(import.meta.url));

test("sidebar lists each visible workspace instead of one Projects bucket", () => {
  const rows = listedSidebarWorkspaces({
    teams: [
      { id: "p1", name: "Sam's Workspace", member_count: 1 },
      { id: "s1", name: "Render3D", member_count: 18 },
      { id: "s2", name: "Hidden Co", member_count: 4 },
    ],
    hiddenIds: ["s2"],
    personalId: "p1",
    personalLabel: "Projects",
    projects: [
      { id: "a", team_id: "p1" },
      { id: "b", team_id: "s1" },
      { id: "c", team_id: "s1" },
      { id: "d", team_id: "s2" },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), ["p1", "s1"]);
  assert.equal(rows[0].personal, true);
  assert.equal(rows[0].label, "Projects");
  assert.equal(rows[0].projectCount, 1);
  assert.equal(rows[1].label, "Render3D");
  assert.equal(rows[1].projectCount, 2);
  assert.equal(rows[1].memberCount, 18);
});

test("sidebar invite is allowed for owners and can_invite, not plain members", () => {
  const rows = listedSidebarWorkspaces({
    teams: [
      { id: "p1", name: "Sam's Workspace", member_count: 1, role: "owner" },
      { id: "s1", name: "Ambots", member_count: 4, role: "user", can_invite: false },
      { id: "s2", name: "Fusion - Render", member_count: 3, role: "user", can_invite: true },
    ],
    personalId: "p1",
    personalLabel: "Projects",
    limit: 10,
  });
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId.p1.canInvite, true);
  assert.equal(byId.s1.canInvite, false);
  assert.equal(byId.s2.canInvite, true);
});

test("personal Projects stays listed even if hidden", () => {
  const rows = listedSidebarWorkspaces({
    teams: [
      { id: "p1", name: "Sam's Workspace", member_count: 1, role: "owner" },
      { id: "s1", name: "Ambots", member_count: 4, role: "member" },
    ],
    hiddenIds: ["p1"],
    personalId: "p1",
    personalLabel: "Projects",
  });
  assert.equal(rows[0].id, "p1");
  assert.equal(rows[0].label, "Projects");
  assert.equal(rows.length, 2);
});

test("hidden workspaces stay out of the left list", () => {
  const rows = listedSidebarWorkspaces({
    teams: [{ id: "a", name: "A", member_count: 2 }],
    hiddenIds: new Set(["a"]),
    projects: [{ id: "p", team_id: "a" }],
  });
  assert.equal(rows.length, 0);
});

test("solo email workspace is labeled Projects and stays personal", () => {
  const rows = listedSidebarWorkspaces({
    teams: [
      { id: "p1", name: "vineetsai@gmail.com", member_count: 1, role: "owner" },
      { id: "s1", name: "Ambots", member_count: 4, role: "member" },
      { id: "s2", name: "Render3D", member_count: 18, role: "member" },
    ],
    personalLabel: "Projects",
  });
  const personal = rows.find((r) => r.id === "p1");
  assert.equal(personal.personal, true);
  assert.equal(personal.label, "Projects");
  assert.equal(rows.find((r) => r.id === "s1").personal, false);
});

test("sidebar WORKSPACES shows only the last opened project and its workspace", () => {
  const teams = [
    { id: "p1", name: "Sam's Workspace", member_count: 1, role: "owner" },
    { id: "s1", name: "Ambots", member_count: 4, role: "member" },
    { id: "s2", name: "Fusion-Render", member_count: 3, role: "member" },
    { id: "s3", name: "Render3D", member_count: 18, role: "member" },
  ];
  const projects = [
    { id: "d2d551ea-electronics", name: "Concrete Printer Electronics", team_id: "s3", updated_at: "2026-08-01T00:00:00Z" },
    { id: "new", name: "Newer in Render3D", team_id: "s3", updated_at: "2026-09-08T00:00:00Z" },
    { id: "bot", name: "Bot", team_id: "s1", updated_at: "2026-09-09T00:00:00Z" },
  ];
  assert.equal(mostRecentProjectForWorkspace(projects, "s3").id, "new");
  const row = lastOpenedSidebarProject({
    teams,
    projects,
    lastOpenedProjectId: "d2d551ea-electronics",
    activeProjectId: "bot",
    personalId: "p1",
  });
  assert.equal(row.project.id, "d2d551ea-electronics");
  assert.equal(row.project.name, "Concrete Printer Electronics");
  assert.equal(row.id, "s3");
  assert.equal(row.label, "Render3D");
  assert.equal(row.personal, false);
});

test("sidebar WORKSPACES last opened falls back to the active project", () => {
  const teams = [
    { id: "p1", name: "Sam's Workspace", member_count: 1, role: "owner" },
    { id: "s3", name: "Render3D", member_count: 18, role: "member" },
  ];
  const projects = [
    { id: "arm", name: "Robot Arm", team_id: "s3" },
  ];
  const row = lastOpenedSidebarProject({
    teams,
    projects,
    lastOpenedProjectId: "gone",
    activeProjectId: "arm",
    personalId: "p1",
  });
  assert.equal(row.project.id, "arm");
  assert.equal(row.label, "Render3D");
  assert.equal(
    lastOpenedSidebarProject({
      teams,
      projects,
      lastOpenedProjectId: null,
      activeProjectId: "mine",
      personalId: "p1",
    }),
    null,
  );
  assert.equal(
    lastOpenedSidebarProject({
      teams,
      projects,
      personalId: "p1",
    }),
    null,
  );
});

test("sidebar WORKSPACES last opened can be a personal project", () => {
  const row = lastOpenedSidebarProject({
    teams: [
      { id: "p1", name: "Sam's Workspace", member_count: 1, role: "owner" },
      { id: "s3", name: "Render3D", member_count: 18, role: "member" },
    ],
    projects: [{ id: "mine", name: "My CAD", team_id: "p1" }],
    lastOpenedProjectId: "mine",
    personalId: "p1",
    personalLabel: "Projects",
  });
  assert.equal(row.personal, true);
  assert.equal(row.label, "Projects");
  assert.equal(row.project.id, "mine");
});

test("unlisted personal catch-up restores orphaned root projects", () => {
  const extra = unlistedPersonalProjects(
    [
      { id: "arm", name: "Robot Arm" },
      { id: "orphan", name: "Lost", folder_id: "gone" },
      { id: "pub", name: "Public", public: true },
    ],
    {
      listedIds: ["arm"],
      isPersonalProject: (p) => !p.public,
      personalFolderIds: [],
    },
  );
  assert.deepEqual(extra.map((p) => p.id), ["orphan"]);
});

test("unlisted personal catch-up does not undo Projects search", () => {
  const projects = [
    { id: "arm", name: "Robot Arm" },
    { id: "vase", name: "Vase Plant" },
    ...Array.from({ length: 160 }, (_, i) => ({ id: `p${i}`, name: `Part ${i}` })),
  ];
  const query = "arm";
  const listed = projects.filter((p) => String(p.name).toLowerCase().includes(query));
  const extra = unlistedPersonalProjects(projects, {
    listedIds: listed.map((p) => p.id),
    isPersonalProject: () => true,
    includeProject: (p) => String(p.name).toLowerCase().includes(query),
  });
  assert.equal(listed.length, 1);
  assert.equal(extra.length, 0);
  assert.equal(projects.length, 162);
});

test("Explorer search catch-up stays wired and WORKSPACES stays one row", () => {
  const src = readFileSync(join(here, "workspace-browser.js"), "utf8");
  assert.match(src, /function revokeUnlistedProjectThumbs\(keepIds\) \{ \/\/ leakfix27/);
  assert.match(src, /revokeUnlistedProjectThumbs\(keepThumbIds\); \/\/ leakfix27/);
  assert.match(src, /let foldersRefreshAbort = null; \/\/ leakfix47/);
  assert.match(src, /async function refreshFolders\(\)[\s\S]{0,3200}signal: ctl\.signal/);
  assert.match(src, /unlistedPersonalProjects\(/);
  assert.match(src, /includeProject:\s*\(p\)\s*=>\s*!searching \|\| matchesProjectSearch/);
  assert.match(src, /rows: current \? \[current\] : \[\]/);
  assert.match(src, /appendSharedProjectsSection/);
  assert.match(src, /Shared Projects/);
  assert.doesNotMatch(src, /listedSidebarWorkspaces\(\{[\s\S]*limit:\s*5/);
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(app, /workspace-browser\.js\?v=20260908-projsearch1/);
  assert.match(app, /workspace-list\.js\?v=20260908-projsearch1/);
  assert.match(app, /createNewProject\(\{\s*teamId/);
  assert.match(app, /onSelectWorkspace/);
});

test("SHARED PROJECTS lists one current/last shared project and splits popup groups", () => {
  const projects = [
    { id: "mine", name: "My CAD", owner_user_id: "me", share_count: 2, updated_at: "2026-09-01T00:00:00Z" },
    { id: "arm", name: "Robot Arm", shared_with_me: true, owner_name: "Docs Demo", team_id: "s3", updated_at: "2026-09-08T00:00:00Z" },
    { id: "pub", name: "Public", public: true, shared_with_me: true },
    { id: "old", name: "Older share", shared_with_me: true, updated_at: "2026-01-01T00:00:00Z" },
  ];
  const parts = partitionSharedProjects({ projects, currentUserId: "me" });
  assert.deepEqual(parts.withMe.map((p) => p.id), ["arm", "old"]);
  assert.deepEqual(parts.byMe.map((p) => p.id), ["mine"]);
  assert.equal(
    currentListedSidebarSharedProject({
      projects,
      lastOpenedProjectId: "old",
      activeProjectId: "arm",
      currentUserId: "me",
    }).id,
    "old",
  );
  assert.equal(
    currentListedSidebarSharedProject({
      projects,
      lastOpenedProjectId: "mine-personal",
      currentUserId: "me",
    }).id,
    "arm",
  );
  assert.equal(
    sharedCreateTeamId({
      projects,
      lastOpenedProjectId: "arm",
      currentUserId: "me",
      fallbackTeamId: "personal",
    }),
    "s3",
  );
  assert.equal(
    currentListedSidebarSharedProject({ projects: [{ id: "p", name: "Solo" }], currentUserId: "me" }),
    null,
  );
  const strip = listedSidebarSharedProjects({
    projects,
    currentUserId: "me",
    lastOpenedProjectId: "arm",
    recentsCount: 1,
    pinnedIds: ["old"],
  });
  assert.deepEqual(strip.map((p) => p.id), ["old", "arm"]);
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  };
  saveSharedSidebarPrefs("me", { recentsCount: 7, pinnedIds: ["arm"] }, storage);
  const loaded = loadSharedSidebarPrefs("me", storage);
  assert.equal(loaded.recentsCount, 7);
  assert.deepEqual(loaded.pinnedIds, ["arm"]);
});

test("Explorer WORKSPACES lists exactly one current workspace row", () => {
  const teams = [
    { id: "p1", name: "Sam's Workspace", member_count: 1, role: "owner" },
    { id: "s1", name: "Ambots", member_count: 9, role: "member" },
    { id: "s2", name: "Fusion - Render", member_count: 25, role: "member" },
    { id: "s3", name: "Render3D", member_count: 18, role: "member" },
    { id: "s4", name: "vineetsai@gmail.com", member_count: 2, role: "owner" },
  ];
  const projects = [
    { id: "elec", team_id: "s3" },
    { id: "bot", team_id: "s1" },
    { id: "cad", team_id: "s2" },
    ...Array.from({ length: 131 }, (_, i) => ({ id: `r${i}`, team_id: "s3" })),
  ];
  const roster = listedSidebarWorkspaces({ teams, personalId: "p1", projects, limit: 5 });
  assert.ok(roster.length > 1);
  const row = currentListedSidebarWorkspace({
    teams,
    projects,
    lastOpenedProjectId: "elec",
    personalId: "p1",
    recentIds: ["s1", "s2", "s3"],
  });
  assert.equal(row.id, "s3");
  assert.equal(row.label, "Render3D");
  assert.equal(row.projectCount, 132);
  assert.equal(
    currentSidebarWorkspaceId({
      teams,
      projects,
      lastOpenedProjectId: "elec",
      recentIds: ["s1", "s2"],
    }),
    "s3",
  );
});

test("opening a workspace switches the single Explorer WORKSPACES row", () => {
  const teams = [
    { id: "s1", name: "Ambots", member_count: 9, role: "member" },
    { id: "s3", name: "Render3D", member_count: 18, role: "member" },
  ];
  const projects = [
    { id: "elec", team_id: "s3" },
    { id: "bot", team_id: "s1" },
  ];
  const fromOpen = currentListedSidebarWorkspace({
    teams,
    projects,
    lastOpenedProjectId: "elec",
    openedWorkspaceId: "s1",
  });
  assert.equal(fromOpen.id, "s1");
  assert.equal(fromOpen.label, "Ambots");
  const fromRecent = currentListedSidebarWorkspace({
    teams,
    projects,
    lastOpenedProjectId: "elec",
    recentIds: ["s1", "s3"],
    preferRecent: true,
  });
  assert.equal(fromRecent.id, "s1");
});

test("named collab workspace keeps its name on the last opened card", () => {
  const row = lastOpenedSidebarProject({
    teams: [{ id: "ebea2465", name: "Docs Demo", member_count: 1, role: "member" }],
    projects: [{ id: "2dbdc8dc", name: "Robot Arm", team_id: "ebea2465" }],
    lastOpenedProjectId: "2dbdc8dc",
    personalId: "ebea2465",
    personalLabel: "Projects",
  });
  assert.equal(row.label, "Docs Demo");
  assert.equal(row.project.id, "2dbdc8dc");
});

test("projects and folders for a workspace stay scoped to that team", () => {
  const projects = projectsForWorkspace(
    [{ id: "1", team_id: "w1" }, { id: "2", team_id: "w2" }],
    "w1",
  );
  assert.deepEqual(projects.map((p) => p.id), ["1"]);
  const folders = foldersForWorkspace(
    [
      { id: "f1", team_id: "w1", name: "Parts" },
      { id: "f2", team_id: "w2", name: "Other" },
      { id: "__public__", public: true, name: "Public" },
    ],
    "w1",
  );
  assert.equal(folders.length, 1);
  assert.equal(folders[0].name, "Parts");
});

test("admin other-user renders stay out of personal Projects", () => {
  const shared = ["be195dc6", "771b6c41"];
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "687e1b5a", name: "MAIN TEST 1", folder_id: "__other_user_renders__", owner_name: "Kiefer Weiser" },
      { sharedWorkspaceIds: shared },
    ),
    false,
  );
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "2dbdc8dc", name: "Robot Arm", team_id: "ebea2465", shared_with_me: true, owner_name: "Docs Demo" },
      { sharedWorkspaceIds: shared },
    ),
    false,
  );
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "a1019056", name: "Sam CAD", team_id: "be195dc6" },
      { sharedWorkspaceIds: shared },
    ),
    true,
  );
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "0d5b715b", name: "In folder", team_id: "be195dc6", folder_id: "18ff33fe" },
      { sharedWorkspaceIds: shared },
    ),
    true,
  );
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "kiefer", name: "MAIN TEST 1", team_id: "be195dc6", owner_user_id: "kiefer" },
      { sharedWorkspaceIds: shared, currentUserId: "6500dec9-c06" },
    ),
    false,
  );
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "sam-cad", team_id: "be195dc6", owner_user_id: "6500dec9-c06", folder_id: "18ff33fe" },
      { sharedWorkspaceIds: shared, currentUserId: "6500dec9-c06" },
    ),
    true,
  );
});

test("personal folders are owned folders, not shared-workspace dumps", () => {
  assert.equal(
    belongsInPersonalFolderList(
      { id: "18ff33fe", team_id: "be195dc6", created_by: "6500dec9-c06" },
      { currentUserId: "6500dec9-c06" },
    ),
    true,
  );
  assert.equal(
    belongsInPersonalFolderList(
      { id: "__shared_ws_s1", shared_workspace: true },
      { currentUserId: "6500dec9-c06", ownedFolderIds: ["__shared_ws_s1"] },
    ),
    false,
  );
  assert.equal(
    belongsInPersonalFolderList(
      { id: "f-owned", team_id: "be195dc6" },
      { currentUserId: "6500dec9-c06", ownedFolderIds: ["f-owned"] },
    ),
    true,
  );
});

test("leftover unnamed solo team is not personal when collab workspaces exist", () => {
  const teams = [
    { id: "legacy", name: "Archive", member_count: 1, role: "owner" },
    { id: "be195dc6", name: "Render3D", member_count: 18, role: "owner" },
  ];
  assert.equal(inferPersonalWorkspaceId(teams), "");
  assert.equal(inferPersonalWorkspaceId(teams, "legacy"), "");
});

test("multi-member email team is not a personal workspace", () => {
  const teams = [
    { id: "021dd360", name: "vineetsai@gmail.com", member_count: 2, role: "owner" },
    { id: "be195dc6", name: "Render3D", member_count: 18, role: "owner" },
    { id: "771b6c41", name: "Fusion - Render", member_count: 4, role: "owner" },
  ];
  assert.equal(inferPersonalWorkspaceId(teams), "");
  assert.equal(inferPersonalWorkspaceId(teams, "021dd360"), "");
  assert.equal(inferPersonalWorkspaceId(teams, "be195dc6"), "");
});

test("Sam-style teams list shared workspaces in the switcher", () => {
  const rows = listedSidebarWorkspaces({
    teams: [
      { id: "021dd360", name: "vineetsai@gmail.com", member_count: 2, role: "owner" },
      { id: "be195dc6", name: "Render3D", member_count: 18, role: "owner" },
      { id: "771b6c41", name: "Fusion - Render", member_count: 4, role: "owner" },
      { id: "ambots", name: "Ambots", member_count: 10, role: "owner" },
    ],
    personalLabel: "Projects",
    projects: [
      { id: "a", team_id: "be195dc6", owner_user_id: "me" },
      { id: "b", team_id: "771b6c41", owner_user_id: "me" },
    ],
  });
  assert.ok(rows.every((r) => !r.personal));
  assert.ok(rows.some((r) => r.id === "be195dc6"));
  assert.ok(rows.some((r) => r.id === "771b6c41"));
  assert.ok(rows.some((r) => r.id === "ambots"));
});

test("no solo workspace lists owned projects across teams", () => {
  const me = "6500dec9-c06";
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "sam-r3d", team_id: "be195dc6", owner_user_id: me },
      { currentUserId: me },
    ),
    true,
  );
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "sam-fusion", team_id: "771b6c41", owner_user_id: me },
      { currentUserId: me },
    ),
    true,
  );
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "kiefer", team_id: "be195dc6", owner_user_id: "kiefer" },
      { currentUserId: me },
    ),
    false,
  );
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "other", folder_id: "__other_user_renders__", owner_user_id: me },
      { currentUserId: me },
    ),
    false,
  );
});

test("Projects root uses recency when every sort_order is 0", () => {
  const rows = sortProjectsForDisplay(
    [
      { id: "old", name: "Old", sort_order: 0, updated_at: "2026-01-01T00:00:00Z" },
      { id: "mid", name: "Mid", sort_order: 0, updated_at: "2026-08-01T00:00:00Z" },
      { id: "new", name: "New", sort_order: 0, updated_at: "2026-09-08T12:00:00Z" },
      { id: "opened", name: "Opened", sort_order: 0, opened_at: "2026-09-08T18:00:00Z" },
    ],
  );
  assert.deepEqual(rows.map((p) => p.id), ["opened", "new", "mid", "old"]);
});

test("public pinned favorites sort above other public models", () => {
  const rows = sortProjectsForDisplay([
    { id: "old", public: true, public_pinned: false, updated_at: "2026-09-14T00:00:00Z" },
    { id: "fav", public: true, public_pinned: true, updated_at: "2026-01-01T00:00:00Z" },
    { id: "mid", public: true, updated_at: "2026-09-13T00:00:00Z" },
  ]);
  assert.equal(rows[0].id, "fav");
});

test("admin pin-to-public is distinct from personal rail pin", () => {
  const browser = readFileSync(join(here, "workspace-browser.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(browser, /Pin to public/);
  assert.match(browser, /Unpin from public/);
  assert.match(browser, /data-action="pin-public"/);
  assert.match(app, /public-pin/);
  assert.doesNotMatch(browser, /data-action="pin-public"[\s\S]{0,80}shared-projects-pin/);
});

test("personal pins cap at 5 and refuse a sixth without dropping", () => {
  assert.equal(PERSONAL_PIN_MAX, 5);
  const first = togglePersonalProjectPin([], "a");
  assert.equal(first.ok, true);
  assert.deepEqual(first.pinnedIds, ["a"]);
  let ids = first.pinnedIds;
  for (const id of ["b", "c", "d", "e"]) {
    const next = togglePersonalProjectPin(ids, id);
    assert.equal(next.ok, true);
    ids = next.pinnedIds;
  }
  assert.deepEqual(ids, ["a", "b", "c", "d", "e"]);
  const sixth = togglePersonalProjectPin(ids, "f");
  assert.equal(sixth.ok, false);
  assert.equal(sixth.error, PERSONAL_PIN_CAP_MESSAGE);
  assert.deepEqual(sixth.pinnedIds, ids);
  const unpinned = togglePersonalProjectPin(ids, "c");
  assert.equal(unpinned.ok, true);
  assert.deepEqual(unpinned.pinnedIds, ["a", "b", "d", "e"]);
  const again = togglePersonalProjectPin(unpinned.pinnedIds, "f");
  assert.equal(again.ok, true);
  assert.deepEqual(again.pinnedIds, ["a", "b", "d", "e", "f"]);
});

test("pinned projects partition above the rest and persist", () => {
  const { pinned, rest } = partitionPersonalPinnedProjects(
    [
      { id: "old", name: "Old" },
      { id: "fav", name: "Fav" },
      { id: "mid", name: "Mid" },
    ],
    ["fav", "missing", "mid"],
  );
  assert.deepEqual(pinned.map((p) => p.id), ["fav", "mid"]);
  assert.deepEqual(rest.map((p) => p.id), ["old"]);
  assert.equal(canPinPersonalProject({ id: "mine" }), true);
  assert.equal(canPinPersonalProject({ id: "pub", public: true }), false);
  assert.equal(canPinPersonalProject({ id: "x", folder_id: "__public__" }), false);
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  };
  savePersonalPinIds("me", ["a", "a", "b"], storage);
  assert.deepEqual(loadPersonalPinIds("me", storage), ["a", "b"]);
  assert.deepEqual(normalizePersonalPinIds(["  ", "z", "z"]), ["z"]);
});

test("pinned section CSS and pin/unpin controls stay distinct from public pin", () => {
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  const browser = readFileSync(join(here, "workspace-browser.js"), "utf8");
  const search = readFileSync(join(here, "../components/viewport-search.js"), "utf8");
  assert.match(css, /\.explorer-pinned-section\s*\{[^}]*border:\s*1px solid/);
  assert.match(css, /\.explorer-pinned-label/);
  assert.match(css, /\.btn-proj-pin/);
  assert.match(css, /\.proj-item--user-pinned/);
  assert.match(browser, /data-action="pin-personal"/);
  assert.match(browser, /Pin to projects/);
  assert.match(browser, /Unpin from projects/);
  assert.match(browser, /explorer-pinned-section/);
  assert.match(search, /Pin to projects/);
  assert.match(search, /data-vp-search-action="pin"/);
  assert.doesNotMatch(browser, /data-action="pin-personal"[\s\S]{0,80}pin-public/);
});

test("public explorer label remaps Unfiled to Public projects", async () => {
  const { publicExplorerFolderLabel, PUBLIC_PROJECTS_LABEL } = await import("./workspace-browser.js");
  assert.equal(PUBLIC_PROJECTS_LABEL, "Public projects");
  assert.equal(publicExplorerFolderLabel({ id: "__public__", name: "Unfiled", public: true }), "Public projects");
  assert.equal(publicExplorerFolderLabel({ id: "__public__", name: "Public", public: true }), "Public projects");
  assert.equal(publicExplorerFolderLabel({ name: "Unfiled", virtual: true }), "Public projects");
  assert.equal(publicExplorerFolderLabel({ name: "Boat parts" }), "Boat parts");
});

test("cache-bust projpin1 merges without dropping existing tokens", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const browser = readFileSync(join(here, "workspace-browser.js"), "utf8");
  assert.equal(PERSONAL_PIN_CACHE, "projpin1");
  assert.match(html, /styles\.css\?v=[^"']*projpin1/);
  assert.match(html, /app\.js\?v=[^"']*projpin1/);
  assert.match(html, /app\.js\?v=[^"']*setui1/);
  assert.match(html, /app\.js\?v=[^"']*onlinemod1/);
  assert.match(html, /app\.js\?v=[^"']*logo1/);
  assert.match(html, /app\.js\?v=[^"']*pty1/);
  assert.match(html, /app\.js\?v=[^"']*xrclick1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*projpin1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*onlinemod1/);
  assert.match(browser, /workspace-list\.js\?v=[^"']*projpin1/);
  assert.match(app, /\/api\/users\/me\/project-pins/);
});

test("explorer 3-dot menus open a compact action strip", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const browser = readFileSync(join(here, "workspace-browser.js"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(browser, /function openActionStrip/);
  assert.match(browser, /function folderStripButtons/);
  assert.match(browser, /function projectStripButtons/);
  assert.match(browser, /explorer-action-strip/);
  assert.match(browser, /proj-item-kebab/);
  assert.match(browser, /openActionStrip\(btn, folderStripButtons\(folder\)\)/);
  assert.match(browser, /openActionStrip\(kebab, projectStripButtons\(p\)\)/);
  assert.match(css, /\.explorer-action-strip\s*\{/);
  assert.match(css, /\.proj-row-actions--kebab/);
  assert.match(css, /\.browser-child-group > \.browser-item-more/);
  assert.match(html, /20260915-browserdots1/);
  assert.match(html, /favicon-48\.png\?v=20260915-browserdots1/);
  assert.match(html, /canvaskebab1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*20260915-browserdots1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*canvaskebab1/);
  assert.match(browser, /attachHierarchyKebab\(folderLi/);
  assert.match(browser, /attachHierarchyKebab\(item, hierarchyStripButtons\(project, entry, sectionId\)\)/);
  assert.match(browser, /makeStripBtn\("Send to AI"/);
  assert.match(browser, /attachOpenCanvasAffordance/);
  assert.match(browser, /proj-hierarchy-open-canvas/);
  assert.match(browser, /Open canvas/);
  assert.match(browser, /onOpenCanvasBoard/);
  assert.match(app, /onOpenCanvasBoard/);
  assert.match(app, /async function openCanvasBoardFromBrowser/);
  assert.match(css, /\.proj-hierarchy-open-canvas/);
  assert.match(html, /canvasopen1/);
  assert.match(html, /foldcode1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*canvasopen1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*foldcode1/);
  assert.match(browser, /Open in code editor/);
  assert.match(browser, /Open in video editor/);
  assert.match(html, /vidopen1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*vidopen1/);
});

test("opening an old project floats it to the top", () => {
  const rows = sortProjectsForDisplay([
    {
      id: "fc557e30",
      name: "benchy_style_toy_boat",
      sort_order: 0,
      updated_at: "2026-06-06T02:55:30.342013+00:00",
      opened_at: "2026-09-08T09:30:00.000Z",
      mtime: 1788859734.028,
    },
    {
      id: "14278684",
      name: "benchy_style_toy_boat",
      sort_order: 0,
      updated_at: "2026-09-08T09:29:57.192199+00:00",
    },
    {
      id: "e50cb09b",
      name: "Yeti Mountain Bike",
      sort_order: 0,
      updated_at: "2026-09-04T17:26:45.591734+00:00",
    },
  ]);
  assert.deepEqual(rows.map((p) => p.id), ["fc557e30", "14278684", "e50cb09b"]);
});

test("empty opened_at stays below a just-opened sibling", () => {
  const rows = sortProjectsForDisplay([
    { id: "e63395e5", sort_order: 0, created_at: "2026-01-01T00:00:00Z", opened_at: null },
    { id: "projsearch1", sort_order: 0, updated_at: "2026-09-08T12:00:00Z", opened_at: "2026-09-09T21:00:00Z" },
  ]);
  assert.deepEqual(rows.map((p) => p.id), ["projsearch1", "e63395e5"]);
});

test("Projects root recency handles epoch ms, mtime fallback, and empty stamps", () => {
  const rows = sortProjectsForDisplay(
    [
      { id: "a", sort_order: 0, updated_at: 0 },
      { id: "b", sort_order: 0, updated_at: Date.parse("2026-09-08T00:00:00Z") },
      { id: "c", sort_order: 0, created_at: "2026-07-01T00:00:00Z" },
      { id: "d", sort_order: 0, mtime: "2026-09-07T20:00:00Z" },
    ],
  );
  assert.deepEqual(rows.map((p) => p.id), ["b", "d", "c", "a"]);
});

test("compact show-5 slices the already-sorted array", () => {
  const rows = sortProjectsForDisplay([
    { id: "a", sort_order: 0, updated_at: "2026-01-01T00:00:00Z" },
    { id: "b", sort_order: 0, updated_at: "2026-09-08T00:00:00Z" },
    { id: "c", sort_order: 0, updated_at: "2026-07-01T00:00:00Z" },
    { id: "d", sort_order: 0, updated_at: "2026-08-01T00:00:00Z" },
    { id: "e", sort_order: 0, updated_at: "2026-06-01T00:00:00Z" },
    { id: "f", sort_order: 0, updated_at: "2026-05-01T00:00:00Z" },
  ]);
  assert.deepEqual(rows.slice(0, 5).map((p) => p.id), ["b", "d", "c", "e", "f"]);
});

test("folder lists still honor drag sort_order when any sibling is non-zero", () => {
  const rows = sortProjectsForDisplay([
    { id: "newer", sort_order: 2, updated_at: "2026-09-08T00:00:00Z" },
    { id: "pinned", sort_order: 0, updated_at: "2026-01-01T00:00:00Z" },
    { id: "mid", sort_order: 1, updated_at: "2026-08-01T00:00:00Z" },
  ]);
  assert.deepEqual(rows.map((p) => p.id), ["pinned", "mid", "newer"]);
});

test("Projects root recency ignores leftover drag sort_order", () => {
  const rows = sortProjectsForDisplay(
    [
      { id: "newer", sort_order: 2, updated_at: "2026-09-08T00:00:00Z" },
      { id: "pinned", sort_order: 0, updated_at: "2026-01-01T00:00:00Z" },
      { id: "opened", sort_order: 1, updated_at: "2026-02-01T00:00:00Z", opened_at: "2026-09-10T10:00:00Z" },
    ],
    { recencyFirst: true },
  );
  assert.deepEqual(rows.map((p) => p.id), ["opened", "newer", "pinned"]);
});

test("invitee personal workspace still only lists that workspace", () => {
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "mine", team_id: "p1" },
      { personalWorkspaceId: "p1", sharedWorkspaceIds: ["s1"] },
    ),
    true,
  );
  assert.equal(
    belongsInPersonalProjectsList(
      { id: "studio", team_id: "s1", folder_id: "__shared_ws_s1", shared_workspace_folder: true },
      { personalWorkspaceId: "p1", sharedWorkspaceIds: ["s1"] },
    ),
    false,
  );
});

test("headset Enter VR resolves last opened project without inventing one", () => {
  const projects = [
    { id: "old", updated_at: "2026-01-01T00:00:00Z" },
    { id: "new", updated_at: "2026-09-08T00:00:00Z" },
    { id: "pub", public: true, updated_at: "2026-09-09T00:00:00Z" },
  ];
  assert.equal(resolveLastProjectIdForXrBoot({ lastOpenedProjectId: "old", projects }), "old");
  assert.equal(resolveLastProjectIdForXrBoot({
    lastOpenedProjectId: "gone",
    activeProjectId: "old",
    projects,
  }), "gone");
  assert.equal(xrBootEnterPayload({
    lastOpenedProjectId: "gone",
    activeProjectId: "old",
    projects,
  }).emptyScene, false);
  assert.equal(xrBootEnterPayload({
    lastOpenedProjectId: "gone",
    activeProjectId: "old",
    projects,
  }).projectId, "gone");
  assert.equal(resolveLastProjectIdForXrBoot({ projects }), "new");
  assert.equal(resolveLastProjectIdForXrBoot({}), "");
  assert.equal(resolveLastProjectIdForXrBoot({
    projects: [{ id: "pub", public: true, updated_at: "2026-09-09T00:00:00Z" }],
  }), "");
  assert.deepEqual(
    xrBootEnterPayload({ lastOpenedProjectId: "old", projects }),
    { emptyScene: false, openMenu: true, tour: false, fromBoot: true, projectId: "old" },
  );
  assert.equal(xrBootEnterPayload({ lastOpenedProjectId: "old", tour: true, projects }).emptyScene, true);
  assert.equal(xrBootEnterPayload({}).emptyScene, true);
  assert.equal(xrBootEnterPayload({}).projectId, "");
  assert.equal(xrEnterShouldNavigateToViewportHash(), false);
  assert.equal(resolveXrEnterSessionIntent({ hash: "#viewport", shellTab: "viewport" }), "requestSession");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const enterFn = html.slice(html.indexOf("function requestXrEnter"), html.indexOf("function bindBootXrBtn"));
  assert.equal(/location\.hash\s*=/.test(enterFn), false);
  assert.equal(enterFn.includes("fab.click()"), false);
  assert.ok(enterFn.includes("__enterXrFromBoot"));
  assert.ok(enterFn.includes("startFromUserGesture"));
  assert.ok(enterFn.includes('requestSession(window.__bootXrSessionMode'));
});

test("2D VR button uses the selected viewport project, not last-opened", () => {
  const projects = [
    { id: "old", updated_at: "2026-01-01T00:00:00Z" },
    { id: "sel", updated_at: "2026-09-08T00:00:00Z" },
    { id: "pub", public: true, updated_at: "2026-09-09T00:00:00Z" },
  ];
  assert.equal(resolveSelectedProjectIdForXrEnter({
    activeProjectId: "sel",
    projects,
  }), "sel");
  assert.equal(resolveSelectedProjectIdForXrEnter({
    activeProjectId: "gone",
    projects,
  }), "gone");
  assert.equal(xrViewportEnterPayload({
    activeProjectId: "gone",
    hasLiveMesh: false,
    projects,
  }).emptyScene, false);
  assert.equal(resolveSelectedProjectIdForXrEnter({ projects }), "");
  const payload = xrViewportEnterPayload({
    activeProjectId: "sel",
    hasLiveMesh: true,
    projects,
  });
  assert.equal(payload.projectId, "sel");
  assert.equal(payload.emptyScene, false);
  assert.equal(payload.fromBoot, false);
  assert.equal(payload.openMenu, false);
  assert.equal(xrViewportEnterPayload({
    activeProjectId: "",
    hasLiveMesh: true,
    projects,
  }).emptyScene, false);
  assert.equal(xrViewportEnterPayload({
    activeProjectId: "",
    hasLiveMesh: false,
    projects,
  }).emptyScene, true);
  assert.equal(selectedProjectIsInXrScene({
    selectedId: "sel",
    presentingProjectId: "sel",
    hasLiveMesh: true,
    presenting: true,
  }), true);
  assert.equal(selectedProjectIsInXrScene({
    selectedId: "sel",
    presentingProjectId: "old",
    hasLiveMesh: true,
    presenting: true,
  }), false);
  assert.equal(selectedProjectIsInXrScene({
    selectedId: "sel",
    presentingProjectId: "sel",
    hasLiveMesh: true,
    presenting: false,
  }), false);

  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const xr = readFileSync(join(here, "../xr/viewport-xr.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.ok(app.includes("prepareXrEnterSelectedProject"));
  assert.ok(app.includes("syncSelectedProjectIntoXr"));
  assert.ok(app.includes("xrViewportEnterPayload"));
  assert.ok(app.includes("onBeforeEnterFromButton: () => {"));
  assert.match(app, /prepareXrEnterSelectedProject\(\{ fromBoot: false \}\)/);
  assert.ok(app.includes("if (id && !prepared.alreadyInXr)"));
  assert.ok(xr.includes("onBeforeEnterFromButton() === false"));
  const start = xr.slice(xr.indexOf("function startXrFromUserGesture"), xr.indexOf("function enterFromBoot"));
  assert.ok(start.indexOf("onBeforeEnterFromButton") < start.indexOf("return exit()"));
  assert.ok(html.includes("20260909-vrload1"));
  assert.ok(app.includes("20260909-vrload1"));
  assert.ok(html.includes("xrlastproj1"));
  assert.ok(app.includes("xrlastproj1"));
});

test("XR enter defers last-project open when the mesh is not in the viewport yet", () => {
  assert.equal(xrEnterNeedsDeferredOpen({
    projectId: "old",
    activeProjectId: "old",
    hasLiveMesh: true,
  }), false);
  assert.equal(xrEnterNeedsDeferredOpen({
    projectId: "old",
    activeProjectId: "old",
    hasLiveMesh: false,
  }), true);
  assert.equal(xrEnterNeedsDeferredOpen({
    projectId: "old",
    activeProjectId: "other",
    hasLiveMesh: true,
  }), true);
  assert.equal(xrEnterNeedsDeferredOpen({
    projectId: "old",
    emptyScene: true,
    hasLiveMesh: false,
  }), false);
});

test("cached list sorts and paints compact 5 without a network round-trip", () => {
  const cached = Array.from({ length: 167 }, (_, i) => ({
    id: `p${String(i).padStart(3, "0")}`,
    name: `Project ${i}`,
    sort_order: 0,
    updated_at: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  cached[12].updated_at = "2026-09-08T18:00:00Z";
  cached[40].updated_at = "2026-09-08T17:00:00Z";
  cached[7].updated_at = "2026-09-08T16:00:00Z";
  cached[99].updated_at = "2026-09-08T15:00:00Z";
  cached[3].updated_at = "2026-09-08T14:00:00Z";
  const t0 = performance.now();
  const firstFive = sortProjectsForDisplay(cached).slice(0, 5);
  const ms = performance.now() - t0;
  assert.equal(firstFive.length, 5);
  assert.deepEqual(firstFive.map((p) => p.id), ["p012", "p040", "p007", "p099", "p003"]);
  assert.ok(ms < 20, `sorting 167 cached rows took ${ms}ms`);
});

test("project list cache stores metadata only and round-trips", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
  };
  const ok = writeCachedProjectList("6500dec9-c06", [
    {
      id: "p1",
      name: "Fast",
      sort_order: 0,
      updated_at: "2026-09-08T00:00:00Z",
      files: ["huge.stl"],
      browser: { components: [{ name: "part" }] },
      generation: { status: "running", prompt: "A".repeat(5000), jobs: [{ id: "j" }] },
    },
  ], storage);
  assert.equal(ok, true);
  const cached = readCachedProjectList("6500dec9-c06", storage);
  assert.equal(cached.length, 1);
  assert.equal(cached[0].id, "p1");
  assert.equal(cached[0].name, "Fast");
  assert.equal(cached[0].generation.status, "running");
  assert.equal(cached[0].files, undefined);
  assert.equal(cached[0].browser, undefined);
  assert.ok(!JSON.stringify(cached).includes("huge.stl"));
});

test("opening a project PATCHes opened_at and re-renders the list", () => {
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(app, /function markProjectOpenedInExplorer\(id\)/);
  assert.match(app, /allProjects = promoteOpenedProjectInList\(allProjects, id, now\)/);
  assert.equal(/allProjects\[0\]\s*=/.test(app.slice(app.indexOf("function markProjectOpenedInExplorer"), app.indexOf("async function ensureActiveProjectListed"))), false);
  assert.match(app, /\/api\/projects\/\$\{encodeURIComponent\(id\)\}\/opened/);
  assert.match(app, /method:\s*"PATCH"/);
  assert.match(app, /saveLastProjectId\(id\);\s*markProjectOpenedInExplorer\(id\);/);
});

test("opening a project inserts at top and shifts the rest down one", () => {
  const roster = [
    { id: "top", name: "Former first", sort_order: 0, updated_at: "2026-09-09T12:00:00Z" },
    { id: "mid", name: "Middle", sort_order: 0, updated_at: "2026-09-08T12:00:00Z" },
    { id: "old", name: "Clicked", sort_order: 0, updated_at: "2026-01-01T00:00:00Z" },
    { id: "tail", name: "Tail", sort_order: 0, updated_at: "2025-12-01T00:00:00Z" },
  ];
  const overwritten = roster.slice();
  overwritten[0] = { ...roster[2], opened_at: "2026-09-09T21:00:00Z" };
  assert.deepEqual(overwritten.map((p) => p.id), ["old", "mid", "old", "tail"]);

  const next = promoteOpenedProjectInList(roster, "old", "2026-09-09T21:00:00Z");
  assert.equal(next.length, 4);
  assert.deepEqual(next.map((p) => p.id), ["old", "top", "mid", "tail"]);
  assert.equal(next[0].opened_at, "2026-09-09T21:00:00Z");
  assert.equal(next[1].id, "top");
  assert.equal(next[1].name, "Former first");
  assert.deepEqual(sortProjectsForDisplay(next).map((p) => p.id), ["old", "top", "mid", "tail"]);
});

test("opening a project does not add workspace rows or drop search hits", () => {
  const projects = [
    { id: "keep", name: "Alpha boat", team_id: "p1", sort_order: 0, updated_at: "2026-09-09T12:00:00Z" },
    { id: "click", name: "Yeti bike", team_id: "p1", sort_order: 0, updated_at: "2026-01-01T00:00:00Z" },
    { id: "other", name: "Shared", team_id: "s1", sort_order: 0, updated_at: "2026-08-01T00:00:00Z" },
  ];
  const next = promoteOpenedProjectInList(projects, "click", "2026-09-09T21:00:00Z");
  assert.equal(next.length, 3);
  const q = "boat";
  const hits = next.filter((p) => String(p.name || "").toLowerCase().includes(q));
  assert.deepEqual(hits.map((p) => p.id), ["keep"]);
  const row = currentListedSidebarWorkspace({
    teams: [
      { id: "p1", name: "Projects", role: "owner", member_count: 1 },
      { id: "s1", name: "Studio", role: "admin", member_count: 3 },
    ],
    personalId: "p1",
    personalLabel: "Projects",
    projects: next,
    lastOpenedProjectId: "click",
    activeProjectId: "click",
  });
  assert.equal(row?.id, "p1");
  assert.equal(row?.personal, true);
});

test("opening with custom sort_order still keeps the full sibling roster", () => {
  const next = promoteOpenedProjectInList(
    [
      { id: "a", sort_order: 0, updated_at: "2026-09-09T12:00:00Z" },
      { id: "b", sort_order: 1, updated_at: "2026-09-08T12:00:00Z" },
      { id: "c", sort_order: 2, updated_at: "2026-01-01T00:00:00Z" },
    ],
    "c",
    "2026-09-09T21:00:00Z",
  );
  assert.deepEqual(next.map((p) => p.id), ["c", "a", "b"]);
  assert.deepEqual(next.map((p) => p.sort_order), [0, 1, 2]);
  assert.deepEqual(sortProjectsForDisplay(next).map((p) => p.id), ["c", "a", "b"]);
});

test("published owned projects stay personal, including public-folder legacy rows", () => {
  const mine = { id: "published", public: true, owner_user_id: "me", team_id: "solo", folder_id: "designs" };
  const opts = { currentUserId: "me", personalWorkspaceId: "solo" };
  assert.equal(belongsInPersonalProjectsList(mine, opts), true);
  assert.equal(belongsInPersonalProjectsList({ ...mine, owner_user_id: "other" }, opts), false);
  assert.equal(belongsInPersonalProjectsList(mine, {}), false);
  const legacy = { ...mine, folder_id: "__public__" };
  assert.deepEqual(unlistedPersonalProjects([legacy], {
    isPersonalProject: (p) => belongsInPersonalProjectsList(p, opts),
  }).map((p) => p.id), ["published"]);
});
