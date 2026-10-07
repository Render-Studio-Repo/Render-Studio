import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  JOINT_WIN1_CACHE,
  JOINTS_WINDOW_BOUNDS_KEY,
  GRID_WINDOW_BOUNDS_KEY,
  DEFAULT_JOINTS_BOUNDS,
  clampFloatBounds,
  persistFloatBounds,
  readFloatBounds,
  hasSavedFloatBounds,
} from "./floating-window.js";

const here = dirname(fileURLToPath(import.meta.url));

test("jointwin1 cache token is wired through studio chrome", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "app.js"), "utf8");
  const css = readFileSync(join(here, "styles.css"), "utf8");
  const motion = readFileSync(join(here, "../viewport/assembly-motion.js"), "utf8");
  assert.equal(JOINT_WIN1_CACHE, "jointwin1");
  assert.match(html, /jointwin1/);
  assert.match(html, /styles\.css\?v=[^"']*jointwin1/);
  assert.match(html, /app\.js\?v=[^"']*jointwin1/);
  assert.match(html, /id="viewport-grid-menu"[^>]*studio-float-window/);
  assert.match(app, /floating-window\.js\?v=jointwin1/);
  assert.match(app, /assembly-motion\.js\?v=20260915-nativejoints1-jointwin1/);
  assert.match(app, /ensureGridSceneWindow/);
  assert.match(app, /closest\?\.\("#viewport-grid-menu"\)/);
  assert.match(css, /studio-float-handle--se/);
  assert.match(css, /assembly-motion-panel\.studio-float-window/);
  assert.match(motion, /JOINT_WIN1_CACHE/);
  assert.match(motion, /data-float-close|closeTitle:'Close and reset preview'/);
  assert.match(motion, /attachStudioFloatWindow/);
  assert.match(motion, /Reset pose/);
  assert.match(motion, /Edit joint definitions/);
  assert.equal(motion.includes("panel.replaceChildren()"), false);
  assert.match(motion, /root.replaceChildren\(\)/);
});

test("float bounds clamp to the viewport and persist in localStorage", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
  assert.equal(hasSavedFloatBounds(JOINTS_WINDOW_BOUNDS_KEY), false);
  assert.deepEqual(readFloatBounds(JOINTS_WINDOW_BOUNDS_KEY, DEFAULT_JOINTS_BOUNDS), DEFAULT_JOINTS_BOUNDS);
  persistFloatBounds(JOINTS_WINDOW_BOUNDS_KEY, { x: 40, y: 80, w: 420, h: 300 }, { minW: 280, minH: 220 });
  assert.equal(hasSavedFloatBounds(JOINTS_WINDOW_BOUNDS_KEY), true);
  assert.deepEqual(readFloatBounds(JOINTS_WINDOW_BOUNDS_KEY), { x: 40, y: 80, w: 420, h: 300 });
  persistFloatBounds(GRID_WINDOW_BOUNDS_KEY, { x: 12, y: 20, w: 260, h: 240 }, { minW: 248, minH: 200 });
  assert.equal(readFloatBounds(GRID_WINDOW_BOUNDS_KEY).w >= 248, true);
  const clamped = clampFloatBounds(
    { x: -40, y: 9999, w: 80, h: 40 },
    { width: 800, height: 600 },
    { minW: 240, minH: 160 },
  );
  assert.equal(clamped.x, 8);
  assert.equal(clamped.w, 240);
  assert.equal(clamped.h, 160);
  assert.ok(clamped.y <= 600 - 160 - 8);
});
