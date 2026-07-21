# Agent instructions — Render3D workspace

**Read `ai-context/START-HERE.md` before doing anything else.** It is the entrypoint to this workspace's agent context: what Render3D is, the workspace map, safety rules, and verification workflow.

Non-negotiables (details in `ai-context/`):

1. This is a **live production server** (systemd `render3d.service`, port 8001, real users). `frontend/` edits go live on save; there is no staging.
2. New code goes in **new modules** with thin hooks — don't grow or refactor the god-files (`frontend/app.js`, `frontend/styles.css`, `backend/main.py`) beyond minimal wiring.
3. **Cache-bust** every changed static asset (`?v=YYYYMMDD-slug`) everywhere it is referenced.
4. **Verify in a browser** (Playwright in `.venv`, server already running) before claiming UI work done.
5. Don't touch auth, billing, admin, collab, OAuth flows, `backend/kernel/`, or `backend/render3d.db` unless the task explicitly requires it.
6. Log finished work in `ai-context/worklog.md`.

Architect Mode work has its own source of truth: `TODO/quest-book/` (chapters, decisions, safe-edit zones, smoke checklist).
