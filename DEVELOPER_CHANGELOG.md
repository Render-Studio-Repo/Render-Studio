# Developer Changelog

<!-- simple-changelogs-signature agent="Cursor Grok 4.5" at="2026-07-27T03:54:44+00:00" -->
## 2026-07-27

- X OAuth1 media path prefers API v2 `media/upload/initialize|append|finalize`; v1.1 `upload.twitter.com` INIT returns empty 403 for this app.
- Share-to-X video UI uses `x.com/intent/post` + local download (same pattern as screenshot markup); avoid API post when credits are depleted or app permissions are Read-only.
- `_x_error_detail` surfaces empty 403, credits-depleted (402), and oauth1-permissions failures clearly.
- Video studio / phone capture / mobile export flows landed in commit `237c533` (multi-track editor, QR phone capture, Bambu Handy send).

## 2026-07-26

- Export share: prefer sibling `.glb`, stem-scoped `visible_filenames`; 3MF → GLB for public viewer.
- Timeline `texture` / `texture_remove`; upload accepts `history_kind` / `history_label`.
- Per-project `generationPollTimers`; stop/cancel only the open project; pin `submitProjectId` for improve+POST.
- CAD/Mesh completion exits Rigging → SOLID, clears URDF overlay, forces CAD visible; primitive-only URDF no longer hides CAD.
- `scene-style`: skip edges/silhouettes above 24k tris; recompute normals + DoubleSide on dense meshes.
- URDF authoring: single-tree gripper joints; multi-root auto-repair once before fail.
- Loading overlay freezes peak step and shows Revising model.
- `/files/*.mesh.mjs/bodies` returns empty unsupported payload (200) instead of 500.

## 2026-07-25

- Mesh `lockedPromptMode` at Generate; `pendingViewportReveal` / reopen apply path for off-project Mesh completion.
- Kimi platform key + cost attribution via `self.ai.provider` (was hardcoded openai).
- `trackball-pointer-safety.js`; `mobile-viewport-lighting.js` for missing IBL.
- Fusion/STEP Part export restorations and unlink howto assets (operator-facing Fusion plugin paths).
- Prompt draft lock across `loadProject`; Admin project sort preference module.

## 2026-07-24

- Mesh pipeline: review loop parity with Mode 2.0, stem-scoped edit, GLB axis remap, authored-style retention vs CAD plastic heuristic.
- Export/Fusion: selection-scoped STEP, Part flatten for Extrude/Cut, folder grid picker, replace dialog, Model Derivative thumbnail kickoff fallbacks (`svf` before `svf2`).
- Connect X / share diagnostics; workspace member role APIs for invite/edit/view.

## 2026-07-23

- Robotic Simulator tab wiring; robot artifact URDF/SRDF generation with clearer errors; restored `_running_set` (generation NameError).
- Viewport video record control; share visibility filter for hidden models.
- Quest tracking preference relocation.

## 2026-07-22

- Shared workspace checkbox listing fix; invite popup.

## 2026-07-21

- Quest Book checkpoint progression and Complete header tracking toggle.

## 2026-07-20

- Added `ai-context/` worklog for session operator notes (source for this backfill batch).

## 2026-07-19

- Product Quest Book visual stage.
