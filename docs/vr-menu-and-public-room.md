# VR menu clicks and public-room joining

## September 15, 2026 fix

Menu backgrounds were treated as trigger-drag handles, including the explorer's
fallback hit region. A trigger drag could also survive into an early-return
Robotics button handler. Background clicks now leave windows stationary. A new
button click clears that hand's old trigger drag after input debouncing. Grips
and explicit Move/title/Rotate handles remain available; duplicate native and
polled trigger events do not cancel an intentional drag.

Public-room networking was still present: the authenticated public WebSocket
accepted connections and returned `presence.sync`. The client could leave a
timed-out socket in `CONNECTING`, preventing subsequent Join attempts from
opening a new connection. Join now waits for server presence confirmation,
closes failed sockets, and exposes connection progress and actionable errors.
Duplicate Join clicks share one attempt. Leaving cancels the pending result,
stale sockets cannot update the room, and established connections retain their
reconnect behavior. Both VR menu entry points show progress and errors.

The frontend asset imports are versioned with `menuroom1`. No backend or robot
control protocol changes are required. Reload Studio and re-enter VR to load the
updated modules.

## Verification

- 56 Node tests passed across the lobby, actual viewport select dispatch, window
  manager, robotics input, Pi controls integration, and Pi UI input suites.
- Four backend tests passed in `backend/tests/test_xr_two_client_relay.py`,
  including two public clients exchanging poses, strokes, RTC signaling, and
  object transforms, plus stored-pose replay for a newly joined client.
- Chromium used the actual viewport selection functions and lobby module in a
  small Three.js fixture. A background click kept the panel stationary; Join
  dispatched once, received live authenticated public-room presence, and opened
  the room view. No browser page errors occurred. The connection was closed after
  verification. This check sent no chat, poses, or robot commands.
- A separate full-editor browser startup check passed with no page errors and no
  Pi requests before Robotics was enabled.

[Browser evidence](verification/vr-menu-room-20260915.json)

Headset checks outstanding: physical trigger clicks on both menu layouts,
grip/Move/Rotate window manipulation, joining from two headsets, and disconnect /
reconnect during an immersive session. Browser verification used a test fixture,
not a physical WebXR controller.

## Visible public-room users (`presence1`)

The live room listed two connected Quest users. A prior performance change had
disabled all avatar meshes, including controller visuals, leaving only name tags.
Presence now always shows a lightweight head, torso, and two tracked controllers
when a peer has a headset pose. Detailed humanoids and held-CAD clones remain
disabled: the fallback uses five unlit meshes and 128 triangles per peer, with
shared geometry. Desktop users without headset poses no longer consume the
eight visible-avatar slots.

Pose change detection now includes head and controller rotations. The renderer
also applies rotation-only samples. A stationary headset publishes at least once
per second, and the public lobby replays its recent cached pose immediately after
a confirmed join or reconnect. Old samples older than 2.5 seconds are not replayed.
This fixes users remaining invisible after joining without moving.

Verification:

- All 112 Node tests passed across presence sending, lobby connections, avatars,
  controller selection, and hot-path helpers. A source-inspection test now reads
  the complete selection function rather than truncating it at 8,000 characters.
- Two isolated Chromium clients used the real `CollabHub` relay and frontend
  lobby/presence modules. Both saw the other's head, torso, and controllers with
  no post-join movement. Rotation-only updates, desktop-roster filtering,
  automatic reconnect, and removal on leave passed without page errors.
- The full editor started at the public site with no page errors and no Pi
  requests before enabling Robotics. Its WebSockets were intercepted to preserve
  the user's active headset connections.
- Browser poses were synthetic. Physical Quest rendering, controller tracking,
  and frame timing remain headset checks. Reload Studio on both devices and
  re-enter the public room to load the versioned frontend changes.

Reproduce the isolated browser check with
`.venv/bin/python scripts/tests/xr-public-presence-runtime.py`.
It does not connect to production rooms or send robot commands.

[Two-client evidence](verification/vr-public-presence-20260915.json) ·
[Rendered avatar](verification/vr-public-presence-20260915.png)

## Shared floor, walking, and model handoff (`roomfloor1`)

Public-room joins now place each user on the native `local-floor` plane, at an
unoccupied position near the room center. This preserves actual headset height
and crouching. `View → Recenter room` sends a room-wide floor/seating command so
everyone returns to separate positions facing the center. Public board/table
views also keep their vertical locomotion offset at zero. The board retains one
base reference space per immersive session; repeatedly capturing an already
offset space previously allowed offsets to accumulate.

- Left stick walks relative to the headset at up to 1.2 m/s, with a dead zone and
  normalized diagonal speed. Right stick snap-turns 30° around the user's head,
  once per stick deflection. Controller handedness determines the mapping.
- Aiming at a scrollable menu retains menu scrolling. Robotics keeps stick
  ownership while teleop is armed. Room recenter is queued until teleop pauses.
- Public-room project imports now create shared GLB instances through the
  existing share-file endpoint and public object relay. Importing a peer's
  announcement no longer opens their private project or replaces the viewer's
  active project. The project picker and component picker use the shared import
  path while in a public VR room. Duplicate pending import clicks are combined.
- Both users can grab the shared model. Active holding is published immediately,
  movement is throttled to 90 ms, and release applies the exact final transform.
  A held model rejects another grab until release or a stale holder timeout;
  simultaneous claims resolve consistently by user ID. Late joins replay the
  shared geometry link and last transform. Failed asset loads report an error.
- Shared models are centered independently of their original CAD origin, with
  dimensions/proportions retained under presentation scaling. A 180° quaternion
  no longer has its zero `w` component incorrectly replaced with `1`.

Verification used two isolated Chromium clients with the actual public-room
relay, shared importer, GLTF loader, board module, and viewport recenter and grip
functions. A synthetic user at 4.85 m returned to their native 1.85 m head height;
both floor offsets were zero. Geometry loading, holding, exact release, handoff
in both directions, and late-join replay passed. The full editor loaded without
page errors or Pi requests before enabling Robotics. No live headset sockets or
robot controls were used by the test.

All 126 Node tests passed across room navigation, shared imports/drops, board,
lobby, controller selection, hot-path helpers, and presence sending.

Run `.venv/bin/python scripts/tests/xr-public-presence-runtime.py` for the browser
regression. Physical Quest movement, snap-turn comfort, and grip handoff remain
headset checks. Both users must reload Studio, re-enter VR, and join the public
room. Import a model from the room's project/parts picker to use the shared
instance.

[Floor and handoff evidence](verification/vr-room-floor-sharing-20260915.json) ·
[Shared scene screenshot](verification/vr-room-floor-sharing-20260915.png)

## 2026-09-16 — shared outward camera, complete model inventory, Quest controllers

Robotics → **Share camera** explicitly requests the browser's outward-facing camera
(video only, no microphone), then sends it to current public-room peers using a
separate authenticated `rtc.signal` channel (`xr-camera-v1`). The window is visible
to room members: grip it to move it and use **− / +** to resize it. Guest pose changes
are relayed through the publisher so everyone sees the same placement. The owner
can stop from Robotics or the window header. Leaving the room, exiting XR, cancelling
an outstanding permission prompt, or a camera track ending stops publication and
removes the windows. Rejoining does not silently restart capture. Existing mic voice
and Pi hand-camera streams retain their own channels.

This is the **outward camera view**, not a capture of the private WebXR compositor.
A browser that exposes no environment-facing camera gets a visible permission or
unsupported-camera explanation in Robotics; it does not fall back to the avatar
camera. Meta's current investigation documents Quest 3 browser permission failures:
https://developers.meta.com/horizon/feedback/vr/investigations/1557993751977106/
The standard WebXR passthrough compositor itself is not readable as canvas pixels:
https://developers.meta.com/horizon/documentation/web/webxr-mixed-reality/
Physical Quest camera access remains a device/browser capability check.

Room model descriptors are no longer silently evicted after eight models. Existing
scene publication covers loaded project/assembly models and public imports. An
additional peer inventory exchange restores the complete room inventory for late
joiners even against the older running eight-descriptor relay. Adoption applies
world transforms relative to the local assembly parent, preserves the source model
on cleanup, and propagates parent/assembly movement while held. Inventory updates
do not steal another user's active grab. The server snapshot change takes effect on
its next ordinary restart; peer recovery works with the currently running relay,
so no live headset or robot session was restarted for this change.

Remote hands now use bundled left/right Quest Touch Plus GLBs from the MIT-licensed
WebXR Input Profiles assets. Each hand's static button/handle geometry is merged
once and cached with its texture: **one draw call per hand**, 4,470 triangles, with
native grip-space dimensions. Detailed controller assets load only when a remote
avatar is needed; a rounded controller fallback remains during loading. No detailed
humanoid assets were enabled.

Verification:

- 138 focused Node tests passed (camera permission/cancellation, room inventory,
  project sharing, XR routing, HUD actions, presence and existing performance policies).
- Isolated two-client Chromium + actual CollabHub test: decoded live video pixels,
  guest grip and resize round trips, camera restoration for late joiners, stop cleanup,
  eleven simultaneous GLTF models, full inventory recovery from an emulated older
  eight-item relay, and parent-relative adopted model transforms. Report and screenshot:
  `docs/verification/vr-room-sharing-20260916.json` / `.png`.
- Existing isolated two-client floor/presence test passed with the bundled Quest
  assets, actual viewport grip acquire/move/release, both-direction model handoff,
  exact final placement, reconnect, and late join. Report:
  `docs/verification/vr-room-floor-sharing-20260916.json`.
- Full authenticated editor startup: no page errors and no unsolicited Pi requests;
  all production WebSockets intercepted to avoid taking over the user's headset.
- Backend drop sanitation/full-inventory test passed. The wider access suite was
  stopped because its unrelated fixtures attempted Supabase workspace calls; it is
  not counted as a successful full backend run.

Still needs physical-headset verification: Quest outward camera permission, comfort
and readability of the shared window, real handedness/grip alignment, and performance
with multiple simultaneous camera publishers. Browser tests used synthetic video
and poses. No robot movement/recording/gripper commands were issued.


## Trigger-stable menus and voice activation — 2026-09-16

Trigger clicks on menu controls park the panel before dispatch, preserving its
position and orientation through follow/repaint updates. Content edges no longer
act as invisible rotation handles. Hold the top bar with the trigger to move and
rotate; initial motion under 3 cm / 0.08 radians is ignored to prevent click jitter.
The overflow menu retains lock/unlock and close. Existing grip grabbing remains.

Voice activation now shares pending settings loading and microphone startup across
Order/Hey, VR controller actions and wake phrases. Audio output unlocks during the
original gesture and capture reuses that audio context after permission/network
awaits. Stop cancels late owned microphone grants; borrowed room tracks survive.
If browser speech recognition is unavailable, wake listening can use an existing
permitted headset microphone and the authenticated transcription route. Silent
chunks are skipped, only one transcription runs at a time, and listening pauses
while the voice session is active. This does not acquire another room microphone.

Verification:

- 140 focused Node tests passed: voice startup, wake matching/fallback, trigger
  dispatch, HUD hit regions, robotics HUD, hot-path and window management.
- Authenticated editor browser test: actual Order button activates once; synthetic
  “Hey agent” and “Hey Astra” recognition events each activate; delayed settings
  and duplicate startup share one settings request, microphone prime and session.
- Actual viewport drag functions with Three.js poses: small trigger jitter leaves
  the panel unchanged, intentional top-bar rotation works, repaint preserves it.
- No browser page errors. Voice provider and microphone were synthetic; all
  production WebSockets were intercepted. No robot commands or paid voice calls.
- Reproduce with `.venv/bin/python scripts/tests/xr-voice-menu-runtime.py`.
  Report: `docs/verification/voice-activation-20260916.json`.

Physical Quest checks still outstanding: real acoustic wake recognition, microphone
permission after headset resume, and top-bar controller comfort. Refresh Studio
before re-entering VR to load the new frontend assets. No backend restart needed.


## Compact tabbed windows and explicit movement — 2026-09-16

The newer shared workspace introduced separate regression paths: tab presses armed
pull-to-detach gestures, empty tab-strip space fell through to a movement action,
and content headers redirected manipulation to the entire workspace. Its content
alignment was cached after first placement, allowing the outer shell to move while
its contents stayed behind. Grip translation also reset a resized window to scale 1.

- Workspace now measures 0.60 × 0.46 m (previously 0.86 × 0.64), placed 0.82 m
  in front of the user. Smaller panels are never enlarged to fill it.
- Four readable tabs per page. Tab clicks only select; blank strip space is inert.
- The labeled top handle is the only manipulation target on managed windows,
  with trigger rotation/movement and grip movement. Content clicks or incidental
  squeezes cannot acquire the workspace or a model behind the menu.
- Explicit **Pop out** opens the selected panel beside the workspace without
  capturing the controller. **Dock** returns it. **Tidy** gathers open pop-outs,
  restores the compact size and recenters the workspace; closed panels stay closed.
- **− / +** controls resize deliberately. Moving with grip preserves that size.
- Content follows its container's transforms and re-aligns after upstream changes;
  unchanged frames do not repaint the tab strip or reapply content transforms.

Validation: 28 Node tests passed (actual select dispatch, header hits, window
manager). Isolated Chromium/Three.js viewport test passed 46 checks, including
trigger hold/motion on tabs, explicit detach/dock, overflow navigation, top-handle
translation/rotation, grip resize preservation, Tidy, idle painting, and assistant/
wiring background updates not taking over the active tab. No page errors; renderer
readback warnings came from the software-rendered screenshot. APIs were mocked;
no real room, microphone or robot operations ran.

Reproduce: `.venv/bin/python scripts/tests/xr-tabbed-windows-runtime.py`.
Evidence: `docs/verification/xr-compact-windows-20260916.json` and `.png`.
Asset chain version: `compactwindows=20260916-2`. Reload Studio and re-enter VR.
Physical Quest readability, comfort and controller feel still need verification.


## Tab facing, chrome, and undock — 2026-09-16

Newly opened tabbed workspaces (and icon-popped windows) now look at the headset,
then yaw 180° if PlaneGeometry +Z would otherwise point away. The tab strip sits
about 1.4 cm above the panel with a dark gutter, paints at 2048×256, and keeps
the existing foveation-off gate while text windows are open.

Hold trigger on a tab and drag past 7 cm to undock it, or press the pop-out icon
next to Close. Dock still returns a floating window; Tidy still gathers them.

The whole top bar / tab strip is a move target (taller visual row plus a padded
2.2 cm-deep hit box). Tab labels, Close, pop-out, −/+, Pop out, Dock and Tidy
still win when the laser is on those controls. Empty chrome and the rest of the
bar move the window.

Asset chain version: `tabface=20260916-2`. Reload Studio and re-enter VR.


## Left-wrist Capture/history, Draw visibility and controller rendering — 2026-09-16

- Preserved the controller model's material, color/texture and normal maps; removed
  the unlit conversion, emissive boost and disabled-depth treatment that washed out
  controller detail. Each physical mesh gets one owned material copy.
- Corrected the wrist background's bottom-left arc (it repeated the bottom-right
  corner), which made half the panel transparent. Wrist backgrounds use opaque
  depth-tested materials with alpha-tested rounded edges.
- Capture, Undo and Redo now form a small left-wrist row. Capture toggles a grouped
  popup containing passthrough, microphone, Share, screenshot, recording and stream
  actions. Existing stream destinations and finished-clip actions remain routed
  through existing handlers. Pause/Stop stay in the folder; a small recording clock
  remains visible when the folder is collapsed. Removed the duplicate legacy strip.
- Draw UI uses a separate scene anchor copied from the drawing grip/wrist. Active
  tool visibility is refreshed each frame, independently of controller-model hiding.
  Tool options face the head; no per-frame texture rebuilding was added.
- Right-controller yaw flick: settle briefly, flick left to Undo / right to Redo.
  One action per gesture, a 900 ms cooldown, and a new settled wrist are required.
  Trigger/grip activity, strokes, object/window manipulation, menu aiming, robotics,
  hidden XR sessions and tracking gaps suppress/reset detection. Left-wrist buttons
  and flicks call the existing undo/redo handlers.
- Grip models now explicitly consume gripSpace poses each XR frame. Recording uses
  the eye midpoint, a centered mono projection matching video aspect, fresh scene
  matrices, and a 33 ms overlay interval (previously 80 ms). Higher overlay cadence
  applies only when capture requests frames; no startup/background recording added.

Verification: 35 targeted Node tests and 45 isolated browser checks passed. Browser
coverage includes wrist history clicks, actual right-controller flick dispatch,
return-motion suppression, collapsed/expanded/recording/clip-ready folder states,
Draw visibility recovery and pose following, real Quest GLB material styling,
recording grip pose and camera projection, and background pixel coverage. Browser
APIs were mocked; no real recording, live-room connection or robot command ran.

Run `.venv/bin/python scripts/tests/xr-controller-ui-runtime.py`.
Evidence: `docs/verification/xr-controller-ui-20260916.json` and `.png`.
Asset version: `wristfix=20260916-3`. Reload before re-entering VR.
Physical-headset checks remain: flick sensitivity, resumed tracking, camera-feed
registration and recording frame rate under the user's project load. Browser pose
checks do not establish exact alignment with the Quest's physical camera lens.
