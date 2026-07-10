# Chapter 2 — Raise the Walls (3 ft segments)

**Theme:** Lay blank **3 ft** wall bays; features via Window/Door steps.  
**Priority:** P0  
**Status:** `done` (usable slice 2026-07-10)

---

## Quest 2.1 — Place / chain 3 ft wall segments — `done`

`architect-draw.js` + Walls step. Click lattice → chain bays. Ghost preview. No connectors.

## Quest 2.2 — Corners connect — `done`

Shared lattice vertices; duplicate bays rejected; abutment meshes meet at corners.

## Quest 2.3 — `architect/building.json` — `done`

`GET/PUT /api/projects/{id}/architect/building` → `projects/<id>/architect/building.json`. Autosave on change. Reload on enter / project switch.
