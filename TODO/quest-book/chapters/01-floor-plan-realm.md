# Chapter 1 — The Floor Plan Realm

**Theme:** Architecture is a stack of floor plans on a **3 ft bay** lattice.  
**Priority:** P0  
**Status:** `done` (usable slice 2026-07-10)  
**Decisions:** see `DECISIONS.md`

---

## Quest 1.1 — 3 ft bay lattice

**Depends on:** 0.2  
**Status:** `done` (2026-07-10)

### Objective
Formalize the Architect grid so every wall endpoint lands on the **3 ft segment** lattice.

### Tasks
- [x] Grid model in `frontend/architect-lattice.js`
- [x] Architect-only overlay `architect-grid-visual.js`
- [x] enter/exit hooks; Design `rebuildGrid` untouched

---

## Quest 1.2 — One level at a time

**Depends on:** 1.1  
**Status:** `done` (stub in building model)

### Notes
`levels[]` + `activeLevelId` in `architect-building.js` / `building.json`. UI shows Ground Floor label. Multi-level switcher still thin (single level is enough to use).

---

## Quest 1.3 — Horizon leash (camera)

**Depends on:** 1.2  
**Status:** `done`

### Notes
`architect-camera.js` — default elevated view on enter; per-frame clamp while Architect active. Design TrackballControls unchanged when exited.