import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("mounting the Robotics ribbon keeps Robotics Home active", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const ribbon = readFileSync(new URL("./ribbon.js", import.meta.url), "utf8");

  const homeStart = app.indexOf("async function showRoboticsTabUi()");
  const homeEnd = app.indexOf("\nfunction handleWorkspaceRibbonAction", homeStart);
  const homeBody = app.slice(homeStart, homeEnd);
  assert.match(homeBody, /setActive\?\.\(ROBOTICS_HOME_TAB_ID\)/);

  assert.match(ribbon, /_activateTab\(Object\.keys\(catalog\)\[0\], \{ notify: _designTab !== "ROBOTICS" \}\)/);
  assert.match(ribbon, /tabBtn\.addEventListener\("click", \(\) => _activateTab\(cat\)\)/);
  assert.match(ribbon, /if \(!notify\) return;/);
  assert.match(ribbon, /cat === "Viser"[\s\S]*?_onRoboticsAction\?\.\("viser-tab"/);
});
