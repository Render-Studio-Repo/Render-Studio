/** Shared Getting Started feature guides + GIF catalog for Docs and Render Agent. */

export const GETTING_STARTED_GUIDES = [
  {
    id: "ai-generate",
    title: "Generate CAD with AI",
    demo: "generate",
    gif: "/docs/media/ai-generate.gif",
    summary: "Describe a part in the prompt panel and Generate creates geometry in your project.",
    steps: [
      "Open a project (or create one) in the left explorer.",
      "Write a clear prompt: size, units, and what the part does.",
      "Optional: attach images, DXF, or @component references.",
      "Choose a mode (Render / 2.0 / Fusion) and click Generate.",
      "Revise with follow-ups instead of restarting from scratch.",
    ],
    ask: "How do I write a strong first CAD generate prompt in Render3D, and when should I use Render vs 2.0 vs Fusion mode?",
    keywords: [
      "generate", "prompt", "cad generate", "ai generate", "first prompt",
      "render mode", "2.0", "fusion mode", "modify with ai", "quality", "speed",
    ],
  },
  {
    id: "workspaces",
    title: "Workspaces & teammates",
    demo: "workspaces",
    gif: "/docs/media/workspaces.gif",
    summary: "Shared workspaces keep projects, folders, and invites in one place for your team.",
    steps: [
      "Open the account / workspace menu and pick or create a workspace.",
      "Invite coworkers by email — they need an account (or get an invite).",
      "Projects in that workspace sync live for members who are online.",
      "Switch workspaces anytime from the same menu.",
    ],
    ask: "How do workspaces, invites, and live collaboration work in Render3D?",
    keywords: [
      "workspace", "workspaces", "teammate", "invite", "collaboration", "team",
      "shared workspace", "coworkers",
    ],
  },
  {
    id: "share-folders",
    title: "Share a private folder",
    demo: "share",
    gif: "/docs/media/share-folder.gif",
    summary: "Keep folders private, then share with specific teammates so they appear instantly in their explorer.",
    steps: [
      "Right-click a folder → Share.",
      "Pick a team member from the dropdown (no need to retype their email).",
      "Leave Private checked so only people you share with can see it.",
      "They see the folder live — no refresh required.",
    ],
    ask: "How do I share a private folder with a teammate, and what do they see on their side?",
    keywords: [
      "share folder", "private folder", "folder share", "share with", "explorer folder",
    ],
  },
  {
    id: "reference-markup",
    title: "Reference files, pen markup & Send to AI",
    demo: "markup",
    gif: "/docs/media/reference-markup.gif",
    summary: "Drop PDFs or images into a project, draw on them, add notes, then send markups into the AI prompt.",
    steps: [
      "Drag a PDF or image into the project (or upload under Reference Files).",
      "It opens in a Docs-style tab beside the 3D viewport.",
      "Click Pen to draw callouts; write notes in the right panel.",
      "Click Save, then Send to AI — marked image + notes go into the prompt.",
      "Or use the AI button on the file in the project browser.",
    ],
    ask: "How do reference file tabs, pen markup on PDFs/images, notes, and Send to AI work together?",
    keywords: [
      "reference", "markup", "pen", "pdf", "send to ai", "annotate", "drawing on",
      "reference file", "notes",
    ],
  },
  {
    id: "canvas",
    title: "Canvas sketch mode",
    demo: "canvas",
    gif: "/docs/media/canvas.gif",
    summary: "Sketch freely on the Canvas design tab, then attach the sketch to your AI prompt.",
    steps: [
      "In Design, switch to the CANVAS tab.",
      "Draw your concept with the canvas tools.",
      "Use Attach / Prompt to drop the sketch into the AI compose panel.",
      "Generate a 3D model that follows the sketch.",
    ],
    ask: "How do I use Canvas mode and attach a sketch to the AI CAD prompt?",
    keywords: ["canvas", "sketch", "canvas mode", "attach sketch", "design tab canvas"],
  },
  {
    id: "picks",
    title: "Pick faces, edges & paths",
    demo: "picks",
    gif: "/docs/media/picks.gif",
    summary: "Click geometry into the prompt as @face / @edge / @path so edits land on the right feature.",
    steps: [
      "Select a pick mode (face, edge, line path, etc.) in the toolbar.",
      "Click the geometry on the model.",
      "A chip like @face-1 appears in the prompt.",
      "Write the edit: “fillet @face-1 2 mm” and Generate.",
    ],
    ask: "How do geometry picks and @face / @path references work in the AI prompt?",
    keywords: ["@face", "@edge", "@path", "pick", "geometry pick", "face pick", "edge pick"],
  },
  {
    id: "wiring",
    title: "Wiring Simulator",
    demo: "wiring",
    gif: "/docs/media/wiring.gif",
    summary: "Switch to Wiring mode to breadboard circuits, drag parts, and validate drivers.",
    steps: [
      "Change workspace mode to Wiring Simulator.",
      "Drag components onto the board or use Wiring AI to generate a circuit.",
      "Wire pin-to-pin; run validation for motors/drivers.",
      "Optional: attach a breadboard photo for matching.",
    ],
    ask: "How do I use the Wiring Simulator, including AI generate and validation?",
    keywords: ["wiring", "circuit", "breadboard", "wiring simulator", "gpio", "schematic"],
  },
  {
    id: "cloud-sync",
    title: "Fusion 360 & Onshape sync",
    demo: "cloud",
    gif: "/docs/media/cloud-sync.gif",
    summary: "Connect cloud CAD libraries so you can import and push models without leaving Studio.",
    steps: [
      "Open the Fusion or Onshape library panel in the left sidebar.",
      "Sign in / connect when prompted.",
      "Browse, import into a project, or push local changes back.",
      "Use Fusion prompt mode when you want Fusion-oriented generation.",
    ],
    ask: "How do I connect Fusion 360 or Onshape and import or push models in Render3D?",
    keywords: ["fusion", "onshape", "cloud sync", "import fusion", "push to fusion", "autodesk"],
  },
  {
    id: "render-agent",
    title: "Render Agent help chat",
    demo: "agent",
    gif: "/docs/media/render-agent.gif",
    summary: "The ribbon Agent button opens a chat for tooling, workflows, and project questions — separate from CAD Generate.",
    steps: [
      "Click Agent in the ribbon (or use Ask Render Agent from Getting Started).",
      "Ask about tools, folders, Fusion, wiring, prompts, etc.",
      "Attach screenshots or files when helpful.",
      "Invite teammates into a thread for shared troubleshooting.",
    ],
    ask: "What can Render Agent help with, and how is it different from the CAD Generate prompt?",
    keywords: ["render agent", "help chat", "ask agent", "assistant", "agent button"],
  },
];

export function matchGettingStartedGuides(question, { limit = 2 } = {}) {
  const text = String(question || "").toLowerCase();
  if (!text.trim()) return [];
  const scored = GETTING_STARTED_GUIDES.map((guide) => {
    let score = 0;
    const title = String(guide.title || "").toLowerCase();
    if (title && text.includes(title)) score += 8;
    if (guide.id && text.includes(String(guide.id).replace(/-/g, " "))) score += 4;
    for (const raw of guide.keywords || []) {
      const kw = String(raw || "").toLowerCase().trim();
      if (!kw) continue;
      if (text.includes(kw)) score += kw.includes(" ") ? 3 : 2;
    }
    for (const step of guide.steps || []) {
      const words = String(step).toLowerCase().split(/\W+/).filter((w) => w.length > 5);
      for (const w of words.slice(0, 6)) {
        if (text.includes(w)) score += 0.35;
      }
    }
    return { guide, score };
  })
    .filter((row) => row.score >= 2.5)
    .sort((a, b) => b.score - a.score || a.guide.title.localeCompare(b.guide.title));
  return scored.slice(0, limit).map((row) => row.guide);
}

export function guideMediaPayload(guide) {
  if (!guide?.gif) return null;
  return {
    id: guide.id,
    title: guide.title,
    url: guide.gif,
    kind: "gif",
    summary: guide.summary || "",
  };
}
