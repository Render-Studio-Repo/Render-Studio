# Architect Quest Book

> Product management for **Architect Mode** — written like an FTB Quests / BetterQuesting book, tracked like a real build plan.

This folder is the source of truth for *what we build next* in Architect Mode. The live visual board lives in the Cursor canvas:

**[Architect Quest Book](../../.cursor/projects/home-ubuntu/canvases/architect-quest-book.canvas.tsx)**

## How to use this book

| Role | What you do |
|------|-------------|
| **Player** (builder) | Pick the next unlocked Main Quest. Mark it `in_progress` → `done`. |
| **Quest Master** (PM / you) | Add quests, move items to Side Quests, rewrite acceptance criteria. |
| **AI companion** | Follow chapter order. Never start a locked quest. Never break Design / Wiring / Engineering modes. |

### Status legend

| Status | Meaning |
|--------|---------|
| `locked` | Dependencies not done — do not start |
| `available` | Ready to pick up |
| `in_progress` | Actively being built |
| `done` | Acceptance criteria met |
| `side_quest` | Backlog — good eventually, not on the critical path |

### Safety rule (the golden leash)

Architect Mode changes must be **additive and mode-gated**. Existing Design, Wiring, Engineering, Fusion, and prompt flows stay intact. Prefer new modules / CSS under architect-only selectors over rewriting shared viewport code.

## Folder map

```
TODO/quest-book/
  README.md                 ← you are here
  BOOK.md                   ← story + north star
  chapters/                 ← main quest line (ordered)
  side-quests/              ← backlog / nice-to-haves
  progress/                 ← checkmarks + notes as we go
```

## Chapter order (critical path)

1. **Ch 0 — Do No Harm** — isolate Architect Mode
2. **Ch 1 — Floor Plan Realm** — **3 ft bay** lattice + one-level camera
3. **Ch 2 — Raise the Walls** — place/chain blank 3 ft segments · `building.json`
4. **Ch 3 — Domino Desk** — Level → Walls ⇄ Window ⇄ Door → Review
5. **Ch 4 — Features** — window/door snap onto a whole 3 ft segment
6. **Ch 5 — AI Drafter** — same segment/feature ops
7. **Ch 6 — Split Sight** — optional polish

Locked calls: [`DECISIONS.md`](./DECISIONS.md). Side Quests never block.

## Making the quest book itself fun

Building *this* book is also a quest line — see `chapters/00-do-no-harm.md` (Quest Book UX) and `side-quests/quest-book-polish.md`. We want chapter art, dependency lines, pinned quests, and a "claim reward" feel when a chapter closes — without turning PM into a second product.
