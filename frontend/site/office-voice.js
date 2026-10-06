/** Office talk port — browser speech → group chat. OpenAI Realtime is not live until Sam adds a key. */
export function mountOfficeVoice(host) {
  if (!host || host.dataset.voice === "1") return;
  host.dataset.voice = "1";
  const bar = document.createElement("div");
  bar.className = "office-voice";
  bar.innerHTML = `<button type="button" class="btn accent" id="office-talk">Talk</button>
    <span class="muted small" id="office-talk-status">Browser mic → board as sam. OpenAI voice: CANNOT until key.</span>`;
  host.appendChild(bar);
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const status = bar.querySelector("#office-talk-status");
  bar.querySelector("#office-talk")?.addEventListener("click", () => {
    if (!Speech) {
      if (status) status.textContent = "No SpeechRecognition in this browser.";
      return;
    }
    const rec = new Speech();
    rec.lang = "en-US";
    rec.onresult = async (ev) => {
      const text = ev.results?.[0]?.[0]?.transcript || "";
      if (!text) return;
      if (status) status.textContent = "Posting…";
      let res = await fetch("/mcp/group-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "sam", text: "VOICE: " + text }),
      }).catch(() => null);
      if (status) status.textContent = res && res.ok ? "Posted to board." : "Post failed.";
    };
    rec.onerror = () => { if (status) status.textContent = "Mic error."; };
    rec.start();
    if (status) status.textContent = "Listening…";
  });
}
