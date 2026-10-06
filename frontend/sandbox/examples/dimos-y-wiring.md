# DimOS Y wiring (`yarm1`)

## Why Y stopped starting the arms

XR enter **always clears Activate** (`resetDimosTeleopOnXrBoundary`). That is safety: putting the headset on must not stream motion.

Left Y was only sampled **while already armed**. After enter, Y did nothing for DimOS. Same xr-standard index (`buttons[5]`) is **right B = Studio laser**. If a live overlay treated every pad’s button 5 as laser, Y looked dead.

## Wiring (hand, not just index)

| Hand | Face `buttons[5]` | Owner |
|---|---|---|
| Left | Y | DimOS — tap arms + starts arms when the pose socket opens |
| Right | B | Studio laser |

Live sandbox overlay must not map laser onto the left pad.

## Agent tasks (round table)

- **Astra / Cursor:** confirm left Y tap after enter arms teleop (`yarm1`).
- **RnD:** control-note if Y still no-ops — overlay steal vs mock CAN vs Pi `:8443` not trusted.
- **PM:** ticket `category_id=VR` + `CTL`. Do not invent a 13th family.
- **Clip-bot:** no print until Y follow is ENGAGED on CAN, not mock.

Hold Y 3s is still session_reset on the Pi (`tap_pause_hold3_kill`), not a Dora home.

Reload Studio, re-enter VR, tap **left Y**.

Full operator + agent steps: `examples/robotics-runbook.md` · MCP: `grok_robotics_runbook` · MuJoCo feed: `grok_mujoco_run`
