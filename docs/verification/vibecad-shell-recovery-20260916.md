# VibeCAD shell generation recovery — 2026-09-16

Project `ce8294df`, prompt `702980858e50`, trace `897b5b01`.

## Root cause

The saved request reproduces `OCP.Standard.Standard_Failure: BRep_API: command not done` at `lip_outer=inset(F, rim+lip_gap)`: a 4.28 mm inward offset of the densely scalloped periodic spline. The host did not classify this kernel exception as a source error, so it retried unchanged geometry and then failed. A partially initialized Face also broke diagnostic collection and hid the useful exception frames.

During recovery, a smooth inner profile avoided the original exception but exposed another defect: OCC considered its offset extrusion valid, yet STEP reopened it as a shell with zero solids. The base disappeared when the assembly was tessellated. Converting the smooth offset face to ordinary B-splines with `to_splines(tolerance=0.001)` preserves the solid through STEP. Exterior flutes and the three named components remain.

## Changes

- Kernel construction failures, invalid solids, and STEP round-trip failures now request a targeted source repair instead of an identical worker retry.
- Repair prompts preserve the existing source, required components, dimensions, walls, and mating clearances; they describe the two offset failure modes.
- Failed compile handoffs are cleared so later requests cannot reuse a known failed handoff.
- Diagnostics isolate broken local variables and retain the original exception chain and source frames.
- Worker shape checks call method-based build123d APIs as well as supporting property-based APIs. A bound `is_valid` method is no longer mistaken for a successful validation.
- Worker exports are reopened and checked for validity and expected solid count. Publication preflights every leaf before replacing project artifacts and rejects open shells.

## Verification

- Exact failing rim fixture reproduces the original exception and preserves its diagnostics.
- Smooth-offset fixture reproduces STEP solid loss and is rejected; conversion to ordinary splines passes.
- Invalid single-solid and open-shell publication regressions pass; existing assemblies survive a rejected publication.
- `test_vibecad_codex_host.py`, `test_vibecad_worker.py`, and `test_vibecad_assembly_scope.py`: 37 tests passed. After adding one further repair-advice test, all 22 host tests passed (38 distinct tests in total).
- Full repaired source compiled in 55.33 seconds. Base, lid, and retained pin each reopen as one valid STEP solid. Combined STEP has three valid solids.
- Isolated Chromium/Three.js preview renders three meshes at approximately 229.62 × 192.00 × 75.00 mm. No paid model call was used for this recovery.
- Saved repaired STEP, GLB, source, and manifests into the original project; updated the existing generation and prompt-history records. Originals are retained under `.generation_jobs/897b5b01-repair/` in that project.

This verifies geometry compilation, exchange topology, and browser rendering. Physical print fit, wall-thickness mapping, and collision-free hinge travel remain unverified and are explicitly marked pending in the model manifest. The live generation path starts a fresh detached Python worker for each request, so subsequent generations load these backend changes without interrupting active VR sessions.
