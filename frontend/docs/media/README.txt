Real Getting Started demo GIFs recorded from the Studio UI (dummy account demo.docs.gif@r3d-studios.com).

Object-click demos (picks, select-object) always use the Robot Arm template
seeded from project 505279e3 via POST /api/demo/robot-arm into a private
user project.

Files (served at /docs/media/*.gif):
  ai-generate.gif       — type a CAD prompt + hover Generate
  multi-gen.gif         — two Generate clicks / parallel banner
  workspaces.gif        — team select / invite / workspace menu
  share-folder.gif      — folder menu → Share → email
  preferences.gif         — account menu → Preferences (mouse / theme / Advanced)
  source-parts.gif        — ⓘ part profile → catalog Use this → Wiring AI drag
  reference-markup.gif    — upload PDF → Docs tab opens → Pen + notes → Send to AI
  canvas.gif            — CANVAS tab sketch + attach (legacy)
  canvas-workspace.gif   — Open last / Smart Description / Send to Compose
  sketch.gif            — SKETCH tab + constrained sketch tools
  picks.gif             — Face pick on Robot Arm + @face prompt
  link-to-prompt.gif    — Shift-select project files → drag into AI prompt
  select-object.gif     — Select tool: click whole arm, double-click a body
  solid-tools.gif       — SOLID tab + ribbon Create/Modify tools
  wiring.gif            — Wiring tab + circuit prompt
  wiring-compose.gif    — Wiring History stamp, Links chips, Send to wiring
  cloud-sync.gif        — Fusion / Onshape connect & libraries
  rigging-urdf.gif      — RIGGING tab → URDF/SRDF mode
  render-agent.gif      — Render Agent help chat
  robotics-configuration.gif — ROBOTICS Teleop tab + HTTPS proxy + Quest auto-Connect
  robotics-viser.gif      — Viser HTTP LAN URL → /api/viser/p/…
  robotics-teleop.gif     — Teleop HTTPS URL → /api/teleop/p/… + Quest Connect
  viewport-finder.gif     — Cmd/Ctrl+F spotlight across projects, prompts, history
  pin-projects.gif        — Star / Pin to projects (up to 5)
  clip-video-editor.gif   — Record → timeline, trim, Share, GIF, AI film-edit
  imagine-panel.gif       — Imagine tab, gallery, /fetch formats
  parts-catalog.gif        — McMaster / STEP catalog + Send to wiring
  reference-folders.gif  — Screenshots / Recordings / AR folders
  prompt-persist.gif       — Compose draft saved per project on switch
  timeline-render-history.png — timeline: 2.0 yellow / Render purple + cost
  management-feedback-dms.png — admin feedback follow-up → realtime DM
  See GIF-CATALOG.md for 42 Aug–Sep 2026 loops (viewport-split-layouts … cad-mode-chips).
  Cache-bust: ?v=20260916-gifs40

Re-record:
  PYTHONUNBUFFERED=1 python3 -u scripts/gif-demos/record_getting_started_gifs.py [demo...]
  # Sept 2026 product GIFs (studio-dark loops):
  python3 scripts/gif-demos/record_sept_feature_gifs.py
  # Aug–Sep 2026 (42 new files):
  python3 scripts/gif-demos/record_aug_sep_feature_gifs.py
