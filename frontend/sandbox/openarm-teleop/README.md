# OpenArm Teleop Training Lab (sandbox)

Simulation-only headset→avatar→OpenArm proxy viewer. Record demonstrations and send compact packets to your AI agent so it can practice taking your place in VR teleop training.

**Not a robot command bus.** No DIMOS / hardware writes from this page.

## Open

- Through Studio: [http://127.0.0.1:8001/sandbox/openarm-teleop/](http://127.0.0.1:8001/sandbox/openarm-teleop/) or the **Quest controller capture** link in the sandbox OpenArm card. Open the page directly in the Quest browser for WebXR.
- Standalone harness (high-rate JSONL):  
  `cd frontend/sandbox/openarm-teleop && python3 harness.py` → [http://127.0.0.1:8765/](http://127.0.0.1:8765/)

## Operator flow

1. Set the training prompt.
2. **Enter headset** in Quest browser and confirm **Right controller + trigger observed**. Then **Record demo** — move the right wrist and press the right trigger to grasp. The capture selects controllers by `handedness`, independent of arrival order.
3. Stop recording → episode summary is written to `runs/<id>.json` + `runs/latest.json` via `/mcp/sandbox`, and a tagged note is posted to team chat (`@cursor-engineer` `@vibe-rnd`).
4. Or click **Send to agent** anytime to push the latest demo.
5. **Run retargeting baseline** plays the demo on the orange OpenArm proxy and logs synthetic geometry trials (not held-out proof).

## Agent read path

| Source | What |
| --- | --- |
| `frontend/sandbox/openarm-teleop/runs/latest.json` | Latest keyframe / episode tip |
| `frontend/sandbox/openarm-teleop/runs/<episode>.json` | Compact episode summary |
| Team chat | Start/stop/summary posts |
| `mcp_server.py` | Optional MCP tools over harness `runs/` |
| `../context-research/` | Watchdogs + five-agent vote on VR feature incidents |

## Context research kit

Sibling folder `frontend/sandbox/context-research/`. Smoke:

```bash
cd frontend/sandbox/context-research
python3 watchdogs.py example_case.json
python3 five_agent_vote.py example_case.json
```

Use recorded `feature_checks` + button edges from episodes as evidence IDs when debugging VR trigger / overlay routing — never treat a demo as a confirmed hardware fix.
