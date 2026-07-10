# Chapter 0 — Do No Harm

**Theme:** The tutorial island. Before we raise walls, we put up guardrails.  
**Priority:** P0 — must complete before any Architect UI/geometry rewrite  
**Status:** `available`

---

## Quest 0.1 — Draw the boundary

**Depends on:** none  
**Status:** `available`

### Objective
Document and enforce that Architect Mode is an isolated surface: shared viewport code stays behind feature flags / body classes; no drive-by refactors of Design/Wiring.

### Tasks
- [ ] Inventory Architect touchpoints (`app.js` architect_* , `index.html` panel, `styles.css` architect-*, skill, workspace mode)
- [ ] Write a short "safe edit zones" note in `progress/00-safe-edit-zones.md`
- [ ] Agree: new architect UI lives in dedicated modules (e.g. `architect-*.js`) rather than growing `app.js` further when practical

### Acceptance
- Clear list of files we *may* touch vs *must not* casually rewrite
- Any shared change has a Design-mode smoke check listed

### Reward
Unlocked: Chapter 1

---

## Quest 0.2 — Smoke ritual

**Depends on:** 0.1  
**Status:** `locked`

### Objective
Define a 5-minute smoke checklist so every Architect PR proves Design still boots.

### Tasks
- [ ] Checklist: open Design mode, orbit, select object, prompt panel visible
- [ ] Checklist: open Architect mode, place existing wall module, snap still works
- [ ] Store checklist in `progress/smoke-checklist.md`

### Acceptance
- Checklist exists and is referenced from chapter READMEs

### Reward
Confidence to remodel without fear

---

## Quest 0.3 — Quest Book forge (meta)

**Depends on:** none (parallel, fun)  
**Status:** `available`

### Objective
Make *this* quest book pleasant to use — chapters, side quests, progress marks — without blocking engineering.

### Tasks
- [ ] Keep `TODO/quest-book/` as the markdown source of truth
- [ ] Keep the Cursor canvas as the visual board
- [ ] When a quest completes: update chapter file status + `progress/log.md` one-liner

### Acceptance
- New contributors can find "what next" in under 60 seconds

### Reward
+1 Quest Master reputation
