# Safe edit zones (draft — fill in during Quest 0.1)

## Prefer to touch (Architect-scoped)

- `frontend/` new `architect-*.js` modules (to be created)
- `frontend/index.html` — architect panel / mode-only chrome
- `frontend/styles.css` — selectors under `.architect-design-tab` / architect classes
- `frontend/workspace-modes.js` — architect mode wiring only
- `backend/skills/architect/` — skill text for AI ops later
- `TODO/quest-book/` — this book

## Touch carefully (shared)

- `frontend/app.js` — huge; prefer extracting architect helpers out when changing behavior
- Camera / controls — gate behind architect mode checks
- Project persistence — additive files/fields only

## Do not casually rewrite

- Design mode prompt / kernel / engineering panels
- Wiring simulator
- Auth, billing, admin
- Fusion / Onshape flows

## Smoke after shared changes

See `smoke-checklist.md` (Quest 0.2).
