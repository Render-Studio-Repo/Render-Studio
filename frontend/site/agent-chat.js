/** Public shared Render Agent chat preview. */

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function renderText(value = "") {
  return esc(value).replace(/\n/g, "<br>");
}

async function main() {
  const root = document.getElementById("agent-chat-root");
  const shareId = new URLSearchParams(window.location.search).get("chat")
    || new URLSearchParams(window.location.search).get("id")
    || "";
  if (!root) return;
  if (!shareId) {
    root.innerHTML = `<h2>Missing chat id</h2><p class="muted">Open a share link like <code>/agent-chat.html?chat=…</code></p>`;
    return;
  }
  try {
    const res = await fetch(`/api/render-agent/share/${encodeURIComponent(shareId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || res.statusText || "Not found");
    const thread = data.thread || {};
    const owner = data.owner?.display_name || "User";
    root.innerHTML = `
      <header class="agent-chat-preview-head">
        <p class="gs-kicker">Shared Render Agent chat</p>
        <h2>${esc(thread.title || "Chat preview")}</h2>
        <p class="muted small">Shared by ${esc(owner)} · id <code id="agent-chat-id">${esc(shareId)}</code>
          <button type="button" class="btn secondary btn-compact" id="copy-chat-id">Copy id</button>
        </p>
      </header>
      <div class="agent-chat-preview-messages">
        ${(thread.messages || []).map((msg) => `
          <article class="agent-chat-msg agent-chat-msg--${esc(msg.role || "assistant")}">
            <strong>${esc(msg.sender?.display_name || (msg.role === "user" ? "User" : "Render Agent"))}</strong>
            ${(msg.media || []).map((m) => `
              <figure class="render-agent-media">
                <img src="${esc(m.url)}" alt="${esc(m.title || "Demo")}" />
                <figcaption><strong>${esc(m.title || "")}</strong></figcaption>
              </figure>
            `).join("")}
            <div>${renderText(msg.content || "")}</div>
          </article>
        `).join("") || `<p class="muted">No messages in this chat yet.</p>`}
      </div>
    `;
    document.getElementById("copy-chat-id")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareId);
        document.getElementById("copy-chat-id").textContent = "Copied";
      } catch {
        /* ignore */
      }
    });
  } catch (err) {
    root.innerHTML = `<h2>Chat unavailable</h2><p class="muted">${esc(err.message || "error")}</p>`;
  }
}

void main();
