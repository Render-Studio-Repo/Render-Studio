import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  xrSharePanelLines,
  printerVolumeBoxM,
  rightStickShareArmed,
  shareThrowFlight,
  xrShareXHref,
  DISCORD_VR_HREF,
  printSettingsLines,
  applyPrintSettingAction,
  printStartPayload,
  printerFenceFromCorners,
  printerFencePointFromRay,
  printerFenceFloorY,
  packPrinterBoxMessage,
  isLeftoverAutoPrinterFence,
  THROW_PRINT_CACHE,
  PRINT_BOX_CACHE,
  applyPrinterConfigFields,
  printerConfigFromStorage,
  printerSendPcPayload,
  createBounderFence,
  printerShareIconVisible,
  PRINT_TAB_CACHE,
  PRINT_BOX2_CACHE,
  normalizePrinterFence,
  readPrinterFence,
  writePrinterFence,
} from "./xr-share-print.js";
import {
  xrThumbstickClicked,
  shareThrowArmed,
  pickShareThrowTarget,
  shareThrowPoseAt,
  printerVolumeFromProfile,
} from "./xr-share-throw.js";

test("share sheet includes friends search discord X bambu and print toggles", () => {
  const lines = xrSharePanelLines({
    friends: [{ id: "ada", display_name: "Ada" }],
    roomPrintTargets: [{ id: "lee", display_name: "Lee" }],
    includeDiscord: true,
    includeX: true,
  });
  const ids = lines.map((l) => l.id);
  assert.ok(ids.includes("share-friend:ada"));
  assert.ok(ids.includes("share-search"));
  assert.ok(ids.includes("share-discord"));
  assert.ok(ids.includes("share-x"));
  assert.ok(ids.includes("share-bambu"));
  assert.ok(ids.includes("print-send:lee"));
  assert.ok(ids.includes("printer_accept"));
});

test("printer volume requires Context Lab mm and does not invent a box", () => {
  assert.equal(printerVolumeBoxM([]), null);
  assert.equal(printerVolumeFromProfile({}), null);
  const box = printerVolumeBoxM([256, 256, 256]);
  assert.ok(Math.abs(box.x - 0.256) < 1e-6);
});

test("right stick share lock is thumbstick click buttons[3]", () => {
  const gp = {
    mapping: "xr-standard",
    buttons: [{}, {}, {}, { pressed: true }, {}, {}],
    axes: [0, 0, 0, 0],
  };
  assert.equal(xrThumbstickClicked(gp), true);
  assert.equal(shareThrowArmed({ squeezing: true, thumbstickIn: true }), true);
  assert.equal(rightStickShareArmed({ buttons: [{}, {}, {}, { pressed: true }], axes: [0, 0, -0.1, 0] }), true);
});

test("throw dive collapses scale near the target", () => {
  const mid = shareThrowFlight({ from: { x: 0, y: 1, z: 0 }, to: { x: 2, y: 1, z: -1 }, t: 0.4 });
  const end = shareThrowPoseAt(1, [0, 1, 0], [2, 1, -1]);
  assert.ok(mid.scale > 0.5);
  assert.ok(end.scale < 0.2);
});

test("print settings are PETG or PLA plus supports", () => {
  const lines = printSettingsLines({ filament: "PETG", supports: false });
  const ids = lines.map((l) => l.id);
  assert.ok(ids.includes("print-fil:PETG"));
  assert.ok(ids.includes("print-fil:PLA"));
  assert.ok(ids.includes("print-supports"));
  assert.ok(ids.includes("print-start"));
  const next = applyPrintSettingAction({ filament: "PETG", supports: false }, "print-fil:PLA");
  assert.equal(next.filament, "PLA");
  const payload = printStartPayload({ filament: "pla", supports: true, filename: "part.glb" });
  assert.equal(payload.filament, "PLA");
  assert.equal(payload.supports_enabled, true);
  assert.equal(THROW_PRINT_CACHE, "throwprint1");
  assert.equal(PRINT_BOX_CACHE, "xrperf3");
});

test("printer fence is created from two corners and packs for the room", () => {
  assert.ok(printerFenceFloorY(1.6) < 0.2);
  const a = printerFencePointFromRay({ origin: { x: 0, y: 0.82, z: -1.1 }, direction: { x: 0, y: -1, z: -1 } });
  assert.ok(a);
  assert.ok(Math.abs(a.y - 0.82) < 0.06, "passthrough corner stays at the controller, not a floor plane");
  const fence = printerFenceFromCorners({ x: 0, y: 0.1, z: 0 }, { x: 0.4, y: 0.36, z: -0.3 });
  assert.ok(fence);
  assert.ok(Math.abs(fence.size[0] - 0.4) < 1e-6);
  assert.equal(fence.userDrawn, true);
  const msg = packPrinterBoxMessage(fence);
  assert.equal(msg.type, "xr.printer");
  assert.equal(msg.object_id, "printer-box");
  const mid = printerFencePointFromRay({ origin: { x: 0, y: 1.4, z: 0 }, direction: { x: 0, y: 0, z: -1 } });
  assert.ok(Math.abs(mid.y - 1.4) < 0.06);
  const placed = printerFenceFromCorners({ x: 0.2, y: 0.8, z: -1.2 }, { x: 0.21, y: 0.81, z: -1.21 });
  assert.equal(placed, null);
  assert.equal(isLeftoverAutoPrinterFence({ size: [0.256, 0.256, 0.256], position: [0.55, 0.128, -0.72] }), true);
  assert.equal(isLeftoverAutoPrinterFence({ size: [0.4, 0.4, 0.4], position: [0.2, 0.9, -1.1], userDrawn: true }), false);
});

test("share throw picks an accepting user in front", () => {
  const hit = pickShareThrowTarget({
    origin: [0, 1.5, 0],
    forward: [0, 0, -1],
    users: [{ id: "ada", display_name: "Ada", pos: [0, 1.5, -2], accept_sends: true }],
  });
  assert.equal(hit?.id, "ada");
});

test("cache-bust throwprint1 is on the print/throw graph", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../studio/app.js", import.meta.url), "utf8");
  const xr = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");
  assert.match(html, /app\.js\?v=.*throwprint1/);
  assert.match(app, /viewport-xr\.js\?v=.*throwprint1/);
  assert.match(xr, /xr-share-print\.js\?v=.*throwprint1/);
  assert.match(xr, /xr-share-throw\.js\?v=.*throwprint1/);
  assert.match(xr, /printbox1/);
  assert.match(app, /printbox1/);
  assert.match(html, /printbox1/);
  assert.match(html, /xrperf3/);
  assert.match(app, /xrperf3/);
  assert.match(xr, /xrperf3/);
  assert.ok(xr.includes("grippingThrowMesh"));
  assert.ok(xr.includes("LineDashedMaterial"));
  assert.ok(xr.includes("openPrintSettingsPopup"));
  assert.ok(xr.includes("beginPrinterFencePlace"));
  assert.ok(xr.includes("printer-fence"));
  assert.match(app, /printer_start/);
});

test("printer Config writes shared prefs and Send to PC opens the desktop popup path", () => {
  assert.equal(PRINT_TAB_CACHE, "printtab=20260916-1");
  assert.equal(PRINT_BOX2_CACHE, "printbox=20260916-2");
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const saved = applyPrinterConfigFields(storage, {
    lan_ip: "192.168.1.40",
    access_code: "24681357",
    serial: "ABC123",
    name: "P1S",
    accept_sends: true,
    show_outline: true,
  });
  assert.equal(saved.lan_ip, "192.168.1.40");
  assert.equal(saved.access_code, "24681357");
  assert.equal(printerConfigFromStorage(storage).access_code, "24681357");
  assert.equal(printerShareIconVisible({ acceptSends: true }), true);
  assert.deepEqual(printerSendPcPayload({ focus: "pin" }), {
    type: "printer_send_pc",
    open: "printer-config",
    focus: "pin",
  });
  const existing = { size: [0.3, 0.4, 0.3], position: [0.2, 0.5, -0.8], userDrawn: true };
  const again = createBounderFence({ existing, head: { x: 0, y: 1.5, z: 0, forwardX: 0, forwardZ: -1 } });
  assert.deepEqual(again.size, existing.size);
  assert.equal(again.userDrawn, true);
  const fresh = createBounderFence({ head: { x: 0, y: 1.5, z: 0, forwardX: 0, forwardZ: -1 } });
  assert.equal(fresh.userDrawn, true);
  assert.ok(fresh.size[0] > 0);
  const app = readFileSync(new URL("../studio/app.js", import.meta.url), "utf8");
  const xr = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");
  const hud = readFileSync(new URL("./xr-robotics-hud.js", import.meta.url), "utf8");
  assert.match(app, /printer_send_pc/);
  assert.match(app, /openRoboticsPrinterConfigPopup/);
  assert.match(app, /printtab=20260916-1/);
  assert.match(xr, /sendPrinterConfigToPc/);
  assert.match(xr, /createOrShowPrinterBounder/);
  assert.match(hud, /Send to PC/);
  assert.match(hud, /printer-bounder/);
});

test("printer fence persists a normalized pinned world pose", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const saved = writePrinterFence(storage, {
    size: [0.3, 0.4, 0.5], position: [1, 2, -3],
    quaternion: [0, 2, 0, 2], pinned: true, userDrawn: true,
  });
  assert.equal(saved.pinned, true);
  assert.deepEqual(saved.quaternion.map((n) => Number(n.toFixed(6))), [0, 0.707107, 0, 0.707107]);
  assert.deepEqual(readPrinterFence(storage), saved);
  assert.equal(normalizePrinterFence({ size: [1, 1, 1], position: [0, 0, 0] }).pinned, undefined);
});

test("discord and X have real in-VR URLs", () => {
  assert.ok(DISCORD_VR_HREF.includes("discord.com"));
  assert.ok(xrShareXHref({ url: "https://example.com", title: "Hi" }).includes("twitter.com/intent/tweet"));
});
