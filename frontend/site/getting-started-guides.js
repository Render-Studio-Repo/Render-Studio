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
    "id": "robotics",
    "title": "Robotics configuration"
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
    "gif": "/docs/media/ai-generate.gif?v=20260724-unique",
    "summary": "Describe a part; Generate builds geometry into the open project.",
    "steps": [
      "Open or create a project in the left explorer.",
      "Write size, units, and what the part does.",
      "Optional: attach images, DXF, or @component refs.",
      "Pick Render / CAD / Fusion and click Generate.",
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
      "cad",
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
    "gif": "/docs/media/multi-gen.gif?v=20260724-unique",
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
    "gif": "/docs/media/picks.gif?v=20260724-unique",
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
    "gif": "/docs/media/link-to-prompt.gif?v=20260724-unique",
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
    "gif": "/docs/media/workspaces.gif?v=20260724-unique",
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
    "id": "projects-upload",
    "category": "projects",
    "title": "Projects, units & upload",
    "demo": "projects-upload",
    "gif": "/docs/media/new-project.gif?v=20260907-chrome-mark",
    "summary": "Create a project with the + next to Projects, set units, and drop CAD into the explorer.",
    "steps": [
      "In the left explorer, click the + next to Projects (or the + on a folder).",
      "Set units in the toolbar (mm/cm/m/in/ft).",
      "Drop STEP, STL, GLB, DXF, PDF, or images onto the viewport or explorer."
    ],
    "ask": "How do I create a project and upload files?",
    "keywords": [
      "new project",
      "plus",
      "upload",
      "units"
    ],
    "where": "Explorer \u2192 Projects +"
  },
  {
    "id": "pin-projects",
    "category": "projects",
    "title": "Pin projects in the project menu",
    "demo": "workspaces",
    "gif": "/docs/media/pin-projects.gif?v=20260916-newfeats1",
    "summary": "Star up to five personal projects so they stay at the top of the Projects list.",
    "steps": [
      "In the left Projects list, click the star on a row, or right-click \u2192 Pin to projects.",
      "Pinned projects sit in a Pinned section at the top. Unpin the same way.",
      "You can pin up to 5. Finder results have the same Pin to projects action."
    ],
    "ask": "How do I pin a project so it stays at the top of the list?",
    "keywords": [
      "pin",
      "star",
      "pinned projects",
      "project menu",
      "favorites"
    ],
    "where": "Explorer \u2192 Projects \u00b7 star"
  },
  {
    "id": "viewport-finder",
    "category": "modeling",
    "title": "Cmd/Ctrl+F finder",
    "demo": "projects-upload",
    "gif": "/docs/media/viewport-finder.gif?v=20260916-newfeats1",
    "summary": "Spotlight search across your projects, prompts, and timeline without leaving the viewport.",
    "steps": [
      "Click the 3D viewport so a text field is not focused.",
      "Press Cmd+F on Mac or Ctrl+F on Windows.",
      "Type to filter projects, past prompts, and history.",
      "Enter opens the hit. Right-click for pin, share, or details."
    ],
    "ask": "How do I search projects and prompts with Cmd+F or Ctrl+F?",
    "keywords": [
      "finder",
      "cmd+f",
      "ctrl+f",
      "search",
      "spotlight",
      "viewport search"
    ],
    "where": "3D viewport \u2192 Cmd+F / Ctrl+F"
  },
  {
    "id": "clip-video-editor",
    "category": "projects",
    "title": "Clip / video editor",
    "demo": "markup",
    "gif": "/docs/media/clip-video-editor.gif?v=20260916-newfeats1",
    "summary": "Viewport recordings open a built-in editor \u2014 timeline, trim, audio, Share, GIF, and AI film-edit.",
    "steps": [
      "Click Record on the viewport (or drop a video into the project).",
      "The clip opens in an Editor tab: video lane, audio lane, trim handles.",
      "Drag extra clips, stills, or MP3 onto the lanes. Share or export GIF from the preview.",
      "Use AI film edit under the timeline: type a cut, Improve prompt, Generate."
    ],
    "ask": "How do I edit a viewport recording in the clip editor?",
    "keywords": [
      "clip",
      "video",
      "editor",
      "timeline",
      "record",
      "film",
      "gif"
    ],
    "where": "Viewport Record \u2192 Editor tab"
  },
  {
    "id": "imagine-panel",
    "category": "ai-cad",
    "title": "Imagine panel & /fetch",
    "demo": "generate",
    "gif": "/docs/media/imagine-panel.gif?v=20260916-newfeats1",
    "summary": "Imagine is its own tab next to Compose and History. Generate product images, then /fetch public CAD.",
    "steps": [
      "Open Imagine next to Compose and History.",
      "Describe a product photo and Generate. Images save under imagine/.",
      "Send an image to CAD or Mesh from the gallery.",
      "Type / then Tab to complete /fetch. Pick STL / GLB / STEP / 3MF."
    ],
    "ask": "How do I use Imagine and /fetch public CAD?",
    "keywords": [
      "imagine",
      "image",
      "fetch",
      "/fetch",
      "grid",
      "list"
    ],
    "where": "Right panel \u2192 Imagine"
  },
  {
    "id": "prompt-persist",
    "category": "ai-cad",
    "title": "Prompt drafts persist per project",
    "demo": "generate",
    "gif": "/docs/media/prompt-persist.gif?v=20260916-newfeats1",
    "summary": "CAD, Wiring, and Imagine drafts stay with the project you wrote them in.",
    "steps": [
      "Write a prompt in Compose, Wiring, or Imagine.",
      "Switch projects \u2014 the outgoing draft is saved, then the live box is wiped.",
      "The incoming project restores its own draft, or stays empty."
    ],
    "ask": "Do compose drafts stay when I switch projects?",
    "keywords": [
      "prompt",
      "persist",
      "draft",
      "project switch"
    ],
    "where": "Right panel \u2192 Compose"
  },
  {
    "id": "reference-folders",
    "category": "projects",
    "title": "Reference file folders",
    "demo": "markup",
    "gif": "/docs/media/reference-folders.gif?v=20260916-newfeats1",
    "summary": "Reference Files nest into folders so screenshots, recordings, and AR captures stay organized.",
    "steps": [
      "Open Reference Files in the project browser.",
      "Captures land in Screenshots, Screen Recordings, or AR.",
      "Open a recording to jump into the clip editor."
    ],
    "ask": "Where do screenshots and recordings go in the project?",
    "keywords": [
      "reference",
      "folder",
      "capture",
      "screenshot",
      "recording"
    ],
    "where": "Explorer \u2192 Reference Files"
  },
  {
    "id": "share-folders",
    "category": "projects",
    "title": "Share a private folder",
    "demo": "share",
    "gif": "/docs/media/share-folder.gif?v=20260724-unique",
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
    "gif": "/docs/media/reference-markup.gif?v=20260724-unique",
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
    "gif": "/docs/media/solid-tools.gif?v=20260724-unique",
    "summary": "Ribbon Create/Modify/Pattern plus direct tools: Press-Pull, fillet, transform, color, measure.",
    "steps": [
      "Switch to the SOLID design tab.",
      "Use Ribbon Create for primitives and features.",
      "Use Tools for Press-Pull, Transform (M), Color, Measure, Split."
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
    "gif": "/docs/media/select-object.gif?v=20260724-unique",
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
    "gif": "/docs/media/sketch.gif?v=20260724-unique",
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
    "gif": "/docs/media/canvas-workspace.gif?v=20260916-newfeats1",
    "summary": "Freehand concept pad — open last or new, Smart Description, then send into AI Compose.",
    "steps": [
      "Open Canvas from the document tabs. Choose Open last or Create new, and name the board.",
      "Sketch layout, labels, and callouts with pen, shapes, and text.",
      "Smart Description interviews the sketch and fills a CAD prompt.",
      "Send to Compose, then Generate. Boards save under the project canvas/ folder."
    ],
    "ask": "How do I use Canvas and attach a sketch to AI?",
    "keywords": [
      "canvas",
      "attach sketch",
      "smart description",
      "open last",
      "sketch pad"
    ],
    "where": "Document tabs \u2192 Canvas"
  },
  {
    "id": "rigging-urdf",
    "category": "rigging",
    "title": "URDF / SRDF & Motion",
    "demo": "generate",
    "gif": "/docs/media/rigging-urdf.gif?v=20260724-unique",
    "summary": "GLB shows shape; direct URDF/SRDF files drive simulation. Validate them with Jake, then open Motion.",
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
      "direct xml",
      "simulated motion"
    ],
    "where": "Rigging \u2192 URDF/SRDF mode \u00b7 Motion workbench"
  },
  {
    "id": "wiring",
    "category": "wiring",
    "title": "Wiring Simulator",
    "demo": "wiring",
    "gif": "/docs/media/wiring.gif?v=20260724-unique",
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
    "id": "wiring-compose",
    "category": "wiring",
    "title": "Wiring compose, History & Send to wiring",
    "demo": "wiring",
    "gif": "/docs/media/wiring-compose.gif?v=20260916-newfeats1",
    "summary": "Compact compose chrome, History stamps on Generate, link chips, and Send to wiring from the catalog.",
    "steps": [
      "Open Wiring. Compose is one compact row plus Project parts.",
      "Generate inserts a pending History row immediately, then marks succeeded or failed.",
      "Paste product URLs \u2014 Links chips show a short title and favicon.",
      "From Parts Catalog, Send to wiring so the sourced part lands in the prompt."
    ],
    "ask": "How do Wiring History, drafts, and Send to wiring work?",
    "keywords": [
      "wiring history",
      "send to wiring",
      "links chips",
      "compose draft"
    ],
    "where": "Wiring workspace \u00b7 Parts Catalog"
  },
  {
    "id": "source-parts",
    "category": "wiring",
    "title": "Source parts with \u24d8 and drag into Wiring AI",
    "demo": "source-parts",
    "gif": "/docs/media/source-parts.gif?v=20260724-unique",
    "summary": "Click \u24d8 on a component to identify and source it online, then drag the sourced part into the Wiring Simulator AI prompt for pin-aware circuits.",
    "steps": [
      "In the Project browser, click the \u24d8 button on a component.",
      "Search the catalog (e.g. NEMA 17 stepper) and click Use this to link the part.",
      "Save the profile so pins and specs stay with the component.",
      "Open Wiring Simulator and drag the sourced part into the Wiring AI prompt."
    ],
    "ask": "How do I source a part with the i button and use it in Wiring?",
    "keywords": [
      "source parts",
      "part profile",
      "step.parts",
      "wiring",
      "drag to prompt",
      "info button"
    ],
    "where": "Project browser \u24d8 \u00b7 Wiring Simulator AI prompt"
  },
  {
    "id": "parts-catalog",
    "category": "architect",
    "title": "Parts Catalog",
    "demo": "source-parts",
    "gif": "/docs/media/parts-catalog.gif?v=20260916-newfeats1",
    "summary": "McMaster-Carr and STEP library parts — Import into the project or Send to wiring. Insert is gone.",
    "steps": [
      "Open the Parts Catalog design tab.",
      "Search McMaster or the STEP library, then Import.",
      "Send to wiring to drop the sourced part and pins into the Wiring prompt."
    ],
    "ask": "How do I find and import catalog parts?",
    "keywords": [
      "catalog",
      "mcmaster",
      "parts",
      "insert",
      "step",
      "send to wiring"
    ],
    "where": "Parts Catalog tab"
  },
  {
    "id": "cloud-sync",
    "category": "cloud",
    "title": "Fusion 360 & Onshape sync",
    "demo": "cloud",
    "gif": "/docs/media/cloud-sync.gif?v=20260724-unique",
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
    "gif": "/docs/media/render-agent.gif?v=20260724-unique",
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
    "demo": "preferences",
    "gif": "/docs/media/preferences.gif?v=20260724-unique",
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
    "id": "credibility",
    "category": "help",
    "title": "Credibility \u2014 open source & licenses",
    "demo": "agent",
    "gif": "/docs/media/render-agent.gif?v=20260724-unique",
    "summary": "Jake, VibeCAD, img2threejs, Three.js, Fritzing, and the other public projects Render Studio builds on.",
    "steps": [
      "Open Docs and click the small Credibility button.",
      "Read CAD, Mesh, Wiring, and runtime credits with license badges.",
      "Follow repository links for the full LICENSE text."
    ],
    "ask": "Which open-source projects does Render Studio use?",
    "keywords": [
      "credibility",
      "license",
      "open source",
      "jake",
      "vibecad",
      "img2threejs",
      "three.js",
      "fritzing",
      "attribution"
    ],
    "where": "Docs \u2192 Credibility"
  },
  {
    "id": "robotics-configuration",
    "category": "robotics",
    "title": "Robotics Configuration",
    "demo": "preferences",
    "gif": "/docs/media/robotics-configuration.gif?v=20260914-lanip1",
    "summary": "Connect Viser (HTTP LAN) and OpenArm Quest Teleop (HTTPS) through Studio proxies so a laptop on https://render3d.app never hits mixed content or a self-signed Pi cert.",
    "steps": [
      "Open the ROBOTICS design tab, then the Teleop strip next to Viser.",
      "Paste https://YOUR_LAN_IP:8443/teleop (DIMOS is HTTPS). Studio iframes /api/teleop/p/YOUR_LAN_IP/8443/teleop.",
      "Bind DIMOS on the Pi to 0.0.0.0:8443. Viser is HTTP on 0.0.0.0:8095 \u2014 paste http://YOUR_LAN_IP:8095.",
      "In Quest Browser, Connect auto-clicks after the proxied page loads. Desktop Connect may stay grey (WebXR).",
      "Account \u2192 Robotics and VR Settings stay in sync: Viser URL, teleop URL, camera IPs, cloud/server."
    ],
    "ask": "How do I connect OpenArm Quest Teleop and Viser from render3d.app?",
    "keywords": [
      "teleop",
      "viser",
      "openarm",
      "dimos",
      "quest",
      "robotics",
      "lan",
      "proxy",
      "8443",
      "8095",
      "ipconfig",
      "YOUR_LAN_IP"
    ],
    "where": "ROBOTICS \u2192 Teleop \u00b7 Docs \u2192 Robotics Configuration"
  },
  {
    "id": "robotics-viser-lan",
    "category": "robotics",
    "title": "Viser LAN proxy",
    "demo": "preferences",
    "gif": "/docs/media/robotics-viser.gif?v=20260914-lanip1",
    "summary": "Paste the Pi HTTP URL. HTTPS render3d.app iframes same-origin /api/viser/p/host/port/.",
    "steps": [
      "On the Pi start Viser with host=0.0.0.0:8095 (HTTP, not https).",
      "On a laptop paste http://YOUR_LAN_IP:8095 \u2014 not 127.0.0.1.",
      "Click Connect. URLs save as you type and appear in VR Settings."
    ],
    "ask": "How do I load Viser from a laptop on render3d.app?",
    "keywords": ["viser", "8095", "lan", "0.0.0.0", "proxy"],
    "where": "ROBOTICS ribbon \u2192 Viser URL"
  },
  {
    "id": "robotics-teleop-proxy",
    "category": "robotics",
    "title": "Teleop HTTPS proxy",
    "demo": "preferences",
    "gif": "/docs/media/robotics-teleop.gif?v=20260914-lanip1",
    "summary": "DIMOS /teleop is HTTPS. Studio proxies it so Quest never sees the self-signed Pi cert.",
    "steps": [
      "On the Pi: dimos run teleop-quest-openarm bound to 0.0.0.0:8443.",
      "Paste https://YOUR_LAN_IP:8443/teleop in the Teleop URL field.",
      "Click Teleop / Robotics setup for this guide. In Quest, Connect auto-clicks after load."
    ],
    "ask": "Why is Teleop Connect grey on desktop?",
    "keywords": ["teleop", "connect", "quest browser", "self-signed", "8443"],
    "where": "ROBOTICS ribbon \u2192 Teleop"
  },
  {
    "id": "robotics-wrist-cameras",
    "category": "robotics",
    "title": "Connecting wrist cameras",
    "demo": "preferences",
    "gif": "/docs/media/wrist-cameras.gif?v=20260916-gifs40",
    "summary": "Plug Arducam-style wrist USB cameras into the Mac running Studio. Wrist Cam auto-publishes JPEGs on :8001 — no curl on the happy path.",
    "steps": [
      "Plug the wrist USB camera (Arducam-style) into the Mac running Studio. Prefer a USB-C / USB 3 port.",
      "Start Studio on this computer from the project venv with python run.py. Studio listens on port 8001.",
      "In the Cam IP field, enter this computer’s LAN IP only — the host, not an /api/robotics/hand-cam/ path. Port 8001 is implied.",
      "Click Wrist Cam on the Robotics ribbon, or Cameras in Viser. Studio auto POSTs publish — no curl on the happy path.",
      "If macOS Camera settings never list the USB cam (there is no + to add one), click Allow camera. That runs Python/ffmpeg so Camera can see the device. Approve Python and/or ffmpeg if a prompt appears.",
      "Left and Right overlays appear; drag them to any screen corner. One USB cam fills Left only. Plug a second cam (preferably another USB-C / USB 3 port) for Right.",
      "If there is no feed: Copy debug log. Do not use FaceTime. JPEG snapshots are /api/robotics/hand-cam/left.jpg and right.jpg on this Studio host."
    ],
    "ask": "How do I connect wrist USB cameras in Studio?",
    "keywords": [
      "wrist",
      "camera",
      "arducam",
      "usb",
      "8001",
      "allow camera",
      "hand-cam",
      "ffmpeg",
      "python",
      "wrist cam"
    ],
    "where": "ROBOTICS ribbon \u2192 Wrist Cam \u00b7 Viser \u2192 Cameras"
  },
  {
    "id": "viewport-split-layouts",
    "category": "modeling",
    "title": "Saved viewport split layouts",
    "demo": "generate",
    "gif": "/docs/media/viewport-split-layouts.gif?v=20260916-gifs40",
    "summary": "Save a named mosaic of Viewport / Wiring / Parts List, then share or import the layout like any other preview.",
    "steps": [
      "Layouts is last on the viewport tab strip",
      "Name the save — mosaic thumbnail of the live tree",
      "Copy share link or import JSON / URL",
      "Marketplace has a free Viewport layouts section",
    ],
    "ask": "How do I save and share a viewport split layout?",
    "keywords": ["split", "layouts", "mosaic", "viewport layout", "share layout"],
    "where": "Viewport tab strip → Layouts · Account → Viewport"
  },
  {
    "id": "public-pin",
    "category": "projects",
    "title": "Pin to public profile",
    "demo": "generate",
    "gif": "/docs/media/public-pin.gif?v=20260916-gifs40",
    "summary": "Public projects can be pinned on your public profile so visitors see the featured models first.",
    "steps": [
      "Open a public project — Pin to public is on the row",
      "Confirm — cap is independent of the 5 personal pins",
      "Your public page lists pinned models first",
    ],
    "ask": "How do I pin a project on my public profile?",
    "keywords": ["public pin", "pin to public", "profile pin"],
    "where": "Public project row → Pin to public"
  },
  {
    "id": "film-edit",
    "category": "projects",
    "title": "AI film-edit on the clip timeline",
    "demo": "generate",
    "gif": "/docs/media/film-edit.gif?v=20260916-gifs40",
    "summary": "Under the clip editor, prompt a cut, Improve prompt, then Generate a film edit without leaving Studio.",
    "steps": [
      "Open a viewport recording in the Editor tab",
      "Type a film-edit cut under the timeline",
      "Improve prompt, then Generate",
      "Job runs in the background — safe to refresh",
    ],
    "ask": "How do I run an AI film-edit on a viewport recording?",
    "keywords": ["film edit", "ai film", "clip generate", "video edit"],
    "where": "Editor tab → AI film edit under the timeline"
  },
  {
    "id": "native-joints",
    "category": "rigging",
    "title": "Native FreeCAD assembly joints",
    "demo": "generate",
    "gif": "/docs/media/native-joints.gif?v=20260916-gifs40",
    "summary": "Author the 13 FreeCAD Assembly joint types, save Joints / FCStd, and export STEP + joints for Fusion.",
    "steps": [
      "Open Assembly — joints live next to the part tree",
      "Set axis, limits, and drive the live pose",
      "Export STEP + joints package for Fusion",
    ],
    "ask": "How do native FreeCAD assembly joints work?",
    "keywords": ["joints", "assembly", "revolute", "freecad joints"],
    "where": "Assembly / Joints folder · Export STEP + joints"
  },
  {
    "id": "code-workspace",
    "category": "projects",
    "title": "Code workspace",
    "demo": "generate",
    "gif": "/docs/media/code-workspace.gif?v=20260916-gifs40",
    "summary": "Nested explorer with syntax tabs, JSON/CSV/XLSX/PDF previews, and revision-checked saves that survive project switches.",
    "steps": [
      "Open a code folder — explorer + file tabs",
      "JSON tree or raw; CSV as a table",
      "Save is revision-checked — drafts park per session",
    ],
    "ask": "How does the project code workspace work?",
    "keywords": ["code", "firmware", "json tree", "csv", "xlsx"],
    "where": "Project code folder · Code document tabs"
  },
  {
    "id": "settings-search",
    "category": "help",
    "title": "Settings search",
    "demo": "generate",
    "gif": "/docs/media/settings-search.gif?v=20260916-gifs40",
    "summary": "Type in Preferences or Management to jump to a setting instead of hunting sections.",
    "steps": [
      "Open Preferences — search is at the top",
      "Type a setting — results jump the panel",
      "Management dashboard has the same search",
    ],
    "ask": "How do I search Preferences or Management settings?",
    "keywords": ["settings search", "preferences search", "jump to setting"],
    "where": "Account → Preferences search · Management search"
  },
  {
    "id": "mobile-studio",
    "category": "help",
    "title": "Mobile studio chrome",
    "demo": "generate",
    "gif": "/docs/media/mobile-studio.gif?v=20260916-gifs40",
    "summary": "Phone layout: hamburger menu, profile top-right, tools FAB, locked viewport so orbit does not fight chrome.",
    "steps": [
      "Open Studio on a phone — app chrome, not a shrunk desktop",
      "Hamburger opens Projects / Workspaces",
      "Tools FAB: Record, screenshot, fit",
    ],
    "ask": "How does Studio look on a phone?",
    "keywords": ["mobile", "phone", "hamburger", "fab"],
    "where": "Phone / tablet Studio chrome"
  },
  {
    "id": "share-remix",
    "category": "projects",
    "title": "Share link & remix",
    "demo": "generate",
    "gif": "/docs/media/share-remix.gif?v=20260916-gifs40",
    "summary": "Copy a share link; signed-in visitors remix into a new project or an existing shared workspace.",
    "steps": [
      "Export → Copy share link (pinned at the top)",
      "Remix → Create project & open editor",
      "Shared workspace: add to existing or create new",
    ],
    "ask": "How do share links and remix into a workspace work?",
    "keywords": ["share link", "remix", "public"],
    "where": "Export → Copy share link · Remix on /share"
  },
  {
    "id": "freecad-kernel",
    "category": "modeling",
    "title": "FreeCAD kernel move / delete / extrude",
    "demo": "generate",
    "gif": "/docs/media/freecad-kernel.gif?v=20260916-gifs40",
    "summary": "Move, delete, and Extrude/Pad/Pocket persist on the FreeCAD/OCC STEP document, not a mesh-only preview.",
    "steps": [
      "Select a body — Move writes the STEP document",
      "Extrude / Pad / Pocket match FreeCAD Tasks",
      "Refresh — geometry is still on the STEP",
    ],
    "ask": "Do move, delete, and extrude persist on the FreeCAD STEP?",
    "keywords": ["freecad", "extrude", "move", "delete", "kernel", "step"],
    "where": "SOLID tools → Move / Delete / Extrude"
  },
  {
    "id": "vr-menu",
    "category": "rigging",
    "title": "VR world menu & laser",
    "demo": "generate",
    "gif": "/docs/media/vr-menu.gif?v=20260916-gifs40",
    "summary": "Quest menu-aim uses the posed controller ray. Trigger clicks HUD; DimOS does not steal picks while the menu is hit.",
    "steps": [
      "Enter VR — left monitor sits beside CAD",
      "Aim at a menu — short beam + tip, not a void laser",
      "Hold B — dismiss tool, world-lock AI, laser on",
    ],
    "ask": "How do I aim and click the VR world menu?",
    "keywords": ["vr menu", "laser", "quest", "hold b"],
    "where": "Quest VR world menu · Hold B"
  },
  {
    "id": "public-room",
    "category": "projects",
    "title": "Public room — drop a project",
    "demo": "generate",
    "gif": "/docs/media/public-room.gif?v=20260916-gifs40",
    "summary": "In a public VR room, drop a project both people can pick up and inspect together.",
    "steps": [
      "Join a public room from VR Studio tabs",
      "Drop a project into the shared floor",
      "Peer sees the same GLB — live, not a screenshot",
    ],
    "ask": "How do I drop a project in a public VR room?",
    "keywords": ["public room", "drop project", "vr collab"],
    "where": "VR Studio → Public room"
  },
  {
    "id": "document-tabs",
    "category": "modeling",
    "title": "Viewport document tab strip",
    "demo": "generate",
    "gif": "/docs/media/document-tabs.gif?v=20260916-gifs40",
    "summary": "Image, PDF, McMaster, and DXF open as parked tabs. 3D stays in the DOM — no close-to-return.",
    "steps": [
      "Open a PDF — strip lists Viewport + the doc",
      "Click Viewport to return without closing the PDF",
      "Recordings and Canvas join the same strip",
    ],
    "ask": "How do document tabs work with the 3D viewport?",
    "keywords": ["document tabs", "pdf tab", "viewport chip"],
    "where": "Document tab strip above the viewport"
  },
  {
    "id": "dimos-enable",
    "category": "robotics",
    "title": "DIMOS stays gated until Enable",
    "demo": "generate",
    "gif": "/docs/media/dimos-enable.gif?v=20260916-gifs40",
    "summary": "Quest robotics and teleop stay off until Enable Robotics or Activate. Cloud never exposes :8443.",
    "steps": [
      "Robot tab — Enable is off until you tap it",
      "Enable mounts the DimOS viewer (not a stub)",
      "Cloud origin closes the pipe — LAN only",
    ],
    "ask": "Why is DIMOS off until I Enable Robotics?",
    "keywords": ["dimos", "enable robotics", "gated", "teleop"],
    "where": "Robot tab → Enable Robotics / Activate"
  },
  {
    "id": "exploded-view",
    "category": "modeling",
    "title": "Exploded view",
    "demo": "generate",
    "gif": "/docs/media/exploded-view.gif?v=20260916-gifs40",
    "summary": "Explode an assembly to inspect mates. Turning it off reloads the assembled parent — rotate does not collapse it.",
    "steps": [
      "Select the assembly → Exploded view",
      "Parts separate along their axes",
      "Off reloads the assembled parent; rotate keeps explode",
    ],
    "ask": "How does exploded view work?",
    "keywords": ["exploded", "explode", "assembly"],
    "where": "Assembly → Exploded view"
  },
  {
    "id": "kernel-measure",
    "category": "modeling",
    "title": "Kernel measure",
    "demo": "generate",
    "gif": "/docs/media/kernel-measure.gif?v=20260916-gifs40",
    "summary": "Measure prefers FreeCAD/OCC vertex/edge/face distance from the STEP, with mesh centroid as fallback.",
    "steps": [
      "Tools → Measure (or first Hold-A VR page)",
      "Kernel returns live topo numbers",
      "Share links expose Measure after Transparent",
    ],
    "ask": "How does kernel measure work?",
    "keywords": ["measure", "kernel", "distance", "step"],
    "where": "Tools → Measure · share viewer Measure"
  },
  {
    "id": "vr-spatial-draw",
    "category": "sketch-canvas",
    "title": "Spatial AI Draw with live voice",
    "demo": "generate",
    "gif": "/docs/media/vr-spatial-draw.gif?v=20260916-gifs40",
    "summary": "In VR Draw, lasso a surface, talk with live voice, Smart Description, then Generate only when you press it.",
    "steps": [
      "Enter VR → Draw → AI Prompt",
      "Live voice describes the selected region",
      "Smart Description, then press Generate",
    ],
    "ask": "How do I circle a model in VR and talk to the live voice agent?",
    "keywords": ["spatial draw", "lasso", "live voice", "vr draw"],
    "where": "VR → Draw → AI Prompt"
  },
  {
    "id": "send-to-wiring",
    "category": "wiring",
    "title": "Send catalog parts to wiring",
    "demo": "generate",
    "gif": "/docs/media/send-to-wiring.gif?v=20260916-gifs40",
    "summary": "From Parts Catalog, Send to wiring so the sourced part and pins land in the Wiring prompt — no re-search.",
    "steps": [
      "Parts Catalog — import or Send to wiring",
      "Wiring prompt gets the part + pins",
      "History stamps immediately",
    ],
    "ask": "How do I send a catalog part to wiring?",
    "keywords": ["send to wiring", "catalog", "pins"],
    "where": "Parts Catalog → Send to wiring"
  },
  {
    "id": "wiring-3d-ar",
    "category": "wiring",
    "title": "Wiring 3D / AR",
    "demo": "generate",
    "gif": "/docs/media/wiring-3d-ar.gif?v=20260916-gifs40",
    "summary": "Bottom-left AR/3D controls, isolated wiring rendering, and contact-only 1:1 AR placement.",
    "steps": [
      "Wiring workspace — AR / 3D toggle bottom-left",
      "Inspect a sourced component — pins preserved",
      "Headset: contact-only placement, not a floating sketch",
    ],
    "ask": "How does Wiring 3D / AR placement work?",
    "keywords": ["wiring ar", "3d wiring", "1:1"],
    "where": "Wiring workspace → AR / 3D"
  },
  {
    "id": "edit-selected",
    "category": "ai-cad",
    "title": "Edit Selected — scale and attachment",
    "demo": "generate",
    "gif": "/docs/media/edit-selected.gif?v=20260916-gifs40",
    "summary": "Edits keep source-to-assembly placement and scale. Failed results do not clobber the live body.",
    "steps": [
      "Select a body → Edit selected in Compose",
      "Generate — replacement sits on the same mate",
      "Failed run keeps the old body — no false success",
    ],
    "ask": "How does Edit Selected keep scale and attachment?",
    "keywords": ["edit selected", "attachment", "scale"],
    "where": "Compose → Edit selected"
  },
  {
    "id": "marketplace-layouts",
    "category": "modeling",
    "title": "Marketplace viewport layouts",
    "demo": "generate",
    "gif": "/docs/media/marketplace-layouts.gif?v=20260916-gifs40",
    "summary": "Browse free Viewport layouts, Install into the general layout store, then apply on any project.",
    "steps": [
      "Marketplace → Viewport layouts",
      "Install writes /api/me/viewport-layouts",
      "Account → Viewport lists the save; apply on any file",
    ],
    "ask": "How do I install a viewport layout from the Marketplace?",
    "keywords": ["marketplace", "viewport layouts", "install"],
    "where": "Marketplace → Viewport layouts · Account → Viewport"
  },
    {
    "id": "self-host",
    "category": "help",
    "title": "Connect your database (self-host)",
    "demo": "preferences",
    "gif": "/docs/media/database-setup.gif?v=20260916-gifs40",
    "summary": "Point this clone at YOUR Supabase, or keep sqlite local users.",
    "steps": [
      "Open /database.html (or /setup.html on the origin — loopback or super-admin).",
      "Paste SUPABASE_URL and service_role (server only). Never put service_role in JS.",
      "Copy SQL from integrations/supabase/install_users.sql into the Dashboard SQL Editor.",
      "Or click Store it locally for the old sqlite users/passwords/AI keys method."
    ],
    "ask": "How do I connect my own Supabase for users?",
    "keywords": ["supabase", "install", "self host", "sqlite", "setup.html", "database.html", "USERS_BACKEND", "service role"],
    "where": "/database.html"
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
