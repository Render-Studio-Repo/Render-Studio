# Robotics profile and passthrough

## Current Studio controls — September 15 recording and scene follow-up

- **A starts recording; B stops and adds the take to Emotes.** The Pi's native B means discard, so Studio suppresses raw B and translates Stop to the Pi's A-save pulse. On the corresponding saved-take confirmation it accepts once, then refreshes and opens Emotes. Repeated A does not stop a running recording. A quick B during start acknowledgement queues one stop. Onscreen Record/Save uses the same path.
- Unsolicited pending takes require an explicit decision. Failed saves keep a retry panel; discard is an explicit onscreen action. Duplicate confirmations, expired intents, reset and reconnect cannot auto-accept another take. A/B accept pending confirmation; A plays a selection while the picker owns it.
- Trigger analog remains in Joy axis 2. Each hand's actual menu pointer hit gates only that hand; proximity alone does not suppress a gripper. A menu press remains captured until release, with tolerance for small residual trigger readings. Ownership refreshes immediately before Joy transmission. Grip continues to move Studio models/windows.
- Enable Robotics opens one live Viser scene, places it within reach, and enables **room visibility**. Existing authenticated room rules still gate viewers. Grip-dragged placement and live link transforms propagate to viewers; sharing robot control/emotes remains a separate opt-in. Loading/retry states are visible and duplicate open requests are coalesced. Target/ghost/collision model copies are omitted from the headset renderer, preserving the current robot and target control handles.
- **Y hold 3 seconds currently sends the Pi's session reset, not saved-Home motion.** The live v1.0.1 config explicitly excludes joint homing and exposes no saved-Home action. SSH to the configured Pi user was denied. The requested return to the Pi's existing Home is blocked pending a supported Pi Home command or server access; no joint angles or old all-zero homing command were guessed. Holding while already paused no longer briefly resumes teleop.

Verification: **70 Node tests and 6 backend tests passed**. Browser checks cover physical A/B inputs, single acceptance/list refresh, automatic Viser insertion, grip dragging and matching updates in a simulated guest scene. Full editor startup had no errors or Pi requests before enable. The actual Pi Viser was read without motion commands (421 scene records, 39 cached assets, 3.6 MB); its captured model rendered as 22 meshes in Chromium. The public-origin scene-open API returned 200 and the temporary visual scene was removed. Physical Quest trigger/gripper behavior, recording on hardware, multi-headset room behavior and saved-Home return remain unverified.

[Workflow verification](verification/vr-robotics/pi-stop-save-scene-20260915.json) · [Actual Pi model rendering](verification/vr-robotics/pi-viser-model-20260915.png)

## Previous implementation — September 15 controls follow-up

The live Pi's `/teleop/status` returns a `hello` payload with `y_map: tap_pause_hold3_kill` and `json_control: true`. Studio previously accepted only `teleop_status`, leaving hold-reset support unknown. It also replaced status wholesale on HTTP replies, forced X/A held during Y-follow, and required a cloud Viser scene before opening emotes. Record/Stop controlled Studio's local pose clip instead of the Pi recorder.

The integrated profile now:

- Accepts live `hello` and `teleop_status` messages and preserves capabilities across partial replies. A read-only status GET at socket open supports firmware that does not push status immediately. Status from older requests cannot overwrite a newer socket update.
- Sends Y tap/hold as ordered JSON commands on the existing socket **only when live firmware advertises JSON control**. Older firmware uses its HTTPS Y endpoint. A 3-second hold sends `session_reset` only when supported; unknown support reports an error instead of guessing a home command. Buttons are sampled even when tracked poses are temporarily unavailable. A pose-socket disconnect does not cancel an ongoing Y hold or its HTTP reset request.
- Stops forcing X/A for integrated profiles. Real right-A press/release edges reach the Pi's Record/Save binding; B remains Discard. Trigger menu ownership and Studio grips remain intact.
- Opens the X picker immediately and reads the user's Pi `/emotes` directly. Own play/accept/discard actions also go directly to the Pi. Shared-room robot actions retain the existing permission-checked server routes. No Viser connection is needed for the owner's picker or confirmation dialog.
- Routes on-screen **Record** and **Stop / Save** through one bounded A press/release on the existing Joy stream. The displayed recording state comes from Pi `episode_status`, not a local optimistic state. Clicking again while awaiting acknowledgement does not send a second toggle. Emote confirmation retains A/B until release so accepting a take does not accidentally start another recording.
- Installs setup only from explicit configuration actions. Reinstalling on each Enable previously emitted a profile-change event that disabled robotics immediately.

Verification: **63 Node tests passed**, covering the actual teleop tick with fake sockets, ordered reset, partial replies, missing poses, disconnected pose socket, duplicate-tap prevention, one Record/Save edge per click, and menu ownership. Browser verification rendered the spatial picker and exercised the workflow with fake controller inputs. Only read-only `/teleop/status` and `/emotes` calls reached the real Pi; every POST was mocked and the control socket was replaced in memory. The Pi returned an empty saved-emote list during verification. No robot motion or physical Quest buttons were tested; headset behavior still needs verification. Full editor startup also passed with no page errors and no Pi requests before Enable.

[Control verification](verification/vr-robotics/pi-controls-20260915.json)

## Setup

Open **Robotics → Control configuration** (also the Controls button in the Robot panel).
The supplied DimOS Quest OpenArm profile is selected by default. Its discovery URL is
`http://192.168.1.77:8450/robotics/config`.

- **Use Teleop IP** fills port 8450 and `/robotics/config` from the selected Teleop host.
- **Load from Pi** reads the supplied discovery URL directly from the user's browser. A local Render server can provide a fallback; a public Render origin never proxies discovery through its cloud server.
- Drop a JSON file onto the upload area, choose it with the file picker, or use **Paste configuration JSON**.
- Review the complete controller map and save. Profiles persist per account in local storage and robotics preferences; camera preferences remain separate because the supplied Pi profile does not describe camera endpoints.
- Certificate setup opens the profile’s certificate/trust page.

### LAN discovery verification — September 15, 2026

The Pi returned HTTP 200 for `http://192.168.1.77:8450/robotics/config` and HTTPS 200 for `https://192.168.1.77:8443/teleop`. **The HTTPS `/robotics/config` endpoint on port 8443 returned 404.** Previously an HTTPS Studio page tried only that missing endpoint, even when the user supplied the working HTTP discovery URL.

Discovery now tries the supplied endpoint first, preserves explicit config ports/paths, validates the returned profile, and times out stalled requests. It can try the alternate LAN endpoint on failure. Modern Chrome can permit HTTP requests to private IPs through its [Local Network Access permission](https://developer.chrome.com/blog/local-network-access); browsers that block the request receive instructions to open the config page and import/paste its JSON. No cloud discovery fallback is attempted on public origins. ZIP installation still requires a Render server on the LAN; the dialog explains this before issuing an impossible cloud download.

**Open Pi teleop (leaves Studio)** navigates the current tab directly to the Pi UI, without an iframe or `autoconnect` parameter. The user taps Connect there. It does not change the saved integrated/full-page preference. The Pi accepts one controller client, so other active teleop sessions must be closed.

Validation: 20 focused Node tests passed. Chromium 148, with local-network permission granted in an isolated test context, loaded the real Pi profile from the public Render origin with zero cloud API calls. Browser checks also covered blocked-fetch guidance, 404 fallback, pasted/invalid JSON, preserved integrated mode, the full-page link, and zero iframes/page errors. HTTPS reachability probes ignored certificate validation only for diagnosis; this does not establish certificate trust on Quest. No control socket was opened and no robot motion was tested. Headset certificate trust, Connect, and post-recording reconnect remain unverified.

[Browser verification](verification/vr-robotics/robotics-lan-discovery-20260915.json)

Selecting or saving a profile does not start teleop. The default **DimOS Quest OpenArm — inside VR Studio** profile keeps Studio's session and Robotics menu open. Studio owns one controller WebSocket directly from the headset browser to the profile’s LAN controller URL. It does not embed or open the Pi page or start the legacy coordinator. The supplied `iframe: false` rule is respected: no immersive page is embedded. The optional **Pi full-page passthrough UI** mode explicitly hands off to that page instead. Older automatically selected external defaults migrate to the integrated mode; newly chosen full-page mode persists.

The profile's xr-standard trigger, grip, stick and face-button layout bypasses Studio's legacy remapping. The Pi's current Y implementation is browser-owned: short tap sends `tap`, holding three seconds sends `session_reset` only when the live Pi status advertises that mapping. Studio sends Y actions directly to the profile’s HTTPS LAN `/teleop/y` endpoint and suppresses raw left Y, matching the Pi page and preventing old firmware’s one-second homing behavior. Other controller fields use the existing binary PoseStamped/Joy stream. Duplicate hand sources cannot overwrite controller data; unknown handedness is ignored.

## Passthrough

The boot screen probes AR support before the entry click and requests an AR session on supported headsets. The normal VR room is rendered opaquely within that session. The right-controller passthrough toggle can therefore reveal the real room and return to VR without requesting another XR session. **Enable Robotics** turns passthrough on automatically. Manual passthrough changes remain saved across entries; enabling robotics again turns it on. VR-only devices retain immersive-VR entry and report that passthrough is unavailable.

## Cameras

The Robotics panel and VR wrist/room windows share the same camera module and decoded image state. Requests are deduplicated while a pair of frames is in flight. VR retains the last decoded frame while the next one loads. Enable cameras starts the existing publisher; Disable hides VR windows. Wrist and room placement use the saved camera mode. Wrist attachment resolves actual handedness, rather than assuming input slot zero is left, and converts poses into the HUD parent’s local coordinates.

The Pi profile does not advertise independent camera endpoints, so the camera PC address is retained. The Pi’s single-client control WebSocket is never opened just to obtain video.

## Verification

- Actual Pi discovery returned the provided v1 profile and single-client flag.
- Local left and right Arducam snapshot endpoints returned live JPEGs.
- Browser checks cover URL autofill, default selection, loading, JSON browse/drop, saving/restoring, full mapping text, absence of teleop launch during editing, and both decoded camera feeds.
- Full editor browser startup loaded project cards without startup exceptions.
- Unit tests cover profile validation, account isolation, external-controller ownership, AR session selection, controller bindings, viewer state, and the authenticated discovery route.

Headset checks still required: passthrough on/off, exit/re-entry preference restore, left/right wrist placement after controller reconnect, room window dragging, Robotics Enable → automatic passthrough → trigger-click Disable, and Y tap/hold with the current Pi firmware. No robot motion was used for verification.

## Studio input ownership while robotics is enabled

Studio keeps trigger ray clicks on menus available, including **Disable Robotics**. Physical trigger input is suppressed before controller remapping for the hand using a menu, and remains reserved until release if the ray moves away. The other hand’s robot controls continue. Grips, face buttons, thumbsticks, drawing, model manipulation, and Studio restart shortcuts stop running Studio actions while robotics owns the controllers. Disabling restores Studio tools.

## Window placement

Newly visible panels are placed at arm's reach using their measured width and height, with gaps between their angular footprints. Existing and anchored windows reserve their space. New windows use free side positions or another row, and the belt-follow loop no longer restacks them. Detached camera windows participate; wrist cameras stay attached to the controller. Window poses continue through the existing saved-layout path.

## Update verification

Focused automated tests cover one integrated socket, controller handedness, duplicate source filtering, menu-trigger suppression, Pi Y HTTP routing, profile migration, and non-overlapping placement. Robot requests use mocks in these tests. Browser verification covers editor startup, integrated profile selection and saving, and module loading. Two unrelated pre-existing documentation assertions in `teleop-viewer.test.js` still expect an older documentation anchor/asset version. Headset interaction and robot motion have not been exercised by this update.
