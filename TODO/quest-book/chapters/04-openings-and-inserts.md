# Chapter 4 — Openings & Inserts

**Theme:** Windows and doors are first-class, typed components — not just textured holes.  
**Priority:** P1  
**Status:** `locked` (needs 2.3)

---

## Quest 4.1 — Host openings on walls

**Depends on:** 2.3  
**Status:** `locked`

### Objective
Window/Door tools place an **opening** on a selected wall (or wall under cursor), with offset along the wall and discrete width.

### Tasks
- [ ] Tools: Window, Door on the left rail
- [ ] Opening cannot exceed wall length; snap width to grid step or cm step
- [ ] Visual cutout + frame insert (illustrative is fine)

### Acceptance
- Place window on a drawn wall; move/resize via inspector
- Delete opening without deleting the wall

---

## Quest 4.2 — Preset library (Simple)

**Depends on:** 4.1  
**Status:** `locked`

### Objective
Pane / door configuration presets (single pane, 2-lite, 3-lite, sliding, etc.) like the reference "Simple" grid.

### Tasks
- [ ] Small preset set for windows + doors
- [ ] Preset changes geometry parameters, not a random new mesh from AI

### Acceptance
- Switching preset is instant and deterministic

---

## Quest 4.3 — Keep kit modules as library

**Depends on:** 4.1  
**Status:** `locked`

### Objective
Existing modular catalog (room kits, roofs, pillars) becomes the **Library** tool — furniture/kit placement — not the only way to build structure.

### Tasks
- [ ] Library button opens existing architect library / presets
- [ ] Structural path = draw walls; kit path = library

### Acceptance
- Both paths coexist; docs/quest book explain when to use which

### Reward
Unlocked: Chapter 5 (AI can target openings + walls)
