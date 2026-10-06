import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  speechRecognitionCtor,
  roboticsMicErrorMessage,
  parseRoboticsCommand,
  isRobotLogEntry,
  formatTeleopLogLine,
  formatCoordinatorLogLine,
} from "./robotics-terminal.js";

const here = dirname(fileURLToPath(import.meta.url));

test("robotics terminal command parse and log filters", () => {
  assert.equal(parseRoboticsCommand(""), null);
  assert.deepEqual(parseRoboticsCommand("  /Status now "), { name: "status", args: ["now"], raw: "/Status now" });
  assert.equal(isRobotLogEntry({ message: "saved mesh" }), false);
  assert.equal(isRobotLogEntry({ message: "DIMOS coordinator starting" }), true);
  assert.equal(isRobotLogEntry({ data: { path: "/api/dimos/ws" } }), true);
  assert.match(formatTeleopLogLine({ statusKey: "connected", robotName: "Open Arm", hardwareMode: "can", connected: true }), /connected/);
  assert.match(formatCoordinatorLogLine({ up: true, process: true, blueprint: "teleop-quest-openarm", pids: [12] }), /:8443 up/);
  assert.equal(roboticsMicErrorMessage({ name: "NotAllowedError" }), "Microphone permission denied. Allow the mic for this site, then try again.");
  assert.equal(speechRecognitionCtor({ webkitSpeechRecognition: function WebkitSpeech() {} }).name, "WebkitSpeech");
});

test("Robotics chrome has Terminal and overlay, SpeechRecognition not gated on boot", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const js = readFileSync(join(here, "robotics-terminal.js"), "utf8");
  const hud = readFileSync(join(here, "../xr/xr-robotics-hud.js?v=roboticsworkspace3-picontrols1"), "utf8");
  const xr = readFileSync(join(here, "../xr/viewport-xr.js"), "utf8");
  assert.match(html, /id="btn-robotics-terminal"/);
  assert.match(html, /data-robotics-terminal/);
  assert.match(html, /id="robotics-terminal-overlay"/);
  assert.match(html, /data-robotics-term-talk/);
  assert.match(html, /roboterm1/);
  assert.match(js, /webkitSpeechRecognition/);
  assert.match(js, /function startWebSpeech/);
  assert.equal(js.includes("Microphone is still loading with Studio"), false);
  assert.match(hud, /id: "terminal"/);
  assert.match(xr, /id === "terminal"/);
  assert.match(xr, /__openRoboticsTerminal/);
});
