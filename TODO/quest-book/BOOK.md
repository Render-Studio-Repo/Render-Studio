# North Star — Architect Mode

## The fantasy

You are drafting a building the way an architect thinks: **one floor, one level, discrete steps in feet**. Corners connect. Walls are centerlines you draw. Windows and doors are typed openings. The 3D view is really a **segmented 2D plan** extruded upward — you should not need to look below the horizon.

The UI is a **domino progression**: each step shows only what you need right now, with a simple order tracker so you always know the current move. Manual tools and AI speak the **same language** (structured ops on the building model).

**Connectors are standardized and out of band** — not generated during design steps.

## Locked decisions

See [DECISIONS.md](./DECISIONS.md) for the full write-up. Short form:

| # | Decision |
|---|----------|
| 1 | Grid in **feet**, discrete snap |
| 2 | **Centerline walls** (+ thickness); not panel-first |
| 3 | Persist as **`architect/building.json`** in the project |
| 4 | **Draw walls first**; stepped low-noise UI; no unnecessary chrome |

## Reference vibes (mood boards) — borrow carefully

The references show rich tool rails and property sheets. We **steal the clarity** (plan focus, level control, typed openings) but **not the CAD density**. Our bar: simpler than typical CAD; one step at a time; high APM.

Render3D dark charcoal chrome + light canvas stays the platform DNA — Architect Mode just shows less of it per step.

## What already exists (reuse selectively)

- Architect workspace mode + panel, module catalog, mm grid, lego snap, connector UI, architect skill
- **Keep mode entry + viewport**; **do not** lead with connector generation or kit-place as the structure path
- Kits / connectors → later library or export side quests

## Target delta

| Today | Target |
|-------|--------|
| Place prebuilt modules + connectors | **Draw** centerline walls on a **ft** grid |
| Free orbit 3D | Plan-first camera; no under-horizon |
| Dense architect panel | **Domino steps** — only current-step controls |
| AI room kits / connector prompts | AI emits **same wall/opening ops** |
| Loose meshes | `architect/building.json` → derived meshes |

## Non-goals (main quest line)

- Generating snap connectors / robot tabs during design
- Full BIM, multi-story flythrough, photoreal materials
- Full CAD-style permanent tool rail + inspector before walls work
- Breaking Design / Wiring / Engineering

## Success snapshot

Architect Mode → Level 1 → draw a closed room on a **ft** grid → add a window opening → step tracker advances → AI can add a door via the same ops — Design mode untouched; no connector geometry in the design model.
