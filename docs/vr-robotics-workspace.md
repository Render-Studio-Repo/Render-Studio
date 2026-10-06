# VR Robotics workspace

## Use

Reload Studio, enter VR, and open **Robotics**. **Enable Robotics** enables passthrough and uses the selected Pi profile. The current OpenArm setup is selected for Sam's account.

- **Grip** moves models and windows. Grip the same model with both hands to stretch or shrink its presentation scale. Trigger-clicking a menu remains available while robotics is enabled.
- **Pi UI** opens the native VR collection HUD and the Pi's docs, search, social links and controller descriptions. **X** opens emotes; **Y** pauses/resumes; holding **Y** for three seconds resets the supported Pi session. **A/B** record/discard, or act on the emote/confirmation panel when it is open.
- **Live Viser** brings the current OpenArm scene into Studio. Live joint poses update through Viser's read connection. Choose a planning group, grip its target handle to translate/rotate, and save a named current or edited target while teleop is paused. Target presets have Init/Current/Home labels and are stored in the account's Render workspace; applying a target is separate from Viser's Plan/Execute actions. This does not rewrite the Pi's built-in preset definitions.
- New **Live Viser** imports enable **Room visibility**. Join the same public room as your viewers; the Viser panel includes **Join public room to share OpenArm** when needed. The visibility switch can still hide the robot. Separate owner switches share the emote controls and the combined left/right camera window. Other users receive read-only robot controls; playing shared emotes requires the owner's opt-in and a confirmed paused teleop state.
- **3D Printer** exposes LAN host/protocol/serial, a reachability check, existing print-request preferences, model/outline visibility, slicer settings and a two-corner printer fence. Printer authentication and print submission remain in the slicer.
- **Robotics → Control configuration** accepts discovery URLs, JSON drag/drop, or the Pi setup ZIP. The shared template remaps the LAN host for each account. Installation consumes the control/menu definitions and stores the assets without executing downloaded JavaScript.
- **Avatar** includes three [Kenney CC0 character models](https://kenney.nl/assets/animated-characters-protagonists). Each has 1,604 triangles, one material and an idle animation. Assets load only when selected and use Studio's existing room avatar replication.

## Implementation

`xr-robotics-workspace.js` owns spatial Pi panels, printer placement and preset UI; `xr-viser-scene.js` translates Viser scene messages into the existing Three.js renderer. `viewport-xr.js` has thin pick, grip, update and menu hooks. Controller commands still use the one existing DimOS control socket. The separate Viser socket streams visualization and explicit target/GUI requests.

The backend supports Viser 1.0.30's compressed MessagePack/binary-buffer framing, reduces large per-link meshes and caches their GLBs. Current and target geometry from the tested Pi total about 3.6 MB; the scene snapshot is about 0.6 MB. Geometry cache is capped at 200 MB. Presets and printer placement are scoped to the account and capped at 256 KB / 50 presets. Room access is checked on assets, sockets and every action. Unknown teleop state blocks target editing and emote playback.

The camera viewport, wrist windows, HUD and combined window import the same versioned camera-state module. Public-room Join confirms `presence.sync` before reporting success. A same-account device takeover closes the old connection with an explicit reason and stops its reconnect loop.

## Verification — September 15, 2026

- 164 focused JavaScript tests passed; these cover input ownership, actual handedness, Y tap/hold, camera state, avatar selection, UI picking and session restart.
- 23 backend tests passed; these cover ZIP traversal/symlinks, host remapping, binary Viser decoding, target validation, pause requirements and room permissions.
- Browser: full authenticated editor initializes without page errors; real public-room Join succeeds; a second device takes over once and the old client stays disconnected.
- Browser with the real Pi's read-only scene: OpenArm geometry and 25 GUI definitions render; a simulated incoming joint update moves its scene node. The real Studio WebSocket delivers the Pi's scene and controls.
- Browser with simulated controllers: grip moves a panel; two grips resize a model from 1× to 2× and back to 0.5× with robotics enabled. Printer LAN text input, fence persistence and separated window placement pass.
- Browser with room fixtures: the shared robot, controls and emote panel appear; owner-only actions are hidden. All three avatars load with idle animations.

Reports are in [verification/vr-robotics](verification/vr-robotics).

### Headset and hardware checks still needed

Quest passthrough transitions, physical two-grip gestures, wrist-camera comfort/live video, reconnect handedness, simultaneous users in headsets, printer placement in a real room, and physical robot/emote execution require hardware verification. No motion, emote playback or printer job was sent during automated verification.

## OpenArm import and room recovery — September 15, 2026

Fixed three independent visibility failures:

- Manual imports previously defaulted to private even though automatic Robotics imports were shared.
- A room-list request begun before an import could return an older list, remove the new model, and close its stream. Reconciliation now applies only to the instances present when that request started. Responses arriving after VR closes are ignored.
- Disconnecting the owner's scene socket immediately destroyed the server scene and its assets. The server now retains them for a 30-second reconnection window, then expires abandoned scenes. Both owner and viewer streams recover through the existing room polling. Recovery preserves the scene identity and placement where available; if the server scene is gone, the owner recreates it. Transport status is separate from upstream Viser status, so a late HTTP response cannot conceal a dropped socket.

Geometry download failures expose a retry action. Missing Viser configuration and upstream errors have visible messages. Asset/socket/action permission checks remain in place; importing a visual scene does not enable guest robot control. The backend was reloaded and frontend imports updated to `viserroom2`.

Verification:

- 56 focused Node tests passed; 8 robotics backend tests and 4 room relay tests passed. Python 3.9 relay tests run separately because the older workspace tests use `asyncio.run`, which clears the main thread's default event loop.
- 12 browser regression checks cover import/list races, leaving VR during a request, room departure, viewer reconnection after a late status response, replacement after a missing scene, and matching joint/placement updates.
- Two separate Chromium clients used the real backend scene and asset routes against the Pi's live read-only Viser connection. Each rendered 22 meshes / 145 scene nodes. Both received the same placement; interrupting the owner's socket retained the same scene ID and kept the guest connected. This used isolated test identities and room membership, not two production accounts.
- After reload, an authenticated check through `render3d.app` loaded the Pi model with room visibility on and no browser errors. Full editor startup also passed without page errors or Pi requests before enable. Temporary scenes were cleaned up. No robot control or motion commands were sent.

[Verification report](verification/vr-robotics/viser-room-recovery-20260915.json) · [Guest model rendering](verification/vr-robotics/viser-room-recovery-20260915.png)

Physical Quest input, headset resume, and two simultaneous headsets remain unverified.
