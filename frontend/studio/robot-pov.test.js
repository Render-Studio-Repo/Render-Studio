import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountRobotPov, robotCameraWallFrameUrl, robotCameraWallHeaders, robotPovDragPosition } from "./robot-pov.js";

class FakeNode {
  constructor() {
    this.childrenBySelector = new Map();
    this.listeners = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.isConnected = false;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    this.listeners.get("click")?.();
  }

  dispatch(type) {
    this.listeners.get(type)?.({ preventDefault() {}, stopPropagation() {} });
  }

  querySelector(selector) {
    return this.childrenBySelector.get(selector) || null;
  }

  querySelectorAll(selector) {
    if (selector !== "img") return [];
    return ["left", "right", "zed"].map((kind) => this.querySelector(`[data-pov-feed="${kind}"]`));
  }

  setAttribute() {}

  remove() {
    this.isConnected = false;
    for (const child of this.childrenBySelector.values()) child.isConnected = false;
  }

  set innerHTML(value) {
    this.html = value;
    const close = new FakeNode();
    const split = new FakeNode();
    const permission = new FakeNode();
    const zedFigure = new FakeNode();
    const caption = new FakeNode();
    zedFigure.childrenBySelector.set("figcaption", caption);
    this.childrenBySelector.set("[data-pov-close]", close);
    this.childrenBySelector.set("[data-pov-split]", split);
    this.childrenBySelector.set("[data-pov-zed-permission]", permission);
    this.childrenBySelector.set(".robot-pov-zed", zedFigure);
    for (const kind of ["left", "right", "zed"]) {
      const image = new FakeNode();
      image.closest = () => zedFigure;
      this.childrenBySelector.set(`[data-pov-feed="${kind}"]`, image);
    }
  }
}

function makeFixture(onSplit) {
  const openButton = new FakeNode();
  const zedInput = new FakeNode();
  const root = new FakeNode();
  root.querySelector = (selector) => ({
    "[data-robot-pov-open]": openButton,
    "[data-robot-pov-zed-url]": zedInput,
  })[selector] || null;
  const sections = [];
  const priorDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      const section = new FakeNode();
      sections.push(section);
      return section;
    },
    body: {
      appendChild(section) {
        section.isConnected = true;
        for (const child of section.childrenBySelector.values()) child.isConnected = true;
      },
    },
  };
  const statuses = [];
  const frameRequests = [];
  const api = async (path) => {
    if (path.endsWith("/robotics-prefs")) return { prefs: {} };
    if (path.endsWith("/zed/status")) return { usb: true, live: true, permission: "authorized" };
    return {};
  };
  const controller = mountRobotPov({
    root,
    api,
    getCameraHost: () => "192.168.1.44",
    getToken: () => "camera-token",
    fetchFn: async (path, options) => {
      frameRequests.push([path, options]);
      return { ok: true, blob: async () => new Blob(["jpeg-frame"]) };
    },
    onSplit,
    onStatus: (kind, message) => statuses.push([kind, message]),
  });
  return {
    controller,
    sections,
    statuses,
    frameRequests,
    restore() {
      controller.close();
      globalThis.document = priorDocument;
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("Studio shell publishes the Robot POV close-handler cache key", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /\/studio\/app\.js[^"\n]*camera-wall-auth1/);
});

test("camera wall requests use the authenticated same-origin proxy", () => {
  assert.equal(robotCameraWallFrameUrl("left", 123), "/api/robotics/camera-wall/left.jpg?t=123");
  assert.deepEqual(robotCameraWallHeaders("camera-token"), { Authorization: "Bearer camera-token" });
  assert.deepEqual(robotCameraWallHeaders(""), {});
});

test("Robot POV drag stays inside the visible browser", () => {
  assert.deepEqual(robotPovDragPosition({ left: 100, top: 80, dx: 40, dy: 30, width: 480, height: 360, viewportWidth: 1200, viewportHeight: 800 }), { left: 140, top: 110 });
  assert.deepEqual(robotPovDragPosition({ left: 100, top: 80, dx: 2000, dy: -500, width: 480, height: 360, viewportWidth: 1200, viewportHeight: 800 }), { left: 712, top: 8 });
});

test("robotics dialogs stay above Robotics Home and camera windows", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const value = (selector) => Number(css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}[^}]*z-index:\\s*(\\d+)`, "s"))?.[1] || 0);
  assert.ok(value(".robotics-ip-popover") > value(".robotics-home-viewer"));
  assert.ok(value(".robotics-ip-popover--modal") > value(".wrist-cam-popups"));
});

test("Robot POV stays unified when splitting fails and closes after all three windows open", async () => {
  let splitResult = { ok: false, message: "Popups were blocked." };
  const splitRequests = [];
  const fixture = makeFixture(async (request) => {
    splitRequests.push(request);
    return splitResult;
  });
  try {
    await fixture.controller.open();
    const section = fixture.sections[0];
    assert.equal(fixture.controller.isOpen(), true);
    assert.equal(fixture.controller.mode, "unified");
    assert.equal(fixture.frameRequests.length, 3);
    assert.deepEqual(fixture.frameRequests.map(([path]) => path.replace(/\?t=\d+$/, "")), [
      "/api/robotics/camera-wall/left.jpg",
      "/api/robotics/camera-wall/right.jpg",
      "/api/robotics/camera-wall/zed.jpg",
    ]);
    assert.equal(fixture.frameRequests[0][1].headers.Authorization, "Bearer camera-token");

    section.querySelector("[data-pov-split]").click();
    await settle();
    assert.equal(fixture.controller.isOpen(), true);
    assert.equal(fixture.controller.mode, "unified");
    assert.deepEqual(fixture.statuses.at(-1), ["error", "Popups were blocked."]);

    splitResult = { ok: true };
    section.querySelector("[data-pov-split]").click();
    await settle();
    assert.equal(fixture.controller.isOpen(), false);
    assert.equal(fixture.controller.mode, "detached");
    assert.deepEqual(splitRequests.at(-1), {
      feeds: ["left", "right", "zed"],
      cameraHost: "192.168.1.44",
      zedUrl: "/api/robotics/zed.jpg",
    });
    assert.deepEqual(fixture.statuses.at(-1), ["ok", "Cameras split into three windows."]);
  } finally {
    fixture.restore();
  }
});

test("Robot POV hides ZED grant button when camera is already authorized", async () => {
  const fixture = makeFixture(undefined);
  try {
    await fixture.controller.open();
    const permBtn = fixture.sections[0].querySelector("[data-pov-zed-permission]");
    assert.equal(permBtn.hidden, true);
  } finally {
    fixture.restore();
  }
});

test("Robot POV exposes close and does not split without a detached-window handler", async () => {
  const fixture = makeFixture(undefined);
  try {
    await fixture.controller.open();
    fixture.sections[0].querySelector("[data-pov-split]").click();
    assert.equal(fixture.controller.isOpen(), true);
    assert.deepEqual(fixture.statuses.at(-1), ["error", "Camera splitting is unavailable."]);
    fixture.sections[0].querySelector("[data-pov-close]").dispatch("pointerdown");
    assert.equal(fixture.controller.isOpen(), false);
  } finally {
    fixture.restore();
  }
});

test("Robot POV keeps the unified window when detached-window creation throws", async () => {
  const fixture = makeFixture(() => { throw new Error("Popup permission denied."); });
  try {
    await fixture.controller.open();
    fixture.sections[0].querySelector("[data-pov-split]").click();
    await settle();
    assert.equal(fixture.controller.isOpen(), true);
    assert.equal(fixture.controller.mode, "unified");
    assert.deepEqual(fixture.statuses.at(-1), ["error", "Popup permission denied."]);
  } finally {
    fixture.restore();
  }
});
