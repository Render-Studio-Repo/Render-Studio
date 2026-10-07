/** Guided "Show me" tours for Getting Started + Studio. */

import { GETTING_STARTED_GUIDES } from "./getting-started-guides.js?v=20261006-jake-parity1";

/** Tours that click the 3D viewport always seed the Robot Arm demo project. */
const ROBOT_ARM_DEMO_TOURS = new Set(["picks", "select-object", "solid-tools", "link-to-prompt"]);

const GUIDE_BY_ID = Object.fromEntries(
  (GETTING_STARTED_GUIDES || []).map((g) => [g.id, g])
);

/** Tours whose docs guide id differs from the show-me id. */
const TOUR_GUIDE_ALIAS = {
  "prompt-onboarding": "ai-generate",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveGuideForTour(guideId) {
  const alias = TOUR_GUIDE_ALIAS[guideId] || guideId;
  return GUIDE_BY_ID[alias] || GUIDE_BY_ID[guideId] || null;
}

function buildTourSummary(tour, guideId) {
  const guide = resolveGuideForTour(guideId);
  const custom = tour?.completionSummary || {};
  const howItWorks = Array.isArray(custom.howItWorks) && custom.howItWorks.length
    ? custom.howItWorks
    : Array.isArray(guide?.steps)
      ? guide.steps
      : [];
  const actions = Array.isArray(custom.actions) ? [...custom.actions] : [];
  if (tour?.remixAction && !actions.some((a) => a.remix)) {
    actions.push({
      label: tour.remixLabel || "Remix example",
      remix: true,
    });
  }
  return {
    title: custom.title || tour?.title || guide?.title || "Walkthrough complete",
    body:
      custom.body
      || guide?.summary
      || (tour?.example
        ? `You finished the click-through. Try this next: ${tour.example}`
        : "You finished this walkthrough. Use the demo below as a quick refresher of what it does and how it works."),
    howItWorks,
    gif: custom.gif || tour?.gif || guide?.gif || null,
    actions,
  };
}

function ensureSummaryStyles() {
  if (document.getElementById("show-me-summary-css")) return;
  const link = document.createElement("link");
  link.id = "show-me-summary-css";
  link.rel = "stylesheet";
  link.href = "/site/show-me-summary.css?v=20260908-layout-logo-ko1";
  document.head.appendChild(link);
}

const SHOW_ME_TOURS = {
  "ai-generate": {
    title: "Generate CAD with AI",
    example: "80 x 40 x 12 mm phone stand with a 65° rear tilt and rounded edges",
    studioPath: "/?promptMode=v2&showMe=ai-generate",
    gif: "/docs/media/ai-generate.gif?v=20260715-real",
    steps: [
      { selector: "#prompt-pane-compose, .prompt-compose-toolbar, #prompt-input, .prompt-editor", label: "Open the AI CAD prompt", click: false },
      { selector: '[data-prompt-mode="v2"], .prompt-mode-btn--v2', label: "Click CAD mode", click: true },
      { selector: "#btn-prompt, #prompt-generate, #btn-generate", label: "Generate button (highlight only)", click: false },
    ],
  },
  "prompt-onboarding": {
    title: "Welcome to Render Studio",
    example: "Create a 90 mm robot wrist bracket that mounts to the selected arm link, with 4 bolt holes and rounded edges.",
    studioPath: "/?showMe=prompt-onboarding",
    gif: "/docs/media/ai-generate.gif?v=20260715-real",
    needsRobotArm: true,
    steps: [
      {
        selector: "#viewport, .viewport-shell, .studio-viewport",
        label: "Welcome to Studio. We'll use a private Robot Arm demo so you can learn the real workflow: write a prompt, choose speed or quality, reference project parts, select geometry in the viewport, and send better context to AI.",
        click: false,
      },
      {
        selector: "#prompt-spice, #prompt-spice-wrap",
        label: "Improve prompt with AI is on by default. Think of it as a quick CAD brief writer: it keeps your idea, adds missing dimensions/constraints and realistic part colours when it can, and makes the request easier for the model to build correctly.",
        click: false,
        reveal: "mobile-ai",
      },
      {
        selector: "#prompt-speed",
        label: "Speed vs Quality controls how much model effort you spend. Use Speed for rough drafts and quick shape tests. Use Quality for harder geometry, final parts, repair passes, or when the first result needs stronger reasoning.",
        click: false,
        reveal: "mobile-ai",
      },
      {
        selector: "#project-browser, .browser-section, .file-browser, [data-mobile-corner='workspace']",
        label: "Project components are not just files; they are prompt context. Link a component when you want AI to edit or design around a specific part instead of guessing from text alone.",
        click: false,
      },
      {
        selector: "#prompt-input, .prompt-editor, #prompt-pane-compose, [data-mobile-corner='ai']",
        label: "Referenced items appear in the prompt as chips, like @component or @selected-object. This tells AI which exact model, drawing, or selected part should guide the response.",
        click: false,
        reveal: "mobile-ai",
      },
      {
        selector: "#btn-prompt, #prompt-generate, #btn-generate",
        label: "Generate sends the prompt plus any linked context to Render AI. Use it for new CAD, revisions, or selected-object edits. If a generation takes time, it continues in the project background.",
        click: false,
        reveal: "mobile-ai",
      },
      {
        selector: "#btn-pick-object, .mobile-tool-btn[data-pick='object'], button[data-mode='object']",
        label: "Select object mode lets you pick a model in the viewport before prompting.",
        click: true,
        reveal: "mobile-tools",
      },
      {
        viewport: "click",
        label: "Click the demo robot arm object. Future prompts can keep targeting the selected object.",
        click: true,
        fraction: [0.52, 0.42],
      },
      {
        selector: "#btn-pick-face, .mobile-tool-btn[data-pick='face'], button[data-pick='face']",
        label: "Face pick is for precise edits. Pick a robot-arm face, then ask for holes, fillets, brackets, or mounting changes.",
        click: true,
        reveal: "mobile-tools",
      },
      {
        selector: ".prompt-mic-btn[data-mic-target='prompt-input'], .prompt-skills-trail .prompt-mic-btn",
        label: "Mic transcribe lets you talk to the prompt instead of typing long CAD instructions.",
        click: false,
        reveal: "mobile-ai",
      },
      {
        selector: '[data-prompt-mode="draw"]',
        label: "Draw mode is for sketchy/direct edit workflows when visuals explain the change better than text.",
        click: true,
        reveal: "mobile-ai",
      },
      {
        selector: '[data-prompt-mode="v2"], .prompt-mode-btn--v2',
        label: "CAD is the main generation path for now: prompt → source → build → inspect → repair. With an OpenAI key, Jake and VibeCAD use the Codex CAD agent automatically.",
        click: true,
        reveal: "mobile-ai",
      },
      {
        selector: "#prompt-kb-icon-btn, .prompt-kb-icon-wrap",
        label: "Knowledge Base is project memory. It stores docs, PDFs, CAD references, manuals, drawings, and prompt notes so future prompts can use repeatable context instead of starting from zero.",
        click: false,
        reveal: "mobile-ai",
      },
      {
        demo: "knowledge-base",
        demoTarget: "create",
        label: "Create a Knowledge Base first. Give it a name like Robot Arm Specs or Customer Requirements, then add a short description so teammates understand what it contains.",
        click: false,
      },
      {
        demo: "knowledge-base",
        demoTarget: "upload",
        label: "Add source material next. Drop PDFs, CAD files, screenshots, DXF drawings, spreadsheets, or notes. Render Studio keeps them organized as reusable prompt context.",
        click: false,
      },
      {
        demo: "knowledge-base",
        demoTarget: "select",
        label: "Select the Knowledge Base when you want the AI prompt to use those files. Keep only relevant bases enabled so the model sees strong context instead of noise.",
        click: false,
      },
      {
        demo: "knowledge-base",
        demoTarget: "attach",
        label: "When a Knowledge Base is attached, your prompt can ask things like: use the wiring manual, match this CAD spec, or follow our robot assembly notes. That context travels with the Generate request.",
        click: false,
      },
      {
        selector: "#btn-render-agent, #render-agent-fab, .render-agent-fab, .workspace-feedback-btn--agent",
        label: "Render Agent can answer questions or guide actions when you are not sure what button to use next.",
        click: false,
      },
      {
        selector: "#btn-screenshot-viewport, #btn-screenshot-toolbar",
        label: "Screenshot saves the current viewport so you can share progress or attach an image back into the AI prompt.",
        click: false,
      },
    ],
    completionSummary: {
      title: "Studio walkthrough complete",
      body: "You learned the main Studio loop: improve a prompt, choose speed or quality, link files and selected objects, use voice and modes, attach Knowledge Base context, ask Render Agent, and capture the viewport.",
      howItWorks: [
        "Write or improve a CAD prompt in Compose.",
        "Link project files, @faces, or selected objects for context.",
        "Choose Speed or Quality, then Generate.",
        "Ask Render Agent when you are unsure what to click next.",
      ],
      actions: [
        { label: "AI Generate Deep Dive", guideId: "ai-generate" },
        { label: "Select Objects & Parts", guideId: "select-object" },
        { label: "Geometry Picks", guideId: "picks" },
        { label: "Reference Markup", guideId: "reference-markup" },
        { label: "Tour Wiring Simulator", guideId: "wiring" },
        { label: "Team Workspaces", guideId: "workspaces" },
        { label: "Tour Architect Mode", guideId: "architect-mode" },
      ],
    },
  },
  workspaces: {
    title: "Workspaces",
    example: "",
    studioPath: "/?showMe=workspaces",
    gif: "/docs/media/workspaces.gif?v=20260715-real",
    steps: [
      { selector: "#btn-projects-new, .folder-zone-root .btn-folder-new-project, .workspace-browser-head", label: "Click the + next to Projects", click: true },
      { selector: "#btn-auth, .btn-auth", label: "Account menu for workspaces", click: false },
    ],
  },
  "projects-upload": {
    title: "Create a project",
    example: "",
    studioPath: "/?showMe=projects-upload",
    gif: "/docs/media/new-project.gif?v=20260907-chrome-mark",
    steps: [
      { selector: "#btn-projects-new, .folder-zone-root .btn-folder-new-project", label: "Click the + next to Projects", click: true },
    ],
  },
  "share-folders": {
    title: "Share folders",
    example: "",
    studioPath: "/?showMe=share-folders",
    gif: "/docs/media/share-folder.gif?v=20260715-real",
    steps: [
      { selector: "#project-browser, .browser-section, .file-browser", label: "Project browser — folders live here", click: false },
    ],
  },
  "reference-markup": {
    title: "Reference markup",
    example: "",
    studioPath: "/?showMe=reference-markup",
    gif: "/docs/media/reference-markup.gif?v=20260716-pdf-tab",
    steps: [
      { selector: "#project-browser, .browser-section", label: "Open a PDF/image from Project files", click: false },
    ],
  },
  canvas: {
    title: "Canvas",
    example: "",
    studioPath: "/?showMe=canvas",
    gif: "/docs/media/canvas-workspace.gif?v=20260916-newfeats1",
    completionSummary: {
      title: "Canvas sketch mode",
      body: "Open last or create new, sketch labels, Smart Description fills a CAD prompt, then Send to Compose.",
      howItWorks: [
        "Open the Canvas document tab.",
        "Choose Open last or Create new and name the board.",
        "Sketch layout and labels. Smart Description interviews the sketch.",
        "Send to Compose, then Generate. Boards save under canvas/.",
      ],
      gif: "/docs/media/canvas-workspace.gif?v=20260916-newfeats1",
    },
    steps: [
      {
        selector: "#canvas-workspace, #canvas-mode-container, [data-shell-tab='canvas']",
        label: "Canvas is a document tab — Open last or Create new.",
        click: false,
      },
      {
        selector: "#canvas-open-last-btn, #canvas-open-new-btn, #canvas-open-chooser-modal",
        label: "Open last board, or start a new one. Name it in the project.",
        click: false,
      },
      {
        selector: "#canvas-smart-desc-fill, #canvas-smart-desc-modal, .canvas-toolbar-popup",
        label: "Smart Description fills a CAD prompt from the sketch. Send to Compose when ready.",
        click: false,
      },
    ],
  },
  "select-object": {
    title: "Select object & body",
    example: "",
    studioPath: "/?showMe=select-object",
    gif: "/docs/media/select-object.gif?v=20260715-robot-arm",
    needsRobotArm: true,
    steps: [
      {
        selector: "#btn-pick-object, .mobile-tool-btn[data-pick='object'], button[data-mode='object']",
        label: "Click Select (object pick)",
        click: true,
        reveal: "mobile-tools",
      },
      {
        viewport: "click",
        label: "Click the robot arm to select the whole model",
        click: true,
        fraction: [0.52, 0.42],
      },
      {
        viewport: "dblclick",
        label: "Double-click a link to select just that body/part",
        click: true,
        fraction: [0.58, 0.36],
      },
    ],
  },
  picks: {
    title: "Geometry picks",
    example: "fillet @face-1 2 mm",
    studioPath: "/?showMe=picks",
    gif: "/docs/media/picks.gif?v=20260715-robot-arm",
    needsRobotArm: true,
    steps: [
      {
        selector: "#btn-pick-face, .mobile-tool-btn[data-pick='face'], button[data-pick='face']",
        label: "Click Face pick",
        click: true,
        reveal: "mobile-tools",
      },
      {
        viewport: "click",
        label: "Click a face on the robot arm",
        click: true,
        fraction: [0.52, 0.40],
      },
      {
        selector: "#prompt-input, .prompt-editor, [data-mobile-corner='ai']",
        label: "@face chips land in the prompt",
        click: false,
        reveal: "mobile-ai",
      },
    ],
  },
  "robotics-configuration": {
    title: "Robotics Configuration",
    example: "",
    studioPath: "/?designTab=ROBOTICS&showMe=robotics-configuration",
    gif: "/docs/media/robotics-configuration.gif?v=20260914-lanip1",
    completionSummary: {
      title: "Robotics Configuration",
      body: "Viser is HTTP on the Pi. Teleop is HTTPS. Studio proxies both so https://render3d.app and Quest never hit mixed content or a self-signed cert.",
      howItWorks: [
        "Open ROBOTICS, then Teleop next to Viser.",
        "Paste https://YOUR_LAN_IP:8443/teleop — iframe is /api/teleop/p/YOUR_LAN_IP/8443/teleop.",
        "Viser: http://YOUR_LAN_IP:8095 → /api/viser/p/YOUR_LAN_IP/8095/.",
        "Bind 0.0.0.0 on the Pi. Quest auto-clicks Connect; desktop Connect may stay grey.",
      ],
      gif: "/docs/media/robotics-configuration.gif?v=20260914-lanip1",
    },
    steps: [
      { selector: '[data-design-tab="ROBOTICS"]', label: "Open the ROBOTICS design tab", click: true },
      { selector: '.ribbon-tab[data-cat="Teleop"]', label: "Click Teleop next to Viser", click: true },
      { selector: "[data-teleop-url], [data-teleop-ribbon-url], #pref-teleop-url", label: "Paste https://YOUR_LAN_IP:8443/teleop (HTTPS). Studio proxies /api/teleop/p/…", click: false },
      { selector: "[data-teleop-connect]", label: "Connect loads the proxied page. In Quest Browser this auto-clicks. Desktop may stay grey (WebXR).", click: false },
      { selector: "[data-teleop-docs]", label: "Teleop / Robotics setup opens this docs tab — not a filesystem path", click: false },
    ],
  },
  "robotics-viser-lan": {
    title: "Viser LAN proxy",
    example: "",
    studioPath: "/?designTab=ROBOTICS&showMe=robotics-viser-lan",
    gif: "/docs/media/robotics-viser.gif?v=20260914-lanip1",
    completionSummary: {
      title: "Viser LAN proxy",
      body: "Viser is HTTP. Studio iframes /api/viser/p/host/port/ so https://render3d.app never hits mixed content.",
      howItWorks: [
        "Bind Viser on the Pi to 0.0.0.0:8095.",
        "Paste http://YOUR_LAN_IP:8095 — not 127.0.0.1.",
        "URLs autosave and show in VR Settings.",
      ],
      gif: "/docs/media/robotics-viser.gif?v=20260914-lanip1",
    },
    steps: [
      { selector: '[data-design-tab="ROBOTICS"]', label: "Open ROBOTICS", click: true },
      { selector: '.ribbon-tab[data-cat="Viser"]', label: "Stay on the Viser strip", click: true },
      { selector: "[data-viser-url], [data-viser-ribbon-url], #pref-viser-url", label: "Paste http://YOUR_LAN_IP:8095 (HTTP). Studio proxies /api/viser/p/…", click: false },
    ],
  },
  "robotics-teleop-proxy": {
    title: "Teleop HTTPS proxy",
    example: "",
    studioPath: "/?designTab=ROBOTICS&showMe=robotics-teleop-proxy",
    gif: "/docs/media/robotics-teleop.gif?v=20260914-lanip1",
    completionSummary: {
      title: "Teleop HTTPS proxy",
      body: "Quest never trusts the Pi self-signed cert. Studio HTTPS proxy is same-origin and auto-clicks Connect in Quest Browser.",
      howItWorks: [
        "Bind DIMOS on 0.0.0.0:8443.",
        "Paste https://YOUR_LAN_IP:8443/teleop.",
        "Iframe is /api/teleop/p/YOUR_LAN_IP/8443/teleop.",
      ],
      gif: "/docs/media/robotics-teleop.gif?v=20260914-lanip1",
    },
    steps: [
      { selector: '[data-design-tab="ROBOTICS"]', label: "Open ROBOTICS", click: true },
      { selector: '.ribbon-tab[data-cat="Teleop"]', label: "Open Teleop next to Viser", click: true },
      { selector: "[data-teleop-connect]", label: "Connect through the Studio proxy — Quest auto-clicks after load", click: false },
    ],
  },
  "robotics-wrist-cameras": {
    title: "Connecting wrist cameras",
    example: "",
    studioPath: "/?designTab=ROBOTICS&showMe=robotics-wrist-cameras",
    gif: "/docs/media/wrist-cameras.gif?v=20260916-docgif1",
    completionSummary: {
      title: "Connecting wrist cameras",
      body: "Wrist USB cameras plug into the Mac running Studio. Wrist Cam or Viser Cameras auto-publishes JPEGs on :8001.",
      howItWorks: [
        "Plug an Arducam-style wrist USB camera into this Mac. Prefer USB-C / USB 3.",
        "Run Studio from the venv (python run.py) on :8001.",
        "Cam IP is this computer’s LAN host only. Click Wrist Cam or Viser Cameras — no curl.",
        "Allow camera runs Python/ffmpeg so macOS Camera can list the device. Drag Left/Right overlays to any corner.",
      ],
      gif: "/docs/media/wrist-cameras.gif?v=20260916-docgif1",
    },
    steps: [
      { selector: '[data-design-tab="ROBOTICS"]', label: "Open ROBOTICS", click: true },
      { selector: "[data-hand-cam-ip], [data-ip-camera], #pref-hand-cam-ip", label: "Enter this computer’s LAN IP only (host, not a /api/robotics/hand-cam/ path). Port 8001 is implied.", click: false },
      { selector: ".ribbon-btn--enable-cam, .ribbon-btn--wrist-cam, [data-viser-cam]", label: "Click Cam or Wrist Cams — Studio auto POSTs publish", click: true },
    ],
  },
  wiring: {
    title: "Wiring Simulator",
    example: "Arduino-compatible board drives a NEMA 17 stepper through a DRV8825 driver",
    studioPath: "/?designTab=WIRING&showMe=wiring",
    gif: "/docs/media/wiring.gif?v=20260715-real",
    remixAction: "wiring-stepper",
    remixLabel: "Remix Arduino Stepper Test Bench",
    steps: [
      { selector: "#workspace-mode-btn", label: "Open workspace modes. Wiring lives beside CAD, Sketch, Canvas, and Architect so electronics can stay attached to the same project.", click: true },
      {
        selector: "#workspace-mode-menu .workspace-mode-option",
        matchText: "Wiring",
        label: "Click Wiring Simulator. This switches the center workspace from 3D model viewing into a circuit board and schematic canvas.",
        click: true,
        ensureMenu: true,
      },
      { selector: "#btn-wiring-toolbelt-demo-stepper", label: "Load the Arduino Stepper Test Bench example. Demos are safe starting points for learning wiring before building your own robot circuit.", click: true },
      { selector: "#wiring-viewport, #wiring-workspace, .wiring-canvas", label: "The board shows components and connections. Drag parts to lay out the circuit, then use the schematic run tools to validate the loop.", click: false },
      { selector: "#btn-wiring-code", label: "Code & Simulate generates or opens the control sketch. Use it when the wiring is mostly right and you want firmware logic to match the circuit.", click: false },
      { selector: "#btn-wiring-run-schematic", label: "Run schematic animates and validates the circuit. It is the quick check before sending wiring back to AI or exporting build notes.", click: false },
      { selector: "#btn-wiring-photo-debug", label: "Circuit Debugger lets you upload real wiring photos and ask what is wrong, such as crossed wires, wrong pins, or missing power/ground.", click: false },
    ],
  },
  "architect-mode": {
    title: "Architect Mode",
    example: "",
    studioPath: "/?showMe=architect-mode",
    gif: "/docs/media/ai-generate.gif?v=20260715-real",
    completionSummary: {
      title: "Architect Mode",
      body: "Architect is for modular house layouts. Build a wireframe shell with wall, door, and window tiles on a snap grid before styling.",
      howItWorks: [
        "Open Architect in the right panel.",
        "Stay in Build and paint Wall tiles on the grid.",
        "Add Door and Window openings early.",
        "Move through Design → Structure → Comfort → Review as the layout matures.",
      ],
    },
    steps: [
      {
        selector: '[data-design-tab="ARCHITECT"], #workspace-tabs [data-design-tab="ARCHITECT"]',
        label: "Open Architect in the right panel. Architect is for modular house layouts: walls, doors, windows, rooms, and grid-based building pieces.",
        click: true,
      },
      {
        selector: "#architect-prompt-panel, .architect-prompt-panel",
        label: "Architect starts in Build. Build is intentionally not generative by default; it is a hands-on wireframe mode so you can create layout structure before asking AI for styled parts.",
        click: false,
      },
      {
        selector: ".architect-tile-btn[data-architect-step='draw']",
        label: "Wall tiles are 3 ft by 9 ft bays. Pick Wall, then drag in the viewport to paint modular wall panels on the snap grid.",
        click: false,
      },
      {
        selector: ".architect-tile-btn[data-architect-step='door']",
        label: "Door tiles reserve openings in the wall grid. Use them early so rooms have real entrances instead of sealed boxes.",
        click: false,
      },
      {
        selector: ".architect-tile-btn[data-architect-step='window']",
        label: "Window tiles add openings for daylight. The goal is a clean modular shell first, then later phases can style and detail it.",
        click: false,
      },
      {
        selector: ".architect-phase-nav",
        label: "The phases show the intended workflow: Build the layout, Design the look, add Structure, inspect Comfort, then Review before export. Build is the live phase right now.",
        click: false,
      },
    ],
  },
  "cloud-sync": {
    title: "Fusion / Onshape",
    example: "",
    studioPath: "/?showMe=cloud-sync",
    gif: "/docs/media/cloud-sync.gif?v=20260715-real",
    steps: [
      { selector: "#fusion-library-section, #fusion-library, .fusion-library-section", label: "Open Fusion library", click: true },
    ],
  },
  "render-agent": {
    title: "Render Agent",
    example: "How do I generate my first CAD model?",
    studioPath: "/?showMe=render-agent",
    gif: "/docs/media/render-agent.gif?v=20260715-real",
    steps: [
      { selector: "#btn-render-agent, #render-agent-fab, .render-agent-fab, .workspace-feedback-btn--agent", label: "Click Agent", click: true },
    ],
  },
  preferences: {
    title: "Preferences, theme & mouse",
    example: "",
    studioPath: "/?showMe=preferences",
    gif: "/docs/media/preferences.gif?v=20260716-prefs",
    steps: [
      { selector: "#btn-auth", label: "Open the account menu", click: true },
      { selector: "#btn-preferences-menu", label: "Click Preferences", click: true, reveal: "account-menu" },
      {
        selector: ".settings-mobile-navigation, .settings-navigation, #profile-preferences-panel",
        label: "Use General for appearance and Controls & VR for mouse and headset settings",
        click: false,
      },
      {
        selector: ".settings-search input",
        label: "Search settings: find simulated motion in AI & generation, or connect your apps",
        click: false,
      },
    ],
  },
  "source-parts": {
    title: "Source parts with ⓘ",
    example: "Source this stepper online, then wire it in the Wiring Simulator",
    studioPath: "/?showMe=source-parts",
    gif: "/docs/media/source-parts.gif?v=20260716-source",
    needsRobotArm: true,
    steps: [
      {
        selector: '.browser-item[data-section="components"] .browser-action-profile, .browser-action-profile',
        label: "Click ⓘ on a component to open its part profile",
        click: true,
      },
      {
        selector: ".comp-profile-search, .comp-profile-search-btn",
        label: "Search the catalog and click Use this",
        click: false,
      },
      {
        selector: ".comp-profile-save, .comp-profile-use",
        label: "Save the sourced profile",
        click: false,
      },
      {
        selector: "#workspace-mode-btn, #wiring-prompt-input",
        label: "Open Wiring and drag the sourced part into the Wiring AI prompt",
        click: false,
        reveal: "mobile-ai",
      },
    ],
  },
  "link-to-prompt": {
    title: "Link project items to the prompt",
    example: "Use @component-1 as the mating part and keep clearances at 0.3 mm",
    studioPath: "/?showMe=link-to-prompt",
    gif: "/docs/media/picks.gif?v=20260715-robot-arm",
    needsRobotArm: true,
    steps: [
      {
        selector: "#project-browser, .browser-section, .file-browser, [data-mobile-corner='workspace']",
        label: "Select files in Project browser",
        click: false,
      },
      {
        selector: "#prompt-input, .prompt-editor, #prompt-pane-compose, [data-mobile-corner='ai']",
        label: "Drop them into the AI prompt",
        click: false,
        reveal: "mobile-ai",
      },
      {
        selector: "#btn-pick-face, .mobile-tool-btn[data-pick='face'], button[data-pick='face']",
        label: "Or click Face pick for @face chips",
        click: true,
        reveal: "mobile-tools",
      },
      {
        viewport: "click",
        label: "Click a face on the robot arm",
        click: true,
        fraction: [0.52, 0.42],
      },
    ],
  },
  "solid-tools": {
    title: "Solid modeling tools",
    example: "",
    studioPath: "/?showMe=solid-tools",
    gif: "/docs/media/select-object.gif?v=20260715-robot-arm",
    needsRobotArm: true,
    steps: [
      {
        selector: '[data-design-tab="SOLID"], .workspace-tab',
        label: "Stay on SOLID",
        click: true,
        matchText: "SOLID",
      },
      {
        selector: "#btn-pick-object, button[data-mode='object']",
        label: "Select tool — click whole model, double-click a part",
        click: true,
      },
      {
        viewport: "click",
        label: "Click the robot arm (whole object)",
        click: true,
        fraction: [0.52, 0.42],
      },
    ],
  },
  "viewport-finder": {
    title: "Cmd/Ctrl+F finder",
    example: "",
    studioPath: "/?showMe=viewport-finder",
    gif: "/docs/media/viewport-finder.gif?v=20260916-newfeats1",
    completionSummary: {
      title: "Cmd/Ctrl+F finder",
      body: "Spotlight search across your projects, prompts, and timeline. Does not steal find-in-page from the prompt.",
      howItWorks: [
        "Click the 3D viewport so a text field is not focused.",
        "Press Cmd+F on Mac or Ctrl+F on Windows.",
        "Type to filter. Enter opens. Right-click to pin, share, or details.",
      ],
      gif: "/docs/media/viewport-finder.gif?v=20260916-newfeats1",
    },
    steps: [
      { selector: "#viewport, .viewport-shell, .studio-viewport", label: "Click the 3D viewport so the prompt is not focused.", click: false },
      { selector: "#viewport-search-root, .viewport-search-overlay, .viewport-search-input", label: "Press Cmd+F (Mac) or Ctrl+F (Windows). Type a project or prompt.", click: false },
    ],
  },
  "pin-projects": {
    title: "Pin projects",
    example: "",
    studioPath: "/?showMe=pin-projects",
    gif: "/docs/media/pin-projects.gif?v=20260916-newfeats1",
    completionSummary: {
      title: "Pin projects",
      body: "Star up to five personal projects so they stay at the top of the Projects list.",
      howItWorks: [
        "Click the star on a project row, or right-click → Pin to projects.",
        "Pinned rows sit in Pinned above Recents.",
        "Finder results have the same Pin to projects action.",
      ],
      gif: "/docs/media/pin-projects.gif?v=20260916-newfeats1",
    },
    steps: [
      { selector: "#project-browser, .project-list, [data-mobile-corner='workspace']", label: "Open the Projects list on the left.", click: false },
      { selector: ".btn-proj-pin, [data-action='pin-personal']", label: "Click the star (or right-click → Pin to projects). Cap is 5.", click: false },
    ],
  },
  "clip-video-editor": {
    title: "Clip / video editor",
    example: "",
    studioPath: "/?showMe=clip-video-editor",
    gif: "/docs/media/clip-video-editor.gif?v=20260916-newfeats1",
    completionSummary: {
      title: "Clip / video editor",
      body: "Viewport recordings open a built-in editor — timeline, trim, audio, Share, GIF, and AI film-edit.",
      howItWorks: [
        "Click Record on the viewport.",
        "Trim on the video and audio lanes. Drop extra media onto the timeline.",
        "Share or GIF from the preview, or type an AI film-edit prompt and Generate.",
      ],
      gif: "/docs/media/clip-video-editor.gif?v=20260916-newfeats1",
    },
    steps: [
      { selector: "#btn-video-record, .viewport-view-btn--video", label: "Click Record on the viewport to capture a clip.", click: false },
      { selector: ".vtl-host, .clip-editor-workspace, [data-vtl-host]", label: "The Editor tab has video and audio lanes, trim handles, Share, GIF, and AI film-edit.", click: false },
    ],
  },
  "imagine-panel": {
    title: "Imagine & /fetch",
    example: "",
    studioPath: "/?showMe=imagine-panel",
    gif: "/docs/media/imagine-panel.gif?v=20260916-newfeats1",
    completionSummary: {
      title: "Imagine panel & /fetch",
      body: "Imagine is its own tab. Generate product images, or /fetch public CAD into the project.",
      howItWorks: [
        "Open Imagine next to Compose and History.",
        "Generate a product photo. Send to CAD or Mesh.",
        "Type / then Tab to complete /fetch. Pick STL / GLB / STEP / 3MF.",
      ],
      gif: "/docs/media/imagine-panel.gif?v=20260916-newfeats1",
    },
    steps: [
      { selector: "#prompt-tab-imagine, #prompt-pane-imagine", label: "Open Imagine next to Compose and History.", click: true, reveal: "mobile-ai" },
      { selector: "#imagine-input, .imagine-compose, #prompt-pane-imagine", label: "Generate a product image, or type /fetch for public CAD.", click: false, reveal: "mobile-ai" },
    ],
  },
  "prompt-persist": {
    title: "Prompt drafts persist",
    example: "",
    studioPath: "/?showMe=prompt-persist",
    gif: "/docs/media/prompt-persist.gif?v=20260916-newfeats1",
    steps: [
      { selector: "#prompt-input, .prompt-editor, #prompt-pane-compose", label: "Compose drafts save per project. Switch projects to see the live box wipe and restore.", click: false, reveal: "mobile-ai" },
    ],
  },
  "reference-folders": {
    title: "Reference file folders",
    example: "",
    studioPath: "/?showMe=reference-folders",
    gif: "/docs/media/reference-folders.gif?v=20260916-newfeats1",
    steps: [
      { selector: "#project-browser, .browser-section, .file-browser", label: "Reference Files nest into Screenshots, Screen Recordings, AR captures, McMaster, Improve Lab.", click: false },
    ],
  },
  "wiring-compose": {
    title: "Wiring compose & History",
    example: "",
    studioPath: "/?designTab=WIRING&showMe=wiring-compose",
    gif: "/docs/media/wiring-compose.gif?v=20260916-newfeats1",
    steps: [
      { selector: "#workspace-mode-btn", label: "Open workspace modes and switch to Wiring.", click: true },
      { selector: "#wiring-prompt-input, #prompt-pane-compose, .wiring-compose", label: "Generate stamps History immediately. Send to wiring from the Parts Catalog.", click: false, reveal: "mobile-ai" },
    ],
  },
  "parts-catalog": {
    title: "Parts Catalog",
    example: "",
    studioPath: "/?showMe=parts-catalog",
    gif: "/docs/media/parts-catalog.gif?v=20260916-newfeats1",
    steps: [
      { selector: '[data-design-tab="PARTS"], [data-workspace-mode="parts"], #workspace-mode-btn', label: "Open Parts Catalog (Insert is gone).", click: true },
    ],
  },
  "viewport-split-layouts": {
    title: "Saved viewport split layouts",
    studioPath: "/?showMe=viewport-split-layouts",
    gif: "/docs/media/viewport-split-layouts.gif?v=20260916-gifs40",
    steps: [
      { selector: "#doc-tab-bar, .viewport-tab-strip, [data-viewport-layouts]", label: "Layouts is last on the viewport tab strip — after 3D, BOM, wiring, and video tabs.", click: false },
      { selector: "#pref-viewport-layouts, [data-vp-layout-settings], .viewport-layout-save", label: "Save a name + mosaic thumbnail. Share URLs are /share/{token}. Account → Viewport lists them.", click: false },
    ],
  },
  "public-pin": {
    title: "Pin to public profile",
    studioPath: "/?showMe=public-pin",
    gif: "/docs/media/public-pin.gif?v=20260916-gifs40",
    steps: [
      { selector: "#project-browser, .project-list, [data-mobile-corner='workspace']", label: "On a public project, Pin to public is separate from the five personal pins.", click: false },
    ],
  },
  "film-edit": {
    title: "AI film-edit",
    studioPath: "/?showMe=film-edit",
    gif: "/docs/media/film-edit.gif?v=20260916-gifs40",
    steps: [
      { selector: ".vtl-host, .clip-editor-workspace, [data-vtl-host]", label: "Under the clip timeline: type a cut, Improve prompt, Generate. Jobs run in the background.", click: false },
    ],
  },
  "native-joints": {
    title: "Native FreeCAD joints",
    studioPath: "/?showMe=native-joints",
    gif: "/docs/media/native-joints.gif?v=20260916-gifs40",
    steps: [
      { selector: '[data-design-tab="ASSEMBLY"], .joints-panel, #project-browser', label: "Joints live next to the part tree. Set axis and limits, then export STEP + joints.", click: false },
    ],
  },
  "code-workspace": {
    title: "Code workspace",
    studioPath: "/?showMe=code-workspace",
    gif: "/docs/media/code-workspace.gif?v=20260916-gifs40",
    steps: [
      { selector: "[data-code-workspace], .code-workspace, #project-browser", label: "Open a code folder for syntax tabs, JSON/CSV/XLSX previews, and revision-checked saves.", click: false },
    ],
  },
  "settings-search": {
    title: "Settings search",
    studioPath: "/?showMe=settings-search",
    gif: "/docs/media/settings-search.gif?v=20260916-gifs40",
    steps: [
      { selector: "#account-btn, .account-menu, #prefs-search, .settings-search", label: "Preferences and Management have a search box that jumps to the matching setting.", click: false },
    ],
  },
  "share-remix": {
    title: "Share & remix",
    studioPath: "/?showMe=share-remix",
    gif: "/docs/media/share-remix.gif?v=20260916-gifs40",
    steps: [
      { selector: "#btn-share, .share-export, [data-action='copy-share']", label: "Copy share link is pinned at the top of Export. Remix can add to an existing workspace.", click: false },
    ],
  },
  "document-tabs": {
    title: "Document tab strip",
    studioPath: "/?showMe=document-tabs",
    gif: "/docs/media/document-tabs.gif?v=20260916-gifs40",
    steps: [
      { selector: "#doc-tab-bar, .doc-tab-bar", label: "PDFs, images, Canvas, and clips park as tabs. Click Viewport to return without closing the doc.", click: false },
    ],
  },
  "dimos-enable": {
    title: "Enable Robotics / DIMOS",
    studioPath: "/?showMe=dimos-enable",
    gif: "/docs/media/dimos-enable.gif?v=20260916-gifs40",
    steps: [
      { selector: "#workspace-mode-btn, [data-workspace-mode='robot'], .robotics-enable", label: "DIMOS stays gated until Enable Robotics or Activate. Cloud never exposes :8443.", click: false },
    ],
  },
  "send-to-wiring": {
    title: "Send to wiring",
    studioPath: "/?designTab=PARTS&showMe=send-to-wiring",
    gif: "/docs/media/send-to-wiring.gif?v=20260916-gifs40",
    steps: [
      { selector: '[data-design-tab="PARTS"], [data-workspace-mode="parts"]', label: "On a catalog card, Send to wiring drops the sourced part and pins into the Wiring prompt.", click: true },
    ],
  },
  "edit-selected": {
    title: "Edit Selected",
    studioPath: "/?showMe=edit-selected",
    gif: "/docs/media/edit-selected.gif?v=20260916-gifs40",
    steps: [
      { selector: "#prompt-input, .prompt-editor, #prompt-pane-compose", label: "Edit selected keeps source scale and attachment. Failed runs do not clobber the live body.", click: false, reveal: "mobile-ai" },
    ],
  },
  "marketplace-layouts": {
    title: "Marketplace viewport layouts",
    studioPath: "/marketplace.html#/browse?category=viewport-layouts&showMe=marketplace-layouts",
    gif: "/docs/media/marketplace-layouts.gif?v=20260916-gifs40",
    steps: [
      { selector: "[data-shop-category='viewport-layouts'], .shop-category, #app", label: "Marketplace → Viewport layouts. Install writes the general layout store, then apply on any project.", click: false },
    ],
  },
};

let activeTour = null;
let activeGuideId = null;
let stepIndex = 0;
/** @type {"studio" | "docs"} */
let overlayMode = "studio";
let overlayBound = false;
let resizeHandler = null;
let activeDemoEl = null;

function ensureOverlay() {
  let el = document.getElementById("show-me-overlay");
  if (el && !el.querySelector("#show-me-circle")) {
    el.remove();
    el = null;
    overlayBound = false;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "show-me-overlay";
    el.className = "show-me-overlay hidden";
    el.innerHTML = `
      <div class="show-me-dim" id="show-me-dim" aria-hidden="true"></div>
      <div class="show-me-circle" id="show-me-circle" aria-hidden="true"></div>
      <div class="show-me-click" id="show-me-click" aria-hidden="true">
        <span class="show-me-click-ring"></span>
        <span class="show-me-click-dot"></span>
      </div>
      <div class="show-me-card">
        <div class="show-me-card-top">
          <strong id="show-me-title">Show me</strong>
          <button type="button" class="show-me-close" aria-label="Close">&times;</button>
        </div>
        <p id="show-me-step" class="show-me-step"></p>
        <div class="show-me-actions">
          <button type="button" class="btn secondary btn-compact" id="show-me-skip">Skip</button>
          <button type="button" class="btn secondary btn-compact hidden" id="show-me-remix">Remix example</button>
          <button type="button" class="btn accent btn-compact" id="show-me-next">Next</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
  }
  if (!overlayBound) {
    overlayBound = true;
    el.querySelector(".show-me-close")?.addEventListener("click", stopShowMe);
    el.querySelector("#show-me-skip")?.addEventListener("click", onSkipClick);
    el.querySelector("#show-me-next")?.addEventListener("click", onNextClick);
    el.querySelector("#show-me-remix")?.addEventListener("click", onRemixClick);
  }
  return el;
}

function clearHighlight() {
  document.querySelectorAll(".show-me-target").forEach((n) => n.classList.remove("show-me-target"));
  const circle = document.getElementById("show-me-circle");
  const click = document.getElementById("show-me-click");
  const dim = document.getElementById("show-me-dim");
  if (circle) {
    circle.classList.remove("is-on");
    circle.style.cssText = "";
  }
  if (click) {
    click.classList.remove("is-on", "is-press");
    click.style.cssText = "";
  }
  if (dim) dim.style.opacity = "";
}

function removeDemo() {
  activeDemoEl?.remove();
  activeDemoEl = null;
}

function ensureKnowledgeBaseDemo() {
  if (activeDemoEl?.dataset?.demo === "knowledge-base") return activeDemoEl;
  removeDemo();
  const demo = document.createElement("div");
  demo.className = "show-me-kb-demo";
  demo.dataset.demo = "knowledge-base";
  demo.innerHTML = `
    <div class="show-me-kb-demo-head">
      <span class="show-me-kb-demo-icon" aria-hidden="true">KB</span>
      <div>
        <strong>Knowledge Base</strong>
        <small>Animated setup preview</small>
      </div>
    </div>
    <div class="show-me-kb-demo-flow">
      <button type="button" class="show-me-kb-node" data-kb-demo-target="create">
        <span>01</span><strong>Create base</strong><small>Name + description</small>
      </button>
      <button type="button" class="show-me-kb-node" data-kb-demo-target="upload">
        <span>02</span><strong>Add files</strong><small>PDF, CAD, images, docs</small>
      </button>
      <button type="button" class="show-me-kb-node" data-kb-demo-target="select">
        <span>03</span><strong>Select context</strong><small>Attach only what matters</small>
      </button>
      <button type="button" class="show-me-kb-node" data-kb-demo-target="attach">
        <span>04</span><strong>Use in prompt</strong><small>Generate with memory</small>
      </button>
    </div>
    <div class="show-me-kb-demo-stack" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
  `;
  document.body.appendChild(demo);
  activeDemoEl = demo;
  return demo;
}

function demoTarget(step) {
  if (step.demo === "knowledge-base") {
    const demo = ensureKnowledgeBaseDemo();
    demo.querySelectorAll(".show-me-kb-node").forEach((node) => {
      node.classList.toggle("is-active", node.getAttribute("data-kb-demo-target") === step.demoTarget);
    });
    return demo.querySelector(`[data-kb-demo-target="${step.demoTarget || "create"}"]`) || demo;
  }
  removeDemo();
  return null;
}

function stopShowMe() {
  clearHighlight();
  removeDemo();
  document.getElementById("show-me-summary")?.remove();
  document.getElementById("show-me-summary-backdrop")?.remove();
  activeTour = null;
  activeGuideId = null;
  stepIndex = 0;
  overlayMode = "studio";
  document.getElementById("show-me-overlay")?.classList.add("hidden");
  document.getElementById("show-me-remix")?.classList.add("hidden");
  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
  }
}

function isOnScreen(el) {
  if (!el || !el.isConnected) return false;
  if (el.closest?.(".hidden")) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  if (rect.bottom < 8 || rect.right < 8) return false;
  if (rect.top > window.innerHeight - 8 || rect.left > window.innerWidth - 8) return false;
  return true;
}

function findFirst(selector, matchText) {
  const needle = String(matchText || "").trim().toLowerCase();
  const parts = String(selector || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const part of parts) {
    const nodes = Array.from(document.querySelectorAll(part));
    for (const el of nodes) {
      if (!isOnScreen(el)) continue;
      if (needle) {
        const text = `${el.textContent || ""} ${el.getAttribute("title") || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
        if (!text.includes(needle)) continue;
      }
      return el;
    }
  }
  return null;
}

function isNarrowViewport() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function ensureWorkspaceMenuOpen() {
  const menu = document.getElementById("workspace-mode-menu");
  if (!menu || !menu.classList.contains("hidden")) return;
  const btn = document.getElementById("workspace-mode-btn");
  if (btn && isOnScreen(btn)) btn.click();
}

function openMobileSheet(sheetId) {
  if (!isNarrowViewport()) return;
  const sheet = document.getElementById(sheetId);
  if (!sheet) return;
  document.querySelectorAll(".mobile-sheet.mobile-open, .sidebar.mobile-open").forEach((n) => {
    n.classList.remove("mobile-open");
  });
  sheet.classList.add("mobile-open");
  sheet.setAttribute("aria-hidden", "false");
  document.getElementById("mobile-backdrop")?.classList.remove("hidden");
  document.body.classList.add("mobile-sheet-open");
}

function ensureReveal(kind) {
  if (!kind) return;
  // Next is outside the account menu, so its normal outside-click handler
  // closes the menu. Reveal it again before resolving this tour target.
  if (kind === "account-menu" && document.getElementById("user-menu")?.classList.contains("hidden")) {
    document.getElementById("btn-auth")?.click();
  }
  if (kind === "mobile-tools") openMobileSheet("mobile-tools-sheet");
  if (kind === "mobile-ai") {
    if (isNarrowViewport()) {
      const aiBtn = document.querySelector("[data-mobile-corner='ai']");
      if (aiBtn && isOnScreen(aiBtn)) aiBtn.click();
      else {
        document.querySelector(".sidebar.right")?.classList.add("mobile-open");
        document.getElementById("mobile-backdrop")?.classList.remove("hidden");
        document.body.classList.add("mobile-sheet-open");
      }
    }
  }
}

function placeCircle(el) {
  const circle = document.getElementById("show-me-circle");
  const click = document.getElementById("show-me-click");
  const dim = document.getElementById("show-me-dim");
  if (!circle || !click) return;
  if (!el || !isOnScreen(el)) {
    circle.classList.remove("is-on");
    click.classList.remove("is-on", "is-press");
    if (dim) {
      dim.style.opacity = "0.5";
      dim.style.background = "rgba(1, 4, 9, 0.55)";
    }
    return;
  }
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const diameter = Math.max(56, Math.min(180, Math.max(rect.width, rect.height) + 40));
  const radius = diameter / 2;
  circle.style.width = `${diameter}px`;
  circle.style.height = `${diameter}px`;
  circle.style.left = `${cx - radius}px`;
  circle.style.top = `${cy - radius}px`;
  circle.classList.add("is-on");
  if (dim) {
    dim.style.opacity = "1";
    // Soft blue wash in the hole so the target reads clearly against the dim.
    dim.style.background =
      `radial-gradient(circle at ${cx}px ${cy}px,` +
      ` rgba(126, 200, 255, 0.2) 0px,` +
      ` rgba(126, 200, 255, 0.06) ${Math.max(16, radius - 10)}px,` +
      ` transparent ${Math.max(20, radius - 2)}px,` +
      ` rgba(1, 4, 9, 0.72) ${radius + 4}px)`;
  }
  click.style.left = `${cx}px`;
  click.style.top = `${cy}px`;
  click.classList.add("is-on");
}

function highlight(el, label) {
  clearHighlight();
  const stepEl = document.getElementById("show-me-step");
  if (stepEl) stepEl.textContent = label || "Look here";
  if (!el) {
    const dim = document.getElementById("show-me-dim");
    if (dim) dim.style.opacity = "1";
    return;
  }
  el.classList.add("show-me-target");
  try {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  } catch {
    /* ignore */
  }
  requestAnimationFrame(() => {
    placeCircle(el);
    setTimeout(() => placeCircle(el), 220);
  });
}

function fillExample(example) {
  if (!example) return;
  const editor = document.querySelector(".prompt-editor, #prompt-input, textarea#prompt-input, #wiring-prompt-input");
  if (editor) {
    if ("value" in editor) editor.value = example;
    else editor.textContent = example;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus?.();
  }
  const agentInput = document.getElementById("render-agent-input");
  if (agentInput && /agent|render agent/i.test(activeTour?.title || "")) {
    agentInput.value = example;
    agentInput.focus();
  }
}

function isClickable(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "button" || tag === "a" || tag === "summary") return true;
  if (el.getAttribute("role") === "button" || el.getAttribute("role") === "tab") return true;
  if (el.classList.contains("nav-tab") || el.classList.contains("prompt-mode-btn")) return true;
  if (el.classList.contains("workspace-tab") || el.classList.contains("workspace-mode-btn")) return true;
  if (el.classList.contains("workspace-mode-option") || el.classList.contains("pick-btn")) return true;
  if (el.hasAttribute("data-design-tab") || el.hasAttribute("data-prompt-mode") || el.hasAttribute("data-mode")) return true;
  if (el.hasAttribute("data-tab") || el.hasAttribute("data-tool") || el.hasAttribute("data-panel")) return true;
  return typeof el.onclick === "function";
}

function simulateClick(el) {
  if (!el) return false;
  const marker = document.getElementById("show-me-click");
  marker?.classList.remove("is-press");
  void marker?.offsetWidth;
  marker?.classList.add("is-press");
  try {
    // Prefer native click so listeners that call stopPropagation (workspace menu) work.
    if (typeof el.click === "function") {
      el.click();
      return true;
    }
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  } catch {
    return false;
  }
}

function openDemoGif() {
  const tour = activeTour || getShowMeTour(activeGuideId);
  if (!tour) {
    stopShowMe();
    return;
  }
  const card = activeGuideId ? document.getElementById(activeGuideId) : null;
  const fromCard = card?.querySelector("img[src*='.gif'], video source, img.gs-demo-gif");
  const summary = buildTourSummary(tour, activeGuideId);
  if (fromCard?.getAttribute?.("src")) summary.gif = fromCard.getAttribute("src");
  clearHighlight();
  document.getElementById("show-me-overlay")?.classList.add("hidden");
  showCompletionSummary(summary);
}

function onNextClick() {
  if (overlayMode === "docs") {
    const path = activeTour?.studioPath || `/?showMe=${encodeURIComponent(activeGuideId || "")}`;
    window.location.href = path;
    return;
  }
  if (document.getElementById("show-me-summary")) {
    stopShowMe();
    return;
  }
  advanceShowMe(false);
}

async function runRemixAction() {
  if (!activeTour?.remixAction) return;
  const remixBtn = document.getElementById("show-me-remix");
  const stepEl = document.getElementById("show-me-step");
  try {
    if (remixBtn) remixBtn.disabled = true;
    if (stepEl) stepEl.textContent = "Creating a remix project in your folder...";
    if (activeTour.remixAction === "wiring-stepper" && typeof window.__remixWiringStepperExample === "function") {
      await window.__remixWiringStepperExample();
      if (stepEl) stepEl.textContent = "Remixed. The Arduino Stepper Test Bench project is open in your folder.";
      setTimeout(stopShowMe, 900);
      return;
    }
    throw new Error("This example cannot be remixed yet.");
  } catch (err) {
    if (stepEl) stepEl.textContent = err?.message || "Could not remix this example.";
    if (remixBtn) remixBtn.disabled = false;
  }
}

function onRemixClick() {
  void runRemixAction();
}

function onSkipClick() {
  if (overlayMode === "docs") {
    if (activeTour?.gif || document.getElementById(activeGuideId)?.querySelector("img[src*='.gif']")) {
      openDemoGif();
      return;
    }
    stopShowMe();
    return;
  }
  advanceShowMe(true);
}

function showTourComplete() {
  if (!activeTour) {
    stopShowMe();
    return;
  }
  fillExample(activeTour.example);
  clearHighlight();
  removeDemo();
  const stepEl = document.getElementById("show-me-step");
  const nextBtn = document.getElementById("show-me-next");
  const skipBtn = document.getElementById("show-me-skip");
  const remixBtn = document.getElementById("show-me-remix");
  const summary = buildTourSummary(activeTour, activeGuideId);
  showCompletionSummary(summary);
  document.getElementById("show-me-overlay")?.classList.add("hidden");
  if (stepEl) {
    stepEl.textContent = activeTour.remixAction
      ? "Walkthrough complete. Review the summary, remix the example, or close."
      : "Walkthrough complete. Review the summary below, or close.";
  }
  if (nextBtn) nextBtn.textContent = "Close";
  if (skipBtn) skipBtn.classList.add("hidden");
  if (remixBtn) {
    remixBtn.textContent = activeTour.remixLabel || "Remix example";
    remixBtn.disabled = false;
    remixBtn.classList.add("hidden");
  }
}

function showCompletionSummary(summary = {}) {
  ensureSummaryStyles();
  document.getElementById("show-me-summary")?.remove();
  document.getElementById("show-me-summary-backdrop")?.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "show-me-summary-backdrop";
  backdrop.className = "show-me-summary-backdrop";
  backdrop.addEventListener("click", stopShowMe);

  const card = document.createElement("div");
  card.id = "show-me-summary";
  card.className = "show-me-summary";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", summary.title || "Walkthrough summary");

  const how = Array.isArray(summary.howItWorks) ? summary.howItWorks.filter(Boolean) : [];
  const gif = summary.gif || activeTour?.gif || null;
  const actions = Array.isArray(summary.actions) ? summary.actions : [];

  card.innerHTML = `
    <div class="show-me-summary-glow" aria-hidden="true"></div>
    <div class="show-me-summary-brand">
      <img class="show-me-summary-logo" src="/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1" alt="" width="40" height="40" />
      <span class="show-me-summary-brand-word">Render Studio</span>
    </div>
    ${gif ? `
      <div class="show-me-summary-gif-wrap">
        <img class="show-me-summary-gif" src="${escapeHtml(gif)}" alt="" loading="eager" decoding="async" />
      </div>
    ` : ""}
    <strong>${escapeHtml(summary.title || "Walkthrough complete")}</strong>
    <p class="show-me-summary-body">${escapeHtml(summary.body || "You finished this walkthrough.")}</p>
    ${how.length ? `
      <div class="show-me-summary-how">
        <h4>How it works</h4>
        <ol>
          ${how.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
        </ol>
      </div>
    ` : ""}
    ${actions.length ? `<h4 class="show-me-summary-next-title">Suggested tutorials</h4>` : ""}
    <div class="show-me-summary-actions">
      ${actions.map((action) => {
        if (action.remix) {
          return `<button type="button" class="btn accent btn-compact" data-summary-remix>${escapeHtml(action.label || "Remix example")}</button>`;
        }
        if (action.guideId) {
          return `<button type="button" class="btn accent btn-compact" data-summary-tour="${escapeHtml(action.guideId)}">${escapeHtml(action.label || "Start tour")}</button>`;
        }
        return "";
      }).join("")}
      <button type="button" class="btn secondary btn-compact" data-summary-close>Close</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(card);

  card.querySelectorAll("[data-summary-tour]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const guideId = btn.getAttribute("data-summary-tour") || "";
      stopShowMe();
      if (guideId) setTimeout(() => startShowMe(guideId, { onDocsPage: false }), 120);
    });
  });
  card.querySelector("[data-summary-remix]")?.addEventListener("click", () => {
    void runRemixAction();
  });
  card.querySelector("[data-summary-close]")?.addEventListener("click", stopShowMe);
}

function syncNextLabel() {
  const nextBtn = document.getElementById("show-me-next");
  if (!nextBtn || !activeTour) return;
  const steps = activeTour.steps || [];
  if (stepIndex >= steps.length) nextBtn.textContent = "Summary";
  else nextBtn.textContent = `Next (${stepIndex + 1}/${steps.length})`;
}

function getViewportEl() {
  return (
    document.querySelector("#viewport canvas")
    || document.querySelector("#viewport")
    || document.querySelector("canvas.viewport-canvas")
    || document.querySelector("main canvas")
    || document.querySelector("canvas")
  );
}

function viewportPoint(step) {
  const el = getViewportEl();
  if (!el || !isOnScreen(el)) return null;
  const rect = el.getBoundingClientRect();
  const [fx, fy] = Array.isArray(step.fraction) ? step.fraction : [0.52, 0.42];
  return {
    el,
    x: rect.left + rect.width * Math.min(0.9, Math.max(0.1, Number(fx) || 0.5)),
    y: rect.top + rect.height * Math.min(0.9, Math.max(0.1, Number(fy) || 0.5)),
  };
}

function placeCircleAt(x, y, diameter = 96) {
  const circle = document.getElementById("show-me-circle");
  const click = document.getElementById("show-me-click");
  const dim = document.getElementById("show-me-dim");
  if (!circle || !click) return;
  const radius = diameter / 2;
  circle.style.width = `${diameter}px`;
  circle.style.height = `${diameter}px`;
  circle.style.left = `${x - radius}px`;
  circle.style.top = `${y - radius}px`;
  circle.classList.add("is-on");
  if (dim) {
    dim.style.opacity = "1";
    dim.style.background =
      `radial-gradient(circle at ${x}px ${y}px,` +
      ` rgba(126, 200, 255, 0.2) 0px,` +
      ` rgba(126, 200, 255, 0.06) ${Math.max(16, radius - 10)}px,` +
      ` transparent ${Math.max(20, radius - 2)}px,` +
      ` rgba(1, 4, 9, 0.72) ${radius + 4}px)`;
  }
  click.style.left = `${x}px`;
  click.style.top = `${y}px`;
  click.classList.add("is-on");
}

function simulatePointerAt(x, y, { dbl = false } = {}) {
  const el = document.elementFromPoint(x, y) || getViewportEl();
  if (!el) return false;
  const marker = document.getElementById("show-me-click");
  marker?.classList.remove("is-press");
  void marker?.offsetWidth;
  marker?.classList.add("is-press");
  const common = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
  try {
    el.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mousedown", common));
    el.dispatchEvent(new PointerEvent("pointerup", { ...common, pointerId: 1, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseup", common));
    el.dispatchEvent(new MouseEvent("click", common));
    if (dbl) {
      el.dispatchEvent(new MouseEvent("mousedown", common));
      el.dispatchEvent(new MouseEvent("mouseup", common));
      el.dispatchEvent(new MouseEvent("click", common));
      el.dispatchEvent(new MouseEvent("dblclick", common));
    }
    return true;
  } catch {
    return false;
  }
}

function authToken() {
  try {
    return localStorage.getItem("render3d:token") || "";
  } catch {
    return "";
  }
}

async function seedRobotArmProject({ recreate = false } = {}) {
  const token = authToken();
  if (!token) return null;
  const qs = recreate ? "?recreate=true" : "";
  const res = await fetch(`/api/demo/robot-arm${qs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Could not seed robot arm (${res.status})`);
  }
  return res.json();
}

async function ensureRobotArmForTour(guideId) {
  const tour = getShowMeTour(guideId);
  if (!tour?.needsRobotArm && !ROBOT_ARM_DEMO_TOURS.has(guideId)) return true;
  const stepEl = document.getElementById("show-me-step");
  if (stepEl) stepEl.textContent = "Opening your private Robot Arm project…";
  try {
    const seeded = await seedRobotArmProject({
      // Auto first-run onboarding must not recreate a demo the user deleted.
      recreate: guideId !== "prompt-onboarding",
    });
    const pid = seeded?.project_id;
    if (!pid) return true;
    try {
      localStorage.setItem("render3d:lastProjectId", pid);
      localStorage.setItem("render3d:demoRobotArmProjectId", pid);
    } catch {
      /* ignore */
    }
    if (typeof window.__openProject === "function") {
      await window.__openProject(pid);
      // Give the mesh a moment to appear before viewport clicks.
      await new Promise((r) => setTimeout(r, 1200));
    } else {
      const params = new URLSearchParams(window.location.search);
      params.set("project", pid);
      params.set("showMe", guideId);
      window.location.href = `/?${params.toString()}`;
      return false;
    }
  } catch (err) {
    console.warn("Robot arm demo seed failed:", err);
    if (stepEl) stepEl.textContent = "Could not open Robot Arm demo — continuing with current project.";
  }
  return true;
}

function resolveStepTarget(step) {
  if (step.ensureMenu) ensureWorkspaceMenuOpen();
  if (step.reveal) ensureReveal(step.reveal);
  if (step.demo) return demoTarget(step);
  if (step.viewport) return getViewportEl();
  return findFirst(step.selector, step.matchText);
}

function advanceShowMe(skipClick) {
  if (!activeTour) {
    stopShowMe();
    return;
  }
  const steps = activeTour.steps || [];
  if (stepIndex >= steps.length) {
    showTourComplete();
    return;
  }
  const step = steps[stepIndex];
  const n = stepIndex + 1;
  resolveStepTarget(step);
  setTimeout(() => {
    if (!activeTour) return;
    if (step.ensureMenu) ensureWorkspaceMenuOpen();
    if (step.reveal) ensureReveal(step.reveal);

    if (step.viewport) {
      const pt = viewportPoint(step);
      const stepEl = document.getElementById("show-me-step");
      if (stepEl) stepEl.textContent = `${n}/${steps.length}: ${step.label}`;
      clearHighlight();
      if (pt) {
        placeCircleAt(pt.x, pt.y, 110);
        if (!skipClick && step.click !== false) {
          setTimeout(() => {
            if (!activeTour) return;
            simulatePointerAt(pt.x, pt.y, { dbl: step.viewport === "dblclick" });
          }, 320);
        }
      }
      return;
    }

    const el = step.demo ? demoTarget(step) : findFirst(step.selector, step.matchText);
    highlight(el, `${n}/${steps.length}: ${step.label}`);
    const shouldClick = !skipClick && step.click !== false && el && (isClickable(el) || step.click === true);
    if (shouldClick) {
      setTimeout(() => {
        if (!activeTour) return;
        simulateClick(el);
      }, 280);
    }
  }, step.reveal || step.ensureMenu ? 180 : 0);
  stepIndex += 1;
  syncNextLabel();
  if (stepIndex >= steps.length) {
    fillExample(activeTour.example);
    const nextBtn = document.getElementById("show-me-next");
    if (nextBtn) nextBtn.textContent = "Summary";
  }
}

export function getShowMeTour(guideId) {
  return SHOW_ME_TOURS[guideId] || null;
}

export function startShowMe(guideId, { onDocsPage = false } = {}) {
  const tour = getShowMeTour(guideId);
  if (!tour) return false;

  if (guideId === "prompt-onboarding" || guideId === "ai-generate") {
    try {
      void import("../components/feature-events.js?v=20260721-quest-notify&vrboard=20260915-spatial-draw4").then((m) => {
        m.emitFeatureUsed?.("welcome-walkthrough", { title: "Take the Studio walkthrough" });
      });
    } catch {
      /* ignore */
    }
  }

  ensureOverlay();
  const overlay = document.getElementById("show-me-overlay");
  const nextBtn = document.getElementById("show-me-next");
  const skipBtn = document.getElementById("show-me-skip");
  activeTour = tour;
  activeGuideId = guideId;
  stepIndex = 0;
  overlay?.classList.remove("hidden");
  document.getElementById("show-me-title").textContent = tour.title;
  document.getElementById("show-me-remix")?.classList.add("hidden");
  document.getElementById("show-me-skip")?.classList.remove("hidden");

  if (!resizeHandler) {
    resizeHandler = () => {
      const target = document.querySelector(".show-me-target");
      if (target) placeCircle(target);
    };
    window.addEventListener("resize", resizeHandler);
  }

  if (onDocsPage) {
    overlayMode = "docs";
    const card = document.getElementById(guideId);
    if (card) highlight(card, `${tour.title} — guide on this page`);
    else clearHighlight();
    document.getElementById("show-me-step").textContent =
      tour.needsRobotArm || ROBOT_ARM_DEMO_TOURS.has(guideId)
        ? "Open Studio — we'll spin up a private Robot Arm project for the live click-through."
        : "Open Studio for a live click-through, or watch the demo GIF.";
    if (nextBtn) nextBtn.textContent = "Open Studio walkthrough";
    if (skipBtn) skipBtn.textContent = tour.gif ? "Watch summary GIF" : "Close";
    return true;
  }

  overlayMode = "studio";
  if (skipBtn) skipBtn.textContent = "Skip step";
  syncNextLabel();
  void (async () => {
    const ready = await ensureRobotArmForTour(guideId);
    if (!ready || !activeTour) return;
    advanceShowMe(false);
  })();
  return true;
}

export function maybeAutoStartShowMeFromQuery() {
  const id = new URLSearchParams(window.location.search).get("showMe");
  if (!id) return;
  const params = new URLSearchParams(window.location.search);
  params.delete("showMe");
  const qs = params.toString();
  const clean = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash || ""}`;
  window.history.replaceState({}, "", clean || "/");
  const delay = ROBOT_ARM_DEMO_TOURS.has(id) ? 1400 : 900;
  setTimeout(() => startShowMe(id, { onDocsPage: false }), delay);
}
