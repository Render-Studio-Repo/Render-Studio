---
name: vibecad
description: Author parametric mechanical CAD through Render Studio's VibeCAD engine (build123d sidecar and optional FreeCAD). Use for Mode 2.0 VibeCAD, named solids, STEP/GLB publish, DXF/image-driven parts, and mating to linked hardware.
---

## Render Studio sourcing order

Reuse a verified exact project part, otherwise look for the manufacturer's official STEP online first. If unavailable, search **Parts Catalog → Browse parts SECOND** through `/api/design-assist/parts/catalog/search?q=EXACT_COMPONENT&fallback=false`, before other CAD repositories or simplified geometry. Use exact part/revision names and aliases; record misses or network errors honestly. Import returned STEP IDs during Generate, inspect units/fit, and place the part in the complete assembly. Carry real product links, datasheets, schematics, documentation, thumbnails and STEP provenance into `parts_list`/`parts_list.json`, one entry per unique purchase URL; never invent a purchase link from a CAD-only catalog page.


# VibeCAD (Render Studio)

Provenance: Render Studio skill pack, audited against [10-X-eng/vibecad](https://github.com/10-X-eng/vibecad) `v26.3.1-RC6-build6` (`36baf68369176edb69c70a9692f38c1acdfadcf2`). Render preserves the source-backed authoring and evidence rules while adapting execution to its isolated build123d/FreeCAD workers.
This file is required for generation. Jake Mode 2.0 (`cad` skill / cadgen) is a different engine — do not emit Jake Feature Programs, cadgen `@step` models, or `cadgen step inspect` here.

## Upstream parity contract

- Keep the human-selected authoring mode authoritative. VibeScript uses the source-backed program API; Native uses only the tool families exposed by the selected workbench. Do not silently switch modes inside a turn.
- Treat object names, document revision, program IDs and published output IDs as stable references. Re-inspect them after every mutation and use the returned identifiers in later calls.
- Match the current Native workbench families when planning: model/Part Design, Sketcher, Draft and Surface; Assembly and Fasteners; Spreadsheet and Material; Mesh, MeshPart, Points, reconstruction and Inspection; Robot; FEM/Analyze; CAM/Manufacture; and Drawing/TechDraw.
- For complex work, read exact source/API state first, make one bounded change, inspect the resulting geometry/domain state, and capture an independent viewport view before finishing. A failed candidate remains evidence; repair it instead of claiming success.
- Native desktop VibeCAD owns FreeCAD document history, ribbon schemas and in-process solvers. Render Studio does not embed that desktop process. Its parity boundary is the same authoring intent, stable identities, joint semantics, source inspection and evidence gates, executed through `build123d_worker.py` or `FreeCADCmd` and published as STEP/GLB.

## Purpose

Author millimetre, Z-up mechanical parts as complete build123d (or FreeCAD) Python that assigns an ordered `result` dict of named single-solid Shapes. The isolated build123d 0.11 sidecar publishes STEP → GLB into the viewport.

## Use this skill when

The user selected the **VibeCAD** CAD engine, or the request is `mode=vibecad`. Also use it when they attach photos, DXF drawings, or @-linked STEP hardware to mate against.

Do not use Jake `cad` Feature Program JSON, `cadpy`/`cadgen` `scripts/step`, `gen_step()`, `$cad-viewer`, or `cadgen step inspect` / `cadgen snapshot`.

## Authoring contract

- Units: millimetres. Z-up. Prefer `Align.MIN` for stacked primitives.
- Driving dimensions arrive as `params`. Optional STEP imports arrive as `inputs`.
- Both names are always present. Read `params` directly (for example, `p.update(params)`); `globals()` is unavailable in the isolated runtime.
- Assign `result: dict[str, Shape]` whose keys exactly match `expected_outputs` (same order).
- Each value is one independently editable solid.
- `result` is the only published geometry. Include the complete requested assembly in its assembled pose: metal frame/panels, printed mounts, battery, motors/wheels, electronics, wiring and placed purchased hardware. Never export only the printed subset unless the user requests that subset. A printer skill does not override a specified metal construction. “Few parts” means simplify custom fabrication, not remove functional components. Do not invent an auxiliary assembly export channel; put all named physical leaf solids in `result` and `expected_outputs`. An exploded layout must not replace the assembled model.
- Mechanisms: include a `joints` array whose parent/child names match those keys. Supported FreeCAD Assembly semantics are `fixed`, `revolute`, `slider`, `cylindrical`, `ball`, `distance`, `parallel`, `perpendicular`, `angle`, `rack_pinion`, `screw`, `gears`, and `belt`. Include axis, anchor and applicable angle/length/ratio limits. The host writes `<model_stem>.joints.json` and embeds portable metadata in STEP without marker solids. The bundled Fusion adapter recreates the five motion joints (`fixed`, `revolute`, `slider`, `cylindrical`, `ball`); the remaining relation types stay explicit metadata unless their target adapter reports support. Ordinary STEP import does not create mates in Fusion, Onshape, or SolidWorks.
- Do not import exporters, write files, or call the network.
- Linked McMaster / @component STEP files: load via `inputs[alias]` and mate — do not reprint fasteners. FreeCAD macros receive the same `inputs` dict as Part objects (millimetres, unit-corrected); set `Placement` and include them in `result` so one assembly STEP/GLB is published.
- Photos / canvas: read attached files WITH the prompt. `canvas-sketch` and line drawings explain layout (arrows, hanging off, beside, offset) — they are not the finished part. Photos of extrusion, rail, or hardware are mate targets. Product photos of the thing to make: match silhouette of THAT object. Do not sit a new motor/bracket on top of an extrusion unless the prompt and sketch say on-top.
- DXF: `dxf_filename` is in the worker cwd. Reconstruct 3D from layers/polylines. `import_dxf()+make_face()+extrude()` only for an explicit flat plate.

Hopper / funnel / vessel: one outer silhouette, then revolve or loft (`Pos(0, 0, z) * Circle(r)` stations), then cut the bore. Do not fuse centered Cylinder/Cone with `.translate((0, 0, z))`. If stacking primitives, every one needs `align=(Align.CENTER, Align.CENTER, Align.MIN)` and `z` is the BOTTOM of that solid.

## Threads (do not Helix-sweep)

Long `Helix` + `sweep` threads (trapezoidal ridges over tens of millimetres) **time out or SIGSEGV** in the isolated build123d worker. Do not author them.

- Printed screw / clamp bolt: cylinder at **major** diameter, chamfered ends. Optional 1–2 annular grooves for looks.
- Nut / threaded jaw / collar: hole at **minor** diameter. Same cosmetic-groove limit.
- At most **two turns** if you truly need a Helix sweep. Never 20-turn solid threads.
- Fit is clearance on diameters, not a swept trapezoid.

Do not fuse a `Torus` onto a hollow cup or tube (controller rims). That **SIGSEGVs** the sidecar. Use `Cylinder(R, 2*r) - Cylinder(R-2*r, 2*r)` or a fillet. The worker substitutes a washer for `Torus`.

## Colour coding

Assign realistic material finishes per named part; infer plausible material from function when unspecified. Preserve explicit user/reference colours, authored neutral metals, white paint, textures and transparency. Use srgb("#hex") on leaf solids (aluminum #c0c6cc, steel #8a939d, rubber #303438, brass #c4a574, POM #d9d3c7). Identical parts/materials share a finish. Unknown parts use neutral aluminum; never random, index, or rainbow palettes. Assembled and exploded outputs must share the same material assignments and stable part labels; only transforms change.

`srgb` is supplied by the worker: do not import `cadgen` or call `cadgen.srgb`, even if an older improved prompt mentions it. Translate that appearance request to the built-in `srgb(hex)` helper; preserve the requested finish.

## Tools

- `scripts/build123d_worker.py` — isolated build123d 0.11 sidecar.
- FreeCADCmd when available (`backend/services/freecad_engine.py`).

ChatGPT / OpenAI / Claude / Gemini: ChatGPT and OpenAI keys use Codex (one session writes `*.vibecad.py`). Claude uses an Anthropic API key the same way desktop VibeCAD does — not a Claude.ai Pro/Max login. Do not emit JSON tool calls or loop on `conversation.review_design`. Desktop VibeCAD uses Codex app-server for ChatGPT; Render generate uses one `codex exec` for that path. The in-process tool agent is a debug override (`vibecad_agent`); one-shot JSON is `vibecad_oneshot` or a Claude/Gemini API key.

| Tool | Kernel |
|------|--------|
| `core.inspect` | Live project / program / object / domain / api / image |
| `conversation.review_design` | Independent design reviewer |
| `build123d.create_model` | `scripts/build123d_worker.py` (isolated build123d 0.11) |
| `build123d.inspect_model` | Worker named-solid facts (volume, bounds, vertex/face counts) |
| `build123d.set_parameters` | Rebuild current source with new `params` |
| `core.capture_view_screenshot` | Playwright iso/top/front of the published GLB (`scripts/capture_views.py`) |
| `freecad.create_model` | Headless FreeCADCmd: Import.insert catalog STEPs into `inputs`, Placement in mm, export assembly STEP |
| `finish` | Only after inspect + viewport capture passed |


## Stable shell cavities and offsets

Do not derive a functional cavity or mating rim by blindly applying a large inward offset to a densely scalloped periodic spline. Tight curvature can make the offset self-intersect or collapse. Author a separate smooth, closed planar inner profile for the cavity/rim/lip and keep decorative scallops on the exterior. Validate the wire/face and shell wall thickness before lofting. Preserve the requested clearances and all output solids. A `BRep_API: command not done` failure requires a source repair at the failing operation; do not rerun identical geometry, suppress the exception, or replace the offset with the unmodified outer face.

If a valid spline-offset solid loses its solid topology on STEP round trip, convert the offset face to ordinary B-splines before extrusion/loft (`face.to_splines(tolerance=0.001)`, millimeters). Preserve the profile within that tolerance and keep the tolerance well below wall/fit clearances. The host validates the actual exported solids; do not omit a component or bypass that check.
