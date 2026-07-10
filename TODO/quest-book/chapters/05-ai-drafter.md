# Chapter 5 — The AI Drafter

**Theme:** AI uses the same architect ops as the human — never a parallel universe of fused meshes.  
**Priority:** P1  
**Status:** `locked` (needs 2.3 + 4.1)

---

## Quest 5.1 — Op language

**Depends on:** 2.3, 4.1  
**Status:** `locked`

### Objective
Define a small JSON op set the UI already applies:

- `ensure_level`
- `place_segment` / `remove_segment` (exactly 3 ft bay; `feature: "wall"` by default)
- `set_feature(segmentId, "wall" | "window" | "door")`
- no connector ops in v1
- library/kit ops — **not** critical path

### Tasks
- [ ] Schema + validator (pydantic or JSON schema)
- [ ] Interpreter applies ops to Building model → mesh update
- [ ] Manual tools emit the same ops (parity)

### Acceptance
- A recorded op list can replay a room build identically

---

## Quest 5.2 — Prompt → ops

**Depends on:** 5.1  
**Status:** `locked`

### Objective
Architect AI path: LLM returns ops (and optional commentary), not only freeform Feature Programs / room kits.

### Tasks
- [ ] Update architect skill / prompt path to prefer ops against current building JSON
- [ ] Validate + self-repair loop on schema errors
- [ ] Keep old "generate modular kit" as advanced / fallback

### Acceptance
- "Add a 100cm window to the south wall" mutates the structured model
- Failure surfaces a clear error without corrupting the building

---

## Quest 5.3 — Selection-aware AI

**Depends on:** 5.2  
**Status:** `locked`

### Objective
If a wall/opening is selected, AI edits that target by default (same as today's selected-edit idea, but ops-based).

### Tasks
- [ ] Pass selection + building slice into prompt context
- [ ] Guardrails: no delete-all unless explicit

### Acceptance
- Selected wall + "make this a sliding door" updates that wall's opening

### Reward
Manual and AI are one builder
