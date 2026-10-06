import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const currentInvite = "https://discord.gg/Gh8p85YpFc";
const files = [
  "frontend/index.html",
  "frontend/pages/updates.html",
  "frontend/viewport/viewport-video-record.js",
  "frontend/boot/boot-chrome.js",
];

test("every Render Studio Discord link uses the current invite", () => {
  const links = files.flatMap((file) =>
    readFileSync(join(root, file), "utf8").match(/https:\/\/discord\.gg\/[A-Za-z0-9]+/g) || []
  );
  assert.equal(links.length, 8);
  assert.deepEqual([...new Set(links)], [currentInvite]);
});
