# Workspace map

Where things live and which files are load-bearing. Line counts are approximate (July 2026) — they matter because the big files are edit hazards.

## Frontend (`frontend/`) — vanilla JS modules, no build step

Served statically by FastAPI. Every save is instantly live for users (subject to browser cache — see cache-busting in [conventions-and-safety.md](./conventions-and-safety.md)).

### Core shell (high risk to edit)

| File | ~Lines | Role |
|------|--------|------|
| `app.js` | 29,600 | Boot, viewport, project explorer, AI panel, menus, and wiring of nearly everything. Add thin hooks only; put new logic in new modules. |
| `styles.css` | 37,700 | All styles. Append new scoped blocks; never reflow existing rules. |
| `index.html` | 2,700 | Studio markup: header, user menu, panels, modals. |
| `backend/main.py` | 19,200 | All API routes. |

### Feature modules (the pattern to follow — one file per feature, lazy-imported)

- `quest-book.js` — Quest Book modal (chapters from `docs-features.js`)
- `show-me-tour.js` — live guided tours (spotlight steps)
- `render-agent.js` — floating help agent
- `docs-features.js` — **canonical feature catalog** (DOC_CATEGORIES + DOC_FEATURES); feeds docs, getting started, quest book, agent
- `getting-started-guides.js`, `getting-started-tips.js`, `docs-catalog.js` — help content
- `architect-*.js` — Architect Mode modules (lattice, building, camera, draw, ...)
- `wiring*.js` / `driver-picker.js` / `electronics-suggestions.js` — wiring sim
- `sketch-mode.js` (constrained sketch), `canvas-mode.js` (freehand pad)
- `auth.js`, `collab.js`, `workspace-modes.js`, `ribbon.js`, `feature-editor.js`
- `client-reload.js` — update-detection banner (never auto-reloads users)

### Pages

`index.html` (Studio) · `docs.html` · `getting-started.html` · `updates.html` · `roadmap.html` · `skills.html` · `marketplace.html` · `agent-store.html` · `admin-dashboard.html` · `agent-chat.html` · `privacy.html`

### Assets

- `docs/media/` — demo GIFs for docs/guides (recorded via `scripts/gif-demos/`)
- `docs/updates/` — milestones.js, shipped.json, social post drafts
- `assets/onboarding/` — email demo GIFs

## Backend (`backend/`)

| Path | Role |
|------|------|
| `main.py` | FastAPI routes (all of them) |
| `services/` | ~40 domain services: `ai_service.py` (AI orchestration — red zone), `cad_service.py`, `design_service.py`, `generation_service.py`, `auth`-adjacent, `onboarding_email_service.py`, `getting_started_guides.py`, marketplace/payments, discord/linkedin updates, ... |
| `kernel/` | build123d/OpenCASCADE parametric kernel + STEP/STL/GLB export (red zone) |
| `engineering/` | enclosures, gears generators |
| `physics/` | mass/inertia, joints, sim.json/URDF export |
| `dfm/` | wall thickness / manufacturability checks |
| `specs/` | real-hardware spec YAMLs (e.g. `raspberry_pi_pico_2.yaml`) |
| `skills/` | agent skills with reference docs (CAD, URDF, bambu-labs, architect, ...) |
| `render3d.db` | SQLite database — **live user data, do not touch directly** |

## Operations

| Path | Role |
|------|------|
| `run.py` | Dev entry; **prod runs via systemd `render3d.service`** (uvicorn, port 8001, 2 workers) |
| `scripts/backup-code.sh` | Rolling validated snapshots → `backups/snapshots/` (cron: every 30 min) |
| `scripts/backup-daily.sh` | Daily Drive backup (cron: 3am) |
| `scripts/cleanup-stale-render3d-processes.sh` | Stale process guard (cron: every 5 min) |
| `scripts/gif-demos/` | Playwright GIF recorders for docs demos |
| `scripts/ship-update.py`, `create-social-update-posts.py`, `notify-discord-update.py`, `linkedin-scheduled-post.py` | Release/update publishing pipeline (LinkedIn poster runs hourly via cron) |
| `milestones/` | Golden frontend snapshots (`LATEST/`, `v1/`) |
| `backups/` | snapshots / latest / golden / quarantine |
| `deploy/`, `services/` (root) | Deployment artifacts |
| `integrations/` | Third-party CAD/robotics/cloud connectors (DiMOS, Fusion bridge, MoveIt2, OAuth setup docs). Install via `python integrations/install.py`. See `integrations/README.md`. |
| `fusion360-plugin/`, `tools/moveit2_server/`, `services/premium-agent-service/` | Compatibility stubs → `integrations/` |


## PM / planning

| Path | Role |
|------|------|
| `TODO/quest-book/` | Architect Mode quest book: `README.md`, `BOOK.md`, `DECISIONS.md`, `chapters/00–06`, `side-quests/`, `progress/` (log, safe-edit zones, smoke checklist) |
| `.cursor/plans/` | Session plan files |
| `ai-context/` | This folder — agent context |

## Things to ignore

- `tmp_jake_text_to_cad/` — separate fork/experiment, not the product
- `myenv/`, `snap/`, `tmp-screenshots/`, `inbox/`, `images/` — scratch/system
- `backups/`, `milestones/` — read-only reference, never edit in place
