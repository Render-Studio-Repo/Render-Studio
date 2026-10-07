/** Sandbox agent bridge: persist teleop episodes + notify crew. Simulation only. */

const MCP_SANDBOX = "/mcp/sandbox";
const GROUP_CHAT = "/mcp/group-chat";
const HARNESS_PREFIX = ""; // same-origin when served by harness.py

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

export async function probeHarness() {
  try {
    const res = await fetch(`${HARNESS_PREFIX}/api/latest?t=${Date.now()}`);
    if (!res.ok) return false;
    return true;
  } catch {
    return false;
  }
}

export async function harnessStart(episode) {
  return postJson(`${HARNESS_PREFIX}/api/start`, episode);
}

export async function harnessSample(sample) {
  return postJson(`${HARNESS_PREFIX}/api/sample`, sample);
}

export async function harnessEnd(body) {
  return postJson(`${HARNESS_PREFIX}/api/end`, body);
}

export async function harnessTrials(body) {
  return postJson(`${HARNESS_PREFIX}/api/trials`, body);
}

/** Write a compact JSON file under frontend/sandbox (agent-readable). */
export async function sandboxWrite(path, obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return postJson(MCP_SANDBOX, {
    action: "write",
    agent: "sam",
    path,
    text: text.slice(0, 110_000),
  });
}

/** Notify seated / team-chat agents with a compact teleop packet. */
export async function notifyAgents(text, { tags = ["cursor-engineer", "vibe-rnd"] } = {}) {
  const tagLine = tags.map((t) => `@${t}`).join(" ");
  return postJson(GROUP_CHAT, {
    action: "post",
    agent: "sam",
    text: `${tagLine} ${text}`.slice(0, 1400),
  });
}

export function compactSample(sample) {
  if (!sample) return null;
  return {
    episode_id: sample.episode_id,
    sequence: sample.sequence,
    timestamp_ms: sample.timestamp_ms,
    head: sample.head_pose?.position,
    left: sample.left_grip_pose?.position,
    right: sample.right_grip_pose?.position,
    gripper: sample.gripper,
    edges: sample.controller_edges || [],
    feature_checks: sample.feature_checks,
  };
}

export async function publishEpisodeSummary({
  episodeId,
  prompt,
  samples,
  trials = [],
  status = "closed",
  success = null,
}) {
  const first = samples[0] || null;
  const last = samples.at(-1) || null;
  const summary = {
    kind: "openarm_teleop_episode",
    scope: "simulation_only",
    episode_id: episodeId,
    prompt: String(prompt || "").slice(0, 500),
    status,
    samples: samples.length,
    operator_label_success: success,
    first: compactSample(first),
    last: compactSample(last),
    trials: trials.slice(-20),
    feature_checks: last?.feature_checks || {},
    agent_read_path: `openarm-teleop/runs/${episodeId}.json`,
    note: "Pose stream is simulation training data. Not a hardware command bus.",
  };
  await sandboxWrite(`openarm-teleop/runs/${episodeId}.json`, summary);
  await sandboxWrite("openarm-teleop/runs/latest.json", {
    episode_id: episodeId,
    status,
    samples: samples.length,
    last: compactSample(last),
    updated_at: new Date().toISOString(),
  });
  await notifyAgents(
    `OpenArm teleop demo ${status}: episode ${episodeId.slice(0, 8)}… · ${samples.length} samples · prompt="${String(prompt || "").slice(0, 120)}" · read sandbox openarm-teleop/runs/latest.json`,
  );
  return summary;
}

export async function publishLiveKeyframe(sample) {
  const packet = {
    kind: "openarm_teleop_keyframe",
    scope: "simulation_only",
    updated_at: new Date().toISOString(),
    sample: compactSample(sample),
  };
  await sandboxWrite("openarm-teleop/runs/latest.json", packet);
  return packet;
}
