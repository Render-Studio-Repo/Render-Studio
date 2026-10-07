import { test } from "node:test";
import assert from "node:assert/strict";
import { studioLinesForTab, studioTabIds } from "./xr-hot-path.js?v=roboticsworkspace3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("Studio tabs are Stats History Access Keys and never empty", () => {
  assert.deepEqual(studioTabIds(), ["stats", "history", "access", "keys"]);
  for (const tab of studioTabIds()) {
    const { lines, footer } = studioLinesForTab(tab, {});
    assert.ok(lines.length >= 1, `${tab} should show a row`);
    assert.ok(footer);
  }
});

test("Stats lists token totals across users; History restore matches laptop rules", () => {
  const stats = studioLinesForTab("stats", {
    usage: {
      queries: 4,
      tokens: 1200,
      by_user: [
        { name: "Ada", queries: 3, tokens: 900 },
        { name: "Sam", queries: 1, tokens: 300 },
      ],
    },
  });
  assert.match(stats.lines[0].label, /4 queries/);
  assert.match(stats.lines[0].label, /1200 tokens/);
  assert.equal(stats.lines[1].label.startsWith("Ada"), true);

  const hist = studioLinesForTab("history", {
    history: [
      { label: "Old", created_at: "2026-09-01T10:00:00", restorable: true, timeline_index: 0, user_name: "Sam" },
      { label: "Moved", created_at: "2026-09-07T18:00:00", user_name: "Sam" },
      { label: "New build", created_at: "2026-09-07T19:00:00", restorable: true, timeline_index: 3, user_name: "Ada" },
    ],
  });
  assert.equal(hist.lines[0].label, "New build");
  assert.equal(hist.lines[0].id, "hist:3");
  assert.equal(hist.lines[1].id, "");
  assert.match(hist.lines[1].sub, /Log only/);
});

test("Access can save to a workspace; Keys grant rows sync to Connect", () => {
  const access = studioLinesForTab("access", {
    team_id: "t1",
    teams: [{ id: "t1", name: "Studio" }, { id: "t2", name: "Other" }],
    shares: [{ user_id: "u2", display_name: "Mate" }],
  });
  assert.equal(access.lines.some((l) => l.id === "ws:t2"), true);
  assert.equal(access.lines.some((l) => l.id === "unshare:u2"), true);
  assert.equal(access.lines.some((l) => l.id === "share_invite"), true);
  const src = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.ok(src.includes("openProjectShare"));
  assert.ok(src.includes("/api/projects/${encodeURIComponent(projectId)}/workspace"));
  assert.ok(src.includes("/api/projects/${encodeURIComponent(projectId)}/shares/"));

  const keys = studioLinesForTab("keys", {
    keys: [{
      kind: "chatgpt",
      id: "s1",
      team_id: "t1",
      label: "ChatGPT",
      members: [
        { user_id: "host", display_name: "Host", granted: true, is_owner: true },
        { user_id: "mate", display_name: "Mate", granted: false, is_owner: false },
      ],
    }],
  });
  const grant = keys.lines.find((l) => String(l.id).startsWith("key:"));
  assert.ok(grant);
  assert.match(grant.id, /chatgpt:t1:s1:mate:1/);
});

test("VR Studio panel has no open/close X", () => {
  const src = readFileSync(join(here, "xr-studio-panel.js"), "utf8");
  assert.equal(src.includes("drawWindowCloseX"), false);
  assert.equal(src.includes("studio-close"), false);
  assert.equal(src.includes("xrStudioClose"), false);
});

test("presenting Shot dock still lists Shot, PC, and X", () => {
  const src = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(src.includes('id: "screenshot"'));
  assert.ok(src.includes('id: "shot_send_pc"'));
  assert.ok(src.includes('id: "shot_share_x"'));
});
