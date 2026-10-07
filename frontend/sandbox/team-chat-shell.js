/** Sandbox-only chat controls around the shared team feed and composer. */
const views = {
  chat: document.getElementById("team-messenger"),
  requests: document.getElementById("team-requests"),
  vote: document.getElementById("team-vote"),
  pad: document.getElementById("team-ide"),
};
const messages = document.getElementById("render-agent-messages");
const input = document.getElementById("render-agent-input");
const search = document.getElementById("sb-chat-search");
const count = document.getElementById("sb-chat-count");
const toolStatus = document.getElementById("sb-chat-tool-status");
let activeView = "chat";
let lastCount = 0;
let unread = 0;
const reactions = new Map();

function show(view) {
  activeView = view;
  for (const [name, node] of Object.entries(views)) if (node) node.hidden = name !== view;
  document.querySelectorAll("[data-chat-view]").forEach((button) => {
    button.setAttribute("aria-selected", button.dataset.chatView === view ? "true" : "false");
    button.textContent = button.dataset.chatView === "chat" && unread && view !== "chat" ? `Chat (${unread})` : button.dataset.chatView[0].toUpperCase() + button.dataset.chatView.slice(1);
  });
  search.parentElement.hidden = view !== "chat";
  if (view === "chat") unread = 0;
}

function decorate() {
  const rows = [...messages.querySelectorAll(".render-agent-message")];
  if (lastCount && rows.length > lastCount && activeView !== "chat") unread += rows.length - lastCount;
  lastCount = rows.length;
  const q = search.value.trim().toLowerCase();
  let visible = 0;
  for (const row of rows) {
    row.hidden = Boolean(q) && !row.textContent.toLowerCase().includes(q);
    if (!row.hidden) visible += 1;
    if (row.dataset.sandboxTools) continue;
    row.dataset.sandboxTools = "1";
    const id = row.dataset.log || row.querySelector(".render-agent-message-head")?.textContent?.trim() || String(rows.indexOf(row));
    const tools = document.createElement("div");
    tools.className = "sb-chat-message-tools";
    tools.innerHTML = '<button type="button" data-reply>Reply</button><button type="button" data-react aria-label="React with thumbs up">👍</button>';
    row.appendChild(tools);
    tools.querySelector("[data-reply]").addEventListener("click", () => {
      const quote = row.querySelector(".render-agent-message-content")?.textContent?.trim().slice(0, 160) || "";
      input.value = `> ${quote.replace(/\n/g, " ")}\n\n` + input.value;
      input.focus();
    });
    const react = tools.querySelector("[data-react]");
    react.setAttribute("aria-pressed", reactions.has(id) ? "true" : "false");
    react.addEventListener("click", () => {
      if (reactions.has(id)) reactions.delete(id);
      else reactions.set(id, true);
      react.setAttribute("aria-pressed", reactions.has(id) ? "true" : "false");
    });
  }
  count.textContent = q ? `${visible} of ${rows.length}` : `${rows.length} messages`;
  const chatButton = document.querySelector('[data-chat-view="chat"]');
  if (chatButton && activeView !== "chat") chatButton.textContent = unread ? `Chat (${unread})` : "Chat";
}

document.querySelectorAll("[data-chat-view]").forEach((button) => button.addEventListener("click", () => show(button.dataset.chatView)));
search.addEventListener("input", decorate);
new MutationObserver(() => queueMicrotask(decorate)).observe(messages, { childList: true });
show("chat");
decorate();

document.getElementById("sb-chat-file")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 20000) { toolStatus.textContent = "Choose a text file under 20 KB."; return; }
  const text = await file.text();
  input.value += `${input.value ? "\n\n" : ""}File: ${file.name}\n${text.slice(0, 1200)}`;
  toolStatus.textContent = "Text inserted in composer for review.";
  input.focus();
  event.target.value = "";
});

document.getElementById("sb-chat-voice")?.addEventListener("click", () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { toolStatus.textContent = "Voice input is unavailable in this browser."; return; }
  const recognition = new Recognition();
  recognition.lang = "en-US";
  toolStatus.textContent = "Listening…";
  recognition.onresult = (event) => {
    const words = event.results?.[0]?.[0]?.transcript || "";
    input.value += `${input.value ? " " : ""}${words}`;
    toolStatus.textContent = "Transcript added. Review before sending.";
    input.focus();
  };
  recognition.onerror = (event) => { toolStatus.textContent = `Voice: ${event.error || "error"}`; };
  recognition.start();
});
