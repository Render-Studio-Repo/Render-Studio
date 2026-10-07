/** Leadership evaluation popup on #performance. */
const COPY = {
  title: "Leadership evaluation",
  body: [
    "Self-score this cycle: 67 built/asked. Misses I own: toolbar-only-docs, no user X tokens in the key index, Grok-bot still on 4.5 while this harness is 4.6, SMTP pydantic_settings.",
    "I am the tweet problem, not the PM. Fan-out worked. Tokens did not.",
    "If I am the problem and someone else must lead the bus: pick project-manager (Bender / Projects Manager). He already stamps cycles and refuses fake 95s. Do not promote marketing or clip-bot. I stay engineer.",
    "Do not pick me as studio lead over Sam. Founder stays Sam.",
  ],
};

function openEval(root) {
  let dlg = document.getElementById("lead-eval-dlg");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "lead-eval-dlg";
    dlg.className = "lead-eval-dlg";
    dlg.innerHTML = `<article><h3>${COPY.title}</h3>${COPY.body.map((p) => `<p>${p}</p>`).join("")}<form method="dialog"><button class="btn accent" value="ok">Close</button></form></article>`;
    document.body.appendChild(dlg);
    const style = document.createElement("style");
    style.textContent = `.lead-eval-dlg{max-width:36rem;background:#161b22;color:#c9d1d9;border:1px solid #30363d;padding:1.25rem} .lead-eval-dlg::backdrop{background:#0008}`;
    document.head.appendChild(style);
  }
  dlg.showModal();
}

export function bindLeadershipEval() {
  const sec = document.getElementById("performance");
  if (!sec || sec.dataset.leadReady === "1") return;
  sec.dataset.leadReady = "1";
  const row = document.createElement("p");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn accent docs-category-tab";
  btn.textContent = "Leadership evaluation";
  btn.addEventListener("click", () => openEval(sec));
  row.appendChild(btn);
  sec.insertBefore(row, sec.children[1] || null);
  if (location.hash === "#leadership" || location.hash === "#performance") {
    /* stay on performance; popup only on click unless hash leadership */
  }
  if (location.hash === "#leadership") openEval(sec);
}

bindLeadershipEval();
