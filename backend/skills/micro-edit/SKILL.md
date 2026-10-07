---
name: micro-edit
description: Fast, scoped CAD edits to selected bodies or mounting faces. Use for hole diameter or position changes, small planar face offsets, small body moves and small size adjustments after replacing an electronic component.
---

# Micro edits

Use `/api/micro-edits/inspect` to read the selected STEP revision. All CAD harnesses share this B-rep path; keep the original authoring file and model intact. Operate only on the explicitly selected body IDs and optional face IDs. Viewport triangle numbers are not CAD face IDs.

Read the user's edit, geometry, bound mount references, approved Parts List replacement data and relevant canvas notes together. Ask for missing direction, amount, mounting pattern or exact board variant. Never infer a hole pattern from a product name or image pixels. A request for an entire robot or a new assembly belongs in normal Generate.

Return one short JSON plan. No Python, shell, file reads, source regeneration, sourcing calls or assembly rebuild. Prefer one operation. Maximum eight operations, all on selected bodies. One repair pass is allowed only when explicitly enabled; stop on unresolved ambiguity or unsupported geometry.

## Plan schema

`{"summary":"Move and resize the selected hole", "questions":[], "operations":[{"op":"move_hole", "body_id":"body:0", "face_id":"face:6", "translation_mm":[3,0,0], "diameter_mm":6}]}`

The operation discriminator key is exactly `op`, not `type` or `operation`. The example IDs and dimensions above are illustrative; always replace them with the inspected IDs and the user's requested values.

Each operation needs `body_id` from inspected geometry:

- `move_body`: `translation_mm:[x,y,z]`, at most 100 mm per axis.
- `scale_body`: `factors:[x,y,z]`, 0.8–1.25 per axis, about the body's center. Use only for an explicit overall size adjustment; scaling changes holes too.
- `resize_hole`: cylindrical `face_id`, `diameter_mm` (0.2–100). Keep its center and axis. Shrinking requires a through-hole.
- `move_hole`: cylindrical `face_id`, `translation_mm` in the mounting plane; optionally `diameter_mm`. Through-holes only. Preserve other holes.
- `offset_face`: planar `face_id`, signed `distance_mm` (−20 to +20) along the supplied outward normal.

Face IDs reference the original immutable revision even across successive operations. Apply surface edits before moving/scaling a body. Combine diameter and position changes to one hole in a single `move_hole` operation. Do not edit the same face twice or combine a planar face offset with other surface edits on that body in one plan; inspect the new revision in a separate edit instead. Use only IDs provided in `geometry`, and respect `face_ids` when supplied. Preserve unselected bodies, part names, proportions and materials. Unsupported operations must return questions and an empty operations array; do not approximate fillets, threads, slots or complex features.

## Verify and compare

The service executes the plan with the local CAD kernel, checks solid validity, connectedness, hole dimensions and preservation of unselected bodies, then exports STEP + GLB. It never runs AI-authored code. Debug variants all use the same source snapshot and independent output names. Record the exact prompt, plan, model, elapsed time, validation and human ratings. Geometry validation does not establish that an ambiguous request was understood; report intent accuracy as awaiting user review.

Keep the prompt small and use the user's selected AI source. Benchmark fast candidates against the same fixture before changing defaults. Only refresh the viewport when a valid output finishes; do not add speculative per-token mesh rebuilds. Generate/Run is always explicit.
