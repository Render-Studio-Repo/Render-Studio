## 2026-07-24 — Mesh mode: Stop generating control

- Mesh runs had no obvious Stop (Generate stayed in the compose row; canvas banner had no cancel).
- Stop now replaces Generate while a single Mesh job runs; canvas banner has **Stop generating**; watch starts before Improve so cancel works during spice-up. GLB export subprocess is killable on cancel.
- Canceled stuck bike Mesh job on `4162ee20`. Cache-bust: `app.js` / `styles.css` `?v=20260724-mesh-stop`. Service restarted.

---

## 2026-07-24 — Mesh mode replaces Fusion prompt tab (img2threejs)

- Prompt Fusion tab → **Mesh**: AI writes a Three.js factory (`.mesh.mjs`), headless Node `export_glb.mjs` → GLB, same generation reload path as Jake text-to-CAD.
- Skill vendored at `backend/skills/img2threejs/` with Node FileReader/`onloadend` shims for GLTFExporter.
- Frontend: Mesh button + tips; legacy Fusion prompt target disabled; images stay as references (no DXF convert) in Mesh mode.
- Cache-bust: `app.js` / `styles.css` `?v=20260724-mesh-mode`. Service restarted.

---

- Management download + studio export + share menus listed multiple STEPs (assembly / faceted / part); linked assemblies break Extrude/Cut.
- Backend `list_exports_for_model` / visible-assembly bake now expose **one** STEP via `ensure_fusion_part_step`. Downloads use `?step_mode=part` and a clean `.step` filename. Admin modal defaults to that STEP.
- Cache-bust: `app.js` / `file-actions.js` / `admin-dashboard.js` / `share-viewer.js` `?v=20260724-one-step`. Service restarted.

---

## 2026-07-24 — Admin project cards: long filenames overflow

- Long `model_file` pills used `white-space: nowrap` and spilled past the card border (e.g. Food Robot / connector `.glb`).
- Removed redundant filename pill from stats; filename stays on the muted line. Cards/stats now clip with ellipsis and `overflow: hidden`.
- Cache-bust: `admin-dashboard.html` → `styles.css` / `admin-dashboard.js` `?v=20260724-admin-card-clip`.

---

## 2026-07-24 — Export: viewport truth + Part/Assembly chooser back

- Latest bad push (`23:36`) hit `arduino_uno_q.glb/exports` while Fully_Assembled was on screen — `selectedFile` / eye state overrode the viewport; no allow-list.
- Ribbon Export now prefers **viewport-visible** meshes, demotes `selectedFile`, and always bakes when the project has multiple model files. Fusion asks **Part vs Assembly** again (`step_mode`); Part flattens for Extrude/Cut, Assembly keeps linked STEP. Backend no longer falls back to `latest_model_file` when filename is missing.
- Cache-bust: `app.js` / `file-actions.js` `?v=20260724-viewport-export`. Service restarted.

---

## 2026-07-24 — Fusion export used hidden file name (arduino)

- Symptom: Export → Fusion still created/replaced `arduino_uno_q.step` while the gripper was the only visible component.
- Fix: Export always sends `name` = visible stem (e.g. `Fully_Assembled_….step`) plus `allowed_filenames`. Bake bytes (`_export_visible_assembly`) stay the payload; Fusion **item name** is the visible part. Backend renames bake uploads and rejects/overrides destination names outside the visible allow-list; skips companion `.py` for bake (was also naming Arduino).
- Cache-bust: `app.js` / `file-actions.js` `?v=20260724-fusion-name`. Service restarted.

---

## 2026-07-24 — STEP export: Fusion Part for Extrude/Cut

- Gripper native `.step` is a **linked assembly** (16× `NEXT_ASSEMBLY_USAGE`) → Fusion Extrude Cut fails. `.part.step` / flattened bake has 18 solids and 0 assembly links.
- Download + Fusion push now prefer/ensure `*.part.step` via `ensure_fusion_part_step` (clean download name `.step`). Export menu labels/sorts **Fusion Part · Extrude/Cut** first and demotes linked assemblies.
- Cache-bust: `app.js` / `file-actions.js` `?v=20260724-step-part`. Service restarted.

---

## 2026-07-24 — Export still sent Arduino: Base stem collision

- Root cause: hiding Two-finger stored body label `Base`; `isBrowserComponentHidden` stem-matched that onto Fully_Assembled (same STEP product name `base`), so Export treated the gripper as hidden and opened `arduino_uno_q` (`latest_file`).
- Fix: eye-icon visibility is exact file keys only (no cross-component body-name stems). With any hidden siblings, Export always bakes `_export_visible_assembly` from unhidden top-level components; Fusion push sends `allowed_filenames` and backend refuses off-list uploads.
- Verified bake of Fully_Assembled only: editable B-rep, 12 solids, 0 assembly links, no arduino. Compared Jul16 golden — native STEP path unchanged for this solid. Service restarted.
- Cache-bust: `app.js` / `file-actions.js` `?v=20260724-visible-eye`.

---

## 2026-07-24 — Pick bar sits on ribbon bottom border

- Ribbon `.ribbon-pick-host` was vertically centered (`top: 50%` + translate). Anchored to `bottom: 0` so the Pick strip sits on the grey ribbon/viewport divider; bottom corners squared to meet the line.
- Cache-bust: `ribbon.css?v=20260724-pick-bar-bottom`.

---

## 2026-07-24 — Fusion “Uploading…” hang: Replace dialog clipped

- After a file already existed in the Fusion folder, export set “Uploading…” then showed Replace/Create **below** the picker. Picker has `overflow:hidden`, so the dialog was clipped and the request never started.
- Conflict UI is now an overlay on the picker; status asks for Replace/Create until upload actually begins.
- Cache-bust: `app.js` / `file-actions.js` / `styles.css` `?v=20260724-fusion-conflict-overlay`.

---

## 2026-07-24 — Chat unread badge: don’t cover “Chat”

- Unread badge sat on the Chat label. Moved to the corner with `transform: translate(45%, -45%)`, extra right padding, and a panel ring so “Chat” stays clear (0 overlap verified).
- Cache-bust: `styles.css?v=20260724-chat-badge2`.

---

## 2026-07-24 — Admin Recent Projects: un-scrunch left column

- Project cards used a 3-column grid (thumb + text + View model) inside a narrow left pane, so labels wrapped one word per line and overlapped.
- Cards are now thumb + text, with **View model** under the text; left pane gets `minmax(320px, …)`.
- Cache-bust: `admin-dashboard.html` `styles.css?v=20260724-admin-proj-layout`.

---

## 2026-07-24 — Fusion Extrude Cut: flatten assembly STEP → Part

- Fusion error **“No target body found to cut or intersect”** = STEP has `NEXT_ASSEMBLY_USAGE` (linked assembly). Solids were fine; hierarchy blocked Cut.
- Fusion push + STEP download now flatten editable B-rep assemblies via `export_step_as_single_part` (keeps `MANIFOLD_SOLID_BREP`, clears assembly links). Visible-assembly bake writes the same Part-style STEP.
- Verified on shelf/box project STEP: solids 3→3, assembly markers 3→0. Service restarted.

---

## 2026-07-24 — Export visible: don’t upload hidden siblings (Arduino)

- Bug: Fusion cloud push fell back to any editable STEP in the project, so hiding Fully_Assembled still uploaded `arduino_uno_q.step`.
- Fix: visible-assembly bake writes `_export_visible_assembly.step` from **only** unhidden filenames; Fusion uses that file only (never unrelated B-rep). `_step_for_cloud_cad` won’t remap visible-assembly to another model.
- Export button no longer falls back to `latest_file` / hidden selection.
- Cache-bust: `?v=20260724-visible-export`. Service restarted.

---

## 2026-07-24 — Fusion export: replace vs new + thumbnails

- If the destination folder already has the same filename, ask **Replace** (new version) or **Create new file** (`name (2).step`).
- Folder picker lists existing files; after upload, kick off Model Derivative so Fusion Data Panel can generate a real preview (not the gray cube forever).
- Cache-bust: `?v=20260724-fusion-conflict`. Service restarted.

---

## 2026-07-24 — Fusion chooser: Shared only with a file

- **Shared Fusion folder/link** only when a STEP/3MF is available to upload; **Update original** only when `autodesk_source.item_id` exists.
- Single action skips the chooser and runs directly (no lone Shared card).
- Cache-bust: `?v=20260724-fusion-opt`.

---

## 2026-07-24 — Fusion export: restore Jul 16 / pre-Jul19 working path

- Break introduced **Jul 19** (`3fc6c13`): Part/Assembly chooser + `export_step_as_single_part`. Jul 16–17 goldens and commit `a17400c` never sent `step_mode`.
- Restored that push body (`filename` + `allow_faceted_step` only); no Part chooser; folder picker opens when no mirror folder linked (avoids stuck “Link a Fusion mirror folder” retry).
- Backend: `upload_source` defaults to True again (Jul 16). Kept folder-grid / export-here / toast auto-dismiss UX.
- Cache-bust: `?v=20260724-fusion-jul16`. Service restarted.

---

## 2026-07-24 — Fusion export error toast auto-dismiss

- Error cards (incl. “Link a Fusion mirror folder…”) fade in and auto-dismiss ~4s — no stuck Retry loop.
- Missing-folder push opens the Fusion folder picker after a short toast instead of Retry.
- Cache-bust: `?v=20260724-fusion-toast`.

---

## 2026-07-24 — STEP download: restore native B-rep (no Part rewrite)

- Same bug as Fusion push: `?step_mode=part|regular` ran `export_step_as_single_part` in `_file_response`, breaking Extrude/Cut.
- Jul 16 golden served the on-disk solid STEP as-is (no rewrite). Removed that rewrite from downloads; studio STEP click downloads the native file (no Part/Assembly chooser).
- Cache-bust: `?v=20260724-step-native`. Service restarted.

---

## 2026-07-24 — Fusion B-rep Cut: restore Jul 16 native STEP push

- Root cause: Fusion export offered **Part** first and backend ran `export_step_as_single_part`, which broke Extrude/Cut. Jul 16 golden (`golden-working-code-20260716T231304Z`) never sent `step_mode` / never rewrote STEP.
- Fix: Fusion cloud push always uploads **native solid B-rep** (`assembly` only). Removed Part/Assembly chooser for Fusion; backend ignores legacy `step_mode=part` on `/push-to-autodesk`.
- UI title: **Export to Fusion 360 · Solid B-rep**. Cache-bust: `?v=20260724-brep-native`. Service restarted.
- Local STEP download Part rewrite (`_file_response`) left as-is — Fusion path only.

---

## 2026-07-24 — Fusion export: green check on success

- **Export to Fusion · {folder}** turns green with **Exported ✓** after a successful upload (same for the bottom submit + matching folder tile).
- Cache-bust: `?v=20260724-fusion-check`.

---

## 2026-07-24 — Fusion export: upload to current folder

- Inside a Fusion folder (e.g. Render3D) there is a primary **Export to Fusion · {folder}** button — no subfolder required.
- Folder tiles use **Export** (one-click upload there). Bottom submit label shows the destination folder name.
- Cache-bust: `file-actions.js` / `styles.css` `?v=20260724-fusion-export-here`.

---

## 2026-07-24 — Restore working B-rep export/Fusion from backup

- Afternoon Part-mode forcing rewrote native STEPs through `export_step_as_single_part`, which broke Fusion editability (“all B-rep messed up”).
- Restored `file-actions.js` + `admin-dashboard.js` from snapshot `20260724T150001Z-cron` (pre-break), then re-applied only the nested Fusion folder grid.
- Exports/Fusion again ship **native editable B-rep** by default (assembly); Part rewrite only when `step_kind` is unknown / user explicitly picks Part.
- Admin download prefers editable B-rep over `*__faceted.step` without rewriting solids.
- Cache-bust: `?v=20260724-brep-restore`.

---

## 2026-07-24 — Fusion/STEP: Part mode for editable solids

- Assembly STEPs open in Fusion as linked components (hard to edit). Downloads + Fusion export now prefer **Part** (one design, solid bodies, no `NEXT_ASSEMBLY_USAGE`).
- Studio STEP download always asks Part vs Assembly (Part recommended). Admin defaults to `?step_mode=part` and labels options clearly.
- Cache-bust: `file-actions.js` / `admin-dashboard.js` `?v=20260724-fusion-part-edit`.
- Note: STEP never carries build123d parameter history into Fusion — edit via Press Pull / Extrude Cut on solids.

---

## 2026-07-24 — Admin STEP download: keep parametric B-rep

- Admin project modal download collapsed all STEPs into one format slot; `*__faceted.step` often won, so downloads lost solid/parametric B-rep (labels/bodies).
- Now keeps both variants, labels them (`parametric B-rep` vs `faceted mesh`), and defaults to editable B-rep.
- Files: `frontend/admin-dashboard.js`, `admin-dashboard.html` (`?v=20260724-admin-step-brep`).

---

## 2026-07-24 — Fusion export: nested folder grid picker

- Export → Fusion folder browser is now a **2-column tile grid**; click a tile to open nested folders (e.g. Project Files → Render3D → …).
- **Export here** selects the current folder; breadcrumbs + Back for navigation; last nested path remembered.
- Cache-bust: `file-actions.js?v=20260724-fusion-folder-grid`, `styles.css?v=20260724-fusion-folder-grid`, `app.js` import bump.

---

## 2026-07-24 — Part names: product noun, not “fully assembled CAD”

- Spice-improved prompts often started with CAD boilerplate, so STEP/Fusion file + `model_label` became `Parametric Fully Assembled CAD…`.
- `title_from_prompt` / `file_stem_from_prompt` now strip that jargon and prefer `Gripper - Robot Arm`-style names; colon openings (`Parallel gripper: …`) keep the product name.
- Improve-prompt + CAD brief / authoring guidance: lead with the short part name; `model_label` must be the product noun.
- Files: `backend/services/project_store.py`, `design_service.py`, `ai_service.py`, `backend/main.py`, `backend/skills/cad/references/cad-brief.md` (service restart).

---

## 2026-07-24 — Manage workspace: per-member invite / edit / view

- Manage workspace modal lists each workspace with a **Permissions** dropdown for admins.
- Expanding it loads members and shows Access (`Can edit` / `View only`) + Invite (`Can invite` / `Cannot invite`) selects; patches existing `/api/teams/.../permissions`.
- Files: `frontend/workspace-manage.js`, `frontend/styles.css`, `frontend/index.html`, `frontend/app.js` cache-bust `?v=20260724-ws-manage-perms`.

## 2026-07-24 — Account menu: “Manage AI Keys”

- Renamed account-menu AI entry from dynamic “OpenAI API key” / “AI & billing” to **Manage AI Keys** (hint still shows provider/credits status).
- Files: `frontend/index.html`, `frontend/ai-key-ui.js`; cache-bust `app.js?v=20260724-manage-keys`.

## 2026-07-24 — Admin prompts: original vs improved + copy

- Admin Recent Prompt History (and project/user prompt lists) now include full `prompt`, `original_prompt`, and `prompt_improved`.
- UI: **Improved** badge, **Show original** / **Show improved** toggle, **Copy** (copies the visible version).
- Refresh button forces `?refresh=true` so dashboard cache picks up new fields.
- Files: `backend/main.py`, `frontend/admin-dashboard.js`, `styles.css`, `admin-dashboard.html` (`?v=20260724-prompt-orig`).

## 2026-07-24 — Personal projects missing for Sam (shared-ws nest)

- Bug: after shared-workspace nesting, **all** multi-member team roots were nested — Sam W has no solo personal workspace, so Personal/Projects looked empty (everything under shared folders). Public “Sam W” files still showed.
- Fix: nest invited (member-only) teams; keep owner/admin team roots at Projects root. Users with a true personal workspace (Vineet) still nest other teams under `{Team} shared workspace`.
- Verified: Sam ~94 root projects restored; Vineet still 1 personal + Render3D shared folder.
- File: `backend/main.py` (service restart).

## 2026-07-24 — Keep AI prompt draft across refresh

- Bug: opening/reloading a project called `resetComposerForProject()` which saved an empty prompt into localStorage, wiping the typed draft before restore. Update-banner refresh then looked like the prompt “vanished” and never hit history.
- Fix: UI-only composer reset (no persist); prefer newest non-empty draft when merging; save draft on `beforeunload` / `pagehide` and when an update refresh starts.
- Cache-bust: `app.js?v=20260724-prompt-draft`.

## 2026-07-24 — Restore click=whole / double-click=part selection

- Regression (since ~Jul 20): multi-body models single-clicked into a part; double-click selected the whole model. UI copy and Getting Started still described the opposite.
- Restored Jul 15 semantics: single-click → whole model; double-click → part/body (amber) for transform.
- Guard ignores a trailing whole-select click right after a part double-click.
- Files: `frontend/app.js`, `frontend/object-tools.js` status strings; cache-bust `app.js?v=20260724-select-fix2`.

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
