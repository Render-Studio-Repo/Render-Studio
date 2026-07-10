# Chapter 3 — Domino Desk (Wall ⇄ Window ⇄ Door)

**Theme:** Low-noise stepped UI. Walls first, then features — but you can **go back and forth**.  
**Priority:** P1 thin — after 2.1+  
**Status:** `locked`  
**Decisions:** see `DECISIONS.md`

---

## Quest 3.1 — Domino order tracker (bidirectional)

**Depends on:** 2.1  
**Status:** `locked`

### Objective
Compact step tracker. Not a one-way wizard: user can jump **Walls ↔ Window ↔ Door** anytime after walls exist. Each step mounts **only** its controls.

### Draft steps
1. **Level** — active floor  
2. **Walls** — place / chain / delete **blank** 3 ft segments  
3. **Window** — stamp `feature: "window"` on a segment (snap to bay)  
4. **Door** — stamp `feature: "door"` on a segment  
5. **Review** — plan / clamped 3D lookover  

Suggested default order for new users: Level → Walls → (Window/Door as needed) → Review. Power users bounce freely among Walls / Window / Door.

### Tasks
- [ ] Always-visible compact tracker (Architect-only)
- [ ] Clicking a step switches toolset; unmount others
- [ ] One short transition on step change
- [ ] No full CAD tool rail / dense inspector

### Acceptance
- Current step obvious in &lt;1s
- From Window you can return to Walls and extend the plan
- Design mode UI unchanged

---

## Quest 3.2 — Step-local controls

**Depends on:** 3.1, 2.3  
**Status:** `locked`

### Objective
Few fields only.

### Tasks
- [ ] Walls: thickness (ft), delete segment, maybe height
- [ ] Window / Door: confirm feature on selected bay; clear → blank wall; optional height/sill later
- [ ] Live model → mesh (feature changes visual: blank vs glazed vs door cut)

### Acceptance
- Changing feature on one bay does not rebuild unrelated segments
- No connector / material chrome

---

## Quest 3.3 — Plan / 3D (lightweight)

**Depends on:** 3.1, 1.3  
**Status:** `locked`

### Objective
Plan vs clamped 3D toggle — especially on Review; OK earlier if it helps.

### Acceptance
- One-click; placing bays still works in both if exposed

### Reward
Calm, walkable Architect — not a second Fusion
