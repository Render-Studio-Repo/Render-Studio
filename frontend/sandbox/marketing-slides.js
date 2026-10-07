/** Marketing AI slide deck — PDF-page slideshow + Draw-circle point. Token mktpres1. No extra WebGL. */
export const MKTPRES1_TOKEN = "mktpres1";
export const MARKETING_SLIDES_AGENT = "vibe-marketing";

export const GROW_SOCIAL_DECK = Object.freeze({
  id: "grow-social",
  title: "Grow social presence",
  agent: MARKETING_SLIDES_AGENT,
  source: "mcp/grok-bot/MARKETING.md §2 X posting guidance",
  token: MKTPRES1_TOKEN,
  pages: [
    {
      id: "p1",
      title: "Grow Render Studio on social",
      kicker: "Marketing · mktpres1",
      bullets: [
        { id: "p1-name", text: "Always say Render Studio + https://render3d.app", nx: 0.50, ny: 0.40 },
        { id: "p1-mix", text: "Post what the product already ships — GIF, Record, screenshot", nx: 0.50, ny: 0.56 },
        { id: "p1-draft", text: "Draft X first (confirm=false). Live needs a human confirm.", nx: 0.50, ny: 0.72 },
      ],
    },
    {
      id: "p2",
      title: "Media that actually grows reach",
      kicker: "MARKETING.md media table",
      bullets: [
        { id: "p2-png", text: "PNG/JPG — logo, OG, tool still. Share-to-X image max 5 MB.", nx: 0.50, ny: 0.38 },
        { id: "p2-gif", text: "GIF — 2–6s tool loops (finder, catalog, canvas, wiring).", nx: 0.50, ny: 0.54 },
        { id: "p2-mp4", text: "MP4 — Viewport Record / VR spectator. Prefer H.264 16:9.", nx: 0.50, ny: 0.70 },
      ],
    },
    {
      id: "p3",
      title: "Share-to-X is the growth loop",
      kicker: "Record → done popup → compose",
      bullets: [
        { id: "p3-flow", text: "Record → stop → You’re done recording → Share to X.", nx: 0.50, ny: 0.38 },
        { id: "p3-cap", text: "Caption: Built in Render Studio https://render3d.app", nx: 0.50, ny: 0.54 },
        { id: "p3-same", text: "Same path from markup, clip editor, VR POV, Reference Files.", nx: 0.50, ny: 0.70 },
      ],
    },
    {
      id: "p4",
      title: "Cadence after the live URL",
      kicker: "Music + check-in",
      bullets: [
        { id: "p4-music", text: "grok_taste then grok_music_request (reason x_post).", nx: 0.50, ny: 0.38 },
        { id: "p4-check", text: "Check days 1–3, then weekly × 4. Sentiment + what drove views.", nx: 0.50, ny: 0.54 },
        { id: "p4-week", text: "Upload grok_social_weekly. Management → Social media.", nx: 0.50, ny: 0.70 },
      ],
    },
    {
      id: "p5",
      title: "This week’s proof (no invented URLs)",
      kicker: "Real Studio surfaces",
      bullets: [
        { id: "p5-vr", text: "Quest splash + Enter VR — record a spectator orbit.", nx: 0.50, ny: 0.38 },
        { id: "p5-acct", text: "Accounts: @a1_projects and @winstead_works — no fake follower counts.", nx: 0.50, ny: 0.54 },
        { id: "p5-no", text: "Never tweet secrets, TOTP, or invented tweet URLs.", nx: 0.50, ny: 0.70 },
      ],
    },
  ],
});

export function slidePage(deck, index) {
  const pages = deck?.pages || GROW_SOCIAL_DECK.pages;
  const n = pages.length;
  const i = ((Number(index) || 0) % n + n) % n;
  return pages[i];
}

export function pointCircleOnSlide(nx, ny, radius = 0.09) {
  return {
    x: Math.min(1, Math.max(0, Number(nx) || 0)),
    y: Math.min(1, Math.max(0, Number(ny) || 0)),
    r: Math.max(0.04, Number(radius) || 0.09),
  };
}

/** Draw-circle targeting: bullets whose anchors sit inside the pointed circle. */
export function targetsInCircle(page, circle) {
  const c = circle || {};
  const r = Math.max(0.04, Number(c.r) || 0.09);
  const hits = [];
  for (const bullet of page?.bullets || []) {
    const d = Math.hypot((Number(bullet.nx) || 0) - (Number(c.x) || 0), (Number(bullet.ny) || 0) - (Number(c.y) || 0));
    if (d <= r) hits.push({ ...bullet, dist: d });
  }
  hits.sort((a, b) => a.dist - b.dist);
  return hits;
}

export function pointSlide(page, uv, radius = 0.09) {
  const nx = Number(uv?.x ?? uv?.[0]);
  const ny = 1 - Number(uv?.y ?? uv?.[1] ?? 0);
  const circle = pointCircleOnSlide(nx, Number.isFinite(ny) ? ny : Number(uv?.y ?? 0), radius);
  const hits = targetsInCircle(page, circle);
  return { circle, hits, pointed: hits[0] || null, token: MKTPRES1_TOKEN };
}

export function renderSlidePage(ctx, page, { w = 768, h = 512, pointedId = "", circle = null, pageNo = 1, pageCount = 1 } = {}) {
  if (!ctx || !page) return;
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(18, 18, w - 36, h - 36);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(18, 18, w - 36, 64);
  ctx.fillStyle = "#38bdf8";
  ctx.font = "600 16px system-ui,sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(page.kicker || "PDF slide", 36, 44);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 26px system-ui,sans-serif";
  ctx.fillText(String(page.title || "").slice(0, 42), 36, 70);
  ctx.fillStyle = "#64748b";
  ctx.font = "600 14px system-ui,sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${pageNo} / ${pageCount}`, w - 36, 44);
  ctx.textAlign = "left";
  for (const bullet of page.bullets || []) {
    const x = 48;
    const y = 120 + (page.bullets.indexOf(bullet) * 78);
    const on = bullet.id === pointedId;
    ctx.fillStyle = on ? "#e0f2fe" : "#e2e8f0";
    ctx.fillRect(36, y - 36, w - 72, 64);
    ctx.strokeStyle = on ? "#0ea5e9" : "#cbd5e1";
    ctx.lineWidth = on ? 3 : 1;
    ctx.strokeRect(36, y - 36, w - 72, 64);
    ctx.fillStyle = on ? "#0369a1" : "#0f172a";
    ctx.font = "600 20px system-ui,sans-serif";
    ctx.fillText(String(bullet.text || "").slice(0, 62), x, y);
  }
  if (circle) {
    ctx.beginPath();
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.arc(circle.x * w, circle.y * h, circle.r * Math.min(w, h), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Left/right thirds step pages (same Draw/point as Bambu plates). Center still targets bullets. */
export function uvToSlideStep(uv) {
  const x = Number(uv?.x ?? uv?.[0]);
  if (!Number.isFinite(x)) return 0;
  if (x < 0.28) return -1;
  if (x > 0.72) return 1;
  return 0;
}

export function mountMarketingPdfDeck(host, { deck = GROW_SOCIAL_DECK, onPoint } = {}) {
  if (!host) return null;
  let index = 0;
  let pointedId = "";
  let circle = null;
  host.innerHTML = `
    <p class="muted small">Marketing PDF deck · ${MKTPRES1_TOKEN} · point a bullet (Draw-circle). Source: MARKETING.md</p>
    <div class="sb-ide-tools">
      <button type="button" class="btn secondary btn-compact" data-mkt-prev>Prev</button>
      <span data-mkt-page class="muted small">1 / ${deck.pages.length}</span>
      <button type="button" class="btn secondary btn-compact" data-mkt-next>Next</button>
      <span data-mkt-hit class="muted small">Point a slide</span>
    </div>
    <canvas id="sb-mkt-slide" width="768" height="512" aria-label="Marketing PDF slide"></canvas>
  `;
  const canvas = host.querySelector("#sb-mkt-slide");
  const ctx = canvas.getContext("2d");
  const pageLabel = host.querySelector("[data-mkt-page]");
  const hitLabel = host.querySelector("[data-mkt-hit]");

  function paint() {
    const page = slidePage(deck, index);
    renderSlidePage(ctx, page, {
      w: canvas.width,
      h: canvas.height,
      pointedId,
      circle,
      pageNo: index + 1,
      pageCount: deck.pages.length,
    });
    if (pageLabel) pageLabel.textContent = `${index + 1} / ${deck.pages.length}`;
  }

  function applyPoint(uv) {
    const step = uvToSlideStep(uv);
    if (step) {
      index = (index + step + deck.pages.length) % deck.pages.length;
      pointedId = "";
      circle = null;
      paint();
      const result = { stepped: step, pageIndex: index, token: MKTPRES1_TOKEN, pointed: null, hits: [] };
      onPoint?.(result, slidePage(deck, index), index);
      return result;
    }
    const page = slidePage(deck, index);
    const result = pointSlide(page, uv);
    circle = result.circle;
    pointedId = result.pointed?.id || "";
    if (hitLabel) hitLabel.textContent = result.pointed ? result.pointed.text : "No bullet in circle";
    paint();
    onPoint?.(result, page, index);
    return result;
  }

  host.querySelector("[data-mkt-prev]")?.addEventListener("click", () => {
    index = (index - 1 + deck.pages.length) % deck.pages.length;
    pointedId = "";
    circle = null;
    paint();
  });
  host.querySelector("[data-mkt-next]")?.addEventListener("click", () => {
    index = (index + 1) % deck.pages.length;
    pointedId = "";
    circle = null;
    paint();
  });
  canvas.addEventListener("pointerdown", (ev) => {
    const box = canvas.getBoundingClientRect();
    applyPoint({ x: (ev.clientX - box.left) / box.width, y: 1 - (ev.clientY - box.top) / box.height });
  });
  paint();
  return {
    token: MKTPRES1_TOKEN,
    next: () => host.querySelector("[data-mkt-next]")?.click(),
    prev: () => host.querySelector("[data-mkt-prev]")?.click(),
    point: applyPoint,
    pageIndex: () => index,
  };
}
