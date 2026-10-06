import test from "node:test";
import assert from "node:assert/strict";
import { zedTopCamJpegUrl } from "./zed-top-cam.js";

test("zedTopCamJpegUrl points at local robotics endpoint", () => {
  const url = zedTopCamJpegUrl(123);
  assert.equal(url, "/api/robotics/zed.jpg?t=123");
});
