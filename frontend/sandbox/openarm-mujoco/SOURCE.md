# OpenArm MuJoCo in Render Sandbox

Pulled from [enactic/openarm_mujoco](https://github.com/enactic/openarm_mujoco) (Apache-2.0).

Docs: [MuJoCo | OpenArm](https://docs.openarm.dev/simulation/mujoco/) · web README: [web/README.md](https://github.com/enactic/openarm_mujoco/blob/master/web/README.md)

## Layout

- `index.html` — official page + embed/analysis hooks (`?embed=1`)
- `web/` — Enactic ES modules (ik, teleop, keymap, model-vfs, main) + `analysis-bridge.js`
- `v2/` — MJCF scenes + meshes (bimanual, cell, pedestal)

Physics: `@mujoco/mujoco` WASM from jsDelivr (versions pinned in `web/package-lock.json`). Arms driven by end-effector **pose** + DLS IK, not raw vibe qpos.

## Sandbox wiring

| Surface | URL |
|---------|-----|
| Full lab | `/sandbox/openarm-mujoco/` |
| Embed | `/sandbox/openarm-mujoco/?embed=1` |
| Agent feed | `openarm-mujoco/runs/latest.json` (via analysis bridge) |

Repair loop probes `openarm.mujoco_web`, `openarm.ik_converged`, and the feed file.

## Do not

- Do not send joint commands to DIMOS / hardware from this page.
- Do not replace upstream `web/main.js` / `ik.js` — patch only `analysis-bridge.js` and the thin index wrapper.
