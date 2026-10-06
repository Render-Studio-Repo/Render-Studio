import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROBOTICS_DOCS_HREF,
  SAM_TELEOP_EXAMPLE,
  TELEOP_DEFAULT_URL,
  TELEOP_DRAFT_DEBOUNCE_MS,
  TELEOP_TAB_ID,
  addTeleopUrl,
  autoClickTeleopConnect,
  defaultTeleopUrlsForUser,
  displayTeleopUrl,
  isQuestBrowser,
  normalizeTeleopUrl,
  persistTeleopDraft,
  readTeleopPrefs,
  shouldLoadTeleopIframe,
  teleopIframeSrc,
  teleopPrefsKey,
  teleopProxySrc,
  teleopUnreachableMessage,
} from "./teleop-viewer.js";

test("Teleop URL allowlist is HTTPS LAN-only", () => {
  assert.equal(normalizeTeleopUrl("192.168.1.77"), SAM_TELEOP_EXAMPLE);
  assert.equal(normalizeTeleopUrl("192.168.1.77:8443"), SAM_TELEOP_EXAMPLE);
  assert.equal(normalizeTeleopUrl("http://192.168.1.77:8443/"), SAM_TELEOP_EXAMPLE);
  assert.equal(normalizeTeleopUrl("https://192.168.1.77:8443/teleop"), SAM_TELEOP_EXAMPLE);
  assert.equal(normalizeTeleopUrl("wss://192.168.1.77:8443/ws"), SAM_TELEOP_EXAMPLE);
  assert.equal(normalizeTeleopUrl("127.0.0.1"), TELEOP_DEFAULT_URL);
  assert.equal(normalizeTeleopUrl("https://example.com/teleop"), "");
  assert.equal(normalizeTeleopUrl("http://8.8.8.8:8443/teleop"), "");
});

test("Sam account seeds Pi teleop first", () => {
  assert.deepEqual(defaultTeleopUrlsForUser({ email: "sam@render3d.app" }), [SAM_TELEOP_EXAMPLE, TELEOP_DEFAULT_URL]);
  assert.deepEqual(defaultTeleopUrlsForUser({ email: "ada@example.com" }), [TELEOP_DEFAULT_URL]);
});

test("proxy src is always same-origin HTTPS path", () => {
  assert.equal(teleopProxySrc("https://192.168.1.77:8443/teleop"), "/api/teleop/p/192.168.1.77/8443/teleop");
  assert.equal(teleopIframeSrc("http://192.168.1.77:8443", { hostname: "192.168.1.20", protocol: "http:" }), "/api/teleop/p/192.168.1.77/8443/teleop");
  assert.equal(teleopIframeSrc("https://192.168.1.77:8443/teleop", { hostname: "render3d.app", protocol: "https:" }), "");
  assert.equal(teleopProxySrc("https://example.com/teleop"), "");
});

test("teleop URL persists as you type", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const user = { id: "u-teleop", email: "ada@example.com" };
  const typed = persistTeleopDraft("https://10.0.0.8:8443/teleop", user);
  assert.equal(typed.active, "https://10.0.0.8:8443/teleop");
  assert.equal(readTeleopPrefs(user).active, "https://10.0.0.8:8443/teleop");
  persistTeleopDraft("https://192.168.", user);
  assert.equal(readTeleopPrefs(user).draft, "https://192.168.");
  assert.equal(displayTeleopUrl(readTeleopPrefs(user)), "https://192.168.");
  assert.equal(TELEOP_DRAFT_DEBOUNCE_MS, 400);
  assert.equal(teleopPrefsKey(user).startsWith("render3d:teleopPrefs:"), true);
  const added = addTeleopUrl("192.168.1.40:8443", user);
  assert.equal(added.active, "https://192.168.1.40:8443/teleop");
  delete globalThis.localStorage;
});

test("Quest auto-click Connect; desktop leaves greyed button", () => {
  const clicks = [];
  const iframe = {
    contentDocument: {
      querySelectorAll() {
        return [{
          textContent: "Connect",
          disabled: false,
          click() { clicks.push("connect"); },
          getAttribute() { return ""; },
        }];
      },
    },
    contentWindow: { postMessage(payload) { clicks.push(payload.type); } },
  };
  assert.equal(autoClickTeleopConnect(iframe, { quest: false }), false);
  assert.equal(clicks.length, 0);
  assert.equal(autoClickTeleopConnect(iframe, { quest: true }), true);
  assert.ok(clicks.includes("connect"));
  assert.ok(clicks.includes("studio-teleop-autoconnect"));
  assert.equal(isQuestBrowser({ documentElement: { classList: { contains: (c) => c === "vr-headset-browser" } } }), true);
  assert.equal(isQuestBrowser({ documentElement: { classList: { contains: () => false } } }, { userAgent: "Mozilla" }), false);
  assert.equal(TELEOP_TAB_ID, "teleop:open");
  assert.equal(ROBOTICS_DOCS_HREF, "/getting-started.html#robotics-configuration");
  assert.match(teleopUnreachableMessage("https://127.0.0.1:8443/teleop"), /not the Pi/);
  assert.equal(shouldLoadTeleopIframe({ error: "Cloud Studio cannot reach LAN robotics hosts" }), false);
});

test("Robotics strip mounts a Teleop tab and proxy iframe", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ribbon = readFileSync(new URL("./ribbon.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(html, /id="teleop-viewer"/);
  assert.match(html, /data-teleop-frame/);
  assert.match(html, /data-teleop-url/);
  assert.match(html, /data-teleop-connect/);
  assert.match(html, /Teleop \/ Robotics setup/);
  assert.match(html, /\/api\/teleop\/p\//);
  assert.match(ribbon, /roboticsAction: "teleop-open"/);
  assert.match(ribbon, /data-teleop-ribbon-url/);
  assert.match(ribbon, /Teleop \/ Robotics setup/);
  assert.match(app, /action === "teleop-open"/);
  assert.match(app, /createTeleopViewer/);
  assert.match(app, /20260914-teleop2/);
  assert.match(ribbon, /data-teleop-connect/);
  assert.match(ribbon, /data-teleop-docs/);
  const docs = readFileSync(new URL("../pages/docs.html", import.meta.url), "utf8");
  const gs = readFileSync(new URL("../pages/getting-started.html", import.meta.url), "utf8");
  assert.match(docs, /Robotics Configuration/);
  assert.match(gs, /Robotics Configuration/);
  const media = readFileSync(new URL("../docs/media/robotics-configuration.gif", import.meta.url));
  assert.ok(media.length > 1000);
});

test("Robotics Configuration docs use YOUR_LAN_IP and keep GIFs on the left", () => {
  const gsJs = readFileSync(new URL("../site/getting-started.js", import.meta.url), "utf8");
  const guides = readFileSync(new URL("../site/getting-started-guides.js", import.meta.url), "utf8");
  const features = readFileSync(new URL("../site/docs-features.js", import.meta.url), "utf8");
  const tour = readFileSync(new URL("../site/show-me-tour.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../pages/getting-started.html", import.meta.url), "utf8");
  assert.match(gsJs, /data-robotics-lan-ip/);
  assert.match(gsJs, /How do I get my IP\?/);
  assert.match(gsJs, /function showRenderAgent/);
  assert.match(gsJs, /gs-feature--gif-left/);
  assert.match(gsJs, /ipconfig/);
  assert.match(guides, /YOUR_LAN_IP/);
  assert.match(features, /YOUR_LAN_IP/);
  assert.match(tour, /YOUR_LAN_IP/);
  assert.doesNotMatch(guides, /192\.168\.1\.77/);
  assert.doesNotMatch(features, /192\.168\.1\.77/);
  assert.doesNotMatch(tour, /192\.168\.1\.77/);
  assert.match(guides, /Connecting wrist cameras/);
  assert.match(features, /Connecting wrist cameras/);
  const camGuide = guides.slice(guides.indexOf("robotics-wrist-cameras"));
  const camFeature = features.slice(features.indexOf("robotics-wrist-cameras"));
  assert.doesNotMatch(camGuide, /192\.168\.1\.83/);
  assert.doesNotMatch(camFeature, /192\.168\.1\.83/);
  assert.match(html, /getting-started\.js\?v=.*gifs40/);
});
