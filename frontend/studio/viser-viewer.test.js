import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SAM_VISER_EXAMPLE,
  VISER_DEFAULT_URL,
  VISER_DRAFT_DEBOUNCE_MS,
  VISER_STORAGE_KEY,
  VISER_TAB_ID,
  VISER_GITHUB_URL,
  VISER_CAMERAS_CACHE,
  CAM_DEBUG_CACHE,
  CAM_LIST_REFRESH_MS,
  CAM_HOTPLUG_CACHE,
  CAM_SKIP_CACHE,
  CAM_TAB_CACHE,
  NO_WRIST_CAMERA_PLUGGED,
  cameraDebugHint,
  addViserUrl,
  defaultViserUrlsForUser,
  displayViserUrl,
  migrateViserUrl,
  normalizeViserUrl,
  publicWebsiteUrl,
  viserIframeSrc,
  openRoboticsIpPopover,
  openViserCamerasPopup,
  openCamDebugPopup,
  persistViserDraft,
  persistViserPrefs,
  readViserPrefs,
  closeRoboticsIpPopover,
  roboticsIpPopoverIsOpen,
  shouldHideViewportForViser,
  shouldLoadViserIframe,
  injectViserFrameHelpers,
  applyViserGuiCollapsed,
  syncViserGuiArrow,
  pinViserGuiArrow,
  layoutForViserTab,
  nextViserLayoutFromClick,
  clickViserStudioTool,
  syncViserStudioTools,
  shouldShowViserStudioTools,
  VISER_STUDIO_TOOLS,
  VISER_GUI_ARROW_ID,
  VISER_GUI_STYLE_ID,
  VISER_GUI_CACHE,
  VISER_FS_CACHE,
  VISER_GUI_HIDE_CSS,
  syncViserFsButtons,
  viserPrefsKey,
  viserProxySrc,
  viserUnreachableMessage,
  viserWsUrl,
} from "./viser-viewer.js";

test("Viser URL allowlist is LAN-only", () => {
  assert.equal(normalizeViserUrl("192.168.1.77:8095"), "http://192.168.1.77:8095/");
  assert.equal(migrateViserUrl("http://192.168.1.77:8095/"), VISER_DEFAULT_URL);
  assert.equal(normalizeViserUrl("10.0.0.8:8095"), "http://10.0.0.8:8095/");
  assert.equal(normalizeViserUrl("127.0.0.1"), VISER_DEFAULT_URL);
  assert.equal(normalizeViserUrl("http://127.0.0.1:8095"), VISER_DEFAULT_URL);
  assert.equal(normalizeViserUrl("https://example.com/"), "");
  assert.equal(normalizeViserUrl("http://8.8.8.8:8095/"), "");
  assert.equal(normalizeViserUrl("http://169.254.169.254/"), "");
  assert.equal(normalizeViserUrl("http://169.254.1.20:8080/"), "http://169.254.1.20:8080/");
  assert.equal(viserWsUrl("http://192.168.1.77:8095/"), "ws://192.168.1.77:8095");
  assert.equal(viserWsUrl(VISER_DEFAULT_URL), "ws://127.0.0.1:8095");
});

test("Sam account seeds the local Dimensional Viser", () => {
  assert.deepEqual(defaultViserUrlsForUser({ email: "sam@render3d.app" }), [VISER_DEFAULT_URL]);
  assert.deepEqual(defaultViserUrlsForUser({ email: "ada@example.com" }), [VISER_DEFAULT_URL]);
});

test("proxy src stays same-origin with host/port path", () => {
  assert.equal(
    viserProxySrc("http://192.168.1.77:8095/"),
    "/api/viser/p/192.168.1.77/8095/",
  );
  assert.equal(
    viserProxySrc("https://192.168.1.77:8095/"),
    "/api/viser/p/192.168.1.77/8095/",
  );
  assert.equal(viserProxySrc("https://example.com/"), "");
  assert.equal(viserIframeSrc("http://192.168.1.77:8095/", { protocol: "http:" }), "http://192.168.1.77:8095/");
  assert.equal(viserIframeSrc("http://192.168.1.77:8095/", { protocol: "https:" }), "/api/viser/p/192.168.1.77/8095/");
  assert.equal(publicWebsiteUrl("https://example.com/app"), "https://example.com/app");
  assert.equal(publicWebsiteUrl("http://192.168.1.77:8095/"), "");
});

test("add IP persists per user and becomes active", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const user = { id: "u1", email: "ada@example.com" };
  const next = addViserUrl("192.168.1.40:8095", user);
  assert.equal(next.active, "http://192.168.1.40:8095/");
  assert.ok(next.urls.includes("http://192.168.1.40:8095/"));
  assert.equal(readViserPrefs(user).active, "http://192.168.1.40:8095/");
  assert.equal(VISER_TAB_ID, "viser:open");
  assert.equal(shouldHideViewportForViser("viser", "split"), false);
  assert.equal(shouldHideViewportForViser("viser", "viser"), true);
  assert.match(viserUnreachableMessage(VISER_DEFAULT_URL), /Can't reach Dimensional Viser/);
  assert.match(viserUnreachableMessage(VISER_DEFAULT_URL), /local DIMOS viewer/);
  assert.equal(shouldLoadViserIframe({ ok: false, error: "Can't reach Viser at http://192.168.1.77:8095/" }), true);
  assert.equal(shouldLoadViserIframe({ error: "Cloud Studio cannot reach LAN robotics hosts" }), false);
  const project = addViserUrl("10.0.0.9:8082", user, "proj-1");
  assert.equal(project.active, "http://10.0.0.9:8082/");
  assert.equal(readViserPrefs(user, "proj-1").active, "http://10.0.0.9:8082/");
  delete globalThis.localStorage;
});

test("Viser URL persists as you type without Save", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const user = { id: "u-type", email: "ada@example.com" };
  const typed = persistViserDraft("http://10.0.0.8:8095/", user);
  assert.equal(typed.active, "http://10.0.0.8:8095/");
  assert.equal(typed.draft, "http://10.0.0.8:8095/");
  assert.equal(readViserPrefs(user).active, "http://10.0.0.8:8095/");
  const key = viserPrefsKey(user);
  assert.equal(key.startsWith(`${VISER_STORAGE_KEY}:`), true);
  assert.match(store.get(key), /10\.0\.0\.8:8095/);
  persistViserDraft("http://192.168.", user);
  assert.equal(readViserPrefs(user).draft, "http://192.168.");
  assert.equal(readViserPrefs(user).active, "http://10.0.0.8:8095/");
  assert.equal(displayViserUrl(readViserPrefs(user)), "http://192.168.");
  assert.equal(VISER_DRAFT_DEBOUNCE_MS, 400);
  assert.equal(readViserPrefs(user).railOpen, false);
  assert.equal(readViserPrefs(user).chromeOpen, true);
  persistViserPrefs({ railOpen: true, chromeOpen: false }, user);
  assert.equal(readViserPrefs(user).railOpen, true);
  assert.equal(readViserPrefs(user).chromeOpen, false);
  persistViserPrefs({ railOpen: false }, user);
  assert.equal(readViserPrefs(user).railOpen, false);
  assert.equal(readViserPrefs(user).chromeOpen, false);
  delete globalThis.localStorage;
});

test("IP and camera buttons open a real popover", async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const body = { children: [], appendChild(el) { this.children.push(el); }, };
  const prevDoc = globalThis.document;
  globalThis.document = {
    body,
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        className: "",
        innerHTML: "",
        style: {},
        listeners: {},
        setAttribute() {},
        getAttribute() { return ""; },
        querySelector(sel) {
          const s = String(sel);
          if (s.includes("data-cam-device-list")) {
            if (!el._camList) el._camList = { innerHTML: "Looking up cameras…", textContent: "" };
            return el._camList;
          }
          if (s.includes("data-cam-debug-hint")) {
            if (!el._camHint) el._camHint = { textContent: cameraDebugHint() };
            return el._camHint;
          }
          if (s.includes("close") || s.includes("save") || s.includes("connect") || s.includes("input") || s.includes("mode") || s.includes("ws") || s.includes("camera") || s.includes("control") || s.includes("teleop") || s.includes("dimos") || s.includes("email") || s.includes("signup") || s.includes("data-cam-swap") || s.includes("data-cam-title")) {
            return {
              addEventListener(type, fn) { this.fn = fn; },
              focus() {},
              value: "",
              textContent: "",
              classList: { toggle() {} },
              getAttribute() { return "wrist"; },
            };
          }
          return null;
        },
        querySelectorAll() { return []; },
        addEventListener() {},
        remove() { body.children = body.children.filter((c) => c !== el); },
      };
      return el;
    },
  };
  try {
    const pop = openRoboticsIpPopover({ kind: "control", getUser: () => ({ id: "u1", email: "ada@example.com" }) });
    assert.ok(pop);
    assert.equal(roboticsIpPopoverIsOpen(), true);
    assert.match(pop.innerHTML, /Robot config/);
    assert.match(pop.innerHTML, /data-ip-control/);
    assert.match(pop.innerHTML, /data-ip-camera/);
    assert.match(pop.innerHTML, /data-ip-teleop/);
    assert.match(pop.innerHTML, /data-ip-dimos/);
    assert.match(pop.className, /robotics-ip-popover--modal/);
    closeRoboticsIpPopover();
    const cam = openRoboticsIpPopover({ kind: "camera", getUser: () => ({ id: "u1", email: "ada@example.com" }) });
    assert.match(cam.innerHTML, /Cameras/);
    assert.match(cam.innerHTML, /data-ip-teleop/);
    assert.match(cam.innerHTML, /system_profiler SPCameraDataType/);
    assert.equal(roboticsIpPopoverIsOpen(), true);
    closeRoboticsIpPopover();
    const { resetHandCamPublishState } = await import("../xr/xr-hand-cams.js?v=roboticsworkspace3");
    resetHandCamPublishState();
    const publishCalls = [];
    const fetchFn = async (url, opts = {}) => {
      publishCalls.push({ url: String(url), method: String(opts.method || "GET"), body: opts.body || "" });
      if (String(url).includes("/publish")) {
        if (String(opts.method || "GET") === "GET") {
          return { ok: true, json: async () => ({ publish: false }) };
        }
        return { ok: true, json: async () => ({ publish: true }) };
      }
      if (String(url).includes("/api/robotics/hand-cam/status")) {
        return {
          ok: true,
          json: async () => ({
            devices: [
              { name: "Left Arducam B0495", skipped: false, side: "left", uniqueId: "L1" },
              { name: "Right Arducam B0495", skipped: false, side: "right", uniqueId: "R1" },
            ],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    };
    const camsTab = openViserCamerasPopup({
      getUser: () => ({ id: "u1", email: "ada@example.com" }),
      fetchFn,
    });
    assert.match(camsTab.innerHTML, /data-cam-status-left/);
    assert.match(camsTab.innerHTML, /data-cam-status-right/);
    assert.match(camsTab.innerHTML, /data-enable-cameras/);
    assert.match(camsTab.innerHTML, /data-cam-debug-list/);
    assert.match(camsTab.innerHTML, /data-cam-device-list/);
    assert.match(camsTab.innerHTML, /data-cam-swap/);
    assert.match(camsTab.innerHTML, /data-cam-title-left/);
    assert.equal(CAM_LIST_REFRESH_MS, 1500);
    assert.equal(CAM_HOTPLUG_CACHE, "camhot1");
    assert.equal(CAM_SKIP_CACHE, "camskip1");
    assert.equal(CAM_DEBUG_CACHE, "camdbg1");
    assert.equal(NO_WRIST_CAMERA_PLUGGED, "No wrist camera plugged in");
    assert.equal(cameraDebugHint().includes("FaceTime"), false);
    assert.equal(cameraDebugHint([]).includes("skip FaceTime"), false);
    assert.match(cameraDebugHint([{ name: "FaceTime HD Camera", skipped: true }]), /FaceTime is skipped/);
    const intervals = [];
    const prevInterval = globalThis.setInterval;
    globalThis.setInterval = (fn, ms) => { intervals.push(ms); return 11; };
    try {
      const dbg = openCamDebugPopup({
        getUser: () => ({ id: "u1", email: "ada@example.com" }),
        fetchFn,
      });
      assert.match(dbg.className, /robotics-cam-debug-popover/);
      assert.match(dbg.innerHTML, /data-cam-debug-list/);
      assert.match(dbg.innerHTML, /data-cam-device-list/);
      assert.match(dbg.innerHTML, /data-cam-swap/);
      assert.match(dbg.innerHTML, /data-cam-title-left/);
      assert.match(dbg.innerHTML, /data-cam-title-right/);
      assert.equal(dbg.innerHTML.includes("FaceTime and Capture"), false);
      assert.equal(dbg.innerHTML.includes("skip FaceTime"), false);
      assert.ok(intervals.includes(1500));
      await new Promise((r) => setTimeout(r, 0));
      assert.match(dbg._camList.innerHTML, /Left Arducam B0495/);
      assert.match(dbg._camList.innerHTML, /Right Arducam B0495/);
      assert.match(dbg._camList.innerHTML, /plugged in/);
      assert.equal(dbg._camList.innerHTML.includes("No wrist camera plugged in"), false);
    } finally {
      globalThis.setInterval = prevInterval;
    }
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(publishCalls.some((c) => c.url.includes("/api/robotics/hand-cam/publish") && c.method === "POST"));
    assert.ok(publishCalls.some((c) => c.url.includes("/api/robotics/hand-cam/status")));
    closeRoboticsIpPopover();
    assert.equal(roboticsIpPopoverIsOpen(), false);
  } finally {
    globalThis.document = prevDoc;
    delete globalThis.localStorage;
  }
});

test("Robotics Viser chrome uses Network popup, not a wide URL bar", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const ribbon = readFileSync(new URL("./ribbon.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const src = readFileSync(new URL("./viser-viewer.js", import.meta.url), "utf8");
  const viserStart = html.indexOf('id="viser-viewer"');
  const viserEnd = html.indexOf('id="teleop-viewer"', viserStart);
  const viserChrome = html.slice(viserStart, viserEnd);
  assert.match(html, /data-viser-empty/);
  assert.match(html, /Can't reach Dimensional Viser at http:\/\/127\.0\.0\.1:8095/);
  assert.match(html, /Studio proxies the host viewer/);
  assert.match(html, /data-robotics-viser-url/);
  assert.match(html, /data-hand-cam-ip/);
  assert.match(html, /placeholder="http:\/\/127\.0\.0\.1:8095"/);
  assert.equal(viserChrome.includes("Hide panel"), false);
  assert.equal(viserChrome.includes("data-viser-chrome"), false);
  assert.equal(viserChrome.includes("data-viser-side-tab"), false);
  assert.equal(viserChrome.includes("class=\"viser-url-bar\""), false);
  assert.match(viserChrome, /data-viser-network/);
  assert.match(viserChrome, /data-viser-cloud/);
  assert.match(viserChrome, /data-viser-github/);
  assert.match(viserChrome, /data-viser-cam/);
  assert.match(viserChrome, /data-viser-cam aria-pressed="false"/);
  assert.equal(viserChrome.includes("data-viser-cameras-tab"), false);
  assert.equal(VISER_CAMERAS_CACHE, "camvis2");
  assert.equal(CAM_TAB_CACHE, "camtab1");
  assert.match(html, /camtab1/);
  assert.match(html, /camvis1/);
  assert.match(html, /camvis2/);
  assert.match(app, /camvis2/);
  assert.match(src, /function enableWristCameras/);
  assert.match(src, /onShow: onEnableCameras/);
  assert.match(src, /restart: false/);
  assert.match(src, /data-enable-cameras>Cam</);
  assert.equal(src.includes("Move cams"), false);
  assert.equal(src.includes("VR scene"), false);
  assert.match(ribbon, /label: "Cam"/);
  assert.match(ribbon, /ribbon-btn--enable-cam/);
  assert.match(app, /handleRoboticsRibbonAction\("cam-enable"\)/);
  assert.equal(ribbon.includes("Move cams"), false);
  assert.equal(ribbon.includes("VR windows"), false);
  assert.match(src, /data-viser-cam/);
  assert.match(app, /camre1/);
  assert.match(src, /CAM_LIST_REFRESH_MS/);
  assert.match(src, /maybeHotplugHandCamPublish/);
  assert.match(src, /setInterval\?\.\(loadStatus, CAM_LIST_REFRESH_MS\)/);
  assert.equal(src.includes("requestHandCamPermission"), false);
  assert.match(app, /camhot1/);
  assert.equal(VISER_GITHUB_URL, "https://github.com/nerfstudio-project/viser");
  assert.match(html, /data-viser-resize/);
  assert.match(ribbon, /kind: "input"/);
  assert.match(ribbon, /roboticsAction: "viser-cloud"/);
  assert.match(ribbon, /label: "Network"/);
  assert.match(ribbon, /roboticsAction: "cam-debug"/);
  assert.match(ribbon, /ribbon-btn--cam-debug/);
  assert.match(ribbon, /data-cam-debug/);
  assert.match(app, /action === "cam-debug"/);
  assert.match(app, /openCamDebugPopup/);
  assert.match(app, /camdbg1/);
  assert.match(html, /camdbg1/);
  assert.equal(CAM_DEBUG_CACHE, "camdbg1");
  assert.match(app, /action === "viser-tab"/);
  assert.match(app, /action === "viser-cloud"/);
  assert.match(app, /getProjectId: \(\) => projectId/);
  assert.match(app, /20260923-dimos-viser-local1/);
  assert.match(app, /cams1|wristport1/);
  assert.match(html, /20260914-viserui2/);
  assert.match(html, /20260914-viserui3/);
  assert.match(html, /20260915-wristport1/);
  assert.match(css, /\.main-column\.doc-tabs-open\.viser-layout-viser #viser-viewer/);
  assert.match(css, /\.robotics-ip-popover--modal/);
  assert.match(css, /\.viser-manip-dock/);
  assert.match(src, /openCloudComputePopover/);
  assert.match(src, /railOpen: false/);
  assert.match(src, /layoutForViserTab/);
  assert.match(src, /nextViserLayoutFromClick/);
  assert.match(src, /bindFrameHelpers/);
  assert.equal(src.includes('persistViserPrefs({ layout: "viser" }'), false);
  assert.match(src, /cloudTrainingManifest/);
  assert.match(src, /Open DGX login/);
  assert.equal(src.includes("sidebar=0"), false);
});

test("Studio overlay has no duplicate eye, no X close, and does not cover the Viser GUI header", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("./viser-viewer.js", import.meta.url), "utf8");
  const viserStart = html.indexOf('id="viser-viewer"');
  const viserEnd = html.indexOf('id="teleop-viewer"', viserStart);
  const viserChrome = html.slice(viserStart, viserEnd);
  const dockStart = viserChrome.indexOf("data-viser-manip-dock");
  const dockClose = viserChrome.indexOf("</div>", dockStart);
  const dock = viserChrome.slice(dockStart, dockClose);
  const dockCss = css.match(/\.viser-manip-dock\s*\{[^}]+\}/)?.[0] || "";

  assert.equal((dock.match(/data-viser-cameras-tab/g) || []).length, 0);
  assert.equal(dock.includes("Cameras"), false);
  assert.equal((dock.match(/data-viser-github/g) || []).length, 1);
  assert.equal((dock.match(/data-viser-network-icon/g) || []).length, 1);
  assert.equal(dock.includes("data-viser-eye"), false);
  assert.equal(dock.includes("✕"), false);
  assert.equal(dock.includes("data-viser-close"), false);
  assert.equal(viserChrome.includes("studio-viser-settings-x"), false);
  assert.equal(src.includes("Close Viser settings"), false);
  assert.equal(src.includes("Hide Viser folders"), false);
  assert.equal(src.includes("textContent = \"✕\""), false);
  assert.equal(src.includes("translateX(-28px)"), false);
  assert.equal(src.includes("restyleManipulationFolder"), false);
  assert.match(dockCss, /position:\s*static/);
  assert.ok(dockStart < viserChrome.indexOf('class="viser-body"'), "GitHub and settings stay in the top toolbar");
  assert.match(dockCss, /pointer-events:\s*auto/);
  assert.match(dockCss, /display:\s*flex/);
  assert.match(dockCss, /flex-direction:\s*row/);
  assert.match(dockCss, /align-items:\s*center/);
  assert.equal(dockCss.includes("right: 72px"), false);

  const removed = new Set();
  const created = [];
  const doc = {
    getElementById(id) {
      if (id === "studio-viser-settings-x") return { remove() { removed.add(id); } };
      if (id === "studio-viser-controls") return { remove() { removed.add(id); } };
      if (id === "studio-viser-settings-style") return { remove() { removed.add(id); } };
      return null;
    },
    createElement(tag) {
      const el = { tagName: tag, id: "", textContent: "", setAttribute() {} };
      created.push(el);
      return el;
    },
    documentElement: { classList: { remove(name) { removed.add(name); } } },
    body: { appendChild() {} },
    head: { appendChild() {} },
  };
  injectViserFrameHelpers({ contentDocument: doc });
  assert.ok(removed.has("studio-viser-settings-x"));
  assert.ok(removed.has("studio-viser-controls"));
  assert.ok(created.some((el) => el.id === VISER_GUI_STYLE_ID));
  assert.equal(created.some((el) => el.id === VISER_GUI_ARROW_ID), false);
  assert.equal(created.some((el) => el.id === "studio-viser-settings-x"), false);
  assert.equal(viserChrome.includes("data-viser-gui-arrow"), false);
  assert.match(viserChrome, /data-viser-fs/);
  assert.match(viserChrome, /data-viser-fs-exit/);
  assert.match(src, /data-viser-gui-arrow/);
  assert.match(src, /Never inject the dead iframe chevron/);
  assert.match(css, /\.viser-gui-arrow/);
  assert.match(css, /\.viser-fs-btn/);
  assert.match(css, /hide\/restore is Studio fullscreen/);
  assert.equal(css.includes("right: 280px"), false);
  assert.equal(VISER_GUI_CACHE, "visgui2");
  assert.equal(VISER_FS_CACHE, "visfs1");
  assert.match(html, /visgui2/);
  assert.match(html, /visfs1/);
  assert.match(src, /Hide side panel/);
  assert.match(src, /guiHidden/);
  assert.match(src, /applyGui\(true\)/);
  assert.match(src, /applyGui\(false\)/);
  assert.match(VISER_GUI_HIDE_CSS, /\.GuiPanel/);
  assert.match(VISER_GUI_HIDE_CSS, /\.ControlPanel/);
  assert.match(VISER_GUI_HIDE_CSS, /#studio-viser-gui-arrow/);
  assert.equal(VISER_GUI_HIDE_CSS.includes("translate(-100%"), false);
  assert.equal(VISER_GUI_HIDE_CSS.includes("right: 280px"), false);
  const arrow = { attrs: {}, hidden: false };
  arrow.setAttribute = (k, v) => { arrow.attrs[k] = String(v); };
  syncViserGuiArrow(arrow, true);
  assert.equal(arrow.hidden, true);
  const fsBtn = { hidden: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } };
  const exitBtn = { hidden: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } };
  const stage = {
    querySelectorAll(sel) {
      if (sel === "[data-viser-fs]") return [fsBtn];
      if (sel === "[data-viser-fs-exit]") return [exitBtn];
      return [];
    },
  };
  syncViserFsButtons(stage, true);
  assert.equal(fsBtn.hidden, true);
  assert.equal(exitBtn.hidden, false);
  const root = { classList: { _s: new Set(), toggle(name, on) { if (on) this._s.add(name); else this._s.delete(name); }, contains(name) { return this._s.has(name); } } };
  applyViserGuiCollapsed(root, true);
  assert.ok(root.classList.contains("viser-gui-collapsed"));
  const pinned = { documentElement: { classList: { contains() { return false; } }, style: { props: {}, setProperty(k, v) { this.props[k] = v; } } }, querySelector() { return { getBoundingClientRect() { return { left: 640, top: 0, height: 400, width: 320 }; } }; } };
  pinViserGuiArrow(pinned);
  assert.equal(pinned.documentElement.style.props["--studio-viser-gui-edge"], "640px");
});

test("Split view shows the 3D viewport beside Viser, and gizmos remount on a new tab", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("./viser-viewer.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");

  assert.equal(layoutForViserTab({ layout: "split" }), "split");
  assert.equal(layoutForViserTab({ layout: "viser" }), "viser");
  assert.equal(layoutForViserTab({ layout: "cad" }), "viser");
  assert.equal(layoutForViserTab({}), "viser");
  assert.equal(nextViserLayoutFromClick("split", "viser"), "split");
  assert.equal(nextViserLayoutFromClick("split", "cad"), "split");
  assert.equal(nextViserLayoutFromClick("split", "split"), "viser");
  assert.equal(nextViserLayoutFromClick("viser", "split"), "viser");
  assert.equal(nextViserLayoutFromClick("cad", "split"), "cad");
  assert.equal(shouldHideViewportForViser("viser", nextViserLayoutFromClick("split", "split")), true);
  assert.equal(shouldShowViserStudioTools(nextViserLayoutFromClick("split", "split")), true);
  assert.equal(shouldShowViserStudioTools(nextViserLayoutFromClick("split", "viser")), false);

  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const user = { id: "split-toggle", email: "ada@example.com" };
  persistViserPrefs({ layout: nextViserLayoutFromClick("split", "viser") }, user);
  assert.equal(readViserPrefs(user).layout, "split");
  persistViserPrefs({ layout: nextViserLayoutFromClick("split", readViserPrefs(user).layout) }, user);
  assert.equal(readViserPrefs(user).layout, "viser");
  delete globalThis.localStorage;

  const hideAt = css.lastIndexOf('.main-column[data-shell-tab]:not([data-shell-tab="viewport"]) #viewport');
  const splitAt = css.lastIndexOf(".main-column.doc-tabs-open.viser-layout-split #viser-viewer");
  assert.ok(hideAt >= 0 && splitAt > hideAt, "split overlay rules must follow viewport hide");
  assert.match(css, /\[data-shell-tab="viser"\]\.viser-layout-split #viewport/);
  assert.match(css, /\.viser-studio-tools/);
  assert.match(css, /\.main-column\.viser-layout-split \.viser-studio-tools/);
  assert.match(css, /\.viser-studio-tools\[hidden\]/);

  assert.doesNotMatch(html, /data-viser-studio-tools/);
  assert.doesNotMatch(html, /data-viser-tool=/);
  assert.equal(VISER_STUDIO_TOOLS.some((t) => t.id === "btn-gizmo"), true);
  assert.equal(shouldShowViserStudioTools("split"), false);
  assert.equal(shouldShowViserStudioTools("cad"), false);
  assert.equal(shouldShowViserStudioTools("viser"), true);
  assert.equal(app.includes('applyLayout?.("viser")'), false);
  assert.match(src, /studioViserLoadBound/);
  assert.match(html, /visersplit1/);
  assert.match(html, /visergizmo2/);
  assert.match(html, /visersplitoff1/);

  const overlay = { hidden: false, attrs: {}, querySelectorAll() { return []; }, setAttribute(k, v) { this.attrs[k] = String(v); } };
  const splitRoot = {
    querySelector(sel) {
      if (sel === "[data-viser-studio-tools]") return overlay;
      if (sel === ".main-column") return { dataset: { viserLayout: "split" }, classList: { contains() { return false; } } };
      return null;
    },
    getElementById() { return null; },
  };
  syncViserStudioTools(splitRoot);
  assert.equal(overlay.hidden, true);
  assert.equal(overlay.attrs["aria-hidden"], "true");
  syncViserStudioTools(splitRoot, "viser");
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.attrs["aria-hidden"], "false");

  const clicks = [];
  const prev = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return { click() { clicks.push(id); } };
    },
    querySelector() { return null; },
  };
  try {
    assert.equal(clickViserStudioTool("btn-gizmo"), true);
    assert.deepEqual(clicks, ["btn-gizmo"]);
  } finally {
    globalThis.document = prev;
  }
});
