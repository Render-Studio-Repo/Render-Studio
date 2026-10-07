/** Marketing pitch decks (PDF/MD) + pointer-to-step. Token mktpitch1. No extra WebGL. */
export const MKTPITCH1_TOKEN = "mktpitch1";
export const MKTPRES1_KEEP = "mktpres1";
export const SOCIAL_HANDLES = Object.freeze(["a1_projects", "winstead_works"]);

export const SOCIAL_GROWTH_PITCH = Object.freeze({
  id: "social-growth",
  title: "Grow Render Studio social presence",
  agent: "vibe-marketing",
  token: MKTPITCH1_TOKEN,
  handles: SOCIAL_HANDLES,
  source: "mcp/grok-bot/MARKETING.md · draft-only X",
  pages: [
    {
      id: "s1",
      title: "The ask",
      kicker: "Pitch · mktpitch1",
      bullets: [
        "Product name is Render Studio. Always include https://render3d.app.",
        "Growth = real clips of shipped UI, not vanity metrics.",
        "Never invent follower counts, tweet IDs, or live post URLs.",
      ],
    },
    {
      id: "s2",
      title: "Accounts we actually run",
      kicker: "X handles only",
      bullets: [
        "@a1_projects — product / studio surface.",
        "@winstead_works — founder / build-in-public.",
        "If a count is not in grok_stats or X analytics, leave it blank.",
      ],
    },
    {
      id: "s3",
      title: "What to publish",
      kicker: "MARKETING.md media table",
      bullets: [
        "GIF 2–6s for tools. MP4 for Record / VR spectator. PNG for logo/OG.",
        "Caption footer: Built in Render Studio https://render3d.app",
        "Draft with x_post confirm=false. Live needs Sam.",
      ],
    },
    {
      id: "s4",
      title: "Share-to-X loop",
      kicker: "Do not auto-publish",
      bullets: [
        "Record → stop → You’re done recording → Share to X (download-then-compose).",
        "Same path from markup, clip editor, VR POV, Reference Files.",
        "Bot never fires paid Generate or posts without confirm=true.",
      ],
    },
    {
      id: "s5",
      title: "How to run this deck",
      kicker: "Sandbox PDF / Notes",
      bullets: [
        "Generate: grok_pitch_deck or POST /mcp/sandbox/pitch",
        "Open Super IDE PDF tab (pitch) or Files → examples/pitch-social-growth.*",
        "Point left/right on the PDF to step slides (same Draw/point as Bambu plates).",
      ],
    },
  ],
});

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function splitMarkdownSlides(md) {
  const raw = String(md || "").trim();
  if (!raw) return [];
  const chunks = raw.split(/\n---\n/g).map((c) => c.trim()).filter(Boolean);
  return chunks.map((chunk, i) => {
    const lines = chunk.split("\n");
    const heading = lines.find((ln) => /^#{1,3}\s/.test(ln)) || `Slide ${i + 1}`;
    const title = heading.replace(/^#{1,3}\s+/, "").replace(/^\d+\.\s+/, "");
    const bullets = lines.filter((ln) => /^\s*[-*]\s+/.test(ln)).map((ln) => ln.replace(/^\s*[-*]\s+/, "").trim());
    return { id: `md-${i + 1}`, title, kicker: "Markdown slide", bullets: bullets.length ? bullets : [chunk.slice(0, 180)] };
  });
}

export function deckFromMarkdown(md, extras = {}) {
  const pages = splitMarkdownSlides(md);
  return {
    id: extras.id || "custom",
    title: extras.title || pages[0]?.title || "Pitch deck",
    agent: "vibe-marketing",
    token: MKTPITCH1_TOKEN,
    handles: SOCIAL_HANDLES,
    pages: pages.length ? pages : SOCIAL_GROWTH_PITCH.pages,
  };
}

export function pitchOutline(deck = SOCIAL_GROWTH_PITCH) {
  const lines = [
    `# ${deck.title}`,
    "",
    `token \`${deck.token}\` · agent ${deck.agent}`,
    `handles: ${(deck.handles || SOCIAL_HANDLES).map((h) => `@${h}`).join(", ")}`,
    "No fake follower counts. Draft-only social posts.",
    "",
  ];
  (deck.pages || []).forEach((page, i) => {
    lines.push(`## ${i + 1}. ${page.title}`);
    (page.bullets || []).forEach((b) => lines.push(`- ${typeof b === "string" ? b : b.text}`));
    lines.push("");
  });
  return lines.join("\n");
}

export function uvToSlideDelta(uv) {
  const x = Number(uv?.x ?? uv?.[0]);
  if (!Number.isFinite(x)) return 0;
  if (x < 0.33) return -1;
  if (x > 0.67) return 1;
  return 0;
}

export function parseSlideUtterance(text) {
  const raw = String(text || "");
  if (/\b(next|forward|advance)\b/i.test(raw)) return { action: "next" };
  if (/\b(prev|back|previous)\b/i.test(raw)) return { action: "prev" };
  const n = raw.match(/\bslide\s+(\d{1,2})\b/i);
  return { action: n ? "goto" : "", index: n ? Number(n[1]) - 1 : null };
}

export function stepPitchIndex(index, delta, count) {
  const n = Math.max(1, Number(count) || 1);
  return ((Number(index) || 0) + Number(delta) + n * 8) % n;
}

function bulletText(b) {
  return typeof b === "string" ? b : String(b?.text || "");
}

export function renderPitchPage(ctx, page, { w = 768, h = 512, pageNo = 1, pageCount = 1, token = MKTPITCH1_TOKEN } = {}) {
  if (!ctx || !page) return;
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(20, 20, w - 40, h - 40);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(20, 20, w - 40, 72);
  ctx.fillStyle = "#38bdf8";
  ctx.font = "600 15px system-ui,sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(page.kicker || token, 36, 46);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 26px system-ui,sans-serif";
  ctx.fillText(String(page.title || "").slice(0, 46), 36, 76);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 14px system-ui,sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${pageNo} / ${pageCount}`, w - 36, 48);
  ctx.fillStyle = "#64748b";
  ctx.font = "600 12px system-ui,sans-serif";
  ctx.fillText("← point left  ·  point right →", w - 36, 68);
  ctx.textAlign = "left";
  (page.bullets || []).forEach((b, i) => {
    const y = 128 + i * 72;
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(36, y - 32, w - 72, 58);
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 18px system-ui,sans-serif";
    ctx.fillText(bulletText(b).slice(0, 72), 48, y);
  });
}

export function mountPitchDeck(host, { deck = SOCIAL_GROWTH_PITCH, onStep } = {}) {
  if (!host) return null;
  let index = 0;
  const pages = deck.pages || SOCIAL_GROWTH_PITCH.pages;
  host.innerHTML = `
    <p class="muted small">Pitch deck · ${MKTPITCH1_TOKEN} · keep ${MKTPRES1_KEEP} · point left/right to step (Bambu Draw/point)</p>
    <div class="sb-ide-tools">
      <button type="button" class="btn secondary btn-compact" data-pitch-prev>Prev</button>
      <span data-pitch-page class="muted small">1 / ${pages.length}</span>
      <button type="button" class="btn secondary btn-compact" data-pitch-next>Next</button>
      <span data-pitch-hit class="muted small">Point the PDF</span>
    </div>
    <canvas id="sb-pitch-slide" class="sb-pitch-slide" width="768" height="512" aria-label="Pitch PDF slide"></canvas>
  `;
  const canvas = host.querySelector("#sb-pitch-slide");
  const ctx = canvas?.getContext?.("2d");
  const pageLabel = host.querySelector("[data-pitch-page]");
  const hitLabel = host.querySelector("[data-pitch-hit]");

  function paint() {
    if (!ctx) return;
    const page = pages[index];
    renderPitchPage(ctx, page, { w: canvas.width, h: canvas.height, pageNo: index + 1, pageCount: pages.length });
    if (pageLabel) pageLabel.textContent = `${index + 1} / ${pages.length}`;
  }

  function step(delta, why = "control") {
    index = stepPitchIndex(index, delta, pages.length);
    if (hitLabel) hitLabel.textContent = why === "point" ? (delta < 0 ? "Pointed left → prev" : "Pointed right → next") : `Slide ${index + 1}`;
    paint();
    onStep?.({ index, delta, token: MKTPITCH1_TOKEN, page: pages[index] });
    return { index, token: MKTPITCH1_TOKEN };
  }

  function applyPoint(uv) {
    const delta = uvToSlideDelta(uv);
    if (!delta) {
      if (hitLabel) hitLabel.textContent = "Center: talk track. Point a side to step.";
      return { index, delta: 0, token: MKTPITCH1_TOKEN };
    }
    return step(delta, "point");
  }

  host.querySelector("[data-pitch-prev]")?.addEventListener("click", () => step(-1));
  host.querySelector("[data-pitch-next]")?.addEventListener("click", () => step(1));
  canvas?.addEventListener("pointerdown", (ev) => {
    const box = canvas.getBoundingClientRect();
    applyPoint({ x: (ev.clientX - box.left) / box.width, y: 1 - (ev.clientY - box.top) / box.height });
  });
  paint();
  try { globalThis.Render3DPitchDeck = { token: MKTPITCH1_TOKEN, step, point: applyPoint, pageIndex: () => index }; } catch { /* node */ }
  return { token: MKTPITCH1_TOKEN, step, point: applyPoint, pageIndex: () => index, next: () => step(1), prev: () => step(-1) };
}

export function mountPitchNotes(host, { deck = SOCIAL_GROWTH_PITCH, rndPath = "curriculum/rnd-benchmarks.md" } = {}) {
  if (!host) return null;
  host.innerHTML = `
    <p class="muted small">Notes / MD · pitch outline (${MKTPITCH1_TOKEN}) + RnD plan</p>
    <div class="sb-ide-tabs" role="tablist">
      <button type="button" role="tab" data-notes-tab="pitch" aria-selected="true">Pitch outline</button>
      <button type="button" role="tab" data-notes-tab="rnd" aria-selected="false">RnD benchmarks</button>
    </div>
    <textarea class="sb1-code" id="sb-notes" readonly></textarea>
  `;
  const ta = host.querySelector("#sb-notes");
  if (ta) ta.value = pitchOutline(deck);
  host.querySelectorAll("[data-notes-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      host.querySelectorAll("[data-notes-tab]").forEach((b) => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
      const which = btn.getAttribute("data-notes-tab");
      if (which === "pitch") {
        ta.value = pitchOutline(deck);
        return;
      }
      try {
        const res = await fetch("/mcp/sandbox/file?path=" + encodeURIComponent(rndPath) + "&t=" + Date.now());
        const data = res.ok ? await res.json() : {};
        ta.value = data.text || `Missing ${rndPath}`;
      } catch {
        ta.value = `Could not load ${rndPath}`;
      }
    });
  });
  return { token: MKTPITCH1_TOKEN };
}

export function paintSandboxPitchFile(view, path, text, bytesB64) {
  if (!view) return false;
  const rel = String(path || "");
  const isPitch = /pitch/i.test(rel);
  if (!isPitch) return false;
  if (rel.endsWith(".pdf") && bytesB64) {
    view.innerHTML = `
      <p class="muted small">${esc(rel)} · ${MKTPITCH1_TOKEN} · iframe PDF · point sides in the Pitch tab to step</p>
      <iframe class="sb1-doc" title="${esc(rel)}" src="data:application/pdf;base64,${bytesB64}"></iframe>
    `;
    return true;
  }
  if (rel.endsWith(".md") || rel.endsWith(".txt")) {
    const deck = deckFromMarkdown(text, { title: rel });
    mountPitchDeck(view, { deck });
    return true;
  }
  return false;
}
