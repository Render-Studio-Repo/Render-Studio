# Sandbox office and Astra defaults

Status: local automated checks pass; production activation, live AI and physical
Quest checks are outstanding. Last known good deployment: not established.

## Changes
- Regular Sandbox opens the shared 3D office. Desktop orbit/select and VR share
  the same named workstations, active agent and message target. Astra is the
  initial selection and has a companion avatar in the immersive room.
- Office, Agents tab, Collaborate action and VR controls use office-agents.js.
  Selecting an agent does not mute MCP or start microphone capture. The listening
  label reports the configured MCP switch, not proof a remote worker is running.
- Right controller A opens Agents, left X opens controls, B/Y returns home.
  Controller identity follows input-source handedness. Immersive text editing
  opens the browser editor; there is no new in-headset keyboard.
- Text model selection appears at the top; actual returned text model and live
  voice session model are labeled separately. Unknown agents do not get invented
  model identities. Voice remains on its supported realtime transport.
- Shared frontend default is gpt-6-astra. Main OpenAI/ChatGPT picker, Wiring,
  micro-edits, Render Agent and Sandbox use it. Backend authoring defaults,
  subscription/CLI defaults and Render Agent agree. Existing explicit choices,
  provider restrictions, environment overrides and trial limits remain intact.
- Plain Astra can follow the selected OpenAI API or platform key instead of being
  unconditionally redirected to a ChatGPT subscription. API Astra is classified
  as Responses-capable; subscription identity comes from the actual client.
  Astra Pro retains the existing Codex-specific path. Image/audio endpoints and
  intentionally pinned specialist helpers have not been converted to text Astra.
- Only OPENAI_MODEL and OPENAI_MODEL_QUALITY were updated in the local .env and
  .env.example. No credentials changed and no backend service restarted.
- Static import graph marker: astraoffice=20260917-1; existing markers preserved.

## Verification
- 44 Node tests: shared defaults, micro-edits, office agents, agent tasks, Ask
  Astra, editor, MCP and voice engine.
- 65 Python tests: Astra defaults/routing, CAD host routing, Render Agent guards,
  VibeCAD host, costs and prompt history. Tests use mocks; no paid calls.
- 52 Sandbox/core JavaScript files pass syntax checks; changed Python modules
  compile. Python tests ran in .venv; .venv-mac lacks pydantic-settings.
- Ask Astra browser fixture verifies default request model, top label, no request
  on opening, reply/errors and draft preservation.
- Sandbox browser fixture verifies office/Agents synchronization, targeted team
  messages, unchanged MCP state, model selection updates, no auto microphone,
  desktop orbit movement, fake-device microphone flow, editor races and synthetic
  controller input. Desktop/mobile screenshots and canvas pixel checks pass.
- Screenshots: /tmp/sandbox-office-desktop.png, /tmp/sandbox-office-mobile.png,
  /tmp/sandbox-room-desktop.png and /tmp/sandbox-room-mobile.png.

## Remaining Checks
- Full authenticated Studio boot and deployment activation; backend restart must
  be scheduled around active generations, not forced by this task.
- Actual provider entitlement/model acceptance, real voice input/output and team
  worker response. Mocked successful replies do not establish these.
- Physical Quest entry, headset resume/reconnect, controller rays, panel placement
  and text legibility in headset. Browser screenshots are not a hardware pass.
- Preserve concurrent workspace edits. Rollback only scoped changes against a
  verified backup; no whole-tree restore or source-project data removal.
