# Chapter 4 — Features on 3 ft segments (Window / Door)

**Theme:** Windows and doors are **features snapped onto a whole 3 ft wall segment** — not free-floating cutouts.  
**Priority:** P1  
**Status:** `locked` (needs 2.3)  
**Decisions:** see `DECISIONS.md`

---

## Quest 4.1 — Snap feature onto a bay

**Depends on:** 2.3, 3.1  
**Status:** `locked`

### Objective
On **Window** or **Door** step: select (or click) a **3 ft segment** → set its `feature` to `window` or `door`. Visual updates for that bay only. One feature per segment in v1.

### Tasks
- [ ] Window step: click segment → `feature: "window"`
- [ ] Door step: click segment → `feature: "door"`
- [ ] Re-click / clear / Walls-step action → back to `feature: "wall"`
- [ ] Reject if segment already has a conflicting rule (v1: just replace)
- [ ] No connectors; no arbitrary width offsets along a multi-bay run

### Acceptance
- A 12 ft wall (4 bays) can be wall | window | wall | door by stamping three different bays
- Feature always aligns to the 3 ft segment bounds

---

## Quest 4.2 — Feature look (thin presets)

**Depends on:** 4.1  
**Status:** `locked`

### Objective
Readable blank / window / door visuals. Optional tiny presets later — skip if noisy.

### Tasks
- [ ] Distinct illustrative mesh per feature type
- [ ] Presets only if they stay one-tap and low chrome

### Acceptance
- At a glance you can tell which bays are openings

---

## Quest 4.3 — Kits stay out of the structure path

**Depends on:** 4.1  
**Status:** `locked`

### Objective
Old module catalog is not how you build. Structure = 3 ft segments + features.

### Acceptance
- Stepped flow never requires kit-place to make a room

### Reward
Chapter 5 — AI sets the same `feature` on segment ids
