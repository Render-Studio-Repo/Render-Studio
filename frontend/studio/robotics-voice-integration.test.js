import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { voiceRealtimeConfig } from "../components/voice-agent-protocol.js";

const root = new URL("../", import.meta.url);

test("Robot panel exposes the shared Hey AI control", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /id="btn-robot-hey-ai"/);
  assert.match(html, /id="btn-robot-hey-ai"[^>]+data-voice-order="1"/s);
  assert.match(html, /id="btn-robot-hey-ai"[^>]+data-voice-idle-label="Hey AI"/s);
  assert.match(html, /data-robotics-assistant-model/);
  assert.match(html, /id="btn-robotics-assistant-settings"/);
});

test("realtime voice session receives bounded robotics tools and guidance", () => {
  const config = voiceRealtimeConfig("gpt-realtime", {}, { review: true, roboticsControls: true });
  assert.ok(config.tools.some((tool) => tool.name === "get_robotics_setup"));
  assert.ok(config.tools.some((tool) => tool.name === "run_robotics_action"));
  assert.match(config.instructions, /confirmation remains mandatory/i);
  assert.match(config.instructions, /kill_robot is the emergency software stop/i);
  assert.match(config.instructions, /start the configured simulation/i);
});

test("studio wires voice commands to the robotics action router", async () => {
  const app = await readFile(new URL("studio/app.js", root), "utf8");
  const mold = await readFile(new URL("components/voice-mold.js", root), "utf8");
  assert.match(app, /onRobotCommand:\s*createRoboticsVoiceCommandRouter/);
  assert.match(app, /id:\s*"install_demo"/);
  assert.match(app, /id:\s*"start_simulation"/);
  assert.match(app, /id:\s*"reset_simulation"/);
  assert.match(app, /id:\s*"kill_robot"/);
  assert.match(app, /id:\s*"home_robot"/);
  assert.match(app, /onRoboticsPrompt:\s*runRoboticsAgentPrompt/);
  assert.match(mold, /\['get_robotics_setup','run_robotics_action'\]\.includes\(name\)/);
});
