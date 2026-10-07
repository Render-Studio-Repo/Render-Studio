# OpenArm LeRobot ACT adapter

This is a simulation-only adapter for the pinned public checkpoint
`enactic/act-openarm-2-cell-pick_up_cube_mujoco`. It cannot call the Raspberry
Pi API or move physical hardware.

## Install

Run from the Render Studio repository root:

```bash
uv venv --python 3.12 .venv-lerobot
uv pip install --python .venv-lerobot/bin/python \
  -r frontend/sandbox/openarm-mujoco/requirements-lerobot.txt
```

The adapter uses a separate environment because the current LeRobot source
requires Python 3.12 and its PyTorch dependencies are intentionally kept out of
Render Studio's production environment. The first run downloads roughly 251 MB
for the checkpoint and ResNet-18 backbone. Later runs use the local Hugging Face
and PyTorch caches.

## Run

```bash
.venv-lerobot/bin/python \
  frontend/sandbox/openarm-mujoco/lerobot_adapter.py \
  --seconds 20 --device auto
```

The adapter performs the complete checkpoint contract:

1. Apply the recorded arm pose, settle the cube onto the table, then restore
   the exact recorded arm state before the first observation.
2. Render ceiling, head-left, head-right, wrist-left, and wrist-right images.
3. Build the 16-value state in dataset order, right arm then left arm.
4. Run the serialized LeRobot preprocessor, ACT inference, and postprocessor.
5. Clamp all 16 absolute joint targets to the MJCF actuator limits. The
   checkpoint output is not rate-limited by default because the published ACT
   policy already emits action chunks and the former 0.08 rad limiter prevented
   its demonstrated cube grasp. `--max-step` can enable a diagnostic limiter.
6. Mark success only when the cube remains at least 6 cm above its initial
   height for eight consecutive 30 Hz policy steps.
7. Write the machine-readable result to
   `frontend/sandbox/openarm-mujoco/runs/lerobot-latest.json`.

A process exit code of `0` means the success detector passed. Exit code `2`
means the adapter ran correctly but the policy timed out before lifting the
cube. Other nonzero exit codes indicate a runtime or configuration error.

The checkpoint and adapter are pinned by revision. Do not use this simulator
result as permission to run the policy on hardware. A separate hardware adapter
needs calibrated joint conventions, collision limits, watchdogs, and a tested
kill path.
