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
    id: "ai-film-edit-generate-and-encoder-fallback",
    date: "2026-10-06",
    kind: "feature",
    title: "AI Film Edit Generate and encoder fallback",
    summary:
      "Fixed Generate stopping after prompt improvement because it called nonexistent `extractSpotifyMusic` instead of the exported URL extractor.",
    href: "/updates.html",
  },
  {
    id: "saved-video-editor-project-and-share-to-x-flow",
    date: "2026-10-06",
    kind: "tool",
    title: "Saved Video Editor project and Share to X flow",
    summary:
      "Changed Share to X to open the caption sheet immediately. Any required timeline bake now begins only after Post to X, so users can review or change the saved caption first.",
    href: "/updates.html",
  },
  {
    id: "video-editor-autosave-restoration",
    date: "2026-10-06",
    kind: "tool",
    title: "Video Editor autosave restoration",
    summary:
      "Fixed project reopen so saved clip trim ranges, split segments, ordering, mute, volume, global transition, zoom, and playhead are hydrated onto the reloaded media.",
    href: "/updates.html",
  },
  {
    id: "ai-film-editing-undo-autosave-and-time-zero-loading",
    date: "2026-10-06",
    kind: "feature",
    title: "AI film editing, undo, autosave, and time-zero loading",
    summary:
      "Routed Generate prompt interpretation through `/api/video/edit-prompt` with the current AI Prompt key, provider, and model. The local parser remains the failure fallback.",
    href: "/updates.html",
  },
  {
    id: "wrist-camera-direct-activation",
    date: "2026-09-28",
    kind: "feature",
    title: "Wrist camera direct activation",
    summary:
      "Fixed the Robotics > Cameras > Wrist cams action so it restarts camera publishing through the authenticated Studio API before opening the floating Left and Right windows. Robot teleop remains disarmed and no Robot Activate click is required.",
  },
  {
    id: "debug-self-improve-skill-community-training-milestone",
    date: "2026-09-16",
    kind: "feature",
    title: "Debug self-improve skill + community training () @milestone",
    summary:
      "Debugger template `ai-context/skills/debug-self-improve/SKILL.md` (mirrored in `mcp/grok-bot/skills/`) teaches Grok to bind traceback_id + feature check, read the last Render frame, kill one of two hypotheses, actually fix the bug, then file a retro: prompts_used, hours_elapsed, ",
    href: "/updates.html",
  },
  {
    id: "42-feature-gifs-auto-updates-publish",
    date: "2026-09-16",
    kind: "feature",
    title: "42 feature GIFs + auto Updates publish",
    summary:
      "42 feature GIFs + auto Updates publish",
    href: "/updates.html",
  },
  {
    id: "github-oauth-supabase",
    date: "2026-09-16",
    kind: "feature",
    title: "GitHub OAuth through Supabase",
    summary:
      "Link GitHub still returns to /oauth/github/callback. OAuth App credentials live in the Supabase Auth GitHub provider; user PATs are encrypted on the Users row. Pasted keys in AI chat are routed the same way — never into git or the browser.",
    href: "/foundry.html",
    keywords: ["github", "oauth", "supabase", "pat", "secrets", "callback"],
  },
  {
    id: "viewport-split-layouts",
    date: "2026-09-16",
    kind: "feature",
    title: "Saved viewport split layouts",
    summary:
      "Save a named mosaic of Viewport / Wiring / Parts List, then share or import the layout like any other preview.",
    visual: "/docs/media/viewport-split-layouts.gif?v=20260916-gifs40",
    href: "/getting-started.html#viewport-split-layouts",
    keywords: ["split", "layouts", "mosaic", "viewport layout", "share layout"],
  },
  {
    id: "public-pin",
    date: "2026-09-15",
    kind: "feature",
    title: "Pin to public profile",
    summary:
      "Public projects can be pinned on your public profile so visitors see the featured models first.",
    visual: "/docs/media/public-pin.gif?v=20260916-gifs40",
    href: "/getting-started.html#public-pin",
    keywords: ["public pin", "pin to public", "profile pin"],
  },
  {
    id: "film-edit",
    date: "2026-09-14",
    kind: "tool",
    title: "AI film-edit on the clip timeline",
    summary:
      "Under the clip editor, prompt a cut, Improve prompt, then Generate a film edit without leaving Studio.",
    visual: "/docs/media/film-edit.gif?v=20260916-gifs40",
    href: "/getting-started.html#film-edit",
    keywords: ["film edit", "ai film", "clip generate", "video edit"],
  },
  {
    id: "native-joints",
    date: "2026-09-15",
    kind: "tool",
    title: "Native FreeCAD assembly joints",
    summary:
      "Author the 13 FreeCAD Assembly joint types, save Joints / FCStd, and export STEP + joints for Fusion.",
    visual: "/docs/media/native-joints.gif?v=20260916-gifs40",
    href: "/getting-started.html#native-joints",
    keywords: ["joints", "assembly", "revolute", "freecad joints"],
  },
  {
    id: "code-workspace",
    date: "2026-09-15",
    kind: "tool",
    title: "Code workspace",
    summary:
      "Nested explorer with syntax tabs, JSON/CSV/XLSX/PDF previews, and revision-checked saves that survive project switches.",
    visual: "/docs/media/code-workspace.gif?v=20260916-gifs40",
    href: "/getting-started.html#code-workspace",
    keywords: ["code", "firmware", "json tree", "csv", "xlsx"],
  },
  {
    id: "settings-search",
    date: "2026-09-08",
    kind: "feature",
    title: "Settings search",
    summary:
      "Type in Preferences or Management to jump to a setting instead of hunting sections.",
    visual: "/docs/media/settings-search.gif?v=20260916-gifs40",
    href: "/getting-started.html#settings-search",
    keywords: ["settings search", "preferences search", "jump to setting"],
  },
  {
    id: "mobile-studio",
    date: "2026-09-06",
    kind: "feature",
    title: "Mobile studio chrome",
    summary:
      "Phone layout: hamburger menu, profile top-right, tools FAB, locked viewport so orbit does not fight chrome.",
    visual: "/docs/media/mobile-studio.gif?v=20260916-gifs40",
    href: "/getting-started.html#mobile-studio",
    keywords: ["mobile", "phone", "hamburger", "fab"],
  },
  {
    id: "share-remix",
    date: "2026-09-09",
    kind: "feature",
    title: "Share link & remix",
    summary:
      "Copy a share link; signed-in visitors remix into a new project or an existing shared workspace.",
    visual: "/docs/media/share-remix.gif?v=20260916-gifs40",
    href: "/getting-started.html#share-remix",
    keywords: ["share link", "remix", "public"],
  },
  {
    id: "vr-menu",
    date: "2026-09-09",
    kind: "feature",
    title: "VR world menu & laser",
    summary:
      "Quest menu-aim uses the posed controller ray. Trigger clicks HUD; DimOS does not steal picks while the menu is hit.",
    visual: "/docs/media/vr-menu.gif?v=20260916-gifs40",
    href: "/getting-started.html#vr-menu",
    keywords: ["vr menu", "laser", "quest", "hold b"],
  },
  {
    id: "public-room",
    date: "2026-09-07",
    kind: "feature",
    title: "Public room — drop a project",
    summary:
      "In a public VR room, drop a project both people can pick up and inspect together.",
    visual: "/docs/media/public-room.gif?v=20260916-gifs40",
    href: "/getting-started.html#public-room",
    keywords: ["public room", "drop project", "vr collab"],
  },
  {
    id: "document-tabs",
    date: "2026-09-09",
    kind: "feature",
    title: "Viewport document tab strip",
    summary:
      "Image, PDF, McMaster, and DXF open as parked tabs. 3D stays in the DOM — no close-to-return.",
    visual: "/docs/media/document-tabs.gif?v=20260916-gifs40",
    href: "/getting-started.html#document-tabs",
    keywords: ["document tabs", "pdf tab", "viewport chip"],
  },
  {
    id: "remix-workspace",
    date: "2026-09-09",
    kind: "feature",
    title: "Remix into a shared workspace",
    summary:
      "Remix can add to an existing shared workspace or create a new one — not create-only.",
    visual: "/docs/media/remix-workspace.gif?v=20260916-gifs40",
    href: "/getting-started.html#remix-workspace",
    keywords: ["remix workspace", "shared workspace", "add to workspace"],
  },
  {
    id: "workspace-invite",
    date: "2026-09-08",
    kind: "feature",
    title: "Workspace invite by email",
    summary:
      "Invite teammates from the workspace popup with typeahead profiles — no retyping the full address.",
    visual: "/docs/media/workspace-invite.gif?v=20260916-gifs40",
    href: "/getting-started.html#workspace-invite",
    keywords: ["invite", "email", "typeahead", "members"],
  },
  {
    id: "context-lab",
    date: "2026-09-07",
    kind: "tool",
    title: "Context Lab — machines & customers",
    summary:
      "Context Lab stores machines and customers so Improve and Generate can reuse shop context.",
    visual: "/docs/media/context-lab.gif?v=20260916-gifs40",
    href: "/getting-started.html#context-lab",
    keywords: ["context lab", "machines", "customers"],
  },
  {
    id: "improve-lab",
    date: "2026-09-07",
    kind: "feature",
    title: "Improve Lab",
    summary:
      "Improve Lab keeps facing-locked Render wraps and CAD Improve experiments next to the project.",
    visual: "/docs/media/improve-lab.gif?v=20260916-gifs40",
    href: "/getting-started.html#improve-lab",
    keywords: ["improve lab", "render improve", "wrap"],
  },
  {
    id: "calendar-meetings",
    date: "2026-09-07",
    kind: "feature",
    title: "Calendars and meeting requests",
    summary:
      "Profile calendars plus meeting requests so a teammate can book time without leaving Studio.",
    visual: "/docs/media/calendar-meetings.gif?v=20260916-gifs40",
    href: "/getting-started.html#calendar-meetings",
    keywords: ["calendar", "meeting", "book time"],
  },
  {
    id: "receive-money",
    date: "2026-09-08",
    kind: "feature",
    title: "Receive money — Stripe, PayPal, X, wallets",
    summary:
      "Creators connect Stripe / PayPal / X / wallets from account so Marketplace payouts have a destination.",
    visual: "/docs/media/receive-money.gif?v=20260916-gifs40",
    href: "/getting-started.html#receive-money",
    keywords: ["stripe", "paypal", "payout", "wallet"],
  },
  {
    id: "suggestions",
    date: "2026-09-08",
    kind: "feature",
    title: "Suggestions overlay",
    summary:
      "After boot, send a suggestion with attachments. Sent closes the overlay; email + inbox notify ops.",
    visual: "/docs/media/suggestions.gif?v=20260916-gifs40",
    href: "/getting-started.html#suggestions",
    keywords: ["suggestion", "feedback", "attach"],
  },
  {
    id: "exploded-view",
    date: "2026-09-06",
    kind: "feature",
    title: "Exploded view",
    summary:
      "Explode an assembly to inspect mates. Turning it off reloads the assembled parent — rotate does not collapse it.",
    visual: "/docs/media/exploded-view.gif?v=20260916-gifs40",
    href: "/getting-started.html#exploded-view",
    keywords: ["exploded", "explode", "assembly"],
  },
  {
    id: "kernel-measure",
    date: "2026-09-08",
    kind: "feature",
    title: "Kernel measure",
    summary:
      "Measure prefers FreeCAD/OCC vertex/edge/face distance from the STEP, with mesh centroid as fallback.",
    visual: "/docs/media/kernel-measure.gif?v=20260916-gifs40",
    href: "/getting-started.html#kernel-measure",
    keywords: ["measure", "kernel", "distance", "step"],
  },
  {
    id: "vr-spatial-draw",
    date: "2026-09-16",
    kind: "feature",
    title: "Spatial AI Draw with live voice",
    summary:
      "In VR Draw, lasso a surface, talk with live voice, Smart Description, then Generate only when you press it.",
    visual: "/docs/media/vr-spatial-draw.gif?v=20260916-gifs40",
    href: "/getting-started.html#vr-spatial-draw",
    keywords: ["spatial draw", "lasso", "live voice", "vr draw"],
  },
  {
    id: "dxf-convert",
    date: "2026-09-09",
    kind: "feature",
    title: "DXF convert preferences",
    summary:
      "Choose ask / auto / always DXF / always image so line drawings become CAD instead of a photo.",
    visual: "/docs/media/dxf-convert.gif?v=20260916-gifs40",
    href: "/getting-started.html#dxf-convert",
    keywords: ["dxf", "convert", "line drawing"],
  },
  {
    id: "send-to-wiring",
    date: "2026-09-16",
    kind: "feature",
    title: "Send catalog parts to wiring",
    summary:
      "From Parts Catalog, Send to wiring so the sourced part and pins land in the Wiring prompt — no re-search.",
    visual: "/docs/media/send-to-wiring.gif?v=20260916-gifs40",
    href: "/getting-started.html#send-to-wiring",
    keywords: ["send to wiring", "catalog", "pins"],
  },
  {
    id: "wiring-3d-ar",
    date: "2026-09-15",
    kind: "feature",
    title: "Wiring 3D / AR",
    summary:
      "Bottom-left AR/3D controls, isolated wiring rendering, and contact-only 1:1 AR placement.",
    visual: "/docs/media/wiring-3d-ar.gif?v=20260916-gifs40",
    href: "/getting-started.html#wiring-3d-ar",
    keywords: ["wiring ar", "3d wiring", "1:1"],
  },
  {
    id: "vr-voice-companion",
    date: "2026-09-15",
    kind: "feature",
    title: "Reviewed VR voice companion",
    summary:
      "Right-wrist agent with audio-reactive avatar. Spoken edits require review; throw dismisses the panel.",
    visual: "/docs/media/vr-voice-companion.gif?v=20260916-gifs40",
    href: "/getting-started.html#vr-voice-companion",
    keywords: ["voice companion", "wrist agent", "review"],
  },
  {
    id: "plus-new-project",
    date: "2026-09-07",
    kind: "feature",
    title: "Plus starts a new project immediately",
    summary:
      "The + next to Projects creates a project right away — blank viewport, no extra wizard.",
    visual: "/docs/media/plus-new-project.gif?v=20260916-gifs40",
    href: "/getting-started.html#plus-new-project",
    keywords: ["plus", "new project"],
  },
  {
    id: "public-projects-live",
    date: "2026-09-07",
    kind: "feature",
    title: "Public projects appear live",
    summary:
      "Pushing a project to Public shows it for other people without a refresh, including Discord announcements when enabled.",
    visual: "/docs/media/public-projects-live.gif?v=20260916-gifs40",
    href: "/getting-started.html#public-projects-live",
    keywords: ["public", "live", "discord"],
  },
  {
    id: "chatgpt-team-share",
    date: "2026-09-07",
    kind: "feature",
    title: "Share ChatGPT CAD with a team",
    summary:
      "ChatGPT / Codex sessions live on workspaces. Manage AI keys and subscriptions; trial is 3 ChatGPT renders.",
    visual: "/docs/media/chatgpt-team-share.gif?v=20260916-gifs40",
    href: "/getting-started.html#chatgpt-team-share",
    keywords: ["chatgpt", "codex", "team key", "trial"],
  },
  {
    id: "capture-fullscreen",
    date: "2026-09-07",
    kind: "feature",
    title: "Fullscreen capture + mini browser",
    summary:
      "Screenshots and recordings open fullscreen with a mini browser for images and PDFs.",
    visual: "/docs/media/capture-fullscreen.gif?v=20260916-gifs40",
    href: "/getting-started.html#capture-fullscreen",
    keywords: ["fullscreen", "screenshot", "mini browser"],
  },
  {
    id: "texture-to-model",
    date: "2026-09-07",
    kind: "feature",
    title: "Texture wrap on the model",
    summary:
      "Texture to model wraps the image on the object. Timeline undo; files mini-browser. Render Improve is object-only.",
    visual: "/docs/media/texture-to-model.gif?v=20260916-gifs40",
    href: "/getting-started.html#texture-to-model",
    keywords: ["texture", "wrap", "render improve"],
  },
  {
    id: "share-to-x",
    date: "2026-09-07",
    kind: "feature",
    title: "Share captures to X",
    summary:
      "Mobile and VR POV Screenshot / Record, then markup and Share to X without leaving the capture flow.",
    visual: "/docs/media/share-to-x.gif?v=20260916-gifs40",
    href: "/getting-started.html#share-to-x",
    keywords: ["share to x", "twitter", "pov"],
  },
  {
    id: "recording-hud",
    date: "2026-09-07",
    kind: "feature",
    title: "Recording HUD",
    summary:
      "Recording HUD docks, drags, and can hide from the clip so the overlay is not burned into the video.",
    visual: "/docs/media/recording-hud.gif?v=20260916-gifs40",
    href: "/getting-started.html#recording-hud",
    keywords: ["recording hud", "hide from clip"],
  },
  {
    id: "edit-selected",
    date: "2026-09-15",
    kind: "feature",
    title: "Edit Selected — scale and attachment",
    summary:
      "Edits keep source-to-assembly placement and scale. Failed results do not clobber the live body.",
    visual: "/docs/media/edit-selected.gif?v=20260916-gifs40",
    href: "/getting-started.html#edit-selected",
    keywords: ["edit selected", "attachment", "scale"],
  },
  {
    id: "agent-tabs",
    date: "2026-09-08",
    kind: "feature",
    title: "Agent panel — four tabs on one row",
    summary:
      "Render Agent uses four tabs on a single row so help, skills, history, and settings stay in reach.",
    visual: "/docs/media/agent-tabs.gif?v=20260916-gifs40",
    href: "/getting-started.html#agent-tabs",
    keywords: ["agent tabs", "skills", "help"],
  },
  {
    id: "marketplace-layouts",
    date: "2026-09-16",
    kind: "feature",
    title: "Marketplace viewport layouts",
    summary:
      "Browse free Viewport layouts, Install into the general layout store, then apply on any project.",
    visual: "/docs/media/marketplace-layouts.gif?v=20260916-gifs40",
    href: "/getting-started.html#marketplace-layouts",
    keywords: ["marketplace", "viewport layouts", "install"],
  },
  {
    id: "solidworks-import",
    date: "2026-09-07",
    kind: "feature",
    title: "SolidWorks library import / export",
    summary:
      "Import and export SolidWorks library parts alongside Fusion / Onshape cloud libraries.",
    visual: "/docs/media/solidworks-import.gif?v=20260916-gifs40",
    href: "/getting-started.html#solidworks-import",
    keywords: ["solidworks", "sldprt", "library"],
  },
  {
    id: "fritzing-skins",
    date: "2026-09-06",
    kind: "feature",
    title: "Fritzing pictorial skins",
    summary:
      "Every wiring part can show a Fritzing pictorial skin so the breadboard matches the real component.",
    visual: "/docs/media/fritzing-skins.gif?v=20260916-gifs40",
    href: "/getting-started.html#fritzing-skins",
    keywords: ["fritzing", "pictorial", "skin"],
  },
  {
    id: "cad-mode-chips",
    date: "2026-09-15",
    kind: "feature",
    title: "Even CAD mode chips",
    summary:
      "Compose toolbar chips (Render / CAD / Mesh / Parts / Speed-Quality / Improve) share equal width on one row.",
    visual: "/docs/media/cad-mode-chips.gif?v=20260916-gifs40",
    href: "/getting-started.html#cad-mode-chips",
    keywords: ["mode chips", "compose toolbar", "speed quality"],
  },
  {
    id: "viewport-finder",
    date: "2026-09-16",
    kind: "feature",
    title: "Cmd/Ctrl+F finder",
    summary:
      "Spotlight search across your projects, prompts, and timeline. Cmd+F on Mac, Ctrl+F on Windows — does not steal find-in-page from the prompt.",
    visual: "/docs/media/viewport-finder.gif?v=20260916-newfeats1",
    href: "/getting-started.html#viewport-finder",
    keywords: ["finder", "cmd+f", "ctrl+f", "search", "spotlight"],
  },
  {
    id: "pin-projects",
    date: "2026-09-16",
    kind: "feature",
    title: "Pin projects in the project menu",
    summary:
      "Star up to five personal projects so they stay at the top of the Projects list. Finder can pin too.",
    visual: "/docs/media/pin-projects.gif?v=20260916-newfeats1",
    href: "/getting-started.html#pin-projects",
    keywords: ["pin", "star", "pinned", "projects"],
  },
  {
    id: "robotics-wrist-cameras",
    date: "2026-09-15",
    kind: "feature",
    title: "Connecting wrist cameras",
    summary:
      "Plug Arducam-style wrist USB cameras into the Mac running Studio. Wrist Cam auto-publishes JPEGs on :8001 — no curl on the happy path.",
    visual: "/docs/media/wrist-cameras.gif?v=20260916-docgif1",
    href: "/getting-started.html#robotics-wrist-cameras",
    keywords: ["wrist", "camera", "arducam", "usb", "8001"],
  },
  {
    id: "robotics-configuration",
    date: "2026-09-14",
    kind: "feature",
    title: "Robotics Configuration",
    summary:
      "Connect Viser (HTTP LAN) and OpenArm Quest Teleop (HTTPS) through Studio proxies so a laptop on https://render3d.app never hits mixed content or a self-signed Pi cert.",
    visual: "/docs/media/robotics-configuration.gif?v=20260914-lanip1",
    href: "/getting-started.html#robotics-configuration-20260915-xrdispatch4",
  },
  {
    id: "robotics-teleop-proxy",
    date: "2026-09-14",
    kind: "feature",
    title: "Teleop HTTPS proxy",
    summary:
      "DIMOS /teleop is HTTPS. Studio proxies it so Quest never sees the self-signed Pi cert.",
    visual: "/docs/media/robotics-teleop.gif?v=20260914-lanip1",
    href: "/getting-started.html#robotics-teleop-proxy-20260915-xrdispatch4",
  },
  {
    id: "self-host",
    date: "2026-09-14",
    kind: "feature",
    title: "Connect your database (self-host)",
    summary:
      "Point this clone at YOUR Supabase, or keep sqlite local users.",
    visual: "/docs/media/database-setup.gif?v=20260916-docgif1",
    href: "/getting-started.html#self-host",
  },
  {
    id: "clip-video-editor",
    date: "2026-09-14",
    kind: "tool",
    title: "Clip / video editor tab",
    summary:
      "Viewport recordings open a built-in clip editor — timeline, trim, grades, stills, and drag-and-drop media — without leaving Studio.",
    visual: "/docs/media/clip-video-editor.gif?v=20260916-newfeats1",
    href: "/getting-started.html#clip-video-editor",
    keywords: ["clip", "video", "editor", "timeline", "record"],
  },
  {
    id: "viser-lan-cloud",
    date: "2026-09-14",
    kind: "feature",
    title: "Viser LAN proxy and robotics Cloud settings",
    summary:
      "Viser on a robot PC is reachable through Studio's same-origin LAN proxy. Robotics Cloud settings save the Viser URL so HTTPS render3d.app can embed it.",
    href: "/",
    keywords: ["viser", "lan", "robotics", "cloud", "proxy"],
  },
  {
    id: "reference-folders-captures",
    date: "2026-09-14",
    kind: "feature",
    title: "Reference files folders and captures",
    summary:
      "Reference Files and Renders nest into folders (McMaster, Screenshots, Screen Recordings, AR captures, Improve Lab) so captures stay organized.",
    visual: "/docs/media/reference-folders.gif?v=20260916-newfeats1",
    href: "/getting-started.html#reference-folders",
    keywords: ["reference", "folder", "capture", "screenshot", "recording"],
  },
  {
    id: "imagine-panel",
    date: "2026-09-09",
    kind: "tool",
    title: "Imagine panel — image gen, grid/list, and /fetch",
    summary:
      "Imagine is its own tab next to Compose and History, separate from Agent and Improve. Generate product images, switch grid or list, and /fetch public CAD into the project.",
    visual: "/docs/media/imagine-panel.gif?v=20260916-newfeats1",
    href: "/getting-started.html#imagine-panel",
    keywords: ["imagine", "image", "fetch", "grid", "list", "panel"],
  },
  {
    id: "vr-robot-dimos-gated",
    date: "2026-09-09",
    kind: "feature",
    title: "VR Robot / DIMOS stays gated until Enable",
    summary:
      "Quest robotics and DIMOS teleop stay off until you Enable Robotics or Activate. Cloud never exposes :8443; the LAN proxy stays on this Mac.",
    visual: "/docs/media/dimos-enable.gif?v=20260916-docgif1",
    href: "/getting-started.html#dimos-enable",
    keywords: ["vr", "robot", "dimos", "teleop", "gated", "quest"],
  },
  {
    id: "admin-control-center",
    date: "2026-09-09",
    kind: "feature",
    title: "Control Center on the admin dashboard",
    summary:
      "Management now has a Control Center overlay for live health, prompt volume, DIMOS coordinator, and ops toggles — without replacing the existing dashboard.",
    href: "/admin-dashboard.html",
    keywords: ["admin", "control center", "dashboard", "dimos"],
  },
  {
    id: "prompt-persist-faster-boot",
    date: "2026-09-09",
    kind: "feature",
    title: "Prompt drafts persist and Studio boots faster",
    summary:
      "Compose drafts stay with the project when you switch files, and desktop boot no longer holds a minimum splash delay.",
    visual: "/docs/media/prompt-persist.gif?v=20260916-newfeats1",
    href: "/getting-started.html#prompt-persist",
    keywords: ["prompt", "persist", "draft", "boot"],
  },
  {
    id: "freecad-kernel-edit",
    date: "2026-09-08",
    kind: "feature",
    title: "FreeCAD is the source of truth for move, delete, and extrude",
    summary:
      "Move, delete, and Extrude/Pad/Pocket now persist on the FreeCAD/OCC STEP document instead of a mesh-only preview, so parts stay put after refresh.",
    visual: "/docs/media/freecad-kernel.gif?v=20260916-docgif1",
    href: "/getting-started.html#freecad-kernel",
    keywords: ["freecad", "extrude", "move", "delete", "kernel", "step"],
  },
  {
    id: "parts-catalog-mcmaster",
    date: "2026-09-08",
    kind: "tool",
    title: "Parts Catalog replaces Insert",
    summary:
      "The Insert design tab is gone. Parts Catalog is the home for McMaster-Carr, STEP library parts, and the STEP file manager.",
    visual: "/docs/media/parts-catalog.gif?v=20260916-newfeats1",
    href: "/getting-started.html#parts-catalog",
    keywords: ["catalog", "mcmaster", "insert", "parts", "step"],
  },
  {
    id: "gpt55-pro-default-speed",
    date: "2026-07-28",
    kind: "feature",
    title: "GPT-5.5 Pro defaults to Speed",
    summary:
      "Selecting GPT-5.5 Pro auto-sets Mode to Speed so expensive Quality pricing is not left on by accident; you can still switch to Quality manually.",
    href: "/",
  },
  {
    id: "mesh-improve-realistic",
    date: "2026-07-29",
    kind: "feature",
    title: "Mesh Improve for realistic materials",
    summary:
      "Mesh Improve follows img2threejs look-dev rules: independent PBR, finish recipes, wear and locality, and named mesh parts instead of flat toy colors.",
    href: "/",
  },
  {
    id: "faster-share-links",
    date: "2026-07-29",
    kind: "feature",
    title: "Faster Create share link",
    summary:
      "Creating a share link is much snappier — it bakes the viewer GLB only (companions stay on Export) and Copy share link stays pinned at the top of Export.",
    href: "/",
  },
  {
    id: "mobile-vr-capture-share-x",
    date: "2026-07-29",
    kind: "feature",
    title: "POV Screenshot & Record → Share to X",
    summary:
      "Mobile and VR expose POV Screenshot and Record controls, with markup and Share to X after capture so headset and phone clips are easy to post.",
    href: "/",
  },
  {
    id: "mesh-stop-draft-costs",
    date: "2026-07-29",
    kind: "feature",
    title: "Mesh Stop restores draft and costs",
    summary:
      "Stopping a Mesh generation restores your compose draft like Mode 2.0 and refreshes history so canceled runs still show usage and cost.",
    href: "/",
  },
  {
    id: "bambu-3mf-real-plates",
    date: "2026-07-29",
    kind: "feature",
    title: "Bambu 3MF: real parts on real plates",
    summary:
      "Send to Bambu Studio now packs printable plates correctly — unique mesh IDs per body, one assembled plate by default, Preparing assembly… while multi-body packs, and only unhidden parts export.",
    href: "/",
  },
  {
    id: "xr-ar-capture-inbox",
    date: "2026-07-30",
    kind: "feature",
    title: "XR captures land in AR references",
    summary:
      "Quest screenshots and videos save under Reference Files → AR, and the PC shows a capture-ready popup without needing a refresh.",
    href: "/",
  },
  {
    id: "reference-files-delete",
    date: "2026-07-30",
    kind: "feature",
    title: "Right-click delete for reference files",
    summary:
      "Reference Files and Renders now support right-click Delete (and Rename) in the project browser, including AR captures and open image viewers.",
    href: "/",
  },
  {
    id: "vr-recording-spectator-ui",
    date: "2026-07-30",
    kind: "feature",
    title: "VR recording matches the headset view",
    summary:
      "VR clips record a true head-centered spectator view with correct FOV, and include Explorer + AI windows so recordings look like what you see in the headset.",
    href: "/",
  },
  {
    id: "ai-vr-generating-icon",
    date: "2026-07-30",
    kind: "feature",
    title: "Green AI VR icon while generating",
    summary:
      "In headset, the left-hand dock AI VR control turns green and pulses while a generation is running, and the AI panel header shows AI VR · GENERATING…",
    href: "/",
  },
  {
    id: "urdf-real-cad-meshes",
    date: "2026-07-30",
    kind: "feature",
    title: "Rigging moves real CAD parts",
    summary:
      "URDF/SRDF motion now drives the real __part_*.glb meshes instead of white box placeholders, so jaws and links animate like Jake text-to-CAD.",
    href: "/getting-started.html#urdf-20260915-xrdispatch4",
  },
  {
    id: "source-parts",
    date: "2026-07-16",
    kind: "feature",
    title: "Source parts with ⓘ and drag into Wiring AI",
    summary:
      "Click ⓘ on a component to identify and source it online, then drag the sourced part into the Wiring Simulator AI prompt for pin-aware circuits.",
    visual: "/docs/media/source-parts.gif?v=20260716-source",
    href: "/getting-started.html#source-parts-20260915-xrdispatch4",
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
      "Signed-in users without AI access now get a Render Studio intro-style setup window with clear next steps to connect an API key, load shared credits, or start a tutorial.",
    visual: "/docs/media/ai-generate.gif?v=20260715-real",
    href: "/",
  },
  {
    id: "discord-public-model-announcements",
    date: "2026-07-15",
    kind: "feature",
    title: "Discord public model announcements",
    summary:
      "When a project is pushed to Public, Render Studio can now post a Discord bot announcement with the project title, creator, description, thumbnail, and public view link.",
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
    href: "/getting-started.html#render-agent-20260915-xrdispatch4",
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
    href: "/getting-started.html#select-object-20260915-xrdispatch4",
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
    href: "/getting-started.html#picks-20260915-xrdispatch4",
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
    href: "/getting-started.html#multi-gen-20260915-xrdispatch4",
  },
  {
    id: "link-to-prompt",
    date: "2026-07-15",
    kind: "feature",
    title: "Link project items to the prompt",
    summary:
      "Shift-select files in the Project browser and drag them into the AI prompt as @component references.",
    visual: "/docs/media/picks.gif?v=20260715-robot-arm",
    href: "/getting-started.html#link-to-prompt-20260915-xrdispatch4",
  },
  {
    id: "solid-tools",
    date: "2026-07-15",
    kind: "tool",
    title: "Solid modeling tools",
    summary:
      "Ribbon Create/Modify/Pattern plus direct tools: Press-Pull, fillet, transform, color, measure.",
    visual: "/docs/media/select-object.gif?v=20260715-robot-arm",
    href: "/getting-started.html#solid-tools-20260915-xrdispatch4",
  },
  {
    id: "sketch",
    date: "2026-07-15",
    kind: "feature",
    title: "Constrained Sketch",
    summary:
      "2D sketch on a plane with constraints, then extrude to solid.",
    visual: "/docs/media/canvas.gif?v=20260715-real",
    href: "/getting-started.html#sketch-20260915-xrdispatch4",
  },
  {
    id: "rigging-urdf",
    date: "2026-07-15",
    kind: "feature",
    title: "URDF / SRDF & Motion",
    summary:
      "GLB shows shape; direct URDF/SRDF files drive simulation. Validate them with Jake, then open Motion.",
    href: "/getting-started.html#rigging-urdf-20260915-xrdispatch4",
  },
  {
    id: "cloud-sync",
    date: "2026-07-15",
    kind: "feature",
    title: "Fusion 360 & Onshape sync",
    summary:
      "Connect cloud libraries to import and push without leaving Studio.",
    visual: "/docs/media/cloud-sync.gif?v=20260715-real",
    href: "/getting-started.html#cloud-sync-20260915-xrdispatch4",
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
    href: "/getting-started.html#reference-markup-20260915-xrdispatch4",
  },
  {
    id: "live-folder-project-sync",
    date: "2026-07-15",
    kind: "feature",
    title: "Live folder & project sync",
    summary:
      "Share, unshare, and rename updates push in realtime. Teammates see explorer changes without refresh — even while a generate is running.",
    visual: "/docs/media/workspaces.gif?v=20260715-real",
    href: "/getting-started.html#workspaces-20260915-xrdispatch4",
  },
  {
    id: "share-private-folder",
    date: "2026-07-15",
    kind: "feature",
    title: "Share a private folder",
    summary:
      "Right-click a folder → Share, pick a teammate from the dropdown (no retyping their email), and keep the folder private to people you invite.",
    visual: "/docs/media/share-folder.gif?v=20260715-real",
    href: "/getting-started.html#share-folders-20260915-xrdispatch4",
  },
  {
    id: "wiring-simulator",
    date: "2026-07-10",
    kind: "tool",
    title: "Wiring Simulator",
    summary:
      "Switch workspace mode to Wiring Simulator to breadboard circuits, generate with Wiring AI, validate drivers, and run schematic loops.",
    visual: "/docs/media/wiring.gif?v=20260715-real",
    href: "/getting-started.html#wiring-20260915-xrdispatch4",
  },
  {
    id: "source-parts",
    date: "2026-07-16",
    kind: "feature",
    title: "Source parts with ⓘ into Wiring AI",
    summary:
      "Click ⓘ on a component to search and link a catalog part, then drag the sourced component into the Wiring Simulator AI prompt for pin-aware circuits.",
    visual: "/docs/media/source-parts.gif?v=20260716-source",
    href: "/getting-started.html#source-parts-20260915-xrdispatch4",
  },
  {
    id: "canvas-sketch-mode",
    date: "2026-07-08",
    kind: "tool",
    title: "Canvas sketch mode",
    summary:
      "Sketch freely on the CANVAS design tab, then attach the sketch into the AI compose panel for generation that follows your drawing.",
    visual: "/docs/media/canvas.gif?v=20260715-real",
    href: "/getting-started.html#canvas-20260915-xrdispatch4",
  },
  {
    id: "geometry-picks",
    date: "2026-07-01",
    kind: "feature",
    title: "Geometry picks in prompts",
    summary:
      "Pick faces, edges, and paths on the model so @face / @edge / @path chips appear in the prompt and edits land on the right feature.",
    visual: "/docs/media/picks.gif?v=20260715-robot-arm",
    href: "/getting-started.html#picks-20260915-xrdispatch4",
  },
  {
    id: "ai-cad-generate",
    date: "2026-06-20",
    kind: "feature",
    title: "AI CAD generate & revise",
    summary:
      "Describe a part in the prompt panel and Generate creates geometry. Follow up to revise instead of restarting from scratch.",
    visual: "/docs/media/ai-generate.gif?v=20260715-real",
    href: "/getting-started.html#ai-generate-20260915-xrdispatch4",
  },
];

export function listMilestones({ limit = 0 } = {}) {
  const rows = [...MILESTONE_UPDATES].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return limit > 0 ? rows.slice(0, limit) : rows;
}
