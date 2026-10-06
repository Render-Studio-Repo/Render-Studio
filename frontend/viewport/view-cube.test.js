import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VIEW_CUBE_FACES,
  nearestViewCubeFace,
  viewCubeSpinCss,
  viewCubeYawPitch,
  zUpOffsetFromSpherical,
  zUpSphericalFromOffset,
} from "./view-cube-orientation.js";

const here = dirname(fileURLToPath(import.meta.url));
const cube = readFileSync(join(here, "view-cube.js"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");

function almost(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `${actual} ≉ ${expected}`);
}

test("Fusion Z-up: Front is −Y so +X is screen-right", () => {
  assert.deepEqual(VIEW_CUBE_FACES.front.direction, [0, -1, 0]);
  assert.deepEqual(VIEW_CUBE_FACES.back.direction, [0, 1, 0]);
  assert.deepEqual(VIEW_CUBE_FACES.right.direction, [1, 0, 0]);
  assert.deepEqual(VIEW_CUBE_FACES.left.direction, [-1, 0, 0]);
  assert.deepEqual(VIEW_CUBE_FACES.top.direction, [0, 0, 1]);
  assert.deepEqual(VIEW_CUBE_FACES.bottom.direction, [0, 0, -1]);
});

test("yaw is 0 at Front and +90° at Right (Front → Right → Back → Left)", () => {
  const front = viewCubeYawPitch(0, -1, 0);
  const right = viewCubeYawPitch(1, 0, 0);
  const back = viewCubeYawPitch(0, 1, 0);
  const left = viewCubeYawPitch(-1, 0, 0);
  almost(front.yawCad, 0);
  almost(front.pitch, 0);
  almost(right.yawCad, Math.PI / 2);
  almost(right.pitch, 0);
  almost(Math.abs(back.yawCad), Math.PI);
  almost(left.yawCad, -Math.PI / 2);
  assert.ok(front.yawCad < right.yawCad);
});

test("cube spin uses rotateY for yaw, not rotateZ", () => {
  const front = viewCubeSpinCss(0, -1, 0);
  const right = viewCubeSpinCss(1, 0, 0);
  const left = viewCubeSpinCss(-1, 0, 0);
  const top = viewCubeSpinCss(0, 0, 1);
  const topPitch = viewCubeYawPitch(0, 0, 1);
  almost(topPitch.yawCad, 0);
  almost(topPitch.pitch, Math.PI / 2, 1e-6);
  assert.match(front, /rotateY\(0deg\)/);
  assert.match(right, /rotateY\(-90deg\)/);
  assert.match(left, /rotateY\(90deg\)/);
  assert.match(top, /rotateX\(-90deg\)/);
  assert.match(top, /rotateY\(0deg\)/);
  assert.equal(front.includes("rotateZ"), false);
  assert.equal(right.includes("rotateZ"), false);
  assert.match(cube, /viewCubeSpinCss\(/);
  assert.equal(cube.includes("rotateZ(${"), false);
});

test("nearest face follows Fusion yaw orbit", () => {
  assert.equal(nearestViewCubeFace(0, -1, 0), "front");
  assert.equal(nearestViewCubeFace(1, 0, 0), "right");
  assert.equal(nearestViewCubeFace(0, 1, 0), "back");
  assert.equal(nearestViewCubeFace(-1, 0, 0), "left");
  assert.equal(nearestViewCubeFace(0, 0, 1), "top");
  assert.equal(nearestViewCubeFace(0, 0, -1), "bottom");
});

test("Z-up spherical round-trips Front and Right", () => {
  const front = zUpSphericalFromOffset(0, -2, 0);
  almost(front.theta, 0);
  almost(front.phi, Math.PI / 2);
  const back = zUpOffsetFromSpherical(front.radius, front.theta, front.phi);
  almost(back.x, 0);
  almost(back.y, -2);
  almost(back.z, 0);
  const right = zUpSphericalFromOffset(3, 0, 0);
  almost(right.theta, Math.PI / 2);
  const r = zUpOffsetFromSpherical(right.radius, right.theta, right.phi);
  almost(r.x, 3);
  almost(r.y, 0);
});

test("view cube sits below GRID / SECTION chips", () => {
  const start = css.indexOf("/* ── Fusion-style view cube");
  assert.ok(start >= 0);
  const block = css.slice(start, start + 900);
  assert.match(block, /top: 68px;/);
  assert.match(css, /\.viewport-grid-bar \{[\s\S]*?top: 14px;/);
  assert.match(css, /rotateY \(not rotateZ\)/);
});

test("cache-bust 20260914-vcube1 is wired", () => {
  assert.match(app, /view-cube\.js\?v=20260914-vcube1/);
  assert.match(cube, /view-cube-orientation\.js\?v=20260914-vcube1/);
  assert.match(html, /app\.js\?v=20260908-.*20260914-vcube1/);
  assert.match(html, /styles\.css\?v=[^"']*20260914-vcube1/);
});
