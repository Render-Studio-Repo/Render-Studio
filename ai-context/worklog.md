## 2026-08-01 — Timeline slimmed to macOS-style icon dock

- Project history timeline is now a compact frosted icon dock (~56px) instead of tall labeled cards.
- Steps are icon-only with hover magnification; labels live in tooltips + the slim header strip.
- Migrates saved tall timeline heights (≥110px) down to the dock default; wiring mode still expands for its bottom panel.
- Cache-bust `?v=20260801-dock-tl`; restarted `render3d.service`.

---

## 2026-07-31 — Posted updates since July 16

- Added 11 milestones to Recent Updates (XR/AR captures, AI VR icon, URDF real meshes, Bambu plates, Mesh Stop/Improve, share speed, etc.).
- Live on https://render3d.app/updates.html (`?v=20260731-post-jul16`).
- Discord/LinkedIn not configured in `.env` — drafts written to `frontend/docs/updates/social/posts.json`; fixed `scan-milestones.py` missing `import sys`.

---

## 2026-07-31 — Updates page blank: frontend wipe + missing auth.js

- https://render3d.app/updates.html showed Hello World only — milestone cards never mounted.
- Cause: large frontend (+ ship scripts) deletion; `updates.js` hard-imported missing `auth.js`, so the ES module failed and `#updates-list` stayed empty.
- Restored frontend + scripts from `20260731T160001Z-cron`; made auth import optional so the list still loads if auth is missing.
- Note: newest milestone entry is still 2026-07-16 — newer product work was not appended to `milestones.js` / ship-update.

---

## 2026-07-30 — Rigging moves real CAD parts (not white boxes)

- Primitive-only URDF left CAD static while white boxes animated.
- Gripper `gen_urdf()` now references `__part_*.glb` meshes (`scale=0.001`) with identity joint origins.
- Pipeline post-step `_rewrite_urdf_visuals_to_part_meshes` swaps placeholders → part meshes when sidecars exist; author prompt updated.

---

## 2026-07-30 — URDF launcher accepts Jake ElementTree returns

- Robot artifact fail on `6f1f5739` Parallel Pinch Gripper: AI `gen_urdf()` returned `ET.ElementTree(robot)` and the launcher only accepted `Element`/string/dict.
- URDF (and SRDF/SDF) now unwrap `ElementTree.getroot()` like Jake-style scripts; author prompt updated.
- Fixed this gripper: `return robot`, prismatic jaw joints, proper SRDF group/open/closed; regenerated `.urdf`/`.srdf`.

---

## 2026-07-30 — Green AI VR icon while generating in headset

- Left-hand dock adds an **AI VR** button; it turns bright green and pulses while a generation is running in VR/AR.
- AI prompt panel header switches to **AI VR · GENERATING…** with a green rim during runs.
- Wired via `viewportXR.setAiGenerating` from generation watch / stop visibility sync.
- Cache-bust `?v=20260730-ai-vr-gen`.

---

## 2026-07-30 — VR recording: controllers + UI windows match headset

- Controllers looked wrong because the recorder used a stereo-eye projection on a 16:9 canvas (squished) and composited over a mismatched passthrough camera.
- VR clips now record a true headset spectator view (head-centered camera, correct FOV/aspect).
- Explorer + AI prompt windows are included in the recording (only the Rec/Stop strip is hidden).
- Cache-bust `?v=20260730-vr-rec-ui`.

---

## 2026-07-30 — Right-click delete for reference files

- Projects browser: Reference Files / Renders right-click menu now includes **Delete** (and Rename).
- Open reference image viewer: right-click also offers Delete.
- Confirms, then removes via existing `/files/{name}` DELETE (including `references/AR/`).
- Cache-bust `?v=20260730-ref-delete`.

---

## 2026-07-30 — Bambu export: “Preparing assembly…” spinner

- Send to Bambu Studio / 3MF download now shows a spinning circle with **Preparing assembly…** while the plate pack runs (single-body still says Preparing 3MF…).
- Cache-bust `?v=20260730-bambu-prep-spin`.

---

## 2026-07-30 — XR capture: PC popup without refresh + AR references save

- Restored missing `frontend/` + `backend/main.py` after a bad delete left `index.html` 500.
- Quest stop no longer opens Share studio inside XR (that blocked the PC path); it saves to **Reference Files → AR** and publishes `xr.capture.ready`.
- PC polls pending captures every 2s + on focus (covers 2-worker WS miss); banner shows immediately.
- Cache-bust `?v=20260730-xr-popup-live`; restarted `render3d.service`.

---

## 2026-07-30 — Golden snapshot: working production

- Code-only golden: `backups/golden/golden-working-production-20260730T160854Z/` (~145 MB).
- Drive folder `golden-working-production-20260730T160854Z` (ID `1ViZ6OgyUsv_RQdBAZgz7HfifxsKnDOD3`); protected via `golden-` prefix.
- Git HEAD `07efc027bf2f79491f89fca5204b0b57488aabbc`.

---

## 2026-07-30 — Brand: Render Studio on boot + toolbar

- Loading screen title/logo word and projects spinner: **Render Studio** (was Render3D Studio).
- Top-left toolbar brand `<h1>`: **Render Studio**.
- File: `frontend/index.html`.

---

## 2026-07-29 — Mesh stop: restore draft + costs like Mode 2.0

- Mesh cancel raised `RuntimeError` → HTTP 422; background skipped stopped-history usage refresh, so history often had the prompt with **no cost**.
- Mesh cancel now maps to `DesignCanceled` (499); canceled jobs always refresh stopped history with latest usage/cost.
- Frontend Stop restores the prompt into the compose draft (Mesh + 2.0) and follow-up-refreshes history so costs catch up.
- Cache-bust `?v=20260729-mesh-stop-draft-cost`; restarted `render3d.service`.

---

## 2026-07-29 — Bambu: unique mesh IDs so each plate shows the real part

- Multi-plate UI worked, but every plate showed the same Bottom-Plate-like mesh.
- Cause: all `3D/Objects/object_*.model` used `object id="1"`; Studio conflates those (known Bambu quirk).
- Each body now gets a unique mesh object id (`1,3,5…`) matched by component `objectid` and `model_settings` `<part id>`.
- Cache-bust `?v=20260729-bambu-unique-mesh-ids`; restarted `render3d.service`.

---

## 2026-07-29 — Bambu 3MF: one assembled plate (not fragment plates)

- Root cause: viewer GLBs tessellate a single CAD solid into dozens of mesh nodes; each became its own Bambu plate (empty/junk for “single object”).
- Default 3MF now **merges** into one seated printable on one plate.
- Multi-plate only for explicit `__part_*.glb` print kits.
- Verified horn (48 fragments → 1 plate) and drone (40 → 1 plate); part-kit still 2 plates.
- Cache-bust `?v=20260729-bambu-one-plate`; restarted `render3d.service`.

---

## 2026-07-29 — VR/AR captures → Reference Files / AR

- Screenshots and videos taken in WebXR save into `references/AR/` with names like `AR-screenshot-…png` / `VR-video-….webm`.
- Project browser groups them under **Reference Files → AR captures**.
- Upload accepts `reference_folder=AR`; video suffixes allowed as references; reference viewer plays clips.
- Cache-bust `?v=20260729-ar-captures`; restarted `render3d.service`.

---

## 2026-07-29 — Bambu Studio: single-body 3MF was empty

- Root cause: single-body export used a generic 3MF (no `Metadata/model_settings.config`), so Bambu opened an empty plate; multi-body used the plate project format.
- All 3MF exports now use the Bambu multiplate writer (1 body → 1 plate).
- Eye-filtered exports load the viewer GLB so `visible_body_indices` match the browser (not mismatched `__part_` sidecars).
- `ensureThreeMfExport` now surfaces regenerate errors instead of silently reusing a stale file.
- Cache-bust `?v=20260729-bambu-single-plate`; restarted `render3d.service`.

---

## 2026-07-29 — VR menu fix + POV Screenshot/Record → X

- Fixed VR trigger always hitting Menu/first row: removed duplicate gamepad select (wrong controller index) + menu hit-test no longer clamps misses to row 0.
- Screenshot / Record live under Menu → **View** (general console), with Share to X after exit.
- Wired `onToolAction` / projects list for XR console tools.
- Cache-bust `?v=20260729-xr-menu-fix`.

---

## 2026-07-29 — Mobile POV screenshot + record → Share to X

- Mobile shows PC-style POV **Screenshot** + **Record** controls (was fully hidden).
- Screenshot opens markup modal with **Share to X** (device share sheet on phones).
- Tools FAB / View sheet also expose Screenshot → X and Record → X.
- Cache-bust `?v=20260729-mobile-capture-x`.

---

## 2026-07-29 — Export / Bambu 3MF: unhidden parts only + plate packing

- Open-project **Export** uses eye-visible model (same as Export button), not a stale primary file.
- Bambu/3MF regenerate accepts `visible_body_indices` so hidden bodies are not plated.
- Fixed 40-body overflow: pack onto ≤36 plates (no off-bed nudge); one `<plate>` per plate id.
- Cache-bust `?v=20260729-export-visible-3mf`; restarted `render3d.service`.

---

## 2026-07-29 — Faster Create share link

- Root cause: minting a share re-ran full `build_visible_assembly_exports` (STL + huge faceted STEP + 3MF + B-rep), not just the viewer GLB.
- Share bake now uses `include_companions=False` (GLB only). Export menu still builds companions.
- Share prep starts in parallel with export listing; viewport snapshot uses JPEG instead of PNG.
- Cache-bust `?v=20260729-share-fast`; restarted `render3d.service`.

---

## 2026-07-29 — Mesh Improve → img2threejs realistic look-dev

- Mesh **Improve** follows GitHub img2threejs rendering rules (`shading_realism` + `threejs_texture_reference`):
  independent PBR, finish recipes, wear/locality, named mesh parts — not CAD or flat toy colors.
- Tip/status copy: “Improve for realistic mesh materials”; tip mentions Mesh / Render / 2.0.
- Cache-bust `?v=20260729-mesh-real`; restarted `render3d.service`.

---

## 2026-07-29 — Hide GPT-5.5 Pro for Sam / a1projects

- Removed **GPT-5.5 Pro** from model pickers for a1projects admin emails.
- Server also remaps any pinned gpt-5.5-pro → gpt-5.5 for those accounts (Quality included).
- Cache-bust `?v=20260729-no-pro-a1`.

---

## 2026-07-28 — GPT-5.5 Pro defaults Mode to Speed

- Selecting **GPT-5.5 Pro** auto-sets Mode to **Speed** so Quality ($30/$180) is not left on by accident.
- Users can still switch to Quality manually after selecting Pro.
- Cache-bust `?v=20260728-pro-default-speed`.

---

## 2026-07-27 — Copy share link pinned to top of Export

- Moved **Copy share link** above the download list (sticky) so it is not scrolled off on mobile.
- Stopped mobile bottom-sheet from being overwritten by desktop top positioning.
- Cache-bust `?v=20260727-share-btn-top`.

---

## 2026-07-27 — Fix URDF box size / SRDF robot name on robot artifacts

- AI-authored `gen_urdf()` often emitted `<box><size>…</size></box>` (invalid); coerce to `<box size="…"/>` in URDF skill CLI.
- AI-authored `gen_srdf()` often omitted `<robot name>` and used `<link_group>`; coerce name from URDF + rewrite to `<link name>`.
- Hardened authoring prompt; fixed License Plate Frame project generators and regenerated `.urdf`/`.srdf`.

---

## 2026-07-27 — Mobile share link copy fix

- Export “Copy share link” uses native `navigator.share` on mobile, with Clipboard + execCommand fallbacks.
- If copy still fails, show a selectable URL field for long-press copy.
- Cache-bust `?v=20260727-mobile-share-copy`.

---

## 2026-07-27 — Hide free-credits popup when weekly allotment is out

- Merge `blocked_weekly_cap` / `waitlisted` from trial grant into AI status `credits.trial`.
- Persist waitlist flags on `_trial_info`; force `show_popup: false` when out for the week.
- Frontend never shows the $10 free-credits modal for waitlisted users; setup intro stops advertising free/shared trial credits.
- Cache-bust `?v=20260727-no-free-week-popup`.

---

## 2026-07-27 — Rebrand to Render Studio + render credits

- User-facing product name: **Render Studio** (kept `render3d.app` URLs, logos, `Render3DMobile*` APIs).
- Billing copy: **render credits / render credits → render credits**; platform key label **Render Studio Key**.
- Cache-bust `?v=20260727-render-studio`.

---

## 2026-07-27 — X share caption: Render Studio + site link

- Default Share to X caption is **Render Studio** (not “loading Render Studio”).
- Compose intent attaches `url=https://render3d.app` so the post includes a live link (X cannot hyperlink arbitrary words).
- Cache-bust `?v=20260727-x-render-studio`.

---

## 2026-07-27 — Management Changelog tab

- Added Management → **Changelog** tab showing live repo `CHANGELOG.md` via `GET /api/admin/changelog`.
- Cache-bust `admin-dashboard.js` / `styles.css` `?v=20260727-admin-changelog`.

---

## 2026-07-27 — Ship trial credits + X MP4 share

- One-time $10 Render Studio Key trial (`grant_signup_trial_if_needed`), trial email, welcome popup + `/api/user/ai-credits/trial-ack`.
- Share to X prepares MP4 (`blobForXShare`) before compose/download; cache-bust `?v=20260727-trial-mp4-ship`.
- Pushed `3883b13` / `56d520c` + follow-up label/cache commits; restart `render3d.service`.

---

## 2026-07-27 — Changelog comprehensive backfill

- Rebuilt `CHANGELOG.md` + `DEVELOPER_CHANGELOG.md` from full `ai-context/worklog.md` (Jul 19–27) plus git reconstruction (Jun 19; Jul 6–7, 10, 14–17).
- Date headings (not SemVer). Empty Auto-backup-only days omitted. Policy `backfillStatus: completed`.

---

## 2026-07-27 — X Corp in Authorized apps

- Added `/assets/brands/x-corp.svg` and an Account menu **Authorized apps** card (X + Discord) with connect/unlink.
- Preferences Authorized apps uses the same X logo + Connect CTA; shared `connectXAccount` PIN/popup flow.
- Cache-bust `app.js` / `styles.css` `?v=20260727-x-authorized`.

---

## 2026-07-27 — Mobile chrome: menu + profile + no corner overlap

- Linked `mobile-app-chrome.css`; hide 4-corner launchers for good (`display:none !important` — they were overlapping cube/FAB/tray).
- Menu toggle is a low-profile chip until expanded; studio tiles navigate (Explorer/AI/Tools/etc.) via `Render3DMobileStudio`.
- Slim header keeps profile avatar visible top-right; tools FAB centered above pick tray.
- Cache-bust `?v=20260727-mobile-chrome`.

---

## 2026-07-27 — Simple Changelogs adopted + worklog backfill

- Policy: `.simple-changelogs.json` distribution `web`, developer history required, signatures on, new surfaces ask.
- Created `CHANGELOG.md` + `DEVELOPER_CHANGELOG.md` from `ai-context/worklog.md` (2026-07-19 → 2026-07-27) + ship commit `237c533`.
- Date headings (no SemVer tags found). Pre-worklog history not reconstructed.

---

## 2026-07-27 — X media INIT failed (empty 403)

- Cause: OAuth1 used v1.1 `upload.twitter.com` INIT → empty **403**. v2 INIT works; finalize hits **credits depleted**; tweet create needs Read and write app permissions.
- Share to X (video) now opens compose + downloads the clip (no API media credits needed).
- Backend OAuth1 media prefers v2 initialize/append/finalize; clearer errors for empty 403 / credits / Read-only.

---

## 2026-07-26 — Export share scoped to the model (not whole scene)

- Sharing `Shower_Door…step` baked every eye-visible sibling (old Parametric assembly + other mounts) and sometimes rooted the link on `.3mf` (no GLB preview).
- Export → Copy share link now prefers sibling `.glb` and scopes `visible_filenames` to that model stem; 3MF resolves to GLB for the public viewer.

---

## 2026-07-26 — Texture apply on timeline + Solid remove texturing

- Applying library/render textures now records timeline kind `texture` (icon 🧱 + user), not a generic Upload.
- Solid-mode right-click marking menu: **Remove texturing (back to original rendered colors)** (Architect keeps AI Wall Texture).
- Remove prefers timeline restore when the latest step is a texture apply; otherwise strips maps and saves `texture_remove`.
- Upload accepts optional `history_kind` / `history_label` form fields. Cache-bust `app.js` / `timeline.js` `?v=20260726-texture-tl`. Backend restart applied.

---

## 2026-07-26 — Admin Recent Notifications tab

- Added **Notifications** view on `/admin-dashboard.html`: review signup alerts + suggestions/bugs one at a time (Prev/Next, ←/→, filters).
- New module `frontend/admin-notifications.js`; thin wire into `admin-dashboard.js`. Actions reuse existing review/message APIs.
- Cache-bust `admin-dashboard.js` / `styles.css` / HTML `?v=20260726-admin-notif`.

---

## 2026-07-26 — wormGear dark mesh + clipping

- Project `0dae20dc`: dense ~100k-tri worm/wheel GLB looked near-black because CAD crease edges + black silhouettes covered the plastic shading (z-fight / “wireframe void”).
- `scene-style.js`: skip edges/silhouettes above 24k tris; recompute normals + DoubleSide on dense meshes.
- Geometry: center distance uses worm **pitch** radius (not major) + slightly more clearance; lighter loft; regenerated Reduction assembled + exploded.
- Cache-bust `scene-style` / `app.js` `?v=20260726-worm-mesh-lit`. Hard-refresh; reopen wormGear.

---

## 2026-07-26 — Kimi CAD complete left empty viewport (Rigging hid CAD)

- Kimi job `882f9767` on `184f51c9` succeeded (valid GLB + snapshots); viewport looked empty because Rigging URDF with box placeholders called `setCadAssemblyHiddenForUrdf(true)`.
- CAD/Mesh completion now exits Rigging → SOLID, clears URDF overlay, and forces CAD visible.
- Primitive-only URDF visuals no longer hide CAD (mesh visuals still can). Photoreal Render with non-OpenAI key gets an early clear error.
- Cache-bust `app.js?v=20260726-kimi-cad-reveal`. Hard-refresh.

---

## 2026-07-26 — Gripper URDF movable jaws + re-author prompt

- Error on `184f51c9` (`d13e7c4f`) was real: AI `gen_urdf()` left roots `base_plate`/`cover_plate`/`pinion`, then preferred all-fixed so Rigging showed “No URDF movable joints”.
- Hand-authored single-tree `gen_urdf`/`gen_srdf`: prismatic `rack_left_slide`/`rack_right_slide` (±20 mm), revolute `base_to_pinion`; regenerated `.urdf`/`.srdf` (root `base_plate`, 3 movable).
- Author prompt now requires grippers/arms to emit prismatic/revolute (not all-fixed). Restart `render3d` when idle so that prompt is live for future `/rigging/author-robot` runs.

---

## 2026-07-26 — Loading steps only count forward

- Repair loops used to rewind the spinner from e.g. step 6 → 3.
- Overlay now freezes at the peak step and shows **Revising model** instead of jumping backward.
- Cache-bust `?v=20260726-revise-forward`.

---

## 2026-07-26 — URDF multi-root robot artifact failure

- `gen_urdf()` for NEMA utensil gripper left disconnected roots (`base_plate`, `cover_plate`, `pinion`) → UrdfSourceError.
- Fixed project `184f51c9` joints (cover + pinion under base_plate); regenerated URDF.
- Pipeline now auto-repairs multi-root once (fixed joints to preferred root + patch source) before failing; author prompt stresses single-tree rule.

---

## 2026-07-26 — Switching projects no longer stops another project's generation

- Bug: a single global `generationPollTimer` meant opening project B while A was generating replaced A's watch; `cancelActiveGeneration` could also fall back to `generationWatchPid` and cancel the background project. Generate mid-spice could rebind POST to the newly opened project.
- Fix: per-project `generationPollTimers` Map (sibling polls keep running); Stop/cancel only targets the open project (or explicit pid); pin `submitProjectId` for improve+POST so project switches don't steal the job.
- Cache-bust `app.js?v=20260726-multi-proj-gen`. Playwright: two watches stay alive across A↔B with zero `/generation/cancel` on switch.

---

## 2026-07-26 — Fix generationPollTimer ReferenceError

- After per-project `generationPollTimers` Map refactor, four call sites still referenced singular `generationPollTimer` (undefined) — broke generate/resume on projects like `ee20a13f`.
- Replaced with `hasGenerationPoll(projectId)`. Cache-bust `?v=20260726-poll-timer`. Hard-refresh.

---

## 2026-07-26 — Wiring Simulator restored + mesh.mjs /bodies 500

- Wiring Simulator workspace itself was intact (Blink demo loads 4 parts / 7 wires). Accidental `app.js` regressions had reintroduced locked `rotateX(-90°)` upright tip and weakened Mesh authored-style retention.
- Restored upright lock + `keepAuthoredStyle` / `hasMeshFactorySibling` from snapshot; kept Mesh `lockedPromptMode` so Mesh≠2.0.
- `/api/.../files/*.mesh.mjs/bodies` was 500 (`file_type 'mjs' not supported`) when mesh projects opened tools/wiring — now returns empty unsupported payload (200).
- Cache-bust `app.js` / `ai-key-ui.js` / `scene-style` `?v=20260726-wiring-restore`; restarted `render3d`.

---

## 2026-07-25 — Mesh selection no longer snaps back to CAD 2.0

- Bug: choosing Mesh then Generate while a prior 2.0 job was active/resuming still POSTed `mode: v2` (Kimi included). `beginGenerationWatch` called `applyPromptModeUI(runningMode)`, stealing the picker mid-click before the request body was built.
- Fix: stop forcing the compose mode from generation watch; snapshot `lockedPromptMode` at Generate click and use it for routing/`mode` in the body (restore UI after resume).
- Cache-bust `app.js` `?v=20260725-mesh-mode-stick`. Verified: with mid-flight 2.0 steal, improve+prompt still send `mode: mesh`.

---

## 2026-07-25 — Mesh finished off-project left empty viewport

- Root cause: Mesh for `a096cb1a` completed while viewing another project; completion marked applied without loading the GLB, so reopen skipped reveal.
- Fix: track `pendingViewportReveal`; reopen / empty-assembly resume forces `applyGenerationComplete`; `loadProject` ensures `latest_file` and won't soft-skip an empty assembly; Design←Wiring reloads if no mesh; list `.mesh.mjs` in project files for shaded style.
- Cache-bust `?v=20260725-mesh-viewport-reveal`. Needs service restart for file-list change.

---

## 2026-07-25 — Mesh generating chrome matches Mode 2.0 orange

- Mesh spinner / canvas banner / timeline pending steps now use the same orange Jake chrome as Mode 2.0 (`timeline-step--v2`, `viewport-spinner--v2`).
- Mesh button branding (purple→cyan) unchanged — only the in-flight generating UI.
- Restart behavior already identical: stuck gens are stopped on startup, no auto-resume / no re-bill.
- Cache-bust `?v=20260725-mesh-orange`.

---

## 2026-07-25 — Chat images open in-app lightbox

- Project chat image thumbs were `<a target="_blank">` and opened a new browser tab.
- Click now opens an in-app lightbox (backdrop / ✕ / Escape); Escape closes lightbox before chat.
- Cache-bust `project-chat.js` / `chat-social.css` / `app.js` / `styles.css` `?v=20260725-chat-lightbox`.

---

## 2026-07-25 — Kimi tool-agent costs were priced as OpenAI

- Kimi list prices were already in `ai_cost.py` ($3/$15 for `kimi-k3`).
- Bug: Jake tool-agent traces hardcoded `provider: openai`, so some Kimi turns were overcharged (~2×).
- Fix: use `self.ai.provider` for tool-agent + timeout salvage cost estimates. Needs service restart after in-flight gens finish.

---

## 2026-07-25 — Kimi selection no longer snaps back to Claude

- Bug: prompt-key UI treated every non-Claude provider as OpenAI; `normalizePlatformProviderId` was missing in `app.js` (threw when reconciling platform picks). Selecting Kimi could silently keep/patch Anthropic.
- Fix: real Kimi platform choice, provider normalize helper, personal Save/Use disables Render Studio shared Claude fallback and selects `personal:<id>` in the compose picker.
- Cache-bust `app.js` / `ai-key-ui.js` `?v=20260725-kimi-stick`.

---

## 2026-07-25 — Fix “Save & activate” doing nothing on Add AI key

- Symptom: Add a new key (e.g. Kimi) → green **Save & activate** produced no POST / no error.
- Cause: save relied only on native `<form submit>` + HTML5 `required` (easy to miss validation UI in the scrolled dark modal).
- Fix: explicit button `click` → `saveNewKey()` with visible errors above the button, loading label, `novalidate`, and cache-bust `?v=20260725-save-activate`.
- Also: platform model change no longer coerces Kimi → OpenAI.

---

## 2026-07-25 — Shared credits: Kimi K3 (V3) platform key

- Added `KIMI_API_KEY` (+ `KIMI_MODEL` / `KIMI_MODEL_QUALITY=kimi-k3`) to server `.env`.
- Credits path now offers **Render Studio Kimi** alongside OpenAI/Claude (`ai_credit_service` + platform key UI).
- Default Kimi quality model: `kimi-k3` (V3). Cache-bust `app.js` / `ai-key-ui.js` `?v=20260725-kimi-credits`. Service restarted.

---

## 2026-07-25 — Viewport: stop orbit continuing after mouse-up

- Trackball could stay in ROTATE if pointerup was missed / controls disabled mid-drag — view kept following the cursor.
- New `trackball-pointer-safety.js`: force-end drag on window pointerup/cancel, blur, `buttons===0` while moving, and when `controls.enabled` flips off.
- Exploded/assembled auto-orbit: resume timer now starts on pointer**up**, not pointerdown (so long drags don’t restart orbit mid-hold).
- Cache-bust `app.js?v=20260725-orbit-up`.

---

## 2026-07-25 — Mobile: models no longer pure black in look-dev

- Mesh look-dev used ambient 0.05 + RoomEnvironment IBL; on phones IBL often fails → metal PBR shades black.
- New `mobile-viewport-lighting.js`: on mobile or missing env, bump hemi/ambient/key/fill, show CAD fill if no IBL, soften envMapIntensity, smaller shadow maps.
- Mobile WebGL: `powerPreference: default`, no logarithmic depth, lighter antialias.
- Cache-bust `app.js` / `scene-style.js` `?v=20260725-mobile-lit`.

---

## 2026-07-25 — Admin Recent Projects sort

- Sort dropdown on Admin → Recent Projects: date (newest/oldest), name A–Z/Z–A, person A–Z/Z–A, cost, files.
- Module `frontend/admin-project-sort.js` + `.css`; preference in `localStorage` (`render3d:adminProjectSort:v1`).
- Cache-bust `admin-dashboard.js?v=20260725-project-sort`.

---

## 2026-07-25 — Fusion unlink howto: Break Link menu shot

- Added `frontend/media/fusion-unlink-break-link.png` (right-click menu with Break Link) + pointer “3 · Break Link”.
- Howto callout now shows browser chain close-up + Break Link menu; steps row below.
- Cache-bust `fusion-unlink-howto.js/css?v=20260725-break`.

---

## 2026-07-25 — Fusion export unlink howto popup

- After Fusion export/push, show one-time screenshot popup (X top-right + Don’t show again) explaining Insert → chain-link → Break Link before Extrude/Cut.
- New modules: `frontend/fusion-unlink-howto.js` + `.css`; assets `frontend/media/fusion-unlink-{full,browser}.png` with pointers on the chain icon.
- Wired from `file-actions.js` (push + shared export), `fusion-panel.js`, and `app.js` workspace push.
- Cache-bust: `file-actions.js` / `fusion-panel.js` `?v=20260725-unlink-howto`, CSS `?v=20260725-unlink2`.

---

## 2026-07-25 — Fusion Part push: standalone Part file (not linked Assembly)

- Cut failed with “No target body found…” because Fusion opened a **linked** `Parametric_Assembly_Of…` insert (chain icon) under an Unsaved parent — often from versioning an old Assembly-named item.
- Part pushes now upload as sanitized `…_Part.step` (Assembly wording stripped), after flatten; never rewrite back to Assembly names via allow-list.
- Part STEP product label cleaned; refuse still-linked/faceted Part writes. Success copy: Open from Data Panel, don’t Insert / Break Link.
- Cache-bust `app.js` / `file-actions.js` / `fusion-panel.js` `?v=20260725-fusion-part-open`. Service restart required.

---

- Long prompts (e.g. Yeti enduro bike) were sticking in the compose box and getting re-saved into whatever project you opened next during the async `loadProject` gap — so the same text showed up in House Framing, Gripper, etc.
- On project switch: save outgoing draft → clear compose UI + lock saves → restore the new project’s draft.
- Cache-bust `app.js?v=20260725-prompt-draft-lock`. Hard-refresh; clear the compose box once if the bike text is still sitting there.

---

- Fusion/APS imports stayed “turned left”: they’re often Y-up, and long floor plans have tallest=X so the Jul 16 axis heuristic skipped them.
- Native gens stay on the axis heuristic only.
- `isFusionAuthoredModel` via `.autodesk_source_*` + `project_summary.fusion_source`; Fusion tip only when still Y-up (incl. tallest=X with Y≳Z). Do **not** always-rotate (that tipped already-Z-up Fusion screwdrivers).
- Cache-bust `app.js?v=20260725-fusion-yup2`. Hard-refresh / reopen the Fusion project.

---


- Main Export no longer bakes all visible siblings (that pushed arduino / wrong compound). Always exports the **selected/focused** model only.
- Fusion/cloud forced onto that model’s native `.step`; server Part-flattens for Extrude/Cut and refuses linked/faceted uploads.
- `ensure_fusion_part_step` regenerates when native is newer (no stale Part cache).
- Cache-bust `app.js` / `file-actions.js` `?v=20260725-export-one`. Service restarted.

---


- Footprint ±90° scorer was still in `ensureModelZUp` despite earlier “restored” comment — that tips bikes/long assemblies onto their side.
- Restored Jul 16 axis heuristic + GLB/GLTF flip exclusion + `v2-upright` fixed tip. Locked via `.cursor/rules/model-upright-orientation.mdc`.
- Cache-bust `app.js?v=20260725-upright-axis`. Hard-refresh / reload project to re-orient.

---


- Extracted policy to `frontend/viewport-transform-undo.js`; hotkeys refuse timeline fallthrough when top undo is a transform.
- Always-on Cursor rule `.cursor/rules/cmdz-transform-undo.mdc`; listed in `AGENTS.md` + conventions red zone.
- Backend `_surgical_undo_transform` marked LOCKED. Cache-bust `app.js?v=20260725-cmdz-lock`.

---


- Peach cube placeholders: Model Derivative kickoff after Fusion push was always `406` because the job requested unsupported `svf2` for WIP STEP uploads (sometimes `400` too).
- Kickoff now tries `svf`+thumbnail → `svf` → thumbnail → `svf2` fallbacks, logs warnings, extracts tip `version_id` from create-item, and runs on `upload_step_as_new_version` too.
- Re-export / Replace in Fusion to regenerate thumbs on existing files (or open once in Fusion). Service restarted.

---


- Root cause: Export/Fusion/admin latched onto timeline `latest_file` (often a tiny sibling like `arduino_uno_q`) instead of the visible / Fully_Assembled model. Logs showed Fusion push `requested=arduino_uno_q` with `allowed=[]`.
- Restored Jul 24 golden **visible-only** studio export (eye icons matter again); sidebar export + admin prefer Fully_Assembled / largest primary over latest.
- Admin download lists each model’s STEP separately; default is primary + `?step_mode=part` (flatten for Extrude/Cut).
- Studio STEP download defaults to Part; Fusion push debounced; no sibling STEP fallback on assembly bake.
- Cache-bust `app.js` / `file-actions.js` / `admin-dashboard.js` `?v=20260725-export-visible`. Frontend-only (no service restart).

---


- Bug: after a gizmo move, Cmd+Z fell through to `undoTimeline()` on the previous generation when the transform tip wasn’t ready — that restored an old snapshot and wiped sibling parts.
- Transform undo now only reverts pose or a real transform timeline tip; never undoes prompt/build steps. In-flight auto-apply is cancelled on undo.
- Backend single-step transform undo restores only the moved file (no full-project wipe).
- Cache-bust `app.js` / `gizmo-panel.js` `?v=20260725-undo-move`. Service restarted.

---

## 2026-07-25 — CAD colors: no black / charcoal / aluminium on dark canvas

- Part palette was aluminium / charcoal / matte black — invisible on the dark viewport.
- Switched backend + viewport + AI color guidance to bright studio blues/teals/ambers/corals; `black` named color maps to slate.
- Cache-bust `scene-style.js` / `app.js` / `project-assembly.js` `?v=20260725-bright-cad`. Service restarted.

---

## 2026-07-25 — STEP Part/Assembly export restored

- Part STEP download was broken: chooser never ran, and `?step_mode=part` no longer flattened.
- STEP click again offers **Part** (flatten for Extrude/Cut) vs **Assembly** (as authored).
- Backend `_file_response` + Fusion push honor `step_mode=part|regular` via `ensure_fusion_part_step`.
- Cache-bust `?v=20260725-step-part`. Service restarted.

---

## 2026-07-25 — Viewport: stop tipping models onto their side

- Bike/long assemblies were loading “tilted left” because the footprint ±90° scorer preferred the side face as the floor.
- Restored Jul 16 `ensureModelZUp` axis heuristic: only rotate clear Y-up (tallest axis Y); leave already-Z-up models alone.
- Cache-bust `app.js?v=20260725-upright-jul16`.

---

## 2026-07-25 — Fusion Extrude/Cut: restore Jul 16 native STEP export

- Cut was broken because Export/Fusion kept sending rewritten `*.part.step` via `ensure_fusion_part_step` / `export_step_as_single_part` (and `step_mode=part`).
- Jul 16 / Jul 21 / Jul 24 production goldens upload **native solid B-rep as-is** — no Part rewrite.
- Restored that path: push + downloads + `list_exports` prefer native `.step`; demote `*.part.step`; frontend sends `step_mode: native` and `upload_source: false` (still one file).
- Cache-bust `?v=20260725-cut-native`. Service restarted.

---

## 2026-07-25 — Mesh export: Node path fix + Mountain Mike recover

- `@prompt:3e161b4d3a7a` / `a096cb1a` failed after 12 tries: `_find_node` glob was `linux-*/node` but Cursor ships `linux-x64/<hash>/node`. Systemd PATH has no `node`.
- Fixed glob + `RENDER3D_NODE` systemd drop-in; fail-fast before AI burn; no retry on Node-missing.
- Recovered `Stylized Cartoon Mountain mountain Mike.glb` from the saved `.mesh.mjs`. Service restarted.

---


- Mesh/authored models now use showcase-style look-dev: RoomEnvironment IBL, cinematic key/rim/accent lights, radial dark backdrop, stronger contact shadow.
- Mode 2.0 / CAD keeps the soft studio light rig (no env map). Switch is automatic via `applyViewportStyle(..., syncViewportLights)`.
- Viewport light slider scales the active rig. Cache-bust: `scene-style.js` / `app.js` `?v=20260724-mesh-lookdev`.

---

## 2026-07-24 — Prompt draft: per-project only, clear on submit

- Global `aiComposeDraft` was restoring the same text into every project’s prompt box.
- Drafts now save only under `modelPromptState` keyed by project; global key cleared/migrated.
- Successful Generate / Answer / Render submit clears the compose box and that project’s draft.
- Cache-bust `app.js?v=20260724-prompt-draft`.

---

## 2026-07-24 — Fusion: one Part STEP, no companion .py

- Two Fusion files came from auto-uploading `*.build123d.py` next to the STEP (`upload_source` defaulted true).
- Backend now uploads companion source only when `upload_source: true` (explicit). Frontend always sends `false`.
- Push always flattens linked assemblies to a Part STEP for Extrude/Cut; refuses upload if links remain.
- Cache-bust `?v=20260724-fusion-one-step`; service restarted.

---

## 2026-07-24 — Fusion: select root folders to export

- Top-level (root) folders now show an explicit **Select** + **Open** row so you can export into Render Studio/etc without opening first.
- Cache-bust `?v=20260724-fusion-root`.

---

## 2026-07-24 — Fusion export: no auto folder select

- Stopped auto-selecting last/first/current folder and auto-diving past project root.
- Hub/project may still restore; folders start unselected until the user clicks one (✓).
- Cache-bust `file-actions.js` / `app.js` `?v=20260724-fusion-noauto`.

---

## 2026-07-24 — Fusion Export CTA visible (orange)

- Export submit used faint `.btn.primary` blue and was easy to miss / look “not there”.
- Bright orange sticky footer CTA + destination line; pulse on folder select; second click on selected folder starts upload.
- Cache-bust `?v=20260724-fusion-cta`.

---

## 2026-07-24 — Fusion folder click = select with ✓

- Folder tiles used to **Open** on click, so picking a destination inside Render Studio felt broken.
- Click folder → select export target + green ✓; separate **Open** browses inside.
- Taller folder grid; cache-bust `?v=20260724-fusion-check`.

---

## 2026-07-24 — Fusion Export button pinned (no scroll)

- Export CTA was clipped: picker lived inside `.file-export-actions` under STEP/GLB chrome, so “Export to Fusion” sat below the fold.
- Picker is now a direct menu child; download chrome hidden while open; sticky `.file-export-fusion-footer`; menu pinned to top.
- Second tap on the selected-folder chip also triggers Export.
- Cache-bust: `styles.css` / `app.js` / `file-actions.js` `?v=20260724-fusion-pin`.

---

## 2026-07-24 — Textures kept (CAD wipe) + better wrap; Mode 2.0 untouched

- Library/render textures were wiped on reload: `applyCadStyle` treated white+map as washed and dropped maps / swapped shared face plastic.
- Textured GLBs now tagged `render3dPipeline=texture`; maps force authored style. `afterModelEdit` passes `styleMode: shaded` only for texture actions (Mode 2.0 stays CAD).
- Better box UVs (physical tiling + boost for small parts), anisotropy / mipmaps, brighter env.
- Cache-bust: `scene-style.js` / `app.js` `?v=20260724-texture-keep`.

---

## 2026-07-24 — Why Connect X / Share to X fail

- Root cause: `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` are **missing from `.env`** (never present in live or backup envs). `twitter_link_service.configured()` is false → Connect disabled, link-url returns 503.
- Callback route `/oauth/twitter/callback` is fine; redirect default is `https://render3d.app/oauth/twitter/callback`.
- Documented vars in `.env.example`; clearer UI copy. Needs real X developer app credentials to enable.

---

## 2026-07-24 — Export/share: all models, never stale ball token

- Share links were reusing old tokens and/or baking the wrong sibling (Arduino / ball) via eye-hide filtering; Fusion push followed the same allow-list bugs.
- **Export everything:** `collectProjectExportFilenames()` ignores hide state, dedupes by stem (prefer STEP), and multi-model Export always POSTs `/assembly/exports` with the full list.
- **Fresh shares:** `createShareUrl` always sends JSON + `force_new`; rejects `"visible|project assembly"` placeholders; backend clears old `viewer_filename` and rebakes `_share_visible_*` from the full filename list.
- Per-file Export no longer blocked when eye-hidden; Export button enables when any model files exist.
- Cache-bust: `app.js` / `file-actions.js` `?v=20260724-export-all`. Restarted `render3d` for `main.py` + `cad_service.py`.

---

## 2026-07-24 — Mode 2.0 CAD shading: Mesh PBR heuristic only

- Bug: Mesh PBR “vivid/shiny” auto-detect flipped Mode 2.0 STEP/GLB previews into authored shading (black / unlit).
- `prefersAuthoredShading` now only honors Mesh markers (`.mesh.mjs` / `render3dPipeline=img2threejs|mesh` / explicit style extras) — no color heuristics.
- Cache-bust: `scene-style.js` / `app.js` / `share-viewer.js` / `mini-viewer.js` `?v=20260724-cad-style-fix`.

---

## 2026-07-24 — Right-click Export works without opening the project

- Sidebar project list summaries set `latest_file: null` / `files: []` until a project is opened, so right-click **Export / share…** on an unselected project always said “no model to export.”
- `exportProject` now fetches project detail when the filename is missing, then opens the export menu for that project id.
- Cache-bust: `app.js?v=20260724-export-unopened`.

---

## 2026-07-24 — Fusion export: one button + fit viewport

- Fusion folder UI had many Export buttons (per-folder + “export here” + bottom submit) and the menu spilled past the screen.
- Folders now **Select** only; a single bottom **Export to Fusion** submits. Picker body scrolls; menu max-height clamped to the viewport.
- Cache-bust: `app.js` / `file-actions.js` / `styles.css` `?v=20260724-fusion-one-btn`.

---

## 2026-07-24 — AI compose panel: no outer scrollbar

- Right AI panel scrolled as a whole (`overflow: visible` on sidebar/compose unlocked for old in-panel mode tips).
- Removed that unlock (tips are body-portaled). Chrome stays put; only the prompt editor scrolls. Compacted cost thumb + toolbar so typical heights fit without an outer bar.
- Cache-bust: `styles.css?v=20260724-ai-noscroll`.

---

## 2026-07-24 — Mesh models keep Three.js PBR (not CAD plastic)

- Viewport `applyCadStyle` was rewriting Mesh/img2threejs GLB materials to Fusion plastic + edges, so colors never showed.
- Auto-detect `.mesh.mjs` siblings / PBR heuristics / export `render3dPipeline=img2threejs` → `applyAuthoredStyle` (preserve materials).
- Cache-bust: `scene-style.js` / `app.js` `?v=20260724-mesh-pbr`. Re-exported bike GLB.

---

## 2026-07-24 — Mesh GLB Y-up → Z-up (was upside down / on side)

- img2threejs factories are Three.js Y-up; exporter seated on Z and the viewport sometimes flipped wrong.
- `export_glb.mjs` now detects Y-up, `rotateX(π/2)` (+Y→+Z), then floor-seats. Re-exported bike GLB on `4162ee20` (`y_up_converted: true`, height on Z).
- MESH_SYSTEM documents Y-up authorship.

---

## 2026-07-24 — Mesh Edit selected keeps the selected stem

- Target Edit/New already sent `target_mode` + `base_filename` for 2.0/Mesh.
- Mesh Edit without a `.mesh.mjs` used to invent a new prompt stem; now keeps the selected object stem and overwrites that GLB. New still creates a fresh name.

---

## 2026-07-24 — Overlay model label: Fable 5 not claude-fa…

- Viewport usage footer showed raw ids (`claude-fable-5`) and ellipsized to `claude-fa…`.
- `shortOverlayModel` now strips provider prefixes and uses short names (`Fable 5`, `Opus 5`, `GPT-5.5`).
- Cache-bust: `viewer-overlay.js` / `app.js` / `styles.css` `?v=20260724-model-short`.

---

## 2026-07-24 — Mesh tab uses img2threejs coloring (not CAD cyan)

- Mesh prompt control looked like Fusion/CAD sky-blue; restyled to img2threejs logo palette (purple `#8b5cff` → cyan `#38e8ff`) with their cube logo on the button + tip badge.
- Generation banner for Mesh matches the same look. Tip copy clarifies “not CAD / STEP”.
- Asset: `frontend/assets/img2threejs-logo.svg`. Cache-bust: `styles.css?v=20260724-img2threejs-look`.

---

## 2026-07-24 — Electronics toggle always visible in prompt mode row

- Electronics was hidden whenever Mesh (or Render) was selected, which made it look removed after Fusion → Mesh.
- Toggle stays visible next to Render / 2.0 / Mesh; `model_electronics` still only applies on 2.0 / Architect generates.
- Cache-bust: `app.js?v=20260724-electronics-back`.

---

## 2026-07-24 — Mesh continues like 2.0 (review loop) + bike recovery

- Prompt `1454cceb8347` / trace `d211cfc2` on `4162ee20` was **canceled** mid-try (`Stopped: Mesh cancel UI fix`) right after the factory write, before GLB export — not an AI failure. Factory was valid; exported recovered bike GLB into the project.
- Mesh pipeline now mirrors 2.0: write → export → brief review → repair (budget 12), Mesh checklist (not CAD), finish current export / ship last-good GLB on stop.
- Files: `backend/services/mesh_service.py`, `generation_service.py` checklist, `design_service.py` repair budget. Service restarted.

---

- Creating a project kept the prior session’s prompt mode (e.g. Mesh/Render).
- `createNewProject` / `createNewProjectInFolder` now call `applyPromptModeUI(DEFAULT_PROMPT_MODE)` (`v2`) after load.
- Cache-bust: `app.js?v=20260724-new-v2`.

---

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

- Inside a Fusion folder (e.g. Render Studio) there is a primary **Export to Fusion · {folder}** button — no subfolder required.
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

- Export → Fusion folder browser is now a **2-column tile grid**; click a tile to open nested folders (e.g. Project Files → Render Studio → …).
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
- Verified: Sam ~94 root projects restored; Vineet still 1 personal + Render Studio shared folder.
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

- Problem: accepting a workspace invite dumped that team's root projects into the invitee's personal Projects root (Vineet had 1 personal + ~60 Render Studio models mixed).
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

- Updated `frontend/index.html` `<title>`, `og:title`, `twitter:title`, and descriptions to **Render Studio — The AI & Robotics Studio** (was “AI Product Studio”).

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
