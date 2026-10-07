import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignRoundTableSeats,
  authorFromUserData,
  BOARD_ACTIONS,
  defaultBoardPoseFromHead,
  formatAuthorChip,
  locomotionForMode,
  projectPointOnPlane,
  shouldShowAuthorChip,
  tagXrAuthor,
  workspaceBoardLines,
  XR_BOARD_RELAY_TYPES,
} from "./xr-board.js";

const here = dirname(fileURLToPath(import.meta.url));

test("workspace board actions exist on the workspace panel", () => {
  const src = readFileSync(join(here, "viewport-xr.js"), "utf8");
  for (const id of Object.values(BOARD_ACTIONS)) {
    assert.ok(src.includes(`"${id}"`) || src.includes(`'${id}'`), `missing action ${id}`);
  }
  assert.ok(src.includes("ws-save"));
  const rail = readFileSync(join(here, "xr-hand-palette.js"), "utf8");
  let last = -1;
  for (const id of ["passthrough", "voice_toggle", "capture", "share"]) {
    const at = Math.max(rail.indexOf(`${id}:`), rail.indexOf(`"${id}"`), rail.indexOf(`${id}:`));
    assert.ok(at >= 0, `missing wrist status ${id}`);
    last = at;
  }
  void last;
  assert.ok(rail.includes('id: "screenshot"'));
  assert.ok(rail.includes('id: "record"'));
});

test("round table seats are unique and face inward", () => {
  const seats = assignRoundTableSeats(["ada", "sam", "lee"], { p: [0, 0.74, 0] });
  assert.equal(seats.length, 3);
  const keys = new Set(seats.map((s) => `${s.p[0].toFixed(3)}:${s.p[2].toFixed(3)}`));
  assert.equal(keys.size, 3);
  for (const s of seats) {
    assert.equal(s.p[1], 0.74);
    const dx = 0 - s.p[0];
    const dz = 0 - s.p[2];
    const face = Math.atan2(dx, dz);
    assert.ok(Math.abs(face - s.yaw) < 1e-6);
  }
});

test("god mode lifts; walk drops; teleport ray hits the board plane", () => {
  const board = defaultBoardPoseFromHead({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 });
  const god = locomotionForMode({ mode: "god", board });
  assert.ok(god.p[1] > 1);
  const walk = locomotionForMode({ mode: "walk", board });
  assert.equal(walk.p[1], 0);
  const hit = projectPointOnPlane(
    { x: 0, y: 1.6, z: 0 },
    { x: 0, y: -1, z: -0.4 },
    board.p,
  );
  assert.ok(hit);
  assert.ok(Math.abs(hit.p[1] - board.p[1]) < 1e-6);
});

test("hover chip is tiny and skips the local author", () => {
  const at = (() => {
    const d = new Date();
    d.setHours(14, 14, 0, 0);
    return d.getTime();
  })();
  assert.equal(formatAuthorChip({ name: "Ada", at }), "Ada · 2:14p");
  assert.equal(shouldShowAuthorChip({ authorId: "ada", localId: "ada" }), false);
  assert.equal(shouldShowAuthorChip({ authorId: "ada", localId: "sam" }), true);
  const mesh = { userData: {} };
  tagXrAuthor(mesh, { id: "ada", name: "Ada", at });
  const a = authorFromUserData(mesh);
  assert.equal(a.id, "ada");
  assert.equal(a.name, "Ada");
  assert.equal(a.at, at);
});

test("board relay types are listed for public rooms", () => {
  assert.deepEqual(XR_BOARD_RELAY_TYPES, ["xr.board", "xr.table", "xr.seat"]);
  const policy = readFileSync(join(here, "xr-collab-policy.js"), "utf8");
  const hot = readFileSync(join(here, "xr-hot-path.js"), "utf8");
  for (const t of XR_BOARD_RELAY_TYPES) {
    assert.ok(policy.includes(`"${t}"`), `policy missing ${t}`);
    assert.ok(hot.includes(`"${t}"`), `hot-path missing ${t}`);
  }
});
