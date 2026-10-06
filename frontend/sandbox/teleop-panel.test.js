import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mountTeleopLab, TELEOP_TOKEN, DIMOS_WIRE_TOKEN, SBVP1_TOKEN } from "./teleop-panel.js";
import { studioViewportSrc, LEGACY_MUJOCO_LAB } from "./studio-viewport-replica.js";

const here = dirname(fileURLToPath(import.meta.url));

function makeHost() {
  const nodes = new Map();
  const host = {
    classList: { add() {} },
    dataset: {},
    innerHTML: "",
    querySelector(sel) {
      if (nodes.has(sel)) return nodes.get(sel);
      if (sel === "[data-sb-dimos-slot]") {
        const el = { insertAdjacentHTML() {}, querySelector() { return null; } };
        nodes.set(sel, el);
        return el;
      }
      if (sel === "[data-sb-studio-replica]") {
        const el = {
          classList: { add() {} },
          dataset: {},
          innerHTML: "",
          querySelector(s) {
            if (s === "[data-sb-studio-view]") return nodes.get("view");
            if (s === ".sb-studio-viewport-frame") return nodes.get("frame");
            return null;
          },
        };
        nodes.set(sel, el);
        // After mountStudioViewportReplica sets innerHTML, querySelector on el uses these
        const frameAttrs = new Map([["src", "about:blank"], ["data-src", studioViewportSrc()]]);
        nodes.set("frame", {
          getAttribute: (k) => frameAttrs.get(k),
          setAttribute: (k, v) => frameAttrs.set(k, v),
          _attrs: frameAttrs,
        });
        nodes.set("view", { open: false, addEventListener() {} });
        // Patch el.querySelector after innerHTML assignment by wrapping
        const orig = el;
        Object.defineProperty(host, "_replica", { value: orig });
        return el;
      }
      return null;
    },
  };
  return host;
}

test("mountTeleopLab embeds Studio viewport replica + DIMOS slot", () => {
  const host = makeHost();
  // mountStudioViewportReplica writes into replica host; capture via assignment
  const replicaHost = {
    classList: { add() {} },
    dataset: {},
    _html: "",
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    querySelector(sel) {
      if (sel === "[data-sb-studio-view]") return this._view;
      if (sel === ".sb-studio-viewport-frame") return this._frame;
      return null;
    },
    _view: { open: true, addEventListener() {} },
    _frame: (() => {
      const attrs = new Map([["src", "about:blank"], ["data-src", studioViewportSrc()]]);
      return {
        getAttribute: (k) => attrs.get(k),
        setAttribute: (k, v) => attrs.set(k, v),
      };
    })(),
  };
  host.querySelector = (sel) => {
    if (sel === "[data-sb-dimos-slot]") return { insertAdjacentHTML() {}, querySelector() { return null; } };
    if (sel === "[data-sb-studio-replica]") return replicaHost;
    return null;
  };
  const out = mountTeleopLab(host);
  assert.equal(TELEOP_TOKEN, "sbvp1");
  assert.equal(SBVP1_TOKEN, "sbvp1");
  assert.equal(DIMOS_WIRE_TOKEN, "dimoswire1");
  assert.equal(out.dataset.ready, "1");
  assert.match(replicaHost.innerHTML, /sandboxViewport=1/);
  assert.match(replicaHost.innerHTML, /data-sbvp-mode="mujoco"/);
  assert.match(replicaHost.innerHTML, /data-sbvp-mode="teach"/);
  assert.match(replicaHost.innerHTML, /data-sbvp-mode="board"/);
  assert.match(replicaHost.innerHTML, /data-sbvp-mode="wall"/);
  assert.match(replicaHost.innerHTML, /data-sbvp-mode="wiring"/);
  assert.match(replicaHost.innerHTML, /data-sbvp-mode="sql"/);
  assert.match(replicaHost.innerHTML, /data-sbvp-wiring-host/);
  assert.match(replicaHost.innerHTML, /data-sbvp-sql-host/);
  assert.match(replicaHost.innerHTML, /sbvp1/);
  assert.equal(LEGACY_MUJOCO_LAB, "/sandbox/openarm-mujoco/index.html?embed=1");
});

test("workshop parks live instances instead of spawning a second frame", () => {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  globalThis.window = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    dispatchEvent() { return true; },
  };
  try {
    const replicaHost = {
      classList: { add() {} },
      dataset: {},
      innerHTML: "",
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const host = mountTeleopLab({
      classList: { add() {} },
      dataset: {},
      innerHTML: "",
      querySelector: (sel) => {
        if (sel === "[data-sb-dimos-slot]") return {};
        if (sel === "[data-sb-studio-replica]") return replicaHost;
        return null;
      },
    });
    assert.equal(typeof host.replica?.setMode, "function");
    host.replica?.setMode("viewport");
    host.replica?.setMode("wiring");
    assert.ok(listeners.has("render3d-sandbox-close-viewport"));
  } finally {
    globalThis.window = previousWindow;
  }
});

test("dimos-link module exposes connect controls", () => {
  const js = readFileSync(join(here, "dimos-link.js"), "utf8");
  assert.match(js, /Save IP|Connect DIMOS/);
  assert.match(js, /data-sb-dimos-connect/);
  assert.match(js, /data-sb-dimos-ensure/);
  assert.match(js, /\/api\/dimos\/ensure-coordinator/);
  assert.match(js, /persistDimosWsUrl/);
  assert.match(js, /\/api\/integrations\/grok-bot\/dimos/);
  assert.match(js, /never moves joints|Does not arm teleop/i);
  assert.doesNotMatch(js, /setDimosTeleopArmed/);
  assert.doesNotMatch(js, /requestPiTeleop/);
});

test("boot and css wire dimos strip + studio replica", () => {
  const boot = readFileSync(join(here, "boot.js"), "utf8");
  const css = readFileSync(join(here, "sandbox.css"), "utf8");
  const html = readFileSync(join(here, "index.html"), "utf8");
  const replica = readFileSync(join(here, "studio-viewport-replica.js"), "utf8");
  assert.match(boot, /teleop-panel\.js\?v=/);
  assert.match(css, /\.sb-dimos-link/);
  assert.match(css, /\.sb-studio-viewport-frame/);
  assert.match(css, /\.sb-sbvp-modes/);
  assert.match(html, /sandbox\.css\?v=/);
  assert.match(replica, /sandboxViewport=1/);
  assert.match(replica, /data-sbvp-mode="wiring"/);
  assert.match(replica, /data-sbvp-mode="sql"/);
  assert.match(replica, /sandbox-wiring\.js/);
  assert.match(replica, /supabase-sql\.js/);
});

test("MuJoCo embed hides overlapping key-bindings panel", () => {
  const html = readFileSync(join(here, "openarm-mujoco/index.html"), "utf8");
  assert.match(html, /body\.embed #panel \{ display: none !important/);
  assert.doesNotMatch(html, /<details open>\s*<summary>key bindings<\/summary>/);
  assert.match(html, /mujoco-panel-chip/);
});
