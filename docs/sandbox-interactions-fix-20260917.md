# Sandbox interaction repair - 2026-09-17

Status: browser fixtures verified; production and physical Quest verification outstanding.
Last working snapshot: unknown. First failing evidence: user's Sandbox reports and
microphone screenshot dated 2026-09-17 09:23. No verified regression commit available.

## Evidence and causes
- Ask Astra opened no editor: the toolbar sent a canned question rather than
  revealing/focusing the mounted chat. Opening now preserves the draft and sends nothing.
- Voice reported a ready session and told the user to use a headset: the handler
  fetched session metadata but never acquired media or connected a socket. It now
  reuses createVoiceMold, captures browser-local audio, displays the input name,
  offers a device selector, and stops capture on Stop/cancel/pagehide/remount.
  There is no server-host microphone request in this flow. The screenshot does
  not establish that a host permission dialog actually appeared.
- Room had no controller hit testing. New room controls handle controller rays,
  per-source handedness and A/X, B/Y edges, plus desktop pointer selection.
- Editor load failures returned empty text, replacing drafts; template commands
  immediately wrote files. Failed/stale loads now preserve edits and Save is explicit.
- Repair loop equated navigator.xr availability with trigger success and imported
  server controller grades. It now requires a current local input observation and
  leaves unobserved checks unknown. Agent prompts request action-level evidence.

Alternative causes: auth/provider failures can still prevent a real reply and now
remain visible. Host audio hardware is not needed by the browser capture path.
No evidence establishes a particular Quest firmware or controller defect.

## Verification
- 45 Node tests: ask-astra, agent-tasks, sandbox-agent-bar, repair-loop, super-ide,
  xr-control-live, voice-mold, voice-startup.
- scripts/tests/ask-astra-browser.cjs: chat open/focus, no automatic paid request,
  submission pending/reply/error state, Agents identity and retained draft.
- scripts/tests/sandbox-interactions-browser.cjs: Chromium fake local microphone,
  PCM frames through mocked same-origin socket, exact device selection, Stop track
  cleanup, permission denial before session creation, canceled late permission;
  failed/delayed editor loads, explicit Save; synthetic left/right trigger and
  face-button edges; desktop room exit/reentry and denied immersive permission.
- Desktop/mobile screenshots and nonblank/moving canvas pixel checks. Screenshots
  stored under /tmp/sandbox-*.png and /tmp/ask-astra-*.png during this run.
- No paid model, real microphone, robot, production write, or physical headset used.

## Remaining gates
- Real authenticated Astra text/voice service, audible output, browser permission UI.
- Quest browser entry, left/right rays and squeeze, headset removal/resume/reconnect.
- Full Studio boot/model workflows and production deployment are not verified here.
- The immersive editor views and saves the current browser draft. Typing and Ask
  Astra text editing return to the browser panel; this is not an immersive keyboard.
- Queued agent tasks are requests, not proof that an autonomous repair ran.

Patch owners: frontend/sandbox/{ask-astra,astra-voice,room-controls,sandbox-xr-enter,
ide,debugger-vr,xr-control-live,repair-loop}.js and repair skill prompts; small shared
voice-mold hooks for microphone constraints/name and device-neutral permission text.
Cache graph marker: sbfix=20260917-2. Existing unrelated edits retained.
Rollback: undo only these scoped changes against a verified backup; no known-good
snapshot was supplied, so do not restore the whole dirty workspace.
