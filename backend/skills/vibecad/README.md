# VibeCAD skill (Render Studio)

Gutted from [10-X-eng/vibecad](https://github.com/10-X-eng/vibecad) for Mode 2.0 → **VibeCAD** engine.

- Isolated `scripts/build123d_worker.py` (LGPL-2.1-or-later, upstream SPDX preserved)
- Authoring contract: `params` / `inputs` → assign `result: dict[str, Shape]`
- Render Studio publishes STEP → GLB into the Three.js viewport (no FreeCAD GUI)

Jake Mode 2.0 (`mode=v2`) is unchanged. Select **VibeCAD** in the 2.0 engine dropdown to use this path (`mode=vibecad`).
