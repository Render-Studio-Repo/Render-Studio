import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "instance-update-notice.js"), "utf8");
test("Studio offers admins a dismissible update review notice", () => {
  assert.match(source, /\/api\/setup\/instance-updates\/check/);
  assert.match(source, /data-update-later/);
  assert.match(source, /setup-instance\.html#setup-updates-card/);
});
