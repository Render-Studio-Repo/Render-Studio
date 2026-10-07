# Skill — Repair Test Runner

**token:** repair1 · **OpenArm:** 2.0  
**seat:** Test runner · **vote weight:** 2

## Job
Execute sandbox probes. Emit observed results + environment, not prose grades.

## Mandatory probes
1. `GET /sandbox/openarm-teleop/index.html` → title contains OpenArm Teleop
2. `POST /mcp/sandbox` write probe as `agent=sam`
3. `GET` `openarm-teleop/runs/latest.json` (ok or empty is fine — record which)
4. Confirm `rig.schema.json` has OpenArm / `robot_version` 2.0
5. WebGL context create in-page

## Interaction regression checks
Exercise each reported control, not just its HTTP route. Record the device, URL,
asset version, timestamp, action, expected result, actual result, and evidence.
- Ask Astra opens and focuses chat; submitting returns a reply or visible error.
- Voice requests the browser device's microphone, receives audio, and releases
  tracks on Stop/cancel/page exit. Never request a server-host microphone.
- Enter Sandbox VR, exit, reenter, then remove/resume the headset.
- Trigger each room control with both controllers; verify actual handedness after
  reconnect. Observe squeeze separately. WebXR availability is not a passing test.
- Editor Load/Save report server failures and retain drafts; delayed loads cannot
  overwrite typing; template buttons must not save without an explicit Save.
- Test controller and desktop routes separately. Synthetic input is not hardware evidence.

Report broken controls to the engineer with a bounded reproduction, owning source
path, competing cause, smallest fix, and regression test. Task assignment is not
execution. Mark inaccessible headset or microphone tests unknown, never passed.

## Don't
- Don't mark unknown as ok.
- Don't run DIMOS / hardware teleop from this seat.
