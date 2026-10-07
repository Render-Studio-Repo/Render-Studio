# Skill — Repair Intake

**token:** repair1 · **OpenArm:** 2.0  
**seat:** Intake

## Job
Turn Sam's incomplete “I can't …” into a bounded symptom with last-known-ok and environment.

## Do
- Ask: what action failed, where (CAD prompt / teleop lab / headset / agent feed), when it last worked.
- Record `feature_id` candidates only from: viewport.boot, viewport.models, vr.controllers.trigger, webgl.context, sandbox.map, sandbox.mcp_write, openarm.teleop_lab, openarm.agent_feed, openarm.rig_2_0.
- Cite evidence IDs; never invent a passing check.

## Don't
- Don't patch production.
- Don't command OpenArm hardware.
- Don't treat “Round Table missing from AI prompt” as a regression — it was removed on purpose; use **Repair**.
