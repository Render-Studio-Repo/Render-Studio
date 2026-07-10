# Chapter 2 — Raise the Walls

**Theme:** Manual construction tools — draw like an architect, snap like Lego.  
**Priority:** P0  
**Status:** `locked` (needs Ch 1)

---

## Quest 2.1 — Wall draw tool

**Depends on:** 1.3  
**Status:** `locked`

### Objective
Replace "only place prefab wall chunks" as the primary path with a **draw wall** tool: click-click (or click-drag) along the grid to create wall segments.

### Tasks
- [ ] Left tool rail: Select + Wall tools (Architect Mode only)
- [ ] Preview ghost segment while drawing
- [ ] Commit creates a wall entity with start/end grid points, thickness, height from level defaults
- [ ] Keep existing "Place wall panel" as a fallback / advanced path during migration

### Acceptance
- User can draw a rectangular room in four segments without placing a room kit
- Undo/redo or at least delete selection works for new walls

---

## Quest 2.2 — Corners connect

**Depends on:** 2.1  
**Status:** `locked`

### Objective
When wall endpoints share a grid vertex, they form a clean corner (topology + visuals).

### Tasks
- [ ] Corner join rule: coincident endpoints merge into a vertex
- [ ] Optional auto-miter / shared pillar at corners (start with clean abutment)
- [ ] Prevent tiny sliver walls below min length (1 grid cell or configurable)

### Acceptance
- Closed loop of walls reads as one room outline
- No visible gaps at 90° corners on-grid

---

## Quest 2.3 — Building model (lightweight)

**Depends on:** 2.2  
**Status:** `locked`

### Objective
Store architecture as structured data, not only free meshes — so AI and UI share one model.

### Suggested schema (draft — discuss)
```
Building
  levels[]: { id, name, elevationMm, heightMm }
  walls[]: { id, levelId, a: [i,j], b: [i,j], thicknessMm, kind }
  openings[]: { id, wallId, type, offsetMm, widthMm, heightMm, sillMm, preset }
  spaces[]?: inferred from closed loops (side quest OK)
```

### Tasks
- [ ] Persist building JSON alongside project (path TBD)
- [ ] Viewport meshes generated *from* the model (single source of truth)
- [ ] Migration: existing architect module placements can remain as "furniture/kit" objects initially

### Acceptance
- Reloading a project restores walls/openings from structured data
- Manual edit updates the model, then the mesh

### Reward
Unlocked: Chapter 3 + Chapter 4 can start in parallel after 2.3
