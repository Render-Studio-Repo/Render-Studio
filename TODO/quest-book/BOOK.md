# North Star — Architect Mode

## The fantasy

You are drafting a building the way an architect thinks: **one floor, one level, discrete steps**. Corners connect. Walls snap. Windows and doors are typed inserts with real dimensions. The 3D view is really a **segmented 2D plan** extruded upward — you should not need to look below the horizon.

Manual tools and AI speak the **same language**: place a wall segment, set an opening, choose a frame preset. Humans drag; AI emits the same structured ops.

## Reference vibes (from the mood boards)

1. **Light architect studio** — Design / Structure / Comfort modes, left tool rail, right property sheet (window type, frame material, width/height, pane presets), bottom level pill, orientation cube, 2D/3D toggle.
2. **Dark split editor** — 2D schematic plan beside 3D isometric kitchen; Ground Floor pill; snap/transform bottom bar; FPS-clean SaaS chrome.
3. **Dark modular placer** — outlined illustrative 3D, selection gizmos, object detail card, keyboard hints — modular cabinets today, walls/windows tomorrow.

Render3D already leans **dark charcoal chrome + light canvas**. Architect Mode should keep that platform DNA while borrowing the *layout grammar* of those references: tool rail, property panel, level control, plan-first camera.

## What already exists (do not throw away)

- Architect workspace mode + right panel (`frontend/workspace-modes.js`, `index.html` architect panel)
- Local module catalog (floors, walls, windows, doors, roofs, pillars) + instant place
- Grid size / wall height inputs, lego-style snap anchors, nudge controls
- Architect skill for AI room kits (`backend/skills/architect/SKILL.md`)
- Robot snap connector presets / DXF profile hooks

## What we are aiming for (delta)

| Today | Target |
|-------|--------|
| Place prebuilt module chunks | **Draw** walls on a discrete grid; corners auto-connect |
| Free orbit 3D camera | **Plan-first** camera; clamp below-horizon; level stack |
| Prompt-heavy AI kits | AI emits **same ops** as manual tools |
| Dense right-panel form | Clean tool rail + property inspector + bottom level bar |
| Modules as loose meshes | Building model: levels → spaces → walls → openings |

## Non-goals (for the main quest line)

- Full BIM / code compliance / structural engineering
- Multi-story free flythrough with basements in view
- Photoreal materials pipeline (can stay illustrative)
- Replacing Design mode CAD kernel work

## Success snapshot

A user can: pick Architect Mode → stay on Level 1 → draw a closed room on the grid → punch a window → tweak width/height in the property panel → ask AI to "add a sliding door on the south wall" → get the same structured opening a human would place — without Design mode regressing.
