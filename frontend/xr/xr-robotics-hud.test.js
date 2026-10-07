import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROBOTICS_CANVAS,
  ROBOTICS_PLANE,
  paintRoboticsHud,
  pickRoboticsHud,
  roboticsLayout,
  roboticsStatusLabel,
  isRoboticsHudKind,
  roboticsCanvasPxFromHit,
  teleopModeChip,
  teleopHudChips,
  teleopHudSignature,
  paintTeleopVisorHud,
  TELEOP_HUD_CACHE,
  ROBOTICS_MENU_TABS,
  roboticsEmoteHitId,
  rightControllerRecordingUi,
} from "./xr-robotics-hud.js?v=roboticsworkspace3-20260915-dimosy1-picontrols1-pistopsave1-pitriggerviser2-yreset1-teleophud1&robotemote=20260916-1";

function stubCtx() {
  return {
    fillRect() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    strokeRect() {},
    drawImage() {},
    fillText() {},
    strokeText() {},
    font: "",
    textAlign: "left",
    textBaseline: "middle",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "round",
  };
}

test("Robotics HUD status and picks", () => {
  assert.equal(roboticsStatusLabel({ statusKey: "off" }), "Off");
  assert.equal(roboticsStatusLabel({ statusKey: "engaged" }), "ENGAGED");
  assert.equal(roboticsStatusLabel({ statusKey: "error" }), "DIMOS not running");
  assert.equal(
    roboticsStatusLabel({ statusKey: "off", recognized: true, robotName: "Open Arm", hardwareMode: "mock" }),
    "Open Arm · mock / no CAN",
  );
  assert.equal(
    roboticsStatusLabel({ statusKey: "connected", robotName: "Open Arm", hardwareMode: "mock" }),
    "Open Arm · mock / no CAN",
  );
  assert.equal(
    roboticsStatusLabel({ statusKey: "connected", robotName: "Open Arm", hardwareMode: "can" }),
    "Open Arm · Connected (CAN)",
  );
  const enable = pickRoboticsHud(80, 120, { armed: false });
  assert.equal(enable?.id, "enable");
  const disable = pickRoboticsHud(ROBOTICS_CANVAS.w - 80, 120, { armed: true });
  assert.equal(disable?.id, "disable");
  const layout = roboticsLayout(ROBOTICS_CANVAS, { armed: true, showViewer: true });
  const rec = pickRoboticsHud(layout.record.x + 8, layout.record.y + 8, { armed: true, showViewer: true });
  assert.ok(["record", "stop", "play", "loop"].includes(rec?.id) || rec?.kind === "robotics-chrome");
  const connect = pickRoboticsHud(layout.connect.x + 8, layout.connect.y + 8, { armed: true, showViewer: true });
  assert.equal(connect?.id, "connect");
  const camera = pickRoboticsHud(layout.camera.x + 8, layout.camera.y + 8, { cameraHost: "192.168.1.83" });
  assert.equal(camera?.id, "camera");
  const wrist = pickRoboticsHud(layout.camWrist.x + 8, layout.camWrist.y + 8, { camMode: "wrist" });
  assert.equal(wrist?.id, "cam-wrist");
  const move = pickRoboticsHud(layout.camMove.x + 8, layout.camMove.y + 8, { camMode: "detach" });
  assert.equal(move?.id, "cam-move");
  const vrScene = pickRoboticsHud(layout.camVr.x + 8, layout.camVr.y + 8, { vrScene: true });
  assert.equal(vrScene?.id, "cam-vr");
  const term = pickRoboticsHud(ROBOTICS_CANVAS.w - 220, 32, {});
  assert.equal(term?.id, "terminal");
});

test("Robotics hit kinds stay robotics-* and UV fallback maps Enable", () => {
  const enable = pickRoboticsHud(80, 120, { armed: false });
  assert.equal(enable?.kind, "robotics-action");
  assert.equal(enable?.id, "enable");
  assert.equal(isRoboticsHudKind(enable?.kind), true);
  assert.equal(isRoboticsHudKind("menu-tab"), false);
  const mid = roboticsCanvasPxFromHit({ uv: { x: 0.5, y: 0.5 } }, ROBOTICS_PLANE, ROBOTICS_CANVAS);
  assert.equal(mid?.x, ROBOTICS_CANVAS.w / 2);
  assert.equal(mid?.y, ROBOTICS_CANVAS.h / 2);
  const fromLocal = roboticsCanvasPxFromHit({ local: { x: 0, y: 0 } }, ROBOTICS_PLANE, ROBOTICS_CANVAS);
  assert.ok(fromLocal);
  assert.ok(Math.abs(fromLocal.x - ROBOTICS_CANVAS.w / 2) < 1);
  const chrome = pickRoboticsHud(480, 360, {});
  assert.ok(isRoboticsHudKind(chrome?.kind));
});

test("Robotics HUD paints without live DIMOS", () => {
  paintRoboticsHud(stubCtx(), { armed: false, statusKey: "off", stats: { samples: [] } });
  paintRoboticsHud(stubCtx(), { armed: true, showViewer: true, statusKey: "connected", stats: { samples: [] } });
  const hit = pickRoboticsHud(40, 30, { overflowOpen: false });
  assert.equal(hit?.kind, "robotics-drag");
});

test('VR Controls header and mapping options are clickable', () => {
  const state = { controlsOpen: true, armed: true, showViewer: true };
  const layout = roboticsLayout(ROBOTICS_CANVAS, state);
  for (const key of ['config', 'engageConfig', 'gripperConfig']) {
    const cell = layout[key];
    assert.equal(pickRoboticsHud(cell.x + 8, cell.y + 8, state)?.id, cell.id);
  }
  paintRoboticsHud(stubCtx(), state);
});

test("TeleOP visor chips match the repo HUD", () => {
  assert.equal(TELEOP_HUD_CACHE, "teleophud1");
  assert.equal(teleopModeChip({}), "OFF");
  assert.equal(teleopModeChip({ holding: true }), "HOLD");
  assert.equal(teleopModeChip({ armed: true }), "ON");
  assert.equal(teleopModeChip({ homing: true }), "HOMING");
  assert.equal(teleopModeChip({ pending_arm: true }), "WAIT");
  assert.equal(teleopModeChip({ playing: true }), "PLAY");
  assert.equal(teleopModeChip({ armed:true, stopPhase:'pending' }), 'STOPPING');
  assert.equal(teleopModeChip({ armed:true, stopPhase:'failed' }), 'CHECK');
  assert.equal(teleopModeChip({ armed:false, stopPhase:'stopped' }), 'OFF');
  const chips = teleopHudChips({
    teleop: { armed: true },
    widgets: { state: "RECORDING", take: "002", elapsed: "00:12", saved: "001", discarded: "000", lastAction: "SAVE" },
  });
  assert.deepEqual(chips.map((c) => c.id), ["TELEOP", "STATE", "TAKE", "ELAPSED", "SAVED", "DISCARDED", "FOLDER", "LAST ACTION"]);
  assert.equal(chips[0].value, "ON");
  assert.equal(chips[1].value, "RECORDING");
  assert.equal(chips[6].value, "Emotes");
  assert.equal(chips[7].value, "SAVE");
  assert.notEqual(teleopHudSignature(chips, 0), teleopHudSignature(chips, 0.5));
  paintTeleopVisorHud(stubCtx(), undefined, chips, { holdProgress: 0.4 });
});

test("right controller recording card uses the dimOS A/B/Y contract", () => {
  const idle = rightControllerRecordingUi({ datasetFolder: "Cube tests" });
  assert.equal(idle.state, "READY");
  assert.equal(idle.a, "A  START RECORDING");
  assert.equal(idle.b, "B  DISCARD");
  assert.equal(idle.folder, "FOLDER  Cube tests");
  assert.equal(idle.yHoldProgress, 0);
  assert.equal(rightControllerRecordingUi({ yHoldProgress: 0.65 }).yHoldProgress, 0.65);
  assert.equal(rightControllerRecordingUi({ yHoldProgress: 2 }).yHoldProgress, 1);
  const recording = rightControllerRecordingUi({ recording: true, teleop: { armed: true } });
  assert.equal(recording.state, "● RECORDING");
  assert.equal(recording.a, "A  STOP + SAVE");
  assert.equal(recording.b, "B  DISCARD TAKE");
  assert.match(recording.y, /PAUSE/);
  assert.equal(rightControllerRecordingUi({ pendingIntent: "stopping" }).state, "SAVING…");
});

test("Robotics Pi UI shows clickable recent recordings with folder tags and rename pencils", () => {
  const state = { roboticsProfile: { mode: "integrated" }, emotes: [{ id: "take-7", name: "Cube pick", folderName: "Cube tests" }] };
  const layout = roboticsLayout(ROBOTICS_CANVAS, state);
  assert.equal(layout.recentRows[0].item.name, "Cube pick");
  assert.equal(pickRoboticsHud(layout.recentRows[0].x + 8, layout.recentRows[0].y + 8, state)?.id, "recent-recording:0");
  assert.equal(pickRoboticsHud(layout.recentEdits[0].x + 8, layout.recentEdits[0].y + 8, state)?.id, "recent-recording-edit:0");
  paintRoboticsHud(stubCtx(), state);
});

test('camera sharing has an independent Robotics action while teleop is enabled',()=>{
  const state={armed:true,sharingCamera:true};
  const cell=roboticsLayout(ROBOTICS_CANVAS,state).tabs.find(row=>row.id==='share-camera');
  assert.ok(cell);
  assert.deepEqual(pickRoboticsHud(cell.x+cell.w/2,cell.y+cell.h/2,state),{kind:'robotics-action',id:'share-camera'});
  paintRoboticsHud(stubCtx(),{...state,sharingCameraStatus:'Outward camera shared with the room.'});
});

test("Robotics menu has a 3D Printer tab with Config, Send to PC, bounder, and gear", () => {
  assert.ok(ROBOTICS_MENU_TABS.some((tab) => tab.id === "printer" && tab.label === "3D Printer"));
  const state = { roboticsTab: "printer", printer: { lan_ip: "192.168.1.40", access_code_set: true }, printerShared: true };
  const layout = roboticsLayout(ROBOTICS_CANVAS, state);
  assert.equal(layout.printerTab, true);
  assert.equal(layout.config.id, "printer-config");
  for (const id of ["printer-config", "printer-send-pc", "printer-bounder", "printer-gear", "printer-share", "printer-ip", "printer-pin"]) {
    const cell = Object.values(layout).find((row) => row && row.id === id);
    assert.ok(cell, id);
    assert.deepEqual(pickRoboticsHud(cell.x + 8, cell.y + 8, state), { kind: "robotics-action", id });
  }
  paintRoboticsHud(stubCtx(), state);
});

test("Home and Data Sets stay pickable next to the 3D Printer tab", () => {
  const layout = roboticsLayout(ROBOTICS_CANVAS, { roboticsTab: "pi-ui" });
  assert.equal(pickRoboticsHud(layout.home.x + 8, layout.home.y + 8, {})?.id, "home");
  const emotes = roboticsLayout(ROBOTICS_CANVAS, { roboticsTab: "emotes" });
  assert.equal(emotes.emotesTab, true);
  assert.equal(pickRoboticsHud(emotes.tabs.find((t) => t.id === "emotes").x + 8, emotes.tabs.find((t) => t.id === "emotes").y + 8, { roboticsTab: "emotes" })?.id, "emotes");
});

test('Data Sets tab and Home live on the VR robotics menu',()=>{
  assert.deepEqual(ROBOTICS_MENU_TABS.find(tab=>tab.id==='emotes'), {id:'emotes',label:'Data Sets'});
  const layout=roboticsLayout(ROBOTICS_CANVAS,{armed:true});
  assert.equal(layout.home.id,'home');
  assert.deepEqual(pickRoboticsHud(layout.home.x+8,layout.home.y+8,{armed:true}),{kind:'robotics-action',id:'home'});
  const emotesTab=layout.tabs.find(tab=>tab.id==='emotes');
  assert.ok(emotesTab);
  assert.deepEqual(pickRoboticsHud(emotesTab.x+emotesTab.w/2,emotesTab.y+8,{armed:true}),{kind:'robotics-action',id:'emotes'});
  const emoteState={armed:true,roboticsTab:'emotes',emotes:[{id:'wave',name:'Wave'}]};
  const emoteLayout=roboticsLayout(ROBOTICS_CANVAS,emoteState);
  assert.equal(emoteLayout.emoteRows[0].id,roboticsEmoteHitId('wave'));
  assert.deepEqual(
    pickRoboticsHud(emoteLayout.emoteRows[0].x+12,emoteLayout.emoteRows[0].y+8,emoteState),
    {kind:'robotics-action',id:'emote:wave'},
  );
  paintRoboticsHud(stubCtx(),emoteState);
});

test('robotics menu exposes one-tap headset debug upload',()=>{
  assert.deepEqual(ROBOTICS_MENU_TABS.find(tab=>tab.id==='debug'), {id:'debug',label:'Send debug'});
});
