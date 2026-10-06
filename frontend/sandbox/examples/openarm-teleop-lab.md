## Agent brief

**ref_id:** SANDBOX-OPENARM-MUJOCO-20260917  
**scope:** simulation only · official Enactic MuJoCo WASM in browser

## What Sam wants

Use [OpenArm MuJoCo Web](https://github.com/enactic/openarm_mujoco) instead of the vibe Three proxy. Wire analysis into the repair loop.

## Where it lives

1. Lab: https://render3d.app/sandbox/openarm-mujoco/
2. Embed: Super IDE NW **OpenArm MuJoCo** + `#sb-teleop` iframe
3. Docs: https://docs.openarm.dev/simulation/mujoco/
4. Feed: `openarm-mujoco/runs/latest.json` (end-of-run only — scene-ready, snapshot, train-stop)
5. MCP: `grok_mujoco_run` · runbook: `grok_robotics_runbook` · doc: `examples/robotics-runbook.md`
6. Source note: `openarm-mujoco/SOURCE.md` (Apache-2.0)

## Repair analysis

- Probes: `openarm.mujoco_web`, `openarm.mujoco_scenes`, `openarm.ik_converged`, `openarm.rig_2_0`, `openarm.agent_feed`
- Joint names match `openarm_{left|right}_joint1..7` from MJCF
- Pose IK (not raw qpos drive) — same as upstream web README

## MCP always-listen (`mcplisten1`)

Agents listen on `/sandbox/` with **no connect toggle**. Status: **Agents listening**.
Protected **Reset listen** (confirm) mutes writes; **Resume** turns listen back on.
MuJoCo analysis writes unless `localStorage render3d:sandboxMcpConnect === "0"`.

## File IDE + smart whiteboard

- NE **Whiteboard** (`smartwb1`): character tokens, draw, **Agents scope moves**, save plan JSON
- SE **File IDE** (`fileide1`): load/save via `/mcp/sandbox`, **New loop**, **Char motion scope**
- Starters: `examples/character-motion-loop.js`, `examples/character-motion-scope.md`

## Live feed + bots (`livefeed1`)

Always-on card: `/mcp/stats` · `/api/health` · REPORT log · WebGL/XR obs · Gauge next steps.
**1 male voice** → all bots speak as `echo`. **Generate tasks** / prompt box. NW **Collaborate ID** shows agents + edits.
DIMOS **Ensure / install** → `POST /api/dimos/ensure-coordinator` (no arm).

## DIMOS link (sandbox strip)

Above the MuJoCo iframe: **Connect DIMOS** — paste robot PC LAN IP (same as Studio Preferences / Grok bot).
Saves `render3d:dimosWs`, probes via `/api/integrations/grok-bot/dimos`, coordinator via `/api/dimos/coordinator`.
Studio pipe: `/api/dimos/ws?upstream=wss://HOST:8443/ws`. Token `dimoswire1`.

## Do / don’t

- **Do** read IK error mm/deg and feature_checks from the feed.
- **Do** link DIMOS IP from sandbox for status/probe (shared with Studio).
- **Don’t** send joint commands to DIMOS / hardware from this page.
- **Don’t** edit upstream `web/main.js` / `ik.js` — only `analysis-bridge.js` + index wrapper.
- Training loop: see `examples/openarm-train-loop.md` (Train demo / Policy try / intervene / Wilson gate).
