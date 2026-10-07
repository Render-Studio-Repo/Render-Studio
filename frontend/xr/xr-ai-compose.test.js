import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiHitBlockedByModelPicker,
  applyKeyboardKey,
  keyboardHit,
  keyboardLayout,
  loadingScreenHit,
  loadingScreenLayout,
  mcmasterThumbUrl,
  modelPickerHit,
  modelPickerLayout,
  progressHit,
  promptFieldHit,
} from "./xr-ai-compose.js";

const chatgptOpts = [
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { value: "gpt-6-astra", label: "GPT-6 Astra" },
  { value: "gpt-6-astra-pro", label: "GPT-6 Astra Pro" },
];

test("XR model picker lays out every subscription model as a hittable row", () => {
  const layout = modelPickerLayout({
    width: 1080,
    height: 1280,
    modelY: 494,
    rowH: 56,
    options: chatgptOpts,
  });
  assert.equal(layout.rows.length, 5);
  assert.deepEqual(layout.rows.map((r) => r.value), chatgptOpts.map((o) => o.value));
  const astra = layout.rows.find((r) => r.value === "gpt-6-astra");
  const hit = modelPickerHit(rowCenterX(astra), astra.y + 10, layout);
  assert.equal(hit?.id, "model:gpt-6-astra");
  const sol = layout.rows[0];
  assert.equal(modelPickerHit(rowCenterX(sol), sol.y + 8, layout)?.id, "model:gpt-5.6-sol");
});

test("open picker blocks TYPE/SPEED/Run meshes but not model rows", () => {
  assert.equal(aiHitBlockedByModelPicker("mode:v2", true), true);
  assert.equal(aiHitBlockedByModelPicker("speed:fast", true), true);
  assert.equal(aiHitBlockedByModelPicker("run", true), true);
  assert.equal(aiHitBlockedByModelPicker("model:gpt-6-astra", true), false);
  assert.equal(aiHitBlockedByModelPicker("model", true), false);
  assert.equal(aiHitBlockedByModelPicker("hide", true), false);
  assert.equal(aiHitBlockedByModelPicker("run", false), false);
});

test("picker overlay click is chrome, not the first model only", () => {
  const layout = modelPickerLayout({
    width: 1080,
    height: 1280,
    modelY: 494,
    options: chatgptOpts,
  });
  const missY = layout.overlayY + layout.overlayH - 8;
  const chrome = modelPickerHit(540, missY, layout);
  assert.equal(chrome?.id, "model_chrome");
});

function rowCenterX(row) {
  return row.x + row.w / 2;
}

test("prompt field and progress strip are hittable", () => {
  assert.equal(promptFieldHit(250, 140, { x: 230, y: 100, w: 810, h: 176 })?.id, "type");
  assert.equal(promptFieldHit(10, 10, { x: 230, y: 100, w: 810, h: 176 }), null);
  assert.equal(progressHit(540, 860, { x: 40, y: 840, w: 1000, h: 44 })?.id, "progress");
  assert.equal(progressHit(540, 10, { x: 40, y: 840, w: 1000, h: 44 }), null);
});

test("XR keyboard types, backspaces, and Done closes", () => {
  const layout = keyboardLayout({ width: 1080, height: 420, shift: false });
  const q = layout.keys.find((k) => k.key === "q");
  assert.ok(q);
  assert.equal(keyboardHit(q.x + 4, q.y + 4, layout)?.key, "q");
  assert.equal(applyKeyboardKey("he", "q").draft, "heq");
  assert.equal(applyKeyboardKey("he", "shift", { shift: false }).shift, true);
  assert.equal(applyKeyboardKey("he", "q", { shift: true }).draft, "heQ");
  assert.equal(applyKeyboardKey("cat", "back").draft, "ca");
  assert.equal(applyKeyboardKey("hi", "space").draft, "hi ");
  assert.equal(applyKeyboardKey("ok", "done").action, "done");
});

test("loading screen hit map covers McMaster chrome and close", () => {
  const layout = loadingScreenLayout({
    parts: [{ part_number: "91251A194", description: "SHCS" }],
  });
  assert.equal(loadingScreenHit(layout.close.x + 10, layout.close.y + 10, layout)?.id, "load_close");
  assert.equal(loadingScreenHit(40, 40, layout)?.id, "load_drag");
  assert.equal(mcmasterThumbUrl({ thumb_url: "/thumbs/a.png" }), "/thumbs/a.png");
  assert.ok(mcmasterThumbUrl({ filename: "91251A194.png" }, { projectId: "abc" }).includes("91251A194.png"));
});
