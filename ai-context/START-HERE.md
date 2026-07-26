# START HERE — AI agent context for Render3D

> **Point of this folder:** `ai-context/` is the shared memory for AI agents working in this workspace. Read this file first in every new conversation. It tells you what we're building, how the workspace is laid out, how to verify your work, and how not to break a **live server with real users**.

---

## 1. What this is

**Render3D** is an AI-first CAD platform ("ForgeCAD-inspired"): natural-language CAD generation, a 3D viewport, solid modeling, constrained sketch, wiring/electronics simulation, rigging/URDF, Fusion 360 / Onshape cloud sync, an Architect (building) mode, a parts marketplace, and a full in-app help system. Frontend is vanilla JS modules (no framework, no bundler); backend is FastAPI + Python.

**Critical fact: this is a LIVE production server.**

- systemd service `render3d.service` runs `uvicorn backend.main:app` on `0.0.0.0:8001` (2 workers).
- Real users are on it (onboarding emails, Discord/LinkedIn update posts, admin dashboards are all wired to real accounts).
- Frontend files in `frontend/` are served statically — **your edits go live the moment you save.** There is no build step and no staging environment.
- Backend `.py` changes require a service restart (`sudo systemctl restart render3d`) — don't restart casually; in-flight generations die.
- `frontend/client-reload.js` polls for version changes and offers users a refresh banner (never auto-reloads).

## 2. Read next (in this folder)

| Doc | When to read |
|-----|--------------|
| [workspace-map.md](./workspace-map.md) | Before exploring — where everything lives |
| [conventions-and-safety.md](./conventions-and-safety.md) | **Before editing anything** — how not to break things |
| [verify-and-test.md](./verify-and-test.md) | Before claiming work is done — how to verify |
| [help-system.md](./help-system.md) | When touching docs, guides, tours, Quest Book, Render Agent |
| [quest-book-roadmap.md](./quest-book-roadmap.md) | Quest Book state, next stages, and dev use cases |
| [worklog.md](./worklog.md) | Recent agent work — check before redoing something |

Also load-bearing, outside this folder:

- `TODO/quest-book/` — internal PM "quest book" for **Architect Mode** (chapters, decisions, safe-edit zones, smoke checklist). Source of truth for Architect work.
- `TODO/quest-book/progress/00-safe-edit-zones.md` — green/yellow/red file zones for Architect Mode; the general philosophy applies everywhere.
- `.cursor/plans/` — plan files from past sessions (e.g. `quest_book_menu_entry_*`, `render3d_engineering_foundation_*`).

## 3. The golden rules

1. **Additive and gated.** New features go in new files/modules, wired with thin hooks. Don't refactor shared code you weren't asked to touch. This codebase has god-files (`app.js` ~29.6k lines, `styles.css` ~37.7k lines, `backend/main.py` ~19.2k lines) — surgical edits only.
2. **Don't break Design mode.** The core prompt-→-CAD flow (Design workspace, AI compose panel, viewport, timeline) is the product. Every other mode (Architect, Wiring, Fusion) is layered on top and must not regress it.
3. **Cache-bust everything you change.** Static assets are referenced with `?v=YYYYMMDD-slug` params (in `index.html` for CSS, in `import(...)` calls for lazy JS). If you change a file, bump every reference's version or users keep the stale cached copy.
4. **Verify in a real browser before claiming done.** Playwright is in `.venv`; the server is already running on `127.0.0.1:8001`. Screenshot your work. See [verify-and-test.md](./verify-and-test.md).
5. **Don't rewrite red zones casually:** auth/billing/admin, collab, Fusion/Onshape/APS OAuth flows, the CAD kernel (`backend/kernel/`), wiring simulator, `ai_service.py` core. If a task requires touching them, make the smallest possible change.
6. **LOCKED — Cmd+Z after gizmo move** must never fall through to generation timeline undo (wipes sibling parts). Policy: `frontend/viewport-transform-undo.js` + `.cursor/rules/cmdz-transform-undo.mdc`.
7. **LOCKED — model upright orientation:** Jul 16 axis heuristic only — never footprint ±90° tipper and never Mode 2.0 forced ±90° (Jake already Z-up). Rule: `.cursor/rules/model-upright-orientation.mdc`.
8. **Backups exist but aren't an excuse.** Cron snapshots every 30 min to `backups/snapshots/` (validated; broken states quarantined), daily to Drive. `milestones/` holds golden frontend snapshots.
9. **Update this folder.** When you finish meaningful work, append a dated entry to [worklog.md](./worklog.md). If you learn a workspace fact future agents need, add it to the right doc here.

## 4. Quick orientation

```text
/home/ubuntu                  ← workspace root = the app (not a git repo)
├── frontend/                 ← static JS/HTML/CSS, served directly by FastAPI
│   ├── index.html            ← the Studio (main app shell)
│   ├── app.js                ← god-file: boot, viewport, panels, wiring of everything
│   ├── styles.css            ← god-file: all styles
│   └── <feature>.js          ← one module per feature (lazy-imported where possible)
├── backend/                  ← FastAPI app
│   ├── main.py               ← routes god-file
│   ├── services/             ← one service per domain (ai, cad, auth, email, ...)
│   ├── kernel/               ← build123d/OCCT parametric CAD kernel
│   ├── engineering/ physics/ dfm/ specs/  ← engineering pipeline
│   └── skills/               ← agent skill definitions (CAD, URDF, bambu, ...)
├── TODO/quest-book/          ← Architect Mode PM book (chapters, decisions, smoke)
├── ai-context/               ← YOU ARE HERE
├── scripts/                  ← backups, GIF recorders, social posts, ops
├── milestones/, backups/     ← snapshots
└── run.py                    ← dev entry (prod runs via systemd)
```

## 5. What we're building right now

Two active threads (see [worklog.md](./worklog.md) for latest):

1. **Quest Book** — a gamified, FTB-Quests-style learning map in the Studio (account menu → Learn → gold Quest Book button). Visual structure is done; next stage is real progression via a feature-usage event bus. See [quest-book-roadmap.md](./quest-book-roadmap.md).
2. **Architect Mode rebuild** — 3 ft bay lattice wall builder, chapters tracked in `TODO/quest-book/`. Chapters 1–2 done, 3–6 locked.

Longer-term foundation already landed: parametric B-rep kernel (build123d/OpenCASCADE), spec library, gear/enclosure generators, physics/sim metadata (see `.cursor/plans/render3d_engineering_foundation_a82b9212.plan.md`).
