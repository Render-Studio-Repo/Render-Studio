# Mac Render Studio

Native **macOS CAD app** built on **VibeCAD** (FreeCAD fork with VibeScript) as the geometry kernel/UI shell, with a Render Studio workbench layered on top.

> **Honest scope:** Full parity with the web Render Studio (AI generation, Architect, wiring, Fusion/Onshape, marketplace, Quest Book, collab…) is a multi-phase product. This folder is the **Mac VibeCAD product home**: runtime, custom Mod, project browser, layout shell, launcher, and feature roadmap.

## What’s here

| Path | Role |
|------|------|
| `runtime/VibeCAD.app` | VibeCAD 26.3 arm64 (install via script) |
| `Mod/RenderStudio/` | Custom workbench — Create tools, Projects dock, AI panel, layout |
| `scripts/` | Launch, install runtime, link Mod, **build icon**, package `.app` |
| `docs/` | Architecture + feature map |
| `dist/` | Packaged builds (gitignored) |

## Quick start

```bash
# 1) Install VibeCAD runtime (~700MB, one-time)
bash mac-render-studio/scripts/install-vibecad-runtime.sh

# 2) Link Mod into VibeCAD user Mod path
bash mac-render-studio/scripts/link-mod.sh

# 3) Launch VibeCAD with Render Studio workbench + layout
bash mac-render-studio/scripts/launch.sh

# 4) (Optional) Branded .app copy
bash mac-render-studio/scripts/package-app.sh
```

On first launch you get:

- **Top:** Design mode bar (web shell placeholder)
- **Left:** Projects browser (`projects/` tree)
- **Center:** VibeCAD 3D viewport + Create toolbar
- **Right:** AI assistant dock (local API at `:8001`)

Start the web stack for API bridge: `python run.py` in the workspace root.

**API keys:** On launch, the Mac app loads `../.env` (override with `RENDER_STUDIO_ENV`) into the process and VibeCAD preferences (`DotenvPath`). Open the **VibeScript** tab to use the styled composer with your OpenAI / Anthropic keys.

## Architecture

```text
┌─────────────────────────────────────────────┐
│  Render Studio Mac (this folder)            │
│  Mod/RenderStudio — layout, docks, bridge   │
├─────────────────────────────────────────────┤
│  VibeCAD.app (OCCT + PartDesign + VibeScript)│
│  mac-render-studio/runtime/VibeCAD.app      │
└─────────────────────────────────────────────┘
         ▲ shared source / skills
┌─────────────────────────────────────────────┐
│  vendor/vibecad — full fork source (build)  │
│  backend/skills/vibecad — web AI engine     │
└─────────────────────────────────────────────┘
```

## Relation to the web app

- Web app stays the live multi-user product (`frontend/` + `backend/`).
- Mac app **reads the same `projects/` tree** and calls local API at `http://127.0.0.1:8001` when running.
- Do **not** replace `backend/kernel/` in the web server with VibeCAD — separate products, shared project files.

## License note

VibeCAD/FreeCAD is LGPL-2.1+. PartDesign icons copied from upstream remain under their licenses. Keep SPDX headers in Mod files.
