import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "marketplace-app.js"), "utf8");
const page = readFileSync(join(here, "../pages/marketplace-roadmap.html"), "utf8");
const form = readFileSync(join(here, "marketplace-roadmap.js"), "utf8");

test("marketplace clearly identifies its development status and links the roadmap", () => {
  assert.match(app, /Marketplace is still in the works/);
  assert.match(app, /marketplace-roadmap\.html/);
});

test("roadmap covers creator commerce, verified robotics, and paid simulation compute", () => {
  assert.match(page, /Creators and reusable work/);
  assert.match(page, /Verified robotics assets/);
  assert.match(page, /Paid cloud simulation compute/);
  assert.match(page, /Connected open-source instances/);
});

test("roadmap inquiry uses the fail-visible suggestion pipeline", () => {
  assert.match(form, /\/api\/site\/suggestions/);
  assert.match(form, /\[Marketplace roadmap\]/);
  assert.match(page, /info@render3d\.app to sam@render3d\.app/);
});
