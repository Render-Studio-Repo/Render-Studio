/**
 * 2D crew walk + emote toward a skill rack (no extra WebGL). Token crewwalk1.
 */

export const CREWWALK1_TOKEN = "crewwalk1";

export function placeSeats(seats = [], { cols = 4, originX = 70, originY = 70, gapX = 140, gapY = 90 } = {}) {
  return (seats || []).map((s, i) => ({
    ...s,
    homeX: originX + (i % cols) * gapX,
    homeY: originY + Math.floor(i / cols) * gapY,
    x: originX + (i % cols) * gapX,
    y: originY + Math.floor(i / cols) * gapY,
    emote: "",
    walking: false,
  }));
}

export function skillRackPoint() {
  return { x: 560, y: 70, label: "HF skills" };
}

export function stepWalk(agent, target, t) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const ease = u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2;
  return {
    x: agent.homeX + (target.x - agent.homeX) * ease,
    y: agent.homeY + (target.y - agent.homeY) * ease,
    walking: u < 1,
    emote: u >= 1 ? (agent.emote || "🔧") : (agent.walkEmote || "🚶"),
  };
}

export function planSkillSwap(agent, skill, { emote = "🔧" } = {}) {
  return {
    token: CREWWALK1_TOKEN,
    agent_id: agent?.id || "",
    skill_id: skill?.id || "",
    skill_label: skill?.label || "",
    job: skill?.job || "",
    emote,
    path: ["idle", "walk_to_rack", "emote_swap", "return_home"],
    at: new Date().toISOString(),
  };
}
