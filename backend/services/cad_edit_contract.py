"""Edit-specific invariants shared by Improve and the CAD authoring prompt."""
from __future__ import annotations

import json


CAD_EDIT_RULES = """EDIT SELECTED: revise the selected source model in place, not a new design inspired by it.
Use the original request as the change specification. The selected file and source geometry are the baseline; drawings and other models locate the change or provide mating references, not replacement targets.
Preserve existing physical dimensions, source units, orientation, origin, assembly placement and untouched bodies unless the user explicitly changes them. Inspect the source STEP/generator before choosing dimensions. A requested 70 mm extension changes that feature by 70 mm, not the overall model size. Do not replace measured source dimensions with generic fabrication defaults or scale the whole model to a printer envelope. Splitting for printing preserves assembled size.
geometry_context source_bounds and point_source are file-native coordinates; source_to_world includes viewer placement and presentation scale. Inspect file units and map GLB/STEP frames before comparing points. Never interpret a VR hand-sized display, screen pixels, unit-cube normalization or camera zoom as physical CAD dimensions. Mesh triangle indices are localization hints, not CAD face IDs; resolve the selected surface using source points, normals and topology.
For extend/add/extrude requests, modify or fuse the feature to the selected body at the referenced surface. Verify connectivity and mating alignment against the original geometry; do not export only the new shelf/block or float it nearby. Preserve separately moving bodies and intentional gaps. Return the COMPLETE edited selected model in the original source frame, not just the changed feature.
Improve must retain exact face/reference tokens and the selected filename. Do not turn an edit into 'create a new part', invent an overall scale, or silently switch targets. Clarify genuinely unresolved measurements without discarding the source dimensions that can be inspected. A rewrite is not an executed edit.
"""


def preserve_edit_baseline(improved: str, base_filename: str | None, *, max_chars: int) -> str:
    """Keep critical edit scope even when the rewrite drops it or gets truncated."""
    target = json.dumps(base_filename or "the explicitly selected model", ensure_ascii=False)
    contract = (
        f"\n\nEdit Selected baseline: {target}. Revise this complete source model in its original units "
        "and coordinate frame. Preserve existing dimensions, scale, placement, mating interfaces and "
        "untouched bodies except where the original user request explicitly changes them. Resolve the "
        "selected face/reference tokens against source geometry. Added extensions must connect to the "
        "selected body; return the whole edited model, not an isolated new feature. Do not normalize "
        "physical size to the viewport or printer."
    )
    return improved[:max(0, max_chars - len(contract))].rstrip() + contract
