# Progress log

| Date | Event |
|------|-------|
| 2026-07-09 | Quest Book forged. Chapters 0–6 + side quests drafted. **No Architect code changed** — planning only. |
| 2026-07-09 | Decisions locked: **ft grid**, **centerline walls**, **`architect/building.json`**, **draw walls first** + **domino stepped UI**; connectors out of design. See `DECISIONS.md`. |
| 2026-07-09 | Refined: walls are **3 ft segments**; window/door are **features on a bay**; domino allows **Walls ⇄ Window ⇄ Door**. |
| 2026-07-09 | **Execute start.** Quest **0.1 done** (inventory + safe edit zones). Quest **0.2 done** (smoke checklist). Pin → **1.1**. Still no geometry code. |
| 2026-07-10 | Quest **1.1 done**. Added `architect-lattice.js` + `architect-grid-visual.js`. Wired show/hide only in enter/exit Architect. **Design `rebuildGrid` untouched.** Pin → **1.2**. |
| 2026-07-10 | **Usable slice.** Quests **1.2–2.3 + thin 3.1/4.1** landed together: building model, mesh layer, draw/chain 3 ft bays, window/door feature stamp, horizon clamp, `GET/PUT /api/projects/{id}/architect/building`, domino step buttons. Legacy kits collapsed under details. Design grid/orbit paths unchanged. |