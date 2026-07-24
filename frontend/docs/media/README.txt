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
  canvas.gif            — CANVAS tab sketch + attach
  sketch.gif            — SKETCH tab + constrained sketch tools
  picks.gif             — Face pick on Robot Arm + @face prompt
  link-to-prompt.gif    — Shift-select project files → drag into AI prompt
  select-object.gif     — Select tool: click whole arm, double-click a body
  solid-tools.gif       — SOLID tab + ribbon Create/Modify tools
  wiring.gif            — Wiring tab + circuit prompt
  cloud-sync.gif        — Fusion / Onshape connect & libraries
  rigging-urdf.gif      — RIGGING tab → URDF/SRDF mode
  render-agent.gif      — Render Agent help chat
  timeline-render-history.png — timeline: 2.0 yellow / Render purple + cost
  management-feedback-dms.png — admin feedback follow-up → realtime DM

Re-record:
  PYTHONUNBUFFERED=1 /home/ubuntu/.venv/bin/python -u \
    /home/ubuntu/scripts/gif-demos/record_getting_started_gifs.py [demo...]
  # Light unique captures (multi-gen, link-to-prompt, solid-tools, sketch, rigging-urdf):
  #   /tmp/js_record_gs.py
