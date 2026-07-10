# Chapter 3 — Domino Desk (stepped UI)

**Theme:** Progression UI — low noise, high APM. Only show what the current step needs.  
**Priority:** P1 but **thin** — after walls draw (2.1+); do not build a full CAD chrome suite first  
**Status:** `locked`  
**Decisions:** draw walls first · domino order tracker · simpler than typical CAD · see `DECISIONS.md`

---

## Quest 3.1 — Domino order tracker

**Depends on:** 2.1  
**Status:** `locked`

### Objective
A simple **step progression** control (domino / order tracker): past steps · **current** · upcoming. Switching steps changes which tools and panels exist — not a permanent left rail of every tool at once.

### Draft steps
1. **Level** — pick / name active floor  
2. **Walls** — draw / select / delete walls  
3. **Openings** — window / door on selected walls  
4. **Review** — look around (clamped 3D / plan), light confirm  

### Tasks
- [ ] Step tracker UI (compact, Architect-only) — always visible but small
- [ ] Each step mounts **only** its controls; unmount or hide the rest
- [ ] Motion: short step-advance transition (1 intentional motion, not noise)
- [ ] Do **not** port the full reference tool rail + property sheet yet

### Acceptance
- User can tell what step they’re on in under a second
- Walls step has no openings chrome; openings step has no wall-draw chrome (except selection if needed)
- Design mode UI unchanged

---

## Quest 3.2 — Step-local controls (not a permanent inspector)

**Depends on:** 3.1, 2.3  
**Status:** `locked`

### Objective
When something is selected, show **only the few fields that matter for this step** (e.g. wall thickness in Walls; width/height in Openings). No dense multi-tab inspector in v1.

### Tasks
- [ ] Walls step: thickness (ft), maybe height override, delete
- [ ] Openings step: type, width, height (ft) — presets can wait for 4.2
- [ ] Live update model → mesh

### Acceptance
- Changing a dimension updates without regenerating the whole building
- No connector / material / comfort controls in these steps

---

## Quest 3.3 — Plan / 3D (lightweight, Review-friendly)

**Depends on:** 3.1, 1.3  
**Status:** `locked`

### Objective
Simple Plan vs 3D toggle — especially natural on the Review step; available earlier if it helps drawing.

### Tasks
- [ ] Orthographic plan vs clamped 3D
- [ ] Remember last mode per session
- [ ] Split view stays Ch 6 / side quest

### Acceptance
- One-click toggle; draw still works in both if exposed during Walls

### Reward
Architect feels walkable and calm — not a second Fusion
