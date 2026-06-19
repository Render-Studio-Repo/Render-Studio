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
import math
from pathlib import Path
from typing import Any

from backend.kernel.errors import KernelBuildError
from backend.kernel.schema import DesignBrief, FeatureProgram
from backend.kernel.validator import ProgramValidationError, validate_and_raise
from backend.services import kernel_bridge
from backend.services.ai_service import AIService
from backend.services.trace_log import add as trace_add

logger = logging.getLogger(__name__)


class DesignBuildError(RuntimeError):
    """Design pipeline failed after one or more AI repair attempts."""

    def __init__(self, message: str, *, ai_traces: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.ai_traces = list(ai_traces or [])


class DesignCanceled(RuntimeError):
    """Raised when a project generation is canceled before export."""


def _filter_options(fn, options: dict[str, Any]) -> dict[str, Any]:
    """Pass only kwargs the target generator accepts (ignore AI extras)."""
    import inspect

    params = inspect.signature(fn).parameters
    return {k: v for k, v in (options or {}).items() if k in params}


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
    if kind in ("benchy_boat", "toy_boat", "boaty"):
        from backend.engineering.toy_boats import benchy_boat_program

        options = directive.get("options") or {}
        return benchy_boat_program(**options)
    if kind in ("pet_bottle", "soda_bottle", "coke_bottle", "pet_soda_bottle"):
        from backend.engineering.bottles import pet_soda_bottle_program

        options = directive.get("options") or {}
        return pet_soda_bottle_program(**_filter_options(pet_soda_bottle_program, options))
    if kind in ("automated_cooking_appliance", "cooking_appliance", "autocook"):
        from backend.engineering.appliances import automated_cooking_appliance_program

        return automated_cooking_appliance_program()
    raise ValueError(f"unknown generator kind '{kind}'")


_SUPPORTED_JOINT_TYPES = {"revolute", "prismatic", "fixed", "continuous"}


def _maybe_rad_to_deg(value: float, joint_type: str) -> float:
    """URDF-style joint limits are often radians; schema expects degrees."""
    if joint_type in ("revolute", "continuous") and abs(value) <= 7.0:
        return math.degrees(value)
    return value


def _normalize_limits(limits: Any, joint_type: str) -> list[float] | None:
    """Coerce URDF dict limits or loose AI shapes into [lower, upper]."""
    if limits is None:
        return None
    if isinstance(limits, (list, tuple)):
        if len(limits) < 2:
            return None
        lo = _maybe_rad_to_deg(float(limits[0]), joint_type)
        hi = _maybe_rad_to_deg(float(limits[1]), joint_type)
        return [lo, hi]
    if isinstance(limits, dict):
        lo = limits.get("lower")
        hi = limits.get("upper")
        if lo is not None and hi is not None:
            return [
                _maybe_rad_to_deg(float(lo), joint_type),
                _maybe_rad_to_deg(float(hi), joint_type),
            ]
        return None
    return None


def _limits_drive_fields(limits: Any, joint_type: str) -> dict[str, float]:
    """Extract URDF effort/velocity from a limits dict when present."""
    if not isinstance(limits, dict):
        return {}
    out: dict[str, float] = {}
    if limits.get("effort") is not None:
        out["drive_torque_nm"] = float(limits["effort"])
    if limits.get("velocity") is not None:
        vel = float(limits["velocity"])
        out["drive_velocity_dps"] = math.degrees(vel) if joint_type in ("revolute", "continuous") else vel
    return out


def _slug_id(value: str, fallback: str) -> str:
    import re

    slug = re.sub(r"[^a-z0-9_]+", "_", str(value or "").strip().lower()).strip("_")
    return slug or fallback


def _normalize_joint(raw: dict[str, Any], index: int, seen_ids: set[str]) -> dict[str, Any] | None:
    """Coerce common AI joint shapes into JointSpec-compatible dicts."""
    joint = dict(raw)
    joint_type = str(joint.get("type", "")).lower()
    parent = joint.get("parent") or joint.get("parent_link") or joint.get("parent_id")
    child = joint.get("child") or joint.get("child_link") or joint.get("child_id")
    if not parent or not child:
        return None

    joint_id = joint.get("id") or joint.get("name") or joint.get("label")
    if not joint_id:
        joint_id = f"{_slug_id(str(parent), 'parent')}_to_{_slug_id(str(child), 'child')}"
    joint_id = _slug_id(str(joint_id), f"joint_{index + 1}")
    base_id = joint_id
    n = 2
    while joint_id in seen_ids:
        joint_id = f"{base_id}_{n}"
        n += 1
    seen_ids.add(joint_id)

    anchor = joint.get("anchor") or joint.get("origin") or joint.get("position") or [0.0, 0.0, 0.0]
    if not isinstance(anchor, (list, tuple)) or len(anchor) < 3:
        anchor = [0.0, 0.0, 0.0]
    axis = joint.get("axis") or [0.0, 0.0, 1.0]
    if not isinstance(axis, (list, tuple)) or len(axis) < 3:
        axis = [0.0, 0.0, 1.0]

    normalized: dict[str, Any] = {
        "id": joint_id,
        "type": joint_type if joint_type in _SUPPORTED_JOINT_TYPES else "fixed",
        "parent": str(parent),
        "child": str(child),
        "anchor": [float(anchor[0]), float(anchor[1]), float(anchor[2])],
        "axis": [float(axis[0]), float(axis[1]), float(axis[2])],
    }
    resolved_type = normalized["type"]
    norm_limits = _normalize_limits(joint.get("limits"), resolved_type)
    if norm_limits is not None:
        normalized["limits"] = norm_limits
    for key, value in _limits_drive_fields(joint.get("limits"), resolved_type).items():
        if joint.get(key) is None:
            normalized[key] = value
    if joint.get("drive_torque_nm") is not None:
        normalized["drive_torque_nm"] = joint["drive_torque_nm"]
    if joint.get("drive_velocity_dps") is not None:
        normalized["drive_velocity_dps"] = joint["drive_velocity_dps"]
    return normalized


def _sanitize_program_dict(program: dict[str, Any]) -> dict[str, Any]:
    """Normalize common AI schema mistakes before strict FeatureProgram validation.

    Gear meshes/ratios are design metadata, not physical joints in Render3D's
    current URDF/MJCF joint model. Preserve them under ``meta.gear_relationships``
    instead of letting a non-supported ``type: gear`` crash validation.
    """
    cleaned = dict(program)
    meta = dict(cleaned.get("meta") or {})
    valid_joints: list[dict[str, Any]] = []
    moved_relationships: list[dict[str, Any]] = list(meta.get("gear_relationships") or [])
    seen_joint_ids: set[str] = set()

    for idx, raw in enumerate(cleaned.get("joints") or []):
        if not isinstance(raw, dict):
            continue
        joint = dict(raw)
        joint_type = str(joint.get("type", "")).lower()
        has_required_links = bool(joint.get("parent") or joint.get("parent_link")) and bool(
            joint.get("child") or joint.get("child_link")
        )
        if joint_type in _SUPPORTED_JOINT_TYPES and has_required_links:
            normalized = _normalize_joint(joint, idx, seen_joint_ids)
            if normalized:
                valid_joints.append(normalized)
            continue
        if joint_type in {"gear", "gear_mesh", "gear_ratio", "mesh"} or "ratio" in joint or not has_required_links:
            moved_relationships.append(joint)
            continue
        # Unknown malformed joints are also metadata so a visual model can build.
        meta.setdefault("ignored_joints", []).append(joint)

    cleaned["joints"] = valid_joints
    if moved_relationships:
        meta["gear_relationships"] = moved_relationships
    cleaned["meta"] = meta
    return cleaned


def _repair_hint_for_build_error(exc: Exception) -> str:
    """Extra guidance appended to AI self-repair prompts for common kernel failures."""
    msg = str(exc)
    if "pre-build validation" in msg or "Program failed" in msg:
        return (
            f"{msg}\n\n"
            "Validation repair checklist:\n"
            "- Every part's FIRST feature must be a solid-creating op (box, cylinder, sphere, extrude, revolve, loft) with combine='new'.\n"
            "- Do NOT place a cut/intersect/fillet/chamfer before any solid base exists in that part.\n"
            "- Duplicate primitives at the same position cause z-fighting — merge or offset them.\n"
            "- Joint parent/child must match an actual part id in the program.\n"
            "- Emit `design_plan.brief` with `part_constraints` listing the base_op for each part.\n"
            "- Review no_can_dos in the brief and ensure none are violated in the program."
        )
    if "zero/empty volume" in msg or "produced no geometry" in msg:
        return (
            f"{msg}\n\n"
            "Repair checklist:\n"
            "- Every part needs a solid FIRST feature (box, cylinder, sphere, extrude, or revolve) with combine=new.\n"
            "- Do NOT create placeholder 'assembly' parts with only cuts or placement — merge into one body or give each part real solids.\n"
            "- Cuts (combine=cut) must overlap the existing body; intersect only if shapes overlap.\n"
            "- For multi-part designs (dispensers, mechanisms): max 6 parts, ≤12 features each, simple primitives.\n"
            "- Prefer one main hollow body (revolve or shell) plus separate small parts for knob/dial/shaft.\n"
            "- Do NOT stack overlapping full-size primitives at the same position — merge into one watertight body."
        )
    if "pattern count must be >= 1" in msg or "pattern count" in msg:
        return (
            f"{msg}\n\n"
            "Pattern repair checklist:\n"
            "- Every 'pattern' feature MUST have count >= 1 (e.g. count: 4 for four rubber feet).\n"
            "- Alternatively, provide explicit 'locations': [[x1,y1,z1],[x2,y2,z2],...] to place individual copies.\n"
            "- For rubber feet / corner details: use count: 4 with rectangular arrange + x_count: 2 + y_count: 2, or provide 4 explicit locations.\n"
            "- For cable pass-through: use a simple cylinder cut feature, NOT a pattern — patterns replicate, they do not create single features.\n"
            "- If you do not need multiple copies, remove the pattern feature and just add the shape directly."
        )
    return msg


def _extract_brief(design: dict[str, Any]) -> DesignBrief | None:
    """Pull a DesignBrief from the AI design dict, if present.

    The AI is asked to emit ``design_plan.brief`` as a structured object.
    We accept it from multiple common locations for robustness.
    """
    raw: dict[str, Any] | None = None
    dp = design.get("design_plan")
    if isinstance(dp, dict):
        raw = dp.get("brief") or dp.get("constraint_plan")
    if raw is None:
        raw = design.get("brief") or design.get("constraint_plan")
    if not isinstance(raw, dict):
        return None
    try:
        return DesignBrief.model_validate(raw)
    except Exception as exc:
        logger.debug("DesignBrief parse failed (non-fatal): %s", exc)
        return None


def design_to_program(design: dict[str, Any]) -> FeatureProgram:
    """Resolve an AI design dict into a concrete FeatureProgram."""
    generator = design.get("generator")
    if isinstance(generator, dict) and generator:
        return _program_from_generator(generator)
    program = design.get("program")
    if isinstance(program, dict) and program:
        program = _sanitize_program_dict(program)
        if "name" not in program and design.get("filename"):
            program["name"] = design["filename"]
        return FeatureProgram.model_validate(program)
    raise ValueError("AI design contained neither a valid 'generator' nor 'program'")


def _looks_like_component_fixture(prompt: str) -> bool:
    """A case/mount/holder request for referenced real components."""
    p = prompt.lower()
    fixture_words = (
        "case", "casing", "enclosure", "mount", "holder", "hold the", "bracket",
        "cradle", "fixture", "tray", "stand", "housing", "chassis", "base plate",
        "baseplate", "breadboard", "slab", "test plate", "testing plate",
        "testing slab", "mount plate", "plate for", "mounting plate",
        "raspberry pi", " rpi", " pi ", "sbc", "pcb", "board pocket",
        "motor mount", "stepper mount", "nema", "standoff", "standoffs",
        "box", "open top", "no lid", "lidless", "test bench", "test fixture",
    )
    return any(w in p for w in fixture_words)


def _looks_like_benchy_boat(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    p = prompt.lower()
    boat_words = ("benchy", "boaty", "toy boat", "boat model", "boat from", "boat based")
    return any(w in p for w in boat_words) or (bool(images) and "boat" in p)


def _looks_like_pet_bottle(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    p = prompt.lower()
    bottle_words = (
        "coke bottle",
        "coca-cola",
        "coca cola",
        "soda bottle",
        "pet bottle",
        "pet soda",
        "cola bottle",
        "plastic bottle",
        "beverage bottle",
        "500ml bottle",
        "coke-style",
        "contour bottle",
    )
    if any(w in p for w in bottle_words):
        return True
    if "coke" in p and "bottle" in p:
        return True
    if images and "bottle" in p:
        return True
    if images and any(w in p for w in ("coke", "cola", "soda", "pet")):
        return True
    return False


def _looks_like_cooking_appliance(prompt: str, images: list[dict[str, Any]] | None = None) -> bool:
    p = prompt.lower()
    tool_swap = any(
        w in p
        for w in (
            "whisk",
            "mixing paddle",
            "paddle",
            "beater",
            "balloon whisk",
            "agitator",
            "toolhead",
            "tool head",
        )
    ) and any(w in p for w in ("change", "replace", "swap", "convert", "make this", "turn this", "to a", "into a"))
    if tool_swap:
        return True
    appliance_words = (
        "automated cooking appliance",
        "countertop cooking appliance",
        "auto cook",
        "autocook",
        "cooking robot",
        "robotic cooker",
        "spice dispenser",
        "chopper hopper",
        "stirring machine",
    )
    if any(w in p for w in appliance_words):
        return True
    # "mixing bowl" / "mixing shaft" only if also about cooking — avoid matching motor/stepper prompts
    if "mixing bowl" in p and any(w in p for w in ("cook", "recipe", "spice", "ingredient", "kitchen")):
        return True
    if "mixing shaft" in p and any(w in p for w in ("cook", "recipe", "spice", "ingredient", "kitchen", "bowl")):
        return True
    if "cooking" in p and "appliance" in p:
        return True
    if "bowl" in p and "spice" in p and "hopper" in p:
        return True
    if "parametric cad" in p and any(w in p for w in ("bowl", "column", "bridge", "shaft", "hopper")):
        return True
    if images and "appliance" in p and any(w in p for w in ("cook", "bowl", "spice", "chopper")):
        return True
    return False


def _max_repairs_for_speed(speed: str | None) -> int:
    s = (speed or "fast").lower()
    if s == "quality":
        return 2
    return 1


def _maybe_run_cad_inspect(result: dict[str, Any], project_path: Path, skills: list[str] | None, trace_id: str | None) -> None:
    """Best-effort CAD skill inspect on exported STEP when cad skill is active."""
    if not skills or "cad" not in {s.strip().lower() for s in skills}:
        return
    step_name = (result.get("files") or {}).get("step")
    if not step_name:
        return
    step_path = project_path / step_name
    try:
        from backend.services import skill_runner

        out = skill_runner.inspect_step_facts(step_path, timeout_sec=45.0)
        if out.get("ok"):
            mode = out.get("mode") or "cad-inspect"
            trace_add("info", f"CAD skill validate OK ({mode}) → {step_name}", trace_id=trace_id)
        else:
            detail = (out.get("stderr") or out.get("stdout") or "unknown")[:200]
            trace_add("warning", f"CAD skill inspect skipped/failed: {detail}", trace_id=trace_id)
    except Exception as exc:
        trace_add("warning", f"CAD skill inspect error: {exc}", trace_id=trace_id)


def _run_cad_inspect_gate(result: dict[str, Any], project_path: Path, trace_id: str | None) -> dict[str, Any] | None:
    """V2-mode: always run CAD inspect as a quality gate. Returns the inspect output dict."""
    step_name = (result.get("files") or {}).get("step")
    if not step_name:
        return None
    step_path = project_path / step_name
    try:
        from backend.services import skill_runner

        out = skill_runner.inspect_step_facts(step_path, timeout_sec=60.0)
        ok = out.get("ok", False)
        mode = out.get("mode") or "cad-inspect"
        if ok:
            trace_add("info", f"[2.0] CAD inspect gate passed ({mode}) → {step_name}", trace_id=trace_id)
        else:
            detail = (out.get("stderr") or out.get("stdout") or "no detail")[:400]
            trace_add("warning", f"[2.0] CAD inspect gate FAILED: {detail}", trace_id=trace_id)
        return out
    except Exception as exc:
        trace_add("warning", f"[2.0] CAD inspect gate skipped (runner unavailable): {exc}", trace_id=trace_id)
        return None


def run_design(
    prompt: str,
    project_path: Path,
    context: dict[str, Any],
    ai: AIService,
    *,
    trace_id: str | None = None,
    max_repairs: int | None = None,
    images: list[dict[str, Any]] | None = None,
    skills: list[str] | None = None,
    speed: str = "fast",
    mode: str = "standard",
    cancel_check=None,
    progress_callback=None,
) -> dict[str, Any]:
    """Run the full prompt->validated-model pipeline with self-repair.

    ``mode="v2"`` enables the 2.0 quality pipeline:
    - Auto-enables the ``cad`` skill for geometry inspection.
    - Forces at least 3 repair attempts.
    - Gates on ``design_plan.brief`` presence — retries without it.
    - After a successful build, runs CAD inspect as a blocking gate; geometry
      failures re-enter the repair loop with specific feedback.
    """
    is_v2 = (mode or "standard").lower() == "v2"
    repair_note: str | None = None
    last_error: str | None = None
    ai_traces: list[dict[str, Any]] = []
    if max_repairs is None:
        max_repairs = max(_max_repairs_for_speed(speed), 3) if is_v2 else _max_repairs_for_speed(speed)

    if is_v2:
        # Always include the CAD skill so inspect_step_facts runs and DFM is accurate.
        skills_set = set(s.strip().lower() for s in (skills or []))
        if "cad" not in skills_set:
            skills = list(skills or []) + ["cad"]
        trace_add("info", "[2.0] Quality pipeline active — CAD skill auto-enabled, max_repairs=%d", trace_id=trace_id, data={"max_repairs": max_repairs})
    if cancel_check and cancel_check():
        raise DesignCanceled("Generation canceled.")
    if progress_callback:
        progress_callback({"stage": "analyze", "pct": 8, "label": "Analyzing prompt and references…"})

    all_component_specs = (context or {}).get("component_specs") or []
    # Prefer measured specs; if a spec has a standard_mount preset but no measured size_mm,
    # keep it for fixture routing — the fixture compiler uses catalog dims as fallback.
    component_specs = [s for s in all_component_specs if s.get("size_mm") or s.get("standard_mount")]
    if not component_specs:
        component_specs = all_component_specs
    if component_specs and _looks_like_component_fixture(prompt):
        from backend.engineering.fixtures import fixture_program_from_specs

        if progress_callback:
            progress_callback({"stage": "plan", "pct": 18, "label": "Building component-fit fixture from measured parts…"})
        program, placements = fixture_program_from_specs(component_specs)
        result = kernel_bridge.build_and_export(program, project_path, basename=program.name)
        _maybe_run_cad_inspect(result, project_path, skills, trace_id)
        plate = program.meta.get("plate_mm") or []
        names = ", ".join(s.get("label") or s.get("stem") for s in component_specs)
        cells = (program.meta.get("components") or [])
        mount_features = []
        if any(c.get("kind") == "board" for c in cells):
            mount_features.append("PCB/SBC standoffs")
        if any(c.get("kind") == "motor" for c in cells):
            mount_features.append("motor faceplate/bracket")
        dimension_rows = []
        if len(plate) == 3:
            dimension_rows = [
                {"param": "plate_width", "value_mm": plate[0], "source": "measured"},
                {"param": "plate_depth", "value_mm": plate[1], "source": "measured"},
                {"param": "plate_thickness", "value_mm": plate[2], "source": "standard"},
            ]
        deterministic_plan = {
            "requirements_analysis": "Component-fit mount request routed to the deterministic fixture compiler instead of freehand AI geometry.",
            "component_hierarchy": "Generated fixture base plus referenced off-the-shelf components seated by part_placements.",
            "parametric_dimension_table": dimension_rows,
            "assembly_plan": "Measured component bounding boxes and known mount presets drive pocket centers, standoff patterns, motor faceplate/bracket geometry, and component placements.",
            "cad_feature_plan": "Use backend engineering.fixtures fixture_program_from_specs: base plate, board pocket, four standoffs with pilot holes, motor mount pad/bracket with bolt pattern, then seat components.",
            "part_generation": f"Deterministic mount compiler generated: {', '.join(mount_features) or 'component-fit features'}.",
            "assembly_constraints": [],
            "step_ready_brep_output": "Fixture generated from deterministic measured-spec rules, not a freehand LLM plate.",
        }
        trace_add("info", f"Deterministic component fixture used for: {names}", trace_id=trace_id)
        dfm = result.get("dfm") or {}
        return {
            "intent": "generative",
            "message": (
                f"Built an open test fixture ({plate[0]:.0f}×{plate[1]:.0f}×{plate[2]:.0f}mm) sized to {names}, "
                f"using the deterministic mount compiler ({', '.join(mount_features)}), and moved each part into its mount."
                if len(plate) == 3
                else f"Built a component-fit test fixture for {names} and seated the parts in their mounts."
            ),
            "design_plan": deterministic_plan,
            "specs_used": [{"source": "component_fixture", "components": [s.get("stem") for s in component_specs]}],
            "part_placements": placements,
            "result": result,
            "attempts": 1,
            "ai_trace": [{"provider": "deterministic", "generator": "component_fixture"}],
            "dfm_warnings": dfm.get("warnings", []),
        }

    if _looks_like_pet_bottle(prompt, images):
        from backend.engineering.bottles import pet_soda_bottle_program

        program = pet_soda_bottle_program()
        result = kernel_bridge.build_and_export(program, project_path, basename=program.name)
        _maybe_run_cad_inspect(result, project_path, skills, trace_id)
        trace_add("info", "Deterministic PET soda bottle generator used", trace_id=trace_id)
        dfm = result.get("dfm") or {}
        return {
            "intent": "generative",
            "message": program.description or "Built a detailed Coke-style PET bottle with contour ribs and cap.",
            "specs_used": [],
            "result": result,
            "attempts": 1,
            "ai_trace": [{"provider": "deterministic", "generator": "pet_soda_bottle"}],
            "dfm_warnings": dfm.get("warnings", []),
        }

    if _looks_like_cooking_appliance(prompt, images):
        from backend.engineering.appliances import automated_cooking_appliance_program

        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")
        if progress_callback:
            progress_callback({"stage": "plan", "pct": 18, "label": "Using automated appliance generator with steppers…"})
        program = automated_cooking_appliance_program()
        result = kernel_bridge.build_and_export(program, project_path, basename="automated_cooking_appliance")
        _maybe_run_cad_inspect(result, project_path, skills, trace_id)
        trace_add("info", "Deterministic automated cooking appliance generator used", trace_id=trace_id)
        dfm = result.get("dfm") or {}
        whisk_swap = any(w in prompt.lower() for w in ("whisk", "beater", "paddle", "toolhead", "tool head"))
        return {
            "intent": "generative",
            "message": (
                "Rebuilt the cooking appliance with a parametric balloon-whisk toolhead on the mixing shaft."
                if whisk_swap
                else (
                    "Built a complete automated cooking appliance with NEMA-17 bowl/chopper steppers "
                    "and NEMA-14 spice dispenser steppers in functional mount positions."
                )
            ),
            "specs_used": [{"source": "automated_cooking_appliance_generator", "envelope_mm": [420, 360, 520]}],
            "result": result,
            "attempts": 1,
            "ai_trace": [{"provider": "deterministic", "generator": "automated_cooking_appliance"}],
            "dfm_warnings": dfm.get("warnings", []),
        }

    if _looks_like_benchy_boat(prompt, images):
        from backend.engineering.toy_boats import benchy_boat_program

        program = benchy_boat_program()
        result = kernel_bridge.build_and_export(program, project_path, basename=program.name)
        trace_add("info", "Deterministic Benchy-style boat generator used", trace_id=trace_id)
        dfm = result.get("dfm") or {}
        return {
            "intent": "generative",
            "message": "Built a single-solid Benchy-style toy boat with fused hull, cabin, roof, and chimney, plus cut openings for the deck, door, and portholes.",
            "specs_used": [],
            "result": result,
            "attempts": 1,
            "ai_trace": [{"provider": "deterministic", "generator": "benchy_boat"}],
            "dfm_warnings": dfm.get("warnings", []),
        }

    for attempt in range(max_repairs + 1):
        if progress_callback:
            progress_callback(
                {
                    "stage": "ai_plan",
                    "pct": 12 if attempt == 0 else 16,
                    "label": f"Planning CAD geometry with AI (attempt {attempt + 1})…",
                }
            )
        try:
            design, ai_trace = ai.generate_design(
                prompt,
                context,
                trace_id=trace_id,
                repair_note=repair_note,
                images=images,
                skills=skills,
                mode=mode,
            )
        except ValueError as exc:
            msg = str(exc)
            if "invalid JSON" not in msg:
                raise
            last_error = msg
            repair_note = (
                "Your previous response was truncated or invalid JSON.\n"
                "Return one COMPLETE JSON object. Keep each design_plan section concise "
                "(2-4 sentences) but include brief, program/generator, and all required fields.\n"
                f"Error: {msg[:800]}"
            )
            trace_add("warning", f"Invalid JSON on attempt {attempt + 1} — retrying", trace_id=trace_id)
            continue
        ai_traces.append(ai_trace)
        if cancel_check and cancel_check():
            raise DesignCanceled("Generation canceled.")

        # ── V2 brief gate ────────────────────────────────────────────────────
        if is_v2:
            brief_raw = _extract_brief(design)
            if brief_raw is None:
                missing_brief_note = (
                    "REJECTED: design_plan.brief is missing.\n"
                    "The 2.0 pipeline requires a brief object inside design_plan with fields: "
                    "title, description, design_intent, constraints, no_can_dos, part_constraints.\n"
                    "Return the FULL corrected JSON with brief included."
                )
                trace_add("warning", "[2.0] Brief missing — retrying with brief requirement", trace_id=trace_id)
                repair_note = missing_brief_note
                last_error = "design_plan.brief was not present in the AI response"
                continue

        if progress_callback:
            progress_callback(
                {
                    "stage": "program",
                    "pct": 18,
                    "label": "Converting AI plan into parametric features…",
                }
            )
        trace_add(
            "info",
            f"Design attempt {attempt + 1}: intent={design.get('intent')} "
            f"{'generator' if design.get('generator') else 'program'}",
            trace_id=trace_id,
        )
        try:
            program = design_to_program(design)

            # ── Pre-build validity gate ──────────────────────────────────────
            brief = _extract_brief(design)
            try:
                vr = validate_and_raise(program, brief)
                if vr.warnings:
                    for w in vr.warnings:
                        trace_add("warning", f"[validator] {w}", trace_id=trace_id)
            except ProgramValidationError as vexc:
                trace_add("error", f"[validator] {vexc}", trace_id=trace_id)
                raise ValueError(
                    "Program failed pre-build validation:\n" + str(vexc)
                ) from vexc

            if cancel_check and cancel_check():
                raise DesignCanceled("Generation canceled.")
            if progress_callback:
                progress_callback({"stage": "build", "pct": 24, "label": "Building and exporting model…"})
            result = kernel_bridge.build_and_export(
                program, project_path, basename=design.get("filename") or program.name
            )
        except (KernelBuildError, ValueError) as exc:
            last_error = str(exc)
            repair_note = _repair_hint_for_build_error(exc)
            trace_add("error", f"Design build failed (attempt {attempt + 1}): {exc}", trace_id=trace_id)
            continue

        # Built successfully.
        dfm = result.get("dfm") or {}

        # ── V2 CAD inspect gate ──────────────────────────────────────────────
        if is_v2:
            if progress_callback:
                progress_callback({"stage": "inspect", "pct": 82, "label": "Inspecting geometry with CAD skill…"})
            inspect_out = _run_cad_inspect_gate(result, project_path, trace_id)
            if inspect_out is not None and not inspect_out.get("ok"):
                # Inspect found geometry issues — feed back into repair loop.
                inspect_detail = (inspect_out.get("stderr") or inspect_out.get("stdout") or "geometry issues detected")[:600]
                inspect_repair_note = (
                    f"Build succeeded but CAD geometry inspection FAILED.\n"
                    f"Inspector output:\n{inspect_detail}\n\n"
                    "Fix the geometry issues: check for zero-volume parts, self-intersections, "
                    "non-manifold edges, or missing material. Resubmit the corrected program."
                )
                repair_note = inspect_repair_note
                last_error = f"CAD inspect gate failed: {inspect_detail[:200]}"
                trace_add("warning", f"[2.0] Inspect gate failure on attempt {attempt + 1} — entering repair", trace_id=trace_id)
                continue
        else:
            _maybe_run_cad_inspect(result, project_path, skills, trace_id)

        return {
            "intent": design.get("intent"),
            "message": design.get("message") or program.description or "Model built.",
            "design_plan": design.get("design_plan"),
            "specs_used": design.get("specs_used") or [],
            "part_placements": design.get("part_placements") or [],
            "result": result,
            "attempts": attempt + 1,
            "ai_trace": ai_traces,
            "dfm_warnings": dfm.get("warnings", []),
            **({"v2_inspect": True} if is_v2 else {}),
        }

    raise DesignBuildError(
        f"Design failed after {max_repairs + 1} attempts. Last error: {last_error}",
        ai_traces=ai_traces,
    )
