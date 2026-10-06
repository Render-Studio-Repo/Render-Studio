import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  xrControlsShouldSample,
  xrControlsRingPush,
  xrControlsButtonEdge,
  xrSelectConsumeTarget,
  compactXrGamepadHands,
  compactXrControlRow,
  compactXrInteraction,
  capXrControlsPayload,
  createXrControlsRecorder,
  XR_CONTROLS_MAX_BYTES,
  XR_CONTROLS_MAX_ROWS,
  XR_CONTROLS_BUILD,
} from "./xr-controls-debug.js";

test("button-edge logging only fires on press/consume change", () => {
  assert.equal(xrControlsButtonEdge(null, { tr: 1 }), true);
  assert.equal(xrControlsButtonEdge({ tr: 0, sq: 0, a: 0, b: 0, ax: [0, 0, 0, 0] }, {
    tr: 0, sq: 0, a: 0, b: 0, ax: [0, 0, 0, 0],
  }), false);
  assert.equal(xrControlsButtonEdge({ tr: 0, sq: 0, a: 0, b: 0, ax: [0, 0, 0, 0] }, {
    tr: 1, sq: 0, a: 0, b: 0, ax: [0, 0, 0, 0],
  }), true);
  assert.equal(xrControlsButtonEdge({ tr: 0, c: "miss", ax: [0, 0, 0, 0] }, {
    tr: 0, c: "ui", ax: [0, 0, 0, 0],
  }), true);
  assert.equal(xrControlsButtonEdge({ tr: 0, move: 0, on: [] }, {
    tr: 0, move: 1, on: ["rightAxes"],
  }), true);
  assert.equal(xrControlsButtonEdge({ tr: 0, move: 1, on: ["rightAxes"] }, {
    tr: 0, move: 1, on: ["rightAxes"], ax: [0.9, 0, 0, 0],
  }), false);
});

test("handler consume flags: UI beats DIMOS, Robot-off never steals", () => {
  assert.equal(xrSelectConsumeTarget({ dimosArmed: false, uiHit: true }), "ui");
  assert.equal(xrSelectConsumeTarget({ dimosArmed: true, uiHit: true }), "ui");
  assert.equal(xrSelectConsumeTarget({ dimosArmed: true, uiHit: false, hasPick: true }), "dimos");
  assert.equal(xrSelectConsumeTarget({ dimosArmed: false, hasPick: true }), "pick");
  assert.equal(xrSelectConsumeTarget({ dimosArmed: false, hasPick: false }), "miss");
  assert.equal(xrSelectConsumeTarget({ blocked: "debounce" }), "debounce");
});

test("ring-buffer size cap keeps last N seconds / max rows", () => {
  let rows = [];
  for (let i = 0; i < 200; i += 1) {
    rows = xrControlsRingPush(rows, { t: i * 100, f: 72 }, { maxRows: 80, windowMs: 8000 });
  }
  assert.ok(rows.length <= 80);
  assert.ok(rows.length >= 70);
  assert.ok(rows[rows.length - 1].t - rows[0].t <= 8000);
  assert.equal(xrControlsShouldSample({ lastAt: 0, now: 100, hz: 8 }), false);
  assert.equal(xrControlsShouldSample({ lastAt: 0, now: 130, hz: 8 }), true);
  assert.equal(xrControlsShouldSample({ lastAt: 0, now: 1, edge: true }), true);
});

test("compact payload strips fat fields and stays tens of KB", () => {
  const hands = compactXrGamepadHands([
    {
      handedness: "right",
      targetRayMode: "tracked-pointer",
      gamepad: {
        mapping: "xr-standard",
        buttons: [{ pressed: true, value: 1 }, { pressed: false }, {}, {}, { pressed: false }, { pressed: true }],
        axes: [0, 0, 0.2, -0.4],
      },
    },
  ]);
  assert.equal(hands.r.tr, 1);
  assert.equal(hands.r.b, 1);
  assert.equal(hands.r.move, 1);
  assert.deepEqual(hands.r.on, ["rightTrigger", "rightB", "rightAxes"]);
  const analogGhost = compactXrGamepadHands([{
    handedness: "left",
    targetRayMode: "tracked-pointer",
    gamepad: {
      mapping: "xr-standard",
      buttons: Array.from({ length: 13 }, (_, i) => ({
        pressed: false,
        value: i >= 7 ? 0.9 : 0,
      })),
      axes: [0, 0, 0, 0],
    },
  }]);
  assert.equal(analogGhost.l.tr, 0);
  assert.equal(analogGhost.l.menu, undefined);
  assert.equal(analogGhost.l.x, undefined);
  assert.equal(analogGhost.l.on, undefined);
  const stickMove = compactXrGamepadHands([{
    handedness: "right",
    targetRayMode: "tracked-pointer",
    gamepad: {
      mapping: "xr-standard",
      buttons: Array.from({ length: 8 }, () => ({ pressed: false, value: 0 })),
      axes: [0.8, -0.4, 0, 0],
    },
  }]);
  assert.equal(stickMove.r.move, 1);
  assert.deepEqual(stickMove.r.on, ["rightAxes"]);
  assert.equal(stickMove.r.st, 0);
  const row = compactXrControlRow({ t: 12, fps: 72.12, dt: 13.8, hands, consume: "pick", ev: "sel" });
  assert.equal(row.c, "pick");
  assert.equal(row.r.tr, 1);
  assert.equal(row.hit, "miss");
  assert.equal(compactXrControlRow({ t: 1, fps: 72, dt: 13, hit: "dock", hand: "l" }).hit, "dock");
  assert.equal(compactXrControlRow({ t: 1, fps: 72, dt: 13, hit: "dock", hand: "l" }).h, "l");
  const payload = {
    samples: Array.from({ length: 400 }, (_, i) => ({ t: i, fps: 72, dt: 13, pad: "x".repeat(120) })),
    controls: {
      section: "xr-controls",
      rows: Array.from({ length: 200 }, (_, i) => ({ t: i, f: 72, dt: 13, pad: "y".repeat(120), c: "pick" })),
    },
  };
  const capped = capXrControlsPayload(payload, 12_000);
  const bytes = JSON.stringify(capped).length;
  assert.ok(bytes <= 12_000, `bytes ${bytes}`);
  assert.ok(capped.controls.rows.length < 200);
  assert.ok(bytes <= XR_CONTROLS_MAX_BYTES || 12_000 < XR_CONTROLS_MAX_BYTES);
});

test("recorder ring does not grow without bound", () => {
  const rec = createXrControlsRecorder();
  rec.noteSession({ started: true, mode: "immersive-vr", ref: "local-floor", nSrc: 2, t: 0 });
  for (let i = 0; i < 300; i += 1) {
    rec.noteFrame({
      now: i * 20,
      fps: 72,
      dt: i % 17 === 0 ? 28 : 13,
      dropped: i % 17 === 0,
      throttle: i % 9 === 0,
      consume: i % 40 === 0 ? "pick" : "",
      inputSources: [{
        handedness: "right",
        targetRayMode: "tracked-pointer",
        gamepad: {
          mapping: "xr-standard",
          buttons: [{ pressed: i % 20 === 0, value: i % 20 === 0 ? 1 : 0 }, {}, {}, {}, {}, {}],
          axes: [0, 0, 0, 0],
        },
      }],
    });
  }
  const snap = rec.snapshot();
  assert.equal(snap.section, "xr-controls");
  assert.ok(snap.rows.length <= XR_CONTROLS_MAX_ROWS);
  assert.ok(snap.rows.some((r) => r.hit === "miss" || r.hit === "pick"));
  const json = JSON.stringify({ samples: [], controls: snap });
  assert.ok(json.length < 40_000);
  assert.equal(json.includes("data:image"), false);
  assert.equal(json.includes("base64"), false);
});

function controllerSource(handedness, { trigger = false, squeeze = false } = {}) {
  return {
    handedness,
    targetRayMode: "tracked-pointer",
    gamepad: {
      mapping: "xr-standard",
      buttons: [{ pressed: trigger }, { pressed: squeeze }, {}, {}, {}, {}],
      axes: [0, 0, 0, 0],
    },
  };
}

test("a steady miss at 90 FPS retains seconds of 8 Hz history, with transient edges independent", () => {
  const rec = createXrControlsRecorder();
  rec.noteSession({ started: true, t: 0 });
  for (let frame = 0; frame <= 90 * 37; frame += 1) {
    rec.noteFrame({
      now: frame * 1000 / 90,
      consume: "miss",
      inputSources: [controllerSource("right", { trigger: frame === 3000 })],
    });
  }
  const snap = rec.snapshot();
  assert.equal(snap.build, XR_CONTROLS_BUILD);
  assert.equal(snap.rows.length, XR_CONTROLS_MAX_ROWS);
  assert.ok(snap.rows.at(-1).t - snap.rows[0].t >= 29_000);
  assert.ok(snap.rows.every((row, index) => !index || row.t - snap.rows[index - 1].t >= 124));
  assert.ok(snap.ev.some((row) => row.r?.tr === 1), "one-frame press is kept even between periodic samples");
  assert.ok(snap.ev.some((row) => row.t > 33_333 && row.r?.tr === 0), "release is kept independently");
});

test("left squeeze edges remain visible while right squeeze is held and source loss reports zero", () => {
  const rec = createXrControlsRecorder();
  rec.noteSession({ started: true, t: 0 });
  const right = controllerSource("right", { squeeze: true });
  rec.noteSources([right]);
  rec.noteFrame({ now: 0, consume: "miss", inputSources: [controllerSource("left"), right] });
  rec.noteFrame({ now: 10, consume: "miss", inputSources: [controllerSource("left", { squeeze: true }), right] });
  rec.noteFrame({ now: 20, consume: "miss", inputSources: [controllerSource("left"), right] });
  rec.noteFrame({ now: 130, consume: "miss", inputSources: [] });
  const snap = rec.snapshot();
  assert.ok(snap.ev.some((row) => row.t === 10 && row.l?.sq === 1 && row.r?.sq === 1));
  assert.ok(snap.ev.some((row) => row.t === 20 && row.l?.sq === 0 && row.r?.sq === 1));
  assert.equal(snap.rows.at(-1).n, 0);
  assert.equal(snap.rows.at(-1).t, 130);
});

test("interaction diagnostics accept only bounded labels and finite poses", () => {
  const scene = { circular: null };
  scene.circular = scene;
  const interaction = compactXrInteraction({
    l: { aim: [1.12345, 2, 3, 0, 0, 0, 1], grip: [0, NaN, 0, 0, 0, 0, 1], near: "panel".repeat(30), held: scene, distance: 0.012345, scene },
    r: { hit: "miss", grip: [4, 5, 6, 0, 0, 0, 1] },
    scene,
  });
  assert.deepEqual(interaction.l.aim, [1.123, 2, 3, 0, 0, 0, 1]);
  assert.equal(interaction.l.grip, undefined);
  assert.equal(interaction.l.held, undefined);
  assert.equal(interaction.l.near.length, 64);
  assert.equal(interaction.l.distance, 0.012);
  assert.equal(JSON.stringify(interaction).includes("circular"), false);
  const row = compactXrControlRow({ interaction });
  assert.equal(row.interaction.r.hit, "miss");
});

test("two-hand pose uploads retain at least 25 seconds of controls within 72 KB", () => {
  const rec = createXrControlsRecorder();
  rec.noteSession({ started: true, t: 0 });
  const pose = (frame) => ({
    aim: [0.123 + frame / 100000, 1.432, -0.321, 0.05, -0.05, 0.111, 0.98],
    grip: [0.101 + frame / 100000, 1.4, -0.3, 0.049, -0.051, 0.09, 0.99],
    hit: "miss", near: "xrStudio", distance: 0.041, held: "xrStudio",
  });
  for (let frame = 0; frame <= 90 * 37; frame += 1) {
    rec.noteFrame({
      now: frame * 1000 / 90, fps: 90, dt: 11.111, consume: "miss",
      inputSources: ["left", "right"].map((hand) => controllerSource(hand, { squeeze: frame % 900 < 35 })),
      interaction: { l: pose(frame), r: pose(frame) },
    });
  }
  const original = {
    controls: rec.snapshot(),
    samples: Array.from({ length: 148 }, (_, i) => ({ t: i * 250, fps: 90, dt: 11.1, memMb: 65.2 })),
  };
  assert.ok(JSON.stringify(original).length > XR_CONTROLS_MAX_BYTES);
  const capped = capXrControlsPayload(original);
  const bytes = new TextEncoder().encode(JSON.stringify(capped)).length;
  assert.ok(bytes <= XR_CONTROLS_MAX_BYTES, `upload bytes: ${bytes}`);
  assert.equal(capped._bytes, bytes);
  assert.ok(capped.controls.rows.at(-1).t - capped.controls.rows[0].t >= 25_000);
  assert.ok(capped.controls.rows.slice(-8).every((row) => row.interaction?.l?.grip && row.interaction?.r?.aim));
  assert.deepEqual(capped.controls.ev, original.controls.ev, "all edge details survive pose thinning");
  assert.ok(capped.controls.rows.some((row) => !row.interaction), "older detail is thinned first");
  assert.ok(original.controls.rows.every((row) => row.interaction), "live recorder snapshot is not mutated");
});

test("cache-bust xrdbg2 is merged on the live graph", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const foundry = readFileSync(join(here, "../pages/foundry.html"), "utf8");
  const stats = readFileSync(join(here, "xr-dev-stats.js"), "utf8");
  const token = "20260915-xrdbg2";
  assert.ok(html.includes("xrlog1"));
  assert.ok(html.includes("xrctl1"));
  assert.ok(app.includes("xrctl1"));
  assert.ok(xr.includes("xrctl1"));
  assert.ok(html.includes("20260915-xrctl1"));
  assert.ok(app.includes("20260915-xrctl1"));
  assert.ok(xr.includes("20260915-xrctl1"));
  assert.ok(html.includes(token));
  assert.ok(app.includes(token));
  assert.ok(xr.includes(token));
  assert.ok(foundry.includes(token) || foundry.includes("xrdbg1"));
  assert.ok(xr.includes("aimPosed"));
  assert.ok(xr.includes("fallbackSelectPointer(hand)"));
  assert.ok(xr.includes("XR Controls"));
  assert.ok(foundry.includes("xrctl1"));
  assert.equal(stats.includes("controls.reset("), false);
  assert.ok(stats.includes("Never reset the ring"));
  const sendFn = xr.slice(xr.indexOf("async function sendXrDebugLogToPc"), xr.indexOf("function questBrowserUa"));
  assert.ok(sendFn.includes("shouldUploadXrDebuggerLog"));
  assert.equal(sendFn.includes("startRecording"), false);
  assert.ok(sendFn.includes("snapshot"));
});

 test("Y diagnostics retain bounded action and maps without raw config", () => {
  const recorder = createXrControlsRecorder();
  recorder.noteFrame({now: 1000, teleopY: {build:'y-idle', pressed:true, action:'session_reset', stopPhase:'pending', profileMap:'tap_pause_hold3_kill', liveMap:'x'.repeat(100), secret:'must not persist'}});
  const snapshot = recorder.snapshot();
  assert.equal(snapshot.teleopY.action,'session_reset');
  assert.equal(snapshot.teleopY.liveMap.length,64);
  assert.equal(snapshot.teleopY.secret,undefined);
  recorder.reset(); assert.equal(recorder.snapshot().teleopY,null);
 });
