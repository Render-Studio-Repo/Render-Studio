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
    topic: "Viewport",
    title: "Click whole object, double-click a body",
    body: "Select picks the whole robot arm; double-click a link to select just that part for move/edit.",
    steps: [
      "Press V or click Select in the Pick toolbar.",
      "Single-click the model to select the whole component.",
      "Double-click a specific link or body to drill into that part.",
      "Drag to move; Cmd/Ctrl+Z undoes.",
    ],
    starter: "Show me how to select a whole object versus one body with click and double-click",
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
  {
    topic: "Project files",
    title: "Shift-select files, then drag to prompt",
    body: "In the Project browser, click the first file, hold Shift, click the last file, then drag the selected files into the AI prompt to reference all of them.",
    steps: [
      "Open the Project browser.",
      "Click one file, then hold Shift and click another file to select the range.",
      "Drag the selected files into the AI prompt area.",
      "Write what each file should be used for: fit reference, source part, drawing, or inspiration.",
    ],
    starter: "Show me how to select multiple project files and drag them into the AI prompt as references.",
  },
  {
    topic: "Project files",
    title: "Use one prompt per reference role",
    body: "When attaching several files, say which is fixed, which is editable, and which is only a visual reference.",
    steps: [
      "Attach the fixed mating part as a reference.",
      "Attach the editable part or current model separately.",
      "Prompt: “keep @file-a fixed, modify @file-b, use @image-c only for style.”",
    ],
    starter: "Help me write a prompt that uses multiple attached files with different roles.",
  },
  {
    topic: "Project files",
    title: "Pick components before asking for fixtures",
    body: "For mounts and enclosures, reference the actual component files so the AI can use measured bounds instead of guessing.",
    steps: [
      "Select the board, motor, sensor, or connector files in the browser.",
      "Drag them into the prompt.",
      "Ask for named pockets, standoffs, screw holes, and clearance around those exact references.",
    ],
    starter: "How do I generate a mounting fixture around selected component files?",
  },
  {
    topic: "Geometry picks",
    title: "Select the geometry, not the idea",
    body: "If the edit is local, pick the face, edge, body, or path and reference the chip in your prompt.",
    steps: [
      "Choose Face, Edge, Object, or Line in the toolbar.",
      "Click the model feature you want changed.",
      "Use the inserted chip: “add a 2 mm fillet to @edge-1” or “cut along @path-1.”",
    ],
    starter: "Give examples of good @face, @edge, and @path edit prompts.",
  },
  {
    topic: "Geometry picks",
    title: "Use Line mode for routed features",
    body: "Line mode is useful for wires, tubes, slots, channels, cable clips, handles, and decorative grooves.",
    steps: [
      "Click Line / path mode.",
      "Click points across the model where the route should travel.",
      "Finish the path, then prompt: “create a cable channel along @path-1.”",
    ],
    starter: "How do I use line paths to generate routed wires, channels, or tubes?",
  },
  {
    topic: "Editing",
    title: "Revise the selected result",
    body: "When a model is close, select it and ask for a specific change instead of starting a brand-new generate.",
    steps: [
      "Click the generated object or file you want to change.",
      "Prompt a small edit: “make the clips 1 mm thicker” or “move holes 8 mm outward.”",
      "Keep dimensions and feature names from the prior result when possible.",
    ],
    starter: "Help me turn a broad regenerate request into a focused revise prompt.",
  },
  {
    topic: "Prompting",
    title: "Say what must not change",
    body: "Lock important constraints in the prompt: mounting holes, outer footprint, mating faces, filenames, or body names.",
    steps: [
      "List the dimensions/features that are fixed.",
      "Then list the feature you want changed.",
      "Example: “keep the 80 x 40 mm footprint and M3 hole pattern; only add side ribs.”",
    ],
    starter: "Write a CAD edit prompt that preserves fixed features while changing one area.",
  },
  {
    topic: "Prompting",
    title: "Ask for separate named bodies",
    body: "For assemblies, ask for separate selectable bodies so you can hide, move, export, or revise them later.",
    steps: [
      "Name the major parts: base, lid, hinge, bracket, insert, clip, cover.",
      "Ask for them as separate named bodies or components.",
      "Avoid “make one object” unless you truly want a fused single part.",
    ],
    starter: "How should I prompt for an assembly with separate named bodies?",
  },
  {
    topic: "Reference markup",
    title: "Mark up screenshots before generating",
    body: "For confusing shapes, draw arrows or notes on an image/PDF and Send to AI so the prompt has visual intent.",
    steps: [
      "Open the image or PDF reference tab.",
      "Use Pen and notes to mark the important dimensions, holes, and keep-out areas.",
      "Click Save, then Send to AI.",
      "Add a short text prompt explaining what to build from the markup.",
    ],
    starter: "How do I use pen markup and notes as AI generation context?",
  },
  {
    topic: "Reference markup",
    title: "Use photos for context, CAD for dimensions",
    body: "Photos are good for intent and style; STEP/STL/DXF references are better for exact geometry.",
    steps: [
      "Attach the photo or screenshot for visual explanation.",
      "Attach CAD or DXF files when size and fit matter.",
      "Tell the AI which source is authoritative for dimensions.",
    ],
    starter: "How should I combine photos, CAD files, and drawings in one prompt?",
  },
  {
    topic: "Canvas",
    title: "Sketch rough layout first",
    body: "Canvas is helpful for layout, proportions, labels, and callouts before you ask for a 3D result.",
    steps: [
      "Open Design → Canvas.",
      "Draw the rough layout and label major parts.",
      "Attach the sketch to the prompt.",
      "Ask for a clean parametric model that follows the sketch labels.",
    ],
    starter: "How do I turn a Canvas sketch into a generated CAD model?",
  },
  {
    topic: "Collaboration",
    title: "Share folders for live project context",
    body: "Use shared folders when collaborators need the editable files, not just a public preview link.",
    steps: [
      "Right-click the folder and choose Share.",
      "Select the teammate.",
      "Keep sensitive drafts in private folders until ready.",
      "Use the activity/history context when coordinating edits.",
    ],
    starter: "When should I share a folder instead of a model preview link?",
  },
  {
    topic: "Collaboration",
    title: "Share links are for review",
    body: "Use shared model links when someone only needs to view, inspect, or download a model without joining your workspace.",
    steps: [
      "Open the model export/share menu.",
      "Create the share link.",
      "Send it for browser preview, components, section view, and downloads.",
    ],
    starter: "What can reviewers do with a shared Render3D model link?",
  },
  {
    topic: "Cloud CAD",
    title: "Use Fusion mode when Fusion is the target",
    body: "If the final workflow lives in Fusion 360, use Fusion-oriented generation and keep filenames/body names clean.",
    steps: [
      "Connect Fusion from the account/cloud panel.",
      "Import or select the relevant Fusion-linked model.",
      "Use Fusion mode for edits that should push back cleanly.",
    ],
    starter: "When should I use Fusion mode instead of normal Render generation?",
  },
  {
    topic: "Cloud CAD",
    title: "Import cloud parts before designing around them",
    body: "For Onshape/Fusion libraries, import the actual part first, then generate brackets, covers, or adapters around it.",
    steps: [
      "Open the Fusion or Onshape library panel.",
      "Import the part into the project.",
      "Drag that imported file into the prompt as the fit reference.",
    ],
    starter: "How do I design an adapter around a part imported from Fusion or Onshape?",
  },
  {
    topic: "Wiring",
    title: "Validate drivers before making enclosures",
    body: "For motors, LEDs, and sensors, validate wiring first so the CAD fixture can preserve real connector access.",
    steps: [
      "Build or generate the circuit in Wiring mode.",
      "Run validation and fix driver/power issues.",
      "Then generate the enclosure or mount using the validated components as references.",
    ],
    starter: "How do I go from a validated wiring setup to a CAD enclosure?",
  },
  {
    topic: "Wiring",
    title: "Use component names in mechanical prompts",
    body: "Name boards, sensors, motors, headers, and cable exits so generated mounts line up with the electronics.",
    steps: [
      "Place or import the electronic components.",
      "Reference them in the CAD prompt.",
      "Ask for clearance, screw access, cable exits, and removable covers.",
    ],
    starter: "Write a mechanical enclosure prompt for a circuit with named components.",
  },
  {
    topic: "Software",
    title: "Use hide/isolate before picking",
    body: "If a model is crowded, hide unrelated bodies first so face and edge picks land on the correct part.",
    steps: [
      "Use the browser or context menu to hide extra bodies.",
      "Pick the visible face/edge/path.",
      "Bring hidden objects back after the edit prompt is ready.",
    ],
    starter: "How do I isolate geometry so picks are accurate?",
  },
  {
    topic: "Software",
    title: "Download the format for the next tool",
    body: "Use STEP/STP for CAD editing, STL/3MF for printing, GLB for preview/web, and DXF for 2D profiles.",
    steps: [
      "Open Export / Share.",
      "Choose the format that matches your next workflow.",
      "Use share links when someone else needs quick download access.",
    ],
    starter: "Which export format should I choose: STEP, STL, 3MF, GLB, or DXF?",
  },
];

const TIP_INDEX_KEY = "render3d:getting-started-tip:v1";

/** Tip chosen for this page load (set by bumpTipOnRefresh / bumpTipForNewThread). */
let pageTipIndex = null;

function tipCount() {
  return GETTING_STARTED_TIPS.length || 1;
}

function readIndex() {
  try {
    const raw = Number(localStorage.getItem(TIP_INDEX_KEY));
    if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw) % tipCount();
  } catch {
    /* ignore */
  }
  return 0;
}

function writeIndex(index) {
  try {
    localStorage.setItem(TIP_INDEX_KEY, String(index % tipCount()));
  } catch {
    /* ignore */
  }
}

function pickFreshIndex(avoid = null) {
  const n = tipCount();
  if (n <= 1) return 0;
  const skip = avoid == null ? readIndex() : avoid;
  let next = Math.floor(Math.random() * n);
  for (let i = 0; i < 10 && next === skip; i += 1) {
    next = Math.floor(Math.random() * n);
  }
  if (next === skip) next = (skip + 1) % n;
  return next;
}

/** Pick a new tip on every page load / hard refresh. */
export function bumpTipOnRefresh() {
  const next = pickFreshIndex(readIndex());
  writeIndex(next);
  pageTipIndex = next;
  return next;
}

/** Advance tip when opening a brand-new empty chat thread. */
export function bumpTipForNewThread() {
  const next = pickFreshIndex(pageTipIndex ?? readIndex());
  writeIndex(next);
  pageTipIndex = next;
  return next;
}

export function getCurrentTip() {
  const idx = pageTipIndex != null ? pageTipIndex : readIndex();
  return GETTING_STARTED_TIPS[idx % tipCount()];
}

export function tipTopicClass(topic = "") {
  const t = String(topic).toLowerCase();
  if (t.includes("dxf") || t.includes("drawing")) return "tip-topic--dxf";
  if (t.includes("software")) return "tip-topic--software";
  return "tip-topic--prompt";
}
