"""Design orchestration: prompt -> Feature Program -> validated, exported model.

Pipeline (see the plan's architecture diagram):
  1. AI generates a design (intent + generator directive OR a Feature Program).
  2. Spec retrieval: generator directives reference the hardware spec library.
  3. Build with the B-rep kernel, export STEP/STL/GLB + physics (sim/URDF/MJCF).
  4. Validate (build success + DFM). On failure, feed the error back to the AI
     and retry (self-repair), up to ``max_repairs`` times.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from backend.kernel import KernelBuildError
from backend.kernel.schema import FeatureProgram
from backend.services import kernel_bridge
from backend.services.ai_service import AIService
from backend.services.trace_log import add as trace_add

logger = logging.getLogger(__name__)


def _program_from_generator(directive: dict[str, Any]) -> FeatureProgram:
    """Expand a deterministic generator directive into a Feature Program."""
    kind = str(directive.get("kind", "")).lower()
    if kind == "enclosure":
        from backend.engineering.enclosures import case_program

        spec = directive.get("spec") or directive.get("spec_key")
        if not spec:
            raise ValueError("enclosure generator requires a 'spec' key")
        options = directive.get("options") or {}
        return case_program(str(spec), **options)
    if kind in ("gear_train", "geartrain"):
        from backend.engineering.gears import gear_train_program

        teeth = directive.get("teeth")
        if not isinstance(teeth, list) or len(teeth) < 2:
            raise ValueError("gear_train generator requires 'teeth':[z1,z2,...]")
        kwargs = {
            k: directive[k]
            for k in ("module", "thickness", "bore", "material", "pressure_angle", "drive_torque_nm")
            if k in directive and directive[k] is not None
        }
        return gear_train_program([int(t) for t in teeth], **kwargs)
    raise ValueError(f"unknown generator kind '{kind}'")


def design_to_program(design: dict[str, Any]) -> FeatureProgram:
    """Resolve an AI design dict into a concrete FeatureProgram."""
    generator = design.get("generator")
    if isinstance(generator, dict) and generator:
        return _program_from_generator(generator)
    program = design.get("program")
    if isinstance(program, dict) and program:
        if "name" not in program and design.get("filename"):
            program["name"] = design["filename"]
        return FeatureProgram.model_validate(program)
    raise ValueError("AI design contained neither a valid 'generator' nor 'program'")


def run_design(
    prompt: str,
    project_path: Path,
    context: dict[str, Any],
    ai: AIService,
    *,
    trace_id: str | None = None,
    max_repairs: int = 2,
) -> dict[str, Any]:
    """Run the full prompt->validated-model pipeline with self-repair."""
    repair_note: str | None = None
    last_error: str | None = None
    ai_traces: list[dict[str, Any]] = []

    for attempt in range(max_repairs + 1):
        design, ai_trace = ai.generate_design(prompt, context, trace_id=trace_id, repair_note=repair_note)
        ai_traces.append(ai_trace)
        trace_add(
            "info",
            f"Design attempt {attempt + 1}: intent={design.get('intent')} "
            f"{'generator' if design.get('generator') else 'program'}",
            trace_id=trace_id,
        )
        try:
            program = design_to_program(design)
            result = kernel_bridge.build_and_export(
                program, project_path, basename=design.get("filename") or program.name
            )
        except (KernelBuildError, ValueError) as exc:
            last_error = str(exc)
            repair_note = last_error
            trace_add("error", f"Design build failed (attempt {attempt + 1}): {exc}", trace_id=trace_id)
            continue

        # Built successfully -> surface DFM feedback (non-fatal).
        dfm = result.get("dfm") or {}
        return {
            "intent": design.get("intent"),
            "message": design.get("message") or program.description or "Model built.",
            "specs_used": design.get("specs_used") or [],
            "result": result,
            "attempts": attempt + 1,
            "ai_trace": ai_traces,
            "dfm_warnings": dfm.get("warnings", []),
        }

    raise RuntimeError(f"Design failed after {max_repairs + 1} attempts. Last error: {last_error}")
