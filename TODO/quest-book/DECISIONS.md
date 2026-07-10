# Locked decisions — Architect Mode

Updated: 2026-07-09 · from planning discussion (no code yet)

## 1. Grid — feet

- Architect build grid is in **feet** (imperial), discrete steps.
- Default snap step: **1 ft** (confirm finer opening snap later if needed, e.g. 0.5 ft / 6 in).
- Internal storage may still use mm for the CAD kernel; **UI + grid math + user-facing dims are ft**.
- Existing `architect-grid-size` (mm) will be migrated / replaced when Ch 1 lands — not before.

## 2. Wall representation — **centerline walls** (recommended & locked unless you veto)

See clarification below. We draw **wall centerlines** on the grid; thickness is a property; corners share vertices. We are **not** leading with placeable face-panels as the structure path.

**Connectors are out of the design loop:** standardized later (export / kit / robot assembly). Design steps do **not** generate tongue/socket/pillar connector geometry. That keeps the model simple and the UI quiet.

## 3. Persistence — **`architect/building.json` in the project folder** (recommended)

| Option | Verdict |
|--------|---------|
| Embed in timeline / scene metadata | Couples Architect to Design history; harder to diff/AI-read |
| Only GLB meshes | No structured ops; AI + reload fragile |
| **`projects/<id>/architect/building.json`** | Additive, mode-owned, easy replay, doesn't touch Design kernel |

Meshes in the viewport are **derived** from that JSON (cache OK). Design mode files stay untouched.

## 4. Build order & UI — **draw walls first · stepped “domino” flow · low noise**

- **Ship walls before** full tool-rail / property-sheet chrome.
- Interface is a **progression of steps** (domino / order tracker): you always see where you are, what you just did, and what’s next — but **only the controls for the current step**.
- Visual language: **simpler than typical CAD** — fewer panels, less permanent chrome, higher APM / clearer focus.
- Unnecessary for v1 design path: connector generation, dense inspectors, library kits as primary structure, Comfort/materials tabs, split view.

### Draft step ladder (domino)

```
1. Level / floor   →  2. Walls (draw)  →  3. Openings  →  4. Review
        ●────────────────●────────────────●──────────────○
```

Later steps (finishes, furniture, kit export) stay side quests / future dominos.

## Clarification: question 2 (wall representation)

**What I was asking:** when you draw a wall, what is the *thing* in the data model?

### A) Centerline wall (floor-plan style) — **pick this**

- You click two grid points. The wall is a **line segment** (centerline) plus `thickness` and `height`.
- At a corner, two walls share the **same grid vertex** → corners connect naturally.
- Openings are parameters *on* that segment (offset + width along the wall).
- Matches “discrete steps / corners connect / one floor at a time.”
- Connectors don’t need to exist in the design model; a later export pass can stamp standardized connectors onto centerlines if needed.

### B) Face / panel wall (today’s Lego modules)

- Each wall is a **solid panel mesh** you place like a brick.
- Corners often need **extra pieces** (pillars, connectors) to look joined.
- Great for printable kits; noisier for fast plan drafting and AI ops.

**Why A for this quest line:** you asked for draw-walls, corner connect, standardized connectors *outside* design, and a simple stepped UI. Centerlines are the smallest model that supports that.
