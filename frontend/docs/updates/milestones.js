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
