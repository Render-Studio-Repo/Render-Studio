/** Milestone product updates for the Docs → Recent Updates page.
 *
 * INCLUDE: new tools, new workflows, behavior changes that change how users work.
 * SKIP: pure visual polish, refactors, copy tweaks, internal/admin-only changes.
 *
 * Newest first. Agents append here when shipping a qualifying update
 * (see .cursor/rules/milestone-updates.mdc).
 */

export const MILESTONE_UPDATES = [
  {
    id: "source-parts",
    date: "2026-07-16",
    kind: "feature",
    title: "Source parts with \\u24d8 and drag into Wiring AI",
    summary:
      "Click \\u24d8 on a component to identify and source it online, then drag the sourced part into the Wiring Simulator AI prompt for pin-aware circuits.",
    visual: "/docs/media/source-parts.gif?v=20260716-source",
    href: "/getting-started.html#source-parts",
  },
  {
    id: "timeline-render-history-costs",
    date: "2026-07-15",
    kind: "feature",
    title: "Render history in timeline",
    summary:
      "The project timeline now colors 2.0 prompts yellow, renders purple, and shows prompt text plus tracked render cost metadata directly in history.",
    visual: "/docs/media/timeline-render-history.png?v=20260715-card",
    href: "/",
  },
  {
    id: "management-feedback-dms",
    date: "2026-07-15",
    kind: "feature",
    title: "Management feedback DMs",
    summary:
      "Admins can now ask follow-up questions from suggestion and bug reports, sending realtime chat notifications to users without refreshing the dashboard.",
    visual: "/docs/media/management-feedback-dms.png?v=20260715-card",
    href: "/admin-dashboard.html",
  },
  {
    id: "shared-workspaces-folder",
    date: "2026-07-15",
    kind: "feature",
    title: "Shared workspaces folder",
    summary:
      "Shared workspaces now live under a dedicated Shared workspaces group with a compact folder menu for choosing which ones appear in the project browser.",
    visual: "/docs/media/workspaces.gif?v=20260715-real",
    href: "/",
  },
  {
    id: "discord-authorized-app-linking",
    date: "2026-07-15",
    kind: "feature",
    title: "Discord authorized app linking",
    summary:
      "Users can now link Discord from Preferences so Render bot alerts can DM them when teammates tag them in project chat.",
    href: "/",
  },
  {
    id: "ai-setup-intro",
    date: "2026-07-15",
    kind: "feature",
    title: "AI setup intro",
    summary:
      "Signed-in users without AI access now get a Render3D intro-style setup window with clear next steps to connect an API key, load shared credits, or start a tutorial.",
    visual: "/docs/media/ai-generate.gif?v=20260715-real",
    href: "/",
  },
  {
    id: "discord-public-model-announcements",
    date: "2026-07-15",
    kind: "feature",
    title: "Discord public model announcements",
    summary:
      "When a project is pushed to Public, Render3D can now post a Discord bot announcement with the project title, creator, description, thumbnail, and public view link.",
    href: "/",
  },
  {
    id: "google-new-user-robot-walkthrough",
    date: "2026-07-15",
    kind: "feature",
    title: "Google new-user robot walkthrough",
    summary:
      "New Google sign-ins now pull the Google profile name and photo, then launch a Robot Arm walkthrough that introduces Generate, selection, references, Knowledge Base, Agent, and screenshots.",
    visual: "/docs/media/select-object.gif?v=20260715-robot-arm",
    href: "/",
  },
  {
    id: "skills-square-media-cards",
    date: "2026-07-15",
    kind: "feature",
    title: "Skills media cards",
    summary:
      "Skills Library cards are now a tighter square grid with animated previews, richer More Info explanations, and local GIF or short clip previews per skill.",
    href: "/skills.html",
  },
  {
    id: "rigging-animation-banner",
    date: "2026-07-15",
    kind: "feature",
    title: "Rigging animation banner",
    summary:
      "Rigging animation controls now appear as a collapsible top-center banner only when a playable animation or motion source is available.",
    href: "/",
  },
  {
    id: "saved-screenshot-options",
    date: "2026-07-15",
    kind: "feature",
    title: "Saved screenshot options",
    summary:
      "The viewport Screenshot button can now ask for a capture mode, save a full-window or crop preference, and reuse that setting on the next click.",
    href: "/",
  },
  {
    id: "rendered-texture-apply",
    date: "2026-07-15",
    kind: "feature",
    title: "Rendered texture apply prompt",
    summary:
      "Photoreal Render now asks the image model for realistic material and recolor cues, then offers to attach the render as a reference for recoloring the original CAD model.",
    visual: "/docs/media/ai-generate.gif?v=20260715-real",
    href: "/",
  },
  {
    id: "first-project-prompt-onboarding",
    date: "2026-07-15",
    kind: "feature",
    title: "First-project AI prompt walkthrough",
    summary:
      "New users now get a guided prompt tour covering Improve Prompt, Speed vs Quality, project references, object selection, mic dictation, Draw, 2.0, Codex, and Knowledge Base.",
    visual: "/docs/media/ai-generate.gif?v=20260715-real",
    href: "/?showMe=prompt-onboarding",
    keywords: ["onboarding", "prompt", "improve", "speed", "quality", "codex", "knowledge base", "first project"],
  },
  {
    id: "personal-shared-workspace-destinations",
    date: "2026-07-15",
    kind: "feature",
    title: "Personal and shared project destinations",
    summary:
      "Project Explorer now labels your personal files by name, highlights shared workspaces with member counts, and can ask where to create new projects when you are working in a shared workspace.",
    visual: "/docs/media/workspaces.gif?v=20260715-real",
    href: "/",
  },
  {
    id: "visual-skills-library",
    date: "2026-07-15",
    kind: "feature",
    title: "Visual Skills Library",
    summary:
      "Skills Library now has a visual browser with grid, list, and compact views, sortable cards, searchable previews, expanded skill details, and store links.",
    href: "/skills.html",
  },
  {
    id: "render-agent-do-it-for-me",
    date: "2026-07-15",
    kind: "feature",
    title: "Render Agent Do it for me",
    summary:
      "Render Agent now has a guided Do it for me flow that collects the desired task, project, and optional object, then explains each setup step with sticky notes before sending the request.",
    visual: "/docs/media/render-agent.gif?v=20260715-real",
    href: "/getting-started.html#render-agent",
  },
  {
    id: "loading-tips-walkthrough",
    date: "2026-07-15",
    kind: "feature",
    title: "Loading tips and walkthrough",
    summary:
      "Studio loading now shares practical tips and can queue an animated walkthrough that starts automatically once the editor is ready.",
    visual: "/docs/media/ai-generate.gif?v=20260715-real",
    href: "/getting-started.html",
  },
  {
    id: "select-object",
    date: "2026-07-15",
    kind: "feature",
    title: "Select object & body",
    summary:
      "Click once to select the whole robot arm; double-click a link to select only that body/part.",
    visual: "/docs/media/select-object.gif?v=20260715-robot-arm",
    href: "/getting-started.html#select-object",
  },
  {
    id: "realtime-editor-popup",
    date: "2026-07-15",
    kind: "feature",
    title: "Realtime editor viewport popup",
    summary:
      "Open a large realtime editor viewport from the workspace strip; after import/open it collapses to a compact left chip for the active object.",
    visual: "/docs/media/workspaces.gif?v=20260715-real",
    href: "/",
  },
  {
    id: "mode-2-selected-face-edit",
    date: "2026-07-15",
    kind: "feature",
    title: "Mode 2.0 selected-face length edit",
    summary:
      "Face and component refs keep edit mode on the viewport object so lengthen/extend revises the selected part instead of regenerating from an older baseline.",
    visual: "/docs/media/picks.gif?v=20260715-robot-arm",
    href: "/getting-started.html#picks",
  },
  {
    id: "docs-sticky-topic-nav",
    date: "2026-07-15",
    kind: "feature",
    title: "Sticky docs topic legend",
    summary:
      "The left topic legend on Getting Started and Full Documentation stays with you while scrolling so you can jump between sections anytime.",
    href: "/docs.html#complete-docs",
  },
  {
    id: "multi-gen",
    date: "2026-07-15",
    kind: "feature",
    title: "Parallel generations",
    summary:
      "Run up to five CAD prompts at once; stop one or all from the viewport banner.",
    visual: "/docs/media/ai-generate.gif?v=20260715-real",
    href: "/getting-started.html#multi-gen",
  },
  {
    id: "link-to-prompt",
    date: "2026-07-15",
    kind: "feature",
    title: "Link project items to the prompt",
    summary:
      "Shift-select files in the Project browser and drag them into the AI prompt as @component references.",
    visual: "/docs/media/picks.gif?v=20260715-robot-arm",
    href: "/getting-started.html#link-to-prompt",
  },
  {
    id: "solid-tools",
    date: "2026-07-15",
    kind: "tool",
    title: "Solid modeling tools",
    summary:
      "Ribbon Create/Modify/Pattern plus direct tools: Press-Pull, fillet, transform, color, measure.",
    visual: "/docs/media/select-object.gif?v=20260715-robot-arm",
    href: "/getting-started.html#solid-tools",
  },
  {
    id: "sketch",
    date: "2026-07-15",
    kind: "feature",
    title: "Constrained Sketch",
    summary:
      "2D sketch on a plane with constraints, then extrude to solid.",
    visual: "/docs/media/canvas.gif?v=20260715-real",
    href: "/getting-started.html#sketch",
  },
  {
    id: "rigging-urdf",
    date: "2026-07-15",
    kind: "feature",
    title: "URDF / SRDF & Motion",
    summary:
      "GLB shows shape; URDF/SRDF drive simulation. Author Jake gen_urdf()/gen_srdf(), then open Motion.",
    href: "/getting-started.html#rigging-urdf",
  },
  {
    id: "cloud-sync",
    date: "2026-07-15",
    kind: "feature",
    title: "Fusion 360 & Onshape sync",
    summary:
      "Connect cloud libraries to import and push without leaving Studio.",
    visual: "/docs/media/cloud-sync.gif?v=20260715-real",
    href: "/getting-started.html#cloud-sync",
  },
  {
    id: "send-to-bambu-studio",
    date: "2026-07-15",
    kind: "feature",
    title: "Send to Bambu Studio",
    summary:
      "Export now includes Send to Bambu Studio: prepares a plate-ready 3MF and opens it in your local Bambu Studio so the part lands on the build plate. Alternate open link and 3MF download are available if the app does not launch.",
    href: "/",
  },
  {
    id: "viewport-transparent-tool",
    date: "2026-07-15",
    kind: "tool",
    title: "Transparent viewport tool",
    summary:
      "Click Transparent next to Grid/Color, then click any object to see through it. Crease edges stay crisp in Studio and share preview so internals remain readable.",
    href: "/",
  },
  {
    id: "getting-started-demos-agent",
    date: "2026-07-15",
    kind: "feature",
    title: "Getting Started demos + Ask Agent",
    summary:
      "Docs now include looping Studio demos for major workflows. Ask Render Agent from Getting Started opens a movable help panel and attaches matching demo GIFs in replies.",
    visual: "/docs/media/render-agent.gif?v=20260715-real",
    href: "/getting-started.html",
  },
  {
    id: "reference-markup-send-ai",
    date: "2026-07-15",
    kind: "feature",
    title: "Reference markup & Send to AI",
    summary:
      "Open PDFs and images in a Docs-style tab, draw pen callouts, add notes, then Send to AI so the marked image and notes land in the CAD prompt.",
    visual: "/docs/media/reference-markup.gif?v=20260716-pdf-tab",
    href: "/getting-started.html#reference-markup",
  },
  {
    id: "live-folder-project-sync",
    date: "2026-07-15",
    kind: "feature",
    title: "Live folder & project sync",
    summary:
      "Share, unshare, and rename updates push in realtime. Teammates see explorer changes without refresh — even while a generate is running.",
    visual: "/docs/media/workspaces.gif?v=20260715-real",
    href: "/getting-started.html#workspaces",
  },
  {
    id: "share-private-folder",
    date: "2026-07-15",
    kind: "feature",
    title: "Share a private folder",
    summary:
      "Right-click a folder → Share, pick a teammate from the dropdown (no retyping their email), and keep the folder private to people you invite.",
    visual: "/docs/media/share-folder.gif?v=20260715-real",
    href: "/getting-started.html#share-folders",
  },
  {
    id: "wiring-simulator",
    date: "2026-07-10",
    kind: "tool",
    title: "Wiring Simulator",
    summary:
      "Switch workspace mode to Wiring Simulator to breadboard circuits, generate with Wiring AI, validate drivers, and run schematic loops.",
    visual: "/docs/media/wiring.gif?v=20260715-real",
    href: "/getting-started.html#wiring",
  },
  {
    id: "canvas-sketch-mode",
    date: "2026-07-08",
    kind: "tool",
    title: "Canvas sketch mode",
    summary:
      "Sketch freely on the CANVAS design tab, then attach the sketch into the AI compose panel for generation that follows your drawing.",
    visual: "/docs/media/canvas.gif?v=20260715-real",
    href: "/getting-started.html#canvas",
  },
  {
    id: "geometry-picks",
    date: "2026-07-01",
    kind: "feature",
    title: "Geometry picks in prompts",
    summary:
      "Pick faces, edges, and paths on the model so @face / @edge / @path chips appear in the prompt and edits land on the right feature.",
    visual: "/docs/media/picks.gif?v=20260715-robot-arm",
    href: "/getting-started.html#picks",
  },
  {
    id: "ai-cad-generate",
    date: "2026-06-20",
    kind: "feature",
    title: "AI CAD generate & revise",
    summary:
      "Describe a part in the prompt panel and Generate creates geometry. Follow up to revise instead of restarting from scratch.",
    visual: "/docs/media/ai-generate.gif?v=20260715-real",
    href: "/getting-started.html#ai-generate",
  },
];

export function listMilestones({ limit = 0 } = {}) {
  const rows = [...MILESTONE_UPDATES].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return limit > 0 ? rows.slice(0, limit) : rows;
}
