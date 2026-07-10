# Chapter 1 — The Floor Plan Realm

**Theme:** Architecture is a stack of floor plans, not a free-fly game camera.  
**Priority:** P0  
**Status:** `locked` (needs Ch 0)  
**Decisions:** grid in **feet** · see `DECISIONS.md`

---

## Quest 1.1 — Discrete grid covenant (feet)

**Depends on:** 0.2  
**Status:** `locked`

### Objective
Make the build grid the law in **feet**: placement and drawing snap to discrete ft steps so corners meet cleanly.

### Tasks
- [ ] Formalize grid model: cell size in **ft** (default **1 ft**), origin, snap to grid vertices
- [ ] Wall endpoints land on integer (or agreed sub-step) grid indices — not arbitrary floats
- [ ] Architect Mode grid visuals in ft; Design mode grid behavior unchanged
- [ ] UI labels/dims in ft (internal mm conversion only at CAD/export boundary if needed)

### Acceptance
- Two wall segments meeting at a corner share an exact grid vertex
- User-facing grid control is in feet

### Notes
Migrate away from mm-only `architect-grid-size` when this quest lands — not before.

---

## Quest 1.2 — One level at a time

**Depends on:** 1.1  
**Status:** `locked`

### Objective
Introduce a **Level** concept and scope editing to the active level. Keep chrome minimal (fits the domino “Level” step).

### Tasks
- [ ] Data: `levels[]` with elevation / height (ft); activeLevelId
- [ ] Simple level control in the current step UI (not a permanent CAD status bar yet)
- [ ] Only active level visible at first

### Acceptance
- Switching levels changes what you edit
- Default session: single ground level

---

## Quest 1.3 — Horizon leash (camera)

**Depends on:** 1.2  
**Status:** `locked`

### Objective
Plan-first camera: useful 3D for massing, cannot look under the slab in Architect Mode.

### Tasks
- [ ] Architect-only orbit clamp
- [ ] Default elevated three-quarter / isometric looking down at the plan
- [ ] Free orbit restored outside Architect Mode

### Acceptance
- Camera cannot flip under the floor in Architect Mode
- Design mode orbit unchanged

### Reward
Unlocked: Chapter 2
