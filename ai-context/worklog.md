# Agent worklog

Append a dated entry when you finish meaningful work. Newest first. Keep entries short: what changed, which files, anything a future agent must know.

---

## 2026-07-23 — Robot artifact gen: gripper URDF/SRDF + clearer errors

- Symptom: `Robot artifact generation failed.` on project `6b458c64` (trace `7dc9b7d7`) after CAD OK — SRDF stage failed.
- Causes: AI `gen_urdf()` empty `<inertial/>` + joints to missing `finger_*_seg0`; `gen_srdf()` returned unsupported `planning_group` and put URDF XML in `urdf` instead of a relative `.urdf` path. Author prompt in `main.py` had said “dict with xml/urdf and a planning group.”
- Fixes:
  - Author-robot prompt: inertial/geometry/tree rules; `gen_srdf` exactly `{xml, urdf}` with `urdf` = sibling path.
  - Failure message now surfaces last stderr lines (not only the generic string).
  - Rewrote gripper `gen_urdf`/`gen_srdf` (revolute at flexures, valid inertials, SRDF envelope). Regenerated `.urdf` + `.srdf` via skill_runner.
- Restarted `render3d.service`.

## 2026-07-23 — Restored missing `_running_set` (generation NameError)

- Symptom: `name '_running_set' is not defined` on prompt start (trace `7bfeacf1`, project `6b458c64`).
- Cause: commit `f7208c1` (2026-07-21 cron backup) inserted drain helpers by **replacing** `def _running_set` instead of adding beside it. Call site `_running_set(project_id).add(...)` stayed; helper gone. All later cron snapshots were identical broken copies — nothing to restore from snapshot tree.
- Fix: restored exact original from `f7208c1^`:
  `def _running_set(project_id): return _RUNNING_TRACES.setdefault(project_id, set())`
- Service restarted to load backend change.

## 2026-07-22 — Shared workspace checkboxes actually show projects

- Bug: Projects folder 📁 checkboxes looked checked, but focusing one shared workspace (e.g. “fusion render”) still scoped `/api/projects?team_id=…`, so other checked workspaces never appeared.
- Fix: always fetch `/api/projects` (all accessible); checkbox hide-list filters the browser. Focusing a workspace only sets active create/invite context.
- `workspace-browser` loads folders for every team present in the visible project list; multi-workspace view labels root “All workspaces” and tags folders with workspace name.
- Cache-bust `?v=20260722-ws-visible`.

## 2026-07-22 — Workspace invite moved to popup

- Slimmed left Workspace panel: removed inline people-picker + invite email row; replaced with a single **Invite people** button.
- New `frontend/workspace-send-invite.js` popup invites to the **current** workspace only (no workspace picker in the modal). Switch workspace from Projects first.
- Thin hooks in `app.js`; markup in `index.html`; scoped CSS appended to `styles.css`. Cache-bust `?v=20260722-ws-send-invite`.
- Existing accept-invite modal (`#workspace-invite-modal`) unchanged.

## 2026-07-21 — Quest Complete header note + tracking toggle

- Replaced bottom toast with a subtle **Quest Complete!** chip next to the profile button (`.quest-complete-note` in `.auth-widget`). Click opens Quest Book.
- Added **Quest tracking** toggle (default ON): account menu Learn section + Preferences → General. When OFF: `emitFeatureUsed` does not mark progress and does not notify (`render3d:questsEnabled:v1`).
- Files: `feature-events.js`, `index.html`, `styles.css`, thin wiring in `app.js`. Cache-bust `?v=20260721-quest-notify`.

## 2026-07-21 — Quest Book real progression (checkpoint)

Shipped the first real gameplay loop — not full instrumentation of every feature.

- New `frontend/feature-events.js`: `emitFeatureUsed`, `setQuestUser`, localStorage per user (`render3d:questProgress:v1:<userId>`), anonymous→user merge, gold toast on first complete, `render3d:quest-progress` window event. Fire-and-forget; never throws into callers.
- `frontend/quest-book.js`: reads live progress; unlock via parent node (forgiving — events still credit while locked); live refresh + node flash on complete; progress bar / tab counts real.
- Instrumented (thin hooks): Welcome (account, open book, walkthrough, first project, first generate) + `ai-generate`, `picks`, `preferences`, `render-agent`.
- CSS: toast, node flash, done links/steps, cleared-chapter tab count.
- Cache-bust: `styles.css?v=20260721-quest-progress`, `quest-book.js` / `feature-events.js` / `render-agent.js` / `show-me-tour.js` imports.

**Still deferred:** backend persistence/analytics, instrumenting remaining ~25 DOC_FEATURES, CI tour smoke suite.

## 2026-07-20 — ai-context folder created

- Created `ai-context/` (this folder): START-HERE, workspace-map, conventions-and-safety, verify-and-test, help-system, quest-book-roadmap, worklog. Added root `AGENTS.md` pointing here so agents pick it up automatically.
- Context captured from the docs/quest-book exploration session: help-system architecture, two-quest-books distinction, live-server + cache-busting + additive-module conventions.

## 2026-07-19 — Product Quest Book shipped (visual stage)

- Finished the Quest Book modal begun in a disconnected session: added the full modal CSS block to `frontend/styles.css`.
- Fixed first-node tooltip clipping; gold menu button + Studio walkthrough already landed.
- Plan `.cursor/plans/quest_book_menu_entry_b3ec02ac.plan.md` marked complete.
