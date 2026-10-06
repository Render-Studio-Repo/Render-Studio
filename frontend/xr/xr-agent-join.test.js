import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  XR_AGENT_JOIN_CHANNEL,
  XR_TEAM_AGENTS,
  voicePromptForAgent,
  spawnPoseForIndex,
  createXrAgentJoinPacket,
  rosterFromTeamStatus,
  applyJoinAction,
  createXrAgentJoin,
} from "./xr-agent-join.js";

test("team roster is the bus agents and status overlay does not drop the canon list", () => {
  assert.ok(XR_TEAM_AGENTS.some((row) => row.id === "project-manager"));
  const roster = rosterFromTeamStatus({
    agents: [
      { agent: "project-manager", hello: true, score: 95 },
      { agent: "sam", hello: true },
    ],
  });
  assert.equal(roster.some((row) => row.id === "sam"), false);
  assert.equal(roster[0].id, "project-manager");
  assert.equal(roster[0].hello, true);
  assert.equal(rosterFromTeamStatus({}).length, XR_TEAM_AGENTS.length);
});

test("spawn poses sit in front of the headset on an arc", () => {
  const a = spawnPoseForIndex(0, { position: [0, 1.7, 0], yaw: 0 });
  const b = spawnPoseForIndex(1, { position: [0, 1.7, 0], yaw: 0 });
  assert.equal(a.position.length, 3);
  assert.ok(a.position[2] < 0, "first agent is in front (-Z when yaw 0)");
  assert.notDeepEqual(a.position, b.position);
});

test("join packets are room-safe and apply one-by-one", () => {
  const agent = XR_TEAM_AGENTS[0];
  const packet = createXrAgentJoinPacket("join", agent, {
    pose: spawnPoseForIndex(0),
    voice: "stub",
  });
  assert.equal(packet.channel, XR_AGENT_JOIN_CHANNEL);
  assert.equal(packet.kind, "agent-join");
  assert.equal(createXrAgentJoinPacket("hack", agent), null);
  let joined = applyJoinAction(new Map(), packet);
  joined = applyJoinAction(joined, createXrAgentJoinPacket("join", XR_TEAM_AGENTS[1], { pose: spawnPoseForIndex(1) }));
  assert.equal(joined.size, 2);
  joined = applyJoinAction(joined, createXrAgentJoinPacket("focus", agent, { pose: spawnPoseForIndex(0) }));
  assert.equal(joined.get(agent.id).live, true);
  assert.equal(joined.get(XR_TEAM_AGENTS[1].id).live, false);
  joined = applyJoinAction(joined, createXrAgentJoinPacket("leave", agent));
  assert.equal(joined.has(agent.id), false);
});

test("voice prompt names the selected agent and does not leak secrets", () => {
  const prompt = voicePromptForAgent({ id: "vibe-sales", name: "Vibe Sales", role: "Closer", apiKey: "sk-secret" });
  assert.match(prompt, /Vibe Sales/);
  assert.match(prompt, /vibe-sales/);
  assert.equal(prompt.includes("sk-secret"), false);
});

test("join then talk uses one voice session hook and announces on the room channel", async () => {
  const sent = [];
  const settings = [];
  const talks = [];
  const session = createXrAgentJoin(null, {
    getHeadPose: () => ({ position: [0, 1.6, 0], yaw: 0 }),
    getPeers: () => [{ id: "peer-1" }, { id: "me" }],
    getUserId: () => "me",
    send: (peer, signal) => sent.push({ peer, signal }),
    voiceAgent: () => ({ action: (id, payload) => settings.push({ id, payload }) }),
    startVoice: async (opts) => {
      talks.push(opts);
      return { ok: true, live: true };
    },
  });
  const first = await session.join("project-manager");
  assert.equal(first.ok, true);
  assert.equal(first.voice, "stub");
  assert.equal(session.joined().length, 1);
  const talk = await session.talkTo("vibe-marketing");
  assert.equal(talk.ok, true);
  assert.equal(talk.voice, "live");
  assert.equal(session.joined().length, 2);
  assert.equal(session.joined().filter((row) => row.live).length, 1);
  assert.ok(settings.some((row) => row.payload?.name === "Vibe Marketing"));
  assert.ok(talks[0].text.includes("Vibe Marketing"));
  assert.ok(sent.every((row) => row.peer === "peer-1"));
  assert.ok(sent.some((row) => row.signal.action === "join"));
  assert.ok(sent.some((row) => row.signal.action === "focus"));
  session.receive("peer-1", createXrAgentJoinPacket("join", XR_TEAM_AGENTS[5], { pose: spawnPoseForIndex(2) }));
  assert.ok(session.joined().some((row) => row.id === "analytics"));
  session.leave("project-manager");
  assert.equal(session.joined().some((row) => row.id === "project-manager"), false);
  assert.equal(session.action("agent-join:join:clip-bot"), true);
});

test("viewport wires the Social Agents button into the existing room and voice starter", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(xr, /id: "team_join"/);
  assert.match(xr, /xr-agent-join\.js\?v=agentjoin1/);
  assert.match(xr, /XR_AGENT_JOIN_CHANNEL/);
  assert.match(xr, /startVoice: \(opts\) => beginAstraTalk/);
  assert.match(app, /agentjoin1/);
});

test("agent summon panel lets the user assign an avatar before or after joining", () => {
  const src = readFileSync(new URL("./xr-agent-join.js", import.meta.url), "utf8");
  assert.match(src, /agent-join:avatar:/);
  assert.match(src, /const choices = \["orb", "robot", "gem"\]/);
});
