## Agent brief — live AI operator training loop

**ref_id:** SANDBOX-OPENARM-TRAIN1-20260917  
**scope:** simulation only · MuJoCo WASM + Astra task + repair gate

## Direction

Generate / remix 3D objects → MuJoCo collision/mass/friction → VR/keyboard teleop mapping → record synced obs+action → imitate → policy try → human intervene (DAgger-style) → external retrain → Wilson holdout gate → repair agents diagnose continuously.

## UI (sandbox agent bar)

| Control | Meaning |
|---------|---------|
| Hey Astra | Sets task voice / “pick up the cube” |
| Train demo | Record demonstration ticks from MuJoCo analysis |
| Policy try | Record a policy attempt into holdout |
| ✓ Success / ✗ Fail | Label episode; Fail auto-starts **intervene** |
| Repair | Diagnoses train episode + promote gate |

## Artifacts

- `openarm-mujoco/episodes/{id}.json` + `.jsonl` — synced samples (`action_space: mujoco_qpos`)
- `openarm-mujoco/episodes/holdout.jsonl` — evaluation rows
- `openarm-mujoco/episodes/manifest.json` — Wilson plan + `promote_gate`
- Policy replay sample: `demos/openarm-teleop-training/openarm2_mujoco_policy.py`

## Promote rule

Promote / export only when `promote_gate == candidate_ready_for_external_retrain_compare` (Wilson ≥ 0.80, ≥ 20 valid holdout, zero hard-limit violations). Weights train **outside** the browser (LeRobot). Never auto-command DIMOS hardware from sandbox.

## Do / don’t

- **Do** keep camera frames / object poses as pointers when you add them; keep qpos+command aligned by sequence.
- **Don’t** treat vibe Three proxy demos as holdout evidence.
- **Don’t** skip intervene after a fail — that is the DAgger correction signal.
