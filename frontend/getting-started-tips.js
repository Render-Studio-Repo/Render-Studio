/** Rotating get-started tips for Render Agent + CAD prompt panel. */

export const GETTING_STARTED_TIPS = [
  {
    topic: "Prompting",
    title: "Size + function first",
    body: "Name units, key dims, and the job. Ex: “80×40×12 mm bracket, 2× M4 holes on 50 mm centers.”",
    starter: "Help me rewrite this into a strong CAD prompt: make a phone stand",
  },
  {
    topic: "Prompting",
    title: "One job per generate",
    body: "Build the main solid first, then revise (“add ears”, “tighten clip”). Multi-goal first prompts get messy.",
    starter: "What’s a good first prompt vs follow-up edit for a snap-fit enclosure?",
  },
  {
    topic: "Prompting",
    title: "Name the mating part",
    body: "If it must fit something, say so and attach the STL/STEP so the AI can see the shape.",
    starter: "How do I attach a 3D model as a geometry reference for a clip design?",
  },
  {
    topic: "DXF / drawings",
    title: "Attach DXF + say the 3D intent",
    body: "Drop the .dxf, then: outline / holes / flanges. “Extrude 8 mm, cut holes through” beats “make this 3D.”",
    starter: "How should I prompt when turning a DXF mold profile into a 3D part?",
  },
  {
    topic: "DXF / drawings",
    title: "Clean drawings win",
    body: "Closed polylines, clear layers, real units. Ask the agent to repair messy layers before solids.",
    starter: "My DXF has overlapping lines — what’s the best workflow in Render3D?",
  },
  {
    topic: "DXF / drawings",
    title: "Image → drawing → CAD",
    body: "Attach a sketch/photo, convert to DXF when offered, then generate the solid from that drawing.",
    starter: "How do I go from a sketch photo to a usable DXF and then a STEP model?",
  },
  {
    topic: "Software",
    title: "Use 2.0 for parametric parts",
    body: "2.0 → build123d STEP/GLB. Render for quick mesh edits. Fusion mode when pushing to Fusion 360.",
    starter: "When should I use Render vs 2.0 vs Fusion mode?",
  },
  {
    topic: "Software",
    title: "Pick faces into the prompt",
    body: "Pick mode → click a face/edge → “fillet this @face”. Geometry refs beat “over here.”",
    starter: "How do @face and component references work in the AI prompt?",
  },
  {
    topic: "Software",
    title: "Drop CAD refs for fit",
    body: "Attach STEP/STL/GLB/3MF for size and shape views — great for clips, cradles, and fixtures.",
    starter: "Show me how to design a clip around an uploaded STL reference",
  },
  {
    topic: "Software",
    title: "Revise, don’t restart",
    body: "If it’s close, stop and edit the selected object. Change only the failing feature.",
    starter: "Best practices for revise/edit prompts after a nearly-good generate?",
  },
  {
    topic: "Prompting",
    title: "Say manufacturing intent",
    body: "Printable / machined / sheet-metal / snap-fit changes walls, draft, fillets, and body splits.",
    starter: "Write a prompt template for FDM-printable snap-fit boxes",
  },
  {
    topic: "DXF / drawings",
    title: "Multi-layer DXF assemblies",
    body: "Ask for separate named bodies (base, lid, insert) — not one fused blob.",
    starter: "How do I get separate named parts from a multi-layer DXF?",
  },
];

const TIP_INDEX_KEY = "render3d:getting-started-tip:v1";

function readIndex() {
  try {
    const raw = Number(localStorage.getItem(TIP_INDEX_KEY));
    if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw) % GETTING_STARTED_TIPS.length;
  } catch {
    /* ignore */
  }
  return 0;
}

function writeIndex(index) {
  try {
    localStorage.setItem(TIP_INDEX_KEY, String(index % GETTING_STARTED_TIPS.length));
  } catch {
    /* ignore */
  }
}

/** Advance tip on every page load / hard refresh. */
export function bumpTipOnRefresh() {
  const next = (readIndex() + 1) % GETTING_STARTED_TIPS.length;
  writeIndex(next);
  return next;
}

/** Advance tip when opening a brand-new empty chat thread. */
export function bumpTipForNewThread() {
  const next = (readIndex() + 1) % GETTING_STARTED_TIPS.length;
  writeIndex(next);
  return next;
}

export function getCurrentTip() {
  return GETTING_STARTED_TIPS[readIndex() % GETTING_STARTED_TIPS.length];
}

export function tipTopicClass(topic = "") {
  const t = String(topic).toLowerCase();
  if (t.includes("dxf") || t.includes("drawing")) return "tip-topic--dxf";
  if (t.includes("software")) return "tip-topic--software";
  return "tip-topic--prompt";
}
