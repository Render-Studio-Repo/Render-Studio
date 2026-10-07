import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LIVEFEED1_TOKEN, recommendNextSteps } from "./live-feed.js";

const here = dirname(fileURLToPath(import.meta.url));

test("live feed recommends Gauge-style next steps", () => {
  assert.equal(LIVEFEED1_TOKEN, "livefeed1");
  const steps = recommendNextSteps({
    health: { ok: true, status: "ok" },
    stats: { bars: [{ label: "REPORT n", n: 1 }] },
    client: {
      webgl: { ok: true, detail: "alive" },
      xr: { detail: "no pad" },
      vr_trigger: "no_pad",
      vr_controls: {
        bindings: {
          engage: { input: "Y", edge: "tap", action: "engage" },
          gripper: { input: null, action: "removed" },
        },
        live: { y: "no_pad", trigger: "no_pad", grip: "no_pad" },
      },
    },
    collab: { super_ide: true, files: 11, path: "SE Code" },
    dimos: { up: false, detail: "down" },
  });
  assert.ok(steps.some((s) => s.id === "health" && s.pass));
  assert.ok(steps.some((s) => s.id === "vr_trigger" && !s.pass));
  assert.ok(steps.some((s) => s.id === "dimos" && !s.pass));
  assert.ok(steps.some((s) => s.id === "collab" && s.pass));
});

test("live feed never hardcodes vr_trigger unknown", () => {
  const feed = readFileSync(join(here, "live-feed.js"), "utf8");
  assert.doesNotMatch(feed, /vr_trigger:\s*"unknown"/);
  assert.match(feed, /dimosControlBindingsSnapshot/);
});

test("page wires live feed + overlap check + dimos ensure", () => {
  const html = readFileSync(join(here, "index.html"), "utf8");
  const boot = readFileSync(join(here, "boot.js"), "utf8");
  const feed = readFileSync(join(here, "live-feed.js"), "utf8");
  const dimos = readFileSync(join(here, "dimos-link.js"), "utf8");
  const css = readFileSync(join(here, "sandbox.css"), "utf8");
  assert.match(html, /id="sb-live-feed"/);
  assert.match(html, /livefeed1/);
  assert.match(boot, /mountLiveFeed/);
  assert.match(boot, /forceOneSpeaker/);
  assert.match(feed, /checkConfigOverlap|overlapHtml/);
  assert.doesNotMatch(feed, /data-talk-mode/);
  assert.doesNotMatch(feed, /data-sb-shared-male/);
  assert.match(feed, /Generate tasks|data-sb-bot-generate/);
  assert.match(dimos, /data-sb-dimos-ensure/);
  assert.match(dimos, /\/api\/dimos\/ensure-coordinator/);
  assert.match(dimos, /pollCoordinatorUntilUp|polling/);
  assert.match(css, /\.sb-live-feed/);
});
