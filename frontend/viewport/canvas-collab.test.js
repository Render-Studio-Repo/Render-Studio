import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANVAS_SHARE_MODES,
  CANVAS_SHARE_MODE_LABELS,
  normalizeCanvasShareMode,
  canvasShareModeAllowsEdit,
  canvasShareModeAllowsRemix,
  joinRoleForCanvasMode,
  canvasObjectAuthorId,
  stampCanvasAuthor,
  shouldShowCanvasAuthorHover,
  shouldShowCanvasEditTimeline,
  applyCanvasCollabPatch,
  appendCanvasEditEvent,
} from "./canvas-collab.js";

const here = dirname(fileURLToPath(import.meta.url));
const canvasMode = readFileSync(join(here, "canvas-mode.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const collab = readFileSync(join(here, "../social/collab.js"), "utf8");

test("canvas share permission enum is view / remix / edit", () => {
  assert.deepEqual([...CANVAS_SHARE_MODES], ["view", "remix", "edit"]);
  assert.equal(normalizeCanvasShareMode("View"), "view");
  assert.equal(normalizeCanvasShareMode("view and remix"), "remix");
  assert.equal(normalizeCanvasShareMode("view, edit, remix"), "edit");
  assert.equal(normalizeCanvasShareMode("view_edit_remix"), "edit");
  assert.equal(canvasShareModeAllowsEdit("view"), false);
  assert.equal(canvasShareModeAllowsEdit("remix"), false);
  assert.equal(canvasShareModeAllowsEdit("edit"), true);
  assert.equal(canvasShareModeAllowsRemix("view"), false);
  assert.equal(canvasShareModeAllowsRemix("remix"), true);
  assert.equal(canvasShareModeAllowsRemix("edit"), true);
  assert.equal(joinRoleForCanvasMode("view"), "viewer");
  assert.equal(joinRoleForCanvasMode("remix"), "remixer");
  assert.equal(joinRoleForCanvasMode("edit"), "editor");
  assert.equal(CANVAS_SHARE_MODE_LABELS.view.title, "View");
  assert.equal(CANVAS_SHARE_MODE_LABELS.remix.title, "View and remix");
  assert.equal(CANVAS_SHARE_MODE_LABELS.edit.title, "View, edit, remix");
});

test("canvas objects carry authorUserId going forward", () => {
  const el = { id: "stroke-1", type: "pen", points: [{ x: 1, y: 1 }] };
  stampCanvasAuthor(el, { id: "u1", display_name: "Sam", avatar_url: "/a.png" });
  assert.equal(canvasObjectAuthorId(el), "u1");
  assert.equal(el.authorName, "Sam");
  stampCanvasAuthor(el, { id: "u2", display_name: "Other" });
  assert.equal(el.authorUserId, "u1");
  const legacy = { id: "old", type: "rect" };
  assert.equal(canvasObjectAuthorId(legacy), "");
  assert.equal(shouldShowCanvasAuthorHover(el, "u2"), true);
  assert.equal(shouldShowCanvasAuthorHover(el, "u1"), false);
  assert.equal(shouldShowCanvasAuthorHover(legacy, "u1"), false);
});

test("edit timeline is visible iff multi-author or multi-presence", () => {
  const mine = [{ id: "a", authorUserId: "me" }];
  const ours = [{ id: "a", authorUserId: "me" }, { id: "b", authorUserId: "you" }];
  assert.equal(shouldShowCanvasEditTimeline({
    elements: mine,
    presenceUserIds: [],
    localUserId: "me",
  }), false);
  assert.equal(shouldShowCanvasEditTimeline({
    elements: ours,
    presenceUserIds: [],
    localUserId: "me",
  }), true);
  assert.equal(shouldShowCanvasEditTimeline({
    elements: mine,
    presenceUserIds: ["you"],
    localUserId: "me",
  }), true);
  const timeline = appendCanvasEditEvent([], {
    userId: "you",
    displayName: "Pat",
    action: "draw",
    elementType: "pen",
  });
  assert.equal(shouldShowCanvasEditTimeline({
    elements: mine,
    timeline,
    localUserId: "me",
  }), true);
});

test("live patch upserts and deletes by id", () => {
  const start = [{ id: "a", type: "pen", authorUserId: "me" }];
  const upserted = applyCanvasCollabPatch(start, {
    op: "upsert",
    element: { id: "b", type: "line", authorUserId: "you" },
  });
  assert.equal(upserted.length, 2);
  const moved = applyCanvasCollabPatch(upserted, {
    op: "upsert",
    element: { id: "a", type: "pen", x1: 9 },
  });
  assert.equal(moved.find((el) => el.id === "a").x1, 9);
  const deleted = applyCanvasCollabPatch(moved, { op: "delete", ids: ["b"] });
  assert.deepEqual(deleted.map((el) => el.id), ["a"]);
});

test("Invite sits after Split; Send to AI stays far right", () => {
  assert.match(canvasMode, /id="canvas-invite-btn"/);
  assert.match(canvasMode, /Invite/);
  const split = canvasMode.indexOf('id="canvas-split-btn"');
  const invite = canvasMode.indexOf('id="canvas-invite-btn"');
  const send = canvasMode.lastIndexOf('id="canvas-attach-prompt-btn"');
  assert.ok(split > 0 && invite > split, "Invite follows Split view");
  assert.ok(send > invite, "Send to AI stays after Invite");
  assert.match(canvasMode, /View and remix/);
  assert.match(canvasMode, /View, edit, remix/);
  assert.match(canvasMode, /data-canvas-invite-kind="user"/);
  assert.match(canvasMode, /data-canvas-invite-kind="team"/);
  assert.match(canvasMode, /data-canvas-invite-kind="workspace"/);
  assert.match(canvasMode, /id="canvas-edit-timeline"/);
  assert.match(canvasMode, /id="canvas-author-hover"/);
  assert.match(canvasMode, /authorUserId/);
  assert.match(canvasMode, /stampCanvasAuthor/);
  assert.match(canvasMode, /addElement/);
  assert.match(canvasMode, /authorName/);
  assert.match(app, /handleCanvasInvite/);
  assert.match(app, /onCanvas:/);
  assert.match(app, /canvas-board\/remix/);
  assert.match(collab, /onCanvas/);
  assert.match(collab, /canvas\./);
});
