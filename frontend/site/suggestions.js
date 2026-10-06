import { vd, paintStats, sessionId } from "./vision-desk.js?v=20260916-wp1";

const canvas = document.getElementById("sug-canvas");
const ctx = canvas.getContext("2d");
const statsEl = document.getElementById("sug-stats");
const creditEl = document.getElementById("sug-credit");
const censusEl = document.getElementById("sug-census");
const status = document.getElementById("sug-status");
const thread = document.getElementById("sug-thread");
let tool = "pen";
let drawing = false;
let last = null;

function resize() {
  const w = canvas.clientWidth || 800;
  const h = 420;
  const prev = ctx.getImageData(0, 0, canvas.width || 1, canvas.height || 1);
  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, w, h);
  try {
    ctx.putImageData(prev, 0, 0);
  } catch {
    /* first paint */
  }
}

function pos(ev) {
  const r = canvas.getBoundingClientRect();
  const t = ev.touches ? ev.touches[0] : ev;
  return { x: t.clientX - r.left, y: t.clientY - r.top };
}

canvas.addEventListener("pointerdown", (ev) => {
  drawing = true;
  last = pos(ev);
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener("pointerup", () => {
  drawing = false;
  last = null;
});
canvas.addEventListener("pointermove", (ev) => {
  if (!drawing) return;
  const p = pos(ev);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (tool === "eraser") {
    ctx.strokeStyle = "#0b0f14";
    ctx.lineWidth = 18;
  } else {
    ctx.strokeStyle = tool === "hl" ? "#fb850066" : "#e6edf3";
    ctx.lineWidth = tool === "hl" ? 16 : 2.5;
  }
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  last = p;
});

document.querySelectorAll("[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    tool = btn.getAttribute("data-tool");
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

document.getElementById("sug-image")?.addEventListener("change", (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = URL.createObjectURL(file);
});

document.getElementById("sug-clear")?.addEventListener("click", () => {
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
});

document.getElementById("sug-send")?.addEventListener("click", async () => {
  status.textContent = "Sending markup…";
  try {
    const note = document.getElementById("sug-note").value;
    const image = canvas.toDataURL("image/png");
    const out = await vd("/api/ops/vision-desk/markup", {
      method: "POST",
      body: JSON.stringify({ note, image }),
    });
    status.textContent = `Saved ${out.id}`;
  } catch (err) {
    status.textContent = String(err.message || err);
  }
});

document.getElementById("sug-ask-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const text = document.getElementById("sug-ask").value;
  const p = document.createElement("p");
  p.textContent = `You: ${text}`;
  thread.appendChild(p);
  const data = await vd("/api/ops/vision-desk/ask", {
    method: "POST",
    body: JSON.stringify({ text, session_id: sessionId() }),
  });
  const a = document.createElement("p");
  a.textContent = `Render Agent: ${data.reply}`;
  thread.appendChild(a);
  document.getElementById("sug-ask").value = "";
  load().catch(() => {});
});

async function load() {
  const [stats, credit, census] = await Promise.all([
    vd("/api/ops/vision-desk/stats"),
    vd("/api/ops/vision-desk/credit"),
    vd("/api/ops/vision-desk/census"),
  ]);
  paintStats(statsEl, stats);
  creditEl.textContent = `Credit ${credit.credit_score}/100 — ${credit.formula}`;
  censusEl.textContent = `${census.total_instructions} instructions · ${census.categories_used} categories used · ${census.successful} successful · ${census.damaging} damaging · 0 extra bug families`;
}

resize();
window.addEventListener("resize", resize);
load().catch((err) => {
  status.textContent = String(err.message || err);
});
