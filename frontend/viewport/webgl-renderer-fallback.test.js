import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindFallbackAnimationLoop,
  createSilentBootRenderer,
  ensureRendererAnimationLoop,
  makeFallbackXrStub,
  startRendererAnimationLoop,
} from "./webgl-renderer-fallback.js";

test("Studio startup retains native Three/WebXR context ownership", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const index = readFileSync(join(here, "../index.html"), "utf8");
  const xr = readFileSync(join(here, "../xr/viewport-xr.js"), "utf8");
  const boot = readFileSync(join(here, "../boot/boot-headset-scene.js"), "utf8");
  const startup = readFileSync(join(here, "studio-graphics-startup.js"), "utf8");
  assert.match(app, /await startStudioGraphics/);
  assert.match(startup, /new THREE\.WebGLRenderer/);
  assert.match(startup, /createSilentBootRenderer/);
  const bootCatch = startup.slice(startup.indexOf("} catch (error) {"), startup.indexOf("} finally {"));
  assert.equal(bootCatch.includes("forceContextLoss"), false);
  assert.doesNotMatch(app, /prepareWebGlViewportHost/);
  assert.doesNotMatch(app, /createStudioWebGlRenderer/);
  assert.doesNotMatch(app, /createFallbackRenderer/);
  assert.doesNotMatch(app, /3D viewport unavailable/);
  assert.doesNotMatch(app, /Your browser could not create a WebGL context/);
  assert.doesNotMatch(app, /mountWebGlStartupPanel/);
  assert.doesNotMatch(app, /new THREE\.WebGLRenderer\(\{[\s\S]{0,500}context:/);
  assert.doesNotMatch(app, /getContext\(["']webgl/);
  assert.match(xr, /renderer\.xr\.enabled = true/);
  assert.match(xr, /await renderer\.xr\.setSession\(session\)/);
  assert.doesNotMatch(xr, /prepareWebGlViewportHost/);
  assert.doesNotMatch(xr, /createStudioWebGlRenderer/);
  const specAt = xr.indexOf("function disposeRecordSpectator()");
  const spec = xr.slice(specAt, specAt + 600);
  assert.equal(spec.includes("forceContextLoss"), false);
  const enterAt = xr.indexOf("async function enter()");
  const enterEnd = xr.indexOf("function startXrFromUserGesture", enterAt);
  const enter = xr.slice(enterAt, enterEnd > enterAt ? enterEnd : enterAt + 12000);
  assert.equal(/new THREE\.WebGLRenderer/.test(enter), false);
  assert.equal(boot.includes("forceContextLoss"), false);
  assert.match(index, /webglrevert2/);
  assert.match(index, /threerestore1/);
  assert.match(index, /webglboot1/);
  assert.match(index, /miniview1/);
  assert.match(index, /models1/);
  assert.match(app, /recoverDesktopMeshesAfterWebgl/);
  assert.match(app, /revealDesktopProjectMeshes/);
  assert.match(xr, /Desktop: never inherit XR hide/);
  assert.doesNotMatch(index, /3D viewport unavailable/);
  assert.doesNotMatch(index, /prepareWebGlViewportHost/);
});

test("silent boot renderer has no overlay copy and does not throw", () => {
  const src = readFileSync(new URL("./webgl-renderer-fallback.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /3D viewport unavailable/);
  assert.doesNotMatch(src, /Your browser could not create a WebGL context/);
  const renderer = createSilentBootRenderer();
  assert.ok(renderer.domElement);
  assert.equal(renderer.xr.isFallbackStub, true);
  renderer.setPixelRatio(2);
  renderer.setSize(8, 8);
  renderer.render();
});

test("fallback XR stub exposes getController so viewport-xr setup does not throw", () => {
  const xr = makeFallbackXrStub();
  const c = xr.getController(0);
  assert.equal(typeof c.addEventListener, "function");
  c.addEventListener("selectstart", () => {});
  c.add({ name: "ray" });
  assert.equal(xr.isPresenting, false);
  assert.equal(xr.isFallbackStub, true);
});

test("startRendererAnimationLoop does not wrap an existing setAnimationLoop", () => {
  const original = (fn) => { original.last = fn; };
  const renderer = { setAnimationLoop: original };
  const animate = () => {};
  assert.equal(startRendererAnimationLoop(renderer, animate), "loop");
  assert.equal(renderer.setAnimationLoop, original);
  assert.equal(original.last, animate);
});

test("bindFallbackAnimationLoop implements setAnimationLoop via schedule", () => {
  const renderer = {};
  const calls = [];
  const schedule = (fn) => {
    calls.push(fn);
    return calls.length;
  };
  bindFallbackAnimationLoop(renderer, schedule);
  let n = 0;
  renderer.setAnimationLoop(() => { n += 1; });
  assert.equal(calls.length, 1);
  calls[0](0);
  assert.equal(n, 1);
  assert.equal(calls.length, 2);
});

test("ensureRendererAnimationLoop binds setAnimationLoop when missing", () => {
  const renderer = {};
  const calls = [];
  const schedule = (fn) => {
    calls.push(fn);
    return calls.length;
  };
  const bound = ensureRendererAnimationLoop(renderer, schedule);
  assert.equal(typeof bound.setAnimationLoop, "function");
  startRendererAnimationLoop(bound, () => {});
  assert.equal(calls.length, 1);
});

test("startRendererAnimationLoop uses setAnimationLoop when present", () => {
  const seen = [];
  const renderer = { setAnimationLoop: (fn) => seen.push(fn) };
  const animate = () => {};
  assert.equal(startRendererAnimationLoop(renderer, animate), "loop");
  assert.equal(seen[0], animate);
});
