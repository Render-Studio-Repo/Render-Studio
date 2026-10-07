/**
 * 2D look-down crew map (no extra WebGL). Click an avatar to inspect / skill / reassign.
 * Token lookdown1.
 */

import { crewSeatInventory, drawSeatAvatar, inspectDesk } from "./crew-desk-status.js?v=20260923-draw-recordings1";
import { listTasks } from "./agent-tasks.js?v=20260923-draw-recordings1";

export const LOOKDOWN1_TOKEN = "lookdown1";

export function lookdownMarkup() {
  return `
    <div class="sb-lookdown" data-sb-lookdown data-token="${LOOKDOWN1_TOKEN}">
      <p class="muted small">Look down on avatars · click to change skills / reassign · ${LOOKDOWN1_TOKEN}</p>
      <canvas id="sb-lookdown-canvas" width="640" height="280" aria-label="Look-down crew map"></canvas>
    </div>
  `;
}

export function bindLookdown(root, { onSelect } = {}) {
  if (!root) return null;
  const canvas = root.querySelector("#sb-lookdown-canvas");
  if (!canvas?.getContext) return null;
  const ctx = canvas.getContext("2d");
  const seats = crewSeatInventory();
  const cols = 4;
  const placed = seats.map((s, i) => ({
    ...s,
    x: 70 + (i % cols) * 150,
    y: 55 + Math.floor(i / cols) * 85,
    r: 18,
  }));

  const draw = (selected) => {
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#30363d";
    ctx.fillRect(40, 20, 560, 240);
    ctx.strokeStyle = "#58a6ff";
    ctx.strokeRect(40, 20, 560, 240);
    ctx.fillStyle = "#8b949e";
    ctx.font = "11px system-ui,sans-serif";
    ctx.fillText("look down · any workshop", 48, 36);
    placed.forEach((s) => {
      drawSeatAvatar(ctx, s, s.x, s.y, s.r);
      const desk = inspectDesk(s.id, { tasks: listTasks() });
      ctx.fillStyle = s.id === selected ? "#e2e8f0" : "#94a3b8";
      ctx.font = "10px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(s.name, s.x, s.y + 32);
      ctx.fillText(desk.status, s.x, s.y + 44);
      ctx.textAlign = "start";
    });
  };

  let selected = placed[0]?.id || "astra";
  canvas.addEventListener("pointerdown", (ev) => {
    const r = canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (canvas.width / r.width);
    const y = (ev.clientY - r.top) * (canvas.height / r.height);
    const hit = placed.find((s) => Math.hypot(s.x - x, s.y - y) <= s.r + 8);
    if (!hit) return;
    selected = hit.id;
    draw(selected);
    onSelect?.(hit);
  });
  draw(selected);
  return { token: LOOKDOWN1_TOKEN, select: (id) => { selected = id; draw(id); } };
}
