# Agent worklog

Append a dated entry when you finish meaningful work. Newest first. Keep entries short: what changed, which files, anything a future agent must know.

---

## 2026-07-24 — Golden snapshot: working production

- Code-only golden: `backups/golden/golden-working-production-20260724T151815Z/` (~138 MB).
- Drive folder `golden-working-production-20260724T151815Z` (ID `1ilEKdoBGIMd5e3c7aMjvWySNbh4yzr2V`); protected from prune via `golden-` prefix.
- Git HEAD `1bcfac51578eae013c203414679458a2225d1e2d`.

## 2026-07-24 — Pick tools missing until tab click after refresh

- Cause: `solid-design-tab` applied before ribbon mount (or skipped), so `#ribbon-pick-host` stayed `display:none` until another design tab click.
- Fix: re-force design tab after `createRibbon`; ribbon boot fallback adds `solid-design-tab`; CSS shows Pick in Design even without a class yet. `?v=20260724-pick-boot`.

## 2026-07-24 — Pick bar in Create row + catalog suggestions + sketch D

- Pick tools centered in the ribbon Create row for SOLID / SKETCH / RIGGING / ROBOTICS (was stuck hidden: default SOLID tab never applied `solid-design-tab`).
- New project / Upload stay far right (`toolbar-actions { margin-left: auto }`).
- Catalog shows suggestion chips before typing; Sketch **D** while drawing opens a Fusion-style distance popover.
- Cache-bust: `?v=20260724-pick-row2`, `catalog-suggest2`, `sketch-d2`, `styles …pick-catalog-d2`.

## 2026-07-24 — Docs → Getting Started + unique GIFs + laptop layout

- Studio **Docs** nav → `/getting-started.html` (was `/docs.html`).
- Each Getting Started section now has its own GIF (was reusing ai-generate/picks/canvas/select-object). Added `multi-gen`, `link-to-prompt`, `solid-tools`, `sketch`, `rigging-urdf`; synced backend guides (`?v=20260724-unique`).
- MacBook/laptop layout: earlier breakpoints + container queries so TOC/features don’t scrunch (`?v=20260724-gs-layout`).

## 2026-07-24 — Fix Components hierarchy row layout

- Bug: eye / ⓘ / name stacked vertically (name btn `width:100%` + flex-wrap).
- Fix: row order eye → ⓘ → name; override width so name flexes; ellipsis + `title` for full name on hover (components + bodies).
- Files: `frontend/workspace-browser.js`, `frontend/styles.css`; cache-bust `?v=20260724-hierarchy-row`.

## 2026-07-23 — Invited workspace projects → shared folder

- Problem: accepting a workspace invite dumped that team's root projects into the invitee's personal Projects root (Vineet had 1 personal + ~60 Render3D models mixed).
- Fix: `list_projects` nests non-personal root projects under virtual `__shared_ws_{teamId}` named "{Team} shared workspace". Real subfolders unchanged. Browser treats them as virtual/read-only.
- Files: `backend/main.py`, `frontend/workspace-browser.js`, cache-bust `?v=20260723-shared-ws-folder`.

## 2026-07-23 — Fix AI usage sparkline overflow

- Cost bars were scaled to 42px inside a 28px chart (clipped/overflow). Chart restored to 40px; bar heights capped to fit; overflow hidden. Cache-bust `?v=20260723-cost-bars`.

## 2026-07-23 — Right panel tabs: 2 rows, tighter chrome

- Right tabs forced to a 3-column / 2-row grid (was wrapping to 3 rows).
- Pulled tabs up (less top padding/margin); slimmer AI usage thumb (shorter chart/padding).
- Cache-bust `styles.css?v=20260723-right-tabs-2row`.

## 2026-07-23 — Share links respect unhidden models only

- Bug: share saved visibility lists but the public viewer still loaded the full catalog.
- Fix: bake visible-only `_share_visible_*.glb` at create; filter allow-list + browser tree; expose visibility on `/api/share/{token}`; share-viewer filters parts (`?v=20260723-share-visible`).

## 2026-07-23 — Better robot floor + rotate without explode

- Robotics work cells: real concrete/epoxy slab texture (painted aisle tape), not floating yellow bars.
- Exploded ▾ menu: **Rotate off** / **Rotate model** (assembled, no explode) / **Rotate exploded**. Cache-bust `?v=20260723-orbit-floor`.

## 2026-07-23 — Fix: robotic work-cell props polluted Design viewport

- Bug: `robotic-simulator.js` applied shop-floor boxes/lanes on boot into the main Three.js scene.
- Fix: never inject on bind; default env `empty`; always clear on leave; sweep leftover `isRobotSimEnvironment` nodes. Cache-bust `?v=20260723-robot-sim-fix`.

## 2026-07-23 — Robotic Simulator tab (next to Electronics)

- Design/Wiring tab **ROBOTICS** + right panel: catalog arms, URDF/SRDF upload, work-cell environments, play cycle / joint playground.
- New `frontend/robotic-simulator.js`; upload accepts `.urdf`/`.srdf` in `POST /upload`. Cache-bust `?v=20260723-robot-sim`.

## 2026-07-23 — Link preview title → AI & Robotics Studio

- Updated `frontend/index.html` `<title>`, `og:title`, `twitter:title`, and descriptions to **Render3D — The AI & Robotics Studio** (was “AI Product Studio”).

## 2026-07-23 — Viewport high-quality video record control

- Added video camera icon next to Screenshot in the viewport view bar.
- ▾ opens settings: quality (Standard/High/Ultra), fps (30/60), optional mic; main click starts/stops recording.
- New `frontend/viewport-video-record.js` (canvas.captureStream + MediaRecorder WebM). Cache-bust `?v=20260723-video-rec`.

## 2026-07-23 — Quest tracking moved to Preferences → Advanced

- Removed Quest tracking toggle from the account Learn menu and General preferences.
- Now lives under Preferences → Advanced → Viewport (still ON by default).
- Cache-bust `app.js?v=20260723-quest-pref`.

## 2026-07-23 — Workspaces menu: drop All, nicer checks, auto-show on accept

- Removed **All workspaces** focus row from the Projects workspaces menu (and retired `__all__` as default/saved focus).
- Personal + shared workspaces each get a visibility checkbox; custom orange check UI (not native blue).
- Accepting a workspace invite marks it visible, selects it as active, and refreshes Projects.
- Cache-bust `?v=20260723-ws-checks`.

## 2026-07-23 — Components tree: Bodies for assemblies + less indent

- Top gripper (`Fully_Assembled…`) had no Bodies: `/bodies` called `load_mesh` first on a 14MB GLB and hung; also a spurious `*.part.step` stole primary. Scene parse already had 16 parts.
- Fix: GLB `/bodies` prefers `scene_body_info` first; `list_browser_tree` nests viewer-scene Bodies when no `__part_` sidecars; hide `foo.part.step` when `foo` exists.
- UI: nest Bodies under the component row (header above parts); tighten `.proj-hierarchy` left indent so names fill the panel. Cache-bust `?v=20260723-bodies-indent`.

## 2026-07-23 — Right-click share project with teammate

- Feature: project owner right-clicks a project → **Share with teammate…** → appears in recipient’s files with a **Shared** tag; recipient right-clicks → **Remove from my folder**.
- Backend: `project_shares` + `project_hidden` tables; `backend/services/project_shares_service.py`; routes `GET/POST /api/projects/{id}/shares`, `DELETE .../shares/me`, `DELETE .../shares/{user_id}`; `can_access_project` honors shares; list injects/tags shared projects and filters hidden.
- Frontend: new `frontend/project-share.js`; context menu + Shared tag in `workspace-browser.js`; thin realtime hooks in `app.js`. Cache-bust `?v=20260723-proj-share`.
- Target must already be on the project’s workspace (invite first if not).

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
