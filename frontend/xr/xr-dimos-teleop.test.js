import { beforeEach, afterEach } from "node:test";
const originalProfileTestStorage = globalThis.localStorage;
afterEach(() => {globalThis.localStorage = originalProfileTestStorage;});
beforeEach(() => {
  const previous = originalProfileTestStorage;
  globalThis.localStorage = {
    getItem: key => key.startsWith("render3d:roboticsProfile:") ? '{"mode":"studio"}' : previous?.getItem?.(key) || null,
    setItem: (key, value) => previous?.setItem?.(key, value),
    removeItem: key => previous?.removeItem?.(key),
  };
});

test("Pi recording request exposes immediate pending UI and preserves native A/B recording", () => {
  const teleop = readFileSync(join(here, "xr-dimos-teleop.js"), "utf8");
  const workspace = readFileSync(join(here, "xr-robotics-workspace.js"), "utf8");
  assert.match(teleop, /action:'recording_status',recording:true,pending:true,state:'starting'/);
  assert.match(workspace, /pending\?'Starting recording'/);
  assert.match(workspace, /Stop \+ Save/);
  assert.match(workspace, /Discard recording/);
  assert.match(workspace, /Record another take · use Record take/);
  assert.match(teleop, /const piUi = createPiUiInput\(detail =>/);
  assert.doesNotMatch(teleop, /requestFollowStart|requestFollowPause|\{ start: "B", pause: "A" \}/);
  assert.match(teleop, /recording: recordingState\.recording/);
  assert.match(workspace, /state:snap\.recording\?'RECORDING'/);
});

test("clickable discard confirms and pulses the same Pi B channel without opening save", () => {
  const teleop = readFileSync(join(here, "xr-dimos-teleop.js"), "utf8");
  const workspace = readFileSync(join(here, "xr-robotics-workspace.js"), "utf8");
  assert.match(teleop, /Discard this recording\? This cannot be undone\./);
  assert.match(teleop, /mapped\.buttons\[5\] = piDiscardPulse\.sample/);
  assert.match(workspace, /row\('Discard recording',\(\)=>discardDimosRecord\(\)\)/);
  assert.match(workspace, /e\.detail\.discarding\?'Discarding recording'/);
  assert.doesNotMatch(teleop.match(/export function discardDimosRecord[\s\S]*?\n\}/)?.[0] || "", /requestPiRecording\(false\)|showConfirm|dataset/);
});
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIMOS_WS_DEFAULT,
  encodeJoy,
  encodePoseStamped,
  FP_JOY,
  FP_POSE_STAMPED,
  getDimosTeleopState,
  isDimosStealingFaceButtons,
  isDimosStealingGrip,
  isDimosTeleopArmed,
  mapDimosController,
  mapDimosControllerForHand,
  resolveDimosGripperTrigger,
  setDimosTeleopArmed,
  setDimosTeleopPresenting,
  shouldRunDimosTeleopWork,
  tickDimosTeleop,
  pollDimosYControl,
  getDimosYControlDebug,
  startDimosRecord,
  stopDimosRecord,
  playDimosRecord,
  getDimosRecordState,
  setDimosLoop,
  resetDimosTeleopOnXrBoundary,
  DIMOS_STOLEN_WHEN_ARMED,
  studioDimosPipeUrl,
  isStudioDimosPipeUrl,
  normalizeDimosWsInput,
  persistDimosWsUrl,
  formatDimosHostInput,
  dimosQuestTeleopUrl,
  applyDimosRobotPcHost,
  shouldShowDimosViewerUi,
  dimosConnectPolicy,
  DIMOS_WS_STORAGE_KEY,
  DIMOS_ENSURE_PATH,
  DIMOS_COORDINATOR_PATH,
  ensureDimosCoordinatorIfDown,
  detectDimosHeadset,
  refreshDimosCoordinatorWatch,
  selectDimosRobot,
  gateDimosJoyForStudioUi,
  setDimosStudioUiOverride,
  getDimosStudioUiOverride,
  dimosShouldForwardSelect,
  studioUiOverridesDimosSelect,
  dimosQuestWsUrl,
  dimosYCommandUrl,
  inferDimosHardwareMode,
  dimosHardwareStatusLabel,
  isDimosRobotLanHost,
  isDimosBlockingWalk,
  requestDimosSafeHome,
  DIMOS_Y_HOLD_CACHE,
  TELEOP_HUD_CACHE,
} from "./xr-dimos-teleop.js?v=roboticsworkspace3-20260915-dimosvr1-20260915-dimosy1-picontrols1-pistopsave1-pitriggerviser2-20260916-yreset1-teleophud1&xrtalk=20260916-1&robotemote=20260916-1&astra=20260916-5&teleopfix=20260916-1&inputfix=20260916-1&yarm1=1";
import { resetDimosControlPrefsCache } from "./xr-dimos-controls.js";

const here = dirname(fileURLToPath(import.meta.url));

test("gripper resume starts half-open and ignores a trigger held from the paused menu", () => {
  assert.deepEqual(resolveDimosGripperTrigger(1, {following:false, awaitRelease:false}), {
    trigger: 0, awaitRelease: true,
  });
  assert.deepEqual(resolveDimosGripperTrigger(1, {following:true, awaitRelease:true}), {
    trigger: 0, awaitRelease: true,
  });
  assert.deepEqual(resolveDimosGripperTrigger(0, {following:true, awaitRelease:true}), {
    trigger: 0, awaitRelease: false,
  });
  assert.deepEqual(resolveDimosGripperTrigger(0.6, {following:true, awaitRelease:false}), {
    trigger: 0.6, awaitRelease: false,
  });
});

test("DIMOS LCM pose and joy fingerprints match @dimos/msgs packed hashes", () => {
  const pose = encodePoseStamped({
    frameId: "left",
    x: 0.1, y: 0.2, z: 0.3,
    qx: 0, qy: 0, qz: 0, qw: 1,
    nowMs: 1_700_000_000_000,
  });
  const joy = encodeJoy({
    frameId: "right",
    axes: [0, 0, 0.5, 0.1],
    buttons: [0, 0, 0, 0, 1, 0, 0],
    nowMs: 1_700_000_000_000,
  });
  const poseFp = new DataView(pose.buffer).getBigUint64(0, false);
  const joyFp = new DataView(joy.buffer).getBigUint64(0, false);
  assert.equal(poseFp, FP_POSE_STAMPED);
  assert.equal(joyFp, FP_JOY);
  assert.ok(pose.byteLength > 80);
  assert.equal(joy.byteLength, 82);
});

test("mapDimosController puts X/A on buttons[4]", () => {
  resetDimosControlPrefsCache();
  const gp = {
    mapping: "xr-standard",
    axes: [0, 0, 0.2, -0.3],
    buttons: [
      { pressed: false, value: 0.1 },
      { pressed: true, value: 1 },
      { pressed: false, value: 0 },
      { pressed: false, value: 0 },
      { pressed: true, value: 1 },
      { pressed: false, value: 0 },
      { pressed: false, value: 0 },
    ],
  };
  const mapped = mapDimosController(gp);
  assert.equal(mapped.primary, true);
  assert.equal(mapped.buttons[4], 1);
  assert.equal(mapped.buttons.length, 7);
  assert.equal(mapped.axes.length, 4);
  assert.equal(mapped.axes[0], 0.2);
  assert.equal(mapped.axes[3], 1);
});

test("Studio Robot tab is present and default off", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const src = readFileSync(join(here, "xr-dimos-teleop.js"), "utf8");
  assert.match(html, /data-right-tab="robot"/);
  assert.match(html, /data-right-panel="robot"/);
  assert.match(html, /id="btn-dimos-teleop-toggle"/);
  assert.match(html, /id="btn-dimos-robot-config"/);
  assert.match(html, /id="btn-dimos-controls"/);
  assert.match(html, /id="btn-dimos-teleop-close"/);
  assert.match(html, /id="dimos-robot-card-openarm"/);
  assert.match(html, /robotrec1/);
  assert.doesNotMatch(html, /Quest DIMOS control from this Studio session/);
  assert.doesNotMatch(html, /Looking for DIMOS/);
  assert.match(html, /app\.js\?v=[^"\s]*20260908-xr-robotics1/);
  const robotPanel = html.slice(html.indexOf('id="dimos-teleop-panel"'), html.indexOf('id="edit-panel"'));
  assert.doesNotMatch(robotPanel, /requestSession/);
  assert.match(app, /bindDimosTeleopPanel/);
  assert.match(html, /id="dimos-teleop-chart"/);
  assert.match(html, /id="btn-dimos-record"/);
  assert.match(xr, /tickDimosTeleop/);
  assert.match(xr, /isDimosStealingFaceButtons/);
  assert.match(xr, /shouldTickDimosTeleop\(\{/);
  assert.match(xr, /recording: !!rec\.recording/);
  assert.match(xr, /shouldAttachDimosOnXrEnter\(\{ armed: isDimosTeleopArmed\(\) \}\)/);
  assert.match(xr, /shouldEnsureDimosCoordinatorOnXrEnter\(\{ presenting: true \}\)/);
  assert.match(xr, /ensureDimosCoordinatorIfDown/);
  assert.match(xr, /resetDimosTeleopOnXrBoundary\(\)/);
  assert.match(xr, /shouldRunStudioAHold\(\{ armed: stealDimos \}\)/);
  assert.match(xr, /shouldRunStudioGripGrab/);
  assert.match(xr, /isDimosStealingGrip\(\)/);
  assert.match(xr, /studioGripGrabOpts/);
  assert.match(xr, /sourceHasStudioFaceButtons/);
  assert.match(xr, /uiPickBlocksGripGrab/);
  assert.match(app, /xr-dimos-teleop\.js\?v=roboticsworkspace3-20260915-dimosvr1-20260915-dimosy1/);
  assert.match(src, /\/api\/dimos\/ws/);
  assert.match(html, /questpipe1/);
  assert.match(html, /dimostart1/);
  assert.match(src, /\/api\/dimos\/ensure-coordinator/);
  assert.match(xr, /setDimosTeleopArmed\(true, sess\)/);
  assert.match(xr, /xr-dimos-teleop\.js\?v=roboticsworkspace3-20260915-dimosvr1-20260915-dimosy1/);
  assert.equal(DIMOS_STOLEN_WHEN_ARMED.faceButtonIndex, 4);
  assert.deepEqual(DIMOS_STOLEN_WHEN_ARMED.face, ["X", "Y", "A", "B"]);
  assert.equal(DIMOS_STOLEN_WHEN_ARMED.squeeze, false);
  assert.equal(DIMOS_STOLEN_WHEN_ARMED.thumbs, true);
  assert.equal(DIMOS_WS_DEFAULT, "wss://192.168.1.77:8443/ws");
  assert.equal(dimosQuestWsUrl(DIMOS_WS_DEFAULT), "wss://192.168.1.77:8443/ws");
  assert.equal(dimosYCommandUrl(), "https://192.168.1.77:8443/teleop/y");
  assert.equal(isDimosTeleopArmed(), false);
  assert.equal(isDimosStealingFaceButtons(), false);
  assert.equal(getDimosTeleopState().armed, false);
  assert.equal(getDimosTeleopState().statusKey, "off");
  assert.equal(shouldRunDimosTeleopWork({ armed: false }), false);
  assert.equal(shouldRunDimosTeleopWork({ armed: true }), true);
  assert.equal(DIMOS_Y_HOLD_CACHE, "20260916-yreset1-robotemote1-teleopfix1-yarm1");
  assert.equal(TELEOP_HUD_CACHE, "teleophud1");
  assert.equal(isDimosBlockingWalk(), false);
  assert.match(html, /yreset1/);
  assert.match(html, /teleophud1/);
  assert.match(app, /yreset1/);
  assert.match(xr, /isDimosBlockingWalk/);
});

test("integrated Quest teleop uses the authenticated Studio relay instead of Pi certificate trust", () => {
  const src = readFileSync(join(here, "xr-dimos-teleop.js"), "utf8");
  assert.match(src, /openPiTeleopWebSocketRelay/);
  assert.match(src, /transport: "studio-relay"/);
  assert.match(src, /transport: "relay-error"/);
});

test("DIMOS teleop is inert until Activate — no WS, no X/A steal, no 80Hz work", () => {
  const opens = [];
  class FakeWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      opens.push(url);
      this.readyState = FakeWS.CONNECTING;
      this.binaryType = "";
    }
    close() {
      this.readyState = FakeWS.CLOSED;
    }
  }
  const prev = globalThis.WebSocket;
  globalThis.WebSocket = FakeWS;
  try {
    const session = {
      inputSources: [],
      addEventListener() {},
      removeEventListener() {},
    };
    tickDimosTeleop({ renderer: { xr: { getSession: () => session } } });
    setDimosTeleopPresenting(true, session);
    assert.equal(isDimosTeleopArmed(), false);
    assert.equal(isDimosStealingFaceButtons(), false);
    assert.equal(opens.length, 0);
    assert.equal(getDimosTeleopState().connected, false);
  } finally {
    globalThis.WebSocket = prev;
  }
  const src = readFileSync(join(here, "xr-dimos-teleop.js"), "utf8");
  assert.match(src, /const MAX_CONNECT_ATTEMPTS = 1/);
  assert.match(src, /never retry/);
});

test("DIMOS record / play / loop work offline without arming teleop", () => {
  stopDimosRecord();
  startDimosRecord();
  assert.equal(getDimosRecordState().recording, true);
  assert.equal(isDimosTeleopArmed(), false);
  stopDimosRecord();
  assert.equal(getDimosRecordState().recording, false);
  assert.equal(playDimosRecord({ loop: false }), false);
  assert.equal(setDimosLoop(true), false);
});

test("XR enter does not arm DIMOS — leftover Activate is cleared", () => {
  setDimosTeleopArmed(true);
  assert.equal(isDimosTeleopArmed(), true);
  assert.equal(isDimosStealingFaceButtons(), true);
  assert.equal(isDimosStealingGrip(), false);
  resetDimosTeleopOnXrBoundary();
  assert.equal(isDimosTeleopArmed(), false);
  assert.equal(isDimosStealingFaceButtons(), false);
  assert.equal(isDimosStealingGrip(), false);
  assert.equal(getDimosTeleopState().statusKey, "off");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const enterAt = xr.indexOf("resetDimosTeleopOnXrBoundary()");
  const attachAt = xr.indexOf("shouldAttachDimosOnXrEnter({ armed: isDimosTeleopArmed() })");
  const ensureAt = xr.indexOf("shouldEnsureDimosCoordinatorOnXrEnter({ presenting: true })");
  assert.ok(enterAt >= 0 && attachAt > enterAt, "XR enter must disarm before any attach check");
  assert.ok(ensureAt > attachAt, "safe coordinator ensure runs after disarm, without arming");
});

test("left Y tap after XR-enter disarm arms DimOS and opens the Pi pose relay", async () => {
  resetDimosTeleopOnXrBoundary();
  const opens = [];
  class FakeWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      opens.push(url);
      this.readyState = FakeWS.CONNECTING;
    }
    send() {}
    close() { this.readyState = FakeWS.CLOSED; }
  }
  const saved = { WebSocket: globalThis.WebSocket, performance: globalThis.performance, fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  const prevLoc = globalThis.location;
  let now = 1000;
  globalThis.WebSocket = FakeWS;
  globalThis.performance = { now: () => now };
  globalThis.localStorage = {getItem:()=>null,setItem(){},removeItem(){}};
  globalThis.fetch = async url => ({ok:true,json:async()=>String(url)==='/api/teleop/open'
    ?{iframe:'/api/teleop/p/192.168.1.77/8443/teleop'}:{}});
  Object.defineProperty(globalThis,"location",{configurable:true,value:{protocol:"https:",host:"studio.test"}});
  const pad = () => ({ mapping: "xr-standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ pressed: false, value: 0 })) });
  const left = { handedness: "left", gamepad: pad() };
  const session = { inputSources: [left], addEventListener() {}, removeEventListener() {} };
  const renderer = { xr: { getSession: () => session, getReferenceSpace: () => null, getFrame: () => null } };
  try {
    setDimosTeleopPresenting(true, session);
    tickDimosTeleop({ renderer, session });
    left.gamepad.buttons[5] = { pressed: true, value: 1 };
    tickDimosTeleop({ renderer, session });
    now += 80;
    left.gamepad.buttons[5] = { pressed: false, value: 0 };
    tickDimosTeleop({ renderer, session });
    for(let i=0;i<8&&!opens.length;i++)await Promise.resolve();
    assert.equal(isDimosTeleopArmed(), true);
    assert.equal(isDimosStealingFaceButtons(), true);
    assert.deepEqual(opens,["wss://studio.test/api/teleop/p/192.168.1.77/8443/ws"]);
  } finally {
    resetDimosTeleopOnXrBoundary();
    Object.assign(globalThis, saved);
    if(prevLoc===undefined)delete globalThis.location;
    else Object.defineProperty(globalThis,"location",{configurable:true,value:prevLoc});
  }
});

test("signed-out Studio relay falls back to the selected private-LAN Pi socket", async () => {
  resetDimosTeleopOnXrBoundary();
  const opens = [];
  class FakeWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    constructor(url) { opens.push(url); this.readyState = FakeWS.CONNECTING; }
    send() {}
    close() { this.readyState = FakeWS.CLOSED; }
  }
  const saved = {WebSocket:globalThis.WebSocket, fetch:globalThis.fetch, localStorage:globalThis.localStorage};
  const prevLoc = globalThis.location;
  globalThis.WebSocket = FakeWS;
  globalThis.localStorage = {getItem:()=>null,setItem(){},removeItem(){}};
  globalThis.fetch = async () => ({ok:false,status:401,json:async()=>({detail:'Not authenticated'})});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:',host:'studio.test'}});
  const session = {inputSources:[],addEventListener(){},removeEventListener(){}};
  try {
    setDimosTeleopArmed(true, session);
    for (let i=0; i<8 && !opens.length; i++) await Promise.resolve();
    assert.deepEqual(opens, ['wss://192.168.1.77:8443/ws']);
  } finally {
    resetDimosTeleopOnXrBoundary();
    Object.assign(globalThis, saved);
    if (prevLoc === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis,'location',{configurable:true,value:prevLoc});
  }
});

test("idle viewport polls Y and a tap arms DimOS without pose work", () => {
  resetDimosTeleopOnXrBoundary();
  class FakeWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor() {
      this.readyState = FakeWS.CONNECTING;
    }
    send() {}
    close() { this.readyState = FakeWS.CLOSED; }
  }
  const saved = { WebSocket: globalThis.WebSocket, performance: globalThis.performance };
  let now = 1000;
  globalThis.WebSocket = FakeWS;
  globalThis.performance = { now: () => now };
  const pad = () => ({ mapping: "xr-standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ pressed: false, value: 0 })) });
  const left = { handedness: "left", gamepad: pad() };
  const session = { inputSources: [left], addEventListener() {}, removeEventListener() {} };
  const renderer = { xr: { getSession: () => session, getReferenceSpace: () => null, getFrame: () => null } };
  try {
    pollDimosYControl({ renderer, session });
    assert.equal(isDimosTeleopArmed(), false);
    const viewport = readFileSync(join(here, "viewport-xr.js"), "utf8");
    assert.match(viewport, /tickDimosTeleop\(\{ renderer, session: renderer.xr.getSession\?\.\(\) \}\);\s*\} else \{\s*pollDimosYControl/);
    left.gamepad.buttons[5] = { pressed: true, value: 1 };
    pollDimosYControl({ renderer, session });
    now += 80;
    left.gamepad.buttons[5] = { pressed: false, value: 0 };
    pollDimosYControl({ renderer, session });
    assert.equal(isDimosTeleopArmed(), true);
    assert.equal(isDimosStealingFaceButtons(), true);
  } finally {
    resetDimosTeleopOnXrBoundary();
    Object.assign(globalThis, saved);
  }
});

test("disable while Y is held requires release and a fresh tap", () => {
  resetDimosTeleopOnXrBoundary();
  class FakeWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor() {
      this.readyState = FakeWS.CONNECTING;
    }
    send() {}
    close() { this.readyState = FakeWS.CLOSED; }
  }
  const saved = { WebSocket: globalThis.WebSocket, performance: globalThis.performance };
  let now = 1000;
  globalThis.WebSocket = FakeWS;
  globalThis.performance = { now: () => now };
  const pad = () => ({ mapping: "xr-standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ pressed: false, value: 0 })) });
  const left = { handedness: "left", gamepad: pad() };
  const session = { inputSources: [left], addEventListener() {}, removeEventListener() {} };
  const renderer = { xr: { getSession: () => session, getReferenceSpace: () => null, getFrame: () => null } };
  try {
    pollDimosYControl({ renderer, session });
    assert.equal(isDimosTeleopArmed(), false);
    const viewport = readFileSync(join(here, "viewport-xr.js"), "utf8");
    assert.match(viewport, /tickDimosTeleop\(\{ renderer, session: renderer.xr.getSession\?\.\(\) \}\);\s*\} else \{\s*pollDimosYControl/);
    left.gamepad.buttons[5] = { pressed: true, value: 1 };
    pollDimosYControl({ renderer, session });
    setDimosTeleopArmed(true);
    setDimosTeleopArmed(false);
    pollDimosYControl({ renderer, session });
    now += 80;
    left.gamepad.buttons[5] = { pressed: false, value: 0 };
    pollDimosYControl({ renderer, session });
    assert.equal(isDimosTeleopArmed(), false);
    left.gamepad.buttons[5] = { pressed: true, value: 1 };
    now += 80; pollDimosYControl({ renderer, session });
    left.gamepad.buttons[5] = { pressed: false, value: 0 };
    now += 80; pollDimosYControl({ renderer, session });
    assert.equal(isDimosTeleopArmed(), true);
    assert.equal(isDimosStealingFaceButtons(), true);
  } finally {
    resetDimosTeleopOnXrBoundary();
    Object.assign(globalThis, saved);
  }
});

test("unsupported Y hold never falls through to robot activation", () => {
  resetDimosTeleopOnXrBoundary();
  class FakeWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor() {
      this.readyState = FakeWS.CONNECTING;
    }
    send() {}
    close() { this.readyState = FakeWS.CLOSED; }
  }
  const saved = { WebSocket: globalThis.WebSocket, performance: globalThis.performance };
  let now = 1000;
  globalThis.WebSocket = FakeWS;
  globalThis.performance = { now: () => now };
  const pad = () => ({ mapping: "xr-standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ pressed: false, value: 0 })) });
  const left = { handedness: "left", gamepad: pad() };
  const session = { inputSources: [left], addEventListener() {}, removeEventListener() {} };
  const renderer = { xr: { getSession: () => session, getReferenceSpace: () => null, getFrame: () => null } };
  try {
    pollDimosYControl({ renderer, session });
    assert.equal(isDimosTeleopArmed(), false);
    const viewport = readFileSync(join(here, "viewport-xr.js"), "utf8");
    assert.match(viewport, /tickDimosTeleop\(\{ renderer, session: renderer.xr.getSession\?\.\(\) \}\);\s*\} else \{\s*pollDimosYControl/);
    left.gamepad.buttons[5] = { pressed: true, value: 1 };
    pollDimosYControl({ renderer, session });
    now += 3001;
    pollDimosYControl({ renderer, session });
    assert.equal(getDimosYControlDebug().action, "reset_unavailable");
    left.gamepad.buttons[5] = { pressed: false, value: 0 };
    pollDimosYControl({ renderer, session });
    assert.equal(isDimosTeleopArmed(), false);
    assert.equal(isDimosStealingFaceButtons(), false);
  } finally {
    resetDimosTeleopOnXrBoundary();
    Object.assign(globalThis, saved);
  }
});

test("ensureDimosCoordinatorIfDown POSTs without arming or opening a socket", async () => {
  resetDimosTeleopOnXrBoundary();
  const posts = [];
  const opens = [];
  class FakeWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      opens.push(url);
      this.readyState = FakeWS.CONNECTING;
    }
    close() { this.readyState = FakeWS.CLOSED; }
  }
  const prevFetch = globalThis.fetch;
  const prevWS = globalThis.WebSocket;
  globalThis.WebSocket = FakeWS;
  globalThis.fetch = async (url, opts = {}) => {
    posts.push({ url: String(url), method: String(opts.method || "GET") });
    return { ok: true, json: async () => ({ status: "already_running", started: false }) };
  };
  try {
    const info = await ensureDimosCoordinatorIfDown({ session: { inputSources: [] } });
    assert.equal(isDimosTeleopArmed(), false);
    assert.equal(opens.length, 0);
    assert.ok(posts.some((p) => p.url.includes(DIMOS_ENSURE_PATH) && p.method === "POST"));
    assert.equal(info?.status, "already_running");
  } finally {
    globalThis.fetch = prevFetch;
    globalThis.WebSocket = prevWS;
    resetDimosTeleopOnXrBoundary();
  }
});

test("A/grip Studio handlers stay live while DIMOS is off", () => {
  resetDimosTeleopOnXrBoundary();
  assert.equal(isDimosStealingFaceButtons(), false);
  assert.equal(isDimosStealingGrip(), false);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const aHold = xr.indexOf("shouldRunStudioAHold({ armed: stealDimos })");
  const aFace = xr.indexOf("gamepadFacePressed(gp, 4)");
  const gripGate = xr.indexOf("shouldRunStudioGripGrab(");
  const gripUpdate = xr.indexOf("function updateGripGrab()");
  assert.ok(aHold >= 0 && aFace > aHold, "A-hold must be gated on DIMOS steal, not always stolen");
  assert.ok(gripGate >= 0 && gripUpdate >= 0);
  assert.match(xr, /shouldRunStudioGripGrab/);
  assert.ok(xr.includes("studioGripGrabOpts"));
  assert.match(xr, /pollAbButtons/);
});

test("Activate then Turn off restores Studio mappings and previous tool", () => {
  resetDimosTeleopOnXrBoundary();
  setDimosTeleopArmed(true);
  assert.equal(isDimosTeleopArmed(), true);
  assert.equal(isDimosStealingFaceButtons(), true);
  assert.equal(isDimosStealingGrip(), false);
  setDimosTeleopArmed(false);
  assert.equal(isDimosTeleopArmed(), false);
  assert.equal(isDimosStealingFaceButtons(), false);
  assert.equal(isDimosStealingGrip(), false);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.match(xr, /onDimosTeleopChange/);
  assert.match(xr, /nextToolAfterDimosArmChange/);
  assert.match(xr, /toolBeforeDimos/);
});

test("LAN IP and host:8443 normalize to DimOS /ws and persist render3d:dimosWs", () => {
  assert.equal(normalizeDimosWsInput("192.168.1.50"), "wss://192.168.1.50:8443/ws");
  assert.equal(normalizeDimosWsInput("10.0.0.9:8443"), "wss://10.0.0.9:8443/ws");
  assert.equal(normalizeDimosWsInput("wss://172.16.4.8:8443/ws"), "wss://172.16.4.8:8443/ws");
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    const saved = persistDimosWsUrl("192.168.1.50");
    assert.equal(saved, "wss://192.168.1.50:8443/ws");
    assert.equal(store.get(DIMOS_WS_STORAGE_KEY), "wss://192.168.1.50:8443/ws");
  } finally {
    delete globalThis.localStorage;
  }
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(app, /\["robotics", "Robotics"\]/);
  assert.match(app, /data-pref-main-tab=/);
  assert.match(app, /Robot host IP/);
  assert.match(app, /pref-dimos-ws-url/);
  assert.match(app, /persistDimosWsUrl/);
  assert.match(html, /dimoshost1/);
  assert.match(html, /robotip1/);
  assert.match(html, /data-robotics-quest-url/);
  assert.match(html, /data-robotics-quest-copy/);
  assert.match(html, /data-robotics-quest-open/);
  assert.match(html, /acctfly1/);
  assert.match(html, /rowhover1/);
  assert.match(html, /gridauto1/);
});

test("robot host IP formats Quest teleop HTTPS URL", () => {
  assert.equal(formatDimosHostInput("192.168.1.50"), "192.168.1.50");
  assert.equal(formatDimosHostInput("10.0.0.9:9000"), "10.0.0.9:9000");
  assert.equal(formatDimosHostInput("wss://192.168.1.50:8443/ws"), "192.168.1.50");
  assert.equal(dimosQuestTeleopUrl("192.168.1.50"), "https://192.168.1.50:8443/teleop");
  assert.equal(dimosQuestTeleopUrl("10.0.0.9:9000"), "https://10.0.0.9:9000/teleop");
});

test("Studio Quest opens direct Pi wss, not Cloudflare /api/dimos/ws", () => {
  const prevLoc = globalThis.location;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "https:", host: "render3d.app", hostname: "render3d.app", search: "" },
  });
  try {
    const pipe = studioDimosPipeUrl(DIMOS_WS_DEFAULT);
    assert.equal(pipe, "wss://192.168.1.77:8443/ws");
    assert.equal(isStudioDimosPipeUrl(pipe), false);
    assert.equal(isStudioDimosPipeUrl(DIMOS_WS_DEFAULT), false);
    assert.equal(isStudioDimosPipeUrl("wss://render3d.app/api/dimos/ws"), true);
    const custom = studioDimosPipeUrl("wss://127.0.0.1:8443/ws");
    assert.equal(custom, "wss://127.0.0.1:8443/ws");
    assert.doesNotMatch(custom, /\/api\/dimos\/ws/);
  } finally {
    if (prevLoc === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: prevLoc });
  }
});

test("Enable Robotics in a live XR session opens the Studio pipe immediately", () => {
  resetDimosTeleopOnXrBoundary();
  const opens = [];
  class FakeWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      opens.push(url);
      this.readyState = FakeWS.CONNECTING;
      this.binaryType = "";
    }
    close() {
      this.readyState = FakeWS.CLOSED;
    }
  }
  const prev = globalThis.WebSocket;
  const prevLoc = globalThis.location;
  globalThis.WebSocket = FakeWS;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "http:", host: "192.168.1.83:8001", search: "" },
  });
  try {
    const session = {
      inputSources: [],
      addEventListener() {},
      removeEventListener() {},
    };
    setDimosTeleopArmed(true, session);
    assert.equal(isDimosTeleopArmed(), true);
    assert.equal(opens.length, 1);
    assert.equal(opens[0], "wss://192.168.1.77:8443/ws");
    assert.doesNotMatch(opens[0], /\/api\/dimos\/ws/);
  } finally {
    globalThis.WebSocket = prev;
    if (prevLoc === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: prevLoc });
    resetDimosTeleopOnXrBoundary();
  }
});

test("Enable Robotics POSTs /api/dimos/ensure-coordinator with the headset blueprint", async () => {
  resetDimosTeleopOnXrBoundary();
  const posts = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    posts.push({ url: String(url), method: opts.method || "GET", body: opts.body || "" });
    return { ok: true, json: async () => ({ status: "already_up", started: false, up: true }) };
  };
  try {
    const session = {
      mode: "immersive-ar",
      environmentBlendMode: "alpha-blend",
      inputSources: [{ profiles: ["meta-quest-touch-plus"] }],
      addEventListener() {},
      removeEventListener() {},
    };
    assert.equal(detectDimosHeadset({
      session,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64; Quest 3) OculusBrowser/36.0",
    }), "quest");
    setDimosTeleopArmed(true, session);
    await new Promise((r) => setTimeout(r, 0));
    const ensure = posts.find((p) => p.url.includes(DIMOS_ENSURE_PATH) && p.method === "POST");
    assert.ok(ensure, "expected POST /api/dimos/ensure-coordinator");
    const body = JSON.parse(ensure.body);
    assert.equal(body.headset, "quest");
    assert.equal(body.blueprint, "teleop-quest-openarm");
  } finally {
    globalThis.fetch = prevFetch;
    resetDimosTeleopOnXrBoundary();
  }
});

test("Pi LAN is real CAN even if the Mac coordinator reports mock", async () => {
  assert.equal(isDimosRobotLanHost("192.168.1.77"), true);
  assert.equal(isDimosRobotLanHost("127.0.0.1"), false);
  assert.equal(isDimosRobotLanHost("192.168.1.83"), false);
  assert.equal(inferDimosHardwareMode({
    coordinatorMode: "mock",
    wsUrl: "wss://192.168.1.77:8443/ws",
  }), "can");
  assert.equal(inferDimosHardwareMode({
    coordinatorMode: "mock",
    wsUrl: "wss://127.0.0.1:8443/ws",
  }), "mock");
  assert.equal(inferDimosHardwareMode({
    teleopStatus: { adapter_type: "mock_whole_body" },
    wsUrl: "wss://192.168.1.77:8443/ws",
  }), "mock");
  assert.equal(dimosHardwareStatusLabel({ statusKey: "connected", hardwareMode: "mock" }), "Open Arm · mock / no CAN");
  assert.equal(dimosHardwareStatusLabel({ statusKey: "connected", hardwareMode: "can" }), "Open Arm · Connected (CAN)");
  const prevFetch = globalThis.fetch;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  };
  persistDimosWsUrl("wss://192.168.1.77:8443/ws");
  globalThis.fetch = async (url) => {
    if (String(url).includes(DIMOS_COORDINATOR_PATH)) {
      return {
        ok: true,
        json: async () => ({
          up: true,
          process: true,
          port: 8443,
          robot: "Open Arm",
          robot_id: "openarm",
          hardware_id: "openarm",
          hardware_mode: "mock",
          recognized: true,
          blueprint: "teleop-quest-openarm",
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };
  try {
    selectDimosRobot("openarm");
    await refreshDimosCoordinatorWatch();
    const snap = getDimosTeleopState();
    assert.equal(snap.recognized, true);
    assert.equal(snap.robotName, "Open Arm");
    assert.equal(snap.hardwareMode, "can");
    assert.equal(snap.coordinatorUp, true);
    const src = readFileSync(join(here, "xr-dimos-teleop.js"), "utf8");
    assert.match(src, /!profile && yFollowActive && currentHardwareMode\(\) !== 'mock'/);
    assert.match(src, /mapped\.buttons\[4\] = 1/);
    assert.match(src, /20260915-dimosy1/);
  } finally {
    globalThis.fetch = prevFetch;
    delete globalThis.localStorage;
    resetDimosTeleopOnXrBoundary();
  }
});

test("normalizeDimosWsInput accepts LAN host and default :8443/ws", () => {
  assert.equal(normalizeDimosWsInput("192.168.1.77"), "wss://192.168.1.77:8443/ws");
  assert.equal(normalizeDimosWsInput("192.168.1.77:8443"), "wss://192.168.1.77:8443/ws");
  assert.equal(normalizeDimosWsInput("wss://192.168.1.77:8443/ws"), DIMOS_WS_DEFAULT);
  assert.equal(normalizeDimosWsInput("192.168.1.83"), "wss://192.168.1.83:8443/ws");
  assert.equal(normalizeDimosWsInput(""), DIMOS_WS_DEFAULT);
  assert.equal(normalizeDimosWsInput("8.8.8.8:8443"), DIMOS_WS_DEFAULT);
});

test("Enable Robotics exposes the DimOS viewer and Connect robot PC", () => {
  resetDimosTeleopOnXrBoundary();
  assert.equal(shouldShowDimosViewerUi({ armed: false }), false);
  setDimosTeleopArmed(true);
  assert.equal(getDimosTeleopState().showViewer, true);
  assert.equal(shouldShowDimosViewerUi({ armed: true }), true);
  resetDimosTeleopOnXrBoundary();
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(html, /data-dimos-viewer/);
  assert.match(html, /btn-dimos-connect-pc/);
  assert.match(html, /20260909-dimosui1/);
});

test("render3d.app Enable Robotics opens direct Pi wss, not a Cloudflare pipe", () => {
  resetDimosTeleopOnXrBoundary();
  const opens = [];
  class FakeWS {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor(url) {
      opens.push(url);
      this.readyState = FakeWS.CONNECTING;
    }
    close() { this.readyState = 3; }
  }
  const prev = globalThis.WebSocket;
  const prevLoc = globalThis.location;
  globalThis.WebSocket = FakeWS;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "https:", host: "render3d.app", hostname: "render3d.app", search: "" },
  });
  try {
    const session = { inputSources: [], addEventListener() {}, removeEventListener() {} };
    setDimosTeleopArmed(true, session);
    assert.equal(studioDimosPipeUrl(DIMOS_WS_DEFAULT), "wss://192.168.1.77:8443/ws");
    assert.equal(dimosConnectPolicy(globalThis.location, DIMOS_WS_DEFAULT).canProxy, true);
    assert.ok(opens.every((u) => String(u) === "wss://192.168.1.77:8443/ws"));
    assert.ok(!opens.some((u) => String(u).includes("/api/dimos/ws")));
    assert.doesNotMatch(getDimosTeleopState().label || "", /Cloud cannot reach LAN DimOS/);
    assert.match(readFileSync(join(here, "../index.html"), "utf8"), /20260915-dimosvr1/);
  } finally {
    globalThis.WebSocket = prev;
    if (prevLoc === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: prevLoc });
    resetDimosTeleopOnXrBoundary();
  }
});

test("applyDimosRobotPcHost persists LAN host for the proxy", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  };
  const prevLoc = globalThis.location;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "http:", host: "192.168.1.20:8001", hostname: "192.168.1.20", search: "" },
  });
  try {
    const next = applyDimosRobotPcHost("192.168.1.44");
    assert.equal(next, "wss://192.168.1.44:8443/ws");
    assert.equal(store.get(DIMOS_WS_STORAGE_KEY), "wss://192.168.1.44:8443/ws");
  } finally {
    delete globalThis.localStorage;
    if (prevLoc === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: prevLoc });
  }
});

test("DimOS teleop does not swallow select when a live UI hit exists", () => {
  resetDimosTeleopOnXrBoundary();
  resetDimosControlPrefsCache();
  const gp = {
    mapping: "xr-standard",
    axes: [0, 0, 0, 0],
    buttons: [
      { pressed: true, value: 1 },
      { pressed: false, value: 0 },
      { pressed: false, value: 0 },
      { pressed: false, value: 0 },
      { pressed: false, value: 0 },
      { pressed: false, value: 0 },
      { pressed: false, value: 0 },
    ],
  };
  const mapped = mapDimosController(gp);
  assert.equal(mapped.buttons[0], 1);
  assert.ok(mapped.axes[2] > 0.9);
  const gated = gateDimosJoyForStudioUi(mapped, { uiHit: true });
  assert.equal(gated.buttons[0], 0);
  assert.equal(gated.axes[2], 0);
  const armedJoy = gateDimosJoyForStudioUi(mapped, { uiHit: false, nearMenu: false });
  assert.equal(armedJoy.buttons[0], 1);
  assert.equal(studioUiOverridesDimosSelect({ uiHit: true }), true);
  assert.equal(dimosShouldForwardSelect({ uiHit: true }), false);
  assert.equal(dimosShouldForwardSelect({ nearMenu: true }), false);
  assert.equal(dimosShouldForwardSelect({ uiHit: false, nearMenu: false }), true);
  setDimosStudioUiOverride({ uiHit: true, left: true, right: false, nearMenuLeft: true });
  assert.equal(getDimosStudioUiOverride().left, true);
  assert.equal(dimosShouldForwardSelect({
    uiHit: getDimosStudioUiOverride().uiHit,
    nearMenu: getDimosStudioUiOverride().nearMenuLeft,
  }), false);

  const src = readFileSync(join(here, "xr-dimos-teleop.js"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(src, /gateDimosJoyForStudioUi/);
  assert.match(src, /dimosShouldForwardSelect/);
  assert.match(src, /setDimosStudioUiOverride/);
  assert.match(src, /if \(!dimosShouldForwardSelect\(gate\)\) return/);
  assert.ok(xr.includes("setDimosStudioUiOverride"));
  assert.ok(xr.includes("stopImmediatePropagation"));
  assert.ok(xr.includes("publishDimosStudioUiOverride"));
  assert.ok(html.includes("20260909-vrbtn1"));
  assert.ok(app.includes("20260909-vrbtn1"));
  assert.ok(src.includes("roboticsworkspace3"));
  resetDimosTeleopOnXrBoundary();
});

test("DIMOS coordinator watch does not start on panel bind", () => {
  const src = readFileSync(join(here, "xr-dimos-teleop.js"), "utf8");
  assert.doesNotMatch(src, /startDimosCoordinatorWatch\(\);\s*robotCard\?\.addEventListener/);
  assert.match(src, /Do not poll \/api\/dimos\/coordinator on every page load/);
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(app, /refreshLiveRobot\?\.\(\{ network: false \}\)/);
});


test('locked trigger mapping is gated and held until release per hand', async () => {
  const controlsUrl = readFileSync(join(here, 'xr-dimos-teleop.js'), 'utf8').match(/from ["'](\.\/xr-dimos-controls\.js[^"']*)["']/)[1];
  const controls = await import(controlsUrl);
  controls.resetDimosControlPrefsCache();
  assert.equal(controls.persistDimosControlPrefs({gripper:'trigger'}).gripper, 'none');
  const gp={mapping:'xr-standard',axes:[0,0,0.25,-0.5],buttons:Array.from({length:7},()=>({pressed:false,value:0}))};
  gp.buttons[0]={pressed:true,value:1};gp.buttons[1]={pressed:true,value:0.65};gp.buttons[4]={pressed:true,value:1};
  setDimosTeleopArmed(true);
  try {
    setDimosStudioUiOverride({left:true,right:false});
    let left=mapDimosControllerForHand(gp,'left');
    assert.equal(left.axes[2],0); assert.equal(left.buttons[0],0);
    assert.equal(left.axes[3],0.65);assert.equal(left.buttons[1],1);
    assert.equal(left.buttons[4],1);assert.equal(left.axes[0],0.25);
    assert.equal(mapDimosControllerForHand(gp,'right').axes[2],1);
    setDimosStudioUiOverride({});
    assert.equal(mapDimosControllerForHand(gp,'left').axes[2],0);
    gp.buttons[0]={pressed:false,value:0};mapDimosControllerForHand(gp,'left');
    gp.buttons[0]={pressed:true,value:1};
    assert.equal(mapDimosControllerForHand(gp,'left').axes[2],1);
  } finally {resetDimosTeleopOnXrBoundary(); controls.persistDimosControlPrefs({gripper:'squeeze'});}
});
