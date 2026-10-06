/** Crew floor: look-down walk to HF skill rack + emote swap. Token crewwalk1. */

import { crewSeatInventory, drawSeatAvatar } from "./crew-desk-status.js?v=20260923-draw-recordings1";
import { HF_SKILL_CATALOG, setWielded, wieldedFor } from "./huggingface-skills.js?v=hfskill1";
import { placeSeats, skillRackPoint, stepWalk, planSkillSwap, CREWWALK1_TOKEN } from "./crew-walk.js?v=crewwalk1";
import { recordKnowledgeTurn } from "./agent-knowledge.js?v=kb1&teleop-y=20260922-poseconnect1";
import { assignTask } from "./agent-tasks.js?v=20260923-draw-recordings1";

export function mountCrewFloor(host, { onSwap } = {}) {
  if (!host) return null;
  host.classList.add("sb-crew-floor");
  host.innerHTML = `
    <div class="sb-crew-floor-head">
      <span class="sb-kicker">CREW FLOOR · ${CREWWALK1_TOKEN}</span>
      <select data-crew-agent></select>
      <select data-crew-skill>${HF_SKILL_CATALOG.map((s) => `<option value="${s.id}">${s.label}</option>`).join("")}</select>
      <button type="button" class="sb-agent-btn" data-crew-swap>Walk over and swap</button>
      <span class="muted small" data-crew-status role="status">Idle</span>
    </div>
    <canvas data-crew-canvas width="640" height="280" aria-label="Crew walk map"></canvas>
  `;
  const canvas = host.querySelector("[data-crew-canvas]");
  const ctx = canvas.getContext("2d");
  const agentSel = host.querySelector("[data-crew-agent]");
  const seats0 = crewSeatInventory();
  agentSel.innerHTML = seats0.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  let placed = placeSeats(seats0);
  let raf = 0;
  const rack = skillRackPoint();

  const draw = () => {
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#161b22";
    ctx.fillRect(40, 20, 560, 240);
    ctx.strokeStyle = "#30363d";
    ctx.strokeRect(40, 20, 560, 240);
    ctx.fillStyle = "#3fb950";
    ctx.fillRect(rack.x - 28, rack.y - 28, 56, 56);
    ctx.fillStyle = "#0d1117";
    ctx.font = "11px system-ui,sans-serif";
    ctx.fillText("HF", rack.x - 10, rack.y + 4);
    placed.forEach((s) => {
      drawSeatAvatar(ctx, s, s.x, s.y, 16);
      ctx.fillStyle = "#e6edf3";
      ctx.font = "16px sans-serif";
      if (s.emote) ctx.fillText(s.emote, s.x + 14, s.y - 14);
      ctx.fillStyle = "#8b949e";
      ctx.font = "10px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(s.name, s.x, s.y + 28);
      const held = wieldedFor(s.id);
      if (held) ctx.fillText(held.label, s.x, s.y + 40);
      ctx.textAlign = "start";
    });
  };

  const setStatus = (m) => { const el = host.querySelector("[data-crew-status]"); if (el) el.textContent = m; };

  host.querySelector("[data-crew-swap]").addEventListener("click", async () => {
    const id = agentSel.value;
    const skill = HF_SKILL_CATALOG.find((s) => s.id === host.querySelector("[data-crew-skill]").value);
    const agent = placed.find((s) => s.id === id);
    if (!agent || !skill) return;
    cancelAnimationFrame(raf);
    const started = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - started) / 900);
      const pose = stepWalk(agent, rack, t);
      agent.x = pose.x; agent.y = pose.y; agent.emote = pose.emote; agent.walking = pose.walking;
      draw();
      if (t < 1) { raf = requestAnimationFrame(tick); return; }
      setWielded(id, skill.id);
      const plan = planSkillSwap(agent, skill);
      setStatus(`${agent.name} swapped → ${skill.label}`);
      assignTask(id, `Wield HF ${skill.label}: ${skill.job}`, { from: "hf-rack" });
      void recordKnowledgeTurn({
        kind: "job",
        agent_id: id,
        score: 70,
        label: "achieved",
        beneficial: true,
        notes: `HF skill ${skill.id} ${skill.space}`,
      });
      onSwap?.(plan);
      const backStart = performance.now();
      const back = (n) => {
        const u = Math.min(1, (n - backStart) / 700);
        agent.x = rack.x + (agent.homeX - rack.x) * u;
        agent.y = rack.y + (agent.homeY - rack.y) * u;
        agent.emote = u >= 1 ? "👍" : "🔧";
        draw();
        if (u < 1) raf = requestAnimationFrame(back);
      };
      raf = requestAnimationFrame(back);
    };
    raf = requestAnimationFrame(tick);
  });

  draw();
  return { token: CREWWALK1_TOKEN, draw };
}
