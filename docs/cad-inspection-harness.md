# CAD inspection through the Grok harness

Generation success, `cad_votes` agreement, and a queued Mule message are not evidence that a model is correct.

The shared `finalize_harness_run` now writes `<model>.inspection.json` after placement and joint publication. It binds the published file and existing same-stem GLB, joints, and brief to SHA-256 hashes. A status read reconciles companion files too, so an added or changed joint/preview invalidates previous review. Engines bypassing this finalizer must explicitly call prepare; this is not yet universal enforcement across all generation paths.

The packet begins **unverified**. Required review areas are geometry, dimensions, assembly/motion, manufacturability, and visual appearance. A reviewer must supply a reason and project-relative evidence files for every reported verdict, including a justified not-applicable result. Failed checks block completion. These are evidence-backed reviewer attestations: the packet validator checks identity/freshness/completeness, not whether a screenshot or measurement proves the engineering claim. Do not present `all_passed` as independently certified, physically safe, or a substitute for manufacturing tests.

## Repository commands

```sh
.venv/bin/python -m backend.services.cad_inspection prepare projects/PROJECT model.step
.venv/bin/python -m backend.services.cad_inspection status projects/PROJECT model.inspection.json
.venv/bin/python -m backend.services.cad_inspection record projects/PROJECT model.inspection.json --review /path/to/review.json
```

Review JSON uses `reviewer`, the packet's exact `artifact_revision`, and `checks`. Example of one check (the remaining checks stay unverified):

```json
{"reviewer":"cad-reviewer","artifact_revision":"COPY_FROM_PACKET","checks":{"dimensions":{"status":"pass","reason":"Measured bore diameter matches the specified tolerance; see report.","evidence":["inspection/bore-measurements.json"]}}}
```

## What to wire next

1. Run existing `cadgen step inspect refs model.step --facts --planes --positioning` and targeted `measure`/`align` checks against the actual design specification. Save command, exit code and JSON output. Missing kernel/units/specifications means unverified.
2. Capture actual multiview renders of those bytes; review visible geometry against the prompt/reference images. A successful render alone does not establish dimensional correctness.
3. For mechanisms, require separate named bodies, authored joints, solver results, collision/limit sweeps and clearance measurements. For static parts, explicitly explain why motion checks do not apply.
4. Route a bounded review battery through Harness Mule to PM/CAD/RnD. Send project/file/revision and evidence references. Incoming SCORECARD must identify the same revision. Use `grok_mule_hop` with `sender: "codex"`; it now preserves caller attribution. Queue acknowledgement remains `asked_pending` until a real reply.
5. Only record the returned checks after checking evidence. Show unverified/stale/failed/reviewed in the UI before adding any automatic release gate. No production rollback, hardware movement or paid generation is triggered by this integration.

The 2026-09-18 review request is `MULE-20260918-032638-c10a65`. No model inspection pass is claimed by that request. The existing watchdog prompt's 4 mm pin plus 0.20 mm per-side clearance example should be 4.40 mm bore; its 4.56 mm number was flagged to the crew for comparison, not silently treated as an engineering constraint.
