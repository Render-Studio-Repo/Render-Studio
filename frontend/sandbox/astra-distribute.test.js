import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractWorkItems, pickAgent, ASTRADIST1_TOKEN } from "./astra-distribute.js";

const here = dirname(fileURLToPath(import.meta.url));

test("Astra extracts work items from bullet answers", () => {
  assert.equal(ASTRADIST1_TOKEN, "astradist1");
  const items = extractWorkItems(
    "Here is the plan:\n- Fix VR trigger map in Debugger VR\n- Cursor should patch File IDE auto-push\n- Analytics: poll sandbox rev\n\nThanks.",
    "please distribute work",
  );
  assert.ok(items.length >= 3);
  assert.ok(items.some((t) => /trigger/i.test(t)));
  assert.equal(pickAgent("cad-bot: pin fit on purse lid", 0), "cad-bot");
  const skip = extractWorkItems("- none vs yesterday\n- Cursor should patch File IDE auto-push\n");
  assert.ok(!skip.some((t) => /none vs yesterday/i.test(t)));
  assert.ok(skip.some((t) => /File IDE/i.test(t)));
});

test("auto-push and wiring tokens wired into NW pane", () => {
  const push = readFileSync(join(here, "sandbox-push.js"), "utf8");
  const wiring = readFileSync(join(here, "sandbox-wiring.js"), "utf8");
  assert.match(push, /AUTOPUSH1_TOKEN\s*=\s*"autopush1"/);
  assert.match(wiring, /SBWIRE1_TOKEN\s*=\s*"sbwire1"/);
  assert.match(wiring, /createCodeWiringPreview|3D wiring/);
  const pane = readFileSync(join(here, "openarm-viser-pane.js"), "utf8");
  assert.match(pane, /Wiring \/ Schematics/);
  assert.match(pane, /mountSandboxWiring/);
  assert.match(pane, /data-nw-mode="wiring"/);
  const collab = readFileSync(join(here, "collaborate-id.js"), "utf8");
  assert.match(collab, /Live history log/);
  assert.match(collab, /mergeLiveHistory|data-collab-history/);
  const ask = readFileSync(join(here, "ask-astra.js"), "utf8");
  assert.match(ask, /distributeAstraWork/);
  assert.match(ask, /data-sb-ask-distribute/);
  const ide = readFileSync(join(here, "ide.js"), "utf8");
  assert.match(ide, /autoPushSandboxCode/);
});
