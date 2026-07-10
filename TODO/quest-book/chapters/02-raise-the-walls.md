# Chapter 2 — Raise the Walls

**Theme:** Manual construction first — draw centerlines, corners connect, no connector noise.  
**Priority:** P0 · **Do this before UI chrome**  
**Status:** `locked` (needs Ch 1)  
**Decisions:** centerline walls · `architect/building.json` · no connectors in design · see `DECISIONS.md`

---

## Quest 2.1 — Wall draw tool

**Depends on:** 1.3  
**Status:** `locked`

### Objective
Primary path: **draw wall** on the ft grid (click–click or click–drag). Ghost preview. No kit placement required. No connector generation.

### Tasks
- [ ] Minimal wall tool in the **Walls** domino step only (select + draw + delete)
- [ ] Ghost segment while drawing; snap to ft grid vertices
- [ ] Commit → centerline wall entity: start/end grid points, thickness, height from level defaults
- [ ] Do **not** generate tongue/socket/pillar connectors
- [ ] Existing “place wall panel” / connector UI: leave alone or hide in Architect stepped flow — not the primary path

### Acceptance
- Draw a rectangular room in four segments without a room kit
- Delete selection works for new walls
- No connector meshes appear as part of drawing

---

## Quest 2.2 — Corners connect

**Depends on:** 2.1  
**Status:** `locked`

### Objective
Shared grid vertices → clean corners (topology + simple visuals). Abutment/miter is enough; no corner pillars required in design.

### Tasks
- [ ] Coincident endpoints merge into a vertex
- [ ] Clean abutment at 90° (optional simple miter later)
- [ ] Min length: 1 grid cell (1 ft default)

### Acceptance
- Closed loop reads as one room outline
- No visible gaps at on-grid 90° corners

---

## Quest 2.3 — Building model + `architect/building.json`

**Depends on:** 2.2  
**Status:** `locked`

### Objective
Structured building data is the source of truth; viewport meshes are derived. Persist under the project as `architect/building.json`.

### Schema (draft)
```
Building
  units: "ft"
  grid: { stepFt: 1 }
  levels[]: { id, name, elevationFt, heightFt }
  walls[]: { id, levelId, a: [i,j], b: [i,j], thicknessFt, heightFt? }
  openings[]: { id, wallId, type, offsetFt, widthFt, heightFt, sillFt, preset? }
  # no connectors[] in v1 design model
```

### Tasks
- [ ] Create/read/write `projects/<id>/architect/building.json`
- [ ] Mesh generation from model (simple extruded centerlines)
- [ ] Reload restores walls from JSON
- [ ] Manual draw updates JSON first, then mesh

### Acceptance
- Round-trip save/load of a drawn room
- Design timeline / kernel paths untouched

### Reward
Unlocked: openings (Ch 4) and thin stepped UI (Ch 3) — walls already work
