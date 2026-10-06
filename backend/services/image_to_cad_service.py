"""Image-to-CAD workflow orchestration.

This layer turns loose image prompts into an auditable CAD process:
capture preflight -> dimension strategy -> parametric B-rep generation ->
validation notes. It deliberately avoids pretending that a raw mesh or a
single photo is exact CAD.
"""

from __future__ import annotations

from typing import Any

from backend.services.ai_service import AIService
from backend.services.prompt_language import with_multilingual_prompt_rule
from backend.services.trace_log import add as trace_add


IMAGE_TO_CAD_PREFLIGHT_PROMPT = with_multilingual_prompt_rule("""You are Render Studio's image-to-CAD preflight engineer.
Inspect the attached image set and the user's request. Return one JSON object only.

Goal: decide how to produce an accurate CAD model, not a decorative mesh.

Assess:
- object class and likely manufacturing geometry
- visible views and whether the capture is single-view or multi-view
- whether there is a scale reference, ruler, known part, or dimension callout
- extract every readable/obvious dimension and any repeated features
- identify geometric primitives: planes, cylinders, holes, slots, ribs, fillets, symmetry
- estimate whether exact replication is possible or only approximate
- list additional photos/dimensions needed to raise confidence

Return:
{
  "object_summary": "...",
  "capture": {
    "image_count": 1,
    "view_coverage": "single|partial|multi_view|dimensioned_drawing",
    "scale_reference": "none|weak|known_dimension|ruler|calibration_marker",
    "has_perspective_distortion": true,
    "occluded_regions": ["..."]
  },
  "dimensions": [
    {"name":"...", "value_mm": 12.3, "source":"visible_callout|known_reference|inferred|user_prompt", "confidence":0.0}
  ],
  "features": [
    {"name":"...", "primitive":"box|cylinder|revolve|loft|extrude|hole|slot|pattern|unknown", "confidence":0.0}
  ],
  "cad_strategy": {
    "mode": "exact_from_dimensions|dimensioned_rebuild|best_effort_parametric|needs_more_capture",
    "recommended_output": "step",
    "single_solid": true,
    "symmetry": ["XY", "YZ"],
    "critical_assumptions": ["..."]
  },
  "quality_gates": [
    {"gate":"scale", "status":"pass|warn|fail", "message":"..."}
  ],
  "confidence": 0.0,
  "next_capture_steps": ["..."]
}
""")


def is_image_to_cad_request(prompt: str, images: list[dict[str, Any]] | None) -> bool:
    """Return true when image references should use the stricter workflow."""
    if not images:
        return False
    p = (prompt or "").lower()
    signals = (
        "image to cad",
        "photo to cad",
        "picture to cad",
        "from image",
        "from photo",
        "from picture",
        "make a model from",
        "model from",
        "turn this image",
        "convert this image",
        "convert the image",
        "reference image",
        "attached image",
        "attached photo",
    )
    generative = ("make", "create", "generate", "design", "build", "model", "copy", "replicate", "recreate", "scan")
    return any(s in p for s in signals) or len(images) > 1 or any(w in p for w in generative)


def _fallback_preflight(prompt: str, images: list[dict[str, Any]]) -> dict[str, Any]:
    image_count = len(images)
    return {
        "object_summary": "Image-referenced CAD model",
        "capture": {
            "image_count": image_count,
            "view_coverage": "partial" if image_count > 1 else "single",
            "scale_reference": "none",
            "has_perspective_distortion": True,
            "occluded_regions": ["unknown back/hidden faces"],
        },
        "dimensions": [],
        "features": [],
        "cad_strategy": {
            "mode": "best_effort_parametric",
            "recommended_output": "step",
            "single_solid": True,
            "symmetry": [],
            "critical_assumptions": [
                "No verified scale reference was extracted before generation.",
                "Hidden faces and exact dimensions are inferred from visible proportions.",
            ],
        },
        "quality_gates": [
            {
                "gate": "scale",
                "status": "warn",
                "message": "Add a ruler, calibration marker, or one known dimension for accurate CAD.",
            },
            {
                "gate": "view_coverage",
                "status": "warn",
                "message": "Use front, side, top, and detail views for replication instead of approximation.",
            },
        ],
        "confidence": 0.35 if image_count <= 1 else 0.5,
        "next_capture_steps": [
            "Add at least one known dimension in millimetres.",
            "Attach orthographic front, side, top, and detail photos.",
        ],
        "preflight_note": f"Fallback preflight used for prompt: {prompt[:160]}",
    }


def preflight(
    prompt: str,
    images: list[dict[str, Any]],
    ai: AIService,
    *,
    trace_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Analyze image capture quality and extract CAD constraints."""
    if not images:
        return _fallback_preflight(prompt, []), None
    user_content = (
        f"User request:\n{prompt}\n\n"
        f"Attached image count: {len(images)}\n"
        "Prefer measurable CAD facts over visual description. If scale is missing, say so."
    )
    try:
        report, ai_trace = ai.chat_json(
            IMAGE_TO_CAD_PREFLIGHT_PROMPT,
            user_content,
            images=images,
            trace_id=trace_id,
        )
        report.setdefault("capture", {})["image_count"] = len(images)
        report.setdefault("quality_gates", [])
        report.setdefault("next_capture_steps", [])
        report.setdefault("confidence", 0.0)
        trace_add(
            "info",
            "Image-to-CAD preflight complete",
            trace_id=trace_id,
            data={
                "confidence": report.get("confidence"),
                "mode": (report.get("cad_strategy") or {}).get("mode"),
                "image_count": len(images),
            },
        )
        return report, ai_trace
    except Exception as exc:
        trace_add("warning", f"Image-to-CAD preflight fallback: {exc}", trace_id=trace_id)
        return _fallback_preflight(prompt, images), None


def build_generation_prompt(user_prompt: str, preflight_report: dict[str, Any]) -> str:
    """Create a stricter prompt for the existing parametric CAD generator."""
    return (
        f"{user_prompt}\n\n"
        "IMAGE-TO-CAD WORKFLOW REQUIREMENTS:\n"
        "- Build a parametric B-rep CAD model, not a raw photogrammetry mesh.\n"
        "- Use visible/dimensioned geometry first: planes, cylinders, holes, slots, revolve/extrude profiles, symmetry, and repeated patterns.\n"
        "- If no reliable scale reference exists, choose plausible millimetre dimensions and mark them as inferred in design_plan.parametric_dimension_table.\n"
        "- Do not claim exact replication for hidden, occluded, or undimensioned regions. Model them with conservative assumptions.\n"
        "- Prefer STEP-ready watertight solids. Use one fused solid unless the object is clearly an assembly.\n"
        "- Include validation notes in design_plan.requirements_analysis and cad_feature_plan.\n\n"
        f"IMAGE_PREFLIGHT_REPORT_JSON:\n{preflight_report}"
    )


def validation_summary(preflight_report: dict[str, Any], build_result: dict[str, Any]) -> dict[str, Any]:
    """Summarize confidence and artifact checks after generation."""
    files = build_result.get("files") or {}
    gates = list(preflight_report.get("quality_gates") or [])
    gates.append(
        {
            "gate": "cad_exports",
            "status": "pass" if files.get("step") and files.get("stl") and files.get("glb") else "warn",
            "message": "Generated STEP/STL/GLB artifacts." if files else "Some export artifacts are missing.",
        }
    )
    dfm = build_result.get("dfm") or {}
    warnings = dfm.get("warnings") or build_result.get("warnings") or []
    gates.append(
        {
            "gate": "dfm",
            "status": "warn" if warnings else "pass",
            "message": "; ".join(str(w) for w in warnings[:3]) if warnings else "No DFM warnings reported.",
        }
    )
    return {
        "object_summary": preflight_report.get("object_summary"),
        "confidence": preflight_report.get("confidence"),
        "capture": preflight_report.get("capture"),
        "cad_strategy": preflight_report.get("cad_strategy"),
        "dimensions": preflight_report.get("dimensions") or [],
        "quality_gates": gates,
        "next_capture_steps": preflight_report.get("next_capture_steps") or [],
    }


def run_image_to_cad(
    prompt: str,
    project_path,
    context: dict[str, Any],
    ai: AIService,
    *,
    trace_id: str | None = None,
    images: list[dict[str, Any]] | None = None,
    skills: list[str] | None = None,
    speed: str = "fast",
    max_repairs: int | None = None,
    cancel_check=None,
    progress_callback=None,
) -> dict[str, Any]:
    """Run preflight plus the existing validated Feature Program pipeline."""
    from backend.services import design_service

    image_list = list(images or [])
    if cancel_check and cancel_check():
        raise design_service.DesignCanceled("Generation canceled.")
    if progress_callback:
        progress_callback({"stage": "image_preflight", "pct": 6, "label": "Reading image references…"})
    report, preflight_trace = preflight(prompt, image_list, ai, trace_id=trace_id)
    if cancel_check and cancel_check():
        raise design_service.DesignCanceled("Generation canceled.")
    if progress_callback:
        progress_callback({"stage": "image_preflight", "pct": 10, "label": "Extracting dimensions from images…"})
    enriched_context = dict(context or {})
    enriched_context["image_to_cad"] = {
        "preflight": report,
        "workflow": [
            "capture_preflight",
            "dimension_extraction",
            "primitive_feature_rebuild",
            "step_ready_export",
            "quality_gate_report",
        ],
    }
    enriched_prompt = build_generation_prompt(prompt, report)
    out = design_service.run_design(
        enriched_prompt,
        project_path,
        enriched_context,
        ai,
        trace_id=trace_id,
        max_repairs=max_repairs,
        images=image_list,
        skills=skills,
        speed=speed,
        cancel_check=cancel_check,
        progress_callback=progress_callback,
    )
    out["image_to_cad"] = validation_summary(report, out.get("result") or {})
    if preflight_trace:
        traces = out.get("ai_trace") or []
        out["ai_trace"] = [{"stage": "image_to_cad_preflight", **preflight_trace}, *traces]
    return out
