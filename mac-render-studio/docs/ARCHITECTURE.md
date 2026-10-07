# Architecture — Mac Render Studio

## Goal

Ship a **desktop VibeCAD-based CAD app** that feels like Render Studio: AI-assisted modeling, PartDesign-style Create tools, project library from `projects/`, and a path to the rest of the web feature set.

## Layers

1. **Kernel / document model** — VibeCAD `App` + OpenCASCADE (Part / PartDesign / VibeScript).
2. **Interactive modeling** — PartDesign + Sketcher (Pad, Pocket, Hole, Revolution, …).
3. **Render Studio Mod** — Python workbench: Create toolbar, layout shell, project browser, AI dock.
4. **AI bridge** — HTTP to local Render Studio (`127.0.0.1:8001`) or later embedded VibeCAD agent runtime.
5. **Packaging** — Branded `RenderStudio.app` copy of VibeCAD + Mod symlink.

## Layout shell (Phase 1)

Mirrors web shell zones in PySide docks:

| Web zone | Mac implementation |
|----------|-------------------|
| Workspace mode bar | `layout_shell.ModeBar` (menu widget) |
| Left sidebar / Projects | `projects_dock.ProjectsDock` |
| Viewport | VibeCAD 3D view (native) |
| Right AI panel | `ai_dock.AIDock` |
| Create ribbon | Render Studio workbench toolbar |

Full ribbon / right-tab parity (Rigging, Architect, Wiring…) comes in later phases.

## Data flow — import web projects

```text
Render-Studio/projects/<id>/*.step|.stp
        │
        ▼
projects_dock / project_import.py
        │
        ▼
VibeCAD Document: imported solids
```

## Config

- `config/defaults.json` — API base URL, projects root, workbench name.
- VibeCAD user data: `~/Library/Application Support/FreeCAD/v26-3/` (and `v1-1`)
- Mod install: `…/Mod/RenderStudio` → symlink to this repo’s `Mod/RenderStudio`

## Non-goals (for Phase 1)

- Auth / Stripe / Discord / LinkedIn
- Live collab
- Full Architect bay lattice
- Wiring simulator parity
- Replacing the web production server
