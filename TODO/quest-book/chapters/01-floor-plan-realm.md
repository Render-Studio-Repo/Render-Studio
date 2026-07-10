# Chapter 1 — The Floor Plan Realm

**Theme:** Architecture is a stack of floor plans, not a free-fly game camera.  
**Priority:** P0  
**Status:** `locked` (needs Ch 0)

---

## Quest 1.1 — Discrete grid covenant

**Depends on:** 0.2  
**Status:** `locked`

### Objective
Make the build grid the law: placement and drawing snap to discrete steps so corners meet cleanly.

### Tasks
- [ ] Formalize grid model: cell size (mm), origin, snap for edges vs centers
- [ ] Ensure wall endpoints land on grid vertices (not arbitrary floats)
- [ ] Visual: clearer grid in Architect Mode (keep Design grid behavior unchanged)

### Acceptance
- Two wall segments meeting at a corner share an exact grid vertex
- Grid size control still drives snap step

### Notes
Existing `architect-grid-size` + lego snap are a foundation — evolve, don't discard.

---

## Quest 1.2 — One level at a time

**Depends on:** 1.1  
**Status:** `locked`

### Objective
Introduce a **Level** concept (Level 0 / Ground Floor / Level 1…) and make editing scoped to the active level.

### Tasks
- [ ] Data: `levels[]` with elevation / height; activeLevelId
- [ ] UI: bottom floating level pill (up/down) matching reference aesthetic
- [ ] Hide or ghost non-active levels (start simple: only active level visible)

### Acceptance
- Switching levels changes what you edit
- Default session starts on a single ground level

---

## Quest 1.3 — Horizon leash (camera)

**Depends on:** 1.2  
**Status:** `locked`

### Objective
Plan-first camera: useful 3D for reading massing, but you cannot (or need not) look below the horizon / under the slab while in Architect Mode.

### Tasks
- [ ] Architect-only orbit clamp (polar angle / pitch limits)
- [ ] Sensible default: elevated isometric / three-quarter looking down at the plan
- [ ] Preserve free orbit when leaving Architect Mode

### Acceptance
- In Architect Mode, camera cannot flip under the floor
- Design mode orbit unchanged

### Reward
Unlocked: Chapter 2
