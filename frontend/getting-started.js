/** Getting Started feature guides for Docs. */

const FEATURES = [
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
  },
  {
    id: "render-agent",
    title: "Render Agent help chat",
    demo: "agent",
    gif: "/docs/media/render-agent.gif",
    summary: "The ribbon Agent button opens a chat for tooling, workflows, and project questions — separate from CAD Generate.",
    steps: [
      "Click Agent in the ribbon (or use Ask Render Agent from this page).",
      "Ask about tools, folders, Fusion, wiring, prompts, etc.",
      "Attach screenshots or files when helpful.",
      "Invite teammates into a thread for shared troubleshooting.",
    ],
    ask: "What can Render Agent help with, and how is it different from the CAD Generate prompt?",
  },
];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function askHref(question) {
  return `/?askAgent=${encodeURIComponent(question)}`;
}

function demoHtml(feature) {
  const kind = feature.demo || "generate";
  return `
    <div class="gs-demo" data-demo="${esc(kind)}" aria-hidden="true">
      <img class="gs-demo-gif" src="${esc(feature.gif)}" alt="" loading="lazy" />
      <div class="gs-demo-stage gs-demo-stage--${esc(kind)}">
        <div class="gs-demo-chrome">
          <span></span><span></span><span></span>
          <em>${esc(feature.title)}</em>
        </div>
        <div class="gs-demo-body">
          <div class="gs-demo-cursor"></div>
          <div class="gs-demo-panel"></div>
          <div class="gs-demo-viewport"></div>
          <div class="gs-demo-caption"></div>
        </div>
      </div>
    </div>
  `;
}

function featureCard(feature) {
  return `
    <section class="gs-feature info-section" id="${esc(feature.id)}">
      <div class="gs-feature-grid">
        <div class="gs-feature-media">
          ${demoHtml(feature)}
          <p class="muted small gs-demo-label">Quick demo (loops)</p>
        </div>
        <div class="gs-feature-copy">
          <h3>${esc(feature.title)}</h3>
          <p class="gs-summary">${esc(feature.summary)}</p>
          <h4 class="gs-detail-title">Step by step</h4>
          <ol class="gs-steps">
            ${(feature.steps || []).map((step) => `<li>${esc(step)}</li>`).join("")}
          </ol>
          <a class="btn accent gs-ask-btn" href="${askHref(feature.ask)}">
            Ask Render Agent about this
          </a>
        </div>
      </div>
    </section>
  `;
}

function mount() {
  const host = document.getElementById("gs-features");
  if (!host) return;
  host.innerHTML = FEATURES.map(featureCard).join("");
  host.querySelectorAll(".gs-demo-gif").forEach((img) => {
    img.addEventListener("error", () => {
      img.remove();
    });
    img.addEventListener("load", () => {
      img.closest(".gs-demo")?.classList.add("has-gif");
    });
  });
}

mount();
