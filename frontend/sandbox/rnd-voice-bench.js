/** RnD VR Voice Bench PDF demo. Token rnddemo1. Keep mktpres1 + rndbench1. No extra WebGL. */
import {
  pointSlide,
  renderSlidePage,
  slidePage,
  uvToSlideStep,
} from "./marketing-slides.js?v=mktpres1-mktpitch1";
import { bargeIn, enqueueSpeak, TTSTURN1_CACHE } from "./tts-mutex.js?v=sandbox1&ttsturn1=1&singlevoice1";

export const RNDDEMO1_TOKEN = "rnddemo1";
export const RNDDEMO1_KEEP = Object.freeze(["mktpres1", "rndbench1"]);
export const VOICE_BENCH_PDF = "examples/rnd-voice-bench.pdf";
export const VOICE_BENCH_AGENT = "vibe-rnd";

export const VOICE_BENCH_DECK = Object.freeze({
  id: "rnd-voice-bench",
  title: "RnD Performance Report + VR Voice Bench",
  agent: VOICE_BENCH_AGENT,
  source: VOICE_BENCH_PDF,
  token: RNDDEMO1_TOKEN,
  keep: RNDDEMO1_KEEP,
  cycle: "CYCLE-20260916",
  pages: [
    {
      id: "p1",
      title: "1. Executive answer",
      kicker: "Rick · rnddemo1 · keep mktpres1/rndbench1",
      bullets: [
        { id: "p1-cycle", text: "CYCLE-20260916 Voice Bench is the walkthrough, not a second WebGL.", nx: 0.50, ny: 0.40 },
        { id: "p1-pdf", text: "Load examples/rnd-voice-bench.pdf in the sandbox PDF viewer.", nx: 0.50, ny: 0.56 },
        { id: "p1-sam", text: "Sam can interrupt with a suggestion. Turn-taking is ttsturn1.", nx: 0.50, ny: 0.72 },
      ],
    },
    {
      id: "p2",
      title: "2. Performance scorecard",
      kicker: "This cycle · VR Voice Bench",
      bullets: [
        { id: "p2-voice", text: "Voice activation: one speaker at a time (mutex overlap 0).", nx: 0.50, ny: 0.38 },
        { id: "p2-scene", text: "Scene: existing XR round table. Laser/point like marketing slides.", nx: 0.50, ny: 0.54 },
        { id: "p2-metrics", text: "Metrics: WebGL=1, sandbox jail, harness apply=false.", nx: 0.50, ny: 0.70 },
      ],
    },
    {
      id: "p3",
      title: "3. Pass bar + deliverables",
      kicker: "Scenarios (actionable)",
      bullets: [
        { id: "p3-laser", text: "Controller pointer advances/highlights like a person presenting.", nx: 0.50, ny: 0.38 },
        { id: "p3-pass", text: "Pass bar (first run): Rick walks pages; Sam suggestions barge in.", nx: 0.50, ny: 0.54 },
        { id: "p3-harness", text: "Deliverables for harness stay queued. Never auto-apply.", nx: 0.50, ny: 0.70 },
      ],
    },
    {
      id: "p4",
      title: "4. RnD recommendations (next)",
      kicker: "Identity · Rick presenting",
      bullets: [
        { id: "p4-tasks", text: "Per-agent task lists: Sam assigns; seats + sandbox both show them.", nx: 0.50, ny: 0.38 },
        { id: "p4-ledger", text: "When a task completes, Ledger announces status on team chat.", nx: 0.50, ny: 0.54 },
        { id: "p4-feed", text: "Live stats / performance JSON panel loads those task statuses.", nx: 0.50, ny: 0.70 },
      ],
    },
  ],
});

export function isSamSuggestionVoice(text = "") {
  const s = String(text || "").toLowerCase().replace(/[.!?]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return false;
  if (/\b(don'?t|do not|never)\b.{0,20}\b(interrupt|suggest)\b/.test(s)) return false;
  return (
    /\b(sam'?s? suggestion|suggestion from sam)\b/.test(s)
    || /\b(hold on|wait rick|interrupt|let me suggest)\b/.test(s)
    || /\b(suggestion|suggest we|try this instead)\b/.test(s)
  );
}

export function applySamSuggestion(text = "", { presenter = VOICE_BENCH_AGENT } = {}) {
  const line = String(text || "").trim().slice(0, 220);
  const barged = bargeIn("sam suggestion");
  const ack = line
    ? `Sam suggestion: ${line}. Rick yielding, then continuing.`
    : "Sam suggestion taken. Rick yielding the floor.";
  return enqueueSpeak(presenter, ack, { force: true, topic: "rnd bench suggestion" }).then((spoken) => ({
    ...barged,
    spoken: spoken?.spoken,
    text: ack,
    token: TTSTURN1_CACHE,
    keep: RNDDEMO1_KEEP,
  }));
}

export function walkthroughScript(deck = VOICE_BENCH_DECK) {
  const pages = deck.pages || [];
  const turns = [{
    id: presenterId(deck),
    text: `${deck.title}. Token ${RNDDEMO1_TOKEN}. I will walk this like a person with the laser.`,
    pageIndex: 0,
  }];
  pages.forEach((page, i) => {
    turns.push({
      id: presenterId(deck),
      text: `Page ${i + 1}. ${page.title}.`,
      pageIndex: i,
    });
    for (const b of page.bullets || []) {
      turns.push({
        id: presenterId(deck),
        text: String(b.text || ""),
        pageIndex: i,
        pointedId: b.id,
      });
    }
  });
  return turns;
}

function presenterId(deck) {
  return String(deck?.agent || VOICE_BENCH_AGENT);
}

export function mountVoiceBenchDeck(host, { deck = VOICE_BENCH_DECK, onPoint } = {}) {
  if (!host) return null;
  let index = 0;
  let pointedId = "";
  let circle = null;
  host.innerHTML = `
    <p class="muted small">VR Voice Bench · ${RNDDEMO1_TOKEN} · keep ${RNDDEMO1_KEEP.join("/")} · ${VOICE_BENCH_PDF}</p>
    <div class="sb-ide-tools">
      <button type="button" class="btn secondary btn-compact" data-rnd-prev>Prev</button>
      <span data-rnd-page class="muted small">1 / ${deck.pages.length}</span>
      <button type="button" class="btn secondary btn-compact" data-rnd-next>Next</button>
      <button type="button" class="btn accent btn-compact" data-rnd-walk>Walk through</button>
      <span data-rnd-hit class="muted small">Point like a person</span>
    </div>
    <canvas id="sb-rnd-slide" width="768" height="512" aria-label="VR Voice Bench PDF slide"></canvas>
    <iframe class="sb1-doc" title="${VOICE_BENCH_PDF}" src="/sandbox/${VOICE_BENCH_PDF}"></iframe>
  `;
  const canvas = host.querySelector("#sb-rnd-slide");
  const ctx = canvas?.getContext?.("2d");
  const pageLabel = host.querySelector("[data-rnd-page]");
  const hitLabel = host.querySelector("[data-rnd-hit]");

  function paint() {
    if (!ctx) return;
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
      if (hitLabel) hitLabel.textContent = step < 0 ? "Pointed left → prev" : "Pointed right → next";
      const result = { stepped: step, pageIndex: index, token: RNDDEMO1_TOKEN, keep: RNDDEMO1_KEEP, pointed: null, hits: [] };
      onPoint?.(result, slidePage(deck, index), index);
      return result;
    }
    const page = slidePage(deck, index);
    const result = { ...pointSlide(page, uv), token: RNDDEMO1_TOKEN, keep: RNDDEMO1_KEEP, pageIndex: index };
    circle = result.circle;
    pointedId = result.pointed?.id || "";
    paint();
    if (hitLabel) hitLabel.textContent = result.pointed ? `Laser: ${result.pointed.text}` : "Center: highlight a bullet";
    if (result.pointed) enqueueSpeak(VOICE_BENCH_AGENT, result.pointed.text, { topic: "rnd bench" });
    onPoint?.(result, page, index);
    return result;
  }

  host.querySelector("[data-rnd-prev]")?.addEventListener("click", () => applyPoint({ x: 0.1, y: 0.5 }));
  host.querySelector("[data-rnd-next]")?.addEventListener("click", () => applyPoint({ x: 0.9, y: 0.5 }));
  host.querySelector("[data-rnd-walk]")?.addEventListener("click", () => startVoiceBenchWalkthrough({ deck, go: (i) => { index = i; pointedId = ""; circle = null; paint(); } }));
  canvas?.addEventListener("pointerdown", (ev) => {
    const box = canvas.getBoundingClientRect();
    applyPoint({ x: (ev.clientX - box.left) / box.width, y: 1 - (ev.clientY - box.top) / box.height });
  });
  paint();
  try {
    globalThis.Render3DVoiceBench = {
      token: RNDDEMO1_TOKEN,
      point: applyPoint,
      pageIndex: () => index,
      suggest: applySamSuggestion,
    };
  } catch { /* node */ }
  return { token: RNDDEMO1_TOKEN, point: applyPoint, pageIndex: () => index, keep: RNDDEMO1_KEEP };
}

export async function startVoiceBenchWalkthrough({ deck = VOICE_BENCH_DECK, go } = {}) {
  const turns = walkthroughScript(deck);
  for (const turn of turns) {
    if (typeof go === "function") go(turn.pageIndex || 0);
    await enqueueSpeak(turn.id, turn.text, { topic: "rnd bench walkthrough" });
  }
  return { ok: true, token: RNDDEMO1_TOKEN, pages: deck.pages.length, keep: RNDDEMO1_KEEP };
}
