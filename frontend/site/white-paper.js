import { vd, paintStats, sessionId } from "./vision-desk.js?v=20260916-wp1";

const commentsEl = document.getElementById("wp-comments");
const statsEl = document.getElementById("wp-stats");
const form = document.getElementById("wp-comment-form");
const askForm = document.getElementById("wp-ask-form");
const thread = document.getElementById("wp-thread");
const status = document.getElementById("wp-status");

async function refresh() {
  const [comments, stats] = await Promise.all([
    vd("/api/ops/vision-desk/comments"),
    vd("/api/ops/vision-desk/stats"),
  ]);
  paintStats(statsEl, stats);
  commentsEl.innerHTML = (comments.comments || [])
    .map(
      (c) =>
        `<article class="vision-comment"><strong>${escapeHtml(c.name)}</strong> <span class="muted small">${escapeHtml(c.ts)}</span><p>${escapeHtml(c.body)}</p></article>`
    )
    .join("") || `<p class="muted">No comments yet.</p>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function addMsg(role, text) {
  const p = document.createElement("p");
  p.innerHTML = `<strong>${role}:</strong> ${escapeHtml(text)}`;
  thread.appendChild(p);
}

form?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const body = document.getElementById("wp-body").value;
  const name = document.getElementById("wp-name").value;
  status.textContent = "Sending…";
  try {
    await vd("/api/ops/vision-desk/comments", { method: "POST", body: JSON.stringify({ body, name }) });
    document.getElementById("wp-body").value = "";
    status.textContent = "Posted anonymously (name optional).";
    await refresh();
  } catch (err) {
    status.textContent = String(err.message || err);
  }
});

askForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const text = document.getElementById("wp-ask").value;
  addMsg("You", text);
  try {
    const data = await vd("/api/ops/vision-desk/ask", {
      method: "POST",
      body: JSON.stringify({ text, session_id: sessionId() }),
    });
    addMsg("Render Agent", data.reply);
    document.getElementById("wp-ask").value = "";
    await refresh();
  } catch (err) {
    addMsg("Error", err.message || err);
  }
});

addMsg("Render Agent", "What part of the Render vision do you want to talk about — CAD, robotics, the agent bus, or scoring ids?");
refresh().catch((err) => {
  if (status) status.textContent = String(err.message || err);
});
