# Promoting tested sandbox work

Keep experiments in `frontend/sandbox/`. The sandbox can call existing APIs, but a working prototype does not by itself prove that a change is safe in Studio.

The **feature control board** inside Super IDE / workshop (`02 · WORKSHOP` → Feature board, token `featboard1`) is the source of record for what is **live** vs **sandbox-gated**. Operators promote and flag there. This file is the promotion *procedure*; the board is the live switchboard.

## Safety (do not skip)

- Do not wholesale-copy `frontend/sandbox/boot.js` (or demo chrome) into Studio.
- Save **golden snapshots** of viewport, models, VR trigger, and chat before you change Studio.
- Run `node --test frontend/sandbox/*.test.js` and focused tests for every production module you touch.
- Headset-test XR. A server smoke check cannot validate WebGL or Quest input.
- If something regresses, revert the production diff and attach the first failing `log_id` plus the last working snapshot.
- Sam control lock `sam-y-record-v3` (Y tap calibrates + activates/pauses/reactivates, Y hold resets, A records/saves, B discards, Grip removed) stays locked. Do not restore X+A deadman, Gripper dropdown, or dual Engage configs.
- MCP write jail stays under `frontend/sandbox/` unless Sam toggles **Sandbox** on FILEVIEW1. Never open `frontend/xr/` from the jail.
- One live instance each of Studio viewport, Viser, DIMOS (`:8443` coordinator — do not spawn a second), and MuJoCo. Reuse via `sandbox-live-instances.js`.
- One speaker. Shop crew and teaching trainees stay quiet until they find something.

## Workshop as the shop (real-to-size)

The workspace is a **shop-scale** bench so Sam can have AI controlling OpenArm in the same room as wiring, whiteboard, Viser, and MuJoCo — not a tiny overlay.

- **Feature board** — live vs gated: viewport, viser, dimos, mujoco, wiring, whiteboard, teaching, shop-print-check, sandbox-writes.
- **Tech wall** — one debug/extraction surface: health, WebGL inventory, VR controls snapshot, chat/collab, DIMOS coordinator, Viser proxy, MuJoCo `runs/latest.json`, teaching `latest-draw.json`, shop last alert. It **reads** existing instances; it does not spawn another iframe or coordinator.
- **Watch more → speed the cook** — teaching sessions record draw strokes and cook-like procedures (prep → do → plate). Watching more generates **new moves** and queues **emails** (Comms) plus **shoot files + music** (Marketing / Clip-bot) without overlapping talk bars.
- **Task assignment** — Agents tab **Assign shop pack**: video production (shoot + music), several seats on the wiring simulator, and **new ways to model** (block-in / scan / clay) as tasks — not bot programming in File IDE.
- FILEVIEW1 shows **real Studio project files**. Sandbox programming only when the board/toggle is on.

## Update receipt (before Sam merges)

Every ship leaves an **UPDATE_RECEIPT** (`sandbox-sessions/receipts/latest.json`). Harness Mule runs the guard pack and sets `bot_verdict` green / yellow / red. Full protocol: `Getting-Started/agents/UPDATE-RECEIPT-PLAN.md` · bot prompt: `PROMPT-receipt-guard.md`.

## Procedure

1. On the **feature control board**, mark the feature live or gated. Save a golden incident snapshot for current Studio states (viewport, models, VR trigger, chat).
2. Record the sandbox revision, files changed, **board flags**, and a short reproduction path. Keep the smallest working change.
3. Run sandbox checks: `node --test frontend/sandbox/*.test.js`. Repeat the path in a desktop browser and, for XR, a headset. Capture success and failure. The query dashboard’s feature timeline and cross-feature scan produce **leads**, not automatic root cause. The VR recorder is **opt-in** and stores compact button-edge counts and tool IDs in XR notes; it never stores headset poses, audio, prompt text, or raw frames.
4. Isolated branch or worktree. Copy only the reviewed behavior into the production module. **Mapping (sandbox source → intended production target):**

   | Sandbox source | Production target |
   |---|---|
   | `frontend/sandbox/studio-viewport-replica.js` | Workshop host only — do not copy into `frontend/studio/app.js` boot |
   | `frontend/sandbox/sandbox-live-instances.js` | Pattern for single iframe/coordinator; Studio already owns viewport + Viser (`frontend/studio/viser-viewer.js`) |
   | `frontend/sandbox/openarm-viser-pane.js` | Super IDE NW only; Viser iframe src mirrors `/api/viser/p/{host}/{port}/` |
   | `frontend/sandbox/dimos-link.js` | Studio Preferences DIMOS host (`frontend/xr/xr-dimos-teleop.js` persist helpers — **do not rewrite lock**) |
   | `frontend/sandbox/openarm-mujoco/` | Stay sandbox; analysis feed `openarm-mujoco/runs/latest.json` → launch/repair, not prod Office |
   | `frontend/sandbox/project-file-viewer.js` | Studio project browser (`frontend/studio/app.js` `view=open` / `renderFileList`) |
   | `frontend/sandbox/ide.js` | Only if Sandbox writes are explicitly promoted; target is not Studio File tree |
   | `frontend/sandbox/sandbox-feature-board.js` | Future Studio feature flags / robotics rail — not a second HUD |
   | `frontend/sandbox/sandbox-tech-wall.js` | Live feed / health widgets in Studio; keep extraction paths |
   | `frontend/sandbox/sandbox-teaching-record.js` | Teaching → `sandbox-sessions/teaching/`; later LeRobot/export, not DIMOS arm |
   | `frontend/sandbox/sandbox-shop-task.js` | Print-readiness checks; optional Studio slicer notes |
   | `frontend/sandbox/agent-tasks.js` | Studio Agents / crew task lists |
   | `frontend/sandbox/smart-whiteboard.js` | Studio whiteboard / canvas tab (`frontend/studio/document-tabs.js`) |
   | `frontend/sandbox/sandbox-wiring.js` | Studio wiring tab |
   | `frontend/sandbox/live-feed.js` | Studio health / token / overlap chips |
   | `frontend/sandbox/query-dashboard.js` | Studio debugger / incident API UI |
   | `frontend/sandbox/tts-mutex.js` | Studio voice floor (`forceOneSpeaker`) |
   | `frontend/sandbox/boot.js` | **Never** copy wholesale into Studio |

5. Run focused tests for each production module touched, then smoke: viewport boot, model visibility/count, controller trigger/squeeze (Quest for XR), chat send/receive, API health, DIMOS coordinator still one `:8443`. Compare each with the golden snapshot.
6. Review the diff and test evidence before merging. If a regression appears, revert the production diff and attach the first failing `log_id` and last working snapshot.

## Tech wall extraction points (keep logs)

| Surface | Where |
|---|---|
| Prompt / `log_id` | Live feed prompt tail |
| Context | `/api/sandbox/context-log` |
| Teaching | `sandbox-sessions/teaching/latest.json`, `latest-draw.json` |
| Train episode | `openarm-mujoco/episodes/latest.json` |
| MuJoCo feed | `openarm-mujoco/runs/latest.json` |
| DIMOS | `/api/dimos/coordinator` (do not kill) |
| Viser | `/api/viser/p/{host}/{port}/` |
| Repair | `sandbox-sessions/latest-repair.json` |
| Remix | `sandbox-sessions/latest-remix-blueprint.json` |
| Control schema | `sam-y-engage-v2` · lock=sam |
