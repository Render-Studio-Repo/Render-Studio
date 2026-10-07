import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const js = readFileSync(join(here, "context-lab.js"), "utf8");
const css = readFileSync(join(here, "context-lab.css"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");

test("context-lab refresh aborts the previous context-lab GET", () => {
  assert.match(js, /let contextLabAbort = null; \/\/ leakfix68/);
  assert.match(js, /async function refresh\(\)[\s\S]{0,400}signal: ctl\.signal/);
});

test("context-lab Drive folder list aborts the previous folders GET", () => {
  assert.match(js, /let driveFoldersAbort = null; \/\/ leakfix92/);
  assert.match(js, /\/api\/users\/me\/drive\/folders", \{ headers: authHeaders\(\), signal: ctl\.signal \}/);
});

test("Context Lab chrome is Machines | Customers with nested Improve", () => {
  assert.match(js, /const PANES = \[/);
  assert.match(js, /\["machines", "Machines"\]/);
  assert.match(js, /\["customers", "Customers"\]/);
  assert.match(js, /data-ctx-improve-toggle/);
  assert.doesNotMatch(js, /\["machine", "Machine"\]/);
  assert.doesNotMatch(js, /\["settings", "Improve settings"\]/);
  assert.match(html, /Connect a machine and save customers/);
  assert.match(html, /context-lab.css\?v=20260909-ctxlab1/);
  assert.match(app, /context-lab\.js\?v=20260909-ctxlab1-splitbed1/);
  assert.match(html, /app\.js\?v=\d{8}-/);
  assert.match(html, /20260909-ctxlab1/);
  assert.match(js, /data-ctx-toggle/);
});

test("machine and customer saves hit APIs and update the list", () => {
  assert.match(js, /\/api\/context-lab\/machines/);
  assert.match(js, /\/api\/context-lab\/customers/);
  assert.match(js, /Save machine/);
  assert.match(js, /Save customer/);
  assert.match(js, /upsertSnapRow\("profiles"/);
  assert.match(js, /upsertSnapRow\("customers"/);
  assert.match(js, /No machine saved yet/);
  assert.match(js, /No customer saved yet/);
  assert.match(js, /id: editingMachineId \|\| null/);
  assert.match(js, /id: editingCustomerId \|\| null/);
});

test("Context Lab printers use thumbs, search, expand popup, and live Improve", () => {
  assert.match(js, /ctx-machine-search/);
  assert.match(js, /ctx-machine-thumbs/);
  assert.match(js, /machine-thumbs/);
  assert.match(js, /data-expand-machines/);
  assert.match(js, /data-ctx-tolerance/);
  assert.match(js, /Printer fit clearance|printer-accurate fit clearance/);
  assert.doesNotMatch(js, /Update Improve/);
  assert.doesNotMatch(js, /data-apply-improve/);
  assert.match(js, /ctx-lab-edit-footer/);
  assert.match(js, /ctx-active-machine/);
  assert.match(js, /persistMachine\(\{ activate: false, quiet: true \}\)/);
  assert.match(css, /\.ctx-lab-edit-footer/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /max-height:\s*min\(86vh,\s*100%\)/);
  assert.match(css, /\.ctx-machine-thumbs/);
  assert.match(css, /\.ctx-saved-machines/);
  assert.match(css, /\.ctx-switch-row/);
  assert.match(css, /\.ctx-switch-ui/);
});

test("Context Lab modal is a glass overlay", () => {
  assert.match(css, /\.ctx-lab-modal \.auth-backdrop/);
  assert.match(css, /background:\s*rgba\(6, 10, 16, 0\.18\)/);
  assert.match(css, /backdrop-filter:\s*blur\(22px\)/);
  assert.match(css, /background:\s*rgba\(16, 22, 32, 0\.52\)/);
});
