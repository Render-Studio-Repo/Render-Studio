# Developer Changelog

<!-- simple-changelogs-signature agent="Cursor Grok 4.5" at="2026-07-27T05:10:00+00:00" -->

> Maintainer history paired with the customer changelog. Prefer this file for architecture, OAuth/integrations, services, and ops. Same date headings and source window as CHANGELOG.md.

## 2026-07-27

- Management Changelog tab: `GET /api/admin/changelog` reads repo `CHANGELOG.md`; admin-dashboard.js renders markdown in `#admin-section-changelog` (`?v=20260727-admin-changelog`).
- Signup trial: `grant_signup_trial_if_needed` ($10), trial email, popup + `/api/user/ai-credits/trial-ack`; platform key labeled Render Studio Key.
- Share to X: `blobForXShare` prefers MP4 before compose/download.
- Linked mobile-app-chrome.css; forced .mobile-corner-launchers / showcase bar display:none !important.
- Menu tiles [data-mobile-app] wired via Render StudioMobileStudio; low-profile hamburger until is-open.
- Account menu Authorized apps card for X (/assets/brands/x-corp.svg) + Discord; shared connectXAccount helpers.
- Comprehensive changelog backfill from worklog (Jul 19–27) + git reconstruction (Jun 19; Jul 6–17).
- Repo hygiene: stop tracking local .config dirs (9f19a67); exclude CAD models and local backups from GitHub (31bae7d).
- Ship video studio / phone capture / mobile export (237c533).
- X Corp in Authorized apps: Added `/assets/brands/x-corp.svg` and an Account menu Authorized apps card (X + Discord) with connect/unlink.
- X Corp in Authorized apps: Preferences Authorized apps uses the same X logo + Connect CTA; shared `connectXAccount` PIN/popup flow.
- Mobile chrome: menu + profile + no corner overlap: Linked `mobile-app-chrome.css`; hide 4-corner launchers for good (`display:none !important` — they were overlapping cube/FAB/tray).
- Mobile chrome: menu + profile + no corner overlap: Menu toggle is a low-profile chip until expanded; studio tiles navigate (Explorer/AI/Tools/etc.) via `Render3DMobileStudio`.
- X media INIT failed (empty 403): Cause: OAuth1 used v1.1 `upload.twitter.com` INIT → empty 403. v2 INIT works; finalize hits credits depleted; tweet create needs Read and write app permissions.
- X media INIT failed (empty 403): Share to X (video) now opens compose + downloads the clip (no API media credits needed).

## 2026-07-26

- Export share scoped to the model (not whole scene): Sharing `Shower_Door…step` baked every eye-visible sibling (old Parametric assembly + other mounts) and sometimes rooted the link on `.3mf` (no GLB preview).
- Export share scoped to the model (not whole scene): Export → Copy share link now prefers sibling `.glb` and scopes `visible_filenames` to that model stem; 3MF resolves to GLB for the public viewer.
- Texture apply on timeline + Solid remove texturing: Applying library/render textures now records timeline kind `texture` (icon 🧱 + user), not a generic Upload.
- Texture apply on timeline + Solid remove texturing: Solid-mode right-click marking menu: Remove texturing (back to original rendered colors) (Architect keeps AI Wall Texture).
- Admin Recent Notifications tab: Added Notifications view on `/admin-dashboard.html`: review signup alerts + suggestions/bugs one at a time (Prev/Next, ←/→, filters).
- Admin Recent Notifications tab: New module `frontend/admin-notifications.js`; thin wire into `admin-dashboard.js`. Actions reuse existing review/message APIs.
- wormGear dark mesh + clipping: Project `0dae20dc`: dense ~100k-tri worm/wheel GLB looked near-black because CAD crease edges + black silhouettes covered the plastic shading (z-fight / “wireframe void”).
- wormGear dark mesh + clipping: `scene-style.js`: skip edges/silhouettes above 24k tris; recompute normals + DoubleSide on dense meshes.
- Kimi CAD complete left empty viewport (Rigging hid CAD): Kimi job `882f9767` on `184f51c9` succeeded (valid GLB + snapshots); viewport looked empty because Rigging URDF with box placeholders called `setCadAssemblyHiddenForUrdf(true)`.
- Kimi CAD complete left empty viewport (Rigging hid CAD): CAD/Mesh completion now exits Rigging → SOLID, clears URDF overlay, and forces CAD visible.
- Gripper URDF movable jaws + re-author prompt: Error on `184f51c9` (`d13e7c4f`) was real: AI `gen_urdf()` left roots `base_plate`/`cover_plate`/`pinion`, then preferred all-fixed so Rigging showed “No URDF movable joints”.
- Gripper URDF movable jaws + re-author prompt: Hand-authored single-tree `gen_urdf`/`gen_srdf`: prismatic `rack_left_slide`/`rack_right_slide` (±20 mm), revolute `base_to_pinion`; regenerated `.urdf`/`.srdf` (root `base_plate`, 3 movable).
- Loading steps only count forward: Repair loops used to rewind the spinner from e.g. step 6 → 3.
- Loading steps only count forward: Overlay now freezes at the peak step and shows Revising model instead of jumping backward.
- URDF multi-root robot artifact failure: `gen_urdf()` for NEMA utensil gripper left disconnected roots (`base_plate`, `cover_plate`, `pinion`) → UrdfSourceError.
- URDF multi-root robot artifact failure: Fixed project `184f51c9` joints (cover + pinion under base_plate); regenerated URDF.
- Switching projects no longer stops another project's generation: Bug: a single global `generationPollTimer` meant opening project B while A was generating replaced A's watch; `cancelActiveGeneration` could also fall back to `generationWatchPid` and cancel the backg…
- Switching projects no longer stops another project's generation: Fix: per-project `generationPollTimers` Map (sibling polls keep running); Stop/cancel only targets the open project (or explicit pid); pin `submitProjectId` for improve+POST so project switches don't steal the job.
- Fix generationPollTimer ReferenceError: After per-project `generationPollTimers` Map refactor, four call sites still referenced singular `generationPollTimer` (undefined) — broke generate/resume on projects like `ee20a13f`.
- Fix generationPollTimer ReferenceError: Replaced with `hasGenerationPoll(projectId)`. Cache-bust `?v=20260726-poll-timer`. Hard-refresh.
- Wiring Simulator restored + mesh.mjs /bodies 500: Wiring Simulator workspace itself was intact (Blink demo loads 4 parts / 7 wires). Accidental `app.js` regressions had reintroduced locked `rotateX(-90°)` upright tip and weakened Mesh authored-style retention.
- Wiring Simulator restored + mesh.mjs /bodies 500: Restored upright lock + `keepAuthoredStyle` / `hasMeshFactorySibling` from snapshot; kept Mesh `lockedPromptMode` so Mesh≠2.0.

## 2026-07-25

- Mesh selection no longer snaps back to CAD 2.0: Bug: choosing Mesh then Generate while a prior 2.0 job was active/resuming still POSTed `mode: v2` (Kimi included). `beginGenerationWatch` called `applyPromptModeUI(runningMode)`, stealing the picker …
- Mesh selection no longer snaps back to CAD 2.0: Fix: stop forcing the compose mode from generation watch; snapshot `lockedPromptMode` at Generate click and use it for routing/`mode` in the body (restore UI after resume).
- Mesh finished off-project left empty viewport: Root cause: Mesh for `a096cb1a` completed while viewing another project; completion marked applied without loading the GLB, so reopen skipped reveal.
- Mesh finished off-project left empty viewport: Fix: track `pendingViewportReveal`; reopen / empty-assembly resume forces `applyGenerationComplete`; `loadProject` ensures `latest_file` and won't soft-skip an empty assembly; Design←Wiring reloads if…
- Mesh generating chrome matches Mode 2.0 orange: Mesh spinner / canvas banner / timeline pending steps now use the same orange Jake chrome as Mode 2.0 (`timeline-step--v2`, `viewport-spinner--v2`).
- Mesh generating chrome matches Mode 2.0 orange: Mesh button branding (purple→cyan) unchanged — only the in-flight generating UI.
- Chat images open in-app lightbox: Project chat image thumbs were `<a target="_blank">` and opened a new browser tab.
- Chat images open in-app lightbox: Click now opens an in-app lightbox (backdrop / ✕ / Escape); Escape closes lightbox before chat.
- Kimi tool-agent costs were priced as OpenAI: Kimi list prices were already in `ai_cost.py` ($3/$15 for `kimi-k3`).
- Kimi tool-agent costs were priced as OpenAI: Bug: Jake tool-agent traces hardcoded `provider: openai`, so some Kimi turns were overcharged (~2×).
- Kimi selection no longer snaps back to Claude: Bug: prompt-key UI treated every non-Claude provider as OpenAI; `normalizePlatformProviderId` was missing in `app.js` (threw when reconciling platform picks). Selecting Kimi could silently keep/patch Anthropic.
- Kimi selection no longer snaps back to Claude: Fix: real Kimi platform choice, provider normalize helper, personal Save/Use disables Render Studio shared Claude fallback and selects `personal:<id>` in the compose picker.
- Fix “Save & activate” doing nothing on Add AI key: Symptom: Add a new key (e.g. Kimi) → green Save & activate produced no POST / no error.
- Fix “Save & activate” doing nothing on Add AI key: Cause: save relied only on native `<form submit>` + HTML5 `required` (easy to miss validation UI in the scrolled dark modal).
- Shared credits: Kimi K3 (V3) platform key: Added `KIMI_API_KEY` (+ `KIMI_MODEL` / `KIMI_MODEL_QUALITY=kimi-k3`) to server `.env`.
- Shared credits: Kimi K3 (V3) platform key: Credits path now offers Render Studio Kimi alongside OpenAI/Claude (`ai_credit_service` + platform key UI).
- Viewport: stop orbit continuing after mouse-up: Trackball could stay in ROTATE if pointerup was missed / controls disabled mid-drag — view kept following the cursor.
- Viewport: stop orbit continuing after mouse-up: New `trackball-pointer-safety.js`: force-end drag on window pointerup/cancel, blur, `buttons===0` while moving, and when `controls.enabled` flips off.
- Mobile: models no longer pure black in look-dev: Mesh look-dev used ambient 0.05 + RoomEnvironment IBL; on phones IBL often fails → metal PBR shades black.
- Mobile: models no longer pure black in look-dev: New `mobile-viewport-lighting.js`: on mobile or missing env, bump hemi/ambient/key/fill, show CAD fill if no IBL, soften envMapIntensity, smaller shadow maps.
- Admin Recent Projects sort: Sort dropdown on Admin → Recent Projects: date (newest/oldest), name A–Z/Z–A, person A–Z/Z–A, cost, files.
- Admin Recent Projects sort: Module `frontend/admin-project-sort.js` + `.css`; preference in `localStorage` (`render3d:adminProjectSort:v1`).
- Fusion unlink howto: Break Link menu shot: Added `frontend/media/fusion-unlink-break-link.png` (right-click menu with Break Link) + pointer “3 · Break Link”.
- Fusion unlink howto: Break Link menu shot: Howto callout now shows browser chain close-up + Break Link menu; steps row below.
- Fusion export unlink howto popup: After Fusion export/push, show one-time screenshot popup (X top-right + Don’t show again) explaining Insert → chain-link → Break Link before Extrude/Cut.
- Fusion export unlink howto popup: New modules: `frontend/fusion-unlink-howto.js` + `.css`; assets `frontend/media/fusion-unlink-{full,browser}.png` with pointers on the chain icon.
- Fusion Part push: standalone Part file (not linked Assembly): Cut failed with “No target body found…” because Fusion opened a linked `Parametric_Assembly_Of…` insert (chain icon) under an Unsaved parent — often from versioning an old Assembly-named item.
- Fusion Part push: standalone Part file (not linked Assembly): Part pushes now upload as sanitized `…_Part.step` (Assembly wording stripped), after flatten; never rewrite back to Assembly names via allow-list.
- CAD colors: no black / charcoal / aluminium on dark canvas: Part palette was aluminium / charcoal / matte black — invisible on the dark viewport.
- CAD colors: no black / charcoal / aluminium on dark canvas: Switched backend + viewport + AI color guidance to bright studio blues/teals/ambers/corals; `black` named color maps to slate.
- STEP Part/Assembly export restored: Part STEP download was broken: chooser never ran, and `?step_mode=part` no longer flattened.
- STEP Part/Assembly export restored: STEP click again offers Part (flatten for Extrude/Cut) vs Assembly (as authored).
- Viewport: stop tipping models onto their side: Bike/long assemblies were loading “tilted left” because the footprint ±90° scorer preferred the side face as the floor.
- Viewport: stop tipping models onto their side: Restored Jul 16 `ensureModelZUp` axis heuristic: only rotate clear Y-up (tallest axis Y); leave already-Z-up models alone.
- Fusion Extrude/Cut: restore Jul 16 native STEP export: Cut was broken because Export/Fusion kept sending rewritten `*.part.step` via `ensure_fusion_part_step` / `export_step_as_single_part` (and `step_mode=part`).
- Fusion Extrude/Cut: restore Jul 16 native STEP export: Jul 16 / Jul 21 / Jul 24 production goldens upload native solid B-rep as-is — no Part rewrite.
- Mesh export: Node path fix + Mountain Mike recover: `@prompt:3e161b4d3a7a` / `a096cb1a` failed after 12 tries: `_find_node` glob was `linux-*/node` but Cursor ships `linux-x64/<hash>/node`. Systemd PATH has no `node`.
- Mesh export: Node path fix + Mountain Mike recover: Fixed glob + `RENDER3D_NODE` systemd drop-in; fail-fast before AI burn; no retry on Node-missing.

## 2026-07-24

- Prompt draft: per-project only, clear on submit: Global `aiComposeDraft` was restoring the same text into every project’s prompt box.
- Prompt draft: per-project only, clear on submit: Drafts now save only under `modelPromptState` keyed by project; global key cleared/migrated.
- Fusion: one Part STEP, no companion .py: Two Fusion files came from auto-uploading `*.build123d.py` next to the STEP (`upload_source` defaulted true).
- Fusion: one Part STEP, no companion .py: Backend now uploads companion source only when `upload_source: true` (explicit). Frontend always sends `false`.
- Fusion: select root folders to export: Top-level (root) folders now show an explicit Select + Open row so you can export into Render Studio/etc without opening first.
- Fusion: select root folders to export: Cache-bust `?v=20260724-fusion-root`.
- Fusion export: no auto folder select: Stopped auto-selecting last/first/current folder and auto-diving past project root.
- Fusion export: no auto folder select: Hub/project may still restore; folders start unselected until the user clicks one (✓).
- Fusion Export CTA visible (orange): Export submit used faint `.btn.primary` blue and was easy to miss / look “not there”.
- Fusion Export CTA visible (orange): Bright orange sticky footer CTA + destination line; pulse on folder select; second click on selected folder starts upload.
- Fusion folder click = select with ✓: Folder tiles used to Open on click, so picking a destination inside Render Studio felt broken.
- Fusion folder click = select with ✓: Click folder → select export target + green ✓; separate Open browses inside.
- Fusion Export button pinned (no scroll): Export CTA was clipped: picker lived inside `.file-export-actions` under STEP/GLB chrome, so “Export to Fusion” sat below the fold.
- Fusion Export button pinned (no scroll): Picker is now a direct menu child; download chrome hidden while open; sticky `.file-export-fusion-footer`; menu pinned to top.
- Textures kept (CAD wipe) + better wrap; Mode 2.0 untouched: Library/render textures were wiped on reload: `applyCadStyle` treated white+map as washed and dropped maps / swapped shared face plastic.
- Textures kept (CAD wipe) + better wrap; Mode 2.0 untouched: Textured GLBs now tagged `render3dPipeline=texture`; maps force authored style. `afterModelEdit` passes `styleMode: shaded` only for texture actions (Mode 2.0 stays CAD).
- Export/share: all models, never stale ball token: Share links were reusing old tokens and/or baking the wrong sibling (Arduino / ball) via eye-hide filtering; Fusion push followed the same allow-list bugs.
- Export/share: all models, never stale ball token: Export everything: `collectProjectExportFilenames()` ignores hide state, dedupes by stem (prefer STEP), and multi-model Export always POSTs `/assembly/exports` with the full list.
- Mode 2.0 CAD shading: Mesh PBR heuristic only: Bug: Mesh PBR “vivid/shiny” auto-detect flipped Mode 2.0 STEP/GLB previews into authored shading (black / unlit).
- Mode 2.0 CAD shading: Mesh PBR heuristic only: `prefersAuthoredShading` now only honors Mesh markers (`.mesh.mjs` / `render3dPipeline=img2threejs|mesh` / explicit style extras) — no color heuristics.
- Right-click Export works without opening the project: Sidebar project list summaries set `latest_file: null` / `files: []` until a project is opened, so right-click Export / share… on an unselected project always said “no model to export.”
- Right-click Export works without opening the project: `exportProject` now fetches project detail when the filename is missing, then opens the export menu for that project id.
- Fusion export: one button + fit viewport: Fusion folder UI had many Export buttons (per-folder + “export here” + bottom submit) and the menu spilled past the screen.
- Fusion export: one button + fit viewport: Folders now Select only; a single bottom Export to Fusion submits. Picker body scrolls; menu max-height clamped to the viewport.
- AI compose panel: no outer scrollbar: Right AI panel scrolled as a whole (`overflow: visible` on sidebar/compose unlocked for old in-panel mode tips).
- AI compose panel: no outer scrollbar: Removed that unlock (tips are body-portaled). Chrome stays put; only the prompt editor scrolls. Compacted cost thumb + toolbar so typical heights fit without an outer bar.
- Mesh models keep Three.js PBR (not CAD plastic): Viewport `applyCadStyle` was rewriting Mesh/img2threejs GLB materials to Fusion plastic + edges, so colors never showed.
- Mesh models keep Three.js PBR (not CAD plastic): Auto-detect `.mesh.mjs` siblings / PBR heuristics / export `render3dPipeline=img2threejs` → `applyAuthoredStyle` (preserve materials).
- Mesh GLB Y-up → Z-up (was upside down / on side): img2threejs factories are Three.js Y-up; exporter seated on Z and the viewport sometimes flipped wrong.
- Mesh GLB Y-up → Z-up (was upside down / on side): `export_glb.mjs` now detects Y-up, `rotateX(π/2)` (+Y→+Z), then floor-seats. Re-exported bike GLB on `4162ee20` (`y_up_converted: true`, height on Z).
- Mesh Edit selected keeps the selected stem: Target Edit/New already sent `target_mode` + `base_filename` for 2.0/Mesh.
- Mesh Edit selected keeps the selected stem: Mesh Edit without a `.mesh.mjs` used to invent a new prompt stem; now keeps the selected object stem and overwrites that GLB. New still creates a fresh name.
- Overlay model label: Fable 5 not claude-fa…: Viewport usage footer showed raw ids (`claude-fable-5`) and ellipsized to `claude-fa…`.
- Overlay model label: Fable 5 not claude-fa…: `shortOverlayModel` now strips provider prefixes and uses short names (`Fable 5`, `Opus 5`, `GPT-5.5`).
- Mesh tab uses img2threejs coloring (not CAD cyan): Mesh prompt control looked like Fusion/CAD sky-blue; restyled to img2threejs logo palette (purple `#8b5cff` → cyan `#38e8ff`) with their cube logo on the button + tip badge.
- Mesh tab uses img2threejs coloring (not CAD cyan): Generation banner for Mesh matches the same look. Tip copy clarifies “not CAD / STEP”.
- Electronics toggle always visible in prompt mode row: Electronics was hidden whenever Mesh (or Render) was selected, which made it look removed after Fusion → Mesh.
- Electronics toggle always visible in prompt mode row: Toggle stays visible next to Render / 2.0 / Mesh; `model_electronics` still only applies on 2.0 / Architect generates.
- Mesh continues like 2.0 (review loop) + bike recovery: Prompt `1454cceb8347` / trace `d211cfc2` on `4162ee20` was canceled mid-try (`Stopped: Mesh cancel UI fix`) right after the factory write, before GLB export — not an AI failure. Factory was valid; exp…
- Mesh continues like 2.0 (review loop) + bike recovery: Mesh pipeline now mirrors 2.0: write → export → brief review → repair (budget 12), Mesh checklist (not CAD), finish current export / ship last-good GLB on stop.
- Mesh mode: Stop generating control: Mesh runs had no obvious Stop (Generate stayed in the compose row; canvas banner had no cancel).
- Mesh mode: Stop generating control: Stop now replaces Generate while a single Mesh job runs; canvas banner has Stop generating; watch starts before Improve so cancel works during spice-up. GLB export subprocess is killable on cancel.
- Mesh mode replaces Fusion prompt tab (img2threejs): Prompt Fusion tab → Mesh: AI writes a Three.js factory (`.mesh.mjs`), headless Node `export_glb.mjs` → GLB, same generation reload path as Jake text-to-CAD.
- Mesh mode replaces Fusion prompt tab (img2threejs): Skill vendored at `backend/skills/img2threejs/` with Node FileReader/`onloadend` shims for GLTFExporter.
- Admin project cards: long filenames overflow: Long `model_file` pills used `white-space: nowrap` and spilled past the card border (e.g. Food Robot / connector `.glb`).
- Admin project cards: long filenames overflow: Removed redundant filename pill from stats; filename stays on the muted line. Cards/stats now clip with ellipsis and `overflow: hidden`.
- Export: viewport truth + Part/Assembly chooser back: Latest bad push (`23:36`) hit `arduino_uno_q.glb/exports` while Fully_Assembled was on screen — `selectedFile` / eye state overrode the viewport; no allow-list.
- Export: viewport truth + Part/Assembly chooser back: Ribbon Export now prefers viewport-visible meshes, demotes `selectedFile`, and always bakes when the project has multiple model files. Fusion asks Part vs Assembly again (`step_mode`); Part flattens f…
- Fusion export used hidden file name (arduino): Symptom: Export → Fusion still created/replaced `arduino_uno_q.step` while the gripper was the only visible component.
- Fusion export used hidden file name (arduino): Fix: Export always sends `name` = visible stem (e.g. `Fully_Assembled_….step`) plus `allowed_filenames`. Bake bytes (`_export_visible_assembly`) stay the payload; Fusion item name is the visible part.…
- STEP export: Fusion Part for Extrude/Cut: Gripper native `.step` is a linked assembly (16× `NEXT_ASSEMBLY_USAGE`) → Fusion Extrude Cut fails. `.part.step` / flattened bake has 18 solids and 0 assembly links.
- STEP export: Fusion Part for Extrude/Cut: Download + Fusion push now prefer/ensure `*.part.step` via `ensure_fusion_part_step` (clean download name `.step`). Export menu labels/sorts Fusion Part · Extrude/Cut first and demotes linked assemblies.
- Export still sent Arduino: Base stem collision: Root cause: hiding Two-finger stored body label `Base`; `isBrowserComponentHidden` stem-matched that onto Fully_Assembled (same STEP product name `base`), so Export treated the gripper as hidden and o…
- Export still sent Arduino: Base stem collision: Fix: eye-icon visibility is exact file keys only (no cross-component body-name stems). With any hidden siblings, Export always bakes `_export_visible_assembly` from unhidden top-level components; Fusi…
- Pick bar sits on ribbon bottom border: Ribbon `.ribbon-pick-host` was vertically centered (`top: 50%` + translate). Anchored to `bottom: 0` so the Pick strip sits on the grey ribbon/viewport divider; bottom corners squared to meet the line.
- Pick bar sits on ribbon bottom border: Cache-bust: `ribbon.css?v=20260724-pick-bar-bottom`.
- Fusion “Uploading…” hang: Replace dialog clipped: After a file already existed in the Fusion folder, export set “Uploading…” then showed Replace/Create below the picker. Picker has `overflow:hidden`, so the dialog was clipped and the request never started.
- Fusion “Uploading…” hang: Replace dialog clipped: Conflict UI is now an overlay on the picker; status asks for Replace/Create until upload actually begins.
- Chat unread badge: don’t cover “Chat”: Unread badge sat on the Chat label. Moved to the corner with `transform: translate(45%, -45%)`, extra right padding, and a panel ring so “Chat” stays clear (0 overlap verified).
- Chat unread badge: don’t cover “Chat”: Cache-bust: `styles.css?v=20260724-chat-badge2`.
- Admin Recent Projects: un-scrunch left column: Project cards used a 3-column grid (thumb + text + View model) inside a narrow left pane, so labels wrapped one word per line and overlapped.
- Admin Recent Projects: un-scrunch left column: Cards are now thumb + text, with View model under the text; left pane gets `minmax(320px, …)`.
- Fusion Extrude Cut: flatten assembly STEP → Part: Fusion error “No target body found to cut or intersect” = STEP has `NEXT_ASSEMBLY_USAGE` (linked assembly). Solids were fine; hierarchy blocked Cut.
- Fusion Extrude Cut: flatten assembly STEP → Part: Fusion push + STEP download now flatten editable B-rep assemblies via `export_step_as_single_part` (keeps `MANIFOLD_SOLID_BREP`, clears assembly links). Visible-assembly bake writes the same Part-style STEP.
- Export visible: don’t upload hidden siblings (Arduino): Bug: Fusion cloud push fell back to any editable STEP in the project, so hiding Fully_Assembled still uploaded `arduino_uno_q.step`.
- Export visible: don’t upload hidden siblings (Arduino): Fix: visible-assembly bake writes `_export_visible_assembly.step` from only unhidden filenames; Fusion uses that file only (never unrelated B-rep). `_step_for_cloud_cad` won’t remap visible-assembly to another model.
- Fusion export: replace vs new + thumbnails: If the destination folder already has the same filename, ask Replace (new version) or Create new file (`name (2).step`).
- Fusion export: replace vs new + thumbnails: Folder picker lists existing files; after upload, kick off Model Derivative so Fusion Data Panel can generate a real preview (not the gray cube forever).
- Fusion chooser: Shared only with a file: Shared Fusion folder/link only when a STEP/3MF is available to upload; Update original only when `autodesk_source.item_id` exists.
- Fusion chooser: Shared only with a file: Single action skips the chooser and runs directly (no lone Shared card).
- Fusion export: restore Jul 16 / pre-Jul19 working path: Break introduced Jul 19 (`3fc6c13`): Part/Assembly chooser + `export_step_as_single_part`. Jul 16–17 goldens and commit `a17400c` never sent `step_mode`.
- Fusion export: restore Jul 16 / pre-Jul19 working path: Restored that push body (`filename` + `allow_faceted_step` only); no Part chooser; folder picker opens when no mirror folder linked (avoids stuck “Link a Fusion mirror folder” retry).
- Fusion export error toast auto-dismiss: Error cards (incl. “Link a Fusion mirror folder…”) fade in and auto-dismiss ~4s — no stuck Retry loop.
- Fusion export error toast auto-dismiss: Missing-folder push opens the Fusion folder picker after a short toast instead of Retry.
- STEP download: restore native B-rep (no Part rewrite): Same bug as Fusion push: `?step_mode=part|regular` ran `export_step_as_single_part` in `_file_response`, breaking Extrude/Cut.
- STEP download: restore native B-rep (no Part rewrite): Jul 16 golden served the on-disk solid STEP as-is (no rewrite). Removed that rewrite from downloads; studio STEP click downloads the native file (no Part/Assembly chooser).
- Fusion B-rep Cut: restore Jul 16 native STEP push: Root cause: Fusion export offered Part first and backend ran `export_step_as_single_part`, which broke Extrude/Cut. Jul 16 golden (`golden-working-code-20260716T231304Z`) never sent `step_mode` / never rewrote STEP.
- Fusion B-rep Cut: restore Jul 16 native STEP push: Fix: Fusion cloud push always uploads native solid B-rep (`assembly` only). Removed Part/Assembly chooser for Fusion; backend ignores legacy `step_mode=part` on `/push-to-autodesk`.
- Fusion export: green check on success: Export to Fusion · {folder} turns green with Exported ✓ after a successful upload (same for the bottom submit + matching folder tile).
- Fusion export: green check on success: Cache-bust: `?v=20260724-fusion-check`.
- Fusion export: upload to current folder: Inside a Fusion folder (e.g. Render Studio) there is a primary Export to Fusion · {folder} button — no subfolder required.
- Fusion export: upload to current folder: Folder tiles use Export (one-click upload there). Bottom submit label shows the destination folder name.
- Restore working B-rep export/Fusion from backup: Afternoon Part-mode forcing rewrote native STEPs through `export_step_as_single_part`, which broke Fusion editability (“all B-rep messed up”).
- Restore working B-rep export/Fusion from backup: Restored `file-actions.js` + `admin-dashboard.js` from snapshot `20260724T150001Z-cron` (pre-break), then re-applied only the nested Fusion folder grid.
- Fusion/STEP: Part mode for editable solids: Assembly STEPs open in Fusion as linked components (hard to edit). Downloads + Fusion export now prefer Part (one design, solid bodies, no `NEXT_ASSEMBLY_USAGE`).
- Fusion/STEP: Part mode for editable solids: Studio STEP download always asks Part vs Assembly (Part recommended). Admin defaults to `?step_mode=part` and labels options clearly.
- Admin STEP download: keep parametric B-rep: Admin project modal download collapsed all STEPs into one format slot; `*__faceted.step` often won, so downloads lost solid/parametric B-rep (labels/bodies).
- Admin STEP download: keep parametric B-rep: Now keeps both variants, labels them (`parametric B-rep` vs `faceted mesh`), and defaults to editable B-rep.
- Fusion export: nested folder grid picker: Export → Fusion folder browser is now a 2-column tile grid; click a tile to open nested folders (e.g. Project Files → Render Studio → …).
- Fusion export: nested folder grid picker: Export here selects the current folder; breadcrumbs + Back for navigation; last nested path remembered.
- Part names: product noun, not “fully assembled CAD”: Spice-improved prompts often started with CAD boilerplate, so STEP/Fusion file + `model_label` became `Parametric Fully Assembled CAD…`.
- Part names: product noun, not “fully assembled CAD”: `title_from_prompt` / `file_stem_from_prompt` now strip that jargon and prefer `Gripper - Robot Arm`-style names; colon openings (`Parallel gripper: …`) keep the product name.
- Manage workspace: per-member invite / edit / view: Manage workspace modal lists each workspace with a Permissions dropdown for admins.
- Manage workspace: per-member invite / edit / view: Expanding it loads members and shows Access (`Can edit` / `View only`) + Invite (`Can invite` / `Cannot invite`) selects; patches existing `/api/teams/.../permissions`.
- Account menu: “Manage AI Keys”: Renamed account-menu AI entry from dynamic “OpenAI API key” / “AI & billing” to Manage AI Keys (hint still shows provider/credits status).
- Account menu: “Manage AI Keys”: Files: `frontend/index.html`, `frontend/ai-key-ui.js`; cache-bust `app.js?v=20260724-manage-keys`.
- Admin prompts: original vs improved + copy: Admin Recent Prompt History (and project/user prompt lists) now include full `prompt`, `original_prompt`, and `prompt_improved`.
- Admin prompts: original vs improved + copy: UI: Improved badge, Show original / Show improved toggle, Copy (copies the visible version).
- Personal projects missing for Sam (shared-ws nest): Bug: after shared-workspace nesting, all multi-member team roots were nested — Sam W has no solo personal workspace, so Personal/Projects looked empty (everything under shared folders). Public “Sam W”…
- Personal projects missing for Sam (shared-ws nest): Fix: nest invited (member-only) teams; keep owner/admin team roots at Projects root. Users with a true personal workspace (Vineet) still nest other teams under `{Team} shared workspace`.
- Keep AI prompt draft across refresh: Bug: opening/reloading a project called `resetComposerForProject()` which saved an empty prompt into localStorage, wiping the typed draft before restore. Update-banner refresh then looked like the pro…
- Keep AI prompt draft across refresh: Fix: UI-only composer reset (no persist); prefer newest non-empty draft when merging; save draft on `beforeunload` / `pagehide` and when an update refresh starts.
- Restore click=whole / double-click=part selection: Regression (since ~Jul 20): multi-body models single-clicked into a part; double-click selected the whole model. UI copy and Getting Started still described the opposite.
- Restore click=whole / double-click=part selection: Restored Jul 15 semantics: single-click → whole model; double-click → part/body (amber) for transform.
- Pick tools missing until tab click after refresh: Cause: `solid-design-tab` applied before ribbon mount (or skipped), so `#ribbon-pick-host` stayed `display:none` until another design tab click.
- Pick tools missing until tab click after refresh: Fix: re-force design tab after `createRibbon`; ribbon boot fallback adds `solid-design-tab`; CSS shows Pick in Design even without a class yet. `?v=20260724-pick-boot`.
- Pick bar in Create row + catalog suggestions + sketch D: Pick tools centered in the ribbon Create row for SOLID / SKETCH / RIGGING / ROBOTICS (was stuck hidden: default SOLID tab never applied `solid-design-tab`).
- Pick bar in Create row + catalog suggestions + sketch D: New project / Upload stay far right (`toolbar-actions { margin-left: auto }`).
- Docs → Getting Started + unique GIFs + laptop layout: Studio Docs nav → `/getting-started.html` (was `/docs.html`).
- Docs → Getting Started + unique GIFs + laptop layout: Each Getting Started section now has its own GIF (was reusing ai-generate/picks/canvas/select-object). Added `multi-gen`, `link-to-prompt`, `solid-tools`, `sketch`, `rigging-urdf`; synced backend guid…
- Fix Components hierarchy row layout: Bug: eye / ⓘ / name stacked vertically (name btn `width:100%` + flex-wrap).
- Fix Components hierarchy row layout: Fix: row order eye → ⓘ → name; override width so name flexes; ellipsis + `title` for full name on hover (components + bodies).

## 2026-07-23

- Invited workspace projects → shared folder: Problem: accepting a workspace invite dumped that team's root projects into the invitee's personal Projects root (Vineet had 1 personal + ~60 Render Studio models mixed).
- Invited workspace projects → shared folder: Fix: `list_projects` nests non-personal root projects under virtual `__shared_ws_{teamId}` named "{Team} shared workspace". Real subfolders unchanged. Browser treats them as virtual/read-only.
- Fix AI usage sparkline overflow: Cost bars were scaled to 42px inside a 28px chart (clipped/overflow). Chart restored to 40px; bar heights capped to fit; overflow hidden. Cache-bust `?v=20260723-cost-bars`.
- Right panel tabs: 2 rows, tighter chrome: Right tabs forced to a 3-column / 2-row grid (was wrapping to 3 rows).
- Right panel tabs: 2 rows, tighter chrome: Pulled tabs up (less top padding/margin); slimmer AI usage thumb (shorter chart/padding).
- Share links respect unhidden models only: Bug: share saved visibility lists but the public viewer still loaded the full catalog.
- Share links respect unhidden models only: Fix: bake visible-only `_share_visible_*.glb` at create; filter allow-list + browser tree; expose visibility on `/api/share/{token}`; share-viewer filters parts (`?v=20260723-share-visible`).
- Better robot floor + rotate without explode: Robotics work cells: real concrete/epoxy slab texture (painted aisle tape), not floating yellow bars.
- Better robot floor + rotate without explode: Exploded ▾ menu: Rotate off / Rotate model (assembled, no explode) / Rotate exploded. Cache-bust `?v=20260723-orbit-floor`.
- Fix: robotic work-cell props polluted Design viewport: Bug: `robotic-simulator.js` applied shop-floor boxes/lanes on boot into the main Three.js scene.
- Fix: robotic work-cell props polluted Design viewport: Fix: never inject on bind; default env `empty`; always clear on leave; sweep leftover `isRobotSimEnvironment` nodes. Cache-bust `?v=20260723-robot-sim-fix`.
- Robotic Simulator tab (next to Electronics): Design/Wiring tab ROBOTICS + right panel: catalog arms, URDF/SRDF upload, work-cell environments, play cycle / joint playground.
- Robotic Simulator tab (next to Electronics): New `frontend/robotic-simulator.js`; upload accepts `.urdf`/`.srdf` in `POST /upload`. Cache-bust `?v=20260723-robot-sim`.
- Link preview title → AI & Robotics Studio: Updated `frontend/index.html` `<title>`, `og:title`, `twitter:title`, and descriptions to Render Studio — The AI & Robotics Studio (was “AI Product Studio”).
- Viewport high-quality video record control: Added video camera icon next to Screenshot in the viewport view bar.
- Viewport high-quality video record control: ▾ opens settings: quality (Standard/High/Ultra), fps (30/60), optional mic; main click starts/stops recording.
- Quest tracking moved to Preferences → Advanced: Removed Quest tracking toggle from the account Learn menu and General preferences.
- Quest tracking moved to Preferences → Advanced: Now lives under Preferences → Advanced → Viewport (still ON by default).
- Workspaces menu: drop All, nicer checks, auto-show on accept: Removed All workspaces focus row from the Projects workspaces menu (and retired `__all__` as default/saved focus).
- Workspaces menu: drop All, nicer checks, auto-show on accept: Personal + shared workspaces each get a visibility checkbox; custom orange check UI (not native blue).
- Components tree: Bodies for assemblies + less indent: Top gripper (`Fully_Assembled…`) had no Bodies: `/bodies` called `load_mesh` first on a 14MB GLB and hung; also a spurious `*.part.step` stole primary. Scene parse already had 16 parts.
- Components tree: Bodies for assemblies + less indent: Fix: GLB `/bodies` prefers `scene_body_info` first; `list_browser_tree` nests viewer-scene Bodies when no `__part_` sidecars; hide `foo.part.step` when `foo` exists.
- Right-click share project with teammate: Feature: project owner right-clicks a project → Share with teammate… → appears in recipient’s files with a Shared tag; recipient right-clicks → Remove from my folder.
- Right-click share project with teammate: Backend: `project_shares` + `project_hidden` tables; `backend/services/project_shares_service.py`; routes `GET/POST /api/projects/{id}/shares`, `DELETE .../shares/me`, `DELETE .../shares/{user_id}`; `…
- Robot artifact gen: gripper URDF/SRDF + clearer errors: Symptom: `Robot artifact generation failed.` on project `6b458c64` (trace `7dc9b7d7`) after CAD OK — SRDF stage failed.
- Robot artifact gen: gripper URDF/SRDF + clearer errors: Causes: AI `gen_urdf()` empty `<inertial/>` + joints to missing `finger_*_seg0`; `gen_srdf()` returned unsupported `planning_group` and put URDF XML in `urdf` instead of a relative `.urdf` path. Autho…
- Restored missing `_running_set` (generation NameError): Symptom: `name '_running_set' is not defined` on prompt start (trace `7bfeacf1`, project `6b458c64`).
- Restored missing `_running_set` (generation NameError): Cause: commit `f7208c1` (2026-07-21 cron backup) inserted drain helpers by replacing `def _running_set` instead of adding beside it. Call site `_running_set(project_id).add(...)` stayed; helper gone. …

## 2026-07-22

- Shared workspace checkboxes actually show projects: Bug: Projects folder 📁 checkboxes looked checked, but focusing one shared workspace (e.g. “fusion render”) still scoped `/api/projects?team_id=…`, so other checked workspaces never appeared.
- Shared workspace checkboxes actually show projects: Fix: always fetch `/api/projects` (all accessible); checkbox hide-list filters the browser. Focusing a workspace only sets active create/invite context.
- Workspace invite moved to popup: Slimmed left Workspace panel: removed inline people-picker + invite email row; replaced with a single Invite people button.
- Workspace invite moved to popup: New `frontend/workspace-send-invite.js` popup invites to the current workspace only (no workspace picker in the modal). Switch workspace from Projects first.

## 2026-07-21

- Quest Complete header note + tracking toggle: Replaced bottom toast with a subtle Quest Complete! chip next to the profile button (`.quest-complete-note` in `.auth-widget`). Click opens Quest Book.
- Quest Complete header note + tracking toggle: Added Quest tracking toggle (default ON): account menu Learn section + Preferences → General. When OFF: `emitFeatureUsed` does not mark progress and does not notify (`render3d:questsEnabled:v1`).
- Quest Book real progression (checkpoint): New `frontend/feature-events.js`: `emitFeatureUsed`, `setQuestUser`, localStorage per user (`render3d:questProgress:v1:<userId>`), anonymous→user merge, gold toast on first complete, `render3d:quest-p…
- Quest Book real progression (checkpoint): `frontend/quest-book.js`: reads live progress; unlock via parent node (forgiving — events still credit while locked); live refresh + node flash on complete; progress bar / tab counts real.

## 2026-07-19

- Product Quest Book shipped (visual stage): Finished the Quest Book modal begun in a disconnected session: added the full modal CSS block to `frontend/styles.css`.
- Product Quest Book shipped (visual stage): Fixed first-node tooltip clipping; gold menu button + Studio walkthrough already landed.

## 2026-07-17

- user_ai_keys_service: per-user team-key isolation so non-OpenAI selections cannot silently reuse OpenAI shared keys.
- Prompt Codex gating tied to selected OpenAI key.

## 2026-07-16

- texture_library_service.py + texture-panel.js; timeline render/2.0 cost metadata; wiring pin-label heuristics.

## 2026-07-15

- Share stack (share.html / share-viewer.js / share_preview.py); project_chat + knowledge_service.
- Marketplace payments (Stripe Connect); codex_agent / jake_tool_agent; Discord/LinkedIn social update services.
- Onboarding email, demo_template_service, show-me-tour, shipped.json product-update feed.

## 2026-07-14

- document-tabs.js + reference-files.js; teams invite UX; folders/project rename flows; measure HUD integration.

## 2026-07-10

- Architect frontend module split; cad_authoring_agent.py; urdf-robot / step-module / planetary-gear runtimes.
- client-reload.js version polling; Fusion mirror management API/UI expansions; skills _packages vendor consolidation.

## 2026-07-07

- text_to_cad_params backend + text-to-cad-params.js for module-scope CAD parameter rebuild.
- design_service / main.py / app.js expansion for generation presence, wiring speed modes, DXF drawings.

## 2026-07-06

- autodesk_oauth.py + /oauth/autodesk/* and /api/autodesk/*; DB tables for Autodesk tokens and Fusion mirrors.
- fusion-panel.js; Fusion prompt mode + push flag in app.js / main.py / ribbon.
- fusion360-plugin/Render StudioLink localhost bridge.
- New services: render_agent_service, agent_marketplace_service, social_oauth, wiring_debug_job_service; daily_limit_usd on user AI keys.
- skill_runner surfaces CAD kernel signal deaths into the AI repair loop; Pro reasoning-effort clamp (min medium).
- DXF prompt attach stores truncated text_content on reference chips; backup scripts appear.
- 92c74f7 recovers Fusion/social/admin features from transcript history and removes reconstruction .bak artifacts.

## 2026-06-19

- Root commit da17e41 imports the FastAPI + vanilla-JS Studio monolith (kernel, services, skills, frontend).
- Wiring service ULN2003/28BYJ validation/auto-repair; canvas compose for sketch+voice → generate.
