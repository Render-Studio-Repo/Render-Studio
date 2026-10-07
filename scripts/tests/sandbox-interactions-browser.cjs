const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const frontend = path.resolve(__dirname, "../../frontend");
const { PNG } = require(process.env.PLAYWRIGHT_MODULE ? path.join(process.env.PLAYWRIGHT_MODULE, "../pngjs") : "pngjs");
function checkPixels(bytes) {
  const { data } = PNG.sync.read(bytes);
  let colored = 0;
  for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 35) colored++;
  assert.ok(colored > 1000, "Room must have visible colored scene/control pixels");
  return data;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    let saves = [], messages = [], voiceSessions = 0, loadMode = "fail";
    await page.route("https://sandbox.local/**", async route => {
      const u = new URL(route.request().url());
      if (u.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<link rel="stylesheet" href="/sandbox/sandbox.css"><style>body{background:#111820;color:white;font:14px system-ui;padding:20px}#ide{margin-top:24px}</style><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js"}}</script><div id="chat"></div><div id="ide"></div><button id="enter">Enter room</button>' });
      if (u.pathname === "/studio/auth.js") return route.fulfill({ contentType: "text/javascript", body: 'export function authHeaders(extra={}){return extra;} export function getToken(){return "fixture";}' });
      if (u.pathname === "/api/voice-mold/models") return route.fulfill({ json: { models: [{ id: "gpt-realtime-mini", label: "Realtime Mini", transport: "realtime" }] } });
      if (u.pathname === "/api/voice-mold/session") { voiceSessions++; return route.fulfill({ json: { model: "gpt-realtime-mini", label: "Realtime Mini", transport: "realtime", proxy_ws_path: "/api/voice-mold/ws" } }); }
      if (u.pathname === "/mcp/sandbox/file") {
        if (loadMode === "delay") await new Promise(resolve => setTimeout(resolve, 350));
        return route.fulfill({ status: loadMode === "fail" ? 404 : 200, json: { ok: loadMode !== "fail", text: "remote source" } });
      }
      if (u.pathname === "/mcp/sandbox") {
        if (route.request().method() === "POST") { saves.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
        return route.fulfill({ json: { ok: true, files: ["examples/source.js"] } });
      }
      if (u.pathname === "/mcp/group-chat" && route.request().method() === "POST") { messages.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
      if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/mcp/")) return route.fulfill({ json: {} });
      const file = path.join(frontend, decodeURIComponent(u.pathname));
      if (!existsSync(file)) return route.fulfill({ status: 404, body: "Missing fixture asset" });
      return route.fulfill({ body: readFileSync(file), contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "image/png" });
    });
    await page.addInitScript(() => {
      window.micCalls = []; window.tracks = []; window.sent = [];
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        window.micCalls.push(constraints);
        if (window.denyMic) throw new DOMException("Permission denied", "NotAllowedError");
        const stream = await capture(constraints);
        window.tracks.push(...stream.getTracks());
        if (window.delayMic) await new Promise(resolve => { window.grantMic = resolve; });
        return stream;
      };
      window.WebSocket = class extends EventTarget {
        static OPEN = 1;
        constructor(url) { super(); window.voiceSocket = this; this.url = url; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }, 0); }
        send(raw) { const data = JSON.parse(raw); window.sent.push(data); if (data.type === "session.update") setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "session.updated" }) })), 0); }
        close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
      };
    });
    await page.goto("https://sandbox.local/fixture");
    await page.evaluate(async () => {
      const { mountAskAstra } = await import("/sandbox/ask-astra.js");
      const { mountIde } = await import("/sandbox/ide.js");
      window.chat = mountAskAstra(document.querySelector("#chat"));
      window.ide = mountIde(document.querySelector("#ide"));
      window.room = await import("/sandbox/sandbox-xr-enter.js?v=sbxr1-bots1");
      document.querySelector("#enter").onclick = () => { window.enterResult = null; room.enterSandboxVr({ preferDesktop: !window.mockXr, onEnd: () => window.endCount = (window.endCount || 0) + 1 }).then(r => window.enterResult = r); };
    });
    const voice = page.locator("[data-sb-ask-voice]");
    await voice.click();
    await page.waitForFunction(() => document.querySelector("[data-sb-ask-voice]").textContent === "Stop voice");
    await page.waitForFunction(() => sent.some(e => e.type === "input_audio_buffer.append"));
    assert.equal(voiceSessions, 1);
    assert.equal(await page.evaluate(() => micCalls.length), 1);
    assert.match(await page.locator("[data-sb-ask-reply]").innerText(), /listening on this device/);
    assert.match(await page.evaluate(() => voiceSocket.url), /^wss:\/\/sandbox.local\/api\/voice-mold\/ws/);
    await voice.click();
    assert.equal(await page.evaluate(() => tracks.every(t => t.readyState === "ended")), true);
    const mic = page.locator("[data-sb-ask-mic]");
    const id = await mic.locator("option").nth(1).getAttribute("value");
    await mic.selectOption(id);
    await voice.click();
    await page.waitForFunction(() => document.querySelector("[data-sb-ask-voice]").textContent === "Stop voice");
    assert.equal(await page.evaluate(() => micCalls.at(-1).audio.deviceId.exact), id);
    await voice.click();
    await page.evaluate(() => window.denyMic = true);
    await voice.click();
    await page.locator("[data-sb-ask-reply]").filter({ hasText: "Allow microphone access" }).waitFor();
    assert.equal(voiceSessions, 2, "Denied local microphone must not create a server session");
    await page.evaluate(() => { window.denyMic = false; window.delayMic = true; });
    await voice.click();
    await page.waitForFunction(() => !!window.grantMic);
    await voice.click();
    await page.evaluate(() => grantMic());
    await page.waitForFunction(() => tracks.every(t => t.readyState === "ended"));
    assert.equal(voiceSessions, 2, "Cancel must not create a late session");

    page.on("dialog", d => d.accept());
    const editor = page.locator("[data-sb-ide-editor]");
    await editor.fill("keep my draft");
    await page.locator("[data-sb-ide-load]").click();
    await page.locator("[data-sb-ide-status]").filter({ hasText: "draft preserved" }).waitFor();
    assert.equal(await editor.inputValue(), "keep my draft");
    loadMode = "delay";
    await page.locator("[data-sb-ide-load]").click();
    await editor.fill("newer typing");
    await page.locator("[data-sb-ide-status]").filter({ hasText: "Load ignored" }).waitFor();
    assert.equal(await editor.inputValue(), "newer typing");
    await page.locator("[data-sb-ide-gen-loop]").click();
    assert.equal(saves.length, 0);
    await page.locator("[data-sb-ide-save]").click();
    await page.locator("[data-sb-ide-status]").filter({ hasText: "Saved" }).waitFor();
    assert.equal(saves.length, 1);
    assert.equal(saves[0].text, await editor.inputValue());
    const simulated = await page.evaluate(async () => {
      const THREE = await import("three");
      const { createRoomControls } = await import("/sandbox/room-controls.js");
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
      const controllers = [new THREE.Group(), new THREE.Group()];
      const left = { handedness: "left", gamepad: { buttons: Array.from({ length: 6 }, () => ({ pressed: false })) } };
      const right = { handedness: "right", gamepad: { buttons: Array.from({ length: 6 }, () => ({ pressed: false })) } };
      const session = { inputSources: [right, left] };
      const renderer = { domElement: document.createElement("canvas"), xr: { getController: i => controllers[i], getSession: () => session } };
      const controls = createRoomControls({ THREE, renderer, scene, camera, onExit() {} });
      controllers[0].dispatchEvent({ type: "connected", data: right });
      controllers[1].dispatchEvent({ type: "connected", data: left });
      controls.update();
      const before = controls.observation();
      controllers[1].position.set((260 / 1024 - 0.5) * 1.4, 1.45 + (0.5 - 225 / 640) * .875, 0);
      scene.updateMatrixWorld(true);
      controllers[1].dispatchEvent({ type: "selectstart", data: left });
      const trigger = controls.observation();
      left.gamepad.buttons[5].pressed = true; controls.update();
      const back = controls.observation().view;
      right.gamepad.buttons[4].pressed = true; controls.update();
      const face = controls.observation().view;
      controllers[0].position.set((760 / 1024 - 0.5) * 1.4, 1.45 + (0.5 - 225 / 640) * .875, 0);
      controls.show("home"); scene.updateMatrixWorld(true);
      controllers[0].dispatchEvent({ type: "selectstart", data: right });
      const editorView = controls.observation().view;
      controls.reset();
      return { before, trigger, back, face, editorView, reset: controls.observation() };
    });
    assert.equal(simulated.before.trigger, "unknown");
    assert.deepEqual(simulated.before.hands, ["right", "left"]);
    assert.equal(simulated.trigger.view, "agents");
    assert.equal(simulated.trigger.trigger, "ok");
    assert.equal(simulated.back, "home");
    assert.equal(simulated.face, "agents");
    assert.equal(simulated.editorView, "editor");
    assert.equal(simulated.reset.trigger, "unknown");
    await page.screenshot({ path: "/tmp/sandbox-local-mic-editor.png", fullPage: true });
    await page.locator("#enter").click();
    await page.waitForFunction(() => window.enterResult !== null);
    assert.equal(await page.evaluate(() => enterResult.ok), true);
    await page.screenshot({ path: "/tmp/sandbox-room-desktop.png" });
    const pixels = checkPixels(await page.locator("#sb-xr-canvas").screenshot());
    await page.waitForTimeout(300);
    const later = checkPixels(await page.locator("#sb-xr-canvas").screenshot());
    assert.ok(pixels.some((byte, i) => byte !== later[i]), "Room animation must advance");
    await page.locator("[data-sb-xr-exit]").click();
    assert.equal(await page.locator("#sb-xr-desktop").isVisible(), false);
    await page.locator("#enter").click();
    await page.waitForFunction(() => window.enterResult?.ok);
    assert.equal(await page.locator("#sb-xr-desktop").isVisible(), true);
    await page.evaluate(() => room.exitSandboxVr());
    await page.evaluate(() => {
      window.mockXr = true; window.xrRequests = 0; window.activation = false;
      Object.defineProperty(navigator, "xr", { configurable: true, value: { requestSession() {
        window.xrRequests++; window.activation = navigator.userActivation.isActive;
        return Promise.reject(new DOMException("VR permission denied", "NotAllowedError"));
      } } });
    });
    await page.locator("#enter").click();
    await page.waitForFunction(() => window.enterResult !== null);
    assert.equal(await page.evaluate(() => enterResult.ok), false);
    assert.equal(await page.evaluate(() => activation), true, "Request immersive session inside the click gesture");
    assert.equal(await page.locator("#sb-xr-desktop").isVisible(), false);
    await page.evaluate(() => window.mockXr = false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/sandbox-local-mic-mobile.png", fullPage: true });
    await page.locator("#enter").click();
    await page.waitForFunction(() => window.enterResult?.ok);
    await page.screenshot({ path: "/tmp/sandbox-room-mobile.png" });
    checkPixels(await page.locator("#sb-xr-canvas").screenshot());
    await page.evaluate(() => room.exitSandboxVr());
    await page.setViewportSize({ width: 1280, height: 900 });
    const micCount = await page.evaluate(() => micCalls.length);
    await page.evaluate(async () => {
      localStorage.setItem("render3d:sandboxMcpConnect", "1");
      const officeHost = document.createElement("div"); officeHost.id = "office-test"; officeHost.style.height = "620px";
      const agentsHost = document.createElement("div"); agentsHost.id = "office-agents-test"; agentsHost.style.cssText = "height:360px;overflow:auto";
      document.body.prepend(officeHost, agentsHost);
      const { mountOffice } = await import("/sandbox/office.js");
      const { mountAgentTaskBoard } = await import("/sandbox/agent-tasks.js");
      window.office = mountOffice(officeHost); window.agentBoard = mountAgentTaskBoard(agentsHost);
    });
    await page.locator("#office-test").scrollIntoViewIfNeeded();
    assert.equal(await page.locator("[data-office-agent]").inputValue(), "astra");
    assert.match(await page.locator("[data-office-model]").innerText(), /gpt-6-astra.*selected/);
    await page.locator("[data-office-agent]").selectOption("cursor-engineer");
    assert.equal(await page.locator("[data-active-agent]").inputValue(), "cursor-engineer");
    assert.equal(await page.evaluate(() => localStorage.getItem("render3d:sandboxMcpConnect")), "1");
    await page.locator("[data-office-open]").click();
    await page.locator("[data-team-message] textarea").fill("Review the office controls");
    await page.locator("[data-team-message] button").click();
    await page.locator("[data-team-status]").filter({ hasText: "Sent to Cursor" }).waitFor();
    assert.equal(messages.at(-1).text, "@cursor-engineer Review the office controls");
    await page.locator("[data-active-agent]").selectOption("astra");
    assert.equal(await page.locator("[data-office-agent]").inputValue(), "astra");
    await page.evaluate(() => {
      localStorage.setItem("render3d.sandbox.astraModel", "gpt-6-astra-pro");
      window.dispatchEvent(new CustomEvent("render3d-astra-model"));
    });
    assert.match(await page.locator("[data-office-model]").innerText(), /gpt-6-astra-pro/);
    assert.match(await page.locator("#office-agents-test [data-sb-astra-model]").innerText(), /gpt-6-astra-pro/);
    assert.equal(await page.evaluate(() => micCalls.length), micCount, "Selecting an agent must never acquire a microphone");
    await page.locator("#office-test").scrollIntoViewIfNeeded();
    const officePixels = checkPixels(await page.locator("#office-test canvas").screenshot());
    const rect = await page.locator("#office-test canvas").boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 140, rect.y + rect.height / 2, { steps: 12 }); await page.mouse.up();
    const rotated = checkPixels(await page.locator("#office-test canvas").screenshot());
    assert.ok(officePixels.some((v, i) => v !== rotated[i]), "Office orbit must change the rendered scene");
    await page.locator("[data-office-reset]").click();
    await page.locator("#office-test").screenshot({ path: "/tmp/sandbox-office-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#office-test").screenshot({ path: "/tmp/sandbox-office-mobile.png" });
    checkPixels(await page.locator("#office-test canvas").screenshot());
    await page.evaluate(() => { office.destroy(); agentBoard.destroy(); });
    assert.deepEqual(errors, []);
    console.log("PASS: office/Agents selection, visible models, MCP preserved, targeted messages, desktop/mobile canvas pixels, local fake-device PCM, mic cleanup/cancel, editor races/save, synthetic controllers and room exit/reentry; no live AI or hardware calls");
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
