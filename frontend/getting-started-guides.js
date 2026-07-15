/** Shared Getting Started feature guides + GIF catalog for Docs and Render Agent. */

export const GETTING_STARTED_CATEGORIES = [
  {
    "id": "ai-cad",
    "title": "AI CAD & prompting"
  },
  {
    "id": "projects",
    "title": "Projects & collaboration"
  },
  {
    "id": "modeling",
    "title": "Solid modeling & viewport"
  },
  {
    "id": "sketch-canvas",
    "title": "Sketch & Canvas"
  },
  {
    "id": "rigging",
    "title": "Rigging & motion"
  },
  {
    "id": "wiring",
    "title": "Wiring & electronics"
  },
  {
    "id": "cloud",
    "title": "Import, export & cloud CAD"
  },
  {
    "id": "architect",
    "title": "Architect & catalog"
  },
  {
    "id": "help",
    "title": "Help, preferences & skills"
  }
];

export const GETTING_STARTED_GUIDES = [
  {
    "id": "ai-generate",
    "category": "ai-cad",
    "title": "Generate CAD with AI",
    "demo": "generate",
    "gif": "/docs/media/ai-generate.gif?v=20260715-real",
    "summary": "Describe a part; Generate builds geometry into the open project.",
    "steps": [
      "Open or create a project in the left explorer.",
      "Write size, units, and what the part does.",
      "Optional: attach images, DXF, or @component refs.",
      "Pick Render / 2.0 / Fusion and click Generate.",
      "Revise with follow-ups instead of restarting."
    ],
    "ask": "How do I write a strong first CAD generate prompt?",
    "keywords": [
      "generate",
      "prompt",
      "ai generate",
      "render mode",
      "3d model",
      "make a model",
      "make 3d",
      "create a model",
      "create 3d",
      "model on this platform",
      "2.0",
      "fusion"
    ],
    "where": "Right panel \u2192 AI \u2192 Compose"
  },
  {
    "id": "multi-gen",
    "category": "ai-cad",
    "title": "Parallel generations",
    "demo": "generate",
    "gif": "/docs/media/ai-generate.gif?v=20260715-real",
    "summary": "Run up to five CAD prompts at once; stop one or all from the viewport banner.",
    "steps": [
      "Start a Generate while another is still running.",
      "Watch skinny progress rows in the viewport banner.",
      "Use View more for details; Stop opens a picker when several run."
    ],
    "ask": "How do parallel CAD generations and Stop work?",
    "keywords": [
      "parallel",
      "multi gen",
      "stop generating",
      "multiple prompts"
    ],
    "where": "AI Compose + viewport generation overlay"
  },
  {
    "id": "picks",
    "category": "ai-cad",
    "title": "Pick faces, edges & paths",
    "demo": "picks",
    "gif": "/docs/media/picks.gif?v=20260715-robot-arm",
    "summary": "Click geometry into the prompt as @face / @edge / @path chips.",
    "steps": [
      "Choose Face, Edge, Line/path, or related pick mode.",
      "Click the model \u2014 a chip appears in the prompt.",
      "Write the edit, e.g. \u201cfillet @face-1 2 mm\u201d, then Generate."
    ],
    "ask": "How do geometry picks and @face references work?",
    "keywords": [
      "@face",
      "@edge",
      "@path",
      "pick",
      "geometry"
    ],
    "where": "Top toolbar pick modes + AI prompt"
  },
  {
    "id": "link-to-prompt",
    "category": "ai-cad",
    "title": "Link project items to the prompt",
    "demo": "picks",
    "gif": "/docs/media/picks.gif?v=20260715-robot-arm",
    "summary": "Shift-select files in the Project browser and drag them into the AI prompt as @component references.",
    "steps": [
      "In the Project browser, click one file, then Shift-click another to select a range.",
      "Drag the selection into the AI prompt box \u2014 reference chips appear.",
      "Combine with @face / @edge / @path picks for precise edits."
    ],
    "ask": "How do I link project files and geometry into the AI prompt with @component and picks?",
    "keywords": [
      "link to prompt",
      "drag to prompt",
      "@component",
      "project browser",
      "shift select",
      "attach files",
      "reference chips"
    ],
    "where": "Project browser \u2192 drag into AI prompt"
  },
  {
    "id": "workspaces",
    "category": "projects",
    "title": "Workspaces & teammates",
    "demo": "workspaces",
    "gif": "/docs/media/workspaces.gif?v=20260715-real",
    "summary": "Shared workspaces keep projects, folders, and invites together.",
    "steps": [
      "Create or switch a workspace from the account menu.",
      "Invite coworkers by email.",
      "Projects sync live for members who are online."
    ],
    "ask": "How do workspaces and invites work?",
    "keywords": [
      "workspace",
      "invite",
      "team",
      "collaboration"
    ],
    "where": "Account menu \u2192 Team workspaces"
  },
  {
    "id": "share-folders",
    "category": "projects",
    "title": "Share a private folder",
    "demo": "share",
    "gif": "/docs/media/share-folder.gif?v=20260715-real",
    "summary": "Folders stay private until you share them with specific teammates.",
    "steps": [
      "Right-click a folder \u2192 Share.",
      "Pick a teammate from the dropdown.",
      "Keep Private checked so only sharees see it."
    ],
    "ask": "How do I share a private folder?",
    "keywords": [
      "share folder",
      "private folder"
    ],
    "where": "Explorer \u2192 right-click folder \u2192 Share"
  },
  {
    "id": "reference-markup",
    "category": "projects",
    "title": "Reference files, pen markup & Send to AI",
    "demo": "markup",
    "gif": "/docs/media/reference-markup.gif?v=20260715-real",
    "summary": "Open PDFs/images in tabs, mark them up, and push callouts into the CAD prompt.",
    "steps": [
      "Drop a PDF or image into the project.",
      "Open the Docs-style tab and use Pen + notes.",
      "Save, then Send to AI."
    ],
    "ask": "How do reference markup and Send to AI work?",
    "keywords": [
      "reference",
      "markup",
      "pdf",
      "send to ai"
    ],
    "where": "Document tabs \u00b7 Pen \u00b7 Send to AI"
  },
  {
    "id": "solid-tools",
    "category": "modeling",
    "title": "Solid modeling tools",
    "demo": "picks",
    "gif": "/docs/media/select-object.gif?v=20260715-robot-arm",
    "summary": "Ribbon Create/Modify/Pattern plus direct tools: Press-Pull, fillet, transform, color, measure.",
    "steps": [
      "Switch to the SOLID design tab.",
      "Use Ribbon Create for primitives and features.",
      "Use Tools for Press-Pull, Transform (G), Color, Measure, Split."
    ],
    "ask": "What solid modeling tools are available?",
    "keywords": [
      "solid",
      "press-pull",
      "fillet",
      "extrude",
      "transform",
      "gizmo"
    ],
    "where": "SOLID tab \u00b7 Ribbon \u00b7 Right Tools"
  },
  {
    "id": "select-object",
    "category": "modeling",
    "title": "Select object & body",
    "demo": "picks",
    "gif": "/docs/media/select-object.gif?v=20260715-robot-arm",
    "summary": "Click once to select the whole robot arm; double-click a link to select only that body/part.",
    "steps": [
      "Open Select in the Pick toolbar (or press V).",
      "Single-click the model to select the whole component (blue highlight).",
      "Double-click a specific link/part to drill into that body (amber highlight).",
      "Drag to move the selection; Cmd/Ctrl+Z undoes."
    ],
    "ask": "How do I select a whole object vs one body/part with click and double-click?",
    "keywords": [
      "select object",
      "select body",
      "double click",
      "part select",
      "object pick",
      "robot arm",
      "body"
    ],
    "where": "Pick toolbar \u2192 Select \u00b7 Viewport"
  },
  {
    "id": "sketch",
    "category": "sketch-canvas",
    "title": "Constrained Sketch",
    "demo": "canvas",
    "gif": "/docs/media/canvas.gif?v=20260715-real",
    "summary": "2D sketch on a plane with constraints, then extrude to solid.",
    "steps": [
      "Open SKETCH and create a sketch on XY/XZ/YZ or a face.",
      "Draw with Line/Rect/Circle and add constraints.",
      "Finish Sketch, then Extrude (new/add/cut)."
    ],
    "ask": "How do I create and extrude a constrained sketch?",
    "keywords": [
      "sketch",
      "constraint",
      "extrude sketch"
    ],
    "where": "Design tabs \u2192 SKETCH"
  },
  {
    "id": "canvas",
    "category": "sketch-canvas",
    "title": "Canvas sketch mode",
    "demo": "canvas",
    "gif": "/docs/media/canvas.gif?v=20260715-real",
    "summary": "Freehand concept pad \u2014 attach the sketch to AI Compose.",
    "steps": [
      "Switch to CANVAS.",
      "Draw with pen/shapes.",
      "Attach / Prompt to send into AI Compose, then Generate."
    ],
    "ask": "How do I use Canvas and attach a sketch to AI?",
    "keywords": [
      "canvas",
      "attach sketch"
    ],
    "where": "Design tabs \u2192 CANVAS"
  },
  {
    "id": "rigging-urdf",
    "category": "rigging",
    "title": "URDF / SRDF & Motion",
    "demo": "generate",
    "gif": "/docs/media/ai-generate.gif?v=20260715-real",
    "summary": "GLB shows shape; URDF/SRDF drive simulation. Author Jake gen_urdf()/gen_srdf(), then open Motion.",
    "steps": [
      "In Rigging, switch to URDF / SRDF mode.",
      "Select the CAD Python source.",
      "Author with AI (Jake) or Generate URDF/SRDF.",
      "Inspect the link/joint tree, then Open URDF / SRDF Motion."
    ],
    "ask": "How do I generate URDF/SRDF and open Motion?",
    "keywords": [
      "urdf",
      "srdf",
      "motion",
      "jake",
      "gen_urdf",
      "simulated motion"
    ],
    "where": "Rigging \u2192 URDF/SRDF mode \u00b7 Motion workbench"
  },
  {
    "id": "wiring",
    "category": "wiring",
    "title": "Wiring Simulator",
    "demo": "wiring",
    "gif": "/docs/media/wiring.gif?v=20260715-real",
    "summary": "Breadboard circuits from AI, wire pin-to-pin, validate drivers, code & simulate.",
    "steps": [
      "Switch to Wiring mode.",
      "Drag a 3D part into the wiring prompt or board.",
      "Describe the circuit and Generate.",
      "Wire pins; open Code & Simulate when ready."
    ],
    "ask": "How do I use the Wiring Simulator?",
    "keywords": [
      "wiring",
      "breadboard",
      "circuit",
      "gpio"
    ],
    "where": "Workspace \u2192 Wiring Simulator"
  },
  {
    "id": "cloud-sync",
    "category": "cloud",
    "title": "Fusion 360 & Onshape sync",
    "demo": "cloud",
    "gif": "/docs/media/cloud-sync.gif?v=20260715-real",
    "summary": "Connect cloud libraries to import and push without leaving Studio.",
    "steps": [
      "Connect Fusion or Onshape from Account \u2192 Cloud.",
      "Browse the left library panel and import into a project.",
      "Push local changes back when needed."
    ],
    "ask": "How do I connect Fusion or Onshape?",
    "keywords": [
      "fusion",
      "onshape",
      "cloud"
    ],
    "where": "Left Fusion / Onshape libraries \u00b7 Account cloud connections"
  },
  {
    "id": "render-agent",
    "category": "help",
    "title": "Render Agent help chat",
    "demo": "agent",
    "gif": "/docs/media/render-agent.gif?v=20260715-real",
    "summary": "Product help (not CAD Generate) \u2014 tools, Fusion, workflows, with demo GIFs.",
    "steps": [
      "Click Agent in the ribbon (or Ask Agent on Getting Started).",
      "Ask about tools, folders, Fusion, wiring, prompts.",
      "Attach screenshots when helpful."
    ],
    "ask": "What can Render Agent help with?",
    "keywords": [
      "render agent",
      "ask agent",
      "help"
    ],
    "where": "Ribbon Agent \u00b7 Getting Started Ask Agent"
  },
  {
    "id": "preferences",
    "category": "help",
    "title": "Preferences, theme & mouse",
    "demo": "agent",
    "gif": "/docs/media/render-agent.gif?v=20260715-real",
    "summary": "Avatar, mouse presets, dark/light theme, and simulated-motion after generate.",
    "steps": [
      "Open Preferences from the account menu.",
      "Set mouse controls and appearance.",
      "Choose Simulated motion: ask / always URDF\u00b7SRDF / never."
    ],
    "ask": "Where do I change Preferences and simulated-motion defaults?",
    "keywords": [
      "preferences",
      "theme",
      "mouse",
      "simulated motion"
    ],
    "where": "Account \u2192 Preferences"
  },
  {
    "id": "tips-tricks",
    "category": "help",
    "title": "Tips and tricks",
    "demo": "tips",
    "gif": "/docs/media/ai-generate.gif?v=20260715-real",
    "summary": "Shift-select files, drag refs into the prompt, keep prompts focused, share context.",
    "steps": [
      "Shift-click in the Project browser to select a file range.",
      "Drag files into the AI prompt as references.",
      "Prefer @face/@edge/@path chips over vague locations.",
      "Generate the main object first, then revise selected results."
    ],
    "ask": "Give me practical Render3D tips and tricks.",
    "keywords": [
      "tips",
      "tricks",
      "shift select",
      "best practices"
    ],
    "where": "Getting Started \u00b7 Tips library"
  }
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
  for (const [src, dst] of [["wirign","wiring"],["wireing","wiring"],["schemtic","schematic"],["bredboard","breadboard"]]) {
    text = text.replaceAll(src, dst);
  }
  for (const guide of GETTING_STARTED_GUIDES) {
    const ask = String(guide.ask || "").toLowerCase().trim();
    if (!ask) continue;
    if (text === ask) return [guide];
    if (text.length > 28 && ask.length > 28 && (text.includes(ask.slice(0, 56)) || ask.includes(text.slice(0, 56)))) return [guide];
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
      if (kw && text.includes(kw)) score += kw.includes(" ") ? 3 : 2;
    }
    if (isTour && ["ai-generate", "workspaces", "share-folders", "render-agent"].includes(guide.id)) score += 3;
    return { guide, score };
  }).filter((row) => row.score >= 2.5).sort((a, b) => b.score - a.score || a.guide.title.localeCompare(b.guide.title));
  return scored.slice(0, limit).map((row) => row.guide);
}

export function guideMediaPayload(guide) {
  if (!guide?.gif) return null;
  return { id: guide.id, title: guide.title, url: guide.gif, kind: "gif", summary: guide.summary || "" };
}
