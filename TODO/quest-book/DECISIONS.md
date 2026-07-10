# Locked decisions — Architect Mode

Updated: 2026-07-09 · planning only (no code yet)

## 1. Grid & segment — **3 ft bays**

- Architect grid is in **feet**.
- **Atomic wall unit = 3 ft segment** (one bay). You never draw a 7 ft wall as one free length — a 12 ft run is **four** 3 ft segments in a chain.
- Grid vertices are spaced so segment endpoints land cleanly (segment length = **3 ft**; drawing snaps along the 3 ft lattice).
- Internal storage may use mm at the CAD boundary; **UI + model + user dims are ft**.

## 2. Wall representation — **3 ft centerline segments + features**

Each wall piece in the model is one **segment**:

```
segment: {
  id, levelId,
  a: [i, j], b: [i, j],   // endpoints exactly 3 ft apart on-grid
  thicknessFt, heightFt?,
  feature: "wall" | "window" | "door",   // default "wall"
  featurePreset?: string                 // optional later
}
```

- **Corners:** segment endpoints that share a grid vertex connect.
- **Features:** a window or door **snaps onto a whole 3 ft segment** (replaces/occupies that bay’s feature). Not an arbitrary offset along a long polyline.
- **Connectors:** still **out of design** — standardized later on export. Design never generates tongue/socket geometry.

### Why this beats free-length centerlines

Matches modular thinking, makes AI ops trivial (`set_feature(segmentId, "window")`), and keeps openings aligned to the same lattice as walls.

## 3. Persistence — **`architect/building.json`**

`projects/<id>/architect/building.json` — additive, mode-owned. Meshes derived from JSON. Design kernel untouched.

## 4. Build order & UI — **walls first · domino with free back-and-forth**

- **Ship wall drawing first** (blank 3 ft segments).
- Then add **Window** and **Door** as ways to set a segment’s feature.
- Domino is a **progression you can reverse**: Wall ↔ Window ↔ Door freely (plus Level / Review). Not a one-way wizard that locks you out of walls after openings.
- Each step shows **only** that step’s controls (low noise, high APM).
- Typical flow: lay blank wall segments → stamp windows/doors on bays → jump back to Walls to extend the plan → Review.

### Domino ladder (v1)

```
Level  →  Walls  ⇄  Window  ⇄  Door  →  Review
              └────────┬────────┘
                 (same segment model;
                  feature tool changes)
```

- **Walls** — place / chain / delete **blank** 3 ft segments (`feature: "wall"`).
- **Window** — pick a segment → set `feature: "window"` (snap to that bay).
- **Door** — pick a segment → set `feature: "door"`.
- Clearing a feature returns the bay to blank wall (or explicit “Wall” tool on that segment).

## Clarification log

| Topic | Choice |
|-------|--------|
| Grid unit | Feet |
| Wall atom | **3 ft segment** |
| Openings | Feature **on** a segment (1 bay = 1 feature) |
| Long walls | Chains of 3 ft segments |
| Connectors | Export-time only |
| Persist | `architect/building.json` |
| UI | Domino; walls first; Wall⇄Window⇄Door |
