# Chapter 3 — The Architect's Desk

**Theme:** Redo the interface to match the platform + reference grammar — without a full product rewrite.  
**Priority:** P1 (starts after walls exist; can prototype chrome earlier behind a flag)  
**Status:** `locked`

---

## Quest 3.1 — Layout grammar

**Depends on:** 2.1 (minimum: tools exist to put in the rail)  
**Status:** `locked`

### Objective
Reskin Architect Mode chrome to the reference layout:

| Zone | Content |
|------|---------|
| Left | Vertical tool rail (select, wall, window, door, library…) |
| Right | Property / component inspector for selection |
| Bottom | Floating pill: environment (optional) + **Level** + settings |
| Viewport | Orientation cube + 2D/3D (or Plan/3D) toggle |

### Tasks
- [ ] Architect-only CSS shell (dark charcoal panels, light canvas — match existing Render3D tokens)
- [ ] Hide or collapse non-architect noise while in Architect Mode (careful: don't delete Design UI)
- [ ] Motion: 2–3 subtle transitions (panel open, tool switch, level change) — purposeful, not noisy

### Acceptance
- First viewport in Architect Mode reads as one composition: canvas + tools + inspector + level
- Design mode layout unchanged when not in Architect

---

## Quest 3.2 — Property inspector

**Depends on:** 3.1, 2.3  
**Status:** `locked`

### Objective
Selecting a wall or opening shows typed controls: dimensions, presets, materials — inspired by the window panel (Fixed / Hinged / Sliding / Skylight, frame, width/height).

### Tasks
- [ ] Wall: length (derived), thickness, height, exterior/interior
- [ ] Opening: type tabs, width/height inputs + sliders, simple pane presets
- [ ] Live update of model + mesh on change

### Acceptance
- Changing width from 100→120 updates the opening without regenerating the whole building

---

## Quest 3.3 — Plan / 3D toggle (lightweight)

**Depends on:** 3.1, 1.3  
**Status:** `locked`

### Objective
Top-right (or top-left) **3D / 2D** toggle. 2D = true plan orthographic looking down; 3D = clamped perspective.

### Tasks
- [ ] Orthographic top view for 2D
- [ ] Remember last mode per session
- [ ] Full split view deferred to Chapter 6 / side quest

### Acceptance
- Toggle is one click; drawing tools work in both views

### Reward
Architect Mode feels like a product, not a panel bolted onto CAD
