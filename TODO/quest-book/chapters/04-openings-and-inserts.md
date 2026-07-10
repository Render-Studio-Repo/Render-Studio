# Chapter 4 — Openings

**Theme:** Windows and doors as typed openings on centerline walls — Openings domino step only.  
**Priority:** P1  
**Status:** `locked` (needs 2.3)  
**Decisions:** ft dims · step-local UI · no connectors · see `DECISIONS.md`

---

## Quest 4.1 — Host openings on walls

**Depends on:** 2.3, 3.1  
**Status:** `locked`

### Objective
On the **Openings** step only: place a window/door opening on a selected wall (offset + width along the centerline), snapped in ft.

### Tasks
- [ ] Window / Door actions visible only in Openings step
- [ ] Opening cannot exceed wall length; width snaps to ft step (or 0.5 ft if we add it)
- [ ] Simple cutout visual (frame detail optional / minimal)
- [ ] No connector generation

### Acceptance
- Place window on a drawn wall; resize via step-local fields
- Delete opening without deleting the wall

---

## Quest 4.2 — Preset library (Simple) — thin

**Depends on:** 4.1  
**Status:** `locked`

### Objective
Small deterministic presets (fixed / sliding / etc.) — only if they stay low-noise. Defer dense “Simple” grids if they clutter the step.

### Tasks
- [ ] Tiny preset set OR skip until users ask
- [ ] Presets change parameters, not AI meshes

### Acceptance
- Switching preset is instant and deterministic — or quest deferred to side quest if too noisy

---

## Quest 4.3 — Kits stay out of the structure path

**Depends on:** 4.1  
**Status:** `locked`

### Objective
Existing module catalog is **not** how you build walls. Library / kits = later side quest or a far domino — not required for openings v1.

### Tasks
- [ ] Confirm stepped flow does not surface kit-place as structure
- [ ] Document kits → SQ / future step

### Acceptance
- Structure path remains: draw walls → openings

### Reward
Unlocked: Chapter 5 (AI ops on the same model)
