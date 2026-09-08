# Agent instructions — Render Studio workspace

**Read `ai-context/START-HERE.md` before doing anything else.** It is the entrypoint to this workspace's agent context: what Render Studio is, the workspace map, safety rules, and verification workflow.

Instruction playbooks (read the matching folder before the job):

- `instructions/server/` — server settings, update publishing, profile import (start with `UPDATE-DOCS.md` before posting updates)
- `instructions/actions/` — non-server action playbooks

Non-negotiables (details in `ai-context/`):

1. This is a **live production server** (systemd `render3d.service`, port 8001, real users). `frontend/` edits go live on save; there is no staging.
2. New code goes in **new modules** with thin hooks — don't grow or refactor the god-files (`frontend/app.js`, `frontend/styles.css`, `backend/main.py`) beyond minimal wiring.
3. **Cache-bust** every changed static asset (`?v=YYYYMMDD-slug`) everywhere it is referenced.
4. **Verify in a browser** (Playwright in `.venv`, server already running) before claiming UI work done.
5. Don't touch auth, billing, admin, collab, OAuth flows, `backend/kernel/`, or `backend/render3d.db` unless the task explicitly requires it.
6. Log finished work in `ai-context/worklog.md`.
7. **LOCKED — Cmd+Z after gizmo move:** never let transform undo fall through to generation/`undoTimeline()` (wipes sibling parts). Policy lives in `frontend/viewport-transform-undo.js` + `.cursor/rules/cmdz-transform-undo.mdc`. Do not "simplify" this.
8. **LOCKED — model upright orientation:** `ensureModelZUp` must stay Jul 16 axis heuristic — never footprint ±90° tipper (tips models left). Rule: `.cursor/rules/model-upright-orientation.mdc`.
9. **Local server settings** live under `data/server-config/` (gitignored). Public templates live under `server-configurations/`. Never commit local ledgers/secrets; pulling the repo must not overwrite a private server's settings.

Architect Mode work has its own source of truth: `TODO/quest-book/` (chapters, decisions, safe-edit zones, smoke checklist).
