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
    visual: "/docs/media/picks.gif?v=20260715-real",
    href: "/getting-started.html#picks",
  },
  {
    id: "docs-sticky-topic-nav",
    date: "2026-07-15",
    kind: "feature",
    title: "Sticky docs topic legend",
    summary:
      "The left topic legend on Getting Started and Full Documentation stays with you while scrolling so you can jump between sections anytime.",
    visual: "/docs/media/render-agent.gif?v=20260715-real",
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
    visual: "/docs/media/picks.gif?v=20260715-real",
    href: "/getting-started.html#link-to-prompt",
  },
  {
    id: "solid-tools",
    date: "2026-07-15",
    kind: "tool",
    title: "Solid modeling tools",
    summary:
      "Ribbon Create/Modify/Pattern plus direct tools: Press-Pull, fillet, transform, color, measure.",
    visual: "/docs/media/picks.gif?v=20260715-real",
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
    visual: "/docs/media/ai-generate.gif?v=20260715-real",
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
    id: "tips-tricks",
    date: "2026-07-15",
    kind: "feature",
    title: "Tips and tricks",
    summary:
      "Shift-select files, drag refs into the prompt, keep prompts focused, share context.",
    visual: "/docs/media/ai-generate.gif?v=20260715-real",
    href: "/getting-started.html#tips-tricks",
  },
  {
    id: "send-to-bambu-studio",
    date: "2026-07-15",
    kind: "feature",
    title: "Send to Bambu Studio",
    summary:
      "Export now includes Send to Bambu Studio: prepares a plate-ready 3MF and opens it in your local Bambu Studio so the part lands on the build plate. Alternate open link and 3MF download are available if the app does not launch.",
    visual: "/docs/media/picks.gif?v=20260715-real",
    href: "/",
  },
  {
    id: "viewport-transparent-tool",
    date: "2026-07-15",
    kind: "tool",
    title: "Transparent viewport tool",
    summary:
      "Click Transparent next to Grid/Color, then click any object to see through it. Crease edges stay crisp in Studio and share preview so internals remain readable.",
    visual: "/docs/media/picks.gif?v=20260715-real",
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
    visual: "/docs/media/reference-markup.gif?v=20260715-real",
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
    visual: "/docs/media/picks.gif?v=20260715-real",
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
