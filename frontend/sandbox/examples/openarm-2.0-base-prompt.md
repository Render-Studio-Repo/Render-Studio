# OpenArm 2.0 — CAD / Rig prompt template

Use with **Sandbox** on in AI CAD Prompt. Turning Sandbox off reverses mapped sandbox writes and posts a system check.

```
create a robotic base similar to this in size and specs, make sure that you include all electronics and parts to build this, use metal I frame steel for base and make this with few parts and room to put 24V 50Ah LiFePO4 Lithium Battery, Low-Temp Cutoff Protection, 24 Volt 50Ah Group24 Lithium Battery and room for mount for OpenArm 2.0 on the base and make sure it's omnidirectional
```

## Reference points

| ref                      | path                                          |
| ------------------------ | --------------------------------------------- |
| OpenArm 2.0 rig contract | `openarm-teleop/rig.schema.json`            |
| Teleop lab               | `/sandbox/openarm-teleop/index.html`        |
| Session map              | `sandbox-sessions/latest.json`              |
| System check             | `sandbox-sessions/latest-system-check.json` |

## Voice repair loop (while Sandbox is on)

- Say **log this step** / **mark a checkpoint** → indexed reference point for backtrack
- Say **that's wrong, change X** → corrective write under `frontend/sandbox/` only + map entry
- Turn **Sandbox** off → reverse mapped files + agent system check (OpenArm 2.0 features)
