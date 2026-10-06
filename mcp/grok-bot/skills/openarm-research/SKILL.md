---
name: openarm-research
summary: Research and audit OpenArm calibration, CAD physics, rigging, and simulation trials using evidence-bound MCP events.
---

# OpenArm research and repair

Use `openarm_research` to read the local event index. This skill does not authorize motor commands, unattended physical calibration, settings changes, purchases, or claims of hardware validation.

## Roles and handoff

- Project manager: maintain the requirement ledger, sources, owners, blockers, cost and rollout stages. Ask R&D and Sales for independent evidence.
- R&D: verify OpenArm 2.0 hardware revision, Quest/OpenXR pose semantics, hand-eye calibration, CAD geometry, material and joint assumptions, and simulation method. Record each claim with URL, revision/date, units, uncertainty, and a disconfirming test.
- Sales: price comparable calibration, robot programming, and robot data services. Separate directly comparable offers from adjacent products. Put labor, one-time calibration, recertification, support, cloud/storage, and failed setups in the model.
- Astra: inspect rendered scene and recorded episodes, report visible contact, tracking validity, and failure timestamps; never infer measured dimensions from pixels alone.
- Codex: implement reviewable code and tests, compare reports with source files, and promote only verified simulation changes.
- Grok evaluation bot: classify completed episodes and rig audits, propose one change plus a falsifying test, then compare held-out results.

Start with these five roles but only three active bot workflows (PM/R&D, Sales, Evaluation); combine the first two when request volume is low. Increase the team only when throughput or independent review is measured to be the bottleneck.

## Repair loops

1. **Evidence loop:** Claim -> primary source -> independent corroboration where possible -> units/revision check -> contradictory evidence -> status `supported`, `disputed`, or `unknown`. Five consecutive runs of the same query may test reproducibility; they are not five independent sources.
2. **Calibration and data loop:** Validate robot/controller frame IDs and synchronized timestamps; fit robot-world/hand-eye transform from diverse poses; evaluate held-out position and orientation residuals; inspect tracking recenter/drift; accept only against predefined thresholds. Record all manual interventions.
3. **Rig and policy loop:** Check BOM revision, mass/inertia, links, axes, hard stops, swept collisions, mounting dimensions and tolerance stack. Simulate tasks over varied object poses, compare policy attempts with demonstration, change one variable, and rerun held-out scenes. Treat CAD and simulator checks as estimates until physical fit and measurements confirm them.

For each run record: `source_instance`, `source_id`, `kind`, `project_id`, `occurred_at`, `payload` with `artifact_sha256`, `source_urls`, `claim`, `units`, `result`, `manual_steps`, `unexpected_blockers`, `next_test`. Use `openarm_research({"action":"record","data":...})`. Calls are idempotent when source ID and payload are the same. Do not put raw video, private credentials, or large trajectories in the 16 KiB event; store them separately and record a hash and access-controlled URI.

## Rig audit gate

1. Find the exact OpenArm hardware revision and official CAD/BOM/datasheet. A matching name without revision is `unknown`.
2. Require explicit joint parent/child, axis/frame, units, limit range, mass, centre of mass, and positive inertia. Compare numeric part dimensions with source-backed requirements and tolerances.
3. Check static assembly mates and screw engagement, cable/connector envelope, controller nest clearance and gripper contact. Run swept collision in MuJoCo at limits and along proposed calibration paths. Check expected load against manufacturer ratings with a documented safety factor.
4. Separate results: metadata checks, simulated geometric fit, printed test fit, measured performance, and applicable compliance. Neither a passing sim nor a model render proves compliance.
5. If a check fails or lacks evidence, record a `rig_audit` event with the exact affected part/joint IDs, source revision, last passing artifact, first failing artifact, proposed minimal change, and a falsifying test. Physical motion remains blocked until independent safety checks.

Use `demos/openarm-calibration/rig_audit.py` as the structural example. Its `ready_for_physical_motion` stays false because it cannot check the physical arm.
For a calibration episode, follow `mcp/grok-bot/skills/openarm-calibration/SKILL.md` before proposing a transform or mount change.

## Settings proposals

Only send `settings_proposal` events with target, current value, proposed value, source, predicted effect, rollback, and a simulation test. No MCP action here applies settings. Use measured controller/motor limits from the exact version before proposing speed/torque. Keep the fast control loop in the robot controller/policy; review complete episodes after each run.

## Source scoring

Score 0-100 = authority (0-25) + direct measurement/method (0-25) + revision and traceability (0-20) + independent corroboration (0-20) + applicability to this build (0-10). A vendor specification may be authoritative for its own dimensions but weak evidence for achieved field accuracy. A hobby result can be a test idea, not a specification. Preserve raw scores and rationales; do not average away contradictions. Keep speculative business value separately from measured results.

## Output contract

Report a table of claim, source, score, applicability, conflicts, and next measurement. For incidents state last observed working and first observed failing artifact/time, affected and unaffected features, one diagnosis with confidence, a disconfirming test, result, and whether the fix regressed anything. `unknown` is never `pass`.
