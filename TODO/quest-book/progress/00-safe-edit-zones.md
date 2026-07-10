# Safe edit zones — Architect Mode

**Quest 0.1 complete:** 2026-07-09  
**Rule:** New Architect work is **additive and mode-gated**. Prefer new `architect-*.js` modules over growing `app.js`. Gate shared viewport/camera changes behind `architect-design-tab` / workspace mode `architect`.

---

## Inventory (touchpoints)

### Frontend — primary

| File | Role | Risk |
|------|------|------|
| `frontend/app.js` | ~285 architect refs; core block ~3817–7600 (modules, snap, library, mode enter/exit, ribbon handlers). Also hooks at transform snap (~1647), tab switch (~5308–5343, ~11574), drag (~7530+) | **High** — shared god-file. Extract new bay/domino code out; only thin hooks stay |
| `frontend/index.html` | Architect right panel (`#architect-prompt-panel`), grid/connector/preset UI, library modal | Medium — replace/hide for domino UI; don't delete Design panels |
| `frontend/styles.css` | ~104 architect rules (`.architect-*`, library, previews) from ~15993+ | Medium — add stepped-UI styles under architect selectors |
| `frontend/workspace-modes.js` | Mode `architect` + design tab `ARCHITECT` | Low if additive |
| `frontend/ribbon.js` | `ARCHITECT_CATALOG`, `ribbon-bar--architect`, `onArchitectAction` | Medium — old kit tools; hide/repurpose later, don't break SOLID ribbon |
| `frontend/gizmo-panel.js` | Status for `architectInstance` local moves | Low |

### Backend — leave alone for Ch 1–2 (segment builder is client-first)

| File | Role | When to touch |
|------|------|----------------|
| `backend/skills/architect/SKILL.md` | AI kit / connector-oriented skill | Ch 5 — rewrite toward `place_segment` / `set_feature` |
| `backend/services/design_service.py` | `architect_mode` text-to-cad path | Ch 5 — careful |
| `backend/services/cad_service.py` | Architect assembly browser filtering | Only if browser breaks |
| `backend/main.py` | mode enum includes `architect` | Avoid unless API needed |
| `backend/services/skills_service.py` | Auto-enable architect skill | Ch 5 |

### Product / PM

| Path | Role |
|------|------|
| `TODO/quest-book/` | Source of truth |
| `.cursor/projects/home-ubuntu/canvases/architect-quest-book.canvas.tsx` | Visual board |

---

## Prefer to touch (green)

- **New files:** `frontend/architect-lattice.js`, `frontend/architect-grid-visual.js` (done 1.1); next `architect-building.js`, `architect-segments.js`, `architect-domino.js`, `architect-features.js`
- `frontend/styles.css` — only `.architect-*` / `body.architect-design-tab` / app architect classes
- `frontend/index.html` — Architect panel / new domino chrome; keep Design markup
- `frontend/workspace-modes.js` — architect entry only
- `TODO/quest-book/**`
- Later: `backend/skills/architect/SKILL.md` (Ch 5)

**Persistence target:** `projects/<id>/architect/building.json` (additive folder; no Design timeline rewrite)

### Shipped (1.1)

| File | Notes |
|------|--------|
| `frontend/architect-lattice.js` | Pure 3 ft bay math |
| `frontend/architect-grid-visual.js` | Overlay group; hide on exit |
| `frontend/app.js` | Import + enter/exit `setActive` only — **`rebuildGrid` not modified** |

---

## Touch carefully (yellow)

- `frontend/app.js` — wire new modules; `enterArchitectMode` / `exitArchitectMode`; do **not** refactor unrelated Design/prompt/wiring while here
- `frontend/ribbon.js` — gate ARCHITECT catalog; SOLID/SKETCH/RIGGING untouched
- Camera / orbit / grid helpers in `app.js` — **must** branch on architect mode; Design orbit unchanged
- TransformControls drag end — existing `tryArchitectLegoSnap`; new segment snap should be parallel, mode-gated
- Project file APIs — add save/load for `architect/building.json` without changing STEP/GLB Design flows

---

## Do not casually rewrite (red)

- Design prompt composer, kernel (`backend/kernel/`), engineering panel
- Wiring simulator / focus diagram
- Auth, billing, admin, collab
- Fusion / Onshape / APS flows
- `backend/services/ai_service.py` core (until Ch 5, and then only architect branch)
- Existing connector DXF / robot-snap generation paths — **leave dormant**; new path does not call them

---

## Legacy Architect (freeze, don't delete yet)

Old kit-place, connector UI, library modal, lego snap, mm grid inputs remain until the 3 ft segment flow replaces them. Strategy:

1. Ship segment + domino **alongside** (feature-detect / step UI)
2. Hide legacy panel chrome in stepped flow
3. Remove or archive legacy only after segment path is smoke-proven

---

## Extraction agreement (Quest 0.1)

New Architect UI/geometry lives in dedicated `frontend/architect-*.js` modules. `app.js` only:

- imports + `enterArchitectMode` / tab hooks
- passes scene/camera/projectId handles
- keeps Design paths unmodified

---

## Smoke after any yellow/red touch

See [`smoke-checklist.md`](./smoke-checklist.md) (Quest 0.2).
