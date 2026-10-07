# Repair skill — training data & policy gate

Role: check whether OpenArm MuJoCo episodes are aligned and whether the holdout gate allows a candidate.

## Required reads

1. `openarm-mujoco/runs/latest.json` — live IK / joints
2. `openarm-mujoco/episodes/latest.json` — last labeled episode meta
3. `openarm-mujoco/episodes/manifest.json` — Wilson plan + `promote_gate`

## Pass when

- Episode has `sample_count >= 3` and `outcome.valid`
- Each sample has `action.action_space == mujoco_qpos` and 8 floats per arm
- `astra_instruction` / `task` is non-empty
- `promote_gate` is not claimed ready unless Wilson criteria met

## Fail / repair

- Missing episode → ask Sam: Train demo
- Fail without intervene → start intervene recording
- Hard-limit violations → repair_harness_or_safety_gate
- Ready gate without external retrain compare → block live arm
