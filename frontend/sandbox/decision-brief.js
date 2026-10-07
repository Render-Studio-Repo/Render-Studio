/** Seated-agent votes + Astra risk/reward script. Token sandbox4. One TTS speaker. */
export const SANDBOX4_TOKEN = "sandbox4";

export const DECISION_VOTERS = Object.freeze([
  { id: "analytics", name: "Analytics", lean: "measure" },
  { id: "project-manager", name: "PM", lean: "ship" },
  { id: "vibe-rnd", name: "RnD", lean: "probe" },
  { id: "clip-bot", name: "Clip-bot", lean: "print" },
  { id: "ledger", name: "Ledger", lean: "gate" },
  { id: "cursor-engineer", name: "Cursor", lean: "patch" },
]);

export const DECISION_CHOICES = Object.freeze({
  debug: { A: "probe", B: "patch-now", C: "wait-on-Sam" },
  control: { A: "bind-live", B: "dry-run", C: "revert" },
  sandbox: { A: "keep-on", B: "hide-shapes", C: "cede-harness" },
});

export function hashTopic(topic) {
  const s = String(topic || "");
  let n = 0;
  for (let i = 0; i < s.length; i += 1) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return n;
}

function riskFor(voter, choice, kind) {
  if (choice === "C") return `${voter.name} flags stall if we wait`;
  if (kind === "sandbox" && choice === "B") return "hiding shapes can hide a live bug";
  if (kind === "control" && choice === "A") return "live binds can fight the headset";
  return `${voter.name} sees a miss if ${choice} is wrong`;
}

function rewardFor(voter, choice, kind) {
  if (choice === "A") return kind === "debug" ? "we isolate the fault" : "we learn on the live path";
  if (choice === "B") return kind === "sandbox" ? "the production CAD stays clean" : "a smaller blast radius";
  return "Sam stays off the critical path";
}

function suggestFor(voter, choice, topic, kind) {
  const clip = String(topic || "this challenge").slice(0, 48);
  if (voter.lean === "measure") return `Log ${clip} before the next patch; compare /mcp/stats.`;
  if (voter.lean === "ship") return `Ship the safer ${choice} path for ${clip}; keep one battery.`;
  if (voter.lean === "probe") return `Reproduce ${clip} in sandbox only, then cede_example apply=false.`;
  if (voter.lean === "print") return `Print a fixture or CAD step that proves ${clip}.`;
  if (voter.lean === "gate") return `Two peer asks, then Ledger — do not ping Sam first on ${clip}.`;
  return `Draft a CODE harness note for ${kind}: ${clip}.`;
}

export function collectDecisionVotes(topic, { kind = "debug" } = {}) {
  const key = DECISION_CHOICES[kind] ? kind : "debug";
  const labels = DECISION_CHOICES[key];
  const keys = Object.keys(labels);
  const h = hashTopic(`${topic}|${key}`);
  const votes = DECISION_VOTERS.map((voter, i) => {
    const choice = keys[(h + i * 3 + voter.lean.length) % keys.length];
    return {
      agent: voter.id,
      name: voter.name,
      lean: voter.lean,
      choice,
      label: labels[choice],
      risk: riskFor(voter, choice, key),
      reward: rewardFor(voter, choice, key),
      suggestion: suggestFor(voter, choice, topic, key),
    };
  });
  const counts = {};
  for (const vote of votes) counts[vote.choice] = (counts[vote.choice] || 0) + 1;
  const winner = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return {
    topic: String(topic || "").slice(0, 160),
    kind: key,
    votes,
    counts,
    winner,
    labels,
    token: SANDBOX4_TOKEN,
  };
}

export function voteSplitLine(brief) {
  const labels = brief?.labels || {};
  const counts = brief?.counts || {};
  return Object.keys(labels)
    .map((k) => `${counts[k] || 0} ${labels[k]}`)
    .join(", ");
}

/** Astra (voice host) line — one speaker via TTS mutex. */
export function riskRewardScript(brief) {
  const split = voteSplitLine(brief);
  const winner = (brief?.votes || []).find((v) => v.choice === brief.winner) || brief?.votes?.[0] || {};
  const risk = winner.risk || "we stall on the same miss";
  const reward = winner.reward || "we learn the next step";
  const tip = winner.suggestion || "try the safer sandbox probe";
  return `Risk: ${risk}. Reward: ${reward}. The other AIs vote ${split}. Overcome it: ${tip}`.slice(0, 360);
}

export function overcomeSuggestions(brief) {
  return (brief?.votes || []).map((v) => ({
    agent_id: v.agent,
    agent_name: v.name,
    text: String(v.suggestion || "").slice(0, 180),
    choice: v.choice,
    silent: true,
  }));
}

export function buildDecisionBrief(topic, opts = {}) {
  const brief = collectDecisionVotes(topic, opts);
  return {
    ...brief,
    script: riskRewardScript(brief),
    suggestions: overcomeSuggestions(brief),
    speaker: "astra",
    endpoint: "/mcp/sandbox/decision",
  };
}
