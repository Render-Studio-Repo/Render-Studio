/**
 * Headset Robotics HUD paint + hit testing. 2D canvas only — no extra WebGL.
 * Off = compact local UI. Enable Robotics mounts the DimOS quest viewer
 * (status, connect robot PC, JPEG stream, collection HUD) from teleop.js.
 */

import { hudHeaderHitLayout, hudOverflowMenuLayout, pickHudHeader } from "./xr-hud-lock.js?v=voiceactivate2-menutop2";
import { paintDimosCollectionHud, paintDimosVideoBox } from "./xr-dimos-viewer.js?v=roboticsworkspace3";
import { dimosHardwareStatusLabel } from "./xr-dimos-teleop.js?v=20260929-ab-recorder2";

export const ROBOTICS_CANVAS = { w: 960, h: 1040, headerEnd: 76 };
export const ROBOTICS_PLANE = { w: 0.46, h: 0.498 };
export const TELEOP_HUD_CACHE = "teleophud1";
export const TELEOP_HUD_CANVAS = { w: 1024, h: 220 };
export const TELEOP_HUD_PLANE = { w: 0.52, h: 0.12 };

/** Repo visor TELEOP chip: OFF / HOLD / ON / HOMING / WAIT / PLAY */
export function teleopModeChip(teleop = {}, { statusKey = "" } = {}) {
  if (teleop.stopPhase === 'pending') return 'STOPPING';
  if (teleop.stopPhase === 'failed') return 'CHECK';
  if (teleop.stopPhase === 'stopped') return 'OFF';
  if (teleop.playing) return "PLAY";
  if (teleop.homing) return "HOMING";
  if (teleop.pending_arm || statusKey === "connecting") return "WAIT";
  if (teleop.armed && !teleop.holding) return "ON";
  if (teleop.holding) return "HOLD";
  return "OFF";
}

export function teleopHudChips({
  teleop = {},
  widgets = {},
  lastAction = "",
  statusKey = "",
  datasetFolder = "Emotes",
} = {}) {
  const state = widgets.state || (statusKey === "error" || statusKey === "disconnected" ? "OFFLINE" : "READY");
  return [
    { id: "TELEOP", value: teleopModeChip(teleop, { statusKey }) },
    { id: "STATE", value: state },
    { id: "TAKE", value: widgets.take || "001" },
    { id: "ELAPSED", value: widgets.elapsed || "00:00" },
    { id: "SAVED", value: widgets.saved || "000" },
    { id: "DISCARDED", value: widgets.discarded || "000" },
    { id: "FOLDER", value: datasetFolder || "Emotes" },
    { id: "LAST ACTION", value: lastAction || widgets.lastAction || "NONE" },
  ];
}

export function teleopHudSignature(chips = [], holdProgress = 0) {
  return `${chips.map((c) => `${c.id}:${c.value}`).join("|")}|${Math.round(Number(holdProgress) * 10)}`;
}

export function paintTeleopVisorHud(ctx, canvas = TELEOP_HUD_CANVAS, chips = [], { holdProgress = 0 } = {}) {
  if (!ctx) return;
  const w = canvas.w || TELEOP_HUD_CANVAS.w;
  const h = canvas.h || TELEOP_HUD_CANVAS.h;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(8, 14, 22, 0.94)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(188, 210, 235, 0.4)";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
  ctx.fillStyle = "#e6edf3";
  ctx.font = "700 22px Arial,sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("TeleOP", 20, 28);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "700 28px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("×", w - 36, 28);
  const list = Array.isArray(chips) && chips.length ? chips : teleopHudChips();
  const pad = 16;
  const top = 54;
  const cw = (w - pad * 2) / list.length;
  const ch = h - top - 16;
  list.forEach((chip, i) => {
    const x = pad + i * cw + 4;
    const y = top;
    const boxW = cw - 8;
    ctx.fillStyle = "#121b26";
    ctx.fillRect(x, y, boxW, ch);
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, boxW - 2, ch - 2);
    ctx.fillStyle = "#8aa0b5";
    ctx.font = "700 13px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(chip.id, x + 10, y + 18);
    const recording = chip.id === "STATE" && chip.value === "RECORDING";
    const on = chip.id === "TELEOP" && (chip.value === "ON" || chip.value === "PLAY");
    const hold = chip.id === "TELEOP" && chip.value === "HOLD";
    ctx.fillStyle = recording ? "#ff6b6b" : on ? "#86efac" : hold ? "#fbbf24" : "#f4f7fb";
    ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(String(chip.value || ""), x + 10, y + ch / 2 + 8);

  });
}

export function roboticsStatusLabel(state = {}) {
  if (state.roboticsProfile?.mode === "external") return "Pi profile · ready to open";
  const key = String(state.statusKey || "off");
  if (key === "error" || key === "disconnected") {
    if (state.policy?.publicHost) return "DimOS host must be LAN";
    if (String(state.hardwareMode || "").toLowerCase() === "mock") return "Open Arm · mock / no CAN";
    if (key === 'error' && state.label) return state.label;
    return "DIMOS not running";
  }
  return dimosHardwareStatusLabel({
    statusKey: key,
    hardwareMode: state.hardwareMode,
    robotName: state.robotName,
    recognized: state.recognized,
    yFollow: state.yFollow,
  });
}

export const ROBOTICS_MENU_TABS = [
  { id: "pi-ui", label: "Pi UI" },
  { id: "start", label: "Start" },
  { id: "emotes", label: "Data Sets" },
  { id: "viser", label: "Viser" },
  { id: "printer", label: "3D Printer" },
  { id: "share-camera", label: "Share cam" },
  { id: "debug", label: "Send debug" },
];

export function roboticsEmoteHitId(emoteId) {
  return `emote:${String(emoteId || "")}`;
}

export function roboticsLayout(canvas = ROBOTICS_CANVAS, state = {}) {
  const w = canvas.w;
  const headerEnd = canvas.headerEnd;
  const pad = 28;
  const btnH = 72;
  const enableY = headerEnd + 22;
  const showViewer = !!(state.armed || state.showViewer);
  const emotesTab = state.roboticsTab === "emotes";
  const startTab = state.roboticsTab === "start";
  const printerTab = state.roboticsTab === "printer";
  const trio = (w - pad * 2 - 24) / 3;
  const cameraY = enableY + btnH + 12;
  const cameraH = 56;
  const modeY = cameraY + cameraH + 10;
  const modeH = 56;
  const modeW = (w - pad * 2 - 16) / 3;
  const connectY = modeY + modeH + 12;
  const connectH = 64;
  const videoY = connectY + connectH + 14;
  const videoH = showViewer ? 188 : 168;
  const episodeY = videoY + videoH + 10;
  const episodeH = 88;
  const chartY = modeY + modeH + 16;
  const chartH = 168;
  const recY = showViewer ? episodeY + episodeH + 16 : chartY + chartH + 28;
  const recW = (w - pad * 2 - 18) / 4;
  const recentY = recY + btnH + 58;
  const recent = (Array.isArray(state.emotes) ? state.emotes : []).slice(0, 3);
  const recentRows = Array.from({ length: 3 }, (_, i) => ({
    x: pad, y: recentY + i * 66, w: w - pad * 2 - 72, h: 54,
    id: `recent-recording:${i}`, item: recent[i] || null,
  }));
  const recentEdits = recentRows.map((cell, i) => ({ x: cell.x + cell.w + 8, y: cell.y, w: 64, h: cell.h, id: `recent-recording-edit:${i}`, item: cell.item }));
  const header = hudHeaderHitLayout(w, headerEnd);
  const tabN = ROBOTICS_MENU_TABS.length;
  const tabW = (w - pad * 2 - (tabN - 1) * 8) / tabN;
  const emotes = Array.isArray(state.emotes) ? state.emotes : [];
  const page = Math.max(0, Number(state.emotePage) || 0);
  const pageSize = 7;
  const emoteStartY = cameraY;
  const emoteRowH = 64;
  const emoteRows = emotes.slice(page * pageSize, page * pageSize + pageSize).map((emote, i) => ({
    x: pad,
    y: emoteStartY + 76 + i * (emoteRowH + 8),
    w: w - pad * 2,
    h: emoteRowH,
    id: startTab ? `start-emote:${String(emote.id || emote.name || i)}` : roboticsEmoteHitId(emote.id || emote.name || i),
    label: `${startTab && state.startPosition?.id === (emote.id || emote.name) ? "✓ " : ""}${emote.name || emote.label || emote.id || "Emote"}`,
  }));
  return {
    canvas,
    roboticsTab: emotesTab ? "emotes" : printerTab ? "printer" : (state.roboticsTab || "pi-ui"),
    printerTab,
    tabs: ROBOTICS_MENU_TABS.map((tab, i) => ({
      ...tab,
      x: pad + i * (tabW + 8),
      y: canvas.h - 124,
      w: tabW,
      h: 60,
    })),
    showViewer,
    emotesTab,
    startTab,
    emoteHome: { x: pad, y: emoteStartY, w: w - pad * 2, h: 64, id: startTab ? "start-home" : "home" },
    emoteRows,
    emotePrev: { x: pad, y: canvas.h - 198, w: (w - pad * 2 - 16) / 2, h: 52, id: "emote-prev" },
    emoteNext: { x: pad + (w - pad * 2 - 16) / 2 + 16, y: canvas.h - 198, w: (w - pad * 2 - 16) / 2, h: 52, id: "emote-next" },
    enable: { x: pad, y: enableY, w: trio, h: btnH, id: "enable" },
    home: { x: pad + trio + 12, y: enableY, w: trio, h: btnH, id: "home" },
    disable: { x: pad + (trio + 12) * 2, y: enableY, w: trio, h: btnH, id: "disable" },
    camera: { x: pad, y: cameraY, w: w - pad * 2, h: cameraH, id: "camera" },
    camWrist: { x: pad, y: modeY, w: modeW, h: modeH, id: "cam-wrist" },
    camMove: { x: pad + modeW + 8, y: modeY, w: modeW, h: modeH, id: "cam-move" },
    camVr: { x: pad + (modeW + 8) * 2, y: modeY, w: modeW, h: modeH, id: "cam-vr" },
    connect: { x: pad, y: connectY, w: w - pad * 2, h: connectH, id: "connect" },
    video: { x: pad, y: videoY, w: w - pad * 2, h: videoH },
    episode: { x: pad, y: episodeY, w: w - pad * 2, h: episodeH },
    chart: { x: pad, y: chartY, w: w - pad * 2, h: chartH },
    record: { x: pad, y: recY, w: recW, h: btnH, id: "record" },
    stop: { x: pad + recW + 6, y: recY, w: recW, h: btnH, id: "stop" },
    play: { x: pad + (recW + 6) * 2, y: recY, w: recW, h: btnH, id: "play" },
    loop: { x: pad + (recW + 6) * 3, y: recY, w: recW, h: btnH, id: "loop" },
    recentRows,
    recentEdits,
    header,
    config: { x: Math.max(pad, header.overflow.x - 252), y: 10, w: 118, h: Math.max(44, headerEnd - 22), id: printerTab ? "printer-config" : "config" },
    engageConfig: { x: pad, y: connectY, w: w - pad * 2, h: 64, id: "config-engage" },
    gripperConfig: { x: pad, y: connectY + 80, w: w - pad * 2, h: 64, id: "config-gripper" },
    printerShare: { x: pad, y: cameraY, w: 72, h: 56, id: "printer-share" },
    printerGear: { x: pad + 84, y: cameraY, w: 72, h: 56, id: "printer-gear" },
    printerSendPc: { x: pad + 168, y: cameraY, w: w - pad * 2 - 168, h: 56, id: "printer-send-pc" },
    printerBounder: { x: pad, y: modeY, w: w - pad * 2, h: 64, id: "printer-bounder" },
    printerIp: { x: pad, y: connectY, w: (w - pad * 2 - 12) / 2, h: 56, id: "printer-ip" },
    printerPin: { x: pad + (w - pad * 2 - 12) / 2 + 12, y: connectY, w: (w - pad * 2 - 12) / 2, h: 56, id: "printer-pin" },
    printerSerial: { x: pad, y: connectY + 68, w: (w - pad * 2 - 12) / 2, h: 56, id: "printer-serial" },
    printerName: { x: pad + (w - pad * 2 - 12) / 2 + 12, y: connectY + 68, w: (w - pad * 2 - 12) / 2, h: 56, id: "printer-name" },
    printerAccept: { x: pad, y: videoY, w: w - pad * 2, h: 52, id: "printer_accept" },
    printerOutline: { x: pad, y: videoY + 60, w: (w - pad * 2 - 12) / 2, h: 52, id: "printer_outline" },
    printerModel: { x: pad + (w - pad * 2 - 12) / 2 + 12, y: videoY + 60, w: (w - pad * 2 - 12) / 2, h: 52, id: "printer_model" },
    terminal: {
      x: Math.max(pad, header.overflow.x - 126),
      y: 10,
      w: 118,
      h: Math.max(44, headerEnd - 22),
      id: "terminal",
    },
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function label(ctx, text, x, y, { font, fill = "#f8fafc", stroke = "#020617", width = 8, align = "left", maxWidth } = {}) {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  const mw = Number(maxWidth);
  if (Number.isFinite(mw) && mw > 8) {
    ctx.strokeText(text, x, y, mw);
    ctx.fillText(text, x, y, mw);
  } else {
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }
}

function button(ctx, cell, { fill, text, on = false, hover = false }) {
  ctx.fillStyle = on ? fill : (hover ? "#334155" : "#1e293b");
  roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 16);
  ctx.fill();
  ctx.strokeStyle = on || hover ? "#f8fafc" : "#94a3b8";
  ctx.lineWidth = 4;
  roundRect(ctx, cell.x + 2, cell.y + 2, cell.w - 4, cell.h - 4, 14);
  ctx.stroke();
  label(ctx, text, cell.x + cell.w / 2, cell.y + cell.h / 2, {
    font: "800 28px Arial,sans-serif",
    align: "center",
    width: 7,
    maxWidth: cell.w - 16,
  });
}

export function roboticsControlPresentation(state = {}, phase = 0) {
  const pulse = 0.55 + 0.45 * Math.sin(Number(phase) || 0);
  const pending = String(state.pendingIntent || '');
  const paused = !!state.recording && !!state.teleop?.holding;
  return {
    recordText: pending === 'starting' ? 'Starting…' : paused ? '● REC · PAUSED' : state.recording ? '● Recording' : 'Record',
    stopText: pending === 'stopping' ? 'Saving…' : state.recordFeedback === 'saved' ? 'Saved ✓' : 'Stop / Save',
    recordOn: !!state.recording || pending === 'starting',
    stopOn: pending === 'stopping',
    pulse,
    activity: pending || (state.teleop?.homing ? 'homing' : paused ? 'paused' : state.recording ? 'recording' : ''),
  };
}

/** Compact status copied onto the right controller while Robotics is armed. */
export function rightControllerRecordingUi(state = {}) {
  const pending = String(state.pendingIntent || "");
  const recording = !!state.recording;
  const paused = recording && !!state.teleop?.holding;
  const saving = pending === "stopping";
  const starting = pending === "starting";
  const discarded = !!state.discarded;
  return {
    state: saving ? "SAVING…" : starting ? "STARTING…" : paused ? "REC PAUSED" : recording ? "● RECORDING" : discarded ? "DISCARDED" : "READY",
    stateColor: recording ? "#ff6b6b" : saving ? "#fbbf24" : discarded ? "#fca5a5" : "#86efac",
    a: recording || saving ? "A  STOP + SAVE" : "A  START RECORDING",
    b: recording || starting ? "B  DISCARD TAKE" : "B  DISCARD",
    y: state.teleop?.armed && !state.teleop?.holding ? "Y  PAUSE · HOLD RESET" : "Y  CALIBRATE + ACTIVATE",
    yHoldProgress: Math.max(0, Math.min(1, Number(state.yHoldProgress) || 0)),
    folder: `FOLDER  ${String(state.datasetFolder || "Emotes")}`,
  };
}

function paintProgressRing(ctx, cell, progress, color = '#38bdf8') {
  const value = Math.max(0, Math.min(1, Number(progress) || 0));
  if (value <= 0) return;
  const cx = cell.x + cell.w - 26;
  const cy = cell.y + 25;
  ctx.beginPath();
  ctx.arc(cx, cy, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * value);
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.stroke();
}

export function paintRoboticsChart(ctx, box, stats = {}) {
  const { x, y, w, h } = box;
  ctx.fillStyle = "#0b1220";
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 4;
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 12);
  ctx.stroke();

  const samples = Array.isArray(stats.samples) ? stats.samples : [];
  if (!samples.length) {
    const mode = String(stats.hardwareMode || "unknown").toLowerCase();
    const empty = mode === "mock"
      ? "Open Arm mock / no CAN · Y will not move hardware"
      : mode === "can"
        ? "Open Arm CAN · Enable to show DimOS viewer"
        : "No teleop data · Enable Robotics for the DimOS viewer";
    label(ctx, empty, x + w / 2, y + h / 2, {
      font: "700 20px Arial,sans-serif",
      fill: "#94a3b8",
      align: "center",
      width: 5,
      maxWidth: w - 24,
    });
    return;
  }

  const hz = samples.map((s) => Number(s.hz) || 0);
  const maxHz = Math.max(20, ...hz, 1);
  ctx.beginPath();
  hz.forEach((v, i) => {
    const px = x + 12 + (i / Math.max(1, hz.length - 1)) * (w - 24);
    const py = y + h - 16 - (v / maxHz) * (h - 36);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 4;
  ctx.stroke();

  const poseHz = Number(stats.poseHz) || hz[hz.length - 1] || 0;
  const engage = Number(stats.engageSec) || 0;
  const left = stats.leftTrack ? "L●" : "L○";
  const right = stats.rightTrack ? "R●" : "R○";
  label(
    ctx,
    `${poseHz.toFixed(0)} Hz · engage ${engage.toFixed(1)}s · ${left} ${right}`,
    x + 16,
    y + 22,
    { font: "800 20px Arial,sans-serif", fill: "#e0f2fe", width: 5, maxWidth: w - 32 },
  );
}

export function paintRoboticsHud(ctx, state = {}) {
  const layout = roboticsLayout(state.canvas || ROBOTICS_CANVAS, state);
  const { canvas } = layout;
  const w = canvas.w;
  const h = canvas.h;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0f1720";
  roundRect(ctx, 0, 0, w, h, 26);
  ctx.fill();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 6;
  roundRect(ctx, 4, 4, w - 8, h - 8, 22);
  ctx.stroke();

  ctx.fillStyle = "#1e293b";
  roundRect(ctx, 0, 0, w, canvas.headerEnd, 26);
  ctx.fill();
  ctx.fillRect(0, canvas.headerEnd - 12, w, 12);

  label(ctx, layout.showViewer ? "DimOS Robotics" : "Robotics", 28, Math.round(canvas.headerEnd * 0.42), {
    font: "800 42px Arial,sans-serif",
    width: 8,
    maxWidth: w - 280,
  });
  if (state.clock || state.battery) {
    label(ctx, `⏱ ${state.clock || ""}  🔋 ${state.battery || "—"}`, w - 190, Math.round(canvas.headerEnd * 0.42), {
      font: "800 20px Arial,sans-serif",
      fill: "#e0f2fe",
      align: "right",
      width: 6,
    });
  }
  label(ctx, roboticsStatusLabel(state), 28, Math.round(canvas.headerEnd * 0.74), {
    font: "800 22px Arial,sans-serif",
    fill: state.armed ? "#86efac" : "#7dd3fc",
    width: 6,
    maxWidth: w - 168,
  });

  const header = layout.header;
  button(ctx, layout.config, {
    fill: "#1d4ed8",
    text: layout.printerTab ? "Config" : "Controls",
    on: !!(layout.printerTab ? state.printerConfigOpen : state.controlsOpen),
    hover: state.hoverId === layout.config.id,
  });
  button(ctx, layout.terminal, {
    fill: "#0f766e",
    text: "Terminal",
    on: !!state.terminalOpen,
    hover: state.hoverId === "terminal",
  });

  ctx.fillStyle = "#334155";
  roundRect(ctx, header.overflow.x, header.overflow.y, header.overflow.w, header.overflow.h, 14);
  ctx.fill();
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 36px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("⋮", header.overflow.x + header.overflow.w / 2, header.overflow.y + header.overflow.h / 2 + 2);

  ctx.beginPath();
  ctx.arc(header.close.x + header.close.w / 2, header.close.y + header.close.h / 2, 18, 0, Math.PI * 2);
  ctx.fillStyle = "#4b5563";
  ctx.fill();
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 4;
  const cx = header.close.x + header.close.w / 2;
  const cy = header.close.y + header.close.h / 2;
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy - 7);
  ctx.lineTo(cx + 7, cy + 7);
  ctx.moveTo(cx + 7, cy - 7);
  ctx.lineTo(cx - 7, cy + 7);
  ctx.stroke();

  button(ctx, layout.enable, { fill: "#15803d", text: "Enable", on: !!state.armed, hover: state.hoverId === "enable" });
  button(ctx, layout.home, {
    fill: "#0e7490",
    text: state.teleop?.homing ? "Homing…" : Number(state.yHoldProgress) > 0 ? `Hold Y · ${Math.round(Number(state.yHoldProgress) * 100)}%` : "Reset",
    on: !!state.teleop?.homing,
    hover: state.hoverId === "home",
  });
  paintProgressRing(ctx, layout.home, state.teleop?.homing ? 1 : state.yHoldProgress, '#38bdf8');
  button(ctx, layout.disable, { fill: "#7f1d1d", text: "Disable", on: !state.armed, hover: state.hoverId === "disable" });

  if (layout.emotesTab || layout.startTab) {
    const items = layout.emoteRows || [];
    const listX = layout.camera.x;
    const listY = layout.camera.y + 100;
    button(ctx, layout.emoteHome, {
      fill: "#0e7490",
      text: layout.startTab
        ? `${state.startPosition?.type !== "emote" ? "✓ " : ""}Home · pinned default`
        : state.teleop?.homing ? "Homing robot…" : "Home Robot · arms down",
      on: layout.startTab ? state.startPosition?.type !== "emote" : !!state.teleop?.homing,
      hover: state.hoverId === layout.emoteHome.id,
    });
    if (state.emotesError) {
      label(ctx, String(state.emotesError), listX, listY, { font: "700 24px Arial,sans-serif", fill: "#fecaca", width: 5, maxWidth: w - 56 });
    } else if (state.emotesLoading) {
      label(ctx, "Loading data sets from the Pi…", listX, listY, { font: "700 24px Arial,sans-serif", fill: "#94a3b8", width: 5 });
    } else if (!items.length) {
      label(ctx, "No recordings yet. Record a take, then choose its folder here.", listX, listY, { font: "700 24px Arial,sans-serif", fill: "#94a3b8", width: 5, maxWidth: w - 56 });
    } else {
      for (const cell of items) {
        button(ctx, cell, { fill: "#1d4ed8", text: cell.label, hover: state.hoverId === cell.id });
      }
    }
    button(ctx, layout.emotePrev, { fill: "#334155", text: "Prev", hover: state.hoverId === "emote-prev" });
    button(ctx, layout.emoteNext, { fill: "#334155", text: "Next", hover: state.hoverId === "emote-next" });
    layout.tabs.forEach((cell) => button(ctx, cell, {
      fill: "#255c7a",
      text: cell.id === "share-camera"
        ? (state.sharingCamera ? "Stop cam" : state.sharingCameraPending ? "Cancel cam" : "Share cam")
        : cell.label,
      on: cell.id === state.roboticsTab || (cell.id === "share-camera" && state.sharingCamera),
    }));
    const emoteFooter = layout.startTab
      ? "Choose the pose applied before the first Y engage. Home is the safe default."
      : "Home Robot safely stops follow, returns both arms down, and disarms.";
    label(ctx, emoteFooter, w / 2, h - 49, { font: "700 16px Arial,sans-serif", fill: "#94a3b8", align: "center", width: 5, maxWidth: w - 40 });
    return layout;
  }

  if (layout.printerTab) {
    const printer = state.printer || {};
    const ip = String(printer.lan_ip || "").trim();
    const serial = String(printer.serial || "").trim();
    const name = String(printer.name || "").trim();
    const pinSet = !!(printer.access_code_set || String(printer.access_code || "").trim());
    if (state.printerShared) {
      button(ctx, layout.printerShare, { fill: "#0f766e", text: "👥", on: true, hover: state.hoverId === "printer-share" });
    } else {
      button(ctx, layout.printerShare, { fill: "#1e293b", text: "—", hover: state.hoverId === "printer-share" });
    }
    button(ctx, layout.printerGear, { fill: "#334155", text: "⚙", on: !!state.printerConfigOpen, hover: state.hoverId === "printer-gear" });
    button(ctx, layout.printerSendPc, {
      fill: "#15803d",
      text: "Send to PC",
      hover: state.hoverId === "printer-send-pc",
    });
    button(ctx, layout.printerBounder, {
      fill: "#0e7490",
      text: printer.fence ? "Edit bounder · grip move / stretch" : "Create bounder",
      on: !!printer.fence,
      hover: state.hoverId === "printer-bounder",
    });
    button(ctx, layout.printerIp, {
      fill: "#1d4ed8",
      text: ip ? `IP · ${ip.slice(0, 16)}` : "LAN IP",
      on: !!ip,
      hover: state.hoverId === "printer-ip",
    });
    button(ctx, layout.printerPin, {
      fill: "#1d4ed8",
      text: pinSet ? "PIN · set" : "PIN / access",
      on: pinSet,
      hover: state.hoverId === "printer-pin",
    });
    button(ctx, layout.printerSerial, {
      fill: "#334155",
      text: serial ? `SN · ${serial.slice(0, 12)}` : "Serial",
      hover: state.hoverId === "printer-serial",
    });
    button(ctx, layout.printerName, {
      fill: "#334155",
      text: name ? name.slice(0, 14) : "Name",
      hover: state.hoverId === "printer-name",
    });
    button(ctx, layout.printerAccept, {
      fill: "#0f766e",
      text: printer.accept_sends ? "Shared · accept prints on" : "Accept print requests · off",
      on: !!printer.accept_sends,
      hover: state.hoverId === "printer_accept",
    });
    button(ctx, layout.printerOutline, {
      fill: "#1d4ed8",
      text: printer.show_outline ? "Boundary on" : "Boundary",
      on: !!printer.show_outline,
      hover: state.hoverId === "printer_outline",
    });
    button(ctx, layout.printerModel, {
      fill: "#1d4ed8",
      text: printer.show_model ? "Model on" : "Model",
      on: !!printer.show_model,
      hover: state.hoverId === "printer_model",
    });
    layout.tabs.forEach((cell) => button(ctx, cell, {
      fill: "#255c7a",
      text: cell.id === "share-camera"
        ? (state.sharingCamera ? "Stop cam" : state.sharingCameraPending ? "Cancel cam" : "Share cam")
        : cell.label,
      on: cell.id === "printer" || (cell.id === "share-camera" && state.sharingCamera),
    }));
    label(
      ctx,
      "Config saves IP/PIN for VR + desktop. Create bounder, hover the box, grip to move, two grips to stretch.",
      w / 2,
      h - 49,
      { font: "700 16px Arial,sans-serif", fill: "#94a3b8", align: "center", width: 5, maxWidth: w - 40 },
    );
    return layout;
  }

  const camHost = String(state.cameraHost || "camera IP");
  button(ctx, layout.camera, {
    fill: "#0f766e",
    text: `Cameras · ${camHost}`,
    on: !!state.cameraHost,
    hover: state.hoverId === "camera",
  });
  button(ctx, layout.camWrist, {
    fill: "#1d4ed8",
    text: "On wrist",
    on: state.camMode !== "detach",
    hover: state.hoverId === "cam-wrist",
  });
  button(ctx, layout.camMove, {
    fill: "#7c3aed",
    text: "In room",
    on: state.camMode === "detach",
    hover: state.hoverId === "cam-move",
  });
  button(ctx, layout.camVr, {
    fill: "#0f766e",
    text: state.camerasStarting ? "Starting…" : state.cameraError ? "Retry cams" : state.vrScene ? "Disable cams" : "Enable cams",
    on: !!state.vrScene,
    hover: state.hoverId === "cam-vr",
  });

  if (state.controlsOpen && state.roboticsProfile?.mode !== "studio" && state.roboticsProfile?.profile) {
    const buttons = state.roboticsProfile.profile?.controllers?.buttons || {};
    const rows = [state.roboticsProfile.mode === "integrated" ? "Pi controller profile · Studio menu trigger stays available" : "Pi controller profile · Enable Robotics opens its VR UI"];
    for (const side of ["left", "right"]) for (const [key, value] of Object.entries(buttons[side] || {})) {
      if (state.roboticsProfile.mode === 'integrated' && side === 'right' && ['A','B'].includes(key)) {
        rows.push(key === 'A' ? 'right A: Pause' : 'right B: Start'); continue;
      }
      if (typeof value === "string") rows.push(`${side} ${key}: ${value}`);
      else for (const action of ["tap", "hold"]) if (value[action]) rows.push(`${side} ${key} ${action}: ${value[action]}`);
    }
    let y = layout.connect.y + 12;
    ctx.font = "600 24px Arial,sans-serif";
    for (const row of rows) {
      let line = "";
      for (const word of row.split(" ")) {
        if (ctx.measureText(line + word).width > w - 64) { label(ctx, line, 28, y, {font:"600 24px Arial,sans-serif",width:3}); y += 31; line = ""; }
        line += word + " ";
      }
      label(ctx, line, 28, y, {font:"600 24px Arial,sans-serif",width:3}); y += 39;
    }
    return layout;
  }
  if (state.controlsOpen) {
    button(ctx, layout.engageConfig, { fill: "#1d4ed8", text: "Calibrate + engage: Y tap · Home/reset: Y hold", on: true });
    button(ctx, layout.gripperConfig, { fill: "#334155", text: "Gripper: removed · Grip = HUD only", on: false });
    label(ctx, "Profile locked — X+A deadman disabled · no grip arm binding", 28, layout.gripperConfig.y + 96, { font: "600 24px Arial,sans-serif", width: 5 });
    return layout;
  }
  if (layout.showViewer) {
    const hint = state.policy?.colocatedHint ? "same-box :8443" : (state.wsUrl || "LAN host");
    button(ctx, layout.connect, {
      fill: "#0e7490",
      text: `Connect Pi · ${hint}`,
      on: !!state.connected,
      hover: state.hoverId === "connect",
    });
    paintDimosVideoBox(ctx, layout.video, state.viewer || {});
    paintDimosCollectionHud(ctx, layout.episode, state.viewer || {});
  } else {
    paintRoboticsChart(ctx, layout.chart, {
      ...(state.stats || {}),
      recognized: !!state.recognized,
      hardwareMode: state.hardwareMode || "mock",
    });
  }

  const control = roboticsControlPresentation(state, state.animationPhase);
  button(ctx, layout.record, { fill: `rgba(185,28,28,${control.recordOn ? control.pulse : 1})`, text: control.recordText, on: control.recordOn, hover: state.hoverId === "record" });
  const piRecorder = state.roboticsProfile?.mode === 'integrated';
  button(ctx, layout.stop, { fill: control.stopOn ? `rgba(217,119,6,${control.pulse})` : "#334155", text: piRecorder ? control.stopText : "Stop", on: control.stopOn, hover: state.hoverId === "stop" });
  button(ctx, layout.play, { fill: "#1d4ed8", text: piRecorder ? "Emotes" : "Play once", on: !!state.playing && !state.looping, hover: state.hoverId === "play" });
  button(ctx, layout.loop, { fill: "#7c3aed", text: piRecorder ? "Saved loops" : "Loop", on: !!state.looping, hover: state.hoverId === "loop" });

  if (piRecorder) {
    label(ctx, "Recent recordings", 28, layout.recentRows[0].y - 24, { font: "800 24px Arial,sans-serif", fill: "#e2e8f0", width: 5 });
    const folderName = (item) => item?.folderName || item?.folder_name || item?.folderId || item?.folder_id || "Emotes";
    const populated = layout.recentRows.filter((cell) => cell.item);
    if (!populated.length) {
      label(ctx, state.emotesLoading ? "Loading recent robotics data…" : "No recent recordings", 28, layout.recentRows[0].y + 20, { font: "700 22px Arial,sans-serif", fill: "#94a3b8", width: 4 });
    }
    for (let i = 0; i < populated.length; i += 1) {
      const cell = populated[i], item = cell.item;
      const name = String(item.name || item.label || item.id || "Recording");
      button(ctx, cell, { fill: "#1d4ed8", text: `▶ ${name}   [${folderName(item)}]`, hover: state.hoverId === cell.id });
      button(ctx, layout.recentEdits[i], { fill: "#334155", text: "✎", hover: state.hoverId === layout.recentEdits[i].id });
    }
  }

  layout.tabs.forEach((cell)=>button(ctx,cell,{
    fill:"#255c7a",
    text: cell.id === "share-camera"
      ? (state.sharingCamera ? "Stop cam" : state.sharingCameraPending ? "Cancel cam" : "Share cam")
      : cell.label,
    on: cell.id === (state.roboticsTab || "pi-ui") || (cell.id === "share-camera" && state.sharingCamera),
  }));
  const footer = state.sharingCameraStatus || (state.roboticsProfile?.mode === "integrated"
    ? "Y tap calibrates + activates/pauses/reactivates · Y hold Home/reset · A records or stops + saves · B discards."
    : state.roboticsProfile?.mode === "external"
    ? "Enable Robotics opens the Pi passthrough page with its saved controller map. Cameras can be viewed here independently."
    : state.hasClip
    ? "Replay sends recorded poses on the Quest→Pi wss:// socket. Cloudflare is not in the path."
    : layout.showViewer
      ? "DimOS viewer on. Quest on this Wi-Fi opens wss://192.168.1.77:8443/ws directly (like cameras). Tap Y to start the arms. Trust the Pi cert once if connect fails."
      : "Enable Robotics to show the DimOS viewer. Tap Y to start the arms. Enter VR does not auto-arm.");
  const words=String(footer).split(' '), lines=[''];
  for(const word of words){const i=lines.length-1;if((lines[i]+' '+word).length>96)lines.push(word);else lines[i]+=(lines[i]?' ':'')+word;}
  lines.slice(0,3).forEach((line,i)=>label(ctx,line,w/2,h-49+i*17,{font:'700 16px Arial,sans-serif',fill:state.sharingCameraStatus?'#c4e4ed':'#94a3b8',align:'center',width:5}));

  if (state.overflowOpen) {
    const menu = hudOverflowMenuLayout(w, canvas.headerEnd, { locked: !!state.locked });
    ctx.fillStyle = "#0f172a";
    roundRect(ctx, menu.x, menu.y, menu.w, menu.h, 14);
    ctx.fill();
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 4;
    roundRect(ctx, menu.x + 2, menu.y + 2, menu.w - 4, menu.h - 4, 12);
    ctx.stroke();
    for (const cell of menu.rows || []) {
      ctx.fillStyle = (cell.id === "lock" || cell.id === "unlock") && state.locked ? "#166534" : "#1e293b";
      roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 10);
      ctx.fill();
      label(ctx, cell.label, cell.x + cell.w / 2, cell.y + cell.h / 2, {
        font: "800 20px Arial,sans-serif",
        align: "center",
        width: 6,
      });
    }
  }
}

export function isRoboticsHudKind(kind) {
  return String(kind || "").startsWith("robotics");
}

/** UV or local plane point → canvas px. Missing UV used to map every click to chrome. */
export function roboticsCanvasPxFromHit(hit, plane = ROBOTICS_PLANE, canvas = ROBOTICS_CANVAS) {
  let u = Number(hit?.uv?.x);
  let v = Number(hit?.uv?.y);
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    const lx = Number(hit?.local?.x);
    const ly = Number(hit?.local?.y);
    const pw = Number(plane?.w) || ROBOTICS_PLANE.w;
    const ph = Number(plane?.h) || ROBOTICS_PLANE.h;
    if (Number.isFinite(lx) && Number.isFinite(ly) && pw > 0 && ph > 0) {
      u = lx / pw + 0.5;
      v = ly / ph + 0.5;
    }
  }
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  const w = Number(canvas?.w) || ROBOTICS_CANVAS.w;
  const h = Number(canvas?.h) || ROBOTICS_CANVAS.h;
  return { x: u * w, y: (1 - v) * h };
}

export function pickRoboticsHud(px, py, state = {}) {
  const layout = roboticsLayout(state.canvas || ROBOTICS_CANVAS, state);
  const header = py <= (layout.canvas.headerEnd + 8)
    ? pickHudHeader(px, py, layout.canvas.w, layout.canvas.headerEnd, {
      overflowOpen: !!state.overflowOpen,
      locked: !!state.locked,
    })
    : (state.overflowOpen ? pickHudHeader(px, py, layout.canvas.w, layout.canvas.headerEnd, {
      overflowOpen: true,
      locked: !!state.locked,
    }) : null);
  const config = layout.config;
  if (px >= config.x && px <= config.x + config.w && py >= config.y && py <= config.y + config.h) return { kind: "robotics-action", id: config.id || "config" };
  const term = layout.terminal;
  if (term && px >= term.x && px <= term.x + term.w && py >= term.y && py <= term.y + term.h) {
    return { kind: "robotics-action", id: "terminal" };
  }
  if (header) {
    if (header.id === "hide") return { kind: "robotics-action", id: "hide" };
    if (header.id === "lock" || header.id === "unlock") return { kind: "robotics-action", id: header.id };
    if (header.id === "overflow") return { kind: "robotics-action", id: "overflow" };
    if (header.id === "move-this" || header.id === "move-set") return { kind: "robotics-action", id: header.id };
    if (header.id === "rotate") return { kind: "robotics-rotate" };
    if (header.id === "drag") return { kind: "robotics-drag" };
  }
  const cells = [
    ...layout.tabs,
    layout.config,
    ...(state.controlsOpen ? [layout.engageConfig, layout.gripperConfig] : []),
    layout.enable,
    layout.home,
    layout.disable,
    ...(layout.emotesTab ? [...(layout.emoteRows || []), layout.emotePrev, layout.emoteNext] : layout.printerTab ? [
      layout.printerShare, layout.printerGear, layout.printerSendPc, layout.printerBounder,
      layout.printerIp, layout.printerPin, layout.printerSerial, layout.printerName,
      layout.printerAccept, layout.printerOutline, layout.printerModel,
    ] : [
      layout.camera, layout.camWrist, layout.camMove, layout.camVr,
      ...(state.controlsOpen ? [] : [layout.record, layout.stop, layout.play, layout.loop, ...(layout.recentRows || []).filter(cell=>cell.item), ...(layout.recentEdits || []).filter(cell=>cell.item)]),
    ]),
  ];
  if (layout.showViewer && !state.controlsOpen && !layout.emotesTab && !layout.printerTab) cells.push(layout.connect);
  for (const cell of cells) {
    if (px >= cell.x && px <= cell.x + cell.w && py >= cell.y && py <= cell.y + cell.h) {
      return { kind: "robotics-action", id: cell.id };
    }
  }
  if (px >= 0 && py >= 0 && px <= layout.canvas.w && py <= layout.canvas.h) {
    return { kind: "robotics-chrome" };
  }
  return null;
}
