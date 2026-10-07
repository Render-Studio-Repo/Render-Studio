/** Poll Team chat like group-chat.js — /mcp/group-chat then jsonl fallback. */
import { bump, debugState, getJson, noteError } from "./bus.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function loadRows() {
  const feed = await getJson("/mcp/team-chat/feed?limit=40&t=" + Date.now());
  if (feed && feed.messages) return feed.messages;
  const api = await getJson("/mcp/group-chat?limit=40&t=" + Date.now());
  if (api && api.messages) return api.messages;
  const res = await fetch("/docs/media/group-chat.jsonl?t=" + Date.now()).catch((err) => {
    noteError("group-chat.jsonl", err);
    return null;
  });
  if (!res || !res.ok) return [];
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { agent: "?", text: l }; }
  });
}

export function mountChat(host) {
  if (!host || host.dataset.ready === "1") return;
  host.dataset.ready = "1";
  host.innerHTML = `<h3>Team chat (sandbox poll)</h3><ul class="sb-log" id="sb-chat-log"></ul>`;
  const ul = host.querySelector("#sb-chat-log");

  async function paint() {
    const rows = await loadRows();
    const last = rows.slice(-12).reverse();
    const ids = last.map((r) => r.log_id).filter(Boolean);
    bump({ logIds: [...new Set([...ids, ...debugState.logIds])].slice(0, 16) });
    ul.innerHTML = last.map((r) => {
      const lid = r.log_id ? `<button type="button" class="sb-chip" data-copy="${esc(r.log_id)}">${esc(r.log_id)}</button>` : "";
      return `<li><strong>${esc(r.agent)}</strong> ${lid}<div>${esc(r.text)}</div></li>`;
    }).join("");
    ul.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.onclick = () => navigator.clipboard?.writeText(btn.getAttribute("data-copy") || "");
    });
  }
  paint();
  setInterval(paint, 4000);
}
