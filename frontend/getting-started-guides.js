/** Shared Getting Started feature guides + GIF catalog for Docs and Render Agent. */

export const GETTING_STARTED_CATEGORIES = [
  { id: "ai-cad", title: "AI CAD" },
  { id: "projects", title: "Projects & collaboration" },
  { id: "modeling", title: "Modeling & viewport" },
  { id: "sketch-canvas", title: "Sketch & Canvas" },
  { id: "rigging", title: "Rigging & motion" },
  { id: "wiring", title: "Wiring" },
  { id: "cloud", title: "Cloud CAD" },
  { id: "help", title: "Help & preferences" },
];

const GIF = {
  ai: "/docs/media/ai-generate.gif?v=20260715-real",
  workspaces: "/docs/media/workspaces.gif?v=20260715-real",
  share: "/docs/media/share-folder.gif?v=20260715-real",
  markup: "/docs/media/reference-markup.gif?v=20260715-real",
  canvas: "/docs/media/canvas.gif?v=20260715-real",
  picks: "/docs/media/picks.gif?v=20260715-real",
  wiring: "/docs/media/wiring.gif?v=20260715-real",
  cloud: "/docs/media/cloud-sync.gif?v=20260715-real",
  agent: "/docs/media/render-agent.gif?v=20260715-real",
};

export const GETTING_STARTED_GUIDES = [
  {
    id: "ai-generate",
    category: "ai-cad",
    title: "Generate CAD with AI",
    demo: "generate",
    gif: GIF.ai,
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
    id: "multi-gen",
    category: "ai-cad",
    title: "Parallel generations",
    demo: "generate",
    gif: GIF.ai,
    summary: "Run multiple CAD prompts at once (up to 5). Stop one job or all from the viewport banner.",
    steps: [
      "Start Generate while another job is still running.",
      "Watch per-prompt progress rows in the viewport banner.",
      "Click View more for details; Stop opens a picker when several are running.",
    ],
    ask: "How do parallel CAD generations and Stop generating work?",
    keywords: ["parallel", "multi gen", "stop generating", "multiple prompts", "banner"],
  },
  {
    id: "picks",
    category: "ai-cad",
    title: "Pick faces, edges & paths",
    demo: "picks",
    gif: GIF.picks,
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
    id: "workspaces",
    category: "projects",
    title: "Workspaces & teammates",
    demo: "workspaces",
    gif: GIF.workspaces,
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
    category: "projects",
    title: "Share a private folder",
    demo: "share",
    gif: GIF.share,
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
    category: "projects",
    title: "Reference files, pen markup & Send to AI",
    demo: "markup",
    gif: GIF.markup,
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
    id: "solid-tools",
    category: "modeling",
    title: "Solid modeling tools",
    demo: "picks",
    gif: GIF.picks,
    summary: "Use the SOLID tab ribbon and Tools panel for extrude, Press-Pull, fillet, transform, color, and measure.",
    steps: [
      "Switch to the SOLID design tab.",
      "Use Ribbon Create / Modify / Pattern for features.",
      "Open Right → Tools for Press-Pull, Transform (G), Color, Measure, Split.",
      "Toggle Section, Grid, Transparent, and Fit as needed.",
    ],
    ask: "What solid modeling tools and viewport controls should I learn first?",
    keywords: ["solid", "press-pull", "fillet", "extrude", "transform", "gizmo", "measure", "section"],
  },
  {
    id: "canvas",
    category: "sketch-canvas",
    title: "Canvas sketch mode",
    demo: "canvas",
    gif: GIF.canvas,
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
    id: "sketch",
    category: "sketch-canvas",
    title: "Constrained Sketch",
    demo: "canvas",
    gif: GIF.canvas,
    summary: "Create a constrained 2D sketch on a plane, then extrude it into a solid.",
    steps: [
      "Open the SKETCH design tab and start a sketch on XY/XZ/YZ or a face.",
      "Draw with Line, Rectangle, Circle; add constraints and dimensions.",
      "Finish Sketch, then Extrude (new / add / cut).",
    ],
    ask: "How do I create a constrained sketch and extrude it?",
    keywords: ["sketch tab", "constraints", "extrude sketch", "dimension"],
  },
  {
    id: "rigging-urdf",
    category: "rigging",
    title: "Rigging, URDF / SRDF & Motion",
    demo: "generate",
    gif: GIF.ai,
    summary: "GLB shows the shape; URDF/SRDF drive simulation. Author Jake generators, then open Motion.",
    steps: [
      "Build the solid on SOLID, then open RIGGING.",
      "Switch to URDF / SRDF mode in the Rigging panel.",
      "Select the CAD Python source → Author URDF/SRDF with AI (Jake) or Generate.",
      "Inspect the link/joint tree, then Open URDF / SRDF Motion.",
      "After generate, if the model looks articulated, accept the simulated-motion popup (Preferences can remember your choice).",
    ],
    ask: "How do I generate URDF/SRDF for a robot and open the Motion workbench?",
    keywords: [
      "rigging", "urdf", "srdf", "motion", "jake", "gen_urdf", "gen_srdf",
      "simulated motion", "bones", "joints",
    ],
  },
  {
    id: "wiring",
    category: "wiring",
    title: "Wiring Simulator",
    demo: "wiring",
    gif: GIF.wiring,
    summary: "Switch to Wiring to breadboard circuits, link CAD parts into the wiring prompt, and validate drivers.",
    steps: [
      "Open your project and switch to the WIRING design tab.",
      "To link a 3D model to the Wiring AI prompt: drag the component from the left project browser into the Wiring prompt box — a reference chip appears.",
      "Or drop the component onto the wiring board to place it as a part with pins.",
      "Describe the circuit in the wiring prompt and Generate.",
      "Wire pin-to-pin; run validation for motors/drivers. Optional: attach a breadboard photo.",
    ],
    ask: "How do I use the Wiring Simulator, including linking a 3D model to the wiring prompt, AI generate, and validation?",
    keywords: [
      "wiring", "wire", "wirign", "wireing", "circuit", "breadboard", "wiring simulator",
      "gpio", "schematic", "arduino", "esp32", "wiring prompt", "link model", "3d model",
      "drag component", "component reference", "wiring canvas",
    ],
  },
  {
    id: "cloud-sync",
    category: "cloud",
    title: "Fusion 360 & Onshape sync",
    demo: "cloud",
    gif: GIF.cloud,
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
    category: "help",
    title: "Render Agent help chat",
    demo: "agent",
    gif: GIF.agent,
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
  {
    id: "preferences",
    category: "help",
    title: "Preferences & simulated motion",
    demo: "agent",
    gif: GIF.agent,
    summary: "Set mouse controls, theme, and whether to ask for URDF/SRDF after articulated CAD generates.",
    steps: [
      "Open Account → Preferences.",
      "Choose mouse preset and dark/light appearance.",
      "Under Simulated motion, pick Ask each time, Always URDF/SRDF, or Never ask.",
      "You can also remember a choice from the post-generate popup.",
    ],
    ask: "Where do I change Preferences and the simulated-motion after-generate setting?",
    keywords: ["preferences", "theme", "mouse", "simulated motion", "settings"],
  },
  {
    id: "tips-tricks",
    category: "help",
    title: "Tips and tricks",
    demo: "tips",
    gif: GIF.ai,
    summary: "Fast workflow habits that make prompts, references, collaboration, and edits work better.",
    steps: [
      "In the Project browser, click one file, then hold Shift and click another file to select a range.",
      "Drag selected project files into the AI prompt to attach them as references for the next generation.",
      "Use @face, @edge, @path, and @component chips instead of describing locations in plain language.",
      "Keep the first prompt focused on the main object, then revise the selected result with smaller edits.",
      "Use Send to AI from marked-up PDFs/images when callouts or notes matter.",
      "Share folders or share model links when you need teammates or clients to review the same context.",
    ],
    ask: "Give me practical Render3D tips and tricks for selecting files, dragging references into the AI prompt, using geometry picks, and getting better CAD generations.",
    keywords: [
      "tips", "tricks", "shift select", "multiple files", "drag files", "drag to prompt",
      "project browser", "project files", "attach references", "reference files", "best practices",
      "workflow", "chips", "@component", "@face", "@edge", "send to ai",
    ],
  },
];

export function guidesByCategory() {
  return GETTING_STARTED_CATEGORIES.map((cat) => ({
    ...cat,
    guides: GETTING_STARTED_GUIDES.filter((g) => g.category === cat.id),
  })).filter((row) => row.guides.length);
}

export function matchGettingStartedGuides(question, { limit = 2 } = {}) {
  let text = String(question || "").toLowerCase().trim();
  if (!text) return [];
  for (const [src, dst] of [
    ["wirign", "wiring"],
    ["wireing", "wiring"],
    ["schemtic", "schematic"],
    ["bredboard", "breadboard"],
  ]) {
    text = text.replaceAll(src, dst);
  }

  for (const guide of GETTING_STARTED_GUIDES) {
    const ask = String(guide.ask || "").toLowerCase().trim();
    if (!ask) continue;
    if (text === ask) return [guide];
    if (text.length > 28 && ask.length > 28 && (text.includes(ask.slice(0, 56)) || ask.includes(text.slice(0, 56)))) {
      return [guide];
    }
  }

  const tourHints = ["tour", "getting started", "new user", "how do i start", "onboarding", "for a new user"];
  const isTour = tourHints.some((hint) => text.includes(hint));

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
    if (isTour && ["ai-generate", "workspaces", "share-folders", "render-agent"].includes(guide.id)) {
      score += 3;
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
