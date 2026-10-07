import test from "node:test";
import assert from "node:assert/strict";
import { TECHWALL1_TOKEN, techWallMarkup } from "./sandbox-tech-wall.js";
import { LAUNCH_POINTS } from "./sandbox-live-instances.js";

test("tech wall markup lists extraction surface without a second iframe", () => {
  assert.equal(TECHWALL1_TOKEN, "techwall1");
  const html = techWallMarkup();
  assert.match(html, /data-sb-tech-wall/);
  assert.match(html, /data-wall-refresh/);
  assert.match(html, /no second WebGL|Same instances/i);
  assert.equal(LAUNCH_POINTS.instances.dimos.port, 8443);
  assert.equal(LAUNCH_POINTS.logs.teaching.includes("teaching"), true);
});
