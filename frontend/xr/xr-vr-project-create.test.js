import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  XR_VRPROJ1_CACHE,
  finishWorkspaceCreateName,
  roomOthersForShare,
  sanitizeProjectName,
  shouldAskShareWithRoom,
  workspaceCreatePromptLines,
  workspaceCreateSharePayload,
} from "./xr-vr-project-create.js";

const here = dirname(fileURLToPath(import.meta.url));

test("vrproj1: name sanitizes and room others drop self/dupes", () => {
  assert.equal(XR_VRPROJ1_CACHE, "vrproj1");
  assert.equal(sanitizeProjectName("  Gear  Box\n"), "Gear Box");
  const others = roomOthersForShare(
    [{ id: "me" }, { id: "a" }, { id: "a" }, { id: "b" }, { id: "" }],
    "me",
  );
  assert.deepEqual(others.map((u) => u.id), ["a", "b"]);
  assert.equal(shouldAskShareWithRoom(others), true);
  assert.equal(shouldAskShareWithRoom([]), false);
});

test("vrproj1: alone skips share ask; others confirm then edit payload", () => {
  const alone = finishWorkspaceCreateName({ name: "Bracket", others: [] });
  assert.deepEqual(alone, { name: "Bracket", shareAsk: false, create: true, shareRoom: false });
  const room = finishWorkspaceCreateName({ name: " Table ", others: [{ id: "p2" }] });
  assert.equal(room.shareAsk, true);
  assert.equal(room.create, false);
  assert.equal(room.name, "Table");
  const lines = workspaceCreatePromptLines({ shareAsk: true, othersCount: 2 });
  assert.equal(lines[0].label, "Share with people in this room?");
  assert.equal(lines[1].id, "ws-create-share-yes");
  assert.equal(lines[2].id, "ws-create-share-no");
  const named = workspaceCreatePromptLines({ name: "Arm" });
  assert.equal(named[0].id, "ws-create-name");
  assert.equal(named[0].label, "Arm");
  assert.equal(named[1].id, "ws-create-go");
  const payload = workspaceCreateSharePayload({
    name: "Arm",
    shareRoom: true,
    users: [{ id: "p2", handle: "pat" }],
  });
  assert.equal(payload.role, "editor");
  assert.equal(payload.shareRoom, true);
  assert.equal(payload.users[0].id, "p2");
});

test("vrproj1: HUD + named create + room-share-edit stay on existing Workspace +", () => {
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.ok(xr.includes('id: "ws-add"'));
  assert.ok(xr.includes("workspaceCreatePrompt"));
  assert.ok(xr.includes("Share with people in this room?"));
  assert.ok(xr.includes("ws-create-share-yes"));
  assert.ok(xr.includes("openWorkspaceKeyboard"));
  assert.ok(xr.includes("applyKeyboardKey"));
  assert.ok(app.includes("shareRoom"));
  assert.ok(app.includes('role: "editor"') || app.includes("role: role"));
  assert.ok(app.includes("/shares"));
  assert.ok(app.includes("wantedName") || app.includes("newProjectQuery(teamId, wantedName)"));
  assert.ok(app.includes("personalWorkspaceId()"));
  assert.ok(html.includes("vrproj1"));
  assert.ok(app.includes("vrproj1"));
  assert.ok(html.includes("xrwin1"));
  assert.ok(app.includes("xrwin1"));
  assert.ok(xr.includes("xrwin1"));
});
