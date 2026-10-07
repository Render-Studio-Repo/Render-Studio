const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const frontend = path.resolve(__dirname, "../../frontend");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    let requests = 0;
    let reject = false;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://astra.local/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<link rel="stylesheet" href="/sandbox/sandbox.css"><style>body{background:#111820;color:white;font:14px system-ui;padding:20px}#agents{margin-top:24px}button,input{font:inherit}</style><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js"}}</script><div id="bar"></div><h2>Agents</h2><div id="agents"></div>' });
      if (url.pathname === "/studio/auth.js") return route.fulfill({ contentType: "text/javascript", body: 'export function authHeaders(extra={}) {return extra;} export function getToken(){return "";}' });
      if (url.pathname === "/api/xr-agent/discuss") {
        requests++;
        const request = route.request().postDataJSON();
        assert.equal(request.project_id, "fixture-project");
        assert.equal(request.mode, "v2");
        assert.equal(request.model, "gpt-6-astra");
        await new Promise(resolve => setTimeout(resolve, 250));
        return route.fulfill({ status: reject ? 403 : 200, json: reject ? { detail: "Forbidden" } : { answer: "Your sandbox question was received.", model: "gpt-6-astra" } });
      }
      if (url.pathname === "/api/integrations/grok-bot/chat") return route.fulfill({ status: 503, json: { detail: "Fallback unavailable" } });
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp/")) return route.fulfill({ json: {} });
      const file = path.join(frontend, decodeURIComponent(url.pathname));
      if (!existsSync(file)) return route.fulfill({ status: 404, body: "Missing fixture asset" });
      return route.fulfill({ body: readFileSync(file), contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "image/png" });
    });
    await page.goto("http://astra.local/fixture");
    await page.evaluate(async () => {
      localStorage.setItem("render3d:lastProjectId", "fixture-project");
      const { mountSandboxAgentBar } = await import("/sandbox/sandbox-agent-bar.js");
      const { mountAgentTaskBoard } = await import("/sandbox/agent-tasks.js");
      mountSandboxAgentBar(document.querySelector("#bar"));
      window.tasks = mountAgentTaskBoard(document.querySelector("#agents"));
      Object.assign(document.querySelector("#agents").style, { height: "600px", overflow: "auto" });
    });
    assert.equal(await page.locator("#bar #sb-ask-astra").isVisible(), false);
    await page.locator("#bar [data-sb-astra]").click();
    assert.equal(await page.locator("#bar #sb-ask-astra").isVisible(), true);
    assert.equal(await page.locator("#bar [data-sb-ask-input]").evaluate(el => el === document.activeElement), true);
    assert.equal(requests, 0, "Opening chat must not send a preset prompt");
    assert.match(await page.locator("#bar [data-sb-astra-model]").textContent(), /gpt-6-astra/);
    await page.locator("#bar [data-sb-ask-input]").fill("Why is the sandbox offline?");
    await page.locator("#bar [data-sb-ask-send]").click();
    assert.equal(await page.locator("#bar [data-sb-ask-send]").isDisabled(), true);
    await page.locator("#bar [data-sb-ask-reply]").filter({ hasText: "Astra: Your sandbox" }).waitFor();
    assert.equal(requests, 1);
    await page.locator("#agents [data-astra-open]").click();
    assert.equal(await page.locator("#bar [data-sb-ask-input]").evaluate(el => el === document.activeElement), true);
    await page.locator("#bar [data-sb-ask-input]").fill("Keep my draft");
    await page.evaluate(() => tasks.assignTask("astra", "Test task"));
    assert.equal(await page.locator("#bar [data-sb-ask-input]").inputValue(), "Keep my draft");
    await page.evaluate(async () => {
      const { mountOffice } = await import("/sandbox/office.js?astraoffice=20260917-1");
      const { mountCollaborateId } = await import("/sandbox/collaborate-id.js");
      const { checkConfigOverlap, overlapHtml } = await import("/sandbox/config-overlap.js");
      for (const id of ["office", "collab", "overlap"]) {
        const el = document.createElement("div"); el.id = id; document.body.append(el);
      }
      window.office = mountOffice(document.querySelector("#office"));
      window.collab = mountCollaborateId(document.querySelector("#collab"));
      window.overlapCheck = () => checkConfigOverlap({ talkMode: "one" });
      document.querySelector("#overlap").innerHTML = overlapHtml(overlapCheck());
    });
    const overlap = await page.evaluate(() => overlapCheck());
    assert.equal(overlap.askButtons, 4);
    assert.equal(overlap.askWidgets, 1);
    assert.equal(overlap.ok, true);
    for (const selector of ["[data-office-open]", "[data-collab-astra]", "[data-astra-open]"]) {
      await page.locator(selector).click();
      assert.equal(await page.locator("#bar [data-sb-ask-input]").evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator("[data-sb-ask-astra]").count(), 1);
    }
    assert.equal(requests, 1, "Shortcuts must not send a request");
    const duplicate = await page.evaluate(() => {
      const clone = document.querySelector("[data-sb-ask-astra]").cloneNode(true);
      clone.hidden = true; document.body.append(clone);
      const result = overlapCheck(); clone.remove(); return result;
    });
    assert.equal(duplicate.ok, false);
    assert.match(duplicate.label, /2 Ask Astra widgets/);
    reject = true;
    await page.locator("#bar [data-sb-ask-send]").click();
    await page.locator("#bar [data-sb-ask-reply]").filter({ hasText: "project access denied" }).waitFor();
    assert.equal(await page.locator("#bar [data-sb-ask-send]").isDisabled(), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: "/tmp/ask-astra-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/ask-astra-mobile.png", fullPage: true });
    console.log("PASS: four shortcuts share one chat, duplicate mount detected, open/focus without request, model identity, answer/errors, draft retention, desktop/mobile screenshots");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
