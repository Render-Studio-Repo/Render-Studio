import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIMOS_CONTROL_DEFAULTS,
  DIMOS_CONTROL_PROFILES,
  DIMOS_CONTROL_SCHEMA,
  applyDimosControlBindings,
  closeDimosControlsPopup,
  dimosControlBindingsSnapshot,
  dimosControlDiagramSvg,
  dimosControlPrefsKey,
  dimosControlsPopoverIsOpen,
  migrateStaleDimosControlPrefs,
  openDimosControlsPopup,
  persistDimosControlPrefs,
  readDimosControlPrefs,
  resetDimosControlPrefsCache,
} from "./xr-dimos-controls.js";

const here = dirname(fileURLToPath(import.meta.url));

test("locked defaults use Y for motion and A/B for record/discard", () => {
  assert.equal(DIMOS_CONTROL_DEFAULTS.engage, "y_map");
  assert.equal(DIMOS_CONTROL_DEFAULTS.gripper, "none");
  assert.equal(DIMOS_CONTROL_DEFAULTS.record, "A");
  assert.equal(DIMOS_CONTROL_DEFAULTS.discard, "B");
  assert.equal(DIMOS_CONTROL_DEFAULTS.schema, DIMOS_CONTROL_SCHEMA);
  assert.equal(DIMOS_CONTROL_DEFAULTS.lock, "sam");
});

test("applyDimosControlBindings is identity under locked profile (no X+A / grip swap)", () => {
  resetDimosControlPrefsCache();
  const mapped = applyDimosControlBindings({
    primary: true,
    axes: [0, 0, 0.2, 0.9],
    buttons: [0, 1, 0, 0, 1, 0, 0],
  }, DIMOS_CONTROL_DEFAULTS);
  assert.equal(mapped.buttons[4], 1);
  assert.equal(mapped.buttons[5], 0);
  assert.equal(mapped.buttons[1], 1);
  assert.equal(mapped.axes[3], 0.9);
  assert.equal(mapped.primary, true);
});

test("stale X+A + squeeze prefs migrate to locked Y-map", () => {
  const migrated = migrateStaleDimosControlPrefs({
    headset: "quest3",
    engage: "primary",
    gripper: "squeeze",
  });
  assert.equal(migrated.engage, "y_map");
  assert.equal(migrated.gripper, "none");
  assert.equal(migrated.record, "A");
  assert.equal(migrated.discard, "B");
  assert.equal(migrated.lock, "sam");
  assert.equal(migrated.schema, DIMOS_CONTROL_SCHEMA);
});

test("persist rejects overrides that would overlap the locked Y and recording profile", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  };
  resetDimosControlPrefsCache();
  const user = { id: "u-ctrl", email: "ada@example.com" };
  store.set(dimosControlPrefsKey(user), JSON.stringify({
    headset: "quest3", engage: "primary", gripper: "trigger", start_pause: "tbd",
  }));
  const read = readDimosControlPrefs(user);
  assert.equal(read.engage, "y_map");
  assert.equal(read.gripper, "none");
  assert.equal(read.record, "A");
  assert.equal(read.discard, "B");
  const blocked = persistDimosControlPrefs({ engage: "primary", gripper: "squeeze", record: "B", discard: "A", start: "A", pause: "B" }, user);
  assert.equal(blocked.engage, "y_map");
  assert.equal(blocked.gripper, "none");
  assert.equal(blocked.record, "A");
  assert.equal(blocked.discard, "B");
  const saved = persistDimosControlPrefs({ headset: "quest3s" }, user);
  assert.equal(saved.headset, "quest3s");
  assert.equal(saved.record, "A");
  assert.equal(saved.discard, "B");
  const svg = dimosControlDiagramSvg(saved);
  assert.match(svg, /Quest 3S/);
  assert.match(svg, /Y · tap Calibrate/);
  assert.match(svg, /A · Record \/ Save/);
  assert.match(svg, /B · Discard/);
  assert.doesNotMatch(svg, /Hold both Engage buttons/);
  assert.ok(DIMOS_CONTROL_PROFILES.some((p) => p.id === "quest3"));
  delete globalThis.localStorage;
});

test("bindings snapshot never returns hardcoded unknown", () => {
  resetDimosControlPrefsCache();
  const snap = dimosControlBindingsSnapshot(null, { gamepads: [] });
  assert.equal(snap.bindings.engage.input, "Y");
  assert.equal(snap.bindings.record.input, "A");
  assert.equal(snap.bindings.discard.input, "B");
  assert.equal(snap.bindings.gripper.action, "removed");
  assert.equal(snap.live.trigger, "no_pad");
  assert.notEqual(snap.live.trigger, "unknown");
});

test("Controls popup has locked Y activation and A/B recording, no Gripper select", () => {
  const body = { children: [], appendChild(el) { this.children.push(el); return el; } };
  const prevDoc = globalThis.document;
  globalThis.document = {
    body,
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        className: "",
        innerHTML: "",
        children: [],
        style: {},
        setAttribute() {},
        getAttribute(name) { return this._attrs?.[name] || null; },
        _attrs: {},
        addEventListener() {},
        querySelector(sel) {
          if (sel === "[data-dimos-controls-diagram]") return { innerHTML: "" };
          if (sel === "[data-dimos-engage]") return { value: "y_map", addEventListener() {} };
          if (sel === "[data-dimos-controls-sub]") return { textContent: "" };
          if (sel === "[data-controls-close]") return { addEventListener() {} };
          return null;
        },
        querySelectorAll(sel) {
          if (sel === "[data-dimos-headset]") {
            return DIMOS_CONTROL_PROFILES.map((p) => ({
              getAttribute() { return p.id; },
              classList: { toggle() {} },
              addEventListener() {},
            }));
          }
          return [];
        },
        remove() { body.children = body.children.filter((c) => c !== el); },
      };
      return el;
    },
  };
  try {
    const pop = openDimosControlsPopup({ getUser: () => ({ id: "u1" }) });
    assert.ok(pop);
    assert.equal(dimosControlsPopoverIsOpen(), true);
    assert.match(pop.innerHTML, /Quest 3S/);
    assert.match(pop.innerHTML, /data-dimos-engage/);
    assert.match(pop.innerHTML, /data-dimos-record/);
    assert.match(pop.innerHTML, /data-dimos-discard/);
    assert.match(pop.innerHTML, /A · Record \/ Stop \+ Save/);
    assert.match(pop.innerHTML, /B · Discard/);
    assert.doesNotMatch(pop.innerHTML, /data-dimos-gripper/);
    assert.match(pop.innerHTML, /Grip = HUD grab only/);
    closeDimosControlsPopup();
    assert.equal(dimosControlsPopoverIsOpen(), false);
  } finally {
    globalThis.document = prevDoc;
  }
});

test("Robotics rail auto-activates Robot tab for teleop and keeps compact chrome", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(html, /data-right-panel="robot"/);
  assert.match(html, /id="btn-dimos-teleop-close"/);
  assert.match(html, /id="btn-dimos-robot-config"/);
  assert.match(html, /id="btn-dimos-controls"/);
  assert.doesNotMatch(html, /will not punch :8443/);
  assert.doesNotMatch(html, /Looking for DIMOS/);
  assert.doesNotMatch(html, /Quest DIMOS control from this Studio session/);
  assert.match(css, /data-right-tab="robot"/);
  assert.match(css, /\.right-panel-tab\[data-right-tab="robot"\]/);
  assert.match(css, /#app\.robot-rail-tab \.right-panel-tab\[data-right-tab="robot"\]/);
  assert.match(app, /showRoboticsTabUi/);
  assert.match(app, /closeRobotTeleopPanel/);
  assert.match(app, /createRobotRailTabController/);
  assert.match(app, /20260914-robottab1/);
  assert.match(html, /20260914-robottab1/);
  assert.match(html, /robotauto1/);
});
