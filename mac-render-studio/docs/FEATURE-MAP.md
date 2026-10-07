# Feature map — Web Render Studio → Mac VibeCAD app

Status key: **Done** (scaffold) · **Next** · **Later** · **Web-only**

| Render Studio feature | Mac / VibeCAD approach | Status |
|----------------------|------------------------|--------|
| 3D viewport / orbit | VibeCAD 3D view | Done (base) |
| Layout shell (mode bar, docks) | `layout_shell.py` + projects/AI docks | Done (scaffold) |
| Projects sidebar | `projects_dock.py` | Done (scaffold) |
| Create solids (Box…Torus) | PartDesign + RenderStudio toolbar | Done |
| Extrude / Pad / Pocket / Hole | PartDesign commands + toolbar | Done |
| Sketch | VibeCAD Sketcher workbench | Done (base) |
| Fillet / Chamfer / Shell | PartDesign | Next |
| Feature history tree | VibeCAD combo view (docked right) | Done (base) |
| Import `projects/` | `projects_dock` + `project_import.py` | Done |
| AI prompt → CAD (Jake / VibeCAD engines) | AI dock → POST local `/api/...` | Next |
| VibeScript / VibeCAD authoring | Native in VibeCAD runtime | Done (runtime) |
| Create-tab task overlay banner | PySide task panel / dock | Next |
| Architect mode | New workbench or BIM bridge | Later |
| Wiring simulator | Native Qt canvas + compose tab; full sim in browser | Done (scaffold) |
| Rigging / URDF | Export scripts from Mesh/Part | Later |
| Fusion / Onshape OAuth | Reuse web OAuth via local API | Later |
| Marketplace / Quest Book / help tours | Web-only or embedded WebView | Web-only / Later |
| Auth, billing, collab | Stay on web / API | Web-only |

## Create toolbar parity (target)

Match web Create strip + PartDesign icons already in `Mod/RenderStudio/Resources/icons/`:

Box · Cylinder · Sphere · Cone · Torus · Extrude · Revolve · Hole · Pad · Pocket · Create Sketch

## Recommended build phases

1. **VibeCAD runtime + layout shell + project browser** ← you are here  
2. AI dock wired to Mode 2.0 generate endpoint  
3. Create-task banner + ribbon tab parity  
4. Branded codesigned `RenderStudio.app`  
5. Deep VibeScript / agent integration from `backend/skills/vibecad`
