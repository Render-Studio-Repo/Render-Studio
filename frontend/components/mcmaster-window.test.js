import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MCMASTER_WINDOW_NAME,
  catalogWindowState,
  isCatalogWindowOpen,
  openCatalogWindow,
} from "./mcmaster-window.js";

const insertSource = readFileSync(new URL("./mcmaster-insert.js", import.meta.url), "utf8");

test("Studio uses the external-window contract instead of a McMaster iframe", () => {
  assert.doesNotMatch(insertSource, /data-mcmaster-frame|<iframe[^>]+mcmaster/i);
  assert.match(insertSource, /openCatalogWindow\(/);
  assert.match(insertSource, /data-mcmaster-window-state="idle"/);
});

test("opens McMaster in one reusable external window", () => {
  const popup = { closed: false, focused: 0, focus() { this.focused += 1; } };
  const calls = [];
  const windowRef = {
    open(...args) {
      calls.push(args);
      return popup;
    },
  };

  const result = openCatalogWindow(windowRef, "https://www.mcmaster.com/91251A194", "popup=yes");

  assert.equal(result.kind, "open");
  assert.equal(result.window, popup);
  assert.deepEqual(calls, [["https://www.mcmaster.com/91251A194", MCMASTER_WINDOW_NAME, "popup=yes"]]);
  assert.equal(popup.focused, 1);
  assert.equal(catalogWindowState(popup), "open");
});

test("blocked popup stays disconnected and exposes blocked state", () => {
  const result = openCatalogWindow({ open: () => null }, "https://www.mcmaster.com/", "popup=yes");

  assert.equal(result.kind, "blocked");
  assert.equal(result.window, null);
  assert.equal(catalogWindowState(null, true), "blocked");
  assert.equal(isCatalogWindowOpen(null), false);
});

test("closed popup returns to idle", () => {
  assert.equal(isCatalogWindowOpen({ closed: true }), false);
  assert.equal(catalogWindowState({ closed: true }), "idle");
});
