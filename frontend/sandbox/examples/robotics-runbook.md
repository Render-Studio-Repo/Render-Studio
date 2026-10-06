# Robotics runbook — Quest Y + MuJoCo MCP (`yarm1` / `mujoco1`)

**ref_id:** ROBOTICS-RUNBOOK-20260918  
**scope:** operators (Sam) + agents (Grok, Cursor, repair loop)

---

## Quest — activate / deactivate Open Arm (Y)

Desktop **Activate** in Robot teleop is **config only**. Entering VR **clears** Activate (`resetDimosTeleopOnXrBoundary`) so the headset never auto-streams motion.

| Step | Action |
|------|--------|
| 1 | Optional: Robotics tab → **Activate** → set Pi IP (`192.168.1.77`) + camera IP |
| 2 | Put on Quest → **Enter VR** in Studio |
| 3 | Tap **left Y** → Engage (opens `wss://<Pi>:8443/ws`, status → Connected / ENGAGED) |
| 4 | **Y tap** again → pause engage · **Y hold 3s** → session reset |
| 5 | **B** Start · **A** Pause · **X** emotes (when profile allows) |
| 6 | VR HUD **Disable** or desktop **Turn off** → fully disarm |

### Normal “looks broken” states (not Y blockers)

| UI | Meaning |
|----|---------|
| `Armed — enter VR, tap left Y to Engage` | Desktop armed; socket opens in-headset only |
| `ws: closed` on laptop | Expected until Quest is presenting |
| `No feed` on wrist cams | Camera IP / stream — optional, does not block Y |
| `mock / no CAN` | Pi teleop not on real CAN — Y will not move hardware |

### If Y does nothing

1. Confirm **left** controller Y (right **B** is Studio laser).
2. Trust once on Quest: `https://<Pi>:8443/teleop`
3. `grok_dimos_probe` host `<Pi>` — `:8443` must answer
4. Pi: `teleop-quest-openarm` on `can0` / `can1` (not mock)

Wiring note: `examples/dimos-y-wiring.md`

---

## MuJoCo sim — how to run (not Quest, not Viser)

See **`examples/how-to-run-mujoco.md`** for the full guide.

Short version:

1. Robotics → **MuJoCo** tab (loads WASM automatically).
2. Optional: paste your local sim URL → **Connect sim**.
3. Interact with **keyboard** in the sim pane.
4. **Snapshot run** → MCP feed.

MuJoCo is **not** started by Quest Y. Training data comes from MuJoCo analysis → `openarm-mujoco/episodes/`, **not** from Viser/DimOS streams.

---

## MuJoCo sim — MCP view (`mujoco1`)

End-of-run analysis only (no 200 ms poll). One sim instance via `adoptLive("mujoco")`.

### Canonical feed

```
openarm-mujoco/runs/latest.json
```

| Write (sim) | `POST /mcp/sandbox` `action=write` `path=openarm-mujoco/runs/latest.json` |
| Read (agent) | `GET /mcp/sandbox/file?path=openarm-mujoco/runs/latest.json` |
| MCP tool | `grok_mujoco_run` |
| Studio UI | Robotics → **MuJoCo** tab → Run feed panel → **Refresh from MCP** |

### End-of-run triggers

- `scene-ready` — scene loaded
- `openarm-mujoco-end-run` — snapshot / calibration stop
- `train-stop` — train-hot off

### What agents check

```json
"feature_checks": {
  "openarm.mujoco_web": "ok",
  "openarm.rig_2_0": "ok",
  "openarm.ik_converged": "ok"
}
```

- `ik_errors.left/right.pos_mm` — IK residual (mm)
- `run_reason` — why this sample was written
- `scene` — MJCF path

### Agent loop

1. User approves MuJoCo tab or runs sandbox sim
2. Wait for settle / snapshot
3. `grok_mujoco_run` or `grok_sandbox action=read path=openarm-mujoco/runs/latest.json`
4. If `ik_converged` broken → repair loop / scene / standstill checks
5. **Do not** send joint commands to DIMOS from MuJoCo page

More: `openarm-teleop-lab.md`, `openarm-mujoco/SOURCE.md`

---

## Grok MCP quick calls

```
grok_robotics_runbook          # this file (text)
grok_mujoco_run                # parse latest.json + summary
grok_dimos_probe host=192.168.1.77
grok_dimos_connect host=192.168.1.77
grok_sandbox action=read path=openarm-mujoco/runs/latest.json
```
