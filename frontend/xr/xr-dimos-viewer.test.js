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
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  copyDimosCameraLog,
  dimosCameraDebugLog,
  dimosEpisodeWidgets,
  dimosViewerInnerHtml,
  parseDimosViewerMessage,
  refreshDimosHandCamFrames,
  resetDimosViewer,
  setDimosViewerEpisode,
  shouldShowDimosCameraLog,
  shouldShowDimosViewerUi,
  stopDimosHandCamPoll,
  syncDimosViewerDom,
} from "./xr-dimos-viewer.js?v=roboticsworkspace3";
import {
  getDimosTeleopState,
  resetDimosTeleopOnXrBoundary,
  setDimosTeleopArmed,
  shouldShowDimosViewerUi as teleopShowsViewer,
} from "./xr-dimos-teleop.js?v=roboticsworkspace3-20260915-dimosvr1-20260915-dimosy1-picontrols1-pistopsave1-pitriggerviser2-20260916-yreset1-teleophud1&xrtalk=20260916-1&robotemote=20260916-1&astra=20260916-5&teleopfix=20260916-1&inputfix=20260916-1&yarm1=1";

const here = dirname(fileURLToPath(import.meta.url));

after(() => {
  stopDimosHandCamPoll();
  resetDimosViewer();
  resetDimosTeleopOnXrBoundary();
});

test("Enable Robotics shows the DimOS viewer UI", () => {
  resetDimosTeleopOnXrBoundary();
  assert.equal(shouldShowDimosViewerUi({ armed: false }), false);
  assert.equal(getDimosTeleopState().showViewer, false);
  setDimosTeleopArmed(true);
  assert.equal(teleopShowsViewer({ armed: true }), true);
  assert.equal(getDimosTeleopState().showViewer, true);
  assert.equal(getDimosTeleopState().armed, true);
  resetDimosTeleopOnXrBoundary();
  assert.equal(getDimosTeleopState().showViewer, false);

  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(html, /id="dimos-viewer-root"/);
  assert.match(html, /id="dimos-viewer-robotics"/);
  assert.match(html, /data-dimos-ep-state/);
  assert.match(html, /data-dimos-video/);
  assert.match(html, /Connect robot PC/);
  assert.match(html, /collection HUD/);
  const markup = dimosViewerInnerHtml();
  assert.match(markup, /DimOS Quest teleop/);
  assert.match(markup, /data-dimos-connect-pc/);
  assert.match(markup, /LAST ACTION/);
  assert.match(markup, /No feed/);
  assert.match(markup, /data-dimos-no-feed/);
  assert.match(markup, /data-dimos-copy-log/);
  assert.match(markup, /data-dimos-debug-log/);
  assert.match(markup, /data-dimos-cam-ip/);
  assert.match(markup, /data-dimos-pane="left"/);
  assert.match(markup, /data-dimos-pane="right"/);
  assert.match(markup, /data-dimos-video-right/);
});

test("DimOS camera IP field is a host under the stream heading", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  const markup = dimosViewerInnerHtml();
  const heading = markup.indexOf("DimOS camera stream");
  const camIp = markup.indexOf("data-dimos-cam-ip");
  const frame = markup.indexOf("dimos-camera-frame");
  assert.ok(heading >= 0 && camIp > heading && (frame < 0 || camIp < frame));
  assert.match(html, /data-dimos-cam-ip/);
  assert.match(html, /id="dimos-camera-ip"/);
  assert.match(html, /placeholder="192\.168\.1\.83"/);
  assert.doesNotMatch(html, /id="dimos-camera-ip"[^>]*\/api\/robotics\/hand-cam\//);
  assert.doesNotMatch(html, /data-dimos-cam-ip[^>]*\/api\/robotics\/hand-cam\//);
  assert.doesNotMatch(html, /data-dimos-host-input[^>]*\bfull\b/);
  assert.doesNotMatch(markup, /data-dimos-host-input[^>]*\bfull\b/);
  assert.match(css, /field-sizing:\s*content/);
  assert.match(css, /\.dimos-hug-input/);
  assert.match(css, /\.dimos-camera-split/);
  const log = dimosCameraDebugLog({
    cameraIp: "192.168.1.83",
    wsUrl: "wss://192.168.1.77:8443/ws",
    connected: false,
  });
  assert.match(log, /cam host: 192\.168\.1\.83/);
  assert.match(log, /192\.168\.1\.83/);
  assert.match(log, /no feed/i);
  assert.doesNotMatch(log, /Lowest latency/);
});

test("Robot Teleop sidebar has no Lowest latency wall and a No feed camera", async () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const viewerSrc = readFileSync(join(here, "xr-dimos-viewer.js"), "utf8");
  const robotPanel = html.slice(html.indexOf('id="dimos-teleop-panel"'), html.indexOf('id="edit-panel"'));
  assert.doesNotMatch(robotPanel, /Lowest latency/);
  assert.doesNotMatch(viewerSrc, /policy\.bestPath/);
  assert.doesNotMatch(viewerSrc, /policy\.macPath/);
  const markup = dimosViewerInnerHtml();
  assert.doesNotMatch(markup, /Lowest latency/);
  assert.match(markup, /No feed/);
  assert.match(markup, /data-dimos-no-feed/);
  assert.match(markup, /data-dimos-copy-log/);
  assert.match(html, /data-dimos-no-feed/);
  assert.match(html, /data-dimos-copy-log/);
  assert.match(html, /data-dimos-debug-log/);
  assert.match(html, /20260914-nofeed1/);
  assert.match(html, /20260915-camip1/);
  assert.match(html, /20260915-splitcam1/);
  assert.match(html, /data-dimos-pane="left"/);
  assert.match(html, /data-dimos-pane="right"/);
  assert.doesNotMatch(viewerSrc, /HAND_CAM_PERMISSION_PATH/);
  assert.doesNotMatch(viewerSrc, /\/api\/robotics\/hand-cam\/request-permission/);
  const log = dimosCameraDebugLog({
    label: "Disconnected — DIMOS not running (DIMOS not running)",
    statusKey: "error",
    wsUrl: "wss://192.168.1.77:8443/ws",
    connected: false,
    policy: { reason: "Lowest latency: on the robot PC run dimos" },
  });
  assert.match(log, /no feed/i);
  assert.match(log, /192\.168\.1\.77/);
  assert.doesNotMatch(log, /Lowest latency/);
  const copied = [];
  assert.equal(await copyDimosCameraLog(log, { writeText: async (t) => { copied.push(t); } }), true);
  assert.equal(copied[0], log);
});

test("viewer parses DimOS episode_status and JPEG like teleop.js", () => {
  const parsed = parseDimosViewerMessage(JSON.stringify({
    type: "episode_status",
    state: "recording",
    elapsed_s: 12,
    episodes_saved: 2,
    episodes_discarded: 1,
    last_event: "save",
  }));
  assert.equal(parsed.kind, "episode");
  const snap = setDimosViewerEpisode(parsed.message);
  assert.equal(snap.widgets.state, "RECORDING");
  assert.equal(snap.widgets.saved, "002");
  assert.equal(snap.widgets.discarded, "001");
  assert.equal(snap.widgets.lastAction, "SAVE");
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  assert.equal(parseDimosViewerMessage(jpeg.buffer).kind, "jpeg");
  assert.equal(parseDimosViewerMessage("nope").kind, "ignore");
  const widgets = dimosEpisodeWidgets(null, { offline: true });
  assert.equal(widgets.state, "OFFLINE");
});

test("syncDimosViewerDom unhides mount points only when armed", () => {
  const root = {
    hidden: true,
    classList: { toggle() {} },
    querySelector: () => null,
  };
  const roots = [root];
  const prevDoc = globalThis.document;
  globalThis.document = {
    querySelectorAll: (sel) => (String(sel).includes("data-dimos-viewer") ? roots : []),
    getElementById: () => ({ classList: { toggle() {} } }),
    activeElement: null,
  };
  try {
    syncDimosViewerDom({ armed: false, label: "Off" });
    assert.equal(root.hidden, true);
    syncDimosViewerDom({ armed: true, label: "Connected" });
    assert.equal(root.hidden, false);
    stopDimosHandCamPoll();
  } finally {
    stopDimosHandCamPoll();
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test("DimOS camera view polls both wrists and the head camera independently", async () => {
  resetDimosViewer();
  const jpeg = new Blob([new Uint8Array(120).fill(0xff)], { type: "image/jpeg" });
  const urls = [];
  const snap = await refreshDimosHandCamFrames(async (url) => {
    urls.push(String(url));
    if (String(url).includes("left.jpg")) return { ok: true, blob: async () => jpeg };
    return { ok: false, status: 503, blob: async () => new Blob([]) };
  });
  assert.equal(snap.leftLive, true);
  assert.equal(snap.rightLive, false);
  assert.equal(snap.povLive, false);
  assert.equal(shouldShowDimosCameraLog(snap), true);
  assert.ok(urls.some((u) => u.includes("/api/robotics/hand-cam/left.jpg") && /[?&]t=/.test(u)));
  assert.ok(urls.some((u) => u.includes("/api/robotics/hand-cam/right.jpg") && /[?&]t=/.test(u)));
  assert.ok(urls.some((u) => u.includes("/api/robotics/zed.jpg") && /[?&]t=/.test(u)));
  const log = dimosCameraDebugLog({ cameraIp: "192.168.1.83" }, snap);
  assert.match(log, /left: .*no feed|left: .*live/i);
  assert.match(log, /right: .*no feed/i);
  const both = await refreshDimosHandCamFrames(async (url) => {
    if (String(url).includes(".jpg")) return { ok: true, blob: async () => jpeg };
    return { ok: false };
  });
  assert.equal(both.leftLive, true);
  assert.equal(both.rightLive, true);
  assert.equal(both.povLive, true);
  assert.equal(shouldShowDimosCameraLog(both), false);
  resetDimosViewer();
});
